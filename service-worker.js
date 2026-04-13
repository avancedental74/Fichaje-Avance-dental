// ============================================================
//  FICHAJE LABORAL — service-worker.js  v5.0
//  · Cache First para estáticos / Network Only para API
//  · Geofencing en background (Android) — puente con app.js
//  · Notificación push con acción directa de fichaje
//  · Periodic Background Sync con ventanas de horario por empleado
//  · Solo activo Lunes–Viernes, dentro de ventanas de turno
// ============================================================

const CACHE_NAME    = 'fichaje-v4.0-final';
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
  estado: null,   // 'LIBRE' | 'EN_JORNADA'
  turnos: []      // [{ entrada: 'HH:MM', salida: 'HH:MM' }, ...]
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
      .then(() => {
        self.clients.claim();
        // Registrar Periodic Background Sync si el navegador lo soporta
        registrarPeriodicSync();
      })
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
//  PERIODIC BACKGROUND SYNC
//  Chrome Android despierta el SW cada ~15 min si la PWA
//  está instalada. El SW comprueba si estamos en una ventana
//  de turno activa y, si es así, verifica GPS y ficha.
// ════════════════════════════════════════════════════════════

const PBS_TAG = 'geo-fichaje';

// Minutos de tolerancia antes de lanzar alerta por no-fichaje (configurable)
const ALERTA_RETRASO_MIN = 15;

async function registrarPeriodicSync() {
  try {
    const reg = await self.registration;
    if (!('periodicSync' in reg)) return;
    const tags = await reg.periodicSync.getTags();
    if (!tags.includes(PBS_TAG)) {
      await reg.periodicSync.register(PBS_TAG, { minInterval: 15 * 60 * 1000 });
      console.log('[SW] Periodic Background Sync registrado:', PBS_TAG);
    }
  } catch (e) {
    console.warn('[SW] Periodic Sync no disponible:', e.message);
  }
}

self.addEventListener('periodicsync', event => {
  if (event.tag === PBS_TAG) {
    event.waitUntil(
      Promise.all([
        comprobarGeoYFichar(),
        comprobarAlertaNoFichaje()
      ])
    );
  }
});

// ── Alerta al empleado (y al admin) si lleva más de ALERTA_RETRASO_MIN
//    minutos sin fichar la entrada estando dentro de la ventana de turno ──
async function comprobarAlertaNoFichaje() {
  if (!sw.pin) return;
  if (!esDiaLaboral()) return;

  // Solo aplica si el empleado está LIBRE (no ha entrado aún hoy)
  if (sw.estado !== 'LIBRE') return;

  const ahora = minutosDesdeMedianoche(new Date());

  for (const turno of (sw.turnos || [])) {
    if (!turno.entrada) continue;
    const minutosEntrada = horaAMinutos(turno.entrada);

    // El umbral empieza a contar desde la hora exacta de entrada
    const retraso = ahora - minutosEntrada;
    if (retraso < ALERTA_RETRASO_MIN) continue;

    // Solo lanzar la alerta una vez por ciclo de 30 min para no spamear:
    // guardamos la última hora de alerta en IDB con clave por turno+día
    const hoy       = new Date().toISOString().slice(0, 10);
    const alertaKey = `alerta_nofichaje_${sw.pin}_${hoy}_${turno.entrada}`;
    const yaAlertado = await leerDeIDB(alertaKey);
    if (yaAlertado) continue;

    // Marcar como alertado para no repetir hasta el día siguiente
    await guardarEnIDB(alertaKey, true);

    // 1. Notificación push al empleado
    await mostrarNotificacion(
      '⚠️ No has fichado tu entrada',
      `${sw.nombre} — llevas ${retraso} min de retraso. Toca para fichar.`,
      'ENTRADA', null, null
    );

    // 2. Señal al servidor para que el admin lo vea en el panel
    try {
      await fetch(APPS_SCRIPT_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body:    JSON.stringify({
          accion:           'alerta_no_fichaje',
          pin:              sw.pin,
          turnoEntrada:     turno.entrada,
          minutosRetraso:   retraso,
          timestampCliente: new Date().toISOString()
        })
      });
    } catch (_) {
      // El POST puede fallar sin red — la notificación local ya se lanzó
    }
  }
}

