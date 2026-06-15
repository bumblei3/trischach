// source: https://github.com/microsoft/playwright/issues/21340
import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

// Check if system chromium exists
const hasSystemChromium = existsSync("/usr/bin/chromium-browser");

export default defineConfig({
  testDir: "./tests-e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html"], ["json", { outputFile: "test-results/results.json" }]],
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: process.env.CI
          ? {}
          : hasSystemChromium
            ? {
                executablePath: "/usr/bin/chromium-browser",
                args: [
                  "--no-sandbox",
                  "--disable-setuid-sandbox",
                  "--disable-dev-shm-usage",
                ],
              }
            : {},
      },
    },
  ],
  webServer: {
    command: "npx vite preview --port 4173 --host",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 180000,
  },
});
