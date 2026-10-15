# Lifetime pass: every acquisition, where it is released

_2026-10-13. Done per CLAUDE.md "Lifetime pass" (the AVIEW pass pattern, applied to resource lifetimes). This is the one doc for both repos: the firmware's CLAUDE.md links here. The code changes are the verdict comments (one per acquisition), the two listers, the leak test, one one-line fix and batch 1 (approved by the owner). Everything else is proposed in batches below; the owner picks which to do. **2026-10-15 (branch `passes-095`):** batch 2 is done (its last two rows went with earlier work, see below) and batch 4 (tidy) is done; batch 3 is firmware and waits for a firmware task with hardware tests. The app table was re-run (436 acquisitions: OK 402, NOT-WORTH 34, no LEAK, WASTE or HOT-ALLOC)._

## How the list was made

Two listers, one per repo. Each lists every candidate mechanically; nothing is sampled by eye.

**App** (`tools/list_lifetimes.mjs`, TypeScript compiler API with the type checker; it shares the program and AST helpers with the loop and cache passes (`tools/list_loops.mjs`, `tools/list_caches.mjs`) through `tools/ts_program.mjs`). It walks `src/` and `electron/` (tests and the vendored `src/flash/picoflash` excluded) and lists every:

- **listener**: `addEventListener`; `.on` / `.once` / `.addListener` / `.prependListener` on Node and Electron emitters (`ipcMain`, `ipcRenderer`, `app`, windows, child processes, streams, sockets, tray, `nativeTheme`); an `onX = handler` property (`navigator.usb.onconnect`, a worklet port's `onmessage`, an `Audio` element's `onended`).
- **subscribe**: the app's own `onX(listener)` calls that return an unsubscribe (`window.desktop.on*` from the preload, `onThemeChange`, `onGamesAllowed`); the type checker confirms the call returns a function.
- **ipc**: `ipcMain.handle`.
- **timer**: `setInterval`, `setTimeout` (marked `rearm` when the callback calls the function that armed it), `requestAnimationFrame`.
- **poll**: `usePoll`.
- **media**: `getUserMedia`, `AudioContext`, `audioWorklet.addModule`, `AudioWorkletNode`, media stream sources, `new Audio`.
- **observer**: `ResizeObserver`, `MutationObserver`, `IntersectionObserver`, `PerformanceObserver`.
- **device**: WebUSB/HID `open` / `claimInterface` / `connect` (the type checker confirms the receiver is a USB/HID device or the PICOBOOT handle), `requestDevice` (WebUSB and WebGPU).
- **process**: `spawn` / `exec` / `execFile` / `fork` (not the `*Sync` forms), with `+systemd-run` when it starts a unit.
- **watcher**: `fs.watch` / `fs.watchFile`.
- **socket**: `net` / `tls` / `http(s)` servers and connections, `WebSocket`, `dgram`. (None in the app.)
- **electron**: `BrowserWindow`, `Tray`, `Menu.buildFromTemplate`, `Notification`, `powerSaveBlocker`, `globalShortcut`, `protocol.handle`, `Worker`, `MessageChannel`.
- **url**: `URL.createObjectURL`. (None in the app.)
- **effect**: every `useEffect` / `useLayoutEffect`, with whether it returns a cleanup on all paths, some (an early return that acquired nothing) or none.

Each row also says where it runs: `module` (module scope: lives as long as the page or the process), `effect`, `effect-cleanup`, `render` (a component or hook body) or `-` (an ordinary function or handler).

**Firmware** (`tools/list_lifetimes.py` in the firmware repo; standard library only; it reuses `tools/list_loops.py`'s brace-aware scanner and call graph, so "Runs on" means the same as in the loop pass: `core1`, `core0-loop`, `callback`, `isr`, `boot`). It lists every `malloc` / `calloc` / `realloc` / `new` / `make_unique` and the SDK and library calls that allocate (`queue_init`, `opus_*_create`, the resampler's `Prealloc`); every `std::vector` / `string` / `map` / `unordered_map` object (local, static or global), every function that returns one by value and every call that gets one from such a function (a temporary copy); container growth (`push_back`, `assign`, `insert`, `map[key] =`, ...); timers and alarms (`add_alarm_*`, `add_repeating_timer_*`, BTstack timers: none in `src/`); and handler registrations (`hci_add_event_handler`, `l2cap_register_service`, IRQ handlers). `lib/` is excluded.

**Every row has exactly one verdict**, written as a comment on the acquisition (`// lifetime: VERDICT — release point or reason`, on its line or in the comment block right above; `{/* lifetime: … */}` in JSX). The gates fail on a row without one: `npm run gates` (and so `npm run check` and CI) here, `build.yml` / `release.yml` in the firmware. Line numbers in the tables are as of this commit; if code moves, the function name finds the row.

| Verdict | App | Firmware | Meaning |
|---|---|---|---|
| OK | 325 | 5 | Released, and the comment names where: an effect cleanup (unmount, deps change), a `stop()` / `close()` / `off()`, the window closing, a device disconnect, "fires once". |
| LEAK | 2 | 0 | Never released, or released too late. The impact is stated. |
| WASTE | 0 (4 fixed) | 0 | Keeps running while the window is hidden or after it is no longer needed (the lean rule). |
| HOT-ALLOC | 2 | 3 | Acquired or allocated per frame, per render or per main-loop pass. |
| NOT-WORTH | 33 | 31 | One per app or per boot and lives until quit / reset by design (Electron's IPC handlers, BTstack registrations, core1's Opus state), or rare and small (a copy per host request). The reason is stated. |
| **Total** | **362** | **39** | |

App rows per kind:

| Kind | OK | LEAK | WASTE | HOT-ALLOC | NOT-WORTH | Total |
|---|---|---|---|---|---|---|
| device | 3 | 1 | 0 | 0 | 2 | 6 |
| effect | 143 | 1 | 0 | 2 | 0 | 146 |
| electron | 2 | 0 | 0 | 0 | 2 | 4 |
| ipc | 0 | 0 | 0 | 0 | 7 | 7 |
| listener | 66 | 0 | 0 | 0 | 16 | 82 |
| media | 8 | 0 | 0 | 0 | 0 | 8 |
| observer | 10 | 0 | 0 | 0 | 0 | 10 |
| poll | 6 | 0 | 0 | 0 | 0 | 6 |
| process | 20 | 0 | 0 | 0 | 0 | 20 |
| subscribe | 15 | 0 | 0 | 0 | 1 | 16 |
| timer | 52 | 0 | 0 | 0 | 4 | 56 |
| watcher | 0 | 0 | 0 | 0 | 1 | 1 |
| **Total** | 325 | 2 | 0 | 2 | 33 | 362 |

Where the app rows run: 152 in a render (mostly the effects themselves), 67 inside an effect body, 2 at module scope, 141 in ordinary functions and handlers (the main process, the preload, `micTest.ts`, `speakerPlayer.ts`, the firmware flash). Firmware rows: 14 on core0's main loop (2 of them also from a callback), 11 in TinyUSB / BTstack callbacks, 4 on core1, 9 at boot, 1 at file scope.

## What the pass found

**No resource is lost per mount on any main page or panel.** The leak test below mounts and unmounts each of them 50 times and every count comes back to where it started. The findings are a failure path that keeps a USB session, a dev-only GPU device, UI timers that keep running when nothing needs them, and a few allocations per frame or per main-loop pass.

**Real leaks (LEAK; the first is fixed in batch 1):**

- **Fixed in batch 1 (2026-10-13):** `src/desktop/firmwareUpdate.ts` `flash`: the firmware write opens a PICOBOOT session (`device.connect()`) and only ended it by rebooting the board at the end. If an erase/write threw partway, nothing called `disconnect()`, so the board's interface stayed claimed until it was unplugged and a retry in the same app run couldn't claim it. Now `disconnect()` runs in a `finally` (success and every failure), the error says in plain words what happened and what to do (7 languages; the USB error is kept as its `cause`), and `tests/unit/firmwareFlash.test.ts` fails a fake board mid-write and checks the release and a working retry. The row is OK now. It doesn't explain the open "{{device}} busy: Unable to claim interface" row: that is the running board held by another app, a different USB device from the bootloader.
- **Fixed in batch 4 (2026-10-15):** `src/desktop/dev/HdrTest.tsx:23, 31` `GpuSwatch`: the HDR test swatch requested a WebGPU device per mount and never called `device.destroy()`; the cleanup only stopped the drawing. Dev builds only (the Developer card). Now the effect keeps the device and destroys it in the cleanup, or at once when it arrives after the unmount (`tests/integration/devHdrTest.test.ts`).

**Waste under the lean rule (WASTE; all three fixed 2026-10-13, owner-approved for dev.10, rows now OK; `tests/integration/hiddenWork.test.ts` proves each stops and fails on the old code):**

- `src/desktop/AutoUpdateAsk.tsx:15, 19` `AutoUpdateAsk`: a 1 Hz interval runs a `document.querySelector(".tour-card")` and a state update for the app's whole life: after the question is answered (the component renders nothing then) and while the window is hidden or in the tray. Fix: run it only while unanswered, not yet due and shown (`useWindowShown`), and stop once due.
- `src/desktop/live/StickTestCards.tsx:40` `StickTests`: the circularity sampler (`setInterval`, 33 ms) keeps ticking while the window is hidden, as long as the Calibration view is mounted; the input is frozen then, so each tick only re-serializes the calibration (`JSON.stringify`). Fix: gate it on `useWindowShown()`.
- `src/desktop/tour/Tour.tsx:330` `tick`: the hold-to-continue ring's animation frame loop re-arms every frame for the whole of a controller step of the tour, even with no button held. It already stops when hidden. Fix: start it on a press, stop on release or when the ring fills.

**Allocations on a hot path (HOT-ALLOC):**

