// userData/game-library.json: written atomically, read leniently (a bad
// file never stops the app; it starts empty and keeps the bad file aside).
import { readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { EMPTY_LIBRARY, LibraryFileSchema, type GameRecord, type LibraryFile, type Mine, type ProfileSettings } from "../../../src/desktop/games/library";
import { writeFileAtomic } from "./backup";

export class LibraryStore {
  private data: LibraryFile;
  private readonly path: string;

  constructor(dir: string) {
    this.path = join(dir, "game-library.json");
    this.data = this.load();
  }

  private load(): LibraryFile {
    let raw: string;
    try {
      raw = readFileSync(this.path, "utf8");
    } catch {
      return structuredClone(EMPTY_LIBRARY);
    }
    const parsed = (() => {
      try {
        return LibraryFileSchema.safeParse(JSON.parse(raw));
      } catch {
        return null;
      }
    })();
    if (parsed?.success) return parsed.data;
    try {
      renameSync(this.path, `${this.path}.bad-${Date.now()}`);
    } catch {
      // can't move it; it gets overwritten on the next save
    }
    return structuredClone(EMPTY_LIBRARY);
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
