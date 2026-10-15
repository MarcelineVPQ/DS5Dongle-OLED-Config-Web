// The one way the app reads what it keeps between starts as JSON (error pass,
// batch E1: a damaged file used to start empty with no word). Both processes
// use it: the main process for its files in the user data folder
// (electron/main/persistedFile.ts: settings, the game library, the older
// apps' library) and the page for its stored preferences
// (src/desktop/persistedPref.ts: dismissed notices, pinned sections, the
// pairing slots' controllers, the controller's colors, unticked Games changes).
//
// What it does with a damaged one, the same for each:
//   - keeps the parts that still read (each kind's `salvage`) and puts
//     defaults only where something couldn't be read;
//   - keeps the damaged copy aside first (a file: `<name>.corrupt-<date>`
//     next to it; a preference: a `<key>.corrupt-<date>` entry);
//   - writes back what it loaded, so the next start reads clean;
//   - records what happened, which the page shows once in plain words
//     (RecoveredNotice: what was damaged, what was kept, where the copy is).
// A missing one (the first start) is not damage: the defaults, nothing said.
import { z } from "zod";
import { logged } from "./errorText";

// What it is, for the notice (desktop.recovered.what.<kind>).
export const PERSISTED_KINDS = ["settings", "library", "oldLibrary", "dismissedNotices", "pins", "slotControllers", "customColors", "declinedFixes"] as const;
export type PersistedKind = (typeof PERSISTED_KINDS)[number];

export interface Recovered {
  kind: PersistedKind;
  // Where the damaged copy is (a file path or a preference key), or null when
  // it couldn't be kept aside (then the original is left where it was).
  kept: string | null;
  // Some of it still read (the rest went back to its defaults).
  partial: boolean;
}

// A damaged-file report as the main process hands it to the page (checked there: it crosses IPC).
export const RecoveredSchema = z.strictObject({ kind: z.enum(PERSISTED_KINDS), kept: z.string().max(4096).nullable(), partial: z.boolean() });

// Where the JSON lives. `read` returns null when there is none yet (and
// throws when it can't be read at all). `keepAside` saves the damaged text
// under `stamp` and returns where it went (throws when it can't); without
// `write` the original is never written (the older apps' library).
export interface PersistedStore {
  name: string; // the file path or preference key, for the log and to say each damage once
  read: () => string | null;
  keepAside: (raw: string, stamp: string) => string;
  write?: (text: string) => void;
}

// What `salvage` makes of parsed JSON: the value with whatever didn't fit
// left at its defaults, and whether anything was left out. null: nothing in
// it is usable (not the expected shape at all).
export interface Salvaged<T> {
  value: T;
  lost: boolean;
}

export interface PersistedSpec<T> {
  kind: PersistedKind;
  salvage: (data: unknown) => Salvaged<T> | null;
  fallback: () => T;
  serialize?: (value: T) => string;
}

// cache: OK — key=the store's name; invalidated=never (one report per store per run: a damage is said once); bound=the stores the app has (≤ 8 kinds; pins one per page scope, tens)
const said = new Map<string, Recovered>();
const listeners = new Set<() => void>();

// lifetime: OK — the caller keeps the returned unsubscribe (RecoveredNotice's effect cleanup)
export function onRecovered(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

// What was damaged in this process so far.
export const recoveredHere = (): Recovered[] => [...said.values()];

// A file-name-safe local date and time (the user's clock, as their file
// manager shows it): 2026-10-14T09-30-00.
export function corruptStamp(now = new Date()): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}T${two(now.getHours())}-${two(now.getMinutes())}-${two(now.getSeconds())}`;
}

export function readPersisted<T>(store: PersistedStore, spec: PersistedSpec<T>): T {
  let raw: string | null;
  try {
    raw = store.read();
  } catch (cause) {
    // error: SHOWN — desktop.recovered.notKept (RecoveredNotice): it can't be opened at all (permissions, a folder in its place); the defaults for now, the file left as it is
    logged(`${store.name}: can't be read`)(cause);
    remember(store.name, { kind: spec.kind, kept: null, partial: false });
    return spec.fallback();
  }
  if (raw === null) return spec.fallback();
  let salvaged: Salvaged<T> | null;
  try {
    salvaged = spec.salvage(JSON.parse(raw));
  } catch {
    // error: SHOWN — desktop.recovered.whole (RecoveredNotice): not JSON at all (cut off, overwritten); handled below with the copy kept aside
    salvaged = null;
  }
  if (salvaged && !salvaged.lost) return salvaged.value;
  const value = salvaged ? salvaged.value : spec.fallback();
  // Said once per run: a second read of the same damage (before the write-back
  // lands, or one that failed) gets the same value without another copy.
  if (said.has(store.name)) return value;
  let kept: string | null = null;
  try {
    kept = store.keepAside(raw, corruptStamp());
  } catch (cause) {
    // error: SHOWN — desktop.recovered.notKept (RecoveredNotice): the copy couldn't be made, so the original isn't overwritten now
    logged(`${store.name}: couldn't keep the damaged copy`)(cause);
  }
  if (kept !== null && store.write) {
    try {
      store.write((spec.serialize ?? ((v: T) => JSON.stringify(v)))(value));
    } catch (cause) {
      // error: LOGGED-OK — the copy is kept and the notice says so; only the write-back of what loaded failed, and the app's next save writes it again
      logged(`${store.name}: couldn't write back what loaded`)(cause);
    }
  }
  console.warn(`${store.name}: damaged; ${salvaged ? "kept what read" : "started from the defaults"}; the damaged copy: ${kept ?? "not kept"}`);
  remember(store.name, { kind: spec.kind, kept, partial: salvaged !== null });
  return value;
}

