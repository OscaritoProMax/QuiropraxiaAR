// ══════════════════════════════════════════════════════════
// handlers.js — Event listeners, lógica de formularios y navegación
// ACTUALIZADO: geografía Colombia usa api-colombia.com via colombiaService.js
// ══════════════════════════════════════════════════════════

import { auth, db }           from '../../core/firebase.js';
import { protegerPagina }     from '../../core/router.js';
import { renderCronograma, autoCompletarCitasViejas } from './cronograma.js';
import { getDocs, collection } from 'firebase/firestore';
import { renderDashboardPaneles, renderGestorPacientes } from './ui.js';

import { logout, crearUsuario, getUsuarioPorId,
         ROLES, tienePermiso }                      from '../../core/authService.js';

// ── Pacientes: se elimina DEPARTAMENTOS, se agrega colombiaService ──
import { registrarPaciente, registrarPacienteRapido,
         obtenerPacientes, obtenerPacientesPorCiudad,
         buscarPacientes, filtrarPorCiudad,
         actualizarPaciente, eliminarPaciente,
         PAISES,
         ubicacionString, parsearUbicacion }         from '../pacientes/pacientesService.js';

import {
  inicializarSelectsUbicacion,
  poblarSelectDepartamentos,
  poblarSelectCiudades,
  restaurarUbicacion,
}                                                    from '../pacientes/colombiaService.js';

import { registrarPago, obtenerPagosHoy, obtenerPagosMes,
         calcularTotalesDia, calcularTotalesMes,
         formatCOP, TARIFA_BASE }                                   from '../finanzas/pagosService.js';
import { agendarCita, cancelarCita, reprogramarCita,
         cambiarEstado, sugerirHorario, ESTADOS, HORARIOS }         from '../citas/citasService.js';

import { mostrarAlerta, abrirModal, cerrarModal,
         crearBtn, HOY, MANANA,
         bindSelectPais }                            from '../../shared/helpers.js';
import { renderPerfil, renderEstadisticas, renderCitasHoy,
         renderSlots, renderPacientes, renderPills,
         renderResultadosBusqueda, renderFormEditar,
         renderUsuarios }                           from './ui.js';

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

// ══════════════════════════════════════════════════════════
// INIT — punto de entrada único
// ══════════════════════════════════════════════════════════
export function initDashboard() {
  poblarSelectsCiudades();   // ahora async — carga API en paralelo
  poblarSelectsHorarios();
  bindModalCobro();
  bindNavegacion();
  bindModalesGlobal();
  bindLogout();
  bindFiltrosFecha();
  bindBusquedaPaciente();
  bindEditorPaciente();
  bindEliminarPaciente();
  bindFormPaciente();
  bindFormCita();
  bindFormReprogramar();
  bindFormUsuario();
  bindCronograma();
  initAuth();
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
  ['c-hora', 'r-hora'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = HORARIOS.map(h => `<option>${h}</option>`).join('');
  });
}

/** Filtra HORARIOS según la fecha: si es hoy, elimina horas ya pasadas */
function horasDisponibles(fecha) {
  if (fecha !== HOY) return HORARIOS;
  const ahora = new Date();
  const hhmm  = `${String(ahora.getHours()).padStart(2,'0')}:${String(ahora.getMinutes()).padStart(2,'0')}`;
  return HORARIOS.filter(h => h > hhmm);
}

/** Actualiza un select de horas según la fecha seleccionada */
function actualizarSelectHoras(selectId, fecha, valorActual = null) {
  const el = document.getElementById(selectId);
  if (!el) return;
  const disponibles = horasDisponibles(fecha);
  if (disponibles.length === 0) {
    el.innerHTML = '<option value="">No hay horarios disponibles hoy</option>';
    el.disabled = true;
  } else {
    el.disabled = false;
    el.innerHTML = disponibles.map(h => `<option>${h}</option>`).join('');
    if (valorActual && disponibles.includes(valorActual)) el.value = valorActual;
  }
}

// ══════════════════════════════════════════════════════════
// AUTH — sin cambios
// ══════════════════════════════════════════════════════════
async function initAuth() {
  usuarioActual = await protegerPagina('Administrador');
  renderPerfil(usuarioActual);

  if (!tienePermiso(usuarioActual, [ROLES.ADMINISTRADOR])) {
    document.getElementById('menu-usuarios').style.display = 'none';
  }

  await Promise.all([
    autoCompletarCitasViejas(),
    renderEstadisticas(),
    renderDashboardPaneles(
      completarCitaHoy,
      abrirModalCitaDesdeVoz
    ),
    cargarPacientesCache(),
  ]);
}

