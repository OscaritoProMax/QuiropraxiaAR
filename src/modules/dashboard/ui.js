// src/modules/dashboard/ui.js — Renderizado de vistas, slots, pacientes y estadísticas
// ══════════════════════════════════════════════════════════

import { iniciales, badgeEstado, HOY } from '../../shared/helpers.js';
import { obtenerCitasPorFecha, ESTADOS, HORARIOS } from '../citas/citasService.js';
import { obtenerPacientes, obtenerPacientesPorCiudad } from '../pacientes/pacientesService.js';
import { obtenerDepartamentos, obtenerCiudades, restaurarUbicacion } from '../pacientes/colombiaService.js';

// ── Helper: escribe en un elemento solo si existe ─────────
function setEl(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// ══════════════════════════════════════════════════════════
// PERFIL SIDEBAR
// ══════════════════════════════════════════════════════════
export function renderPerfil(usuario) {
  const partes = (usuario.nombre || 'U').trim().split(' ');
  const avatar = (partes[0][0] + (partes[1] ? partes[1][0] : '')).toUpperCase();
  setEl('sidebar-avatar', avatar);
  setEl('sidebar-nombre', usuario.nombre || usuario.email);
  setEl('sidebar-rol',    usuario.rol    || '—');
}

// ══════════════════════════════════════════════════════════
// ESTADÍSTICAS DEL DASHBOARD
// ══════════════════════════════════════════════════════════
export async function renderEstadisticas() {
  setEl('dash-fecha',
    new Date().toLocaleDateString('es-CO', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    })
  );

  const [citasHoy, todosPac] = await Promise.all([
    obtenerCitasPorFecha(HOY),
    obtenerPacientes(),
  ]);

  setEl('stat-citas',      citasHoy.length);
  setEl('stat-pacientes',  todosPac.length);
  setEl('stat-pendientes', citasHoy.filter(c => c.estado === ESTADOS.ACTIVA).length);
  setEl('stat-canceladas', citasHoy.filter(c => c.estado === ESTADOS.COMPLETADA).length);

  // KPIs nuevos
  setEl('stat-ingresos-dia', '—');
  setEl('stat-ingresos-mes', '—');
}

// ══════════════════════════════════════════════════════════
// TABLA DE CITAS DE HOY
// ══════════════════════════════════════════════════════════
export async function renderCitasHoy(onCompletar) {
  const citas = await obtenerCitasPorFecha(HOY);
  const tbody = document.getElementById('dash-tbody');
  if (!tbody) return;

  if (!citas.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No hay citas para hoy</td></tr>';
    return;
  }

  tbody.innerHTML = citas.map(c => `
    <tr>
      <td>${c.hora}</td>
      <td>${c.clienteNombre}</td>
      <td>${c.clienteCiudad || '—'}</td>
      <td>${c.tipo}</td>
      <td>${badgeEstado(c.estado)}</td>
      <td>${c.estado === ESTADOS.ACTIVA
        ? `<button class="btn btn-soft btn-sm" data-completar="${c.id}">Completar</button>`
        : '—'
      }</td>
    </tr>`).join('');

  tbody.querySelectorAll('[data-completar]').forEach(btn =>
    btn.addEventListener('click', () => onCompletar(btn.dataset.completar))
  );
}

// ══════════════════════════════════════════════════════════
// SLOTS DE CITAS
// ══════════════════════════════════════════════════════════
export async function renderSlots(fecha, { onAgendar, onCompletar, onReprogramar, onCancelar }) {
  const cont = document.getElementById('slots-container');
  if (!cont) return;
  cont.innerHTML = '<div class="empty-state">Cargando agenda...</div>';

  if (!HORARIOS.length) {
    cont.innerHTML = '<div class="empty-state">Sin horarios configurados</div>';
    return;
  }

  const citas   = await obtenerCitasPorFecha(fecha);
  const porHora = Object.fromEntries(citas.map(c => [c.hora, c]));

  cont.innerHTML = HORARIOS.map(hora => {
    const cita = porHora[hora];
    if (cita) {
      return `
        <div class="slot-row">
          <div class="slot-time">${hora}</div>
          <div class="slot-info">
            <div class="slot-name">${cita.clienteNombre}</div>
            <div class="slot-meta">${cita.tipo} · ${cita.clienteCiudad || 'Ciudad no registrada'}</div>
          </div>
          ${badgeEstado(cita.estado)}
          <div style="display:flex;gap:6px;margin-left:8px">
            ${cita.estado !== ESTADOS.CANCELADA ? `
              <button class="btn btn-soft btn-sm"   data-reprog="${cita.id}">Reprogramar</button>
              <button class="btn btn-danger btn-sm" data-cancelar="${cita.id}">Cancelar</button>
            ` : ''}
            ${cita.estado === ESTADOS.ACTIVA ? `
              <button class="btn btn-gray btn-sm" data-completar="${cita.id}">Completar</button>
            ` : ''}
          </div>
        </div>`;
    }
    return `
      <div class="slot-row slot-disponible">
        <div class="slot-time">${hora}</div>
        <div class="slot-empty">Disponible</div>
        <button class="btn btn-soft btn-sm" data-agendar-hora="${hora}">+ Agendar</button>
      </div>`;
  }).join('');

  cont.querySelectorAll('[data-agendar-hora]').forEach(b =>
    b.addEventListener('click', () => onAgendar(b.dataset.agendarHora, fecha)));
  cont.querySelectorAll('[data-completar]').forEach(b =>
    b.addEventListener('click', () => onCompletar(b.dataset.completar, fecha)));
  cont.querySelectorAll('[data-reprog]').forEach(b =>
    b.addEventListener('click', () => onReprogramar(b.dataset.reprog, fecha)));
  cont.querySelectorAll('[data-cancelar]').forEach(b =>
    b.addEventListener('click', () => onCancelar(b.dataset.cancelar, fecha)));
}

