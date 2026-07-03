// src/shared/notificaciones.js — Notificaciones en vivo del dashboard
// Hace funcionales los 3 toggles de Configuración → Notificaciones:
// citas próximas (15 min antes), cancelaciones y resumen diario al cierre.
//
// LECTURA A FIRESTORE, EXPLICADO: en vez de volver a consultar
// "citas de hoy" cada minuto (lo que costaría N lecturas × cada chequeo,
// aunque nada haya cambiado), se abre UN solo listener en tiempo real
// (onSnapshot) por sesión. Firestore solo cobra lectura por el snapshot
// inicial y, de ahí en más, únicamente por los documentos que realmente
// cambian — no por cada minuto que pasa. El chequeo de "¿ya está a 15
// minutos de la cita?" corre cada minuto igual, pero contra la copia local
// en memoria (_citasHoyCache), sin volver a tocar la base de datos.
//
// Mientras la app esté abierta (navegador o empaquetada en Android vía
// Capacitor) se avisa con:
//  1) un toast dentro de la app (siempre funciona, sea cual sea la
//     plataforma — es el respaldo confiable en Android, donde el soporte
//     de la API Notification dentro del WebView es irregular según el
//     dispositivo), y
//  2) una notificación del sistema vía la API Notification del navegador,
//     cuando el dispositivo la soporta y el permiso fue concedido.
// Al hacer clic en cualquiera de las dos (para una cita próxima o
// cancelada) se abre el modal de información de esa cita.
import { onSnapshot, collection, query, where } from 'firebase/firestore';
import { db } from '../core/firebase.js';
import { ESTADOS } from '../modules/citas/citasService.js';
import { obtenerConfiguracion } from '../modules/finanzas/pagosService.js';
import { mostrarHistorialCita } from '../modules/dashboard/ui.js';
import { toast } from './interactions.js';
import { hora12Display } from './timePicker.js';
import { HOY } from './helpers.js';

const AVISO_MIN_ANTES = 15;
const CHEQUEO_MS = 60 * 1000;

function _toggleActivo(key, defaultOn) {
  const v = localStorage.getItem('qm-toggle-' + key);
  if (v === 'off') return false;
  if (v === 'on') return true;
  return defaultOn;
}

let _permisoPedido = false;
async function _pedirPermiso() {
  if (_permisoPedido || typeof Notification === 'undefined') return;
  _permisoPedido = true;
  if (Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch (_) { /* no-op */ }
  }
}

// Se puede llamar también desde un gesto explícito del usuario (ej. al
// activar un toggle) — algunos navegadores ignoran requestPermission()
// si no viene de una interacción directa.
export function solicitarPermisoNotificaciones() {
  _permisoPedido = false;
  return _pedirPermiso();
}

function _notificar(titulo, cuerpo, cita = null) {
  toast(`${titulo} — ${cuerpo}`, 'info', {
    duracion: 7000,
    onClick: cita ? () => mostrarHistorialCita(cita) : undefined,
  });
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const n = new Notification(titulo, { body: cuerpo });
      if (cita) {
        n.onclick = () => {
          window.focus();
          mostrarHistorialCita(cita);
          n.close();
        };
      }
    }
  } catch (_) { /* Notification no disponible en esta plataforma — el toast ya avisó. */ }
}

function _minutosAhora() {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}
function _minutosDeHora(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// ── Persistencia de "ya avisado" — en localStorage, no en memoria, para
// que cada evento (una cita próxima, una cancelación) se notifique UNA
// SOLA VEZ para siempre, así el usuario cierre y vuelva a abrir la app.
// Las claves se agrupan por día (HOY) para poder limpiarlas cuando pasan
// de fecha, sin que crezcan sin control con el tiempo. ──
const PREFIJO_PROXIMAS   = 'qm-notif-proximas-';
const PREFIJO_CANCELADAS = 'qm-notif-canceladas-';
const CLAVE_RESUMEN_DIA  = 'qm-notif-resumen-dia';

function _leerSet(clave) {
  try { return new Set(JSON.parse(localStorage.getItem(clave) || '[]')); }
  catch (_) { return new Set(); }
}
function _marcarAvisado(clave, id) {
  const set = _leerSet(clave);
  set.add(id);
  try { localStorage.setItem(clave, JSON.stringify([...set])); } catch (_) { /* no-op */ }
}

// Borra los registros de días anteriores — de HOY en adelante ya no hacen falta.
function _limpiarClavesViejas() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k) continue;
      if ((k.startsWith(PREFIJO_PROXIMAS) && k !== PREFIJO_PROXIMAS + HOY) ||
          (k.startsWith(PREFIJO_CANCELADAS) && k !== PREFIJO_CANCELADAS + HOY)) {
        localStorage.removeItem(k);
      }
    }
  } catch (_) { /* no-op */ }
}

