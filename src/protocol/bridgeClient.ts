// High-level client for the dongle's configurator protocol (firmware src/cmd.cpp),
// over any Ds5Transport. Report payloads here never include the report-id byte.
import { CONFIG_BODY_SIZE, CONFIG_BODY_SIZE_SPLIT, type ConfigBody, decodeConfigBody, encodeConfigBody } from "./config";
import { CALIB_BODY_SIZE, CALIB_PROTO_VER, decodeCalibration, encodeCalibration, type Calibration } from "./calibration";
import { type RemapState, decodeRemapFromConfigReport, encodeRemapSet } from "./remap";
import { DeviceGoneError, MAX_REPORT_PAYLOAD, type Ds5Transport, OLED_MIRROR_BYTES } from "./transport";
import { decodeInputReport, type InputReport } from "../oled/inputReport";

export const REPORT = {
  liveInput: 0xf0, // protocol 1.2+, feature bit FEATURE.liveInput
  identity: 0xf1,
  audioCounters: 0xf5,
  command: 0xf6,
  config: 0xf7,
  version: 0xf8,
  rssi: 0xf9,
  slots: 0xfa,
  diag: 0xfb,
  cpu: 0xfc,
  oledMirror: 0xef, // protocol 1.4+, feature bit FEATURES2.oledMirror
  calibration: 0xee, // protocol 1.5+, feature bit FEATURES2.calibration
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
} as const;

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

// A protocol 1.x addition announced in identity [29] (FEATURES2).
export function supportsFeature2(identity: BridgeIdentity | null, minMinor: number, bit: number): boolean {
  return !!identity && (identity.protoMajor > 1 || identity.protoMinor >= minMinor) && (identity.features2 & bit) !== 0;
}

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
    throw new Error("The dongle did not identify itself (expected DS5O). Update the firmware.");
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
  };
}

export class CommandError extends Error {
  constructor(
    public readonly func: number,
    public readonly result: CommandResult,
  ) {
    super(`Dongle command 0x${func.toString(16).padStart(2, "0")} ${result === "failed" ? "failed" : `was rejected (${result})`}`);
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
// Firmware 0.9.4+: core1's health after the counters (issue #15): flags bit0
// started, bit1 speaker encoder failed (no memory), bit2 mic decoder failed;
// and the free heap when core1 started. Absent on older firmware.
export const CORE1_SPEAKER_FAILED = 0x02;
export type AudioCounters = Record<(typeof AUDIO_COUNTER_NAMES)[number], number> & { core1Flags?: number; core1FreeHeap?: number };

const POLL_INTERVAL_MS = 20;
const COMMAND_TIMEOUT_MS = 3000;

export class Ds5BridgeClient {
  constructor(public readonly transport: Ds5Transport) {}

  get isOpen(): boolean {
    return this.transport.isOpen;
  }

  // The firmware's protocol, as of the last identity read (decides the config layout).
  private protocol: { major: number; minor: number } | null = null;

  async identity(): Promise<BridgeIdentity> {
    const id = decodeIdentity(await this.transport.getReport(REPORT.identity, 46));
    this.protocol = { major: id.protoMajor, minor: id.protoMinor };
    return id;
  }

  // Protocol 1.6+: left and right grip haptics strengths.
  get splitHaptics(): boolean {
    return !!this.protocol && (this.protocol.major > 1 || this.protocol.minor >= 6);
  }

  // Throws if the dongle speaks a protocol major this app doesn't understand.
  async checkCompatible(): Promise<BridgeIdentity> {
    const id = await this.identity();
    if (id.protoMajor !== SUPPORTED_PROTO_MAJOR) {
      throw new Error(`Dongle protocol ${id.protoMajor}.${id.protoMinor} is not supported by this app (needs ${SUPPORTED_PROTO_MAJOR}.x). Update the app or the firmware.`);
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
      if (id.sequence !== expected) throw new Error("Another program sent a command to the dongle at the same time. Try again.");
      if (id.lastResult === "ok") return "ok";
      if (id.lastResult !== "pending") throw new CommandError(func, id.lastResult);
      if (Date.now() > deadline) throw new Error("The dongle did not finish the command in time.");
      await sleep(POLL_INTERVAL_MS);
    }
  }

  async readConfig(): Promise<ConfigBody> {
    return decodeConfigBody(await this.transport.getReport(REPORT.config, CONFIG_BODY_SIZE_SPLIT));
  }

  // Applies to the dongle's RAM; takes effect immediately. saveToFlash() persists.
  async applyConfig(config: ConfigBody): Promise<void> {
    const body = encodeConfigBody(config, this.splitHaptics);
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

  async revertRemap(): Promise<void> {
    await this.command(FUNC.remapRevert);
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
  // ~0.5 s of rumble on a grip at its current haptics strength (protocol 1.6).
  async gripTest(side: "left" | "right" | "both"): Promise<void> {
    await this.command(FUNC.gripTest, [side === "left" ? 0 : side === "right" ? 1 : 2]);
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

  async readCpu(): Promise<CpuInfo> {
    const view = toView(await this.transport.getReport(REPORT.cpu, 11), 11);
    return { setKhz: view.getUint32(0, true), measuredKhz: view.getUint32(4, true), vregCode: view.getUint8(8), tempRaw: view.getUint16(9, true) };
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

  async readAudioCounters(): Promise<AudioCounters> {
    const base = AUDIO_COUNTER_NAMES.length * 4;
    const view = toView(await this.transport.getReport(REPORT.audioCounters, base + 8), base);
    const out = {} as AudioCounters;
    AUDIO_COUNTER_NAMES.forEach((name, i) => (out[name] = view.getUint32(i * 4, true)));
    if (view.byteLength >= base + 8) {
      out.core1Flags = view.getUint32(base, true);
      out.core1FreeHeap = view.getUint32(base + 4, true);
    }
    return out;
  }
}

function toView(bytes: Uint8Array, need: number): DataView {
  if (bytes.length < need) throw new Error(`Short report (${bytes.length} < ${need} bytes)`);
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
