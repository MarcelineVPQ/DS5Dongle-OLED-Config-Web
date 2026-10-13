// A card's settings that the dongle keeps per pairing slot (calibration,
// stick curves): read when the card opens, again when the slot in use changes
// and on Retry, with a draft to edit. One read effect and one error line for
// both cards.
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { errorText } from "../../errorText";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import type { Ds5BridgeClient } from "../../protocol/bridgeClient";

export interface SlotRead<T> {
  slot: number;
  value: T;
}

// `read` must be stable (a module-level function); it resolves null when the
// dongle's answer can't be read, shown as `unreadable`.
export function useSlotSettings<T>(bridge: UseDs5BridgeResult, supported: boolean, initial: T, read: (client: Ds5BridgeClient) => Promise<SlotRead<T> | null>, unreadable = "") {
  const client = bridge.client;
  const [slot, setSlot] = useState(0);
  const [saved, setSaved] = useState<T | null>(null);
  const [draft, setDraft] = useState<T>(initial);
  const [error, setError] = useState<string | null>(null);
  const [loadTry, setLoadTry] = useState(0);
  // What the dongle has now (after a read, or a save read back).
  const loaded = useCallback((r: SlotRead<T>) => {
    setSlot(r.slot);
    setSaved(r.value);
    setDraft(r.value);
  }, []);

  // The slot in use now; reloads when the controller (slot) changes.
  const currentSlot = bridge.identity?.currentSlot;
  useEffect(() => {
    if (!client || !supported) return;
    let live = true;
    read(client)
      .then((r) => {
        if (!live) return;
        if (!r) throw new Error(unreadable);
        loaded(r);
        setError(null);
      })
      .catch((cause) => live && setError(errorText(cause)));
    return () => {
      live = false;
    };
  }, [client, supported, currentSlot, loadTry, read, unreadable, loaded]);

  return { slot, saved, draft, setDraft, error, setError, loaded, retry: () => setLoadTry((n) => n + 1) };
}

// The error line, with Retry while nothing could be read yet.
export function SlotReadError({ error, retry }: { error: string | null; retry: (() => void) | null }) {
  const { t } = useTranslation();
  if (!error) return null;
  return (
    <p className="dk-bad">
      {error}{" "}
      {retry && (
        <button type="button" className="dk-btn" onClick={retry}>
          {t("desktop.calib.retry")}
        </button>
      )}
    </p>
  );
}
