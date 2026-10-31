// What the app reads from a Pico in BOOTSEL before anything is erased
// (DESIGN_FIRMWARE_IDENTITY §1.2): the chip and its package, and the flash
// size when it can be read. All reads, nothing written. The decoding follows
// picotool (`picotool info -d`) and pico-sdk 2.3.0's headers
// (boot/picoboot.h, picoboot_constants.h, bootrom_constants.h, otp_data.h).
//
// UNVERIFIED until the owner's one hardware read (design step 5H); each is
// marked "UNVERIFIED (5H)" where it is used:
//   1. the ROM version byte at 0x13 and its values (2 = A2, 3 = A3, 4 = A4);
//   2. GET_INFO's package_id on A3/A4 (nonzero = QFN60 = RP2350A) and the
//      reply's word order (count, included, package_id, device_id lo, hi);
//   3. OTP NUM_GPIOS on A2 (30 = QFN60, 48 = QFN80) and that the boot ROM
//      lets PICOBOOT read rows 0x18, 0x48..0x4A and 0x54;
//   4. the flash probe: that a 4 MB chip wraps reads above its size, so the
//      probe answers 4 MB on the owner's Pico 2 W.
import type { PicoflashHandle } from "./index";
import { logged } from "../errorText";

export const PID_RP2040 = 0x0003;
export const PID_RP2350 = 0x000f;

const FLASH_START = 0x10000000;
const PAGE = 0x100;
const MB = 1024 * 1024;
const ROM_VERSION_ADDR = 0x13; // picotool: raw_access.read_raw(0x13, rom_version)
export const SYS_INFO_CHIP_INFO = 0x1; // bootrom_constants.h
export const OTP_NUM_GPIOS_ROW = 0x18; // otp_data.h, ECC
export const OTP_BOOT_FLAGS0_ROW = 0x48; // otp_data.h, raw, RBIT-3 (rows 0x48..0x4A)
export const OTP_FLASH_DEVINFO_ROW = 0x54; // otp_data.h, ECC
const BOOT_FLAGS0_FLASH_DEVINFO_ENABLE = 0x20;

export type Chip = "rp2040" | "rp2350a" | "rp2350b";

export interface BootselBoard {
  chip: Chip | null; // null: the package couldn't be read
  chipId: string | null; // GET_INFO device_id, hex (for the 5H read and the log)
  romVersion: number | null;
  flashBytes: number | null; // null: unknown (blank flash, and no flash size set in OTP)
}

const replyView = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

// GET_INFO system info with SYS_INFO_CHIP_INFO: words [count, included,
// package_id, device_id_lo, device_id_hi, ...] (picotool main.cpp, `info`).
// UNVERIFIED (5H): the word order on her board.
export function decodeChipInfo(reply: Uint8Array): { packageId: number; chipId: string } | null {
  if (reply.byteLength < 20) return null;
  const v = replyView(reply);
  if (!(v.getUint32(4, true) & SYS_INFO_CHIP_INFO)) return null;
  const hex = (n: number) => n.toString(16).padStart(8, "0");
  return { packageId: v.getUint32(8, true), chipId: hex(v.getUint32(16, true)) + hex(v.getUint32(12, true)) };
}

// OTP NUM_GPIOS (an ECC row: 16 bits): 30 = QFN60 (RP2350A), 48 = QFN80 (RP2350B).
// UNVERIFIED (5H): the value on her A2 board, if it is one.
export function chipFromGpios(otp: Uint8Array): Chip | null {
  if (otp.byteLength < 2) return null;
  const n = replyView(otp).getUint16(0, true);
  return n === 30 ? "rp2350a" : n === 48 ? "rp2350b" : null;
}

