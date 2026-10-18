# Contributing to the DS5 Dongle OLED Edition Configurator

## Development Setup

### Prerequisites

- Node.js 22+
- **npm 11** (`npx -y npm@11.6.2 …`). The npm 9/10 that ships with Node 22 on some distros crashes with `Cannot read properties of null (reading 'edgesOut')` resolving this dependency tree.
- Git, and [pre-commit](https://pre-commit.com/) (`pip install pre-commit`)
- For hardware testing: a dongle on OLED Edition firmware built with `ENABLE_COMPANION_VENDOR` (v0.8+)

### Initial Setup

```bash
git clone https://github.com/MarcelineVPQ/DS5Dongle-OLED-Config-Web.git
cd DS5Dongle-OLED-Config-Web
npx -y npm@11.6.2 ci
pre-commit install
```

### Running

```bash
npm run dev:desktop    # desktop app with hot reload
npm run build:desktop  # desktop production build into out/
npm run start:desktop  # run the desktop production build
```

On Linux the desktop scripts pass `--no-sandbox` (see `docs/adr/0004-linux-sandbox-and-gpu.md`). If the app can't open the dongle (`SecurityError` / access denied), press **Set up USB access** on the board's page (under **Connection to the PC**): it installs `resources/linux/70-ds5-dongle.rules` (`054c:0ce6`, `054c:0df2` in DualSense Edge mode, and the Pico bootloader `2e8a:000f`). Steam's controller rules often already grant it. The browser web tool is gone (ADR-0002); there is no browser build to run.

## Code Style

Automated, same roles as AVNetworkMonitor's Black / isort / Pylint / mypy:

- **Prettier**: formatting (`.prettierrc.json`, print width 200)
- **ESLint**: bugs and hooks rules (`eslint.config.js`)
- **TypeScript**: `strict` everywhere, separate projects for app / electron / node / tests (`tsc -b`)

```bash
npm run format        # write
npm run lint
npm run typecheck
npm run check         # everything CI runs: typecheck, lint, format check, gates, tests
```

### Pre-commit Hooks

```bash
pre-commit run --all-files
git commit --no-verify   # emergencies only
```

Project-specific gates (`.hooks/`):

- **`check_electron_security.sh`** blocks `nodeIntegration: true`, `contextIsolation: false`, `sandbox: false`, `webSecurity: false`, insecure content, and exposing `ipcRenderer` through `contextBridge`.
- **`check_dom_sinks.sh`** blocks `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`/`dangerouslySetInnerHTML`/`eval`/`new Function`. A justified exception (e.g. a bundled build-time SVG) carries `sink-allowed: <reason>` on the same line.
- **`check_theme_colors.mjs`** blocks a literal color (`#hex`, `rgb()`, `hsl()`, named) in `src/` `.css`, `.tsx` and `.ts` outside the theme tokens. The palette files are exempt by path (`TOKEN_SOURCES` in the script); any other exception carries `theme-exempt: <reason>` on the line (`--list` prints them all).

Gates in `tools/` (also in `npm run gates` and CI):

- **`list_duplicates.mjs --check`** fails on a duplicate candidate (CSS selector, top-level name, repeated 4-line block) with no verdict in `docs/DEDUPE_AUDIT.md`'s "Every row now" table, or a table row the lister no longer finds. Merge the copy, or add a row with its verdict.
- **`check_identical_files.mjs`** fails on byte-identical git-tracked files. `node tools/check_identical_files.mjs ../DS5Dongle` also checks across the app and firmware repos (for the firmware's `tools/release.sh`). Allowlisted groups live in the script, each with the finding that removes it.
- **`list_loops.mjs --check`** fails on a loop that awaits, sits on a hot path (render, useEffect, rAF, setInterval, a poll, a WebUSB handler, the audio worklet, the library scan, or what they call) or is nested in another loop, and has no `// loop: VERDICT — reason` comment on its line or the line above (`{/* loop: … */}` in JSX). Verdicts: PARALLELIZE, BATCH, SERIAL-REQUIRED (give the reason), HOT-PATH-OK (state N), FIX-HOT-PATH, NOT-WORTH. Add the comment in the same commit as the loop. When a release touches hot paths, re-run the full pass: run `node tools/list_loops.mjs` here and `python3 tools/list_loops.py` in the firmware, re-check every verdict, and update the tables in `docs/LOOP_PASS_<date>.md`. See CLAUDE.md "Loop pass".
- **`list_lifetimes.mjs --check`** fails on an acquisition (a listener, `on*` subscription, timer, animation frame, `usePoll`, mic stream, AudioContext, observer, device open, spawn, watcher, Electron window/tray/menu, object URL, or a `useEffect`) without a `// lifetime: VERDICT — release point` comment on its line or in the comment block above (`{/* lifetime: … */}` in JSX). Verdicts: OK (name where it is released), LEAK, WASTE, HOT-ALLOC, NOT-WORTH (say why). Add the comment in the same commit as the acquisition. **The leak test** (`tests/integration/leaks.test.ts`) mounts and unmounts every main page and panel 50 times and expects every count back at baseline; a new page or panel joins its list. When a release adds pages, polls, audio or device code, re-run the full pass here and in the firmware (`python3 tools/list_lifetimes.py`) and update `docs/LIFETIME_PASS_<date>.md`. See CLAUDE.md "Lifetime pass".
- **`list_caches.mjs --check`** fails on kept state without a `// cache: VERDICT — key=…; invalidated=…; bound=…` comment on its line or the line above: a module-level or class collection written after load, a module/class value used as a memo (lazy init, `??=`, a timestamp, a value read from disk/IPC/network), a closure memo, a `useRef` used as a cache, a value mirrored from a file at load. Verdicts: OK, FIX-STALE, FIX-UNBOUNDED (name the growth source), ADD-CACHE, REMOVE, NOT-WORTH. Add the comment in the same commit as the cache. `tools/list_caches.mjs` and `tools/list_loops.mjs` share `tools/ts_program.mjs` (the program, function names, call resolution). Re-run the full pass (`node tools/list_caches.mjs --firmware ../DS5Dongle`) when a release adds caches, polls or library-scan reads, and update `docs/CACHE_PASS_<date>.md`. See CLAUDE.md "Cache pass".

- **`list_errors.mjs --check`** fails on an error path without a verdict: a try/catch, `.catch`, `.then(ok, onRejected)`, `void` promise, IPC handler or renderer IPC call, zod parse, child process, fetch, `JSON.parse` or failure field in a result type. Write the verdict as `// error: VERDICT — reason` on the line or the line above, or use the handlers that carry it: `.catch(shown("desktop.errors.…"))` (SHOWN: the user sees it, in all 7 languages) or `.catch(logged("why"))` (LOGGED-OK). It also fails on a SHOWN key missing from en.json, and on a SILENT-BUG / SWALLOWED / FLOATING row that doesn't name its batch. ESLint adds `no-floating-promises` (with `void` only in front of a handled chain), `no-misused-promises` and `no-empty` (catch included). See CLAUDE.md "Error pass" and `docs/ERROR_PASS_2026-10.md`.
- **`list_settings.mjs --check`** fails on a setting outside the one framework: an old-style settings card, a setting row or action button outside a `Section`, a bare `<select>` or range input without its `Row`, a `Section` without a stable id, icon or translated title, or a `Section` with no setting or action (readouts go in the main view as a `MainBlock`). A card that only looks like one says `// settings-gate: not-settings — reason`.
- **`list_hints.mjs --check`** fails on a visible hint (a row's `sub`, a `dk-hint` paragraph) longer than its limit, unless it says `// hint: MUST-SHOW — reason`; longer explanations go behind the ⓘ (`InfoTip`).

Gates in the tests:

- **`tests/unit/dependencies.test.ts`**: exact versions only (no `^`, `~`, ranges or tags), the lockfile matches, `.npmrc` `save-exact=true`, Dependabot `cooldown` ≥ 14 days.
- **`tests/unit/lintSuppressions.test.ts`**: every inline `eslint-disable` (rule + file) is in `docs/LINT_SUPPRESSIONS.md`, and every row there still exists. ESLint itself errors on an unused disable (`reportUnusedDisableDirectives`).
- **`tests/unit/roadmapBacklog.test.ts`**: every About → Coming soon entry (`src/desktop/about/roadmap.ts`) maps to one `docs/BACKLOG.md` row whose status matches its column. A new or renamed entry goes in the test's `BACKLOG_ROW` map.

## Testing

See `docs/TEST_PLAN.md`.

```bash
npm test
npm run test:coverage
npx vitest run tests/integration   # one category
```

## Pull Request Process

1. Branch from `master`: `git checkout -b feat/your-feature`
2. `npm run check` passes and `pre-commit run --all-files` is clean
3. User-facing change: add a `CHANGELOG.md` entry under `[Unreleased]`
4. Protocol change: update the firmware's `CLAUDE.md` protocol section and bump `PICO_PROTO_MINOR` (additions) or `MAJOR` (layout breaks); the app's `SUPPORTED_PROTO_MAJOR` must follow
5. Security-relevant change (window, session, IPC, CSP, device allowlist, updater): update `docs/SECURITY_AUDIT.md` and the tests in `tests/security/`
6. Architectural decision: add an ADR (`docs/adr/`)

## Commit Message Format

[Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `ci`, `deps`. Common scopes: `desktop`, `games`, `ui`, `live`, `dongle`, `controller`, `protocol`, `i18n`, `updates`, `security`, `backlog`, `changelog`, `guide`, `gates`, `release`.

## Versioning

`package.json` `version` is the single source of truth. `node tools/update_version.mjs 1.2.3` sets it and syncs the CHANGELOG header; `node tools/update_version.mjs --verify` fails if anything disagrees (CI and the firmware repo's `tools/release.sh` run it).

## License

MIT (`LICENSE`). Third-party assets keep their own licenses: Zacksly art is CC BY 3.0 (`src/assets/ZACKSLY-LICENSE.txt`), the PICOBOOT library ships its own (`src/flash/picoflash/LICENSE`).
