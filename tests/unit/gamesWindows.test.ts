import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Backups } from "../../electron/main/games/backup";
import { detectRunningWindows, gameExecutables, parseTasklist, type ProcView } from "../../electron/main/games/running";
import { findSteamInstalls, listSteamGames, refreshWindowsSteamPath, steamPathIn, windowsSteamRoots } from "../../electron/main/games/steam";
import { parseEpicManifest, parseGogRegistry, readEpicGames, readGogGames, storeKey } from "../../electron/main/games/windowsStores";
import { actionUrl } from "../../electron/main/games/actions";
import { applyFixes, idHash, scan, steamKeyMoves, withoutOurPreferSdl } from "../../electron/main/games/games";
import { LibraryStore, LIBRARY_FILE } from "../../electron/main/games/libraryStore";
import {
  heroicExeIn,
  launcherControl,
  steamExeIn,
  steamAppRunning,
  taskkillArgs,
  windowsReopenPlan,
  withLaunchersClosed,
  type LauncherControl,
  type ProcLayer,
} from "../../electron/main/games/processes";
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

  // B1 (0.9.5 bug hunt): the registry's SteamPath is lowercase and Program
  // Files' isn't; realpathSync kept the case, so every game was listed twice
  // under two keys, and a profile or rating on the second tile might never apply.
  it("finds one Steam for two spellings of its folder, keyed by the folder's own spelling", () => {
    const root = mkdtempSync(join(tmpdir(), "steam-case-"));
    mkdirSync(join(root, "config"), { recursive: true });
    writeFileSync(join(root, "config", "config.vdf"), '"InstallConfigStore" { }');
    const upper = root.toUpperCase();
    // Windows: both spellings are the same folder; realpath.native answers with its own spelling.
    const winPaths = {
      real: (p: string) => {
        if (p.toLowerCase() !== root.toLowerCase()) throw new Error("ENOENT");
        return root;
      },
      asBefore: (p: string) => p, // the realpath older apps used keeps the spelling it's given
    };
    for (const order of [
      [upper, root],
      [root, upper],
    ]) {
      const installs = findSteamInstalls("C:/Users/x", "win32", () => order, winPaths);
      expect(installs).toHaveLength(1);
      expect(installs[0].root).toBe(root);
      expect(installs[0].oldRoots).toEqual([upper]);
      expect(steamKeyMoves(installs)).toEqual([{ from: `steam-${idHash(upper)}`, to: `steam-${idHash(root)}` }]);
    }
    // Linux: unchanged (no older spellings).
    expect(findSteamInstalls("/nowhere", "linux")).toEqual([]);
  });

  it("moves library entries from the second copy's key, merged, once", () => {
    const dir = mkdtempSync(join(tmpdir(), "lib-move-"));
    const from = `steam-${idHash("C:\\PROGRAM FILES (X86)\\STEAM")}`;
    const to = `steam-${idHash("C:\\Program Files (x86)\\Steam")}`;
    const settings = (hapticsGain: number) => ({ format: 2 as const, hapticsGain });
    const store = new LibraryStore(dir);
    // Only on the second copy: moves as it is.
    store.setProfile(`${from}:steam:10`, "Only Old", settings(2));
    // On both: the newer profile, the newer stamp's rating and sheet, both notes, HDR on.
    store.setMine(`${from}:steam:20`, "Both", { rating: 2, ratedOn: { app: "0.9.5-dev.18", at: 200 }, notes: "old tile", hdr: true });
    store.setMine(`${to}:steam:20`, "Both", { rating: 4, ratedOn: { app: "0.9.5-dev.18", at: 100 }, notes: "kept tile", report: { schemaVersion: 1, results: { speaker: { result: "pass" } } } });
    store.setProfile(`${to}:steam:20`, "Both", settings(3));
    store.setRestore({ gameKey: `${from}:steam:20`, settings: settings(1) });
    // Not a Steam key of this folder: untouched.
    store.setMine(`steam-0badc0de:steam:30`, "Other", { rating: 5 });

    expect(store.moveKeys([{ from, to }])).toBe(true);
    const lib = JSON.parse(readFileSync(join(dir, LIBRARY_FILE), "utf8"));
    expect(Object.keys(lib.games).sort()).toEqual(["steam-0badc0de:steam:30", `${to}:steam:10`, `${to}:steam:20`].sort());
    expect(lib.games[`${to}:steam:10`].profile.settings).toEqual(settings(2));
    const both = lib.games[`${to}:steam:20`];
    expect(both.profile.settings).toEqual(settings(3));
    expect(both.mine).toEqual({
      rating: 2,
      ratedOn: { app: "0.9.5-dev.18", at: 200 },
      report: { schemaVersion: 1, results: { speaker: { result: "pass" } } },
      notes: "kept tile\n\nold tile",
      hdr: true,
    });
    expect(lib.restore.gameKey).toBe(`${to}:steam:20`);
    // Once: a second start finds nothing left to move and writes nothing.
    expect(store.moveKeys([{ from, to }])).toBe(false);
    expect(new LibraryStore(dir).get()).toEqual(lib);
  });

  // B3 (0.9.5 bug hunt): reg.exe ran blocking on the main thread several
  // times per scan, Play and Steam restart (50-100 ms each).
  it("reads Steam's registry folder once, in the background, and reuses it", async () => {
    expect(steamPathIn("\r\nHKEY_CURRENT_USER\\Software\\Valve\\Steam\r\n    SteamPath    REG_SZ    c:/program files (x86)/steam\r\n")).toBe("c:\\program files (x86)\\steam");
    expect(steamPathIn("ERROR: The system was unable to find the specified registry key or value.")).toBeNull();
    let asked = 0;
    await refreshWindowsSteamPath(() => {
      asked++;
      return Promise.resolve("D:\\Steam");
    });
    // Every look in between (the scan's three, Play, a restart) reuses the one answer.
    expect(windowsSteamRoots()[0]).toBe("D:\\Steam");
    expect(windowsSteamRoots()[0]).toBe("D:\\Steam");
    expect(asked).toBe(1);
    await refreshWindowsSteamPath(() => Promise.resolve(null));
    expect(windowsSteamRoots()).not.toContain("D:\\Steam");
    // No blocking child process left in the Steam module.
    expect(readFileSync(new URL("../../electron/main/games/steam.ts", import.meta.url), "utf8")).not.toMatch(/execFileSync|spawnSync/);
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

  it("reads tasklist's CSV", () => {
    const csv = '"System Idle Process","0","Services","0","8 K"\r\n"B.EXE","4321","Console","1","120,000 K"\r\n\r\nINFO: junk\r\n';
    expect(parseTasklist(csv)).toEqual([
      { pid: 0, comm: "System Idle Process", args: [], cwd: null, env: {} },
      { pid: 4321, comm: "B.EXE", args: [], cwd: null, env: {} },
    ]);
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

// ---- Closing and reopening launchers on Windows ----

const winProc = (pid: number, comm: string): ProcView => ({ pid, comm, args: [], cwd: null, env: {} });
const STEAM_EXE = "C:\\Program Files (x86)\\Steam\\steam.exe";
const HEROIC_EXE = "C:\\Users\\x\\AppData\\Local\\Programs\\heroic\\Heroic.exe";

// A fake Windows system: tasklist's names, Steam's RunningAppID / the
// library's running game, and every command the control runs, in order.
function winLayer(procs: () => ProcView[], o: { game?: boolean; steamExe?: string | null; heroicExe?: string | null } = {}) {
  const calls: string[] = [];
  const layer: ProcLayer = {
    list: async () => procs(),
    env: () => undefined,
    exists: () => true,
    run: (cmd, args) => calls.push(`run ${[cmd, ...args].join(" ")}`),
    start: async (cmd, args) => (calls.push(`start ${[cmd, ...args].join(" ")}`), true),
    signal: (pid) => calls.push(`signal ${pid}`),
    sleep: async () => undefined,
    windows: {
      steamExe: () => (o.steamExe === undefined ? STEAM_EXE : o.steamExe),
      heroicExe: () => (o.heroicExe === undefined ? HEROIC_EXE : o.heroicExe),
      gameRunning: async () => !!o.game,
    },
  };
  return { layer, calls };
}

describe("closing and reopening launchers on Windows", () => {
  const steamProcs = [winProc(10, "steam.exe"), winProc(11, "steamwebhelper.exe"), winProc(12, "explorer.exe")];
  const heroicProcs = [winProc(20, "Heroic.exe"), winProc(21, "Heroic.exe")];

  it("sees Steam and Heroic in tasklist's names", async () => {
    const { layer } = winLayer(() => [...steamProcs, ...heroicProcs]);
    expect([...(await launcherControl(layer).running())].sort()).toEqual(["heroic", "steam"]);
    expect([...(await launcherControl(winLayer(() => [winProc(1, "explorer.exe")]).layer).running())]).toEqual([]);
  });

  it("asks Steam to shut down by its own steam.exe and waits for it to exit", async () => {
    let alive = 3;
    const { layer, calls } = winLayer(() => (alive-- > 0 ? steamProcs : []));
    expect(await launcherControl(layer).close("steam")).toBe("closed");
    expect(calls).toEqual([`run ${STEAM_EXE} -shutdown`]);
  });

  it("asks every Heroic process to close (taskkill without /F) and waits", async () => {
    let alive = 2;
    const { layer, calls } = winLayer(() => (alive-- > 0 ? heroicProcs : []));
    expect(await launcherControl(layer).close("heroic")).toBe("closed");
    expect(calls).toEqual(["signal 20", "signal 21"]);
    expect(taskkillArgs(20)).toEqual(["/PID", "20"]);
  });

  it("gives up after the same timeout, never killing it", async () => {
    const { layer, calls } = winLayer(() => steamProcs);
    expect(await launcherControl(layer, 2000).close("steam")).toBe("timeout");
    expect(calls).toEqual([`run ${STEAM_EXE} -shutdown`]);
  });

  it("refuses while a game runs, without closing anything", async () => {
    const { layer, calls } = winLayer(() => steamProcs, { game: true });
    const control = launcherControl(layer);
    expect(await control.close("steam")).toBe("game-running");
    const run = await withLaunchersClosed(["steam"], control, () => "written");
    expect(run).toEqual({ ok: false, problem: "game-running", launcher: "steam" });
    expect(calls).toEqual([]);
  });

  it("fails instead of guessing when Steam's program isn't found", async () => {
    const { layer, calls } = winLayer(() => steamProcs, { steamExe: null });
    expect(await launcherControl(layer).close("steam")).toBe("failed");
    expect(calls).toEqual([]);
  });

  it("starts each launcher again by its own program, after the change", async () => {
    let procs = [...steamProcs, ...heroicProcs];
    const { layer, calls } = winLayer(() => procs);
    // Closing works once the launchers are gone.
    layer.run = (cmd, args) => (calls.push(`run ${[cmd, ...args].join(" ")}`), (procs = procs.filter((p) => !p.comm.startsWith("steam"))));
    layer.signal = (pid) => (calls.push(`signal ${pid}`), (procs = procs.filter((p) => p.pid !== pid)));
    const run = await withLaunchersClosed(["steam", "heroic"], launcherControl(layer), () => (calls.push("write"), "written"));
    expect(run).toEqual({ ok: true, value: "written", reopenFailed: [] });
    expect(calls).toEqual([`run ${STEAM_EXE} -shutdown`, "signal 20", "signal 21", "write", `start ${STEAM_EXE}`, `start ${HEROIC_EXE}`]);
  });

  it("plans a reopen only for a running launcher whose program is found", () => {
    const win = winLayer(() => []).layer.windows!;
    expect(windowsReopenPlan("steam", steamProcs, win)).toEqual({ cmd: STEAM_EXE, args: [] });
    expect(windowsReopenPlan("heroic", heroicProcs, win)).toEqual({ cmd: HEROIC_EXE, args: [] });
    expect(windowsReopenPlan("heroic", steamProcs, win)).toBeNull();
    expect(windowsReopenPlan("heroic", heroicProcs, { ...win, heroicExe: () => null })).toBeNull();
  });

  it("reads Steam's running game and finds Heroic's installed program", () => {
    expect(steamAppRunning("\r\nHKEY_CURRENT_USER\\Software\\Valve\\Steam\r\n    RunningAppID    REG_DWORD    0x0\r\n")).toBe(false);
    expect(steamAppRunning("    RunningAppID    REG_DWORD    0x1159e0\r\n")).toBe(true);
    expect(steamAppRunning("ERROR: The system was unable to find the specified registry key or value.")).toBe(false);
    const env = { LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local", ProgramFiles: "C:\\Program Files" };
    expect(heroicExeIn(env, (p) => p.startsWith("C:\\Program Files"))).toBe(join("C:\\Program Files", "Heroic", "Heroic.exe"));
    expect(heroicExeIn(env, () => false)).toBeNull();
    expect(steamExeIn(["C:\\Steam", "D:\\Steam"], (p) => p.startsWith("D:"))).toBe(join("D:\\Steam", "steam.exe"));
    expect(steamExeIn([], () => true)).toBeNull();
  });
});

// ---- The standard-gamepad fix is Proton only ----

describe("the standard-gamepad fix on Windows", () => {
  let real: NodeJS.Platform;
  let home: string;
  let backups: Backups;
  const saved = { x86: process.env["ProgramFiles(x86)"], pf: process.env.ProgramFiles };
  const steamRoot = () => join(home, "pf", "Steam");
  const localconfig = () => join(steamRoot(), "userdata", "1", "config", "localconfig.vdf");
  const options = (id: string, opts: string) => `\t\t\t\t\t"${id}"\n\t\t\t\t\t{\n\t\t\t\t\t\t"LaunchOptions"\t\t"${opts}"\n\t\t\t\t\t}\n`;

  beforeEach(() => {
    real = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    home = realpathSync(mkdtempSync(join(tmpdir(), "ds5-win-xinput-")));
    backups = new Backups(join(home, "backups"));
    // Steam's install folder comes from Program Files here (no registry on the test machine).
    process.env["ProgramFiles(x86)"] = join(home, "pf");
    delete process.env.ProgramFiles;
    const steam = steamRoot();
    const w = (path: string, text: string) => (mkdirSync(join(path, ".."), { recursive: true }), writeFileSync(path, text));
    w(join(steam, "config", "config.vdf"), '"InstallConfigStore"\n{\n}\n');
    // Ghostrunner (XInput-only, Steam Input off): earlier versions put the option in
    // front; Hades (marked "controller not detected"): the same on empty options;
    // Control: the player's own options with the variable elsewhere.
    w(
      localconfig(),
      `"UserLocalConfigStore"\n{\n\t"Software"\n\t{\n\t\t"Valve"\n\t\t{\n\t\t\t"Steam"\n\t\t\t{\n\t\t\t\t"apps"\n\t\t\t\t{\n${options("1139900", "PROTON_PREFER_SDL=1 %command% -dx11")}${options("1145360", "PROTON_PREFER_SDL=1 %command%")}${options("870780", "-windowed PROTON_PREFER_SDL=1")}\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n\t"apps"\n\t{\n\t\t"1139900"\n\t\t{\n\t\t\t"UseSteamControllerConfig"\t\t"0"\n\t\t}\n\t\t"1145360"\n\t\t{\n\t\t\t"UseSteamControllerConfig"\t\t"0"\n\t\t}\n\t}\n}\n`,
    );
    w(join(steam, "steamapps", "libraryfolders.vdf"), `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steam}"\n\t}\n}\n`);
    for (const [id, name] of [
      ["1139900", "Ghostrunner"],
      ["1145360", "Hades"],
      ["870780", "Control Ultimate Edition"],
    ])
      w(join(steam, "steamapps", `appmanifest_${id}.acf`), `"AppState"\n{\n\t"appid"\t\t"${id}"\n\t"name"\t\t"${name}"\n}\n`);
  });
  afterEach(() => {
    Object.defineProperty(process, "platform", { value: real, configurable: true });
    for (const [key, value] of [
      ["ProgramFiles(x86)", saved.x86],
      ["ProgramFiles", saved.pf],
    ] as const)
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    rmSync(home, { recursive: true, force: true });
  });

  const scanNow = () => scan({ home, ourProton: null, latestProton: null, latestSize: null, running: new Set(), audioCards: [], notDetected: new Set([`steam-${idHash(steamRoot())}:steam:1145360`]) });
  const noControl: LauncherControl = { running: () => new Set(), gameRunning: () => false, plan: () => null, close: async () => "not-running", reopen: async () => true };

  it("is never offered, for listed or marked games", () => {
    const { report } = scanNow();
    const fixes = report.games.flatMap((g) => g.fixes);
    expect(fixes.filter((f) => f.kind === "standard-gamepad")).toEqual([]);
    expect(report.games.every((g) => g.gamepad === undefined)).toBe(true);
  });

  it("offers to take out the option earlier versions added, recommended and undoable", async () => {
    const before = readFileSync(localconfig(), "utf8");
    const fresh = scanNow();
    const cleanups = fresh.report.games.flatMap((g) => g.fixes).filter((f) => f.kind === "remove-env");
    const prefix = `steam-${idHash(realpathSync.native(steamRoot()))}`;
    expect(cleanups.map((f) => [f.id, f.recommended])).toEqual([
      [`${prefix}:env:1139900`, true],
      [`${prefix}:env:1145360`, true],
    ]);
    expect(cleanups[0].why).toEqual({ key: "why.preferSdlWindows", params: { vars: "PROTON_PREFER_SDL", options: "%command% -dx11" } });
    expect(cleanups[1].why).toEqual({ key: "why.preferSdlWindows", params: { vars: "PROTON_PREFER_SDL", options: { key: "fallback.empty" } } });
    const r = await applyFixes(
      fresh,
      cleanups.map((f) => f.id),
      [],
      { backups, launchers: noControl, restartWirePlumber: async () => undefined, setCardProfile: async () => undefined },
    );
    expect(r.applied.every((a) => a.ok)).toBe(true);
    const after = readFileSync(localconfig(), "utf8");
    expect(after).toContain('"1139900"\n\t\t\t\t\t{\n\t\t\t\t\t\t"LaunchOptions"\t\t"%command% -dx11"');
    expect(after).toContain('"1145360"\n\t\t\t\t\t{\n\t\t\t\t\t\t"LaunchOptions"\t\t""');
    // The player's own options are never touched.
    expect(after).toContain('"LaunchOptions"\t\t"-windowed PROTON_PREFER_SDL=1"');
    expect(scanNow().report.games.flatMap((g) => g.fixes)).toEqual([]);
    backups.restore(r.backupId!);
    expect(readFileSync(localconfig(), "utf8")).toBe(before);
  });

  it("takes out only what it put in front", () => {
    expect(withoutOurPreferSdl("PROTON_PREFER_SDL=1 gamemoderun %command%")).toBe("gamemoderun %command%");
    expect(withoutOurPreferSdl("PROTON_PREFER_SDL=1 %command%")).toBe("");
    expect(withoutOurPreferSdl("-x PROTON_PREFER_SDL=1 %command%")).toBe("-x PROTON_PREFER_SDL=1 %command%");
  });
});
