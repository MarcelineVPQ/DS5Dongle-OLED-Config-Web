// The simulated board as USB sees it (dev builds' "Simulate the board", and
// the tests): a Pico 2 W that is either running the firmware (a configurator
// device, the SimulatedDongle), in BOOTSEL (the RP2350 boot ROM's PICOBOOT
// interface: SimulatedBootloader, the same PicoflashHandle the real flasher
// drives), or off the bus (restarting, or a board waiting for its controller).
//
// It takes firmware the way a real RP2350 does: sector-aligned erase + write
// into its 4 MB of flash over one claimed session, at a scaled speed, then a
// reboot. The boot ROM starts only an image with an IMAGE_DEF block in its
// first 4 KB; anything else leaves the board in BOOTSEL. The version it then
// reports is the program version in the image's binary info (what picotool
// reads), so the app sees exactly the version it installed.
import type { PicoflashHandle, PicoflashUsbInfo } from "../flash";
import { SimulatedDongle, type SimulatedDongleOptions } from "./simulatedDongle";

export type SimBoardState = "dongle" | "bootsel" | "away";
// Failures to try the app's error paths with: a write error partway through
// (at about 10, 50 or 90 % of the firmware), a board that never shows up in
// BOOTSEL, one that never comes back after the update, and an image the boot
// ROM won't start (the board comes back in BOOTSEL, as with no IMAGE_DEF).
export const SIM_BOARD_FAULTS = ["", "write10", "write50", "write90", "noBootsel", "noReturn", "noStart"] as const;
export type SimBoardFault = (typeof SIM_BOARD_FAULTS)[number];
// Milliseconds per 64 KB erase + write: "real" is about a real RP2350's pace
// (~12 s for the firmware), "normal" a few seconds, "fast" for the tests.
export const SIM_FLASH_SPEEDS = { fast: 5, normal: 250, real: 900 } as const;
export type SimFlashSpeed = keyof typeof SIM_FLASH_SPEEDS;

export const FLASH_BASE = 0x10000000;
// The simulated board's own id (and its USB serial while no controller is paired).
export const DEFAULT_SIM_BOARD_ID = "E6614103E7A1B2C3";
export const FLASH_BYTES = 4 * 1024 * 1024; // the Pico 2 W's flash
const SECTOR = 0x1000;
// What the simulated board runs until it's updated (dev builds).
export const SIM_DEFAULT_VERSION = "v0.9.4-oled-edition+12.a1b2c3d.dirty+simulated";
// The version a firmware without one reports (the firmware's CMake fallback).
export const UNKNOWN_VERSION = "v0.0.0-oled-edition+unknown";

// What its boot ROM answers to the reads before an install (flash/boardRead.ts).
// The defaults are a Pico 2 W as the design reads it (RP2350A on A4 silicon,
// 4 MB that wraps, no flash size in OTP); the real values on the owner's board
// are UNVERIFIED until step 5H. Tests change them to be another board.
export interface SimSilicon {
  productId: number; // 0x000F RP2350, 0x0003 RP2040
  romVersion: number; // the byte at ROM 0x13: 2 = A2 (package_id wrong, NUM_GPIOS used)
  packageId: number; // GET_INFO package_id: nonzero = QFN60 (RP2350A), 0 = QFN80 (RP2350B)
  numGpios: number; // OTP row 0x18: 30 = QFN60, 48 = QFN80
  flashBytes: number; // reads wrap at this size (writes stay within the 4 MB array)
  otpFlashBytes: number | null; // OTP FLASH_DEVINFO CS0 size with BOOT_FLAGS0 enabling it, or null
}
export const PICO2_W_SILICON: SimSilicon = { productId: 0x000f, romVersion: 4, packageId: 1, numGpios: 30, flashBytes: 4 * 1024 * 1024, otpFlashBytes: null };

