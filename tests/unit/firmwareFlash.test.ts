import { beforeAll, describe, expect, it } from "vitest";
import i18n from "../../src/i18n";
import { flash } from "../../src/desktop/firmwareUpdate";
import type { PicoflashHandle } from "../../src/flash";

describe("flash", () => {
  it("writes in sector-aligned pieces and reports progress as it goes", async () => {
    const writes: { addr: number; len: number }[] = [];
    const device = {
      connect: async () => undefined,
      flashEraseAndWrite: async (addr: number, buf: Uint8Array) => void writes.push({ addr, len: buf.byteLength }),
      rebootRp2350: async () => undefined,
      disconnect: async () => undefined,
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

// The board's USB interface, as WebUSB sees it: one claim at a time, held
// until released (a handle that never lets go blocks the next one).
function fakeBoard() {
  const usb = { claimed: false, written: 0, failAtWrite: -1 };
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
      flashEraseAndWrite: async () => {
        if (usb.written++ === usb.failAtWrite) throw new Error("LIBUSB_TRANSFER_TIMED_OUT");
      },
      rebootRp2350: async () => void calls.push("reboot"),
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
    expect((failed as Error).message).toMatch(/stopped before it finished.*BOOTSEL.*install the firmware again/);
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

  it("every language has the message, naming the board without the word dongle", async () => {
    for (const lng of ["en", "de", "fr", "es", "pt-BR", "ja", "zh-CN"]) {
      await i18n.changeLanguage(lng); // the {{device…}} forms follow the app's language
      const text = i18n.t("desktop.firmware.writeFailed");
      expect(text, lng).not.toBe("desktop.firmware.writeFailed");
      expect(text, lng).toMatch(/BOOTSEL/);
      expect(text, lng).not.toMatch(/dongle|\{\{/i);
    }
    await i18n.changeLanguage("en");
  });
});
