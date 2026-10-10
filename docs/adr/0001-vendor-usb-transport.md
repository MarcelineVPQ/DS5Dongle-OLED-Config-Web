# ADR-0001: Vendor-class USB interface over WebUSB as the transport

## Status

Accepted

## Date

2026-10-10

## Context

The configurator reads and writes the dongle's settings through the firmware's pico command reports (`0xF1`–`0xFE`, firmware `src/cmd.cpp`). Until firmware v0.6.12 these were HID feature reports declared in the gamepad's HID descriptor, and the web tool used WebHID.

To make games fire native adaptive triggers, the gamepad HID descriptor had to become byte-identical to a real DualSense (289 bytes), which meant removing the vendor reports from it. That broke the tool:

- **WebHID and Windows HID** refuse report IDs the descriptor doesn't declare.
- **A second, declared HID interface** (the June 2026 "companion" spike) is claimed and torn down by Linux's `hid_playstation` driver, which binds every HID interface on 054C:0CE6. There's no `driver_override` for the HID bus.
- **Undeclared reports over hidraw** still work on Linux, but not on Windows, and not in a browser.

## Decision

The firmware (build flag `ENABLE_COMPANION_VENDOR`) adds a **control-only, vendor-class (0xFF) USB interface**. It carries the same pico command payloads over vendor control transfers:

- **GET:** `0xC1`, bRequest `0x01`, wValue = report id
- **SET:** `0x41`, bRequest `0x02`
- **Payloads:** at most 63 bytes, with no report-id byte

The interface works across platforms like this:

- **Linux:** no kernel driver binds it, so it's free for user space. Access needs a udev `uaccess` rule (Steam's rules already grant it on most gaming setups).
- **Windows:** WinUSB binds it automatically through **MS OS 1.0** descriptors (compat ID `WINUSB`, `DeviceInterfaceGUIDs` = `{CD1F1B79-799E-44AC-ADFC-A3F2090D1D4A}`). We use 1.0 because MS OS 2.0 needs bcdUSB ≥ 0x0201 and a BOS descriptor, which would change the device descriptor we byte-match.
- **Both targets** reach it through **WebUSB**: Chromium in the browser, and Electron's Chromium in the desktop app. There's no native Node USB module. In Electron the main process grants WebUSB access only to the dongle (054C:0CE6/0DF2) and the RP2350 boot device (2E8A:000F); see `electron/main/devices.ts`.

The protocol version lives in report `0xF1` (`DS5O` magic, major.minor). The app refuses a major it doesn't know.

## Consequences

### Positive

- The game-facing descriptors stay byte-identical to a real DualSense.
- One transport implementation (`src/protocol/webUsbTransport.ts`) for browser and desktop.
- Configuration works again in the browser tool, on firmware that has the interface.
- The existing PICOBOOT flasher (also WebUSB) works unchanged in the desktop app.
- No native module to compile, sign or rebuild per Electron version.

### Negative

- It needs firmware with the interface (v0.8+). Older firmware can only be updated, not configured.
- Linux users without Steam's udev rules need a `uaccess` rule installed once.
- Windows caches "no MS OS descriptor" per VID/PID/bcdDevice. A machine that saw the dongle before may need a replug or a cleared `usbflags` key before WinUSB binds. This is not yet verified on real Windows hardware.

### Neutral

- The HID path for the same reports remains, for `scripts/*.py` on Linux.
