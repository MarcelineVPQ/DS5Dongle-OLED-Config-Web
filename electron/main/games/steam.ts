// Steam: installs, games, compatibility-tool mapping and per-game Steam Input.
// Read side only; edits are planned in games.ts and written through backup.ts.
import { execFile } from "node:child_process";
import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { filesIn, readParsed } from "./files";
import { join } from "node:path";
import { protonBuilds } from "./proton";
import { ensureNode, getNode, getString, keyIndex, parseVdf, setKey, type VdfNode, type VdfValue } from "./vdf";

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

// `reg query HKCU\Software\Valve\Steam /v SteamPath`: where the Steam client
// says it is installed (it writes it on every start), with backslashes.
export const steamPathIn = (regOutput: string): string | null => {
  const m = /SteamPath\s+REG_SZ\s+(.+)/.exec(regOutput);
  return m ? m[1].trim().replace(/\//g, "\\") : null;
};

function querySteamPath(): Promise<string | null> {
  return new Promise((resolve) =>
    // lifetime: OK — reg.exe exits on its own; the 3 s timeout kills a hung one
    // error: NOT-WORTH — no Steam in the registry (or no answer): the default install folders are still looked at
    execFile(
      join(process.env.SystemRoot ?? "C:\\Windows", "System32", "reg.exe"),
      ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"],
      { encoding: "utf8", windowsHide: true, timeout: 3000 },
      (error, stdout) => resolve(error ? null : steamPathIn(stdout)),
    ),
  );
}

// The registry's SteamPath, read in the background (reg.exe takes 50-100 ms;
// it used to run blocking on the main thread several times per scan, Play and
// Steam restart). Read once at the start of each scan and of an Undo;
// everything in between (the scan's three looks, Play, a Steam restart) reuses it.
// cache: OK — key=none (HKCU SteamPath); invalidated=read again at the start of every scan and Undo (refreshWindowsSteamPath); bound=1 string
let registrySteamPath: string | null = null;
export async function refreshWindowsSteamPath(query: () => Promise<string | null> = querySteamPath): Promise<void> {
  registrySteamPath = await query();
}

// Windows: where Steam is installed. The registry's SteamPath (as last read
// by refreshWindowsSteamPath), then the default install folders.
export function windowsSteamRoots(): string[] {
  const roots: string[] = registrySteamPath ? [registrySteamPath] : [];
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

// Every installed app's manifest file (appmanifest_<id>.acf) in every library,
// with the library's steamapps folder.
export function steamManifestFiles(install: SteamInstall): Array<{ steamapps: string; path: string }> {
  // loop: NOT-WORTH — Steam library folders, a readdir each
  return steamLibraries(install).flatMap((lib) => {
    const steamapps = join(lib, "steamapps");
    // loop: NOT-WORTH — manifest files of one library, once per scan
    return filesIn(steamapps, /^appmanifest_\d+\.acf$/).map((path) => ({ steamapps, path }));
  });
}

// Every installed app's manifest, parsed. Shared by the game list and details;
// during a scan the files were read ahead in parallel (loop pass batch 3).
export function steamAppManifests(install: SteamInstall): Array<{ steamapps: string; acf: VdfNode }> {
  const out: Array<{ steamapps: string; acf: VdfNode }> = [];
  // loop: HOT-PATH-OK — one VDF parse per appmanifest from the scan's read-ahead texts (no file read in the loop)
  for (const { steamapps, path } of steamManifestFiles(install)) {
    const acf = readVdfFile(path);
    if (acf) out.push({ steamapps, acf });
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
type SteamInputState = "off" | "global" | "on";
const inputState = (v: string | undefined): SteamInputState => (v === "0" ? "off" : v === "2" ? "on" : "global");
const INPUT_APPS = ["UserLocalConfigStore", "apps"];
const LAUNCH_APPS = ["UserLocalConfigStore", "Software", "Valve", "Steam", "apps"];

// The scan's per-game lookups (loop pass batch 3): config.vdf's
// CompatToolMapping and localconfig's two per-app nodes (thousands of apps)
// indexed once, instead of a linear search per game. Same answers as
// a getString lookup by path (appid's "name", UseSteamControllerConfig,
// LaunchOptions) in each.
export function steamAppIndex(config: VdfNode | null, localConfig: VdfNode | null) {
  const compat = keyIndex(compatMapping(config));
  const input = keyIndex(getNode(localConfig ?? [], ...INPUT_APPS));
  const launch = keyIndex(getNode(localConfig ?? [], ...LAUNCH_APPS));
  const app = (index: Map<string, VdfValue>, appid: string): VdfNode | undefined => {
    const v = index.get(appid.toLowerCase());
    return v && typeof v !== "string" ? v : undefined;
  };
  return {
    compatTool: (appid: string): string | null => getString(app(compat, appid), "name") ?? null,
    steamInput: (appid: string): SteamInputState => inputState(getString(app(input, appid), "UseSteamControllerConfig")),
    launchOptions: (appid: string): string => getString(app(launch, appid), "LaunchOptions") ?? "",
  };
}

// Compatibility tools in compatibilitytools.d.
export function installedTools(install: SteamInstall): string[] {
  return protonBuilds(install.toolsDir);
}

// Valve's own Proton builds (steamapps/common/<name>/proton) in every library.
export function valveProtons(install: SteamInstall): string[] {
  // loop: NOT-WORTH — Valve's Proton folders (≤ ~8)
  return valveProtonPaths(install).map((p) => p.name);
}

// The same, with each build's folder.
export function valveProtonPaths(install: SteamInstall): Array<{ name: string; dir: string }> {
  // loop: NOT-WORTH — library folders, a readdir each
  return steamLibraries(install).flatMap((lib) => {
    const common = join(lib, "steamapps/common");
    // loop: NOT-WORTH — Proton folders of one library
    return protonBuilds(common)
      .filter((n) => /^Proton\b/.test(n))
      .map((name) => ({ name, dir: join(common, name) }));
  });
}

// Point CompatToolMapping[key] ("0" = the default for all Windows games, or an
// app id) at `tool`, creating the entry with Steam's own priorities if needed.
export function setCompatTool(config: VdfNode, key: string, tool: string): void {
  const entry = ensureNode(config, "InstallConfigStore", "Software", "Valve", "Steam", "CompatToolMapping", key);
  setKey(entry, "name", tool);
  if (getString(entry, "config") === undefined) setKey(entry, "config", "");
  if (getString(entry, "priority") === undefined) setKey(entry, "priority", key === "0" ? STEAM_TOOL_PRIORITY_DEFAULT : STEAM_TOOL_PRIORITY_GAME);
}

// ---- The game page's Proton version picker ----
// A compatibility tool as Steam knows it: `name` goes in CompatToolMapping,
// `label` is what Steam shows.
export interface SteamTool {
  name: string;
  label: string;
}

// Valve's own builds are mapped by an internal name, not their folder:
// "Proton - Experimental" → proton_experimental, "Proton Hotfix" →
// proton_hotfix, "Proton 9.0" → proton_9 (7.0 and later, and every x.0),
// "Proton 6.3" → proton_63 (the older point releases). null: a folder whose
// name we can't map (it isn't offered rather than written wrong).
export function valveToolName(folder: string): string | null {
  if (/^Proton - Experimental$/i.test(folder)) return "proton_experimental";
  if (/^Proton Hotfix$/i.test(folder)) return "proton_hotfix";
  const m = /^Proton (\d+)\.(\d+)(?: \(Beta\))?$/i.exec(folder);
  if (!m) return null;
  const major = Number(m[1]);
  return major >= 7 || m[2] === "0" ? `proton_${major}` : `proton_${major}${m[2]}`;
}

// A compatibilitytools.d build's internal name (its compatibilitytool.vdf;
// GE-Proton and our builds use the folder name, which is the fallback).
function customTool(toolsDir: string, folder: string): SteamTool {
  const doc = readVdfFile(join(toolsDir, folder, "compatibilitytool.vdf"));
  const first = getNode(doc ?? [], "compatibilitytools", "compat_tools")?.[0];
  const name = first && typeof first[1] !== "string" ? first[0] : folder;
  const label = first && typeof first[1] !== "string" ? (getString(first[1], "display_name") ?? name) : folder;
  return { name, label };
}

// Every build Steam can run a game with: compatibilitytools.d, then Valve's own Protons.
export function steamTools(install: SteamInstall): SteamTool[] {
  const out = new Map<string, SteamTool>();
  // loop: NOT-WORTH — builds in compatibilitytools.d, one small VDF read each; once per scan
  for (const folder of installedTools(install)) {
    const tool = customTool(install.toolsDir, folder);
    if (!out.has(tool.name)) out.set(tool.name, tool);
  }
  // loop: NOT-WORTH — Valve's Proton folders (≤ ~8), once per scan
  for (const folder of valveProtons(install)) {
    const name = valveToolName(folder);
    if (name && !out.has(name)) out.set(name, { name, label: folder });
  }
  return [...out.values()];
}
