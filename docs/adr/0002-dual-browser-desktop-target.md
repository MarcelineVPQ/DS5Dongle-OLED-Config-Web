# ADR-0002: One codebase, browser and Electron targets

## Status

Superseded (2026-10-11): the browser tool was retired with 0.8.0 and its code removed (`cc794d6`, "remove the retired web tool"). The repository builds only the desktop app; GitHub Pages serves the static download page in `site/`. The browser flasher (`src/flash/`) stays, as the app's firmware updater. Kept as the record of why the desktop app exists.

## Date

2026-10-10

## Context

The project premise is that dongle software must work on Linux, macOS and Windows; nothing OS-locked. The browser tool covers that without an install but can't do everything:

- **Self-update** isn't possible from a browser.
- **The tray**, close-to-tray and launch-at-login all need a desktop app.
- **Keeping track of the device** in the background needs a running process.
- **Firefox and Safari** have no WebUSB.

## Decision

Keep one repository and one React renderer, built two ways:

- **`vite build`:** the GitHub Pages web tool. Entry `App.tsx`, the original layout.
- **`electron-vite build`:** the desktop app. The same `index.html`, but `src/main.tsx` renders `src/desktop/DesktopApp.tsx` when the preload has exposed `window.desktop`.

Shared code includes the protocol (`src/protocol/`), the connection hook (`src/hooks/useDs5Bridge.ts`), i18n and the flasher. The desktop shell has its own compact layout (`src/desktop/`) with sidebar pages and a pinned save bar. The page fills the window and reflows on resize.

## Consequences

### Positive

- Protocol fixes ship to both targets at once.
- The browser tool keeps working with no install.

### Negative

- Components shared with the web layout need desktop density overrides (`src/desktop/desktop.css`, "Shared web components").

### Neutral

- The desktop app is built with electron-vite and packaged with electron-builder.
