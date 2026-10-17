// A game's report as a test sheet: one row per controller feature, each Pass,
// Fail or Not tested (the default), a Fail optionally carrying a detail, plus
// the setup the game needed. Kept on this PC in the library (Mine.report),
// beside the star rating and the private notes; sharedReport.ts turns it into
// the shareable JSON the community batch will send.
//
// Only machine IDs are stored, never translated words: a feature, result,
// detail or flag ID never changes meaning once shipped. A new feature, detail
// or flag is added (old reports read it as Not tested / absent); a change of
// meaning is a new schemaVersion with a migration, like migrateTags below.
//
// Reports from before the sheet (0.9.5-dev.17 and older) are a list of ticked
// statements (Mine.tags). They're read through migrateTags whenever the sheet
// is shown or shared, and rewritten as a sheet on the player's next change; the
// rating and the notes are separate fields and stay as they are.
import { z } from "zod";
import type { FeedbackTag, Mine } from "./library";

// The rows, in the sheet's order (the controller first: nothing else can work without it).
export const REPORT_FEATURES = ["controller-detected", "adaptive-triggers", "haptic-feedback", "speaker", "microphone", "light-bar", "stays-connected"] as const;
export type ReportFeature = (typeof REPORT_FEATURES)[number];

export const REPORT_RESULTS = ["pass", "fail", "not-tested"] as const;
export type ReportResult = (typeof REPORT_RESULTS)[number];

// What a Fail can add, per feature (only where the old checklist had one).
// Stays connected has none: its Fail is "it disconnects".
export const FAIL_DETAILS = {
  "haptic-feedback": ["weak", "rumble-only"],
  speaker: ["problems"],
} as const satisfies Partial<Record<ReportFeature, readonly string[]>>;
export type FailDetail = (typeof FAIL_DETAILS)[keyof typeof FAIL_DETAILS][number];
export const detailsOf = (feature: ReportFeature): readonly FailDetail[] => (FAIL_DETAILS as Partial<Record<ReportFeature, readonly FailDetail[]>>)[feature] ?? [];

// What the game needed, yes or no (absent = no).
export const SETUP_FLAGS = ["steam-input-off"] as const;
export type SetupFlag = (typeof SETUP_FLAGS)[number];

export const REPORT_SCHEMA_VERSION = 1;

// One stored row: a Pass, or a Fail with its details. Not tested is no entry.
function storedResult(feature: ReportFeature) {
  const details = detailsOf(feature);
  const fail = details.length
    ? z.strictObject({
        result: z.literal("fail"),
        details: z
          .array(z.enum(details as [FailDetail, ...FailDetail[]]))
          .max(details.length)
          .optional(),
      })
    : z.strictObject({ result: z.literal("fail") });
  return z.discriminatedUnion("result", [z.strictObject({ result: z.literal("pass") }), fail]);
}
export type StoredResult = { result: "pass" } | { result: "fail"; details?: FailDetail[] };

export interface ReportSheet {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  results: Partial<Record<ReportFeature, StoredResult>>;
  setup?: Partial<Record<SetupFlag, boolean>>;
  conflicts?: ReportFeature[];
}

// Typed as the interface above (the per-feature results are built in a loop).
export const ReportSheetSchema: z.ZodType<ReportSheet> = z.strictObject({
  schemaVersion: z.literal(REPORT_SCHEMA_VERSION),
  // loop: NOT-WORTH — N = 7 features, once at module load
  results: z.strictObject(Object.fromEntries(REPORT_FEATURES.map((f) => [f, storedResult(f).optional()])) as Record<ReportFeature, z.ZodOptional<ReturnType<typeof storedResult>>>),
  // loop: NOT-WORTH — N = 1 flag, once at module load
  setup: z.strictObject(Object.fromEntries(SETUP_FLAGS.map((f) => [f, z.boolean().optional()])) as Record<SetupFlag, z.ZodOptional<z.ZodBoolean>>).optional(),
  // Rows the old checklist said both ways (works and doesn't work): set to
  // Fail and listed here until the player picks a result for them again.
  conflicts: z.array(z.enum(REPORT_FEATURES)).max(REPORT_FEATURES.length).optional(),
});
export const EMPTY_SHEET: ReportSheet = { schemaVersion: REPORT_SCHEMA_VERSION, results: {} };

// The old checklist, statement by statement (MIGRATION in docs/schemas/README.md).
export const TAG_MIGRATION: Record<FeedbackTag, { feature: ReportFeature; result: "pass" | "fail"; detail?: FailDetail } | { setup: SetupFlag }> = {
  "triggers-work": { feature: "adaptive-triggers", result: "pass" },
  "no-triggers": { feature: "adaptive-triggers", result: "fail" },
  "haptics-work": { feature: "haptic-feedback", result: "pass" },
  "weak-vibration": { feature: "haptic-feedback", result: "fail", detail: "weak" },
  "rumble-only": { feature: "haptic-feedback", result: "fail", detail: "rumble-only" },
  "speaker-works": { feature: "speaker", result: "pass" },
  "speaker-problems": { feature: "speaker", result: "fail", detail: "problems" },
  "mic-works": { feature: "microphone", result: "pass" },
  "lightbar-works": { feature: "light-bar", result: "pass" },
  "not-detected": { feature: "controller-detected", result: "fail" },
  disconnects: { feature: "stays-connected", result: "fail" },
  "needs-steam-input-off": { setup: "steam-input-off" },
};

