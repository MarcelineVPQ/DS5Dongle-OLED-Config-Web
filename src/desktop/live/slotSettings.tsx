// Settings the dongle keeps per pairing slot (calibration, stick curves):
// read when the board connects (boardDrafts.tsx), again when the slot in use
// changes and on Retry, with a draft to edit. One read effect and one error
// line for both.
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { causeText, showError } from "../shownError";
import type { UseDs5BridgeResult } from "../../hooks/useDs5Bridge";
import type { Ds5BridgeClient } from "../../protocol/bridgeClient";
import { BusyButton } from "../controls";

export interface SlotRead<T> {
  slot: number;
  value: T;
}

// The same physical board: the same connection, or one that came back with
// the same board id (protocol 1.20: the Pico's own id; a reconnect, a
// replug). Firmware without the id: the same USB serial number, which is the
// paired controller's MAC, so two such boards paired to one DualSense look
// the same (one more reason the stack asks for 1.20). Unknown = not the same.
export function sameBoard(a: Ds5BridgeClient | null, b: Ds5BridgeClient | null): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.boardId || b.boardId) return a.boardId === b.boardId;
  const serial = a.transport.serial;
  return !!serial && serial === b.transport.serial;
}

// A staged change that wasn't kept: another board, or another slot, came back.
export const showDraftsDropped = () => showError("desktop.errors.draftsDropped");

// `read` and `same` must be stable (module-level functions); `read` resolves
// null when the dongle's answer can't be read, shown as `unreadable`.
//
// A staged draft (draft ≠ saved) is kept across a new read only when the
// same board and the same slot come back (a reconnect, Retry); after another
// board or a slot switch it's dropped, and the notice says so. Until the new
// connection's read is in, `readFor` isn't the current client: the old
// values must not be compared with, or written to, the board now connected.
type ReadSlot<T> = (client: Ds5BridgeClient) => Promise<SlotRead<T> | null>;
export function useSlotSettings<T>(bridge: UseDs5BridgeResult, supported: boolean, initial: T, read: ReadSlot<T>, same: (a: T, b: T) => boolean, unreadable = "") {
  const client = bridge.client;
  const [slot, setSlot] = useState(0);
  const [saved, setSaved] = useState<T | null>(null);
  const [draft, setDraft] = useState<T>(initial);
  // The connection `saved` and `slot` were read from.
  const [readFor, setReadFor] = useState<Ds5BridgeClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  // What a new read compares with (it lands outside a render).
  const latest = useRef({ slot, saved, draft, readFor });
  // lifetime: OK — acquires nothing (mirrors state into a ref)
  useEffect(() => {
    latest.current = { slot, saved, draft, readFor };
  });
  const [loadTry, setLoadTry] = useState(0);
  // Retry's promise: settled when the read it started ends (its busy button).
  const retried = useRef<(() => void) | null>(null);
  const settle = () => {
    retried.current?.();
    retried.current = null;
  };
  // What the dongle has now (after a read, or a save read back).
  const loaded = useCallback((r: SlotRead<T>, from: Ds5BridgeClient) => {
    setSlot(r.slot);
    setSaved(r.value);
    setDraft(r.value);
    setReadFor(from);
  }, []);
  // A read after a (re)connect, a slot change or Retry: keeps a staged draft
  // for the same board and slot, else drops it and says so.
  const arrived = useCallback(
    (r: SlotRead<T>, from: Ds5BridgeClient) => {
      const was = latest.current;
      const staged = was.saved !== null && !same(was.draft, was.saved);
      if (staged && sameBoard(was.readFor, from) && was.slot === r.slot) {
        setSlot(r.slot);
        setSaved(r.value);
        setReadFor(from);
        return;
      }
      if (staged) showDraftsDropped();
      loaded(r, from);
    },
    [same, loaded],
  );

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
        arrived(r, client);
        setError(null);
      })
      // error: SHOWN — desktop.errors.board.timeout and the other keyed board errors (causeText): SlotReadError with Retry
      .catch((cause) => live && setError(causeText(cause)))
      .finally(settle);
    return () => {
      live = false;
    };
  }, [client, supported, currentSlot, loadTry, read, unreadable, arrived]);

  const retry = () =>
    new Promise<void>((resolve) => {
      retried.current = resolve;
      setLoadTry((n) => n + 1);
    });
  return { slot, saved, draft, setDraft, readFor, error, setError, loaded, retry };
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