// ══════════════════════════════════════════════════════════
// MÓDULO DE PACIENTES — GESTOR CRM COMPLETO
// Contiene: buscador, tarjetas, CRUD inline, sugerencias IA
// ══════════════════════════════════════════════════════════

/**
 * Punto de entrada principal del gestor de pacientes.
 * Llama a esto desde handlers.js al entrar a la vista pacientes.
 */
export async function renderGestorPacientes({ onRegistrar, onActualizar, onEliminar }) {
  const cont = document.getElementById('view-pacientes');
  if (!cont) return;

  // Obtener todos los pacientes para el análisis de ciudades
  const todos = await obtenerPacientes();

  cont.innerHTML = `
    <!-- ── HEADER CRM ── -->
    <div class="crm-header">
      <div class="crm-header-left">
        <div class="crm-stat">
          <span class="crm-stat-num" id="crm-total">${todos.length}</span>
          <span class="crm-stat-label">Pacientes</span>
        </div>
        <div class="crm-stat">
          <span class="crm-stat-num" id="crm-activos">${todos.filter(p => p.activo !== false).length}</span>
          <span class="crm-stat-label">Activos</span>
        </div>
        <div class="crm-stat">
          <span class="crm-stat-num" id="crm-ciudades">${new Set(todos.map(p => p.ciudad?.split(' > ')[1] || p.ciudad).filter(Boolean)).size}</span>
          <span class="crm-stat-label">Ciudades</span>
        </div>
      </div>
      <div class="crm-header-right">
        <button class="btn btn-primary" id="crm-btn-nuevo">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nuevo paciente
        </button>
      </div>
    </div>

    <!-- ── IA: SUGERENCIA DE VIAJE ── -->
    <div class="crm-ia-card" id="crm-ia-card">
      <div class="crm-ia-header">
        <div class="crm-ia-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        </div>
        <div>
          <div class="crm-ia-title">Sugerencia de visita — Gemini</div>
          <div class="crm-ia-sub">Basado en concentracion de pacientes por ciudad</div>
        </div>
        <button class="crm-ia-refresh" id="crm-ia-refresh" title="Generar sugerencia">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </button>
      </div>
      <div class="crm-ia-body" id="crm-ia-body">
        <div class="crm-ia-placeholder">Presiona el boton para que Gemini analice tus pacientes y sugiera la proxima ciudad a visitar</div>
      </div>
      <div class="crm-ia-ciudades" id="crm-ia-ciudades"></div>
    </div>

    <!-- ── BARRA DE BUSQUEDA Y FILTROS ── -->
    <div class="crm-search-bar">
      <div class="crm-search-wrap" id="crm-search-wrap">
        <svg class="crm-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input class="crm-search-input" id="crm-search" type="text"
          placeholder="Buscar por nombre, telefono o documento..."/>
        <div class="crm-autocomplete" id="crm-autocomplete" style="display:none"></div>
      </div>

      <div class="crm-ciudad-wrap" id="crm-ciudad-wrap">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;color:var(--text-muted)">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
        </svg>
        <input class="crm-search-input" id="crm-ciudad-input" type="text"
          placeholder="Filtrar por ciudad..." autocomplete="off"/>
        <div class="crm-autocomplete crm-ciudad-ac" id="crm-ciudad-ac" style="display:none"></div>
        <button class="crm-clear-ciudad" id="crm-clear-ciudad" style="display:none" title="Limpiar filtro">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="crm-view-toggle">
        <button class="crm-view-btn crm-view-active" id="crm-view-cards" title="Vista tarjetas">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
            <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
          </svg>
        </button>
        <button class="crm-view-btn" id="crm-view-tabla" title="Vista tabla">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/>
            <line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        </button>
      </div>

      <span class="crm-count" id="crm-count">${todos.length} pacientes</span>
    </div>

    <!-- ── LISTA / TABLA DE PACIENTES ── -->
    <div id="crm-lista" class="crm-lista-cards"></div>

    <!-- ── PANEL DE EDICION INLINE ── -->
    <div class="crm-editar-panel" id="crm-editar-panel" style="display:none"></div>
  `;

  // Renderizar lista inicial
  _renderListaPacientes(todos, 'cards', { onActualizar, onEliminar });

  // Inicializar interacciones
  _bindCrmBusqueda(todos, { onActualizar, onEliminar });
  _bindCrmFiltrosCiudad(todos, { onActualizar, onEliminar });
  _bindCrmVistas(todos, { onActualizar, onEliminar });
  _bindCrmIA(todos);

  document.getElementById('crm-btn-nuevo')?.addEventListener('click', onRegistrar);
}

