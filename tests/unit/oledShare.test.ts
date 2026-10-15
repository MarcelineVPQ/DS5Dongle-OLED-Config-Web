// Share your OLED (src/oled/oledShare.ts): the PNG is pixel-perfect (every
// OLED pixel an exact scale x scale square, the mirror's own colors), the GIF
// decodes back to exactly the recorded pictures, unchanged frames are folded
// into the one before, and the 10 s, frame and size caps hold. Decoded here
// with node's zlib (PNG) and a small GIF decoder written from the spec.
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { GIF_MAX_FRAMES, GIF_MAX_MS, ShareTooBig, buildPalette, dedupeFrames, encodeGif, encodeShare, hasMagic, rasterize, scaleIndices, shareSize, type ShareFrame } from "../../src/oled/oledShare";
import { OLED_OFF, oledLit, oledOnColor } from "../../src/oled/oledPixels";

// A test picture: a checkerboard of 3-pixel squares plus a diagonal, so every
// row and column differs and an off-by-one in scaling or cropping shows.
function picture(seed = 0, contrast = 255, power: ShareFrame["power"] = "on"): ShareFrame {
  const pixels = new Uint8Array(1024);
  // loop: test — 128 x 64 pixels
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 128; x++) {
      const on = ((Math.floor((x + seed) / 3) + Math.floor(y / 3)) & 1) === 1 || x === y + seed;
      if (on) pixels[y * 16 + (x >> 3)] |= 0x80 >> (x & 7);
    }
  return { power, contrast, pixels };
}

// ---- PNG reading (only what encodePng writes: 8-bit indexed, filter 0).
function readPng(bytes: Uint8Array) {
  expect(hasMagic(bytes, "png")).toBe(true);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  let width = 0;
  let height = 0;
  let palette: number[][] = [];
  const idat: Uint8Array[] = [];
  const types: string[] = [];
  // loop: test — the file's chunks
  while (at < bytes.length) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const data = bytes.subarray(at + 8, at + 8 + len);
    types.push(type);
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      expect([...data.subarray(8)]).toEqual([8, 3, 0, 0, 0]);
    }
    // loop: test — palette entries
    if (type === "PLTE") palette = Array.from({ length: len / 3 }, (_, i) => [...data.subarray(i * 3, i * 3 + 3)]);
    if (type === "IDAT") idat.push(data);
    at += 12 + len;
  }
  expect(types).toEqual(["IHDR", "PLTE", "IDAT", "IEND"]);
  const raw = inflateSync(Buffer.concat(idat));
  expect(raw.length).toBe((width + 1) * height);
  // loop: test — every row starts with filter type 0
  for (let y = 0; y < height; y++) expect(raw[y * (width + 1)]).toBe(0);
  const rgb = (x: number, y: number) => palette[raw[y * (width + 1) + 1 + x]];
  return { width, height, palette, rgb };
}

// ---- GIF reading: header, global palette, NETSCAPE loop, frames with their
// delay and rectangle, LZW per the GIF89a spec, drawn over the last frame.
function readGif(bytes: Uint8Array) {
  expect(hasMagic(bytes, "gif")).toBe(true);
  let at = 6;
  const u16 = () => bytes[at++] | (bytes[at++] << 8);
  const width = u16();
  const height = u16();
  const packed = bytes[at++];
  at += 2;
  expect(packed & 0x80).toBe(0x80);
  const size = 1 << ((packed & 7) + 1);
  const palette = Array.from({ length: size }, (_, i) => [...bytes.subarray(at + i * 3, at + i * 3 + 3)]);
  at += size * 3;
  const canvas = new Uint8Array(width * height);
  const frames: Array<{ delayCs: number; indices: Uint8Array; rect: number[] }> = [];
  let loops = false;
  let delay = 0;
  const subBlocks = () => {
    const parts: number[] = [];
    // loop: test — sub-blocks
    for (let n = bytes[at++]; n > 0; n = bytes[at++]) {
      parts.push(...bytes.subarray(at, at + n));
      at += n;
    }
    return parts;
  };
  // loop: test — the file's blocks
  for (;;) {
    const b = bytes[at++];
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = bytes[at++];
      const body = subBlocks();
      if (label === 0xff) loops = String.fromCharCode(...body.slice(0, 11)) === "NETSCAPE2.0";
      if (label === 0xf9) delay = body[1] | (body[2] << 8); // [packed, delay lo, delay hi, transparent index]
      continue;
    }
    expect(b).toBe(0x2c);
    const x = u16();
    const y = u16();
    const w = u16();
    const h = u16();
    expect(bytes[at++]).toBe(0);
    const min = bytes[at++];
    const pixels = lzwDecode(min, subBlocks(), w * h);
    // loop: test — the frame's rows
    for (let r = 0; r < h; r++) canvas.set(pixels.subarray(r * w, (r + 1) * w), (y + r) * width + x);
    frames.push({ delayCs: delay, indices: canvas.slice(), rect: [x, y, w, h] });
  }
  return { width, height, palette, frames, loops };
}

