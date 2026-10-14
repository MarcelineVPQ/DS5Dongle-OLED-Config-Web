// GOG Galaxy and the Epic Games Launcher on Windows (read-only):
//   GOG     each installed game is a registry key under
//           HKLM\SOFTWARE\WOW6432Node\GOG.com\Games\<id> (gameName, path,
//           exe; DLC carry dependsOn = the base game's id);
//   Epic    one JSON manifest per installed item in
//           %ProgramData%\Epic\EpicGamesLauncher\Data\Manifests\*.item
//           (DisplayName, InstallLocation, AppName, AppCategories; DLC have
//           MainGameAppName ≠ AppName).
// On Linux these games come in through Heroic instead.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AppKind } from "../../../src/desktop/games/types";

export interface StoreGame {
  launcher: "gog" | "epic";
  id: string; // GOG game id, Epic AppName
  title: string;
  installDir: string;
  kind?: AppKind; // absent = a game
}

const GOG_KEY = "HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games";

// `reg query <key> /s` output: a key line, then "    name    REG_SZ    value".
export function parseGogRegistry(text: string): StoreGame[] {
  const out: StoreGame[] = [];
  let cur: Record<string, string> | null = null;
  const flush = () => {
    if (cur?.gameID && cur.gameName && cur.path) out.push({ launcher: "gog", id: cur.gameID, title: cur.gameName, installDir: cur.path, ...(cur.dependsOn ? { kind: "dlc" as const } : {}) });
  };
  for (const line of text.split(/\r?\n/)) {
    if (/^HKEY_/i.test(line)) {
      flush();
      cur = /\\Games\\[^\\]+$/i.test(line.trim()) ? {} : null;
      continue;
    }
    const m = /^\s+(\S+)\s+REG_(?:SZ|EXPAND_SZ|DWORD)\s+(.*)$/.exec(line);
    if (m && cur) cur[m[1]] = m[2].trim();
  }
  flush();
  return out;
}

export function parseEpicManifest(text: string): StoreGame | null {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(text.replace(/^\uFEFF/, "")) as Record<string, unknown>; // tolerate a BOM
  } catch {
    // error: NOT-WORTH — a broken Epic manifest: that game isn't listed
    return null;
  }
  const str = (k: string) => (typeof m[k] === "string" ? (m[k] as string) : "");
  const title = str("DisplayName");
  const installDir = str("InstallLocation");
  const id = str("AppName");
  if (!title || !installDir || !id || m.bIsIncompleteInstall === true) return null;
  const cats = Array.isArray(m.AppCategories) ? (m.AppCategories as unknown[]).filter((c): c is string => typeof c === "string") : [];
  const main = str("MainGameAppName");
  const kind: AppKind | undefined = main && main !== id ? "dlc" : cats.includes("games") ? undefined : cats.includes("applications") ? "application" : undefined;
  return { launcher: "epic", id, title, installDir, ...(kind ? { kind } : {}) };
}

const regExe = () => join(process.env.SystemRoot ?? "C:\\Windows", "System32", "reg.exe");
export const epicManifestDir = () => join(process.env.ProgramData ?? "C:\\ProgramData", "Epic", "EpicGamesLauncher", "Data", "Manifests");

export function readGogGames(run: () => string = () => execFileSync(regExe(), ["query", GOG_KEY, "/s"], { encoding: "utf8", windowsHide: true, timeout: 5000 })): StoreGame[] {
  try {
    return parseGogRegistry(run());
  } catch {
    // error: NOT-WORTH — no GOG registry key: no GOG games
    return []; // no GOG games (the key doesn't exist)
  }
}

export function readEpicGames(dir = epicManifestDir()): StoreGame[] {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".item"));
  } catch {
    // error: NOT-WORTH — no Epic manifests folder: no Epic games
    return [];
  }
  const out: StoreGame[] = [];
  for (const f of files) {
    try {
      const g = parseEpicManifest(readFileSync(join(dir, f), "utf8"));
      if (g) out.push(g);
    } catch {
      // error: NOT-WORTH — unreadable manifest
    }
  }
  return out;
}

// The library key, the same in the scan and the details, shaped like every
// other key (`<launcher>-<8 hex>:<store>:<id>`, GameKeySchema) so profiles,
// ratings, art and game actions accept it.
const WIN_HASH = createHash("sha256").update("windows").digest("hex").slice(0, 8);
export const storeKey = (g: Pick<StoreGame, "launcher" | "id">) => `${g.launcher}-${WIN_HASH}:${g.launcher}:${g.id}`;

export interface WindowsStores {
  gog: { found: boolean; games: StoreGame[] };
  epic: { found: boolean; games: StoreGame[] };
}

export function readWindowsStores(): WindowsStores {
  const gog = readGogGames();
  const epic = readEpicGames();
  return { gog: { found: gogGalaxyInstalled() || gog.length > 0, games: gog }, epic: { found: epicLauncherInstalled() || epic.length > 0, games: epic } };
}

// Whether the launcher itself is installed (games can outlive it).
export function gogGalaxyInstalled(): boolean {
  const pf = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  return existsSync(join(pf, "GOG Galaxy", "GalaxyClient.exe"));
}
export function epicLauncherInstalled(): boolean {
  const pf = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  return existsSync(join(pf, "Epic Games", "Launcher", "Portal", "Binaries", "Win64", "EpicGamesLauncher.exe")) || existsSync(epicManifestDir());
}
