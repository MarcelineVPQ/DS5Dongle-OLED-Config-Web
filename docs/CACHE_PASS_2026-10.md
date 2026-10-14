# Cache pass: every cache, memo and repeated read, with a verdict

_2026-10-13. Done per CLAUDE.md "Cache pass" (the AVIEW pass pattern: a script lists every candidate, one verdict per row, nothing sampled by eye). One doc for both repos; the firmware is read-only here (its few rows are at the end). No behaviour has changed: the only code changes are the `// cache:` comments on the 47 kept-state rows and the lister. The owner picks which batches to do (BACKLOG row "Cache pass batches")._

## How the list was made

**App**: `tools/list_caches.mjs`, on the TypeScript compiler API with the type checker. It shares the program, the function names and the call resolver (through interfaces, object literals and factories) with `tools/list_loops.mjs`; both import them from `tools/ts_program.mjs`, so there is one copy. It reads `src/` and `electron/` (tests and the vendored `src/flash/picoflash` excluded) and lists a row for each of these kinds:

| Kind | What is listed | Gated |
|---|---|---|
| `module` | A top-level binding written after load: a collection (Map, Set, WeakMap, array, record) mutated inside a function, or a scalar that looks like a memo (named cache/memo/last/latest/prev/seen/…, set with `??=` / `\|\|=`, set inside an `if` that tests it, holding a `{at, …}` timestamp, or assigned a value read from I/O). Sets of functions (subscriber lists) are left out. | yes |
| `field` | The same for a class field (`private x = new Map()`, or set in the constructor). | yes |
| `closure` | A function-local collection that a nested function writes and something looks up (`.get` / `.has`): a memo captured by a closure. Plain accumulators (`out.push`) are not listed. | yes |
| `ref` | A `useRef` holding a collection, named like a memo, set with `.current ??=`, or set from a DOM read (`querySelector`, `getAttribute`, …; also through a local). | yes |
| `snapshot` | A top-level or class binding whose initial value is read from disk, storage, a process or the network (a mirror of a file). | yes |
| `useMemo`, `useCallback`, `memo` | Every one. | no: deps are the key, React bounds them |
| `storage` | One row per localStorage key (`readPref` / `writePref` / `usePref` / `useFlagPref` / `useRawPref` / `localStorage.*`), with every site. | no |
| `ttl` | A comparison against the clock (TTL, throttle, debounce, age). | no |
| `poll-io` | A `setInterval` / `usePoll` callback, or a poll that re-arms itself with `setTimeout`, that reaches I/O. | no |
| `effect-io` | A `useEffect` that reaches I/O (it runs again on each mount and deps change; the renderer keeps scan results, details and colors in component state). | no |
| `repeat-io` | An I/O-reaching call inside a loop body (not the loop's header, which runs once). | no |
| `dup-read` | The same file read (callee and arguments as written) more than once in one function. | no |

"I/O" is resolved with the type checker, transitively through our own functions: `fs` reads (read*, stat, exists, access, readdir, readlink, realpath), `child_process` spawns, `fetch` / `net.fetch`, `localStorage.getItem`, the preload API (`DesktopApi`: IPC), the board transport (`getReport` / `setReport`: HID) and WebUSB `getDevices`. A callback passed to a call counts for its caller (it runs in place); a function that is returned or stored does not.

Left out on purpose: the simulated dongle's fields (`src/protocol/simulatedDongle.ts`: the fake device's memory, not a cache of anything) and plain React state (`useState`), whose fetches show up as `effect-io` rows instead.

**Firmware** (`~/projects/DS5Dongle/src`, read-only; `node tools/list_caches.mjs --firmware <repo>`): a pattern scan for `static` variables named like a memo (last / prev / cached / seen / valid / have_) and file-scope containers (`unordered_map`, `map`, `set`, `vector`, `deque`). Plain buffers are not listed.

**Verdicts** (one per row):

- **OK**: key, invalidation and bound are stated, and are right.
- **FIX-STALE**: can serve stale data the user would notice.
- **FIX-UNBOUNDED**: can grow without limit (the growth source is stated).
- **ADD-CACHE**: repeated expensive work (N and the cost are given).
- **REMOVE**: a cache that adds complexity for no gain.
- **NOT-WORTH**: a candidate that isn't worth caching: N is tiny, the read is rare, or it must be fresh.

Line numbers are as of this commit; if code moves, the function and name find the row.

## Counts

| Kind | OK | FIX-STALE | FIX-UNBOUNDED | ADD-CACHE | REMOVE | NOT-WORTH | Total |
|---|---|---|---|---|---|---|---|
| module | 12 | 1 | - | - | - | - | 13 |
| field | 11 | 2 | - | 1 | - | - | 14 |
| closure | 3 | - | - | - | - | - | 3 |
| ref | 15 | - | - | - | - | - | 15 |
| snapshot | 2 | - | - | - | - | - | 2 |
| useMemo | 20 | - | - | - | - | - | 20 |
| useCallback | 54 | - | - | - | 1 | - | 55 |
| memo | 4 | - | - | - | - | - | 4 |
| storage | 30 | - | - | - | - | 1 | 31 |
| ttl | 7 | - | - | - | - | - | 7 |
| poll-io | 1 | - | - | - | - | 11 | 12 |
| effect-io | 19 | - | - | 1 | - | 20 | 40 |
| repeat-io | - | - | - | 11 | - | 79 | 90 |
| dup-read | - | - | - | 2 | - | 3 | 5 |
| fw-table | 1 | - | - | - | - | - | 1 |
| fw-static | 12 | - | - | - | 1 | - | 13 |
| **Total** | **191** | **3** | **0** | **15** | **2** | **114** | **325** |


No row is FIX-UNBOUNDED: every growing structure is keyed by something finite (games, fixes, processes, parts) or is pruned or windowed. The closest is the `ds5.slotControllers` preference (one entry per controller ever seen in a slot, never pruned), which stays a handful in practice (NOT-WORTH).

## The gate

**Kept state is gated** (`node tools/list_caches.mjs --check`, in `npm run gates`, pre-commit and CI). Every `module`, `field`, `closure`, `ref` and `snapshot` row needs a comment on its line or just above it:

```ts
// cache: OK — key=game key; invalidated=cleared by every scan; bound=games in the library
private colors = new Map<string, string | null>();
```

`key=`, `invalidated=` and `bound=` are required (with `;` between them), plus one of the six verdicts. These are the rows where a missing invalidation or bound becomes a bug later, and there are few of them (47), so the comment is cheap and low-noise.

**Not gated:** `useMemo` / `useCallback` / `memo` (the deps are the key and React bounds them; 77 comments would be noise), the localStorage keys (preferences), the clock checks, and the I/O rows (`poll-io`, `effect-io`, `repeat-io`, `dup-read`). Those are suggestions, not state; their verdicts live in this doc and the pass is re-run when a release touches them (CLAUDE.md "Cache pass").

## The work: proposed changes in 6 batches (biggest effect first)

Nothing below is done yet. Each change keeps the current behaviour except the stale data it fixes, and needs a test that pins it.

### Batch 1: the update feed (stale firmware download, repeated fetches)

