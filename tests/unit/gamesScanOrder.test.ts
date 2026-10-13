// What the Games page shows after a change matches the launchers' files
// (owner report 2026-10-13: the game page kept showing the old Proton after
// Apply), and the build picker never moves a game to an older or wrongly
// ordered build (Apply all moved Ghostrunner and Control from
// GE-Proton11-7.2-DualSense to GE-Proton9-27 although GE-Proton-latest was installed).
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { idHash, scan, type ScanDeps } from "../../electron/main/games/games";
import type { LauncherControl } from "../../electron/main/games/processes";
import { buildVersionKey, pickBuild, preferSdlBuild } from "../../electron/main/games/proton";
import { NO_HDR_SYSTEM } from "../../src/desktop/games/hdrSetup";
import { GamesService } from "../../electron/main/games/service";
import { latestOnly, thenRescan } from "../../src/desktop/games/scanOrder";
import { asLinux } from "../support/platform";

asLinux();

const OURS = "GE-Proton11-7.2-DualSense";
const OLD = "GE-Proton11-7-DualSense";
const HDR = 'self.check_environment("PROTON_ENABLE_WAYLAND", "wayland")\nself.check_environment("PROTON_ENABLE_HDR", "hdr")\n';

function write(path: string, text: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

let home: string;
const heroic = () => join(home, ".config/heroic");
const tools = () => join(heroic(), "tools/proton");
const gameFile = () => join(heroic(), "GamesConfig/ghost.json");
const heroicId = () => `heroic-${idHash(heroic())}`;
const proton = (name: string, version: string, script = HDR) => {
  write(join(tools(), name, "proton"), script);
  write(join(tools(), name, "version"), `1791920210 ${version}`);
};
const wine = (name: string) => ({ bin: join(tools(), name, "proton"), name, type: "proton" });

// The owner's Heroic: GE-Proton-latest (really GE-Proton10-34), our old and
// renamed builds, GE-Proton9-27; Ghostrunner (XInput) on `runner`.
function buildHeroic(runner: string, withOurs = true) {
  write(join(heroic(), "config.json"), JSON.stringify({ defaultSettings: {} }));
  proton("GE-Proton-latest", "GE-Proton10-34");
  proton(OLD, "GE-Proton11-7");
  if (withOurs) proton(OURS, OURS);
  proton("GE-Proton9-27", "GE-Proton9-27", "");
  write(join(heroic(), "sideload_apps/library.json"), JSON.stringify({ games: [{ app_name: "ghost", title: "Ghostrunner", is_installed: true, install: { platform: "windows" } }] }));
  write(gameFile(), JSON.stringify({ ghost: { wineVersion: wine(runner) }, version: "v0" }, null, 2));
}
const deps = (): ScanDeps => ({ home, ourProton: OURS, latestProton: null, latestSize: null, running: new Set(), audioCards: [] });

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "ds5-order-")));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("choosing the build to move a game to", () => {
  it("orders by GE version, reading GE-Proton-latest's version file", () => {
    buildHeroic(OLD);
    expect(buildVersionKey("GE-Proton-latest", [tools()])).toEqual([10, 34, 1]);
    expect(buildVersionKey(OURS, [tools()])).toEqual([11, 7, 2]);
    expect(buildVersionKey("Proton - Experimental", [tools()])).toBeNull();
    const names = ["GE-Proton9-27", "GE-Proton-latest", OLD];
    // No build of ours honours PROTON_PREFER_SDL: the newest stock one, not 9-27.
    expect(preferSdlBuild(names, [tools()])).toBe("GE-Proton-latest");
    expect(preferSdlBuild([...names, OURS], [tools()])).toBe(OURS);
  });

  it("never picks a build older than the game's own", () => {
    buildHeroic(OLD);
    expect(preferSdlBuild(["GE-Proton9-27", "GE-Proton-latest"], [tools()], OLD)).toBeNull();
    expect(pickBuild(["GE-Proton9-27", "GE-Proton-latest"], [tools()], () => true, "GE-Proton9-27")).toBe("GE-Proton-latest");
  });

  it("the owner's case: a game on our renamed build stays on it", () => {
    buildHeroic(OURS);
    const report = scan({ ...deps(), notDetected: new Set([`${heroicId()}:sideload:ghost`]) }).report;
    const game = report.games.find((g) => g.id === "ghost")!;
    expect(game.gamepad).toBe("needed"); // only the option is missing
    const fix = game.fixes.find((f) => f.kind === "standard-gamepad")!;
    expect(fix.why).toMatchObject({ params: { runner: "" } }); // no runner switch
  });

  it("the owner's case: from the old build to the renamed one; without it, nothing older (no 9-27, no 10-34)", () => {
    buildHeroic(OLD);
    const game = () => scan(deps()).report.games.find((g) => g.id === "ghost")!;
    expect(game().fixes.find((f) => f.kind === "standard-gamepad")!.why).toMatchObject({ params: { runner: { params: { proton: OURS } } } });
    rmSync(join(tools(), OURS), { recursive: true });
    expect(game().gamepad).toBe("no-build");
    expect(game().fixes.filter((f) => f.kind !== "graphics-mode")).toEqual([]); // its graphics-mode fix is its own (gamesMode.test.ts)
  });
});

