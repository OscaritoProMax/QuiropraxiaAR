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
         enviarPagoAPendiente, sugerirHorario, sugerirHorariosMostrador, ESTADOS, HORARIOS, cargarHorarios,
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
         pedirMotivoCancelacion, escapeHtml }        from '../../shared/helpers.js';
import { toast, avisoCentral, initNavGrupos, confirmar } from '../../shared/interactions.js';
import { initTimePicker, updateTimePicker,
         setTimePicker, hora12Display }               from '../../shared/timePicker.js';
import { renderPerfil, renderEstadisticas, renderCitasHoy,
         renderSlots, renderPacientes, renderPills,
         renderDashboardPaneles, renderGestorPacientes,
         renderResultadosBusqueda, renderFormEditar,
         bindTabsCitas, abrirModalPaciente }          from '../../modules/dashboard/ui.js';

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
  initNavGrupos([
    { id: 'citas', label: 'Citas', selectores: ['[data-view="citas"]', '[data-view="cronograma"]', '[data-view="semana"]'] },
  ]);
  bindModalesGlobal();
  bindLogout();
  bindFiltrosFecha();
  bindTabsCitas();
  bindFormPaciente();
  bindFormCita();
  bindFormCitaMostrador();
  document.getElementById('fab-cita-mostrador')?.addEventListener('click', () => abrirModalCitaMostrador());
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
    renderDashboardPaneles(completarCitaHoy, abrirModalCitaDesdeVoz, false, true, true, {
      onCancelarCita: cancelarCitaDesdeAsistente,
      onReprogramarCita: reprogramarCitaDesdeAsistente,
    }),
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
  // completarCitaHoy se usa tanto para el botón del panel "cita en curso"
  // (.dash-cita-card, id btn-completar-foco) como para cada fila de la
  // tabla "Citas de hoy" (<tr data-completar>, ver renderCitasHoy en ui.js).
  const trigger = document.querySelector(`[data-completar="${citaId}"]`)
                || document.getElementById('btn-completar-foco');
  const card = trigger?.closest('.dash-cita-card, tr');
  abrirModalCobro({
    citaId,
    clienteId:     card?.dataset?.clienteId     || '',
    clienteNombre: card?.querySelector('.dash-cita-nombre, .citahoy-nombre')?.textContent?.trim() || '',
    clienteCiudad: card?.dataset?.clienteCiudad || '',
    hora:          card?.dataset?.hora || '',
    tipoSesion:    card?.dataset?.tipoSesion || 'Ajuste general',
    onConfirmar: async () => {
      await Promise.all([
        renderDashboardPaneles(completarCitaHoy, abrirModalCitaDesdeVoz, false, true, true, {
      onCancelarCita: cancelarCitaDesdeAsistente,
      onReprogramarCita: reprogramarCitaDesdeAsistente,
    }),
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

  // El título del topbar solo dice "Quiromasajes" en el Dashboard — en el
  // resto de módulos vuelve a mostrar el nombre del módulo actual.
  const titulos = {
    dashboard:    ['Quiromasajes',         'Resumen del día'],
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

  // FAB de "cita de mostrador" — solo visible dentro de la vista Citas.
  const fabMostrador = document.getElementById('fab-cita-mostrador');
  if (fabMostrador) fabMostrador.style.display = vista === 'citas' ? 'flex' : 'none';

  if (vista === 'dashboard') {
    await Promise.all([
      renderEstadisticas(),
      renderDashboardPaneles(completarCitaHoy, abrirModalCitaDesdeVoz, false, true, true, {
      onCancelarCita: cancelarCitaDesdeAsistente,
      onReprogramarCita: reprogramarCitaDesdeAsistente,
    }),
      renderCitasHoy(completarCitaHoy),
    ]);
  }

  if (vista === 'pacientes') {
    actions.appendChild(crearBtn('+ Nuevo paciente', () => abrirModal('modal-paciente')));
    await renderGestorPacientes({
      onRegistrar: () => abrirModal('modal-paciente'),
      // abrirModalPaciente() ya guarda directamente — este hook solo
      // refresca la caché de pacientes (usada por los autocompletados).
      onActualizar: async () => { await cargarPacientesCache(); },
      onEliminar: async (id) => {
        const res = await eliminarPaciente(id);
        if (res.ok) await cargarPacientesCache();
        return res;
      },
      esAdmin: false,
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
  const filterFechaEl = document.getElementById('filter-fecha');
  filterFechaEl.min = HOY;
  filterFechaEl.addEventListener('change', e => cargarSlotsFecha(e.target.value));

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
      const row = document.querySelector(`[data-completar="${id}"]`)?.closest('.slot-row');
      abrirModalCobro({
        citaId:        id,
        clienteId:     row?.dataset?.clienteId     || '',
        clienteNombre: row?.querySelector('.slot-name')?.textContent?.trim() || '',
        clienteCiudad: row?.dataset?.clienteCiudad || '',
        hora:          row?.dataset?.hora || '',
        tipoSesion:    row?.dataset?.tipoSesion || 'Ajuste general',
        onConfirmar:   async () => {
          await Promise.all([cargarSlotsFecha(f), renderEstadisticas()]);
        },
      });
    },
    onReprogramar:  (id, f) => {
      citaReprogramarId = id;
      const rFechaEl = document.getElementById('r-fecha');
      rFechaEl.min   = HOY;
      rFechaEl.value = f < HOY ? HOY : f;
      abrirModal('modal-reprogramar');
    },
    onCancelar:     async (id, f) => {
      const motivo = await pedirMotivoCancelacion();
      if (!motivo) return;
      await cancelarCita(id, motivo, usuarioActual?.uid, usuarioActual?.nombre);
      toast('Cita cancelada.', 'success');
      await Promise.all([cargarSlotsFecha(f), renderEstadisticas()]);
    },
    onVerPaciente: (id) => abrirModalPaciente(id),
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
  const inputFecha = document.getElementById('c-fecha');
  inputFecha.min   = HOY;
  inputFecha.value = HOY;
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
        data-id="${escapeHtml(p.id)}" data-nombre="${escapeHtml(p.nombre)}" data-ciudad="${escapeHtml(p.ciudad || '')}"
        style="padding:9px 14px;cursor:pointer;font-size:13px;border-bottom:1px solid #f5f5f5">
        <strong>${escapeHtml(p.nombre)}</strong>
        <span style="color:#8492a6"> · ${escapeHtml(p.telefono || p.documento || '—')} · ${escapeHtml(p.ciudad || '—')}</span>
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
      avisoCentral({ mensaje: 'Paciente ya existente — seleccionado.', tipo: 'success' });
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
      avisoCentral({ mensaje: 'Cita agendada correctamente.', tipo: 'success' });
      const fechaActual = document.getElementById('filter-fecha').value;
      await Promise.all([
        renderEstadisticas(),
        renderDashboardPaneles(completarCitaHoy, abrirModalCitaDesdeVoz, false, true, true, {
      onCancelarCita: cancelarCitaDesdeAsistente,
      onReprogramarCita: reprogramarCitaDesdeAsistente,
    }),
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
        avisoCentral({
          mensaje: res.error,
          sub: `Próximo horario disponible: ${hora12Display(sugerencia.hora)}`,
          tipo: 'warning',
          accionTexto: 'Usar este horario',
          onAccion: () => {
            setTimePicker('c-hora', sugerencia.hora);
            document.getElementById('c-fecha').value = sugerencia.fecha;
          },
        });
      } else {
        avisoCentral({ mensaje: res.error + ' No hay horarios disponibles ese día.', tipo: 'error' });
      }
    }

    btn.textContent = 'Agendar'; btn.disabled = false;
  });
}

// ══════════════════════════════════════════════════════════
// MODAL CITA DE MOSTRADOR — paciente que llega sin cita previa.
// A diferencia del modal normal, la hora no sale de un select con la
// grilla fija: se calcula con sugerirHorariosMostrador() (huecos entre
// citas ya agendadas + hasta 1h antes/después de la jornada) y se elige
// entre los "chips" resultantes.
// ══════════════════════════════════════════════════════════
let _cmCandidatosActuales  = [];
let _cmHorarioSeleccionado = null;

function abrirModalCitaMostrador() {
  document.getElementById('cm-buscar-pac').value      = '';
  document.getElementById('cm-paciente-id').value     = '';
  document.getElementById('cm-paciente-nombre').value = '';
  document.getElementById('cm-paciente-ciudad').value = '';
  document.getElementById('cm-pac-sugerencias').style.display = 'none';
  document.getElementById('cm-notas').value = '';
  document.getElementById('alert-form-cita-mostrador').innerHTML = '';
  _cmHorarioSeleccionado = null;

  const fechaFiltro = document.getElementById('filter-fecha')?.value || HOY;
  const inputFecha  = document.getElementById('cm-fecha');
  inputFecha.min    = HOY;
  inputFecha.value  = fechaFiltro < HOY ? HOY : fechaFiltro;

  _cargarHorariosMostrador(inputFecha.value);
  inputFecha.onchange = () => _cargarHorariosMostrador(inputFecha.value);

  abrirModal('modal-cita-mostrador');
}

async function _cargarHorariosMostrador(fecha) {
  const cont = document.getElementById('cm-horarios');
  cont.innerHTML = '<div class="empty-state">Cargando horarios...</div>';
  _cmHorarioSeleccionado = null;
  document.getElementById('cm-hora-sel').value = '';

  const candidatos = await sugerirHorariosMostrador(fecha);
  _cmCandidatosActuales = candidatos;

  if (!candidatos.length) {
    cont.innerHTML = '<div class="empty-state">No hay horarios disponibles para citas de mostrador este día.</div>';
    return;
  }

  const conIdx     = candidatos.map((c, idx) => ({ ...c, idx }));
  const extendidos = conIdx.filter(c => c.tipo === 'extendido');
  const huecos      = conIdx.filter(c => c.tipo === 'hueco');

  let html = '';
  if (extendidos.length) {
    html += `<div class="cm-horarios-grupo-label">Fuera de jornada (hasta 1h antes/después)</div>
      <div class="cm-horarios-chips">${extendidos.map(_chipHorarioHtml).join('')}</div>`;
  }
  if (huecos.length) {
    html += `<div class="cm-horarios-grupo-label" style="margin-top:6px">Entre citas ya agendadas</div>
      <div class="cm-horarios-chips">${huecos.map(_chipHorarioHtml).join('')}</div>`;
  }
  cont.innerHTML = html;

  cont.querySelectorAll('[data-idx]').forEach(chip => {
    chip.addEventListener('click', () => {
      cont.querySelectorAll('.cm-horario-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      _cmHorarioSeleccionado = _cmCandidatosActuales[Number(chip.dataset.idx)];
      document.getElementById('cm-hora-sel').value = _cmHorarioSeleccionado.hora;
    });
  });
}

function _chipHorarioHtml(c) {
  return `<button type="button" class="cm-horario-chip" data-idx="${c.idx}">
    ${hora12Display(c.hora)}
    ${c.mueve ? `<span class="cm-horario-chip-mueve">mueve a ${escapeHtml(c.mueve.clienteNombre)} de ${hora12Display(c.mueve.deHora)}</span>` : ''}
  </button>`;
}

function bindFormCitaMostrador() {
  const inputBuscar = document.getElementById('cm-buscar-pac');
  const sugerencias = document.getElementById('cm-pac-sugerencias');

  inputBuscar.addEventListener('input', async () => {
    const q = inputBuscar.value.trim();
    if (q.length < 2) { sugerencias.style.display = 'none'; return; }

    const res = await buscarPacientes(q);
    if (!res.length) {
      sugerencias.innerHTML = `
        <div style="padding:10px 14px;font-size:13px;color:#8492a6">
          No encontrado — regístralo primero en "Pacientes" o desde "+ Agendar cita".
        </div>`;
      sugerencias.style.display = 'block';
      return;
    }

    sugerencias.innerHTML = res.map(p => `
      <div class="sugerencia-item"
        data-id="${escapeHtml(p.id)}" data-nombre="${escapeHtml(p.nombre)}" data-ciudad="${escapeHtml(p.ciudad || '')}"
        style="padding:9px 14px;cursor:pointer;font-size:13px;border-bottom:1px solid #f5f5f5">
        <strong>${escapeHtml(p.nombre)}</strong>
        <span style="color:#8492a6"> · ${escapeHtml(p.telefono || p.documento || '—')} · ${escapeHtml(p.ciudad || '—')}</span>
      </div>`).join('');
    sugerencias.style.display = 'block';

    sugerencias.querySelectorAll('.sugerencia-item').forEach(item => {
      item.addEventListener('click', () => {
        document.getElementById('cm-paciente-id').value     = item.dataset.id;
        document.getElementById('cm-paciente-nombre').value = item.dataset.nombre;
        document.getElementById('cm-paciente-ciudad').value = item.dataset.ciudad || '';
        inputBuscar.value = item.dataset.nombre;
        sugerencias.style.display = 'none';
      });
      item.addEventListener('mouseover', () => { item.style.background = '#f0f7ff'; });
      item.addEventListener('mouseout',  () => { item.style.background = ''; });
    });
  });

  document.getElementById('btn-guardar-cita-mostrador').addEventListener('click', async () => {
    const btn = document.getElementById('btn-guardar-cita-mostrador');
    const pid = document.getElementById('cm-paciente-id').value;
    if (!pid) {
      mostrarAlerta('alert-form-cita-mostrador', 'Selecciona un paciente primero.', 'error');
      return;
    }
    if (!_cmHorarioSeleccionado) {
      mostrarAlerta('alert-form-cita-mostrador', 'Selecciona un horario.', 'error');
      return;
    }

    const fecha     = document.getElementById('cm-fecha').value;
    const candidato = _cmHorarioSeleccionado;

    if (candidato.mueve) {
      const ok = await confirmar({
        titulo: 'Reubicar cita existente',
        mensaje: `Para dejar el espacio parejo, la cita de ${candidato.mueve.clienteNombre} se moverá de las ${hora12Display(candidato.mueve.deHora)} a las ${hora12Display(candidato.mueve.aHora)}. ¿Continuar?`,
        tipo: 'warning',
        textoConfirmar: 'Sí, mover y agendar',
        textoCancelar: 'Cancelar',
      });
      if (!ok) return;
    }

    btn.textContent = 'Agendando...'; btn.disabled = true;

    if (candidato.mueve) {
      const resMover = await reprogramarCita(candidato.mueve.citaId, fecha, candidato.mueve.aHora, usuarioActual?.uid, usuarioActual?.nombre);
      if (!resMover.ok) {
        mostrarAlerta('alert-form-cita-mostrador', resMover.error || 'No se pudo reubicar la cita existente.', 'error');
        btn.textContent = 'Agendar'; btn.disabled = false;
        return;
      }
    }

    const datos = {
      clienteId:     pid,
      clienteNombre: document.getElementById('cm-paciente-nombre').value,
      clienteCiudad: document.getElementById('cm-paciente-ciudad').value,
      usuarioId:     usuarioActual?.uid || '',
      usuarioNombre: usuarioActual?.nombre || '',
      fecha,
      hora:      candidato.hora,
      tipo:      document.getElementById('cm-tipo').value,
      notas:     document.getElementById('cm-notas').value,
      mostrador: true,
    };

    const res = await agendarCita(datos);

    if (res.ok) {
      avisoCentral({ mensaje: 'Cita de mostrador agendada correctamente.', tipo: 'success' });
      const fechaActual = document.getElementById('filter-fecha').value;
      await Promise.all([
        renderEstadisticas(),
        ...(fechaActual ? [cargarSlotsFecha(fechaActual)] : []),
      ]);
      setTimeout(() => cerrarModal('modal-cita-mostrador'), 900);
    } else {
      mostrarAlerta('alert-form-cita-mostrador', res.error || 'No se pudo agendar la cita.', 'error');
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
      toast('Cita reprogramada correctamente.', 'success');
      await cargarSlotsFecha(document.getElementById('filter-fecha').value);
    } else {
      // ── Sugerir próximo horario libre ──────────────────
      const sugerencia = await sugerirHorario(fecha, hora);

      if (sugerencia) {
        avisoCentral({
          mensaje: res.error,
          sub: `Próximo horario disponible: ${hora12Display(sugerencia.hora)}`,
          tipo: 'warning',
          accionTexto: 'Usar este horario',
          onAccion: () => {
            setTimePicker('r-hora', sugerencia.hora);
            document.getElementById('r-fecha').value = sugerencia.fecha;
          },
        });
      } else {
        avisoCentral({ mensaje: res.error + ' No hay horarios disponibles ese día.', tipo: 'error' });
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
      const rFechaEl = document.getElementById('r-fecha');
      rFechaEl.min   = HOY;
      rFechaEl.value = HOY;
      abrirModal('modal-reprogramar');
    },
  });
}

// ══════════════════════════════════════════════════════════
// MODAL DE COBRO — registrar cobro de sesión
// ══════════════════════════════════════════════════════════
// ── Selector de método de pago (efectivo/nequi/daviplata) ──
function _resetMetodoPago(grupoId) {
  document.querySelectorAll(`#${grupoId} .metodo-pago-btn`).forEach(btn =>
    btn.classList.toggle('active', btn.dataset.metodo === 'efectivo'));
}
function _leerMetodoPago(grupoId) {
  return document.querySelector(`#${grupoId} .metodo-pago-btn.active`)?.dataset.metodo || 'efectivo';
}
function _bindMetodoPagoGrupo(grupoId) {
  document.querySelectorAll(`#${grupoId} .metodo-pago-btn`).forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll(`#${grupoId} .metodo-pago-btn`).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

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
  _resetMetodoPago('cobro-metodo-grupo');
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
  _bindMetodoPagoGrupo('cobro-metodo-grupo');

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
        metodoPago:    _leerMetodoPago('cobro-metodo-grupo'),
      }, usuarioActual?.uid, usuarioActual?.nombre);

      cerrarModal('modal-cobro');
      btn.disabled = false;
      btn.textContent = 'Confirmar y completar';
      toast('Cobro enviado. Quedará pendiente hasta que un administrador lo confirme.', 'success');

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

// ══════════════════════════════════════════════════════════
// ASISTENTE IA — cancelar / reprogramar cita existente
// ══════════════════════════════════════════════════════════
async function cancelarCitaDesdeAsistente(cita) {
  const motivo = await pedirMotivoCancelacion();
  if (!motivo) return false;
  const res = await cancelarCita(cita.id, motivo, usuarioActual?.uid, usuarioActual?.nombre);
  if (!res.ok) {
    toast(res.error || 'No se pudo cancelar la cita.', 'error');
    return false;
  }
  toast('Cita cancelada.', 'success');
  await Promise.all([
    renderEstadisticas(),
    renderDashboardPaneles(completarCitaHoy, abrirModalCitaDesdeVoz, false, true, true, {
      onCancelarCita: cancelarCitaDesdeAsistente,
      onReprogramarCita: reprogramarCitaDesdeAsistente,
    }),
  ]);
  const fechaFiltro = document.getElementById('filter-fecha')?.value;
  if (fechaFiltro) await cargarSlotsFecha(fechaFiltro);
  return true;
}

function reprogramarCitaDesdeAsistente(cita, nuevaFecha, nuevaHora) {
  citaReprogramarId = cita.id;
  const rFechaEl = document.getElementById('r-fecha');
  const fechaInicial = (nuevaFecha && nuevaFecha >= HOY) ? nuevaFecha : HOY;
  rFechaEl.min   = HOY;
  rFechaEl.value = fechaInicial;
  if (nuevaHora) setTimePicker('r-hora', nuevaHora);
  abrirModal('modal-reprogramar');
}