// ══════════════════════════════════════════════════════════
// src/shared/interactions.js — Toasts, confirmaciones animadas
// y micro-interacciones (ripple, KPIs, modales móviles).
//
// Autónomo: inyecta sus propios estilos, no depende de CSS externo.
// toast()/confirmar() quedan disponibles en cualquier página que los
// importe; initMicroInteracciones() añade además el pulido visual
// (ripple, tarjetas KPI, modales tipo hoja en móvil) — solo se llama
// desde las páginas del panel admin para no afectar otros roles.
// ══════════════════════════════════════════════════════════

const ICONOS = {
  success: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
  error:   '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  warning: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  info:    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  danger:  '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
};

let coreInjected   = false;
let pulidoInjected = false;

function injectCore() {
  if (coreInjected) return;
  coreInjected = true;
  const style = document.createElement('style');
  style.id = 'qm-core-interactions';
  style.textContent = `
    #qm-toast-wrap {
      position: fixed; top: 16px; right: 16px; z-index: 10050;
      display: flex; flex-direction: column; gap: 10px;
      max-width: 360px; width: calc(100% - 32px);
      pointer-events: none;
    }
    .qm-toast {
      pointer-events: auto;
      display: flex; align-items: flex-start; gap: 10px;
      background: var(--th-card, #fff); color: var(--th-text, #161c2d);
      border: 1px solid var(--th-card-border, #ebebeb);
      border-left: 4px solid var(--primary, #0A76D8);
      border-radius: 10px; padding: 12px 14px 14px;
      box-shadow: 0 10px 28px rgba(15,23,42,.16);
      font-family: 'Inter', sans-serif; font-size: 13px; line-height: 1.45;
      animation: qm-toast-in .35s cubic-bezier(.22,.68,0,1.15);
      position: relative; overflow: hidden;
    }
    .qm-toast.qm-toast-out { animation: qm-toast-out .22s ease forwards; }
    .qm-toast-success { border-left-color: var(--success, #1a7a47); color: inherit; }
    .qm-toast-error   { border-left-color: var(--danger, #c0392b); }
    .qm-toast-warning { border-left-color: var(--warning, #946a00); }
    .qm-toast-info    { border-left-color: var(--primary, #0A76D8); }
    .qm-toast-success .qm-toast-icon { color: var(--success, #1a7a47); }
    .qm-toast-error   .qm-toast-icon { color: var(--danger, #c0392b); }
    .qm-toast-warning .qm-toast-icon { color: var(--warning, #946a00); }
    .qm-toast-info    .qm-toast-icon { color: var(--primary, #0A76D8); }
    .qm-toast-icon  { flex-shrink: 0; margin-top: 1px; }
    .qm-toast-body  { flex: 1; min-width: 0; }
    .qm-toast-msg   { font-weight: 500; word-break: break-word; }
    .qm-toast-close {
      background: none; border: none; cursor: pointer; flex-shrink: 0;
      color: var(--th-text2, #8492a6); font-size: 17px; line-height: 1;
      padding: 0 0 0 8px; transition: color .15s;
    }
    .qm-toast-close:hover { color: var(--th-text, #161c2d); }
    .qm-toast-clickable { cursor: pointer; }
    .qm-toast-clickable:hover { box-shadow: 0 12px 32px rgba(15,23,42,.22); }
    .qm-toast-bar {
      position: absolute; left: 0; bottom: 0; height: 3px;
      background: currentColor; opacity: .3;
      animation-name: qm-toast-bar; animation-timing-function: linear; animation-fill-mode: forwards;
    }

    @keyframes qm-toast-in  { from { opacity: 0; transform: translateX(28px) scale(.96); } to { opacity: 1; transform: translateX(0) scale(1); } }
    @keyframes qm-toast-out { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(28px) scale(.96); } }
    @keyframes qm-toast-bar { from { width: 100%; } to { width: 0%; } }

    @media (max-width: 640px) {
      #qm-toast-wrap { top: auto; bottom: 76px; right: 10px; left: 10px; max-width: none; width: auto; }
      @keyframes qm-toast-in  { from { opacity: 0; transform: translateY(18px) scale(.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
      @keyframes qm-toast-out { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(18px) scale(.97); } }
    }

    .qm-confirm-overlay {
      position: fixed; inset: 0; z-index: 10060; background: rgba(15,23,42,.55);
      display: flex; align-items: center; justify-content: center; padding: 20px;
      animation: qm-fade-in .18s ease;
    }
    .qm-confirm-overlay.qm-closing { animation: qm-fade-out .18s ease forwards; }
    .qm-confirm-box {
      background: var(--th-card, #fff); color: var(--th-text, #161c2d);
      border-radius: 16px; padding: 28px 24px 22px; width: 380px; max-width: 100%;
      box-shadow: 0 24px 64px rgba(0,0,0,.28);
      font-family: 'Inter', sans-serif; text-align: center;
      animation: qm-pop-in .3s cubic-bezier(.22,.68,0,1.2);
    }
    .qm-confirm-overlay.qm-closing .qm-confirm-box { animation: qm-pop-out .18s ease forwards; }
    .qm-confirm-icon {
      width: 52px; height: 52px; border-radius: 50%; display: flex;
      align-items: center; justify-content: center; margin: 0 auto 16px;
      animation: qm-icon-pop .4s .08s cubic-bezier(.22,.68,0,1.4) backwards;
    }
    .qm-confirm-icon.qm-danger  { background: var(--danger-soft, #fdecea);  color: var(--danger, #c0392b); }
    .qm-confirm-icon.qm-warning { background: var(--warning-soft, #fff8e1); color: var(--warning, #946a00); }
    .qm-confirm-icon.qm-info    { background: var(--primary-soft, #D8EBFA); color: var(--primary-text, #1b62b3); }
    .qm-confirm-icon.qm-success { background: var(--success-soft, #e8f8f0); color: var(--success, #1a7a47); }
    .qm-confirm-title { font-size: 16px; font-weight: 600; margin-bottom: 6px; }
    .qm-confirm-msg   { font-size: 13px; color: var(--th-text2, #8492a6); line-height: 1.55; margin-bottom: 22px; white-space: pre-line; }
    .qm-confirm-actions { display: flex; gap: 10px; }
    .qm-confirm-actions .btn { flex: 1; justify-content: center; }

    .qm-aviso-overlay {
      position: fixed; inset: 0; z-index: 10065; background: rgba(15,23,42,.4);
      display: flex; align-items: center; justify-content: center; padding: 20px;
      animation: qm-fade-in .18s ease;
    }
    .qm-aviso-overlay.qm-closing { animation: qm-fade-out .2s ease forwards; }
    .qm-aviso-box {
      background: var(--th-card, #fff); color: var(--th-text, #161c2d);
      border-radius: 16px; padding: 24px 26px; width: 360px; max-width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,.28); text-align: center;
      font-family: 'Inter', sans-serif;
      animation: qm-pop-in .3s cubic-bezier(.22,.68,0,1.2);
    }
    .qm-aviso-overlay.qm-closing .qm-aviso-box { animation: qm-pop-out .18s ease forwards; }
    .qm-aviso-icon {
      width: 52px; height: 52px; border-radius: 50%; display: flex;
      align-items: center; justify-content: center; margin: 0 auto 14px;
      animation: qm-icon-pop .4s .08s cubic-bezier(.22,.68,0,1.4) backwards;
    }
    .qm-aviso-icon.qm-danger  { background: var(--danger-soft, #fdecea);  color: var(--danger, #c0392b); }
    .qm-aviso-icon.qm-error   { background: var(--danger-soft, #fdecea);  color: var(--danger, #c0392b); }
    .qm-aviso-icon.qm-warning { background: var(--warning-soft, #fff8e1); color: var(--warning, #946a00); }
    .qm-aviso-icon.qm-info    { background: var(--primary-soft, #D8EBFA); color: var(--primary-text, #1b62b3); }
    .qm-aviso-icon.qm-success { background: var(--success-soft, #e8f8f0); color: var(--success, #1a7a47); }
    .qm-aviso-msg    { font-size: 14px; color: var(--th-text, #161c2d); line-height: 1.5; }
    .qm-aviso-sub    { font-size: 13px; color: var(--th-text2, #8492a6); margin-top: 8px; line-height: 1.5; }
    .qm-aviso-accion { margin-top: 18px; }
    .qm-aviso-accion .btn { width: 100%; justify-content: center; }

    @keyframes qm-fade-in  { from { opacity: 0; } to { opacity: 1; } }
    @keyframes qm-fade-out { from { opacity: 1; } to { opacity: 0; } }
    @keyframes qm-pop-in   { from { opacity: 0; transform: scale(.9) translateY(8px); } to { opacity: 1; transform: scale(1) translateY(0); } }
    @keyframes qm-pop-out  { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(.94); } }
    @keyframes qm-icon-pop { from { opacity: 0; transform: scale(.4); } to { opacity: 1; transform: scale(1); } }
  `;
  document.head.appendChild(style);
}

