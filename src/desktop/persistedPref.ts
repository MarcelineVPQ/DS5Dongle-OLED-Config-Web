// The page's JSON preferences in local storage (dismissed notices, pinned
// sections, the pairing slots' controllers, the controller's colors,
// unticked Games changes), read through the one persisted-data helper
// (src/persisted.ts): a damaged one keeps what still reads, its damaged text
// is kept as `<key>.corrupt-<date>`, what loaded is written back, and the
// notice says so.
import { readPersisted, type PersistedSpec } from "../persisted";
import { readPref } from "./storage";

// `raw`: the stored text when the caller already has it (a preference hook's
// state); read from storage otherwise.
export function readPrefJson<T>(key: string, spec: PersistedSpec<T>, raw: string | null = readPref(key)): T {
  return readPersisted(
    {
      name: key,
      read: () => raw,
      keepAside: (text, stamp) => {
        const kept = `${key}.corrupt-${stamp}`;
        // error: PASSES-ON — storage blocked or full: it throws to readPersisted, which says the copy wasn't kept
        window.localStorage.setItem(kept, text);
        return kept;
      },
      // Straight to storage, without the preference event: this runs while a
      // component renders, and the value is already what every reader gets.
      // error: PASSES-ON — a failed write-back throws to readPersisted, which logs it (the next change writes it again)
      write: (text) => window.localStorage.setItem(key, text),
    },
    spec,
  );
}
