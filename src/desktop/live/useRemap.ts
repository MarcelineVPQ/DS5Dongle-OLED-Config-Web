// The dongle's button-remap table for the live view: read once per connection,
// edited one button at a time from the side panel, and applied explicitly
// (the firmware writes remaps straight to flash, so there is no "save" step;
// Apply is the commit, verified by re-reading the table and its revision).
import { useCallback, useEffect, useMemo, useState } from "react";
import { errorText } from "../../errorText";
import { useTranslation } from "react-i18next";
import type { Ds5BridgeClient } from "../../protocol/bridgeClient";
import { defaultExtra, identityTable, tablesEqual, type RemapState } from "../../protocol/remap";
import { say } from "../narrator";

export interface Remap {
  supported: boolean | null; // null while loading
  device: number[]; // what the dongle has
  draft: number[];
  dirty: boolean;
  busy: boolean;
  error: string | null;
  setTarget: (source: number, target: number) => void;
  apply: () => Promise<void>;
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
  const [extraDevice, setExtraDevice] = useState<number[] | null>(null);
  const [extraDraft, setExtraDraft] = useState<number[]>(defaultExtra);

  // lifetime: OK — cleanup: drops late reads (acquires nothing else)
  useEffect(() => {
    if (!client) return;
    let live = true;
    // Firmware without the Edge extras answers nothing (or stalls): no rows then.
    client.readRemapExtra().then(
      (e) => {
        if (!live) return;
        setExtraDevice(e);
        setExtraDraft(e ? e.slice() : defaultExtra());
      },
      () => live && setExtraDevice(null),
    );
    client.readRemap().then(
      (s) => {
        if (!live) return;
        setSupported(!!s);
        setState(s);
        setDraft(s ? s.table.slice() : identityTable());
        setError(null);
      },
      (cause: unknown) => live && setError(errorText(cause)),
    );
    return () => {
      live = false;
    };
    // Read again when a game's layout goes on or comes off (or a new version of it).
  }, [client, temporary, reloadKey]);

  // Stable between renders (the live view re-renders ~30 times a second).
  const device = useMemo(() => state?.table ?? identityTable(), [state]);

  const apply = useCallback(async () => {
    if (!client) return;
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
      void say("app_remapped");
    } catch (cause) {
      setError(errorText(cause));
      // The dongle may have applied it anyway (in RAM, when only saving to
      // flash failed): show what it really has now.
      await client.readRemap().then(
        (now) => now && setState(now),
        () => undefined,
      );
    } finally {
      setBusy(false);
    }
  }, [client, draft, state, t, extraDevice, extraDraft]);

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
      dirty: !tablesEqual(draft, device) || (!!extraDevice && !tablesEqual(extraDraft, extraDevice)),
      busy,
      error,
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
    [client, supported, device, draft, extraDevice, extraDraft, busy, error, setTarget, apply, revert, resetAll, load, setExtra, loaded, temporary],
  );
}
