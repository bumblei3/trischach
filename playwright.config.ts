import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// Check if system chromium exists
const hasSystemChromium = existsSync('/usr/bin/chromium-browser');

export default defineConfig({
  testDir: './tests-e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // CI: uses npx playwright install --with-deps (Playwright's own chromium)
        // Local with system chromium: use /usr/bin/chromium-browser
        // Local without system chromium: use Playwright's bundled chromium (if installed)
        launchOptions: process.env.CI 
          ? {}  // Use Playwright's installed browser on CI
          : hasSystemChromium
            ? { executablePath: '/usr/bin/chromium-browser', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] }
            : {}, // Use Playwright's bundled browser if available
      },
    },
  ],
  webServer: {
    command: 'npx vite preview --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});