// ══════════════════════════════════════════════════════════
// configuracion.js — Modulo de configuracion del sistema
// Maneja: tema dual, KPIs expandidos, toggles, reloj
// Proyecto: Quiromasajes
// ══════════════════════════════════════════════════════════

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
function initConfigForms() {
  // Restaurar valores guardados
  const tarifa   = localStorage.getItem('qm-tarifa')    || '60000';
  const metaDia  = localStorage.getItem('qm-meta-dia')  || '600000';
  const horaIni  = localStorage.getItem('qm-hora-ini')  || '08:00';
  const horaFin  = localStorage.getItem('qm-hora-fin')  || '18:00';
  const duracion = localStorage.getItem('qm-duracion')  || '60';

  setVal('cfg-tarifa',       tarifa);
  setVal('cfg-meta-dia',     metaDia);
  setVal('cfg-hora-inicio',  horaIni);
  setVal('cfg-hora-fin',     horaFin);
  setVal('cfg-duracion',     duracion);

  // Guardar ingresos
  document.getElementById('btn-guardar-cfg-ingresos')
    ?.addEventListener('click', () => {
      localStorage.setItem('qm-tarifa',   getVal('cfg-tarifa'));
      localStorage.setItem('qm-meta-dia', getVal('cfg-meta-dia'));
      mostrarFeedback('btn-guardar-cfg-ingresos', 'Guardado');
    });

  // Guardar horario
  document.getElementById('btn-guardar-cfg-horario')
    ?.addEventListener('click', () => {
      localStorage.setItem('qm-hora-ini', getVal('cfg-hora-inicio'));
      localStorage.setItem('qm-hora-fin', getVal('cfg-hora-fin'));
      localStorage.setItem('qm-duracion', getVal('cfg-duracion'));
      mostrarFeedback('btn-guardar-cfg-horario', 'Guardado');
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

function mostrarFeedback(btnId, texto) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const original = btn.textContent;
  btn.textContent = texto + ' correctamente';
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = original;
    btn.disabled = false;
  }, 1800);
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
// KPIs EXTRA — sesiones por tipo, ring, cancelacion, actividad
// Se renderizan con datos de Firebase cuando esten disponibles
// y con datos demo mientras se carga
// ══════════════════════════════════════════════════════════
function initKpisExtra() {
  renderTiposBarras();
  renderRingDemo();
  renderCancelacionBarras();
}

// Sesiones por tipo — barras horizontales
function renderTiposBarras() {
  const cont = document.getElementById('tipos-barras');
  if (!cont) return;

  const tipos = [
    { nombre: 'Terapia lumbar',   pct: 38, color: '#0A76D8' },
    { nombre: 'Ajuste general',   pct: 25, color: '#1a7a47' },
    { nombre: 'Terapia cervical', pct: 18, color: '#946a00' },
    { nombre: 'Evaluacion inicial', pct: 11, color: '#7c3aed' },
    { nombre: 'Seguimiento',      pct: 8,  color: '#c0392b' },
  ];

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

  // Animar barras al aparecer
  setTimeout(() => {
    cont.querySelectorAll('.tipo-bar-fill').forEach(bar => {
      bar.style.width = bar.dataset.w;
    });
  }, 200);
}

// Ring nuevos vs recurrentes — demo hasta conectar Firebase
function renderRingDemo() {
  const pctRec = 68;
  const pctNew = 32;
  const total  = 247;
  const rec    = Math.round(total * pctRec / 100);
  const nuev   = total - rec;

  const circumference = 2 * Math.PI * 46; // 289

  const ringRec = document.getElementById('ring-rec');
  const ringNew = document.getElementById('ring-new');
  const pctEl   = document.getElementById('ring-pct-rec');
  const recEl   = document.getElementById('ring-count-rec');
  const newEl   = document.getElementById('ring-count-new');

  if (pctEl)  pctEl.textContent  = pctRec + '%';
  if (recEl)  recEl.textContent  = rec;
  if (newEl)  newEl.textContent  = nuev;

  if (ringRec) {
    const offset = circumference * (1 - pctRec / 100);
    ringRec.style.strokeDashoffset = offset;
  }
  if (ringNew) {
    const offset = circumference * (1 - pctNew / 100);
    ringNew.style.strokeDashoffset = offset;
  }
}

// Barras de tasa de cancelacion
function renderCancelacionBarras() {
  const cont = document.getElementById('cancelacion-barras');
  if (!cont) return;

  const datos = [
    { label: 'Hoy',         pct: 20, color: '#c0392b' },
    { label: 'Esta semana', pct: 14, color: '#946a00' },
    { label: 'Este mes',    pct: 9,  color: '#1a7a47' },
  ];

  cont.innerHTML = datos.map(d => `
    <div class="tipo-row">
      <div class="tipo-header">
        <span class="tipo-nombre">${d.label}</span>
        <span class="tipo-pct" style="color:${d.color}">${d.pct}%</span>
      </div>
      <div class="tipo-bar-bg">
        <div class="tipo-bar-fill" style="width:0%;background:${d.color}" data-w="${d.pct}%"></div>
      </div>
    </div>`).join('');

  setTimeout(() => {
    cont.querySelectorAll('.tipo-bar-fill').forEach(bar => {
      bar.style.width = bar.dataset.w;
    });
  }, 300);

  // Alerta si la tasa de hoy es alta
  const alertEl = document.getElementById('alert-cancelacion');
  if (alertEl && datos[0].pct >= 15) {
    alertEl.className = 'alert alert-error';
    alertEl.style.marginTop = '10px';
    alertEl.textContent = 'Tasa de cancelacion alta hoy. Revisar motivos.';
  }
}

// ══════════════════════════════════════════════════════════
// ACTIVIDAD RECIENTE — demo (se conecta a Firebase en siguiente sprint)
// ══════════════════════════════════════════════════════════
function initActividadReciente() {
  const cont = document.getElementById('actividad-lista');
  if (!cont) return;

  const items = [
    {
      clase: 'actividad-dot-green',
      icono: checkSVG(),
      texto: '<strong>Carlos Mendoza</strong> — Sesion completada',
      hora:  'Hace 5 min · Terapia lumbar',
    },
    {
      clase: 'actividad-dot-blue',
      icono: calSVG(),
      texto: '<strong>Maria Lopez</strong> — Nueva cita agendada',
      hora:  'Hace 22 min · 14 Mayo, 09:00',
    },
    {
      clase: 'actividad-dot-red',
      icono: xSVG(),
      texto: '<strong>Jorge Perez</strong> — Cita cancelada',
      hora:  'Hace 45 min · Motivo: no reportado',
    },
    {
      clase: 'actividad-dot-yellow',
      icono: userSVG(),
      texto: '<strong>Andrea Castro</strong> — Nuevo paciente registrado',
      hora:  'Hace 1h · Duitama, Boyaca',
    },
    {
      clase: 'actividad-dot-blue',
      icono: refreshSVG(),
      texto: '<strong>Roberto Cardenas</strong> — Cita reprogramada',
      hora:  'Hace 2h · 13 a 15 de Mayo, 15:30',
    },
  ];

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
export { aplicarTema, renderTiposBarras, renderRingDemo, renderCancelacionBarras };
