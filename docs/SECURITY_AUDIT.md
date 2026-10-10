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
| Navigation / new windows   | `createWindow()`                         | `will-navigate` blocks anything outside the app; `setWindowOpenHandler` always denies and opens only allowlisted https URLs (`electron/main/urls.ts`) in the system browser            |
| Content Security Policy    | `electron.vite.config.ts`                | `default-src 'self'; script-src 'self'`, no `unsafe-eval`, no remote origins, fonts self-hosted, assets never inlined as `data:`                                                          |
| Single instance            | `requestSingleInstanceLock()`            | Prevents two processes contending for the USB claim                                                                                                                                      |
| DOM sinks                  | `.hooks/check_dom_sinks.sh` + ESLint      | No `innerHTML`/`eval`/`new Function`; two documented `dangerouslySetInnerHTML` uses render bundled build-time SVGs only                                                                |
| Regression tests           | `tests/security/electron.test.ts`        | Allowlists and the window/session/CSP baseline                                                                                                                                           |
| Dependencies               | `package.json`, Dependabot, `npm-audit.yml` | Exact versions, chosen ≥ 2 weeks after release; weekly grouped Dependabot PRs; CI fails on high-severity advisories in shipped dependencies                                         |
| SAST / secrets             | `security-scans.yml`                     | Semgrep (security-audit, secrets, typescript, react, javascript, owasp-top-ten) and Gitleaks over full history, weekly and on every push                                             |

## Open items

| #   | Severity | Item                                                                                                                                                                                                 | Plan                                                                                                         |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| O1  | MEDIUM   | **Linux runs without Chromium's OS-level sandbox** (`--no-sandbox`) on systems where AppArmor restricts unprivileged user namespaces (Ubuntu 23.10+). Renderer isolation above still applies. ADR-0004 | Ship an AppArmor profile in the one-time Linux setup (with the udev rule); drop `--no-sandbox` when present |
| O2  | LOW      | `style-src 'unsafe-inline'` in the CSP (React inline `style` props)                                                                                                                                  | Move remaining inline styles to classes, then drop it                                                        |
| O3  | INFO     | Self-update not implemented yet. Design (ADR-0003) fails closed on missing/short checksums, downloads only from manifest URLs on GitHub hosts, and never downgrades                                   | Re-audit when Phase 3 lands                                                                                  |
| O4  | INFO     | Dev-only dependency advisories (e.g. moderate `sprintf-js` via tooling) are reported but not shipped                                                                                                 | Track via Dependabot                                                                                         |
