// ══════════════════════════════════════════════════════════
// handlers.js — Event listeners, lógica de formularios y navegación
// ACTUALIZADO: geografía Colombia usa api-colombia.com via colombiaService.js
// ══════════════════════════════════════════════════════════

import { auth, db }           from '../../core/firebase.js';
import { protegerPagina }     from '../../core/router.js';
import { initPushNotifications } from '../../core/pushNotifications.js';
import { renderCronograma, autoCompletarCitasViejas } from './cronograma.js';
import { getDocs, collection } from 'firebase/firestore';
import { renderDashboardPaneles, renderGestorPacientes } from './ui.js';
import { renderSemana }       from './semana.js';

import { logout, crearUsuario, getUsuarioPorId,
         ROLES, tienePermiso }                      from '../../core/authService.js';

// ── Pacientes: se elimina DEPARTAMENTOS, se agrega colombiaService ──
import { registrarPaciente, registrarPacienteRapido,
         obtenerPacientes, obtenerPacientesPorCiudad,
         buscarPacientes, filtrarPorCiudad,
         actualizarPaciente, eliminarPaciente,
         obtenerPacientePorId,
         PAISES,
         ubicacionString, parsearUbicacion }         from '../pacientes/pacientesService.js';

import {
  inicializarSelectsUbicacion,
  poblarSelectDepartamentos,
  poblarSelectCiudades,
  restaurarUbicacion,
}                                                    from '../pacientes/colombiaService.js';

import { registrarPago, obtenerPagosHoy, obtenerPagosMes,
         calcularTotalesDia, calcularTotalesMes, calcularTotalesPorMetodo,
         formatCOP, TARIFA_BASE, obtenerConfiguracion,
         obtenerTarifaBaseActual }                                  from '../finanzas/pagosService.js';
import { agendarCita, cancelarCita, reprogramarCita,
         cambiarEstado, sugerirHorario, sugerirHorariosMostrador, ESTADOS, HORARIOS, cargarHorarios,
         generarHorarios, viajeEnFecha,
         obtenerCitasPendientesConfirmacion, confirmarPagoPendiente,
         rechazarPagoPendiente }                                    from '../citas/citasService.js';

import { mostrarAlerta, abrirModal, cerrarModal,
         crearBtn, HOY, MANANA,
         bindSelectPais, pedirMotivoCancelacion }    from '../../shared/helpers.js';
import { confirmar, toast, avisoCentral, initNavGrupos } from '../../shared/interactions.js';
import { initTimePicker, updateTimePicker,
         setTimePicker, hora12Display }              from '../../shared/timePicker.js';
import { renderPerfil, renderEstadisticas, renderCitasHoy,
         renderSlots, renderPacientes, renderPills,
         renderResultadosBusqueda, renderFormEditar,
         renderUsuarios, bindTabsCitas, abrirModalPaciente } from './ui.js';

// ══════════════════════════════════════════════════════════
// ESTADO GLOBAL
// ══════════════════════════════════════════════════════════
let usuarioActual     = null;
let _cobroPendiente   = null;  // cita esperando confirmación de cobro
let pacientesCache    = [];
let citaReprogramarId = null;
let ciudadActivaPills = '';

// Funciones getter para leer la ubicación seleccionada en cada formulario.
// Se asignan cuando los selects son inicializados con la API.
let _getUbicacionPaciente  = () => '';   // modal nuevo paciente
let _getUbicacionRapida    = () => '';   // registro rápido en cita
let _getUbicacionCita      = () => '';   // confirmación ciudad paciente existente

// ══════════════════════════════════════════════════════════
// INIT — punto de entrada único
// ══════════════════════════════════════════════════════════
export async function initDashboard() {
  await cargarHorarios();     // genera los slots según la jornada configurada
  poblarSelectsCiudades();   // ahora async — carga API en paralelo
  poblarSelectsHorarios();
  bindModalCobro();
  bindModalRevisarPendiente();
  bindNavegacion();
  initNavGrupos([
    { id: 'citas',    label: 'Citas',    selectores: ['[data-view="citas"]', '[data-view="cronograma"]', '[data-view="semana"]'] },
    { id: 'finanzas', label: 'Finanzas', selectores: ['[data-view="finanzas"]', '[data-view="informes"]'] },
    { id: 'sistema',  label: 'Sistema',  selectores: ['#menu-usuarios', '[data-view="configuracion"]'] },
  ]);
  bindModalesGlobal();
  bindLogout();
  bindFiltrosFecha();
  bindTabsCitas();
  bindBusquedaPaciente();
  bindEditorPaciente();
  bindEliminarPaciente();
  bindFormPaciente();
  bindFormCita();
  bindFormCitaMostrador();
  document.getElementById('fab-cita-mostrador')?.addEventListener('click', () => abrirModalCitaMostrador());
  bindFormReprogramar();
  bindFormUsuario();
  bindCronograma();
  await initAuth(); // espera los datos para que el splash cubra la carga
  aplicarDeepLink(); // abre una vista concreta si viene en la URL (?view=citas&fecha=...)
}

// Permite enlazar a una vista concreta desde otra página (p. ej. desde
// Sedes: ./dashboard.html?view=citas&fecha=YYYY-MM-DD).
function aplicarDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const view   = params.get('view');
  const fecha  = params.get('fecha');
  if (!view || view === 'dashboard') return;

  if (view === 'citas') {
    const filtro = document.getElementById('filter-fecha');
    if (filtro && fecha) filtro.value = fecha;
  }
  const btn = document.querySelector(`.menu-btn[data-view="${view}"]`);
  if (btn) mostrarVista(view, btn);
}

// ══════════════════════════════════════════════════════════
// SELECTS DE GEOGRAFÍA — ahora usa api-colombia.com
// ══════════════════════════════════════════════════════════
async function poblarSelectsCiudades() {

  // ── 1. Modal nuevo paciente ──────────────────────────────
  const pDpto   = document.getElementById('p-dpto');
  const pCiudad = document.getElementById('p-ciudad');
  if (pDpto && pCiudad) {
    _getUbicacionPaciente = await inicializarSelectsUbicacion(pDpto, pCiudad);
  }

  // ── 2. Registro rápido (modal cita) ─────────────────────
  const qpDpto   = document.getElementById('qp-dpto');
  const qpCiudad = document.getElementById('qp-ciudad');
  if (qpDpto && qpCiudad) {
    _getUbicacionRapida = await inicializarSelectsUbicacion(qpDpto, qpCiudad);
  }

  // ── 3. Filtro buscar pacientes ───────────────────────────
  const filtroDpto   = document.getElementById('pac-dpto-filtro');
  const filtroCiudad = document.getElementById('pac-select-ciudad');
  if (filtroDpto && filtroCiudad) {
    await poblarSelectDepartamentos(filtroDpto, 'Todos los departamentos');
    filtroDpto.addEventListener('change', () => {
      poblarSelectCiudades(filtroDpto, filtroCiudad, 'Todas las ciudades');
    });
    // Opción inicial "todos"
    filtroCiudad.innerHTML = '<option value="">— Todas las ciudades —</option>';
    filtroCiudad.disabled  = false;
  }

  // ── 4. Países (extranjero) — sin cambios ────────────────
  bindSelectPais('p-pais',  PAISES);
  bindSelectPais('qp-pais', PAISES);

  // ── 5. Toggle Colombia / Extranjero — modal nuevo paciente
  document.querySelectorAll('input[name="p-origen"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const esColombia = radio.value === 'colombia';
      document.getElementById('p-origen-colombia').style.display  = esColombia ? 'flex' : 'none';
      document.getElementById('p-origen-extranjero').style.display = esColombia ? 'none' : 'flex';
    });
  });

  // ── 6. Toggle Colombia / Extranjero — registro rápido ───
  document.querySelectorAll('input[name="qp-origen"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const esColombia = radio.value === 'colombia';
      document.getElementById('qp-origen-colombia').style.display  = esColombia ? 'flex' : 'none';
      document.getElementById('qp-origen-extranjero').style.display = esColombia ? 'none' : 'flex';
    });
  });
}