// ── Copia local de "citas de hoy", mantenida al día por el listener de
// Firestore — todo lo que sigue lee de acá, nunca vuelve a consultar. ──
let _citasHoyCache = [];

function _evaluarProximas() {
  if (!_toggleActivo('notif-citas', true)) return;
  const clave    = PREFIJO_PROXIMAS + HOY;
  const avisadas = _leerSet(clave);
  const ahoraMin = _minutosAhora();
  _citasHoyCache
    .filter(c => c.estado === ESTADOS.ACTIVA && !avisadas.has(c.id))
    .forEach(c => {
      const diff = _minutosDeHora(c.hora) - ahoraMin;
      if (diff >= 0 && diff <= AVISO_MIN_ANTES) {
        _marcarAvisado(clave, c.id);
        _notificar('Cita próxima', `${c.clienteNombre} a las ${hora12Display(c.hora)}`, c);
      }
    });
}

function _evaluarCancelaciones() {
  if (!_toggleActivo('notif-cancel', true)) return;
  const clave    = PREFIJO_CANCELADAS + HOY;
  const avisadas = _leerSet(clave);
  _citasHoyCache
    .filter(c => c.estado === ESTADOS.CANCELADA && !avisadas.has(c.id))
    .forEach(c => {
      _marcarAvisado(clave, c.id);
      _notificar('Cita cancelada', `${c.clienteNombre} — ${hora12Display(c.hora)}`, c);
    });
}

function _evaluarResumen(horaFin) {
  if (!_toggleActivo('notif-resumen', false) || !horaFin) return;
  if (_minutosAhora() < _minutosDeHora(horaFin)) return;
  if (localStorage.getItem(CLAVE_RESUMEN_DIA) === HOY) return;
  try { localStorage.setItem(CLAVE_RESUMEN_DIA, HOY); } catch (_) { /* no-op */ }
  const completadas = _citasHoyCache.filter(c => c.estado === ESTADOS.COMPLETADA).length;
  const canceladasN = _citasHoyCache.filter(c => c.estado === ESTADOS.CANCELADA).length;
  _notificar('Resumen del día', `${completadas} completada${completadas !== 1 ? 's' : ''} · ${canceladasN} cancelada${canceladasN !== 1 ? 's' : ''} de ${_citasHoyCache.length} citas`);
}

let _unsubscribe = null;
function _iniciarListener() {
  if (_unsubscribe) return;
  const q = query(collection(db, 'citas'), where('fecha', '==', HOY));
  _unsubscribe = onSnapshot(q, (snap) => {
    _citasHoyCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Se reacciona apenas cambia algo en Firestore (cancelación, o una
    // reprogramación que meta una cita en la ventana de 15 min) — sin
    // esperar al siguiente chequeo del minutero.
    _evaluarCancelaciones();
    _evaluarProximas();
  }, (err) => {
    console.warn('notificaciones: error en el listener de citas del día:', err);
  });
}

let _iniciado = false;
export async function iniciarNotificaciones() {
  if (_iniciado) return;
  _iniciado = true;

  _limpiarClavesViejas();
  _pedirPermiso();
  _iniciarListener();

  const { horaFin } = await obtenerConfiguracion().catch(() => ({ horaFin: null }));
  // El minutero solo evalúa la ventana de 15 min y el resumen de cierre
  // contra la copia en memoria — nunca vuelve a leer Firestore.
  setInterval(() => {
    _evaluarProximas();
    _evaluarResumen(horaFin);
  }, CHEQUEO_MS);
}
