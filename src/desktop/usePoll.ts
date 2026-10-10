import { useEffect, useRef, useState } from "react";

// Calls `read` every `intervalMs` while `enabled`, never overlapping two reads.
// Returns the latest value and the latest error (null once a read succeeds).
export function usePoll<T>(read: () => Promise<T>, intervalMs: number, enabled: boolean): { value: T | null; error: string | null } {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const readRef = useRef(read);
  useEffect(() => {
    readRef.current = read;
  }, [read]);

  useEffect(() => {
    if (!enabled) return;
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
        if (!stopped) setError(cause instanceof Error ? cause.message : String(cause));
      }
      if (!stopped) timer = setTimeout(tick, intervalMs);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, intervalMs]);

  return { value: enabled ? value : null, error: enabled ? error : null };
}
