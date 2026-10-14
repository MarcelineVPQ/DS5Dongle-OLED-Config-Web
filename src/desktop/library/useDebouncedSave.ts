// A value edited on the page and saved (debounced) to the library file. The
// local copy follows the stored one only when it really changed (by value,
// not object identity: every library write returns a fresh copy) and no save
// is waiting, so an unrelated write never wipes an edit in progress. A save
// still waiting when the page closes is sent, not dropped; cancel() drops it
// (before a delete or a replace, so the old edit can't land after them).
import { useCallback, useEffect, useRef, useState } from "react";
import { shown } from "../shownError";

export function useDebouncedSave<T>(stored: T, save: (value: T) => Promise<unknown>, ms: number) {
  const [value, setValue] = useState(stored);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waiting = useRef<{ value: T } | null>(null);
  const saveRef = useRef(save);
  const latestStored = useRef(stored);
  // Kept current after each render (before the effects below read them).
  useEffect(() => {
    saveRef.current = save;
    latestStored.current = stored;
  });

  const storedKey = JSON.stringify(stored ?? null);
  useEffect(() => {
    if (!timer.current) setValue(latestStored.current);
  }, [storedKey]);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    waiting.current = null;
  }, []);

  // On unmount: send what's still waiting.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (waiting.current) saveRef.current(waiting.current.value).catch(shown("desktop.errors.librarySave"));
    },
    [],
  );

  const set = useCallback(
    (next: T) => {
      setValue(next);
      waiting.current = { value: next };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        waiting.current = null;
        // was SILENT-BUG: a save that failed (a game's profile or its own notes) showed nothing
        saveRef.current(next).catch(shown("desktop.errors.librarySave"));
      }, ms);
    },
    [ms],
  );

  return { value, set, cancel };
}
