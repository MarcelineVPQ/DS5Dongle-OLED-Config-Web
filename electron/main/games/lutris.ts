// Lutris: installs, Wine games and their runner version. Read side only.
// Proton builds run through umu; Lutris lists a build when its folder holds a
// `proton` script in runners/wine/ (and, in newer versions, in Steam's
// compatibilitytools.d).
import { existsSync, readdirSync } from "node:fs";
import { readParsed } from "./files";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

export interface LutrisInstall {
  dataDir: string; // ~/.local/share/lutris (pga.db, runners/)
  configDir: string; // games/*.yml and runners/*.yml live here
  flatpak: boolean;
  runnerWineYml: string; // global Wine runner defaults
  wineDir: string; // runners/wine (where Proton/Wine builds go)
  umu: boolean; // umu-run present: Proton builds are usable
}

export interface LutrisGame {
  slug: string;
  configId: string; // the yml file name (unique per install; one game can be installed twice)
  name: string;
  configPath: string; // games/<configpath>.yml
  runner: string | null; // wine.version, null = runner default
  env: Record<string, string>; // system.env (the game's environment variables)
  system: Record<string, unknown>; // the game's system options (gamescope, gamescope_hdr, … since Lutris 0.5.17)
  args: string; // game.args (the game's arguments)
}

export function findLutrisInstalls(home: string): LutrisInstall[] {
  const out: LutrisInstall[] = [];
  // loop: NOT-WORTH — two possible Lutris folders
  for (const [dataDir, configHome, flatpak] of [
    [join(home, ".local/share/lutris"), join(home, ".config/lutris"), false],
    [join(home, ".var/app/net.lutris.Lutris/data/lutris"), join(home, ".var/app/net.lutris.Lutris/config/lutris"), true],
  ] as Array<[string, string, boolean]>) {
    if (!existsSync(join(dataDir, "pga.db"))) continue;
    // Lutris uses ~/.config/lutris only if it holds the games; otherwise the data dir.
    let configDir = dataDir;
    try {
      if (readdirSync(join(configHome, "games")).length > 0) configDir = configHome;
    } catch {
      // error: NOT-WORTH — no ~/.config/lutris/games: Lutris uses the data dir
    }
    out.push({
      dataDir,
      configDir,
      flatpak,
      runnerWineYml: join(configDir, "runners/wine.yml"),
      wineDir: join(dataDir, "runners/wine"),
      umu: existsSync(join(dataDir, "runtime/umu/umu-run")),
    });
  }
  return out;
}

function readYaml(path: string): unknown {
  return readParsed(path, (text) => parseYaml(text) as unknown);
}

function systemEnv(doc: unknown): Record<string, string> {
  const env = (doc as { system?: { env?: unknown } } | null)?.system?.env;
  if (!env || typeof env !== "object" || Array.isArray(env)) return {};
  // loop: HOT-PATH-OK — env entries of one game
  return Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)]));
}

function systemOptions(doc: unknown): Record<string, unknown> {
  const system = (doc as { system?: unknown } | null)?.system;
  return system && typeof system === "object" && !Array.isArray(system) ? (system as Record<string, unknown>) : {};
}

function gameArgs(doc: unknown): string {
  const args = (doc as { game?: { args?: unknown } } | null)?.game?.args;
  return typeof args === "string" ? args : "";
}

function wineVersion(doc: unknown): string | null {
  const wine = (doc as { wine?: { version?: unknown } } | null)?.wine;
  return typeof wine?.version === "string" ? wine.version : null;
}

export function lutrisDefaultRunner(install: LutrisInstall): string | null {
  return wineVersion(readYaml(install.runnerWineYml));
}

interface PgaRow {
  slug: string;
  name: string;
  configpath: string | null;
}

// Installed Wine games from pga.db (read-only). Falls back to the yml files.
export function listLutrisGames(install: LutrisInstall): LutrisGame[] {
  let rows: PgaRow[];
  try {
    // node:sqlite ships with Electron's Node; loaded lazily so tests and other OSes never touch it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    const db = new DatabaseSync(join(install.dataDir, "pga.db"), { readOnly: true });
    try {
      rows = db.prepare("SELECT slug, name, configpath FROM games WHERE installed = 1 AND runner = 'wine'").all() as unknown as PgaRow[];
    } finally {
      db.close();
    }
  } catch {
    // error: NOT-WORTH — no readable pga.db: the yml game files are listed instead
    try {
      // loop: NOT-WORTH — yml fallback only when pga.db can't be read
      rows = readdirSync(join(install.configDir, "games"))
        .filter((f) => f.endsWith(".yml"))
        .map((f) => ({ slug: f.replace(/-\d+\.yml$/, ""), name: f.replace(/-\d+\.yml$/, ""), configpath: f.slice(0, -4) }));
    } catch {
      // error: NOT-WORTH — no games folder: no Lutris games, which the page shows
      rows = [];
    }
  }
  // loop: HOT-PATH-OK — one YAML parse per game from the scan's read-ahead texts (games/*.yml read in parallel first, loop pass batch 3)
  return rows
    .filter((r) => r.configpath && /^[\w.-]+$/.test(r.configpath))
    .map((r) => {
      const configPath = join(install.configDir, "games", `${r.configpath}.yml`);
      const doc = readYaml(configPath);
      return { slug: r.slug, configId: r.configpath!, name: r.name, configPath, runner: wineVersion(doc), env: systemEnv(doc), system: systemOptions(doc), args: gameArgs(doc) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function lutrisWineBuilds(install: LutrisInstall): string[] {
  try {
    // loop: NOT-WORTH — Wine/Proton builds in Lutris' runner folder, 2 stats each
    return readdirSync(install.wineDir).filter((d) => existsSync(join(install.wineDir, d, "proton")) || existsSync(join(install.wineDir, d, "bin/wine")));
  } catch {
    // error: NOT-WORTH — no runner folder: no Lutris Wine builds
    return [];
  }
}

// Every Wine/Proton build Lutris can run a game with (the game page's
// picker), by the name Lutris stores in wine.version: its own runners/wine
// builds, and for the native Lutris also Steam's (`steamNames`). Proton builds
// run through umu, so they're offered only when umu is there.
export function lutrisBuilds(install: LutrisInstall, steamNames: string[]): string[] {
  // loop: NOT-WORTH — builds in Lutris' runner folder, a stat each; once per scan
  const own = lutrisWineBuilds(install).filter((d) => install.umu || !existsSync(join(install.wineDir, d, "proton")));
  return [...new Set([...own, ...(install.flatpak || !install.umu ? [] : steamNames)])];
}
