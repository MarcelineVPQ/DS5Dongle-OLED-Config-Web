// "Start {game} in DirectX 12": the game's own flag in its arguments (Steam
// launch options, Heroic's launcherArgs, Lutris's game.args), merged with what
// is there, recommended, undoable; on Linux and Windows alike.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Backups } from "../../electron/main/games/backup";
import { applyFixes, idHash, scan, withPreferSdl, type ScanDeps } from "../../electron/main/games/games";
import type { LauncherControl } from "../../electron/main/games/processes";
import { modeInfo, withArg } from "../../src/desktop/games/gameArgs";
import { withGamescopeHdr } from "../../src/desktop/games/hdrSetup";
import { graphicsMode } from "../../src/desktop/games/knownGames";
import { allFixes, type GamesReport } from "../../src/desktop/games/types";

const GHOST = graphicsMode("Ghostrunner", "steam")!;
const HDR_LINE = "ENABLE_GAMESCOPE_WSI=1 gamescope --backend wayland --hdr-enabled -f -W 3840 -H 2160 --force-grab-cursor -- %command%";

function write(path: string, text: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}
const read = (path: string) => readFileSync(path, "utf8");
const noControl: LauncherControl = { running: () => new Set(), gameRunning: () => false, plan: () => null, close: async () => "not-running", reopen: async () => true };
const vdfApps = (apps: Array<[string, string]>) =>
  `"UserLocalConfigStore"\n{\n\t"Software"\n\t{\n\t\t"Valve"\n\t\t{\n\t\t\t"Steam"\n\t\t\t{\n\t\t\t\t"apps"\n\t\t\t\t{\n${apps
    .map(([id, opts]) => `\t\t\t\t\t"${id}"\n\t\t\t\t\t{\n\t\t\t\t\t\t"LaunchOptions"\t\t"${opts}"\n\t\t\t\t\t}\n`)
    .join("")}\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n}\n`;
function steamHome(steam: string, apps: Array<[string, string, string]>) {
  write(join(steam, "config", "config.vdf"), '"InstallConfigStore"\n{\n}\n');
  write(join(steam, "userdata", "1", "config", "localconfig.vdf"), vdfApps(apps.filter(([, , opts]) => opts !== "").map(([id, , opts]) => [id, opts])));
  write(join(steam, "steamapps", "libraryfolders.vdf"), `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steam}"\n\t}\n}\n`);
  for (const [id, name] of apps) write(join(steam, "steamapps", `appmanifest_${id}.acf`), `"AppState"\n{\n\t"appid"\t\t"${id}"\n\t"name"\t\t"${name}"\n}\n`);
}

describe("the graphics-mode data and the one args writer", () => {
  it("knows the flag per game, for every store build", () => {
    expect(GHOST).toEqual({ api: "dx12", flag: "-dx12", unlocks: "rayTracing" });
    expect(graphicsMode("Ghostrunner", "gog")).toEqual(GHOST);
    expect(graphicsMode("Ghostrunner 2", "epic")?.flag).toBe("-dx12");
    expect(graphicsMode("Hades", "steam")).toBeNull();
  });

  it("adds the flag after the game arguments, keeping everything else", () => {
    expect(withArg("", "-dx12")).toBe("-dx12");
    expect(withArg("-skipintro", "-dx12")).toBe("-skipintro -dx12");
    expect(withArg("PROTON_PREFER_SDL=1 %command%", "-dx12")).toBe("PROTON_PREFER_SDL=1 %command% -dx12");
    expect(withArg(`${HDR_LINE} -windowed`, "-dx12")).toBe(`${HDR_LINE} -windowed -dx12`);
    expect(withArg("%command% -DX12", "-dx12")).toBe("%command% -DX12"); // already there
  });

  it("merges with the gamepad and HDR writers in either order", () => {
    const screen = { width: 3840, height: 2160 };
    expect(withPreferSdl(withArg("", "-dx12"))).toBe("PROTON_PREFER_SDL=1 %command% -dx12");
    expect(withArg(withPreferSdl(""), "-dx12")).toBe("PROTON_PREFER_SDL=1 %command% -dx12");
    expect(withGamescopeHdr(withArg("PROTON_PREFER_SDL=1 %command%", "-dx12"), screen)).toBe(`PROTON_PREFER_SDL=1 ${HDR_LINE} -dx12`);
    expect(withArg(withGamescopeHdr("PROTON_PREFER_SDL=1 %command%", screen), "-dx12")).toBe(`PROTON_PREFER_SDL=1 ${HDR_LINE} -dx12`);
  });

  it("reads the mode: set, needed, or the player's own", () => {
    expect(modeInfo(GHOST, "%command% -dx12").state).toBe("set");
    expect(modeInfo(GHOST, "-d3d12").state).toBe("set"); // the same mode by another name
    expect(modeInfo(GHOST, "PROTON_PREFER_SDL=1 %command%").state).toBe("needed");
    expect(modeInfo(GHOST, "-dx12 %command%").state).toBe("needed"); // in front of %command%: not a game argument
    expect(modeInfo(GHOST, "gamemoderun %command% -dx11")).toEqual({ api: "dx12", flag: "-dx12", unlocks: "rayTracing", state: "own", own: "-dx11" });
  });
});

