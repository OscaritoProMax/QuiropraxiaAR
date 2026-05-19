// src/modules/finanzas/pagosService.js
// Módulo de finanzas — registra cobros al completar citas
// Colección Firestore: "pagos"

import {
  collection, addDoc, getDocs, query,
  where, serverTimestamp
} from 'firebase/firestore';
import { db } from '../../core/firebase.js';

export const TARIFA_BASE = 50000; // COP — tarifa estándar por sesión

// ── Registrar un pago al completar cita ───────────────────
export async function registrarPago(datos) {
  try {
    const {
      citaId, clienteId, clienteNombre, clienteCiudad,
      fecha, hora, tipoSesion,
      tarifaBase = TARIFA_BASE,
      medicamentos = [],   // [{ nombre, precio }]
      usuarioId
    } = datos;

    const totalMedicamentos = medicamentos.reduce((sum, m) => sum + (Number(m.precio) || 0), 0);
    const totalCobrado      = tarifaBase + totalMedicamentos;

    const ref = await addDoc(collection(db, 'pagos'), {
      citaId, clienteId, clienteNombre,
      clienteCiudad: clienteCiudad || '',
      fecha, hora,
      tipoSesion:    tipoSesion || 'Ajuste general',
      tarifaBase,
      medicamentos,
      totalMedicamentos,
      totalCobrado,
      usuarioId,
      timestamp: serverTimestamp()
    });

    return { ok: true, id: ref.id, totalCobrado };
  } catch (error) {
    console.error('Error registrando pago:', error);
    return { ok: false, error: 'No se pudo registrar el pago.' };
  }
}

// ── Obtener pagos de hoy ──────────────────────────────────
export async function obtenerPagosHoy(fecha) {
  try {
    const q    = query(collection(db, 'pagos'), where('fecha', '==', fecha));
    const snap = await getDocs(q);
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    docs.sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
    return docs;
  } catch (error) {
    console.error('Error obteniendo pagos:', error);
    return [];
  }
}

// ── Obtener pagos de un mes (YYYY-MM) ─────────────────────
export async function obtenerPagosMes(mes) {
  try {
    // mes = "2026-05" → fechas entre "2026-05-01" y "2026-05-31"
    const desde = `${mes}-01`;
    const hasta = `${mes}-31`;
    const q     = query(
      collection(db, 'pagos'),
      where('fecha', '>=', desde),
      where('fecha', '<=', hasta)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.error('Error obteniendo pagos del mes:', error);
    return [];
  }
}

// ── Totales del día ───────────────────────────────────────
export function calcularTotalesDia(pagos) {
  const total        = pagos.reduce((s, p) => s + (p.totalCobrado || 0), 0);
  const soloSesiones = pagos.reduce((s, p) => s + (p.tarifaBase  || 0), 0);
  const soloMeds     = pagos.reduce((s, p) => s + (p.totalMedicamentos || 0), 0);
  return { total, soloSesiones, soloMeds, cantidad: pagos.length };
}

// ── Totales del mes ───────────────────────────────────────
export function calcularTotalesMes(pagos) {
  return calcularTotalesDia(pagos); // misma estructura
}

// ── Formatear como pesos colombianos ─────────────────────
export function formatCOP(valor) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', maximumFractionDigits: 0
  }).format(valor);
}
