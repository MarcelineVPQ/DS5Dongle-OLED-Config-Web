// Per-viewer UI preferences in localStorage (panel hidden, rail pinned, sort,
// color vision...). Storage can be blocked or throw; then a preference just
// lasts for this session, so reads fall back and writes are best-effort.
import { useCallback, useState } from "react";

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
}

// A string preference restricted to `allowed` (anything else reads as `fallback`).
export function usePref<T extends string>(key: string, fallback: T, allowed: readonly T[]): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const stored = readPref(key);
    return stored !== null && (allowed as readonly string[]).includes(stored) ? (stored as T) : fallback;
  });
  const set = useCallback(
    (next: T) => {
      setValue(next);
      writePref(key, next);
    },
    [key],
  );
  return [value, set];
}

// A yes/no preference stored as "1" / "0".
export function useFlagPref(key: string): [boolean, (value: boolean) => void] {
  const [value, set] = usePref<"1" | "0">(key, "0", ["1", "0"]);
  return [value === "1", useCallback((next: boolean) => set(next ? "1" : "0"), [set])];
}
