// Tension (protocol 1.23): your own adaptive trigger effects, run by the board.
// The contract is the firmware's docs/TENSION.md (sections 2 and 7) and its
// src/tension.h; every layout and rule here is that one, byte for byte, so the
// board never answers INVALID to what the app sends. Change both together.
//
// A set (e.g. "Bow") holds one Program for L2 and one for R2. A Program is up
// to 4 stages; a stage is one of the DualSense's trigger effects plus a pull
// window and a hold time, and may ramp one parameter by pull or by time held.
//
// SetBody (134 bytes, wire = flash, little-endian, packed; TENSION.md §2):
//   [0] ver 1 · [1] flags 0 · [2..17] name, ASCII 0x20..0x7E, NUL-padded
//   [18..75] L2's Program · [76..133] R2's Program
// Program (58): [0] count 0..4 (0 = leave the trigger to the game) · [1] policy
//   0 Fill in / 1 Replace · [2..57] 4 × Stage (unused ones all zero)
// Stage (14): [0] mode · [1..7] p0..p6 · [8] pull_min · [9] pull_max ·
//   [10] hold_min (tenths) · [11] ramp (bits 0..2 param index + 1, bit 7 by
//   hold) · [12] ramp_to · [13] ramp_time (tenths, by hold only)
//
// Effect parameters and ranges: TENSION.md's effect table (Sony's API ranges;
// the effect bytes are Nielk1's TriggerEffectGenerator rev 6, MIT, © 2021-2022
// John "Nielk1" Klein, which the board encodes; the app only draws the zones
// the same way, see zoneLevels; credited in About → Credits). Staging effects
// by pull position on the board: an idea seen in artzox/DS5Dongle-Studio (MIT).
//
// Protocol 1.24 (the firmware's docs/TENSION_BUTTONS.md §3, §6): a set also
// holds a button layout, the 360-byte ButtonPart (buttons.ts). On the wire
// the staged buffer is then 494 bytes, SetBody [0..133] + ButtonPart
// [134..493], staged with 0x1C ver 2 and saved / felt with 0x1D / 0x1E ver 2.
import { BUTTON_PART_BYTES, buttonPartValid, decodeButtonPart, encodeButtonPart, type ButtonPart } from "./buttons";

export const TENSION_WIRE_VER = 1; // tension::kWireVer: the 0xF6 0x1C..0x20 framing and the 0xE9 replies
export const TENSION_RECORD_VER = 1; // SetBody::ver
export const TENSION_SLOTS = 8;
export const TENSION_STAGES = 4;
export const TENSION_NAME_LEN = 16;
export const SET_BODY_BYTES = 134;
const PROGRAM_BYTES = 58;
const STAGE_BYTES = 14;
const PARAMS = 7;
// 0x20's slot byte: no set, and back to the saved choice (TENSION.md §7).
export const TENSION_NONE = 0xff;
export const TENSION_BACK_TO_SAVED = 0xfe;
// 0x1C carries at most 60 bytes (a SET is ≤ 63 bytes: func, ver, offset, data).
export const TENSION_STAGE_CHUNK = 60;
// Protocol 1.24: the 494-byte wire buffer (TENSION_BUTTONS.md §3.1), 0x1C ver 2
// = [2, offset lo, offset hi, data ≤ 59] (§6.1): nine SETs for a whole set.
export const TENSION_WIRE_VER_BUTTONS = 2;
export const SET_WIRE_BYTES = 134 + BUTTON_PART_BYTES;
export const TENSION_STAGE_CHUNK_V2 = 59;
// GET 0xE9: the selector is wValue's high byte (like 0xEB).
export const TENSION_REPORT = 0xe9;
export const TENSION_SEL = { status: 0x00, list: 0x01 } as const;
export const tensionReport = (selector: number) => ((selector & 0xff) << 8) | TENSION_REPORT;
export const tensionChunkSel = (slot: number, chunk: number) => 0x40 | ((slot & 7) << 2) | (chunk & 3);
export const TENSION_STATUS_BYTES = 38;
export const TENSION_LIST_BYTES = 38;
const SET_CHUNK = 56;
// Reply lengths of the three chunks: 4 header bytes + 56, 56, 22.
export const TENSION_CHUNK_REPLY_BYTES = [60, 60, 26] as const;

// Our effect ids (tension::Mode), not the wire's mode bytes.
export const EFFECT = {
  off: 0,
  feedback: 1,
  weapon: 2,
  vibration: 3,
  multiFeedback: 4,
  slopeFeedback: 5,
  multiVibration: 6,
  bow: 7,
  galloping: 8,
  machine: 9,
} as const;
export type EffectKey = keyof typeof EFFECT;

