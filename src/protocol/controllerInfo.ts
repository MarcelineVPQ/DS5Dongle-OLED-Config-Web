// Controller health & info (firmware protocol 1.12, identity [46] bit 0):
// GET 0xEB with a selector in wValue's high byte, and 0xF6 0x16 [dev, action,
// pages] to run one of two read-only Sony test commands (firmware
// src/ctrl_info.cpp). The dongle blanks every serial number before the app can
// read it; these parsers never look at those bytes either.
//
// Field offsets of the firmware report (0x20), the Bluetooth patch (0x22),
// the lifetime-counter block (test command 0x70/1, both models) and the
// counters' NVRAM decoding follow daidr/dualsense-tester (MIT, Copyright (c)
// 2023 Xuezhou Dai; src/utils/dualsense/telemetry.util.ts and the
// FactoryInfo views; license in src/assets/DAIDR-LICENSE.txt).

export const CTRL_INFO_REPORT = 0xeb;
export const CTRL_SEL = { header: 0x00, firmware: 0x01, page0: 0x10 } as const;
// The value a GET carries: selector in the high byte, report id in the low.
export const ctrlInfoReport = (selector: number) => ((selector & 0xff) << 8) | CTRL_INFO_REPORT;

export const CTRL_HEADER_BYTES = 14;
export const CTRL_FIRMWARE_BYTES = 60;
export const CTRL_PAGE_BYTES = 56;
export const CTRL_PAGE_REPLY_BYTES = 3 + CTRL_PAGE_BYTES;
export const CTRL_MAX_PAGES = 6;

// The two commands the firmware runs (anything else is refused).
export const CTRL_TEST = {
  telemetry: { dev: 0x70, action: 0x01 },
  battery: { dev: 0x04, action: 0x03 },
} as const;
// Pages of the counters block: the DualSense's ends at offset 190 (4 pages),
// the Edge's at 256 (5, read up to 6).
export const telemetryPages = (edge: boolean) => (edge ? 6 : 4);

// The full counters block needs controller firmware newer than this
// (the 0x20 report's update version); older ones only give the play time.
export const TELEMETRY_MIN_UPDATE = { dualsense: 1106, edge: 374 } as const;

export type CtrlTestState = "idle" | "running" | "done" | "noAnswer" | "noController";
const STATES: readonly CtrlTestState[] = ["idle", "running", "done", "noAnswer", "noController"];

export interface CtrlHeader {
  state: CtrlTestState;
  dev: number;
  action: number;
  pages: number;
  request: number; // bumps on every accepted 0xF6 0x16
  model: "dualsense" | "edge" | null;
  hasFirmware: boolean;
  btPatch: number | null;
}

export function decodeCtrlHeader(b: Uint8Array): CtrlHeader | null {
  if (b.length < CTRL_HEADER_BYTES || b[0] !== 0x43 || b[1] !== 0x48 || b[2] !== 1) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return {
    state: STATES[b[3]] ?? "noAnswer",
    dev: b[4],
    action: b[5],
    pages: b[6],
    request: b[7],
    model: b[8] === 0 ? "dualsense" : b[8] === 1 ? "edge" : null,
    hasFirmware: (b[9] & 0x01) !== 0,
    btPatch: (b[9] & 0x02) !== 0 ? view.getUint32(10, true) : null,
  };
}

export interface ControllerFirmware {
  buildDate: string; // "Jun 29 2023 10:20:30"
  fwType: number;
  swSeries: number;
  hwInfo: number;
  mainFw: number;
  updateVersion: number;
  sbl: number;
  dsp: number;
  mcuDsp: number;
}

function ascii(b: Uint8Array, from: number, len: number): string {
  let s = "";
  for (let i = from; i < from + len && b[i]; i++) if (b[i] >= 0x20 && b[i] < 0x7f) s += String.fromCharCode(b[i]);
  return s.trim();
}

// Selector 0x01: [0] bit0 valid, then report 0x20 bytes 1..59 at their own offsets.
export function decodeControllerFirmware(b: Uint8Array): ControllerFirmware | null {
  if (b.length < CTRL_FIRMWARE_BYTES || (b[0] & 0x01) === 0) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return {
    buildDate: `${ascii(b, 1, 11)} ${ascii(b, 12, 8)}`.trim(),
    fwType: v.getUint16(20, true),
    swSeries: v.getUint16(22, true),
    hwInfo: v.getUint32(24, true),
    mainFw: v.getUint32(28, true),
    updateVersion: v.getUint16(44, true),
    sbl: v.getUint32(48, true),
    dsp: v.getUint32(52, true),
    mcuDsp: v.getUint32(56, true),
  };
}