// ══════════════════════════════════════════════════════════
// HORARIOS — sin cambios
// ══════════════════════════════════════════════════════════
function poblarSelectsHorarios() {
  initTimePicker('c-hora', HORARIOS);
  initTimePicker('r-hora', HORARIOS);
}

/** Filtra HORARIOS según la fecha: si es hoy, elimina horas ya pasadas */
function horasDisponibles(fecha) {
  if (fecha !== HOY) return HORARIOS;
  const ahora = new Date();
  const hhmm  = `${String(ahora.getHours()).padStart(2,'0')}:${String(ahora.getMinutes()).padStart(2,'0')}`;
  return HORARIOS.filter(h => h > hhmm);
}

/** Actualiza el time picker según la fecha seleccionada */
function actualizarSelectHoras(selectId, fecha, valorActual = null) {
  updateTimePicker(selectId, horasDisponibles(fecha), valorActual);
}

// ══════════════════════════════════════════════════════════
// AUTH — sin cambios
// ══════════════════════════════════════════════════════════
async function initAuth() {
  usuarioActual = await protegerPagina('Administrador');
  renderPerfil(usuarioActual);
  initPushNotifications(usuarioActual);

  if (!tienePermiso(usuarioActual, [ROLES.ADMINISTRADOR])) {
    document.getElementById('menu-usuarios').style.display = 'none';
  }

  await Promise.all([
    autoCompletarCitasViejas(),
    renderEstadisticas(),
    renderDashboardPaneles(
      completarCitaHoy,
      abrirModalCitaDesdeVoz,
      true,
      true,
      true,
      { onCancelarCita: cancelarCitaDesdeAsistente, onReprogramarCita: reprogramarCitaDesdeAsistente }
    ),
    cargarPacientesCache(),
    obtenerConfiguracion(),
  ]);

  // No se espera: que aparezca un instante después de revelar el dashboard
  // se siente más natural que bloquear el splash por esta consulta extra.
  revisarPendientesDashboard();
}

async function completarCitaHoy(citaId) {
  // btn-completar-foco es el único botón "Completar" del panel de cita
  // en curso del dashboard — su tarjeta es .dash-cita-card (ver ui.js).
  const card = document.getElementById('btn-completar-foco')?.closest('.dash-cita-card');
  abrirModalCobro({
    citaId,
    clienteId:     card?.dataset?.clienteId     || '',
    clienteNombre: card?.querySelector('.dash-cita-nombre')?.textContent?.trim() || '',
    clienteCiudad: card?.dataset?.clienteCiudad || '',
    hora:          card?.dataset?.hora || '',
    tipoSesion:    card?.dataset?.tipoSesion || 'Ajuste general',
    onConfirmar: async () => {
      await Promise.all([
        renderDashboardPaneles(completarCitaHoy, abrirModalCitaDesdeVoz, true, true, true, {
          onCancelarCita: cancelarCitaDesdeAsistente,
          onReprogramarCita: reprogramarCitaDesdeAsistente,
        }),
        renderEstadisticas(),
      ]);
    }
  });
}

// ══════════════════════════════════════════════════════════
// NAVEGACIÓN — sin cambios
// ══════════════════════════════════════════════════════════
function bindNavegacion() {
  document.querySelectorAll('.menu-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => mostrarVista(btn.dataset.view, btn));
  });
}

const btnToggle = document.getElementById('btn-toggle');
const sidebar   = document.getElementById('sidebar');