// What a parameter is (its label key) and its range given the others: `after`
// = it must be greater than that parameter (Sony's "end > start" rules).
export interface ParamSpec {
  key: "position" | "strength" | "start" | "end" | "amplitude" | "frequency" | "startStrength" | "endStrength" | "snap" | "firstFoot" | "secondFoot" | "amplitudeA" | "amplitudeB" | "period";
  min: number;
  max: number;
  after?: number;
}
export interface EffectSpec {
  id: number;
  key: EffectKey;
  official: boolean; // Bow, Galloping and Machine are left in the controller's firmware, not in Sony's API
  // Felt as resistance or as vibration (how the diagram draws it).
  kind: "none" | "resistance" | "vibration";
  params: ParamSpec[];
  // The two Multiple Position effects: ten zone levels 0..8 packed in
  // nibbles from this parameter on (zone 2i low, 2i+1 high).
  zonesAt?: number;
  // How many of p0..p6 the effect uses (tension::kParamCount).
  used: number;
}

const P = (key: ParamSpec["key"], min: number, max: number, after?: number): ParamSpec => ({ key, min, max, ...(after === undefined ? {} : { after }) });

// TENSION.md §2's effect table. Bow's start is 0..7 in effect (its end is
// start + 1..8); the board's check is the same.
export const EFFECTS: readonly EffectSpec[] = [
  { id: 0, key: "off", official: true, kind: "none", params: [], used: 0 },
  { id: 1, key: "feedback", official: true, kind: "resistance", params: [P("position", 0, 9), P("strength", 0, 8)], used: 2 },
  { id: 2, key: "weapon", official: true, kind: "resistance", params: [P("start", 2, 7), P("end", 3, 8, 0), P("strength", 0, 8)], used: 3 },
  { id: 3, key: "vibration", official: true, kind: "vibration", params: [P("position", 0, 9), P("amplitude", 0, 8), P("frequency", 0, 255)], used: 3 },
  { id: 4, key: "multiFeedback", official: true, kind: "resistance", params: [], zonesAt: 0, used: 5 },
  { id: 5, key: "slopeFeedback", official: true, kind: "resistance", params: [P("start", 0, 8), P("end", 1, 9, 0), P("startStrength", 1, 8), P("endStrength", 1, 8)], used: 4 },
  { id: 6, key: "multiVibration", official: true, kind: "vibration", params: [P("frequency", 0, 255)], zonesAt: 1, used: 6 },
  { id: 7, key: "bow", official: false, kind: "resistance", params: [P("start", 0, 7), P("end", 1, 8, 0), P("strength", 0, 8), P("snap", 0, 8)], used: 4 },
  {
    id: 8,
    key: "galloping",
    official: false,
    kind: "vibration",
    params: [P("start", 0, 8), P("end", 1, 9, 0), P("firstFoot", 0, 6), P("secondFoot", 1, 7, 2), P("frequency", 0, 255)],
    used: 5,
  },
  {
    id: 9,
    key: "machine",
    official: false,
    kind: "vibration",
    params: [P("start", 0, 8), P("end", 1, 9, 0), P("amplitudeA", 0, 7), P("amplitudeB", 0, 7), P("frequency", 0, 255), P("period", 0, 255)],
    used: 6,
  },
];
export const effectSpec = (mode: number): EffectSpec | undefined => EFFECTS[mode];

export type TensionRamp = { param: number; to: number; by: "pull" } | { param: number; to: number; by: "hold"; tenths: number };
export interface TensionStage {
  mode: number;
  p: number[]; // 7 values; unused ones 0
  pullMin: number; // pull 0..255, as the trigger calibration corrects it (TENSION.md §2, §3)
  pullMax: number;
  holdTenths: number; // 0..255 = 0..25.5 s
  ramp: TensionRamp | null;
}
export type TensionPolicy = "fill" | "replace";
export interface TensionProgram {
  stages: TensionStage[]; // 0..4; none = this set leaves the trigger to the game
  policy: TensionPolicy;
}
export interface TensionSet {
  name: string;
  l2: TensionProgram;
  r2: TensionProgram;
  // Protocol 1.24: the set's button layout; absent = the set leaves the buttons as they are.
  buttons?: ButtonPart;
}

// ---- Validation (tension.h params_valid / stage_valid / set_valid) ----

