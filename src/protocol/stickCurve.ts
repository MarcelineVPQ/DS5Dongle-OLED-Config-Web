// Stick response curves (protocol 1.10), kept in the dongle per pairing slot
// and applied to the report games receive, after calibration. This is the
// firmware's src/stick_curve.h step for step (pure integer math in Q12, 4096 =
// full tilt), so the app's preview shows exactly the bytes a game gets; the
// tests hold sample bytes computed from that header. Change both together.
//
// A curve maps the stick's radial tilt to a new tilt; the direction is kept.
//   linear      identity (the dongle skips it)
//   precise     y = x^1.8   (slow start, fine aim)
//   steady      y = x^1.35  (milder slow start)
//   aggressive  y = x^0.6   (quick start)
//   digital     y = x^0.3   (almost on/off)
//   custom      piecewise linear through (0,0), 4 points, (255,255)
// Wire / flash: 9 bytes [type, p1x, p1y, p2x, p2y, p3x, p3y, p4x, p4y].
// Get 0xEC ['C','V', 1, slot, flags, saved L, saved R, active L, active R];
// set 0xF6 0x14 ['C','V', 1, slot, L, R, temporary 0/1].

export const CURVE_PROTO_VER = 1;
export const CURVE_BYTES = 9;
export const CURVE_REPORT_BYTES = 5 + 4 * CURVE_BYTES;

export const CURVE_TYPES = ["linear", "precise", "steady", "aggressive", "digital", "custom"] as const;
export type CurveType = (typeof CURVE_TYPES)[number];
export const CURVE_PRESETS = CURVE_TYPES.filter((t) => t !== "custom");

export type CurvePoint = [number, number]; // x, y in 0..255 (255 = full tilt)
export interface StickCurve {
  type: CurveType;
  // Only "custom" uses them; presets keep them so switching back restores them.
  points: [CurvePoint, CurvePoint, CurvePoint, CurvePoint];
}
export type StickCurvePair = [StickCurve, StickCurve]; // left, right

// The firmware's defaults: Linear, with a gentle slow start parked as the custom points.
export const DEFAULT_CUSTOM_POINTS: StickCurve["points"] = [
  [51, 31],
  [102, 77],
  [153, 133],
  [204, 194],
];
export const LINEAR_CURVE: StickCurve = { type: "linear", points: DEFAULT_CUSTOM_POINTS };
export const DEFAULT_CURVES: StickCurvePair = [LINEAR_CURVE, LINEAR_CURVE];

const Q = 4096;
const LUT = 33;
// round(4096 * (i/32)^g), the same tables as the firmware.
const PRESET_LUT: Record<Exclude<CurveType, "linear" | "custom">, readonly number[]> = {
  precise: [0, 8, 28, 58, 97, 145, 201, 266, 338, 418, 505, 599, 701, 809, 925, 1047, 1176, 1312, 1454, 1603, 1758, 1919, 2087, 2260, 2440, 2627, 2819, 3017, 3221, 3431, 3647, 3868, 4096],
  steady: [0, 38, 97, 168, 247, 334, 427, 526, 630, 739, 852, 969, 1090, 1214, 1342, 1473, 1607, 1744, 1884, 2026, 2172, 2320, 2470, 2623, 2778, 2935, 3095, 3256, 3420, 3586, 3754, 3924, 4096],
  aggressive: [
    0, 512, 776, 990, 1176, 1345, 1500, 1646, 1783, 1913, 2038, 2158, 2274, 2386, 2494, 2600, 2702, 2802, 2900, 2996, 3089, 3181, 3271, 3360, 3447, 3532, 3616, 3699, 3781, 3861, 3940, 4019, 4096,
  ],
  digital: [
    0, 1448, 1783, 2013, 2195, 2347, 2479, 2596, 2702, 2800, 2889, 2973, 3052, 3126, 3196, 3263, 3327, 3388, 3447, 3503, 3557, 3610, 3661, 3710, 3757, 3804, 3849, 3892, 3935, 3977, 4017, 4057, 4096,
  ],
};
export const PRESET_EXPONENT = { precise: 1.8, steady: 1.35, aggressive: 0.6, digital: 0.3 } as const;

const isByte = (v: number) => Number.isInteger(v) && v >= 0 && v <= 255;

// Custom points must be bytes, non-decreasing in x and y (what the firmware accepts).
export function isValidCurve(c: StickCurve): boolean {
  if (!CURVE_TYPES.includes(c.type)) return false;
  // loop: HOT-PATH-OK — N = 4 points; cost is in the callers (see nodesOf row)
  if (c.points.length !== 4 || c.points.some(([x, y]) => !isByte(x) || !isByte(y))) return false;
  if (c.type !== "custom") return true;
  // loop: HOT-PATH-OK — N = 3 point pairs
  for (let i = 1; i < 4; i++) if (c.points[i][0] < c.points[i - 1][0] || c.points[i][1] < c.points[i - 1][1]) return false;
  return true;
}

