import { defineConfig } from "vitest/config";

export default defineConfig({
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
