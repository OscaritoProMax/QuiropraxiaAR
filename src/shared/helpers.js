// ══════════════════════════════════════════════════════════
// src/shared/helpers.js — Utilidades globales del dashboard
// ══════════════════════════════════════════════════════════

/**
 * Muestra una alerta temporal en un elemento del DOM.
 * @param {string} elId  - ID del elemento contenedor
 * @param {string} msg   - Mensaje a mostrar
 * @param {'success'|'error'} tipo
 */
export function mostrarAlerta(elId, msg, tipo) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.className   = tipo === 'success' ? 'alert alert-success' : 'alert alert-error';
  setTimeout(() => { el.textContent = ''; el.className = ''; }, 4000);
}

/**
 * Limpia todas las alertas de formulario de los modales.
 */
export function limpiarAlertas() {
  ['alert-form-pac', 'alert-form-cita', 'alert-form-usr'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.textContent = ''; el.className = ''; }
  });
}

/**
 * Genera las iniciales de un nombre completo (máx. 2 letras).
 * @param {string} nombre
 * @returns {string}
 */
export function iniciales(nombre) {
  const partes = (nombre || 'U').trim().split(' ');
  return (partes[0][0] + (partes[1] ? partes[1][0] : '')).toUpperCase();
}

/**
 * Devuelve el HTML del badge de estado de una cita.
 * @param {string} estado
 * @returns {string}
 */
export function badgeEstado(estado) {
  const mapa = {
    activa:                  '<span class="badge badge-warning">Activa</span>',
    completada:               '<span class="badge badge-success">Completada</span>',
    cancelada:                '<span class="badge badge-danger">Cancelada</span>',
    reprogramada:              '<span class="badge badge-primary">Reprogramada</span>',
    pendiente_confirmacion:    '<span class="badge badge-info">Pendiente confirmación</span>',
    pendiente_reprogramar:     '<span class="badge" style="background:#ede9fe;color:#6d28d9">Pendiente reprogramar</span>',
  };
  return mapa[estado] ?? estado;
}

/**
 * Abre un modal añadiendo la clase 'open'.
 * @param {string} id - ID del modal-overlay
 */
export function abrirModal(id) {
  document.getElementById(id)?.classList.add('open');
}

/**
 * Cierra un modal quitando la clase 'open' y limpia alertas de formulario.
 * @param {string} id - ID del modal-overlay
 */
export function cerrarModal(id) {
  document.getElementById(id)?.classList.remove('open');
  limpiarAlertas();
}

/**
 * Crea un botón con clase y handler dados.
 * @param {string}   texto
 * @param {Function} handler
 * @param {string}   [className='btn btn-primary']
 * @returns {HTMLButtonElement}
 */
export function crearBtn(texto, handler, className = 'btn btn-primary') {
  const btn = document.createElement('button');
  btn.className   = className;
  btn.textContent = texto;
  btn.addEventListener('click', handler);
  return btn;
}

/**
 * Fecha en formato YYYY-MM-DD ajustada a la zona horaria de Colombia (UTC-5).
 * new Date().toISOString() usa UTC — a las 7 PM Colombia ya es medianoche UTC
 * y el día avanzaría incorrectamente. toLocaleDateString con 'en-CA' da YYYY-MM-DD.
 * @param {number} offsetMs — milisegundos adicionales (0 = hoy, 86400000 = mañana)
 */