function injectPulido() {
  if (pulidoInjected) return;
  pulidoInjected = true;
  const style = document.createElement('style');
  style.id = 'qm-pulido-interactions';
  style.textContent = `
    .qm-ripple-host { position: relative; overflow: hidden; }
    .qm-ripple {
      position: absolute; border-radius: 50%; pointer-events: none;
      background: currentColor; opacity: .25; transform: scale(0);
      animation: qm-ripple-anim .55s ease-out forwards;
    }
    @keyframes qm-ripple-anim { to { transform: scale(1); opacity: 0; } }

    #view-dashboard .kpi-grid .kpi-card,
    #view-finanzas .kpi-grid .kpi-card {
      animation: qm-kpi-in .45s cubic-bezier(.22,.68,0,1.1) backwards;
    }
    #view-dashboard .kpi-grid .kpi-card:nth-child(1), #view-finanzas .kpi-grid .kpi-card:nth-child(1) { animation-delay: .02s; }
    #view-dashboard .kpi-grid .kpi-card:nth-child(2), #view-finanzas .kpi-grid .kpi-card:nth-child(2) { animation-delay: .06s; }
    #view-dashboard .kpi-grid .kpi-card:nth-child(3), #view-finanzas .kpi-grid .kpi-card:nth-child(3) { animation-delay: .10s; }
    #view-dashboard .kpi-grid .kpi-card:nth-child(4), #view-finanzas .kpi-grid .kpi-card:nth-child(4) { animation-delay: .14s; }
    #view-dashboard .kpi-grid .kpi-card:nth-child(5), #view-finanzas .kpi-grid .kpi-card:nth-child(5) { animation-delay: .18s; }
    #view-dashboard .kpi-grid .kpi-card:nth-child(6), #view-finanzas .kpi-grid .kpi-card:nth-child(6) { animation-delay: .22s; }
    @keyframes qm-kpi-in { from { opacity: 0; transform: translateY(10px) scale(.97); } to { opacity: 1; transform: translateY(0) scale(1); } }

    @media (max-width: 640px) {
      .modal-overlay { align-items: flex-end; }
      .modal-box {
        width: 100%; max-width: 100%; margin: 0;
        border-radius: 18px 18px 0 0;
        max-height: 88vh;
        animation: qm-sheet-in .32s cubic-bezier(.22,.68,0,1.05);
      }
      .modal-actions { flex-direction: column-reverse; }
      .modal-actions .btn { width: 100%; min-height: 44px; }
      @keyframes qm-sheet-in { from { transform: translateY(100%); opacity: .5; } to { transform: translateY(0); opacity: 1; } }
    }

    .qm-badge-editado { animation: qm-badge-pop .35s cubic-bezier(.22,.68,0,1.4); }
    @keyframes qm-badge-pop { from { opacity: 0; transform: scale(.5); } to { opacity: 1; transform: scale(1); } }

    #rp-aviso-editado { animation: qm-fade-in-small .3s ease; }
    @keyframes qm-fade-in-small { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
  `;
  document.head.appendChild(style);
}

