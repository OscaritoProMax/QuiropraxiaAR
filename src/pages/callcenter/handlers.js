// src/pages/callcenter/handlers.js
// Rol: Call-center
// Acceso: disponibilidad, agendar/cancelar/reprogramar citas,
//         registrar pacientes nuevos, cronograma, herramientas
// SIN acceso: editar/eliminar pacientes, estadísticas, crear usuarios

import { protegerPagina }              from '../../core/router.js';
import { logout }                      from '../../core/authService.js';

import { renderCronograma, autoCompletarCitasViejas }
                                        from '../../modules/dashboard/cronograma.js';
import { renderSlots, renderPerfil,
         renderResultadosBusqueda }     from '../../modules/dashboard/ui.js';

import { registrarPacienteRapido,
         buscarPacientes,
         CIUDADES }                     from '../../modules/pacientes/pacientesService.js';

import { agendarCita, cancelarCita, reprogramarCita,
         cambiarEstado, sugerirHorario,
         ESTADOS, HORARIOS }            from '../../modules/citas/citasService.js';

import { mostrarAlerta, abrirModal, cerrarModal,
         HOY, MANANA }                  from '../../shared/helpers.js';

// ── Estado local ──────────────────────────────────────────
let usuarioActual  = null;
let pacientesCache = [];
let fechaAgenda    = HOY;

// ══════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════
export async function initCallcenter() {
  usuarioActual = await protegerPagina('Call-center');

  renderPerfil(usuarioActual);
  ocultarSeccionesNoPermitidas();

  await Promise.all([
    autoCompletarCitasViejas(),
    cargarAgenda(HOY),
  ]);

  initNavegacion();
  initModalCita();
  initRegistroPacienteRapido();
  initCronograma();
  initLogout();
}

// ── Ocultar lo que call-center no puede ver ───────────────
function ocultarSeccionesNoPermitidas() {
  // Sin acceso a estadísticas ni gestión de usuarios ni edición de pacientes
  document.getElementById('menu-usuarios')?.style.setProperty('display', 'none');
  document.getElementById('tab-estadisticas')?.style.setProperty('display', 'none');
  document.getElementById('tab-pacientes-edicion')?.style.setProperty('display', 'none');
}

// ══════════════════════════════════════════════════════════
// NAVEGACIÓN
// ══════════════════════════════════════════════════════════
function initNavegacion() {
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('[data-tab]').forEach(el => el.classList.remove('active'));
      document.getElementById(tab)?.classList.add('active');
      btn.classList.add('active');

      if (tab === 'tab-agenda')     cargarAgenda(fechaAgenda);
      if (tab === 'tab-cronograma') initCronograma();
    });
  });

  document.getElementById('btn-hoy')?.addEventListener('click',    () => cargarAgenda(HOY));
  document.getElementById('btn-manana')?.addEventListener('click',  () => cargarAgenda(MANANA));
  document.getElementById('fecha-picker')?.addEventListener('change', e => cargarAgenda(e.target.value));
}

// ══════════════════════════════════════════════════════════
// AGENDA — ver disponibilidad y agendar
// ══════════════════════════════════════════════════════════
async function cargarAgenda(fecha) {
  fechaAgenda = fecha;
  await renderSlots(fecha, {
    onAgendar:     hora  => abrirModalNuevaCita(hora, fecha),
    onCompletar:   ()    => {},                                    // call-center no completa citas
    onReprogramar: (id, f) => abrirModalReprogramar(id, f),
    onCancelar:    (id)  => cancelarCitaConfirmar(id),
  });
}

// ══════════════════════════════════════════════════════════
// MODAL CITA — agendar
// ══════════════════════════════════════════════════════════
function initModalCita() {
  document.getElementById('btn-nueva-cita')?.addEventListener('click', () =>
    abrirModalNuevaCita(null, fechaAgenda)
  );
  document.getElementById('btn-cerrar-cita')?.addEventListener('click', () =>
    cerrarModal('modal-cita')
  );
  document.getElementById('form-cita')?.addEventListener('submit', e => {
    e.preventDefault();
    guardarCita();
  });
  document.getElementById('cita-buscar-pac')?.addEventListener('input', buscarPacienteLive);
}

function abrirModalNuevaCita(hora = null, fecha = HOY) {
  abrirModal('modal-cita');
  const horaEl  = document.getElementById('cita-hora');
  const fechaEl = document.getElementById('cita-fecha');
  if (hora && horaEl)   horaEl.value  = hora;
  if (fecha && fechaEl) fechaEl.value = fecha;
}

