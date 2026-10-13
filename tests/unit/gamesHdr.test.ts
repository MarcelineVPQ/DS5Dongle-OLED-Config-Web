// "Turn on HDR" through gamescope: the requirement checks (screens, gamescope
// and its version, its WSI layer, Wayland), the screen's mode as gamescope's
// size, the Steam line merged with the game's own options, recognising a line
// written by hand, moving games off the old PROTON_ENABLE_WAYLAND/HDR variant,
// each launcher's writer, and Undo.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Backups } from "../../electron/main/games/backup";
import { applyFixes, hdrPlan, idHash, scan, type ScanDeps } from "../../electron/main/games/games";
import { gnomeScreens, hdrSystem, kscreenScreens, layerDirs, parseGamescopeVersion, parseKscreenOutputs } from "../../electron/main/games/hdr";
import type { LauncherControl } from "../../electron/main/games/processes";
import { knownHdr } from "../../src/desktop/games/knownGames";
import { GAMESCOPE_MIN, hasGamescopeHdr, hdrGameReqs, hdrReady, hdrSystemReqs, manualSteamLine, stripOldHdrVars, versionAtLeast, withGamescopeHdr } from "../../src/desktop/games/hdrSetup";
import type { HdrSystem } from "../../src/desktop/games/types";
import { ApplyRequestSchema } from "../../electron/main/ipc";
import { asLinux } from "../support/platform";

asLinux();

const OURS = "GE-Proton11-7.2-DualSense";
const GE9 = "GE-Proton9-20";
const GE10 = "GE-Proton10-34";
const SIZE = { width: 3840, height: 2160 };
// The line verified on the owner's machine (KDE Plasma 6, NVIDIA, Indiana Jones).
const VERIFIED = "ENABLE_GAMESCOPE_WSI=1 gamescope --backend wayland --hdr-enabled -f -W 3840 -H 2160 --force-grab-cursor -- %command%";
// What the old fix wrote on top of it on the dev copy (2026-10-13, 15:29): the game crashed.
const COMBINED = `PROTON_ENABLE_WAYLAND=1 PROTON_ENABLE_HDR=1 ${VERIFIED}`;

// What `kscreen-doctor -o` prints (colour codes included), trimmed: the
// owner's two screens, plus an HDR-off screen, a portrait one and a disconnected one.
const E = "\x1b";
const KSCREEN = [
  `${E}[01;32mOutput: ${E}[0;0m1 HDMI-A-2 dfbf95e5`,
  `\t${E}[01;32menabled${E}[0;0m`,
  `\t${E}[01;32mconnected${E}[0;0m`,
  `${E}[01;33m\tModes: ${E}[0;0m 1:450x1920@60.00*!  2:400x1280@60.82 `,
  `${E}[01;33m\tRotation: ${E}[0;0m1`,
  `${E}[01;33m\tHDR: ${E}[0;0mincapable`,
  `${E}[01;32mOutput: ${E}[0;0m2 DP-5 e527803b`,
  `\t${E}[01;32menabled${E}[0;0m`,
  `\t${E}[01;32mconnected${E}[0;0m`,
  `${E}[01;33m\tModes: ${E}[0;0m 10:3840x2160@50.00  3:3840x2160@30.00!  4:4096x2160@59.94  9:3840x2160@59.94* `,
  `${E}[01;33m\tScale: ${E}[0;0m1.2`,
  `${E}[01;33m\tRotation: ${E}[0;0m1`,
  `${E}[01;33m\tHDR: ${E}[0;0menabled`,
  `${E}[01;33m\t\tSDR brightness: ${E}[0;0m1000 nits`,
  `${E}[01;32mOutput: ${E}[0;0m3 DP-6 0000`,
  `\t${E}[01;32menabled${E}[0;0m`,
  `\t${E}[01;32mconnected${E}[0;0m`,
  `${E}[01;33m\tModes: ${E}[0;0m 1:2560x1440@143.97*!`,
  `${E}[01;33m\tRotation: ${E}[0;0m8`,
  `${E}[01;33m\tHDR: ${E}[0;0mdisabled`,
  `${E}[01;32mOutput: ${E}[0;0m4 DP-7 1111`,
  `\t${E}[01;31mdisabled${E}[0;0m`,
  `\t${E}[01;31mdisconnected${E}[0;0m`,
  `${E}[01;33m\tHDR: ${E}[0;0menabled`,
  "",
].join("\n");

