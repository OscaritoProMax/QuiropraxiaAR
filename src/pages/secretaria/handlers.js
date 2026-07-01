// ══════════════════════════════════════════════════════════
// handlers.js — Event listeners, lógica de formularios y navegación
// ══════════════════════════════════════════════════════════

import { auth, db }           from '../../core/firebase.js';
import { protegerPagina }     from '../../core/router.js';
import { initPushNotifications } from '../../core/pushNotifications.js';
import { renderCronograma, autoCompletarCitasViejas } from '../../modules/dashboard/cronograma.js';
import { renderSemana }                                from '../../modules/dashboard/semana.js';
import { getDocs, collection } from 'firebase/firestore';

import { logout, crearUsuario, getUsuarioPorId,
         ROLES, tienePermiso }                      from '../../core/authService.js';
import { registrarPaciente, registrarPacienteRapido,
         obtenerPacientes, obtenerPacientesPorCiudad,
         buscarPacientes, filtrarPorCiudad,
         actualizarPaciente, eliminarPaciente,
         obtenerDepartamentos, obtenerPacientePorId, PAISES,
         ubicacionString, parsearUbicacion }         from '../../modules/pacientes/pacientesService.js';
import { agendarCita, cancelarCita, reprogramarCita,
         enviarPagoAPendiente, sugerirHorario, ESTADOS, HORARIOS, cargarHorarios,
         viajeEnFecha }         from '../../modules/citas/citasService.js';
import { formatCOP, TARIFA_BASE, obtenerConfiguracion,
         obtenerTarifaBaseActual }                    from '../../modules/finanzas/pagosService.js';

import {  inicializarSelectsUbicacion,
          poblarSelectDepartamentos,
          poblarSelectCiudades,
          restaurarUbicacion,
        } from '../../modules/pacientes/colombiaService.js';

import { mostrarAlerta, abrirModal, cerrarModal,
         crearBtn, HOY, MANANA,
         bindSelectGeo, bindSelectPais,
         pedirMotivoCancelacion }                    from '../../shared/helpers.js';
import { initTimePicker, updateTimePicker,
         setTimePicker }                             from '../../shared/timePicker.js';
import { renderPerfil, renderEstadisticas, renderCitasHoy,
         renderSlots, renderPacientes, renderPills,
         renderDashboardPaneles, renderGestorPacientes,
         renderResultadosBusqueda, renderFormEditar } from '../../modules/dashboard/ui.js';

// ══════════════════════════════════════════════════════════
// ESTADO GLOBAL
// ══════════════════════════════════════════════════════════
let usuarioActual     = null;
let _cobroPendiente   = null;
let pacientesCache    = [];
let citaReprogramarId = null;
let ciudadActivaPills = '';
let _getUbicacionCita = () => '';   // confirmación ciudad paciente existente

// ══════════════════════════════════════════════════════════
// INIT — punto de entrada único
// ══════════════════════════════════════════════════════════
export async function initSecretaria() {
  await cargarHorarios();     // genera los slots según la jornada configurada
  await poblarSelectsCiudadesAsync();
  poblarSelectsHorarios();
  bindModalCobro();
  bindNavegacion();
  bindModalesGlobal();
  bindLogout();
  bindFiltrosFecha();
  bindFormPaciente();
  bindFormCita();
  bindFormReprogramar();
  bindCronograma();
  initTema();
  return initAuth();
}

// ══════════════════════════════════════════════════════════
// TEMA DUAL — light / dark
// ══════════════════════════════════════════════════════════
function initTema() {
  const guardado = localStorage.getItem('qm-theme') || 'light';
  _aplicarTema(guardado);
  document.querySelectorAll('[data-theme-pick]').forEach(card => {
    card.addEventListener('click', () => _aplicarTema(card.dataset.themePick));
  });
}

function _aplicarTema(tema) {
  document.documentElement.setAttribute('data-theme', tema);
  localStorage.setItem('qm-theme', tema);
  document.querySelectorAll('[data-theme-pick]').forEach(card => {
    card.classList.toggle('theme-card-active', card.dataset.themePick === tema);
  });
}

// ══════════════════════════════════════════════════════════
// SELECTS INICIALES
// ══════════════════════════════════════════════════════════
function poblarSelectsCiudades() {
  // Modal nuevo paciente: departamento + ciudad Colombia
  bindSelectGeo('p-dpto', 'p-ciudad', obtenerDepartamentos);
  // ¿País extranjero? toggle
  bindSelectPais('p-pais', PAISES);

  // Registro rápido (modal cita): departamento + ciudad
  bindSelectGeo('qp-dpto', 'qp-ciudad', obtenerDepartamentos);
  bindSelectPais('qp-pais', PAISES);

  // Filtro buscar pacientes: departamento + ciudad (con "Todos")
  bindSelectGeo('pac-dpto-filtro', 'pac-select-ciudad', obtenerDepartamentos, { conTodas: true });

  // Exponer para renderFormEditar (edición inline)
  window.__DEPARTAMENTOS__ = obtenerDepartamentos;
  window.__PAISES__        = PAISES;

  // Toggle Colombia / Extranjero — modal nuevo paciente
  document.querySelectorAll('input[name="p-origen"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const esColombia = radio.value === 'colombia';
      document.getElementById('p-origen-colombia').style.display = esColombia ? 'flex' : 'none';
      document.getElementById('p-origen-extranjero').style.display = esColombia ? 'none' : 'flex';
    });
  });

  // Toggle Colombia / Extranjero — registro rápido
  document.querySelectorAll('input[name="qp-origen"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const esColombia = radio.value === 'colombia';
      document.getElementById('qp-origen-colombia').style.display = esColombia ? 'flex' : 'none';
      document.getElementById('qp-origen-extranjero').style.display = esColombia ? 'none' : 'flex';
    });
  });
}