describe("the graphics-mode fix on Linux", () => {
  let real: NodeJS.Platform;
  let home: string;
  let backups: Backups;
  beforeAll(() => {
    real = process.platform;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
  });
  afterAll(() => Object.defineProperty(process, "platform", { value: real, configurable: true }));

  const steamRoot = () => join(home, ".steam/debian-installation");
  const localconfig = () => join(steamRoot(), "userdata/1/config/localconfig.vdf");
  const heroic = () => join(home, ".config/heroic");
  const heroicGame = (app: string) => join(heroic(), "GamesConfig", `${app}.json`);
  const lutrisGame = () => join(home, ".local/share/lutris/games/ghostrunner-1.yml");
  const steamId = () => `steam-${idHash(steamRoot())}`;
  const heroicId = () => `heroic-${idHash(heroic())}`;
  const lutrisId = () => `lutris-${idHash(join(home, ".local/share/lutris"))}`;
  const deps = (): ScanDeps => ({ home, ourProton: null, latestProton: null, latestSize: null, running: new Set(), audioCards: [] });
  const applyDeps = () => ({ backups, launchers: noControl, restartWirePlumber: async () => undefined, setCardProfile: async () => undefined });

  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), "ds5-mode-")));
    backups = new Backups(join(home, "backups"));
    // Steam: Ghostrunner with the standard-gamepad option, Ghostrunner 2 with the
    // gamescope HDR line, Hades (no mode needed).
    steamHome(steamRoot(), [
      ["1139900", "Ghostrunner", "PROTON_PREFER_SDL=1 %command%"],
      ["2144740", "Ghostrunner 2", `${HDR_LINE} -windowed`],
      ["1145360", "Hades", ""],
    ]);
    // Heroic: Ghostrunner from GOG, no game arguments yet (the owner's case).
    write(join(heroic(), "config.json"), JSON.stringify({ defaultSettings: {} }));
    write(join(heroic(), "store_cache/gog_library.json"), JSON.stringify({ games: [{ app_name: "1957528513", title: "Ghostrunner" }] }));
    write(join(heroic(), "gog_store/installed.json"), JSON.stringify({ installed: [{ appName: "1957528513", platform: "windows" }] }));
    write(heroicGame("1957528513"), JSON.stringify({ "1957528513": { enviromentOptions: [{ key: "PROTON_PREFER_SDL", value: "1" }] }, version: "v0" }, null, 2));
    // Lutris: Ghostrunner with an argument of the player's own.
    const lutris = join(home, ".local/share/lutris");
    write(join(lutris, "runners/wine.yml"), "wine:\n  version: GE-Proton10-34\n");
    write(lutrisGame(), 'game:\n  exe: Ghostrunner.exe\n  args: -nosplash\nsystem:\n  env:\n    PROTON_PREFER_SDL: "1"\n');
    const db = new DatabaseSync(join(lutris, "pga.db"));
    db.exec("CREATE TABLE games (slug TEXT, name TEXT, runner TEXT, installed INTEGER, configpath TEXT)");
    db.exec("INSERT INTO games VALUES ('ghostrunner', 'Ghostrunner', 'wine', 1, 'ghostrunner-1')");
    db.close();
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  const modeFixes = (r: GamesReport) => allFixes(r).filter((f) => f.kind === "graphics-mode");

  it("is recommended per launcher where the flag is missing, with the vkd3d-proton note", () => {
    const { report } = scan(deps());
    const fixes = modeFixes(report);
    expect(fixes.map((f) => f.id).sort()).toEqual([`${steamId()}:mode:1139900`, `${steamId()}:mode:2144740`, `${heroicId()}:mode:1957528513`, `${lutrisId()}:mode:ghostrunner-1`].sort());
    expect(fixes.every((f) => f.recommended)).toBe(true);
    const steam = fixes.find((f) => f.id.endsWith(":1139900"))!;
    expect(steam.label).toEqual({ key: "label.mode", params: { game: "Ghostrunner", api: "DirectX 12", feature: { key: "unlock.rayTracing" }, flag: "-dx12" } });
    expect(steam.why).toMatchObject({ key: "why.modeSteam", params: { args: "PROTON_PREFER_SDL=1 %command% -dx12", proton: { key: "why.modeVkd3d" } } });
    expect(fixes.find((f) => f.launcher === "heroic")!.why).toMatchObject({ key: "why.modeHeroic", params: { args: "-dx12" } });
    expect(report.games.find((g) => g.title === "Hades")!.mode).toBeUndefined();
    expect(report.games.find((g) => g.id === "1139900")!.mode?.state).toBe("needed");
  });

  it("Steam: merges with PROTON_PREFER_SDL and the gamescope HDR line; Undo restores", async () => {
    const before = read(localconfig());
    const fresh = scan(deps());
    const r = await applyFixes(fresh, [`${steamId()}:mode:1139900`, `${steamId()}:mode:2144740`], [], applyDeps());
    expect(r.applied.every((a) => a.ok)).toBe(true);
    const after = read(localconfig());
    expect(after).toContain('"LaunchOptions"\t\t"PROTON_PREFER_SDL=1 %command% -dx12"');
    expect(after).toContain(`"LaunchOptions"\t\t"${HDR_LINE} -windowed -dx12"`);
    const again = scan(deps()).report;
    expect(modeFixes(again).filter((f) => f.launcher === "steam")).toEqual([]);
    expect(again.games.find((g) => g.id === "1139900")!.mode?.state).toBe("set");
    backups.restore(r.backupId!);
    expect(read(localconfig())).toBe(before);
  });

  it("Heroic: launcherArgs next to the game's own settings; Undo restores", async () => {
    const before = read(heroicGame("1957528513"));
    const r = await applyFixes(scan(deps()), [`${heroicId()}:mode:1957528513`], [], applyDeps());
    expect(r.applied[0].ok).toBe(true);
    expect(JSON.parse(read(heroicGame("1957528513")))["1957528513"]).toEqual({ enviromentOptions: [{ key: "PROTON_PREFER_SDL", value: "1" }], launcherArgs: "-dx12" });
    backups.restore(r.backupId!);
    expect(read(heroicGame("1957528513"))).toBe(before);
  });

  it("Lutris: game.args keeps the player's argument; Undo restores", async () => {
    const before = read(lutrisGame());
    const r = await applyFixes(scan(deps()), [`${lutrisId()}:mode:ghostrunner-1`], [], applyDeps());
    expect(r.applied[0].ok).toBe(true);
    expect(read(lutrisGame())).toBe('game:\n  exe: Ghostrunner.exe\n  args: -nosplash -dx12\nsystem:\n  env:\n    PROTON_PREFER_SDL: "1"\n');
    backups.restore(r.backupId!);
    expect(read(lutrisGame())).toBe(before);
  });

  it("leaves the player's own mode alone", () => {
    write(localconfig(), vdfApps([["1139900", "%command% -dx11"]]));
    const game = scan(deps()).report.games.find((g) => g.id === "1139900")!;
    expect(game.mode).toMatchObject({ state: "own", own: "-dx11" });
    expect(game.fixes.filter((f) => f.kind === "graphics-mode")).toEqual([]);
  });
});

