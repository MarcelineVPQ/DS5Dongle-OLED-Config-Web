# Security

## Supported versions

Only the latest release gets security fixes (the newest stable release, and the newest development build on the Development channel). The app updates itself; please update before you report.

## In scope

- **The app** (DS5 Dongle OLED Edition Configurator): its windows, IPC, the USB access it asks for (Set up USB access on Linux), the files it reads and writes, and the Games page's launcher and Proton changes.
- **The updater and its signed feeds:** `latest.json` / `latest-dev.json` must carry an Ed25519 signature from a trusted key, and every download is checked against its published size and SHA-256 before anything is replaced (`docs/SECURITY_AUDIT.md`, Updater).
- **Firmware installs:** the firmware the app downloads, verifies and flashes to your board, and the Proton build it installs.

How the app is hardened, part by part: [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md).

## If the feed signing key leaks

Installed apps trust the keys built into them (`TRUSTED_KEYS`, `electron/main/feedSignature.ts`); there is no way to revoke a key from outside, so whoever holds a leaked key can sign feeds until apps stop trusting it. The steps, in order:

1. Make a new key on the developer's PC (the firmware repository's release tools).
2. Release an app whose `TRUSTED_KEYS` holds only the new key. Sign its feed one last time with the old key, so installed apps take that update; from then on sign with the new key only, and the leaked key is refused from that version on.
3. Publish a GitHub security advisory on this repository and on the firmware repository: what leaked, since when, and which app version stops trusting it, with the release page link so users can install it by hand.

## Reporting a vulnerability

Please report it privately through GitHub: **Security → Report a vulnerability** on this repository, not in a public issue. Include what you found, how to reproduce it, and the app and firmware versions. You'll get an answer as soon as possible; this is a free project, so please allow some days.