async function poblarSelectsCiudadesAsync() {
  // Helper to add loading state
  const setLoading = (selectEl, text) => {
    if (!selectEl) return;
    selectEl.disabled = true;
    selectEl.innerHTML = `<option value="">Cargando ${text}...</option>`;
  };

  // ---- Modal nuevo paciente: departamento + ciudad Colombia ----
  const pDpto = document.getElementById('p-dpto');
  const pCiudad = document.getElementById('p-ciudad');
  if (pDpto && pCiudad) {
    setLoading(pDpto, 'departamentos');
    await poblarSelectDepartamentos(pDpto, 'Departamento...');
    // pre-select event for cities
    pDpto.addEventListener('change', () => {
      poblarSelectCiudades(pDpto, pCiudad, 'Ciudad...');
    });
    // trigger initial city load (if any)
    if (pDpto.value) {
      poblarSelectCiudades(pDpto, pCiudad, 'Ciudad...');
    }
  }

  // ---- ¿País extranjero? toggle (unchanged) ----
  bindSelectPais('p-pais', PAISES);

  // ---- Registro rápido (modal cita): departamento + ciudad ----
  const qpDpto = document.getElementById('qp-dpto');
  const qpCiudad = document.getElementById('qp-ciudad');
  if (qpDpto && qpCiudad) {
    setLoading(qpDpto, 'departamentos');
    await poblarSelectDepartamentos(qpDpto, 'Departamento...');
    qpDpto.addEventListener('change', () => {
      poblarSelectCiudades(qpDpto, qpCiudad, 'Ciudad...');
    });
    if (qpDpto.value) {
      poblarSelectCiudades(qpDpto, qpCiudad, 'Ciudad...');
    }
  }
  bindSelectPais('qp-pais', PAISES);

  // ---- Filtro buscar pacientes: departamento + ciudad (con "Todos") ----
  const pacDpto = document.getElementById('pac-dpto-filtro');
  const pacCiudad = document.getElementById('pac-select-ciudad');
  if (pacDpto && pacCiudad) {
    setLoading(pacDpto, 'departamentos');
    await poblarSelectDepartamentos(pacDpto, 'Departamento...');
    // Add "Todas" option at top for deptos
    const optAll = document.createElement('option');
    optAll.value = '';
    optAll.textContent = '— Todas las ciudades —';
    pacDpto.insertBefore(optAll, pacDpto.firstChild);
    pacDpto.addEventListener('change', () => {
      // reset city select
      pacCiudad.innerHTML = '<option value="">— Ciudad —</option>';
      pacCiudad.disabled = true;
      if (pacDpto.value) {
        poblarSelectCiudades(pacDpto, pacCiudad, 'Ciudad...');
      }
    });
    // If a depto is pre-selected, load its cities
    if (pacDpto.value) {
      poblarSelectCiudades(pacDpto, pacCiudad, 'Ciudad...');
    }
  }

  // Exponer para renderFormEditar (edición inline)
  window.__DEPARTAMENTOS__ = obtenerDepartamentos;
  window.__PAISES__        = PAISES;

  // Toggle Colombia / Extranjero — modal nuevo paciente
  document.querySelectorAll('input[name="p-origen"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const esColombia = radio.value === 'colombia';
      document.getElementById('p-origen-colombia').style.display = esColombia ? 'flex' : 'none';
      document.getElementById('p-origen-extranjero').style.display = esColombia ? 'none' : 'flex';
    });
  });

  // Toggle Colombia / Extranjero — registro rápido
  document.querySelectorAll('input[name="qp-origen"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const esColombia = radio.value === 'colombia';
      document.getElementById('qp-origen-colombia').style.display = esColombia ? 'flex' : 'none';
      document.getElementById('qp-origen-extranjero').style.display = esColombia ? 'none' : 'flex';
    });
  });
}

function poblarSelectsHorarios() {
  initTimePicker('c-hora', HORARIOS);
  initTimePicker('r-hora', HORARIOS);
}

// ══════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════
async function initAuth() {
  // protegerPagina verifica sesión y rol — redirige al login si no hay acceso.
  // Para Paso 3: cambiar a ['Administrador', 'Secretaria'] según la página.
  usuarioActual = await protegerPagina(['Administrador', 'Secretaria']);

  renderPerfil(usuarioActual);
  initPushNotifications(usuarioActual);

  if (!tienePermiso(usuarioActual, [ROLES.ADMINISTRADOR])) {
    const _mu = document.getElementById('menu-usuarios'); if (_mu) _mu.style.display = 'none';
  }

  await Promise.all([
    autoCompletarCitasViejas(),
    renderEstadisticas(),
    renderDashboardPaneles(completarCitaHoy, abrirModalCitaDesdeVoz),
    renderCitasHoy(completarCitaHoy),
    cargarPacientesCache(),
    obtenerConfiguracion(),
  ]);

  document.getElementById('btn-logout-config')?.addEventListener('click', async () => {
    await logout();
    window.location.href = '/index.html';
  });
}



async function completarCitaHoy(citaId) {
  abrirModalCobro({
    citaId,
    clienteId:     '',
    clienteNombre: '',
    clienteCiudad: '',
    hora:          '',
    tipoSesion:    'Ajuste general',
    onConfirmar: async () => {
      await Promise.all([
        renderDashboardPaneles(completarCitaHoy, abrirModalCitaDesdeVoz),
        renderEstadisticas(),
        renderCitasHoy(completarCitaHoy),
      ]);
    },
  });
}

// ══════════════════════════════════════════════════════════
// NAVEGACIÓN
// ══════════════════════════════════════════════════════════
function bindNavegacion() {
  document.querySelectorAll('.menu-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => mostrarVista(btn.dataset.view, btn));
  });
}

const btnToggle = document.getElementById('btn-toggle');
const sidebar = document.getElementById('sidebar');

btnToggle.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    
    // Opcional: Guardar el estado en localStorage para que se mantenga al recargar
    const isCollapsed = sidebar.classList.contains('collapsed');
    localStorage.setItem('sidebarStatus', isCollapsed ? 'collapsed' : 'open');
});