// Zone z's level in a packed block (tension::zone_level).
export const zoneLevel = (p: readonly number[], at: number, zone: number) => (p[at + (zone >> 1)] >> (4 * (zone & 1))) & 0x0f;
export function withZoneLevel(p: readonly number[], at: number, zone: number, level: number): number[] {
  const out = [...p];
  const i = at + (zone >> 1);
  const shift = 4 * (zone & 1);
  out[i] = (out[i] & ~(0x0f << shift) & 0xff) | ((level & 0x0f) << shift);
  return out;
}

export function paramsValid(mode: number, p: readonly number[]): boolean {
  const spec = EFFECTS[mode];
  if (!spec || p.length !== PARAMS) return false;
  // loop: HOT-PATH-OK — N = 7 parameters, validating one stage
  if (p.some((v, i) => !Number.isInteger(v) || v < 0 || v > 255 || (i >= spec.used && v !== 0))) return false;
  if (spec.zonesAt !== undefined) {
    // loop: HOT-PATH-OK — N = 10 zones, validating one stage
    for (let z = 0; z < 10; z++) if (zoneLevel(p, spec.zonesAt, z) > 8) return false;
  }
  // loop: HOT-PATH-OK — N ≤ 6 parameters, validating one stage
  return spec.params.every((ps, i) => p[i] >= ps.min && p[i] <= ps.max && (ps.after === undefined || p[i] > p[ps.after]));
}

// A parameter a stage may ramp (tension::rampable): any scalar one.
export function rampable(mode: number, param: number): boolean {
  const spec = EFFECTS[mode];
  if (!spec || spec.key === "multiFeedback") return false;
  if (spec.key === "multiVibration") return param === 0;
  return param < spec.params.length;
}

export function stageValid(s: TensionStage): boolean {
  // loop: HOT-PATH-OK — N = 3 bytes, validating one stage
  if (![s.pullMin, s.pullMax, s.holdTenths].every((v) => Number.isInteger(v) && v >= 0 && v <= 255) || s.pullMin > s.pullMax) return false;
  if (!paramsValid(s.mode, s.p)) return false;
  const r = s.ramp;
  if (!r) return true;
  if (!rampable(s.mode, r.param) || !Number.isInteger(r.to) || r.to < 0 || r.to > 255) return false;
  const end = [...s.p];
  end[r.param] = r.to;
  if (!paramsValid(s.mode, end)) return false; // the end value must be a valid effect too
  return r.by === "hold" ? Number.isInteger(r.tenths) && r.tenths >= 1 && r.tenths <= 255 : s.pullMax > s.pullMin;
}

// ASCII 0x20..0x7E, 1..16 characters (tension::name_valid).
export const nameValid = (name: string) => name.length >= 1 && name.length <= TENSION_NAME_LEN && /^[\x20-\x7e]+$/.test(name);
// What the name field keeps of what was typed: printable ASCII, 16 at most.
export const cleanName = (typed: string) => typed.replace(/[^\x20-\x7e]/g, "").slice(0, TENSION_NAME_LEN);

export function setValid(set: TensionSet): boolean {
  return (
    nameValid(set.name) &&
    // loop: HOT-PATH-OK — N = 2 triggers × ≤ 4 stages, validating one set
    [set.l2, set.r2].every((pg) => pg.stages.length <= TENSION_STAGES && pg.stages.every(stageValid)) &&
    (!set.buttons || buttonPartValid(set.buttons))
  );
}

// The range a parameter may take with the others as they are. For its slider
// (`ramp` false) an end stays above its start, and a start may go anywhere
// (fixStage then moves the end up); a ramp's end value must also stay below
// the parameter that has to be greater than it, since the board checks the
// effect at the ramp's end too.
export function paramRange(mode: number, param: number, p: readonly number[], ramp = false): [number, number] {
  const ps = EFFECTS[mode]?.params[param];
  if (!ps) return [0, 0];
  const lo = ps.after === undefined ? ps.min : Math.max(ps.min, p[ps.after] + 1);
  // loop: HOT-PATH-OK — N ≤ 6 parameters
  const above = ramp ? EFFECTS[mode].params.findIndex((o) => o.after === param) : -1;
  const hi = above < 0 ? ps.max : Math.min(ps.max, p[above] - 1);
  return [lo, Math.max(lo, hi)];
}

