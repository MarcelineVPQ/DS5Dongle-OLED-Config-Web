import { describe, expect, it } from "vitest";
import { complement, swirlPixel } from "../../src/desktop/live/SwirlField";

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
  it("takes the complementary hue", () => {
    expect(complement([255, 0, 0])).toEqual([0, 255, 255]);
    expect(complement([170, 20, 80])).toEqual([20, 170, 110]);
  });
});
