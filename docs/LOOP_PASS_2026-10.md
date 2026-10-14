# Loop pass: every loop that waits or sits on a hot path, with a verdict

_2026-10-13. Done per CLAUDE.md "Loop pass" (the AVIEW serial-loop pass, adapted to the app and the firmware). This is the one doc for both repos: the firmware's CLAUDE.md links here. The owner picks which batches to do. **Batch 1 is done** (dev.10, see below). Batches 2-4 are still proposals. The app tables were re-run after master's Games redesign was merged in (507 loops) and again after batch 1 (508)._

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

**Every row has exactly one verdict**, written as a comment on the loop (`// loop: VERDICT — reason`). The gates fail on a listed loop without one: `npm run gates` and CI here, and `build.yml` / `release.yml` in the firmware. Line numbers are as of the batch 1 commit; if code moves, the function name finds the loop.

| Verdict | App | Firmware | Meaning |
|---|---|---|---|
| PARALLELIZE | 7 | 0 | Independent async work per step. Run it with a bound. |
| BATCH | 5 | 0 | One call, read or index instead of N. |
| SERIAL-REQUIRED | 20 | 3 | Must stay in order, for the reason given: one HID session, PICOBOOT session order, a deadline, launcher order, stream order, or a data dependency. |
| HOT-PATH-OK | 340 | 55 | Runs per frame, poll or pass, but N is small and bounded (N is stated). |
| FIX-HOT-PATH | 6 | 1 | Per-frame or per-poll work that shouldn't be there (allocation, sort, O(n²), DOM queries, CPU pixel work, a blocking read on core0's loop). |
| NOT-WORTH | 130 | 69 | Tiny N, or startup-only / rare. |
| **Total** | **508** | **128** | |

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

The scan runs at startup when Games is on, on a rescan, and after each apply. It is synchronous on the main process, so a big library holds up IPC and the tray while it runs.

| Location | Function | Runs | Why | Change |
|---|---|---|---|---|
| `electron/main/games/vdf.ts:111`, `games.ts:341` | `getKey` from `scanSteam` | 3 lookups × Steam games × thousands of `localconfig` keys / per scan | Each lookup is a linear `.find` over localconfig's `apps` node. Probably the scan's largest CPU cost. | Index `apps` and `CompatToolMapping` into a lowercase `Map` once per scan. |
| `electron/main/games/steam.ts:132` | `steamAppManifests` | Steam games, twice / per scan | One synchronous read and VDF parse per manifest, done again by `gameDetails`. | Read with `fs.promises` under a bound (~8), and share one read between the list and the details. |
| `electron/main/games/heroic.ts:118` | `listHeroicGames` | Heroic games / per scan | One synchronous `GamesConfig` JSON read per game. | Bounded (~8) async reads before building the list. |
| `electron/main/games/lutris.ts:117` | `listLutrisGames` | Lutris games / per scan | One synchronous YAML read and parse per game. | Bounded (~8) async reads, then parse. |
| `electron/main/games/games.ts:512, 681`; `proton.ts:106` | `scanHeroic`, `scanLutris`, `buildVersion` | Heroic + Lutris games / per scan | The same Proton build's `version` file is re-read for every game that uses it. | Memoize `buildVersion` per scan: one read per build. |

### Batch 4: lists and effects off the frame path

| Location | Function | Runs | Why | Change |
|---|---|---|---|---|
| `src/desktop/library/GameLibrary.tsx:266` | `GameLibrary` | hundreds of tiles / per library render, even when a game page hides the grid | Every tile re-renders on every library render. | `React.memo` `GameTile` with a stable `onOpen`, or don't render the grid while a game page covers it. |
| `src/desktop/dongle/DongleConsole.tsx:107` | `DongleConsole` | ≤ 200 rows / 10 per s while the log tab is shown | Re-rendered on each OLED mirror frame, with a `toLocaleTimeString` per row. | Format the time when the line is added; memo the list. |
| `src/desktop/live/HdrGlow.tsx:91` | `buildMask` | ~1M pixels / every rAF during a window drag (HDR only) | The full-size mask is rebuilt on every resize frame. | Rebuild once the resize settles (~150 ms). |
| `src/desktop/live/SwirlField.tsx:176, 178, 182` | CPU renderer `draw` | 128 × 72 px in JS / 12.5 Hz when there's no GPU (already paused while hidden) | Pixel work on the CPU, against the lean rule. **Owner decision.** | Without a GPU: one still frame (or ≤ 2 fps); animate only on the GPU path. |

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
| 54 | `downloadVerified` | for | await | **SERIAL-REQUIRED** | 1 per chunk / per firmware or Proton download | stream order: each chunk is hashed and written in sequence, stall deadline | - |

#### electron/main/feedSignature.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 19 | `feedSignedBy` | .some | hot:interval | **NOT-WORTH** | 1-2 / per update check (hours apart) | N = 1 trusted key (2 during a rotation) | - |

#### electron/main/games/appinfo.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 52 | `parseAppTypes` | for | hot:scan | **HOT-PATH-OK** | ~100k strings / once per scan | one pass over appinfo.vdf's string table, linear, no allocation per step | - |
| 71 | `findType` | while | hot:scan | **HOT-PATH-OK** | tens of keys per wanted app / per scan | walks one wanted app's key-values, returns at common/type | - |
| 103 | `findType` | while | hot:scan nested | **HOT-PATH-OK** | a few bytes / rare value type | skips one UTF-16 value, linear in its length | - |
| 116 | `parseAppTypes` | while | hot:scan | **HOT-PATH-OK** | ~30k app entries / once per scan | one linear walk of appinfo.vdf, stops when all wanted apps are found | - |

#### electron/main/games/backup.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 253 | `list` | .map | nested | **NOT-WORTH** | ≤ 10 files x ≤ KEEP sets / History open | files per backup set, a handful | - |
| 289 | `prune` | for-of | nested | **NOT-WORTH** | ≤ 10 files x ≤ KEEP sets / per apply | files per backup set, pruning after a write | - |

#### electron/main/games/details.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 105 | `steamArt` | for-of | nested | **HOT-PATH-OK** | ≤ 10 names x Steam games / per scan | one art folder's subfolders, a few files each | - |
| 145 | `heroicDetails` | for-of | nested | **HOT-PATH-OK** | ≤ hundreds / per scan | library entries per store, Map lookups only | - |

#### electron/main/games/games.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 94 | `sdlVarsIn` | .map | hot:scan | **HOT-PATH-OK** | ≤ 5 / per game per scan | env assignments in one launch-options line | - |
| 94 | `sdlVarsIn` | .filter | hot:scan | **HOT-PATH-OK** | ≤ 5 / per game per scan | env assignments in one launch-options line | - |
| 114 | `withEnvVars` | .reduce | hot:scan | **NOT-WORTH** | ≤ 2 / per fix | 1-2 variables, only when a fix is built | - |
| 116 | `withEnvVars` | .map | hot:scan | **NOT-WORTH** | ≤ 2 / per fix | 1-2 variables, only when a fix is built | - |
| 173 | `hasOldEnv` | .some | hot:scan | **NOT-WORTH** | ≤ 4 / per HDR game per scan | fixed list of old HDR variables | - |
| 279 | `fix` | .flatMap | hot:scan | **NOT-WORTH** | 1-3 / per fix | edits of one fix | - |
| 307 | `scan` | .forEach | hot:scan | **NOT-WORTH** | 1-2 / per scan | Steam installs found | - |
| 338 | `scanSteam` | .map | hot:scan | **HOT-PATH-OK** | Steam games (≤ hundreds) / per scan | app ids for the appinfo lookup, one array | - |
| 341 | `scanSteam` | for-of | hot:scan | **BATCH** | Steam games x 1000s of keys / per scan | per game 3 linear getString lookups in localconfig apps (1000s of keys) | index localconfig apps and CompatToolMapping into a lowercase Map once per scan instead of getKey's linear find per game |
| 494 | `scan` | .forEach | hot:scan | **NOT-WORTH** | 1-2 / per scan | Heroic installs found | - |
| 512 | `scanHeroic` | for-of | hot:scan | **BATCH** | Heroic games / per scan | per game reads the runner's version file again (buildHonoursPreferSdl) | memoize buildVersion per (dir, build) for the scan: one read per build instead of one per game |
| 517 | `scanHeroic` | .map | hot:scan nested | **HOT-PATH-OK** | ≤ 10 / per Heroic game per scan | env entries of one game | - |
| 517 | `scanHeroic` | .filter | hot:scan nested | **HOT-PATH-OK** | ≤ 10 / per Heroic game per scan | env entries of one game | - |
| 534 | `scanHeroic` | .some | hot:scan nested | **HOT-PATH-OK** | ≤ 10 / per Heroic game per scan | env entries of one game | - |
| 583 | `scanHeroic` | .map | hot:scan nested | **NOT-WORTH** | ≤ 10 / per HDR game per scan | env entries, HDR games only | - |
| 649 | `scan` | .flatMap | hot:scan | **NOT-WORTH** | 1-2 / per scan | Steam installs, a readdir each | - |
| 651 | `scan` | .forEach | hot:scan | **NOT-WORTH** | 1-2 / per scan | Lutris installs found | - |
| 661 | `scanLutris` | .map | hot:scan | **NOT-WORTH** | 1-2 / per scan | Steam installs | - |
| 681 | `scanLutris` | for-of | hot:scan | **BATCH** | Lutris games / per scan | per game reads the runner's version file again (buildHonoursPreferSdl) | share the per-scan buildVersion memo with the Heroic loop |
| 696 | `scanLutris` | .some | hot:scan nested | **HOT-PATH-OK** | ≤ 10 / per Lutris game per scan | env entries of one game | - |
| 780 | `scan` | for-of | hot:scan | **NOT-WORTH** | 2 / per scan | two stores, Windows only | - |
| 785 | `scan` | for-of | hot:scan nested | **HOT-PATH-OK** | ≤ hundreds / per scan on Windows | plain object per store game, no I/O | - |
| 807 | `scan` | .forEach | hot:scan | **NOT-WORTH** | 0-2 / per scan | PipeWire rule files found | - |
| 807 | `scan` | .filter | hot:scan | **NOT-WORTH** | 0-2 / per scan | PipeWire rule files found | - |
| 826 | `scan` | for-of | hot:scan | **NOT-WORTH** | 0-2 / per scan | DualSense audio cards | - |
| 849 | `scan` | for-of | hot:scan | **NOT-WORTH** | - | connected DualSense sound cards, 0-2; once per scan | - |
| 857 | `scan` | .some | hot:scan | **NOT-WORTH** | 0-2 / per scan | DualSense audio cards | - |
| 859 | `scan` | .map | hot:scan | **NOT-WORTH** | 0-2 / per scan | PipeWire rule files found | - |
| 937 | `writeChosen` | for-of | nested | **NOT-WORTH** | ≤ tens / per apply | edits of the chosen fixes, in memory | - |
| 944 | `writeChosen` | .map | nested | **NOT-WORTH** | ≤ 5 / per apply | edited files, in memory | - |
| 944 | `writeChosen` | .some | nested | **NOT-WORTH** | ≤ 5 / per apply | edited files, in memory | - |
| 968 | `writeChosen` | for-of | await | **SERIAL-REQUIRED** | ≤ 2 / per apply | process order: WirePlumber restart and profile switch must not overlap | - |

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
| 118 | `listHeroicGames` | .sort | hot:scan | **PARALLELIZE** | Heroic games / per scan | one sync GamesConfig JSON read per game blocks the main process | same change as the .map on this line |
| 118 | `listHeroicGames` | .map | hot:scan | **PARALLELIZE** | Heroic games / per scan | one sync GamesConfig JSON read per game blocks the main process | same change as the .map on this line |
| 118 | `listHeroicGames` | .filter | hot:scan | **PARALLELIZE** | Heroic games / per scan | one sync GamesConfig JSON read per game blocks the main process | same change as the .map on this line |
| 125 | `listHeroicGames` | .filter | hot:scan nested | **HOT-PATH-OK** | ≤ 10 / per Heroic game per scan | env entries of one game | - |
| 125 | `listHeroicGames` | .map | hot:scan nested | **HOT-PATH-OK** | ≤ 10 / per Heroic game per scan | env entries of one game | - |

