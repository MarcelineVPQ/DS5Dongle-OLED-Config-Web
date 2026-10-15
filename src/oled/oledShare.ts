// Share your OLED: what the mirror shows as a pixel-perfect PNG or a short
// animated GIF. Pure and dependency-free, so it runs in the share worker
// (share.worker.ts, off the UI thread) and in tests alike.
//
// Pixel-perfect: the picture is drawn once at 1 pixel per OLED pixel (with
// the board frame, if asked, drawn as pixel art at the same grid), then
// scaled by a whole number, nearest-neighbour: every OLED pixel becomes an
// exact scale x scale square. Colors are the mirror's own (oledPixels.ts).
// Both formats use one small palette (≤ 16 colors): the panel's off color,
// the lit color at each brightness the recording saw, and the frame's.
import { OLED_H, OLED_OFF, OLED_W, oledLit, oledOnColor, type Rgb } from "./oledPixels";

export const SHARE_SCALES = [1, 4, 8] as const;
export type ShareScale = (typeof SHARE_SCALES)[number];

// A GIF records up to 10 s, a frame each time the picture changes (the
// firmware redraws at most 10 times a second, so ≤ 100; the frame cap is a
// backstop). Size caps keep a file shareable (Discord's free limit is 10 MB).
export const GIF_MAX_MS = 10_000;
export const GIF_MAX_FRAMES = 120;
export const GIF_MAX_BYTES = 8 * 1024 * 1024;
export const PNG_MAX_BYTES = 2 * 1024 * 1024;
const MAX_SHADES = 10; // lit colors in one palette (one per brightness seen)

export const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
export const GIF_MAGIC = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] as const; // "GIF89a"

/** The part of a mirror frame (OledFrame) a picture needs. */
export interface ShareFrame {
  power: "on" | "dim" | "off";
  contrast: number;
  pixels: Uint8Array; // 128x64, row-major, 16 bytes per row, MSB = leftmost
}
export interface GifFrame {
  frame: ShareFrame;
  ms: number; // how long it stayed on screen
}
export type ShareRequest = { kind: "png"; frame: ShareFrame; scale: ShareScale; framed: boolean } | { kind: "gif"; frames: GifFrame[]; scale: ShareScale; framed: boolean };

/** The file came out bigger than its cap (`limit` bytes). */
export class ShareTooBig extends Error {
  constructor(readonly limit: number) {
    super(`The file is over ${Math.round(limit / (1024 * 1024))} MB`);
    this.name = "ShareTooBig";
  }
}

// The board frame, as the mirror draws the module (desktop.css .dcon-module:
// the console's --dcon-border edge, --dcon-pcb board, KEY0 / KEY1 caps at the
// panel's left, the panel's dark bezel). The physical module, dark in every theme.
const BORDER: Rgb = [42, 42, 42];
const PCB: Rgb = [16, 20, 24];
const BEZEL: Rgb = [31, 31, 31];
const CAP: Rgb = [74, 80, 88];
const CAP_HI: Rgb = [108, 115, 124];
const FRAME_COLORS = [BORDER, PCB, BEZEL, CAP, CAP_HI] as const;
const [I_OFF, I_BORDER, I_PCB, I_BEZEL, I_CAP, I_CAP_HI] = [0, 1, 2, 3, 4, 5];
const I_SHADE0 = 6;

// The frame's geometry at 1x, in OLED pixels: a 1-pixel edge, the board (wider
// at the left, where the keys sit), a 1-pixel bezel round the panel.
const EDGE = 1;
const BOARD_LEFT = 14;
const BOARD = 3;
const PANEL_X = EDGE + BOARD_LEFT + 1;
const PANEL_Y = EDGE + BOARD + 1;
const FRAMED_W = PANEL_X + OLED_W + 1 + BOARD + EDGE;
const FRAMED_H = PANEL_Y + OLED_H + 1 + BOARD + EDGE;
const KEY_X = EDGE + BOARD_LEFT / 2;
const KEY_Y = [PANEL_Y + 6, PANEL_Y + OLED_H - 7]; // level with the '>' and '<' the firmware draws
const KEY_R2 = 10.5; // a 7-pixel round cap

/** The picture's size in pixels. */
export function shareSize(scale: ShareScale, framed: boolean): { width: number; height: number } {
  return { width: (framed ? FRAMED_W : OLED_W) * scale, height: (framed ? FRAMED_H : OLED_H) * scale };
}

export interface Palette {
  colors: Rgb[];
  shadeOf: (frame: ShareFrame) => number; // the palette index of this frame's lit color
}

