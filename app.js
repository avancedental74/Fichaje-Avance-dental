// ============================================================
//  FICHAJE LABORAL — app.js (Empleado)
//  Versión: 1.0 MVP
//  Conectar APPS_SCRIPT_URL con la URL de tu Web App
// ============================================================

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/TU_DEPLOYMENT_ID/exec';
const EMPRESA_NOMBRE  = 'Mi Empresa';

// ── ESTADO GLOBAL ────────────────────────────────────────────
const State = {
  pin:       null,
  nombre:    null,
  estado:    null,   // LIBRE | EN_JORNADA | JORNADA_CERRADA
  relojTimer: null
};

// ── UTILIDADES ───────────────────────────────────────────────

function toast(msg, tipo = '', duracion = 3000) {
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

function horaActual() {
  const now = new Date();
  const h   = String(now.getHours()).padStart(2, '0');
  const m   = String(now.getMinutes()).padStart(2, '0');
  const s   = String(now.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function haptic() {
  if ('vibrate' in navigator) navigator.vibrate([30]);
}

// ── API ──────────────────────────────────────────────────────

async function apiGet(params) {
  const url = new URL(APPS_SCRIPT_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { method: 'GET' });
  return res.json();
}

async function apiPost(body) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...body,
      userAgent: navigator.userAgent,
      timestampCliente: new Date().toISOString()
    })
  });
  return res.json();
}

// ── APP PRINCIPAL ─────────────────────────────────────────────