function getToastWrap() {
  let wrap = document.getElementById('qm-toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'qm-toast-wrap';
    wrap.setAttribute('aria-live', 'polite');
    document.body.appendChild(wrap);
  }
  return wrap;
}

/**
 * Notificación flotante autodescartable. Sustituye a los avisos que
 * dependen de que el usuario esté mirando un div fijo en la página
 * (útil sobre todo en móvil, donde ese div puede quedar fuera de vista).
 * @param {string} mensaje
 * @param {'success'|'error'|'warning'|'info'} tipo
 * @param {{duracion?: number, onClick?: Function}} opts
 *   onClick — si se pasa, el toast completo queda clicable (ej. para abrir
 *   el evento al que hace referencia una notificación) y se cierra al hacer clic.
 */
export function toast(mensaje, tipo = 'info', opts = {}) {
  injectCore();
  const duracion = opts.duracion ?? 4000;
  const wrap = getToastWrap();

  const el = document.createElement('div');
  el.className = `qm-toast qm-toast-${tipo}${opts.onClick ? ' qm-toast-clickable' : ''}`;
  el.innerHTML = `
    <span class="qm-toast-icon">${ICONOS[tipo] || ICONOS.info}</span>
    <div class="qm-toast-body"><div class="qm-toast-msg"></div></div>
    <button class="qm-toast-close" aria-label="Cerrar" type="button">×</button>
    <span class="qm-toast-bar" style="animation-duration:${duracion}ms"></span>
  `;
  el.querySelector('.qm-toast-msg').textContent = mensaje;

  let cerrado = false;
  const cerrar = () => {
    if (cerrado) return;
    cerrado = true;
    el.classList.add('qm-toast-out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };

  el.querySelector('.qm-toast-close').addEventListener('click', (e) => {
    e.stopPropagation();
    cerrar();
  });

  if (opts.onClick) {
    el.addEventListener('click', () => {
      opts.onClick();
      cerrar();
    });
  }

  wrap.appendChild(el);

  const timer = setTimeout(cerrar, duracion);
  el.addEventListener('mouseenter', () => clearTimeout(timer));

  return el;
}

/**
 * Modal de confirmación animado — reemplazo de window.confirm().
 * @param {{titulo?: string, mensaje?: string, tipo?: 'danger'|'warning'|'info'|'success', textoConfirmar?: string, textoCancelar?: string}} opciones
 * @returns {Promise<boolean>}
 */
export function confirmar(opciones = {}) {
  injectCore();
  const {
    titulo = '¿Estás seguro?',
    mensaje = '',
    tipo = 'warning',
    textoConfirmar = 'Confirmar',
    textoCancelar = 'Cancelar',
  } = opciones;

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'qm-confirm-overlay';
    overlay.innerHTML = `
      <div class="qm-confirm-box" role="alertdialog" aria-modal="true">
        <div class="qm-confirm-icon qm-${tipo}">${ICONOS[tipo] || ICONOS.warning}</div>
        <div class="qm-confirm-title"></div>
        <div class="qm-confirm-msg"></div>
        <div class="qm-confirm-actions">
          <button class="btn btn-gray" data-role="cancel" type="button"></button>
          <button class="btn ${tipo === 'danger' ? 'btn-danger' : 'btn-primary'}" data-role="ok" type="button"></button>
        </div>
      </div>`;
    overlay.querySelector('.qm-confirm-title').textContent = titulo;
    overlay.querySelector('.qm-confirm-msg').textContent = mensaje;
    overlay.querySelector('[data-role="cancel"]').textContent = textoCancelar;
    overlay.querySelector('[data-role="ok"]').textContent = textoConfirmar;

    let resuelto = false;
    const cerrar = (valor) => {
      if (resuelto) return;
      resuelto = true;
      document.removeEventListener('keydown', onKey);
      overlay.classList.add('qm-closing');
      overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
      resolve(valor);
    };
    // Enter no se intercepta a propósito: el botón enfocado (Cancelar por
    // defecto en acciones destructivas) ya reacciona a Enter de forma nativa.
    const onKey = (e) => { if (e.key === 'Escape') cerrar(false); };

    overlay.querySelector('[data-role="cancel"]').addEventListener('click', () => cerrar(false));
    overlay.querySelector('[data-role="ok"]').addEventListener('click', () => cerrar(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(false); });
    document.addEventListener('keydown', onKey);

    document.body.appendChild(overlay);
    // En acciones destructivas el foco por defecto va en "Cancelar" para
    // evitar que un Enter accidental confirme algo irreversible.
    overlay.querySelector(tipo === 'danger' ? '[data-role="cancel"]' : '[data-role="ok"]').focus();
  });
}

