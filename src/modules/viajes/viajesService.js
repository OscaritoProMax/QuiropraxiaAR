// src/modules/viajes/viajesService.js
// Gestión de "Sedes / Viajes" del quiropráctico.
// Un viaje = el admin atiende en otra ciudad durante un rango de fechas,
// con su propio horario. Mientras dura el viaje:
//   - La sede local queda bloqueada para agendar (otros roles).
//   - Las citas locales activas en ese rango pasan a "pendiente_reprogramar".
//   - Las citas nuevas en esas fechas se asocian a la sede del viaje.
// Colección Firestore: "viajes"

import {
  collection, addDoc, getDocs, getDoc, doc, deleteDoc, updateDoc,
  query, where, serverTimestamp
} from "firebase/firestore";
import { db } from "../../core/firebase.js";
import { obtenerCitasPorRangoFecha, marcarPendienteReprogramar,
         restaurarPendientesPorViaje, ESTADOS } from "../citas/citasService.js";

// ── Crear viaje ────────────────────────────────────────────
export async function crearViaje(datos, usuarioId = null, usuarioNombre = null) {
  try {
    const { departamento, ciudad, fechaInicio, fechaFin, horaInicio, horaFin } = datos;

    if (!ciudad || !fechaInicio || !fechaFin) {
      return { ok: false, error: "Ciudad, fecha de inicio y fecha de fin son obligatorias." };
    }
    if (fechaFin < fechaInicio) {
      return { ok: false, error: "La fecha de fin no puede ser anterior a la de inicio." };
    }
    if (horaInicio && horaFin && horaFin <= horaInicio) {
      return { ok: false, error: "La hora de fin debe ser mayor que la de inicio." };
    }

    const ciudadFull = departamento ? `${departamento} > ${ciudad}` : ciudad;

    const ref = await addDoc(collection(db, "viajes"), {
      departamento: departamento || "",
      ciudad,
      ciudadFull,
      fechaInicio,
      fechaFin,
      horaInicio: horaInicio || "09:00",
      horaFin:    horaFin    || "18:00",
      creadoPor:  usuarioId  || null,
      fechaCreacion: serverTimestamp(),
    });

    // Marcar las citas locales activas dentro del rango como pendientes por
    // reprogramar (no se pueden atender porque el quiropráctico viaja).
    const afectadas = await marcarCitasPendientesPorViaje(ref.id, fechaInicio, fechaFin, usuarioId, usuarioNombre);

    return { ok: true, id: ref.id, ciudadFull, citasAfectadas: afectadas };
  } catch (error) {
    console.error("Error creando viaje:", error);
    return { ok: false, error: "No se pudo guardar el viaje." };
  }
}

// Marca como "pendiente_reprogramar" las citas activas de la SEDE LOCAL
// (sin sede de viaje) que caen en el rango del viaje, dejando registro del
// viaje que las afectó para poder reactivarlas si se elimina.
async function marcarCitasPendientesPorViaje(viajeId, fechaInicio, fechaFin, usuarioId, usuarioNombre) {
  try {
    const citas = await obtenerCitasPorRangoFecha(fechaInicio, fechaFin);
    const locales = citas.filter(c => c.estado === ESTADOS.ACTIVA && !c.sede);
    await Promise.all(locales.map(c =>
      marcarPendienteReprogramar(c.id, viajeId, usuarioId, usuarioNombre,
        `Viaje (${fechaInicio} a ${fechaFin})`)
    ));
    return locales.length;
  } catch (error) {
    console.error("Error marcando citas por viaje:", error);
    return 0;
  }
}

// ── Editar viaje (sede, fechas u horario) ──────────────────
// Si cambian las fechas, se reevalúan las citas afectadas: se reactivan
// las del rango anterior y se vuelven a marcar las del nuevo rango.
export async function actualizarViaje(id, datos, usuarioId = null, usuarioNombre = null) {
  try {
    const { departamento, ciudad, fechaInicio, fechaFin, horaInicio, horaFin } = datos;
    if (!ciudad || !fechaInicio || !fechaFin) {
      return { ok: false, error: "Ciudad, fecha de inicio y fecha de fin son obligatorias." };
    }
    if (fechaFin < fechaInicio) {
      return { ok: false, error: "La fecha de fin no puede ser anterior a la de inicio." };
    }
    if (horaInicio && horaFin && horaFin <= horaInicio) {
      return { ok: false, error: "La hora de fin debe ser mayor que la de inicio." };
    }

    const ciudadFull = departamento ? `${departamento} > ${ciudad}` : ciudad;

    await updateDoc(doc(db, "viajes", id), {
      departamento: departamento || "",
      ciudad,
      ciudadFull,
      fechaInicio,
      fechaFin,
      horaInicio: horaInicio || "09:00",
      horaFin:    horaFin    || "18:00",
      ultimaModificacion: serverTimestamp(),
    });

    // Reevaluar citas afectadas según el (posible) nuevo rango.
    await restaurarPendientesPorViaje(id, usuarioId, usuarioNombre);
    const afectadas = await marcarCitasPendientesPorViaje(id, fechaInicio, fechaFin, usuarioId, usuarioNombre);

    return { ok: true, ciudadFull, citasAfectadas: afectadas };
  } catch (error) {
    console.error("Error actualizando viaje:", error);
    return { ok: false, error: "No se pudo actualizar el viaje." };
  }
}

// ── Listar viajes (ordenados por fecha de inicio descendente) ──
export async function obtenerViajes() {
  try {
    const snap = await getDocs(collection(db, "viajes"));
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    docs.sort((a, b) => (b.fechaInicio || "").localeCompare(a.fechaInicio || ""));
    return docs;
  } catch (error) {
    console.error("Error obteniendo viajes:", error);
    return [];
  }
}

// ── Eliminar viaje ─────────────────────────────────────────
// Reactiva las citas que este viaje había dejado pendientes (si su cupo
// sigue libre) y luego borra el viaje.
export async function eliminarViaje(id, usuarioId = null, usuarioNombre = null) {
  try {
    const reactivadas = await restaurarPendientesPorViaje(id, usuarioId, usuarioNombre);
    await deleteDoc(doc(db, "viajes", id));
    return { ok: true, reactivadas };
  } catch (error) {
    console.error("Error eliminando viaje:", error);
    return { ok: false, error: "No se pudo eliminar el viaje." };
  }
}

// ── Viaje que cubre una fecha concreta (o null) ────────────
export async function obtenerViajeEnFecha(fecha) {
  try {
    const snap = await getDocs(collection(db, "viajes"));
    const hit = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .find(v => v.fechaInicio <= fecha && v.fechaFin >= fecha);
    return hit || null;
  } catch (error) {
    console.error("Error obteniendo viaje en fecha:", error);
    return null;
  }
}

// ── Viajes que se cruzan con un rango [desde, hasta] ───────
// Útil para pintar el calendario (semana/mes).
export async function obtenerViajesEnRango(desde, hasta) {
  try {
    const snap = await getDocs(collection(db, "viajes"));
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(v => v.fechaInicio <= hasta && v.fechaFin >= desde);
  } catch (error) {
    console.error("Error obteniendo viajes por rango:", error);
    return [];
  }
}
