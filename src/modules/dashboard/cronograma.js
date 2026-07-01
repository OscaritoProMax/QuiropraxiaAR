// ══════════════════════════════════════════════════════════
// js/dashboard/cronograma.js
// Vista "Cronograma del día" — citas pasadas, en curso y próximas
// Auto-completa citas de días anteriores que quedaron activas
// ══════════════════════════════════════════════════════════

import { obtenerCitasPorFecha, cambiarEstado, cancelarCita,
         reprogramarCita, ESTADOS }   from '../citas/citasService.js';
import { getDocs, collection, query,
         where }                      from 'firebase/firestore';
import { db }                         from '../../core/firebase.js';
import { badgeEstado, HOY }           from '../../shared/helpers.js';
import { hora12Display }              from '../../shared/timePicker.js';
import { mostrarHistorialCita }       from './ui.js';

// ── Hora actual en formato "HH:MM" ────────────────────────
function horaActual() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
}

// ── Comparar horas "HH:MM" ────────────────────────────────
function horaMenorQue(a, b)  { return a < b; }
function horaEnRango(h, ini, fin) { return h >= ini && h < fin; }

// ── Clasificar cita según hora actual ────────────────────
function clasificar(hora) {
  const ahora  = horaActual();
  const [hh, mm] = hora.split(':').map(Number);
  const finStr = `${String(hh).padStart(2,'0')}:${String(mm + 20).padStart(2,'0')}`;
  if (horaMenorQue(hora, ahora) && !horaEnRango(ahora, hora, finStr)) return 'pasada';
  if (horaEnRango(ahora, hora, finStr)) return 'en_curso';
  return 'proxima';
}

// ══════════════════════════════════════════════════════════
// AUTO-COMPLETAR citas activas de días anteriores
// Llama esto una vez al iniciar el dashboard
// ══════════════════════════════════════════════════════════
export async function autoCompletarCitasViejas() {
  try {
    const q    = query(collection(db, 'citas'),
                   where('estado', '==', ESTADOS.ACTIVA),
                   where('fecha',  '<',  HOY));
    const snap = await getDocs(q);

    if (snap.empty) return 0;

    // Completar en paralelo (sin esperar una por una)
    await Promise.all(
      snap.docs.map(d => cambiarEstado(d.id, ESTADOS.COMPLETADA, null, 'Sistema', 'Auto-completada por vencimiento de fecha'))
    );

    return snap.docs.length; // cuántas se auto-completaron
  } catch (err) {
    console.warn('autoCompletarCitasViejas:', err);
    return 0;
  }
}

// ══════════════════════════════════════════════════════════
// RENDERIZAR CRONOGRAMA
// ══════════════════════════════════════════════════════════
export async function renderCronograma({ onReprogramar, onCancelar, onCompletar, permitirCompletar = true, filtrarSede = null }) {
  const cont = document.getElementById('cronograma-container');
  if (!cont) return;
  cont.innerHTML = '<div class="empty-state">Cargando cronograma...</div>';

  const citas = await obtenerCitasPorFecha(HOY);

  // Solo citas no canceladas
  let activas = citas.filter(c => c.estado !== ESTADOS.CANCELADA);

  // En día de viaje, el admin solo ve las citas de esa sede.
  if (filtrarSede) activas = activas.filter(c => (c.sede || '') === filtrarSede);

  if (!activas.length) {
    cont.innerHTML = '<div class="empty-state">No hay citas programadas para hoy</div>';
    actualizarResumenCronograma([], []);
    return;
  }

  // Separar por clasificación
  const pasadas   = activas.filter(c => c.estado === ESTADOS.ACTIVA && clasificar(c.hora) === 'pasada');
  const en_curso  = activas.filter(c => c.estado === ESTADOS.ACTIVA && clasificar(c.hora) === 'en_curso');
  const proximas  = activas.filter(c => c.estado === ESTADOS.ACTIVA && clasificar(c.hora) === 'proxima');
  const completadas = activas.filter(c => c.estado === ESTADOS.COMPLETADA);

  actualizarResumenCronograma(pasadas, en_curso);

  let html = '';

  // ── En curso ───────────────────────────────────────────
  if (en_curso.length) {
    html += `
      <div class="crono-section-label crono-en-curso-label">
        🟢 Atendiendo ahora
      </div>`;
    en_curso.forEach(c => {
      html += tarjetaCita(c, 'en_curso', permitirCompletar);
    });
  }

  // ── Pasadas sin atender ────────────────────────────────
  if (pasadas.length) {
    html += `
      <div class="crono-section-label crono-pasada-label">
        ⚠️ Hora pasada — sin atender (${pasadas.length})
        ${permitirCompletar ? `
        <button class="btn btn-soft btn-sm" id="btn-completar-pasadas" style="margin-left:12px">
          ✓ Completar todas
        </button>` : ''}
      </div>`;
    pasadas.forEach(c => {
      html += tarjetaCita(c, 'pasada', permitirCompletar);
    });
  }

  // ── Próximas ───────────────────────────────────────────
  if (proximas.length) {
    html += `
      <div class="crono-section-label crono-proxima-label">
        🕐 Próximas (${proximas.length})
      </div>`;
    proximas.forEach(c => {
      html += tarjetaCita(c, 'proxima', permitirCompletar);
    });
  }

  // ── Completadas ─────────────────────────────────────────
  if (completadas.length) {
    html += `
      <div class="crono-section-label" style="color:#1a7a47;margin-top:16px">
        ✅ Completadas hoy (${completadas.length})
      </div>`;
    completadas.forEach(c => {
      html += tarjetaCita(c, 'completada', permitirCompletar);
    });
  }

  cont.innerHTML = html;

  // ── Eventos ───────────────────────────────────────────
  const citasPorId = Object.fromEntries(activas.map(c => [c.id, c]));
  cont.querySelectorAll('[data-crono-historial]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cita = citasPorId[btn.dataset.cronoHistorial];
      if (cita) mostrarHistorialCita(cita);
    });
  });

  if (permitirCompletar) {
    cont.querySelectorAll('[data-crono-completar]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await onCompletar(btn.dataset.cronoCompletar);
        await renderCronograma({ onReprogramar, onCancelar, onCompletar, permitirCompletar });
      });
    });
  }

  cont.querySelectorAll('[data-crono-cancelar]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Cancelar esta cita?')) return;
      await onCancelar(btn.dataset.cronoCancelar);
      await renderCronograma({ onReprogramar, onCancelar, onCompletar, permitirCompletar });
    });
  });

  cont.querySelectorAll('[data-crono-reprog]').forEach(btn => {
    btn.addEventListener('click', () => onReprogramar(btn.dataset.cronoReprog));
  });

  // ── Completar todas las pasadas ───────────────────────
  const btnTodas = document.getElementById('btn-completar-pasadas');
  if (btnTodas && permitirCompletar) {
    btnTodas.addEventListener('click', async () => {
      btnTodas.textContent = 'Completando...';
      btnTodas.disabled = true;
      await Promise.all(pasadas.map(c => onCompletar(c.id)));
      await renderCronograma({ onReprogramar, onCancelar, onCompletar, permitirCompletar });
    });
  }
}

