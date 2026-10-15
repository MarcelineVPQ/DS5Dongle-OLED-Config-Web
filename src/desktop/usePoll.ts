import { useEffect, useRef, useState } from "react";
import { causeText } from "./shownError";
import { useWindowShown } from "./useWindowShown";
import { logged } from "../errorText";
import { atNextTick } from "./frameTick";

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
    // A read's result goes to the screen on the next frame tick (frameTick.ts),
    // in the same frame as the background's step, not in a frame of its own.
    let pending = () => undefined as unknown;
    const tick = async () => {
      try {
        const next = await readRef.current();
        if (!stopped)
          pending = atNextTick(() => {
            setValue(next);
            setError(null);
          });
      } catch (cause) {
        // error: SHOWN — english: returned as \`error\`, which the caller shows next to its readout
        if (!stopped) pending = atNextTick(() => setError(causeText(cause)));
      }
      // lifetime: OK — self re-arming; cleared in the cleanup, stops once stopped is set
      if (!stopped) timer = setTimeout(tick, intervalMs);
    };
    tick().catch(logged("usePoll's tick (it catches its own errors)"));
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      pending();
    };
  }, [running, intervalMs, readRef]);

  return { value: enabled ? value : null, error: enabled ? error : null };
}