// Parameters put back in range after one changed: each one, in order, clamped
// to its range given the ones before it (end follows start). A ramp's end
// value is clamped the same way, or dropped when the effect can't ramp it.
export function fixStage(s: TensionStage): TensionStage {
  const spec = EFFECTS[s.mode];
  if (!spec) return s;
  const p = Array.from({ length: PARAMS }, (_, i) => (i < spec.used ? Math.round(s.p[i] ?? 0) : 0));
  // loop: HOT-PATH-OK — N ≤ 6 parameters, after one edit
  spec.params.forEach((ps, i) => {
    const lo = ps.after === undefined ? ps.min : Math.max(ps.min, p[ps.after] + 1);
    p[i] = Math.min(ps.max, Math.max(lo, p[i]));
  });
  if (spec.zonesAt !== undefined) {
    const at = spec.zonesAt;
    // loop: HOT-PATH-OK — N = 10 zones, after one edit
    for (let z = 0; z < 10; z++) if (zoneLevel(p, at, z) > 8) p.splice(0, PARAMS, ...withZoneLevel(p, at, z, 8));
  }
  let ramp = s.ramp;
  if (ramp) {
    if (!rampable(s.mode, ramp.param)) ramp = null;
    else {
      const [lo, hi] = paramRange(s.mode, ramp.param, p, true);
      ramp = { ...ramp, to: Math.min(hi, Math.max(lo, ramp.to)) };
    }
  }
  const pullMin = Math.min(255, Math.max(0, Math.round(s.pullMin)));
  const pullMax = Math.min(255, Math.max(pullMin, Math.round(s.pullMax)));
  return { mode: s.mode, p, pullMin, pullMax, holdTenths: Math.min(255, Math.max(0, Math.round(s.holdTenths))), ramp };
}

// A new stage of an effect, with the effect's lowest valid values (strengths,
// amplitudes and the bow's snap at 4, frequencies at 30 Hz, so it can be
// felt), over the whole pull.
export function newStage(mode: number): TensionStage {
  const spec = EFFECTS[mode];
  const p = new Array<number>(PARAMS).fill(0);
  // loop: NOT-WORTH — N ≤ 6 parameters, one new stage
  spec?.params.forEach((ps, i) => (p[i] = /strength|amplitude|snap/i.test(ps.key) ? Math.min(ps.max, Math.max(ps.min, 4)) : ps.key === "frequency" ? 30 : ps.min));
  return fixStage({ mode, p, pullMin: 0, pullMax: 255, holdTenths: 0, ramp: null });
}

// ---- Encoding (TENSION.md §2) ----

function encodeStage(s: TensionStage, out: Uint8Array, at: number): void {
  out[at] = s.mode;
  out.set(s.p.slice(0, PARAMS), at + 1);
  out[at + 8] = s.pullMin;
  out[at + 9] = s.pullMax;
  out[at + 10] = s.holdTenths;
  if (s.ramp) {
    out[at + 11] = (s.ramp.param + 1) | (s.ramp.by === "hold" ? 0x80 : 0);
    out[at + 12] = s.ramp.to;
    out[at + 13] = s.ramp.by === "hold" ? s.ramp.tenths : 0;
  }
}

function encodeProgram(pg: TensionProgram, out: Uint8Array, at: number): void {
  out[at] = pg.stages.length;
  out[at + 1] = pg.policy === "replace" ? 1 : 0;
  // loop: NOT-WORTH — N ≤ 4 stages, encoding one set
  pg.stages.forEach((s, i) => encodeStage(s, out, at + 2 + i * STAGE_BYTES));
}

// The 134 bytes the board stages, checks and saves. Throws on a set the board
// would refuse (an app bug: the editor only makes valid ones).
export function encodeSetBody(set: TensionSet): Uint8Array {
  if (!setValid(set)) throw new RangeError("Tension: invalid set");
  const out = new Uint8Array(SET_BODY_BYTES);
  out[0] = TENSION_RECORD_VER;
  // loop: NOT-WORTH — N ≤ 16 name characters, encoding one set
  for (let i = 0; i < set.name.length; i++) out[2 + i] = set.name.charCodeAt(i);
  encodeProgram(set.l2, out, 18);
  encodeProgram(set.r2, out, 18 + PROGRAM_BYTES);
  return out;
}

function decodeStage(b: Uint8Array, at: number): TensionStage {
  const r = b[at + 11];
  const param = (r & 0x07) - 1;
  const ramp: TensionRamp | null = param < 0 ? null : r & 0x80 ? { param, to: b[at + 12], by: "hold", tenths: b[at + 13] } : { param, to: b[at + 12], by: "pull" };
  return { mode: b[at], p: Array.from(b.subarray(at + 1, at + 8)), pullMin: b[at + 8], pullMax: b[at + 9], holdTenths: b[at + 10], ramp };
}

