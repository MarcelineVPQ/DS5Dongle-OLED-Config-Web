// The test sheet (src/desktop/games/report.ts): its stored schema, the
// migration from the old checklist (fixtures: a dev.17 library), the helpers
// the page uses and the suggested rating.
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LibraryStore, LIBRARY_FILE } from "../../electron/main/games/libraryStore";
import { FEEDBACK_TAGS, LibraryFileSchema, MineSchema, type Mine } from "../../src/desktop/games/library";
import {
  EMPTY_SHEET,
  FAIL_DETAILS,
  REPORT_FEATURES,
  ReportSheetSchema,
  TAG_MIGRATION,
  countResults,
  isNotDetected,
  migrateTags,
  resultOf,
  setFlag,
  setResult,
  sheetOf,
  suggestedRating,
  testedOn,
  toggleDetail,
  type ReportSheet,
} from "../../src/desktop/games/report";
import { SetMineSchema } from "../../electron/main/ipc";

const FIXTURE = new URL("../fixtures/reports/library-dev17.json", import.meta.url);
const fixture = () => JSON.parse(readFileSync(FIXTURE, "utf8")) as { games: Record<string, { title: string; mine: Mine }> };

describe("the stored sheet", () => {
  it("has stable machine IDs for every feature, result, detail and flag", () => {
    expect(REPORT_FEATURES).toEqual(["controller-detected", "adaptive-triggers", "haptic-feedback", "speaker", "microphone", "light-bar", "stays-connected"]);
    expect(FAIL_DETAILS).toEqual({ "haptic-feedback": ["weak", "rumble-only"], speaker: ["problems"] });
  });

  it("accepts a sheet and refuses translated words, unknown features, details on a Pass or on the wrong feature", () => {
    const ok: ReportSheet = {
      schemaVersion: 1,
      results: { "adaptive-triggers": { result: "pass" }, "haptic-feedback": { result: "fail", details: ["weak"] }, "stays-connected": { result: "fail" } },
      setup: { "steam-input-off": true },
      conflicts: ["haptic-feedback"],
    };
    expect(ReportSheetSchema.safeParse(ok).success).toBe(true);
    const bad = [
      { ...ok, schemaVersion: 2 },
      { ...ok, results: { "adaptive-triggers": { result: "Pass" } } },
      { ...ok, results: { triggers: { result: "pass" } } },
      { ...ok, results: { "haptic-feedback": { result: "pass", details: ["weak"] } } },
      { ...ok, results: { speaker: { result: "fail", details: ["weak"] } } },
      { ...ok, results: { "stays-connected": { result: "fail", details: [] } } },
      { ...ok, results: { microphone: { result: "not-tested" } } }, // Not tested is no entry
      { ...ok, setup: { "steam-input": true } },
      { ...ok, label: "Adaptive triggers work" },
    ];
    for (const b of bad) expect(ReportSheetSchema.safeParse(b).success, JSON.stringify(b)).toBe(false);
  });

  it("is part of the library record and the IPC's request (old checklist still readable)", () => {
    const mine = { rating: 3, report: { schemaVersion: 1, results: { speaker: { result: "fail", details: ["problems"] } } }, notes: "n" };
    expect(MineSchema.safeParse(mine).success).toBe(true);
    expect(MineSchema.safeParse({ tags: ["no-triggers"] }).success).toBe(true);
    expect(SetMineSchema.safeParse({ gameKey: "steam-1a2b3c4d:steam:620", title: "Portal 2", mine }).success).toBe(true);
  });

  it("the stamp takes a development version and what it was tested on (was: a dev.N app refused every rating)", () => {
    const ratedOn = { app: "0.9.5-dev.18", at: 1, firmware: "0.9.5-dev.18-oled-edition", controller: "dualsense-edge", colorway: "02", os: "linux", arch: "x64", runner: "GE-Proton11-7.2-DualSense" };
    expect(MineSchema.safeParse({ rating: 4, ratedOn }).success).toBe(true);
    expect(MineSchema.safeParse({ rating: 4, ratedOn: { ...ratedOn, hostname: "box" } }).success).toBe(false);
    expect(MineSchema.safeParse({ rating: 4, ratedOn: { ...ratedOn, controller: "edge" } }).success).toBe(false);
  });
});

