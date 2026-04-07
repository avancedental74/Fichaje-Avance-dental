// ============================================================
//  FICHAJE LABORAL — Code.gs (Google Apps Script)
//  Backend completo: empleados, admin, fichaje, bootstrap
//  Versión: 2.0
// ============================================================

// ── CONFIGURACIÓN ────────────────────────────────────────────
// Cambia este valor por uno secreto antes de desplegar.
// Solo se usará UNA VEZ para crear el primer admin.
// Después de crear el primer admin, este valor ya no tiene efecto.
var BOOTSTRAP_SECRET = 'CAMBIA_ESTO_POR_ALGO_SECRETO_2024';

// Nombre exacto de las hojas en tu Google Sheet
var HOJA_EMPLEADOS = 'Empleados';
var HOJA_REGISTROS = 'Registros';
var HOJA_ADMINS    = 'Admins';
var HOJA_CONFIG    = 'Config';

// ── CABECERAS DE HOJAS ───────────────────────────────────────
var COLS_EMPLEADOS = ['id', 'nombre', 'email', 'pin', 'activo', 'fechaAlta'];
var COLS_REGISTROS = ['idRegistro', 'idEmpleado', 'nombre', 'tipo', 'fecha', 'hora',
                      'timestampServidor', 'latitud', 'longitud', 'userAgent', 'observaciones'];
var COLS_ADMINS    = ['id', 'nombre', 'email', 'pin', 'fechaAlta'];
var COLS_CONFIG    = ['clave', 'valor'];

// ============================================================
//  ENTRY POINTS — doGet / doPost
// ============================================================

function doGet(e) {
  var params = e.parameter || {};
  var accion = params.accion || '';
  var res;

  try {
    switch (accion) {

      // ── EMPLEADO ──────────────────────────────────────────
      case 'estado':
        res = accionEstado(params);
        break;
      case 'historial':
        res = accionHistorial(params);
        break;

      // ── ADMIN ─────────────────────────────────────────────
      case 'admin_empleados':
        res = accionAdminEmpleados(params);
        break;
      case 'admin_dia':
        res = accionAdminDia(params);
        break;
      case 'admin_abiertos':
        res = accionAdminAbiertos(params);
        break;

      // ── BOOTSTRAP ─────────────────────────────────────────
      case 'check_setup':
        res = accionCheckSetup();
        break;

      default:
        res = error('Acción desconocida');
    }
  } catch (err) {
    res = error('Error interno: ' + err.message);
    Logger.log('doGet error [' + accion + ']: ' + err.message);
  }

  return jsonResponse(res);
}

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse(e.postData.contents);
  } catch (_) {
    return jsonResponse(error('JSON inválido'));
  }

  var accion = body.accion || '';
  var res;

  try {
    switch (accion) {

      // ── EMPLEADO ──────────────────────────────────────────
      case 'fichar':
        res = accionFichar(body);
        break;

      // ── ADMIN — EMPLEADOS ─────────────────────────────────
      case 'admin_nuevo_empleado':
        res = accionAdminNuevoEmpleado(body);
        break;
      case 'admin_editar_empleado':
        res = accionAdminEditarEmpleado(body);
        break;
      case 'admin_toggle_empleado':
        res = accionAdminToggleEmpleado(body);
        break;

      // ── BOOTSTRAP — PRIMER ADMIN ──────────────────────────
      case 'bootstrap_admin':
        res = accionBootstrapAdmin(body);
        break;

      default:
        res = error('Acción desconocida');
    }
  } catch (err) {
    res = error('Error interno: ' + err.message);
    Logger.log('doPost error [' + accion + ']: ' + err.message);
  }

  return jsonResponse(res);
}

// ============================================================
//  ACCIÓN: check_setup
//  El frontend llama esto al arrancar para saber si existe admin
// ============================================================

