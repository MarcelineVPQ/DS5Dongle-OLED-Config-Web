import { useEffect, useRef, useState } from "react";
import { causeText } from "./shownError";
import { useWindowShown } from "./useWindowShown";
import { logged } from "../errorText";

// Calls `read` every `intervalMs` while `enabled` and the window is on screen
// (paused while it's minimized or in the tray, keeping the last value), never
// overlapping two reads. Returns the latest value and the latest error (null
// once a read succeeds). For UI-only readouts: what the tray, game profiles
// or saved-state sync need polls on its own (useDs5Bridge).
// error: SHOWN — english: each caller shows \`error\` next to its readout (board errors are English, batch E3)
export function usePoll<T>(read: () => Promise<T>, intervalMs: number, enabled: boolean): { value: T | null; error: string | null } {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const readRef = useRef(read);
  useEffect(() => {
    readRef.current = read;
  }, [read]);

  const shown = useWindowShown();
  const running = enabled && shown;

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
      if (!stopped) timer = setTimeout(tick, intervalMs);
    };
    tick().catch(logged("usePoll's tick (it catches its own errors)"));
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [running, intervalMs]);

  return { value: enabled ? value : null, error: enabled ? error : null };
}
