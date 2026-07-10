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
// We replace navigator.serviceWorker with a no-op stub rather than deleting
// it or returning undefined: index.html guards with `"serviceWorker" in
// navigator`, which stays true even if the property is redefined to undefined,
// so it would still call `.register` and throw "Cannot read properties of
// undefined (reading 'register')" — breaking the app under test. The stub's
// register() never resolves, so no SW is ever installed, keeping specs
// deterministic (no cached AI worker / static assets from prior runs).
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try {
      Object.defineProperty(navigator, "serviceWorker", {
        configurable: true,
        writable: true,
        value: {
          register: () => new Promise<void>(() => {}),
          addEventListener: () => {},
          removeEventListener: () => {},
          getRegistration: () => Promise.resolve(undefined),
          getRegistrations: () => Promise.resolve([]),
          ready: Promise.resolve(undefined),
        },
      });
    } catch {
      /* ignore - some contexts may not allow redefinition */
    }
  });
});

export { expect };