export interface SimulatedBoardOptions {
  state?: SimBoardState;
  // The firmware it runs; null = a blank Pico (nothing in flash).
  version?: string | null;
  fault?: SimBoardFault;
  speed?: SimFlashSpeed;
  // From the BOOTSEL command until the bootloader is on USB, and from the
  // reboot until the firmware is (a real board takes about a second).
  bootselMs?: number;
  restartMs?: number;
  // How the firmware it runs behaves (live input, protocol, core1).
  dongle?: Omit<SimulatedDongleOptions, "version" | "onBootsel">;
  // Its chip as the boot ROM reports it (default: a Pico 2 W).
  silicon?: Partial<SimSilicon>;
}

export class SimulatedBoard {
  state: SimBoardState;
  version: string | null;
  fault: SimBoardFault;
  speed: SimFlashSpeed;
  private readonly bootselMs: number;
  private readonly restartMs: number;
  private readonly dongleOpts: SimulatedDongleOptions;
  private readonly listeners = new Set<() => void>();
  // Its own id (protocol 1.20): what the firmware reports in identity and
  // what its boot ROM names itself by in BOOTSEL (the USB serial there).
  // Tests set another before it comes back to plug in a different board.
  boardId: string;
  // The device on USB in this state (a new one each time it enumerates).
  // cache: OK — key=none (the running firmware's device); invalidated=dropped on every state change (go); bound=1
  private running: SimulatedDongle | null = null;
  // cache: OK — key=none (the bootloader's device); invalidated=dropped when the board leaves BOOTSEL (go); bound=1
  private loader: SimulatedBootloader | null = null;
  // Flash contents, once something was written this session (4 MB, erased = 0xFF).
  flash: Uint8Array | null = null;
  claimed: SimulatedBootloader | null = null;
  silicon: SimSilicon;
  // The image now in flash starts (an IMAGE_DEF block in its first 4 KB).
  private bootable: boolean;
  // A pending re-enumeration (BOOTSEL or a restart), cancelled by a new state.
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: SimulatedBoardOptions = {}) {
    this.state = opts.state ?? "dongle";
    this.version = opts.version === undefined ? SIM_DEFAULT_VERSION : opts.version;
    this.bootable = this.version !== null;
    if (this.state === "dongle" && this.version === null) this.state = "bootsel"; // a blank Pico starts in the bootloader
    this.fault = opts.fault ?? "";
    this.speed = opts.speed ?? "normal";
    this.bootselMs = opts.bootselMs ?? 800;
    this.restartMs = opts.restartMs ?? 1500;
    this.dongleOpts = opts.dongle ?? {};
    this.boardId = (this.dongleOpts.boardId ?? DEFAULT_SIM_BOARD_ID).toUpperCase();
    this.silicon = { ...PICO2_W_SILICON, ...opts.silicon };
  }

  // The Developer card's failure and speed, for the next update.
  configure(next: { fault?: SimBoardFault; speed?: SimFlashSpeed }): void {
    if (next.fault !== undefined) this.fault = next.fault;
    if (next.speed !== undefined) this.speed = next.speed;
  }

  // lifetime: OK — the caller keeps the returned unsubscribe (useDs5Bridge's effect cleanup, or a test's end)
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // The firmware's configurator device while it runs, else null (not on USB).
  dongle(): SimulatedDongle | null {
    if (this.state !== "dongle") return null;
    this.running ??= new SimulatedDongle({ ...this.dongleOpts, boardId: this.boardId, version: this.version ?? UNKNOWN_VERSION, onBootsel: () => this.enterBootsel() });
    return this.running;
  }

  // The RP2350 bootloader while in BOOTSEL, else null (PicoflashAPI.getDevices()).
  bootloader(): SimulatedBootloader | null {
    if (this.state !== "bootsel") return null;
    this.loader ??= new SimulatedBootloader(this);
    return this.loader;
  }

  // Put the board in a state by hand (Developer card): "blank" is BOOTSEL
  // with an empty flash; "dongle" with nothing in flash runs a default build.
  set(next: SimBoardState | "blank"): void {
    if (next === "blank") {
      this.version = null;
      this.bootable = false;
      this.flash = null;
    } else if (next === "dongle" && this.version === null) {
      this.version = SIM_DEFAULT_VERSION;
      this.bootable = true;
    }
    this.go(next === "blank" ? "bootsel" : next);
  }

  // The firmware's BOOTSEL command (0xF6 0x08): off the bus, then the
  // bootloader enumerates (unless the fault says it never does).
  enterBootsel(): void {
    this.go("away");
    if (this.fault !== "noBootsel") this.later(this.bootselMs, () => this.go("bootsel"));
  }

  // The bootloader's reboot: off the bus, then the firmware starts if the
  // image is bootable (else the boot ROM is back in BOOTSEL; "noStart" makes
  // any written image one it won't start).
  restart(delayMs: number): void {
    if (this.fault === "noStart") this.bootable = false;
    this.later(delayMs, () => {
      this.go("away");
      if (!this.bootable) {
        this.later(this.restartMs, () => this.go("bootsel"));
        return;
      }
      if (this.flash) this.version = programVersion(this.flash) ?? UNKNOWN_VERSION;
      // "noReturn": the board runs but stays off USB (as one waiting for its controller).
      if (this.fault !== "noReturn") this.later(this.restartMs, () => this.go("dongle"));
      else this.emit();
    });
  }

  // Called by the bootloader as it writes: the first write erases the old
  // firmware (an interrupted update leaves no firmware), and the image is
  // bootable again only once the write session ended with a reboot.
  wrote(): void {
    if (this.version !== null || this.bootable) {
      this.version = null;
      this.bootable = false;
      this.emit();
    }
  }
  imageWritten(): void {
    this.bootable = !!this.flash && hasImageDef(this.flash);
  }

  private go(state: SimBoardState): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.running && state !== "dongle") this.running.gone = true;
    if (state !== "dongle") this.running = null;
    if (state !== "bootsel") this.loader = null;
    if (state !== "bootsel") this.claimed = null;
    this.state = state;
    this.emit();
  }

  private later(ms: number, run: () => void): void {
    if (this.timer) clearTimeout(this.timer);
    // lifetime: OK — one pending re-enumeration at a time: replaced or cleared by the next state change (go)
    this.timer = setTimeout(() => {
      this.timer = null;
      run();
    }, ms);
  }

  private emit(): void {
    // loop: NOT-WORTH — dev/test fake only; N = the app's few listeners, on a state change
    for (const l of this.listeners) l();
  }
}

