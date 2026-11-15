// Tension's sets as one save model (page rule 4): what the board holds (read
// once per connection, when the Tension section or a game page first needs
// it), and what's staged on top of it: a set made, changed or deleted, and the
// saved choice (which set runs from power-on). The save bar's Save writes them
// (deletes, then sets, then the choice: protocol order, so a choice can name a
// set saved in the same Save); Revert drops them. Feel it is not a save: it
// runs the set being edited, unsaved, from the section (Tension.tsx).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import i18n from "../../i18n";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import { CommandError, supportsTension, type Ds5BridgeClient } from "../../protocol/bridgeClient";
import { encodeSetBody, setValid, TENSION_SLOTS, type TensionSet } from "../../protocol/tension";
import { causeText } from "../shownError";
import { KeyedError, logged } from "../../errorText";
import { sameBoard, showDraftsDropped } from "./slotSettings";

export interface TensionDraft {
  supported: boolean;
  loaded: boolean; // the board's sets were read on this connection
  readOnly: boolean; // saved by newer firmware: shown, never written over
  // error: SHOWN — desktop.tension.errors.* and the board's keyed errors (causeText) in the Tension section's error line, and the save bar's notice
  error: string | null;
  // As shown: what's staged, over what the board holds (null = an empty slot).
  sets: (TensionSet | null)[];
  // The saved choice as shown (staged over the board's).
  choice: number | null;
  changed: (slot: number) => boolean;
  dirty: boolean;
  // Reads the board's sets if this connection hasn't yet (the section and game pages call it).
  load: () => void;
  retry: () => Promise<void>;
  edit: (slot: number, set: TensionSet | null) => void;
  choose: (slot: number | null) => void;
  save: () => Promise<boolean>;
  revert: () => void;
}

interface Board {
  client: Ds5BridgeClient;
  sets: (TensionSet | null)[];
  choice: number | null;
  readOnly: boolean;
}
interface Staged {
  client: Ds5BridgeClient;
  sets: Record<number, TensionSet | null>;
  choice?: number | null;
}

// Two sets the same, byte for byte as the board would hold them.
function sameSet(a: TensionSet | null, b: TensionSet | null): boolean {
  if (!a || !b) return a === b;
  if (!setValid(a) || !setValid(b)) return JSON.stringify(a) === JSON.stringify(b);
  const x = encodeSetBody(a);
  const y = encodeSetBody(b);
  // loop: HOT-PATH-OK — N = 134 bytes, per render of a changed slot
  return x.every((v, i) => v === y[i]);
}

// A board result in Tension's words (the board answers INVALID or FAILED).
export function tensionErrorText(cause: unknown): string {
  if (cause instanceof CommandError && cause.result === "invalid") return i18n.t("desktop.tension.errors.invalid");
  if (cause instanceof CommandError && cause.result === "failed") return i18n.t("desktop.tension.errors.failed");
  return causeText(cause);
}

