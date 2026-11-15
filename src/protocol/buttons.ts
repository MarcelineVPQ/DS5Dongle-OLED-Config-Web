// Tension buttons (protocol 1.24): a button layout inside a Tension set. The
// contract is the firmware's docs/TENSION_BUTTONS.md (§3 the data model, §6
// the wire); every layout and rule here is that one, byte for byte, so the
// board never answers INVALID to what the app sends. Change both together.
//
// ButtonPart (360 bytes, wire = flash, little-endian, packed; §3.2):
//   [0] bver (1 used, 0 not) · [1] bflags (bit0 used, bit1 gyro block used)
//   [2] layers 0..3 · [3] double_window in 10 ms, 15..50 · [4..5] pool_len 0..308
//   [6..41] 3 × Layer (12: name[10] ASCII NUL-padded, colour 0..5, lflags 0..2)
//   [42..51] Gyro (10) · [52..359] pool: the button entries (§3.3)
// Entry: [0] source (bits 0..4) | layer << 5 · [1] rows (bit0 Press, 1 Hold,
//   2 Double press, 3 With PS, 4 Toggle, 5 Turbo) · a 3-byte target per Press,
//   Hold, Double press, With PS row set, in that order · hold time (if Hold) ·
//   turbo rate (if Turbo).
// Absent in the base = the button is itself; absent in a layer = same as base.
//
// The codec and the validator cover the whole §3, rule for rule the board's
// (§3.5); the editor's operations below keep every layout valid. In the app a
// board record (SetBody + ButtonPart) is a "button layout" (the app's
// docs/design/button-layouts-2026-11.md).

export const BUTTON_PART_BYTES = 360;
export const BUTTON_PART_VER = 1;
export const BUTTON_POOL_BYTES = 308;
const POOL_AT = 52;
const LAYERS_AT = 6;
const LAYER_BYTES = 12;
const GYRO_AT = 42;
const GYRO_BYTES = 10;
export const LAYER_NAME_LEN = 10;
export const MAX_LAYERS = 3;
export const LAYER_COLOURS = 6;
export const DOUBLE_WINDOW_DEFAULT = 25; // 0.25 s (tunable, §3.2)
export const HOLD_TIME_DEFAULT = 30; // 0.30 s (tunable, §3.3)
export const TURBO_RATE_DEFAULT = 10; // a second (tunable, §3.3)

// Sources (§3.3): 0..15 the legacy remap order (firmware remap.cpp:19-23),
// then the touch pad button, the PS button and the Edge's four.
export const SOURCES = [
  "l2",
  "l1",
  "create",
  "up",
  "left",
  "down",
  "right",
  "l3",
  "r2",
  "r1",
  "options",
  "triangle",
  "circle",
  "cross",
  "square",
  "r3",
  "touchpad",
  "ps",
  "fnLeft",
  "fnRight",
  "backLeft",
  "backRight",
] as const;
export const SOURCE_COUNT = SOURCES.length; // 22
export const SOURCE = Object.fromEntries(SOURCES.map((s, i) => [s, i])) as Record<(typeof SOURCES)[number], number>;
// The Edge's Fn and back buttons: sources, never targets (§3.4).
export const EDGE_SOURCES: readonly number[] = [SOURCE.fnLeft, SOURCE.fnRight, SOURCE.backLeft, SOURCE.backRight];
// Controller-button targets: the 16 legacy buttons, the touch pad button, the PS button (§3.4).
export const CONTROLLER_TARGETS = 18;

// Targets (§3.4): kind, a, b.
export const TARGET_KIND = { none: 0, button: 1, key: 2, mouseButton: 3, mouseMove: 4, layer: 5, gyro: 6 } as const;
export interface Target {
  kind: number;
  a: number;
  b: number;
}
export const DISABLE: Target = { kind: TARGET_KIND.none, a: 0, b: 0 };
export const buttonTarget = (button: number): Target => ({ kind: TARGET_KIND.button, a: button, b: 0 });
export const sameTarget = (x: Target, y: Target) => x.kind === y.kind && x.a === y.a && x.b === y.b;
// A source's own job, when it has one as a target (the Edge's four have none).
export const itself = (source: number): Target | null => (source < CONTROLLER_TARGETS ? buttonTarget(source) : null);

export interface ButtonEntry {
  source: number;
  layer: number; // 0 base, 1..3
  press?: Target;
  hold?: Target;
  double?: Target;
  withPs?: Target;
  toggle?: boolean;
  turbo?: boolean;
  holdTime?: number; // 10 ms units, 15..200 (with a Hold row)
  turboRate?: number; // presses a second, 2..30 (with Turbo)
}
export interface ButtonLayer {
  name: string; // ASCII 0x20..0x7E, ≤ 10; empty = the app's own "Layer n"
  colour: number; // 0..5, an index into the app's theme tokens
  gyro: number; // 0 same as base, 1 on, 2 off
}
export interface ButtonGyro {
  mode: number; // 1 mouse, 2 right stick
  axis: number; // 0 yaw, 1 roll
  flags: number; // bit0 invert horizontal, bit1 invert vertical, bit2 needs a button
  speedH: number; // 1..255
  speedV: number; // 1..255
  steadiness: number; // 0..255
}
// A set's buttons in use. A set without a ButtonPart leaves the buttons as they are.
export interface ButtonPart {
  layers: ButtonLayer[];
  doubleWindow: number; // 10 ms units, 15..50
  gyro: ButtonGyro | null;
  entries: ButtonEntry[];
}

