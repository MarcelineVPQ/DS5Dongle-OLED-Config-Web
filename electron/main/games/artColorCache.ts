// The games' art colors (the Glass look's accents), kept across library scans:
// working one out decodes the whole image on the main process, and the art
// rarely changes, so a color is worked out again only when its game's art
// file is another one or was rewritten (its modification time). No electron
// import, so the rules are tested (tests/unit/cachePass.test.ts).
import { mtimeOf } from "./files";

export class ArtColorCache {
  // cache: OK — key=game key, checked against the art file's path + mtime on every ask; invalidated=another art file or a newer mtime (decoded again), the game gone from the library (prune after each scan); bound=games in the library
  private readonly colors = new Map<string, { file: string | undefined; mtime: number | null; color: string | null }>();

  constructor(
    private readonly decode: (file: string) => string | null,
    private readonly mtime: (file: string) => number | null = mtimeOf,
  ) {}

  // The color of `key`'s art `file` (none without art).
  get(key: string, file: string | undefined): string | null {
    const mtime = file ? this.mtime(file) : null;
    const kept = this.colors.get(key);
    if (kept && kept.file === file && kept.mtime === mtime) return kept.color;
    const color = file && mtime !== null ? this.decode(file) : null;
    this.colors.set(key, { file, mtime, color });
    return color;
  }

  // After a scan: drop the games that left the library.
  prune(keys: { has: (key: string) => boolean }): void {
    // loop: NOT-WORTH — once per scan, games in the library
    for (const key of [...this.colors.keys()]) if (!keys.has(key)) this.colors.delete(key);
  }
}
