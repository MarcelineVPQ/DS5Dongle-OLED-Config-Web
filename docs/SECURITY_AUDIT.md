# Security Audit

**Audit date:** 2026-10-10 (desktop app introduction)
**Scope:** the Electron main process, preload, renderer, device access, external links, build and dependency supply chain
**Overall posture:** **GOOD** for the threat model below; one platform gap is recorded and tracked (Linux OS sandbox).

## Threat model

The app runs locally and talks to one USB device. It loads no remote content and has no accounts or secrets. What matters:

1. **Renderer compromise** (e.g. a malicious dependency in the UI bundle) must not reach the OS or other USB devices.
2. **Navigation / window.open** must not load remote content into a privileged window.
3. **Self-update** (Phase 3) must not run a corrupted or unexpected binary.
4. **Supply chain**: dependencies are pinned, audited, and updated deliberately.

## Controls in place

| Control                    | Where                                    | Detail                                                                                                                                                                                 |
| -------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer isolation         | `electron/main/index.ts`                 | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`                                                                                                 |
| Minimal preload            | `electron/preload/index.ts`              | Exposes one fixed object (`window.desktop`); no `ipcRenderer`, no Node APIs                                                                                                              |
| Web permissions            | `lockDownSession()`                      | Every permission request denied; permission checks pass only for `usb` from the app origin                                                                                              |
| USB device allowlist       | `electron/main/devices.ts`               | WebUSB limited to 054C:0CE6, 054C:0DF2 (dongle) and 2E8A:000F (RP2350 BOOTSEL). Chromium additionally blocks the protected HID/audio classes, so only the vendor interface is reachable |
| Navigation / new windows   | `createWindow()`                         | `will-navigate` blocks every URL but the app's own page (the exact packaged `index.html`, or the dev server's origin), which is also the only page trusted for IPC and WebUSB; `setWindowOpenHandler` always denies and opens only allowlisted https URLs (`electron/main/urls.ts`: github.com, marcelinevpq.github.io, zacksly.itch.io, 42pixelstudios.com) in the system browser           |
| Content Security Policy    | `electron.vite.config.ts`                | `default-src 'self'; script-src 'self'`, no `unsafe-eval`, no remote origins, fonts self-hosted, assets never inlined as `data:`                                                          |
| Single instance            | `requestSingleInstanceLock()`            | Prevents two processes contending for the USB claim                                                                                                                                      |
| Updater                    | `electron/main/updater.ts`, `src/update/manifest.ts` | zod-validated manifest; downloads only from GitHub release hosts; streamed SHA-256 + exact size, fail closed; strictly-newer versions only; the renderer never touches the network (firmware bytes are verified in main, then handed over) |
| Privileged setup           | `electron/main/linuxSetup.ts`            | The only root action (Linux udev rule) runs through `pkexec` with a fixed script; paths are positional arguments, never interpolated; the rule file ships in the app's resources and is handed to root through a private temporary copy (root cannot read the AppImage mount) |
| Renderer → main IPC        | `electron/main/ipc.ts`                   | Fixed channel table; every message checks the sender (our window, our page) and parses its payload with zod; tray icons must be size-capped PNG data URLs                              |
| DOM sinks                  | `.hooks/check_dom_sinks.sh` + ESLint      | No `innerHTML`/`eval`/`new Function`; two documented `dangerouslySetInnerHTML` uses render bundled build-time SVGs only                                                                |
| Regression tests           | `tests/security/electron.test.ts`        | Allowlists and the window/session/CSP baseline                                                                                                                                           |
| Dependencies               | `package.json`, Dependabot, `npm-audit.yml` | Exact versions, chosen ≥ 2 weeks after release; weekly grouped Dependabot PRs; CI fails on high-severity advisories in shipped dependencies                                         |
| SAST / secrets             | `security-scans.yml`                     | Semgrep (security-audit, secrets, typescript, react, javascript, owasp-top-ten) and Gitleaks over full history, weekly and on every push                                             |

## Open items

| #   | Severity | Item                                                                                                                                                                                                 | Plan                                                                                                         |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| O1  | MEDIUM   | **Linux runs without Chromium's OS-level sandbox** (`--no-sandbox`) on systems where AppArmor restricts unprivileged user namespaces (Ubuntu 23.10+). electron-builder's AppImage `AppRun` probes with `unshare -Ur true` and adds `--no-sandbox` only when that fails; elsewhere the sandbox is on. Renderer isolation above still applies. An AppArmor profile for our binary would not help, because the probe runs `/usr/bin/unshare`, which the profile doesn't cover. ADR-0004 | Custom AppRun that probes with our own binary, plus an AppArmor profile; or a .deb with a profile, like VS Code |
| O2  | LOW      | `style-src 'unsafe-inline'` in the CSP (React inline `style` props)                                                                                                                                  | Move remaining inline styles to classes, then drop it                                                        |
| O3  | INFO     | Self-update: the checksum comes from the same origin as the binary (HTTPS is the trust anchor), so it protects against corruption, not a compromised release. The loopback test feed (`DS5_UPDATE_MANIFEST`, 127.0.0.1 only) works in packaged builds by design, for pre-release testing | Code-sign builds; consider signed manifests |
| O4  | INFO     | Dev-only dependency advisories (e.g. moderate `sprintf-js` via tooling) are reported but not shipped                                                                                                 | Track via Dependabot                                                                                         |
