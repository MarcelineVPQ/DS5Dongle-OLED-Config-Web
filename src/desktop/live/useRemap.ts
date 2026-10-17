// The dongle's button-remap table: read once per connection, edited one
// button at a time from the side panel, and written by the save bar's Save
// (boardDrafts.tsx: the firmware writes remaps straight to flash, so the
// write is the save, verified by re-reading the table and its revision).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { causeText } from "../shownError";
import { sameBoard, showDraftsDropped } from "./slotSettings";
import { useTranslation } from "react-i18next";
import type { Ds5BridgeClient } from "../../protocol/bridgeClient";
import { defaultExtra, identityTable, tablesEqual, type RemapState } from "../../protocol/remap";
import { sayInPassing } from "../narrator";
import { logged } from "../../errorText";

export interface Remap {
  supported: boolean | null; // null while loading
  device: number[]; // what the dongle has
  draft: number[];
  dirty: boolean;
  busy: boolean;
  // error: SHOWN — desktop.errors.boardFailed, remap.verifyFailed and the other keyed board errors (causeText): the remap card's error notice
  error: string | null;
  clearError: () => void; // the notice's ×
  setTarget: (source: number, target: number) => void;
  apply: () => Promise<boolean>; // the save bar's write; false = the error says why
  revert: () => void;
  resetAll: () => void;
  load: (table: number[], layout?: { id: string; name: string }, extra?: number[]) => void; // a saved layout into the editor
  // The saved layout last loaded into the editor (cleared by Reset all).
  loaded: { id: string; name: string; table: number[] } | null;
  temporary: boolean; // a game's layout is on the dongle now (protocol 1.8)
  // Protocol 1.9: the Edge's Fn buttons and paddles (REMAP_EXTRA_PARTS order);
  // null on firmware without it.
  extraDevice: number[] | null;
  extraDraft: number[];
  setExtra: (index: number, value: number) => void;
}

