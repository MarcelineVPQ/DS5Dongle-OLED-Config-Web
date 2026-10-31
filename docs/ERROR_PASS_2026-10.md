# Error pass: every error a user's action can hit, with a verdict

_2026-10-13. Done per CLAUDE.md "Error pass". This is the one doc for both repos: the firmware's CLAUDE.md links here. It was done because an action failed silently three times in one day: Apply was refused by the IPC id check and showed no message; the main process refused to write while Heroic ran and the page showed nothing; "Stop checking" made the library disappear without warning. Every silent failure found in a user action is fixed on this branch, with a test. What was left went into batches E1 to E3 (app) and F1 (firmware). **E1, E2 and E3 are done** (E1 2026-10-14; E2 and E3 2026-10-15, branch `passes-095`); F1 waits for a firmware task with hardware tests. The app tables below were re-run on 2026-10-15._

## The rule

**No silent failure.** Every error a user's action can hit does one of two things. It shows the user plain words: what happened and what to do, in all 7 languages, never "dongle". Or it is logged on purpose, with a one-line reason why the user doesn't need to see it. "Logged" never means an empty catch or `() => undefined`.

## How the list was made

Two listers, one per repo. Each lists every candidate mechanically; nothing is sampled by eye.

**App** (`tools/list_errors.mjs`). It uses the TypeScript compiler API and the type checker, shares `tools/ts_program.mjs` with the loop and cache listers, and covers `src/` and `electron/` (tests and the vendored `src/flash/picoflash` are excluded). One row per:

| Kind | What |
|---|---|
| `catch` | every try/catch, classed `empty` / `rethrow` / `log-only` / `fallback`, with what the try guards (JSON.parse, file reads, IPC, zod, child processes) |
| `.catch` / `.then-reject` | every rejection handler on a promise (the checker confirms it is a promise) |
| `void` | every `void <promise>` |
| `floating` | every promise statement that is not awaited, handled or voided |
| `ipc-handler` | every `ipcMain.handle` / `ipcMain.on` registration, and what a throw does |
| `ipc-call` | every renderer call of a `window.desktop` method that returns a promise (resolved through the `DesktopApi` interface) |
| `schema` | every zod `.parse` / `.safeParse` (and the async forms) |
| `spawn` | every `child_process` call, including promisified wrappers |
| `fetch` | every `fetch` / `net.fetch` |
| `json-parse` | every `JSON.parse` |
| `result-field` | every result-type field that carries a failure (`ok`, `error`, `problem`, `blockedBy`, `failed`, …) that the UI could ignore |

**Every row resolves to exactly one verdict.** Either a comment on the row's line or the line above (`// error: VERDICT — reason`; for a catch, the `catch` line or the first line of its block; `{/* error: … */}` in JSX), or one that follows mechanically from the code:

- `.catch(shown("key"))`: **SHOWN**, with the key.
- `.catch(logged("why"))`: **LOGGED-OK**, with the reason.
- A catch whose last statement is `throw`: **PASSES-ON**.
- A call that is awaited or returned, chained into a handler, or inside a try: the verdict of where its error lands (the caller, the handler, the catch).

| Verdict | Meaning |
|---|---|
| SHOWN | the user sees a plain message. The reason cites the en.json key (since E3, `english:` only on the Developer card, which dev builds show untranslated) |
| LOGGED-OK | logged, with the reason the user needn't see it |
| SILENT-BUG | a user action fails with nothing shown (fixed here, or in a batch) |
| SWALLOWED | the error is discarded without a reason (fixed here, or in a batch) |
| FLOATING | an unhandled promise |
| NOT-WORTH | cannot fail in practice, or the "failure" is the expected answer that the caller shows as a state (a launcher folder that isn't there is "not installed") |
| PASSES-ON | not a handling point: the error goes on to the caller, whose row has the verdict |

PASSES-ON closes mechanically. Every promise the app creates ends at one of: a catch, a `.catch` / `.then` handler, a `void`, or a floating statement. All of those are rows with their own verdicts, and the gate forbids FLOATING.

**Firmware** (`tools/list_errors.py`): see [Firmware](#firmware-marcelinevpqds5dongle-oled-edition) below.

## Counts

### App (`MarcelineVPQ/DS5Dongle-OLED-Config-Web`): 603 rows (re-run 2026-10-15, after E2 and E3)

| Kind | SHOWN | LOGGED-OK | SILENT-BUG | SWALLOWED | FLOATING | NOT-WORTH | PASSES-ON | Total |
|---|---|---|---|---|---|---|---|---|
| catch | 55 | 14 | 0 | 0 | 0 | 104 | 12 | 185 |
| .catch | 36 | 71 | 0 | 0 | 0 | 16 | 1 | 124 |
| .then-reject | 8 | 6 | 0 | 0 | 0 | 6 | 1 | 21 |
| void | 7 | 30 | 0 | 0 | 0 | 5 | 0 | 42 |
| floating | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| ipc-handler | 0 | 3 | 0 | 0 | 0 | 2 | 36 | 41 |
| ipc-call | 31 | 20 | 0 | 0 | 0 | 3 | 14 | 68 |
| schema | 2 | 3 | 0 | 0 | 0 | 13 | 2 | 20 |
| spawn | 6 | 0 | 0 | 0 | 0 | 15 | 9 | 30 |
| fetch | 0 | 0 | 0 | 0 | 0 | 0 | 7 | 7 |
| json-parse | 1 | 0 | 0 | 0 | 0 | 3 | 7 | 11 |
| result-field | 48 | 0 | 0 | 0 | 0 | 2 | 4 | 54 |
| **Total** | **194** | **147** | **0** | **0** | **0** | **169** | **93** | **603** |

No SILENT-BUG, SWALLOWED or FLOATING row is left in the app, and one SHOWN row is in English: the Developer card's HDR test (dev builds only). The first run (2026-10-13, 520 rows) is below; the rows added since are new code (E1's recovery, the Proton picker, OLED sharing, the budgets work, these batches).

| Kind (2026-10-13) | SHOWN | LOGGED-OK | SILENT-BUG | SWALLOWED | FLOATING | NOT-WORTH | PASSES-ON | Total |
|---|---|---|---|---|---|---|---|---|
| **Total** | **170** | **115** | **1** | **1** | **0** | **148** | **85** | **520** |

On 2026-10-13: Electron main process 229 rows, renderer 291. How each verdict was reached: 284 by a comment, 62 from `logged()`, 15 from `shown()`, 12 from a rethrow, 33 IPC handlers that pass a throw to the page, and 114 by following the call to where its error lands.

**As found, before the fixes.** ESLint's `no-floating-promises` (with `void` not exempt) flagged **95 floating promises**, all behind `void`, with no handler. There were **23 silent failures** in user actions. 22 are fixed below, and 1 is left (E1). There were **6 swallowed errors**: BusyButton and Toggle dropped every rejection with "the caller reports its own errors" (several callers didn't), and the main process dropped three malformed IPC sends without a log. 5 are fixed, and 1 is left (E2). There was also **1 raw message**: board results read "Command 0x04 failed".

### Firmware: 253 rows (2026-10-13), 269 after F1

SHOWN 89, LOGGED-OK 42, SILENT-BUG 3 (batch F1), SWALLOWED 0, NOT-WORTH 119. Re-listed 2026-10-15 on firmware branch `fw-bt-idle-mic` (F1 done, not flashed): SHOWN 107, LOGGED-OK 43, SILENT-BUG 0, SWALLOWED 0, NOT-WORTH 119. The per-kind table is below, under Firmware.

## Fixed in this pass (app)

Each fix has a test. They are in `tests/integration/errorPass.test.ts`, `tests/unit/errorPassMain.test.ts` and `tests/integration/gameProfileHook.test.ts`, and the security source checks follow the new code. All new messages are in all 7 languages, under `desktop.errors.*` plus a few next to their feature.

| # | Where | Was | Now (string key) |
|---|---|---|---|
| 1 | Games → Home, **Apply** refused by the main process (an id the IPC schema rejects, as with the graphics-mode fix) | `schema.parse` threw a raw ZodError. The page showed it, then the rescan right after cleared it at once, so nothing stayed on screen | The main process answers `BAD_REQUEST` and logs the schema details (`parseRequest`, ipc.ts). The page says `desktop.errors.badRequest` and keeps it after the rescan |
| 2 | Games → Home, **Undo** that fails (an error result or a throw) | the error was set, then cleared by the rescan | stays on screen (the rescan runs first) |
| 3 | **Undo** of an audio change | a failed WirePlumber restart was dropped (`.catch(() => undefined)`) | `desktop.games.undoAudioRestart` (log out or restart for it to take effect) |
| 4 | **App settings** toggles (launch at login, start minimized, update checks, …) | the save to disk and the autostart file were only logged; the toggle looked changed | the setting is put back, and `desktop.errors.settingNotSaved` is shown |
| 5 | **Tray** toggles (the same settings) | the same failure was only logged | `desktop.errors.settingNotSaved` through the new main-to-page `showError` event (fixed keys, `MAIN_ERROR_KEYS`) |
| 6 | **Tray → switch slot** | `.catch(() => undefined)` | `desktop.errors.slotSwitch` |
| 7 | A **web link** from the page (Help, release notes, …) that doesn't open | nothing | `desktop.errors.linkNotOpened` |
| 8 | **Play / open a launcher link** on Windows and macOS | a failed `shell.openExternal` still answered "opened" | answers false, so the page shows `desktop.library.action.failed` |
| 9 | **Narrator voice / captions** setting | not saved, nothing said | `desktop.errors.settingNotSaved` |
| 10 | **"Keep the app up to date?"** answer | not saved, nothing said | `desktop.errors.settingNotSaved` |
| 11 | **Games consent** (Privacy toggle, Turn off, first-visit Allow) | the window changed before the save; a failed save left the window and the setting disagreeing, with nothing shown | the window changes only once the setting is saved; a failure shows `desktop.errors.settingNotSaved` |
| 12 | A game's page: **create / delete profile** | `void …then(onLibrary)` | `desktop.errors.profileCreate` / `profileDelete` |
| 13 | A game's page: **profile edits, rating, tags, notes** (debounced saves) | `void save()` | `desktop.errors.librarySave` |
| 14 | **Button layouts**: save, update, delete | `void …then(setLibrary)` | `desktop.errors.layoutSave` / `layoutDelete` |
| 15 | A **game's profile** that fails before reaching the board (its restore point can't be saved) | only `console.error` | `desktop.profile.applyFailed` (your normal settings are on) |
| 16 | **Normal settings put back after a game** that fail | only `console.error`; the game's settings stayed on, with no word | `desktop.profile.restoreFailed` (retried when the board reconnects) |
| 17 | **Download and install** (app update) that fails | the banner disappeared | `desktop.update.appFailed` with the reason, until dismissed. A failed scheduled check stays quiet |
| 18 | **Controller info → Refresh** with Sony unreachable | the official-firmware line was blank | `desktop.ctrlInfo.officialUnavailable` (only after Refresh; the automatic check stays quiet) |
| 19 | The **game library** can't be read at start | profiles and layouts silently off | `desktop.errors.libraryRead` |
| 20 | **App settings** can't be read | the card was silently empty | `desktop.errors.settingsRead` |
| 21 | **Mic test**: an unexpected rejection | stuck on "starting", no status line | `desktop.audioTest.problem.failed` |
| 22 | **Windows USB repair**: a rejected call | stuck busy, nothing shown | not stuck any more, and BusyButton shows `desktop.errors.actionFailed` |
| 23 | **BusyButton / Toggle** safety net | dropped every rejection | `desktop.errors.actionFailed` with the reason (callers that report their own errors catch them first) |
| 24 | **Board command results** (slot switch / forget / wipe, Edge buttons, triggers, calibration, curves) | "Command 0x04 failed" | `desktop.errors.boardFailed` / `boardBusy` / `boardRejected` (`causeText`). The firmware's new `CMD_RESULT_FAILED` answers for a failed flash save (see Firmware) read as boardFailed |
| 25 | Main process: malformed `reportStatus` / `setTrayIcon` / `setFirmwareWriting` sends | dropped without a word | logged with the schema details (LOGGED-OK: from our own page, so an app bug) |
| 26 | All 95 floating `void` promises | unhandled | each ends in `.catch(shown(key))` (a user action) or `.catch(logged("why"))` (background: polls, the narrator, art, the tray icon, palette reads) |

Shared pieces, one of each: `logged()` in `src/errorText.ts` (app and main process). In `src/desktop/shownError.ts`: `shown()` / `showError()` / `useShownError()`, which feed one pinned notice in DesktopApp; the three error notices there are now one `ErrorNotice` component. Also `causeText()`, which takes off Electron's IPC wrapper and says `BAD_REQUEST`, ZodErrors and board results in plain words; it replaces `useDs5Bridge`'s own copy of `errorText`, and every on-screen error now uses it. And `closeQuietly()` in `controllerAudio.ts` for the audio tests' contexts, and `sayInPassing()` in `narrator.ts` for event lines.

## The gate

- **ESLint** (typed, `src/` and `electron/`):
  - `@typescript-eslint/no-floating-promises` with `ignoreVoid: false`. The void convention: `void` goes only in front of a handled chain, for example `onClick={() => void x().catch(shown(key))}`.
  - `@typescript-eslint/no-misused-promises`: no async function where a void callback is expected.
  - `no-empty` with `allowEmptyCatch: false`.
- **`node tools/list_errors.mjs --check`** (in `npm run gates`, pre-commit and CI) fails on:
  - a row without a verdict;
  - a SHOWN reason that doesn't start with an en.json key that exists (since E3, `english:` only with "Developer card" in the reason);
  - a FLOATING / SILENT-BUG / SWALLOWED row that doesn't name its batch "(batch E<n>)".

  So every catch block either shows, rethrows, or says why not. Every `.catch` handler too.
- **Firmware**: `python3 tools/list_errors.py --check` in `build.yml` and `release.yml`.

## Batches (the owner picks; E1 done 2026-10-14, E2 and E3 done 2026-10-15)

| Batch | Rows | Verdict | Change |
|---|---|---|---|
| **E1**: a damaged game library says so | `electron/main/games/libraryStore.ts` `readLibrary`/`load` | SILENT-BUG → **SHOWN (done 2026-10-14, branch `trust-fixes`)** | Was: a library file that fails to parse is moved aside (`library.json.bad-<time>`) and the app starts empty with no word. Done for every JSON the app keeps, through one helper (`readPersisted`, `src/persisted.ts`): settings.json, game-library-2.json, the older apps' game-library.json, and the page's JSON preferences (dismissed notices, pins, slot controllers, controller colors, unticked Games changes). What still reads is kept, the damaged copy is kept as `<file>.corrupt-<date>` (or a `<key>.corrupt-<date>` preference), what loaded is written back, and `RecoveredNotice` says it once (`desktop.recovered.*`, all 7 languages; main files over `desktop:recovered-files`). Tests: `tests/integration/persistedData.test.ts`. |
| **E2**: History lists a damaged backup | `electron/main/games/backup.ts` `list` | SWALLOWED → **SHOWN (done 2026-10-15, branch `passes-095`)** | Was: a backup whose manifest can't be read was left out of History, so its Undo disappeared. Now `list()` returns it with `damaged` (its folder) and the time from its id; History says it can't be undone here and shows the folder as a file path (`desktop.games.historyDamaged`, all 7 languages), with no Undo button. Tests: `tests/unit/backupDamaged.test.ts`, `tests/integration/gamesHome.test.ts`. |
| **E3**: translate the English text that reaches the user | 43 rows whose verdict said `english:` / `main-english:` | SHOWN (English) → **SHOWN with keys (done 2026-10-15, branch `passes-095`)** | One mechanism, `src/errorText.ts`: the main process and the protocol code throw `KeyedError(key, params)` or return `keyedText(key, params)`, a string (`⟦key|{params}⟧`) that survives IPC, result fields and being put inside another message. The page says it in the user's language: `causeText` (every on-screen error already used it) and `shownText` (result messages, the update banner's detail, Games' Msg parameters) run `translateKeyed`. WebUSB's own English errors are said by kind (`desktop.errors.usb.*`). The start-failure dialog has no page: `electron/main/mainText.ts` loads the system language's locale file (its own chunk, only then). 57 new strings in all 7 languages: `desktop.errors.main.*` (Games, Proton install and downloads, Undo, the controller's volume, launcher files, the bundled firmware, the dialog), `desktop.errors.board.*` (protocol, timeouts, another program, short answers, OLED keys/pad, controller tests), `desktop.errors.usb.*`, `desktop.usbAccess.result.*`, `desktop.windowsUsb.result.*`, `desktop.firmware.waitForApp`, `desktop.update.untouched`. The app's own validation errors (an invalid curve, remap table, backup id, draft) now say `desktop.errors.badRequest`. The gate no longer accepts `english:` (only on the Developer card). Tests: `tests/integration/errorPassE3.test.ts` (fails each call and checks the German words on screen; every key the main process or protocol code sends exists in all 7 locales). |
| **F1** (firmware): a status line on every OLED screen | `oled.cpp` long-press brightness save, `lightbar_save_config`, `bt.cpp` `slot_assign` after pairing | SILENT-BUG ×3 | See Firmware. Not done: a firmware task with hardware tests (the app batches were done without the board). |

## Found along the way

- The rescan after a failed Apply or Undo wiped the error a moment after it appeared. It looked silent: the error-clearing at the start of `rescan()` ran after the message was set. The test for fix 1 found this.
- `useDs5Bridge.ts` had its own copy of `errorText`, which said "Unexpected USB error" (in English) for anything that wasn't an Error. Merged into `causeText`.
- Lister gaps the verdict pass found, now handled: `.finally()` passes its promise's outcome on (ESLint treats it the same way); conditional branches, `new Set(…)` arguments and object spreads pass a call's error on to where it lands.
- The lister uses `tools/ts_program.mjs`, the TypeScript program the loop and cache listers share (no second copy). Its `lineOf` moved there, and `list_caches.mjs` uses it too.

## Every row, by file

### App (`MarcelineVPQ/DS5Dongle-OLED-Config-Web`)

The verdict, then why. _(italic)_ is how a derived verdict was reached: `via catch L…` means the catch on that line. Line numbers are as of this commit; if code moves, the function name finds the row.

#### electron/main/desktopTheme.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 38 | `plasmaRunning` | catch | `empty: readFileSync` | **NOT-WORTH** | the process ended meanwhile: skip it |
| 42 | `plasmaRunning` | catch | `empty: readdirSync, readFileSync` | **NOT-WORTH** | no /proc: not KDE; the portal and the system accent are tried next |
| 60 | `systemAccent` | catch | `fallback` | **NOT-WORTH** | not available here: null, and the Accent color row says the desktop's accent couldn't be read |
| 76 | `portalAccent > <anonymous>` | spawn | `execFile("gdbus")` | **NOT-WORTH** | no portal or no gdbus answers null: the system accent is tried next, else the Accent color row says it couldn't be read |
| 104 | `readKdeGlobals` | catch | `fallback: readFileSync` | **NOT-WORTH** | no readable kdeglobals: the portal and the system accent are tried next |
| 139 | `watchDesktopPalette` | catch | `fallback` | **NOT-WORTH** | no KDE config folder to watch: an accent change is picked up at the next start |

#### electron/main/download.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 30 | `downloadBytes` | fetch | `net.fetch` | **PASSES-ON** | awaited: the caller of downloadBytes handles it _(flow)_ |
| 41 | `downloadVerified` | .catch | `(cause: unknown) => { throw cause instanceof Error && cause.` | **PASSES-ON** | the handler rethrows _(rethrow)_ |
| 41 | `downloadVerified` | fetch | `net.fetch` | **PASSES-ON** | the handler rethrows _(via .catch L41)_ |
| 58 | `downloadVerified` | .catch | `() => undefined` | **NOT-WORTH** | only marks the write-error promise handled; the same rejection is awaited through Promise.race below and rethrown |
| 81 | `downloadVerified` | catch | `rethrow` | **NOT-WORTH** | cleanup while the real error is rethrown below; a failed cancel adds nothing |
| 84 | `downloadVerified` | .catch | `() => undefined` | **NOT-WORTH** | cleanup while the real error is rethrown below; a failed cancel adds nothing |
| 84 | `downloadVerified` | void | `reader.cancel().catch(() => undefined)` | **NOT-WORTH** | cleanup while the real error is rethrown below; a failed cancel adds nothing |

#### electron/main/feedSignature.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 23 | `feedSignedBy` | catch | `fallback` | **NOT-WORTH** | a key that can't be read verifies nothing: the update is refused as unsigned, which the banner says |

