// ============================================================
//  FICHAJE LABORAL — service-worker.js
//  Estrategia: Cache First para estáticos, Network First para API
// ============================================================

const CACHE_NAME    = 'fichaje-v2.2';
const STATIC_ASSETS = [
  '/index.html',
  '/admin.html',
  '/styles.css',
  '/app.js',
  '/admin.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&display=swap'
];

// ── INSTALL: precachear estáticos ────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cachear uno a uno para que un fallo no bloquee todo
      return Promise.allSettled(
        STATIC_ASSETS.map(url =>
          cache.add(url).catch(e => console.warn('[SW] No se pudo cachear:', url, e))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: limpiar cachés antiguos ────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: estrategia híbrida ─────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorar peticiones no GET
  if (request.method !== 'GET') return;

  // API de Google Apps Script → Network Only (nunca cachear)
  if (url.hostname.includes('script.google.com') ||
      url.hostname.includes('googleapis.com') && url.pathname.includes('/exec')) {
    return;
  }

  // Google Fonts (CSS) → Stale While Revalidate
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Archivos estáticos propios → Cache First con fallback a red
  event.respondWith(cacheFirst(request));
});

// ── ESTRATEGIAS ───────────────────────────────────────────────

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const network = await fetch(request);
    if (network.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, network.clone());
    }
    return network;
  } catch (_) {
    // Si falla la red y no hay caché, devolver página offline básica si es HTML
    if (request.destination === 'document') {
      const fallback = await caches.match('/index.html');
      if (fallback) return fallback;
    }
    return new Response('Sin conexión', { status: 503 });
  }
}

async function staleWhileRevalidate(request) {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached || networkPromise;
}
