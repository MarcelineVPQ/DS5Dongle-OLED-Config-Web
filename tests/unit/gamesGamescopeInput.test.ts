// Steam Input and gamescope (Marcy's real case, 2026-10-17): Assetto Corsa
// Rally (Steam 3917090) on GE-Proton11-7.2-DualSense, Steam Input on Steam's
// default, with her own gamescope HDR line, saw no controller at all: Steam
// can't see gamescope's focus, so it never hands its virtual pad to the game.
// The app said "nothing to set up", and ticking "Controller not detected"
// offered nothing. Now Turn off Steam Input is offered (and Turn on HDR turns
// it off with gamescope), with the same localconfig write and Undo.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Backups } from "../../electron/main/games/backup";
import { applyFixes, idHash, scan, type ScanDeps } from "../../electron/main/games/games";
import type { LauncherControl } from "../../electron/main/games/processes";
import { GAMESCOPE_MIN } from "../../src/desktop/games/hdrSetup";
import type { HdrSystem } from "../../src/desktop/games/types";
import { asLinux } from "../support/platform";

asLinux();

const OURS = "GE-Proton11-7.2-DualSense";
const ACR = "3917090";
const HER_LINE = "ENABLE_GAMESCOPE_WSI=1 gamescope --backend wayland --hdr-enabled -f -W 3840 -H 2160 --force-grab-cursor -- %command%";

let home: string;
let backups: Backups;
const steamRoot = () => join(home, ".steam/debian-installation");
const localconfig = () => join(steamRoot(), "userdata/1/config/localconfig.vdf");
const key = () => `steam-${idHash(steamRoot())}:steam:${ACR}`;
const read = (path: string) => readFileSync(path, "utf8");

function write(path: string, text: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

// Her Steam: the game on our Proton, no per-game Steam Input entry (the default), her launch options.
function buildHome(options: string) {
  const steam = steamRoot();
  write(
    join(steam, "config/config.vdf"),
    `"InstallConfigStore"\n{\n\t"Software"\n\t{\n\t\t"Valve"\n\t\t{\n\t\t\t"Steam"\n\t\t\t{\n\t\t\t\t"CompatToolMapping"\n\t\t\t\t{\n\t\t\t\t\t"${ACR}"\n\t\t\t\t\t{\n\t\t\t\t\t\t"name"\t\t"${OURS}"\n\t\t\t\t\t\t"config"\t\t""\n\t\t\t\t\t\t"priority"\t\t"250"\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n}\n`,
  );
  write(
    localconfig(),
    `"UserLocalConfigStore"\n{\n\t"Software"\n\t{\n\t\t"Valve"\n\t\t{\n\t\t\t"Steam"\n\t\t\t{\n\t\t\t\t"apps"\n\t\t\t\t{\n\t\t\t\t\t"${ACR}"\n\t\t\t\t\t{\n\t\t\t\t\t\t"LaunchOptions"\t\t"${options}"\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n}\n`,
  );
  write(join(steam, "steamapps/libraryfolders.vdf"), `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"${steam}"\n\t}\n}\n`);
  write(join(steam, `steamapps/appmanifest_${ACR}.acf`), `"AppState"\n{\n\t"appid"\t\t"${ACR}"\n\t"name"\t\t"Assetto Corsa Rally"\n}\n`);
  write(join(steam, "compatibilitytools.d", OURS, "proton"), "");
  write(join(steam, "compatibilitytools.d", OURS, "version"), `1791920210 ${OURS}`);
}

const READY: HdrSystem = {
  check: "kde",
  screens: [{ name: "DP-5", hdr: true, width: 3840, height: 2160, refresh: 59.94 }],
  gamescope: { path: "/usr/games/gamescope", version: "3.16.20", min: GAMESCOPE_MIN.kde, layer: true, flatpak: false },
};
const deps = (o: { notDetected?: boolean; hdr?: boolean } = {}): ScanDeps => ({
  home,
  ourProton: OURS,
  latestProton: null,
  latestSize: null,
  running: new Set(),
  audioCards: [],
  notDetected: new Set(o.notDetected ? [key()] : []),
  hdrMarked: new Set(o.hdr ? [key()] : []),
  hdr: READY,
});
const control: LauncherControl = { running: () => new Set(), gameRunning: () => false, plan: () => null, close: async () => "closed", reopen: async () => true };
const game = (d = deps()) => scan(d).report.games.find((g) => g.key === key())!;
const inputFix = (d = deps()) => game(d).fixes.find((f) => f.kind === "steam-input-off");

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "ds5-gsinput-")));
  backups = new Backups(join(home, "backups"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("Steam Input inside gamescope", () => {
  it("her line: Turn off Steam Input is offered, saying why", () => {
    buildHome(HER_LINE);
    const g = game();
    expect(g.steamInput).toBe("global");
    expect(g.hdr).toBeUndefined(); // not an HDR game on our list
    const fix = inputFix()!;
    expect(fix).toMatchObject({ id: `${key().replace(/:steam:\d+$/, "")}:input:${ACR}`, launcher: "steam", recommended: true, label: { key: "label.steamInput" } });
    expect(fix.why).toEqual({ key: "why.steamInputGamescope", params: { game: "Assetto Corsa Rally" } });
  });

  it("applies the same localconfig write as today's Steam Input fix, and Undo puts it back", async () => {
    buildHome(HER_LINE);
    const before = read(localconfig());
    const r = await applyFixes(scan(deps()), [inputFix()!.id], [], { backups, launchers: control, restartWirePlumber: async () => undefined, setCardProfile: async () => undefined });
    expect(r.blockedBy).toEqual([]);
    expect(r.backupId).toBeTruthy();
    expect(read(localconfig())).toMatch(new RegExp(`"apps"\\s*\\{\\s*"${ACR}"\\s*\\{\\s*"UseSteamControllerConfig"\\s*"0"`));
    // The launch options are left as she wrote them.
    expect(read(localconfig())).toContain(HER_LINE);
    // Off now: nothing more to offer.
    expect(inputFix()).toBeUndefined();
    backups.restore(r.backupId!);
    expect(read(localconfig())).toBe(before);
  });

  it("without gamescope: only when she ticked Controller not detected", () => {
    buildHome("%command%");
    expect(inputFix()).toBeUndefined();
    const g = game(deps({ notDetected: true }));
    expect(g.fixes.find((f) => f.kind === "steam-input-off")!.why).toEqual({ key: "why.steamInputNotDetected", params: { game: "Assetto Corsa Rally" } });
    // Not "Steam already gives it an Xbox controller" any more: the standard gamepad is planned with Steam Input off.
    expect(g.gamepad).not.toBe("steam-input");
  });

  it("Turn on HDR turns Steam Input off too, so the HDR setup never leaves the game without a controller", async () => {
    buildHome("%command%");
    const d = deps({ hdr: true });
    const hdr = game(d).fixes.find((f) => f.kind === "hdr-on")!;
    expect(hdr.why).toMatchObject({ key: "why.hdrSteam", params: { input: { key: "why.hdrInputOff" } } });
    await applyFixes(scan(d), [hdr.id], [], { backups, launchers: control, restartWirePlumber: async () => undefined, setCardProfile: async () => undefined });
    const after = read(localconfig());
    expect(after).toMatch(/gamescope/);
    expect(after).toMatch(new RegExp(`"${ACR}"\\s*\\{\\s*"UseSteamControllerConfig"\\s*"0"`));
    // Set up: nothing left to offer, and no "nothing to set up" that isn't true.
    expect(game(d).fixes.filter((f) => f.kind === "steam-input-off" || f.kind === "hdr-on")).toEqual([]);
  });
});
