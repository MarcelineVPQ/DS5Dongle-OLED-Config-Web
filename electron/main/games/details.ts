// Per-game details for the Games library: install folder, size, play time,
// last played and local artwork, all from what the launchers already keep on
// disk (no network): Steam's appcache/librarycache + localconfig.vdf, Heroic's
// images-cache (files named by the sha256 of the art URL) + store caches +
// timestamp.json, Lutris's coverart/banners/icons + pga.db.
//
// Art paths stay in the main process: the page only learns which kinds exist
// and loads them through the ds5-art:// protocol by game key (art.ts).
import { createHash } from "node:crypto";
import { storeKey, type StoreGame } from "./windowsStores";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { arr, obj, readJson } from "./files";
import { findHeroicInstalls, type HeroicInstall } from "./heroic";
import { findLutrisInstalls, type LutrisInstall } from "./lutris";
import { findSteamInstalls, readVdfFile, steamAppManifests, type SteamInstall } from "./steam";
import { getString } from "./vdf";
import { idHash } from "./games";
import type { ArtKind, GameInfo } from "../../../src/desktop/games/types";

export interface GameDetails extends GameInfo {
  artPaths: Partial<Record<ArtKind, string>>;
  // Main-process only (never sent to the page): for the folder and launch actions.
  prefixDir?: string; // the game's Wine/Proton prefix
  lutrisSlug?: string;
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const existing = (p: string | undefined): string | undefined => (p && existsSync(p) ? p : undefined);

function info(d: Partial<GameDetails>): GameDetails {
  const artPaths = Object.fromEntries(Object.entries(d.artPaths ?? {}).filter(([, p]) => p)) as Partial<Record<ArtKind, string>>;
  return {
    installDir: d.installDir,
    sizeBytes: d.sizeBytes,
    playtimeMin: d.playtimeMin,
    lastPlayed: d.lastPlayed,
    lastUpdated: d.lastUpdated,
    buildId: d.buildId,
    art: Object.keys(artPaths) as ArtKind[],
    artPaths,
    prefixDir: d.prefixDir,
    lutrisSlug: d.lutrisSlug,
  };
}

// ---- Steam ----
function steamDetails(install: SteamInstall, out: Map<string, GameDetails>): void {
  const prefix = `steam-${idHash(install.root)}`;
  const local = install.localConfigPath ? readVdfFile(install.localConfigPath) : null;
  const cache = join(install.root, "appcache", "librarycache");
  for (const { steamapps, acf } of steamAppManifests(install)) {
    const appid = getString(acf, "AppState", "appid");
    if (!appid) continue;
    const dir = getString(acf, "AppState", "installdir");
    const apps = ["UserLocalConfigStore", "Software", "Valve", "Steam", "apps", appid] as const;
    out.set(
      `${prefix}:steam:${appid}`,
      info({
        installDir: dir ? join(steamapps, "common", dir) : undefined,
        sizeBytes: num(getString(acf, "AppState", "SizeOnDisk")),
        lastUpdated: num(getString(acf, "AppState", "LastUpdated")),
        buildId: getString(acf, "AppState", "buildid") ?? undefined,
        playtimeMin: num(getString(local ?? [], ...apps, "Playtime")),
        lastPlayed: num(getString(local ?? [], ...apps, "LastPlayed")),
        artPaths: steamArt(cache, appid),
        prefixDir: existing(join(steamapps, "compatdata", appid, "pfx")),
      }),
    );
  }
}

// Steam's librarycache, three layouts: <appid>/<hash>/<name> (newest Steam:
// one hashed folder per image), <appid>/<name>, and <appid>_<name> (older).
// The newest file wins when an image was replaced.
const STEAM_NAMES: Record<ArtKind, string[]> = {
  hero: ["library_hero.jpg"],
  logo: ["logo.png"],
  cover: ["library_600x900.jpg", "library_capsule.jpg"],
  header: ["library_header.jpg", "header.jpg"],
  icon: [],
};
function steamArt(cache: string, appid: string): Partial<Record<ArtKind, string>> {
  const dir = join(cache, appid);
  // cache: OK — key=art file name; invalidated=per call (one game's art folder); bound=files in one game's librarycache folder
  const found = new Map<string, { path: string; mtime: number }>();
  const note = (name: string, path: string) => {
    let mtime: number;
    try {
      mtime = statSync(path).mtimeMs;
    } catch {
      // error: NOT-WORTH — the file went away between listing and stat: that art is skipped
      return;
    }
    const prev = found.get(name);
    if (!prev || mtime > prev.mtime) found.set(name, { path, mtime });
  };
  let icon: string | undefined;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        // loop: HOT-PATH-OK — one art folder's subfolders, a few files each
        for (const name of readdirSync(full)) note(name, join(full, name));
      } else if (/^[0-9a-f]{40}\.jpg$/.test(entry.name)) icon = full;
      else note(entry.name, full);
    }
  } catch {
    // error: NOT-WORTH — no per-app folder
  }
  const pick = (kind: ArtKind) => {
    for (const name of STEAM_NAMES[kind]) {
      const hit = found.get(name)?.path ?? existing(join(cache, `${appid}_${name}`));
      if (hit) return hit;
    }
    return undefined;
  };
  return { hero: pick("hero"), logo: pick("logo"), cover: pick("cover"), header: pick("header"), icon: icon ?? existing(join(cache, `${appid}_icon.jpg`)) };
}