// Mutter's DisplayConfig.GetCurrentState as `gdbus call` prints it (GNOME 48), trimmed.
const MUTTER =
  "(uint32 7, [(('DP-1', 'GSM', 'LG HDR 4K', '0x0001'), [('3840x2160@59.997', 3840, 2160, 59.997001647949219, 1.0, [1.0, 2.0], {'is-current': <true>, 'is-preferred': <true>}), ('1920x1080@60.000', 1920, 1080, 60.0, 1.0, [1.0], @a{sv} {})], {'is-builtin': <false>, 'display-name': <'LG Electronics 27\"'>, 'color-mode': <uint32 1>, 'supported-color-modes': <[uint32 0, 1]>}), " +
  "(('eDP-1', 'BOE', '0x0bca', '0x00000000'), [('2256x1504@59.999', 2256, 1504, 59.999000549316406, 1.5, [1.0, 1.5], {'is-current': <true>})], {'is-builtin': <true>, 'color-mode': <uint32 0>}), " +
  "(('HDMI-1', 'DEL', 'U2720Q', 'X'), [('3840x2160@60.000', 3840, 2160, 60.0, 1.0, [1.0], @a{sv} {})], {'color-mode': <uint32 1>})], " +
  "[(0, 0, 1.0, uint32 0, true, [('DP-1', 'GSM', 'LG HDR 4K', '0x0001')], @a{sv} {})], {'layout-mode': <uint32 1>})";

