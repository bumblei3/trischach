// Shared Playwright fixtures for TriSchach E2E specs.
//
// Why this exists: TriSchach registers a Service Worker (PWA offline support)
// in index.html. A SW instance lingering from a previous test run caches
// static assets — including the AI worker module — and can freeze Auto-Battle
// and other flows, making the E2E suite non-deterministic. We disable the SW
// for the test browser so specs exercise the app, not the offline cache layer.
import { test as base, expect } from "@playwright/test";

// Minimal valid SVG served for any icon request in the test browser. This
// stops the dev server from being hammered by parallel icon fetches (3
// workers all requesting /icons/icon-192.svg at once) which, under load,
// made Chrome abort the request with net::ERR_FAILED — a flaky, pre-existing
// failure unrelated to engine logic. Icons are purely decorative, so
// answering them locally does not mask any app behaviour.
const ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192"><rect width="192" height="192" fill="#FF4500"/></svg>';

export const test = base.extend({});

// Disable Service Worker registration before any page loads in every test.
// We replace navigator.serviceWorker with a no-op stub rather than deleting
// it or returning undefined: index.html guards with `"serviceWorker" in
// navigator`, which stays true even if the property is redefined to undefined,
// so it would still call `.register` and throw "Cannot read properties of
// undefined (reading 'register')" — breaking the app under test. The stub's
// register() never resolves, so no SW is ever installed, keeping specs
// deterministic (no cached AI worker / static assets from prior runs).
test.beforeEach(async ({ context, page }) => {
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

  // Answer icon + manifest requests locally so the dev server's parallel-load
  // pressure can't abort them (net::ERR_FAILED). Purely decorative assets.
  await page.route(/icons\/.*\.(svg|png|ico)$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: ICON_SVG,
    }),
  );
  await page.route(/\/manifest\.json$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/manifest+json",
      body: '{"name":"TriSchach","short_name":"TriSchach","display":"standalone","icons":[{"src":"icons/icon-192.svg","sizes":"192x192","type":"image/svg+xml"}]}',
    }),
  );
  // Opening-book JSON is fetched with the GitHub-Pages subpath base
  // (/trischach/...) which 404s on the local dev server (served from root),
  // and the auto-battle specs that load it surface that 404 as a flaky
  // console error. Answer it locally with a valid (empty) book so the suite
  // tests game logic, not asset resolution.
  await page.route(/opening-book.*\.json$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    }),
  );
});

export { expect };
