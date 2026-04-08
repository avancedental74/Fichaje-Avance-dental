// ============================================================
//  FICHAJE LABORAL — Code.gs (Google Apps Script)
//  Versión: 1.0 MVP — Avance Dental
// ============================================================

// ── CONFIGURACIÓN GLOBAL ────────────────────────────────────
const CONFIG = {
  SPREADSHEET_ID: '17EyfbaA00ff9x3lGIdlY6gb5i3D-pi29pCVPoHMhFVY',
  PIN_ADMIN: '1234',                          // ← CAMBIA ESTO por tu PIN secreto
  NOMBRE_EMPRESA: 'Avance Dental',
  MAX_HISTORIAL: 30,
  HOJAS: {
    EMPLEADOS: 'Empleados',
    REGISTROS: 'Registros',
    AUDITORIA: 'Auditoria'
  }
};

// ── CORS HEADERS ─────────────────────────────────────────────
function setCORSHeaders(output) {
  return output
    .setMimeType(ContentService.MimeType.JSON);
}

// ── RESPUESTAS ESTÁNDAR ───────────────────────────────────────
function respOk(data)   { return { ok: true,  data }; }
function respErr(msg)   { return { ok: false, error: msg }; }

function jsonResponse(obj) {
  return setCORSHeaders(
    ContentService.createTextOutput(JSON.stringify(obj))
  );
}

// ── GENERADOR DE UUID SIMPLE ──────────────────────────────────
function generarID() {
  return Utilities.getUuid();
}

// ── ACCESO A HOJAS ────────────────────────────────────────────
function getSheet(nombre) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let hoja = ss.getSheetByName(nombre);
  if (!hoja) {
    hoja = ss.insertSheet(nombre);
    inicializarHoja(hoja, nombre);
  }
  return hoja;
}

function inicializarHoja(hoja, nombre) {
  const headers = {
    [CONFIG.HOJAS.EMPLEADOS]: [
      'ID','Nombre','PIN','Activo','FechaAlta','Email','DNI','Puesto'
    ],
    [CONFIG.HOJAS.REGISTROS]: [
      'ID_Registro','ID_Empleado','Nombre_Empleado','Tipo',
      'Timestamp_Servidor','Timestamp_Cliente','Fecha',
      'IP','User_Agent','Latitud','Longitud','Observaciones','Sesion_ID'
    ],
    [CONFIG.HOJAS.AUDITORIA]: [
      'Timestamp','Accion','ID_Empleado','Detalle','IP'
    ]
  };
  if (headers[nombre]) {
    hoja.appendRow(headers[nombre]);
    hoja.getRange(1, 1, 1, headers[nombre].length)
        .setFontWeight('bold')
        .setBackground('#1a1a2e')
        .setFontColor('#ffffff');
    hoja.setFrozenRows(1);
  }
}

// ── AUDITORÍA ─────────────────────────────────────────────────
function auditLog(accion, idEmpleado, detalle, ip) {
  try {
    const hoja = getSheet(CONFIG.HOJAS.AUDITORIA);
    hoja.appendRow([
      new Date(),
      accion,
      idEmpleado || '',
      JSON.stringify(detalle),
      ip || ''
    ]);
  } catch(e) {
    console.error('AuditLog error:', e.message);
  }
}

// ── ROUTER PRINCIPAL ──────────────────────────────────────────
function doGet(e) {
  const params = e.parameter || {};
  const accion = params.accion || '';

  try {
    switch (accion) {
      case 'estado':          return jsonResponse(accionEstado(params));
      case 'historial':       return jsonResponse(accionHistorial(params));
      case 'admin_dia':       return jsonResponse(accionAdminDia(params));
      case 'admin_abiertos':  return jsonResponse(accionAdminAbiertos(params));
      case 'admin_empleados': return jsonResponse(accionAdminEmpleados(params));
      case 'check_setup':     return jsonResponse(accionCheckSetup());
      case 'ping':            return jsonResponse(respOk({ msg: 'OK', empresa: CONFIG.NOMBRE_EMPRESA }));
      default:                return jsonResponse(respErr('Acción no reconocida'));
    }
  } catch(err) {
    console.error('doGet error:', err.message);
    return jsonResponse(respErr('Error interno: ' + err.message));
  }
}

