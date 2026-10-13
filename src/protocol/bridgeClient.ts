// High-level client for the dongle's configurator protocol (firmware src/cmd.cpp),
// over any Ds5Transport. Report payloads here never include the report-id byte.
import { CONFIG_BODY_SIZE, CONFIG_BODY_SIZE_V13, type ConfigBody, decodeConfigBody, encodeConfigBody } from "./config";
import { CALIB_BODY_SIZE, CALIB_PROTO_VER, decodeCalibration, encodeCalibration, type Calibration } from "./calibration";
import { CURVE_PROTO_VER, CURVE_REPORT_BYTES, type CurvesReport, decodeCurvesReport, encodeCurve, isValidCurve, type StickCurve } from "./stickCurve";
import { REMAP_EXTRA_COUNT, type RemapState, decodeRemapFromConfigReport, encodeRemapSet, isValidExtra } from "./remap";
import { DeviceGoneError, MAX_REPORT_PAYLOAD, type Ds5Transport, OLED_MIRROR_BYTES } from "./transport";
import { decodeInputReport, type InputReport } from "../oled/inputReport";
import {
  CTRL_FIRMWARE_BYTES,
  CTRL_HEADER_BYTES,
  CTRL_MAX_PAGES,
  CTRL_PAGE_BYTES,
  CTRL_PAGE_REPLY_BYTES,
  CTRL_SEL,
  type ControllerFirmware,
  type CtrlHeader,
  ctrlInfoReport,
  decodeControllerFirmware,
  decodeCtrlHeader,
} from "./controllerInfo";

export const REPORT = {
  liveInput: 0xf0, // protocol 1.2+, feature bit FEATURE.liveInput
  identity: 0xf1,
  audioCounters: 0xf5,
  remapExtra: 0xed, // protocol 1.9, vendor interface only
  stickCurves: 0xec, // protocol 1.10, vendor interface only
  command: 0xf6,
  config: 0xf7,
  version: 0xf8,
  rssi: 0xf9,
  slots: 0xfa,
  diag: 0xfb,
  cpu: 0xfc,
  oledMirror: 0xef, // protocol 1.4+, feature bit FEATURES2.oledMirror
  calibration: 0xee, // protocol 1.5+, feature bit FEATURES2.calibration
  controllerInfo: 0xeb, // protocol 1.12+, feature bit FEATURES3.controllerInfo; selector in wValue's high byte
} as const;

export const FUNC = {
  applyConfig: 0x01,
  save: 0x02,
  reconnectUsb: 0x03,
  switchSlot: 0x04,
  forgetSlot: 0x05,
  wipeSlots: 0x06,
  reboot: 0x07,
  bootsel: 0x08,
  factoryReset: 0x09,
  triggerPreview: 0x0a,
  narrator: 0x0b,
  narratorSay: 0x0c,
  calibration: 0x0d,
  gripTest: 0x0e,
  remap: 0x10,
  remapTemporary: 0x11, // protocol 1.8: a table in RAM only (a game's layout)
  remapRevert: 0x12, // protocol 1.8: back to the saved table
  remapExtra: 0x13, // protocol 1.9: the Edge's extra-button entries
  stickCurves: 0x14, // protocol 1.10: stick response curves (saved or temporary)
  resetTimings: 0x15, // protocol 1.11: start the 0xFC timing counters over (answered at once)
  controllerTest: 0x16, // protocol 1.12: run a read-only controller test command (answer in 0xEB)
  pcSleep: 0x17, // protocol 1.14: [POWER_FLAGS bits], saved on its own (like the narrator)
} as const;

// The protocol major this app speaks. A dongle reporting another major is
// refused (layouts may have changed); a newer minor only adds features.
export const SUPPORTED_PROTO_MAJOR = 1;

