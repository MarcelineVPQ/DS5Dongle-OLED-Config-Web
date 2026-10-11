# Download page

The download page at `marcelinevpq.github.io/DS5Dongle-OLED-Config-Web`
(live since v0.8.0, replacing the browser configurator). Plain static files, no build step, no
third-party requests (fonts and media are local).

- `download.js` reads the app's update feed (`latest.json` in the firmware
  repo) and points the button at this computer's build of the latest release,
  with links for the other systems. Without a feed it says "Coming soon" and
  links to the releases page.
- Images come from `docs/marketing/` (resized to WebP); the video is the
  colorway animation.

Preview: open `site/index.html` in a browser (or `npx serve site`).

Deployed by `.github/workflows/deploy.yml` on every push to master (the
folder is uploaded as is).
