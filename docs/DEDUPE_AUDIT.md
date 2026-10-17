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
| External store (notices, dev.12) | The toast queue (`toast.ts`) and the shown-error notice (`shownError.ts`) each kept a listener set, `subscribe` and `useSyncExternalStore`; the dismissed notices needed a third | One helper, `src/desktop/externalStore.ts`, used by all three |
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
| css-selector | `.rail-status` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:2574` `src/desktop/desktop.css:2591` |
| css-selector | `.lib-tile` | 3 | **KEEP** | the depth/motion pass: one shared rule for shadows, lift and transitions, plus the element's own rule | `src/desktop/desktop.css:2729` `src/desktop/desktop.css:3343` `src/desktop/desktop.css:3350` |
| css-selector | `.lib-tile:hover` | 3 | **KEEP** | the depth/motion pass: one shared rule for shadows, lift and transitions, plus the element's own rule | `src/desktop/desktop.css:2743` `src/desktop/desktop.css:3361` `src/desktop/desktop.css:3373` |
| css-selector | `.lib-tile-store` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:2782` `src/desktop/desktop.css:2796` |
| css-selector | `html[data-glass] .app-rail` | 2 | **KEEP** | Liquid Glass: one shared rule for both docked bars, plus each bar's edge-specific values | `src/desktop/desktop.css:3018` `src/desktop/desktop.css:3099` |
| css-selector | `html[data-glass] .dk-bar` | 2 | **KEEP** | Liquid Glass: one shared rule for both docked bars, plus each bar's edge-specific values | `src/desktop/desktop.css:3029` `src/desktop/desktop.css:3099` |
| css-selector | `html[data-glass] .app-rail::before` | 2 | **KEEP** | Liquid Glass: one shared rule for both docked bars, plus each bar's edge-specific values | `src/desktop/desktop.css:3037` `src/desktop/desktop.css:3055` |
| css-selector | `html[data-glass] .dk-bar::before` | 2 | **KEEP** | Liquid Glass: one shared rule for both docked bars, plus each bar's edge-specific values | `src/desktop/desktop.css:3037` `src/desktop/desktop.css:3058` |
| css-selector | `.lib-glass .lib-continue-bar::before` | 2 | **KEEP** | Liquid Glass: the Continue playing bars share the docked bars' specular rim rule, plus the save bar's top-edge padding rule | `src/desktop/desktop.css` |
| css-selector | `.lib-glass .lib-continue-bar` | 2 | **KEEP** | Glass captions: one shared rule for the Continue playing bars and the grid captions (position, edge, ink tokens), plus each one's own surface (live glass vs static tint) | `src/desktop/desktop.css` |
| css-selector | `.lib-glass > .lib-tile-title` | 2 | **KEEP** | Glass captions: one shared rule for the Continue playing bars and the grid captions, plus the grid caption's own static tint | `src/desktop/desktop.css` |
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
| name | `subscribe` | 3 | **NOT-WORTH** | the theme's media-query listener, the narrator's event bus and the window-shown store are different things (each wraps its own source). (notices, dev.12) The toast queue, the shown-error notice and the dismissed notices, which were the same small external store, now share `src/desktop/externalStore.ts` | `src/components/ThemeToggle.tsx:76` `src/desktop/narrator.ts:66` `src/desktop/useWindowShown.ts:58` |
| name | `clamp` | 2 | **DEFERRED** | F20/F23 (quality pass dev.6, batch 3 "One color system", done with the end-of-cycle color picker work): one codec and clamp in desktopPalette | `src/desktop/colorPicker/colorMath.ts:9` `src/protocol/calibration.ts:42` |
| name | `rgbToHex` | 2 | **DEFERRED** | F20/F23 (quality pass dev.6, batch 3 "One color system", done with the end-of-cycle color picker work): one codec and clamp in desktopPalette | `src/desktop/colorPicker/colorMath.ts:12` `src/desktop/controls.tsx:159` |
| name | `byte` | 2 | **DEFERRED** | F23 (quality pass dev.6): the app's one RGB <-> HSV conversion now lives in desktopPalette (the swirl's hue turns use it, batch 2); colorMath re-exports it with the F20 codec merge (batch 3, which owns colorPicker/) | `src/desktop/colorPicker/colorMath.ts:10` `src/desktop/theme/desktopPalette.ts:110` |
| name | `rgbToHsv` | 2 | **DEFERRED** | F23 (quality pass dev.6): the app's one RGB <-> HSV conversion now lives in desktopPalette (the swirl's hue turns use it, batch 2); colorMath re-exports it with the F20 codec merge (batch 3, which owns colorPicker/) | `src/desktop/colorPicker/colorMath.ts:34` `src/desktop/theme/desktopPalette.ts:112` |
| name | `hsvToRgb` | 2 | **DEFERRED** | F23 (quality pass dev.6): the app's one RGB <-> HSV conversion now lives in desktopPalette (the swirl's hue turns use it, batch 2); colorMath re-exports it with the F20 codec merge (batch 3, which owns colorPicker/) | `src/desktop/colorPicker/colorMath.ts:49` `src/desktop/theme/desktopPalette.ts:127` |
| block |  | 2 | **DEFERRED** | F23 (quality pass dev.6): the app's one RGB <-> HSV conversion now lives in desktopPalette (the swirl's hue turns use it, batch 2); colorMath re-exports it with the F20 codec merge (batch 3, which owns colorPicker/) | `src/desktop/colorPicker/colorMath.ts:33` `src/desktop/theme/desktopPalette.ts:111` |
| block | `const [rn, gn, bn] = [byte(r) / 255, byte(g) / 255, byte(b) / 255];` | 2 | **DEFERRED** | F23 (quality pass dev.6): the app's one RGB <-> HSV conversion now lives in desktopPalette (the swirl's hue turns use it, batch 2); colorMath re-exports it with the F20 codec merge (batch 3, which owns colorPicker/) | `src/desktop/colorPicker/colorMath.ts:38` `src/desktop/theme/desktopPalette.ts:116` |
| block | `if (max === rn) h = ((gn - bn) / d) % 6;` | 2 | **DEFERRED** | F23 (quality pass dev.6): the app's one RGB <-> HSV conversion now lives in desktopPalette (the swirl's hue turns use it, batch 2); colorMath re-exports it with the F20 codec merge (batch 3, which owns colorPicker/) | `src/desktop/colorPicker/colorMath.ts:44` `src/desktop/theme/desktopPalette.ts:122` |
| block | `if (d > 0) {` | 2 | **DEFERRED** | F23 (quality pass dev.6): the app's one RGB <-> HSV conversion now lives in desktopPalette (the swirl's hue turns use it, batch 2); colorMath re-exports it with the F20 codec merge (batch 3, which owns colorPicker/) | `src/desktop/colorPicker/colorMath.ts:40` `src/desktop/theme/desktopPalette.ts:118` |
| block | `else h = (rn - gn) / d + 4;` | 2 | **DEFERRED** | F23 (quality pass dev.6): the app's one RGB <-> HSV conversion now lives in desktopPalette (the swirl's hue turns use it, batch 2); colorMath re-exports it with the F20 codec merge (batch 3, which owns colorPicker/) | `src/desktop/colorPicker/colorMath.ts:46` `src/desktop/theme/desktopPalette.ts:124` |
| name | `contrast` | 4 | **KEEP** | colorways.ts is a #hex adapter that delegates to desktopPalette (done in this pass); tools/ad and tools/check_layout.mjs (the UI checker's WCAG contrast) are standalone scripts, not the app | `src/desktop/live/colorways.ts:82` `src/desktop/theme/desktopPalette.ts:87` `tools/ad/render_ad.mjs:78` `tools/check_layout.mjs:335` |
| name | `notify` | 2 | **KEEP** | different stores (the narrator's event bus, the window-shown store) | `src/desktop/narrator.ts:41` `src/desktop/useWindowShown.ts:28` |
| name | `mix` | 2 | **NOT-WORTH** | tools/ad is a standalone render script; importing app code into it would tie the two | `src/desktop/theme/desktopPalette.ts:92` `tools/ad/render_ad.mjs:70` |
| name | `hex` | 2 | **NOT-WORTH** | tools/ad is a standalone render script; importing app code into it would tie the two | `src/protocol/controllerInfo.ts:101` `tools/ad/render_ad.mjs:69` |
| name | `readJson` | 2 | **NOT-WORTH** | tools/update_version.mjs is a standalone build script | `electron/main/games/files.ts:15` `tools/update_version.mjs:17` |
| name | `send` | 3 | **NOT-WORTH** | three standalone tools scripts driving Chrome DevTools (the ad renderer, the screenshot env, the UI checker); a shared module would tie the ad tooling to the app tools | `tools/ad/render_ad.mjs:140` `tools/screenshot_env.mjs:33` `tools/check_layout.mjs:68` |
| name | `opt` | 2 | **NOT-WORTH** | a one-line `--name value` argument reader in two standalone tools scripts (the ad renderer, the UI checker); a shared module for one line would tie them | `tools/ad/render_ad.mjs:27` `tools/check_layout.mjs:46` |
| name | `report` | 2 | **KEEP** | same name, different functions: the UI checker prints its findings for one view, ts_program prints a gate's verdict table | `tools/check_layout.mjs:410` `tools/ts_program.mjs:252` |
| name | `walk` | 3 | **NOT-WORTH** | three standalone scripts (this lister, the theme gate, the settings gate); a shared module for a 6-line walker is more machinery than it saves | `tools/list_duplicates.mjs:20` `tools/list_settings.mjs:109` `.hooks/check_theme_colors.mjs:34` |
| name | `lineOf` | 2 | **NOT-WORTH** | the settings gate parses each file on its own (no type checker); importing `ts_program.mjs` for its one-line helper would build the whole typed program first | `tools/list_settings.mjs:79` `tools/ts_program.mjs:283` |
| block | `return () => {` | 2 | **NOT-WORTH** | an idiom (hook prelude, try/catch/finally around one action, cleanup return), not copied logic | `src/desktop/live/Calibration.tsx:121` `src/desktop/live/StickTestCards.tsx:78` |
| block | `return () => {` | 2 | **NOT-WORTH** | an idiom (a self re-arming timer's cleanup: stop flag + clearTimeout), two effects of one hook with different timers (the 1 s board poll, the busy retry) | `src/hooks/useDs5Bridge.ts:269` `src/hooks/useDs5Bridge.ts:445` |
| block |  | 2 | **NOT-WORTH** | a component's props preamble (`interface Props { bridge: UseDs5BridgeResult; …`): the shared prop type is the bridge itself, already one type | `src/desktop/dongle/DonglePage.tsx:28` `src/desktop/live/ControllerView.tsx:64` |
| block | `useEffect(() => {` | 3 | **NOT-WORTH** | an idiom (hook prelude, try/catch/finally around one action, cleanup return), not copied logic | `src/desktop/AutoUpdateAsk.tsx:22` `src/desktop/live/HeadsetStereo.tsx:27` `src/desktop/library/GameLaunchersSetting.tsx:21` |
| block | `<button` | 3 | **NOT-WORTH** | an idiom (a `dk-btn` whose click does two things), not copied logic | `src/desktop/DesktopApp.tsx:382` `src/desktop/Toasts.tsx:32` `src/desktop/pages/AppSettingsPage.tsx:634` |
| block | `<div className="dk-row-btns">` | 2 | **NOT-WORTH** | the button row around one conditional reset button (Back to Linear, the Developer reset), not copied logic | `src/desktop/live/StickCurves.tsx:98` `src/desktop/pages/AppSettingsPage.tsx:633` |
| block | `next();` | 2 | **NOT-WORTH** | an idiom (hook prelude, try/catch/finally around one action, cleanup return), not copied logic | `src/desktop/useLiveInput.ts:64` `src/desktop/useLiveInput.ts:103` |
| block | `const ws = new WebSocket(pages.find((p) => p.type === "page").webSocketDebuggerU` | 2 | **NOT-WORTH** | two standalone tools scripts driving Chrome DevTools (the ad renderer, the screenshot env); a shared module would tie the ad tooling to the app tools | `tools/ad/render_ad.mjs:137` `tools/screenshot_env.mjs:30` |
| block | `let id = 0;` | 3 | **NOT-WORTH** | three standalone tools scripts driving Chrome DevTools (the ad renderer, the screenshot env, the UI checker); a shared module would tie the ad tooling to the app tools | `tools/ad/render_ad.mjs:139` `tools/screenshot_env.mjs:32` `tools/check_layout.mjs:67` |
| block | `const send = (method, params) =>` | 3 | **NOT-WORTH** | three standalone tools scripts driving Chrome DevTools (the ad renderer, the screenshot env, the UI checker); a shared module would tie the ad tooling to the app tools | `tools/ad/render_ad.mjs:140` `tools/screenshot_env.mjs:33` `tools/check_layout.mjs:68` |
| block | `const h = (ev) => {` | 3 | **NOT-WORTH** | three standalone tools scripts driving Chrome DevTools (the ad renderer, the screenshot env, the UI checker); a shared module would tie the ad tooling to the app tools | `tools/ad/render_ad.mjs:143` `tools/screenshot_env.mjs:36` `tools/check_layout.mjs:71` |
| block | `const m = JSON.parse(ev.data);` | 3 | **NOT-WORTH** | three standalone tools scripts driving Chrome DevTools (the ad renderer, the screenshot env, the UI checker); a shared module would tie the ad tooling to the app tools | `tools/ad/render_ad.mjs:144` `tools/screenshot_env.mjs:37` `tools/check_layout.mjs:72` |
| block | `ws.addEventListener("message", h);` | 3 | **NOT-WORTH** | three standalone tools scripts driving Chrome DevTools (the ad renderer, the screenshot env, the UI checker); a shared module would tie the ad tooling to the app tools | `tools/ad/render_ad.mjs:150` `tools/screenshot_env.mjs:43` `tools/check_layout.mjs:78` |
| block | `const files = [];` | 2 | **NOT-WORTH** | an idiom (hook prelude, try/catch/finally around one action, cleanup return), not copied logic | `tools/list_duplicates.mjs:19` `.hooks/check_theme_colors.mjs:33` |

## Keeping it this way

`npm run gates` fails on any row that isn't in the table above: give it a verdict (and merge it, if it's a drifted copy). When a merge removes a row, take it out of the table in the same commit. The table was regenerated in the dev.6 quality pass (batch 7) with 89 rows: earlier verdicts kept, 36 new rows given one (7 DEFERRED: F20/F23 and batch 1's remap buttons; 11 OPEN for the next pass). Batch 2 (F23) added 8 DEFERRED rows: the HSV conversion moved into desktopPalette while colorMath's copy waits for batch 3. Batch 6 merged 10 of the 11 OPEN rows: Calibration and StickCurves share one per-slot read and Retry line (`live/slotSettings.tsx`), StickCurves' stick read-out is one `stickTilt()`, and SetupScreen and WindowsUsbRepair poll with `usePoll` (now paused while the window is hidden, like every UI poll); the 11th (the cards' early returns) is NOT-WORTH.
