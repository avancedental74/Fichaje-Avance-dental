// ============================================================
//  FICHAJE LABORAL — admin.js (Panel Administrador)
//  v3.0 — PWA ready · iOS + Android optimizado
// ============================================================

// ⚠️ CAMBIA ESTA URL por la URL de tu Web App de Google Apps Script
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzteKSPNkGofqBCWZv7OjkJQ0-AVRXSKrCFHwbIUMgUdTdFsnD_ciWKFnfpN20u0N7qxg/exec';

// ── ESTADO ADMIN ─────────────────────────────────────────────
const AdminState = {
  pinAdmin:     null,
  empleados:    [],
  registros:    [],
  tabActual:    'registros',
  sortCol:      null,
  sortDir:      'asc',
  pollingTimer: null
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
  if (!fechaISO) return '—';
  const [año, mes, dia] = String(fechaISO).split('-');
  const meses = ['','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${dia} ${meses[parseInt(mes)]} ${año}`;
}

function fechaHoy() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

function mensajeError(err) {
  if (err?.message === 'TIMEOUT') return 'El servidor tardó demasiado. Inténtalo en unos segundos.';
  if (err?.message === 'NETWORK') return 'Sin conexión. Comprueba tu red e inténtalo de nuevo.';
  return 'Error inesperado. Inténtalo de nuevo.';
}

function haptic(pattern = [25]) {
  if ('vibrate' in navigator) navigator.vibrate(pattern);
}

function lockBodyScroll()   { document.body.style.overflow = 'hidden'; }
function unlockBodyScroll() { document.body.style.overflow = ''; }

// ── API ──────────────────────────────────────────────────────

async function apiGet(params) {
  const url = new URL(APPS_SCRIPT_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
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
  const timeout    = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  controller.signal,
      body:    JSON.stringify(body)
    });
    clearTimeout(timeout);
    return res.json();
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('TIMEOUT');
    throw new Error('NETWORK');
  }
}

// ── PWA — SERVICE WORKER ─────────────────────────────────────
function registrarServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js')
        .then(reg => {
          reg.addEventListener('updatefound', () => {
            const nw = reg.installing;
            nw.addEventListener('statechange', () => {
              if (nw.state === 'installed' && navigator.serviceWorker.controller) {
                toast('🔄 Nueva versión disponible. Recarga para actualizar.', '', 8000);
              }
            });
          });
        })
        .catch(err => console.warn('[SW] Error al registrar:', err));
    });
  }
}

// ── BOOTSTRAP: comprueba si existe admin al cargar ──────────

async function checkSetup() {
  try {
    const resp = await apiGet({ accion: 'check_setup' });
    if (resp.ok && !resp.data.adminExists) {
      showPage('page-setup');
    } else {
      const pinGuardado = sessionStorage.getItem('admin_pin');
      if (pinGuardado) {
        document.getElementById('adminPinInput').value = pinGuardado;
        Admin.login();
      } else {
        showPage('page-admin-login');
        setTimeout(() => document.getElementById('adminPinInput').focus(), 350);
      }
    }
  } catch (_) {
    showPage('page-admin-login');
  }
}

// ── SETUP — Crear primer administrador ──────────────────────

const Setup = {
  async crear() {
    const secret = document.getElementById('setupSecret').value.trim();
    const nombre = document.getElementById('setupNombre').value.trim();
    const pin    = document.getElementById('setupPin').value.trim();
    const email  = document.getElementById('setupEmail').value.trim();
    const error  = document.getElementById('setupError');
    const btn    = document.getElementById('setupBtn');

    if (!secret) {
      error.textContent   = 'Introduce la clave de instalación.';
      error.style.display = 'block';
      return;
    }
    if (!nombre || nombre.length < 2) {
      error.textContent   = 'El nombre es obligatorio.';
      error.style.display = 'block';
      return;
    }
    if (!/^\d{4,6}$/.test(pin)) {
      error.textContent   = 'El PIN debe tener entre 4 y 6 dígitos numéricos.';
      error.style.display = 'block';
      return;
    }

    btn.disabled        = true;
    btn.innerHTML       = '<span class="loader"></span> Creando...';
    error.style.display = 'none';

    try {
      const resp = await apiPost({
        accion:          'bootstrap_admin',
        bootstrapSecret: secret,
        nombre,
        pin,
        email
      });

      if (!resp.ok) {
        error.textContent   = resp.error || 'Error al crear el administrador.';
        error.style.display = 'block';
        return;
      }

      AdminState.pinAdmin = pin;
      sessionStorage.setItem('admin_pin', pin);
      toast('✅ Administrador creado. Bienvenido/a.', 'success', 5000);
      await Admin.cargarDashboard();
      showPage('page-admin-dashboard');
      document.getElementById('adminLogoutBtn').style.display = '';

    } catch (err) {
      error.textContent   = mensajeError(err);
      error.style.display = 'block';
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Crear administrador';
    }
  }
};

