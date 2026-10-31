// The write rule (DESIGN_FIRMWARE_IDENTITY §1.2, §9 decision 4): before
// anything is erased the app reads the board in BOOTSEL (chip, package, flash
// size) and writes only the image built for it. Driven through the simulated
// bootloader with constructed PICOBOOT replies (SimSilicon); the decoders are
// also checked on hand-made reply bytes. The reply values are the design's
// reading of picotool and the SDK headers, UNVERIFIED on the owner's board
// until step 5H.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import i18n from "../../src/i18n";
import { checkBoard, installFirmware } from "../../src/desktop/firmwareUpdate";
import type { LatestFirmware } from "../../src/desktop/api";
import { SimulatedBoard, type SimSilicon } from "../../src/protocol/simulatedBoard";
import { chipFromGpios, decodeChipInfo, otpFlashBytes, probeFlashBytes } from "../../src/flash/boardRead";
import { translateKeyed } from "../../src/errorText";
import { rp2350Uf2 } from "../support/uf2";

const MB = 1024 * 1024;
const shown: LatestFirmware = { version: "0.9.5", source: "bundled", board: "pico2_w" };
const file = rp2350Uf2("v0.9.5-oled-edition+0.abc1234");

beforeAll(async () => {
  await i18n.changeLanguage("en");
  vi.stubGlobal("window", {
    desktop: { setFirmwareWriting: () => undefined, downloadFirmware: async (s: LatestFirmware) => ({ ok: true, version: s.version, bytes: file }) },
  });
});
afterAll(() => vi.unstubAllGlobals());

// A board in BOOTSEL with this silicon; `blank`: nothing in its flash.
function bootsel(silicon: Partial<SimSilicon> = {}, blank = false) {
  const board = new SimulatedBoard({ state: "bootsel", version: blank ? null : undefined, speed: "fast", silicon });
  const loader = board.bootloader()!;
  const erase = vi.spyOn(loader, "flashErase");
  const write = vi.spyOn(loader, "flashEraseAndWrite");
  const nothingWritten = () => {
    expect(erase).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(board.flash).toBeNull();
    expect(board.claimed).toBeNull(); // the read session was released
  };
  return { board, loader, write, nothingWritten };
}
// What the user reads: the refusals are keyed errors, said in their language.
const inWords = (e: Error) => translateKeyed(e.message, (key, params) => i18n.t(key, { ...params, interpolation: { escapeValue: false } }));
const said = (p: Promise<unknown>) => p.then((v) => `resolved ${String(v)}`, inWords);
const install = (loader: ReturnType<typeof bootsel>["loader"], ask: (() => Promise<boolean>) | null = null) => installFirmware(loader, shown, () => undefined, ask);