function accionCheckSetup() {
  var hoja = getHoja(HOJA_ADMINS);
  if (!hoja) return ok({ adminExists: false });

  var datos = hoja.getDataRange().getValues();
  // Fila 1 = cabeceras; si solo hay cabeceras o está vacía → no hay admin
  var hayAdmin = datos.length > 1;
  return ok({ adminExists: hayAdmin });
}

// ============================================================
//  ACCIÓN: bootstrap_admin
//  Crea el PRIMER administrador si y solo si no existe ninguno
// ============================================================

function accionBootstrapAdmin(body) {
  var secret  = body.bootstrapSecret || '';
  var nombre  = (body.nombre  || '').trim();
  var pin     = (body.pin     || '').trim();
  var email   = (body.email   || '').trim();

  // Validar el secreto de instalación
  if (secret !== BOOTSTRAP_SECRET) {
    return error('Clave de instalación incorrecta.');
  }

  // Bloquear si ya existe al menos un admin
  var hojaAdmins = getOCrearHoja(HOJA_ADMINS, COLS_ADMINS);
  var datos = hojaAdmins.getDataRange().getValues();
  if (datos.length > 1) {
    return error('Ya existe un administrador. El bootstrap está bloqueado.');
  }

  // Validaciones básicas
  if (!nombre || nombre.length < 2) return error('El nombre es obligatorio (mínimo 2 caracteres).');
  if (!/^\d{4,6}$/.test(pin))       return error('El PIN debe tener entre 4 y 6 dígitos numéricos.');

  // Verificar que el PIN de admin no colisione con PINs de empleados (seguridad)
  if (existePinEmpleado(pin)) return error('Ese PIN ya está en uso por un empleado. Elige otro.');

  var id         = generarId('ADM');
  var fechaAlta  = fechaHoy();

  hojaAdmins.appendRow([id, nombre, email, pin, fechaAlta]);

  // Asegurar que las hojas base existen
  getOCrearHoja(HOJA_EMPLEADOS, COLS_EMPLEADOS);
  getOCrearHoja(HOJA_REGISTROS, COLS_REGISTROS);
  getOCrearHoja(HOJA_CONFIG,    COLS_CONFIG);

  Logger.log('Bootstrap: primer admin creado — ' + nombre + ' (' + id + ')');
  return ok({ mensaje: 'Administrador creado correctamente.', adminId: id });
}

// ============================================================
//  ACCIÓN: estado (empleado)
// ============================================================

function accionEstado(params) {
  var pin = (params.pin || '').trim();
  if (!pin) return error('PIN requerido');

  var empleado = buscarEmpleadoPorPin(pin);
  if (!empleado) return error('PIN incorrecto');
  if (!empleado.activo) return error('Cuenta inactiva. Contacta con administración.');

  var hoy       = fechaHoy();
  var registros = getRegistrosEmpleadoFecha(empleado.id, hoy);

  var estado       = 'LIBRE';
  var ultimaAccion = null;

  if (registros.length > 0) {
    var ultimo = registros[registros.length - 1];
    ultimaAccion = { tipo: ultimo.tipo, hora: ultimo.hora };

    if (ultimo.tipo === 'ENTRADA') {
      estado = 'EN_JORNADA';
    } else {
      estado = 'JORNADA_CERRADA';
    }
  }

  return ok({
    nombre:       empleado.nombre,
    estado:       estado,
    ultimaAccion: ultimaAccion
  });
}

// ============================================================
//  ACCIÓN: fichar (empleado)
// ============================================================