// ── Renderizar lista en modo cards o tabla ────────────────
function _renderListaPacientes(lista, modo = 'cards', handlers = {}) {
  const cont = document.getElementById('crm-lista');
  if (!cont) return;

  const { onActualizar, onEliminar } = handlers;
  setEl('crm-count', `${lista.length} paciente${lista.length !== 1 ? 's' : ''}`);

  if (!lista.length) {
    cont.innerHTML = `
      <div class="crm-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".3">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
        <p>No se encontraron pacientes</p>
      </div>`;
    return;
  }

  if (modo === 'tabla') {
    cont.className = 'crm-lista-tabla';
    cont.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Paciente</th>
              <th>Telefono</th>
              <th>Ciudad</th>
              <th>Condicion</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${lista.map(p => {
              const ciudad = _parseCiudad(p.ciudad);
              return `
              <tr>
                <td>
                  <div style="display:flex;align-items:center;gap:10px">
                    <div class="avatar" style="width:32px;height:32px;font-size:11px;flex-shrink:0">${iniciales(p.nombre)}</div>
                    <span style="font-weight:500">${p.nombre}</span>
                  </div>
                </td>
                <td>${p.telefono || '—'}</td>
                <td>${ciudad.display}</td>
                <td><span class="crm-condicion-tag">${p.condicion || '—'}</span></td>
                <td><span class="badge badge-success">Activo</span></td>
                <td>
                  <div class="td-actions">
                    <button class="btn btn-soft btn-sm" data-editar="${p.id}">Editar</button>
                    <button class="btn btn-danger btn-sm" data-eliminar="${p.id}" data-nombre="${p.nombre}">Eliminar</button>
                  </div>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  } else {
    cont.className = 'crm-lista-cards';
    cont.innerHTML = lista.map(p => {
      const ciudad = _parseCiudad(p.ciudad);
      const ini    = iniciales(p.nombre);
      return `
        <div class="crm-card" data-id="${p.id}">
          <div class="crm-card-top">
            <div class="crm-card-avatar">${ini}</div>
            <div class="crm-card-info">
              <div class="crm-card-nombre">${p.nombre}</div>
              <div class="crm-card-meta">
                ${ciudad.ciudad
                  ? `<span class="crm-chip crm-chip-ciudad">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                        <circle cx="12" cy="10" r="3"/>
                      </svg>
                      ${ciudad.display}
                    </span>`
                  : ''}
                ${p.condicion
                  ? `<span class="crm-chip crm-chip-condicion">${p.condicion}</span>`
                  : ''}
              </div>
            </div>
            <span class="badge badge-success crm-badge-estado">Activo</span>
          </div>
          <div class="crm-card-datos">
            <div class="crm-dato">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13 19.79 19.79 0 0 1 1.62 4.4 2 2 0 0 1 3.6 2.2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.08 6.08l.98-.98a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 17z"/>
              </svg>
              ${p.telefono || '—'}
            </div>
            ${p.documento
              ? `<div class="crm-dato">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
                  </svg>
                  ${p.documento}
                </div>`
              : ''}
            ${p.email
              ? `<div class="crm-dato">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
                  </svg>
                  ${p.email}
                </div>`
              : ''}
          </div>
          <div class="crm-card-actions">
            <button class="btn btn-soft btn-sm crm-btn-editar" data-editar="${p.id}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              Editar
            </button>
            <button class="btn btn-danger btn-sm crm-btn-eliminar" data-eliminar="${p.id}" data-nombre="${p.nombre}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              </svg>
              Eliminar
            </button>
          </div>
        </div>`;
    }).join('');
  }

  // Bind acciones
  cont.querySelectorAll('[data-editar]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const pac = lista.find(p => p.id === btn.dataset.editar);
      if (pac) _abrirPanelEditar(pac, onActualizar, lista, modo);
    });
  });

  cont.querySelectorAll('[data-eliminar]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      _confirmarEliminar(btn.dataset.eliminar, btn.dataset.nombre, onEliminar, lista, modo, handlers);
    });
  });
}

// ── Panel de edicion inline ───────────────────────────────
async function _abrirPanelEditar(paciente, onActualizar, listaActual, modo) {
  const panel = document.getElementById('crm-editar-panel');
  if (!panel) return;

  panel.style.display = 'block';
  panel.innerHTML = `
    <div class="crm-edit-inner">
      <div class="crm-edit-title">
        <div class="crm-card-avatar" style="width:36px;height:36px;font-size:13px">${iniciales(paciente.nombre)}</div>
        Editando — ${paciente.nombre}
        <button class="crm-edit-close" id="crm-edit-close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="form-row-2col">
        <div class="form-group">
          <label class="form-label">Nombre completo <span>*</span></label>
          <input class="input-text" id="edit-nombre" value="${paciente.nombre || ''}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Telefono <span style="color:#8492a6;font-weight:400">(no editable)</span></label>
          <input class="input-text" value="${paciente.telefono || ''}" disabled
            style="background:#f0f4f8;color:#8492a6;cursor:not-allowed"/>
        </div>
      </div>
      <div class="form-row-2col">
        <div class="form-group">
          <label class="form-label">Documento</label>
          <input class="input-text" id="edit-documento" value="${paciente.documento || ''}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Correo</label>
          <input class="input-text" id="edit-email" type="email" value="${paciente.email || ''}"/>
        </div>
      </div>
      <div class="form-row-2col">
        <div class="form-group">
          <label class="form-label">Departamento</label>
          <select class="input-text" id="edit-dpto">
            <option value="">Cargando...</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Ciudad / Municipio</label>
          <select class="input-text" id="edit-ciudad" disabled>
            <option value="">Seleccionar departamento primero</option>
          </select>
        </div>
      </div>
      <div class="form-row-2col">
        <div class="form-group">
          <label class="form-label">Fecha de nacimiento</label>
          <input class="input-text" id="edit-nacimiento" type="date" value="${paciente.fechaNacimiento || ''}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Condicion / motivo</label>
          <input class="input-text" id="edit-condicion" value="${paciente.condicion || ''}"
            placeholder="Dolor lumbar cronico..."/>
        </div>
      </div>
      <div id="alert-editar-pac"></div>
      <div class="crm-edit-actions">
        <button class="btn btn-gray" id="crm-edit-cancel">Cancelar</button>
        <button class="btn btn-primary" id="crm-edit-save" data-id="${paciente.id}">Guardar cambios</button>
      </div>
    </div>`;

  // Scroll al panel
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Cargar selects de ubicacion con la API
  await restaurarUbicacion(
    document.getElementById('edit-dpto'),
    document.getElementById('edit-ciudad'),
    paciente.ciudad
  );

  document.getElementById('crm-edit-close')?.addEventListener('click', () => {
    panel.style.display = 'none';
    panel.innerHTML = '';
  });
  document.getElementById('crm-edit-cancel')?.addEventListener('click', () => {
    panel.style.display = 'none';
    panel.innerHTML = '';
  });

  document.getElementById('crm-edit-save')?.addEventListener('click', async () => {
    const btn = document.getElementById('crm-edit-save');
    const editDpto   = document.getElementById('edit-dpto');
    const editCiudad = document.getElementById('edit-ciudad');
    const deptoNombre = editDpto?.selectedOptions[0]?.dataset?.nombre || '';
    const ciudadVal   = editCiudad?.value || '';
    const ciudadFinal = deptoNombre && ciudadVal ? `${deptoNombre} > ${ciudadVal}` : ciudadVal;

    const datos = {
      nombre:          document.getElementById('edit-nombre')?.value.trim(),
      documento:       document.getElementById('edit-documento')?.value.trim(),
      email:           document.getElementById('edit-email')?.value.trim(),
      ciudad:          ciudadFinal,
      fechaNacimiento: document.getElementById('edit-nacimiento')?.value,
      condicion:       document.getElementById('edit-condicion')?.value.trim(),
    };

    if (!datos.nombre) {
      const al = document.getElementById('alert-editar-pac');
      if (al) { al.className = 'alert alert-error'; al.textContent = 'El nombre es obligatorio.'; }
      return;
    }

    btn.textContent = 'Guardando...'; btn.disabled = true;
    const res = await onActualizar(paciente.id, datos);

    if (res?.ok) {
      panel.style.display = 'none';
      panel.innerHTML = '';
      // Recargar lista
      const nuevaLista = await obtenerPacientes();
      _renderListaPacientes(nuevaLista, modo, { onActualizar, onEliminar: null });
    } else {
      const al = document.getElementById('alert-editar-pac');
      if (al) { al.className = 'alert alert-error'; al.textContent = res?.error || 'Error al guardar.'; }
      btn.textContent = 'Guardar cambios'; btn.disabled = false;
    }
  });
}

// ── Confirmar y ejecutar eliminación ─────────────────────
async function _confirmarEliminar(id, nombre, onEliminar, lista, modo, handlers) {
  if (!confirm(`Eliminar permanentemente a "${nombre}"?\n\nEsta accion no se puede deshacer.`)) return;
  const res = await onEliminar(id);
  if (res?.ok) {
    const nuevaLista = await obtenerPacientes();
    _renderListaPacientes(nuevaLista, modo, handlers);
    setEl('crm-total', nuevaLista.length);
  }
}

// ── Busqueda con autocomplete ─────────────────────────────
function _bindCrmBusqueda(todos, handlers) {
  const input = document.getElementById('crm-search');
  const ac    = document.getElementById('crm-autocomplete');
  if (!input || !ac) return;

  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim().toLowerCase();
      if (!q) {
        ac.style.display = 'none';
        _renderListaPacientes(todos, _modoActual(), handlers);
        return;
      }

      const filtrados = todos.filter(p =>
        p.nombre.toLowerCase().includes(q) ||
        (p.telefono  && p.telefono.includes(q)) ||
        (p.documento && p.documento.includes(q))
      );

      // Autocomplete — top 6
      const top6 = filtrados.slice(0, 6);
      if (top6.length) {
        ac.innerHTML = top6.map(p => `
          <div class="crm-ac-item" data-id="${p.id}" data-nombre="${p.nombre}">
            <div class="avatar" style="width:28px;height:28px;font-size:10px;flex-shrink:0">${iniciales(p.nombre)}</div>
            <div>
              <div style="font-size:13px;font-weight:500">${_highlight(p.nombre, q)}</div>
              <div style="font-size:11px;color:#8492a6">${p.telefono || '—'} · ${_parseCiudad(p.ciudad).ciudad || '—'}</div>
            </div>
          </div>`).join('');
        ac.style.display = 'block';

        ac.querySelectorAll('.crm-ac-item').forEach(item => {
          item.addEventListener('click', () => {
            input.value    = item.dataset.nombre;
            ac.style.display = 'none';
            const selec = todos.filter(p => p.id === item.dataset.id);
            _renderListaPacientes(selec, _modoActual(), handlers);
          });
        });
      } else {
        ac.style.display = 'none';
      }

      _renderListaPacientes(filtrados, _modoActual(), handlers);
    }, 250);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#crm-search-wrap')) ac.style.display = 'none';
  });
}

// ── Filtro por ciudad con autocomplete ───────────────────
function _bindCrmFiltrosCiudad(todos, handlers) {
  const input   = document.getElementById('crm-ciudad-input');
  const ac      = document.getElementById('crm-ciudad-ac');
  const clearBtn = document.getElementById('crm-clear-ciudad');
  if (!input || !ac) return;

  // Construir índice de ciudades únicas desde los pacientes
  const ciudadesUnicas = [...new Set(
    todos.map(p => _parseCiudad(p.ciudad).display).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'es'));

  // También pedir ciudades de la API si el usuario escribe algo nuevo
  let timer;
  input.addEventListener('input', async () => {
    clearTimeout(timer);
    const q = input.value.trim().toLowerCase();

    if (!q) {
      ac.style.display   = 'none';
      clearBtn.style.display = 'none';
      _renderListaPacientes(todos, _modoActual(), handlers);
      return;
    }

    clearBtn.style.display = 'flex';

    // Sugerir desde ciudades de los pacientes primero
    const localSugg = ciudadesUnicas.filter(c => c.toLowerCase().includes(q)).slice(0, 8);

    // Además buscar municipios de la API (debounced)
    timer = setTimeout(async () => {
      let apiSugg = [];
      try {
        const deptos = await obtenerDepartamentos();
        // Buscar en departamentos cuyo nombre matchea
        const deptosMatch = deptos.filter(d => d.nombre.toLowerCase().includes(q));
        for (const d of deptosMatch.slice(0, 3)) {
          const ciudades = await obtenerCiudades(d.id);
          ciudades.slice(0, 5).forEach(c => {
            const full = `${d.nombre} > ${c}`;
            if (!apiSugg.some(x => x.label === full)) {
              apiSugg.push({ label: full, ciudad: c, depto: d.nombre });
            }
          });
        }
        // También buscar municipios por nombre
        const allDeptos = deptos.filter(d => !deptosMatch.includes(d)).slice(0, 8);
        for (const d of allDeptos) {
          const ciudades = await obtenerCiudades(d.id);
          const match = ciudades.filter(c => c.toLowerCase().includes(q));
          match.slice(0, 2).forEach(c => {
            const full = `${d.nombre} > ${c}`;
            if (!apiSugg.some(x => x.label === full)) {
              apiSugg.push({ label: full, ciudad: c, depto: d.nombre });
            }
          });
          if (apiSugg.length > 10) break;
        }
      } catch (_) {}

      const todasSugg = [
        ...localSugg.map(c => ({ label: c, source: 'local' })),
        ...apiSugg.filter(a => !localSugg.some(l => l.includes(a.ciudad))).slice(0, 5),
      ].slice(0, 10);

      if (todasSugg.length) {
        ac.innerHTML = todasSugg.map(s => `
          <div class="crm-ac-item" data-ciudad="${s.label}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;color:#0A76D8">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            <div>
              <div style="font-size:13px">${_highlight(s.label, q)}</div>
              ${s.source !== 'local' && s.label ? `<div style="font-size:11px;color:#8492a6">Colombia</div>` : ''}
            </div>
          </div>`).join('');
        ac.style.display = 'block';

        ac.querySelectorAll('.crm-ac-item').forEach(item => {
          item.addEventListener('click', () => {
            const val = item.dataset.ciudad;
            input.value = val;
            ac.style.display = 'none';
            _filtrarPorCiudad(val, todos, _modoActual(), handlers);
          });
        });
      } else {
        ac.style.display = 'none';
        _filtrarPorCiudad(q, todos, _modoActual(), handlers);
      }
    }, 300);
  });

  clearBtn?.addEventListener('click', () => {
    input.value = '';
    clearBtn.style.display = 'none';
    ac.style.display = 'none';
    _renderListaPacientes(todos, _modoActual(), handlers);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#crm-ciudad-wrap')) ac.style.display = 'none';
  });
}

function _filtrarPorCiudad(q, todos, modo, handlers) {
  const ql = q.toLowerCase();
  const filtrados = todos.filter(p => {
    const c = (p.ciudad || '').toLowerCase();
    return c.includes(ql);
  });
  _renderListaPacientes(filtrados, modo, handlers);
}

// ── Toggle vista cards / tabla ────────────────────────────
function _bindCrmVistas(todos, handlers) {
  const btnCards = document.getElementById('crm-view-cards');
  const btnTabla = document.getElementById('crm-view-tabla');

  btnCards?.addEventListener('click', () => {
    btnCards.classList.add('crm-view-active');
    btnTabla?.classList.remove('crm-view-active');
    _renderListaPacientes(todos, 'cards', handlers);
    window.__crmModo = 'cards';
  });

  btnTabla?.addEventListener('click', () => {
    btnTabla.classList.add('crm-view-active');
    btnCards?.classList.remove('crm-view-active');
    _renderListaPacientes(todos, 'tabla', handlers);
    window.__crmModo = 'tabla';
  });
}

function _modoActual() { return window.__crmModo || 'cards'; }

// ── IA: SUGERENCIA DE VIAJE con Gemini ───────────────────
function _bindCrmIA(todos) {
  const btn  = document.getElementById('crm-ia-refresh');
  const body = document.getElementById('crm-ia-body');
  const cont = document.getElementById('crm-ia-ciudades');
  if (!btn || !body) return;

  // Calcular top ciudades
  const conteo = {};
  todos.forEach(p => {
    const c = _parseCiudad(p.ciudad).ciudad;
    if (c) conteo[c] = (conteo[c] || 0) + 1;
  });
  const topCiudades = Object.entries(conteo)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  // Mostrar chips de ciudades con conteo
  if (cont && topCiudades.length) {
    cont.innerHTML = topCiudades.map(([c, n]) => `
      <div class="crm-ia-ciudad-chip">
        <span class="crm-ia-chip-nombre">${c}</span>
        <span class="crm-ia-chip-num">${n}</span>
      </div>`).join('');
  }

  btn.addEventListener('click', async () => {
    if (!topCiudades.length) {
      body.innerHTML = '<div class="crm-ia-placeholder">No hay suficientes pacientes registrados para analizar.</div>';
      return;
    }

    btn.style.opacity = '0.5';
    btn.disabled = true;
    body.innerHTML = '<div class="crm-ia-loading"><div class="crm-ia-spinner"></div> Gemini analizando concentracion de pacientes...</div>';

    const resumen = topCiudades.map(([c, n]) => `- ${c}: ${n} paciente${n !== 1 ? 's' : ''}`).join('\n');

    try {
      const GEMINI_KEY = import.meta.env?.VITE_GEMINI_KEY || '';
      const endpoint   = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash:generateContent?key=${GEMINI_KEY}`;

      const r = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [{
              text: `Eres el asistente de un quiropractico colombiano que viaja a distintas ciudades y pueblos del pais para dar consultas a domicilio.
              
Basado en la siguiente concentracion de pacientes por ciudad, sugiere cual seria la proxima ciudad mas conveniente para visitar. Considera:
1. Numero de pacientes en cada ciudad
2. Posible agrupacion geografica entre ciudades cercanas (para optimizar el viaje)
3. Si hay ciudades con muchos pacientes que no han sido visitadas recientemente

Datos de pacientes:
${resumen}

Responde en este formato exacto (sin markdown, sin asteriscos, sin bullets):
CIUDAD SUGERIDA: [nombre ciudad]
RAZON: [explicacion breve de 1-2 oraciones en espanol colombiano informal]
CONSEJO: [tip practico de logistica para la visita]`
            }]
          }],
          generationConfig: { maxOutputTokens: 300, temperature: 0.7 }
        })
      });

      if (!r.ok) throw new Error(`Error ${r.status}`);
      const data = await r.json();
      const texto = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // Parsear respuesta
      const ciudadMatch  = texto.match(/CIUDAD SUGERIDA:\s*(.+)/i);
      const razonMatch   = texto.match(/RAZON:\s*(.+)/i);
      const consejoMatch = texto.match(/CONSEJO:\s*(.+)/i);

      const ciudad  = ciudadMatch?.[1]?.trim()  || 'Sin datos';
      const razon   = razonMatch?.[1]?.trim()   || '';
      const consejo = consejoMatch?.[1]?.trim() || '';

      body.innerHTML = `
        <div class="crm-ia-resultado">
          <div class="crm-ia-ciudad-sugerida">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            ${ciudad}
          </div>
          ${razon   ? `<div class="crm-ia-razon">${razon}</div>` : ''}
          ${consejo ? `<div class="crm-ia-consejo">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            ${consejo}
          </div>` : ''}
        </div>`;
    } catch (err) {
      body.innerHTML = `<div class="crm-ia-error">No se pudo conectar con Gemini: ${err.message}</div>`;
    }

    btn.style.opacity = '1';
    btn.disabled = false;
  });
}

