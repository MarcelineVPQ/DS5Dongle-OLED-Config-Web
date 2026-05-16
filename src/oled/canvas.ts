// 128x64 monochrome framebuffer drawing primitives.
// Ported from src/oled.cpp (px, rect_outline, rect_filled, draw_char,
// draw_text, draw_icon, flush). Same output bytes → same pixels →
// emulator screens identical to the physical OLED.

import { FONT_5x7, FONT_FIRST_CHAR, FONT_W, FONT_H } from "./font";

export const FB_W = 128;
export const FB_H = 64;

// Display palette — Waveshare's whitish-on-deep-blue look, close to what
// the physical Pico-OLED-1.3 outputs.
const COLOR_ON: [number, number, number]  = [220, 230, 255];
const COLOR_OFF: [number, number, number] = [8,   12,  22];

export function newFramebuffer(): Uint8Array {
  return new Uint8Array(FB_W * FB_H);
}

export function fbClear(fb: Uint8Array): void {
  fb.fill(0);
}

export function px(fb: Uint8Array, x: number, y: number, on = true): void {
  if (x < 0 || x >= FB_W || y < 0 || y >= FB_H) return;
  fb[y * FB_W + x] = on ? 1 : 0;
}

export function rectOutline(fb: Uint8Array, x: number, y: number, w: number, h: number): void {
  for (let i = 0; i < w; i++) {
    px(fb, x + i, y, true);
    px(fb, x + i, y + h - 1, true);
  }
  for (let j = 0; j < h; j++) {
    px(fb, x, y + j, true);
    px(fb, x + w - 1, y + j, true);
  }
}

export function rectFilled(fb: Uint8Array, x: number, y: number, w: number, h: number): void {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      px(fb, x + i, y + j, true);
    }
  }
}

export function drawChar(fb: Uint8Array, x: number, y: number, c: number): void {
  const idx = c - FONT_FIRST_CHAR;
  if (idx < 0 || idx >= FONT_5x7.length) return;
  const glyph = FONT_5x7[idx];
  for (let col = 0; col < FONT_W; col++) {
    const byte = glyph[col];
    for (let row = 0; row < FONT_H; row++) {
      if (byte & (1 << row)) px(fb, x + col, y + row, true);
    }
  }
}

export function drawText(fb: Uint8Array, x: number, y: number, s: string): void {
  for (let i = 0; i < s.length; i++) {
    drawChar(fb, x + i * (FONT_W + 1), y, s.charCodeAt(i));
  }
}

// Bitmap: row-major, MSB = leftmost pixel, ceil(w/8) bytes per row.
// Same layout as src/oled.cpp::draw_icon().
export function drawIcon(
  fb: Uint8Array,
  x: number,
  y: number,
  bitmap: ReadonlyArray<number>,
  w: number,
  h: number,
): void {
  const rowBytes = Math.ceil(w / 8);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const byte = bitmap[row * rowBytes + (col >> 3)];
      const mask = 1 << (7 - (col & 7));
      if (byte & mask) px(fb, x + col, y + row, true);
    }
  }
}

// Battery icon: body 52x8 + small nub on the right. Inside fill scales with pct.
// Direct port of draw_battery_icon() in src/oled.cpp.
export function drawBatteryIcon(fb: Uint8Array, x: number, y: number, pct: number): void {
  rectOutline(fb, x, y, 52, 8);
  rectFilled(fb, x + 52, y + 2, 3, 4);
  let fill = Math.floor((pct * 48) / 100);
  if (fill < 0) fill = 0;
  if (fill > 48) fill = 48;
  if (fill > 0) rectFilled(fb, x + 2, y + 2, fill, 4);
}

// Paint framebuffer to a 128x64 OffscreenCanvas, then drawImage scaled
// onto the display canvas with imageSmoothingEnabled=false for crisp pixels.
export function flush(displayCtx: CanvasRenderingContext2D, fb: Uint8Array): void {
  const { canvas } = displayCtx;
  const off = ensureOffscreen(canvas);
  const offCtx = off.getContext("2d")!;
  const img = offCtx.getImageData(0, 0, FB_W, FB_H);
  const data = img.data;
  for (let i = 0; i < fb.length; i++) {
    const c = fb[i] ? COLOR_ON : COLOR_OFF;
    data[i * 4 + 0] = c[0];
    data[i * 4 + 1] = c[1];
    data[i * 4 + 2] = c[2];
    data[i * 4 + 3] = 255;
  }
  offCtx.putImageData(img, 0, 0);
  displayCtx.imageSmoothingEnabled = false;
  displayCtx.clearRect(0, 0, canvas.width, canvas.height);
  displayCtx.drawImage(off, 0, 0, FB_W, FB_H, 0, 0, canvas.width, canvas.height);
}

const offscreenCache = new WeakMap<HTMLCanvasElement, OffscreenCanvas | HTMLCanvasElement>();
function ensureOffscreen(displayCanvas: HTMLCanvasElement): OffscreenCanvas | HTMLCanvasElement {
  let cached = offscreenCache.get(displayCanvas);
  if (!cached) {
    if (typeof OffscreenCanvas !== "undefined") {
      cached = new OffscreenCanvas(FB_W, FB_H);
    } else {
      cached = document.createElement("canvas");
      cached.width = FB_W;
      cached.height = FB_H;
    }
    offscreenCache.set(displayCanvas, cached);
  }
  return cached;
}
