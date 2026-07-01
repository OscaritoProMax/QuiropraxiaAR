// ══════════════════════════════════════════════════════════
// configuracion.js — Modulo de configuracion del sistema
// Maneja: tema dual, KPIs expandidos, toggles, reloj
// Proyecto: Quiromasajes
// ══════════════════════════════════════════════════════════

import { obtenerPagosMes, obtenerConfiguracion,
         guardarConfiguracion, TARIFA_BASE }   from '../finanzas/pagosService.js';
import { obtenerPacientes }                    from '../pacientes/pacientesService.js';
import { obtenerCitasPorFecha, ESTADOS,
         cargarHorarios, HORARIOS }            from '../citas/citasService.js';
import { HOY }                                 from '../../shared/helpers.js';
import { hora12Display, updateTimePicker }     from '../../shared/timePicker.js';

// ══════════════════════════════════════════════════════════
// PUNTO DE ENTRADA
// ══════════════════════════════════════════════════════════
export function initConfiguracion() {
  initTema();
  initReloj();
  initToggles();
  initConfigForms();
  initNavConfiguracion();
  initKpisExtra();
  initActividadReciente();
}

// ══════════════════════════════════════════════════════════
// TEMA DUAL — light / dark
// ══════════════════════════════════════════════════════════
function initTema() {
  const guardado = localStorage.getItem('qm-theme') || 'light';
  aplicarTema(guardado);

  document.querySelectorAll('[data-theme-pick]').forEach(card => {
    card.addEventListener('click', () => {
      aplicarTema(card.dataset.themePick);
    });
  });
}

function aplicarTema(tema) {
  document.documentElement.setAttribute('data-theme', tema);
  localStorage.setItem('qm-theme', tema);

  // Actualizar estado visual de las cards
  document.querySelectorAll('[data-theme-pick]').forEach(card => {
    const esActivo = card.dataset.themePick === tema;
    card.classList.toggle('theme-card-active', esActivo);
  });
}

// ══════════════════════════════════════════════════════════
// RELOJ EN TIEMPO REAL
// ══════════════════════════════════════════════════════════
function initReloj() {
  const el = document.getElementById('topbar-reloj');
  if (!el) return;

  function tick() {
    const n = new Date();
    const h = String(n.getHours()).padStart(2, '0');
    const m = String(n.getMinutes()).padStart(2, '0');
    const s = String(n.getSeconds()).padStart(2, '0');
    el.textContent = `${h}:${m}:${s}`;
  }
  tick();
  setInterval(tick, 1000);
}

// ══════════════════════════════════════════════════════════
// TOGGLES DE NOTIFICACIONES
// ══════════════════════════════════════════════════════════
function initToggles() {
  document.querySelectorAll('[data-toggle]').forEach(sw => {
    const key = 'qm-toggle-' + sw.dataset.toggle;
    const guardado = localStorage.getItem(key);

    // Restaurar estado guardado
    if (guardado === 'off') {
      sw.classList.remove('toggle-on');
    } else if (guardado === 'on') {
      sw.classList.add('toggle-on');
    }

    sw.addEventListener('click', () => {
      sw.classList.toggle('toggle-on');
      localStorage.setItem(key, sw.classList.contains('toggle-on') ? 'on' : 'off');
    });
  });
}

// ══════════════════════════════════════════════════════════
// FORMULARIOS DE CONFIGURACION
// ══════════════════════════════════════════════════════════
async function initConfigForms() {
  // Tarifa, meta diaria y horario de la jornada se guardan en Firestore
  // (configuracion/general) para que apliquen de inmediato en todos los
  // apartados y para todos los roles (cobro, finanzas, slots de citas, etc).
  const { tarifaBase, metaDia, horaInicio, horaFin } = await obtenerConfiguracion();

  setVal('cfg-tarifa',       tarifaBase);
  setVal('cfg-meta-dia',     metaDia);
  setVal('cfg-hora-inicio',  horaInicio);
  setVal('cfg-hora-fin',     horaFin);

  // Guardar ingresos
  document.getElementById('btn-guardar-cfg-ingresos')
    ?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-guardar-cfg-ingresos');
      const tarifaNueva = Number(getVal('cfg-tarifa')) || TARIFA_BASE;
      const metaNueva   = Number(getVal('cfg-meta-dia')) || 0;
      btn.disabled = true;
      const res = await guardarConfiguracion({ tarifaBase: tarifaNueva, metaDia: metaNueva });
      btn.disabled = false;
      if (res.ok) mostrarFeedback('btn-guardar-cfg-ingresos', 'Guardado');
    });

  // Guardar horario de la jornada de atención.
  // Define a qué hora inicia y termina la atención → genera los slots de
  // citas (intervalo fijo de 20 min). Aplica para todos los roles.
  document.getElementById('btn-guardar-cfg-horario')
    ?.addEventListener('click', async () => {
      const btn    = document.getElementById('btn-guardar-cfg-horario');
      const inicio = getVal('cfg-hora-inicio');
      const fin    = getVal('cfg-hora-fin');

      if (!inicio || !fin || fin <= inicio) {
        mostrarFeedback('btn-guardar-cfg-horario', 'La hora fin debe ser mayor que la de inicio', true);
        return;
      }

      btn.disabled = true;
      const res = await guardarConfiguracion({ horaInicio: inicio, horaFin: fin });
      btn.disabled = false;

      if (res.ok) {
        await cargarHorarios();                 // regenera HORARIOS (binding vivo)
        updateTimePicker('c-hora', HORARIOS);   // refresca los selects de hora
        updateTimePicker('r-hora', HORARIOS);
        mostrarFeedback('btn-guardar-cfg-horario', 'Guardado');
      } else {
        mostrarFeedback('btn-guardar-cfg-horario', 'No se pudo guardar', true);
      }
    });

  // Boton nuevo usuario desde configuracion
  document.getElementById('btn-nuevo-usuario-cfg')
    ?.addEventListener('click', () => {
      const overlay = document.getElementById('modal-usuario');
      if (overlay) overlay.classList.add('open');
    });
}

function setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}
function getVal(id) {
  return document.getElementById(id)?.value || '';
}

function mostrarFeedback(btnId, texto, esError = false) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const original = btn.textContent;
  btn.textContent = esError ? texto : texto + ' correctamente';
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = original;
    btn.disabled = false;
  }, esError ? 2600 : 1800);
}

// ══════════════════════════════════════════════════════════
// NAVEGACION — vista configuracion
// ══════════════════════════════════════════════════════════
function initNavConfiguracion() {
  // El handler principal en handlers.js ya maneja la navegacion.
  // Aqui agregamos la vista de configuracion que no estaba en el original.
  const btnConfig = document.querySelector('.menu-btn[data-view="configuracion"]');
  if (!btnConfig) return;

  btnConfig.addEventListener('click', () => {
    document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.menu-btn').forEach(b => b.classList.remove('menu-active'));

    const sec = document.getElementById('view-configuracion');
    if (sec) sec.classList.add('active');
    btnConfig.classList.add('menu-active');

    const t = document.getElementById('topbar-title');
    const s = document.getElementById('topbar-sub');
    if (t) t.textContent = 'Configuracion';
    if (s) s.textContent = 'Ajustes del sistema';

    const actions = document.getElementById('topbar-actions');
    if (actions) actions.innerHTML = '';
  });
}

// ══════════════════════════════════════════════════════════
// KPIs EXTRA — sesiones por tipo, ring pacientes, cancelacion, actividad
// Datos reales desde Firebase
// ══════════════════════════════════════════════════════════
async function initKpisExtra() {
  const mesActual = HOY.slice(0, 7);
  const [pagosDelMes, todosPacientes, citasHoy] = await Promise.all([
    obtenerPagosMes(mesActual),
    obtenerPacientes(),
    obtenerCitasPorFecha(HOY),
  ]);
  renderTiposBarras(pagosDelMes);
  renderRingPacientes(todosPacientes);
  renderCancelacionBarras(citasHoy);
}

// Sesiones por tipo — barras horizontales con datos reales de pagos del mes
function renderTiposBarras(pagos) {
  const cont = document.getElementById('tipos-barras');
  if (!cont) return;

  if (!pagos.length) {
    cont.innerHTML = '<div style="color:var(--th-text2,#888);font-size:13px;padding:12px 0">Sin sesiones registradas este mes</div>';
    return;
  }

  const COLORES = ['#0A76D8', '#1a7a47', '#946a00', '#7c3aed', '#c0392b', '#e67e22'];
  const counts  = {};
  for (const p of pagos) {
    const t = p.tipoSesion || 'Ajuste general';
    counts[t] = (counts[t] || 0) + 1;
  }
  const total = pagos.length;
  const tipos = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([nombre, cantidad], i) => ({
      nombre,
      pct:   Math.round(cantidad / total * 100),
      color: COLORES[i % COLORES.length],
    }));

  cont.innerHTML = tipos.map(t => `
    <div class="tipo-row">
      <div class="tipo-header">
        <span class="tipo-nombre">${t.nombre}</span>
        <span class="tipo-pct">${t.pct}%</span>
      </div>
      <div class="tipo-bar-bg">
        <div class="tipo-bar-fill" style="width:0%;background:${t.color}" data-w="${t.pct}%"></div>
      </div>
    </div>`).join('');

  setTimeout(() => {
    cont.querySelectorAll('.tipo-bar-fill').forEach(bar => {
      bar.style.width = bar.dataset.w;
    });
  }, 200);
}

// Ring nuevos vs recurrentes — basado en fecha de registro de pacientes
function renderRingPacientes(pacientes) {
  const ringRec = document.getElementById('ring-rec');
  const ringNew = document.getElementById('ring-new');
  const pctEl   = document.getElementById('ring-pct-rec');
  const recEl   = document.getElementById('ring-count-rec');
  const newEl   = document.getElementById('ring-count-new');

  const ahora     = new Date();
  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);

  const nuevos = pacientes.filter(p => {
    const fr = p.fechaRegistro;
    if (!fr) return false;
    const d = fr.toDate ? fr.toDate() : new Date(fr);
    return d >= inicioMes;
  }).length;

  const total       = pacientes.length;
  const recurrentes = total - nuevos;
  const pctRec      = total > 0 ? Math.round(recurrentes / total * 100) : 0;
  const pctNew      = 100 - pctRec;
  const circumference = 2 * Math.PI * 46;

  if (pctEl)  pctEl.textContent = `${pctRec}%`;
  if (recEl)  recEl.textContent = recurrentes;
  if (newEl)  newEl.textContent = nuevos;

  if (ringRec) ringRec.style.strokeDashoffset = circumference * (1 - pctRec / 100);
  if (ringNew) ringNew.style.strokeDashoffset = circumference * (1 - pctNew / 100);
}