// Moves one custom point within its neighbours (and 0..255), so the curve
// stays valid while it is dragged.
export function movePoint(points: StickCurve["points"], index: number, x: number, y: number): StickCurve["points"] {
  const lo = (i: number, k: 0 | 1) => (i > 0 ? points[i - 1][k] : 0);
  const hi = (i: number, k: 0 | 1) => (i < 3 ? points[i + 1][k] : 255);
  const clampTo = (v: number, a: number, b: number) => Math.min(b, Math.max(a, Math.round(v)));
  const next = points.map((p) => [...p]) as StickCurve["points"];
  next[index] = [clampTo(x, lo(index, 0), hi(index, 0)), clampTo(y, lo(index, 1), hi(index, 1))];
  return next;
}

export function encodeCurve(c: StickCurve): number[] {
  return [CURVE_TYPES.indexOf(c.type), ...c.points.flat()];
}

// The 9 wire bytes as a curve, or null where the firmware refuses it (type
// out of range, custom points decreasing).
export function strictCurve(b: ArrayLike<number>): StickCurve | null {
  const type = CURVE_TYPES[b[0]] as CurveType | undefined;
  const points = [0, 1, 2, 3].map((i) => [b[1 + 2 * i], b[2 + 2 * i]]) as StickCurve["points"];
  const c: StickCurve | null = type ? { type, points } : null;
  return c && isValidCurve(c) ? c : null;
}

// Like the firmware's load: anything it refuses (0xFF = erased) reads as Linear.
// (with the default custom points, as calib_load's set_linear).
export function decodeCurve(b: ArrayLike<number>): StickCurve {
  return strictCurve(b) ?? LINEAR_CURVE;
}

export interface CurvesReport {
  slot: number;
  temporary: boolean; // a game's curves are on (RAM only)
  saved: StickCurvePair;
  active: StickCurvePair;
}

export function decodeCurvesReport(b: Uint8Array): CurvesReport | null {
  if (b.length < CURVE_REPORT_BYTES || b[0] !== 0x43 || b[1] !== 0x56 || b[2] !== CURVE_PROTO_VER) return null;
  const at = (i: number) => decodeCurve(b.subarray(5 + i * CURVE_BYTES, 5 + (i + 1) * CURVE_BYTES));
  return { slot: b[3], temporary: (b[4] & 0x01) !== 0, saved: [at(0), at(1)], active: [at(2), at(3)] };
}

// loop: HOT-PATH-OK — N = 4 points
export const curvesEqual = (a: StickCurve, b: StickCurve) => a.type === b.type && (a.type !== "custom" || a.points.every((p, i) => p[0] === b.points[i][0] && p[1] === b.points[i][1]));

// --- The firmware's math (src/stick_curve.h) ---

interface Nodes {
  x: number[];
  y: number[];
}
const byteQ = (b: number) => Math.floor((b * Q + 127) / 255);

function nodesOf(c: StickCurve): Nodes | null {
  if (c.type === "linear" || !isValidCurve(c)) return null;
  if (c.type === "custom") {
    // loop: FIX-HOT-PATH — nodes rebuilt per call: 65 curveAt calls per graph per live frame
    return { x: [0, ...c.points.map(([x]) => byteQ(x)), Q], y: [0, ...c.points.map(([, y]) => byteQ(y)), Q] };
  }
  return { x: Array.from({ length: LUT }, (_, i) => i * (Q / (LUT - 1))), y: [...PRESET_LUT[c.type]] };
}

function evalNodes(n: Nodes, m: number): number {
  // loop: HOT-PATH-OK — N ≤ 34 nodes, the firmware math itself
  for (let k = 0; k + 1 < n.x.length; k++) {
    const xa = n.x[k];
    const xb = n.x[k + 1];
    if (m > xb || xb === xa) continue;
    return n.y[k] + Math.floor(((n.y[k + 1] - n.y[k]) * (m - xa)) / (xb - xa));
  }
  return m;
}

// The curve at tilt t (0..1) as 0..1, for drawing it.
export function curveAt(c: StickCurve, t: number): number {
  const n = nodesOf(c);
  if (!n) return t;
  return evalNodes(n, Math.round(Math.min(1, Math.max(0, t)) * Q)) / Q;
}

// What the dongle sends for stick bytes (x, y) (after calibration).
export function applyCurve(x: number, y: number, c: StickCurve): [number, number] {
  const n = nodesOf(c);
  if (!n) return [x, y];
  const dx = x - 128;
  const dy = y - 128;
  if (dx === 0 && dy === 0) return [x, y];
  const denx = dx >= 0 ? 127 : 128;
  const deny = dy >= 0 ? 127 : 128;
  const nx = Math.floor((Math.abs(dx) * Q) / denx);
  const ny = Math.floor((Math.abs(dy) * Q) / deny);
  const mag = Math.floor(Math.sqrt(nx * nx + ny * ny));
  if (mag === 0 || mag >= Q) return [x, y];
  const out = evalNodes(n, mag);
  const ox = Math.min(denx, Math.floor((Math.floor((nx * out) / mag) * denx + Q / 2) / Q));
  const oy = Math.min(deny, Math.floor((Math.floor((ny * out) / mag) * deny + Q / 2) / Q));
  return [dx >= 0 ? 128 + ox : 128 - ox, dy >= 0 ? 128 + oy : 128 - oy];
}

// Radial tilt (0..1, may pass 1 in square-gate corners) of stick bytes, as the curve sees it.
export function tiltOf(x: number, y: number): number {
  const dx = x - 128;
  const dy = y - 128;
  return Math.hypot(dx / (dx >= 0 ? 127 : 128), dy / (dy >= 0 ? 127 : 128));
}
