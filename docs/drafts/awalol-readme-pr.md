# DRAFT — PR to awalol/DS5Dongle: update the OLED Edition entry

**Status: draft, do not send yet.** Send after the stable 0.9.5 release, once
Marcy has polished it. Before sending:

- [ ] Final product name decided (see BACKLOG "Product name / branding"): keep
      "OLED Edition", or "PixelLink OLED, by 42 Pixel Studios". Update the
      heading below and the repo link if the repo is renamed.
- [ ] Re-check every feature below against the 0.9.5 release notes (nothing
      unreleased, nothing missing).
- [ ] Capture the screenshots listed at the bottom from the 0.9.5 build,
      upload them to our repo (docs/screenshots/), link them in the PR body.
- [ ] Match the README's current wording/format again (it may have changed).
- [ ] Keep the README entry short: same size as the other entries. Details,
      pictures and the full feature list go in the PR body, not the README.
- [ ] Marcy's final read-through and edits.

---

## PR title

docs(readme): update the OLED Edition entry under Community Fork

## PR body

Hi awalol, thanks for listing the OLED Edition under Community Fork, and for
DS5Dongle itself: everything here is built on it.

The fork has grown since that entry was written. Besides the OLED add-on it
now ships a desktop configurator app (Linux, Windows, macOS) with the firmware
bundled, so this PR only updates our entry's text to say so. Nothing else in
the README is changed.

A few pictures (from 0.9.5):

<!-- screenshots, see list below -->

Full feature list, for reference (not proposed for the README):

**Configurator app (Linux, Windows, macOS)**
- The live controller: a drawing of your exact controller (DualSense or
  DualSense Edge, its colorway or your own colors) showing every press, stick,
  trigger and touch as it happens; click any part to set it up
- Per-game profiles that hold every setting (triggers, haptics, Audio Auto
  Haptics, speaker, lightbar, mic, buttons, stick curves), switched in while
  the game runs and never written to the dongle's flash
- Button remapping and saved button layouts, including the Edge's Fn and back
  buttons
- Stick response curves (presets or your own), calibration (sticks, triggers,
  gyro) and stick tests (circularity, drift)
- Games library: Steam, Heroic, Lutris, GOG and Epic games with artwork,
  play time and DualSense support notes; Proton setup on Linux
- Controller info: the controller's own firmware, battery voltage and lifetime
  counters (play time, charges, button presses), plus a check against Sony's
  latest official firmware
- Dongle dashboard: live OLED mirror, temperature, clock, signal, audio
  pipeline and per-stage firmware timings
- One-click firmware and app updates (Stable and Development channels)
- Themes, Liquid Glass, HDR lightbar glow, 7 languages, color-blind modes,
  runs lean when minimized

**Firmware (on top of upstream)**
- Optional Pico-OLED-1.3 128×64 display with 11 screens, now including a
  symmetric live controller with Create/Options and, on an Edge, its Fn and
  back buttons
- 4-slot multi-controller pairing, lightbar favorites and effects, settings menu
- Edge Fn/back button remapping, stick response curves, calibration per slot
- Controller health/info readout, per-stage timing counters
- Leaner OLED refresh and speaker encoder

Thanks again!

---

## Proposed README entry (replaces the current OLED Edition block)

### OLED Edition [MarcelineVPQ/DS5Dongle-OLED-Edition](https://github.com/MarcelineVPQ/DS5Dongle-OLED-Edition)

> Adds an optional Pico-OLED-1.3 display (11 screens: live controller, multi-controller pairing, lightbar, diagnostics,
> settings) and a desktop configurator app for Linux, Windows and macOS with the firmware bundled: a live view of your
> controller, per-game profiles, button remapping (including the DualSense Edge), stick curves and calibration, a games
> library, and one-click updates.

---

## Screenshots to capture at 0.9.5 (app + OLED)

1. Controller page: the live drawing (Cosmic Red or similar) with the live data
   cards and the Controller info card
2. A game page with its profile (compact card) and artwork
3. Button assignments (the button list with the Edge drawing)
4. Calibration with the stick curve editor
5. Pico 2 W page: live OLED mirror + dashboard (timing card visible)
6. The OLED itself: contact sheet of the Status screen, DualSense and Edge
   (docs/screenshots/oled-status-dualsense-edge.png)
7. Optional: Games library home (cover grid)