export function useRemap(client: Ds5BridgeClient | null, temporary: boolean | null = null, reloadKey: string | null = null): Remap {
  const { t } = useTranslation();
  const [state, setState] = useState<RemapState | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [draft, setDraft] = useState<number[]>(identityTable);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState<{ id: string; name: string; table: number[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clearError = useCallback(() => setError(null), []);
  const [extraDevice, setExtraDevice] = useState<number[] | null>(null);
  const [extraDraft, setExtraDraft] = useState<number[]>(defaultExtra);
  // The connection the table was read from: until this one's read is in, the
  // old board's table is neither compared with nor written.
  const [readFor, setReadFor] = useState<Ds5BridgeClient | null>(null);
  // What a new read compares with (it lands outside a render).
  const latest = useRef({ draft, table: state?.table ?? null, extraDraft, extraDevice, readFor });
  // lifetime: OK — acquires nothing (mirrors state into a ref)
  useEffect(() => {
    latest.current = { draft, table: state?.table ?? null, extraDraft, extraDevice, readFor };
  });
  // Staged board edits set aside while a game's layout is on (the editor
  // then shows and edits the game's buttons), put back when it comes off.
  // cache: OK — key=the board (sameBoard); invalidated=put back or dropped on the next read without a game's layout; bound=1 table pair
  const parked = useRef<{ from: Ds5BridgeClient; draft: number[]; extraDraft: number[] } | null>(null);

  // lifetime: OK — cleanup: drops late reads (acquires nothing else)
  useEffect(() => {
    if (!client) return;
    let live = true;
    // Firmware without the Edge extras answers nothing (or stalls): no rows then.
    // error: NOT-WORTH — firmware without the Edge extras answers nothing: no extra rows
    const extra = client.readRemapExtra().catch(() => null);
    // error: SHOWN — desktop.errors.board.timeout and the other keyed board errors (causeText): the remap card's error notice
    client.readRemap().then(
      async (s) => {
        const e = await extra;
        if (!live) return;
        // A staged change survives the read only on the same board (a reconnect,
        // a game's layout going on or off); on another board it's dropped, said once.
        const was = latest.current;
        const staged = !!was.readFor && (!tablesEqual(was.draft, was.table ?? identityTable()) || (!!was.extraDevice && !tablesEqual(was.extraDraft, was.extraDevice)));
        const board = sameBoard(was.readFor, client);
        let draftNext = s ? s.table.slice() : identityTable();
        let extraNext = e ? e.slice() : defaultExtra();
        const back = parked.current;
        const backHere = !!back && sameBoard(back.from, client);
        let dropped = !!back && !backHere;
        parked.current = temporary && backHere ? back : null; // the game's layout still on: they stay aside
        if (temporary && staged && board && !backHere) parked.current = { from: client, draft: was.draft, extraDraft: was.extraDraft };
        else if (!temporary && back && backHere) [draftNext, extraNext] = [back.draft, back.extraDraft];
        else if (staged && board) [draftNext, extraNext] = [was.draft, was.extraDraft];
        else if (staged) dropped = true;
        if (dropped) showDraftsDropped();
        setSupported(!!s);
        setState(s);
        setDraft(draftNext);
        setExtraDevice(e);
        setExtraDraft(extraNext);
        setReadFor(client);
        setError(null);
      },
      (cause: unknown) => {
        if (!live) return;
        setError(causeText(cause));
        extra.then((e) => live && setExtraDevice(e)).catch(logged("the Edge extras after a failed remap read (the card shows the remap error)"));
      },
    );
    return () => {
      live = false;
    };
    // Read again when a game's layout goes on or comes off (or a new version of it).
  }, [client, temporary, reloadKey]);

  // Stable between renders (the live view re-renders ~30 times a second).
  const device = useMemo(() => state?.table ?? identityTable(), [state]);

  const apply = useCallback(async (): Promise<boolean> => {
    if (!client || readFor !== client) return false;
    setBusy(true);
    setError(null);
    try {
      if (!tablesEqual(draft, state?.table ?? identityTable())) await client.applyRemap(draft);
      if (extraDevice && !tablesEqual(extraDraft, extraDevice)) await client.applyRemapExtra(extraDraft, false);
      const after = await client.readRemap();
      const afterExtra = extraDevice ? await client.readRemapExtra() : null;
      if (!after || !tablesEqual(after.table, draft) || (extraDevice && (!afterExtra || !tablesEqual(afterExtra, extraDraft)))) throw new Error(t("remap.verifyFailed"));
      setState(after);
      setDraft(after.table.slice());
      if (afterExtra) {
        setExtraDevice(afterExtra);
        setExtraDraft(afterExtra.slice());
      }
      sayInPassing("app_remapped");
      return true;
    } catch (cause) {
      // error: SHOWN — remap.verifyFailed (or the board's failure, via causeText)
      setError(causeText(cause));
      // The dongle may have applied it anyway (in RAM, when only saving to
      // flash failed): show what it really has now.
      // error: NOT-WORTH — a re-read after the failure that is already shown; the old table stays
      await client.readRemap().then(
        (now) => now && setState(now),
        () => undefined,
      );
      return false;
    } finally {
      setBusy(false);
    }
  }, [client, readFor, draft, state, t, extraDevice, extraDraft]);

  const setTarget = useCallback((source: number, target: number) => setDraft((d) => d.map((v, i) => (i === source ? target : v))), []);
  const revert = useCallback(() => {
    setDraft(device.slice());
    if (extraDevice) setExtraDraft(extraDevice.slice());
  }, [device, extraDevice]);
  const resetAll = useCallback(() => {
    setDraft(identityTable());
    setExtraDraft(defaultExtra());
    setLoaded(null);
  }, []);
  const load = useCallback((table: number[], layout?: { id: string; name: string }, extra?: number[]) => {
    setDraft(table.slice());
    setExtraDraft(extra ? extra.slice() : defaultExtra());
    setLoaded(layout ? { ...layout, table: table.slice() } : null);
  }, []);
  const setExtra = useCallback((index: number, value: number) => setExtraDraft((d) => d.map((v, i) => (i === index ? value : v))), []);

  // One object per change, not per render: the Buttons list and the saved
  // layouts are memo()ed on it and skip the live view's ~30 renders a second.
  return useMemo(
    () => ({
      supported: client ? supported : null,
      device,
      draft,
      dirty: !!client && readFor === client && (!tablesEqual(draft, device) || (!!extraDevice && !tablesEqual(extraDraft, extraDevice))),
      busy,
      error,
      clearError,
      setTarget,
      apply,
      revert,
      resetAll,
      load,
      extraDevice,
      extraDraft,
      setExtra,
      loaded,
      temporary: !!temporary,
    }),
    [client, readFor, supported, device, draft, extraDevice, extraDraft, busy, error, clearError, setTarget, apply, revert, resetAll, load, setExtra, loaded, temporary],
  );
}
