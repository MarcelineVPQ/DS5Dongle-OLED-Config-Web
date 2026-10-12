import { describe, expect, it } from "vitest";
import { PROFILE_CURVE_TYPES, ProfileCurveSchema } from "../../src/desktop/games/library";
import {
  CURVE_PRESETS,
  CURVE_TYPES,
  DEFAULT_CURVES,
  DEFAULT_CUSTOM_POINTS,
  PRESET_EXPONENT,
  applyCurve,
  curveAt,
  decodeCurve,
  decodeCurvesReport,
  encodeCurve,
  isValidCurve,
  movePoint,
  strictCurve,
  type StickCurve,
} from "../../src/protocol/stickCurve";

const preset = (type: StickCurve["type"]): StickCurve => ({ type, points: DEFAULT_CUSTOM_POINTS });
const customStep: StickCurve = {
  type: "custom",
  points: [
    [0, 40],
    [64, 64],
    [128, 200],
    [255, 255],
  ],
};
const CURVES: Record<string, StickCurve> = {
  precise: preset("precise"),
  steady: preset("steady"),
  aggressive: preset("aggressive"),
  digital: preset("digital"),
  customDefault: { type: "custom", points: DEFAULT_CUSTOM_POINTS },
  customStep,
};

// [x in, y in, x out, y out], computed by compiling the firmware's
// src/stick_curve.h on a PC (stick_curve_apply).
const FIRMWARE_SAMPLES: Record<string, number[][]> = {
  precise: [
    [128, 128, 128, 128],
    [140, 128, 130, 128],
    [160, 128, 139, 128],
    [200, 128, 174, 128],
    [255, 128, 255, 128],
    [0, 128, 0, 128],
    [128, 0, 128, 0],
    [170, 90, 150, 108],
    [60, 200, 72, 187],
    [220, 220, 220, 220],
    [129, 127, 128, 128],
  ],
  steady: [
    [140, 128, 133, 128],
    [160, 128, 148, 128],
    [200, 128, 187, 128],
    [170, 90, 160, 99],
    [60, 200, 66, 194],
    [129, 127, 128, 128],
  ],
  aggressive: [
    [140, 128, 159, 128],
    [160, 128, 184, 128],
    [200, 128, 218, 128],
    [170, 90, 186, 75],
    [60, 200, 53, 208],
    [129, 127, 132, 124],
  ],
  digital: [
    [140, 128, 191, 128],
    [160, 128, 212, 128],
    [200, 128, 235, 128],
    [170, 90, 202, 61],
    [60, 200, 47, 214],
    [129, 127, 139, 117],
  ],
  customDefault: [
    [140, 128, 135, 128],
    [160, 128, 149, 128],
    [200, 128, 190, 128],
    [170, 90, 161, 98],
    [60, 200, 64, 196],
    [129, 127, 129, 127],
  ],
  customStep: [
    [140, 128, 152, 128],
    [160, 128, 160, 128],
    [200, 128, 231, 128],
    [170, 90, 191, 71],
    [60, 200, 49, 212],
    [129, 127, 143, 113],
  ],
};
// FNV-1a over the output bytes for every (x, y) 0..255, from the firmware's code.
const FIRMWARE_HASH: Record<string, number> = {
  precise: 4148090507,
  steady: 2271996083,
  aggressive: 907744103,
  digital: 4165919479,
  customDefault: 2090334541,
  customStep: 4148320443,
};

describe("stick curve math matches the firmware (src/stick_curve.h)", () => {
  it.each(Object.keys(FIRMWARE_SAMPLES))("%s: sample points", (name) => {
    for (const [x, y, ox, oy] of FIRMWARE_SAMPLES[name]) expect(applyCurve(x, y, CURVES[name])).toEqual([ox, oy]);
  });

  it.each(Object.keys(FIRMWARE_HASH))("%s: every stick position", (name) => {
    let h = 2166136261;
    for (let x = 0; x < 256; x++)
      for (let y = 0; y < 256; y++) {
        const [ox, oy] = applyCurve(x, y, CURVES[name]);
        h = Math.imul(h ^ ox, 16777619) >>> 0;
        h = Math.imul(h ^ oy, 16777619) >>> 0;
      }
    expect(h).toBe(FIRMWARE_HASH[name]);
  });

  it("Linear passes everything through", () => {
    for (const [x, y] of [
      [0, 0],
      [128, 128],
      [140, 100],
      [255, 255],
    ])
      expect(applyCurve(x, y, DEFAULT_CURVES[0])).toEqual([x, y]);
  });

  it("presets follow their exponent and keep the direction", () => {
    for (const type of CURVE_PRESETS) {
      if (type === "linear") continue;
      const g = PRESET_EXPONENT[type];
      for (const t of [0.1, 0.25, 0.5, 0.8]) expect(curveAt(preset(type), t)).toBeCloseTo(t ** g, 1);
    }
    // Precise slows a half tilt down, Aggressive speeds it up, along the same direction.
    const [px, py] = applyCurve(128 + 45, 128 - 45, preset("precise"));
    expect(px - 128).toBeLessThan(45);
    expect(px - 128).toBe(128 - py);
    const [ax] = applyCurve(128 + 45, 128, preset("aggressive"));
    expect(ax - 128).toBeGreaterThan(45);
  });
});