#### electron/main/games/lutris.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 33 | `findLutrisInstalls` | for-of | hot:scan | **NOT-WORTH** | 2 / per scan | two possible Lutris folders | - |
| 65 | `systemEnv` | .map | hot:scan | **HOT-PATH-OK** | ≤ 10 / per Lutris game per scan | env entries of one game | - |
| 109 | `listLutrisGames` | .map | hot:scan | **NOT-WORTH** | rare | yml fallback only when pga.db can't be read | - |
| 109 | `listLutrisGames` | .filter | hot:scan | **NOT-WORTH** | rare | yml fallback only when pga.db can't be read | - |
| 117 | `listLutrisGames` | .sort | hot:scan | **PARALLELIZE** | Lutris games / per scan | one sync YAML read and parse per game blocks the main process | same change as the .map on this line |
| 117 | `listLutrisGames` | .map | hot:scan | **PARALLELIZE** | Lutris games / per scan | one sync YAML read and parse per game blocks the main process | same change as the .map on this line |
| 117 | `listLutrisGames` | .filter | hot:scan | **PARALLELIZE** | Lutris games / per scan | one sync YAML read and parse per game blocks the main process | same change as the .map on this line |
| 130 | `lutrisWineBuilds` | .filter | hot:scan | **NOT-WORTH** | ≤ 20 / per scan | Wine/Proton builds in Lutris' runner folder, 2 stats each | - |

#### electron/main/games/processes.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 79 | `launchersIn` | .some | nested | **HOT-PATH-OK** | 3 x ≤ tens / per launcher check | 3 launchers x game-candidate processes | - |
| 85 | `gameIn` | .some | nested | **HOT-PATH-OK** | ≤ 10 / per process per check | args of one process, short | - |
| 153 | `close` | for | await | **SERIAL-REQUIRED** | ≤ timeoutMs/500 / per launcher close | deadline: polls every 500 ms until the launcher has quit or timeoutMs | - |
| 179 | `reopenAll` | for-of | await | **SERIAL-REQUIRED** | ≤ 3 / per apply | launcher order: reopen one at a time, as they were closed | - |
| 183 | `withLaunchersClosed` | for-of | await | **SERIAL-REQUIRED** | ≤ 3 / per apply | launcher order: stop at the first that won't close and reopen the rest | - |

#### electron/main/games/proton.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 63 | `protonBuilds` | .filter | hot:scan | **NOT-WORTH** | ≤ 20 / per tools dir per scan | folders in one tools dir, a stat each | - |
| 82 | `first` | .find | hot:scan | **NOT-WORTH** | 2 / per build checked | 2 texts (name, version file) | - |
| 82 | `first` | .map | hot:scan | **NOT-WORTH** | 2 / per build checked | 2 texts (name, version file) | - |
| 85 | `dualSenseBuild` | .some | hot:scan | **NOT-WORTH** | 2 / per build checked | 2 texts (name, version file) | - |
| 88 | `dualSenseBuild` | .map | hot:scan | **NOT-WORTH** | 2 / per build checked | 2 texts (name, version file) | - |
| 106 | `buildVersion` | for-of | hot:scan | **BATCH** | 1-3 folders x games / per scan | first folder with a version file; called again per game for the same build | memoize per scan (as in scanHeroic): one read per build |
| 118 | `buildHonoursPreferSdl` | .map | hot:scan | **NOT-WORTH** | ≤ 3 / per call | 1-3 build folders | - |
| 125 | `buildVersionKey` | .map | hot:scan | **NOT-WORTH** | ≤ 3 / per call | 1-3 build folders | - |
| 127 | `buildVersionKey` | for-of | hot:scan | **NOT-WORTH** | 2 / per call | 2 texts (version file, name) | - |
| 134 | `compareKeys` | .reduce | hot:scan | **NOT-WORTH** | 3 / per compare | 3-part version keys | - |
| 142 | `pickBuild` | .flatMap | hot:scan | **NOT-WORTH** | ≤ 20 / per such game | installed builds, only for games that need a switch | - |
| 147 | `newest` | .sort | hot:scan | **NOT-WORTH** | ≤ 20 / per such game | installed builds, copied and sorted | - |
| 149 | `pickBuild` | .filter | hot:scan | **NOT-WORTH** | ≤ 20 / per such game | installed builds | - |
| 149 | `pickBuild` | .filter | hot:scan | **NOT-WORTH** | ≤ 20 / per such game | installed builds | - |
| 223 | `installProton` | for-of | await | **SERIAL-REQUIRED** | ≤ 3 targets / per Proton install | install order: each copy or link of the one unpacked build, then report | - |

#### electron/main/games/running.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 55 | `readFull` | for-of | hot:interval | **HOT-PATH-OK** | ~100 x few candidates / 2 s tick | environ vars (~50-100) of a candidate game process only | - |
| 72 | `readFull` | .filter | hot:interval | **HOT-PATH-OK** | ~10 x few candidates / 2 s tick | cmdline args of a candidate game process only | - |
| 94 | `readProcs` | for-of | hot:interval | **HOT-PATH-OK** | ~300-800 PIDs / 2 s tick (Linux) | all PIDs; cheap first pass (stat, status of own only); runs hidden on purpose | - |
| 117 | `readProcs` | .map | hot:interval | **HOT-PATH-OK** | ~100-400 / 2 s tick | one Map over own processes for the ancestry walk | - |
| 149 | `launched` | .some | hot:interval | **HOT-PATH-OK** | 4 / new orphan | N = 4 env keys, only for an orphan not seen before | - |
| 157 | `readProcs` | for-of | hot:interval | **HOT-PATH-OK** | ~100-400 / 2 s tick | own processes, memoized ancestry; full reads only for candidates | - |
| 167 | `readProcs` | for-of | hot:interval | **HOT-PATH-OK** | < 10 / 2 s tick | remembered plain orphans, a handful | - |
| 184 | `detectRunning` | for-of | hot:interval | **HOT-PATH-OK** | ≤ tens / every 2 s (3 s Windows), Games on | game-candidate processes only (readProcs filters), returns on a hit | - |
| 187 | `detectRunning` | .find | hot:interval nested | **HOT-PATH-OK** | ≤ 10 / per tick | args of one reaper process | - |
| 191 | `detectRunning` | .find | hot:interval nested | **HOT-PATH-OK** | ≤ hundreds / per tick while a game runs | library games, only for a process with a Steam id | - |
| 196 | `detectRunning` | .find | hot:interval nested | **HOT-PATH-OK** | ≤ hundreds / per tick while a game runs | library games, only for a process with HEROIC_APP_NAME | - |
| 201 | `detectRunning` | .filter | hot:interval | **HOT-PATH-OK** | ≤ hundreds / every 2 s with Games on | one filtered copy of the library per tick, no I/O | - |
| 203 | `detectRunning` | for-of | hot:interval | **HOT-PATH-OK** | ≤ tens / every 2 s (3 s Windows), Games on | candidate processes, skips non-Wine ones first | - |
| 205 | `detectRunning` | .some | hot:interval nested | **HOT-PATH-OK** | ≤ 10 / per process per tick | args of one process | - |
| 207 | `detectRunning` | for-of | hot:interval nested | **HOT-PATH-OK** | ≤ hundreds x Wine procs / per tick | games with a folder, only for Wine/exe processes | - |
| 209 | `detectRunning` | .some | hot:interval nested | **HOT-PATH-OK** | ≤ 10 / per game per Wine proc | args of one Wine process, string prefix checks | - |
| 265 | `detectRunningWindows` | .map | hot:interval | **HOT-PATH-OK** | ≤ hundreds / every 3 s on Windows | Windows process list into a Set, needed for the lookups | - |
| 267 | `detectRunningWindows` | for-of | hot:interval | **HOT-PATH-OK** | ≤ hundreds / every 3 s on Windows | library games, exe sets cached per folder | - |
| 270 | `detectRunningWindows` | for-of | hot:interval nested | **HOT-PATH-OK** | ≤ tens / per game per tick | one game's cached exe names, Set lookups | - |

#### electron/main/games/schemeHandler.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 250 | `schemeHandlerExec` | for-of | await | **SERIAL-REQUIRED** | ≤ 5 folders / per Play click | data dependency: the first XDG folder with the entry wins | - |

#### electron/main/games/service.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 152 | `fixes` | .map | nested | **NOT-WORTH** | 1-3 / per fix per scan | files of one fix | - |
| 262 | `undo > exclusive(cb)` | .some | nested | **NOT-WORTH** | - | mixer changes x cards, a few each; once per Undo | - |
| 271 | `undo > exclusive(cb)` | for-of | await | **SERIAL-REQUIRED** | - | ALSA order: one card's restore after another, ≤ 2 cards; per Undo | - |
| 285 | `listBackups` | .map | nested | **NOT-WORTH** | ≤ 10 / History open | files of one backup set | - |
| 313 | `installLatestProton > exclusive(cb)` | .every | nested | **NOT-WORTH** | 1-2 / per Proton install | Steam installs | - |

