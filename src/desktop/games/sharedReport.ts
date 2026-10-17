// A game report as it will be shared with other players (the community
// batch): one JSON document, version 1, built and checked here with no
// network. The JSON Schema in docs/schemas/game-report-v1.schema.json is
// generated from SharedReportSchema (tests/unit/sharedReport.test.ts keeps the
// two the same), so the server can validate exactly what the app sends.
//
// What it holds: the game (store, store id, launcher, title), the rating, the
// sheet (every feature's result, explicit, with its details), the setup flags,
// rows still to re-check, and what it was tested on (app, board firmware,
// controller model and colorway, OS and CPU family, the Proton build, the
// game's build). What it never holds: the notes (free text, private), the
// install folder, the launcher's install hash from the library key (it's
// derived from a path), a serial, a hostname, a user name or an account.
import { z } from "zod";
import type { Mine } from "./library";
import { detailsOf, REPORT_FEATURES, REPORT_SCHEMA_VERSION, SETUP_FLAGS, sheetIsEmpty, sheetOf, type FailDetail, type ReportFeature, type SetupFlag } from "./report";

export const SHARED_REPORT_KIND = "ds5-game-report";
export const SHARED_STORES = ["steam", "epic", "gog", "amazon", "sideload", "lutris"] as const;
export const SHARED_LAUNCHERS = ["steam", "heroic", "lutris", "gog", "epic"] as const;
export const SHARED_CONTROLLERS = ["dualsense", "dualsense-edge"] as const;
export const SHARED_OS = ["linux", "windows", "macos"] as const;
export const SHARED_ARCH = ["x64", "arm64"] as const;

const Version = z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]{1,40})?$/);
const Short = z
  .string()
  .regex(/^[\x20-\x7e]{1,80}$/)
  .nullable();

// One feature's result: Pass and Not tested are bare; a Fail lists its
// details (empty when it has none, or the feature has none to give).
function sharedResult(feature: ReportFeature) {
  const details = detailsOf(feature);
  const detailList = details.length ? z.array(z.enum(details as [FailDetail, ...FailDetail[]])).max(details.length) : z.array(z.never()).max(0);
  return z.discriminatedUnion("result", [
    z.strictObject({ result: z.literal("pass") }),
    z.strictObject({ result: z.literal("not-tested") }),
    z.strictObject({ result: z.literal("fail"), details: detailList }),
  ]);
}

export const SharedReportSchema = z.strictObject({
  schemaVersion: z.literal(REPORT_SCHEMA_VERSION),
  kind: z.literal(SHARED_REPORT_KIND),
  game: z.strictObject({
    store: z.enum(SHARED_STORES),
    id: z.string().regex(/^[\w.-]{1,200}$/),
    launcher: z.enum(SHARED_LAUNCHERS),
    title: z.string().min(1).max(300),
  }),
  rating: z.number().int().min(1).max(5).nullable(),
  // loop: NOT-WORTH — N = 7 features, once at module load
  results: z.strictObject(Object.fromEntries(REPORT_FEATURES.map((f) => [f, sharedResult(f)])) as Record<ReportFeature, ReturnType<typeof sharedResult>>),
  // loop: NOT-WORTH — N = 1 flag, once at module load
  setup: z.strictObject(Object.fromEntries(SETUP_FLAGS.map((f) => [f, z.boolean()])) as Record<SetupFlag, z.ZodBoolean>),
  conflicts: z.array(z.enum(REPORT_FEATURES)).max(REPORT_FEATURES.length),
  context: z.strictObject({
    app: Version,
    firmware: Short,
    controller: z.enum(SHARED_CONTROLLERS).nullable(),
    colorway: z
      .string()
      .regex(/^[0-9A-Za-z]{2}$/)
      .nullable(),
    os: z.enum(SHARED_OS).nullable(),
    arch: z.enum(SHARED_ARCH).nullable(),
    runner: Short,
    gameBuild: z
      .string()
      .regex(/^[\x20-\x7e]{1,40}$/)
      .nullable(),
    gameUpdated: z.iso.datetime().nullable(),
  }),
  updatedAt: z.iso.datetime(),
});
export type SharedReport = z.infer<typeof SharedReportSchema>;

