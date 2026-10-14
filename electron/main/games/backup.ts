// Every Games-page write goes through here: the original files are copied into
// a backup set first, then each new file is written atomically (temp file,
// fsync, rename; symlinked config files are written through to their target).
//
// Undo puts the originals back byte for byte and removes files that did not
// exist before, but only if nothing else has changed those files since: the
// manifest keeps a hash of what we wrote, and a launcher that saved its own
// settings in between (or a newer change set on the same file) makes Undo
// refuse instead of silently discarding those edits. A set can be undone once.
import { createHash } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { LauncherId, Msg } from "../../../src/desktop/games/types";
import type { GameBackup } from "../../../src/desktop/api";

const KEEP = 10;

const MsgSchema: z.ZodType<Msg> = z.lazy(() =>
  z.object({
    key: z.string().max(100),
    params: z.record(z.string(), z.union([z.string().max(2000), MsgSchema])).optional(),
  }),
);

const Owner = z.enum(["steam", "heroic", "lutris", "gog", "epic", "system"]);
export type Owner = z.infer<typeof Owner>;

const ManifestSchema = z.object({
  created: z.string(),
  changes: z.array(MsgSchema).optional(),
  description: z.string().optional(), // sets written before messages were translatable
  restored: z.string().optional(), // when it was undone
  after: z.array(z.string()).optional(), // what to run after restoring, e.g. "restart-wireplumber"
  files: z.array(
    z.object({
      path: z.string(),
      backup: z.string().nullable(), // null: the file didn't exist before
      owner: Owner.optional(), // missing in older sets
      written: z.string().nullable().optional(), // sha256 after our write; null: we removed it
      link: z.string().optional(), // the path was a symlink to this (restored as one)
    }),
  ),
});
export type BackupManifest = z.infer<typeof ManifestSchema>;

// What the page lists (api.ts GameBackup), plus whether it was undone.
export interface BackupSummary extends GameBackup {
  restored: boolean;
}

export interface BackupFile {
  path: string;
  owner: Owner;
}

export class UndoConflictError extends Error {
  constructor(readonly changed: string[]) {
    super(`Changed since the backup: ${changed.join(", ")}`);
  }
}

export const BACKUP_ID = /^\d{8}T\d{6}Z-[0-9a-f]{6}$/;

const sha256 = (path: string): string | null => (existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null);