#### electron/main/games/steam.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 47 | `windowsSteamRoots` | for-of | hot:scan | **NOT-WORTH** | 2 / scan | N = 2 Program Files folders, Windows only, once per scan | - |
| 55 | `findSteamInstalls` | .map | hot:scan | **NOT-WORTH** | ≤ 3 / per scan | Steam roots on Windows | - |
| 67 | `findSteamInstalls` | for-of | hot:scan | **NOT-WORTH** | 6 / per scan | six possible Steam folders, a realpath each | - |
| 86 | `newestLocalConfig` | for-of | hot:scan | **NOT-WORTH** | 1-3 / per scan | Steam accounts on this PC, a stat each | - |
| 110 | `steamLibraries` | for-of | hot:scan | **NOT-WORTH** | 1-5 / per call | Steam library folders | - |
| 122 | `steamAppManifests` | for-of | hot:scan | **NOT-WORTH** | 1-5 / per scan (twice: list + details) | Steam library folders, a readdir each | - |
| 127 | `steamAppManifests` | .filter | hot:scan nested | **HOT-PATH-OK** | ≤ hundreds / per library per scan | names in one steamapps folder, one regex test each | - |
| 132 | `steamAppManifests` | for-of | hot:scan nested | **PARALLELIZE** | Steam games / per scan, twice (list + details) | one sync read + VDF parse per appmanifest blocks the main process | read manifests with fs.promises under a bound (~8) and share one read between listSteamGames and gameDetails |
| 143 | `listSteamGames` | for-of | hot:scan | **HOT-PATH-OK** | Steam games / per scan | parsed manifests, two getString each | - |
| 150 | `listSteamGames` | .sort | hot:scan | **HOT-PATH-OK** | ≤ hundreds / per scan | one sort of the Steam games by name | - |
| 176 | `valveProtons` | .flatMap | hot:scan | **NOT-WORTH** | ≤ 10 / per library per scan | library folders, a readdir each | - |
| 176 | `valveProtons` | .filter | hot:scan nested | **NOT-WORTH** | ≤ 10 / per library per scan | library folders, a readdir each | - |

#### electron/main/games/system.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 57 | `forcesProAudio` | .filter | hot:scan | **NOT-WORTH** | ≤ 100 / per rule file per scan | lines of one small PipeWire rule file | - |
| 80 | `findProAudioRules` | for-of | hot:scan | **NOT-WORTH** | 6 / per scan | six fixed rule folders | - |
| 84 | `findProAudioRules` | .filter | hot:scan nested | **NOT-WORTH** | 0-10 / per scan | files in one rule folder | - |
| 89 | `findProAudioRules` | for-of | hot:scan nested | **NOT-WORTH** | 0-10 / per scan | rule files, a small read each | - |
| 111 | `findGlobalSdlVars` | for-of | hot:scan | **NOT-WORTH** | 3 / per scan | three environment folders | - |
| 114 | `findGlobalSdlVars` | for-of | hot:scan nested | **NOT-WORTH** | 0-10 / per scan | files in one environment folder | - |
| 122 | `findGlobalSdlVars` | for-of | hot:scan | **NOT-WORTH** | ≤ 15 / per scan | shell profile and environment files, a small read each | - |
| 125 | `findGlobalSdlVars` | for-of | hot:scan nested | **NOT-WORTH** | 0-3 / per file per scan | matches in one profile file | - |
| 133 | `findGlobalSdlVars` | for-of | hot:scan | **NOT-WORTH** | ≤ 5 / per scan | SDL-forcing variable names | - |
| 147 | `hidrawAccess` | for-of | hot:scan | **NOT-WORTH** | ≤ 10 / per scan | hidraw nodes, a small sysfs read each | - |
| 225 | `lowMixerControls` | for-of | hot:scan | **NOT-WORTH** | - | N = 4 mixer targets per card; once per scan | - |
| 227 | `lowMixerControls` | .find | hot:scan nested | **NOT-WORTH** | - | ~20 controls per card; once per scan | - |
| 283 | `dualSenseMixers` | for-of | await | **NOT-WORTH** | - | DualSense cards, 0-2, one amixer read each; once per scan | - |
| 298 | `setDualSenseMixer` | for-of | await | **SERIAL-REQUIRED** | - | one ALSA card: amixer writes in order, N ≤ 4 controls; per apply | - |
| 308 | `restoreDualSenseMixer` | for-of | await | **SERIAL-REQUIRED** | - | one ALSA card: amixer writes in order, N ≤ 4 controls; per Undo | - |
| 308 | `restoreDualSenseMixer` | .find | nested | **SERIAL-REQUIRED** | - | one ALSA card: amixer writes in order, N ≤ 4 controls; per Undo | - |

#### electron/main/games/vdf.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 26 | `skip` | while | nested | **HOT-PATH-OK** | chars of one VDF file / per parse | skips whitespace, linear in the file | - |
| 29 | `skip` | while | nested | **HOT-PATH-OK** | chars of one line / per comment | skips one comment line, linear | - |
| 111 | `getKey` | .find | hot:scan | **BATCH** | 1000s of keys x games / per scan | linear key search; scanSteam calls it per game on localconfig's apps | index hot nodes (localconfig apps, CompatToolMapping) once per scan; see scanSteam |
| 117 | `getNode` | for-of | hot:scan | **NOT-WORTH** | ≤ 8 / per lookup | path segments of one lookup | - |

#### electron/main/officialFirmware.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 30 | `readCapped` | for | await | **SERIAL-REQUIRED** | a few chunks / per manifest fetch | stream order: reads the capped body chunk by chunk | - |

#### src/components/LanguageToggle.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 16 | `LanguageToggle` | .find | hot:render | **HOT-PATH-OK** | 7 / per render | N = 7 languages, early exit; per LanguageToggle render | - |
| 16 | `LanguageToggle` | .find | hot:render | **HOT-PATH-OK** | 7 / per render | N = 7 languages, early exit; per LanguageToggle render | - |
| 52 | `LanguageToggle` | .map | hot:render | **HOT-PATH-OK** | 7 / per render | N = 7 languages in the menu | - |

#### src/desktop/about/ComingSoon.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 18 | `ComingSoon` | .map | hot:render | **HOT-PATH-OK** | 4 / per About render | N = 4 roadmap columns; About page render only | - |
| 20 | `ComingSoon` | .filter | hot:render nested | **HOT-PATH-OK** | ~400 / per About render | N ≈ 100 roadmap rows x 4 columns; About page render only | - |
| 28 | `ComingSoon` | .map | hot:render nested | **HOT-PATH-OK** | tens / per About render | N = one column's roadmap items (tens); About page render only | - |
| 40 | `ComingSoon` | .map | hot:render nested | **HOT-PATH-OK** | ≤ 3 / per item render | N ≤ 3 areas per roadmap item | - |

#### src/desktop/colorPicker/colorMath.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 14 | `rgbToHex` | .map | hot:render | **HOT-PATH-OK** | 3 / per picker render (drag) | N = 3 channels | - |
| 26 | `parseHex` | .map | hot:render | **HOT-PATH-OK** | 3 / per parse | N = 3 characters of a short hex | - |
| 28 | `parseHex` | .map | hot:render | **HOT-PATH-OK** | 3 / per parse | N = 3 channels | - |

#### src/desktop/colorPicker/ColorPicker.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 118 | `ColorPopover` | .map | hot:render | **HOT-PATH-OK** | 3 / per outside value change | N = 3 channels; only when the value changes from outside | - |
| 268 | `ColorPopover` | .map | hot:render | **HOT-PATH-OK** | 3 / per picker render | N = 3 channel names | - |
| 323 | `ColorPopover` | .map | hot:render | **HOT-PATH-OK** | 3 / per picker render | N = 3 channel fields | - |
| 345 | `ColorPopover` | .map | hot:render | **HOT-PATH-OK** | ≤ 8 / per picker render | N ≤ 8 recent colors (RECENT_MAX) | - |

#### src/desktop/controllerAudio.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 16 | `findControllerAudio` | .find | hot:raf | **NOT-WORTH** | ~10 / per narration or test start | N ≈ 10 audio devices; once per narration or test start, not per frame | - |

#### src/desktop/controls.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 187 | `Segmented` | .map | hot:render | **HOT-PATH-OK** | ≤ 6 / per render | N ≤ 6 segment options | - |
| 201 | `rgbToHex` | .map | hot:render | **HOT-PATH-OK** | 3 / per call | N = 3 channels | - |

#### src/desktop/DesktopApp.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 199 | `DesktopApp > useEffect(cb)` | .map | hot:effect | **NOT-WORTH** | 3 / per tray icon change | N = 3 numbers; only when the tray icon's inputs change | - |

#### src/desktop/dongle/DongleConsole.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 66 | `DongleConsole` | .map | hot:render | **HOT-PATH-OK** | 2 / per console render (10/s) | N = 2 tabs | - |
| 107 | `DongleConsole` | .map | hot:render | **FIX-HOT-PATH** | ≤ 200 / 10 per s while the log tab shows | ≤ 200 log rows re-rendered, toLocaleTimeString each, per 10/s mirror frame | Format the time once when the line is added, and memo the log list so mirror frames don't re-render it |
| 170 | `OledCanvas > useEffect(cb)` | .map | hot:effect | **HOT-PATH-OK** | 3 / 10 per s while shown | N = 3 color channels per mirror frame | - |
| 172 | `OledCanvas > useEffect(cb)` | for | hot:effect | **HOT-PATH-OK** | 64 / 10 per s while shown | N = 64 rows per mirror frame, 10/s, only while shown | - |
| 174 | `OledCanvas > useEffect(cb)` | for | hot:effect nested | **HOT-PATH-OK** | 8192 / 10 per s while shown | N = 128 x 64 = 8192 pixels per mirror frame, 10/s, only while shown | - |