async function mostrarVista(vista, btn) {

  document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.menu-btn').forEach(b => b.classList.remove('menu-active'));
  document.getElementById('view-' + vista)?.classList.add('active');
  if (btn) btn.classList.add('menu-active');

  const titulos = {
    dashboard:    ['Dashboard',            'Resumen del día'],
    pacientes:    ['Gestión de pacientes', 'Registro, búsqueda y edición de pacientes'],
    citas:        ['Gestión de citas',     'Agenda de horarios'],
    cronograma:   ['Cronograma del día',   'Citas de hoy por estado y hora'],
    semana:       ['Semana',               'Ocupación del mes y la semana'],
    configuracion: ['Configuración',        'Tema y opciones de sesión'],
    herramientas: ['Herramientas',         'Utilidades del sistema'],
    usuarios:     ['Usuarios del sistema', 'Control de acceso'],
  };
  const [titulo, sub] = titulos[vista] ?? ['', ''];
  document.getElementById('topbar-title').textContent = titulo;
  document.getElementById('topbar-sub').textContent   = sub;

  const actions = document.getElementById('topbar-actions');
  actions.innerHTML = '';

  if (vista === 'dashboard') {
    await Promise.all([
      renderEstadisticas(),
      renderDashboardPaneles(completarCitaHoy, abrirModalCitaDesdeVoz),
      renderCitasHoy(completarCitaHoy),
    ]);
  }

  if (vista === 'pacientes') {
    actions.appendChild(crearBtn('+ Nuevo paciente', () => abrirModal('modal-paciente')));
    await renderGestorPacientes({
      onRegistrar: () => abrirModal('modal-paciente'),
      onActualizar: async (id, datos) => {
        const res = await actualizarPaciente(id, datos);
        if (res.ok) await cargarPacientesCache();
        return res;
      },
      onEliminar: async (id) => {
        const res = await eliminarPaciente(id);
        if (res.ok) await cargarPacientesCache();
        return res;
      },
    });
  }

  if (vista === 'citas') {
    actions.appendChild(crearBtn('+ Agendar cita', () => abrirModalCita()));
    const filtroFecha = document.getElementById('filter-fecha');
    if (!filtroFecha.value) filtroFecha.value = HOY;
    await cargarSlotsFecha(filtroFecha.value);
  }

 if (vista === 'cronograma') {
       actions.appendChild(crearBtn('↺ Actualizar', () => cargarCronograma()));
       await cargarCronograma();
     }

  if (vista === 'semana') {
    await renderSemana(irACitasDesdeSemana);
  }

  if (vista === 'usuarios' && tienePermiso(usuarioActual, [ROLES.ADMINISTRADOR])) {
    const modalUsr = document.getElementById('modal-usuario');
    if (modalUsr) actions.appendChild(crearBtn('+ Nuevo usuario', () => abrirModal('modal-usuario')));
    await cargarUsuarios();
  }
}

// Al elegir un día en la vista Semana, se abre el módulo de Citas con esa fecha.
function irACitasDesdeSemana(fechaStr) {
  const filtroFecha = document.getElementById('filter-fecha');
  if (filtroFecha) filtroFecha.value = fechaStr;
  const btnCitas = document.querySelector('.menu-btn[data-view="citas"]');
  mostrarVista('citas', btnCitas);
}

// ══════════════════════════════════════════════════════════
// SLOTS DE CITAS
// ══════════════════════════════════════════════════════════
function bindFiltrosFecha() {
  document.getElementById('filter-fecha')
    .addEventListener('change', e => cargarSlotsFecha(e.target.value));

  document.getElementById('btn-hoy')
    .addEventListener('click', () => {
      document.getElementById('filter-fecha').value = HOY;
      cargarSlotsFecha(HOY);
    });

  document.getElementById('btn-manana')
    .addEventListener('click', () => {
      document.getElementById('filter-fecha').value = MANANA;
      cargarSlotsFecha(MANANA);
    });
}

async function cargarSlotsFecha(fecha) {
  // Si la fecha cae en un viaje del quiropráctico, la sede local está cerrada.
  const viaje = await viajeEnFecha(fecha);
  if (viaje) {
    await renderSlots(fecha, { bloqueo: { ciudad: viaje.ciudadFull } });
    return;
  }
  await renderSlots(fecha, {
    onAgendar:      (hora) => abrirModalCita(hora),
    onCompletar:    async (id, f) => {
      const btn = document.querySelector(`[data-completar="${id}"]`);
      const row = btn?.closest('.slot-row');
      abrirModalCobro({
        citaId:        id,
        clienteId:     '',
        clienteNombre: row?.querySelector('.slot-name')?.textContent?.trim() || '',
        clienteCiudad: row?.querySelector('.slot-meta')?.textContent?.split('·')[1]?.trim() || '',
        hora:          row?.querySelector('.slot-time')?.textContent?.trim() || f,
        tipoSesion:    row?.querySelector('.slot-meta')?.textContent?.split('·')[0]?.trim() || 'Ajuste general',
        onConfirmar:   async () => {
          await Promise.all([cargarSlotsFecha(f), renderEstadisticas()]);
        },
      });
    },
    onReprogramar:  (id, f) => {
      citaReprogramarId = id;
      document.getElementById('r-fecha').value = f;
      abrirModal('modal-reprogramar');
    },
    onCancelar:     async (id, f) => {
      const motivo = await pedirMotivoCancelacion();
      if (!motivo) return;
      await cancelarCita(id, motivo, usuarioActual?.uid, usuarioActual?.nombre);
      mostrarAlerta('alert-cita', 'Cita cancelada.', 'success');
      await Promise.all([cargarSlotsFecha(f), renderEstadisticas()]);
    },
    onVerPaciente: (id) => abrirPanelPacienteCita(id),
  });
}

