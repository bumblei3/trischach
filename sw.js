// TriSchach Service Worker
/* eslint-env serviceworker */
// Provides offline support and caching for PWA

const CACHE_NAME = "trischach-v2";
const STATIC_CACHE = "trischach-static-v2";
const DYNAMIC_CACHE = "trischach-dynamic-v2";

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/css/style.css",
  "/main.js",
  "/ai-core.js",
  "/ai-worker.js",
  "/opening-book.compiled.js",
];

const CACHE_STRATEGIES = {
  // Cache first for static assets
  static: async (request, cache) => {
    const cached = await cache.match(request);
    if (cached) return cached;

    try {
      const response = await fetch(request);
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    } catch (e) {
      // Return offline page or error
      return new Response("Offline", { status: 503 });
    }
  },

  // Network first for API/dynamic content
  networkFirst: async (request, cache) => {
    try {
      const response = await fetch(request);
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    } catch (e) {
      const cached = await cache.match(request);
      if (cached) return cached;
      return new Response("Offline", { status: 503 });
    }
  },
};

// Install event - cache static assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => {
        console.log("[SW] Caching static assets");
        return cache.addAll(
          STATIC_ASSETS.map(
            (url) => new Request(url, { credentials: "same-origin" }),
          ),
        );
      })
      .then(() => self.skipWaiting()),
  );
});

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== STATIC_CACHE && name !== DYNAMIC_CACHE)
            .map((name) => {
              console.log("[SW] Deleting old cache:", name);
              return caches.delete(name);
            }),
        );
      })
      .then(() => self.clients.claim()),
  );
});

// Fetch event - serve from cache with strategies
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== "GET") return;

  // Skip chrome-extension and other non-http(s) requests
  if (!url.protocol.startsWith("http")) return;

  // Determine cache strategy based on request type
  const isStaticAsset = STATIC_ASSETS.some(
    (asset) =>
      url.pathname === asset || url.pathname.endsWith(asset.replace("/", "")),
  );

  // The AI worker (and its `./ai-core.js` module import) must be served from
  // the network, never from the SW cache. When the browser loads a module
  // Worker, the request arrives with `destination === "script"` (not
  // "worker") and `ai-worker.js` is also listed in STATIC_ASSETS, so it would
  // otherwise be served cache-first. A cache-served module Worker fails to
  // initialise reliably (the main thread then blocks on every AI move because
  // `workerReady` never flips), which freezes Auto-Battle. Pass it through.
  const isWorkerModule =
    url.pathname === "/ai-worker.js" || url.pathname === "/ai-core.js";
  if (isWorkerModule || request.destination === "worker") {
    event.respondWith(fetch(request));
    return;
  }

  // Service Workers and dynamically imported ES modules (incl. the AI
  // worker and its `./ai-core.js` import) cannot be served reliably from
  // the SW cache — the module fetch in the SW scope fails with
  // net::ERR_FAILED, which blocks the worker from loading entirely.
  // Pass these through to the network directly (no caching).
  if (request.destination === "script" && !isStaticAsset) {
    event.respondWith(fetch(request));
    return;
  }

  if (
    isStaticAsset ||
    request.destination === "style" ||
    request.destination === "font"
  ) {
    // Cache first for static assets
    event.respondWith(
      CACHE_STRATEGIES.static(request, caches.open(STATIC_CACHE)),
    );
  } else {
    // Network first for dynamic content
    event.respondWith(
      CACHE_STRATEGIES.networkFirst(request, caches.open(DYNAMIC_CACHE)),
    );
  }
});

// Background sync for offline game saves
self.addEventListener("sync", (event) => {
  if (event.tag === "game-save") {
    event.waitUntil(syncGameSaves());
  }
});

async function syncGameSaves() {
  // In a real implementation, this would sync localStorage game saves to server
  console.log("[SW] Syncing game saves...");
}

// Push notification support (for future multiplayer)
self.addEventListener("push", (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-72.png",
    vibrate: [200, 100, 200],
    data: data.url || "/",
    actions: [
      { action: "play", title: "Spielen" },
      { action: "close", title: "Schließen" },
    ],
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  if (event.action === "play") {
    event.waitUntil(clients.openWindow(event.notification.data));
  }
});

console.log("[SW] Service Worker loaded");
