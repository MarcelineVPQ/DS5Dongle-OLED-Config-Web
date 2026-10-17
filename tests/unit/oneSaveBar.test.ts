// One save model (IA audit Q1, page rule 4), as a gate: the bar's Save /
// Revert / Save to profile live in SaveBar.tsx only. No section gets its own
// Save, Apply or Revert for a board setting again (the buttons, curves and
// calibration had their own; a PC sleep switch saved at once).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
// A path from the repo root with "/" on every OS (Windows gives backslashes).
const rel = (f: string) => relative(ROOT, f).split(sep).join("/");
const BAR = "src/desktop/SaveBar.tsx";
// The labels of a save or a revert of board settings, and the old per-section ones.
const SAVE_KEYS = /["'`]desktop\.(bar\.(save|saveProfileTo|revert)|calib\.(save|revert)|live\.remapApply)["'`]/;

function files(dir: string): string[] {
  // loop: test — the source tree
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("one save bar", () => {
  it("only SaveBar.tsx shows a Save or Revert for board settings", () => {
    // loop: test
    const offenders = files(join(ROOT, "src")).filter((f) => rel(f) !== BAR && SAVE_KEYS.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => rel(f))).toEqual([]);
  });

  it("no section writes a board setting at once: setPowerFlags, applyRemap, setCalibration and saved stick curves go through the drafts", () => {
    const allowed = new Set(["src/desktop/live/boardDrafts.tsx", "src/desktop/live/useRemap.ts", "src/hooks/useDs5Bridge.ts"]);
    const WRITES = /\.(setPowerFlags|applyRemap|setCalibration)\(|applyRemapExtra\([^)]*false\)|applyStickCurves\([^)]*false\)/; // a game profile's temporary writes (true) are the profile's
    // loop: test
    const offenders = files(join(ROOT, "src/desktop")).filter((f) => !allowed.has(rel(f)) && WRITES.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => rel(f))).toEqual([]);
  });
});