const App = {

  // ── INICIALIZACIÓN ─────────────────────────────────────────
  init() {
    // Nombre empresa
    document.getElementById('empresaNombre').textContent = EMPRESA_NOMBRE;
    document.title = `Fichaje — ${EMPRESA_NOMBRE}`;

    // Enter en el PIN
    document.getElementById('pinInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') this.login();
    });

    // Auto-login si hay PIN guardado en sessionStorage
    const pinGuardado = sessionStorage.getItem('fichaje_pin');
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

    if (!pin || pin.length !== 4) {
      error.textContent = 'El PIN debe tener 4 dígitos.';
      error.style.display = 'block';
      pinInput.focus();
      return;
    }

    // UI loading
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

      // Guardamos PIN en session (no en localStorage por privacidad)
      State.pin    = pin;
      State.nombre = resp.data.nombre;
      sessionStorage.setItem('fichaje_pin', pin);

      this.renderEstado(resp.data);
      this.iniciarReloj();
      this.cargarHistorial();
      showPage('page-empleado');
      document.getElementById('logoutBtn').style.display = '';

    } catch(err) {
      error.textContent = 'Error de conexión. Comprueba tu red.';
      error.style.display = 'block';
      console.error(err);
    } finally {
      btn.disabled  = false;
      btn.textContent = 'Acceder';
    }
  },

  // ── LOGOUT ─────────────────────────────────────────────────
  logout() {
    sessionStorage.removeItem('fichaje_pin');
    State.pin    = null;
    State.nombre = null;
    State.estado = null;
    clearInterval(State.relojTimer);
    document.getElementById('pinInput').value = '';
    document.getElementById('logoutBtn').style.display = 'none';
    showPage('page-login');
  },

  // ── CARGAR EMPLEADO (auto-login) ───────────────────────────
  async cargarEmpleado() {
    try {
      const resp = await apiGet({ accion: 'estado', pin: State.pin });
      if (!resp.ok) { this.logout(); return; }
      State.nombre = resp.data.nombre;
      this.renderEstado(resp.data);
      this.iniciarReloj();
      this.cargarHistorial();
      showPage('page-empleado');
      document.getElementById('logoutBtn').style.display = '';
    } catch(_) {
      this.logout();
    }
  },

  // ── RENDER ESTADO ──────────────────────────────────────────
  renderEstado(data) {
    const { estado, nombre, ultimaAccion } = data;
    State.estado = estado;

    // Icono y clase
    const iconEl = document.getElementById('statusIcon');
    iconEl.className = 'status-icon ' +
      (estado === 'LIBRE'         ? 'libre' :
       estado === 'EN_JORNADA'    ? 'en-jornada' : 'cerrada');

    document.getElementById('statusEmoji').textContent =
      estado === 'LIBRE'      ? '🟡' :
      estado === 'EN_JORNADA' ? '🟢' : '🔴';

    // Nombre y label
    document.getElementById('statusNombre').textContent = nombre;
    document.getElementById('statusLabel').textContent =
      estado === 'LIBRE'           ? 'Sin jornada activa' :
      estado === 'EN_JORNADA'      ? 'En jornada' :
      estado === 'JORNADA_CERRADA' ? 'Jornada finalizada hoy' : '';

    // Última acción
    const uaEl = document.getElementById('ultimaAccion');
    if (ultimaAccion) {
      const tipoText = ultimaAccion.tipo === 'ENTRADA' ? 'Entrada registrada' : 'Salida registrada';
      uaEl.textContent = `${tipoText} a las ${ultimaAccion.hora}`;
    } else {
      uaEl.textContent = 'Ningún registro hoy';
    }

    // Botón principal
    const btn         = document.getElementById('fichajeBtn');
    const btnText     = document.getElementById('fichajeBtnText');
    const subTexto    = document.getElementById('fichajeSubtexto');

    if (estado === 'LIBRE') {
      btn.className     = 'btn btn-entrada btn-full';
      btnText.textContent = '▶ Registrar Entrada';
      subTexto.textContent = 'Inicia tu jornada laboral';
      btn.disabled      = false;
    } else if (estado === 'EN_JORNADA') {
      btn.className     = 'btn btn-salida btn-full';
      btnText.textContent = '■ Registrar Salida';
      subTexto.textContent = `Jornada iniciada a las ${ultimaAccion?.hora || '--:--'}`;
      btn.disabled      = false;
    } else {
      btn.className     = 'btn btn-ghost btn-full';
      btnText.textContent = '✓ Jornada completada';
      subTexto.textContent = 'Hasta mañana 👋';
      btn.disabled      = true;
    }
  },

  // ── FICHAJE ────────────────────────────────────────────────
  async fichar() {
    const btn        = document.getElementById('fichajeBtn');
    const btnText    = document.getElementById('fichajeBtnText');
    const loader     = document.getElementById('fichajeLoader');

    btn.disabled     = true;
    loader.style.display  = '';
    btnText.textContent   = 'Registrando...';
    haptic();

    // Geolocalización opcional (no bloqueante)
    let latitud = '', longitud = '';
    try {
      const pos = await new Promise((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 3000 })
      );
      latitud  = pos.coords.latitude;
      longitud = pos.coords.longitude;
    } catch(_) { /* Sin geo, no problema */ }

    try {
      const resp = await apiPost({
        accion:    'fichar',
        pin:       State.pin,
        latitud,
        longitud
      });

      loader.style.display = 'none';

      if (!resp.ok) {
        toast(resp.error || 'No se pudo registrar el fichaje', 'error');
        btn.disabled = false;
        this.renderEstado({ estado: State.estado, nombre: State.nombre });
        return;
      }

      // Mostrar confirmación
      this.mostrarConfirm(resp.data);

      // Recargar estado y historial
      setTimeout(() => {
        this.refrescarEstado();
        this.cargarHistorial();
      }, 500);

    } catch(err) {
      loader.style.display = 'none';
      toast('Error de conexión. Inténtalo de nuevo.', 'error');
      btn.disabled = false;
      console.error(err);
    }
  },

  // ── REFRESCO DE ESTADO ─────────────────────────────────────
  async refrescarEstado() {
    try {
      const resp = await apiGet({ accion: 'estado', pin: State.pin });
      if (resp.ok) this.renderEstado(resp.data);
    } catch(_) {}
  },

  // ── SPLASH DE CONFIRMACIÓN ─────────────────────────────────
  mostrarConfirm(data) {
    const splash  = document.getElementById('confirmSplash');
    const esEntrada = data.tipo === 'ENTRADA';

    document.getElementById('confirmIcon').textContent  = esEntrada ? '✅' : '🔴';
    document.getElementById('confirmTipo').textContent  = esEntrada ? 'ENTRADA REGISTRADA' : 'SALIDA REGISTRADA';
    document.getElementById('confirmHora').textContent  = data.hora;
    document.getElementById('confirmNombre').textContent = data.nombre;
    document.getElementById('confirmTipo').style.color =
      esEntrada ? 'var(--entrada)' : 'var(--salida)';

    splash.className = 'confirm-splash show ' + (esEntrada ? 'entrada' : 'salida');

    haptic();

    // Auto-cerrar en 4 segundos
    clearTimeout(App._confirmTimer);
    App._confirmTimer = setTimeout(() => this.cerrarConfirm(), 4000);
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
      if (!resp.ok) { lista.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div>No se pudo cargar el historial.</div>'; return; }

      const registros = resp.data.registros;
      if (!registros.length) {
        lista.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📋</div>Aún no tienes registros.</div>';
        return;
      }

      // Agrupar por fecha
      const porFecha = {};
      registros.forEach(r => {
        if (!porFecha[r.fecha]) porFecha[r.fecha] = [];
        porFecha[r.fecha].push(r);
      });

      let html = '';
      Object.entries(porFecha).forEach(([fecha, regs], gi) => {
        html += `<div class="section-title" style="margin-top:${gi > 0 ? '16px' : '0'}">${formatFechaLegible(fecha)}</div>`;
        regs.forEach((r, i) => {
          const esEntrada = r.tipo === 'ENTRADA';
          const delay     = (gi * 2 + i) * 60;
          html += `
            <div class="registro-item" style="animation-delay:${delay}ms">
              <div class="registro-icon ${esEntrada ? 'entrada' : 'salida'}">
                ${esEntrada ? '▶' : '■'}
              </div>
              <div class="registro-info">
                <div class="registro-tipo" style="color:${esEntrada ? 'var(--entrada)' : 'var(--salida)'}">
                  ${esEntrada ? 'Entrada' : 'Salida'}
                </div>
                <div class="registro-fecha">${formatFechaLegible(r.fecha)}</div>
              </div>
              <div class="registro-hora">${r.hora}</div>
            </div>`;
        });
      });

      lista.innerHTML = html;

    } catch(err) {
      lista.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⚠️</div>Error al cargar historial.</div>';
      console.error(err);
    }
  },

  // ── RELOJ ──────────────────────────────────────────────────
  iniciarReloj() {
    const el = document.getElementById('relojActual');
    const tick = () => {
      const now = new Date();
      el.textContent = now.toLocaleTimeString('es-ES', {
        hour:   '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    };
    tick();
    clearInterval(State.relojTimer);
    State.relojTimer = setInterval(tick, 1000);
  }

};

// ── ARRANCAR ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
