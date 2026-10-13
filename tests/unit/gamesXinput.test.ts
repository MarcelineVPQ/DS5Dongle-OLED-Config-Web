// "Controller as a standard gamepad (XInput)": PROTON_PREFER_SDL=1 per game for
// XInput-only games, the Proton builds that honour it, each launcher's config
// writer with Undo, and the one close-and-reopen sequence for running launchers.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Backups } from "../../electron/main/games/backup";
import { applyFixes, gamepadPlan, idHash, scan, withPreferSdl, type ScanDeps } from "../../electron/main/games/games";
import { launcherControl, reopenPlan, withLaunchersClosed, type CloseLauncherResult, type LauncherControl, type ProcLayer } from "../../electron/main/games/processes";
import { honoursPreferSdl, preferSdlBuild } from "../../electron/main/games/proton";
import type { ProcView } from "../../electron/main/games/running";
import { ApplyRequestSchema } from "../../electron/main/ipc";
import type { LauncherId } from "../../src/desktop/games/types";
import { asLinux } from "../support/platform";

asLinux();

const OLD = "GE-Proton11-7-DualSense"; // ignores PROTON_PREFER_SDL
const FIXED = "GE-Proton11-7.2-DualSense"; // honours it

function write(path: string, text: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}
const proton = (dir: string, name: string, version = `1791920210 ${name}`) => {
  write(join(dir, name, "proton"), "");
  write(join(dir, name, "version"), version);
};

// Steam: Ghostrunner (Steam Input off, own options, our old build), Control
// (Steam Input on), Hades (not on our list). Heroic: Ghostrunner on the old
// build. Lutris: Control with its own environment.
let home: string;
let backups: Backups;
const steamRoot = () => join(home, ".steam/debian-installation");
const localconfig = () => join(steamRoot(), "userdata/1/config/localconfig.vdf");
const configVdf = () => join(steamRoot(), "config/config.vdf");
const heroicGame = () => join(home, ".config/heroic/GamesConfig/ghost.json");
const lutrisGame = () => join(home, ".local/share/lutris/games/control-1.yml");
const steamId = () => `steam-${idHash(steamRoot())}`;
const heroicId = () => `heroic-${idHash(join(home, ".config/heroic"))}`;
const lutrisId = () => `lutris-${idHash(join(home, ".local/share/lutris"))}`;

function buildHome(withFixed: boolean) {
  const steam = steamRoot();
  const mapping = (id: string, name: string) => `\t\t\t\t\t"${id}"\n\t\t\t\t\t{\n\t\t\t\t\t\t"name"\t\t"${name}"\n\t\t\t\t\t\t"config"\t\t""\n\t\t\t\t\t\t"priority"\t\t"250"\n\t\t\t\t\t}\n`;
  write(
    configVdf(),
    `"InstallConfigStore"\n{\n\t"Software"\n\t{\n\t\t"Valve"\n\t\t{\n\t\t\t"Steam"\n\t\t\t{\n\t\t\t\t"CompatToolMapping"\n\t\t\t\t{\n${mapping("0", OLD)}${mapping("1139900", OLD)}\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n}\n`,
  );
  write(
    localconfig(),
    `"UserLocalConfigStore"\n{\n\t"Software"\n\t{\n\t\t"Valve"\n\t\t{\n\t\t\t"Steam"\n\t\t\t{\n\t\t\t\t"apps"\n\t\t\t\t{\n\t\t\t\t\t"1139900"\n\t\t\t\t\t{\n\t\t\t\t\t\t"LaunchOptions"\t\t"gamemoderun %command% -dx11"\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n\t"apps"\n\t{\n\t\t"1139900"\n\t\t{\n\t\t\t"UseSteamControllerConfig"\t\t"0"\n\t\t}\n\t\t"870780"\n\t\t{\n\t\t\t"UseSteamControllerConfig"\t\t"2"\n\t\t}\n\t\t"1145360"\n\t\t{\n\t\t\t"UseSteamControllerConfig"\t\t"0"\n\t\t}\n\t}\n}\n`,
  );
  write(join(steam, "steamapps/libraryfolders.vdf"), `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steam}"\n\t}\n}\n`);
  const acf = (id: string, name: string) => write(join(steam, `steamapps/appmanifest_${id}.acf`), `"AppState"\n{\n\t"appid"\t\t"${id}"\n\t"name"\t\t"${name}"\n}\n`);
  acf("1139900", "Ghostrunner");
  acf("870780", "Control Ultimate Edition");
  acf("1145360", "Hades");
  const tools = join(steam, "compatibilitytools.d");
  proton(tools, OLD, "1791920210 GE-Proton11-7");
  proton(tools, "GE-Proton10-34");
  if (withFixed) proton(tools, FIXED);

  const heroic = join(home, ".config/heroic");
  const htools = join(heroic, "tools/proton");
  write(join(heroic, "config.json"), JSON.stringify({ defaultSettings: {} }));
  proton(htools, OLD, "1791920210 GE-Proton11-7");
  if (withFixed) proton(htools, FIXED);
  proton(htools, "GE-Proton10-34");
  write(join(heroic, "sideload_apps/library.json"), JSON.stringify({ games: [{ app_name: "ghost", title: "Ghostrunner", is_installed: true, install: { platform: "windows" } }] }));
  write(
    heroicGame(),
    JSON.stringify({ ghost: { wineVersion: { bin: join(htools, OLD, "proton"), name: OLD, type: "proton" }, enviromentOptions: [{ key: "DXVK_HUD", value: "fps" }] }, version: "v0" }, null, 2),
  );

  const lutris = join(home, ".local/share/lutris");
  write(join(lutris, "runners/wine.yml"), "wine:\n  version: GE-Proton10-34\n");
  write(join(lutris, "runtime/umu/umu-run"), "");
  write(lutrisGame(), "game:\n  exe: control.exe\nsystem:\n  env:\n    DXVK_HUD: fps\nwine:\n  version: GE-Proton10-34\n");
  const db = new DatabaseSync(join(lutris, "pga.db"));
  db.exec("CREATE TABLE games (slug TEXT, name TEXT, runner TEXT, installed INTEGER, configpath TEXT)");
  db.exec("INSERT INTO games VALUES ('control', 'Control', 'wine', 1, 'control-1')");
  db.close();
}

