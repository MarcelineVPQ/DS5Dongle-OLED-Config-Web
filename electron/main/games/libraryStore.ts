// userData/game-library-2.json: written atomically, read leniently (a bad
// file never stops the app; it starts empty and keeps the bad file aside).
//
// Why a second file: apps before format-2 profiles (0.9.4, 0.9.5-dev.1 to
// dev.5) read userData/game-library.json with a strict schema, and a library
// holding format-2 profiles would make them set the whole file aside and start
// empty. So this app keeps its library in game-library-2.json and never writes,
// renames or removes game-library.json: on the first start without
// game-library-2.json it copies the old library in once (old profiles load as
// they are, profileValues.ts upgrades them), and from then on only the new file
// is used. Going back to an older app finds its old library, as it was when
// this app first started (stale, but intact).
import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { EMPTY_LIBRARY, LibraryFileSchema, type GameRecord, type LibraryFile, type Mine, type ProfileSettings } from "../../../src/desktop/games/library";
import { writeFileAtomic } from "./backup";

// The library this app reads and writes.
export const LIBRARY_FILE = "game-library-2.json";
// The older apps' library: read once to migrate, never written.
export const OLD_LIBRARY_FILE = "game-library.json";

// The file parsed and validated, or null when it can't be read or is bad.
function readLibrary(path: string): LibraryFile | null {
  try {
    // error: PASSES-ON — a file that doesn't fit reads as null like a broken one; the catch below has the verdict
    const parsed = LibraryFileSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    // error: SILENT-BUG — a damaged library file is moved aside (.bad-<time>) and the app starts with an empty library: every game profile and layout seems gone with no word why (batch E1)
    return null;
  }
}

export class LibraryStore {
  private data: LibraryFile;
  private readonly path: string;
  private readonly oldPath: string;

  constructor(dir: string) {
    this.path = join(dir, LIBRARY_FILE);
    this.oldPath = join(dir, OLD_LIBRARY_FILE);
    this.data = this.load();
  }

  private load(): LibraryFile {
    if (existsSync(this.path)) {
      const data = readLibrary(this.path);
      if (data) return data;
      try {
        renameSync(this.path, `${this.path}.bad-${Date.now()}`);
      } catch {
        // error: NOT-WORTH — can't move it; it gets overwritten on the next save
      }
      return structuredClone(EMPTY_LIBRARY);
    }
    // First start of this app: bring the older apps' library over (a bad or
    // missing old file is left where it is, and the library starts empty).
    const old = existsSync(this.oldPath) ? readLibrary(this.oldPath) : null;
    if (!old) return structuredClone(EMPTY_LIBRARY);
    try {
      writeFileAtomic(this.path, JSON.stringify(old, null, 2) + "\n");
    } catch {
      // error: NOT-WORTH — can't write it now; the next save tries again
    }
    return old;
  }

  private save(): LibraryFile {
    writeFileAtomic(this.path, JSON.stringify(this.data, null, 2) + "\n");
    return this.get();
  }

  get(): LibraryFile {
    return structuredClone(this.data);
  }

  private record(key: string, title: string): GameRecord {
    return (this.data.games[key] ??= { title });
  }

  setProfile(key: string, title: string, settings: ProfileSettings): LibraryFile {
    this.record(key, title).profile = { settings, updated: Date.now() };
    return this.save();
  }

  deleteProfile(key: string): LibraryFile {
    const r = this.data.games[key];
    if (r) {
      delete r.profile;
      if (!r.mine) delete this.data.games[key];
    }
    return this.save();
  }

  setMine(key: string, title: string, mine: Mine): LibraryFile {
    const r = this.record(key, title);
    r.mine = mine;
    if (!r.profile && !Object.values(mine).some((v) => v !== undefined && v !== "")) delete this.data.games[key];
    return this.save();
  }

  // Add or update a saved button layout.
  setLayout(id: string, name: string, table: number[], extra?: number[]): LibraryFile {
    (this.data.layouts ??= {})[id] = { name: name.trim(), table, ...(extra ? { extra } : {}), updated: Date.now() };
    return this.save();
  }

  // Delete a layout; game profiles that used it go back to normal buttons.
  deleteLayout(id: string): LibraryFile {
    if (this.data.layouts) delete this.data.layouts[id];
    for (const r of Object.values(this.data.games)) if (r.profile?.settings.buttonLayout === id) delete r.profile.settings.buttonLayout;
    return this.save();
  }

  setRestore(restore: LibraryFile["restore"]): LibraryFile {
    if (restore) this.data.restore = restore;
    else delete this.data.restore;
    return this.save();
  }
}