describe("the page shows what the files say after a change", () => {
  // The service's home is os.homedir(): HOME on Linux and macOS, USERPROFILE on Windows.
  const realHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  afterEach(() => {
    for (const [k, v] of Object.entries(realHome)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("a scan asked for during a change reads the files after it", async () => {
    buildHeroic(OLD);
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    // The change's own scan waits (as when launchers are being closed) until the page's scan is asked for.
    let release!: () => void;
    const held = new Promise<[]>((r) => (release = () => r([])));
    let first = true;
    const control: LauncherControl = { running: () => new Set(), gameRunning: () => false, plan: () => null, close: async () => "closed", reopen: async () => true };
    const service = new GamesService({
      userData: join(home, "userdata"),
      allowed: () => true,
      fetchManifest: () => Promise.reject(new Error("offline")),
      download: () => Promise.reject(new Error("offline")),
      onProtonProgress: () => undefined,
      notDetected: () => new Set(),
      hdrMarked: () => new Set(),
      launchers: control,
      probes: {
        audioCards: () => (first ? ((first = false), held) : Promise.resolve([])),
        hdr: async () => NO_HDR_SYSTEM,
      },
    });
    const applying = service.apply([`${heroicId()}:xinput:ghost`], []);
    const scanning = service.scan();
    release();
    const report = await scanning;
    expect((await applying).applied[0].ok).toBe(true);
    expect(JSON.parse(readFileSync(gameFile(), "utf8")).ghost.wineVersion.name).toBe(OURS);
    expect(report.games.find((g) => g.id === "ghost")!.runner).toBe(OURS);
  });

  it("Heroic started after the scan: the review's check names it, Apply refuses until it's named, paths show as ~/", async () => {
    buildHeroic(OLD);
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    const running = new Set<"heroic">();
    const closed: string[] = [];
    const control: LauncherControl = {
      running: () => new Set(running),
      gameRunning: () => false,
      plan: () => ({ cmd: "heroic", args: [] }),
      close: async (l) => (closed.push(l), running.delete("heroic"), "closed"),
      reopen: async () => (running.add("heroic"), true),
    };
    const service = new GamesService({
      userData: join(home, "userdata"),
      allowed: () => true,
      fetchManifest: () => Promise.reject(new Error("offline")),
      download: () => Promise.reject(new Error("offline")),
      onProtonProgress: () => undefined,
      notDetected: () => new Set(),
      hdrMarked: () => new Set(),
      launchers: control,
      probes: { audioCards: async () => [], hdr: async () => NO_HDR_SYSTEM },
    });
    const report = await service.scan(); // Heroic closed
    const fix = report.games.find((g) => g.id === "ghost")!.fixes.find((f) => f.kind === "standard-gamepad")!;
    expect(fix.files).toEqual([join("~", ".config/heroic/GamesConfig/ghost.json")]); // not the test HOME's full path
    expect(report.launchers.find((l) => l.id === "heroic")!.running).toBe(false);

    running.add("heroic"); // the player starts Heroic; Home isn't rescanned
    expect(await service.runningLaunchers()).toEqual(["heroic"]); // the review's check
    const before = readFileSync(gameFile(), "utf8");
    const refused = await service.apply([fix.id], []); // a page that still names nothing
    expect(refused).toEqual({ applied: [], backupId: null, blockedBy: ["heroic"] });
    expect(readFileSync(gameFile(), "utf8")).toBe(before);
    expect(closed).toEqual([]); // nothing closed before the player was told

    const done = await service.apply([fix.id], ["heroic"]); // after the notice
    expect(done.applied[0].ok).toBe(true);
    expect(closed).toEqual(["heroic"]);
    expect(running.has("heroic")).toBe(true); // reopened
    expect(JSON.parse(readFileSync(gameFile(), "utf8")).ghost.wineVersion.name).toBe(OURS);
  });

  it("only the newest of overlapping scans is shown, and a change always rescans", async () => {
    const latest = latestOnly();
    let finishOld!: (v: string) => void;
    const old = latest(new Promise<string>((r) => (finishOld = r)));
    const fresh = latest(Promise.resolve("new"));
    expect(await fresh).toEqual({ value: "new", current: true });
    finishOld("old");
    expect(await old).toEqual({ value: "old", current: false });

    const rescans: string[] = [];
    await expect(
      thenRescan(
        () => Promise.reject(new Error("reopen failed")),
        () => rescans.push("rescan"),
      ),
    ).rejects.toThrow("reopen failed");
    expect(
      await thenRescan(
        async () => 1,
        () => rescans.push("rescan"),
      ),
    ).toBe(1);
    expect(rescans).toEqual(["rescan", "rescan"]);
  });
});
