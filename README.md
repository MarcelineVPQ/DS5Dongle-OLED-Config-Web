# DS5 Bridge Config — OLED Edition

Browser-based configuration tool for the [MarcelineVPQ/DS5Dongle-OLED-Edition](https://github.com/MarcelineVPQ/DS5Dongle-OLED-Edition) firmware. Reads and writes the firmware's persistent config over **WebHID** — no driver, no installer, no native app. Works on Linux / macOS / Windows in any Chromium-based browser (Chrome, Edge, Vivaldi, Brave, Opera). **Firefox is not supported** — Mozilla has declined to implement WebHID.

## What this fork adds vs upstream

Forked from [awalol/ds5dongle-config-web](https://github.com/awalol/ds5dongle-config-web) to support the extended `Config_body` shipped by the OLED Edition firmware:

- **Audio Auto Haptics** controls — 4-mode selector (Off / **Fallback (default)** / Mix / Replace), gain (0–200 %), and low-pass cutoff (80 / 160 / 250 / 400 Hz). DSP itself is borrowed from [loteran/DS5Dongle](https://github.com/loteran/DS5Dongle) commit `5d6bc2f`; the Fallback mode is an OLED-Edition addition that only fires when native haptics have been silent for ~1 s (preserves native HD haptics where games send them, fills in where they don't).
- **Multi-slot pairing** — pick the active slot (0–3) for the firmware's 4-slot persistent BT pairing system (Phase G).
- **Inactive timeout** slider — was missing from upstream's UI entirely despite existing in the firmware.
- **All bug fixes from upstream's stale UI**: `speakerVolume` validation rule corrected (was checking 1.0–2.0, fixed to -100..0 dB); `controllerMode` now includes the **Auto** option (upstream capped at DS5 / DSE only); `audioBufferLength` range corrected to `[16, 128]` (upstream allowed up to 255).
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

The firmware exposes four USB HID feature reports — same set across upstream, loteran, and OLED Edition. The OLED Edition's `0xF7` payload is 19 bytes (upstream's is 13, loteran's is 17).

| Report | Direction | Purpose |
|---|---|---|
| `0xF6` | host → device | Set config. `[0x01, ...body bytes]` = update in-memory; `[0x02]` = persist to flash; `[0x03]` = reconnect TinyUSB |
| `0xF7` | device → host | Read current `Config_body` (19 bytes for OLED Edition) |
| `0xF8` | device → host | Read firmware version string |
| `0xF9` | device → host | Read live BT RSSI (1 signed byte, dBm) |

`src/protocol/config.ts` is the single source of truth for the `Config_body` layout; if the firmware's `Config_body` ever grows or shrinks, edit only this file.

## Credits

- **[awalol/DS5Dongle](https://github.com/awalol/DS5Dongle)** — upstream firmware + original web config base.
- **[loteran/DS5Dongle](https://github.com/loteran/DS5Dongle)** — Audio Auto Haptics DSP design and the matching CLI tool (`scripts/set_ds5.py` in our firmware repo).

## License

Same as upstream awalol/ds5dongle-config-web.
