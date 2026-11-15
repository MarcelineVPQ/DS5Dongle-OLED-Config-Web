// The layout in the editor (protocol 1.24, docs/design/button-layouts-2026-11.md):
// one button layout (trigger effects + buttons, the board's 494-byte record)
// that Button assignments, the drawing, Adaptive triggers and the Gyroscope
// section show and change.
//
// Outside a game's profile it is the layout that runs from power-on, as
// today's editor edits the board's buttons: its edits are drafts of that slot
// (tensionDraft.ts) the one save bar writes (page rule 4). None runs yet: the
// first free slot, which then runs from power-on (all eight used: the one the
// player picks under "Saves into"). With a game's profile on, it is that
// game's layout in the library, saved by Save to profile (useGameProfile.ts).
import { useCallback, useMemo, useState } from "react";
import { emptyButtonPart, legacyFromPart, partFromLegacy, type ButtonPart } from "../../protocol/buttons";
import { cleanName, decodeSetWire, encodeSetWire, setValid, SET_WIRE_BYTES, type TensionProgram, type TensionSet } from "../../protocol/tension";
import type { ButtonLayout } from "../games/library";
import type { Remap } from "./useRemap";
import type { TensionDraft } from "./tensionDraft";

const GAME: TensionProgram = { stages: [], policy: "fill" };
export const DEFAULT_LAYOUT_NAME = "Buttons";
// A board name from any name: ASCII, 16 characters, never empty.
export const boardLayoutName = (name: string) => cleanName(name).trim() || DEFAULT_LAYOUT_NAME;

// loop: NOT-WORTH — N = 494 bytes, when a layout is saved or read from the library
export const wireHex = (b: Uint8Array) => Array.from(b, (v) => v.toString(16).padStart(2, "0")).join("");
export function fromHex(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]*$/.test(hex) || hex.length % 2) return null;
  // loop: NOT-WORTH — N = 494 bytes, when a layout is read from the library
  return Uint8Array.from({ length: hex.length / 2 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

// A library layout as the board would keep it: its saved record, else (made
// by an older app) its table as Press rows with the game's own trigger effects.
export function layoutSet(l: ButtonLayout): TensionSet {
  const wire = l.set ? fromHex(l.set) : null;
  const set = wire && wire.length === SET_WIRE_BYTES ? decodeSetWire(wire) : null;
  if (set) return { ...set, buttons: set.buttons ?? emptyButtonPart() };
  return { name: boardLayoutName(l.name), l2: GAME, r2: GAME, buttons: partFromLegacy(l.table, l.extra ?? null) };
}

// What the library keeps for a layout: its name, the Press part as today's
// table (older firmware, a game's fallback) and the whole record.
export function layoutRecord(id: string, name: string, set: TensionSet) {
  const legacy = legacyFromPart(set.buttons ?? emptyButtonPart());
  const valid = setValid(set);
  return { id, name, table: legacy.table, extra: legacy.extra, ...(valid ? { set: wireHex(encodeSetWire(set)) } : {}) };
}

// Two layouts the same, byte for byte as the board would hold them.
export function sameLayout(a: TensionSet | null, b: TensionSet | null): boolean {
  if (!a || !b) return a === b;
  if (!setValid(a) || !setValid(b)) return JSON.stringify(a) === JSON.stringify(b);
  const x = encodeSetWire(a);
  const y = encodeSetWire(b);
  // loop: HOT-PATH-OK — N = 494 bytes, per render of the layouts list
  return x.every((v, i) => v === y[i]);
}

// The buttons a board slot shows: its own, or (none: it leaves the buttons
// alone, so today's table runs) the table's.
export const shownButtons = (set: TensionSet, legacy: ButtonPart): ButtonPart => set.buttons ?? legacy;

export interface LayoutEditor {
  ready: boolean; // the board has layouts ([58] bit 0), read, and writable
  mode: "board" | "profile";
  layout: TensionSet; // what the editor shows (buttons always there)
  edit: (next: TensionSet) => void;
  // Board mode: the slot Save writes (null: all eight used and none runs, until one is picked).
  slot: number | null;
  full: boolean; // all eight used and none runs from power-on: "Saves into" shows
  pickSlot: (slot: number) => void;
  // Profile mode: changed from the game's stored layout.
  dirty: boolean;
  revert: () => void;
}

export function useLayoutEditor(tn: TensionDraft, remap: Remap, profile: { key: string; title: string; layout: ButtonLayout | null } | null): LayoutEditor {
  const ready = tn.buttons && tn.loaded && !tn.readOnly;
  const legacy = useMemo(() => (remap.supported ? partFromLegacy(remap.device, remap.extraDevice) : emptyButtonPart()), [remap.supported, remap.device, remap.extraDevice]);
  const [picked, setPicked] = useState<number | null>(null);
  // loop: HOT-PATH-OK — N = 8 slots per render
  const free = tn.sets.findIndex((s) => !s);
  const full = tn.choice === null && free < 0;
  const slot = tn.choice ?? (free >= 0 ? free : picked);
  const boardSet = slot === null ? null : tn.sets[slot];
  const boardLayout = useMemo<TensionSet>(
    () => (boardSet ? { ...boardSet, buttons: shownButtons(boardSet, legacy) } : { name: DEFAULT_LAYOUT_NAME, l2: GAME, r2: GAME, buttons: legacy }),
    [boardSet, legacy],
  );
  const { edit: tnEdit, choose } = tn;
  const editBoard = useCallback(
    (next: TensionSet) => {
      if (slot === null) return;
      tnEdit(slot, next);
      // Staged with the edit even when it already runs, so the editor stays on
      // this layout across a reconnect, before the board's choice is read again.
      choose(slot);
    },
    [slot, tnEdit, choose],
  );

  // A game's profile: its own layout, or (none yet) the board's to start from.
  const profileBase = useMemo<TensionSet | null>(
    () => (profile ? (profile.layout ? layoutSet(profile.layout) : { ...boardLayout, name: boardLayoutName(profile.title) }) : null),
    [profile, boardLayout],
  );
  const [draft, setDraft] = useState<{ key: string; base: TensionSet; set: TensionSet } | null>(null);
  const mine = profile && profileBase && draft && draft.key === profile.key && draft.base === profileBase ? draft : null;
  const editProfile = useCallback(
    (next: TensionSet) => {
      if (profile && profileBase) setDraft({ key: profile.key, base: profileBase, set: next });
    },
    [profile, profileBase],
  );
  const revert = useCallback(() => setDraft(null), []);
  const dirty = !!mine && !!profileBase && !sameLayout(mine.set, profileBase);

  return useMemo<LayoutEditor>(
    () =>
      profile && profileBase
        ? { ready, mode: "profile", layout: mine?.set ?? profileBase, edit: editProfile, slot: null, full: false, pickSlot: setPicked, dirty, revert }
        : { ready, mode: "board", layout: boardLayout, edit: editBoard, slot, full, pickSlot: setPicked, dirty: false, revert },
    [ready, profile, profileBase, mine, editProfile, dirty, revert, boardLayout, editBoard, slot, full],
  );
}

// The slot of a layout on the board, as shown (staged over the board's), or -1.
export function slotOnBoard(sets: readonly (TensionSet | null)[], set: TensionSet): number {
  // loop: HOT-PATH-OK — N = 8 slots × 494 bytes, per layouts-list row
  return sets.findIndex((s) => !!s && sameLayout(s, set));
}

export const firstFreeSlot = (sets: readonly (TensionSet | null)[]) =>
  // loop: HOT-PATH-OK — N = 8 slots
  sets.findIndex((s) => !s);
