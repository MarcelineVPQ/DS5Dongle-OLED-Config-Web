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
- Engineering baseline matching AVNetworkMonitor: ESLint + Prettier, strict TypeScript, Vitest unit/integration/security suites, pre-commit gates, CI (lint, typecheck, test, build), npm audit, Semgrep + Gitleaks, Dependabot, ADRs.

### Changed

- Haptics gain range is 1.0–6.0 (matches firmware since v0.6.12); Audio Auto Haptics defaults to Off (matches firmware v0.7.0).

### Removed

- The WebHID config path. WebHID is kept only for the browser's live OLED preview.