describe("stick curve codec", () => {
  it("round-trips the 9 wire bytes", () => {
    expect(encodeCurve(customStep)).toEqual([5, 0, 40, 64, 64, 128, 200, 255, 255]);
    expect(decodeCurve(encodeCurve(customStep))).toEqual(customStep);
    expect(decodeCurve(encodeCurve(preset("digital")))).toEqual(preset("digital"));
  });

  it("reads erased flash and refused curves as Linear, like the firmware", () => {
    expect(decodeCurve(new Array(9).fill(0xff))).toEqual({ type: "linear", points: DEFAULT_CUSTOM_POINTS });
    expect(strictCurve([5, 100, 0, 50, 0, 150, 0, 200, 0])).toBeNull(); // x decreasing
    expect(strictCurve([6, 0, 0, 0, 0, 0, 0, 0, 0])).toBeNull();
    expect(decodeCurve([5, 100, 0, 50, 0, 150, 0, 200, 0]).type).toBe("linear");
  });

  it("validates custom points", () => {
    expect(isValidCurve(customStep)).toBe(true);
    expect(
      isValidCurve({
        type: "custom",
        points: [
          [10, 50],
          [20, 40],
          [30, 60],
          [40, 70],
        ],
      }),
    ).toBe(false);
    expect(
      isValidCurve({
        type: "precise",
        points: [
          [10, 50],
          [20, 40],
          [30, 60],
          [40, 70],
        ],
      }),
    ).toBe(true); // presets ignore the points
    expect(
      isValidCurve({
        type: "custom",
        points: [
          [10, 50],
          [20, 60],
          [30, 70],
          [40, 256],
        ],
      }),
    ).toBe(false);
  });

  it("keeps a dragged point between its neighbours", () => {
    const p = movePoint(DEFAULT_CUSTOM_POINTS, 1, 300, -5);
    expect(p[1]).toEqual([153, 31]);
    expect(isValidCurve({ type: "custom", points: p })).toBe(true);
    expect(movePoint(DEFAULT_CUSTOM_POINTS, 3, 999, 999)[3]).toEqual([255, 255]);
  });

  it("decodes the 0xEC report", () => {
    const r = decodeCurvesReport(new Uint8Array([0x43, 0x56, 1, 2, 1, ...encodeCurve(preset("precise")), ...encodeCurve(DEFAULT_CURVES[1]), ...encodeCurve(customStep), ...encodeCurve(customStep)]));
    expect(r).toEqual({ slot: 2, temporary: true, saved: [preset("precise"), DEFAULT_CURVES[1]], active: [customStep, customStep] });
    expect(decodeCurvesReport(new Uint8Array(10))).toBeNull();
  });
});

describe("game profile stick curves", () => {
  it("the profile schema knows the same curve types as the protocol", () => {
    expect([...PROFILE_CURVE_TYPES]).toEqual([...CURVE_TYPES]);
  });
  it("accepts presets and valid custom curves, refuses decreasing points", () => {
    const ok = ProfileCurveSchema.safeParse({ type: "custom", points: customStep.points });
    expect(ok.success).toBe(true);
    expect(ProfileCurveSchema.safeParse({ type: "precise", points: DEFAULT_CUSTOM_POINTS }).success).toBe(true);
    expect(
      ProfileCurveSchema.safeParse({
        type: "custom",
        points: [
          [50, 0],
          [40, 10],
          [60, 20],
          [70, 30],
        ],
      }).success,
    ).toBe(false);
    expect(ProfileCurveSchema.safeParse({ type: "wobbly", points: DEFAULT_CUSTOM_POINTS }).success).toBe(false);
  });
});