// Write the real file behind a symlink (dotfile managers link config files);
// renaming over the link would replace it with a plain copy.
function target(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export function writeFileAtomic(path: string, data: string | Buffer): void {
  const dest = target(path);
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.ds5-tmp-${process.pid}`;
  let mode = 0o644;
  try {
    mode = statSync(dest).mode & 0o777;
  } catch {
    // new file
  }
  try {
    const fd = openSync(tmp, "w", mode);
    try {
      writeSync(fd, typeof data === "string" ? Buffer.from(data, "utf8") : data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, dest);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

function removeFile(path: string): void {
  const dest = target(path);
  if (existsSync(dest)) unlinkSync(dest);
}

function fsyncFile(path: string): void {
  // Read-write: Windows refuses fsync on a read-only handle (EPERM).
  const fd = openSync(path, "r+");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

export class Backups {
  constructor(private readonly dir: string) {}

  // Snapshot `files`, then run `write`. If writing throws, everything is rolled back.
  run(changes: Msg[], files: BackupFile[], write: () => void, after: string[] = []): string {
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d+Z$/, "Z");
    const id = `${stamp}-${Math.floor(Math.random() * 0xffffff)
      .toString(16)
      .padStart(6, "0")}`;
    const setDir = join(this.dir, id);
    mkdirSync(setDir, { recursive: true });
    const unique = [...new Map(files.map((f) => [f.path, f])).values()];
    let manifest: BackupManifest;
    const save = () => writeFileAtomic(join(setDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    try {
      manifest = {
        created: new Date().toISOString(),
        changes,
        after,
        files: unique.map(({ path, owner }, i) => {
          if (!existsSync(path)) return { path, owner, backup: null };
          const backup = `${i}.orig`;
          copyFileSync(path, join(setDir, backup));
          fsyncFile(join(setDir, backup));
          const link = lstatSync(path).isSymbolicLink() ? readlinkSync(path) : undefined;
          return { path, owner, backup, ...(link ? { link } : {}) };
        }),
      };
      save();
    } catch (err) {
      // No snapshot, no change: leave nothing half-made behind.
      rmSync(setDir, { recursive: true, force: true });
      throw err;
    }
    try {
      write();
    } catch (err) {
      this.putBack(setDir, manifest);
      rmSync(setDir, { recursive: true, force: true });
      throw err;
    }
    for (const f of manifest.files) f.written = sha256(f.path);
    try {
      save();
    } catch {
      // The change is made and its originals are saved; without the hashes,
      // Undo just can't detect later edits to these files.
    }
    this.prune();
    return id;
  }

  // Undo a set. Throws UndoConflictError (and changes nothing) if any file was
  // changed after our write; returns what to run afterwards (e.g. restart-wireplumber).
  restore(id: string): { files: string[]; after: string[] } {
    const manifest = this.manifest(id);
    if (manifest.restored) throw new Error("This change set was already undone.");
    const changed = manifest.files.filter((f) => f.written !== undefined && sha256(f.path) !== f.written).map((f) => f.path);
    if (changed.length) throw new UndoConflictError(changed);
    const setDir = join(this.dir, id);
    this.putBack(setDir, manifest);
    manifest.restored = new Date().toISOString();
    writeFileAtomic(join(setDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    return { files: manifest.files.map((f) => f.path), after: manifest.after ?? [] };
  }

  private putBack(setDir: string, manifest: BackupManifest): void {
    for (const f of manifest.files) {
      if (f.backup === null) removeFile(f.path);
      else {
        // A symlink we removed (e.g. a dotfile-managed rule) comes back as the
        // same link; the original content is then written through it.
        if (f.link && !existsSync(f.path) && !isLink(f.path)) symlinkSync(f.link, f.path);
        writeFileAtomic(f.path, readFileSync(join(setDir, f.backup)));
      }
    }
  }

  list(): BackupSummary[] {
    let ids: string[];
    try {
      ids = readdirSync(this.dir).filter((d) => BACKUP_ID.test(d));
    } catch {
      return [];
    }
    return ids
      .sort()
      .reverse()
      .flatMap((id) => {
        try {
          const m = this.manifest(id);
          // loop: NOT-WORTH — files per backup set, a handful
          return [{ id, created: m.created, changes: m.changes ?? [{ key: "legacy", params: { text: m.description ?? "" } }], files: m.files.map((f) => f.path), restored: !!m.restored }];
        } catch {
          return [];
        }
      });
  }

  manifest(id: string): BackupManifest {
    if (!BACKUP_ID.test(id)) throw new Error("Invalid backup id");
    return ManifestSchema.parse(JSON.parse(readFileSync(join(this.dir, id, "manifest.json"), "utf8")));
  }

  // Launchers that own files in this set (older sets: guessed from the path).
  owners(id: string): LauncherId[] {
    const owners = this.manifest(id).files.map((f) => f.owner ?? guessOwner(f.path));
    return [...new Set(owners.filter((o): o is LauncherId => o !== "system"))];
  }

  // Keeps the newest KEEP sets, and for every file the oldest set that still
  // holds its original (not undone yet), so the first state of a config is
  // never lost however many changes follow.
  private prune(): void {
    const ids = readdirSync(this.dir)
      .filter((d) => BACKUP_ID.test(d))
      .sort();
    const keep = new Set(ids.slice(-KEEP));
    const originals = new Set<string>();
    for (const id of ids) {
      let m: BackupManifest;
      try {
        m = this.manifest(id);
      } catch {
        continue; // unreadable: leave it for the user to inspect
      }
      if (m.restored) continue;
      // loop: NOT-WORTH — files per backup set, pruning after a write
      for (const f of m.files) {
        if (originals.has(f.path)) continue;
        originals.add(f.path);
        keep.add(id);
      }
    }
    for (const id of ids) if (!keep.has(id)) rmSync(join(this.dir, id), { recursive: true, force: true });
  }
}

// Only for sets written before owners were recorded; those touched just these locations.
function guessOwner(raw: string): Owner {
  const path = raw.replace(/\\/g, "/"); // either separator
  if (path.includes("/.config/heroic/") || path.includes("/com.heroicgameslauncher.hgl/")) return "heroic";
  if (path.includes("/lutris/")) return "lutris";
  if (path.includes("/wireplumber/") || path.includes("/pipewire/")) return "system";
  return "steam";
}
