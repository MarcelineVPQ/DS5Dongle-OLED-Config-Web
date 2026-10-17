# Game report schema

A game's **Your report** is a test sheet: one row per controller feature, each **Pass**, **Fail** or **Not tested** (the default), plus the setup the game needed and the overall star rating. It is kept on this PC in the game library (`game-library-2.json`, `Mine.report`). The community batch (BACKLOG "Community game database", "Diagnostics report … in-app issue reports") sends it as the JSON document described here, version 1. Nothing is sent today.

- Code: `src/desktop/games/report.ts` (the stored sheet, the migration, the helpers), `src/desktop/games/sharedReport.ts` (the shared document: `toSharedReport`, `serializeReport`, `parseSharedReport`, `sharedReportJsonSchema`).
- Schema: [`game-report-v1.schema.json`](game-report-v1.schema.json) (JSON Schema draft 2020-12), generated from the zod schema; `tests/unit/sharedReport.test.ts` fails when the two differ. To regenerate, write `JSON.stringify(sharedReportJsonSchema(), null, 2)` to it and run Prettier.
- Tests: `tests/unit/reportSheet.test.ts`, `tests/unit/sharedReport.test.ts` (fixture: `tests/fixtures/reports/library-dev17.json`, a library from before the sheet), `tests/integration/gamePage.test.ts`.

## Machine IDs

Only IDs are stored and shared, never translated words. An ID never changes meaning once shipped: new features, details or flags are added (older reports read them as Not tested / no); a change of meaning is a new `schemaVersion` with a migration.

| Kind | IDs |
| --- | --- |
| Feature (row order) | `controller-detected`, `adaptive-triggers`, `haptic-feedback`, `speaker`, `microphone`, `light-bar`, `stays-connected` |
| Result | `pass`, `fail`, `not-tested` |
| Fail detail | `haptic-feedback`: `weak`, `rumble-only`; `speaker`: `problems` (the others have none; a `stays-connected` Fail means it disconnects) |
| Setup flag | `steam-input-off` (the game needs Steam Input off) |
| Controller | `dualsense`, `dualsense-edge` |
| OS / CPU | `linux`, `windows`, `macos` / `x64`, `arm64` |

## The shared document (version 1)

| Field | What it holds |
| --- | --- |
| `schemaVersion` | `1` |
| `kind` | `"ds5-game-report"` (so a file of another kind can't pass as a report) |
| `game` | `store` (`steam`, `epic`, `gog`, `amazon`, `sideload`, `lutris`), the store's `id` (a Steam appid, a GOG or Epic id, a Lutris slug), the `launcher` it's played through (`steam`, `heroic`, `lutris`, `gog`, `epic`) and its `title`. The library key's 8-digit install hash is left out (it comes from a path). |
| `rating` | 1–5 stars (the player's overall feel), or `null` |
| `results` | Every feature, always present: `{ "result": "pass" }`, `{ "result": "not-tested" }` or `{ "result": "fail", "details": [...] }` |
| `setup` | `{ "steam-input-off": true \| false }` |
| `conflicts` | Features the old checklist marked both ways, not yet checked again (usually `[]`) |
| `context` | What it was tested on: `app` version, board `firmware`, `controller` model and `colorway` code, `os`, `arch`, the Proton build (`runner`), the game's `gameBuild` and `gameUpdated` time; `null` where unknown |
| `updatedAt` | When the rating or the sheet last changed (ISO 8601, UTC) |

Never in it: the notes (free text, private to this PC), install folders or any path, serials, Bluetooth addresses, a hostname, a user name or an account. The schema has `additionalProperties: false` everywhere, so a document with anything more is refused. The serializer writes the keys in the schema's order, so one report is always the same bytes.

`toSharedReport` returns `null` when there's nothing to share (no rating, no result, no flag) or the report was never stamped.

## Migration from the old checklist

Up to 0.9.5-dev.17 the report was a list of ticked statements (`Mine.tags`). They're read through `migrateTags` wherever the sheet is shown or shared; the player's next change writes the sheet, and until 0.9.5 is stable also the old list made from it (`legacyTags`), so going back to dev.17 (which drops `report`) keeps the ticks. The star rating, the notes and the Supports HDR mark are separate fields and stay as they are.

| Old statement (tag) | New |
| --- | --- |
| Adaptive triggers work (`triggers-work`) | Adaptive triggers: Pass |
| Triggers don't work (`no-triggers`) | Adaptive triggers: Fail |
| Haptic feedback works (`haptics-work`) | Haptic feedback: Pass |
| Vibration feels weak (`weak-vibration`) | Haptic feedback: Fail, `weak` |
| Plain vibration only (`rumble-only`) | Haptic feedback: Fail, `rumble-only` |
| Speaker works (`speaker-works`) | Speaker: Pass |
| Speaker problems (`speaker-problems`) | Speaker: Fail, `problems` |
| Mic works (`mic-works`) | Microphone: Pass |
| Light bar works (`lightbar-works`) | Light bar: Pass |
| Controller not detected (`not-detected`) | Controller detected: Fail (still offers the standard-gamepad fix) |
| Disconnects (`disconnects`) | Stays connected: Fail |
| Needs Steam Input off (`needs-steam-input-off`) | Setup flag `steam-input-off` |

**Both ways for one feature** (e.g. Adaptive triggers work and Triggers don't work, or Haptic feedback works and Vibration feels weak): the row becomes **Fail** with its details, because the problem is what another player needs to know, and the feature is listed in `conflicts`. The sheet shows "Your old checklist said both: check it again" under that row until the player picks a result for it. No old statement said Microphone or Light bar failed, or that the controller was detected or stayed connected, so those rows start as Not tested.