export const emptyButtonPart = (): ButtonPart => ({ layers: [], doubleWindow: DOUBLE_WINDOW_DEFAULT, gyro: null, entries: [] });

const ROW = { press: 0x01, hold: 0x02, double: 0x04, withPs: 0x08, toggle: 0x10, turbo: 0x20 } as const;

function entryBytes(e: ButtonEntry): number[] {
  const rows = (e.press ? ROW.press : 0) | (e.hold ? ROW.hold : 0) | (e.double ? ROW.double : 0) | (e.withPs ? ROW.withPs : 0) | (e.toggle ? ROW.toggle : 0) | (e.turbo ? ROW.turbo : 0);
  const out = [(e.source & 0x1f) | ((e.layer & 0x03) << 5), rows];
  // loop: NOT-WORTH — N ≤ 4 rows, encoding one entry
  for (const t of [e.press, e.hold, e.double, e.withPs]) if (t) out.push(t.kind, t.a, t.b);
  if (e.hold) out.push(e.holdTime ?? HOLD_TIME_DEFAULT);
  if (e.turbo) out.push(e.turboRate ?? TURBO_RATE_DEFAULT);
  return out;
}

// Entries in the board's order: by (layer, source), at most one per pair.
const byKey = (a: ButtonEntry, b: ButtonEntry) => a.layer - b.layer || a.source - b.source;

// What the pool would take (bytes), against BUTTON_POOL_BYTES.
// loop: HOT-PATH-OK — N ≤ 61 entries, per edit of a set's buttons
export const poolBytes = (part: ButtonPart) => part.entries.reduce((n, e) => n + entryBytes(e).length, 0);

// The 360 bytes, unchecked (encodeButtonPart checks them).
function rawButtonPart(part: ButtonPart | null | undefined): Uint8Array {
  const out = new Uint8Array(BUTTON_PART_BYTES);
  if (!part) return out;
  out[0] = BUTTON_PART_VER;
  out[1] = 0x01 | (part.gyro ? 0x02 : 0);
  out[2] = part.layers.length;
  out[3] = part.doubleWindow;
  // loop: NOT-WORTH — N ≤ 3 layers, encoding one set
  part.layers.forEach((l, i) => {
    const at = LAYERS_AT + i * LAYER_BYTES;
    // loop: NOT-WORTH — N ≤ 10 name characters
    for (let k = 0; k < Math.min(l.name.length, LAYER_NAME_LEN); k++) out[at + k] = l.name.charCodeAt(k) & 0xff;
    out[at + 10] = l.colour;
    out[at + 11] = l.gyro;
  });
  if (part.gyro) {
    const g = part.gyro;
    out.set([g.mode, g.axis, g.flags, g.speedH, g.speedV, g.steadiness], GYRO_AT);
  }
  // loop: NOT-WORTH — N ≤ 61 entries, encoding one set
  const pool = [...part.entries].sort(byKey).flatMap(entryBytes);
  if (pool.length > BUTTON_POOL_BYTES) throw new RangeError("Tension buttons: the pool is full");
  out[4] = pool.length & 0xff;
  out[5] = pool.length >> 8;
  out.set(pool, POOL_AT);
  return out;
}

// The 360 bytes the board stages, checks and saves (all zero = the set
// leaves the buttons alone). Throws on a part the board would refuse (an app
// bug: the editor only makes valid ones).
export function encodeButtonPart(part: ButtonPart | null | undefined): Uint8Array {
  const out = rawButtonPart(part);
  if (!buttonPartBytesValid(out)) throw new RangeError("Tension buttons: invalid layout");
  return out;
}

export function buttonPartValid(part: ButtonPart): boolean {
  try {
    return buttonPartBytesValid(rawButtonPart(part));
  } catch {
    // error: NOT-WORTH — a pool too long for the set: the answer is "not valid", which the editor shows (warn.full)
    return false;
  }
}

// ---- Validation (§3.5, rule by rule, on the bytes as the board checks them) ----

// loop: HOT-PATH-OK — N ≤ 360 bytes, validating one part
const allZero = (b: Uint8Array) => b.every((v) => v === 0);

function nameBytesValid(b: Uint8Array): boolean {
  const end = b.indexOf(0);
  const chars = end < 0 ? b : b.subarray(0, end);
  // loop: HOT-PATH-OK — N ≤ 10 name bytes
  return chars.every((c) => c >= 0x20 && c <= 0x7e) && (end < 0 || allZero(b.subarray(end)));
}

