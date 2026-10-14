// The color math behind HDR lighting (HdrGlow.tsx), kept apart so it can be
// tested. The glow's canvas (rgba16float, extended tone mapping, color space
// "srgb") holds extended sRGB: sRGB-encoded values where 1.0 is SDR white and
// more is brighter. All brightness math is done in linear light and encoded
// once, in the shader, at the end.

/** Linear light per nit: the canvas's SDR white (1.0) is the BT.2408
 *  reference white, Chromium's SDR white level. */
export const SDR_WHITE_NITS = 203;

/** sRGB-encoded (0..1) to linear light. */
export const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

// The controller's RGB LED is more saturated than sRGB's primaries: its color
// is read as Display P3 (the wide gamut HDR displays cover), which in scRGB
// puts a pure LED color slightly outside sRGB (a channel goes below 0).
// Neutral colors are unchanged (each row adds up to 1).
const P3_TO_SRGB = [
  [1.2249401, -0.2249404, 0],
  [-0.0420569, 1.0420571, 0],
  [-0.0196376, -0.0786361, 1.0982735],
];

/** The LED's color as linear light with its brightest channel at 1: the
 *  shader scales it to the peak, so every channel keeps its share (the hue
 *  stays; no channel clips ahead of the others and drifts it toward white).
 *  `rgb` is sRGB-encoded 0..255. */
export function ledLinear(rgb: readonly number[]): [number, number, number] {
  const lin = rgb.map((c) => toLinear(c / 255));
  // loop: HOT-PATH-OK — 3 x 3 matrix per HDR glow redraw (on change, not per frame)
  const wide = P3_TO_SRGB.map((row) => row.reduce((sum, k, i) => sum + k * lin[i], 0));
  const top = Math.max(...wide);
  return top > 0 ? (wide.map((c) => c / top) as [number, number, number]) : [0, 0, 0];
}

/** How bright the strips (core) and their glow (halo) are, in multiples of
 *  SDR white, for a display peak in nits. The halo stays below the core and
 *  never adds to it (the shader takes the larger of the two). */
export function hdrBoost(nits: number): { core: number; halo: number } {
  const core = Math.max(1, nits / SDR_WHITE_NITS);
  return { core, halo: Math.min(core * 0.35, 3) };
}