/**
 * Aviso centrado en el viewport — a diferencia de toast() (que vive en
 * una esquina), este aparece sobre el centro de la pantalla y por
 * encima de cualquier modal abierto. Pensado para mensajes que ocurren
 * dentro de formularios largos con scroll (ej. agendar cita), donde un
 * div fijo en la parte de arriba puede quedar fuera de vista — y para
 * casos que necesitan una acción inmediata (ej. "usar este horario").
 * @param {{mensaje:string, sub?:string, tipo?:'success'|'warning'|'info'|'error', accionTexto?:string, onAccion?:Function, duracion?:number}} opciones
 * @returns {{cerrar: Function}}
 */
export function avisoCentral(opciones = {}) {
  injectCore();
  const {
    mensaje, sub = '', tipo = 'info',
    accionTexto = null, onAccion = null, duracion = 2600,
  } = opciones;

  const overlay = document.createElement('div');
  overlay.className = 'qm-aviso-overlay';
  overlay.innerHTML = `
    <div class="qm-aviso-box" role="status">
      <div class="qm-aviso-icon qm-${tipo}">${ICONOS[tipo] || ICONOS.info}</div>
      <div class="qm-aviso-msg"></div>
      ${sub ? '<div class="qm-aviso-sub"></div>' : ''}
      ${accionTexto ? '<div class="qm-aviso-accion"><button class="btn btn-primary" type="button" data-role="accion"></button></div>' : ''}
    </div>`;
  overlay.querySelector('.qm-aviso-msg').textContent = mensaje;
  if (sub) overlay.querySelector('.qm-aviso-sub').textContent = sub;
  if (accionTexto) overlay.querySelector('[data-role="accion"]').textContent = accionTexto;

  let cerrado = false;
  const cerrar = () => {
    if (cerrado) return;
    cerrado = true;
    document.removeEventListener('keydown', onKey);
    overlay.classList.add('qm-closing');
    overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
  };
  const onKey = (e) => { if (e.key === 'Escape') cerrar(); };

  overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(); });
  document.addEventListener('keydown', onKey);

  if (accionTexto) {
    overlay.querySelector('[data-role="accion"]').addEventListener('click', () => {
      onAccion?.();
      cerrar();
    });
  } else {
    setTimeout(cerrar, duracion);
  }

  document.body.appendChild(overlay);
  return { cerrar };
}