- **Gone (2026-10-15 re-run):** `src/desktop/live/ControllerView.tsx:183` `ControllerView`: the panel-toggle effect had no dependency list (removed when the panel toggle moved to the rail, `27a1fec`), so it removes and re-adds its `window` listener on every render: ~30 times a second while live input is on screen. Fix: keep `collapsed`, `hidePanel` and `onView` in a ref and give the effect `[]`.
- **Done (2026-10-15 re-run):** `src/desktop/dongle/DongleConsole.tsx:171` `OledCanvas`: a new 128×64 `ImageData` (32 KB) per OLED mirror frame (~10 Hz while the Pico page shows the screen). It is allocated once and refilled now (`8cbe329`, the mirror repaints only on a change).
- Firmware `src/cmd.cpp:193` `controller_info_task` (colorway Scrub, 1 s per connection), `src/ctrl_info.cpp:165` and `:179` `ctrl_test_task` (the scrub window, and a running test up to 3 s): `bt_peek_feature(0x81)` returns a copy of the cached reply (`std::vector`, ≤ 64 B) and these call it on every core0 pass while a reply sits in the cache. Bounded windows, but heap traffic on core0's loop. Fix: a peek that doesn't allocate (`bt_feature_view(id, &len)` returning a pointer into the cache, or a copy into the caller's stack buffer).

**A correction to the loop pass.** `docs/LOOP_PASS_2026-10.md` batch 2 lists "a heap allocation every pass until feature report 0x05 arrives" (`calib_service`, `imu_cal_service`). There is none: before 0x05 arrives `bt_peek_feature` returns an empty `std::vector`, which doesn't touch the heap; once it has arrived each function copies it once and sets its done flag (`g_bias_known`, `g_imu_cal_tried`). Both rows are OK here.

**Worth knowing (NOT-WORTH rows with a cheap fix, for a tidy batch):**

- `src/protocol/webUsbTransport.ts:65, 68`: `close()` is never called; the dongle handle and its claimed interface live for the connection and go on disconnect. A failed attach (an incompatible firmware) leaves the interface claimed; the next attach re-claims it without harm. Check together with the PICOBOOT leak above.
- **Fixed in batch 4 (2026-10-15):** `electron/main/games/service.ts:90` `refreshLatest`: the 5 s timeout in a `Promise.race` wasn't cleared after a fast answer (one per scan, then gone). It is cleared in a `finally` now (`tests/unit/tidyLifetimes.test.ts`).
- **Fixed in batch 4 (2026-10-15):** `electron/main/index.ts:288`: `watchDesktopPalette` returned a stop function that the caller dropped (one per app, until quit). index.ts keeps it and calls it at `will-quit`, and the stop also clears a pending 300 ms debounce (`tests/unit/tidyLifetimes.test.ts`).
- Firmware `get_feature_data()` returns a copy even for the callers that only want the request sent (`(void) get_feature_data(…)`: colorway polls every 40 ms, test re-asks, Edge profile fetches, ≤ 25 a second for a few seconds per connection). A `bt_request_feature()` that returns nothing would drop those copies.

**One one-line fix made in this pass:** `src/desktop/useLiveInput.ts:58`: a live-input read that finished after the cleanup could schedule one more animation frame after unmount or hide; it now checks `live` first (`if (live && !frame) frame = requestAnimationFrame(paint);`).

## The leak test (the gate)

`tests/integration/leaks.test.ts` (in `npm test`, so in `npm run check` and CI), with the probe in `tests/support/leakProbe.ts`. For each page it does one warm-up mount and unmount (module-level stores wire once per app by design: the window-shown store, i18n, the theme watcher), takes a snapshot, then mounts and unmounts it 50 times, letting 1.5 s of fake time pass while it's open and 15 s after it's gone (so every one-shot timer fires), and expects the snapshot to come back exactly:

- **listeners** on `window`, `document`, attached elements and other targets (media queries, the media devices). A listener on an element that has left the document goes with the element (React puts `load`, `invalid` and `toggle` on the element itself), so those don't count.
- **timers**: pending timeouts, intervals and animation frames (vitest's fake timers).
- **microphone tracks** not stopped, **AudioContexts** not closed, **observers** still observing (Resize, Mutation, Intersection).
- **`window.desktop` subscriptions** not unsubscribed (every `on*` of the faked preload returns its unsubscribe and is counted).

The pages, with the simulated dongle (`SimulatedDongle`, the dev-build board) behind the app's real connection hook (`useDs5Bridge`, plus the update hooks): the controller view, the Pico page, App settings, Calibration, the Speaker panel, the Mic panel with the Mic Test running when it unmounts (the test checks the mic and its AudioContext are open first), Games Home (30 games) and a game page. Each test also checks that the page holds something the probe sees while it is open, and a self-test mounts a component that forgets six cleanups and checks the probe reports each one. Breaking one cleanup on purpose (the controller view's tour listener) fails six of the page tests with `listener window "ds5:start-tour": 1 -> 51`. It takes ~15 s.

What it doesn't cover: work that keeps running while a page is still mounted but hidden (the three WASTE fixes have their own test, `tests/integration/hiddenWork.test.ts`), the Electron main process (no DOM, lives until quit) and GPU objects (jsdom has no canvas/WebGL/WebGPU; the GPU code's own disposal is in the tables: `SwirlField`'s `dispose()`, `HdrGlow`'s textures).

## The work: proposed changes in 4 batches (biggest effect first)

Batch 1 and batch 2's three WASTE items are done (2026-10-13); the rest is still to do. Each change keeps the current behaviour and needs a test that pins it; the leak test must keep passing.

| Batch | What | Rows | Why first |
|---|---|---|---|
| 1. The firmware update's USB session (**done**, 2026-10-13) | End the PICOBOOT session when a write fails (`disconnect()` in a `finally`, done); check the dongle handle after a failed attach (`WebUsbTransport.close()` unused) and whether either explains "Unable to claim interface" | `firmwareUpdate.ts:79`; `webUsbTransport.ts:65, 68` | A user-visible failure (a retry that can't claim the board) on the update path |
| 2. Every frame and every second on screen (**done**: WASTE items 2026-10-13, the other two with earlier work, checked 2026-10-15) | The controller view's panel-toggle effect gets stable deps; the OLED mirror reuses one `ImageData`; the stick-test sampler stops while hidden (done); Auto-update's 1 Hz check stops once answered and while hidden (done); the tour's hold ring runs only while held (done) | `ControllerView.tsx:183`, `DongleConsole.tsx:171`, `StickTestCards.tsx:40`, `AutoUpdateAsk.tsx:15, 19`, `Tour.tsx:330` | Runs whenever the app is open (two of them while hidden) |
| 3. Firmware: no heap on core0's loop | A non-allocating feature peek for the 0x81 callers; a `bt_request_feature()` without a copy for the fire-and-forget callers | `cmd.cpp:193`, `ctrl_info.cpp:165, 179`; the `get_feature_data` NOT-WORTH rows | Bounded windows per connection, so smaller; heap use on core0 is worth removing anyway |
| 4. Tidy (**done**, 2026-10-15, branch `passes-095`) | The HDR test's GPU device destroyed (dev only); `refreshLatest`'s timeout cleared; the palette watcher's stop kept | `HdrTest.tsx:23, 31`, `service.ts:90`, `index.ts:288` | Dev-only or once per app |

## Full tables

### Firmware (`DS5Dongle`, `python3 tools/list_lifetimes.py --md`)

#### src/audio.cpp

| Line | Function | Runs on | Kind | What | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 610 | `audio_init` | boot | heap | queue_init | **NOT-WORTH** | boot, once per firmware run; the queue lives until reset |
| 613 | `audio_init` | boot | heap | queue_init | **NOT-WORTH** | boot, once per firmware run; the queue lives until reset |
| 615 | `audio_init` | boot | heap | queue_init | **NOT-WORTH** | boot, once per firmware run; the queue lives until reset |
| 620 | `audio_init` | boot | heap | queue_init | **NOT-WORTH** | boot, once per firmware run; the queue lives until reset |
| 622 | `audio_init` | boot | heap | queue_init | **NOT-WORTH** | boot, once per firmware run; the queue lives until reset |
| 726 | `core1_entry` | core1 | heap | opus_encoder_create | **NOT-WORTH** | once at core1 start; the encoder lives as long as core1 (never restarted) |
| 729 | `core1_entry` | core1 | heap | opus_encoder_create | **NOT-WORTH** | once at core1 start; the encoder lives as long as core1 (never restarted) |
| 745 | `core1_entry` | core1 | heap | Prealloc | **OK** | once at core1 start, sized for audio_loop's 512-in/480-out frame, so it never grows |
| 752 | `core1_entry` | core1 | heap | opus_decoder_create | **NOT-WORTH** | once at core1 start; the decoder lives as long as core1 (never restarted) |

#### src/bt.cpp

| Line | Function | Runs on | Kind | What | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 78 | `<file>` | - | container | static unordered_map feature_data | **OK** | cleared on disconnect (feature_data.clear()); ≤ ~10 report ids × ≤ 64 B meanwhile |
| 273 | `bt_l2cap_init` | boot | register | l2cap_register_service | **NOT-WORTH** | boot; BTstack keeps the service for the firmware's life |
| 275 | `bt_l2cap_init` | boot | register | l2cap_register_service | **NOT-WORTH** | boot; BTstack keeps the service for the firmware's life |
| 282 | `bt_init` | boot | heap | queue_init | **NOT-WORTH** | boot, once per firmware run; the queue lives until reset |
| 304 | `bt_init` | boot | register | hci_add_event_handler | **NOT-WORTH** | boot; one registration for the firmware's life |
| 625 | `l2cap_packet_handler` | callback | grow | assign | **OK** | reuses the id's buffer (same size each reply); new ids only until disconnect clears |
| 812 | `get_feature_data` | callback+core0-loop | container | returns vector by value: get_feature_data() | **NOT-WORTH** | a ≤ 64 B copy per request (≤ 25/s, a few s per connect); fire-and-forget callers could skip it |
| 845 | `bt_peek_feature` | callback+core0-loop | container | returns vector by value: bt_peek_feature() | **NOT-WORTH** | copies on every call; empty (no heap) until the report arrives; hot callers have rows |
| 867 | `init_feature` | callback | container | temporary from get_feature_data() | **NOT-WORTH** | once per connection |
| 869 | `init_feature` | callback | container | temporary from get_feature_data() | **NOT-WORTH** | once per connection |
| 871 | `init_feature` | callback | container | temporary from get_feature_data() | **NOT-WORTH** | once per connection |
| 876 | `init_feature` | callback | container | temporary from get_feature_data() | **NOT-WORTH** | once per connection |

#### src/calib.cpp

| Line | Function | Runs on | Kind | What | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 171 | `calib_service` | core0-loop | container | temporary from bt_peek_feature() | **OK** | no heap until 0x05 arrives (empty vector), then one copy per connection (g_bias_known) |

#### src/cmd.cpp

| Line | Function | Runs on | Kind | What | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 170 | `controller_info_task` | core0-loop | container | local vector r | **NOT-WORTH** | every 40 ms for ≤ 2 s per connection (colorway read) |
| 187 | `controller_info_task` | core0-loop | container | temporary from get_feature_data() | **NOT-WORTH** | a discarded copy every 40 ms for ≤ 2 s per connection |
| 193 | `controller_info_task` | core0-loop | container | local vector r | **HOT-ALLOC** | copies 0x81 every core0 pass for 1 s per connect while a foreign reply sits there |

#### src/ctrl_info.cpp

