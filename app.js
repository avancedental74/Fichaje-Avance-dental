// ============================================================
//  FICHAJE LABORAL — app.js (Empleado)
//  Versión: 1.1 — Fixes UX aplicados
// ============================================================

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzteKSPNkGofqBCWZv7OjkJQ0-AVRXSKrCFHwbIUMgUdTdFsnD_ciWKFnfpN20u0N7qxg/exec';
const EMPRESA_NOMBRE  = 'Avance Dental';

// ── GEOFENCING ───────────────────────────────────────────────
const GEO = {
  habilitado:  true,
  lat:         40.5424731,   // Paseo de la Chopera 74, Alcobendas
  lng:         -3.6419531,
  radioMetros: 150,
  watchId:     null
};

// Detecta iPhone/iPad (iOS no permite geo en background en PWAs)
const ES_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

// ── ESTADO GLOBAL ────────────────────────────────────────────
const State = {
  pin:          null,
  nombre:       null,
  estado:       null,   // LIBRE | EN_JORNADA
  turnos:       [],     // [{ entrada: 'HH:MM', salida: 'HH:MM' }, ...]
  relojTimer:   null,
  pollingTimer: null,
  procesoActivo: false,      // Bloqueo para evitar peticiones duplicadas
  ultimoFichajeAuto: 0,      // Timestamp del último fichaje automático
  dentroDelCentro: null, // null = desconocido, true/false cuando tengamos GPS
  recognition:    null   // Objeto de reconocimiento de voz
};

// ── UTILIDADES ───────────────────────────────────────────────

function toast(msg, tipo = '', duracion = 3500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = 'show ' + tipo;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.className = ''; }, duracion);
}

function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function formatFechaLegible(fechaISO) {
  if (!fechaISO) return '';
  const [año, mes, dia] = fechaISO.split('-');
  const meses = ['','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${dia} ${meses[parseInt(mes)]} ${año}`;
}

// FIX M2: Calcular duración entre dos horas "HH:MM:SS"
function calcularDuracion(horaEntrada, horaSalida) {
  if (!horaEntrada || !horaSalida) return null;
  const toSec = h => {
    const [hh, mm, ss = 0] = h.split(':').map(Number);
    return hh * 3600 + mm * 60 + ss;
  };
  const diff = toSec(horaSalida) - toSec(horaEntrada);
  if (diff <= 0) return null;
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

function haptic() {
  if ('vibrate' in navigator) navigator.vibrate([30]);
}

// ── GEOFENCING ───────────────────────────────────────────────

function haversineMetros(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ── GEOFENCING AUTOMÁTICO ─────────────────────────────────────
// Android: watchPosition activo → delega al SW → ficha en background
// iOS:     watchPosition activo → notificación push → empleado toca → ficha
// Ambos:   solo activo Lunes–Viernes

let _geoInicializado = false;

// Devuelve true si hoy es día laborable (L–V)
function esDiaLaboral() {
  const d = new Date().getDay(); // 0=Dom … 6=Sáb
  return d >= 1 && d <= 5;
}

// Pedir permiso de notificaciones (necesario para iOS 16.4+ y Android)
async function pedirPermisoNotificaciones() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied')  return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

// Registrar Periodic Background Sync (solo Chrome Android, PWA instalada)
async function registrarPeriodicSync() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!('periodicSync' in reg)) return;
    // Requiere permiso de notificaciones
    if (Notification.permission !== 'granted') return;
    const tags = await reg.periodicSync.getTags();
    if (!tags.includes('geo-fichaje')) {
      await reg.periodicSync.register('geo-fichaje', { minInterval: 15 * 60 * 1000 });
      console.log('[App] Periodic Background Sync registrado');
    }
  } catch (e) {
    console.warn('[App] Periodic Sync no disponible:', e.message);
  }
}

// Enviar estado actual al Service Worker para que lo tenga en memoria
function sincronizarSW(extraData = {}) {
  if (!navigator.serviceWorker?.controller) return;
  navigator.serviceWorker.controller.postMessage({
    tipo:   'SESION',
    pin:    State.pin,
    nombre: State.nombre,
    estado: State.estado,
    turnos: State.turnos || [],
    ...extraData
  });
}