function accionFichar(body) {
  var pin     = (body.pin     || '').trim();
  var latitud  = body.latitud  || '';
  var longitud = body.longitud || '';
  var ua       = body.userAgent || '';

  if (!pin) return error('PIN requerido');

  var empleado = buscarEmpleadoPorPin(pin);
  if (!empleado) return error('PIN incorrecto');
  if (!empleado.activo) return error('Cuenta inactiva.');

  var hoy       = fechaHoy();
  var horaAhora = horaActual();
  var registros = getRegistrosEmpleadoFecha(empleado.id, hoy);

  // Determinar tipo de fichaje
  var tipo;
  if (registros.length === 0) {
    tipo = 'ENTRADA';
  } else {
    var ultimo = registros[registros.length - 1];
    if (ultimo.tipo === 'ENTRADA') {
      tipo = 'SALIDA';
    } else {
      // Ya tiene entrada y salida → jornada cerrada
      return error('Ya has registrado tu jornada completa hoy.');
    }
  }

  // Guardar registro
  var idRegistro = generarId('REG');
  var hoja = getHoja(HOJA_REGISTROS);
  hoja.appendRow([
    idRegistro,
    empleado.id,
    empleado.nombre,
    tipo,
    hoy,
    horaAhora,
    new Date().toISOString(),
    latitud,
    longitud,
    ua,
    ''
  ]);

  return ok({
    tipo:    tipo,
    hora:    horaAhora,
    nombre:  empleado.nombre,
    fecha:   hoy
  });
}

// ============================================================
//  ACCIÓN: historial (empleado)
// ============================================================

function accionHistorial(params) {
  var pin    = (params.pin    || '').trim();
  var limite = parseInt(params.limite || '20', 10);

  if (!pin) return error('PIN requerido');

  var empleado = buscarEmpleadoPorPin(pin);
  if (!empleado) return error('PIN incorrecto');
  if (!empleado.activo) return error('Cuenta inactiva.');

  var hoja  = getHoja(HOJA_REGISTROS);
  var datos = hoja.getDataRange().getValues();
  var cabeceras = datos[0];
  var idx = indiceCabeceras(cabeceras, ['idRegistro','idEmpleado','nombre','tipo','fecha','hora']);

  var registros = [];
  for (var i = datos.length - 1; i >= 1; i--) {
    var fila = datos[i];
    if (String(fila[idx.idEmpleado]) !== String(empleado.id)) continue;
    registros.push({
      idRegistro: fila[idx.idRegistro],
      tipo:       fila[idx.tipo],
      fecha:      fila[idx.fecha],
      hora:       fila[idx.hora]
    });
    if (registros.length >= limite) break;
  }

  return ok({ registros: registros });
}

// ============================================================
//  ACCIÓN: admin_empleados
// ============================================================

function accionAdminEmpleados(params) {
  var pinAdmin = (params.pinAdmin || '').trim();
  if (!validarAdmin(pinAdmin)) return error('No autorizado');

  var empleados = getEmpleados();
  return ok({ empleados: empleados });
}

// ============================================================
//  ACCIÓN: admin_dia
// ============================================================

function accionAdminDia(params) {
  var pinAdmin   = (params.pinAdmin   || '').trim();
  var fecha      = (params.fecha      || '').trim();
  var idEmpleado = (params.idEmpleado || '').trim();

  if (!validarAdmin(pinAdmin)) return error('No autorizado');
  if (!fecha) fecha = fechaHoy();

  var hoja  = getHoja(HOJA_REGISTROS);
  var datos = hoja.getDataRange().getValues();
  var cab   = datos[0];
  var idx   = indiceCabeceras(cab, ['idRegistro','idEmpleado','nombre','tipo','fecha','hora','timestampServidor','observaciones']);

  var registros = [];
  for (var i = 1; i < datos.length; i++) {
    var fila = datos[i];
    if (String(fila[idx.fecha]) !== fecha) continue;
    if (idEmpleado && String(fila[idx.idEmpleado]) !== idEmpleado) continue;
    registros.push({
      idRegistro:        fila[idx.idRegistro],
      idEmpleado:        fila[idx.idEmpleado],
      nombre:            fila[idx.nombre],
      tipo:              fila[idx.tipo],
      fecha:             fila[idx.fecha],
      hora:              fila[idx.hora],
      timestampServidor: fila[idx.timestampServidor] || '',
      observaciones:     fila[idx.observaciones]     || ''
    });
  }

  return ok({ registros: registros, total: registros.length });
}

