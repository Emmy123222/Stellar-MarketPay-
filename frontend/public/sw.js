/**
 * Service worker for offline support (Issue #229)
 * Caches static assets, job listings, and user profiles for offline viewing
 */
const CACHE_NAME = "stellar-marketpay-v1";
const ASSET_CACHE = "stellar-assets-v1";
const API_CACHE = "stellar-api-v1";

const urlsToCache = [
  "/",
  "/index.html",
  "/post-job.html",
  "/dashboard.html",
  "/jobs/index.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache).catch(() => {
        // Ignore 404s for optional resources
      });
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== ASSET_CACHE && cacheName !== API_CACHE) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const { url } = event.request;
  const urlObj = new URL(url);

  // Cache static assets
  if (
    urlObj.pathname.match(/\.(js|css|png|jpg|jpeg|svg|woff|woff2)$/) ||
    urlObj.pathname.startsWith("/_next/")
  ) {
    event.respondWith(
      caches.match(event.request).then((response) => {
        return (
          response ||
          fetch(event.request).then((response) => {
            if (response.status === 200) {
              const responseClone = response.clone();
              caches.open(ASSET_CACHE).then((cache) => {
                cache.put(event.request, responseClone);
              });
            }
            return response;
          })
        );
      })
    );
    return;
  }

  // Cache API responses with network-first strategy
  if (urlObj.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(API_CACHE).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request).then((response) => {
            return response || new Response(JSON.stringify({ offline: true }), {
              headers: { "Content-Type": "application/json" },
            });
          });
        })
    );
    return;
  }

  // For pages, use network-first then cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