// The RP2350 boot ROM's PICOBOOT interface, as the vendored flasher uses it.
export class SimulatedBootloader implements PicoflashHandle {
  private written = 0;
  // The size of the firmware about to be written (from the app's flash()),
  // for the "fail at N %" fault.
  private planned = 0;
  constructor(private readonly board: SimulatedBoard) {}

  getTarget() {
    return { toString: () => "RP2350" };
  }
  getUsbDeviceInfo(): PicoflashUsbInfo {
    return { vendorId: 0x2e8a, productId: this.board.silicon.productId, serialNumber: this.board.boardId, productName: "RP2350 Boot", manufacturerName: "Raspberry Pi" };
  }
  isConnected(): boolean {
    return this.board.claimed === this;
  }
  private get present(): boolean {
    return this.board.bootloader() === this;
  }

  // lifetime: OK — released by disconnect() (the app's flash() always calls it), or when the board leaves BOOTSEL
  async connect(): Promise<unknown> {
    if (!this.present) throw new Error("The device was disconnected.");
    if (this.board.claimed && this.board.claimed !== this) throw new Error("Failed to claim interface: Unable to claim interface.");
    this.board.claimed = this;
    this.written = 0;
    return this;
  }

  async disconnect(): Promise<void> {
    if (this.board.claimed === this) this.board.claimed = null;
  }

