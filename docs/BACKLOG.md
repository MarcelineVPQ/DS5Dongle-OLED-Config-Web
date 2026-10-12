# DS5 Dongle OLED Edition Backlog

**The one list** of open and planned work for the app and its firmware (`~/projects/DS5Dongle`
points here too), started 2026-10-11. Each row says what it is, where it stands, and what it is
waiting on. Rows with a detail doc link to it.

**Keeping it current:**

- When work starts, ships, or is decided against, change its row in the same commit. A shipped
  item leaves the table (the CHANGELOG has it); its detail doc (if any) moves to `docs/complete/`.
- Something agreed in conversation gets a row the same day.
- Session notes and handoffs point here. They never keep a second list.

**Status words:** _Agreed_ (decided, not started) · _In progress_ · _Blocked_ (waiting on
something outside the project) · _Question_ (needs an answer from Marcy before anything happens) ·
_Idea_ (noted, not decided) · _Open_ (a known problem, not yet scheduled).

## Open items

### 0.9.0 release prep (in this order)

| Item                         | Status                                                                                                                                                                                                                                                                                                                                                                                     | Priority | Detail                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | -------------------------------------------- |

### After 0.9.0

| Item                               | Status                                                                                                                                                                                                                                                                                         | Priority | Detail |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| Opt-in development update channel | **Released in 0.9.1 (2026-10-11).** Next: the first development build (`tools/release.sh 0.9.2-dev.1`), e.g. the upstream clock changes, tried on our own dongle first | High | - |
| Saved button layouts | **Agreed (Marcy 2026-10-11).** Named button-layout (remap) profiles kept in one library (e.g. "Southpaw", "Racing"); a game's profile picks one by name instead of holding its own copy, so a favorite is made once and used anywhere (game profiles hold no remaps today). Edit in one place, every game using it follows. **Public layouts too:** share a layout to the community database and use other players' (rides on the community phase's signed `games.json` + Share-as-issue flow) | Med | - |
| Per-trigger resistance strength | **Agreed (Marcy 2026-10-11).** L2 and R2 each get a strength (e.g. 0-150%) that scales the game's adaptive-trigger forces before the dongle forwards them (like DSX). Needs per-effect decoding: each trigger mode packs its force values differently (off/feedback/weapon/vibration and the multi-zone modes). Firmware + config field + Triggers panel + per-game profile field | Med | - |
| OLED Status screen controller drawing | **Agreed (Marcy 2026-10-11).** Firmware `oled.cpp` Status screen: the controller glyph's geometry is uneven (the face-button cluster sits off-center against the d-pad, the two halves don't mirror), and the Create and Options buttons are missing (they should sit by the small bars at the top, between the sticks). Redraw it symmetric, with Create/Options lighting when pressed. Check against the console mirror | Low-Med | - |
| Mic muted and headset indicators | **Agreed (Marcy 2026-10-11).** On the live controller: when the mute button glows orange, say so ("Mic muted") next to it; and show when headphones are plugged into the controller (the data is already read: Connection card "Mic muted", "Headset jack"). An icon plus a word for each, in the app's own styling (theme tokens, the magazine-title type). Possibly the OLED Status screen too | Low-Med | - |
| Games library on Windows | **Agreed (Marcy 2026-10-12).** The Games page is hidden off Linux (`DesktopApp.tsx` `platform === "linux"`), a leftover from the Linux setup wizard it grew out of; the app is cross-platform. Port: Steam path from the registry (same `libraryfolders.vdf` / librarycache), a Windows running-game detector (profiles need it), Heroic on Windows, maybe Epic/GOG; Proton, Steam fixes and system checks stay Linux-only and hidden. Test in the Win11 VM | High | - |
| Name the hardware, not "Dongle" | **Idea (Marcy 2026-10-12).** Where the UI says "Dongle", show the board itself (e.g. "Pico 2 W"), taken from the firmware's board/model id so other boards (the original Pico W, future ones) slot in by name. Firmware: report the board in identity; app: one `hardwareName(identity)` used everywhere (rail, Dongle page, setup screen, guide) | Med | - |
| Public roadmap ("Working on / Coming soon") | **Idea (Marcy 2026-10-12).** Show users what's planned (Windows/macOS game library, QoL items) generated from this file so there is still one list: rows marked public get a one-line plain description. Where: app About tab, README, download page (to decide) | Med | - |
| Community game database            | **Agreed (after the dev channel).** GitHub-backed, no accounts, no telemetry: signed `games.json` read by the app (tiers, aggregate ratings, feedback tag counts, shared configs); Share opens a prefilled issue; admin analytics from the repo's CI. Phases 2-3 of the Games library plan       | High     | -      |
| Welcome tour rebuild               | **Agreed, last.** Off (`TOUR_ENABLED = false`) until rebuilt for the new layout; near the end of development, with the promo video                                                                                                                                                             | Low      | -      |
| 30-second promo video              | **Agreed, last.** For 42pixelstudios.com                                                                                                                                                                                                                                                       | Low      | -      |
| DualSense Edge drawing             | **Parked (time sink).** The Edge reuses the DualSense art. TurboSquid 1956564 is Editorial Use Only, reference only. Needs the Edge's button names (back paddles, Fn buttons)                                                                                                                    | Low      | -      |
| DS5 Dongle on 42pixelstudios.com   | **Agreed.** A product page on the studio site                                                                                                                                                                                                                                                  | Low      | -      |

### Open problems

| Item                                   | Status                                                                                                                                                                                                                                       | Priority | Detail |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| Galactic Racer hangs on exit           | **Open.** A game-side deadlock on quit, not a crash. `~/steam-4078430.log` (PROTON_LOG, 2026-10-11 12:07) not analysed yet                                                                                                                 | Low      | -      |
| Auto-connect sets state in an effect   | **Open.** The one lint warning left (`useDs5Bridge.ts`, `react-hooks/set-state-in-effect`); behavior is correct                                                                                                                             | Low      | [LINT_SUPPRESSIONS.md](LINT_SUPPRESSIONS.md) |
| Windows: Accent color "Desktop"        | **Open (Marcy 2026-10-12, Win11 VM).** Reported not working. `desktopTheme.ts` reads `systemPreferences.getAccentColor()` and listens for `accent-color-changed`; the VM's Windows (unactivated, Personalization locked) reports `9A0089`. Check: set the accent via the registry and see whether the app follows, and what the app actually shows | Med | - |
| Layout check: force the update states | **Agreed (2026-10-12).** `tools/check_layout.mjs` only sees the current state, so the firmware "Update to …" button (it pushed Check now off the panel, fixed in 0.9.3) was never checked. Make it force the app/firmware update-available and in-progress states on every run | Med | - |
| Linux: "Unable to claim interface"     | **Open (2026-10-12).** When another app (e.g. a second copy of the configurator) holds the dongle, the raw WebUSB error shows. Say "The dongle is in use by another app" instead | Low | - |
| Windows and macOS                      | **Open.** Built by CI. Windows now testable in a Win11 VM (`~/VMs/win11-test`, snapshot `clean-install`; the 0.9.1 app connects there); macOS still untested                                                                                                                                                                                            | Med      | -      |

### Ideas (noted, not decided)

| Item                                  | Notes                                                                                                         | Detail |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------ |
| Lightbar modes as favorites           | Check later whether rainbow / breathing etc. can be saved as favorites                                        | -      |
| Brighter art color on game pages      | Offered: pick a more saturated color from the game's art                                                      | -      |
| Square cover art for tall windows     | Offered: use the square/portrait cover when the window is tall and narrow                                     | -      |
