# Several boards on one PC (design, 2026-10)

Status: **Part 1 shipped in 0.9.5-dev.19** (the safety fix, below). **Part 2 is the design for 0.9.6**: nothing in it is built yet. BACKLOG rows: "Several boards: tell them apart, never update the wrong one" (shipped), "Full multi-board support (0.9.6)", "Settings and pairing with no controller connected", "Controller switcher in the rail", "Per-controller settings", "Multi-controller testing (fake slots)".

Marcy's requirement (2026-10-17): "we need to automatically account for multiple dev boards connected", and "flexible, it could be 20". Every rule here is for **any number of boards**: no two-board assumptions in data, UI or tests.

## 1. What a board is to the app

| Fact | Where |
| --- | --- |
| The USB serial is the **paired controller's MAC** (else the slot's stored MAC, else the flash id), on purpose: Wine / Steam match the controller by it. Two boards paired to one DualSense present **the same serial**. | firmware `usb_descriptors.cpp` `STRID_SERIAL` |
| The **board id** (protocol 1.20): the Pico's flash unique id, identity `[50..57]` with `[49]` bit 0. Never changes, whatever controller is paired. This is how the app tells boards apart. | firmware `cmd.cpp`, app `decodeIdentity().boardId` |
| **Identify** (protocol 1.20): `0xF6 0x1A [tenths]` shows **THIS ONE**, the board name and the slot, flashing at full brightness over every screen and power state (3 s by default, 10 s max, 0 stops); the board LED blinks in step (boards without the OLED). The dim / off timers are not touched, so the screen and LED go back to what they were. | firmware `identify_screen.h`, app `Ds5BridgeClient.identify()` |
| A board's **configurator interface is on USB only while a controller is connected**. | firmware `usb_power.h` (below) |

### When a board is on USB at all

`usbpm::Mode` decides what the board presents:

- **Full** (the DualSense: audio + HID + the vendor configurator interface): only while a controller is connected (`usb_power_controller(true)` from `bt.cpp` on the HID interrupt channel).
- **Keyboard** (only the wake keyboard, `2E8A:000A`, no vendor interface): no controller, and "PS button wakes the PC" on.
- **Off** (detached, nothing on USB): no controller and wake off, the default. `main()` boots detached (`tud_disconnect()`), and `kBootGraceUs` (3 s) gives a paired controller time to reconnect first.

So **a board without a connected controller is invisible to the app** (Marcy's bench, 2026-10-17: board #3, no controller paired, shows nothing in `lsusb`; her main board without its controller shows only the wake keyboard). Part 1 can't list such a board: there is nothing to open. Section 9 proposes the firmware change that would make it reachable.

## 2. Part 1, shipped in 0.9.5-dev.19 (the safety fix)

The smallest change so nothing goes wrong with 2 or 20 boards:

- **Identity**: firmware protocol 1.20 adds the board id and Identify (backward compatible: a 1.19 app reads 49 bytes and never sees them; this app reads 58 and treats an older board as "no id").
- **Drafts**: "the same board" (staged buttons, calibration, curves, PC sleep options kept across a reconnect) is the board id when the firmware has one, the USB serial only on older firmware (`slotSettings.ts sameBoard`).
- **Firmware updates never write an ambiguous target** (`firmwareUpdate.ts`, `hooks/boards.ts chooseBootTarget`): before the reboot the app records the board's id and the BOOTSEL devices already on USB; afterwards it writes the bootloader whose USB serial is the board id (the boot ROM names itself by the chip id; both byte orders are accepted until QC confirms the real one), else the one BOOTSEL device that appeared since, checked again 0.5 s later. Several new ones, or several and none identifiable: it stops with *"N boards are in update mode, so the app can't tell which one to update. Unplug the ones you don't want to update, then try again."* (`desktop.firmware.severalBootsel`). The setup screen's Install and Install again follow the same rule (`onlyBootloader`). The board flashes THIS ONE before it reboots (at least 2 s).
- **The update comes back to its board**: a board that leaves USB on purpose (BOOTSEL, reboot, USB reconnect: `Ds5BridgeClient`'s `onLeaveBus`) is waited for (`EXPECT_BACK_MS`, 90 s) instead of showing another board, and the update's version check only counts the board it wrote.
- **Connecting**: `useDs5Bridge` lists every board (`listBoards`), shows the last one used (`ds5.lastBoardId`, by board id) or else the first, and flashes its THIS ONE screen when 2+ boards are present.
- **The rail's board stack** (Marcy's design, below) replaces the single status row when there are 2+ boards (or a simulated one).
- **Tests**: `tests/unit/boards.test.ts` (start choice with 1/2/20 boards, the bootloader choice with 20 in BOOTSEL, same-serial boards, Identify on old firmware), `tests/integration/multiBoard.test.ts` (2 boards with the same serial, last used, switching, 20 boards with the list and search, the update target with 19 others in BOOTSEL, the ambiguous stop), `saveBar.test.ts` ("another board" now has the same serial and another id).

## 3. The board stack in the rail (Part 1, Marcy's design)

Marcy, 2026-10-17, looking at the rail's bottom status row: *"I am going to assume we are just going to keep stacking them here, that can also act as a switcher."* So the status row becomes a stack, inside `AppRail.tsx` (one component, the rail's own classes):