| Line | Function | Runs on | Kind | What | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 165 | `ctrl_test_task` | core0-loop | container | temporary from bt_peek_feature() | **HOT-ALLOC** | copies 0x81 every core0 pass during the scrub window when a reply is cached |
| 179 | `ctrl_test_task` | core0-loop | container | local vector r | **HOT-ALLOC** | copies 0x81 every core0 pass while a test runs (≤ 3 s) and a reply is cached |
| 196 | `ctrl_test_task` | core0-loop | container | temporary from get_feature_data() | **NOT-WORTH** | a discarded copy per re-ask (every 150 ms, ≤ 3 s per test) |
| 208 | `ctrl_info_get` | callback | container | local vector fw | **NOT-WORTH** | per app GET 0xEB (the Controller info card, a few per second at most) |
| 210 | `ctrl_info_get` | callback | container | local vector patch | **NOT-WORTH** | per app GET 0xEB (the Controller info card, a few per second at most) |
| 229 | `ctrl_info_get` | callback | container | local vector fw | **NOT-WORTH** | per app GET 0xEB (the Controller info card, a few per second at most) |

#### src/dse.cpp

| Line | Function | Runs on | Kind | What | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 49 | `start_fetch` | core0-loop | container | temporary from get_feature_data() | **NOT-WORTH** | a discarded copy per Edge profile fetch step (a few per connect / save) |
| 111 | `dse_task` | core0-loop | container | local vector fw | **NOT-WORTH** | once per Edge unlock |
| 140 | `dse_task` | core0-loop | container | temporary from get_feature_data() | **NOT-WORTH** | a discarded copy per save status poll (a few per save) |
| 152 | `dse_task` | core0-loop | container | temporary from get_feature_data() | **NOT-WORTH** | a discarded copy per Edge profile fetch step (a few per connect / save) |

#### src/main.cpp

| Line | Function | Runs on | Kind | What | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 324 | `get_report_impl` | callback | container | local vector real | **NOT-WORTH** | per host GET feature report (the PC asks a few times per connect) |
| 365 | `get_report_impl` | callback | container | temporary from get_feature_data() | **NOT-WORTH** | a discarded copy per host GET of an Edge profile before they're ready |
| 370 | `get_report_impl` | callback | container | local vector feature_data | **NOT-WORTH** | per host GET feature report (the PC asks a few times per connect) |

#### src/oled.cpp

| Line | Function | Runs on | Kind | What | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 1196 | `imu_cal_service` | core0-loop | container | temporary from bt_peek_feature() | **OK** | no heap until 0x05 arrives (empty vector), then one copy per connection (g_imu_cal_tried) |

### App (`node tools/list_lifetimes.mjs --md`)

#### electron/main/desktopTheme.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 76 | `portalAccent > <anonymous>` | process | execFile gdbus | - | **OK** | exits on its own; the 2 s timeout kills a hung gdbus |
| 129 | `fire` | timer | setTimeout | - | **OK** | one-shot 300 ms debounce, cleared by the next fire() |
| 136 | `watchDesktopPalette` | watcher | watch | - | **OK** | closed by the returned stop, which index.ts calls at quit (will-quit) |
| 144 | `watchDesktopPalette` | listener | nativeTheme.on "updated" | - | **OK** | removed by the returned stop; one per app, lives until quit |
| 146 | `watchDesktopPalette` | listener | systemPreferences.on "accent-color-changed" | - | **OK** | removed by the returned stop; one per app, lives until quit |

#### electron/main/download.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 52 | `downloadVerified > <anonymous>` | listener | file.on "error" | - | **OK** | goes with the stream: ended on success, destroyed on any failure |
| 66 | `downloadVerified > <anonymous>` | timer | setTimeout | - | **OK** | cleared in .finally() after every read |
| 74 | `downloadVerified > <anonymous>` | listener | file.once "drain" | - | **OK** | fires once on drain; the stream is destroyed if `failed` wins instead |

#### electron/main/games/fake/service.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 78 | `wait > <anonymous>` | timer | setTimeout | - | **NOT-WORTH** | a one-shot delay of a fake scan or install step, fires once |
| 153 | `setRunning` | timer | setTimeout rearm | - | **OK** | cleared by the next setRunning() or stop(); fires once |

#### electron/main/games/hdr.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 151 | `screens` | process | exec kscreen-doctor | - | **OK** | kscreen-doctor exits on its own; the 5 s timeout kills a hung one |
| 153 | `screens` | process | exec gdbus | - | **OK** | gdbus exits on its own; the 5 s timeout kills a hung one |
| 164 | `gamescopeVersion` | process | exec path | - | **OK** | gamescope --version exits on its own; the 5 s timeout kills a hung one |

#### electron/main/games/processes.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 225 | `run` | process | execFile cmd | - | **OK** | a launcher command that exits on its own; the 15 s timeout kills a hung one |
| 234 | `sleep > <anonymous>` | timer | setTimeout | - | **OK** | fires once, an awaited pause |
| 253 | `steamReportsGame > <anonymous>` | process | execFile system32("reg.exe") | - | **OK** | reg.exe exits on its own; the 3 s timeout kills a hung one |
| 276 | `run` | process | execFile cmd | - | **OK** | a launcher command that exits on its own; the 15 s timeout kills a hung one |
| 280 | `signal` | process | execFile system32("taskkill.exe") | - | **OK** | taskkill exits on its own; the 5 s timeout kills a hung one |

#### electron/main/games/running.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 308 | `readTasklist > <anonymous>` | process | execFile join(process.env.SystemRoot ?? | - | **OK** | tasklist exits on its own; the 4 s timeout kills a hung one |
| 418 | `pass` | timer | setTimeout | - | **OK** | re-armed by each pass; cleared in stop() (Games consent off) and retime(); runs while hidden on purpose (game profiles) |

#### electron/main/games/schemeHandler.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 166 | `spawnDetached > <anonymous>` | process | spawn cmd | - | **OK** | detached and unref'd on spawn: the program is the user's, it outlives the app on purpose |
| 167 | `spawnDetached > <anonymous>` | listener | child.once "error" | - | **OK** | fires once; goes with the child object |
| 169 | `spawnDetached > <anonymous>` | listener | child.once "spawn" | - | **OK** | fires once; goes with the child object |
| 215 | `shellStart > <anonymous>` | process | spawn powershellExe() | - | **OK** | PowerShell exits once Start-Process returned; the 15 s timer kills a hung one; the program it started is the user's and outlives the app on purpose |
| 217 | `shellStart > <anonymous>` | timer | setTimeout | - | **OK** | fires once; cleared when PowerShell exits or fails to start |
| 225 | `shellStart > <anonymous>` | listener | child.once "error" | - | **OK** | fires once; goes with the child object |
| 226 | `shellStart > <anonymous>` | listener | child.once "exit" | - | **OK** | fires once; goes with the child object |
| 236 | `run > <anonymous>` | process | execFile systemctl | - | **OK** | systemctl exits on its own; the 3 s timeout kills a hung one |
| 244 | `systemdRun > <anonymous>` | process | execFile systemd-run +systemd-run | - | **OK** | systemd-run exits once the --collect'ed unit started (10 s timeout) |
| 287 | `defaultHandler > <anonymous>` | process | execFile xdg-mime | - | **OK** | xdg-mime exits on its own; the 3 s timeout kills a hung one |

#### electron/main/games/service.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 112 | `refreshLatest > <anonymous>` | timer | setTimeout | - | **OK** | one-shot 5 s timer, cleared in the finally below once the feed answers (lifetime pass batch 4) |

#### electron/main/games/volumeKeeper.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 22 | `devSndEvents` | watcher | watch | - | **OK** | closed by the returned stop (VolumeKeeper.stop: the setting turned off, or quit) |
| 72 | `schedule` | timer | setTimeout | - | **OK** | one-shot, cleared by the next event or stop() |
| 86 | `check` | timer | setTimeout | - | **OK** | one-shot retry, cleared by the next event or stop() |

#### electron/main/index.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 108 | `<module>` | listener | app.on "second-instance" | module | **NOT-WORTH** | one per app, lives until quit |
| 130 | `recordGpuCrash` | listener | app.on "child-process-gone" | - | **NOT-WORTH** | registered once in start(), lives until quit |
| 163 | `start` | timer | setTimeout | - | **OK** | fires once |
| 183 | `start` | timer | setTimeout | - | **OK** | fires once, the first update check |
| 185 | `start` | timer | setInterval | - | **NOT-WORTH** | one per app, a background update check meant to run in the tray too |
| 324 | `start` | electron | protocol.handle "ds5-art" | - | **NOT-WORTH** | one scheme handler per app, lives until quit |
| 492 | `start` | listener | app.on "activate" | - | **NOT-WORTH** | one per app, lives until quit |
| 496 | `start` | listener | app.on "before-quit" | - | **NOT-WORTH** | one per app, lives until quit |
| 504 | `start` | listener | app.on "will-quit" | - | **NOT-WORTH** | one per app, fires at quit |
| 509 | `start` | listener | app.on "window-all-closed" | - | **NOT-WORTH** | one per app, lives until quit |
| 601 | `lockDownSession` | listener | ses.on "select-usb-device" | - | **NOT-WORTH** | once per app on the default session, lives until quit |
| 610 | `createWindow` | electron | BrowserWindow | - | **OK** | one window; "closed" drops the reference, showWindow() makes a new one only after that |
| 633 | `createWindow` | listener | mainWindow.webContents.on "did-finish-load" | - | **OK** | goes with the window (destroyed on "closed") |
| 635 | `createWindow` | listener | mainWindow.once "ready-to-show" | - | **OK** | goes with the window (destroyed on "closed") |
| 640 | `createWindow` | listener | mainWindow.on "close" | - | **OK** | goes with the window (destroyed on "closed") |
| 650 | `createWindow` | listener | mainWindow.on "session-end" | - | **OK** | goes with the window (destroyed on "closed") |
| 652 | `createWindow` | listener | mainWindow.on "closed" | - | **OK** | goes with the window (destroyed on "closed") |
| 657 | `createWindow` | listener | mainWindow.webContents.on "did-finish-load" | - | **OK** | goes with the window (destroyed on "closed") |
| 658 | `createWindow` | listener | mainWindow.webContents.on "render-process-gone" | - | **OK** | goes with the window (destroyed on "closed") |
| 662 | `createWindow` | listener | mainWindow.on "event as "show"" | - | **OK** | goes with the window (destroyed on "closed") |
| 665 | `createWindow` | listener | mainWindow.on "event as "show"" | - | **OK** | goes with the window (destroyed on "closed") |
| 666 | `createWindow` | listener | mainWindow.webContents.on "did-finish-load" | - | **OK** | goes with the window (destroyed on "closed") |
| 668 | `createWindow` | listener | mainWindow.webContents.on "did-finish-load" | - | **OK** | goes with the window (destroyed on "closed"); acts once |
| 681 | `createWindow` | listener | contents.on "will-navigate" | - | **OK** | goes with the window (destroyed on "closed") |