export const IDENTITY_FEATURES = {
  remap: 0x01,
  slots: 0x02,
  rebootBootsel: 0x04,
  factoryReset: 0x08,
  triggerPreview: 0x10,
  liveInput: 0x20, // 0xF0 live input report (protocol 1.2)
  unsavedFlag: 0x40, // identity [19] bit 0 (protocol 1.2)
  narrator: 0x80, // the dongle's own narrator lines, 0x0B / 0x0C (protocol 1.3)
} as const;
// Identity [29] (protocol 1.4): more feature bits.
export const FEATURES2 = {
  oledMirror: 0x01, // 0xEF: the OLED's image as last sent to the panel
  calibration: 0x02, // 0xEE get / 0xF6 0x0D set: stick, trigger, gyro calibration
  gripTest: 0x04, // 0xF6 0x0E: buzz a grip at its haptics strength (protocol 1.6)
  boardName: 0x08, // identity [30..45]: the board's name, e.g. "Pico 2 W" (protocol 1.7)
  temporaryRemap: 0x10, // 0xF6 0x11 / 0x12 and identity [19] bit 1 (protocol 1.8)
  remapExtra: 0x20, // 0xED get / 0xF6 0x13 set: Edge Fn buttons and paddles (protocol 1.9)
  stickCurves: 0x40, // 0xEC get / 0xF6 0x14 set, identity [19] bit 2: stick response curves (protocol 1.10)
  timings: 0x80, // 0xFC [11..62] per-stage timings, 0xF6 0x15 resets them (protocol 1.11)
} as const;

// Identity [46] (protocol 1.12): a third feature byte.
export const FEATURES3 = {
  controllerInfo: 0x01, // 0xEB get / 0xF6 0x16: controller firmware, lifetime counters, battery voltage
  configTail: 0x02, // protocol 1.13: trigger reduction, speaker boost, volume lock, mic / speaker choice, status pin (config body 49 bytes)
  pcSleep: 0x04, // protocol 1.14: what the dongle does when the PC sleeps (identity [47], 0xF6 0x17)
  timedGripTest: 0x08, // protocol 1.15: 0xF6 0x0E [side, tenths] holds the grip test steadily (0 stops)
} as const;
// Identity [47] (protocol 1.14, FEATURES3.pcSleep): the PC sleep options.
export const POWER_FLAGS = {
  sleepControllerOff: 0x01, // turn the controller off once the PC has slept 3 s (default on)
  psWakesPc: 0x02, // the PS button wakes the PC (default off)
} as const;
// The longest identity this app reads; older firmware answers its own length.
export const IDENTITY_BYTES = 48;

// What the dongle's OLED shows, pixel for pixel (protocol 1.4).
export interface OledFrame {
  power: "on" | "dim" | "off"; // dim = the idle breathing dot
  screen: number; // the firmware's current screen, 0-based
  contrast: number; // SH1107 contrast 0..255
  seq: number; // bumps on every flush to the panel
  pixels: Uint8Array; // 128x64, row-major, 16 bytes per row, MSB = leftmost
}

// The narrator's firmware lines (protocol 1.3), in the firmware's order.
export const NARRATOR_LINES = { connected: 0, slot0: 1, batteryLow: 5 } as const;
export const NARRATOR_LANGS = ["en", "de", "fr", "es", "pt-BR", "zh-CN", "ja"] as const;
export const NARRATOR_OFF = 0xff;

export type CommandResult = "ok" | "pending" | "invalid" | "failed" | "busy";
const RESULTS: readonly CommandResult[] = ["ok", "pending", "invalid", "failed", "busy"];

// A protocol 1.x addition announced by a bit in one of identity's feature
// bytes ([29] FEATURES2, [46] FEATURES3), from protocol 1.<minMinor> on.
export function supportsFeature(identity: BridgeIdentity | null, byte: "features2" | "features3", minMinor: number, bit: number): boolean {
  return !!identity && (identity.protoMajor > 1 || identity.protoMinor >= minMinor) && (identity[byte] & bit) !== 0;
}
export const supportsFeature2 = (identity: BridgeIdentity | null, minMinor: number, bit: number) => supportsFeature(identity, "features2", minMinor, bit);
export const supportsFeature3 = (identity: BridgeIdentity | null, minMinor: number, bit: number) => supportsFeature(identity, "features3", minMinor, bit);