/** One palette for every frame: off, the frame's colors, the lit color at each brightness seen. */
export function buildPalette(frames: readonly ShareFrame[]): Palette {
  const contrasts: number[] = [];
  // loop: NOT-WORTH — once per encode, N ≤ GIF_MAX_FRAMES frames
  for (const f of frames) if (f.power !== "off" && !contrasts.includes(f.contrast)) contrasts.push(f.contrast);
  // More brightnesses than fit (a breathing dim dot): the nearest of MAX_SHADES even steps.
  const quantize = contrasts.length > MAX_SHADES;
  const step = (c: number) => Math.round((c / 255) * (MAX_SHADES - 1));
  // loop: NOT-WORTH — once per encode, N ≤ MAX_SHADES levels
  const levels = quantize ? Array.from({ length: MAX_SHADES }, (_, i) => Math.round((i / (MAX_SHADES - 1)) * 255)) : contrasts;
  // loop: NOT-WORTH — once per encode, N ≤ MAX_SHADES levels
  const colors: Rgb[] = [OLED_OFF, ...FRAME_COLORS, ...levels.map(oledOnColor)];
  return {
    colors,
    shadeOf: (f) => (f.power === "off" ? I_OFF : I_SHADE0 + (quantize ? step(f.contrast) : levels.indexOf(f.contrast))),
  };
}

/** The picture at 1x: one palette index per pixel. */
export function rasterize(frame: ShareFrame, framed: boolean, palette: Palette): { width: number; height: number; indices: Uint8Array } {
  const { width, height } = shareSize(1, framed);
  const out = new Uint8Array(width * height);
  const px = framed ? PANEL_X : 0;
  const py = framed ? PANEL_Y : 0;
  if (framed) {
    // loop: NOT-WORTH — once per picture (on demand, in the worker), 149 x 74 pixels
    for (let y = 0; y < height; y++) {
      // loop: NOT-WORTH — once per picture (on demand, in the worker)
      for (let x = 0; x < width; x++) {
        const edge = x < EDGE || y < EDGE || x >= width - EDGE || y >= height - EDGE;
        const bezel = x >= px - 1 && x <= px + OLED_W && y >= py - 1 && y <= py + OLED_H;
        let c = edge ? I_BORDER : bezel ? I_BEZEL : I_PCB;
        // loop: NOT-WORTH — N = 2 keys
        for (const ky of KEY_Y) {
          const d2 = (x - KEY_X) ** 2 + (y - ky) ** 2;
          if (d2 <= KEY_R2) c = x === KEY_X - 1 && y === ky - 1 ? I_CAP_HI : I_CAP;
        }
        out[y * width + x] = c;
      }
    }
  }
  const lit = palette.shadeOf(frame);
  const on = frame.power !== "off";
  // loop: NOT-WORTH — once per picture or recorded frame (on demand, in the worker), 64 rows
  for (let y = 0; y < OLED_H; y++) {
    // loop: NOT-WORTH — 128 pixels a row, once per picture or recorded frame
    for (let x = 0; x < OLED_W; x++) out[(py + y) * width + px + x] = on && oledLit(frame.pixels, x, y) ? lit : I_OFF;
  }
  return { width, height, indices: out };
}

/** Whole-number nearest-neighbour scaling: each pixel becomes a scale x scale square. */
export function scaleIndices(src: Uint8Array, width: number, height: number, scale: number): Uint8Array {
  if (scale === 1) return src;
  const w = width * scale;
  const out = new Uint8Array(w * height * scale);
  // loop: NOT-WORTH — once per picture or recorded frame (on demand, in the worker)
  for (let y = 0; y < height; y++) {
    const row = out.subarray(y * scale * w, (y * scale + 1) * w);
    // loop: NOT-WORTH — once per picture or recorded frame (on demand, in the worker)
    for (let x = 0; x < width; x++) row.fill(src[y * width + x], x * scale, (x + 1) * scale);
    // loop: NOT-WORTH — scale - 1 row copies
    for (let r = 1; r < scale; r++) out.copyWithin((y * scale + r) * w, y * scale * w, (y * scale + 1) * w);
  }
  return out;
}

/** Two frames show the same picture (the frame counter doesn't count). */
export function samePicture(a: ShareFrame, b: ShareFrame): boolean {
  if (a.power !== b.power) return false;
  if (a.power === "off") return true;
  if (a.contrast !== b.contrast || a.pixels.length !== b.pixels.length) return false;
  // loop: HOT-PATH-OK — N = 1024 bytes, once per changed mirror frame (≤ 10/s) while recording only
  for (let i = 0; i < a.pixels.length; i++) if (a.pixels[i] !== b.pixels[i]) return false;
  return true;
}

// ---- PNG: indexed color (one palette, 8 bits per pixel), zlib from the
// platform's CompressionStream (browser, worker and Node alike).

