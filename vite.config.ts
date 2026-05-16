import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Asset URL prefix. GitHub Pages serves the site at
// https://marcelinevpq.github.io/DS5Dongle-OLED-Config-Web/ so every asset
// URL emitted into the built HTML must be prefixed with the repo name.
// `BASE_PATH=/ npm run build` overrides to root-path serving for local
// preview or for non-Pages deployments.
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH ?? "/DS5Dongle-OLED-Config-Web/",
});
