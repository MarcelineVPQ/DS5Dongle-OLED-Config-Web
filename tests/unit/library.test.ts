import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectRunning, RunningGameWatcher, type ProcView, type RunningCandidate } from "../../electron/main/games/running";
import { LibraryStore } from "../../electron/main/games/libraryStore";
import { GameKeySchema, ProfileSettingsSchema, type ProfileSettings } from "../../src/desktop/games/library";
import { SetMineSchema, SetProfileSchema } from "../../electron/main/ipc";

const proc = (p: Partial<ProcView>): ProcView => ({ pid: 1, comm: "x", args: [], cwd: null, env: {}, ...p });
const games: RunningCandidate[] = [
  { key: "steam-1a2b3c4d:steam:4078430", launcher: "steam", id: "4078430", installDir: "/s/common/Galactic Racer" },
  { key: "heroic-1a2b3c4d:gog:1423049311", launcher: "heroic", id: "1423049311", installDir: "/g/Witcher" },
  { key: "lutris-1a2b3c4d:lutris:battlenet-1", launcher: "lutris", id: "battlenet-1", installDir: "/l/battlenet" },
];

describe("running game detection", () => {
  it("finds a Steam game by the SteamAppId every game process inherits", () => {
    expect(detectRunning([proc({ comm: "GalacticRacer.e", env: { SteamAppId: "4078430" } })], games)).toBe(games[0].key);
  });
  it("finds it by the reaper's AppId= argument too", () => {
    expect(detectRunning([proc({ comm: "reaper", args: ["reaper", "SteamLaunch", "AppId=4078430", "--"] })], games)).toBe(games[0].key);
  });
  it("ignores SteamAppId=0 (Steam itself) and unknown apps", () => {
    expect(detectRunning([proc({ env: { SteamAppId: "0" } }), proc({ env: { SteamAppId: "999" } })], games)).toBeNull();
  });
  it("finds a Heroic game by HEROIC_APP_NAME", () => {
    expect(detectRunning([proc({ env: { HEROIC_APP_NAME: "1423049311" } })], games)).toBe(games[1].key);
  });
  it("falls back to a Wine process inside the install folder (Windows-style path too)", () => {
    expect(detectRunning([proc({ comm: "wine64-preloader", args: ["Z:\\l\\battlenet\\Battle.net.exe"] })], games)).toBe(games[2].key);
    expect(detectRunning([proc({ comm: "Game.exe", cwd: "/g/Witcher/bin" })], games)).toBe(games[1].key);
  });
  it("doesn't take a folder that merely starts the same (Witcher vs Witcher3)", () => {
    expect(detectRunning([proc({ comm: "wineserver", cwd: "/g/Witcher3" })], games)).toBeNull();
  });
  it("only reports a change after it held for the settle time", () => {
    let seen: ProcView[] = [];
    const changes: Array<string | null> = [];
    const w = new RunningGameWatcher(
      () => games,
      (k) => changes.push(k),
      () => seen,
      4000,
    );
    seen = [proc({ env: { SteamAppId: "4078430" } })];
    w.tick(0);
    w.tick(2000);
    expect(changes).toEqual([]);
    w.tick(4000);
    expect(changes).toEqual([games[0].key]);
    seen = [];
    w.tick(5000);
    w.tick(6000);
    seen = [proc({ env: { SteamAppId: "4078430" } })]; // came back before settling: no change
    w.tick(7000);
    w.tick(20000);
    expect(changes).toEqual([games[0].key]);
  });
});

const settings: ProfileSettings = {
  hapticsGain: 2,
  autoHapticsEnable: 1,
  autoHapticsGain: 100,
  autoHapticsLowpass: 1,
  speakerVolume: 0,
  lightbarMode: 1,
  lbFavR: [255, 0, 0, 0],
  lbFavG: [0, 255, 0, 0],
  lbFavB: [0, 0, 255, 0],
  btMicEnable: false,
};

describe("library store", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const key = "steam-1a2b3c4d:steam:1091500";

  it("keeps profiles, the player's own data and the restore point across restarts", () => {
    dir = mkdtempSync(join(tmpdir(), "ds5-lib-"));
    const a = new LibraryStore(dir);
    a.setProfile(key, "Cyberpunk 2077", settings);
    a.setMine(key, "Cyberpunk 2077", { rating: 5, tags: ["triggers-work"], notes: "triggers great" });
    a.setRestore({ gameKey: key, settings: { ...settings, hapticsGain: 1 } });
    const b = new LibraryStore(dir).get();
    expect(b.games[key].profile?.settings.hapticsGain).toBe(2);
    expect(b.games[key].mine?.rating).toBe(5);
    expect(b.restore?.settings.hapticsGain).toBe(1);
    new LibraryStore(dir).setRestore(undefined);
    expect(new LibraryStore(dir).get().restore).toBeUndefined();
  });

  it("drops a game's entry once it has no profile and no data of the player's", () => {
    dir = mkdtempSync(join(tmpdir(), "ds5-lib-"));
    const s = new LibraryStore(dir);
    s.setProfile(key, "Cyberpunk 2077", settings);
    expect(s.deleteProfile(key).games[key]).toBeUndefined();
  });

  it("sets a corrupt file aside and starts empty instead of failing", () => {
    dir = mkdtempSync(join(tmpdir(), "ds5-lib-"));
    writeFileSync(join(dir, "game-library.json"), "{ not json");
    expect(new LibraryStore(dir).get().games).toEqual({});
    expect(readdirSync(dir).some((f) => f.startsWith("game-library.json.bad-"))).toBe(true);
  });
});

describe("library IPC schemas", () => {
  it("accept scan keys and refuse paths or other shapes", () => {
    for (const ok of ["steam-1a2b3c4d:steam:1091500", "heroic-0a1b2c3d:epic:Fortnite", "heroic-0a1b2c3d:gog:1423049311", "lutris-0a1b2c3d:lutris:battlenet-1"])
      expect(GameKeySchema.safeParse(ok).success, ok).toBe(true);
    for (const bad of ["/home/user/.config/heroic", "steam-1a2b3c4d:steam:../../x", "steam:1091500", "steam-1a2b3c4d:steam:a/b", ""]) expect(GameKeySchema.safeParse(bad).success, bad).toBe(false);
  });
  it("refuse out-of-range profile values and unknown fields", () => {
    expect(ProfileSettingsSchema.safeParse({ ...settings, hapticsGain: 9 }).success).toBe(false);
    expect(ProfileSettingsSchema.safeParse({ ...settings, remap: [1] }).success).toBe(false);
    expect(SetProfileSchema.safeParse({ gameKey: "steam-1a2b3c4d:steam:1", title: "X", settings }).success).toBe(true);
    expect(SetMineSchema.safeParse({ gameKey: "steam-1a2b3c4d:steam:1", title: "X", mine: { rating: 6 } }).success).toBe(false);
    // Feedback is fixed statements only: no free-text review, no unknown tags.
    expect(SetMineSchema.safeParse({ gameKey: "steam-1a2b3c4d:steam:1", title: "X", mine: { review: "hi" } }).success).toBe(false);
    expect(SetMineSchema.safeParse({ gameKey: "steam-1a2b3c4d:steam:1", title: "X", mine: { tags: ["made-up"] } }).success).toBe(false);
    expect(SetMineSchema.safeParse({ gameKey: "steam-1a2b3c4d:steam:1", title: "X", mine: { tags: ["weak-vibration"] } }).success).toBe(true);
  });
});