// ── Helpers internos ──────────────────────────────────────
function _parseCiudad(valor) {
  if (!valor) return { depto: '', ciudad: '', display: '' };
  if (valor.includes(' > ')) {
    const [depto, ciudad] = valor.split(' > ');
    return { depto, ciudad, display: `${depto} > ${ciudad}` };
  }
  return { depto: '', ciudad: valor, display: valor };
}

function _highlight(texto, q) {
  if (!q) return texto;
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return texto.replace(re, '<strong style="color:#0A76D8">$1</strong>');
}

// ══════════════════════════════════════════════════════════
// ESTAS FUNCIONES SE MANTIENEN PARA COMPATIBILIDAD
// con el código existente en handlers.js
// ══════════════════════════════════════════════════════════

export function renderPacientes(lista, handlers = {}) {
  _renderListaPacientes(lista, _modoActual(), handlers);
}

export function renderResultadosBusqueda(containerId, lista, onSeleccionar, labelAccion) {
  const cont = document.getElementById(containerId);
  if (!cont) return;
  if (!lista.length) {
    cont.innerHTML = '<div class="empty-state" style="padding:12px">Sin resultados</div>';
    return;
  }
  cont.innerHTML = lista.slice(0, 10).map(p => `
    <div class="pac-resultado" data-id="${p.id}"
      style="display:flex;align-items:center;gap:12px;padding:10px 14px;
             cursor:pointer;border-bottom:1px solid #f0f4f8;transition:background .15s">
      <div class="avatar" style="width:34px;height:34px;font-size:12px">${iniciales(p.nombre)}</div>
      <div style="flex:1">
        <div style="font-size:14px;font-weight:500;color:#161c2d">${p.nombre}</div>
        <div style="font-size:12px;color:#8492a6">Tel: ${p.telefono || '—'} · ${p.ciudad || '—'}</div>
      </div>
      <button class="btn btn-soft btn-sm">${labelAccion}</button>
    </div>`).join('');

  cont.querySelectorAll('.pac-resultado').forEach(row => {
    row.addEventListener('mouseover', () => row.style.background = '#f8fbff');
    row.addEventListener('mouseout',  () => row.style.background = '');
    row.addEventListener('click', () =>
      onSeleccionar(lista.find(p => p.id === row.dataset.id))
    );
  });
}

