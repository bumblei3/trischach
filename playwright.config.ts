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
    // Use the Vite dev server (not `vite preview`) so the E2E suite does not
    // depend on a prior production build producing dist/index.html. `vite
    // preview` serves the *built* dist/ and silently serves a directory
    // listing (app never loads) when the build omits index.html — which made
    // every test hang on waitForSelector until timeout on branches whose
    // vite.config entry did not emit index.html. The dev server serves
    // index.html (and js/main.ts via on-the-fly TS transform) directly, so the
    // suite is robust regardless of build config.
    command: "npx vite --port 4173 --host",
    url: "http://localhost:4173",
    // Always start a fresh server. A leftover (possibly broken) server on
    // 4173 from an aborted run would otherwise be silently reused
    // (reuseExistingServer:true) and make every test hang on the never-loading
    // app. --strictPort makes a port clash fail loudly instead of shadowing.
    reuseExistingServer: false,
    timeout: 120000,
  },
});