// The OTP flash size the boot ROM uses for CS0, or null when it isn't set:
// FLASH_DEVINFO counts only when BOOT_FLAGS0.FLASH_DEVINFO_ENABLE is set (a
// redundant row: three raw copies, majority vote); otherwise the boot ROM
// assumes 16 MiB, which says nothing about the chip (otp_data.h).
export function otpFlashBytes(bootFlags0: Uint8Array, devinfo: Uint8Array): number | null {
  if (bootFlags0.byteLength < 12 || devinfo.byteLength < 2) return null;
  const f = replyView(bootFlags0);
  // loop: NOT-WORTH — 3 rows, once per install
  const set = [0, 1, 2].filter((i) => f.getUint32(i * 4, true) & BOOT_FLAGS0_FLASH_DEVINFO_ENABLE).length;
  if (set < 2) return null;
  const cs0 = (replyView(devinfo).getUint16(0, true) >> 8) & 0xf;
  return cs0 === 0 ? null : 4096 << cs0;
}

// loop: NOT-WORTH — 512 bytes, ≤ 13 times per install
const samePages = (a: Uint8Array, b: Uint8Array) => a.byteLength === b.byteLength && a.every((x, i) => x === b[i]);

// picotool's guess_flash_size: two pages at the flash start; if they match
// each other the flash is taken as blank (size unknown, null). Otherwise the
// same two pages are read at 8 MB, 4 MB, ... above the start: a chip smaller
// than the offset wraps and repeats them; the first offset that doesn't is
// half the size. UNVERIFIED (5H): that her chip wraps.
export async function probeFlashBytes(read: (addr: number, size: number) => Promise<Uint8Array>): Promise<number | null> {
  const first = await read(FLASH_START, 2 * PAGE);
  if (samePages(first.subarray(0, PAGE), first.subarray(PAGE, 2 * PAGE))) return null;
  let size = 8 * MB;
  // loop: SERIAL-REQUIRED — one PICOBOOT session; each read decides whether the next is needed (≤ 12 reads of 512 B)
  for (; size >= 16 * PAGE; size >>= 1) if (!samePages(first, await read(FLASH_START + size, 2 * PAGE))) break;
  return size * 2;
}

// Everything above, over one PICOBOOT session (released on every path).
// An RP2040 (PID 0003) is named by its USB id alone: it has no GET_INFO.
export async function readBootselBoard(device: PicoflashHandle): Promise<BootselBoard> {
  const pid = device.getUsbDeviceInfo().productId;
  if (pid === PID_RP2040) return { chip: "rp2040", chipId: null, romVersion: null, flashBytes: null };
  if (pid !== PID_RP2350) return { chip: null, chipId: null, romVersion: null, flashBytes: null };
  // error: PASSES-ON — a failed read reaches checkBoard (firmwareUpdate.ts), which refuses in plain words (desktop.firmware.chipUnreadable); nothing is written
  try {
    // lifetime: OK — released in the finally below (disconnect), on success and on every failure
    await device.connect();
    // UNVERIFIED (5H): 2 = A2, whose package_id is wrong (picotool's note); later revisions report it.
    const romVersion = (await device.flashRead(ROM_VERSION_ADDR, 1))[0];
    const info = decodeChipInfo(await device.getSystemInfo(SYS_INFO_CHIP_INFO));
    const chip: Chip | null = romVersion === 2 ? chipFromGpios(await device.otpRead(OTP_NUM_GPIOS_ROW, 1, true)) : info ? (info.packageId ? "rp2350a" : "rp2350b") : null;
    let flashBytes = await probeFlashBytes((addr, size) => device.flashRead(addr, size));
    if (flashBytes === null) {
      try {
        flashBytes = otpFlashBytes(await device.otpRead(OTP_BOOT_FLAGS0_ROW, 3, false), await device.otpRead(OTP_FLASH_DEVINFO_ROW, 1, true));
      } catch (cause) {
        // error: LOGGED-OK — an OTP row the boot ROM won't read leaves the size unknown, and unknown asks the user first (nothing is written without it)
        logged("reading the OTP flash size in BOOTSEL (the size stays unknown)")(cause);
      }
    }
    return { chip, chipId: info?.chipId ?? null, romVersion, flashBytes };
  } finally {
    await device.disconnect();
  }
}