function doPost(e) {
  let body = {};
  try {
    body = JSON.parse(e.postData.contents);
  } catch(_) {
    return jsonResponse(respErr('JSON inválido'));
  }

  const accion = body.accion || '';
  const ip     = e.parameter?.ip || 'desconocida';

  try {
    switch (accion) {
      case 'fichar':                return jsonResponse(accionFichar(body, ip));
      case 'admin_nuevo_empleado':  return jsonResponse(accionNuevoEmpleado(body));
      case 'admin_editar_empleado': return jsonResponse(accionEditarEmpleado(body));
      case 'admin_toggle_empleado': return jsonResponse(accionToggleEmpleado(body));
      case 'bootstrap_admin':       return jsonResponse(respErr('No necesario en esta versión'));
      default:                      return jsonResponse(respErr('Acción POST no reconocida'));
    }
  } catch(err) {
    console.error('doPost error:', err.message);
    auditLog('ERROR', body.idEmpleado, { accion, error: err.message }, ip);
    return jsonResponse(respErr('Error interno: ' + err.message));
  }
}

// ── CHECK SETUP (para que admin.js no muestre pantalla de bootstrap) ──
function accionCheckSetup() {
  return respOk({ adminExists: true });
}

// ============================================================
//  LÓGICA DE EMPLEADOS
// ============================================================

function buscarEmpleadoPorPIN(pin) {
  const hoja  = getSheet(CONFIG.HOJAS.EMPLEADOS);
  const datos = hoja.getDataRange().getValues();
  for (let i = 1; i < datos.length; i++) {
    const [id, nombre, pinGuardado, activo] = datos[i];
    if (String(pinGuardado).trim() === String(pin).trim() && activo === true) {
      return { fila: i + 1, id, nombre, activo };
    }
  }
  return null;
}

function buscarEmpleadoPorID(idEmpleado) {
  const hoja  = getSheet(CONFIG.HOJAS.EMPLEADOS);
  const datos = hoja.getDataRange().getValues();
  for (let i = 1; i < datos.length; i++) {
    if (datos[i][0] === idEmpleado) {
      return { fila: i + 1, id: datos[i][0], nombre: datos[i][1], activo: datos[i][3] };
    }
  }
  return null;
}

// ============================================================
//  LÓGICA DE FICHAJE
// ============================================================

function accionFichar(body, ip) {
  const { pin, observaciones, latitud, longitud, timestampCliente } = body;
  if (!pin) return respErr('PIN requerido');

  const empleado = buscarEmpleadoPorPIN(pin);
  if (!empleado) {
    auditLog('LOGIN_FALLIDO', null, { pin: '****' }, ip);
    return respErr('PIN incorrecto o empleado inactivo');
  }

  const hoyStr    = formatFecha(new Date());
  const ultimoReg = getUltimoRegistroDia(empleado.id, hoyStr);

  let tipo, sesionID;

  // Jornada PARTIDA: se permite fichar varias veces al día
  // ENTRADA → SALIDA → ENTRADA → SALIDA → …
  if (!ultimoReg) {
    tipo     = 'ENTRADA';
    sesionID = generarID();
  } else if (ultimoReg.tipo === 'ENTRADA') {
    tipo     = 'SALIDA';
    sesionID = ultimoReg.sesionID;
  } else if (ultimoReg.tipo === 'SALIDA') {
    // Tras una salida se puede volver a entrar (jornada partida)
    tipo     = 'ENTRADA';
    sesionID = generarID();
  } else {
    return respErr('Estado desconocido. Contacta con administración.');
  }

  const ahora     = new Date();
  const idReg     = generarID();
  const userAgent = body.userAgent || '';

  const fila = [
    idReg,
    empleado.id,
    empleado.nombre,
    tipo,
    ahora,
    timestampCliente ? new Date(timestampCliente) : ahora,
    hoyStr,
    ip,
    userAgent,
    latitud  || '',
    longitud || '',
    observaciones || '',
    sesionID
  ];

  const hojaReg = getSheet(CONFIG.HOJAS.REGISTROS);
  hojaReg.appendRow(fila);

  auditLog('FICHAJE', empleado.id, { tipo, idReg, fecha: hoyStr }, ip);

  return respOk({
    tipo,
    nombre:     empleado.nombre,
    timestamp:  ahora.toISOString(),
    fecha:      hoyStr,
    hora:       formatHora(ahora),
    idRegistro: idReg
  });
}

// ── Estado actual del empleado ────────────────────────────────
function accionEstado(params) {
  const { pin } = params;
  if (!pin) return respErr('PIN requerido');

  const empleado = buscarEmpleadoPorPIN(pin);
  if (!empleado) return respErr('PIN incorrecto');

  const hoyStr    = formatFecha(new Date());
  const ultimoReg = getUltimoRegistroDia(empleado.id, hoyStr);
  const histHoy   = getRegistrosDia(empleado.id, hoyStr);

  const estado = !ultimoReg          ? 'LIBRE' :
                 ultimoReg.tipo === 'ENTRADA' ? 'EN_JORNADA' :
                 ultimoReg.tipo === 'SALIDA'  ? 'JORNADA_CERRADA' : 'DESCONOCIDO';

  return respOk({
    nombre: empleado.nombre,
    estado,
    ultimaAccion: ultimoReg ? {
      tipo:      ultimoReg.tipo,
      hora:      ultimoReg.hora,
      timestamp: ultimoReg.timestamp
    } : null,
    registrosHoy: histHoy
  });
}

