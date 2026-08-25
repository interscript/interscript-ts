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
      // Browser-only session adapters run in the in-browser demo, not under
      // Node; .d.ts files are ambient declarations.
      exclude: [
        "src/cli.ts",
        "src/**/*.d.ts",
        "src/ml/session/onnx-web.ts",
        "src/ml/session/litert-web.ts",
      ],
      // Floors set at the ISC-runtime port baseline; ratchet up as specs grow.
      thresholds: {
        statements: 70,
        branches: 60,
        functions: 69,
        lines: 71,
      },
    },
  },
})