// ── ADMIN PRINCIPAL ──────────────────────────────────────────

const Admin = {

  // ── LOGIN ──────────────────────────────────────────────────
  async login() {
    const pinInput = document.getElementById('adminPinInput');
    const pin      = pinInput.value.trim();
    const btn      = document.getElementById('adminLoginBtn');
    const error    = document.getElementById('adminLoginError');

    if (!pin || pin.length < 4) {
      error.textContent   = 'Introduce tu PIN de administrador.';
      error.style.display = 'block';
      pinInput.focus();
      haptic([30, 30, 30]);
      return;
    }

    btn.disabled        = true;
    btn.innerHTML       = '<span class="loader"></span>';
    error.style.display = 'none';

    try {
      const resp = await apiGet({ accion: 'admin_empleados', pinAdmin: pin });

      if (!resp.ok) {
        sessionStorage.removeItem('admin_pin');
        error.textContent   = 'PIN de administrador incorrecto.';
        error.style.display = 'block';
        pinInput.value      = '';
        pinInput.focus();
        haptic([50, 30, 50]);
        return;
      }

      AdminState.pinAdmin  = pin;
      AdminState.empleados = resp.data.empleados;
      sessionStorage.setItem('admin_pin', pin);

      this.inicializar(resp.data.empleados);
      showPage('page-admin-dashboard');
      document.getElementById('adminLogoutBtn').style.display = '';
      haptic([20]);

    } catch (err) {
      sessionStorage.removeItem('admin_pin');
      error.textContent   = mensajeError(err);
      error.style.display = 'block';
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Acceder';
    }
  },

  logout() {
    sessionStorage.removeItem('admin_pin');
    AdminState.pinAdmin = null;
    clearInterval(AdminState.pollingTimer);
    const pinInput = document.getElementById('adminPinInput');
    pinInput.value = '';
    document.getElementById('adminLogoutBtn').style.display = 'none';
    showPage('page-admin-login');
    setTimeout(() => pinInput.focus(), 350);
  },

  async cargarDashboard() {
    const resp = await apiGet({ accion: 'admin_empleados', pinAdmin: AdminState.pinAdmin });
    if (resp.ok) {
      AdminState.empleados = resp.data.empleados;
      this.inicializar(resp.data.empleados);
    }
  },

  // ── INIT DASHBOARD ─────────────────────────────────────────
  inicializar(empleados) {
    document.getElementById('filtroFecha').value = fechaHoy();

    const sel = document.getElementById('filtroEmpleado');
    sel.innerHTML = '<option value="">Todos los empleados</option>';
    empleados.filter(e => e.activo).forEach(e => {
      sel.innerHTML += `<option value="${e.id}">${e.nombre}</option>`;
    });

    this.consultarRegistros();
    this.consultarAbiertos();
    this.renderEmpleados(empleados);

    clearInterval(AdminState.pollingTimer);
    AdminState.pollingTimer = setInterval(() => {
      if (AdminState.tabActual === 'abiertos') this.consultarAbiertos();
      this.actualizarStatAbiertos();
    }, 60000);
  },

  // ── TABS ───────────────────────────────────────────────────
  switchTab(tab) {
    AdminState.tabActual = tab;

    // Actualizar clases y aria-selected de los botones
    document.querySelectorAll('.tab-btn').forEach(btn => {
      const isActive = btn.id === `tab-btn-${tab}`;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    // Mostrar/ocultar contenido
    document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
    document.getElementById(`tab-${tab}`).style.display = '';

    if (tab === 'abiertos')  this.consultarAbiertos();
    if (tab === 'empleados') this.cargarEmpleados();

    haptic([15]);
  },

  // ── REGISTROS ──────────────────────────────────────────────
  async consultarRegistros() {
    const fecha      = document.getElementById('filtroFecha').value || fechaHoy();
    const idEmpleado = document.getElementById('filtroEmpleado').value;
    const tbody      = document.getElementById('tablaBody');
    const info       = document.getElementById('tablaInfo');

    tbody.innerHTML = '<tr><td colspan="5"><div class="loading-overlay"><div class="loader"></div><span>Cargando...</span></div></td></tr>';

    try {
      const params = { accion: 'admin_dia', pinAdmin: AdminState.pinAdmin, fecha };
      if (idEmpleado) params.idEmpleado = idEmpleado;

      const resp = await apiGet(params);
      if (!resp.ok) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:24px;">Error al cargar los registros.</td></tr>';
        return;
      }

      const { registros, total } = resp.data;
      AdminState.registros = registros;

      const entradas = registros.filter(r => r.tipo === 'ENTRADA').length;
      const salidas  = registros.filter(r => r.tipo === 'SALIDA').length;

      document.getElementById('statTotal').textContent    = total;
      document.getElementById('statEntradas').textContent = entradas;
      document.getElementById('statSalidas').textContent  = salidas;

      if (!registros.length) {
        tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-state-icon">📭</div>Sin registros para este filtro.</div></td></tr>';
        info.textContent = '';
        return;
      }

      this.renderTabla(registros);
      info.textContent = `${total} registro${total !== 1 ? 's' : ''} · ${formatFechaLegible(fecha)}`;
      this.actualizarStatAbiertos();

    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--error);padding:24px;">${mensajeError(err)}</td></tr>`;
    }
  },

  renderTabla(registros) {
    const tbody = document.getElementById('tablaBody');

    document.querySelectorAll('thead th[data-col]').forEach(th => {
      const col = th.dataset.col;
      th.classList.toggle('sorted-asc',  AdminState.sortCol === col && AdminState.sortDir === 'asc');
      th.classList.toggle('sorted-desc', AdminState.sortCol === col && AdminState.sortDir === 'desc');
    });

    let sorted = [...registros];
    if (AdminState.sortCol) {
      sorted.sort((a, b) => {
        const av = a[AdminState.sortCol] || '';
        const bv = b[AdminState.sortCol] || '';
        return AdminState.sortDir === 'asc'
          ? av.localeCompare(bv)
          : bv.localeCompare(av);
      });
    }

    tbody.innerHTML = sorted.map(r => `
      <tr>
        <td>
          <strong style="display:block;">${r.nombre}</strong>
          <span style="font-size:11px;color:var(--text-muted);">${r.idEmpleado}</span>
        </td>
        <td>
          <span class="badge ${r.tipo === 'ENTRADA' ? 'badge-entrada' : 'badge-salida'}">
            ${r.tipo === 'ENTRADA' ? '▶' : '■'} ${r.tipo}
          </span>
        </td>
        <td>${formatFechaLegible(r.fecha)}</td>
        <td style="font-variant-numeric:tabular-nums; font-weight:700;">${r.hora}</td>
        <td style="font-family:monospace; font-size:11px; color:var(--text-muted);">
          ${String(r.idRegistro).slice(0, 10)}…
        </td>
      </tr>
    `).join('');
  },

  sortTabla(col) {
    if (AdminState.sortCol === col) {
      AdminState.sortDir = AdminState.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      AdminState.sortCol = col;
      AdminState.sortDir = 'asc';
    }
    if (AdminState.registros.length) this.renderTabla(AdminState.registros);
    haptic([15]);
  },

  irAHoy() {
    document.getElementById('filtroFecha').value = fechaHoy();
    this.consultarRegistros();
  },

  async actualizarStatAbiertos() {
    try {
      const resp = await apiGet({ accion: 'admin_abiertos', pinAdmin: AdminState.pinAdmin });
      if (resp.ok) {
        document.getElementById('statAbiertos').textContent = resp.data.abiertos.length;
      }
    } catch (_) {}
  },

  // ── EN JORNADA ─────────────────────────────────────────────
  async consultarAbiertos() {
    const lista = document.getElementById('listaAbiertos');
    lista.innerHTML = '<div class="loading-overlay"><div class="loader"></div><span>Cargando...</span></div>';

    try {
      const resp = await apiGet({ accion: 'admin_abiertos', pinAdmin: AdminState.pinAdmin });
      if (!resp.ok) {
        lista.innerHTML = '<div class="empty-state">Error al cargar.</div>';
        return;
      }

      const { abiertos } = resp.data;
      document.getElementById('statAbiertos').textContent = abiertos.length;

      if (!abiertos.length) {
        lista.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🟡</div>Ningún empleado en jornada ahora mismo.</div>';
        return;
      }

      lista.innerHTML = abiertos.map((a, i) => `
        <div class="registro-item" style="animation-delay:${i * 55}ms">
          <div class="status-icon en-jornada"
               style="width:44px;height:44px;font-size:20px;flex-shrink:0;"
               aria-hidden="true">🟢</div>
          <div class="registro-info">
            <div class="registro-tipo">${a.nombre}</div>
            <div class="registro-fecha">Entrada: ${a.hora}</div>
          </div>
          <span class="badge badge-entrada">En jornada</span>
        </div>
      `).join('');

    } catch (err) {
      lista.innerHTML = `<div class="empty-state">${mensajeError(err)}</div>`;
    }
  },

  // ── EMPLEADOS ──────────────────────────────────────────────
  async cargarEmpleados() {
    const lista = document.getElementById('listaEmpleados');
    lista.innerHTML = '<div class="loading-overlay"><div class="loader"></div><span>Cargando...</span></div>';

    try {
      const resp = await apiGet({ accion: 'admin_empleados', pinAdmin: AdminState.pinAdmin });
      if (!resp.ok) {
        lista.innerHTML = '<div class="empty-state">Error al cargar.</div>';
        return;
      }
      AdminState.empleados = resp.data.empleados;
      this.renderEmpleados(resp.data.empleados);
    } catch (err) {
      lista.innerHTML = `<div class="empty-state">${mensajeError(err)}</div>`;
    }
  },

  renderEmpleados(empleados) {
    const lista = document.getElementById('listaEmpleados');

    if (!empleados.length) {
      lista.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👥</div>No hay empleados. Crea el primero con el botón "＋ Nuevo".</div>';
      return;
    }

    lista.innerHTML = empleados.map((e, i) => `
      <div class="registro-item" style="animation-delay:${i * 55}ms; align-items:flex-start; padding:14px 0;">
        <div style="width:44px;height:44px;border-radius:var(--radius-sm);
                    background:var(--surface-3);display:flex;align-items:center;
                    justify-content:center;font-size:22px;flex-shrink:0;margin-top:2px;"
             aria-hidden="true">
          ${e.activo ? '👤' : '🚫'}
        </div>
        <div class="registro-info" style="min-width:0;">
          <div class="registro-tipo" style="${!e.activo ? 'opacity:0.45' : ''}">
            ${e.nombre}
          </div>
          <div class="registro-fecha">${e.id}</div>
          <div class="registro-fecha">Alta: ${formatFechaLegible(e.fechaAlta)}</div>
          <!-- Acciones debajo del nombre — más cómodas en móvil -->
          <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
            <span class="badge ${e.activo ? 'badge-entrada' : 'badge-error'}" style="align-self:center;">
              ${e.activo ? 'Activo' : 'Inactivo'}
            </span>
            <button class="btn btn-ghost btn-sm"
                    onclick="Admin.abrirModalEditarEmpleado('${e.id}','${e.nombre.replace(/'/g,"\\'")
                    }','${(e.email||'').replace(/'/g,"\\'")}')">
              ✏️ Editar
            </button>
            <button class="btn ${e.activo ? 'btn-danger' : 'btn-ghost'} btn-sm"
                    onclick="Admin.toggleEmpleado('${e.id}',${e.activo})">
              ${e.activo ? 'Desactivar' : 'Activar'}
            </button>
          </div>
        </div>
      </div>
    `).join('');
  },

  async toggleEmpleado(idEmpleado, estadoActual) {
    const accion  = estadoActual ? 'desactivar' : 'activar';
    const empleado = AdminState.empleados.find(e => e.id === idEmpleado);
    const nombre   = empleado?.nombre || idEmpleado;

    const confirmado = await this._confirmar(
      `¿${accion.charAt(0).toUpperCase() + accion.slice(1)} empleado?`,
      `${nombre} ${estadoActual ? 'no podrá fichar hasta que lo reactives.' : 'podrá volver a fichar.'}`,
      accion.charAt(0).toUpperCase() + accion.slice(1),
      estadoActual ? 'btn-danger' : 'btn-primary'
    );
    if (!confirmado) return;

    try {
      const resp = await apiPost({
        accion:     'admin_toggle_empleado',
        pinAdmin:   AdminState.pinAdmin,
        idEmpleado
      });

      if (resp.ok) {
        toast(`Empleado ${resp.data.activo ? 'activado ✅' : 'desactivado 🚫'} correctamente`, 'success');
        this.cargarEmpleados();
      } else {
        toast(resp.error || 'Error al cambiar estado', 'error');
      }
    } catch (err) {
      toast(mensajeError(err), 'error');
    }
  },

  // ── MODAL CONFIRMACIÓN ─────────────────────────────────────
  _confirmar(titulo, mensaje, labelOk = 'Confirmar', clsOk = 'btn-primary') {
    return new Promise(resolve => {
      document.getElementById('confirmModalTitulo').textContent  = titulo;
      document.getElementById('confirmModalMensaje').textContent = mensaje;
      const btnOk = document.getElementById('confirmModalOk');
      btnOk.textContent = labelOk;
      btnOk.className   = `btn ${clsOk} flex-1`;

      const backdrop = document.getElementById('modalConfirm');
      backdrop.classList.add('show');
      lockBodyScroll();

      const cleanup = result => {
        backdrop.classList.remove('show');
        unlockBodyScroll();
        btnOk.onclick = null;
        document.getElementById('confirmModalCancel').onclick = null;
        resolve(result);
      };

      btnOk.onclick = () => { haptic([25]); cleanup(true);  };
      document.getElementById('confirmModalCancel').onclick = () => cleanup(false);
    });
  },

  // ── MODAL EMPLEADO ─────────────────────────────────────────
  abrirModalNuevoEmpleado() {
    document.getElementById('modalEmpTitulo').textContent    = '➕ Nuevo Empleado';
    document.getElementById('nuevoNombre').value             = '';
    document.getElementById('nuevoPin').value                = '';
    document.getElementById('nuevoEmail').value              = '';
    document.getElementById('nuevoEmpError').style.display   = 'none';
    document.getElementById('nuevoEmpId').value              = '';
    document.getElementById('nuevoEmpBtn').textContent       = 'Crear empleado';
    document.getElementById('nuevoEmpBtn').style.display     = '';
    document.getElementById('nuevoPinHint').textContent      = 'Exactamente 4 dígitos. Lo entregarás al empleado.';
    document.getElementById('pinVisualWrapper').style.display = 'none';
    document.getElementById('modalNuevoEmp').classList.add('show');
    lockBodyScroll();
    setTimeout(() => document.getElementById('nuevoNombre').focus(), 380);
  },

  abrirModalEditarEmpleado(id, nombre, email) {
    document.getElementById('modalEmpTitulo').textContent    = '✏️ Editar Empleado';
    document.getElementById('nuevoNombre').value             = nombre;
    document.getElementById('nuevoPin').value                = '';
    document.getElementById('nuevoEmail').value              = email;
    document.getElementById('nuevoEmpError').style.display   = 'none';
    document.getElementById('nuevoEmpId').value              = id;
    document.getElementById('nuevoEmpBtn').textContent       = 'Guardar cambios';
    document.getElementById('nuevoEmpBtn').style.display     = '';
    document.getElementById('nuevoPinHint').textContent      = 'Deja vacío para no cambiar el PIN actual.';
    document.getElementById('pinVisualWrapper').style.display = 'none';
    document.getElementById('modalNuevoEmp').classList.add('show');
    lockBodyScroll();
    setTimeout(() => document.getElementById('nuevoNombre').focus(), 380);
  },

  cerrarModal() {
    document.getElementById('modalNuevoEmp').classList.remove('show');
    unlockBodyScroll();
  },

  async crearEmpleado() {
    const nombre     = document.getElementById('nuevoNombre').value.trim();
    const pin        = document.getElementById('nuevoPin').value.trim();
    const email      = document.getElementById('nuevoEmail').value.trim();
    const id         = document.getElementById('nuevoEmpId').value.trim();
    const error      = document.getElementById('nuevoEmpError');
    const btn        = document.getElementById('nuevoEmpBtn');
    const modoEditar = !!id;

    if (!nombre) {
      error.textContent   = 'El nombre es obligatorio.';
      error.style.display = 'block';
      return;
    }

    if (!modoEditar && (!pin || !/^\d{4}$/.test(pin))) {
      error.textContent   = 'El PIN debe ser exactamente 4 dígitos numéricos.';
      error.style.display = 'block';
      return;
    }

    if (modoEditar && pin && !/^\d{4}$/.test(pin)) {
      error.textContent   = 'El nuevo PIN debe ser exactamente 4 dígitos (o déjalo vacío).';
      error.style.display = 'block';
      return;
    }

    btn.disabled        = true;
    btn.innerHTML       = '<span class="loader"></span> Guardando...';
    error.style.display = 'none';

    try {
      const body = {
        accion:   modoEditar ? 'admin_editar_empleado' : 'admin_nuevo_empleado',
        pinAdmin: AdminState.pinAdmin,
        nombre,
        email
      };
      if (pin)        body.pin        = pin;
      if (modoEditar) body.idEmpleado = id;

      const resp = await apiPost(body);

      if (!resp.ok) {
        error.textContent   = resp.error || 'Error al guardar';
        error.style.display = 'block';
        return;
      }

      if (modoEditar) {
        toast(`✅ "${nombre}" actualizado${pin ? ' · PIN cambiado' : ''}`, 'success', 5000);
        this.cerrarModal();
      } else {
        this._mostrarPinCreado(nombre, resp.data.id, pin);
      }

      this.cargarEmpleados();

    } catch (err) {
      error.textContent   = mensajeError(err);
      error.style.display = 'block';
    } finally {
      btn.disabled    = false;
      btn.textContent = modoEditar ? 'Guardar cambios' : 'Crear empleado';
    }
  },

  _mostrarPinCreado(nombre, empId, pin) {
    document.getElementById('pinVisualWrapper').style.display = '';
    document.getElementById('pinVisualNombre').textContent    = nombre;
    document.getElementById('pinVisualId').textContent        = empId;
    document.getElementById('pinVisualPin').textContent       = pin;
    document.getElementById('nuevoEmpBtn').style.display      = 'none';
    haptic([30, 50, 80]);
  },

  confirmarPinVisto() {
    document.getElementById('pinVisualWrapper').style.display = 'none';
    document.getElementById('nuevoEmpBtn').style.display      = '';
    this.cerrarModal();
    toast('✅ Empleado creado. ¡Recuerda entregarle su PIN!', 'success', 6000);
  },

  // ── EXPORTAR CSV ───────────────────────────────────────────
  exportarCSV() {
    const registros = AdminState.registros;
    if (!registros.length) {
      toast('No hay registros para exportar', 'error');
      return;
    }

    const cabecera = ['ID_Registro','ID_Empleado','Nombre','Tipo','Fecha','Hora','Timestamp_Servidor','Observaciones'];
    const filas = registros.map(r => [
      r.idRegistro,
      r.idEmpleado,
      `"${r.nombre}"`,
      r.tipo,
      r.fecha,
      r.hora,
      r.timestampServidor || '',
      `"${r.observaciones || ''}"`
    ]);

    const csv  = [cabecera, ...filas].map(f => f.join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const fecha = document.getElementById('filtroFecha').value || fechaHoy();

    a.href     = url;
    a.download = `fichajes_${fecha}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    toast(`CSV exportado: ${registros.length} registros`, 'success');
    haptic([20, 30]);
  }

};

// ── INICIALIZACIÓN ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // Enter en inputs para avanzar
  document.getElementById('adminPinInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); Admin.login(); }
  });

  // Auto-avanzar al completar el PIN admin (6 dígitos como máximo)
  document.getElementById('adminPinInput').addEventListener('input', e => {
    const v = e.target.value;
    if (v.length >= 4 && /^\d+$/.test(v)) {
      setTimeout(() => Admin.login(), 120);
    }
  });

  document.getElementById('setupPin')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); Setup.crear(); }
  });

  document.getElementById('nuevoPin').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); Admin.crearEmpleado(); }
  });

  // Cerrar modal de empleado con Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (document.getElementById('modalNuevoEmp').classList.contains('show')) {
        Admin.cerrarModal();
      }
    }
  });

  // Service Worker
  registrarServiceWorker();

  // Arrancar
  checkSetup();
});
