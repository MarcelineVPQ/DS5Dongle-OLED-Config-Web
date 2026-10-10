# Changelog

All notable changes to the **DS5 Dongle Configurator** (web tool and desktop app) are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Added

- **Desktop app (Electron)** for Linux, Windows and macOS, built from the same codebase as the web tool. Compact sidebar layout that fills the window: Overview, Settings, Lightbar, Remap, Pairing slots, Trigger test, Diagnostics, Firmware. Settings apply to the dongle live; "Save to dongle" persists them, "Revert" restores the saved state.
- **WebUSB transport** to the firmware's new configurator interface (firmware v0.8+, `ENABLE_COMPANION_VENDOR`). Configuration works again from the browser too: Config and Remap were disabled since firmware v0.6.12.
- Slot switch / forget / wipe, dongle restart, BOOTSEL, factory reset and trigger presets from the app, with confirmed results.
- Live audio-pipeline counters (the `0xF5` diagnostics) and controller signal quality.
- Self-hosted fonts (no Google Fonts request).
- **System tray.** Close-to-tray (default), launch at login, start minimized. The tray icon is the DualSense with its touchpad lit in the controller's actual lightbar color, a charging bolt, and a status dot (green connected, amber no controller, grey no dongle); the tooltip shows battery. The menu has slot switching, diagnostics and update actions.
- **Automatic updates.** The app checks a `latest.json` feed (20 s after launch, then every 6 h, opt-out in the tray), downloads on request with progress, verifies size and SHA-256 (fails closed), installs and restarts. Linux AppImages keep a stable link so menu entries survive updates; the Windows portable exe swaps itself in place.
- **One-click firmware updates.** Downloaded and verified by the app, then the dongle reboots into BOOTSEL on command and is flashed over USB. No drive mounting, no unplugging; the version is confirmed when it reconnects.
- **Packaging.** Linux AppImage that adds itself to the application menu on first run; Windows portable exe that adds a Start Menu shortcut; macOS zip. App icon: the DualSense on a green tile (Zacksly art, CC BY 3.0).
- **Linux USB setup.** A one-time "Set up USB access" button installs a udev rule (via pkexec) for users without Steam's rules.
- **Speaker level up to +12 dB** (firmware v0.8+), centered on 0 in the app.
- Release tooling: `tools/publish.sh`, a release workflow building every OS, and `tools/build_manifest.mjs`, which writes `latest.json` only from assets that are already published.
- Engineering baseline matching AVNetworkMonitor: ESLint + Prettier, strict TypeScript, Vitest unit/integration/security suites, pre-commit gates, CI (lint, typecheck, test, build), npm audit, Semgrep + Gitleaks, Dependabot, ADRs.

### Changed

- Haptics gain range is 1.0–6.0 (matches firmware since v0.6.12); Audio Auto Haptics defaults to Off (matches firmware v0.7.0).

### Removed

- The WebHID config path. WebHID is kept only for the browser's live OLED preview.
