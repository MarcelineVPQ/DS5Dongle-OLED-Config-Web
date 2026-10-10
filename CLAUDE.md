# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Configurator for the **DS5 Dongle OLED Edition** firmware (`MarcelineVPQ/DS5Dongle-OLED-Edition`, a Pico 2 W DualSense Bluetooth bridge). One React + TypeScript codebase, two targets:

- **Web tool**: `vite build`, deployed to GitHub Pages by `.github/workflows/deploy.yml`. Entry `src/App.tsx` (original roomy layout, tabs).
- **Desktop app**: Electron, `electron-vite build`. `src/main.tsx` renders `src/desktop/DesktopApp.tsx` when the preload exposed `window.desktop`. Compact sidebar layout.

The firmware repo is `~/projects/DS5Dongle`; its `CLAUDE.md` documents the device protocol (`src/cmd.cpp`, `src/vendor_itf.{h,cpp}`).

## Commands

```bash
npx -y npm@11.6.2 ci     # install (system npm 9/10 crashes on this tree: "edgesOut")
npm run dev              # web, http://127.0.0.1:5173
npm run dev:desktop      # desktop with HMR (--no-sandbox, see ADR-0004)
npm run build:desktop && npm run start:desktop
npm run check            # typecheck + lint + format check + security gates + tests (what CI runs)
npm test                 # vitest: tests/{unit,integration,security}
node tools/update_version.mjs --verify
pre-commit run --all-files
```

## Architecture

- **Transport** (`src/protocol/transport.ts`, `webUsbTransport.ts`): WebUSB vendor control transfers to the firmware's configurator interface (class 0xFF). GET `0xC1/0x01`, SET `0x41/0x02`, wValue = report id, payload ≤ 63 bytes **without** a report-id byte. ADR-0001.
- **Client** (`src/protocol/bridgeClient.ts`): `identity()` (`0xF1`, `DS5O`, protocol major must equal `SUPPORTED_PROTO_MAJOR`), `command(func, args)` sends `0xF6` and polls `0xF1` until the sequence matches and the result leaves `pending`; reboot/BOOTSEL resolve `"gone"`. Codecs: `config.ts` (37-byte `Config_body`), `remap.ts`.
- **Hook** (`src/hooks/useDs5Bridge.ts`): auto-connects to an already-permitted device, reconnects on USB connect/disconnect, tracks `config` (on the dongle's RAM), `savedConfig` (in flash as far as we know) and `draft`.
- **Desktop shell** (`src/desktop/`): `DesktopApp.tsx` debounces draft changes into `applyConfig` (live), bottom bar has Revert / Save to dongle. Pages in `pages/`, compact controls in `controls.tsx`, styles in `desktop.css` (includes density overrides for shared web components).
- **Electron main** (`electron/main/index.ts`): single instance; session grants only WebUSB to the app origin and only the devices in `devices.ts`; all other permissions denied; navigation and window.open blocked (allowlisted https links open externally, `urls.ts`). Preload (`electron/preload/index.ts`) exposes only `window.desktop`.
- **WebHID** (`src/protocol/ds5BridgeHid.ts`) remains only for the browser's live OLED preview (input reports).

## Load-bearing rules

- **Desktop UI must be compact and fill the window** (user requirement): ~13px type, tight padding, a 100vh grid shell, only the page body scrolls. No zoom hacks. Match the OLED's zero-based naming (FAV0–FAV3, slots 0–3).
- **Light theme uses its own deeper greens and greys** (`--dk-*` tokens in `desktop.css`); the web tool's pale accent is unreadable on the desktop.
- **Never use AI-drawn or traced controller art.** Use the purchased Zacksly pack (CC BY 3.0, `assets/PS5 Button Icons and Controls/`, credit required) or the MIT AL2009man Gamepad-Asset-Pack.
- **Security baseline** is gated by `.hooks/check_electron_security.sh`, `.hooks/check_dom_sinks.sh` and `tests/security/`. Changing window/session/CSP/allowlists requires updating `docs/SECURITY_AUDIT.md` and those tests.
- **Protocol changes** land in the firmware first, then the client, the fake (`tests/support/fakeDongle.ts`) and the tests in the same change.
- **Dependencies**: exact versions, chosen ≥ 2 weeks after release.
- **Linux dev quirks** (ADR-0004): `--no-sandbox` (AppArmor userns restriction), software rendering on NVIDIA, zoom pinned to 100%. When restarting the app from a shell, kill by full path (`pgrep -f "Config-Web/node_modules/electron/dist/electron"`): it is single-instance, so a stale hidden copy blocks every new launch.

## Git Workflow

- Default branch is **`master`**. Feature work on branches; Conventional Commits (`docs/CONTRIBUTING.md`).
- **Never commit or push unless the user asks.**
- Commits carry a `Co-Authored-By: Claude …` trailer.

## Docs

`docs/adr/` (decisions), `docs/CONTRIBUTING.md`, `docs/TEST_PLAN.md`, `docs/SECURITY_AUDIT.md`, `docs/LINT_SUPPRESSIONS.md`, `CHANGELOG.md`.
