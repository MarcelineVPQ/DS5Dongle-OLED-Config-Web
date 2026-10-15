// A card's settings that the dongle keeps per pairing slot (calibration,
// stick curves): read when the card opens, again when the slot in use changes
// and on Retry, with a draft to edit. One read effect and one error line for
// both cards.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { causeText } from "../shownError";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import type { Ds5BridgeClient } from "../../protocol/bridgeClient";
import { BusyButton } from "../controls";

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
  // Retry's promise: settled when the read it started ends (its busy button).
  const retried = useRef<(() => void) | null>(null);
  const settle = () => {
    retried.current?.();
    retried.current = null;
  };
  // What the dongle has now (after a read, or a save read back).
  const loaded = useCallback((r: SlotRead<T>) => {
    setSlot(r.slot);
    setSaved(r.value);
    setDraft(r.value);
  }, []);

  // The slot in use now; reloads when the controller (slot) changes.
  const currentSlot = bridge.identity?.currentSlot;
  // lifetime: OK — cleanup: drops a late read (acquires nothing else)
  useEffect(() => {
    if (!client || !supported) return settle();
    let live = true;
    read(client)
      .then((r) => {
        if (!live) return;
        if (!r) throw new Error(unreadable);
        loaded(r);
        setError(null);
      })
      // error: SHOWN — desktop.errors.board.timeout and the other keyed board errors (causeText): SlotReadError with Retry
      .catch((cause) => live && setError(causeText(cause)))
      .finally(settle);
    return () => {
      live = false;
    };
  }, [client, supported, currentSlot, loadTry, read, unreadable, loaded]);

  const retry = () =>
    new Promise<void>((resolve) => {
      retried.current = resolve;
      setLoadTry((n) => n + 1);
    });
  return { slot, saved, draft, setDraft, error, setError, loaded, retry };
}

// The error line, with Retry while nothing could be read yet.
// error: SHOWN — desktop.errors.board.timeout and the other keyed board errors (causeText): the read error itself, with Retry
export function SlotReadError({ error, retry }: { error: string | null; retry: (() => Promise<void>) | null }) {
  const { t } = useTranslation();
  if (!error) return null;
  return (
    <p className="dk-bad">
      {error}{" "}
      {retry && (
        <BusyButton className="dk-btn" onClick={retry}>
          {t("desktop.calib.retry")}
        </BusyButton>
      )}
    </p>
  );
}