function lzwDecode(min: number, data: number[], count: number): Uint8Array {
  const clear = 1 << min;
  const eoi = clear + 1;
  let size = min + 1;
  let dict: number[][] = [];
  const reset = () => {
    dict = Array.from({ length: clear }, (_, i) => [i]);
    dict.push([], []);
    size = min + 1;
  };
  reset();
  const out: number[] = [];
  let bitPos = 0;
  let prev: number[] | null = null;
  const read = () => {
    let code = 0;
    // loop: test — bits of one code
    for (let i = 0; i < size; i++, bitPos++) if (data[bitPos >> 3] & (1 << (bitPos & 7))) code |= 1 << i;
    return code;
  };
  // loop: test — every code
  for (;;) {
    expect(bitPos + size, "ran out of data before the end code").toBeLessThanOrEqual(data.length * 8);
    const code = read();
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    if (code === eoi) break;
    let entry: number[];
    if (code < dict.length) entry = dict[code];
    else {
      expect(code, "a code the dictionary can't have yet").toBe(dict.length);
      entry = [...prev!, prev![0]];
    }
    out.push(...entry);
    if (prev) {
      if (dict.length < 4096) dict.push([...prev, entry[0]]);
      if (dict.length === 1 << size && size < 12) size++;
    }
    prev = entry;
  }
  expect(out.length).toBe(count);
  return Uint8Array.from(out);
}

const mirrorColor = (f: ShareFrame, x: number, y: number) => (f.power !== "off" && oledLit(f.pixels, x, y) ? [...oledOnColor(f.contrast)] : [...OLED_OFF]);

describe("Share: PNG", () => {
  it("1x, no frame: exactly the 128 x 64 panel in the mirror's colors", async () => {
    const f = picture(0, 127);
    const png = readPng(await encodeShare({ kind: "png", frame: f, scale: 1, framed: false }));
    expect([png.width, png.height]).toEqual([128, 64]);
    // loop: test — every pixel
    for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) expect(png.rgb(x, y)).toEqual(mirrorColor(f, x, y));
  });

  it("4x and 8x: every OLED pixel is an exact scale x scale square (nearest-neighbour)", async () => {
    const f = picture(5);
    for (const scale of [4, 8] as const) {
      const png = readPng(await encodeShare({ kind: "png", frame: f, scale, framed: false }));
      expect([png.width, png.height]).toEqual([128 * scale, 64 * scale]);
      // Counted, not asserted per pixel (half a million pixels).
      let wrong = 0;
      // loop: test — every output pixel
      for (let y = 0; y < png.height; y++)
        for (let x = 0; x < png.width; x++) {
          const got = png.rgb(x, y);
          const want = mirrorColor(f, Math.floor(x / scale), Math.floor(y / scale));
          if (got[0] !== want[0] || got[1] !== want[1] || got[2] !== want[2]) wrong++;
        }
      expect(wrong, `${scale}x`).toBe(0);
    }
  });

  it("the board frame: the panel sits inside it unchanged, the frame is the module's dark board", async () => {
    const f = picture(2);
    const { width, height } = shareSize(4, true);
    expect([width, height]).toEqual([149 * 4, 74 * 4]);
    const png = readPng(await encodeShare({ kind: "png", frame: f, scale: 4, framed: true }));
    expect([png.width, png.height]).toEqual([width, height]);
    const one = rasterize(f, true, buildPalette([f]));
    // Find the panel: the 1x picture's top-left lit pixel matches the unframed one at (16, 5).
    // loop: test — the panel's pixels
    for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) expect(png.rgb((16 + x) * 4 + 1, (5 + y) * 4 + 2)).toEqual(mirrorColor(f, x, y));
    // The corner is the module's edge, never a lit color.
    expect(png.rgb(0, 0)).toEqual([42, 42, 42]);
    expect(one.width * one.height).toBe(149 * 74);
  });

  it("lit pixels are the mirror's color at that brightness (DongleConsole's OledCanvas formula)", () => {
    const mirror = (contrast: number) => [220, 230, 255].map((c) => Math.round(6 + (c - 6) * (0.35 + 0.65 * (contrast / 255))));
    // loop: test — every contrast
    for (let c = 0; c <= 255; c++) expect([...oledOnColor(c)]).toEqual(mirror(c));
  });

  it("a screen that is off is all off; scaleIndices at 1x hands back the same array", async () => {
    const f = picture(0, 255, "off");
    const png = readPng(await encodeShare({ kind: "png", frame: f, scale: 1, framed: false }));
    expect(png.rgb(3, 3)).toEqual([...OLED_OFF]);
    const src = new Uint8Array([1, 2, 3, 4]);
    expect(scaleIndices(src, 2, 2, 1)).toBe(src);
    expect([...scaleIndices(src, 2, 2, 2)]).toEqual([1, 1, 2, 2, 1, 1, 2, 2, 3, 3, 4, 4, 3, 3, 4, 4]);
  });
});

