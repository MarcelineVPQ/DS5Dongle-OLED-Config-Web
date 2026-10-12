// The dongle's button-remap table for the live view: read once per connection,
// edited one button at a time from the side panel, and applied explicitly
// (the firmware writes remaps straight to flash, so there is no "save" step;
// Apply is the commit, verified by re-reading the table and its revision).
import { useCallback, useEffect, useMemo, useState } from "react";
import { errorText } from "../../errorText";
import { useTranslation } from "react-i18next";
import type { Ds5BridgeClient } from "../../protocol/bridgeClient";
import { identityTable, tablesEqual, type RemapState } from "../../protocol/remap";
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
  load: (table: number[], layout?: { id: string; name: string }) => void; // a saved layout into the editor
  // The saved layout last loaded into the editor (cleared by Reset all).
  loaded: { id: string; name: string; table: number[] } | null;
  temporary: boolean; // a game's layout is on the dongle now (protocol 1.8)
}

export function useRemap(client: Ds5BridgeClient | null, temporary: boolean | null = null): Remap {
  const { t } = useTranslation();
  const [state, setState] = useState<RemapState | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [draft, setDraft] = useState<number[]>(identityTable);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState<{ id: string; name: string; table: number[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    let live = true;
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
    // Read again when a game's layout goes on or comes off.
  }, [client, temporary]);

  // Stable between renders (the live view re-renders ~30 times a second).
  const device = useMemo(() => state?.table ?? identityTable(), [state]);

  const apply = useCallback(async () => {
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      const before = state?.revision ?? -1;
      await client.applyRemap(draft);
      const after = await client.readRemap();
      if (!after || !tablesEqual(after.table, draft) || after.revision === before) throw new Error(t("remap.verifyFailed"));
      setState(after);
      setDraft(after.table.slice());
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
  }, [client, draft, state, t]);

  return {
    supported: client ? supported : null,
    device,
    draft,
    dirty: !tablesEqual(draft, device),
    busy,
    error,
    setTarget: useCallback((source: number, target: number) => setDraft((d) => d.map((v, i) => (i === source ? target : v))), []),
    apply,
    revert: useCallback(() => setDraft(device.slice()), [device]),
    resetAll: useCallback(() => {
      setDraft(identityTable());
      setLoaded(null);
    }, []),
    load: useCallback((table: number[], layout?: { id: string; name: string }) => {
      setDraft(table.slice());
      setLoaded(layout ? { ...layout, table: table.slice() } : null);
    }, []),
    loaded,
    temporary: !!temporary,
  };
}
