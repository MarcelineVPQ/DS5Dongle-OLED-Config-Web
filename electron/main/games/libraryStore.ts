// userData/game-library-2.json: written atomically, read leniently (a bad
// file never stops the app: what still reads is kept, the damaged file is
// copied aside, and the page says so).
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
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ButtonLayoutSchema, EMPTY_LIBRARY, GameKeySchema, GameRecordSchema, LayoutIdSchema, LibraryFileSchema, MineSchema, ProfileSettingsSchema } from "../../../src/desktop/games/library";
import type { GameRecord, LibraryFile, Mine, ProfileSettings } from "../../../src/desktop/games/library";
import { isObject, salvageObject, salvageRecord, type PersistedKind, type PersistedSpec, type Salvaged } from "../../../src/persisted";
import { writeFileAtomic } from "./backup";
import { prettyJson, readPersistedFile } from "../persistedFile";

// The library this app reads and writes.
export const LIBRARY_FILE = "game-library-2.json";
// The older apps' library: read once to migrate, never written.
export const OLD_LIBRARY_FILE = "game-library.json";

// One game's entry from a damaged file: the title and whatever of its
// profile and the player's own data still reads (a profile keeps its settings
// that fit). An entry with nothing left but its title is dropped.
function salvageGame(data: unknown): Salvaged<GameRecord> | null {
  // error: NOT-WORTH — an entry that doesn't fit is salvaged part by part below; what's lost is counted, which the notice says
  const whole = GameRecordSchema.safeParse(data);
  if (whole.success) return { value: whole.data, lost: false };
  if (!isObject(data)) return null;
  // error: NOT-WORTH — no readable title: the entry is dropped and counted as lost
  const title = GameRecordSchema.shape.title.safeParse(data.title);
  if (!title.success) return null;
  const record: GameRecord = { title: title.data };
  const profile = data.profile;
  if (isObject(profile)) {
    const settings = salvageObject(ProfileSettingsSchema, profile.settings);
    // error: NOT-WORTH — a profile without a readable time is dropped and counted as lost
    const updated = z.number().safeParse(profile.updated);
    if (settings && updated.success) record.profile = { settings: settings.value, updated: updated.data };
  }
  const mine = salvageObject(MineSchema, data.mine);
  if (mine) record.mine = mine.value;
  return record.profile || record.mine ? { value: record, lost: true } : null;
}

// What of a damaged library still reads: every game entry and button layout
// that fits (part by part), and the restore point if it fits.
function salvageLibrary(data: unknown): Salvaged<LibraryFile> | null {
  // error: NOT-WORTH — a file that doesn't fit whole is salvaged part by part below; what's lost is counted, which the notice says
  const whole = LibraryFileSchema.safeParse(data);
  if (whole.success) return { value: whole.data, lost: false };
  if (!isObject(data)) return null;
  const games = salvageRecord(data.games, GameKeySchema, salvageGame);
  const layouts =
    data.layouts === undefined
      ? null
      : salvageRecord(data.layouts, LayoutIdSchema, (v) => {
          // error: NOT-WORTH — a layout that doesn't fit is left out and counted as lost
          const layout = ButtonLayoutSchema.safeParse(v);
          return layout.success ? { value: layout.data, lost: false } : null;
        });
  // error: NOT-WORTH — a restore point that doesn't fit is left out (the dongle keeps its settings); counted as lost
  const restore = LibraryFileSchema.shape.restore.safeParse(data.restore);
  const value: LibraryFile = { version: 1, games: games?.value ?? {} };
  if (layouts && Object.keys(layouts.value).length > 0) value.layouts = layouts.value;
  if (restore.success && restore.data) value.restore = restore.data;
  // The whole didn't fit, so something was left out.
  return { value, lost: true };
}

const librarySpec = (kind: PersistedKind): PersistedSpec<LibraryFile> => ({
  kind,
  salvage: salvageLibrary,
  fallback: () => structuredClone(EMPTY_LIBRARY),
  serialize: prettyJson,
});

export class LibraryStore {
  // cache: OK — key=none (the whole library.json); invalidated=write-through: every change saves the file, single-instance app, nothing else writes it; bound=one file (games x profiles)
  private data: LibraryFile;
  private readonly path: string;
  private readonly oldPath: string;

  constructor(dir: string) {
    this.path = join(dir, LIBRARY_FILE);
    this.oldPath = join(dir, OLD_LIBRARY_FILE);
    this.data = this.load();
  }

  // A damaged file (batch E1, was SILENT-BUG: it was moved aside and the app
  // started empty with no word): what still reads is kept, the damaged file
  // is copied to `.corrupt-<date>` and the page says so (readPersistedFile).
  private load(): LibraryFile {
    if (existsSync(this.path)) return readPersistedFile(this.path, librarySpec("library"));
    // First start of this app: bring the older apps' library over. It's only
    // read (a damaged one is left exactly as it is, and the page says so),
    // and the new file is written at once, so this happens only once.
    if (!existsSync(this.oldPath)) return structuredClone(EMPTY_LIBRARY);
    const old = readPersistedFile(this.oldPath, librarySpec("oldLibrary"), { readOnly: true });
    try {
      writeFileAtomic(this.path, prettyJson(old));
    } catch {
      // error: NOT-WORTH — can't write it now; the next save tries again
    }
    return old;
  }

  private save(): LibraryFile {
    writeFileAtomic(this.path, prettyJson(this.data));
    return this.get();
  }

  get(): LibraryFile {
    return structuredClone(this.data);
  }

  // Whether any game has a profile (the running-game watcher's pace), without copying the library.
  hasProfiles(): boolean {
    // loop: HOT-PATH-OK — the library's games (tens to a few hundred), once per watcher pass, stops at the first profile
    return Object.values(this.data.games).some((r) => r.profile);
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
