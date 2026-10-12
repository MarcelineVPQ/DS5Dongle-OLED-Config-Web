import { describe, expect, it } from "vitest";
import { BUCKETS, type DriftSample, addPoint, circularity, driftStats, emptyOutline, normAxis, outlinePoints } from "../../src/desktop/live/stickTests";

const roll = (shape: (a: number) => number, from = 0, to = 2 * Math.PI, steps = 2000) => {
  let o = emptyOutline();
  for (let k = 0; k <= steps; k++) {
    const a = from + ((to - from) * k) / steps;
    const r = shape(a);
    o = addPoint(o, r * Math.cos(a), r * Math.sin(a));
  }
  return o;
};
// A square gate: the stick reaches full tilt on each axis, so the corners stick out.
const square = (a: number) => 1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));

describe("stick circularity", () => {
  it("a perfect circle scores ~0% error with full coverage", () => {
    const c = circularity(roll(() => 1));
    expect(c.coveragePct).toBe(100);
    expect(c.errorPct).toBeLessThan(0.01);
    expect(c.overPct).toBe(0);
    expect(c.underPct).toBe(0);
  });
  it("a square outline scores high and overshoots", () => {
    const c = circularity(roll(square));
    expect(c.errorPct).toBeGreaterThan(10);
    expect(c.overPct).toBeGreaterThan(50);
    expect(c.underPct).toBe(0);
  });
  it("a stick that doesn't reach the edge undershoots everywhere", () => {
    const c = circularity(roll(() => 0.47)); // the simulated dongle's live mode
    expect(c.errorPct).toBeCloseTo(53, 0);
    expect(c.underPct).toBe(100);
    expect(c.meanReach).toBeCloseTo(0.47, 2);
  });
  it("counts only the directions reached", () => {
    const c = circularity(roll(() => 1, 0, Math.PI / 2));
    expect(c.coveragePct).toBeGreaterThan(24);
    expect(c.coveragePct).toBeLessThan(28);
    expect(c.errorPct).toBeLessThan(0.01);
    expect(outlinePoints(roll(() => 1, 0, Math.PI / 2))).toHaveLength(c.covered);
  });
  it("ignores resting jitter and reports nothing until the stick moves", () => {
    let o = emptyOutline();
    o = addPoint(o, 0.02, -0.01);
    expect(circularity(o)).toMatchObject({ covered: 0, errorPct: null, coveragePct: 0 });
    expect(addPoint(o, 0.5, 0)).not.toBe(o);
    expect(addPoint(o, Number.NaN, 0)).toBe(o);
  });
  it("keeps the farthest reach per direction and returns the same outline when nothing grew", () => {
    const o = addPoint(emptyOutline(), 0.9, 0);
    expect(addPoint(o, 0.8, 0)).toBe(o);
    expect(addPoint(o, 1, 0)[0]).toBe(1);
    expect(o).toHaveLength(BUCKETS);
  });
  it("scales raw axes like the firmware's output", () => {
    expect(normAxis(128)).toBe(0);
    expect(normAxis(255)).toBe(1);
    expect(normAxis(0)).toBe(-1);
  });
});

describe("stick drift", () => {
  // Deterministic noise around a resting point.
  const rest = (x: number, y: number, noise: number, n = 300): DriftSample[] =>
    Array.from({ length: n }, (_, i) => ({ t: i * 33, x: x + Math.round(noise * Math.sin(i * 1.7)), y: y + Math.round(noise * Math.cos(i * 2.3)) }));

  it("a centered stick with a little noise is steady", () => {
    const d = driftStats(rest(128, 128, 1))!;
    expect(d.maxPct).toBeLessThan(2);
    expect(d.noticeable).toBe(false);
    expect(d.beyondDeadzone).toBeNull();
  });
  it("a stick resting off center is flagged, and the deadzone check uses the calibrated center", () => {
    const samples = rest(140, 126, 1);
    const d = driftStats(samples)!;
    expect(d.maxPct).toBeGreaterThan(8);
    expect(d.avgPct).toBeGreaterThan(8);
    expect(d.noticeable).toBe(true);
    expect(driftStats(samples, { cx: 0, cy: 0, deadzone: 6 })!.beyondDeadzone).toBe(true);
    expect(driftStats(samples, { cx: 12, cy: -2, deadzone: 4 })!.beyondDeadzone).toBe(false);
  });
  it("a wandering stick is flagged even near the center", () => {
    const d = driftStats(rest(128, 128, 6))!;
    expect(d.spreadPct).toBeGreaterThan(4);
    expect(d.noticeable).toBe(true);
  });
  it("no samples, no result", () => {
    expect(driftStats([])).toBeNull();
  });
});