#### src/desktop/dongle/DongleDashboard.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 116 | `series` | .map | hot:render | **HOT-PATH-OK** | 60 x ~3 / per render (≤ 10 per s) | N = 60 samples per trend, a few trends per render | - |
| 173 | `DongleDashboard` | .map | hot:render | **HOT-PATH-OK** | ~15 / per render (≤ 10 per s) | N ≈ 15 audio counters | - |
| 173 | `DongleDashboard` | .filter | hot:render | **HOT-PATH-OK** | ~15 / per render (≤ 10 per s) | N ≈ 15 audio counters | - |
| 231 | `TimingCard` | .filter | hot:render | **HOT-PATH-OK** | 60 / per render (≤ 10 per s) | N = 60 samples | - |
| 254 | `TimingCard` | .map | hot:render | **HOT-PATH-OK** | ≤ 8 / per render (≤ 10 per s) | N ≤ 8 timing stages | - |
| 258 | `TimingCard` | .map | hot:render nested | **HOT-PATH-OK** | 480 / per render (≤ 10 per s) | N = 8 stages x 60 samples = 480 numbers | - |
| 294 | `micLossClimbing` | .filter | hot:render | **HOT-PATH-OK** | 60 / per render (≤ 10 per s) | N = 60 samples | - |
| 358 | `Trend` | .map | hot:render | **HOT-PATH-OK** | 60 / per trend render (≤ 10 per s) | N = 60 points per trend line | - |
| 373 | `Graph` | .map | hot:render | **HOT-PATH-OK** | 60 / per graph render (≤ 10 per s) | N = 60 points per graph | - |

#### src/desktop/firmwareUpdate.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 83 | `flash` | for-of | await | **SERIAL-REQUIRED** | 1-2 regions / per firmware update | one PICOBOOT session: regions are erased and written in order | - |
| 85 | `flash` | for | await nested | **SERIAL-REQUIRED** | ~16-64 pieces / per firmware update | one PICOBOOT session: 64 KB erase+write pieces in order, for the progress | - |
| 100 | `waitForBootloader` | while | await | **SERIAL-REQUIRED** | ≤ timeout/300 ms / per firmware update | polls until a deadline (300 ms apart) for the board in BOOTSEL | - |

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
| 149 | `hdrReady` | .every | hot:scan | **NOT-WORTH** | ≤ 6 / per HDR game per scan | N ≤ 6 requirements; per HDR game per scan | - |
| 149 | `hdrReady` | .filter | hot:scan | **NOT-WORTH** | ≤ 6 / per HDR game per scan | N ≤ 6 requirements; per HDR game per scan | - |

#### src/desktop/games/launcherCheck.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 37 | `restartFor` | .map | hot:render | **HOT-PATH-OK** | ≤ 5 / per game page render | N = one game's fixes (≤ ~5) | - |
| 39 | `restartFor` | .map | hot:render | **HOT-PATH-OK** | 3 / per game page render | N = 3 launchers | - |
| 39 | `restartFor` | .filter | hot:render | **HOT-PATH-OK** | 3 / per game page render | N = 3 launchers | - |
| 41 | `restartFor` | .filter | hot:render | **HOT-PATH-OK** | 3 / per game page render | N = 3 launchers | - |
| 68 | `overwrittenBy` | for-of | hot:render | **HOT-PATH-OK** | ≤ 5 / per game page render | N = one game's fixes (≤ ~5) | - |

#### src/desktop/games/types.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 202 | `allFixes` | .flatMap | hot:render | **HOT-PATH-OK** | hundreds / per scan report | N = games (hundreds) + 3 launchers; memoized per scan report | - |
| 202 | `allFixes` | .flatMap | hot:render | **HOT-PATH-OK** | hundreds / per scan report | N = games (hundreds) + 3 launchers; memoized per scan report | - |

#### src/desktop/glass/liquidGlass.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 45 | `displacementMap` | for | nested | **NOT-WORTH** | ~w x h / 4 / per glass build or resize | half-size pixels of a glass element; on mount and debounced resize only | - |
| 115 | `only` | .map | nested | **NOT-WORTH** | 12 / per glass build | N = 3 x 4 matrix cells; per glass filter build | - |

#### src/desktop/glass/useSpecular.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 14 | `update` | for-of | hot:raf | **HOT-PATH-OK** | ≤ 3 / per pointer-move frame | N ≤ 3 glass elements; at most once a frame while the pointer moves | - |

#### src/desktop/library/ContinuePlaying.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 39 | `ContinuePlaying` | .map | hot:render | **HOT-PATH-OK** | - | N ≤ 8 recent games; Home render on library change | - |
| 52 | `first` | .find | hot:render | **HOT-PATH-OK** | - | N ≤ 3 art kinds per tile | - |

#### src/desktop/library/GameLibrary.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 73 | `GameLibrary > useMemo(cb)` | for-of | hot:render | **HOT-PATH-OK** | hundreds / per scan report | N = games (hundreds); memoized on the scan report | - |
| 75 | `GameLibrary > useMemo(cb)` | .map | hot:render | **HOT-PATH-OK** | 7 / per scan report | N = 7 app kinds; memoized on the scan report | - |
| 75 | `GameLibrary > useMemo(cb)` | .filter | hot:render | **HOT-PATH-OK** | 7 / per scan report | N = 7 app kinds; memoized on the scan report | - |
| 92 | `GameLibrary > useMemo(cb)` | .sort | hot:render | **HOT-PATH-OK** | n log n, hundreds / per sort or report change | sort of the games (hundreds); memoized on report, sort and details | - |
| 97 | `GameLibrary > useMemo(cb)` | .sort | hot:render | **HOT-PATH-OK** | hundreds / per report or details change | games (hundreds) filtered+sorted to 8; memoized on report and details | - |
| 97 | `GameLibrary > useMemo(cb)` | .filter | hot:render | **HOT-PATH-OK** | hundreds / per report or details change | games (hundreds) filtered+sorted to 8; memoized on report and details | - |
| 106 | `GameLibrary > useMemo(cb)` | .filter | hot:render | **HOT-PATH-OK** | - | N = games (hundreds); memoized, reruns per search keystroke or filter | - |
| 111 | `GameLibrary` | .filter | hot:render | **HOT-PATH-OK** | - | N = visible games (hundreds); per library render (interaction) | - |
| 113 | `GameLibrary` | .filter | hot:render | **HOT-PATH-OK** | hundreds / per library render | N = visible games (hundreds); per library render (interaction) | - |
| 115 | `GameLibrary` | .filter | hot:render | **HOT-PATH-OK** | hundreds / per library render | N = visible games (hundreds); per library render (interaction) | - |
| 117 | `GameLibrary` | .filter | hot:render | **HOT-PATH-OK** | hundreds / per library render | N = visible games (hundreds); per library render (interaction) | - |
| 119 | `GameLibrary` | .find | hot:render | **HOT-PATH-OK** | hundreds / per library render | N = games (hundreds); per library render (interaction) | - |
| 123 | `GameLibrary` | .map | hot:render | **HOT-PATH-OK** | hundreds / per library render | N = visible games (hundreds); per library render (interaction) | - |
| 174 | `group` | .map | hot:render | **HOT-PATH-OK** | hundreds / per library render | one sidebar row per visible game (hundreds); per library render | - |
| 217 | `GameLibrary` | .map | hot:render | **HOT-PATH-OK** | - | N = 4 filters | - |
| 228 | `GameLibrary` | .filter | hot:render nested | **HOT-PATH-OK** | - | 4 filters x searched games (hundreds); per library render | - |
| 237 | `GameLibrary` | .map | hot:render | **HOT-PATH-OK** | 3 / per library render | N = 3 sorts | - |
| 249 | `GameLibrary` | .filter | hot:render | **HOT-PATH-OK** | ≤ 7 / per library render | N ≤ 7 app kinds | - |
| 253 | `GameLibrary` | .map | hot:render | **HOT-PATH-OK** | ≤ 7 / per library render | N ≤ 7 app kinds | - |
| 266 | `GameLibrary` | .map | hot:render | **FIX-HOT-PATH** | hundreds / per library render, even when hidden | a tile per game (hundreds) re-rendered per library render, even hidden | React.memo GameTile with a stable onOpen (by key), or skip the grid while a game page hides it |

#### src/desktop/library/GamePage.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 99 | `GamePage` | .find | hot:render | **HOT-PATH-OK** | 3 / per game page render | N = 3 launchers | - |
| 233 | `favorites` | .some | nested | **NOT-WORTH** | 12 / per profile summary render | N = 4 slots x 3 channels; per profile summary | - |
| 258 | `ProfileSummary` | .map | hot:render | **HOT-PATH-OK** | ≤ 12 / per game page render | N ≤ 12 profile groups | - |
| 267 | `ProfileSummary` | for-of | hot:render | **HOT-PATH-OK** | 2 / per game page render | N = 2 sticks | - |
| 286 | `ProfileSummary` | .map | hot:render | **HOT-PATH-OK** | ≤ 15 / per game page render | N ≤ 15 chips | - |
| 333 | `LayoutPicker` | .sort | hot:render | **HOT-PATH-OK** | a few / per game page render | N = saved button layouts (a few) | - |
| 341 | `LayoutPicker` | .map | hot:render | **HOT-PATH-OK** | a few / per game page render | N = saved button layouts (a few) | - |
| 361 | `LayoutPicker` | .map | hot:render | **HOT-PATH-OK** | 4 / per game page render | N = 4 extra buttons | - |
| 387 | `CurvePicker` | .map | hot:render | **HOT-PATH-OK** | 2 / per game page render | N = 2 sticks | - |
| 392 | `CurvePicker` | .map | hot:render nested | **HOT-PATH-OK** | ≤ 10 / per game page render | N = 2 sticks x ≤ 5 curve presets | - |
| 495 | `SetupFrame` | .map | hot:render | **HOT-PATH-OK** | ≤ 5 / per game page render | N = one game's fixes (≤ ~5) | - |
| 588 | `CompatFrame` | .find | hot:render | **HOT-PATH-OK** | ≤ 5 / per game page render | N = one game's fixes (≤ ~5) | - |
| 664 | `SupportFrame` | .map | hot:render | **HOT-PATH-OK** | 0 / per game page render | N = known game fixes (GAME_FIXES, empty now) | - |
| 675 | `SupportFrame` | .map | hot:render | **HOT-PATH-OK** | 6 / per game page render | N = 6 support tiers | - |
| 687 | `SupportFrame` | .map | hot:render | **HOT-PATH-OK** | 5 / per game page render | N = 5 features | - |
| 729 | `RatingFrame` | .filter | hot:render | **HOT-PATH-OK** | < 10 / per game page render | N = feedback tags (under 10) | - |
| 731 | `RatingFrame` | .filter | hot:render | **HOT-PATH-OK** | < 10 / per game page render | N = feedback tags (under 10) | - |
| 737 | `RatingFrame` | .map | hot:render | **HOT-PATH-OK** | 5 / per game page render | N = 5 stars | - |
| 770 | `RatingFrame` | .map | hot:render | **HOT-PATH-OK** | < 10 / per game page render | N = feedback tags (under 10) | - |
| 860 | `GameActions` | .map | hot:render | **HOT-PATH-OK** | 5 / per game page render | N = 5 game actions | - |
| 860 | `GameActions` | .filter | hot:render | **HOT-PATH-OK** | 5 / per game page render | N = 5 game actions | - |

