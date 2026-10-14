// The simulated board's bootloader keeps the rules a real RP2350 has over
// PICOBOOT (one claimed session, sector-aligned writes inside its 4 MB of
// flash), and reads the new firmware's version the way picotool does.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseUf2Regions } from "../../src/flash";
import { SimulatedBoard, programVersion, FLASH_BASE, FLASH_BYTES } from "../../src/protocol/simulatedBoard";
import { rp2350Uf2 } from "../support/uf2";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// The UF2's flash contents, as the board holds them after a write.
function flashOf(uf2: Uint8Array): Uint8Array {
  const flash = new Uint8Array(FLASH_BYTES).fill(0xff);
  for (const r of parseUf2Regions(uf2.slice().buffer)) flash.set(r.data, r.address - FLASH_BASE);
  return flash;
}

describe("programVersion", () => {
  it("reads the version from the image's binary info", () => {
    expect(programVersion(flashOf(rp2350Uf2("v1.2.3-oled-edition+4.abcdef0")))).toBe("v1.2.3-oled-edition+4.abcdef0");
  });
  it("is null without binary info", () => {
    expect(programVersion(new Uint8Array(FLASH_BYTES).fill(0xff))).toBeNull();
  });
});

describe("the simulated bootloader", () => {
  it("is there only in BOOTSEL; BOOTSEL from the running firmware brings it up", async () => {
    const board = new SimulatedBoard({ speed: "fast" });
    expect(board.bootloader()).toBeNull();
    const dongle = board.dongle()!;
    board.enterBootsel();
    expect(dongle.gone).toBe(true);
    expect(board.state).toBe("away");
    await vi.advanceTimersByTimeAsync(1000);
    expect(board.state).toBe("bootsel");
    expect(board.bootloader()?.getUsbDeviceInfo().vendorId).toBe(0x2e8a);
  });

  it("one session at a time, sector-aligned writes inside the flash", async () => {
    const board = new SimulatedBoard({ state: "bootsel", version: null, speed: "fast" });
    const loader = board.bootloader()!;
    await expect(loader.flashEraseAndWrite(FLASH_BASE, new Uint8Array(0x1000))).rejects.toThrow(/disconnected/);
    await loader.connect();
    await expect(loader.flashEraseAndWrite(FLASH_BASE + 0x100, new Uint8Array(0x1000))).rejects.toThrow(/aligned/);
    await expect(loader.flashEraseAndWrite(FLASH_BASE + FLASH_BYTES, new Uint8Array(0x1000))).rejects.toThrow(/INVALID_ADDRESS/);
    await expect(loader.flashEraseAndWrite(0x20000000, new Uint8Array(0x1000))).rejects.toThrow(/INVALID_ADDRESS/);
    await loader.disconnect();
    expect(loader.isConnected()).toBe(false);
  });

  it("a write starts erasing the old firmware: interrupted, the board has none", async () => {
    const board = new SimulatedBoard({ state: "bootsel", speed: "fast" });
    const loader = board.bootloader()!;
    await loader.connect();
    const run = vi.fn();
    board.onChange(run);
    const write = loader.flashEraseAndWrite(FLASH_BASE, new Uint8Array(0x10000));
    await vi.advanceTimersByTimeAsync(10);
    await write;
    expect(board.version).toBeNull();
    expect(run).toHaveBeenCalled();
  });
});
