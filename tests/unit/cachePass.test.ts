// @vitest-environment jsdom
// Cache pass batches 2, 3 and 4 (docs/CACHE_PASS_2026-10.md): kept state
// that went stale or was worked out again for nothing.
import { mkdirSync, mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtColorCache } from "../../electron/main/games/artColorCache";
import { EXE_RECHECK_MS, RunningGameWatcher, type ProcView, type RunningCandidate } from "../../electron/main/games/running";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ds5-cache-pass-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("game art colors (batch 2)", () => {
  it("are decoded once per art file + mtime, across scans", () => {
    const cover = join(dir, "cover.jpg");
    writeFileSync(cover, "x");
    utimesSync(cover, 1000, 1000);
    const decode = vi.fn(() => "#123456");
    const colors = new ArtColorCache(decode);
    expect(colors.get("steam:a", cover)).toBe("#123456");
    // A scan (the game is still in the library), then the tile asks again.
    colors.prune(new Set(["steam:a"]));
    expect(colors.get("steam:a", cover)).toBe("#123456");
    expect(decode).toHaveBeenCalledOnce();
    // The launcher rewrote the art: decoded again.
    utimesSync(cover, 2000, 2000);
    colors.get("steam:a", cover);
    expect(decode).toHaveBeenCalledTimes(2);
    // Another art file for the game: decoded again.
    const hero = join(dir, "hero.jpg");
    writeFileSync(hero, "y");
    colors.get("steam:a", hero);
    expect(decode).toHaveBeenCalledTimes(3);
  });

  it("forget a game that left the library; no art (or a missing file) is no color, without a decode", () => {
    const cover = join(dir, "cover.jpg");
    writeFileSync(cover, "x");
    const decode = vi.fn(() => "#123456");
    const colors = new ArtColorCache(decode);
    colors.get("steam:a", cover);
    colors.prune(new Set());
    colors.get("steam:a", cover);
    expect(decode).toHaveBeenCalledTimes(2);
    expect(colors.get("steam:b", undefined)).toBeNull();
    expect(colors.get("steam:c", join(dir, "gone.jpg"))).toBeNull();
    expect(decode).toHaveBeenCalledTimes(2);
  });
});

describe("Windows' running-game program index (batch 3)", () => {
  const proc = (comm: string): ProcView => ({ pid: 1, comm, args: [], cwd: null, env: {} });
  // settleMs 0: a change is reported on the second look.
  const watcher = (games: RunningCandidate[], procs: () => ProcView[]) => {
    const seen: Array<string | null> = [];
    const w = new RunningGameWatcher(
      () => games,
      (k) => seen.push(k),
      procs,
      0,
      3000,
      "win32",
    );
    const look = (now: number) => {
      w.tick(now);
      w.tick(now);
      return w.running;
    };
    return { look, seen };
  };
  // A minute later: past the recheck interval (a literal, so the old code's missing constant can't make the clock NaN).
  const LATER = 61_000;
  it("rechecks once a minute", () => expect(EXE_RECHECK_MS).toBeLessThan(LATER));

  it("a folder indexed while the game was still installing is read again", () => {
    const game = join(dir, "Game");
    mkdirSync(game);
    const { look } = watcher([{ key: "steam:a", launcher: "steam", id: "a", installDir: game }], () => [proc("Game.exe")]);
    expect(look(0)).toBeNull(); // nothing installed yet
    mkdirSync(join(game, "bin"));
    writeFileSync(join(game, "bin", "Game.exe"), "");
    expect(look(1000)).toBeNull(); // within the recheck interval: the index is kept
    expect(look(LATER)).toBe("steam:a");
  });

  it("an update that renamed the program (in a subfolder) is noticed", () => {
    const game = join(dir, "Game");
    mkdirSync(join(game, "bin"), { recursive: true });
    writeFileSync(join(game, "bin", "Old.exe"), "");
    utimesSync(join(game, "bin"), 1000, 1000);
    let running = "Old.exe";
    const { look } = watcher([{ key: "steam:a", launcher: "steam", id: "a", installDir: game }], () => [proc(running)]);
    expect(look(0)).toBe("steam:a");
    renameSync(join(game, "bin", "Old.exe"), join(game, "bin", "New.exe"));
    utimesSync(join(game, "bin"), 2000, 2000);
    running = "New.exe";
    expect(look(LATER)).toBe("steam:a");
  });
});

describe("the Games badge's count (batch 4)", () => {
  it("reads the declined list once per count, not once per change", async () => {
    const { waitingCount, DECLINED_KEY } = await import("../../src/desktop/pages/GamesPage");
    localStorage.setItem(DECLINED_KEY, JSON.stringify(["b"]));
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    try {
      const fix = (id: string) => ({ id, recommended: true, files: [] });
      const report = { launchers: [{ fixes: [fix("a"), fix("b")] }], system: { fixes: [fix("c")] }, games: [{ fixes: [fix("d")] }] } as never;
      expect(waitingCount(report)).toBe(3);
      expect(getItem.mock.calls.filter(([k]) => k === DECLINED_KEY)).toHaveLength(1);
    } finally {
      getItem.mockRestore();
      localStorage.clear();
    }
  });
});