async function abrirPanelPacienteCita(pacienteId) {
  const panel = document.getElementById('panel-paciente-cita');
  if (!panel) return;

  panel.innerHTML = `<div style="margin-top:16px;padding:14px;background:var(--th-card);border:1px solid var(--th-card-border);border-radius:12px;border-left:4px solid var(--primary)">
    <div style="font-size:13px;color:var(--text-muted)">Cargando datos del paciente...</div>
  </div>`;
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const pac = await obtenerPacientePorId(pacienteId);
  if (!pac) {
    panel.innerHTML = `<div style="margin-top:16px;padding:14px;background:var(--th-card);border:1px solid var(--th-card-border);border-radius:12px">
      <div style="font-size:13px;color:var(--danger)">No se encontró el paciente.</div>
    </div>`;
    return;
  }

  panel.innerHTML = `
    <div style="margin-top:16px;background:var(--th-card);border:1px solid var(--th-card-border);border-radius:12px;border-left:4px solid var(--primary);overflow:hidden">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid var(--th-divider)">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="avatar" style="width:36px;height:36px;font-size:13px;flex-shrink:0">${pac.nombre.split(' ').slice(0,2).map(p=>p[0]).join('').toUpperCase()}</div>
          <div>
            <div style="font-weight:700;font-size:14px;color:var(--th-text)">${pac.nombre}</div>
            <div style="font-size:11px;color:var(--text-muted)">${pac.telefono || '—'} · ${pac.ciudad || 'Sin ciudad'}</div>
          </div>
        </div>
        <button id="ppc-cerrar" style="background:none;border:1px solid var(--th-card-border);border-radius:7px;width:28px;height:28px;cursor:pointer;color:var(--text-muted);display:flex;align-items:center;justify-content:center;font-size:16px">×</button>
      </div>
      <div style="padding:16px 18px">
        <div id="alert-ppc" style="margin-bottom:10px"></div>
        <div class="form-row-2col">
          <div class="form-group">
            <label class="form-label">Nombre completo</label>
            <input class="input-text" id="ppc-nombre" value="${pac.nombre || ''}"/>
          </div>
          <div class="form-group">
            <label class="form-label">Teléfono <span style="font-weight:400;color:var(--text-muted);font-size:11px">(no editable)</span></label>
            <input class="input-text" value="${pac.telefono || ''}" disabled style="opacity:.6;cursor:not-allowed"/>
          </div>
        </div>
        <div class="form-row-2col">
          <div class="form-group">
            <label class="form-label">Documento</label>
            <input class="input-text" id="ppc-doc" value="${pac.documento || ''}"/>
          </div>
          <div class="form-group">
            <label class="form-label">Correo</label>
            <input class="input-text" id="ppc-email" type="email" value="${pac.email || ''}"/>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Ciudad de origen</label>
          <div class="origen-selects">
            <select class="input-text" id="ppc-dpto"><option value="">Cargando...</option></select>
            <select class="input-text" id="ppc-ciudad" disabled><option value="">Ciudad...</option></select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Condición / motivo de consulta</label>
          <input class="input-text" id="ppc-condicion" value="${pac.condicion || ''}" placeholder="Ej: Dolor lumbar crónico"/>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:4px">
          <button class="btn btn-gray btn-sm" id="ppc-cancelar">Cancelar</button>
          <button class="btn btn-primary btn-sm" id="ppc-guardar" data-id="${pac.id}">Guardar cambios</button>
        </div>
      </div>
    </div>`;

  let _getPpcUbicacion = () => pac.ciudad || '';
  const dptoEl   = document.getElementById('ppc-dpto');
  const ciudadEl = document.getElementById('ppc-ciudad');
  _getPpcUbicacion = await inicializarSelectsUbicacion(dptoEl, ciudadEl);
  if (pac.ciudad) await restaurarUbicacion(dptoEl, ciudadEl, pac.ciudad);

  document.getElementById('ppc-cerrar')?.addEventListener('click', () => { panel.innerHTML = ''; });
  document.getElementById('ppc-cancelar')?.addEventListener('click', () => { panel.innerHTML = ''; });

  document.getElementById('ppc-guardar')?.addEventListener('click', async () => {
    const btn = document.getElementById('ppc-guardar');
    btn.textContent = 'Guardando...'; btn.disabled = true;
    const datos = {
      nombre:    document.getElementById('ppc-nombre')?.value.trim(),
      documento: document.getElementById('ppc-doc')?.value.trim(),
      email:     document.getElementById('ppc-email')?.value.trim(),
      condicion: document.getElementById('ppc-condicion')?.value.trim(),
      ciudad:    _getPpcUbicacion(),
    };
    if (!datos.nombre) {
      mostrarAlerta('alert-ppc', 'El nombre es obligatorio.', 'error');
      btn.textContent = 'Guardar cambios'; btn.disabled = false;
      return;
    }
    const res = await actualizarPaciente(pac.id, datos);
    if (res.ok) {
      mostrarAlerta('alert-ppc', 'Paciente actualizado correctamente.', 'success');
      btn.textContent = 'Guardar cambios'; btn.disabled = false;
    } else {
      mostrarAlerta('alert-ppc', res.error || 'Error al guardar.', 'error');
      btn.textContent = 'Guardar cambios'; btn.disabled = false;
    }
  });
}

// ══════════════════════════════════════════════════════════
// PACIENTES — estado local del módulo
// ══════════════════════════════════════════════════════════
let pacEditando = null; // paciente actualmente seleccionado para editar

async function cargarPacientesCache() {
  pacientesCache = await obtenerPacientes();
}

// ══════════════════════════════════════════════════════════
// TAB 1 — BUSCAR POR CIUDAD
// ══════════════════════════════════════════════════════════
function bindBusquedaPaciente() {
  // Selector de ciudad
  // El listener de ciudad ahora se dispara desde bindSelectGeo interno
  // Añadimos listener en pac-select-ciudad para trigger de filtro
  document.getElementById('pac-select-ciudad')?.addEventListener('change', async (e) => {
    const ciudad = e.target.value;
    const { pacientes, hayMas, total } = await obtenerPacientesPorCiudad(ciudad, 50);
    renderPacientes(pacientes);
    const btnTodos = document.getElementById('btn-pac-mostrar-todos');
    const contInfo = document.getElementById('pac-count-info');
    if (contInfo) contInfo.textContent = `Mostrando ${pacientes.length} de ${total} pacientes`;
    if (btnTodos) btnTodos.style.display = hayMas ? 'inline-block' : 'none';
  });

  // Botón mostrar todos
  document.getElementById('btn-pac-mostrar-todos')?.addEventListener('click', async () => {
    const ciudad = document.getElementById('pac-select-ciudad')?.value || '';
    const { pacientes, total } = await obtenerPacientesPorCiudad(ciudad, 9999);
    renderPacientes(pacientes);
    const contInfo = document.getElementById('pac-count-info');
    if (contInfo) contInfo.textContent = `Mostrando todos: ${total} pacientes`;
    document.getElementById('btn-pac-mostrar-todos').style.display = 'none';
  });

  // Búsqueda rápida por nombre/tel en tab buscar
  document.getElementById('search-pac')?.addEventListener('input', async (e) => {
    const q = e.target.value.trim();
    if (!q) {
      document.getElementById('lista-pacientes').innerHTML =
        '<div class="empty-state">Selecciona una ciudad o busca un paciente</div>';
      return;
    }
    const lista = await buscarPacientes(q);
    renderPacientes(lista);
  });
}