// ============================================================
//  ACCIÓN: admin_abiertos
// ============================================================

function accionAdminAbiertos(params) {
  var pinAdmin = (params.pinAdmin || '').trim();
  if (!validarAdmin(pinAdmin)) return error('No autorizado');

  var hoy       = fechaHoy();
  var empleados = getEmpleados();
  var abiertos  = [];

  empleados.filter(function(e) { return e.activo; }).forEach(function(emp) {
    var regs = getRegistrosEmpleadoFecha(emp.id, hoy);
    if (regs.length > 0 && regs[regs.length - 1].tipo === 'ENTRADA') {
      abiertos.push({ nombre: emp.nombre, hora: regs[regs.length - 1].hora });
    }
  });

  return ok({ abiertos: abiertos });
}

// ============================================================
//  ACCIÓN: admin_nuevo_empleado
// ============================================================

function accionAdminNuevoEmpleado(body) {
  var pinAdmin = (body.pinAdmin || '').trim();
  if (!validarAdmin(pinAdmin)) return error('No autorizado');

  var nombre = (body.nombre || '').trim();
  var pin    = (body.pin    || '').trim();
  var email  = (body.email  || '').trim();

  if (!nombre || nombre.length < 2) return error('El nombre es obligatorio.');
  if (!/^\d{4}$/.test(pin))         return error('El PIN debe ser exactamente 4 dígitos.');

  // PIN no puede coincidir con el pin de admin
  if (existePinAdmin(pin)) return error('Ese PIN ya está en uso por un administrador.');
  if (existePinEmpleado(pin)) return error('Ese PIN ya está en uso por otro empleado.');

  var id        = generarId('EMP');
  var fechaAlta = fechaHoy();
  var hoja      = getOCrearHoja(HOJA_EMPLEADOS, COLS_EMPLEADOS);

  hoja.appendRow([id, nombre, email, pin, true, fechaAlta]);

  return ok({ id: id, nombre: nombre });
}

// ============================================================
//  ACCIÓN: admin_editar_empleado
// ============================================================

function accionAdminEditarEmpleado(body) {
  var pinAdmin   = (body.pinAdmin   || '').trim();
  if (!validarAdmin(pinAdmin)) return error('No autorizado');

  var idEmpleado = (body.idEmpleado || '').trim();
  var nombre     = (body.nombre     || '').trim();
  var pin        = (body.pin        || '').trim(); // vacío = no cambiar
  var email      = (body.email      || '').trim();

  if (!idEmpleado) return error('ID de empleado requerido.');
  if (!nombre || nombre.length < 2) return error('El nombre es obligatorio.');

  // Validar PIN solo si se quiere cambiar
  if (pin) {
    if (!/^\d{4}$/.test(pin)) return error('El nuevo PIN debe ser exactamente 4 dígitos.');
    if (existePinAdmin(pin))    return error('Ese PIN ya está en uso por un administrador.');
    if (existePinEmpleadoExcepto(pin, idEmpleado)) return error('Ese PIN ya está en uso por otro empleado.');
  }

  var hoja  = getHoja(HOJA_EMPLEADOS);
  var datos = hoja.getDataRange().getValues();
  var cab   = datos[0];
  var idxId     = cab.indexOf('id');
  var idxNombre = cab.indexOf('nombre');
  var idxEmail  = cab.indexOf('email');
  var idxPin    = cab.indexOf('pin');

  for (var i = 1; i < datos.length; i++) {
    if (String(datos[i][idxId]) === idEmpleado) {
      hoja.getRange(i + 1, idxNombre + 1).setValue(nombre);
      hoja.getRange(i + 1, idxEmail  + 1).setValue(email);
      if (pin) hoja.getRange(i + 1, idxPin + 1).setValue(pin);
      return ok({ actualizado: true });
    }
  }

  return error('Empleado no encontrado.');
}