function write(path: string, text: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}
const proton = (dir: string, name: string) => {
  write(join(dir, name, "proton"), "#!/usr/bin/env python3\n");
  write(join(dir, name, "version"), `1791920210 ${name}`);
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

// Steam: Indiana Jones (on our list, GE-Proton 9, gamemoderun), Ghostrunner
// (XInput, marked HDR in tests, -dx11), Hades (follows Steam's default),
// Cyberpunk (the combined line from the dev copy), The Last of Us (the old
// variant only), Ghost of Tsushima (the verified line, written by hand).
// Heroic: Cyberpunk on GE-Proton 9 with its own variable. Lutris: Hogwarts
// Legacy on GE-Proton 10 with its own variable.
function buildHome() {
  const steam = steamRoot();
  const mapping = (id: string, name: string) => `\t\t\t\t\t"${id}"\n\t\t\t\t\t{\n\t\t\t\t\t\t"name"\t\t"${name}"\n\t\t\t\t\t\t"config"\t\t""\n\t\t\t\t\t\t"priority"\t\t"250"\n\t\t\t\t\t}\n`;
  write(
    configVdf(),
    `"InstallConfigStore"\n{\n\t"Software"\n\t{\n\t\t"Valve"\n\t\t{\n\t\t\t"Steam"\n\t\t\t{\n\t\t\t\t"CompatToolMapping"\n\t\t\t\t{\n${mapping("0", "proton_9")}${mapping("2677660", GE9)}${mapping("1139900", GE10)}${mapping("1091500", OURS)}${mapping("2215430", OURS)}${mapping("1888930", OURS)}\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n}\n`,
  );
  const opts = (id: string, value: string) => `\t\t\t\t\t"${id}"\n\t\t\t\t\t{\n\t\t\t\t\t\t"LaunchOptions"\t\t"${value}"\n\t\t\t\t\t}\n`;
  write(
    localconfig(),
    `"UserLocalConfigStore"\n{\n\t"Software"\n\t{\n\t\t"Valve"\n\t\t{\n\t\t\t"Steam"\n\t\t\t{\n\t\t\t\t"apps"\n\t\t\t\t{\n${opts("2677660", "gamemoderun %command%")}${opts("1139900", "-dx11")}${opts("1091500", COMBINED)}${opts("1888930", "PROTON_ENABLE_HDR=1 PROTON_ENABLE_WAYLAND=1 %command%")}${opts("2215430", VERIFIED)}\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n\t"apps"\n\t{\n\t\t"1139900"\n\t\t{\n\t\t\t"UseSteamControllerConfig"\t\t"0"\n\t\t}\n\t}\n}\n`,
  );
  write(join(steam, "steamapps/libraryfolders.vdf"), `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steam}"\n\t}\n}\n`);
  const acf = (id: string, name: string) => write(join(steam, `steamapps/appmanifest_${id}.acf`), `"AppState"\n{\n\t"appid"\t\t"${id}"\n\t"name"\t\t"${name}"\n}\n`);
  acf("2677660", "Indiana Jones and the Great Circle");
  acf("1139900", "Ghostrunner");
  acf("1145360", "Hades");
  acf("1091500", "Cyberpunk 2077");
  acf("1888930", "The Last of Us Part I");
  acf("2215430", "Ghost of Tsushima");
  const tools = join(steam, "compatibilitytools.d");
  proton(tools, OURS);
  proton(tools, GE9);
  proton(tools, GE10);

  const heroic = join(home, ".config/heroic");
  const htools = join(heroic, "tools/proton");
  write(join(heroic, "config.json"), JSON.stringify({ defaultSettings: {} }));
  proton(htools, OURS);
  proton(htools, GE9);
  write(join(heroic, "sideload_apps/library.json"), JSON.stringify({ games: [{ app_name: "cp", title: "Cyberpunk 2077", is_installed: true, install: { platform: "windows" } }] }));
  write(
    heroicGame(),
    JSON.stringify(
      {
        cp: {
          wineVersion: { bin: join(htools, GE9, "proton"), name: GE9, type: "proton" },
          enviromentOptions: [
            { key: "DXVK_HUD", value: "fps" },
            { key: "PROTON_ENABLE_HDR", value: "1" },
          ],
          enableWineWayland: true,
          enableHDR: true,
          gamescope: { enableLimiter: false, fpsLimiter: "", additionalOptions: "--mangoapp --backend sdl" },
        },
        version: "v0",
      },
      null,
      2,
    ),
  );

  const lutris = join(home, ".local/share/lutris");
  write(join(lutris, "runners/wine.yml"), `wine:\n  version: ${GE10}\n`);
  write(join(lutris, "runtime/umu/umu-run"), "");
  write(lutrisGame(), `game:\n  exe: hogwarts.exe\nsystem:\n  env:\n    DXVK_HUD: fps\n    PROTON_ENABLE_WAYLAND: "1"\n    PROTON_ENABLE_HDR: "1"\nwine:\n  version: ${GE10}\n`);
  const db = new DatabaseSync(join(lutris, "pga.db"));
  db.exec("CREATE TABLE games (slug TEXT, name TEXT, runner TEXT, installed INTEGER, configpath TEXT)");
  db.exec("INSERT INTO games VALUES ('hogwarts-legacy', 'Hogwarts Legacy', 'wine', 1, 'hogwarts-1')");
  db.close();
}

const READY: HdrSystem = {
  check: "kde",
  screens: [
    { name: "HDMI-A-2", hdr: false, width: 450, height: 1920, refresh: 60 },
    { name: "DP-5", hdr: true, width: 3840, height: 2160, refresh: 59.94 },
  ],
  gamescope: { path: "/usr/games/gamescope", version: "3.16.20", min: GAMESCOPE_MIN.kde, layer: true, flatpak: false },
};
const sys = (o: Partial<Omit<HdrSystem, "gamescope">> & { gamescope?: Partial<HdrSystem["gamescope"]> } = {}): HdrSystem => ({ ...READY, ...o, gamescope: { ...READY.gamescope, ...o.gamescope } });
const deps = (o: { hdr?: HdrSystem; marked?: string[]; notDetected?: string[] } = {}): ScanDeps => ({
  home,
  ourProton: OURS,
  latestProton: null,
  latestSize: null,
  running: new Set(),
  audioCards: [],
  notDetected: new Set(o.notDetected ?? []),
  hdrMarked: new Set(o.marked ?? []),
  hdr: o.hdr ?? READY,
});
const control: LauncherControl = { running: () => new Set(), gameRunning: () => false, plan: () => null, close: async () => "closed", reopen: async () => true };
const applyDeps = { backups: undefined as unknown as Backups, launchers: control, restartWirePlumber: async () => undefined, setCardProfile: async () => undefined };
const apply = (ids: string[], d = deps()) => applyFixes(scan(d), ids, [], { ...applyDeps, backups });
const read = (path: string) => readFileSync(path, "utf8");
const ghost = () => `${steamId()}:steam:1139900`;
const hades = () => `${steamId()}:steam:1145360`;
const steamOpts = (appid: string) => new RegExp(`"${appid}"\\s*\\{\\s*"LaunchOptions"\\s*"([^"]*)"`).exec(read(localconfig()))?.[1];

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "ds5-hdr-")));
  backups = new Backups(join(home, "backups"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("screens and their current mode", () => {
  it("KDE: each output's HDR state and current mode (*), portrait screens swapped", () => {
    const parsed = parseKscreenOutputs(KSCREEN);
    expect(parsed.map((o) => [o.name, o.hdrState, o.width, o.height, o.refresh])).toEqual([
      ["HDMI-A-2", "incapable", 450, 1920, 60],
      ["DP-5", "enabled", 3840, 2160, 59.94],
      ["DP-6", "disabled", 1440, 2560, 143.97],
      ["DP-7", "enabled", 0, 0, 0],
    ]);
    // Only connected, enabled screens.
    expect(kscreenScreens(KSCREEN).map((s) => [s.name, s.hdr])).toEqual([
      ["HDMI-A-2", false],
      ["DP-5", true],
      ["DP-6", false],
    ]);
    expect(kscreenScreens("")).toEqual([]);
    expect(kscreenScreens("garbage\nOutput:\n")).toEqual([]);
  });

  it("GNOME: Mutter's color-mode 1 (BT.2100) is HDR; screens without a current mode are off", () => {
    expect(gnomeScreens(MUTTER)).toEqual([
      { name: "DP-1", hdr: true, width: 3840, height: 2160, refresh: 59.997001647949219 },
      { name: "eDP-1", hdr: false, width: 2256, height: 1504, refresh: 59.999000549316406 },
    ]);
    expect(gnomeScreens("")).toEqual([]);
  });

  it("gamescope's version and the minimum", () => {
    expect(parseGamescopeVersion(`[gamescope] [${E}[0;34mInfo${E}[0m]  console: gamescope version 3.16.20+ds-1 (gcc 15.2.0)`)).toBe("3.16.20");
    expect(parseGamescopeVersion("gamescope version 3.16.14.5 (gcc)")).toBe("3.16.14.5");
    expect(parseGamescopeVersion("usage: gamescope [options...]")).toBeNull();
    expect(versionAtLeast("3.16.20", GAMESCOPE_MIN.kde)).toBe(true);
    expect(versionAtLeast("3.14.29", GAMESCOPE_MIN.kde)).toBe(false);
    expect(versionAtLeast("3.16.4", GAMESCOPE_MIN.gnome)).toBe(false);
    expect(versionAtLeast("3.16.14.5", GAMESCOPE_MIN.gnome)).toBe(true);
    expect(versionAtLeast("3.15", "3.15.0")).toBe(true);
  });
});

describe("the requirement check (hdrSystem)", () => {
  const fakeGamescope = () => {
    const bin = join(home, "bin");
    write(join(bin, "gamescope"), "#!/bin/sh\n");
    chmodSync(join(bin, "gamescope"), 0o755);
    return bin;
  };
  const layer = () => write(join(home, "share/vulkan/implicit_layer.d/VkLayer_FROG_gamescope_wsi.x86_64.json"), "{}");
  type Call = { cmd: string; args: string[]; timeout: number; shell?: unknown };
  const runner = (calls: Call[], out: Record<string, string>) => async (cmd: string, args: string[], opts: { timeout: number }) => {
    calls.push({ cmd, args, timeout: opts.timeout, shell: (opts as { shell?: unknown }).shell });
    const key = cmd.endsWith("gamescope") ? "gamescope" : cmd;
    if (!(key in out)) throw new Error("ENOENT");
    return key === "gamescope" ? { stdout: "", stderr: out[key] } : { stdout: out[key] };
  };

  it("KDE: kscreen-doctor -o and gamescope --version, fixed argv, a timeout, no shell; the layer and the Flatpak extension by file", async () => {
    const bin = fakeGamescope();
    layer();
    mkdirSync(join(home, ".local/share/flatpak/runtime/org.freedesktop.Platform.VulkanLayer.gamescope"), { recursive: true });
    const calls: Call[] = [];
    const env = { WAYLAND_DISPLAY: "wayland-0", XDG_CURRENT_DESKTOP: "KDE", PATH: `/nonexistent:${bin}`, XDG_DATA_DIRS: join(home, "share") };
    const r = await hdrSystem(env, runner(calls, { "kscreen-doctor": KSCREEN, gamescope: "gamescope version 3.16.20+ds-1 (gcc 15.2.0)" }), home);
    expect(r.check).toBe("kde");
    expect(r.screens.find((s) => s.hdr)).toEqual({ name: "DP-5", hdr: true, width: 3840, height: 2160, refresh: 59.94 });
    expect(r.gamescope).toEqual({ path: join(bin, "gamescope"), version: "3.16.20", min: "3.15.0", layer: true, flatpak: true });
    expect(calls.map((c) => [c.cmd, c.args, c.timeout, c.shell])).toEqual([
      ["kscreen-doctor", ["-o"], 5000, undefined],
      [join(bin, "gamescope"), ["--version"], 5000, undefined],
    ]);
    expect(hdrReady(r)).toBe(true);
  });

  it("GNOME: Mutter's GetCurrentState over gdbus, read-only; the newer gamescope minimum", async () => {
    const calls: Call[] = [];
    const r = await hdrSystem({ WAYLAND_DISPLAY: "wayland-0", XDG_CURRENT_DESKTOP: "ubuntu:GNOME", PATH: "" }, runner(calls, { gdbus: MUTTER }), home);
    expect(r.check).toBe("gnome");
    expect(r.screens.filter((s) => s.hdr).map((s) => s.name)).toEqual(["DP-1"]);
    expect(r.gamescope.min).toBe("3.16.5");
    expect(calls).toEqual([
      {
        cmd: "gdbus",
        args: ["call", "--session", "--dest", "org.gnome.Mutter.DisplayConfig", "--object-path", "/org/gnome/Mutter/DisplayConfig", "--method", "org.gnome.Mutter.DisplayConfig.GetCurrentState"],
        timeout: 5000,
        shell: undefined,
      },
    ]);
  });

  it("X11, other desktops and a failing check run nothing for the screens", async () => {
    const calls: Call[] = [];
    const exec = runner(calls, {});
    expect((await hdrSystem({ XDG_SESSION_TYPE: "x11", XDG_CURRENT_DESKTOP: "KDE", PATH: "" }, exec, home)).check).toBe("x11");
    expect((await hdrSystem({ WAYLAND_DISPLAY: "w", XDG_CURRENT_DESKTOP: "sway", PATH: "" }, exec, home)).check).toBe("other-desktop");
    expect(calls).toEqual([]);
    expect((await hdrSystem({ WAYLAND_DISPLAY: "w", XDG_CURRENT_DESKTOP: "KDE", PATH: "" }, exec, home)).check).toBe("failed");
  });

  it("the Vulkan loader's implicit layer folders", () => {
    expect(layerDirs({}, "/home/u")).toEqual([
      "/home/u/.config/vulkan/implicit_layer.d",
      "/etc/xdg/vulkan/implicit_layer.d",
      "/etc/vulkan/implicit_layer.d",
      "/home/u/.local/share/vulkan/implicit_layer.d",
      "/usr/local/share/vulkan/implicit_layer.d",
      "/usr/share/vulkan/implicit_layer.d",
    ]);
  });

  it("each missing requirement is a ✗ with its own line", () => {
    const failing = (s: HdrSystem, flatpak = false) =>
      hdrSystemReqs(s, { ourProton: null, flatpak })
        .filter((r) => !r.ok)
        .map((r) => r.key);
    expect(failing(READY)).toEqual(["proton.no"]);
    expect(hdrReady(READY)).toBe(true); // our Proton is recommended, not required
    expect(failing(sys({ gamescope: { path: null, version: null } }))).toEqual(["gamescope.no", "proton.no"]);
    expect(failing(sys({ gamescope: { version: "3.14.2" } }))).toEqual(["gamescope.old", "proton.no"]);
    expect(failing(sys({ gamescope: { version: null } }))).toEqual(["gamescope.unknown", "proton.no"]);
    expect(failing(sys({ gamescope: { layer: false } }))).toEqual(["layer.no", "proton.no"]);
    expect(failing(sys({ check: "x11", screens: [] }))).toEqual(["wayland.no", "screen.x11", "proton.no"]);
    expect(failing(sys({ screens: READY.screens.map((s) => ({ ...s, hdr: false })) }))).toEqual(["screen.off.kde", "proton.no"]);
    expect(failing(sys({ check: "other-desktop", screens: [] }))).toEqual(["screen.other-desktop", "proton.no"]);
    // A Flatpak launcher: gamescope and its layer come from the Flatpak extension.
    expect(failing(READY, true)).toEqual(["gamescope.flatpakNo", "proton.no"]);
    expect(failing(sys({ gamescope: { flatpak: true, path: null } }), true)).toEqual(["proton.no"]);
    for (const s of [sys({ gamescope: { path: null } }), sys({ gamescope: { version: "3.14.2" } }), sys({ gamescope: { layer: false } }), sys({ check: "x11" }), sys({ screens: [] })])
      expect(hdrReady(s)).toBe(false);
    const ok = hdrSystemReqs(READY, { ourProton: OURS }).find((r) => r.id === "screen");
    expect(ok).toEqual({ id: "screen", ok: true, key: "screen.ok", params: { screen: "DP-5", mode: "3840×2160" } });
  });

  it("a game's page adds the game, its Proton and whether it's set up", () => {
    const reqs = hdrGameReqs(READY, { hdr: "needed", usesOurProton: false, runner: GE9 }, { ourProton: OURS });
    expect(reqs.slice(-3)).toEqual([
      { id: "game", ok: true, key: "game.ok" },
      { id: "runner", ok: false, key: "runner.no", params: { runner: GE9 } },
      { id: "setup", ok: false, key: "setup.needed" },
    ]);
    expect(hdrGameReqs(READY, { hdr: "set", usesOurProton: true, runner: OURS }, { ourProton: OURS }).every((r) => r.ok)).toBe(true);
  });
});

describe("the Steam line", () => {
  it("is the verified line for the screen's mode", () => {
    expect(manualSteamLine(SIZE)).toBe(VERIFIED);
    expect(manualSteamLine({ width: 2560, height: 1440 })).toBe("ENABLE_GAMESCOPE_WSI=1 gamescope --backend wayland --hdr-enabled -f -W 2560 -H 1440 --force-grab-cursor -- %command%");
  });

  it("keeps the player's variables in front, wrappers inside gamescope, game arguments after %command%", () => {
    expect(withGamescopeHdr("PROTON_PREFER_SDL=1 %command%", SIZE)).toBe(`PROTON_PREFER_SDL=1 ${VERIFIED}`);
    expect(withGamescopeHdr("gamemoderun %command%", SIZE)).toBe(VERIFIED.replace("-- %command%", "-- gamemoderun %command%"));
    expect(withGamescopeHdr("-dx11", SIZE)).toBe(`${VERIFIED} -dx11`);
    expect(withGamescopeHdr('DXVK_HUD="fps,gpuload" PROTON_PREFER_SDL=1 mangohud %command% -skipintro', SIZE)).toBe(
      'DXVK_HUD="fps,gpuload" PROTON_PREFER_SDL=1 ENABLE_GAMESCOPE_WSI=1 gamescope --backend wayland --hdr-enabled -f -W 3840 -H 2160 --force-grab-cursor -- mangohud %command% -skipintro',
    );
  });

  it("adds HDR to a gamescope of the player's own, keeping their flags", () => {
    expect(withGamescopeHdr("gamescope -w 1920 -h 1080 -F fsr --backend sdl -- %command%", SIZE)).toBe(
      "ENABLE_GAMESCOPE_WSI=1 gamescope --backend wayland --hdr-enabled -w 1920 -h 1080 -F fsr -- %command%",
    );
  });

  it("recognises a hand-written equivalent line and leaves it alone", () => {
    expect(hasGamescopeHdr(VERIFIED)).toBe(true);
    expect(hasGamescopeHdr("DXVK_HDR=1 /usr/games/gamescope -f --hdr-enabled -- %command%")).toBe(true);
    expect(hasGamescopeHdr("gamescope -f -- %command%")).toBe(false);
    expect(hasGamescopeHdr("PROTON_ENABLE_HDR=1 %command%")).toBe(false);
    expect(withGamescopeHdr(VERIFIED, SIZE)).toBe(VERIFIED);
  });

  it("removes the old PROTON_ENABLE_WAYLAND / PROTON_ENABLE_HDR wherever they are", () => {
    expect(stripOldHdrVars(COMBINED)).toBe(VERIFIED);
    expect(withGamescopeHdr(COMBINED, SIZE)).toBe(VERIFIED);
    expect(withGamescopeHdr("PROTON_PREFER_SDL=1 PROTON_ENABLE_WAYLAND=1 PROTON_ENABLE_HDR=1 %command%", SIZE)).toBe(`PROTON_PREFER_SDL=1 ${VERIFIED}`);
    expect(stripOldHdrVars("ENABLE_GAMESCOPE_WSI=1 PROTON_ENABLE_HDR=1 gamescope --hdr-enabled -- %command% PROTON_ENABLE_WAYLAND=1")).toBe(
      "ENABLE_GAMESCOPE_WSI=1 gamescope --hdr-enabled -- %command%",
    );
  });
});

describe("the Turn on HDR fix", () => {
  const hdrFixes = (d: ScanDeps) =>
    scan(d)
      .report.games.flatMap((g) => g.fixes)
      .filter((f) => f.kind === "hdr-on");
  const state = (d: ScanDeps, id: string) => scan(d).report.games.find((g) => g.id === id)!.hdr;

  it("plans gamescope, the old variant's removal, or nothing", () => {
    expect(hdrPlan({ gamescope: true, old: false, ready: false })).toEqual({ state: "set", gamescope: false, strip: false });
    expect(hdrPlan({ gamescope: false, old: false, ready: true })).toEqual({ state: "needed", gamescope: true, strip: false });
    expect(hdrPlan({ gamescope: false, old: false, ready: false })).toEqual({ state: "missing", gamescope: false, strip: false });
    expect(hdrPlan({ gamescope: false, old: true, ready: true })).toEqual({ state: "update", gamescope: true, strip: true });
    expect(hdrPlan({ gamescope: false, old: true, ready: false })).toEqual({ state: "update", gamescope: false, strip: true });
    expect(hdrPlan({ gamescope: true, old: true, ready: true })).toEqual({ state: "update", gamescope: false, strip: true });
  });

  it("is recommended for HDR games lacking it; a hand-written line counts as set", () => {
    buildHome();
    const fixes = hdrFixes(deps());
    expect(fixes.map((f) => f.id).sort()).toEqual([`${steamId()}:hdr:2677660`, `${steamId()}:hdr:1091500`, `${steamId()}:hdr:1888930`, `${heroicId()}:hdr:cp`, `${lutrisId()}:hdr:hogwarts-1`].sort());
    expect(fixes.every((f) => f.recommended)).toBe(true);
    expect(ApplyRequestSchema.safeParse({ fixIds: fixes.map((f) => f.id), restart: [] }).success).toBe(true);
    const indy = fixes.find((f) => f.id === `${steamId()}:hdr:2677660`)!;
    expect(indy.label).toEqual({ key: "label.hdr", params: { game: "Indiana Jones and the Great Circle" } });
    expect(indy.why).toMatchObject({
      key: "why.hdrSteam",
      params: { screen: "DP-5", mode: "3840×2160", options: VERIFIED.replace("-- %command%", "-- gamemoderun %command%"), runner: { key: "why.hdrRunner", params: { proton: OURS } } },
    });
    expect(state(deps(), "2215430")).toBe("set"); // Ghost of Tsushima: the verified line by hand
    expect(state(deps(), "1091500")).toBe("update"); // Cyberpunk: the combined line
    expect(state(deps(), "1888930")).toBe("update"); // The Last of Us: the old variant
    expect(state(deps(), "1145360")).toBeUndefined(); // Hades isn't an HDR game
  });

  it("isn't offered while a requirement is missing; the old variant is still removed", () => {
    buildHome();
    for (const hdr of [sys({ gamescope: { path: null } }), sys({ gamescope: { version: "3.14.2" } }), sys({ gamescope: { layer: false } }), sys({ check: "x11" }), sys({ screens: [] })]) {
      expect(state(deps({ hdr }), "2677660")).toBe("missing");
      const fixes = hdrFixes(deps({ hdr }));
      expect(fixes.map((f) => f.label.key).sort()).toEqual(["label.hdrRemoveOld", "label.hdrRemoveOld", "label.hdrRemoveOld", "label.hdrRemoveOld"]);
      expect(fixes.find((f) => f.id === `${steamId()}:hdr:1888930`)!.why).toEqual({ key: "why.hdrOld", params: { game: "The Last of Us Part I", next: { key: "why.hdrOldOnly" } } });
    }
  });

  it("Steam: the launch options and our Proton, Undo restores both", async () => {
    buildHome();
    const before = [read(localconfig()), read(configVdf())];
    const id = `${steamId()}:hdr:2677660`;
    const r = await apply([id]);
    expect(r.applied).toEqual([{ id, ok: true, message: undefined }]);
    expect(steamOpts("2677660")).toBe(VERIFIED.replace("-- %command%", "-- gamemoderun %command%"));
    expect(read(configVdf())).toMatch(new RegExp(`"2677660"\\s*\\{\\s*"name"\\s*"${OURS.replace(".", "\\.")}"`));
    expect(state(deps(), "2677660")).toBe("set");
    backups.restore(r.backupId!);
    expect([read(localconfig()), read(configVdf())]).toEqual(before);
  });

  it("Steam: the combined line from the dev copy loses only the old variables", async () => {
    buildHome();
    const fix = hdrFixes(deps()).find((f) => f.id === `${steamId()}:hdr:1091500`)!;
    expect(fix.label.key).toBe("label.hdrRemoveOld");
    const r = await apply([fix.id]);
    expect(r.applied[0].ok).toBe(true);
    expect(steamOpts("1091500")).toBe(VERIFIED);
    expect(state(deps(), "1091500")).toBe("set");
    expect(hdrFixes(deps()).some((f) => f.id === fix.id)).toBe(false);
  });

  it("Steam: the old variant alone moves to gamescope", async () => {
    buildHome();
    const fix = hdrFixes(deps()).find((f) => f.id === `${steamId()}:hdr:1888930`)!;
    expect(fix.label).toEqual({ key: "label.hdrUpdate", params: { game: "The Last of Us Part I" } });
    await apply([fix.id]);
    expect(steamOpts("1888930")).toBe(VERIFIED);
  });

  it("Steam: with the standard-gamepad fix in one go, PROTON_PREFER_SDL stays in front of gamescope", async () => {
    buildHome();
    const d = deps({ marked: [ghost()] });
    const r = await apply([`${steamId()}:xinput:1139900`, `${steamId()}:hdr:1139900`], d);
    expect(r.applied.every((a) => a.ok)).toBe(true);
    expect(steamOpts("1139900")).toBe(`PROTON_PREFER_SDL=1 ${VERIFIED} -dx11`);
    expect(read(configVdf())).toMatch(new RegExp(`"1139900"\\s*\\{\\s*"name"\\s*"${OURS.replace(".", "\\.")}"`));
    const game = scan(d).report.games.find((g) => g.key === ghost())!;
    expect([game.gamepad, game.hdr]).toEqual(["set", "set"]);
  });

  it("Steam: Undo of HDR keeps the standard-gamepad option applied before it", async () => {
    buildHome();
    const d = deps({ marked: [ghost()] });
    await apply([`${steamId()}:xinput:1139900`], d);
    const afterGamepad = read(localconfig());
    expect(steamOpts("1139900")).toBe("PROTON_PREFER_SDL=1 %command% -dx11");
    const r = await apply([`${steamId()}:hdr:1139900`], d);
    expect(steamOpts("1139900")).toBe(`PROTON_PREFER_SDL=1 ${VERIFIED} -dx11`);
    backups.restore(r.backupId!);
    expect(read(localconfig())).toBe(afterGamepad);
  });

  it("Steam: a game following Steam's default isn't moved to another Proton (it may be a native Linux game)", () => {
    buildHome();
    const { plan } = scan(deps({ marked: [hades()] }));
    const p = plan.get(`${steamId()}:hdr:1145360`)!;
    expect(p.fix.files).toEqual([localconfig()]);
  });

  it("Heroic: its own gamescope settings, the old switches off, our Proton, Undo restores", async () => {
    buildHome();
    const before = read(heroicGame());
    const fix = hdrFixes(deps()).find((f) => f.id === `${heroicId()}:hdr:cp`)!;
    expect(fix.label.key).toBe("label.hdrUpdate");
    const r = await apply([fix.id]);
    expect(r.applied[0].ok).toBe(true);
    expect(JSON.parse(read(heroicGame())).cp).toEqual({
      wineVersion: { bin: join(home, ".config/heroic/tools/proton", OURS, "proton"), name: OURS, type: "proton" },
      enviromentOptions: [
        { key: "DXVK_HUD", value: "fps" },
        { key: "ENABLE_GAMESCOPE_WSI", value: "1" },
      ],
      enableWineWayland: false,
      enableHDR: false,
      gamescope: {
        enableLimiter: false,
        fpsLimiter: "",
        enableUpscaling: true,
        windowType: "fullscreen",
        gameWidth: "3840",
        gameHeight: "2160",
        upscaleWidth: "3840",
        upscaleHeight: "2160",
        additionalOptions: "--backend wayland --hdr-enabled --force-grab-cursor --mangoapp",
      },
    });
    expect(state(deps(), "cp")).toBe("set");
    backups.restore(r.backupId!);
    expect(read(heroicGame())).toBe(before);
  });

  it("Lutris: its own gamescope options with HDR, the old variables removed, our Proton, Undo restores", async () => {
    buildHome();
    const before = read(lutrisGame());
    const r = await apply([`${lutrisId()}:hdr:hogwarts-1`]);
    expect(r.applied[0].ok).toBe(true);
    expect(read(lutrisGame())).toBe(
      [
        "game:",
        "  exe: hogwarts.exe",
        "system:",
        "  env:",
        "    DXVK_HUD: fps",
        '    ENABLE_GAMESCOPE_WSI: "1"',
        "  gamescope: true",
        "  gamescope_hdr: true",
        "  gamescope_force_grab_cursor: true",
        "  gamescope_output_res: 3840x2160",
        "  gamescope_game_res: 3840x2160",
        "  gamescope_window_mode: -f", // a plain YAML string
        "  gamescope_flags: --backend wayland",
        "wine:",
        `  version: ${OURS}`,
        "",
      ].join("\n"),
    );
    expect(state(deps(), "hogwarts-legacy")).toBe("set");
    backups.restore(r.backupId!);
    expect(read(lutrisGame())).toBe(before);
  });

  it("is never judged or offered on Windows (Windows games do HDR themselves)", () => {
    buildHome();
    const real = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    try {
      const { report } = scan(deps());
      expect(report.games.filter((g) => g.hdr !== undefined)).toEqual([]);
      expect(report.games.flatMap((g) => g.fixes).filter((f) => f.kind === "hdr-on")).toEqual([]);
    } finally {
      Object.defineProperty(process, "platform", { value: real, configurable: true });
    }
  });

  it("tags only HDR games on our list", () => {
    expect(knownHdr("Indiana Jones and the Great Circle")).toBe(true);
    expect(knownHdr("Cyberpunk 2077")).toBe(true);
    expect(knownHdr("Ghostrunner")).toBe(false);
    expect(knownHdr("Hades")).toBe(false);
  });
});