describe("the write rule in BOOTSEL", () => {
  it("an RP2350A with 4 MB (a Pico 2 W): the write goes ahead", async () => {
    const b = bootsel();
    await expect(install(b.loader)).resolves.toBe("0.9.5");
    expect(b.write).toHaveBeenCalled();
    expect(b.board.flash).not.toBeNull();
  });

  it("an RP2350B: refused with the real reason, nothing written", async () => {
    const b = bootsel({ packageId: 0 });
    expect(await said(install(b.loader))).toBe("This board has an RP2350B chip, and this firmware is for the Pico 2 W (RP2350A). Nothing was written.");
    b.nothingWritten();
  });

  it("an RP2040 (Pico / Pico W): refused, nothing written", async () => {
    const b = bootsel({ productId: 0x0003 });
    expect(await said(install(b.loader))).toBe("This board has an RP2040 chip (a Pico or Pico W). The app can't install firmware on it yet. Nothing was written.");
    b.nothingWritten();
  });

  it("2 MB of flash (measured by the probe): refused, nothing written", async () => {
    const b = bootsel({ flashBytes: 2 * MB });
    expect(await said(install(b.loader))).toBe("This board has 2 MB of flash, and this firmware needs 4 MB. Nothing was written.");
    b.nothingWritten();
  });

  it("2 MB set in OTP on a blank chip: refused, nothing written", async () => {
    const b = bootsel({ otpFlashBytes: 2 * MB }, true);
    expect(await said(install(b.loader))).toMatch(/has 2 MB of flash.*Nothing was written/);
    b.nothingWritten();
  });

  it("4 MB set in OTP on a blank chip: no question, the write goes ahead", async () => {
    const b = bootsel({ otpFlashBytes: 4 * MB }, true);
    const ask = vi.fn(async () => false);
    await expect(install(b.loader, ask)).resolves.toBe("0.9.5");
    expect(ask).not.toHaveBeenCalled();
  });

  it("a blank RP2350A whose size can't be read: asks first; Cancel writes nothing", async () => {
    const b = bootsel({}, true);
    const ask = vi.fn(async () => false);
    await expect(install(b.loader, ask)).resolves.toBeNull();
    expect(ask).toHaveBeenCalledOnce();
    b.nothingWritten();
  });

  it("a blank RP2350A whose size can't be read: Install writes", async () => {
    const b = bootsel({}, true);
    await expect(install(b.loader, async () => true)).resolves.toBe("0.9.5");
    expect(b.write).toHaveBeenCalled();
  });

  it("a blank board with no one to ask (an update from the running firmware): refused, nothing written", async () => {
    const b = bootsel({}, true);
    expect(await said(checkBoard(b.loader, shown, null))).toMatch(/couldn't read how much flash .* has, so nothing was written/);
    b.nothingWritten();
  });

  it("a blank RP2350B is refused before anyone is asked", async () => {
    const b = bootsel({ packageId: 0 }, true);
    const ask = vi.fn(async () => true);
    expect(await said(install(b.loader, ask))).toMatch(/RP2350B chip/);
    expect(ask).not.toHaveBeenCalled();
    b.nothingWritten();
  });

  // picotool: on A2 silicon GET_INFO's package_id is wrong; OTP NUM_GPIOS decides.
  it("A2 silicon: the package comes from OTP NUM_GPIOS, not package_id", async () => {
    const a = bootsel({ romVersion: 2, packageId: 0, numGpios: 30 }); // package_id says QFN80: ignored
    await expect(install(a.loader)).resolves.toBe("0.9.5");
    const b = bootsel({ romVersion: 2, packageId: 1, numGpios: 48 }); // package_id says QFN60: ignored
    expect(await said(install(b.loader))).toMatch(/RP2350B chip/);
    b.nothingWritten();
    const c = bootsel({ romVersion: 2, numGpios: 0 }); // unreadable
    expect(await said(install(c.loader))).toBe("The app couldn't read which chip this board has, so nothing was written. Unplug it, hold its BOOTSEL button while plugging it back in, and try again.");
    c.nothingWritten();
  });

  it("a read that fails: refused in plain words, nothing written", async () => {
    const b = bootsel();
    vi.spyOn(b.loader, "getSystemInfo").mockRejectedValue(new Error("LIBUSB_ERROR_PIPE"));
    const failed = await install(b.loader).catch((e: Error) => e);
    expect(inWords(failed as Error)).toMatch(/couldn't read which chip this board has, so nothing was written/);
    expect(((failed as Error).cause as Error).message).toBe("LIBUSB_ERROR_PIPE");
    b.nothingWritten();
  });

  it("every language has the messages, without the word dongle, and says nothing was written", async () => {
    for (const lng of ["en", "de", "fr", "es", "pt-BR", "ja", "zh-CN"]) {
      await i18n.changeLanguage(lng);
      for (const key of ["refuseChip", "refuseRp2040", "refuseFlash", "chipUnreadable", "flashUnknown"]
        .map((k) => `desktop.firmware.${k}`)
        .concat("desktop.setup.askFlash", "desktop.setup.stopTrying")) {
        const text = i18n.t(key, { chip: "RP2350B", board: "Pico 2 W", wanted: "RP2350A", size: "2 MB", needed: "4 MB" });
        expect(text, `${lng} ${key}`).not.toBe(key);
        expect(text, `${lng} ${key}`).not.toMatch(/dongle|\{\{/i);
      }
    }
    await i18n.changeLanguage("en");
  });
});

describe("the reply decoders", () => {
  const reply = (...w: number[]) => {
    const b = new Uint8Array(256);
    w.forEach((x, i) => new DataView(b.buffer).setUint32(i * 4, x, true));
    return b;
  };

  it("GET_INFO chip info: package_id and device_id (lo, hi words) as picotool prints them", () => {
    expect(decodeChipInfo(reply(3, 1, 1, 0x89abcdef, 0x01234567))).toEqual({ packageId: 1, chipId: "0123456789abcdef" });
    expect(decodeChipInfo(reply(3, 0, 1, 0, 0))).toBeNull(); // chip info not included
    expect(decodeChipInfo(new Uint8Array(8))).toBeNull(); // too short
  });

  it("OTP NUM_GPIOS: 30 = RP2350A, 48 = RP2350B, else unknown", () => {
    expect(chipFromGpios(new Uint8Array([30, 0]))).toBe("rp2350a");
    expect(chipFromGpios(new Uint8Array([48, 0]))).toBe("rp2350b");
    expect(chipFromGpios(new Uint8Array([0, 0]))).toBeNull();
  });

  it("OTP flash size: counts only with FLASH_DEVINFO_ENABLE in two of BOOT_FLAGS0's three copies", () => {
    const flags = (...rows: number[]) => reply(...rows).subarray(0, 12);
    const devinfo4mb = new Uint8Array([0x00, 0x0a]); // CS0_SIZE 0xA = 4 MB
    expect(otpFlashBytes(flags(0x20, 0x20, 0x20), devinfo4mb)).toBe(4 * MB);
    expect(otpFlashBytes(flags(0x20, 0x20, 0), devinfo4mb)).toBe(4 * MB);
    expect(otpFlashBytes(flags(0x20, 0, 0), devinfo4mb)).toBeNull(); // the boot ROM would assume 16 MB: says nothing
    expect(otpFlashBytes(flags(0x20, 0x20, 0x20), new Uint8Array([0, 0]))).toBeNull();
    expect(otpFlashBytes(flags(0x20, 0x20, 0x20), new Uint8Array([0, 0x0c]))).toBe(16 * MB);
  });

  it("the flash probe: blank = unknown; a wrapping chip gives its size; one that never wraps reads 16 MB", async () => {
    const chip = (size: number | null, fill?: number) => async (addr: number, n: number) => {
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const off = addr - 0x10000000 + i;
        out[i] = fill ?? Math.imul((size === null ? off : off % size) + 1, 0x9e3779b1) >>> 24;
      }
      return out;
    };
    expect(await probeFlashBytes(chip(4 * MB, 0xff))).toBeNull();
    expect(await probeFlashBytes(chip(4 * MB))).toBe(4 * MB);
    expect(await probeFlashBytes(chip(2 * MB))).toBe(2 * MB);
    expect(await probeFlashBytes(chip(null))).toBe(16 * MB);
  });
});
