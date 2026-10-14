# Error pass: every error a user's action can hit, with a verdict

_2026-10-13. Done per CLAUDE.md "Error pass". This is the one doc for both repos: the firmware's CLAUDE.md links here. It was done because an action failed silently three times in one day: Apply was refused by the IPC id check and showed no message; the main process refused to write while Heroic ran and the page showed nothing; "Stop checking" made the library disappear without warning. Every silent failure found in a user action is fixed on this branch, with a test. What's left is in batches E1 to E3 (app) and F1 (firmware)._

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
| SHOWN | the user sees a plain message. The reason cites the en.json key, or `english:` for text that isn't translated yet (batch E3) |
| LOGGED-OK | logged, with the reason the user needn't see it |
| SILENT-BUG | a user action fails with nothing shown (fixed here, or in a batch) |
| SWALLOWED | the error is discarded without a reason (fixed here, or in a batch) |
| FLOATING | an unhandled promise |
| NOT-WORTH | cannot fail in practice, or the "failure" is the expected answer that the caller shows as a state (a launcher folder that isn't there is "not installed") |
| PASSES-ON | not a handling point: the error goes on to the caller, whose row has the verdict |

PASSES-ON closes mechanically. Every promise the app creates ends at one of: a catch, a `.catch` / `.then` handler, a `void`, or a floating statement. All of those are rows with their own verdicts, and the gate forbids FLOATING.

**Firmware** (`tools/list_errors.py`): see [Firmware](#firmware-marcelinevpqds5dongle-oled-edition) below.

## Counts

### App (`MarcelineVPQ/DS5Dongle-OLED-Config-Web`): 520 rows

| Kind | SHOWN | LOGGED-OK | SILENT-BUG | SWALLOWED | FLOATING | NOT-WORTH | PASSES-ON | Total |
|---|---|---|---|---|---|---|---|---|
| catch | 43 | 3 | 1 | 1 | 0 | 95 | 11 | 154 |
| .catch | 34 | 57 | 0 | 0 | 0 | 13 | 1 | 105 |
| .then-reject | 6 | 5 | 0 | 0 | 0 | 6 | 0 | 17 |
| void | 7 | 25 | 0 | 0 | 0 | 4 | 0 | 36 |
| floating | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| ipc-handler | 0 | 3 | 0 | 0 | 0 | 2 | 33 | 38 |
| ipc-call | 29 | 19 | 0 | 0 | 0 | 3 | 13 | 64 |
| schema | 2 | 3 | 0 | 0 | 0 | 3 | 3 | 11 |
| spawn | 6 | 0 | 0 | 0 | 0 | 14 | 8 | 28 |
| fetch | 0 | 0 | 0 | 0 | 0 | 0 | 9 | 9 |
| json-parse | 0 | 0 | 0 | 0 | 0 | 6 | 7 | 13 |
| result-field | 43 | 0 | 0 | 0 | 0 | 2 | 0 | 45 |
| **Total** | **170** | **115** | **1** | **1** | **0** | **148** | **85** | **520** |

Electron main process 229 rows, renderer 291. How each verdict was reached: 284 by a comment, 62 from `logged()`, 15 from `shown()`, 12 from a rethrow, 33 IPC handlers that pass a throw to the page, and 114 by following the call to where its error lands.

**As found, before the fixes.** ESLint's `no-floating-promises` (with `void` not exempt) flagged **95 floating promises**, all behind `void`, with no handler. There were **23 silent failures** in user actions. 22 are fixed below, and 1 is left (E1). There were **6 swallowed errors**: BusyButton and Toggle dropped every rejection with "the caller reports its own errors" (several callers didn't), and the main process dropped three malformed IPC sends without a log. 5 are fixed, and 1 is left (E2). There was also **1 raw message**: board results read "Command 0x04 failed".

### Firmware: 253 rows

SHOWN 89, LOGGED-OK 42, SILENT-BUG 3 (batch F1), SWALLOWED 0, NOT-WORTH 119. The per-kind table is below, under Firmware.

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
  - a SHOWN reason that doesn't start with an en.json key that exists (or `english:`);
  - a FLOATING / SILENT-BUG / SWALLOWED row that doesn't name its batch "(batch E<n>)".

  So every catch block either shows, rethrows, or says why not. Every `.catch` handler too.
- **Firmware**: `python3 tools/list_errors.py --check` in `build.yml` and `release.yml`.

## Batches (not done; the owner picks)

| Batch | Rows | Verdict | Change |
|---|---|---|---|
| **E1**: a damaged game library says so | `electron/main/games/libraryStore.ts` `readLibrary`/`load` | SILENT-BUG | A library file that fails to parse is moved aside (`library.json.bad-<time>`) and the app starts empty: every profile and layout seems gone, with no word. Return a "recovered" flag with `libraryGet`, and show it once in the notice, with where the old file is. |
| **E2**: History lists a damaged backup | `electron/main/games/backup.ts` `list` | SWALLOWED | A backup whose manifest can't be read is left out of History, so its Undo disappears. List it as damaged (with its folder) instead. |
| **E3**: translate the English text that reaches the user | 43 rows whose verdict says `english:` / `main-english:` | SHOWN (English) | Main-process messages (USB setup, Windows repair, Proton install, Undo errors, scan errors, the start-failure dialog) and board/flash errors from the protocol code (`bridgeClient`, `firmwareUpdate`) are plain English. Give them keys with parameters, as `games.msg.*` already does. |
| **F1** (firmware): a status line on every OLED screen | `oled.cpp` long-press brightness save, `lightbar_save_config`, `bt.cpp` `slot_assign` after pairing | SILENT-BUG ×3 | See Firmware. |

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
| 29 | `portalAccent > <anonymous>` | spawn | `execFile("gdbus")` | **NOT-WORTH** | no portal or no gdbus answers null: the Desktop theme keeps the app's own accent (nothing the user started) |
| 58 | `readDesktopPalette` | catch | `fallback: readFileSync` | **NOT-WORTH** | no readable kdeglobals: no desktop palette, the app's own colors stay |
| 86 | `watchDesktopPalette` | catch | `fallback` | **NOT-WORTH** | no KDE config folder to watch: an accent change is picked up at the next start |

#### electron/main/download.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 29 | `downloadBytes` | fetch | `net.fetch` | **PASSES-ON** | awaited: the caller of downloadBytes handles it _(flow)_ |
| 40 | `downloadVerified` | .catch | `(cause: unknown) => { throw cause instanceof Error && cause.` | **PASSES-ON** | the handler rethrows _(rethrow)_ |
| 40 | `downloadVerified` | fetch | `net.fetch` | **PASSES-ON** | the handler rethrows _(via .catch L40)_ |
| 56 | `downloadVerified` | .catch | `() => undefined` | **NOT-WORTH** | only marks the write-error promise handled; the same rejection is awaited through Promise.race below and rethrown |
| 77 | `downloadVerified` | catch | `rethrow` | **NOT-WORTH** | cleanup while the real error is rethrown below; a failed cancel adds nothing |
| 80 | `downloadVerified` | .catch | `() => undefined` | **NOT-WORTH** | cleanup while the real error is rethrown below; a failed cancel adds nothing |
| 80 | `downloadVerified` | void | `reader.cancel().catch(() => undefined)` | **NOT-WORTH** | cleanup while the real error is rethrown below; a failed cancel adds nothing |

#### electron/main/feedSignature.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 23 | `feedSignedBy` | catch | `fallback` | **NOT-WORTH** | a key that can't be read verifies nothing: the update is refused as unsigned, which the banner says |

#### electron/main/firmwareSource.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 33 | `readBundled` | json-parse | `readFileSync(join(dir, "firmware.json"),` | **NOT-WORTH** | development builds have no bundled firmware: the published one is used _(via catch L35)_ |
| 33 | `readBundled` | schema | `BundleInfo.parse` | **NOT-WORTH** | development builds have no bundled firmware: the published one is used _(via catch L35)_ |
| 35 | `readBundled` | catch | `fallback: zod.parse, JSON.parse, readFileSync` | **NOT-WORTH** | development builds have no bundled firmware: the published one is used |
| 63 | `<module>` | result-field | `FirmwareSourceDeps.manifest.problem: FirmwareLookup["problem"]` | **SHOWN** | desktop.firmware.offline (FirmwarePage: unpublished / offline under Latest, checkedNone / checkedOffline after Check now) |
| 82 | `firmwareFeed > <anonymous>` | catch | `fallback` | **SHOWN** | desktop.firmware.offline (problem "unpublished" / "offline" on the Firmware card; the last feed fetched answers when offline) |
| 118 | `firmwareBytes` | catch | `rethrow` | **PASSES-ON** | rethrows to the caller _(rethrow)_ |

#### electron/main/games/appinfo.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 132 | `parseAppTypes` | catch | `empty` | **NOT-WORTH** | damaged entry: keep what was read |
| 142 | `steamAppTypes` | catch | `fallback: readFileSync` | **NOT-WORTH** | no appinfo.vdf: app types unknown, so every Steam entry is listed as a game |

#### electron/main/games/artRequest.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 17 | `artRequestTarget` | catch | `fallback: new URL` | **NOT-WORTH** | a malformed art URL answers 404: the tile keeps its placeholder |
| 24 | `artRequestTarget` | schema | `GameKeySchema.safeParse` | **NOT-WORTH** | a key that isn't a game key answers 404 (the page only asks for keys from the scan) |

#### electron/main/games/backup.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 103 | `target` | catch | `fallback` | **NOT-WORTH** | no real path (a new file): the path itself is used |
| 116 | `writeFileAtomic` | catch | `empty: statSync` | **NOT-WORTH** | new file |
| 128 | `writeFileAtomic` | catch | `rethrow: openSync, renameSync` | **PASSES-ON** | rethrows to the caller _(rethrow)_ |
| 152 | `isLink` | catch | `fallback: lstatSync` | **NOT-WORTH** | a missing path is not a link |
| 191 | `run` | catch | `rethrow` | **PASSES-ON** | rethrows to the caller _(rethrow)_ |
| 198 | `run` | catch | `rethrow` | **PASSES-ON** | rethrows to the caller _(rethrow)_ |
| 206 | `run` | catch | `empty` | **NOT-WORTH** | the change is made and its originals are saved; without the hashes Undo only can't detect later edits (next lines) |
| 246 | `list` | catch | `fallback: readdirSync` | **NOT-WORTH** | no backup folder yet: History lists nothing, which is true |
| 258 | `list` | catch | `fallback` | **SWALLOWED** | a backup whose manifest can't be read is left out of History, so its Undo silently disappears; list it as damaged instead (batch E2) |
| 267 | `manifest` | json-parse | `readFileSync(join(this.dir, id, "manifes` | **PASSES-ON** | throws to the caller: the caller of manifest handles it _(flow)_ |
| 267 | `manifest` | schema | `ManifestSchema.parse` | **PASSES-ON** | returned: the caller of manifest handles it _(flow)_ |
| 289 | `prune` | catch | `fallback` | **NOT-WORTH** | an unreadable backup is left for the user to inspect, not pruned (History: batch E2) |

#### electron/main/games/details.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 94 | `note` | catch | `fallback: statSync` | **NOT-WORTH** | the file went away between listing and stat: that art is skipped |
| 111 | `steamArt` | catch | `empty: readdirSync` | **NOT-WORTH** | no per-app folder |
| 200 | `lutrisDetails` | catch | `fallback` | **NOT-WORTH** | no readable Lutris database: no Lutris art or play time (the tile keeps its placeholder) |

#### electron/main/games/files.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 8 | `readParsed` | catch | `fallback: readFileSync` | **NOT-WORTH** | readParsed's contract: a missing or broken file reads as null, which each caller treats as "not set up" |

#### electron/main/games/games.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 898 | `launchersToRestart` | result-field | `launchersToRestart.blockedBy: LauncherId[]` | **SHOWN** | desktop.games.restartGameRunning (useRestartText names the launcher: restartGameRunning / restartTimeout / restartFailed / launcherStarted; Apply and Undo on Home and the game page) |
| 976 | `writeChosen` | catch | `fallback` | **SHOWN** | desktop.games.msg.result.restartFailed (or volumeFailed / profileFailed, on the change's row in the Done list) |
| 1004 | `writeEdits` | json-parse | `text` | **PASSES-ON** | throws to the caller: the caller of writeEdits handles it _(flow)_ |

#### electron/main/games/hdr.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 102 | `findOnPath` | catch | `empty: statSync` | **NOT-WORTH** | not here |
| 127 | `hasLayer` | catch | `fallback: readdirSync` | **NOT-WORTH** | no layer folder: the HDR checklist shows the layer as missing |
| 152 | `screens` | catch | `fallback` | **SHOWN** | desktop.hdrCheck.screen.failed (check "failed" on the HDR checklist) |
| 163 | `gamescopeVersion` | catch | `fallback` | **NOT-WORTH** | Older builds without --version print their usage and fail. |

#### electron/main/games/libraryStore.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 27 | `readLibrary` | json-parse | `readFileSync(path, "utf8")` | **PASSES-ON** | a file that doesn't fit reads as null like a broken one; the catch below has the verdict |
| 27 | `readLibrary` | schema | `LibraryFileSchema.safeParse` | **PASSES-ON** | a file that doesn't fit reads as null like a broken one; the catch below has the verdict |
| 29 | `readLibrary` | catch | `fallback: zod.safeParse, JSON.parse, readFileSync` | **SILENT-BUG** | a damaged library file is moved aside (.bad-<time>) and the app starts with an empty library: every game profile and layout seems gone with no word why (batch E1) |
| 53 | `load` | catch | `empty: renameSync` | **NOT-WORTH** | can't move it; it gets overwritten on the next save |
| 64 | `load` | catch | `empty` | **NOT-WORTH** | can't write it now; the next save tries again |

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
| 224 | `run` | spawn | `execFile(cmd)` | **SHOWN** | desktop.games.restartTimeout (a quit request that fails leaves the launcher running, which the close then reports) |
| 229 | `signal` | catch | `empty` | **NOT-WORTH** | already gone |
| 251 | `steamReportsGame > <anonymous>` | spawn | `execFile(system32("reg.exe"))` | **NOT-WORTH** | no answer from reg.exe reads as "Steam reports no game"; the process list is checked too |
| 273 | `run` | spawn | `execFile(cmd)` | **SHOWN** | desktop.games.restartTimeout (a quit request that fails leaves the launcher running, which the close then reports) |
| 276 | `signal` | spawn | `execFile(system32("taskkill.exe"))` | **SHOWN** | desktop.games.restartTimeout (a taskkill that fails leaves the launcher running, which the close then reports) |

#### electron/main/games/proton.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 64 | `protonBuilds` | catch | `fallback: readdirSync` | **NOT-WORTH** | no tools folder: no builds |
| 110 | `buildVersion` | catch | `empty: readFileSync` | **NOT-WORTH** | not in this folder |
| 160 | `freeBytes` | catch | `fallback` | **NOT-WORTH** | free space unknown: the install goes ahead, and a full disk fails it with its own message |
| 174 | `cleanStaging` | catch | `empty: readdirSync, rmSync` | **NOT-WORTH** | dir not there yet |
| 207 | `installProton` | spawn | `run("tar")` | **PASSES-ON** | awaited: the caller of installProton handles it _(flow)_ |
| 213 | `installProton` | spawn | `run("tar")` | **PASSES-ON** | awaited: the caller of installProton handles it _(flow)_ |
| 244 | `installProton` | spawn | `run("cp")` | **PASSES-ON** | awaited: the caller of installProton handles it _(flow)_ |

#### electron/main/games/running.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 62 | `readFull` | catch | `empty: readFileSync` | **NOT-WORTH** | environ unreadable (another session's process) |
| 68 | `readFull` | catch | `empty` | **NOT-WORTH** | gone |
| 92 | `readProcs` | catch | `fallback: readdirSync` | **NOT-WORTH** | no /proc: no running games seen (the watcher polls again) |
| 113 | `readProcs` | catch | `empty: statSync, readFileSync` | **NOT-WORTH** | process exited while we looked |
| 136 | `wineExe` | catch | `fallback` | **NOT-WORTH** | exe link unreadable: not counted as a Wine process |
| 158 | `launched` | catch | `empty: readFileSync` | **NOT-WORTH** | gone, or not readable |
| 168 | `readProcs` | catch | `empty` | **NOT-WORTH** | process exited while we looked |
| 230 | `readWindowsProcs > <anonymous>` | spawn | `execFile(join(process.env.SystemRoot ?? "C:\\Wind)` | **NOT-WORTH** | tasklist failed: this pass sees no processes; the next pass (3 s) looks again |
| 258 | `walk` | catch | `fallback: readdirSync` | **NOT-WORTH** | an unreadable folder is skipped while listing a game's executables |
| 321 | `pass` | .catch | `logged("running-game watcher pass")` | **LOGGED-OK** | running-game watcher pass _(logged())_ |
| 321 | `pass` | void | `Promise.resolve(this.tick()).catch(logged("running-game watc` | **LOGGED-OK** | running-game watcher pass _(via .catch L321)_ |

#### electron/main/games/schemeHandler.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 42 | `realHome` | catch | `fallback` | **NOT-WORTH** | no passwd entry: HOME is used |
| 143 | `spawnDetached > <anonymous>` | spawn | `spawn(cmd)` | **SHOWN** | desktop.library.action.failed (a start that fails resolves false up to the game action) |
| 157 | `run > <anonymous>` | spawn | `execFile("systemctl")` | **NOT-WORTH** | no user systemd answers null: the program is started without it |
| 164 | `systemdRun > <anonymous>` | spawn | `execFile("systemd-run")` | **NOT-WORTH** | "failed" / "timeout" make startIndependent fall back to a detached start |
| 204 | `defaultHandler > <anonymous>` | spawn | `execFile("xdg-mime")` | **NOT-WORTH** | no xdg-mime (err): Electron's own lookup answers instead |
| 221 | `electronSays` | catch | `fallback` | **NOT-WORTH** | can't tell: the open attempt decides, and a failed open shows desktop.library.action.failed |
| 259 | `schemeHandlerExec` | catch | `empty: readFile` | **NOT-WORTH** | not in this folder |

#### electron/main/games/service.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 76 | `exclusive` | .then-reject | `run` | **NOT-WORTH** | runs after a failed earlier job too: one job's failure must not block the next (it already went to that job's caller) |
| 78 | `exclusive` | .catch | `() => undefined` | **NOT-WORTH** | the queue's own copy; the caller gets 'next' with the error |
| 95 | `refreshLatest` | catch | `empty` | **NOT-WORTH** | offline: the scan keeps the last known Proton build and offers no update it can't see |
| 280 | `undo > exclusive(cb)` | .catch | `(cause: unknown) => (audioRestartFailed = errorText(cause))` | **SHOWN** | desktop.games.undoAudioRestart (was SILENT-BUG: the failed restart was dropped) |
| 289 | `undo > exclusive(cb)` | catch | `fallback` | **SHOWN** | main-english: the error text in GamesPage's error notice after Undo (batch E3) |
| 334 | `installLatestProton > exclusive(cb)` | catch | `fallback` | **SHOWN** | main-english: the message on the Proton card (protonMessage) after Install (batch E3) |

#### electron/main/games/steam.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 36 | `windowsSteamRoots` | spawn | `execFileSync(join(process.env.SystemRoot ?? "C:\\Wind)` | **NOT-WORTH** | no Steam in the registry _(via catch L43)_ |
| 43 | `windowsSteamRoots` | catch | `empty: child_process` | **NOT-WORTH** | no Steam in the registry |
| 71 | `findSteamInstalls` | catch | `fallback` | **NOT-WORTH** | a candidate Steam folder that isn't there |
| 92 | `newestLocalConfig` | catch | `empty: statSync` | **NOT-WORTH** | no localconfig for this account |
| 96 | `newestLocalConfig` | catch | `fallback: readdirSync, statSync` | **NOT-WORTH** | no userdata folder: no localconfig, so the launch options read as empty |
| 130 | `steamAppManifests` | catch | `fallback: readdirSync` | **NOT-WORTH** | a library folder without steamapps: no games there |

#### electron/main/games/system.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 45 | `dualSenseCards` | spawn | `run("pactl")` | **NOT-WORTH** | no pactl (no PipeWire/Pulse): no cards, and the audio check shows the controller as not found _(via catch L47)_ |
| 47 | `dualSenseCards` | catch | `fallback: child_process` | **NOT-WORTH** | no pactl (no PipeWire/Pulse): no cards, and the audio check shows the controller as not found |
| 86 | `findProAudioRules` | catch | `fallback: readdirSync` | **NOT-WORTH** | rule folder missing: no rules there |
| 94 | `findProAudioRules` | catch | `empty: readFileSync` | **NOT-WORTH** | unreadable: skip |
| 117 | `findGlobalSdlVars` | catch | `empty: readdirSync` | **NOT-WORTH** | missing dir |
| 130 | `findGlobalSdlVars` | catch | `empty: readFileSync` | **NOT-WORTH** | missing file |
| 144 | `hidrawAccess` | catch | `fallback: readdirSync` | **NOT-WORTH** | no hidraw class: access unknown (null), so the check isn't shown |
| 157 | `hidrawAccess` | catch | `empty: readFileSync` | **NOT-WORTH** | not this node / no access |
| 165 | `restartWirePlumber` | spawn | `run("systemctl")` | **PASSES-ON** | awaited: the caller of restartWirePlumber handles it _(flow)_ |
| 170 | `setCardProfile` | spawn | `run("pactl")` | **PASSES-ON** | awaited: the caller of setCardProfile handles it _(flow)_ |
| 242 | `findDualSenseAlsaCards` | catch | `fallback: readdirSync` | **NOT-WORTH** | no sound class: no cards |
| 260 | `findDualSenseAlsaCards` | catch | `empty: readFileSync` | **NOT-WORTH** | not a USB card, or it went away |
| 276 | `contents` | spawn | `run("amixer")` | **PASSES-ON** | awaited: the caller of contents handles it _(flow)_ |
| 279 | `set` | spawn | `run("amixer")` | **PASSES-ON** | awaited: the caller of set handles it _(flow)_ |
| 290 | `dualSenseMixers` | catch | `empty` | **NOT-WORTH** | amixer missing or the card went away |

#### electron/main/games/windowsStores.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 49 | `parseEpicManifest` | json-parse | `text.replace(/^\uFEFF/, "")` | **NOT-WORTH** | a broken Epic manifest: that game isn't listed _(via catch L50)_ |
| 50 | `parseEpicManifest` | catch | `fallback: JSON.parse` | **NOT-WORTH** | a broken Epic manifest: that game isn't listed |
| 68 | `readGogGames > <anonymous>` | spawn | `execFileSync(regExe())` | **PASSES-ON** | returned: the caller of <anonymous> handles it _(flow)_ |
| 71 | `readGogGames` | catch | `fallback` | **NOT-WORTH** | no GOG registry key: no GOG games |
| 81 | `readEpicGames` | catch | `fallback: readdirSync` | **NOT-WORTH** | no Epic manifests folder: no Epic games |
| 90 | `readEpicGames` | catch | `empty: readFileSync` | **NOT-WORTH** | unreadable manifest |

#### electron/main/index.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 69 | `isDirectory` | catch | `fallback: statSync` | **NOT-WORTH** | a missing folder is "no folder": the game action returns false and the page shows desktop.library.action.failed |
| 86 | `<module>` | .catch | `(cause: unknown) => { dialog.showErrorBox("DS5 Dongle Config` | **SHOWN** | main-english: "The app couldn't start" dialog; no window exists to show it in (batch E3: main-process text in English) |
| 102 | `recordGpuCrash > on(cb)` | catch | `fallback` | **LOGGED-OK** | not a user action: this run already falls back to software rendering; the next crash tries again |
| 124 | `scheduledCheck` | .catch | `logged("scheduled update check (not started by the user; a f` | **LOGGED-OK** | scheduled update check (not started by the user; a failed check shows as the 'failed' banner state) _(logged())_ |
| 130 | `start` | catch | `fallback` | **LOGGED-OK** | the start-up re-apply of an unchanged setting; changing it in App settings or the tray shows desktop.errors.settingNotSaved |
| 147 | `setSetting` | catch | `fallback` | **SHOWN** | desktop.errors.settingNotSaved (the tray's checkbox goes back; updateSetting logged the cause) |
| 156 | `checkForUpdates` | .catch | `logged("updater.check() doesn't reject: a failed check is th` | **LOGGED-OK** | updater.check() doesn't reject: a failed check is the 'failed' banner in the window just shown _(logged())_ |
| 200 | `start > <anonymous>` | .then-reject | `logged("background scan for the running-game watcher (the Ga` | **LOGGED-OK** | background scan for the running-game watcher (the Games page scans again and shows its own errors) _(logged())_ |
| 200 | `start > <anonymous>` | void | `games.scan().then( // Consent may have been turned off while` | **LOGGED-OK** | background scan for the running-game watcher (the Games page scans again and shows its own errors) _(via .then-reject L200)_ |
| 211 | `start > handle(cb)` | fetch | `net.fetch` | **PASSES-ON** | returned: the caller of handle(cb) handles it _(flow)_ |
| 216 | `start > <anonymous>` | fetch | `net.fetch` | **PASSES-ON** | returned: the caller of <anonymous> handles it _(flow)_ |
| 262 | `gameAction` | .catch | `() => null` | **NOT-WORTH** | no quiet start for this game: the launcher link below starts it instead |
| 269 | `gameAction` | .then-reject | `() => false` | **SHOWN** | desktop.library.action.failed (was SILENT-BUG: a failed open still answered true) |
| 313 | `start > watchDesktopPalette(cb)` | void | `readDesktopPalette() .then((palette) => mainWindow?.webConte` | **LOGGED-OK** | following the desktop's accent color (the theme keeps its last colors) _(via .catch L315)_ |
| 315 | `start > watchDesktopPalette(cb)` | .catch | `logged("following the desktop's accent color (the theme keep` | **LOGGED-OK** | following the desktop's accent color (the theme keeps its last colors) _(logged())_ |
| 342 | `installInBackground` | .catch | `logged("automatic update install (a failure shows as the 'fa` | **LOGGED-OK** | automatic update install (a failure shows as the 'failed' banner) _(logged())_ |
| 342 | `installInBackground` | void | `updater.downloadAndInstall().catch(logged("automatic update ` | **LOGGED-OK** | automatic update install (a failure shows as the 'failed' banner) _(via .catch L342)_ |
| 359 | `updateSetting` | catch | `rethrow` | **PASSES-ON** | rethrows to the caller _(rethrow)_ |
| 364 | `updateSetting` | catch | `empty` | **NOT-WORTH** | the file couldn't be written a moment ago either; it still holds the old value |
| 376 | `updateSetting` | .catch | `logged("updater.check() doesn't reject: a failed check is th` | **LOGGED-OK** | updater.check() doesn't reject: a failed check is the 'failed' banner _(logged())_ |
| 478 | `createWindow` | .catch | `logged("loading the app's own page")` | **LOGGED-OK** | loading the app's own page _(logged())_ |
| 487 | `openExternalLink` | .then-reject | `() => showMainError("desktop.errors.linkNotOpened")` | **SHOWN** | desktop.errors.linkNotOpened (was SILENT-BUG: a link that didn't open showed nothing) |
| 506 | `isAppUrl` | catch | `fallback: new URL` | **NOT-WORTH** | not a URL is "not the app's page": navigation stays blocked, as intended |

#### electron/main/integration.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 37 | `integrateDesktop` | catch | `log-only` | **LOGGED-OK** | start-up desktop integration (menu entry, Start menu shortcut): nothing the user asked for, and the app works without it |
| 46 | `realpathOrSelf` | catch | `fallback` | **NOT-WORTH** | no real path: the path itself |
| 61 | `integrateAppImage` | catch | `empty: lstatSync, rmSync` | **NOT-WORTH** | Read-only folder: fall back to the versioned path. |
| 83 | `integrateAppImage` | catch | `empty: readFileSync` | **NOT-WORTH** | First run. |
| 90 | `integrateAppImage` | spawn | `execFile("update-desktop-database")` | **NOT-WORTH** | menu cache refresh, a no-op where the tool doesn't exist |
| 92 | `integrateAppImage` | spawn | `execFile("kbuildsycoca6")` | **NOT-WORTH** | menu cache refresh, a no-op where the tool doesn't exist |
| 92 | `integrateAppImage > execFile(cb)` | spawn | `execFile("kbuildsycoca5")` | **NOT-WORTH** | menu cache refresh, a no-op where the tool doesn't exist |

#### electron/main/ipc.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 44 | `parseRequest` | schema | `schema.safeParse` | **SHOWN** | desktop.errors.badRequest (the page maps BAD_REQUEST to it) |
| 121 | `<module>` | result-field | `IpcHandlers.setupUsbAccess.ok: boolean` | **SHOWN** | main-english: the message under Set up USB access (UsbAccessSetup) (batch E3) |
| 123 | `<module>` | result-field | `IpcHandlers.repairWindowsUsb.ok: boolean` | **SHOWN** | main-english: the message under the Windows USB repair (WindowsUsbRepair) (batch E3) |
| 150 | `registerIpc` | ipc-handler | `on IPC.reportStatus` | **LOGGED-OK** | a status that doesn't fit is logged (an app bug); the tray keeps its last status |
| 153 | `registerIpc > on(cb)` | schema | `DeviceStatusSchema.safeParse` | **LOGGED-OK** | our own page's status report not fitting is an app bug, logged; the tray keeps its last status |
| 159 | `registerIpc` | ipc-handler | `on IPC.setTrayIcon` | **LOGGED-OK** | an icon that doesn't fit is logged (an app bug); the tray keeps its last icon |
| 162 | `registerIpc > on(cb)` | schema | `TrayIconSchema.safeParse` | **LOGGED-OK** | an icon from our own page that doesn't fit is an app bug, logged; the tray keeps its last icon |
| 167 | `registerIpc` | ipc-handler | `handle IPC.getSettings` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 173 | `registerIpc` | ipc-handler | `on IPC.appVersion` | **NOT-WORTH** | a synchronous read of a constant; an untrusted sender gets "" |
| 182 | `registerIpc` | ipc-handler | `handle IPC.checkForUpdates` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 183 | `registerIpc` | ipc-handler | `handle IPC.getUpdateState` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 184 | `registerIpc` | ipc-handler | `handle IPC.installUpdate` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 185 | `registerIpc` | ipc-handler | `handle IPC.backToStable` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 186 | `registerIpc` | ipc-handler | `handle IPC.getDesktopPalette` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 187 | `registerIpc` | ipc-handler | `handle IPC.firmwareChangelog` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 189 | `registerIpc` | ipc-handler | `handle IPC.getFirmwareHold` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 191 | `registerIpc` | ipc-handler | `on IPC.setFirmwareWriting` | **LOGGED-OK** | a value that doesn't fit is logged (an app bug) |
| 194 | `registerIpc > on(cb)` | schema | `z.boolean().safeParse` | **LOGGED-OK** | only our own page sends it, always a boolean; a misfit is an app bug, logged |
| 200 | `registerIpc` | ipc-handler | `on IPC.restartToUpdate` | **NOT-WORTH** | no payload to reject; an untrusted sender is ignored, as for every channel |
| 204 | `registerIpc` | ipc-handler | `handle IPC.usbAccessInstalled` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 209 | `registerIpc` | ipc-handler | `handle IPC.setupUsbAccess` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 214 | `registerIpc` | ipc-handler | `handle IPC.repairWindowsUsb` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 219 | `registerIpc` | ipc-handler | `handle IPC.gamesScan` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 220 | `registerIpc` | ipc-handler | `handle IPC.gamesBackups` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 221 | `registerIpc` | ipc-handler | `handle IPC.gamesRunningLaunchers` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 222 | `registerIpc` | ipc-handler | `handle IPC.installProton` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 228 | `registerIpc` | ipc-handler | `handle IPC.gamesApply` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 229 | `registerIpc` | ipc-handler | `handle IPC.gamesUndo` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 230 | `registerIpc` | ipc-handler | `handle IPC.gamesDetails` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 231 | `registerIpc` | ipc-handler | `handle IPC.gamesRunning` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 232 | `registerIpc` | ipc-handler | `handle IPC.libraryGet` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 233 | `registerIpc` | ipc-handler | `handle IPC.librarySetProfile` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 234 | `registerIpc` | ipc-handler | `handle IPC.libraryDeleteProfile` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 235 | `registerIpc` | ipc-handler | `handle IPC.librarySetMine` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 236 | `registerIpc` | ipc-handler | `handle IPC.librarySetRestore` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 237 | `registerIpc` | ipc-handler | `handle IPC.librarySetLayout` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 238 | `registerIpc` | ipc-handler | `handle IPC.libraryDeleteLayout` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 239 | `registerIpc` | ipc-handler | `handle IPC.gameAction` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 240 | `registerIpc` | ipc-handler | `handle IPC.gameArtColor` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 241 | `registerIpc` | ipc-handler | `handle IPC.officialControllerFirmware` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 242 | `registerIpc` | ipc-handler | `handle IPC.devChannelPreview` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 243 | `registerIpc` | ipc-handler | `handle IPC.latestFirmware` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 244 | `registerIpc` | ipc-handler | `handle IPC.downloadFirmware` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |
| 246 | `registerIpc` | ipc-handler | `handle IPC.setSetting` | **PASSES-ON** | a throw rejects the renderer's call; that ipc-call row has the verdict _(ipc)_ |

#### electron/main/linuxSetup.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 28 | `sandboxProfileNeeded` | catch | `fallback: readFileSync, existsSync` | **NOT-WORTH** | no AppArmor knob: no sandbox profile needed |
| 37 | `sameFile` | catch | `fallback: existsSync, readFileSync` | **NOT-WORTH** | unreadable: treated as different, so the file is installed again |
| 45 | `<module>` | result-field | `SetupResult.ok: boolean` | **SHOWN** | main-english: the message under Set up USB access (batch E3) |
| 74 | `installUsbRule` | catch | `fallback: writeFileSync, readFileSync` | **SHOWN** | main-english: "Setup failed: …" under Set up USB access (batch E3) |
| 86 | `installUsbRule > <anonymous>` | spawn | `execFile("pkexec")` | **SHOWN** | main-english: Cancelled / not authorized / failed, under Set up USB access (batch E3) |

#### electron/main/officialFirmware.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 37 | `readCapped` | .catch | `() => undefined` | **NOT-WORTH** | cleanup before the "too large" throw on the next line |
| 37 | `readCapped` | void | `reader.cancel().catch(() => undefined)` | **NOT-WORTH** | cleanup before the "too large" throw on the next line |
| 53 | `fetchOfficialFirmware` | fetch | `fetch` | **PASSES-ON** | awaited: the caller of fetchOfficialFirmware handles it _(flow)_ |
| 55 | `fetchOfficialFirmware` | json-parse | `await readCapped(response, OFFICIAL_FIRM` | **PASSES-ON** | throws to the caller: the caller of fetchOfficialFirmware handles it _(flow)_ |
| 86 | `lookup` | .catch | `(): OfficialFirmwareLookup => (this.cached ? { latest: this.` | **SHOWN** | desktop.ctrlInfo.officialUnavailable after Refresh (was SILENT-BUG: the card showed nothing); an automatic check keeps the last good answer quietly |

#### electron/main/settings.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 65 | `loadSettings` | json-parse | `readFileSync(settingsPath(), "utf8")` | **NOT-WORTH** | a settings file that doesn't fit: the defaults, written back on the next save |
| 65 | `loadSettings` | schema | `SettingsFile.safeParse` | **NOT-WORTH** | a settings file that doesn't fit: the defaults, written back on the next save |
| 67 | `loadSettings` | catch | `fallback: zod.safeParse, JSON.parse, readFileSync` | **NOT-WORTH** | no file yet (first start) or a broken one: the defaults, which the next save writes back |

#### electron/main/updateFeed.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 38 | `get` | fetch | `fetch` | **PASSES-ON** | returned to get()'s caller (check(), firmwareFeed(), devChannelPreview() each have the verdict) |
| 63 | `devChannelPreview` | catch | `fallback` | **SHOWN** | desktop.channel.joinOffline (offline or no dev build yet) |

#### electron/main/updater.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 43 | `isLoopbackHttp` | catch | `fallback: new URL` | **NOT-WORTH** | not a URL: no test feed |
| 127 | `pruneStaleFiles` | catch | `empty: readdirSync, rmSync` | **NOT-WORTH** | Best effort; nothing depends on it. |
| 158 | `check` | catch | `fallback` | **SHOWN** | desktop.setup.checkFailed (after Check for updates; a scheduled check that fails stays quiet: phase failed without "install") |
| 173 | `fetchManifest` | fetch | `net.fetch` | **PASSES-ON** | awaited: the caller of fetchManifest handles it _(flow)_ |
| 178 | `fetchManifest` | fetch | `net.fetch` | **PASSES-ON** | awaited: the caller of fetchManifest handles it _(flow)_ |
| 182 | `fetchManifest` | json-parse | `text` | **PASSES-ON** | rethrows to the caller _(via catch L183)_ |
| 183 | `fetchManifest` | catch | `rethrow: JSON.parse` | **PASSES-ON** | rethrows to the caller _(rethrow)_ |
| 187 | `fetchManifest` | schema | `Manifest.safeParse` | **PASSES-ON** | a malformed manifest throws "the update manifest is malformed" to check()'s catch |
| 207 | `downloadAndInstall` | catch | `fallback` | **SHOWN** | desktop.update.appFailed (was SILENT-BUG: the banner just disappeared when Download and install failed) |
| 217 | `firmwareChangelog` | fetch | `net.fetch` | **PASSES-ON** | awaited: the caller of firmwareChangelog handles it _(flow)_ |
| 261 | `install` | catch | `rethrow: renameSync` | **PASSES-ON** | rethrows to the caller _(rethrow)_ |
| 285 | `restart` | spawn | `execFileSync("systemd-run")` | **NOT-WORTH** | systemd-run unavailable _(via catch L287)_ |
| 287 | `restart` | catch | `empty: child_process` | **NOT-WORTH** | systemd-run unavailable |
| 291 | `restart` | spawn | `spawn("/bin/sh")` | **NOT-WORTH** | relaunching the just-verified new version; the app exits either way (a failed start leaves the user to open it again) |
| 294 | `restart` | spawn | `spawn(target)` | **NOT-WORTH** | relaunching the just-verified new version; the app exits either way (a failed start leaves the user to open it again) |

#### electron/main/urls.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 10 | `isAllowedHttpsUrl` | catch | `fallback: new URL` | **NOT-WORTH** | not a URL: not allowed, the link stays blocked |

#### electron/main/windowsSetup.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 37 | `repairWindowsUsb` | result-field | `repairWindowsUsb.ok: boolean` | **SHOWN** | main-english: the message under the Windows USB repair (batch E3) |
| 43 | `repairWindowsUsb > <anonymous>` | spawn | `execFile(powershell)` | **SHOWN** | main-english: Repaired / Cancelled / "Repair failed: …" under the Windows USB repair (batch E3) |

#### src/components/LanguageToggle.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 62 | `LanguageToggle > onClick=` | .catch | `logged("switching the language (resources are bundled, so no` | **LOGGED-OK** | switching the language (resources are bundled, so nothing to load can fail) _(logged())_ |
| 62 | `LanguageToggle > onClick=` | void | `i18n.changeLanguage(lang.code).catch(logged("switching the l` | **LOGGED-OK** | switching the language (resources are bundled, so nothing to load can fail) _(via .catch L62)_ |
| 65 | `LanguageToggle > onClick=` | catch | `empty` | **NOT-WORTH** | storage unavailable: the choice lasts for this session |

#### src/components/ThemeToggle.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 26 | `readStoredTheme` | catch | `empty` | **NOT-WORTH** | storage blocked: fall back to the default |
| 71 | `setStoredTheme` | catch | `empty` | **NOT-WORTH** | storage unavailable: the choice lasts for this session |
| 106 | `useApplyTheme > useEffect(cb)` | ipc-call | `getDesktopPalette` | **LOGGED-OK** | reading the desktop's accent for the Desktop theme (the app's own colors stay) _(via .catch L108)_ |
| 108 | `useApplyTheme > useEffect(cb)` | .catch | `logged("reading the desktop's accent for the Desktop theme (` | **LOGGED-OK** | reading the desktop's accent for the Desktop theme (the app's own colors stay) _(logged())_ |

#### src/desktop/api.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 100 | `<module>` | result-field | `FirmwareDownload.ok: false` | **SHOWN** | desktop.firmware.feedChanged (or desktop.firmware.hashMismatch; firmwareUpdate.ts throws it to the firmware banner) |
| 100 | `<module>` | result-field | `FirmwareDownload.reason: "changed" \| "mismatch"` | **SHOWN** | desktop.firmware.feedChanged (or desktop.firmware.hashMismatch; firmwareUpdate.ts throws it to the firmware banner) |
| 108 | `<module>` | result-field | `FirmwareLookup.problem: "unpublished" \| "offline" \| "disabled" \|` | **SHOWN** | desktop.firmware.offline (or desktop.firmware.unpublished; "disabled" is a choice, not an error) |
| 117 | `<module>` | result-field | `OfficialFirmwareLookup.problem: "disabled" \| "unavailable" \| null` | **SHOWN** | desktop.ctrlInfo.officialUnavailable after Refresh ("disabled" is a choice, not an error) |
| 129 | `<module>` | result-field | `ProtonInstallResult.ok: false` | **SHOWN** | english: the Proton card's message (main-process text, batch E3) |
| 137 | `<module>` | result-field | `UndoResult.ok: false` | **SHOWN** | desktop.games.restartGameRunning (useRestartText: restartTimeout / restartFailed / launcherStarted) |
| 137 | `<module>` | result-field | `UndoResult.blockedBy: LauncherId[]` | **SHOWN** | desktop.games.restartGameRunning (useRestartText: restartTimeout / restartFailed / launcherStarted) |
| 137 | `<module>` | result-field | `UndoResult.problem: CloseProblem` | **SHOWN** | desktop.games.restartGameRunning (useRestartText: restartTimeout / restartFailed / launcherStarted) |
| 139 | `<module>` | result-field | `UndoResult.ok: false` | **SHOWN** | desktop.games.undoConflict |
| 141 | `<module>` | result-field | `UndoResult.ok: false` | **SHOWN** | desktop.games.undoNoController |
| 143 | `<module>` | result-field | `UndoResult.ok: false` | **SHOWN** | english: the Games page's error notice (main-process text, batch E3) |
| 143 | `<module>` | result-field | `UndoResult.error: string` | **SHOWN** | english: the Games page's error notice (main-process text, batch E3) |
| 165 | `<module>` | result-field | `DesktopApi.ok: boolean` | **SHOWN** | english: the message under Set up USB access (batch E3) |
| 169 | `<module>` | result-field | `DesktopApi.ok: boolean` | **SHOWN** | english: the message under the Windows USB repair (batch E3) |

#### src/desktop/AutoUpdateAsk.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 18 | `AutoUpdateAsk > useEffect(cb)` | ipc-call | `getSettings` | **LOGGED-OK** | reading whether automatic updates were asked about (unread: not asked now) _(via .catch L20)_ |
| 20 | `AutoUpdateAsk > useEffect(cb)` | .catch | `logged("reading whether automatic updates were asked about (` | **LOGGED-OK** | reading whether automatic updates were asked about (unread: not asked now) _(logged())_ |
| 32 | `answer` | ipc-call | `setSetting` | **SHOWN** | desktop.errors.settingNotSaved _(via .catch L34)_ |
| 33 | `answer > then(cb)` | ipc-call | `setSetting` | **PASSES-ON** | returned: the caller of then(cb) handles it _(flow)_ |
| 34 | `answer` | .catch | `shown("desktop.errors.settingNotSaved")` | **SHOWN** | desktop.errors.settingNotSaved _(shown())_ |

#### src/desktop/controllerAudio.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 33 | `controllerAudio` | catch | `fallback` | **NOT-WORTH** | no device list (no permission): null is "the controller's audio isn't there", which each test shows |
| 41 | `closeQuietly` | .catch | `logged("closing a test's audio context (it's done either way` | **LOGGED-OK** | closing a test's audio context (it's done either way) _(logged())_ |

#### src/desktop/controls.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 132 | `flip` | void | `pending // error: SHOWN — desktop.errors.actionFailed (was S` | **SHOWN** | desktop.errors.actionFailed (was SWALLOWED: the safety net for a caller that doesn't report its own error) _(via .catch L134)_ |
| 134 | `flip` | .catch | `(cause: unknown) => shown("desktop.errors.actionFailed", { r` | **SHOWN** | desktop.errors.actionFailed (was SWALLOWED: the safety net for a caller that doesn't report its own error) |
| 264 | `run` | catch | `fallback` | **SHOWN** | desktop.errors.actionFailed (was SWALLOWED: the safety net for a caller that doesn't report its own error; callers that do catch it first) |
| 279 | `BusyButton > onClick=` | .catch | `logged("BusyButton.run (it shows its own errors)")` | **LOGGED-OK** | BusyButton.run (it shows its own errors) _(logged())_ |
| 279 | `BusyButton > onClick=` | void | `run().catch(logged("BusyButton.run (it shows its own errors)` | **LOGGED-OK** | BusyButton.run (it shows its own errors) _(via .catch L279)_ |

#### src/desktop/DesktopApp.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 99 | `DesktopApp > useEffect(cb) > setTimeout(cb)` | .catch | `logged("applying the draft live (applyConfig shows its own e` | **LOGGED-OK** | applying the draft live (applyConfig shows its own error and resolves false) _(logged())_ |
| 191 | `DesktopApp > useEffect(cb)` | void | `client .readNarrator() .then((have) => (!cancelled && have !` | **LOGGED-OK** | syncing the board's narrator setting (busy or gone: tried again on the next change or reconnect) _(via .catch L194)_ |
| 194 | `DesktopApp > useEffect(cb)` | .catch | `logged("syncing the board's narrator setting (busy or gone: ` | **LOGGED-OK** | syncing the board's narrator setting (busy or gone: tried again on the next change or reconnect) _(logged())_ |
| 207 | `DesktopApp > useEffect(cb)` | void | `renderTrayIcon({ dot: !connected ? "none" : controllerOn ? "` | **LOGGED-OK** | drawing the tray icon (the tray keeps its last icon) _(via .catch L209)_ |
| 209 | `DesktopApp > useEffect(cb)` | .catch | `logged("drawing the tray icon (the tray keeps its last icon)` | **LOGGED-OK** | drawing the tray icon (the tray keeps its last icon) _(logged())_ |
| 232 | `DesktopApp > useEffect(cb) > onTrayCommand(cb)` | .catch | `(cause: unknown) => shown("desktop.errors.slotSwitch", { slo` | **SHOWN** | desktop.errors.slotSwitch (was SILENT-BUG: the tray's slot switch failed with nothing shown) |
| 454 | `read` | .catch | `logged("reading whether the taskbar is dark (for the tray ic` | **LOGGED-OK** | reading whether the taskbar is dark (for the tray icon; the system setting answers instead) _(logged())_ |
| 454 | `read` | ipc-call | `getDesktopPalette` | **LOGGED-OK** | reading whether the taskbar is dark (for the tray icon; the system setting answers instead) _(via .catch L454)_ |
| 480 | `useWhatsNew > useState(cb)` | catch | `fallback` | **NOT-WORTH** | storage unavailable: no "What's new" banner this time |
| 489 | `dismiss` | catch | `empty` | **NOT-WORTH** | storage unavailable: the banner just reappears next launch |
| 518 | `useGamesAttention > useEffect(cb)` | ipc-call | `getSettings` | **LOGGED-OK** | reading the Games consent for the rail's count (the count stays hidden) _(via .catch L525)_ |
| 523 | `useGamesAttention > useEffect(cb) > then(cb)` | .then-reject | `logged("the background scan for the rail's attention count (` | **LOGGED-OK** | the background scan for the rail's attention count (the Games page scans again and shows its errors) _(logged())_ |
| 523 | `useGamesAttention > useEffect(cb) > then(cb)` | ipc-call | `gamesScan` | **LOGGED-OK** | the background scan for the rail's attention count (the Games page scans again and shows its errors) _(via .then-reject L523)_ |
| 525 | `useGamesAttention > useEffect(cb)` | .catch | `logged("reading the Games consent for the rail's count (the ` | **LOGGED-OK** | reading the Games consent for the rail's count (the count stays hidden) _(logged())_ |
| 542 | `useGamesAttention > useCallback(cb)` | .catch | `shown("desktop.errors.settingNotSaved")` | **SHOWN** | desktop.errors.settingNotSaved _(shown())_ |
| 542 | `useGamesAttention > useCallback(cb)` | void | `setGamesAllowed(value).catch(shown("desktop.errors.settingNo` | **SHOWN** | desktop.errors.settingNotSaved _(via .catch L542)_ |

#### src/desktop/dev/HdrTest.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 38 | `GpuSwatch > useEffect(cb) > <anonymous>` | catch | `fallback` | **SHOWN** | english: the dev HDR test's swatch reads "no" (Developer card only, not translated) |
| 42 | `GpuSwatch > useEffect(cb)` | .catch | `logged("the dev HDR test's WebGPU swatch")` | **LOGGED-OK** | the dev HDR test's WebGPU swatch _(logged())_ |

#### src/desktop/dongle/DongleConsole.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 126 | `<module>` | result-field | `OledFrameState.error: boolean` | **SHOWN** | desktop.dongleConsole.unavailable (the last good frame stays, retried) |
| 147 | `tick` | catch | `fallback` | **SHOWN** | desktop.dongleConsole.unavailable (retried) |
| 155 | `next` | .catch | `logged("the OLED mirror poll (it catches its own errors)")` | **LOGGED-OK** | the OLED mirror poll (it catches its own errors) _(logged())_ |
| 155 | `next` | void | `tick().catch(logged("the OLED mirror poll (it catches its ow` | **LOGGED-OK** | the OLED mirror poll (it catches its own errors) _(via .catch L155)_ |

#### src/desktop/dongle/DongleDashboard.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 239 | `reset` | catch | `fallback` | **SHOWN** | english: the error next to Reset (board errors are English, batch E3) |

#### src/desktop/firmwareUpdate.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 40 | `shownFirmware` | ipc-call | `downloadFirmware` | **PASSES-ON** | awaited: the caller of shownFirmware handles it _(flow)_ |

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
| 21 | `useFreshRunning > useEffect(cb)` | .then-reject | `() => live && setRunning({ key, list: null })` | **NOT-WORTH** | unknown (null): Apply's own check in the main process still names a running launcher (desktop.games.launcherStarted) |
| 21 | `useFreshRunning > useEffect(cb)` | ipc-call | `gamesRunningLaunchers` | **NOT-WORTH** | unknown (null): Apply's own check in the main process still names a running launcher (desktop.games.launcherStarted) |
| 48 | `startedSinceCheck` | result-field | `startedSinceCheck.blockedBy: LauncherId[]` | **SHOWN** | desktop.games.launcherStarted (an input here; the text comes from useRestartText) |
| 48 | `startedSinceCheck` | result-field | `startedSinceCheck.problem: CloseProblem` | **SHOWN** | desktop.games.launcherStarted (an input here; the text comes from useRestartText) |

#### src/desktop/games/types.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 183 | `<module>` | result-field | `ApplyResult.applied.ok: boolean` | **SHOWN** | desktop.library.setupFailed (and each change's message in the Done list) |
| 188 | `<module>` | result-field | `ApplyResult.blockedBy: LauncherId[]` | **SHOWN** | desktop.games.launcherStarted (useRestartText names the launcher) |
| 190 | `<module>` | result-field | `ApplyResult.problem: CloseProblem` | **SHOWN** | desktop.games.restartGameRunning (or restartTimeout / restartFailed) |

#### src/desktop/glass/useLiquidGlass.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 19 | `useLiquidGlass > useEffect(cb)` | json-parse | `c` | **PASSES-ON** | throws to the caller: the caller of useEffect(cb) handles it _(flow)_ |
| 20 | `useLiquidGlass > useEffect(cb)` | json-parse | `r` | **PASSES-ON** | throws to the caller: the caller of useEffect(cb) handles it _(flow)_ |

#### src/desktop/library/gameArt.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 35 | `useArtColor > useEffect(cb)` | void | `window .desktop!.gameArtColor(key) .then((color) => live && ` | **LOGGED-OK** | the game art's color for the page accent and tile (the theme accent stays) _(via .catch L38)_ |
| 36 | `useArtColor > useEffect(cb)` | ipc-call | `gameArtColor` | **LOGGED-OK** | the game art's color for the page accent and tile (the theme accent stays) _(via .catch L38)_ |
| 38 | `useArtColor > useEffect(cb)` | .catch | `logged("the game art's color for the page accent and tile (t` | **LOGGED-OK** | the game art's color for the page accent and tile (the theme accent stays) _(logged())_ |

#### src/desktop/library/GameLibrary.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 89 | `GameLibrary > useEffect(cb)` | .then-reject | `logged("reading play time and art details (the tiles show wi` | **LOGGED-OK** | reading play time and art details (the tiles show without them) _(logged())_ |
| 89 | `GameLibrary > useEffect(cb)` | ipc-call | `gamesDetails` | **LOGGED-OK** | reading play time and art details (the tiles show without them) _(via .then-reject L89)_ |
| 89 | `GameLibrary > useEffect(cb)` | void | `desktop.gamesDetails().then(setDetails, logged("reading play` | **LOGGED-OK** | reading play time and art details (the tiles show without them) _(via .then-reject L89)_ |

#### src/desktop/library/GamePage.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 154 | `ProfileFrame > useDebouncedSave(cb)` | ipc-call | `librarySetProfile` | **PASSES-ON** | useDebouncedSave shows a failed save (desktop.errors.librarySave) |
| 159 | `create` | .catch | `shown("desktop.errors.profileCreate")` | **SHOWN** | desktop.errors.profileCreate _(shown())_ |
| 159 | `create` | ipc-call | `librarySetProfile` | **SHOWN** | desktop.errors.profileCreate _(via .catch L159)_ |
| 163 | `remove` | .catch | `shown("desktop.errors.profileDelete")` | **SHOWN** | desktop.errors.profileDelete _(shown())_ |
| 163 | `remove` | ipc-call | `libraryDeleteProfile` | **SHOWN** | desktop.errors.profileDelete _(via .catch L163)_ |
| 437 | `apply > thenRescan(cb)` | ipc-call | `gamesApply` | **PASSES-ON** | returned: the caller of thenRescan(cb) handles it _(flow)_ |
| 442 | `apply` | catch | `fallback` | **SHOWN** | english: the note under Set up (main-process text, or desktop.errors.badRequest) |
| 592 | `switchRunner > thenRescan(cb)` | ipc-call | `gamesApply` | **PASSES-ON** | returned: the caller of thenRescan(cb) handles it _(flow)_ |
| 596 | `switchRunner` | catch | `fallback` | **SHOWN** | english: the note under the runner switch (main-process text, or desktop.errors.badRequest) |
| 702 | `useMine > useDebouncedSave(cb)` | ipc-call | `librarySetMine` | **PASSES-ON** | returned: the caller of useDebouncedSave(cb) handles it _(flow)_ |

#### src/desktop/library/playBar.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 38 | `useGameAction` | result-field | `useGameAction.failed: GameAction \| null` | **SHOWN** | desktop.library.action.failed (\'failed\' names the action for a few seconds) |
| 43 | `run` | ipc-call | `gameAction` | **SHOWN** | desktop.library.action.failed _(via catch L47)_ |
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
| 37 | `useDebouncedSave > useEffect(cb) > <anonymous>` | .catch | `shown("desktop.errors.librarySave")` | **SHOWN** | desktop.errors.librarySave _(shown())_ |
| 51 | `useDebouncedSave > useCallback(cb) > setTimeout(cb)` | .catch | `shown("desktop.errors.librarySave")` | **SHOWN** | desktop.errors.librarySave _(shown())_ |

#### src/desktop/library/useGameProfile.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 31 | `decideProfileStep` | result-field | `decideProfileStep.failed: string \| null` | **NOT-WORTH** | \'failed\' is an input (the step that failed, so it isn't retried in a loop); the failure itself is shown where it happens |
| 83 | `<module>` | result-field | `GameProfileState.error: string \| null` | **SHOWN** | desktop.profile.applyFailed (DesktopApp's ErrorNotice; also partlyOn / restoreFailed / saveFailed / notOn) |
| 132 | `useGameProfile > useCallback(cb)` | .catch | `() => undefined` | **NOT-WORTH** | the wait's own copy; \'run\' is awaited below with its error |
| 150 | `useGameProfile > useEffect(cb)` | ipc-call | `libraryGet` | **SHOWN** | desktop.errors.libraryRead _(via .catch L157)_ |
| 157 | `useGameProfile > useEffect(cb)` | .catch | `shown("desktop.errors.libraryRead")` | **SHOWN** | desktop.errors.libraryRead _(shown())_ |
| 159 | `useGameProfile > useEffect(cb)` | .then-reject | `() => setRunningKnown(true)` | **NOT-WORTH** | unknown reads as "no game running"; onRunningGame corrects it within one watcher pass (2-3 s) |
| 159 | `useGameProfile > useEffect(cb)` | ipc-call | `gamesRunning` | **NOT-WORTH** | unknown reads as "no game running"; onRunningGame corrects it within one watcher pass (2-3 s) |
| 159 | `useGameProfile > useEffect(cb)` | void | `desktop.gamesRunning().then( (key) => { setRunning(key); set` | **NOT-WORTH** | unknown reads as "no game running"; onRunningGame corrects it within one watcher pass (2-3 s) |
| 199 | `useGameProfile > useEffect(cb) > switchOnce(cb)` | ipc-call | `librarySetRestore` | **SHOWN** | desktop.profile.applyFailed (or partlyOn) _(via catch L207)_ |
| 200 | `useGameProfile > useEffect(cb) > switchOnce(cb)` | ipc-call | `librarySetRestore` | **SHOWN** | desktop.profile.applyFailed (or partlyOn) _(via catch L207)_ |
| 207 | `useGameProfile > useEffect(cb) > switchOnce(cb)` | catch | `fallback: ipc:librarySetRestore` | **SHOWN** | desktop.profile.applyFailed (or partlyOn) |
| 228 | `useGameProfile > useEffect(cb)` | .catch | `logged("switchOnce's apply task (it shows its own errors)")` | **LOGGED-OK** | switchOnce's apply task (it shows its own errors) _(logged())_ |
| 237 | `useGameProfile > useEffect(cb) > switchOnce(cb)` | ipc-call | `librarySetRestore` | **SHOWN** | desktop.profile.restoreFailed (was SILENT-BUG: only logged; the game's settings stayed on with no word) _(via catch L241)_ |
| 241 | `useGameProfile > useEffect(cb) > switchOnce(cb)` | catch | `fallback: ipc:librarySetRestore` | **SHOWN** | desktop.profile.restoreFailed (was SILENT-BUG: only logged; the game's settings stayed on with no word) |
| 247 | `useGameProfile > useEffect(cb)` | .catch | `logged("switchOnce's restore task (it shows its own errors)"` | **LOGGED-OK** | switchOnce's restore task (it shows its own errors) _(logged())_ |
| 252 | `useGameProfile > useEffect(cb)` | .catch | `logged("taking a game's layout off with no game running (bus` | **LOGGED-OK** | taking a game's layout off with no game running (busy or gone: tried again on the next change or reconnect) _(logged())_ |
| 309 | `useGameProfile > useCallback(cb)` | ipc-call | `librarySetProfile` | **SHOWN** | desktop.profile.saveFailed _(via catch L324)_ |
| 311 | `useGameProfile > useCallback(cb)` | ipc-call | `librarySetLayout` | **SHOWN** | desktop.profile.saveFailed _(via catch L324)_ |
| 324 | `useGameProfile > useCallback(cb)` | catch | `fallback: ipc:librarySetProfile, ipc:librarySetLayout` | **SHOWN** | desktop.profile.saveFailed |

#### src/desktop/live/ArtBackdrop.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 64 | `load` | void | `desktop .gamesDetails() .then((d) => { if (!live) return; co` | **LOGGED-OK** | game art for the backdrop (the colors-only backdrop stays) _(via .catch L76)_ |
| 65 | `load` | ipc-call | `gamesDetails` | **LOGGED-OK** | game art for the backdrop (the colors-only backdrop stays) _(via .catch L76)_ |
| 76 | `load` | .catch | `logged("game art for the backdrop (the colors-only backdrop ` | **LOGGED-OK** | game art for the backdrop (the colors-only backdrop stays) _(logged())_ |
| 78 | `useBackdropKeys > useEffect(cb)` | .then-reject | `logged("the running game for the backdrop (onRunningGame upd` | **LOGGED-OK** | the running game for the backdrop (onRunningGame updates it) _(logged())_ |
| 78 | `useBackdropKeys > useEffect(cb)` | ipc-call | `gamesRunning` | **LOGGED-OK** | the running game for the backdrop (onRunningGame updates it) _(via .then-reject L78)_ |
| 78 | `useBackdropKeys > useEffect(cb)` | void | `desktop.gamesRunning().then(setRunning, logged("the running ` | **LOGGED-OK** | the running game for the backdrop (onRunningGame updates it) _(via .then-reject L78)_ |

#### src/desktop/live/Calibration.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 124 | `save` | catch | `fallback` | **SHOWN** | desktop.errors.boardFailed (causeText: board results in plain words; other board errors English, batch E3) |

#### src/desktop/live/ControllerInfo.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 100 | `ControllerInfo > useEffect(cb) > then(cb)` | ipc-call | `officialControllerFirmware` | **SHOWN** | desktop.ctrlInfo.officialUnavailable (after Refresh; was SILENT-BUG: nothing was said) _(via .catch L103)_ |
| 103 | `ControllerInfo > useEffect(cb) > then(cb)` | .catch | `() => live && setOfficial({ latest: null, problem: "unavaila` | **SHOWN** | desktop.ctrlInfo.officialUnavailable (after Refresh; was SILENT-BUG: nothing was said) |
| 109 | `ControllerInfo > useEffect(cb)` | .catch | `(cause) => live && setError(causeText(cause))` | **SHOWN** | english: the read error in the card, with Refresh (board errors are English, batch E3) |

#### src/desktop/live/ControllerView.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 141 | `ControllerView > useEffect(cb)` | ipc-call | `getSettings` | **LOGGED-OK** | reading the HDR lighting setting (the normal glow stays) _(via .catch L143)_ |
| 143 | `ControllerView > useEffect(cb)` | .catch | `logged("reading the HDR lighting setting (the normal glow st` | **LOGGED-OK** | reading the HDR lighting setting (the normal glow stays) _(logged())_ |

#### src/desktop/live/customColors.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 38 | `parseCustomColors` | json-parse | `raw ?? "{}"` | **NOT-WORTH** | stored colors that don't parse: the colorway's own colors _(via catch L39)_ |
| 39 | `parseCustomColors` | catch | `fallback: JSON.parse` | **NOT-WORTH** | stored colors that don't parse: the colorway's own colors |

#### src/desktop/live/HdrGlow.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 68 | `shapeAlpha` | catch | `fallback` | **NOT-WORTH** | a part's mask that won't decode: that part gets no HDR glow (the normal glow shows) |
| 196 | `HdrGlow > useEffect(cb) > <anonymous> > <anonymous> > requestAnimationFrame(cb)` | .catch | `logged("rebuilding the HDR glow mask after a resize")` | **LOGGED-OK** | rebuilding the HDR glow mask after a resize _(logged())_ |
| 196 | `HdrGlow > useEffect(cb) > <anonymous> > <anonymous> > requestAnimationFrame(cb)` | void | `rebuild().catch(logged("rebuilding the HDR glow mask after a` | **LOGGED-OK** | rebuilding the HDR glow mask after a resize _(via .catch L196)_ |
| 237 | `HdrGlow > useEffect(cb) > <anonymous> > <anonymous>` | .catch | `logged("rebuilding the HDR glow mask after an LED change")` | **LOGGED-OK** | rebuilding the HDR glow mask after an LED change _(logged())_ |
| 242 | `HdrGlow > useEffect(cb)` | .catch | `logged("starting the HDR glow (WebGPU): the normal glow stay` | **LOGGED-OK** | starting the HDR glow (WebGPU): the normal glow stays _(logged())_ |

#### src/desktop/live/micTest.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 51 | `<module>` | result-field | `ListenResult.ok: boolean` | **SHOWN** | desktop.audioTest.problem.failed (\'problem\' picks the desktop.audioTest.problem.<problem> line) |
| 56 | `<module>` | result-field | `ListenResult.problem: MicProblem` | **SHOWN** | desktop.audioTest.problem.failed (each problem has its line) |
| 87 | `startMicTest` | result-field | `startMicTest.problem: MicProblem` | **SHOWN** | desktop.audioTest.problem.no-mic (a \'problem\' result is said on the Mic test's status line) |
| 96 | `startMicTest` | catch | `fallback` | **SHOWN** | desktop.audioTest.problem.no-speaker |
| 106 | `startMicTest` | catch | `fallback` | **SHOWN** | desktop.audioTest.problem.failed |
| 180 | `listenBack` | catch | `fallback` | **SHOWN** | desktop.audioTest.problem.no-speaker |
| 188 | `listenBack` | catch | `fallback` | **SHOWN** | desktop.audioTest.problem.playback (or failed when stopped) |
| 214 | `end` | catch | `empty` | **NOT-WORTH** | never started |
| 221 | `gone` | void | `controllerAudio("audiooutput") .then((now) => { if (now !== ` | **LOGGED-OK** | checking the controller's output after a device change (the watchdog still ends playback) _(via .catch L225)_ |
| 225 | `gone` | .catch | `logged("checking the controller's output after a device chan` | **LOGGED-OK** | checking the controller's output after a device change (the watchdog still ends playback) _(logged())_ |
| 234 | `playClip > <anonymous>` | catch | `fallback` | **SHOWN** | desktop.audioTest.problem.playback (rejects playClip) |

#### src/desktop/live/PartPanel.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 434 | `save` | void | `desktop .librarySetLayout({ id, name: layoutName, table: rem` | **SHOWN** | desktop.errors.layoutSave _(via .catch L437)_ |
| 435 | `save` | ipc-call | `librarySetLayout` | **SHOWN** | desktop.errors.layoutSave _(via .catch L437)_ |
| 437 | `save` | .catch | `shown("desktop.errors.layoutSave")` | **SHOWN** | desktop.errors.layoutSave _(shown())_ |
| 478 | `ButtonLayoutsSection > onClick=` | .catch | `shown("desktop.errors.layoutDelete")` | **SHOWN** | desktop.errors.layoutDelete _(shown())_ |
| 478 | `ButtonLayoutsSection > onClick=` | ipc-call | `libraryDeleteLayout` | **SHOWN** | desktop.errors.layoutDelete _(via .catch L478)_ |
| 478 | `ButtonLayoutsSection > onClick=` | void | `desktop.libraryDeleteLayout(id).then(setLibrary).catch(shown` | **SHOWN** | desktop.errors.layoutDelete _(via .catch L478)_ |
| 660 | `AppSettings > useEffect(cb)` | .catch | `shown("desktop.errors.settingsRead")` | **SHOWN** | desktop.errors.settingsRead _(shown())_ |
| 660 | `AppSettings > useEffect(cb)` | ipc-call | `getSettings` | **SHOWN** | desktop.errors.settingsRead _(via .catch L660)_ |
| 664 | `set` | .catch | `shown("desktop.errors.settingNotSaved")` | **SHOWN** | desktop.errors.settingNotSaved _(shown())_ |
| 664 | `set` | ipc-call | `setSetting` | **SHOWN** | desktop.errors.settingNotSaved _(via .catch L664)_ |
| 765 | `AppSettings > onClick=` | ipc-call | `backToStable` | **PASSES-ON** | awaited: the caller of onClick= handles it _(flow)_ |
| 766 | `AppSettings > onClick=` | ipc-call | `getSettings` | **PASSES-ON** | awaited: the caller of onClick= handles it _(flow)_ |
| 802 | `GameLaunchersSetting > useEffect(cb)` | ipc-call | `getSettings` | **LOGGED-OK** | reading the Games consent for App settings (the card stays hidden) _(via .catch L804)_ |
| 804 | `GameLaunchersSetting > useEffect(cb)` | .catch | `logged("reading the Games consent for App settings (the card` | **LOGGED-OK** | reading the Games consent for App settings (the card stays hidden) _(logged())_ |
| 822 | `GameLaunchersSetting > onChange=` | .catch | `shown("desktop.errors.settingNotSaved")` | **SHOWN** | desktop.errors.settingNotSaved _(shown())_ |
| 834 | `GameLaunchersSetting > onClick=` | .catch | `shown("desktop.errors.settingNotSaved")` | **SHOWN** | desktop.errors.settingNotSaved _(shown())_ |
| 857 | `check` | .catch | `() => null` | **SHOWN** | desktop.setup.checkFailed (null: the line below says the check failed) |
| 857 | `check` | ipc-call | `checkForUpdates` | **SHOWN** | desktop.setup.checkFailed (null: the line below says the check failed) |
| 982 | `<module>` | result-field | `MicNote.problem: MicProblem` | **SHOWN** | desktop.audioTest.problem.failed (the status line says desktop.audioTest.problem.<problem>) |
| 1011 | `MicTest > useEffect(cb) > <anonymous>` | .catch | `logged("closing the mic test on unmount")` | **LOGGED-OK** | closing the mic test on unmount _(logged())_ |
| 1011 | `MicTest > useEffect(cb) > <anonymous>` | void | `stopAll().catch(logged("closing the mic test on unmount"))` | **LOGGED-OK** | closing the mic test on unmount _(via .catch L1011)_ |
| 1016 | `MicTest > useEffect(cb)` | .catch | `logged("closing the mic test when the window hides")` | **LOGGED-OK** | closing the mic test when the window hides _(logged())_ |
| 1038 | `start > startMicTest(cb)` | .catch | `failed` | **SHOWN** | desktop.audioTest.problem.failed |
| 1047 | `start` | .catch | `logged("closing a mic test that was replaced")` | **LOGGED-OK** | closing a mic test that was replaced _(logged())_ |
| 1047 | `start` | void | `r.session.stop().catch(logged("closing a mic test that was r` | **LOGGED-OK** | closing a mic test that was replaced _(via .catch L1047)_ |
| 1131 | `MicTest > onClick=` | .catch | `failed` | **SHOWN** | desktop.audioTest.problem.failed (failed() ends on the status line) |
| 1131 | `MicTest > onClick=` | void | `(running ? stopTest() : start()).catch(failed)` | **SHOWN** | desktop.audioTest.problem.failed (failed() ends on the status line) |
| 1144 | `MicTest > onClick=` | .catch | `failed` | **SHOWN** | desktop.audioTest.problem.failed (failed() ends on the status line) |
| 1144 | `MicTest > onClick=` | void | `listen().catch(failed)` | **SHOWN** | desktop.audioTest.problem.failed (failed() ends on the status line) |
| 1276 | `DevChannelDialog > useEffect(cb)` | .then-reject | `() => live && setPreview(null)` | **SHOWN** | desktop.channel.joinOffline |
| 1276 | `DevChannelDialog > useEffect(cb)` | ipc-call | `devChannelPreview` | **SHOWN** | desktop.channel.joinOffline |

#### src/desktop/live/slotSettings.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 52 | `useSlotSettings > useEffect(cb)` | .catch | `(cause) => live && setError(causeText(cause))` | **SHOWN** | english: SlotReadError with Retry (board errors are English, batch E3) |
| 69 | `SlotReadError` | result-field | `SlotReadError.error: string \| null` | **SHOWN** | english: the read error itself, with Retry |

#### src/desktop/live/speakerPlayer.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 71 | `gone` | void | `controllerSpeaker() .then((now) => { if (now !== sink) stopN` | **LOGGED-OK** | checking the controller's speaker after a device change _(via .catch L75)_ |
| 75 | `gone` | .catch | `logged("checking the controller's speaker after a device cha` | **LOGGED-OK** | checking the controller's speaker after a device change _(logged())_ |
| 102 | `playTune` | catch | `fallback` | **SHOWN** | desktop.audioTest.noSpeaker (noSpeaker: couldn't route to the controller) |

#### src/desktop/live/StickCurves.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 104 | `save` | catch | `fallback` | **SHOWN** | desktop.errors.boardFailed (causeText; other board errors English, batch E3) |

#### src/desktop/live/SwirlField.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 218 | `SwirlField > useEffect(cb)` | ipc-call | `getSettings` | **LOGGED-OK** | reading hardware acceleration for the backdrop (the CPU drawing is used) _(via .catch L220)_ |
| 220 | `SwirlField > useEffect(cb)` | .catch | `logged("reading hardware acceleration for the backdrop (the ` | **LOGGED-OK** | reading hardware acceleration for the backdrop (the CPU drawing is used) _(logged())_ |

#### src/desktop/live/useRemap.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 19 | `<module>` | result-field | `Remap.error: string \| null` | **SHOWN** | english: the remap card's error notice (remap.verifyFailed, desktop.errors.board*, other board errors English, batch E3) |
| 51 | `useRemap > useEffect(cb)` | .then-reject | `() => live && setExtraDevice(null)` | **NOT-WORTH** | firmware without the Edge extras answers nothing: no extra rows |
| 60 | `useRemap > useEffect(cb)` | .then-reject | `(cause: unknown) => live && setError(causeText(cause))` | **SHOWN** | english: the remap card's error notice (board errors are English, batch E3) |
| 96 | `useRemap > useCallback(cb)` | catch | `fallback` | **SHOWN** | remap.verifyFailed (or the board's failure, via causeText) |
| 102 | `useRemap > useCallback(cb)` | .then-reject | `() => undefined` | **NOT-WORTH** | a re-read after the failure that is already shown; the old table stays |

#### src/desktop/narrator.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 46 | `<module>` | ipc-call | `getSettings` | **LOGGED-OK** | reading the narrator settings at start (the defaults stay: ask, captions on) _(via .catch L52)_ |
| 52 | `<module>` | .catch | `logged("reading the narrator settings at start (the defaults` | **LOGGED-OK** | reading the narrator settings at start (the defaults stay: ask, captions on) _(logged())_ |
| 57 | `setNarrator` | .catch | `shown("desktop.errors.settingNotSaved")` | **SHOWN** | desktop.errors.settingNotSaved _(shown())_ |
| 57 | `setNarrator` | ipc-call | `setSetting` | **SHOWN** | desktop.errors.settingNotSaved _(via .catch L57)_ |
| 63 | `setCaptions` | .catch | `shown("desktop.errors.settingNotSaved")` | **SHOWN** | desktop.errors.settingNotSaved _(shown())_ |
| 63 | `setCaptions` | ipc-call | `setSetting` | **SHOWN** | desktop.errors.settingNotSaved _(via .catch L63)_ |
| 151 | `play > <anonymous>` | .catch | `() => resolve()` | **NOT-WORTH** | a line that won't play (no device, autoplay) just ends; its caption still shows |
| 153 | `play` | catch | `empty` | **NOT-WORTH** | couldn't route to the controller: stay silent (the caption still shows) |
| 174 | `sayInPassing` | .catch | `logged("a narrator line that couldn't play (decoration: its ` | **LOGGED-OK** | a narrator line that couldn't play (decoration: its caption still shows) _(logged())_ |

#### src/desktop/pages/AboutPage.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 87 | `AboutPage > useEffect(cb)` | ipc-call | `firmwareChangelog` | **SHOWN** | english: the firmware changes tab's error (main-process text, batch E3) _(via .catch L90)_ |
| 90 | `AboutPage > useEffect(cb)` | .catch | `(cause) => setFirmwareError(causeText(cause))` | **SHOWN** | english: the firmware changes tab's error (main-process text, batch E3) |

#### src/desktop/pages/FirmwarePage.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 30 | `act` | catch | `fallback` | **SHOWN** | desktop.errors.boardFailed (causeText; other board errors English, batch E3) |
| 71 | `FirmwarePage > onClick=` | .catch | `logged("fw.start (it shows its own errors in the firmware ba` | **LOGGED-OK** | fw.start (it shows its own errors in the firmware banner) _(logged())_ |
| 90 | `FirmwarePage > onClick=` | .catch | `() => undefined` | **NOT-WORTH** | the app check only refreshes the app banner; this button reports the firmware (desktop.firmware.checkedOffline) |
| 90 | `FirmwarePage > onClick=` | ipc-call | `checkForUpdates` | **NOT-WORTH** | the app check only refreshes the app banner; this button reports the firmware (desktop.firmware.checkedOffline) |

#### src/desktop/pages/GamesPage.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 46 | `loadDeclined` | json-parse | `raw` | **NOT-WORTH** | unreadable: nothing declined (every recommended fix is ticked again) _(via catch L47)_ |
| 47 | `loadDeclined` | catch | `fallback: JSON.parse` | **NOT-WORTH** | unreadable: nothing declined (every recommended fix is ticked again) |
| 99 | `useRestartText` | result-field | `useRestartText.blockedBy: LauncherId[]` | **SHOWN** | desktop.games.restartGameRunning (inputs here; this is where blockedBy / problem become text) |
| 99 | `useRestartText` | result-field | `useRestartText.problem: CloseProblem` | **SHOWN** | desktop.games.restartGameRunning (inputs here; this is where blockedBy / problem become text) |
| 209 | `GamesSetup > useCallback(cb)` | ipc-call | `gamesBackups` | **PASSES-ON** | awaited: the caller of useCallback(cb) handles it _(flow)_ |
| 220 | `GamesSetup > useCallback(cb)` | ipc-call | `gamesScan` | **SHOWN** | english: the scan's error on the Games page (main-process text, batch E3) _(via catch L222)_ |
| 222 | `GamesSetup > useCallback(cb)` | catch | `fallback: ipc:gamesScan` | **SHOWN** | english: the scan's error on the Games page (main-process text, batch E3) |
| 234 | `GamesSetup > useEffect(cb)` | .then-reject | `(cause: unknown) => live && setError(causeText(cause))` | **SHOWN** | english: the scan's error on the Games page (main-process text, batch E3; receive's own failure too) |
| 234 | `GamesSetup > useEffect(cb)` | ipc-call | `gamesScan` | **SHOWN** | english: the scan's error on the Games page (main-process text, batch E3; receive's own failure too) |
| 236 | `GamesSetup > useEffect(cb) > then(cb)` | .catch | `(cause: unknown) => setError(causeText(cause))` | **SHOWN** | english: receive's failure (the backups list) on the Games page (batch E3) |
| 236 | `GamesSetup > useEffect(cb) > then(cb)` | void | `receive(r.value, false).catch((cause: unknown) => setError(c` | **SHOWN** | english: receive's failure (the backups list) on the Games page (batch E3) |
| 247 | `GamesSetup > useEffect(cb)` | .catch | `logged("rescan (it shows its own errors)")` | **LOGGED-OK** | rescan (it shows its own errors) _(logged())_ |
| 281 | `apply` | ipc-call | `gamesApply` | **SHOWN** | desktop.errors.badRequest (causeText: a refused request in plain words; main-process text English, batch E3). Was SILENT-BUG: the rescan right after cleared the message at once _(via catch L295)_ |
| 295 | `apply` | catch | `fallback: ipc:gamesApply` | **SHOWN** | desktop.errors.badRequest (causeText: a refused request in plain words; main-process text English, batch E3). Was SILENT-BUG: the rescan right after cleared the message at once |
| 308 | `undo` | ipc-call | `gamesUndo` | **SHOWN** | desktop.errors.badRequest (causeText; main-process text English, batch E3). Was SILENT-BUG: the rescan right after cleared the message at once _(via catch L329)_ |
| 329 | `undo` | catch | `fallback: ipc:gamesUndo` | **SHOWN** | desktop.errors.badRequest (causeText; main-process text English, batch E3). Was SILENT-BUG: the rescan right after cleared the message at once |
| 343 | `installProton` | ipc-call | `installProton` | **SHOWN** | english: the Proton card's message (main-process text, batch E3) _(via catch L346)_ |
| 346 | `installProton` | catch | `fallback: ipc:installProton` | **SHOWN** | english: the Proton card's message (main-process text, batch E3) |
| 422 | `GamesSetup > onClick=` | .catch | `logged("installProton (it shows its own errors)")` | **LOGGED-OK** | installProton (it shows its own errors) _(logged())_ |
| 422 | `GamesSetup > onClick=` | void | `installProton().catch(logged("installProton (it shows its ow` | **LOGGED-OK** | installProton (it shows its own errors) _(via .catch L422)_ |

#### src/desktop/pages/SettingsPage.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 68 | `useGripTest > useCallback(cb)` | .catch | `() => undefined` | **NOT-WORTH** | stopping a test the user stopped; it ends by itself within 3 s |

#### src/desktop/pages/SlotsPage.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 18 | `readMemory` | json-parse | `readPref(SLOT_MEMORY_KEY) ?? "{}"` | **NOT-WORTH** | unreadable memory of each slot's controller: the slots show without its model _(via catch L19)_ |
| 19 | `readMemory` | catch | `fallback: JSON.parse` | **NOT-WORTH** | unreadable memory of each slot's controller: the slots show without its model |
| 55 | `act` | catch | `fallback` | **SHOWN** | desktop.errors.boardFailed (a slot switch / forget / wipe whose save failed; firmware error pass) |

#### src/desktop/pages/TriggersPage.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 20 | `TriggersPage > useEffect(cb) > <anonymous>` | .catch | `() => undefined` | **NOT-WORTH** | leaving the page; a failed "off" leaves the test effect until a game sends its own |
| 20 | `TriggersPage > useEffect(cb) > <anonymous>` | void | `client.previewTrigger(0).catch(() => undefined)` | **NOT-WORTH** | leaving the page; a failed "off" leaves the test effect until a game sends its own |
| 31 | `pick` | catch | `fallback` | **SHOWN** | desktop.errors.boardFailed (causeText; other board errors English, batch E3) |
| 52 | `TriggersPage > onClick=` | .catch | `logged("pick (it shows its own errors)")` | **LOGGED-OK** | pick (it shows its own errors) _(logged())_ |
| 52 | `TriggersPage > onClick=` | void | `pick(i).catch(logged("pick (it shows its own errors)"))` | **LOGGED-OK** | pick (it shows its own errors) _(via .catch L52)_ |

#### src/desktop/SetupScreen.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 44 | `SetupScreen > useEffect(cb)` | ipc-call | `latestFirmware` | **LOGGED-OK** | looking up the firmware to install (without it, Install says desktop.setup.noFirmware) _(via .catch L46)_ |
| 46 | `SetupScreen > useEffect(cb)` | .catch | `logged("looking up the firmware to install (without it, Inst` | **LOGGED-OK** | looking up the firmware to install (without it, Install says desktop.setup.noFirmware) _(logged())_ |
| 54 | `start` | catch | `fallback` | **SHOWN** | english: the install's failure text next to Install (flash errors are English, batch E3) |
| 132 | `UpdatesWithoutDongle > useEffect(cb)` | ipc-call | `latestFirmware` | **LOGGED-OK** | looking up the latest firmware (Check now reports it when asked) _(via .catch L134)_ |
| 134 | `UpdatesWithoutDongle > useEffect(cb)` | .catch | `logged("looking up the latest firmware (Check now reports it` | **LOGGED-OK** | looking up the latest firmware (Check now reports it when asked) _(logged())_ |
| 140 | `check` | .catch | `() => null` | **SHOWN** | desktop.setup.checkFailed (a failed check reads as null, which the line below says) |
| 140 | `check` | .catch | `() => null` | **SHOWN** | desktop.setup.checkFailed (a failed check reads as null, which the line below says) |
| 140 | `check` | ipc-call | `checkForUpdates` | **SHOWN** | desktop.setup.checkFailed (a failed check reads as null, which the line below says) |
| 140 | `check` | ipc-call | `latestFirmware` | **SHOWN** | desktop.setup.checkFailed (a failed check reads as null, which the line below says) |

#### src/desktop/storage.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 12 | `readPref` | catch | `fallback` | **NOT-WORTH** | storage blocked: no saved preference, the default applies |
| 21 | `writePref` | catch | `empty` | **NOT-WORTH** | storage blocked: lasts for this session |

#### src/desktop/tour/Tour.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 160 | `Tour > useEffect(cb)` | .catch | `logged("the tour's welcome line (decoration: its caption sti` | **LOGGED-OK** | the tour's welcome line (decoration: its caption still shows) _(logged())_ |
| 181 | `Tour > useEffect(cb)` | .catch | `logged("the tour's trigger effect")` | **LOGGED-OK** | the tour's trigger effect _(logged())_ |
| 182 | `Tour > useEffect(cb) > <anonymous>` | .catch | `logged("turning the tour's trigger effect off")` | **LOGGED-OK** | turning the tour's trigger effect off _(logged())_ |
| 182 | `Tour > useEffect(cb) > <anonymous>` | void | `client.previewTrigger(0).catch(logged("turning the tour's tr` | **LOGGED-OK** | turning the tour's trigger effect off _(via .catch L182)_ |
| 328 | `Tour > useEffect(cb) > setTimeout(cb)` | .catch | `logged("waiting for the narrator before the tour's next step` | **LOGGED-OK** | waiting for the narrator before the tour's next step _(logged())_ |

#### src/desktop/UpdateBanners.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 13 | `Notice` | result-field | `Notice.error: boolean` | **NOT-WORTH** | \'error\' is the notice's style, not a failure result |
| 56 | `UpdateBanners > onClick=` | ipc-call | `installUpdate` | **PASSES-ON** | returned: the caller of onClick= handles it _(flow)_ |

#### src/desktop/UsbAccessSetup.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 16 | `UsbAccessSetup > useEffect(cb)` | .catch | `logged("checking for the USB access rule (unknown: the butto` | **LOGGED-OK** | checking for the USB access rule (unknown: the button stays offered) _(logged())_ |
| 16 | `UsbAccessSetup > useEffect(cb)` | ipc-call | `usbAccessInstalled` | **LOGGED-OK** | checking for the USB access rule (unknown: the button stays offered) _(via .catch L16)_ |
| 22 | `run` | ipc-call | `setupUsbAccess` | **PASSES-ON** | awaited: the caller of run handles it _(flow)_ |

#### src/desktop/useLiveInput.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 58 | `poll` | catch | `empty` | **NOT-WORTH** | dongle busy or gone: the connection hook handles reconnecting (and says so) |
| 63 | `next` | .catch | `logged("the live input poll (it catches its own errors)")` | **LOGGED-OK** | the live input poll (it catches its own errors) _(logged())_ |
| 63 | `next` | void | `poll().catch(logged("the live input poll (it catches its own` | **LOGGED-OK** | the live input poll (it catches its own errors) _(via .catch L63)_ |
| 97 | `poll` | catch | `empty` | **NOT-WORTH** | dongle busy or gone: the connection hook handles reconnecting (and says so) |
| 102 | `next` | .catch | `logged("the lightbar poll (it catches its own errors)")` | **LOGGED-OK** | the lightbar poll (it catches its own errors) _(logged())_ |
| 102 | `next` | void | `poll().catch(logged("the lightbar poll (it catches its own e` | **LOGGED-OK** | the lightbar poll (it catches its own errors) _(via .catch L102)_ |

#### src/desktop/usePoll.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 12 | `usePoll` | result-field | `usePoll.error: string \| null` | **SHOWN** | english: each caller shows \'error\' next to its readout (board errors are English, batch E3) |
| 34 | `tick` | catch | `fallback` | **SHOWN** | english: returned as \'error\', which the caller shows next to its readout |
| 40 | `usePoll > useEffect(cb)` | .catch | `logged("usePoll's tick (it catches its own errors)")` | **LOGGED-OK** | usePoll's tick (it catches its own errors) _(logged())_ |

#### src/desktop/useUpdates.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 16 | `useAppUpdate > useEffect(cb)` | .catch | `logged("reading the update state at start (updates still arr` | **LOGGED-OK** | reading the update state at start (updates still arrive through onUpdateState) _(logged())_ |
| 16 | `useAppUpdate > useEffect(cb)` | ipc-call | `getUpdateState` | **LOGGED-OK** | reading the update state at start (updates still arrive through onUpdateState) _(via .catch L16)_ |
| 28 | `useFirmwareHold > useEffect(cb)` | .catch | `logged("reading the firmware-write hold at start (changes st` | **LOGGED-OK** | reading the firmware-write hold at start (changes still arrive through onFirmwareHold) _(logged())_ |
| 28 | `useFirmwareHold > useEffect(cb)` | ipc-call | `getFirmwareHold` | **LOGGED-OK** | reading the firmware-write hold at start (changes still arrive through onFirmwareHold) _(via .catch L28)_ |
| 55 | `<module>` | result-field | `FirmwareUpdate.problem: FirmwareLookup["problem"]` | **SHOWN** | desktop.firmware.offline (FirmwarePage: unpublished / offline under Latest) |
| 74 | `useFirmwareUpdate > useCallback(cb)` | ipc-call | `latestFirmware` | **SHOWN** | desktop.firmware.checkedOffline (an unanswered lookup reads as offline) _(via catch L75)_ |
| 75 | `useFirmwareUpdate > useCallback(cb)` | catch | `fallback: ipc:latestFirmware` | **SHOWN** | desktop.firmware.checkedOffline (an unanswered lookup reads as offline) |
| 93 | `useFirmwareUpdate > useEffect(cb)` | .then-reject | `() => live && setProblem("offline")` | **SHOWN** | desktop.firmware.offline (an unanswered lookup reads as offline) |
| 93 | `useFirmwareUpdate > useEffect(cb)` | ipc-call | `latestFirmware` | **SHOWN** | desktop.firmware.offline (an unanswered lookup reads as offline) |
| 124 | `useFirmwareUpdate > useCallback(cb)` | catch | `fallback` | **SHOWN** | english: the firmware banner's error notice with Dismiss (flash errors are English, batch E3) |
| 129 | `useFirmwareUpdate > useCallback(cb)` | .then-reject | `logged("refreshing the offer after a failed install (the fai` | **LOGGED-OK** | refreshing the offer after a failed install (the failure is already shown) _(logged())_ |
| 129 | `useFirmwareUpdate > useCallback(cb)` | ipc-call | `latestFirmware` | **LOGGED-OK** | refreshing the offer after a failed install (the failure is already shown) _(via .then-reject L129)_ |

#### src/desktop/WindowsUsbRepair.tsx

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 24 | `WindowsUsbRepair` | result-field | `WindowsUsbRepair.ok: boolean` | **SHOWN** | english: the repair's message below the button (batch E3) |
| 37 | `run` | ipc-call | `repairWindowsUsb` | **PASSES-ON** | awaited: the caller of run handles it _(flow)_ |

#### src/hooks/useDs5Bridge.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 37 | `<module>` | result-field | `UseDs5BridgeResult.error: string \| null` | **SHOWN** | english: DesktopApp's ErrorNotice with Dismiss (USB and protocol errors are English, batch E3) |
| 126 | `useDs5Bridge > useCallback(cb)` | catch | `fallback` | **SHOWN** | english: the error notice (bridge.error); on Windows an open failure is desktop.windowsUsb.seen on the setup screen instead |
| 156 | `useDs5Bridge > useCallback(cb)` | catch | `fallback` | **SHOWN** | english: the error notice (bridge.error); NotFoundError is the user closing the device picker, not an error |
| 170 | `useDs5Bridge > useCallback(cb)` | catch | `fallback` | **SHOWN** | english: the error notice (bridge.error), and the caller gets false |
| 259 | `useDs5Bridge > useEffect(cb)` | .catch | `logged("connecting to an already-permitted board at start (w` | **LOGGED-OK** | connecting to an already-permitted board at start (without one, the setup screen shows) _(logged())_ |
| 259 | `useDs5Bridge > useEffect(cb)` | void | `autoConnect().catch(logged("connecting to an already-permitt` | **LOGGED-OK** | connecting to an already-permitted board at start (without one, the setup screen shows) _(via .catch L259)_ |
| 294 | `poll` | catch | `empty` | **NOT-WORTH** | gone or busy: the USB events handle reconnecting |
| 300 | `next` | .catch | `logged("the board's identity/settings poll")` | **LOGGED-OK** | the board's identity/settings poll _(logged())_ |
| 300 | `next` | void | `poll().catch(logged("the board's identity/settings poll"))` | **LOGGED-OK** | the board's identity/settings poll _(via .catch L300)_ |
| 317 | `onConnect` | .catch | `logged("connecting to a board that was plugged in (it stays ` | **LOGGED-OK** | connecting to a board that was plugged in (it stays on the setup screen) _(logged())_ |

#### src/i18n/index.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 80 | `<module>` | .catch | `logged("starting i18next")` | **LOGGED-OK** | starting i18next _(logged())_ |

#### src/protocol/bridgeClient.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 412 | `command` | .catch | `() => undefined` | **NOT-WORTH** | the queue's own copy; the caller gets \'run\' with the error |
| 428 | `runCommand` | catch | `rethrow` | **PASSES-ON** | rethrows to the caller _(rethrow)_ |

#### src/protocol/officialFirmware.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 41 | `parseOfficialInfo` | schema | `OfficialInfoSchema.safeParse` | **SHOWN** | desktop.ctrlInfo.officialUnavailable (null makes the lookup "unavailable", said after Refresh) |

#### src/protocol/webUsbTransport.ts

| Line | Function | Kind | Detail | Verdict | Why |
|---|---|---|---|---|---|
| 77 | `close` | catch | `empty` | **NOT-WORTH** | already gone |
| 111 | `transfer` | catch | `rethrow` | **PASSES-ON** | rethrows to the caller _(rethrow)_ |
| 122 | `enqueue` | .then-reject | `task` | **NOT-WORTH** | a task runs after a failed one too; the failure already went to its own caller |
| 124 | `enqueue` | .catch | `() => undefined` | **NOT-WORTH** | the queue's own copy; the caller gets \'run\' with the error |

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
| ignored-call | 0 | 21 | 3 | 0 | 39 | 63 |
| checked-call | 39 | 11 | 0 | 0 | 18 | 68 |
| return-fail | 21 | 0 | 0 | 0 | 41 | 62 |
| result-code | 27 | 0 | 0 | 0 | 0 | 27 |
| validate | 1 | 6 | 0 | 0 | 6 | 13 |
| counter | 0 | 4 | 0 | 0 | 0 | 4 |
| guard | 1 | 0 | 0 | 0 | 15 | 16 |
| **Total** | **89** | **42** | **3** | **0** | **119** | **253** |

How the firmware surfaces an error to the user: the **0xF1 result byte** after an 0xF6 SET (`CMD_RESULT_INVALID` 2, `FAILED` 3, `BUSY` 4, which the app's `bridgeClient` throws as a `CommandError`), an **OLED message** (`"Save FAIL"`, `"Reset FAIL"`, `"Wipe FAIL"`), a **flag the app shows** (`g_c1_flags` 0x02/0x04 → `CORE1_SPEAKER_FAILED` / `CORE1_MIC_FAILED` on the Dongle dashboard, ctrl-test `NO_ANSWER` / `NO_CONTROLLER` in GET 0xEB), or a **counter** (0xF5/0xFB audio drops, `g_fse_fail` on OLED Diagnostics).

**Fixed in this pass (silent bugs, each with a host test):**

| Where | Was | Now | Test |
|---|---|---|---|
| `0xF6 0x04` slot switch (`bt_set_slot`) | the `config_save()` result was dropped: a failed save answered OK, and the switch was lost at power-off | `bt_set_slot` returns whether it saved; `cmd_task` answers `CMD_RESULT_FAILED`; the OLED Slots screen says "Save FAIL" | `cmd_slot_ops_report_a_failed_save` |
| `0xF6 0x05` forget slot (`bt_forget_slot` → `slot_forget`) | `save_slots_to_flash()` result dropped: OK, and the slot came back at power-off | returns the save result; `CMD_RESULT_FAILED`; OLED "Wipe FAIL" | same, `slots_changes_report_a_failed_save` |
| `0xF6 0x06` / OLED Settings "wipe all slots" (`bt_wipe_all_slots` → `slots_wipe_all`) | same; the OLED always said "Slots wiped!" | `CMD_RESULT_FAILED`; OLED "Wipe FAIL" | same |
| `0xF6 0x13` Edge extra buttons (`remap_set_extra`) | a failed flash save answered `CMD_RESULT_INVALID` (the app says "rejected"; the entries were in fact applied) | `remap_set_extra` returns `RemapSet` (Ok / Invalid / NotSaved), and NotSaved answers `CMD_RESULT_FAILED` | `cmd_extra_remap_failed_save_is_failed_not_invalid`, `remap_edge_extras_not_saved` |

No new result code: `CMD_RESULT_FAILED` is one the app already turns into a `CommandError`, and the app now says it in plain words (`desktop.errors.boardFailed`: your board couldn't finish that, for example saving to its memory, and the change may be lost when it powers off). That covers the Slots page and wherever the extra buttons are saved (app fix 24).

**Left for a batch (proposed, not done):**

| Batch | Location | Verdict | Change |
|---|---|---|---|
| F1: an OLED toast on every screen | `src/oled.cpp` `handle_buttons` (long-press brightness save), `lightbar_save_config` (leaving the Lightbar screen), `src/bt.cpp` `l2cap_packet_handler` (`slot_assign` after a new pairing) | SILENT-BUG ×3 | `settings_show_status` only draws on the Settings screen. Add a footer status every screen draws (2 s), and show "Save FAIL" / "Pair not saved" when these saves fail. All three need a flash lockout timeout, so they are rare. |

There are no SWALLOWED rows. The boot-time init saves of a blank sector (config migration, remap, slots) are LOGGED-OK: the RAM copy works, and the next boot retries the save.

### Every failure path, by file

Line numbers are as of this branch. If code moves, the function name finds the row.

#### src/audio.cpp

| Line | Function | Kind | Runs on | Surfaces as | Verdict | Why | Change |
|---|---|---|---|---|---|---|---|
| 212 | `mic_add_queue` | ignored-call `queue_try_add` | callback | counter (mic FIFO level in 0xF5) | **LOGGED-OK** | oldest mic packet is dropped first, so the add cannot fail; a drop is a glitch, not a user action | - |
| 276 | `mic_drain` | ignored-call `tud_audio_write` | core0-loop | g_mic_last_wrote / last_want in OLED Diag + 0xF5 | **LOGGED-OK** | a short USB write is an underrun the PC's audio stack conceals | - |
| 287 | `mic_drain` | checked-call `tud_audio_write` | core0-loop | g_mic_last_wrote / last_want in OLED Diag + 0xF5 | **LOGGED-OK** | a short USB write is an underrun the PC's audio stack conceals | - |
| 541 | `audio_loop` | counter `g_drop_raw` | core0-loop | counter g_drop_raw (0xFB/0xF5, the app's audio counters) | **LOGGED-OK** | realtime audio drops the oldest block, nothing for the user to do | - |
| 545 | `audio_loop` | checked-call `queue_try_add` | core0-loop | printf + g_drop_raw | **LOGGED-OK** | the FIFO was just made room for, so this can't fail in practice | - |
| 602 | `audio_loop` | counter `g_drop_hap` | core0-loop | counter g_drop_hap (0xFB/0xF5) | **LOGGED-OK** | realtime haptics drop the oldest block | - |
| 606 | `audio_loop` | ignored-call `queue_try_add` | core0-loop | counter g_drop_hap | **LOGGED-OK** | room was made on the line above, so the add can't fail | - |
| 655 | `speaker_proc` | checked-call `opus_encode_float` | core1 | the block is skipped (a 10 ms gap) | **LOGGED-OK** | an encode error needs a broken encoder, which core1 flags at start (g_c1_flags 0x02, shown in the app's Dongle dashboard) | - |
| 662 | `speaker_proc` | counter `g_drop_enc` | core1 | counter g_drop_enc (0xF5) | **LOGGED-OK** | realtime speaker drops the oldest packet | - |
| 665 | `speaker_proc` | ignored-call `queue_try_add` | core1 | counted on the line above | **LOGGED-OK** | room was just made, so the add can't fail | - |
| 674 | `mic_push_decoded` | ignored-call `queue_try_add` | core1 | counted on the line above | **LOGGED-OK** | room was just made, so the add can't fail | - |
| 688 | `mic_proc` | checked-call `opus_decode` | core1 | g_mic_last_decoded in OLED Diag | **LOGGED-OK** | a bad packet is one lost 10 ms frame, PLC covers it | - |
| 700 | `mic_proc` | return-fail `false` | core1 | nothing | **NOT-WORTH** | false = no mic frame this pass (session idle), not an error | - |
| 704 | `mic_proc` | return-fail `false` | core1 | nothing | **NOT-WORTH** | false = no mic frame this pass (session idle), not an error | - |
| 710 | `mic_proc` | checked-call `opus_decode` | core1 | g_mic_last_decoded in OLED Diag | **LOGGED-OK** | a bad packet is one lost 10 ms frame, PLC covers it | - |
| 719 | `mic_proc` | return-fail `false` | core1 | nothing | **NOT-WORTH** | false = no mic frame this pass (session idle), not an error | - |
| 743 | `core1_entry` | checked-call `opus_encoder_create` | core1 | g_c1_flags 0x02 (CORE1_SPEAKER_FAILED) in 0xF5, the app's Dongle dashboard says the speaker path failed | **SHOWN** | printf with free heap | - |
| 747 | `core1_entry` | checked-call `opus_encoder_create` | core1 | g_c1_flags 0x02 (CORE1_SPEAKER_FAILED) in 0xF5, the app's Dongle dashboard says the speaker path failed | **SHOWN** | printf with free heap | - |
| 756 | `core1_entry` | ignored-call `opus_encoder_ctl` | core1 | nothing | **NOT-WORTH** | constant, valid encoder settings on an encoder that was just created | - |
| 758 | `core1_entry` | ignored-call `opus_encoder_ctl` | core1 | nothing | **NOT-WORTH** | constant, valid encoder settings on an encoder that was just created | - |
| 760 | `core1_entry` | ignored-call `opus_encoder_ctl` | core1 | nothing | **NOT-WORTH** | constant, valid encoder settings on an encoder that was just created | - |
| 762 | `core1_entry` | ignored-call `opus_encoder_ctl` | core1 | nothing | **NOT-WORTH** | constant, valid encoder settings on an encoder that was just created | - |
| 775 | `core1_entry` | checked-call `opus_decoder_create` | core1 | g_c1_flags 0x04 (CORE1_MIC_FAILED) in 0xF5, the app's Dongle dashboard says the mic path failed | **SHOWN** | printf | - |
| 799 | `core1_entry` | checked-call `mic_proc` | core1 | nothing | **NOT-WORTH** | false = no mic frame this pass (session idle), not an error | - |

#### src/bt.cpp

| Line | Function | Kind | Runs on | Surfaces as | Verdict | Why | Change |
|---|---|---|---|---|---|---|---|
| 137 | `bt_set_slot` | return-fail `false` | core0-loop+user | false to the caller | **NOT-WORTH** | every caller checks the slot first (0xF6 0x04/0x05 answer INVALID, the OLED cursor stays in 0..3) | - |
| 145 | `bt_set_slot` | checked-call `config_save` | core0-loop+user | returned: 0xF6 0x04/0x05/0x06 answer CMD_RESULT_FAILED (the app's command error), the OLED shows "Save FAIL" / "Wipe FAIL" (fixed in this pass: was dropped) | **SHOWN** | - | - |
| 153 | `bt_set_slot` | ignored-call `bt_disconnect` | core0-loop+user | nothing | **NOT-WORTH** | false only when there is no ACL, i.e. already disconnected | - |
| 156 | `bt_set_slot` | ignored-call `gap_inquiry_stop` | core0-loop+user | nothing | **NOT-WORTH** | gap_inquiry_* only fails while an inquiry is already in the wanted state or the stack is off, and INQUIRY_COMPLETE / the watchdog restart it | - |
| 158 | `bt_set_slot` | ignored-call `gap_inquiry_start` | core0-loop+user | nothing | **NOT-WORTH** | gap_inquiry_* only fails while an inquiry is already in the wanted state or the stack is off, and INQUIRY_COMPLETE / the watchdog restart it | - |
| 169 | `bt_forget_slot` | return-fail `false` | core0-loop+user | false to the caller | **NOT-WORTH** | every caller checks the slot first (0xF6 0x04/0x05 answer INVALID, the OLED cursor stays in 0..3) | - |
| 176 | `bt_forget_slot` | checked-call `slot_forget` | core0-loop+user | returned: 0xF6 0x04/0x05/0x06 answer CMD_RESULT_FAILED (the app's command error), the OLED shows "Save FAIL" / "Wipe FAIL" (fixed in this pass: was dropped) | **SHOWN** | - | - |
| 180 | `bt_forget_slot` | ignored-call `bt_disconnect` | core0-loop+user | nothing | **NOT-WORTH** | false only when there is no ACL, i.e. already disconnected | - |
| 188 | `bt_wipe_all_slots` | checked-call `gap_link_key_iterator_init` | core0-loop+user | nothing | **NOT-WORTH** | no stored keys = nothing to drop, the slot table is still wiped | - |
| 205 | `bt_wipe_all_slots` | checked-call `slots_wipe_all` | core0-loop+user | returned: 0xF6 0x04/0x05/0x06 answer CMD_RESULT_FAILED (the app's command error), the OLED shows "Save FAIL" / "Wipe FAIL" (fixed in this pass: was dropped) | **SHOWN** | - | - |
| 209 | `bt_wipe_all_slots` | ignored-call `bt_disconnect` | core0-loop+user | nothing | **NOT-WORTH** | false only when there is no ACL, i.e. already disconnected | - |
| 217 | `bt_send_packet` | ignored-call `l2cap_send` | - | unused (no caller) | **NOT-WORTH** | output goes through bt_write's FIFO | - |
| 224 | `bt_send_control` | ignored-call `l2cap_send` | core0-loop+user | nothing | **NOT-WORTH** | one write on an open control channel (the Edge unlock handshake), fails only if the link just dropped, and everything restarts on reconnect | - |
| 231 | `bt_disconnect` | return-fail `false` | callback+core0-loop+user | nothing | **NOT-WORTH** | false only when there is no ACL, i.e. already disconnected | - |
| 236 | `bt_disconnect` | ignored-call `hci_send_cmd` | callback+core0-loop+user | printf of the step + BTstack's own event | **LOGGED-OK** | the connection watchdog (CONNECT_WATCHDOG_TIMEOUT_US) tears a stalled attempt down and inquiry restarts, the OLED shows not connected | - |
| 257 | `bt_connection_watchdog_tick` | ignored-call `bt_disconnect` | core0-loop | nothing | **NOT-WORTH** | false only when there is no ACL, i.e. already disconnected | - |
| 264 | `bt_connection_watchdog_tick` | ignored-call `gap_inquiry_stop` | core0-loop | nothing | **NOT-WORTH** | gap_inquiry_* only fails while an inquiry is already in the wanted state or the stack is off, and INQUIRY_COMPLETE / the watchdog restart it | - |
| 266 | `bt_connection_watchdog_tick` | ignored-call `gap_inquiry_start` | core0-loop | nothing | **NOT-WORTH** | gap_inquiry_* only fails while an inquiry is already in the wanted state or the stack is off, and INQUIRY_COMPLETE / the watchdog restart it | - |
| 286 | `bt_get_signal_strength` | checked-call `gap_read_rssi` | callback+core0-loop | the RSSI poll retries after 1 s (rssi_poll.h) | **NOT-WORTH** | the OLED shows the last value | - |
| 296 | `bt_l2cap_init` | ignored-call `l2cap_register_service` | boot | boot: two fixed PSMs registered once on a fresh stack | **NOT-WORTH** | can only fail out of memory, which the build sizes for | - |
| 299 | `bt_l2cap_init` | ignored-call `l2cap_register_service` | boot | boot: two fixed PSMs registered once on a fresh stack | **NOT-WORTH** | can only fail out of memory, which the build sizes for | - |
| 331 | `bt_init` | ignored-call `hci_power_control` | boot | boot: power-on of the radio cyw43_arch_init already brought up | **NOT-WORTH** | BTSTACK_EVENT_STATE never reaching WORKING leaves the OLED on its connecting screen | - |
| 364 | `hci_packet_handler` | ignored-call `gap_inquiry_start` | callback | nothing | **NOT-WORTH** | gap_inquiry_* only fails while an inquiry is already in the wanted state or the stack is off, and INQUIRY_COMPLETE / the watchdog restart it | - |
| 409 | `hci_packet_handler` | ignored-call `gap_inquiry_stop` | callback | nothing | **NOT-WORTH** | gap_inquiry_* only fails while an inquiry is already in the wanted state or the stack is off, and INQUIRY_COMPLETE / the watchdog restart it | - |
| 422 | `hci_packet_handler` | ignored-call `hci_send_cmd` | callback | printf of the step + BTstack's own event | **LOGGED-OK** | the connection watchdog (CONNECT_WATCHDOG_TIMEOUT_US) tears a stalled attempt down and inquiry restarts, the OLED shows not connected | - |
| 429 | `hci_packet_handler` | ignored-call `gap_inquiry_start` | callback | nothing | **NOT-WORTH** | gap_inquiry_* only fails while an inquiry is already in the wanted state or the stack is off, and INQUIRY_COMPLETE / the watchdog restart it | - |
| 445 | `hci_packet_handler` | ignored-call `gap_inquiry_start` | callback | nothing | **NOT-WORTH** | gap_inquiry_* only fails while an inquiry is already in the wanted state or the stack is off, and INQUIRY_COMPLETE / the watchdog restart it | - |
| 475 | `hci_packet_handler` | ignored-call `hci_send_cmd` | callback | printf of the step + BTstack's own event | **LOGGED-OK** | the connection watchdog (CONNECT_WATCHDOG_TIMEOUT_US) tears a stalled attempt down and inquiry restarts, the OLED shows not connected | - |
| 482 | `hci_packet_handler` | ignored-call `gap_inquiry_start` | callback | nothing | **NOT-WORTH** | gap_inquiry_* only fails while an inquiry is already in the wanted state or the stack is off, and INQUIRY_COMPLETE / the watchdog restart it | - |
| 503 | `hci_packet_handler` | ignored-call `hci_send_cmd` | callback | printf of the step + BTstack's own event | **LOGGED-OK** | the connection watchdog (CONNECT_WATCHDOG_TIMEOUT_US) tears a stalled attempt down and inquiry restarts, the OLED shows not connected | - |
| 507 | `hci_packet_handler` | ignored-call `hci_send_cmd` | callback | printf of the step + BTstack's own event | **LOGGED-OK** | the connection watchdog (CONNECT_WATCHDOG_TIMEOUT_US) tears a stalled attempt down and inquiry restarts, the OLED shows not connected | - |
| 517 | `hci_packet_handler` | ignored-call `hci_send_cmd` | callback | printf of the step + BTstack's own event | **LOGGED-OK** | the connection watchdog (CONNECT_WATCHDOG_TIMEOUT_US) tears a stalled attempt down and inquiry restarts, the OLED shows not connected | - |
| 526 | `hci_packet_handler` | ignored-call `gap_pin_code_response` | callback | printf of the step + BTstack's own event | **LOGGED-OK** | the connection watchdog (CONNECT_WATCHDOG_TIMEOUT_US) tears a stalled attempt down and inquiry restarts, the OLED shows not connected | - |
| 542 | `hci_packet_handler` | ignored-call `bt_disconnect` | callback | nothing | **NOT-WORTH** | false only when there is no ACL, i.e. already disconnected | - |
| 545 | `hci_packet_handler` | ignored-call `hci_send_cmd` | callback | printf of the step + BTstack's own event | **LOGGED-OK** | the connection watchdog (CONNECT_WATCHDOG_TIMEOUT_US) tears a stalled attempt down and inquiry restarts, the OLED shows not connected | - |
| 563 | `hci_packet_handler` | ignored-call `l2cap_create_channel` | callback | printf of the step + BTstack's own event | **LOGGED-OK** | the connection watchdog (CONNECT_WATCHDOG_TIMEOUT_US) tears a stalled attempt down and inquiry restarts, the OLED shows not connected | - |
| 578 | `hci_packet_handler` | ignored-call `gap_inquiry_stop` | callback | nothing | **NOT-WORTH** | gap_inquiry_* only fails while an inquiry is already in the wanted state or the stack is off, and INQUIRY_COMPLETE / the watchdog restart it | - |
| 580 | `hci_packet_handler` | ignored-call `hci_send_cmd` | callback | printf of the step + BTstack's own event | **LOGGED-OK** | the connection watchdog (CONNECT_WATCHDOG_TIMEOUT_US) tears a stalled attempt down and inquiry restarts, the OLED shows not connected | - |
| 619 | `hci_packet_handler` | ignored-call `gap_inquiry_start` | callback | nothing | **NOT-WORTH** | gap_inquiry_* only fails while an inquiry is already in the wanted state or the stack is off, and INQUIRY_COMPLETE / the watchdog restart it | - |
| 662 | `l2cap_packet_handler` | ignored-call `bt_disconnect` | callback | nothing | **NOT-WORTH** | false only when there is no ACL, i.e. already disconnected | - |
| 716 | `l2cap_packet_handler` | ignored-call `slot_assign` | callback | nothing | **SILENT-BUG** | a new controller's pairing works now but a failed slot save loses it at power-off (rare: flash lockout timeout) | show "Pair not saved" on the OLED (batch: an OLED toast on every screen) |
| 728 | `l2cap_packet_handler` | ignored-call `l2cap_create_channel` | callback | printf of the step + BTstack's own event | **LOGGED-OK** | the connection watchdog (CONNECT_WATCHDOG_TIMEOUT_US) tears a stalled attempt down and inquiry restarts, the OLED shows not connected | - |
| 770 | `l2cap_packet_handler` | ignored-call `bt_disconnect` | callback | nothing | **NOT-WORTH** | false only when there is no ACL, i.e. already disconnected | - |
| 796 | `l2cap_packet_handler` | ignored-call `bt_disconnect` | callback | nothing | **NOT-WORTH** | false only when there is no ACL, i.e. already disconnected | - |
| 807 | `l2cap_packet_handler` | checked-call `l2cap_send` | callback | printf of the L2CAP status | **LOGGED-OK** | one output report lost, the game's next one (sent every frame) replaces it | - |
| 814 | `l2cap_packet_handler` | ignored-call `l2cap_request_can_send_now_event` | callback | nothing | **NOT-WORTH** | asking for a CAN_SEND_NOW on an open channel only fails if the channel just closed, and DISCONNECTION clears the FIFO | - |
| 839 | `bt_write` | guard `hid_interrupt_cid == 0` | callback+core0-loop+user | nothing | **NOT-WORTH** | no controller connected: the PC's output report has nowhere to go (the app and OLED already show no controller) | - |
| 853 | `bt_write` | checked-call `queue_try_add` | callback+core0-loop+user | printf | **LOGGED-OK** | the output FIFO is full, this report is dropped and the next state write (games send every frame, the app re-sends on change) replaces it | - |
| 859 | `bt_write` | ignored-call `l2cap_request_can_send_now_event` | callback+core0-loop+user | nothing | **NOT-WORTH** | asking for a CAN_SEND_NOW on an open channel only fails if the channel just closed, and DISCONNECTION clears the FIFO | - |
| 884 | `get_feature_data` | ignored-call `l2cap_send` | callback+core0-loop+user | nothing here | **LOGGED-OK** | every caller polls for the answer with a deadline: ctrl tests end NO_ANSWER (shown by the app), the colorway read gives up (no color), the 0x09/0x20/0x05 host GETs answer from the cache | - |
| 911 | `set_feature_data` | ignored-call `l2cap_send` | callback+core0-loop+user | nothing here | **LOGGED-OK** | every caller polls for the answer with a deadline: ctrl tests end NO_ANSWER (shown by the app), the colorway read gives up (no color), the 0x09/0x20/0x05 host GETs answer from the cache | - |

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
| 157 | `controller_info_task` | guard `!connected` | core0-loop+user | nothing | **NOT-WORTH** | scheduling of the colorway read (not connected / not due / test slot busy); a read that never answers leaves the colorway unknown, the app draws the default | - |
| 161 | `controller_info_task` | guard `now < s_color_due_us \|\| !may_start` | core0-loop+user | nothing | **NOT-WORTH** | scheduling of the colorway read (not connected / not due / test slot busy); a read that never answers leaves the colorway unknown, the app draws the default | - |
| 171 | `controller_info_task` | guard `now < s_color_due_us` | core0-loop+user | nothing | **NOT-WORTH** | scheduling of the colorway read (not connected / not due / test slot busy); a read that never answers leaves the colorway unknown, the app draws the default | - |
| 232 | `cmd_task` | guard `!s_pending \|\| time_us_64 () < s_pending_due_us` | core0-loop+user | nothing | **NOT-WORTH** | no deferred command due yet (scheduling) | - |
| 238 | `cmd_task` | checked-call `config_save` | core0-loop+user | CMD_RESULT_FAILED in the 0xF1 result byte, the app's command error (save failed) | **SHOWN** | - | - |
| 243 | `cmd_task` | checked-call `bt_set_slot` | core0-loop+user | CMD_RESULT_FAILED in the 0xF1 result byte, the app's command error (fixed in this pass: a failed slot save said OK) | **SHOWN** | - | - |
| 248 | `cmd_task` | checked-call `bt_forget_slot` | core0-loop+user | CMD_RESULT_FAILED in the 0xF1 result byte, the app's command error (fixed in this pass: a failed slot save said OK) | **SHOWN** | - | - |
| 252 | `cmd_task` | checked-call `bt_wipe_all_slots` | core0-loop+user | CMD_RESULT_FAILED in the 0xF1 result byte, the app's command error (fixed in this pass: a failed slot save said OK) | **SHOWN** | - | - |
| 268 | `cmd_task` | checked-call `config_save` | core0-loop+user | CMD_RESULT_FAILED in the 0xF1 result byte, the app's command error (save failed) | **SHOWN** | - | - |
| 275 | `cmd_task` | result-code `CMD_RESULT_FAILED` | core0-loop+user | CMD_RESULT_FAILED in the 0xF1 result byte: no controller connected, the app's command error | **SHOWN** | - | - |
| 285 | `cmd_task` | result-code `CMD_RESULT_FAILED` | core0-loop+user | CMD_RESULT_FAILED in the 0xF1 result byte: no controller connected, the app's command error | **SHOWN** | - | - |
| 294 | `cmd_task` | checked-call `config_save_narrator` | core0-loop+user | CMD_RESULT_FAILED in the 0xF1 result byte, the app's command error (save failed) | **SHOWN** | - | - |
| 299 | `cmd_task` | checked-call `config_save_power_flags` | core0-loop+user | CMD_RESULT_FAILED in the 0xF1 result byte, the app's command error (save failed) | **SHOWN** | - | - |
| 304 | `cmd_task` | result-code `CMD_RESULT_INVALID` | core0-loop+user | CMD_RESULT_INVALID in the 0xF1 result byte: unknown function, the app's command error | **SHOWN** | - | - |
| 392 | `pico_cmd_get` | return-fail `0` | callback | USB STALL to the host | **NOT-WORTH** | a request shorter than the reply (the app always asks the full length, its transport reports a short reply) | - |
| 408 | `pico_cmd_get` | return-fail `0` | callback | USB STALL to the host | **NOT-WORTH** | a request shorter than the reply (the app always asks the full length, its transport reports a short reply) | - |
| 420 | `pico_cmd_get` | return-fail `0` | callback | USB STALL to the host | **NOT-WORTH** | a request shorter than the reply (the app always asks the full length, its transport reports a short reply) | - |
| 442 | `pico_cmd_get` | return-fail `0` | callback | USB STALL to the host | **NOT-WORTH** | a request shorter than the reply (the app always asks the full length, its transport reports a short reply) | - |
| 544 | `pico_cmd_get` | return-fail `0` | callback | USB STALL to the host | **NOT-WORTH** | a request shorter than the reply (the app always asks the full length, its transport reports a short reply) | - |
| 559 | `pico_cmd_get` | return-fail `0` | callback | USB STALL to the host | **NOT-WORTH** | a request shorter than the reply (the app always asks the full length, its transport reports a short reply) | - |
| 579 | `pico_cmd_get` | return-fail `0` | callback | USB STALL to the host | **NOT-WORTH** | a request shorter than the reply (the app always asks the full length, its transport reports a short reply) | - |
| 612 | `pico_cmd_get` | return-fail `0` | callback | USB STALL to the host | **NOT-WORTH** | a request shorter than the reply (the app always asks the full length, its transport reports a short reply) | - |
| 641 | `pico_cmd_get` | return-fail `0` | callback | USB STALL to the host | **NOT-WORTH** | a request shorter than the reply (the app always asks the full length, its transport reports a short reply) | - |
| 765 | `pico_cmd_get` | return-fail `0` | callback | USB STALL | **NOT-WORTH** | an unknown report id (the app only asks the ids identity lists) | - |
| 785 | `pico_cmd_set` | result-code `CMD_RESULT_BUSY` | callback+user | CMD_RESULT_BUSY in the 0xF1 result byte: a deferred command is still pending | **SHOWN** | the app waits for 0xF1 first and shows a command error if it ever sees BUSY | - |
| 834 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: bad argument or framing, the app's command error | **SHOWN** | - | - |
| 849 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: bad argument or framing, the app's command error | **SHOWN** | - | - |
| 858 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: bad argument or framing, the app's command error | **SHOWN** | - | - |
| 867 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: bad argument or framing, the app's command error | **SHOWN** | - | - |
| 872 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: bad argument or framing, the app's command error | **SHOWN** | - | - |
| 877 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: bad argument or framing, the app's command error | **SHOWN** | - | - |
| 879 | `pico_cmd_set` | result-code `CMD_RESULT_FAILED` | callback+user | CMD_RESULT_FAILED in the 0xF1 result byte: no controller connected, the app's command error | **SHOWN** | - | - |
| 898 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: controller tests not built in (no vendor interface), the app only offers them when identity [46] bit0 says so | **SHOWN** | - | - |
| 907 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: unknown function, the app's command error | **SHOWN** | - | - |
| 923 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: bad argument or framing, the app's command error | **SHOWN** | - | - |
| 927 | `pico_cmd_set` | checked-call `calib_set` | callback+user | mapped to CMD_RESULT_INVALID / FAILED in the 0xF1 result byte on the lines below | **SHOWN** | - | - |
| 930 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: an invalid table/curve/calibration, the app's command error | **SHOWN** | - | - |
| 932 | `pico_cmd_set` | result-code `CMD_RESULT_FAILED` | callback+user | CMD_RESULT_FAILED in the 0xF1 result byte: applied but not saved, the app's command error | **SHOWN** | - | - |
| 950 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: bad argument or framing, the app's command error | **SHOWN** | - | - |
| 956 | `pico_cmd_set` | checked-call `curves_set` | callback+user | mapped to CMD_RESULT_INVALID / FAILED in the 0xF1 result byte on the lines below | **SHOWN** | - | - |
| 959 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: an invalid table/curve/calibration, the app's command error | **SHOWN** | - | - |
| 961 | `pico_cmd_set` | result-code `CMD_RESULT_FAILED` | callback+user | CMD_RESULT_FAILED in the 0xF1 result byte: applied but not saved, the app's command error | **SHOWN** | - | - |
| 969 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: bad argument or framing, the app's command error | **SHOWN** | - | - |
| 973 | `pico_cmd_set` | checked-call `remap_set_extra` | callback+user | mapped to CMD_RESULT_INVALID / FAILED in the 0xF1 result byte on the lines below | **SHOWN** | - | - |
| 976 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: an invalid table/curve/calibration, the app's command error | **SHOWN** | - | - |
| 980 | `pico_cmd_set` | result-code `CMD_RESULT_FAILED` | callback+user | CMD_RESULT_FAILED in the 0xF1 result byte: applied but not saved (fixed in this pass: said INVALID, "rejected") | **SHOWN** | - | - |
| 989 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: bad argument or framing, the app's command error | **SHOWN** | - | - |
| 998 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: bad argument or framing, the app's command error | **SHOWN** | - | - |
| 1004 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: bad argument or framing, the app's command error | **SHOWN** | - | - |
| 1008 | `pico_cmd_set` | checked-call `remap_set` | callback+user | mapped to CMD_RESULT_INVALID / FAILED in the 0xF1 result byte on the lines below | **SHOWN** | - | - |
| 1015 | `pico_cmd_set` | result-code `CMD_RESULT_INVALID` | callback+user | CMD_RESULT_INVALID in the 0xF1 result byte: an invalid table/curve/calibration, the app's command error | **SHOWN** | - | - |
| 1020 | `pico_cmd_set` | result-code `CMD_RESULT_FAILED` | callback+user | CMD_RESULT_FAILED in the 0xF1 result byte: applied but not saved, the app's command error | **SHOWN** | - | - |

#### src/config.cpp

| Line | Function | Kind | Runs on | Surfaces as | Verdict | Why | Change |
|---|---|---|---|---|---|---|---|
| 41 | `config_valid` | validate `config.magic != CONFIG_MAGIC` | callback+core0-loop+user | printf | **LOGGED-OK** | a blank or old sector gets defaults; RAM then differs from flash, which the app shows as unsaved settings (identity [19] bit0) | - |
| 158 | `config_unsaved` | validate `saved->magic != CONFIG_MAGIC` | callback | nothing | **NOT-WORTH** | reads which copy to start from (no valid save yet = the RAM copy), not a failure | - |
| 168 | `config_load` | validate `config.magic != CONFIG_MAGIC` | boot | printf in config_valid | **LOGGED-OK** | first boot / erased sector, defaults are the right answer; shown as unsaved settings in the app | - |
| 172 | `config_load` | validate `legacy.magic == CONFIG_MAGIC, legacy.crc32 == calc_config_crc (legacy` | boot | printf on migration | **LOGGED-OK** | a bad legacy copy is ignored (defaults, shown as unsaved settings) | - |
| 177 | `config_load` | ignored-call `config_save` | boot | printf | **LOGGED-OK** | boot-time init save of the migrated settings: the RAM copy works now and the next boot retries the save | - |
| 202 | `write_config` | checked-call `flash_sector_write` | core0-loop+user | passed up | **SHOWN** | the callers report it (0xF1 CMD_RESULT_FAILED to the app, the OLED's "Save FAIL") | - |
| 205 | `write_config` | return-fail `false` | core0-loop+user | passed up | **SHOWN** | the callers report it (0xF1 CMD_RESULT_FAILED to the app, the OLED's "Save FAIL") | - |
| 212 | `write_config` | validate `verify_crc32 == con.crc32` | core0-loop+user | passed up | **SHOWN** | the callers report it (0xF1 CMD_RESULT_FAILED to the app, the OLED's "Save FAIL") | - |
| 218 | `write_config` | return-fail `false` | core0-loop+user | passed up | **SHOWN** | the callers report it (0xF1 CMD_RESULT_FAILED to the app, the OLED's "Save FAIL") | - |
| 222 | `config_save` | checked-call `write_config` | core0-loop+user | passed up | **SHOWN** | the callers report it (0xF1 CMD_RESULT_FAILED to the app, the OLED's "Save FAIL") | - |
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
| 173 | `ctrl_test_task` | guard `!may_send` | core0-loop+user | nothing | **NOT-WORTH** | scheduling (test slot busy / reply taken); the request's deadline ends it as NO_ANSWER, which GET 0xEB reports and the app shows | - |
| 189 | `ctrl_test_task` | guard `take_reply (r)` | core0-loop+user | nothing | **NOT-WORTH** | scheduling (test slot busy / reply taken); the request's deadline ends it as NO_ANSWER, which GET 0xEB reports and the app shows | - |

#### src/dse.cpp

| Line | Function | Kind | Runs on | Surfaces as | Verdict | Why | Change |
|---|---|---|---|---|---|---|---|
| 109 | `dse_task` | guard `!may_use_test_slot` | core0-loop+user | nothing | **NOT-WORTH** | scheduling of the Edge profile unlock/fetch (test slot busy, settle and gap timers), retried next pass | - |
| 132 | `dse_task` | guard `now - s_written_us < kSaveSettleUs \|\| !may_use_test_slot` | core0-loop+user | nothing | **NOT-WORTH** | scheduling of the Edge profile unlock/fetch (test slot busy, settle and gap timers), retried next pass | - |
| 151 | `dse_task` | guard `now - s_last_get_us < kFetchGapUs` | core0-loop+user | nothing | **NOT-WORTH** | scheduling of the Edge profile unlock/fetch (test slot busy, settle and gap timers), retried next pass | - |

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
| 373 | `get_report_impl` | return-fail `0` | callback | USB STALL on purpose until the Edge profiles are cached (PS Accessories retries) | **NOT-WORTH** | the read is started here | - |
| 433 | `__wrap_flash_safe_execute` | counter `g_fse_fail` | - | counter g_fse_fail (OLED Diag) | **LOGGED-OK** | the failed write itself is reported by its caller | - |
| 441 | `host_out02_forward` | return-fail `false` | callback | nothing | **NOT-WORTH** | a malformed/short host report isn't forwarded (counted only when forwarded, g_host_out02_to_bt); games send well-formed ones every frame | - |
| 446 | `host_out02_forward` | return-fail `false` | callback | nothing | **NOT-WORTH** | a malformed/short host report isn't forwarded (counted only when forwarded, g_host_out02_to_bt); games send well-formed ones every frame | - |
| 512 | `tud_hid_set_report_cb` | checked-call `host_out02_forward` | callback | nothing | **NOT-WORTH** | a malformed/short host report isn't forwarded (counted only when forwarded, g_host_out02_to_bt); games send well-formed ones every frame | - |
| 556 | `main` | ignored-call `tusb_init` | boot | boot: TinyUSB init with a fixed, valid config | **NOT-WORTH** | failure would leave no USB device at all (no app to tell), the OLED still runs | - |
| 561 | `main` | ignored-call `tud_disconnect` | boot | nothing | **NOT-WORTH** | boot: disconnect of a device that was just initialized | - |
| 577 | `main` | checked-call `cyw43_arch_init` | boot | printf and main() returns: no radio, nothing can run | **LOGGED-OK** | the board shows no OLED/USB activity, a hardware fault | - |

#### src/oled.cpp

| Line | Function | Kind | Runs on | Surfaces as | Verdict | Why | Change |
|---|---|---|---|---|---|---|---|
| 621 | `handle_buttons` | ignored-call `config_save` | core0-loop+user | nothing | **SILENT-BUG** | the long-press screen brightness applies now but a failed save loses it at power-off | show "Save FAIL" on whichever screen is up (batch: an OLED toast on every screen) |
| 1001 | `diag_handle_input` | guard `!bt_is_connected ()` | core0-loop+user | nothing | **NOT-WORTH** | input comes from the controller, so with none connected there's no button press to handle | - |
| 1526 | `lightbar_save_config` | ignored-call `config_save` | core0-loop | nothing | **SILENT-BUG** | the Lightbar screen's mode/favorites apply now but a failed save on leaving the screen loses them at power-off | show "Save FAIL" (batch: an OLED toast on every screen) |
| 1678 | `settings_handle_input` | guard `!bt_is_connected ()` | core0-loop+user | nothing | **NOT-WORTH** | input comes from the controller, so with none connected there's no button press to handle | - |
| 1707 | `settings_handle_input` | checked-call `config_save` | core0-loop+user | OLED footer "Reset FAIL" / "Save FAIL" | **SHOWN** | - | - |
| 1718 | `settings_handle_input` | checked-call `bt_wipe_all_slots` | core0-loop+user | OLED footer "Wipe FAIL" (fixed in this pass: always said "Slots wiped!") | **SHOWN** | - | - |
| 1726 | `settings_handle_input` | checked-call `config_save` | core0-loop+user | OLED footer "Reset FAIL" / "Save FAIL" | **SHOWN** | - | - |
| 1885 | `slots_handle_input` | checked-call `bt_set_slot` | core0-loop+user | OLED Slots status "Save FAIL" / "Wipe FAIL" (fixed in this pass: always said done) | **SHOWN** | - | - |
| 1901 | `slots_handle_input` | checked-call `bt_forget_slot` | core0-loop+user | OLED Slots status "Save FAIL" / "Wipe FAIL" (fixed in this pass: always said done) | **SHOWN** | - | - |

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

#### src/slots.cpp

| Line | Function | Kind | Runs on | Surfaces as | Verdict | Why | Change |
|---|---|---|---|---|---|---|---|
| 37 | `save_slots_to_flash` | checked-call `flash_sector_write` | callback+core0-loop+user | printf + returned to the slot changes, which report it (0xF1 CMD_RESULT_FAILED, the OLED's "Save FAIL"/"Wipe FAIL") | **SHOWN** | - | - |
| 40 | `save_slots_to_flash` | return-fail `false` | callback+core0-loop+user | printf + returned to the slot changes, which report it (0xF1 CMD_RESULT_FAILED, the OLED's "Save FAIL"/"Wipe FAIL") | **SHOWN** | - | - |
| 51 | `save_slots_to_flash` | return-fail `false` | callback+core0-loop+user | printf + returned to the slot changes, which report it (0xF1 CMD_RESULT_FAILED, the OLED's "Save FAIL"/"Wipe FAIL") | **SHOWN** | - | - |
| 57 | `slots_load` | validate `g_slots.magic != SLOTS_MAGIC` | boot | printf | **LOGGED-OK** | first boot / erased sector: no paired controllers, which the app and OLED show as empty slots | - |
| 62 | `slots_load` | ignored-call `save_slots_to_flash` | boot | printf | **LOGGED-OK** | boot-time init save of a blank sector: the RAM copy works now and the next boot retries the save | - |
| 95 | `slot_owner_of` | return-fail `- 1` | callback | nothing | **NOT-WORTH** | -1 = no slot owns this address (a lookup), not an error | - |
| 100 | `slot_assign` | return-fail `false` | callback | false for a slot outside 0..3 | **NOT-WORTH** | every caller passes a checked slot | - |
| 104 | `slot_assign` | checked-call `save_slots_to_flash` | callback | returned: the callers report a failed save (fixed in this pass: was dropped) | **SHOWN** | - | - |
| 109 | `slot_forget` | return-fail `false` | core0-loop+user | false for a slot outside 0..3 | **NOT-WORTH** | every caller passes a checked slot | - |
| 113 | `slot_forget` | checked-call `save_slots_to_flash` | core0-loop+user | returned: the callers report a failed save (fixed in this pass: was dropped) | **SHOWN** | - | - |
| 123 | `slots_wipe_all` | checked-call `save_slots_to_flash` | core0-loop+user | returned: the callers report a failed save (fixed in this pass: was dropped) | **SHOWN** | - | - |

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