export function useTensionDraft(bridge: UseDs5BridgeResult): TensionDraft {
  const { client } = bridge;
  const supported = supportsTension(bridge.identity);
  const [board, setBoard] = useState<Board | null>(null);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dropped, setDropped] = useState(0);
  const loading = useRef<Ds5BridgeClient | null>(null);
  // cache: OK — key=a saved set's CRC-32 (0xE9 list); invalidated=pruned to the board's CRCs on every read; bound=8 entries (one per slot)
  const byCrc = useRef(new Map<number, TensionSet>());

  // Another board: its staged sets go (the same board reconnecting keeps them),
  // adjusted while rendering like the PC sleep draft.
  if (staged && client && staged.client !== client) {
    if (sameBoard(staged.client, client)) setStaged({ ...staged, client });
    else {
      setStaged(null);
      setDropped((n) => n + 1);
    }
  }
  // lifetime: OK — acquires nothing (the notice for staged sets another board dropped)
  useEffect(() => {
    if (dropped) showDraftsDropped();
  }, [dropped]);

  const read = useCallback(async (from: Ds5BridgeClient) => {
    const list = await from.readTensionList();
    if (!list) throw new KeyedError("desktop.tension.errors.unreadable");
    const sets: (TensionSet | null)[] = new Array<TensionSet | null>(TENSION_SLOTS).fill(null);
    const cache = byCrc.current;
    // loop: SERIAL-REQUIRED — one HID session: one saved set's chunk reads after another
    for (let slot = 0; slot < list.slots; slot++) {
      if (!list.used[slot]) continue;
      const crc = list.crcs[slot];
      const set = cache.get(crc) ?? (await from.readTensionSet(slot, crc));
      if (set) cache.set(crc, set);
      sets[slot] = set;
    }
    // loop: NOT-WORTH — N ≤ 8 cached sets, once per read
    for (const crc of [...cache.keys()]) if (!list.crcs.includes(crc)) cache.delete(crc);
    setBoard({ client: from, sets, choice: list.savedChoice, readOnly: list.newerStore });
  }, []);

  const loadedBoard = client && board?.client === client ? board : null;
  const current = loadedBoard !== null;
  const load = useCallback(() => {
    if (!supported || !client || current || loading.current === client) return;
    loading.current = client;
    read(client)
      .finally(() => {
        if (loading.current === client) loading.current = null;
      })
      // error: SHOWN — desktop.tension.errors.* / the board's keyed errors in the section's error line (with Retry)
      .catch((cause: unknown) => setError(tensionErrorText(cause)));
  }, [supported, client, current, read]);
  const retry = useCallback(async () => {
    if (!client) return;
    setError(null);
    try {
      await read(client);
    } catch (cause) {
      // error: SHOWN — desktop.tension.errors.* / the board's keyed errors in the section's error line
      setError(tensionErrorText(cause));
    }
  }, [client, read]);

  const mine = staged && staged.client === client ? staged : null;
  const { sets, changedSlots } = useMemo(() => {
    const boardSets = loadedBoard ? loadedBoard.sets : new Array<TensionSet | null>(TENSION_SLOTS).fill(null);
    return {
      // loop: NOT-WORTH — N = 8 slots, when the board's sets or the staged ones change
      sets: boardSets.map((s, slot) => (mine && slot in mine.sets ? mine.sets[slot] : s)),
      // loop: NOT-WORTH — N = 8 slots, when the board's sets or the staged ones change
      changedSlots: boardSets.map((s, slot) => !!mine && slot in mine.sets && !sameSet(mine.sets[slot], s)),
    };
  }, [loadedBoard, mine]);
  const boardChoice = loadedBoard ? loadedBoard.choice : null;
  const choice = mine && mine.choice !== undefined ? mine.choice : boardChoice;
  const choiceChanged = !!mine && mine.choice !== undefined && mine.choice !== boardChoice;
  // loop: HOT-PATH-OK — N = 8 slots
  const dirty = current && (choiceChanged || changedSlots.some(Boolean));

  const edit = useCallback(
    (slot: number, set: TensionSet | null) => {
      if (!client) return;
      setStaged((s) => {
        const base = s && s.client === client ? s : { client, sets: {} };
        // A deleted set is no longer the choice (the board does the same).
        const choice = !set && (base.choice ?? boardChoice) === slot ? null : base.choice;
        return { ...base, sets: { ...base.sets, [slot]: set }, ...(choice === undefined ? {} : { choice }) };
      });
    },
    [client, boardChoice],
  );
  const choose = useCallback(
    (slot: number | null) => {
      if (!client) return;
      setStaged((s) => ({ ...(s && s.client === client ? s : { client, sets: {} }), choice: slot }));
    },
    [client],
  );
  const revert = useCallback(() => setStaged(null), []);

  const save = useCallback(async () => {
    if (!dirty || !client || !mine) return true;
    setError(null);
    try {
      // loop: SERIAL-REQUIRED — one HID session, protocol order: deletes, then sets, then the choice that may name one
      for (let slot = 0; slot < TENSION_SLOTS; slot++) if (changedSlots[slot] && !sets[slot]) await client.deleteTensionSet(slot);
      // loop: SERIAL-REQUIRED — one HID session: one set staged and saved after another
      for (let slot = 0; slot < TENSION_SLOTS; slot++) {
        const set = sets[slot];
        if (!changedSlots[slot] || !set) continue;
        if (!setValid(set)) throw new KeyedError("desktop.tension.errors.notValid", { slot });
        await client.saveTensionSet(slot, set);
      }
      if (choiceChanged) await client.chooseTension(choice ?? "none", false);
      setStaged(null);
      await read(client);
      return true;
    } catch (cause) {
      // error: SHOWN — desktop.tension.errors.invalid / failed / notValid (tensionErrorText) in the section's error line, and the save bar's notice (desktop.errors.saveFailed)
      setError(tensionErrorText(cause));
      // What did save is read back, so only what didn't stays staged.
      await read(client).catch(logged("Tension read back after a failed save; the next load shows a failure with Retry"));
      return false;
    }
  }, [dirty, client, mine, changedSlots, sets, choiceChanged, choice, read]);

  const changed = useCallback((slot: number) => changedSlots[slot] ?? false, [changedSlots]);
  return useMemo(
    () => ({ supported, loaded: current, readOnly: !!loadedBoard?.readOnly, error, sets, choice, changed, dirty, load, retry, edit, choose, save, revert }),
    [supported, current, loadedBoard, error, sets, choice, changed, dirty, load, retry, edit, choose, save, revert],
  );
}
