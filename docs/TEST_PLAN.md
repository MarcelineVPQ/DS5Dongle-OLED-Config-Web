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

1. App auto-connects, Overview shows firmware/protocol/CPU/controller state.
2. Change haptics gain, verify over HID (`scripts/` or OLED Settings), Revert restores it, Save persists across a dongle power cycle.
3. Lightbar mode and favorites change the controller LED live.
4. Remap: swap two buttons, confirm in a game or `evtest`, reset.
5. Slots: switch to an empty slot and back (press PS each time).
6. Trigger test: every preset is felt on L2/R2; leaving the page turns it off.
7. Diagnostics: counters move while audio plays; drops stay 0 (`scripts/audio_diag.py 10` agrees).
8. Firmware: Restart and Enter BOOTSEL both return/mount as described.
9. Linux, Windows (tester), macOS (best effort): the dongle connects with no driver install.