- **One row per board**: the board name (or "Simulated board"), its firmware version, and its controller and slot ("DualSense · Slot 0", "No controller · Slot 0", or "Used by another program" / "Can't be read"). A heading says "N boards connected" (`role="status"`).
- **The board in use is marked** like the active page (accent bar, `aria-current`), with a ✓ only for a real board in use; others show a plain dot, "!" when they can't be read.
- **A click on another row switches to it** and flashes its THIS ONE screen; a click on the board in use only flashes it. Remembered for the next start.
- **Many boards**: at most `BOARD_ROWS` (3) rows, the board in use always among them; the rest are in **"N more…"**, the app's one popup menu (`MenuButton`, now with a header slot) holding a search field and every board as a radio item. The search matches name, controller, slot, version and id. The list scrolls (60 % of the window at most). With 20 boards the rail's items never move.
- **Collapsed (icons only)**: only the board in use, with the number of boards on its icon, and the list button, so switching works from a locked rail too.
- **Keyboard and screen readers**: rows are buttons with full labels and a description of what a click does; the list opens on the search field, ↓ goes to the boards, Escape returns to the button.
- **The simulated board** (Developer card → Simulate the board) is a row in the same stack, never a green check (a flask icon, neutral colors), switchable like a real one. It now sits **beside** real boards instead of replacing USB. Developer card → "More simulated boards" (0–19) adds extra simulated boards (each its own id, every other one the first one's serial) to see the stack with up to 20.
- **"Pretend more controllers" (fake slots)** is about controllers on one board, not boards: those fakes stay in Pairing slots and show in the board row's controller/slot line when one is picked. See section 7.

Idle cost: none (CSS only). Polling: only the board on screen polls (1 s); the others are read once when they show up, after a switch and every 15 s while the window is shown (`OTHER_BOARDS_MS`; hidden: nothing), four at a time at most.

## 4. Auto-detecting all boards (0.9.6)

Part 1 lists the boards it can open. 0.9.6:

1. **Hot-plug**: already event-driven (WebUSB connect / disconnect); keep the slow 15 s read for the others' controller and slot. Replace it with a cheap "summary" GET (a new 0xF1-sized report with board id, slot, controller, battery and version in one 63-byte reply) so a read of 20 boards is 20 transfers, not 40.
2. **Boards without a controller** (section 9): list them once the firmware keeps a configurator presence.
3. **Boards in BOOTSEL** appear as rows too ("Update mode"), with Install, using the same `chooseBootTarget` rule.
4. **Names**: let the user name a board ("Desk", "Couch") and pick its color; stored per board id (section 5). The name shows on the row and in the identify screen (firmware: a 16-character name in the config page, a protocol minor).

## 5. Per-board settings and profiles (0.9.6)

- **Where things live today**: the board's settings (haptics, light bar, remaps, speaker, PC sleep) are on the board itself (its flash); calibration and stick curves per pairing slot on the board. The app keeps App settings (this PC) and game profiles.
- **Per board, on the board**: nothing changes; switching boards shows that board's settings, as now.
- **Per board, in the app**: a small record per board id in the app's settings file: `boards: { [boardId]: { name, color, lastSeen, lastSlot, lastController, profileOverrides? } }`. Bounded (forget boards not seen for 90 days, or by hand in App settings → Boards), and it is the cache-pass row for it. Never keyed by the USB serial.
- **Per controller**: the "Per-controller settings" row (each controller keeps its own haptics / light bar / remaps / speaker). With several boards a controller can move between boards (Marcy's DualSense moved to board #3 after the flash), so per-controller settings belong to the **controller** (by its MAC, which the board knows per slot), and the board applies them when that controller connects. Firmware: a per-slot settings block, like calibration. App: the stack's row shows the controller, and the Controller page edits that controller's settings on whatever board it is on.
- **Profiles** (per game) stay per game; which board they apply to is section 6.

## 6. Games and profiles: the board the game's controller is on (0.9.6)

- A game's profile applies to **the board whose controller the game uses**, not to the board on screen. Linux: the game's process opens a hidraw node; its USB parent is a board (`/sys/class/hidraw/*/device` → the USB device → its `serial` and the configurator interface's board id via the app's own open). Windows: the HID device instance path's parent is the USB device (`CM_Get_Parent`, the same API our Proton patch touches). macOS: IOKit's registry parent.
- One running game on one board: apply its profile there; the board on screen may differ, and the stack row of that board shows a game badge.
- Two games on two boards (local co-op on one PC, or two players): each profile to its own board. The save bar's "Save to profile" saves the board on screen's settings.
- When the game's board can't be found (older OS paths, the controller over Bluetooth directly): fall back to the board on screen and say so on the game page.

## 7. The "fake slots" developer mode

"Pretend more controllers" fakes **controllers in one board's slots** (drawing, colors, slot), for one board. It is not a board simulator and stays as is. The board simulator is "Simulate the board" + "More simulated boards"; both are rows in the stack. Tests for many boards use the simulated boards (`SimulatedDongle` with `boardId` / `serial`, `extraSimulatedBoards()`), never real hardware. In 0.9.6 the fake slots should key their placement per board id (today they read one global slot occupancy).

## 8. Updating several boards (0.9.6)

- **One after another, never two at once**: two boards in BOOTSEL at the same time is exactly the ambiguity Part 1 refuses. The queue: board A → identify → BOOTSEL → write → back on USB (its controller reconnects) → verify version → board B …
- **Progress view**: a "Update all" button on the Firmware section when 2+ boards are behind; the banner becomes a list, one line per board: name, current → new version, step (waiting · identify · BOOTSEL · writing 37 % · restarting · ✓ done · ✗ failed + Install again), and "Update all" can be cancelled between boards.
- **Boards without a controller come back invisible** (section 1): until section 9 lands, the queue waits for each board's return (press PS on its controller) with a clear line, "Press PS on the controller of <name> to finish", and a Skip.
- **A failure stops the queue** at that board (it is in BOOTSEL with no firmware; the line offers Install again for exactly that board, by id). The others are untouched.
- The bundled firmware is written to every board; a dev build to one board at a time only.

## 9. Boards with no controller connected (firmware proposal, not built)

Today a board without a controller is Off (or only the wake keyboard). That is load-bearing: a real DualSense that is off is not on USB either, so Steam, Wine and games never see a ghost gamepad.

**Proposal**: while no controller is connected, present a **configurator-only device** with its own VID/PID (like the wake keyboard has `2E8A:000A`), e.g. one vendor-class interface (the existing `vendor_itf`, MS OS 1.0 descriptors for WinUSB) under a Raspberry Pi test PID or our own. Nothing binds it as a gamepad (different VID/PID, no HID), so Steam / Wine / SDL are unaffected. When the controller connects, the board detaches and attaches as the DualSense, as today (`Act::Present`).

Weighing it:

- **Gains**: every board is listed ("Pico 2 W · no controller"), Settings and pairing work without a controller (the existing "Settings and pairing with no controller connected" idea), Update all works without pressing PS, Identify works on a board nobody can find.
- **Risks**: (1) PC sleep: an attached device while the PC sleeps must not wake it; the configurator-only device would not ask for remote wakeup, and the keyboard mode already shows the bus can be attached idle. With wake on, the device must be keyboard **plus** vendor interface (a composite), which changes the wake keyboard's descriptor: retest remote wakeup on Linux, Windows and macOS. (2) Windows caches descriptors per VID/PID/bcdDevice: a new PID gets its own entry, so the first plug installs WinUSB once more. (3) Linux: the app's udev rule (Set up USB access) and `electron/main/devices.ts` must add the new id (a security-audit change). (4) A detach/attach on every controller connect and disconnect was already there with the keyboard; without wake it is new (Off → configurator was never on the bus). (5) Hosts see "a device" appear on every board boot.
- **Recommendation**: do it in 0.9.6 behind a setting ("Stay reachable without a controller", default on only after a hardware pass on all three OSes), as one protocol minor, with the usb_power host tests extended (Off ↔ ConfigOnly ↔ Full ↔ Keyboard+Config). Not in dev.19: it changes USB presence during the code freeze.

## 10. USB bandwidth and polling with many boards

- Each board is its own USB device: control transfers to different boards don't share a session, so reads of several boards can overlap (bounded: four at a time, `BOARD_READS_AT_ONCE`). One board's requests stay serial (one session).
- The board on screen polls its identity every 1 s and its settings every 2 s; the live controller view reads input ~30 Hz and the OLED mirror ~10 Hz, **only for the board on screen**. The others: one identity + version read per 15 s while the window is shown, nothing while hidden. 20 boards = 40 small control transfers per 15 s (~3 per second), far below anything a USB 2.0 bus notices.
- Audio and HID go to the OS, not the app: 20 boards streaming audio is the OS's and the bus's budget (each board's isochronous audio endpoints); 20 DualSense audio devices on one root hub will exceed USB 2.0 full-speed bandwidth long before the app matters. The design doc for Local co-op owns that.
- The tray and the hidden-window budget (< 0.5 % CPU) are unchanged: the other boards' reads stop while hidden.

## 11. Identifying a board physically

- **Part 1**: THIS ONE on the OLED (inverted / normal every 0.4 s, full brightness, the board name and slot), the LED blinking in step for boards without the OLED. Automatic when the app connects while 2+ boards are present, on a switch, and before a firmware update; by hand with a click on the board in use. Disabled on boards before protocol 1.20 (the client refuses with the keyed message; the stack just doesn't flash them).
- **0.9.6**: the board's own name on the identify screen (section 4); the controller's light bar flashes too when one is connected (the identify could add a light bar pulse through the existing state override, a protocol minor); the app's row flashes in step so eye and screen meet.

## 12. Windows and macOS

- **Board id, Identify, the stack, the update target rule**: plain WebUSB and PICOBOOT, the same on Linux, Windows and macOS.
- **Windows**: each board needs WinUSB on its configurator interface (MS OS 1.0 descriptors; the first plug of each board installs it). The boot ROM's USB serial is readable through WebUSB on every OS, so the update target rule holds. A board held by another program shows "Used by another program" on its row.
- **macOS**: covered by the macOS smoke test like the rest of the app (a real Apple Silicon Mac, the simulated board, no hardware attached); nothing here is OS-specific.
- **Games on the game's board** (section 6) is OS-specific by nature (hidraw / SetupAPI / IOKit), one implementation per OS behind one "which board is this game's controller on" call.

## 13. QC with two (or more) real boards

1. Both boards with a controller connected (the configurator interface is only there then): the stack shows two rows, the one in use marked; THIS ONE flashed on it at start.
2. Click the other row: it switches, and THIS ONE flashes on that board; click the row in use: it flashes again.
3. Firmware update on one board while the other is plugged in: THIS ONE flashes on the right board, only that board reboots and is written, the app comes back to it. Then the boot ROM's USB serial vs the board id (byte order) on a real RP2350: `lsusb -v -d 2e8a:000f | grep iSerial` while in BOOTSEL, compared with the row's id (App DevTools: `bridge.identity.boardId`).
4. Both boards in BOOTSEL by hand, then Install on the setup screen: it refuses with the "unplug the others" message.
5. The identify screen on a dimmed and on an off screen: it wakes, flashes, and goes back to dimmed / off.