// loop: NOT-WORTH — N ≤ 16 bytes, decoding one set
const zeros = (b: Uint8Array) => b.every((v) => v === 0);

function decodeProgram(b: Uint8Array, at: number): TensionProgram | null {
  const count = b[at];
  if (count > TENSION_STAGES || b[at + 1] > 1) return null;
  const stages: TensionStage[] = [];
  // loop: NOT-WORTH — N = 4 stages, decoding one set
  for (let i = 0; i < TENSION_STAGES; i++) {
    const s = at + 2 + i * STAGE_BYTES;
    if (i >= count) {
      if (!zeros(b.subarray(s, s + STAGE_BYTES))) return null;
      continue;
    }
    // Bits 3..6 of the ramp byte must be 0; no ramp means no ramp_to / ramp_time either.
    if ((b[s + 11] & 0x78) !== 0 || ((b[s + 11] & 0x07) === 0 && (b[s + 11] !== 0 || b[s + 12] !== 0 || b[s + 13] !== 0))) return null;
    if ((b[s + 11] & 0x87) !== 0 && (b[s + 11] & 0x80) === 0 && b[s + 13] !== 0) return null;
    stages.push(decodeStage(b, s));
  }
  return { stages, policy: b[at + 1] === 1 ? "replace" : "fill" };
}

// A SetBody back into a set; null when it isn't one the board would take
// (the board only keeps valid ones, so that means a newer layout or a bug).
export function decodeSetBody(b: Uint8Array): TensionSet | null {
  if (b.length < SET_BODY_BYTES || b[0] !== TENSION_RECORD_VER || b[1] !== 0) return null;
  const raw = b.subarray(2, 2 + TENSION_NAME_LEN);
  const end = raw.indexOf(0);
  // Nothing after the first NUL.
  if (end >= 0 && !zeros(raw.subarray(end))) return null;
  const name = String.fromCharCode(...raw.subarray(0, end < 0 ? TENSION_NAME_LEN : end));
  const l2 = decodeProgram(b, 18);
  const r2 = decodeProgram(b, 18 + PROGRAM_BYTES);
  if (!l2 || !r2) return null;
  const set = { name, l2, r2 };
  return setValid(set) ? set : null;
}

// Protocol 1.24: the 494 bytes (SetBody, then the ButtonPart; all zero when
// the set leaves the buttons alone). Throws like encodeSetBody.
export function encodeSetWire(set: TensionSet): Uint8Array {
  const out = new Uint8Array(SET_WIRE_BYTES);
  out.set(encodeSetBody(set), 0);
  out.set(encodeButtonPart(set.buttons), SET_BODY_BYTES);
  return out;
}

// The 494 bytes back into a set (with `buttons` only when its ButtonPart is used).
export function decodeSetWire(b: Uint8Array): TensionSet | null {
  if (b.length < SET_WIRE_BYTES) return null;
  const set = decodeSetBody(b.subarray(0, SET_BODY_BYTES));
  const buttons = decodeButtonPart(b.subarray(SET_BODY_BYTES, SET_WIRE_BYTES));
  if (!set || buttons === null) return null;
  return buttons ? { ...set, buttons } : set;
}

// CRC-32 (IEEE 802.3 / zlib: reflected 0xEDB88320, init and final xor
// 0xFFFFFFFF; "123456789" → 0xCBF43926), the one 0x1D / 0x1E carry.
// cache: NOT-WORTH — key=byte; invalidated=never (constant table); bound=256 entries
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  // loop: NOT-WORTH — 8 bits × 256 entries, once at load
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  // loop: NOT-WORTH — ≤ 494 bytes, on a save, a read or Feel it
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
export const crcBytes = (crc: number) => [crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, crc >>> 24];

// ---- Reading (GET 0xE9, TENSION.md §7) ----

export type TensionOwner = "none" | "tension" | "game" | "waiting";
const OWNERS: readonly TensionOwner[] = ["none", "tension", "game", "waiting"];

export interface TensionFlags {
  running: boolean; // a set runs
  feelIt: boolean; // Feel it is on
  temporary: boolean; // the choice is a game's (RAM only)
  newerStore: boolean; // saved by newer firmware: read-only here
  paused: boolean; // the Trigger Test or the preset preview has the triggers
}
const flagsOf = (b: number): TensionFlags => ({
  running: (b & 0x01) !== 0,
  feelIt: (b & 0x02) !== 0,
  temporary: (b & 0x04) !== 0,
  newerStore: (b & 0x08) !== 0,
  paused: (b & 0x10) !== 0,
});
const slotOf = (b: number): number | null => (b < TENSION_SLOTS ? b : null);