// Barras de tasa de cancelacion — dato real de hoy
function renderCancelacionBarras(citasHoy) {
  const cont = document.getElementById('cancelacion-barras');
  if (!cont) return;

  const total      = citasHoy.length;
  const canceladas = citasHoy.filter(c => c.estado === ESTADOS.CANCELADA).length;
  const pctHoy     = total > 0 ? Math.round(canceladas / total * 100) : 0;
  const colorHoy   = pctHoy >= 20 ? '#c0392b' : pctHoy >= 10 ? '#946a00' : '#1a7a47';

  const datos = [
    { label: 'Hoy',         pct: pctHoy, color: colorHoy, real: true },
    { label: 'Esta semana', pct: null,   color: '#946a00', real: false },
    { label: 'Este mes',    pct: null,   color: '#1a7a47', real: false },
  ];

  cont.innerHTML = datos.map(d => `
    <div class="tipo-row">
      <div class="tipo-header">
        <span class="tipo-nombre">${d.label}</span>
        <span class="tipo-pct" style="color:${d.color}">${d.real ? d.pct + '%' : '—'}</span>
      </div>
      <div class="tipo-bar-bg">
        ${d.real ? `<div class="tipo-bar-fill" style="width:0%;background:${d.color}" data-w="${d.pct}%"></div>` : ''}
      </div>
    </div>`).join('');

  setTimeout(() => {
    cont.querySelectorAll('.tipo-bar-fill').forEach(bar => {
      bar.style.width = bar.dataset.w;
    });
  }, 300);

  const alertEl = document.getElementById('alert-cancelacion');
  if (alertEl) {
    if (pctHoy >= 15) {
      alertEl.className   = 'alert alert-error';
      alertEl.style.marginTop = '10px';
      alertEl.textContent = `Tasa de cancelacion alta hoy (${pctHoy}%). Revisar motivos.`;
    } else {
      alertEl.textContent = '';
    }
  }
}

// ══════════════════════════════════════════════════════════
// ACTIVIDAD RECIENTE — citas reales de hoy
// ══════════════════════════════════════════════════════════
async function initActividadReciente() {
  const cont = document.getElementById('actividad-lista');
  if (!cont) return;

  const citas = await obtenerCitasPorFecha(HOY);
  if (!citas.length) {
    cont.innerHTML = '<div style="color:var(--th-text2,#888);font-size:13px;padding:12px 0">Sin actividad registrada hoy</div>';
    return;
  }

  const items = citas
    .slice()
    .sort((a, b) => (b.hora || '').localeCompare(a.hora || ''))
    .slice(0, 8)
    .map(c => {
      if (c.estado === ESTADOS.COMPLETADA) {
        return { clase: 'actividad-dot-green', icono: checkSVG(),
          texto: `<strong>${c.clienteNombre}</strong> — Sesion completada`,
          hora: `${hora12Display(c.hora)} · ${c.tipo}` };
      } else if (c.estado === ESTADOS.CANCELADA) {
        return { clase: 'actividad-dot-red', icono: xSVG(),
          texto: `<strong>${c.clienteNombre}</strong> — Cita cancelada`,
          hora: `${hora12Display(c.hora)} · ${c.tipo}` };
      } else if (c.estado === ESTADOS.REPROGRAMADA) {
        return { clase: 'actividad-dot-yellow', icono: refreshSVG(),
          texto: `<strong>${c.clienteNombre}</strong> — Cita reprogramada`,
          hora: `${hora12Display(c.hora)} · ${c.tipo}` };
      }
      return { clase: 'actividad-dot-blue', icono: calSVG(),
        texto: `<strong>${c.clienteNombre}</strong> — Cita agendada`,
        hora: `${hora12Display(c.hora)} · ${c.tipo}` };
    });

  cont.innerHTML = items.map(item => `
    <div class="actividad-item">
      <div class="actividad-dot ${item.clase}">${item.icono}</div>
      <div>
        <div class="actividad-text">${item.texto}</div>
        <div class="actividad-time">${item.hora}</div>
      </div>
    </div>`).join('');
}

// SVG helpers minimalistas
function checkSVG() {
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;
}
function calSVG() {
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
}
function xSVG() {
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
}
function userSVG() {
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
}
function refreshSVG() {
  return `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
}

// ══════════════════════════════════════════════════════════
// EXPORTAR helpers para uso desde handlers.js si se necesita
// ══════════════════════════════════════════════════════════
export { aplicarTema, renderTiposBarras, renderRingPacientes, renderCancelacionBarras };
