import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectRunningWindows, gameExecutables, type ProcView } from "../../electron/main/games/running";
import { findSteamInstalls, listSteamGames } from "../../electron/main/games/steam";

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