async function completarCitaHoy(citaId) {
  const card = document.querySelector(`[data-crono-completar="${citaId}"]`)?.closest('.crono-card, .slot-item')
            || document.querySelector(`[data-cita-id="${citaId}"]`);
  abrirModalCobro({
    citaId,
    clienteId:     card?.dataset?.clienteId     || '',
    clienteNombre: card?.querySelector('.crono-nombre, .slot-nombre')?.textContent?.trim() || '',
    clienteCiudad: card?.dataset?.clienteCiudad || '',
    hora:          card?.dataset?.hora || card?.querySelector('.crono-hora, .slot-hora')?.textContent?.trim() || '',
    tipoSesion:    card?.dataset?.tipoSesion
                || card?.querySelector('.crono-meta, .slot-tipo')?.textContent?.split('·')[0]?.trim()
                || 'Ajuste general',
    onConfirmar: async () => {
      await Promise.all([
        renderDashboardPaneles(completarCitaHoy, abrirModalCitaDesdeVoz),
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

  const titulos = {
    dashboard:   ['Dashboard',             'Resumen del día'],
    pacientes:   ['Gestión de pacientes',  'Código 009 — Registro, búsqueda y filtro por ciudad'],
    citas:       ['Gestión de citas',      'Código 002 — Agenda de horarios'],
    cronograma:  ['Cronograma del día',    'Citas de hoy por estado y hora'],
    usuarios:    ['Usuarios del sistema',  'Código 001 — Control de acceso'],
    configuracion: ['Configuración',       'Ajustes del sistema'],
    finanzas:      ['Finanzas',              'Ingresos, cobros y control del día'],
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
    ]);
  }

 if (vista === 'pacientes') {
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

  if (vista === 'finanzas') {
    await renderVistaFinanzas();
  }

  if (vista === 'usuarios' && tienePermiso(usuarioActual, [ROLES.ADMINISTRADOR])) {
    actions.appendChild(crearBtn('+ Nuevo usuario', () => abrirModal('modal-usuario')));
    await cargarUsuarios();
  }
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
  await renderSlots(fecha, {
    onAgendar:   (hora, fecha) => abrirModalCita(hora, fecha),
     onCompletar: async (id, f) => {
       const slot = document.querySelector(`[data-completar="${id}"]`)?.closest('.slot-item')
                 || document.querySelector(`[data-cita-id="${id}"]`);
       abrirModalCobro({
         citaId:        id,
         clienteId:     slot?.dataset?.clienteId     || '',
         clienteNombre: slot?.querySelector('.slot-nombre, .crono-nombre')?.textContent?.trim() || '',
         clienteCiudad: slot?.dataset?.clienteCiudad || '',
         hora:          slot?.dataset?.hora || f,
         tipoSesion:    slot?.dataset?.tipoSesion
                     || slot?.querySelector('.slot-tipo, .crono-meta')?.textContent?.split('·')[0]?.trim()
                     || 'Ajuste general',
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
      if (!confirm('¿Confirmas la cancelación de esta cita?')) return;
      await cancelarCita(id, 'Cancelada por administrador');
      mostrarAlerta('alert-cita', 'Cita cancelada.', 'success');
      await Promise.all([cargarSlotsFecha(f), renderEstadisticas()]);
    },
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
  document.getElementById('c-pac-sugerencias').style.display = 'none';
  document.getElementById('quick-register').classList.remove('visible');

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
// MODAL DE COBRO
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
  document.getElementById('cobro-tarifa').value         = TARIFA_BASE;
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

      await cambiarEstado(_cobroPendiente.citaId, ESTADOS.COMPLETADA);

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
        usuarioId:     usuarioActual?.uid,
      });

      cerrarModal('modal-cobro');
      btn.disabled = false;
      btn.textContent = 'Confirmar y completar';

      if (resPago.ok) {
        mostrarAlerta('alert-global', `Cobro registrado: ${formatCOP(resPago.totalCobrado)}`, 'success');
      }

      await _cobroPendiente.onConfirmar?.();
      _cobroPendiente = null;
    });
}

window.actualizarResumenCobro = actualizarResumenCobro;

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

  const totDia = calcularTotalesDia(pagosHoy);
  const totMes = calcularTotalesMes(pagosMes);

  // ── KPIs ──────────────────────────────────────────────
  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('fin-total-dia',      formatCOP(totDia.total));
  setEl('fin-sub-sesiones',   `${totDia.cantidad} sesión${totDia.cantidad !== 1 ? 'es' : ''}`);
  setEl('fin-total-mes',      formatCOP(totMes.total));
  setEl('fin-sub-mes',        `${totMes.cantidad} sesiones este mes`);
  setEl('fin-meds-dia',       formatCOP(totDia.soloMeds));
  setEl('fin-canceladas-dia', String(canceladas.length));

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
        <table style="width:100%;border-collapse:collapse;font-size:13px">
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
              <tr style="border-bottom:1px solid var(--border);background:${i%2===0?'transparent':'var(--bg-secondary)'}">
                <td style="padding:8px 12px;color:var(--text-muted)">${p.hora}</td>
                <td style="padding:8px 12px;font-weight:500">${p.clienteNombre}</td>
                <td style="padding:8px 12px;color:var(--text-muted)">${p.tipoSesion}</td>
                <td style="padding:8px 12px;text-align:right">${formatCOP(p.tarifaBase)}</td>
                <td style="padding:8px 12px;text-align:right;color:${p.totalMedicamentos>0?'var(--color-green)':'var(--text-muted)'}">
                  ${p.totalMedicamentos>0 ? formatCOP(p.totalMedicamentos) : '—'}</td>
                <td style="padding:8px 12px;text-align:right;font-weight:700;color:var(--color-green)">${formatCOP(p.totalCobrado)}</td>
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
        <table style="width:100%;border-collapse:collapse;font-size:13px">
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

  // Guardar datos para el botón imprimir (se actualiza cada vez que se carga la vista)
  window.__finanzasDia__ = { pagosHoy, canceladas, totDia, fechaFmt };
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
      mostrarAlerta('alert-form-cita', 'Paciente registrado y seleccionado.', 'success');
    } else {
      if (res.paciente) {
        asignarPacienteACita(res.paciente.id, res.paciente.nombre, res.paciente.ciudad || '');
        document.getElementById('quick-register').classList.remove('visible');
        mostrarAlerta('alert-form-cita', 'Paciente ya existente — seleccionado.', 'success');
      } else {
        mostrarAlerta('alert-form-cita', res.error, 'error');
      }
    }

    btn.textContent = 'Guardar y usar este paciente'; btn.disabled = false;
  });

  // Guardar cita — sin cambios
  document.getElementById('btn-guardar-cita').addEventListener('click', async () => {
    const btn = document.getElementById('btn-guardar-cita');
    const pid = document.getElementById('c-paciente-id').value;
    if (!pid) {
      mostrarAlerta('alert-form-cita', 'Selecciona o registra un paciente primero.', 'error');
      return;
    }

    const datos = {
      clienteId:     pid,
      clienteNombre: document.getElementById('c-paciente-nombre').value,
      clienteCiudad: document.getElementById('c-paciente-ciudad').value,
      usuarioId:     usuarioActual?.uid || '',
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
      // Sugerir próximo horario disponible
      const sugerencia = await sugerirHorario(datos.fecha, datos.hora);
      const alertEl = document.getElementById('alert-form-cita');
      if (sugerencia) {
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
          document.getElementById('c-hora').value  = sugerencia.hora;
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

function seleccionarPaciente(item, sugerencias) {
  asignarPacienteACita(item.dataset.id, item.dataset.nombre, item.dataset.ciudad);
  sugerencias.style.display = 'none';
  document.getElementById('quick-register').classList.remove('visible');
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
    const res = await reprogramarCita(citaReprogramarId, fecha, hora);

    if (res.ok) {
      cerrarModal('modal-reprogramar');
      mostrarAlerta('alert-cita', 'Cita reprogramada correctamente.', 'success');
      await cargarSlotsFecha(document.getElementById('filter-fecha').value);
    } else {
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
            document.getElementById('r-hora').value  = sugerencia.hora;
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
  await renderCronograma({
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
      await cancelarCita(id, 'Cancelada desde cronograma');
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
  const horaPresel = datos.hora || null;
  abrirModalCita(horaPresel);

  if (datos.fecha) {
    document.getElementById('c-fecha').value = datos.fecha;
  }
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
