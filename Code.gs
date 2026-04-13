// ============================================================
//  FICHAJE LABORAL — Code.gs (Google Apps Script)
//  Versión: 1.2 — Fix estado real fichado + panel admin en tiempo real
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
    AUDITORIA: 'Auditoria',
    ALERTAS:   'Alertas'
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
      'ID','Nombre','PIN','Activo','FechaAlta','Email','DNI','Puesto',
      'Turno1_Entrada','Turno1_Salida','Turno2_Entrada','Turno2_Salida','Push_Token'
    ],
    [CONFIG.HOJAS.REGISTROS]: [
      'ID_Registro','ID_Empleado','Nombre_Empleado','Tipo',
      'Timestamp_Servidor','Timestamp_Cliente','Fecha',
      'IP','User_Agent','Latitud','Longitud','Observaciones','Sesion_ID'
    ],
    [CONFIG.HOJAS.AUDITORIA]: [
      'Timestamp','Accion','ID_Empleado','Detalle','IP'
    ],
    [CONFIG.HOJAS.ALERTAS]: [
      'ID_Alerta','ID_Empleado','Nombre_Empleado','Turno_Entrada',
      'Minutos_Retraso','Timestamp_Cliente','Timestamp_Servidor','Resuelta'
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
      case 'check_setup':     
        verificarYActualizarColumnas(); // ← Actualización automática aquí
        return jsonResponse(accionCheckSetup());
      case 'ping':            return jsonResponse(respOk({ msg: 'OK', empresa: CONFIG.NOMBRE_EMPRESA }));
      default:                return jsonResponse(respErr('Acción no reconocida'));
    }
  } catch(err) {
    console.error('doGet error:', err.message);
    return jsonResponse(respErr('Error interno: ' + err.message));
  }
}

// ── FUNCIÓN PARA AÑADIR COLUMNAS AUTOMÁTICAMENTE ──────────────
function verificarYActualizarColumnas() {
  const hoja = getSheet(CONFIG.HOJAS.EMPLEADOS);
  const headers = hoja.getRange(1, 1, 1, hoja.getLastColumn()).getValues()[0];
  
  if (!headers.includes('Push_Token')) {
    hoja.getRange(1, headers.length + 1).setValue('Push_Token')
        .setFontWeight('bold')
        .setBackground('#1a1a2e')
        .setFontColor('#ffffff');
    console.log('Columna Push_Token añadida automáticamente');
  }
}

// ─────────────────────────────────────────────────────────────
//  FIX: Las acciones de admin se reciben siempre por POST
//  (el pinAdmin viaja en el body, nunca en la URL).
// ─────────────────────────────────────────────────────────────
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
      // ── Fichaje de empleados ───────────────────────────────
      case 'fichar':                  return jsonResponse(accionFichar(body, ip));
      case 'alerta_no_fichaje':       return jsonResponse(accionAlertaNoFichaje(body, ip));

      // ── Acciones de lectura admin (pinAdmin en body POST) ──
      case 'admin_empleados':         return jsonResponse(accionAdminEmpleados(body));
      case 'admin_dia':               return jsonResponse(accionAdminDia(body));
      case 'admin_abiertos':          return jsonResponse(accionAdminAbiertos(body));
      case 'admin_alertas_nofichaje': return jsonResponse(accionAdminAlertasNoFichaje(body));

      // ── Acciones de escritura admin ────────────────────────
      case 'admin_resolver_alerta':   return jsonResponse(accionResolverAlerta(body));
      case 'admin_nuevo_empleado':    return jsonResponse(accionNuevoEmpleado(body));
      case 'admin_editar_empleado':   return jsonResponse(accionEditarEmpleado(body));
      case 'admin_toggle_empleado':   return jsonResponse(accionToggleEmpleado(body));
      case 'guardar_token':           return jsonResponse(accionGuardarToken(body));

      case 'bootstrap_admin':         return jsonResponse(respErr('No necesario en esta versión'));
      default:                        return jsonResponse(respErr('Acción POST no reconocida'));
    }
  } catch(err) {
    console.error('doPost error:', err.message);
    auditLog('ERROR', body.idEmpleado, { accion, error: err.message }, ip);
    return jsonResponse(respErr('Error interno: ' + err.message));
  }
}