const deps = (o: { running?: LauncherId[]; notDetected?: string[]; ours?: string } = {}): ScanDeps => ({
  home,
  ourProton: o.ours ?? OLD,
  latestProton: null,
  latestSize: null,
  running: new Set(o.running ?? []),
  audioCards: [],
  notDetected: new Set(o.notDetected ?? []),
});

// A fake process layer: which launchers run, whether a game runs, what
// closing returns; it records every close and reopen in order.
function fakeControl(o: { running?: LauncherId[]; game?: boolean; close?: Partial<Record<LauncherId, CloseLauncherResult>>; onReopen?: () => void } = {}) {
  const log: string[] = [];
  const running = new Set(o.running ?? []);
  const ctl: LauncherControl = {
    running: () => new Set(running),
    gameRunning: () => !!o.game,
    plan: (l) => ({ cmd: l, args: [] }),
    close: async (l) => {
      log.push(`close ${l}`);
      const r = o.close?.[l] ?? "closed";
      if (r === "closed") running.delete(l);
      return r;
    },
    reopen: async (plan) => {
      o.onReopen?.();
      log.push(`reopen ${plan.cmd}`);
      running.add(plan.cmd as LauncherId);
      return true;
    },
  };
  return { ctl, log };
}
const applyDeps = (ctl: LauncherControl) => ({ backups, launchers: ctl, restartWirePlumber: async () => undefined, setCardProfile: async () => undefined });
const read = (path: string) => readFileSync(path, "utf8");

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "ds5-xinput-")));
  backups = new Backups(join(home, "backups"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("which Proton builds honour PROTON_PREFER_SDL", () => {
  it("our builds only from the .2 rebuild on (name or version file); stock always", () => {
    expect(honoursPreferSdl(OLD)).toBe(false);
    expect(honoursPreferSdl(OLD, "1791920210 GE-Proton11-7")).toBe(false);
    expect(honoursPreferSdl(FIXED)).toBe(true);
    expect(honoursPreferSdl("GE-Proton11-10.3-DualSense")).toBe(true);
    expect(honoursPreferSdl("GE-Proton11-10-DualSense")).toBe(false); // a new GE version, not yet rebuilt
    expect(honoursPreferSdl(OLD, `1791920210 ${FIXED}`)).toBe(true); // renamed folder, marked build
    expect(honoursPreferSdl("GE-Proton10-34")).toBe(true);
    expect(honoursPreferSdl("Proton - Experimental")).toBe(true);
  });

  it("moves a game to the newest build that honours it: ours first, else stock GE-Proton", () => {
    const dir = join(home, "tools");
    for (const n of [OLD, FIXED, "GE-Proton10-34", "GE-Proton9-20", "GE-Proton10-20260205-DS5"]) proton(dir, n);
    write(join(dir, OLD, "version"), "1 GE-Proton11-7");
    expect(preferSdlBuild([OLD, FIXED, "GE-Proton10-34", "GE-Proton9-20"], [dir])).toBe(FIXED);
    expect(preferSdlBuild([OLD, "GE-Proton9-20", "GE-Proton10-34", "GE-Proton10-20260205-DS5"], [dir])).toBe("GE-Proton10-34");
    expect(preferSdlBuild([OLD], [dir])).toBeNull();
  });

  it("plans the option and/or the build switch", () => {
    expect(gamepadPlan({ envSet: false, honours: true, target: null })).toEqual({ state: "needed", addEnv: true, switchTo: null });
    expect(gamepadPlan({ envSet: true, honours: false, target: FIXED })).toEqual({ state: "needed", addEnv: false, switchTo: FIXED });
    expect(gamepadPlan({ envSet: true, honours: true, target: FIXED }).state).toBe("set");
    expect(gamepadPlan({ envSet: false, honours: false, target: null }).state).toBe("no-build");
    expect(gamepadPlan({ envSet: false, honours: true, target: null, steamInputOff: false }).state).toBe("steam-input");
  });
});

describe("Steam launch options", () => {
  it("prepends PROTON_PREFER_SDL=1 %command% and keeps the player's options", () => {
    expect(withPreferSdl("")).toBe("PROTON_PREFER_SDL=1 %command%");
    expect(withPreferSdl("gamemoderun %command% -dx11")).toBe("PROTON_PREFER_SDL=1 gamemoderun %command% -dx11");
    expect(withPreferSdl("-dx11 -skipintro")).toBe("PROTON_PREFER_SDL=1 %command% -dx11 -skipintro");
    expect(withPreferSdl("PROTON_PREFER_SDL=0 DXVK_HUD=1 %command%")).toBe("PROTON_PREFER_SDL=1 DXVK_HUD=1 %command%");
  });
});

describe("the standard-gamepad fix per launcher", () => {
  it("is recommended for every installed XInput game that lacks it, and only where it helps", () => {
    buildHome(true);
    const { report, plan } = scan(deps());
    const byTitle = (launcher: string, title: string) => report.games.find((g) => g.launcher === launcher && g.title === title)!;
    // Steam Input on: Steam already gives Control an Xbox pad.
    expect(byTitle("steam", "Control Ultimate Edition")).toMatchObject({ gamepad: "steam-input", fixes: [] });
    // Not on our list, not marked: nothing.
    expect(byTitle("steam", "Hades").gamepad).toBeUndefined();
    const xinput = [...plan.values()].filter((p) => p.fix.kind === "standard-gamepad").map((p) => p.fix);
    expect(xinput.map((f) => f.id).sort()).toEqual([`${steamId()}:xinput:1139900`, `${heroicId()}:xinput:ghost`, `${lutrisId()}:xinput:control-1`].sort());
    expect(xinput.every((f) => f.recommended)).toBe(true);
    expect(ApplyRequestSchema.safeParse({ fixIds: xinput.map((f) => f.id), restart: [] }).success).toBe(true);
  });

  it("Steam: launch options and the runner, Undo restores both", async () => {
    buildHome(true);
    const before = [read(localconfig()), read(configVdf())];
    const fresh = scan(deps());
    const fix = fresh.plan.get(`${steamId()}:xinput:1139900`)!.fix;
    expect(fix.files.sort()).toEqual([configVdf(), localconfig()].sort());
    expect(fix.why).toMatchObject({
      key: "why.gamepadSteam",
      params: { options: "PROTON_PREFER_SDL=1 gamemoderun %command% -dx11", runner: { key: "why.gamepadRunner", params: { current: OLD, proton: FIXED } } },
    });
    const r = await applyFixes(fresh, [fix.id], [], applyDeps(fakeControl().ctl));
    expect(r.applied).toEqual([{ id: fix.id, ok: true, message: undefined }]);
    expect(read(localconfig())).toContain('"LaunchOptions"\t\t"PROTON_PREFER_SDL=1 gamemoderun %command% -dx11"');
    expect(read(configVdf())).toMatch(new RegExp(`"1139900"\\s*\\{\\s*"name"\\s*"${FIXED}"`));
    // Applied: nothing more to offer.
    expect(scan(deps()).report.games.find((g) => g.id === "1139900")!.gamepad).toBe("set");
    backups.restore(r.backupId!);
    expect([read(localconfig()), read(configVdf())]).toEqual(before);
  });

  it("Heroic: adds the variable next to the game's own, switches the runner, Undo restores", async () => {
    buildHome(true);
    const before = read(heroicGame());
    const fresh = scan(deps());
    const id = `${heroicId()}:xinput:ghost`;
    const r = await applyFixes(fresh, [id], [], applyDeps(fakeControl().ctl));
    expect(r.applied[0].ok).toBe(true);
    expect(JSON.parse(read(heroicGame())).ghost).toEqual({
      wineVersion: { bin: join(home, ".config/heroic/tools/proton", FIXED, "proton"), name: FIXED, type: "proton" },
      enviromentOptions: [
        { key: "DXVK_HUD", value: "fps" },
        { key: "PROTON_PREFER_SDL", value: "1" },
      ],
    });
    backups.restore(r.backupId!);
    expect(read(heroicGame())).toBe(before);
  });

  it("Heroic: never moves the game to an older build (GE-Proton10-34 from our 11-7)", () => {
    buildHome(false);
    const game = scan(deps()).report.games.find((g) => g.launcher === "heroic" && g.id === "ghost")!;
    expect(game.gamepad).toBe("no-build");
    expect(game.fixes.filter((f) => f.kind === "standard-gamepad")).toEqual([]);
  });

  it("Lutris: the game's system env, runner kept when it honours the option, Undo restores", async () => {
    buildHome(true);
    const before = read(lutrisGame());
    const fresh = scan(deps());
    const r = await applyFixes(fresh, [`${lutrisId()}:xinput:control-1`], [], applyDeps(fakeControl().ctl));
    expect(r.applied[0].ok).toBe(true);
    expect(read(lutrisGame())).toBe('game:\n  exe: control.exe\nsystem:\n  env:\n    DXVK_HUD: fps\n    PROTON_PREFER_SDL: "1"\nwine:\n  version: GE-Proton10-34\n');
    backups.restore(r.backupId!);
    expect(read(lutrisGame())).toBe(before);
  });

  it('is offered for a game the player marked "controller not detected"', () => {
    buildHome(true);
    const hades = `${steamId()}:steam:1145360`;
    expect(scan(deps()).plan.has(`${steamId()}:xinput:1145360`)).toBe(false);
    const { report, plan } = scan(deps({ notDetected: [hades] }));
    expect(plan.has(`${steamId()}:xinput:1145360`)).toBe(true);
    expect(report.games.find((g) => g.key === hades)!.gamepad).toBe("needed");
  });

  it("says when no installed build honours the option", () => {
    buildHome(false);
    rmSync(join(steamRoot(), "compatibilitytools.d/GE-Proton10-34"), { recursive: true });
    const { report, plan } = scan(deps());
    expect(report.games.find((g) => g.id === "1139900")!.gamepad).toBe("no-build");
    expect(plan.has(`${steamId()}:xinput:1139900`)).toBe(false);
  });
});

describe("closing and reopening a running launcher around the change", () => {
  const steamFix = () => `${steamId()}:xinput:1139900`;

  it("closes Steam, writes, then reopens it", async () => {
    buildHome(true);
    let writtenBeforeReopen = false;
    const { ctl, log } = fakeControl({ running: ["steam"], onReopen: () => (writtenBeforeReopen = read(localconfig()).includes("PROTON_PREFER_SDL")) });
    const r = await applyFixes(scan(deps({ running: ["steam"] })), [steamFix()], ["steam"], applyDeps(ctl));
    expect(r.blockedBy).toEqual([]);
    expect(r.applied[0].ok).toBe(true);
    expect(log).toEqual(["close steam", "reopen steam"]);
    expect(writtenBeforeReopen).toBe(true);
  });

  it("never closes a launcher the page didn't name (it explains first, then asks again)", async () => {
    buildHome(true);
    const before = read(localconfig());
    const { ctl, log } = fakeControl({ running: ["steam"] });
    const r = await applyFixes(scan(deps()), [steamFix()], [], applyDeps(ctl));
    expect(r).toEqual({ applied: [], backupId: null, blockedBy: ["steam"] });
    expect(log).toEqual([]);
    expect(read(localconfig())).toBe(before);
  });

  it("refuses while a game is running, without closing anything", async () => {
    buildHome(true);
    const before = read(localconfig());
    const { ctl, log } = fakeControl({ running: ["steam"], game: true });
    const r = await applyFixes(scan(deps({ running: ["steam"] })), [steamFix()], ["steam"], applyDeps(ctl));
    expect(r).toEqual({ applied: [], backupId: null, blockedBy: ["steam"], problem: "game-running" });
    expect(log).toEqual([]);
    expect(read(localconfig())).toBe(before);
  });

  it("on a timeout writes nothing and reopens what it already closed", async () => {
    buildHome(true);
    const before = [read(localconfig()), read(heroicGame())];
    const { ctl, log } = fakeControl({ running: ["steam", "heroic"], close: { heroic: "timeout" } });
    const r = await applyFixes(scan(deps({ running: ["steam", "heroic"] })), [steamFix(), `${heroicId()}:xinput:ghost`], ["steam", "heroic"], applyDeps(ctl));
    expect(r).toEqual({ applied: [], backupId: null, blockedBy: ["steam", "heroic"], problem: "timeout" });
    expect(log).toEqual(["close steam", "close heroic", "reopen steam"]);
    expect([read(localconfig()), read(heroicGame())]).toEqual(before);
  });

  it("reopens the launcher when the write fails", async () => {
    const { ctl, log } = fakeControl({ running: ["steam"] });
    await expect(
      withLaunchersClosed(["steam"], ctl, () => {
        throw new Error("disk full");
      }),
    ).rejects.toThrow("disk full");
    expect(log).toEqual(["close steam", "reopen steam"]);
  });
});

describe("the real launcher control, on a fake process table", () => {
  const proc = (pid: number, comm: string, args: string[]): ProcView => ({ pid, comm, args, cwd: null, env: {} });
  function layer(procs: () => ProcView[], extra: Partial<ProcLayer> = {}) {
    const calls: string[] = [];
    const l: ProcLayer = {
      list: procs,
      env: () => undefined,
      exists: () => true,
      run: (cmd, args) => calls.push(`run ${[cmd, ...args].join(" ")}`),
      start: async (cmd, args) => (calls.push(`start ${[cmd, ...args].join(" ")}`), true),
      signal: (pid) => calls.push(`signal ${pid}`),
      sleep: async () => undefined,
      ...extra,
    };
    return { l, calls };
  }

  it("asks Steam to shut down with a fixed argv and waits for it to exit", async () => {
    let alive = 3;
    const { l, calls } = layer(() => (alive-- > 0 ? [proc(10, "steam", ["/home/u/.local/share/Steam/ubuntu12_32/steam", "-silent"])] : []));
    expect(await launcherControl(l).close("steam")).toBe("closed");
    expect(calls).toEqual(["run steam -shutdown"]);
  });

  it("gives up after the timeout, never killing it", async () => {
    const { l, calls } = layer(() => [proc(10, "steam", ["/x/steam"])]);
    expect(await launcherControl(l, 2000).close("steam")).toBe("timeout");
    expect(calls).toEqual(["run steam -shutdown"]);
  });

  it("refuses while a game runs", async () => {
    const { l, calls } = layer(() => [proc(10, "steam", ["/x/steam"]), proc(11, "wineserver", [])]);
    expect(await launcherControl(l).close("steam")).toBe("game-running");
    expect(calls).toEqual([]);
  });

  it("starts each launcher again the way it was running", () => {
    const { l } = layer(() => []);
    expect(reopenPlan("steam", [proc(1, "steam", ["/home/u/.local/share/Steam/ubuntu12_32/steam", "-silent", "-srt-logger-opened"])], l)).toEqual({ cmd: "steam", args: ["-silent"] });
    expect(reopenPlan("steam", [proc(1, "steam", ["/home/u/.var/app/com.valvesoftware.Steam/.local/share/Steam/ubuntu12_32/steam"])], l)).toEqual({
      cmd: "flatpak",
      args: ["run", "com.valvesoftware.Steam"],
    });
    expect(reopenPlan("heroic", [proc(1, "heroic", ["/opt/Heroic/heroic"]), proc(2, "heroic", ["/opt/Heroic/heroic", "--type=renderer"])], l)).toEqual({ cmd: "/opt/Heroic/heroic", args: [] });
    expect(reopenPlan("heroic", [proc(1, "heroic", ["/app/bin/heroic/heroic"])], l)).toEqual({ cmd: "flatpak", args: ["run", "com.heroicgameslauncher.hgl"] });
    const appImage = { ...l, env: () => "/home/u/Apps/Heroic-2.18.1-linux-x86_64.AppImage" };
    expect(reopenPlan("heroic", [proc(1, "heroic", ["/tmp/.mount_HeroicAbc/heroic"])], appImage)).toEqual({ cmd: "/home/u/Apps/Heroic-2.18.1-linux-x86_64.AppImage", args: [] });
    expect(reopenPlan("lutris", [proc(1, "python3", ["/usr/bin/python3", "/usr/bin/lutris"])], l)).toEqual({ cmd: "/usr/bin/lutris", args: [] });
    // A path that isn't the launcher: its plain name instead.
    expect(reopenPlan("heroic", [proc(1, "heroic", ["/tmp/.mount_x/heroic"])], l)).toEqual({ cmd: "heroic", args: [] });
  });
});