| Location | Rows | Why | Change |
|---|---|---|---|
| `electron/main/updater.ts:77` `Updater.manifest`, used by `downloadFirmware` (`:229`) | FIX-STALE | `firmwareBytes` (`firmwareSource.ts`) decides "download the published firmware" from a **fresh** feed, then `downloadPublished` → `updater.downloadFirmware()` downloads from `this.manifest`, the feed of the last update check (up to 6 h old, or from app start with automatic checks off, or the other channel's after a switch whose re-check failed). The board can get an older build than the one the card offered. | Pass the fresh feed's `firmware` entry from `firmwareBytes` to the download (the smallest fix), or make one feed cache (below) the only source. |
| `src/desktop/useUpdates.ts:81` `useFirmwareUpdate` effect | ADD-CACHE | `latestFirmware()` fetches the feed and its `.sig` fresh on every call, and the effect runs on every update phase change: idle → checking → result is 2-3 feed fetches per check, next to the updater's own fetch of the same feed. | Main keeps the last verified feed with its channel and fetch time; `latestFirmware` reuses one under ~60 s old for the same channel. Key = channel, invalidated = 60 s or a channel change, bound = 1 per channel. |

### Batch 2: the game art colors (Glass look)

| Location | Rows | Why | Change |
|---|---|---|---|
| `electron/main/games/service.ts:226` `GamesService.colors`, asked by `useArtColor` (`src/desktop/library/gameArt.ts:31`) | ADD-CACHE | With the Glass look, every tile whose art has loaded (and Continue playing, and each game page) asks main for the game's color. `colors` is cleared by every scan, so after each scan (every Games page open, every apply) main decodes every cover again: `dominantColor` is a full `nativeImage` decode + resize per game, synchronous on the main process, so hundreds of them hold up IPC and the tray. The art rarely changes. | Key the color by the art file's path + mtime and keep it across scans (drop entries whose game is gone). Bound = games in the library. |

### Batch 3: two sticky values

| Location | Rows | Why | Change |
|---|---|---|---|
| `electron/main/games/running.ts:288` `RunningGameWatcher.exeCache` (Windows) | FIX-STALE | The program files found in a game's folder are cached for the app's life. A folder indexed while the game was still installing (empty), or before an update renamed its `.exe`, stays wrong until the app restarts, so the game is never seen as Playing and its profile never switches. | Clear the cache when the candidate list changes (each library scan), or re-index a folder whose cached set is empty. |
| `src/desktop/tray/trayIcon.ts:38` `artPromise` | FIX-STALE | The tray art's decode promise is kept even when it rejected, so one failed decode leaves the tray icon blank for the session. | Clear `artPromise` on rejection. |

### Batch 4: the library scan's repeated reads (same work as LOOP_PASS Batch 3)

These are the same reads as the loop pass's Batch 3, seen from the cache side. Doing that batch fixes them; they are listed here so the rows have verdicts, not as separate work.

| Location | Rows | Why | Change |
|---|---|---|---|
| `electron/main/games/proton.ts:108` `buildVersion`, via `buildHonoursPreferSdl` / `preferSdlBuild` (`games.ts:364, 365, 535, 536, 697, 699`) and `pickBuild` (`proton.ts:143`) | 9 × ADD-CACHE | For each game that needs the controller check, the runner build's `version` file is read again, and the target pick reads the `version` file of every installed build again: games × builds reads of the same few files per scan. | Memoize `buildVersion` per scan (a Map keyed by folder, made in `scan()` and dropped after). One fix for all nine rows. |
| `electron/main/games/steam.ts:127, 133` `steamAppManifests` | 2 × ADD-CACHE | Every app manifest is read and VDF-parsed twice per scan: `listSteamGames` (the scan), then `gameDetails` (the library details). | One read per scan, shared by the list and the details. |
| `electron/main/games/heroic.ts:92`, `details.ts:141` | 2 × ADD-CACHE | `nile_install_info.json` / `nile_library.json` are read and JSON-parsed twice in one expression (once for the object form, once for the array form). | Read once into a local. |
| `src/desktop/DesktopApp.tsx:492` `useGamesAttention` | ADD-CACHE | `loadDeclined()` (a localStorage read + JSON parse) runs once per fix inside the `.filter`; N = recommended fixes (tens) per recount. | Call it once before the filter. |

Not repeated here: Steam's `localconfig` linear search per game is CPU work, not a read; it stays LOOP_PASS Batch 3 (a `Map` index).

### Batch 5: firmware, one clock measurement

| Location | Rows | Why | Change |
|---|---|---|---|
| `src/oled.cpp:1051` `cached_real_khz` (firmware) | REMOVE | A second copy of `cmd.cpp:594`'s measured clock. This one re-measures on every CPU-screen entry: `frequency_count_khz` busy-waits a few ms on core0, though clk_sys is fixed at boot. | One lazy `measured_clk_khz()` shared by `cmd.cpp` and `oled.cpp` (measured once). |

### Batch 6: cleanup

| Location | Rows | Why | Change |
|---|---|---|---|
| `src/components/ThemeToggle.tsx:118` `setTo` | REMOVE | `useCallback` around a function that returns a new closure on every call (`onClick={setTo("light")}`), so it saves nothing. | A plain function. |

## Cross-reference: the loop pass

- **Already done by LOOP_PASS Batch 1 (on master):** the stick-curve nodes (`stickCurve.ts` `nodeCache`, a WeakMap per curve), the Buttons-list sections (`memo`), the layout sort and use count (`useMemo`), the drift results and plot (`useMemo` / `memo`), and the trigger stops and touchpad box looked up once per mount (`LiveController.tsx` refs). Their rows are here as **OK**, with key, invalidation and bound stated.
- **Still LOOP_PASS Batch 3:** `buildVersion` per scan, the shared Steam manifest read, and the `localconfig` index. Batch 4 above points at the same work.
- **LOOP_PASS Batch 2 (firmware):** `bt_peek_feature` copies a `std::vector` out of the feature-report cache on every call. The cache itself (`feature_data`) is OK here.

## Found along the way

- **The firmware feed is fetched with automatic checks off.** `useFirmwareUpdate` asks `latestFirmware` at startup (phase `idle`), and `firmwareSource.manifest` always fetches ("fresh every time"), so the app reaches GitHub's feed at start even when "Check for updates automatically" is off. That may be intended (the firmware card needs an answer). **Owner question**; Batch 1's feed cache doesn't change it.
- **`AutoUpdateAsk`'s 1 s interval runs for the whole session.** It keeps doing a `querySelector` and a localStorage read every second after the question is answered, and while the window is hidden. It isn't a cache problem, but it goes against the lean rule. Fix: stop the interval once `due` or `asked` is set, or use the window-shown gate.
- **The Slots page parses its remembered controllers on every render.** `readMemory()` parses `ds5.slotControllers` on each 1.5 s slot poll and makes a new object, so the effect that depends on it runs every render too (it returns early). `useRawPref` (the existing preference hook) plus a `useMemo` parse would parse it once per change. NOT-WORTH on its own.
- **Opening the Games page always runs a full scan.** This is by design: the page shows the launchers' files as they are now, and the HDR check is reused for 3 s. Showing the last scan straight away and rescanning behind it would be a UX change (owner decision), not a cache fix. The scan's cost is LOOP_PASS Batch 3.

## Every row, by file

Kinds and verdicts as above. "Found" is what the lister saw: the type and how it is written, the deps, or which I/O it reaches.

### App (`MarcelineVPQ/DS5Dongle-OLED-Config-Web`)

#### electron/main/download.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 64 | `downloadVerified` | ttl | `Date.now() - lastReport > 150` |  | **OK** | progress throttle (150 ms), not a cache |

#### electron/main/firmwareHold.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 14 | `FirmwareHold` | field | `held` | Map<HeldAction, () => void>; written by .clear .set | **OK** | key=held action (install/restart/quit); invalidated=when the firmware write ends (run, then cleared); bound=3 actions |

#### electron/main/games/backup.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 180 | `run` | repeat-io | `existsSync` | in .map (line 179); reaches fs | **NOT-WORTH** | each backed-up file once, on apply/undo/history only |
| 184 | `run` | repeat-io | `readlinkSync` | in .map (line 179); reaches fs | **NOT-WORTH** | each backed-up file once, on apply/undo/history only |
| 201 | `run` | repeat-io | `sha256` | in forof (line 201); reaches fs | **NOT-WORTH** | each backed-up file once, on apply/undo/history only |
| 218 | `restore` | repeat-io | `sha256` | in .filter (line 218); reaches fs | **NOT-WORTH** | each backed-up file once, on apply/undo/history only |
| 229 | `putBack` | repeat-io | `removeFile` | in forof (line 228); reaches fs | **NOT-WORTH** | each backed-up file once, on apply/undo/history only |
| 233 | `putBack` | repeat-io | `existsSync` | in forof (line 228); reaches fs | **NOT-WORTH** | each backed-up file once, on apply/undo/history only |
| 234 | `putBack` | repeat-io | `writeFileAtomic` | in forof (line 228); reaches fs | **NOT-WORTH** | each backed-up file once, on apply/undo/history only |
| 234 | `putBack` | repeat-io | `readFileSync` | in forof (line 228); reaches fs | **NOT-WORTH** | each backed-up file once, on apply/undo/history only |
| 251 | `list` | repeat-io | `manifest` | in .flatMap (line 246); reaches fs | **NOT-WORTH** | each backed-up file once, on apply/undo/history only |
| 283 | `prune` | repeat-io | `manifest` | in forof (line 280); reaches fs | **NOT-WORTH** | each backed-up file once, on apply/undo/history only |

#### electron/main/games/details.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 69 | `steamDetails` | repeat-io | `steamArt` | in forof (line 55); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 70 | `steamDetails` | repeat-io | `existing` | in forof (line 55); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 89 | `steamArt` | closure | `found` | Map<string, { path: string; mtime: number; }>; written by a nested function (.set), looked up with .get | **OK** | key=art file name; invalidated=per call (one game's art folder); bound=files in one game's librarycache folder |
| 106 | `steamArt` | repeat-io | `readdirSync` | in forof (line 102); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 115 | `pick` | repeat-io | `existing` | in forof (line 114); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 141 | `heroicDetails` | dup-read | `readJson` | 2× readJson(join(install.root, "store_cache/nile_library.json")) (lines 141, 141) | **ADD-CACHE** | the same Amazon store file read and JSON-parsed twice in one expression (object or array form); read once into a local (Batch 4) |
| 159 | `heroicDetails` | repeat-io | `heroicPrefix` | in forof (line 146); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 161 | `heroicDetails` | dup-read | `cached` | 2× cached(e.art_cover) (lines 161, 165) | **NOT-WORTH** | two existence checks of the same small file per game, per scan |
| 161 | `heroicDetails` | repeat-io | `cached` | in forof (line 146); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 162 | `heroicDetails` | repeat-io | `cached` | in forof (line 146); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 163 | `heroicDetails` | repeat-io | `cached` | in forof (line 146); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 164 | `heroicDetails` | repeat-io | `cached` | in forof (line 146); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 165 | `heroicDetails` | repeat-io | `cached` | in forof (line 146); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 213 | `lutrisDetails` | dup-read | `art` | 2× art("banners") (lines 213, 213) | **NOT-WORTH** | two existence checks of the same small file per game, per scan |
| 213 | `lutrisDetails` | repeat-io | `art` | in forof (line 203); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 213 | `lutrisDetails` | repeat-io | `existing` | in forof (line 203); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 223 | `gameDetails` | repeat-io | `steamDetails` | in forof (line 223); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 224 | `gameDetails` | repeat-io | `heroicDetails` | in forof (line 224); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 225 | `gameDetails` | repeat-io | `lutrisDetails` | in forof (line 225); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |

#### electron/main/games/games.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 307 | `scan` | repeat-io | `scanSteam` | in .forEach (line 307); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 364 | `scanSteam` | repeat-io | `buildHonoursPreferSdl` | in forof (line 341); reaches fs | **ADD-CACHE** | same build's `version` file read again per game (x builds for the target pick); memoize `buildVersion` per scan = LOOP_PASS Batch 3 (one fix covers both rows) |
| 365 | `scanSteam` | repeat-io | `preferSdlBuild` | in forof (line 341); reaches fs | **ADD-CACHE** | same build's `version` file read again per game (x builds for the target pick); memoize `buildVersion` per scan = LOOP_PASS Batch 3 (one fix covers both rows) |
| 494 | `scan` | repeat-io | `scanHeroic` | in .forEach (line 494); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 514 | `scanHeroic` | repeat-io | `existsSync` | in forof (line 512); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 518 | `scanHeroic` | repeat-io | `existsSync` | in forof (line 512); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 535 | `scanHeroic` | repeat-io | `buildHonoursPreferSdl` | in forof (line 512); reaches fs | **ADD-CACHE** | same build's `version` file read again per game (x builds for the target pick); memoize `buildVersion` per scan = LOOP_PASS Batch 3 (one fix covers both rows) |
| 536 | `scanHeroic` | repeat-io | `preferSdlBuild` | in forof (line 512); reaches fs | **ADD-CACHE** | same build's `version` file read again per game (x builds for the target pick); memoize `buildVersion` per scan = LOOP_PASS Batch 3 (one fix covers both rows) |
| 649 | `scan` | repeat-io | `installedTools` | in .flatMap (line 649); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 649 | `scan` | repeat-io | `valveProtons` | in .flatMap (line 649); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 651 | `scan` | repeat-io | `scanLutris` | in .forEach (line 651); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 683 | `scanLutris` | repeat-io | `hasBuild` | in forof (line 681); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 697 | `scanLutris` | repeat-io | `buildHonoursPreferSdl` | in forof (line 681); reaches fs | **ADD-CACHE** | same build's `version` file read again per game (x builds for the target pick); memoize `buildVersion` per scan = LOOP_PASS Batch 3 (one fix covers both rows) |
| 699 | `scanLutris` | repeat-io | `preferSdlBuild` | in forof (line 681); reaches fs | **ADD-CACHE** | same build's `version` file read again per game (x builds for the target pick); memoize `buildVersion` per scan = LOOP_PASS Batch 3 (one fix covers both rows) |
| 960 | `writeChosen > run(cb)` | repeat-io | `writeEdits` | in forof (line 960); reaches fs | **NOT-WORTH** | writes, one per changed file |

#### electron/main/games/hdr.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 100 | `findOnPath` | repeat-io | `accessSync` | in forof (line 97); reaches fs | **NOT-WORTH** | one entry per PATH/layer folder, inside the 3 s HDR cache |
| 126 | `hasLayer` | repeat-io | `readdirSync` | in .some (line 123); reaches fs | **NOT-WORTH** | one entry per PATH/layer folder, inside the 3 s HDR cache |

#### electron/main/games/heroic.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 50 | `findHeroicInstalls` | repeat-io | `existsSync` | in forof (line 46); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 92 | `listHeroicGames` | dup-read | `readJson` | 2× readJson(join(install.root, "store_cache/nile_install_info.json")) (lines 92, 94) | **ADD-CACHE** | the same Amazon store file read and JSON-parsed twice in one expression (object or array form); read once into a local (Batch 4) |
| 122 | `listHeroicGames` | repeat-io | `readJson` | in .map (line 118); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |

#### electron/main/games/libraryStore.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 35 | `LibraryStore` | snapshot | `data` | { version: 1; games: Record<string, { title: string; profile?: { setti…; read once: fs | **OK** | key=none (the whole library.json); invalidated=write-through: every change saves the file; single-instance app, nothing else writes it; bound=one file (games x profiles) |

#### electron/main/games/lutris.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 37 | `findLutrisInstalls` | repeat-io | `existsSync` | in forof (line 33); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 41 | `findLutrisInstalls` | repeat-io | `readdirSync` | in forof (line 33); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 51 | `findLutrisInstalls` | repeat-io | `existsSync` | in forof (line 33); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 121 | `listLutrisGames` | repeat-io | `readYaml` | in .map (line 117); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 130 | `lutrisWineBuilds` | repeat-io | `existsSync` | in .filter (line 130); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |

#### electron/main/games/processes.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 150 | `close` | repeat-io | `signal` | in forof (line 150); reaches spawn | **NOT-WORTH** | ≤ 3 launchers, each signalled and re-checked live |
| 155 | `close` | repeat-io | `running` | in for (line 153); reaches fs | **NOT-WORTH** | ≤ 3 launchers, each signalled and re-checked live |
| 184 | `withLaunchersClosed` | repeat-io | `plan` | in forof (line 183); reaches spawn,fs | **NOT-WORTH** | ≤ 3 launchers, each signalled and re-checked live |
| 185 | `withLaunchersClosed` | repeat-io | `close` | in forof (line 183); reaches fs,spawn | **NOT-WORTH** | ≤ 3 launchers, each signalled and re-checked live |

#### electron/main/games/proton.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 42 | `walk` | repeat-io | `readlinkSync` | in forof (line 38); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 46 | `walk` | repeat-io | `walk` | in forof (line 38); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 63 | `protonBuilds` | repeat-io | `hasBuild` | in .filter (line 63); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 108 | `buildVersion` | repeat-io | `readFileSync` | in forof (line 106); reaches fs | **ADD-CACHE** | same build's `version` file read again per game (x builds for the target pick); memoize `buildVersion` per scan = LOOP_PASS Batch 3 (one fix covers both rows) |
| 143 | `pickBuild` | repeat-io | `buildVersionKey` | in .flatMap (line 142); reaches fs | **ADD-CACHE** | same build's `version` file read again per game (x builds for the target pick); memoize `buildVersion` per scan = LOOP_PASS Batch 3 (one fix covers both rows) |
| 187 | `installProton` | repeat-io | `cleanStaging` | in forof (line 187); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 191 | `installProton` | repeat-io | `hasBuild` | in forof (line 191); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 224 | `installProton` | repeat-io | `hasBuild` | in forof (line 223); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |

#### electron/main/games/running.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 47 | `<module>` | module | `uidRe` | { uid: number; re: RegExp; } \| null; memo by lazy | **OK** | key=the process uid; invalidated=rebuilt when the uid differs; bound=1 entry |
| 50 | `<module>` | module | `plainOrphans` | Set<string>; written by .add .delete | **OK** | key=<proc root>/<pid>:<name>; invalidated=each pass forgets orphans that are gone (a reused pid has a new name or is re-read); bound=live orphan processes without a launch variable |
| 102 | `readProcs` | repeat-io | `readFileSync` | in forof (line 96); reaches fs | **NOT-WORTH** | a different /proc file per process; must be fresh every pass |
| 105 | `readProcs` | repeat-io | `readFull` | in forof (line 96); reaches fs | **NOT-WORTH** | a different /proc file per process; must be fresh every pass |
| 121 | `readProcs` | closure | `memo` | Map<number, boolean>; written by a nested function (.set), looked up with .get | **OK** | key=pid; invalidated=per readProcs call; bound=the user's processes in one pass |
| 145 | `readProcs` | closure | `seenPlain` | Set<string>; written by a nested function (.add), looked up with .has | **OK** | key=<proc root>/<pid>:<name>; invalidated=per readProcs call (prunes plainOrphans); bound=the user's orphans in one pass |
| 162 | `readProcs` | repeat-io | `wineExe` | in forof (line 161); reaches fs | **NOT-WORTH** | a different /proc file per process; must be fresh every pass |
| 162 | `readProcs` | repeat-io | `launched` | in forof (line 161); reaches fs | **NOT-WORTH** | a different /proc file per process; must be fresh every pass |
| 164 | `readProcs` | repeat-io | `readFull` | in forof (line 161); reaches fs | **NOT-WORTH** | a different /proc file per process; must be fresh every pass |
| 259 | `walk` | repeat-io | `walk` | in forof (line 257); reaches fs | **NOT-WORTH** | a different /proc file per process; must be fresh every pass |
| 285 | `RunningGameWatcher` | field | `pending` | { key: string \| null; since: number; } \| null; memo by timestamp | **OK** | key=none (the candidate running game); invalidated=replaced on every change, cleared on stop(); bound=1 entry. debounce state, settleMs |
| 288 | `RunningGameWatcher` | field | `exeCache` | Map<string, Set<string>>; written by .set | **FIX-STALE** | key=install folder; invalidated=never (lives as long as the watcher); bound=installed games' folders. Windows: a folder indexed while the game was still installing, or before an update renamed its .exe, stays wrong until the app restarts, so Playing is never detected; re-index when the candidate list changes (each scan) or on a miss |
| 316 | `start` | poll-io | `setInterval` | every this.everyMs; reaches fs | **NOT-WORTH** | the read is the freshness check (which game runs now); the first pass is already cheap (stat + status of own processes) |
| 357 | `apply` | ttl | `now - this.pending.since >= this.settleMs` |  | **OK** | debounce: a change must hold for settleMs |

#### electron/main/games/schemeHandler.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 252 | `schemeHandlerExec` | repeat-io | `readFile` | in forof (line 250); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |

#### electron/main/games/service.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 65 | `GamesService` | field | `latest` | { name: string; tarball: { url: string; size: number; sha256: string; …; memo by name | **OK** | key=none (the published Proton build); invalidated=refreshed on each scan (5 s timeout); the last known one is kept when offline; bound=1 entry |
| 102 | `GamesService` | field | `hdrCache` | { at: number; value: Promise<HdrSystem>; } \| null; memo by name | **OK** | key=none (the HDR check); invalidated=3 s TTL (HDR_CACHE_MS); bound=1 entry |
| 105 | `hdrCheck` | ttl | `now - this.hdrCache.at > HDR_CACHE_MS` |  | **OK** | HDR check reused for 3 s (several pages scan at once) |
| 172 | `GamesService` | field | `lastGames` | GameEntry[]; written by = | **OK** | key=none (the last scan's games); invalidated=replaced by every scan; bound=games in the library |
| 174 | `GamesService` | field | `lastStores` | WindowsStores \| undefined; memo by name | **OK** | key=none (Windows store listing); invalidated=replaced by every scan; bound=1 entry |
| 176 | `GamesService` | field | `lastDetails` | Map<string, GameDetails>; written by = | **OK** | key=game key; invalidated=replaced by every scan; bound=games in the library |
| 226 | `GamesService` | field | `colors` | Map<string, string \| null>; written by .clear .set | **ADD-CACHE** | key=game key; invalidated=cleared by every scan; bound=games in the library. over-invalidated: with the Glass look every tile whose art has loaded asks for its color, so each scan (every Games page open, every apply) decodes every cover again, synchronously on the main process (nativeImage full decode + resize); key it by art file + mtime and keep it across scans |
| 260 | `undo > exclusive(cb)` | dup-read | `owners` | 2× this.backups.owners(backupId) (lines 260, 262) | **NOT-WORTH** | small manifest read twice on Undo |
| 268 | `undo > exclusive(cb)` | repeat-io | `cards` | in .some (line 268); reaches fs | **NOT-WORTH** | N ≤ 2 controllers, on Undo only |
| 277 | `undo > exclusive(cb)` | repeat-io | `restoreDualSenseMixer` | in forof (line 277); reaches fs | **NOT-WORTH** | N ≤ 2 controllers, on Undo only |

#### electron/main/games/steam.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 70 | `findSteamInstalls` | repeat-io | `realpathSync` | in forof (line 67); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 74 | `findSteamInstalls` | repeat-io | `existsSync` | in forof (line 67); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 76 | `findSteamInstalls` | repeat-io | `newestLocalConfig` | in forof (line 67); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |
| 127 | `steamAppManifests` | repeat-io | `readdirSync` | in forof (line 122); reaches fs | **ADD-CACHE** | every app manifest is read and parsed twice per scan (listSteamGames, then gameDetails); share one read per scan = LOOP_PASS Batch 3 |
| 133 | `steamAppManifests` | repeat-io | `readVdfFile` | in forof (line 132); reaches fs | **ADD-CACHE** | every app manifest is read and parsed twice per scan (listSteamGames, then gameDetails); share one read per scan = LOOP_PASS Batch 3 |
| 176 | `valveProtons` | repeat-io | `protonBuilds` | in .flatMap (line 176); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |

#### electron/main/games/system.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 84 | `findProAudioRules` | repeat-io | `readdirSync` | in forof (line 80); reaches fs | **NOT-WORTH** | one file per rules/config folder or sound card, per scan |
| 91 | `findProAudioRules` | repeat-io | `readFileSync` | in forof (line 89); reaches fs | **NOT-WORTH** | one file per rules/config folder or sound card, per scan |
| 114 | `findGlobalSdlVars` | repeat-io | `readdirSync` | in forof (line 111); reaches fs | **NOT-WORTH** | one file per rules/config folder or sound card, per scan |
| 125 | `findGlobalSdlVars` | repeat-io | `readFileSync` | in forof (line 122); reaches fs | **NOT-WORTH** | one file per rules/config folder or sound card, per scan |
| 149 | `hidrawAccess` | repeat-io | `readFileSync` | in forof (line 147); reaches fs | **NOT-WORTH** | one file per rules/config folder or sound card, per scan |
| 152 | `hidrawAccess` | repeat-io | `accessSync` | in forof (line 147); reaches fs | **NOT-WORTH** | one file per rules/config folder or sound card, per scan |
| 249 | `findDualSenseAlsaCards` | repeat-io | `readFileSync` | in forof (line 243); reaches fs | **NOT-WORTH** | one file per rules/config folder or sound card, per scan |
| 255 | `findDualSenseAlsaCards` | repeat-io | `realpathSync` | in forof (line 243); reaches fs | **NOT-WORTH** | one file per rules/config folder or sound card, per scan |

#### electron/main/games/windowsStores.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 85 | `readEpicGames` | repeat-io | `readFileSync` | in forof (line 83); reaches fs | **NOT-WORTH** | a different file per game/install/folder, read once per scan |

#### electron/main/index.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 40 | `<module>` | module | `settings` | DesktopSettings; memo by io | **OK** | key=none (settings.json); invalidated=write-through: updateSetting saves the file; bound=1 entry |
| 108 | `start` | poll-io | `setInterval` | every UPDATE_INTERVAL_MS; reaches net,fs | **OK** | the update check itself, every 6 h (only with automatic checks on) |

#### electron/main/officialFirmware.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 60 | `OfficialFirmwareSource` | field | `cached` | { at: number; latest: OfficialFirmware; } \| null; memo by name | **OK** | key=none (Sony's one info file, all models); invalidated=24 h TTL; Refresh refetches when over 1 min old; bound=1 entry |
| 62 | `OfficialFirmwareSource` | field | `pending` | Promise<OfficialFirmwareLookup> \| null; memo by ??= | **OK** | key=none (the request in flight); invalidated=cleared when it settles; bound=1 entry |
| 74 | `lookup` | ttl | `age < (asked ? FORCE_MIN_AGE_MS : OFFICIAL_FIRMWARE_TTL_MS)` |  | **OK** | Sony info: 1 day, manual refresh at most once a minute |

#### electron/main/updater.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 77 | `Updater` | field | `manifest` | { app: { version: string; platforms: { linux?: { url: string; size: nu…; memo by io | **FIX-STALE** | key=none (the feed of the channel at check time); invalidated=each update check (6 h; never with automatic checks off); bound=1 entry. downloadFirmware uses it without refetching, though the firmware offer was read from a fresh feed: the board can get an older build than the one shown, or the other channel's after a switch; pass the fresh feed's firmware to the download |
| 80 | `Updater` | field | `installedPath` | string \| null; memo by io | **OK** | key=none (the installed update); invalidated=replaced by the next install; used once on restart; bound=1 entry |

#### src/components/LanguageToggle.tsx

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 63 | `LanguageToggle > onClick=` | storage | `"i18nextLng"` | 1 site(s): src/components/LanguageToggle.tsx:63 setItem | **OK** | explicit language choice; i18next's own detector cache is off (`caches: []`) |

#### src/components/ThemeToggle.tsx

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 24 | `readStoredTheme` | storage | `"ds5-bridge-theme"` | 2 site(s): src/components/ThemeToggle.tsx:24 getItem, src/components/ThemeToggle.tsx:69 setItem | **OK** | a user preference, not a cache: one value, written when the user changes it (usePref keeps every reader in sync) |
| 63 | `<module>` | module | `currentTheme` | Theme \| null; memo by ??= | **OK** | key=none (the stored theme); invalidated=set by setTheme (writes localStorage too); bound=1 entry |
| 91 | `useApplyTheme` | effect-io | `getDesktopPalette onDesktopPalette` | deps [theme, desktop, shade]; reaches ipc | **OK** | subscribes or reads once per mount; main answers from memory |
| 118 | `ThemeToggle` | useCallback | `setTo` | deps [setTheme] | **REMOVE** | returns a new closure on every call (`setTo("light")` in JSX), so the memo saves nothing |

#### src/desktop/AppRail.tsx

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 34 | `AppRail` | storage | `"ds5.railPinned"` | 1 site(s): src/desktop/AppRail.tsx:34 useFlagPref | **OK** | a user preference, not a cache: one value, written when the user changes it (usePref keeps every reader in sync) |
| 35 | `AppRail` | storage | `"ds5.glass"` | 5 site(s): src/desktop/AppRail.tsx:35 useFlagPref, src/desktop/DesktopApp.tsx:144 useFlagPref, src/desktop/library/GameLibrary.tsx:71 useFlagPref, src/desktop/live/ControllerView.tsx:160 useFlagPref, src/desktop/live/PartPanel.tsx:1148 useFlagPref | **OK** | a user preference, not a cache: one value, written when the user changes it (usePref keeps every reader in sync) |

#### src/desktop/AutoUpdateAsk.tsx

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 14 | `AutoUpdateAsk` | effect-io | `getSettings setInterval` | deps []; reaches ipc,storage | **NOT-WORTH** | settings live in main's memory: one IPC per mount |
| 17 | `AutoUpdateAsk > useEffect(cb)` | poll-io | `setInterval` | every 1000; reaches storage | **NOT-WORTH** | one querySelector + one localStorage read a second; nothing to cache. (It keeps running after the ask is answered: noted under Found along the way) |
| 19 | `AutoUpdateAsk > useEffect(cb) > setInterval(cb)` | ttl | `Date.now() - started > ASK_AFTER_MS` |  | **OK** | delay before the ask, not a cache |

#### src/desktop/colorPicker/ColorPicker.tsx

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 19 | `useRecentColors > useState(cb)` | storage | `"ds5.recentColors"` | 3 site(s): src/desktop/colorPicker/ColorPicker.tsx:19 readPref, src/desktop/colorPicker/ColorPicker.tsx:28 readPref, src/desktop/colorPicker/ColorPicker.tsx:28 writePref | **OK** | capped recent list (addRecent) |
| 28 | `useRecentColors` | useCallback | `add` | deps [] | **OK** | returned by a hook: callers put it in deps / effects |
| 111 | `ColorPopover` | ref | `last` | MutableRefObject<string>; name | **OK** | key=none (last applied hex); invalidated=each pick; bound=1 entry |

#### src/desktop/colorVision.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 44 | `<module>` | snapshot | `stored` | string \| null; read once: storage | **OK** | key=ds5.colorVision; invalidated=read once at load; setColorVision updates the module value and the pref together; bound=1 entry |
| 44 | `<module>` | storage | `"ds5.colorVision"` | 2 site(s): src/desktop/colorVision.ts:44 readPref, src/desktop/colorVision.ts:74 writePref | **OK** | a user preference, not a cache: one value, written when the user changes it (usePref keeps every reader in sync) |

#### src/desktop/DesktopApp.tsx

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 55 | `DesktopApp > useEffect(cb)` | storage | `"ds5.hadDongle"` | 2 site(s): src/desktop/DesktopApp.tsx:55 writePref, src/desktop/SetupScreen.tsx:30 readPref | **OK** | a user preference, not a cache: one value, written when the user changes it (usePref keeps every reader in sync) |
| 57 | `DesktopApp` | effect-io | `trackBoard` | deps [bridge.identity]; reaches storage | **OK** | subscribes or reads once per mount; main answers from memory |
| 145 | `DesktopApp` | storage | `"ds5.accent"` | 2 site(s): src/desktop/DesktopApp.tsx:145 usePref, src/desktop/live/PartPanel.tsx:1200 usePref | **OK** | a user preference, not a cache: one value, written when the user changes it (usePref keeps every reader in sync) |
| 149 | `DesktopApp` | useMemo | `controllerColors` | deps [liveIdentity?.colorwayCode, liveIdentity?.model, customColors] | **OK** | colorway lookup + merge, stable object for the accent effects |
| 165 | `DesktopApp` | effect-io | `reportStatus` | deps [connected, controllerOn, liveIdentity, firmware, power, battery]; reaches ipc | **OK** | subscribes or reads once per mount; main answers from memory |
| 181 | `DesktopApp` | effect-io | `then readNarrator setNarrator` | deps [client, fwNarrator, narrator, i18n.resolvedLanguage]; reaches hid | **NOT-WORTH** | reads the board when the client or the view changes; the answer must be the board's current one |
| 196 | `DesktopApp` | effect-io | `then setTrayIcon` | deps [connected, controllerOn, charging, lightbarKey, darkTaskbar]; reaches ipc | **OK** | subscribes or reads once per mount; main answers from memory |
| 209 | `DesktopApp` | effect-io | `onTrayCommand` | deps [switchSlot]; reaches ipc | **OK** | subscribes or reads once per mount; main answers from memory |
| 439 | `useDarkTaskbar` | effect-io | `getDesktopPalette onDesktopPalette` | deps []; reaches ipc | **OK** | subscribes or reads once per mount; main answers from memory |
| 465 | `useWhatsNew > useState(cb)` | storage | `"ds5-last-seen-version"` | 3 site(s): src/desktop/DesktopApp.tsx:465 getItem, src/desktop/DesktopApp.tsx:466 setItem, src/desktop/DesktopApp.tsx:474 setItem | **OK** | a user preference, not a cache: one value, written when the user changes it (usePref keeps every reader in sync) |
| 491 | `useGamesAttention` | ref | `last` | MutableRefObject<GamesReport \| null>; name | **OK** | key=none (the last games report); invalidated=each scan; cleared when Games consent is turned off; bound=1 report |
| 492 | `useGamesAttention > useCallback(cb)` | repeat-io | `loadDeclined` | in .filter (line 492); reaches storage | **ADD-CACHE** | N = recommended fixes (tens) per recount: the same localStorage key read and JSON-parsed once per fix; read it once before the filter (Batch 4) |
| 492 | `useGamesAttention` | useCallback | `recount` | deps [] | **OK** | returned by a hook: callers put it in deps / effects |
| 493 | `useGamesAttention` | useCallback | `update` | deps [recount] | **OK** | returned by a hook: callers put it in deps / effects |
| 500 | `useGamesAttention` | effect-io | `then getSettings gamesScan update` | deps [supported, update]; reaches ipc,storage | **OK** | one scan at startup for the badge, only with consent |
| 517 | `useGamesAttention` | effect-io | `onGamesAllowed` | deps [recount]; reaches storage | **OK** | subscribes or reads once per mount; main answers from memory |
| 528 | `useGamesAttention` | useCallback | `setAllowed` | deps [] | **OK** | returned by a hook: callers put it in deps / effects |

#### src/desktop/devPreview.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 34 | `useFakeSlots` | storage | `"ds5.dev.fakeSlots"` | 1 site(s): src/desktop/devPreview.ts:34 useFlagPref | **OK** | developer preference (dev builds), not a cache |
| 36 | `useFakeSlots` | storage | `"ds5.dev.fakeSlot"` | 1 site(s): src/desktop/devPreview.ts:36 usePref | **OK** | developer preference (dev builds), not a cache |
| 53 | `simulatedDongleOn` | storage | `"ds5.dev.simulated"` | 3 site(s): src/desktop/devPreview.ts:53 readPref, src/desktop/live/PartPanel.tsx:1291 useFlagPref, src/desktop/live/PartPanel.tsx:1333 writePref | **OK** | developer preference (dev builds), not a cache |
| 59 | `simulatedCore1Stage` | storage | `"ds5.dev.simCore1Stage"` | 3 site(s): src/desktop/devPreview.ts:59 readPref, src/desktop/live/PartPanel.tsx:1292 usePref, src/desktop/live/PartPanel.tsx:1344 writePref | **OK** | developer preference (dev builds), not a cache |
| 64 | `useDevPreview` | storage | `"ds5.dev.model"` | 1 site(s): src/desktop/devPreview.ts:64 usePref | **OK** | developer preference (dev builds), not a cache |
| 65 | `useDevPreview` | storage | `"ds5.dev.colorway"` | 1 site(s): src/desktop/devPreview.ts:65 usePref | **OK** | developer preference (dev builds), not a cache |
| 75 | `useShownIdentity` | useMemo | `(inline)` | deps [id, model, colorway, active, fake] | **OK** | stable object returned by a hook (consumers' deps don't change every render) |
| 86 | `useDevToolsShown` | storage | `"ds5.devTools"` | 1 site(s): src/desktop/devPreview.ts:86 usePref | **OK** | developer preference (dev builds), not a cache |

#### src/desktop/dongle/DongleConsole.tsx

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 39 | `DongleConsole` | ref | `seen` | MutableRefObject<number>; name | **OK** | key=none (newest log line seen); invalidated=while the log tab is open; bound=1 number |
| 129 | `useOledFrame` | effect-io | `tick` | deps [client, enabled]; reaches hid | **NOT-WORTH** | reads the board when the client or the view changes; the answer must be the board's current one |
| 150 | `tick` | poll-io | `setTimeout` | every wait; reaches hid | **NOT-WORTH** | live board state; a cached answer would be stale by design (window-shown gate already stops it while hidden) |
| 217 | `useDongleLog` | ref | `prev` | MutableRefObject<{ client: boolean; on: boolean; slot: number \| null; …; name | **OK** | key=none (the previous status); invalidated=each status change; bound=1 entry |

#### src/desktop/dongle/DongleDashboard.tsx

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 59 | `useDongleTelemetry` | ref | `history` | MutableRefObject<Sample[]>; collection | **OK** | key=sample time; invalidated=sliding window; bound=HISTORY = 60 samples |
| 62 | `useDongleTelemetry` | ref | `prev` | MutableRefObject<{ at: number; usb: number; bt: number; mic: number; l…; name | **OK** | key=none (previous counters); invalidated=each 1 s sample; bound=1 entry |
| 67 | `useDongleTelemetry` | poll-io | `usePoll` | every 1000; reaches hid | **NOT-WORTH** | live board state; a cached answer would be stale by design (window-shown gate already stops it while hidden) |

#### src/desktop/games/launcherCheck.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 17 | `useFreshRunning` | effect-io | `gamesRunningLaunchers` | deps [key]; reaches ipc | **OK** | subscribes or reads once per mount; main answers from memory |
| 54 | `<module>` | module | `applied` | Map<string, number>; written by .set .clear | **OK** | key=fix id; invalidated=cleared on Undo; entries older than RECENT_MS are ignored, not removed; bound=distinct fix ids applied this session |
| 71 | `overwrittenBy` | ttl | `now - at < RECENT_MS` |  | **OK** | 15 min window for 'a launcher took the change back' |

#### src/desktop/glass/useGlass.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 11 | `useGlass` | useCallback | `(inline)` | deps [glassRef] | **OK** | returned by a hook: callers put it in deps / effects |

#### src/desktop/glass/useLiquidGlass.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 14 | `useLiquidGlass` | useCallback | `ref` | deps [] | **OK** | returned by a hook: callers put it in deps / effects |

#### src/desktop/glass/useSpecular.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 8 | `<module>` | module | `elements` | Set<HTMLElement>; written by .add .delete | **OK** | key=element; invalidated=removed on unmount; bound=mounted glass elements |
| 10 | `<module>` | module | `frame` | number; memo by lazy | **OK** | key=none (the pending rAF id); invalidated=cleared when the frame runs; bound=1 entry. a frame handle, not a cache |

#### src/desktop/hardwareName.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 13 | `lastBoardName` | storage | `"ds5.lastBoard"` | 2 site(s): src/desktop/hardwareName.ts:13 readPref, src/desktop/hardwareName.ts:24 writePref | **OK** | the last board's name for wording while none is connected; rewritten on every connect |

#### src/desktop/library/ContinuePlaying.tsx

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 66 | `useGlassBar` | useMemo | `tokens` | deps [glass, artColor] | **OK** | glass tokens per art color, not per render |

#### src/desktop/library/gameArt.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 31 | `useArtColor` | effect-io | `gameArtColor` | deps [key, enabled]; reaches ipc | **OK** | the client side; main keeps the color per game (GamesService.colors, whose over-invalidation is Batch 2) |

#### src/desktop/library/GameLibrary.tsx

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 34 | `useHiddenKinds > useState(cb)` | storage | `"ds5.libraryHiddenKinds"` | 2 site(s): src/desktop/library/GameLibrary.tsx:34 readPref, src/desktop/library/GameLibrary.tsx:42 writePref | **OK** | a user preference, not a cache: one value, written when the user changes it (usePref keeps every reader in sync) |
| 68 | `GameLibrary` | storage | `"ds5.librarySort"` | 1 site(s): src/desktop/library/GameLibrary.tsx:68 usePref | **OK** | a user preference, not a cache: one value, written when the user changes it (usePref keeps every reader in sync) |
| 73 | `GameLibrary` | useMemo | `kindCounts` | deps [report] | **OK** | one pass over the report's games per scan |
| 88 | `GameLibrary` | effect-io | `gamesDetails` | deps [desktop, report]; reaches ipc | **OK** | main answers from the last scan (no file reads) |
| 92 | `GameLibrary` | useMemo | `games` | deps [report, sort, details] | **OK** | sort of the library per report/sort/details change |
| 98 | `GameLibrary` | useMemo | `recent` | deps [report, details, hiddenKinds] | **OK** | filter + sort per report/details change |
| 106 | `GameLibrary` | useMemo | `searched` | deps [games, query, hiddenKinds] | **OK** | filter per keystroke, not per render |

#### src/desktop/library/GameTile.tsx

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 70 | `GameTile` | useMemo | `tokens` | deps [glass, artColor] | **OK** | glass tokens per art color, not per render |

#### src/desktop/library/useDebouncedSave.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 26 | `useDebouncedSave` | useCallback | `cancel` | deps [] | **OK** | returned by a hook: callers put it in deps / effects |
| 41 | `useDebouncedSave` | useCallback | `set` | deps [ms] | **OK** | returned by a hook: callers put it in deps / effects |

#### src/desktop/library/useGameProfile.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 118 | `useGameProfile` | useCallback | `switchOnce` | deps [] | **OK** | returned by a hook: callers put it in deps / effects |
| 143 | `useGameProfile` | effect-io | `libraryGet gamesRunning onRunningGame` | deps [desktop]; reaches ipc | **OK** | subscribes or reads once per mount; main answers from memory |
| 178 | `useGameProfile` | effect-io | `switchOnce` | deps [ desktop, loaded, runningKnown, isConnected, config, operation, paused, wanted, library, applyBody, active, switchOnce, client, layouts, edgeExtras, curvesSupported, slot, gameTemporary, appliedStamp, retry, t, ]; reaches ipc,hid | **NOT-WORTH** | reads the board when the client or the view changes; the answer must be the board's current one |
| 280 | `useGameProfile` | useCallback | `saveToProfile` | deps [desktop, editing, active, config, library, normal, buttonsDraft, curvesDirty, curvesDraft, t] | **OK** | returned by a hook: callers put it in deps / effects |
| 317 | `useGameProfile` | useCallback | `revertToProfile` | deps [active, profile, config, applyBody, normal, buttonsDraft] | **OK** | returned by a hook: callers put it in deps / effects |
| 326 | `useGameProfile` | useCallback | `switchSlot` | deps [client, applyBody, switchOnce] | **OK** | returned by a hook: callers put it in deps / effects |
| 347 | `useGameProfile` | useCallback | `clearError` | deps [] | **OK** | returned by a hook: callers put it in deps / effects |
| 348 | `useGameProfile` | useCallback | `startEditing` | deps [] | **OK** | returned by a hook: callers put it in deps / effects |
| 349 | `useGameProfile` | useCallback | `stopEditing` | deps [] | **OK** | returned by a hook: callers put it in deps / effects |

#### src/desktop/live/ArtBackdrop.tsx

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 27 | `useBackground` | storage | `"ds5.background"` | 1 site(s): src/desktop/live/ArtBackdrop.tsx:27 usePref | **OK** | a user preference, not a cache: one value, written when the user changes it (usePref keeps every reader in sync) |
| 27 | `useBackground` | storage | `"ds5.artBackdropOff"` | 1 site(s): src/desktop/live/ArtBackdrop.tsx:27 readPref | **OK** | a user preference, not a cache: one value, written when the user changes it (usePref keeps every reader in sync) |
| 50 | `useBackdropKeys` | storage | `"ds5.dev.backdropGame"` | 1 site(s): src/desktop/live/ArtBackdrop.tsx:50 readPref | **OK** | developer preference (dev builds), not a cache |
| 55 | `useBackdropKeys` | effect-io | `load gamesRunning onRunningGame` | deps [desktop]; reaches ipc | **OK** | subscribes or reads once per mount; main answers from memory |

#### src/desktop/live/Calibration.tsx

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 45 | `Calibration` | ref | `samples` | MutableRefObject<{ at: number; r: InputReport; }[]>; collection | **OK** | key=sample time; invalidated=reset at each step; bound=one step (≤ 5 s at ~30 Hz) |

#### src/desktop/live/controllerAccent.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 56 | `<module>` | module | `controllerCode` | string \| null; memo by lazy | **OK** | key=none (the shown controller's colorway); invalidated=set on every controller change; bound=1 entry. current state with subscribers |

#### src/desktop/live/ControllerInfo.tsx

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 85 | `ControllerInfo` | effect-io | `then officialControllerFirmware loadControllerInfo` | deps [client, supported, connected, loadTry]; reaches ipc,hid | **OK** | main caches Sony's answer for a day |
| 320 | `<module>` | memo | `ControllerInfo` | React.memo | **OK** | skips re-rendering on each ~30 Hz live frame |

#### src/desktop/live/ControllerView.tsx

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 54 | `ControllerView` | poll-io | `usePoll` | every 1000; reaches hid | **NOT-WORTH** | live board state; a cached answer would be stale by design (window-shown gate already stops it while hidden) |
| 100 | `ControllerView` | useMemo | `remapped` | deps [remap.device] | **OK** | set of remapped parts per remap change (live frames don't rebuild it) |
| 130 | `ControllerView` | storage | `"ds5.panelHidden"` | 1 site(s): src/desktop/live/ControllerView.tsx:130 useFlagPref | **OK** | a user preference, not a cache: one value, written when the user changes it (usePref keeps every reader in sync) |
| 138 | `ControllerView` | effect-io | `getSettings` | deps []; reaches ipc | **NOT-WORTH** | settings live in main's memory: one IPC per mount |

#### src/desktop/live/customColors.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 81 | `useCustomColors` | storage | `"ds5.customColors.on"` | 1 site(s): src/desktop/live/customColors.ts:81 useFlagPref | **OK** | a user preference, not a cache: one value, written when the user changes it (usePref keeps every reader in sync) |
| 82 | `useCustomColors` | storage | `"ds5.customColors"` | 1 site(s): src/desktop/live/customColors.ts:82 useRawPref | **OK** | a user preference, not a cache: one value, written when the user changes it (usePref keeps every reader in sync) |
| 83 | `useCustomColors` | useMemo | `colors` | deps [raw] | **OK** | JSON parse of the custom colors per change |
| 84 | `useCustomColors` | useCallback | `setColors` | deps [setRaw] | **OK** | returned by a hook: callers put it in deps / effects |
| 93 | `useControllerColors` | useMemo | `(inline)` | deps [code, model, active] | **OK** | stable object returned by a hook (consumers' deps don't change every render) |

#### src/desktop/live/LiveController.tsx

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 92 | `LiveArt` | ref | `parts` | MutableRefObject<Map<PartId, SVGGraphicsElement>>; collection | **OK** | key=part id; invalidated=per mount; the art is keyed by model, so another model remounts; bound=≈ 30 parts |
| 95 | `LiveArt` | ref | `baseTransform` | MutableRefObject<Map<PartId, string>>; collection | **OK** | key=part id; invalidated=per mount (keyed by model); bound=≈ 30 parts |
| 100 | `LiveArt` | ref | `triggerStops` | MutableRefObject<Record<"l2" \| "r2", Element[]>>; DOM lookup kept | **OK** | key=trigger (l2/r2); invalidated=per mount (keyed by model); bound=2 lists of gradient stops |
| 103 | `LiveArt` | ref | `padBox` | MutableRefObject<{ x: number; y: number; w: number; h: number; } \| nul…; DOM lookup kept | **OK** | key=none (the touchpad's box); invalidated=per mount (keyed by model); bound=1 entry |

#### src/desktop/live/LiveData.tsx

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 164 | `Spark` | ref | `history` | MutableRefObject<[number, number, number][]>; collection | **OK** | key=sample order; invalidated=sliding window; bound=HISTORY = 150 points |
| 166 | `Spark` | ref | `colors` | MutableRefObject<SparkColors \| null>; memo by ??= | **OK** | key=none (the spark colors); invalidated=cleared on theme change; bound=1 entry |

#### src/desktop/live/PartPanel.tsx

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 286 | `<module>` | memo | `AllButtonsSection` | React.memo | **OK** | ~340 options not rebuilt per live frame (loop pass Batch 1) |
| 409 | `<module>` | memo | `ButtonLayoutsSection` | React.memo | **OK** | layouts not re-sorted per live frame (loop pass Batch 1) |
| 416 | `ButtonLayoutsSection` | useMemo | `layouts` | deps [library.layouts] | **OK** | sort per library change, not per live frame (loop pass Batch 1) |
| 418 | `ButtonLayoutsSection` | useMemo | `uses` | deps [library.games] | **OK** | one pass over the games per library change (loop pass Batch 1) |
| 592 | `LevelMeter` | poll-io | `usePoll` | every 120; reaches hid | **NOT-WORTH** | live board state; a cached answer would be stale by design (window-shown gate already stops it while hidden) |
| 597 | `LevelMeter > usePoll(cb)` | ttl | `now - hold.current.at > 1500` |  | **OK** | peak hold on the mic meter (1.5 s) |
| 649 | `AppSettings` | effect-io | `getSettings` | deps []; reaches ipc | **NOT-WORTH** | settings live in main's memory: one IPC per mount |
| 785 | `GameLaunchersSetting` | effect-io | `getSettings` | deps []; reaches ipc | **NOT-WORTH** | settings live in main's memory: one IPC per mount |
| 974 | `MicTest` | useCallback | `stopAll` | deps [] | **OK** | used in another hook's deps or passed to a child that depends on it |
| 1219 | `ReduceMotionSetting` | storage | `"ds5.reduceMotion"` | 3 site(s): src/desktop/live/PartPanel.tsx:1219 useFlagPref, src/desktop/motion.ts:9 useFlagPref, src/desktop/motion.ts:20 useFlagPref | **OK** | a user preference, not a cache: one value, written when the user changes it (usePref keeps every reader in sync) |
| 1228 | `DevChannelDialog` | effect-io | `devChannelPreview` | deps [onCancel]; reaches ipc | **NOT-WORTH** | once when the dialog/card opens; rare |

#### src/desktop/live/slotSettings.tsx

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 33 | `useSlotSettings` | useCallback | `loaded` | deps [] | **OK** | returned by a hook: callers put it in deps / effects |

#### src/desktop/live/speakerPlayer.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 23 | `<module>` | module | `running` | Promise<void> \| null; memo by ??= | **OK** | key=none (the playback in progress); invalidated=cleared when it ends; bound=1 entry |

#### src/desktop/live/StickCurves.tsx

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 174 | `CurveGraph` | useMemo | `path` | deps [curve] | **OK** | curve SVG path per curve (loop pass Batch 1) |

#### src/desktop/live/StickTestCards.tsx

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 68 | `StickTests` | useMemo | `driftResults` | deps [drift, sticks] | **OK** | drift stats per finished test (loop pass Batch 1) |
| 70 | `StickTests` | ref | `samples` | MutableRefObject<[DriftSample[], DriftSample[]]>; collection | **OK** | key=stick; invalidated=reset when a drift test starts; bound=DRIFT_MS = 10 s at ~30 Hz, 2 sticks |
| 237 | `<module>` | memo | `DriftPlot` | React.memo | **OK** | two ~300-point paths once per finished test (loop pass Batch 1) |

#### src/desktop/live/SwirlField.tsx

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 195 | `<module>` | module | `gpuOk` | boolean \| null; memo by lazy | **OK** | key=none (does the shader build); invalidated=never; hardware acceleration changes need a restart; bound=1 entry |
| 215 | `SwirlField` | effect-io | `getSettings` | deps []; reaches ipc | **NOT-WORTH** | settings live in main's memory: one IPC per mount |
| 229 | `SwirlField` | ref | `palette` | MutableRefObject<Rgb[]>; collection | **OK** | key=none (the swirl colors); invalidated=rebuilt when the colors or theme change; bound=4 colors |

#### src/desktop/live/useRemap.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 45 | `useRemap` | effect-io | `readRemapExtra readRemap` | deps [client, temporary, reloadKey]; reaches hid | **NOT-WORTH** | reads the board when the client or the view changes; the answer must be the board's current one |
| 74 | `useRemap` | useMemo | `device` | deps [state] | **OK** | decoded remap per state change |
| 76 | `useRemap` | useCallback | `apply` | deps [client, draft, state, t, extraDevice, extraDraft] | **OK** | returned by a hook: callers put it in deps / effects |
| 106 | `useRemap` | useCallback | `setTarget` | deps [] | **OK** | returned by a hook: callers put it in deps / effects |
| 107 | `useRemap` | useCallback | `revert` | deps [device, extraDevice] | **OK** | returned by a hook: callers put it in deps / effects |
| 111 | `useRemap` | useCallback | `resetAll` | deps [] | **OK** | returned by a hook: callers put it in deps / effects |
| 116 | `useRemap` | useCallback | `load` | deps [] | **OK** | returned by a hook: callers put it in deps / effects |
| 121 | `useRemap` | useCallback | `setExtra` | deps [] | **OK** | returned by a hook: callers put it in deps / effects |
| 125 | `useRemap` | useMemo | `(inline)` | deps [client, supported, device, draft, extraDevice, extraDraft, busy, error, setTarget, apply, revert, resetAll, load, setExtra, loaded, temporary] | **OK** | stable object returned by a hook (consumers' deps don't change every render) |

#### src/desktop/lookKnobs.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 33 | `readKnob` | storage | `prefKey(k)` | 2 site(s): src/desktop/lookKnobs.ts:33 readPref, src/desktop/lookKnobs.ts:38 usePref | **OK** | a user preference, not a cache: one value, written when the user changes it (usePref keeps every reader in sync) |
| 39 | `useKnob` | useCallback | `setNumber` | deps [k, set] | **OK** | returned by a hook: callers put it in deps / effects |

#### src/desktop/narrator.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 114 | `<module>` | module | `current` | HTMLAudioElement \| null; memo by lazy | **OK** | key=none (the clip playing); invalidated=replaced or cleared when a clip ends; bound=1 element |

#### src/desktop/pages/AboutPage.tsx

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 84 | `AboutPage` | effect-io | `firmwareChangelog` | deps [tab, firmware]; reaches ipc | **NOT-WORTH** | fetched when the About changelog tab opens; rare |

#### src/desktop/pages/GamesPage.tsx

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 44 | `loadDeclined` | storage | `"ds5-games-declined"` | 2 site(s): src/desktop/pages/GamesPage.tsx:44 readPref, src/desktop/pages/GamesPage.tsx:51 writePref | **OK** | declined fix ids; bounded by the fixes the scan can offer; read per recount (see the repeat-io row in DesktopApp) |
| 56 | `useMsg` | useCallback | `(inline)` | deps [t] | **OK** | returned by a hook: callers put it in deps / effects |
| 98 | `useRestartText` | useCallback | `(inline)` | deps [t] | **OK** | returned by a hook: callers put it in deps / effects |
| 131 | `GamesPage` | useCallback | `scanned` | deps [onScanned] | **OK** | used in another hook's deps or passed to a child that depends on it |
| 199 | `GamesSetup` | useCallback | `receive` | deps [desktop, onScanned] | **OK** | used in another hook's deps or passed to a child that depends on it |
| 213 | `GamesSetup` | useCallback | `rescan` | deps [desktop, receive, latest] | **OK** | used in another hook's deps or passed to a child that depends on it |
| 227 | `GamesSetup` | effect-io | `then gamesScan receive` | deps [desktop, receive, latest]; reaches ipc | **NOT-WORTH** | a full scan on each Games page open, by design (the page shows the launchers' files as they are now); the scan's cost is LOOP_PASS Batch 3 |
| 237 | `GamesSetup` | effect-io | `onProtonProgress` | deps [desktop]; reaches ipc | **OK** | subscribes or reads once per mount; main answers from memory |
| 240 | `GamesSetup` | effect-io | `rescan` | deps [rescanToken, rescan]; reaches ipc | **OK** | subscribes or reads once per mount; main answers from memory |
| 244 | `GamesSetup` | useMemo | `fixes` | deps [report] | **OK** | flattens the report's fixes per scan |

#### src/desktop/pages/SettingsPage.tsx

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 42 | `useGripTest` | useCallback | `run` | deps [client, timed] | **OK** | returned by a hook: callers put it in deps / effects |
| 74 | `useGripTest > useCallback(cb)` | repeat-io | `gripTest` | in for (line 71); reaches hid | **NOT-WORTH** | each step is its own HID test |

#### src/desktop/pages/SlotsPage.tsx

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 18 | `readMemory` | storage | `"ds5.slotControllers"` | 2 site(s): src/desktop/pages/SlotsPage.tsx:18 readPref, src/desktop/pages/SlotsPage.tsx:73 writePref | **NOT-WORTH** | growth source: one entry per controller ever seen in a slot, never pruned (~100 bytes each; a handful in practice). Also parsed on every Slots render (1.5 s poll); useRawPref + useMemo would parse once per change |
| 40 | `SlotsPage` | poll-io | `usePoll` | every 1500; reaches hid | **NOT-WORTH** | live board state; a cached answer would be stale by design (window-shown gate already stops it while hidden) |

#### src/desktop/SetupScreen.tsx

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 39 | `SetupScreen` | effect-io | `latestFirmware` | deps [pico, firmware]; reaches ipc | **NOT-WORTH** | one feed fetch when a board in BOOTSEL shows up (or the card opens) while the firmware to offer is unknown; rare |
| 124 | `UpdatesWithoutDongle` | effect-io | `latestFirmware` | deps [desktop]; reaches ipc | **NOT-WORTH** | one feed fetch when a board in BOOTSEL shows up (or the card opens) while the firmware to offer is unknown; rare |

#### src/desktop/storage.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 40 | `usePref` | useCallback | `set` | deps [key] | **OK** | returned by a hook: callers put it in deps / effects |
| 55 | `useFlagPref` | useCallback | `(inline)` | deps [set] | **OK** | returned by a hook: callers put it in deps / effects |
| 69 | `useRawPref` | useCallback | `set` | deps [key] | **OK** | returned by a hook: callers put it in deps / effects |

#### src/desktop/tour/Tour.tsx

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 25 | `tourDone` | storage | `"ds5.tourDone"` | 2 site(s): src/desktop/tour/Tour.tsx:25 readPref, src/desktop/tour/Tour.tsx:29 writePref | **OK** | a user preference, not a cache: one value, written when the user changes it (usePref keeps every reader in sync) |
| 123 | `Tour` | useCallback | `go` | deps [onView] | **OK** | used in another hook's deps or passed to a child that depends on it |
| 175 | `Tour` | effect-io | `previewTrigger` | deps [onTriggerStep, client]; reaches hid | **NOT-WORTH** | reads the board when the client or the view changes; the answer must be the board's current one |
| 181 | `Tour` | useCallback | `answer` | deps [go] | **OK** | used in another hook's deps or passed to a child that depends on it |
| 250 | `Tour` | useCallback | `finish` | deps [] | **OK** | used in another hook's deps or passed to a child that depends on it |
| 265 | `Tour` | effect-io | `answer` | deps [input, go, finish, answer]; reaches ipc | **OK** | subscribes or reads once per mount; main answers from memory |

#### src/desktop/tray/trayIcon.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 38 | `<module>` | module | `artPromise` | Promise<ImageBitmap> \| null; memo by name | **FIX-STALE** | key=none (the decoded tray art); invalidated=never, also not after a failed decode; bound=1 bitmap. a rejected decode is kept, so the tray icon stays blank for the session; clear it on rejection |

#### src/desktop/updatePreview.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 20 | `useUpdatePreview` | storage | `"ds5.dev.updates"` | 1 site(s): src/desktop/updatePreview.ts:20 usePref | **OK** | developer preference (dev builds), not a cache |

#### src/desktop/UsbAccessSetup.tsx

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 13 | `UsbAccessSetup` | effect-io | `usbAccessInstalled` | deps [desktop]; reaches ipc | **NOT-WORTH** | once when the dialog/card opens; rare |

#### src/desktop/useLiveInput.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 29 | `useLiveInput` | effect-io | `poll` | deps [active, client]; reaches hid | **NOT-WORTH** | reads the board when the client or the view changes; the answer must be the board's current one |
| 60 | `poll` | poll-io | `setTimeout` | every POLL_MS; reaches hid | **NOT-WORTH** | live board state; a cached answer would be stale by design (window-shown gate already stops it while hidden) |
| 82 | `useLiveLightbar` | effect-io | `poll` | deps [active, client]; reaches hid | **NOT-WORTH** | reads the board when the client or the view changes; the answer must be the board's current one |
| 98 | `poll` | poll-io | `setTimeout` | every LIGHTBAR_MS; reaches hid | **NOT-WORTH** | live board state; a cached answer would be stale by design (window-shown gate already stops it while hidden) |

#### src/desktop/useUpdates.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 12 | `useAppUpdate` | effect-io | `getUpdateState onUpdateState` | deps []; reaches ipc | **OK** | subscribes or reads once per mount; main answers from memory |
| 24 | `useFirmwareHold` | effect-io | `getFirmwareHold onFirmwareHold` | deps []; reaches ipc | **OK** | subscribes or reads once per mount; main answers from memory |
| 68 | `useFirmwareUpdate` | useCallback | `refreshLatest` | deps [] | **OK** | returned by a hook: callers put it in deps / effects |
| 81 | `useFirmwareUpdate` | effect-io | `latestFirmware` | deps [appUpdate.phase]; reaches ipc | **ADD-CACHE** | fetches the update feed (+ .sig) fresh on every call: useFirmwareUpdate asks on every update phase change (idle, checking, result = 2-3 fetches per check) next to the updater's own fetch of the same feed; reuse a feed fetched under ~60 s ago (Batch 1) |
| 99 | `useFirmwareUpdate` | useCallback | `start` | deps [appUpdate.phase, bridge.client, state.phase] | **OK** | returned by a hook: callers put it in deps / effects |

#### src/desktop/WindowsUsbRepair.tsx

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 27 | `WindowsUsbRepair` | poll-io | `usePoll` | every POLL_MS; reaches usb | **NOT-WORTH** | the poll is the check (has Windows let the app at the board yet) |

#### src/hooks/useDs5Bridge.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 80 | `useDs5Bridge` | useMemo | `issues` | deps [draft] | **OK** | config validation per draft change |
| 85 | `useDs5Bridge` | useMemo | `statusText` | deps [client, isDirty, operation, saveState, supported, t] | **OK** | cheap, but keeps the status string stable for memoized children |
| 95 | `useDs5Bridge` | useCallback | `detach` | deps [] | **OK** | returned by a hook: callers put it in deps / effects |
| 105 | `useDs5Bridge` | useCallback | `attachTransport` | deps [] | **OK** | returned by a hook: callers put it in deps / effects |
| 133 | `useDs5Bridge` | useCallback | `attach` | deps [attachTransport] | **OK** | returned by a hook: callers put it in deps / effects |
| 138 | `useDs5Bridge` | useCallback | `autoConnect` | deps [attach, attachTransport, supported] | **OK** | returned by a hook: callers put it in deps / effects |
| 149 | `useDs5Bridge` | useCallback | `connect` | deps [attach] | **OK** | returned by a hook: callers put it in deps / effects |
| 157 | `useDs5Bridge` | useCallback | `run` | deps [] | **OK** | returned by a hook: callers put it in deps / effects |
| 173 | `useDs5Bridge` | useCallback | `readConfig` | deps [run] | **OK** | returned by a hook: callers put it in deps / effects |
| 184 | `useDs5Bridge` | useCallback | `applyConfig` | deps [draft, issues.length, run] | **OK** | returned by a hook: callers put it in deps / effects |
| 197 | `useDs5Bridge` | useCallback | `saveToFlash` | deps [config, isDirty, run] | **OK** | returned by a hook: callers put it in deps / effects |
| 206 | `useDs5Bridge` | useCallback | `revertToSaved` | deps [run, savedConfig] | **OK** | returned by a hook: callers put it in deps / effects |
| 216 | `useDs5Bridge` | useCallback | `applyBody` | deps [run] | **OK** | returned by a hook: callers put it in deps / effects |
| 228 | `useDs5Bridge` | useCallback | `reconnectUsb` | deps [run] | **OK** | returned by a hook: callers put it in deps / effects |
| 230 | `useDs5Bridge` | useCallback | `setPowerFlags` | deps [run] | **OK** | returned by a hook: callers put it in deps / effects |
| 240 | `useDs5Bridge` | useCallback | `setDraftField` | deps [] | **OK** | returned by a hook: callers put it in deps / effects |
| 245 | `useDs5Bridge` | useCallback | `resetDraft` | deps [config] | **OK** | returned by a hook: callers put it in deps / effects |
| 252 | `useDs5Bridge` | effect-io | `autoConnect` | deps [autoConnect]; reaches storage,hid,usb | **NOT-WORTH** | reads the board when the client or the view changes; the answer must be the board's current one |
| 268 | `useDs5Bridge` | effect-io | `setTimeout` | deps [client]; reaches hid | **NOT-WORTH** | reads the board when the client or the view changes; the answer must be the board's current one |
| 291 | `poll` | poll-io | `setTimeout` | every 1000; reaches hid | **NOT-WORTH** | live board state; a cached answer would be stale by design (window-shown gate already stops it while hidden) |

#### src/protocol/bridgeClient.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 363 | `Ds5BridgeClient` | field | `protocol` | { major: number; minor: number; features3: number; } \| null; memo by io | **OK** | key=the client (one per connected board); invalidated=every identity read (the 1 s poll); a new board makes a new client; bound=1 entry |
| 426 | `runCommand` | repeat-io | `identity` | in for (line 423); reaches hid | **NOT-WORTH** | a wait: polls the board until the command or test finishes; every read must be fresh |
| 666 | `runControllerTest` | repeat-io | `readControllerHeader` | in for (line 665); reaches hid | **NOT-WORTH** | a wait: polls the board until the command or test finishes; every read must be fresh |
| 672 | `runControllerTest` | repeat-io | `getReport` | in for (line 671); reaches hid | **NOT-WORTH** | a wait: polls the board until the command or test finishes; every read must be fresh |

#### src/protocol/stickCurve.ts

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 129 | `<module>` | module | `nodeCache` | WeakMap<StickCurve, Nodes \| null>; written by .set | **OK** | key=curve object (curves are immutable); invalidated=garbage-collected with the curve (WeakMap); bound=live curve objects |

### Firmware (`MarcelineVPQ/DS5Dongle-OLED-Edition`, read-only)

#### src/audio.cpp

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 77 | `-` | fw-static | `g_mic_last_decoded` | static volatile int32_t g_mic_last_decoded = 0; // opus_decode return value | **OK** | a last/previous value for a delta or a change check (bound 1), not a cache of anything |
| 78 | `-` | fw-static | `g_mic_last_want` | static volatile uint16_t g_mic_last_want = 0; // bytes we asked TinyUSB to send | **OK** | a last/previous value for a delta or a change check (bound 1), not a cache of anything |
| 79 | `-` | fw-static | `g_mic_last_wrote` | static volatile uint16_t g_mic_last_wrote = 0; // bytes TinyUSB accepted | **OK** | a last/previous value for a delta or a change check (bound 1), not a cache of anything |
| 104 | `-` | fw-static | `g_mic_last_real_us` | static volatile uint32_t g_mic_last_real_us = 0; // core1 writes, core0 reads (32-bit: no teari | **OK** | a last/previous value for a delta or a change check (bound 1), not a cache of anything |
| 667 | `-` | fw-static | `last_out_us` | static uint32_t last_out_us = 0; | **OK** | a last/previous value for a delta or a change check (bound 1), not a cache of anything |

#### src/bt.cpp

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 77 | `-` | fw-table | `feature_data` | unordered_map<uint8_t, vector<uint8_t> > feature_data; | **OK** | key=feature report id; invalidated=cleared on disconnect, bt_drop_feature per id, refreshed by GET; bound=≤ 256 ids (a handful used). The per-call `bt_peek_feature` copy is LOOP_PASS Batch 2 |

#### src/cmd.cpp

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 103 | `-` | fw-static | `s_last_func` | static uint8_t s_last_func = 0; | **OK** | a last/previous value for a delta or a change check (bound 1), not a cache of anything |
| 104 | `-` | fw-static | `s_last_result` | static uint8_t s_last_result = CMD_RESULT_OK; | **OK** | a last/previous value for a delta or a change check (bound 1), not a cache of anything |
| 594 | `-` | fw-static | `cached_real_khz` | static uint32_t cached_real_khz = 0; | **OK** | key=none; invalidated=never (clk_sys is fixed at boot); bound=1. Measured lazily on the first 0xFC GET |

#### src/oled.cpp

| Line | Function | Kind | Name | Found | Verdict | Why |
|---|---|---|---|---|---|---|
| 904 | `-` | fw-static | `prev_us_frames` | static uint32_t prev_us_frames = 0, prev_bt_packets = 0, prev_mic_frames = 0, prev_bt31 = 0; | **OK** | a last/previous value for a delta or a change check (bound 1), not a cache of anything |
| 905 | `-` | fw-static | `prev_sample_us` | static uint32_t prev_sample_us = 0; | **OK** | a last/previous value for a delta or a change check (bound 1), not a cache of anything |
| 1051 | `-` | fw-static | `cached_real_khz` | static uint32_t cached_real_khz = 0; | **REMOVE** | a second copy of cmd.cpp's measured clock, re-measured (busy-wait of a few ms on core0) on every CPU-screen entry though clk_sys never changes; share one lazy measurement with cmd.cpp |
| 2052 | `-` | fw-static | `seen_gen` | static uint32_t seen_gen = 0; | **OK** | a last/previous value for a delta or a change check (bound 1), not a cache of anything |
| 2141 | `-` | fw-static | `last_rendered_screen` | static int last_rendered_screen = -1; | **OK** | a last/previous value for a delta or a change check (bound 1), not a cache of anything |

