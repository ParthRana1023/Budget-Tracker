// SaveFirst service worker.
//
// Version: PwaRegister registers /sw.js?v=<build id>, so every deploy installs a new worker with
// its own cache, and the old cache is deleted when it activates. A new worker waits until the
// user taps "Refresh" on the update toast (message SKIP_WAITING).
//
// Caching: only files that are the same for everyone. Build assets (/_next/static, hashed) and
// icons/fonts are stale-while-revalidate. Pages, API routes and Supabase are never cached, so a
// shared device never shows the last person's money; offline navigation gets /offline.

const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const CACHE = `savefirst-${VERSION}`;
const PRECACHE = ["/offline", "/manifest.json", "/icon.svg", "/android-chrome-192x192.png"];
const STATIC = /^\/_next\/static\/|\.(?:png|svg|ico|webp|woff2)$/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    // One by one: addAll is all-or-nothing, and one failure shouldn't leave /offline uncached.
    caches.open(CACHE).then((cache) => Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {})))),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase, analytics: straight to the network

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(() => caches.match("/offline").then((r) => r || Response.error())));
    return;
  }
  if (!STATIC.test(url.pathname) || url.pathname.startsWith("/api/")) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req);
      const fresh = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached || Response.error());
      if (cached) event.waitUntil(fresh.catch(() => {}));
      return cached || fresh;
    }),
  );
});

// ---------------------------------------------------------------- Web Push
// Payload from send-notifications or /api/push/test: { title, body, url, tag, actions? }.
// Actions ("Record it" on bill reminders, "Mark paid" on card bills) open the same page as tapping.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data?.text() };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "SaveFirst", {
      body: data.body || "",
      icon: "/android-chrome-192x192.png",
      badge: "/badge-96.png", // the mark in white, for the Android status bar
      tag: data.tag,
      actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : [],
      data: { url: data.url || "/dashboard" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Same-origin paths only, so a payload can't send the user to another site.
  const target = new URL(event.notification.data?.url || "/dashboard", self.location.origin);
  const url = target.origin === self.location.origin ? target.href : `${self.location.origin}/dashboard`;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) {
        await open.focus();
        return open.navigate(url).catch(() => {});
      }
      return self.clients.openWindow(url);
    }),
  );
});
