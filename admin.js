// ============================================================
//  FICHAJE LABORAL — admin.js (Panel Administrador)
//  Versión: 1.2 — Fix POST CORS + DNI obligatorio
// ============================================================

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
  const [año, mes, dia] = fechaISO.split('-');
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

// ── API ──────────────────────────────────────────────────────

// apiGet: solo para peticiones SIN credenciales (caché buster público)
async function apiGet(params) {
  const url = new URL(APPS_SCRIPT_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set('t', Date.now());
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal, cache: 'no-store' });
    clearTimeout(timeout);
    return res.json();
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') throw new Error('TIMEOUT');
    throw new Error('NETWORK');
  }
}

// ─────────────────────────────────────────────────────────────
//  FIX SEGURIDAD: Las peticiones de admin que incluyen pinAdmin
//  se envían siempre por POST (body cifrado en tránsito, nunca
//  en la URL donde quedaría en logs, historial y proxies).
//  Google Apps Script lo parsea igual con JSON.parse(e.postData.contents)
// ─────────────────────────────────────────────────────────────
async function apiPost(body) {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
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

// apiAdminGet: wrapper seguro — envía pinAdmin por POST, no por URL
// Úsalo en lugar de apiGet para cualquier acción que requiera pinAdmin
async function apiAdminGet(params) {
  // Separar pinAdmin del resto de parámetros de lectura
  const { pinAdmin, ...rest } = params;
  return apiPost({ ...rest, pinAdmin });
}

// ============================================================
//  ADMIN PRINCIPAL
// ============================================================

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
      return;
    }

    btn.disabled        = true;
    btn.innerHTML       = '<span class="loader"></span>';
    error.style.display = 'none';

    try {
      const resp = await apiAdminGet({ accion: 'admin_empleados', pinAdmin: pin });

      if (!resp.ok) {
        sessionStorage.removeItem('admin_pin');
        error.textContent   = 'Error: ' + (resp.error ? resp.error : 'PIN de administrador incorrecto.');
        error.style.display = 'block';
        pinInput.value      = '';
        pinInput.focus();
        return;
      }

      AdminState.pinAdmin  = pin;
      AdminState.empleados = resp.data.empleados;
      sessionStorage.setItem('admin_pin', pin);

      this.inicializar(resp.data.empleados);
      showPage('page-admin-dashboard');
      document.getElementById('adminLogoutBtn').style.display = '';

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
    document.getElementById('adminPinInput').value = '';
    document.getElementById('adminLogoutBtn').style.display = 'none';
    showPage('page-admin-login');
  },

  // ── INIT DASHBOARD ─────────────────────────────────────────
  inicializar(empleados) {
    document.getElementById('filtroFecha').value = fechaHoy();

    const sel = document.getElementById('filtroEmpleado');
    sel.innerHTML = '<option value="">Todos los empleados</option>';
    empleados.filter(e => e.activo).forEach(e => {
      // FIX XSS: usar createElement para que el nombre nunca se interprete como HTML
      const opt = document.createElement('option');
      opt.value       = e.id;
      opt.textContent = e.nombre;
      sel.appendChild(opt);
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

    document.querySelectorAll('.tab-btn').forEach((btn, i) => {
      const tabs = ['registros', 'abiertos', 'empleados'];
      btn.classList.toggle('active', tabs[i] === tab);
    });

    document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
    document.getElementById(`tab-${tab}`).style.display = '';

    if (tab === 'abiertos')  this.consultarAbiertos();
    if (tab === 'empleados') this.cargarEmpleados();
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

      const resp = await apiAdminGet(params);
      if (!resp.ok) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Error al cargar los registros.</td></tr>';
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
      tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="color:var(--error)">${mensajeError(err)}</td></tr>`;
      console.error(err);
    }
  },

  renderTabla(registros) {
    const tbody = document.getElementById('tablaBody');

    document.querySelectorAll('thead th[data-col]').forEach(th => {
      const col = th.dataset.col;
      th.classList.toggle('sorted-asc',  AdminState.sortCol === col && AdminState.sortDir === 'asc');
      th.classList.toggle('sorted-desc', AdminState.sortCol === col && AdminState.sortDir === 'desc');
    });

    // Detectar qué empleados tienen jornada abierta en el conjunto de registros:
    // un empleado está "abierto" si su último registro del día es ENTRADA (sin SALIDA posterior).
    const ultimoPorEmpleado = {};
    registros.forEach(r => {
      const key = r.idEmpleado + '_' + r.fecha;
      if (!ultimoPorEmpleado[key] || r.hora > ultimoPorEmpleado[key].hora) {
        ultimoPorEmpleado[key] = r;
      }
    });
    // Set de idRegistro cuyo empleado+fecha tiene la ENTRADA como último registro
    const abiertosIds = new Set(
      Object.values(ultimoPorEmpleado)
        .filter(r => r.tipo === 'ENTRADA')
        .map(r => r.idRegistro)
    );

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

    tbody.innerHTML = sorted.map(r => {
      const esAbierto = abiertosIds.has(r.idRegistro);
      const estadoCelda = esAbierto
        ? '<span class="badge-activa">🟢 En jornada</span>'
        : '<span class="badge-cerrado">—</span>';
      const trClass = esAbierto ? ' class="jornada-activa"' : '';
      return `
        <tr${trClass}>
          <td><strong>${r.nombre}</strong><br><span class="text-xs text-muted">${r.idEmpleado}</span></td>
          <td>
            <span class="badge ${r.tipo === 'ENTRADA' ? 'badge-entrada' : 'badge-salida'}">
              ${r.tipo === 'ENTRADA' ? '▶' : '■'} ${r.tipo}
            </span>
          </td>
          <td>${estadoCelda}</td>
          <td>${formatFechaLegible(r.fecha)}</td>
          <td style="font-variant-numeric:tabular-nums; font-weight:700;">${r.hora}</td>
          <td class="text-xs text-muted" style="font-family:monospace;">${r.idRegistro.slice(0, 8)}…</td>
        </tr>`;
    }).join('');
  },

  sortTabla(col) {
    if (AdminState.sortCol === col) {
      AdminState.sortDir = AdminState.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      AdminState.sortCol = col;
      AdminState.sortDir = 'asc';
    }
    if (AdminState.registros.length) this.renderTabla(AdminState.registros);
  },

  irAHoy() {
    document.getElementById('filtroFecha').value = fechaHoy();
    this.consultarRegistros();
  },

  async actualizarStatAbiertos() {
    try {
      const resp = await apiAdminGet({ accion: 'admin_abiertos', pinAdmin: AdminState.pinAdmin });
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
      const resp = await apiAdminGet({ accion: 'admin_abiertos', pinAdmin: AdminState.pinAdmin });
      if (!resp.ok) { lista.innerHTML = '<div class="empty-state">Error al cargar.</div>'; return; }

      const { abiertos } = resp.data;
      document.getElementById('statAbiertos').textContent = abiertos.length;

      if (!abiertos.length) {
        lista.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🟡</div>Ningún empleado en jornada ahora mismo.</div>';
        return;
      }

      lista.innerHTML = abiertos.map((a, i) => `
        <div class="registro-item" style="animation-delay:${i * 60}ms">
          <div class="status-icon en-jornada" style="width:44px;height:44px;font-size:18px;">🟢</div>
          <div class="registro-info">
            <div class="registro-tipo">${a.nombre}</div>
            <div class="registro-fecha">Entrada: ${a.hora}</div>
          </div>
          <span class="badge badge-entrada">En jornada</span>
        </div>
      `).join('');

    } catch (err) {
      lista.innerHTML = `<div class="empty-state">${mensajeError(err)}</div>`;
      console.error(err);
    }
  },

  // ── EMPLEADOS ──────────────────────────────────────────────
  async cargarEmpleados() {
    const lista = document.getElementById('listaEmpleados');
    lista.innerHTML = '<div class="loading-overlay"><div class="loader"></div><span>Cargando...</span></div>';

    try {
      const resp = await apiAdminGet({ accion: 'admin_empleados', pinAdmin: AdminState.pinAdmin });
      if (!resp.ok) { lista.innerHTML = '<div class="empty-state">Error al cargar.</div>'; return; }

      AdminState.empleados = resp.data.empleados;
      this.renderEmpleados(resp.data.empleados);

    } catch (err) {
      lista.innerHTML = `<div class="empty-state">${mensajeError(err)}</div>`;
    }
  },

  renderEmpleados(empleados) {
    const lista = document.getElementById('listaEmpleados');

    if (!empleados.length) {
      lista.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👥</div>No hay empleados registrados. Crea el primero con el botón "＋ Nuevo".</div>';
      return;
    }

    // FIX XSS: construir cada tarjeta con createElement para que los datos del
    // servidor nunca se interpreten como HTML/JS, independientemente de su valor.
    const fragment = document.createDocumentFragment();

    empleados.forEach((e, i) => {
      const item = document.createElement('div');
      item.className = 'registro-item';
      item.style.animationDelay = `${i * 60}ms`;

      const avatar = document.createElement('div');
      avatar.style.cssText = 'width:44px;height:44px;border-radius:var(--radius-sm);background:var(--surface-2);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;';
      avatar.textContent = '👤';

      const info = document.createElement('div');
      info.className = 'registro-info';

      const nombreEl = document.createElement('div');
      nombreEl.className = 'registro-tipo';
      nombreEl.textContent = e.nombre;
      const puestoSpan = document.createElement('span');
      puestoSpan.style.cssText = 'font-weight:400;font-size:0.8em;color:var(--text-muted)';
      puestoSpan.textContent = ` (${e.puesto || 'Sin puesto'})`;
      nombreEl.appendChild(puestoSpan);

      const metaEl = document.createElement('div');
      metaEl.className = 'registro-fecha';
      metaEl.textContent = `${e.id} · DNI: ${e.dni || '—'} · Alta: ${formatFechaLegible(e.fechaAlta)}`;

      info.appendChild(nombreEl);
      info.appendChild(metaEl);

      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:6px;';

      const badge = document.createElement('span');
      badge.className = `badge ${e.activo ? 'badge-entrada' : 'badge-error'}`;
      badge.textContent = e.activo ? 'Activo' : 'Inactivo';

      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex;gap:6px;';

      const btnEdit = document.createElement('button');
      btnEdit.className = 'btn btn-ghost btn-sm';
      btnEdit.textContent = '✏️';
      // Datos pasados por closure — nunca interpolados en HTML
      btnEdit.addEventListener('click', () =>
        Admin.abrirModalEditarEmpleado(e.id, e.nombre, e.email || '', e.dni || '', e.puesto || '', e.turno1_entrada || '', e.turno1_salida || '', e.turno2_entrada || '', e.turno2_salida || '')
      );

      const btnToggle = document.createElement('button');
      btnToggle.className = 'btn btn-ghost btn-sm';
      btnToggle.textContent = e.activo ? 'Desactivar' : 'Activar';
      btnToggle.addEventListener('click', () => Admin.toggleEmpleado(e.id, e.activo));

      btnRow.appendChild(btnEdit);
      btnRow.appendChild(btnToggle);
      actions.appendChild(badge);
      actions.appendChild(btnRow);

      item.appendChild(avatar);
      item.appendChild(info);
      item.appendChild(actions);
      fragment.appendChild(item);
    });

    lista.innerHTML = '';
    lista.appendChild(fragment);
  },

  async toggleEmpleado(idEmpleado, estadoActual) {
    const accion    = estadoActual ? 'desactivar' : 'activar';
    const empleado  = AdminState.empleados.find(e => e.id === idEmpleado);
    const nombre    = empleado?.nombre || idEmpleado;

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
        toast(`Empleado ${resp.data.activo ? 'activado' : 'desactivado'} correctamente`, 'success');
        this.cargarEmpleados();
      } else {
        toast(resp.error || 'Error al cambiar estado', 'error');
      }
    } catch (err) {
      toast(mensajeError(err), 'error');
    }
  },

  _confirmar(titulo, mensaje, labelOk = 'Confirmar', clsOk = 'btn-primary') {
    return new Promise(resolve => {
      document.getElementById('confirmModalTitulo').textContent  = titulo;
      document.getElementById('confirmModalMensaje').textContent = mensaje;
      const btnOk = document.getElementById('confirmModalOk');
      btnOk.textContent = labelOk;
      btnOk.className   = `btn ${clsOk} flex-1`;

      const backdrop = document.getElementById('modalConfirm');
      backdrop.classList.add('show');

      const cleanup = result => {
        backdrop.classList.remove('show');
        btnOk.onclick    = null;
        document.getElementById('confirmModalCancel').onclick = null;
        resolve(result);
      };

      btnOk.onclick = () => cleanup(true);
      document.getElementById('confirmModalCancel').onclick = () => cleanup(false);
    });
  },

  // ── MODAL NUEVO EMPLEADO ───────────────────────────────────
  abrirModalNuevoEmpleado() {
    document.getElementById('modalEmpTitulo').textContent = '➕ Nuevo Empleado';
    document.getElementById('nuevoNombre').value  = '';
    document.getElementById('nuevoPin').value     = '';
    document.getElementById('nuevoEmail').value   = '';
    document.getElementById('nuevoDni').value     = '';
    document.getElementById('nuevoPuesto').value  = '';
    document.getElementById('turno1Entrada').value = '';
    document.getElementById('turno1Salida').value  = '';
    document.getElementById('turno2Entrada').value = '';
    document.getElementById('turno2Salida').value  = '';
    document.getElementById('nuevoEmpError').style.display = 'none';
    document.getElementById('nuevoEmpId').value   = '';
    document.getElementById('nuevoEmpBtn').textContent = 'Crear empleado';
    document.getElementById('pinVisualWrapper').style.display = 'none';
    // Resetear hint del PIN
    document.getElementById('nuevoPinHint').textContent = '';
    document.getElementById('modalNuevoEmp').classList.add('show');
    setTimeout(() => document.getElementById('nuevoNombre').focus(), 350);
  },

  abrirModalEditarEmpleado(id, nombre, email, dni, puesto, t1e, t1s, t2e, t2s) {
    document.getElementById('modalEmpTitulo').textContent = '✏️ Editar Empleado';
    document.getElementById('nuevoNombre').value  = nombre;
    document.getElementById('nuevoPin').value     = '';
    document.getElementById('nuevoEmail').value   = email;
    document.getElementById('nuevoDni').value     = dni || '';
    document.getElementById('nuevoPuesto').value  = puesto || '';
    document.getElementById('turno1Entrada').value = t1e || '';
    document.getElementById('turno1Salida').value  = t1s || '';
    document.getElementById('turno2Entrada').value = t2e || '';
    document.getElementById('turno2Salida').value  = t2s || '';
    document.getElementById('nuevoEmpError').style.display = 'none';
    document.getElementById('nuevoEmpId').value   = id;
    document.getElementById('nuevoEmpBtn').textContent = 'Guardar cambios';
    document.getElementById('pinVisualWrapper').style.display = 'none';
    document.getElementById('nuevoPinHint').textContent = 'Deja vacío para no cambiar el PIN.';
    document.getElementById('modalNuevoEmp').classList.add('show');
    setTimeout(() => document.getElementById('nuevoNombre').focus(), 350);
  },

  cerrarModal() {
    document.getElementById('modalNuevoEmp').classList.remove('show');
    document.getElementById('nuevoPinHint').textContent = '';
  },

  // FIX: confirmar PIN visto (para el wrapper de PIN visual)
  confirmarPinVisto() {
    document.getElementById('pinVisualWrapper').style.display = 'none';
    this.cerrarModal();
  },

  async crearEmpleado() {
    const nombre        = document.getElementById('nuevoNombre').value.trim();
    const pin           = document.getElementById('nuevoPin').value.trim();
    const email         = document.getElementById('nuevoEmail').value.trim();
    const dni           = document.getElementById('nuevoDni').value.trim().toUpperCase();
    const puesto        = document.getElementById('nuevoPuesto').value.trim();
    const turno1Entrada = document.getElementById('turno1Entrada').value.trim();
    const turno1Salida  = document.getElementById('turno1Salida').value.trim();
    const turno2Entrada = document.getElementById('turno2Entrada').value.trim();
    const turno2Salida  = document.getElementById('turno2Salida').value.trim();
    const id     = document.getElementById('nuevoEmpId').value.trim();
    const error  = document.getElementById('nuevoEmpError');
    const btn    = document.getElementById('nuevoEmpBtn');
    const modoEditar = !!id;

    // ── VALIDACIONES ──────────────────────────────────────────

    if (!nombre) {
      error.textContent   = 'El nombre completo es obligatorio.';
      error.style.display = 'block';
      document.getElementById('nuevoNombre').focus();
      return;
    }

    // PIN obligatorio al crear; opcional al editar
    if (!modoEditar && (!pin || !/^\d{4}$/.test(pin))) {
      error.textContent   = 'El PIN debe ser exactamente 4 dígitos numéricos.';
      error.style.display = 'block';
      document.getElementById('nuevoPin').focus();
      return;
    }

    if (modoEditar && pin && !/^\d{4}$/.test(pin)) {
      error.textContent   = 'El nuevo PIN debe ser 4 dígitos (o déjalo vacío para no cambiarlo).';
      error.style.display = 'block';
      document.getElementById('nuevoPin').focus();
      return;
    }

    // ── DNI OBLIGATORIO ───────────────────────────────────────
    if (!dni) {
      error.textContent   = 'El DNI / NIE es obligatorio.';
      error.style.display = 'block';
      document.getElementById('nuevoDni').focus();
      return;
    }

    // Formato básico DNI/NIE español
    const dniRegex = /^[0-9XYZ][0-9]{6,7}[A-Z]$/;
    if (!dniRegex.test(dni)) {
      error.textContent   = 'Formato de DNI/NIE no válido. Ejemplo: 12345678A o X1234567B';
      error.style.display = 'block';
      document.getElementById('nuevoDni').focus();
      return;
    }

    // ── PUESTO OBLIGATORIO ────────────────────────────────────
    if (!puesto) {
      error.textContent   = 'El puesto de trabajo es obligatorio.';
      error.style.display = 'block';
      document.getElementById('nuevoPuesto').focus();
      return;
    }

    // ── VALIDACIÓN DE TURNOS ──────────────────────────────────
    // Si se rellena una parte del turno, la otra también es obligatoria
    if ((turno1Entrada && !turno1Salida) || (!turno1Entrada && turno1Salida)) {
      error.textContent   = 'Turno 1: debes indicar tanto la entrada como la salida.';
      error.style.display = 'block';
      return;
    }
    if ((turno2Entrada && !turno2Salida) || (!turno2Entrada && turno2Salida)) {
      error.textContent   = 'Turno 2: debes indicar tanto la entrada como la salida.';
      error.style.display = 'block';
      return;
    }
    // Turno 2 requiere Turno 1
    if ((turno2Entrada || turno2Salida) && !turno1Entrada) {
      error.textContent   = 'Define el Turno 1 antes de añadir el Turno 2.';
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
        email,
        dni,
        puesto,
        turno1_entrada: turno1Entrada,
        turno1_salida:  turno1Salida,
        turno2_entrada: turno2Entrada,
        turno2_salida:  turno2Salida
      };
      if (pin)        body.pin        = pin;
      if (modoEditar) body.idEmpleado = id;

      const resp = await apiPost(body);

      if (!resp.ok) {
        error.textContent   = resp.error || 'Error al guardar. Inténtalo de nuevo.';
        error.style.display = 'block';
        return;
      }

      if (modoEditar) {
        toast(`✅ Empleado actualizado${pin ? ' (PIN cambiado)' : ''}`, 'success', 5000);
        this.cerrarModal();
      } else {
        // Mostrar PIN en pantalla para que el admin lo anote
        document.getElementById('pinVisualNombre').textContent = nombre;
        document.getElementById('pinVisualId').textContent     = resp.data.id;
        document.getElementById('pinVisualPin').textContent    = pin;
        document.getElementById('pinVisualWrapper').style.display = '';
        // Ocultar botón de guardar para que no se pueda volver a pulsar
        btn.style.display = 'none';
      }

      this.cargarEmpleados();

    } catch (err) {
      error.textContent   = mensajeError(err);
      error.style.display = 'block';
    } finally {
      btn.disabled = false;
      if (!document.getElementById('pinVisualWrapper').style.display ||
           document.getElementById('pinVisualWrapper').style.display === 'none') {
        btn.style.display   = '';
        btn.textContent = modoEditar ? 'Guardar cambios' : 'Crear empleado';
      }
    }
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
      r.timestampServidor,
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
  }

};

// ── INICIALIZACIÓN ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  document.getElementById('adminPinInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') Admin.login();
  });

  document.getElementById('nuevoPin').addEventListener('keydown', e => {
    if (e.key === 'Enter') Admin.crearEmpleado();
  });

  // Auto-login seguro
  const pinGuardado = sessionStorage.getItem('admin_pin');
  if (pinGuardado) {
    document.getElementById('adminPinInput').value = pinGuardado;
    Admin.login();
  }
});