// ── Historial personal ────────────────────────────────────────
function accionHistorial(params) {
  const { pin, limite } = params;
  if (!pin) return respErr('PIN requerido');

  const empleado = buscarEmpleadoPorPIN(pin);
  if (!empleado) return respErr('PIN incorrecto');

  const hoja  = getSheet(CONFIG.HOJAS.REGISTROS);
  const datos = hoja.getDataRange().getValues();
  const max   = parseInt(limite) || CONFIG.MAX_HISTORIAL;

  const registros = [];
  for (let i = datos.length - 1; i >= 1; i--) {
    if (datos[i][1] === empleado.id) {
      registros.push(formatRegistro(datos[i]));
      if (registros.length >= max) break;
    }
  }

  return respOk({ nombre: empleado.nombre, registros });
}

// ============================================================
//  PANEL ADMIN
// ============================================================

function verificarAdmin(pinAdmin) {
  return String(pinAdmin).trim() === String(CONFIG.PIN_ADMIN).trim();
}

function accionAdminDia(params) {
  const { pinAdmin, fecha, idEmpleado } = params;
  if (!verificarAdmin(pinAdmin)) return respErr('Acceso denegado');

  const fechaBuscar = fecha || formatFecha(new Date());
  const hoja  = getSheet(CONFIG.HOJAS.REGISTROS);
  const datos = hoja.getDataRange().getValues();

  const registros = [];
  for (let i = 1; i < datos.length; i++) {
    const reg = datos[i];
    if (reg[6] === fechaBuscar) {
      if (!idEmpleado || reg[1] === idEmpleado) {
        registros.push(formatRegistro(reg));
      }
    }
  }

  registros.sort((a, b) => new Date(b.timestampServidor) - new Date(a.timestampServidor));
  auditLog('ADMIN_CONSULTA', 'ADMIN', { accion: 'admin_dia', fecha: fechaBuscar }, '');
  return respOk({ fecha: fechaBuscar, total: registros.length, registros });
}

function accionAdminAbiertos(params) {
  const { pinAdmin } = params;
  if (!verificarAdmin(pinAdmin)) return respErr('Acceso denegado');

  const hoyStr = formatFecha(new Date());
  const hoja   = getSheet(CONFIG.HOJAS.REGISTROS);
  const datos  = hoja.getDataRange().getValues();

  const mapaUltimo = {};
  for (let i = 1; i < datos.length; i++) {
    const reg = datos[i];
    if (reg[6] === hoyStr) {
      mapaUltimo[reg[1]] = {
        tipo:      reg[3],
        nombre:    reg[2],
        hora:      formatHora(reg[4]),
        timestamp: reg[4]
      };
    }
  }

  const abiertos = Object.entries(mapaUltimo)
    .filter(([_, r]) => r.tipo === 'ENTRADA')
    .map(([id, r]) => ({ idEmpleado: id, ...r }));

  return respOk({ fecha: hoyStr, abiertos });
}

function accionAdminEmpleados(params) {
  const { pinAdmin } = params;
  if (!verificarAdmin(pinAdmin)) return respErr('Acceso denegado');

  const hoja  = getSheet(CONFIG.HOJAS.EMPLEADOS);
  const datos = hoja.getDataRange().getValues();

  const empleados = datos.slice(1).map(fila => ({
    id:        fila[0],
    nombre:    fila[1],
    activo:    fila[3],
    fechaAlta: fila[4] ? formatFecha(new Date(fila[4])) : '',
    email:     fila[5] || '',
    dni:       fila[6] || '',
    puesto:    fila[7] || ''
  }));

  return respOk({ empleados });
}

function accionNuevoEmpleado(body) {
  const { pinAdmin, nombre, pin, email, dni, puesto } = body;
  if (!verificarAdmin(pinAdmin)) return respErr('Acceso denegado');
  if (!nombre || !pin)           return respErr('Nombre y PIN son obligatorios');
  if (String(pin).length !== 4)  return respErr('El PIN debe tener 4 dígitos');

  const hoja  = getSheet(CONFIG.HOJAS.EMPLEADOS);
  const datos = hoja.getDataRange().getValues();

  for (let i = 1; i < datos.length; i++) {
    if (String(datos[i][2]).trim() === String(pin).trim()) {
      return respErr('Ese PIN ya está en uso');
    }
  }

  const id = 'EMP' + String(datos.length).padStart(3, '0');
  hoja.appendRow([id, nombre, pin, true, new Date(), email || '', dni || '', puesto || '']);

  auditLog('NUEVO_EMPLEADO', 'ADMIN', { id, nombre, dni, puesto }, '');
  return respOk({ id, nombre, mensaje: 'Empleado creado correctamente' });
}

