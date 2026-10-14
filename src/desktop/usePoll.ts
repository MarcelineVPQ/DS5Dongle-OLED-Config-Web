import { useEffect, useRef, useState } from "react";
import { causeText } from "./shownError";
import { useWindowShown } from "./useWindowShown";
import { logged } from "../errorText";

// The latest value in a ref (a read function the effects call without re-running).
function useLatest<F>(fn: F) {
  const ref = useRef(fn);
  // lifetime: OK — acquires nothing (keeps the latest function in a ref)
  useEffect(() => {
    ref.current = fn;
  }, [fn]);
  return ref;
}

// Calls `read` every `intervalMs` while `enabled` and the window is on screen
// (paused while it's minimized or in the tray, keeping the last value), never
// overlapping two reads. Returns the latest value and the latest error (null
// once a read succeeds). For UI-only readouts: what the tray, game profiles
// or saved-state sync need polls on its own (useDs5Bridge).
// error: SHOWN — english: each caller shows \`error\` next to its readout (board errors are English, batch E3)
export function usePoll<T>(read: () => Promise<T>, intervalMs: number, enabled: boolean): { value: T | null; error: string | null } {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const readRef = useLatest(read);

  const shown = useWindowShown();
  const running = enabled && shown;

  // lifetime: OK — cleanup: stops and clears the poll (disabled / hidden / unmount)
  useEffect(() => {
    if (!running) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const next = await readRef.current();
        if (!stopped) {
          setValue(next);
          setError(null);
        }
      } catch (cause) {
        // error: SHOWN — english: returned as \`error\`, which the caller shows next to its readout
        if (!stopped) setError(causeText(cause));
      }
      // lifetime: OK — self re-arming; cleared in the cleanup, stops once stopped is set
      if (!stopped) timer = setTimeout(tick, intervalMs);
    };
    tick().catch(logged("usePoll's tick (it catches its own errors)"));
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [running, intervalMs, readRef]);

  return { value: enabled ? value : null, error: enabled ? error : null };
}

// How long Watch live polls before it stops by itself.
export const LIVE_WATCH_MS = 30_000;

export interface SnapshotPoll<T> {
  value: T | null;
  // error: SHOWN — english: the caller shows it next to its readout (the Pico 2 W page: at Diagnostics' heading, WatchLive; board errors are English, batch E3)
  error: string | null;
  asOf: number | null; // Date.now() of the last successful read
  live: boolean; // Watch live is on
  secondsLeft: number; // while live
  watch: () => void; // starts Watch live, or restarts its 30 s
  refresh: () => void; // one read now (after a Reset)
}

// A readout's lean read (the Pico 2 W page's dials and Diagnostics): ONE
// read when it mounts (or `enabled` turns on: a new board), as a snapshot
// with the time it was read; then nothing, until Watch live polls every
// `intervalMs` for LIVE_WATCH_MS and stops by itself (watch() again restarts
// the 30 s). Live pauses with the window hidden (usePoll). Idle cost: none
// outside Watch live (no timer at all); while live, the poll and a 1 s
// countdown.
// `source`: what is read (the board's client): a new one takes a new snapshot.
// `read(live)`: live is true for Watch live's reads, false for a snapshot.
export function useSnapshotPoll<T>(read: (live: boolean) => Promise<T>, intervalMs: number, enabled: boolean, source?: unknown): SnapshotPoll<T> {
  const [snap, setSnap] = useState<{ value: T; at: number } | null>(null);
  const [snapError, setSnapError] = useState<string | null>(null);
  const [liveUntil, setLiveUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const readRef = useLatest(read);
  const [snapAsk, setSnapAsk] = useState(0);
  // The snapshot: once per mount / board, and again on refresh().
  // lifetime: OK — acquires nothing; the cleanup drops a late answer (unmount / disabled)
  useEffect(() => {
    if (!enabled) return;
    let stale = false;
    // error: SHOWN — english: the rejection becomes `error`, shown by the caller (board errors are English, batch E3)
    readRef.current(false).then(
      (value) => {
        if (stale) return;
        setSnap({ value, at: Date.now() });
        setSnapError(null);
      },
      (cause: unknown) => {
        // error: SHOWN — english: returned as `error`, which the caller shows next to its readout (board errors are English, batch E3)
        if (!stale) setSnapError(causeText(cause));
      },
    );
    return () => {
      stale = true;
    };
  }, [enabled, snapAsk, source, readRef]);
  const live = enabled && liveUntil !== null;
  // The countdown, and the end of Watch live.
  // lifetime: OK — cleanup: clears the 1 s countdown (live ends / unmount)
  useEffect(() => {
    if (liveUntil === null) return;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t >= liveUntil) setLiveUntil(null);
    };
    // lifetime: OK — cleared in the effect cleanup (live ends / restarts / unmount)
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [liveUntil]);
  // lifetime: OK — usePoll: only while Watch live is on, stops when hidden or on unmount
  const polled = usePoll(async () => ({ value: await readRef.current(true), at: Date.now() }), intervalMs, live);
  // The newer of the snapshot and the last live read (a live read is kept after Watch live ends).
  // cache: OK — key=none (the last live read); invalidated=a newer snapshot or live read; bound=1 entry
  const [lastLive, setLastLive] = useState<{ value: T; at: number } | null>(null);
  if (polled.value && polled.value !== lastLive) setLastLive(polled.value);
  const newest = lastLive && (!snap || lastLive.at >= snap.at) ? lastLive : snap;
  return {
    value: enabled ? (newest?.value ?? null) : null,
    error: enabled ? (live ? polled.error : snapError) : null,
    asOf: enabled ? (newest?.at ?? null) : null,
    live,
    secondsLeft: liveUntil === null ? 0 : Math.max(0, Math.ceil((liveUntil - now) / 1000)),
    watch: () => {
      const t = Date.now();
      setNow(t);
      setLiveUntil(t + LIVE_WATCH_MS);
    },
    refresh: () => setSnapAsk((n) => n + 1),
  };
}
