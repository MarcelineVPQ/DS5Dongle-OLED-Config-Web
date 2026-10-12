# Changelog

All notable changes to the **DS5 Dongle OLED Edition Configurator** (the desktop app; the retired web tool up to 0.8.0) are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]

### Changed

- **The app runs lean when it's not on screen:** minimized or in the tray it now uses about 0.5% of a CPU core instead of about 13%: the background swirl and every reading that only feeds the window (signal strength, the Dongle page, level meters, pairing slots, the OLED mirror) stop until the window is back. What the tray and game profiles need keeps running.
- **Lighter while you watch, too:** with hardware acceleration the background swirl is drawn by the graphics card (the same look; without acceleration a smaller CPU version), the controller's identity is read once a second for the whole app instead of three times, the lightbar color 10 times a second instead of 30, and the status dot's pulse, the level meters and the lightbar glow no longer repaint on every frame (about 43% → 29% of a core on the controller page, 24% → 13% on the Dongle page). The HDR lighting redraws only when the color changes.
- **Our own color picker** for the lightbar's favorite colors (Lightbar panel and game pages) and your controller's colors: a saturation/brightness square, a hue slider, hex and R/G/B fields and your recent colors, in the app's theme, and fully usable from the keyboard (arrow keys, Shift for bigger steps, Escape closes).
- **The side bar closes as soon as you pick a page** (it used to stay open until you clicked elsewhere), and focus moves into that page, or into the side panel for App settings and Pico 2 W; keyboard users still get it open while tabbing.

### Fixed

- **The background swirl stayed frozen after Reduce motion was turned off again** until the background was toggled; it now follows the setting live.
- **The color picker's eyedropper did nothing:** the system color popup's eyedropper doesn't work in the app; our own picker replaces it (no eyedropper).
- **Running-game detection costs less:** on Linux only launcher and Wine/Proton processes are read in detail (a scan takes about 2.6 ms instead of 9); on Windows the process list is read without blocking the app.

## [0.9.5-dev.4] - 2026-10-12

### Added

- **Check for updates** in App settings → Updates: checks your channel (Stable or Development) now, for the app and the dongle's firmware, and says what it found for each; no waiting for the automatic check (every 6 hours).
- **Every button in the Inputs card:** Create, Options, the face buttons, the D-pad, PS, Mute and the touchpad click show when pressed, next to the sticks, triggers and the Edge's extra buttons.
- **Stick response curves:** choose how each stick responds (Linear, Precise, Steady, Aggressive, Digital or your own curve), applied in the dongle so it works in every game, saved per controller, and per game in its profile.
- **The DualSense Edge's Fn buttons and back buttons (LB / RB) everywhere:** in the Buttons list (act as any button, stay themselves, or do nothing), in saved layouts and game profiles (switched in while a game runs), in the Inputs card, and clicking them on the drawing opens their row. Needs the dongle firmware from this release (protocol 1.9).

### Changed