function targetValid(t: Target, layers: number, gyro: boolean): boolean {
  const { kind, a, b } = t;
  switch (kind) {
    case TARGET_KIND.none:
      return a === 0 && b === 0;
    case TARGET_KIND.button:
      return a < CONTROLLER_TARGETS && b === 0;
    case TARGET_KIND.key:
      return a === 0 ? b !== 0 : a >= 0x04 && a <= 0xa4;
    case TARGET_KIND.mouseButton:
      return a >= 1 && a <= 5 && b === 0;
    case TARGET_KIND.mouseMove:
      return a <= 3 ? b >= 1 : a <= 5 && b >= 1 && b <= 30;
    case TARGET_KIND.layer:
      return a >= 1 && a <= layers && b <= 1;
    case TARGET_KIND.gyro:
      return gyro && a <= 2 && b === 0;
    default:
      return false;
  }
}

// One entry read from the pool at `at`; null if it runs past `end`.
function readEntry(p: Uint8Array, at: number, end: number): { entry: ButtonEntry; next: number } | null {
  if (at + 2 > end) return null;
  const e: ButtonEntry = { source: p[at] & 0x1f, layer: (p[at] >> 5) & 0x03 };
  const rows = p[at + 1];
  let i = at + 2;
  const target = (): Target | null => {
    if (i + 3 > end) return null;
    const t = { kind: p[i], a: p[i + 1], b: p[i + 2] };
    i += 3;
    return t;
  };
  // loop: NOT-WORTH — N = 4 target rows, one entry
  for (const [bit, key] of [
    [ROW.press, "press"],
    [ROW.hold, "hold"],
    [ROW.double, "double"],
    [ROW.withPs, "withPs"],
  ] as const) {
    if (!(rows & bit)) continue;
    const t = target();
    if (!t) return null;
    e[key] = t;
  }
  if (rows & ROW.hold) {
    if (i >= end) return null;
    e.holdTime = p[i++];
  }
  if (rows & ROW.toggle) e.toggle = true;
  if (rows & ROW.turbo) {
    if (i >= end) return null;
    e.turbo = true;
    e.turboRate = p[i++];
  }
  return { entry: e, next: i };
}

// The board's checks (§3.5 rules 1-8); null when it would answer INVALID.
function parseButtonPart(b: Uint8Array): ButtonPart | null | "unused" {
  if (b.length < BUTTON_PART_BYTES) return null;
  const bytes = b.subarray(0, BUTTON_PART_BYTES);
  // Rule 1.
  if ((bytes[1] & 0x01) === 0) return allZero(bytes) ? "unused" : null;
  if (bytes[0] !== BUTTON_PART_VER || (bytes[1] & 0xfc) !== 0) return null;
  const gyroOn = (bytes[1] & 0x02) !== 0;
  // Rule 2.
  const layers = bytes[2];
  const poolLen = bytes[4] | (bytes[5] << 8);
  if (layers > MAX_LAYERS || bytes[3] < 15 || bytes[3] > 50 || poolLen > BUTTON_POOL_BYTES) return null;
  if (!allZero(bytes.subarray(POOL_AT + poolLen))) return null;
  const outLayers: ButtonLayer[] = [];
  // loop: NOT-WORTH — N = 3 layer records, one part
  for (let i = 0; i < MAX_LAYERS; i++) {
    const l = bytes.subarray(LAYERS_AT + i * LAYER_BYTES, LAYERS_AT + (i + 1) * LAYER_BYTES);
    if (i >= layers) {
      if (!allZero(l)) return null;
      continue;
    }
    if (!nameBytesValid(l.subarray(0, LAYER_NAME_LEN)) || l[10] >= LAYER_COLOURS || l[11] > 2) return null;
    const end = l.subarray(0, LAYER_NAME_LEN).indexOf(0);
    outLayers.push({ name: String.fromCharCode(...l.subarray(0, end < 0 ? LAYER_NAME_LEN : end)), colour: l[10], gyro: l[11] });
  }
  // The gyro block (§3.2): all zero unless bit1; mode 1 mouse or 2 right stick.
  const g = bytes.subarray(GYRO_AT, GYRO_AT + GYRO_BYTES);
  let gyro: ButtonGyro | null = null;
  if (!gyroOn) {
    if (!allZero(g)) return null;
  } else {
    if (g[0] < 1 || g[0] > 2 || g[1] > 1 || (g[2] & 0xf8) !== 0 || g[3] < 1 || g[4] < 1 || !allZero(g.subarray(6))) return null;
    gyro = { mode: g[0], axis: g[1], flags: g[2], speedH: g[3], speedV: g[4], steadiness: g[5] };
  }
  // Rule 3: entries parse exactly to pool_len, in strictly increasing (layer, source).
  const pool = bytes.subarray(POOL_AT, POOL_AT + poolLen);
  const entries: ButtonEntry[] = [];
  let at = 0;
  let last = -1;
  // loop: NOT-WORTH — N ≤ 61 entries, one part
  while (at < poolLen) {
    if ((pool[at] & 0x80) !== 0 || at + 1 >= poolLen || pool[at + 1] === 0 || (pool[at + 1] & 0xc0) !== 0) return null;
    const read = readEntry(pool, at, poolLen);
    if (!read) return null;
    const e = read.entry;
    const key = e.layer * 32 + e.source;
    if (e.source >= SOURCE_COUNT || e.layer > layers || key <= last) return null;
    last = key;
    at = read.next;
    // Rule 4.
    // loop: NOT-WORTH — N ≤ 4 targets, one entry
    for (const t of [e.press, e.hold, e.double, e.withPs]) if (t && !targetValid(t, layers, gyroOn)) return null;
    if (e.hold && (e.holdTime! < 15 || e.holdTime! > 200)) return null;
    if (e.turbo && (e.turboRate! < 2 || e.turboRate! > 30)) return null;
    // Rule 5: Toggle and Turbo on a Press that is a button, a key or a mouse button (none = itself).
    if ((e.toggle || e.turbo) && e.press && e.press.kind !== TARGET_KIND.button && e.press.kind !== TARGET_KIND.key && e.press.kind !== TARGET_KIND.mouseButton) return null;
    // Rule 6: the PS button keeps its Press; With PS never on it.
    if (e.source === SOURCE.ps && (e.press || e.withPs || e.toggle || e.turbo)) return null;
    // Rule 7 (first half): a Layer target never names the entry's own layer.
    // loop: NOT-WORTH — N ≤ 4 targets, one entry
    for (const t of [e.press, e.hold, e.double, e.withPs]) if (t && t.kind === TARGET_KIND.layer && t.a === e.layer) return null;
    entries.push(e);
  }
  if (at !== poolLen) return null;
  // Rule 7 (second half): a button that switches into layer L has no entry in L.
  // loop: NOT-WORTH — N ≤ 61 entries × 4 targets, one part
  for (const e of entries) {
    // loop: NOT-WORTH — N ≤ 4 targets
    for (const t of [e.press, e.hold, e.double, e.withPs]) {
      // loop: NOT-WORTH — N ≤ 61 entries
      if (t && t.kind === TARGET_KIND.layer && t.b === 1 && entries.some((o) => o.layer === t.a && o.source === e.source)) return null;
    }
  }
  return { layers: outLayers, doubleWindow: bytes[3], gyro, entries };
}