// ============================================================
//  ACCIÓN: admin_toggle_empleado
// ============================================================

function accionAdminToggleEmpleado(body) {
  var pinAdmin   = (body.pinAdmin   || '').trim();
  if (!validarAdmin(pinAdmin)) return error('No autorizado');

  var idEmpleado = (body.idEmpleado || '').trim();
  if (!idEmpleado) return error('ID requerido.');

  var hoja  = getHoja(HOJA_EMPLEADOS);
  var datos = hoja.getDataRange().getValues();
  var cab   = datos[0];
  var idxId     = cab.indexOf('id');
  var idxActivo = cab.indexOf('activo');

  for (var i = 1; i < datos.length; i++) {
    if (String(datos[i][idxId]) === idEmpleado) {
      var nuevoEstado = !datos[i][idxActivo];
      hoja.getRange(i + 1, idxActivo + 1).setValue(nuevoEstado);
      return ok({ activo: nuevoEstado });
    }
  }

  return error('Empleado no encontrado.');
}

// ============================================================
//  HELPERS — Lógica de negocio
// ============================================================

function validarAdmin(pin) {
  if (!pin) return false;
  var hoja = getHoja(HOJA_ADMINS);
  if (!hoja) return false;
  var datos = hoja.getDataRange().getValues();
  var cab   = datos[0];
  var idxPin = cab.indexOf('pin');
  for (var i = 1; i < datos.length; i++) {
    if (String(datos[i][idxPin]) === pin) return true;
  }
  return false;
}

function buscarEmpleadoPorPin(pin) {
  var hoja = getHoja(HOJA_EMPLEADOS);
  if (!hoja) return null;
  var datos = hoja.getDataRange().getValues();
  var cab   = datos[0];
  var idx   = indiceCabeceras(cab, ['id','nombre','email','pin','activo','fechaAlta']);
  for (var i = 1; i < datos.length; i++) {
    if (String(datos[i][idx.pin]) === pin) {
      return {
        id:       String(datos[i][idx.id]),
        nombre:   datos[i][idx.nombre],
        email:    datos[i][idx.email]  || '',
        activo:   datos[i][idx.activo] === true || datos[i][idx.activo] === 'TRUE',
        fechaAlta: datos[i][idx.fechaAlta] || ''
      };
    }
  }
  return null;
}

function getEmpleados() {
  var hoja = getHoja(HOJA_EMPLEADOS);
  if (!hoja) return [];
  var datos = hoja.getDataRange().getValues();
  if (datos.length <= 1) return [];
  var cab = datos[0];
  var idx = indiceCabeceras(cab, ['id','nombre','email','pin','activo','fechaAlta']);
  return datos.slice(1).map(function(fila) {
    return {
      id:       String(fila[idx.id]),
      nombre:   fila[idx.nombre],
      email:    fila[idx.email]  || '',
      activo:   fila[idx.activo] === true || fila[idx.activo] === 'TRUE',
      fechaAlta: fila[idx.fechaAlta] || ''
      // PIN nunca se devuelve al frontend
    };
  });
}

function getRegistrosEmpleadoFecha(idEmpleado, fecha) {
  var hoja  = getHoja(HOJA_REGISTROS);
  if (!hoja) return [];
  var datos = hoja.getDataRange().getValues();
  if (datos.length <= 1) return [];
  var cab = datos[0];
  var idx = indiceCabeceras(cab, ['idEmpleado','tipo','fecha','hora']);
  var resultado = [];
  for (var i = 1; i < datos.length; i++) {
    var fila = datos[i];
    if (String(fila[idx.idEmpleado]) === String(idEmpleado) &&
        String(fila[idx.fecha])      === fecha) {
      resultado.push({ tipo: fila[idx.tipo], hora: fila[idx.hora] });
    }
  }
  return resultado;
}