- **The background swirls in your controller's colors only** (and your custom colors, if you set them); the theme's accent no longer mixes in.
- **One name per button everywhere:** the Buttons list, the drawing, layouts and the Inputs card use the same names (Sony's for the Edge: Left back button (LB), Right back button (RB); "D-pad up"; the face buttons with their symbols).

### Fixed

- **Firmware updates no longer write past the end of the dongle's flash:** the in-app flasher skipped nothing, so the RP2350's drag-and-drop workaround block (not firmware) erased the flash's last sector on every update. Settings and pairings were never there, but it's gone now.
- **Firmware update steps:** the "Writing firmware" step says the RP2350 drive popping up mid-write is expected (the update doesn't use it).

## [0.9.5-dev.3] - 2026-10-12

### Added

- **Firmware update notice: Update and Details:** Update opens the Pico page's firmware card, Details opens the firmware changes.
- **Stick tests:** a circularity test (how round each stick's range is, with the error %) and a drift test (does a stick move when you don't touch it), in Calibration.
- **The DualSense Edge has its own drawing:** Fn buttons and back buttons light up as you press them.

## [0.9.5-dev.2] - 2026-10-12

### Added

- **Joining the Development channel asks first:** what it means (newer, less tested, app and dongle firmware, back to stable any time) and what's in the newest development build (app and firmware versions and its notes), before any development update is offered.
- **Development builds say so:** "DEVELOPMENT · 0.9.5-dev.1" along the side rail (and the exact Git build on a local dev copy); stable releases don't show it.
- **Edit a game's profile in the controller view and feel it live:** "Edit in controller view" on a game's page puts its profile on the controller (never into the dongle's flash) with an "Editing: … profile" banner; every panel edits the profile, the Buttons list saves into the game's own layout, and Done brings your normal settings back and returns to the game's page.
- **My controller's colors:** pick colors for the shell, the black parts, buttons, sticks and outlines, for custom and modded controllers.

### Changed

- **Special editions in their real colors** (e.g. Genshin Impact's teal and gold): colors only, no artwork.

## [0.9.5-dev.1] - 2026-10-12

### Changed

- **Buttons are one place:** with the Buttons list open, clicking a button on the drawing highlights and focuses its row instead of leaving the list; buttons that only have a remap (face buttons, D-pad, L1/R1, Create, Options) open the list at their row; hovering a row lights the button on the drawing. Triggers, sticks, PS, mute and the touchpad keep their own panels, with "See all buttons" opening the list at that button.

## [0.9.4] - 2026-10-12

### Added

- **Saved button layouts:** name your button setup ("Racing", "Southpaw") and give it to any game's profile; it switches in while the game runs and your normal buttons come back after, even if the app was closed mid-game. Layouts never touch the dongle's flash (firmware protocol 1.8: temporary remaps). Each layout shows what it changes, and a game page shows its layout's changes.
- **All buttons in one list** (Buttons & layouts, from the controller overview or any button): every button with what it acts as and whether it's changed, editable right there; the same edits as clicking buttons on the drawing.
- **Steam's categories in the library:** soundtracks, software, tools, videos, demos and DLC are labeled as Steam labels them, and a **Show** menu hides any category (everything shows by default). Soundtracks and software no longer get game fixes.
- **All games as covers** on the Games Home page (like Steam's "My games"), following the list's search, filter and sort. Cover tiles show the store they come from and what the game supports (adaptive triggers, HD haptics, a profile, needs setup) as marks over the art, each with a tooltip.
- **Launcher icons** in the Games pages: Steam, Heroic, Lutris, GOG and Epic marks (Simple Icons, CC0) next to their names, in the theme's text color.
- **Games library on Windows:** your Steam games, their pages and per-game controller profiles that switch in while a game runs (Steam found from the registry or Program Files; the running game is recognized by its program in the game's folder). Also **GOG Galaxy and Epic** games on Windows (from GOG Galaxy's registry entries and Epic's install manifests). Proton and the Linux system checks stay Linux-only.
- **Dev builds say exactly what they are:** `tools/dev.sh` builds and runs the dev copy (own settings, dev tools, DevTools port) and stamps a Git build id next to the version ("0.9.3 · dev +3.a1b2c3d"). Firmware dev builds (`tools/dev_firmware.sh` in the firmware repo) report `v0.9.3-oled-edition+3.a1b2c3d` instead of a stale "dev" version.
- **Simulated dongle** (dev builds, Developer card): every page works without hardware, with moving input, diagnostics and an OLED screen; the tests' fake dongle and the simulation are one implementation.

### Changed

- **The Developer card is only in dev builds** (`DS5_DEV_TOOLS=1`, and Development-channel releases `X.Y.Z-dev.N`), shown there by default. Stable releases leave it out: no card, no Ctrl+Shift+D, and leftover preview settings can't change what they show.

### Fixed

- **The mute button looks like the real one:** clear plastic over the dark center (it was drawn in the body color), lit orange while the mic is muted.
- **All buttons list fits the side panel:** "changed" / "not applied yet" sit under the button's name instead of over its picker, and each picker uses the full width.
- **Dongle page cards line up:** they come in 4, 2 or 1 columns (never a lone card on a row of 3), a short row's last card fills it, and the firmware version fits its card (full version in the tooltip). The chip temperature's trend line is now inside its gauge (it was shown twice), and the freed card shows **mic audio frames per second**.
- **The Dongle page says when the speaker is off because the dongle ran out of memory at start** (firmware 0.9.4, issue #15), instead of sound just missing.
- **Warning counters readable in every controller color:** the Dongle page's "⚠" counters were amber on the controller-colored cards (too faint on Cosmic Red and other mid tones). Warning-colored text now uses a version the theme makes legible on its own surfaces; checked in every colorway.

## [0.9.3] - 2026-10-12

### Added

- **Pairing slots name the controller in each slot** ("DualSense · Cosmic Red"), remembered whenever it connects; the dongle itself only keeps the Bluetooth address.
- **Developer: "Pretend more controllers"** shows two made-up controllers in slots 1 and 2 (an Edge and a second DualSense); switching to one makes the app act as if it connected (drawing, colors, slot), nothing is sent to the dongle. For testing multi-controller screens with one controller.
- **The app names your hardware:** with firmware protocol 1.7 the rail, status, Dongle page, console, log and update banner say what the dongle is built on (e.g. **Pico 2 W**), as the firmware reports it, so other boards show by their own name. Older firmware shows "Dongle".
- **Updates without a dongle:** the setup screen shows the firmware version the app installs, how to update or reinstall it without a controller (hold BOOTSEL while plugging in), and **Check for updates** for the app.
- **Background setting** (App settings → Appearance): **Default**, slow swirls in your controller's color, the theme's accent and the accent's neighboring hues (new installs start here); **Game art** (Linux, with Games on; the swirls when there's none); or **Off**. Glass and card opacity now have something to show through on every PC.
- **Rail tooltips** say what each page holds ("Controller · your controller, live. Click any part of it to set it up").
- **Developer preview of the update states** (App settings → Developer): shows an app and firmware update as available, in progress or ready, without a real update. `tools/check_layout.mjs` now checks every update state in every language, size, theme and style.
- **Repair USB driver explains itself first:** the button lists, step by step, what will happen and can show the exact script; nothing runs until **Run the repair**.
- **README: the full PowerShell behind Repair USB driver**, line by line; a test fails the build if it ever differs from what the app runs.

### Changed

- `tools/check_layout.mjs` turns off transitions while it measures contrast (a theme switch measured mid-fade read as a failure), and takes `--themes` / `--colorways off` for quick targeted runs.

### Fixed

- **The controller drawing covered the status tiles** on short windows (about 680 px tall, e.g. Windows laptops): its height cap was on its box, not the drawing. The page now scrolls instead, and `tools/check_layout.mjs` reports a drawing over tiles or cards.
- **Accent-colored text is always readable:** with Windows' own accent (Desktop theme) the colorway name could be dark magenta on dark. Text in the accent color now uses a contrast-checked version.
- **"Windows untested" removed everywhere:** tested on Linux and Windows 11; macOS stays untested; the Games page is Linux-only for now.
- **Firmware update progress** now moves while the firmware is written (it stayed at 0% until the end), and the **Update to …** button shows the short version ("Update to 0.9.2") so **Check now** no longer slides off the Dongle panel.
- **"Plug in the DS5 Dongle" when the dongle is plugged in:** the dongle stays off USB until a controller connects, so the setup screen now says how to connect or pair one (press PS, or hold PS + Create), and says **Turn on your controller** on PCs that have used a dongle before. After a firmware update it says to press PS.

## [0.9.2] - 2026-10-12

### Fixed

- **Windows: the dongle stuck on "Plug in the DS5 Dongle" / "Connecting"** on PCs where a real DualSense was plugged in by USB before. The dongle shares its USB IDs, and Windows had kept "no driver needed" for them. The setup screen now spots a dongle it can't open and offers **Repair USB driver** (one admin prompt): it clears Windows' saved answer for those IDs, and after a replug Windows sets up the driver properly. The raw "claimInterface" error no longer shows on Windows. Tested in a Windows 11 VM: a new user, the repair, and declining the prompt (`tools/windows_vm_test.py`).

## [0.9.1] - 2026-10-11

### Added

- **Development update channel** (opt-in, App settings -> Updates -> Update channel): development builds of the app and firmware (vX.Y.Z-dev.N, published as GitHub pre-releases) before they're released, plus every stable release. **Back to stable** installs the latest stable app (and offers the stable firmware) even though it's older; the only path that goes backwards. Stable stays the default; its feed never lists development builds.

## [0.9.0] — 2026-10-11

**Highlights:** calibration for sticks, triggers and gyro, stored in the dongle per controller; haptics strength per grip (HD haptics and rumble, with a test); the dongle's own screen live with a diagnostics dashboard; a theme in your controller's own colors with game art behind it; a Games library with per-game controller profiles (Linux); and a [step-by-step guide](https://github.com/MarcelineVPQ/DS5Dongle-OLED-Config-Web/blob/master/docs/GUIDE.md) (also in About → Guide).

Needs firmware 0.9.0 (protocol 1.6) for calibration, left/right grip haptics and the grip test, 1.4 for the dongle console; older firmware keeps working without them (the app says so where it matters). Bundled with this release.

### Added

- **Games library** (Linux). The Games tab lists your Steam, Heroic and Lutris games (search, filters, a Playing group); each game has a page with its artwork, play time, last played, size, the Proton it runs with and the recommended one (with a switch), its DualSense support tier and per-feature results, and its own setup fixes. Artwork comes from the launchers' local caches, served only for scanned games (`ds5-art://`); nothing is downloaded.
- **Per-game controller profiles**: haptics strength, Audio Auto Haptics, speaker level, lightbar mode and favorite colors, BT mic. A profile switches in on the dongle (RAM only) while its game runs and your normal settings come back when it closes, also after a crash or a quit mid-game (kept as a restore point on disk). While one is active the bottom bar saves to the profile, never to the dongle.
- **Your rating and feedback** per game: stars and a checklist of what you noticed (no free text to share), stamped with the app version and game build so feedback from before a game update or one of our fixes is flagged; private notes. Saved on this PC; sharing with other players comes later.
- **Play and open from a game's page.** ▶ Play starts the game through its own launcher (Steam, Heroic, Lutris); Steam games also open their Properties, Steam Input layout and library page; any game opens its install folder or its Proton/Wine prefix. Links and folders are built in the app from the scan, never taken from the page.
- **Dongle console.** The Dongle page shows the dongle's screen pixel for pixel, live (needs firmware with protocol 1.4; works without the OLED add-on too), plus a log of what the dongle did this session. Dark in every theme, like any console.
- **Dongle diagnostics dashboard** under the console: Pico 2 W dials for chip temperature, CPU clock (measured vs set) and core voltage; one-minute graphs for USB audio frames, Bluetooth packets, signal and temperature; the audio pipeline's levels and counters (problems marked); the OLED's brightness, state, screen and timeouts. Replaces Dongle -> Advanced.
- **Left and right grip haptics** (needs firmware with protocol 1.6): Haptics strength per grip, with Link (on by default) to move both together, and Test left / right / both buttons; also in game profiles. The strengths now also scale classic rumble, not only HD haptics (the trigger tests aren't affected: L2 and R2 have their own motors). Older firmware keeps one strength for both.
- **Calibration** (needs firmware with protocol 1.5): a guided run measures stick centers and drift, how far each stick reaches, trigger travel and the gyro's zero; deadzone and full-tilt can be adjusted by hand with a raw vs "what games see" preview. Stored and applied in the dongle for every game; nothing is written to the controller; Reset undoes it.
- **HDR lighting** (experimental, App settings -> Advanced, off by default): on an HDR display the lightbar glows brighter than paper white, at a peak brightness you set in nits. Drawn with WebGPU in extended range; the app starts in the scRGB color profile while it's on (KWin 6.6 has no "srgb" transfer function, which Chromium's default color management asks for). Everything else stays standard range.
- **Theme: Match my controller** (the new default): cards and panels in the controller's own body color with black or white text, light or dark from the colorway, the accent from its trim. Every colorway now has colors (special editions are approximations from product photos).
- **Look knobs** in App settings -> Appearance: card opacity (let the game art through the cards), background dim, background blur, and depth (shadow strength).
- **Developer preview** (Ctrl+Shift+D -> App settings -> Developer): show any controller model and colorway to check the app's colors; display only.
- **Style: Standard / Glass** in App settings -> Appearance. Glass also makes the settings panel the regular variant (docked against the rail; its cards stay standard surfaces).
- **Glass (preview)**: the rail and the save bar as Liquid Glass (Apple's clear variant: lensing at the edge, a light frost, a specular edge that follows the pointer, a liquid press), docked to the window edges; the rail switches to the regular variant (more frost and a dim) while it's open over content. Content keeps plain surfaces. Reduce transparency / increase contrast / reduce motion are respected.
- **Speaker and microphone tests.** The Speaker panel plays a short chime on the controller's speaker (never the PC's); the Microphone panel records 3 s from the controller's mic with a live level and plays it back on the controller (Linux; recorded in the main process, kept in memory only, the page still has no microphone access).
- **Color vision modes** (App settings -> Accessibility): protanopia, deuteranopia and tritanopia palettes; color never carries meaning alone (every status also has a symbol or text).

### Changed

- **Navigation rail** on the right edge replaces the top bar: Controller, Dongle, Games, App settings and About, with the dongle's status at the bottom. Icons only until you hover it (or tab into it); pin it open with the button at the bottom or Ctrl+B.
- **Magazine-cover title**: the controller model in big caps behind the drawing (the triggers overlap it), with "Model:" above; the colorway (in the accent) and "Connected" (a pulsing dot) below it in the same style.
- **Themed by your controller.** The connected controller's colorway tints the app's surfaces and gives its accent (made legible: lightened or darkened to 3:1 against the panels, black or white text on buttons); neutral colorways keep the theme's accent; App settings -> Appearance -> Accent color switches back to the desktop's. Each game page takes its artwork's color for its own highlights (picked in the main process).
- **Depth and motion**: layered shadows on cards, tiles, game covers and under the controller; clickable tiles and covers lift and wiggle on hover, buttons lift slightly. Reduce motion keeps the shadows and drops the movement.
- **The game art background on every page**, not just the controller.
- **Button presses on the drawing** use a grey tint picked per controller (darker on light buttons, lighter on dark ones), so they show on every colorway; L1/R1 and the L2/R2 fill light up light grey.
- **Controller page data regrouped**: four equal cards (Inputs with the stick circles and trigger bars, Gyroscope, Accelerometer, Connection) and a four-tile status strip (battery, signal, lightbar, player and slot). Nothing repeats the drawing, and settings stay in the side panel.
- **App settings reorganized**: Language; Appearance (theme, style, accent, game art background); Accessibility (color vision, **Reduce motion** (new: no moving background, pulsing or animations, also when the system asks), narrator voice, captions); Startup and window; Updates; Advanced (hardware acceleration).
- **Hardware acceleration is on by default again** (needed for blur, glass and HDR; App settings -> Advanced turns it off, and a graphics crash turns it off for the next start).
- **The welcome tour is off** until it is rebuilt for the new layout.

### Removed

- The old browser web tool (retired with 0.8.0): its page, components, OLED emulator, WebHID preview, build script and styles. The download page is unaffected.

### Fixed

- Settings panels: firmware shows "Up to date" as a status instead of a disabled button; Power puts "Disconnect when idle" before the timeout it controls; the audio buffer explains what it does; low-pass options show Hz; pairing slots' column header no longer wraps; "Mute" panel is "Mute button & mic"; "Reset all" says what it resets; the language menu opens inside the settings panel.
- The model title fits between the triggers at every window size and model name length.
- The game page's Play no longer warns "Couldn't open that" when the launcher started the game fine (Steam exits non-zero after passing the link on).
- Gyroscope / accelerometer readings no longer spill out of narrow cards.

## [0.8.1] — 2026-10-11

Includes firmware 0.8.1: rumble no longer cancelled in some games (Crimson Desert), output stays alive after a reconnect, steadier first pairing and faster reconnects. Tested on Linux; the Windows and macOS builds are included but untested.

### Changed

- The language button shows the language's own name ("Español", "日本語") instead of a code, never a flag; the regional variants are spelled out: 中文（简体）, Português (Brasil).

## [0.8.0] — 2026-10-10

The first desktop release: the configurator is now an app, released together with the firmware it includes. **Tested on Linux; the Windows and macOS builds are included but untested.**

### Added

- **Desktop app (Electron)**, built from the same codebase as the web tool. Tested on Linux; Windows and macOS builds are included but haven't been tested yet. Settings apply to the dongle live; "Save to dongle" persists them, "Revert" restores the saved state.
- **WebUSB transport** to the firmware's new configurator interface (firmware v0.8+, `ENABLE_COMPANION_VENDOR`). Configuration works again from the browser too: Config and Remap were disabled since firmware v0.6.12.
- Slot switch / forget / wipe, dongle restart, BOOTSEL, factory reset and trigger presets from the app, with confirmed results.
- Live audio-pipeline counters (the `0xF5` diagnostics) and controller signal quality.
- Self-hosted fonts (no Google Fonts request).
- **System tray.** Close-to-tray (default), launch at login, start minimized. The tray icon is the DualSense with its touchpad lit in the controller's actual lightbar color, a charging bolt, and a status dot (green connected, amber no controller, grey no dongle); the tooltip shows battery. The menu has slot switching, diagnostics and update actions.
- **App updates.** The app checks a `latest.json` feed (20 s after launch, then every 6 h; opt-out in ⚙ App settings or the tray), downloads with progress, verifies size and SHA-256 (fails closed), installs and restarts. **Install updates automatically** (asked once on first run, and in ⚙ App settings) downloads, verifies and installs them in the background; the new version starts the next time you open the app. Older versions are never installed. Linux AppImages keep a stable link so menu entries survive updates; the Windows portable exe swaps itself in place.
- **One-click firmware updates.** Downloaded and verified by the app, then the dongle reboots into BOOTSEL on command and is flashed over USB. No drive mounting, no unplugging; the version is confirmed when it reconnects.
- **Packaging.** Linux AppImage that adds itself to the application menu on first run; Windows portable exe that adds a Start Menu shortcut; macOS zip. App icon: the DualSense on a green tile (Zacksly art, CC BY 3.0).
- **Linux USB setup.** A one-time "Set up USB access" button installs a udev rule (via pkexec) for users without Steam's rules.
- **About page.** The app's CHANGELOG ("What's new"), the firmware CHANGELOG (fetched from GitHub), the README as a guide, and credits/licenses, rendered in the app without raw HTML or remote images. After an update, a one-time banner links to the new notes.
- **"Match desktop" theme.** A fourth theme option that follows the desktop's colors: KDE Plasma's full color scheme (backgrounds, text, accent) read from `kdeglobals` and updated live when it changes; the system accent color on Windows, macOS and portal-aware Linux desktops. Text contrast is enforced (WCAG AA or better), and status colors stay fixed.
- **Games page (Linux).** Checks Steam, Heroic (Epic, GOG, Amazon, sideloaded) and Lutris for settings that keep adaptive triggers and haptics from reaching games: the wrong Proton, Steam Input forced on, `PROTON_PREFER_SDL` on a DualSense game, a Proton that no longer exists, the controller's audio on a pro-audio profile, and missing hidraw access. It reads nothing until you allow it on a first-visit screen that lists exactly what it checks ("Stop checking" turns it off again). Each suggested change says what it does, why, and which files it writes. Nothing happens until you review the changes and press Apply. Running launchers are closed only on request (cleanly, never while a game runs). Every file is backed up first, and Undo restores it byte for byte. Undo refuses rather than overwrite settings a launcher saved after the change. The page is fully translated. It also installs and updates the DualSense Proton build from a SHA-256-verified download, and the Games button shows how many changes are recommended.
- **Studio credits.** About → Credits opens with the 42 Pixel Studios card: the dice mark, "Developed by Marcy Kuhn", and links to the studio site, GitHub, the source and issue reporting.
- **Speaker level up to +12 dB** (firmware v0.8+), centered on 0 in the app.
- **One screen, built around your live controller.** The DualSense is drawn in the middle and moves as you use it: buttons light up, L2/R2 fill as you pull them, sticks move, touches show on the touchpad, the lightbar and player indicator glow like the real thing. Click any part to set it up in the side panel (lightbar, trigger effects, remapping per button, speaker, haptics, mic, pairing slots). The dongle, Games, About and the app's own settings open from the top bar. Art: AL2009man's DualSense (MIT).
- **Your controller, in its own colors.** The app recognizes the connected controller (DualSense or DualSense Edge) and its colorway (Cosmic Red, Midnight Black, Starlight Blue, special editions ...) and draws it to match. Edge back paddles and Fn buttons show live.
- **Tray icon follows the taskbar:** dark on a light taskbar, light on a dark one.
- **Releases come from the firmware repo** ([DS5Dongle-OLED-Edition](https://github.com/MarcelineVPQ/DS5Dongle-OLED-Edition/releases)): one release per version with the app for every OS and the firmware it was built with (ADR-0005). The update feed lives there too.
- **The app includes its firmware.** It installs it on a new Pico (plug it in holding BOOTSEL: one click, no download, no files to copy, works offline), and offers it to dongles with older firmware. A newer published firmware is offered instead when there is one.
- **First-time setup screen.** With no dongle connected, the app explains how to connect one, finds a Pico in BOOTSEL mode, installs the firmware and walks you through pairing. The Controller page shows how to pair while no controller is connected.
- Engineering baseline matching AVNetworkMonitor: ESLint + Prettier, strict TypeScript, Vitest unit/integration/security suites, pre-commit gates, CI (lint, typecheck, test, build), npm audit, Semgrep + Gitleaks, Dependabot, ADRs.

- **Live data.** Under the controller: tiles laid out like it (sticks, triggers, battery, signal, player and slot) and cards with every number the controller reports: stick and trigger values, the effect each trigger runs, gyroscope and accelerometer with scrolling graphs and tilt, touch points, headset and mic jacks, mute, USB power, and the link (sensor clock, update rate, round trip, signal).
- **A guided tour** the first time a controller connects, driven from the controller: the screen dims and a spotlight glides from part to part. Hands-on steps wait for you: press a few different buttons (they appear as chips), pull a trigger (and feel it push back: the triggers get the Weapon effect for that step), click the pulsing light strip. On those steps ✕ and ○ are just buttons to try; hold ✕ to move on (a ring fills) or ○ to go back. Replay it from ⚙ App settings → Help.
- **The narrator.** A voice that speaks only through the **controller's speaker**, never the PC's, in all 7 languages: she talks you through the tour and confirms what happens (dongle online, controller connected, saved, remapped, factory reset, firmware available or updated, games ready). Off until you say yes: the tour's first step asks, with her question as the sample. With firmware v0.8 the dongle has her too, so without the app she still says when the controller connects, names the pairing slot you switch to and warns when the battery runs low; the app keeps the dongle's narrator and language in step. ⚙ App settings → Narrator turns her on or off and tests her voice.
- **Captions** (on by default) show her words on screen while she speaks, announced to screen readers; with the voice off the short confirmations still show as text.
- **Lightbar tile and settings cards:** the tiles show the lightbar mode with its live color (click it to change), and the data cards include your audio, haptics and dongle settings, each line opening its setting.
- **Every setting one click away:** the start panel lists Lightbar, Adaptive triggers, Haptics, Speaker, Microphone and Pairing slots, for anyone who doesn't know where on the controller a setting lives. The body highlights on hover too.
- **A bigger controller:** the settings panel can be hidden (») so the drawing uses the whole width; clicking a part or Settings brings it back.
- Marketing renders of all 13 standard colorways (single images, a sheet, a GIF and an MP4) and full-resolution app screenshots in `docs/marketing/`.

### Changed

- **The live lightbar** updates about 30 times a second (it was once a second), so rainbow, breathing and fade look smooth. It glows with a soft bloom and fades to the grey of the unlit plastic as it dims, like the real one.
- Outlines stay readable on every colorway: on the black parts too, and Galactic Purple, Starlight Blue and Nova Pink outlines are more visible. A test checks the contrast of every colorway.
- The hints say to click the drawing with the mouse (pressing buttons on the controller only lights them up).
- The language menu opens downward inside the settings panel (it was cut off, with a sideways scrollbar).
- The live view no longer flickers with a sideways scrollbar while you press buttons.
- Small windows: the controller drawing keeps its size and the view scrolls; choices that don't fit beside their label go under it; the pairing slots and settings switches fit the panel.

### Fixed

- Two actions within a moment of each other (a setting change and Apply remap, a slot, a trigger preset) no longer both fail: the app sends its commands one at a time.
- An edit made while the previous one was being applied is no longer lost.
- The save bar is right after a USB reconnect, an app restart, a factory reset, a slot switch or a change made on the OLED (firmware v0.8 reports unsaved settings itself), and Revert is only offered when the saved settings are known. Changes made on the OLED show up in the app and aren't overwritten by the next edit.
- After a firmware update, the app waits for the controller (the dongle only comes back once one connects) instead of reporting a failure after 45 seconds; the setup screen no longer offers to flash the dongle again mid-update.
- Restart and Enter BOOTSEL are no longer reported as errors when the dongle leaves quickly.
- A refused setting isn't re-sent every 150 ms; it's retried after the next change.
- Number boxes beside sliders accept normal typing (a minus sign, decimals); values set on the OLED outside a slider's usual range show as they are.
- Clicking empty space no longer opens the haptics panel; the body is reachable by keyboard; "Check now" compares versions properly.
- The controller drawing no longer shows a phantom press for a moment after the controller disconnects, and live polling stops while the window is in the tray.
- Updates: a check after an update was installed no longer hides "Restart to update"; downloads that stall fail after a minute instead of hanging; the relaunch can't lose the single-instance race.
- Linux USB setup works from the AppImage (root couldn't read the rule inside it); a missing `udevadm` is reported as such.
- Games page: backups never drop the only copy of an original config file; Undo restores a symlinked file as a symlink; `PROTON_USE_SDL="0"` is recognized as off; Steam files keep every escape exactly as written, and a file with platform conditionals is refused instead of rewritten; a stray folder named like the Proton build no longer aborts an install.
- Settings are saved atomically (a crash mid-save can't reset them or the autostart entry); the firmware offer isn't served from a stale feed; desktop-entry paths are quoted per spec.

### Security

- Only the app's own page is trusted for IPC and USB, not any local file under a `renderer/` folder (e.g. one dropped onto the window).
- **Signed updates.** The update feed must be signed (Ed25519, by a key that only exists as a release secret); the app refuses an unsigned or altered feed before using anything in it, so the app, firmware and Proton downloads can't be redirected even if the feed is tampered with.
- **Sandboxed on Ubuntu.** On Ubuntu 23.10 and newer, *Set up USB access* also installs a small AppArmor profile so the app runs inside Chromium's sandbox (without it the AppImage starts with `--no-sandbox` there).
- Every release file carries a GitHub build-provenance attestation (`gh attestation verify FILE -R MarcelineVPQ/DS5Dongle-OLED-Edition`).

### Changed (since the web tool)

- "Match desktop" is now the default theme in the desktop app; a theme you picked yourself is kept.
- The app follows the system language on every launch until you pick one in the language menu (it used to remember the first detected language).
- Games and About work without the dongle connected and don't show the save bar.
- Haptics gain range is 1.0–6.0 (matches firmware since v0.6.12); Audio Auto Haptics defaults to Off (matches firmware v0.7.0).

### Removed

- The WebHID config path. WebHID is kept only for the browser's live OLED preview.