export const buttonPartBytesValid = (b: Uint8Array): boolean => parseButtonPart(b) !== null;

// The 360 bytes back into a part: undefined = the set leaves the buttons
// alone, null = bytes the board would refuse (a newer layout or a bug).
export function decodeButtonPart(b: Uint8Array): ButtonPart | undefined | null {
  const p = parseButtonPart(b);
  return p === "unused" ? undefined : p;
}

// ---- Editing a layout (the editor's operations; every result stays valid) ----

const ROWS = ["press", "hold", "double", "withPs"] as const;
export type RowKey = (typeof ROWS)[number];
export const TARGET_ROWS: readonly RowKey[] = ROWS;

// loop: HOT-PATH-OK — N ≤ 61 entries (the pool's limit), one lookup per row rendered
export const entryAt = (part: ButtonPart, layer: number, source: number) => part.entries.find((e) => e.layer === layer && e.source === source);

// What a button does in a layer: its own entry there, else (in a layer) the
// base's, else null = it is itself.
export function effectiveEntry(part: ButtonPart, layer: number, source: number): ButtonEntry | null {
  return entryAt(part, layer, source) ?? (layer > 0 ? (entryAt(part, 0, source) ?? null) : null);
}

const hasRows = (e: ButtonEntry) => !!(e.press || e.hold || e.double || e.withPs || e.toggle || e.turbo);

// Toggle and Turbo need a Press that is a button, a key or a mouse button (§3.5 rule 5; none = itself).
export const pressTakesToggle = (press: Target | undefined) => !press || press.kind === TARGET_KIND.button || press.kind === TARGET_KIND.key || press.kind === TARGET_KIND.mouseButton;

// One entry made fit for the board: Press "itself" in the base is no Press
// (absent = itself); in a layer an entry with nothing left keeps an explicit
// "itself" Press (absent there means "same as base"); Toggle and Turbo drop
// when the Press can't take them; times only with their rows. null = no entry.
function tidy(e: ButtonEntry): ButtonEntry | null {
  const n: ButtonEntry = { ...e };
  const own = itself(n.source);
  if (n.press && own && sameTarget(n.press, own) && n.layer === 0) delete n.press;
  if (!pressTakesToggle(n.press)) {
    delete n.toggle;
    delete n.turbo;
  }
  if (n.source === SOURCE.ps) {
    delete n.press;
    delete n.withPs;
    delete n.toggle;
    delete n.turbo;
  }
  if (!n.hold) delete n.holdTime;
  else n.holdTime ??= HOLD_TIME_DEFAULT;
  if (!n.turbo) delete n.turboRate;
  else n.turboRate ??= TURBO_RATE_DEFAULT;
  if (!n.toggle) delete n.toggle;
  if (!n.turbo) delete n.turbo;
  if (!hasRows(n)) {
    if (n.layer === 0 || !own) return null;
    n.press = own;
  }
  return n;
}

// The part with (layer, source)'s entry replaced (null = removed).
export function withEntry(part: ButtonPart, layer: number, source: number, entry: ButtonEntry | null): ButtonPart {
  const old = entryAt(part, layer, source);
  // loop: HOT-PATH-OK — N ≤ 61 entries, one edit
  const others = part.entries.filter((e) => e !== old);
  const next = entry ? tidy({ ...entry, source, layer }) : null;
  // loop: HOT-PATH-OK — N ≤ 61 entries, one edit
  return { ...part, entries: next ? [...others, next].sort(byKey) : others };
}

