# DS5 Dongle OLED Edition Configurator

The desktop app for the **[DS5 Dongle OLED Edition](https://github.com/MarcelineVPQ/DS5Dongle-OLED-Edition)**: the Raspberry Pi Pico 2 W dongle that connects a DualSense controller to your PC over Bluetooth while looking, to games, exactly like a wired DualSense (adaptive triggers, HD haptics, speaker and mic included).

Made on Linux, tested on Linux and Windows 11. The macOS build is included but hasn't been tested yet; reports are welcome. The Games page is Linux-only for now. No drivers to install. It updates itself and the dongle's firmware.

![The live controller: your DualSense in its own colors, moving as you use it](docs/screenshots/live-controller.png)

## What you can do

**The step-by-step [guide](docs/GUIDE.md)** walks through everything, from building the dongle to each setting, with a picture for each step. In short:

- **Your controller, live:** drawn in its own colors (DualSense colorways and the Edge), moving as you use it. Click any part to set it up: light bar, adaptive triggers, haptics strength per grip (HD haptics and rumble, with a test), Audio Auto Haptics, speaker and mic (with tests), button remapping, pairing slots.
- **Calibration:** fix stick drift, sticks or triggers that don't reach full, and a creeping gyro, stored in the dongle per controller.
- **The dongle:** its screen mirrored pixel for pixel, a live dashboard (temperature, clock, Bluetooth and USB traffic, the audio pipeline), and one-click firmware updates.
- **Games (Linux):** your Steam, Heroic and Lutris library with per-game controller profiles that switch in while a game runs, Proton setup and fixes, DualSense support per game, and your own ratings and notes.
- **Made yours:** themes (including one in your controller's colors), Glass, look sliders, color vision modes, Reduce motion, a narrator through the controller's speaker, and experimental HDR lighting.

The app lives in the **system tray** (its icon shows your light bar color and the connection). Changes apply to the dongle the moment you make them; **Save to dongle** keeps them after it powers off.

## Requirements

- A **Raspberry Pi Pico 2 W** built into a DS5 Dongle OLED Edition (see the [firmware repo](https://github.com/MarcelineVPQ/DS5Dongle-OLED-Edition) for parts and wiring).
- **No firmware yet, or an older one?** The app installs it. Each app release includes the matching firmware, so this works offline:
  1. Plug the Pico in **while holding its BOOTSEL button** (a brand-new Pico doesn't need the button).
  2. The app finds it and offers to install the firmware. One click, no files to copy.

  From then on, the app keeps the firmware up to date for you.

## Install

Download from the **[releases page](https://github.com/MarcelineVPQ/DS5Dongle-OLED-Edition/releases)** on the firmware repo. Every release has the app for each system plus the firmware it was built with (the app includes that firmware, so you don't need to download it separately).

### Linux

1. Download `DS5Dongle-OLED-Edition-Configurator-<version>-linux-x86_64.AppImage`, put it wherever you keep apps, and make it executable (file properties, or `chmod +x`).
2. Run it once. It adds itself to your application menu, and updates keep that entry working.
3. **Press Set up USB access** on the **Dongle** page (it asks for your password once). It lets the app open the dongle, and on Ubuntu 23.10 and newer it also installs a small AppArmor profile so the app runs inside Chromium's security sandbox (Ubuntu does the same for Chrome and VS Code). Users with Steam installed often already have USB access, but the sandbox still needs this step.

### Windows

Tested on Windows 11, end to end in a test machine (`tools/windows_vm_test.py`) and by users. The Games page (library, per-game profiles, Proton) is Linux-only for now; everything else works the same. Problems? Please report them in the [issues](https://github.com/MarcelineVPQ/DS5Dongle-OLED-Config-Web/issues).

1. Download `DS5Dongle-OLED-Edition-Configurator-<version>-win-x64.exe` and put it somewhere permanent, for example a folder in Documents. It's a portable app, so there's no installer.
2. Run it. The first time, Windows SmartScreen warns that it's unsigned: choose *More info → Run anyway*. The app adds itself to the Start Menu, and the tray menu can also create a desktop shortcut.
3. Windows loads the USB driver for the dongle automatically.
4. **If the app says "The dongle is plugged in, but Windows hasn't set up its driver"** (or it never connects), press **Repair USB driver** on that screen, allow the admin prompt, then unplug the dongle and plug it back in. See below for exactly what it does.

#### Repair USB driver: exactly what it runs

The dongle uses a real DualSense's USB IDs (`054C:0CE6`, or `054C:0DF2` in DualSense Edge mode), so games treat it as one. It also asks Windows to load the standard **WinUSB** driver for the configurator's own interface. Windows asks a device for that only the **first time** it sees those IDs, and remembers the answer. If a real DualSense was ever plugged into the PC by USB, Windows remembered "no driver needed", and the app can't open the dongle.

**Repair USB driver** makes Windows forget that answer. It runs this PowerShell script once, as administrator (Windows shows its admin prompt first; choose No and nothing happens). Before anything runs, the app lists these steps and can show the script itself, and you choose **Run the repair** or **Cancel**. The app contains it as fixed text ([`src/desktop/windowsRepairScript.ts`](src/desktop/windowsRepairScript.ts), run by [`electron/main/windowsSetup.ts`](electron/main/windowsSetup.ts)); nothing from the page or the internet goes into it, and a test fails the build if this copy and the app's ever differ:

```powershell
$ErrorActionPreference = 'Stop'
foreach ($id in @('0CE6', '0DF2')) {
  Remove-Item "HKLM:\SYSTEM\CurrentControlSet\Control\usbflags\054C$($id)0100" -Recurse -Force -ErrorAction SilentlyContinue
  Get-PnpDevice | Where-Object { $_.InstanceId -like "USB\VID_054C&PID_$($id)*" } | ForEach-Object {
    & "$env:SystemRoot\System32\pnputil.exe" /remove-device "$($_.InstanceId)" | Out-Null
  }
}
exit 0
```

What each part does:

- **`usbflags\054C…0100`**: Windows' remembered answer for those two USB IDs (revision 0100). Deleting it makes Windows ask the dongle again on the next plug-in. Nothing else in the registry is touched.
- **`pnputil /remove-device`**: removes Windows' cached device entries for the same two IDs only (`USB\VID_054C&PID_0CE6…` / `0DF2…`). Windows creates them again, with the right driver, when the dongle is plugged back in. A real DualSense plugged in by USB gets its entries recreated the same way.
- Nothing is downloaded, installed or left running. The app starts it through `powershell.exe` from `%SystemRoot%\System32`, passed as `-EncodedCommand` so no shell interprets it on the way.

It can come back if a real DualSense is plugged into the PC by USB again; press the button again then. To do it by hand instead: run the same script in an administrator PowerShell, then replug the dongle.

### macOS (untested)

The macOS build hasn't been tested on a Mac yet; reports are welcome.


Download the `.zip`, unzip it, and move the app to *Applications*. The build isn't signed yet, so the first time, right-click the app and choose **Open**. On macOS the app tells you about updates and links to the download, but doesn't install them itself.

## Updates

- **App:** about 20 seconds after it starts (then every 6 hours) the app checks for a new version. If there is one, a banner offers **Download and install**, then **Restart now**. Every download is checked against its published size and SHA-256 before anything is replaced, and the app never installs an older version. Turn automatic checks off in ⚙ App settings or the tray menu.
- **Firmware:** each app release includes the firmware it was built with, and a newer published firmware is offered when there is one. Both appear under **Dongle** (**Check now** looks right away). One click does everything: download and verify, restart the dongle into its bootloader, flash it, wait for it to come back, and confirm the version. Don't unplug the dongle while it runs (about 20 seconds); press **PS** on the controller afterwards.

## Privacy

No accounts, no analytics, no telemetry. The app only goes online to check GitHub for updates and to load the firmware changelog. To show your controller's colors, the dongle reads the colorway code from the controller's factory serial number once when it connects; only those two characters are kept, and they never leave your PC. The Games page reads launcher settings only after you allow it. It can only open the dongle and the dongle's bootloader over USB; every other device and web permission is refused.

## Troubleshooting

See [the guide's troubleshooting](docs/GUIDE.md#9-troubleshooting) (amber light bar and USB 3.0 ports, nothing showing up, "Not connected", settings resetting, and more).

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

The result is in `release/`. The official downloads are built the same way by [GitHub Actions](https://github.com/MarcelineVPQ/DS5Dongle-OLED-Edition/blob/master/.github/workflows/release.yml) on the firmware repo, on real Linux, Windows and macOS machines, so anyone can see exactly how each file was made. Those builds also include the matching firmware; a build you make yourself doesn't, and downloads it from the update feed when you flash.

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
- **Audio:** The clean controller speaker and Bluetooth mic are [awalol](https://github.com/awalol/DS5Dongle)'s work upstream: the audio path that runs from RAM, the packed audio reports and the mic decoding (and finding the bit that turns the mic on).
- **Thanks** to [loteran/DS5Dongle](https://github.com/loteran/DS5Dongle) (audio fixes, Audio Auto Haptics DSP) and [zurce/DS5Dongle-OLED](https://github.com/zurce/DS5Dongle-OLED) (multi-slot pairing).
- **Live controller art:** DualSense art from the [Gamepad Asset Pack](https://github.com/AL2009man/Gamepad-Asset-Pack) by AL2009man, MIT, modified (recolored and tagged by `tools/prepare_controller_art.py`; license in `src/assets/AL2009MAN-LICENSE.txt`).
- **Tray icon and web tool art:** "PS5 Button Icons and Controls" by [Zacksly](https://zacksly.itch.io), [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), modified.
- **PICOBOOT flasher:** picoflash by Piers Finlayson (MIT).

DualSense and PlayStation are trademarks of Sony Interactive Entertainment. This project is not affiliated with Sony.

## License

[MIT](LICENSE).
