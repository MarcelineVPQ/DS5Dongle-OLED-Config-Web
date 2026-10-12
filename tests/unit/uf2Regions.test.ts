import { describe, expect, it } from "vitest";
import { UF2_FAMILY_ABSOLUTE, parseUf2Regions } from "../../src/flash";

const RP2350_ARM_S = 0xe48bff59;

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

const uf2 = (...blocks: Uint8Array[]) => {
  const out = new Uint8Array(blocks.length * 512);
  blocks.forEach((b, i) => out.set(b, i * 512));
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
    expect(() => parseUf2Regions(uf2(block(0x10ffff00, UF2_FAMILY_ABSOLUTE, 0xaa)))).toThrow();
  });
});