export function renderFormEditar(paciente) {
  const cont = document.getElementById('pac-editar-form');
  if (!cont) return;
  cont.innerHTML = `
    <div style="background:#f8fbff;border:1px solid #d0e8fb;border-radius:8px;padding:18px 20px;margin-top:12px">
      <div style="font-size:12px;font-weight:600;color:#0A76D8;margin-bottom:14px;text-transform:uppercase;letter-spacing:.05em">
        Editando: ${paciente.nombre}
      </div>
      <div class="form-row-2col">
        <div class="form-group">
          <label class="form-label">Nombre completo <span>*</span></label>
          <input class="input-text" id="edit-nombre" value="${paciente.nombre || ''}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Telefono <span style="color:#8492a6;font-weight:400">(no editable)</span></label>
          <input class="input-text" value="${paciente.telefono || ''}" disabled
            style="background:#f0f4f8;color:#8492a6;cursor:not-allowed"/>
        </div>
      </div>
      <div class="form-row-2col">
        <div class="form-group">
          <label class="form-label">Documento</label>
          <input class="input-text" id="edit-documento" value="${paciente.documento || ''}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Correo</label>
          <input class="input-text" id="edit-email" type="email" value="${paciente.email || ''}"/>
        </div>
      </div>
      <div class="form-row-2col">
        <div class="form-group">
          <label class="form-label">Departamento</label>
          <select class="input-text" id="edit-dpto"><option value="">Cargando...</option></select>
        </div>
        <div class="form-group">
          <label class="form-label">Ciudad</label>
          <select class="input-text" id="edit-ciudad" disabled><option value="">Seleccionar depto...</option></select>
        </div>
      </div>
      <div class="form-row-2col">
        <div class="form-group">
          <label class="form-label">Fecha de nacimiento</label>
          <input class="input-text" id="edit-nacimiento" type="date" value="${paciente.fechaNacimiento || ''}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Condicion / motivo</label>
          <input class="input-text" id="edit-condicion" value="${paciente.condicion || ''}"
            placeholder="Dolor lumbar cronico..."/>
        </div>
      </div>
      <div id="alert-editar-pac" style="margin-top:8px"></div>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn btn-gray" id="btn-cancelar-editar">Cancelar</button>
        <button class="btn btn-primary" id="btn-guardar-editar" data-id="${paciente.id}">Guardar cambios</button>
      </div>
    </div>`;
}

