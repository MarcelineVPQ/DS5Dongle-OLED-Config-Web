import { describe, expect, it } from "vitest";
import { UF2_FAMILY_ABSOLUTE, Uf2FileError, parseUf2Regions } from "../../src/flash";

const RP2350_ARM_S = 0xe48bff59;
const RP2040 = 0xe48bff56;

// One 512-byte UF2 block carrying 256 bytes of `fill`.
function block(address: number, family: number, fill: number, flags = 0x2000): Uint8Array {
  const b = new Uint8Array(512);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x0a324655, true);
  v.setUint32(4, 0x9e5d5157, true);
  v.setUint32(8, flags, true);
  v.setUint32(12, address, true);
  v.setUint32(16, 256, true);
  v.setUint32(28, family, true);
  v.setUint32(508, 0x0ab16f30, true);
  b.fill(fill, 32, 32 + 256);
  return b;
}

// The blocks as one file: each numbered within its family, with the family's count.
const uf2 = (...blocks: Uint8Array[]) => {
  const out = new Uint8Array(blocks.length * 512);
  const family = (b: Uint8Array) => new DataView(b.buffer).getUint32(28, true);
  blocks.forEach((b, i) => {
    const v = new DataView(b.buffer);
    const same = blocks.filter((x) => family(x) === family(b));
    v.setUint32(20, same.indexOf(b), true);
    v.setUint32(24, same.length, true);
    out.set(b, i * 512);
  });
  return out.buffer;
};

describe("parseUf2Regions", () => {
  it("leaves out the RP2350 absolute block (0x10ffff00), writing only the firmware", () => {
    const regions = parseUf2Regions(uf2(block(0x10ffff00, UF2_FAMILY_ABSOLUTE, 0xaa), block(0x10000000, RP2350_ARM_S, 1), block(0x10000100, RP2350_ARM_S, 2)));
    expect(regions).toHaveLength(1);
    expect(regions[0].address).toBe(0x10000000);
    expect(regions[0].data.byteLength).toBe(0x1000); // padded to one sector
    expect(regions[0].data[0]).toBe(1);
    expect(regions[0].data[256]).toBe(2);
    expect(regions[0].data[512]).toBe(0xff);
  });

  it("leaves out blocks flagged as not main flash", () => {
    const regions = parseUf2Regions(uf2(block(0x10000000, RP2350_ARM_S, 1), block(0x20000000, RP2350_ARM_S, 9, 0x2001)));
    expect(regions.map((r) => r.address)).toEqual([0x10000000]);
  });

  it("refuses a UF2 with nothing to write", () => {
    expect(() => parseUf2Regions(uf2(block(0x10ffff00, UF2_FAMILY_ABSOLUTE, 0xaa)))).toThrow(Uf2FileError);
  });

  it("refuses another chip's firmware (an RP2040 UF2) before anything is written", () => {
    expect(() => parseUf2Regions(uf2(block(0x10000000, RP2040, 1), block(0x10000100, RP2040, 2)))).toThrow(/not an RP2350/);
  });

  it("refuses a file with blocks missing (cut off) or a bad block", () => {
    const whole = new Uint8Array(uf2(block(0x10000000, RP2350_ARM_S, 1), block(0x10000100, RP2350_ARM_S, 2), block(0x10000200, RP2350_ARM_S, 3)));
    expect(() => parseUf2Regions(whole.slice(0, 1024).buffer)).toThrow(/2 of its 3 blocks/);
    const twice = whole.slice();
    twice.set(whole.subarray(0, 512), 512); // block 0 again in place of block 1
    expect(() => parseUf2Regions(twice.buffer)).toThrow(Uf2FileError);
    const badMagic = whole.slice();
    badMagic[0] ^= 0xff;
    expect(() => parseUf2Regions(badMagic.buffer)).toThrow(/magic/);
    expect(parseUf2Regions(whole.buffer)).toHaveLength(1);
  });
});