function fechaColombia(offsetMs = 0) {
  return new Date(Date.now() + offsetMs)
    .toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

/** Fecha de hoy en formato YYYY-MM-DD (hora Colombia) */
export const HOY    = fechaColombia();

/** Fecha de mañana en formato YYYY-MM-DD (hora Colombia) */
export const MANANA = fechaColombia(86_400_000);

// ══════════════════════════════════════════════════════════
// SELECTS GEOGRÁFICOS — Departamento → Ciudad + País
// ══════════════════════════════════════════════════════════

/**
 * Construye un par de selects encadenados: departamento → ciudad.
 * Al cambiar el departamento, el select de ciudad se actualiza.
 *
 * @param {string}  dptoId   — ID del select de departamento
 * @param {string}  ciudadId — ID del select de ciudad
 * @param {object}  DEPARTAMENTOS — objeto { depto: [ciudades] }
 * @param {object}  opts
 * @param {boolean} opts.conTodas   — añadir opción "Todas" al inicio (para filtros)
 * @param {string}  opts.valorInicial — "Boyacá > Tunja" para preselección
 */
export function bindSelectGeo(dptoId, ciudadId, DEPARTAMENTOS, opts = {}) {
  const selDpto   = document.getElementById(dptoId);
  const selCiudad = document.getElementById(ciudadId);
  if (!selDpto || !selCiudad) return;

  const placeholder = opts.conTodas ? '— Todos los departamentos —' : 'Seleccionar departamento...';
  const placeholderCiudad = opts.conTodas ? '— Todas las ciudades —' : 'Seleccionar ciudad...';

  // Poblar departamentos
  selDpto.innerHTML =
    `<option value="">${placeholder}</option>` +
    Object.keys(DEPARTAMENTOS)
      .sort((a, b) => a.localeCompare(b, 'es'))
      .map(d => `<option value="${d}">${d}</option>`)
      .join('');

  // Función para poblar ciudades según departamento seleccionado
  function poblarCiudades(depto) {
    const ciudades = depto ? (DEPARTAMENTOS[depto] || []) : [];
    selCiudad.innerHTML = ciudades.length
      ? `<option value="">${placeholderCiudad}</option>` +
        ciudades.map(c => `<option value="${c}">${c}</option>`).join('')
      : `<option value="">${placeholderCiudad}</option>`;
    selCiudad.disabled = ciudades.length === 0;
  }

  poblarCiudades('');

  selDpto.addEventListener('change', () => poblarCiudades(selDpto.value));

  // Pre-selección si viene valor "Depto > Ciudad"
  if (opts.valorInicial) {
    const sep = opts.valorInicial.indexOf(' > ');
    if (sep !== -1) {
      const depto  = opts.valorInicial.slice(0, sep);
      const ciudad = opts.valorInicial.slice(sep + 3);
      selDpto.value = depto;
      poblarCiudades(depto);
      selCiudad.value = ciudad;
    }
  }

  return { selDpto, selCiudad };
}

/**
 * Construye el select de país extranjero.
 * @param {string} paisId     — ID del select de país
 * @param {string[]} PAISES   — array de países
 * @param {boolean} conTodos  — añadir "Todos los países" (para filtros)
 */
export function bindSelectPais(paisId, PAISES, conTodos = false) {
  const sel = document.getElementById(paisId);
  if (!sel) return;
  const placeholder = conTodos ? '— Todos los países —' : 'Seleccionar país...';
  sel.innerHTML =
    `<option value="">${placeholder}</option>` +
    PAISES.map(p => `<option value="${p}">${p}</option>`).join('');
}

// ── Modal de motivo de cancelación ───────────────────────
export function pedirMotivoCancelacion() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:10000',
      'background:rgba(0,0,0,.48)',
      'display:flex', 'align-items:center', 'justify-content:center',
    ].join(';');

    overlay.innerHTML = `
      <div style="background:var(--th-card,#fff);border-radius:14px;padding:28px 24px;
                  max-width:380px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.2)">
        <h3 style="margin:0 0 6px;font-size:16px;color:var(--th-text,#111)">
          Motivo de cancelación</h3>
        <p style="margin:0 0 18px;font-size:13px;color:var(--th-text2,#888)">
          Selecciona el motivo antes de confirmar</p>
        <div style="display:flex;flex-direction:column;gap:10px" id="_cm-opts">
          <button data-motivo="No asistió"
            class="btn btn-gray" style="text-align:left;padding:10px 14px">
            No asistió</button>
          <button data-motivo="Canceló"
            class="btn btn-gray" style="text-align:left;padding:10px 14px">
            Canceló</button>
          <button data-motivo="Otro"
            class="btn btn-gray" style="text-align:left;padding:10px 14px">
            Otro</button>
        </div>
        <button id="_cm-abort" class="btn btn-soft"
          style="margin-top:16px;width:100%">Volver</button>
      </div>`;

    document.body.appendChild(overlay);

    overlay.querySelector('#_cm-opts').addEventListener('click', e => {
      const motivo = e.target.closest('[data-motivo]')?.dataset.motivo;
      if (!motivo) return;
      overlay.remove();
      resolve(motivo);
    });
    overlay.querySelector('#_cm-abort').addEventListener('click', () => {
      overlay.remove();
      resolve(null);
    });
  });
}