// The migration table (docs/schemas/README.md): each old statement alone.
const ALONE: Record<(typeof FEEDBACK_TAGS)[number], ReportSheet> = {
  "triggers-work": { schemaVersion: 1, results: { "adaptive-triggers": { result: "pass" } } },
  "no-triggers": { schemaVersion: 1, results: { "adaptive-triggers": { result: "fail" } } },
  "haptics-work": { schemaVersion: 1, results: { "haptic-feedback": { result: "pass" } } },
  "weak-vibration": { schemaVersion: 1, results: { "haptic-feedback": { result: "fail", details: ["weak"] } } },
  "rumble-only": { schemaVersion: 1, results: { "haptic-feedback": { result: "fail", details: ["rumble-only"] } } },
  "speaker-works": { schemaVersion: 1, results: { speaker: { result: "pass" } } },
  "speaker-problems": { schemaVersion: 1, results: { speaker: { result: "fail", details: ["problems"] } } },
  "mic-works": { schemaVersion: 1, results: { microphone: { result: "pass" } } },
  "lightbar-works": { schemaVersion: 1, results: { "light-bar": { result: "pass" } } },
  "not-detected": { schemaVersion: 1, results: { "controller-detected": { result: "fail" } } },
  disconnects: { schemaVersion: 1, results: { "stays-connected": { result: "fail" } } },
  "needs-steam-input-off": { schemaVersion: 1, results: {}, setup: { "steam-input-off": true } },
};