// ── CHECK SETUP ───────────────────────────────────────────────
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
    const [id, nombre, pinGuardado, activo,,,,, t1e, t1s, t2e, t2s] = datos[i];
    if (String(pinGuardado).trim() === String(pin).trim() && activo === true) {
      const turnos = [];
      if (t1e && t1s) turnos.push({ entrada: t1e, salida: t1s });
      if (t2e && t2s) turnos.push({ entrada: t2e, salida: t2s });
      return { fila: i + 1, id, nombre, activo, turnos };
    }
  }
  return null;
}

function buscarEmpleadoPorID(idEmpleado) {
  const hoja  = getSheet(CONFIG.HOJAS.EMPLEADOS);
  const datos = hoja.getDataRange().getValues();
  for (let i = 1; i < datos.length; i++) {
    if (datos[i][0] === idEmpleado) {
      return { 
        fila: i + 1, 
        id: datos[i][0], 
        nombre: datos[i][1], 
        activo: datos[i][3],
        pushToken: datos[i][12] || null 
      };
    }
  }
  return null;
}

function accionGuardarToken(body) {
  const { pin, token } = body;
  if (!pin || !token) return respErr('Faltan datos');
  const empleado = buscarEmpleadoPorPIN(pin);
  if (!empleado) return respErr('PIN inválido');
  const hoja = getSheet(CONFIG.HOJAS.EMPLEADOS);
  hoja.getRange(empleado.fila, 13).setValue(JSON.stringify(token));
  return respOk({ mensaje: 'Notificaciones activadas correctamente' });
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

  // FIX: Devolvemos también el nuevo estado esperado para que app.js
  // pueda actualizar el botón sin necesidad de hacer otra consulta
  const nuevoEstado = tipo === 'ENTRADA' ? 'EN_JORNADA' : 'LIBRE';

  return respOk({
    tipo,
    nuevoEstado,         // ← NUEVO: app.js lo usa para actualizar el botón al instante
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

  // FIX: JORNADA_CERRADA solo cuando el último tipo del día es SALIDA.
  // Si no hay registro hoy → LIBRE (puede fichar entrada).
  // Si el último es ENTRADA → EN_JORNADA (debe fichar salida).
  // Si el último es SALIDA  → LIBRE (puede fichar otra entrada, jornada partida).
  const estado = !ultimoReg
    ? 'LIBRE'
    : ultimoReg.tipo === 'ENTRADA'
      ? 'EN_JORNADA'
      : 'LIBRE';   // ← FIX: era 'JORNADA_CERRADA', ahora es LIBRE para permitir jornada partida y que el botón sea correcto

  return respOk({
    nombre: empleado.nombre,
    estado,
    turnos: empleado.turnos,
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
    if (normalizarFecha(reg[6]) === fechaBuscar) {
      if (!idEmpleado || reg[1] === idEmpleado) {
        registros.push(formatRegistro(reg));
      }
    }
  }

  registros.sort((a, b) => new Date(b.timestampServidor) - new Date(a.timestampServidor));
  auditLog('ADMIN_CONSULTA', 'ADMIN', { accion: 'admin_dia', fecha: fechaBuscar }, '');
  return respOk({ fecha: fechaBuscar, total: registros.length, registros });
}

// ──────────────────────────────────────────────────────────────
//  FIX PRINCIPAL — accionAdminAbiertos
//
//  BUG ANTERIOR: mapaUltimo[reg[1]] se sobreescribía sin comparar
//  timestamps, por lo que si las filas no estaban en orden
//  cronológico perfecto el "último" podía ser incorrecto.
//  El resultado: empleados aparecían como "en jornada" cuando ya
//  habían fichado la salida, o viceversa.
//
//  FIX: comparar el Timestamp_Servidor (columna 4) antes de
//  sobreescribir. Solo se queda el registro más reciente real.
//  Además se añade horaEntrada para mostrar en el panel cuándo
//  entró cada empleado.
// ──────────────────────────────────────────────────────────────
function accionAdminAbiertos(params) {
  const { pinAdmin } = params;
  if (!verificarAdmin(pinAdmin)) return respErr('Acceso denegado');

  const hoyStr = formatFecha(new Date());
  const hoja   = getSheet(CONFIG.HOJAS.REGISTROS);
  const datos  = hoja.getDataRange().getValues();

  // mapaUltimo: { idEmpleado → { tipo, nombre, hora, timestamp (Date) } }
  const mapaUltimo = {};

  for (let i = 1; i < datos.length; i++) {
    const reg = datos[i];
    if (normalizarFecha(reg[6]) !== hoyStr) continue;  // solo registros de hoy

    const idEmp    = reg[1];
    const tsActual = reg[4] ? new Date(reg[4]) : new Date(0);

    // FIX: solo sobreescribir si este registro es MÁS RECIENTE que el guardado
    if (!mapaUltimo[idEmp] || tsActual > mapaUltimo[idEmp].timestamp) {
      mapaUltimo[idEmp] = {
        tipo:      reg[3],
        nombre:    reg[2],
        hora:      formatHora(reg[4]),
        timestamp: tsActual
      };
    }
  }

  // Para los que están EN_JORNADA, buscamos también la hora de su última ENTRADA
  // (para mostrar "lleva X horas trabajando" en el panel)
  const horaEntradaPor = {};
  for (let i = 1; i < datos.length; i++) {
    const reg = datos[i];
    if (normalizarFecha(reg[6]) !== hoyStr || reg[3] !== 'ENTRADA') continue;
    const idEmp = reg[1];
    const ts    = reg[4] ? new Date(reg[4]) : new Date(0);
    if (!horaEntradaPor[idEmp] || ts > horaEntradaPor[idEmp].ts) {
      horaEntradaPor[idEmp] = { hora: formatHora(reg[4]), ts };
    }
  }

  const abiertos = Object.entries(mapaUltimo)
    .filter(([_, r]) => r.tipo === 'ENTRADA')
    .map(([id, r]) => ({
      idEmpleado:   id,
      nombre:       r.nombre,
      horaEntrada:  horaEntradaPor[id]?.hora || r.hora,   // hora real de entrada
      horaUltReg:   r.hora,
      timestamp:    r.timestamp.toISOString()
    }));

  // Ordenar por hora de entrada ascendente (quien llegó antes, primero)
  abiertos.sort((a, b) => a.horaEntrada.localeCompare(b.horaEntrada));

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
    puesto:    fila[7] || '',
    turno1_entrada: fila[8]  || '',
    turno1_salida:  fila[9]  || '',
    turno2_entrada: fila[10] || '',
    turno2_salida:  fila[11] || ''
  }));

  return respOk({ empleados });
}

