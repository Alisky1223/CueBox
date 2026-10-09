// Serves the app from cache so it works offline; refreshes the cache in the background on each load.
const CACHE = "cuebox";
const ASSETS = ["./", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET" || new URL(request.url).origin !== location.origin) return;
  // Every page URL (including "./?…" from launches) is the same single-file app.
  const key = request.mode === "navigate" ? "./" : request;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(key);
      const fresh = fetch(request, { cache: "no-cache" })
        .then((res) => {
          if (res.ok) cache.put(key, res.clone());
          return res;
        })
        .catch(() => cached);
      if (cached) e.waitUntil(fresh);
      return cached ?? fresh;
    }),
  );
});
