# ADR-0003: Self-update from a repo-hosted `latest.json` manifest

## Status

Accepted (implemented and verified end to end on Linux, 2026-10-10). Where the feed and releases live was changed by [ADR-0005](0005-releases-on-the-firmware-repo.md).

## Date

2026-10-10

## Context

The desktop app must update itself and the dongle's firmware. The model is the Neon Debris updater (`auto_battler/scripts/autoload/update_manager.gd`, `docs/planning/auto_update_plan.md`), which was itself hardened from Sonata's Electron updater (`apple-music-for-linux/main.js`) and has passed an end-to-end self-update on Linux.

## Decision

- **Feed.** One `latest.json` committed to this repo's default branch and served from `raw.githubusercontent.com`: no API rate limit, and indifferent to prerelease flags. It carries `app.{version, notes_url, platforms.{linux,windows,macos}.{url,size,sha256}}` and `firmware.{version, notes_url, url, size, sha256}`. Every entry has a full download URL; the client never builds one.
- **Client.** The same state machine as Neon Debris: check 20 s after launch, show a banner, download only on click with byte progress, stream the SHA-256, install, restart. The rules:
  - **Strictly-newer versions only**, and an unparseable version means "no update".
  - **Fail closed** on a missing or short checksum.
  - **No restart while a firmware flash is running.**
  - **Honest UI:** the checksum guards against corruption, not supply-chain attacks.
- **Linux (AppImage).**
  - Download a versioned file beside the current one, and never delete the running AppImage (it would SIGBUS).
  - Keep a stable `DS5Configurator.AppImage` symlink, with `.desktop` and icon entries pointing at it.
  - Relaunch through `systemd-run --user` with an allowlisted environment.
  - Prune old versions on the next launch.
- **Windows.** A **per-user NSIS installer** (owner's decision, 2026-10-14; was a portable single exe from 2026-10-10, which unpacked ~1 GB to Temp on every start, took 18–21 s to show the window on a second start and deleted the running copy's files). No admin rights, installs to `%LOCALAPPDATA%\Programs`, Start menu entry and uninstaller from the installer. Update: download the `-win-x64-setup.exe` the feed names (file name checked), verify it, keep it in `%TEMP%\ds5-configurator-update`; **Restart now** runs it with `/S --updated --force-run` (it closes the app, installs over it and starts the new version); quitting with an update ready runs it with `/S --updated` (not while Windows signs out or shuts down). Only the installed copy (its uninstaller beside it) updates itself. Portable copies (0.9.5-dev.11 and before) can't update themselves at all: their rename dance fails with EBUSY because the portable launcher keeps its own exe open (measured in the Win11 VM, 2026-10-14), so those users download the installer once (release notes, README); the installed app finds their settings and says once that the old exe can go.
- **macOS.** Banner and release-page link only, until builds are signed.
- **Firmware.** Read the version (`0xF8`), compare, download the UF2 and verify its SHA-256. Then send `0xF6 0x08` (BOOTSEL), flash over PICOBOOT with the existing flasher, and read the version back.
- **Publishing.** `tools/release.sh` (firmware repo, since [ADR-0005](0005-releases-on-the-firmware-repo.md)) checks that tests are green, the version is consistent and the CHANGELOG has an entry. CI builds and uploads the assets. Every asset must resolve before `latest.json` is written, so the manifest never points at missing files.

## Consequences

### Positive

- Proven design, already exercised end to end on Linux in Neon Debris.

### Negative

- A firmware block in this repo's manifest couples the firmware release flow to this repo (one extra step in the firmware release).

### Neutral

- The checksum and the binary come from the same origin; HTTPS is the trust anchor.