// The editable entry of (layer, source): its own, or (to start editing a
// same-as-base button in a layer) a copy of the base's, or a blank one.
const editable = (part: ButtonPart, layer: number, source: number): ButtonEntry => ({ ...(effectiveEntry(part, layer, source) ?? { source, layer }), source, layer });

// One target row set (null = cleared: Press back to itself, the others gone).
export function withRow(part: ButtonPart, layer: number, source: number, row: RowKey, target: Target | null): ButtonPart {
  const e = editable(part, layer, source);
  if (target) e[row] = target;
  else delete e[row];
  let next = withEntry(part, layer, source, e);
  // §3.5 rule 7: a button that switches into layer L keeps "switch back" in L.
  if (target && target.kind === TARGET_KIND.layer && target.b === 1) next = withEntry(next, target.a, source, null);
  return next;
}

export function withSwitch(part: ButtonPart, layer: number, source: number, which: "toggle" | "turbo", on: boolean): ButtonPart {
  const e = editable(part, layer, source);
  e[which] = on || undefined;
  return withEntry(part, layer, source, e);
}

export function withTime(part: ButtonPart, layer: number, source: number, which: "holdTime" | "turboRate", value: number): ButtonPart {
  const e = editable(part, layer, source);
  e[which] = value;
  return withEntry(part, layer, source, e);
}

// A layer's button back to "same as base" (true), or its own copy (false).
export function withSameAsBase(part: ButtonPart, layer: number, source: number, same: boolean): ButtonPart {
  if (layer === 0) return part;
  if (same) return withEntry(part, layer, source, null);
  if (entryAt(part, layer, source)) return part;
  return withEntry(part, layer, source, editable(part, layer, source));
}

// A layer's button that can't have its own entry: it switches into this layer (rule 7).
export function switchesInto(part: ButtonPart, layer: number, source: number): boolean {
  // loop: HOT-PATH-OK — N ≤ 4 entries of one button × 4 rows, per render of a layer's button
  return layer > 0 && part.entries.some((e) => e.source === source && ROWS.some((r) => e[r]?.kind === TARGET_KIND.layer && e[r]!.a === layer && e[r]!.b === 1));
}

// What a button's Press does in the base: its target, or null = itself.
export function basePress(part: ButtonPart, source: number): Target | null {
  return entryAt(part, 0, source)?.press ?? null;
}

// The part with that button's base Press set (null = itself again).
export function withBasePress(part: ButtonPart, source: number, target: Target | null): ButtonPart {
  return withRow(part, 0, source, "press", target);
}

// Swaps two buttons' whole rows in a layer (Swap with…, §7.3): what A did, B
// does, and the other way round. A button that was itself hands over its own job.
export function swapIn(part: ButtonPart, layer: number, a: number, b: number): ButtonPart {
  if (a === b) return part;
  const ea = effectiveEntry(part, layer, a);
  const eb = effectiveEntry(part, layer, b);
  const as = (e: ButtonEntry | null, from: number): ButtonEntry => (e ? { ...e } : { source: from, layer, press: itself(from)! });
  const na = as(eb, b);
  const nb = as(ea, a);
  let next = withEntry(part, layer, a, null);
  next = withEntry(next, layer, b, null);
  next = withEntry(next, layer, a, { ...na, source: a, layer });
  return withEntry(next, layer, b, { ...nb, source: b, layer });
}
export const swapBase = (part: ButtonPart, a: number, b: number) => swapIn(part, 0, a, b);

// The effective base Press of every source: its target, or itself (null for
// the Edge's four left as themselves, which the PC sees only in Edge mode).
export function basePresses(part: ButtonPart): (Target | null)[] {
  // loop: HOT-PATH-OK — N = 22 sources, per edit of a layout's buttons
  return SOURCES.map((_, s) => basePress(part, s) ?? itself(s));
}

// The changed buttons of a layer, in source order.
export function changedSources(part: ButtonPart, layer = 0): number[] {
  // loop: HOT-PATH-OK — N ≤ 61 entries, per edit of a layout's buttons
  return part.entries.filter((e) => e.layer === layer).map((e) => e.source);
}

// Does a button do more than a Press (a dot on its badge)?
export const hasExtras = (e: ButtonEntry | null | undefined) => !!e && !!(e.hold || e.double || e.withPs || e.toggle || e.turbo);

// ---- Layers ----

export function addLayer(part: ButtonPart): ButtonPart {
  if (part.layers.length >= MAX_LAYERS) return part;
  return { ...part, layers: [...part.layers, { name: "", colour: part.layers.length % LAYER_COLOURS, gyro: 0 }] };
}

export function withLayer(part: ButtonPart, layer: number, change: Partial<ButtonLayer>): ButtonPart {
  // loop: NOT-WORTH — N ≤ 3 layers
  return { ...part, layers: part.layers.map((l, i) => (i === layer - 1 ? { ...l, ...change } : l)) };
}

