// The Proton card's Remove (Linux) waits while Steam or Heroic runs: they list
// their Proton builds while open, and a game may be running with the build.
// The card says which to close (keyed text, all 7 languages); nothing is removed.
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GamesService } from "../../electron/main/games/service";
import { NO_HDR_SYSTEM } from "../../src/desktop/games/hdrSetup";
import type { LauncherId } from "../../src/desktop/games/types";
import { keyedText } from "../../src/errorText";
import { asLinux } from "../support/platform";

asLinux();

const OURS = "GE-Proton11-7-DualSense";
let home: string;
let realHome: string | undefined;
beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "ds5-proton-remove-")));
  realHome = process.env.HOME;
  process.env.HOME = home;
  // Heroic with our build in its Proton folder; no game and no default runs with it.
  const heroic = join(home, ".config/heroic");
  mkdirSync(join(heroic, "tools/proton", OURS), { recursive: true });
  writeFileSync(join(heroic, "config.json"), JSON.stringify({ defaultSettings: {} }));
  writeFileSync(join(heroic, "tools/proton", OURS, "proton"), "#!/bin/sh\n");
});
afterEach(() => {
  process.env.HOME = realHome;
  rmSync(home, { recursive: true, force: true });
});

const build = () => join(home, ".config/heroic/tools/proton", OURS, "proton");
function service(running: LauncherId[]) {
  return new GamesService({
    userData: join(home, "userdata"),
    allowed: () => true,
    fetchManifest: async () => null,
    download: () => Promise.reject(new Error("not reached")),
    onProtonProgress: () => undefined,
    notDetected: () => new Set(),
    hdrMarked: () => new Set(),
    launchers: { running: () => new Set(running), gameRunning: () => false, plan: () => null, close: async () => "closed", reopen: async () => true },
    probes: { audioCards: async () => [], hdr: async () => NO_HDR_SYSTEM },
  });
}

describe("Remove while a launcher runs", () => {
  it("refuses while Heroic runs and says to close it; the build stays", async () => {
    expect(await service(["heroic"]).removeProton(OURS)).toEqual({ ok: false, message: keyedText("desktop.errors.main.protonLauncherRunning", { name: OURS, launcher: "Heroic" }) });
    expect(existsSync(build())).toBe(true);
  });

  it("refuses while Steam runs", async () => {
    expect(await service(["steam", "lutris"]).removeProton(OURS)).toEqual({ ok: false, message: keyedText("desktop.errors.main.protonLauncherRunning", { name: OURS, launcher: "Steam" }) });
    expect(existsSync(build())).toBe(true);
  });

  it("names both when Steam and Heroic run", async () => {
    expect(await service(["steam", "heroic"]).removeProton(OURS)).toEqual({ ok: false, message: keyedText("desktop.errors.main.protonLaunchersRunning", { name: OURS }) });
    expect(existsSync(build())).toBe(true);
  });

  it("removes it once they're closed", async () => {
    const r = await service([]).removeProton(OURS);
    expect(r).toMatchObject({ ok: true, name: OURS });
    expect(existsSync(build())).toBe(false);
  });
});
