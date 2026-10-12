import { describe, expect, it } from "vitest";
import { addRecent, clamp, hsvFromHex, hsvToHex, hsvToRgb, normalizeHex, parseChannel, parseHex, parseRecent, RECENT_MAX, rgbToHex, rgbToHsv } from "../../src/desktop/colorPicker/colorMath";

describe("color picker math", () => {
  it("formats and parses hex the way the native color input did", () => {
    expect(rgbToHex([255, 128, 0])).toBe("#ff8000");
    expect(rgbToHex([300, -5, 12.6])).toBe("#ff000d"); // clamped and rounded
    expect(parseHex("#FF8000")).toEqual([255, 128, 0]);
    expect(parseHex("  ff8000 ")).toEqual([255, 128, 0]);
    expect(parseHex("#f80")).toEqual([255, 136, 0]);
    for (const bad of ["", "#", "#ff80", "#ff80000", "zzzzzz", "rgb(1,2,3)", "#ff 800"]) expect(parseHex(bad)).toBeNull();
    expect(normalizeHex("#ABCDEF")).toBe("#abcdef");
    expect(normalizeHex("nope")).toBeNull();
  });

  it("converts RGB <-> HSV", () => {
    expect(rgbToHsv([255, 0, 0])).toEqual({ h: 0, s: 1, v: 1 });
    expect(rgbToHsv([0, 255, 0])).toEqual({ h: 120, s: 1, v: 1 });
    expect(rgbToHsv([0, 0, 255])).toEqual({ h: 240, s: 1, v: 1 });
    expect(rgbToHsv([0, 0, 0])).toEqual({ h: 0, s: 0, v: 0 });
    expect(rgbToHsv([255, 255, 255])).toEqual({ h: 0, s: 0, v: 1 });
    expect(hsvToRgb({ h: 60, s: 1, v: 1 })).toEqual([255, 255, 0]);
    expect(hsvToRgb({ h: 360, s: 1, v: 1 })).toEqual([255, 0, 0]); // wraps
    expect(hsvToRgb({ h: -60, s: 1, v: 1 })).toEqual([255, 0, 255]);
    expect(hsvToRgb({ h: 0, s: 2, v: -1 })).toEqual([0, 0, 0]); // clamped
  });

  it("round-trips every color through HSV exactly", () => {
    for (let r = 0; r < 256; r += 17)
      for (let g = 0; g < 256; g += 15)
        for (let b = 0; b < 256; b += 51) {
          const hex = rgbToHex([r, g, b]);
          expect(hsvToHex(rgbToHsv([r, g, b]))).toBe(hex);
        }
  });

  it("keeps the hue of a grey or black, so the slider doesn't jump", () => {
    const red = { h: 0, s: 1, v: 1 };
    const teal = { h: 180, s: 0.8, v: 0.6 };
    expect(hsvFromHex("#000000", teal)).toEqual({ h: 180, s: 0.8, v: 0 });
    expect(hsvFromHex("#808080", teal)).toEqual({ h: 180, s: 0, v: 128 / 255 });
    expect(hsvFromHex(hsvToHex(teal), teal)).toBe(teal); // the same color: unchanged
    expect(hsvFromHex("#00ff00", red)).toEqual({ h: 120, s: 1, v: 1 });
    expect(hsvFromHex("garbage")).toEqual({ h: 0, s: 0, v: 0 });
  });

  it("parses typed R / G / B channels", () => {
    expect(parseChannel("0")).toBe(0);
    expect(parseChannel(" 255 ")).toBe(255);
    for (const bad of ["", "256", "-1", "1.5", "abc", "1000"]) expect(parseChannel(bad)).toBeNull();
  });

  it("clamps, also non-numbers", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(Number.NaN, 0, 1)).toBe(0);
  });

  it("keeps recent colors newest first, without repeats, capped", () => {
    let list: string[] = [];
    for (let i = 0; i < RECENT_MAX + 3; i++) list = addRecent(list, rgbToHex([i, 0, 0]));
    expect(list).toHaveLength(RECENT_MAX);
    expect(list[0]).toBe(rgbToHex([RECENT_MAX + 2, 0, 0]));
    list = addRecent(list, list[3].toUpperCase());
    expect(list[0]).toBe(rgbToHex([RECENT_MAX + 2 - 3, 0, 0]));
    expect(new Set(list).size).toBe(list.length);
    expect(addRecent(["#000000"], "nope")).toEqual(["#000000"]);
    expect(parseRecent("#FF0000,junk,#ff0000,#00ff00")).toEqual(["#ff0000", "#00ff00"]);
    expect(parseRecent(null)).toEqual([]);
  });
});
