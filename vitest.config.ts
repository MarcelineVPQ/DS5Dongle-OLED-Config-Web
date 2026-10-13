import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Never the real package: see tests/support/electron.ts.
  resolve: { alias: [{ find: /^electron$/, replacement: fileURLToPath(new URL("./tests/support/electron.ts", import.meta.url)) }] },
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