function existePinEmpleado(pin) {
  var hoja = getHoja(HOJA_EMPLEADOS);
  if (!hoja) return false;
  var datos = hoja.getDataRange().getValues();
  if (datos.length <= 1) return false;
  var idxPin = datos[0].indexOf('pin');
  for (var i = 1; i < datos.length; i++) {
    if (String(datos[i][idxPin]) === pin) return true;
  }
  return false;
}

function existePinEmpleadoExcepto(pin, idExcluir) {
  var hoja = getHoja(HOJA_EMPLEADOS);
  if (!hoja) return false;
  var datos  = hoja.getDataRange().getValues();
  if (datos.length <= 1) return false;
  var cab    = datos[0];
  var idxPin = cab.indexOf('pin');
  var idxId  = cab.indexOf('id');
  for (var i = 1; i < datos.length; i++) {
    if (String(datos[i][idxId]) === idExcluir) continue;
    if (String(datos[i][idxPin]) === pin) return true;
  }
  return false;
}

function existePinAdmin(pin) {
  var hoja = getHoja(HOJA_ADMINS);
  if (!hoja) return false;
  var datos  = hoja.getDataRange().getValues();
  if (datos.length <= 1) return false;
  var idxPin = datos[0].indexOf('pin');
  for (var i = 1; i < datos.length; i++) {
    if (String(datos[i][idxPin]) === pin) return true;
  }
  return false;
}

// ============================================================
//  HELPERS — Google Sheets
// ============================================================

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getHoja(nombre) {
  return getSpreadsheet().getSheetByName(nombre);
}

function getOCrearHoja(nombre, cabeceras) {
  var ss   = getSpreadsheet();
  var hoja = ss.getSheetByName(nombre);
  if (!hoja) {
    hoja = ss.insertSheet(nombre);
    hoja.appendRow(cabeceras);
    hoja.setFrozenRows(1);
    // Formato cabecera
    hoja.getRange(1, 1, 1, cabeceras.length)
        .setBackground('#1a1a2e')
        .setFontColor('#ffffff')
        .setFontWeight('bold');
  }
  return hoja;
}

// Devuelve un mapa { columna: índice } para acceso fácil sin depender del orden
function indiceCabeceras(cabeceras, columnas) {
  var mapa = {};
  columnas.forEach(function(col) {
    mapa[col] = cabeceras.indexOf(col);
  });
  return mapa;
}

// ============================================================
//  HELPERS — Fecha / Hora
// ============================================================

function fechaHoy() {
  var now = new Date();
  // Usar zona horaria de España (el script corre en UTC por defecto)
  var zona = Session.getScriptTimeZone();
  return Utilities.formatDate(now, zona, 'yyyy-MM-dd');
}

function horaActual() {
  var now  = new Date();
  var zona = Session.getScriptTimeZone();
  return Utilities.formatDate(now, zona, 'HH:mm:ss');
}

// ============================================================
//  HELPERS — IDs
// ============================================================

function generarId(prefijo) {
  var ts    = Date.now().toString(36).toUpperCase();
  var rand  = Math.random().toString(36).substr(2, 5).toUpperCase();
  return (prefijo || 'ID') + '-' + ts + '-' + rand;
}

// ============================================================
//  HELPERS — Respuestas JSON
// ============================================================

function ok(data) {
  return { ok: true, data: data };
}

function error(msg) {
  return { ok: false, error: msg };
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
//  SETUP MANUAL — Ejecutar una sola vez desde el editor
//  para crear las hojas con las cabeceras correctas
// ============================================================

function setupHojas() {
  getOCrearHoja(HOJA_ADMINS,    COLS_ADMINS);
  getOCrearHoja(HOJA_EMPLEADOS, COLS_EMPLEADOS);
  getOCrearHoja(HOJA_REGISTROS, COLS_REGISTROS);
  getOCrearHoja(HOJA_CONFIG,    COLS_CONFIG);
  SpreadsheetApp.getUi().alert('✅ Hojas creadas correctamente. Ya puedes desplegar la app web.');
}
