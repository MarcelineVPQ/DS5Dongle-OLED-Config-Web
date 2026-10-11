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
| UI / QoL pass                | **Agreed.** Every page at both window sizes, 7 languages, every theme and style, translucent cards, Reduce motion; colorways via the developer preview; tooltips and empty states on everything new; older firmware (no mirror, no calibration) degrades cleanly                                                                                                                           | High     | -                                            |
| Step-by-step guide           | **Agreed.** `docs/GUIDE.md`, shown in About -> Guide instead of the README: hardware (parts, headers, seating the OLED, a data cable, USB 2.0 port vs USB 3.0 radio noise), getting started, each page and panel with its own screenshot, troubleshooting. README trimmed to an overview + link                                                                                             | High     | -                                            |
| Screenshots                  | **Agreed.** Last, after the fixes: one clean setup, one window size, for the guide, README and Discord                                                                                                                                                                                                                                                                                     | Med      | -                                            |
| Hardware spot-check          | **Agreed.** Marcy: games on the 0.9.0 firmware (rumble, haptics, speaker, mic, calibration off/on); does a dongle restart need a replug                                                                                                                                                                                                                                                    | High     | -                                            |
| Release gates                | **Agreed.** CI dry run; local auto-updater test 0.8.1 -> 0.9.0; version bump; `tools/release.sh 0.9.0` (only when Marcy says "release"); Discord announcement with the new screenshots                                                                                                                                                                                                     | High     | -                                            |

### After 0.9.0

| Item                               | Status                                                                                                                                                                                                                                                                                         | Priority | Detail |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------ |
| Opt-in development update channel  | **Agreed (first after the release).** App setting Stable / Development (off by default); own signed feed (`latest-dev.json` + sig, same key) and dev firmware; one-click back to stable (the only path allowed to downgrade). First use: try upstream's stock-clock / PIO changes safely      | High     | -      |
| Saved button layouts | **Agreed (Marcy 2026-10-11).** Named button-layout (remap) profiles kept in one library (e.g. "Southpaw", "Racing"); a game's profile picks one by name instead of holding its own copy, so a favorite is made once and used anywhere (game profiles hold no remaps today). Edit in one place, every game using it follows. **Public layouts too:** share a layout to the community database and use other players' (rides on the community phase's signed `games.json` + Share-as-issue flow) | Med | - |
| Per-trigger resistance strength | **Agreed (Marcy 2026-10-11).** L2 and R2 each get a strength (e.g. 0-150%) that scales the game's adaptive-trigger forces before the dongle forwards them (like DSX). Needs per-effect decoding: each trigger mode packs its force values differently (off/feedback/weapon/vibration and the multi-zone modes). Firmware + config field + Triggers panel + per-game profile field | Med | - |
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
| Windows and macOS                      | **Open.** Built by CI, untested on real machines                                                                                                                                                                                            | Med      | -      |

### Ideas (noted, not decided)

| Item                                  | Notes                                                                                                         | Detail |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------ |
| Lightbar modes as favorites           | Check later whether rainbow / breathing etc. can be saved as favorites                                        | -      |
| Brighter art color on game pages      | Offered: pick a more saturated color from the game's art                                                      | -      |
| Square cover art for tall windows     | Offered: use the square/portrait cover when the window is tall and narrow                                     | -      |
