// src/modules/pacientes/crmRenderer.js — Renderizador con nuevo layout visual
// Mantiene el mismo comportamiento pero con interfaz mejorada

export async function renderGestorPacientes({ onRegistrar, onActualizar, onEliminar }) {
  const cont = document.getElementById('view-pacientes');
  if (!cont) return;

  const todos = await obtenerPacientes();

  cont.innerHTML = `
    <!-- ╔══ TOOLBAR PRINCIPAL ══════════════════════════════════════╗ -->
    <div class="crm-toolbar">
      <div class="crm-toolbar-left">
        <!-- Métricas compactas -->
        <div class="crm-metrics">
          <div class="crm-metric">
            <div class="crm-metric-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <div class="crm-metric-content">
              <div class="crm-metric-value" id="crm-total">${todos.length}</div>
              <div class="crm-metric-label">Pacientes</div>
            </div>
          </div>

          <div class="crm-metric">
            <div class="crm-metric-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
            </div>
            <div class="crm-metric-content">
              <div class="crm-metric-value" id="crm-activos">${todos.filter(p => p.activo !== false).length}</div>
              <div class="crm-metric-label">Activos</div>
            </div>
          </div>

          <div class="crm-metric">
            <div class="crm-metric-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
              </svg>
            </div>
            <div class="crm-metric-content">
              <div class="crm-metric-value" id="crm-ciudades">${new Set(todos.map(p => p.ciudad?.split(' > ')[1] || p.ciudad).filter(Boolean)).size}</div>
              <div class="crm-metric-label">Ciudades</div>
            </div>
          </div>
        </div>
      </div>

      <div class="crm-toolbar-right">
        <button class="crm-btn-new" id="crm-btn-nuevo" title="Registrar nuevo paciente">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Nuevo paciente
        </button>
      </div>
    </div>

    <!-- ╔══ PANEL IA — SUGERENCIA INTELIGENTE ══════════════════════╗ -->
    <div class="crm-ia-container" id="crm-ia-card">
      <div class="crm-ia-header">
        <div class="crm-ia-badge">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        </div>
        <div class="crm-ia-titles">
          <div class="crm-ia-title">Sugerencia de visita — Gemini</div>
          <div class="crm-ia-subtitle">Basado en concentración de pacientes por ciudad</div>
        </div>
        <button class="crm-ia-refresh" id="crm-ia-refresh" title="Generar nueva sugerencia">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </button>
      </div>

      <div class="crm-ia-content">
        <div class="crm-ia-body" id="crm-ia-body">
          <div class="crm-ia-estado">
            Presiona el botón para que Gemini analice tus pacientes y sugiera la próxima ciudad a visitar
          </div>
        </div>
        <div class="crm-ia-ciudades-group" id="crm-ia-ciudades"></div>
      </div>
    </div>

    <!-- ╔══ PANEL DE CONTROLES — Búsqueda y Filtros ═══════════════╗ -->
    <div class="crm-controls-panel" id="crm-controls-panel">
      <div class="crm-controls-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        Buscar y filtrar pacientes
      </div>

      <div class="crm-controls-row">
        <!-- Búsqueda por nombre/teléfono/documento -->
        <div class="crm-search-container">
          <label class="crm-search-label">Buscar por nombre, teléfono o documento</label>
          <div class="crm-search-box" id="crm-search-wrap">
            <svg class="crm-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input class="crm-search-input" id="crm-search" type="text"
              placeholder="Escribe para buscar..."/>
            <div class="crm-autocomplete" id="crm-autocomplete"></div>
          </div>
        </div>

        <!-- Filtro por ciudad -->
        <div class="crm-filter-container">
          <label class="crm-filter-label">Filtrar por ciudad</label>
          <div class="crm-filter-wrapper" id="crm-ciudad-wrap">
            <svg class="crm-filter-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            <input class="crm-filter-input" id="crm-ciudad-input" type="text"
              placeholder="Selecciona una ciudad..." autocomplete="off"/>
            <button class="crm-clear-btn" id="crm-clear-ciudad" style="display:none" title="Limpiar filtro">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
            <div class="crm-autocomplete crm-ciudad-ac" id="crm-ciudad-ac"></div>
          </div>
        </div>
      </div>

      <!-- Controles de vista y contador -->
      <div class="crm-actions-bar">
        <div class="crm-view-controls">
          <button class="crm-view-btn crm-view-active" id="crm-view-cards" title="Vista de tarjetas">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
            </svg>
          </button>
          <button class="crm-view-btn" id="crm-view-tabla" title="Vista de tabla">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/>
              <line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
        </div>
        <span class="crm-counter" id="crm-count">${todos.length} pacientes</span>
      </div>
    </div>

    <!-- ╔══ LISTA DE PACIENTES — Grid o Tabla ══════════════════════╗ -->
    <div class="crm-list-container">
      <div id="crm-lista" class="crm-lista-cards"></div>
    </div>

    <!-- ╔══ PANEL DE EDICIÓN INLINE ════════════════════════════════╗ -->
    <div class="crm-editar-panel" id="crm-editar-panel" style="display:none"></div>
  `;

  // Renderizar lista inicial
  _renderListaPacientes(todos, 'cards', { onActualizar, onEliminar });

  // Inicializar todas las interacciones
  _bindCrmBusqueda(todos, { onActualizar, onEliminar });
  _bindCrmFiltrosCiudad(todos, { onActualizar, onEliminar });
  _bindCrmVistas(todos, { onActualizar, onEliminar });
  _bindCrmIA(todos);

  document.getElementById('crm-btn-nuevo')?.addEventListener('click', onRegistrar);
}