#### src/desktop/library/GameTile.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 30 | `TileOverlays` | .filter | hot:render | **HOT-PATH-OK** | - | N = 4 badge candidates per tile; tile renders on library change only | - |
| 42 | `TileOverlays` | .map | hot:render | **HOT-PATH-OK** | - | N ≤ 4 marks per tile; renders on library change only | - |

#### src/desktop/library/HdrChecklist.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 15 | `HdrChecklist` | .map | hot:render | **HOT-PATH-OK** | ~6, per render of Home/game page | N ≈ 6 HDR requirements; renders on page open or rescan | - |

#### src/desktop/library/profileFields.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 27 | `normal` | .find | hot:render | **NOT-WORTH** | 12, per control render | N = 12 profile groups; per field lookup when a game page control renders | - |

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
| 17 | `setupStatus` | .every | hot:render | **HOT-PATH-OK** | ~6, per render | N ≈ 6 HDR requirements; per game page render | - |
| 35 | `systemHdrReqs` | .filter | hot:render | **HOT-PATH-OK** | - | N ≤ 4 launchers; Home and game page render | - |
| 37 | `systemHdrReqs` | .every | hot:render | **HOT-PATH-OK** | - | N ≤ 3 Proton launchers | - |
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
| 120 | `useGameProfile > useCallback(cb)` | while | await | **SERIAL-REQUIRED** | ≤ 2 waits, per profile switch | one profile switch at a time: one HID session, protocol order | - |

#### src/desktop/live/ArtBackdrop.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 87 | `useBackdropKeys` | .find | hot:render | **HOT-PATH-OK** | ≤ 8 / per render | N ≤ 8 recent games with art, on render | - |
| 145 | `ArtBackdrop` | .map | hot:render | **HOT-PATH-OK** | ≤ 8 / every 20 s | N ≤ 8 backdrop images; renders on a 20 s cycle tick | - |

#### src/desktop/live/Calibration.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 76 | `Calibration > useEffect(cb) > setTimeout(cb) > setDraft(cb)` | .map | nested | **NOT-WORTH** | ≤ 150 / per calibration step | once per finished measurement, N ≤ ~150 samples (5 s at 30 Hz) | - |
| 84 | `Calibration > useEffect(cb) > setTimeout(cb) > setDraft(cb)` | .map | nested | **NOT-WORTH** | ≤ 150 / per calibration step | once per finished measurement, N ≤ ~150 samples | - |
| 171 | `Calibration` | .map | hot:render | **HOT-PATH-OK** | 2 / ~30 Hz | N = 2 sticks, per live frame while calibrating | - |
| 196 | `Calibration` | .map | hot:render | **HOT-PATH-OK** | 2 / ~30 Hz | N = 2 triggers, per live frame while calibrating | - |
| 208 | `Calibration` | .every | hot:render | **HOT-PATH-OK** | 3 / ~30 Hz | N = 3 gyro axes | - |

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
| 187 | `legible` | .reduce | hot:raf | **HOT-PATH-OK** | 4 / per accent change | N = 4 grounds x ≤ 20 steps, once per accent/theme change | - |
| 287 | `useControllerAccent > useEffect(cb)` | .forEach | hot:effect | **NOT-WORTH** | few / per controller change | a few listeners, only when the connected colorway changes | - |

#### src/desktop/live/ControllerInfo.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 140 | `ControllerInfo` | .filter | hot:render | **HOT-PATH-OK** | 6 / on prop change | N = 6 groups, memo component, rerenders on prop change only | - |
| 140 | `ControllerInfo` | .map | hot:render | **HOT-PATH-OK** | 6 / on prop change | N = 6 groups, memo component, rerenders on prop change only | - |
| 142 | `ControllerInfo` | .map | hot:render nested | **HOT-PATH-OK** | ≤ 21 / on prop change | N ≤ 21 counters across groups, memo component | - |
| 142 | `ControllerInfo` | .filter | hot:render nested | **HOT-PATH-OK** | ≤ 21 / on prop change | N ≤ 21 counters across groups, memo component | - |
| 145 | `ControllerInfo` | .forEach | hot:render nested | **HOT-PATH-OK** | 2 / on prop change | N = 2 sticks, memo component | - |
| 161 | `ControllerInfo` | .map | hot:render | **HOT-PATH-OK** | ≤ 6 / on prop change | N ≤ 6 groups, memo component | - |
| 179 | `ControllerInfo` | .filter | hot:render | **HOT-PATH-OK** | 2 / on prop change | N = 2 parts of one label | - |
| 254 | `ControllerInfo` | .filter | hot:render | **HOT-PATH-OK** | 2 / on prop change | N = 2 parts of one hint | - |

#### src/desktop/live/ControllerView.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 103 | `ControllerView > useMemo(cb)` | for-of | hot:render | **HOT-PATH-OK** | 16 / on remap change | N = 16 remap slots, useMemo on the device table | - |

#### src/desktop/live/customColors.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 45 | `parseCustomColors` | for-of | hot:render | **NOT-WORTH** | 6 / on settings change | N = 6 parts, useMemo on the stored string | - |
| 53 | `hasCustomColors` | .some | hot:render | **HOT-PATH-OK** | 6 / per render | N = 6 parts, per render | - |
| 68 | `mergeColors` | for-of | hot:render | **HOT-PATH-OK** | 6 / on color change | N = 6 parts, inside useMemo on code/model/colors | - |

#### src/desktop/live/hdrColor.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 31 | `ledLinear` | .reduce | nested | **HOT-PATH-OK** | 9 / per glow redraw | 3 x 3 matrix per HDR glow redraw (on change, not per frame) | - |

#### src/desktop/live/HdrGlow.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 91 | `buildMask` | for | hot:raf | **FIX-HOT-PATH** | ~1M px / per resize frame (HDR only) | full-size mask, w x h px (~1M), rebuilt every resize frame | Rebuild the mask once the resize settles (~150 ms debounce) instead of every rAF during a drag |

#### src/desktop/live/layoutSummary.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 9 | `layoutChanges` | .flatMap | hot:render | **HOT-PATH-OK** | 16 / per render | N = 16 slots per layout, per render of the layouts list | - |
| 12 | `layoutChanges` | .flatMap | hot:render | **HOT-PATH-OK** | 4 / per render | N = 4 Edge buttons per layout | - |
| 19 | `layoutSummary` | .map | hot:render | **HOT-PATH-OK** | ≤ 20 / per render | N ≤ 20 changes per layout | - |

#### src/desktop/live/LiveController.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 116 | `LiveArt > useLayoutEffect(cb)` | for-of | hot:effect | **NOT-WORTH** | ~30 / per mount | once per mount, N ≈ 30 parts | - |
| 131 | `LiveArt > useLayoutEffect(cb)` | for-of | hot:effect | **NOT-WORTH** | dozens / per mount | once per mount, a few dozen outlines | - |
| 140 | `LiveArt > useLayoutEffect(cb)` | for-of | hot:effect | **NOT-WORTH** | - | N = 2 triggers, once per mount | - |
| 142 | `LiveArt > useLayoutEffect(cb)` | .map | hot:effect | **NOT-WORTH** | - | N = 4 numbers, once per mount | - |
| 155 | `LiveArt > useLayoutEffect(cb)` | .filter | hot:effect | **NOT-WORTH** | few / per mount | once per mount, a few shell shapes | - |
| 176 | `LiveArt > useEffect(cb)` | for-of | hot:effect | **NOT-WORTH** | ~30 / on language change | N ≈ 30 parts, only when the language changes | - |
| 183 | `LiveArt > useEffect(cb)` | for-of | hot:effect | **NOT-WORTH** | ~30 / on language change | N ≈ 30 parts, only on selection/remap change | - |
| 203 | `LiveArt > useEffect(cb)` | .map | hot:effect | **HOT-PATH-OK** | 3 / ≤ 10 Hz | N = 3 channels, on lightbar change (≤ 10 Hz) | - |
| 224 | `LiveArt > useEffect(cb)` | for-of | hot:effect | **NOT-WORTH** | 7 / on color change | N = 7 CSS vars, only when the colorway changes | - |
| 244 | `LiveArt > useEffect(cb)` | for-of | hot:effect | **HOT-PATH-OK** | ~30 / on language change | N ≈ 30 parts, classList.toggle per live frame | - |
| 249 | `LiveArt > useEffect(cb)` | for-of | hot:effect | **HOT-PATH-OK** | 2 / ~30 Hz | N = 2 triggers per live frame | - |
| 257 | `LiveArt > useEffect(cb)` | for-of | hot:effect nested | **HOT-PATH-OK** | - | N = 2 stops per trigger, looked up at mount; only when the value changed | Done in batch 1 (dev.10) |
| 261 | `LiveArt > useEffect(cb)` | for-of | hot:effect | **HOT-PATH-OK** | 2 / ~30 Hz | N = 2 sticks per live frame | - |
| 277 | `LiveArt > useEffect(cb)` | .filter | hot:effect | **HOT-PATH-OK** | ≤ 2 / ~30 Hz | N ≤ 2 fingers per live frame | - |
| 279 | `LiveArt > useEffect(cb)` | while | hot:effect | **HOT-PATH-OK** | ≤ 2 / ~30 Hz | N ≤ 2 touch dots removed | - |
| 281 | `LiveArt > useEffect(cb)` | while | hot:effect | **HOT-PATH-OK** | ≤ 2 / ~30 Hz | N ≤ 2 touch dots added | - |
| 283 | `LiveArt > useEffect(cb)` | .forEach | hot:effect | **HOT-PATH-OK** | ≤ 2 / ~30 Hz | N ≤ 2 touch dots placed | - |

