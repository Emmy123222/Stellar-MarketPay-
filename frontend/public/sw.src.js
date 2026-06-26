/**
 * Service worker for offline support (Issue #292) + PWA enhancements (Issue #496).
 * - Workbox precache manifest injected by next-pwa during production build (WB_MANIFEST)
 * - Cache-first for static assets / _next bundles
 * - Stale-while-revalidate for last-viewed job detail pages
 * - Network-first for API calls (falls back to cache, returns offline JSON if nothing cached)
 * - Network-first for pages (falls back to cache, then /offline for navigation requests)
 * - Background sync for queued form submissions
 */

// Workbox precache manifest injected by next-pwa during production build.
// Falls back to empty array in development or when next-pwa is disabled.
const WB_MANIFEST = self.__WB_MANIFEST || [];

const CACHE_VERSION = "v2";
const CACHE_NAME = `stellar-marketpay-${CACHE_VERSION}`;
const ASSET_CACHE = `stellar-assets-${CACHE_VERSION}`;
const API_CACHE = `stellar-api-${CACHE_VERSION}`;
const SYNC_QUEUE_KEY = "stellar-sync-queue";

// Shell pages to pre-cache on install
const PRECACHE_URLS = ["/", "/offline", "/jobs", "/status"];

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.allSettled([
          // addAll fails atomically; use individual adds so one 404 doesn't abort
          ...PRECACHE_URLS.map((url) => cache.add(url)),
          // Workbox-injected Next.js static assets (injected at build time)
          ...WB_MANIFEST.map((entry) => cache.add(entry.url)),
        ])
      )
      .then(() => self.skipWaiting())
  );
});

// ── Activate: purge old caches ────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  const currentCaches = new Set([CACHE_NAME, ASSET_CACHE, API_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => !currentCaches.has(name))
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // 1. Static assets & Next.js bundles → cache-first
  if (
    url.pathname.startsWith("/_next/") ||
    url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|webp)$/)
  ) {
    event.respondWith(cacheFirst(event.request, ASSET_CACHE));
    return;
  }

  // 2. API calls → network-first, fall back to cache, then offline JSON
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirstApi(event.request));
    return;
  }

  // 2.5. Job detail pages → stale-while-revalidate (Issue #496)
  if (event.request.mode === "navigate" && /^\/jobs\/[^/]+\/?$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event.request, CACHE_NAME));
    return;
  }

  // 3. Navigation (HTML pages) → network-first, fall back to cache, then /offline
  if (event.request.mode === "navigate") {
    event.respondWith(networkFirstPage(event.request));
    return;
  }
});

// ── Background Sync ───────────────────────────────────────────────────────────
self.addEventListener("sync", (event) => {
  if (event.tag === "stellar-form-sync") {
    event.waitUntil(replayQueue());
  }
});

// ── Message handler ───────────────────────────────────────────────────────────
self.addEventListener("message", (event) => {
  if (!event.data) return;

  switch (event.data.type) {
    case "SKIP_WAITING":
      self.skipWaiting();
      break;

    // Client enqueues a failed mutation for later replay
    case "ENQUEUE_REQUEST": {
      const { url, method, body, headers } = event.data.payload;
      enqueueRequest({ url, method, body, headers });
      break;
    }

    default:
      break;
  }
});

// ── Caching strategies ────────────────────────────────────────────────────────

/** Stale-while-revalidate: serve cached response immediately, then update cache in background. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkFetch = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || networkFetch;
}

/** Cache-first: serve from cache, fetch & update cache on miss. */
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Nothing we can do for assets — return a minimal error response
    return new Response("", { status: 503 });
  }
}

/** Network-first for API: try network, cache success, fall back to cache or offline JSON. */
async function networkFirstApi(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(API_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    return new Response(JSON.stringify({ offline: true, cached: false }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/** Network-first for pages: try network, cache success, fall back to cache, then /offline. */
async function networkFirstPage(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    // Serve the offline fallback page for any navigation that can't be satisfied
    const offlinePage = await caches.match("/offline");
    if (offlinePage) return offlinePage;

    // Last resort: minimal HTML
    return new Response(
      `<!doctype html><html><head><title>Offline</title></head><body>
        <h1>You are offline</h1>
        <p>Please check your connection and try again.</p>
      </body></html>`,
      { status: 503, headers: { "Content-Type": "text/html" } }
    );
  }
}

// ── Background sync helpers ───────────────────────────────────────────────────

async function enqueueRequest(entry) {
  const db = await openSyncDb();
  const tx = db.transaction(SYNC_QUEUE_KEY, "readwrite");
  tx.objectStore(SYNC_QUEUE_KEY).add({ ...entry, timestamp: Date.now() });
  await tx.complete;
  db.close();
}

async function replayQueue() {
  const db = await openSyncDb();
  const tx = db.transaction(SYNC_QUEUE_KEY, "readwrite");
  const store = tx.objectStore(SYNC_QUEUE_KEY);
  const entries = await storeGetAll(store);

  for (const entry of entries) {
    try {
      const response = await fetch(entry.url, {
        method: entry.method || "POST",
        headers: entry.headers || { "Content-Type": "application/json" },
        body: entry.body,
      });
      if (response.ok) {
        store.delete(entry.id);
      }
    } catch {
      // Leave in queue for next sync attempt
    }
  }

  await tx.complete;
  db.close();

  // Notify all open clients that sync completed
  const clients = await self.clients.matchAll({ type: "window" });
  clients.forEach((client) =>
    client.postMessage({ type: "SYNC_COMPLETE" })
  );
}

/** Minimal IndexedDB wrapper (no idb library dependency). */
function openSyncDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("stellar-sync-db", 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(SYNC_QUEUE_KEY)) {
        db.createObjectStore(SYNC_QUEUE_KEY, {
          keyPath: "id",
          autoIncrement: true,
        });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}

function storeGetAll(store) {
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}