export interface TensionTriggerNow {
  owner: TensionOwner;
  stage: number | null; // the stage running (0-based)
  pull: number; // 0..255, calibrated as the stages read it (0 without a controller)
  heldTenths: number; // in that stage's window (255 = 25.5 s or more)
  effect: Uint8Array; // the 11 bytes the program wants on the trigger now
}
export interface TensionStatus extends TensionFlags {
  savedChoice: number | null;
  choiceNow: number | null; // Feel it runs over it while feelIt
  slots: number;
  stages: number;
  triggers: [TensionTriggerNow, TensionTriggerNow]; // L2, R2
}

// sel 0x00: null when it isn't a reply this app reads (short, no 'T','N', ver 0).
export function decodeTensionStatus(b: Uint8Array): TensionStatus | null {
  if (b.length < TENSION_STATUS_BYTES || b[0] !== 0x54 || b[1] !== 0x4e || b[2] < 1) return null;
  // loop: HOT-PATH-OK — N = 2 triggers per status poll (10/s while the live view is shown)
  const triggers = [0, 1].map((t) => {
    const o = 8 + 15 * t;
    return { owner: OWNERS[b[o]] ?? "none", stage: b[o + 1] < TENSION_STAGES ? b[o + 1] : null, pull: b[o + 2], heldTenths: b[o + 3], effect: b.slice(o + 4, o + 15) };
  }) as [TensionTriggerNow, TensionTriggerNow];
  return { ...flagsOf(b[3]), savedChoice: slotOf(b[4]), choiceNow: slotOf(b[5]), slots: b[6], stages: b[7], triggers };
}

// Two status reads that say the same (so a poll that brings nothing new
// doesn't re-render the live view).
export function sameTensionStatus(a: TensionStatus | null, b: TensionStatus | null): boolean {
  if (!a || !b) return a === b;
  const flat = (s: TensionStatus) => [s.running, s.feelIt, s.temporary, s.newerStore, s.paused, s.savedChoice, s.choiceNow, s.slots, s.stages];
  const fa = flat(a);
  const fb = flat(b);
  return (
    // loop: HOT-PATH-OK — N = 9 fields per status poll
    fa.every((v, i) => v === fb[i]) &&
    // loop: HOT-PATH-OK — N = 2 triggers per status poll
    a.triggers.every((t, i) => {
      const u = b.triggers[i];
      // loop: HOT-PATH-OK — N = 11 effect bytes per trigger per status poll
      return t.owner === u.owner && t.stage === u.stage && t.pull === u.pull && t.heldTenths === u.heldTenths && t.effect.every((v, k) => v === u.effect[k]);
    })
  );
}

export interface TensionList extends TensionFlags {
  slots: number;
  used: boolean[]; // per slot
  crcs: number[]; // per slot (0 when empty): the app's cache key
  savedChoice: number | null;
  choiceNow: number | null;
}

// sel 0x01: [0] ver, [1] slots, [2] used mask, [3] saved choice, [4] choice now, [5] flags, [6 + 4i] CRC.
export function decodeTensionList(b: Uint8Array): TensionList | null {
  if (b.length < TENSION_LIST_BYTES || b[0] < 1) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = Math.min(b[1], TENSION_SLOTS);
  // loop: NOT-WORTH — N = 8 slots, one list read
  const used = Array.from({ length: n }, (_, i) => (b[2] & (1 << i)) !== 0);
  // loop: NOT-WORTH — N = 8 slots, one list read
  const crcs = Array.from({ length: n }, (_, i) => view.getUint32(6 + 4 * i, true));
  return { ...flagsOf(b[5]), slots: n, used, crcs, savedChoice: slotOf(b[3]), choiceNow: slotOf(b[4]) };
}

// One chunk reply (sel 0x40 | slot << 2 | chunk): [0] ver, [1] slot, [2] chunk, [3] used, then the bytes.
export function decodeTensionChunk(b: Uint8Array, slot: number, chunk: number): { used: boolean; bytes: Uint8Array } | null {
  const want = TENSION_CHUNK_REPLY_BYTES[chunk];
  if (want === undefined || b.length < want || b[0] < 1 || b[1] !== slot || b[2] !== chunk) return null;
  return { used: b[3] === 1, bytes: b.slice(4, want) };
}
export const TENSION_CHUNK_AT = (chunk: number) => chunk * SET_CHUNK;