#### electron/main/integration.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 89 | `integrateAppImage` | process | execFile update-desktop-database | - | **OK** | exits on its own; only when the desktop entry changed |
| 92 | `integrateAppImage` | process | execFile kbuildsycoca6 | - | **OK** | each exits on its own; only when the desktop entry changed |
| 92 | `integrateAppImage > execFile(cb)` | process | execFile kbuildsycoca5 | - | **OK** | each exits on its own; only when the desktop entry changed |

#### electron/main/ipc.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 163 | `registerIpc` | listener | ipcMain.on "IPC.reportStatus" | - | **NOT-WORTH** | registered once by registerIpc(), lives until quit |
| 173 | `registerIpc` | listener | ipcMain.on "IPC.setTrayIcon" | - | **NOT-WORTH** | registered once by registerIpc(), lives until quit |
| 182 | `registerIpc` | ipc | ipcMain.handle "IPC.getSettings" | - | **NOT-WORTH** | registered once by registerIpc(), lives until quit |
| 189 | `registerIpc` | listener | ipcMain.on "IPC.appVersion" | - | **NOT-WORTH** | registered once by registerIpc(), lives until quit |
| 195 | `invoke` | ipc | ipcMain.handle "channel" | - | **NOT-WORTH** | one handler per channel, registered once by registerIpc(), lives until quit |
| 209 | `registerIpc` | listener | ipcMain.on "IPC.setFirmwareWriting" | - | **NOT-WORTH** | registered once by registerIpc(), lives until quit |
| 219 | `registerIpc` | listener | ipcMain.on "IPC.restartToUpdate" | - | **NOT-WORTH** | registered once by registerIpc(), lives until quit |
| 224 | `registerIpc` | ipc | ipcMain.handle "IPC.usbAccessInstalled" | - | **NOT-WORTH** | registered once by registerIpc(), lives until quit |
| 230 | `registerIpc` | ipc | ipcMain.handle "IPC.setupUsbAccess" | - | **NOT-WORTH** | registered once by registerIpc(), lives until quit |
| 236 | `registerIpc` | ipc | ipcMain.handle "IPC.repairWindowsUsb" | - | **NOT-WORTH** | registered once by registerIpc(), lives until quit |
| 247 | `invokeWith` | ipc | ipcMain.handle "channel" | - | **NOT-WORTH** | one handler per channel, registered once by registerIpc(), lives until quit |
| 273 | `registerIpc` | ipc | ipcMain.handle "IPC.saveOledImage" | - | **NOT-WORTH** | registered once by registerIpc(), lives until quit |
| 279 | `registerIpc` | ipc | ipcMain.handle "IPC.setSetting" | - | **NOT-WORTH** | registered once by registerIpc(), lives until quit |

#### electron/main/linuxSetup.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 111 | `runPkexec > <anonymous>` | process | execFile pkexec | - | **OK** | exits when the user answers the password prompt; no timeout on purpose (a person types) |

#### electron/main/tray.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 49 | `constructor` | electron | Tray | - | **NOT-WORTH** | one tray per app; Electron removes it at quit |
| 50 | `constructor` | listener | this.tray.on "click" | - | **NOT-WORTH** | goes with the one tray, lives until quit |
| 104 | `refresh` | electron | Menu.buildFromTemplate | - | **OK** | replaces the previous menu, which is then collected; rebuilt only when status/settings change |

#### electron/main/updater.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 85 | `runInstaller` | process | spawn installer | - | **OK** | detached and unref'd: the installer outlives this app on purpose (app.exit follows) |
| 328 | `restart` | process | spawn /bin/sh | - | **OK** | detached and unref'd: the relaunch outlives this app on purpose (app.exit next) |
| 337 | `restart` | process | spawn target | - | **OK** | detached relaunch, app.exit next |

#### electron/main/windowsSetup.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 45 | `repairWindowsUsb > <anonymous>` | process | execFile powershell | - | **OK** | exits when the UAC prompt is answered and the repair ends; no timeout (a person answers) |

#### electron/preload/index.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 17 | `onTrayCommand` | listener | ipcRenderer.on "IPC.trayCommand" | - | **OK** | removed by the unsubscribe it returns (the caller cleans up on unmount) |
| 23 | `onShowError` | listener | ipcRenderer.on "IPC.showError" | - | **OK** | removed by the unsubscribe it returns (the caller cleans up on unmount) |
| 29 | `onShowNotice` | listener | ipcRenderer.on "IPC.showNotice" | - | **OK** | removed by the unsubscribe it returns (the caller cleans up on unmount) |
| 48 | `onUpdateState` | listener | ipcRenderer.on "IPC.updateState" | - | **OK** | removed by the unsubscribe it returns (the caller cleans up on unmount) |
| 59 | `onFirmwareHold` | listener | ipcRenderer.on "IPC.firmwareHold" | - | **OK** | removed by the unsubscribe it returns (the caller cleans up on unmount) |
| 66 | `onDesktopPalette` | listener | ipcRenderer.on "IPC.desktopPalette" | - | **OK** | removed by the unsubscribe it returns (the caller cleans up on unmount) |
| 72 | `onWindowVisible` | listener | ipcRenderer.on "IPC.windowVisible" | - | **OK** | removed by the unsubscribe it returns (the caller cleans up on unmount) |
| 84 | `onProtonProgress` | listener | ipcRenderer.on "IPC.protonProgress" | - | **OK** | removed by the unsubscribe it returns (the caller cleans up on unmount) |
| 92 | `onRunningGame` | listener | ipcRenderer.on "IPC.runningGame" | - | **OK** | removed by the unsubscribe it returns (the caller cleans up on unmount) |

#### src/components/LanguageToggle.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 31 | `LanguageToggle` | effect | useEffect cleanup:some | render | **OK** | cleanup: removes the mousedown listener (menu closes / unmount) |
| 39 | `LanguageToggle > useEffect(cb)` | listener | document "mousedown" | effect | **OK** | removed in the effect cleanup (menu closes / unmount) |
| 45 | `LanguageToggle` | effect | useEffect cleanup:some | render | **OK** | cleanup: removes the keydown listener (menu closes / unmount) |
| 51 | `LanguageToggle > useEffect(cb)` | listener | document "keydown" | effect | **OK** | removed in the effect cleanup (menu closes / unmount) |

#### src/components/ThemeToggle.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 93 | `useApplyTheme` | effect | useEffect cleanup:some | render | **OK** | cleanup: unsubscribes the desktop palette; the other paths acquire nothing |
| 111 | `useApplyTheme > useEffect(cb)` | subscribe | desktop.onDesktopPalette | effect | **OK** | unsubscribed in the effect cleanup |

#### src/desktop/accordion/MainBlock.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 58 | `useMainBlock` | effect | useEffect cleanup:all | render | **OK** | the effect returns the store's unsubscribe (unmount / page change) |
| 89 | `MainBlock` | effect | useEffect cleanup:some | render | **OK** | returns showLinked's cleanup, on unmount or the next link |

#### src/desktop/accordion/Section.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 77 | `Section` | effect | useEffect cleanup:some | render | **OK** | showLinked's cleanup removes its transitionend listener (unmount / the next link) |
| 143 | `showLinked` | listener | body "transitionend" | - | **OK** | fires once (once: true), when the body's open transition ends; removed by the returned cleanup if it never does |
| 151 | `showLinked` | listener | target "animationend" | - | **OK** | fires once (once: true), when the one-shot flash ends |
| 231 | `SplitView` | effect | useEffect cleanup:all | render | **OK** | cleanup: removes the rail's toggle listener (unmount / the panel's state changes) |
| 236 | `SplitView > useEffect(cb)` | listener | window "PANEL_TOGGLE_EVENT" | effect | **OK** | removed in the effect cleanup |
| 241 | `SplitView` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (writes the remembered state once per link) |
| 296 | `PanelMenu` | effect | useEffect cleanup:some | render | **OK** | cleanup: removes the outside-click listener (menu closes / unmount) |
| 304 | `PanelMenu > useEffect(cb)` | listener | document "pointerdown" | effect | **OK** | removed in the effect cleanup (menu closes / unmount) |

#### src/desktop/accordion/useAccordion.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 109 | `useAccordion` | effect | useEffect cleanup:all | render | **OK** | the effect returns the store's unsubscribe (unmount / page change) |
| 131 | `useAccordion` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (writes the remembered open section) |

#### src/desktop/AppRail.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 90 | `AppRail` | effect | useEffect cleanup:all | render | **OK** | cleanup: removes the Ctrl+B keydown listener (unmount / pin change) |
| 98 | `AppRail > useEffect(cb)` | listener | window "keydown" | effect | **OK** | removed in the effect cleanup |

#### src/desktop/AutoUpdateAsk.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 22 | `AutoUpdateAsk` | effect | useEffect cleanup:all | render | **OK** | acquires nothing (reads whether the question was answered) |
| 35 | `AutoUpdateAsk` | effect | useEffect cleanup:some | render | **OK** | cleanup clears the interval (answered, due, window hidden, unmount) |
| 38 | `AutoUpdateAsk > useEffect(cb)` | timer | setInterval | effect | **OK** | cleared in the effect cleanup once answered, due or hidden |

#### src/desktop/colorPicker/ColorPicker.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 22 | `useRecentColors` | effect | useEffect cleanup:all | render | **OK** | cleanup removes the PREF_EVENT listener (unmount) |
| 28 | `useRecentColors > useEffect(cb)` | listener | window "PREF_EVENT" | effect | **OK** | removed in the effect cleanup (unmount) |
| 110 | `ColorPopover` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (mirrors state into a ref) |
| 152 | `ColorPopover` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (focus on open) |
| 158 | `ColorPopover` | effect | useEffect cleanup:all? | render | **OK** | acquires nothing; the cleanup adds a changed color to the recent ones |
| 167 | `ColorPopover` | effect | useEffect cleanup:all | render | **OK** | cleanup removes the outside-click listener (popover closes) |
| 173 | `ColorPopover > useEffect(cb)` | listener | document "pointerdown" | effect | **OK** | removed in the effect cleanup (popover closes) |
| 209 | `drag` | listener | el "pointermove" | - | **OK** | removed in up() on pointerup/pointercancel; dies with the element |
| 211 | `drag` | listener | el "pointerup" | - | **OK** | removed in up() on pointerup/pointercancel; dies with the element |
| 213 | `drag` | listener | el "pointercancel" | - | **OK** | removed in up() on pointerup/pointercancel; dies with the element |