#### src/desktop/live/LiveData.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 70 | `LiveData` | .map | hot:render | **HOT-PATH-OK** | 2 / ~30 Hz | N = 2 fingers per live frame | - |
| 119 | `Rows` | .map | hot:render | **HOT-PATH-OK** | ~20 / ~30 Hz | N ≈ 20 rows per live frame (the panel shows live values) | - |
| 133 | `Xyz` | .map | hot:render | **HOT-PATH-OK** | 3 / ~30 Hz | N = 3 axes per live frame | - |
| 185 | `Spark > useEffect(cb)` | for | hot:effect | **HOT-PATH-OK** | 3 / ~30 Hz x 2 sparks | N = 3 axes per spark redraw; 2D canvas, GPU-composited | - |
| 191 | `Spark > useEffect(cb)` | .forEach | hot:effect nested | **HOT-PATH-OK** | 450 / ~30 Hz x 2 sparks | N = 150 history points per axis per redraw | - |

#### src/desktop/live/LiveStrip.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 32 | `LiveStrip` | .find | hot:render | **HOT-PATH-OK** | ~8 / ~30 Hz | N ≈ 8 lightbar modes per render | - |
| 44 | `LiveStrip` | .map | hot:render | **HOT-PATH-OK** | 4 / ~30 Hz | N = 4 player lights per render | - |
| 59 | `LiveStrip` | .map | hot:render | **HOT-PATH-OK** | 5 / ~30 Hz | N = 5 signal bars per render | - |

#### src/desktop/live/micRing.worklet.js

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 25 | `process` | for | hot:audio | **HOT-PATH-OK** | 128 / per 2.7 ms while testing | N = 128 samples per audio quantum, a ring write, no allocation | - |

#### src/desktop/live/micTest.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 70 | `normalizeClip` | for | nested | **NOT-WORTH** | ~200k / per mic test | once per recorded clip, N = clip samples (a few seconds) | - |
| 77 | `peakOf` | for-of | hot:raf | **HOT-PATH-OK** | 1024 / per frame while testing | N = 1024 samples (fftSize) per meter frame while testing | - |

#### src/desktop/live/PartPanel.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 150 | `Overview` | .map | hot:render | **HOT-PATH-OK** | ~6 / ~30 Hz | N ≈ 6 shortcuts per render | - |
| 221 | `RemapSection` | .map | hot:render | **HOT-PATH-OK** | ~17 / ~30 Hz | N ≈ 17 options in one select per render | - |
| 300 | `AllButtonsSection` | .filter | hot:render | **HOT-PATH-OK** | 20 / ~30 Hz | N = 16 + 4 slots per render | - |
| 300 | `AllButtonsSection` | .filter | hot:render | **HOT-PATH-OK** | 20 / ~30 Hz | N = 16 + 4 slots per render | - |
| 323 | `AllButtonsSection` | .map | hot:render | **HOT-PATH-OK** | 16 / ~30 Hz | N = 16 rows; memo()ed, re-renders on a remap or focus change, not per live frame | Done in batch 1 (dev.10) |
| 342 | `AllButtonsSection` | .map | hot:render nested | **HOT-PATH-OK** | ~270 / ~30 Hz | 16 x ~17 options; memo()ed, only on a remap or focus change | Done in batch 1 (dev.10) |
| 355 | `AllButtonsSection` | .map | hot:render | **HOT-PATH-OK** | 4 / ~30 Hz | N = 4 Edge rows; memo()ed, only on a remap or focus change | Done in batch 1 (dev.10) |
| 370 | `AllButtonsSection` | .map | hot:render nested | **HOT-PATH-OK** | ~270 / ~30 Hz | 4 x ~17 options; memo()ed, only on a remap or focus change | Done in batch 1 (dev.10) |
| 416 | `ButtonLayoutsSection > useMemo(cb)` | .sort | hot:render | **HOT-PATH-OK** | - | N = saved layouts (a few); once per library change (useMemo + memo) | Done in batch 1 (dev.10) |
| 421 | `ButtonLayoutsSection > useMemo(cb)` | for-of | hot:render | **HOT-PATH-OK** | - | N = games with a profile (tens to hundreds); once per library change | Done in batch 1 (dev.10) |
| 430 | `ButtonLayoutsSection` | .map | hot:render | **HOT-PATH-OK** | 4 / ~30 Hz | N = 4 Edge names per render | - |
| 442 | `ButtonLayoutsSection` | .map | hot:render | **HOT-PATH-OK** | layouts x 20 / ~30 Hz | N = saved layouts (a few); memo()ed, only on a remap or library change | Done in batch 1 (dev.10) |
| 523 | `TriggerLive` | .map | hot:render | **HOT-PATH-OK** | 2 / ~30 Hz | N = 2 triggers per live frame | - |
| 570 | `TouchLive` | .filter | hot:render | **HOT-PATH-OK** | ≤ 2 / ~30 Hz | N ≤ 2 fingers per live frame | - |
| 575 | `TouchLive` | .map | hot:render | **HOT-PATH-OK** | ≤ 2 / ~30 Hz | N ≤ 2 fingers per live frame | - |
| 670 | `AppSettings` | .map | hot:render | **HOT-PATH-OK** | ~10 / ~30 Hz | N ≈ 10 look knobs per render | - |
| 670 | `AppSettings` | .filter | hot:render | **HOT-PATH-OK** | ~10 / ~30 Hz | N ≈ 10 look knobs per render | - |
| 855 | `CheckNow` | .map | hot:render | **HOT-PATH-OK** | ≤ 3 / per render | N ≤ 3 result lines, after a click | - |
| 874 | `ColorVisionSetting` | .map | hot:render | **HOT-PATH-OK** | ~4 / ~30 Hz | N ≈ 4 color vision options per render | - |
| 1134 | `BackdropSetting` | .map | hot:render | **HOT-PATH-OK** | 3 / ~30 Hz | N = 3 backgrounds per render | - |
| 1178 | `CustomColorsSetting` | .map | hot:render | **HOT-PATH-OK** | 6 / ~30 Hz | N = 6 color parts per render | - |
| 1205 | `AccentSetting` | .map | hot:render | **HOT-PATH-OK** | 2 / ~30 Hz | N = 2 accents per render | - |
| 1320 | `DeveloperSettings` | .map | hot:render | **HOT-PATH-OK** | ~40 / ~30 Hz dev only | N ≈ 40 colorway codes, Developer card only (dev builds) | - |
| 1349 | `DeveloperSettings` | .map | hot:render | **HOT-PATH-OK** | 10 / ~30 Hz dev only | N = 10 stages, Developer card only | - |
| 1361 | `DeveloperSettings` | .map | hot:render | **HOT-PATH-OK** | 4 / ~30 Hz dev only | N = 4 previews, Developer card only | - |

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
| 97 | `StickCurves` | .every | hot:render | **HOT-PATH-OK** | 2 / ~30 Hz | N = 2 sticks per render | - |
| 117 | `StickCurves` | .map | hot:render | **HOT-PATH-OK** | 2 / ~30 Hz | N = 2 tabs per render | - |
| 127 | `StickCurves` | .map | hot:render | **HOT-PATH-OK** | 6 / ~30 Hz | N = 6 curve types per render | - |
| 145 | `StickCurves` | .every | hot:render | **HOT-PATH-OK** | 2 / ~30 Hz | N = 2 sticks per render | - |
| 218 | `CurveGraph` | .map | hot:render | **HOT-PATH-OK** | 3 / ~30 Hz | N = 3 grid lines per render | - |
| 235 | `CurveGraph` | .map | hot:render | **HOT-PATH-OK** | ≤ 4 / ~30 Hz | N ≤ 4 curve points per render | - |
| 332 | `GameStickCurves` | .map | hot:render | **HOT-PATH-OK** | 2 / ~30 Hz | N = 2 tabs per render | - |
| 342 | `GameStickCurves` | .map | hot:render | **HOT-PATH-OK** | ≤ 7 / ~30 Hz | N ≤ 7 curve choices per render | - |

#### src/desktop/live/StickTestCards.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 45 | `StickTests > useEffect(cb) > setInterval(cb) > setOutlines(cb)` | .map | hot:interval | **HOT-PATH-OK** | 2 / 33 ms, test open only | N = 2 sticks per sample while the stick test is open | - |
| 50 | `StickTests > useEffect(cb) > setInterval(cb) > setOutlines(cb)` | .map | hot:interval | **HOT-PATH-OK** | 2 / 33 ms, test open only | N = 2 sticks per sample while the stick test is open | - |
| 56 | `StickTests > useEffect(cb) > setInterval(cb) > setOutlines(cb)` | .every | hot:interval | **HOT-PATH-OK** | 2 / 33 ms, test open only | N = 2 outlines, skips the state update when nothing moved | - |
| 56 | `StickTests > useEffect(cb) > setInterval(cb) > setOutlines(cb)` | .every | hot:interval | **HOT-PATH-OK** | 2 / 33 ms, test open only | N = 2 outlines, skips the state update when nothing moved | - |
| 79 | `StickTests > useEffect(cb) > setInterval(cb)` | .forEach | hot:interval | **HOT-PATH-OK** | 2 / 30 Hz for 10 s | N = 2 sticks per 33 ms sample, only during the 10 s drift test | - |
| 108 | `StickTests` | .map | hot:render | **HOT-PATH-OK** | 2 / ~30 Hz | N = 2 sticks per live frame (72-bucket outlines) | - |
| 168 | `StickTests` | .map | hot:render | **HOT-PATH-OK** | 2 / ~30 Hz | N = 2 sticks; the stats are memoized on the finished samples | Done in batch 1 (dev.10) |
| 215 | `CirclePlot` | .every | hot:render | **HOT-PATH-OK** | 72 / ~30 Hz | N = 72 buckets per live frame | - |
| 218 | `CirclePlot` | .forEach | hot:render | **HOT-PATH-OK** | 72 / ~30 Hz | N = 72 buckets, one path string per live frame | - |
| 240 | `DriftPlot` | .map | hot:render | **HOT-PATH-OK** | ~300 / ~30 Hz x 2 | ~300 samples; memo()ed, once per finished test | Done in batch 1 (dev.10) |
| 242 | `DriftPlot` | .map | hot:render | **HOT-PATH-OK** | ~300 / ~30 Hz x 2 | ~300 samples; memo()ed, once per finished test | Done in batch 1 (dev.10) |
| 244 | `line` | .map | hot:render | **HOT-PATH-OK** | ~600 / ~30 Hz x 2 | two ~300-point paths; memo()ed, once per finished test | Done in batch 1 (dev.10) |

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
| 63 | `swirlPixel` | for | hot:interval | **HOT-PATH-OK** | 4 / per pixel | N = 4 colors per pixel; the cost is the pixel loop at 173 | - |
| 70 | `swirlPixel` | for | hot:interval | **HOT-PATH-OK** | 4 / per pixel | N = 4 colors per pixel; the cost is the pixel loop at 173 | - |
| 176 | `draw` | for | hot:interval | **FIX-HOT-PATH** | - | CPU fallback: 128 x 72 px in JS every 100 ms (no GPU / GPU lost) | - |
| 178 | `draw` | for | hot:interval nested | **FIX-HOT-PATH** | 128 / per row | CPU fallback pixel loop, inner row | Same fix as the outer pixel loop |
| 182 | `draw` | for | hot:interval nested | **FIX-HOT-PATH** | 3 / per pixel | CPU fallback, 3 channels per pixel | Same fix as the outer pixel loop |