export function resetLayer(part: ButtonPart, layer: number): ButtonPart {
  // loop: HOT-PATH-OK — N ≤ 61 entries, one edit
  return { ...part, entries: part.entries.filter((e) => e.layer !== layer) };
}

// Deletes a layer: its entries go, rows that entered it go, the layers above move down.
export function deleteLayer(part: ButtonPart, layer: number): ButtonPart {
  if (layer < 1 || layer > part.layers.length) return part;
  const entries: ButtonEntry[] = [];
  // loop: NOT-WORTH — N ≤ 61 entries, one click
  for (const e of part.entries) {
    if (e.layer === layer) continue;
    const n: ButtonEntry = { ...e, layer: e.layer > layer ? e.layer - 1 : e.layer };
    // loop: NOT-WORTH — N = 4 rows
    for (const r of ROWS) {
      const t = n[r];
      if (t?.kind !== TARGET_KIND.layer) continue;
      if (t.a === layer) delete n[r];
      else if (t.a > layer) n[r] = { ...t, a: t.a - 1 };
    }
    const tidied = tidy(n);
    if (tidied) entries.push(tidied);
  }
  // loop: NOT-WORTH — N ≤ 3 layers
  return { ...part, layers: part.layers.filter((_, i) => i !== layer - 1), entries: entries.sort(byKey) };
}

// Gyro as mouse on (a block) or off (null): off drops every Gyro target and
// each layer's gyro choice too (§3.5 rule 8: Gyro targets only with the block).
export function withGyro(part: ButtonPart, gyro: ButtonGyro | null): ButtonPart {
  if (gyro) return { ...part, gyro };
  const entries: ButtonEntry[] = [];
  // loop: NOT-WORTH — N ≤ 61 entries, one click
  for (const e of part.entries) {
    const n: ButtonEntry = { ...e };
    // loop: NOT-WORTH — N = 4 rows
    for (const r of ROWS) if (n[r]?.kind === TARGET_KIND.gyro) delete n[r];
    const tidied = tidy(n);
    if (tidied) entries.push(tidied);
  }
  // loop: NOT-WORTH — N ≤ 3 layers
  return { ...part, gyro: null, entries, layers: part.layers.map((l) => ({ ...l, gyro: 0 })) };
}

// The buttons whose target enters a layer: [source, row, held or switch].
export function enteredBy(part: ButtonPart, layer: number): Array<{ source: number; row: RowKey; mode: "held" | "switch"; from: number }> {
  const out: Array<{ source: number; row: RowKey; mode: "held" | "switch"; from: number }> = [];
  // loop: HOT-PATH-OK — N ≤ 61 entries × 4 rows, per render of a layer tab
  for (const e of part.entries)
    // loop: HOT-PATH-OK — N = 4 rows
    for (const r of ROWS) if (e[r]?.kind === TARGET_KIND.layer && e[r]!.a === layer) out.push({ source: e.source, row: r, mode: e[r]!.b === 1 ? "switch" : "held", from: e.layer });
  return out;
}

// ---- Starting points (§7.7): drafts like any edit ----

const press = (source: number, to: number): ButtonEntry => ({ source, layer: 0, press: buttonTarget(to) });

// One hand (left / right): the face buttons on the D-pad (or the other way),
// a layer held by L1 (R1) with the far side's shoulders and stick clicks.
// Starting points to try, not tested designs. Replaces the buttons, keeps the gyro.
export function oneHand(side: "left" | "right", gyro: ButtonGyro | null): ButtonPart {
  const L = side === "left";
  const S = SOURCE;
  const pairs: Array<[number, number]> = L
    ? [
        [S.up, S.triangle],
        [S.right, S.circle],
        [S.down, S.cross],
        [S.left, S.square],
      ]
    : [
        [S.triangle, S.up],
        [S.circle, S.right],
        [S.cross, S.down],
        [S.square, S.left],
      ];
  const shift = L ? S.l1 : S.r1;
  const entries: ButtonEntry[] = [
    // loop: NOT-WORTH — N = 4 pairs, one click
    ...pairs.map(([from, to]) => press(from, to)),
    { source: shift, layer: 0, press: buttonTarget(L ? S.r1 : S.l1), hold: { kind: TARGET_KIND.layer, a: 1, b: 0 }, holdTime: HOLD_TIME_DEFAULT },
    // In the layer the moved buttons are themselves again, and the far side's shoulders, stick click and menu button come over.
    // loop: NOT-WORTH — N = 4 pairs, one click
    ...pairs.map(([from]) => ({ source: from, layer: 1, press: buttonTarget(from) })),
    { source: L ? S.l2 : S.r2, layer: 1, press: buttonTarget(L ? S.r2 : S.l2) },
    { source: L ? S.l3 : S.r3, layer: 1, press: buttonTarget(L ? S.r3 : S.l3) },
    { source: L ? S.create : S.options, layer: 1, press: buttonTarget(L ? S.options : S.create) },
  ];
  return { layers: [{ name: "", colour: 0, gyro: 0 }], doubleWindow: DOUBLE_WINDOW_DEFAULT, gyro, entries: entries.sort(byKey) };
}

