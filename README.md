# DS5 Dongle OLED Edition Configurator

The desktop app for the **[DS5 Dongle OLED Edition](https://github.com/MarcelineVPQ/DS5Dongle-OLED-Edition)**: the Raspberry Pi Pico 2 W dongle that connects a DualSense controller to your PC over Bluetooth while looking, to games, exactly like a wired DualSense (adaptive triggers, HD haptics, speaker and mic included).

Linux, Windows and macOS. No drivers to install. It updates itself and the dongle's firmware.

## What you can do

- **Controller:** see the controller's connection, battery, charging and signal; set the lightbar (game-controlled, four favorite colors, breathing, rainbow, fade, tilt); manage the four pairing slots.
- **Audio & haptics:** haptics strength, speaker level (up to +12 dB), Bluetooth microphone, and Audio Auto Haptics, which creates rumble from game audio for games that send no haptics.
- **Buttons:** remap any button on a picture of the controller; test the adaptive trigger effects.
- **Dongle:** OLED display brightness and sleep timers, power and idle disconnect, USB polling rate and controller mode, firmware updates, and diagnostics under *Advanced*.
- **Tray:** the app keeps running in the system tray. The icon shows the controller with its touchpad in your lightbar color, a bolt while charging, and a dot: green connected, amber no controller, grey no dongle. Right-click for slots, updates and settings.
- **Themes:** light, dark, follow the system, or **match your desktop** (your KDE Plasma color scheme, or the system accent color elsewhere).
- **About:** what's new in each version, the firmware's changes, this guide, and credits, all inside the app.

Changes apply to the dongle the moment you make them, so you can hear and feel them. **Save to dongle** keeps them after the dongle powers off; **Revert** goes back to what's saved.

## Requirements

- A DS5 Dongle running **OLED Edition firmware v0.8 or newer**. That's the first firmware with the configurator interface.
- **Older firmware?** Update it once by hand:
  1. Download the latest `.uf2` from the [firmware releases](https://github.com/MarcelineVPQ/DS5Dongle-OLED-Edition/releases).
  2. Hold the dongle's **BOOTSEL** button while plugging it in, so it shows up as a drive.
  3. Copy the `.uf2` onto that drive.

  From then on, the app updates the firmware for you.

## Install

Download from the **[releases page](https://github.com/MarcelineVPQ/DS5Dongle-OLED-Config-Web/releases)**.

### Linux

1. Download `DS5Dongle-OLED-Edition-Configurator-<version>-linux-x86_64.AppImage`, put it wherever you keep apps, and make it executable (file properties, or `chmod +x`).
2. Run it once. It adds itself to your application menu, and updates keep that entry working.
3. **If the app says it can't open the dongle:** open the **Dongle** page and press **Set up USB access** (asks for your password once). Users with Steam installed usually don't need this.

### Windows

1. Download `DS5Dongle-OLED-Edition-Configurator-<version>-win-x64.exe` and put it somewhere permanent, for example a folder in Documents. It's a portable app, so there's no installer.
2. Run it. The first time, Windows SmartScreen warns that it's unsigned: choose *More info → Run anyway*. The app adds itself to the Start Menu, and the tray menu can also create a desktop shortcut.
3. Windows loads the USB driver for the dongle automatically.
4. **If the dongle doesn't show up** and it was plugged into this PC before updating its firmware: unplug it and plug it back in.

### macOS

Download the `.zip`, unzip it, and move the app to *Applications*. The build isn't signed yet, so the first time, right-click the app and choose **Open**. On macOS the app tells you about updates and links to the download, but doesn't install them itself.

## Updates

- **App:** about 20 seconds after it starts (then every 6 hours) the app checks for a new version. If there is one, a banner offers **Download and install**, then **Restart now**. Every download is checked against its published size and SHA-256 before anything is replaced, and the app never installs an older version. Turn automatic checks off from the tray menu.
- **Firmware:** when a newer firmware is published, the app offers it on the **Dongle** page. One click does everything: download and verify, restart the dongle into its bootloader, flash it, wait for it to come back, and confirm the version. Don't unplug the dongle while it runs (about 20 seconds); press **PS** on the controller afterwards.

## Privacy

No accounts, no analytics, no telemetry. The app only goes online to check GitHub for updates and to load the firmware changelog. It can only open the dongle and the dongle's bootloader over USB; every other device and web permission is refused.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| "Plug in the DS5 Dongle" while it is plugged in | On Linux, press **Set up USB access** on that screen. Everywhere: make sure the dongle runs firmware v0.8 or newer. |
| The app window doesn't appear | It may have opened behind other windows, or be in the tray. Click the tray icon. |
| Controller shows "Not connected" | Press **PS** on the controller. After a firmware update or slot switch it doesn't reconnect by itself. |
| Settings reset after unplugging | They were applied but not saved: press **Save to dongle**. |
| Linux with an NVIDIA card | Handled automatically (the app renders without the GPU, which avoids a known Electron crash). |

## Build it yourself

You need [Node.js 22](https://nodejs.org) and Git. On any OS:

```bash
git clone https://github.com/MarcelineVPQ/DS5Dongle-OLED-Config-Web.git
cd DS5Dongle-OLED-Config-Web
npx -y npm@11.6.2 ci          # install dependencies (npm 11; older npm versions crash on this tree)
npm run dist:linux           # Linux AppImage
npm run dist:win             # Windows portable exe (on Windows, or on Linux with Wine)
npm run dist:mac             # macOS zip (on a Mac)
```

The result is in `release/`. The official downloads are built the same way by [GitHub Actions](.github/workflows/release.yml), on real Linux, Windows and macOS machines, so anyone can see exactly how each file was made.

## For developers

- **Run from source:** `npm run dev:desktop`. Before a pull request, run `npm run check` (typecheck, lint, formatting, security gates, tests).
- **Docs:**
  - [CONTRIBUTING](docs/CONTRIBUTING.md): setup, code style, pre-commit, commit format.
  - [TEST_PLAN](docs/TEST_PLAN.md).
  - [SECURITY_AUDIT](docs/SECURITY_AUDIT.md).
  - [Architecture decisions](docs/adr/README.md).
  - [CLAUDE.md](CLAUDE.md): an architecture overview.
- **Protocol:** the app talks to the dongle over a vendor USB interface using WebUSB; see [ADR-0001](docs/adr/0001-vendor-usb-transport.md) and the firmware's `CLAUDE.md`.
- **Browser version:** this repository still builds the original browser-based config tool (`npm run dev`), but the desktop app is the supported way to configure the dongle.

## Credits

- **Firmware:** [DS5 Dongle OLED Edition](https://github.com/MarcelineVPQ/DS5Dongle-OLED-Edition), a fork of [awalol/DS5Dongle](https://github.com/awalol/DS5Dongle). The browser tool started as [awalol/ds5dongle-config-web](https://github.com/awalol/ds5dongle-config-web).
- **Thanks** to [loteran/DS5Dongle](https://github.com/loteran/DS5Dongle) (audio fixes, Audio Auto Haptics DSP) and [zurce/DS5Dongle-OLED](https://github.com/zurce/DS5Dongle-OLED) (multi-slot pairing).
- **Controller art and button glyphs:** "PS5 Button Icons and Controls" by [Zacksly](https://zacksly.itch.io), [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), modified.
- **PICOBOOT flasher:** picoflash by Piers Finlayson (MIT).

DualSense and PlayStation are trademarks of Sony Interactive Entertainment. This project is not affiliated with Sony.

## License

[MIT](LICENSE).
