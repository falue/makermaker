// Offline support: precache the built app, then serve from cache and refresh in the background.
const CACHE = 'makermaker';

self.addEventListener('install', (e) => {
  e.waitUntil(
    fetch('precache.json')
      .then((r) => r.json())
      .then((files) => caches.open(CACHE).then((c) => c.addAll(files))),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(e.request, { ignoreSearch: true, ignoreVary: true });
      const fresh = fetch(e.request).then((res) => {
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      });
      if (!hit) return fresh;
      fresh.catch(() => {});
      return hit;
    }),
  );
});
