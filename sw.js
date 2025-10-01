const CACHE_NAME = 'cortes-cache-v4';
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest'
];
const NON_CACHE_PATHS = new Set([
  '/login.html',
  '/login2.html',
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

  // Generar íconos PWA en tiempo de ejecución si no existen como archivos
  if (url.pathname.endsWith('/icons/icon-192.png') || url.pathname.endsWith('/icons/icon-512.png')) {
    event.respondWith((async () => {
      const size = url.pathname.endsWith('/icon-512.png') ? 512 : 192;
      try {
        const canvas = new OffscreenCanvas(size, size);
        const ctx = canvas.getContext('2d');
        // Fondo
        ctx.fillStyle = '#0b1222';
        ctx.fillRect(0, 0, size, size);
        // Borde circular suave
        ctx.fillStyle = '#1f2a44';
        ctx.beginPath();
        ctx.arc(size/2, size/2, size*0.48, 0, Math.PI*2);
        ctx.fill();
        // Círculo interior
        ctx.fillStyle = '#22c55e';
        ctx.beginPath();
        ctx.arc(size/2, size/2, size*0.34, 0, Math.PI*2);
        ctx.fill();
        // Marca (sierra estilizada)
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = Math.max(4, size*0.04);
        ctx.lineCap = 'round';
        ctx.beginPath();
        const r = size*0.22;
        for (let i = 0; i < 12; i++) {
          const a = (i/12) * Math.PI * 2;
          const x1 = size/2 + Math.cos(a) * (r*0.7);
          const y1 = size/2 + Math.sin(a) * (r*0.7);
          const x2 = size/2 + Math.cos(a) * (r*1.05);
          const y2 = size/2 + Math.sin(a) * (r*1.05);
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
        }
        ctx.stroke();

        const blob = await canvas.convertToBlob({ type: 'image/png' });
        return new Response(blob, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable' } });
      } catch (e) {
        // Fallback simple: PNG vacío
        return fetch(req).catch(() => new Response('', { headers: { 'Content-Type': 'image/png' } }));
      }
    })());
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
