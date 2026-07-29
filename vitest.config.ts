import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // Bench files use .bench.ts to keep them out of the default suite.
    include: ["test/**/*.test.ts"],
    exclude: ["test/fixtures/**", "node_modules/**", "test/**/*.bench.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/cli.ts"],
      thresholds: {
        statements: 75,
        branches: 60,
        functions: 80,
        lines: 80,
      },
    },
  },
})