#### src/desktop/lookKnobs.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 44 | `knob` | .find | hot:render | **NOT-WORTH** | ~4, per knob control render | N ≈ 4 look knobs; on a settings control render | - |
| 61 | `useLookKnobs > useEffect(cb)` | .forEach | hot:effect | **NOT-WORTH** | ~4, per knob change | N ≈ 4 CSS variables; only when a knob changes | - |

#### src/desktop/narrator.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 42 | `notify` | .forEach | hot:raf | **NOT-WORTH** | ≤ 3, per narrator change | N ≤ 3 listeners; on narrator state change, not per frame | - |
| 92 | `voiceLang` | .find | hot:raf | **NOT-WORTH** | ≤ 12, per spoken line | N ≤ 12 voice languages; once per line spoken | - |
| 92 | `voiceLang` | .find | hot:raf | **NOT-WORTH** | ≤ 12, per spoken line | N ≤ 12 voice languages; once per line spoken | - |

#### src/desktop/pages/AboutPage.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 65 | `StudioCard` | .map | hot:render | **HOT-PATH-OK** | ~4, per About render | N ≈ 4 studio links; About page render | - |
| 107 | `AboutPage` | .map | hot:render | **HOT-PATH-OK** | ~4, per About render | N ≈ 4 tabs; About page render | - |

#### src/desktop/pages/GamesPage.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 71 | `RestartNotice` | .map | hot:render | **HOT-PATH-OK** | ≤ 3, per render | N ≤ 3 launchers; shown only after applying fixes | - |
| 86 | `OverwrittenNotice` | .map | hot:render | **HOT-PATH-OK** | ≤ 3, per render | N ≤ 3 launchers; shown only after a launcher overwrote a fix | - |
| 246 | `GamesSetup` | .filter | hot:render | **HOT-PATH-OK** | ≤ ~50, per Home render | fixes found by the scan, tens at most; Home render on interaction | - |
| 356 | `GamesSetup` | .filter | hot:render | **HOT-PATH-OK** | ≤ 4, per render | N ≤ 4 launchers; Home render | - |
| 378 | `GamesSetup` | .map | hot:render | **HOT-PATH-OK** | ≤ 4, per render | N ≤ 4 launchers; Home render | - |
| 459 | `GamesSetup` | .map | hot:render | **HOT-PATH-OK** | tens, per Home render | change history entries, tens; Home render | - |
| 462 | `GamesSetup` | .map | hot:render nested | **HOT-PATH-OK** | few per entry, per render | a few changes per backup; Home render | - |
| 474 | `GamesSetup` | .map | hot:render | **HOT-PATH-OK** | - | N = screens, 1-3; Home render | - |
| 474 | `GamesSetup` | .filter | hot:render | **HOT-PATH-OK** | - | N = screens, 1-3; Home render | - |
| 517 | `GamesSetup` | .map | hot:render | **HOT-PATH-OK** | ≤ 4, per render | N ≤ 4 launchers; Home render | - |
| 559 | `GamesSetup` | .map | hot:render | **HOT-PATH-OK** | ≤ ~50, per review render | chosen fixes, tens at most; review dialog render | - |
| 563 | `GamesSetup` | .map | hot:render nested | **HOT-PATH-OK** | ≤ ~3 per fix, per render | 1-3 files per chosen fix; review dialog render | - |
| 589 | `GamesSetup` | .map | hot:render | **HOT-PATH-OK** | ≤ ~50, per render | applied fixes, tens at most; result render after apply | - |
| 620 | `FixList` | .filter | hot:render | **HOT-PATH-OK** | 4 x ≤ ~50, per render | 4 launcher groups x tens of fixes; Home render on interaction | - |
| 620 | `FixList` | .map | hot:render | **HOT-PATH-OK** | 4 x ≤ ~50, per render | 4 launcher groups x tens of fixes; Home render on interaction | - |
| 620 | `FixList` | .filter | hot:render nested | **HOT-PATH-OK** | 4 x ≤ ~50, per render | 4 launcher groups x tens of fixes; Home render on interaction | - |
| 624 | `FixList` | .map | hot:render | **HOT-PATH-OK** | ≤ 4, per render | N ≤ 4 launcher groups | - |
| 631 | `FixList` | .map | hot:render nested | **HOT-PATH-OK** | ≤ ~50, per render | fixes in one group, tens at most | - |
| 654 | `SystemPart` | .map | hot:render | **HOT-PATH-OK** | - | N = screens, 1-3; Home render | - |
| 654 | `SystemPart` | .filter | hot:render | **HOT-PATH-OK** | - | N = screens, 1-3; Home render | - |
| 674 | `SystemPart` | .map | hot:render | **HOT-PATH-OK** | - | env warnings, 0-3; Home render | - |
| 691 | `SystemPart` | .some | hot:render | **HOT-PATH-OK** | - | PipeWire pro-audio rule files, 0-3 | - |

#### src/desktop/pages/LightbarPage.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 38 | `LightbarPage` | .map | hot:render | **HOT-PATH-OK** | ~6, per render | N ≈ 6 lightbar modes; page render | - |
| 51 | `LightbarPage` | .map | hot:render | **HOT-PATH-OK** | 4, per render | N = 4 favorite slots; page render | - |

#### src/desktop/pages/sectionFields.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 45 | `sub` | .filter | hot:render | **NOT-WORTH** | 2, per section render | N = 2 strings | - |

#### src/desktop/pages/SettingsPage.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 71 | `useGripTest > useCallback(cb)` | for | await | **SERIAL-REQUIRED** | ~6 pulses, per grip test click | timed pulses: each waits its slot on a deadline, one HID session | - |
| 139 | `HapticsSection` | .map | hot:render | **HOT-PATH-OK** | 3, per render | N = 3 sides; page render | - |
| 172 | `AutoHapticsSection` | .map | hot:render | **HOT-PATH-OK** | 4, per render | N = 4 options; page render | - |
| 187 | `AutoHapticsSection` | .map | hot:render | **HOT-PATH-OK** | 4, per render | N = 4 options; page render | - |
| 200 | `SpeakerSection` | .map | hot:render | **HOT-PATH-OK** | 4, per render | N = 4 options; page render | - |
| 307 | `MicSection` | .map | hot:render | **HOT-PATH-OK** | 3, per render | N = 3 options; page render | - |
| 338 | `StatusPinSection` | .map | hot:render | **HOT-PATH-OK** | 17, per render | N = 17 GPIO pins; page render | - |
| 425 | `DisplaySection` | .map | hot:render | **HOT-PATH-OK** | 4, per render | N = 4 options; page render | - |

#### src/desktop/pages/SlotsPage.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 26 | `formatMac` | .map | hot:render | **HOT-PATH-OK** | ≤ 24, every 1.5 s while shown | N = 6 address bytes x ≤ 4 slots; re-render per 1.5 s slot poll | - |
| 103 | `SlotsPage` | .map | hot:render | **HOT-PATH-OK** | 4, every 1.5 s while shown | N = 4 slots; re-render per 1.5 s slot poll | - |

#### src/desktop/pages/TriggersPage.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 42 | `TriggersPage` | .map | hot:render | **HOT-PATH-OK** | 7, per render | N = 7 presets; page render | - |

#### src/desktop/theme/desktopPalette.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 89 | `contrast` | .sort | hot:raf+render | **HOT-PATH-OK** | 2, per contrast call | N = 2 values; per color computed on theme change or render | - |
| 95 | `mix` | .map | hot:raf+render | **HOT-PATH-OK** | 3, per mix call | N = 3 channels | - |
| 106 | `hexToRgb` | .map | hot:raf+render | **HOT-PATH-OK** | 3, per call | N = 3 channels; also in LiveController render | - |
| 151 | `ensureContrast` | for | hot:raf | **NOT-WORTH** | ≤ 20, per theme change | ≤ 20 steps; one-shot rAF on game page open or theme change | - |
| 208 | `legibleOnAll` | for | hot:raf | **NOT-WORTH** | ≤ 80, per theme change | ≤ 5 passes x ≤ 4 grounds; theme change or game page open only | - |
| 208 | `legibleOnAll` | .some | hot:raf | **NOT-WORTH** | ≤ 80, per theme change | ≤ 5 passes x ≤ 4 grounds; theme change or game page open only | - |
| 208 | `legibleOnAll` | .reduce | hot:raf nested | **NOT-WORTH** | ≤ 80, per theme change | ≤ 5 passes x ≤ 4 grounds; theme change or game page open only | - |

#### src/desktop/tour/Tour.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 199 | `Tour` | .map | hot:render | **HOT-PATH-OK** | 19, ~30/s during the tour | N = 19 buttons, 30 Hz input renders while the tour is open | - |
| 199 | `Tour` | .filter | hot:render | **HOT-PATH-OK** | 19, ~30/s during the tour | N = 19 buttons, 30 Hz input renders while the tour is open | - |
| 207 | `Tour > useEffect(cb) > requestAnimationFrame(cb) > setPressed(cb)` | .filter | hot:raf | **HOT-PATH-OK** | <= 19 / held-button change | N <= 19 button labels, only when the held set changes on the press step | - |
| 382 | `Tour` | .map | hot:render | **HOT-PATH-OK** | ≤ 4, ~30/s during the tour | N ≤ 4 chips (PRESS_GOAL), per input render during the tour | - |

#### src/desktop/WindowsUsbRepair.tsx

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 46 | `WindowsUsbRepair` | .map | hot:render | **HOT-PATH-OK** | 4, per poll (Windows) | N = 4 steps; re-render per USB poll on Windows only | - |

#### src/flash/index.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 110 | `parseUf2Regions` | for-of | nested | **NOT-WORTH** | ~4000 blocks / per firmware flash | UF2 blocks copied once per firmware install, linear overall | - |

#### src/oled/statusPad.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 167 | `filled` | for | nested | **NOT-WORTH** | ≤ 128x64 px / per sim mirror frame | small rects on the simulated OLED only (dev/test fake) | - |
| 171 | `invert` | for | nested | **NOT-WORTH** | ≤ 128x64 px / per sim mirror frame | small rects on the simulated OLED only (dev/test fake) | - |

