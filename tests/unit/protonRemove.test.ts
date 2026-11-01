// The Proton card's Remove (Linux; 2026-10-31 app review S5): only our own
// build names, from every launcher folder (the folder and the links to it),
// never a folder of that name without a build in it, and the scan says what
// still runs with each build (Remove is refused while anything does).
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildPlaces, buildUsers, installedBuilds, removeBuild } from "../../electron/main/games/proton";
import type { GamesReport } from "../../src/desktop/games/types";

const OURS = "GE-Proton11-7-DualSense";
const NEWER = "GE-Proton11-10-DualSense";
const STOCK = "GE-Proton10-1";
let root: string | undefined;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

// Steam's folder holds the builds; Heroic's has a link to Steam's copy of
// ours (installProton's extra launcher).
function launchers() {
  root = mkdtempSync(join(tmpdir(), "proton-remove-"));
  const steam = join(root, "steam");
  const heroic = join(root, "heroic");
  // loop: test — three builds
  for (const name of [OURS, NEWER, STOCK]) {
    mkdirSync(join(steam, name), { recursive: true });
    writeFileSync(join(steam, name, "proton"), "#!/bin/sh\n");
  }
  mkdirSync(heroic);
  symlinkSync(join(steam, OURS), join(heroic, OURS), "dir");
  return { steam, heroic, dirs: [steam, heroic] };
}
const gone = (path: string) => lstatSync(path, { throwIfNoEntry: false }) === undefined;
// A scan's games (their runner) and launchers (their default), as buildUsers reads them.
function report(games: Array<{ title: string; runner: string | null }>, defaults: Record<string, string | null> = {}): Pick<GamesReport, "games" | "launchers"> {
  const launchers = Object.entries(defaults).map(([id, defaultRunner]) => ({ id, defaultRunner }));
  return { games, launchers } as unknown as Pick<GamesReport, "games" | "launchers">;
}

describe("where a build is", () => {
  it("its folder and every link to it", () => {
    const { steam, heroic, dirs } = launchers();
    expect(buildPlaces(OURS, dirs)).toEqual([
      { path: join(steam, OURS), link: false },
      { path: join(heroic, OURS), link: true },
    ]);
  });

  it("our builds only, newest first, with what still runs with each", () => {
    const { steam, heroic, dirs } = launchers();
    expect(installedBuilds(dirs, report([{ title: "Elden Ring", runner: OURS }], { steam: NEWER }))).toEqual([
      { name: NEWER, paths: [join(steam, NEWER)], usedBy: { games: [], launchers: ["steam"] } },
      { name: OURS, paths: [join(steam, OURS), join(heroic, OURS)], usedBy: { games: ["Elden Ring"], launchers: [] } },
    ]);
  });

  it("nothing runs with a build no game and no launcher default names", () => {
    expect(
      buildUsers(
        report(
          [
            { title: "Hades", runner: STOCK },
            { title: "Balatro", runner: null },
          ],
          { steam: STOCK, heroic: null },
        ),
        OURS,
      ),
    ).toEqual({ games: [], launchers: [] });
  });
});

describe("removing a build", () => {
  it("removes the links first, then the folder; other builds stay", () => {
    const { steam, heroic, dirs } = launchers();
    expect(removeBuild(OURS, dirs)).toEqual([join(heroic, OURS), join(steam, OURS)]);
    expect(gone(join(heroic, OURS))).toBe(true);
    expect(gone(join(steam, OURS))).toBe(true);
    expect(existsSync(join(steam, NEWER, "proton"))).toBe(true);
    expect(existsSync(join(steam, STOCK, "proton"))).toBe(true);
  });

  it("refuses anything but one of our own build names", () => {
    const { steam, dirs } = launchers();
    // loop: test — a few names that aren't ours
    for (const name of [STOCK, "", "..", "../steam", `${OURS}/..`, `../${OURS}`]) expect(removeBuild(name, dirs), name).toEqual([]);
    expect(existsSync(join(steam, STOCK, "proton"))).toBe(true);
    expect(existsSync(join(steam, OURS, "proton"))).toBe(true);
  });

  it("leaves a folder of that name without a build in it (not ours)", () => {
    const { steam, heroic, dirs } = launchers();
    mkdirSync(join(heroic, NEWER));
    writeFileSync(join(heroic, NEWER, "notes.txt"), "mine");
    expect(removeBuild(NEWER, dirs)).toEqual([join(steam, NEWER)]);
    expect(existsSync(join(heroic, NEWER, "notes.txt"))).toBe(true);
  });

  // The card lists only builds with a proton script somewhere (installedBuilds), so a
  // dangling link is reached next to a real copy of the same build (2026-11-01 re-review N7).
  it("a dangling link of the build's name goes with the build", () => {
    const { steam, heroic, dirs } = launchers();
    rmSync(join(heroic, OURS));
    symlinkSync(join(root!, "moved", OURS), join(heroic, OURS), "dir"); // points at a copy that's gone
    expect(installedBuilds(dirs, report([])).find((b) => b.name === OURS)?.paths).toEqual([join(steam, OURS), join(heroic, OURS)]);
    expect(removeBuild(OURS, dirs)).toEqual([join(heroic, OURS), join(steam, OURS)]);
    expect(gone(join(heroic, OURS))).toBe(true);
    expect(gone(join(steam, OURS))).toBe(true);
  });
});