  // Simulation only: the app's flash() announces the firmware's size so a
  // "fail at N %" fault fails at that share of it.
  expectBytes(total: number): void {
    this.planned = total;
  }

  // An erase is a write of erased bytes that doesn't count toward the
  // firmware's size (the "fail at N %" fault).
  async flashErase(addr: number, size: number): Promise<void> {
    await this.flashEraseAndWrite(addr, new Uint8Array(size).fill(0xff), false);
  }

  async flashEraseAndWrite(addr: number, buf: Uint8Array, counted = true): Promise<void> {
    if (!this.present || !this.isConnected()) throw new Error("The device was disconnected.");
    if (addr % SECTOR !== 0) throw new Error(`Address ${addr.toString(16)} must be aligned to both sector and page size`);
    const end = addr + Math.ceil(buf.byteLength / SECTOR) * SECTOR;
    if (addr < FLASH_BASE || end > FLASH_BASE + FLASH_BYTES) throw new Error(`PICOBOOT_INVALID_ADDRESS: 0x${addr.toString(16)}`);
    this.board.wrote();
    // lifetime: OK — fires once (the simulated erase + write time)
    await new Promise((r) => setTimeout(r, (SIM_FLASH_SPEEDS[this.board.speed] * buf.byteLength) / 0x10000));
    const share = { write10: 0.1, write50: 0.5, write90: 0.9 }[this.board.fault as "write10"];
    if (counted && share !== undefined && this.planned > 0 && (this.written + buf.byteLength) / this.planned > share) throw new Error("LIBUSB_ERROR_TIMEOUT (simulated write error)");
    if (!this.present) throw new Error("The device was disconnected.");
    this.board.flash ??= new Uint8Array(FLASH_BYTES).fill(0xff);
    this.board.flash.fill(0xff, addr - FLASH_BASE, end - FLASH_BASE);
    this.board.flash.set(buf, addr - FLASH_BASE);
    if (counted) this.written += buf.byteLength;
  }

  // ROM and flash reads (Picoboot.flashRead opens a session by itself). Flash
  // reads wrap at the chip's size, like a chip that ignores the high address
  // bits; a board that runs firmware not written this session reads as a
  // non-blank pattern, a blank one as erased.
  async flashRead(addr: number, size: number): Promise<Uint8Array> {
    if (!this.present) throw new Error("The device was disconnected.");
    const { silicon, flash, version } = this.board;
    const out = new Uint8Array(size);
    if (addr < 0x8000) {
      // loop: NOT-WORTH — dev/test fake only; a few ROM bytes per install
      for (let i = 0; i < size; i++) out[i] = addr + i === 0x13 ? silicon.romVersion : 0;
      return out;
    }
    // loop: NOT-WORTH — dev/test fake only; 512 bytes, ≤ 13 reads per install
    for (let i = 0; i < size; i++) {
      const off = (addr - FLASH_BASE + i) % silicon.flashBytes;
      out[i] = flash ? flash[off] : version !== null ? Math.imul(off + 1, 0x9e3779b1) >>> 24 : 0xff;
    }
    return out;
  }

  // GET_INFO system info: [count, included, package_id, device_id lo, hi], 256 bytes.
  async getSystemInfo(flags: number): Promise<Uint8Array> {
    if (!this.isConnected()) throw new Error("The device was disconnected.");
    const out = new Uint8Array(256);
    const v = new DataView(out.buffer);
    v.setUint32(0, 3, true);
    v.setUint32(4, flags & 1, true);
    v.setUint32(8, this.board.silicon.packageId, true);
    v.setUint32(12, 0x89abcdef, true);
    v.setUint32(16, 0x01234567, true);
    return out;
  }

