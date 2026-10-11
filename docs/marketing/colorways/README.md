# DualSense colorway renders

Marketing images of the app's live controller view in each standard DualSense
colorway the app recognizes, as the app draws them:

- `dualsense-NN-<name>.png`: one per colorway, transparent background, 2x
  resolution, steady blue lightbar, player 1 lit.
- `dualsense-colorways-sheet.png`: all 13 on one titled sheet.
- `dualsense-colorways.gif` (600 px, ~3.9 MB) and `dualsense-colorways.mp4`
  (720 px, ~1 MB): the controller cycling through all 13, each held ~1.3 s
  with a cross-fade and its name underneath. Prefer the MP4 on the web
  (smaller, smoother); the GIF is for places that only take GIFs.

Colors come from `src/desktop/live/colorways.ts` (00-05: AL2009man's art
colors; 06-12: close approximations). Art: AL2009man's DualSense
(Gamepad-Asset-Pack, MIT); credit it where these are used.

Special editions (God of War, Spider-Man, Astro Bot, ...) have printed artwork
the app can't reproduce, so they aren't shown.

Made by rendering the running desktop app over the Chrome DevTools protocol
(transparent page background, each colorway's CSS variables applied, the
SVG clipped at 2x), then trimmed to a common frame.
