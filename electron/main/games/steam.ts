// Steam: installs, games, compatibility-tool mapping and per-game Steam Input.
// Read side only; edits are planned in games.ts and written through backup.ts.
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { readParsed } from "./files";
import { join } from "node:path";
import { protonBuilds } from "./proton";
import { ensureNode, getNode, getString, parseVdf, setKey, type VdfNode } from "./vdf";

export interface SteamInstall {
  root: string; // realpath
  flatpak: boolean;
  configPath: string; // config/config.vdf
  localConfigPath: string | null; // newest userdata/<id>/config/localconfig.vdf
  toolsDir: string; // compatibilitytools.d
}

export interface SteamGame {
  appid: string;
  name: string;
}

// Runtimes, Proton builds and redistributables that appear as "apps".
const TOOL_APPIDS = new Set(["228980", "1070560", "1391110", "1628350", "4183110", "1493710", "2180100", "1887720", "1826330", "1580130", "2348590", "3658110"]);
const TOOL_NAME = /^(Proton\b|Steam Linux Runtime|Steamworks Common|SteamVR)/i;

// Steam's own CompatToolMapping priorities: "0" (the default) and per-game entries.
const STEAM_TOOL_PRIORITY_DEFAULT = "75";
const STEAM_TOOL_PRIORITY_GAME = "250";

export function findSteamInstalls(home: string): SteamInstall[] {
  const candidates: Array<[string, boolean]> = [
    [join(home, ".local/share/Steam"), false],
    [join(home, ".steam/root"), false],
    [join(home, ".steam/steam"), false],
    [join(home, ".steam/debian-installation"), false],
    [join(home, ".var/app/com.valvesoftware.Steam/.local/share/Steam"), true],
    [join(home, "snap/steam/common/.steam/root"), false],
  ];
  const seen = new Set<string>();
  const out: SteamInstall[] = [];
  for (const [path, flatpak] of candidates) {
    let root: string;
    try {
      root = realpathSync(path);
    } catch {
      continue;
    }
    if (seen.has(root) || !existsSync(join(root, "config/config.vdf"))) continue;
    seen.add(root);
    out.push({ root, flatpak, configPath: join(root, "config/config.vdf"), localConfigPath: newestLocalConfig(root), toolsDir: join(root, "compatibilitytools.d") });
  }
  return out;
}

function newestLocalConfig(root: string): string | null {
  const userdata = join(root, "userdata");
  let best: { path: string; mtime: number } | null = null;
  try {
    for (const id of readdirSync(userdata)) {
      const p = join(userdata, id, "config/localconfig.vdf");
      try {
        const m = statSync(p).mtimeMs;
        if (!best || m > best.mtime) best = { path: p, mtime: m };
      } catch {
        // no localconfig for this account
      }
    }
  } catch {
    return null;
  }
  return best?.path ?? null;
}

export function readVdfFile(path: string): VdfNode | null {
  return readParsed(path, parseVdf);
}

// Every Steam library folder (the install itself plus libraryfolders.vdf entries).
export function steamLibraries(install: SteamInstall): string[] {
  const lf = readVdfFile(join(install.root, "steamapps/libraryfolders.vdf")) ?? readVdfFile(join(install.root, "config/libraryfolders.vdf"));
  const libraries = new Set<string>([install.root]);
  for (const [, entry] of getNode(lf ?? [], "libraryfolders") ?? []) {
    const path = typeof entry === "string" ? undefined : getString(entry, "path");
    if (path) libraries.add(path);
  }
  return [...libraries];
}

export function listSteamGames(install: SteamInstall): SteamGame[] {
  const libraries = steamLibraries(install);
  const games = new Map<string, SteamGame>();
  for (const lib of libraries) {
    const steamapps = join(lib, "steamapps");
    let files: string[];
    try {
      files = readdirSync(steamapps).filter((f) => /^appmanifest_\d+\.acf$/.test(f));
    } catch {
      continue;
    }
    for (const f of files) {
      const acf = readVdfFile(join(steamapps, f));
      const appid = getString(acf ?? [], "AppState", "appid");
      const name = getString(acf ?? [], "AppState", "name");
      if (!appid || !name || TOOL_APPIDS.has(appid) || TOOL_NAME.test(name)) continue;
      games.set(appid, { appid, name });
    }
  }
  return [...games.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function compatMapping(config: VdfNode | null): VdfNode | undefined {
  return getNode(config ?? [], "InstallConfigStore", "Software", "Valve", "Steam", "CompatToolMapping");
}

// Per-game Steam Input: localconfig.vdf top-level apps.<appid>.UseSteamControllerConfig
// (0 = forced off, 1 or absent = follow the global setting, 2 = forced on).
export function steamInputState(localConfig: VdfNode | null, appid: string): "off" | "global" | "on" {
  const v = getString(localConfig ?? [], "UserLocalConfigStore", "apps", appid, "UseSteamControllerConfig");
  return v === "0" ? "off" : v === "2" ? "on" : "global";
}

export function launchOptions(localConfig: VdfNode | null, appid: string): string {
  return getString(localConfig ?? [], "UserLocalConfigStore", "Software", "Valve", "Steam", "apps", appid, "LaunchOptions") ?? "";
}

// Compatibility tools in compatibilitytools.d.
export function installedTools(install: SteamInstall): string[] {
  return protonBuilds(install.toolsDir);
}

// Valve's own Proton builds (steamapps/common/<name>/proton) in every library.
export function valveProtons(install: SteamInstall): string[] {
  return steamLibraries(install).flatMap((lib) => protonBuilds(join(lib, "steamapps/common")).filter((n) => /^Proton\b/.test(n)));
}

// Point CompatToolMapping[key] ("0" = the default for all Windows games, or an
// app id) at `tool`, creating the entry with Steam's own priorities if needed.
export function setCompatTool(config: VdfNode, key: string, tool: string): void {
  const entry = ensureNode(config, "InstallConfigStore", "Software", "Valve", "Steam", "CompatToolMapping", key);
  setKey(entry, "name", tool);
  if (getString(entry, "config") === undefined) setKey(entry, "config", "");
  if (getString(entry, "priority") === undefined) setKey(entry, "priority", key === "0" ? STEAM_TOOL_PRIORITY_DEFAULT : STEAM_TOOL_PRIORITY_GAME);
}
