import { defineConfig } from "vitest/config";
import process from "process";

const isCI = !!process.env.CI;

export default defineConfig({
  test: {
    environment: "happy-dom",
    setupFiles: ["./tests/setup.ts"],
    exclude: ["node_modules", "tests-e2e"],
    testTimeout: 60000,
    // Run tests sequentially in CI to avoid memory issues
    pool: isCI ? "forks" : "threads",
    poolOptions: {
      forks: { singleFork: true },
      threads: { singleThread: true },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: [
        "node_modules/**",
        "tests/**",
        "tests-e2e/**",
        "*.config.*",
        "tournament.js",
        "js/**/*.ts", // TypeScript files excluded from coverage (tested via .js)
        "js/main.js", // UI code - tested via E2E
        "js/board.js", // Touch handlers - tested via E2E
        "js/sounds.js", // Audio - hard to unit test
        "js/ai-worker.js", // Worker wrapper - tested via ai.test.js
        "generate-*.js", // Build scripts
        "generate-icons.js",
        "sw.js", // Service worker
        "js/typedefs.js",
      ],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
