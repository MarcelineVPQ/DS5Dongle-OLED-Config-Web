import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/protocol/**", "src/desktop/**/*.ts", "electron/**"],
      reporter: ["text", "html"],
    },
  },
});