// ══════════════════════════════════════════════════════════
// TAB 2 — EDITAR PACIENTE
// ══════════════════════════════════════════════════════════
function bindEditorPaciente() {
  // Búsqueda para editar
  document.getElementById('search-pac-editar')?.addEventListener('input', async (e) => {
    const q = e.target.value.trim();
    const cont = document.getElementById('resultados-editar');
    if (!cont) return;
    if (q.length < 2) { cont.innerHTML = ''; return; }
    const lista = await buscarPacientes(q);
    renderResultadosBusqueda('resultados-editar', lista,
      (paciente) => {
        pacEditando = paciente;
        window.__CIUDADES__ = CIUDADES;
        renderFormEditar(paciente);
        bindGuardarEditar();
        document.getElementById('resultados-editar').innerHTML = '';
        document.getElementById('search-pac-editar').value = '';
      },
      'Editar'
    );
  });
}

function bindGuardarEditar() {
  document.getElementById('btn-guardar-editar')?.addEventListener('click', async () => {
    if (!pacEditando) return;
    const btn = document.getElementById('btn-guardar-editar');
    const datos = {
      nombre:          document.getElementById('edit-nombre')?.value.trim(),
      documento:       document.getElementById('edit-documento')?.value.trim(),
      email:           document.getElementById('edit-email')?.value.trim(),
      ciudad:          document.getElementById('edit-ciudad')?.value,
      fechaNacimiento: document.getElementById('edit-nacimiento')?.value,
      condicion:       document.getElementById('edit-condicion')?.value.trim(),
    };
    if (!datos.nombre) {
      mostrarAlerta('alert-editar-pac', 'El nombre es obligatorio.', 'error');
      return;
    }
    btn.textContent = 'Guardando...'; btn.disabled = true;
    const res = await actualizarPaciente(pacEditando.id, datos);
    if (res.ok) {
      mostrarAlerta('alert-editar-pac', 'Paciente actualizado correctamente.', 'success');
      pacEditando = null;
      setTimeout(() => {
        document.getElementById('pac-editar-form').innerHTML = '';
      }, 1200);
    } else {
      mostrarAlerta('alert-editar-pac', res.error, 'error');
    }
    btn.textContent = 'Guardar cambios'; btn.disabled = false;
  });

  document.getElementById('btn-cancelar-editar')?.addEventListener('click', () => {
    pacEditando = null;
    document.getElementById('pac-editar-form').innerHTML = '';
    document.getElementById('search-pac-editar').value = '';
  });
}

// ══════════════════════════════════════════════════════════
// TAB 3 — ELIMINAR PACIENTE
// ══════════════════════════════════════════════════════════
function bindEliminarPaciente() {
  document.getElementById('search-pac-eliminar')?.addEventListener('input', async (e) => {
    const q = e.target.value.trim();
    if (q.length < 2) {
      document.getElementById('resultados-eliminar').innerHTML = '';
      return;
    }
    const lista = await buscarPacientes(q);
    renderResultadosBusqueda('resultados-eliminar', lista,
      async (paciente) => {
        const confirmar = confirm(
          `¿Eliminar permanentemente a "${paciente.nombre}" (Tel: ${paciente.telefono || '—'})?

Esta acción no se puede deshacer.`
        );
        if (!confirmar) return;
        const res = await eliminarPaciente(paciente.id);
        if (res.ok) {
          mostrarAlerta('alert-eliminar-pac', `Paciente "${paciente.nombre}" eliminado.`, 'success');
          document.getElementById('resultados-eliminar').innerHTML = '';
          document.getElementById('search-pac-eliminar').value = '';
        } else {
          mostrarAlerta('alert-eliminar-pac', res.error, 'error');
        }
      },
      'Eliminar'
    );
  });
}

// ── Formulario: nuevo paciente completo ───────────────────
function bindFormPaciente() {
  document.getElementById('btn-guardar-pac').addEventListener('click', async () => {
    const btn = document.getElementById('btn-guardar-pac');
    const datos = {
      nombre:          document.getElementById('p-nombre').value.trim(),
      telefono:        document.getElementById('p-tel').value.trim(),
      documento:       document.getElementById('p-doc').value.trim(),
      email:           document.getElementById('p-email').value.trim(),
      condicion:       document.getElementById('p-condicion').value.trim(),
      ciudad:          ubicacionString(
                         document.getElementById('p-dpto')?.value,
                         document.getElementById('p-ciudad')?.value
                       ) || document.getElementById('p-pais')?.value || '',
      fechaNacimiento: document.getElementById('p-nacimiento').value,
    };

    btn.textContent = 'Guardando...'; btn.disabled = true;
    const res = await registrarPaciente(datos);

    if (res.ok) {
      mostrarAlerta('alert-form-pac', 'Paciente registrado correctamente.', 'success');
      await cargarPacientesCache();
      setTimeout(() => {
        cerrarModal('modal-paciente');
        ['p-nombre','p-doc','p-tel','p-email','p-condicion','p-nacimiento']
          .forEach(id => { document.getElementById(id).value = ''; });
        document.getElementById('p-dpto').value   = '';
        document.getElementById('p-ciudad').value  = '';
        document.getElementById('p-pais').value    = '';
      }, 900);
    } else {
      mostrarAlerta('alert-form-pac', res.error, 'error');
    }

    btn.textContent = 'Registrar'; btn.disabled = false;
  });
}

// ══════════════════════════════════════════════════════════
// MODAL CITA — autocomplete de paciente
// ══════════════════════════════════════════════════════════
function abrirModalCita(horaPreseleccionada = null) {
  document.getElementById('c-buscar-pac').value  = '';
  document.getElementById('c-paciente-id').value = '';
  document.getElementById('c-paciente-ciudad').value = '';
  document.getElementById('c-pac-sugerencias').style.display = 'none';
  document.getElementById('quick-register').classList.remove('visible');
  document.getElementById('cita-ciudad-wrap').style.display = 'none';
  document.getElementById('cita-dpto').value = '';
  document.getElementById('cita-ciudad-sel').value = '';
  document.getElementById('cita-ciudad-sel').disabled = true;
  _getUbicacionCita = () => '';
  document.getElementById('c-fecha').value = HOY;
  if (horaPreseleccionada) setTimePicker('c-hora', horaPreseleccionada);
  abrirModal('modal-cita');
}

