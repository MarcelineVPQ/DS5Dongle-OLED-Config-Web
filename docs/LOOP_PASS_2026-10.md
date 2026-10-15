# Loop pass: every loop that waits or sits on a hot path, with a verdict

_2026-10-13. Done per CLAUDE.md "Loop pass" (the AVIEW serial-loop pass, adapted to the app and the firmware). This is the one doc for both repos: the firmware's CLAUDE.md links here. The owner picks which batches to do. **Batch 1 is done** (dev.10, see below). **Batches 3 and 4 are done** (2026-10-15, branch `passes-095`), and batch 4's swirl CPU fallback was decided and done 2026-10-15 (branch `swirl-fallback`: a still frame without a real graphics card). Batch 2 is firmware and waits for a firmware task with hardware tests. The app tables were re-run after master's Games redesign was merged in (507 loops), after batch 1 (508), and after batches 3 and 4 (613; the rows added since are new code)._

## How the list was made

Two listers, one per repo. Each lists every candidate mechanically; nothing is sampled by eye.

**App** (`tools/list_loops.mjs`, TypeScript compiler API with the type checker). It looks at every `for` / `for-of` / `for-in` / `for await` / `while` / `do` loop and every array iteration callback in `src/` and `electron/`. The callbacks are `.map`, `.forEach`, `.reduce`, `.filter`, `.some`, `.every`, `.find*`, `.flatMap`, `.sort` and `.toSorted`, on Array, Set, Map or typed arrays (the checker confirms the receiver). Tests and the vendored `src/flash/picoflash` are excluded. A loop is listed when it matches at least one trigger:

- **await**: the body awaits, so the work is serial. Nested functions don't count, except an async array callback.
- **hot**: it runs on a hot path. The roots are:
  - a component or hook render, including `useMemo`, and a `useEffect` body (it re-runs when its deps change, which for live input is every frame);
  - a `requestAnimationFrame` or `setInterval` callback, or a React state updater inside one;
  - a poll: `usePoll`'s read, or a function that re-arms itself with `setTimeout`;
  - a WebUSB connect/disconnect handler;
  - the audio worklet's `process()`;
  - the game library scan.

  Everything those roots call counts too. Calls are resolved with the type checker, through interfaces and their classes or object literals, factory-returned functions, and default-parameter functions.
- **nested**: inside another loop in the same function (an O(n²) candidate).

The trigger column shows which hot root reached the loop: `render`, `effect`, `raf`, `interval`, `poll`, `usb-event`, `audio` or `scan`.

**Firmware** (`tools/list_loops.py` in the firmware repo; standard library only, a brace-aware scanner that honours `#if` groups). It lists every `for` / `while` / `do` loop in `src/` (`lib/` excluded) with:

- **Runs on**, from a name-based call graph over `src/`:
  - `core1`: reached from `core1_entry`.
  - `core0-loop`: reached from `main()`'s forever loop.
  - `callback`: a TinyUSB `tud_*_cb`, a BTstack handler, a `flash_safe_execute` callback, or any function whose address is taken.
  - `isr`.
  - `boot`.
  - `-`: not reached; constexpr or host-test only.
- **Wait**: `forever`, `spin`, `drain`, `+timeout` / `+bounded`.
- **Nesting**.
- Whether the body touches flash.

**Every row has exactly one verdict**, written as a comment on the loop (`// loop: VERDICT — reason`). The gates fail on a listed loop without one: `npm run gates` and CI here, and `build.yml` / `release.yml` in the firmware. Line numbers are as of the batch 3/4 commit (2026-10-15); if code moves, the function name finds the loop.

| Verdict | App | Firmware | Meaning |
|---|---|---|---|
| PARALLELIZE | 1 | 0 | Independent async work per step. Run it with a bound. (The app's one row is batch 3's read-ahead itself, 8 at a time.) |
| BATCH | 0 | 0 | One call, read or index instead of N. |
| SERIAL-REQUIRED | 26 | 3 | Must stay in order, for the reason given: one HID session, PICOBOOT session order, a deadline, launcher order, stream order, or a data dependency. |
| HOT-PATH-OK | 374 | 55 | Runs per frame, poll or pass, but N is small and bounded (N is stated). |
| FIX-HOT-PATH | 0 | 1 | Per-frame or per-poll work that shouldn't be there (allocation, sort, O(n²), DOM queries, CPU pixel work, a blocking read on core0's loop). The app's two rows (the swirl's CPU fallback) were fixed 2026-10-15: a still frame, never on the frame clock. |
| NOT-WORTH | 212 | 69 | Tiny N, or startup-only / rare. |
| **Total** | **613** | **128** | |

After batch 1 (508 app rows): PARALLELIZE 7, BATCH 5, SERIAL-REQUIRED 20, HOT-PATH-OK 340, FIX-HOT-PATH 6, NOT-WORTH 130.

When first listed (491 app rows: PARALLELIZE 7, BATCH 5, SERIAL-REQUIRED 16, HOT-PATH-OK 312, FIX-HOT-PATH 28, NOT-WORTH 123), the app rows came from these hot roots (a row can have more than one): render 242, effect 24, library scan 105, poll 39, WebUSB connect/disconnect handlers 32 (they reach the same client code as the polls), interval 32, rAF 16, audio worklet 1. Another 45 rows are only nested or only await.

## The work: proposed changes in 4 batches (biggest effect first)

Every change keeps the current behaviour and needs a test that pins it.

### Batch 1: every live frame on the controller view (~30 Hz)

**DONE for dev.10** (branch `loop-pass`). What changed:

- `useRemap` returns one object per change (`useMemo`), so `AllButtonsList` and `SavedLayouts` (`memo`) skip live frames.
- Each layout's game count is worked out once per library change, and the layouts are sorted once per library change.
- Stick-curve nodes are built once per curve object (a `WeakMap`), and the curve graph's 65-point path is memoized on the curve.
- A finished drift test's stats are worked out once (`useMemo`), and `DriftPlot` is `memo`.
- The drawing looks up the trigger gradient stops and the touchpad box once at mount, and writes a trigger's stops only when its value changed.

`tests/integration/liveFrameWork.test.ts` counts the work across 30 live frames for each of these, and it fails on the old code. The rows' verdicts are now HOT-PATH-OK (Change: "Done in batch 1").

**Measured** on an isolated copy: a dev build, the simulated board, Xvfb with software rendering, no USB, its own home folder. Each scenario ran for 20 s, two runs per build, averaged.

| View | Renderer script time before → after (ms per s) | Whole-app CPU before → after (% of one core) |
|---|---|---|
| Controller, overview | 52.3 → 51.3 | 56.2 → 55.9 |
| Controller, Buttons list | 64.8 → 53.2 (−18%) | 61.6 → 60.5 |
| Controller, calibration (curve graphs) | 53.0 → 54.3 | 57.4 → 61.1 |
| Calibration, after a drift test | 84.4 → 74.3 (−12%) | 72.2 → 71.1 |

The script time drops where the removed work lived: the Buttons list and the drift results. Whole-app CPU on software rendering is dominated by painting and compositing; the difference there is within run-to-run noise (±3 points), and the calibration row's rise is noise too. On a real GPU the painting share is smaller.

The original batch:

`ControllerView` re-renders on each live input frame (~30 Hz) whenever the window is visible and a controller is connected. `PartPanel` and its sections aren't memoized, so whatever panel is open re-renders with it. These run all the time someone looks at the app.

| Location | Function | Runs | Why | Change |
|---|---|---|---|---|
| `src/desktop/live/PartPanel.tsx:319, 338, 351, 366` | `AllButtonsSection` | ~340 `<option>`s / ~30 Hz while the Buttons list is open | The whole remap list is rebuilt every frame though nothing in it depends on input. | `memo` the section, with stable props. |
| `src/desktop/live/PartPanel.tsx:411, 413, 428` | `ButtonLayoutsSection`, `usedBy` | layouts × games × 2 / ~30 Hz | Sorts the layouts, and filters every game twice per layout, every frame. | `memo` the section; `useMemo` the sort and a per-layout use count (one pass over the games per library change). |
| `src/protocol/stickCurve.ts:130` | `nodesOf` (via `curveAt`) | 65 calls × 2 graphs / ~30 Hz | Each `curveAt` call re-validates the curve and rebuilds its node arrays (33 nodes for presets). | Build the nodes once per curve: `curveAt`/`applyCurve` take the nodes, or `CurveGraph` `useMemo`s the path on `curve`. |
| `src/desktop/live/StickTestCards.tsx:165, 236, 238, 240`; `stickTests.ts:108-124` | `StickTests`, `DriftPlot`, `driftStats` | 2 × ~300 samples / ~30 Hz after a drift test | The results and plot paths are recomputed every frame, though the samples are fixed once the test ends. | `useMemo` the stats and paths on the finished samples. |
| `src/desktop/live/LiveController.tsx:245, 265` | `LiveArt` effect | 2 DOM queries + 1 string parse / ~30 Hz | `querySelectorAll` for the trigger fill stops and a parse of the touchpad `data-box` on every frame. | Look both up once at mount, next to the parts index. |

### Batch 2: firmware, core0's main loop

| Location | Function | Runs | Why | Change |
|---|---|---|---|---|
| `src/cmd.cpp:58` | `cpu_temp_raw_smoothed` | 256 blocking `adc_read()`s (~0.5 ms) in one pass / 10 Hz on the CPU screen, and per `0xFC` GET | One main-loop pass stalls ~0.5 ms, and the USB audio and BT paths wait behind it. | Take a few samples per pass into a running sum (or 16-32 samples plus the EMA it already has). |

Check before deciding (these are not loop rows, but they turned up in the pass):

- **Input-path functions run from flash.** `calib_apply`, `remap_apply` and `stick_curve_eval` run on every input report, called from `interrupt_loop`, which is RAM-resident. They are not `CORE0_RAM_FUNC`, so they run from flash, against the "core0's hot path is in RAM" rule. Measure with `0xFC` before and after.
- **A heap allocation every pass.** Until feature report `0x05` arrives on a new connection, `calib_service` calls `bt_peek_feature(0x05)` every core0 pass, and `imu_cal_service` calls it every OLED tick. That function returns a `std::vector`, so each call allocates. Fix: cache an "0x05 arrived" flag, or add a peek that doesn't allocate.

### Batch 3: the game library scan (Electron main process)

**DONE 2026-10-15** (branch `passes-095`). What changed:

- The scan's per-game files (Steam's appmanifests, config.vdf and localconfig.vdf, Heroic's GamesConfig, Lutris' games/*.yml) are read ahead with `fs.promises`, 8 at a time (`readAhead`, `scanFiles`), before the synchronous scan runs; `withScanTexts` serves them to it through `readParsed`, the one reader all three launchers already used, so their list code didn't change.
- Every other file the scan reads is kept after its first read for that scan, so a Proton build's `version` file is read once however many games use it (`buildVersion` reads through `readParsed` now). The texts are dropped when the scan returns.
- Steam's per-game lookups in CompatToolMapping and localconfig's two per-app nodes go through one `Map` index each (`keyIndex`, `steamAppIndex`), not a linear `getKey` per game.
- The game details after a scan reuse the scan's texts (one read of each manifest and localconfig for both).

`tests/unit/scanReadAhead.test.ts`: the same report with and without the read-ahead, no synchronous read of a read-ahead file during the scan, each other file read once, and the index gives `getString`'s answers. Measuring was left out (daytime); the change takes the reads off the main thread rather than making them cheaper.

The original batch:

The scan runs at startup when Games is on, on a rescan, and after each apply. It is synchronous on the main process, so a big library holds up IPC and the tray while it runs.

| Location | Function | Runs | Why | Change |
|---|---|---|---|---|
| `electron/main/games/vdf.ts:111`, `games.ts:341` | `getKey` from `scanSteam` | 3 lookups × Steam games × thousands of `localconfig` keys / per scan | Each lookup is a linear `.find` over localconfig's `apps` node. Probably the scan's largest CPU cost. | Index `apps` and `CompatToolMapping` into a lowercase `Map` once per scan. |
| `electron/main/games/steam.ts:132` | `steamAppManifests` | Steam games, twice / per scan | One synchronous read and VDF parse per manifest, done again by `gameDetails`. | Read with `fs.promises` under a bound (~8), and share one read between the list and the details. |
| `electron/main/games/heroic.ts:118` | `listHeroicGames` | Heroic games / per scan | One synchronous `GamesConfig` JSON read per game. | Bounded (~8) async reads before building the list. |
| `electron/main/games/lutris.ts:117` | `listLutrisGames` | Lutris games / per scan | One synchronous YAML read and parse per game. | Bounded (~8) async reads, then parse. |
| `electron/main/games/games.ts:512, 681`; `proton.ts:106` | `scanHeroic`, `scanLutris`, `buildVersion` | Heroic + Lutris games / per scan | The same Proton build's `version` file is re-read for every game that uses it. | Memoize `buildVersion` per scan: one read per build. |

### Batch 4: lists and effects off the frame path

**DONE 2026-10-15** (branch `passes-095`); the swirl's CPU fallback followed on branch `swirl-fallback` (below). What changed:

- `GameTile` is `memo` with one stable `onOpen(key)` (`setSelected`), so a library render redraws only the tiles whose game changed.
- The Pico page's log rows are a memo'd `LogRows`; each line's time is formatted once, when it's added.
- `HdrGlow`: during a resize the canvas follows the drawing every frame with the mask it has (stretched), and the full-size mask is built again once the size has stayed the same for 150 ms. Its loop is no longer reached from a frame callback, so the lister no longer lists it.

`tests/integration/offFrameWork.test.ts` counts the work across renders (fails on the old code). The HDR mask has no jsdom test (no canvas or WebGPU there).

The original batch:

| Location | Function | Runs | Why | Change |
|---|---|---|---|---|
| `src/desktop/library/GameLibrary.tsx:266` | `GameLibrary` | hundreds of tiles / per library render, even when a game page hides the grid | Every tile re-renders on every library render. | `React.memo` `GameTile` with a stable `onOpen`, or don't render the grid while a game page covers it. |
| `src/desktop/dongle/DongleConsole.tsx:107` | `DongleConsole` | ≤ 200 rows / 10 per s while the log tab is shown | Re-rendered on each OLED mirror frame, with a `toLocaleTimeString` per row. | Format the time when the line is added; memo the list. |
| `src/desktop/live/HdrGlow.tsx:91` | `buildMask` | ~1M pixels / every rAF during a window drag (HDR only) | The full-size mask is rebuilt on every resize frame. | Rebuild once the resize settles (~150 ms). |
| `src/desktop/live/SwirlField.tsx:176, 178, 182` | CPU renderer `draw` | 128 × 72 px in JS / 12.5 Hz when there's no GPU (already paused while hidden) | Pixel work on the CPU, against the lean rule. | Without a GPU: one still frame (or ≤ 2 fps); animate only on the GPU path. **Decided 2026-10-15 (owner delegated to best judgement; branch `swirl-fallback`): without a real graphics card the swirl is one still frame.** When the shader would run on the CPU (hardware acceleration off, WebGL2 missing or blocklisted, WebGL drawn in software: SwiftShader, llvmpipe/lavapipe/softpipe, Windows' Basic Render Driver, Apple Software Renderer, or the GPU context failed or was lost), the CPU fallback draws the 128 × 72 field once (the same look, no motion; CSS stretches it, so a resize needs no redraw) and again only when the colors or theme change; the GPU path on a real card is unchanged, and Reduce motion (the app's or the system's prefers-reduced-motion) keeps its one still frame. Reason: the lean rule ("sip, not drink"): the motion is decoration, and with no card to draw it every frame is CPU spent for nothing; ≤ 2 fps would still be a continuous cost, and a still frame keeps the look at 0 frames a second. Detection (`src/desktop/live/swirlGpu.ts`, `tests/unit/swirlGpu.test.ts`): a WebGL2 context created with `failIfMajorPerformanceCaveat` (Chromium refuses it when WebGL is drawn in software, on every OS) plus the unmasked renderer string (`WEBGL_debug_renderer_info`) matched against the software renderers' names; either sign means software. The budget gate keeps measuring the animated GPU path on SwiftShader through the dev flag `ds5.dev.swirlGpu` (`tools/measure_budgets.mjs`). |

## Found along the way

- **Polls that run while hidden, on purpose.** `useDs5Bridge`'s 1 s identity poll and 2 s config poll, and the running-game watcher's 2 s `/proc` scan (`running.ts`), keep running while the window is hidden, because the tray and game profiles need them. Their loops are HOT-PATH-OK with N stated. The watcher's first pass is already cheap (stat, then the status file of the user's own processes only). Since 2026-10-14 (budgets) it reads each own process's short `stat` file instead of `status`, does the costly reads (owner, Wine, environment, command line) once per process and program (`known`, keyed by pid + start time + name), and looks every 10 s instead of 2 s while the window is in the tray and no game has a profile.
- **One-shot rAFs are tagged `raf` too.** `desktopPalette.ts`, `narrator.ts` and `controllerAudio.ts` are reached from one-shot `requestAnimationFrame` calls (a game page opening, a theme change), not frame loops. Their verdicts say so.
- **Lister gaps found by the verdict pass, now fixed in the lister.**
  - A function passed as a default parameter (`read = isWin ? readWindowsProcs : readGameProcs`) wasn't resolved, which hid the watcher's `/proc` reader.
  - A React state updater (`setOutlines(prev => …)`) inside an interval wasn't followed.

  Both are fixed, and their 15 rows are in the tables.
- **simulatedDongle.ts** is the dev/test fake. Its per-poll loops cost something only in dev builds; the heaviest is the 8192-pixel `liveScreen` per mirror poll.

## Every loop, by file

### App (`MarcelineVPQ/DS5Dongle-OLED-Config-Web`)

Trigger: `await` / `hot:<root>` / `nested`. "Runs" is N and how often (`-`: the Why column states it; rows added by the merge or batch 1).

#### electron/main/download.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 63 | `downloadVerified` | for | await | **SERIAL-REQUIRED** | 1 per chunk / per firmware or Proton download | stream order: each chunk is hashed and written in sequence, stall deadline | - |

#### electron/main/games/appinfo.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 52 | `parseAppTypes` | for | hot:scan | **HOT-PATH-OK** | ~100k strings / once per scan | one pass over appinfo.vdf's string table, linear, no allocation per step | - |
| 71 | `findType` | while | hot:scan | **HOT-PATH-OK** | tens of keys per wanted app / per scan | walks one wanted app's key-values, returns at common/type | - |
| 103 | `findType` | while | hot:scan nested | **HOT-PATH-OK** | a few bytes / rare value type | skips one UTF-16 value, linear in its length | - |
| 116 | `parseAppTypes` | while | hot:scan | **HOT-PATH-OK** | ~30k app entries / once per scan | one linear walk of appinfo.vdf, stops when all wanted apps are found | - |

#### electron/main/games/artThumbs.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 179 | `load > <anonymous>` | for-of | await | **NOT-WORTH** | - | once per app run, N ≤ maxEntries files | - |
| 210 | `evict` | for-of | await | **SERIAL-REQUIRED** | - | stops as soon as the folder is under the caps (data dependency on the running total) | - |

#### electron/main/games/backup.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 271 | `list` | .map | nested | **NOT-WORTH** | ≤ 10 files x ≤ KEEP sets / History open | files per backup set, a handful | - |
| 309 | `prune` | for-of | nested | **NOT-WORTH** | ≤ 10 files x ≤ KEEP sets / per apply | files per backup set, pruning after a write | - |

#### electron/main/games/details.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 107 | `steamArt` | for-of | nested | **HOT-PATH-OK** | ≤ 10 names x Steam games / per scan | one art folder's subfolders, a few files each | - |
| 147 | `heroicDetails` | for-of | nested | **HOT-PATH-OK** | ≤ hundreds / per scan | library entries per store, Map lookups only | - |

#### electron/main/games/fake/art.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 219 | `paintScene` | for | nested | **NOT-WORTH** | - | every pixel of one picture, drawn once per game and kind (nested in the row loop above) | - |
| 227 | `paintScene` | .reduce | nested | **NOT-WORTH** | - | 6 ridge waves per pixel, once per picture | - |
| 257 | `disc` | for | nested | **NOT-WORTH** | - | the circle's pixels, once per picture (nested in the row loop above) | - |
| 267 | `rect` | for | nested | **NOT-WORTH** | - | the rectangle's pixels, once per picture (nested in the row loop above) | - |
| 280 | `draw` | .forEach | nested | **NOT-WORTH** | - | the line's characters x 35 font dots, once per picture | - |
| 283 | `draw` | for | nested | **NOT-WORTH** | - | 7 font rows, once per character | - |
| 285 | `draw` | for | nested | **NOT-WORTH** | - | 5 font columns, once per character | - |

#### electron/main/games/fake/library.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 355 | `entryOf` | .find | nested | **NOT-WORTH** | - | ≤ 3 fake builds of one launcher | - |
| 437 | `fakeApply` | .flatMap | nested | **NOT-WORTH** | - | the fake games' choices (≤ ~80), once per apply | - |

#### electron/main/games/fake/service.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 124 | `installLatestProton` | for | await | **SERIAL-REQUIRED** | - | the fake download's progress steps, in order (a deadline per step) | - |
| 129 | `installLatestProton` | for-of | await | **SERIAL-REQUIRED** | - | the install's phases, in order | - |

#### electron/main/games/files.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 53 | `filesIn` | .map | hot:scan | **NOT-WORTH** | - | names in one launcher folder, a regex test each; once per scan | - |
| 53 | `filesIn` | .filter | hot:scan | **NOT-WORTH** | - | names in one launcher folder, a regex test each; once per scan | - |
| 69 | `worker` | for | await | **PARALLELIZE** | per-game files / per scan, 8 at a time | the scan's per-game files, `bound` (8) workers taking the next path each | Batch 3's read-ahead |

#### electron/main/games/games.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 124 | `sdlVarsIn` | .map | hot:scan | **HOT-PATH-OK** | ≤ 5 / per game per scan | env assignments in one launch-options line | - |
| 124 | `sdlVarsIn` | .filter | hot:scan | **HOT-PATH-OK** | ≤ 5 / per game per scan | env assignments in one launch-options line | - |
| 144 | `withEnvVars` | .reduce | hot:scan | **NOT-WORTH** | ≤ 2 / per fix | 1-2 variables, only when a fix is built | - |
| 146 | `withEnvVars` | .map | hot:scan | **NOT-WORTH** | ≤ 2 / per fix | 1-2 variables, only when a fix is built | - |
| 203 | `hasOldEnv` | .some | hot:scan | **NOT-WORTH** | ≤ 4 / per HDR game per scan | fixed list of old HDR variables | - |
| 328 | `scanFiles` | .map | nested | **NOT-WORTH** | - | Steam installs (1-2), once per scan | - |
| 359 | `fix` | .flatMap | hot:scan | **NOT-WORTH** | 1-3 / per fix | edits of one fix | - |
| 369 | `pickerFor` | .map | hot:scan | **NOT-WORTH** | - | one launcher's builds (≤ ~20) per game, no I/O; once per scan | - |
| 381 | `pickerFor` | .sort | hot:scan | **NOT-WORTH** | - | one launcher's builds (≤ ~20), once per game | - |
| 407 | `scan` | .forEach | hot:scan | **NOT-WORTH** | 1-2 / per scan | Steam installs found | - |
| 418 | `scanSteam` | .map | hot:scan | **NOT-WORTH** | Steam games (≤ hundreds) / per scan | Steam's builds (≤ ~20), once per scan | - |
| 442 | `scanSteam` | .map | hot:scan | **HOT-PATH-OK** | Steam games (≤ hundreds) / per scan | app ids for the appinfo lookup, one array | - |
| 446 | `scanSteam` | for-of | hot:scan | **HOT-PATH-OK** | Steam games x 1000s of keys / per scan | per game 3 Map lookups (steamAppIndex, loop pass batch 3); its files were read ahead | Done in batch 3 |
| 621 | `scan` | .flatMap | hot:scan | **NOT-WORTH** | 1-2 / per scan | Steam installs and their builds (≤ ~20), once per scan | - |
| 623 | `scan` | .map | hot:scan nested | **NOT-WORTH** | 0-2 / per scan | one install's builds in compatibilitytools.d (≤ ~20), once per scan | - |
| 625 | `scan` | .map | hot:scan nested | **NOT-WORTH** | 0-2 / per scan | one install's Valve Protons (≤ ~8), once per scan | - |
| 629 | `scan` | .forEach | hot:scan | **NOT-WORTH** | 1-2 / per scan | Heroic installs found | - |
| 648 | `scanHeroic` | for-of | hot:scan | **HOT-PATH-OK** | Heroic games / per scan | per game; the runner's version file is read once per scan (readParsed's scan texts, loop pass batch 3) | Done in batch 3 |
| 653 | `scanHeroic` | .map | hot:scan nested | **HOT-PATH-OK** | ≤ 10 / per Heroic game per scan | env entries of one game | - |
| 653 | `scanHeroic` | .filter | hot:scan nested | **HOT-PATH-OK** | ≤ 10 / per Heroic game per scan | env entries of one game | - |
| 670 | `scanHeroic` | .some | hot:scan nested | **HOT-PATH-OK** | ≤ 10 / per Heroic game per scan | env entries of one game | - |
| 719 | `scanHeroic` | .map | hot:scan nested | **NOT-WORTH** | ≤ 10 / per HDR game per scan | env entries, HDR games only | - |
| 791 | `scan` | .flatMap | hot:scan | **NOT-WORTH** | 1-2 / per scan | Steam installs, a readdir each | - |
| 793 | `scan` | .forEach | hot:scan | **NOT-WORTH** | 1-2 / per scan | Lutris installs found | - |
| 803 | `scanLutris` | .map | hot:scan | **NOT-WORTH** | 1-2 / per scan | Steam installs | - |
| 824 | `scanLutris` | for-of | hot:scan | **HOT-PATH-OK** | Lutris games / per scan | per game; the runner's version file is read once per scan (readParsed's scan texts, loop pass batch 3) | Done in batch 3 |
| 839 | `scanLutris` | .some | hot:scan nested | **HOT-PATH-OK** | ≤ 10 / per Lutris game per scan | env entries of one game | - |
| 927 | `scan` | for-of | hot:scan | **NOT-WORTH** | 2 / per scan | two stores, Windows only | - |
| 932 | `scan` | for-of | hot:scan nested | **HOT-PATH-OK** | ≤ hundreds / per scan on Windows | plain object per store game, no I/O | - |
| 954 | `scan` | .forEach | hot:scan | **NOT-WORTH** | 0-2 / per scan | PipeWire rule files found | - |
| 954 | `scan` | .filter | hot:scan | **NOT-WORTH** | 0-2 / per scan | PipeWire rule files found | - |
| 973 | `scan` | for-of | hot:scan | **NOT-WORTH** | 0-2 / per scan | DualSense audio cards | - |
| 998 | `scan` | for-of | hot:scan | **NOT-WORTH** | - | connected DualSense sound cards, 0-2; once per scan | - |
| 1002 | `scan` | .some | hot:scan nested | **NOT-WORTH** | 0-2 / per scan | N ≤ 4 controls of one card | - |
| 1002 | `scan` | .some | hot:scan nested | **NOT-WORTH** | 0-2 / per scan | N ≤ 4 controls of one card | - |
| 1016 | `scan` | .some | hot:scan | **NOT-WORTH** | 0-2 / per scan | DualSense audio cards | - |
| 1018 | `scan` | .map | hot:scan | **NOT-WORTH** | 0-2 / per scan | PipeWire rule files found | - |
| 1100 | `writeChosen` | for-of | nested | **NOT-WORTH** | ≤ tens / per apply | edits of the chosen fixes, in memory | - |
| 1107 | `writeChosen` | .map | nested | **NOT-WORTH** | ≤ 5 / per apply | edited files, in memory | - |
| 1107 | `writeChosen` | .some | nested | **NOT-WORTH** | ≤ 5 / per apply | edited files, in memory | - |
| 1132 | `writeChosen` | for-of | await | **SERIAL-REQUIRED** | ≤ 2 / per apply | process order: WirePlumber restart and profile switch must not overlap | - |

#### electron/main/games/hdr.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 47 | `parseKscreenOutputs` | .map | nested | **NOT-WORTH** | tens / per HDR probe (cached) | lines of one kscreen output block | - |
| 85 | `gnomeScreens` | .find | nested | **NOT-WORTH** | tens / per HDR probe (cached) | modes of one GNOME monitor | - |
| 126 | `hasLayer` | .some | nested | **NOT-WORTH** | tens / per HDR probe (cached) | files in a few Vulkan layer folders | - |

#### electron/main/games/heroic.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 46 | `findHeroicInstalls` | for-of | hot:scan | **NOT-WORTH** | 2 / per scan | two possible Heroic folders | - |
| 69 | `listHeroicGames` | for-of | hot:scan | **HOT-PATH-OK** | ≤ hundreds / per scan | installed Epic games, in memory after one JSON read | - |
| 77 | `listHeroicGames` | for-of | hot:scan | **HOT-PATH-OK** | ≤ thousands / per scan | GOG library cache entries, in memory | - |
| 82 | `listHeroicGames` | for-of | hot:scan | **HOT-PATH-OK** | ≤ hundreds / per scan | installed GOG games, in memory | - |
| 91 | `listHeroicGames` | .map | hot:scan | **HOT-PATH-OK** | ≤ hundreds / per scan | installed Amazon ids, in memory | - |
| 94 | `listHeroicGames` | .map | hot:scan | **HOT-PATH-OK** | ≤ hundreds / per scan | installed Amazon ids, in memory | - |
| 100 | `listHeroicGames` | for-of | hot:scan | **HOT-PATH-OK** | ≤ thousands / per scan | Amazon library entries, in memory | - |
| 106 | `listHeroicGames` | for-of | hot:scan | **HOT-PATH-OK** | ≤ hundreds / per scan | installed Amazon ids, Map lookups | - |
| 110 | `listHeroicGames` | for-of | hot:scan | **HOT-PATH-OK** | ≤ tens / per scan | sideloaded apps, in memory | - |
| 118 | `listHeroicGames` | .sort | hot:scan | **HOT-PATH-OK** | Heroic games / per scan | one JSON parse per game from the scan's read-ahead texts (GamesConfig read in parallel first, loop pass batch 3) | Done in batch 3 |
| 118 | `listHeroicGames` | .map | hot:scan | **HOT-PATH-OK** | Heroic games / per scan | one JSON parse per game from the scan's read-ahead texts (GamesConfig read in parallel first, loop pass batch 3) | Done in batch 3 |
| 118 | `listHeroicGames` | .filter | hot:scan | **HOT-PATH-OK** | Heroic games / per scan | one JSON parse per game from the scan's read-ahead texts (GamesConfig read in parallel first, loop pass batch 3) | Done in batch 3 |
| 125 | `listHeroicGames` | .filter | hot:scan nested | **HOT-PATH-OK** | ≤ 10 / per Heroic game per scan | env entries of one game | - |
| 125 | `listHeroicGames` | .map | hot:scan nested | **HOT-PATH-OK** | ≤ 10 / per Heroic game per scan | env entries of one game | - |
| 158 | `heroicBuilds` | for-of | hot:scan | **NOT-WORTH** | - | builds in Heroic's Proton folder, once per scan | - |
| 162 | `heroicBuilds` | .filter | hot:scan | **NOT-WORTH** | - | folders in Heroic's Wine folder, a stat each; once per scan | - |
| 167 | `heroicBuilds` | for-of | hot:scan | **NOT-WORTH** | - | Wine builds, once per scan | - |
| 169 | `heroicBuilds` | for-of | hot:scan | **NOT-WORTH** | - | Steam's builds (≤ ~20), once per scan | - |

#### electron/main/games/lutris.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 33 | `findLutrisInstalls` | for-of | hot:scan | **NOT-WORTH** | 2 / per scan | two possible Lutris folders | - |
| 65 | `systemEnv` | .map | hot:scan | **HOT-PATH-OK** | ≤ 10 / per Lutris game per scan | env entries of one game | - |
| 110 | `listLutrisGames` | .map | hot:scan | **NOT-WORTH** | rare | yml fallback only when pga.db can't be read | - |
| 110 | `listLutrisGames` | .filter | hot:scan | **NOT-WORTH** | rare | yml fallback only when pga.db can't be read | - |
| 119 | `listLutrisGames` | .sort | hot:scan | **HOT-PATH-OK** | Lutris games / per scan | one YAML parse per game from the scan's read-ahead texts (games/*.yml read in parallel first, loop pass batch 3) | Done in batch 3 |
| 119 | `listLutrisGames` | .map | hot:scan | **HOT-PATH-OK** | Lutris games / per scan | one YAML parse per game from the scan's read-ahead texts (games/*.yml read in parallel first, loop pass batch 3) | Done in batch 3 |
| 119 | `listLutrisGames` | .filter | hot:scan | **HOT-PATH-OK** | Lutris games / per scan | one YAML parse per game from the scan's read-ahead texts (games/*.yml read in parallel first, loop pass batch 3) | Done in batch 3 |
| 132 | `lutrisWineBuilds` | .filter | hot:scan | **NOT-WORTH** | ≤ 20 / per scan | Wine/Proton builds in Lutris' runner folder, 2 stats each | - |
| 145 | `lutrisBuilds` | .filter | hot:scan | **NOT-WORTH** | - | builds in Lutris' runner folder, a stat each; once per scan | - |

#### electron/main/games/processes.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 79 | `launchersIn` | .some | nested | **HOT-PATH-OK** | 3 x ≤ tens / per launcher check | 3 launchers x game-candidate processes | - |
| 85 | `gameIn` | .some | nested | **HOT-PATH-OK** | ≤ 10 / per process per check | args of one process, short | - |
| 153 | `close` | for | await | **SERIAL-REQUIRED** | ≤ timeoutMs/500 / per launcher close | deadline: polls every 500 ms until the launcher has quit or timeoutMs | - |
| 181 | `reopenAll` | for-of | await | **SERIAL-REQUIRED** | ≤ 3 / per apply | launcher order: reopen one at a time, as they were closed | - |
| 185 | `withLaunchersClosed` | for-of | await | **SERIAL-REQUIRED** | ≤ 3 / per apply | launcher order: stop at the first that won't close and reopen the rest | - |

#### electron/main/games/proton.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 65 | `protonBuilds` | .filter | hot:scan | **NOT-WORTH** | ≤ 20 / per tools dir per scan | folders in one tools dir, a stat each | - |
| 85 | `first` | .find | hot:scan | **NOT-WORTH** | 2 / per build checked | 2 texts (name, version file) | - |
| 85 | `first` | .map | hot:scan | **NOT-WORTH** | 2 / per build checked | 2 texts (name, version file) | - |
| 88 | `dualSenseBuild` | .some | hot:scan | **NOT-WORTH** | 2 / per build checked | 2 texts (name, version file) | - |
| 91 | `dualSenseBuild` | .map | hot:scan | **NOT-WORTH** | 2 / per build checked | 2 texts (name, version file) | - |
| 111 | `buildVersion` | for-of | hot:scan | **NOT-WORTH** | 1-3 folders x games / per scan | 1-3 build folders; each version file read once per scan (readParsed's scan texts, loop pass batch 3) | Done in batch 3 |
| 120 | `buildHonoursPreferSdl` | .map | hot:scan | **NOT-WORTH** | ≤ 3 / per call | 1-3 build folders | - |
| 127 | `buildVersionKey` | .map | hot:scan | **NOT-WORTH** | ≤ 3 / per call | 1-3 build folders | - |
| 129 | `buildVersionKey` | for-of | hot:scan | **NOT-WORTH** | 2 / per call | 2 texts (version file, name) | - |
| 136 | `compareKeys` | .reduce | hot:scan | **NOT-WORTH** | 3 / per compare | 3-part version keys | - |
| 144 | `pickBuild` | .flatMap | hot:scan | **NOT-WORTH** | ≤ 20 / per such game | installed builds, only for games that need a switch | - |
| 149 | `newest` | .sort | hot:scan | **NOT-WORTH** | ≤ 20 / per such game | installed builds, copied and sorted | - |
| 151 | `pickBuild` | .filter | hot:scan | **NOT-WORTH** | ≤ 20 / per such game | installed builds | - |
| 151 | `pickBuild` | .filter | hot:scan | **NOT-WORTH** | ≤ 20 / per such game | installed builds | - |
| 226 | `installProton` | for-of | await | **SERIAL-REQUIRED** | ≤ 3 targets / per Proton install | install order: each copy or link of the one unpacked build, then report | - |

#### electron/main/games/running.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 104 | `readFull` | for-of | hot:poll | **HOT-PATH-OK** | ~100 x few candidates / 2 s tick | environ vars (~50-100) of a candidate game process only | - |
| 121 | `readFull` | .filter | hot:poll | **HOT-PATH-OK** | ~10 x few candidates / 2 s tick | cmdline args of a candidate game process only | - |
| 146 | `readProcs` | for-of | hot:poll | **HOT-PATH-OK** | ~300-800 PIDs / 2 s tick (Linux) | all PIDs; cheap first pass (owner checked once per process, status of own only); runs hidden on purpose | - |
| 183 | `readProcs` | for-of | hot:poll | **HOT-PATH-OK** | ~300-800 PIDs / 2 s tick (Linux) | one Map of live processes, a delete only for those that left | - |
| 185 | `readProcs` | for-of | hot:poll | **HOT-PATH-OK** | ~300-800 PIDs / 2 s tick (Linux) | one Map of the user's live processes, a delete only for those that left | - |
| 189 | `readProcs` | .map | hot:poll | **HOT-PATH-OK** | ~100-400 / 2 s tick | one Map over own processes for the ancestry walk | - |
| 229 | `launched` | .some | hot:poll | **HOT-PATH-OK** | 4 / new orphan | N = 4 env keys, only for an orphan not seen before | - |
| 237 | `readProcs` | for-of | hot:poll | **HOT-PATH-OK** | ~100-400 / 2 s tick | own processes, memoized ancestry; full reads only for candidates | - |
| 250 | `readProcs` | for-of | hot:poll | **HOT-PATH-OK** | < 10 / 2 s tick | remembered plain orphans, a handful | - |
| 267 | `detectRunning` | for-of | hot:poll | **HOT-PATH-OK** | ≤ tens / every 2 s (3 s Windows), Games on | game-candidate processes only (readProcs filters), returns on a hit | - |
| 270 | `detectRunning` | .find | hot:poll nested | **HOT-PATH-OK** | ≤ 10 / per tick | args of one reaper process | - |
| 274 | `detectRunning` | .find | hot:poll nested | **HOT-PATH-OK** | ≤ hundreds / per tick while a game runs | library games, only for a process with a Steam id | - |
| 279 | `detectRunning` | .find | hot:poll nested | **HOT-PATH-OK** | ≤ hundreds / per tick while a game runs | library games, only for a process with HEROIC_APP_NAME | - |
| 284 | `detectRunning` | .filter | hot:poll | **HOT-PATH-OK** | ≤ hundreds / every 2 s with Games on | one filtered copy of the library per tick, no I/O | - |
| 286 | `detectRunning` | for-of | hot:poll | **HOT-PATH-OK** | ≤ tens / every 2 s (3 s Windows), Games on | candidate processes, skips non-Wine ones first | - |
| 288 | `detectRunning` | .some | hot:poll nested | **HOT-PATH-OK** | ≤ 10 / per process per tick | args of one process | - |
| 290 | `detectRunning` | for-of | hot:poll nested | **HOT-PATH-OK** | ≤ hundreds x Wine procs / per tick | games with a folder, only for Wine/exe processes | - |
| 292 | `detectRunning` | .some | hot:poll nested | **HOT-PATH-OK** | ≤ 10 / per game per Wine proc | args of one Wine process, string prefix checks | - |
| 356 | `detectRunningWindows` | .map | hot:poll | **HOT-PATH-OK** | ≤ hundreds / every 3 s on Windows | Windows process list into a Set, needed for the lookups | - |
| 358 | `detectRunningWindows` | for-of | hot:poll | **HOT-PATH-OK** | ≤ hundreds / every 3 s on Windows | library games, exe sets cached per folder | - |
| 361 | `detectRunningWindows` | for-of | hot:poll nested | **HOT-PATH-OK** | ≤ tens / per game per tick | one game's cached exe names, Set lookups | - |

#### electron/main/games/schemeHandler.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 339 | `schemeHandlerExec` | for-of | await | **SERIAL-REQUIRED** | ≤ 5 folders / per Play click | data dependency: the first XDG folder with the entry wins | - |

#### electron/main/games/service.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 189 | `fixes` | .map | nested | **NOT-WORTH** | 1-3 / per fix per scan | files of one fix | - |
| 314 | `undo > exclusive(cb)` | .some | nested | **NOT-WORTH** | - | mixer changes x cards, a few each; once per Undo | - |
| 326 | `undo > exclusive(cb)` | for-of | await | **SERIAL-REQUIRED** | - | ALSA order: one card's restore (and its save, a password prompt) after another, ≤ 2 cards; per Undo | - |
| 357 | `listBackups` | .map | nested | **NOT-WORTH** | ≤ 10 / History open | files of one backup set | - |
| 394 | `installLatestProton > exclusive(cb)` | .every | nested | **NOT-WORTH** | 1-2 / per Proton install | Steam installs | - |

#### electron/main/games/steam.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 47 | `windowsSteamRoots` | for-of | hot:scan | **NOT-WORTH** | 2 / scan | N = 2 Program Files folders, Windows only, once per scan | - |
| 55 | `findSteamInstalls` | .map | hot:scan | **NOT-WORTH** | ≤ 3 / per scan | Steam roots on Windows | - |
| 67 | `findSteamInstalls` | for-of | hot:scan | **NOT-WORTH** | 6 / per scan | six possible Steam folders, a realpath each | - |
| 87 | `newestLocalConfig` | for-of | hot:scan | **NOT-WORTH** | 1-3 / per scan | Steam accounts on this PC, a stat each | - |
| 112 | `steamLibraries` | for-of | hot:scan | **NOT-WORTH** | 1-5 / per call | Steam library folders | - |
| 123 | `steamManifestFiles` | .flatMap | hot:scan | **NOT-WORTH** | - | Steam library folders, a readdir each | - |
| 126 | `steamManifestFiles` | .map | hot:scan nested | **NOT-WORTH** | - | manifest files of one library, once per scan | - |
| 135 | `steamAppManifests` | for-of | hot:scan | **HOT-PATH-OK** | Steam games / per scan, twice (list + details) | one VDF parse per appmanifest from the scan's read-ahead texts (no file read in the loop) | Done in batch 3 |
| 145 | `listSteamGames` | for-of | hot:scan | **HOT-PATH-OK** | Steam games / per scan | parsed manifests, two getString each | - |
| 152 | `listSteamGames` | .sort | hot:scan | **HOT-PATH-OK** | ≤ hundreds / per scan | one sort of the Steam games by name | - |
| 194 | `valveProtons` | .map | hot:scan | **NOT-WORTH** | - | Valve's Proton folders (≤ ~8) | - |
| 200 | `valveProtonPaths` | .flatMap | hot:scan | **NOT-WORTH** | - | library folders, a readdir each | - |
| 203 | `valveProtonPaths` | .map | hot:scan nested | **NOT-WORTH** | - | Proton folders of one library | - |
| 203 | `valveProtonPaths` | .filter | hot:scan nested | **NOT-WORTH** | - | Proton folders of one library | - |
| 254 | `steamTools` | for-of | hot:scan | **NOT-WORTH** | - | builds in compatibilitytools.d, one small VDF read each; once per scan | - |
| 259 | `steamTools` | for-of | hot:scan | **NOT-WORTH** | - | Valve's Proton folders (≤ ~8), once per scan | - |

#### electron/main/games/system.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 61 | `forcesProAudio` | .filter | hot:scan | **NOT-WORTH** | ≤ 100 / per rule file per scan | lines of one small PipeWire rule file | - |
| 84 | `findProAudioRules` | for-of | hot:scan | **NOT-WORTH** | 6 / per scan | six fixed rule folders | - |
| 88 | `findProAudioRules` | .filter | hot:scan nested | **NOT-WORTH** | 0-10 / per scan | files in one rule folder | - |
| 94 | `findProAudioRules` | for-of | hot:scan nested | **NOT-WORTH** | 0-10 / per scan | rule files, a small read each | - |
| 116 | `findGlobalSdlVars` | for-of | hot:scan | **NOT-WORTH** | 3 / per scan | three environment folders | - |
| 119 | `findGlobalSdlVars` | for-of | hot:scan nested | **NOT-WORTH** | 0-10 / per scan | files in one environment folder | - |
| 127 | `findGlobalSdlVars` | for-of | hot:scan | **NOT-WORTH** | ≤ 15 / per scan | shell profile and environment files, a small read each | - |
| 130 | `findGlobalSdlVars` | for-of | hot:scan nested | **NOT-WORTH** | 0-3 / per file per scan | matches in one profile file | - |
| 138 | `findGlobalSdlVars` | for-of | hot:scan | **NOT-WORTH** | ≤ 5 / per scan | SDL-forcing variable names | - |
| 153 | `hidrawAccess` | for-of | hot:scan | **NOT-WORTH** | ≤ 10 / per scan | hidraw nodes, a small sysfs read each | - |
| 234 | `lowMixerControls` | for-of | hot:scan | **NOT-WORTH** | - | N = 4 mixer targets per card; once per scan | - |
| 236 | `lowMixerControls` | .find | hot:scan nested | **NOT-WORTH** | - | ~20 controls per card; once per scan | - |
| 362 | `dualSenseMixers` | for-of | await | **NOT-WORTH** | - | DualSense cards, 0-2, one amixer read each; once per scan | - |
| 377 | `setDualSenseMixer` | for-of | await | **SERIAL-REQUIRED** | - | one ALSA card: amixer writes in order, N ≤ 4 controls; per apply | - |
| 387 | `restoreDualSenseMixer` | for-of | await | **SERIAL-REQUIRED** | - | one ALSA card: amixer writes in order, N ≤ 4 controls; per Undo | - |
| 387 | `restoreDualSenseMixer` | .find | nested | **SERIAL-REQUIRED** | - | one ALSA card: amixer writes in order, N ≤ 4 controls; per Undo | - |
| 403 | `raiseLowDualSenseMixers` | for-of | await | **SERIAL-REQUIRED** | - | one ALSA card's read and writes after another, ≤ 2 cards; per card appearing | - |
| 409 | `raiseLowDualSenseMixers` | for-of | await nested | **SERIAL-REQUIRED** | - | one ALSA card: amixer writes in order, N ≤ 4 controls; per card appearing | - |

#### electron/main/games/vdf.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 26 | `skip` | while | nested | **HOT-PATH-OK** | chars of one VDF file / per parse | skips whitespace, linear in the file | - |
| 29 | `skip` | while | nested | **HOT-PATH-OK** | chars of one line / per comment | skips one comment line, linear | - |
| 111 | `getKey` | .find | hot:scan | **NOT-WORTH** | 1000s of keys x games / per scan | one lookup in one node; the scan's per-game lookups in localconfig's thousands of apps use keyIndex (loop pass batch 3) | Done in batch 3 |
| 119 | `keyIndex` | for-of | hot:scan | **NOT-WORTH** | - | one pass over one node, once per scan | - |
| 126 | `getNode` | for-of | hot:scan | **NOT-WORTH** | ≤ 8 / per lookup | path segments of one lookup | - |

#### electron/main/officialFirmware.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 30 | `readCapped` | for | await | **SERIAL-REQUIRED** | a few chunks / per manifest fetch | stream order: reads the capped body chunk by chunk | - |

#### electron/main/portableTemp.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 70 | `pruneUnpackLeftovers` | for-of | await | **SERIAL-REQUIRED** | - | one folder at a time keeps the disk work at start-up small (a few folders at most once tidy) | - |

#### src/components/LanguageToggle.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 15 | `currentLanguage` | .find | hot:render | **HOT-PATH-OK** | - | N = 7 languages, early exit; per render | - |
| 15 | `currentLanguage` | .find | hot:render | **HOT-PATH-OK** | - | N = 7 languages, early exit; per render | - |
| 67 | `LanguageToggle` | .map | hot:render | **HOT-PATH-OK** | 7 / per render | N = 7 languages in the menu | - |

#### src/desktop/about/ComingSoon.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 19 | `ComingSoon` | .map | hot:render | **HOT-PATH-OK** | 4 / per About render | N = 4 roadmap columns; About page render only | - |
| 21 | `ComingSoon` | .filter | hot:render nested | **HOT-PATH-OK** | ~400 / per About render | N ≈ 100 roadmap rows x 4 columns; About page render only | - |
| 29 | `ComingSoon` | .map | hot:render nested | **HOT-PATH-OK** | tens / per About render | N = one column's roadmap items (tens); About page render only | - |
| 41 | `ComingSoon` | .map | hot:render nested | **HOT-PATH-OK** | ≤ 3 / per item render | N ≤ 3 areas per roadmap item | - |

#### src/desktop/accordion/useAccordion.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 125 | `useAccordion` | .filter | hot:render | **NOT-WORTH** | - | N ≤ a page's sections; once per deep link | - |
| 145 | `useAccordion` | .some | hot:render | **HOT-PATH-OK** | - | N ≤ a page's sections (≤ 12); per render | - |

#### src/desktop/colorPicker/colorMath.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 14 | `rgbToHex` | .map | hot:render | **HOT-PATH-OK** | 3 / per picker render (drag) | N = 3 channels | - |
| 26 | `parseHex` | .map | hot:render | **HOT-PATH-OK** | 3 / per parse | N = 3 characters of a short hex | - |
| 28 | `parseHex` | .map | hot:render | **HOT-PATH-OK** | 3 / per parse | N = 3 channels | - |

#### src/desktop/colorPicker/ColorPicker.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 123 | `ColorPopover` | .map | hot:render | **HOT-PATH-OK** | 3 / per outside value change | N = 3 channels; only when the value changes from outside | - |
| 258 | `ColorPopover` | .map | hot:render | **HOT-PATH-OK** | 3 / per picker render | N = 3 channel names | - |
| 313 | `ColorPopover` | .map | hot:render | **HOT-PATH-OK** | 3 / per picker render | N = 3 channel fields | - |
| 335 | `ColorPopover` | .map | hot:render | **HOT-PATH-OK** | ≤ 8 / per picker render | N ≤ 8 recent colors (RECENT_MAX) | - |

#### src/desktop/controllerAudio.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 18 | `findControllerAudio` | .find | hot:raf | **NOT-WORTH** | ~10 / per narration or test start | N ≈ 10 audio devices; once per narration or test start, not per frame | - |

#### src/desktop/controls.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 293 | `Segmented` | .map | hot:render | **HOT-PATH-OK** | ≤ 6 / per render | N ≤ 6 segment options | - |
| 307 | `rgbToHex` | .map | hot:render | **HOT-PATH-OK** | 3 / per call | N = 3 channels | - |

#### src/desktop/DesktopApp.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 119 | `DesktopApp` | .sort | hot:render | **NOT-WORTH** | - | N ≤ 3 notice ids; when what applies changes | - |
| 288 | `DesktopApp > useEffect(cb)` | .map | hot:effect | **NOT-WORTH** | 3 / per tray icon change | N = 3 numbers; only when the tray icon's inputs change | - |

#### src/desktop/dev/FakeGames.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 60 | `FakeGames` | .map | hot:render | **NOT-WORTH** | - | 20 fake games, Developer card only (dev builds) | - |
| 70 | `FakeGames` | .map | hot:render | **NOT-WORTH** | - | 3 HDR setups, Developer card only | - |

#### src/desktop/dev/SimulatedBoard.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 23 | `SimulatedBoard` | .map | hot:render | **HOT-PATH-OK** | - | N = 4 states, Developer card only | - |
| 33 | `SimulatedBoard` | .map | hot:render | **HOT-PATH-OK** | - | N = 6 failures, Developer card only | - |
| 43 | `SimulatedBoard` | .map | hot:render | **HOT-PATH-OK** | - | N = 3 speeds, Developer card only | - |

#### src/desktop/devPreview.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 44 | `placeFakes` | .map | hot:render | **HOT-PATH-OK** | - | N = 4 slots; once per slot-occupancy change (memoized by useFakeSlots) | - |
| 47 | `placeFakes` | .forEach | hot:render | **HOT-PATH-OK** | - | N = 4 slots; once per slot-occupancy change (memoized by useFakeSlots) | - |
| 78 | `useFakeSlots` | .findIndex | hot:render | **HOT-PATH-OK** | - | N = 4 slots; per render of the few views that read the fakes | - |

#### src/desktop/DismissedNotices.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 15 | `useDismissedTasks` | .filter | hot:render | **NOT-WORTH** | - | N ≤ ~6 open tasks; App settings' render | - |
| 26 | `DismissedNotices` | .map | hot:render | **NOT-WORTH** | - | N ≤ ~6 rows; App settings' render | - |

#### src/desktop/dongle/DongleConsole.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 87 | `DongleConsole` | .map | hot:render | **HOT-PATH-OK** | 2 / per console render (10/s) | N = 2 tabs | - |
| 126 | `LogRows` | .map | hot:render | **HOT-PATH-OK** | ≤ 200 rows / per added log line | N ≤ 200 rows, rendered only when a line is added (memo; the time is formatted once per line) | Done in batch 4 |
| 210 | `OledCanvas > useEffect(cb)` | .map | hot:effect | **HOT-PATH-OK** | 3 / 10 per s while shown | N = 3 color channels per mirror frame | - |
| 212 | `OledCanvas > useEffect(cb)` | for | hot:effect | **HOT-PATH-OK** | 64 / 10 per s while shown | N = 64 rows per mirror frame, 10/s, only while shown | - |
| 214 | `OledCanvas > useEffect(cb)` | for | hot:effect nested | **HOT-PATH-OK** | 8192 / 10 per s while shown | N = 128 x 64 = 8192 pixels per mirror frame, 10/s, only while shown | - |
| 278 | `OledKeys` | .findIndex | hot:render | **HOT-PATH-OK** | - | N = 4 brightness levels | - |
| 310 | `OledKeys` | .map | hot:render | **HOT-PATH-OK** | - | N = 2 keys | - |

#### src/desktop/dongle/DongleDashboard.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 131 | `series` | .map | hot:render | **HOT-PATH-OK** | 60 x ~3 / per render (≤ 10 per s) | N = 60 samples per trend, one trend per render | - |
| 162 | `series` | .map | hot:render | **HOT-PATH-OK** | 60 x ~3 / per render (≤ 10 per s) | N = 60 samples per graph, 4 graphs; the 1 s sample's render | - |
| 162 | `series` | .filter | hot:render | **HOT-PATH-OK** | - | N = 60 samples per graph, 4 graphs; the 1 s sample's render | - |
| 175 | `DiagnosticsBody` | .map | hot:render | **HOT-PATH-OK** | - | N = 60 samples; the 1 s sample's render | - |
| 180 | `DiagnosticsBody` | .map | hot:render | **HOT-PATH-OK** | - | N ≤ 3 problems; the 1 s sample's render | - |
| 191 | `DiagnosticsBody` | .map | hot:render | **HOT-PATH-OK** | - | N ≈ 15 audio counters | - |
| 191 | `DiagnosticsBody` | .filter | hot:render | **HOT-PATH-OK** | - | N ≈ 15 audio counters | - |
| 246 | `TimingCard` | .filter | hot:render | **HOT-PATH-OK** | 60 / per render (≤ 10 per s) | N ≤ TREND_MAX_SAMPLES = 600 samples; the 1 s sample's render | - |
| 272 | `TimingCard` | .map | hot:render | **HOT-PATH-OK** | ≤ 8 / per render (≤ 10 per s) | N ≤ 8 timing stages | - |
| 276 | `TimingCard` | .map | hot:render nested | **HOT-PATH-OK** | ≤ 8 / per render (≤ 10 per s) | N = 8 stages x ≤ 600 samples; the 1 s sample's render | - |
| 322 | `micLossClimbing` | .filter | hot:render | **HOT-PATH-OK** | 60 / per render (≤ 10 per s) | N = 60 samples | - |
| 387 | `Trend` | .map | hot:render | **HOT-PATH-OK** | 60 / per trend render (≤ 10 per s) | N ≤ capacity ≤ 600 points per trend line; the 1 s sample's render | - |
| 402 | `Graph` | .map | hot:render | **HOT-PATH-OK** | 60 / per graph render (≤ 10 per s) | N = 60 points per graph | - |

#### src/desktop/dongle/DonglePage.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 48 | `DonglePage` | .filter | hot:render | **NOT-WORTH** | - | N ≤ ~6 open tasks; the page's render | - |
| 50 | `DonglePage` | .find | hot:render | **NOT-WORTH** | - | N ≤ ~3 board tasks; the page's render | - |
| 52 | `DonglePage` | .find | hot:render | **NOT-WORTH** | - | N ≤ ~3 board tasks; the page's render | - |
| 152 | `DonglePage` | .filter | hot:render | **NOT-WORTH** | - | N = 3 parts of one status line | - |

#### src/desktop/dongle/OledPad.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 158 | `OledPad` | .map | hot:render | **HOT-PATH-OK** | - | N = 4 directional buttons per render | - |
| 160 | `OledPad` | .map | hot:render | **HOT-PATH-OK** | - | N = 4 face buttons per render | - |

#### src/desktop/dongle/OledShare.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 167 | `OledShare` | .map | hot:render | **HOT-PATH-OK** | - | N = 3 sizes | - |

#### src/desktop/firmwareUpdate.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 120 | `flash` | for-of | await | **SERIAL-REQUIRED** | 1-2 regions / per firmware update | one PICOBOOT session: regions are erased and written in order | - |
| 122 | `flash` | for | await nested | **SERIAL-REQUIRED** | ~16-64 pieces / per firmware update | one PICOBOOT session: 64 KB erase+write pieces in order, for the progress | - |
| 145 | `waitForBootloader` | while | await | **SERIAL-REQUIRED** | ≤ timeout/300 ms / per firmware update | polls until a deadline (300 ms apart) for the board in BOOTSEL | - |

#### src/desktop/frameTick.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 54 | `tick` | for-of | hot:interval | **HOT-PATH-OK** | - | N ≤ 2 background layers, 10 a second, only while shown and focused | - |

#### src/desktop/games/gameArgs.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 21 | `argsOf` | .filter | hot:scan | **NOT-WORTH** | ≤ 20 / per game per scan | N ≤ ~20 words in one launch line; per known-mode game per scan | - |
| 26 | `hasArg` | .some | hot:scan | **NOT-WORTH** | ≤ 20 / per game per scan | N ≤ ~20 launch arguments; per known-mode game per scan | - |
| 30 | `withArg` | .filter | hot:scan | **NOT-WORTH** | 2 / per edit | N = 2 parts | - |
| 37 | `modeInfo` | .some | hot:scan | **NOT-WORTH** | ≤ 20 / per game per scan | N ≤ ~20 launch arguments; per known-mode game per scan | - |
| 39 | `modeInfo` | .find | hot:scan | **NOT-WORTH** | ≤ 20 / per game per scan | N ≤ ~20 launch arguments; per known-mode game per scan | - |

#### src/desktop/games/hdrSetup.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 36 | `versionAtLeast` | .map | hot:render+scan | **NOT-WORTH** | ≤ 4 / per check | N ≤ 4 version parts | - |
| 38 | `versionAtLeast` | .map | hot:render+scan | **NOT-WORTH** | ≤ 4 / per check | N ≤ 4 version parts | - |
| 40 | `versionAtLeast` | for | hot:render+scan | **NOT-WORTH** | ≤ 4 / per check | N ≤ 4 version parts | - |
| 50 | `hdrScreen` | .find | hot:render+scan | **NOT-WORTH** | ≤ 3 / per scan or page render | N ≤ 3 screens | - |
| 94 | `withGamescopeHdr` | .filter | hot:render+scan | **NOT-WORTH** | 2 / per HDR game per scan | N = 2 parts; per HDR game per scan | - |
| 102 | `withGamescopeHdr` | .filter | hot:render+scan | **NOT-WORTH** | 4 / per HDR game per scan | N = 4 parts; per HDR game per scan | - |
| 105 | `withGamescopeHdr` | .filter | hot:render+scan | **NOT-WORTH** | ≤ 10 / per HDR game per scan | N ≤ 10 parts; per HDR game per scan | - |
| 150 | `hdrReady` | .every | hot:scan | **NOT-WORTH** | ≤ 6 / per HDR game per scan | N ≤ 6 requirements; per HDR game per scan | - |
| 150 | `hdrReady` | .filter | hot:scan | **NOT-WORTH** | ≤ 6 / per HDR game per scan | N ≤ 6 requirements; per HDR game per scan | - |

#### src/desktop/games/launcherCheck.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 39 | `restartFor` | .map | hot:render | **HOT-PATH-OK** | ≤ 5 / per game page render | N = one game's fixes (≤ ~5) | - |
| 41 | `restartFor` | .map | hot:render | **HOT-PATH-OK** | 3 / per game page render | N = 3 launchers | - |
| 41 | `restartFor` | .filter | hot:render | **HOT-PATH-OK** | 3 / per game page render | N = 3 launchers | - |
| 43 | `restartFor` | .filter | hot:render | **HOT-PATH-OK** | 3 / per game page render | N = 3 launchers | - |
| 72 | `overwrittenBy` | for-of | hot:render | **HOT-PATH-OK** | ≤ 5 / per game page render | N = one game's fixes (≤ ~5) | - |

#### src/desktop/games/types.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 225 | `artWidth` | .find | hot:render | **NOT-WORTH** | - | N = 15 widths, once per art URL | - |
| 249 | `allFixes` | .flatMap | hot:render | **HOT-PATH-OK** | hundreds / per scan report | N = games (hundreds) + 3 launchers; memoized per scan report | - |
| 249 | `allFixes` | .flatMap | hot:render | **HOT-PATH-OK** | hundreds / per scan report | N = games (hundreds) + 3 launchers; memoized per scan report | - |

#### src/desktop/glass/glassCaption.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 18 | `glassCaption` | while | hot:render | **HOT-PATH-OK** | - | at most 25 steps of arithmetic, memoized per tile and art color | - |

#### src/desktop/glass/liquidGlass.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 45 | `displacementMap` | for | nested | **NOT-WORTH** | ~w x h / 4 / per glass build or resize | half-size pixels of a glass element; on mount and debounced resize only | - |
| 115 | `only` | .map | nested | **NOT-WORTH** | 12 / per glass build | N = 3 x 4 matrix cells; per glass filter build | - |

#### src/desktop/glass/useSpecular.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 16 | `update` | for-of | hot:raf | **HOT-PATH-OK** | ≤ 3 / per pointer-move frame | N ≤ 3 glass elements; at most once a frame while the pointer moves | - |

#### src/desktop/library/ContinuePlaying.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 48 | `ContinuePlaying` | .map | hot:render | **HOT-PATH-OK** | - | N ≤ 8 recent games; Home render on library change | - |

#### src/desktop/library/gameArt.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 12 | `firstArt` | .find | hot:render | **HOT-PATH-OK** | - | N ≤ 3 art kinds per tile, each a lookup in ≤ 5 | - |

#### src/desktop/library/GameLibrary.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 95 | `GameLibrary > useMemo(cb)` | for-of | hot:render | **HOT-PATH-OK** | hundreds / per scan report | N = games (hundreds); memoized on the scan report | - |
| 97 | `GameLibrary > useMemo(cb)` | .map | hot:render | **HOT-PATH-OK** | 7 / per scan report | N = 7 app kinds; memoized on the scan report | - |
| 97 | `GameLibrary > useMemo(cb)` | .filter | hot:render | **HOT-PATH-OK** | 7 / per scan report | N = 7 app kinds; memoized on the scan report | - |
| 131 | `GameLibrary > useMemo(cb)` | .sort | hot:render | **HOT-PATH-OK** | n log n, hundreds / per sort or report change | sort of the games (hundreds); memoized on report, sort and details | - |
| 136 | `GameLibrary > useMemo(cb)` | .sort | hot:render | **HOT-PATH-OK** | hundreds / per report or details change | games (hundreds) filtered+sorted to 8; memoized on report and details | - |
| 136 | `GameLibrary > useMemo(cb)` | .filter | hot:render | **HOT-PATH-OK** | hundreds / per report or details change | games (hundreds) filtered+sorted to 8; memoized on report and details | - |
| 145 | `GameLibrary > useMemo(cb)` | .filter | hot:render | **HOT-PATH-OK** | - | N = games (hundreds); memoized, reruns per search keystroke or filter | - |
| 150 | `GameLibrary` | .filter | hot:render | **HOT-PATH-OK** | - | N = visible games (hundreds); per library render (interaction) | - |
| 152 | `GameLibrary` | .filter | hot:render | **HOT-PATH-OK** | - | N = visible games (hundreds); per library render (interaction) | - |
| 154 | `GameLibrary` | .filter | hot:render | **HOT-PATH-OK** | - | N = visible games (hundreds); per library render (interaction) | - |
| 156 | `GameLibrary` | .filter | hot:render | **HOT-PATH-OK** | - | N = visible games (hundreds); per library render (interaction) | - |
| 158 | `GameLibrary` | .find | hot:render | **HOT-PATH-OK** | hundreds / per library render | N = games (hundreds); per library render (interaction) | - |
| 162 | `GameLibrary` | .map | hot:render | **HOT-PATH-OK** | hundreds / per library render | N = visible games (hundreds); per library render (interaction) | - |
| 213 | `group` | .map | hot:render | **HOT-PATH-OK** | hundreds / per library render | one sidebar row per visible game (hundreds); per library render | - |
| 265 | `GameLibrary` | .map | hot:render | **HOT-PATH-OK** | - | N = 4 filters | - |
| 276 | `GameLibrary` | .filter | hot:render nested | **HOT-PATH-OK** | - | 4 filters x searched games (hundreds); per library render | - |
| 285 | `GameLibrary` | .map | hot:render | **HOT-PATH-OK** | 3 / per library render | N = 3 sorts | - |
| 297 | `GameLibrary` | .filter | hot:render | **HOT-PATH-OK** | ≤ 7 / per library render | N ≤ 7 app kinds | - |
| 301 | `GameLibrary` | .map | hot:render | **HOT-PATH-OK** | ≤ 7 / per library render | N ≤ 7 app kinds | - |
| 314 | `GameLibrary` | .map | hot:render | **HOT-PATH-OK** | hundreds / per library render, even when hidden | a tile element per game; GameTile is memo with a stable onOpen, so only changed tiles render (loop pass batch 4) | Done in batch 4 |

#### src/desktop/library/GamePage.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 103 | `GamePage` | .find | hot:render | **HOT-PATH-OK** | 3 / per game page render | N = 3 launchers | - |
| 128 | `GamePage` | .filter | hot:render | **NOT-WORTH** | - | N = 2 parts of one status line | - |
| 133 | `GamePage` | .map | hot:render | **HOT-PATH-OK** | - | N = screens, 1-3; game page render | - |
| 133 | `GamePage` | .filter | hot:render | **HOT-PATH-OK** | - | N = screens, 1-3; game page render | - |
| 141 | `GamePage` | .find | hot:render | **HOT-PATH-OK** | 3 / per game page render | N = one launcher's builds (≤ ~20) | - |
| 169 | `GamePage` | .filter | hot:render | **NOT-WORTH** | - | N = 2 parts of one status line | - |
| 324 | `favorites` | .some | nested | **NOT-WORTH** | 12 / per profile summary render | N = 4 slots x 3 channels; per profile summary | - |
| 349 | `useProfileChips` | .map | hot:render | **HOT-PATH-OK** | - | N ≤ 12 profile groups | - |
| 358 | `useProfileChips` | for-of | hot:render | **HOT-PATH-OK** | - | N = 2 sticks | - |
| 384 | `ProfileSummary` | .map | hot:render | **HOT-PATH-OK** | ≤ 15 / per game page render | N ≤ 15 chips | - |
| 408 | `LayoutPicker` | .sort | hot:render | **HOT-PATH-OK** | a few / per game page render | N = saved button layouts (a few) | - |
| 416 | `LayoutPicker` | .map | hot:render | **HOT-PATH-OK** | a few / per game page render | N = saved button layouts (a few) | - |
| 438 | `LayoutPicker` | .map | hot:render | **HOT-PATH-OK** | 4 / per game page render | N = 4 extra buttons | - |
| 464 | `CurvePicker` | .map | hot:render | **HOT-PATH-OK** | 2 / per game page render | N = 2 sticks | - |
| 469 | `CurvePicker` | .map | hot:render nested | **HOT-PATH-OK** | ≤ 10 / per game page render | N = 2 sticks x ≤ 5 curve presets | - |
| 527 | `SetupBody` | .map | hot:render | **HOT-PATH-OK** | - | N = one game's fixes (≤ ~5) | - |
| 645 | `CompatBody` | .find | hot:render | **HOT-PATH-OK** | - | N = one game's fixes (≤ ~5) | - |
| 648 | `CompatBody` | .find | hot:render | **HOT-PATH-OK** | - | N = one launcher's builds (≤ ~20); three finds per render | - |
| 648 | `CompatBody` | .find | hot:render | **HOT-PATH-OK** | - | N = one launcher's builds (≤ ~20); three finds per render | - |
| 651 | `CompatBody` | .find | hot:render | **HOT-PATH-OK** | - | N = one launcher's builds (≤ ~20) | - |
| 716 | `CompatBody` | .some | hot:render | **HOT-PATH-OK** | - | N = one launcher's builds (≤ ~20) | - |
| 738 | `CompatBody` | .map | hot:render | **HOT-PATH-OK** | - | N = one launcher's builds (≤ ~20) | - |
| 801 | `SupportBody` | .map | hot:render | **HOT-PATH-OK** | - | N = known game fixes (GAME_FIXES, empty now) | - |
| 812 | `SupportBody` | .map | hot:render | **HOT-PATH-OK** | - | N = 6 support tiers | - |
| 825 | `SupportBody` | .map | hot:render | **HOT-PATH-OK** | - | N = 5 features | - |
| 875 | `RatingPart` | .filter | hot:render | **HOT-PATH-OK** | - | N = feedback tags (under 10) | - |
| 877 | `RatingPart` | .filter | hot:render | **HOT-PATH-OK** | - | N = feedback tags (under 10) | - |
| 898 | `RatingPart` | .map | hot:render | **HOT-PATH-OK** | - | N = 5 stars | - |
| 951 | `RatingPart` | .map | hot:render | **HOT-PATH-OK** | - | N = feedback tags (under 10) | - |

#### src/desktop/library/GameTile.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 33 | `TileOverlays` | .filter | hot:render | **HOT-PATH-OK** | - | N = 4 badge candidates per tile; tile renders on library change only | - |
| 45 | `TileOverlays` | .map | hot:render | **HOT-PATH-OK** | - | N ≤ 4 marks per tile; renders on library change only | - |

#### src/desktop/library/HdrChecklist.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 16 | `HdrChecklist` | .map | hot:render | **HOT-PATH-OK** | ~6, per render of Home/game page | N ≈ 6 HDR requirements; renders on page open or rescan | - |

#### src/desktop/library/playBar.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 93 | `GameActions` | .map | hot:render | **HOT-PATH-OK** | - | N = 5 game actions | - |
| 93 | `GameActions` | .filter | hot:render | **HOT-PATH-OK** | - | N = 5 game actions | - |

#### src/desktop/library/profileValues.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 53 | `withSettings` | for-of | hot:render | **HOT-PATH-OK** | ~16, per DesktopApp render | N ≈ 16 profile fields; on profile apply or render of dirty check | - |
| 69 | `gameFields` | .filter | hot:render | **HOT-PATH-OK** | ~16, per render | N ≈ 16 profile fields; per game page / DesktopApp render | - |
| 96 | `profileDiffers` | .some | hot:render | **HOT-PATH-OK** | ~16, per render | N ≈ 16 profile fields; dirty check per DesktopApp render | - |
| 120 | `gameGroups` | .map | hot:render | **HOT-PATH-OK** | ≤ 36, per game page render | N = 12 groups x ≤ 3 fields; per game page render | - |
| 120 | `gameGroups` | .filter | hot:render | **HOT-PATH-OK** | ≤ 36, per game page render | N = 12 groups x ≤ 3 fields; per game page render | - |
| 120 | `gameGroups` | .some | hot:render nested | **HOT-PATH-OK** | ≤ 36, per game page render | N = 12 groups x ≤ 3 fields; per game page render | - |
| 135 | `stripUndefined` | .filter | hot:render | **HOT-PATH-OK** | ~18, per render | N ≈ 18 profile keys; per game page render | - |

#### src/desktop/library/setupStatus.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 18 | `setupStatus` | .every | hot:render | **HOT-PATH-OK** | ~6, per render | N ≈ 6 HDR requirements; per game page render | - |
| 36 | `systemHdrReqs` | .filter | hot:render | **HOT-PATH-OK** | - | N ≤ 4 launchers; Home and game page render | - |
| 38 | `systemHdrReqs` | .every | hot:render | **HOT-PATH-OK** | - | N ≤ 3 Proton launchers | - |
| 56 | `homeStatus` | .some | hot:render | **HOT-PATH-OK** | - | fixes found by the scan, tens at most; Home render | - |
| 60 | `homeStatus` | .some | hot:render | **HOT-PATH-OK** | - | games (hundreds) until one has HDR, then ≤ 4 HDR checks; Home render | - |
| 60 | `homeStatus` | .every | hot:render | **HOT-PATH-OK** | - | games (hundreds) until one has HDR, then ≤ 4 HDR checks; Home render | - |

#### src/desktop/library/support.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 64 | `fixesFor` | .filter | hot:render | **NOT-WORTH** | 0, per game page render | GAME_FIXES is empty today (N = 0); per game page render | - |
| 71 | `parts` | .map | hot:render | **NOT-WORTH** | 3, per game page render | N = 3 version parts; only when feedback has a rating | - |
| 73 | `parts` | .map | hot:render | **NOT-WORTH** | 3, per game page render | N = 3 version parts; only when feedback has a rating | - |
| 78 | `versionLess` | for | hot:render | **NOT-WORTH** | 3, per game page render | N = 3 version parts | - |
| 89 | `staleness` | .find | hot:render | **NOT-WORTH** | 0, per game page render | fixes for one game, N = 0 today | - |

#### src/desktop/library/useGameProfile.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 123 | `useGameProfile > useCallback(cb)` | while | await | **SERIAL-REQUIRED** | ≤ 2 waits, per profile switch | one profile switch at a time: one HID session, protocol order | - |

#### src/desktop/live/ArtBackdrop.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 100 | `useBackdropKeys` | .find | hot:render | **HOT-PATH-OK** | ≤ 8 / per render | N ≤ 8 recent games with art, on render | - |
| 213 | `ArtBackdrop` | .map | hot:render | **HOT-PATH-OK** | ≤ 8 / every 20 s | N ≤ 8 backdrop images; renders on a 20 s cycle tick | - |

#### src/desktop/live/Calibration.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 84 | `Calibration > useEffect(cb) > setTimeout(cb) > setDraft(cb)` | .map | nested | **NOT-WORTH** | ≤ 150 / per calibration step | once per finished measurement, N ≤ ~150 samples (5 s at 30 Hz) | - |
| 92 | `Calibration > useEffect(cb) > setTimeout(cb) > setDraft(cb)` | .map | nested | **NOT-WORTH** | ≤ 150 / per calibration step | once per finished measurement, N ≤ ~150 samples | - |
| 178 | `Calibration` | .map | hot:render | **HOT-PATH-OK** | 2 / ~30 Hz | N = 2 sticks, per live frame while calibrating | - |
| 201 | `Calibration` | .map | hot:render | **HOT-PATH-OK** | 2 / ~30 Hz | N = 2 triggers, per live frame while calibrating | - |
| 213 | `Calibration` | .every | hot:render | **HOT-PATH-OK** | 3 / ~30 Hz | N = 3 gyro axes | - |

#### src/desktop/live/colorways.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 87 | `toHex` | .map | hot:render | **HOT-PATH-OK** | 3 / on color change | N = 3 channels, only when the colors change (memoized) | - |
| 95 | `reads` | .every | hot:render | **HOT-PATH-OK** | ≤ 3 / on color change | N ≤ 3 grounds, only when the colors change (memoized) | - |
| 100 | `legibleOn` | for | hot:render | **HOT-PATH-OK** | ≤ 20 / on color change | N ≤ 20 steps, early exit, only when the colors change | - |
| 102 | `legibleOn` | for-of | hot:render nested | **HOT-PATH-OK** | 2 / on color change | N = 2 ends per step, only when the colors change | - |
| 108 | `worst` | .map | hot:render | **HOT-PATH-OK** | ≤ 3 / on color change | N ≤ 3 grounds, fallback only, on color change | - |

#### src/desktop/live/controllerAccent.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 217 | `legible` | .reduce | hot:raf | **HOT-PATH-OK** | 4 / per accent change | N = 4 grounds x ≤ 20 steps, once per accent/theme change | - |
| 323 | `useControllerAccent > useEffect(cb)` | .forEach | hot:effect | **NOT-WORTH** | few / per controller change | a few listeners, only when the connected colorway changes | - |

#### src/desktop/live/ControllerInfo.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 160 | `ControllerInfo` | .filter | hot:render | **HOT-PATH-OK** | 6 / on prop change | N = 6 groups, memo component, rerenders on prop change only | - |
| 160 | `ControllerInfo` | .map | hot:render | **HOT-PATH-OK** | 6 / on prop change | N = 6 groups, memo component, rerenders on prop change only | - |
| 162 | `ControllerInfo` | .map | hot:render nested | **HOT-PATH-OK** | ≤ 21 / on prop change | N ≤ 21 counters across groups, memo component | - |
| 162 | `ControllerInfo` | .filter | hot:render nested | **HOT-PATH-OK** | ≤ 21 / on prop change | N ≤ 21 counters across groups, memo component | - |
| 165 | `ControllerInfo` | .forEach | hot:render nested | **HOT-PATH-OK** | 2 / on prop change | N = 2 sticks, memo component | - |
| 180 | `ControllerInfo` | .map | hot:render | **HOT-PATH-OK** | ≤ 6 / on prop change | N ≤ 6 groups, memo component | - |
| 198 | `ControllerInfo` | .filter | hot:render | **HOT-PATH-OK** | 2 / on prop change | N = 2 parts of one label | - |
| 276 | `ControllerInfo` | .filter | hot:render | **HOT-PATH-OK** | 2 / on prop change | N = 2 parts of one hint | - |
| 346 | `controllerInfoStatus` | .filter | hot:render | **NOT-WORTH** | - | N = 2 parts of one status line | - |

#### src/desktop/live/ControllerView.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 126 | `ControllerView > useMemo(cb)` | for-of | hot:render | **HOT-PATH-OK** | 16 / on remap change | N = 16 remap slots, useMemo on the device table | - |
| 215 | `ControllerView` | .find | hot:render | **NOT-WORTH** | - | N = 9 sections; per render (a Set lookup each) | - |

#### src/desktop/live/customColors.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 56 | `hasCustomColors` | .some | hot:render | **HOT-PATH-OK** | 6 / per render | N = 6 parts, per render | - |
| 71 | `mergeColors` | for-of | hot:render | **HOT-PATH-OK** | 6 / on color change | N = 6 parts, inside useMemo on code/model/colors | - |

#### src/desktop/live/hdrColor.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 31 | `ledLinear` | .reduce | nested | **HOT-PATH-OK** | 9 / per glow redraw | 3 x 3 matrix per HDR glow redraw (on change, not per frame) | - |

#### src/desktop/live/layoutSummary.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 9 | `layoutChanges` | .flatMap | hot:render | **HOT-PATH-OK** | 16 / per render | N = 16 slots per layout, per render of the layouts list | - |
| 12 | `layoutChanges` | .flatMap | hot:render | **HOT-PATH-OK** | 4 / per render | N = 4 Edge buttons per layout | - |
| 19 | `layoutSummary` | .map | hot:render | **HOT-PATH-OK** | ≤ 20 / per render | N ≤ 20 changes per layout | - |

#### src/desktop/live/LiveController.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 121 | `LiveArt > useLayoutEffect(cb)` | for-of | hot:effect | **NOT-WORTH** | ~30 / per mount | once per mount, N ≈ 30 parts | - |
| 136 | `LiveArt > useLayoutEffect(cb)` | for-of | hot:effect | **NOT-WORTH** | dozens / per mount | once per mount, a few dozen outlines | - |
| 145 | `LiveArt > useLayoutEffect(cb)` | for-of | hot:effect | **NOT-WORTH** | - | N = 2 triggers, once per mount | - |
| 147 | `LiveArt > useLayoutEffect(cb)` | .map | hot:effect | **NOT-WORTH** | - | N = 4 numbers, once per mount | - |
| 161 | `LiveArt > useLayoutEffect(cb)` | .filter | hot:effect | **NOT-WORTH** | few / per mount | once per mount, a few shell shapes | - |
| 184 | `LiveArt > useEffect(cb)` | for-of | hot:effect | **NOT-WORTH** | ~30 / on language change | N ≈ 30 parts, only when the language changes | - |
| 192 | `LiveArt > useEffect(cb)` | for-of | hot:effect | **NOT-WORTH** | ~30 / on language change | N ≈ 30 parts, only on selection/remap change | - |
| 213 | `LiveArt > useEffect(cb)` | .map | hot:effect | **HOT-PATH-OK** | 3 / ≤ 10 Hz | N = 3 channels, on lightbar change (≤ 10 Hz) | - |
| 235 | `LiveArt > useEffect(cb)` | for-of | hot:effect | **NOT-WORTH** | 7 / on color change | N = 7 CSS vars, only when the colorway changes | - |
| 257 | `LiveArt > useEffect(cb)` | for-of | hot:effect | **HOT-PATH-OK** | ~30 / on language change | N ≈ 30 parts, classList.toggle per live frame | - |
| 262 | `LiveArt > useEffect(cb)` | for-of | hot:effect | **HOT-PATH-OK** | 2 / ~30 Hz | N = 2 triggers per live frame | - |
| 270 | `LiveArt > useEffect(cb)` | for-of | hot:effect nested | **HOT-PATH-OK** | - | N = 2 stops per trigger, looked up at mount; only when the value changed | Done in batch 1 (dev.10) |
| 274 | `LiveArt > useEffect(cb)` | for-of | hot:effect | **HOT-PATH-OK** | 2 / ~30 Hz | N = 2 sticks per live frame | - |
| 290 | `LiveArt > useEffect(cb)` | .filter | hot:effect | **HOT-PATH-OK** | ≤ 2 / ~30 Hz | N ≤ 2 fingers per live frame | - |
| 292 | `LiveArt > useEffect(cb)` | while | hot:effect | **HOT-PATH-OK** | ≤ 2 / ~30 Hz | N ≤ 2 touch dots removed | - |
| 294 | `LiveArt > useEffect(cb)` | while | hot:effect | **HOT-PATH-OK** | ≤ 2 / ~30 Hz | N ≤ 2 touch dots added | - |
| 296 | `LiveArt > useEffect(cb)` | .forEach | hot:effect | **HOT-PATH-OK** | ≤ 2 / ~30 Hz | N ≤ 2 touch dots placed | - |

#### src/desktop/live/LiveData.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 98 | `LiveData` | .map | hot:render | **HOT-PATH-OK** | 2 / ~30 Hz | N = 2 fingers per live frame | - |
| 147 | `Rows` | .map | hot:render | **HOT-PATH-OK** | ~20 / ~30 Hz | N ≈ 20 rows per live frame (the panel shows live values) | - |
| 161 | `Xyz` | .map | hot:render | **HOT-PATH-OK** | 3 / ~30 Hz | N = 3 axes per live frame | - |
| 218 | `Spark > useEffect(cb)` | for | hot:effect | **HOT-PATH-OK** | 3 / ~30 Hz x 2 sparks | N = 3 axes per spark redraw; 2D canvas, GPU-composited | - |
| 224 | `Spark > useEffect(cb)` | .forEach | hot:effect nested | **HOT-PATH-OK** | 450 / ~30 Hz x 2 sparks | N = 150 history points per axis per redraw | - |

#### src/desktop/live/LiveStrip.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 32 | `LiveStrip` | .find | hot:render | **HOT-PATH-OK** | ~8 / ~30 Hz | N ≈ 8 lightbar modes per render | - |
| 44 | `LiveStrip` | .map | hot:render | **HOT-PATH-OK** | 4 / ~30 Hz | N = 4 player lights per render | - |
| 59 | `LiveStrip` | .map | hot:render | **HOT-PATH-OK** | 5 / ~30 Hz | N = 5 signal bars per render | - |

#### src/desktop/live/micRing.worklet.js

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 26 | `process` | for | hot:audio | **HOT-PATH-OK** | 128 / per 2.7 ms while testing | N = 128 samples per audio quantum, a ring write, no allocation | - |

#### src/desktop/live/micTest.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 73 | `normalizeClip` | for | nested | **NOT-WORTH** | ~200k / per mic test | once per recorded clip, N = clip samples (a few seconds) | - |
| 80 | `peakOf` | for-of | hot:raf | **HOT-PATH-OK** | 1024 / per frame while testing | N = 1024 samples (fftSize) per meter frame while testing | - |

#### src/desktop/live/PartPanel.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 53 | `ControllerSections` | .find | hot:render | **HOT-PATH-OK** | - | N = 9 light bar modes; per render of the panel | - |
| 55 | `ControllerSections` | .filter | hot:render | **HOT-PATH-OK** | - | N = 16 + 4 remap slots; per render of the panel | - |
| 55 | `ControllerSections` | .filter | hot:render | **HOT-PATH-OK** | - | N = 16 + 4 remap slots; per render of the panel | - |
| 222 | `AllButtonsSection` | .filter | hot:render | **HOT-PATH-OK** | 20 / ~30 Hz | N = 16 + 4 slots per render | - |
| 222 | `AllButtonsSection` | .filter | hot:render | **HOT-PATH-OK** | 20 / ~30 Hz | N = 16 + 4 slots per render | - |
| 240 | `AllButtonsSection` | .map | hot:render | **HOT-PATH-OK** | 16 / ~30 Hz | N = 16 rows; memo()ed, re-renders on a remap or focus change, not per live frame | Done in batch 1 (dev.10) |
| 256 | `AllButtonsSection` | .map | hot:render nested | **HOT-PATH-OK** | ~270 / ~30 Hz | 16 x ~17 options; memo()ed, only on a remap or focus change | Done in batch 1 (dev.10) |
| 270 | `AllButtonsSection` | .map | hot:render | **HOT-PATH-OK** | 4 / ~30 Hz | N = 4 Edge rows; memo()ed, only on a remap or focus change | Done in batch 1 (dev.10) |
| 292 | `AllButtonsSection` | .map | hot:render nested | **HOT-PATH-OK** | ~270 / ~30 Hz | 4 x ~17 options; memo()ed, only on a remap or focus change | Done in batch 1 (dev.10) |
| 338 | `ButtonLayoutsSection > useMemo(cb)` | .sort | hot:render | **HOT-PATH-OK** | - | N = saved layouts (a few); once per library change (useMemo + memo) | Done in batch 1 (dev.10) |
| 343 | `ButtonLayoutsSection > useMemo(cb)` | for-of | hot:render | **HOT-PATH-OK** | - | N = games with a profile (tens to hundreds); once per library change | Done in batch 1 (dev.10) |
| 352 | `ButtonLayoutsSection` | .map | hot:render | **HOT-PATH-OK** | 4 / ~30 Hz | N = 4 Edge names per render | - |
| 365 | `ButtonLayoutsSection` | .map | hot:render | **HOT-PATH-OK** | layouts x 20 / ~30 Hz | N = saved layouts (a few); memo()ed, only on a remap or library change | Done in batch 1 (dev.10) |
| 450 | `TriggerLive` | .map | hot:render | **HOT-PATH-OK** | 2 / ~30 Hz | N = 2 triggers per live frame | - |
| 472 | `EdgePartInfo` | .map | hot:render | **NOT-WORTH** | - | N = 4 part names; only while Button assignments is open | - |
| 488 | `TouchLive` | .filter | hot:render | **HOT-PATH-OK** | ≤ 2 / ~30 Hz | N ≤ 2 fingers per live frame | - |
| 494 | `TouchLive` | .map | hot:render | **HOT-PATH-OK** | ≤ 2 / ~30 Hz | N ≤ 2 fingers per live frame | - |

#### src/desktop/live/parts.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 49 | `partForRemapIndex` | .find | hot:render | **HOT-PATH-OK** | 16 / ~30 Hz | N = 16 entries, on Buttons-list hover/focus render | - |

#### src/desktop/live/speakerTune.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 109 | `renderTune` | for | nested | **NOT-WORTH** | ~100k / per click | renders the test tune once per speaker test, N = samples | - |

#### src/desktop/live/StickCurves.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 98 | `StickCurves` | .every | hot:render | **HOT-PATH-OK** | 2 / ~30 Hz | N = 2 sticks per render | - |
| 117 | `StickCurves` | .map | hot:render | **HOT-PATH-OK** | 2 / ~30 Hz | N = 2 tabs per render | - |
| 127 | `StickCurves` | .map | hot:render | **HOT-PATH-OK** | 6 / ~30 Hz | N = 6 curve types per render | - |
| 147 | `StickCurves` | .every | hot:render | **HOT-PATH-OK** | 2 / ~30 Hz | N = 2 sticks per render | - |
| 220 | `CurveGraph` | .map | hot:render | **HOT-PATH-OK** | 3 / ~30 Hz | N = 3 grid lines per render | - |
| 237 | `CurveGraph` | .map | hot:render | **HOT-PATH-OK** | ≤ 4 / ~30 Hz | N ≤ 4 curve points per render | - |
| 333 | `GameStickCurves` | .map | hot:render | **HOT-PATH-OK** | 2 / ~30 Hz | N = 2 tabs per render | - |
| 343 | `GameStickCurves` | .map | hot:render | **HOT-PATH-OK** | ≤ 7 / ~30 Hz | N ≤ 7 curve choices per render | - |

#### src/desktop/live/StickTestCards.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 53 | `StickTests > useEffect(cb) > setInterval(cb) > setOutlines(cb)` | .map | hot:interval | **HOT-PATH-OK** | 2 / 33 ms, test open only | N = 2 sticks per sample while the stick test is open | - |
| 58 | `StickTests > useEffect(cb) > setInterval(cb) > setOutlines(cb)` | .map | hot:interval | **HOT-PATH-OK** | 2 / 33 ms, test open only | N = 2 sticks per sample while the stick test is open | - |
| 64 | `StickTests > useEffect(cb) > setInterval(cb) > setOutlines(cb)` | .every | hot:interval | **HOT-PATH-OK** | 2 / 33 ms, test open only | N = 2 outlines, skips the state update when nothing moved | - |
| 64 | `StickTests > useEffect(cb) > setInterval(cb) > setOutlines(cb)` | .every | hot:interval | **HOT-PATH-OK** | 2 / 33 ms, test open only | N = 2 outlines, skips the state update when nothing moved | - |
| 90 | `StickTests > useEffect(cb) > setInterval(cb)` | .forEach | hot:interval | **HOT-PATH-OK** | 2 / 30 Hz for 10 s | N = 2 sticks per 33 ms sample, only during the 10 s drift test | - |
| 120 | `StickTests` | .map | hot:render | **HOT-PATH-OK** | 2 / ~30 Hz | N = 2 sticks per live frame (72-bucket outlines) | - |
| 180 | `StickTests` | .map | hot:render | **HOT-PATH-OK** | 2 / ~30 Hz | N = 2 sticks; the stats are memoized on the finished samples | Done in batch 1 (dev.10) |
| 228 | `CirclePlot` | .every | hot:render | **HOT-PATH-OK** | 72 / ~30 Hz | N = 72 buckets per live frame | - |
| 231 | `CirclePlot` | .forEach | hot:render | **HOT-PATH-OK** | 72 / ~30 Hz | N = 72 buckets, one path string per live frame | - |
| 253 | `DriftPlot` | .map | hot:render | **HOT-PATH-OK** | ~300 / ~30 Hz x 2 | ~300 samples; memo()ed, once per finished test | Done in batch 1 (dev.10) |
| 255 | `DriftPlot` | .map | hot:render | **HOT-PATH-OK** | ~300 / ~30 Hz x 2 | ~300 samples; memo()ed, once per finished test | Done in batch 1 (dev.10) |
| 257 | `line` | .map | hot:render | **HOT-PATH-OK** | ~600 / ~30 Hz x 2 | two ~300-point paths; memo()ed, once per finished test | Done in batch 1 (dev.10) |

#### src/desktop/live/stickTests.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 50 | `circularity` | .filter | hot:render | **HOT-PATH-OK** | 72 / ~30 Hz | N = 72 buckets per live frame | - |
| 57 | `circularity` | .reduce | hot:render | **HOT-PATH-OK** | ≤ 72 / ~30 Hz | N ≤ 72 reached buckets | - |
| 59 | `circularity` | .reduce | hot:render | **HOT-PATH-OK** | ≤ 72 / ~30 Hz | N ≤ 72 reached buckets | - |
| 61 | `circularity` | .filter | hot:render | **HOT-PATH-OK** | ≤ 72 / ~30 Hz | N ≤ 72 reached buckets | - |
| 63 | `circularity` | .filter | hot:render | **HOT-PATH-OK** | ≤ 72 / ~30 Hz | N ≤ 72 reached buckets | - |
| 108 | `driftStats` | .map | hot:render | **HOT-PATH-OK** | ~300 / ~30 Hz | N ≈ 300 samples; once per finished drift test (StickTests useMemo) | Done in batch 1 (dev.10) |
| 110 | `driftStats` | .map | hot:render | **HOT-PATH-OK** | ~300 / ~30 Hz | N ≈ 300; once per finished drift test (StickTests useMemo) | Done in batch 1 (dev.10) |
| 112 | `driftStats` | .reduce | hot:render | **HOT-PATH-OK** | ~300 / ~30 Hz | N ≈ 300; once per finished drift test (StickTests useMemo) | Done in batch 1 (dev.10) |
| 114 | `driftStats` | .reduce | hot:render | **HOT-PATH-OK** | ~300 / ~30 Hz | N ≈ 300; once per finished drift test (StickTests useMemo) | Done in batch 1 (dev.10) |
| 116 | `driftStats` | .map | hot:render | **HOT-PATH-OK** | ~300 / ~30 Hz | N ≈ 300; once per finished drift test (StickTests useMemo) | Done in batch 1 (dev.10) |
| 119 | `driftStats` | .some | hot:render | **HOT-PATH-OK** | ~300 / ~30 Hz | N ≈ 300; once per finished drift test (StickTests useMemo) | Done in batch 1 (dev.10) |
| 124 | `driftStats` | .reduce | hot:render | **HOT-PATH-OK** | ~300 / ~30 Hz | N ≈ 300; once per finished drift test (StickTests useMemo) | Done in batch 1 (dev.10) |

#### src/desktop/live/SwirlField.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 198 | `draw` | for | nested | **HOT-PATH-OK** | 128 / per row | CPU fallback pixel loop, inner row; once per colors / theme change | Done 2026-10-15 (`swirl-fallback`): the CPU fallback is a still frame (batch 4) |
| 203 | `draw` | for | nested | **HOT-PATH-OK** | 3 / per pixel | CPU fallback, 3 channels per pixel; once per colors / theme change | Done 2026-10-15 (`swirl-fallback`): the CPU fallback is a still frame (batch 4) |

#### src/desktop/lookKnobs.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 44 | `knob` | .find | hot:render | **NOT-WORTH** | ~4, per knob control render | N ≈ 4 look knobs; on a settings control render | - |
| 64 | `useLookKnobs > useEffect(cb)` | .forEach | hot:effect | **NOT-WORTH** | ~4, per knob change | N ≈ 4 CSS variables; only when a knob changes | - |

#### src/desktop/Markdown.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 38 | `markdownHeadings` | for-of | hot:render | **NOT-WORTH** | - | N = the text's lines (a few thousand at most); once per text (About memoizes it) | - |
| 67 | `scrollToHeading` | .find | hot:raf | **NOT-WORTH** | - | N = the shown text's headings (≤ ~100); on a click | - |

#### src/desktop/narrator.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 44 | `notify` | .forEach | hot:raf | **NOT-WORTH** | ≤ 3, per narrator change | N ≤ 3 listeners; on narrator state change, not per frame | - |
| 97 | `voiceLang` | .find | hot:raf | **NOT-WORTH** | ≤ 12, per spoken line | N ≤ 12 voice languages; once per line spoken | - |
| 97 | `voiceLang` | .find | hot:raf | **NOT-WORTH** | ≤ 12, per spoken line | N ≤ 12 voice languages; once per line spoken | - |

#### src/desktop/notices.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 109 | `railReminders` | for-of | hot:render | **NOT-WORTH** | - | N ≤ ~6 open tasks; when the tasks change | - |

#### src/desktop/openTasks.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 72 | `openTasks` | for-of | hot:render | **NOT-WORTH** | - | N ≤ 3 board problems; when the 10 s health read changes | - |

#### src/desktop/pages/AboutPage.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 75 | `StudioCard` | .map | hot:render | **HOT-PATH-OK** | ~4, per About render | N ≈ 4 studio links; About page render | - |
| 109 | `newest` | .find | hot:render | **NOT-WORTH** | - | stops at the first released heading | - |
| 116 | `AboutPage` | .filter | hot:render | **NOT-WORTH** | - | N = 6 sections; About's render | - |
| 121 | `AboutPage > useMemo(cb)` | .map | hot:render | **NOT-WORTH** | - | N = 6 texts, once per mount | - |
| 127 | `AboutPage` | .find | hot:render | **NOT-WORTH** | - | N = 6 sections; About's render | - |
| 127 | `AboutPage` | .find | hot:render | **NOT-WORTH** | - | N = 6 sections; About's render | - |
| 153 | `AboutPage` | .map | hot:render | **NOT-WORTH** | ~4, per About render | N = 4 columns; About's render | - |
| 199 | `AboutPage` | .map | hot:render | **NOT-WORTH** | ~4, per About render | N = 6 sections; About's render | - |

#### src/desktop/pages/AppSettingsPage.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 72 | `AppSettingsPage` | .find | hot:render | **NOT-WORTH** | - | N ≤ ~6 open tasks; App settings' render | - |
| 77 | `AppSettingsPage` | .filter | hot:render | **NOT-WORTH** | - | N = 3 switches; App settings' render | - |
| 349 | `CheckNow` | .map | hot:render | **HOT-PATH-OK** | - | N ≤ 3 result lines, after a click | - |
| 368 | `ColorVisionSetting` | .map | hot:render | **HOT-PATH-OK** | - | N ≈ 4 color vision options per render | - |
| 403 | `BackdropSetting` | .map | hot:render | **HOT-PATH-OK** | - | N = 3 backgrounds per render | - |
| 447 | `CustomColorsSetting` | .map | hot:render | **HOT-PATH-OK** | - | N = 6 color parts per render | - |
| 477 | `AccentSetting` | .map | hot:render | **HOT-PATH-OK** | - | N = 2 accents per render | - |
| 618 | `DeveloperSettings` | .map | hot:render | **HOT-PATH-OK** | - | N ≈ 40 colorway codes, Developer card only (dev builds) | - |
| 648 | `DeveloperSettings` | .map | hot:render | **HOT-PATH-OK** | - | N = 10 stages, Developer card only | - |
| 662 | `DeveloperSettings` | .map | hot:render | **HOT-PATH-OK** | - | N = 4 previews, Developer card only | - |

#### src/desktop/pages/GamesPage.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 86 | `RestartNotice` | .map | hot:render | **HOT-PATH-OK** | ≤ 3, per render | N ≤ 3 launchers; shown only after applying fixes | - |
| 101 | `OverwrittenNotice` | .map | hot:render | **HOT-PATH-OK** | ≤ 3, per render | N ≤ 3 launchers; shown only after a launcher overwrote a fix | - |
| 253 | `useGamesSetup` | .filter | hot:render | **HOT-PATH-OK** | - | fixes found by the scan, tens at most; Home render on interaction | - |
| 454 | `ComputerBlock` | .map | hot:render | **HOT-PATH-OK** | - | N = screens, 1-3; Home render | - |
| 454 | `ComputerBlock` | .filter | hot:render | **HOT-PATH-OK** | - | N = screens, 1-3; Home render | - |
| 462 | `ComputerBlock` | .filter | hot:render | **NOT-WORTH** | - | N = 2 parts of one status line | - |
| 479 | `HomeSections` | .filter | hot:render | **HOT-PATH-OK** | - | N ≤ 4 launchers; Home render | - |
| 483 | `HomeSections` | .filter | hot:render | **HOT-PATH-OK** | - | fixes found by the scan, tens at most; Home render | - |
| 485 | `HomeSections` | .reduce | hot:render | **NOT-WORTH** | - | N = backups (tens); Home render | - |
| 509 | `HomeSections` | .map | hot:render | **HOT-PATH-OK** | - | N ≤ 4 launchers; Home render | - |
| 620 | `HomeSections > <anonymous>` | .map | nested | **HOT-PATH-OK** | - | 1-3 files per chosen fix; review render | - |
| 731 | `FixList` | .filter | hot:render | **HOT-PATH-OK** | 4 x ≤ ~50, per render | 4 launcher groups x tens of fixes; Home render on interaction | - |
| 731 | `FixList` | .map | hot:render | **HOT-PATH-OK** | 4 x ≤ ~50, per render | 4 launcher groups x tens of fixes; Home render on interaction | - |
| 731 | `FixList` | .filter | hot:render nested | **HOT-PATH-OK** | 4 x ≤ ~50, per render | 4 launcher groups x tens of fixes; Home render on interaction | - |
| 735 | `FixList` | .map | hot:render | **HOT-PATH-OK** | ≤ 4, per render | N ≤ 4 launcher groups | - |
| 742 | `FixList` | .map | hot:render nested | **HOT-PATH-OK** | ≤ ~50, per render | fixes in one group, tens at most | - |
| 765 | `SystemPart` | .map | hot:render | **HOT-PATH-OK** | - | N = screens, 1-3; Home render | - |
| 765 | `SystemPart` | .filter | hot:render | **HOT-PATH-OK** | - | N = screens, 1-3; Home render | - |
| 784 | `SystemPart` | .map | hot:render | **HOT-PATH-OK** | - | env warnings, 0-3; Home render | - |
| 802 | `SystemPart` | .some | hot:render | **HOT-PATH-OK** | - | PipeWire pro-audio rule files, 0-3 | - |

#### src/desktop/pages/LightbarPage.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 36 | `LightbarPage` | .map | hot:render | **HOT-PATH-OK** | ~6, per render | N ≈ 9 lightbar modes; only while Light bar is open | - |
| 51 | `LightbarPage` | .map | hot:render | **HOT-PATH-OK** | ~6, per render | N = 4 favorite slots; only while Light bar is open | - |

#### src/desktop/pages/sectionFields.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 45 | `sub` | .filter | hot:render | **NOT-WORTH** | 2, per section render | N = 2 strings | - |

#### src/desktop/pages/SettingsPage.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 76 | `useGripTest > useCallback(cb)` | for | await | **SERIAL-REQUIRED** | ~6 pulses, per grip test click | timed pulses: each waits its slot on a deadline, one HID session | - |
| 138 | `HapticsSection` | .map | hot:render | **HOT-PATH-OK** | 3, per render | N = 3 sides; page render | - |
| 172 | `AutoHapticsSection` | .map | hot:render | **HOT-PATH-OK** | 4, per render | N = 4 options; page render | - |
| 193 | `AutoHapticsSection` | .map | hot:render | **HOT-PATH-OK** | 4, per render | N = 4 options; page render | - |
| 205 | `SpeakerSection` | .map | hot:render | **HOT-PATH-OK** | 4, per render | N = 4 options; page render | - |
| 313 | `MicSection` | .map | hot:render | **HOT-PATH-OK** | 3, per render | N = 3 options; page render | - |
| 342 | `StatusPinSection` | .map | hot:render | **HOT-PATH-OK** | 17, per render | N = 17 GPIO pins; page render | - |
| 426 | `DisplaySection` | .map | hot:render | **HOT-PATH-OK** | 4, per render | N = 4 options; page render | - |

#### src/desktop/pages/SlotsPage.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 40 | `formatMac` | .map | hot:render | **HOT-PATH-OK** | ≤ 24, every 1.5 s while shown | N = 6 address bytes x ≤ 4 slots; re-render per 1.5 s slot poll | - |
| 136 | `SlotsPage` | .map | hot:render | **HOT-PATH-OK** | 4, every 1.5 s while shown | N = 4 slots; re-render per 1.5 s slot poll | - |

#### src/desktop/pages/TriggersPage.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 52 | `TriggersPage` | .map | hot:render | **HOT-PATH-OK** | 7, per render | N = 7 presets; page render | - |

#### src/desktop/RecoveredNotice.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 36 | `RecoveredNotice` | .filter | hot:render | **NOT-WORTH** | - | N = the damaged files and preferences (almost always 0), per render of this notice | - |
| 41 | `RecoveredNotice` | .map | hot:render | **NOT-WORTH** | - | N = the damaged files and preferences (almost always 0) | - |

#### src/desktop/theme/desktopPalette.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 89 | `contrast` | .sort | hot:raf+render | **HOT-PATH-OK** | 2, per contrast call | N = 2 values; per color computed on theme change or render | - |
| 95 | `mix` | .map | hot:raf+render | **HOT-PATH-OK** | 3, per mix call | N = 3 channels | - |
| 106 | `hexToRgb` | .map | hot:raf+render | **HOT-PATH-OK** | 3, per call | N = 3 channels; also in LiveController render | - |
| 151 | `ensureContrast` | for | hot:raf+render | **NOT-WORTH** | ≤ 20, per theme change | ≤ 20 steps; one-shot rAF on game page open or theme change | - |
| 209 | `legibleOnAll` | for | hot:raf+render | **NOT-WORTH** | ≤ 80, per theme change | ≤ 5 passes x ≤ 4 grounds; theme change or game page open only | - |
| 209 | `legibleOnAll` | .some | hot:raf+render | **NOT-WORTH** | ≤ 80, per theme change | ≤ 5 passes x ≤ 4 grounds; theme change or game page open only | - |
| 209 | `legibleOnAll` | .reduce | hot:raf+render nested | **NOT-WORTH** | ≤ 80, per theme change | ≤ 5 passes x ≤ 4 grounds; theme change or game page open only | - |

#### src/desktop/Toasts.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 76 | `Toasts` | .map | hot:render | **NOT-WORTH** | - | N ≤ TOAST_MAX (3) toasts; per toast change | - |

#### src/desktop/tour/Tour.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 213 | `Tour` | .map | hot:render | **HOT-PATH-OK** | 19, ~30/s during the tour | N = 19 buttons, 30 Hz input renders while the tour is open | - |
| 213 | `Tour` | .filter | hot:render | **HOT-PATH-OK** | 19, ~30/s during the tour | N = 19 buttons, 30 Hz input renders while the tour is open | - |
| 223 | `Tour > useEffect(cb) > requestAnimationFrame(cb) > setPressed(cb)` | .filter | hot:raf | **HOT-PATH-OK** | <= 19 / held-button change | N <= 19 button labels, only when the held set changes on the press step | - |
| 421 | `Tour` | .map | hot:render | **HOT-PATH-OK** | ≤ 4, ~30/s during the tour | N ≤ 4 chips (PRESS_GOAL), per input render during the tour | - |

#### src/desktop/WindowsUsbRepair.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 55 | `WindowsUsbRepair` | .map | hot:render | **HOT-PATH-OK** | 4, per poll (Windows) | N = 4 steps; re-render per USB poll on Windows only | - |

#### src/flash/index.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 134 | `parseUf2Regions` | for-of | nested | **NOT-WORTH** | ~4000 blocks / per firmware flash | UF2 blocks copied once per firmware install, linear overall | - |

#### src/oled/oledShare.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 111 | `rasterize` | for | nested | **NOT-WORTH** | - | once per picture (on demand, in the worker) | - |
| 116 | `rasterize` | for-of | nested | **NOT-WORTH** | - | N = 2 keys | - |
| 129 | `rasterize` | for | nested | **NOT-WORTH** | - | 128 pixels a row, once per picture or recorded frame | - |
| 143 | `scaleIndices` | for | nested | **NOT-WORTH** | - | once per picture or recorded frame (on demand, in the worker) | - |
| 145 | `scaleIndices` | for | nested | **NOT-WORTH** | - | scale - 1 row copies | - |
| 317 | `changedRect` | for | nested | **NOT-WORTH** | - | once per recorded frame, on demand in the worker | - |
| 363 | `encodeGif` | for | nested | **NOT-WORTH** | - | the changed rows, once per recorded frame | - |

#### src/oled/simScreens.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 204 | `lines` | .map | hot:poll+usb-event | **NOT-WORTH** | - | dev/test fake only; N = 5 rows per simulated mirror read | - |
| 204 | `lines` | .filter | hot:poll+usb-event | **NOT-WORTH** | - | dev/test fake only; N = 5 rows per simulated mirror read | - |
| 212 | `lines` | .map | hot:poll+usb-event | **NOT-WORTH** | - | dev/test fake only; N = 4 slots per simulated mirror read | - |
| 217 | `lines` | .map | hot:poll+usb-event | **NOT-WORTH** | - | dev/test fake only; N = 5 rows per simulated mirror read | - |

#### src/oled/statusPad.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 167 | `filled` | for | nested | **NOT-WORTH** | ≤ 128x64 px / per sim mirror frame | small rects on the simulated OLED only (dev/test fake) | - |
| 171 | `invert` | for | nested | **NOT-WORTH** | ≤ 128x64 px / per sim mirror frame | small rects on the simulated OLED only (dev/test fake) | - |

#### src/persisted.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 154 | `salvageObject` | for-of | hot:render | **NOT-WORTH** | - | N = one object's fields (≤ ~40), only when a stored file didn't fit (once per start) | - |
| 177 | `salvageRecord` | for-of | hot:render | **NOT-WORTH** | - | N = the stored entries (games, layouts, slots: tens to a few hundred), once per read of a stored file | - |
| 191 | `salvageStrings` | .filter | hot:render | **NOT-WORTH** | - | N = a short stored list (≤ 50 dismissed notices, a page's pins, unticked fixes), on read | - |

#### src/protocol/bridgeClient.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 205 | `boardNameFrom` | .some | hot:usb-event | **HOT-PATH-OK** | 16 / 10 Hz lightbar + 1 Hz poll | N ≤ 16 name bytes per identity decode | - |
| 253 | `sameIdentity` | .every | nested | **HOT-PATH-OK** | ≤ 3 / 1 Hz identity poll | N ≤ 3 per array field (lightbar RGB), skips re-render | - |
| 277 | `allSlotsTaken` | .every | hot:render | **HOT-PATH-OK** | - | N = 4 slots; per 1.5 s slot poll | - |
| 461 | `runCommand` | for | await | **SERIAL-REQUIRED** | until done / per command | one HID session: polls 0xF1 until the sequence settles, to a deadline | - |
| 659 | `readSlots` | .map | hot:poll | **HOT-PATH-OK** | 4 / every 1.5 s on Slots | N = 4 slots | - |
| 661 | `readSlots` | .map | hot:poll | **HOT-PATH-OK** | 4 / every 1.5 s on Slots | N = 4 slots | - |
| 733 | `runControllerTest` | for | await | **SERIAL-REQUIRED** | until done / per controller test | one HID session: polls the controller header until done or deadline | - |
| 739 | `runControllerTest` | for | await nested | **SERIAL-REQUIRED** | ≤ CTRL_MAX_PAGES / per controller test | one HID session: page reads must not interleave; 63-byte report cap | - |
| 766 | `decodeAudioCounters` | .forEach | hot:poll | **HOT-PATH-OK** | 15 / per Dongle dashboard poll | N = 15 counters | - |

#### src/protocol/calibration.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 60 | `normalizeCalibration` | .map | hot:render | **HOT-PATH-OK** | 3 / per Calibration render | N = 3 gyro axes | - |
| 146 | `fitGyro` | .reduce | nested | **NOT-WORTH** | 3 x ~90 samples / per calibration | once when a gyro calibration step ends | - |

#### src/protocol/config.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 231 | `decodeConfigBody` | .filter | hot:poll+usb-event | **HOT-PATH-OK** | 2 / every 2 s config poll | N ≤ 2 offsets (with or without report id) | - |
| 231 | `decodeConfigBody` | .map | hot:poll+usb-event | **HOT-PATH-OK** | 2 / every 2 s config poll | N ≤ 2 offsets (with or without report id) | - |
| 233 | `decodeConfigBody` | .find | hot:poll+usb-event | **HOT-PATH-OK** | 2 / every 2 s config poll | N ≤ 2 candidates, early exit | - |
| 237 | `decodeConfigBody` | .map | hot:poll+usb-event | **NOT-WORTH** | issues / on a bad read | error path only (the board sent an invalid config) | - |
| 252 | `encodeConfigBody` | .map | hot:poll+usb-event | **NOT-WORTH** | issues / on a bad apply | error path only (invalid draft) | - |
| 275 | `encodeConfigBody` | for | hot:poll+usb-event | **HOT-PATH-OK** | 4 / per apply (debounced edit) | N = 4 favourite colors | - |
| 277 | `encodeConfigBody` | for | hot:poll+usb-event | **HOT-PATH-OK** | 4 / per apply (debounced edit) | N = 4 favourite colors | - |
| 279 | `encodeConfigBody` | for | hot:poll+usb-event | **HOT-PATH-OK** | 4 / per apply (debounced edit) | N = 4 favourite colors | - |
| 388 | `normalizeConfig` | .map | hot:usb-event | **HOT-PATH-OK** | 4 / every 2 s config poll | N = 4 favourite colors | - |
| 390 | `normalizeConfig` | .map | hot:usb-event | **HOT-PATH-OK** | 4 / every 2 s config poll | N = 4 favourite colors | - |
| 392 | `normalizeConfig` | .map | hot:usb-event | **HOT-PATH-OK** | 4 / every 2 s config poll | N = 4 favourite colors | - |
| 450 | `arraysEqual` | .every | hot:render | **HOT-PATH-OK** | 4 / every 2 s poll + per render | N = 4 favourite colors per field | - |
| 486 | `decodeAt` | .map | hot:poll+usb-event | **HOT-PATH-OK** | 4 / every 2 s config poll | N = 4 favourite colors | - |
| 488 | `decodeAt` | .map | hot:poll+usb-event | **HOT-PATH-OK** | 4 / every 2 s config poll | N = 4 favourite colors | - |
| 490 | `decodeAt` | .map | hot:poll+usb-event | **HOT-PATH-OK** | 4 / every 2 s config poll | N = 4 favourite colors | - |

#### src/protocol/officialFirmware.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 69 | `compareOfficial` | .map | hot:render | **HOT-PATH-OK** | ≤ 3 / per ControllerInfo render | N ≤ 3 firmware lines | - |
| 69 | `compareOfficial` | .filter | hot:render | **HOT-PATH-OK** | ≤ 3 / per ControllerInfo render | N ≤ 3 firmware lines | - |
| 72 | `compareOfficial` | .every | hot:render | **HOT-PATH-OK** | ≤ 3 / per ControllerInfo render | N ≤ 3 firmware lines | - |
| 74 | `compareOfficial` | .every | hot:render | **HOT-PATH-OK** | ≤ 3 / per ControllerInfo render | N ≤ 3 firmware lines | - |

#### src/protocol/remap.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 72 | `tablesEqual` | .every | hot:render | **HOT-PATH-OK** | 16 / per PartPanel render | N = 16 remap entries | - |

#### src/protocol/simulatedBoard.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 185 | `emit` | for-of | hot:poll+usb-event | **NOT-WORTH** | - | dev/test fake only; N = the app's few listeners, on a state change | - |
| 280 | `programVersion` | for | nested | **NOT-WORTH** | - | dev/test fake only; once per simulated update, N = the image's binary info entries (~10) | - |

#### src/protocol/simulatedDongle.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 92 | `simFirmware` | .map | hot:poll+usb-event | **NOT-WORTH** | 11 / per sim controller info read | dev/test fake only; 11 chars per controller info read | - |
| 97 | `simFirmware` | .map | hot:poll+usb-event | **NOT-WORTH** | 8 / per sim controller info read | dev/test fake only; 8 chars per controller info read | - |
| 131 | `simTelemetry` | .forEach | hot:poll+usb-event | **NOT-WORTH** | ≤ 19 / per sim telemetry read | dev/test fake only; telemetry pages are read rarely | - |
| 134 | `simTelemetry` | .forEach | hot:poll+usb-event | **NOT-WORTH** | ≤ 19 / per sim telemetry read | dev/test fake only; telemetry pages are read rarely | - |
| 136 | `simTelemetry` | .forEach | hot:poll+usb-event | **NOT-WORTH** | ≤ 19 / per sim telemetry read | dev/test fake only; telemetry pages are read rarely | - |
| 299 | `drawScreenText` | .forEach | hot:poll+usb-event | **HOT-PATH-OK** | - | dev/test fake only; N ≤ 5 rows per simulated mirror read | - |
| 310 | `drawScreenText` | for | hot:poll+usb-event | **HOT-PATH-OK** | - | dev/test fake only: 128x64 px per simulated OLED mirror read | - |
| 310 | `drawScreenText` | for | hot:poll+usb-event nested | **HOT-PATH-OK** | - | dev/test fake only: 128x64 px per simulated OLED mirror read | - |
| 326 | `liveInput` | for | hot:poll+usb-event | **HOT-PATH-OK** | - | dev/test fake only; N = 6 motion axes per read | - |
| 350 | `timings` | .forEach | hot:poll+usb-event | **HOT-PATH-OK** | 8 / per sim 0xFC read (dashboard) | dev/test fake only; N = 8 timing stages | - |
| 383 | `getReport` | for | hot:poll+usb-event | **HOT-PATH-OK** | 1024 / per sim mirror poll | dev/test fake only: 1024-byte test pattern | - |
| 442 | `getReport` | .forEach | hot:poll+usb-event | **HOT-PATH-OK** | 4 / every 1.5 s on Slots | dev/test fake only; N = 4 slots | - |
| 705 | `tick` | .find | hot:poll+usb-event | **NOT-WORTH** | - | dev/test fake only; N = 9 button names, one press | - |
| 780 | `identity` | .some | hot:poll+usb-event | **HOT-PATH-OK** | ≤ 50 / per sim identity (10 Hz) | dev/test fake only; N ≤ 50 config bytes, early exit | - |
| 780 | `identity` | .some | hot:poll+usb-event | **HOT-PATH-OK** | ≤ 50 / per sim identity (10 Hz) | dev/test fake only; N ≤ 50 config bytes, early exit | - |
| 786 | `identity` | .map | hot:poll+usb-event | **HOT-PATH-OK** | 2 / per sim identity (10 Hz) | dev/test fake only; N = 2 colorway chars | - |
| 798 | `identity` | .map | hot:poll+usb-event | **HOT-PATH-OK** | 8 / per sim identity (10 Hz) | dev/test fake only; N = 8 board-name chars | - |

#### src/protocol/stickCurve.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 65 | `isValidCurve` | .some | hot:render | **HOT-PATH-OK** | 4 / per curveAt call (65 per graph) | N = 4 points; cost is in the callers (see nodesOf row) | - |
| 68 | `isValidCurve` | for | hot:render | **HOT-PATH-OK** | 3 / per curveAt call (65 per graph) | N = 3 point pairs | - |
| 116 | `curvesEqual` | .every | hot:render | **HOT-PATH-OK** | 4 / per StickCurves render | N = 4 points | - |
| 146 | `buildNodes` | .map | hot:render | **HOT-PATH-OK** | - | N = 4 points; once per curve (WeakMap cache), not per call | Done in batch 1 (dev.10) |
| 146 | `buildNodes` | .map | hot:render | **HOT-PATH-OK** | - | N = 4 points; once per curve (WeakMap cache), not per call | Done in batch 1 (dev.10) |
| 153 | `evalNodes` | for | hot:render | **HOT-PATH-OK** | ≤ 34 / 65 x 2 graphs per frame | N ≤ 34 nodes, the firmware math itself | - |

#### src/protocol/webUsbTransport.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 23 | `configuratorInterface` | .find | hot:poll+usb-event | **HOT-PATH-OK** | ≤ 8 / per findPermitted (2 s poll) | N = 2-4 interfaces x 1-2 alternates | - |
| 23 | `configuratorInterface` | .some | hot:poll+usb-event nested | **HOT-PATH-OK** | ≤ 8 / per findPermitted (2 s poll) | N = 2-4 interfaces x 1-2 alternates | - |
| 41 | `findPermitted` | .find | hot:poll+usb-event | **HOT-PATH-OK** | 1-2 / 2 s poll (Windows repair) | N = permitted USB devices, 1-2 | - |

#### src/update/manifest.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 68 | `parseVersion` | .some | hot:interval+render | **HOT-PATH-OK** | 3 / per update check + render | N = 3 version parts | - |
| 88 | `isNewer` | for | hot:interval+render | **HOT-PATH-OK** | 3 / per update check + render | N = 3 version parts | - |

### Firmware (`MarcelineVPQ/DS5Dongle-OLED-Edition`)

Runs on: where it runs (see "How the list was made"). Wait: `forever` / `spin` / `drain` / `+timeout` / `+bounded`, and `flash` when the body touches flash. Nest: loops around it in the same function.

#### src/audio.cpp

| Line | Function | Runs on | Wait | Nest | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|---|
| 265 | `mic_drain` | core0-loop | - | 0 | **HOT-PATH-OK** | few slices / per main-loop pass while mic on | bounded by free USB mic FIFO space; one 48-frame slice each | - |
| 278 | `mic_drain` | core0-loop | - | 1 | **HOT-PATH-OK** | 48 / per slice | N = 48 frames per slice, mono to L/R copy | - |
| 500 | `audio_loop` | core0-loop | - | 0 | **HOT-PATH-OK** | ≤ raw buffer frames / per USB audio packet | N = frames of one USB audio read (raw buffer); speaker mono detect | - |
| 509 | `audio_loop` | core0-loop | - | 0 | **HOT-PATH-OK** | ≤ raw buffer frames / per USB audio packet | N = frames of one USB audio read; peaks + split, the audio path itself | - |
| 634 | `speaker_proc` | core1 | - | 0 | **HOT-PATH-OK** | 1024 / per speaker frame (10 ms) | N = 512 stereo samples into the resampler, core1 RAM code, no flash | - |
| 751 | `core1_entry` | core1 | forever | 0 | **HOT-PATH-OK** | forever / core1 | core1 service loop: bounded work per item, sleep_us(10) when idle | - |

#### src/audio_levels.h

| Line | Function | Runs on | Wait | Nest | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|---|
| 33 | `AudioPeak::level` | callback+core0-loop | - | 0 | **HOT-PATH-OK** | ≤ 48 / per audio chunk + VU frame | N ≤ kSteps = 48 decay steps, usually 0-2 | - |

#### src/bt.cpp

| Line | Function | Runs on | Wait | Nest | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|---|
| 183 | `bt_wipe_all_slots` | core0-loop | - | 0 | **NOT-WORTH** | ≤ 16 / rare (wipe all) | link-key snapshot, N ≤ 16; on a user wipe only | - |
| 188 | `bt_wipe_all_slots` | core0-loop | - | 0 | **NOT-WORTH** | ≤ 16 / rare (wipe all) | drop each snapshotted key, N ≤ 16; on a user wipe only | - |
| 458 | `hci_packet_handler` | callback | - | 0 | **NOT-WORTH** | 16 / per connection | printf of the 16-byte key, on a link key request only | - |
| 561 | `hci_packet_handler` | callback | drain | 0 | **NOT-WORTH** | ≤ 10 / per disconnect | drains send_fifo (≤ 10 entries) on disconnect | - |

#### src/calib.cpp

| Line | Function | Runs on | Wait | Nest | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|---|
| 47 | `build_curves` | callback | - | 0 | **NOT-WORTH** | 2 / boot + host set | 2 sticks, on load or when the host sets curves | - |
| 56 | `set_linear` | boot | - | 0 | **NOT-WORTH** | 8 / rare | 8 default points, rare (invalid curve) | - |
| 70 | `set_identity` | callback | - | 0 | **NOT-WORTH** | 2 / rare | 2 sticks, on a reset / invalid load | - |
| 72 | `set_identity` | callback | - | 0 | **NOT-WORTH** | 2 / rare | 2 triggers, on a reset / invalid load | - |
| 74 | `set_identity` | callback | - | 0 | **NOT-WORTH** | 3 / rare | 3 gyro axes, on a reset / invalid load | - |
| 79 | `valid` | callback | - | 0 | **NOT-WORTH** | 2 / boot + host set | 2 sticks, validating a host set or a load | - |
| 84 | `valid` | callback | - | 0 | **NOT-WORTH** | 2 / boot + host set | 2 triggers, validating a host set or a load | - |
| 94 | `recompute_active` | callback | - | 0 | **NOT-WORTH** | 2 / boot + host set | 2 sticks, after a host set | - |
| 143 | `calib_load` | boot | - | 0 | **NOT-WORTH** | 4 / boot | boot-only, kNumSlots = 4 | - |
| 148 | `calib_load` | boot | - | 0 | **NOT-WORTH** | 4 / boot | boot-only, 4 slot bodies | - |
| 152 | `calib_load` | boot | - | 0 | **NOT-WORTH** | 4 / boot | boot-only, 4 slots | - |
| 154 | `calib_load` | boot | - | 1 | **NOT-WORTH** | 8 / boot | boot-only, 2 curves per slot | - |
| 160 | `calib_load` | boot | - | 0 | **NOT-WORTH** | 4 / boot | boot-only, 4 slots | - |
| 175 | `calib_service` | core0-loop | - | 0 | **NOT-WORTH** | 3 / per connection | 3 gyro words, once per connection when 0x05 lands | - |
| 182 | `calib_service` | core0-loop | - | 0 | **NOT-WORTH** | 3 / per connection | 3 gyro words, once per connection | - |
| 197 | `calib_apply` | core0-loop | - | 0 | **HOT-PATH-OK** | 2 / per input report | 2 triggers per input report; calib_apply is not CORE0_RAM_FUNC | - |
| 204 | `calib_apply` | core0-loop | - | 0 | **HOT-PATH-OK** | 3 / per input report | 3 gyro axes per input report, only with gyro calibration on | - |
| 235 | `curves_set` | callback | - | 0 | **NOT-WORTH** | 2 / host set | 2 curves, on a host curves set | - |

#### src/cmd.cpp

| Line | Function | Runs on | Wait | Nest | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|---|
| 58 | `cpu_temp_raw_smoothed` | callback+core0-loop | - | 0 | **FIX-HOT-PATH** | 256 / per CPU-screen frame (10 Hz) + per 0xFC GET | 256 blocking adc_read() calls (~0.5 ms) in one core0 main-loop pass | Take a few samples per pass (or ADC FIFO + round robin) into a running sum; or 16-32 samples + the EMA it already has |
| 538 | `pico_cmd_get` | callback | - | 0 | **NOT-WORTH** | 4 / per host GET (~1 Hz) | 4 slot addresses, per 0xFA host GET | - |
| 544 | `pico_cmd_get` | callback | - | 0 | **NOT-WORTH** | 4 / per host GET (~1 Hz) | 4 occupied flags, per 0xFA host GET | - |
| 691 | `pico_cmd_get` | callback | - | 0 | **NOT-WORTH** | 44 / per diagnostic GET | ≤ 44 bytes zeroed, per 0xFD diagnostic GET | - |
| 707 | `pico_cmd_get` | callback | - | 0 | **NOT-WORTH** | 8 / per diagnostic GET | 8 bytes, per 0xFD diagnostic GET | - |
| 709 | `pico_cmd_get` | callback | - | 0 | **NOT-WORTH** | 8 / per diagnostic GET | 8 bytes, per 0xFD diagnostic GET | - |
| 725 | `pico_cmd_get` | callback | - | 0 | **NOT-WORTH** | ≤ 63 / per diagnostic GET | ≤ 63 bytes zeroed, per 0xFE diagnostic GET | - |
| 732 | `pico_cmd_get` | callback | - | 0 | **NOT-WORTH** | ≤ 61 / per diagnostic GET | ≤ 61 bytes, per 0xFE diagnostic GET | - |

#### src/dse.cpp

| Line | Function | Runs on | Wait | Nest | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|---|
| 115 | `dse_task` | core0-loop | - | 0 | **NOT-WORTH** | 61 / per Edge connection | 61-byte handshake copy, once per DSE unlock | - |

#### src/grip_wave.h

| Line | Function | Runs on | Wait | Nest | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|---|
| 66 | `GripWave::fill` | callback+core0-loop | - | 0 | **HOT-PATH-OK** | 64 / per 21 ms, test only | N = SAMPLE_SIZE pairs per test report, only during the haptic test | - |

#### src/main.cpp

| Line | Function | Runs on | Wait | Nest | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|---|
| 77 | `bt_31_mic_prefix` | core0-loop | - | 0 | **HOT-PATH-OK** | 6 / per diag frame (10 Hz) | 6 bytes, for the OLED diagnostics screen | - |
| 201 | `on_bt_data` | callback | - | 0 | **HOT-PATH-OK** | 8 / per BT input frame | ≤ 8 bytes per non-0x31 BT frame (debug counters) | - |
| 212 | `on_bt_data` | callback | - | 0 | **HOT-PATH-OK** | 16 / per BT input frame | ≤ 16 bytes per BT frame (debug counters) | - |
| 223 | `on_bt_data` | callback | - | 0 | **NOT-WORTH** | 61 / rare (new max length) | ≤ 61 bytes, only when a new longest 0x31 frame appears | - |
| 554 | `main` | boot | timeout | 0 | **SERIAL-REQUIRED** | ≤ 5 s / boot, serial builds only | debug build: wait for a terminal until a 5 s deadline | - |
| 579 | `main` | boot | spin+bounded | 0 | **NOT-WORTH** | 6 x 500 ms / boot after a crash | 6 LED blinks after a watchdog reboot, boot-only | - |
| 617 | `main` | boot | forever | 0 | **SERIAL-REQUIRED** | forever / core0 | core0 main loop: stage order is the design, each stage perf-timed | - |

#### src/oled.cpp

| Line | Function | Runs on | Wait | Nest | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|---|
| 309 | `rect_outline` | callback+core0-loop | - | 0 | **HOT-PATH-OK** | ≤ 128 / per OLED frame (10 Hz) | w ≤ 128 px, OLED render at 10 Hz (kFrameUs 100 ms) | - |
| 311 | `rect_outline` | callback+core0-loop | - | 0 | **HOT-PATH-OK** | ≤ 64 / per OLED frame (10 Hz) | h ≤ 64 px, OLED render at 10 Hz | - |
| 316 | `rect_filled` | callback+core0-loop | - | 0 | **HOT-PATH-OK** | ≤ 64 / per OLED frame (10 Hz) | h ≤ 64 rows, OLED render at 10 Hz | - |
| 318 | `rect_filled` | callback+core0-loop | - | 1 | **HOT-PATH-OK** | small boxes / per OLED frame (10 Hz) | w x h ≤ 8192 px but used for small boxes, OLED render at 10 Hz | - |
| 325 | `rect_invert` | core0-loop | - | 0 | **HOT-PATH-OK** | small region / per OLED frame (10 Hz) | h rows of a pressed-control region, OLED render at 10 Hz | - |
| 327 | `rect_invert` | core0-loop | - | 1 | **HOT-PATH-OK** | small region / per OLED frame (10 Hz) | w px of a pressed-control region, OLED render at 10 Hz | - |
| 338 | `draw_char` | core0-loop | - | 0 | **HOT-PATH-OK** | 5 / per char per frame (10 Hz) | 5 font columns per char, OLED render at 10 Hz | - |
| 341 | `draw_char` | core0-loop | - | 1 | **HOT-PATH-OK** | 7 / per column per frame (10 Hz) | 7 font rows per column, OLED render at 10 Hz | - |
| 349 | `draw_text` | core0-loop | - | 0 | **HOT-PATH-OK** | ≤ 21 / per text line per frame | ≤ ~21 chars per line, OLED render at 10 Hz | - |
| 358 | `draw_text_clipped` | core0-loop | - | 0 | **HOT-PATH-OK** | ≤ 32 / per frame (10 Hz) | ≤ title length chars, scrolling title at 10 Hz | - |
| 365 | `draw_text_clipped` | core0-loop | - | 1 | **HOT-PATH-OK** | 5 / per char per frame | 5 font columns, scrolling title at 10 Hz | - |
| 369 | `draw_text_clipped` | core0-loop | - | 2 | **HOT-PATH-OK** | 7 / per column per frame | 7 font rows, scrolling title at 10 Hz | - |
| 415 | `draw_icon` | core0-loop | - | 0 | **HOT-PATH-OK** | ≤ 16 / per icon per frame | icon rows (≤ 16), OLED render at 10 Hz | - |
| 417 | `draw_icon` | core0-loop | - | 1 | **HOT-PATH-OK** | ≤ 16 / per icon row per frame | icon columns (≤ 16), OLED render at 10 Hz | - |
| 486 | `send_trigger_effect` | core0-loop | - | 0 | **NOT-WORTH** | 10 / per button press | 10 trigger zones, on a KEY press / leaving the screen | - |
| 508 | `send_trigger_effect` | core0-loop | - | 0 | **NOT-WORTH** | 10 / per button press | 10 trigger zones, on a KEY press | - |
| 552 | `send_trigger_effect` | core0-loop | - | 0 | **NOT-WORTH** | 9 / per button press | 9 effect bytes (left), on a KEY press | - |
| 555 | `send_trigger_effect` | core0-loop | - | 0 | **NOT-WORTH** | 9 / per button press | 9 effect bytes (right), on a KEY press | - |
| 747 | `sample_charge_eta` | core0-loop | - | 0 | **HOT-PATH-OK** | ≤ 5 / per OLED tick while charging | N ≤ kRing = 5 copies, at 10 Hz while charging | - |
| 749 | `sample_charge_eta` | core0-loop | - | 0 | **HOT-PATH-OK** | ≤ 5 / per OLED tick while charging | insertion sort of ≤ 5 items, at 10 Hz while charging | - |
| 753 | `sample_charge_eta` | core0-loop | - | 1 | **HOT-PATH-OK** | ≤ 4 / per item | inner shift of the ≤ 5-item insertion sort | - |
| 762 | `sample_charge_eta` | core0-loop | - | 0 | **HOT-PATH-OK** | ≤ 10 / per OLED tick while charging | ≤ 10 charge steps summed, at 10 Hz while charging | - |
| 1020 | `render_screen_diag` | core0-loop | - | 0 | **HOT-PATH-OK** | 5 / per diag frame (10 Hz) | kVisible = 5 diagnostic rows, diag screen at 10 Hz | - |
| 1180 | `imu_cal_parse` | core0-loop | - | 0 | **NOT-WORTH** | 6 / per connection | 6 IMU axes, once per connection when 0x05 lands | - |
| 1228 | `render_screen_gyro` | core0-loop | - | 0 | **HOT-PATH-OK** | 38 / per gyro frame (10 Hz) | 38 px crosshair line, gyro screen at 10 Hz | - |
| 1230 | `render_screen_gyro` | core0-loop | - | 0 | **HOT-PATH-OK** | 38 / per gyro frame (10 Hz) | 38 px crosshair line, gyro screen at 10 Hz | - |
| 1260 | `render_screen_touchpad` | core0-loop | - | 0 | **HOT-PATH-OK** | 2 / per touchpad frame (10 Hz) | 2 fingers, touchpad screen at 10 Hz | - |
| 1504 | `lightbar_load_config` | core0-loop | - | 0 | **NOT-WORTH** | 4 / boot + host config change | 4 favorites, at boot and when the host changes config | - |
| 1516 | `lightbar_save_config` | core0-loop | - | 0 | **NOT-WORTH** | 4 / rare (screen exit) | 4 favorites, leaving the Lightbar screen with changes (one flash save) | - |
| 1572 | `settings_adjust` | core0-loop | - | 0 | **NOT-WORTH** | 1 / per button press | abs(delta) steps (1), on a D-pad press in Settings | - |
| 1821 | `render_screen_settings` | core0-loop | - | 0 | **HOT-PATH-OK** | 5 / per settings frame (10 Hz) | kVisible = 5 settings rows, settings screen at 10 Hz | - |
| 1913 | `render_screen_slots` | core0-loop | - | 0 | **HOT-PATH-OK** | 4 / per slots frame (10 Hz) | kNumSlots = 4 rows, slots screen at 10 Hz | - |
| 1938 | `boot_splash` | boot | - | 0 | **NOT-WORTH** | ≤ 20 / boot | strlen of 3 splash lines, boot-only | - |
| 2088 | `oled_loop` | core0-loop | - | 0 | **HOT-PATH-OK** | 10 / per OLED tick (10 Hz) | 10 input bytes hashed for the idle timer, at 10 Hz | - |

#### src/oled_flush.h

| Line | Function | Runs on | Wait | Nest | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|---|
| 21 | `BitReverseTable::BitReverseTable` | - | - | 0 | **NOT-WORTH** | 256 / compile time | constexpr: the 256-entry bit-reverse table is built at compile time | - |
| 41 | `stream_frame` | core0-loop | - | 0 | **HOT-PATH-OK** | 64 / per changed OLED frame (≤ 10 Hz) | 64 rows, only when the frame changed (memcmp skip), 129 SPI frames | - |
| 48 | `stream_frame` | core0-loop | - | 1 | **HOT-PATH-OK** | 16 / per row per changed frame | 16 bytes bit-reversed per row, only when the frame changed | - |

#### src/perf.cpp

| Line | Function | Runs on | Wait | Nest | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|---|
| 29 | `perf_serialize` | callback | - | 0 | **HOT-PATH-OK** | ≤ 8 / per 0xFC GET | PERF_NUM_STAGES rows, per 0xFC telemetry GET | - |
| 37 | `perf_serialize` | callback | - | 1 | **SERIAL-REQUIRED** | usually 1 / per stage per 0xFC GET | seqlock retry against the other core's writer, bounded to 1000 tries | - |

#### src/ram_mem.c

| Line | Function | Runs on | Wait | Nest | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|---|
| 29 | `memcpy` | callback+core0-loop+core1 | - | 0 | **HOT-PATH-OK** | n / 4 / per call | word copy of n/4, RAM-resident for core1 libopus and core0 SDK | - |
| 35 | `memcpy` | callback+core0-loop+core1 | - | 0 | **HOT-PATH-OK** | ≤ 3 (or n unaligned) / per call | tail of ≤ 3 bytes (or bytewise when unaligned), RAM-resident | - |
| 46 | `memset` | callback+core0-loop+core1 | - | 0 | **HOT-PATH-OK** | n / 4 / per call | word fill of n/4, RAM-resident for core1 and core0 | - |
| 51 | `memset` | callback+core0-loop+core1 | - | 0 | **HOT-PATH-OK** | ≤ 3 (or n unaligned) / per call | tail of ≤ 3 bytes (or bytewise when unaligned), RAM-resident | - |
| 64 | `memmove` | core0-loop+core1 | - | 0 | **HOT-PATH-OK** | n / 4 / per call | forward word move of n/4, RAM-resident | - |
| 70 | `memmove` | core0-loop+core1 | - | 0 | **HOT-PATH-OK** | ≤ 3 (or n) / per call | forward tail, ≤ 3 bytes when aligned, RAM-resident | - |
| 75 | `memmove` | core0-loop+core1 | - | 0 | **HOT-PATH-OK** | n / per overlapping call | backward bytewise move (overlap), RAM-resident; rare in callers | - |

#### src/remap.cpp

| Line | Function | Runs on | Wait | Nest | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|---|
| 59 | `set_identity` | callback | - | 0 | **NOT-WORTH** | 16 / rare | 16 table entries, on a reset / invalid load | - |
| 65 | `recompute_active` | callback | - | 0 | **NOT-WORTH** | 16 / host set | 16 entries, after a host remap set | - |
| 69 | `recompute_active` | callback | - | 0 | **NOT-WORTH** | 4 / host set | 4 extra buttons, after a host remap set | - |
| 76 | `valid_extra` | callback | - | 0 | **NOT-WORTH** | 4 / host set + boot | 4 extra buttons, validating a host set / load | - |
| 91 | `valid_table` | callback | - | 0 | **NOT-WORTH** | 16 / host set + boot | 16 entries, validating a host set / load | - |
| 207 | `remap_set_extra` | callback | - | 0 | **NOT-WORTH** | 16 / host set | 16 entries, a host extra-button set while temporary | - |
| 252 | `remap_apply` | core0-loop | - | 0 | **HOT-PATH-OK** | 16 / per input report | 16 sources per input report, only with a remap on (fast return) | - |
| 259 | `remap_apply` | core0-loop | - | 0 | **HOT-PATH-OK** | 16 / per input report | 16 table entries per input report, only with a remap on | - |
| 272 | `remap_apply` | core0-loop | - | 0 | **HOT-PATH-OK** | 4 / per input report | 4 Edge extra buttons per input report, only with a remap on | - |

#### src/slots.cpp

| Line | Function | Runs on | Wait | Nest | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|---|
| 60 | `slots_load` | boot | - | 0 | **NOT-WORTH** | 4 / boot | boot-only print of 4 slots | - |
| 86 | `slot_owner_of` | callback | - | 0 | **NOT-WORTH** | 4 / per inquiry result | 4 slots, per BT inquiry result while pairing | - |
| 108 | `slots_wipe_all` | core0-loop | - | 0 | **NOT-WORTH** | 4 / rare (wipe all) | 4 slots, on a user wipe (then one flash save) | - |
| 117 | `slots_any_empty` | callback+core0-loop | - | 0 | **NOT-WORTH** | 4 / per BT event | 4 slots, on pairing / connection events | - |

#### src/stick_curve.h

| Line | Function | Runs on | Wait | Nest | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|---|
| 75 | `isqrt` | core0-loop | - | 0 | **HOT-PATH-OK** | ≤ 15 / per input report | ≤ 15 shifts to align, per stick per input report with a curve | - |
| 77 | `isqrt` | core0-loop | - | 0 | **HOT-PATH-OK** | ≤ 16 / per input report | ≤ 16 iterations integer sqrt, per stick per input report with a curve | - |
| 98 | `stick_curve_valid` | callback | - | 0 | **NOT-WORTH** | 3 / host set + boot | 3 custom points, validating a host set / load | - |
| 112 | `stick_curve_build` | callback | - | 0 | **NOT-WORTH** | 4 / host set + boot | 4 custom points, on a curve build (host set / load) | - |
| 123 | `stick_curve_build` | callback | - | 0 | **NOT-WORTH** | 33 / host set + boot | kCurveLutSize = 33 preset nodes, on a curve build | - |
| 134 | `stick_curve_eval` | core0-loop | - | 0 | **HOT-PATH-OK** | ≤ 32 / per input report | ≤ 32 segments linear scan per stick per input report with a curve | - |

#### src/usb_descriptors.cpp

| Line | Function | Runs on | Wait | Nest | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|---|
| 972 | `tud_descriptor_string_cb` | callback | - | 0 | **NOT-WORTH** | ≤ 8 / per enumeration | serial prefix chars, USB enumeration only | - |
| 983 | `tud_descriptor_string_cb` | callback | - | 0 | **NOT-WORTH** | ≤ 32 / per enumeration | string chars, USB enumeration only | - |
| 1014 | `tud_descriptor_string_cb` | callback | - | 0 | **NOT-WORTH** | 6 / per enumeration | 6 MAC bytes, USB enumeration only | - |
| 1018 | `tud_descriptor_string_cb` | callback | - | 0 | **NOT-WORTH** | 6 / per enumeration | 6 MAC bytes, USB enumeration only | - |
| 1023 | `tud_descriptor_string_cb` | callback | - | 0 | **NOT-WORTH** | 6 / per enumeration | 6 MAC bytes to hex, USB enumeration only | - |
| 1057 | `tud_descriptor_string_cb` | callback | - | 0 | **NOT-WORTH** | ≤ 32 / per enumeration | string chars, USB enumeration only | - |

#### src/utils.h

| Line | Function | Runs on | Wait | Nest | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|---|
| 98 | `crc32_table_entry` | - | - | 0 | **NOT-WORTH** | 8 / compile time | constexpr: 8 bits per CRC table entry, compile time | - |
| 107 | `make_crc32_table` | - | - | 0 | **NOT-WORTH** | 256 / compile time | constexpr: the 256-entry CRC table, compile time | - |
| 121 | `crc32_seeded` | callback+core0-loop | - | 0 | **HOT-PATH-OK** | ≤ 547 / per BT output report | table CRC over one report (≤ 78 bytes out, 547 for 0x39), RAM table | - |
| 422 | `print_hex` | - | - | 0 | **NOT-WORTH** | n / unused | debug hex dump, not called in the firmware build | - |

#### src/vendor_itf.cpp

| Line | Function | Runs on | Wait | Nest | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|---|
| 85 | `ms_os_string_descriptor` | callback | - | 0 | **NOT-WORTH** | 7 / per enumeration | 7 signature chars, USB enumeration only | - |
| 115 | `put32` | callback | - | 0 | **NOT-WORTH** | 4 / once | 4 bytes, building MS OS descriptors once | - |
| 135 | `build_ext_props` | callback | - | 0 | **NOT-WORTH** | 21 / once | property-name chars, built once (static flag) | - |
| 138 | `build_ext_props` | callback | - | 0 | **NOT-WORTH** | ≤ 40 / once | property-data chars, built once (static flag) | - |

#### src/version_label.h

| Line | Function | Runs on | Wait | Nest | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|---|
| 22 | `make` | - | - | 0 | **NOT-WORTH** | ≤ 32 / compile time | constexpr version label, compile time (and host tests) | - |
| 24 | `make` | - | - | 0 | **NOT-WORTH** | ≤ 32 / compile time | constexpr version label, compile time (and host tests) | - |
| 27 | `make` | - | - | 1 | **NOT-WORTH** | 13 / compile time | constexpr suffix match, compile time (and host tests) | - |