export function renderPills(ciudades, ciudadActiva, onSeleccionar) {
  const cont = document.getElementById('ciudad-pills');
  if (!cont) return;
  if (!ciudades.length) { cont.innerHTML = ''; return; }
  cont.innerHTML =
    `<span class="pill ${!ciudadActiva ? 'active' : ''}" data-ciudad="">Todas</span>` +
    ciudades.map(c =>
      `<span class="pill ${ciudadActiva === c ? 'active' : ''}" data-ciudad="${c}">${c}</span>`
    ).join('');
  cont.querySelectorAll('.pill').forEach(pill =>
    pill.addEventListener('click', () => onSeleccionar(pill.dataset.ciudad)));
}

export function renderUsuarios(lista) {
  const tbody = document.getElementById('usuarios-tbody');
  if (!tbody) return;
  tbody.innerHTML = lista.length
    ? lista.map(u => `
        <tr>
          <td>${u.nombre || '—'}</td>
          <td>${u.email}</td>
          <td><span class="badge badge-primary">${u.rol}</span></td>
          <td>${u.activo
            ? '<span class="badge badge-success">Activo</span>'
            : '<span class="badge badge-gray">Inactivo</span>'
          }</td>
        </tr>`).join('')
    : '<tr><td colspan="4" class="empty-state">Sin usuarios</td></tr>';
}