export interface BridgeIdentity {
  protoMajor: number;
  protoMinor: number;
  configBodyLength: number;
  features: number;
  sequence: number;
  lastFunction: number;
  lastResult: CommandResult;
  hostConfigGeneration: number;
  slotCount: number;
  currentSlot: number;
  controllerConnected: boolean;
  // Protocol 1.2+ (feature unsavedFlag): the settings in the dongle's RAM
  // differ from flash. null on firmware that doesn't report it.
  unsaved: boolean | null;
  // Protocol 1.1+; null/false on older firmware.
  charging: boolean;
  batteryFull: boolean;
  lightbar: [number, number, number] | null;
  battery: number | null; // percent, in 10% steps
  // Protocol 1.2+: the player indicator LEDs the PC set (bits 0..4, left to right); 0 on older firmware.
  playerLeds: number;
  // Protocol 1.2+: which controller is connected, and its colorway code from
  // the factory serial ("02" = Cosmic Red; null while unknown or unsupported).
  model: "dualsense" | "edge" | null;
  colorwayCode: string | null;
  // Protocol 1.4+: identity [29], more feature bits (FEATURES2); 0 on older firmware.
  features2: number;
  // Protocol 1.7+: the board the firmware is built for ("Pico 2 W"); null on older firmware.
  boardName: string | null;
  // Protocol 1.8+: a temporary remap (a game's layout) is active; null on older firmware.
  remapTemporary: boolean | null;
  // Protocol 1.10+: a game's stick curves (RAM only) are on; null on older firmware.
  curvesTemporary: boolean | null;
  // Protocol 1.12+: identity [46], a third feature byte (FEATURES3); 0 on older firmware.
  features3: number;
  // Protocol 1.14+ (FEATURES3.pcSleep): identity [47], the POWER_FLAGS bits; null on older firmware.
  powerFlags: number | null;
}

// The DualSense's player patterns (as Linux and games set them) -> player number.
const PLAYER_PATTERNS: Record<number, number> = { 0x04: 1, 0x0a: 2, 0x15: 3, 0x1b: 4, 0x1f: 5 };
export function playerNumber(leds: number): number | null {
  return PLAYER_PATTERNS[leds & 0x1f] ?? null;
}

// ASCII, NUL-padded; printable characters only, anything else means no name.
function boardNameFrom(raw: Uint8Array): string | null {
  const end = raw.indexOf(0);
  const chars = [...raw.subarray(0, end < 0 ? raw.length : end)];
  if (!chars.length || chars.some((c) => c < 0x20 || c > 0x7e)) return null;
  return String.fromCharCode(...chars).trim() || null;
}

