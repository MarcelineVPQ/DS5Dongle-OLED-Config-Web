import { useEffect, useRef, useState } from "react";
import { errorText } from "../errorText";
import { useWindowShown } from "./useWindowShown";

// Calls `read` every `intervalMs` while `enabled` and the window is on screen
// (paused while it's minimized or in the tray, keeping the last value), never
// overlapping two reads. Returns the latest value and the latest error (null
// once a read succeeds). For UI-only readouts: what the tray, game profiles
// or saved-state sync need polls on its own (useDs5Bridge).
export function usePoll<T>(read: () => Promise<T>, intervalMs: number, enabled: boolean): { value: T | null; error: string | null } {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const readRef = useRef(read);
  // lifetime: OK — acquires nothing (keeps the latest read function in a ref)
  useEffect(() => {
    readRef.current = read;
  }, [read]);

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
        if (!stopped) setError(errorText(cause));
      }
      // lifetime: OK — self re-arming; cleared in the cleanup, stops once stopped is set
      if (!stopped) timer = setTimeout(tick, intervalMs);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [running, intervalMs]);

  return { value: enabled ? value : null, error: enabled ? error : null };
}
