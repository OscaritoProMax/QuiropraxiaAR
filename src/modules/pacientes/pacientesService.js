// src/modules/pacientes/pacientesService.js — Sprint 1: Módulo 009 - Gestión de clientes
import {
  collection, addDoc, updateDoc, deleteDoc, getDocs,
  doc, query, where, serverTimestamp
} from "firebase/firestore";
import { db } from "../../core/firebase";   // ← era ./firebase

// ── Estructura geográfica Colombia — 32 departamentos ──────
export const DEPARTAMENTOS = {
  "Amazonas":           ["Leticia","Puerto Nariño"],
  "Antioquia":          ["Medellín","Bello","Itagüí","Envigado","Apartadó","Turbo","Rionegro","Caucasia","Marinilla","La Ceja","Sabaneta","Copacabana","Barbosa"],
  "Arauca":             ["Arauca","Saravena","Tame","Fortul"],
  "Atlántico":          ["Barranquilla","Soledad","Malambo","Sabanalarga","Baranoa","Puerto Colombia"],
  "Bolívar":            ["Cartagena","Magangué","El Carmen de Bolívar","Mompox","Turbaco"],
  "Boyacá":             ["Tunja","Duitama","Santa Rosa de Viterbo","Sogamoso","Chiquinquirá","Paipa","Villa de Leyva","Moniquirá","Samacá","Nobsa","Tibasosa","Corrales","Garagoa","Soatá","Guateque","Ramiriquí","Tenza","Miraflores","Aquitania","Puerto Boyacá","Berbeo","Jenesano","Ventaquemada","Siachoque"],
  "Caldas":             ["Manizales","Chinchiná","La Dorada","Riosucio","Supía","Anserma","Salamina","Villamaría"],
  "Caquetá":            ["Florencia","San Vicente del Caguán","El Doncello","Puerto Rico"],
  "Casanare":           ["Yopal","Aguazul","Villanueva","Tauramena","Paz de Ariporo"],
  "Cauca":              ["Popayán","Santander de Quilichao","Puerto Tejada","Patía","Guapi"],
  "Cesar":              ["Valledupar","Aguachica","Codazzi","Bosconia","La Jagua de Ibirico"],
  "Chocó":              ["Quibdó","Istmina","Tadó","Riosucio","Condoto"],
  "Córdoba":            ["Montería","Lorica","Sahagún","Cereté","Montelíbano","Tierralta"],
  "Cundinamarca":       ["Bogotá","Soacha","Zipaquirá","Facatativá","Chía","Mosquera","Madrid","Fusagasugá","Girardot","Cajicá","Tocancipá","Sibaté","La Mesa","Ubaté","Chocontá","Villeta","Cota","Tenjo","Sopó"],
  "Guainía":            ["Inírida"],
  "Guaviare":           ["San José del Guaviare","Calamar","El Retorno"],
  "Huila":              ["Neiva","Pitalito","Garzón","La Plata","Campoalegre","Palermo"],
  "La Guajira":         ["Riohacha","Maicao","Uribia","Manaure","San Juan del Cesar"],
  "Magdalena":          ["Santa Marta","Ciénaga","Fundación","El Banco","Plato"],
  "Meta":               ["Villavicencio","Acacías","Granada","Puerto López","San Martín"],
  "Nariño":             ["Pasto","Tumaco","Ipiales","La Unión","Túquerres","Samaniego"],
  "Norte de Santander": ["Cúcuta","Ocaña","Pamplona","Villa del Rosario","Los Patios","Tibú"],
  "Putumayo":           ["Mocoa","Puerto Asís","Orito","Valle del Guamuez"],
  "Quindío":            ["Armenia","Calarcá","Montenegro","Quimbaya","La Tebaida"],
  "Risaralda":          ["Pereira","Dosquebradas","Santa Rosa de Cabal","La Virginia","Marsella"],
  "San Andrés":         ["San Andrés","Providencia"],
  "Santander":          ["Bucaramanga","Floridablanca","Girón","Piedecuesta","Barrancabermeja","Socorro","San Gil","Vélez","Málaga"],
  "Sucre":              ["Sincelejo","Corozal","Sampués","Tolú","San Marcos"],
  "Tolima":             ["Ibagué","Espinal","Melgar","Honda","Líbano","Chaparral","Mariquita"],
  "Valle del Cauca":    ["Cali","Buenaventura","Palmira","Tuluá","Buga","Cartago","Jamundí","Yumbo","Candelaria"],
  "Vaupés":             ["Mitú"],
  "Vichada":            ["Puerto Carreño","La Primavera"],
};

