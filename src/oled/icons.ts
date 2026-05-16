// Pixel-art icon bitmaps, ported from src/oled.cpp's kIcon* tables.
// Row-major, MSB = leftmost pixel.

// 8x8 "link active" filled disc (drawn when DS5 is paired).
export const ICON_LINK_ON: ReadonlyArray<number> = [
  0b00111100,
  0b01111110,
  0b11111111,
  0b11111111,
  0b11111111,
  0b11111111,
  0b01111110,
  0b00111100,
];

// 8x8 "link inactive" hollow disc (drawn when waiting for DS5).
export const ICON_LINK_OFF: ReadonlyArray<number> = [
  0b00111100,
  0b01000010,
  0b10000001,
  0b10000001,
  0b10000001,
  0b10000001,
  0b01000010,
  0b00111100,
];
