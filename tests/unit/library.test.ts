import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { detectRunning, readProcs, RunningGameWatcher, type ProcView, type RunningCandidate } from "../../electron/main/games/running";
import { LibraryStore } from "../../electron/main/games/libraryStore";
import { artRequestTarget } from "../../electron/main/games/artRequest";
import { ButtonLayoutSchema, LayoutIdSchema, GameKeySchema, ProfileSettingsSchema, type ProfileSettings } from "../../src/desktop/games/library";
import { SetMineSchema, SetProfileSchema } from "../../electron/main/ipc";
import { decideProfileStep } from "../../src/desktop/library/useGameProfile";
import { staleness, versionLess } from "../../src/desktop/library/support";
import { EMPTY_LIBRARY, type LibraryFile } from "../../src/desktop/games/library";
import { asLinux } from "../support/platform";

// Built on Linux launcher folders: Linux behavior on every test machine.
asLinux();

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
    // Games consent turned off mid-game: the game is reported over, so the profile is undone.
    w.stop();
    expect(changes).toEqual([games[0].key, null]);
    expect(w.running).toBeNull();
  });
});

// A fake /proc: pid -> name, parent, owner, and what the full read finds.
function fakeProc(procs: Array<{ pid: number; name: string; ppid: number; uid?: number; env?: string[]; args?: string[]; cwd?: string; exe?: string }>): string {
  const root = mkdtempSync(join(tmpdir(), "proc-"));
  const me = process.getuid?.() ?? 1000;
  for (const p of procs) {
    const dir = join(root, String(p.pid));
    mkdirSync(dir);
    writeFileSync(join(dir, "status"), `Name:\t${p.name}\nUmask:\t0022\nPPid:\t${p.ppid}\nUid:\t${p.uid ?? me}\t${p.uid ?? me}\t${p.uid ?? me}\t${p.uid ?? me}\n`);
    writeFileSync(join(dir, "comm"), `${p.name}\n`);
    writeFileSync(join(dir, "cmdline"), (p.args ?? [p.name]).join("\0") + "\0");
    writeFileSync(join(dir, "environ"), (p.env ?? ["HOME=/home/x"]).join("\0") + "\0");
    symlinkSync(p.cwd ?? "/home/x", join(dir, "cwd"));
    symlinkSync(p.exe ?? `/usr/bin/${p.name}`, join(dir, "exe"));
  }
  writeFileSync(join(root, "uptime"), "1 1\n"); // not a process
  return root;
}

