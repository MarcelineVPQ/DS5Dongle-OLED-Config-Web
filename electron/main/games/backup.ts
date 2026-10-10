// Every Games-page write goes through here: the original files are copied into
// a backup set first, then each new file is written atomically (temp file,
// fsync, rename). Undo puts the originals back byte for byte, and removes
// files that did not exist before.
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

const KEEP = 10;

const ManifestSchema = z.object({
  created: z.string(),
  description: z.string(),
  files: z.array(z.object({ path: z.string(), backup: z.string().nullable() })),
});
export type BackupManifest = z.infer<typeof ManifestSchema>;

export interface BackupSummary {
  id: string;
  created: string;
  description: string;
  files: string[];
}

export const BACKUP_ID = /^\d{8}T\d{6}Z-[0-9a-f]{6}$/;

export function writeFileAtomic(path: string, data: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.ds5-tmp-${process.pid}`;
  let mode: number | undefined;
  try {
    mode = statSync(path).mode & 0o777;
  } catch {
    mode = undefined;
  }
  const fd = openSync(tmp, "w", mode ?? 0o644);
  try {
    writeSync(fd, typeof data === "string" ? Buffer.from(data, "utf8") : data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

export class Backups {
  constructor(private readonly dir: string) {}

  // Snapshot `paths`, then run `write`. If writing throws, everything is rolled back.
  run(description: string, paths: string[], write: () => void): string {
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d+Z$/, "Z");
    const id = `${stamp}-${Math.floor(Math.random() * 0xffffff)
      .toString(16)
      .padStart(6, "0")}`;
    const setDir = join(this.dir, id);
    mkdirSync(setDir, { recursive: true });
    const unique = [...new Set(paths)];
    const manifest: BackupManifest = {
      created: new Date().toISOString(),
      description,
      files: unique.map((path, i) => {
        if (!existsSync(path)) return { path, backup: null };
        const backup = `${i}.orig`;
        copyFileSync(path, join(setDir, backup));
        return { path, backup };
      }),
    };
    writeFileAtomic(join(setDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    try {
      write();
    } catch (err) {
      this.restore(id);
      throw err;
    }
    this.prune();
    return id;
  }

  restore(id: string): string[] {
    if (!BACKUP_ID.test(id)) throw new Error("Invalid backup id");
    const setDir = join(this.dir, id);
    const manifest = ManifestSchema.parse(JSON.parse(readFileSync(join(setDir, "manifest.json"), "utf8")));
    for (const f of manifest.files) {
      if (f.backup === null) {
        if (existsSync(f.path)) unlinkSync(f.path);
      } else writeFileAtomic(f.path, readFileSync(join(setDir, f.backup)));
    }
    return manifest.files.map((f) => f.path);
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
          const m = ManifestSchema.parse(JSON.parse(readFileSync(join(this.dir, id, "manifest.json"), "utf8")));
          return [{ id, created: m.created, description: m.description, files: m.files.map((f) => f.path) }];
        } catch {
          return [];
        }
      });
  }

  manifest(id: string): BackupManifest {
    if (!BACKUP_ID.test(id)) throw new Error("Invalid backup id");
    return ManifestSchema.parse(JSON.parse(readFileSync(join(this.dir, id, "manifest.json"), "utf8")));
  }

  private prune(): void {
    const ids = readdirSync(this.dir)
      .filter((d) => BACKUP_ID.test(d))
      .sort();
    for (const id of ids.slice(0, Math.max(0, ids.length - KEEP))) rmSync(join(this.dir, id), { recursive: true, force: true });
  }
}