// ── Lógica principal del sync periódico ──────────────────────
// Funciona SIN app abierta (Periodic Background Sync, Chrome Android).
// También funciona cuando la app está abierta (el SW se ejecuta siempre).
async function comprobarGeoYFichar() {
  // Sin sesión → intentar cargar de IDB (persiste entre ejecuciones del SW)
  if (!sw.pin) {
    await cargarSesionDeIDB();
    if (!sw.pin) return;
  }

  if (!esDiaLaboral()) return;

  const ventana     = calcularVentanaActual(sw.turnos);
  const tieneTurnos = sw.turnos && sw.turnos.length > 0;

  // ── Determinar qué tipo de fichaje se espera ────────────────
  // Con turnos → respetar ventana horaria (fuera de ella, ignorar)
  // Sin turnos → basar en estado actual (LIBRE→ENTRADA, EN_JORNADA→SALIDA)
  let tipoEsperado;
  if (ventana) {
    tipoEsperado = ventana.tipo;
  } else if (!tieneTurnos) {
    if      (sw.estado === 'LIBRE')      tipoEsperado = 'ENTRADA';
    else if (sw.estado === 'EN_JORNADA') tipoEsperado = 'SALIDA';
    else return;
  } else {
    return; // Tiene turnos pero está fuera de ventana horaria → ignorar
  }

  // Verificar que el estado actual requiere ese fichaje
  const necesita = tipoEsperado === 'ENTRADA'
    ? sw.estado === 'LIBRE'
    : sw.estado === 'EN_JORNADA';
  if (!necesita) return;

  console.log(`[SW] Periodic sync → tipoEsperado=${tipoEsperado}, estado=${sw.estado}`);

  // Obtener posición GPS
  let lat = null, lng = null;
  try {
    const pos = await obtenerPosicion();
    lat = pos.coords.latitude;
    lng = pos.coords.longitude;
  } catch (_) {
    // Sin GPS → notificación para fichaje manual
    await mostrarNotificacion(
      tipoEsperado === 'ENTRADA' ? '🟢 Hora de fichar entrada' : '🔴 Hora de fichar salida',
      `${sw.nombre} — toca para registrar tu ${tipoEsperado.toLowerCase()}`,
      tipoEsperado, null, null
    );
    return;
  }

  // 1. Verificar distancia
  const dist = haversineMetros(lat, lng, GEO_LAT, GEO_LNG);
  
  // MARGEN DE SEGURIDAD (igual que app.js)
  const radioEntrada = GEO_RADIO;
  const radioSalida  = GEO_RADIO + 100;

  // 2. LÓGICA DE RECORDATORIOS (Proactiva para Android)
  if (ventana.tipo === 'ENTRADA') {
    if (dist <= radioEntrada) {
      await mostrarNotificacion(
        '🟢 ¿Quieres fichar la entrada?',
        `${sw.nombre} — Ya estás en el centro. Toca para registrar tu entrada.`,
        'ENTRADA', lat, lng
      );
    }
    return;
  }

  if (ventana.tipo === 'SALIDA') {
    if (dist <= radioSalida) {
      await mostrarNotificacion(
        '🔴 ¿Has terminado tu jornada?',
        `${sw.nombre} — Sigues en el centro. No olvides fichar tu salida.`,
        'SALIDA', lat, lng
      );
    } else {
      // Alejamiento confirmado -> Fichaje auto
      await ficharDeFormaAutomatica('SALIDA', lat, lng);
    }
    return;
  }
}