// A fake Linux /proc (symlinks, uids): the code only runs on Linux, and
// Windows has neither process.getuid nor the same symlinks.
describe.skipIf(process.platform === "win32")("reading /proc for the running game", () => {
  const root = fakeProc([
    { pid: 10, name: "systemd", ppid: 0 },
    { pid: 20, name: "steam", ppid: 10 },
    { pid: 30, name: "reaper", ppid: 20, args: ["reaper", "SteamLaunch", "AppId=4078430", "--"] },
    { pid: 31, name: "hl2_linux", ppid: 30, env: ["SteamAppId=4078430", "SteamGameId=4078430", "PATH=/usr/bin"] }, // a native Steam game
    { pid: 15, name: "plasmashell", ppid: 10 }, // an orphan without a launch variable: skipped
    { pid: 40, name: "firefox", ppid: 15, env: ["SteamAppId=999"] }, // not under a launcher, not an orphan: never read closely
    { pid: 50, name: "Witcher3Long", ppid: 10, args: ["Z:\\g\\Witcher\\bin\\Witcher3.exe"], cwd: "/g/Witcher/bin", exe: "/opt/wine/bin/wine64-preloader" }, // Wine, left its launcher
    { pid: 60, name: "heroic", ppid: 10 },
    { pid: 61, name: "sh", ppid: 60, env: ["HEROIC_APP_NAME=1423049311"] },
    { pid: 70, name: "reaper", ppid: 10, uid: 4242 }, // another user's
    { pid: 80, name: "HollowKnight", ppid: 1, env: ["HEROIC_APP_NAME=hollow", "HEROIC_APP_SOURCE=gog"] }, // a native Heroic game after Heroic quit (F8)
  ]);

  it("reads only possible games closely, with the same view as a full read", () => {
    const games = readProcs(true, root);
    expect(games.map((p) => p.pid).sort((a, b) => a - b)).toEqual([20, 30, 31, 50, 60, 61, 80]);
    const full = readProcs(false, root);
    expect(full.map((p) => p.pid).sort((a, b) => a - b)).toEqual([10, 15, 20, 30, 31, 40, 50, 60, 61, 80]);
    // Each process looks exactly as the full read sees it.
    for (const p of games) expect(p).toEqual(full.find((f) => f.pid === p.pid));
    expect(games.find((p) => p.pid === 31)!.env).toEqual({ SteamAppId: "4078430", SteamGameId: "4078430" });
  });

  it("finds the same game as a full read", () => {
    const candidates: RunningCandidate[] = [
      { key: "s", launcher: "steam", id: "4078430" },
      { key: "w", launcher: "heroic", id: "nope", installDir: "/g/Witcher" },
    ];
    for (const only of [true, false]) expect(detectRunning(readProcs(only, root), candidates)).toBe("s");
    const noSteam = candidates.slice(1);
    for (const only of [true, false]) expect(detectRunning(readProcs(only, root), noSteam)).toBe("w");
  });

  it("keeps a native Heroic game once Heroic quit (orphaned, launch variable in its environment)", () => {
    const heroic: RunningCandidate[] = [{ key: "h", launcher: "heroic", id: "hollow" }];
    for (const only of [true, false]) expect(detectRunning(readProcs(only, root), heroic)).toBe("h");
  });

  it("checks a process's owner once, yet still sees it start a launcher (status read every pass)", () => {
    const tmp = fakeProc([
      { pid: 10, name: "systemd", ppid: 0 },
      { pid: 15, name: "plasmashell", ppid: 10 },
      { pid: 16, name: "bash", ppid: 15 },
    ]);
    expect(readProcs(true, tmp).some((p) => p.pid === 16)).toBe(false);
    // The same process runs Steam (exec: a new name on the same pid).
    writeFileSync(join(tmp, "16", "status"), `Name:\tsteam\nPPid:\t15\nUid:\t${process.getuid?.() ?? 1000}\n`);
    writeFileSync(join(tmp, "16", "comm"), "steam\n");
    expect(readProcs(true, tmp).some((p) => p.pid === 16)).toBe(true);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("reads a plain orphan's environment once, and again for a new process on its pid", () => {
    const env = join(root, "15", "environ");
    readProcs(true, root); // looked at once, no launch variable
    writeFileSync(env, "HEROIC_APP_NAME=hollow\0"); // changed in place: not read again
    expect(readProcs(true, root).some((p) => p.pid === 15)).toBe(false);
    rmSync(join(root, "15"), { recursive: true }); // gone for a look...
    expect(readProcs(true, root).some((p) => p.pid === 15)).toBe(false);
    mkdirSync(join(root, "15")); // ...then a new process on the same pid
    writeFileSync(join(root, "15", "status"), `Name:\tplasmashell\nPPid:\t10\nUid:\t${process.getuid?.() ?? 1000}\n`);
    writeFileSync(join(root, "15", "comm"), "plasmashell\n");
    writeFileSync(join(root, "15", "cmdline"), "plasmashell\0");
    writeFileSync(env, "HEROIC_APP_NAME=hollow\0");
    expect(readProcs(true, root).some((p) => p.pid === 15)).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("the running-game watcher with an asynchronous reader (Windows)", () => {
  it("applies each read when it arrives, never two at once, and ignores reads finishing after stop", async () => {
    const changes: Array<string | null> = [];
    let resolve: (p: ProcView[]) => void = () => undefined;
    let reads = 0;
    const w = new RunningGameWatcher(
      () => games,
      (k) => changes.push(k),
      () => {
        reads++;
        return new Promise<ProcView[]>((r) => (resolve = r));
      },
      0,
    );
    const steam = [proc({ env: { SteamAppId: "4078430" } })];
    let t = w.tick(0);
    expect(w.tick(0)).toBeUndefined(); // still reading: skipped
    expect(reads).toBe(1);
    resolve(steam);
    await t;
    t = w.tick(1);
    resolve(steam);
    await t;
    expect(changes).toEqual([games[0].key]);
    t = w.tick(2);
    w.stop();
    resolve([]);
    await t;
    expect(changes).toEqual([games[0].key, null]); // only stop's own report
  });
});

describe("game artwork requests (ds5-art)", () => {
  const key = games[0].key;
  it("accepts only a known game key and kind", () => {
    expect(artRequestTarget(`ds5-art://art/${encodeURIComponent(key)}/hero`)).toEqual({ key, kind: "hero" });
    expect(artRequestTarget(`ds5-art://art/${encodeURIComponent(key)}/secrets`)).toBeNull(); // unknown kind
    expect(artRequestTarget("ds5-art://art/not-a-key/hero")).toBeNull(); // bad key
    expect(artRequestTarget(`ds5-art://art/${encodeURIComponent(key)}/hero/extra`)).toBeNull(); // extra segment
    expect(artRequestTarget(`ds5-art://art/${encodeURIComponent(key)}%2F..%2F..%2Fetc/hero`)).toBeNull(); // encoded traversal
    expect(artRequestTarget("ds5-art://art/%E0%A4%A/hero")).toBeNull(); // broken encoding
    expect(artRequestTarget(`file:///art/${encodeURIComponent(key)}/hero`)).toBeNull(); // other scheme
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
    writeFileSync(join(dir, "game-library-2.json"), "{ not json");
    expect(new LibraryStore(dir).get().games).toEqual({});
    expect(readdirSync(dir).some((f) => f.startsWith("game-library-2.json.bad-"))).toBe(true);
  });
});

// The library as 0.9.4 reads it (a copy of its strict schema): older apps
// (0.9.4, 0.9.5-dev.1 to dev.5, reachable through "Back to stable") must keep
// finding their game-library.json valid and unchanged after this app ran.
const OldLayoutId = z.string().regex(/^[a-z0-9-]{1,40}$/);
const OldGameKey = z.string().regex(/^(steam|heroic|lutris|gog|epic)-[0-9a-f]{8}:(steam|epic|gog|amazon|sideload|lutris):[\w.-]{1,200}$/);
const OldSettings = z.strictObject({
  hapticsGain: z.number().min(1).max(6),
  hapticsGainRight: z.number().min(1).max(6).optional(),
  autoHapticsEnable: z.number().int().min(0).max(3),
  autoHapticsGain: z.number().int().min(0).max(200),
  autoHapticsLowpass: z.number().int().min(0).max(3),
  speakerVolume: z.number().min(-100).max(12),
  lightbarMode: z.number().int().min(0).max(8),
  lbFavR: z.array(z.number().int().min(0).max(255)).length(4),
  lbFavG: z.array(z.number().int().min(0).max(255)).length(4),
  lbFavB: z.array(z.number().int().min(0).max(255)).length(4),
  btMicEnable: z.boolean(),
  buttonLayout: OldLayoutId.optional(),
});
const OldLibrarySchema = z.strictObject({
  version: z.literal(1),
  games: z.record(
    OldGameKey,
    z.strictObject({
      title: z.string().max(300),
      profile: z.strictObject({ settings: OldSettings, updated: z.number() }).optional(),
      mine: z
        .strictObject({
          rating: z.number().int().min(1).max(5).optional(),
          tags: z.array(z.string()).optional(),
          ratedOn: z.strictObject({ app: z.string(), build: z.string().optional(), gameUpdated: z.number().optional(), at: z.number() }).optional(),
          notes: z.string().max(5000).optional(),
        })
        .optional(),
    }),
  ),
  restore: z.strictObject({ gameKey: OldGameKey, settings: OldSettings }).optional(),
  layouts: z.record(OldLayoutId, z.strictObject({ name: z.string().trim().min(1).max(40), table: z.array(z.number()).length(16), updated: z.number() })).optional(),
});

describe("library file (game-library-2.json) and the older apps' file", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const key = "steam-1a2b3c4d:steam:1091500";
  const other = "steam-1a2b3c4d:steam:4078430";
  const oldSettings = {
    hapticsGain: 2,
    autoHapticsEnable: 1,
    autoHapticsGain: 100,
    autoHapticsLowpass: 0,
    speakerVolume: 0,
    lightbarMode: 1,
    lbFavR: [255, 0, 0, 0],
    lbFavG: [0, 255, 0, 0],
    lbFavB: [0, 0, 255, 0],
    btMicEnable: false,
  };
  const oldFile = JSON.stringify(
    {
      version: 1,
      games: { [key]: { title: "Cyberpunk 2077", profile: { settings: oldSettings, updated: 1 }, mine: { rating: 4, notes: "old" } } },
      layouts: { "l-racing": { name: "Racing", table: Array.from({ length: 16 }, (_, i) => i), updated: 1 } },
    },
    null,
    2,
  );
  const files = () => readdirSync(dir).sort();
  const read = (f: string) => readFileSync(join(dir, f), "utf8");

  it("fresh install: starts empty and writes only the new file", () => {
    dir = mkdtempSync(join(tmpdir(), "ds5-lib-"));
    const s = new LibraryStore(dir);
    expect(s.get()).toEqual(EMPTY_LIBRARY);
    expect(files()).toEqual([]);
    s.setProfile(key, "Cyberpunk 2077", { format: 2, hapticsGain: 3 });
    expect(files()).toEqual(["game-library-2.json"]);
    expect(new LibraryStore(dir).get().games[key].profile?.settings).toEqual({ format: 2, hapticsGain: 3 });
  });

  it("migrates the old file once and leaves it byte for byte unchanged", () => {
    dir = mkdtempSync(join(tmpdir(), "ds5-lib-"));
    writeFileSync(join(dir, "game-library.json"), oldFile);
    const s = new LibraryStore(dir);
    expect(s.get().games[key].profile?.settings).toEqual(oldSettings);
    expect(s.get().games[key].mine?.notes).toBe("old");
    expect(s.get().layouts?.["l-racing"]?.name).toBe("Racing");
    // Written at once, so the next start reads the new file even without changes.
    expect(files()).toEqual(["game-library-2.json", "game-library.json"]);
    expect(JSON.parse(read("game-library-2.json"))).toEqual(JSON.parse(oldFile));
    expect(read("game-library.json")).toBe(oldFile);
  });

  it("uses the new file when both exist and never touches the old one", () => {
    dir = mkdtempSync(join(tmpdir(), "ds5-lib-"));
    writeFileSync(join(dir, "game-library.json"), oldFile);
    new LibraryStore(dir).setMine(other, "Galactic Racer", { rating: 5 });
    const s = new LibraryStore(dir);
    expect(s.get().games[other].mine?.rating).toBe(5);
    s.deleteProfile(key);
    s.deleteLayout("l-racing");
    // Deleted in the new file, still there in the old: the new one wins.
    const t = new LibraryStore(dir).get();
    expect(t.games[key].profile).toBeUndefined();
    expect(t.layouts?.["l-racing"]).toBeUndefined();
    expect(read("game-library.json")).toBe(oldFile);
  });

  it("sets a corrupt new file aside and starts empty, leaving the old file alone", () => {
    dir = mkdtempSync(join(tmpdir(), "ds5-lib-"));
    writeFileSync(join(dir, "game-library.json"), oldFile);
    writeFileSync(join(dir, "game-library-2.json"), "{ not json");
    const s = new LibraryStore(dir);
    expect(s.get().games).toEqual({});
    expect(files().some((f) => f.startsWith("game-library-2.json.bad-"))).toBe(true);
    s.setMine(other, "Galactic Racer", { rating: 3 });
    expect(read("game-library.json")).toBe(oldFile);
    expect(files().filter((f) => f.startsWith("game-library.json"))).toEqual(["game-library.json"]);
  });

  it("leaves a bad old file where it is and starts empty", () => {
    dir = mkdtempSync(join(tmpdir(), "ds5-lib-"));
    writeFileSync(join(dir, "game-library.json"), "{ not json");
    expect(new LibraryStore(dir).get()).toEqual(EMPTY_LIBRARY);
    expect(files()).toEqual(["game-library.json"]);
    expect(read("game-library.json")).toBe("{ not json");
  });

  it("an older app still finds a valid library after this app saved format-2 profiles", () => {
    dir = mkdtempSync(join(tmpdir(), "ds5-lib-"));
    writeFileSync(join(dir, "game-library.json"), oldFile);
    expect(OldLibrarySchema.safeParse(JSON.parse(oldFile)).success).toBe(true);
    const s = new LibraryStore(dir);
    s.setProfile(key, "Cyberpunk 2077", {
      format: 2,
      hapticsGain: 4,
      stickCurves: {
        left: {
          type: "precise",
          points: [
            [0, 0],
            [64, 32],
            [128, 96],
            [255, 255],
          ],
        },
      },
    });
    s.setProfile(other, "Galactic Racer", { format: 2, speakerVolume: -10 });
    s.setLayout(
      "l-south",
      "Southpaw",
      Array.from({ length: 16 }, (_, i) => i),
      [0xff, 0xff, 0xfe, 0xfe],
    );
    s.setRestore({ gameKey: other, settings: { format: 2, speakerVolume: 0 } });
    // The new file holds what the older app would reject...
    expect(OldLibrarySchema.safeParse(JSON.parse(read("game-library-2.json"))).success).toBe(false);
    // ...and the older app's own file is untouched and still valid to it.
    expect(read("game-library.json")).toBe(oldFile);
    const old = OldLibrarySchema.safeParse(JSON.parse(read("game-library.json")));
    expect(old.success).toBe(true);
    expect(old.data?.games[key].profile?.settings.hapticsGain).toBe(2);
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

describe("game actions", () => {
  it("builds each launcher's own link from scanned ids only", async () => {
    const { actionUrl, availableActions } = await import("../../electron/main/games/actions");
    expect(actionUrl({ launcher: "steam", store: "steam", id: "4078430" }, "play")).toBe("steam://rungameid/4078430");
    expect(actionUrl({ launcher: "steam", store: "steam", id: "4078430" }, "steamInput")).toBe("steam://controllerconfig/4078430");
    expect(actionUrl({ launcher: "heroic", store: "gog", id: "2049187585" }, "play")).toBe("heroic://launch?appName=2049187585&runner=gog");
    expect(actionUrl({ launcher: "heroic", store: "epic", id: "a b&c" }, "play")).toBe("heroic://launch?appName=a%20b%26c&runner=legendary");
    expect(actionUrl({ launcher: "lutris", store: "lutris", id: "battlenet-1" }, "play", "battlenet")).toBe("lutris:rungame/battlenet");
    // No settings pages outside Steam; a non-numeric Steam id or an odd slug gives nothing.
    expect(actionUrl({ launcher: "heroic", store: "gog", id: "1" }, "properties")).toBeNull();
    expect(actionUrl({ launcher: "steam", store: "steam", id: "../x" }, "play")).toBeNull();
    expect(actionUrl({ launcher: "lutris", store: "lutris", id: "x" }, "play", "a/b")).toBeNull();
    expect(availableActions({ launcher: "heroic", store: "gog", id: "1" }, { installDir: true, prefixDir: false })).toEqual(["play", "installFolder"]);
  });
  it("accepts only a scan key and a known action over IPC", async () => {
    const { GameActionSchema } = await import("../../electron/main/ipc");
    expect(GameActionSchema.safeParse({ gameKey: "steam-1a2b3c4d:steam:4078430", action: "play" }).success).toBe(true);
    expect(GameActionSchema.safeParse({ gameKey: "steam-1a2b3c4d:steam:4078430", action: "openUrl" }).success).toBe(false);
    expect(GameActionSchema.safeParse({ gameKey: "steam-1a2b3c4d:steam:4078430", action: "play", url: "https://x" }).success).toBe(false);
  });
});

describe("game profile switching", () => {
  const A = games[0].key;
  const B = games[1].key;
  const normal = { ...settings, hapticsGain: 1 };
  const withProfiles = (restore?: LibraryFile["restore"]): LibraryFile => ({
    ...EMPTY_LIBRARY,
    games: { [A]: { title: "A", profile: { settings, updated: 10 } }, [B]: { title: "B", profile: { settings: { ...settings, hapticsGain: 3 }, updated: 20 } } },
    restore,
  });
  const base = { appliedFor: null, failed: null, active: false };

  it("applies a running game's profile, keeping the normal values first", () => {
    expect(decideProfileStep({ ...base, running: A, library: withProfiles() })).toMatchObject({ kind: "apply", gameKey: A, restorePoint: "new", stamp: `${A}@10` });
    // Already applied: nothing to do.
    expect(decideProfileStep({ ...base, running: A, library: withProfiles(), appliedFor: `${A}@10` })).toEqual({ kind: "none" });
    // Edited on its page (new version): applied again.
    expect(decideProfileStep({ ...base, running: A, library: withProfiles(), appliedFor: `${A}@9` }).kind).toBe("apply");
  });
  it("keeps the first restore point when switching A -> B or after a crash", () => {
    const restore = { gameKey: A, settings: normal };
    expect(decideProfileStep({ ...base, running: B, library: withProfiles(restore) })).toMatchObject({ kind: "apply", gameKey: B, restorePoint: "rekey" });
    expect(decideProfileStep({ ...base, running: A, library: withProfiles(restore) })).toMatchObject({ kind: "apply", restorePoint: "keep" });
  });
  it("restores the normal values when the game closes, crashed or not", () => {
    expect(decideProfileStep({ ...base, running: null, library: withProfiles({ gameKey: A, settings: normal }) })).toEqual({ kind: "restore", settings: normal });
    // Profile deleted mid-game: same.
    const deleted = { ...withProfiles({ gameKey: A, settings: normal }), games: {} };
    expect(decideProfileStep({ ...base, running: A, library: deleted }).kind).toBe("restore");
    expect(decideProfileStep({ ...base, running: null, library: withProfiles(), active: true })).toEqual({ kind: "clear-active" });
  });
  it("doesn't retry a failed step until something changes", () => {
    expect(decideProfileStep({ ...base, running: A, library: withProfiles(), failed: `${A}@10` })).toEqual({ kind: "none" });
    expect(decideProfileStep({ ...base, running: null, library: withProfiles({ gameKey: A, settings: normal }), failed: "restore" })).toEqual({ kind: "none" });
  });
});

describe("feedback staleness", () => {
  it("compares versions numerically, prereleases first", () => {
    expect(versionLess("0.9.0", "0.10.0")).toBe(true);
    expect(versionLess("0.10.0", "0.9.0")).toBe(false);
    expect(versionLess("0.9.0-beta.1", "0.9.0")).toBe(true);
    expect(versionLess("0.9.0", "0.9.0-beta.1")).toBe(false);
    expect(versionLess("1.2", "1.2.0")).toBe(false);
  });
  it("flags feedback older than a game update or one of our fixes", () => {
    expect(staleness(undefined, {}, [])).toBeNull();
    expect(staleness({ app: "0.9.0", build: "100" }, { buildId: "101", lastUpdated: 5 }, [])).toEqual({ kind: "game-update", at: 5 });
    expect(staleness({ app: "0.9.0", gameUpdated: 5 }, { lastUpdated: 9 }, [])).toEqual({ kind: "game-update", at: 9 });
    expect(staleness({ app: "0.9.0", build: "100" }, { buildId: "100" }, [])).toBeNull();
    expect(staleness({ app: "0.9.0" }, {}, [{ title: "X", app: "0.9.1", note: "fixed" }])).toEqual({ kind: "our-fix", app: "0.9.1" });
  });
});

describe("saved button layouts", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const key = "steam-1a2b3c4d:steam:1091500";
  const racing = [1, 0, ...Array.from({ length: 14 }, (_, i) => i + 2)];

  it("keeps layouts; deleting one sends its games back to normal buttons", () => {
    dir = mkdtempSync(join(tmpdir(), "ds5-lib-"));
    const a = new LibraryStore(dir);
    a.setLayout("l-racing", "  Racing ", racing);
    a.setProfile(key, "Galactic Racer", { ...settings, buttonLayout: "l-racing" });
    const b = new LibraryStore(dir).get();
    expect(b.layouts?.["l-racing"]).toMatchObject({ name: "Racing", table: racing });
    expect(b.games[key].profile?.settings.buttonLayout).toBe("l-racing");
    const c = new LibraryStore(dir).deleteLayout("l-racing");
    expect(c.layouts?.["l-racing"]).toBeUndefined();
    expect(c.games[key].profile?.settings.buttonLayout).toBeUndefined();
  });

  it("rejects bad layouts and ids", () => {
    expect(ButtonLayoutSchema.safeParse({ name: "X", table: [...racing.slice(0, 15), 16], updated: 1 }).success).toBe(false);
    expect(ButtonLayoutSchema.safeParse({ name: "X", table: [...racing.slice(0, 15), 0xff], updated: 1 }).success).toBe(true);
    expect(ButtonLayoutSchema.safeParse({ name: " ", table: racing, updated: 1 }).success).toBe(false);
    expect(LayoutIdSchema.safeParse("../x").success).toBe(false);
  });

  it("a layout edited while its game runs is applied again", () => {
    const A = games[0].key;
    const lib = (updated: number): LibraryFile => ({
      ...EMPTY_LIBRARY,
      games: { [A]: { title: "A", profile: { settings: { ...settings, buttonLayout: "l-r" }, updated: 10 } } },
      layouts: { "l-r": { name: "R", table: racing, updated } },
    });
    const first = decideProfileStep({ running: A, library: lib(5), appliedFor: null, failed: null, active: false });
    expect(first).toMatchObject({ kind: "apply", stamp: `${A}@10+l-r@5` });
    expect(decideProfileStep({ running: A, library: lib(5), appliedFor: `${A}@10+l-r@5`, failed: null, active: true }).kind).toBe("none");
    expect(decideProfileStep({ running: A, library: lib(6), appliedFor: `${A}@10+l-r@5`, failed: null, active: true }).kind).toBe("apply");
  });
});