// ══════════════════════════════════════════════════════════
// PANELES DEL DASHBOARD (sin cambios)
// ══════════════════════════════════════════════════════════
function horaActualStr() {
  const n = new Date();
  return `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`;
}

function clasificarCita(hora) {
  const ahora = horaActualStr();
  const [hh, mm] = hora.split(':').map(Number);
  const finMin = mm + 20;
  const fin = `${String(hh + Math.floor(finMin / 60)).padStart(2,'0')}:${String(finMin % 60).padStart(2,'0')}`;
  if (ahora >= hora && ahora < fin) return 'en_curso';
  if (ahora >= fin)                 return 'pasada';
  return 'proxima';
}

export async function renderDashboardPaneles(onCompletar, onVozCita) {
  const cont = document.getElementById('dash-panel-wrap');
  if (!cont) return;

  const citas   = await obtenerCitasPorFecha(HOY);
  const activas = citas.filter(c => c.estado === ESTADOS.ACTIVA);

  const enCurso   = activas.find(c => clasificarCita(c.hora) === 'en_curso');
  const proxima   = activas.find(c => clasificarCita(c.hora) === 'proxima');
  const foco       = enCurso || proxima || null;
  const esEnCurso = !!enCurso;

  cont.innerHTML = `
    <div class="dash-panels-grid">
      <div class="dash-panel dash-panel-cita">
        <div class="dash-panel-label">
          ${esEnCurso
            ? '<span class="dash-dot dash-dot-verde"></span> Atendiendo ahora'
            : '<span class="dash-dot dash-dot-azul"></span> Proxima cita'}
        </div>
        ${foco ? `
          <div class="dash-cita-card">
            <div class="dash-cita-hora">${foco.hora}</div>
            <div class="dash-cita-avatar">${iniciales(foco.clienteNombre)}</div>
            <div class="dash-cita-info">
              <div class="dash-cita-nombre">${foco.clienteNombre}</div>
              <div class="dash-cita-meta">${foco.tipo}</div>
              <div class="dash-cita-ciudad">${foco.clienteCiudad || '—'}</div>
            </div>
            ${esEnCurso ? `
              <button class="btn btn-soft btn-sm" id="btn-completar-foco" data-id="${foco.id}">
                Completar
              </button>` : ''}
          </div>
          <div class="dash-proximas-lista" id="dash-proximas-lista"></div>
        ` : `<div class="dash-panel-empty">Sin citas pendientes para hoy</div>`}
      </div>

      <div class="dash-panel dash-panel-ia" id="dash-panel-ia">
        <div class="dash-panel-label">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" style="vertical-align:-2px;margin-right:5px">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8"  y1="23" x2="16" y2="23"/>
          </svg>
          Agente IA — agendar por voz
        </div>
        <div class="ia-voz-estado" id="ia-voz-estado">
          Di algo como: <em>"Cita para Juan Perez el viernes a las 10 de la manana"</em>
        </div>
        <div class="ia-voz-controles">
          <button class="ia-mic-btn" id="ia-mic-btn" title="Clic para hablar">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            </svg>
          </button>
          <span class="ia-mic-hint" id="ia-mic-hint">Presiona para hablar</span>
        </div>
        <div class="ia-voz-transcript" id="ia-voz-transcript" style="display:none"></div>
        <div class="ia-voz-resultado"  id="ia-voz-resultado"  style="display:none"></div>
        <div class="ia-voz-acciones"   id="ia-voz-acciones"   style="display:none">
          <button class="btn btn-primary btn-sm" id="ia-btn-confirmar">Confirmar cita</button>
          <button class="btn btn-gray btn-sm"     id="ia-btn-descartar">Descartar</button>
        </div>
      </div>
    </div>`;

  document.getElementById('btn-completar-foco')
    ?.addEventListener('click', async (e) => {
      await onCompletar(e.currentTarget.dataset.id);
      await renderDashboardPaneles(onCompletar, onVozCita);
    });

  const listaCont = document.getElementById('dash-proximas-lista');
  if (listaCont && foco) {
    const resto = activas
      .filter(c => c.id !== foco.id && clasificarCita(c.hora) === 'proxima')
      .slice(0, 3);
    listaCont.innerHTML = resto.map(c => `
      <div class="dash-proxima-item">
        <span class="dash-proxima-hora">${c.hora}</span>
        <span class="dash-proxima-nombre">${c.clienteNombre}</span>
        <span class="dash-proxima-tipo">${c.tipo}</span>
      </div>`).join('');
  }

  initAgenteVoz(onVozCita);
}

