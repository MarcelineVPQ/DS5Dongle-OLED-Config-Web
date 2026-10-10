# ADR-0004: Linux: Chromium sandbox under AppArmor, NVIDIA GPU

## Status

Accepted

## Date

2026-10-10

## Context

Three Linux platform problems showed up on the first desktop launches (Ubuntu 26.04, KDE Plasma Wayland, NVIDIA 615, 120% display scale):

1. **Sandbox.** Ubuntu 23.10+ sets `kernel.apparmor_restrict_unprivileged_userns=1`. Chromium's namespace sandbox can't start without an AppArmor profile for the binary, and falls back to the setuid helper, which must be root-owned with mode 4755. Neither holds for `node_modules` or an AppImage, so Electron aborts. `app.commandLine.appendSwitch("no-sandbox")` from the main process is too late: the zygote has already started.
2. **GPU.** With the NVIDIA proprietary driver the GPU process crash-loops: SIGTRAP on Wayland, SIGSEGV under XWayland. Under XWayland the window also failed to draw at all.
3. **Scale.** Chromium persists zoom per origin. A temporary 0.67 zoom stuck after it was removed and was mistaken for a display-scale bug.

## Decision

1. **Sandbox.**
   - **Local runs** (`npm run dev:desktop`, `start:desktop`) pass `--no-sandbox`.
   - **Packaged Linux builds** (AppImage): electron-builder's `AppRun` probes `unshare -Ur true` and adds `--no-sandbox` only when the probe fails. An AppArmor profile for our binary can't fix that, because the probe runs `/usr/bin/unshare` (verified 2026-10-10). A full sandbox on Ubuntu needs a custom `AppRun` or a .deb with a profile; tracked as SECURITY_AUDIT O1.
   - **Renderer isolation always applies:** `contextIsolation`, sandboxed renderer, strict CSP, no Node in the page, a preload that exposes a fixed object, WebUSB limited to two devices, and every other web permission denied.
2. **GPU.** On NVIDIA (`/proc/driver/nvidia/version` exists), call `app.disableHardwareAcceleration()` and stay on native Wayland. A settings window doesn't need GPU compositing.
3. **Scale.** Pin `setZoomFactor(1)` after load. Enable `WaylandFractionalScaleV1` so the desktop scale is honored.

## Consequences

### Positive

- The app launches and renders crisply at the desktop's scale on the target setup.

### Negative

- Until the AppArmor profile ships, Linux runs without the OS-level Chromium sandbox. This is recorded in `docs/SECURITY_AUDIT.md`.

### Neutral

- Software rendering costs nothing noticeable for this UI.