// Toggle instead of hold: L2, L1 and L3 latch (aim, block, sprint are commonly holds).
export function toggleInsteadOfHold(part: ButtonPart): ButtonPart {
  let next = part;
  // loop: NOT-WORTH — N = 3 buttons, one click
  for (const s of [SOURCE.l2, SOURCE.l1, SOURCE.l3]) next = withSwitch(next, 0, s, "toggle", true);
  return next;
}

// ---- Today's table, both ways (older firmware, a game's fallback, §3.8) ----

// Today's legacy table (and the Edge extras, protocol 1.9) as Press entries.
// table: 16 targets 0..15 or 0xFF (nothing); extra: 4 of 0..15, 0xFE nothing, 0xFF itself.
export function partFromLegacy(table: readonly number[], extra: readonly number[] | null): ButtonPart {
  let part = emptyButtonPart();
  // loop: NOT-WORTH — N = 16 legacy buttons, one click
  table.forEach((to, from) => {
    if (to !== from) part = withBasePress(part, from, to === 0xff ? DISABLE : buttonTarget(to));
  });
  // loop: NOT-WORTH — N = 4 Edge buttons, one click
  extra?.forEach((to, n) => {
    if (to !== 0xff) part = withBasePress(part, EDGE_SOURCES[n], to === 0xfe ? DISABLE : buttonTarget(to));
  });
  return part;
}

// A layout's Press part as today's table and extras; `whole` = nothing else
// in it (no other press type, layer, key, mouse, gyro, touch pad or PS target).
export function legacyFromPart(part: ButtonPart): { table: number[]; extra: number[]; whole: boolean } {
  const table = Array.from({ length: 16 }, (_, i) => i);
  const extra = [0xff, 0xff, 0xff, 0xff];
  let whole = part.layers.length === 0 && !part.gyro;
  // loop: NOT-WORTH — N ≤ 61 entries, when a layout is saved or a game starts
  for (const e of part.entries) {
    const p = e.press;
    const legacyTarget = !p ? e.source : p.kind === TARGET_KIND.none ? 0xff : p.kind === TARGET_KIND.button && p.a < 16 ? p.a : null;
    if (e.layer !== 0 || hasExtras(e) || legacyTarget === null || e.source === SOURCE.touchpad || e.source === SOURCE.ps) {
      whole = false;
      if (e.layer !== 0 || legacyTarget === null) continue;
    }
    if (e.source < 16) table[e.source] = legacyTarget;
    else {
      const n = EDGE_SOURCES.indexOf(e.source);
      if (n >= 0) extra[n] = legacyTarget === 0xff ? 0xfe : legacyTarget;
    }
  }
  return { table, extra, whole };
}

// ---- Warnings that are not invalid (§3.5, §7.6) ----

// loop: HOT-PATH-OK — N = 4 rows per entry
const ALL_TARGETS = (e: ButtonEntry) => [e.press, e.hold, e.double, e.withPs].filter((t): t is Target => !!t);

export interface PressWarnings {
  noCross: boolean; // nothing presses ✕ in the base
  noCircle: boolean; // nothing presses ○ in the base
  // source → the other sources whose Press has the same controller-button target (in the layer)
  duplicates: Map<number, number[]>;
  psCost: boolean; // a With PS row in the layer
  needsKeys: boolean; // a key or mouse target anywhere
  sixKeys: boolean; // more than six buttons of a layer send keys
  full: boolean; // past the pool
}

export function pressWarnings(part: ButtonPart, layer = 0): PressWarnings {
  // loop: HOT-PATH-OK — N = 22 sources, per edit
  const presses = SOURCES.map((_, s) => {
    const e = effectiveEntry(part, layer, s);
    return e ? (e.press ?? itself(s)) : itself(s);
  });
  // Press or Hold reaches it in the base (§7.6): a Hold row counts too.
  const reaches = (button: number) =>
    // loop: HOT-PATH-OK — N = 22 sources, per edit
    basePresses(part).some((t) => t && sameTarget(t, buttonTarget(button))) ||
    // loop: HOT-PATH-OK — N ≤ 61 entries, per edit
    part.entries.some((e) => e.layer === 0 && e.hold && sameTarget(e.hold, buttonTarget(button)));
  const duplicates = new Map<number, number[]>();
  // loop: HOT-PATH-OK — N = 22 × 22 sources, per edit of a layout's buttons
  presses.forEach((t, s) => {
    if (!t || t.kind !== TARGET_KIND.button) return;
    // loop: HOT-PATH-OK — N = 22 sources
    const others = presses.flatMap((u, o) => (o !== s && u && sameTarget(u, t) ? [o] : []));
    if (others.length) duplicates.set(s, others);
  });
  // loop: HOT-PATH-OK — N ≤ 61 entries, per edit
  const inLayer = SOURCES.map((_, s) => effectiveEntry(part, layer, s)).filter((e): e is ButtonEntry => !!e);
  const isKeyish = (t: Target) => t.kind === TARGET_KIND.key || t.kind === TARGET_KIND.mouseButton || t.kind === TARGET_KIND.mouseMove;
  return {
    noCross: !reaches(SOURCE.cross),
    noCircle: !reaches(SOURCE.circle),
    duplicates,
    // loop: HOT-PATH-OK — N ≤ 22 entries, per edit
    psCost: inLayer.some((e) => !!e.withPs),
    // loop: HOT-PATH-OK — N ≤ 61 entries × 4 rows, per edit
    needsKeys: part.entries.some((e) => ALL_TARGETS(e).some(isKeyish)) || part.gyro?.mode === 1,
    // loop: HOT-PATH-OK — N ≤ 22 entries × 4 rows, per edit
    sixKeys: inLayer.filter((e) => ALL_TARGETS(e).some((t) => t.kind === TARGET_KIND.key && t.a !== 0)).length > 6,
    full: poolBytes(part) > BUTTON_POOL_BYTES,
  };
}