function remember(name: string, r: Recovered): void {
  said.set(name, r);
  // Told after the current render or call: a damage found while a component
  // renders mustn't update another one mid-render.
  queueMicrotask(() => {
    // loop: NOT-WORTH — the notice's one listener, once per damaged store
    for (const l of listeners) l();
  });
}

// ---- Salvage helpers shared by the kinds ----------------------------------

export const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

// A JSON object checked field by field against `schema`'s shape: the fields
// that fit are kept, the rest left out (their defaults apply). `strict`: a
// field the schema doesn't know counts as lost too (it would be dropped on
// the next write; the kept copy still has it). The result is checked whole
// at the end (refinements, required fields): null when it still doesn't fit.
export function salvageObject<S extends z.ZodObject>(schema: S, data: unknown, strict = true): Salvaged<z.infer<S>> | null {
  if (!isObject(data)) return null;
  // error: NOT-WORTH — an object that doesn't fit whole is salvaged field by field below; what's lost is counted, which the caller's notice says
  const whole = schema.safeParse(data);
  if (whole.success) return { value: whole.data, lost: false };
  const shape = schema.shape as Record<string, z.ZodType>;
  const out: Record<string, unknown> = {};
  let lost = false;
  // loop: NOT-WORTH — N = one object's fields (≤ ~40), only when a stored file didn't fit (once per start)
  for (const [key, value] of Object.entries(data)) {
    const field = shape[key];
    if (!field) {
      lost ||= strict;
      continue;
    }
    // error: NOT-WORTH — a field that doesn't fit is left out: counted as lost, which the notice says
    const parsed = field.safeParse(value);
    if (parsed.success) out[key] = parsed.data;
    else lost = true;
  }
  // error: NOT-WORTH — the salvaged fields checked whole: null (nothing usable) is said by the caller's notice
  const checked = schema.safeParse(out);
  return checked.success ? { value: checked.data, lost } : null;
}

// A JSON record (an object of entries) whose entries are checked one by one:
// a bad key or entry is left out, the rest kept.
export function salvageRecord<K extends string, V>(data: unknown, key: z.ZodType<K>, entry: (value: unknown) => Salvaged<V> | null): Salvaged<Record<K, V>> | null {
  if (!isObject(data)) return null;
  const out = {} as Record<K, V>;
  let lost = false;
  // loop: NOT-WORTH — N = the stored entries (games, layouts, slots: tens to a few hundred), once per read of a stored file
  for (const [k, v] of Object.entries(data)) {
    // error: NOT-WORTH — a key that doesn't fit is left out: counted as lost, which the notice says
    const okKey = key.safeParse(k);
    const okValue = okKey.success ? entry(v) : null;
    if (okKey.success && okValue) out[okKey.data] = okValue.value;
    lost ||= !okValue || okValue.lost;
  }
  return { value: out, lost };
}

// A JSON list of strings: anything else in it is left out.
export function salvageStrings(data: unknown, max = Infinity): Salvaged<string[]> | null {
  if (!Array.isArray(data)) return null;
  // loop: NOT-WORTH — N = a short stored list (≤ 50 dismissed notices, a page's pins, unticked fixes), on read
  const value = data.filter((v): v is string => typeof v === "string");
  return { value: value.slice(-max), lost: value.length !== data.length };
}
