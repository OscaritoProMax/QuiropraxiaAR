// src/modules/pacientes/pacientesService.js — Sprint 1: Módulo 009 - Gestión de clientes
// ACTUALIZADO: geografía Colombia ahora viene de colombiaService.js (api-colombia.com)
import {
  collection, addDoc, updateDoc, deleteDoc, getDocs,
  doc, query, where, serverTimestamp
} from "firebase/firestore";
import { db } from "../../core/firebase";

// ── Geografía Colombia — ahora delegada a colombiaService ──
// Se re-exportan las funciones clave para que el resto del proyecto
// no tenga que cambiar sus imports si ya importaban desde aquí.
export {
  obtenerDepartamentos,
  obtenerCiudades,
  poblarSelectDepartamentos,
  poblarSelectCiudades,
  inicializarSelectsUbicacion,
  restaurarUbicacion,
  limpiarCacheGeografia,
} from "./colombiaService.js";

// ── Países (para pacientes extranjeros) ────────────────────
export const PAISES = [
  "Venezuela","Ecuador","Perú","Panamá","Brasil","Bolivia",
  "Chile","Argentina","México","España","Estados Unidos",
  "Costa Rica","Cuba","República Dominicana","Otro"
];

// ── Helpers de ubicación — se mantienen igual ──────────────

/** Dado "Boyacá > Tunja" retorna { departamento, ciudad } */
export function parsearUbicacion(valor) {
  if (!valor) return { departamento: "", ciudad: "" };
  if (valor.includes(" > ")) {
    const [departamento, ciudad] = valor.split(" > ");
    return { departamento, ciudad };
  }
  // Compatibilidad con registros viejos (solo ciudad)
  return { departamento: "", ciudad: valor };
}

/** Construye el string canónico "Departamento > Ciudad" */
export function ubicacionString(departamento, ciudad) {
  if (!departamento && !ciudad) return "";
  if (!departamento) return ciudad;
  return `${departamento} > ${ciudad}`;
}

// ── Registrar paciente nuevo ────────────────────────────────
export async function registrarPaciente(datos) {
  try {
    const { nombre, documento, telefono, email, condicion, fechaNacimiento, ciudad } = datos;
    if (!nombre || !telefono) {
      return { ok: false, error: "Nombre y teléfono son obligatorios." };
    }
    const duplicadoTel = await buscarPorTelefono(telefono);
    if (duplicadoTel) {
      return { ok: false, error: `Ya existe un paciente con el teléfono ${telefono}.` };
    }
    const ref = await addDoc(collection(db, "clientes"), {
      nombre:          nombre.trim(),
      documento:       documento?.trim() || "",
      telefono:        telefono          || "",
      email:           email             || "",
      condicion:       condicion         || "",
      ciudad:          ciudad            || "",   // Formato: "Boyacá > Tunja"
      fechaNacimiento: fechaNacimiento   || "",
      activo:          true,
      fechaRegistro:   serverTimestamp()
    });
    return { ok: true, id: ref.id };
  } catch (error) {
    console.error("Error registrando paciente:", error);
    return { ok: false, error: "Error al guardar el paciente." };
  }
}

// ── Registro rápido (desde modal de cita) ──────────────────
export async function registrarPacienteRapido(nombre, telefono, ciudad, documento = "") {
  try {
    if (!nombre || !telefono) {
      return { ok: false, error: "Nombre y teléfono son obligatorios." };
    }
    const duplicado = await buscarPorTelefono(telefono);
    if (duplicado) {
      return {
        ok: false,
        error: `Ya existe un paciente con el teléfono ${telefono}.`,
        paciente: duplicado
      };
    }
    const ref = await addDoc(collection(db, "clientes"), {
      nombre:        nombre.trim(),
      telefono:      telefono.trim(),
      documento:     documento.trim(),
      ciudad:        ciudad || "",    // Formato: "Boyacá > Tunja"
      email:         "",
      condicion:     "",
      activo:        true,
      fechaRegistro: serverTimestamp()
    });
    return { ok: true, id: ref.id, nombre: nombre.trim(), ciudad: ciudad || "" };
  } catch (error) {
    return { ok: false, error: "Error al guardar el paciente." };
  }
}

// ── Actualizar paciente ─────────────────────────────────────
export async function actualizarPaciente(id, datos) {
  try {
    await updateDoc(doc(db, "clientes", id), {
      ...datos,
      ultimaModificacion: serverTimestamp()
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: "No se pudo actualizar el paciente." };
  }
}

// ── Obtener todos (uso interno / estadísticas) ──────────────
export async function obtenerPacientes() {
  try {
    const snap = await getDocs(collection(db, "clientes"));
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    docs.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    return docs;
  } catch (error) {
    console.error("Error obteniendo pacientes:", error);
    return [];
  }
}

// ── Obtener por ciudad con límite (evita cargar todo) ───────
// NOTA: el campo "ciudad" en Firebase tiene formato "Boyacá > Tunja"
// Para filtrar, se puede pasar la ciudad sola o el string completo.
export async function obtenerPacientesPorCiudad(ciudad, limite = 50) {
  try {
    let snap;
    if (ciudad) {
      // Buscar tanto por string completo como por ciudad sola (legacy)
      const q = query(collection(db, "clientes"), where("ciudad", "==", ciudad));
      snap = await getDocs(q);
    } else {
      snap = await getDocs(collection(db, "clientes"));
    }
    const todos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    todos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    return {
      pacientes: todos.slice(0, limite),
      hayMas:    todos.length > limite,
      total:     todos.length,
    };
  } catch (error) {
    console.error("Error obteniendo pacientes por ciudad:", error);
    return { pacientes: [], hayMas: false, total: 0 };
  }
}

// ── Eliminar paciente permanentemente ──────────────────────
export async function eliminarPaciente(id) {
  try {
    await deleteDoc(doc(db, "clientes", id));
    return { ok: true };
  } catch (error) {
    console.error("Error eliminando paciente:", error);
    return { ok: false, error: "No se pudo eliminar el paciente." };
  }
}

// ── Buscar por teléfono ─────────────────────────────────────
export async function buscarPorTelefono(telefono) {
  try {
    const q    = query(collection(db, "clientes"), where("telefono", "==", telefono.trim()));
    const snap = await getDocs(q);
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
    return null;
  } catch (error) {
    return null;
  }
}

// ── Buscar por documento ────────────────────────────────────
export async function buscarPorDocumento(documento) {
  try {
    const q    = query(collection(db, "clientes"), where("documento", "==", documento.trim()));
    const snap = await getDocs(q);
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
    return null;
  } catch (error) {
    return null;
  }
}

// ── Buscar por nombre, teléfono o documento (client-side) ──
export async function buscarPacientes(termino) {
  try {
    const todos = await obtenerPacientes();
    const t = termino.toLowerCase().trim();
    return todos.filter(p =>
      p.nombre.toLowerCase().includes(t) ||
      (p.telefono  && p.telefono.includes(t)) ||
      (p.documento && p.documento.includes(t))
    );
  } catch (error) {
    return [];
  }
}

// ── Filtrar por ciudad (client-side) ───────────────────────
// Soporta búsqueda parcial: "Tunja" matchea "Boyacá > Tunja"
export async function filtrarPorCiudad(ciudad) {
  try {
    const todos = await obtenerPacientes();
    if (!ciudad) return todos;
    return todos.filter(p =>
      p.ciudad === ciudad ||
      (p.ciudad && p.ciudad.includes(ciudad))
    );
  } catch (error) {
    return [];
  }
}
