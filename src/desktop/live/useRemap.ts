// The dongle's button-remap table for the live view: read once per connection,
// edited one button at a time from the side panel, and applied explicitly
// (the firmware writes remaps straight to flash, so there is no "save" step;
// Apply is the commit, verified by re-reading the table and its revision).
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Ds5BridgeClient } from "../../protocol/bridgeClient";
import { identityTable, tablesEqual, type RemapState } from "../../protocol/remap";

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
}

export function useRemap(client: Ds5BridgeClient | null): Remap {
  const { t } = useTranslation();
  const [state, setState] = useState<RemapState | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [draft, setDraft] = useState<number[]>(identityTable);
  const [busy, setBusy] = useState(false);
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
      (cause: unknown) => live && setError(cause instanceof Error ? cause.message : String(cause)),
    );
    return () => {
      live = false;
    };
  }, [client]);

  const device = state?.table ?? identityTable();

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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
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
    resetAll: useCallback(() => setDraft(identityTable()), []),
  };
}
