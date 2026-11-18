const CACHE_NAME = "savefirst-v2";
const ASSETS_TO_CACHE = ["/", "/dashboard", "/login", "/signup", "/offline", "/manifest.json", "/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    // One by one: addAll is all-or-nothing, and /dashboard redirects when signed out,
    // which would leave even /offline uncached.
    caches.open(CACHE_NAME).then((cache) => Promise.all(ASSETS_TO_CACHE.map((url) => cache.add(url).catch(() => {})))),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        }),
      );
    }),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Network first with fallback to cache for offline resilience
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        return response;
      })
      .catch(async () => {
        // A page that was never cached gets the "You're offline" page instead of the browser's error.
        const cached = await caches.match(event.request);
        if (cached || event.request.mode !== "navigate") return cached;
        return caches.match("/offline");
      }),
  );
});
