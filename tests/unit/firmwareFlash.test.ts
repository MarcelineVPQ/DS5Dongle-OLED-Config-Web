import { describe, expect, it } from "vitest";
import { flash } from "../../src/desktop/firmwareUpdate";
import type { PicoflashHandle } from "../../src/flash";

describe("flash", () => {
  it("writes in sector-aligned pieces and reports progress as it goes", async () => {
    const writes: { addr: number; len: number }[] = [];
    const device = {
      connect: async () => undefined,
      flashEraseAndWrite: async (addr: number, buf: Uint8Array) => void writes.push({ addr, len: buf.byteLength }),
      rebootRp2350: async () => undefined,
    } as unknown as PicoflashHandle;
    const data = new Uint8Array(0x10000 * 3 + 0x2000); // 3 full pieces + 2 sectors
    const fractions: number[] = [];
    await flash(device, [{ address: 0x10000000, data }], (p) => p.step === "flashing" && fractions.push(p.fraction ?? -1));
    expect(writes).toEqual([
      { addr: 0x10000000, len: 0x10000 },
      { addr: 0x10010000, len: 0x10000 },
      { addr: 0x10020000, len: 0x10000 },
      { addr: 0x10030000, len: 0x2000 },
    ]);
    expect(writes.every((w) => w.addr % 0x1000 === 0 && w.len % 0x1000 === 0)).toBe(true);
    expect(fractions[0]).toBe(0);
    expect(fractions.at(-1)).toBe(1);
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    expect(fractions.length).toBe(5);
  });
});
