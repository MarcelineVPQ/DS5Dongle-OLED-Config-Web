# Duplication audit: 2026-10-11 (before 0.9.0)

The AVIEW method ([AVNetworkMonitor `docs/DEDUPE_AUDIT.md`]): list every candidate mechanically, give each row one verdict, fix the merges. Nothing reviewed by eye.

## Method

`node tools/list_duplicates.mjs > dupes.tsv` lists three kinds of candidate across `src/`, `electron/`, `tools/` and `.hooks/`:

- **css-selector**: a selector defined in more than one rule (per `@media` context);
- **name**: a top-level function or arrow const defined in more than one file;
- **block**: the same 4 normalized code lines in more than one place.

Verdicts: **MERGED** (fixed in this pass) · **KEEP** (intended: one shared rule plus an element's own) · **NOT-WORTH** (an idiom, or separate standalone scripts) · **DEFERRED** (a real copy with a review finding and the batch that merges it) · **OPEN** (a real copy found by the gate, not yet scheduled: it goes to the next quality pass).

**It's a gate** (since the dev.6 quality pass, F48): `node tools/list_duplicates.mjs --check` runs in `npm run gates` and CI. It matches each row by kind, what and the set of files (line numbers and counts are ignored) against the table below, and fails on a candidate with no row, or a row the lister no longer finds. Byte-identical files (including across the app and firmware repos) are a separate gate: `tools/check_identical_files.mjs`.

## Headline

The first run found 57 CSS selectors, 12 names and 17 blocks. **27 merged** in this pass; the rest are intended or idioms. Re-running the lister now gives 39 / 6 / 10 rows, all KEEP or NOT-WORTH below.

## Merged in this pass

| What | Was | Now |
| --- | --- | --- |
| Theme tokens | Split between `styles.css` (palette) and `desktop.css` (status colors, depth/shadow tokens, each in its own `:root` / dark / system-dark block) | All in `styles.css`'s palette blocks: one place for every theme token (the one-theme-system rule) |
| Global `input[type="number"]` | A web-tool rule (38 px, weight 750) that `.dk` then overrode back | Removed with its overrides and the dead "shared web components" section |
| `.dk-btn:disabled` | Two rules | One |
| `.live-ctl` | Its press-ink token in a second rule | In the drawing's own rule |
| `.live-ctl svg` | The depth shadow in the depth section | In the drawing's own rule |
| `.dk.dk-one`, `.live-view`, `.live-stage`, `.live-data-card` | A second rule each, far away (isolation, position, container) | Folded into their own rules |
| `.live-strip` | Three rules (flex, then nowrap, then grid overriding the flex) | One grid rule; dead flex properties dropped |
| `.live-strip > .live-tile` | Two rules (flex sizing that no longer applied, padding) | One |
| `.live-data-rows dt` | Two rules | One |
| `.lib-row img` | Its object-position 500 lines away | In the shared image/glyph rule |
| `.art-bd-blobs` | Opacity 0.55 in a group, then 0.35 in its own rule (the later one silently won) | Only its own 0.35 |
| `.dcon`, `.dash` | A shared `flex: none` rule appended at the end | In each own rule |
| `.theme-toggle button.active` | Its animation in a separate "micro-interactions" section | In its own rule |
| `hexToRgb` | `controls.tsx` and `theme/desktopPalette.ts` | `desktopPalette.ts`; `controls.tsx` re-exports it |
| `artUrl` | `GamePage.tsx` and `ArtBackdrop.tsx` (one hard-coded to `hero`) | `games/types.ts`, typed by `ArtKind` |
| `toUint8Array` | `config.ts` and `remap.ts` | `protocol/bytes.ts` |
| `obj` / `arr` / `readJson` | `details.ts` and `heroic.ts` | `games/files.ts` |
| `/proc` reader | `processes.ts` and `running.ts` | `running.ts`'s `readProcs` |
| Steam manifest listing | `steam.ts` and `details.ts` | `steamAppManifests()` in `steam.ts` |
| `message()` wrappers | `service.ts` and `updater.ts` around `errorText` | `errorText` directly |
| Backup summary type | `GameBackup` (api.ts) and `BackupSummary` (backup.ts) field for field | `BackupSummary extends GameBackup` |
| Update notices | 9 hand-built notice blocks | One `Notice` / `Action` component |
| Remap action row | Save to profile / Apply remap, Revert, Reset all written twice in `PartPanel.tsx` (DEFERRED to batch 1) | One `RemapActions` (dev.6 quality pass batch 1, with F3) |

(Earlier the same day the release review merged the color helpers: `parseColor`, `hexToRgb`, `wantsLightInk`, `colorways.contrast` delegating.)

## Every row now

| Kind | What | Count | Verdict | Why | Where |
| --- | --- | --- | --- | --- | --- |
| css-selector | `.dk-card` | 2 | **KEEP** | the depth/motion pass: one shared rule for shadows, lift and transitions, plus the element's own rule | `src/desktop/desktop.css:213` `src/desktop/desktop.css:3343` |
| css-selector | `.dk input[type="number"]` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:320` `src/desktop/desktop.css:330` |
| css-selector | `.dk select` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:320` `src/desktop/desktop.css:334` |
| css-selector | `.cp-hue-thumb` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:400` `src/desktop/desktop.css:411` |
| css-selector | `.dk-btn` | 2 | **KEEP** | the depth/motion pass: one shared rule for shadows, lift and transitions, plus the element's own rule | `src/desktop/desktop.css:528` `src/desktop/desktop.css:3350` |
| css-selector | `.dk-table th` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:580` `src/desktop/desktop.css:588` |
| css-selector | `.dk-md ul` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:811` `src/desktop/desktop.css:816` |
| css-selector | `.dk-md ol` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:811` `src/desktop/desktop.css:816` |
| css-selector | `.live-ctl .sel .ol` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:1243` `src/desktop/desktop.css:1248` |
| css-selector | `.live-shortcut` | 2 | **KEEP** | the depth/motion pass: one shared rule for shadows, lift and transitions, plus the element's own rule | `src/desktop/desktop.css:1524` `src/desktop/desktop.css:3350` |
| css-selector | `.live-shortcut:hover` | 2 | **KEEP** | the depth/motion pass: one shared rule for shadows, lift and transitions, plus the element's own rule | `src/desktop/desktop.css:1540` `src/desktop/desktop.css:3361` |
| css-selector | `.live-tile` | 2 | **KEEP** | the depth/motion pass: one shared rule for shadows, lift and transitions, plus the element's own rule | `src/desktop/desktop.css:1685` `src/desktop/desktop.css:3343` |
| css-selector | `.live-battery .shell-tip` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:1750` `src/desktop/desktop.css:1756` |
| css-selector | `.live-data-card` | 2 | **KEEP** | the depth/motion pass: one shared rule for shadows, lift and transitions, plus the element's own rule | `src/desktop/desktop.css:1818` `src/desktop/desktop.css:3343` |
| css-selector | `.live-data-rows dd` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:1856` `src/desktop/desktop.css:1984` |
| css-selector | `.live-data-xyz` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:1856` `src/desktop/desktop.css:1864` |
| css-selector | `.live-tile-button` | 2 | **KEEP** | the depth/motion pass: one shared rule for shadows, lift and transitions, plus the element's own rule | `src/desktop/desktop.css:1960` `src/desktop/desktop.css:3350` |
| css-selector | `.live-tile-button:hover` | 3 | **KEEP** | the depth/motion pass: one shared rule for shadows, lift and transitions, plus the element's own rule | `src/desktop/desktop.css:1965` `src/desktop/desktop.css:3361` `src/desktop/desktop.css:3373` |
| css-selector | `.lib-home` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:2086` `src/desktop/desktop.css:2102` |
| css-selector | `.lib-row` | 2 | **KEEP** | the depth/motion pass: one shared rule for shadows, lift and transitions, plus the element's own rule | `src/desktop/desktop.css:2086` `src/desktop/desktop.css:3350` |
| css-selector | `.lib-row:hover` | 2 | **KEEP** | the depth/motion pass: one shared rule for shadows, lift and transitions, plus the element's own rule | `src/desktop/desktop.css:2105` `src/desktop/desktop.css:3370` |
| css-selector | `.lib-glyph` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:2151` `src/desktop/desktop.css:2160` |
| css-selector | `.gp-hero` | 2 | **KEEP** | the depth/motion pass: one shared rule for shadows, lift and transitions, plus the element's own rule | `src/desktop/desktop.css:2211` `src/desktop/desktop.css:3343` |
| css-selector | `.gp-tags` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:2317` `src/desktop/desktop.css:2325` |
| css-selector | `.rail-status` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:2574` `src/desktop/desktop.css:2591` |
| css-selector | `.lib-tile` | 3 | **KEEP** | the depth/motion pass: one shared rule for shadows, lift and transitions, plus the element's own rule | `src/desktop/desktop.css:2729` `src/desktop/desktop.css:3343` `src/desktop/desktop.css:3350` |
| css-selector | `.lib-tile:hover` | 3 | **KEEP** | the depth/motion pass: one shared rule for shadows, lift and transitions, plus the element's own rule | `src/desktop/desktop.css:2743` `src/desktop/desktop.css:3361` `src/desktop/desktop.css:3373` |
| css-selector | `.lib-tile-store` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:2782` `src/desktop/desktop.css:2796` |
| css-selector | `html[data-glass] .app-rail` | 2 | **KEEP** | Liquid Glass: one shared rule for both docked bars, plus each bar's edge-specific values | `src/desktop/desktop.css:3018` `src/desktop/desktop.css:3099` |
| css-selector | `html[data-glass] .dk-bar` | 2 | **KEEP** | Liquid Glass: one shared rule for both docked bars, plus each bar's edge-specific values | `src/desktop/desktop.css:3029` `src/desktop/desktop.css:3099` |
| css-selector | `html[data-glass] .app-rail::before` | 2 | **KEEP** | Liquid Glass: one shared rule for both docked bars, plus each bar's edge-specific values | `src/desktop/desktop.css:3037` `src/desktop/desktop.css:3055` |
| css-selector | `html[data-glass] .dk-bar::before` | 2 | **KEEP** | Liquid Glass: one shared rule for both docked bars, plus each bar's edge-specific values | `src/desktop/desktop.css:3037` `src/desktop/desktop.css:3058` |
| css-selector | `.stest-x` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:3627` `src/desktop/desktop.css:3633` |
| css-selector | `.stest-y` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:3627` `src/desktop/desktop.css:3636` |
| css-selector | `.dash-gauge .track` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:3738` `src/desktop/desktop.css:3744` |
| css-selector | `.dash-gauge .fill` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:3738` `src/desktop/desktop.css:3747` |
| css-selector | `body` | 2 | **KEEP** | one shared theme-swap transition rule, plus the element's own rule | `src/styles.css:225` `src/styles.css:270` |
| css-selector | `button` | 2 | **KEEP** | shared base for headings/controls, then each element's own size (adjacent) | `src/styles.css:233` `src/styles.css:237` |
| css-selector | `h1` | 2 | **KEEP** | shared base for headings/controls, then each element's own size (adjacent) | `src/styles.css:244` `src/styles.css:253` |
| css-selector | `h2` | 2 | **KEEP** | shared base for headings/controls, then each element's own size (adjacent) | `src/styles.css:244` `src/styles.css:259` |
| css-selector | `h3` | 2 | **KEEP** | shared base for headings/controls, then each element's own size (adjacent) | `src/styles.css:244` `src/styles.css:263` |
| css-selector | `.theme-toggle` | 2 | **KEEP** | one shared theme-swap transition rule, plus the element's own rule | `src/styles.css:270` `src/styles.css:423` |
| css-selector | `.theme-toggle button` | 2 | **KEEP** | one shared theme-swap transition rule, plus the element's own rule | `src/styles.css:270` `src/styles.css:433` |
| name | `subscribe` | 3 | **KEEP** | different things: the theme's media-query listener, the narrator's event bus, the window-shown store | `src/components/ThemeToggle.tsx:74` `src/desktop/narrator.ts:60` `src/desktop/useWindowShown.ts:54` |
| name | `clamp` | 2 | **DEFERRED** | F20/F23 (quality pass dev.6, batch 3 "One color system", done with the end-of-cycle color picker work): one codec and clamp in desktopPalette | `src/desktop/colorPicker/colorMath.ts:9` `src/protocol/calibration.ts:42` |
| name | `rgbToHex` | 2 | **DEFERRED** | F20/F23 (quality pass dev.6, batch 3 "One color system", done with the end-of-cycle color picker work): one codec and clamp in desktopPalette | `src/desktop/colorPicker/colorMath.ts:12` `src/desktop/controls.tsx:159` |
| name | `contrast` | 3 | **KEEP** | colorways.ts is a #hex adapter that delegates to desktopPalette (done in this pass); tools/ad is a standalone render script, not the app | `src/desktop/live/colorways.ts:82` `src/desktop/theme/desktopPalette.ts:87` `tools/ad/render_ad.mjs:78` |
| name | `notify` | 2 | **KEEP** | different stores (the narrator's event bus, the window-shown store) | `src/desktop/narrator.ts:41` `src/desktop/useWindowShown.ts:28` |
| name | `mix` | 2 | **NOT-WORTH** | tools/ad is a standalone render script; importing app code into it would tie the two | `src/desktop/theme/desktopPalette.ts:92` `tools/ad/render_ad.mjs:70` |
| name | `sleep` | 2 | **NOT-WORTH** | a one-line timer in the renderer and in the main process (separate bundles) | `src/protocol/bridgeClient.ts:646` `electron/main/games/processes.ts:41` |
| name | `hex` | 2 | **NOT-WORTH** | tools/ad is a standalone render script; importing app code into it would tie the two | `src/protocol/controllerInfo.ts:101` `tools/ad/render_ad.mjs:69` |
| name | `readJson` | 2 | **NOT-WORTH** | tools/update_version.mjs is a standalone build script | `electron/main/games/files.ts:15` `tools/update_version.mjs:17` |
| name | `send` | 2 | **NOT-WORTH** | two standalone tools scripts driving Chrome DevTools (the ad renderer, the screenshot env); a shared module would tie the ad tooling to the app tools | `tools/ad/render_ad.mjs:140` `tools/screenshot_env.mjs:33` |
| name | `walk` | 2 | **NOT-WORTH** | two standalone scripts (this lister, the theme gate); a shared module for a 6-line walker is more machinery than it saves | `tools/list_duplicates.mjs:20` `.hooks/check_theme_colors.mjs:34` |
| block | `.catch(() => undefined);` | 2 | **OPEN** | new (batch 7 gate run, not in the dev.6 review): the same find-device poll loop; a candidate for usePoll (check it may run while hidden) in the next quality pass | `src/desktop/SetupScreen.tsx:42` `src/desktop/WindowsUsbRepair.tsx:31` |
| block | `tick();` | 2 | **OPEN** | new (batch 7 gate run, not in the dev.6 review): the same find-device poll loop; a candidate for usePoll (check it may run while hidden) in the next quality pass | `src/desktop/SetupScreen.tsx:43` `src/desktop/WindowsUsbRepair.tsx:32` |
| block | `const timer = setInterval(tick, POLL_MS);` | 2 | **OPEN** | new (batch 7 gate run, not in the dev.6 review): the same find-device poll loop; a candidate for usePoll (check it may run while hidden) in the next quality pass | `src/desktop/SetupScreen.tsx:44` `src/desktop/WindowsUsbRepair.tsx:33` |
| block | `(blank line)` | 2 | **NOT-WORTH** | an idiom (hook prelude, try/catch/finally around one action, cleanup return), not copied logic | `src/desktop/library/GamePage.tsx:28` `src/desktop/library/GameTile.tsx:11` |
| block | `const currentSlot = bridge.identity?.currentSlot;` | 2 | **OPEN** | new (batch 7 gate run, not in the dev.6 review): the per-slot read effect and its error/Retry line are near-copies; a shared hook is a candidate for the next quality pass | `src/desktop/live/Calibration.tsx:46` `src/desktop/live/StickCurves.tsx:59` |
| block | `useEffect(() => {` | 2 | **OPEN** | new (batch 7 gate run, not in the dev.6 review): the per-slot read effect and its error/Retry line are near-copies; a shared hook is a candidate for the next quality pass | `src/desktop/live/Calibration.tsx:47` `src/desktop/live/StickCurves.tsx:60` |
| block | `setError(null);` | 2 | **OPEN** | new (batch 7 gate run, not in the dev.6 review): the per-slot read effect and its error/Retry line are near-copies; a shared hook is a candidate for the next quality pass | `src/desktop/live/Calibration.tsx:57` `src/desktop/live/StickCurves.tsx:71` |
| block | `})` | 2 | **OPEN** | new (batch 7 gate run, not in the dev.6 review): the per-slot read effect and its error/Retry line are near-copies; a shared hook is a candidate for the next quality pass | `src/desktop/live/Calibration.tsx:58` `src/desktop/live/StickCurves.tsx:72` |
| block | `return () => {` | 2 | **NOT-WORTH** | an idiom (hook prelude, try/catch/finally around one action, cleanup return), not copied logic | `src/desktop/live/Calibration.tsx:121` `src/desktop/live/StickTestCards.tsx:78` |
| block | `if (!client) return null;` | 2 | **OPEN** | new (batch 7 gate run, not in the dev.6 review): the per-slot read effect and its error/Retry line are near-copies; a shared hook is a candidate for the next quality pass | `src/desktop/live/Calibration.tsx:127` `src/desktop/live/StickCurves.tsx:79` |
| block | `<p className="dk-bad">` | 2 | **OPEN** | new (batch 7 gate run, not in the dev.6 review): the per-slot read effect and its error/Retry line are near-copies; a shared hook is a candidate for the next quality pass | `src/desktop/live/Calibration.tsx:246` `src/desktop/live/StickCurves.tsx:174` |
| block | `{saved === null && (` | 2 | **OPEN** | new (batch 7 gate run, not in the dev.6 review): the per-slot read effect and its error/Retry line are near-copies; a shared hook is a candidate for the next quality pass | `src/desktop/live/Calibration.tsx:248` `src/desktop/live/StickCurves.tsx:176` |
| block | `const raw = input ? (side === 0 ? input.leftStick : input.rightStick) : null;` | 2 | **OPEN** | new (batch 7 gate run, not in the dev.6 review): the stick read-out math (raw, calibrated, curved, tilt) is computed twice in one file; one helper is a candidate for the next quality pass | `src/desktop/live/StickCurves.tsx:124` `src/desktop/live/StickCurves.tsx:345` |
| block | `(cause: unknown) => live && setError(errorText(cause)),` | 2 | **NOT-WORTH** | an idiom (hook prelude, try/catch/finally around one action, cleanup return), not copied logic | `src/desktop/live/useRemap.ts:65` `src/desktop/pages/GamesPage.tsx:166` |
| block | `return (` | 2 | **NOT-WORTH** | an idiom (hook prelude, try/catch/finally around one action, cleanup return), not copied logic | `src/desktop/pages/GamesPage.tsx:100` `src/desktop/pages/GamesPage.tsx:287` |
| block | `await rescan();` | 2 | **NOT-WORTH** | an idiom (hook prelude, try/catch/finally around one action, cleanup return), not copied logic | `src/desktop/pages/GamesPage.tsx:227` `src/desktop/pages/GamesPage.tsx:250` |
| block | `} catch (cause) {` | 2 | **NOT-WORTH** | an idiom (hook prelude, try/catch/finally around one action, cleanup return), not copied logic | `src/desktop/pages/GamesPage.tsx:228` `src/desktop/pages/GamesPage.tsx:251` |
| block | `const { t } = useTranslation();` | 2 | **NOT-WORTH** | an idiom (hook prelude, try/catch/finally around one action, cleanup return), not copied logic | `src/desktop/pages/SettingsPage.tsx:21` `src/desktop/pages/SettingsPage.tsx:86` |
| block | `const { t } = useTranslation();` | 4 | **NOT-WORTH** | an idiom (hook prelude, try/catch/finally around one action, cleanup return), not copied logic | `src/desktop/pages/SettingsPage.tsx:110` `src/desktop/pages/SettingsPage.tsx:121` `src/desktop/pages/SettingsPage.tsx:134` `src/desktop/pages/SettingsPage.tsx:171` |
| block | `const active = !!client && enabled && visible;` | 2 | **NOT-WORTH** | an idiom (hook prelude, try/catch/finally around one action, cleanup return), not copied logic | `src/desktop/useLiveInput.ts:27` `src/desktop/useLiveInput.ts:80` |
| block | `(blank line)` | 2 | **NOT-WORTH** | an idiom (hook prelude, try/catch/finally around one action, cleanup return), not copied logic | `src/desktop/useLiveInput.ts:28` `src/desktop/useLiveInput.ts:81` |
| block | `void poll();` | 2 | **NOT-WORTH** | an idiom (hook prelude, try/catch/finally around one action, cleanup return), not copied logic | `src/desktop/useLiveInput.ts:62` `src/desktop/useLiveInput.ts:100` |
| block | `return () => {` | 2 | **NOT-WORTH** | an idiom (hook prelude, try/catch/finally around one action, cleanup return), not copied logic | `src/desktop/usePoll.ts:38` `src/hooks/useDs5Bridge.ts:281` |
| block | `const ws = new WebSocket(pages.find((p) => p.type === "page").webSocketDebuggerU` | 2 | **NOT-WORTH** | two standalone tools scripts driving Chrome DevTools (the ad renderer, the screenshot env); a shared module would tie the ad tooling to the app tools | `tools/ad/render_ad.mjs:137` `tools/screenshot_env.mjs:30` |
| block | `let id = 0;` | 2 | **NOT-WORTH** | two standalone tools scripts driving Chrome DevTools (the ad renderer, the screenshot env); a shared module would tie the ad tooling to the app tools | `tools/ad/render_ad.mjs:139` `tools/screenshot_env.mjs:32` |
| block | `const send = (method, params) =>` | 2 | **NOT-WORTH** | two standalone tools scripts driving Chrome DevTools (the ad renderer, the screenshot env); a shared module would tie the ad tooling to the app tools | `tools/ad/render_ad.mjs:140` `tools/screenshot_env.mjs:33` |
| block | `const h = (ev) => {` | 2 | **NOT-WORTH** | two standalone tools scripts driving Chrome DevTools (the ad renderer, the screenshot env); a shared module would tie the ad tooling to the app tools | `tools/ad/render_ad.mjs:143` `tools/screenshot_env.mjs:36` |
| block | `const m = JSON.parse(ev.data);` | 2 | **NOT-WORTH** | two standalone tools scripts driving Chrome DevTools (the ad renderer, the screenshot env); a shared module would tie the ad tooling to the app tools | `tools/ad/render_ad.mjs:144` `tools/screenshot_env.mjs:37` |
| block | `ws.addEventListener("message", h);` | 2 | **NOT-WORTH** | two standalone tools scripts driving Chrome DevTools (the ad renderer, the screenshot env); a shared module would tie the ad tooling to the app tools | `tools/ad/render_ad.mjs:150` `tools/screenshot_env.mjs:43` |
| block | `const files = [];` | 2 | **NOT-WORTH** | an idiom (hook prelude, try/catch/finally around one action, cleanup return), not copied logic | `tools/list_duplicates.mjs:19` `.hooks/check_theme_colors.mjs:33` |

## Keeping it this way

`npm run gates` fails on any row that isn't in the table above: give it a verdict (and merge it, if it's a drifted copy). When a merge removes a row, take it out of the table in the same commit. The table was regenerated in the dev.6 quality pass (batch 7) with 89 rows: earlier verdicts kept, 36 new rows given one (7 DEFERRED: F20/F23 and batch 1's remap buttons; 11 OPEN for the next pass).
