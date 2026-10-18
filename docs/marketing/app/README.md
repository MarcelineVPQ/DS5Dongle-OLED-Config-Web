# App screenshots (marketing)

Full-resolution (2x) screenshots of the desktop app 0.9.5-dev.19 (the
accordion layout), taken in the screenshot look (`docs/screenshots/look.json`)
on an isolated copy of the app with the simulated board and a Cosmic Red
DualSense (dev tools build, Xvfb; the rail's "Development" label hidden).
The guide's own screenshots are in `docs/screenshots/`, taken the same way at
the look's window size with `tools/screenshot_env.mjs`; its Games pictures
show the Developer card's Fake games library, never a real one.

| File | Shows |
| --- | --- |
| `hero-live-controller.png` | The hero shot: the live controller full width (panel hidden), tiles and live data |
| `live-controller.png` | The Controller page with its sections (Light bar, Adaptive triggers…) folded |
| `panel-lightbar.png`, `panel-trigger.png`, `panel-remap.png` | The Light bar, Adaptive triggers and Button assignments sections (Cross picked on the drawing) |
| `panel-board.png` | The board's page (Pico 2 W): the OLED live, the dials, Diagnostics, OLED screen section open |
| `live-data.png` | Close-up of the live data cards |
| `about-credits.png` | About → Credits (A 42 Pixel Studios production) |
| `app-settings.png` | App settings, Appearance open |

Not included on purpose: the Pairing slots section and the Games page (the
guide has both, with the simulated board and the fake library). The guided
tour's picture is gone while the tour is off (`TOUR_ENABLED` in
`src/desktop/tour/Tour.tsx`).

Colorway renders and the animation are in `../colorways/`.
