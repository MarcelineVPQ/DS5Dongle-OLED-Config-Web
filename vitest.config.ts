import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { FIRMWARE_CHANGELOG_ALIAS, firmwareChangelogPath } from "./firmwareChangelog.config";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const FIRMWARE_CHANGELOG = firmwareChangelogPath(ROOT);

export default defineConfig({
  // The firmware changelog may come from the firmware checkout next to this repo.
  server: { fs: { allow: [ROOT, dirname(FIRMWARE_CHANGELOG)] } },
  // Never the real package: see tests/support/electron.ts.
  resolve: {
    alias: [
      { find: /^electron$/, replacement: fileURLToPath(new URL("./tests/support/electron.ts", import.meta.url)) },
      { find: FIRMWARE_CHANGELOG_ALIAS, replacement: FIRMWARE_CHANGELOG },
    ],
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // agents' git worktrees (.claude/worktrees) hold whole copies of the repo
    exclude: ["**/node_modules/**", ".claude/**", "tmp/**"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/protocol/**", "src/desktop/**/*.ts", "electron/**"],
      reporter: ["text", "html"],
    },
  },
});
