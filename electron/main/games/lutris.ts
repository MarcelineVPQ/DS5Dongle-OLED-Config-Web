// Lutris: installs, Wine games and their runner version. Read side only.
// Proton builds run through umu; Lutris lists a build when its folder holds a
// `proton` script in runners/wine/ (and, in newer versions, in Steam's
// compatibilitytools.d).
import { existsSync, readFileSync, readdirSync } from "node:fs";
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
  name: string;
  configPath: string; // games/<configpath>.yml
  runner: string | null; // wine.version, null = runner default
}

export function findLutrisInstalls(home: string): LutrisInstall[] {
  const out: LutrisInstall[] = [];
  for (const [dataDir, configHome, flatpak] of [
    [join(home, ".local/share/lutris"), join(home, ".config/lutris"), false],
    [join(home, ".var/app/net.lutris.Lutris/data/lutris"), join(home, ".var/app/net.lutris.Lutris/config/lutris"), true],
  ] as Array<[string, string, boolean]>) {
    if (!existsSync(join(dataDir, "pga.db"))) continue;
    // Lutris uses ~/.config/lutris only if it holds the games; otherwise the data dir.
    const configDir = existsSync(join(configHome, "games")) && readdirSync(join(configHome, "games")).length > 0 ? configHome : dataDir;
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

export function readYaml(path: string): unknown {
  try {
    return parseYaml(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
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
    try {
      rows = readdirSync(join(install.configDir, "games"))
        .filter((f) => f.endsWith(".yml"))
        .map((f) => ({ slug: f.replace(/-\d+\.yml$/, ""), name: f.replace(/-\d+\.yml$/, ""), configpath: f.slice(0, -4) }));
    } catch {
      rows = [];
    }
  }
  return rows
    .filter((r) => r.configpath && /^[\w.-]+$/.test(r.configpath))
    .map((r) => {
      const configPath = join(install.configDir, "games", `${r.configpath}.yml`);
      return { slug: r.slug, name: r.name, configPath, runner: wineVersion(readYaml(configPath)) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function lutrisWineBuilds(install: LutrisInstall): string[] {
  try {
    return readdirSync(install.wineDir).filter((d) => existsSync(join(install.wineDir, d, "proton")) || existsSync(join(install.wineDir, d, "bin/wine")));
  } catch {
    return [];
  }
}
