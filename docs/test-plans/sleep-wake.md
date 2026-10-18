# Test plan: audio and haptics after sleep/wake

BACKLOG: "Test: audio and haptics after sleep/wake (internal)", Fix first #16.
Why: PadSense-CE's bridge dies after the second sleep/wake (its issue #4), and
our PC sleep options (controller off when the PC sleeps, PS button wakes the
PC) shipped in 0.9.5-dev.9. Nobody had checked that ours survives several in a
row.

Two halves:

- **Windows VM** (done, below): `tools/sleep_wake_vm.mjs`, the installed app
  and the simulated board, repeatable, run by an agent.
- **Real hardware, Linux and Windows** (waits for the owner's pre-stable QC,
  the "Release gate: hardware checks before 0.9.5 stable" row): the board,
  a DualSense, real sleep. The steps are at the end.

## What a sleep looks like to the app

The app itself doesn't listen for power events (no `powerMonitor` in
`electron/`); what changes for it is the board. The firmware's
`src/usb_power.{h,cpp}` (DS5Dongle) does this, with the defaults (controller
off when the PC sleeps on, PS button wakes the PC off):

1. The PC sleeps: the USB bus suspends. After 3 s of suspend the board drops
   the controller's Bluetooth link and the DualSense turns off. The board
   stays on USB as the DualSense; it never touches the bus while it is
   suspended.
2. The PC wakes: the bus resumes. With no controller the board leaves USB
   after its 2 s resume grace (`kResumeGraceUs`): the app sees a USB
   disconnect and shows "Waiting for the Pico 2 W…".
3. The user presses PS: the controller reconnects, the board comes back on
   USB as the DualSense (audio + HID + configurator), and the app connects to
   it again on its own (`useDs5Bridge`'s USB `connect` listener).

Meanwhile Windows sends the app's windows `WM_POWERBROADCAST`
(`PBT_APMSUSPEND` before the sleep, `PBT_APMRESUMESUSPEND` and
`PBT_APMRESUMEAUTOMATIC` after it), Chromium's power monitor tells its
network service and timers, and the whole app is frozen while the PC sleeps,
then runs on with its wall clock jumped forward.

## Windows VM: `tools/sleep_wake_vm.mjs`

```bash
node tools/sleep_wake_vm.mjs                      # 3 cycles, 60 s asleep each (~9 min)
node tools/sleep_wake_vm.mjs --cycles 5 --sleep 120 --out tmp/sleep-wake-vm
node tools/sleep_wake_vm.mjs --cycles 1 --sleep 10 --no-return   # negative control: must FAIL
```

Needs the Win11 VM (libvirt `win11-test`, the guest agent) running with
Marcy's account signed in, and a dev build (X.Y.Z-dev.N) installed there (the
simulated board is on its Developer card). The report goes to
`tmp/sleep-wake-vm/report.json`. The script never starts, shuts down,
restarts or resets the VM, and attaches no USB device: Marcy's board stays on
Linux.

### Why not a real sleep

The VM has no sleep state: `powercfg /a` in the guest lists S1, S2, S3,
hibernate and S0 Low Power Idle (Modern Standby) as "not supported by the
system firmware", because the domain's `<pm>` has suspend-to-mem and
suspend-to-disk off, so QEMU's ACPI offers neither. Turning them on needs the
domain changed and the VM restarted, which this test must not do, and
`guest-suspend-ram` / `dompmwakeup` need it too. So each cycle builds the
sleep from the parts the app can notice:

| Step | What it does | Stands in for |
|---|---|---|
| 1 | `tools/sleep_wake_vm.ps1 -Event suspend`, run in the signed-in session (a scheduled task; window messages don't cross from the agent's session 0): `WM_POWERBROADCAST` `PBT_APMSUSPEND` to every top-level window of the app's processes, Chromium's `Base_PowerMessageWindow` included | Windows' sleep broadcast |
| 2 | The simulated dongle's controller turned off | The board dropping the controller after 3 s of USB suspend |
| 3 | `virsh suspend` for `--sleep` seconds: every guest CPU, timer, poll and socket stops | The PC asleep (S3) |
| 4 | `virsh resume`, then the guest clock set to now (`virsh domtime --now`), then `PBT_APMRESUMESUSPEND` + `PBT_APMRESUMEAUTOMATIC` | The wake: the wall-clock jump and Windows' resume broadcast |
| 5 | 2 s later the simulated board leaves USB ("away"); 8 s later it is back ("dongle", a new device, controller connected) | The board hiding after its resume grace, then PS pressed |

The guest agent must answer within 60 s of every wake; if it doesn't, the
script stops and says so, and leaves the VM as it is (no reset).

After every wake, and once before the first sleep (the baseline), it checks
through the app's DevTools (page) and inspector (main process):

| Check | Pass when |
|---|---|
| `agent` | the guest agent answers after the wake |
| `pageAnswers` | an evaluation answers in < 2 s and a frame is drawn |
| `pageSwitches` | two rail pages open (`aria-current="page"`) |
| `powerEvents` | Electron's `powerMonitor` saw `suspend` and `resume` (the broadcast reached Chromium) |
| `reconnected` | the rail shows the board connected again within 30 s, on its own |
| `controllerBack` | the board's identity says a controller is connected |
| `audioPath` | 0xF5 through the app's own client: core1 at stage 9 (running), started, no speaker-encoder / mic-decoder failure, its loop counter moving |
| `configKept` | the board's config (haptics, speaker, mic, triggers, …) equals the baseline's |
| `haptics` | a grip haptics test (0xF6 0x0E, both grips) is accepted |
| `noErrors` | no uncaught exception or console error in the page or main that the baseline didn't already have |
| `cpuIdle` | 10 s after the checks, the app's CPU over 20 s (main + renderer + utility, the GPU process reported apart) is under the shown-idle budget, `tools/budgets.json` `shownCpu` (2 % of a core) |

