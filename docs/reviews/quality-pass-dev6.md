# Quality pass: v0.9.5-dev.4 to dev.6 (app + firmware)

**Summary**
- 48 confirmed findings after merging duplicates (54 raw; 6 were the same issue found under two dimensions). **0 high, 7 med, 41 low.** Nothing is fixed yet. This is for your approval.
- The most important risk is to the **never-flash guarantee**. If a game-profile apply fails partway through, or a slot switch races it, the game's settings can end up written to flash as your normal settings (F1, F3).
- The visible bugs are on the Live page. The HDR glow has never lit (wrong element). The swirl background recompiles its WebGL program on every Alt-Tab and on every pointer move while you drag a color.
- Most of the rest is one-framework drift. The new color picker brought a second hex codec, and Game page "All settings" is a second editor whose values have already drifted from the real one. On top of that, a handful of gates exist only as prose.

| Severity | Count |
|---|---|
| High | 0 |
| Med | 7 |
| Low | 41 |

Line numbers below are the corrected ones from verification.

---

## Bugs: app renderer

| # | Title | Sev | Where | Smallest fix |
|---|---|---|---|---|
| F1 | Profile apply fails after its config landed. The bar shows normal mode, and Save to dongle writes the game profile to flash | med | useGameProfile.ts:165-168; profileDongle.ts:74-75; DesktopApp.tsx:343 | In the catch, call restoreNormal if the config already landed (or setActive before putGameParts). Treat it as "profile on, parts missing". **Status: done (batch 1). A failed apply puts the normal values back, or keeps the profile mode when they can't go back (ProfileNotApplied), with a notice.** |
| F3 | Save to profile buttons (curves, Remap, All buttons, Save & close) do nothing while the target profile isn't active. They save into the wrong game's profile if another one is active | med | useGameProfile.ts:230-231; StickCurves.tsx:55,89-101; PartPanel.tsx:233-237; DesktopApp.tsx:296-301 | saveToProfile targets `editing ?? active`, or the buttons stay disabled with a reason until `active` matches. **Status: done (batch 1). Saves into `editing ?? active`; refused with a notice while that profile isn't the one on the dongle.** |
| F2 | switchSlot ignores an in-progress apply. The firmware's config_save then writes the profile to flash, and the "one switch at a time" guard is dropped | low | useGameProfile.ts:262-276; firmware bt.cpp:134-137 | Ref "profile config in RAM", set before applyConfig. switchSlot waits for or refuses during switching.current. **Status: done (batch 1). switchSlot queues behind the running switch and puts the normal values back first whenever a game's config may be in RAM.** |
| F4 | saveToProfile errors are never shown. The footer leaves an unhandled rejection, and a failed profile write leaves an orphan layout | low | useGameProfile.ts:230-253; DesktopApp.tsx:297-303,352 | Catch, expose an error state, write the layout after the profile. **Status: done (batch 1). saveToProfile never rejects (false + notice), and the layout is written after the profile.** |
| F5 | A profile step dropped during another switch is never retried after a parts-write failure | low | useGameProfile.ts:103-111,151-171,191-211 | Queue the latest wanted step, or bump a state counter in finally. **Status: done (batch 1). A step skipped during a switch bumps a retry counter, so it's decided again after it.** |
| F6 | Match-desktop theme checks accent and selection text only against the panel, not page, inset or button | low | desktopPalette.ts:158-159 | Pass `[page, panel, inset, button]` grounds to accentVars |
| F7 | Hue slider: End/max sets 360, which is announced as 0 while the thumb sits at the max | low | ColorPicker.tsx:126,239,265,295-300 | Clamp hue to 0..359 |

## Bugs: app main + tooling

| # | Title | Sev | Where | Smallest fix |
|---|---|---|---|---|
| F8 | Running-game watcher loses a native Heroic game once Heroic quits, so the profile is undone mid-game (regression from dev.4) | low | electron/main/games/running.ts:128-129 | Also keep processes whose environ has an ENV_KEYS entry. Add a fake-/proc test (HEROIC_APP_NAME, ppid 1) |
| F9 | SECURITY_AUDIT says the Sony firmware check is "never at startup", but it runs when the Controller info card first mounts | low | docs/SECURITY_AUDIT.md:30; ControllerInfo.tsx:85-99 | Reword the row (or delay the first auto lookup if "never at startup" is the intent) |
| F10 | check_ui.sh doesn't check for bwrap / xvfb-run / dbus-run-session. A missing tool means a 60 s wait, then an unrelated error | low | tools/check_ui.sh:39-59 | `command -v` precheck, and print the tail of app.log if the port never answers |
| F11 | check_layout header says "every language at smallest size". It covers only de/es/fr/pt-BR | low | tools/check_layout.mjs:11-13 | Fix the header text |

