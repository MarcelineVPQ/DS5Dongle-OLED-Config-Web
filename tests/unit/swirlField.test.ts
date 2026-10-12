import { describe, expect, it } from "vitest";
import { rotateHue, swirlPixel } from "../../src/desktop/live/SwirlField";

describe("swirl field", () => {
  it("blends four colors with weights that add up to 1", () => {
    const w = [0, 0, 0, 0];
    for (const [x, y, t] of [
      [0, 0, 0],
      [0.5, 0.5, 10],
      [0.9, 0.2, 123],
    ]) {
      swirlPixel(x, y, t, w);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
      expect(w.every((v) => v >= 0 && v <= 1)).toBe(true);
    }
  });
  it("turns the hue, keeping lightness and saturation", () => {
    expect(rotateHue([255, 0, 0], 120)).toEqual([0, 255, 0]);
    expect(rotateHue([255, 0, 0], -120)).toEqual([0, 0, 255]);
    expect(rotateHue([128, 128, 128], 35)).toEqual([128, 128, 128]); // grey has no hue
    // Pink's neighbors stay in the pink/red/violet family, never green.
    const [r, g, b] = rotateHue([236, 72, 153], 35);
    expect(g).toBeLessThan(r);
    expect(g).toBeLessThan(Math.max(r, b));
  });
});
