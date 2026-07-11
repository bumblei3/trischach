import { defineConfig } from "vitest/config";
import process from "process";

const isCI = !!process.env.CI;

export default defineConfig({
  test: {
    environment: "happy-dom",
    setupFiles: ["./tests/setup.ts"],
    exclude: ["node_modules", "tests-e2e"],
    // The "Game reaches a final state after many moves" integration test plays
    // a full AI-vs-AI game to completion. Under vitest 3 / happy-dom 20 this
    // takes ~120s, so the previous 60s budget was no longer enough.
    testTimeout: 180000,
    // Run tests sequentially in CI to avoid memory issues
    pool: isCI ? "forks" : "threads",
    poolOptions: {
      forks: { singleFork: true },
      threads: { singleThread: true },
    },
    coverage: {
      // Istanbul instead of the default `v8` provider. Vitest 3.2+ v8 uses
      // AST-based remapping (ast-v8-to-istanbul) which cannot map TypeScript
      // statements back to source, so every .ts file reports 0% statements
      // while still claiming 100% branches/functions. Istanbul instruments the
      // TS source directly and yields correct per-statement coverage.
      provider: "istanbul",
      // `json-summary` produces coverage/coverage-summary.json which the CI
      // threshold gate reads. Without it the gate reads a non-existent file
      // and silently passes.
      reporter: ["text", "json", "json-summary", "html"],
      exclude: [
        "node_modules/**",
        "tests/**",
        "tests-e2e/**",
        "*.config.*",
        // Build / tooling scripts — not app logic
        "generate-*.js",
        "generate-icons.js",
        "icons/generate-icons.js",
        "dist/**",
        "sw.js", // Service worker
        "scripts/**",
        "auto-battle-learn.js",
        "debug-line.js",
        "opening-book.compiled.json",
        "js/main.ts", // UI/event code (~100KB) — covered by E2E, not unit tests
        "js/sounds.ts", // Audio - hard to unit test
        "js/types.ts", // Pure type definitions + re-exports — no logic to cover
        "js/ai-worker.ts", // Web Worker message handler — covered by E2E, not unit tests
        "js/puzzle.ts", // Puzzle generator is engine-driven (AI search) — covered by E2E, not unit tests
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