  // OTP rows: NUM_GPIOS (0x18), BOOT_FLAGS0 and its copies (0x48..0x4A), FLASH_DEVINFO (0x54).
  async otpRead(row: number, count: number, ecc: boolean): Promise<Uint8Array> {
    if (!this.isConnected()) throw new Error("The device was disconnected.");
    const { numGpios, otpFlashBytes } = this.board.silicon;
    const width = ecc ? 2 : 4;
    const out = new Uint8Array(count * width);
    const v = new DataView(out.buffer);
    // loop: NOT-WORTH — dev/test fake only; ≤ 3 rows per read
    for (let i = 0; i < count; i++) {
      const r = row + i;
      const value = r === 0x18 ? numGpios : r >= 0x48 && r <= 0x4a ? (otpFlashBytes ? 0x20 : 0) : r === 0x54 && otpFlashBytes ? Math.log2(otpFlashBytes / 4096) << 8 : 0;
      if (ecc) v.setUint16(i * 2, value, true);
      else v.setUint32(i * 4, value, true);
    }
    return out;
  }

  async rebootRp2350(_flags: number, _p0: number, _p1: number, delayMs: number): Promise<void> {
    if (!this.isConnected()) throw new Error("The device was disconnected.");
    this.board.imageWritten();
    this.board.restart(delayMs);
  }
}

const IMAGE_DEF_START = 0xffffded3; // PICOBIN_BLOCK_MARKER_START
const BINARY_INFO_MARKER_START = 0x7188ebf2;
const BINARY_INFO_MARKER_END = 0xe71aa390;
const BI_TYPE_ID_AND_STRING = 6;
const BI_TAG_RP = 0x5052; // 'R','P'
const BI_ID_PROGRAM_VERSION = 0x11a9bc3a;

const flashWord = (flash: Uint8Array, addr: number) => new DataView(flash.buffer, flash.byteOffset).getUint32(addr - FLASH_BASE, true);
const inFlash = (addr: number, len = 4) => addr >= FLASH_BASE && addr + len <= FLASH_BASE + FLASH_BYTES;

// The boot ROM looks for an IMAGE_DEF block in the image's first 4 KB.
function hasImageDef(flash: Uint8Array): boolean {
  // loop: NOT-WORTH — dev/test fake only; once per simulated update, 1024 words
  for (let off = 0; off < SECTOR; off += 4) if (flashWord(flash, FLASH_BASE + off) === IMAGE_DEF_START) return true;
  return false;
}

// The program version from the image's binary info (the pico-sdk's
// bi_program_version_string, what `picotool info` shows), or null.
export function programVersion(flash: Uint8Array): string | null {
  // loop: NOT-WORTH — dev/test fake only; once per simulated update: the header sits in the first 4 KB
  for (let off = 0; off < SECTOR; off += 4) {
    const at = FLASH_BASE + off;
    if (flashWord(flash, at) !== BINARY_INFO_MARKER_START || flashWord(flash, at + 16) !== BINARY_INFO_MARKER_END) continue;
    const [start, end] = [flashWord(flash, at + 4), flashWord(flash, at + 8)];
    if (!inFlash(start) || !inFlash(end, 0) || end < start) return null;
    // loop: NOT-WORTH — dev/test fake only; once per simulated update, N = the image's binary info entries (~10)
    for (let p = start; p < end; p += 4) {
      const entry = flashWord(flash, p);
      if (!inFlash(entry, 12)) continue;
      const head = flashWord(flash, entry);
      if ((head & 0xffff) !== BI_TYPE_ID_AND_STRING || head >>> 16 !== BI_TAG_RP || flashWord(flash, entry + 4) !== BI_ID_PROGRAM_VERSION) continue;
      const text = flashWord(flash, entry + 8);
      if (!inFlash(text, 1)) return null;
      const from = text - FLASH_BASE;
      const to = flash.indexOf(0, from);
      return new TextDecoder().decode(flash.subarray(from, to < 0 ? Math.min(flash.length, from + 64) : Math.min(to, from + 64)));
    }
    return null;
  }
  return null;
}
