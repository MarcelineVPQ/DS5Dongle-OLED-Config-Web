// Heroic Games Launcher (Epic via legendary, GOG, Amazon via nile, sideloaded):
// installs, games and their Wine/Proton settings. Read side only.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "../../../src/desktop/games/types";

export interface HeroicInstall {
  root: string; // ~/.config/heroic or the Flatpak equivalent
  flatpak: boolean;
  configPath: string;
  toolsDir: string; // tools/proton
}

export interface WineVersion {
  bin: string;
  name: string;
  type: string;
  [extra: string]: unknown;
}

export interface HeroicGame {
  appName: string;
  title: string;
  store: Store;
  configPath: string; // GamesConfig/<appName>.json (may not exist yet)
  wineVersion: WineVersion | null; // per-game override, null = global default
  env: Array<{ key: string; value: string }>;
}

export function findHeroicInstalls(home: string): HeroicInstall[] {
  const out: HeroicInstall[] = [];
  for (const [root, flatpak] of [
    [join(home, ".config/heroic"), false],
    [join(home, ".var/app/com.heroicgameslauncher.hgl/config/heroic"), true],
  ] as Array<[string, boolean]>) {
    if (existsSync(join(root, "config.json"))) out.push({ root, flatpak, configPath: join(root, "config.json"), toolsDir: join(root, "tools/proton") });
  }
  return out;
}

export function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function wine(v: unknown): WineVersion | null {
  const w = obj(v);
  return typeof w.bin === "string" && typeof w.name === "string" ? (w as WineVersion) : null;
}

export function heroicDefaultWine(install: HeroicInstall): WineVersion | null {
  return wine(obj(obj(readJson(install.configPath)).defaultSettings).wineVersion);
}

export function listHeroicGames(install: HeroicInstall): HeroicGame[] {
  const found: Array<{ appName: string; title: string; store: Store }> = [];

  // Epic (legendary): dict keyed by app name.
  for (const [appName, entry] of Object.entries(obj(readJson(join(install.root, "legendaryConfig/legendary/installed.json"))))) {
    const e = obj(entry);
    if (e.platform === "Windows") found.push({ appName, title: String(e.title ?? appName), store: "epic" });
  }

  // GOG: installed list; titles from the library cache.
  const gogTitles = new Map<string, string>();
  for (const g of arr(obj(readJson(join(install.root, "store_cache/gog_library.json"))).games)) {
    const e = obj(g);
    if (typeof e.app_name === "string" && typeof e.title === "string") gogTitles.set(e.app_name, e.title);
  }
  for (const g of arr(obj(readJson(join(install.root, "gog_store/installed.json"))).installed)) {
    const e = obj(g);
    if (typeof e.appName === "string" && e.platform === "windows") found.push({ appName: e.appName, title: gogTitles.get(e.appName) ?? e.appName, store: "gog" });
  }

  // Amazon (nile): installed ids from nile's own list and Heroic's install-info
  // cache (an object keyed by id, or an array); titles from the library cache.
  const nileInstalled = new Set<string>([
    ...arr(readJson(join(install.root, "nile_config/nile/installed.json"))).map((x) => String(obj(x).id ?? "")),
    ...Object.keys(obj(readJson(join(install.root, "store_cache/nile_install_info.json")))),
    ...arr(readJson(join(install.root, "store_cache/nile_install_info.json"))).map((x) => String(obj(x).id ?? "")),
  ]);
  nileInstalled.delete("");
  const nileLib = readJson(join(install.root, "store_cache/nile_library.json"));
  const nileTitles = new Map<string, string>();
  for (const g of [...arr(nileLib), ...arr(obj(nileLib).library)]) {
    const e = obj(g);
    const id = String(e.app_name ?? e.id ?? "");
    if (id) nileTitles.set(id, String(e.title ?? obj(e.product).title ?? id));
  }
  for (const id of nileInstalled) found.push({ appName: id, title: nileTitles.get(id) ?? id, store: "amazon" });

  // Sideloaded Windows apps.
  for (const g of arr(obj(readJson(join(install.root, "sideload_apps/library.json"))).games)) {
    const e = obj(g);
    const platform = obj(e.install).platform;
    if (typeof e.app_name === "string" && e.is_installed !== false && (platform === "windows" || platform === "Windows"))
      found.push({ appName: e.app_name, title: String(e.title ?? e.app_name), store: "sideload" });
  }

  return found
    .map(({ appName, title, store }) => {
      const configPath = join(install.root, "GamesConfig", `${appName}.json`);
      const cfg = obj(obj(readJson(configPath))[appName]);
      const env = Array.isArray(cfg.enviromentOptions) // sic: Heroic's own spelling
        ? (cfg.enviromentOptions as unknown[]).map((x) => ({ key: String(obj(x).key ?? ""), value: String(obj(x).value ?? "") })).filter((x) => x.key)
        : [];
      return { appName, title, store, configPath, wineVersion: wine(cfg.wineVersion), env };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function heroicTools(install: HeroicInstall): string[] {
  try {
    return readdirSync(install.toolsDir).filter((d) => existsSync(join(install.toolsDir, d, "proton")));
  } catch {
    return [];
  }
}
