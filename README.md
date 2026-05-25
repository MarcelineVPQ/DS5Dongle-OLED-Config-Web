# DS5 Bridge Config — OLED Edition

<p align="center">
  <a href="https://marcelinevpq.github.io/DS5Dongle-OLED-Config-Web/">
    <img src="https://img.shields.io/badge/%E2%96%B6%20LAUNCH-Live%20Web%20Config-22c55e?style=for-the-badge&logo=googlechrome&logoColor=white&labelColor=0b1220" alt="Open the live web config in your browser">
  </a>
</p>

<p align="center"><b><a href="https://marcelinevpq.github.io/DS5Dongle-OLED-Config-Web/">▶ marcelinevpq.github.io/DS5Dongle-OLED-Config-Web</a></b> — no install, runs in any Chromium browser</p>

Browser-based configuration tool for the [MarcelineVPQ/DS5Dongle-OLED-Edition](https://github.com/MarcelineVPQ/DS5Dongle-OLED-Edition) firmware. Reads and writes the firmware's persistent config over **WebHID** — no driver, no installer, no native app. Works on Linux / macOS / Windows in any Chromium-based browser (Chrome, Edge, Vivaldi, Brave, Opera). **Firefox is not supported** — Mozilla has declined to implement WebHID.

## What this fork adds vs upstream

Forked from [awalol/ds5dongle-config-web](https://github.com/awalol/ds5dongle-config-web) to support the extended `Config_body` shipped by the OLED Edition firmware:

- **Button remapping (Remap tab)** — reassign any of the 16 digital controls (face buttons, D-pad, shoulders/triggers, stick clicks, Create/Options) to any other. Click a button on a live DualSense diagram to set its target, or use the collapsible full list; the map is stored on the dongle and applied before the host sees the report, so it works in every game and OS with **no host-side software**. The shoulders/triggers float out to the corners as labeled glyphs (off-camera in a front view). Rides the existing `0xF6`/`0xF7` reports (no HID-descriptor change → no Windows enumeration risk); apply persists to flash immediately and is confirmed by a revision read-back. Controller outline + button glyphs by [Zacksly](https://zacksly.itch.io) (CC BY 3.0).
- **OLED Preview tab** — live, in-browser pixel emulation of all 10 firmware OLED screens (Status, Slots, Lightbar, Trigger Test, Gyro, Touchpad, Diagnostics, RSSI, VU Meters, Settings). Renders to a 384×192 canvas inside a stylized Pico-OLED-1.3 device frame; KEY0 / KEY1 buttons in the UI cycle / contextual-back exactly like the physical hardware. Auto-cycles with mock data every 4 s when no controller is connected — so visitors can experience the whole feature set without owning the OLED add-on. Reads live data via HID feature reports `0xFA` (slots) and `0xFB` (diagnostics + audio meters) when a controller is connected. Share `#preview` on the URL to land Discord viewers directly on the emulator.
- **Multilingual UI** — 7 languages bundled via i18next: English, 中文, Español, Deutsch, Français, 日本語, Português. Auto-detects from browser, overridable via the header globe icon, persists choice to localStorage. Translations of non-English locales are machine-generated; PRs from native speakers welcome.
- **Audio Auto Haptics** controls — 4-mode selector (Off / **Fallback (default)** / Mix / Replace), gain (0–200 %), and low-pass cutoff (80 / 160 / 250 / 400 Hz). DSP itself is borrowed from [loteran/DS5Dongle](https://github.com/loteran/DS5Dongle) commit `5d6bc2f`; the Fallback mode is an OLED-Edition addition that only fires when native haptics have been silent for ~1 s (preserves native HD haptics where games send them, fills in where they don't).
- **Multi-slot pairing** — pick the active slot (0–3) for the firmware's 4-slot persistent BT pairing system (Phase G).
- **Inactive timeout** slider — was missing from upstream's UI entirely despite existing in the firmware.
- **All bug fixes from upstream's stale UI**: `speakerVolume` validation rule corrected (was checking 1.0–2.0, fixed to -100..0 dB); `controllerMode` now includes the **Auto** option (upstream capped at DS5 / DSE only); `audioBufferLength` range corrected to `[16, 128]` (upstream allowed up to 255).
- Bento-grid layout with light / system / dark theme toggle, Pico-OLED-1.3 device-frame hero, and DualSense face-button glyph accents.
- Branding updates: title, footer, hint text for each control.

## Run

Use either the deployed GitHub Pages site (link in repo About panel once Pages is enabled), or run locally:

```bash
npm install
npm run dev          # vite dev server, http://127.0.0.1:5173
npm run build        # type-check + production bundle into dist/
npm run preview      # serve the production bundle locally
```

## Wire protocol

The firmware exposes six USB HID feature reports — `0xF6`–`0xF9` are shared with upstream and loteran; `0xFA` and `0xFB` are OLED-Edition additions consumed by the in-browser emulator. The OLED Edition's `0xF7` payload is 19 bytes (upstream's is 13, loteran's is 17).

| Report | Direction | Purpose |
|---|---|---|
| `0xF6` | host → device | Set config. `[0x01, ...body bytes]` = update in-memory; `[0x02]` = persist to flash; `[0x03]` = reconnect TinyUSB |
| `0xF7` | device → host | Read current `Config_body` (19 bytes for OLED Edition) |
| `0xF8` | device → host | Read firmware version string |
| `0xF9` | device → host | Read live BT RSSI (1 signed byte, dBm) |
| `0xFA` | device → host | Read multi-slot pairing table (4 × 6-byte bd_addr + 4 × occupancy flag = 28 bytes). OLED Edition only. |
| `0xFB` | device → host | Read live diagnostics: uptime, USB-audio frame counter, BT-0x32 packet counter, speaker peak, haptic peak, HCI error count (18 bytes). OLED Edition only. |

**Button remap** rides the same `0xF6`/`0xF7` reports rather than a new report ID (declaring extra HID report IDs broke DualSense enumeration on Windows). `0xF6` with func-id `0x10` and an `['R','M', version, table[16]]` frame sets the 16-entry remap table (source→target, `0xFF` = disabled); the `0xF7` response appends an `['R','M', version, revision, table[16]]` block after `Config_body` so the web tool reads config + remap in one GET (older firmware omits it). See `src/protocol/remap.ts`.

`src/protocol/config.ts` is the single source of truth for the `Config_body` layout; if the firmware's `Config_body` ever grows or shrinks, edit only this file.

## Trust model (Flash Firmware tab)

The browser-based flasher uses WebUSB to push a UF2 to a Pico in BOOTSEL mode. A few things worth knowing:

- **Browser permission gate**: WebUSB requires a user gesture + explicit device-picker confirmation per origin. Authorizations are persistent per origin and revocable at `chrome://settings/content/usbDevices`.
- **Bundled latest UF2**: when the deploy workflow runs, it downloads the latest release UF2 from `MarcelineVPQ/DS5Dongle-OLED-Edition` and bundles it as `public/firmware-latest.uf2` alongside this site. The "Use latest release" button reads it same-origin. CI also writes the SHA-256 into `firmware-latest.json`; the UI compares that against the SHA-256 it computes from the fetched bytes and logs a warning if they differ.
- **User-supplied UF2**: when you pick a file from your disk, a warning banner appears reminding you that the firmware will run with USB-device privileges on every host the dongle subsequently plugs into. Only flash files from sources you trust.
- **No signature verification on the bootloader side**: stock RP2350 BOOTSEL accepts any firmware image. Secure Boot via OTP fuses exists but is one-way and is deliberately not used here, because it would block normal re-flashing.
- **Per-board serial display**: the device-info strip shows the per-board flash chip ID (e.g. `BC844357D3EF5218`). We never transmit it; it's there so you can recognize your own device.
- **Same-origin everything**: no third-party CDNs, no analytics, no telemetry. The flasher's only outbound network requests are the same-origin fetches for `firmware-latest.{uf2,json}`.

The firmware's release page also includes a `SHA256SUMS.txt` asset; you can manually verify the bundled UF2 hash against it.

## Credits

- **[awalol/DS5Dongle](https://github.com/awalol/DS5Dongle)** — upstream firmware + original web config base.
- **[loteran/DS5Dongle](https://github.com/loteran/DS5Dongle)** — Audio Auto Haptics DSP design and the matching CLI tool (`scripts/set_ds5.py` in our firmware repo).
- **[PS5 Button Icons and Controls](https://zacksly.itch.io/ps5-button-icons-and-controls)** by **Zacksly** — DualSense controller outline + button glyphs used in the Remap tab, licensed [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) (recolored to `currentColor` and cropped for theming).

## License

Same as upstream awalol/ds5dongle-config-web.