btnToggle.addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
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
    dashboard:   ['Quiromasajes',          'Resumen del día'],
    pacientes:   ['Gestión de pacientes',  'Código 009 — Registro, búsqueda y filtro por ciudad'],
    citas:       ['Gestión de citas',      'Código 002 — Agenda de horarios'],
    cronograma:  ['Cronograma del día',    'Citas de hoy por estado y hora'],
    semana:      ['Semana',                'Ocupación del mes y la semana'],
    usuarios:    ['Usuarios del sistema',  'Código 001 — Control de acceso'],
    configuracion: ['Configuración',       'Ajustes del sistema'],
    finanzas:      ['Finanzas',              'Ingresos, cobros y control del día'],
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
      renderDashboardPaneles(completarCitaHoy, abrirModalCitaDesdeVoz, true, true, true, {
          onCancelarCita: cancelarCitaDesdeAsistente,
          onReprogramarCita: reprogramarCitaDesdeAsistente,
        }),
    ]);
    revisarPendientesDashboard();
  }

 if (vista === 'pacientes') {
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
      esAdmin: true,
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

  if (vista === 'finanzas') {
    await renderVistaFinanzas();
  }

  if (vista === 'usuarios' && tienePermiso(usuarioActual, [ROLES.ADMINISTRADOR])) {
    actions.appendChild(crearBtn('+ Nuevo usuario', () => abrirModal('modal-usuario')));
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
// SLOTS DE CITAS — sin cambios
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
  // Si la fecha cae en un viaje, el admin agenda en la sede destino con el
  // horario del viaje (banner morado). Los demás roles la ven bloqueada.
  const viaje = await viajeEnFecha(fecha);
  const opcionesViaje = viaje
    ? {
        horarios: generarHorarios(viaje.horaInicio, viaje.horaFin),
        banner:   `📍 Atendiendo en ${viaje.ciudadFull} (viaje · ${hora12Display(viaje.horaInicio)} a ${hora12Display(viaje.horaFin)}). Las citas que agendes aquí quedan en esta sede.`,
      }
    : {};

  await renderSlots(fecha, {
    ...opcionesViaje,
    onAgendar:   (hora, fecha) => abrirModalCita(hora, fecha),
     onCompletar: async (id, f) => {
       const slot = document.querySelector(`[data-completar="${id}"]`)?.closest('.slot-row');
       abrirModalCobro({
         citaId:        id,
         clienteId:     slot?.dataset?.clienteId     || '',
         clienteNombre: slot?.querySelector('.slot-name')?.textContent?.trim() || '',
         clienteCiudad: slot?.dataset?.clienteCiudad || '',
         hora:          slot?.dataset?.hora || '',
         tipoSesion:    slot?.dataset?.tipoSesion || 'Ajuste general',
        onConfirmar:   async () => {
          await Promise.all([cargarSlotsFecha(f), renderEstadisticas()]);
        }
      });
    },
    onReprogramar: (id, f) => {
      citaReprogramarId = id;
      document.getElementById('r-fecha').value = f;
      abrirModal('modal-reprogramar');
    },
    onCancelar: async (id, f) => {
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
// PACIENTES — sin cambios en lógica, solo ubicación actualizada
// ══════════════════════════════════════════════════════════
let pacEditando = null;

async function cargarPacientesCache() {
  pacientesCache = await obtenerPacientes();
}

function activarTabPaciente(tab) {
  ['tab-pac-buscar','tab-pac-editar','tab-pac-eliminar'].forEach(t => {
    document.getElementById(t)?.classList.toggle('pac-tab-active', t === tab);
  });
  ['sec-pac-buscar','sec-pac-editar','sec-pac-eliminar'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = s === tab.replace('tab-','sec-') ? 'block' : 'none';
  });
}

// ── TAB 1: BUSCAR ─────────────────────────────────────────
function bindBusquedaPaciente() {
  // Cuando cambia la ciudad en el filtro
  document.getElementById('pac-select-ciudad')?.addEventListener('change', async (e) => {
    // Obtener el nombre del departamento seleccionado para construir el filtro
    const filtroDpto   = document.getElementById('pac-dpto-filtro');
    const deptoNombre  = filtroDpto?.selectedOptions[0]?.dataset?.nombre || '';
    const ciudadVal    = e.target.value;

    // Buscar con formato "Depto > Ciudad" o solo ciudad para legacy
    const filtro = deptoNombre && ciudadVal
      ? `${deptoNombre} > ${ciudadVal}`
      : ciudadVal;

    const { pacientes, hayMas, total } = await obtenerPacientesPorCiudad(filtro, 50);
    renderPacientes(pacientes);
    const btnTodos = document.getElementById('btn-pac-mostrar-todos');
    const contInfo = document.getElementById('pac-count-info');
    if (contInfo) contInfo.textContent = `Mostrando ${pacientes.length} de ${total} pacientes`;
    if (btnTodos) btnTodos.style.display = hayMas ? 'inline-block' : 'none';
  });

  // Botón mostrar todos
  document.getElementById('btn-pac-mostrar-todos')?.addEventListener('click', async () => {
    const filtroDpto  = document.getElementById('pac-dpto-filtro');
    const filtroCiud  = document.getElementById('pac-select-ciudad');
    const deptoNombre = filtroDpto?.selectedOptions[0]?.dataset?.nombre || '';
    const ciudadVal   = filtroCiud?.value || '';
    const filtro = deptoNombre && ciudadVal ? `${deptoNombre} > ${ciudadVal}` : ciudadVal;
    const { pacientes, total } = await obtenerPacientesPorCiudad(filtro, 9999);
    renderPacientes(pacientes);
    const contInfo = document.getElementById('pac-count-info');
    if (contInfo) contInfo.textContent = `Mostrando todos: ${total} pacientes`;
    document.getElementById('btn-pac-mostrar-todos').style.display = 'none';
  });

  // Búsqueda rápida por nombre/tel
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

// ── TAB 2: EDITAR ─────────────────────────────────────────
function bindEditorPaciente() {
  document.getElementById('search-pac-editar')?.addEventListener('input', async (e) => {
    const q = e.target.value.trim();
    const cont = document.getElementById('resultados-editar');
    if (!cont) return;
    if (q.length < 2) { cont.innerHTML = ''; return; }
    const lista = await buscarPacientes(q);
    renderResultadosBusqueda('resultados-editar', lista,
      async (paciente) => {
        pacEditando = paciente;
        renderFormEditar(paciente);
        // Restaurar selects de ubicación con el valor guardado en Firebase
        await restaurarUbicacion(
          document.getElementById('edit-dpto'),
          document.getElementById('edit-ciudad'),
          paciente.ciudad
        );
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

    // Leer ubicación desde los nuevos selects del form de edición
    const editDpto   = document.getElementById('edit-dpto');
    const editCiudad = document.getElementById('edit-ciudad');
    let ciudadEditada = pacEditando.ciudad; // valor actual por defecto

    if (editDpto && editCiudad) {
      const deptoNombre = editDpto.selectedOptions[0]?.dataset?.nombre || '';
      const ciudad      = editCiudad.value;
      if (deptoNombre && ciudad) ciudadEditada = `${deptoNombre} > ${ciudad}`;
      else if (ciudad)           ciudadEditada = ciudad;
    }

    const datos = {
      nombre:          document.getElementById('edit-nombre')?.value.trim(),
      documento:       document.getElementById('edit-documento')?.value.trim(),
      email:           document.getElementById('edit-email')?.value.trim(),
      ciudad:          ciudadEditada,
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

// ── TAB 3: ELIMINAR ───────────────────────────────────────
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
        const ok = await confirmar({
          titulo: 'Eliminar paciente',
          mensaje: `¿Eliminar permanentemente a "${paciente.nombre}" (Tel: ${paciente.telefono || '—'})?\nEsta acción no se puede deshacer.`,
          tipo: 'danger',
          textoConfirmar: 'Eliminar',
        });
        if (!ok) return;
        const res = await eliminarPaciente(paciente.id);
        if (res.ok) {
          toast(`Paciente "${paciente.nombre}" eliminado.`, 'success');
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

    // Leer ubicación — ahora desde _getUbicacionPaciente (api-colombia)
    const origenColombia = document.querySelector('input[name="p-origen"]:checked')?.value === 'colombia';
    const ciudad = origenColombia
      ? _getUbicacionPaciente()                          // "Boyacá > Tunja"
      : (document.getElementById('p-pais')?.value || '');

    const datos = {
      nombre:          document.getElementById('p-nombre').value.trim(),
      telefono:        document.getElementById('p-tel').value.trim(),
      documento:       document.getElementById('p-doc').value.trim(),
      email:           document.getElementById('p-email').value.trim(),
      condicion:       document.getElementById('p-condicion').value.trim(),
      ciudad,
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
        document.getElementById('p-dpto').value  = '';
        document.getElementById('p-ciudad').value = '';
        document.getElementById('p-pais').value  = '';
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
function abrirModalCita(horaPreseleccionada = null, fechaPreseleccionada = null) {
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

  const fechaFiltro = document.getElementById('filter-fecha')?.value || HOY;
  const fechaFinal  = fechaPreseleccionada || fechaFiltro;

  const inputFecha = document.getElementById('c-fecha');
  inputFecha.min   = HOY;
  inputFecha.value = fechaFinal < HOY ? HOY : fechaFinal;

  actualizarSelectHoras('c-hora', inputFecha.value, horaPreseleccionada);
  inputFecha.onchange = () => actualizarSelectHoras('c-hora', inputFecha.value);

  abrirModal('modal-cita');
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
    ${c.mueve ? `<span class="cm-horario-chip-mueve">mueve a ${c.mueve.clienteNombre} de ${hora12Display(c.mueve.deHora)}</span>` : ''}
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
        data-id="${p.id}" data-nombre="${p.nombre}" data-ciudad="${p.ciudad || ''}"
        style="padding:9px 14px;cursor:pointer;font-size:13px;border-bottom:1px solid #f5f5f5">
        <strong>${p.nombre}</strong>
        <span style="color:#8492a6"> · ${p.telefono || p.documento || '—'} · ${p.ciudad || '—'}</span>
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

    const fecha      = document.getElementById('cm-fecha').value;
    const candidato  = _cmHorarioSeleccionado;

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

// ══════════════════════════════════════════════════════════
// MODAL DE COBRO
// ══════════════════════════════════════════════════════════
// ── Selector de método de pago (efectivo/nequi/daviplata) — se reutiliza
// igual en el modal de cobro directo y en el de revisar pendientes. ──
function _resetMetodoPago(grupoId) {
  document.querySelectorAll(`#${grupoId} .metodo-pago-btn`).forEach(btn =>
    btn.classList.toggle('active', btn.dataset.metodo === 'efectivo'));
}
function _leerMetodoPago(grupoId) {
  return document.querySelector(`#${grupoId} .metodo-pago-btn.active`)?.dataset.metodo || 'efectivo';
}
function _labelMetodoPago(metodo) {
  return { efectivo: 'Efectivo', nequi: 'Nequi', daviplata: 'Daviplata' }[metodo] || 'Efectivo';
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
                onclick="this.closest('div').remove();window.actualizarResumenCobro()">✕</button>`;
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
      await cambiarEstado(
        _cobroPendiente.citaId, ESTADOS.COMPLETADA,
        usuarioActual?.uid, usuarioActual?.nombre,
        `Pago confirmado: ${formatCOP(totalCobrado)}`
      );

      const resPago = await registrarPago({
        citaId:        _cobroPendiente.citaId,
        clienteId:     _cobroPendiente.clienteId,
        clienteNombre: _cobroPendiente.clienteNombre,
        clienteCiudad: _cobroPendiente.clienteCiudad,
        fecha:         HOY,
        hora:          _cobroPendiente.hora,
        tipoSesion:    _cobroPendiente.tipoSesion,
        tarifaBase:    tarifa,
        medicamentos,
        metodoPago:    _leerMetodoPago('cobro-metodo-grupo'),
        usuarioId:     usuarioActual?.uid,
      });

      cerrarModal('modal-cobro');
      btn.disabled = false;
      btn.textContent = 'Confirmar y completar';

      if (resPago.ok) {
        toast(`Cobro registrado: ${formatCOP(resPago.totalCobrado)}`, 'success');
      }

      await _cobroPendiente.onConfirmar?.();
      _cobroPendiente = null;
    });
}

window.actualizarResumenCobro = actualizarResumenCobro;

// ══════════════════════════════════════════════════════════
// REVISIÓN DE COBROS PENDIENTES (enviados por secretaria/call-center)
// Se muestra automáticamente cada vez que el admin entra al dashboard,
// y también se puede abrir manualmente desde Finanzas → Pendientes.
// ══════════════════════════════════════════════════════════
let _colaPendientes    = [];   // citas pendientes por revisar en esta sesión
let _colaTotalInicial  = 0;    // tamaño de la cola al abrirse, para el contador "X de Y"
let _revisionActual    = null; // cita que se está mostrando en el modal
let _onRevisionResuelta = null; // callback tras aprobar/rechazar

async function revisarPendientesDashboard() {
  // No interrumpir una revisión que ya está en curso (p. ej. si el admin
  // vuelve a hacer clic en "Dashboard" mientras el modal sigue abierto).
  if (document.getElementById('modal-revisar-pendiente')?.classList.contains('open')) return;

  const pendientes = await obtenerCitasPendientesConfirmacion();
  if (!pendientes.length) return;
  _colaPendientes   = pendientes;
  _colaTotalInicial = pendientes.length;
  mostrarSiguientePendienteEnCola();
}

function mostrarSiguientePendienteEnCola() {
  if (!_colaPendientes.length) return;
  const revisadas = _colaTotalInicial - _colaPendientes.length;
  abrirRevisionPendiente(_colaPendientes[0], {
    contador: _colaTotalInicial > 1 ? `${revisadas + 1} de ${_colaTotalInicial}` : null,
    onResuelto: () => {
      _colaPendientes.shift();
      if (_colaPendientes.length) setTimeout(mostrarSiguientePendienteEnCola, 350);
    },
  });
}

function abrirRevisionPendiente(cita, { contador = null, onResuelto = null } = {}) {
  _revisionActual     = cita;
  _onRevisionResuelta = onResuelto;
  const p = cita.pagoPendiente || {};

  const contadorEl = document.getElementById('rp-contador');
  contadorEl.style.display = contador ? 'inline-block' : 'none';
  contadorEl.textContent   = contador || '';

  document.getElementById('rp-cliente-nombre').textContent = cita.clienteNombre || 'Paciente';
  document.getElementById('rp-meta').textContent = `${cita.fecha} · ${hora12Display(cita.hora)} · ${cita.tipo || p.tipoSesion || 'Ajuste general'}`;
  document.getElementById('rp-enviado-por').textContent = p.enviadoPorNombre || '—';
  document.getElementById('rp-metodo-pago').textContent = _labelMetodoPago(p.metodoPago);
  document.getElementById('rp-tipo-display').value = p.tipoSesion || cita.tipo || 'Ajuste general';
  document.getElementById('rp-tarifa').value = p.tarifaBase ?? 0;
  document.getElementById('alert-rp').innerHTML = '';
  renderMedsPendienteForm(p.medicamentos || []);
  actualizarResumenPendiente();
  abrirModal('modal-revisar-pendiente');
}

function renderMedsPendienteForm(medicamentos) {
  const lista = document.getElementById('rp-meds-lista');
  lista.innerHTML = '';
  medicamentos.forEach(m => agregarFilaMedPendiente(m.nombre, m.precio));
}

function agregarFilaMedPendiente(nombre = '', precio = '') {
  const lista = document.getElementById('rp-meds-lista');
  const fila  = document.createElement('div');
  fila.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:6px';
  fila.innerHTML = `
    <input class="input-text rp-med-nombre" placeholder="Nombre del ítem" style="flex:2" type="text"/>
    <input class="input-text rp-med-precio" placeholder="Precio $" style="flex:1" type="number" min="0"/>
    <button class="btn btn-danger btn-sm" type="button" style="padding:4px 8px">✕</button>`;
  fila.querySelector('.rp-med-nombre').value  = nombre;
  fila.querySelector('.rp-med-precio').value  = precio;
  fila.querySelector('.rp-med-precio').addEventListener('input', actualizarResumenPendiente);
  fila.querySelector('.rp-med-nombre').addEventListener('input', actualizarResumenPendiente);
  fila.querySelector('button').addEventListener('click', () => { fila.remove(); actualizarResumenPendiente(); });
  lista.appendChild(fila);
}

function leerMedsPendienteForm() {
  const medicamentos = [];
  document.querySelectorAll('#rp-meds-lista > div').forEach(fila => {
    const nombre = fila.querySelector('.rp-med-nombre')?.value?.trim();
    const precio = Number(fila.querySelector('.rp-med-precio')?.value) || 0;
    if (nombre) medicamentos.push({ nombre, precio });
  });
  return medicamentos;
}

function actualizarResumenPendiente() {
  if (!_revisionActual) return;
  const tarifa       = Number(document.getElementById('rp-tarifa')?.value) || 0;
  const medicamentos = leerMedsPendienteForm();
  const totalMeds    = medicamentos.reduce((s, m) => s + (m.precio || 0), 0);
  const total        = tarifa + totalMeds;

  document.getElementById('rp-resumen-tarifa').textContent = formatCOP(tarifa);
  document.getElementById('rp-resumen-meds').textContent   = formatCOP(totalMeds);
  document.getElementById('rp-resumen-total').textContent  = formatCOP(total);

  const original = _revisionActual.pagoPendiente || {};
  const seModifico = total !== (original.totalCobrado ?? 0);
  document.getElementById('rp-aviso-editado').style.display = seModifico ? 'block' : 'none';
}

function bindModalRevisarPendiente() {
  document.getElementById('rp-tarifa')?.addEventListener('input', actualizarResumenPendiente);
  document.getElementById('btn-rp-add-med')?.addEventListener('click', () => agregarFilaMedPendiente());

  document.getElementById('btn-rp-aprobar')?.addEventListener('click', async () => {
    if (!_revisionActual) return;
    const btn = document.getElementById('btn-rp-aprobar');
    btn.disabled = true; btn.textContent = 'Procesando...';

    const tarifaBase   = Number(document.getElementById('rp-tarifa').value) || 0;
    const medicamentos = leerMedsPendienteForm();
    const totalCobrado = tarifaBase + medicamentos.reduce((s, m) => s + (m.precio || 0), 0);
    const original      = _revisionActual.pagoPendiente || {};
    const fueEditado    = totalCobrado !== (original.totalCobrado ?? 0);

    const res = await confirmarPagoPendiente(
      _revisionActual.id, usuarioActual?.uid, usuarioActual?.nombre,
      fueEditado ? { tarifaBase, medicamentos, totalCobrado } : null
    );

    btn.disabled = false; btn.textContent = 'Aprobar cobro';

    if (!res.ok) {
      mostrarAlerta('alert-rp', res.error, 'error');
      return;
    }

    await registrarPago({ ...res.pagoPendiente, usuarioId: usuarioActual?.uid });
    cerrarModal('modal-revisar-pendiente');
    toast(fueEditado
      ? `Cobro aprobado con el valor editado: ${formatCOP(totalCobrado)}`
      : `Cobro aprobado: ${formatCOP(totalCobrado)}`, 'success');

    await Promise.all([renderEstadisticas(), renderVistaFinanzas()]);
    _onRevisionResuelta?.();
    _revisionActual = null;
  });

  document.getElementById('btn-rp-rechazar')?.addEventListener('click', async () => {
    if (!_revisionActual) return;
    const motivo = await pedirMotivoCancelacion();
    if (!motivo) return;

    const btn = document.getElementById('btn-rp-rechazar');
    btn.disabled = true; btn.textContent = 'Rechazando...';
    const res = await rechazarPagoPendiente(_revisionActual.id, motivo, usuarioActual?.uid, usuarioActual?.nombre);
    btn.disabled = false; btn.textContent = 'Rechazar';

    if (!res.ok) {
      mostrarAlerta('alert-rp', res.error, 'error');
      return;
    }

    cerrarModal('modal-revisar-pendiente');
    toast('Cobro rechazado. La cita vuelve a estar activa.', 'success');
    await Promise.all([renderEstadisticas(), renderVistaFinanzas()]);
    _onRevisionResuelta?.();
    _revisionActual = null;
  });
}

// ══════════════════════════════════════════════════════════
// VISTA FINANZAS
// ══════════════════════════════════════════════════════════
async function renderVistaFinanzas() {
  const mes = HOY.slice(0, 7);

  const [pagosHoy, pagosMes] = await Promise.all([
    obtenerPagosHoy(HOY),
    obtenerPagosMes(mes),
  ]);

  const { obtenerCitasPorFecha } = await import('../citas/citasService.js');
  const citasHoy   = await obtenerCitasPorFecha(HOY);
  const canceladas = citasHoy.filter(c => c.estado === ESTADOS.CANCELADA);

  const totDia    = calcularTotalesDia(pagosHoy);
  const totMes    = calcularTotalesMes(pagosMes);
  const totMetodo = calcularTotalesPorMetodo(pagosHoy);

  // ── KPIs ──────────────────────────────────────────────
  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('fin-total-dia',      formatCOP(totDia.total));
  setEl('fin-sub-sesiones',   `${totDia.cantidad} sesión${totDia.cantidad !== 1 ? 'es' : ''}`);
  setEl('fin-total-mes',      formatCOP(totMes.total));
  setEl('fin-sub-mes',        `${totMes.cantidad} sesiones este mes`);
  setEl('fin-meds-dia',       formatCOP(totDia.soloMeds));
  setEl('fin-canceladas-dia', String(canceladas.length));

  setEl('fin-metodo-efectivo',  formatCOP(totMetodo.efectivo));
  setEl('fin-metodo-nequi',     formatCOP(totMetodo.nequi));
  setEl('fin-metodo-daviplata', formatCOP(totMetodo.daviplata));

  const fechaFmt = new Date(HOY + 'T12:00:00').toLocaleDateString('es-CO', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  setEl('fin-fecha-desprendible', fechaFmt);

  // ── Tabla del día ─────────────────────────────────────
  const tablaDia = document.getElementById('fin-tabla-dia');
  if (tablaDia) {
    if (!pagosHoy.length) {
      tablaDia.innerHTML = '<div class="empty-state">No hay cobros registrados hoy</div>';
    } else {
      tablaDia.innerHTML = `
        <table style="width:100%;min-width:540px;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:var(--bg-secondary)">
              <th style="padding:8px 12px;text-align:left;color:var(--text-muted);font-weight:600">Hora</th>
              <th style="padding:8px 12px;text-align:left;color:var(--text-muted);font-weight:600">Paciente</th>
              <th style="padding:8px 12px;text-align:left;color:var(--text-muted);font-weight:600">Tipo sesión</th>
              <th style="padding:8px 12px;text-align:right;color:var(--text-muted);font-weight:600">Tarifa</th>
              <th style="padding:8px 12px;text-align:right;color:var(--text-muted);font-weight:600">Adicionales</th>
              <th style="padding:8px 12px;text-align:right;color:var(--text-muted);font-weight:600">Total</th>
            </tr>
          </thead>
          <tbody>
            ${pagosHoy.map((p, i) => `
              <tr style="border-bottom:1px solid var(--border);background:${p.modificadoPorAdmin ? 'var(--warning-soft)' : (i%2===0?'transparent':'var(--bg-secondary)')}">
                <td style="padding:8px 12px;color:var(--text-muted)">${p.hora}</td>
                <td style="padding:8px 12px;font-weight:500">${p.clienteNombre}</td>
                <td style="padding:8px 12px;color:var(--text-muted)">${p.tipoSesion}</td>
                <td style="padding:8px 12px;text-align:right">${formatCOP(p.tarifaBase)}</td>
                <td style="padding:8px 12px;text-align:right;color:${p.totalMedicamentos>0?'var(--color-green)':'var(--text-muted)'}">
                  ${p.totalMedicamentos>0 ? formatCOP(p.totalMedicamentos) : '—'}</td>
                <td style="padding:8px 12px;text-align:right;font-weight:700;color:${p.modificadoPorAdmin ? 'var(--warning)' : 'var(--color-green)'}">
                  ${formatCOP(p.totalCobrado)}
                  ${p.modificadoPorAdmin ? `<span class="badge badge-warning qm-badge-editado" style="margin-left:6px;font-weight:600" title="Original: ${formatCOP(p.totalOriginal ?? 0)}">✎ Editado</span>` : ''}
                </td>
              </tr>`).join('')}
          </tbody>
          <tfoot>
            <tr style="background:var(--bg-secondary);font-weight:700;border-top:2px solid var(--border)">
              <td colspan="3" style="padding:10px 12px;font-size:13px">TOTAL DÍA · ${totDia.cantidad} sesiones</td>
              <td style="padding:10px 12px;text-align:right">${formatCOP(totDia.soloSesiones)}</td>
              <td style="padding:10px 12px;text-align:right">${formatCOP(totDia.soloMeds)}</td>
              <td style="padding:10px 12px;text-align:right;color:var(--color-green);font-size:15px">${formatCOP(totDia.total)}</td>
            </tr>
          </tfoot>
        </table>`;
    }
  }

  // ── Tabla canceladas ──────────────────────────────────
  const tablaCanceladas = document.getElementById('fin-tabla-canceladas');
  if (tablaCanceladas) {
    if (!canceladas.length) {
      tablaCanceladas.innerHTML = '<div class="empty-state" style="color:var(--color-green)">✓ Sin cancelaciones hoy</div>';
    } else {
      tablaCanceladas.innerHTML = `
        <table style="width:100%;min-width:380px;border-collapse:collapse;font-size:13px">
          <thead>
            <tr style="background:#fff5f5">
              <th style="padding:8px 12px;text-align:left;color:#c0392b;font-weight:600">Hora</th>
              <th style="padding:8px 12px;text-align:left;color:#c0392b;font-weight:600">Paciente</th>
              <th style="padding:8px 12px;text-align:left;color:#c0392b;font-weight:600">Ciudad</th>
              <th style="padding:8px 12px;text-align:left;color:#c0392b;font-weight:600">Tipo sesión</th>
            </tr>
          </thead>
          <tbody>
            ${canceladas.map(c => `
              <tr style="border-bottom:1px solid #fde8e8">
                <td style="padding:8px 12px">${c.hora}</td>
                <td style="padding:8px 12px;font-weight:500">${c.clienteNombre}</td>
                <td style="padding:8px 12px;color:var(--text-muted)">${c.clienteCiudad||'—'}</td>
                <td style="padding:8px 12px;color:var(--text-muted)">${c.tipo}</td>
              </tr>`).join('')}
          </tbody>
        </table>`;
    }
  }

  // ── Pendientes por confirmar (cobros enviados por secretaria) ──
  await renderTablaPendientesConfirmacion();

  // Guardar datos para el botón imprimir (se actualiza cada vez que se carga la vista)
  window.__finanzasDia__ = { pagosHoy, canceladas, totDia, fechaFmt };
}

async function renderTablaPendientesConfirmacion() {
  const tabla = document.getElementById('fin-tabla-pendientes');
  if (!tabla) return;

  const pendientes = await obtenerCitasPendientesConfirmacion();

  if (!pendientes.length) {
    tabla.innerHTML = '<div class="empty-state" style="color:var(--color-green)">✓ No hay cobros pendientes de confirmación</div>';
    return;
  }

  tabla.innerHTML = `
    <table style="width:100%;min-width:560px;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#fffbf0">
          <th style="padding:8px 12px;text-align:left;color:#946a00;font-weight:600">Fecha/Hora</th>
          <th style="padding:8px 12px;text-align:left;color:#946a00;font-weight:600">Paciente</th>
          <th style="padding:8px 12px;text-align:left;color:#946a00;font-weight:600">Enviado por</th>
          <th style="padding:8px 12px;text-align:right;color:#946a00;font-weight:600">Total</th>
          <th style="padding:8px 12px;text-align:right;color:#946a00;font-weight:600">Acción</th>
        </tr>
      </thead>
      <tbody>
        ${pendientes.map(c => `
          <tr style="border-bottom:1px solid #fff0d6">
            <td style="padding:8px 12px;color:var(--text-muted)">${c.fecha} ${c.hora}</td>
            <td style="padding:8px 12px;font-weight:500">${c.clienteNombre}</td>
            <td style="padding:8px 12px;color:var(--text-muted)">${c.pagoPendiente?.enviadoPorNombre || '—'}</td>
            <td style="padding:8px 12px;text-align:right;font-weight:700">${formatCOP(c.pagoPendiente?.totalCobrado || 0)}</td>
            <td style="padding:8px 12px;text-align:right">
              <button class="btn btn-soft btn-sm" data-revisar-pago="${c.id}">🔍 Revisar</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  tabla.querySelectorAll('[data-revisar-pago]').forEach(btn => {
    btn.addEventListener('click', () => {
      const cita = pendientes.find(c => c.id === btn.dataset.revisarPago);
      if (cita) abrirRevisionPendiente(cita);
    });
  });
}

// ── Desprendible empresarial para impresión / PDF ─────────
function imprimirDesprendible(pagosHoy, canceladas, totDia, fechaFmt) {
  const ahora   = new Date();
  const horaImp = ahora.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  const usuNom  = document.getElementById('sidebar-nombre')?.textContent?.trim() || 'Administrador';

  const desprendible = document.getElementById('print-desprendible');
  if (!desprendible) return;

  desprendible.innerHTML = `
    <div style="font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:32px 40px;color:#111">

      <!-- Encabezado empresarial -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0A76D8;padding-bottom:16px;margin-bottom:20px">
        <div>
          <div style="font-size:22px;font-weight:700;color:#0A76D8;letter-spacing:-0.5px">Quiromasajes E.F</div>
          <div style="font-size:12px;color:#555;margin-top:3px">Santa Rosa de Viterbo, Boyacá — Colombia</div>
          <div style="font-size:12px;color:#555">NIT / Registro clínica quiropráctica</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:13px;font-weight:600;color:#333">DESPRENDIBLE FINANCIERO</div>
          <div style="font-size:12px;color:#555;margin-top:4px">${fechaFmt}</div>
          <div style="font-size:11px;color:#888;margin-top:2px">Impreso: ${horaImp} · por ${usuNom}</div>
        </div>
      </div>

      <!-- KPIs resumen -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px">
        <div style="background:#f0f9f0;border:1px solid #c3e6c3;border-radius:6px;padding:12px 16px;text-align:center">
          <div style="font-size:18px;font-weight:700;color:#1a7a47">${formatCOP(totDia.total)}</div>
          <div style="font-size:11px;color:#555;margin-top:3px">TOTAL INGRESOS DÍA</div>
        </div>
        <div style="background:#f0f4ff;border:1px solid #c3d0f5;border-radius:6px;padding:12px 16px;text-align:center">
          <div style="font-size:18px;font-weight:700;color:#0A76D8">${totDia.cantidad}</div>
          <div style="font-size:11px;color:#555;margin-top:3px">SESIONES ATENDIDAS</div>
        </div>
        <div style="background:#fff8f0;border:1px solid #f5d9b0;border-radius:6px;padding:12px 16px;text-align:center">
          <div style="font-size:18px;font-weight:700;color:#e67e22">${formatCOP(totDia.soloMeds)}</div>
          <div style="font-size:11px;color:#555;margin-top:3px">ADICIONALES / MEDICAMENTOS</div>
        </div>
      </div>

      <!-- Tabla de sesiones -->
      <div style="margin-bottom:24px">
        <div style="font-size:13px;font-weight:700;color:#333;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">
          Detalle de sesiones atendidas
        </div>
        ${pagosHoy.length === 0
          ? '<div style="font-size:12px;color:#888;padding:12px 0">Sin sesiones registradas hoy</div>'
          : `<table style="width:100%;border-collapse:collapse;font-size:12px">
              <thead>
                <tr style="background:#f5f7fa;border-bottom:2px solid #0A76D8">
                  <th style="padding:7px 10px;text-align:left;font-weight:600">Hora</th>
                  <th style="padding:7px 10px;text-align:left;font-weight:600">Paciente</th>
                  <th style="padding:7px 10px;text-align:left;font-weight:600">Tipo de sesión</th>
                  <th style="padding:7px 10px;text-align:right;font-weight:600">Tarifa</th>
                  <th style="padding:7px 10px;text-align:right;font-weight:600">Adicionales</th>
                  <th style="padding:7px 10px;text-align:right;font-weight:600">Total</th>
                </tr>
              </thead>
              <tbody>
                ${pagosHoy.map((p, i) => `
                  <tr style="border-bottom:1px solid #eee;background:${i%2===0?'#fff':'#fafbfc'}">
                    <td style="padding:6px 10px">${p.hora}</td>
                    <td style="padding:6px 10px;font-weight:500">${p.clienteNombre}</td>
                    <td style="padding:6px 10px;color:#555">${p.tipoSesion}</td>
                    <td style="padding:6px 10px;text-align:right">${formatCOP(p.tarifaBase)}</td>
                    <td style="padding:6px 10px;text-align:right;color:${p.totalMedicamentos>0?'#1a7a47':'#aaa'}">
                      ${p.totalMedicamentos>0 ? formatCOP(p.totalMedicamentos) : '—'}</td>
                    <td style="padding:6px 10px;text-align:right;font-weight:700">${formatCOP(p.totalCobrado)}</td>
                  </tr>`).join('')}
              </tbody>
              <tfoot>
                <tr style="background:#f5f7fa;font-weight:700;border-top:2px solid #0A76D8">
                  <td colspan="3" style="padding:8px 10px">TOTAL</td>
                  <td style="padding:8px 10px;text-align:right">${formatCOP(totDia.soloSesiones)}</td>
                  <td style="padding:8px 10px;text-align:right">${formatCOP(totDia.soloMeds)}</td>
                  <td style="padding:8px 10px;text-align:right;color:#1a7a47;font-size:13px">${formatCOP(totDia.total)}</td>
                </tr>
              </tfoot>
            </table>`}
      </div>

      <!-- Canceladas -->
      ${canceladas.length > 0 ? `
      <div style="margin-bottom:24px">
        <div style="font-size:13px;font-weight:700;color:#c0392b;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">
          ⚠ Citas canceladas hoy (${canceladas.length})
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:#fff5f5;border-bottom:2px solid #e74c3c">
              <th style="padding:7px 10px;text-align:left;font-weight:600;color:#c0392b">Hora</th>
              <th style="padding:7px 10px;text-align:left;font-weight:600;color:#c0392b">Paciente</th>
              <th style="padding:7px 10px;text-align:left;font-weight:600;color:#c0392b">Ciudad</th>
              <th style="padding:7px 10px;text-align:left;font-weight:600;color:#c0392b">Tipo sesión</th>
            </tr>
          </thead>
          <tbody>
            ${canceladas.map(c => `
              <tr style="border-bottom:1px solid #fde8e8">
                <td style="padding:6px 10px">${c.hora}</td>
                <td style="padding:6px 10px;font-weight:500">${c.clienteNombre}</td>
                <td style="padding:6px 10px;color:#555">${c.clienteCiudad||'—'}</td>
                <td style="padding:6px 10px;color:#555">${c.tipo}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : ''}

      <!-- Pie de página -->
      <div style="border-top:1px solid #ddd;padding-top:12px;margin-top:8px;display:flex;justify-content:space-between;font-size:11px;color:#888">
        <span>Quiromasajes E.F · Santa Rosa de Viterbo, Boyacá</span>
        <span>Documento generado el ${fechaFmt} a las ${horaImp}</span>
      </div>

    </div>`;

  window.print();

  // Limpiar después de imprimir
  window.addEventListener('afterprint', () => {
    desprendible.innerHTML = '';
  }, { once: true });
}

function bindFormCita() {
  const inputBuscar = document.getElementById('c-buscar-pac');
  const sugerencias = document.getElementById('c-pac-sugerencias');

  // Autocomplete — sin cambios
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

  // Registro rápido — ahora usa _getUbicacionRapida
  document.getElementById('btn-quick-save').addEventListener('click', async () => {
    const btn    = document.getElementById('btn-quick-save');
    const nombre = document.getElementById('qp-nombre').value.trim();
    const tel_   = document.getElementById('qp-tel').value.trim();

    const origenColombia = document.querySelector('input[name="qp-origen"]:checked')?.value === 'colombia';
    const ciudad = origenColombia
      ? _getUbicacionRapida()                            // "Boyacá > Tunja"
      : (document.getElementById('qp-pais')?.value || '');

    btn.textContent = 'Guardando...'; btn.disabled = true;
    const res = await registrarPacienteRapido(nombre, tel_, ciudad);

    if (res.ok) {
      asignarPacienteACita(res.id, res.nombre, res.ciudad || '');
      document.getElementById('quick-register').classList.remove('visible');
      document.getElementById('qp-nombre').value  = '';
      document.getElementById('qp-tel').value     = '';
      document.getElementById('qp-dpto').value    = '';
      document.getElementById('qp-ciudad').value  = '';
      document.getElementById('qp-pais').value    = '';
      avisoCentral({ mensaje: 'Paciente registrado y seleccionado.', tipo: 'success' });
    } else {
      if (res.paciente) {
        asignarPacienteACita(res.paciente.id, res.paciente.nombre, res.paciente.ciudad || '');
        document.getElementById('quick-register').classList.remove('visible');
        avisoCentral({ mensaje: 'Paciente ya existente — seleccionado.', tipo: 'success' });
      } else {
        avisoCentral({ mensaje: res.error, tipo: 'error' });
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

    // Si el panel de ciudad está visible, actualizar el paciente si cambió
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
        renderDashboardPaneles(completarCitaHoy, abrirModalCitaDesdeVoz, true, true, true, {
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
      // Sugerir próximo horario disponible — aviso centrado con acción,
      // así el usuario lo ve y puede elegirlo sin importar el scroll del modal.
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
    // inicializarSelectsUbicacion carga la API y retorna el getter
    _getUbicacionCita = await inicializarSelectsUbicacion(dpto, ciudSel);
    // restaurarUbicacion pre-rellena con el valor guardado del paciente
    if (ciudad) await restaurarUbicacion(dpto, ciudSel, ciudad);
    // Sincronizar campo oculto cuando cambie la ciudad
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

// ── Formulario: reprogramar — sin cambios ─────────────────
function bindFormReprogramar() {
  document.getElementById('btn-confirmar-reprog').addEventListener('click', async () => {
    const btn   = document.getElementById('btn-confirmar-reprog');
    const fecha = document.getElementById('r-fecha').value;
    const hora  = document.getElementById('r-hora').value;

    btn.textContent = 'Confirmando...'; btn.disabled = true;
    const res = await reprogramarCita(citaReprogramarId, fecha, hora, usuarioActual?.uid, usuarioActual?.nombre);

    if (res.ok) {
      cerrarModal('modal-reprogramar');
      toast('Cita reprogramada correctamente.', 'success');
      await cargarSlotsFecha(document.getElementById('filter-fecha').value);
    } else {
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
// USUARIOS — sin cambios
// ══════════════════════════════════════════════════════════
async function cargarUsuarios() {
  const snap  = await getDocs(collection(db, 'usuarios'));
  const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderUsuarios(lista);
}

function bindFormUsuario() {
  document.getElementById('btn-guardar-usr').addEventListener('click', async () => {
    const btn      = document.getElementById('btn-guardar-usr');
    const nombre   = document.getElementById('u-nombre').value.trim();
    const email    = document.getElementById('u-email').value.trim();
    const password = document.getElementById('u-password').value;
    const rol      = document.getElementById('u-rol').value;

    btn.textContent = 'Creando...'; btn.disabled = true;
    const res = await crearUsuario(nombre, email, password, rol);

    if (res.ok) {
      mostrarAlerta('alert-form-usr', 'Usuario creado.', 'success');
      await cargarUsuarios();
      setTimeout(() => {
        cerrarModal('modal-usuario');
        ['u-nombre','u-email','u-password'].forEach(id => { document.getElementById(id).value = ''; });
      }, 900);
    } else {
      mostrarAlerta('alert-form-usr', res.error, 'error');
    }

    btn.textContent = 'Crear usuario'; btn.disabled = false;
  });
}

// ══════════════════════════════════════════════════════════
// LOGOUT — sin cambios
// ══════════════════════════════════════════════════════════
function bindLogout() {
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await logout();
    sessionStorage.clear();
    window.location.replace('./index.html');
  });
}

// ══════════════════════════════════════════════════════════
// MODALES — cierre global, sin cambios
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

function bindFinanzas() {
  document.getElementById('btn-imprimir-desprendible')
    ?.addEventListener('click', () => {
      const d = window.__finanzasDia__;
      if (!d) return;
      imprimirDesprendible(d.pagosHoy, d.canceladas, d.totDia, d.fechaFmt);
    });
}

function bindCronograma() {
  document.getElementById('btn-refresh-crono')
    ?.addEventListener('click', () => cargarCronograma());
}

async function cargarCronograma() {
  // En día de viaje, el cronograma del admin muestra solo las citas de esa sede.
  const viajeHoy = await viajeEnFecha(HOY);
  await renderCronograma({
    filtrarSede: viajeHoy ? viajeHoy.ciudadFull : null,
    onCompletar: async (id) => {
      const card = document.querySelector(`[data-crono-completar="${id}"]`)?.closest('.crono-card')
                || document.querySelector(`[data-cita-id="${id}"]`);
      abrirModalCobro({
        citaId:        id,
        clienteId:     card?.dataset?.clienteId     || '',
        clienteNombre: card?.querySelector('.crono-nombre')?.textContent?.trim() || '',
        clienteCiudad: card?.dataset?.clienteCiudad || '',
        hora:          card?.dataset?.hora || card?.querySelector('.crono-hora')?.textContent?.trim() || '',
        tipoSesion:    card?.dataset?.tipoSesion
                    || card?.querySelector('.crono-meta')?.textContent?.split('·')[0]?.trim()
                    || 'Ajuste general',
        onConfirmar:   async () => {
          await renderEstadisticas();
          await cargarCronograma();
        }
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
      actualizarSelectHoras('r-hora', HOY);
      rFechaEl.onchange = () => actualizarSelectHoras('r-hora', rFechaEl.value);
      abrirModal('modal-reprogramar');
    },
  });
}

// ══════════════════════════════════════════════════════════
// ASISTENTE VOZ — sin cambios
// ══════════════════════════════════════════════════════════
function abrirModalCitaDesdeVoz(datos) {
  if (datos.fecha) {
    document.getElementById('c-fecha').value = datos.fecha;
  }
  const horaPresel = datos.hora || null;
  abrirModalCita(horaPresel);
  if (datos.tipo) {
    const sel = document.getElementById('c-tipo');
    const opcion = Array.from(sel.options)
      .find(o => o.text.toLowerCase().includes(datos.tipo.toLowerCase()));
    if (opcion) sel.value = opcion.value;
  }
  if (datos.notas) {
    document.getElementById('c-notas').value = datos.notas;
  }
  if (datos.clienteNombre) {
    const input = document.getElementById('c-buscar-pac');
    input.value = datos.clienteNombre;
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
    renderDashboardPaneles(completarCitaHoy, abrirModalCitaDesdeVoz, true, true, true, {
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
  const fechaInicial = nuevaFecha || HOY;
  rFechaEl.min   = HOY;
  rFechaEl.value = fechaInicial;
  actualizarSelectHoras('r-hora', fechaInicial, nuevaHora || null);
  rFechaEl.onchange = () => actualizarSelectHoras('r-hora', rFechaEl.value);
  abrirModal('modal-reprogramar');
}