#### src/protocol/bridgeClient.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 188 | `boardNameFrom` | .some | hot:poll+usb-event | **HOT-PATH-OK** | 16 / 10 Hz lightbar + 1 Hz poll | N ≤ 16 name bytes per identity decode | - |
| 232 | `sameIdentity` | .every | hot:poll | **HOT-PATH-OK** | ~30 / 1 Hz (10 Hz lightbar) poll | ~30 identity fields compared so a same poll skips the re-render | - |
| 236 | `sameIdentity` | .every | hot:poll nested | **HOT-PATH-OK** | ≤ 3 / 1 Hz identity poll | N ≤ 3 per array field (lightbar RGB), skips re-render | - |
| 422 | `runCommand` | for | await | **SERIAL-REQUIRED** | until done / per command | one HID session: polls 0xF1 until the sequence settles, to a deadline | - |
| 583 | `readInput` | .some | hot:poll | **HOT-PATH-OK** | 63 / 30 Hz live input | N = 63 bytes, exits at the first non-zero byte | - |
| 596 | `readSlots` | .map | hot:poll | **HOT-PATH-OK** | 4 / every 1.5 s on Slots | N = 4 slots | - |
| 598 | `readSlots` | .map | hot:poll | **HOT-PATH-OK** | 4 / every 1.5 s on Slots | N = 4 slots | - |
| 664 | `runControllerTest` | for | await | **SERIAL-REQUIRED** | until done / per controller test | one HID session: polls the controller header until done or deadline | - |
| 670 | `runControllerTest` | for | await nested | **SERIAL-REQUIRED** | ≤ CTRL_MAX_PAGES / per controller test | one HID session: page reads must not interleave; 63-byte report cap | - |
| 697 | `decodeAudioCounters` | .forEach | hot:poll | **HOT-PATH-OK** | 15 / per Dongle dashboard poll | N = 15 counters | - |

#### src/protocol/calibration.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 58 | `normalizeCalibration` | .map | hot:render | **HOT-PATH-OK** | 3 / per Calibration render | N = 3 gyro axes | - |
| 144 | `fitGyro` | .reduce | nested | **NOT-WORTH** | 3 x ~90 samples / per calibration | once when a gyro calibration step ends | - |

#### src/protocol/config.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 230 | `decodeConfigBody` | .filter | hot:poll+usb-event | **HOT-PATH-OK** | 2 / every 2 s config poll | N ≤ 2 offsets (with or without report id) | - |
| 230 | `decodeConfigBody` | .map | hot:poll+usb-event | **HOT-PATH-OK** | 2 / every 2 s config poll | N ≤ 2 offsets (with or without report id) | - |
| 232 | `decodeConfigBody` | .find | hot:poll+usb-event | **HOT-PATH-OK** | 2 / every 2 s config poll | N ≤ 2 candidates, early exit | - |
| 236 | `decodeConfigBody` | .map | hot:poll+usb-event | **NOT-WORTH** | issues / on a bad read | error path only (the board sent an invalid config) | - |
| 250 | `encodeConfigBody` | .map | hot:poll+usb-event | **NOT-WORTH** | issues / on a bad apply | error path only (invalid draft) | - |
| 272 | `encodeConfigBody` | for | hot:poll+usb-event | **HOT-PATH-OK** | 4 / per apply (debounced edit) | N = 4 favourite colors | - |
| 274 | `encodeConfigBody` | for | hot:poll+usb-event | **HOT-PATH-OK** | 4 / per apply (debounced edit) | N = 4 favourite colors | - |
| 276 | `encodeConfigBody` | for | hot:poll+usb-event | **HOT-PATH-OK** | 4 / per apply (debounced edit) | N = 4 favourite colors | - |
| 385 | `normalizeConfig` | .map | hot:poll+usb-event | **HOT-PATH-OK** | 4 / every 2 s config poll | N = 4 favourite colors | - |
| 387 | `normalizeConfig` | .map | hot:poll+usb-event | **HOT-PATH-OK** | 4 / every 2 s config poll | N = 4 favourite colors | - |
| 389 | `normalizeConfig` | .map | hot:poll+usb-event | **HOT-PATH-OK** | 4 / every 2 s config poll | N = 4 favourite colors | - |
| 447 | `arraysEqual` | .every | hot:poll+render | **HOT-PATH-OK** | 4 / every 2 s poll + per render | N = 4 favourite colors per field | - |
| 483 | `decodeAt` | .map | hot:poll+usb-event | **HOT-PATH-OK** | 4 / every 2 s config poll | N = 4 favourite colors | - |
| 485 | `decodeAt` | .map | hot:poll+usb-event | **HOT-PATH-OK** | 4 / every 2 s config poll | N = 4 favourite colors | - |
| 487 | `decodeAt` | .map | hot:poll+usb-event | **HOT-PATH-OK** | 4 / every 2 s config poll | N = 4 favourite colors | - |

#### src/protocol/officialFirmware.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 68 | `compareOfficial` | .map | hot:render | **HOT-PATH-OK** | ≤ 3 / per ControllerInfo render | N ≤ 3 firmware lines | - |
| 68 | `compareOfficial` | .filter | hot:render | **HOT-PATH-OK** | ≤ 3 / per ControllerInfo render | N ≤ 3 firmware lines | - |
| 71 | `compareOfficial` | .every | hot:render | **HOT-PATH-OK** | ≤ 3 / per ControllerInfo render | N ≤ 3 firmware lines | - |
| 73 | `compareOfficial` | .every | hot:render | **HOT-PATH-OK** | ≤ 3 / per ControllerInfo render | N ≤ 3 firmware lines | - |

#### src/protocol/remap.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 72 | `tablesEqual` | .every | hot:render | **HOT-PATH-OK** | 16 / per PartPanel render | N = 16 remap entries | - |

#### src/protocol/simulatedDongle.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 67 | `simFirmware` | .map | hot:poll+usb-event | **NOT-WORTH** | 11 / per sim controller info read | dev/test fake only; 11 chars per controller info read | - |
| 72 | `simFirmware` | .map | hot:poll+usb-event | **NOT-WORTH** | 8 / per sim controller info read | dev/test fake only; 8 chars per controller info read | - |
| 106 | `simTelemetry` | .forEach | hot:poll+usb-event | **NOT-WORTH** | ≤ 19 / per sim telemetry read | dev/test fake only; telemetry pages are read rarely | - |
| 109 | `simTelemetry` | .forEach | hot:poll+usb-event | **NOT-WORTH** | 6 / per sim telemetry read | dev/test fake only; telemetry pages are read rarely | - |
| 111 | `simTelemetry` | .forEach | hot:poll+usb-event | **NOT-WORTH** | 3 / per sim telemetry read | dev/test fake only; telemetry pages are read rarely | - |
| 240 | `liveScreen` | for | hot:poll+usb-event | **HOT-PATH-OK** | 8192 px / per sim mirror poll | dev/test fake only: 128x64 px per simulated OLED mirror read | - |
| 240 | `liveScreen` | for | hot:poll+usb-event nested | **HOT-PATH-OK** | 8192 px / per sim mirror poll | dev/test fake only: 128x64 px per simulated OLED mirror read | - |
| 274 | `timings` | .forEach | hot:poll+usb-event | **HOT-PATH-OK** | 8 / per sim 0xFC read (dashboard) | dev/test fake only; N = 8 timing stages | - |
| 307 | `getReport` | for | hot:poll+usb-event | **HOT-PATH-OK** | 1024 / per sim mirror poll | dev/test fake only: 1024-byte test pattern | - |
| 366 | `getReport` | .forEach | hot:poll+usb-event | **HOT-PATH-OK** | 4 / every 1.5 s on Slots | dev/test fake only; N = 4 slots | - |
| 623 | `identity` | .some | hot:poll+usb-event | **HOT-PATH-OK** | ≤ 50 / per sim identity (10 Hz) | dev/test fake only; N ≤ 50 config bytes, early exit | - |
| 623 | `identity` | .some | hot:poll+usb-event | **HOT-PATH-OK** | ≤ 50 / per sim identity (10 Hz) | dev/test fake only; N ≤ 50 config bytes, early exit | - |
| 629 | `identity` | .map | hot:poll+usb-event | **HOT-PATH-OK** | 2 / per sim identity (10 Hz) | dev/test fake only; N = 2 colorway chars | - |
| 641 | `identity` | .map | hot:poll+usb-event | **HOT-PATH-OK** | 8 / per sim identity (10 Hz) | dev/test fake only; N = 8 board-name chars | - |

#### src/protocol/stickCurve.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 65 | `isValidCurve` | .some | hot:render | **HOT-PATH-OK** | 4 / per curveAt call (65 per graph) | N = 4 points; cost is in the callers (see nodesOf row) | - |
| 68 | `isValidCurve` | for | hot:render | **HOT-PATH-OK** | 3 / per curveAt call (65 per graph) | N = 3 point pairs | - |
| 116 | `curvesEqual` | .every | hot:render | **HOT-PATH-OK** | 4 / per StickCurves render | N = 4 points | - |
| 145 | `buildNodes` | .map | hot:render | **HOT-PATH-OK** | - | N = 4 points; once per curve (WeakMap cache), not per call | Done in batch 1 (dev.10) |
| 145 | `buildNodes` | .map | hot:render | **HOT-PATH-OK** | - | N = 4 points; once per curve (WeakMap cache), not per call | Done in batch 1 (dev.10) |
| 152 | `evalNodes` | for | hot:render | **HOT-PATH-OK** | ≤ 34 / 65 x 2 graphs per frame | N ≤ 34 nodes, the firmware math itself | - |

#### src/protocol/webUsbTransport.ts

| Line | Function | Kind | Trigger | Verdict | Runs | Why | Change |
|---|---|---|---|---|---|---|---|
| 22 | `configuratorInterface` | .find | hot:poll+usb-event | **HOT-PATH-OK** | ≤ 8 / per findPermitted (2 s poll) | N = 2-4 interfaces x 1-2 alternates | - |
| 22 | `configuratorInterface` | .some | hot:poll+usb-event nested | **HOT-PATH-OK** | ≤ 8 / per findPermitted (2 s poll) | N = 2-4 interfaces x 1-2 alternates | - |
| 40 | `findPermitted` | .find | hot:poll+usb-event | **HOT-PATH-OK** | 1-2 / 2 s poll (Windows repair) | N = permitted USB devices, 1-2 | - |

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
