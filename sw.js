// TriSchach Service Worker
/* eslint-env serviceworker */
// Provides offline support and caching for PWA

const CACHE_NAME = "trischach-v1";
const STATIC_CACHE = "trischach-static-v1";
const DYNAMIC_CACHE = "trischach-dynamic-v1";

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/css/style.css",
  "/js/main.js",
  "/js/board.js",
  "/js/board.ts",
  "/js/hex.js",
  "/js/hex.ts",
  "/js/pieces.js",
  "/js/pieces.ts",
  "/js/game.js",
  "/js/game.ts",
  "/js/ai.js",
  "/js/ai-core.js",
  "/js/ai-core.ts",
  "/js/ai-worker.js",
  "/js/game-check.js",
  "/js/game-check.ts",
  "/js/opening-book.js",
  "/js/replay.js",
  "/js/sounds.js",
  "/js/types.ts",
  "/opening-book.compiled.json",
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

  if (
    isStaticAsset ||
    request.destination === "style" ||
    request.destination === "script" ||
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
