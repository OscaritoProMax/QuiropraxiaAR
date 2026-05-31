// src/modules/informes/informesService.js
// Capa de agregación de datos para el módulo de informes

import {
  collection, getDocs, query, where
} from 'firebase/firestore';
import { db }          from '../../core/firebase.js';
import { ESTADOS }     from '../citas/citasService.js';
import { formatCOP, calcularTotalesDia } from '../finanzas/pagosService.js';

export { formatCOP };

// ── Citas por rango de fechas ─────────────────────────────
export async function obtenerCitasPorRango(desde, hasta) {
  try {
    const q    = query(collection(db, 'citas'),
                   where('fecha', '>=', desde),
                   where('fecha', '<=', hasta));
    const snap = await getDocs(q);
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    docs.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora));
    return docs;
  } catch (err) {
    console.error('obtenerCitasPorRango:', err);
    return [];
  }
}

// ── Pagos por rango de fechas ─────────────────────────────
export async function obtenerPagosPorRango(desde, hasta) {
  try {
    const q    = query(collection(db, 'pagos'),
                   where('fecha', '>=', desde),
                   where('fecha', '<=', hasta));
    const snap = await getDocs(q);
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    docs.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora));
    return docs;
  } catch (err) {
    console.error('obtenerPagosPorRango:', err);
    return [];
  }
}

// ── Pacientes nuevos en rango ─────────────────────────────
export async function obtenerPacientesNuevosEnRango(desde, hasta) {
  try {
    const snap = await getDocs(collection(db, 'clientes'));
    const todos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return todos.filter(p => {
      if (!p.fechaRegistro) return false;
      // fechaRegistro puede ser Timestamp de Firestore
      const fecha = p.fechaRegistro.toDate
        ? p.fechaRegistro.toDate().toISOString().split('T')[0]
        : String(p.fechaRegistro).slice(0, 10);
      return fecha >= desde && fecha <= hasta;
    });
  } catch (err) {
    console.error('obtenerPacientesNuevosEnRango:', err);
    return [];
  }
}

// ── Todos los pacientes ───────────────────────────────────
export async function obtenerTodosPacientes() {
  try {
    const snap = await getDocs(collection(db, 'clientes'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    return [];
  }
}

// ══════════════════════════════════════════════════════════
// FUNCIONES DE AGRUPACIÓN (client-side)
// ══════════════════════════════════════════════════════════

export function agruparPorDia(docs, campo = 'fecha') {
  return docs.reduce((acc, d) => {
    const key = d[campo] || 'sin-fecha';
    if (!acc[key]) acc[key] = [];
    acc[key].push(d);
    return acc;
  }, {});
}

export function agruparPorMes(docs, campo = 'fecha') {
  return docs.reduce((acc, d) => {
    const key = (d[campo] || '').slice(0, 7);
    if (!acc[key]) acc[key] = [];
    acc[key].push(d);
    return acc;
  }, {});
}

export function agruparPorCampo(docs, campo) {
  return docs.reduce((acc, d) => {
    const key = d[campo] || 'Sin especificar';
    if (!acc[key]) acc[key] = [];
    acc[key].push(d);
    return acc;
  }, {});
}

// ── Calcular resumen de citas ─────────────────────────────
export function calcularResumenCitas(citas) {
  const total        = citas.length;
  const completadas  = citas.filter(c => c.estado === ESTADOS.COMPLETADA).length;
  const canceladas   = citas.filter(c => c.estado === ESTADOS.CANCELADA).length;
  const reprogramadas= citas.filter(c => c.estado === ESTADOS.REPROGRAMADA).length;
  const activas      = citas.filter(c => c.estado === ESTADOS.ACTIVA).length;
  const tasaAtencion = total > 0 ? Math.round((completadas / total) * 100) : 0;
  return { total, completadas, canceladas, reprogramadas, activas, tasaAtencion };
}

// ── Calcular resumen financiero ───────────────────────────
export function calcularResumenFinanciero(pagos) {
  const { total, soloSesiones, soloMeds, cantidad } = calcularTotalesDia(pagos);
  const diasUnicos = new Set(pagos.map(p => p.fecha)).size;
  const promedioDia = diasUnicos > 0 ? Math.round(total / diasUnicos) : 0;
  const promedioSesion = cantidad > 0 ? Math.round(total / cantidad) : 0;

  // Top tipos de sesión
  const porTipo = agruparPorCampo(pagos, 'tipoSesion');
  const topTipos = Object.entries(porTipo)
    .map(([tipo, ps]) => ({
      tipo,
      cantidad: ps.length,
      total: ps.reduce((s, p) => s + (p.totalCobrado || 0), 0)
    }))
    .sort((a, b) => b.total - a.total);

  return { total, soloSesiones, soloMeds, cantidad, diasUnicos, promedioDia, promedioSesion, topTipos };
}

// ── Helpers de fecha ──────────────────────────────────────
export function primerDiaMes(mesStr) { return `${mesStr}-01`; }
export function ultimoDiaMes(mesStr) {
  const [y, m] = mesStr.split('-').map(Number);
  return new Date(y, m, 0).toISOString().split('T')[0];
}

export function fechaLegible(iso, opts = {}) {
  if (!iso) return '—';
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-CO', {
    day: 'numeric', month: 'long', year: 'numeric', ...opts
  });
}

export function mesLegible(mesStr) {
  return new Date(mesStr + '-15').toLocaleDateString('es-CO', {
    month: 'long', year: 'numeric'
  });
}