// The library key's parts that identify the game anywhere: the store and its
// id, and the launcher. The 8 hex digits after the launcher are a hash of
// where it's installed on this PC, so they're left out.
const KEY = /^(steam|heroic|lutris|gog|epic)-[0-9a-f]{8}:(steam|epic|gog|amazon|sideload|lutris):([\w.-]{1,200})$/;
export function gameIdentity(gameKey: string): { store: SharedReport["game"]["store"]; id: string; launcher: SharedReport["game"]["launcher"] } | null {
  const m = KEY.exec(gameKey);
  return m ? { launcher: m[1] as SharedReport["game"]["launcher"], store: m[2] as SharedReport["game"]["store"], id: m[3] } : null;
}

const iso = (seconds: number | undefined) => (seconds === undefined ? null : new Date(seconds * 1000).toISOString());

// The report to share, from what this PC keeps: null when there's nothing
// to share (no rating, no result, no flag) or it can't say what it was
// tested on (never stamped, or a key that isn't a game's).
export function toSharedReport(input: { gameKey: string; title: string; mine: Mine | undefined }): SharedReport | null {
  const { mine } = input;
  const game = gameIdentity(input.gameKey);
  const on = mine?.ratedOn;
  const sheet = sheetOf(mine);
  if (!game || !on || (!mine?.rating && sheetIsEmpty(sheet))) return null;
  const results = Object.fromEntries(
    // loop: NOT-WORTH — N = 7 features, once per share
    REPORT_FEATURES.map((f) => {
      const r = sheet.results[f];
      return [f, !r ? { result: "not-tested" } : r.result === "pass" ? { result: "pass" } : { result: "fail", details: "details" in r ? (r.details ?? []) : [] }];
    }),
  );
  // loop: NOT-WORTH — N = 1 flag, once per share
  const setup = Object.fromEntries(SETUP_FLAGS.map((f) => [f, !!sheet.setup?.[f]]));
  return SharedReportSchema.parse({
    schemaVersion: REPORT_SCHEMA_VERSION,
    kind: SHARED_REPORT_KIND,
    game: { ...game, title: input.title.trim() || game.id },
    rating: mine?.rating ?? null,
    results,
    setup,
    conflicts: sheet.conflicts ?? [],
    context: {
      app: on.app,
      firmware: on.firmware ?? null,
      controller: on.controller ?? null,
      colorway: on.colorway ?? null,
      os: on.os ?? null,
      arch: on.arch ?? null,
      runner: on.runner ?? null,
      gameBuild: on.build ?? null,
      gameUpdated: iso(on.gameUpdated),
    },
    updatedAt: iso(on.at),
  });
}

// The report as JSON text (keys in the schema's order, so the same report is
// always the same bytes: fit for a signature or a diff). Throws on a report
// that doesn't fit the schema.
export const serializeReport = (report: SharedReport): string => JSON.stringify(SharedReportSchema.parse(report));

// A report received as JSON text (or already parsed), checked against the
// schema. A newer schemaVersion is refused by name, so a reader knows to update.
// error: PASSES-ON — the result's error field is the caller's (no caller in the app yet: the community batch shows or logs it)
export function parseSharedReport(input: string | unknown): { ok: true; report: SharedReport } | { ok: false; error: string } {
  let data: unknown = input;
  if (typeof input === "string") {
    try {
      data = JSON.parse(input);
    } catch {
      // error: NOT-WORTH — the result says it isn't JSON; the caller shows or logs it
      return { ok: false, error: "not JSON" };
    }
  }
  const version = (data as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (typeof version === "number" && version !== REPORT_SCHEMA_VERSION) return { ok: false, error: `unsupported schemaVersion ${version}` };
  // error: NOT-WORTH — a report that doesn't fit is the result (ok: false, with zod's issues), the caller decides
  const parsed = SharedReportSchema.safeParse(data);
  return parsed.success ? { ok: true, report: parsed.data } : { ok: false, error: z.prettifyError(parsed.error) };
}

// The JSON Schema of a shared report (draft 2020-12), as published in
// docs/schemas/game-report-v1.schema.json for the server and other readers.
export function sharedReportJsonSchema(): Record<string, unknown> {
  const generated = z.toJSONSchema(SharedReportSchema) as Record<string, unknown>;
  const { $schema, ...rest } = generated;
  return {
    $schema,
    $id: "https://github.com/MarcelineVPQ/DS5Dongle-OLED-Config-Web/blob/master/docs/schemas/game-report-v1.schema.json",
    title: "DS5 Dongle game report, version 1",
    description:
      "How well a DualSense works in one game, as one player tested it: a Pass / Fail / Not tested result per controller feature (machine IDs, never translated words), the setup it needed, the overall rating and what it was tested on. No notes, paths, serials, host or user names. Built by src/desktop/games/sharedReport.ts; see docs/schemas/README.md.",
    ...rest,
  };
}
