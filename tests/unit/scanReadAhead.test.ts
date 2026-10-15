// Loop pass batch 3: the library scan reads its per-game files ahead in
// parallel (no synchronous read per game on the main process), reads each
// file once per scan (a Proton build's `version` shared by many games), and
// looks games up in localconfig through one index instead of a linear search
// per game. Same report as before.
import * as fs from "node:fs";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAhead, withScanTexts } from "../../electron/main/games/files";
import { scan, scanFiles, type ScanDeps } from "../../electron/main/games/games";
import { buildVersion } from "../../electron/main/games/proton";
import { steamAppIndex } from "../../electron/main/games/steam";
import { getString, parseVdf } from "../../electron/main/games/vdf";
import { asLinux } from "../support/platform";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});
const readSync = vi.mocked(fs.readFileSync);

asLinux();

const BUILD = "GE-Proton10-34";
let home: string;
const steamRoot = () => join(home, ".steam/debian-installation");

function write(path: string, text: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

function buildHome() {
  const steam = steamRoot();
  write(
    join(steam, "config/config.vdf"),
    `"InstallConfigStore"\n{\n\t"Software"\n\t{\n\t\t"Valve"\n\t\t{\n\t\t\t"Steam"\n\t\t\t{\n\t\t\t\t"CompatToolMapping"\n\t\t\t\t{\n\t\t\t\t\t"0"\n\t\t\t\t\t{\n\t\t\t\t\t\t"name"\t\t"${BUILD}"\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n}\n`,
  );
  write(
    join(steam, "userdata/1/config/localconfig.vdf"),
    `"UserLocalConfigStore"\n{\n\t"Software"\n\t{\n\t\t"Valve"\n\t\t{\n\t\t\t"Steam"\n\t\t\t{\n\t\t\t\t"apps"\n\t\t\t\t{\n\t\t\t\t\t"100"\n\t\t\t\t\t{\n\t\t\t\t\t\t"LaunchOptions"\t\t"%command% -dx11"\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n\t"apps"\n\t{\n\t\t"100"\n\t\t{\n\t\t\t"UseSteamControllerConfig"\t\t"0"\n\t\t}\n\t}\n}\n`,
  );
  write(join(steam, "steamapps/libraryfolders.vdf"), `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steam}"\n\t}\n}\n`);
  for (const [id, name] of [
    ["100", "Ghostrunner"],
    ["200", "Hades"],
    ["300", "Control Ultimate Edition"],
  ])
    write(join(steam, `steamapps/appmanifest_${id}.acf`), `"AppState"\n{\n\t"appid"\t\t"${id}"\n\t"name"\t\t"${name}"\n}\n`);
  write(join(steam, "compatibilitytools.d", BUILD, "proton"), "");
  write(join(steam, "compatibilitytools.d", BUILD, "version"), `1791920210 ${BUILD}`);

  const heroic = join(home, ".config/heroic");
  write(join(heroic, "config.json"), JSON.stringify({ defaultSettings: {} }));
  write(join(heroic, "sideload_apps/library.json"), JSON.stringify({ games: [{ app_name: "ghost", title: "Ghostrunner", is_installed: true, install: { platform: "windows" } }] }));
  write(join(heroic, "GamesConfig/ghost.json"), JSON.stringify({ ghost: { enviromentOptions: [{ key: "DXVK_HUD", value: "fps" }] } }));

  const lutris = join(home, ".local/share/lutris");
  write(join(lutris, "runners/wine.yml"), `wine:\n  version: ${BUILD}\n`);
  write(join(lutris, "games/control-1.yml"), `game:\n  exe: control.exe\nwine:\n  version: ${BUILD}\n`);
  const db = new DatabaseSync(join(lutris, "pga.db"));
  db.exec("CREATE TABLE games (slug TEXT, name TEXT, runner TEXT, installed INTEGER, configpath TEXT)");
  db.exec("INSERT INTO games VALUES ('control', 'Control', 'wine', 1, 'control-1')");
  db.close();
}

const deps = (): ScanDeps => ({ home, ourProton: null, latestProton: null, latestSize: null, running: new Set(), audioCards: [] });

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "ds5-readahead-")));
  buildHome();
  readSync.mockClear();
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("library scan read-ahead (loop pass batch 3)", () => {
  it("lists every per-game file and Steam's two config files", () => {
    const files = scanFiles(home);
    expect(files).toEqual(
      expect.arrayContaining([
        join(steamRoot(), "config/config.vdf"),
        join(steamRoot(), "userdata/1/config/localconfig.vdf"),
        join(steamRoot(), "steamapps/appmanifest_100.acf"),
        join(steamRoot(), "steamapps/appmanifest_300.acf"),
        join(home, ".config/heroic/GamesConfig/ghost.json"),
        join(home, ".local/share/lutris/games/control-1.yml"),
      ]),
    );
  });

  it("gives the same report, with no synchronous read of a read-ahead file", async () => {
    const plain = scan(deps());
    const texts = await readAhead(scanFiles(home));
    const readAheadFiles = new Set(texts.keys());
    readSync.mockClear();
    const ahead = withScanTexts(texts, () => scan(deps()));
    expect({ ...ahead.report, scannedAt: "" }).toEqual({ ...plain.report, scannedAt: "" });
    expect(ahead.report.games.length).toBeGreaterThanOrEqual(5);
    const readNow = readSync.mock.calls.map((c) => String(c[0]));
    expect(readNow.filter((p) => readAheadFiles.has(p))).toEqual([]);
    // Every other file the scan reads is read once (a Proton build's version file with several games on it).
    expect(readNow.length).toBe(new Set(readNow).size);
  });

  it("reads a build's version file once per scan, however many games use it", () => {
    const dir = join(steamRoot(), "compatibilitytools.d", BUILD);
    const count = () => readSync.mock.calls.filter((c) => String(c[0]) === join(dir, "version")).length;
    // loop: NOT-WORTH — 3 calls in a test
    for (let i = 0; i < 3; i++) expect(buildVersion([dir])).toBe(`1791920210 ${BUILD}`);
    expect(count()).toBe(3); // outside a scan: no cache
    readSync.mockClear();
    withScanTexts(new Map(), () => {
      // loop: NOT-WORTH — 3 calls in a test
      for (let i = 0; i < 3; i++) expect(buildVersion([dir])).toBe(`1791920210 ${BUILD}`);
    });
    expect(count()).toBe(1);
    // A missing file is remembered as missing for the scan, and the cache ends with it.
    expect(withScanTexts(new Map(), () => buildVersion([join(home, "nope")]))).toBeNull();
  });

  it("reads a missing or unreadable file as null, as before", async () => {
    const texts = await readAhead([join(home, "missing.json")]);
    expect(texts.get(join(home, "missing.json"))).toBeNull();
  });

  it("indexes localconfig and CompatToolMapping with getString's answers", () => {
    const config = parseVdf(`"InstallConfigStore"{"Software"{"Valve"{"Steam"{"CompatToolMapping"{"0"{"name" "A"}"7"{"name" "B"}"7"{"name" "C"}}}}}}`);
    const local = parseVdf(
      `"UserLocalConfigStore"{"apps"{"7"{"UseSteamControllerConfig" "2"}"8"{"UseSteamControllerConfig" "0"}"9" "flat"}"Software"{"Valve"{"Steam"{"Apps"{"7"{"LaunchOptions" "x"}}}}}}`,
    );
    const byApp = steamAppIndex(config, local);
    expect(byApp.compatTool("7")).toBe(getString(config, "InstallConfigStore", "Software", "Valve", "Steam", "CompatToolMapping", "7", "name"));
    expect(byApp.compatTool("7")).toBe("B"); // the first of a repeated key, as getKey
    expect(byApp.compatTool("5")).toBeNull();
    expect(byApp.steamInput("7")).toBe("on");
    expect(byApp.steamInput("8")).toBe("off");
    expect(byApp.steamInput("9")).toBe("global"); // a string where a node belongs
    expect(byApp.steamInput("5")).toBe("global");
    expect(byApp.launchOptions("7")).toBe("x"); // keys match case-insensitively
    expect(byApp.launchOptions("8")).toBe("");
    expect(steamAppIndex(null, null).launchOptions("7")).toBe("");
  });
});