// ---- The picture (diagram): what each stage feels like over the pull ----

// The controller's ten zones spread evenly over the pull 0..255. An
// assumption for the picture only (the controller maps its zones itself; not
// measured here): zone = pull × 10 / 256.
export const zoneOf = (pull: number) => Math.min(9, Math.floor((pull * 10) / 256));

// Halves away from zero, as the board's ramp (tension::div_round).
const divRound = (a: number, d: number) => (a >= 0 ? Math.floor((2 * a + d) / (2 * d)) : -Math.floor((2 * -a + d) / (2 * d)));
// round(n / d), halves to even (Slope Feedback, as the board and Nielk1).
function roundHalfEven(n: number, d: number): number {
  const q = Math.floor(n / d);
  const r = n - q * d;
  if (2 * r > d) return q + 1;
  if (2 * r === d) return q + (q & 1);
  return q;
}

// The level (0..8) of each zone: resistance strength or vibration amplitude.
// An effect with no force (strength, amplitude or frequency 0) is Off, as the
// board encodes it. Galloping has no strength of its own (its feet are a
// rhythm): drawn at full height over its zones.
export function zoneLevels(mode: number, p: readonly number[]): number[] {
  const lv = new Array<number>(10).fill(0);
  const range = (from: number, to: number, level: number) => {
    // loop: HOT-PATH-OK — N ≤ 10 zones, drawing one stage after an edit
    for (let i = from; i < Math.min(10, to); i++) lv[i] = level;
  };
  switch (EFFECTS[mode]?.key) {
    case "feedback":
      range(p[0], 10, p[1]);
      break;
    case "vibration":
      if (p[2] > 0) range(p[0], 10, p[1]);
      break;
    case "weapon":
      range(p[0], p[1], p[2]);
      break;
    case "bow":
      if (p[3] > 0) range(p[0], p[1], p[2]);
      break;
    case "galloping":
      if (p[4] > 0) range(p[0], p[1], 8);
      break;
    case "machine":
      if (p[4] > 0) range(p[0], p[1], Math.max(p[2], p[3]) + 1);
      break;
    case "multiFeedback":
      // loop: HOT-PATH-OK — N = 10 zones, drawing one stage after an edit
      for (let z = 0; z < 10; z++) lv[z] = zoneLevel(p, 0, z);
      break;
    case "multiVibration":
      // loop: HOT-PATH-OK — N = 10 zones, drawing one stage after an edit
      if (p[0] > 0) for (let z = 0; z < 10; z++) lv[z] = zoneLevel(p, 1, z);
      break;
    case "slopeFeedback": {
      const [sp, ep, ss, es] = p;
      const d = ep - sp;
      // loop: HOT-PATH-OK — N ≤ 10 zones, drawing one stage after an edit
      for (let i = sp; i < 10; i++) lv[i] = i > ep ? es : roundHalfEven(ss * d + (es - ss) * (i - sp), d);
      break;
    }
  }
  return lv;
}

// A stage's parameters at this pull, with a ramp by pull applied (the board's
// formula, pull clamped to the window). A ramp by hold: its start (`end`
// false) or its end value.
export function paramsAt(s: TensionStage, pull: number, end = false): number[] {
  const r = s.ramp;
  if (!r) return s.p;
  const q = [...s.p];
  if (r.by === "hold") {
    if (end) q[r.param] = r.to;
    return q;
  }
  const pc = Math.min(s.pullMax, Math.max(s.pullMin, pull));
  q[r.param] = s.p[r.param] + divRound((r.to - s.p[r.param]) * (pc - s.pullMin), s.pullMax - s.pullMin);
  return q;
}

export interface StagePicture {
  stage: number;
  kind: EffectSpec["kind"];
  waits: boolean; // runs only after its hold time
  // [pull, level] points over the part of its window where it can run; null
  // = the gap where an earlier stage takes over (cut short).
  points: Array<[number, number] | null>;
  // A ramp by hold: where it ends.
  holdEnd: Array<[number, number] | null> | null;
  cutShort: boolean; // part of its window belongs to an earlier stage
  never: boolean; // all of it does: this stage never runs
}