function accionNuevoEmpleado(body) {
  const { pinAdmin, nombre, pin, email, dni, puesto,
          turno1_entrada, turno1_salida, turno2_entrada, turno2_salida } = body;
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
  hoja.appendRow([
    id, nombre, pin, true, new Date(), email || '', dni || '', puesto || '',
    turno1_entrada || '', turno1_salida || '',
    turno2_entrada || '', turno2_salida || ''
  ]);

  auditLog('NUEVO_EMPLEADO', 'ADMIN', { id, nombre, dni, puesto }, '');
  return respOk({ id, nombre, mensaje: 'Empleado creado correctamente' });
}

function accionEditarEmpleado(body) {
  const { pinAdmin, idEmpleado, nombre, pin, email, dni, puesto,
          turno1_entrada, turno1_salida, turno2_entrada, turno2_salida } = body;
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
      // Turnos (columnas 9–12)
      hoja.getRange(i + 1, 9).setValue(turno1_entrada || '');
      hoja.getRange(i + 1, 10).setValue(turno1_salida  || '');
      hoja.getRange(i + 1, 11).setValue(turno2_entrada || '');
      hoja.getRange(i + 1, 12).setValue(turno2_salida  || '');
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
//  ALERTAS DE NO-FICHAJE
// ============================================================

// POST accion:'alerta_no_fichaje' — llamado desde el SW del empleado
function accionAlertaNoFichaje(body, ip) {
  const { pin, turnoEntrada, minutosRetraso, timestampCliente } = body;
  if (!pin) return respErr('PIN requerido');

  const empleado = buscarEmpleadoPorPIN(pin);
  if (!empleado) return respErr('PIN incorrecto o empleado inactivo');

  const hoyStr = formatFecha(new Date());

  // Idempotencia: una sola alerta por empleado + turno + día
  const hoja  = getSheet(CONFIG.HOJAS.ALERTAS);
  const datos = hoja.getDataRange().getValues();
  for (let i = 1; i < datos.length; i++) {
    const tsAlerta = datos[i][6] instanceof Date ? datos[i][6] : new Date(datos[i][6]);
    if (datos[i][1] === empleado.id &&
        datos[i][3] === turnoEntrada &&
        formatFecha(tsAlerta) === hoyStr) {
      // Ya existe → actualizar minutos de retraso pero no duplicar
      hoja.getRange(i + 1, 5).setValue(minutosRetraso || datos[i][4]);
      return respOk({ mensaje: 'Alerta actualizada', id: datos[i][0] });
    }
  }

  // Nueva alerta
  const idAlerta = generarID();
  hoja.appendRow([
    idAlerta,
    empleado.id,
    empleado.nombre,
    turnoEntrada   || '',
    minutosRetraso || 0,
    timestampCliente ? new Date(timestampCliente) : new Date(),
    new Date(),    // Timestamp_Servidor
    false          // Resuelta
  ]);

  auditLog('ALERTA_NO_FICHAJE', empleado.id,
    { turnoEntrada, minutosRetraso, fecha: hoyStr }, ip);

  return respOk({ mensaje: 'Alerta registrada', id: idAlerta });
}

// GET/POST accion:'admin_alertas_nofichaje' — panel admin
function accionAdminAlertasNoFichaje(params) {
  const { pinAdmin } = params;
  if (!verificarAdmin(pinAdmin)) return respErr('Acceso denegado');

  const hoyStr = formatFecha(new Date());
  const hoja   = getSheet(CONFIG.HOJAS.ALERTAS);
  const datos  = hoja.getDataRange().getValues();

  const alertas = [];
  for (let i = 1; i < datos.length; i++) {
    const fila = datos[i];
    // Solo alertas de hoy no resueltas
    const tsAlerta = fila[6] instanceof Date ? fila[6] : new Date(fila[6]);
    if (formatFecha(tsAlerta) === hoyStr && !fila[7]) {
      alertas.push({
        idAlerta:          fila[0],
        idEmpleado:        fila[1],
        nombre:            fila[2],
        turnoEntrada:      fila[3],
        minutosRetraso:    fila[4],
        timestampCliente:  fila[5] ? new Date(fila[5]).toISOString() : '',
        timestampServidor: fila[6] ? new Date(fila[6]).toISOString() : ''
      });
    }
  }

  // Ordenar por más retraso primero
  alertas.sort((a, b) => b.minutosRetraso - a.minutosRetraso);

  return respOk({ fecha: hoyStr, alertas });
}

// POST accion:'admin_resolver_alerta' — marcar como resuelta desde el panel
function accionResolverAlerta(body) {
  const { pinAdmin, idAlerta } = body;
  if (!verificarAdmin(pinAdmin)) return respErr('Acceso denegado');
  if (!idAlerta)                 return respErr('ID de alerta requerido');

  const hoja  = getSheet(CONFIG.HOJAS.ALERTAS);
  const datos = hoja.getDataRange().getValues();

  for (let i = 1; i < datos.length; i++) {
    if (datos[i][0] === idAlerta) {
      hoja.getRange(i + 1, 8).setValue(true);  // columna Resuelta
      auditLog('ALERTA_RESUELTA', 'ADMIN', { idAlerta }, '');
      return respOk({ idAlerta, resuelta: true });
    }
  }
  return respErr('Alerta no encontrada');
}

// ============================================================
//  HELPERS DE DATOS
// ============================================================

// FIX: getUltimoRegistroDia ya comparaba timestamps correctamente.
// Se mantiene igual, solo se añade sesionID al objeto devuelto.
function getUltimoRegistroDia(idEmpleado, fechaStr) {
  const hoja  = getSheet(CONFIG.HOJAS.REGISTROS);
  const datos = hoja.getDataRange().getValues();
  let ultimo  = null;

  for (let i = 1; i < datos.length; i++) {
    const reg = datos[i];
    if (reg[1] === idEmpleado && normalizarFecha(reg[6]) === fechaStr) {
      const ts = reg[4] ? new Date(reg[4]) : new Date(0);
      if (!ultimo || ts > new Date(ultimo.timestamp)) {
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
    if (reg[1] === idEmpleado && normalizarFecha(reg[6]) === fechaStr) {
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
    fecha:             normalizarFecha(fila[6]),   // normalizar por si Sheets lo convirtió a Date
    hora:              fila[4] ? formatHora(fila[4]) : '',
    latitud:           fila[9]  || null,
    longitud:          fila[10] || null,
    observaciones:     fila[11] || ''
  };
}

function formatFecha(date) {
  const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  return Utilities.formatDate(new Date(date), tz, "yyyy-MM-dd");
}

function formatHora(date) {
  const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  return Utilities.formatDate(new Date(date), tz, "HH:mm");
}

// ── NORMALIZAR FECHA ──────────────────────────────────────────
// Google Sheets auto-convierte strings "YYYY-MM-DD" a objetos Date
// al leerlos con getDataRange().getValues(). Esta función maneja
// ambos casos para que todas las comparaciones de fecha sean seguras.
function normalizarFecha(val) {
  if (!val) return '';
  if (val instanceof Date) return formatFecha(val);
  return String(val).slice(0, 10); // garantiza "YYYY-MM-DD"
}

// ============================================================
//  SISTEMA DE RECORDATORIOS PROGRAMADOS (Para iOS y Olvidos)
// ============================================================

/**
 * Esta función debe configurarse con un disparador (Trigger) 
 * de Google Apps Script para que se ejecute cada 1 minuto.
 */
function procesarRecordatoriosProgramados() {
  const ahoraStr = formatHora(new Date());
  const hoyStr   = formatFecha(new Date());
  const hojaEmp  = getSheet(CONFIG.HOJAS.EMPLEADOS);
  const datosEmp = hojaEmp.getDataRange().getValues();

  console.log(`[Cron] Ejecutando recordatorios para las ${ahoraStr}`);

  for (let i = 1; i < datosEmp.length; i++) {
    const [id, nombre, , activo, , , , , t1e, t1s, t2e, t2s, pushToken] = datosEmp[i];
    if (!activo) continue;

    const turnos = [];
    if (t1e && t1s) turnos.push({ entrada: t1e, salida: t1s });
    if (t2e && t2s) turnos.push({ entrada: t2e, salida: t2s });

    const ultimoReg = getUltimoRegistroDia(id, hoyStr);
    const estado    = !ultimoReg ? 'LIBRE' : (ultimoReg.tipo === 'ENTRADA' ? 'EN_JORNADA' : 'LIBRE');

    for (const turno of turnos) {
      // Recordatorio de ENTRADA (si pasa 1 min de su hora y sigue LIBRE)
      if (estado === 'LIBRE' && ahoraStr === sumarMinutos(turno.entrada, 1)) {
        enviarPushRecordatorio(pushToken, nombre, 'ENTRADA', id);
      }
      // Recordatorio de SALIDA (si pasa 1 min de su hora y sigue EN_JORNADA)
      if (estado === 'EN_JORNADA' && ahoraStr === sumarMinutos(turno.salida, 1)) {
        enviarPushRecordatorio(pushToken, nombre, 'SALIDA', id);
      }
    }
  }
}

function enviarPushRecordatorio(token, nombre, tipo, idEmpleado) {
  if (!token) {
    console.warn(`[Push] El empleado ${nombre} no tiene token activo.`);
    return;
  }
  
  const titulo  = tipo === 'ENTRADA' ? '🟢 ¿Vas a entrar?' : '🔴 ¿Has terminado?';
  const mensaje = `${nombre}, es tu hora de fichar la ${tipo.toLowerCase()}. ¡No te olvides!`;
  
  // Aquí usamos el sistema de Alertas para que el admin lo vea también
  accionAlertaNoFichaje({
    pin: 'SISTEMA', // bypass para log interno
    idEmpleado: idEmpleado,
    turnoEntrada: tipo,
    minutosRetraso: 1,
    timestampCliente: new Date().toISOString()
  }, 'SERVIDOR');

  console.log(`[Push] Enviando aviso de ${tipo} a ${nombre}...`);
  // Nota: Para enviar notificaciones reales a iOS/PWA se requiere 
  // un servicio de relay Web-Push o Firebase FCM.
  // Por ahora lo dejamos registrado en la hoja de ALERTAS para auditoría.
}

function sumarMinutos(horaStr, mins) {
  const [h, m] = horaStr.split(':').map(Number);
  const date   = new Date();
  date.setHours(h, m + mins, 0, 0);
  return formatHora(date);
}

// Re-emplazamos setupInicial para incluir el trigger y las hojas si no existen
function setupFinal() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  // 1. Crear hojas si no existen
  ['Empleados', 'Registros', 'Auditoria', 'Alertas'].forEach(nombre => {
    if (!ss.getSheetByName(nombre)) {
      const h = ss.insertSheet(nombre);
      inicializarHoja(h, nombre);
    }
  });

  // 2. Borrar triggers previos para no duplicar
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'procesarRecordatoriosProgramados') {
      ScriptApp.deleteTrigger(t);
    }
  });

  // 3. Crear disparador cada minuto
  ScriptApp.newTrigger('procesarRecordatoriosProgramados')
           .timeBased()
           .everyMinutes(1)
           .create();
           
  console.log('✅ Sistema COMPLETADO: Hojas verificadas y Recordatorios activados cada 1 min.');
}

function setupInicial() {
  // Mantenemos esta función por compatibilidad si se llama manualmente
  setupFinal();
}
