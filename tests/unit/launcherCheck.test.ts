// The review names the launchers running now, not the ones the last scan saw,
// and a change a launcher wrote back is noticed.
import { describe, expect, it } from "vitest";
import { forgetApplied, overwrittenBy, rememberApplied, restartFor, startedSinceCheck } from "../../src/desktop/games/launcherCheck";
import type { Fix, GamesReport, LauncherInfo } from "../../src/desktop/games/types";

const launcher = (id: "steam" | "heroic" | "lutris", running: boolean) => ({ id, running, found: true, flatpak: false, fixes: [] }) as unknown as LauncherInfo;
const report = (running: Array<"steam" | "heroic" | "lutris">) => ({ launchers: (["steam", "heroic", "lutris"] as const).map((id) => launcher(id, running.includes(id))) }) as unknown as GamesReport;
const fix = (id: string, owner: Fix["launcher"]) => ({ id, launcher: owner, files: [] }) as unknown as Fix;
const dx12 = fix("heroic-1:mode:1957528513", "heroic");

describe("the review's restart notice", () => {
  it("names Heroic when it started after the scan (the fresh check wins)", () => {
    const stale = report([]); // Heroic closed at scan time
    expect(restartFor(stale, [dx12])).toEqual([]);
    expect(restartFor(stale, [dx12], ["heroic"])).toEqual(["heroic"]);
  });

  it("drops a launcher that quit since the scan, and keeps only the changes' owners", () => {
    expect(restartFor(report(["heroic", "steam"]), [dx12], [])).toEqual([]);
    expect(restartFor(report([]), [dx12], ["steam", "heroic"])).toEqual(["heroic"]);
  });

  it("falls back to the scan's answer when the check couldn't run", () => {
    expect(restartFor(report(["heroic"]), [dx12], null)).toEqual(["heroic"]);
  });

  it("tells a launcher that started since the check from one that didn't close", () => {
    expect(startedSinceCheck({ blockedBy: ["heroic"] })).toBe(true);
    expect(startedSinceCheck({ blockedBy: ["heroic"], problem: "timeout" })).toBe(false);
    expect(startedSinceCheck({ blockedBy: [] })).toBe(false);
  });
});

describe("a change the launcher wrote back", () => {
  it("is named by its launcher when a later scan recommends it again", () => {
    forgetApplied();
    rememberApplied([dx12.id], 1000);
    expect(overwrittenBy([dx12, fix("other", "steam")], 2000)).toEqual(["heroic"]);
    expect(overwrittenBy([], 2000)).toEqual([]); // still applied
  });

  it("is forgotten after an Undo and after a while", () => {
    forgetApplied();
    rememberApplied([dx12.id], 0);
    expect(overwrittenBy([dx12], 16 * 60_000)).toEqual([]);
    rememberApplied([dx12.id], 0);
    forgetApplied();
    expect(overwrittenBy([dx12], 1)).toEqual([]);
  });

  it("never blames the system (audio) for its own changes", () => {
    forgetApplied();
    rememberApplied(["audio"], 0);
    expect(overwrittenBy([fix("audio", "system")], 1)).toEqual([]);
  });
});