// cache: OK — key=none (the CRC-32 table, 256 entries); invalidated=never (a constant); bound=1 KB
let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  const table = (crcTable ??= Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    // loop: NOT-WORTH — 8 steps per entry, built once
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  }));
  let c = 0xffffffff;
  // loop: NOT-WORTH — once per PNG chunk (on demand, in the worker)
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function zlib(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(data as BodyInit).body!.pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  // loop: NOT-WORTH — 4 letters
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export async function encodePng(width: number, height: number, colors: readonly Rgb[], indices: Uint8Array): Promise<Uint8Array> {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr.set([8, 3, 0, 0, 0], 8); // 8 bits, indexed color, deflate, no filter, no interlace
  const plte = new Uint8Array(colors.length * 3);
  // loop: NOT-WORTH — ≤ 16 palette colors
  colors.forEach((c, i) => plte.set(c, i * 3));
  const raw = new Uint8Array((width + 1) * height); // each row: filter type 0, then its pixels
  // loop: NOT-WORTH — once per picture (on demand, in the worker)
  for (let y = 0; y < height; y++) raw.set(indices.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  const parts = [Uint8Array.from(PNG_MAGIC), chunk("IHDR", ihdr), chunk("PLTE", plte), chunk("IDAT", await zlib(raw)), chunk("IEND", new Uint8Array(0))];
  return concat(parts);
}

// ---- GIF89a: one global palette, loops forever, each frame only the
// rectangle that changed (drawn over the last one), LZW-coded.

class ByteWriter {
  private buf = new Uint8Array(64 * 1024);
  length = 0;
  constructor(private readonly limit: number) {}
  private room(n: number) {
    if (this.length + n > this.limit) throw new ShareTooBig(this.limit);
    if (this.length + n <= this.buf.length) return;
    const next = new Uint8Array(Math.min(this.limit, Math.max(this.buf.length * 2, this.length + n)));
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }
  byte(b: number) {
    this.room(1);
    this.buf[this.length++] = b;
  }
  u16(n: number) {
    this.byte(n & 0xff);
    this.byte((n >> 8) & 0xff);
  }
  bytes(b: ArrayLike<number>) {
    this.room(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }
  result(): Uint8Array {
    return this.buf.slice(0, this.length);
  }
}

// LZW as GIF wants it (variable code size up to 12 bits, no early change),
// written straight out in 255-byte sub-blocks.
function lzw(out: ByteWriter, minCodeSize: number, pixels: Uint8Array) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  // The dictionary: (prefix code, next index) → code; indices are < clear.
  const table = new Int16Array(4096 * clear).fill(-1);
  let size = minCodeSize + 1;
  let next = eoi + 1;
  const block = new Uint8Array(255);
  let fill = 0;
  let acc = 0;
  let bits = 0;
  const flushBlock = () => {
    out.byte(fill);
    out.bytes(block.subarray(0, fill));
    fill = 0;
  };
  const emit = (code: number) => {
    acc |= code << bits;
    bits += size;
    // loop: NOT-WORTH — ≤ 2 bytes per code, on demand in the worker
    while (bits >= 8) {
      block[fill++] = acc & 0xff;
      if (fill === 255) flushBlock();
      acc >>>= 8;
      bits -= 8;
    }
  };
  out.byte(minCodeSize);
  emit(clear);
  let prefix = pixels[0];
  // loop: NOT-WORTH — once per recorded frame's changed pixels, on demand in the worker
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i];
    const key = prefix * clear + k;
    const code = table[key];
    if (code >= 0) {
      prefix = code;
      continue;
    }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      table.fill(-1);
      size = minCodeSize + 1;
      next = eoi + 1;
    } else {
      if (next >= 1 << size) size++;
      table[key] = next++;
    }
    prefix = k;
  }
  emit(prefix);
  // The decoder adds an entry for that last code before it reads the end code.
  if (next === 1 << size && size < 12) size++;
  emit(eoi);
  if (bits > 0) {
    block[fill++] = acc & 0xff;
    if (fill === 255) flushBlock();
  }
  if (fill > 0) flushBlock();
  out.byte(0); // block terminator
}

