// ============================================================
//  FICHAJE LABORAL — service-worker.js (ADMIN)  v5.0
//  Scope: /Fichaje-Avance-dental/admin/
//  Solo cachea los archivos del panel admin
// ============================================================

const CACHE_NAME    = 'fichaje-admin-v5.0';
const STATIC_ASSETS = [
  './admin.html',
  './admin.js',
  './styles.css',
  './manifest-admin.json',
  './admin-icon-192.png',
  './admin-icon-512.png',
  'https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&display=swap'
];

// ── INSTALL ──────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(
        STATIC_ASSETS.map(url =>
          cache.add(url).catch(e => console.warn('[SW Admin] No cacheable:', url, e))
        )
      )
    ).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET') return;
  if (url.hostname.includes('script.google.com')) return;
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request)); return;
  }
  event.respondWith(cacheFirst(request));
});

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const net = await fetch(req);
    if (net.ok) { const c = await caches.open(CACHE_NAME); c.put(req, net.clone()); }
    return net;
  } catch (_) {
    if (req.destination === 'document') return await caches.match('./admin.html') || new Response('Sin conexión', { status: 503 });
    return new Response('Sin conexión', { status: 503 });
  }
}

async function staleWhileRevalidate(req) {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  const netP   = fetch(req).then(r => { if (r.ok) cache.put(req, r.clone()); return r; }).catch(() => null);
  return cached || netP;
}
