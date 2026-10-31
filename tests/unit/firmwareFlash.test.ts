import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../src/i18n";
import { flash } from "../../src/desktop/firmwareUpdate";
import type { PicoflashHandle } from "../../src/flash";

describe("flash", () => {
  it("erases the image's first sector first, writes it last, and every other sector once in order", async () => {
    const ops: { op: "erase" | "write"; addr: number; len: number }[] = [];
    const device = {
      connect: async () => undefined,
      flashErase: async (addr: number, len: number) => void ops.push({ op: "erase", addr, len }),
      flashEraseAndWrite: async (addr: number, buf: Uint8Array) => void ops.push({ op: "write", addr, len: buf.byteLength }),
      rebootRp2350: async () => undefined,
      disconnect: async () => undefined,
    } as unknown as PicoflashHandle;
    const data = new Uint8Array(0x10000 * 3 + 0x2000); // 3 full pieces + 2 sectors
    const fractions: number[] = [];
    await flash(device, [{ address: 0x10000000, data }], (p) => p.step === "flashing" && fractions.push(p.fraction ?? -1));
    expect(ops).toEqual([
      { op: "erase", addr: 0x10000000, len: 0x1000 }, // no start block until the very end
      { op: "write", addr: 0x10001000, len: 0x10000 },
      { op: "write", addr: 0x10011000, len: 0x10000 },
      { op: "write", addr: 0x10021000, len: 0x10000 },
      { op: "write", addr: 0x10031000, len: 0x1000 },
      { op: "write", addr: 0x10000000, len: 0x1000 }, // the IMAGE_DEF sector, last
    ]);
    // Every sector of the image written exactly once, nothing outside it.
    const sectors = ops.filter((o) => o.op === "write").flatMap((o) => Array.from({ length: o.len / 0x1000 }, (_, i) => o.addr + i * 0x1000));
    expect([...sectors].sort((a, b) => a - b)).toEqual(Array.from({ length: data.byteLength / 0x1000 }, (_, i) => 0x10000000 + i * 0x1000));
    expect(ops.every((w) => w.addr % 0x1000 === 0 && w.len % 0x1000 === 0)).toBe(true);
    expect(fractions[0]).toBe(0);
    expect(fractions.at(-1)).toBe(1);
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    expect(fractions.length).toBe(6);
  });
});

// The board's USB interface, as WebUSB sees it: one claim at a time, held
// until released (a handle that never lets go blocks the next one).
function fakeBoard() {
  const usb = { claimed: false, written: 0, failAtWrite: -1, failReboot: false };
  const handle = () => {
    let mine = false;
    const calls: string[] = [];
    const device = {
      calls,
      connect: async () => {
        calls.push("connect");
        if (usb.claimed) throw new Error("Failed to claim interface: Unable to claim interface.");
        usb.claimed = mine = true;
      },
      flashErase: async () => undefined,
      flashEraseAndWrite: async () => {
        if (usb.written++ === usb.failAtWrite) throw new Error("LIBUSB_TRANSFER_TIMED_OUT");
      },
      rebootRp2350: async () => {
        calls.push("reboot");
        if (usb.failReboot) throw new Error("LIBUSB_ERROR_IO");
      },
      disconnect: async () => {
        calls.push("disconnect");
        if (mine) usb.claimed = mine = false;
      },
    };
    return device as typeof device & PicoflashHandle;
  };
  return { usb, handle };
}

describe("flash releases the board's update session", () => {
  beforeAll(() => i18n.changeLanguage("en"));
  const firmware = [{ address: 0x10000000, data: new Uint8Array(0x10000 * 3) }];

  it("a write that fails midway: the session is released, the error says what to do, and a retry works", async () => {
    const board = fakeBoard();
    board.usb.failAtWrite = 1; // the second 64 KB piece
    const first = board.handle();
    const failed = await flash(first, firmware, () => undefined).catch((e: Error) => e);
    expect(failed).toBeInstanceOf(Error);
    expect((failed as Error).message).toMatch(/stopped before it finished.*BOOTSEL.*install the firmware again.*hold its BOOTSEL button while plugging it back in/);
    expect((failed as Error).message).not.toMatch(/dongle|LIBUSB|claim/i);
    expect(((failed as Error).cause as Error).message).toBe("LIBUSB_TRANSFER_TIMED_OUT");
    expect(first.calls).toEqual(["connect", "disconnect"]);
    expect(board.usb.claimed).toBe(false);

    // The retry (Setup finds the board in BOOTSEL again) gets the interface.
    board.usb.failAtWrite = -1;
    const retry = board.handle();
    await flash(retry, firmware, () => undefined);
    expect(retry.calls).toEqual(["connect", "reboot", "disconnect"]);
    expect(board.usb.claimed).toBe(false);
  });

  it("only the restart failed: the message says the firmware is written, and the session is released", async () => {
    const board = fakeBoard();
    board.usb.failReboot = true;
    const h = board.handle();
    const failed = await flash(h, firmware, () => undefined).catch((e: Error) => e);
    expect((failed as Error).message).toMatch(/new firmware is written, but restarting .* failed.*unplug it and plug it back in/);
    expect((failed as Error).message).not.toMatch(/dongle|LIBUSB|BOOTSEL/i);
    expect(((failed as Error).cause as Error).message).toBe("LIBUSB_ERROR_IO");
    expect(h.calls).toEqual(["connect", "reboot", "disconnect"]);
    expect(board.usb.claimed).toBe(false);
  });

  it("the fake board refuses a second claim while one is held (the real failure)", async () => {
    // What a session left claimed does to the next handle.
    const board = fakeBoard();
    await board.handle().connect();
    await expect(board.handle().connect()).rejects.toThrow(/Unable to claim interface/);
  });

  it("a failed connect is reported the same way and still released", async () => {
    const board = fakeBoard();
    board.usb.claimed = true; // someone else holds it
    const h = board.handle();
    await expect(flash(h, firmware, () => undefined)).rejects.toThrow(/stopped before it finished/);
    expect(h.calls).toEqual(["connect", "disconnect"]);
  });

  it("every language has the messages, naming the board without the word dongle", async () => {
    for (const lng of ["en", "de", "fr", "es", "pt-BR", "ja", "zh-CN"]) {
      await i18n.changeLanguage(lng); // the {{device…}} forms follow the app's language
      for (const key of ["desktop.firmware.writeFailed", "desktop.firmware.restartFailed"]) {
        const text = i18n.t(key);
        expect(text, lng).not.toBe(key);
        expect(text, lng).not.toMatch(/dongle|\{\{/i);
      }
      expect(i18n.t("desktop.firmware.writeFailed"), lng).toMatch(/BOOTSEL.*BOOTSEL/); // waiting in BOOTSEL; else hold the BOOTSEL button
    }
    await i18n.changeLanguage("en");
  });
});
