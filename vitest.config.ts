import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/live/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/**/index.ts"],
      thresholds: {
        // Integration-critical modules
        "src/core/agent/**": { statements: 70 },
        "src/core/tools/**": { statements: 70 },
        "src/core/loops/**": { statements: 70 },
        "src/middleware/**": { statements: 60 },
        "src/memory/**": { statements: 60 },
        "src/core/state/**": { statements: 60 },
        "src/mcp/**": { statements: 50 },
      },
    },
    testTimeout: 10000,
    setupFiles: ["tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@curio": path.resolve(__dirname, "src"),
    },
  },
});
