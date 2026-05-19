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