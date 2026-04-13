// ============================================================
//  FICHAJE LABORAL — service-worker.js (ADMIN)  v6.0
//  Scope: /Fichaje-Avance-dental/admin/
// ============================================================

const CACHE_NAME    = 'fichaje-admin-v6.0';
const STATIC_ASSETS = [
  './admin.html',
  './admin.js',
  '../styles.css',
  './manifest-admin.json',
  './admin-icon-192.png',
  'https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&display=swap'
];

// ── INSTALL ──────────────────────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(
        STATIC_ASSETS.map(url =>
          cache.add(url).catch(e => console.warn('[SW Admin] No cacheable:', url, e))
        )
      )
    )
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(k => {
        if (k !== CACHE_NAME) return caches.delete(k);
      })
    )).then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // No cachear POST ni peticiones al backend de Google
  if (request.method !== 'GET' || url.hostname.includes('script.google.com')) return;

  // Estrategia: Network First para archivos críticos, Cache First para el resto
  if (url.pathname.endsWith('admin.html') || url.pathname.endsWith('admin.js')) {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(cacheFirst(request));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(req);
    if (fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (e) {
    const cached = await cache.match(req);
    return cached || new Response('Sin conexión', { status: 503 });
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(req);
    if (fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch (e) {
    return new Response('Sin conexión', { status: 503 });
  }
}