// ── Tarjeta HTML de cada cita ─────────────────────────────
function tarjetaCita(cita, tipo, permitirCompletar = true) {
  const esActiva = cita.estado === ESTADOS.ACTIVA;

  const borderColor = {
    en_curso:   '#1a7a47',
    pasada:     '#946a00',
    proxima:    '#0A76D8',
    completada: '#c8d6e0',
  }[tipo] || '#ebebeb';

  const bgColor = {
    en_curso:   '#f0fff6',
    pasada:     '#fffbf0',
    proxima:    '#f8fbff',
    completada: '#f8f9fa',
  }[tipo] || '#fff';

  return `
    <div class="crono-card"
      style="border-left:4px solid ${borderColor};background:${bgColor}"
      data-cita-id="${cita.id}"
      data-cliente-id="${cita.clienteId     || ''}"
      data-cliente-ciudad="${cita.clienteCiudad || ''}"
      data-tipo-sesion="${cita.tipo          || 'Ajuste general'}"
      data-hora="${cita.hora}">
      <div class="crono-hora">${hora12Display(cita.hora)}</div>
      <div class="crono-info">
        <div class="crono-nombre">${cita.clienteNombre}</div>
        <div class="crono-meta">${cita.tipo} · ${cita.clienteCiudad || 'Ciudad no registrada'}</div>
        ${cita.notas ? `<div class="crono-notas">"${cita.notas}"</div>` : ''}
      </div>
      ${badgeEstado(cita.estado)}
      <div class="crono-actions">
        <button class="btn btn-gray btn-sm" data-crono-historial="${cita.id}" title="Ver información e historial">ℹ Info</button>
        ${esActiva ? `
          <button class="btn btn-gray btn-sm"   data-crono-reprog="${cita.id}">↺ Reprogramar</button>
          <button class="btn btn-danger btn-sm" data-crono-cancelar="${cita.id}">✕ Cancelar</button>
          ${permitirCompletar ? `<button class="btn btn-soft btn-sm" data-crono-completar="${cita.id}">✓ Completar</button>` : ''}
        ` : ''}
      </div>
    </div>`;
}

// ── Actualizar pills de resumen ───────────────────────────
function actualizarResumenCronograma(pasadas, en_curso) {
  const el = document.getElementById('crono-resumen');
  if (!el) return;
  el.innerHTML = `
    ${en_curso.length  ? `<span class="badge badge-success" style="font-size:13px">🟢 En curso: ${en_curso.length}</span>` : ''}
    ${pasadas.length   ? `<span class="badge badge-warning" style="font-size:13px;margin-left:8px">⚠️ Sin atender: ${pasadas.length}</span>` : ''}
    ${!en_curso.length && !pasadas.length ? '<span style="font-size:13px;color:#1a7a47">✅ Todo al día</span>' : ''}
  `;
}
