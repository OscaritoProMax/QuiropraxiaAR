// ══════════════════════════════════════════════════════════
// handlers.js — Event listeners, lógica de formularios y navegación
// ══════════════════════════════════════════════════════════

import { auth, db }           from '../../core/firebase.js';
import { protegerPagina }     from '../../core/router.js';
import { renderCronograma, autoCompletarCitasViejas } from './cronograma.js';
import { getDocs, collection } from 'firebase/firestore';
import { renderDashboardPaneles } from './ui.js';

import { logout, crearUsuario, getUsuarioPorId,
         ROLES, tienePermiso }                      from '../../core/authService.js';
import { registrarPaciente, registrarPacienteRapido,
         obtenerPacientes, obtenerPacientesPorCiudad,
         buscarPacientes, filtrarPorCiudad,
         actualizarPaciente, eliminarPaciente,
         DEPARTAMENTOS, PAISES,
         ubicacionString, parsearUbicacion }         from '../pacientes/pacientesService.js';
import { agendarCita, cancelarCita, reprogramarCita,
         cambiarEstado, sugerirHorario, ESTADOS, HORARIOS }         from '../citas/citasService.js';

import { mostrarAlerta, abrirModal, cerrarModal,
         crearBtn, HOY, MANANA,
         bindSelectGeo, bindSelectPais }             from '../../shared/helpers.js';
import { renderPerfil, renderEstadisticas, renderCitasHoy,
         renderSlots, renderPacientes, renderPills,
         renderResultadosBusqueda, renderFormEditar,
         renderUsuarios }                           from './ui.js';

// ══════════════════════════════════════════════════════════
// ESTADO GLOBAL
// ══════════════════════════════════════════════════════════
let usuarioActual     = null;
let pacientesCache    = [];
let citaReprogramarId = null;
let ciudadActivaPills = '';

// ══════════════════════════════════════════════════════════
// INIT — punto de entrada único
// ══════════════════════════════════════════════════════════
export function initDashboard() {
  poblarSelectsCiudades();
  poblarSelectsHorarios();
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
// SELECTS INICIALES
// ══════════════════════════════════════════════════════════
function poblarSelectsCiudades() {
  // Modal nuevo paciente: departamento + ciudad Colombia
  bindSelectGeo('p-dpto', 'p-ciudad', DEPARTAMENTOS);
  // ¿País extranjero? toggle
  bindSelectPais('p-pais', PAISES);

  // Registro rápido (modal cita): departamento + ciudad
  bindSelectGeo('qp-dpto', 'qp-ciudad', DEPARTAMENTOS);
  bindSelectPais('qp-pais', PAISES);

  // Filtro buscar pacientes: departamento + ciudad (con "Todos")
  bindSelectGeo('pac-dpto-filtro', 'pac-select-ciudad', DEPARTAMENTOS, { conTodas: true });

  // Exponer para renderFormEditar (edición inline)
  window.__DEPARTAMENTOS__ = DEPARTAMENTOS;
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
  ['c-hora', 'r-hora'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = HORARIOS.map(h => `<option>${h}</option>`).join('');
  });
}