async function ficharDeFormaAutomatica(tipo, lat, lng) {
  const ok = await ficharDesdeSW(lat, lng, `Fichaje auto por alejamiento (${tipo})`);
  if (ok) {
    sw.estado = (tipo === 'ENTRADA' ? 'EN_JORNADA' : 'LIBRE');
    await guardarEstadoEnIDB(sw.estado);
    await mostrarNotificacion(
      tipo === 'ENTRADA' ? '🟢 Entrada automática' : '🔴 Salida automática',
      `${sw.nombre} — Has fichado automáticamente al salir ✅`,
      null, lat, lng
    );
  }
}

// ── Calcular ventana de turno activa ─────────────────────────
// Devuelve { tipo: 'ENTRADA'|'SALIDA', entrada, salida } o null si no hay ventana activa.
// Ventana de ENTRADA: [turnoEntrada - 15min, turnoEntrada + 60min]
// Ventana de SALIDA:  [turnoSalida  - 60min, turnoSalida  + 60min]
function calcularVentanaActual(turnos) {
  if (!turnos || !turnos.length) return null;

  const ahora = minutosDesdeMedianoche(new Date());

  for (const turno of turnos) {
    if (!turno.entrada || !turno.salida) continue;

    const entrada = horaAMinutos(turno.entrada);
    const salida  = horaAMinutos(turno.salida);

    // Ventana de entrada: 15 min antes → 60 min después de la hora de entrada
    if (ahora >= entrada - 15 && ahora <= entrada + 60) {
      return { tipo: 'ENTRADA', entrada: turno.entrada, salida: turno.salida };
    }

    // Ventana de salida: 60 min antes → 60 min después de la hora de salida
    if (ahora >= salida - 60 && ahora <= salida + 60) {
      return { tipo: 'SALIDA', entrada: turno.entrada, salida: turno.salida };
    }
  }

  return null;
}

// ── Persistencia en IndexedDB ─────────────────────────────────
// El SW pierde variables cuando se para. IDB garantiza
// que la sesión sobrevive entre ciclos de vida del SW.

const IDB_NAME    = 'fichaje-sw-db';
const IDB_STORE   = 'sesion';
const IDB_VERSION = 1;

function abrirIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function guardarEnIDB(key, value) {
  try {
    const db  = await abrirIDB();
    const tx  = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
  } catch (_) {}
}

async function leerDeIDB(key) {
  try {
    const db  = await abrirIDB();
    const tx  = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    return new Promise((res, rej) => {
      req.onsuccess = () => res(req.result ?? null);
      req.onerror   = rej;
    });
  } catch (_) { return null; }
}

async function cargarSesionDeIDB() {
  const sesion = await leerDeIDB('sesion');
  if (sesion) {
    sw.pin    = sesion.pin    || null;
    sw.nombre = sesion.nombre || null;
    sw.estado = sesion.estado || null;
    sw.turnos = sesion.turnos || [];
  }
}

async function guardarSesionEnIDB() {
  await guardarEnIDB('sesion', {
    pin:    sw.pin,
    nombre: sw.nombre,
    estado: sw.estado,
    turnos: sw.turnos
  });
}

async function guardarEstadoEnIDB(estado) {
  sw.estado = estado;
  await guardarSesionEnIDB();
}

// ── Geofencing config ─────────────────────────────────────────
// Valores por defecto (fallback). La fuente de verdad es app.js:
// cuando envía el mensaje SESION, puede incluir geoLat/geoLng/geoRadio
// y el SW los adopta sin necesidad de modificar este archivo.
let GEO_LAT   = 40.5424731;
let GEO_LNG   = -3.6419531;
let GEO_RADIO = 150;

function haversineMetros(lat1, lng1, lat2, lng2) {
  const R    = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat/2)**2 +
               Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
               Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function obtenerPosicion() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000
    });
  });
}

// ════════════════════════════════════════════════════════════
//  MENSAJES DESDE app.js
// ════════════════════════════════════════════════════════════

