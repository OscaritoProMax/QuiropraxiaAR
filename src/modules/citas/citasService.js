// src/modules/citas/citasService.js — Sprint 1: Módulo 002 - Gestión de citas
import {
  collection, addDoc, updateDoc, deleteDoc, getDocs,
  doc, query, where, serverTimestamp
} from "firebase/firestore";
import { db } from "../../core/firebase";   // ← era ./firebase

export const ESTADOS = {
  ACTIVA:       "activa",
  COMPLETADA:   "completada",
  CANCELADA:    "cancelada",
  REPROGRAMADA: "reprogramada"
};

// 9:00 → 18:00 cada 20 minutos (27 slots)
export const HORARIOS = [
  "09:00","09:20","09:40",
  "10:00","10:20","10:40",
  "11:00","11:20","11:40",
  "12:00","12:20","12:40",
  "13:00","13:20","13:40",
  "14:00","14:20","14:40",
  "15:00","15:20","15:40",
  "16:00","16:20","16:40",
  "17:00","17:20","17:40",
  "18:00"
];

export async function agendarCita(datos) {
  try {
    const { clienteId, clienteNombre, clienteCiudad, usuarioId, fecha, hora, tipo, notas } = datos;
    if (!clienteId || !fecha || !hora) {
      return { ok: false, error: "Paciente, fecha y hora son obligatorios." };
    }
    const cruce = await verificarCruce(fecha, hora);
    if (cruce) {
      return { ok: false, error: `El horario ${hora} del ${fecha} ya está ocupado.` };
    }
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
      fechaCreacion: serverTimestamp()
    });
    return { ok: true, id: ref.id };
  } catch (error) {
    console.error("Error agendando cita:", error);
    return { ok: false, error: "No se pudo agendar la cita." };
  }
}

/**
 * Cancela una cita eliminándola permanentemente de Firestore.
 * Si la cita debe reprogramarse, usar reprogramarCita() en su lugar.
 */
export async function cancelarCita(id) {
  try {
    await deleteDoc(doc(db, "citas", id));
    return { ok: true };
  } catch (error) {
    console.error("Error cancelando cita:", error);
    return { ok: false, error: "No se pudo cancelar la cita." };
  }
}

export async function reprogramarCita(id, nuevaFecha, nuevaHora) {
  try {
    if (!nuevaFecha || !nuevaHora) {
      return { ok: false, error: "Nueva fecha y hora son obligatorias." };
    }
    const cruce = await verificarCruce(nuevaFecha, nuevaHora, id);
    if (cruce) {
      return { ok: false, error: `El horario ${nuevaHora} del ${nuevaFecha} ya está ocupado.` };
    }
    await updateDoc(doc(db, "citas", id), {
      fecha:  nuevaFecha,
      hora:   nuevaHora,
      estado: ESTADOS.ACTIVA,
      ultimaModificacion: serverTimestamp()
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: "No se pudo reprogramar la cita." };
  }
}

export async function cambiarEstado(id, nuevoEstado) {
  try {
    await updateDoc(doc(db, "citas", id), {
      estado: nuevoEstado,
      ultimaModificacion: serverTimestamp()
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: "No se pudo cambiar el estado." };
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
      where("estado", "in", [ESTADOS.ACTIVA, ESTADOS.REPROGRAMADA])
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
      .filter(c => c.estado === ESTADOS.ACTIVA || c.estado === ESTADOS.REPROGRAMADA)
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
