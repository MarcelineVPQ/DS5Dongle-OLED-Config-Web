// "Turn on HDR": PROTON_ENABLE_WAYLAND=1 PROTON_ENABLE_HDR=1 per game for HDR
// games, only with an HDR screen (kscreen-doctor on KDE), the Proton builds
// that honour the options, each launcher's writer with the game's other
// options kept, and Undo.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Backups } from "../../electron/main/games/backup";
import { applyFixes, hdrPlan, idHash, scan, withHdr, type ScanDeps } from "../../electron/main/games/games";
import { hdrOutputs, hdrScreens, parseKscreenOutputs } from "../../electron/main/games/hdr";
import type { LauncherControl } from "../../electron/main/games/processes";
import { buildHonoursHdr, dualSenseBuild, hdrBuild, honoursHdr } from "../../electron/main/games/proton";
import { knownHdr } from "../../src/desktop/games/knownGames";
import type { HdrScreens } from "../../src/desktop/games/types";
import { ApplyRequestSchema } from "../../electron/main/ipc";
import { asLinux } from "../support/platform";

asLinux();

const OURS = "GE-Proton11-7.2-DualSense"; // honours HDR and PROTON_PREFER_SDL
const OLD = "GE-Proton11-7-DualSense"; // honours HDR, ignores PROTON_PREFER_SDL
const GE9 = "GE-Proton9-20"; // no HDR options
const GE10 = "GE-Proton10-34";
const SCRIPT_HDR = 'self.check_environment("PROTON_ENABLE_WAYLAND", "wayland")\nself.check_environment("PROTON_ENABLE_HDR", "hdr")\n';
const SCRIPT_OLD = 'self.check_environment("PROTON_USE_WINED3D", "wined3d")\n';

// What `kscreen-doctor -o` prints (colour codes included), trimmed.
const E = "\x1b";
const KSCREEN = [
  `${E}[01;32mOutput: ${E}[0;0m1 HDMI-A-2 dfbf95e5`,
  `\t${E}[01;32menabled${E}[0;0m`,
  `\t${E}[01;32mconnected${E}[0;0m`,
  `${E}[01;33m\tHDR: ${E}[0;0mincapable`,
  `${E}[01;32mOutput: ${E}[0;0m2 DP-5 e527803b`,
  `\t${E}[01;32menabled${E}[0;0m`,
  `\t${E}[01;32mconnected${E}[0;0m`,
  `${E}[01;33m\tHDR: ${E}[0;0menabled`,
  `${E}[01;33m\t\tSDR brightness: ${E}[0;0m1000 nits`,
  `${E}[01;33m\tWide Color Gamut: ${E}[0;0menabled`,
  `${E}[01;32mOutput: ${E}[0;0m3 DP-6 0000`,
  `\t${E}[01;32menabled${E}[0;0m`,
  `\t${E}[01;32mconnected${E}[0;0m`,
  `${E}[01;33m\tHDR: ${E}[0;0mdisabled`,
  `${E}[01;32mOutput: ${E}[0;0m4 DP-7 1111`,
  `\t${E}[01;31mdisabled${E}[0;0m`,
  `\t${E}[01;31mdisconnected${E}[0;0m`,
  `${E}[01;33m\tHDR: ${E}[0;0menabled`,
  "",
].join("\n");

function write(path: string, text: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}
const proton = (dir: string, name: string, script = SCRIPT_HDR, version = `1791920210 ${name}`) => {
  write(join(dir, name, "proton"), script);
  write(join(dir, name, "version"), version);
};

let home: string;
let backups: Backups;
const steamRoot = () => join(home, ".steam/debian-installation");
const localconfig = () => join(steamRoot(), "userdata/1/config/localconfig.vdf");
const configVdf = () => join(steamRoot(), "config/config.vdf");
const heroicGame = () => join(home, ".config/heroic/GamesConfig/cp.json");
const lutrisGame = () => join(home, ".local/share/lutris/games/hogwarts-1.yml");
const steamId = () => `steam-${idHash(steamRoot())}`;
const heroicId = () => `heroic-${idHash(join(home, ".config/heroic"))}`;
const lutrisId = () => `lutris-${idHash(join(home, ".local/share/lutris"))}`;