// The old ticked statements as a sheet. Fail wins over Pass for the same
// feature (the problem is what another player needs to know), and the row is
// listed in `conflicts` so the sheet asks the player to check it again.
export function migrateTags(tags: readonly FeedbackTag[]): ReportSheet {
  const sheet: ReportSheet = { schemaVersion: REPORT_SCHEMA_VERSION, results: {} };
  const said = new Map<ReportFeature, Set<"pass" | "fail">>();
  const details = new Map<ReportFeature, FailDetail[]>();
  // loop: NOT-WORTH — N ≤ 12 old statements
  for (const tag of tags) {
    const to = TAG_MIGRATION[tag];
    if (!to) continue;
    if ("setup" in to) {
      sheet.setup = { ...sheet.setup, [to.setup]: true };
      continue;
    }
    said.set(to.feature, (said.get(to.feature) ?? new Set()).add(to.result));
    if (to.detail && !details.get(to.feature)?.includes(to.detail)) details.set(to.feature, [...(details.get(to.feature) ?? []), to.detail]);
  }
  const conflicts: ReportFeature[] = [];
  // loop: NOT-WORTH — N = 7 features
  for (const feature of REPORT_FEATURES) {
    const results = said.get(feature);
    if (!results) continue;
    if (results.has("fail")) {
      const d = details.get(feature);
      sheet.results[feature] = d?.length ? { result: "fail", details: d } : { result: "fail" };
      if (results.has("pass")) conflicts.push(feature);
    } else sheet.results[feature] = { result: "pass" };
  }
  if (conflicts.length) sheet.conflicts = conflicts;
  return sheet;
}

// The sheet as the old checklist, written beside it until 0.9.5 is stable
// (bug hunt B2): 0.9.5-dev.17 and older don't know `report` and drop it, so
// going back to one keeps the player's ticks. The inverse of migrateTags for
// everything the checklist could say: a Pass, a Fail with its details (a
// speaker Fail is its one statement), a conflict as both, the setup flag.
// What it had no statement for (Controller detected: Pass, a Microphone or
// Light bar Fail, Haptic feedback: Fail with no detail) is left out.
export function legacyTags(sheet: ReportSheet): FeedbackTag[] {
  const tags: FeedbackTag[] = [];
  // loop: NOT-WORTH — N = 7 features x 12 statements, once per sheet change
  for (const feature of REPORT_FEATURES) {
    const r = sheet.results[feature];
    if (!r) continue;
    let pass: FeedbackTag | undefined;
    const fails: Array<{ tag: FeedbackTag; detail?: FailDetail }> = [];
    // loop: NOT-WORTH — N = 12 old statements (nested in the 7 features)
    for (const [tag, to] of Object.entries(TAG_MIGRATION) as Array<[FeedbackTag, (typeof TAG_MIGRATION)[FeedbackTag]]>) {
      if (!("feature" in to) || to.feature !== feature) continue;
      if (to.result === "pass") pass = tag;
      else fails.push({ tag, detail: to.detail });
    }
    if (r.result === "pass") {
      if (pass) tags.push(pass);
      continue;
    }
    const before = tags.length;
    // loop: NOT-WORTH — N ≤ 2 Fail statements per feature
    for (const f of fails) if (!f.detail || r.details?.includes(f.detail)) tags.push(f.tag);
    if (tags.length === before && fails.length === 1) tags.push(fails[0].tag);
    if (pass && sheet.conflicts?.includes(feature)) tags.push(pass);
  }
  // loop: NOT-WORTH — N = 12 old statements
  for (const [tag, to] of Object.entries(TAG_MIGRATION)) if ("setup" in to && sheet.setup?.[to.setup]) tags.push(tag as FeedbackTag);
  return tags;
}

// The player's sheet: the stored one, else the old checklist migrated.
export function sheetOf(mine: Pick<Mine, "report" | "tags"> | undefined): ReportSheet {
  if (mine?.report) return mine.report as ReportSheet;
  return mine?.tags?.length ? migrateTags(mine.tags) : EMPTY_SHEET;
}

export const resultOf = (sheet: ReportSheet, feature: ReportFeature): ReportResult => sheet.results[feature]?.result ?? "not-tested";

// "Controller detected: Fail" offers the standard-gamepad fix (the Games scan).
export const isNotDetected = (mine: Pick<Mine, "report" | "tags"> | undefined): boolean => resultOf(sheetOf(mine), "controller-detected") === "fail";