// ══════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════
async function initAuth() {
  // protegerPagina verifica sesión y rol — redirige al login si no hay acceso.
  // Para Paso 3: cambiar a ['Administrador', 'Secretaria'] según la página.
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
  await cambiarEstado(citaId, ESTADOS.COMPLETADA);
  await Promise.all([
    renderDashboardPaneles(completarCitaHoy, abrirModalCitaDesdeVoz),
    renderEstadisticas(),
  ]);
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
    dashboard: ['Dashboard',            'Resumen del día'],
    pacientes: ['Gestión de pacientes', 'Código 009 — Registro, búsqueda y filtro por ciudad'],
    citas:     ['Gestión de citas',     'Código 002 — Agenda de horarios'],
    cronograma: ['Cronograma del día', 'Citas de hoy por estado y hora'],
    usuarios:  ['Usuarios del sistema', 'Código 001 — Control de acceso'],
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
    actions.appendChild(crearBtn('+ Nuevo paciente', () => abrirModal('modal-paciente')));
    // Activar tab de tabs
    document.querySelectorAll('.pac-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => activarTabPaciente(btn.dataset.tab));
    });
    activarTabPaciente('tab-pac-buscar');
  }

  if (vista === 'citas') {
    actions.appendChild(crearBtn('+ Agendar cita', () => abrirModalCita()));
    document.getElementById('filter-fecha').value = HOY;
    await cargarSlotsFecha(HOY);
  }

 if (vista === 'cronograma') {
       actions.appendChild(crearBtn('↺ Actualizar', () => cargarCronograma()));
       await cargarCronograma();
     }

  if (vista === 'usuarios' && tienePermiso(usuarioActual, [ROLES.ADMINISTRADOR])) {
    actions.appendChild(crearBtn('+ Nuevo usuario', () => abrirModal('modal-usuario')));
    await cargarUsuarios();
  }
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
  await renderSlots(fecha, {
    onAgendar:      (hora) => abrirModalCita(hora),
    onCompletar:    async (id, f) => {
      await cambiarEstado(id, ESTADOS.COMPLETADA);
      await Promise.all([cargarSlotsFecha(f), renderEstadisticas()]);
    },
    onReprogramar:  (id, f) => {
      citaReprogramarId = id;
      document.getElementById('r-fecha').value = f;
      abrirModal('modal-reprogramar');
    },
    onCancelar:     async (id, f) => {
      if (!confirm('¿Confirmas la cancelación de esta cita?')) return;
      await cancelarCita(id, 'Cancelada por administrador');
      mostrarAlerta('alert-cita', 'Cita cancelada.', 'success');
      await Promise.all([cargarSlotsFecha(f), renderEstadisticas()]);
    },
  });
}

// ══════════════════════════════════════════════════════════
// PACIENTES — estado local del módulo
// ══════════════════════════════════════════════════════════
let pacEditando = null; // paciente actualmente seleccionado para editar

async function cargarPacientesCache() {
  pacientesCache = await obtenerPacientes();
}

// ── Activar tab dentro de la sección pacientes ───────────
function activarTabPaciente(tab) {
  ['tab-pac-buscar','tab-pac-editar','tab-pac-eliminar'].forEach(t => {
    document.getElementById(t)?.classList.toggle('pac-tab-active', t === tab);
  });
  ['sec-pac-buscar','sec-pac-editar','sec-pac-eliminar'].forEach(s => {
    const el = document.getElementById(s);
    if (el) el.style.display = s === tab.replace('tab-','sec-') ? 'block' : 'none';
  });
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
  document.getElementById('c-pac-sugerencias').style.display = 'none';
  document.getElementById('quick-register').classList.remove('visible');
  document.getElementById('c-fecha').value = HOY;
  if (horaPreseleccionada) document.getElementById('c-hora').value = horaPreseleccionada;
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

// ── Formulario: reprogramar ───────────────────────────────
function bindFormReprogramar() {
  document.getElementById('btn-confirmar-reprog').addEventListener('click', async () => {
    const btn  = document.getElementById('btn-confirmar-reprog');
    const fecha = document.getElementById('r-fecha').value;
    const hora  = document.getElementById('r-hora').value;

    btn.textContent = 'Confirmando...'; btn.disabled = true;
    const res = await reprogramarCita(citaReprogramarId, fecha, hora);

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
// USUARIOS
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
      await cambiarEstado(id, ESTADOS.COMPLETADA);
      await renderEstadisticas();
    },
    onCancelar: async (id) => {
      await cancelarCita(id, 'Cancelada desde cronograma');
      await renderEstadisticas();
    },
    onReprogramar: (id) => {
      citaReprogramarId = id;
      document.getElementById('r-fecha').value = HOY;
      abrirModal('modal-reprogramar');
    },
  });
}

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