const hex = (n: number, digits: number) => n.toString(16).toUpperCase().padStart(digits, "0");
export const formatThreePart = (v: number) => `${(v >>> 24) & 0xff}.${(v >>> 16) & 0xff}.${v & 0xffff}`;
export const formatUpdateVersion = (v: number) => `${hex((v >> 8) & 0xff, 1)}.${hex(v & 0xff, 2)}`;
export const formatDspVersion = (v: number) => `${hex((v >>> 16) & 0xffff, 4)}_${hex(v & 0xffff, 4)}`;
export const formatHex32 = (v: number) => `0x${hex(v >>> 0, 8)}`;

// #region Player indicator wiring
// How the five player lights under the touch pad answer the pattern's bits
// 0..4. Report 0x20's hardware info (bytes 24..27, the same u32 Linux
// hid-playstation shows as hw_version) carries the board generation in bits
// 8..15 (controllers.fandom.com, Sony DualSense / Data Structures, by Nielk1:
// "0x00FF0000 - Variation, 0x0000FF00 - Generation"). Generation 0x03 drives
// each light on its own; later boards wire them in mirrored pairs: bit 0 and
// bit 4 both light the two outer lights, bits 1 and 3 the two inner ones,
// bit 2 the center. The wiki's suggested test is (hw & 0x00FFFF00) == 0x0400,
// but a generation 0x07 DualSense (hw 0x00000711) lights both outer lights
// for 0x01, so everything after 0x03 counts as paired. Unknown (no controller
// info yet, or firmware before protocol 1.12) is paired too: that is how
// current DualSense and Edge units are built, and the standard player
// patterns (0x04, 0x0A, 0x15, 0x1B, 0x1F) are symmetric, so they look the
// same either way.
export type PlayerLightWiring = "paired" | "individual";

export function playerLightWiring(hwInfo: number | null | undefined): PlayerLightWiring {
  const generation = hwInfo == null ? 0 : (hwInfo >>> 8) & 0xff;
  return generation >= 1 && generation <= 3 ? "individual" : "paired";
}

// The lights on for a pattern: bit n = drawn light n (0..4, left to right).
export function litPlayerLights(pattern: number, wiring: PlayerLightWiring): number {
  const bits = pattern & 0x1f;
  if (wiring === "individual") return bits;
  const outer = bits & 0x11 ? 0x11 : 0;
  const inner = bits & 0x0a ? 0x0a : 0;
  return outer | inner | (bits & 0x04);
}
// #endregion

export const telemetrySupported = (fw: ControllerFirmware, edge: boolean) => fw.updateVersion > (edge ? TELEMETRY_MIN_UPDATE.edge : TELEMETRY_MIN_UPDATE.dualsense);

// #region NVRAM decoding: unwritten flash (0xFF...) and factory offsets read as 0.
function buttonCount(d: DataView, i: number): number {
  const v = d.getUint32(i, true);
  const low = v & 0xffff;
  const high = (v >>> 16) & 0xffff;
  if (high === 0) return low;
  if (high >= 0xff00 && low >= 0xff00) return 0;
  return low;
}
function buttonCountHigh(d: DataView, i: number): number {
  const v = d.getUint16(i + 2, true);
  return v < 0xff00 ? v : 0;
}
function low24(d: DataView, i: number): number {
  const v = d.getUint32(i, true) & 0xffffff;
  return v < 0xffff00 ? v : 0;
}
function u32(d: DataView, i: number): number {
  const v = d.getUint32(i, true);
  return v === 0xffffffff ? 0 : v;
}
function ushortCounter(d: DataView, i: number): number {
  return d.getUint8(i + 1) < 0xe0 ? d.getUint16(i, true) : d.getUint8(i);
}
function edgeStroke(d: DataView, i: number): number {
  const v = d.getUint32(i, true);
  const low = v & 0xffff;
  const high = (v >>> 16) & 0xffff;
  if (low >= 0xff00) {
    const decoded = v - (high * 0x10000 + 0xff00);
    if (decoded >= 0 && decoded < 100000) return decoded;
  }
  return high === 0 ? low : v;
}
// #endregion

export interface StickWear {
  roundTripsX: number;
  roundTripsY: number;
}

export interface Telemetry {
  // Seconds.
  activeTime: number;
  chargeTime: number;
  hapticsTime: number;
  triggerTime: [left: number, right: number];
  chargeCycles: number;
  fullCharges: number;
  chargerConnects: number;
  chargeErrors: { voltage: number; temperature: number; pmic: number };
  usbConnects: number;
  bluetoothConnects: number;
  bluetoothTimeouts: number;
  headsetDetects: number;
  // Presses per button (the Edge's L2/R2 per stroke depth summed).
  buttons: Record<string, number>;
  sticks: [left: StickWear, right: StickWear];
}

