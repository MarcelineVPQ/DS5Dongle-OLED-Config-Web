# Resource budgets

The app is a little tool for a controller: it should sip resources, not drink them. As in game development, where a 60 fps target shapes the whole workflow, every change fits these budgets first. The limits are in [`tools/budgets.json`](../tools/budgets.json), the single source of truth; this page explains them and keeps the last measurement. The rule is in `CLAUDE.md` ("Resource budgets").

## The budgets

| Budget | Limit | Measured how |
| --- | --- | --- |
| **Idle frames** | ≤ 10 frames/s on every page | Window shown and focused, nothing changing (a resting controller), on Controller, Pico 2 W, Games Home, a game page, App settings and About. Frames drawn = `Display::DrawAndSwap` events in a DevTools trace. |
| **CPU shown, idle** | < 2 % of a core per page | Main + renderer + utility processes over the same idle stretch (`/proc/<pid>/stat` ticks of the app's process tree). |
| **CPU hidden** | < 0.5 % of a core over 5 min | Every app process together, GPU included, with the window hidden in the tray (`BrowserWindow.hide()`, the page sees `data-window-hidden`). For this stretch Fake games is turned off, so the real running-game check runs: it watches this PC's `/proc` (read-only) against the test home's library (`tools/seed_test_library.mjs`, one game with a profile; `DS5_BUDGET_PROFILES=0` takes it out). The main process's share (where that check runs) is its own INFO row. |
| **Memory** | ≤ 275 MB | PSS (not RSS: shared pages counted once across processes) of every app process together **except the GPU process**, 10 minutes after start, window in the tray. The GPU process's PSS is reported, not judged: software rendering on the test display inflates it (owner's decision 2026-10-14: Electron's own size is physics, so the budget covers what the app controls). The macOS smoke test applies the same rule to footprint and RSS. |
| **Memory growth** | < 5 MB per 30 min | `--long` only: after a 5-minute warm-up, every minute the window visits every page and comes back to Controller, then PSS is sampled; growth = the least-squares slope over the 30 minutes (one noisy sample can't fail it). |

**Reported, not judged:** the GPU process's CPU while shown, and its memory. The test display has no graphics card, so WebGL and compositing run on SwiftShader (software): the GPU process uses 60-500 % of a core there for work a real GPU does almost for free, and it moves with the window size. Its number is still in the table, so a jump is visible. DevTools' tracing service, which only runs because we measure, is left out of every total.

### Why 10 frames a second (and not the swirl's 12.5)

The default background (the swirl field) drew 12.5 frames a second (80 ms), the art background's pan 10 (100 ms). Measured on About, a game page and Games Home, two runs each, 60 s per page (Electron 43, before the gpu-lean-2 fixes):

| Swirl frame time | Frames/s | Renderer (% core) | GPU process, SwiftShader (% core) |
| --- | --- | --- | --- |
| 80 ms (12.5 Hz) | 12.6 | 1.18-1.77 | 75-91 |
| 100 ms (10 Hz) | 10.0 | 1.03-1.68 | 61-76 |

10 Hz costs ~20 % less GPU time and ~7 % less renderer time. The swirl's clock is wall time, so it moves at the same speed either way; each step is just 25 % larger, and with slow swirls blurred across the window that isn't visible. So the budget is 10, and the swirl now draws at 10 Hz like the art pan (`SwirlField.tsx` `FRAME_MS`).

## Running it

`tools/check_budgets.sh` builds a dev build and starts **its own copy** of the app, never the one you use: its own home folder and settings (`tmp/budgets`), DevTools port 9420 (main-process inspector 9421; it refuses to start when either is taken), a virtual 1920 x 1080 display (`xvfb-run`, never your screen), a private D-Bus session (no tray icon on your desktop), and a bubblewrap sandbox with a fresh `/dev` (no `/dev/bus/usb` or `/dev/hidraw*`, so it can't reach a real board or controller). The board is the simulated one with the controller put down (`ds5.dev.simRest` = still); Developer card → Fake games gives it a full library with art, so it never reads Steam or Heroic. Everything runs at nice 19.

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
- **Not in CI, not in agents' spot checks.** It needs a display server and minutes of wall time, and the shared CI runners' timing is far too noisy to judge 0.5 % of a core. An agent working on rendering measures the page it changed with `DS5_BUDGET_PAGES=<page>`.

## New visuals

Every new visual states its idle cost, in the commit and in a comment where it is drawn: frames a second while shown and idle, what stops it while hidden or behind another window, and its cost on the CPU fallback (hardware acceleration off). The default is the cheaper option. Anything that draws continuously while idle needs the owner's OK and a row here.

| Visual | Idle cost (shown, focused) | Hidden |
| --- | --- | --- |
| Swirl background (default) | 10 frames/s (4 unfocused); none with Reduce motion | none |
| Art background pan | 10 steps/s (4 unfocused); none while a game runs and the window isn't focused | none |
| Pico 2 W screen mirror | 10 frames/s: it reads the board's screen every 100 ms and redraws every reading, changed or not (over budget together with the background: see below) | none |

## Last measurement

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
