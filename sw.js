const CACHE_NAME = 'cortes-cache-v4';
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/pcicon.jpeg'
];
const NON_CACHE_PATHS = new Set([
  '/login.html',
  '/auth.js',
  '/auth-callback.html'
]);

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys => Promise.all(keys.map(k => k !== CACHE_NAME && caches.delete(k)))),
      self.clients.claim()
    ])
  );
});

const NETWORK_TIMEOUT_MS = 10000;

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (NON_CACHE_PATHS.has(url.pathname)) {
    event.respondWith(fetch(req));
    return;
  }

  const cacheFallback = () => caches.match(req).then((cached) => cached || fetch('./index.html'));

  event.respondWith((async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
      const response = await fetch(req, { signal: controller.signal });
      clearTimeout(timeout);
      if (response && response.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, response.clone());
      }
      return response;
    } catch (_) {
      return cacheFallback();
    }
  })());
});
