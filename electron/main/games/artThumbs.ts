// Game art scaled down to the width the page shows it at (ds5-art://…?w=,
// artRequest.ts). Launchers keep big files (Steam's 600x900 covers and
// 1920x620 heroes, Heroic and Lutris art often larger) and the Games page
// shows most of them small; decoded, every picture costs width x height x 4
// bytes in the page and in the GPU process, whatever size it is drawn at.
//
// Each copy is made once, with Electron's nativeImage (decode, resize with
// "good" quality, JPEG, or PNG for logos, icons and PNG files to keep their
// transparency), and kept on disk in userData/art-cache, so later starts
// serve the small file straight away. Never scaled up: art no wider than the
// width asked for is served as it is (remembered with an empty marker file,
// so it isn't decoded again). Scaling runs one picture at a time, so a grid
// of new covers doesn't hold the main process for long in one go.
import { createHash } from "node:crypto";
import { mkdir, readdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { nativeImage } from "electron";
import { logged } from "../../../src/errorText";
import type { ArtKind, ArtWidth } from "../../../src/desktop/games/types";

// A scaled copy as file bytes, "original" when the art is no wider than
// `width` (or isn't a format nativeImage reads: the page decodes it itself).
export type Scale = (file: string, width: number, png: boolean) => Buffer | "original";

export const nativeScale: Scale = (file, width, png) => {
  const img = nativeImage.createFromPath(file);
  if (img.isEmpty() || img.getSize().width <= width) return "original";
  const small = img.resize({ width, quality: "good" });
  return png ? small.toPNG() : small.toJPEG(90);
};

export interface ArtThumbsOptions {
  maxBytes?: number; // the cache folder's size cap
  maxEntries?: number; // and its file count cap (markers are empty files)
  scale?: Scale;
  remove?: (dir: string) => Promise<void>; // forget(): deletes the cache folder
}

interface Entry {
  name: string; // the file in the cache folder: <hash>.jpg | .png | .orig
  bytes: number;
  used: number; // last served (ms); the file's mtime across starts
}

const MARKER = ".orig";

// Which cached file a source and width map to: the source's path, its
// modification time and size (a launcher that downloads new art gets a new
// copy) and the width.
export function thumbKey(file: string, mtimeMs: number, size: number, width: number): string {
  return createHash("sha256").update(`${file}\0${mtimeMs}\0${size}\0${width}`).digest("hex").slice(0, 32);
}

// PNG keeps transparency: logos and icons are drawn over art, and a PNG
// file may have some too. Everything else (covers, heroes, headers) is JPEG.
export const thumbIsPng = (file: string, kind: ArtKind): boolean => kind === "logo" || kind === "icon" || extname(file).toLowerCase() === ".png";

export class ArtThumbs {
  private readonly maxBytes: number;
  private readonly maxEntries: number;
  private readonly scale: Scale;
  private readonly remove: (dir: string) => Promise<void>;
  // Bumped by forget(): a copy being made when consent goes is not saved.
  private generation = 0;
  private removing: Promise<void> = Promise.resolve();
  // cache: OK — key=thumbKey(source path, mtime, size, width); invalidated=a changed source file gets a new key (the old copy ages out); bound=maxBytes and maxEntries, oldest-used evicted on every write
  private index: Map<string, Entry> | null = null;
  // cache: OK — key=the index load; invalidated=never (loaded once per app run); bound=one promise
  private loading: Promise<Map<string, Entry>> | null = null;
  // cache: OK — key=thumbKey; invalidated=deleted when that copy is written; bound=requests in flight (the pictures on screen)
  private readonly inflight = new Map<string, Promise<string>>();
  // The one-at-a-time chain the scaling runs on.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dir: string,
    opts: ArtThumbsOptions = {},
  ) {
    this.maxBytes = opts.maxBytes ?? 128 * 1024 * 1024;
    this.maxEntries = opts.maxEntries ?? 5000;
    this.scale = opts.scale ?? nativeScale;
    this.remove = opts.remove ?? ((dir) => rm(dir, { recursive: true, force: true }));
  }

  // Games consent turned off (or off at start): the copies are made from
  // the player's library, so they go with it. Never rejects: a failure is
  // logged, and the folder is deleted again at the next start without consent.
  forget(): void {
    this.generation++;
    this.index = null;
    this.loading = null;
    this.inflight.clear();
    this.removing = this.removing
      .then(() => this.remove(this.dir))
      .catch(logged("deleting the scaled game art copies after Games consent was turned off (deleted again at the next start without consent)"));
  }

  // Settles when the last forget() has run (new copies wait for it).
  forgotten(): Promise<void> {
    return this.removing;
  }

  // The file to serve for `source` shown `width` wide: the cached copy,
  // a new one, or the source itself (no wider, unreadable, or the cache
  // can't be written).
  async path(source: string, kind: ArtKind, width: ArtWidth): Promise<string> {
    let s;
    try {
      s = await stat(source);
    } catch {
      // error: NOT-WORTH — the art file went away since the scan: the source path answers 404 through net.fetch, and the tile keeps its placeholder
      return source;
    }
    const key = thumbKey(source, s.mtimeMs, s.size, width);
    await this.removing;
    const index = await this.load();
    const hit = index.get(key);
    if (hit) {
      hit.used = Date.now();
      const now = new Date(hit.used);
      void utimes(join(this.dir, hit.name), now, now).catch(logged("marking a cached game art copy as used (only its eviction order)"));
      return hit.name.endsWith(MARKER) ? source : join(this.dir, hit.name);
    }
    const running = this.inflight.get(key);
    if (running) return running;
    const made = this.make(source, kind, width, key).finally(() => this.inflight.delete(key));
    this.inflight.set(key, made);
    return made;
  }

  private make(source: string, kind: ArtKind, width: number, key: string): Promise<string> {
    const generation = this.generation;
    const job = this.queue.then(async () => {
      // A turn of the event loop between pictures: IPC and input go first.
      await new Promise<void>((r) => setImmediate(r));
      let out: Buffer | "original";
      try {
        out = this.scale(source, width, thumbIsPng(source, kind));
      } catch (cause) {
        // error: LOGGED-OK — the page gets the full-size file instead (more memory, same picture)
        logged("scaling game art down (the full-size file is served)")(cause);
        return source;
      }
      if (generation !== this.generation) return source; // consent went meanwhile: nothing is kept
      const name = out === "original" ? key + MARKER : `${key}${thumbIsPng(source, kind) ? ".png" : ".jpg"}`;
      const target = join(this.dir, name);
      try {
        await mkdir(this.dir, { recursive: true });
        const tmp = `${target}.tmp`;
        await writeFile(tmp, out === "original" ? Buffer.alloc(0) : out);
        await rename(tmp, target);
      } catch (cause) {
        // error: LOGGED-OK — the copy isn't kept: the full-size file is served and the copy is made again next time
        logged("saving a scaled game art copy (the full-size file is served)")(cause);
        return source;
      }
      const index = await this.load();
      index.set(key, { name, bytes: out === "original" ? 0 : out.length, used: Date.now() });
      await this.evict(index);
      return out === "original" ? source : target;
    });
    this.queue = job.catch(logged("the game art scaling queue (the next picture still runs)"));
    return job;
  }

  // The cache folder as it is on disk (once per run): every copy with its
  // size, oldest-used first by mtime; half-written .tmp files are removed.
  private load(): Promise<Map<string, Entry>> {
    if (this.index) return Promise.resolve(this.index);
    this.loading ??= (async () => {
      const index = new Map<string, Entry>();
      let names: string[] = [];
      try {
        names = await readdir(this.dir);
      } catch {
        // error: NOT-WORTH — no cache folder yet (first run): it is made with the first copy
      }
      // loop: NOT-WORTH — once per app run, N ≤ maxEntries files
      for (const name of names) {
        const full = join(this.dir, name);
        if (name.endsWith(".tmp")) {
          await rm(full, { force: true }).catch(logged("removing a half-written game art copy (it is written again)"));
          continue;
        }
        const m = /^([0-9a-f]{32})\.(jpg|png|orig)$/.exec(name);
        if (!m) continue;
        try {
          const s = await stat(full);
          index.set(m[1], { name, bytes: s.size, used: s.mtimeMs });
        } catch {
          // error: NOT-WORTH — removed while listing: that copy is made again when asked for
        }
      }
      this.index = index;
      await this.evict(index);
      return index;
    })();
    return this.loading;
  }

  // Oldest-used copies go until the folder is under both caps.
  private async evict(index: Map<string, Entry>): Promise<void> {
    let bytes = 0;
    // loop: NOT-WORTH — on writes only, N ≤ maxEntries + 1
    for (const e of index.values()) bytes += e.bytes;
    if (bytes <= this.maxBytes && index.size <= this.maxEntries) return;
    // loop: NOT-WORTH — on writes over a cap only, N ≤ maxEntries + 1
    const oldest = [...index].sort(([, a], [, b]) => a.used - b.used);
    // loop: SERIAL-REQUIRED — stops as soon as the folder is under the caps (data dependency on the running total)
    for (const [key, e] of oldest) {
      if (bytes <= this.maxBytes && index.size <= this.maxEntries) break;
      index.delete(key);
      bytes -= e.bytes;
      await rm(join(this.dir, e.name), { force: true }).catch(logged("removing an old game art copy (it is removed again at the next start)"));
    }
  }
}