#### src/desktop/controls.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 43 | `useStacked` | effect | useLayoutEffect cleanup:some | render | **OK** | cleanup: disconnects the ResizeObserver (unmount) |
| 60 | `useStacked > useLayoutEffect(cb)` | observer | ResizeObserver | effect | **OK** | disconnected in the layout effect cleanup |
| 99 | `InfoTip` | effect | useEffect cleanup:some | render | **OK** | the effect returns the scroll/resize listeners' removal (closed / unmount) |
| 102 | `InfoTip > useEffect(cb)` | listener | window "scroll" | effect | **OK** | removed in the cleanup (closed / unmount) |
| 104 | `InfoTip > useEffect(cb)` | listener | window "resize" | effect | **OK** | removed in the cleanup (closed / unmount) |
| 226 | `useLive` | effect | useEffect cleanup:all | render | **OK** | cleanup: marks the component unmounted (holds no resource) |
| 351 | `BusyButton` | effect | useEffect cleanup:some | render | **OK** | cleanup: clears the 1 s busy counter (done / unmount) |
| 357 | `BusyButton > useEffect(cb)` | timer | setInterval | effect | **OK** | cleared in the effect cleanup (busy ends / unmount) |

#### src/desktop/DesktopApp.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 71 | `DesktopApp` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (remembers that a dongle was seen) |
| 75 | `DesktopApp` | effect | useEffect cleanup:all? | render | **OK** | acquires nothing (trackBoard records the board name, returns nothing) |
| 121 | `DesktopApp` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (drops dismissals whose reason no longer applies) |
| 132 | `DesktopApp` | effect | useEffect cleanup:some | render | **OK** | cleanup: clears the apply debounce timer (draft change / unmount) |
| 135 | `DesktopApp > useEffect(cb)` | timer | setTimeout | effect | **OK** | cleared in the effect cleanup |
| 151 | `DesktopApp` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (narrator line on connect) |
| 157 | `DesktopApp` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (narrator line once per offered version) |
| 165 | `DesktopApp` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (narrator line when an update finishes) |
| 205 | `DesktopApp` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (toggles data-glass on <html>) |
| 218 | `DesktopApp` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (a toast when the controller comes or goes) |
| 234 | `DesktopApp` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (a toast when a game profile goes on or off) |
| 252 | `DesktopApp` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (sends the status to the tray over IPC) |
| 269 | `DesktopApp` | effect | useEffect cleanup:some | render | **OK** | cleanup: drops a stale narrator read (holds no resource) |
| 285 | `DesktopApp` | effect | useEffect cleanup:some | render | **OK** | cleanup: drops a stale tray icon render (holds no resource) |
| 302 | `DesktopApp` | effect | useEffect cleanup:all? | render | **OK** | the effect returns the preload's unsubscribe for main-process errors (unmount) |
| 302 | `DesktopApp > useEffect(cb)` | subscribe | window.desktop.onShowError | effect | **OK** | the effect returns the preload's unsubscribe for main-process errors (unmount) |
| 304 | `DesktopApp` | effect | useEffect cleanup:all? | render | **OK** | the effect returns the preload's unsubscribe for main-process notices (unmount) |
| 304 | `DesktopApp > useEffect(cb)` | subscribe | window.desktop.onShowNotice | effect | **OK** | the effect returns the preload's unsubscribe for main-process notices (unmount) |
| 306 | `DesktopApp` | effect | useEffect cleanup:all? | render | **OK** | cleanup: the preload's unsubscribe (removeListener) for tray commands |
| 309 | `DesktopApp > useEffect(cb)` | subscribe | window.desktop.onTrayCommand | effect | **OK** | the effect returns its unsubscribe (unmount) |
| 513 | `DesktopApp > onSelect= > railPress(cb)` | timer | raf | - | **OK** | fires once (moves focus after the page renders) |
| 560 | `useDarkTaskbar` | effect | useEffect cleanup:all | render | **OK** | cleanup: palette unsubscribe + media query listener removed (app root) |
| 569 | `useDarkTaskbar > useEffect(cb)` | subscribe | desktop.onDesktopPalette | effect | **OK** | off() in the effect cleanup |
| 573 | `useDarkTaskbar > useEffect(cb)` | listener | mq "change" | effect | **OK** | removed in the effect cleanup |
| 628 | `useGamesAttention` | effect | useEffect cleanup:some | render | **OK** | cleanup: drops a late settings / scan answer (holds no resource) |
| 646 | `useGamesAttention` | effect | useEffect cleanup:all? | render | **OK** | cleanup: onGamesAllowed's remover (removeEventListener) |
| 649 | `useGamesAttention > useEffect(cb)` | subscribe | onGamesAllowed | effect | **OK** | the effect returns its remover (unmount) |

#### src/desktop/dev/FakeGames.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 23 | `FakeGames` | effect | useEffect cleanup:some | render | **OK** | acquires nothing; the cleanup drops a late answer (unmount) |

#### src/desktop/dev/HdrTest.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 23 | `GpuSwatch` | effect | useEffect cleanup:all | render | **OK** | cleanup: destroys the WebGPU device (lifetime pass batch 4), at once if it arrives after unmount |
| 32 | `GpuSwatch > useEffect(cb) > <anonymous>` | device | { requestDevice(): Promise<any>; } \| null \| undefined.requestDevice | - | **OK** | destroyed in the effect cleanup, or here when the swatch is already gone |

#### src/desktop/devPreview.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 143 | `simulatedBoard` | subscribe | board.onChange | - | **NOT-WORTH** | one listener on the one board per page load: keeps its state across restarts |
| 156 | `useSimulatedBoard > useCallback(cb)` | subscribe | board.onChange | - | **OK** | useSyncExternalStore calls the returned unsubscribe (unmount) |
| 211 | `useDevToolsShortcut` | effect | useEffect cleanup:some | render | **OK** | cleanup: removes the Ctrl+Shift+D keydown listener |
| 220 | `useDevToolsShortcut > useEffect(cb)` | listener | window "keydown" | effect | **OK** | removed in the effect cleanup |

#### src/desktop/dongle/DongleConsole.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 62 | `DongleConsole` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (unread flag for the log pane) |
| 147 | `useOledFrame` | effect | useEffect cleanup:some | render | **OK** | cleanup: stops the 100 ms mirror poll (hidden / page left / unmount) |
| 183 | `tick` | timer | setTimeout | - | **OK** | self re-arming; cleared in useOledFrame's cleanup, stops once live is false |
| 202 | `OledCanvas` | effect | useEffect cleanup:none | render | **OK** | reuses one ImageData; nothing to release |
| 230 | `OledCanvas` | effect | useEffect cleanup:some | render | **OK** | cleanup: disconnects the ResizeObserver |
| 237 | `OledCanvas > useEffect(cb)` | observer | ResizeObserver | effect | **OK** | disconnected in the effect cleanup |
| 344 | `useDongleLog` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (appends log lines, capped at 200) |

#### src/desktop/dongle/DongleDashboard.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 71 | `useDongleTelemetry` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (latest frame / RSSI into a ref) |
| 75 | `useDongleTelemetry` | poll | usePoll | render | **OK** | usePoll: 1 s, stops when hidden, without a client, or on unmount (leaving the page) |
| 236 | `TimingCard` | effect | useEffect cleanup:some | render | **OK** | the ResizeObserver is disconnected on unmount |
| 240 | `TimingCard > useEffect(cb)` | observer | ResizeObserver | effect | **OK** | cleanup: disconnects the ResizeObserver (unmount) |

#### src/desktop/dongle/OledShare.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 116 | `OledShare` | effect | useLayoutEffect cleanup:none | render | **OK** | acquires nothing (keeps stopRef current) |
| 122 | `OledShare` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (appends to the recording, capped at GIF_MAX_FRAMES) |
| 135 | `OledShare` | effect | useEffect cleanup:some | render | **OK** | cleanup clears the counter and the cap's timer (Stop / Cancel / unmount) |
| 139 | `OledShare > useEffect(cb)` | timer | setTimeout | effect | **OK** | cleared in the effect cleanup |
| 141 | `OledShare > useEffect(cb)` | timer | setInterval | effect | **OK** | cleared in the effect cleanup |

#### src/desktop/dongle/shareEncode.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 10 | `encodeOffThread > <anonymous>` | electron | Worker | - | **OK** | terminated on its reply or error, below (one request per worker) |
| 13 | `encodeOffThread > <anonymous>` | listener | worker.onmessage = | - | **OK** | the worker (and its handlers) end with done() on the first reply |
| 21 | `encodeOffThread > <anonymous>` | listener | worker.onerror = | - | **OK** | the worker (and its handlers) end with done() |

#### src/desktop/dongle/useBoardProblems.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 23 | `useBoardProblems` | poll | usePoll | render | **OK** | usePoll: 10 s, stops when hidden, without a board, or on unmount |

#### src/desktop/firmwareUpdate.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 115 | `flash` | device | PicoflashHandle.connect | - | **OK** | released in the finally below (disconnect), on success and on every failure |
| 149 | `waitForBootloader > <anonymous>` | timer | setTimeout | - | **OK** | fires once (300 ms between bootloader looks, bounded by the deadline) |

#### src/desktop/frameTick.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 62 | `onFrameTick` | timer | setInterval | - | **OK** | the one shared interval; cleared below when the last drawer leaves |

#### src/desktop/games/consent.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 19 | `onGamesAllowed` | listener | window "GAMES_ALLOWED_EVENT" | - | **OK** | the returned remover calls removeEventListener (callers' effect cleanups) |

#### src/desktop/games/launcherCheck.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 18 | `useFreshRunning` | effect | useEffect cleanup:some | render | **OK** | cleanup: drops a late answer (holds no resource) |

#### src/desktop/glass/useLiquidGlass.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 18 | `useLiquidGlass` | effect | useEffect cleanup:some | render | **OK** | cleanup disconnects the observer, clears the timer, removes the SVG filters |
| 34 | `useLiquidGlass > useEffect(cb)` | observer | ResizeObserver | effect | **OK** | disconnected in the effect cleanup (unmount, glass off) |
| 37 | `useLiquidGlass > useEffect(cb) > <anonymous>` | timer | setTimeout | - | **OK** | one-shot debounce, cleared on the next resize and in the cleanup |

#### src/desktop/glass/useSpecular.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 27 | `onMove` | timer | raf | - | **OK** | one-shot, at most one pending; only pointer moves arm it (none while hidden) |
| 32 | `useSpecular` | effect | useEffect cleanup:some | render | **OK** | cleanup drops the element; the last one removes the shared listener |
| 35 | `useSpecular > useEffect(cb)` | listener | window "pointermove" | effect | **OK** | one shared listener, removed when the last glass element unmounts |

#### src/desktop/library/gameArt.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 35 | `useArtColor` | effect | useEffect cleanup:some | render | **OK** | acquires nothing; the cleanup drops a late answer (key change, unmount) |

#### src/desktop/library/GameLibrary.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 124 | `GameLibrary` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (one IPC read of the game details) |

