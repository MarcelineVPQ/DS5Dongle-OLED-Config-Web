// Desktop (Electron) build. The browser build still uses vite.config.ts.
import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

// The Developer card (previews, fake controllers, HDR test) is built into dev
// builds only: DS5_DEV_TOOLS=1 (devrun / test builds) or a development
// version (X.Y.Z-dev.N, the Development channel). Stable releases leave it out.
const version = (JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { version: string }).version;
const DEV_TOOLS = process.env.DS5_DEV_TOOLS === "1" || /-dev\.\d+$/.test(version);

// Strict CSP for the desktop renderer: no remote scripts, no eval, and the page
// can only talk to its own origin. Device access is WebUSB, gated in the main
// process. Production only: the Vite dev server needs inline scripts for HMR.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: ds5-art:", // game artwork (main process, local files only)
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function desktopCsp(): Plugin {
  return {
    name: "ds5-desktop-csp",
    apply: "build",
    transformIndexHtml: {
      order: "pre",
      handler(html: string) {
        return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
      },
    },
  };
}

export default defineConfig({
  main: {
    build: {
      outDir: "out/main",
      rollupOptions: { input: resolve("electron/main/index.ts") },
    },
  },
  preload: {
    build: {
      outDir: "out/preload",
      rollupOptions: {
        input: resolve("electron/preload/index.ts"),
        // Sandboxed preloads must be CommonJS.
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: ".",
    plugins: [react(), desktopCsp()],
    define: { "import.meta.env.VITE_DESKTOP": JSON.stringify("1"), "import.meta.env.VITE_DEV_TOOLS": JSON.stringify(DEV_TOOLS ? "1" : "0") },
    build: {
      outDir: "out/renderer",
      // Never inline assets as data: URLs; the CSP only allows 'self'.
      assetsInlineLimit: 0,
      rollupOptions: { input: resolve("index.html") },
    },
  },
});
