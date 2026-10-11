# Test Plan

_Last updated: 2026-10-10_

## Overview

Vitest runs three categories, all without hardware or a network:

| Category        | Path                 | What it proves                                                                                                     |
| --------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Unit**        | `tests/unit/`        | Byte-level codecs match the firmware (`Config_body`, remap block, `0xF1` identity) and display helpers are correct |
| **Integration** | `tests/integration/` | `Ds5BridgeClient` follows the firmware's command rules end to end against `tests/support/fakeDongle.ts`             |
| **Security**    | `tests/security/`    | USB and URL allowlists, and the Electron window/session/CSP baseline                                               |

Hardware-in-the-loop checks (below) cover what a fake can't.

## Running Tests

```bash
npm test                       # all
npm run test:coverage          # with v8 coverage (text + coverage/index.html)
npx vitest run tests/security  # one category
npx vitest -t "remap"          # by name
```

## The fake dongle

`tests/support/fakeDongle.ts` implements `Ds5Transport` with the firmware's rules from `src/cmd.cpp`:

- every `0xF6` SET bumps the u16 sequence and records the function
- deferred functions (save, slot ops, reboot, BOOTSEL, factory reset, trigger preview) report `PENDING` for N identity reads, then `OK`/`FAILED`
- a deferred function while another is pending is `BUSY`
- out-of-range slot (> 3) / trigger preset (> 6) is `INVALID`
- reboot / BOOTSEL make the device vanish (`DeviceGoneError`) before any further reply
- unknown report ids stall (`ReportStalledError`)

When the firmware protocol changes, change the fake in the same commit, or the integration tests stop meaning anything.

## Writing new tests

- Codec change: a round-trip test plus a fixed-bytes test against the firmware layout (offsets from `src/config.h` / `src/cmd.cpp`).
- New command: a fake-dongle behavior and an integration test for success and the failure result.
- Security-relevant change: extend `tests/security/`. Those tests intentionally read source text (window options, CSP) so the baseline can't drift unnoticed.

## Hardware-in-the-loop (before a release)

On the release firmware with a paired DualSense:

1. App auto-connects; the live controller shows the controller's model and colorway, battery, signal, player and slot.
2. Live view: every button, D-pad direction, PS, mute and touchpad click lights up; L2/R2 fill with the pull; sticks move (L3/R3 light); touches show as dots; the lightbar and player indicator match the controller. On a DualSense Edge, the Fn and back-paddle chips light.
3. Grips → haptics gain: verify over HID (`scripts/` or OLED Settings), Revert restores it, Save persists across a dongle power cycle.
4. Lightbar strips → mode and favorites change the controller LED live.
5. A button → remap it to another, Apply, confirm in a game or `evtest`; the part shows as remapped; Reset all.
6. PS → slots: switch to an empty slot and back (press PS each time).
7. L2/R2 → every trigger preset is felt; closing the panel turns it off.
8. Dongle → Advanced: counters move while audio plays; drops stay 0 (`scripts/audio_diag.py 10` agrees).
9. Dongle → Restart and Enter BOOTSEL both return/mount as described; Check now spins, then reports the result.
10. First-time setup: a Pico in BOOTSEL is found, the bundled firmware installs with one click, pairing brings the dongle up.
11. Linux: the dongle connects with no driver install. Windows and macOS: untested until someone tries them; they're labelled so.
12. **Layout in every language:** with the dongle connected, `node tools/check_layout.mjs` opens every screen and panel in all 7 languages at 1100×900 and 900×650 and must report nothing clipped or spilling. (`tests/unit/i18nFit.test.ts` guards the tile words in CI; this covers the rest.)
13. **Narrator:** connect, slot switch and a line over game audio play cleanly on the controller speaker.
14. **Updater** (packaged builds, loopback feed with a test key): refuses older versions, bad checksums and unsigned feeds; installs, restarts into the new version (task #29's procedure).
15. **Games:** spot-check a few with adaptive triggers and haptics.