#### src/desktop/library/GamePage.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 75 | `GamePage` | effect | useEffect cleanup:some | render | **OK** | cleanup unsubscribes the theme listener and cancels the frame |
| 82 | `update` | timer | raf | - | **OK** | one-shot, cancelled by the next update() and the effect cleanup |
| 86 | `GamePage > useEffect(cb)` | subscribe | onThemeChange | effect | **OK** | off() in the effect cleanup |
| 94 | `GamePage` | effect | useEffect cleanup:all | render | **OK** | acquires nothing; the cleanup clears the backdrop game (page closes) |
| 111 | `GamePage` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (asks for one rescan per HDR game opened) |

#### src/desktop/library/playBar.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 53 | `run > <anonymous>` | timer | setTimeout | - | **NOT-WORTH** | one-shot 0.6-3 s that ends the busy button's wait; fires once |

#### src/desktop/library/useDebouncedSave.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 18 | `useDebouncedSave` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (keeps refs current) |
| 25 | `useDebouncedSave` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (follows the stored value) |
| 37 | `useDebouncedSave` | effect | useEffect cleanup:all? | render | **OK** | cleanup clears the timer and sends the waiting save (unmount) |
| 51 | `useDebouncedSave > useCallback(cb)` | timer | setTimeout | - | **OK** | cleared by the next set(), cancel() or the unmount cleanup |

#### src/desktop/library/useGameProfile.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 148 | `useGameProfile` | effect | useEffect cleanup:some | render | **OK** | cleanup unsubscribes onRunningGame (unmount) |
| 168 | `useGameProfile > useEffect(cb)` | subscribe | desktop.onRunningGame | effect | **OK** | the effect returns its unsubscribe |
| 184 | `useGameProfile` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (resets refs) |
| 190 | `useGameProfile` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (queues one profile switch; switchOnce serializes them) |

#### src/desktop/live/ArtBackdrop.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 65 | `useBackdropKeys` | effect | useEffect cleanup:some | render | **OK** | cleanup: stops the retry timer, drops late reads, unsubscribes the running game |
| 85 | `load > then(cb)` | timer | setTimeout | - | **OK** | cleared in the effect cleanup (unmount) |
| 91 | `useBackdropKeys > useEffect(cb)` | subscribe | desktop.onRunningGame | effect | **OK** | off() in the effect cleanup |
| 113 | `BlurredArt` | effect | useEffect cleanup:all | render | **OK** | cleanup: drops the image's onload and src |
| 117 | `BlurredArt > useEffect(cb)` | listener | img.onload = | effect | **OK** | set to null in the effect cleanup (new image or unmount) |
| 166 | `ArtBackdrop` | effect | useLayoutEffect cleanup:none | render | **OK** | acquires nothing (resets the crossfade before paint) |
| 174 | `ArtBackdrop` | effect | useEffect cleanup:some | render | **OK** | cleanup: clears the pan timer; none unless shown, focused and moving |
| 193 | `ArtBackdrop > useEffect(cb)` | subscribe | onFrameTick | effect | **OK** | unsubscribed in the effect cleanup; runs only while shown, focused and moving |
| 196 | `ArtBackdrop` | effect | useEffect cleanup:some | render | **OK** | cleanup: clears the cycle timer; none while hidden, holding or with one game |
| 202 | `ArtBackdrop > useEffect(cb)` | timer | setInterval | effect | **OK** | cleared in the effect cleanup (with a switch still waiting for its tick); runs only while shown and focused with 2+ games |

#### src/desktop/live/Calibration.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 50 | `Calibration` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (mirrors the input into a ref) |
| 54 | `Calibration` | effect | useEffect cleanup:some | render | **OK** | cleanup: clears the step's timers (next step, cancel or unmount) |
| 59 | `Calibration > useEffect(cb)` | timer | setTimeout | effect | **OK** | cleared in the effect cleanup |
| 65 | `Calibration > useEffect(cb)` | timer | setInterval | effect | **OK** | cleared when the step ends, or in the effect cleanup |
| 67 | `Calibration > useEffect(cb)` | timer | setTimeout | effect | **OK** | cleared in the effect cleanup |

#### src/desktop/live/controllerAccent.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 262 | `onThemeChange` | observer | MutationObserver | - | **OK** | disconnected by the unsubscribe onThemeChange returns |
| 267 | `onThemeChange` | listener | scheme "change" | - | **OK** | removed by the unsubscribe onThemeChange returns |
| 269 | `onThemeChange` | subscribe | onAccentChange | - | **OK** | off() in the unsubscribe onThemeChange returns |
| 317 | `useControllerAccent` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (sets the accent tokens) |
| 331 | `useControllerAccent` | effect | useEffect cleanup:some | render | **OK** | cleanup: unsubscribes the desktop palette (one, at the app root) |
| 344 | `useControllerAccent > useEffect(cb)` | subscribe | desktop.onDesktopPalette | effect | **OK** | off() in the effect cleanup |
| 351 | `useControllerAccent` | effect | useEffect cleanup:all | render | **OK** | cleanup: disconnects the observer and removes the scheme listener |
| 353 | `useControllerAccent > useEffect(cb)` | observer | MutationObserver | effect | **OK** | disconnected in the effect cleanup (one, at the app root) |
| 360 | `useControllerAccent > useEffect(cb)` | listener | scheme "change" | effect | **OK** | removed in the effect cleanup |

#### src/desktop/live/ControllerInfo.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 85 | `useControllerInfo` | effect | useEffect cleanup:some | render | **OK** | cleanup: drops a late read and settles the Refresh promise |
| 124 | `useControllerInfo` | effect | useEffect cleanup:all? | render | **OK** | acquires nothing (reports the firmware to the parent) |