// Avisar al SW cuando el estado cambia (fichaje manual)
function notificarEstadoSW() {
  if (!navigator.serviceWorker?.controller) return;
  navigator.serviceWorker.controller.postMessage({
    tipo:   'ESTADO',
    estado: State.estado
  });
}

function iniciarGeofencing() {
  if (!GEO.habilitado || !navigator.geolocation) return;
  if (!esDiaLaboral()) {
    actualizarGeoBanner('finde', 0);
    return;
  }
  _geoInicializado = false;

  // Pedir permiso de notificaciones (no bloqueante)
  pedirPermisoNotificaciones();

  // Intentar registrar Periodic Background Sync (Chrome Android)
  registrarPeriodicSync();

  // Sincronizar sesión con el SW
  sincronizarSW();

  // NOTA: el listener 'message' del SW ya está registrado en App.init()
  // No se vuelve a añadir aquí para evitar duplicados en cada login

  // --- LÓGICA CAPACITOR NATIVA (Android APK) ---
  if (window.Capacitor && window.Capacitor.isNativePlatform()) {
    console.log('[Native] Activando BackgroundGeolocation nativo...');
    try {
      const BackgroundGeolocation = window.Capacitor.Plugins.BackgroundGeolocation;
      
      // Detener watchers previos si los hubiera
      if (GEO.nativeWatchId) {
        BackgroundGeolocation.removeWatcher({ id: GEO.nativeWatchId });
      }

      BackgroundGeolocation.addWatcher({
        backgroundMessage: "Rastreo de ubicación activo para el fichaje automático.",
        backgroundTitle: "Fichaje Laboral",
        requestPermissions: true,
        stale: false,
        distanceFilter: 30 // segundos/metros aproximados
      }, (location, error) => {
        if (error) {
          console.error('[Native] Error GPS:', error);
          return;
        }
        if (location) {
          processGeoUpdate(location.latitude, location.longitude);
        }
      }).then(watcherId => {
        GEO.nativeWatchId = watcherId;
      });

      // No necesitamos watchPosition web si estamos en nativo (evitamos consumo doble)
      return;
    } catch (e) {
      console.warn('[Native] Fallo al iniciar plugin nativo, usando fallback web:', e);
    }
  }

  // --- LÓGICA WEB / PWA (Fallback) ---
  const onPos = (pos) => {
    processGeoUpdate(pos.coords.latitude, pos.coords.longitude);
  };

  const onError = () => {
    State.dentroDelCentro = null;
    actualizarGeoBanner(null, null);
  };

  GEO.watchId = navigator.geolocation.watchPosition(onPos, onError, {
    enableHighAccuracy: true,
    maximumAge:  10000,
    timeout:     20000
  });
}

// Función común para procesar coordenadas (Nativas o Web)
function processGeoUpdate(lat, lng) {
  if (!esDiaLaboral()) return;

  const dist   = haversineMetros(lat, lng, GEO.lat, GEO.lng);
  const dentro = dist <= GEO.radioMetros;

  actualizarGeoBanner(dentro, Math.round(dist));

  if (!_geoInicializado) {
    _geoInicializado      = true;
    State.dentonDelCentro = dentro;

    const debeEntrada = dentro  && State.estado === 'LIBRE';
    const debeSalida  = !dentro && State.estado === 'EN_JORNADA';

    if (debeEntrada || debeSalida) {
      if (State.procesoActivo) return; // Ya hay uno en marcha
      
      const ahora = Date.now();
      if (ahora - State.ultimoFichajeAuto < 300000) { // 5 minutos de "enfriamiento"
         console.log('[Geo] Ignorando por periodo de enfriamiento (5 min)');
         return;
      }

      const accion = debeEntrada ? 'ENTRADA' : 'SALIDA';
      toast('📍 Ubicación detectada — Sincronizando fichaje...', '', 5000);
      setTimeout(() => App.ficharAutomatico(accion), 1500);
    }
    return;
  }

  if (dentro === State.dentroDelCentro) return;
  State.dentroDelCentro = dentro;

  const necesitaEntrada = dentro  && State.estado === 'LIBRE';
  const necesitaSalida  = !dentro && State.estado === 'EN_JORNADA';
  
  if (necesitaEntrada) App.ficharAutomatico('ENTRADA');
  if (necesitaSalida)  App.ficharAutomatico('SALIDA');
}