// ---- Live truth: GET 0xE8 (§6.4, vendor interface only, 63 bytes) ----

export const LIVE_TRUTH_REPORT = 0xe8;
export const LIVE_TRUTH_BYTES = 63;
export const LIVE_TYPES = ["deciding", "press", "hold", "double", "withPs", "toggleOn", "toggleOff", "turbo", "tap"] as const;
export type LiveType = (typeof LIVE_TYPES)[number];
export interface LiveTruth {
  running: boolean; // bit0 a layout runs
  feelIt: boolean; // bit2
  keysUp: boolean; // bit3 the keys-and-mouse interface is up
  gyroMouse: boolean; // bit4
  paused: boolean; // bit5: outputs are what would have gone out
  what: number; // slot 0..7, 0xFD the app's, 0xFE the legacy table, 0xFF nothing
  layer: number;
  down: number; // u24 sources physically down
  on: number; // u24 sources whose action is on
  last: { source: number; type: LiveType; phase: "deciding" | "on" | "released"; heldMs: number; needsMs: number; target: Target; layer: number } | null;
  pad: number[]; // gamepad bytes 7, 8, 9 fetched last
  triggers: [number, number];
  mods: number;
  keys: number[]; // non-zero keys fetched last
  mouseButtons: number;
  reports: number; // u32 gamepad reports fetched
}

export function decodeLiveTruth(b: Uint8Array): LiveTruth | null {
  if (b.length < 46 || b[0] !== 0x42 || b[1] !== 0x54 || b[2] < 1) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u24 = (at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
  const f = b[3];
  const type = LIVE_TYPES[b[13]];
  const last =
    b[12] === 0xff || b[12] >= SOURCE_COUNT || !type
      ? null
      : {
          source: b[12],
          type,
          phase: (["deciding", "on", "released"] as const)[Math.min(2, b[14])],
          heldMs: v.getUint16(15, true),
          needsMs: v.getUint16(17, true),
          target: { kind: b[19], a: b[20], b: b[21] },
          layer: b[22],
        };
  return {
    running: (f & 0x01) !== 0,
    feelIt: (f & 0x04) !== 0,
    keysUp: (f & 0x08) !== 0,
    gyroMouse: (f & 0x10) !== 0,
    paused: (f & 0x20) !== 0,
    what: b[4],
    layer: b[5],
    down: u24(6),
    on: u24(9),
    last,
    pad: [b[23], b[24], b[25]],
    triggers: [b[26], b[27]],
    mods: b[28],
    // loop: HOT-PATH-OK — N = 6 keys per live-truth poll
    keys: [...b.subarray(29, 35)].filter((k) => k !== 0),
    mouseButtons: b[35],
    reports: v.getUint32(42, true),
  };
}

// Two readings the same for the view (the mouse motion sums and the report count aside), so an unchanged poll keeps its object.
export function sameLiveTruth(a: LiveTruth | null, b: LiveTruth | null): boolean {
  if (!a || !b) return a === b;
  const strip = (x: LiveTruth) => JSON.stringify({ ...x, reports: 0 });
  return strip(a) === strip(b);
}

// ---- Reading saved buttons: GET 0xE9 sel 0x80 (§6.3) ----

// sel = 0x80 | slot << 3 | chunk, chunk 0..6: [0] ver 2, [1] slot, [2] chunk,
// [3] used, then the ButtonPart from 56·chunk (56 bytes, the last 24).
export const BUTTONS_CHUNKS = 7;
const BUTTONS_CHUNK = 56;
export const buttonsChunkSel = (slot: number, chunk: number) => 0x80 | ((slot & 7) << 3) | (chunk & 7);
export const buttonsChunkReplyBytes = (chunk: number) => 4 + Math.min(BUTTONS_CHUNK, BUTTON_PART_BYTES - chunk * BUTTONS_CHUNK);
export const BUTTONS_CHUNK_AT = (chunk: number) => chunk * BUTTONS_CHUNK;

export function decodeButtonsChunk(b: Uint8Array, slot: number, chunk: number): { used: boolean; bytes: Uint8Array } | null {
  if (chunk >= BUTTONS_CHUNKS) return null;
  const want = buttonsChunkReplyBytes(chunk);
  if (b.length < want || b[0] < 2 || b[1] !== slot || b[2] !== chunk) return null;
  return { used: b[3] === 1, bytes: b.slice(4, want) };
}