// ---- Heroic ----
function heroicDetails(install: HeroicInstall, out: Map<string, GameDetails>): void {
  const prefix = `heroic-${idHash(install.root)}`;
  const images = join(install.root, "images-cache");
  const cached = (url: unknown): string | undefined => (typeof url === "string" && url.startsWith("http") ? existing(join(images, createHash("sha256").update(url).digest("hex"))) : undefined);
  const played = obj(readJson(join(install.root, "store", "timestamp.json")));
  const installDirs = new Map<string, string>();
  for (const [name, e] of Object.entries(obj(readJson(join(install.root, "legendaryConfig/legendary/installed.json"))))) {
    const p = obj(e).install_path;
    if (typeof p === "string") installDirs.set(name, p);
  }
  for (const g of arr(obj(readJson(join(install.root, "gog_store/installed.json"))).installed)) {
    const e = obj(g);
    if (typeof e.appName === "string" && typeof e.install_path === "string") installDirs.set(e.appName, e.install_path);
  }
  const libraries: Array<[string, unknown[]]> = [
    ["epic", arr(obj(readJson(join(install.root, "store_cache/legendary_library.json"))).library)],
    ["gog", arr(obj(readJson(join(install.root, "store_cache/gog_library.json"))).games)],
    ["amazon", [...arr(obj(readJson(join(install.root, "store_cache/nile_library.json"))).library), ...arr(readJson(join(install.root, "store_cache/nile_library.json")))]],
    ["sideload", arr(obj(readJson(join(install.root, "sideload_apps/library.json"))).games)],
  ];
  for (const [store, games] of libraries) {
    // loop: HOT-PATH-OK — library entries per store, Map lookups only
    for (const g of games) {
      const e = obj(g);
      const appName = typeof e.app_name === "string" ? e.app_name : undefined;
      if (!appName) continue;
      const t = obj(played[appName]);
      const last = typeof t.lastPlayed === "string" ? Date.parse(t.lastPlayed) / 1000 : undefined;
      const installPath = typeof obj(e.install).install_path === "string" ? (obj(e.install).install_path as string) : undefined;
      out.set(
        `${prefix}:${store}:${appName}`,
        info({
          installDir: installDirs.get(appName) ?? installPath,
          playtimeMin: num(t.totalPlayed),
          lastPlayed: last && Number.isFinite(last) ? last : undefined,
          prefixDir: heroicPrefix(install.root, appName),
          artPaths: {
            hero: cached(e.art_background) ?? cached(e.art_cover),
            cover: cached(e.art_square),
            logo: cached(e.art_logo),
            icon: cached(e.art_icon),
            header: cached(e.art_cover),
          },
        }),
      );
    }
  }
}

// A Heroic game's own Wine prefix (GamesConfig/<appName>.json), if it has one.
function heroicPrefix(root: string, appName: string): string | undefined {
  const cfg = obj(obj(readJson(join(root, "GamesConfig", `${appName}.json`)))[appName]);
  return typeof cfg.winePrefix === "string" ? existing(cfg.winePrefix) : undefined;
}

// ---- Lutris ----
interface LutrisRow {
  slug: string;
  configpath: string | null;
  directory: string | null;
  playtime: number | null; // hours
  lastplayed: number | null;
}
function lutrisDetails(install: LutrisInstall, home: string, out: Map<string, GameDetails>): void {
  const prefix = `lutris-${idHash(install.dataDir)}`;
  let rows: LutrisRow[];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const db = new DatabaseSync(join(install.dataDir, "pga.db"), { readOnly: true });
    try {
      rows = db.prepare("SELECT slug, configpath, directory, playtime, lastplayed FROM games WHERE installed = 1").all() as unknown as LutrisRow[];
    } finally {
      db.close();
    }
  } catch {
    // error: NOT-WORTH — no readable Lutris database: no Lutris art or play time (the tile keeps its placeholder)
    return;
  }
  const icons = join(home, ".local/share/icons/hicolor/128x128/apps");
  for (const r of rows) {
    if (!r.configpath) continue;
    const art = (dir: string) => existing(join(install.dataDir, dir, `${r.slug}.jpg`)) ?? existing(join(install.dataDir, dir, `${r.slug}.png`));
    out.set(
      `${prefix}:lutris:${r.configpath}`,
      info({
        installDir: r.directory ?? undefined,
        playtimeMin: r.playtime ? Math.round(r.playtime * 60) : undefined,
        lastPlayed: num(r.lastplayed),
        lutrisSlug: r.slug,
        artPaths: { hero: art("banners"), header: art("banners"), cover: art("coverart"), icon: existing(join(icons, `lutris_${r.slug}.png`)) },
      }),
    );
  }
}

export function gameDetails(home: string, stores: StoreGame[] = []): Map<string, GameDetails> {
  const out = new Map<string, GameDetails>();
  // GOG Galaxy / Epic on Windows: the install folder (no local art or play time).
  for (const g of stores) out.set(storeKey(g), info({ installDir: g.installDir }));
  for (const s of findSteamInstalls(home)) steamDetails(s, out);
  for (const h of findHeroicInstalls(home)) heroicDetails(h, out);
  for (const l of findLutrisInstalls(home)) lutrisDetails(l, home, out);
  return out;
}