const STANDARD_BUTTONS: Array<[string, number]> = [
  ["up", 110],
  ["down", 114],
  ["left", 118],
  ["right", 122],
  ["triangle", 126],
  ["cross", 130],
  ["square", 134],
  ["circle", 138],
  ["l1", 142],
  ["l2", 146],
  ["l3", 150],
  ["r1", 154],
  ["r2", 158],
  ["r3", 162],
  ["touchpad", 170],
  ["options", 174],
  ["create", 178],
  ["ps", 182],
  ["mute", 186],
];
const EDGE_BUTTONS: Array<[string, number]> = [
  ["up", 86],
  ["down", 90],
  ["left", 94],
  ["right", 98],
  ["triangle", 102],
  ["cross", 106],
  ["square", 110],
  ["circle", 114],
  ["l1", 118],
  ["r1", 134],
  ["touchpad", 154],
  ["options", 158],
  ["create", 162],
  ["ps", 166],
];

// The counters block as GET 0xEB pages hand it over: a status byte, then the
// structure. Needs the whole structure (190 bytes, the Edge's 256).
export function decodeTelemetry(block: Uint8Array, edge: boolean): Telemetry | null {
  const need = 1 + (edge ? 256 : 190);
  if (block.length < need) return null;
  const d = new DataView(block.buffer, block.byteOffset + 1, block.byteLength - 1);
  const buttons: Record<string, number> = {};
  let sticks: Telemetry["sticks"];
  if (edge) {
    for (const [key, off] of EDGE_BUTTONS) buttons[key] = buttonCount(d, off);
    buttons.l2 = edgeStroke(d, 122) + edgeStroke(d, 126) + edgeStroke(d, 130);
    buttons.r2 = edgeStroke(d, 138) + edgeStroke(d, 142) + edgeStroke(d, 146);
    buttons.mute = buttonCountHigh(d, 170);
    buttons.paddleLeft = buttonCountHigh(d, 174);
    buttons.paddleRight = buttonCountHigh(d, 178);
    // The swappable stick modules count their own clicks (their serials at
    // 182 / 219 are skipped; the "function button" counts there are left out
    // until it's clear which button they mean).
    buttons.l3 = u32(d, 211);
    buttons.r3 = u32(d, 248);
    sticks = [
      { roundTripsX: u32(d, 199), roundTripsY: u32(d, 205) },
      { roundTripsX: u32(d, 236), roundTripsY: u32(d, 242) },
    ];
  } else {
    for (const [key, off] of STANDARD_BUTTONS) buttons[key] = buttonCount(d, off);
    sticks = [
      { roundTripsX: u32(d, 86), roundTripsY: u32(d, 92) },
      { roundTripsX: u32(d, 98), roundTripsY: u32(d, 104) },
    ];
  }
  return {
    activeTime: low24(d, 21),
    chargeTime: low24(d, 25),
    hapticsTime: low24(d, 29),
    triggerTime: [buttonCount(d, 33), buttonCount(d, 37)],
    chargeCycles: ushortCounter(d, 41),
    chargerConnects: d.getUint16(55, true),
    chargeErrors: { voltage: d.getUint8(57), temperature: d.getUint8(58), pmic: d.getUint8(59) },
    fullCharges: d.getUint16(60, true),
    headsetDetects: d.getUint16(62, true) + d.getUint16(64, true),
    usbConnects: d.getUint16(66, true),
    bluetoothConnects: d.getUint16(68, true),
    bluetoothTimeouts: d.getUint16(70, true),
    buttons,
    sticks,
  };
}

// Older controller firmware: only the play time in the block is reliable.
export function decodeActiveTimeOnly(block: Uint8Array): number | null {
  if (block.length < 1 + 25) return null;
  const v = low24(new DataView(block.buffer, block.byteOffset + 1, block.byteLength - 1), 21);
  return v > 0 ? v : null;
}

// Battery voltage (test 0x04/3): u16 millivolts; anything outside a Li-ion
// cell's range is a garbled answer.
export function decodeBatteryMillivolts(page: Uint8Array): number | null {
  if (page.length < 2) return null;
  const mv = page[0] | (page[1] << 8);
  return mv >= 2500 && mv <= 5000 ? mv : null;
}

// The input report's power state (byte 52's high nibble, 0xF0 live input).
export type ChargeState = "discharging" | "charging" | "full" | "voltageError" | "temperatureError" | "chargeError" | "unknown";
export function chargeState(batteryState: number): ChargeState {
  switch (batteryState) {
    case 0:
      return "discharging";
    case 1:
      return "charging";
    case 2:
      return "full";
    case 10:
      return "voltageError";
    case 11:
      return "temperatureError";
    case 15:
      return "chargeError";
    default:
      return "unknown";
  }
}