// ── Agente de voz (Gemini) — sin cambios ─────────────────
function initAgenteVoz(onVozCita) {
  const micBtn     = document.getElementById('ia-mic-btn');
  const micHint    = document.getElementById('ia-mic-hint');
  const estadoEl   = document.getElementById('ia-voz-estado');
  const transcEl   = document.getElementById('ia-voz-transcript');
  const resultEl   = document.getElementById('ia-voz-resultado');
  const accionesEl = document.getElementById('ia-voz-acciones');

  if (!micBtn) return;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    estadoEl.textContent = 'Tu navegador no soporta voz. Usa Chrome o Edge.';
    micBtn.disabled      = false;
    micBtn.style.opacity = '0.4';
    return;
  }

  const rec = new SR();
  rec.lang = 'es-CO'; rec.interimResults = false; rec.maxAlternatives = 1; rec.continuous = false;
  let grabando = false; let citaExtraida = null;

  micBtn.addEventListener('click', () => {
    if (grabando) {
      grabando = false;
      micBtn.classList.remove('grabando');
      micHint.textContent = 'Procesando...';
      rec.stop(); return;
    }
    grabando = true; citaExtraida = null;
    micBtn.classList.add('grabando');
    micHint.textContent = 'Escuchando... (clic para detener)';
    estadoEl.innerHTML  = 'Te estoy escuchando...';
    transcEl.textContent = ''; transcEl.style.display = 'none';
    resultEl.style.display = 'none'; accionesEl.style.display = 'none';
    try { rec.start(); } catch { rec.stop(); setTimeout(() => rec.start(), 300); }
  });

  rec.onresult = (e) => {
    const texto = Array.from(e.results).map(r => r[0].transcript).join('');
    transcEl.textContent = `"${texto}"`; transcEl.style.display = 'block';
  };

  rec.onend = async () => {
    micHint.textContent = 'Presiona para hablar';
    const textoFinal = (transcEl.textContent || '').replace(/^"|"$/g, '').trim();
    if (!textoFinal) { estadoEl.innerHTML = 'No detecte audio. Habla mas cerca del microfono.'; return; }

    estadoEl.innerHTML = 'Analizando cita con Gemini...';
    micBtn.disabled = true;
    const hoy = new Date().toISOString().split('T')[0];

    try {
      const res = await fetch('/api/gemini', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: `Eres el asistente de recepcion de un consultorio quiropractico en Colombia. Extrae datos de citas del texto dictado. Hoy es ${hoy}. Calcula fechas relativas. Convierte horas a formato 24h. Formato de salida: {"clienteNombre":string|null,"fecha":"YYYY-MM-DD"|null,"hora":"HH:MM"|null,"tipo":string,"notas":string}` }] },
          contents: [{ role: 'user', parts: [{ text: `DICTADO: "${textoFinal}"` }] }],
          generationConfig: { maxOutputTokens: 400, temperature: 0.1, responseMimeType: 'application/json' }
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      citaExtraida = JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text || '{}');

      resultEl.style.display = 'block';
      resultEl.innerHTML = `
        <div class="ia-resultado-item"><span class="ia-resultado-label">Paciente</span><span class="ia-resultado-val">${citaExtraida.clienteNombre || '<span style="color:#e67e22">No detectado</span>'}</span></div>
        <div class="ia-resultado-item"><span class="ia-resultado-label">Fecha</span><span class="ia-resultado-val">${citaExtraida.fecha || '<span style="color:#e67e22">No detectada</span>'}</span></div>
        <div class="ia-resultado-item"><span class="ia-resultado-label">Hora</span><span class="ia-resultado-val">${citaExtraida.hora || '<span style="color:#e67e22">No detectada</span>'}</span></div>
        <div class="ia-resultado-item"><span class="ia-resultado-label">Tipo</span><span class="ia-resultado-val">${citaExtraida.tipo || 'Ajuste general'}</span></div>`;
      estadoEl.innerHTML = 'Datos extraidos correctamente:';
      accionesEl.style.display = 'flex';
    } catch (err) {
      estadoEl.innerHTML = `Error: ${err.message}`;
    }
    micBtn.disabled = false;
  };

  rec.onspeechend = () => {
  console.log("🎙️ Silencio detectado: Deteniendo micrófono de forma automática...");
  if (grabando) {
    rec.stop();}
    }
  
  rec.onerror = (e) => {
    grabando = false; micBtn.classList.remove('grabando'); micBtn.disabled = false;
    micHint.textContent = 'Presiona para hablar'; estadoEl.textContent = `Error: ${e.error}`;
  };

  document.getElementById('ia-btn-confirmar')?.addEventListener('click', () => {
    if (!citaExtraida) return; onVozCita(citaExtraida);
    resultEl.style.display = 'none'; transcEl.style.display = 'none';
    accionesEl.style.display = 'none';
    estadoEl.innerHTML = 'Di algo como: <em>"Cita para Juan Perez el viernes a las 10"</em>';
    citaExtraida = null;
  });
  document.getElementById('ia-btn-descartar')?.addEventListener('click', () => {
    resultEl.style.display = 'none'; transcEl.style.display = 'none';
    accionesEl.style.display = 'none';
    estadoEl.innerHTML = 'Di algo como: <em>"Cita para Juan Perez el viernes a las 10"</em>';
    citaExtraida = null;
  });
}

// =========================================================================
// NAVEGACIÓN INTELIGENTE DE TARJETAS KPI (DASHBOARD)
// =========================================================================
document.addEventListener('click', (e) => {
  // 1. Verificamos que el clic haya sido dentro de una tarjeta KPI 
  // Y que SOLO sea en la pantalla principal de Dashboard
  const kpiCard = e.target.closest('#view-dashboard .kpi-card');
  if (!kpiCard) return;

  let vistaDestino = '';

  // 2. Determinamos a dónde ir basados en el color de la tarjeta
  if (kpiCard.classList.contains('kpi-blue') || kpiCard.classList.contains('kpi-cyan')) {
    vistaDestino = 'citas';     // Citas hoy y Pendientes
  } else if (kpiCard.classList.contains('kpi-yellow')) {
    vistaDestino = 'pacientes'; // Pacientes activos
  } else if (kpiCard.classList.contains('kpi-green') || kpiCard.classList.contains('kpi-purple') || kpiCard.classList.contains('kpi-red')) {
    vistaDestino = 'finanzas';  // Ingresos del día, mes y Cancelaciones
  }

  // 3. Simulamos el clic en el botón correspondiente de tu menú lateral (Sidebar)
  if (vistaDestino) {
    const botonMenu = document.querySelector(`[data-view="${vistaDestino}"]`);
    if (botonMenu) {
      botonMenu.click();
    } else {
      console.warn(`No se encontró el botón del menú lateral para: ${vistaDestino}`);
    }
  }
});