describe("the graphics-mode fix on Windows (Steam)", () => {
  let real: NodeJS.Platform;
  let home: string;
  const saved = { x86: process.env["ProgramFiles(x86)"], pf: process.env.ProgramFiles };
  const steamRoot = () => join(home, "pf", "Steam");
  const localconfig = () => join(steamRoot(), "userdata", "1", "config", "localconfig.vdf");

  beforeEach(() => {
    real = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    home = realpathSync(mkdtempSync(join(tmpdir(), "ds5-win-mode-")));
    process.env["ProgramFiles(x86)"] = join(home, "pf");
    delete process.env.ProgramFiles;
    steamHome(steamRoot(), [
      ["1139900", "Ghostrunner", ""],
      ["2144740", "Ghostrunner 2", "-windowed"],
    ]);
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

  it("adds the flag to Steam's launch options, without the Proton note; Undo restores", async () => {
    const backups = new Backups(join(home, "backups"));
    const before = read(localconfig());
    const fresh = scan({ home, ourProton: null, latestProton: null, latestSize: null, running: new Set(), audioCards: [] });
    const prefix = `steam-${idHash(steamRoot())}`;
    const fixes = allFixes(fresh.report).filter((f) => f.kind === "graphics-mode");
    expect(fixes.map((f) => f.id).sort()).toEqual([`${prefix}:mode:1139900`, `${prefix}:mode:2144740`]);
    expect(fixes[0].why).toMatchObject({ key: "why.modeSteam", params: { proton: "" } });
    const r = await applyFixes(
      fresh,
      fixes.map((f) => f.id),
      [],
      { backups, launchers: noControl, restartWirePlumber: async () => undefined, setCardProfile: async () => undefined },
    );
    expect(r.applied.every((a) => a.ok)).toBe(true);
    const after = read(localconfig());
    expect(after).toMatch(/"1139900"\s*\{\s*"LaunchOptions"\t\t"-dx12"/);
    expect(after).toContain('"LaunchOptions"\t\t"-windowed -dx12"');
    backups.restore(r.backupId!);
    expect(read(localconfig())).toBe(before);
  });
});