export function decodeIdentity(bytes: Uint8Array): BridgeIdentity {
  if (bytes.length < 20 || bytes[0] !== 0x44 || bytes[1] !== 0x53 || bytes[2] !== 0x35 || bytes[3] !== 0x4f) {
    throw new Error("Your board did not identify itself (expected DS5O). Update the firmware.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    protoMajor: bytes[4],
    protoMinor: bytes[5],
    configBodyLength: bytes[6],
    features: bytes[7],
    sequence: view.getUint16(8, true),
    lastFunction: bytes[10],
    lastResult: RESULTS[bytes[11]] ?? "failed",
    hostConfigGeneration: view.getUint32(12, true),
    slotCount: bytes[16],
    currentSlot: bytes[17],
    controllerConnected: bytes[18] === 1,
    unsaved: (bytes[7] & IDENTITY_FEATURES.unsavedFlag) !== 0 ? (bytes[19] & 0x01) !== 0 : null,
    charging: bytes.length >= 25 && (bytes[20] & 0x01) !== 0,
    batteryFull: bytes.length >= 25 && (bytes[20] & 0x02) !== 0,
    lightbar: bytes.length >= 25 && bytes[18] === 1 ? [bytes[21], bytes[22], bytes[23]] : null,
    battery: bytes.length >= 25 && bytes[24] <= 10 ? bytes[24] * 10 : null,
    playerLeds: bytes.length >= 26 ? bytes[25] & 0x1f : 0,
    model: bytes.length >= 29 && bytes[18] === 1 && bytes[26] !== 0xff ? (bytes[26] === 1 ? "edge" : "dualsense") : null,
    colorwayCode: bytes.length >= 29 && bytes[27] && bytes[28] ? String.fromCharCode(bytes[27], bytes[28]) : null,
    features2: bytes.length >= 30 ? bytes[29] : 0,
    boardName: bytes.length >= 46 && (bytes[29] & FEATURES2.boardName) !== 0 ? boardNameFrom(bytes.subarray(30, 46)) : null,
    remapTemporary: bytes.length >= 30 && (bytes[29] & FEATURES2.temporaryRemap) !== 0 ? (bytes[19] & 0x02) !== 0 : null,
    curvesTemporary: bytes.length >= 30 && (bytes[29] & FEATURES2.stickCurves) !== 0 ? (bytes[19] & 0x04) !== 0 : null,
    features3: bytes.length >= 47 ? bytes[46] : 0,
    powerFlags: bytes.length >= 48 && (bytes[4] > 1 || bytes[5] >= 14) && (bytes[46] & FEATURES3.pcSleep) !== 0 ? bytes[47] : null,
  };
}

// Whether two identity reads say the same thing (field by field), so a poll
// that brings nothing new doesn't re-render the app.
export function sameIdentity(a: BridgeIdentity | null, b: BridgeIdentity | null): boolean {
  if (!a || !b) return a === b;
  return (Object.keys(a) as Array<keyof BridgeIdentity>).every((k) => {
    const x = a[k];
    const y = b[k];
    return Array.isArray(x) && Array.isArray(y) ? x.length === y.length && x.every((v, i) => v === y[i]) : x === y;
  });
}

export class CommandError extends Error {
  constructor(
    public readonly func: number,
    public readonly result: CommandResult,
  ) {
    super(`Command 0x${func.toString(16).padStart(2, "0")} ${result === "failed" ? "failed" : `was rejected (${result})`}`);
    this.name = "CommandError";
  }
}

export interface SlotsInfo {
  addrs: Uint8Array[];
  occupied: boolean[];
}

export interface DiagInfo {
  uptimeSeconds: number;
  usbFrames: number;
  btPackets: number;
  peakSpeaker: number;
  peakHaptic: number;
  hciErrors: number;
}

export interface CpuInfo {
  setKhz: number;
  measuredKhz: number;
  vregCode: number;
  tempRaw: number;
  // Protocol 1.11 (FEATURES2.timings), when asked for: per-stage timings; null otherwise.
  timings: CpuTimings | null;
}

// The firmware's timed stages (perf.h), in its order: core0's main loop and
// its parts, then core1's audio frames.
export const TIMING_STAGES = ["loop", "bluetooth", "usb", "audio", "input", "oled", "speaker", "mic"] as const;
export const CPU_REPORT_BYTES = 11;
export const CPU_TIMINGS_REPORT_BYTES = 63;
export const TIMING_MAX_SATURATED = 0xffff; // µs: "this long or longer"

export interface StageTiming {
  avgNs: number; // average since the reset
  maxUs: number; // worst case since the reset (TIMING_MAX_SATURATED = at least that)
}

export interface CpuTimings {
  timerFallback: boolean; // [11] bit 7: the microsecond timer, not the cycle counter
  sinceResetSeconds: number; // saturates at 65535
  stages: StageTiming[]; // TIMING_STAGES order; as many as the dongle reports
}

// 0xFC: 11 bytes of CPU telemetry, then (protocol 1.11, 63 bytes asked) the
// timings: [11] layout version 1 (bit 7 timer fallback), [12] stage count,
// [13..14] seconds since the reset, then per stage a u32 average in ns and a
// u16 worst case in µs. Little-endian.
export function decodeCpu(bytes: Uint8Array): CpuInfo {
  const view = toView(bytes, CPU_REPORT_BYTES);
  return { setKhz: view.getUint32(0, true), measuredKhz: view.getUint32(4, true), vregCode: view.getUint8(8), tempRaw: view.getUint16(9, true), timings: decodeTimings(bytes) };
}

function decodeTimings(bytes: Uint8Array): CpuTimings | null {
  if (bytes.length < 15 || (bytes[11] & 0x7f) !== 1) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = Math.min(bytes[12], Math.floor((bytes.length - 15) / 6));
  const stages = Array.from({ length: count }, (_, i) => ({ avgNs: view.getUint32(15 + 6 * i, true), maxUs: view.getUint16(19 + 6 * i, true) }));
  return { timerFallback: (bytes[11] & 0x80) !== 0, sinceResetSeconds: view.getUint16(13, true), stages };
}

export const AUDIO_COUNTER_NAMES = [
  "usbFrames",
  "btOut",
  "dropRaw",
  "dropEnc",
  "dropHap",
  "core1Loops",
  "core1Encoded",
  "rawPushed",
  "hapPushed",
  "micFrames",
  "micPlc",
  "flashWrites",
  "flashFailures",
  "setFeatureCount",
  "setFeatureLast",
] as const;
// Core1's health after the 15 counters (issue #15), in the 63-byte reply:
// [60] flags (bit0 started, bit1 speaker encoder failed (no memory), bit2 mic
// decoder failed, bit7 = this layout) and [61..62] u16 free heap when core1
// started, in KiB (0 = not known yet). Firmware 0.9.4 to 0.9.5-dev.5 sent them
// as two more u32s (68 bytes), past the 63-byte cap, so only the flags' low
// byte arrived, without bit7: that firmware and older read as no health fields
// (the dashboard falls back to the loop-count check alone, as before).
// Bits 3..6 of [60]: core1's start-up stage (firmware audio.cpp g_c1_stage),
// the last start-up step it reached: 0 never entered core1_entry, 1 entered,
// 2 flash lockout registered, 3 cycle counter on, 4 creating the speaker
// encoder, 5 encoder created, 6 encoder + resampler set up, 7 creating the
// mic decoder, 8 decoder created, 9 running its loop. Every firmware with
// bit7 sends it.
export const CORE1_SPEAKER_FAILED = 0x02;
export const CORE1_MIC_FAILED = 0x04;
export const CORE1_HEALTH_LAYOUT = 0x80;
export const CORE1_STAGE_SHIFT = 3;
export const CORE1_STAGE_MASK = 0x78;
export const CORE1_STAGE_RUNNING = 9;
export const AUDIO_COUNTERS_BYTES = 63;
export type AudioCounters = Record<(typeof AUDIO_COUNTER_NAMES)[number], number> & { core1Flags?: number; core1FreeHeap?: number; core1Stage?: number };

const POLL_INTERVAL_MS = 20;
const COMMAND_TIMEOUT_MS = 3000;
// A test command waits for the dongle's connect-time read (up to ~5 s after
// the controller connects), then up to 3 s for the controller's answer.
const CONTROLLER_TEST_TIMEOUT_MS = 12000;
const CONTROLLER_TEST_POLL_MS = 60;

export class Ds5BridgeClient {
  constructor(public readonly transport: Ds5Transport) {}

  get isOpen(): boolean {
    return this.transport.isOpen;
  }

  // The firmware's protocol, as of the last identity read (decides the config layout).
  private protocol: { major: number; minor: number; features3: number } | null = null;

  async identity(): Promise<BridgeIdentity> {
    const id = decodeIdentity(await this.transport.getReport(REPORT.identity, IDENTITY_BYTES));
    this.protocol = { major: id.protoMajor, minor: id.protoMinor, features3: id.features3 };
    return id;
  }

  // Protocol 1.13+: the config body's seven 1.13 settings (49 bytes).
  get configTail(): boolean {
    const p = this.protocol;
    return !!p && (p.major > 1 || p.minor >= 13) && (p.features3 & FEATURES3.configTail) !== 0;
  }

  // Protocol 1.6+: left and right grip haptics strengths.
  get splitHaptics(): boolean {
    return !!this.protocol && (this.protocol.major > 1 || this.protocol.minor >= 6);
  }

  // Throws if the dongle speaks a protocol major this app doesn't understand.
  async checkCompatible(): Promise<BridgeIdentity> {
    const id = await this.identity();
    if (id.protoMajor !== SUPPORTED_PROTO_MAJOR) {
      throw new Error(`Firmware protocol ${id.protoMajor}.${id.protoMinor} is not supported by this app (needs ${SUPPORTED_PROTO_MAJOR}.x). Update the app or the firmware.`);
    }
    return id;
  }

  // Commands from this app run one at a time, in order: two overlapping ones
  // would read the same sequence number and both fail (or get BUSY).
  private commandQueue: Promise<unknown> = Promise.resolve();

  // Send an 0xF6 function and wait until the dongle reports its outcome.
  // Reboot / BOOTSEL resolve "gone" once the device leaves the bus.
  command(func: number, args: number[] = []): Promise<"ok" | "gone"> {
    const run = this.commandQueue.then(() => this.runCommand(func, args));
    this.commandQueue = run.catch(() => undefined);
    return run;
  }

  private async runCommand(func: number, args: number[]): Promise<"ok" | "gone"> {
    const before = await this.identity();
    const payload = new Uint8Array([func, ...args]);
    await this.transport.setReport(REPORT.command, payload);
    const expected = (before.sequence + 1) & 0xffff;
    const deadline = Date.now() + COMMAND_TIMEOUT_MS;

    for (;;) {
      let id: BridgeIdentity;
      try {
        id = await this.identity();
      } catch (cause) {
        if (cause instanceof DeviceGoneError) return "gone";
        throw cause;
      }
      if (id.sequence !== expected) throw new Error("Another program sent a command to your board at the same time. Try again.");
      if (id.lastResult === "ok") return "ok";
      if (id.lastResult !== "pending") throw new CommandError(func, id.lastResult);
      if (Date.now() > deadline) throw new Error("Your board did not finish the command in time.");
      await sleep(POLL_INTERVAL_MS);
    }
  }

  async readConfig(): Promise<ConfigBody> {
    // The whole body: older firmware answers its own (shorter) body to this.
    return decodeConfigBody(await this.transport.getReport(REPORT.config, CONFIG_BODY_SIZE_V13));
  }

  // Applies to the dongle's RAM; takes effect immediately. saveToFlash() persists.
  async applyConfig(config: ConfigBody): Promise<void> {
    const body = encodeConfigBody(config, this.splitHaptics, this.configTail);
    await this.command(FUNC.applyConfig, [...body]);
  }

  async saveToFlash(): Promise<void> {
    await this.command(FUNC.save);
  }

  async readRemap(): Promise<RemapState | null> {
    return decodeRemapFromConfigReport(await this.transport.getReport(REPORT.config, MAX_REPORT_PAYLOAD));
  }

  // The firmware saves a remap table to flash immediately.
  async applyRemap(table: number[]): Promise<void> {
    const report = encodeRemapSet(table);
    const [func, ...rest] = report.subarray(0, 4 + table.length);
    await this.command(func, rest);
  }

  // Protocol 1.8: a table for now only (RAM; a reboot or revertRemap() ends
  // it), so a game's layout never rewrites the dongle's flash.
  async applyRemapTemporary(table: number[]): Promise<void> {
    const report = encodeRemapSet(table, FUNC.remapTemporary);
    const [func, ...rest] = report.subarray(0, 4 + table.length);
    await this.command(func, rest);
  }

  // Protocol 1.9: the Edge's Fn buttons and paddles (REMAP_EXTRA_PARTS order).
  async readRemapExtra(): Promise<number[] | null> {
    const b = await this.transport.getReport(REPORT.remapExtra, 5 + REMAP_EXTRA_COUNT);
    if (b.length < 5 + REMAP_EXTRA_COUNT || b[0] !== 0x52 || b[1] !== 0x58) return null;
    return Array.from(b.subarray(5, 5 + REMAP_EXTRA_COUNT));
  }

  // Saved (temporary = false) or for now only (a game's layout).
  async applyRemapExtra(extra: number[], temporary: boolean): Promise<void> {
    if (!isValidExtra(extra)) throw new Error("Invalid extra-button remap");
    await this.command(FUNC.remapExtra, [0x52, 0x58, 1, ...extra, temporary ? 1 : 0]);
  }

  // Back to the saved remap table (protocol 1.8), and from 1.10 the saved stick curves too.
  async revertRemap(): Promise<void> {
    await this.command(FUNC.remapRevert);
  }

  // Protocol 1.10: the stick response curves of the slot in use now (saved,
  // and what's active: a game's temporary curves while they're on).
  async readStickCurves(): Promise<CurvesReport | null> {
    return decodeCurvesReport(await this.transport.getReport(REPORT.stickCurves, CURVE_REPORT_BYTES));
  }

  // Saved in the dongle's flash for that slot (temporary = false; ends a
  // game's curves), or for now only (a game's profile; RAM, ended by
  // revertRemap(), a reboot or a saved set).
  async applyStickCurves(slot: number, left: StickCurve, right: StickCurve, temporary: boolean): Promise<void> {
    if (!isValidCurve(left) || !isValidCurve(right)) throw new Error("Invalid stick curve");
    await this.command(FUNC.stickCurves, [0x43, 0x56, CURVE_PROTO_VER, slot, ...encodeCurve(left), ...encodeCurve(right), temporary ? 1 : 0]);
  }

  // Re-enumerates USB; the connection drops and the app reconnects on its own.
  async reconnectUsb(): Promise<void> {
    await this.command(FUNC.reconnectUsb);
  }

  async switchSlot(slot: number): Promise<void> {
    await this.command(FUNC.switchSlot, [slot]);
  }

  async forgetSlot(slot: number): Promise<void> {
    await this.command(FUNC.forgetSlot, [slot]);
  }

  async wipeSlots(): Promise<void> {
    await this.command(FUNC.wipeSlots);
  }

  async reboot(): Promise<void> {
    await this.command(FUNC.reboot);
  }

  async enterBootsel(): Promise<void> {
    await this.command(FUNC.bootsel);
  }

  async factoryReset(): Promise<void> {
    await this.command(FUNC.factoryReset);
  }

  // 0 = off, 1-6 = the OLED Trigger Test presets.
  // Rumble on a grip at its current haptics strength (protocol 1.6): ~0.5 s,
  // or, with FEATURES3.timedGripTest (1.15), held steadily for `seconds`
  // (0.1..5; 0 stops a running test, and a new test replaces it).
  async gripTest(side: "left" | "right" | "both", seconds?: number): Promise<void> {
    const s = side === "left" ? 0 : side === "right" ? 1 : 2;
    await this.command(FUNC.gripTest, seconds === undefined ? [s] : [s, Math.max(0, Math.min(50, Math.round(seconds * 10)))]);
  }

  async previewTrigger(preset: number): Promise<void> {
    await this.command(FUNC.triggerPreview, [preset]);
  }

  // The dongle's narrator: NARRATOR_OFF, or 1 + an index into NARRATOR_LANGS.
  // It's the byte after the config body (protocol 1.3); null on older firmware.
  async readNarrator(): Promise<number | null> {
    const bytes = await this.transport.getReport(REPORT.config, CONFIG_BODY_SIZE + 1);
    return bytes.length > CONFIG_BODY_SIZE ? bytes[CONFIG_BODY_SIZE] : null;
  }

  // Saved on the dongle by itself (it never saves other unsaved edits).
  async setNarrator(value: number): Promise<void> {
    await this.command(FUNC.narrator, [value]);
  }

  // Protocol 1.14: the PC sleep options (POWER_FLAGS bits). Saved on the
  // dongle by itself, like the narrator; resolves once the dongle has.
  async setPowerFlags(bits: number): Promise<void> {
    await this.command(FUNC.pcSleep, [bits & (POWER_FLAGS.sleepControllerOff | POWER_FLAGS.psWakesPc)]);
  }

  // Plays one of her firmware lines now, whatever the setting (a preview).
  async sayNarratorLine(line: number, lang: number): Promise<void> {
    await this.command(FUNC.narratorSay, [line, lang]);
  }

  async readFirmwareVersion(): Promise<string> {
    const bytes = await this.transport.getReport(REPORT.version, MAX_REPORT_PAYLOAD);
    let end = bytes.indexOf(0);
    if (end < 0) end = bytes.length;
    return new TextDecoder("ascii").decode(bytes.subarray(0, end));
  }

  // The controller's raw input right now (before remapping): buttons, sticks,
  // triggers, touchpad, motion, battery and the active trigger effects.
  // null without a controller: the dongle then answers all zeros, which would
  // decode as D-pad up, both sticks in a corner and two fingers touching.
  async readInput(): Promise<InputReport | null> {
    const bytes = await this.transport.getReport(REPORT.liveInput, 63);
    return bytes.some((b) => b !== 0) ? decodeInputReport(bytes) : null;
  }

  async readRssi(): Promise<number> {
    const bytes = await this.transport.getReport(REPORT.rssi, 1);
    if (bytes.length < 1) return 0;
    return bytes[0] >= 128 ? bytes[0] - 256 : bytes[0];
  }

  async readSlots(): Promise<SlotsInfo> {
    const data = await this.transport.getReport(REPORT.slots, 28);
    if (data.length < 28) throw new Error("Short slots report");
    const addrs = [0, 1, 2, 3].map((i) => data.slice(i * 6, i * 6 + 6));
    const occupied = [0, 1, 2, 3].map((i) => data[24 + i] === 1);
    return { addrs, occupied };
  }

  async readDiag(): Promise<DiagInfo> {
    const view = toView(await this.transport.getReport(REPORT.diag, 18), 18);
    return {
      uptimeSeconds: view.getUint32(0, true),
      usbFrames: view.getUint32(4, true),
      btPackets: view.getUint32(8, true),
      peakSpeaker: view.getUint8(12),
      peakHaptic: view.getUint8(13),
      hciErrors: view.getUint32(14, true),
    };
  }

  // withTimings: protocol 1.11 (FEATURES2.timings) only; older firmware is asked for 11 bytes as before.
  async readCpu(withTimings = false): Promise<CpuInfo> {
    const info = decodeCpu(await this.transport.getReport(REPORT.cpu, withTimings ? CPU_TIMINGS_REPORT_BYTES : CPU_REPORT_BYTES));
    return withTimings ? info : { ...info, timings: null };
  }

  // Protocol 1.11: starts the timing counters (0xFC [11..62]) over.
  async resetTimings(): Promise<void> {
    await this.command(FUNC.resetTimings);
  }

  // The calibration of the pairing slot in use now (each slot has its own).
  async readCalibration(): Promise<{ slot: number; calibration: Calibration }> {
    const bytes = await this.transport.getReport(REPORT.calibration, 1 + CALIB_BODY_SIZE);
    return { slot: bytes[0], calibration: decodeCalibration(bytes.subarray(1)) };
  }

  // Stored in the dongle's flash at once, for that slot; applies to what games see.
  async setCalibration(slot: number, c: Calibration): Promise<void> {
    await this.command(FUNC.calibration, [0x43, 0x4c, CALIB_PROTO_VER, slot, ...encodeCalibration(c)]);
  }

  async readOledFrame(): Promise<OledFrame | null> {
    const bytes = await this.transport.getReport(REPORT.oledMirror, OLED_MIRROR_BYTES);
    if (bytes.length < OLED_MIRROR_BYTES) return null;
    return { power: bytes[0] === 2 ? "off" : bytes[0] === 1 ? "dim" : "on", screen: bytes[1], contrast: bytes[2], seq: bytes[3], pixels: bytes.slice(4) };
  }

  // Protocol 1.12: what the dongle knows about the controller right now.
  async readControllerHeader(): Promise<CtrlHeader | null> {
    return decodeCtrlHeader(await this.transport.getReport(ctrlInfoReport(CTRL_SEL.header), CTRL_HEADER_BYTES));
  }

  // The controller's own firmware (its cached report 0x20); null until the
  // controller has sent it.
  async readControllerFirmware(): Promise<ControllerFirmware | null> {
    return decodeControllerFirmware(await this.transport.getReport(ctrlInfoReport(CTRL_SEL.firmware), CTRL_FIRMWARE_BYTES));
  }

  // Runs a read-only controller test command (controllerInfo.ts CTRL_TEST)
  // and returns its answer, `pages` x 56 bytes, or null when the controller
  // doesn't answer it (older controller firmware). The dongle sends it over
  // Bluetooth from its main loop; this polls until it's done.
  async runControllerTest(dev: number, action: number, pages: number): Promise<Uint8Array | null> {
    const before = await this.readControllerHeader();
    if (!before) throw new Error("Your board sent no controller info.");
    await this.command(FUNC.controllerTest, [dev, action, pages]);
    const expected = (before.request + 1) & 0xff;
    const deadline = Date.now() + CONTROLLER_TEST_TIMEOUT_MS;
    for (;;) {
      const h = await this.readControllerHeader();
      if (!h || h.request !== expected) throw new Error("Another program asked the controller at the same time. Try again.");
      if (h.state === "done") {
        const out = new Uint8Array(pages * CTRL_PAGE_BYTES);
        for (let p = 0; p < Math.min(h.pages, pages, CTRL_MAX_PAGES); p++) {
          const r = await this.transport.getReport(ctrlInfoReport(CTRL_SEL.page0 + p), CTRL_PAGE_REPLY_BYTES);
          if (r.length < CTRL_PAGE_REPLY_BYTES || r[0] !== p || r[2] !== expected) throw new Error("Short controller answer");
          out.set(r.subarray(3, CTRL_PAGE_REPLY_BYTES), p * CTRL_PAGE_BYTES);
        }
        return out;
      }
      if (h.state === "noAnswer") return null;
      if (h.state !== "running") throw new Error("The controller disconnected.");
      if (Date.now() > deadline) throw new Error("The controller did not answer in time.");
      await sleep(CONTROLLER_TEST_POLL_MS);
    }
  }

  async readAudioCounters(): Promise<AudioCounters> {
    return decodeAudioCounters(await this.transport.getReport(REPORT.audioCounters, AUDIO_COUNTERS_BYTES));
  }
}

// 0xF5: the 15 counters, then core1's health when the firmware sends the
// 63-byte layout (see CORE1_HEALTH_LAYOUT). core1FreeHeap is in bytes (KiB
// precision), undefined while not known; core1Stage only with that layout.
export function decodeAudioCounters(bytes: Uint8Array): AudioCounters {
  const base = AUDIO_COUNTER_NAMES.length * 4;
  const view = toView(bytes, base);
  const out = {} as AudioCounters;
  AUDIO_COUNTER_NAMES.forEach((name, i) => (out[name] = view.getUint32(i * 4, true)));
  if (view.byteLength >= AUDIO_COUNTERS_BYTES && (bytes[base] & CORE1_HEALTH_LAYOUT) !== 0) {
    out.core1Flags = bytes[base] & ~(CORE1_HEALTH_LAYOUT | CORE1_STAGE_MASK);
    out.core1Stage = (bytes[base] & CORE1_STAGE_MASK) >> CORE1_STAGE_SHIFT;
    const kib = view.getUint16(base + 1, true);
    if (kib > 0) out.core1FreeHeap = kib * 1024;
  }
  return out;
}

function toView(bytes: Uint8Array, need: number): DataView {
  if (bytes.length < need) throw new Error(`Short report (${bytes.length} < ${need} bytes)`);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
