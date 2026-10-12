// Per-viewer UI preferences in localStorage (panel hidden, rail pinned, sort,
// color vision...). Storage can be blocked or throw; then a preference just
// lasts for this session, so reads fall back and writes are best-effort.
import { useCallback, useEffect, useState } from "react";

// Every component using the same preference sees a change at once.
export const PREF_EVENT = "ds5:pref";

export function readPref(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage blocked: lasts for this session
  }
  window.dispatchEvent(new CustomEvent(PREF_EVENT, { detail: { key, value } }));
}

// A string preference restricted to `allowed` (anything else reads as `fallback`).
export function usePref<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const stored = readPref(key);
    return stored !== null && (allowed as readonly string[]).includes(stored) ? (stored as T) : fallback;
  });
  useEffect(() => {
    const on = (e: Event) => {
      const { key: k, value: v } = (e as CustomEvent<{ key: string; value: string }>).detail;
      if (k === key && (allowed as readonly string[]).includes(v)) setValue(v as T);
    };
    window.addEventListener(PREF_EVENT, on);
    return () => window.removeEventListener(PREF_EVENT, on);
  }, [key, allowed]);
  const set = useCallback(
    (next: T) => {
      setValue(next);
      writePref(key, next);
    },
    [key],
  );
  return [value, set];
}

const FLAG = ["1", "0"] as const;

// A yes/no preference stored as "1" / "0".
export function useFlagPref(key: string): [boolean, (value: boolean) => void] {
  const [value, set] = usePref<"1" | "0">(key, "0", FLAG);
  return [value === "1", useCallback((next: boolean) => set(next ? "1" : "0"), [set])];
}

// A free-form string preference (JSON and the like; null while unset).
export function useRawPref(key: string): [string | null, (value: string) => void] {
  const [value, setValue] = useState<string | null>(() => readPref(key));
  useEffect(() => {
    const on = (e: Event) => {
      const { key: k, value: v } = (e as CustomEvent<{ key: string; value: string }>).detail;
      if (k === key) setValue(v);
    };
    window.addEventListener(PREF_EVENT, on);
    return () => window.removeEventListener(PREF_EVENT, on);
  }, [key]);
  const set = useCallback(
    (next: string) => {
      setValue(next);
      writePref(key, next);
    },
    [key],
  );
  return [value, set];
}
