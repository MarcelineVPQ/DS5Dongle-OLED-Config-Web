// How the OLED's pixels look, in one place: the mirror on the Pico 2 W page
// (DongleConsole.tsx) and Share (oledShare.ts) draw with the same colors, so a
// shared picture is exactly what the mirror shows. A physical thing drawn as it
// really looks (the Waveshare panel), so dark in every theme.

export type Rgb = readonly [number, number, number];

export const OLED_W = 128;
export const OLED_H = 64;
export const OLED_ROW_BYTES = OLED_W / 8; // 1 bit per pixel, MSB = leftmost

// Waveshare's whitish pixels on near-black, as on the panel.
export const OLED_ON: Rgb = [220, 230, 255];
export const OLED_OFF: Rgb = [6, 8, 14];

// The panel's contrast as brightness, never fully black when lit (the lowest
// steps are still readable on the real panel). The mirror's render loop
// (DongleConsole.tsx OledCanvas) has the same formula inline; the Share
// tests check a shared picture's colors against this.
export const oledLevel = (contrast: number) => 0.35 + 0.65 * (contrast / 255);

// A lit pixel's color at this contrast, exactly as the mirror paints it
// (which blends every channel from the off color's red value).
export const oledOnColor = (contrast: number): Rgb => {
  const level = oledLevel(contrast);
  // loop: NOT-WORTH — 3 channels, once per palette
  return OLED_ON.map((c) => Math.round(OLED_OFF[0] + (c - OLED_OFF[0]) * level)) as unknown as Rgb;
};

// Whether pixel (x, y) of a 128x64 frame buffer is lit.
export const oledLit = (pixels: Uint8Array, x: number, y: number) => (pixels[y * OLED_ROW_BYTES + (x >> 3)] & (0x80 >> (x & 7))) !== 0;