describe("Share: GIF", () => {
  it("decodes back to exactly the recorded pictures, with their times, looping", async () => {
    const shots = [picture(0), picture(1, 127), picture(2, 63)];
    const gif = readGif(
      await encodeShare({
        kind: "gif",
        frames: shots.map((frame, i) => ({ frame, ms: 100 * (i + 1) })),
        scale: 4,
        framed: false,
      }),
    );
    expect(gif.loops).toBe(true);
    expect([gif.width, gif.height]).toEqual([512, 256]);
    expect(gif.frames.map((f) => f.delayCs)).toEqual([10, 20, 30]);
    expect(gif.palette.length).toBeLessThanOrEqual(16);
    shots.forEach((shot, i) => {
      const frame = gif.frames[i];
      // loop: test — sampled pixels across the frame
      for (let y = 0; y < 256; y += 3) for (let x = 0; x < 512; x += 5) expect(gif.palette[frame.indices[y * 512 + x]], `frame ${i} (${x}, ${y})`).toEqual(mirrorColor(shot, x >> 2, y >> 2));
    });
  });

  it("a frame only carries the rectangle that changed", async () => {
    const a = picture(0);
    const b = { ...a, pixels: a.pixels.slice() };
    b.pixels[10 * 16 + 3] ^= 0xff; // row 10, pixels 24-31
    const gif = readGif(
      await encodeShare({
        kind: "gif",
        frames: [
          { frame: a, ms: 100 },
          { frame: b, ms: 100 },
        ],
        scale: 8,
        framed: true,
      }),
    );
    expect(gif.frames[1].rect).toEqual([(16 + 24) * 8, (5 + 10) * 8, 8 * 8, 8]);
  });

  it("an unchanged picture lengthens the frame before it (the frame counter doesn't count)", () => {
    const a = picture(0);
    const same = { ...a, pixels: a.pixels.slice() };
    const b = picture(3);
    const out = dedupeFrames([
      { frame: a, ms: 100 },
      { frame: same, ms: 300 },
      { frame: b, ms: 100 },
      { frame: picture(3), ms: 50 },
    ]);
    expect(out.map((f) => f.ms)).toEqual([400, 150]);
    expect(out[0].frame).toBe(a);
  });

  it("stops at 10 s and at the frame cap", () => {
    const long = dedupeFrames(Array.from({ length: 30 }, (_, i) => ({ frame: picture(i), ms: 500 })));
    expect(long.reduce((n, f) => n + f.ms, 0)).toBe(GIF_MAX_MS);
    expect(long.length).toBe(20);
  });

  it("never encodes more than GIF_MAX_FRAMES frames", async () => {
    const frames = Array.from({ length: GIF_MAX_FRAMES + 30 }, (_, i) => ({ frame: picture(i % 60, 255), ms: 20 }));
    const gif = readGif(await encodeShare({ kind: "gif", frames, scale: 1, framed: false }));
    expect(gif.frames.length).toBe(Math.min(GIF_MAX_FRAMES, GIF_MAX_MS / 20));
  });

  it("over its size cap: ShareTooBig, not a cut-off file", () => {
    const f = picture(0);
    const p = buildPalette([f]);
    const one = rasterize(f, false, p);
    expect(() => encodeGif(128, 64, p.colors, [{ indices: one.indices, delayCs: 10 }], 200)).toThrow(ShareTooBig);
  });

  it("LZW holds up past a full dictionary (noise forces clear codes)", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 16;
    const colors = Array.from({ length: 16 }, (_, i) => [i * 16, i * 8, 255 - i * 16] as const);
    const noise = Uint8Array.from({ length: 300 * 200 }, () => rnd() & 15);
    const gif = readGif(encodeGif(300, 200, colors, [{ indices: noise, delayCs: 5 }]));
    expect([...gif.frames[0].indices]).toEqual([...noise]);
  });

  it("many brightness levels share a small palette", () => {
    const frames = Array.from({ length: 40 }, (_, i) => picture(0, i * 6));
    expect(buildPalette(frames).colors.length).toBeLessThanOrEqual(16);
  });
});