// Per stage, its level over its pull window, where the board would run it.
// The board picks the first stage, in list order, that is inside its window
// and has been held long enough, so an earlier stage that needs no hold time
// takes every pull it covers from the stages after it.
export function programPicture(pg: TensionProgram, step = 4): StagePicture[] {
  // loop: NOT-WORTH — N ≤ 4 stages × 65 pull steps, once per edit (useMemo), never per frame
  return pg.stages.map((s, i) => {
    // loop: NOT-WORTH — N ≤ 3 earlier stages, once per edit
    const before = pg.stages.slice(0, i).filter((o) => o.holdTenths === 0);
    // loop: NOT-WORTH — N ≤ 3 earlier stages per pull step, once per edit
    const free = (x: number) => !before.some((o) => x >= o.pullMin && x <= o.pullMax);
    const points: StagePicture["points"] = [];
    const holdEnd: NonNullable<StagePicture["holdEnd"]> = [];
    let cut = false;
    let any = false;
    const xs: number[] = [];
    // loop: NOT-WORTH — ≤ 65 pull steps per stage, once per edit
    for (let x = s.pullMin; x < s.pullMax; x += step) xs.push(x);
    xs.push(s.pullMax);
    // loop: NOT-WORTH — ≤ 65 pull steps per stage, once per edit
    for (const x of xs) {
      if (!free(x)) {
        cut = true;
        if (points[points.length - 1] !== null) points.push(null);
        if (holdEnd[holdEnd.length - 1] !== null) holdEnd.push(null);
        continue;
      }
      any = true;
      points.push([x, zoneLevels(s.mode, paramsAt(s, x))[zoneOf(x)]]);
      if (s.ramp?.by === "hold") holdEnd.push([x, zoneLevels(s.mode, paramsAt(s, x, true))[zoneOf(x)]]);
    }
    return { stage: i, kind: EFFECTS[s.mode]?.kind ?? "none", waits: s.holdTenths > 0, points, holdEnd: s.ramp?.by === "hold" ? holdEnd : null, cutShort: cut && any, never: !any };
  });
}

// ---- The starter library (official modes only) ----

const prog = (policy: TensionPolicy, ...stages: TensionStage[]): TensionProgram => ({ stages, policy });
const st = (mode: number, p: number[], pullMin: number, pullMax: number, holdTenths = 0, ramp: TensionRamp | null = null): TensionStage => ({
  mode,
  p: [...p, ...new Array<number>(PARAMS - p.length).fill(0)],
  pullMin,
  pullMax,
  holdTenths,
  ramp,
});

// The bow of TENSION.md §3 (R2's three stages, byte for byte as there): the
// draw builds to full by 95 % of the pull, lets go at full pull, then a
// vibration grows the longer it's held. L2: a light steady draw for aiming.
export const BOW_R2_STAGES: TensionStage[] = [
  st(EFFECT.vibration, [0, 1, 30], 242, 255, 15, { param: 1, to: 8, by: "hold", tenths: 50 }),
  st(EFFECT.off, [], 242, 255),
  st(EFFECT.feedback, [0, 1], 0, 241, 0, { param: 1, to: 8, by: "pull" }),
];

export type StarterKey = "bow" | "heavy" | "brake" | "machineGun" | "empty";
// Every starter is Fill in (a game's own effects win); the names are what the
// board stores (ASCII, 16 at most); the app shows them translated.
export const STARTERS: Record<StarterKey, TensionSet> = {
  bow: { name: "Bow", l2: prog("fill", st(EFFECT.feedback, [0, 2], 0, 255)), r2: prog("fill", ...BOW_R2_STAGES) },
  heavy: { name: "Heavy trigger", l2: prog("fill", st(EFFECT.feedback, [1, 6], 0, 255)), r2: prog("fill", st(EFFECT.feedback, [1, 6], 0, 255)) },
  // The brake firms up the further it's pressed; the throttle stays light.
  brake: { name: "Brake pedal", l2: prog("fill", st(EFFECT.slopeFeedback, [1, 9, 2, 8], 0, 255)), r2: prog("fill", st(EFFECT.feedback, [0, 1], 0, 255)) },
  // A trigger click past a light take-up, then rapid fire while held past it.
  machineGun: {
    name: "Machine gun",
    l2: prog("fill", st(EFFECT.feedback, [0, 2], 0, 255)),
    r2: prog("fill", st(EFFECT.vibration, [4, 8, 12], 110, 255), st(EFFECT.weapon, [2, 4, 6], 0, 109)),
  },
  empty: { name: "My set", l2: prog("fill"), r2: prog("fill") },
};
export const STARTER_KEYS = Object.keys(STARTERS) as StarterKey[];
export const copySet = (s: TensionSet): TensionSet => structuredClone(s);