// ── Países (para pacientes extranjeros) ────────────────────
export const PAISES = [
  "Venezuela","Ecuador","Perú","Panamá","Brasil","Bolivia",
  "Chile","Argentina","México","España","Estados Unidos",
  "Costa Rica","Cuba","República Dominicana","Otro"
];

// ── Helpers de geografía ───────────────────────────────────
/** Retorna lista plana de todas las ciudades de Colombia */
export function todasLasCiudades() {
  return Object.values(DEPARTAMENTOS).flat().sort((a, b) => a.localeCompare(b, 'es'));
}

/** Dado "Boyacá > Tunja" retorna { departamento, ciudad } */
export function parsearUbicacion(valor) {
  if (!valor) return { departamento: '', ciudad: '' };
  if (valor.includes(' > ')) {
    const [departamento, ciudad] = valor.split(' > ');
    return { departamento, ciudad };
  }
  // Compatibilidad con registros viejos (solo ciudad)
  return { departamento: '', ciudad: valor };
}

/** Construye el string canónico "Departamento > Ciudad" */
export function ubicacionString(departamento, ciudad) {
  if (!departamento && !ciudad) return '';
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
      documento:       documento.trim(),
      telefono:        telefono        || "",
      email:           email           || "",
      condicion:       condicion       || "",
      ciudad:          ciudad          || "",
      fechaNacimiento: fechaNacimiento || "",
      activo: true,
      fechaRegistro: serverTimestamp()
    });
    return { ok: true, id: ref.id };
  } catch (error) {
    console.error("Error registrando paciente:", error);
    return { ok: false, error: "Error al guardar el paciente." };
  }
}

// ── Registro rápido (desde modal de cita) ──────────────────
export async function registrarPacienteRapido(nombre, telefono, ciudad, documento = '') {
  try {
    if (!nombre || !telefono) {
      return { ok: false, error: "Nombre y teléfono son obligatorios." };
    }
    const duplicado = await buscarPorTelefono(telefono);
    if (duplicado) {
      return { ok: false, error: `Ya existe un paciente con el teléfono ${telefono}.`, paciente: duplicado };
    }
    const ref = await addDoc(collection(db, "clientes"), {
      nombre:    nombre.trim(),
      telefono:  telefono.trim(),
      documento: documento.trim(),
      ciudad:    ciudad || "",
      email: "", condicion: "",
      activo: true,
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

// ── Obtener todos (uso interno / estadísticas) ─────────────
export async function obtenerPacientes() {
  try {
    const snap = await getDocs(collection(db, "clientes"));
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    docs.sort((a, b) => a.nombre.localeCompare(b.nombre));
    return docs;
  } catch (error) {
    console.error("Error obteniendo pacientes:", error);
    return [];
  }
}

// ── Obtener por ciudad con límite (evita cargar todo) ───────
// Retorna { pacientes, hayMas }
export async function obtenerPacientesPorCiudad(ciudad, limite = 50) {
  try {
    let q;
    if (ciudad) {
      q = query(
        collection(db, "clientes"),
        where("ciudad", "==", ciudad)
      );
    } else {
      q = query(collection(db, "clientes"));
    }
    const snap = await getDocs(q);
    const todos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    todos.sort((a, b) => a.nombre.localeCompare(b.nombre));
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

// ── Buscar por nombre o documento (client-side) ─────────────
export async function buscarPacientes(termino) {
  try {
    const todos = await obtenerPacientes();
    const t = termino.toLowerCase().trim();
    return todos.filter(p =>
      p.nombre.toLowerCase().includes(t) ||
      (p.telefono && p.telefono.includes(t)) ||
      (p.documento && p.documento.includes(t))
    );
  } catch (error) {
    return [];
  }
}

// ── Filtrar por ciudad (client-side) ───────────────────────
export async function filtrarPorCiudad(ciudad) {
  try {
    const todos = await obtenerPacientes();
    if (!ciudad) return todos;
    // Busca tanto en formato nuevo "Depto > Ciudad" como en ciudad exacta (legacy)
    return todos.filter(p => p.ciudad === ciudad || (p.ciudad && p.ciudad.includes(ciudad)));
  } catch (error) {
    return [];
  }
}