// Steam: Indiana Jones (on our list, set to GE-Proton 9: moves), Ghostrunner
// (XInput, marked HDR by the player in tests, our old build, own options),
// Hades (follows Steam's default Valve Proton), Cyberpunk (HDR already on).
// Heroic: Cyberpunk on GE-Proton 9 with its own variable. Lutris: Hogwarts
// Legacy on GE-Proton 10 with its own variable.
function buildHome() {
  const steam = steamRoot();
  const mapping = (id: string, name: string) => `\t\t\t\t\t"${id}"\n\t\t\t\t\t{\n\t\t\t\t\t\t"name"\t\t"${name}"\n\t\t\t\t\t\t"config"\t\t""\n\t\t\t\t\t\t"priority"\t\t"250"\n\t\t\t\t\t}\n`;
  write(
    configVdf(),
    `"InstallConfigStore"\n{\n\t"Software"\n\t{\n\t\t"Valve"\n\t\t{\n\t\t\t"Steam"\n\t\t\t{\n\t\t\t\t"CompatToolMapping"\n\t\t\t\t{\n${mapping("0", "proton_9")}${mapping("2677660", GE9)}${mapping("1139900", OLD)}${mapping("1091500", OURS)}\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n}\n`,
  );
  const opts = (id: string, value: string) => `\t\t\t\t\t"${id}"\n\t\t\t\t\t{\n\t\t\t\t\t\t"LaunchOptions"\t\t"${value}"\n\t\t\t\t\t}\n`;
  write(
    localconfig(),
    `"UserLocalConfigStore"\n{\n\t"Software"\n\t{\n\t\t"Valve"\n\t\t{\n\t\t\t"Steam"\n\t\t\t{\n\t\t\t\t"apps"\n\t\t\t\t{\n${opts("2677660", "gamemoderun %command%")}${opts("1139900", "-dx11")}${opts("1091500", "PROTON_ENABLE_HDR=1 PROTON_ENABLE_WAYLAND=1 %command%")}\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n\t"apps"\n\t{\n\t\t"1139900"\n\t\t{\n\t\t\t"UseSteamControllerConfig"\t\t"0"\n\t\t}\n\t}\n}\n`,
  );
  write(join(steam, "steamapps/libraryfolders.vdf"), `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steam}"\n\t}\n}\n`);
  const acf = (id: string, name: string) => write(join(steam, `steamapps/appmanifest_${id}.acf`), `"AppState"\n{\n\t"appid"\t\t"${id}"\n\t"name"\t\t"${name}"\n}\n`);
  acf("2677660", "Indiana Jones and the Great Circle");
  acf("1139900", "Ghostrunner");
  acf("1145360", "Hades");
  acf("1091500", "Cyberpunk 2077");
  const tools = join(steam, "compatibilitytools.d");
  proton(tools, OURS);
  proton(tools, OLD, SCRIPT_HDR, "1791920210 GE-Proton11-7");
  proton(tools, GE9, SCRIPT_OLD);
  proton(tools, GE10);

  const heroic = join(home, ".config/heroic");
  const htools = join(heroic, "tools/proton");
  write(join(heroic, "config.json"), JSON.stringify({ defaultSettings: {} }));
  proton(htools, OURS);
  proton(htools, GE9, SCRIPT_OLD);
  write(join(heroic, "sideload_apps/library.json"), JSON.stringify({ games: [{ app_name: "cp", title: "Cyberpunk 2077", is_installed: true, install: { platform: "windows" } }] }));
  write(
    heroicGame(),
    JSON.stringify({ cp: { wineVersion: { bin: join(htools, GE9, "proton"), name: GE9, type: "proton" }, enviromentOptions: [{ key: "DXVK_HUD", value: "fps" }] }, version: "v0" }, null, 2),
  );

  const lutris = join(home, ".local/share/lutris");
  write(join(lutris, "runners/wine.yml"), `wine:\n  version: ${GE10}\n`);
  write(join(lutris, "runtime/umu/umu-run"), "");
  write(lutrisGame(), `game:\n  exe: hogwarts.exe\nsystem:\n  env:\n    DXVK_HUD: fps\nwine:\n  version: ${GE10}\n`);
  const db = new DatabaseSync(join(lutris, "pga.db"));
  db.exec("CREATE TABLE games (slug TEXT, name TEXT, runner TEXT, installed INTEGER, configpath TEXT)");
  db.exec("INSERT INTO games VALUES ('hogwarts-legacy', 'Hogwarts Legacy', 'wine', 1, 'hogwarts-1')");
  db.close();
}

