// Game art at the width it is shown (src/desktop/games/types.ts artUrl,
// electron/main/games/artThumbs.ts): the size a place asks for, and the
// scaled copies cached on disk (key, never scaling up, the caps).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ART_SHOWN, ART_WIDTHS, artUrl, artWidth } from "../../src/desktop/games/types";

vi.mock("electron", () => ({ nativeImage: { createFromPath: () => ({ isEmpty: () => true }) } }));
const { ArtThumbs, thumbIsPng, thumbKey } = await import("../../electron/main/games/artThumbs");

describe("the art width a place asks for", () => {
  it("rounds the shown width times the pixel ratio up to an allowed width", () => {
    expect(artWidth(20, 1)).toBe(64);
    expect(artWidth(256, 1)).toBe(256);
    expect(artWidth(256, 1.25)).toBe(320);
    expect(artWidth(256, 1.5)).toBe(384);
    expect(artWidth(256, 2)).toBe(512);
    expect(artWidth(360, 2)).toBe(768);
    expect(artWidth(1920, 1)).toBe(1920);
    expect(artWidth(2560, 2)).toBeNull(); // wider than the largest: the file as it is
    expect(artWidth(100, 0)).toBe(128); // no ratio: 1
  });

  it("puts the width in the URL, or none for the file as it is", () => {
    expect(artUrl("k", "cover", 256, 2)).toBe("ds5-art://art/k/cover?w=512");
    expect(artUrl("k", "cover")).toBe("ds5-art://art/k/cover");
    expect(artUrl("k", "hero", 4000, 1)).toBe("ds5-art://art/k/hero");
  });

  it("asks for no less than each place shows (no blur up to 2x)", () => {
    for (const ratio of [1, 1.25, 1.5, 2]) {
      expect(artWidth(ART_SHOWN.tile(), ratio)! >= 248 * ratio).toBe(true); // a grid tile, at most 2 x 124 px
      expect(artWidth(ART_SHOWN.rowIcon(), ratio)! >= 20 * ratio).toBe(true);
      expect(artWidth(ART_SHOWN.logo(), ratio)! >= 360 * ratio).toBe(true);
    }
    expect(ART_SHOWN.wide()).toBeGreaterThan(0);
    expect([...ART_WIDTHS]).toEqual([...ART_WIDTHS].sort((a, b) => a - b));
  });
});

describe("scaled art copies (artThumbs)", () => {
  let dir: string;
  let cache: string;
  let src: string;
  let calls: Array<{ file: string; width: number; png: boolean }>;
  // A fake scaler: a source named "small*" is no wider than any width asked.
  const scale = (file: string, width: number, png: boolean): Buffer | "original" => {
    calls.push({ file, width, png });
    return file.includes("small") ? "original" : Buffer.alloc(width, 1);
  };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "art-thumbs-"));
    cache = join(dir, "art-cache");
    src = join(dir, "cover.jpg");
    writeFileSync(src, "jpeg");
    calls = [];
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("keys a copy by the source path, its mtime and size, and the width", () => {
    const k = thumbKey("/a.jpg", 1, 2, 256);
    expect(k).toMatch(/^[0-9a-f]{32}$/);
    expect(thumbKey("/a.jpg", 1, 2, 256)).toBe(k);
    for (const other of [thumbKey("/b.jpg", 1, 2, 256), thumbKey("/a.jpg", 9, 2, 256), thumbKey("/a.jpg", 1, 3, 256), thumbKey("/a.jpg", 1, 2, 512)]) expect(other).not.toBe(k);
  });

  it("keeps transparency for logos, icons and PNG files", () => {
    expect(thumbIsPng("/a/logo.png", "logo")).toBe(true);
    expect(thumbIsPng("/a/1.jpg", "icon")).toBe(true);
    expect(thumbIsPng("/a/cover.PNG", "cover")).toBe(true);
    expect(thumbIsPng("/a/hero.jpg", "hero")).toBe(false);
  });

  it("scales once, then serves the copy from disk (also after a restart)", async () => {
    const thumbs = new ArtThumbs(cache, { scale });
    const first = await thumbs.path(src, "cover", 256);
    expect(first.startsWith(cache)).toBe(true);
    expect(first.endsWith(".jpg")).toBe(true);
    expect(await thumbs.path(src, "cover", 256)).toBe(first);
    expect(calls).toHaveLength(1);
    const again = new ArtThumbs(cache, { scale });
    expect(await again.path(src, "cover", 256)).toBe(first);
    expect(calls).toHaveLength(1);
  });

  it("makes one copy for requests that arrive together", async () => {
    const thumbs = new ArtThumbs(cache, { scale });
    const all = await Promise.all([1, 2, 3].map(() => thumbs.path(src, "cover", 256)));
    expect(new Set(all).size).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("makes a new copy when the launcher replaces the art", async () => {
    const thumbs = new ArtThumbs(cache, { scale });
    const first = await thumbs.path(src, "cover", 256);
    writeFileSync(src, "a newer, larger jpeg");
    const second = await thumbs.path(src, "cover", 256);
    expect(second).not.toBe(first);
    expect(calls).toHaveLength(2);
  });

  it("never scales up: art no wider is served as it is, and not decoded again", async () => {
    const small = join(dir, "small.png");
    writeFileSync(small, "png");
    const thumbs = new ArtThumbs(cache, { scale });
    expect(await thumbs.path(small, "logo", 512)).toBe(small);
    expect(await new ArtThumbs(cache, { scale }).path(small, "logo", 512)).toBe(small);
    expect(calls).toEqual([{ file: small, width: 512, png: true }]);
  });

  it("serves the full-size file when scaling fails or the source is gone", async () => {
    const thumbs = new ArtThumbs(cache, {
      scale: () => {
        throw new Error("decode failed");
      },
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await thumbs.path(src, "cover", 256)).toBe(src);
    const gone = join(dir, "gone.jpg");
    expect(await thumbs.path(gone, "cover", 256)).toBe(gone);
    vi.restoreAllMocks();
  });

  it("evicts the oldest-used copies beyond the size cap", async () => {
    const thumbs = new ArtThumbs(cache, { scale, maxBytes: 1000 });
    const a = await thumbs.path(src, "cover", 384); // 384 bytes
    const b = await thumbs.path(src, "cover", 512); // 896 in all
    await new Promise((r) => setTimeout(r, 5));
    await thumbs.path(src, "cover", 384); // a used again: b is now the oldest
    const c = await thumbs.path(src, "cover", 256); // 1152 > 1000: b goes
    expect(existsSync(a)).toBe(true);
    expect(existsSync(b)).toBe(false);
    expect(existsSync(c)).toBe(true);
  });

  it("evicts beyond the file count cap, and cleans up at start", async () => {
    mkdirSync(cache, { recursive: true });
    writeFileSync(join(cache, `${"a".repeat(32)}.jpg.tmp`), "half");
    writeFileSync(join(cache, `${"b".repeat(32)}.jpg`), "old");
    utimesSync(join(cache, `${"b".repeat(32)}.jpg`), new Date(1000), new Date(1000));
    const thumbs = new ArtThumbs(cache, { scale, maxEntries: 2 });
    await thumbs.path(src, "cover", 64);
    await thumbs.path(src, "cover", 128);
    const files = readdirSync(cache).sort();
    expect(files).toHaveLength(2);
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
    expect(files).not.toContain(`${"b".repeat(32)}.jpg`);
  });
});
