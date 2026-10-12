import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectRunningWindows, gameExecutables, type ProcView } from "../../electron/main/games/running";
import { findSteamInstalls, listSteamGames } from "../../electron/main/games/steam";
import { parseEpicManifest, parseGogRegistry, readEpicGames, readGogGames, storeKey } from "../../electron/main/games/windowsStores";
import { actionUrl } from "../../electron/main/games/actions";
import { scan } from "../../electron/main/games/games";
import { gameDetails } from "../../electron/main/games/details";
import { GameKeySchema } from "../../src/desktop/games/library";

const proc = (comm: string): ProcView => ({ pid: 1, comm, args: [], cwd: null, env: {} });

describe("Games on Windows", () => {
  it("finds Steam from the registry / Program Files candidates and lists its games", () => {
    const root = mkdtempSync(join(tmpdir(), "steam-win-"));
    mkdirSync(join(root, "config"), { recursive: true });
    writeFileSync(join(root, "config", "config.vdf"), '"InstallConfigStore" { }');
    mkdirSync(join(root, "steamapps"), { recursive: true });
    writeFileSync(join(root, "steamapps", "appmanifest_1817070.acf"), '"AppState" { "appid" "1817070" "name" "Marvel\'s Spider-Man Remastered" "installdir" "Spider-Man" }');
    const installs = findSteamInstalls("C:/Users/x", "win32", () => [join(root, "missing"), root]);
    expect(installs.map((i) => i.root)).toHaveLength(1);
    expect(listSteamGames(installs[0]).map((g) => g.name)).toEqual(["Marvel's Spider-Man Remastered"]);
    // Linux paths are never looked at on Windows.
    expect(findSteamInstalls(root, "win32", () => [])).toEqual([]);
  });

  it("indexes a game's program files, without generic helpers", () => {
    const dir = mkdtempSync(join(tmpdir(), "game-"));
    mkdirSync(join(dir, "bin", "x64"), { recursive: true });
    for (const f of ["Spider-Man.exe", "UnityCrashHandler64.exe", "unins000.exe"]) writeFileSync(join(dir, f), "");
    writeFileSync(join(dir, "bin", "x64", "Engine.exe"), "");
    expect([...gameExecutables(dir)].sort()).toEqual(["engine.exe", "spider-man.exe"]);
  });

  it("matches a running program to the game whose folder holds it", () => {
    const games = [
      { key: "steam:a", launcher: "steam" as const, id: "a", installDir: "C:\\\\Games\\\\A" },
      { key: "steam:b", launcher: "steam" as const, id: "b", installDir: "C:\\\\Games\\\\B" },
    ];
    const exes = (dir: string) => new Set(dir.endsWith("A") ? ["a.exe"] : ["b.exe"]);
    expect(detectRunningWindows([proc("explorer.exe"), proc("B.EXE")], games, exes)).toBe("steam:b");
    expect(detectRunningWindows([proc("explorer.exe")], games, exes)).toBeNull();
  });
});

describe("GOG Galaxy and Epic on Windows", () => {
  const reg = [
    "",
    "HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games",
    "",
    "HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1207664643",
    "    gameID    REG_SZ    1207664643",
    "    gameName    REG_SZ    Control Ultimate Edition",
    "    path    REG_SZ    C:\\GOG Games\\Control",
    "    exe    REG_SZ    C:\\GOG Games\\Control\\Control.exe",
    "",
    "HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\1500000001",
    "    gameID    REG_SZ    1500000001",
    "    gameName    REG_SZ    Control - Soundtrack",
    "    path    REG_SZ    C:\\GOG Games\\Control",
    "    dependsOn    REG_SZ    1207664643",
    "",
  ].join("\r\n");

  it("reads GOG Galaxy's registry entries; add-ons are DLC", () => {
    expect(parseGogRegistry(reg)).toEqual([
      { launcher: "gog", id: "1207664643", title: "Control Ultimate Edition", installDir: "C:\\GOG Games\\Control" },
      { launcher: "gog", id: "1500000001", title: "Control - Soundtrack", installDir: "C:\\GOG Games\\Control", kind: "dlc" },
    ]);
    expect(
      readGogGames(() => {
        throw new Error("key not found");
      }),
    ).toEqual([]);
  });

  it("reads Epic manifests; skips half-installed ones, labels apps and add-ons", () => {
    const base = { DisplayName: "Sifu", InstallLocation: "C:\\Epic\\Sifu", AppName: "Sifu_1", AppCategories: ["public", "games"] };
    expect(parseEpicManifest(JSON.stringify(base))).toEqual({ launcher: "epic", id: "Sifu_1", title: "Sifu", installDir: "C:\\Epic\\Sifu" });
    expect(parseEpicManifest(JSON.stringify({ ...base, bIsIncompleteInstall: true }))).toBeNull();
    expect(parseEpicManifest(JSON.stringify({ ...base, AppName: "Sifu_DLC", MainGameAppName: "Sifu_1" }))?.kind).toBe("dlc");
    expect(parseEpicManifest(JSON.stringify({ ...base, AppCategories: ["applications"] }))?.kind).toBe("application");
    expect(parseEpicManifest("{broken")).toBeNull();
    expect(parseEpicManifest("\uFEFF" + JSON.stringify(base))?.title).toBe("Sifu");

    const dir = mkdtempSync(join(tmpdir(), "epic-"));
    writeFileSync(join(dir, "A.item"), JSON.stringify(base));
    writeFileSync(join(dir, "notes.txt"), "x");
    expect(readEpicGames(dir).map((g) => g.title)).toEqual(["Sifu"]);
    expect(readEpicGames(join(dir, "missing"))).toEqual([]);
  });

  it("builds launch links only from safe ids", () => {
    expect(actionUrl({ launcher: "gog", store: "gog", id: "1207664643" }, "libraryPage")).toBe("goggalaxy://openGameView/1207664643");
    expect(actionUrl({ launcher: "gog", store: "gog", id: "1207664643" }, "play")).toBeNull();
    expect(actionUrl({ launcher: "epic", store: "epic", id: "Sifu_1" }, "play")).toBe("com.epicgames.launcher://apps/Sifu_1?action=launch&silent=true");
    expect(actionUrl({ launcher: "epic", store: "epic", id: "x/../y?z" }, "play")).toBeNull();
    expect(actionUrl({ launcher: "gog", store: "gog", id: "12a" }, "libraryPage")).toBeNull();
  });

  it("puts them in the library with their install folders", () => {
    const stores = { gog: { found: true, games: parseGogRegistry(reg) }, epic: { found: false, games: [] } };
    const home = mkdtempSync(join(tmpdir(), "home-"));
    const { report } = scan({ home, ourProton: null, latestProton: null, latestSize: null, running: new Set(), audioCards: [], windowsStores: stores });
    const gog = report.games.filter((g) => g.launcher === "gog");
    expect(gog.map((g) => [g.title, g.kind])).toEqual([
      ["Control Ultimate Edition", undefined],
      ["Control - Soundtrack", "dlc"],
    ]);
    expect(report.launchers.find((l) => l.id === "gog")?.found).toBe(true);
    expect(gameDetails(home, stores.gog.games).get(storeKey(stores.gog.games[0]))?.installDir).toBe("C:\\GOG Games\\Control");
    // Their keys pass the library's key check (profiles, ratings, art, actions).
    for (const g of [...gog, { key: storeKey({ launcher: "epic", id: "Sifu_1" }) }]) expect(GameKeySchema.safeParse(g.key).success).toBe(true);
  });
});