## Bugs: firmware

| # | Title | Sev | Where | Smallest fix |
|---|---|---|---|---|
| F12 | A late 0x81 reply holding the serial can stay in the feature cache after a controller test, and a host GET 0x81 is served from it (breaks "serial is not kept") | low | ctrl_info.cpp:147,170; main.cpp:353-355 | About 1 s scrub window after finish(), like ColorRead::Scrub. Also drop a duplicate page while RUNNING |
| F13 | A host SET 0x80/GET 0x81 during a dongle controller test clobbers it, and the test eats the host's reply | low | ctrl_info.cpp:158-165; main.cpp:475-480 | Answer BUSY to host SET 0x80 while RUNNING, and don't drop 0x81 replies that aren't ours |
| F14 | A 0x16 accepted in the same loop pass as a BT connect is reported as "no controller" | low | ctrl_info.cpp:119-121,136-145 | Require s_was_connected in ctrl_test_start |
| F15 | Per-stage timing reader can tear (new sum with old count). One report shows about half after a halving | low | perf.cpp:27-33; perf.h:88-95 | Per-stage seqlock, or read count before and after |
| F16 | Status-title scroll freezes up to ~36 min after the Status screen was away more than 35 min (32-bit wrap) | low | oled.cpp:357-376 | time_us_64 for next_us, or reset on screen enter |

## Lean (rendering cost)

| # | Title | Sev | Where | Smallest fix |
|---|---|---|---|---|
| F17 | HDR glow reads and watches the host div, but the vars live on the child svg. It has never lit and never redraws (dead output) | med | HdrGlow.tsx:88,175-176,193-194; LiveController.tsx:177-187 | Use `el.querySelector('svg')` for reads and the observer |
| F18 | SwirlField rebuilds the whole WebGL program on every focus change and every color change, about 60-120 times a second while a custom color is dragged | med | SwirlField.tsx:248-301; PartPanel.tsx:949 | Renderer once per `mode`, palette in a ref, restart only the interval on shown/focused/still |
| F19 | Identity poll replaces the object every second, so the app re-renders at 1 Hz, also while hidden | low | useDs5Bridge.ts:263-264 | setIdentity only when the decoded fields differ |

## One framework / no duplicates (app)

Findings flagged under both dedupe-app and one-framework are listed once.

