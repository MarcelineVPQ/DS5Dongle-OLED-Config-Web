# Changelog

All notable changes to the **DS5 Dongle OLED Edition Configurator** (web tool and desktop app) are documented here.

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
- **About page.** The app's CHANGELOG ("What's new"), the firmware CHANGELOG (fetched from GitHub), the README as a guide, and credits/licenses, rendered in the app without raw HTML or remote images. After an update, a one-time banner links to the new notes.
- **"Match desktop" theme.** A fourth theme option that follows the desktop's colors: KDE Plasma's full color scheme (backgrounds, text, accent) read from `kdeglobals` and updated live when it changes; the system accent color on Windows, macOS and portal-aware Linux desktops. Text contrast is enforced (WCAG AA or better), and status colors stay fixed.
- **Games page (Linux).** Checks Steam, Heroic (Epic, GOG, Amazon, sideloaded) and Lutris for settings that keep adaptive triggers and haptics from reaching games: the wrong Proton, Steam Input forced on, `PROTON_PREFER_SDL` on a DualSense game, a Proton that no longer exists, the controller's audio on a pro-audio profile, and missing hidraw access. It reads nothing until you allow it on a first-visit screen that lists exactly what it checks ("Stop checking" turns it off again). Each suggested change says what it does, why, and which files it writes. Nothing happens until you review the changes and press Apply. Running launchers are closed only on request (cleanly, never while a game runs). Every file is backed up first, and Undo restores it byte for byte. Undo refuses rather than overwrite settings a launcher saved after the change. The page is fully translated. It also installs and updates the DualSense Proton build from a SHA-256-verified download, and the sidebar shows how many changes are recommended.
- **Studio credits.** About → Credits opens with the 42 Pixel Studios card: the dice mark, "Developed by Marcy Kuhn", and links to the studio site, GitHub, the source and issue reporting.
- **Speaker level up to +12 dB** (firmware v0.8+), centered on 0 in the app.
- **One screen, built around your live controller.** The DualSense is drawn in the middle and moves as you use it: buttons light up, L2/R2 fill as you pull them, sticks move, touches show on the touchpad, the lightbar and player indicator glow like the real thing. Click any part to set it up in the side panel (lightbar, trigger effects, remapping per button, speaker, haptics, mic, pairing slots). The dongle, Games, About and the app's own settings open from the top bar. Art: AL2009man's DualSense (MIT).
- **Your controller, in its own colors.** The app recognizes the connected controller (DualSense or DualSense Edge) and its colorway (Cosmic Red, Midnight Black, Starlight Blue, special editions ...) and draws it to match. Edge back paddles and Fn buttons show live.
- **Tray icon follows the taskbar:** dark on a light taskbar, light on a dark one.
- **Releases come from the firmware repo** ([DS5Dongle-OLED-Edition](https://github.com/MarcelineVPQ/DS5Dongle-OLED-Edition/releases)): one release per version with the app for every OS and the firmware it was built with (ADR-0005). The update feed lives there too.
- **The app includes its firmware.** It installs it on a new Pico (plug it in holding BOOTSEL: one click, no download, no files to copy, works offline), and offers it to dongles with older firmware. A newer published firmware is offered instead when there is one.
- **First-time setup screen.** With no dongle connected, the app explains how to connect one, finds a Pico in BOOTSEL mode, installs the firmware and walks you through pairing. The Controller page shows how to pair while no controller is connected.
- Engineering baseline matching AVNetworkMonitor: ESLint + Prettier, strict TypeScript, Vitest unit/integration/security suites, pre-commit gates, CI (lint, typecheck, test, build), npm audit, Semgrep + Gitleaks, Dependabot, ADRs.

### Changed

- "Match desktop" is now the default theme in the desktop app; a theme you picked yourself is kept.
- The app follows the system language on every launch until you pick one in the language menu (it used to remember the first detected language).
- The sidebar no longer repeats the app name (it's in the title bar); Games and About work without the dongle connected and don't show the save bar.
- Haptics gain range is 1.0–6.0 (matches firmware since v0.6.12); Audio Auto Haptics defaults to Off (matches firmware v0.7.0).

### Removed

- The WebHID config path. WebHID is kept only for the browser's live OLED preview.