#### electron/main/firmwareSource.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 34 | `readBundled` | json-parse | `readFileSync(join(dir, "firmware.json"),` | **NOT-WORTH** | development builds have no bundled firmware: the published one is used _(via catch L36)_ |
| 34 | `readBundled` | schema | `BundleInfo.parse` | **NOT-WORTH** | development builds have no bundled firmware: the published one is used _(via catch L36)_ |
| 36 | `readBundled` | catch | `fallback: zod.parse, JSON.parse, readFileSync` | **NOT-WORTH** | development builds have no bundled firmware: the published one is used |
| 65 | `<module>` | result-field | `FirmwareSourceDeps.manifest.problem: FirmwareLookup["problem"]` | **SHOWN** | desktop.firmware.offline (FirmwarePage: unpublished / offline under Latest, checkedNone / checkedOffline after Check now) |
| 84 | `firmwareFeed > <anonymous>` | catch | `fallback` | **SHOWN** | desktop.firmware.offline / .unsigned / .malformed (problem on the Firmware card; the last feed verified answers when there's one) |
| 120 | `firmwareBytes` | catch | `rethrow` | **PASSES-ON** | rethrows to the caller _(rethrow)_ |

#### electron/main/games/appinfo.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 132 | `parseAppTypes` | catch | `empty` | **NOT-WORTH** | damaged entry: keep what was read |
| 142 | `steamAppTypes` | catch | `fallback: readFileSync` | **NOT-WORTH** | no appinfo.vdf: app types unknown, so every Steam entry is listed as a game |

#### electron/main/games/artRequest.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 32 | `artRequestTarget` | catch | `fallback: new URL` | **NOT-WORTH** | a malformed art URL answers 404: the tile keeps its placeholder |
| 39 | `artRequestTarget` | schema | `GameKeySchema.safeParse` | **NOT-WORTH** | a key that isn't a game key answers 404 (the page only asks for keys from the scan) |

#### electron/main/games/artThumbs.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 95 | `forget` | .catch | `logged("deleting the scaled game art copies after Games cons` | **LOGGED-OK** | deleting the scaled game art copies after Games consent was turned off (deleted again at the next start without consent) _(logged())_ |
| 110 | `path` | catch | `fallback: stat` | **NOT-WORTH** | the art file went away since the scan: the source path answers 404 through net.fetch, and the tile keeps its placeholder |
| 121 | `path` | .catch | `logged("marking a cached game art copy as used (only its evi` | **LOGGED-OK** | marking a cached game art copy as used (only its eviction order) _(logged())_ |
| 121 | `path` | void | `utimes(join(this.dir, hit.name), now, now).catch(logged("mar` | **LOGGED-OK** | marking a cached game art copy as used (only its eviction order) _(via .catch L121)_ |
| 139 | `make > then(cb)` | catch | `fallback` | **LOGGED-OK** | the page gets the full-size file instead (more memory, same picture) |
| 152 | `make > then(cb)` | catch | `fallback: mkdir, writeFile, rename` | **LOGGED-OK** | the copy isn't kept: the full-size file is served and the copy is made again next time |
| 162 | `make` | .catch | `logged("the game art scaling queue (the next picture still r` | **LOGGED-OK** | the game art scaling queue (the next picture still runs) _(logged())_ |
| 175 | `load > <anonymous>` | catch | `empty: readdir` | **NOT-WORTH** | no cache folder yet (first run): it is made with the first copy |
| 182 | `load > <anonymous>` | .catch | `logged("removing a half-written game art copy (it is written` | **LOGGED-OK** | removing a half-written game art copy (it is written again) _(logged())_ |
| 190 | `load > <anonymous>` | catch | `empty: stat` | **NOT-WORTH** | removed while listing: that copy is made again when asked for |
| 214 | `evict` | .catch | `logged("removing an old game art copy (it is removed again a` | **LOGGED-OK** | removing an old game art copy (it is removed again at the next start) _(logged())_ |

#### electron/main/games/backup.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 109 | `target` | catch | `fallback` | **NOT-WORTH** | no real path (a new file): the path itself is used |
| 122 | `writeFileAtomic` | catch | `empty: statSync` | **NOT-WORTH** | new file |
| 134 | `writeFileAtomic` | catch | `rethrow: openSync, renameSync` | **PASSES-ON** | rethrows to the caller _(rethrow)_ |
| 158 | `isLink` | catch | `fallback: lstatSync` | **NOT-WORTH** | a missing path is not a link |
| 197 | `run` | catch | `rethrow` | **PASSES-ON** | rethrows to the caller _(rethrow)_ |
| 204 | `run` | catch | `rethrow` | **PASSES-ON** | rethrows to the caller _(rethrow)_ |
| 212 | `run` | catch | `empty` | **NOT-WORTH** | the change is made and its originals are saved; without the hashes Undo only can't detect later edits (next lines) |
| 260 | `list` | catch | `fallback: readdirSync` | **NOT-WORTH** | no backup folder yet: History lists nothing, which is true |
| 272 | `list` | catch | `fallback` | **SHOWN** | desktop.games.historyDamaged (batch E2): listed in History as damaged, with its folder, instead of disappearing |
| 281 | `manifest` | json-parse | `readFileSync(join(this.dir, id, "manifes` | **PASSES-ON** | throws to the caller: the caller of manifest handles it _(flow)_ |
| 281 | `manifest` | schema | `ManifestSchema.parse` | **PASSES-ON** | returned: the caller of manifest handles it _(flow)_ |
| 303 | `prune` | catch | `fallback` | **NOT-WORTH** | an unreadable backup is left for the user to inspect, not pruned (History lists it as damaged, desktop.games.historyDamaged) |

#### electron/main/games/details.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 94 | `note` | catch | `fallback: statSync` | **NOT-WORTH** | the file went away between listing and stat: that art is skipped |
| 111 | `steamArt` | catch | `empty: readdirSync` | **NOT-WORTH** | no per-app folder |
| 200 | `lutrisDetails` | catch | `fallback` | **NOT-WORTH** | no readable Lutris database: no Lutris art or play time (the tile keeps its placeholder) |

#### electron/main/games/fake/service.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 202 | `artFile` | .catch | `logged("drawing a fake game's art (Developer card → Fake gam` | **LOGGED-OK** | drawing a fake game's art (Developer card → Fake games; that picture answers 404, the tile keeps its placeholder) _(logged())_ |
| 204 | `artFile` | .catch | `() => undefined` | **NOT-WORTH** | the failure is logged by the queue's catch above; the ds5-art handler answers 404 for undefined |

#### electron/main/games/files.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 24 | `readParsed` | catch | `fallback` | **NOT-WORTH** | readParsed's contract: a missing or broken file reads as null, which each caller treats as "not set up" |
| 33 | `readText` | catch | `fallback: readFileSync` | **NOT-WORTH** | readParsed's contract: a missing file reads as null ("not set up") |
| 56 | `filesIn` | catch | `fallback: readdirSync` | **NOT-WORTH** | no such folder: nothing to read ahead there |
| 71 | `worker` | .catch | `() => null` | **NOT-WORTH** | readParsed's contract: a missing or unreadable file reads as null ("not set up") |

#### electron/main/games/games.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 1060 | `launchersToRestart` | result-field | `launchersToRestart.blockedBy: LauncherId[]` | **SHOWN** | desktop.games.restartGameRunning (useRestartText names the launcher: restartGameRunning / restartTimeout / restartFailed / launcherStarted; Apply and Undo on Home and the game page) |
| 1147 | `writeChosen` | catch | `fallback` | **LOGGED-OK** | the levels are set and saved; only Undo won't put the old saved levels back (it still puts the live ones back) |
| 1153 | `writeChosen` | catch | `fallback` | **SHOWN** | desktop.games.msg.result.restartFailed (or volumeFailed / profileFailed, on the change's row in the Done list) |
| 1182 | `writeEdits` | json-parse | `text` | **PASSES-ON** | throws to the caller: the caller of writeEdits handles it _(flow)_ |

#### electron/main/games/hdr.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 102 | `findOnPath` | catch | `empty: statSync` | **NOT-WORTH** | not here |
| 127 | `hasLayer` | catch | `fallback: readdirSync` | **NOT-WORTH** | no layer folder: the HDR checklist shows the layer as missing |
| 154 | `screens` | catch | `fallback` | **SHOWN** | desktop.hdrCheck.screen.failed (check "failed" on the HDR checklist) |
| 166 | `gamescopeVersion` | catch | `fallback` | **NOT-WORTH** | Older builds without --version print their usage and fail. |

#### electron/main/games/heroic.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 163 | `heroicBuilds` | catch | `empty: readdirSync` | **NOT-WORTH** | no tools/wine folder: no Wine builds from Heroic |

#### electron/main/games/libraryStore.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 33 | `salvageGame` | schema | `GameRecordSchema.safeParse` | **NOT-WORTH** | an entry that doesn't fit is salvaged part by part below; what's lost is counted, which the notice says |
| 37 | `salvageGame` | schema | `GameRecordSchema.shape.title.safeParse` | **NOT-WORTH** | no readable title: the entry is dropped and counted as lost |
| 44 | `salvageGame` | schema | `z.number().safeParse` | **NOT-WORTH** | a profile without a readable time is dropped and counted as lost |
| 56 | `salvageLibrary` | schema | `LibraryFileSchema.safeParse` | **NOT-WORTH** | a file that doesn't fit whole is salvaged part by part below; what's lost is counted, which the notice says |
| 65 | `salvageLibrary > salvageRecord(cb)` | schema | `ButtonLayoutSchema.safeParse` | **NOT-WORTH** | a layout that doesn't fit is left out and counted as lost |
| 69 | `salvageLibrary` | schema | `LibraryFileSchema.shape.restore.safeParse` | **NOT-WORTH** | a restore point that doesn't fit is left out (the dongle keeps its settings); counted as lost |
| 108 | `load` | catch | `empty` | **NOT-WORTH** | can't write it now; the next save tries again |

#### electron/main/games/lutris.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 42 | `findLutrisInstalls` | catch | `empty: readdirSync` | **NOT-WORTH** | no ~/.config/lutris/games: Lutris uses the data dir |
| 106 | `listLutrisGames` | catch | `fallback` | **NOT-WORTH** | no readable pga.db: the yml game files are listed instead |
| 113 | `listLutrisGames` | catch | `fallback: readdirSync` | **NOT-WORTH** | no games folder: no Lutris games, which the page shows |
| 133 | `lutrisWineBuilds` | catch | `fallback: readdirSync` | **NOT-WORTH** | no runner folder: no Lutris Wine builds |

#### electron/main/games/processes.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 166 | `<module>` | result-field | `ClosedRun.ok: false` | **SHOWN** | desktop.games.restartFailed (useRestartText: problem game-running / timeout / failed) |
| 166 | `<module>` | result-field | `ClosedRun.problem: CloseProblem` | **SHOWN** | desktop.games.restartFailed (useRestartText: problem game-running / timeout / failed) |
| 181 | `reopenAll` | .catch | `() => false` | **SHOWN** | desktop.games.reopenFailed (a launcher that didn't start again is in reopenFailed) |
| 188 | `withLaunchersClosed` | .catch | `() => "failed" as const` | **SHOWN** | desktop.games.restartFailed (problem "failed", nothing written) |
| 198 | `withLaunchersClosed` | catch | `rethrow` | **PASSES-ON** | rethrows to the caller _(rethrow)_ |
| 213 | `envOf` | catch | `fallback: readFileSync` | **NOT-WORTH** | environ unreadable (another user's or a gone process): no value |
| 225 | `run` | spawn | `execFile(cmd)` | **SHOWN** | desktop.games.restartTimeout (a quit request that fails leaves the launcher running, which the close then reports) |
| 230 | `signal` | catch | `empty` | **NOT-WORTH** | already gone |
| 253 | `steamReportsGame > <anonymous>` | spawn | `execFile(system32("reg.exe"))` | **NOT-WORTH** | no answer from reg.exe reads as "Steam reports no game"; the process list is checked too |
| 276 | `run` | spawn | `execFile(cmd)` | **SHOWN** | desktop.games.restartTimeout (a quit request that fails leaves the launcher running, which the close then reports) |
| 280 | `signal` | spawn | `execFile(system32("taskkill.exe"))` | **SHOWN** | desktop.games.restartTimeout (a taskkill that fails leaves the launcher running, which the close then reports) |

#### electron/main/games/proton.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 66 | `protonBuilds` | catch | `fallback: readdirSync` | **NOT-WORTH** | no tools folder: no builds |
| 161 | `freeBytes` | catch | `fallback` | **NOT-WORTH** | free space unknown: the install goes ahead, and a full disk fails it with its own message |
| 175 | `cleanStaging` | catch | `empty: readdirSync, rmSync` | **NOT-WORTH** | dir not there yet |
| 208 | `installProton` | spawn | `run("tar")` | **PASSES-ON** | awaited: the caller of installProton handles it _(flow)_ |
| 214 | `installProton` | spawn | `run("tar")` | **PASSES-ON** | awaited: the caller of installProton handles it _(flow)_ |
| 245 | `installProton` | spawn | `run("cp")` | **PASSES-ON** | awaited: the caller of installProton handles it _(flow)_ |

#### electron/main/games/running.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 93 | `uptimeS` | catch | `fallback: readFileSync` | **NOT-WORTH** | no uptime: every process counts as old (cached reads) |
| 108 | `readFull` | catch | `empty: readFileSync` | **NOT-WORTH** | environ unreadable (another session's process) |
| 114 | `readFull` | catch | `empty` | **NOT-WORTH** | gone |
| 138 | `readProcs` | catch | `fallback: readdirSync` | **NOT-WORTH** | no /proc: no running games seen (the watcher polls again) |
| 176 | `readProcs` | catch | `empty: statSync, readFileSync` | **NOT-WORTH** | process exited while we looked |
| 208 | `wineExe` | catch | `empty` | **NOT-WORTH** | exe link unreadable: not counted as a Wine process |
| 231 | `launched` | catch | `empty: readFileSync` | **NOT-WORTH** | gone, or not readable |
| 244 | `readProcs` | catch | `empty` | **NOT-WORTH** | process exited while we looked |
| 308 | `readTasklist > <anonymous>` | spawn | `execFile(join(process.env.SystemRoot ?? "C:\\Wind)` | **NOT-WORTH** | tasklist failed: this pass sees no processes; the next pass (3 s) looks again |
| 340 | `walk` | catch | `fallback: readdirSync` | **NOT-WORTH** | an unreadable folder is skipped while listing a game's executables |
| 415 | `pass` | .catch | `logged("running-game watcher pass")` | **LOGGED-OK** | running-game watcher pass _(logged())_ |
| 415 | `pass` | void | `Promise.resolve(this.tick()).catch(logged("running-game watc` | **LOGGED-OK** | running-game watcher pass _(via .catch L415)_ |

#### electron/main/games/schemeHandler.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 61 | `realHome` | catch | `fallback` | **NOT-WORTH** | no passwd entry: HOME is used |
| 166 | `spawnDetached > <anonymous>` | spawn | `spawn(cmd)` | **SHOWN** | desktop.library.action.failed (a start that fails resolves false up to the game action) |
| 215 | `shellStart > <anonymous>` | spawn | `spawn(powershellExe())` | **SHOWN** | desktop.library.action.failed (a start that fails or times out resolves false up to the game action) |
| 236 | `run > <anonymous>` | spawn | `execFile("systemctl")` | **NOT-WORTH** | no user systemd answers null: the program is started without it |
| 244 | `systemdRun > <anonymous>` | spawn | `execFile("systemd-run")` | **NOT-WORTH** | "failed" / "timeout" make startIndependent fall back to a detached start |
| 287 | `defaultHandler > <anonymous>` | spawn | `execFile("xdg-mime")` | **NOT-WORTH** | no xdg-mime (err): Electron's own lookup answers instead |
| 304 | `electronSays` | catch | `fallback` | **NOT-WORTH** | can't tell: the open attempt decides, and a failed open shows desktop.library.action.failed |
| 342 | `schemeHandlerExec` | catch | `empty: readFile` | **NOT-WORTH** | not in this folder |

#### electron/main/games/service.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 93 | `exclusive` | .then-reject | `run` | **NOT-WORTH** | runs after a failed earlier job too: one job's failure must not block the next (it already went to that job's caller) |
| 95 | `exclusive` | .catch | `() => undefined` | **NOT-WORTH** | the queue's own copy; the caller gets 'next' with the error |
| 119 | `refreshLatest` | catch | `empty` | **NOT-WORTH** | offline: the scan keeps the last known Proton build and offers no update it can't see |
| 323 | `undo > exclusive(cb)` | .catch | `(cause: unknown) => (audioRestartFailed = errorText(cause))` | **SHOWN** | desktop.games.undoAudioRestart (was SILENT-BUG: the failed restart was dropped) |
| 344 | `undo > exclusive(cb)` | catch | `fallback` | **SHOWN** | desktop.errors.main.alreadyUndone and the other keyed errors (shownText in GamesPage's error notice after Undo); an OS error's own text as it is |
| 371 | `installLatestProton > exclusive(cb)` | catch | `fallback` | **SHOWN** | desktop.updateFeed.offline / .unsigned / .malformed by problem on the Proton card (the raw text goes to the log) |
| 398 | `installLatestProton > exclusive(cb)` | catch | `fallback` | **SHOWN** | desktop.errors.main.diskSpace and the other keyed install/download errors (shownText on the Proton card); an OS error's own text as it is |

#### electron/main/games/steam.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 36 | `windowsSteamRoots` | spawn | `execFileSync(join(process.env.SystemRoot ?? "C:\\Wind)` | **NOT-WORTH** | no Steam in the registry _(via catch L43)_ |
| 43 | `windowsSteamRoots` | catch | `empty: child_process` | **NOT-WORTH** | no Steam in the registry |
| 71 | `findSteamInstalls` | catch | `fallback` | **NOT-WORTH** | a candidate Steam folder that isn't there |
| 92 | `newestLocalConfig` | catch | `empty: statSync` | **NOT-WORTH** | no localconfig for this account |
| 96 | `newestLocalConfig` | catch | `fallback: readdirSync, statSync` | **NOT-WORTH** | no userdata folder: no localconfig, so the launch options read as empty |

#### electron/main/games/system.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 48 | `dualSenseCards` | spawn | `run("pactl")` | **NOT-WORTH** | no pactl (no PipeWire/Pulse): no cards, and the audio check shows the controller as not found _(via catch L50)_ |
| 50 | `dualSenseCards` | catch | `fallback: child_process` | **NOT-WORTH** | no pactl (no PipeWire/Pulse): no cards, and the audio check shows the controller as not found |
| 89 | `findProAudioRules` | catch | `fallback: readdirSync` | **NOT-WORTH** | rule folder missing: no rules there |
| 97 | `findProAudioRules` | catch | `empty: readFileSync` | **NOT-WORTH** | unreadable: skip |
| 120 | `findGlobalSdlVars` | catch | `empty: readdirSync` | **NOT-WORTH** | missing dir |
| 133 | `findGlobalSdlVars` | catch | `empty: readFileSync` | **NOT-WORTH** | missing file |
| 147 | `hidrawAccess` | catch | `fallback: readdirSync` | **NOT-WORTH** | no hidraw class: access unknown (null), so the check isn't shown |
| 160 | `hidrawAccess` | catch | `empty: readFileSync` | **NOT-WORTH** | not this node / no access |
| 168 | `restartWirePlumber` | spawn | `run("systemctl")` | **PASSES-ON** | awaited: the caller of restartWirePlumber handles it _(flow)_ |
| 173 | `setCardProfile` | spawn | `run("pactl")` | **PASSES-ON** | awaited: the caller of setCardProfile handles it _(flow)_ |
| 251 | `findDualSenseAlsaCards` | catch | `fallback: readdirSync` | **NOT-WORTH** | no sound class: no cards |
| 269 | `findDualSenseAlsaCards` | catch | `empty: readFileSync` | **NOT-WORTH** | not a USB card, or it went away |
| 341 | `contents` | spawn | `run("amixer")` | **PASSES-ON** | awaited: the caller of contents handles it _(flow)_ |
| 344 | `set` | spawn | `run("amixer")` | **PASSES-ON** | awaited: the caller of set handles it _(flow)_ |
| 350 | `saved` | catch | `fallback: readFileSync` | **NOT-WORTH** | no saved-state file (no alsa-utils) or the card went away: nothing saved, so only the live levels count |
| 365 | `dualSenseMixers` | catch | `empty` | **NOT-WORTH** | amixer missing or the card went away |

#### electron/main/games/volumeKeeper.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 53 | `start` | catch | `fallback` | **LOGGED-OK** | no /dev/snd to watch (no sound cards): nothing to keep; the Games page still shows low levels with its fix |
| 75 | `runCheck` | .catch | `logged("checking the controller volume (check() catches its ` | **LOGGED-OK** | checking the controller volume (check() catches its own errors) _(logged())_ |
| 75 | `runCheck` | void | `this.check().catch(logged("checking the controller volume (c` | **LOGGED-OK** | checking the controller volume (check() catches its own errors) _(via .catch L75)_ |
| 81 | `check` | catch | `fallback` | **LOGGED-OK** | retried a few times below, then logged: background, not a user action (the Games page offers the fix again) |

#### electron/main/games/windowsStores.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 49 | `parseEpicManifest` | json-parse | `text.replace(/^\uFEFF/, "")` | **NOT-WORTH** | a broken Epic manifest: that game isn't listed _(via catch L50)_ |
| 50 | `parseEpicManifest` | catch | `fallback: JSON.parse` | **NOT-WORTH** | a broken Epic manifest: that game isn't listed |
| 68 | `readGogGames > <anonymous>` | spawn | `execFileSync(regExe())` | **PASSES-ON** | returned: the caller of <anonymous> handles it _(flow)_ |
| 71 | `readGogGames` | catch | `fallback` | **NOT-WORTH** | no GOG registry key: no GOG games |
| 81 | `readEpicGames` | catch | `fallback: readdirSync` | **NOT-WORTH** | no Epic manifests folder: no Epic games |
| 90 | `readEpicGames` | catch | `empty: readFileSync` | **NOT-WORTH** | unreadable manifest |

#### electron/main/games/winProcs.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 68 | `windowsProcReader > <anonymous>` | .catch | `(cause: unknown) => { console.warn("running programs: native` | **LOGGED-OK** | no native reader on this PC: the running-game check keeps working through tasklist (only costs more CPU) |
| 76 | `windowsProcReader > <anonymous>` | catch | `log-only` | **LOGGED-OK** | this pass reads through tasklist; the next pass tries the snapshot again |

#### electron/main/index.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 92 | `isDirectory` | catch | `fallback: statSync` | **NOT-WORTH** | a missing folder is "no folder": the game action returns false and the page shows desktop.library.action.failed |
| 114 | `<module>` | .catch | `async (cause: unknown) => { // error: LOGGED-OK — the locale` | **SHOWN** | desktop.errors.main.startFailed in a dialog, in the system's language (mainText); no window exists to show it in |
| 116 | `catch(cb)` | .catch | `(why: unknown) => { logged("translating the start-failure di` | **LOGGED-OK** | the locale file couldn't be loaded: the dialog still says it, in English |
| 136 | `recordGpuCrash > on(cb)` | catch | `fallback` | **LOGGED-OK** | not a user action: this run already falls back to software rendering; the next crash tries again |
| 165 | `start > setTimeout(cb)` | .catch | `logged("tidying the portable exe's leftovers in Temp (best e` | **LOGGED-OK** | tidying the portable exe's leftovers in Temp (best effort, retried next start) _(logged())_ |
| 165 | `start > setTimeout(cb)` | void | `pruneUnpackLeftovers(app.getPath("temp"), process.execPath, ` | **LOGGED-OK** | tidying the portable exe's leftovers in Temp (best effort, retried next start) _(via .catch L165)_ |
| 172 | `start` | catch | `fallback` | **LOGGED-OK** | only the one-time "now installed" notice depends on it |
| 180 | `scheduledCheck` | .catch | `logged("scheduled update check (not started by the user; a f` | **LOGGED-OK** | scheduled update check (not started by the user; a failed check shows as the 'failed' banner state) _(logged())_ |
| 188 | `start` | catch | `fallback` | **LOGGED-OK** | the start-up re-apply of an unchanged setting; changing it in App settings or the tray shows desktop.errors.settingNotSaved |
| 205 | `setSetting` | catch | `fallback` | **SHOWN** | desktop.errors.settingNotSaved (the tray's checkbox goes back; updateSetting logged the cause) |
| 214 | `checkForUpdates` | .catch | `logged("updater.check() doesn't reject: a failed check is th` | **LOGGED-OK** | updater.check() doesn't reject: a failed check is the 'failed' banner in the window just shown _(logged())_ |
| 255 | `keepVolume` | catch | `fallback` | **SHOWN** | desktop.errors.settingNotSaved (the levels are set; only keeping them after a reconnect isn't remembered; updateSetting logged the cause) |
| 309 | `start > <anonymous>` | .then-reject | `logged("background scan for the running-game watcher (the Ga` | **LOGGED-OK** | background scan for the running-game watcher (the Games page scans again and shows its own errors) _(logged())_ |
| 309 | `start > <anonymous>` | void | `games.scan().then( // Consent may have been turned off while` | **LOGGED-OK** | background scan for the running-game watcher (the Games page scans again and shows its own errors) _(via .then-reject L309)_ |
| 329 | `start > handle(cb)` | fetch | `net.fetch` | **PASSES-ON** | returned: the caller of handle(cb) handles it _(flow)_ |
| 334 | `start > <anonymous>` | fetch | `net.fetch` | **PASSES-ON** | returned: the caller of <anonymous> handles it _(flow)_ |
| 371 | `pictures` | catch | `fallback` | **NOT-WORTH** | no Pictures folder on this system: the dialog starts in the home folder |
| 436 | `gameAction` | .catch | `() => null` | **NOT-WORTH** | no quiet start for this game: the launcher link below starts it instead |
| 443 | `gameAction` | .then-reject | `() => false` | **SHOWN** | desktop.library.action.failed (was SILENT-BUG: a failed open still answered true) |
| 488 | `start > watchDesktopPalette(cb)` | void | `readDesktopPalette() .then((palette) => mainWindow?.webConte` | **LOGGED-OK** | following the desktop's accent color (the theme keeps its last colors) _(via .catch L490)_ |
| 490 | `start > watchDesktopPalette(cb)` | .catch | `logged("following the desktop's accent color (the theme keep` | **LOGGED-OK** | following the desktop's accent color (the theme keeps its last colors) _(logged())_ |
| 527 | `installInBackground` | .catch | `logged("automatic update install (a failure shows as the 'fa` | **LOGGED-OK** | automatic update install (a failure shows as the 'failed' banner) _(logged())_ |
| 527 | `installInBackground` | void | `updater.downloadAndInstall().catch(logged("automatic update ` | **LOGGED-OK** | automatic update install (a failure shows as the 'failed' banner) _(via .catch L527)_ |
| 549 | `updateSetting` | catch | `rethrow` | **PASSES-ON** | rethrows to the caller _(rethrow)_ |
| 554 | `updateSetting` | catch | `empty` | **NOT-WORTH** | the file couldn't be written a moment ago either; it still holds the old value |
| 569 | `updateSetting` | .catch | `logged("updater.check() doesn't reject: a failed check is th` | **LOGGED-OK** | updater.check() doesn't reject: a failed check is the 'failed' banner _(logged())_ |
| 689 | `createWindow` | .catch | `logged("loading the app's own page")` | **LOGGED-OK** | loading the app's own page _(logged())_ |
| 698 | `openExternalLink` | .then-reject | `() => showMainError("desktop.errors.linkNotOpened")` | **SHOWN** | desktop.errors.linkNotOpened (was SILENT-BUG: a link that didn't open showed nothing) |
| 717 | `isAppUrl` | catch | `fallback: new URL` | **NOT-WORTH** | not a URL is "not the app's page": navigation stays blocked, as intended |

#### electron/main/integration.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 35 | `integrateDesktop` | catch | `log-only` | **LOGGED-OK** | start-up desktop integration (menu entry, Start menu shortcut): nothing the user asked for, and the app works without it |
| 44 | `realpathOrSelf` | catch | `fallback` | **NOT-WORTH** | no real path: the path itself |
| 59 | `integrateAppImage` | catch | `empty: lstatSync, rmSync` | **NOT-WORTH** | Read-only folder: fall back to the versioned path. |
| 81 | `integrateAppImage` | catch | `empty: readFileSync` | **NOT-WORTH** | First run. |
| 89 | `integrateAppImage` | spawn | `execFile("update-desktop-database")` | **NOT-WORTH** | menu cache refresh, a no-op where the tool doesn't exist |
| 92 | `integrateAppImage` | spawn | `execFile("kbuildsycoca6")` | **NOT-WORTH** | menu cache refresh, a no-op where the tool doesn't exist |
| 92 | `integrateAppImage > execFile(cb)` | spawn | `execFile("kbuildsycoca5")` | **NOT-WORTH** | menu cache refresh, a no-op where the tool doesn't exist |

#### electron/main/ipc.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 46 | `parseRequest` | schema | `schema.safeParse` | **SHOWN** | desktop.errors.badRequest (the page maps BAD_REQUEST to it) |
| 131 | `<module>` | result-field | `IpcHandlers.setupUsbAccess.ok: boolean` | **SHOWN** | desktop.usbAccess.result.* (keyed text) under Set up USB access (UsbAccessSetup) |
| 133 | `<module>` | result-field | `IpcHandlers.repairWindowsUsb.ok: boolean` | **SHOWN** | desktop.windowsUsb.result.* (keyed text) under the Windows USB repair (WindowsUsbRepair) |
| 163 | `registerIpc` | ipc-handler | `on IPC.reportStatus` | **LOGGED-OK** | a status that doesn't fit is logged (an app bug); the tray keeps its last status |
| 166 | `registerIpc > on(cb)` | schema | `DeviceStatusSchema.safeParse` | **LOGGED-OK** | our own page's status report not fitting is an app bug, logged; the tray keeps its last status |
| 173 | `registerIpc` | ipc-handler | `on IPC.setTrayIcon` | **LOGGED-OK** | an icon that doesn't fit is logged (an app bug); the tray keeps its last icon |
| 176 | `registerIpc > on(cb)` | schema | `TrayIconSchema.safeParse` | **LOGGED-OK** | an icon from our own page that doesn't fit is an app bug, logged; the tray keeps its last icon |
| 182 | `registerIpc` | ipc-handler | `handle IPC.getSettings` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 189 | `registerIpc` | ipc-handler | `on IPC.appVersion` | **NOT-WORTH** | a synchronous read of a constant; an untrusted sender gets "" |
| 199 | `registerIpc` | ipc-handler | `handle IPC.checkForUpdates` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 200 | `registerIpc` | ipc-handler | `handle IPC.getUpdateState` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 201 | `registerIpc` | ipc-handler | `handle IPC.installUpdate` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 202 | `registerIpc` | ipc-handler | `handle IPC.backToStable` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 203 | `registerIpc` | ipc-handler | `handle IPC.getDesktopPalette` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 204 | `registerIpc` | ipc-handler | `handle IPC.recoveredFiles` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 206 | `registerIpc` | ipc-handler | `handle IPC.getFirmwareHold` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 209 | `registerIpc` | ipc-handler | `on IPC.setFirmwareWriting` | **LOGGED-OK** | a value that doesn't fit is logged (an app bug) |
| 212 | `registerIpc > on(cb)` | schema | `z.boolean().safeParse` | **LOGGED-OK** | only our own page sends it, always a boolean; a misfit is an app bug, logged |
| 219 | `registerIpc` | ipc-handler | `on IPC.restartToUpdate` | **NOT-WORTH** | no payload to reject; an untrusted sender is ignored, as for every channel |
| 224 | `registerIpc` | ipc-handler | `handle IPC.usbAccessInstalled` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 230 | `registerIpc` | ipc-handler | `handle IPC.setupUsbAccess` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 236 | `registerIpc` | ipc-handler | `handle IPC.repairWindowsUsb` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 241 | `registerIpc` | ipc-handler | `handle IPC.gamesScan` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 242 | `registerIpc` | ipc-handler | `handle IPC.gamesBackups` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 243 | `registerIpc` | ipc-handler | `handle IPC.gamesRunningLaunchers` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 244 | `registerIpc` | ipc-handler | `handle IPC.installProton` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 251 | `registerIpc` | ipc-handler | `handle IPC.gamesApply` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 252 | `registerIpc` | ipc-handler | `handle IPC.gamesUndo` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 253 | `registerIpc` | ipc-handler | `handle IPC.gamesDetails` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 254 | `registerIpc` | ipc-handler | `handle IPC.gamesRunning` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 255 | `registerIpc` | ipc-handler | `handle IPC.libraryGet` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 256 | `registerIpc` | ipc-handler | `handle IPC.librarySetProfile` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 257 | `registerIpc` | ipc-handler | `handle IPC.libraryDeleteProfile` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 258 | `registerIpc` | ipc-handler | `handle IPC.librarySetMine` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 259 | `registerIpc` | ipc-handler | `handle IPC.librarySetRestore` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 260 | `registerIpc` | ipc-handler | `handle IPC.librarySetLayout` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 261 | `registerIpc` | ipc-handler | `handle IPC.libraryDeleteLayout` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 262 | `registerIpc` | ipc-handler | `handle IPC.gameAction` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 263 | `registerIpc` | ipc-handler | `handle IPC.gameArtColor` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 264 | `registerIpc` | ipc-handler | `handle IPC.devFakeGames` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 265 | `registerIpc` | ipc-handler | `handle IPC.officialControllerFirmware` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 266 | `registerIpc` | ipc-handler | `handle IPC.devChannelPreview` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 267 | `registerIpc` | ipc-handler | `handle IPC.latestFirmware` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 268 | `registerIpc` | ipc-handler | `handle IPC.downloadFirmware` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 269 | `registerIpc` | ipc-handler | `handle IPC.copyOledImage` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 273 | `registerIpc` | ipc-handler | `handle IPC.saveOledImage` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 279 | `registerIpc` | ipc-handler | `handle IPC.setSetting` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |

#### electron/main/linuxSetup.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 28 | `sandboxProfileNeeded` | catch | `fallback: readFileSync, existsSync` | **NOT-WORTH** | no AppArmor knob: no sandbox profile needed |
| 37 | `sameFile` | catch | `fallback: existsSync, readFileSync` | **NOT-WORTH** | unreadable: treated as different, so the file is installed again |
| 45 | `<module>` | result-field | `SetupResult.ok: boolean` | **SHOWN** | desktop.usbAccess.result.* (keyed text, the page's shownText) under Set up USB access |
| 74 | `installUsbRule` | catch | `fallback: writeFileSync, readFileSync` | **SHOWN** | desktop.usbAccess.result.failed under Set up USB access |
| 104 | `<module>` | result-field | `PkexecResult.ok: false` | **PASSES-ON** | each caller shows the outcome (the USB setup message; the Games Done list / Undo note) |
| 104 | `<module>` | result-field | `PkexecResult.reason: "missing" \| "cancelled" \| "failed"` | **PASSES-ON** | each caller shows the outcome (the USB setup message; the Games Done list / Undo note) |
| 111 | `runPkexec > <anonymous>` | spawn | `execFile("pkexec")` | **PASSES-ON** | the outcome goes to the caller, which shows it (USB setup message, the Games Done list / Undo note) |

#### electron/main/officialFirmware.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 37 | `readCapped` | .catch | `() => undefined` | **NOT-WORTH** | cleanup before the "too large" throw on the next line |
| 37 | `readCapped` | void | `reader.cancel().catch(() => undefined)` | **NOT-WORTH** | cleanup before the "too large" throw on the next line |
| 53 | `fetchOfficialFirmware` | fetch | `fetch` | **PASSES-ON** | awaited: the caller of fetchOfficialFirmware handles it _(flow)_ |
| 55 | `fetchOfficialFirmware` | json-parse | `await readCapped(response, OFFICIAL_FIRM` | **PASSES-ON** | throws to the caller: the caller of fetchOfficialFirmware handles it _(flow)_ |
| 86 | `lookup` | .catch | `(): OfficialFirmwareLookup => (this.cached ? { latest: this.` | **SHOWN** | desktop.ctrlInfo.officialUnavailable after Refresh (was SILENT-BUG: the card showed nothing); an automatic check keeps the last good answer quietly |

#### electron/main/persistedFile.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 19 | `read` | catch | `rethrow: readFileSync` | **PASSES-ON** | no file yet is the first start (null: the defaults, nothing said); any other read error goes to readPersisted, which shows it |

#### electron/main/portableTemp.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 32 | `findLeftovers` | catch | `fallback: readdirSync` | **NOT-WORTH** | Temp unreadable: nothing to tidy this start |
| 74 | `pruneUnpackLeftovers` | catch | `log-only` | **LOGGED-OK** | a file in that folder is still in use (a launcher waiting on it); the next start tries again |

#### electron/main/updateFeed.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 55 | `get` | fetch | `fetch` | **PASSES-ON** | returned to get()'s caller (check(), firmwareFeed(), devChannelPreview() each have the verdict) |
| 80 | `devChannelPreview` | catch | `fallback` | **SHOWN** | desktop.channel.joinOffline (offline), desktop.channel.joinUnpublished, desktop.updateFeed.unsigned / .malformed (the problem says which) |

#### electron/main/updater.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 44 | `isLoopbackHttp` | catch | `fallback: new URL` | **NOT-WORTH** | not a URL: no test feed |
| 85 | `runInstaller` | spawn | `spawn(installer)` | **NOT-WORTH** | the verified installer of the update the user chose; if it can't start, the current version stays and the next check offers the update again |
| 152 | `pruneStaleFiles` | catch | `empty: readdirSync, rmSync` | **NOT-WORTH** | Best effort; nothing depends on it. |
| 184 | `check` | catch | `fallback` | **SHOWN** | desktop.setup.checkFailed or desktop.updateFeed.unsigned / .malformed (by problem, after Check for updates; a scheduled check that fails stays quiet: phase failed without "install") |
| 201 | `reach` | result-field | `reach.ok: boolean` | **PASSES-ON** | status/ok are read right below (404 = FeedMissingError, else FeedError "offline"; a bad .sig = "unsigned") |
| 203 | `reach` | fetch | `net.fetch` | **PASSES-ON** | thrown as FeedError "offline" to check()'s / the lookups' catch _(via catch L205)_ |
| 205 | `reach` | catch | `rethrow: net.fetch` | **PASSES-ON** | thrown as FeedError "offline" to check()'s / the lookups' catch |
| 219 | `fetchManifest` | json-parse | `text` | **PASSES-ON** | rethrows to the caller _(via catch L220)_ |
| 220 | `fetchManifest` | catch | `rethrow: JSON.parse` | **PASSES-ON** | rethrows to the caller _(rethrow)_ |
| 224 | `fetchManifest` | schema | `Manifest.safeParse` | **PASSES-ON** | a malformed manifest throws FeedError "malformed" to check()'s catch |
| 244 | `downloadAndInstall` | catch | `fallback` | **SHOWN** | desktop.update.appFailed (was SILENT-BUG: the banner just disappeared when Download and install failed) |
| 321 | `restart` | spawn | `execFileSync("systemd-run")` | **NOT-WORTH** | systemd-run unavailable _(via catch L323)_ |
| 323 | `restart` | catch | `empty: child_process` | **NOT-WORTH** | systemd-run unavailable |
| 328 | `restart` | spawn | `spawn("/bin/sh")` | **NOT-WORTH** | relaunching the just-verified new version; the app exits either way (a failed start leaves the user to open it again) |
| 337 | `restart` | spawn | `spawn(target)` | **NOT-WORTH** | relaunching the just-verified new version; the app exits either way (a failed start leaves the user to open it again) |

#### electron/main/urls.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 10 | `isAllowedHttpsUrl` | catch | `fallback: new URL` | **NOT-WORTH** | not a URL: not allowed, the link stays blocked |

#### electron/main/windowsSetup.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 38 | `repairWindowsUsb` | result-field | `repairWindowsUsb.ok: boolean` | **SHOWN** | desktop.windowsUsb.result.* (keyed text, the page's shownText) under the Windows USB repair |
| 45 | `repairWindowsUsb > <anonymous>` | spawn | `execFile(powershell)` | **SHOWN** | desktop.windowsUsb.done / desktop.windowsUsb.result.cancelled / .failed under the Windows USB repair |

#### src/components/LanguageToggle.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 76 | `LanguageToggle > onClick=` | .catch | `logged("switching the language (resources are bundled, so no` | **LOGGED-OK** | switching the language (resources are bundled, so nothing to load can fail) _(logged())_ |
| 76 | `LanguageToggle > onClick=` | void | `i18n.changeLanguage(lang.code).catch(logged("switching the l` | **LOGGED-OK** | switching the language (resources are bundled, so nothing to load can fail) _(via .catch L76)_ |
| 79 | `LanguageToggle > onClick=` | catch | `empty` | **NOT-WORTH** | storage unavailable: the choice lasts for this session |

#### src/components/ThemeToggle.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 26 | `readStoredTheme` | catch | `empty` | **NOT-WORTH** | storage blocked: fall back to the default |
| 71 | `setStoredTheme` | catch | `empty` | **NOT-WORTH** | storage unavailable: the choice lasts for this session |
| 107 | `useApplyTheme > useEffect(cb)` | ipc-call | `getDesktopPalette` | **LOGGED-OK** | reading the desktop's accent for the Desktop theme (the app's own colors stay) _(via .catch L109)_ |
| 109 | `useApplyTheme > useEffect(cb)` | .catch | `logged("reading the desktop's accent for the Desktop theme (` | **LOGGED-OK** | reading the desktop's accent for the Desktop theme (the app's own colors stay) _(logged())_ |

#### src/desktop/api.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 61 | `<module>` | result-field | `DevChannelAnswer.problem: FeedProblem \| "unpublished"` | **SHOWN** | desktop.channel.joinOffline / .joinUnpublished, desktop.updateFeed.unsigned / .malformed (DevChannelDialog) |
| 127 | `<module>` | result-field | `UpdateState.problem: FeedProblem` | **SHOWN** | desktop.setup.checkFailed, or desktop.updateFeed.unsigned / .malformed by problem (CheckNow, SetupScreen) |
| 142 | `<module>` | result-field | `FirmwareDownload.ok: false` | **SHOWN** | desktop.firmware.feedChanged (or desktop.firmware.hashMismatch; firmwareUpdate.ts throws it to the firmware banner) |
| 142 | `<module>` | result-field | `FirmwareDownload.reason: "changed" \| "mismatch"` | **SHOWN** | desktop.firmware.feedChanged (or desktop.firmware.hashMismatch; firmwareUpdate.ts throws it to the firmware banner) |
| 150 | `<module>` | result-field | `FirmwareLookup.problem: "unpublished" \| FeedProblem \| "disabled"` | **SHOWN** | desktop.firmware.offline / .unsigned / .malformed (or desktop.firmware.unpublished; "disabled" is a choice, not an error) |
| 159 | `<module>` | result-field | `OfficialFirmwareLookup.problem: "disabled" \| "unavailable" \| null` | **SHOWN** | desktop.ctrlInfo.officialUnavailable after Refresh ("disabled" is a choice, not an error) |
| 173 | `<module>` | result-field | `ProtonInstallResult.ok: false` | **SHOWN** | desktop.errors.main.protonNotPublished and the other keyed errors (shownText) on the Proton card; a feed problem shows desktop.updateFeed.offline / .unsigned / .malformed |
| 173 | `<module>` | result-field | `ProtonInstallResult.problem: FeedProblem` | **SHOWN** | desktop.errors.main.protonNotPublished and the other keyed errors (shownText) on the Proton card; a feed problem shows desktop.updateFeed.offline / .unsigned / .malformed |
| 182 | `<module>` | result-field | `UndoResult.ok: false` | **SHOWN** | desktop.games.restartGameRunning (useRestartText: restartTimeout / restartFailed / launcherStarted) |
| 182 | `<module>` | result-field | `UndoResult.blockedBy: LauncherId[]` | **SHOWN** | desktop.games.restartGameRunning (useRestartText: restartTimeout / restartFailed / launcherStarted) |
| 182 | `<module>` | result-field | `UndoResult.problem: CloseProblem` | **SHOWN** | desktop.games.restartGameRunning (useRestartText: restartTimeout / restartFailed / launcherStarted) |
| 184 | `<module>` | result-field | `UndoResult.ok: false` | **SHOWN** | desktop.games.undoConflict |
| 186 | `<module>` | result-field | `UndoResult.ok: false` | **SHOWN** | desktop.games.undoNoController |
| 188 | `<module>` | result-field | `UndoResult.ok: false` | **SHOWN** | desktop.errors.main.alreadyUndone and the other keyed errors (shownText) in the Games page's error notice |
| 188 | `<module>` | result-field | `UndoResult.error: string` | **SHOWN** | desktop.errors.main.alreadyUndone and the other keyed errors (shownText) in the Games page's error notice |
| 214 | `<module>` | result-field | `DesktopApi.ok: boolean` | **SHOWN** | desktop.usbAccess.result.* (keyed text, shownText) under Set up USB access |
| 218 | `<module>` | result-field | `DesktopApi.ok: boolean` | **SHOWN** | desktop.windowsUsb.result.* (keyed text, shownText) under the Windows USB repair |

#### src/desktop/AutoUpdateAsk.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 25 | `AutoUpdateAsk > useEffect(cb)` | ipc-call | `getSettings` | **LOGGED-OK** | reading whether automatic updates were asked about (unread: not asked now) _(via .catch L27)_ |
| 27 | `AutoUpdateAsk > useEffect(cb)` | .catch | `logged("reading whether automatic updates were asked about (` | **LOGGED-OK** | reading whether automatic updates were asked about (unread: not asked now) _(logged())_ |
| 48 | `answer` | ipc-call | `setSetting` | **SHOWN** | desktop.errors.settingNotSaved _(via .catch L50)_ |
| 49 | `answer > then(cb)` | ipc-call | `setSetting` | **PASSES-ON** | returned: the caller of then(cb) handles it _(flow)_ |
| 50 | `answer` | .catch | `shown("desktop.errors.settingNotSaved")` | **SHOWN** | desktop.errors.settingNotSaved _(shown())_ |

#### src/desktop/controllerAudio.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 33 | `controllerAudio` | catch | `fallback` | **NOT-WORTH** | no device list (no permission): null is "the controller's audio isn't there", which each test shows |
| 41 | `closeQuietly` | .catch | `logged("closing a test's audio context (it's done either way` | **LOGGED-OK** | closing a test's audio context (it's done either way) _(logged())_ |

#### src/desktop/controls.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 253 | `flip` | void | `pending // error: SHOWN — desktop.errors.actionFailed (was S` | **SHOWN** | desktop.errors.actionFailed (was SWALLOWED: the safety net for a caller that doesn't report its own error) _(via .catch L255)_ |
| 255 | `flip` | .catch | `(cause: unknown) => shown("desktop.errors.actionFailed", { r` | **SHOWN** | desktop.errors.actionFailed (was SWALLOWED: the safety net for a caller that doesn't report its own error) |
| 369 | `run` | catch | `fallback` | **SHOWN** | desktop.errors.actionFailed (was SWALLOWED: the safety net for a caller that doesn't report its own error; callers that do catch it first) |
| 384 | `BusyButton > onClick=` | .catch | `logged("BusyButton.run (it shows its own errors)")` | **LOGGED-OK** | BusyButton.run (it shows its own errors) _(logged())_ |
| 384 | `BusyButton > onClick=` | void | `run().catch(logged("BusyButton.run (it shows its own errors)` | **LOGGED-OK** | BusyButton.run (it shows its own errors) _(via .catch L384)_ |

#### src/desktop/DesktopApp.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 122 | `DesktopApp > useEffect(cb)` | json-parse | `settledSig` | **PASSES-ON** | throws to the caller: the caller of useEffect(cb) handles it _(flow)_ |
| 140 | `DesktopApp > useEffect(cb) > setTimeout(cb)` | .catch | `logged("applying the draft live (applyConfig shows its own e` | **LOGGED-OK** | applying the draft live (applyConfig shows its own error and resolves false) _(logged())_ |
| 273 | `DesktopApp > useEffect(cb)` | void | `client .readNarrator() .then((have) => (!cancelled && have !` | **LOGGED-OK** | syncing the board's narrator setting (busy or gone: tried again on the next change or reconnect) _(via .catch L276)_ |
| 276 | `DesktopApp > useEffect(cb)` | .catch | `logged("syncing the board's narrator setting (busy or gone: ` | **LOGGED-OK** | syncing the board's narrator setting (busy or gone: tried again on the next change or reconnect) _(logged())_ |
| 292 | `DesktopApp > useEffect(cb)` | void | `renderTrayIcon({ dot: !connected ? "none" : controllerOn ? "` | **LOGGED-OK** | drawing the tray icon (the tray keeps its last icon) _(via .catch L294)_ |
| 294 | `DesktopApp > useEffect(cb)` | .catch | `logged("drawing the tray icon (the tray keeps its last icon)` | **LOGGED-OK** | drawing the tray icon (the tray keeps its last icon) _(logged())_ |
| 323 | `DesktopApp > useEffect(cb) > onTrayCommand(cb)` | .catch | `(cause: unknown) => shown("desktop.errors.slotSwitch", { slo` | **SHOWN** | desktop.errors.slotSwitch (was SILENT-BUG: the tray's slot switch failed with nothing shown) |
| 565 | `read` | .catch | `logged("reading whether the taskbar is dark (for the tray ic` | **LOGGED-OK** | reading whether the taskbar is dark (for the tray icon; the system setting answers instead) _(logged())_ |
| 565 | `read` | ipc-call | `getDesktopPalette` | **LOGGED-OK** | reading whether the taskbar is dark (for the tray icon; the system setting answers instead) _(via .catch L565)_ |
| 593 | `useWhatsNew > useState(cb)` | catch | `fallback` | **NOT-WORTH** | storage unavailable: no "What's new" banner this time |
| 602 | `dismiss` | catch | `empty` | **NOT-WORTH** | storage unavailable: the banner just reappears next launch |
| 632 | `useGamesAttention > useEffect(cb)` | ipc-call | `getSettings` | **LOGGED-OK** | reading the Games consent for the rail's count (the count stays hidden) _(via .catch L639)_ |
| 637 | `useGamesAttention > useEffect(cb) > then(cb)` | .then-reject | `logged("the background scan for the rail's attention count (` | **LOGGED-OK** | the background scan for the rail's attention count (the Games page scans again and shows its errors) _(logged())_ |
| 637 | `useGamesAttention > useEffect(cb) > then(cb)` | ipc-call | `gamesScan` | **LOGGED-OK** | the background scan for the rail's attention count (the Games page scans again and shows its errors) _(via .then-reject L637)_ |
| 639 | `useGamesAttention > useEffect(cb)` | .catch | `logged("reading the Games consent for the rail's count (the ` | **LOGGED-OK** | reading the Games consent for the rail's count (the count stays hidden) _(logged())_ |
| 658 | `useGamesAttention > useCallback(cb)` | .catch | `shown("desktop.errors.settingNotSaved")` | **SHOWN** | desktop.errors.settingNotSaved _(shown())_ |
| 658 | `useGamesAttention > useCallback(cb)` | void | `setGamesAllowed(value).catch(shown("desktop.errors.settingNo` | **SHOWN** | desktop.errors.settingNotSaved _(via .catch L658)_ |

#### src/desktop/dev/FakeGames.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 27 | `FakeGames > useEffect(cb)` | .then-reject | `logged("reading the Fake games state for the Developer card ` | **LOGGED-OK** | reading the Fake games state for the Developer card (the switch shows off) _(logged())_ |
| 35 | `change` | .then-reject | `(cause: unknown) => shown("desktop.errors.actionFailed", { r` | **SHOWN** | desktop.errors.actionFailed (the Developer card has no status line) |
| 47 | `FakeGames > onChange=` | .then-reject | `(cause: unknown) => shown("desktop.errors.actionFailed", { r` | **SHOWN** | desktop.errors.actionFailed (the Developer card has no status line) |

#### src/desktop/dev/HdrTest.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 43 | `GpuSwatch > useEffect(cb) > <anonymous>` | catch | `fallback` | **SHOWN** | english: the dev HDR test's swatch reads "no" (Developer card only, not translated) |
| 47 | `GpuSwatch > useEffect(cb)` | .catch | `logged("the dev HDR test's WebGPU swatch")` | **LOGGED-OK** | the dev HDR test's WebGPU swatch _(logged())_ |

#### src/desktop/dongle/core1Status.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 20 | `<module>` | result-field | `BoardProblem.reason: string` | **SHOWN** | desktop.diag.core1StoppedAt / .speakerEncoderFailed / .micDecoderFailed: a notice on the Pico page and the rail's dot on it |

#### src/desktop/dongle/DongleConsole.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 141 | `<module>` | result-field | `OledFrameState.error: boolean` | **SHOWN** | desktop.dongleConsole.unavailable (the last good frame stays, retried) |
| 176 | `tick` | catch | `fallback` | **SHOWN** | desktop.dongleConsole.unavailable (retried) |
| 185 | `next` | .catch | `logged("the OLED mirror poll (it catches its own errors)")` | **LOGGED-OK** | the OLED mirror poll (it catches its own errors) _(logged())_ |
| 185 | `next` | void | `tick().catch(logged("the OLED mirror poll (it catches its ow` | **LOGGED-OK** | the OLED mirror poll (it catches its own errors) _(via .catch L185)_ |
| 301 | `up` | .catch | `(cause: unknown) => setError(causeText(cause))` | **SHOWN** | desktop.errors.board.noOledKeys and the other keyed board errors (causeText): the key's tooltip and its red outline until the next press |

#### src/desktop/dongle/DongleDashboard.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 57 | `<module>` | result-field | `Telemetry.error: string \| null` | **SHOWN** | desktop.errors.board.timeout and the other keyed board errors (causeText): at the Diagnostics heading (DonglePage, MainBlock actions) |
| 252 | `reset` | catch | `fallback` | **SHOWN** | desktop.errors.board.timeout and the other keyed board errors (causeText): the error next to Reset |

#### src/desktop/dongle/HoldButton.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 23 | `HoldButton > onPointerDown=` | catch | `empty` | **NOT-WORTH** | a pointer that is already gone: its pointercancel / blur ends the press |

#### src/desktop/dongle/OledPad.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 127 | `up` | .catch | `(cause: unknown) => setError(causeText(cause))` | **SHOWN** | desktop.errors.board.noOledPad and the other keyed board errors (causeText): the pad's tooltip and red outline until the next press |

#### src/desktop/dongle/OledShare.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 56 | `share` | catch | `fallback` | **SHOWN** | desktop.oledShare.errors.encode / .tooBig (the bar's status line) |
| 64 | `share` | ipc-call | `copyOledImage` | **SHOWN** | desktop.oledShare.errors.copy / .save (the bar's status line; causeText says a refused request plainly) _(via catch L70)_ |
| 67 | `share` | ipc-call | `saveOledImage` | **SHOWN** | desktop.oledShare.errors.copy / .save (the bar's status line; causeText says a refused request plainly) _(via catch L70)_ |
| 70 | `share` | catch | `fallback: ipc:copyOledImage, ipc:saveOledImage` | **SHOWN** | desktop.oledShare.errors.copy / .save (the bar's status line; causeText says a refused request plainly) |
| 79 | `run` | .catch | `(cause: unknown) => report("errors.encode", cause)` | **NOT-WORTH** | share() catches and shows its own failures; this only starts it |
| 79 | `run` | void | `share(what, req).catch((cause: unknown) => report("errors.en` | **NOT-WORTH** | share() catches and shows its own failures; this only starts it |

#### src/desktop/firmwareUpdate.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 41 | `shownFirmware` | ipc-call | `downloadFirmware` | **PASSES-ON** | awaited: the caller of shownFirmware handles it _(flow)_ |
| 84 | `firmwareRegions` | catch | `rethrow` | **SHOWN** | desktop.firmware.wrongFile: rethrown in plain words (the parser's reason kept as its cause); the firmware banner and the setup screen show it |
| 132 | `flash` | catch | `rethrow` | **SHOWN** | desktop.firmware.writeFailed / restartFailed (the image is complete, only the restart failed): rethrown in plain words (the USB error kept as its cause); the firmware card and the setup screen show it |

#### src/desktop/frameTick.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 35 | `run` | catch | `fallback` | **LOGGED-OK** | a bug in one drawer or readout: logged, and the clock keeps the others running |

#### src/desktop/games/consent.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 12 | `setGamesAllowed` | ipc-call | `setSetting` | **PASSES-ON** | returned below; each caller shows desktop.errors.settingNotSaved |

#### src/desktop/games/hdrSetup.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 116 | `<module>` | result-field | `HdrReq.ok: boolean` | **SHOWN** | desktop.hdrCheck.screen.failed (each ✗ line is its desktop.hdrCheck.<key> text) |

#### src/desktop/games/launcherCheck.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 22 | `useFreshRunning > useEffect(cb)` | .then-reject | `() => live && setRunning({ key, list: null })` | **NOT-WORTH** | unknown (null): Apply's own check in the main process still names a running launcher (desktop.games.launcherStarted) |
| 22 | `useFreshRunning > useEffect(cb)` | ipc-call | `gamesRunningLaunchers` | **NOT-WORTH** | unknown (null): Apply's own check in the main process still names a running launcher (desktop.games.launcherStarted) |
| 49 | `startedSinceCheck` | result-field | `startedSinceCheck.blockedBy: LauncherId[]` | **SHOWN** | desktop.games.launcherStarted (an input here; the text comes from useRestartText) |
| 49 | `startedSinceCheck` | result-field | `startedSinceCheck.problem: CloseProblem` | **SHOWN** | desktop.games.launcherStarted (an input here; the text comes from useRestartText) |

#### src/desktop/games/types.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 197 | `<module>` | result-field | `ApplyResult.applied.ok: boolean` | **SHOWN** | desktop.library.setupFailed (and each change's message in the Done list) |
| 202 | `<module>` | result-field | `ApplyResult.blockedBy: LauncherId[]` | **SHOWN** | desktop.games.launcherStarted (useRestartText names the launcher) |
| 204 | `<module>` | result-field | `ApplyResult.problem: CloseProblem` | **SHOWN** | desktop.games.restartGameRunning (or restartTimeout / restartFailed) |

#### src/desktop/glass/useLiquidGlass.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 20 | `useLiquidGlass > useEffect(cb)` | json-parse | `c` | **PASSES-ON** | throws to the caller: the caller of useEffect(cb) handles it _(flow)_ |
| 21 | `useLiquidGlass > useEffect(cb)` | json-parse | `r` | **PASSES-ON** | throws to the caller: the caller of useEffect(cb) handles it _(flow)_ |

#### src/desktop/library/gameArt.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 38 | `useArtColor > useEffect(cb)` | void | `window .desktop!.gameArtColor(key) .then((color) => live && ` | **LOGGED-OK** | the game art's color for the page accent and tile (the theme accent stays) _(via .catch L41)_ |
| 39 | `useArtColor > useEffect(cb)` | ipc-call | `gameArtColor` | **LOGGED-OK** | the game art's color for the page accent and tile (the theme accent stays) _(via .catch L41)_ |
| 41 | `useArtColor > useEffect(cb)` | .catch | `logged("the game art's color for the page accent and tile (t` | **LOGGED-OK** | the game art's color for the page accent and tile (the theme accent stays) _(logged())_ |

#### src/desktop/library/GameLibrary.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 125 | `GameLibrary > useEffect(cb)` | .then-reject | `logged("reading play time and art details (the tiles show wi` | **LOGGED-OK** | reading play time and art details (the tiles show without them) _(logged())_ |
| 125 | `GameLibrary > useEffect(cb)` | ipc-call | `gamesDetails` | **LOGGED-OK** | reading play time and art details (the tiles show without them) _(via .then-reject L125)_ |
| 125 | `GameLibrary > useEffect(cb)` | void | `desktop.gamesDetails().then(setDetails, logged("reading play` | **LOGGED-OK** | reading play time and art details (the tiles show without them) _(via .then-reject L125)_ |

#### src/desktop/library/GamePage.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 255 | `ProfileBody > useDebouncedSave(cb)` | ipc-call | `librarySetProfile` | **PASSES-ON** | useDebouncedSave shows a failed save (desktop.errors.librarySave) |
| 260 | `create` | .catch | `shown("desktop.errors.profileCreate")` | **SHOWN** | desktop.errors.profileCreate _(shown())_ |
| 260 | `create` | ipc-call | `librarySetProfile` | **SHOWN** | desktop.errors.profileCreate _(via .catch L260)_ |
| 264 | `remove` | .catch | `shown("desktop.errors.profileDelete")` | **SHOWN** | desktop.errors.profileDelete _(shown())_ |
| 264 | `remove` | ipc-call | `libraryDeleteProfile` | **SHOWN** | desktop.errors.profileDelete _(via .catch L264)_ |
| 504 | `apply > thenRescan(cb)` | ipc-call | `gamesApply` | **PASSES-ON** | returned: the caller of thenRescan(cb) handles it _(flow)_ |
| 509 | `apply` | catch | `fallback` | **SHOWN** | desktop.errors.badRequest, or the main process's keyed error (causeText), as the note under Set up |
| 671 | `switchRunner > thenRescan(cb)` | ipc-call | `gamesApply` | **PASSES-ON** | returned: the caller of thenRescan(cb) handles it _(flow)_ |
| 679 | `switchRunner` | catch | `fallback` | **SHOWN** | desktop.errors.badRequest, or the main process's keyed error (causeText), as the note under the Proton version picker |
| 689 | `undo > thenRescan(cb)` | ipc-call | `gamesUndo` | **PASSES-ON** | returned: the caller of thenRescan(cb) handles it _(flow)_ |
| 701 | `undo` | catch | `fallback` | **SHOWN** | desktop.errors.badRequest, or the main process's keyed error (causeText), as the note under the Proton version picker |
| 846 | `useMine > useDebouncedSave(cb)` | ipc-call | `librarySetMine` | **PASSES-ON** | returned: the caller of useDebouncedSave(cb) handles it _(flow)_ |

#### src/desktop/library/playBar.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 41 | `useGameAction` | result-field | `useGameAction.failed: GameAction \| null` | **SHOWN** | desktop.library.action.failed (ActionFailed, until dismissed or the next action) |
| 46 | `run` | ipc-call | `gameAction` | **SHOWN** | desktop.library.action.failed _(via catch L47)_ |
| 47 | `run` | catch | `fallback: ipc:gameAction` | **SHOWN** | desktop.library.action.failed |

#### src/desktop/library/profileDongle.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 90 | `applyGameProfile` | catch | `rethrow` | **PASSES-ON** | rethrows to the caller _(rethrow)_ |
| 94 | `applyGameProfile` | .catch | `() => false` | **SHOWN** | desktop.profile.partlyOn (false: the profile may still be on, which the thrown error says) |
| 96 | `applyGameProfile` | .catch | `() => undefined` | **NOT-WORTH** | taking off whatever went on of the parts (RAM only) while the real error is thrown below |

#### src/desktop/library/useDebouncedSave.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 40 | `useDebouncedSave > useEffect(cb) > <anonymous>` | .catch | `shown("desktop.errors.librarySave")` | **SHOWN** | desktop.errors.librarySave _(shown())_ |
| 55 | `useDebouncedSave > useCallback(cb) > setTimeout(cb)` | .catch | `shown("desktop.errors.librarySave")` | **SHOWN** | desktop.errors.librarySave _(shown())_ |

#### src/desktop/library/useGameProfile.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 31 | `decideProfileStep` | result-field | `decideProfileStep.failed: string \| null` | **NOT-WORTH** | \'failed\' is an input (the step that failed, so it isn't retried in a loop); the failure itself is shown where it happens |
| 83 | `<module>` | result-field | `GameProfileState.error: string \| null` | **SHOWN** | desktop.profile.applyFailed (DesktopApp's ErrorNotice; also partlyOn / restoreFailed / saveFailed / notOn) |
| 132 | `useGameProfile > useCallback(cb)` | .catch | `() => undefined` | **NOT-WORTH** | the wait's own copy; \'run\' is awaited below with its error |
| 151 | `useGameProfile > useEffect(cb)` | ipc-call | `libraryGet` | **SHOWN** | desktop.errors.libraryRead _(via .catch L158)_ |
| 158 | `useGameProfile > useEffect(cb)` | .catch | `shown("desktop.errors.libraryRead")` | **SHOWN** | desktop.errors.libraryRead _(shown())_ |
| 160 | `useGameProfile > useEffect(cb)` | .then-reject | `() => setRunningKnown(true)` | **NOT-WORTH** | unknown reads as "no game running"; onRunningGame corrects it within one watcher pass (2-3 s) |
| 160 | `useGameProfile > useEffect(cb)` | ipc-call | `gamesRunning` | **NOT-WORTH** | unknown reads as "no game running"; onRunningGame corrects it within one watcher pass (2-3 s) |
| 160 | `useGameProfile > useEffect(cb)` | void | `desktop.gamesRunning().then( (key) => { setRunning(key); set` | **NOT-WORTH** | unknown reads as "no game running"; onRunningGame corrects it within one watcher pass (2-3 s) |
| 203 | `useGameProfile > useEffect(cb) > switchOnce(cb)` | ipc-call | `librarySetRestore` | **SHOWN** | desktop.profile.applyFailed (or partlyOn) _(via catch L211)_ |
| 204 | `useGameProfile > useEffect(cb) > switchOnce(cb)` | ipc-call | `librarySetRestore` | **SHOWN** | desktop.profile.applyFailed (or partlyOn) _(via catch L211)_ |
| 211 | `useGameProfile > useEffect(cb) > switchOnce(cb)` | catch | `fallback: ipc:librarySetRestore` | **SHOWN** | desktop.profile.applyFailed (or partlyOn) |
| 232 | `useGameProfile > useEffect(cb)` | .catch | `logged("switchOnce's apply task (it shows its own errors)")` | **LOGGED-OK** | switchOnce's apply task (it shows its own errors) _(logged())_ |
| 241 | `useGameProfile > useEffect(cb) > switchOnce(cb)` | ipc-call | `librarySetRestore` | **SHOWN** | desktop.profile.restoreFailed (was SILENT-BUG: only logged; the game's settings stayed on with no word) _(via catch L245)_ |
| 245 | `useGameProfile > useEffect(cb) > switchOnce(cb)` | catch | `fallback: ipc:librarySetRestore` | **SHOWN** | desktop.profile.restoreFailed (was SILENT-BUG: only logged; the game's settings stayed on with no word) |
| 251 | `useGameProfile > useEffect(cb)` | .catch | `logged("switchOnce's restore task (it shows its own errors)"` | **LOGGED-OK** | switchOnce's restore task (it shows its own errors) _(logged())_ |
| 256 | `useGameProfile > useEffect(cb)` | .catch | `logged("taking a game's layout off with no game running (bus` | **LOGGED-OK** | taking a game's layout off with no game running (busy or gone: tried again on the next change or reconnect) _(logged())_ |
| 313 | `useGameProfile > useCallback(cb)` | ipc-call | `librarySetProfile` | **SHOWN** | desktop.profile.saveFailed _(via catch L328)_ |
| 315 | `useGameProfile > useCallback(cb)` | ipc-call | `librarySetLayout` | **SHOWN** | desktop.profile.saveFailed _(via catch L328)_ |
| 328 | `useGameProfile > useCallback(cb)` | catch | `fallback: ipc:librarySetProfile, ipc:librarySetLayout` | **SHOWN** | desktop.profile.saveFailed |

#### src/desktop/live/ArtBackdrop.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 74 | `load` | void | `desktop .gamesDetails() .then((d) => { if (!live) return; co` | **LOGGED-OK** | game art for the backdrop (the colors-only backdrop stays) _(via .catch L87)_ |
| 75 | `load` | ipc-call | `gamesDetails` | **LOGGED-OK** | game art for the backdrop (the colors-only backdrop stays) _(via .catch L87)_ |
| 87 | `load` | .catch | `logged("game art for the backdrop (the colors-only backdrop ` | **LOGGED-OK** | game art for the backdrop (the colors-only backdrop stays) _(logged())_ |
| 89 | `useBackdropKeys > useEffect(cb)` | .then-reject | `logged("the running game for the backdrop (onRunningGame upd` | **LOGGED-OK** | the running game for the backdrop (onRunningGame updates it) _(logged())_ |
| 89 | `useBackdropKeys > useEffect(cb)` | ipc-call | `gamesRunning` | **LOGGED-OK** | the running game for the backdrop (onRunningGame updates it) _(via .then-reject L89)_ |
| 89 | `useBackdropKeys > useEffect(cb)` | void | `desktop.gamesRunning().then(setRunning, logged("the running ` | **LOGGED-OK** | the running game for the backdrop (onRunningGame updates it) _(via .then-reject L89)_ |

#### src/desktop/live/Calibration.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 130 | `save` | catch | `fallback` | **SHOWN** | desktop.errors.boardFailed (causeText: board results in plain words, and the other keyed board errors) |

#### src/desktop/live/controllerAccent.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 342 | `useControllerAccent > useEffect(cb)` | .catch | `failed` | **SHOWN** | desktop.accent.unreadable (a failed read counts as no accent, and the Accent color row says so) |
| 342 | `useControllerAccent > useEffect(cb)` | ipc-call | `getDesktopPalette` | **SHOWN** | desktop.accent.unreadable (a failed read counts as no accent, and the Accent color row says so) |

#### src/desktop/live/ControllerInfo.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 100 | `useControllerInfo > useEffect(cb) > then(cb)` | ipc-call | `officialControllerFirmware` | **SHOWN** | desktop.ctrlInfo.officialUnavailable (after Refresh; was SILENT-BUG: nothing was said) _(via .catch L103)_ |
| 103 | `useControllerInfo > useEffect(cb) > then(cb)` | .catch | `() => live && setOfficial({ latest: null, problem: "unavaila` | **SHOWN** | desktop.ctrlInfo.officialUnavailable (after Refresh; was SILENT-BUG: nothing was said) |
| 109 | `useControllerInfo > useEffect(cb)` | .catch | `(cause) => live && setError(causeText(cause))` | **SHOWN** | desktop.errors.board.controllerTimeout and the other keyed board errors (causeText): the read error in the card, with Refresh |

#### src/desktop/live/ControllerView.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 177 | `ControllerView > useEffect(cb)` | ipc-call | `getSettings` | **LOGGED-OK** | reading the HDR lighting setting (the normal glow stays) _(via .catch L179)_ |
| 179 | `ControllerView > useEffect(cb)` | .catch | `logged("reading the HDR lighting setting (the normal glow st` | **LOGGED-OK** | reading the HDR lighting setting (the normal glow stays) _(logged())_ |

#### src/desktop/live/HdrGlow.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 68 | `shapeAlpha` | catch | `fallback` | **NOT-WORTH** | a part's mask that won't decode: that part gets no HDR glow (the normal glow shows) |
| 217 | `HdrGlow > useEffect(cb) > <anonymous> > <anonymous> > setTimeout(cb)` | .catch | `logged("rebuilding the HDR glow mask after a resize")` | **LOGGED-OK** | rebuilding the HDR glow mask after a resize _(logged())_ |
| 217 | `HdrGlow > useEffect(cb) > <anonymous> > <anonymous> > setTimeout(cb)` | void | `rebuild().catch(logged("rebuilding the HDR glow mask after a` | **LOGGED-OK** | rebuilding the HDR glow mask after a resize _(via .catch L217)_ |
| 260 | `HdrGlow > useEffect(cb) > <anonymous> > <anonymous>` | .catch | `logged("rebuilding the HDR glow mask after an LED change")` | **LOGGED-OK** | rebuilding the HDR glow mask after an LED change _(logged())_ |
| 265 | `HdrGlow > useEffect(cb)` | .catch | `logged("starting the HDR glow (WebGPU): the normal glow stay` | **LOGGED-OK** | starting the HDR glow (WebGPU): the normal glow stays _(logged())_ |

#### src/desktop/live/micTest.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 51 | `<module>` | result-field | `ListenResult.ok: boolean` | **SHOWN** | desktop.audioTest.problem.failed (\'problem\' picks the desktop.audioTest.problem.<problem> line) |
| 56 | `<module>` | result-field | `ListenResult.problem: MicProblem` | **SHOWN** | desktop.audioTest.problem.failed (each problem has its line) |
| 87 | `startMicTest` | result-field | `startMicTest.problem: MicProblem` | **SHOWN** | desktop.audioTest.problem.no-mic (a \'problem\' result is said on the Mic test's status line) |
| 97 | `startMicTest` | catch | `fallback` | **SHOWN** | desktop.audioTest.problem.no-speaker |
| 109 | `startMicTest` | catch | `fallback` | **SHOWN** | desktop.audioTest.problem.failed |
| 189 | `listenBack` | catch | `fallback` | **SHOWN** | desktop.audioTest.problem.no-speaker |
| 197 | `listenBack` | catch | `fallback` | **SHOWN** | desktop.audioTest.problem.playback (or failed when stopped) |
| 223 | `end` | catch | `empty` | **NOT-WORTH** | never started |
| 230 | `gone` | void | `controllerAudio("audiooutput") .then((now) => { if (now !== ` | **LOGGED-OK** | checking the controller's output after a device change (the watchdog still ends playback) _(via .catch L234)_ |
| 234 | `gone` | .catch | `logged("checking the controller's output after a device chan` | **LOGGED-OK** | checking the controller's output after a device change (the watchdog still ends playback) _(logged())_ |
| 247 | `playClip > <anonymous>` | catch | `fallback` | **SHOWN** | desktop.audioTest.problem.playback (rejects playClip) |

#### src/desktop/live/PartPanel.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 354 | `save` | void | `desktop .librarySetLayout({ id, name: layoutName, table: rem` | **SHOWN** | desktop.errors.layoutSave _(via .catch L357)_ |
| 355 | `save` | ipc-call | `librarySetLayout` | **SHOWN** | desktop.errors.layoutSave _(via .catch L357)_ |
| 357 | `save` | .catch | `shown("desktop.errors.layoutSave")` | **SHOWN** | desktop.errors.layoutSave _(shown())_ |
| 396 | `ButtonLayoutsSection > onClick=` | .catch | `shown("desktop.errors.layoutDelete")` | **SHOWN** | desktop.errors.layoutDelete _(shown())_ |
| 396 | `ButtonLayoutsSection > onClick=` | ipc-call | `libraryDeleteLayout` | **SHOWN** | desktop.errors.layoutDelete _(via .catch L396)_ |
| 396 | `ButtonLayoutsSection > onClick=` | void | `desktop.libraryDeleteLayout(id).then(setLibrary).catch(shown` | **SHOWN** | desktop.errors.layoutDelete _(via .catch L396)_ |
| 595 | `<module>` | result-field | `MicNote.problem: MicProblem` | **SHOWN** | desktop.audioTest.problem.failed (the status line says desktop.audioTest.problem.<problem>) |
| 625 | `MicTest > useEffect(cb) > <anonymous>` | .catch | `logged("closing the mic test on unmount")` | **LOGGED-OK** | closing the mic test on unmount _(logged())_ |
| 625 | `MicTest > useEffect(cb) > <anonymous>` | void | `stopAll().catch(logged("closing the mic test on unmount"))` | **LOGGED-OK** | closing the mic test on unmount _(via .catch L625)_ |
| 631 | `MicTest > useEffect(cb)` | .catch | `logged("closing the mic test when the window hides")` | **LOGGED-OK** | closing the mic test when the window hides _(logged())_ |
| 653 | `start > startMicTest(cb)` | .catch | `failed` | **SHOWN** | desktop.audioTest.problem.failed |
| 662 | `start` | .catch | `logged("closing a mic test that was replaced")` | **LOGGED-OK** | closing a mic test that was replaced _(logged())_ |
| 662 | `start` | void | `r.session.stop().catch(logged("closing a mic test that was r` | **LOGGED-OK** | closing a mic test that was replaced _(via .catch L662)_ |
| 751 | `MicTest > onClick=` | .catch | `failed` | **SHOWN** | desktop.audioTest.problem.failed (failed() ends on the status line) |
| 751 | `MicTest > onClick=` | void | `(running ? stopTest() : start()).catch(failed)` | **SHOWN** | desktop.audioTest.problem.failed (failed() ends on the status line) |
| 764 | `MicTest > onClick=` | .catch | `failed` | **SHOWN** | desktop.audioTest.problem.failed (failed() ends on the status line) |
| 764 | `MicTest > onClick=` | void | `listen().catch(failed)` | **SHOWN** | desktop.audioTest.problem.failed (failed() ends on the status line) |

#### src/desktop/live/slotSettings.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 53 | `useSlotSettings > useEffect(cb)` | .catch | `(cause) => live && setError(causeText(cause))` | **SHOWN** | desktop.errors.board.timeout and the other keyed board errors (causeText): SlotReadError with Retry |
| 70 | `SlotReadError` | result-field | `SlotReadError.error: string \| null` | **SHOWN** | desktop.errors.board.timeout and the other keyed board errors (causeText): the read error itself, with Retry |

#### src/desktop/live/speakerPlayer.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 72 | `gone` | void | `controllerSpeaker() .then((now) => { if (now !== sink) stopN` | **LOGGED-OK** | checking the controller's speaker after a device change _(via .catch L76)_ |
| 76 | `gone` | .catch | `logged("checking the controller's speaker after a device cha` | **LOGGED-OK** | checking the controller's speaker after a device change _(logged())_ |
| 105 | `playTune` | catch | `fallback` | **SHOWN** | desktop.audioTest.noSpeaker (noSpeaker: couldn't route to the controller) |

#### src/desktop/live/StickCurves.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 105 | `save` | catch | `fallback` | **SHOWN** | desktop.errors.boardFailed (causeText, with the other keyed board errors) |

#### src/desktop/live/SwirlField.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 239 | `SwirlField > useEffect(cb)` | ipc-call | `getSettings` | **LOGGED-OK** | reading hardware acceleration for the backdrop (the CPU drawing is used) _(via .catch L241)_ |
| 241 | `SwirlField > useEffect(cb)` | .catch | `logged("reading hardware acceleration for the backdrop (the ` | **LOGGED-OK** | reading hardware acceleration for the backdrop (the CPU drawing is used) _(logged())_ |

#### src/desktop/live/useRemap.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 19 | `<module>` | result-field | `Remap.error: string \| null` | **SHOWN** | desktop.errors.boardFailed, remap.verifyFailed and the other keyed board errors (causeText): the remap card's error notice |
| 54 | `useRemap > useEffect(cb)` | .then-reject | `() => live && setExtraDevice(null)` | **NOT-WORTH** | firmware without the Edge extras answers nothing: no extra rows |
| 63 | `useRemap > useEffect(cb)` | .then-reject | `(cause: unknown) => live && setError(causeText(cause))` | **SHOWN** | desktop.errors.board.timeout and the other keyed board errors (causeText): the remap card's error notice |
| 99 | `useRemap > useCallback(cb)` | catch | `fallback` | **SHOWN** | remap.verifyFailed (or the board's failure, via causeText) |
| 105 | `useRemap > useCallback(cb)` | .then-reject | `() => undefined` | **NOT-WORTH** | a re-read after the failure that is already shown; the old table stays |

#### src/desktop/narrator.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 46 | `<module>` | ipc-call | `getSettings` | **LOGGED-OK** | reading the narrator settings at start (the defaults stay: ask, captions on) _(via .catch L52)_ |
| 52 | `<module>` | .catch | `logged("reading the narrator settings at start (the defaults` | **LOGGED-OK** | reading the narrator settings at start (the defaults stay: ask, captions on) _(logged())_ |
| 57 | `setNarrator` | .catch | `shown("desktop.errors.settingNotSaved")` | **SHOWN** | desktop.errors.settingNotSaved _(shown())_ |
| 57 | `setNarrator` | ipc-call | `setSetting` | **SHOWN** | desktop.errors.settingNotSaved _(via .catch L57)_ |
| 63 | `setCaptions` | .catch | `shown("desktop.errors.settingNotSaved")` | **SHOWN** | desktop.errors.settingNotSaved _(shown())_ |
| 63 | `setCaptions` | ipc-call | `setSetting` | **SHOWN** | desktop.errors.settingNotSaved _(via .catch L63)_ |
| 160 | `play > <anonymous>` | .catch | `() => resolve()` | **NOT-WORTH** | a line that won't play (no device, autoplay) just ends; its caption still shows |
| 162 | `play` | catch | `empty` | **NOT-WORTH** | couldn't route to the controller: stay silent (the caption still shows) |
| 183 | `sayInPassing` | .catch | `logged("a narrator line that couldn't play (decoration: its ` | **LOGGED-OK** | a narrator line that couldn't play (decoration: its caption still shows) _(logged())_ |

#### src/desktop/Notice.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 18 | `<module>` | result-field | `Props.error: boolean` | **NOT-WORTH** | the notice's style, not a failure result) |

#### src/desktop/pages/AppSettingsPage.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 55 | `AppSettingsPage > useEffect(cb)` | .catch | `shown("desktop.errors.settingsRead")` | **SHOWN** | desktop.errors.settingsRead _(shown())_ |
| 55 | `AppSettingsPage > useEffect(cb)` | ipc-call | `getSettings` | **SHOWN** | desktop.errors.settingsRead _(via .catch L55)_ |
| 59 | `set` | .catch | `shown("desktop.errors.settingNotSaved")` | **SHOWN** | desktop.errors.settingNotSaved _(shown())_ |
| 59 | `set` | ipc-call | `setSetting` | **SHOWN** | desktop.errors.settingNotSaved _(via .catch L59)_ |
| 220 | `AppSettingsPage > <anonymous> > onClick=` | ipc-call | `backToStable` | **PASSES-ON** | awaited: the caller of onClick= handles it _(flow)_ |
| 221 | `AppSettingsPage > <anonymous> > onClick=` | ipc-call | `getSettings` | **PASSES-ON** | awaited: the caller of onClick= handles it _(flow)_ |
| 258 | `useGamesAllowed > useEffect(cb)` | ipc-call | `getSettings` | **LOGGED-OK** | reading the Games consent for App settings (the section stays hidden) _(via .catch L260)_ |
| 260 | `useGamesAllowed > useEffect(cb)` | .catch | `logged("reading the Games consent for App settings (the sect` | **LOGGED-OK** | reading the Games consent for App settings (the section stays hidden) _(logged())_ |
| 293 | `GameLaunchersSetting > onClick=` | .catch | `shown("desktop.errors.settingNotSaved")` | **SHOWN** | desktop.errors.settingNotSaved _(shown())_ |
| 310 | `GameLaunchersSetting > onChange=` | .catch | `shown("desktop.errors.settingNotSaved")` | **SHOWN** | desktop.errors.settingNotSaved _(shown())_ |
| 327 | `check` | .catch | `() => null` | **SHOWN** | desktop.setup.checkFailed, or desktop.updateFeed.unsigned / .malformed when the feed was refused (null: the line below says the check failed) |
| 327 | `check` | ipc-call | `checkForUpdates` | **SHOWN** | desktop.setup.checkFailed, or desktop.updateFeed.unsigned / .malformed when the feed was refused (null: the line below says the check failed) |
| 511 | `DevChannelDialog > useEffect(cb)` | .then-reject | `() => live && setPreview({ problem: "offline" })` | **SHOWN** | desktop.channel.joinOffline (or the answer's problem: joinUnpublished, desktop.updateFeed.unsigned / .malformed) |
| 511 | `DevChannelDialog > useEffect(cb)` | ipc-call | `devChannelPreview` | **SHOWN** | desktop.channel.joinOffline (or the answer's problem: joinUnpublished, desktop.updateFeed.unsigned / .malformed) |

#### src/desktop/pages/FirmwarePage.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 58 | `FirmwareSection > onClick=` | .catch | `logged("fw.start (it shows its own errors in the firmware ba` | **LOGGED-OK** | fw.start (it shows its own errors in the firmware banner) _(logged())_ |
| 77 | `FirmwareSection > onClick=` | .catch | `() => undefined` | **NOT-WORTH** | the app check only refreshes the app banner; this button reports the firmware (desktop.firmware.checkedOffline, or desktop.updateFeed.unsigned / .malformed) |
| 77 | `FirmwareSection > onClick=` | ipc-call | `checkForUpdates` | **NOT-WORTH** | the app check only refreshes the app banner; this button reports the firmware (desktop.firmware.checkedOffline, or desktop.updateFeed.unsigned / .malformed) |
| 122 | `act` | catch | `fallback` | **SHOWN** | desktop.errors.boardFailed (causeText, with the other keyed board errors) |

#### src/desktop/pages/GamesPage.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 112 | `useRestartText` | result-field | `useRestartText.blockedBy: LauncherId[]` | **SHOWN** | desktop.games.restartGameRunning (inputs here; this is where blockedBy / problem become text) |
| 112 | `useRestartText` | result-field | `useRestartText.problem: CloseProblem` | **SHOWN** | desktop.games.restartGameRunning (inputs here; this is where blockedBy / problem become text) |
| 211 | `useGamesSetup > useCallback(cb)` | ipc-call | `gamesBackups` | **PASSES-ON** | awaited: the caller of useCallback(cb) handles it _(flow)_ |
| 222 | `useGamesSetup > useCallback(cb)` | ipc-call | `gamesScan` | **SHOWN** | desktop.errors.main.gamesNotAllowed and the main process's other keyed errors (causeText), above Home's sections _(via catch L224)_ |
| 224 | `useGamesSetup > useCallback(cb)` | catch | `fallback: ipc:gamesScan` | **SHOWN** | desktop.errors.main.gamesNotAllowed and the main process's other keyed errors (causeText), above Home's sections |
| 237 | `useGamesSetup > useEffect(cb)` | .then-reject | `(cause: unknown) => live && setError({ text: causeText(cause` | **SHOWN** | desktop.errors.main.gamesNotAllowed and the main process's other keyed errors (causeText), above Home's sections; receive's own failure too |
| 237 | `useGamesSetup > useEffect(cb)` | ipc-call | `gamesScan` | **SHOWN** | desktop.errors.main.gamesNotAllowed and the main process's other keyed errors (causeText), above Home's sections; receive's own failure too |
| 239 | `useGamesSetup > useEffect(cb) > then(cb)` | .catch | `(cause: unknown) => setError({ text: causeText(cause), at: "` | **SHOWN** | desktop.errors.main.gamesNotAllowed (causeText): receive's failure (the backups list) above Home's sections |
| 239 | `useGamesSetup > useEffect(cb) > then(cb)` | void | `receive(r.value, false).catch((cause: unknown) => setError({` | **SHOWN** | desktop.errors.main.gamesNotAllowed (causeText): receive's failure (the backups list) above Home's sections |
| 249 | `useGamesSetup > useCallback(cb)` | .catch | `logged("rescan (it shows its own errors)")` | **LOGGED-OK** | rescan (it shows its own errors) _(logged())_ |
| 249 | `useGamesSetup > useCallback(cb)` | void | `rescan(true).catch(logged("rescan (it shows its own errors)"` | **LOGGED-OK** | rescan (it shows its own errors) _(via .catch L249)_ |
| 286 | `apply` | ipc-call | `gamesApply` | **SHOWN** | desktop.errors.badRequest (causeText: a refused request in plain words; the main process's keyed errors too), in Recommended changes. Was SILENT-BUG: the rescan right after cleared the message at once _(via catch L301)_ |
| 301 | `apply` | catch | `fallback: ipc:gamesApply` | **SHOWN** | desktop.errors.badRequest (causeText: a refused request in plain words; the main process's keyed errors too), in Recommended changes. Was SILENT-BUG: the rescan right after cleared the message at once |
| 315 | `undo` | ipc-call | `gamesUndo` | **SHOWN** | desktop.errors.badRequest (causeText; the main process's keyed errors too), in the section Undo was pressed in. Was SILENT-BUG: the rescan right after cleared the message at once _(via catch L340)_ |
| 340 | `undo` | catch | `fallback: ipc:gamesUndo` | **SHOWN** | desktop.errors.badRequest (causeText; the main process's keyed errors too), in the section Undo was pressed in. Was SILENT-BUG: the rescan right after cleared the message at once |
| 354 | `installProton` | ipc-call | `installProton` | **SHOWN** | desktop.errors.main.protonLinuxOnly and the main process's other keyed errors (causeText), as DualSense Proton's message _(via catch L363)_ |
| 363 | `installProton` | catch | `fallback: ipc:installProton` | **SHOWN** | desktop.errors.main.protonLinuxOnly and the main process's other keyed errors (causeText), as DualSense Proton's message |
| 568 | `HomeSections > <anonymous> > onClick=` | .catch | `logged("installProton (it shows its own errors)")` | **LOGGED-OK** | installProton (it shows its own errors) _(logged())_ |
| 568 | `HomeSections > <anonymous> > onClick=` | void | `setup.installProton().catch(logged("installProton (it shows ` | **LOGGED-OK** | installProton (it shows its own errors) _(via .catch L568)_ |

#### src/desktop/pages/SettingsPage.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 72 | `useGripTest > useCallback(cb)` | .catch | `() => undefined` | **NOT-WORTH** | stopping a test the user stopped; it ends by itself within 3 s |

#### src/desktop/pages/SlotsPage.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 31 | `salvage > salvageRecord(cb)` | schema | `RememberedSlot.safeParse` | **NOT-WORTH** | a slot entry that doesn't fit is left out and counted as lost (the notice says so) |
| 70 | `act` | catch | `fallback` | **SHOWN** | desktop.errors.boardFailed (a slot switch / forget / wipe whose save failed; firmware error pass) |

#### src/desktop/pages/TriggersPage.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 23 | `TriggersPage > useEffect(cb) > <anonymous>` | .catch | `() => undefined` | **NOT-WORTH** | leaving the page; a failed "off" leaves the test effect until a game sends its own |
| 23 | `TriggersPage > useEffect(cb) > <anonymous>` | void | `client.previewTrigger(0).catch(() => undefined)` | **NOT-WORTH** | leaving the page; a failed "off" leaves the test effect until a game sends its own |
| 34 | `pick` | catch | `fallback` | **SHOWN** | desktop.errors.boardFailed (causeText, with the other keyed board errors) |
| 59 | `TriggersPage > onClick=` | .catch | `logged("pick (it shows its own errors)")` | **LOGGED-OK** | pick (it shows its own errors) _(logged())_ |
| 59 | `TriggersPage > onClick=` | void | `pick(i).catch(logged("pick (it shows its own errors)"))` | **LOGGED-OK** | pick (it shows its own errors) _(via .catch L59)_ |

#### src/desktop/RecoveredNotice.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 27 | `RecoveredNotice > useEffect(cb)` | ipc-call | `recoveredFiles` | **LOGGED-OK** | asking which files were damaged at start (an app bug: the damaged copies are still kept and logged by the main process) _(via .catch L29)_ |
| 29 | `RecoveredNotice > useEffect(cb)` | .catch | `logged("asking which files were damaged at start (an app bug` | **LOGGED-OK** | asking which files were damaged at start (an app bug: the damaged copies are still kept and logged by the main process) _(logged())_ |

#### src/desktop/SetupScreen.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 50 | `SetupScreen > useEffect(cb)` | ipc-call | `latestFirmware` | **LOGGED-OK** | looking up the firmware to install (without it, Install says desktop.setup.noFirmware) _(via .catch L52)_ |
| 52 | `SetupScreen > useEffect(cb)` | .catch | `logged("looking up the firmware to install (without it, Inst` | **LOGGED-OK** | looking up the firmware to install (without it, Install says desktop.setup.noFirmware) _(logged())_ |
| 60 | `start` | catch | `fallback` | **SHOWN** | desktop.firmware.writeFailed and the other keyed flash/board errors (causeText) next to Install |
| 147 | `UpdatesWithoutDongle > useEffect(cb)` | ipc-call | `latestFirmware` | **LOGGED-OK** | looking up the latest firmware (Check now reports it when asked) _(via .catch L149)_ |
| 149 | `UpdatesWithoutDongle > useEffect(cb)` | .catch | `logged("looking up the latest firmware (Check now reports it` | **LOGGED-OK** | looking up the latest firmware (Check now reports it when asked) _(logged())_ |
| 155 | `check` | .catch | `() => null` | **SHOWN** | desktop.setup.checkFailed, or desktop.updateFeed.unsigned / .malformed when the feed was refused (a failed check reads as null, which the line below says) |
| 155 | `check` | .catch | `() => null` | **SHOWN** | desktop.setup.checkFailed, or desktop.updateFeed.unsigned / .malformed when the feed was refused (a failed check reads as null, which the line below says) |
| 155 | `check` | ipc-call | `checkForUpdates` | **SHOWN** | desktop.setup.checkFailed, or desktop.updateFeed.unsigned / .malformed when the feed was refused (a failed check reads as null, which the line below says) |
| 155 | `check` | ipc-call | `latestFirmware` | **SHOWN** | desktop.setup.checkFailed, or desktop.updateFeed.unsigned / .malformed when the feed was refused (a failed check reads as null, which the line below says) |

#### src/desktop/storage.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 12 | `readPref` | catch | `fallback` | **NOT-WORTH** | storage blocked: no saved preference, the default applies |
| 21 | `writePref` | catch | `empty` | **NOT-WORTH** | storage blocked: lasts for this session |

#### src/desktop/topLayer.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 28 | `inTopLayer` | catch | `fallback` | **NOT-WORTH** | no Popover API (jsdom): the popup stays in the page flow, nothing to hide |

#### src/desktop/tour/Tour.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 165 | `Tour > useEffect(cb)` | .catch | `logged("the tour's welcome line (decoration: its caption sti` | **LOGGED-OK** | the tour's welcome line (decoration: its caption still shows) _(logged())_ |
| 189 | `Tour > useEffect(cb)` | .catch | `logged("the tour's trigger effect")` | **LOGGED-OK** | the tour's trigger effect _(logged())_ |
| 190 | `Tour > useEffect(cb) > <anonymous>` | .catch | `logged("turning the tour's trigger effect off")` | **LOGGED-OK** | turning the tour's trigger effect off _(logged())_ |
| 190 | `Tour > useEffect(cb) > <anonymous>` | void | `client.previewTrigger(0).catch(logged("turning the tour's tr` | **LOGGED-OK** | turning the tour's trigger effect off _(via .catch L190)_ |
| 359 | `Tour > useEffect(cb) > setTimeout(cb)` | .catch | `logged("waiting for the narrator before the tour's next step` | **LOGGED-OK** | waiting for the narrator before the tour's next step _(logged())_ |

#### src/desktop/UpdateBanners.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 55 | `UpdateBanners > onClick=` | ipc-call | `installUpdate` | **PASSES-ON** | returned: the caller of onClick= handles it _(flow)_ |

#### src/desktop/UsbAccessSetup.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 18 | `UsbAccessSetup > useEffect(cb)` | .catch | `logged("checking for the USB access rule (unknown: the butto` | **LOGGED-OK** | checking for the USB access rule (unknown: the button stays offered) _(logged())_ |
| 18 | `UsbAccessSetup > useEffect(cb)` | ipc-call | `usbAccessInstalled` | **LOGGED-OK** | checking for the USB access rule (unknown: the button stays offered) _(via .catch L18)_ |
| 24 | `run` | ipc-call | `setupUsbAccess` | **PASSES-ON** | awaited: the caller of run handles it _(flow)_ |

#### src/desktop/useLiveInput.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 73 | `poll` | catch | `empty` | **NOT-WORTH** | dongle busy or gone: the connection hook handles reconnecting (and says so) |
| 79 | `next` | .catch | `logged("the live input poll (it catches its own errors)")` | **LOGGED-OK** | the live input poll (it catches its own errors) _(logged())_ |
| 79 | `next` | void | `poll().catch(logged("the live input poll (it catches its own` | **LOGGED-OK** | the live input poll (it catches its own errors) _(via .catch L79)_ |
| 114 | `poll` | catch | `empty` | **NOT-WORTH** | dongle busy or gone: the connection hook handles reconnecting (and says so) |
| 120 | `next` | .catch | `logged("the lightbar poll (it catches its own errors)")` | **LOGGED-OK** | the lightbar poll (it catches its own errors) _(logged())_ |
| 120 | `next` | void | `poll().catch(logged("the lightbar poll (it catches its own e` | **LOGGED-OK** | the lightbar poll (it catches its own errors) _(via .catch L120)_ |

#### src/desktop/usePoll.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 23 | `usePoll` | result-field | `usePoll.error: string \| null` | **SHOWN** | desktop.errors.board.timeout and the other keyed board errors (causeText): each caller shows \'error\' next to its readout |
| 47 | `tick` | catch | `fallback` | **SHOWN** | desktop.errors.board.timeout and the other keyed board errors (causeText): returned as \'error\', which the caller shows next to its readout |
| 54 | `usePoll > useEffect(cb)` | .catch | `logged("usePoll's tick (it catches its own errors)")` | **LOGGED-OK** | usePoll's tick (it catches its own errors) _(logged())_ |

#### src/desktop/useUpdates.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 18 | `useAppUpdate > useEffect(cb)` | .catch | `logged("reading the update state at start (updates still arr` | **LOGGED-OK** | reading the update state at start (updates still arrive through onUpdateState) _(logged())_ |
| 18 | `useAppUpdate > useEffect(cb)` | ipc-call | `getUpdateState` | **LOGGED-OK** | reading the update state at start (updates still arrive through onUpdateState) _(via .catch L18)_ |
| 32 | `useFirmwareHold > useEffect(cb)` | .catch | `logged("reading the firmware-write hold at start (changes st` | **LOGGED-OK** | reading the firmware-write hold at start (changes still arrive through onFirmwareHold) _(logged())_ |
| 32 | `useFirmwareHold > useEffect(cb)` | ipc-call | `getFirmwareHold` | **LOGGED-OK** | reading the firmware-write hold at start (changes still arrive through onFirmwareHold) _(via .catch L32)_ |
| 78 | `<module>` | result-field | `FirmwareUpdate.problem: FirmwareLookup["problem"]` | **SHOWN** | desktop.firmware.offline (FirmwarePage: unpublished / offline / unsigned / malformed under Latest) |
| 101 | `useFirmwareUpdate > useCallback(cb)` | ipc-call | `latestFirmware` | **SHOWN** | desktop.firmware.checkedOffline (an unanswered lookup reads as offline) _(via catch L102)_ |
| 102 | `useFirmwareUpdate > useCallback(cb)` | catch | `fallback: ipc:latestFirmware` | **SHOWN** | desktop.firmware.checkedOffline (an unanswered lookup reads as offline) |
| 121 | `useFirmwareUpdate > useEffect(cb)` | .then-reject | `() => live && setProblem("offline")` | **SHOWN** | desktop.firmware.offline (an unanswered lookup reads as offline) |
| 121 | `useFirmwareUpdate > useEffect(cb)` | ipc-call | `latestFirmware` | **SHOWN** | desktop.firmware.offline (an unanswered lookup reads as offline) |
| 158 | `useFirmwareUpdate > useCallback(cb)` | catch | `fallback` | **SHOWN** | desktop.firmware.writeFailed and the other keyed flash/board errors (causeText) in the firmware banner's error notice with Dismiss |
| 163 | `useFirmwareUpdate > useCallback(cb)` | .then-reject | `logged("refreshing the offer after a failed install (the fai` | **LOGGED-OK** | refreshing the offer after a failed install (the failure is already shown) _(logged())_ |
| 163 | `useFirmwareUpdate > useCallback(cb)` | ipc-call | `latestFirmware` | **LOGGED-OK** | refreshing the offer after a failed install (the failure is already shown) _(via .then-reject L163)_ |
| 179 | `useFirmwareUpdate > useCallback(cb)` | catch | `fallback` | **SHOWN** | desktop.firmware.writeFailed: the firmware banner's error notice with Dismiss (also noBootsel / wrongFile, in plain words) |
| 217 | `tick` | catch | `fallback` | **LOGGED-OK** | one look at the USB devices failed; the next look (500 ms) tries again, and the wait for the board goes on as before |
| 230 | `tick > setTimeout(cb)` | .catch | `logged("the bootloader look (it catches its own errors)")` | **LOGGED-OK** | the bootloader look (it catches its own errors) _(logged())_ |
| 230 | `tick > setTimeout(cb)` | void | `tick().catch(logged("the bootloader look (it catches its own` | **LOGGED-OK** | the bootloader look (it catches its own errors) _(via .catch L230)_ |
| 232 | `useFirmwareUpdate > useEffect(cb)` | .catch | `logged("the bootloader look (it catches its own errors)")` | **LOGGED-OK** | the bootloader look (it catches its own errors) _(logged())_ |

#### src/desktop/WindowsUsbRepair.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 25 | `WindowsUsbRepair` | result-field | `WindowsUsbRepair.ok: boolean` | **SHOWN** | desktop.windowsUsb.result.* (keyed text from the main process, shownText) below the button |
| 39 | `run` | ipc-call | `repairWindowsUsb` | **PASSES-ON** | awaited: the caller of run handles it _(flow)_ |

#### src/errorText.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 49 | `translateKeyed > replace(cb)` | json-parse | `json` | **NOT-WORTH** | our own JSON, escaped when written; a broken one shows the message without its values _(via catch L50)_ |
| 50 | `translateKeyed > replace(cb)` | catch | `empty: JSON.parse` | **NOT-WORTH** | our own JSON, escaped when written; a broken one shows the message without its values |

#### src/hooks/useDs5Bridge.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 54 | `<module>` | result-field | `UseDs5BridgeResult.error: string \| null` | **SHOWN** | desktop.errors.usb.network, the keyed board errors and the rest (causeText): DesktopApp's ErrorNotice with Dismiss |
| 155 | `useDs5Bridge > useCallback(cb)` | catch | `fallback` | **SHOWN** | desktop.errors.usb.network and the other keyed USB/board errors (causeText) in the error notice (bridge.error); on Windows an open failure is desktop.windowsUsb.seen on the setup screen instead |
| 188 | `useDs5Bridge > useCallback(cb)` | catch | `fallback` | **SHOWN** | desktop.errors.usb.security and the other keyed USB/board errors (causeText) in the error notice (bridge.error); NotFoundError is the user closing the device picker, not an error |
| 202 | `useDs5Bridge > useCallback(cb)` | catch | `fallback` | **SHOWN** | desktop.errors.board.timeout and the other keyed USB/board errors (causeText) in the error notice (bridge.error), and the caller gets false |
| 295 | `useDs5Bridge > useEffect(cb)` | .catch | `logged("connecting to an already-permitted board at start (w` | **LOGGED-OK** | connecting to an already-permitted board at start (without one, the setup screen shows) _(logged())_ |
| 295 | `useDs5Bridge > useEffect(cb)` | void | `autoConnect().catch(logged("connecting to an already-permitt` | **LOGGED-OK** | connecting to an already-permitted board at start (without one, the setup screen shows) _(via .catch L295)_ |
| 345 | `poll` | catch | `empty` | **NOT-WORTH** | gone or busy: the USB events handle reconnecting |
| 352 | `next` | .catch | `logged("the board's identity/settings poll")` | **LOGGED-OK** | the board's identity/settings poll _(logged())_ |
| 352 | `next` | void | `poll().catch(logged("the board's identity/settings poll"))` | **LOGGED-OK** | the board's identity/settings poll _(via .catch L352)_ |
| 371 | `onConnect` | .catch | `logged("connecting to a board that was plugged in (it stays ` | **LOGGED-OK** | connecting to a board that was plugged in (it stays on the setup screen) _(logged())_ |
| 396 | `useDs5Bridge > useEffect(cb) > onChange(cb)` | .catch | `logged("connecting to the simulated board after it restarted` | **LOGGED-OK** | connecting to the simulated board after it restarted (it stays on the setup screen) _(logged())_ |

#### src/i18n/index.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 80 | `<module>` | .catch | `logged("starting i18next")` | **LOGGED-OK** | starting i18next _(logged())_ |

#### src/oled/share.worker.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 7 | `<module>` | result-field | `ShareReply.ok: false` | **PASSES-ON** | a failed reply rejects encodeOffThread; OledShare shows desktop.oledShare.errors.encode / .tooBig |
| 18 | `<anonymous>` | .then-reject | `(cause: unknown) => scope.postMessage({ ok: false, tooBig: c` | **PASSES-ON** | the reply carries the failure; shareEncode.ts rejects with it and OledShare shows it |

#### src/persisted.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 87 | `readPersisted` | catch | `fallback` | **SHOWN** | desktop.recovered.notKept (RecoveredNotice): it can't be opened at all (permissions, a folder in its place); the defaults for now, the file left as it is |
| 96 | `readPersisted` | json-parse | `raw` | **SHOWN** | desktop.recovered.whole (RecoveredNotice): not JSON at all (cut off, overwritten); handled below with the copy kept aside _(via catch L97)_ |
| 97 | `readPersisted` | catch | `fallback: JSON.parse` | **SHOWN** | desktop.recovered.whole (RecoveredNotice): not JSON at all (cut off, overwritten); handled below with the copy kept aside |
| 109 | `readPersisted` | catch | `fallback` | **SHOWN** | desktop.recovered.notKept (RecoveredNotice): the copy couldn't be made, so the original isn't overwritten now |
| 116 | `readPersisted` | catch | `fallback` | **LOGGED-OK** | the copy is kept and the notice says so; only the write-back of what loaded failed, and the app's next save writes it again |
| 148 | `salvageObject` | schema | `schema.safeParse` | **NOT-WORTH** | an object that doesn't fit whole is salvaged field by field below; what's lost is counted, which the caller's notice says |
| 161 | `salvageObject` | schema | `field.safeParse` | **NOT-WORTH** | a field that doesn't fit is left out: counted as lost, which the notice says |
| 166 | `salvageObject` | schema | `schema.safeParse` | **NOT-WORTH** | the salvaged fields checked whole: null (nothing usable) is said by the caller's notice |
| 179 | `salvageRecord` | schema | `key.safeParse` | **NOT-WORTH** | a key that doesn't fit is left out: counted as lost, which the notice says |

#### src/protocol/bridgeClient.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 449 | `command` | .catch | `() => undefined` | **NOT-WORTH** | the queue's own copy; the caller gets \'run\' with the error |
| 465 | `runCommand` | catch | `rethrow` | **PASSES-ON** | rethrows to the caller _(rethrow)_ |

#### src/protocol/officialFirmware.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 41 | `parseOfficialInfo` | schema | `OfficialInfoSchema.safeParse` | **SHOWN** | desktop.ctrlInfo.officialUnavailable (null makes the lookup "unavailable", said after Refresh) |

#### src/protocol/webUsbTransport.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 81 | `close` | catch | `empty` | **NOT-WORTH** | already gone |
| 115 | `transfer` | catch | `rethrow` | **PASSES-ON** | rethrows to the caller _(rethrow)_ |
| 126 | `enqueue` | .then-reject | `task` | **NOT-WORTH** | a task runs after a failed one too; the failure already went to its own caller |
| 128 | `enqueue` | .catch | `() => undefined` | **NOT-WORTH** | the queue's own copy; the caller gets \'run\' with the error |

## Firmware (`MarcelineVPQ/DS5Dongle-OLED-Edition`)

**How the list was made.** `tools/list_errors.py` (standard library only) reuses `tools/list_loops.py`'s brace-aware scanner, `#if` handling and name-based call graph, and lists every failure path in `src/` (`lib/` excluded):

- **ignored-call / checked-call**: a call that can fail, with its result dropped or tested/passed on. "Can fail" means a fixed list of SDK/BTstack/TinyUSB/Opus/cyw43 calls that return a status, bool or count (`hci_send_cmd`, `l2cap_send`, `gap_inquiry_*`, `tud_control_xfer`, `tud_hid_report`, `queue_try_add`, `flash_safe_execute`, `opus_*`, `malloc`…), plus every `src/` function returning `bool`, `CalibSet` or `RemapSet` whose name isn't a predicate (`is_*`, `*_connected`, `valid*`…).
- **return-fail**: `return false` / `-1` / `nullptr` / `Invalid` / `NotSaved` / `CMD_RESULT_INVALID|FAILED|BUSY` in a function that reports failure, plus `return 0` from the GET handlers.
- **result-code**: a `CMD_RESULT_INVALID|FAILED|BUSY` assignment. This is the result byte in 0xF1 that the app reads after every 0xF6 SET.
- **validate**: a magic or CRC check on stored data (config, remap, calibration, slots).
- **counter**: a drop, overflow or error counter being bumped.
- **guard**: `if (...) return;` in a void function reached from a user action, where the action silently does nothing. The roots are the 0xF6 SET (`pico_cmd_set`), the deferred `cmd_task`, and the OLED's button handlers.

"Runs on" is list_loops' context (`core1`, `core0-loop`, `callback`, `isr`, `boot`), plus `user` when a user action reaches it. Each row carries one verdict comment, `// error: VERDICT — <surfaces as>; <why>` (with an optional ` Change: …`). `python3 tools/list_errors.py --check` fails CI (`build.yml`, `release.yml`) on a row without one.

| Kind | SHOWN | LOGGED-OK | SILENT-BUG | SWALLOWED | NOT-WORTH | Total |
|---|---|---|---|---|---|---|
| ignored-call | 0 | 21 | 0 | 0 | 31 | 52 |
| checked-call | 50 | 11 | 0 | 0 | 21 | 82 |
| return-fail | 26 | 0 | 0 | 0 | 45 | 71 |
| result-code | 29 | 0 | 0 | 0 | 0 | 29 |
| validate | 1 | 6 | 0 | 0 | 6 | 13 |
| counter | 0 | 5 | 0 | 0 | 0 | 5 |
| guard | 1 | 0 | 0 | 0 | 16 | 17 |
| **Total** | **107** | **43** | **0** | **0** | **119** | **269** |

_Re-listed 2026-10-15 against firmware branch `fw-bt-idle-mic` (52aebf9 + f2727bf), not flashed yet, waiting for the owner's hardware test: 269 failure paths, SHOWN 107, LOGGED-OK 43, SILENT-BUG 0, SWALLOWED 0, NOT-WORTH 119 (F1 done: a status line on every OLED screen, `src/oled_toast.h`). Line numbers are that branch's._

How the firmware surfaces an error to the user: the **0xF1 result byte** after an 0xF6 SET (`CMD_RESULT_INVALID` 2, `FAILED` 3, `BUSY` 4, which the app's `bridgeClient` throws as a `CommandError`), an **OLED message** (`"Save FAIL"`, `"Reset FAIL"`, `"Wipe FAIL"`), a **flag the app shows** (`g_c1_flags` 0x02/0x04 → `CORE1_SPEAKER_FAILED` / `CORE1_MIC_FAILED` on the Dongle dashboard, ctrl-test `NO_ANSWER` / `NO_CONTROLLER` in GET 0xEB), or a **counter** (0xF5/0xFB audio drops, `g_fse_fail` on OLED Diagnostics).

**Fixed in this pass (silent bugs, each with a host test):**

| Where | Was | Now | Test |
|---|---|---|---|
| `0xF6 0x04` slot switch (`bt_set_slot`) | the `config_save()` result was dropped: a failed save answered OK, and the switch was lost at power-off | `bt_set_slot` returns whether it saved; `cmd_task` answers `CMD_RESULT_FAILED`; the OLED Slots screen says "Save FAIL" | `cmd_slot_ops_report_a_failed_save` |
| `0xF6 0x05` forget slot (`bt_forget_slot` → `slot_forget`) | `save_slots_to_flash()` result dropped: OK, and the slot came back at power-off | returns the save result; `CMD_RESULT_FAILED`; OLED "Wipe FAIL" | same, `slots_changes_report_a_failed_save` |
| `0xF6 0x06` / OLED Settings "wipe all slots" (`bt_wipe_all_slots` → `slots_wipe_all`) | same; the OLED always said "Slots wiped!" | `CMD_RESULT_FAILED`; OLED "Wipe FAIL" | same |
| `0xF6 0x13` Edge extra buttons (`remap_set_extra`) | a failed flash save answered `CMD_RESULT_INVALID` (the app says "rejected"; the entries were in fact applied) | `remap_set_extra` returns `RemapSet` (Ok / Invalid / NotSaved), and NotSaved answers `CMD_RESULT_FAILED` | `cmd_extra_remap_failed_save_is_failed_not_invalid`, `remap_edge_extras_not_saved` |

No new result code: `CMD_RESULT_FAILED` is one the app already turns into a `CommandError`, and the app now says it in plain words (`desktop.errors.boardFailed`: your board couldn't finish that, for example saving to its memory, and the change may be lost when it powers off). That covers the Slots page and wherever the extra buttons are saved (app fix 24).

**F1 (below) is done on firmware branch `fw-bt-idle-mic` (52aebf9), not flashed, waiting for the owner's hardware test.** As proposed:

| Batch | Location | Verdict | Change |
|---|---|---|---|
| F1: an OLED toast on every screen | `src/oled.cpp` `handle_buttons` (long-press brightness save), `lightbar_save_config` (leaving the Lightbar screen), `src/bt.cpp` `l2cap_packet_handler` (`slot_assign` after a new pairing) | SILENT-BUG ×3 | `settings_show_status` only draws on the Settings screen. Add a footer status every screen draws (2 s), and show "Save FAIL" / "Pair not saved" when these saves fail. All three need a flash lockout timeout, so they are rare. |

There are no SWALLOWED rows. The boot-time init saves of a blank sector (config migration, remap, slots) are LOGGED-OK: the RAM copy works, and the next boot retries the save.

### Every failure path, by file

Line numbers are as of this branch. If code moves, the function name finds the row.

#### src/audio.cpp

| Line | Function | Kind | Runs on | Surfaces as | Verdict | Why | Change |
|---|---|---|---|---|---|---|---|
| 218 | `mic_add_queue` | ignored-call `queue_try_add` | callback | counter (mic FIFO level in 0xF5) | **LOGGED-OK** | oldest mic packet is dropped first, so the add cannot fail; a drop is a glitch, not a user action | - |
| 296 | `mic_drain` | ignored-call `tud_audio_write` | core0-loop | g_mic_last_wrote / last_want in OLED Diag + 0xF5 | **LOGGED-OK** | a short USB write is an underrun the PC's audio stack conceals | - |
| 307 | `mic_drain` | checked-call `tud_audio_write` | core0-loop | g_mic_last_wrote / last_want in OLED Diag + 0xF5 | **LOGGED-OK** | a short USB write is an underrun the PC's audio stack conceals | - |
| 561 | `audio_loop` | counter `g_drop_raw` | core0-loop | counter g_drop_raw (0xFB/0xF5, the app's audio counters) | **LOGGED-OK** | realtime audio drops the oldest block, nothing for the user to do | - |
| 565 | `audio_loop` | checked-call `queue_try_add` | core0-loop | printf + g_drop_raw | **LOGGED-OK** | the FIFO was just made room for, so this can't fail in practice | - |
| 622 | `audio_loop` | counter `g_drop_hap` | core0-loop | counter g_drop_hap (0xFB/0xF5) | **LOGGED-OK** | realtime haptics drop the oldest block | - |
| 626 | `audio_loop` | ignored-call `queue_try_add` | core0-loop | counter g_drop_hap | **LOGGED-OK** | room was made on the line above, so the add can't fail | - |
| 675 | `speaker_proc` | checked-call `opus_encode_float` | core1 | the block is skipped (a 10 ms gap) | **LOGGED-OK** | an encode error needs a broken encoder, which core1 flags at start (g_c1_flags 0x02, shown in the app's Dongle dashboard) | - |
| 682 | `speaker_proc` | counter `g_drop_enc` | core1 | counter g_drop_enc (0xF5) | **LOGGED-OK** | realtime speaker drops the oldest packet | - |
| 685 | `speaker_proc` | ignored-call `queue_try_add` | core1 | counted on the line above | **LOGGED-OK** | room was just made, so the add can't fail | - |
| 694 | `mic_push_decoded` | ignored-call `queue_try_add` | core1 | counted on the line above | **LOGGED-OK** | room was just made, so the add can't fail | - |
| 708 | `mic_proc` | checked-call `opus_decode` | core1 | g_mic_last_decoded in OLED Diag | **LOGGED-OK** | a bad packet is one lost 10 ms frame, PLC covers it | - |
| 720 | `mic_proc` | return-fail `false` | core1 | nothing | **NOT-WORTH** | false = no mic frame this pass (session idle), not an error | - |
| 724 | `mic_proc` | return-fail `false` | core1 | nothing | **NOT-WORTH** | false = no mic frame this pass (session idle), not an error | - |
| 730 | `mic_proc` | checked-call `opus_decode` | core1 | g_mic_last_decoded in OLED Diag | **LOGGED-OK** | a bad packet is one lost 10 ms frame, PLC covers it | - |
| 739 | `mic_proc` | return-fail `false` | core1 | nothing | **NOT-WORTH** | false = no mic frame this pass (session idle), not an error | - |
| 763 | `core1_entry` | checked-call `opus_encoder_create` | core1 | g_c1_flags 0x02 (CORE1_SPEAKER_FAILED) in 0xF5, the app's Dongle dashboard says the speaker path failed | **SHOWN** | printf with free heap | - |
| 767 | `core1_entry` | checked-call `opus_encoder_create` | core1 | g_c1_flags 0x02 (CORE1_SPEAKER_FAILED) in 0xF5, the app's Dongle dashboard says the speaker path failed | **SHOWN** | printf with free heap | - |
| 776 | `core1_entry` | ignored-call `opus_encoder_ctl` | core1 | nothing | **NOT-WORTH** | constant, valid encoder settings on an encoder that was just created | - |
| 778 | `core1_entry` | ignored-call `opus_encoder_ctl` | core1 | nothing | **NOT-WORTH** | constant, valid encoder settings on an encoder that was just created | - |
| 780 | `core1_entry` | ignored-call `opus_encoder_ctl` | core1 | nothing | **NOT-WORTH** | constant, valid encoder settings on an encoder that was just created | - |
| 782 | `core1_entry` | ignored-call `opus_encoder_ctl` | core1 | nothing | **NOT-WORTH** | constant, valid encoder settings on an encoder that was just created | - |
| 795 | `core1_entry` | checked-call `opus_decoder_create` | core1 | g_c1_flags 0x04 (CORE1_MIC_FAILED) in 0xF5, the app's Dongle dashboard says the mic path failed | **SHOWN** | printf | - |
| 819 | `core1_entry` | checked-call `mic_proc` | core1 | nothing | **NOT-WORTH** | false = no mic frame this pass (session idle), not an error | - |

#### src/bt.cpp

| Line | Function | Kind | Runs on | Surfaces as | Verdict | Why | Change |
|---|---|---|---|---|---|---|---|
| 137 | `bt_any_slot_paired` | return-fail `false` | core0-loop | not a failure: false = every slot is empty (the idle back-off may scan) | **NOT-WORTH** | - | - |
| 143 | `inquiry_start` | guard `g_inquiring \|\| !g_hci_working` | callback+core0-loop+user | not a failure: one inquiry runs already, or BTstack isn't up yet (HCI_STATE_WORKING starts the boot one) | **NOT-WORTH** | - | - |
| 145 | `inquiry_start` | checked-call `gap_inquiry_start` | callback+core0-loop+user | nothing | **NOT-WORTH** | gap_inquiry_start only fails while an inquiry is still ending (the next pairing action / idle gap starts a new one) or the stack is off | - |
| 167 | `bt_pair_now` | return-fail `false` | core0-loop+user | not a failure: the Status screen shows the controller (only that screen without one offers this) | **SHOWN** | - | - |
| 199 | `make_slot_current` | checked-call `config_save` | callback+core0-loop+user | returned to bt_set_slot / bt_forget_slot (0xF6 CMD_RESULT_FAILED, the OLED's "Save FAIL" / "Wipe FAIL") | **SHOWN** | the connect path marks its own call | - |
| 204 | `bt_set_slot` | return-fail `false` | core0-loop+user | false to the caller | **NOT-WORTH** | every caller checks the slot first (0xF6 0x04/0x05 answer INVALID, the OLED cursor stays in 0..3) | - |
| 207 | `bt_set_slot` | checked-call `make_slot_current` | core0-loop+user | returned: 0xF6 0x04 answers CMD_RESULT_FAILED (the app's command error), the OLED shows "Save FAIL" | **SHOWN** | - | - |
| 219 | `bt_set_slot` | ignored-call `bt_disconnect` | core0-loop+user | nothing | **NOT-WORTH** | false only when there is no ACL, i.e. already disconnected | - |
| 230 | `bt_forget_slot` | return-fail `false` | core0-loop+user | false to the caller | **NOT-WORTH** | every caller checks the slot first (0xF6 0x04/0x05 answer INVALID, the OLED cursor stays in 0..3) | - |
| 235 | `bt_forget_slot` | checked-call `slot_forget` | core0-loop+user | returned: 0xF6 0x04/0x05/0x06 answer CMD_RESULT_FAILED (the app's command error), the OLED shows "Save FAIL" / "Wipe FAIL" (fixed in this pass: was dropped) | **SHOWN** | - | - |
| 246 | `bt_forget_slot` | checked-call `make_slot_current` | core0-loop+user | returned with the forget: 0xF6 0x05 answers CMD_RESULT_FAILED, the OLED shows "Wipe FAIL" | **SHOWN** | - | - |
| 249 | `bt_forget_slot` | ignored-call `bt_disconnect` | core0-loop+user | nothing | **NOT-WORTH** | false only when there is no ACL, i.e. already disconnected | - |
| 258 | `bt_wipe_all_slots` | checked-call `gap_link_key_iterator_init` | core0-loop+user | nothing | **NOT-WORTH** | no stored keys = nothing to drop, the slot table is still wiped | - |
| 275 | `bt_wipe_all_slots` | checked-call `slots_wipe_all` | core0-loop+user | returned: 0xF6 0x04/0x05/0x06 answer CMD_RESULT_FAILED (the app's command error), the OLED shows "Save FAIL" / "Wipe FAIL" (fixed in this pass: was dropped) | **SHOWN** | - | - |
| 280 | `bt_wipe_all_slots` | ignored-call `bt_disconnect` | core0-loop+user | nothing | **NOT-WORTH** | false only when there is no ACL, i.e. already disconnected | - |
| 288 | `bt_send_packet` | ignored-call `l2cap_send` | - | unused (no caller) | **NOT-WORTH** | output goes through bt_write's FIFO | - |
| 295 | `bt_send_control` | ignored-call `l2cap_send` | core0-loop+user | nothing | **NOT-WORTH** | one write on an open control channel (the Edge unlock handshake), fails only if the link just dropped, and everything restarts on reconnect | - |
| 302 | `bt_disconnect` | return-fail `false` | callback+core0-loop+user | nothing | **NOT-WORTH** | false only when there is no ACL, i.e. already disconnected | - |
| 307 | `bt_disconnect` | ignored-call `hci_send_cmd` | callback+core0-loop+user | printf of the step + BTstack's own event | **LOGGED-OK** | the connection watchdog (CONNECT_WATCHDOG_TIMEOUT_US) tears a stalled attempt down and inquiry restarts, the OLED shows not connected | - |
| 321 | `bt_connection_watchdog_tick` | checked-call `bt_any_slot_paired` | core0-loop | not a failure: any_slot_paired() false only means nothing is paired | **NOT-WORTH** | - | - |
| 337 | `bt_connection_watchdog_tick` | ignored-call `bt_disconnect` | core0-loop | nothing | **NOT-WORTH** | false only when there is no ACL, i.e. already disconnected | - |
| 363 | `bt_get_signal_strength` | checked-call `gap_read_rssi` | callback+core0-loop | the RSSI poll retries after 1 s (rssi_poll.h) | **NOT-WORTH** | the OLED shows the last value | - |
| 373 | `bt_l2cap_init` | ignored-call `l2cap_register_service` | boot | boot: two fixed PSMs registered once on a fresh stack | **NOT-WORTH** | can only fail out of memory, which the build sizes for | - |
| 376 | `bt_l2cap_init` | ignored-call `l2cap_register_service` | boot | boot: two fixed PSMs registered once on a fresh stack | **NOT-WORTH** | can only fail out of memory, which the build sizes for | - |
| 408 | `bt_init` | ignored-call `hci_power_control` | boot | boot: power-on of the radio cyw43_arch_init already brought up | **NOT-WORTH** | BTSTACK_EVENT_STATE never reaching WORKING leaves the OLED on its connecting screen | - |
| 492 | `hci_packet_handler` | ignored-call `gap_inquiry_stop` | callback | nothing | **NOT-WORTH** | gap_inquiry_* only fails while an inquiry is already in the wanted state or the stack is off, and INQUIRY_COMPLETE / the watchdog restart it | - |
| 508 | `hci_packet_handler` | ignored-call `hci_send_cmd` | callback | printf of the step + BTstack's own event | **LOGGED-OK** | the connection watchdog (CONNECT_WATCHDOG_TIMEOUT_US) tears a stalled attempt down and inquiry restarts, the OLED shows not connected | - |
| 559 | `hci_packet_handler` | ignored-call `hci_send_cmd` | callback | printf of the step + BTstack's own event | **LOGGED-OK** | the connection watchdog (CONNECT_WATCHDOG_TIMEOUT_US) tears a stalled attempt down and inquiry restarts, the OLED shows not connected | - |
| 586 | `hci_packet_handler` | ignored-call `hci_send_cmd` | callback | printf of the step + BTstack's own event | **LOGGED-OK** | the connection watchdog (CONNECT_WATCHDOG_TIMEOUT_US) tears a stalled attempt down and inquiry restarts, the OLED shows not connected | - |
| 590 | `hci_packet_handler` | ignored-call `hci_send_cmd` | callback | printf of the step + BTstack's own event | **LOGGED-OK** | the connection watchdog (CONNECT_WATCHDOG_TIMEOUT_US) tears a stalled attempt down and inquiry restarts, the OLED shows not connected | - |
| 600 | `hci_packet_handler` | ignored-call `hci_send_cmd` | callback | printf of the step + BTstack's own event | **LOGGED-OK** | the connection watchdog (CONNECT_WATCHDOG_TIMEOUT_US) tears a stalled attempt down and inquiry restarts, the OLED shows not connected | - |
| 609 | `hci_packet_handler` | ignored-call `gap_pin_code_response` | callback | printf of the step + BTstack's own event | **LOGGED-OK** | the connection watchdog (CONNECT_WATCHDOG_TIMEOUT_US) tears a stalled attempt down and inquiry restarts, the OLED shows not connected | - |
| 628 | `hci_packet_handler` | ignored-call `bt_disconnect` | callback | nothing | **NOT-WORTH** | false only when there is no ACL, i.e. already disconnected | - |
| 631 | `hci_packet_handler` | ignored-call `hci_send_cmd` | callback | printf of the step + BTstack's own event | **LOGGED-OK** | the connection watchdog (CONNECT_WATCHDOG_TIMEOUT_US) tears a stalled attempt down and inquiry restarts, the OLED shows not connected | - |
| 649 | `hci_packet_handler` | ignored-call `l2cap_create_channel` | callback | printf of the step + BTstack's own event | **LOGGED-OK** | the connection watchdog (CONNECT_WATCHDOG_TIMEOUT_US) tears a stalled attempt down and inquiry restarts, the OLED shows not connected | - |
| 664 | `hci_packet_handler` | ignored-call `gap_inquiry_stop` | callback | nothing | **NOT-WORTH** | gap_inquiry_* only fails while an inquiry is already in the wanted state or the stack is off, and INQUIRY_COMPLETE / the watchdog restart it | - |
| 666 | `hci_packet_handler` | ignored-call `hci_send_cmd` | callback | printf of the step + BTstack's own event | **LOGGED-OK** | the connection watchdog (CONNECT_WATCHDOG_TIMEOUT_US) tears a stalled attempt down and inquiry restarts, the OLED shows not connected | - |
| 750 | `l2cap_packet_handler` | ignored-call `bt_disconnect` | callback | nothing | **NOT-WORTH** | false only when there is no ACL, i.e. already disconnected | - |
| 810 | `l2cap_packet_handler` | checked-call `make_slot_current` | callback | OLED status line "Slot: Save FAIL" on whichever screen is up (error pass F1 | **SHOWN** | was SILENT-BUG: a failed save boots it in the old slot) | - |
| 813 | `l2cap_packet_handler` | checked-call `slot_assign` | callback | OLED status line "Pair: Save FAIL" on whichever screen is up (error pass F1 | **SHOWN** | was SILENT-BUG: the pairing is lost at power-off) | - |
| 825 | `l2cap_packet_handler` | ignored-call `l2cap_create_channel` | callback | printf of the step + BTstack's own event | **LOGGED-OK** | the connection watchdog (CONNECT_WATCHDOG_TIMEOUT_US) tears a stalled attempt down and inquiry restarts, the OLED shows not connected | - |
| 868 | `l2cap_packet_handler` | ignored-call `bt_disconnect` | callback | nothing | **NOT-WORTH** | false only when there is no ACL, i.e. already disconnected | - |
| 894 | `l2cap_packet_handler` | ignored-call `bt_disconnect` | callback | nothing | **NOT-WORTH** | false only when there is no ACL, i.e. already disconnected | - |
| 905 | `l2cap_packet_handler` | checked-call `l2cap_send` | callback | printf of the L2CAP status | **LOGGED-OK** | one output report lost, the game's next one (sent every frame) replaces it | - |
| 912 | `l2cap_packet_handler` | ignored-call `l2cap_request_can_send_now_event` | callback | nothing | **NOT-WORTH** | asking for a CAN_SEND_NOW on an open channel only fails if the channel just closed, and DISCONNECTION clears the FIFO | - |
| 937 | `bt_write` | guard `hid_interrupt_cid == 0` | callback+core0-loop+user | nothing | **NOT-WORTH** | no controller connected: the PC's output report has nowhere to go (the app and OLED already show no controller) | - |
| 951 | `bt_write` | checked-call `queue_try_add` | callback+core0-loop+user | printf | **LOGGED-OK** | the output FIFO is full, this report is dropped and the next state write (games send every frame, the app re-sends on change) replaces it | - |
| 957 | `bt_write` | ignored-call `l2cap_request_can_send_now_event` | callback+core0-loop+user | nothing | **NOT-WORTH** | asking for a CAN_SEND_NOW on an open channel only fails if the channel just closed, and DISCONNECTION clears the FIFO | - |
| 979 | `bt_request_feature` | ignored-call `l2cap_send` | callback+core0-loop+user | nothing here | **LOGGED-OK** | every caller polls for the answer with a deadline: ctrl tests end NO_ANSWER (shown by the app), the colorway read gives up (no color), the 0x09/0x20/0x05 host GETs answer from the cache | - |
| 1024 | `set_feature_data` | ignored-call `l2cap_send` | callback+core0-loop+user | nothing here | **LOGGED-OK** | every caller polls for the answer with a deadline: ctrl tests end NO_ANSWER (shown by the app), the colorway read gives up (no color), the 0x09/0x20/0x05 host GETs answer from the cache | - |

#### src/calib.cpp

| Line | Function | Kind | Runs on | Surfaces as | Verdict | Why | Change |
|---|---|---|---|---|---|---|---|
| 106 | `save` | checked-call `flash_sector_write` | callback+user | passed up as NotSaved: CMD_RESULT_FAILED in 0xF1 (0x0D/0x14), the app's command error | **SHOWN** | - | - |
| 106 | `save` | return-fail `false` | callback+user | passed up as NotSaved: CMD_RESULT_FAILED in 0xF1 (0x0D/0x14), the app's command error | **SHOWN** | - | - |
| 143 | `calib_load` | validate `g_cal.magic == CALIB_MAGIC` | boot | nothing | **LOGGED-OK** | boot: a blank/old calibration sector means no calibration yet (identity), which the app shows as not calibrated | - |
| 221 | `calib_set` | return-fail `CalibSet::Invalid` | callback+user | CMD_RESULT_INVALID in 0xF1 (cmd.cpp 0x0D/0x14), the app's command error | **SHOWN** | - | - |
| 225 | `calib_set` | return-fail `CalibSet::Invalid` | callback+user | CMD_RESULT_INVALID in 0xF1 (cmd.cpp 0x0D/0x14), the app's command error | **SHOWN** | - | - |
| 229 | `calib_set` | checked-call `save` | callback+user | NotSaved: CMD_RESULT_FAILED in 0xF1, the app's command error | **SHOWN** | - | - |
| 229 | `calib_set` | return-fail `save () ? CalibSet::Ok : CalibSet::NotSaved` | callback+user | NotSaved: CMD_RESULT_FAILED in 0xF1, the app's command error | **SHOWN** | - | - |
| 238 | `curves_set` | return-fail `CalibSet::Invalid` | callback+user | CMD_RESULT_INVALID in 0xF1 (cmd.cpp 0x0D/0x14), the app's command error | **SHOWN** | - | - |
| 254 | `curves_set` | checked-call `save` | callback+user | NotSaved: CMD_RESULT_FAILED in 0xF1, the app's command error | **SHOWN** | - | - |
| 254 | `curves_set` | return-fail `save () ? CalibSet::Ok : CalibSet::NotSaved` | callback+user | NotSaved: CMD_RESULT_FAILED in 0xF1, the app's command error | **SHOWN** | - | - |

#### src/cmd.cpp

| Line | Function | Kind | Runs on | Surfaces as | Verdict | Why | Change |
|---|---|---|---|---|---|---|---|
| 171 | `controller_info_task` | guard `!connected` | core0-loop+user | nothing | **NOT-WORTH** | scheduling of the colorway read (not connected / not due / test slot busy); a read that never answers leaves the colorway unknown, the app draws the default | - |
| 175 | `controller_info_task` | guard `now < s_color_due_us \|\| !may_start` | core0-loop+user | nothing | **NOT-WORTH** | scheduling of the colorway read (not connected / not due / test slot busy); a read that never answers leaves the colorway unknown, the app draws the default | - |
| 185 | `controller_info_task` | guard `now < s_color_due_us` | core0-loop+user | nothing | **NOT-WORTH** | scheduling of the colorway read (not connected / not due / test slot busy); a read that never answers leaves the colorway unknown, the app draws the default | - |
| 244 | `cmd_task` | guard `!s_pending \|\| time_us_64 () < s_pending_due_us` | core0-loop+user | nothing | **NOT-WORTH** | no deferred command due yet (scheduling) | - |
| 250 | `cmd_task` | checked-call `config_save` | core0-loop+user | CMD_RESULT_FAILED in the 0xF1 result byte, the app's command error (save failed) | **SHOWN** | - | - |
| 255 | `cmd_task` | checked-call `bt_set_slot` | core0-loop+user | CMD_RESULT_FAILED in the 0xF1 result byte, the app's command error (fixed in this pass: a failed slot save said OK) | **SHOWN** | - | - |
| 260 | `cmd_task` | checked-call `bt_forget_slot` | core0-loop+user | CMD_RESULT_FAILED in the 0xF1 result byte, the app's command error (fixed in this pass: a failed slot save said OK) | **SHOWN** | - | - |
| 264 | `cmd_task` | checked-call `bt_wipe_all_slots` | core0-loop+user | CMD_RESULT_FAILED in the 0xF1 result byte, the app's command error (fixed in this pass: a failed slot save said OK) | **SHOWN** | - | - |
| 280 | `cmd_task` | checked-call `config_save` | core0-loop+user | CMD_RESULT_FAILED in the 0xF1 result byte, the app's command error (save failed) | **SHOWN** | - | - |
| 287 | `cmd_task` | result-code `CMD_RESULT_FAILED` | core0-loop+user | CMD_RESULT_FAILED in the 0xF1 result byte: no controller connected, the app's command error | **SHOWN** | - | - |
| 297 | `cmd_task` | result-code `CMD_RESULT_FAILED` | core0-loop+user | CMD_RESULT_FAILED in the 0xF1 result byte: no controller connected, the app's command error | **SHOWN** | - | - |
| 306 | `cmd_task` | checked-call `config_save_narrator` | core0-loop+user | CMD_RESULT_FAILED in the 0xF1 result byte, the app's command error (save failed) | **SHOWN** | - | - |
| 311 | `cmd_task` | checked-call `config_save_power_flags` | core0-loop+user | CMD_RESULT_FAILED in the 0xF1 result byte, the app's command error (save failed) | **SHOWN** | - | - |
| 316 | `cmd_task` | checked-call `oled_key_inject` | core0-loop+user | CMD_RESULT_BUSY in the 0xF1 result byte: four presses already waiting | **SHOWN** | the app shows a command error | - |
| 320 | `cmd_task` | checked-call `oled_pad_inject` | core0-loop+user | CMD_RESULT_BUSY in the 0xF1 result byte: four presses already waiting (button and hold were checked at the SET) | **SHOWN** | the app shows a command error | - |
| 324 | `cmd_task` | result-code `CMD_RESULT_INVALID` | core0-loop+user | CMD_RESULT_INVALID in the 0xF1 result byte: unknown function, the app's command error | **SHOWN** | - | - |
| 412 | `pico_cmd_get` | return-fail `0` | callback | USB STALL to the host | **NOT-WORTH** | a request shorter than the reply (the app always asks the full length, its transport reports a short reply) | - |
| 428 | `pico_cmd_get` | return-fail `0` | callback | USB STALL to the host | **NOT-WORTH** | a request shorter than the reply (the app always asks the full length, its transport reports a short reply) | - |
| 440 | `pico_cmd_get` | return-fail `0` | callback | USB STALL to the host | **NOT-WORTH** | a request shorter than the reply (the app always asks the full length, its transport reports a short reply) | - |
| 462 | `pico_cmd_get` | return-fail `0` | callback | USB STALL to the host | **NOT-WORTH** | a request shorter than the reply (the app always asks the full length, its transport reports a short reply) | - |
| 566 | `pico_cmd_get` | return-fail `0` | callback | USB STALL to the host | **NOT-WORTH** | a request shorter than the reply (the app always asks the full length, its transport reports a short reply) | - |
| 581 | `pico_cmd_get` | return-fail `0` | callback | USB STALL to the host | **NOT-WORTH** | a request shorter than the reply (the app always asks the full length, its transport reports a short reply) | - |
| 601 | `pico_cmd_get` | return-fail `0` | callback | USB STALL to the host | **NOT-WORTH** | a request shorter than the reply (the app always asks the full length, its transport reports a short reply) | - |
| 634 | `pico_cmd_get` | return-fail `0` | callback | USB STALL to the host | **NOT-WORTH** | a request shorter than the reply (the app always asks the full length, its transport reports a short reply) | - |
| 657 | `pico_cmd_get` | return-fail `0` | callback | USB STALL to the host | **NOT-WORTH** | a request shorter than the reply (the app always asks the full length, its transport reports a short reply) | - |
| 790 | `pico_cmd_get` | return-fail `0` | callback | USB STALL | **NOT-WORTH** | an unknown report id (the app only asks the ids identity lists) | - |
| 810 | `pico_cmd_set` | result-code `CMD_RESULT_BUSY` | callback+user | CMD_RESULT_BUSY in the 0xF1 result byte: a deferred command is still pending | **SHOWN** | the app waits for 0xF1 first and shows a command error if it ever sees BUSY | - |
| 868 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: bad argument or framing, the app's command error | **SHOWN** | - | - |
| 883 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: bad argument or framing, the app's command error | **SHOWN** | - | - |
| 892 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: bad argument or framing, the app's command error | **SHOWN** | - | - |
| 901 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: bad argument or framing, the app's command error | **SHOWN** | - | - |
| 906 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: bad argument or framing, the app's command error | **SHOWN** | - | - |
| 912 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: bad argument or framing, the app's command error | **SHOWN** | - | - |
| 921 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: bad argument or framing, the app's command error | **SHOWN** | - | - |
| 926 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: bad argument or framing, the app's command error | **SHOWN** | - | - |
| 928 | `pico_cmd_set` | result-code `CMD_RESULT_FAILED` | callback+user | CMD_RESULT_FAILED in the 0xF1 result byte: no controller connected, the app's command error | **SHOWN** | - | - |
| 947 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: controller tests not built in (no vendor interface), the app only offers them when identity [46] bit0 says so | **SHOWN** | - | - |
| 956 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: unknown function, the app's command error | **SHOWN** | - | - |
| 972 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: bad argument or framing, the app's command error | **SHOWN** | - | - |
| 976 | `pico_cmd_set` | checked-call `calib_set` | callback+user | mapped to CMD_RESULT_INVALID / FAILED in the 0xF1 result byte on the lines below | **SHOWN** | - | - |
| 979 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: an invalid table/curve/calibration, the app's command error | **SHOWN** | - | - |
| 981 | `pico_cmd_set` | result-code `CMD_RESULT_FAILED` | callback+user | CMD_RESULT_FAILED in the 0xF1 result byte: applied but not saved, the app's command error | **SHOWN** | - | - |
| 999 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: bad argument or framing, the app's command error | **SHOWN** | - | - |
| 1005 | `pico_cmd_set` | checked-call `curves_set` | callback+user | mapped to CMD_RESULT_INVALID / FAILED in the 0xF1 result byte on the lines below | **SHOWN** | - | - |
| 1008 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: an invalid table/curve/calibration, the app's command error | **SHOWN** | - | - |
| 1010 | `pico_cmd_set` | result-code `CMD_RESULT_FAILED` | callback+user | CMD_RESULT_FAILED in the 0xF1 result byte: applied but not saved, the app's command error | **SHOWN** | - | - |
| 1018 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: bad argument or framing, the app's command error | **SHOWN** | - | - |
| 1022 | `pico_cmd_set` | checked-call `remap_set_extra` | callback+user | mapped to CMD_RESULT_INVALID / FAILED in the 0xF1 result byte on the lines below | **SHOWN** | - | - |
| 1025 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: an invalid table/curve/calibration, the app's command error | **SHOWN** | - | - |
| 1029 | `pico_cmd_set` | result-code `CMD_RESULT_FAILED` | callback+user | CMD_RESULT_FAILED in the 0xF1 result byte: applied but not saved (fixed in this pass: said INVALID, "rejected") | **SHOWN** | - | - |
| 1038 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: bad argument or framing, the app's command error | **SHOWN** | - | - |
| 1047 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: bad argument or framing, the app's command error | **SHOWN** | - | - |
| 1053 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: bad argument or framing, the app's command error | **SHOWN** | - | - |
| 1057 | `pico_cmd_set` | checked-call `remap_set` | callback+user | mapped to CMD_RESULT_INVALID / FAILED in the 0xF1 result byte on the lines below | **SHOWN** | - | - |
| 1064 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: an invalid table/curve/calibration, the app's command error | **SHOWN** | - | - |
| 1069 | `pico_cmd_set` | result-code `CMD_RESULT_FAILED` | callback+user | CMD_RESULT_FAILED in the 0xF1 result byte: applied but not saved, the app's command error | **SHOWN** | - | - |

#### src/config.cpp

| Line | Function | Kind | Runs on | Surfaces as | Verdict | Why | Change |
|---|---|---|---|---|---|---|---|
| 41 | `config_valid` | validate `config.magic != CONFIG_MAGIC` | callback+core0-loop+user | printf | **LOGGED-OK** | a blank or old sector gets defaults; RAM then differs from flash, which the app shows as unsaved settings (identity [19] bit0) | - |
| 158 | `config_unsaved` | validate `saved->magic != CONFIG_MAGIC` | callback | nothing | **NOT-WORTH** | reads which copy to start from (no valid save yet = the RAM copy), not a failure | - |
| 168 | `config_load` | validate `config.magic != CONFIG_MAGIC` | boot | printf in config_valid | **LOGGED-OK** | first boot / erased sector, defaults are the right answer; shown as unsaved settings in the app | - |
| 172 | `config_load` | validate `legacy.magic == CONFIG_MAGIC, legacy.crc32 == calc_config_crc (legacy` | boot | printf on migration | **LOGGED-OK** | a bad legacy copy is ignored (defaults, shown as unsaved settings) | - |
| 177 | `config_load` | ignored-call `config_save` | boot | printf | **LOGGED-OK** | boot-time init save of the migrated settings: the RAM copy works now and the next boot retries the save | - |
| 202 | `write_config` | checked-call `flash_sector_write` | callback+core0-loop+user | passed up | **SHOWN** | the callers report it (0xF1 CMD_RESULT_FAILED to the app, the OLED's "Save FAIL") | - |
| 205 | `write_config` | return-fail `false` | callback+core0-loop+user | passed up | **SHOWN** | the callers report it (0xF1 CMD_RESULT_FAILED to the app, the OLED's "Save FAIL") | - |
| 212 | `write_config` | validate `verify_crc32 == con.crc32` | callback+core0-loop+user | passed up | **SHOWN** | the callers report it (0xF1 CMD_RESULT_FAILED to the app, the OLED's "Save FAIL") | - |
| 218 | `write_config` | return-fail `false` | callback+core0-loop+user | passed up | **SHOWN** | the callers report it (0xF1 CMD_RESULT_FAILED to the app, the OLED's "Save FAIL") | - |
| 222 | `config_save` | checked-call `write_config` | callback+core0-loop+user | passed up | **SHOWN** | the callers report it (0xF1 CMD_RESULT_FAILED to the app, the OLED's "Save FAIL") | - |
| 230 | `config_save_narrator` | validate `saved->magic == CONFIG_MAGIC` | core0-loop+user | nothing | **NOT-WORTH** | reads which copy to start from (no valid save yet = the RAM copy), not a failure | - |
| 237 | `config_save_narrator` | checked-call `write_config` | core0-loop+user | passed up | **SHOWN** | the callers report it (0xF1 CMD_RESULT_FAILED to the app, the OLED's "Save FAIL") | - |
| 249 | `config_save_power_flags` | return-fail `false` | core0-loop+user | CMD_RESULT_FAILED in 0xF1 (0x17 also checks the bits first and answers INVALID) | **SHOWN** | - | - |
| 254 | `config_save_power_flags` | validate `saved->magic == CONFIG_MAGIC` | core0-loop+user | nothing | **NOT-WORTH** | reads which copy to start from (no valid save yet = the RAM copy), not a failure | - |
| 260 | `config_save_power_flags` | checked-call `write_config` | core0-loop+user | passed up | **SHOWN** | the callers report it (0xF1 CMD_RESULT_FAILED to the app, the OLED's "Save FAIL") | - |

#### src/ctrl_info.cpp

| Line | Function | Kind | Runs on | Surfaces as | Verdict | Why | Change |
|---|---|---|---|---|---|---|---|
| 123 | `ctrl_test_start` | return-fail `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: a test the dongle doesn't allow, the app's command error | **SHOWN** | - | - |
| 127 | `ctrl_test_start` | return-fail `CMD_RESULT_FAILED` | callback+user | CMD_RESULT_FAILED in the 0xF1 result byte: no controller, the app's command error | **SHOWN** | - | - |
| 129 | `ctrl_test_start` | return-fail `CMD_RESULT_BUSY` | callback+user | CMD_RESULT_BUSY in the 0xF1 result byte: a test is running, the app's command error | **SHOWN** | - | - |
| 175 | `ctrl_test_task` | guard `!may_send` | core0-loop+user | nothing | **NOT-WORTH** | scheduling (test slot busy / reply taken); the request's deadline ends it as NO_ANSWER, which GET 0xEB reports and the app shows | - |
| 191 | `ctrl_test_task` | guard `take_reply (r, rn)` | core0-loop+user | nothing | **NOT-WORTH** | scheduling (test slot busy / reply taken); the request's deadline ends it as NO_ANSWER, which GET 0xEB reports and the app shows | - |

#### src/dse.cpp

| Line | Function | Kind | Runs on | Surfaces as | Verdict | Why | Change |
|---|---|---|---|---|---|---|---|
| 108 | `dse_task` | guard `!may_use_test_slot` | core0-loop+user | nothing | **NOT-WORTH** | scheduling of the Edge profile unlock/fetch (test slot busy, settle and gap timers), retried next pass | - |
| 131 | `dse_task` | guard `now - s_written_us < kSaveSettleUs \|\| !may_use_test_slot` | core0-loop+user | nothing | **NOT-WORTH** | scheduling of the Edge profile unlock/fetch (test slot busy, settle and gap timers), retried next pass | - |
| 149 | `dse_task` | guard `now - s_last_get_us < kFetchGapUs` | core0-loop+user | nothing | **NOT-WORTH** | scheduling of the Edge profile unlock/fetch (test slot busy, settle and gap timers), retried next pass | - |

#### src/flash_safe.h

| Line | Function | Kind | Runs on | Surfaces as | Verdict | Why | Change |
|---|---|---|---|---|---|---|---|
| 37 | `flash_sector_write` | checked-call `flash_safe_execute` | callback+core0-loop+user | returned false to every save (config/remap/calib/slots), which report it | **SHOWN** | counted in g_fse_fail | - |

#### src/main.cpp

| Line | Function | Kind | Runs on | Surfaces as | Verdict | Why | Change |
|---|---|---|---|---|---|---|---|
| 150 | `interrupt_loop` | checked-call `tud_hid_report` | core0-loop | printf | **LOGGED-OK** | the HID IN endpoint is busy, this input frame is skipped and the next one (~1 ms) replaces it | - |
| 178 | `interrupt_loop` | checked-call `tud_hid_report` | core0-loop | printf | **LOGGED-OK** | the HID IN endpoint is busy, this input frame is skipped and the next one (~1 ms) replaces it | - |
| 288 | `tud_hid_get_report_cb` | return-fail `0` | callback | USB STALL | **NOT-WORTH** | a zero/short GET from the host OS, which retries with the right length | - |
| 326 | `get_report_impl` | return-fail `0` | callback | USB STALL | **NOT-WORTH** | a zero/short GET from the host OS, which retries with the right length | - |
| 346 | `get_report_impl` | return-fail `0` | callback | USB STALL | **NOT-WORTH** | a zero/short GET from the host OS, which retries with the right length | - |
| 364 | `get_report_impl` | return-fail `0` | callback | USB STALL on purpose: the app's controller test owns 0x81 for a few seconds | **NOT-WORTH** | PC tools retry | - |
| 372 | `get_report_impl` | return-fail `0` | callback | USB STALL on purpose until the Edge profiles are cached (PS Accessories retries) | **NOT-WORTH** | the read is started here | - |
| 432 | `__wrap_flash_safe_execute` | counter `g_fse_fail` | - | counter g_fse_fail (OLED Diag) | **LOGGED-OK** | the failed write itself is reported by its caller | - |
| 440 | `host_out02_forward` | return-fail `false` | callback | nothing | **NOT-WORTH** | a malformed/short host report isn't forwarded (counted only when forwarded, g_host_out02_to_bt); games send well-formed ones every frame | - |
| 445 | `host_out02_forward` | return-fail `false` | callback | nothing | **NOT-WORTH** | a malformed/short host report isn't forwarded (counted only when forwarded, g_host_out02_to_bt); games send well-formed ones every frame | - |
| 511 | `tud_hid_set_report_cb` | checked-call `host_out02_forward` | callback | nothing | **NOT-WORTH** | a malformed/short host report isn't forwarded (counted only when forwarded, g_host_out02_to_bt); games send well-formed ones every frame | - |
| 555 | `main` | ignored-call `tusb_init` | boot | boot: TinyUSB init with a fixed, valid config | **NOT-WORTH** | failure would leave no USB device at all (no app to tell), the OLED still runs | - |
| 560 | `main` | ignored-call `tud_disconnect` | boot | nothing | **NOT-WORTH** | boot: disconnect of a device that was just initialized | - |
| 576 | `main` | checked-call `cyw43_arch_init` | boot | printf and main() returns: no radio, nothing can run | **LOGGED-OK** | the board shows no OLED/USB activity, a hardware fault | - |

#### src/mic_level.h

| Line | Function | Kind | Runs on | Surfaces as | Verdict | Why | Change |
|---|---|---|---|---|---|---|---|
| 72 | `MicLevel::drop` | return-fail `false` | core0-loop | not a failure: false = keep this frame (no excess) | **NOT-WORTH** | - | - |
| 74 | `MicLevel::drop` | return-fail `false` | core0-loop | not a failure: false = keep this loud frame, wait for a quiet one | **NOT-WORTH** | - | - |
| 77 | `MicLevel::drop` | counter `drops` | core0-loop | counter (0xFD [44..47], scripts/mic_diag.sh bt-trace) | **LOGGED-OK** | a drop is the level control working, not an error the user acts on | - |

#### src/oled.cpp

| Line | Function | Kind | Runs on | Surfaces as | Verdict | Why | Change |
|---|---|---|---|---|---|---|---|
| 647 | `handle_buttons` | guard `ev == 0` | core0-loop+user | nothing | **NOT-WORTH** | no key event this pass (polling, not a failure) | - |
| 656 | `handle_buttons` | ignored-call `bt_pair_now` | core0-loop+user | false only with a controller connected, which pair_hold already excludes | **NOT-WORTH** | - | - |
| 676 | `handle_buttons` | checked-call `config_save` | core0-loop+user | OLED status line "Bright: Save FAIL" on whichever screen is up (error pass F1 | **SHOWN** | was SILENT-BUG) | - |
| 901 | `render_screen` | checked-call `bt_any_slot_paired` | core0-loop | not a failure: false = every slot is empty, the screen says "No DualSense paired" | **NOT-WORTH** | - | - |
| 1591 | `lightbar_save_config` | checked-call `config_save` | core0-loop | OLED status line "Lightbar: Save FAIL" on the screen it left for (error pass F1 | **SHOWN** | was SILENT-BUG) | - |
| 1625 | `settings_adjust` | guard `it.kind == SK_ACTION` | core0-loop+user | Reset/Wipe have no editable value | **NOT-WORTH** | Triangle runs the action | - |
| 1691 | `settings_handle_input` | checked-call `config_save` | core0-loop+user | OLED footer "Reset FAIL" / "Save FAIL" | **SHOWN** | - | - |
| 1702 | `settings_handle_input` | checked-call `bt_wipe_all_slots` | core0-loop+user | OLED footer "Wipe FAIL" (fixed in this pass: always said "Slots wiped!") | **SHOWN** | - | - |
| 1710 | `settings_handle_input` | checked-call `config_save` | core0-loop+user | OLED footer "Reset FAIL" / "Save FAIL" | **SHOWN** | - | - |
| 1814 | `slots_handle_input` | checked-call `bt_set_slot` | core0-loop+user | OLED Slots status "Save FAIL" / "Wipe FAIL" (fixed in this pass: always said done) | **SHOWN** | - | - |
| 1830 | `slots_handle_input` | checked-call `bt_forget_slot` | core0-loop+user | OLED Slots status "Save FAIL" / "Wipe FAIL" (fixed in this pass: always said done) | **SHOWN** | - | - |
| 1938 | `oled_key_inject` | checked-call `push` | core0-loop+user | CMD_RESULT_BUSY in the 0xF1 result byte (cmd.cpp 0x18): four presses already waiting | **SHOWN** | - | - |
| 1943 | `oled_pad_inject` | checked-call `push` | core0-loop+user | CMD_RESULT_BUSY in the 0xF1 result byte (cmd.cpp 0x19): four presses already waiting | **SHOWN** | - | - |

#### src/oled_keys.h

| Line | Function | Kind | Runs on | Surfaces as | Verdict | Why | Change |
|---|---|---|---|---|---|---|---|
| 114 | `push` | return-fail `false` | core0-loop+user | CMD_RESULT_BUSY in the 0xF1 result byte (cmd.cpp 0x18): four presses already waiting | **SHOWN** | - | - |

#### src/oled_vpad.h

| Line | Function | Kind | Runs on | Surfaces as | Verdict | Why | Change |
|---|---|---|---|---|---|---|---|
| 53 | `hold_us` | return-fail `false` | core0-loop+user | CMD_RESULT_INVALID in the 0xF1 result byte (cmd.cpp refuses a hold over kMaxHoldMs at the SET) | **SHOWN** | - | - |
| 73 | `push` | checked-call `hold_us` | core0-loop+user | CMD_RESULT_INVALID in the 0xF1 result byte (cmd.cpp checks the same range first) | **SHOWN** | - | - |
| 73 | `push` | return-fail `false` | core0-loop+user | CMD_RESULT_INVALID in the 0xF1 result byte (cmd.cpp checks the same range first) | **SHOWN** | - | - |
| 75 | `push` | return-fail `false` | core0-loop+user | CMD_RESULT_BUSY in the 0xF1 result byte (cmd.cpp 0x19): four presses already waiting | **SHOWN** | - | - |

#### src/remap.cpp

| Line | Function | Kind | Runs on | Surfaces as | Verdict | Why | Change |
|---|---|---|---|---|---|---|---|
| 86 | `flash_extra` | validate `f->magic == REMAP_MAGIC` | callback+user | nothing | **NOT-WORTH** | picks the saved copy when it's valid, else the identity default (not a failure) | - |
| 110 | `save_with` | checked-call `flash_sector_write` | callback+user | passed up as NotSaved: CMD_RESULT_FAILED in 0xF1, the app's command error | **SHOWN** | - | - |
| 113 | `save_with` | return-fail `false` | callback+user | passed up as NotSaved: CMD_RESULT_FAILED in 0xF1, the app's command error | **SHOWN** | - | - |
| 124 | `save_with` | return-fail `false` | callback+user | passed up as NotSaved: CMD_RESULT_FAILED in 0xF1, the app's command error | **SHOWN** | - | - |
| 128 | `save_to_flash` | checked-call `save_with` | callback+user | passed up as NotSaved: CMD_RESULT_FAILED in 0xF1, the app's command error | **SHOWN** | - | - |
| 157 | `remap_load` | validate `g_remap.magic != REMAP_MAGIC` | boot | printf | **LOGGED-OK** | a blank/invalid remap sector means no remap (identity), the app shows the default layout | - |
| 163 | `remap_load` | ignored-call `save_to_flash` | boot | printf | **LOGGED-OK** | boot-time init save of a blank sector: the RAM copy works now and the next boot retries the save | - |
| 187 | `remap_revert` | validate `saved->magic == REMAP_MAGIC` | callback+user | nothing | **NOT-WORTH** | picks the saved copy when it's valid, else the identity default (not a failure) | - |
| 200 | `remap_set_extra` | return-fail `RemapSet::Invalid` | callback+user | CMD_RESULT_INVALID in 0xF1, the app's command error | **SHOWN** | - | - |
| 215 | `remap_set_extra` | validate `f->magic == REMAP_MAGIC` | callback+user | nothing | **NOT-WORTH** | picks the saved copy when it's valid, else the identity default (not a failure) | - |
| 219 | `remap_set_extra` | checked-call `save_with` | callback+user | passed up as NotSaved: CMD_RESULT_FAILED in 0xF1, the app's command error | **SHOWN** | - | - |
| 219 | `remap_set_extra` | return-fail `save_with (saved_table, g_remap.extra) ? RemapSet::Ok : RemapSet::NotSaved` | callback+user | passed up as NotSaved: CMD_RESULT_FAILED in 0xF1, the app's command error | **SHOWN** | - | - |
| 222 | `remap_set_extra` | checked-call `save_to_flash` | callback+user | passed up as NotSaved: CMD_RESULT_FAILED in 0xF1, the app's command error | **SHOWN** | - | - |
| 222 | `remap_set_extra` | return-fail `save_to_flash () ? RemapSet::Ok : RemapSet::NotSaved` | callback+user | passed up as NotSaved: CMD_RESULT_FAILED in 0xF1, the app's command error | **SHOWN** | - | - |
| 229 | `remap_set` | return-fail `RemapSet::Invalid` | callback+user | CMD_RESULT_INVALID in 0xF1, the app's command error | **SHOWN** | - | - |
| 238 | `remap_set` | checked-call `save_to_flash` | callback+user | NotSaved: CMD_RESULT_FAILED in 0xF1, the app's command error | **SHOWN** | - | - |
| 238 | `remap_set` | return-fail `save_to_flash () ? RemapSet::Ok : RemapSet::NotSaved` | callback+user | NotSaved: CMD_RESULT_FAILED in 0xF1, the app's command error | **SHOWN** | - | - |

#### src/scan_policy.h

| Line | Function | Kind | Runs on | Surfaces as | Verdict | Why | Change |
|---|---|---|---|---|---|---|---|
| 79 | `ScanPolicy::again` | return-fail `false` | callback+core0-loop | not a failure: false = the pairing window is over, stop scanning | **NOT-WORTH** | - | - |

#### src/slots.cpp

| Line | Function | Kind | Runs on | Surfaces as | Verdict | Why | Change |
|---|---|---|---|---|---|---|---|
| 37 | `save_slots_to_flash` | checked-call `flash_sector_write` | callback+core0-loop+user | printf + returned to the slot changes, which report it (0xF1 CMD_RESULT_FAILED, the OLED's "Save FAIL"/"Wipe FAIL") | **SHOWN** | - | - |
| 40 | `save_slots_to_flash` | return-fail `false` | callback+core0-loop+user | printf + returned to the slot changes, which report it (0xF1 CMD_RESULT_FAILED, the OLED's "Save FAIL"/"Wipe FAIL") | **SHOWN** | - | - |
| 51 | `save_slots_to_flash` | return-fail `false` | callback+core0-loop+user | printf + returned to the slot changes, which report it (0xF1 CMD_RESULT_FAILED, the OLED's "Save FAIL"/"Wipe FAIL") | **SHOWN** | - | - |
| 57 | `slots_load` | validate `g_slots.magic != SLOTS_MAGIC` | boot | printf | **LOGGED-OK** | first boot / erased sector: no paired controllers, which the app and OLED show as empty slots | - |
| 62 | `slots_load` | ignored-call `save_slots_to_flash` | boot | printf | **LOGGED-OK** | boot-time init save of a blank sector: the RAM copy works now and the next boot retries the save | - |
| 95 | `slot_owner_of` | return-fail `- 1` | callback+core0-loop+user | nothing | **NOT-WORTH** | -1 = no slot owns this address (a lookup), not an error | - |
| 106 | `slot_assign` | return-fail `false` | callback | false for a slot outside 0..3 | **NOT-WORTH** | every caller passes a checked slot | - |
| 110 | `slot_assign` | checked-call `save_slots_to_flash` | callback | returned: the callers report a failed save (fixed in this pass: was dropped) | **SHOWN** | - | - |
| 115 | `slot_forget` | return-fail `false` | core0-loop+user | false for a slot outside 0..3 | **NOT-WORTH** | every caller passes a checked slot | - |
| 119 | `slot_forget` | checked-call `save_slots_to_flash` | core0-loop+user | returned: the callers report a failed save (fixed in this pass: was dropped) | **SHOWN** | - | - |
| 129 | `slots_wipe_all` | checked-call `save_slots_to_flash` | core0-loop+user | returned: the callers report a failed save (fixed in this pass: was dropped) | **SHOWN** | - | - |

#### src/stick_curve.h

| Line | Function | Kind | Runs on | Surfaces as | Verdict | Why | Change |
|---|---|---|---|---|---|---|---|
| 108 | `stick_curve_build` | guard `!stick_curve_valid (c) \|\| c.type == kCurveLinear` | callback+user | nothing | **NOT-WORTH** | an invalid curve is never stored (curves_set answers INVALID first) and Linear needs no nodes | - |

#### src/usb.cpp

| Line | Function | Kind | Runs on | Surfaces as | Verdict | Why | Change |
|---|---|---|---|---|---|---|---|
| 75 | `audio10_set_req_entity` | return-fail `false` | callback | USB STALL: the host asked for an audio control we don't have | **NOT-WORTH** | that's USB's answer, the OS moves on | - |
| 116 | `audio10_set_req_entity` | return-fail `false` | callback | USB STALL: the host asked for an audio control we don't have | **NOT-WORTH** | that's USB's answer, the OS moves on | - |
| 123 | `audio10_set_req_entity` | return-fail `false` | callback | USB STALL: the host asked for an audio control we don't have | **NOT-WORTH** | that's USB's answer, the OS moves on | - |
| 128 | `audio10_set_req_entity` | return-fail `false` | callback | USB STALL: the host asked for an audio control we don't have | **NOT-WORTH** | that's USB's answer, the OS moves on | - |
| 145 | `audio10_get_req_entity` | checked-call `tud_audio_buffer_and_schedule_control_xfer` | callback | returned to TinyUSB (STALL on failure) | **NOT-WORTH** | a 1-2 byte reply into TinyUSB's control buffer can't fail | - |
| 158 | `audio10_get_req_entity` | checked-call `tud_audio_buffer_and_schedule_control_xfer` | callback | returned to TinyUSB (STALL on failure) | **NOT-WORTH** | a 1-2 byte reply into TinyUSB's control buffer can't fail | - |
| 172 | `audio10_get_req_entity` | checked-call `tud_audio_buffer_and_schedule_control_xfer` | callback | returned to TinyUSB (STALL on failure) | **NOT-WORTH** | a 1-2 byte reply into TinyUSB's control buffer can't fail | - |
| 186 | `audio10_get_req_entity` | checked-call `tud_audio_buffer_and_schedule_control_xfer` | callback | returned to TinyUSB (STALL on failure) | **NOT-WORTH** | a 1-2 byte reply into TinyUSB's control buffer can't fail | - |
| 200 | `audio10_get_req_entity` | checked-call `tud_audio_buffer_and_schedule_control_xfer` | callback | returned to TinyUSB (STALL on failure) | **NOT-WORTH** | a 1-2 byte reply into TinyUSB's control buffer can't fail | - |
| 231 | `tud_audio_set_req_entity_cb` | checked-call `audio10_set_req_entity` | callback | USB STALL: the host asked for an audio control we don't have | **NOT-WORTH** | that's USB's answer, the OS moves on | - |

#### src/usb_descriptors.cpp

| Line | Function | Kind | Runs on | Surfaces as | Verdict | Why | Change |
|---|---|---|---|---|---|---|---|
| 979 | `tud_descriptor_string_cb` | return-fail `nullptr` | callback | USB STALL for a string index we don't have (incl. 0xEE) | **NOT-WORTH** | the OS asks for it and expects that | - |
| 1048 | `tud_descriptor_string_cb` | return-fail `NULL` | callback | USB STALL for a string index we don't have (incl. 0xEE) | **NOT-WORTH** | the OS asks for it and expects that | - |

#### src/usb_power.cpp

| Line | Function | Kind | Runs on | Surfaces as | Verdict | Why | Change |
|---|---|---|---|---|---|---|---|
| 55 | `detach` | ignored-call `tud_disconnect` | callback+core0-loop+user | nothing | **NOT-WORTH** | tud_connect/disconnect only fail on a port without D+ pull-up control, which the RP2350 has | - |
| 63 | `attach` | ignored-call `tud_connect` | callback+core0-loop+user | nothing | **NOT-WORTH** | tud_connect/disconnect only fail on a port without D+ pull-up control, which the RP2350 has | - |
| 83 | `send_key` | checked-call `tud_hid_n_report` | core0-loop | nothing | **NOT-WORTH** | the wake state machine (usb_power.h) only sends when the endpoint is ready (hid_ready) and presses the key kKeyPresses times | - |
| 106 | `usb_power_reconnect` | guard `s_attach_pending` | callback+user | nothing | **NOT-WORTH** | a reconnect is already under way (0xF6 0x03 asked twice) | - |
| 112 | `usb_power_reconnect` | ignored-call `tud_connect` | callback+user | nothing | **NOT-WORTH** | tud_connect/disconnect only fail on a port without D+ pull-up control, which the RP2350 has | - |
| 138 | `usb_power_task` | ignored-call `bt_disconnect` | core0-loop | nothing | **NOT-WORTH** | false only when there is no ACL, i.e. already disconnected | - |
| 142 | `usb_power_task` | checked-call `tud_remote_wakeup` | core0-loop | printf of the result | **LOGGED-OK** | the PC didn't allow remote wakeup, the F15 key path follows | - |
| 149 | `usb_power_task` | ignored-call `send_key` | core0-loop | nothing | **NOT-WORTH** | the wake state machine (usb_power.h) only sends when the endpoint is ready (hid_ready) and presses the key kKeyPresses times | - |
| 153 | `usb_power_task` | ignored-call `send_key` | core0-loop | nothing | **NOT-WORTH** | the wake state machine (usb_power.h) only sends when the endpoint is ready (hid_ready) and presses the key kKeyPresses times | - |

#### src/vendor_itf.cpp

| Line | Function | Kind | Runs on | Surfaces as | Verdict | Why | Change |
|---|---|---|---|---|---|---|---|
| 49 | `vi_control` | return-fail `false` | callback | USB STALL for a request this interface doesn't take (wrong direction/recipient/id) | **NOT-WORTH** | the app only sends the documented ones and its transport reports a STALL as an error | - |
| 150 | `tud_vendor_control_xfer_cb` | return-fail `false` | callback | USB STALL for a request this interface doesn't take (wrong direction/recipient/id) | **NOT-WORTH** | the app only sends the documented ones and its transport reports a STALL as an error | - |
| 156 | `tud_vendor_control_xfer_cb` | checked-call `tud_control_xfer` | callback | returned to TinyUSB (STALL on failure) | **NOT-WORTH** | queueing a ≤ 64-byte reply on endpoint 0 can't fail | - |
| 162 | `tud_vendor_control_xfer_cb` | checked-call `tud_control_xfer` | callback | returned to TinyUSB (STALL on failure) | **NOT-WORTH** | queueing a ≤ 64-byte reply on endpoint 0 can't fail | - |
| 166 | `tud_vendor_control_xfer_cb` | return-fail `false` | callback | USB STALL for a request this interface doesn't take (wrong direction/recipient/id) | **NOT-WORTH** | the app only sends the documented ones and its transport reports a STALL as an error | - |
| 172 | `tud_vendor_control_xfer_cb` | return-fail `false` | callback | USB STALL for a request this interface doesn't take (wrong direction/recipient/id) | **NOT-WORTH** | the app only sends the documented ones and its transport reports a STALL as an error | - |
| 177 | `tud_vendor_control_xfer_cb` | return-fail `false` | callback | USB STALL for a request this interface doesn't take (wrong direction/recipient/id) | **NOT-WORTH** | the app only sends the documented ones and its transport reports a STALL as an error | - |
| 181 | `tud_vendor_control_xfer_cb` | checked-call `tud_control_xfer` | callback | returned to TinyUSB (STALL on failure) | **NOT-WORTH** | queueing a ≤ 64-byte reply on endpoint 0 can't fail | - |
| 187 | `tud_vendor_control_xfer_cb` | return-fail `false` | callback | USB STALL for a request this interface doesn't take (wrong direction/recipient/id) | **NOT-WORTH** | the app only sends the documented ones and its transport reports a STALL as an error | - |
| 193 | `tud_vendor_control_xfer_cb` | checked-call `tud_control_xfer` | callback | returned to TinyUSB (STALL on failure) | **NOT-WORTH** | queueing a ≤ 64-byte reply on endpoint 0 can't fail | - |
| 199 | `tud_vendor_control_xfer_cb` | return-fail `false` | callback | USB STALL for a request this interface doesn't take (wrong direction/recipient/id) | **NOT-WORTH** | the app only sends the documented ones and its transport reports a STALL as an error | - |
| 201 | `tud_vendor_control_xfer_cb` | return-fail `false` | callback | USB STALL for a request this interface doesn't take (wrong direction/recipient/id) | **NOT-WORTH** | the app only sends the documented ones and its transport reports a STALL as an error | - |
| 211 | `tud_vendor_control_xfer_cb` | checked-call `tud_control_xfer` | callback | returned to TinyUSB (STALL on failure) | **NOT-WORTH** | queueing a ≤ 64-byte reply on endpoint 0 can't fail | - |
| 218 | `tud_vendor_control_xfer_cb` | checked-call `tud_control_xfer` | callback | returned to TinyUSB (STALL on failure) | **NOT-WORTH** | queueing a ≤ 64-byte reply on endpoint 0 can't fail | - |
| 229 | `tud_vendor_control_xfer_cb` | return-fail `false` | callback | USB STALL for a request this interface doesn't take (wrong direction/recipient/id) | **NOT-WORTH** | the app only sends the documented ones and its transport reports a STALL as an error | - |

#### src/voice.cpp

| Line | Function | Kind | Runs on | Surfaces as | Verdict | Why | Change |
|---|---|---|---|---|---|---|---|
| 77 | `voice_say_lang` | guard `line >= VOICE_NUM_LINES \|\| lang >= kVoiceNumLangs \|\| !bt_is_` | callback+core0-loop+user | the app's 0x0C preview is refused first with CMD_RESULT_INVALID/FAILED (bad line, no controller) | **SHOWN** | a broken bank (bank_ok) is a build defect the voice tests catch | - |
| 84 | `voice_say_lang` | guard `offset >= (uint32_t) (voice_bank_end - voice_bank) \|\| frames` | callback+core0-loop+user | nothing | **NOT-WORTH** | an empty/out-of-range entry is a build defect of voice_bank.bin, checked by tools/build_voice_bank.py | - |
| 132 | `take_one` | checked-call `opus_packet_pad` | core0-loop | the frame is zeroed (silence) | **NOT-WORTH** | padding a valid packet to a larger size can't fail | - |
| 189 | `voice_task` | ignored-call `bt_disconnect` | core0-loop | nothing | **NOT-WORTH** | false only when there is no ACL, i.e. already disconnected | - |
