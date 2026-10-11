# Download page

The page that replaces the browser configurator at
`marcelinevpq.github.io/DS5Dongle-OLED-Config-Web` once the desktop app's
first release (v0.8.0) is out. Plain static files, no build step, no
third-party requests (fonts and media are local).

- `download.js` reads the app's update feed (`latest.json` in the firmware
  repo) and points the button at this computer's build of the latest release,
  with links for the other systems. Without a feed it says "Coming soon" and
  links to the releases page.
- Images come from `docs/marketing/` (resized to WebP); the video is the
  colorway animation.

Preview: open `site/index.html` in a browser (or `npx serve site`).

To switch it on: in `.github/workflows/deploy.yml`, upload `site/` as the
Pages artifact instead of the Vite build (and drop the UF2 bundling step).