const withoutConflict = (sheet: ReportSheet, feature: ReportFeature): Pick<ReportSheet, "conflicts"> => {
  // loop: NOT-WORTH — N ≤ 7 conflicts
  const left = sheet.conflicts?.filter((f) => f !== feature);
  return left?.length ? { conflicts: left } : {};
};

// A row set to a result (picking any result confirms a conflicting row).
// Leaving Fail drops its details; Fail again starts without them.
export function setResult(sheet: ReportSheet, feature: ReportFeature, result: ReportResult): ReportSheet {
  const results = { ...sheet.results };
  if (result === "not-tested") delete results[feature];
  else if (result === "pass") results[feature] = { result: "pass" };
  else results[feature] = results[feature]?.result === "fail" ? results[feature] : { result: "fail" };
  const { conflicts: _, ...rest } = sheet;
  return { ...rest, results, ...withoutConflict(sheet, feature) };
}

// A Fail's detail switched on or off.
export function toggleDetail(sheet: ReportSheet, feature: ReportFeature, detail: FailDetail): ReportSheet {
  const now = sheet.results[feature];
  if (now?.result !== "fail" || !detailsOf(feature).includes(detail)) return sheet;
  const had = now.details ?? [];
  // loop: NOT-WORTH — N ≤ 2 details
  const details = had.includes(detail) ? had.filter((d) => d !== detail) : [...had, detail];
  return { ...sheet, results: { ...sheet.results, [feature]: details.length ? { result: "fail", details } : { result: "fail" } } };
}

export function setFlag(sheet: ReportSheet, flag: SetupFlag, on: boolean): ReportSheet {
  const setup = { ...sheet.setup };
  if (on) setup[flag] = true;
  else delete setup[flag];
  const { setup: _, ...rest } = sheet;
  return Object.keys(setup).length ? { ...rest, setup } : rest;
}

export function countResults(sheet: ReportSheet): { pass: number; fail: number } {
  // loop: HOT-PATH-OK — N = 7 features; the game page's render
  const all = REPORT_FEATURES.map((f) => resultOf(sheet, f));
  // loop: HOT-PATH-OK — N = 7 results, two passes; the game page's render
  return { pass: all.filter((r) => r === "pass").length, fail: all.filter((r) => r === "fail").length };
}

// A rating the results suggest (1-5), or null with nothing tested. Shown
// next to the stars, never written into them: the stars are the player's.
//   Controller detected fails: 1 (Doesn't work).
//   No fail: 5 when adaptive triggers and haptic feedback both pass, else 4.
//   One fail: 3. Two or three: 2. More: 1.
export function suggestedRating(sheet: ReportSheet): 1 | 2 | 3 | 4 | 5 | null {
  const { pass, fail } = countResults(sheet);
  if (pass + fail === 0) return null;
  if (resultOf(sheet, "controller-detected") === "fail") return 1;
  if (fail === 0) return resultOf(sheet, "adaptive-triggers") === "pass" && resultOf(sheet, "haptic-feedback") === "pass" ? 5 : 4;
  if (fail === 1) return 3;
  return fail <= 3 ? 2 : 1;
}

// Whether the sheet says anything (a result or a flag).
export const sheetIsEmpty = (sheet: ReportSheet): boolean => Object.keys(sheet.results).length === 0 && !Object.keys(sheet.setup ?? {}).length;

// What a report was tested on, beside the app and game build the stamp
// already keeps (Mine.ratedOn): the board's firmware, the controller's model
// and colorway, the OS and CPU family and the Proton build. Only what's known
// and fits (printable, short); nothing that names this PC or its user.
export interface TestedOn {
  firmware?: string;
  controller?: "dualsense" | "dualsense-edge";
  colorway?: string;
  os?: "linux" | "windows" | "macos";
  arch?: "x64" | "arm64";
  runner?: string;
}
const OS: Record<string, TestedOn["os"]> = { linux: "linux", win32: "windows", darwin: "macos" };
const printable = (s: string | null | undefined) => (s && /^[\x20-\x7e]{1,80}$/.test(s) ? s : undefined);
export function testedOn(from: { platform?: string; arch?: string; firmware?: string | null; model?: "dualsense" | "edge" | null; colorway?: string | null; runner?: string | null }): TestedOn {
  const on: TestedOn = {
    firmware: printable(from.firmware),
    controller: from.model === "edge" ? "dualsense-edge" : from.model === "dualsense" ? "dualsense" : undefined,
    colorway: from.colorway && /^[0-9A-Za-z]{2}$/.test(from.colorway) ? from.colorway : undefined,
    os: from.platform ? OS[from.platform] : undefined,
    arch: from.arch === "x64" || from.arch === "arm64" ? from.arch : undefined,
    runner: printable(from.runner),
  };
  // loop: NOT-WORTH — N = 6 fields, once per report change
  return Object.fromEntries(Object.entries(on).filter(([, v]) => v !== undefined)) as TestedOn;
}