self.addEventListener('message', event => {
  const msg = event.data || {};

  switch (msg.tipo) {

    // La app se loguea → guardamos sesión en el SW y en IDB
    case 'SESION':
      sw.pin    = msg.pin;
      sw.nombre = msg.nombre;
      sw.estado = msg.estado;
      sw.turnos = msg.turnos || [];
      // Coordenadas de geofencing: si app.js las envía, el SW las adopta.
      // Así un cambio de dirección solo requiere editar app.js.
      if (msg.geoLat   != null) GEO_LAT   = msg.geoLat;
      if (msg.geoLng   != null) GEO_LNG   = msg.geoLng;
      if (msg.geoRadio != null) GEO_RADIO = msg.geoRadio;
      guardarSesionEnIDB();
      // Intentar registrar periodic sync si aún no está registrado
      registrarPeriodicSync();
      break;

    // El estado cambió (fichaje manual u otro) → sincronizar
    case 'ESTADO':
      sw.estado = msg.estado;
      guardarEstadoEnIDB(msg.estado);
      break;

    // La app detectó cambio de zona y delega al SW
    case 'GEO_EVENTO':
      manejarGeoEvento(msg);
      break;

    // Logout → limpiar sesión
    case 'LOGOUT':
      sw.pin = sw.nombre = sw.estado = null;
      sw.turnos = [];
      guardarSesionEnIDB();
      break;
  }
});

// ── MANEJAR EVENTO DE GEOFENCING (watchPosition activo) ──────
async function manejarGeoEvento({ dentro, esIOS, lat, lng }) {
  if (!sw.pin) return;
  if (!esDiaLaboral()) return;

  // Comprobar ventana activa antes de actuar.
  // Si el empleado TIENE turnos configurados y estamos FUERA de su ventana horaria,
  // ignorar el evento para evitar fichajes a horas no laborales.
  // Si NO tiene turnos configurados, se permite fichar según el estado (LIBRE/EN_JORNADA).
  const ventana     = calcularVentanaActual(sw.turnos);
  const tieneTurnos = sw.turnos && sw.turnos.length > 0;
  if (tieneTurnos && !ventana) return; // fuera de ventana → ignorar

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
    await mostrarNotificacion(titulo, cuerpo, accion, lat, lng);
  } else {
    const ok = await ficharDesdeSW(lat, lng, 'Fichaje automático geofencing (watchPosition)');
    if (ok) {
      await mostrarNotificacion(titulo, cuerpo + ' ✅ Registrado automáticamente', null, lat, lng);
      sw.estado = accion === 'ENTRADA' ? 'EN_JORNADA' : 'LIBRE';
      guardarEstadoEnIDB(sw.estado);
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(c => c.postMessage({ tipo: 'FICHAJE_AUTO_OK', accion, hora: horaActual() }));
    } else {
      await mostrarNotificacion(`⚠️ Error de fichaje automático`, `Toca para fichar manualmente`, accion, lat, lng);
    }
  }
}

// ── FICHAR DIRECTAMENTE DESDE EL SW ──────────────────────────
async function ficharDesdeSW(lat, lng, observaciones) {
  try {
    const body = JSON.stringify({
      accion:           'fichar',
      pin:              sw.pin,
      latitud:          lat || '',
      longitud:         lng || '',
      observaciones:    observaciones || 'Fichaje automático background (SW)',
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
    tag:     'fichaje-geo',
    renotify: true,
    data:    { accion, lat, lng },
    ...(accion ? {
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
      await clients[0].focus();
      clients[0].postMessage({ tipo: 'FICHAR_DESDE_NOTIFICACION', accion, lat, lng });
    } else {
      await self.clients.openWindow(`./index.html?autofichar=${accion || 'auto'}`);
    }
  })());
});

// ── HELPERS ───────────────────────────────────────────────────

function esDiaLaboral() {
  const dia = new Date().getDay();
  return dia >= 1 && dia <= 5;
}

function horaActual() {
  return new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

// Convierte "HH:MM" → minutos desde medianoche
function horaAMinutos(horaStr) {
  if (!horaStr) return 0;
  const [h, m] = horaStr.split(':').map(Number);
  return h * 60 + m;
}

// Minutos desde medianoche de una fecha dada
function minutosDesdeMedianoche(date) {
  return date.getHours() * 60 + date.getMinutes();
}