function bindFormCita() {
  const inputBuscar  = document.getElementById('c-buscar-pac');
  const sugerencias  = document.getElementById('c-pac-sugerencias');

  // Autocomplete
  inputBuscar.addEventListener('input', async () => {
    const q = inputBuscar.value.trim();
    if (q.length < 2) { sugerencias.style.display = 'none'; return; }

    const res = await buscarPacientes(q);

    if (!res.length) {
      sugerencias.innerHTML = `
        <div style="padding:10px 14px;font-size:13px;color:#8492a6">
          No encontrado —
          <span style="color:#0A76D8;cursor:pointer;font-weight:500" id="show-quick-reg">
            Registrar paciente rápido
          </span>
        </div>`;
      sugerencias.style.display = 'block';
      document.getElementById('show-quick-reg').addEventListener('click', () => {
          // Si q es numérico → va al documento, nombre queda vacío
          // Si q tiene letras  → va al nombre, documento queda vacío
          const esTelefono = /^[\d+\s-]{6,}$/.test(q);
          document.getElementById('qp-nombre').value = esTelefono ? '' : q;
          document.getElementById('qp-tel').value    = esTelefono ? q  : '';
          document.getElementById('quick-register').classList.add('visible');
          sugerencias.style.display = 'none';
        });
      return;
    }

    sugerencias.innerHTML = res.map(p => `
      <div class="sugerencia-item"
        data-id="${p.id}" data-nombre="${p.nombre}" data-ciudad="${p.ciudad || ''}"
        style="padding:9px 14px;cursor:pointer;font-size:13px;border-bottom:1px solid #f5f5f5">
        <strong>${p.nombre}</strong>
        <span style="color:#8492a6"> · ${p.telefono || p.documento || '—'} · ${p.ciudad || '—'}</span>
      </div>`).join('');
    sugerencias.style.display = 'block';

    sugerencias.querySelectorAll('.sugerencia-item').forEach(item => {
      item.addEventListener('click', () => seleccionarPaciente(item, sugerencias));
      item.addEventListener('mouseover', () => { item.style.background = '#f0f7ff'; });
      item.addEventListener('mouseout',  () => { item.style.background = ''; });
    });
  });

  // Registro rápido
  document.getElementById('btn-quick-save').addEventListener('click', async () => {
    const btn    = document.getElementById('btn-quick-save');
    const nombre = document.getElementById('qp-nombre').value.trim();
    const tel_   = document.getElementById('qp-tel').value.trim();
    const ciudad = ubicacionString(
      document.getElementById('qp-dpto')?.value,
      document.getElementById('qp-ciudad')?.value
    ) || document.getElementById('qp-pais')?.value || '';

    btn.textContent = 'Guardando...'; btn.disabled = true;
    const res = await registrarPacienteRapido(nombre, tel_, ciudad);

    if (res.ok) {
      // ... código existente ...
      document.getElementById('quick-register').classList.remove('visible');
      // Agregar limpieza de campos:
      document.getElementById('qp-nombre').value  = '';
      document.getElementById('qp-tel').value     = '';
      document.getElementById('qp-dpto').value    = '';
      document.getElementById('qp-ciudad').value  = '';
      document.getElementById('qp-pais').value    = '';
    }else {
    if (res.paciente) {
      document.getElementById('c-paciente-id').value     = res.paciente.id;
      document.getElementById('c-paciente-nombre').value = res.paciente.nombre;
      document.getElementById('c-buscar-pac').value      = res.paciente.nombre;
      document.getElementById('quick-register').classList.remove('visible'); // ← AGREGAR
      mostrarAlerta('alert-form-cita', 'Paciente ya existente — seleccionado.', 'success');
    }
        }

    btn.textContent = 'Guardar y usar este paciente'; btn.disabled = false;
  });

  // Guardar cita
  document.getElementById('btn-guardar-cita').addEventListener('click', async () => {
    const btn = document.getElementById('btn-guardar-cita');
    const pid = document.getElementById('c-paciente-id').value;
    if (!pid) {
      mostrarAlerta('alert-form-cita', 'Selecciona o registra un paciente primero.', 'error');
      return;
    }

    // Actualizar ciudad del paciente si cambió
    const citaCiudadWrap = document.getElementById('cita-ciudad-wrap');
    if (citaCiudadWrap?.style.display !== 'none') {
      const nuevaCiudad = _getUbicacionCita();
      if (nuevaCiudad && nuevaCiudad !== document.getElementById('c-paciente-ciudad').value) {
        document.getElementById('c-paciente-ciudad').value = nuevaCiudad;
        actualizarPaciente(pid, { ciudad: nuevaCiudad }).catch(() => {});
      }
    }

    const datos = {
      clienteId:     pid,
      clienteNombre: document.getElementById('c-paciente-nombre').value,
      clienteCiudad: document.getElementById('c-paciente-ciudad').value,
      usuarioId:     usuarioActual?.uid || '',
      usuarioNombre: usuarioActual?.nombre || '',
      fecha:         document.getElementById('c-fecha').value,
      hora:          document.getElementById('c-hora').value,
      tipo:          document.getElementById('c-tipo').value,
      notas:         document.getElementById('c-notas').value,
    };

    btn.textContent = 'Agendando...'; btn.disabled = true;
    const res = await agendarCita(datos);

    if (res.ok) {
      mostrarAlerta('alert-form-cita', 'Cita agendada correctamente.', 'success');
      const fechaActual = document.getElementById('filter-fecha').value;
      await Promise.all([
        renderEstadisticas(),
        renderDashboardPaneles(completarCitaHoy, abrirModalCitaDesdeVoz),
        ...(fechaActual ? [cargarSlotsFecha(fechaActual)] : []),
      ]);
      setTimeout(() => {
        cerrarModal('modal-cita');
        document.getElementById('c-notas').value = '';
      }, 900);
    } else {
      // ── Sugerir próximo horario disponible ──────────────
      const sugerencia = await sugerirHorario(datos.fecha, datos.hora);
      if (sugerencia) {
        const alertEl = document.getElementById('alert-form-cita');
        alertEl.className = 'alert alert-warning';
        alertEl.innerHTML = `
          ⚠️ ${res.error}<br>
          <strong>Próximo disponible: ${sugerencia.hora}</strong>
          <button
            style="margin-left:10px;padding:2px 10px;border-radius:4px;
                   border:1px solid #0A76D8;background:#f0f7ff;
                   color:#0A76D8;cursor:pointer;font-size:12px;"
            id="btn-usar-sugerencia">
            Usar este horario
          </button>`;
        setTimeout(() => { if (alertEl) { alertEl.textContent = ''; alertEl.className = ''; } }, 8000);
        document.getElementById('btn-usar-sugerencia')?.addEventListener('click', () => {
          setTimePicker('c-hora', sugerencia.hora);
          document.getElementById('c-fecha').value = sugerencia.fecha;
          alertEl.textContent = ''; alertEl.className = '';
        });
      } else {
        mostrarAlerta('alert-form-cita', res.error + ' No hay horarios disponibles ese día.', 'error');
      }
    }

    btn.textContent = 'Agendar'; btn.disabled = false;
  });
}

