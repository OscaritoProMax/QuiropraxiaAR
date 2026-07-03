// src/modules/finanzas/pagosService.js
// Módulo de finanzas — registra cobros al completar citas
// Colección Firestore: "pagos"

import {
  collection, addDoc, getDocs, query,
  where, serverTimestamp, doc, getDoc, setDoc
} from 'firebase/firestore';
import { db } from '../../core/firebase.js';

export const TARIFA_BASE = 50000; // COP — valor de respaldo si no hay configuración guardada

// Caché en memoria de la tarifa configurada, para uso síncrono en formularios.
// Se actualiza al cargar la app (obtenerConfiguracion) y al guardar (guardarConfiguracion).
let _tarifaBaseActual = TARIFA_BASE;

export function obtenerTarifaBaseActual() {
  return _tarifaBaseActual;
}

// ── Configuración general (tarifa base, meta diaria) ──────
export async function obtenerConfiguracion() {
  try {
    const snap = await getDoc(doc(db, 'configuracion', 'general'));
    const data = snap.exists() ? snap.data() : {};
    const tarifaBase = data.tarifaBase || TARIFA_BASE;
    _tarifaBaseActual = tarifaBase;
    return {
      tarifaBase,
      metaDia:    data.metaDia    || 600000,
      horaInicio: data.horaInicio || '09:00',
      horaFin:    data.horaFin    || '18:00',
    };
  } catch (error) {
    console.error('Error obteniendo configuración:', error);
    return { tarifaBase: TARIFA_BASE, metaDia: 600000, horaInicio: '09:00', horaFin: '18:00' };
  }
}

// Guarda solo los campos provistos (merge). Acepta cualquier combinación
// de { tarifaBase, metaDia, horaInicio, horaFin }.
export async function guardarConfiguracion(cambios = {}) {
  try {
    await setDoc(doc(db, 'configuracion', 'general'), cambios, { merge: true });
    if (typeof cambios.tarifaBase === 'number') _tarifaBaseActual = cambios.tarifaBase;
    return { ok: true };
  } catch (error) {
    console.error('Error guardando configuración:', error);
    return { ok: false, error: 'No se pudo guardar la configuración.' };
  }
}

// ── Registrar un pago al completar cita ───────────────────
export async function registrarPago(datos) {
  try {
    const {
      citaId, clienteId, clienteNombre, clienteCiudad,
      fecha, hora, tipoSesion,
      tarifaBase = TARIFA_BASE,
      medicamentos = [],   // [{ nombre, precio }]
      usuarioId,
      metodoPago = 'efectivo',      // 'efectivo' | 'nequi' | 'daviplata'
      modificadoPorAdmin = false,   // true si el admin ajustó el valor antes de aprobarlo
      totalOriginal = null,         // total enviado originalmente, cuando hubo edición
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
      metodoPago,
      modificadoPorAdmin,
      ...(totalOriginal != null ? { totalOriginal } : {}),
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

// ── Totales por método de pago (efectivo / nequi / daviplata) ─────
// Los pagos registrados antes de este campo no tienen metodoPago
// guardado — se asumen "efectivo" para no perder esos montos del total.
export function calcularTotalesPorMetodo(pagos) {
  const totales = { efectivo: 0, nequi: 0, daviplata: 0 };
  pagos.forEach(p => {
    const m = totales[p.metodoPago] !== undefined ? p.metodoPago : 'efectivo';
    totales[m] += (p.totalCobrado || 0);
  });
  return totales;
}

// ── Formatear como pesos colombianos ─────────────────────
export function formatCOP(valor) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', maximumFractionDigits: 0
  }).format(valor);
}