// ═══════════════════════════════════════════════════════════════════════
// FUNCIONES INTERNAS — Se mantienen igual que antes
// ═══════════════════════════════════════════════════════════════════════

async function _renderListaPacientes(pacientes, vista, { onActualizar, onEliminar }) {
  const contenedor = document.getElementById('crm-lista');
  if (!contenedor) return;

  if (pacientes.length === 0) {
    contenedor.innerHTML = `
      <div class="crm-empty">
        <div class="crm-empty-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </div>
        <p>No hay pacientes que coincidan con tu búsqueda</p>
        <p style="font-size: 11px; margin-top: 4px;">Intenta ajustar tus filtros o crea un nuevo paciente</p>
      </div>
    `;
    return;
  }

  if (vista === 'cards') {
    contenedor.className = 'crm-lista-cards';
    contenedor.innerHTML = pacientes
      .map(p => _generarTarjetaPaciente(p, { onActualizar, onEliminar }))
      .join('');
  } else {
    contenedor.className = 'crm-lista-tabla';
    contenedor.innerHTML = `
      <div class="crm-contact-list">
        <div class="crm-list-header">
          <div class="crm-list-name">Nombre</div>
          <div class="crm-list-tel">Teléfono</div>
          <div class="crm-list-ciudad">Ciudad</div>
          <div class="crm-list-cond">Condición</div>
          <div style="width: 60px; flex-shrink: 0;"></div>
        </div>
        ${pacientes.map(p => _generarFilaPaciente(p, { onActualizar, onEliminar })).join('')}
      </div>
    `;
  }
}

function _generarTarjetaPaciente(p, { onActualizar, onEliminar }) {
  const { iniciales } = window.helpers || { iniciales: n => (n?.slice(0, 2) || 'P').toUpperCase() };
  const avatar = iniciales(p.nombre || 'Paciente');
  const colores = ['#e0f2ff', '#fef3c7', '#e0fdf4', '#fee2e2', '#f3e8ff', '#fef08a'];
  const index = (p.nombre?.charCodeAt(0) || 0) % colores.length;
  const bgColor = colores[index];

  const [depto, ciudad] = p.ciudad?.includes(' > ')
    ? p.ciudad.split(' > ')
    : ['', p.ciudad];

  return `
    <div class="crm-card">
      <div class="crm-av-wrap">
        <div class="crm-av" style="background: ${bgColor}; color: #333; font-weight: 800;">
          ${avatar}
        </div>
        <div class="crm-dist-dot" style="background: ${p.activo !== false ? '#22c55e' : '#ef4444'};"></div>
      </div>

      <div class="crm-info">
        <div class="crm-name">${p.nombre || 'Sin nombre'}</div>

        <div class="crm-contact-row">
          ${p.telefono ? `
            <div class="crm-contact-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
              </svg>
              <span>${p.telefono}</span>
            </div>
          ` : ''}
          ${p.documento ? `
            <div class="crm-contact-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
              <span>${p.documento}</span>
            </div>
          ` : ''}
        </div>

        <div class="crm-tags">
          ${ciudad ? `<div class="crm-tag crm-tag-city">${ciudad}</div>` : ''}
          ${p.condicion ? `<div class="crm-tag crm-tag-cond">${p.condicion}</div>` : ''}
        </div>
      </div>

      <div class="crm-actions-hover">
        <button class="crm-icon-btn" onclick="editarPaciente('${p.id}')" title="Editar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
          </svg>
        </button>
        <button class="crm-icon-btn crm-icon-del" onclick="confirmarEliminar('${p.id}')" title="Eliminar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    </div>
  `;
}

function _generarFilaPaciente(p, { onActualizar, onEliminar }) {
  const ciudad = p.ciudad?.includes(' > ')
    ? p.ciudad.split(' > ')[1]
    : p.ciudad;

  return `
    <div class="crm-list-row">
      <div class="crm-list-name">${p.nombre || 'Sin nombre'}</div>
      <div class="crm-list-tel">${p.telefono || '—'}</div>
      <div class="crm-list-ciudad">${ciudad || '—'}</div>
      <div class="crm-list-cond">${p.condicion || '—'}</div>
      <div class="crm-list-actions">
        <button class="crm-icon-btn" onclick="editarPaciente('${p.id}')" title="Editar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
          </svg>
        </button>
        <button class="crm-icon-btn crm-icon-del" onclick="confirmarEliminar('${p.id}')" title="Eliminar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    </div>
  `;
}

