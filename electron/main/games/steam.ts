// Steam: installs, games, compatibility-tool mapping and per-game Steam Input.
// Read side only; edits are planned in games.ts and written through backup.ts.
import { execFileSync } from "node:child_process";
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

// Windows: where Steam is installed. The registry's SteamPath (the Steam
// client writes it on every start), then the default install folders.
export function windowsSteamRoots(): string[] {
  const roots: string[] = [];
  try {
    const out = execFileSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "reg.exe"), ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 3000,
    });
    const m = /SteamPath\s+REG_SZ\s+(.+)/.exec(out);
    if (m) roots.push(m[1].trim().replace(/\//g, "\\"));
  } catch {
    // error: NOT-WORTH — no Steam in the registry
  }
  // loop: NOT-WORTH — N = 2 Program Files folders, Windows only, once per scan
  for (const pf of [process.env["ProgramFiles(x86)"], process.env.ProgramFiles]) if (pf) roots.push(join(pf, "Steam"));
  return roots;
}

export function findSteamInstalls(home: string, platform: NodeJS.Platform = process.platform, winRoots: () => string[] = windowsSteamRoots): SteamInstall[] {
  const candidates: Array<[string, boolean]> =
    platform === "win32"
      ? // loop: NOT-WORTH — Steam roots on Windows
        winRoots().map((r) => [r, false])
      : [
          [join(home, ".local/share/Steam"), false],
          [join(home, ".steam/root"), false],
          [join(home, ".steam/steam"), false],
          [join(home, ".steam/debian-installation"), false],
          [join(home, ".var/app/com.valvesoftware.Steam/.local/share/Steam"), true],
          [join(home, "snap/steam/common/.steam/root"), false],
        ];
  const seen = new Set<string>();
  const out: SteamInstall[] = [];
  // loop: NOT-WORTH — six possible Steam folders, a realpath each
  for (const [path, flatpak] of candidates) {
    let root: string;
    try {
      root = realpathSync(path);
    } catch {
      // error: NOT-WORTH — a candidate Steam folder that isn't there
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
    // loop: NOT-WORTH — Steam accounts on this PC, a stat each
    for (const id of readdirSync(userdata)) {
      const p = join(userdata, id, "config/localconfig.vdf");
      try {
        const m = statSync(p).mtimeMs;
        if (!best || m > best.mtime) best = { path: p, mtime: m };
      } catch {
        // error: NOT-WORTH — no localconfig for this account
      }
    }
  } catch {
    // error: NOT-WORTH — no userdata folder: no localconfig, so the launch options read as empty
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
  // loop: NOT-WORTH — Steam library folders
  for (const [, entry] of getNode(lf ?? [], "libraryfolders") ?? []) {
    const path = typeof entry === "string" ? undefined : getString(entry, "path");
    if (path) libraries.add(path);
  }
  return [...libraries];
}

// Every installed app's manifest (appmanifest_<id>.acf) in every library,
// with the library's steamapps folder. Shared by the game list and details.
export function steamAppManifests(install: SteamInstall): Array<{ steamapps: string; acf: VdfNode }> {
  const out: Array<{ steamapps: string; acf: VdfNode }> = [];
  // loop: NOT-WORTH — Steam library folders, a readdir each
  for (const lib of steamLibraries(install)) {
    const steamapps = join(lib, "steamapps");
    let files: string[];
    try {
      // loop: HOT-PATH-OK — names in one steamapps folder, one regex test each
      files = readdirSync(steamapps).filter((f) => /^appmanifest_\d+\.acf$/.test(f));
    } catch {
      // error: NOT-WORTH — a library folder without steamapps: no games there
      continue;
    }
    // loop: PARALLELIZE — one sync read + VDF parse per appmanifest blocks the main process
    for (const f of files) {
      const acf = readVdfFile(join(steamapps, f));
      if (acf) out.push({ steamapps, acf });
    }
  }
  return out;
}

export function listSteamGames(install: SteamInstall): SteamGame[] {
  const games = new Map<string, SteamGame>();
  // loop: HOT-PATH-OK — parsed manifests, two getString each
  for (const { acf } of steamAppManifests(install)) {
    const appid = getString(acf, "AppState", "appid");
    const name = getString(acf, "AppState", "name");
    if (!appid || !name || TOOL_APPIDS.has(appid) || TOOL_NAME.test(name)) continue;
    games.set(appid, { appid, name });
  }
  // loop: HOT-PATH-OK — one sort of the Steam games by name
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
  // loop: NOT-WORTH — library folders, a readdir each
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