function bindRipple() {
  document.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const host = e.target.closest('.btn, .menu-btn, .kpi-clickable, .theme-card');
    if (!host || host.disabled || host.classList.contains('menu-active')) return;

    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.classList.add('qm-ripple-host');

    const rect = host.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 1.6;
    const span = document.createElement('span');
    span.className = 'qm-ripple';
    span.style.width  = `${size}px`;
    span.style.height = `${size}px`;
    span.style.left = `${e.clientX - rect.left - size / 2}px`;
    span.style.top  = `${e.clientY - rect.top  - size / 2}px`;
    host.appendChild(span);
    span.addEventListener('animationend', () => span.remove());
  });
}

let rippleBound = false;

/**
 * Activa el pulido visual del sistema: ripple táctil en botones,
 * entrada animada de las tarjetas KPI y modales tipo hoja en móvil.
 * Se llama una sola vez al iniciar cada página (Admin, Secretaría o
 * Call Center) — mismas animaciones para los 3 roles. Los selectores
 * de vistas/elementos que un rol no tiene (ej. #view-finanzas fuera de
 * Admin) simplemente no aplican, sin efecto alguno.
 */
export function initMicroInteracciones() {
  injectPulido();
  if (!rippleBound) {
    rippleBound = true;
    bindRipple();
  }
}

// ══════════════════════════════════════════════════════════
// AGRUPACIÓN DE ÍTEMS DEL NAVBAR MÓVIL
// Solo afecta la barra inferior (.sidebar transformado en tab bar
// por dashboard.css en @media max-width:768px). En escritorio los
// botones de grupo nunca se muestran y el sidebar se ve intacto.
// No reemplaza ni modifica los botones reales del menú: solo los
// oculta en móvil y abre un selector que ejecuta su .click() real,
// así que el ruteo/lógica de cada vista queda exactamente igual.
// ══════════════════════════════════════════════════════════

let navGruposStyleInjected = false;

function injectNavGruposStyles() {
  if (navGruposStyleInjected) return;
  navGruposStyleInjected = true;
  injectCore(); // asegura que existan qm-fade-in/qm-pop-in, etc.
  const style = document.createElement('style');
  style.id = 'qm-navgrupos';
  style.textContent = `
    .menu-btn-grupo { display: none; }
    @media (max-width: 768px) {
      .menu-btn-grupo { display: flex !important; }
      .menu-btn.menu-btn-agrupado { display: none !important; }
    }

    .qm-grupo-overlay {
      position: fixed; inset: 0; z-index: 10070; background: rgba(15,23,42,.45);
      display: flex; align-items: flex-end; justify-content: center;
      animation: qm-fade-in .18s ease;
    }
    .qm-grupo-overlay.qm-closing { animation: qm-fade-out .18s ease forwards; }
    .qm-grupo-sheet {
      background: var(--th-card, #fff); color: var(--th-text, #161c2d);
      width: 100%; max-width: 480px;
      border-radius: 20px 20px 0 0;
      padding: 10px 10px calc(18px + env(safe-area-inset-bottom, 0px));
      box-shadow: 0 -12px 40px rgba(0,0,0,.22);
      animation: qm-pop-in .28s cubic-bezier(.22,.68,0,1.15);
    }
    .qm-grupo-overlay.qm-closing .qm-grupo-sheet { animation: qm-pop-out .18s ease forwards; }
    .qm-grupo-titulo {
      font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em;
      color: var(--th-text2, #8492a6); padding: 2px 14px 10px;
    }
    .qm-grupo-handle { width: 36px; height: 4px; border-radius: 2px; background: var(--th-card-border, #ebebeb); margin: 6px auto 12px; }
    .qm-grupo-item {
      display: flex; align-items: center; gap: 14px; width: 100%;
      padding: 13px 14px; border: none; background: none; border-radius: 12px;
      font-family: 'Inter', sans-serif; font-size: 14px; color: var(--th-text, #161c2d);
      text-align: left; cursor: pointer;
    }
    .qm-grupo-item:active { background: var(--th-bg3, #f8f9fa); }
    .qm-grupo-item .menu-icon { color: var(--th-text2, #8492a6); flex-shrink: 0; display: flex; }
    .qm-grupo-item.qm-grupo-item-active { color: var(--primary, #0A76D8); }
    .qm-grupo-item.qm-grupo-item-active .menu-icon { color: var(--primary, #0A76D8); }
  `;
  document.head.appendChild(style);
}

