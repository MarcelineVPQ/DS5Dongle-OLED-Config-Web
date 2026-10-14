// A made-up RP2350 firmware as a UF2 file, laid out like a pico-sdk build:
// the absolute block first (0x10ffff00, skipped when flashing), then the image
// at 0x10000000 with the binary info header at 292 and the IMAGE_DEF block at
// 312 of its first sector (where real builds have them), and the program
// version string in the binary info (what picotool and the simulated board
// read). Nothing in it runs; it only has to look like firmware.
const FAMILY_RP2350_ARM_S = 0xe48bff59;
const FAMILY_RP2040 = 0xe48bff56;
const FAMILY_ABSOLUTE = 0xe48bff57;
const BASE = 0x10000000;

export function rp2350Uf2(version: string, opts: { size?: number; family?: "rp2350" | "rp2040"; imageDef?: boolean } = {}): Uint8Array {
  const size = opts.size ?? 256 * 1024;
  const image = new Uint8Array(size);
  for (let i = 0; i < size; i++) image[i] = (i * 31 + 7) & 0xff;
  const v = new DataView(image.buffer);
  const at = (addr: number) => addr - BASE;
  // Binary info: header -> a table of entry pointers -> the version entry -> its string.
  const table = BASE + 0x1000;
  const entry = BASE + 0x1100;
  const text = BASE + 0x1200;
  v.setUint32(292, 0x7188ebf2, true);
  v.setUint32(296, table, true);
  v.setUint32(300, table + 4, true);
  v.setUint32(304, 0, true);
  v.setUint32(308, 0xe71aa390, true);
  v.setUint32(312, opts.imageDef === false ? 0 : 0xffffded3, true);
  v.setUint32(at(table), entry, true);
  v.setUint32(at(entry), (0x5052 << 16) | 6, true);
  v.setUint32(at(entry) + 4, 0x11a9bc3a, true);
  v.setUint32(at(entry) + 8, text, true);
  const s = new TextEncoder().encode(version);
  image.set(s, at(text));
  image[at(text) + s.length] = 0;

  const family = opts.family === "rp2040" ? FAMILY_RP2040 : FAMILY_RP2350_ARM_S;
  const count = Math.ceil(size / 256);
  const out = new Uint8Array((count + 1) * 512);
  const block = (index: number, addr: number, fam: number, blockNo: number, total: number, payload: Uint8Array) => {
    const b = new DataView(out.buffer, index * 512, 512);
    b.setUint32(0, 0x0a324655, true);
    b.setUint32(4, 0x9e5d5157, true);
    b.setUint32(8, 0x2000, true);
    b.setUint32(12, addr, true);
    b.setUint32(16, 256, true);
    b.setUint32(20, blockNo, true);
    b.setUint32(24, total, true);
    b.setUint32(28, fam, true);
    out.set(payload, index * 512 + 32);
    b.setUint32(508, 0x0ab16f30, true);
  };
  block(0, 0x10ffff00, FAMILY_ABSOLUTE, 0, 1, new Uint8Array(256).fill(0xef));
  for (let i = 0; i < count; i++) block(i + 1, BASE + i * 256, family, i, count, image.subarray(i * 256, i * 256 + 256));
  return out;
}