function accionEditarEmpleado(body) {
  const { pinAdmin, idEmpleado, nombre, pin, email, dni, puesto } = body;
  if (!verificarAdmin(pinAdmin)) return respErr('Acceso denegado');
  if (!idEmpleado || !nombre)    return respErr('ID y nombre son obligatorios');

  const hoja  = getSheet(CONFIG.HOJAS.EMPLEADOS);
  const datos = hoja.getDataRange().getValues();

  for (let i = 1; i < datos.length; i++) {
    if (datos[i][0] === idEmpleado) {
      hoja.getRange(i + 1, 2).setValue(nombre);
      hoja.getRange(i + 1, 6).setValue(email || '');
      hoja.getRange(i + 1, 7).setValue(dni || '');
      hoja.getRange(i + 1, 8).setValue(puesto || '');
      if (pin && String(pin).length === 4) {
        hoja.getRange(i + 1, 3).setValue(pin);
      }
      auditLog('EDITAR_EMPLEADO', 'ADMIN', { idEmpleado, nombre }, '');
      return respOk({ id: idEmpleado, nombre, mensaje: 'Empleado actualizado' });
    }
  }
  return respErr('Empleado no encontrado');
}

function accionToggleEmpleado(body) {
  const { pinAdmin, idEmpleado } = body;
  if (!verificarAdmin(pinAdmin)) return respErr('Acceso denegado');
  if (!idEmpleado)               return respErr('ID de empleado requerido');

  const hoja  = getSheet(CONFIG.HOJAS.EMPLEADOS);
  const datos = hoja.getDataRange().getValues();

  for (let i = 1; i < datos.length; i++) {
    if (datos[i][0] === idEmpleado) {
      const nuevoEstado = !datos[i][3];
      hoja.getRange(i + 1, 4).setValue(nuevoEstado);
      return respOk({ id: idEmpleado, activo: nuevoEstado });
    }
  }
  return respErr('Empleado no encontrado');
}

// ============================================================
//  HELPERS DE DATOS
// ============================================================

function getUltimoRegistroDia(idEmpleado, fechaStr) {
  const hoja  = getSheet(CONFIG.HOJAS.REGISTROS);
  const datos = hoja.getDataRange().getValues();
  let ultimo  = null;

  for (let i = 1; i < datos.length; i++) {
    const reg = datos[i];
    if (reg[1] === idEmpleado && reg[6] === fechaStr) {
      if (!ultimo || new Date(reg[4]) > new Date(ultimo.timestamp)) {
        ultimo = {
          tipo:      reg[3],
          timestamp: reg[4],
          hora:      formatHora(reg[4]),
          sesionID:  reg[12]
        };
      }
    }
  }
  return ultimo;
}

function getRegistrosDia(idEmpleado, fechaStr) {
  const hoja  = getSheet(CONFIG.HOJAS.REGISTROS);
  const datos = hoja.getDataRange().getValues();
  const regs  = [];

  for (let i = 1; i < datos.length; i++) {
    const reg = datos[i];
    if (reg[1] === idEmpleado && reg[6] === fechaStr) {
      regs.push({ tipo: reg[3], hora: formatHora(reg[4]) });
    }
  }
  return regs.sort((a, b) => a.hora.localeCompare(b.hora));
}

function formatRegistro(fila) {
  return {
    idRegistro:        fila[0],
    idEmpleado:        fila[1],
    nombre:            fila[2],
    tipo:              fila[3],
    timestampServidor: fila[4] ? new Date(fila[4]).toISOString() : '',
    fecha:             fila[6],
    hora:              fila[4] ? formatHora(fila[4]) : '',
    latitud:           fila[9]  || null,
    longitud:          fila[10] || null,
    observaciones:     fila[11] || ''
  };
}

function formatFecha(date) {
  const d   = new Date(date);
  const año = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${año}-${mes}-${dia}`;
}

function formatHora(date) {
  const d = new Date(date);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

// ============================================================
//  SETUP INICIAL — Ejecutar UNA SOLA VEZ manualmente
// ============================================================
function setupInicial() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  ['Empleados', 'Registros', 'Auditoria'].forEach(nombre => {
    if (!ss.getSheetByName(nombre)) {
      const h = ss.insertSheet(nombre);
      inicializarHoja(h, nombre);
    }
  });

  // Empleado de prueba — bórralo después de probar
  const hEmpleados = ss.getSheetByName('Empleados');
  hEmpleados.appendRow(['EMP001', 'Empleado Demo', '1111', true, new Date(), 'demo@avancedental.com']);

  Logger.log('✅ Setup completado. Empleado demo PIN: 1111 | Admin PIN: ' + CONFIG.PIN_ADMIN);
}
