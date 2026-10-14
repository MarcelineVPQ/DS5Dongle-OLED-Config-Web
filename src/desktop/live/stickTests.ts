// Stick tests (Calibration view): how round a stick's reach is, and whether
// it moves while nobody touches it. Pure math; StickTests.tsx samples the
// live input and draws the results.

// Raw 0..255 to -1..1 the way the firmware's output scales it (128 is the
// center; the + side has 127 steps, the - side 128).
export const normAxis = (v: number) => (v >= 128 ? (v - 128) / 127 : (v - 128) / 128);

// ---- Circularity -----------------------------------------------------------

export const BUCKETS = 72; // 5° each
// Points closer to the center than this don't mark a direction as reached
// (resting jitter would otherwise count as a tiny, badly round outline).
export const MIN_REACH = 0.3;
// How far from the circle (fraction of full tilt) counts as over/undershooting.
export const ROUND_TOLERANCE = 0.05;

// The farthest radius reached in each direction; 0 = not reached.
export type Outline = readonly number[];
export const emptyOutline = (buckets = BUCKETS): Outline => new Array<number>(buckets).fill(0);

export const bucketOf = (nx: number, ny: number, buckets: number) => {
  const a = (Math.atan2(ny, nx) + 2 * Math.PI) % (2 * Math.PI);
  return Math.min(buckets - 1, Math.floor(a / ((2 * Math.PI) / buckets)));
};

// Adds a normalized point; returns the same outline when nothing grew, so a
// state update can bail out.
export function addPoint(outline: Outline, nx: number, ny: number): Outline {
  const r = Math.hypot(nx, ny);
  if (!Number.isFinite(r) || r < MIN_REACH) return outline;
  const i = bucketOf(nx, ny, outline.length);
  if (r <= outline[i]) return outline;
  const next = outline.slice();
  next[i] = r;
  return next;
}

export interface Circularity {
  covered: number; // directions reached
  coveragePct: number;
  errorPct: number | null; // mean |r - 1| over the reached directions, in %; null = nothing reached
  meanReach: number | null; // mean radius reached (1 = full tilt)
  overPct: number; // share of reached directions past the circle (+tolerance)
  underPct: number; // share falling short of it (-tolerance)
}

export function circularity(outline: Outline, tolerance = ROUND_TOLERANCE): Circularity {
  // loop: HOT-PATH-OK — N = 72 buckets per live frame
  const reached = outline.filter((r) => r > 0);
  const n = reached.length;
  const pct = (k: number) => (n ? (k / n) * 100 : 0);
  return {
    covered: n,
    coveragePct: (n / outline.length) * 100,
    // loop: HOT-PATH-OK — N ≤ 72 reached buckets
    errorPct: n ? (reached.reduce((a, r) => a + Math.abs(r - 1), 0) / n) * 100 : null,
    // loop: HOT-PATH-OK — N ≤ 72 reached buckets
    meanReach: n ? reached.reduce((a, r) => a + r, 0) / n : null,
    // loop: HOT-PATH-OK — N ≤ 72 reached buckets
    overPct: pct(reached.filter((r) => r > 1 + tolerance).length),
    // loop: HOT-PATH-OK — N ≤ 72 reached buckets
    underPct: pct(reached.filter((r) => r < 1 - tolerance).length),
  };
}

// The outline as points around (0, 0), one per reached direction at its
// bucket's middle angle, in angle order. Gaps are skipped.
export function outlinePoints(outline: Outline): Array<[number, number]> {
  const step = (2 * Math.PI) / outline.length;
  return outline.flatMap((r, i) => (r > 0 ? [[r * Math.cos((i + 0.5) * step), r * Math.sin((i + 0.5) * step)] as [number, number]] : []));
}

// ---- Drift -----------------------------------------------------------------

export const DRIFT_MS = 10_000;
// A resting stick this far from the center (fraction of full tilt), or
// wandering over this much, counts as noticeable movement. A healthy
// DualSense typically rests within a few raw steps of 128.
export const DRIFT_OFFSET = 0.06;
export const DRIFT_SPREAD = 0.04;

export interface DriftSample {
  t: number; // ms since the test started
  x: number; // raw 0..255
  y: number;
}

export interface StickZone {
  cx: number; // calibrated center, offset from 128
  cy: number;
  deadzone: number; // raw steps; 0 = none
}

export interface Drift {
  samples: number;
  maxPct: number; // farthest from the center, % of full tilt
  avgPct: number; // average distance from the center, % of full tilt
  spreadPct: number; // how far it wandered from its own average spot, % of full tilt
  // Did it leave the deadzone (around the calibrated center)? null = no deadzone set.
  beyondDeadzone: boolean | null;
  noticeable: boolean; // moved or sat off-center enough to look like drift
}

export function driftStats(samples: readonly DriftSample[], zone?: StickZone): Drift | null {
  if (!samples.length) return null;
  // loop: HOT-PATH-OK — N ≈ 300 samples; once per finished drift test (StickTests useMemo)
  const pts = samples.map((s) => [normAxis(s.x), normAxis(s.y)] as const);
  // loop: HOT-PATH-OK — N ≈ 300; once per finished drift test (StickTests useMemo)
  const dist = pts.map(([x, y]) => Math.hypot(x, y));
  // loop: HOT-PATH-OK — N ≈ 300; once per finished drift test (StickTests useMemo)
  const mx = pts.reduce((a, [x]) => a + x, 0) / pts.length;
  // loop: HOT-PATH-OK — N ≈ 300; once per finished drift test (StickTests useMemo)
  const my = pts.reduce((a, [, y]) => a + y, 0) / pts.length;
  // loop: HOT-PATH-OK — N ≈ 300; once per finished drift test (StickTests useMemo)
  const spread = Math.max(...pts.map(([x, y]) => Math.hypot(x - mx, y - my)));
  const maxOff = Math.max(...dist);
  // loop: HOT-PATH-OK — N ≈ 300; once per finished drift test (StickTests useMemo)
  const beyondDeadzone = zone && zone.deadzone > 0 ? samples.some((s) => Math.hypot(s.x - 128 - zone.cx, s.y - 128 - zone.cy) > zone.deadzone) : null;
  return {
    samples: samples.length,
    maxPct: maxOff * 100,
    // loop: HOT-PATH-OK — N ≈ 300; once per finished drift test (StickTests useMemo)
    avgPct: (dist.reduce((a, d) => a + d, 0) / dist.length) * 100,
    spreadPct: spread * 100,
    beyondDeadzone,
    noticeable: maxOff > DRIFT_OFFSET || spread > DRIFT_SPREAD,
  };
}