describe("migration from the old checklist", () => {
  it("maps every old statement (the table covers all twelve)", () => {
    expect(Object.keys(TAG_MIGRATION).sort()).toEqual([...FEEDBACK_TAGS].sort());
    for (const tag of FEEDBACK_TAGS) {
      const sheet = migrateTags([tag]);
      expect(sheet, tag).toEqual(ALONE[tag]);
      expect(ReportSheetSchema.safeParse(sheet).success, tag).toBe(true);
    }
  });

  it("works and doesn't work for the same feature: Fail (with its details), flagged as a conflict", () => {
    expect(migrateTags(["triggers-work", "no-triggers"])).toEqual({ schemaVersion: 1, results: { "adaptive-triggers": { result: "fail" } }, conflicts: ["adaptive-triggers"] });
    expect(migrateTags(["haptics-work", "weak-vibration", "rumble-only"])).toEqual({
      schemaVersion: 1,
      results: { "haptic-feedback": { result: "fail", details: ["weak", "rumble-only"] } },
      conflicts: ["haptic-feedback"],
    });
    // Two failures of one feature are no conflict; the order of the old ticks doesn't matter.
    expect(migrateTags(["rumble-only", "weak-vibration"]).conflicts).toBeUndefined();
    expect(migrateTags(["no-triggers", "triggers-work"])).toEqual(migrateTags(["triggers-work", "no-triggers"]));
  });

  it("a dev.17 library: loads whole, every game's sheet as the table says, stars and notes kept", () => {
    const dir = mkdtempSync(join(tmpdir(), "ds5-report-"));
    try {
      copyFileSync(FIXTURE, join(dir, LIBRARY_FILE));
      const lib = new LibraryStore(dir).get();
      expect(LibraryFileSchema.safeParse(lib).success).toBe(true);
      expect(lib).toEqual(fixture()); // nothing dropped or changed on read
      const sheets = Object.fromEntries(Object.entries(lib.games).map(([k, r]) => [k, sheetOf(r.mine)]));
      expect(sheets["steam-1a2b3c4d:steam:1091500"]).toEqual({
        schemaVersion: 1,
        results: { "adaptive-triggers": { result: "pass" }, "haptic-feedback": { result: "fail", details: ["weak"] } },
        conflicts: ["haptic-feedback"],
      });
      expect(sheets["steam-1a2b3c4d:steam:1888930"]).toEqual({
        schemaVersion: 1,
        results: {
          "adaptive-triggers": { result: "fail" },
          "haptic-feedback": { result: "fail", details: ["rumble-only"] },
          speaker: { result: "fail", details: ["problems"] },
          "stays-connected": { result: "fail" },
        },
        setup: { "steam-input-off": true },
      });
      expect(sheets["heroic-0badf00d:gog:1423049311"]).toEqual({
        schemaVersion: 1,
        results: { "controller-detected": { result: "fail" }, speaker: { result: "pass" }, microphone: { result: "pass" }, "light-bar": { result: "pass" } },
      });
      expect(sheets["lutris-00000001:lutris:battlenet-1"]).toEqual({
        schemaVersion: 1,
        results: {
          "controller-detected": { result: "fail" },
          "adaptive-triggers": { result: "fail" },
          "haptic-feedback": { result: "fail", details: ["weak", "rumble-only"] },
          speaker: { result: "fail", details: ["problems"] },
          microphone: { result: "pass" },
          "light-bar": { result: "pass" },
          "stays-connected": { result: "fail" },
        },
        setup: { "steam-input-off": true },
        conflicts: ["adaptive-triggers", "haptic-feedback", "speaker"],
      });
      expect(sheets["steam-1a2b3c4d:steam:620"]).toEqual(EMPTY_SHEET);
      // Controller not detected still offers the standard-gamepad fix (main's notDetected).
      expect(
        Object.entries(lib.games)
          .filter(([, r]) => isNotDetected(r.mine))
          .map(([k]) => k),
      ).toEqual(["heroic-0badf00d:gog:1423049311", "lutris-00000001:lutris:battlenet-1"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the first change rewrites the record as a sheet and keeps the rating, the notes and the rest", () => {
    const dir = mkdtempSync(join(tmpdir(), "ds5-report-"));
    try {
      copyFileSync(FIXTURE, join(dir, LIBRARY_FILE));
      const store = new LibraryStore(dir);
      const key = "lutris-00000001:lutris:battlenet-1";
      const before = store.get().games[key].mine!;
      // What the page sends (useMine): the sheet, the old ticks dropped, a new stamp.
      const report = setResult(sheetOf(before), "microphone", "fail");
      const { tags: _, ...kept } = before;
      store.setMine(key, "Every statement at once", { ...kept, report, ratedOn: { app: "0.9.5-dev.18", at: 1760300000 } });
      const after = JSON.parse(readFileSync(join(dir, LIBRARY_FILE), "utf8")).games[key].mine;
      expect(after.tags).toBeUndefined();
      expect(after.rating).toBe(3);
      expect(after.notes).toBe("Fixture notes: everything ticked.");
      expect(after.hdr).toBe(true);
      expect(after.report.results.microphone).toEqual({ result: "fail" });
      expect(after.report.conflicts).toEqual(["adaptive-triggers", "haptic-feedback", "speaker"]);
      expect(after.report.setup).toEqual({ "steam-input-off": true });
      expect(sheetOf(after)).toEqual(after.report);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("sheet helpers", () => {
  const base = migrateTags(["haptics-work", "weak-vibration", "needs-steam-input-off"]);

  it("picking a result confirms a conflicting row; leaving Fail drops its details", () => {
    const passed = setResult(base, "haptic-feedback", "pass");
    expect(passed.results["haptic-feedback"]).toEqual({ result: "pass" });
    expect(passed.conflicts).toBeUndefined();
    const failed = setResult(base, "haptic-feedback", "fail");
    expect(failed.results["haptic-feedback"]).toEqual({ result: "fail", details: ["weak"] }); // already Fail: kept
    expect(failed.conflicts).toBeUndefined();
    expect(setResult(passed, "haptic-feedback", "fail").results["haptic-feedback"]).toEqual({ result: "fail" });
    const untested = setResult(base, "haptic-feedback", "not-tested");
    expect(resultOf(untested, "haptic-feedback")).toBe("not-tested");
    expect("haptic-feedback" in untested.results).toBe(false);
    expect(untested.setup).toEqual({ "steam-input-off": true });
  });

  it("details toggle on a Fail only, and only the feature's own", () => {
    const f = setResult(EMPTY_SHEET, "haptic-feedback", "fail");
    const both = toggleDetail(toggleDetail(f, "haptic-feedback", "weak"), "haptic-feedback", "rumble-only");
    expect(both.results["haptic-feedback"]).toEqual({ result: "fail", details: ["weak", "rumble-only"] });
    expect(toggleDetail(both, "haptic-feedback", "weak").results["haptic-feedback"]).toEqual({ result: "fail", details: ["rumble-only"] });
    expect(toggleDetail(EMPTY_SHEET, "haptic-feedback", "weak")).toBe(EMPTY_SHEET);
    const spk = setResult(EMPTY_SHEET, "speaker", "fail");
    expect(toggleDetail(spk, "speaker", "weak")).toBe(spk);
    for (const s of [both, spk, setFlag(both, "steam-input-off", true)]) expect(ReportSheetSchema.safeParse(s).success).toBe(true);
  });

  it("the setup flag is yes or absent", () => {
    expect(setFlag(EMPTY_SHEET, "steam-input-off", true).setup).toEqual({ "steam-input-off": true });
    expect(setFlag(base, "steam-input-off", false)).not.toHaveProperty("setup");
  });

  it("counts and the suggested rating (never more than the results say)", () => {
    expect(countResults(EMPTY_SHEET)).toEqual({ pass: 0, fail: 0 });
    expect(suggestedRating(EMPTY_SHEET)).toBeNull();
    const pass = (...f: (typeof REPORT_FEATURES)[number][]) => f.reduce((s, x) => setResult(s, x, "pass"), EMPTY_SHEET);
    expect(suggestedRating(pass("adaptive-triggers", "haptic-feedback"))).toBe(5);
    expect(suggestedRating(pass("speaker"))).toBe(4);
    expect(suggestedRating(setResult(pass("adaptive-triggers", "haptic-feedback"), "microphone", "fail"))).toBe(3);
    expect(suggestedRating(migrateTags(["no-triggers", "rumble-only"]))).toBe(2);
    expect(suggestedRating(migrateTags(["no-triggers", "rumble-only", "speaker-problems", "disconnects"]))).toBe(1);
    expect(suggestedRating(setResult(pass("adaptive-triggers", "haptic-feedback", "speaker"), "controller-detected", "fail"))).toBe(1);
    expect(countResults(migrateTags([...FEEDBACK_TAGS]))).toEqual({ pass: 2, fail: 5 });
  });

  it("what a report was tested on: known values only, nothing that names this PC", () => {
    expect(testedOn({ platform: "win32", arch: "x64", firmware: "0.9.5", model: "edge", colorway: "02", runner: null })).toEqual({
      firmware: "0.9.5",
      controller: "dualsense-edge",
      colorway: "02",
      os: "windows",
      arch: "x64",
    });
    expect(testedOn({ platform: "freebsd", arch: "ppc64", firmware: "bad\nvalue", model: null, colorway: "xyz", runner: "x".repeat(81) })).toEqual({});
    expect(testedOn({ platform: "darwin", arch: "arm64", model: "dualsense", runner: "GE-Proton11-7.2-DualSense" })).toEqual({
      controller: "dualsense",
      os: "macos",
      arch: "arm64",
      runner: "GE-Proton11-7.2-DualSense",
    });
  });
});
