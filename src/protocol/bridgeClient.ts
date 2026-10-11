// High-level client for the dongle's configurator protocol (firmware src/cmd.cpp),
// over any Ds5Transport. Report payloads here never include the report-id byte.
import { CONFIG_BODY_SIZE, type ConfigBody, decodeConfigBody, encodeConfigBody } from "./config";
import { type RemapState, decodeRemapFromConfigReport, encodeRemapSet } from "./remap";
import { DeviceGoneError, MAX_REPORT_PAYLOAD, type Ds5Transport } from "./transport";
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
  remap: 0x10,
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
} as const;

export type CommandResult = "ok" | "pending" | "invalid" | "failed" | "busy";
const RESULTS: readonly CommandResult[] = ["ok", "pending", "invalid", "failed", "busy"];

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
}

// The DualSense's player patterns (as Linux and games set them) -> player number.
const PLAYER_PATTERNS: Record<number, number> = { 0x04: 1, 0x0a: 2, 0x15: 3, 0x1b: 4, 0x1f: 5 };
export function playerNumber(leds: number): number | null {
  return PLAYER_PATTERNS[leds & 0x1f] ?? null;
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
export type AudioCounters = Record<(typeof AUDIO_COUNTER_NAMES)[number], number>;

const POLL_INTERVAL_MS = 20;
const COMMAND_TIMEOUT_MS = 3000;

export class Ds5BridgeClient {
  constructor(public readonly transport: Ds5Transport) {}

  get isOpen(): boolean {
    return this.transport.isOpen;
  }

  async identity(): Promise<BridgeIdentity> {
    return decodeIdentity(await this.transport.getReport(REPORT.identity, 29));
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
    return decodeConfigBody(await this.transport.getReport(REPORT.config, CONFIG_BODY_SIZE));
  }

  // Applies to the dongle's RAM; takes effect immediately. saveToFlash() persists.
  async applyConfig(config: ConfigBody): Promise<void> {
    const body = encodeConfigBody(config);
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
  async previewTrigger(preset: number): Promise<void> {
    await this.command(FUNC.triggerPreview, [preset]);
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

  async readAudioCounters(): Promise<AudioCounters> {
    const view = toView(await this.transport.getReport(REPORT.audioCounters, AUDIO_COUNTER_NAMES.length * 4), AUDIO_COUNTER_NAMES.length * 4);
    const out = {} as AudioCounters;
    AUDIO_COUNTER_NAMES.forEach((name, i) => (out[name] = view.getUint32(i * 4, true)));
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
