// Heroic Games Launcher (Epic via legendary, GOG, Amazon via nile, sideloaded):
// installs, games and their Wine/Proton settings. Read side only.
import { existsSync, readdirSync } from "node:fs";
import { arr, obj, readJson } from "./files";
import { join } from "node:path";
import type { Store } from "../../../src/desktop/games/types";
import { protonBuilds } from "./proton";

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
  // Heroic's own per-game switches (Settings → Other: "Enable Wine-Wayland",
  // "Enable HDR"): for a Proton runner Heroic sets PROTON_ENABLE_WAYLAND=1
  // and, with both on, PROTON_ENABLE_HDR=1 when it starts the game. The
  // old HDR fix turned them on; the gamescope one turns them off again.
  wineWayland: boolean;
  hdr: boolean;
  // Heroic's per-game gamescope settings (Settings → Gamescope; 2.14+ has
  // additionalOptions); Heroic only starts gamescope with enableUpscaling or enableLimiter on.
  gamescope: Record<string, unknown> | null;
  // Settings → Game Arguments ("launcherArgs", split like a shell line).
  args: string;
}

export function findHeroicInstalls(home: string): HeroicInstall[] {
  const out: HeroicInstall[] = [];
  // loop: NOT-WORTH — two possible Heroic folders
  for (const [root, flatpak] of [
    [join(home, ".config/heroic"), false],
    [join(home, ".var/app/com.heroicgameslauncher.hgl/config/heroic"), true],
  ] as Array<[string, boolean]>) {
    if (existsSync(join(root, "config.json"))) out.push({ root, flatpak, configPath: join(root, "config.json"), toolsDir: join(root, "tools/proton") });
  }
  return out;
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
  // loop: HOT-PATH-OK — installed Epic games, in memory after one JSON read
  for (const [appName, entry] of Object.entries(obj(readJson(join(install.root, "legendaryConfig/legendary/installed.json"))))) {
    const e = obj(entry);
    if (e.platform === "Windows") found.push({ appName, title: String(e.title ?? appName), store: "epic" });
  }

  // GOG: installed list; titles from the library cache.
  const gogTitles = new Map<string, string>();
  // loop: HOT-PATH-OK — GOG library cache entries, in memory
  for (const g of arr(obj(readJson(join(install.root, "store_cache/gog_library.json"))).games)) {
    const e = obj(g);
    if (typeof e.app_name === "string" && typeof e.title === "string") gogTitles.set(e.app_name, e.title);
  }
  // loop: HOT-PATH-OK — installed GOG games, in memory
  for (const g of arr(obj(readJson(join(install.root, "gog_store/installed.json"))).installed)) {
    const e = obj(g);
    if (typeof e.appName === "string" && e.platform === "windows") found.push({ appName: e.appName, title: gogTitles.get(e.appName) ?? e.appName, store: "gog" });
  }

  // Amazon (nile): installed ids from nile's own list and Heroic's install-info
  // cache (an object keyed by id, or an array); titles from the library cache.
  const nileInstalled = new Set<string>([
    // loop: HOT-PATH-OK — installed Amazon ids, in memory
    ...arr(readJson(join(install.root, "nile_config/nile/installed.json"))).map((x) => String(obj(x).id ?? "")),
    ...Object.keys(obj(readJson(join(install.root, "store_cache/nile_install_info.json")))),
    // loop: HOT-PATH-OK — installed Amazon ids, in memory
    ...arr(readJson(join(install.root, "store_cache/nile_install_info.json"))).map((x) => String(obj(x).id ?? "")),
  ]);
  nileInstalled.delete("");
  const nileLib = readJson(join(install.root, "store_cache/nile_library.json"));
  const nileTitles = new Map<string, string>();
  // loop: HOT-PATH-OK — Amazon library entries, in memory
  for (const g of [...arr(nileLib), ...arr(obj(nileLib).library)]) {
    const e = obj(g);
    const id = String(e.app_name ?? e.id ?? "");
    if (id) nileTitles.set(id, String(e.title ?? obj(e.product).title ?? id));
  }
  // loop: HOT-PATH-OK — installed Amazon ids, Map lookups
  for (const id of nileInstalled) found.push({ appName: id, title: nileTitles.get(id) ?? id, store: "amazon" });

  // Sideloaded Windows apps.
  // loop: HOT-PATH-OK — sideloaded apps, in memory
  for (const g of arr(obj(readJson(join(install.root, "sideload_apps/library.json"))).games)) {
    const e = obj(g);
    const platform = obj(e.install).platform;
    if (typeof e.app_name === "string" && e.is_installed !== false && (platform === "windows" || platform === "Windows"))
      found.push({ appName: e.app_name, title: String(e.title ?? e.app_name), store: "sideload" });
  }

  // loop: PARALLELIZE — one sync GamesConfig JSON read per game blocks the main process
  return found
    .filter(({ appName }) => /^[\w.-]+$/.test(appName)) // used as a file name below
    .map(({ appName, title, store }) => {
      const configPath = join(install.root, "GamesConfig", `${appName}.json`);
      const cfg = obj(obj(readJson(configPath))[appName]);
      const env = Array.isArray(cfg.enviromentOptions) // sic: Heroic's own spelling
        ? // loop: HOT-PATH-OK — env entries of one game
          (cfg.enviromentOptions as unknown[]).map((x) => ({ key: String(obj(x).key ?? ""), value: String(obj(x).value ?? "") })).filter((x) => x.key)
        : [];
      return {
        appName,
        title,
        store,
        configPath,
        wineVersion: wine(cfg.wineVersion),
        env,
        wineWayland: cfg.enableWineWayland === true,
        hdr: cfg.enableHDR === true,
        gamescope: cfg.gamescope && typeof cfg.gamescope === "object" ? obj(cfg.gamescope) : null,
        args: typeof cfg.launcherArgs === "string" ? cfg.launcherArgs : "",
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function heroicTools(install: HeroicInstall): string[] {
  return protonBuilds(install.toolsDir);
}

// Every Wine/Proton build Heroic can run a game with (the game page's picker),
// as Heroic stores it in wineVersion: its own Proton builds (tools/proton),
// its own Wine builds (tools/wine), and for the native Heroic also Steam's
// (`steam`: compatibilitytools.d and Valve's Protons; the Flatpak can't see
// them). The first build of a name wins.
export function heroicBuilds(install: HeroicInstall, steam: WineVersion[]): WineVersion[] {
  // cache: NOT-WORTH — key=build name; invalidated=built anew on every call (one scan); bound=one launcher's builds (≤ ~30)
  const out = new Map<string, WineVersion>();
  const add = (w: WineVersion) => !out.has(w.name) && out.set(w.name, w);
  const wineDir = join(install.root, "tools/wine");
  // loop: NOT-WORTH — builds in Heroic's Proton folder, once per scan
  for (const name of heroicTools(install)) add({ bin: join(install.toolsDir, name, "proton"), name, type: "proton" });
  let wines: string[] = [];
  try {
    // loop: NOT-WORTH — folders in Heroic's Wine folder, a stat each; once per scan
    wines = readdirSync(wineDir).filter((d) => existsSync(join(wineDir, d, "bin/wine")));
  } catch {
    // error: NOT-WORTH — no tools/wine folder: no Wine builds from Heroic
  }
  // loop: NOT-WORTH — Wine builds, once per scan
  for (const name of wines) add({ bin: join(wineDir, name, "bin/wine"), name, type: "wine" });
  // loop: NOT-WORTH — Steam's builds (≤ ~20), once per scan
  if (!install.flatpak) for (const w of steam) add(w);
  return [...out.values()];
}
