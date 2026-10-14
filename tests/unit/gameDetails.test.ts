// The Games library's per-game details, read from launcher caches on disk
// (electron/main/games/details.ts), and the art color vote (artColor.ts).
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asLinux } from "../support/platform";

// Built on Linux launcher folders: Linux behavior on every test machine.
asLinux();

vi.mock("electron", () => ({ nativeImage: { createFromPath: () => ({ isEmpty: () => true }) } }));
const { gameDetails } = await import("../../electron/main/games/details");
const { dominantColorOf } = await import("../../electron/main/games/artColor");

let home: string;
const write = (path: string, text = "x") => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "ds5-details-")));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("game details from Steam's local files", () => {
  it("reads size, build, play time, last played, prefix and the newest art", () => {
    const steam = join(home, ".steam/debian-installation");
    write(join(steam, "config/config.vdf"), '"InstallConfigStore"\n{\n}\n');
    write(join(steam, "steamapps/libraryfolders.vdf"), `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steam}"\n\t}\n}\n`);
    write(
      join(steam, "steamapps/appmanifest_4078430.acf"),
      '"AppState"\n{\n\t"appid"\t\t"4078430"\n\t"name"\t\t"Galactic Racer"\n\t"installdir"\t\t"Galactic Racer"\n\t"SizeOnDisk"\t\t"44614397952"\n\t"LastUpdated"\t\t"1791590000"\n\t"buildid"\t\t"20462011"\n}\n',
    );
    write(
      join(steam, "userdata/1/config/localconfig.vdf"),
      '"UserLocalConfigStore"\n{\n\t"Software"\n\t{\n\t\t"Valve"\n\t\t{\n\t\t\t"Steam"\n\t\t\t{\n\t\t\t\t"apps"\n\t\t\t\t{\n\t\t\t\t\t"4078430"\n\t\t\t\t\t{\n\t\t\t\t\t\t"Playtime"\t\t"192"\n\t\t\t\t\t\t"LastPlayed"\t\t"1791700000"\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n}\n',
    );
    mkdirSync(join(steam, "steamapps/compatdata/4078430/pfx"), { recursive: true });
    // Two layouts of the same hero: the newer file wins; the logo only in the old flat layout.
    const cache = join(steam, "appcache/librarycache");
    write(join(cache, "4078430/aaaa/library_hero.jpg"));
    write(join(cache, "4078430/bbbb/library_hero.jpg"));
    utimesSync(join(cache, "4078430/aaaa/library_hero.jpg"), 1000, 1000);
    write(join(cache, "4078430_logo.png"));

    const d = [...gameDetails(home)].find(([k]) => k.endsWith(":steam:4078430"))?.[1];
    expect(d).toMatchObject({
      sizeBytes: 44614397952,
      buildId: "20462011",
      lastUpdated: 1791590000,
      playtimeMin: 192,
      lastPlayed: 1791700000,
      installDir: join(steam, "steamapps/common/Galactic Racer"),
      prefixDir: join(steam, "steamapps/compatdata/4078430/pfx"),
    });
    expect(d!.artPaths.hero).toBe(join(cache, "4078430/bbbb/library_hero.jpg"));
    expect(d!.artPaths.logo).toBe(join(cache, "4078430_logo.png"));
    expect(d!.art.sort()).toEqual(["hero", "logo"]);
  });

  it("finds nothing (and doesn't throw) without launchers", () => {
    expect(gameDetails(home).size).toBe(0);
  });
});

describe("game details from Heroic's local files", () => {
  // Heroic caches each picture under the SHA-256 of its URL.
  const cacheArt = (root: string, url: string) => write(join(root, "images-cache", createHash("sha256").update(url).digest("hex")));

  it("a GOG game: the background is the hero, the wide cover the header, the square the cover", () => {
    const root = join(home, ".config/heroic");
    write(join(root, "config.json"), "{}");
    const url = (n: string) => `https://images.gog.com/${n}.jpg?namespace=gamesdb`;
    for (const n of ["bg", "wide", "square"]) cacheArt(root, url(n));
    write(join(root, "store_cache/gog_library.json"), JSON.stringify({ games: [{ app_name: "1957528513", art_background: url("bg"), art_cover: url("wide"), art_square: url("square") }] }));
    const d = [...gameDetails(home)].find(([k]) => k.endsWith(":gog:1957528513"))?.[1];
    expect(d!.artPaths.hero).toContain(createHash("sha256").update(url("bg")).digest("hex"));
    expect(d!.art.sort()).toEqual(["cover", "header", "hero"]);
  });

  it("a GOG game without hero art (no background, no wide cover): only its cover", () => {
    const root = join(home, ".config/heroic");
    write(join(root, "config.json"), "{}");
    const square = "https://images.gog.com/square.jpg?namespace=gamesdb";
    cacheArt(root, square);
    write(join(root, "store_cache/gog_library.json"), JSON.stringify({ games: [{ app_name: "1207660000", art_square: square, art_background: "" }] }));
    const d = [...gameDetails(home)].find(([k]) => k.endsWith(":gog:1207660000"))?.[1];
    expect(d!.art).toEqual(["cover"]);
  });
});

describe("game art color", () => {
  const image = (pixels: Array<[number, number, number]>) => new Uint8Array(pixels.flatMap(([r, g, b]) => [b, g, r, 255]));
  it("picks the main vivid color", () => {
    const px = image([...Array(60).fill([200, 30, 40]), ...Array(20).fill([30, 60, 200]), ...Array(20).fill([128, 128, 128])]);
    const c = dominantColorOf(px, 10, 10)!;
    expect(parseInt(c.slice(1, 3), 16)).toBeGreaterThan(150); // red wins
  });
  it("gives none for grey or dark art", () => {
    expect(dominantColorOf(image(Array(100).fill([120, 120, 120])), 10, 10)).toBeNull();
    expect(dominantColorOf(image(Array(100).fill([20, 5, 5])), 10, 10)).toBeNull();
  });
});