async function seleccionarPaciente(item, sugerencias) {
  const ciudad = item.dataset.ciudad || '';
  asignarPacienteACita(item.dataset.id, item.dataset.nombre, ciudad);
  sugerencias.style.display = 'none';
  document.getElementById('quick-register').classList.remove('visible');

  // Mostrar sección de ciudad para confirmar/actualizar
  const wrap = document.getElementById('cita-ciudad-wrap');
  if (wrap) {
    wrap.style.display = 'block';
    const dpto    = document.getElementById('cita-dpto');
    const ciudSel = document.getElementById('cita-ciudad-sel');
    _getUbicacionCita = await inicializarSelectsUbicacion(dpto, ciudSel);
    if (ciudad) await restaurarUbicacion(dpto, ciudSel, ciudad);
    ciudSel.addEventListener('change', () => {
      document.getElementById('c-paciente-ciudad').value = _getUbicacionCita();
    });
  }
}

function asignarPacienteACita(id, nombre, ciudad) {
  document.getElementById('c-paciente-id').value     = id;
  document.getElementById('c-paciente-nombre').value = nombre;
  document.getElementById('c-paciente-ciudad').value = ciudad;
  document.getElementById('c-buscar-pac').value      = nombre;
}

// ── Formulario: reprogramar ───────────────────────────────
function bindFormReprogramar() {
  document.getElementById('btn-confirmar-reprog').addEventListener('click', async () => {
    const btn  = document.getElementById('btn-confirmar-reprog');
    const fecha = document.getElementById('r-fecha').value;
    const hora  = document.getElementById('r-hora').value;

    btn.textContent = 'Confirmando...'; btn.disabled = true;
    const res = await reprogramarCita(citaReprogramarId, fecha, hora, usuarioActual?.uid, usuarioActual?.nombre);

    if (res.ok) {
      cerrarModal('modal-reprogramar');
      mostrarAlerta('alert-cita', 'Cita reprogramada correctamente.', 'success');
      await cargarSlotsFecha(document.getElementById('filter-fecha').value);
    } else {
      // ── Sugerir próximo horario libre ──────────────────
      const sugerencia = await sugerirHorario(fecha, hora);
      const alertEl    = document.getElementById('alert-reprog');

      if (sugerencia) {
        alertEl.className = 'alert alert-warning';
        alertEl.innerHTML = `
          ⚠️ ${res.error}<br>
          <strong>Próximo disponible: ${sugerencia.hora}</strong>
          <button
            style="margin-left:10px;padding:2px 10px;border-radius:4px;
                   border:1px solid #0A76D8;background:#f0f7ff;
                   color:#0A76D8;cursor:pointer;font-size:12px;"
            id="btn-usar-sugerencia-reprog">
            Usar este horario
          </button>`;
        setTimeout(() => { alertEl.textContent = ''; alertEl.className = ''; }, 8000);

        document.getElementById('btn-usar-sugerencia-reprog')
          ?.addEventListener('click', () => {
            setTimePicker('r-hora', sugerencia.hora);
            document.getElementById('r-fecha').value = sugerencia.fecha;
            alertEl.textContent = ''; alertEl.className = '';
          });
      } else {
        alertEl.className   = 'alert alert-error';
        alertEl.textContent = res.error + ' No hay horarios disponibles ese día.';
        setTimeout(() => { alertEl.textContent = ''; alertEl.className = ''; }, 5000);
      }
    }

    btn.textContent = 'Confirmar'; btn.disabled = false;
  });
}

// ══════════════════════════════════════════════════════════
// USUARIOS
// ══════════════════════════════════════════════════════════
async function cargarUsuarios() {
  const tbody = document.getElementById('usuarios-tbody');
  if (!tbody) return; // no existe en secretaria
  const snap  = await getDocs(collection(db, 'usuarios'));
  const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderUsuarios(lista);
}

function bindFormUsuario() {
  // No disponible en secretaria — el modal de usuarios no existe en este HTML
  const btn = document.getElementById('btn-guardar-usr');
  if (!btn) return; // salir silenciosamente si no existe el elemento
  btn.addEventListener('click', async () => {});
}

// ══════════════════════════════════════════════════════════
// LOGOUT
// ══════════════════════════════════════════════════════════
function bindLogout() {
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await logout();
    sessionStorage.clear();
    window.location.replace('./index.html');
  });
}

// ══════════════════════════════════════════════════════════
// MODALES — cierre global
// ══════════════════════════════════════════════════════════
function bindModalesGlobal() {
  document.querySelectorAll('[data-close]').forEach(el => {
    el.addEventListener('click', () => cerrarModal(el.dataset.close));
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) cerrarModal(overlay.id);
    });
  });
}

function bindCronograma() {
  document.getElementById('btn-refresh-crono')
    ?.addEventListener('click', () => cargarCronograma());
}

 
async function cargarCronograma() {
  await renderCronograma({
    onCompletar: async (id) => {
      const card = document.querySelector(`[data-crono-completar="${id}"]`)?.closest('.crono-card');
      abrirModalCobro({
        citaId:        id,
        clienteId:     card?.dataset?.clienteId || '',
        clienteNombre: card?.querySelector('.crono-nombre')?.textContent?.trim() || '',
        clienteCiudad: card?.dataset?.clienteCiudad || '',
        hora:          card?.querySelector('.crono-hora')?.textContent?.trim() || '',
        tipoSesion:    card?.querySelector('.crono-meta')?.textContent?.split('·')[0]?.trim() || 'Ajuste general',
        onConfirmar: async () => {
          await renderEstadisticas();
          await cargarCronograma();
        },
      });
    },
    onCancelar: async (id) => {
      const motivo = await pedirMotivoCancelacion();
      if (!motivo) return;
      await cancelarCita(id, motivo, usuarioActual?.uid, usuarioActual?.nombre);
      await renderEstadisticas();
    },
    onReprogramar: (id) => {
      citaReprogramarId = id;
      document.getElementById('r-fecha').value = HOY;
      abrirModal('modal-reprogramar');
    },
  });
}