The client and the simulated board are found from outside the bundle: the
client in the React fiber tree (the bridge hook's state), the board as
`devPreview.ts`'s module-level `simBoard`, read through the `[[Scopes]]` of a
function from the same bundle (DevTools). Nothing is added to the app for the
test.

### What it proves, and what it doesn't

Proves, on Windows, with the installed build:

- The app survives a full freeze of the machine and a wall-clock jump, three
  times in a row: the page answers, pages switch, timers and polls resume,
  and nothing throws.
- Chromium hears the suspend/resume broadcast (Electron's `powerMonitor`
  fires) and the app carries on through it.
- The app's reconnect path after a wake (board gone, then back as a new
  device) works every time, without a restart or a replug, and the board's
  settings, core1 state and haptics command path read back the same.
- The CPU goes back to idle after each wake (no runaway poll or timer).

Doesn't prove (real-hardware QC, below):

- Real S3 / Modern Standby: drivers, USB selective suspend, the real USB
  disconnect/connect Windows does around a resume, WinUSB re-enumeration.
- The firmware: the real `usb_power` state machine, Bluetooth reconnecting,
  core1's audio pipeline (speaker Opus encoding, mic decoding) after a sleep.
  The simulated board only models core1's loop counter; USB audio frames and
  Bluetooth packets stay 0 in the simulation.
- Windows' audio endpoints coming back (the DualSense speaker / mic devices)
  and sound actually playing; HD haptics felt in the grips.
- The controller idling off by itself (as opposed to the board turning it
  off at sleep).

### Results

Run 2026-10-17, 0.9.5-dev.17 installed in `win11-test` (4 vCPUs, Windows 11
26300), simulated board, 3 cycles of 60 s asleep: **PASS 3/3**.

| | Reconnect after the board is back | Guest clock jump | Power events | core1 | Grip haptics | New errors | App CPU (judged; GPU apart) |
|---|---|---|---|---|---|---|---|
| Baseline | (connected) | | | stage 9, running | accepted | (2, see below) | 0.84 % (GPU 0.15 %) |
| Cycle 1 | 0.08 s | +61 s | suspend, resume | stage 9, running | accepted | 0 | 0.46 % (GPU 0.30 %) |
| Cycle 2 | 0.05 s | +60 s | suspend, resume | stage 9, running | accepted | 0 | 0.46 % (GPU 0.23 %) |
| Cycle 3 | 0.05 s | +60 s | suspend, resume | stage 9, running | accepted | 0 | 0.39 % (GPU 0.31 %) |

Every cycle: the guest agent answered at once after `virsh resume`, the page
answered (≤ 10 ms) and switched pages, the app showed "Waiting for the Pico 2
W…" while the board was off USB and reconnected on its own when it came back,
the controller showed as connected, and the board's config read back equal
to the baseline's. Nothing degraded from cycle to cycle (PadSense-CE's
failure is on the second). The test copy quit cleanly (`app.quit()`, gone in
4 s); the VM was left running with the agent answering.

Seen along the way:

- **Chromium closes DevTools sockets on the suspend broadcast** (every
  cycle): the test reconnects (`cdp_lib.mjs` now fails calls on a closed
  socket instead of waiting forever). A sign the broadcast really reached
  Chromium's power monitor; not an app problem.
- **Baseline only, not sleep-related:** with Games not allowed (a fresh
  profile) the backdrop asks for game art anyway, and main logs
  `Error occurred in handler for 'desktop:games-details': gamesNotAllowed`
  once per page load. BACKLOG row "Games off: the backdrop's game-art request
  logs an error in main at every start (internal)", fixed in 0.9.5-dev.19.
- Negative control (`--no-return`, 1 cycle): FAIL as it should
  (`reconnected`, `controllerBack`, `audioPath`, `configKept`, `haptics`
  false), so the checks can fail.

## Real hardware (pre-stable QC, owner)

On Linux and on a real Windows PC (not the VM), the board on USB with a
DualSense connected, the release build, sound playing to the controller
speaker and a game or the app's grip test giving haptics:

1. Sleep the PC (Linux: `systemctl suspend`; Windows: Start → Power → Sleep),
   wait at least 10 s (past the 3 s power-off), wake it.
2. Press PS. The controller reconnects; the app shows it within a few
   seconds without replugging.
3. Check: speaker plays (Controller → Speaker test, then game audio), mic
   level moves (Controller → Microphone), HD haptics felt in both grips,
   Pico 2 W → Diagnostics counters move with drops at 0.
4. Repeat steps 1–3 at least twice more (PadSense-CE fails on the second).
5. Once more with **Turn off the controller when the PC sleeps** turned off: the
   controller stays on; after the wake sound and haptics come back by
   themselves.
6. Once with the controller left to idle off by itself first (its own
   power-saving timeout), then sleep and wake.
7. Linux: `journalctl -b -k | grep -i -E 'usb|054c'` shows no reset loop;
   Windows: Device Manager shows no warning on the DualSense devices.
