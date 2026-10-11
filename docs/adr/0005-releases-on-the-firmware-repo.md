# ADR-0005: Releases live on the firmware repo, and the app bundles the firmware

## Status

Accepted

## Date

2026-10-10

## Context

People need the app and the firmware, in matching versions. Until now they would have come from two release pages, with the update feed (`latest.json`, ADR-0003) on the app repo and firmware releases on the firmware repo. A new user also had to flash the firmware by hand before the app could do anything.

## Decision

- **The app is the product.** One release per version, `vX.Y.Z-oled-edition`, on **MarcelineVPQ/DS5Dongle-OLED-Edition**: the app for Linux, Windows and macOS, the Pico 2 W firmware UF2, and one `SHA256SUMS.txt`.
- **One version for both.** App X.Y.Z ships with firmware X.Y.Z (user decision). An app-only fix also bumps the firmware number; the reflash it offers is optional and takes about 20 seconds.
- **Built in one place.** The firmware repo's `release.yml` runs on that tag only. It builds the firmware with the configurator interface on, then checks out this repo at the same tag and builds the app on every OS with that UF2 in `resources/firmware/` (`firmware.json` holds its version and SHA-256). The release is published only once every file is attached. No cross-repo token is needed: this repo is public, and `tools/release.sh` (firmware repo) pushes the tag to both repos from the maintainer's machine.
- **Feed.** `latest.json` moves to the firmware repo's `master` and is rebuilt there after each release, daily and on demand. It describes the newest unified release (app and its own firmware) and the newest Proton build. It carries `channel: "stable"` so an opt-in development channel can be added later.
- **Firmware source in the app.** The main process offers the bundled firmware, or the published one when it is strictly newer (`electron/main/firmwareSource.ts`). The bundled file is checked against its SHA-256 before use. Offline, the bundled firmware still works, which makes first-time setup of a new dongle possible without a download.

## Consequences

### Positive

- One download page and one version number to support.
- A new dongle can be set up from the app alone.
- No PAT or cross-repo secrets.

### Negative

- An app-only fix produces a firmware version bump.
- The app build depends on the firmware repo's workflow; this repo's CI still lints, tests and builds every push.

### Neutral

- Builds made from source carry no bundled firmware and fall back to the update feed.
