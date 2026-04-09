# Auditoría Fichaje Laboral — Bugs & Plan de Corrección

## Bug #1 — CRÍTICO (Bug raíz): Comparación de fechas rota en Code.gs

Google Sheets auto-convierte la columna Fecha ("2026-04-09" string) a objeto Date al leer con getValues().
La comparación `reg[6] !== hoyStr` (Date vs string) siempre da true → nunca encuentra registros.

IMPACTO EN CASCADA:
- accionEstado → siempre devuelve LIBRE → botón vuelve a "Registrar Entrada" (Bug #3)
- accionAdminAbiertos → nunca encuentra empleados en jornada (Bug #4)
- accionFichar → cada fichaje es siempre ENTRADA (ultimoReg siempre null)
- SW recibe estado=LIBRE siempre → auto-salida nunca funciona (Bug #2)

FIX: añadir normalizarFecha() y usarla en todas las comparaciones de fecha.

## Bug #2 — MEDIO: refrescarEstadoConGuardia pierde la guardia en el reintento

El reintento llama a refrescarEstado() SIN guardia → sobreescribe UI con estado antiguo.
El delay inicial (4s) es demasiado corto para la latencia real de Apps Script (8-15s).

FIX: retry recursivo con guardia, delay a 8s, máx 4 intentos.

## Bug #3 — MEDIO: Geofencing no actúa si el empleado ya está dentro al abrir la app

La primera posición GPS solo inicializa, nunca ficha. Si el empleado ya está en el centro,
no hay "cambio de zona" y el auto-fichaje nunca se dispara.

FIX: En first-position, si dentro===true y estado===LIBRE → enviar GEO_EVENTO.

## Bug #4 — MEDIO: SW bloquea geofencing cuando no hay turnos

manejarGeoEvento() exige ventana activa (calcularVentanaActual). Si sw.turnos=[] → null → return.
Empleados sin turnos configurados tienen el geofencing completamente desactivado.

FIX: Si no hay turnos, fichar basado solo en estado LIBRE/EN_JORNADA sin requerir ventana.
