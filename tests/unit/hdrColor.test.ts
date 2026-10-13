import { describe, expect, it } from "vitest";
import { SDR_WHITE_NITS, hdrBoost, ledLinear, toLinear } from "../../src/desktop/live/hdrColor";

// The light the shader asks for at the strip's core: the LED color times the
// core boost (linear light, multiples of SDR white).
const coreLight = (rgb: number[], nits: number) => ledLinear(rgb).map((c) => c * hdrBoost(nits).core);
// How far a color is from white: its weakest channel over its strongest
// (1 = white; lower = more saturated).
const whiteness = (c: number[]) => Math.max(0, Math.min(...c)) / Math.max(...c);
const MAGENTA = [255, 20, 147];

describe("HDR lighting color", () => {
  it("keeps a saturated magenta's hue at every peak", () => {
    const ref = ledLinear(MAGENTA);
    for (const nits of [200, 500, 1000, 2000]) {
      const out = coreLight(MAGENTA, nits);
      const top = Math.max(...out);
      out.forEach((c, i) => expect(c / top).toBeCloseTo(ref[i], 6));
      // brightest channel lands on the peak, the others keep their share
      expect(top * SDR_WHITE_NITS).toBeCloseTo(Math.max(nits, SDR_WHITE_NITS), 3);
    }
  });
  it("never drifts toward white (no more white than the LED color itself)", () => {
    for (const rgb of [MAGENTA, [255, 0, 0], [0, 255, 64], [64, 64, 255], [255, 160, 0]]) {
      const srgb = rgb.map((c) => toLinear(c / 255));
      for (const nits of [200, 500, 1000, 2000]) expect(whiteness(coreLight(rgb, nits))).toBeLessThanOrEqual(whiteness(srgb) + 1e-9);
    }
  });
  it("keeps the channel order (red over blue over green for magenta)", () => {
    const [r, g, b] = ledLinear(MAGENTA);
    expect(r).toBe(1);
    expect(b).toBeGreaterThan(g);
    expect(b).toBeCloseTo((1.0982735 * toLinear(147 / 255) - 0.0196376 - 0.0786361 * toLinear(20 / 255)) / (1.2249401 - 0.2249404 * toLinear(20 / 255)), 2);
  });
  it("reads the LED as wide gamut: white stays white, pure colors go past sRGB", () => {
    ledLinear([255, 255, 255]).forEach((c) => expect(c).toBeCloseTo(1, 3));
    const red = ledLinear([255, 0, 0]);
    expect(red[0]).toBe(1);
    expect(red[1]).toBeLessThan(0); // outside sRGB: more saturated than sRGB red
  });
  it("is off for black", () => {
    expect(ledLinear([0, 0, 0])).toEqual([0, 0, 0]);
  });
  it("puts the core at the peak in SDR-white units and the halo below it", () => {
    expect(hdrBoost(1015).core).toBeCloseTo(5, 6);
    for (const nits of [200, 500, 1000, 2000]) {
      const { core, halo } = hdrBoost(nits);
      expect(core).toBeGreaterThanOrEqual(1);
      expect(halo).toBeLessThan(core);
    }
  });
});