function detenerGeofencing() {
  if (GEO.watchId !== null) {
    navigator.geolocation.clearWatch(GEO.watchId);
    GEO.watchId = null;
  }
  // Detención nativa
  if (window.Capacitor && window.Capacitor.isNativePlatform() && GEO.nativeWatchId) {
    const BackgroundGeolocation = window.Capacitor.Plugins.BackgroundGeolocation;
    BackgroundGeolocation.removeWatcher({ id: GEO.nativeWatchId });
    GEO.nativeWatchId = null;
  }

  navigator.serviceWorker?.removeEventListener?.('message', onMensajeSW);
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage({ tipo: 'LOGOUT' });
  }
  _geoInicializado      = false;
  State.dentroDelCentro = null;
}

// ── MENSAJES RECIBIDOS DESDE EL SW ────────────────────────────
function onMensajeSW(event) {
  const msg = event.data || {};

  // Android: el SW fichó en background → actualizar UI
  if (msg.tipo === 'FICHAJE_AUTO_OK') {
    const nuevoEstado = msg.accion === 'ENTRADA' ? 'EN_JORNADA' : 'LIBRE';
    State.estado = nuevoEstado;
    App.renderEstado({
      estado:       nuevoEstado,
      nombre:       State.nombre,
      ultimaAccion: { tipo: msg.accion, hora: msg.hora }
    });
    App.cargarHistorial();
    const texto = msg.accion === 'ENTRADA'
      ? `✅ Entrada automática registrada a las ${msg.hora}`
      : `✅ Salida automática registrada a las ${msg.hora}`;
    toast(texto, 'success', 6000);
    haptic();
  }

  // iOS: el empleado tocó la notificación → la app está abierta → fichar ahora
  if (msg.tipo === 'FICHAR_DESDE_NOTIFICACION') {
    App.ficharAutomatico(msg.accion);
  }
}

function actualizarGeoBanner(dentro, distMetros) {
  const banner = document.getElementById('geoBanner');
  if (!banner) return;

  if (dentro === 'finde') {
    banner.style.display = '';
    banner.textContent   = '📅 Geofencing inactivo — fin de semana';
    banner.className     = 'geo-banner geo-finde';
    return;
  }
  if (dentro === null) { banner.style.display = 'none'; return; }

  banner.style.display = '';
  if (dentro) {
    banner.textContent = ES_IOS
      ? '📍 En el centro · Recibirás notificación para fichar'
      : '📍 En el centro · Fichaje automático activo';
    banner.className   = 'geo-banner geo-dentro';
  } else {
    banner.textContent = ES_IOS
      ? `📍 Fuera del centro (${distMetros}m) · Notificación automática al salir`
      : `📍 Fuera del centro (${distMetros}m) · Salida automática activa`;
    banner.className   = 'geo-banner geo-fuera';
  }
}

// ── API ──────────────────────────────────────────────────────

// FIX C2: mensajes de error de red diferenciados
async function apiGet(params) {
  const url = new URL(APPS_SCRIPT_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set('t', Date.now()); // CACHE-BUSTER
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url.toString(), { method: 'GET', signal: controller.signal, cache: 'no-store' });
    clearTimeout(timeout);
    return res.json();
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('TIMEOUT');
    throw new Error('NETWORK');
  }
}

async function apiPost(body) {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      signal:  controller.signal,
      body:    JSON.stringify({
        ...body,
        userAgent:        navigator.userAgent,
        timestampCliente: new Date().toISOString()
      })
    });
    clearTimeout(timeout);
    return res.json();
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('TIMEOUT');
    throw new Error('NETWORK');
  }
}

