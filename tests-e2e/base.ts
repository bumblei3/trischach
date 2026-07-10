// Shared Playwright fixtures for TriSchach E2E specs.
//
// Why this exists: TriSchach registers a Service Worker (PWA offline support)
// in index.html. A SW instance lingering from a previous test run caches
// static assets — including the AI worker module — and can freeze Auto-Battle
// and other flows, making the E2E suite non-deterministic. We disable the SW
// for the test browser so specs exercise the app, not the offline cache layer.
import { test as base, expect } from "@playwright/test";

export const test = base.extend({});

// Disable Service Worker registration before any page loads in every test.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      get: () => undefined,
    });
  });
});

export { expect };
