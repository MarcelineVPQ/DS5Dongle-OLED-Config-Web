// Button-remap wire protocol, carried over the *existing* 0xF6/0xF7 vendor
// reports (no new HID report ID — declaring extra IDs breaks DualSense
// enumeration on Windows). See firmware src/remap.cpp + src/cmd.cpp.
//
//   SET  sendFeatureReport(0xF6, [0x10,'R','M',ver, table[16], …pad])
//   GET  receiveFeatureReport(0xF7) → <Config_body(35)> then the appended block:
//        ['R','M', ver, rev_lo, rev_hi, table[16]]
//
// The table maps source index → target index; 0xFF = source disabled.

import { CONFIG_BODY_SIZE, FEATURE_REPORT_PAYLOAD_SIZE } from "./config";

export const REMAP_COUNT = 16;
export const REMAP_PROTO_VER = 1;
export const REMAP_DISABLED = 0xff;

const REMAP_SET_FUNC = 0x10;
const MAGIC_R = 0x52; // 'R'
const MAGIC_M = 0x4d; // 'M'

// Display labels, indexed by button value. Order MUST match RemapButton in
// firmware src/remap.cpp. Not translated — short controller-button names, same
// convention as LIGHTBAR_MODE_OPTIONS in config.ts.
export const REMAP_BUTTON_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0,  label: "L2" },
  { value: 1,  label: "L1" },
  { value: 2,  label: "Create" },
  { value: 3,  label: "D-Pad Up" },
  { value: 4,  label: "D-Pad Left" },
  { value: 5,  label: "D-Pad Down" },
  { value: 6,  label: "D-Pad Right" },
  { value: 7,  label: "L3" },
  { value: 8,  label: "R2" },
  { value: 9,  label: "R1" },
  { value: 10, label: "Options" },
  { value: 11, label: "Triangle △" },
  { value: 12, label: "Circle ○" },
  { value: 13, label: "Cross ✕" },
  { value: 14, label: "Square □" },
  { value: 15, label: "R3" },
];

export interface RemapState {
  version: number;
  revision: number;   // bumps on each successful device write — poll to confirm
  table: number[];    // length REMAP_COUNT
}

export function identityTable(): number[] {
  return Array.from({ length: REMAP_COUNT }, (_, i) => i);
}

export function isIdentity(table: number[]): boolean {
  return table.length === REMAP_COUNT && table.every((t, i) => t === i);
}

export function tablesEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function isValidTable(table: number[]): boolean {
  if (table.length !== REMAP_COUNT) return false;
  return table.every((t) => t === REMAP_DISABLED || (Number.isInteger(t) && t >= 0 && t < REMAP_COUNT));
}

// Pull the remap block out of a raw 0xF7 (config) feature report. Returns null
// when the firmware didn't append it (older firmware) — the caller treats that
// as "remapping unsupported, update firmware".
export function decodeRemapFromConfigReport(source: ArrayBuffer | DataView | Uint8Array): RemapState | null {
  const bytes = toUint8Array(source);
  // WebHID may or may not keep the leading report-ID byte, so the block sits at
  // CONFIG_BODY_SIZE or CONFIG_BODY_SIZE + 1. Disambiguate by the 'RM' magic.
  for (const base of [CONFIG_BODY_SIZE, CONFIG_BODY_SIZE + 1]) {
    if (base + 5 + REMAP_COUNT > bytes.byteLength) continue;
    if (bytes[base] !== MAGIC_R || bytes[base + 1] !== MAGIC_M) continue;
    const version = bytes[base + 2];
    const revision = bytes[base + 3] | (bytes[base + 4] << 8);
    const table = Array.from(bytes.subarray(base + 5, base + 5 + REMAP_COUNT));
    return { version, revision, table };
  }
  return null;
}

// Build the 0xF6 SET payload (without the leading report-ID byte; WebHID
// prepends it). Throws on an invalid table.
export function encodeRemapSet(table: number[]): Uint8Array<ArrayBuffer> {
  if (!isValidTable(table)) {
    throw new Error(`Invalid remap table (need ${REMAP_COUNT} entries, each 0-${REMAP_COUNT - 1} or disabled)`);
  }
  const report = new Uint8Array(new ArrayBuffer(FEATURE_REPORT_PAYLOAD_SIZE));
  report[0] = REMAP_SET_FUNC;
  report[1] = MAGIC_R;
  report[2] = MAGIC_M;
  report[3] = REMAP_PROTO_VER;
  report.set(table, 4);
  return report;
}

function toUint8Array(source: ArrayBuffer | DataView | Uint8Array): Uint8Array {
  if (source instanceof Uint8Array) return source;
  if (source instanceof DataView) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  return new Uint8Array(source);
}