function abrirSheetGrupo(grupo, botones) {
  const overlay = document.createElement('div');
  overlay.className = 'qm-grupo-overlay';
  overlay.innerHTML = `
    <div class="qm-grupo-sheet" role="menu" aria-label="${grupo.label}">
      <div class="qm-grupo-handle"></div>
      <div class="qm-grupo-titulo">${grupo.label}</div>
      ${botones.map((b, i) => `
        <button type="button" class="qm-grupo-item${b.classList.contains('menu-active') ? ' qm-grupo-item-active' : ''}" data-idx="${i}">
          <span class="menu-icon">${b.querySelector('.menu-icon')?.innerHTML || ''}</span>
          <span>${b.querySelector('.menu-label')?.textContent ?? ''}</span>
        </button>`).join('')}
    </div>`;

  let cerrado = false;
  const cerrar = () => {
    if (cerrado) return;
    cerrado = true;
    document.removeEventListener('keydown', onKey);
    overlay.classList.add('qm-closing');
    overlay.addEventListener('animationend', () => overlay.remove(), { once: true });
  };
  const onKey = (e) => { if (e.key === 'Escape') cerrar(); };

  overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar(); });
  document.addEventListener('keydown', onKey);
  overlay.querySelectorAll('.qm-grupo-item').forEach(item => {
    item.addEventListener('click', () => {
      const idx = Number(item.dataset.idx);
      cerrar();
      botones[idx].click();
    });
  });

  document.body.appendChild(overlay);
}

/**
 * Agrupa ítems del navbar móvil bajo un solo botón que, al tocarlo, abre
 * un selector con los ítems reales agrupados. Solo tiene efecto visual en
 * móvil (ver dashboard.css); en escritorio el sidebar no se toca.
 * @param {{id:string, label:string, selectores:string[]}[]} grupos
 */
export function initNavGrupos(grupos = []) {
  const contenedor = document.querySelector('.menu-container');
  if (!contenedor) return;
  injectNavGruposStyles();

  grupos.forEach(grupo => {
    const botones = grupo.selectores
      .map(sel => contenedor.querySelector(sel))
      .filter(Boolean);
    if (botones.length < 2) return; // nada que agrupar / markup no coincide

    const primero = botones[0];
    const grupoBtn = document.createElement('button');
    grupoBtn.type = 'button';
    grupoBtn.className = 'menu-btn menu-btn-grupo';
    grupoBtn.dataset.grupo = grupo.id;
    grupoBtn.innerHTML = `
      <span class="menu-icon">${primero.querySelector('.menu-icon')?.innerHTML || ''}</span>
      <span class="menu-label">${grupo.label}</span>
    `;
    primero.insertAdjacentElement('beforebegin', grupoBtn);

    botones.forEach(b => b.classList.add('menu-btn-agrupado'));

    grupoBtn.addEventListener('click', () => abrirSheetGrupo(grupo, botones));

    const sync = () => {
      const activo = botones.some(b => b.classList.contains('menu-active'));
      grupoBtn.classList.toggle('menu-active', activo);
    };
    sync();
    const obs = new MutationObserver(sync);
    botones.forEach(b => obs.observe(b, { attributes: true, attributeFilter: ['class'] }));
  });
}
