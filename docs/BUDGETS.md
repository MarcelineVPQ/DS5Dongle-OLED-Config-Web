# Resource budgets

The app is a little tool for a controller: it should sip resources, not drink them. As in game development, where a 60 fps target shapes the whole workflow, every change fits these budgets first. The limits are in [`tools/budgets.json`](../tools/budgets.json), the single source of truth; this page explains them and keeps the last measurement. The rule is in `CLAUDE.md` ("Resource budgets").

## The budgets

| Budget | Limit | Measured how |
| --- | --- | --- |
| **Idle frames** | ≤ 10 frames/s on every page | Window shown and focused, nothing changing (a resting controller), on Controller, Pico 2 W, Games Home, a game page, App settings and About. Frames drawn = `Display::DrawAndSwap` events in a DevTools trace, counted between two marks the page puts in the trace (`console.timeStamp`) the measured stretch apart: the trace runs on in the GPU process for a moment after it is stopped (counting the whole trace read 10.1 for a page drawing exactly every 100 ms). The rate is the frames' own: intervals between the first and last frame in the window over the time they span (a plain count is off by a frame either way depending on where the window starts: 9.9 and 10.1 in one run for the same 10 Hz); frames that don't span most of the window are counted over the window. |
| **CPU shown, idle** | < 2 % of a core per page | Main + renderer + utility processes over the same idle stretch (CPU time of the app's process tree: `/proc/<pid>/stat` on Linux, user + kernel time on Windows). |
| **CPU hidden** | < 0.5 % of a core over 5 min | Every app process together, GPU included, with the window hidden in the tray (`BrowserWindow.hide()`, the page sees `data-window-hidden`). For this stretch Fake games is turned off, so the real running-game check runs: it watches this PC's `/proc` (read-only) against the test home's library (`tools/seed_test_library.mjs`, one game with a profile; `DS5_BUDGET_PROFILES=0` takes it out). The main process's share (where that check runs) is its own INFO row. |
| **Memory** | ≤ 275 MB | PSS (not RSS: shared pages counted once across processes) of every app process together **except the GPU process**, 10 minutes after start, window in the tray (Windows has no PSS: its commit is judged, see [Windows](#windows-vm-overnight)). The GPU process's PSS is reported, not judged: software rendering on the test display inflates it (owner's decision 2026-10-14: Electron's own size is physics, so the budget covers what the app controls). The macOS smoke test applies the same rule to footprint and RSS. |
| **Memory growth** | < 5 MB per 30 min | `--long` only: after a 5-minute warm-up, every minute the window visits every page and comes back to Controller, then PSS is sampled; growth = the least-squares slope over the 30 minutes (one noisy sample can't fail it). The lap presses a rail button only to change page: pressing the button of the page it was already on (Controller at the start of each lap, Games for the game page) showed or hid that page's settings panel, so the samples alternated between two page states with the renderer's PSS ~13 MB apart. Growth is judged without the GPU process, decided by the owner 2026-10-15: the software GPU in the hidden copy swings ±15 MB between samples (the same rule as the memory budget). The slope of the total, GPU process included, is reported beside it (INFO). Windows: the commit without the GPU process. |

**Reported, not judged:** the GPU process's CPU while shown, its memory, and its share of the memory growth. The test display has no graphics card, so WebGL and compositing run on SwiftShader (software): the GPU process uses 60-500 % of a core there for work a real GPU does almost for free, and it moves with the window size. Its number is still in the table, so a jump is visible. DevTools' tracing service, which only runs because we measure, is left out of every total.

### Why 10 frames a second (and not the swirl's 12.5)

The default background (the swirl field) drew 12.5 frames a second (80 ms), the art background's pan 10 (100 ms). Measured on About, a game page and Games Home, two runs each, 60 s per page (Electron 43, before the gpu-lean-2 fixes):

| Swirl frame time | Frames/s | Renderer (% core) | GPU process, SwiftShader (% core) |
| --- | --- | --- | --- |
| 80 ms (12.5 Hz) | 12.6 | 1.18-1.77 | 75-91 |
| 100 ms (10 Hz) | 10.0 | 1.03-1.68 | 61-76 |

10 Hz costs ~20 % less GPU time and ~7 % less renderer time. The swirl's clock is wall time, so it moves at the same speed either way; each step is just 25 % larger, and with slow swirls blurred across the window that isn't visible. So the budget is 10, and the swirl now draws at 10 Hz like the art pan (`SwirlField.tsx` `FRAME_MS`).

## Running it

`tools/check_budgets.sh` builds a dev build and starts **its own copy** of the app, never the one you use: its own home folder and settings (`tmp/budgets`), DevTools port 9420 (main-process inspector 9421; it refuses to start when either is taken), fully isolated by `tools/isolated.sh`: a clean environment with its own runtime folder, a virtual 1920 x 1080 display (`xvfb-run`, never your screen), a private D-Bus session that can start nothing (no portals, kscreen, wallet or tray icon on your desktop), `--password-store=basic`, and a bubblewrap sandbox with a fresh `/dev` (no `/dev/bus/usb` or `/dev/hidraw*`, so it can't reach a real board or controller). It quits through the app's own quit (`app.quit()`), and the gate fails when a core dump or a desktop helper (portal, kscreen, wallet, at-spi) appeared during the run. The board is the simulated one with the controller put down (`ds5.dev.simRest` = still); Developer card → Fake games gives it a full library with art, so it never reads Steam or Heroic. Everything runs at nice 19.

```bash
tools/check_budgets.sh             # --quick, ~10 min: 20 s per page, 5 min hidden, memory at the end
tools/check_budgets.sh --long      # ~55 min: 60 s per page, 5 min hidden, memory at 10 min, 30 min soak
tools/check_budgets.sh --no-build  # measure the build already in out/
DS5_BUDGET_PAGES=controller,about tools/check_budgets.sh        # only these pages
DS5_BUDGET_MODE='{"cpuS":60}' tools/check_budgets.sh            # other timings, for an experiment
node tools/budgets_report.mjs tmp/budgets/results.json          # the table again from a run's results
```

It prints one row per budget (and per page) with PASS, FAIL, INFO (reported only) or SKIP (not measured in this mode), the memory per process type, and exits 1 when any budget fails. The numbers come from `tools/measure_budgets.mjs`; the arithmetic and thresholds are in `tools/budgets_lib.mjs` (tested in `tests/unit/budgets.test.ts`).

### When it runs

- **Every dev release (X.Y.Z-dev.N):** `--quick`, in the same step as the fast UI check (`docs/TEST_PLAN.md`, "before a release").
- **A stable release candidate:** `--long`, for the memory growth.
- **Overnight only** (owner's rule, 2026-10-14): every budget run, on any OS, is started at night or when the owner leaves; never during her day.
- **Windows:** the same mode in the VM, the same night ([below](#windows-vm-overnight)).
- **Not in CI, not in agents' spot checks.** It needs a display server and minutes of wall time, and the shared CI runners' timing is far too noisy to judge 0.5 % of a core. An agent working on rendering measures the page it changed with `DS5_BUDGET_PAGES=<page>`.

## Windows (VM, overnight)

Most users run Windows, so the budgets are measured there too, on the **installed** app (the per-user installer) in the Windows test VM (libvirt `win11-test`). The measurement is the same script as on Linux (`tools/measure_budgets.mjs`: the same pages, frames, CPU, hidden-in-the-tray stretch, memory and soak, the same `tools/budgets.json`); only the process reader differs (`tools/procs_windows.mjs`, beside `tools/procs_linux.mjs` and the macOS smoke test's `tools/procs_mac.mjs`; the tree, roles and maths are shared in `tools/budgets_lib.mjs`).

```bash
tools/check_budgets_vm.sh --installer <...>-setup.exe      # --quick, ~12 min: install if needed, measure, table
tools/check_budgets_vm.sh --long --installer <...>.exe     # ~60 min, with the 30-minute soak
tools/check_budgets_vm.sh --build                          # cross-build a dev installer from this tree first (~5 min)
tools/check_budgets_vm.sh                                  # the app already installed in the VM
```

What it does: it puts the measuring scripts, the test game library (`tools/seed_test_library.mjs`) and the installer on a CD image (`~/VMs/test-budgets.iso`, swapped into the VM's CD drive and the previous disc put back afterwards), then runs `tools/budgets_vm.ps1` in the VM through the QEMU guest agent. That script installs the installer for the signed-in user unless that very installer (its SHA-256, kept in `C:\ds5test\installed-installer.sha256`) is the last one installed: every dev build of a branch has the same version, and a version check alone measured an older build on 2026-10-15 (silent, per user, as her), **stops every running copy of the app in the VM** (a second copy would share the 2 vCPUs), and starts the installed app in her signed-in session through the "DS5 gate launch" scheduled task (an interactive token: it never goes around the sign-in; a locked session still runs it) with its own settings folder (`C:\ds5test\budgets\userdata`), DevTools on 9420 and the main-process inspector on 9421. The VM's Node (`C:\ds5test\node`, a portable Node 22) runs the measurement as SYSTEM; the results come back to `tmp/budgets-vm/results.json` (`vm.log`, `measure.log` beside it), the copy is stopped and `C:\ds5test\budgets` removed. The script never starts, shuts down or restarts the VM; when nobody is signed in it stops and says so. The build must be a dev build (X.Y.Z-dev.N or `DS5_DEV_TOOLS=1`): the simulated board and Fake games live on the Developer card. `DS5_BUDGET_PAGES`, `DS5_BUDGET_MODE` and `DS5_BUDGET_KEEP=1` work as on Linux.

**How Windows numbers are read** (one CIM query per sample, from outside the app, so the app does no extra work because it is measured; the PowerShell and WMI processes the query starts aren't in the app's tree):

- **CPU:** `Win32_Process` user + kernel time (100 ns units), per process of the app's tree (main and its children by `--type=`: renderer, GPU, utilities by sub-type), over the measured stretch. The stretch is timed by the clock, since a sample takes about a second.
- **Memory: the commit** (`Win32_Process` `PrivatePageCount`, Task Manager's "Commit size", the private bytes: memory only this process uses, in RAM or paged out, including V8's and Chromium's committed heaps) is judged against the same 275 MB. The **private working set** (`Win32_PerfRawData_PerfProc_Process` `WorkingSetPrivate`, Task Manager's "Memory" column: the part of it in RAM right now) is reported beside it per process type, not judged. Until 2026-10-14 the working set was judged, but Windows trims a window's working set when it goes to the tray: the night run read 18.9 MB for the whole app against ~207 MB of commit (main 94, renderer 91, utilities ~22), so it measured how hard Windows squeezed the app, not what the app holds. The commit is the closer match to Linux's PSS for this budget; it reads somewhat higher (it has no share of the shared DLL pages but counts committed heap pages that are not resident).
- **GPU:** the VM has no graphics card either (WARP / SwiftShader), so the GPU process is reported, not judged, as on Linux.
- **Screen:** the window is 1920 x 1080 like on Linux, or the screen's work area when that is smaller (the VM's screen is 1024 x 768: a 1920 x 1080 window hung off it and measured a layout nobody sees). The results record the screen and the window (`display`).

**One table, three OSes:**

```bash
gh run download <mac-smoke run id> -n mac-smoke -D tmp/mac-smoke     # macOS: the smoke test's results.json
node tools/budgets_report.mjs --linux tmp/budgets/results.json --windows tmp/budgets-vm/results.json --mac tmp/mac-smoke/results.json
```

One row per budget (and page), a "measured VERDICT" column per OS, `n/a` where an OS didn't measure it, and the memory measure each OS used under it (PSS, private working set, footprint). macOS is reported, not judged: its column comes from the smoke test (shorter stretches, footprint as memory) and never changes the exit code; Linux and Windows do.

## New visuals

Every new visual states its idle cost, in the commit and in a comment where it is drawn: frames a second while shown and idle, what stops it while hidden or behind another window, and its cost on the CPU fallback (hardware acceleration off). The default is the cheaper option. Anything that draws continuously while idle needs the owner's OK and a row here.

| Visual | Idle cost (shown, focused) | Hidden |
| --- | --- | --- |
| Swirl background (default) | 10 frames/s on the shared frame clock (`frameTick.ts`); none unfocused; one with Reduce motion. The pan and zoom are a shader uniform, so a step changes only the canvas (no re-layout of the page). Without a real graphics card (acceleration off, no WebGL2, software rendering such as SwiftShader): one still frame, 0 frames/s, redrawn only on a color or theme change (`live/swirlGpu.ts`); the gate keeps the shader animated on SwiftShader with `ds5.dev.swirlGpu` so it still measures the GPU path | none |
| Art background pan | 10 steps/s on the shared frame clock; none unfocused or while a game runs | none |
| Once-a-second readouts (Pico 2 W live numbers and graphs, link rates, signal) | no frames of their own: their updates wait for the next frame clock tick (≤ 100 ms) and go out with the background's step; at once when nothing draws | none (their polls stop) |
| Pico 2 W screen mirror | reads the board's screen every 100 ms; redraws only when the picture changed, on the next frame clock tick | none |

## Last measurement

2026-10-15, `--long` on Linux (the test copy above, a quiet machine: 1-minute load 1.4-2.1 during the page rows) and in the Windows VM (the installed branch build, window 1024 x 720 on its 1024 x 768 screen), branch `budget-fixes` (the shared frame clock, the swirl's pan in its shader, the frame and memory measurement fixes) on master `5e5d377`. Idle frames are the judged interval rate; master `5e5d377` measured the same night with the same tools is beside it (frames / CPU shown).

| Page | Linux master → branch | Windows branch |
| --- | --- | --- |
| Controller | 10.5 / 2.10 % → 10.0 / 1.48 % | 10.0 / 0.05 % |
| Pico 2 W | 11.0 / 2.80 % → 10.0 / 1.77 % | 10.0 / 0.26 % |
| Games Home | 10.0 / 2.25 % → 10.0 / 1.40 % | 10.0 / 0.10 % |
| Game page | 10.0 / 1.37 % → 10.0 / 1.10 % | 10.0 / 0.18 % |
| App settings | 10.5 / 1.91 % → 10.0 / 1.31 % | 10.0 / 0.10 % |
| About | 10.0 / 1.33 % → 10.0 / 1.15 % | 10.0 / 0.13 % |

| Budget | Linux branch | Windows branch |
| --- | --- | --- |
| CPU hidden | 0.36 % | 0.22 % |
| Memory without GPU | 256.8 MB PSS | 186.9 MB commit |
| Memory growth without GPU | 3.9 MB / 30 min, PASS | 8.86 MB / 30 min, FAIL (the commit creeps on Windows: an older build crept 222 → 229 MB too; open) |
| Memory growth, all processes (INFO) | 8.27 | 8.85 |

### Earlier: 2026-10-14

2026-10-14, `--quick` (and `--long` for growth), on the test copy above (Xvfb 1920 x 1080, SwiftShader, Electron 45 beta), master at `d790438` (which has the idle-frame fixes from `gpu-lean-2`) against this branch (swirl at 10 Hz, the cheaper running-game check). Per-page CPU is main + renderer + utility in % of one core over 20 s; ±0.3 between runs is noise.

| Page | Frames/s master → branch | CPU shown master → branch | Verdict on branch |
| --- | --- | --- | --- |
| Controller | 12.8 → 10.6 | 2.45 → 2.1 | FAIL (just over both) |
| Pico 2 W | 23.2 → 20.4 | 5.3 → 4.95 | FAIL: the screen mirror redraws 10/s on top of the background |
| Games Home | 12.4 → 10.0 | 2.15 → 1.75 | PASS |
| Game page | 12.6 → 10.0 | 1.65 → 1.4 | PASS |
| App settings | 12.6 → 10.0 | 1.5 → 1.25 | PASS |
| About | 12.6 → 10.0 | 1.65 → 1.4 | PASS |

| Budget | master | branch | Verdict on branch |
| --- | --- | --- | --- |
| CPU hidden, 5 min, test library with a game profile | 0.40 % (main 0.37) | 0.33 % (main 0.31) | PASS |
| CPU hidden, 5 min, no game profiles | 0.40 % (main 0.38) | 0.11 % (main 0.08) | PASS |
| Memory (PSS) at 10 min without the GPU process | 253 MB | 246 MB | PASS |
| GPU process PSS (reported) | 286 MB | 274 MB | INFO |
| Memory growth over 30 min | - | not run on this base (an earlier `--long` on Electron 43: +4.1 MB) | runs at the release check |

**Memory** without the GPU process is within the 275 MB budget: renderer ~100 MB, main ~95, network service ~27, zygote ~24 (DevTools' tracing service, ~21 MB, is left out). The GPU process adds ~275 MB on SwiftShader (software framebuffers); it is reported so a jump shows.

**The running-game check (Linux)** used ~3.2-3.7 ms a pass on a desktop with ~1000 processes, every 2 s. It now reads each of your processes' short `stat` file instead of `status`, does the costly reads (owner, Wine, environment, command line) once per process and program, and looks every 10 s while the window is in the tray and no game has a profile (2 s otherwise, so profile switching is as quick as before). Main-process JavaScript time over 2 minutes in the tray: 432 → 312 ms with a profile, 392 → 67 ms without.