// ══════════════════════════════════════════════════════════
// MODAL DE COBRO — registrar cobro de sesión
// ══════════════════════════════════════════════════════════
function abrirModalCobro({ citaId, clienteId, clienteNombre, clienteCiudad, hora, tipoSesion, onConfirmar }) {
  _cobroPendiente = { citaId, clienteId, clienteNombre, clienteCiudad, hora, tipoSesion, onConfirmar };

  document.getElementById('cobro-cita-id').value        = citaId;
  document.getElementById('cobro-cliente-id').value     = clienteId;
  document.getElementById('cobro-cliente-ciudad').value = clienteCiudad;
  document.getElementById('cobro-hora').value           = hora;
  document.getElementById('cobro-tipo-sesion').value    = tipoSesion;
  document.getElementById('cobro-cliente-nombre').textContent = clienteNombre || 'Paciente';
  document.getElementById('cobro-tipo-display').value   = tipoSesion || 'Ajuste general';
  document.getElementById('cobro-tarifa').value         = obtenerTarifaBaseActual();
  document.getElementById('cobro-meds-lista').innerHTML = '';
  document.getElementById('alert-cobro').innerHTML      = '';
  actualizarResumenCobro();
  abrirModal('modal-cobro');
}

function actualizarResumenCobro() {
  const tarifa = Number(document.getElementById('cobro-tarifa')?.value) || 0;
  let totalMeds = 0;
  document.querySelectorAll('.cobro-med-precio').forEach(inp => {
    totalMeds += Number(inp.value) || 0;
  });
  const total = tarifa + totalMeds;
  document.getElementById('cobro-resumen-tarifa').textContent = formatCOP(tarifa);
  document.getElementById('cobro-resumen-meds').textContent   = formatCOP(totalMeds);
  document.getElementById('cobro-resumen-total').textContent  = formatCOP(total);
}

function bindModalCobro() {
  document.getElementById('cobro-tarifa')
    ?.addEventListener('input', actualizarResumenCobro);

  document.getElementById('btn-add-med')
    ?.addEventListener('click', () => {
      const lista = document.getElementById('cobro-meds-lista');
      const fila  = document.createElement('div');
      fila.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:6px';
      fila.innerHTML = `
        <input class="input-text cobro-med-nombre" placeholder="Nombre del ítem" style="flex:2" type="text"/>
        <input class="input-text cobro-med-precio" placeholder="Precio $" style="flex:1" type="number" min="0"/>
        <button class="btn btn-danger btn-sm" type="button" style="padding:4px 8px"
                onclick="this.closest('div').remove();window.__secActualizarCobro()">✕</button>`;
      fila.querySelector('.cobro-med-precio')
          .addEventListener('input', actualizarResumenCobro);
      lista.appendChild(fila);
    });

  document.getElementById('btn-confirmar-cobro')
    ?.addEventListener('click', async () => {
      if (!_cobroPendiente) return;
      const btn = document.getElementById('btn-confirmar-cobro');
      btn.disabled = true;
      btn.textContent = 'Procesando...';

      const tarifa = Number(document.getElementById('cobro-tarifa').value) || TARIFA_BASE;
      const medicamentos = [];
      document.querySelectorAll('#cobro-meds-lista > div').forEach(fila => {
        const nombre = fila.querySelector('.cobro-med-nombre')?.value?.trim();
        const precio = Number(fila.querySelector('.cobro-med-precio')?.value) || 0;
        if (nombre) medicamentos.push({ nombre, precio });
      });

      const totalCobrado = tarifa + medicamentos.reduce((s, m) => s + (m.precio || 0), 0);

      // La secretaria no completa directamente: el cobro queda pendiente
      // de aprobación por un administrador (ver Finanzas → Pendientes).
      await enviarPagoAPendiente(_cobroPendiente.citaId, {
        citaId:        _cobroPendiente.citaId,
        clienteId:     _cobroPendiente.clienteId,
        clienteNombre: _cobroPendiente.clienteNombre,
        clienteCiudad: _cobroPendiente.clienteCiudad,
        fecha:         HOY,
        hora:          _cobroPendiente.hora,
        tipoSesion:    _cobroPendiente.tipoSesion,
        tarifaBase:    tarifa,
        medicamentos,
        totalCobrado,
      }, usuarioActual?.uid, usuarioActual?.nombre);

      cerrarModal('modal-cobro');
      btn.disabled = false;
      btn.textContent = 'Confirmar y completar';
      mostrarAlerta('alert-cita', 'Cobro enviado. Quedará pendiente hasta que un administrador lo confirme.', 'success');

      await _cobroPendiente.onConfirmar?.();
      _cobroPendiente = null;
    });
}

window.__secActualizarCobro = actualizarResumenCobro;

function abrirModalCitaDesdeVoz(datos) {
  // Preseleccionar hora si viene
  const horaPresel = datos.hora || null;
  abrirModalCita(horaPresel);
 
  // Inyectar fecha
  if (datos.fecha) {
    document.getElementById('c-fecha').value = datos.fecha;
  }
 
  // Inyectar tipo
  if (datos.tipo) {
    const sel = document.getElementById('c-tipo');
    // Intentar seleccionar el tipo más parecido
    const opcion = Array.from(sel.options)
      .find(o => o.text.toLowerCase().includes(datos.tipo.toLowerCase()));
    if (opcion) sel.value = opcion.value;
  }
 
  // Inyectar notas
  if (datos.notas) {
    document.getElementById('c-notas').value = datos.notas;
  }
 
  // Pre-rellenar búsqueda de paciente con el nombre extraído
  if (datos.clienteNombre) {
    const input = document.getElementById('c-buscar-pac');
    input.value = datos.clienteNombre;
    // Disparar el evento input para activar el autocomplete
    input.dispatchEvent(new Event('input'));
  }
}