function mensajeError(err) {
  if (err?.message === 'TIMEOUT') return 'El servidor tardó demasiado. Inténtalo en unos segundos.';
  if (err?.message === 'NETWORK') return 'Sin conexión. Comprueba tu red e inténtalo de nuevo.';
  return 'Error inesperado. Inténtalo de nuevo.';
}

// ── APP PRINCIPAL ─────────────────────────────────────────────

const App = {

  // ── INICIALIZACIÓN ─────────────────────────────────────────
  init() {
    document.getElementById('empresaNombre').textContent = EMPRESA_NOMBRE;
    document.title = `Fichaje — ${EMPRESA_NOMBRE}`;

    document.getElementById('pinInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') this.login();
    });

    // Escuchar mensajes del SW (para fichaje desde notificación con app cerrada)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', onMensajeSW);
    }

    // ¿Venimos de una notificación con autofichar pendiente?
    const params      = new URLSearchParams(window.location.search);
    const autofichar  = params.get('autofichar');
    if (autofichar) {
      // Limpiar el parámetro de la URL sin recargar
      history.replaceState({}, '', window.location.pathname);
      // Se fichará automáticamente tras cargar la sesión (ver cargarEmpleado)
      State._autoficharPendiente = autofichar;
    }

    const pinGuardado = localStorage.getItem('fichaje_pin');
    if (pinGuardado) {
      State.pin = pinGuardado;
      this.cargarEmpleado();
    }
  },

  // ── LOGIN ──────────────────────────────────────────────────
  async login() {
    const pinInput = document.getElementById('pinInput');
    const pin      = pinInput.value.trim();
    const btn      = document.getElementById('loginBtn');
    const error    = document.getElementById('loginError');

    // FIX A1/C3: validación clara de formato
    if (!pin || !/^\d{4}$/.test(pin)) {
      error.textContent = 'El PIN debe tener exactamente 4 dígitos numéricos.';
      error.style.display = 'block';
      pinInput.focus();
      return;
    }

    btn.disabled  = true;
    btn.innerHTML = '<span class="loader"></span>';
    error.style.display = 'none';

    try {
      const resp = await apiGet({ accion: 'estado', pin });

      if (!resp.ok) {
        error.textContent = 'PIN incorrecto. Inténtalo de nuevo.';
        error.style.display = 'block';
        pinInput.value = '';
        pinInput.focus();
        return;
      }

      State.pin    = pin;
      State.nombre = resp.data.nombre;
      State.turnos = resp.data.turnos || [];
      localStorage.setItem('fichaje_pin', pin);

      this.renderEstado(resp.data);
      this.iniciarReloj();
      this.cargarHistorial();
      iniciarGeofencing();
      showPage('page-empleado');
      document.getElementById('logoutBtn').style.display = '';
      document.getElementById('voice-btn').style.display = 'flex';

    } catch (err) {
      // FIX C2: mensaje diferenciado
      error.textContent = mensajeError(err);
      error.style.display = 'block';
      console.error(err);
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Acceder';
    }
  },

  // ── LOGOUT ─────────────────────────────────────────────────
  logout() {
    localStorage.removeItem('fichaje_pin');
    State.pin    = null;
    State.nombre = null;
    State.estado = null;
    clearInterval(State.relojTimer);
    clearInterval(State.pollingTimer);
    detenerGeofencing();
    document.getElementById('pinInput').value = '';
    document.getElementById('logoutBtn').style.display = 'none';
    document.getElementById('voice-btn').style.display = 'none';
    showPage('page-login');
    toast('Sesión cerrada. PIN eliminado del dispositivo.', '', 4000);
  },

  // ── CARGAR EMPLEADO (auto-login) ───────────────────────────
  async cargarEmpleado() {
    try {
      const resp = await apiGet({ accion: 'estado', pin: State.pin });

      // PIN incorrecto (empleado eliminado/desactivado) → limpiar sesión
      if (!resp.ok) {
        localStorage.removeItem('fichaje_pin');
        this.logout();
        return;
      }
      State.nombre = resp.data.nombre;
      State.turnos = resp.data.turnos || [];
      this.renderEstado(resp.data);
      this.iniciarReloj();
      this.cargarHistorial();
      iniciarGeofencing();
      showPage('page-empleado');
      document.getElementById('logoutBtn').style.display = '';
      document.getElementById('voice-btn').style.display = 'flex';

      // ¿Venimos de una notificación con fichaje pendiente?
      if (State._autoficharPendiente) {
        const accion = State._autoficharPendiente;
        State._autoficharPendiente = null;
        setTimeout(() => this.ficharAutomatico(accion), 1000);
      }
    } catch (_) {
      // Error de red: NO borrar el PIN — puede ser temporal.
      // La próxima vez que haya conexión se auto-logeará solo.
      showPage('page-login');
      document.getElementById('loginError').textContent = 'Sin conexión. El PIN sigue guardado en el dispositivo.';
      document.getElementById('loginError').style.display = 'block';
    }
  },

  // ── RENDER ESTADO ──────────────────────────────────────────
  renderEstado(data) {
    const { estado, nombre, ultimaAccion } = data;
    State.estado = estado;
    notificarEstadoSW(); // ← mantener SW sincronizado con el estado real

    const iconEl = document.getElementById('statusIcon');
    iconEl.className = 'status-icon ' +
      (estado === 'LIBRE'      ? 'libre' : 'en-jornada');

    document.getElementById('statusEmoji').textContent =
      estado === 'LIBRE'      ? '🟡' : '🟢';

    document.getElementById('statusNombre').textContent = nombre;
    document.getElementById('statusLabel').textContent =
      estado === 'EN_JORNADA' ? 'En jornada' : 'Libre — listo para fichar';

    const uaEl = document.getElementById('ultimaAccion');
    if (ultimaAccion) {
      const tipoText = ultimaAccion.tipo === 'ENTRADA' ? 'Entrada registrada' : 'Salida registrada';
      uaEl.textContent = `${tipoText} a las ${ultimaAccion.hora}`;
    } else {
      uaEl.textContent = 'Ningún registro hoy';
    }

    const btn      = document.getElementById('fichajeBtn');
    const btnText  = document.getElementById('fichajeBtnText');
    const subTexto = document.getElementById('fichajeSubtexto');

    if (estado === 'LIBRE') {
      btn.className        = 'btn btn-entrada btn-full';
      btnText.textContent  = '▶ Registrar Entrada';
      subTexto.textContent = ultimaAccion ? 'Puedes registrar otro turno' : 'Inicia tu jornada laboral';
      btn.disabled         = false;
    } else if (estado === 'EN_JORNADA') {
      btn.className        = 'btn btn-salida btn-full';
      btnText.textContent  = '■ Registrar Salida';
      subTexto.textContent = `Jornada iniciada a las ${ultimaAccion?.hora || '--:--'}`;
      btn.disabled         = false;
    } else {
      btn.className        = 'btn btn-entrada btn-full';
      btnText.textContent  = '▶ Registrar Entrada';
      subTexto.textContent = 'Inicia tu jornada laboral';
      btn.disabled         = false;
    }
  },

  // ── FICHAJE ────────────────────────────────────────────────
  async fichar() {
    const btn     = document.getElementById('fichajeBtn');
    const btnText = document.getElementById('fichajeBtnText');
    const loader  = document.getElementById('fichajeLoader');

    btn.disabled         = true;
    loader.style.display = '';
    btnText.textContent  = 'Registrando...';
    haptic();

    // Geolocalización en paralelo con el timeout de red (no bloquea el botón)
    let latitud = '', longitud = '';
    const geoPromise = new Promise((res) => {
      if (!navigator.geolocation) return res();
      navigator.geolocation.getCurrentPosition(
        pos => { latitud = pos.coords.latitude; longitud = pos.coords.longitude; res(); },
        () => res(),
        { timeout: 4000, maximumAge: 30000 }
      );
      // Si la geo tarda más de 2 s no esperamos — fichamos sin coordenadas
      setTimeout(res, 2000);
    });

    await geoPromise; // máximo 2 s de espera por la geo

    try {
      const resp = await apiPost({ accion: 'fichar', pin: State.pin, latitud, longitud });
      loader.style.display = 'none';

      if (!resp.ok) {
        toast(resp.error || 'No se pudo registrar el fichaje', 'error');
        btn.disabled = false;
        this.renderEstado({ estado: State.estado, nombre: State.nombre });
        return;
      }

      // ACTUALIZAR ESTADO INMEDIATAMENTE con la respuesta
      const tipo = resp.data.tipo;
      // Tras una SALIDA el estado vuelve a LIBRE (jornada partida permitida)
      const nuevoEstado = tipo === 'ENTRADA' ? 'EN_JORNADA' : 'LIBRE';
      this.renderEstado({
        estado: nuevoEstado,
        nombre: State.nombre,
        ultimaAccion: { tipo, hora: resp.data.hora }
      });

      this.mostrarConfirm(resp.data);

      // Refrescar del servidor después de un delay para confirmar.
      // 8 s de espera: Apps Script puede tardar hasta 8-15 s en propagar un appendRow.
      setTimeout(() => {
        this.refrescarEstadoConGuardia(nuevoEstado);
        this.cargarHistorial();
      }, 8000);

    } catch (err) {
      loader.style.display = 'none';
      // FIX C2: mensaje diferenciado
      toast(mensajeError(err), 'error');
      btn.disabled = false;
      console.error(err);
    }
  },

  // ── FICHAJE AUTOMÁTICO (geofencing) ───────────────────────
  // Llamado por el geofencing. tipoEsperado = 'ENTRADA' | 'SALIDA'
  // Verifica de nuevo el estado antes de fichar para evitar duplicados
  // si el botón manual ya fichó mientras tanto.
  async ficharAutomatico(tipoEsperado) {
    if (!State.pin || State.procesoActivo) return;
    State.procesoActivo = true;

    // Doble-check: releer estado del servidor antes de actuar
    try {
      const check = await apiGet({ accion: 'estado', pin: State.pin });
      if (!check.ok) return;
      const estadoActual = check.data.estado;
      // Si ya está en el estado correcto, no hace falta fichar
      if (tipoEsperado === 'ENTRADA' && estadoActual !== 'LIBRE')     return;
      if (tipoEsperado === 'SALIDA'  && estadoActual !== 'EN_JORNADA') return;
      // Actualizar estado local por si el manual lo cambió
      this.renderEstado(check.data);
    } catch (_) { return; }

    // Obtener coordenadas actuales
    let latitud = '', longitud = '';
    try {
      const pos = await new Promise((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 3000, maximumAge: 10000 })
      );
      latitud  = pos.coords.latitude;
      longitud = pos.coords.longitude;
    } catch (_) {}

    try {
      const resp = await apiPost({
        accion: 'fichar', pin: State.pin, latitud, longitud,
        observaciones: 'Fichaje automático por geolocalización'
      });

      if (!resp.ok) {
        toast('⚠️ No se pudo registrar el fichaje automático: ' + (resp.error || ''), 'error', 5000);
        return;
      }

      const tipo       = resp.data.tipo;
      const nuevoEstado = tipo === 'ENTRADA' ? 'EN_JORNADA' : 'LIBRE';
      this.renderEstado({
        estado: nuevoEstado,
        nombre: State.nombre,
        ultimaAccion: { tipo, hora: resp.data.hora }
      });

      State.ultimoFichajeAuto = Date.now();
      const msg = tipo === 'ENTRADA'
        ? `✅ Entrada automática registrada a las ${resp.data.hora}`
        : `✅ Salida automática registrada a las ${resp.data.hora}`;
      toast(msg, 'success', 5000);
      haptic();

      setTimeout(() => {
        this.refrescarEstadoConGuardia(nuevoEstado);
        this.cargarHistorial();
      }, 4000);

    } catch (err) {
      toast('⚠️ Error en fichaje automático: ' + mensajeError(err), 'error', 5000);
      console.error('ficharAutomatico error:', err);
    } finally {
      State.procesoActivo = false;
    }
  },

  // ── RECONOCIMIENTO DE VOZ ───────────────────────────────────
  escucharVoz() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast('⚠️ Tu navegador no soporta reconocimiento de voz', 'error');
      return;
    }

    if (!State.recognition) {
      State.recognition = new SpeechRecognition();
      State.recognition.lang = 'es-ES';
      State.recognition.continuous = false;
      State.recognition.interimResults = false;

      State.recognition.onresult = (event) => {
        const result = event.results[0][0].transcript.toLowerCase();
        document.getElementById('voice-text').textContent = `He entendido: "${result}"`;
        this.procesarComandoVoz(result);
      };

      State.recognition.onerror = () => {
        toast('⚠️ Error al escuchar. Inténtalo de nuevo.', 'error');
        this.cerrarVoz();
      };

      State.recognition.onend = () => {
        setTimeout(() => this.cerrarVoz(), 2000);
      };
    }

    document.getElementById('voice-modal').style.display = 'flex';
    document.getElementById('voice-text').textContent = 'Escuchando...';
    haptic();
    State.recognition.start();
  },

  cerrarVoz() {
    document.getElementById('voice-modal').style.display = 'none';
    if (State.recognition) State.recognition.stop();
  },

  procesarComandoVoz(texto) {
    if (texto.includes('entrada') || texto.includes('entrar') || texto.includes('fichar entrada')) {
      if (State.estado === 'LIBRE') {
        toast('🎙️ Comando voz: ENTRADA', 'success');
        this.fichar();
      } else {
        toast('⚠️ Ya has fichado la entrada', 'warning');
      }
    } else if (texto.includes('salida') || texto.includes('salir') || texto.includes('fichar salida')) {
      if (State.estado === 'EN_JORNADA') {
        toast('🎙️ Comando voz: SALIDA', 'success');
        this.fichar();
      } else {
        toast('⚠️ No has fichado la entrada todavía', 'warning');
      }
    } else {
      toast(`❓ No entiendo "${texto}". Prueba con "Entrada" o "Salida".`, 'info');
    }
  },

  // ── REFRESCO DE ESTADO ─────────────────────────────────────
  async refrescarEstado() {
    try {
      const resp = await apiGet({ accion: 'estado', pin: State.pin });
      if (resp.ok) this.renderEstado(resp.data);
    } catch (_) {}
  },

  // Refresco con guardia — si el servidor aún devuelve el estado anterior
  // (propagación lenta de Apps Script), reintenta hasta 4 veces con guardia.
  // Nunca sobreescribe la UI con un estado incorrecto.
  async refrescarEstadoConGuardia(estadoEsperado, intento = 0) {
    try {
      const resp = await apiGet({ accion: 'estado', pin: State.pin });
      if (!resp.ok) return;
      if (resp.data.estado === estadoEsperado) {
        // Servidor ya refleja el cambio → actualizar la UI con los datos completos
        this.renderEstado(resp.data);
      } else if (intento < 4) {
        // Servidor aún devuelve estado anterior → reintentar CON guardia
        setTimeout(() => this.refrescarEstadoConGuardia(estadoEsperado, intento + 1), 5000);
      }
      // Tras 4 intentos (~28 s total) nos rendimos silenciosamente.
      // El estado local (seteado por renderEstado justo tras fichar) es correcto.
    } catch (_) {}
  },

  // ── SPLASH DE CONFIRMACIÓN ─────────────────────────────────
  mostrarConfirm(data) {
    const splash    = document.getElementById('confirmSplash');
    const esEntrada = data.tipo === 'ENTRADA';

    document.getElementById('confirmIcon').textContent   = esEntrada ? '✅' : '🔴';
    document.getElementById('confirmTipo').textContent   = esEntrada ? 'ENTRADA REGISTRADA' : 'SALIDA REGISTRADA';
    document.getElementById('confirmHora').textContent   = data.hora;
    document.getElementById('confirmNombre').textContent = data.nombre;
    document.getElementById('confirmTipo').style.color   =
      esEntrada ? 'var(--entrada)' : 'var(--salida)';

    splash.className = 'confirm-splash show ' + (esEntrada ? 'entrada' : 'salida');
    haptic();

    // FIX B1: 6 segundos en lugar de 4
    clearTimeout(App._confirmTimer);
    App._confirmTimer = setTimeout(() => this.cerrarConfirm(), 6000);
  },

  cerrarConfirm() {
    document.getElementById('confirmSplash').className = 'confirm-splash';
    clearTimeout(App._confirmTimer);
  },

  // ── HISTORIAL ──────────────────────────────────────────────
  async cargarHistorial() {
    const lista = document.getElementById('historialLista');
    lista.innerHTML = '<div class="loading-overlay"><div class="loader"></div><span>Cargando...</span></div>';

    try {
      const resp = await apiGet({ accion: 'historial', pin: State.pin, limite: 20 });

      if (!resp.ok) {
        lista.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div>No se pudo cargar el historial.</div>';
        return;
      }

      const registros = resp.data.registros;
      if (!registros.length) {
        // FIX M4: empty state con instrucción útil
        lista.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div>Cuando registres tu primera entrada, aparecerá aquí.</div>';
        return;
      }

      // Agrupar por fecha
      const porFecha = {};
      registros.forEach(r => {
        if (!porFecha[r.fecha]) porFecha[r.fecha] = [];
        porFecha[r.fecha].push(r);
      });

      // FIX XSS: construir el DOM con createElement — los valores del servidor
      // se asignan con textContent y nunca se interpretan como HTML.
      const fragment = document.createDocumentFragment();

      Object.entries(porFecha).forEach(([fecha, regs], gi) => {
        const tituloEl = document.createElement('div');
        tituloEl.className = 'section-title';
        tituloEl.style.marginTop = gi > 0 ? '16px' : '0';
        tituloEl.textContent = formatFechaLegible(fecha); // función pura, solo letras y números

        fragment.appendChild(tituloEl);

        // Calcular duración de jornada por día
        const entradas = regs.filter(r => r.tipo === 'ENTRADA');
        const salidas  = regs.filter(r => r.tipo === 'SALIDA');
        if (entradas.length && salidas.length) {
          const duracion = calcularDuracion(entradas[0].hora, salidas[salidas.length - 1].hora);
          if (duracion) {
            const durEl = document.createElement('div');
            durEl.className = 'duracion-jornada';
            durEl.textContent = `⏱ Jornada: ${duracion}`;
            fragment.appendChild(durEl);
          }
        }

        regs.forEach((r, i) => {
          const esEntrada = r.tipo === 'ENTRADA';
          const delay     = (gi * 2 + i) * 60;

          const item = document.createElement('div');
          item.className = 'registro-item';
          item.style.animationDelay = `${delay}ms`;

          const icon = document.createElement('div');
          icon.className = `registro-icon ${esEntrada ? 'entrada' : 'salida'}`;
          icon.textContent = esEntrada ? '▶' : '■';

          const info = document.createElement('div');
          info.className = 'registro-info';

          const tipoEl = document.createElement('div');
          tipoEl.className = 'registro-tipo';
          tipoEl.style.color = esEntrada ? 'var(--entrada)' : 'var(--salida)';
          tipoEl.textContent = esEntrada ? 'Entrada' : 'Salida';

          const fechaEl = document.createElement('div');
          fechaEl.className = 'registro-fecha';
          fechaEl.textContent = formatFechaLegible(r.fecha);

          info.appendChild(tipoEl);
          info.appendChild(fechaEl);

          const horaEl = document.createElement('div');
          horaEl.className = 'registro-hora';
          horaEl.textContent = r.hora; // textContent — nunca innerHTML

          item.appendChild(icon);
          item.appendChild(info);
          item.appendChild(horaEl);
          fragment.appendChild(item);
        });
      });

      lista.innerHTML = '';
      lista.appendChild(fragment);

    } catch (err) {
      lista.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚠️</div>Error al cargar historial.</div>';
      console.error(err);
    }
  },

  // ── RELOJ ──────────────────────────────────────────────────
  iniciarReloj() {
    const el   = document.getElementById('relojActual');
    const tick = () => {
      el.textContent = new Date().toLocaleTimeString('es-ES', {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    };
    tick();
    clearInterval(State.relojTimer);
    State.relojTimer = setInterval(tick, 1000);
  }

};

// ── ARRANCAR ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