const ON: HdrScreens = { check: "kde", outputs: ["DP-5"] };
const deps = (o: { hdr?: HdrScreens; marked?: string[]; notDetected?: string[] } = {}): ScanDeps => ({
  home,
  ourProton: OURS,
  latestProton: null,
  latestSize: null,
  running: new Set(),
  audioCards: [],
  notDetected: new Set(o.notDetected ?? []),
  hdrMarked: new Set(o.marked ?? []),
  hdr: o.hdr ?? ON,
});
const control: LauncherControl = { running: () => new Set(), gameRunning: () => false, plan: () => null, close: async () => "closed", reopen: async () => true };
const applyDeps = { backups: undefined as unknown as Backups, launchers: control, restartWirePlumber: async () => undefined, setCardProfile: async () => undefined };
const apply = (ids: string[], d = deps()) => applyFixes(scan(d), ids, [], { ...applyDeps, backups });
const read = (path: string) => readFileSync(path, "utf8");
const ghost = () => `${steamId()}:steam:1139900`;
const hades = () => `${steamId()}:steam:1145360`;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "ds5-hdr-")));
  backups = new Backups(join(home, "backups"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("HDR screens (kscreen-doctor)", () => {
  it("reads each output's state through the colour codes", () => {
    expect(parseKscreenOutputs(KSCREEN)).toEqual([
      { name: "HDMI-A-2", enabled: true, connected: true, hdr: "incapable" },
      { name: "DP-5", enabled: true, connected: true, hdr: "enabled" },
      { name: "DP-6", enabled: true, connected: true, hdr: "disabled" },
      { name: "DP-7", enabled: false, connected: false, hdr: "enabled" },
    ]);
    // Only connected, enabled screens with HDR on.
    expect(hdrOutputs(KSCREEN)).toEqual(["DP-5"]);
    expect(hdrOutputs("")).toEqual([]);
    expect(hdrOutputs("garbage\nOutput:\n")).toEqual([]);
  });

  it("runs kscreen-doctor -o only on KDE Plasma under Wayland, fixed argv with a timeout", async () => {
    const calls: Array<{ cmd: string; args: string[]; timeout: number }> = [];
    const exec = async (cmd: string, args: string[], opts: { timeout: number }) => (calls.push({ cmd, args, timeout: opts.timeout }), { stdout: KSCREEN });
    const kde = { WAYLAND_DISPLAY: "wayland-0", XDG_CURRENT_DESKTOP: "KDE" };
    expect(await hdrScreens(kde, exec)).toEqual({ check: "kde", outputs: ["DP-5"] });
    expect(calls).toEqual([{ cmd: "kscreen-doctor", args: ["-o"], timeout: 5000 }]);
    expect(await hdrScreens({ XDG_SESSION_TYPE: "x11", XDG_CURRENT_DESKTOP: "KDE" }, exec)).toEqual({ check: "x11", outputs: [] });
    expect(await hdrScreens({ WAYLAND_DISPLAY: "wayland-0", XDG_CURRENT_DESKTOP: "ubuntu:GNOME" }, exec)).toEqual({ check: "other-desktop", outputs: [] });
    expect(calls).toHaveLength(1);
    const failing = async () => {
      throw new Error("ENOENT");
    };
    expect(await hdrScreens(kde, failing)).toEqual({ check: "failed", outputs: [] });
  });
});

describe("which Proton builds honour the HDR options", () => {
  it("reads the build's proton script, else its name and version", () => {
    expect(honoursHdr(OURS, SCRIPT_HDR)).toBe(true);
    expect(honoursHdr(GE10, SCRIPT_OLD)).toBe(false); // the script decides
    expect(honoursHdr(GE10)).toBe(true);
    expect(honoursHdr(GE9)).toBe(false);
    expect(honoursHdr("Proton - Experimental")).toBe(false);
    expect(honoursHdr("proton_experimental")).toBe(false);
    expect(honoursHdr("GE-Proton-latest", null, "1774238111 GE-Proton10-34")).toBe(true);
    const dir = join(home, "tools");
    proton(dir, GE9, SCRIPT_OLD);
    proton(dir, "GE-Proton-latest", "", "1774238111 GE-Proton10-34");
    expect(buildHonoursHdr(GE9, [dir])).toBe(false);
    expect(buildHonoursHdr("GE-Proton-latest", [dir])).toBe(true);
  });

  it("one reading of our build names (GE-Proton<major>-<minor>.<N>-DualSense)", () => {
    expect(dualSenseBuild(OURS)).toEqual({ ours: true, major: 11, revision: 2 });
    expect(dualSenseBuild(OLD, "1790528971 GE-Proton11-7")).toEqual({ ours: true, major: 11, revision: 1 });
    expect(dualSenseBuild("my-proton", `1 ${OURS}`)).toEqual({ ours: true, major: 11, revision: 2 });
    expect(dualSenseBuild(GE10)).toEqual({ ours: false, major: 10, revision: 1 });
  });

  it("moves a game to our newest build that honours them (and PROTON_PREFER_SDL when needed), else stock GE-Proton", () => {
    const dir = join(home, "tools");
    proton(dir, OURS);
    proton(dir, OLD, SCRIPT_HDR, "1 GE-Proton11-7");
    proton(dir, GE9, SCRIPT_OLD);
    proton(dir, GE10);
    expect(hdrBuild([OLD, OURS, GE9, GE10], [dir], false)).toBe(OURS);
    expect(hdrBuild([OLD, GE9, GE10], [dir], false)).toBe(OLD);
    expect(hdrBuild([OLD, GE9, GE10], [dir], true)).toBe(GE10); // the game needs the standard gamepad too
    expect(hdrBuild([GE9], [dir], false)).toBeNull();
  });

  it("plans the options and/or the build switch", () => {
    expect(hdrPlan({ envSet: false, honours: true, target: null, screen: true })).toEqual({ state: "needed", addEnv: true, switchTo: null });
    expect(hdrPlan({ envSet: true, honours: false, target: OURS, screen: true })).toEqual({ state: "needed", addEnv: false, switchTo: OURS });
    expect(hdrPlan({ envSet: true, honours: true, target: null, screen: false }).state).toBe("set");
    expect(hdrPlan({ envSet: false, honours: true, target: OURS, screen: false }).state).toBe("no-screen");
    expect(hdrPlan({ envSet: false, honours: false, target: null, screen: true }).state).toBe("no-build");
    expect(hdrPlan({ envSet: false, honours: false, target: OURS, screen: true, canSwitch: false }).state).toBe("pick-runner");
  });

  it("Steam launch options: both options in front, the player's own kept", () => {
    expect(withHdr("")).toBe("PROTON_ENABLE_WAYLAND=1 PROTON_ENABLE_HDR=1 %command%");
    expect(withHdr("gamemoderun %command%")).toBe("PROTON_ENABLE_WAYLAND=1 PROTON_ENABLE_HDR=1 gamemoderun %command%");
    expect(withHdr("-dx11")).toBe("PROTON_ENABLE_WAYLAND=1 PROTON_ENABLE_HDR=1 %command% -dx11");
    expect(withHdr("PROTON_PREFER_SDL=1 PROTON_ENABLE_HDR=0 %command%")).toBe("PROTON_ENABLE_WAYLAND=1 PROTON_ENABLE_HDR=1 PROTON_PREFER_SDL=1 %command%");
  });

  it("tags only HDR games on our list", () => {
    expect(knownHdr("Indiana Jones and the Great Circle")).toBe(true);
    expect(knownHdr("Cyberpunk 2077")).toBe(true);
    expect(knownHdr("Ghostrunner")).toBe(false);
    expect(knownHdr("Hades")).toBe(false);
  });
});

describe("the Turn on HDR fix", () => {
  const hdrFixes = (d: ScanDeps) =>
    scan(d)
      .report.games.flatMap((g) => g.fixes)
      .filter((f) => f.kind === "hdr-on");

  it("is recommended on Home for installed HDR games lacking it, only with an HDR screen", () => {
    buildHome();
    const fixes = hdrFixes(deps());
    expect(fixes.map((f) => f.id).sort()).toEqual([`${steamId()}:hdr:2677660`, `${heroicId()}:hdr:cp`, `${lutrisId()}:hdr:hogwarts-1`].sort());
    expect(fixes.every((f) => f.recommended)).toBe(true);
    expect(ApplyRequestSchema.safeParse({ fixIds: fixes.map((f) => f.id), restart: [] }).success).toBe(true);
    expect(fixes.find((f) => f.launcher === "steam")!.why).toMatchObject({ key: "why.hdrSteam", params: { outputs: "DP-5" } });
    const { report } = scan(deps());
    expect(report.system.hdr).toEqual(ON);
    expect(report.games.find((g) => g.id === "1091500")!.hdr).toBe("set");
    expect(report.games.find((g) => g.id === "1145360")!.hdr).toBeUndefined();
    // No HDR screen (or not KDE): not offered, and the page says why.
    for (const hdr of [
      { check: "kde", outputs: [] },
      { check: "other-desktop", outputs: [] },
      { check: "x11", outputs: [] },
    ] as HdrScreens[]) {
      expect(hdrFixes(deps({ hdr }))).toEqual([]);
      expect(scan(deps({ hdr })).report.games.find((g) => g.id === "2677660")!.hdr).toBe("no-screen");
    }
  });

  it("is offered for a game the player marked \"Supports HDR\"; one following Steam's default isn't moved", () => {
    buildHome();
    const { report, plan } = scan(deps({ marked: [ghost(), hades()] }));
    expect(plan.has(`${steamId()}:hdr:1139900`)).toBe(true);
    // Hades follows Steam's Valve Proton (no HDR): it may be a native Linux game, so the player picks.
    expect(report.games.find((g) => g.key === hades())!.hdr).toBe("pick-runner");
    expect(plan.has(`${steamId()}:hdr:1145360`)).toBe(false);
  });

  it("Steam: launch options and the runner, Undo restores both", async () => {
    buildHome();
    const before = [read(localconfig()), read(configVdf())];
    const id = `${steamId()}:hdr:2677660`;
    const r = await apply([id]);
    expect(r.applied).toEqual([{ id, ok: true, message: undefined }]);
    expect(read(localconfig())).toContain('"LaunchOptions"\t\t"PROTON_ENABLE_WAYLAND=1 PROTON_ENABLE_HDR=1 gamemoderun %command%"');
    expect(read(configVdf())).toMatch(new RegExp(`"2677660"\\s*\\{\\s*"name"\\s*"${OURS}"`));
    expect(scan(deps()).report.games.find((g) => g.id === "2677660")!.hdr).toBe("set");
    backups.restore(r.backupId!);
    expect([read(localconfig()), read(configVdf())]).toEqual(before);
  });

  it("Steam: with the standard-gamepad fix in one go, both options end up in the launch options", async () => {
    buildHome();
    const d = deps({ marked: [ghost()] });
    const r = await apply([`${steamId()}:xinput:1139900`, `${steamId()}:hdr:1139900`], d);
    expect(r.applied.every((a) => a.ok)).toBe(true);
    expect(read(localconfig())).toContain('"LaunchOptions"\t\t"PROTON_ENABLE_WAYLAND=1 PROTON_ENABLE_HDR=1 PROTON_PREFER_SDL=1 %command% -dx11"');
    // Both moved it to the same build: our .2 rebuild honours both options.
    expect(read(configVdf())).toMatch(new RegExp(`"1139900"\\s*\\{\\s*"name"\\s*"${OURS.replace(".", "\\.")}"`));
    const game = scan(d).report.games.find((g) => g.key === ghost())!;
    expect([game.gamepad, game.hdr]).toEqual(["set", "set"]);
  });

  it("Steam: Undo of HDR keeps the standard-gamepad option applied before it", async () => {
    buildHome();
    const d = deps({ marked: [ghost()] });
    await apply([`${steamId()}:xinput:1139900`], d);
    const afterGamepad = read(localconfig());
    expect(afterGamepad).toContain('"PROTON_PREFER_SDL=1 %command% -dx11"');
    const r = await apply([`${steamId()}:hdr:1139900`], d);
    expect(read(localconfig())).toContain('"PROTON_ENABLE_WAYLAND=1 PROTON_ENABLE_HDR=1 PROTON_PREFER_SDL=1 %command% -dx11"');
    backups.restore(r.backupId!);
    expect(read(localconfig())).toBe(afterGamepad);
  });

  it("Heroic: turns on Heroic's own Wine-Wayland and HDR switches, switches the runner, Undo restores", async () => {
    buildHome();
    const before = read(heroicGame());
    const r = await apply([`${heroicId()}:hdr:cp`]);
    expect(r.applied[0].ok).toBe(true);
    expect(JSON.parse(read(heroicGame())).cp).toEqual({
      wineVersion: { bin: join(home, ".config/heroic/tools/proton", OURS, "proton"), name: OURS, type: "proton" },
      enviromentOptions: [{ key: "DXVK_HUD", value: "fps" }],
      enableWineWayland: true,
      enableHDR: true,
    });
    expect(scan(deps()).report.games.find((g) => g.id === "cp")!.hdr).toBe("set");
    backups.restore(r.backupId!);
    expect(read(heroicGame())).toBe(before);
  });

  it("Lutris: the game's system env, runner kept when it honours them, Undo restores", async () => {
    buildHome();
    const before = read(lutrisGame());
    const r = await apply([`${lutrisId()}:hdr:hogwarts-1`]);
    expect(r.applied[0].ok).toBe(true);
    expect(read(lutrisGame())).toBe(`game:\n  exe: hogwarts.exe\nsystem:\n  env:\n    DXVK_HUD: fps\n    PROTON_ENABLE_WAYLAND: "1"\n    PROTON_ENABLE_HDR: "1"\nwine:\n  version: ${GE10}\n`);
    backups.restore(r.backupId!);
    expect(read(lutrisGame())).toBe(before);
  });

  it("says when no installed build honours the options", () => {
    buildHome();
    for (const n of [OURS, OLD, GE10]) rmSync(join(steamRoot(), "compatibilitytools.d", n), { recursive: true });
    const { report, plan } = scan({ ...deps(), ourProton: null });
    expect(report.games.find((g) => g.id === "2677660")!.hdr).toBe("no-build");
    expect(plan.has(`${steamId()}:hdr:2677660`)).toBe(false);
  });
});
