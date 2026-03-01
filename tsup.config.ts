import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: {
      index: "src/index.ts",
      "testing/index": "src/testing/index.ts",
      "memory/index": "src/memory/index.ts",
      "middleware/index": "src/middleware/index.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    splitting: true,
    clean: true,
    treeshake: true,
    sourcemap: true,
    target: "node20",
    outDir: "dist",
    external: [
      "openai",
      "@anthropic-ai/sdk",
      "gpt-tokenizer",
      "better-sqlite3",
      "pg",
      "@modelcontextprotocol/sdk",
      "playwright",
    ],
  },
]);