async function guardarCita() {
  const clienteId     = document.getElementById('cita-cliente-id')?.value;
  const clienteNombre = document.getElementById('cita-cliente-nombre')?.value;
  const clienteCiudad = document.getElementById('cita-cliente-ciudad')?.value;
  const fecha         = document.getElementById('cita-fecha')?.value;
  const hora          = document.getElementById('cita-hora')?.value;
  const tipo          = document.getElementById('cita-tipo')?.value;
  const notas         = document.getElementById('cita-notas')?.value;

  const res = await agendarCita({
    clienteId, clienteNombre, clienteCiudad,
    usuarioId: usuarioActual.uid,
    fecha, hora, tipo, notas,
  });

  if (!res.ok) { mostrarAlerta('alert-form-cita', res.error, 'error'); return; }
  cerrarModal('modal-cita');
  mostrarAlerta('alert-global', 'Cita agendada', 'success');
  await cargarAgenda(fechaAgenda);
}

// ── Buscar paciente existente dentro del modal ────────────
async function buscarPacienteLive() {
  const termino = document.getElementById('cita-buscar-pac')?.value;
  if (!termino || termino.length < 2) return;
  const resultados = await buscarPacientes(termino);
  renderResultadosBusqueda('cita-pac-resultados', resultados, seleccionarPacienteCita, 'Seleccionar');
}

function seleccionarPacienteCita(paciente) {
  document.getElementById('cita-cliente-id').value     = paciente.id;
  document.getElementById('cita-cliente-nombre').value = paciente.nombre;
  document.getElementById('cita-cliente-ciudad').value = paciente.ciudad || '';
  document.getElementById('cita-buscar-pac').value     = paciente.nombre;
  document.getElementById('cita-pac-resultados').innerHTML = '';
}

// ══════════════════════════════════════════════════════════
// ACCIONES DE CITA
// ══════════════════════════════════════════════════════════
async function cancelarCitaConfirmar(citaId) {
  if (!confirm('¿Cancelar esta cita?')) return;
  await cancelarCita(citaId);
  mostrarAlerta('alert-global', 'Cita cancelada', 'success');
  await cargarAgenda(fechaAgenda);
}

function abrirModalReprogramar(citaId, fecha) {
  abrirModal('modal-reprogramar');
  document.getElementById('reprog-cita-id').value = citaId;
  document.getElementById('reprog-fecha').value   = fecha;
}

// ══════════════════════════════════════════════════════════
// REGISTRO RÁPIDO DE PACIENTE
// Call-center puede crear pacientes nuevos pero no editarlos
// ══════════════════════════════════════════════════════════
function initRegistroPacienteRapido() {
  document.getElementById('btn-registrar-pac-rapido')?.addEventListener('click', () =>
    abrirModal('modal-paciente-rapido')
  );
  document.getElementById('btn-cerrar-pac-rapido')?.addEventListener('click', () =>
    cerrarModal('modal-paciente-rapido')
  );
  document.getElementById('form-paciente-rapido')?.addEventListener('submit', async e => {
    e.preventDefault();
    await guardarPacienteRapido();
  });
}

async function guardarPacienteRapido() {
  const nombre    = document.getElementById('pac-rapido-nombre')?.value.trim();
  const telefono  = document.getElementById('pac-rapido-telefono')?.value.trim();
  const ciudad    = document.getElementById('pac-rapido-ciudad')?.value;
  const documento = document.getElementById('pac-rapido-documento')?.value.trim();

  const res = await registrarPacienteRapido(nombre, telefono, ciudad, documento);
  if (!res.ok) { mostrarAlerta('alert-form-pac-rapido', res.error, 'error'); return; }

  cerrarModal('modal-paciente-rapido');
  mostrarAlerta('alert-global', `Paciente "${res.nombre}" registrado`, 'success');

  // Auto-seleccionar el nuevo paciente en el modal de cita si está abierto
  const citaNombreEl = document.getElementById('cita-cliente-nombre');
  if (citaNombreEl) {
    document.getElementById('cita-cliente-id').value     = res.id;
    document.getElementById('cita-cliente-nombre').value = res.nombre;
    document.getElementById('cita-cliente-ciudad').value = res.ciudad || '';
    document.getElementById('cita-buscar-pac').value     = res.nombre;
  }
}

// ══════════════════════════════════════════════════════════
// CRONOGRAMA — solo lectura + reprogramar/cancelar
// ══════════════════════════════════════════════════════════
function initCronograma() {
  renderCronograma({
    onCompletar:   ()   => {},                                     // call-center no completa
    onCancelar:    id   => cancelarCitaConfirmar(id),
    onReprogramar: id   => abrirModalReprogramar(id, HOY),
  });
}

// ══════════════════════════════════════════════════════════
// LOGOUT
// ══════════════════════════════════════════════════════════
function initLogout() {
  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await logout();
    window.location.href = '/index.html';
  });
}