#### src/desktop/live/ControllerView.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 77 | `ControllerView` | poll | usePoll | render | **OK** | usePoll stops on unmount, without a client and while hidden |
| 106 | `ControllerView` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (resets the dot's pulse on disconnect) |
| 117 | `ControllerView` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (hands the button draft to the library) |
| 121 | `ControllerView` | effect | useEffect cleanup:all? | render | **OK** | cleanup: clears the button draft on unmount |
| 175 | `ControllerView` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (one settings read; a late answer only sets state) |
| 187 | `ControllerView` | effect | useEffect cleanup:some | render | **OK** | cleanup: disconnects the ResizeObserver |
| 195 | `ControllerView > useEffect(cb)` | observer | ResizeObserver | effect | **OK** | disconnected in the effect cleanup (unmount, controller on/off) |
| 207 | `ControllerView` | effect | useEffect cleanup:all | render | **OK** | cleanup: removes the tour listener |
| 210 | `ControllerView > useEffect(cb)` | listener | window "TOUR_EVENT" | effect | **OK** | removed in the effect cleanup |
| 369 | `ConnectedDot` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (marks this connection's pulse as played) |

#### src/desktop/live/HdrGlow.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 115 | `HdrGlow` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (stores the peak, asks for one redraw) |
| 120 | `HdrGlow` | effect | useEffect cleanup:some | render | **OK** | cleanup: stops frames and observers, destroys the GPU device and texture |
| 145 | `HdrGlow > useEffect(cb) > <anonymous>` | device | { requestDevice(): Promise<any>; } \| null.requestDevice | - | **OK** | destroyed in release() (cleanup, or at once if unmounted while starting) |
| 164 | `schedule` | timer | raf | - | **OK** | cancelled in the effect cleanup; one frame only when something changed |
| 211 | `HdrGlow > useEffect(cb) > <anonymous>` | observer | ResizeObserver | - | **OK** | disconnected in the effect cleanup |
| 214 | `HdrGlow > useEffect(cb) > <anonymous> > <anonymous>` | timer | raf | - | **OK** | cancelled by the next resize and in the effect cleanup |
| 217 | `HdrGlow > useEffect(cb) > <anonymous> > <anonymous>` | timer | setTimeout | - | **OK** | cleared by the next resize and in the effect cleanup |
| 254 | `HdrGlow > useEffect(cb) > <anonymous>` | observer | MutationObserver | - | **OK** | disconnected in the effect cleanup |
| 259 | `HdrGlow > useEffect(cb) > <anonymous>` | observer | MutationObserver | - | **OK** | disconnected in the effect cleanup |

#### src/desktop/live/LiveController.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 108 | `LiveArt` | effect | useLayoutEffect cleanup:none | render | **OK** | acquires nothing (indexes the drawing's parts; they go with its DOM) |
| 155 | `LiveArt` | effect | useLayoutEffect cleanup:some | render | **OK** | cleanup: disconnects the ResizeObserver |
| 175 | `LiveArt > useLayoutEffect(cb)` | observer | ResizeObserver | effect | **OK** | disconnected in the effect cleanup |
| 182 | `LiveArt` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (sets the parts' names) |
| 190 | `LiveArt` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (marks the selected part) |
| 203 | `LiveArt` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (sets the lightbar color tokens) |
| 220 | `LiveArt` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (sets the colorway tokens) |
| 243 | `LiveArt` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (toggles the player lights) |
| 251 | `LiveArt` | effect | useEffect cleanup:none | render | **OK** | acquires nothing lasting (touch dots reused, removed when lifted) |

#### src/desktop/live/LiveData.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 38 | `useLinkRates` | effect | useEffect cleanup:some | render | **OK** | cleanup: clears the 1 s timer (hidden / unmount) |
| 42 | `useLinkRates > useEffect(cb)` | timer | setInterval | effect | **OK** | cleared in the effect cleanup (with an update still waiting for its tick); runs only while shown |
| 196 | `Spark` | effect | useEffect cleanup:all | render | **OK** | cleanup: the theme watcher's unsubscribe |
| 198 | `Spark > useEffect(cb)` | subscribe | onThemeChange | effect | **OK** | the effect returns its unsubscribe |
| 201 | `Spark` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (draws a frame; the history is capped at HISTORY) |

#### src/desktop/live/micRing.worklet.js

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 13 | `constructor` | listener | this.port.onmessage = | - | **OK** | lives with the worklet node; the AudioContext's close() ends both |

#### src/desktop/live/micTest.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 92 | `startMicTest` | media | AudioContext | - | **OK** | closed in stop(), or at once when the start fails |
| 103 | `startMicTest` | media | getUserMedia | - | **OK** | tracks stopped in stop(), or at once when the start fails |
| 108 | `startMicTest` | media | audioWorklet.addModule | - | **OK** | goes with the AudioContext (closed in stop()) |
| 117 | `startMicTest` | media | createMediaStreamSource | - | **OK** | goes with the AudioContext (closed in stop()) |
| 122 | `startMicTest` | media | AudioWorkletNode | - | **OK** | goes with the AudioContext (closed in stop()) |
| 131 | `startMicTest > forEach(cb)` | listener | t "ended" | - | **OK** | goes with the track (stopped in stop()) |
| 136 | `dump > <anonymous>` | timer | setTimeout | - | **OK** | cleared when the ring answers, else fires once after DUMP_TIMEOUT_MS |
| 138 | `dump > <anonymous>` | listener | ring.port.onmessage = | - | **OK** | goes with the AudioContext, closed right after the dump |
| 185 | `listenBack` | media | AudioContext | - | **OK** | closed in listenBack's finally |
| 236 | `playClip > <anonymous>` | timer | setTimeout | - | **OK** | cleared in end() |
| 239 | `playClip > <anonymous>` | listener | signal "abort" | - | **OK** | removed in end() |
| 241 | `playClip > <anonymous>` | listener | navigator.mediaDevices "devicechange" | - | **OK** | removed in end() |
| 243 | `playClip > <anonymous>` | listener | src.onended = | - | **OK** | goes with the AudioContext, closed in listenBack's finally |

#### src/desktop/live/PartPanel.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 213 | `AllButtonsSection` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (scrolls the picked row into view) |
| 220 | `AllButtonsSection` | effect | useEffect cleanup:all? | render | **OK** | cleanup: clears the hovered row on unmount |
| 512 | `LevelMeter` | poll | usePoll | render | **OK** | usePoll stops on unmount (section folded) and while hidden |
| 548 | `SpeakerTest` | effect | useEffect cleanup:some | render | **OK** | cleanup: cancels the frame loop; runs only while playing and shown |
| 552 | `SpeakerTest > useEffect(cb)` | timer | raf | effect | **OK** | cancelled in the effect cleanup (stop, hidden, unmount) |
| 555 | `tick` | timer | raf | - | **OK** | re-armed per frame; the effect cleanup cancels the latest |
| 625 | `MicTest` | effect | useEffect cleanup:all? | render | **OK** | cleanup: closes the mic session and any playback on unmount |
| 627 | `MicTest` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (closes the mic test when the window hides) |
| 698 | `MicTest` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (switches the live session's loopback) |
| 704 | `MicTest` | effect | useEffect cleanup:some | render | **OK** | cleanup: cancels the meter's frame loop (testing and shown only) |
| 707 | `MicTest > useEffect(cb)` | timer | raf | effect | **OK** | cancelled in the effect cleanup (stop, hidden, unmount) |
| 711 | `tick` | timer | raf | - | **OK** | re-armed per frame; the effect cleanup cancels the latest |
| 717 | `MicTest` | effect | useEffect cleanup:some | render | **OK** | cleanup: cancels the playback line's frame loop (playing and shown only) |
| 720 | `MicTest > useEffect(cb)` | timer | raf | effect | **OK** | cancelled in the effect cleanup (stop, hidden, unmount) |
| 723 | `tick` | timer | raf | - | **OK** | re-armed per frame; the effect cleanup cancels the latest |

#### src/desktop/live/slotSettings.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 42 | `useSlotSettings` | effect | useEffect cleanup:all | render | **OK** | cleanup: drops a late read (acquires nothing else) |

#### src/desktop/live/speakerPlayer.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 69 | `playTune` | media | AudioContext | - | **OK** | closed in playTune's finally (tune ended or stopped) |
| 78 | `playTune` | listener | navigator.mediaDevices "devicechange" | - | **OK** | removed in playTune's finally |
| 89 | `playTune > <anonymous>` | listener | src.onended = | - | **OK** | goes with the AudioContext, closed in playTune's finally |

#### src/desktop/live/StickTestCards.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 30 | `StickTests` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (mirrors input and calibration into refs) |
| 42 | `StickTests` | effect | useEffect cleanup:some | render | **OK** | cleanup: clears the circularity sampler (window hidden, unmount) |
| 45 | `StickTests > useEffect(cb)` | timer | setInterval | effect | **OK** | cleared in the effect cleanup (window hidden, view closed) |
| 80 | `StickTests` | effect | useEffect cleanup:some | render | **OK** | cleanup: clears the drift sampler and its end timer |
| 85 | `StickTests > useEffect(cb)` | timer | setInterval | effect | **OK** | cleared at the end of the 10 s test, or in the effect cleanup |
| 93 | `StickTests > useEffect(cb)` | timer | setTimeout | effect | **OK** | cleared in the effect cleanup |

#### src/desktop/live/SwirlField.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 154 | `glRenderer` | observer | ResizeObserver | - | **OK** | disconnected in dispose() (the renderer's canvas goes away or the mode changes) |
| 237 | `SwirlField` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (one settings read picks GPU or CPU) |
| 254 | `SwirlField` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (mirrors Reduce motion into a ref) |
| 258 | `SwirlField` | effect | useEffect cleanup:some | render | **OK** | cleanup: removes the context-lost listener, disposes the renderer |
| 276 | `SwirlField > useEffect(cb)` | listener | c "webglcontextlost" | effect | **OK** | removed in the effect cleanup |
| 285 | `SwirlField` | effect | useEffect cleanup:some | render | **OK** | cleanup: the theme watcher's unsubscribe |
| 311 | `SwirlField > useEffect(cb)` | subscribe | onThemeChange | effect | **OK** | the effect returns its unsubscribe |
| 317 | `SwirlField` | effect | useEffect cleanup:some | render | **OK** | cleanup: clears the frame timer; none while hidden, holding or still |
| 333 | `SwirlField > useEffect(cb)` | subscribe | onFrameTick | effect | **OK** | unsubscribed in the effect cleanup; off while hidden (lean rule), holding or still |

#### src/desktop/live/useRemap.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 49 | `useRemap` | effect | useEffect cleanup:some | render | **OK** | cleanup: drops late reads (acquires nothing else) |

#### src/desktop/lookKnobs.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 51 | `useLookKnobs` | effect | useEffect cleanup:all | render | **OK** | cleanup: removes the pref listener (app root, mounts once) |
| 57 | `useLookKnobs > useEffect(cb)` | listener | window "PREF_EVENT" | effect | **OK** | removed in the effect cleanup |
| 61 | `useLookKnobs` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (writes CSS variables on <html>) |

#### src/desktop/motion.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 11 | `useReduceMotion` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (toggles data-reduce-motion) |
| 30 | `useReducedMotion` | effect | useEffect cleanup:all | render | **OK** | cleanup: removes the media query listener |
| 34 | `useReducedMotion > useEffect(cb)` | listener | media "change" | effect | **OK** | removed in the effect cleanup |

#### src/desktop/narrator.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 138 | `wait > <anonymous>` | timer | setTimeout | - | **OK** | fires once (caption linger) |
| 151 | `play` | media | Audio | - | **OK** | one element per line, dropped when it ends, errors or stop() pauses it |
| 158 | `play > <anonymous>` | listener | audio.onended = | - | **OK** | handlers live on the element and go with it when the line ends |
| 158 | `play > <anonymous>` | listener | audio.onerror = | - | **OK** | handlers live on the element and go with it when the line ends |
| 158 | `play > <anonymous>` | listener | audio.onpause = | - | **OK** | handlers live on the element and go with it when the line ends |

#### src/desktop/pages/AboutPage.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 143 | `AboutPage` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (marks the new version seen) |
| 167 | `go` | timer | raf | - | **OK** | fires once (scrolls after the next paint) |

#### src/desktop/pages/AppSettingsPage.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 54 | `AppSettingsPage` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (one settings read) |
| 255 | `useGamesAllowed` | effect | useEffect cleanup:all | render | **OK** | cleanup: drops a late read, unsubscribes the games-allowed event |
| 262 | `useGamesAllowed > useEffect(cb)` | subscribe | onGamesAllowed | effect | **OK** | off() in the effect cleanup |
| 507 | `DevChannelDialog` | effect | useEffect cleanup:some | render | **OK** | cleanup: drops a late preview (holds no resource) |
| 523 | `DevChannelDialog` | effect | useEffect cleanup:all | render | **OK** | cleanup: removes the Escape listener (dialog closed / onCancel change) |
| 526 | `DevChannelDialog > useEffect(cb)` | listener | window "keydown" | effect | **OK** | removed in the effect cleanup |

#### src/desktop/pages/GamesPage.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 234 | `useGamesSetup` | effect | useEffect cleanup:all | render | **OK** | acquires nothing; the cleanup drops a late scan result (unmount) |
| 247 | `useGamesSetup` | effect | useEffect cleanup:all? | render | **OK** | cleanup is onProtonProgress's unsubscribe (unmount) |
| 247 | `useGamesSetup > useEffect(cb)` | subscribe | desktop.onProtonProgress | effect | **OK** | cleanup is onProtonProgress's unsubscribe (unmount) |

#### src/desktop/pages/SettingsPage.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 44 | `useGripTest` | effect | useEffect cleanup:all? | render | **OK** | cleanup stops a running grip test (unmount, client change, disconnect) |
| 59 | `until > <anonymous>` | timer | setTimeout | - | **OK** | fires once, or cleared by wake() when the test stops |

#### src/desktop/pages/SlotsPage.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 56 | `SlotsPage` | poll | usePoll | render | **OK** | usePoll stops on unmount, while hidden and while busy |
| 84 | `SlotsPage` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (hands the slot occupancy to the developer preview) |
| 93 | `SlotsPage` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (writes the slot memory pref) |

#### src/desktop/pages/TriggersPage.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 20 | `TriggersPage` | effect | useEffect cleanup:all? | render | **OK** | acquires nothing; the cleanup turns the trigger preview off |

#### src/desktop/RecoveredNotice.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 22 | `RecoveredNotice` | effect | useEffect cleanup:all? | render | **OK** | cleanup: the returned unsubscribe (unmount) |
| 22 | `RecoveredNotice > useEffect(cb)` | subscribe | onRecovered | effect | **OK** | cleanup: the returned unsubscribe (unmount) |
| 24 | `RecoveredNotice` | effect | useEffect cleanup:all | render | **OK** | cleanup: drops a late answer (holds no resource) |

#### src/desktop/SetupScreen.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 43 | `SetupScreen` | poll | usePoll | render | **OK** | usePoll: stops while installing, when hidden, or when setup unmounts |
| 47 | `SetupScreen` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (one firmware lookup once a Pico shows up) |
| 145 | `UpdatesWithoutDongle` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (one firmware lookup on mount) |

#### src/desktop/storage.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 34 | `usePref` | effect | useEffect cleanup:all | render | **OK** | cleanup: removes the pref listener (unmount / key change) |
| 40 | `usePref > useEffect(cb)` | listener | window "PREF_EVENT" | effect | **OK** | removed in the effect cleanup |
| 65 | `useRawPref` | effect | useEffect cleanup:all | render | **OK** | cleanup: removes this raw pref's listener (unmount / key change) |
| 71 | `useRawPref > useEffect(cb)` | listener | window "PREF_EVENT" | effect | **OK** | removed in the effect cleanup |

#### src/desktop/toast.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 75 | `dismissToast` | timer | setTimeout | - | **OK** | fires once (removes the faded toast) |

#### src/desktop/Toasts.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 16 | `ToastItem` | effect | useEffect cleanup:some | render | **OK** | cleanup: clears the dismiss timer (pause, shown again, unmount) |
| 21 | `ToastItem > useEffect(cb)` | timer | setTimeout | effect | **OK** | cleared in the effect cleanup |

#### src/desktop/topLayer.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 54 | `useTopLayer` | effect | useLayoutEffect cleanup:some | render | **OK** | cleanup removes the scroll/resize listeners and leaves the top layer (closed / unmount) |
| 69 | `useTopLayer > useLayoutEffect(cb)` | listener | window "resize" | effect | **OK** | removed in the layout effect cleanup (closed / unmount) |
| 71 | `useTopLayer > useLayoutEffect(cb)` | listener | window "scroll" | effect | **OK** | removed in the layout effect cleanup (closed / unmount) |

#### src/desktop/tour/Tour.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 133 | `Tour` | effect | useEffect cleanup:all | render | **OK** | cleanup removes the TOUR_EVENT listener (unmount) |
| 139 | `Tour > useEffect(cb)` | listener | window "TOUR_EVENT" | effect | **OK** | removed in the effect cleanup (unmount) |
| 153 | `Tour` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (mirrors state into a ref) |
| 157 | `Tour` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (says one narrator line; the next step cuts it) |
| 176 | `Tour` | effect | useEffect cleanup:some | render | **OK** | cleanup removes the pulse class (step change, unmount) |
| 182 | `Tour` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (opens the lightbar panel) |
| 186 | `Tour` | effect | useEffect cleanup:some | render | **OK** | cleanup turns the trigger preview off (step change, unmount) |
| 204 | `Tour` | effect | useEffect cleanup:some | render | **OK** | cleanup cancels the frame |
| 207 | `Tour > useEffect(cb)` | timer | raf | effect | **OK** | one-shot, cancelled in the effect cleanup |
| 216 | `Tour` | effect | useEffect cleanup:some | render | **OK** | cleanup cancels the frame |
| 219 | `Tour > useEffect(cb)` | timer | raf | effect | **OK** | one-shot, cancelled in the effect cleanup |
| 232 | `Tour` | effect | useEffect cleanup:some | render | **OK** | cleanup cancels the frame |
| 235 | `Tour > useEffect(cb)` | timer | raf | effect | **OK** | one-shot, cancelled in the effect cleanup |
| 254 | `Tour` | effect | useLayoutEffect cleanup:some | render | **OK** | cleanup cancels the frame, the interval and the resize listener; off while hidden |
| 261 | `Tour > useLayoutEffect(cb)` | timer | raf | effect | **OK** | one-shot, cancelled in the layout effect cleanup |
| 263 | `Tour > useLayoutEffect(cb)` | timer | setInterval | effect | **OK** | cleared in the cleanup (step change, window hidden, tour closed) |
| 265 | `Tour > useLayoutEffect(cb)` | listener | window "resize" | effect | **OK** | removed in the layout effect cleanup |
| 286 | `Tour` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (mirrors state into a ref) |
| 291 | `Tour` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (edge-detects the pad buttons) |
| 324 | `Tour` | effect | useEffect cleanup:some | render | **OK** | cleanup cancels the hold loop (release, step change, window hidden, tour closed) |
| 341 | `tick` | timer | raf | - | **OK** | re-arms only while the button is held; cancelled in the effect cleanup |
| 344 | `Tour > useEffect(cb)` | timer | raf | effect | **OK** | cancelled in the effect cleanup |
| 352 | `Tour` | effect | useEffect cleanup:some | render | **OK** | cleanup clears the timer and drops a late narratorIdle() |
| 356 | `Tour > useEffect(cb)` | timer | setTimeout | effect | **OK** | cleared in the effect cleanup |
| 368 | `Tour` | effect | useEffect cleanup:some | render | **OK** | cleanup removes the keydown listener (tour closed, unmount) |
| 372 | `Tour > useEffect(cb)` | listener | window "keydown" | effect | **OK** | removed in the effect cleanup |

#### src/desktop/tray/trayIcon.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 184 | `blobToDataUrl > <anonymous>` | listener | reader.onload = | - | **OK** | on the FileReader, which is dropped after its one read |
| 186 | `blobToDataUrl > <anonymous>` | listener | reader.onerror = | - | **OK** | on the FileReader, which is dropped after its one read |

#### src/desktop/UsbAccessSetup.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 16 | `UsbAccessSetup` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (one IPC check on mount) |

#### src/desktop/useLiveInput.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 35 | `useLiveInput` | effect | useEffect cleanup:some | render | **OK** | cleanup: clears the poll timer and the pending rAF (hidden / view left / unmount) |
| 71 | `poll` | timer | raf | - | **OK** | at most one pending; cancelled in the cleanup, never armed after it |
| 77 | `poll` | timer | setTimeout | - | **OK** | self re-arming ~30 Hz poll; cleared in the cleanup, stops once live is false |
| 101 | `useLiveLightbar` | effect | useEffect cleanup:some | render | **OK** | cleanup: clears the 10 Hz lightbar poll (hidden / view left / unmount) |
| 118 | `poll` | timer | setTimeout | - | **OK** | self re-arming; cleared in the cleanup, stops once live is false |

#### src/desktop/usePoll.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 11 | `useLatest` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (keeps the latest function in a ref) |
| 32 | `usePoll` | effect | useEffect cleanup:some | render | **OK** | cleanup: stops and clears the poll (disabled / hidden / unmount) |
| 52 | `tick` | timer | setTimeout rearm | - | **OK** | self re-arming; cleared in the cleanup, stops once stopped is set |

#### src/desktop/useUpdates.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 15 | `useAppUpdate` | effect | useEffect cleanup:some | render | **OK** | cleanup: the preload's unsubscribe (removeListener) for the update state |
| 20 | `useAppUpdate > useEffect(cb)` | subscribe | desktop.onUpdateState | effect | **OK** | the effect returns its unsubscribe |
| 29 | `useFirmwareHold` | effect | useEffect cleanup:some | render | **OK** | cleanup: the preload's unsubscribe (removeListener) for the firmware hold |
| 34 | `useFirmwareHold > useEffect(cb)` | subscribe | desktop.onFirmwareHold | effect | **OK** | the effect returns its unsubscribe |
| 117 | `useFirmwareUpdate` | effect | useEffect cleanup:some | render | **OK** | cleanup: drops a late lookup answer (holds no resource) |
| 143 | `useFirmwareUpdate > useCallback(cb)` | timer | setTimeout | - | **OK** | cleared once the update settles, and on unmount (effects below) |
| 198 | `useFirmwareUpdate` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (clears the slow-return timer once settled) |
| 207 | `useFirmwareUpdate` | effect | useEffect cleanup:some | render | **OK** | cleanup: stops the bootloader look (settled, a new write, unmount) |
| 230 | `tick` | timer | setTimeout rearm | - | **OK** | self re-arming until the deadline; cleared in the cleanup |
| 240 | `useFirmwareUpdate` | effect | useEffect cleanup:all? | render | **OK** | cleanup: clears the slow-return timer on unmount |

#### src/desktop/useWindowShown.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 37 | `wire` | subscribe | window.desktop.onWindowVisible | - | **NOT-WORTH** | wired once per page (the shared store), lives as long as the window |
| 42 | `wire` | listener | document "visibilitychange" | - | **NOT-WORTH** | one shared store, wired once per page; lives as long as the window |
| 47 | `wire` | listener | window "focus" | - | **NOT-WORTH** | one shared store, wired once per page; lives as long as the window |
| 52 | `wire` | listener | window "blur" | - | **NOT-WORTH** | one shared store, wired once per page; lives as long as the window |

#### src/desktop/WindowsUsbRepair.tsx

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 30 | `WindowsUsbRepair` | poll | usePoll | render | **OK** | usePoll: Windows only, stops when hidden or when setup unmounts |

#### src/hooks/useDs5Bridge.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 108 | `useDs5Bridge` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (mirrors the client into a ref) |
| 294 | `useDs5Bridge` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (one auto-connect attempt) |
| 306 | `useDs5Bridge` | effect | useEffect cleanup:none | render | **OK** | acquires nothing (mirrors state into refs) |
| 312 | `useDs5Bridge` | effect | useEffect cleanup:some | render | **OK** | cleanup: stops the 1 s identity / config poll (client change / unmount) |
| 349 | `poll` | timer | setTimeout | - | **OK** | self re-arming 1 s poll, runs hidden on purpose (tray); cleared in the cleanup |
| 354 | `useDs5Bridge > useEffect(cb)` | timer | setTimeout | effect | **OK** | the first tick; cleared in the cleanup |
| 364 | `useDs5Bridge` | effect | useEffect cleanup:some | render | **OK** | cleanup: removes both USB connect / disconnect listeners |
| 374 | `useDs5Bridge > useEffect(cb)` | listener | navigator.usb "disconnect" | effect | **OK** | removed in the effect cleanup |
| 376 | `useDs5Bridge > useEffect(cb)` | listener | navigator.usb "connect" | effect | **OK** | removed in the effect cleanup |
| 386 | `useDs5Bridge` | effect | useEffect cleanup:some | render | **OK** | cleanup: the simulated board's unsubscribe (unmount) |
| 390 | `useDs5Bridge > useEffect(cb)` | subscribe | sim.onChange | effect | **OK** | the effect returns its unsubscribe |

#### src/i18n/index.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 84 | `<module>` | listener | i18n.on "languageChanged" | module | **NOT-WORTH** | one i18n instance, subscribed once at load; lives as long as the window |

#### src/oled/share.worker.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 16 | `<module>` | listener | scope.onmessage = | module | **OK** | the worker's one handler; the page terminates the worker after its reply (shareEncode.ts) |

#### src/protocol/bridgeClient.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 783 | `sleep > <anonymous>` | timer | setTimeout | - | **OK** | fires once (sleep between status polls) |

#### src/protocol/simulatedBoard.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 177 | `later` | timer | setTimeout | - | **OK** | one pending re-enumeration at a time: replaced or cleared by the next state change (go) |
| 236 | `flashEraseAndWrite > <anonymous>` | timer | setTimeout | - | **OK** | fires once (the simulated erase + write time) |

#### src/protocol/webUsbTransport.ts

| Line | Function | Kind | What | Runs in | Verdict | Release point / reason |
|---|---|---|---|---|---|---|
| 48 | `request` | device | USB.requestDevice | - | **OK** | opens nothing (the permission prompt returns a USBDevice) |
| 67 | `open` | device | USBDevice.open | - | **NOT-WORTH** | one dongle handle per connection; close() is unused, freed on disconnect |
| 70 | `open` | device | USBDevice.claimInterface | - | **NOT-WORTH** | claimed for the connection's life, freed on disconnect; re-claim is harmless |
