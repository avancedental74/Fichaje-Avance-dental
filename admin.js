// ============================================================
//  FICHAJE LABORAL — admin.js (Panel Administrador)
//  Versión: 1.0 MVP
// ============================================================

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzteKSPNkGofqBCWZv7OjkJQ0-AVRXSKrCFHwbIUMgUdTdFsnD_ciWKFnfpN20u0N7qxg/exec';

// ── ESTADO ADMIN ─────────────────────────────────────────────
const AdminState = {
  pinAdmin:      null,
  empleados:     [],
  registros:     [],
  tabActual:     'registros'
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

// ── API ──────────────────────────────────────────────────────

async function apiGet(params) {
  const url = new URL(APPS_SCRIPT_URL);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  return res.json();
}

async function apiPost(body) {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
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

    if (!pin) { error.style.display = 'block'; return; }

    btn.disabled     = true;
    btn.innerHTML    = '<span class="loader"></span>';
    error.style.display = 'none';

    try {
      // Verificamos acceso solicitando lista de empleados
      const resp = await apiGet({ accion: 'admin_empleados', pinAdmin: pin });

      if (!resp.ok) {
        error.textContent   = 'PIN de administrador incorrecto.';
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

    } catch(err) {
      error.textContent   = 'Error de conexión.';
      error.style.display = 'block';
    } finally {
      btn.disabled     = false;
      btn.textContent  = 'Acceder';
    }
  },

  logout() {
    sessionStorage.removeItem('admin_pin');
    AdminState.pinAdmin = null;
    document.getElementById('adminPinInput').value = '';
    document.getElementById('adminLogoutBtn').style.display = 'none';
    showPage('page-admin-login');
  },

  // ── INIT DASHBOARD ─────────────────────────────────────────
  inicializar(empleados) {
    // Fecha por defecto = hoy
    document.getElementById('filtroFecha').value = fechaHoy();

    // Poblar select de empleados
    const sel = document.getElementById('filtroEmpleado');
    sel.innerHTML = '<option value="">Todos los empleados</option>';
    empleados.filter(e => e.activo).forEach(e => {
      sel.innerHTML += `<option value="${e.id}">${e.nombre}</option>`;
    });

    // Cargar datos iniciales
    this.consultarRegistros();
    this.consultarAbiertos();
    this.renderEmpleados(empleados);
  },

  // ── TABS ───────────────────────────────────────────────────
  switchTab(tab) {
    AdminState.tabActual = tab;

    // Botones
    document.querySelectorAll('.tab-btn').forEach((btn, i) => {
      const tabs = ['registros', 'abiertos', 'empleados'];
      btn.classList.toggle('active', tabs[i] === tab);
    });

    // Contenido
    document.querySelectorAll('.tab-content').forEach(el => el.style.display = 'none');
    document.getElementById(`tab-${tab}`).style.display = '';

    // Refrescar al cambiar
    if (tab === 'abiertos') this.consultarAbiertos();
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

      const resp = await apiGet(params);
      if (!resp.ok) { tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Error al cargar</td></tr>'; return; }

      const { registros, total } = resp.data;
      AdminState.registros = registros;

      // Stats
      const entradas = registros.filter(r => r.tipo === 'ENTRADA').length;
      const salidas  = registros.filter(r => r.tipo === 'SALIDA').length;
      document.getElementById('statTotal').textContent    = total;
      document.getElementById('statEntradas').textContent = entradas;
      document.getElementById('statSalidas').textContent  = salidas;

      // Tabla
      if (!registros.length) {
        tbody.innerHTML = '<tr><td colspan="5"><div class="empty-state"><div class="empty-state-icon">📭</div>Sin registros para este filtro.</div></td></tr>';
        info.textContent = '';
        return;
      }

      tbody.innerHTML = registros.map(r => `
        <tr>
          <td><strong>${r.nombre}</strong><br><span class="text-xs text-muted">${r.idEmpleado}</span></td>
          <td>
            <span class="badge ${r.tipo === 'ENTRADA' ? 'badge-entrada' : 'badge-salida'}">
              ${r.tipo === 'ENTRADA' ? '▶' : '■'} ${r.tipo}
            </span>
          </td>
          <td>${formatFechaLegible(r.fecha)}</td>
          <td style="font-variant-numeric:tabular-nums; font-weight:700;">${r.hora}</td>
          <td class="text-xs text-muted" style="font-family:monospace;">${r.idRegistro.slice(0,8)}…</td>
        </tr>
      `).join('');

      info.textContent = `${total} registro${total !== 1 ? 's' : ''} · ${formatFechaLegible(fecha)}`;

      // Stats de abiertos (consulta separada)
      this.actualizarStatAbiertos();

    } catch(err) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="color:var(--error)">Error de conexión</td></tr>';
      console.error(err);
    }
  },

  async actualizarStatAbiertos() {
    try {
      const resp = await apiGet({ accion: 'admin_abiertos', pinAdmin: AdminState.pinAdmin });
      if (resp.ok) {
        document.getElementById('statAbiertos').textContent = resp.data.abiertos.length;
      }
    } catch(_) {}
  },

  // ── EN JORNADA ─────────────────────────────────────────────
  async consultarAbiertos() {
    const lista = document.getElementById('listaAbiertos');
    lista.innerHTML = '<div class="loading-overlay"><div class="loader"></div><span>Cargando...</span></div>';

    try {
      const resp = await apiGet({ accion: 'admin_abiertos', pinAdmin: AdminState.pinAdmin });
      if (!resp.ok) { lista.innerHTML = '<div class="empty-state">Error al cargar</div>'; return; }

      const { abiertos } = resp.data;
      document.getElementById('statAbiertos').textContent = abiertos.length;

      if (!abiertos.length) {
        lista.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🟡</div>Ningún empleado en jornada ahora mismo.</div>';
        return;
      }

      lista.innerHTML = abiertos.map((a, i) => `
        <div class="registro-item" style="animation-delay:${i*60}ms">
          <div class="status-icon en-jornada" style="width:44px;height:44px;font-size:18px;">🟢</div>
          <div class="registro-info">
            <div class="registro-tipo">${a.nombre}</div>
            <div class="registro-fecha">Entrada: ${a.hora}</div>
          </div>
          <span class="badge badge-entrada">En jornada</span>
        </div>
      `).join('');

    } catch(err) {
      lista.innerHTML = '<div class="empty-state">Error de conexión</div>';
      console.error(err);
    }
  },

  // ── EMPLEADOS ──────────────────────────────────────────────
  async cargarEmpleados() {
    const lista = document.getElementById('listaEmpleados');
    lista.innerHTML = '<div class="loading-overlay"><div class="loader"></div><span>Cargando...</span></div>';

    try {
      const resp = await apiGet({ accion: 'admin_empleados', pinAdmin: AdminState.pinAdmin });
      if (!resp.ok) { lista.innerHTML = '<div class="empty-state">Error al cargar</div>'; return; }

      AdminState.empleados = resp.data.empleados;
      this.renderEmpleados(resp.data.empleados);

    } catch(err) {
      lista.innerHTML = '<div class="empty-state">Error de conexión</div>';
    }
  },

  renderEmpleados(empleados) {
    const lista = document.getElementById('listaEmpleados');

    if (!empleados.length) {
      lista.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👥</div>No hay empleados registrados.</div>';
      return;
    }

    lista.innerHTML = empleados.map((e, i) => `
      <div class="registro-item" style="animation-delay:${i*60}ms">
        <div style="width:44px;height:44px;border-radius:var(--radius-sm);
                    background:var(--surface-2);display:flex;align-items:center;
                    justify-content:center;font-size:20px;flex-shrink:0;">
          👤
        </div>
        <div class="registro-info">
          <div class="registro-tipo">${e.nombre}</div>
          <div class="registro-fecha">${e.id} · Alta: ${formatFechaLegible(e.fechaAlta)}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
          <span class="badge ${e.activo ? 'badge-entrada' : 'badge-error'}">
            ${e.activo ? 'Activo' : 'Inactivo'}
          </span>
          <button class="btn btn-ghost btn-sm"
                  onclick="Admin.toggleEmpleado('${e.id}', ${e.activo})">
            ${e.activo ? 'Desactivar' : 'Activar'}
          </button>
        </div>
      </div>
    `).join('');
  },

  async toggleEmpleado(idEmpleado, estadoActual) {
    const accion = estadoActual ? 'desactivar' : 'activar';
    if (!confirm(`¿Seguro que quieres ${accion} a este empleado?`)) return;

    try {
      const resp = await apiPost({
        accion: 'admin_toggle_empleado',
        pinAdmin: AdminState.pinAdmin,
        idEmpleado
      });

      if (resp.ok) {
        toast(`Empleado ${resp.data.activo ? 'activado' : 'desactivado'} correctamente`, 'success');
        this.cargarEmpleados();
      } else {
        toast(resp.error || 'Error al cambiar estado', 'error');
      }
    } catch(err) {
      toast('Error de conexión', 'error');
    }
  },

  // ── MODAL NUEVO EMPLEADO ───────────────────────────────────
  abrirModalNuevoEmpleado() {
    document.getElementById('nuevoNombre').value  = '';
    document.getElementById('nuevoPin').value     = '';
    document.getElementById('nuevoEmail').value   = '';
    document.getElementById('nuevoEmpError').style.display = 'none';
    document.getElementById('modalNuevoEmp').classList.add('show');
    setTimeout(() => document.getElementById('nuevoNombre').focus(), 350);
  },

  cerrarModal() {
    document.getElementById('modalNuevoEmp').classList.remove('show');
  },

  async crearEmpleado() {
    const nombre = document.getElementById('nuevoNombre').value.trim();
    const pin    = document.getElementById('nuevoPin').value.trim();
    const email  = document.getElementById('nuevoEmail').value.trim();
    const error  = document.getElementById('nuevoEmpError');
    const btn    = document.getElementById('nuevoEmpBtn');

    if (!nombre) { error.textContent = 'El nombre es obligatorio.'; error.style.display = 'block'; return; }
    if (!pin || pin.length !== 4 || !/^\d+$/.test(pin)) {
      error.textContent = 'El PIN debe ser exactamente 4 dígitos numéricos.';
      error.style.display = 'block'; return;
    }

    btn.disabled    = true;
    btn.innerHTML   = '<span class="loader"></span> Creando...';
    error.style.display = 'none';

    try {
      const resp = await apiPost({
        accion:    'admin_nuevo_empleado',
        pinAdmin:  AdminState.pinAdmin,
        nombre, pin, email
      });

      if (!resp.ok) {
        error.textContent   = resp.error || 'Error al crear empleado';
        error.style.display = 'block';
        return;
      }

      toast(`✅ Empleado "${nombre}" creado con ID ${resp.data.id}`, 'success', 5000);
      this.cerrarModal();
      this.cargarEmpleados();

    } catch(err) {
      error.textContent   = 'Error de conexión';
      error.style.display = 'block';
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Crear empleado';
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

    const csv = [cabecera, ...filas].map(f => f.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }); // BOM para Excel
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

  // Enter en PIN admin
  document.getElementById('adminPinInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') Admin.login();
  });

  // Enter en modal nuevo empleado
  document.getElementById('nuevoPin').addEventListener('keydown', e => {
    if (e.key === 'Enter') Admin.crearEmpleado();
  });

  // Auto-login si hay sesión
  const pinGuardado = sessionStorage.getItem('admin_pin');
  if (pinGuardado) {
    document.getElementById('adminPinInput').value = pinGuardado;
    Admin.login();
  }
});