| # | Title | Sev | Where | Smallest fix |
|---|---|---|---|---|
| F20 | Color picker adds a second hex/RGB codec and Rgb type next to the "one #rrggbb parser" (found 3 times) | med | colorPicker/colorMath.ts:5,12-26 vs controls.tsx:159-173, desktopPalette.ts:5,103 | One codec in desktopPalette.ts (lenient parseHex + rgbToHex). colorMath and controls import or re-export it |
| F21 | Game page "All settings" re-implements the Settings/Lightbar sections, and the values have already drifted (gain step, speaker min, no hints or validation) | med | library/GamePage.tsx:~325-395 vs SettingsPage.tsx, LightbarPage.tsx | Give the sections a value/onChange adapter and render them with the profile draft |
| F22 | useRecentColors re-implements useRawPref's subscription (rated low in the second pass) | med | ColorPicker.tsx:18-30 vs storage.ts:59-77 | `useRawPref(RECENT_KEY)` + useMemo parse, as customColors.ts does |
| F23 | Third hand-written HSV/hue conversion | low | colorMath.ts:34-58 vs SwirlField.tsx:44-58 | rotateHue built on colorMath (the colorway_contrast.mjs part was refuted) |
| F24 | "Which profile is on" (`editing ?? active`) is derived in 5 places, and useGameProfile uses the opposite order | low | PartPanel.tsx:235,573; Calibration.tsx:36; StickCurves.tsx:55; ControllerView.tsx:83-84 | Export one useProfileTarget() from libraryContext. **Status: done (batch 1). profileTarget()/useProfileTarget() in libraryContext; useGameProfile uses the same order.** |
| F25 | Same curve-pair type under two names, with two extractors | low | profileDongle.ts:30,38-40 vs profileValues.ts:126,128; GamePage.tsx:444 | Keep GameCurves/profileCurves; profileDongle imports them; rename the GamePage alias |
| F26 | Controller info Refresh is a plain button, not BusyButton | low | ControllerInfo.tsx:235 | BusyButton with a reload that returns the promise (keep `loading` for the hints) |
| F27 | Spark theme watcher misses accent/controller-theme changes. It is a third theme-watch copy and watches a dead `data-color-vision` attribute | low | LiveData.tsx:160-165 | One shared themeChanged() in controllerAccent.ts for LiveData, SwirlField and GamePage |
| F28 | SwirlField has its own reduce-motion detector | low | SwirlField.tsx:215-232 | useReducedMotion() in motion.ts (pref + matchMedia) |
| F29 | "One identity poll" comment is false. SlotsPage still polls identity | low | DesktopApp.tsx:118-121; SlotsPage.tsx:36-43 | SlotsPage reads bridge.identity and polls only readSlots. Note the lightbar fast read as the exception |
| F30 | Simulated dongle re-hardcodes layout constants the protocol exports, and protoMinor ?? 6 is repeated | low | simulatedDongle.ts:61,84,309,354,482,490 | Import the constants and helpers; use `this.minor` |
| F31 | supportsFeature3 is a copy of supportsFeature2 | low | bridgeClient.ts:115-122 | One supportsFeature(identity, byte, minMinor, bit) |
| F32 | HTTPS host-allowlist check copied a third time; only the new copy checks the port | low | officialFirmware.ts:17-25; manifest.ts:108-115; urls.ts:4-12 | One isAllowedHttpsUrl(raw, hosts) in urls.ts |
| F33 | `.dk-hint` style copied per container, with no base rule (ControllerInfo hints render unstyled) | low | desktop.css:228,722,3868 | One base `.dk-hint`, keep only the margin overrides |
| F34 | Link color rule repeated per container; PartPanel's notes link is unstyled | low | desktop.css:727,823,4211 | One `.dk a { color: var(--dk-sel-text) }` |
| F35 | New ctrlInfo i18n keys repeat existing strings in 7 locales | low | locales/*.json ctrlInfo.battery/firmware/officialCurrent | Reuse the existing keys (zh-CN battery wording changes slightly) |
| F36 | Roadmap still lists the shipped OLED Status screen as planned | low | about/roadmap.ts:91 vs BACKLOG.md:78 | Move it to "next" |
| F37 | Done-with-unsaved confirm puts Cancel last; every other confirm puts it first | low | DesktopApp.tsx:293-312 | Reorder: Cancel, Discard, Save & close (or a shared InlineConfirm) |
| F38 | Issues URL hard-coded twice | low | ComingSoon.tsx:4; AboutPage.tsx:45 | One exported ISSUES_URL |
| F39 | Same app screenshot committed 3 times across both repos (predates the range) | low | app docs/screenshots/live-controller.png = guide-controller.png = firmware docs/screenshots/live-controller.png | Keep the app copy; firmware README links its raw URL; GUIDE.md uses live-controller.png |
| F40 | OLED Status glyph is a hand-kept copy in both repos | low | src/oled/statusPad.ts vs DS5Dongle/src/oled_pad.h | **Accept for now** (guarded by the golden-hash test). Later, generate from oled_pad.h or share fixtures |

## Gates (rules that exist only as prose)

| # | Title | Sev | Where | Smallest fix |
|---|---|---|---|---|
| F41 | Nothing keeps lib/opus and lib/WDL as submodule gitlinks (5d869f1 broke it once, 19dd1f1 fixed it) | low | DS5Dongle release.sh:67-71; build.yml:28-31 | Mode check in release.sh, CI and a pre-commit hook, plus a one-line CLAUDE.md rule |
| F42 | Firmware host tests (63-byte cap, flash, curve parity) don't block a release | low | DS5Dongle release.sh:66-72; release.yml firmware job | Run tests/host/run.sh in both before the UF2 build |
| F43 | Core1 RAM-residency rule is checked only by an on-hardware OLED row | low | DS5Dongle CLAUDE.md:40,105; build.yml:84-122 | CI nm check: no `__mem*_chk`, and core1/opus hot symbols in 0x2000_0000-0x2008_0000 |
| F44 | Theme-color gate skips .ts files | low | .hooks/check_theme_colors.mjs:25; tray/trayIcon.ts | Walk .ts, exempt the token-source files by path, mark the trayIcon lines theme-exempt |
| F45 | "Exact versions" rule is broken by 8 caret ranges (old) | low | package.json:26-31,40-41 | Pin them, add `.npmrc save-exact=true` and a test that rejects ^/~ |
| F46 | "≥ 2 weeks after release": Dependabot has no cooldown | low | .github/dependabot.yml | `cooldown: { default-days: 14 }` on npm and actions |
| F47 | LINT_SUPPRESSIONS.md lists none of the 8 inline disables | low | docs/LINT_SUPPRESSIONS.md; 8 eslint-disable sites | Test that each (rule, file) is in the doc; `reportUnusedDisableDirectives: "error"` |
| F48 | Duplicate lister is manual, code-only and single-repo; byte-identical files exist | low | tools/list_duplicates.mjs:13-23; package.json gates | `--check` mode in `npm run gates`, plus a cross-repo identical-file check in release.sh with an allowlist |

---

## Proposed fix batches for dev.7 (highest value first)

1. **Profile safety: never-flash guarantee** (app). F1, F3, F2, F4, F5, with F24 (shared useProfileTarget, which F3 needs anyway). Adds unit tests for "parts write fails", "switchSlot during apply" and "save while editing a non-active profile". This is the only batch that protects user data.
2. **Live page: dead glow + render cost** (app). F17, F18, F19, F27 (shared themeChanged), F28. It fixes one visual that does nothing and removes WebGL churn on drag and Alt-Tab.
3. **One color system** (app). F20, F23, F22, F7, F6. One codec and one hue converter in desktopPalette, recent colors on useRawPref, the hue clamp, and the Match-desktop grounds.
4. **Game page "All settings" reuses the real sections** (app, larger refactor). F21. It needs value/onChange adapters on the Settings and Lightbar sections. Could slip to dev.8 if dev.7 is full.
5. **Firmware hardening + firmware gates** (DS5Dongle). F12, F13, F14, F15, F16, plus gates F41, F42, F43.
6. **App cleanup + doc drift** (app, many small edits). F26, F25, F29, F30, F31, F32, F33, F34, F35, F36, F37, F38, F39, F8 (with its fake-/proc test), F9, F10, F11. F40 stays as is.
7. **App gates** (app). F44, F45, F46, F47, F48, plus the new gates below.

## Status

**Batch 7 (App gates): done on branch `qp-gates`.** `npm run check` passes with every new gate.

- **F44:** the theme gate walks `.ts` too. Path-exempt token sources: `theme/desktopPalette.ts`, `colorVision.ts`, `live/colorways.ts` (palettes) and `about/roadmap.ts` (prose: "the black parts"). The 5 tray icon lines are marked `theme-exempt`. A stale `TOKEN_SOURCES` path fails the gate.
- **F45:** the 8 `^` ranges pinned to the installed versions (no lockfile version changes), `.npmrc` `save-exact=true`, `tests/unit/dependencies.test.ts` rejects `^`/`~`/ranges/tags and checks the lockfile root matches. (`bun.lock` is a stale upstream leftover with vite 5 ranges; it isn't used by npm or CI and is left alone.)
- **F46:** Dependabot `cooldown: default-days: 14` on npm and actions, checked by the same test.
- **F47:** `reportUnusedDisableDirectives: "error"` (none were unused). `docs/LINT_SUPPRESSIONS.md` has an "Inline disables" table (5 rule + file rows for the 8 directives); `tests/unit/lintSuppressions.test.ts` checks it both ways and rejects a disable without a rule.
- **F48:** `list_duplicates.mjs --check` in `npm run gates`, CI and pre-commit, against `docs/DEDUPE_AUDIT.md` (regenerated: 89 rows; 36 new since 0.9.0 got verdicts: 7 DEFERRED to F20/F23 and batch 1's remap buttons, 11 OPEN for the next pass: the Calibration/StickCurves per-slot read, StickCurves' stick math twice, SetupScreen/WindowsUsbRepair's poll loop). `tools/check_identical_files.mjs` (this repo, or with `../DS5Dongle` across both) is in `npm run gates`; the firmware's `release.sh` can run `(cd "$APP_DIR" && node tools/check_identical_files.mjs "$FW_DIR")` (not wired there: the firmware repo is batch 5's). Allowlisted: F39's screenshots (batch 6), daidr's LICENSE next to each copy of the art (intended), two identical firmware stub headers (intended), and one new copy: `docs/marketing/colorways/dualsense-colorways.mp4` = `site/media/colorways.mp4` (next pass).
- **Roadmap ↔ BACKLOG** (`tests/unit/roadmapBacklog.test.ts`): every Coming soon entry maps to one BACKLOG row with a matching status. F36 (batch 6) is allowlisted as a known mismatch. It also found and this batch fixed: "Profiles hold every setting" was still "planned" (shipped in dev.5, now "next"); BACKLOG's "Firmware: OLED flush and Opus encoder speedups" still said Agreed (shipped in firmware dev.5, now Done); "Test copies without a tray icon" was in BACKLOG twice (the older row removed; the test now rejects duplicate rows).

**Batch 2 (Live page: dead glow + render cost), plus F23 and F6: done on branch `qp-live`.**

- **F17 fixed.** HdrGlow reads `--ctl-led` / `--ctl-led-pct` from the drawing's `<svg>` (where LiveController sets them) and watches that `<svg>`'s style; a new `<svg>` (the other model's drawing) gets a new mask and is watched instead.
- **F18 fixed.** SwirlField builds its renderer once per `mode` (per canvas). The palette sits in a ref, re-read on color and theme changes (and drawn at once only while still); focus, shown and Reduce motion restart only the interval.
- **F19 fixed.** `sameIdentity()` (bridgeClient.ts, unit-tested): the identity poll keeps the old object when nothing changed, so a quiet second no longer re-renders the app.
- **F27 fixed.** One `onThemeChange()` in controllerAccent.ts (theme attributes and inline tokens on `<html>` incl. `data-cv` and `data-controller-theme`, the palette and accent `<style>` in `<head>`, the OS light/dark, accent changes) used by LiveData's spark lines, SwirlField and GamePage. The dead `data-color-vision` filter is gone.
- **F28 fixed.** `useReducedMotion()` in motion.ts (the app preference + `prefers-reduced-motion`, followed live); SwirlField's own detector is removed.
- **F23 fixed (swirl side).** The RGB <-> HSV conversion now lives in desktopPalette.ts (`rgbToHsv`, `hsvToRgb`, unit-tested) and SwirlField's `rotateHue` is built on it. `colorPicker/colorMath.ts` was left untouched on purpose: it should re-export these with the F20 codec merge (batch 3), which removes its copy (its 8 rows in `docs/DEDUPE_AUDIT.md` are DEFERRED to batch 3).
- **F6 fixed.** Match desktop (KDE) passes `[page, panel, inset, button]` to `accentVars`; an accent-only palette still checks the panel only (the built-in theme draws the rest). Unit test fails without the fix.

## Gates to add

- **Firmware repo:** a check that lib/* stay mode 160000 with no 120000 symlinks (release.sh, CI, pre-commit); host tests in release.sh and release.yml; an ELF nm check for RAM residency (F41-F43).
- **Theme gate covers .ts**, with path exemptions for the token sources (F44).
- **Dependencies:** a test that rejects ^/~, `.npmrc save-exact`, Dependabot cooldown 14 days (F45, F46).
- **Lint suppressions:** each inline disable must be listed in the doc, and unused disables are errors (F47).
- **Duplicates:** `list_duplicates.mjs --check` in `npm run gates`, plus a cross-repo identical-file check in release.sh (F48). This would have caught F20, F31 and F32.
- **Roadmap ↔ BACKLOG:** a unit test that every roadmap item maps to a BACKLOG row with a matching status (F36).
- **Games watcher:** a fake-/proc test for an orphaned native Heroic game (F8).
