// The main process's JSON files in the user data folder (settings.json,
// game-library-2.json, the older apps' game-library.json), read through the
// one persisted-data helper (src/persisted.ts): a damaged file is copied to
// `<file>.corrupt-<date>` before anything is written over it, what still reads
// is kept, and the page says so (desktop:recovered-files → RecoveredNotice).
import { constants, copyFileSync, readFileSync } from "node:fs";
import { readPersisted, type PersistedSpec } from "../../src/persisted";
import { writeFileAtomic } from "./games/backup";

// `readOnly`: a file this app never writes (the older apps' library): it is
// left exactly as it is, and the notice names it as the kept copy.
export function readPersistedFile<T>(path: string, spec: PersistedSpec<T>, opts: { readOnly?: boolean } = {}): T {
  return readPersisted(
    {
      name: path,
      read: () => {
        try {
          return readFileSync(path, "utf8");
        } catch (cause) {
          // error: PASSES-ON — no file yet is the first start (null: the defaults, nothing said); any other read error goes to readPersisted, which shows it
          if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw cause;
        }
      },
      keepAside: (_raw, stamp) => {
        if (opts.readOnly) return path;
        const to = `${path}.corrupt-${stamp}`;
        // A copy, never a move: if it can't be made (a full disk), the original
        // stays where it is and nothing is written over it now. COPYFILE_EXCL:
        // an earlier copy from the same second is never overwritten.
        // error: PASSES-ON — a failed copy throws to readPersisted, which says the copy wasn't kept
        copyFileSync(path, to, constants.COPYFILE_EXCL);
        return to;
      },
      write: opts.readOnly ? undefined : (text) => writeFileAtomic(path, text),
    },
    spec,
  );
}

// The files' own format: indented, with a final newline.
export const prettyJson = (value: unknown): string => JSON.stringify(value, null, 2) + "\n";
