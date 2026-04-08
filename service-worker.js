// ============================================================
//  FICHAJE LABORAL — service-worker.js  v4.0
//  · Cache First para estáticos / Network Only para API
//  · Geofencing en background (Android) — puente con app.js
//  · Notificación push con acción directa de fichaje
//  · Solo activo Lunes–Viernes
// ============================================================

const CACHE_NAME    = 'fichaje-v4.0';
const STATIC_ASSETS = [
  './index.html', './admin.html', './styles.css',
  './app.js', './admin.js', './manifest.json',
  './icon-192.png', './icon-512.png',
  'https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&display=swap'
];

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzteKSPNkGofqBCWZv7OjkJQ0-AVRXSKrCFHwbIUMgUdTdFsnD_ciWKFnfpN20u0N7qxg/exec';

// ── Estado interno del SW ─────────────────────────────────────
let sw = {
  pin:    null,
  nombre: null,
  estado: null   // 'LIBRE' | 'EN_JORNADA'
};

// ── INSTALL ──────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(
        STATIC_ASSETS.map(url =>
          cache.add(url).catch(e => console.warn('[SW] No cacheable:', url, e))
        )
      )
    ).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
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
    if (req.destination === 'document') return await caches.match('./index.html') || new Response('Sin conexión', { status: 503 });
    return new Response('Sin conexión', { status: 503 });
  }
}

async function staleWhileRevalidate(req) {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  const netP   = fetch(req).then(r => { if (r.ok) cache.put(req, r.clone()); return r; }).catch(() => null);
  return cached || netP;
}

// ════════════════════════════════════════════════════════════
//  MENSAJES DESDE app.js
//  La app envía eventos de geofencing al SW cuando detecta
//  un cambio de zona (entra/sale del radio).
//  El SW se encarga de:
//    1. Fichar directamente en la API (Android background)
//    2. Lanzar notificación para que el usuario confirme (iOS)
// ════════════════════════════════════════════════════════════

self.addEventListener('message', event => {
  const msg = event.data || {};

  switch (msg.tipo) {

    // La app se loguea → guardamos sesión en el SW
    case 'SESION':
      sw.pin    = msg.pin;
      sw.nombre = msg.nombre;
      sw.estado = msg.estado;
      break;

    // El estado cambió (fichaje manual u otro) → sincronizar
    case 'ESTADO':
      sw.estado = msg.estado;
      break;

    // La app detectó cambio de zona y delega al SW
    case 'GEO_EVENTO':
      // msg.dentro: true = entró, false = salió
      // msg.esIOS: true → notificación; false → fichar directo
      manejarGeoEvento(msg);
      break;

    // Logout → limpiar sesión
    case 'LOGOUT':
      sw.pin = sw.nombre = sw.estado = null;
      break;
  }
});

// ── MANEJAR EVENTO DE GEOFENCING ─────────────────────────────
async function manejarGeoEvento({ dentro, esIOS, lat, lng }) {
  if (!sw.pin) return;
  if (!esDiaLaboral()) return;  // ← Solo L–V

  const necesitaEntrada = dentro  && sw.estado === 'LIBRE';
  const necesitaSalida  = !dentro && sw.estado === 'EN_JORNADA';
  if (!necesitaEntrada && !necesitaSalida) return;

  const accion = necesitaEntrada ? 'ENTRADA' : 'SALIDA';
  const emoji  = accion === 'ENTRADA' ? '🟢' : '🔴';
  const titulo = accion === 'ENTRADA' ? `${emoji} Fichaje de entrada` : `${emoji} Fichaje de salida`;
  const cuerpo = accion === 'ENTRADA'
    ? `${sw.nombre} — has llegado a Avance Dental`
    : `${sw.nombre} — has salido de Avance Dental`;

  if (esIOS) {
    // iOS: mostrar notificación — el empleado toca y la app ficha
    await mostrarNotificacion(titulo, cuerpo, accion, lat, lng);
  } else {
    // Android: fichar directo desde el SW sin necesidad de abrir la app
    const ok = await ficharDesdeSW(lat, lng);
    if (ok) {
      // Notificación informativa (no requiere acción)
      await mostrarNotificacion(titulo, cuerpo + ' ✅ Registrado automáticamente', null, lat, lng);
      // Actualizar estado local del SW
      sw.estado = accion === 'ENTRADA' ? 'EN_JORNADA' : 'LIBRE';
      // Avisar a la app si está abierta para que refresque la UI
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(c => c.postMessage({ tipo: 'FICHAJE_AUTO_OK', accion, hora: horaActual() }));
    } else {
      await mostrarNotificacion(`⚠️ Error de fichaje automático`, `Toca para fichar manualmente`, accion, lat, lng);
    }
  }
}

// ── FICHAR DIRECTAMENTE DESDE EL SW (Android) ────────────────
async function ficharDesdeSW(lat, lng) {
  try {
    const body = JSON.stringify({
      accion:           'fichar',
      pin:              sw.pin,
      latitud:          lat || '',
      longitud:         lng || '',
      observaciones:    'Fichaje automático background (SW)',
      timestampCliente: new Date().toISOString(),
      userAgent:        'ServiceWorker'
    });
    const resp = await fetch(APPS_SCRIPT_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body
    });
    const data = await resp.json();
    return data.ok === true;
  } catch (_) {
    return false;
  }
}

// ── MOSTRAR NOTIFICACIÓN ──────────────────────────────────────
async function mostrarNotificacion(titulo, cuerpo, accion, lat, lng) {
  const opciones = {
    body:    cuerpo,
    icon:    './icon-192.png',
    badge:   './icon-192.png',
    vibrate: [100, 50, 100],
    tag:     'fichaje-geo',          // reemplaza la anterior, no apila
    renotify: true,
    data:    { accion, lat, lng },
    ...(accion ? {                   // solo pone botón si hay acción pendiente
      actions: [{ action: 'fichar', title: '✅ Confirmar' }]
    } : {})
  };
  await self.registration.showNotification(titulo, opciones);
}

// ── CLICK EN NOTIFICACIÓN ─────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const { accion, lat, lng } = event.notification.data || {};

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

    if (clients.length > 0) {
      // App abierta en background → enfocar y mandar mensaje para que fiche
      await clients[0].focus();
      clients[0].postMessage({ tipo: 'FICHAR_DESDE_NOTIFICACION', accion, lat, lng });
    } else {
      // App cerrada → abrirla con parámetro, al cargar fichará automáticamente
      await self.clients.openWindow(`./index.html?autofichar=${accion || 'auto'}`);
    }
  })());
});

// ── HELPERS ───────────────────────────────────────────────────

// Devuelve true si hoy es Lunes (1) a Viernes (5)
function esDiaLaboral() {
  const dia = new Date().getDay(); // 0=Dom, 1=Lun, …, 6=Sáb
  return dia >= 1 && dia <= 5;
}

function horaActual() {
  return new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}