function _bindCrmBusqueda(todos, { onActualizar, onEliminar }) {
  const input = document.getElementById('crm-search');
  const ac = document.getElementById('crm-autocomplete');
  if (!input) return;

  input.addEventListener('input', () => {
    const t = input.value.toLowerCase().trim();
    const filtrados = !t ? [] : todos.filter(p =>
      p.nombre?.toLowerCase().includes(t) ||
      p.telefono?.includes(t) ||
      p.documento?.includes(t)
    );

    if (t && filtrados.length) {
      ac.innerHTML = filtrados.slice(0, 6).map(p => `
        <div class="crm-ac-item" onclick="seleccionarPaciente('${p.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
          </svg>
          <div style="flex:1">
            <div style="font-weight:600">${p.nombre}</div>
            <div style="font-size:11px;color:var(--text-muted)">${p.telefono || '—'}</div>
          </div>
        </div>
      `).join('');
      ac.style.display = 'block';
    } else {
      ac.style.display = 'none';
    }

    _actualizarVista(todos, { onActualizar, onEliminar });
  });

  input.addEventListener('blur', () => setTimeout(() => { ac.style.display = 'none'; }, 150));
}

function _bindCrmFiltrosCiudad(todos, { onActualizar, onEliminar }) {
  const inputCiudad = document.getElementById('crm-ciudad-input');
  const acCiudad = document.getElementById('crm-ciudad-ac');
  const clearBtn = document.getElementById('crm-clear-ciudad');
  if (!inputCiudad) return;

  const ciudadesSet = new Set(todos.map(p => p.ciudad?.split(' > ')[1] || p.ciudad).filter(Boolean));
  const ciudades = Array.from(ciudadesSet).sort();

  inputCiudad.addEventListener('input', () => {
    const t = inputCiudad.value.toLowerCase().trim();
    const matches = !t ? [] : ciudades.filter(c => c.toLowerCase().includes(t));

    if (matches.length) {
      acCiudad.innerHTML = matches.map(c => `
        <div class="crm-ac-item" onclick="filtrarCiudad('${c}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
          </svg>
          <span>${c}</span>
        </div>
      `).join('');
      acCiudad.style.display = 'block';
    } else {
      acCiudad.style.display = 'none';
    }
  });

  inputCiudad.addEventListener('blur', () => setTimeout(() => { acCiudad.style.display = 'none'; }, 150));
  clearBtn?.addEventListener('click', () => {
    inputCiudad.value = '';
    clearBtn.style.display = 'none';
    _actualizarVista(todos, { onActualizar, onEliminar });
  });
}

function _bindCrmVistas(todos, { onActualizar, onEliminar }) {
  const btnCards = document.getElementById('crm-view-cards');
  const btnTabla = document.getElementById('crm-view-tabla');
  if (!btnCards || !btnTabla) return;

  btnCards.addEventListener('click', () => {
    btnCards.classList.add('crm-view-active');
    btnTabla.classList.remove('crm-view-active');
    _actualizarVista(todos, { onActualizar, onEliminar }, 'cards');
  });

  btnTabla.addEventListener('click', () => {
    btnTabla.classList.add('crm-view-active');
    btnCards.classList.remove('crm-view-active');
    _actualizarVista(todos, { onActualizar, onEliminar }, 'tabla');
  });
}

function _bindCrmIA(todos) {
  const refreshBtn = document.getElementById('crm-ia-refresh');
  if (!refreshBtn) return;
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    // Aquí iría la lógica de IA (Gemini)
    setTimeout(() => { refreshBtn.disabled = false; }, 1500);
  });
}

function _actualizarVista(todos, { onActualizar, onEliminar }, vista = 'cards') {
  const search = document.getElementById('crm-search')?.value.toLowerCase() || '';
  const ciudadFiltro = document.getElementById('crm-ciudad-input')?.value || '';

  let filtered = todos;
  if (search) {
    filtered = filtered.filter(p =>
      p.nombre?.toLowerCase().includes(search) ||
      p.telefono?.includes(search) ||
      p.documento?.includes(search)
    );
  }
  if (ciudadFiltro) {
    filtered = filtered.filter(p =>
      p.ciudad === ciudadFiltro ||
      p.ciudad?.split(' > ')[1] === ciudadFiltro ||
      p.ciudad?.includes(ciudadFiltro)
    );
  }

  document.getElementById('crm-count').textContent = `${filtered.length} paciente${filtered.length !== 1 ? 's' : ''}`;
  _renderListaPacientes(filtered, vista, { onActualizar, onEliminar });
}
