// src/modules/citas/citasService.js — Sprint 1: Módulo 002 - Gestión de citas
import {
  collection, addDoc, updateDoc, deleteDoc, getDocs, getDoc,
  doc, query, where, serverTimestamp, arrayUnion, deleteField
} from "firebase/firestore";
import { db } from "../../core/firebase";   // ← era ./firebase

export const ESTADOS = {
  ACTIVA:                  "activa",
  COMPLETADA:               "completada",
  CANCELADA:                "cancelada",
  REPROGRAMADA:              "reprogramada",
  PENDIENTE_CONFIRMACION:   "pendiente_confirmacion",
  PENDIENTE_REPROGRAMAR:    "pendiente_reprogramar",
};

// ── Horarios de citas ─────────────────────────────────────
// Los slots se generan entre la hora de inicio y fin de la jornada de
// atención (configurables por el administrador en Configuración → Horario
// de trabajo). El intervalo entre citas es FIJO de 20 minutos a propósito:
// hacerlo configurable rompería las citas ya agendadas en esa grilla.
export const HORARIO_DEFAULT = { inicio: "09:00", fin: "18:00" };
const STEP_MIN = 20; // intervalo fijo entre citas (minutos)

const _aMinutos = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Genera la lista de horas "HH:MM" entre inicio y fin (ambos inclusive). */
export function generarHorarios(inicio = HORARIO_DEFAULT.inicio, fin = HORARIO_DEFAULT.fin, stepMin = STEP_MIN) {
  const ini  = _aMinutos(inicio || HORARIO_DEFAULT.inicio);
  const finM = _aMinutos(fin    || HORARIO_DEFAULT.fin);
  const out  = [];
  if (finM <= ini) return generarHorarios();   // rango inválido → usar defaults
  for (let t = ini; t <= finM; t += stepMin) {
    out.push(`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
  }
  return out;
}

// `HORARIOS` es un binding vivo: arranca con los valores por defecto y se
// regenera con cargarHorarios() al iniciar cada página, según la jornada
// guardada. Todos los módulos que lo importan ven siempre el valor actual.
export let HORARIOS = generarHorarios();

/** Lee la jornada guardada en Firestore y regenera HORARIOS. */
export async function cargarHorarios() {
  try {
    const snap = await getDoc(doc(db, "configuracion", "general"));
    const data = snap.exists() ? snap.data() : {};
    HORARIOS = generarHorarios(data.horaInicio, data.horaFin);
  } catch (error) {
    console.error("Error cargando horarios:", error);
    HORARIOS = generarHorarios();
  }
  return HORARIOS;
}

// Construye una entrada de historial. No usar serverTimestamp() aquí:
// Firestore no permite FieldValue.serverTimestamp() dentro de un array.
function crearEntradaHistorial(accion, usuarioId, usuarioNombre, detalle = '') {
  return {
    accion,
    usuarioId:     usuarioId     || null,
    usuarioNombre: usuarioNombre || 'Sistema',
    detalle,
    fecha: new Date().toISOString(),
  };
}

export async function agendarCita(datos) {
  try {
    const { clienteId, clienteNombre, clienteCiudad, usuarioId, usuarioNombre, fecha, hora, tipo, notas } = datos;
    if (!clienteId || !fecha || !hora) {
      return { ok: false, error: "Paciente, fecha y hora son obligatorios." };
    }
    const cruce = await verificarCruce(fecha, hora);
    if (cruce) {
      return { ok: false, error: `El horario ${hora} del ${fecha} ya está ocupado.` };
    }
    // Si la fecha cae dentro de un viaje, la cita se agenda en esa sede.
    const viaje = await viajeEnFecha(fecha);
    const ref = await addDoc(collection(db, "citas"), {
      clienteId,
      clienteNombre:  clienteNombre  || "",
      clienteCiudad:  clienteCiudad  || "",
      usuarioId,
      fecha,
      hora,
      tipo:   tipo  || "Ajuste general",
      notas:  notas || "",
      estado: ESTADOS.ACTIVA,
      sede:    viaje ? viaje.ciudadFull : "",   // "" = sede local; si no, "Depto > Ciudad"
      viajeId: viaje ? viaje.id : "",
      fechaCreacion: serverTimestamp(),
      historial: [crearEntradaHistorial('Cita creada', usuarioId, usuarioNombre,
        `${fecha} ${hora}${viaje ? ` · Sede: ${viaje.ciudadFull}` : ''}`)],
    });
    return { ok: true, id: ref.id };
  } catch (error) {
    console.error("Error agendando cita:", error);
    return { ok: false, error: "No se pudo agendar la cita." };
  }
}

// ── Viaje (sede) que cubre una fecha dada ─────────────────
// Consulta directa a la colección "viajes" (sin importar viajesService
// para evitar dependencias circulares). Devuelve el viaje o null.
export async function viajeEnFecha(fecha) {
  try {
    const snap = await getDocs(collection(db, "viajes"));
    const hit = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .find(v => v.fechaInicio <= fecha && v.fechaFin >= fecha);
    return hit || null;
  } catch {
    return null;
  }
}

// ── Citas que quedaron pendientes por reprogramar (por un viaje) ──
export async function obtenerCitasPendientesReprogramar() {
  try {
    const q    = query(collection(db, "citas"), where("estado", "==", ESTADOS.PENDIENTE_REPROGRAMAR));
    const snap = await getDocs(q);
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    docs.sort((a, b) => `${a.fecha}${a.hora}`.localeCompare(`${b.fecha}${b.hora}`));
    return docs;
  } catch (error) {
    console.error("Error obteniendo pendientes por reprogramar:", error);
    return [];
  }
}

// Marca una cita como pendiente por reprogramar, dejando registro del viaje
// que la afectó (para poder reactivarla si el viaje se elimina).
export async function marcarPendienteReprogramar(id, viajeId, usuarioId = null, usuarioNombre = null, detalle = '') {
  try {
    await updateDoc(doc(db, "citas", id), {
      estado:             ESTADOS.PENDIENTE_REPROGRAMAR,
      pendienteViajeId:   viajeId || '',
      ultimaModificacion: serverTimestamp(),
      historial: arrayUnion(crearEntradaHistorial('Pendiente por reprogramar (viaje)', usuarioId, usuarioNombre, detalle)),
    });
    return { ok: true };
  } catch (error) {
    console.error("Error marcando cita pendiente:", error);
    return { ok: false };
  }
}

// Reactiva (estado activa) las citas que un viaje dejó pendientes, al eliminarlo.
// Solo reactiva las que siguen pendientes y cuyo horario no fue ocupado por
// otra cita mientras tanto; las ocupadas se dejan pendientes para reprogramar.
export async function restaurarPendientesPorViaje(viajeId, usuarioId = null, usuarioNombre = null) {
  try {
    const q    = query(collection(db, "citas"), where("pendienteViajeId", "==", viajeId));
    const snap = await getDocs(q);
    const pendientes = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => c.estado === ESTADOS.PENDIENTE_REPROGRAMAR);

    let reactivadas = 0;
    for (const c of pendientes) {
      const ocupado = await verificarCruce(c.fecha, c.hora, c.id);
      if (ocupado) continue; // el cupo ya fue tomado → se deja pendiente
      await updateDoc(doc(db, "citas", c.id), {
        estado:             ESTADOS.ACTIVA,
        pendienteViajeId:   deleteField(),
        ultimaModificacion: serverTimestamp(),
        historial: arrayUnion(crearEntradaHistorial('Reactivada (viaje eliminado)', usuarioId, usuarioNombre, '')),
      });
      reactivadas++;
    }
    return reactivadas;
  } catch (error) {
    console.error("Error restaurando citas del viaje:", error);
    return 0;
  }
}

export async function cancelarCita(id, motivo = 'Sin motivo', usuarioId = null, usuarioNombre = null) {
  try {
    await updateDoc(doc(db, "citas", id), {
      estado:             ESTADOS.CANCELADA,
      motivoCancelacion:  motivo,
      fechaCancelacion:   serverTimestamp(),
      ultimaModificacion: serverTimestamp(),
      historial: arrayUnion(crearEntradaHistorial('Cancelación', usuarioId, usuarioNombre, motivo)),
    });
    return { ok: true };
  } catch (error) {
    console.error("Error cancelando cita:", error);
    return { ok: false, error: "No se pudo cancelar la cita." };
  }
}

export async function reprogramarCita(id, nuevaFecha, nuevaHora, usuarioId = null, usuarioNombre = null) {
  try {
    if (!nuevaFecha || !nuevaHora) {
      return { ok: false, error: "Nueva fecha y hora son obligatorias." };
    }
    const cruce = await verificarCruce(nuevaFecha, nuevaHora, id);
    if (cruce) {
      return { ok: false, error: `El horario ${nuevaHora} del ${nuevaFecha} ya está ocupado.` };
    }
    const anteriorSnap = await getDoc(doc(db, "citas", id));
    const anterior     = anteriorSnap.exists() ? anteriorSnap.data() : null;
    const detalle = anterior
      ? `De ${anterior.fecha} ${anterior.hora} a ${nuevaFecha} ${nuevaHora}`
      : `Nueva fecha: ${nuevaFecha} ${nuevaHora}`;
    await updateDoc(doc(db, "citas", id), {
      fecha:  nuevaFecha,
      hora:   nuevaHora,
      estado: ESTADOS.ACTIVA,
      ultimaModificacion: serverTimestamp(),
      historial: arrayUnion(crearEntradaHistorial('Reprogramación', usuarioId, usuarioNombre, detalle)),
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: "No se pudo reprogramar la cita." };
  }
}

export async function cambiarEstado(id, nuevoEstado, usuarioId = null, usuarioNombre = null, detalle = '') {
  try {
    await updateDoc(doc(db, "citas", id), {
      estado: nuevoEstado,
      ultimaModificacion: serverTimestamp(),
      historial: arrayUnion(crearEntradaHistorial(`Estado actualizado: ${nuevoEstado}`, usuarioId, usuarioNombre, detalle)),
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: "No se pudo cambiar el estado." };
  }
}

// ══════════════════════════════════════════════════════════
// FLUJO DE APROBACIÓN DE COBROS (Secretaria → Administrador)
// La secretaria no completa la cita directamente: el cobro
// queda "pendiente_confirmacion" y bloqueado hasta que un
// administrador lo apruebe (o lo rechace) desde Finanzas.
// ══════════════════════════════════════════════════════════

export async function enviarPagoAPendiente(id, datosPago, usuarioId = null, usuarioNombre = null) {
  try {
    await updateDoc(doc(db, "citas", id), {
      estado:             ESTADOS.PENDIENTE_CONFIRMACION,
      pagoPendiente:      { ...datosPago, enviadoPor: usuarioId, enviadoPorNombre: usuarioNombre },
      ultimaModificacion: serverTimestamp(),
      historial: arrayUnion(crearEntradaHistorial(
        'Cobro enviado a confirmación', usuarioId, usuarioNombre,
        `Total: ${datosPago.totalCobrado}`
      )),
    });
    return { ok: true };
  } catch (error) {
    console.error("Error enviando cobro a confirmación:", error);
    return { ok: false, error: "No se pudo enviar el cobro a confirmación." };
  }
}

export async function obtenerCitasPendientesConfirmacion() {
  try {
    const q    = query(collection(db, "citas"), where("estado", "==", ESTADOS.PENDIENTE_CONFIRMACION));
    const snap = await getDocs(q);
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    docs.sort((a, b) => `${a.fecha}${a.hora}`.localeCompare(`${b.fecha}${b.hora}`));
    return docs;
  } catch (error) {
    console.error("Error obteniendo pendientes de confirmación:", error);
    return [];
  }
}

export async function confirmarPagoPendiente(id, usuarioId = null, usuarioNombre = null) {
  try {
    const snap = await getDoc(doc(db, "citas", id));
    if (!snap.exists()) return { ok: false, error: "La cita no existe." };
    const cita = snap.data();
    if (cita.estado !== ESTADOS.PENDIENTE_CONFIRMACION || !cita.pagoPendiente) {
      return { ok: false, error: "Esta cita no tiene un cobro pendiente de confirmación." };
    }
    await updateDoc(doc(db, "citas", id), {
      estado:             ESTADOS.COMPLETADA,
      pagoPendiente:      deleteField(),
      ultimaModificacion: serverTimestamp(),
      historial: arrayUnion(crearEntradaHistorial(
        'Pago aprobado por administrador', usuarioId, usuarioNombre,
        `Total: ${cita.pagoPendiente.totalCobrado}`
      )),
    });
    return { ok: true, pagoPendiente: cita.pagoPendiente };
  } catch (error) {
    console.error("Error confirmando pago pendiente:", error);
    return { ok: false, error: "No se pudo confirmar el pago." };
  }
}

export async function rechazarPagoPendiente(id, motivo = '', usuarioId = null, usuarioNombre = null) {
  try {
    await updateDoc(doc(db, "citas", id), {
      estado:             ESTADOS.ACTIVA,
      pagoPendiente:      deleteField(),
      ultimaModificacion: serverTimestamp(),
      historial: arrayUnion(crearEntradaHistorial('Cobro rechazado por administrador', usuarioId, usuarioNombre, motivo)),
    });
    return { ok: true };
  } catch (error) {
    console.error("Error rechazando pago pendiente:", error);
    return { ok: false, error: "No se pudo rechazar el cobro." };
  }
}

// Sin orderBy — Firestore requiere índice compuesto para where+orderBy.
// Ordenamos por hora en el cliente para evitar ese requisito.
export async function obtenerCitasPorFecha(fecha) {
  try {
    const q    = query(collection(db, "citas"), where("fecha", "==", fecha));
    const snap = await getDocs(q);
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    docs.sort((a, b) => a.hora.localeCompare(b.hora));
    return docs;
  } catch (error) {
    console.error("Error obteniendo citas:", error);
    return [];
  }
}

// Trae todas las citas cuya fecha cae dentro de [desde, hasta] (YYYY-MM-DD).
// Útil para vistas de calendario (mes/semana) que necesitan varios días a la vez.
export async function obtenerCitasPorRangoFecha(desde, hasta) {
  try {
    const q    = query(
      collection(db, "citas"),
      where("fecha", ">=", desde),
      where("fecha", "<=", hasta)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.error("Error obteniendo citas por rango:", error);
    return [];
  }
}

export async function obtenerCitaPorId(id) {
  try {
    const snap = await getDoc(doc(db, "citas", id));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch (error) {
    console.error("Error obteniendo cita:", error);
    return null;
  }
}

export async function obtenerCitasPorCliente(clienteId) {
  try {
    const q    = query(collection(db, "citas"), where("clienteId", "==", clienteId));
    const snap = await getDocs(q);
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    docs.sort((a, b) => b.fecha.localeCompare(a.fecha));
    return docs;
  } catch (error) {
    console.error("Error obteniendo historial:", error);
    return [];
  }
}

async function verificarCruce(fecha, hora, excludeId = null) {
  try {
    const q    = query(
      collection(db, "citas"),
      where("fecha",  "==", fecha),
      where("hora",   "==", hora),
      where("estado", "in", [ESTADOS.ACTIVA, ESTADOS.REPROGRAMADA, ESTADOS.PENDIENTE_CONFIRMACION])
    );
    const snap = await getDocs(q);
    const hits = snap.docs.filter(d => d.id !== excludeId);
    return hits.length > 0 ? { id: hits[0].id, ...hits[0].data() } : null;
  } catch {
    return null;
  }
}

/**
 * Dado una fecha y hora solicitada, devuelve el próximo slot
 * libre a partir de esa hora (inclusive).
 * Retorna { hora, fecha } o null si no hay slots disponibles ese día.
 */
export async function sugerirHorario(fecha, horaDesde) {
  const citasDelDia = await obtenerCitasPorFecha(fecha);
  const ocupadas    = new Set(
    citasDelDia
      .filter(c => c.estado === ESTADOS.ACTIVA || c.estado === ESTADOS.REPROGRAMADA || c.estado === ESTADOS.PENDIENTE_CONFIRMACION)
      .map(c => c.hora)
  );

  const idxInicio = HORARIOS.indexOf(horaDesde);
  const desde     = idxInicio === -1 ? 0 : idxInicio;

  for (let i = desde; i < HORARIOS.length; i++) {
    if (!ocupadas.has(HORARIOS[i])) {
      return { fecha, hora: HORARIOS[i] };
    }
  }
  return null;
}
