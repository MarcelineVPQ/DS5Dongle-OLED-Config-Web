# Duplication audit: 2026-10-11 (before 0.9.0)

The AVIEW method ([AVNetworkMonitor `docs/DEDUPE_AUDIT.md`]): list every candidate mechanically, give each row one verdict, fix the merges. Nothing reviewed by eye.

## Method

`node tools/list_duplicates.mjs > dupes.tsv` lists three kinds of candidate across `src/`, `electron/`, `tools/` and `.hooks/`:

- **css-selector**: a selector defined in more than one rule (per `@media` context);
- **name**: a top-level function or arrow const defined in more than one file;
- **block**: the same 4 normalized code lines in more than one place.

Verdicts: **MERGED** (fixed in this pass) · **KEEP** (intended: one shared rule plus an element's own) · **NOT-WORTH** (an idiom, or separate standalone scripts).

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

(Earlier the same day the release review merged the color helpers: `parseColor`, `hexToRgb`, `wantsLightInk`, `colorways.contrast` delegating.)

## Every row now

| Kind | What | Count | Verdict | Why | Where |
| --- | --- | --- | --- | --- | --- |
| css-selector | `.dk-card` | 2 | **KEEP** | the depth/motion pass: one shared rule for shadows, lift and transitions, plus the element's own rule | `src/desktop/desktop.css:200` `src/desktop/desktop.css:2898` |
| css-selector | `.dk input[type="number"]` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:307` `src/desktop/desktop.css:317` |
| css-selector | `.dk select` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:307` `src/desktop/desktop.css:321` |
| css-selector | `.dk-btn` | 2 | **KEEP** | the depth/motion pass: one shared rule for shadows, lift and transitions, plus the element's own rule | `src/desktop/desktop.css:397` `src/desktop/desktop.css:2905` |
| css-selector | `.dk-table th` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:449` `src/desktop/desktop.css:457` |
| css-selector | `.dk-md ul` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:610` `src/desktop/desktop.css:615` |
| css-selector | `.dk-md ol` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:610` `src/desktop/desktop.css:615` |
| css-selector | `.live-shortcut` | 2 | **KEEP** | the depth/motion pass: one shared rule for shadows, lift and transitions, plus the element's own rule | `src/desktop/desktop.css:1214` `src/desktop/desktop.css:2905` |
| css-selector | `.live-shortcut:hover` | 2 | **KEEP** | the depth/motion pass: one shared rule for shadows, lift and transitions, plus the element's own rule | `src/desktop/desktop.css:1230` `src/desktop/desktop.css:2916` |
| css-selector | `.live-tile` | 2 | **KEEP** | the depth/motion pass: one shared rule for shadows, lift and transitions, plus the element's own rule | `src/desktop/desktop.css:1375` `src/desktop/desktop.css:2898` |
| css-selector | `.live-battery .shell-tip` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:1440` `src/desktop/desktop.css:1446` |
| css-selector | `.live-data-card` | 2 | **KEEP** | the depth/motion pass: one shared rule for shadows, lift and transitions, plus the element's own rule | `src/desktop/desktop.css:1508` `src/desktop/desktop.css:2898` |
| css-selector | `.live-data-rows dd` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:1546` `src/desktop/desktop.css:1674` |
| css-selector | `.live-data-xyz` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:1546` `src/desktop/desktop.css:1554` |
| css-selector | `.live-tile-button` | 2 | **KEEP** | the depth/motion pass: one shared rule for shadows, lift and transitions, plus the element's own rule | `src/desktop/desktop.css:1650` `src/desktop/desktop.css:2905` |
| css-selector | `.live-tile-button:hover` | 3 | **KEEP** | the depth/motion pass: one shared rule for shadows, lift and transitions, plus the element's own rule | `src/desktop/desktop.css:1655` `src/desktop/desktop.css:2916` `src/desktop/desktop.css:2928` |
| css-selector | `.lib-home` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:1776` `src/desktop/desktop.css:1792` |
| css-selector | `.lib-row` | 2 | **KEEP** | the depth/motion pass: one shared rule for shadows, lift and transitions, plus the element's own rule | `src/desktop/desktop.css:1776` `src/desktop/desktop.css:2905` |
| css-selector | `.lib-row:hover` | 2 | **KEEP** | the depth/motion pass: one shared rule for shadows, lift and transitions, plus the element's own rule | `src/desktop/desktop.css:1795` `src/desktop/desktop.css:2925` |
| css-selector | `.lib-glyph` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:1841` `src/desktop/desktop.css:1850` |
| css-selector | `.gp-hero` | 2 | **KEEP** | the depth/motion pass: one shared rule for shadows, lift and transitions, plus the element's own rule | `src/desktop/desktop.css:1893` `src/desktop/desktop.css:2898` |
| css-selector | `.gp-tags` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:2004` `src/desktop/desktop.css:2012` |
| css-selector | `.rail-status` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:2237` `src/desktop/desktop.css:2254` |
| css-selector | `.lib-tile` | 3 | **KEEP** | the depth/motion pass: one shared rule for shadows, lift and transitions, plus the element's own rule | `src/desktop/desktop.css:2392` `src/desktop/desktop.css:2898` `src/desktop/desktop.css:2905` |
| css-selector | `.lib-tile:hover` | 3 | **KEEP** | the depth/motion pass: one shared rule for shadows, lift and transitions, plus the element's own rule | `src/desktop/desktop.css:2406` `src/desktop/desktop.css:2916` `src/desktop/desktop.css:2928` |
| css-selector | `.art-bd-blobs` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:2557` `src/desktop/desktop.css:2573` |
| css-selector | `html[data-glass] .app-rail` | 2 | **KEEP** | Liquid Glass: one shared rule for both docked bars, plus each bar's edge-specific values | `src/desktop/desktop.css:2619` `src/desktop/desktop.css:2700` |
| css-selector | `html[data-glass] .dk-bar` | 2 | **KEEP** | Liquid Glass: one shared rule for both docked bars, plus each bar's edge-specific values | `src/desktop/desktop.css:2630` `src/desktop/desktop.css:2700` |
| css-selector | `html[data-glass] .app-rail::before` | 2 | **KEEP** | Liquid Glass: one shared rule for both docked bars, plus each bar's edge-specific values | `src/desktop/desktop.css:2638` `src/desktop/desktop.css:2656` |
| css-selector | `html[data-glass] .dk-bar::before` | 2 | **KEEP** | Liquid Glass: one shared rule for both docked bars, plus each bar's edge-specific values | `src/desktop/desktop.css:2638` `src/desktop/desktop.css:2659` |
| css-selector | `.dash-gauge .track` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:3075` `src/desktop/desktop.css:3081` |
| css-selector | `.dash-gauge .fill` | 2 | **KEEP** | a shared base rule and the specific rule right next to it (no drift: one place each) | `src/desktop/desktop.css:3075` `src/desktop/desktop.css:3084` |
| css-selector | `body` | 2 | **KEEP** | one shared theme-swap transition rule, plus the element's own rule | `src/styles.css:222` `src/styles.css:267` |
| css-selector | `button` | 2 | **KEEP** | shared base for headings/controls, then each element's own size (adjacent) | `src/styles.css:230` `src/styles.css:234` |
| css-selector | `h1` | 2 | **KEEP** | shared base for headings/controls, then each element's own size (adjacent) | `src/styles.css:241` `src/styles.css:250` |
| css-selector | `h2` | 2 | **KEEP** | shared base for headings/controls, then each element's own size (adjacent) | `src/styles.css:241` `src/styles.css:256` |
| css-selector | `h3` | 2 | **KEEP** | shared base for headings/controls, then each element's own size (adjacent) | `src/styles.css:241` `src/styles.css:260` |
| css-selector | `.theme-toggle` | 2 | **KEEP** | one shared theme-swap transition rule, plus the element's own rule | `src/styles.css:267` `src/styles.css:420` |
| css-selector | `.theme-toggle button` | 2 | **KEEP** | one shared theme-swap transition rule, plus the element's own rule | `src/styles.css:267` `src/styles.css:430` |
| name | `subscribe` | 2 | **KEEP** | different things: the theme's media-query listener vs the narrator's event bus | `src/components/ThemeToggle.tsx:74` `src/desktop/narrator.ts:59` |
| name | `contrast` | 3 | **KEEP** | colorways.ts is a #hex adapter that delegates to desktopPalette (done in this pass); tools/ad is a standalone render script, not the app | `src/desktop/live/colorways.ts:69` `src/desktop/theme/desktopPalette.ts:87` `tools/ad/render_ad.mjs:78` |
| name | `mix` | 2 | **NOT-WORTH** | tools/ad is a standalone render script; importing app code into it would tie the two | `src/desktop/theme/desktopPalette.ts:92` `tools/ad/render_ad.mjs:70` |
| name | `sleep` | 2 | **NOT-WORTH** | a one-line timer in the renderer and in the main process (separate bundles) | `src/protocol/bridgeClient.ts:409` `electron/main/games/processes.ts:39` |
| name | `readJson` | 2 | **NOT-WORTH** | tools/update_version.mjs is a standalone build script | `electron/main/games/files.ts:15` `tools/update_version.mjs:17` |
| name | `walk` | 2 | **NOT-WORTH** | two standalone scripts (this lister, the theme gate); a shared module for a 6-line walker is more machinery than it saves | `tools/list_duplicates.mjs:15` `.hooks/check_theme_colors.mjs:21` |
| block | `(cause: unknown) => live && setError(errorText(cause)),` | 2 | **NOT-WORTH** | an idiom (hook prelude, try/catch/finally around one action, cleanup return), not copied logic | `src/desktop/live/useRemap.ts:44` `src/desktop/pages/GamesPage.tsx:162` |
| block | `return (` | 2 | **NOT-WORTH** | an idiom (hook prelude, try/catch/finally around one action, cleanup return), not copied logic | `src/desktop/pages/GamesPage.tsx:96` `src/desktop/pages/GamesPage.tsx:281` |
| block | `await rescan();` | 2 | **NOT-WORTH** | an idiom (hook prelude, try/catch/finally around one action, cleanup return), not copied logic | `src/desktop/pages/GamesPage.tsx:223` `src/desktop/pages/GamesPage.tsx:246` |
| block | `} catch (cause) {` | 2 | **NOT-WORTH** | an idiom (hook prelude, try/catch/finally around one action, cleanup return), not copied logic | `src/desktop/pages/GamesPage.tsx:224` `src/desktop/pages/GamesPage.tsx:247` |
| block | `const { t } = useTranslation();` | 2 | **NOT-WORTH** | an idiom (hook prelude, try/catch/finally around one action, cleanup return), not copied logic | `src/desktop/pages/SettingsPage.tsx:20` `src/desktop/pages/SettingsPage.tsx:66` |
| block | `const { t } = useTranslation();` | 4 | **NOT-WORTH** | an idiom (hook prelude, try/catch/finally around one action, cleanup return), not copied logic | `src/desktop/pages/SettingsPage.tsx:90` `src/desktop/pages/SettingsPage.tsx:101` `src/desktop/pages/SettingsPage.tsx:114` `src/desktop/pages/SettingsPage.tsx:151` |
| block | `const active = !!client && enabled && visible;` | 2 | **NOT-WORTH** | an idiom (hook prelude, try/catch/finally around one action, cleanup return), not copied logic | `src/desktop/useLiveInput.ts:40` `src/desktop/useLiveInput.ts:93` |
| block | `void poll();` | 2 | **NOT-WORTH** | an idiom (hook prelude, try/catch/finally around one action, cleanup return), not copied logic | `src/desktop/useLiveInput.ts:75` `src/desktop/useLiveInput.ts:113` |
| block | `return () => {` | 2 | **NOT-WORTH** | an idiom (hook prelude, try/catch/finally around one action, cleanup return), not copied logic | `src/desktop/usePoll.ts:31` `src/hooks/useDs5Bridge.ts:261` |
| block | `const files = [];` | 2 | **NOT-WORTH** | an idiom (hook prelude, try/catch/finally around one action, cleanup return), not copied logic | `tools/list_duplicates.mjs:14` `.hooks/check_theme_colors.mjs:20` |

## Keeping it this way

Re-run `node tools/list_duplicates.mjs` before a release: any row that isn't in the table above needs a verdict (and a merge, if it's a drifted copy).
