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
export const FLASH_BYTES = 4 * 1024 * 1024; // the Pico 2 W's flash
const SECTOR = 0x1000;
// What the simulated board runs until it's updated (dev builds).
export const SIM_DEFAULT_VERSION = "v0.9.4-oled-edition+12.a1b2c3d.dirty+simulated";
// The version a firmware without one reports (the firmware's CMake fallback).
export const UNKNOWN_VERSION = "v0.0.0-oled-edition+unknown";

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
  // The device on USB in this state (a new one each time it enumerates).
  // cache: OK — key=none (the running firmware's device); invalidated=dropped on every state change (go); bound=1
  private running: SimulatedDongle | null = null;
  // cache: OK — key=none (the bootloader's device); invalidated=dropped when the board leaves BOOTSEL (go); bound=1
  private loader: SimulatedBootloader | null = null;
  // Flash contents, once something was written this session (4 MB, erased = 0xFF).
  flash: Uint8Array | null = null;
  claimed: SimulatedBootloader | null = null;
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
    this.running ??= new SimulatedDongle({ ...this.dongleOpts, version: this.version ?? UNKNOWN_VERSION, onBootsel: () => this.enterBootsel() });
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
    return { vendorId: 0x2e8a, productId: 0x000f, serialNumber: "SIMULATED", productName: "RP2350 Boot", manufacturerName: "Raspberry Pi" };
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

  async flashEraseAndWrite(addr: number, buf: Uint8Array): Promise<void> {
    if (!this.present || !this.isConnected()) throw new Error("The device was disconnected.");
    if (addr % SECTOR !== 0) throw new Error(`Address ${addr.toString(16)} must be aligned to both sector and page size`);
    const end = addr + Math.ceil(buf.byteLength / SECTOR) * SECTOR;
    if (addr < FLASH_BASE || end > FLASH_BASE + FLASH_BYTES) throw new Error(`PICOBOOT_INVALID_ADDRESS: 0x${addr.toString(16)}`);
    this.board.wrote();
    // lifetime: OK — fires once (the simulated erase + write time)
    await new Promise((r) => setTimeout(r, (SIM_FLASH_SPEEDS[this.board.speed] * buf.byteLength) / 0x10000));
    const share = { write10: 0.1, write50: 0.5, write90: 0.9 }[this.board.fault as "write10"];
    if (share !== undefined && this.planned > 0 && (this.written + buf.byteLength) / this.planned > share) throw new Error("LIBUSB_ERROR_TIMEOUT (simulated write error)");
    if (!this.present) throw new Error("The device was disconnected.");
    this.board.flash ??= new Uint8Array(FLASH_BYTES).fill(0xff);
    this.board.flash.fill(0xff, addr - FLASH_BASE, end - FLASH_BASE);
    this.board.flash.set(buf, addr - FLASH_BASE);
    this.written += buf.byteLength;
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
