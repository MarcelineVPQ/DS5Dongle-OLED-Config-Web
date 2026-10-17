// A report as it will be shared (src/desktop/games/sharedReport.ts): built
// from what this PC keeps, serialized the same way every time, checked when
// read back, private data left out, and the published JSON Schema the same
// as the code's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Mine } from "../../src/desktop/games/library";
import { gameIdentity, parseSharedReport, serializeReport, sharedReportJsonSchema, toSharedReport, type SharedReport } from "../../src/desktop/games/sharedReport";
import { REPORT_FEATURES } from "../../src/desktop/games/report";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/reports/library-dev17.json", import.meta.url), "utf8")) as { games: Record<string, { title: string; mine: Mine }> };
const KEY = "steam-1a2b3c4d:steam:1091500";
const tested: Mine = {
  rating: 4,
  report: { schemaVersion: 1, results: { "adaptive-triggers": { result: "pass" }, "haptic-feedback": { result: "fail", details: ["weak"] } }, setup: { "steam-input-off": true } },
  ratedOn: {
    app: "0.9.5-dev.18",
    build: "19000001",
    gameUpdated: 1759000000,
    at: 1760000000,
    firmware: "0.9.5-dev.18-oled-edition",
    controller: "dualsense",
    colorway: "02",
    os: "linux",
    arch: "x64",
    runner: "GE-Proton11-7.2-DualSense",
  },
  notes: "Private: my Steam name is someone and my home is /home/someone",
};

describe("the shared report", () => {
  it("says the game, the rating, every feature's result, the setup and what it was tested on", () => {
    const r = toSharedReport({ gameKey: KEY, title: "Cyberpunk 2077", mine: tested })!;
    expect(r).toEqual({
      schemaVersion: 1,
      kind: "ds5-game-report",
      game: { store: "steam", id: "1091500", launcher: "steam", title: "Cyberpunk 2077" },
      rating: 4,
      results: {
        "controller-detected": { result: "not-tested" },
        "adaptive-triggers": { result: "pass" },
        "haptic-feedback": { result: "fail", details: ["weak"] },
        speaker: { result: "not-tested" },
        microphone: { result: "not-tested" },
        "light-bar": { result: "not-tested" },
        "stays-connected": { result: "not-tested" },
      },
      setup: { "steam-input-off": true },
      conflicts: [],
      context: {
        app: "0.9.5-dev.18",
        firmware: "0.9.5-dev.18-oled-edition",
        controller: "dualsense",
        colorway: "02",
        os: "linux",
        arch: "x64",
        runner: "GE-Proton11-7.2-DualSense",
        gameBuild: "19000001",
        gameUpdated: "2025-09-27T19:06:40.000Z",
      },
      updatedAt: "2025-10-09T08:53:20.000Z",
    } satisfies SharedReport);
  });

  it("never carries the notes, the install hash, paths, hosts or names", () => {
    const text = serializeReport(toSharedReport({ gameKey: KEY, title: "Cyberpunk 2077", mine: tested })!);
    for (const word of ["Private", "someone", "/home", "1a2b3c4d", "notes", "hostname", "user", "serial"]) expect(text).not.toContain(word);
    // The schema itself refuses anything extra, anywhere.
    const r = JSON.parse(text) as Record<string, Record<string, unknown>>;
    for (const extra of [
      { ...r, notes: "x" },
      { ...r, context: { ...r.context, hostname: "box" } },
      { ...r, game: { ...r.game, installDir: "/home/x" } },
    ])
      expect(parseSharedReport(extra).ok).toBe(false);
  });

  it("serializes to the same bytes every time, and reads back to the same report", () => {
    const r = toSharedReport({ gameKey: KEY, title: "Cyberpunk 2077", mine: tested })!;
    const shuffled = Object.fromEntries(Object.entries(r).reverse()) as SharedReport;
    expect(serializeReport(shuffled)).toBe(serializeReport(r));
    const back = parseSharedReport(serializeReport(r));
    expect(back).toEqual({ ok: true, report: r });
  });

  it("refuses what isn't a report: not JSON, a newer version, words instead of IDs, a detail on a Pass", () => {
    const good = JSON.parse(serializeReport(toSharedReport({ gameKey: KEY, title: "Cyberpunk 2077", mine: tested })!)) as Record<string, Record<string, unknown>>;
    expect(parseSharedReport("{oops")).toEqual({ ok: false, error: "not JSON" });
    expect(parseSharedReport({ ...good, schemaVersion: 2 })).toEqual({ ok: false, error: "unsupported schemaVersion 2" });
    const bad = [
      { ...good, results: { ...good.results, speaker: { result: "Pass" } } },
      { ...good, results: { ...good.results, speaker: { result: "pass", details: ["problems"] } } },
      { ...good, results: { ...good.results, speaker: { result: "fail", details: ["weak"] } } },
      { ...good, results: { ...good.results, speaker: undefined } }, // every feature is explicit
      { ...good, rating: 6 },
      { ...good, context: { ...good.context, controller: "edge" } },
      { ...good, kind: "ds5-community-games" },
      { ...good, updatedAt: "yesterday" },
    ];
    for (const b of bad) expect(parseSharedReport(b).ok, JSON.stringify(b).slice(0, 120)).toBe(false);
  });

  it("from the dev.17 library: migrated reports share, conflicts listed; nothing to share is null", () => {
    const shared = Object.fromEntries(Object.entries(fixture.games).map(([k, g]) => [k, toSharedReport({ gameKey: k, title: g.title, mine: g.mine })]));
    expect(shared[KEY]!.results["haptic-feedback"]).toEqual({ result: "fail", details: ["weak"] });
    expect(shared[KEY]!.conflicts).toEqual(["haptic-feedback"]);
    expect(shared[KEY]!.context).toMatchObject({ app: "0.9.4", firmware: null, controller: null, gameBuild: "19000001" });
    expect(shared["heroic-0badf00d:gog:1423049311"]!.game).toEqual({ store: "gog", id: "1423049311", launcher: "heroic", title: "The Witcher 3" });
    expect(shared["heroic-0badf00d:gog:1423049311"]!.rating).toBeNull();
    expect(shared["steam-1a2b3c4d:steam:620"]!.rating).toBe(5); // stars only
    for (const r of Object.values(shared)) expect(parseSharedReport(serializeReport(r!)).ok).toBe(true);
    expect(toSharedReport({ gameKey: KEY, title: "x", mine: { notes: "only notes", ratedOn: tested.ratedOn } })).toBeNull();
    expect(toSharedReport({ gameKey: KEY, title: "x", mine: { rating: 3 } })).toBeNull(); // never stamped
    expect(toSharedReport({ gameKey: "not-a-key", title: "x", mine: tested })).toBeNull();
    expect(gameIdentity("lutris-00000001:lutris:battlenet-1")).toEqual({ launcher: "lutris", store: "lutris", id: "battlenet-1" });
  });

  it("the published JSON Schema (docs/schemas/game-report-v1.schema.json) is the code's", () => {
    const published = JSON.parse(readFileSync(new URL("../../docs/schemas/game-report-v1.schema.json", import.meta.url), "utf8")) as Record<string, unknown>;
    expect(published, "regenerate it from sharedReportJsonSchema() (docs/schemas/README.md)").toEqual(sharedReportJsonSchema());
    const props = published.properties as Record<string, { required?: string[] }>;
    expect(props.results.required).toEqual([...REPORT_FEATURES]);
    expect(published.additionalProperties).toBe(false);
  });
});
