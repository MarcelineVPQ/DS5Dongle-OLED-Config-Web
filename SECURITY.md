# Security

## Supported versions

Only the latest release gets security fixes (the newest stable release, and the newest development build on the Development channel). The app updates itself; please update before you report.

## In scope

- **The app** (DS5 Dongle OLED Edition Configurator): its windows, IPC, the USB access it asks for (Set up USB access on Linux), the files it reads and writes, and the Games page's launcher and Proton changes.
- **The updater and its signed feeds:** `latest.json` / `latest-dev.json` must carry an Ed25519 signature from a trusted key, and every download is checked against its published size and SHA-256 before anything is replaced (`docs/SECURITY_AUDIT.md`, Updater).
- **Firmware installs:** the firmware the app downloads, verifies and flashes to your board, and the Proton build it installs.

How the app is hardened, part by part: [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md).

## Reporting a vulnerability

Please report it privately through GitHub: **Security → Report a vulnerability** on this repository, not in a public issue. Include what you found, how to reproduce it, and the app and firmware versions. You'll get an answer as soon as possible; this is a free project, so please allow some days.