// The rectangle where b differs from a (null: no difference).
function changedRect(a: Uint8Array | null, b: Uint8Array, width: number, height: number) {
  if (!a) return { x: 0, y: 0, w: width, h: height };
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  // loop: NOT-WORTH — once per recorded frame, on demand in the worker
  for (let y = 0; y < height; y++) {
    // loop: NOT-WORTH — once per recorded frame, on demand in the worker
    for (let x = 0; x < width; x++) {
      if (a[y * width + x] === b[y * width + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export interface GifImage {
  indices: Uint8Array; // width x height palette indices
  delayCs: number; // hundredths of a second
}

export function encodeGif(width: number, height: number, colors: readonly Rgb[], frames: readonly GifImage[], limit = GIF_MAX_BYTES): Uint8Array {
  const bits = Math.max(1, Math.ceil(Math.log2(Math.max(2, colors.length))));
  const tableSize = 1 << bits;
  const out = new ByteWriter(limit);
  out.bytes(GIF_MAGIC);
  out.u16(width);
  out.u16(height);
  out.byte(0x80 | ((bits - 1) << 4) | (bits - 1)); // a global color table of 2^bits colors
  out.byte(0); // background: index 0 (the panel's off color)
  out.byte(0);
  // loop: NOT-WORTH — ≤ 16 palette entries
  for (let i = 0; i < tableSize; i++) out.bytes(colors[i] ?? [0, 0, 0]);
  // Loop forever (NETSCAPE2.0).
  out.bytes([0x21, 0xff, 0x0b, ...Array.from("NETSCAPE2.0", (c) => c.charCodeAt(0)), 0x03, 0x01, 0x00, 0x00, 0x00]);
  let prev: Uint8Array | null = null;
  // loop: NOT-WORTH — once per recorded frame (≤ GIF_MAX_FRAMES), on demand in the worker
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    // An unchanged frame only lengthens the last one: still draw a 1-pixel frame to keep its time.
    const rect = changedRect(prev, f.indices, width, height) ?? { x: 0, y: 0, w: 1, h: 1 };
    const delay = Math.max(2, Math.min(0xffff, Math.round(f.delayCs)));
    out.bytes([0x21, 0xf9, 0x04, 0x04, delay & 0xff, delay >> 8, 0x00, 0x00]); // keep the last frame under it, delay, no transparency
    out.byte(0x2c);
    out.u16(rect.x);
    out.u16(rect.y);
    out.u16(rect.w);
    out.u16(rect.h);
    out.byte(0); // no local color table, not interlaced
    const crop = new Uint8Array(rect.w * rect.h);
    // loop: NOT-WORTH — the changed rows, once per recorded frame
    for (let y = 0; y < rect.h; y++) crop.set(f.indices.subarray((rect.y + y) * width + rect.x, (rect.y + y) * width + rect.x + rect.w), y * rect.w);
    lzw(out, Math.max(2, bits), crop);
    prev = f.indices;
  }
  out.byte(0x3b);
  return out.result();
}

/** The file Share asked for (in the worker): a PNG or a GIF, within its size cap. */
export async function encodeShare(req: ShareRequest): Promise<Uint8Array> {
  if (req.kind === "png") {
    const palette = buildPalette([req.frame]);
    const one = rasterize(req.frame, req.framed, palette);
    const png = await encodePng(one.width * req.scale, one.height * req.scale, palette.colors, scaleIndices(one.indices, one.width, one.height, req.scale));
    if (png.length > PNG_MAX_BYTES) throw new ShareTooBig(PNG_MAX_BYTES);
    return png;
  }
  const frames = dedupeFrames(req.frames).slice(0, GIF_MAX_FRAMES);
  if (frames.length === 0) throw new Error("Nothing was recorded");
  // loop: NOT-WORTH — once per encode, N ≤ GIF_MAX_FRAMES
  const palette = buildPalette(frames.map((f) => f.frame));
  const { width, height } = shareSize(req.scale, req.framed);
  // loop: NOT-WORTH — once per recorded frame (≤ GIF_MAX_FRAMES), on demand in the worker
  const images = frames.map(({ frame, ms }) => {
    const one = rasterize(frame, req.framed, palette);
    return { indices: scaleIndices(one.indices, one.width, one.height, req.scale), delayCs: ms / 10 };
  });
  return encodeGif(width, height, palette.colors, images);
}

/** Recorded frames with repeats folded into the frame before (its time grows), the total cut at GIF_MAX_MS. */
export function dedupeFrames(frames: readonly GifFrame[]): GifFrame[] {
  const out: GifFrame[] = [];
  let total = 0;
  // loop: NOT-WORTH — once per encode, N ≤ GIF_MAX_FRAMES
  for (const f of frames) {
    const ms = Math.max(0, Math.min(f.ms, GIF_MAX_MS - total));
    if (ms <= 0) break;
    total += ms;
    const last = out.at(-1);
    if (last && samePicture(last.frame, f.frame)) last.ms += ms;
    else out.push({ frame: f.frame, ms });
  }
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  // loop: NOT-WORTH — 5 PNG chunks
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  // loop: NOT-WORTH — 5 PNG chunks
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Whether bytes start with a PNG's or a GIF's signature (the main process checks before saving). */
export function hasMagic(bytes: Uint8Array, kind: "png" | "gif"): boolean {
  const magic = kind === "png" ? PNG_MAGIC : GIF_MAGIC;
  // loop: NOT-WORTH — ≤ 8 signature bytes
  return bytes.length > magic.length && magic.every((b, i) => bytes[i] === b);
}
