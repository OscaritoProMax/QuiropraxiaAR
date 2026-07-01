// src/pages/callcenter/handlers.js
// Rol: Call-center
// Acceso: disponibilidad, agendar/cancelar/reprogramar citas,
//         registrar pacientes nuevos, cronograma, semana, panel de
//         "Cliente en llamada" (búsqueda rápida + agendamiento en vivo).
// SIN acceso: completar citas, editar/eliminar pacientes, finanzas, usuarios.

import { protegerPagina }              from '../../core/router.js';
import { logout }                      from '../../core/authService.js';

import { renderCronograma, autoCompletarCitasViejas }
                                        from '../../modules/dashboard/cronograma.js';
import { renderSemana }                from '../../modules/dashboard/semana.js';
import { renderPerfil, renderSlots, renderDashboardPaneles,
         renderResultadosBusqueda }     from '../../modules/dashboard/ui.js';

import { registrarPaciente, registrarPacienteRapido,
         buscarPacientes, obtenerDepartamentos, PAISES,
         ubicacionString }             from '../../modules/pacientes/pacientesService.js';
import { poblarSelectDepartamentos, poblarSelectCiudades } from '../../modules/pacientes/colombiaService.js';

import { agendarCita, cancelarCita, reprogramarCita,
         obtenerCitasPorFecha, obtenerCitasPorCliente,
         sugerirHorario, ESTADOS, HORARIOS, cargarHorarios,
         viajeEnFecha, obtenerCitasPendientesReprogramar }
                                        from '../../modules/citas/citasService.js';

import { mostrarAlerta, abrirModal, cerrarModal, iniciales,
         badgeEstado, crearBtn, HOY, MANANA,
         bindSelectGeo, bindSelectPais,
         pedirMotivoCancelacion }       from '../../shared/helpers.js';
import { initTimePicker, setTimePicker,
         hora12Display }                from '../../shared/timePicker.js';

// ══════════════════════════════════════════════════════════
// ESTADO LOCAL
// ══════════════════════════════════════════════════════════
let usuarioActual      = null;
let fechaAgenda         = HOY;
let citaReprogramarId   = null;
let clienteLlamadaActual = null;   // cliente seleccionado en el panel de llamada
let fechaLlamada         = HOY;    // fecha elegida para agendar desde la llamada
let slotsLibresLlamada   = [];     // horarios libres mostrados en el panel
let _onPacienteRegistrado = null;  // hook para enlazar registro rápido ↔ panel de llamada

// ══════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════
export async function initCallcenter() {
  await cargarHorarios();     // genera los slots según la jornada configurada
  initTema();
  await poblarSelectsCiudades();
  poblarSelectsHorarios();
  bindNavegacion();
  bindModalesGlobal();
  bindLogout();
  bindSidebarToggle();
  bindFiltrosFecha();
  bindFormPaciente();
  bindFormCita();
  bindFormReprogramar();
  bindCronograma();
  bindReporte();
  initPanelLlamada();

  usuarioActual = await protegerPagina('Call-center');
  renderPerfil(usuarioActual);

  await Promise.all([
    autoCompletarCitasViejas(),
    actualizarKpis(),
    renderDashboardPaneles(avisoAccionNoPermitida, abrirModalCitaDesdeVoz, false, false),
    renderPendientesReprogramar(),
  ]);
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
// SIDEBAR — colapsar/expandir
// ══════════════════════════════════════════════════════════
function bindSidebarToggle() {
  const btnToggle = document.getElementById('btn-toggle');
  const sidebar   = document.getElementById('sidebar');
  btnToggle?.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    localStorage.setItem('sidebarStatus', sidebar.classList.contains('collapsed') ? 'collapsed' : 'open');
  });
}

// ══════════════════════════════════════════════════════════
// SELECTS DE CIUDAD / PAÍS (modal paciente + registro rápido)
// ══════════════════════════════════════════════════════════
async function poblarSelectsCiudades() {
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

  // Toggle Colombia / Extranjero — modal nuevo paciente
  document.querySelectorAll('input[name="p-origen"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const esColombia = radio.value === 'colombia';
      document.getElementById('p-origen-colombia').style.display   = esColombia ? 'flex' : 'none';
      document.getElementById('p-origen-extranjero').style.display = esColombia ? 'none' : 'flex';
    });
  });

  // Toggle Colombia / Extranjero — registro rápido
  document.querySelectorAll('input[name="qp-origen"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const esColombia = radio.value === 'colombia';
      document.getElementById('qp-origen-colombia').style.display   = esColombia ? 'flex' : 'none';
      document.getElementById('qp-origen-extranjero').style.display = esColombia ? 'none' : 'flex';
    });
  });
}

function poblarSelectsHorarios() {
  initTimePicker('c-hora', HORARIOS);
  initTimePicker('r-hora', HORARIOS);
}

// ══════════════════════════════════════════════════════════
// NAVEGACIÓN
// ══════════════════════════════════════════════════════════
function bindNavegacion() {
  document.querySelectorAll('.menu-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', () => mostrarVista(btn.dataset.view, btn));
  });

  document.getElementById('kpi-card-citas')?.addEventListener('click', () => irACitasFecha(HOY));
  document.getElementById('kpi-card-pendientes')?.addEventListener('click', () => irACitasFecha(HOY));
}

function irACitasFecha(fecha) {
  const filtroFecha = document.getElementById('filter-fecha');
  if (filtroFecha) filtroFecha.value = fecha;
  mostrarVista('citas', document.querySelector('.menu-btn[data-view="citas"]'));
}

async function mostrarVista(vista, btn) {
  document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.menu-btn').forEach(b => b.classList.remove('menu-active'));
  document.getElementById('view-' + vista)?.classList.add('active');
  if (btn) btn.classList.add('menu-active');

  const titulos = {
    dashboard:     ['Dashboard',          'Resumen del día'],
    citas:         ['Citas',              'Agenda de horarios'],
    cronograma:    ['Cronograma del día', 'Citas de hoy por estado y hora'],
    semana:        ['Semana',             'Ocupación del mes y la semana'],
    configuracion: ['Configuración',      'Tema y opciones de sesión'],
  };
  const [titulo, sub] = titulos[vista] ?? ['', ''];
  document.getElementById('topbar-title').textContent = titulo;
  document.getElementById('topbar-sub').textContent   = sub;

  const actions = document.getElementById('topbar-actions');
  actions.innerHTML = '';

  // El botón flotante del resumen solo aparece en la vista de Citas.
  const fabReporte = document.getElementById('btn-reporte-fab');
  if (fabReporte) fabReporte.style.display = (vista === 'citas') ? 'flex' : 'none';

  if (vista === 'dashboard') {
    await Promise.all([
      actualizarKpis(),
      renderDashboardPaneles(avisoAccionNoPermitida, abrirModalCitaDesdeVoz, false, false),
      renderPendientesReprogramar(),
    ]);
  }

  if (vista === 'citas') {
    actions.appendChild(crearBtn('+ Agendar cita', () => abrirModalCita()));
    actions.appendChild(crearBtn('+ Nuevo paciente', () => abrirModal('modal-paciente'), 'btn btn-soft'));
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
}

function irACitasDesdeSemana(fechaStr) {
  irACitasFecha(fechaStr);
}

// ══════════════════════════════════════════════════════════
// KPIs DEL DASHBOARD (solo citas — sin finanzas ni pacientes)
// ══════════════════════════════════════════════════════════
async function actualizarKpis() {
  try {
    const citasHoy     = await obtenerCitasPorFecha(HOY);
    const activasHoy    = citasHoy.filter(c => c.estado === ESTADOS.ACTIVA).length;
    const completadasHoy = citasHoy.filter(c => c.estado === ESTADOS.COMPLETADA).length;
    const canceladasHoy  = citasHoy.filter(c => c.estado === ESTADOS.CANCELADA).length;
    const totalHoy       = citasHoy.length;

    setText('stat-citas',      totalHoy);
    setText('stat-pendientes', activasHoy);
    setText('stat-canceladas', canceladasHoy);
    setText('kpi-sub-citas',   `${completadasHoy} completadas · ${activasHoy} activas`);
    setText('kpi-sub-cancel',  totalHoy > 0
      ? `${Math.round(canceladasHoy / totalHoy * 100)}% de cancelación hoy`
      : 'Sin citas registradas hoy');
  } catch (error) {
    console.error('Error cargando KPIs de call-center:', error);
  }
}

function setText(id, valor) {
  const el = document.getElementById(id);
  if (el) el.textContent = valor;
}

// ══════════════════════════════════════════════════════════
// SLOTS DE CITAS — vista "Citas" + resumen para informe al admin
// ══════════════════════════════════════════════════════════
function bindFiltrosFecha() {
  document.getElementById('filter-fecha')
    ?.addEventListener('change', e => cargarSlotsFecha(e.target.value));

  document.getElementById('btn-hoy')
    ?.addEventListener('click', () => {
      document.getElementById('filter-fecha').value = HOY;
      cargarSlotsFecha(HOY);
    });

  document.getElementById('btn-manana')
    ?.addEventListener('click', () => {
      document.getElementById('filter-fecha').value = MANANA;
      cargarSlotsFecha(MANANA);
    });
}

async function cargarSlotsFecha(fecha) {
  fechaAgenda = fecha;

  // Si la fecha cae en un viaje del quiropráctico, la sede local está cerrada.
  const viaje = await viajeEnFecha(fecha);
  if (viaje) {
    await renderSlots(fecha, { bloqueo: { ciudad: viaje.ciudadFull } });
  } else {
    await renderSlots(fecha, {
      onAgendar:     (hora) => abrirModalCita(hora),
      onCompletar:   avisoAccionNoPermitida,
      onReprogramar: (id, f) => abrirModalReprogramar(id, f),
      onCancelar:    (id, f) => cancelarCitaConfirmar(id, f),
    });
  }

  const citas = await obtenerCitasPorFecha(fecha);
  renderReporteDia(fecha, citas);
}

function avisoAccionNoPermitida() {
  mostrarAlerta('alert-global', 'Esta acción está reservada para secretaria o administrador.', 'error');
}

// Panel del dashboard: citas que un viaje dejó "pendientes por reprogramar".
async function renderPendientesReprogramar() {
  const cont = document.getElementById('dash-reprogramar-wrap');
  if (!cont) return;

  const citas = await obtenerCitasPendientesReprogramar();
  if (!citas.length) { cont.innerHTML = ''; return; }

  cont.innerHTML = `
    <div class="dash-panel" style="margin-top:20px;border-left:4px solid #7c3aed">
      <div class="dash-panel-label">
        <span class="dash-dot" style="background:#7c3aed"></span>
        Pendientes por reprogramar (${citas.length})
      </div>
      <div style="font-size:12.5px;color:var(--th-text2,#8492a6);margin:2px 0 10px">
        Citas afectadas por un viaje del quiropráctico. Reprográmalas con el paciente.
      </div>
      <div class="dash-proximas-lista">
        ${citas.map(c => `
          <div class="dash-proxima-item" style="gap:10px;flex-wrap:wrap">
            <span class="dash-proxima-hora">${formatearFechaCorta(c.fecha)} · ${hora12Display(c.hora)}</span>
            <span class="dash-proxima-nombre">${c.clienteNombre}</span>
            <span class="dash-proxima-tipo">${c.tipo}</span>
            <button class="btn btn-soft btn-sm" data-reprog-pend="${c.id}" style="margin-left:auto">Reprogramar</button>
          </div>`).join('')}
      </div>
    </div>`;

  cont.querySelectorAll('[data-reprog-pend]').forEach(b =>
    b.addEventListener('click', () => abrirModalReprogramar(b.dataset.reprogPend, HOY)));
}

async function cancelarCitaConfirmar(citaId, fecha) {
  const motivo = await pedirMotivoCancelacion();
  if (!motivo) return;
  await cancelarCita(citaId, motivo, usuarioActual?.uid, usuarioActual?.nombre);
  mostrarAlerta('alert-cita', 'Cita cancelada.', 'success');
  await Promise.all([cargarSlotsFecha(fecha), actualizarKpis()]);
}

// ── Resumen para informe al admin (citas de la fecha filtrada) ──
// Texto plano del resumen actual, listo para enviar por WhatsApp.
let _reporteTexto = '';

function renderReporteDia(fecha, citas) {
  const stats = document.getElementById('reporte-dia-stats');
  const lista = document.getElementById('reporte-dia-lista');
  const btnWa = document.getElementById('btn-enviar-whatsapp');
  setText('reporte-dia-fecha', formatFechaLegible(fecha));

  if (!citas.length) {
    _reporteTexto = '';
    if (stats) stats.innerHTML = '';
    if (lista) lista.innerHTML = '<p class="empty-state" style="padding:14px">No hay citas para esta fecha.</p>';
    if (btnWa) btnWa.disabled = true;
    return;
  }

  const conteo = {};
  citas.forEach(c => { conteo[c.estado] = (conteo[c.estado] || 0) + 1; });

  const statsArr = [
    ['Total',        citas.length],
    ['Activas',      conteo[ESTADOS.ACTIVA]     || 0],
    ['Completadas',  conteo[ESTADOS.COMPLETADA]  || 0],
    ['Canceladas',   conteo[ESTADOS.CANCELADA]   || 0],
  ];
  if (conteo[ESTADOS.REPROGRAMADA])            statsArr.push(['Reprogramadas', conteo[ESTADOS.REPROGRAMADA]]);
  if (conteo[ESTADOS.PENDIENTE_CONFIRMACION])  statsArr.push(['Pend. confirmación', conteo[ESTADOS.PENDIENTE_CONFIRMACION]]);

  if (stats) stats.innerHTML = statsArr.map(([label, valor]) => `
    <div class="reporte-stat">
      <span class="reporte-stat-valor">${valor}</span>
      <span class="reporte-stat-label">${label}</span>
    </div>`).join('');

  const ordenadas = [...citas].sort((a, b) => a.hora.localeCompare(b.hora));
  if (lista) lista.innerHTML = ordenadas.map(c => `
    <div class="reporte-item">
      <span class="reporte-item-hora">${hora12Display(c.hora)}</span>
      <span class="reporte-item-info">${c.clienteNombre} · ${c.tipo}</span>
      ${badgeEstado(c.estado)}
    </div>`).join('');

  if (btnWa) btnWa.disabled = false;

  const lineasStats = statsArr.map(([l, v]) => `${l}: ${v}`).join(' · ');
  const lineasCitas = ordenadas
    .map(c => `${hora12Display(c.hora)} — ${c.clienteNombre} — ${c.tipo} — ${c.estado}`)
    .join('\n');
  _reporteTexto = `*Resumen de citas*\n${formatFechaLegible(fecha)}\n${lineasStats}\n\n${lineasCitas}`;
}

function formatFechaLegible(fecha) {
  try {
    return new Date(fecha + 'T12:00:00').toLocaleDateString('es-CO', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch { return fecha; }
}

// Botón flotante del resumen + envío por WhatsApp.
function bindReporte() {
  document.getElementById('btn-reporte-fab')?.addEventListener('click', () => abrirModal('modal-reporte'));
  document.getElementById('btn-enviar-whatsapp')?.addEventListener('click', enviarReporteWhatsApp);
}

// Abre WhatsApp (app en móvil, Web en PC) con el resumen ya escrito; el
// agente elige el contacto del administrador. wa.me funciona en cualquier
// plataforma sin depender de dónde se abra la app.
function enviarReporteWhatsApp() {
  if (!_reporteTexto) {
    mostrarAlerta('alert-global', 'No hay citas para enviar en esta fecha.', 'error');
    return;
  }
  const url = `https://wa.me/?text=${encodeURIComponent(_reporteTexto)}`;
  window.open(url, '_blank', 'noopener');
}

// ══════════════════════════════════════════════════════════
// MODAL CITA — agendar (con búsqueda + registro rápido)
// ══════════════════════════════════════════════════════════
function abrirModalCita(horaPreseleccionada = null) {
  document.getElementById('c-buscar-pac').value         = '';
  document.getElementById('c-paciente-id').value        = '';
  document.getElementById('c-paciente-nombre').value    = '';
  document.getElementById('c-paciente-ciudad').value    = '';
  document.getElementById('c-pac-sugerencias').style.display = 'none';
  document.getElementById('quick-register').classList.remove('visible');
  document.getElementById('c-fecha').value = fechaAgenda || HOY;
  if (horaPreseleccionada) setTimePicker('c-hora', horaPreseleccionada);
  abrirModal('modal-cita');
}

function bindFormCita() {
  const inputBuscar = document.getElementById('c-buscar-pac');
  const sugerencias = document.getElementById('c-pac-sugerencias');

  inputBuscar?.addEventListener('input', async () => {
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
      item.addEventListener('click', () => {
        asignarPacienteACita(item.dataset.id, item.dataset.nombre, item.dataset.ciudad || '');
        sugerencias.style.display = 'none';
        document.getElementById('quick-register').classList.remove('visible');
      });
    });
  });

  document.getElementById('btn-quick-save')?.addEventListener('click', async () => {
    const btn    = document.getElementById('btn-quick-save');
    const nombre = document.getElementById('qp-nombre').value.trim();
    const tel    = document.getElementById('qp-tel').value.trim();
    const ciudad = ubicacionString(
      document.getElementById('qp-dpto')?.value,
      document.getElementById('qp-ciudad')?.value
    ) || document.getElementById('qp-pais')?.value || '';

    btn.textContent = 'Guardando...'; btn.disabled = true;
    const res = await registrarPacienteRapido(nombre, tel, ciudad);

    if (res.ok) {
      asignarPacienteACita(res.id, nombre, ciudad);
      document.getElementById('quick-register').classList.remove('visible');
      ['qp-nombre', 'qp-tel'].forEach(id => { document.getElementById(id).value = ''; });
      document.getElementById('qp-dpto').value   = '';
      document.getElementById('qp-ciudad').value = '';
      document.getElementById('qp-pais').value   = '';
      mostrarAlerta('alert-form-cita', `Paciente "${nombre}" registrado.`, 'success');
    } else if (res.paciente) {
      asignarPacienteACita(res.paciente.id, res.paciente.nombre, res.paciente.ciudad || '');
      document.getElementById('quick-register').classList.remove('visible');
      mostrarAlerta('alert-form-cita', 'Paciente ya existente — seleccionado.', 'success');
    } else {
      mostrarAlerta('alert-form-cita', res.error, 'error');
    }

    btn.textContent = 'Guardar y usar este paciente'; btn.disabled = false;
  });

  document.getElementById('btn-guardar-cita')?.addEventListener('click', async () => {
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
      usuarioId:     usuarioActual?.uid    || '',
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
      await Promise.all([
        actualizarKpis(),
        renderDashboardPaneles(avisoAccionNoPermitida, abrirModalCitaDesdeVoz, false, false),
        cargarSlotsFecha(datos.fecha),
      ]);
      setTimeout(() => {
        cerrarModal('modal-cita');
        document.getElementById('c-notas').value = '';
      }, 900);
    } else {
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

function asignarPacienteACita(id, nombre, ciudad) {
  document.getElementById('c-paciente-id').value     = id;
  document.getElementById('c-paciente-nombre').value = nombre;
  document.getElementById('c-paciente-ciudad').value = ciudad;
  document.getElementById('c-buscar-pac').value       = nombre;
}

function abrirModalCitaDesdeVoz(datos) {
  abrirModalCita(datos.hora || null);

  if (datos.fecha) document.getElementById('c-fecha').value = datos.fecha;

  if (datos.tipo) {
    const sel = document.getElementById('c-tipo');
    const opcion = Array.from(sel.options)
      .find(o => o.text.toLowerCase().includes(datos.tipo.toLowerCase()));
    if (opcion) sel.value = opcion.value;
  }

  if (datos.notas) document.getElementById('c-notas').value = datos.notas;

  if (datos.clienteNombre) {
    const input = document.getElementById('c-buscar-pac');
    input.value = datos.clienteNombre;
    input.dispatchEvent(new Event('input'));
  }
}

// ══════════════════════════════════════════════════════════
// MODAL PACIENTE — registro completo
// (call-center puede crear pacientes nuevos, pero no editarlos)
// ══════════════════════════════════════════════════════════
function bindFormPaciente() {
  document.getElementById('btn-guardar-pac')?.addEventListener('click', async () => {
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

      if (_onPacienteRegistrado) {
        _onPacienteRegistrado({ id: res.id, nombre: datos.nombre, telefono: datos.telefono, ciudad: datos.ciudad });
        _onPacienteRegistrado = null;
      }

      setTimeout(() => {
        cerrarModal('modal-paciente');
        ['p-nombre', 'p-doc', 'p-tel', 'p-email', 'p-condicion', 'p-nacimiento']
          .forEach(id => { document.getElementById(id).value = ''; });
        document.getElementById('p-dpto').value   = '';
        document.getElementById('p-ciudad').value = '';
        document.getElementById('p-pais').value   = '';
      }, 900);
    } else {
      mostrarAlerta('alert-form-pac', res.error, 'error');
    }

    btn.textContent = 'Registrar'; btn.disabled = false;
  });
}

// ══════════════════════════════════════════════════════════
// MODAL REPROGRAMAR
// ══════════════════════════════════════════════════════════
function abrirModalReprogramar(citaId, fecha) {
  citaReprogramarId = citaId;
  document.getElementById('r-fecha').value = fecha;
  abrirModal('modal-reprogramar');
}

function bindFormReprogramar() {
  document.getElementById('btn-confirmar-reprog')?.addEventListener('click', async () => {
    const btn   = document.getElementById('btn-confirmar-reprog');
    const fecha = document.getElementById('r-fecha').value;
    const hora  = document.getElementById('r-hora').value;

    btn.textContent = 'Confirmando...'; btn.disabled = true;
    const res = await reprogramarCita(citaReprogramarId, fecha, hora, usuarioActual?.uid, usuarioActual?.nombre);

    if (res.ok) {
      cerrarModal('modal-reprogramar');
      mostrarAlerta('alert-cita', 'Cita reprogramada correctamente.', 'success');
      await Promise.all([cargarSlotsFecha(fechaAgenda), actualizarKpis(), renderPendientesReprogramar()]);
    } else {
      const sugerencia = await sugerirHorario(fecha, hora);
      const alertEl     = document.getElementById('alert-reprog');

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
        document.getElementById('btn-usar-sugerencia-reprog')?.addEventListener('click', () => {
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
// CRONOGRAMA — solo lectura + reprogramar/cancelar
// ══════════════════════════════════════════════════════════
function bindCronograma() {
  document.getElementById('btn-refresh-crono')?.addEventListener('click', () => cargarCronograma());
}

async function cargarCronograma() {
  // El call-center solo puede ver información, reprogramar y cancelar.
  // No completa citas → ocultamos el botón "Completar".
  await renderCronograma({
    permitirCompletar: false,
    onCancelar:    async (id) => {
      const motivo = await pedirMotivoCancelacion();
      if (!motivo) return;
      await cancelarCita(id, motivo, usuarioActual?.uid, usuarioActual?.nombre);
      await actualizarKpis();
    },
    onReprogramar: (id) => abrirModalReprogramar(id, HOY),
  });
}

// ══════════════════════════════════════════════════════════
// PANEL "CLIENTE EN LLAMADA" — búsqueda rápida + agendamiento
// en vivo durante la llamada. Usa los mismos servicios reales
// que el resto del módulo (sin datos de prueba ni endpoints falsos).
// ══════════════════════════════════════════════════════════
function initPanelLlamada() {
  document.getElementById('btn-open-search')?.addEventListener('click', abrirPanelLlamada);
  document.getElementById('btn-close-search')?.addEventListener('click', cerrarPanelLlamada);
  document.getElementById('qsp-back')?.addEventListener('click', volverABusquedaLlamada);

  document.getElementById('btn-search-cliente')?.addEventListener('click', buscarClienteLlamada);
  document.getElementById('quick-search-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') buscarClienteLlamada();
  });

  document.getElementById('btn-quick-book')?.addEventListener('click', agendarCitaRapidaLlamada);
  document.getElementById('quick-book-time')?.addEventListener('change', (e) => {
    const val  = e.target.value;
    const cont = document.getElementById('available-slots-search');
    document.getElementById('btn-quick-book').disabled = !val;
    document.querySelectorAll('.time-slot-search').forEach(el =>
      el.classList.toggle('selected', el.dataset.time === val));
    cont?.classList.toggle('has-selection', !!val);
  });

  // Selector de fecha del panel de llamada (el cliente puede pedir cita
  // para hoy o cualquier otro día).
  document.getElementById('quick-book-fecha')?.addEventListener('change', (e) => {
    fechaLlamada = e.target.value || HOY;
    cargarHorariosDisponiblesLlamada();
  });
  document.getElementById('qsp-fecha-hoy')?.addEventListener('click', () => {
    fechaLlamada = HOY;
    const inp = document.getElementById('quick-book-fecha');
    if (inp) inp.value = HOY;
    cargarHorariosDisponiblesLlamada();
  });
  document.getElementById('qsp-fecha-manana')?.addEventListener('click', () => {
    fechaLlamada = MANANA;
    const inp = document.getElementById('quick-book-fecha');
    if (inp) inp.value = MANANA;
    cargarHorariosDisponiblesLlamada();
  });
}

// Estructura del estado vacío (icono de teléfono minimalista + texto).
const NO_CLIENT_HTML = `
  <div class="empty-illustration">
    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
    </svg>
  </div>
  <p>Ingresa número o nombre del cliente</p>`;

function abrirPanelLlamada() {
  document.getElementById('quick-search-panel')?.classList.add('active');
  document.getElementById('quick-search-input')?.focus();
}

function cerrarPanelLlamada() {
  document.getElementById('quick-search-panel')?.classList.remove('active');
  resetPanelLlamada();
}

// Vuelve a la pantalla de búsqueda (desliza el track a la izquierda).
function volverABusquedaLlamada() {
  clienteLlamadaActual = null;
  document.getElementById('quick-search-panel')?.classList.remove('view-client');
  setText('qsp-titulo', '🔍 Cliente en Llamada');
  document.getElementById('quick-search-input')?.focus();
}

function resetPanelLlamada() {
  clienteLlamadaActual = null;
  fechaLlamada = HOY;
  slotsLibresLlamada = [];
  document.getElementById('quick-search-panel')?.classList.remove('view-client');
  setText('qsp-titulo', '🔍 Cliente en Llamada');
  document.getElementById('quick-search-input').value = '';
  document.getElementById('search-resultados-multiples').style.display = 'none';
  const noClientState = document.getElementById('no-client-state');
  noClientState.style.display = 'flex';
  noClientState.innerHTML = NO_CLIENT_HTML;
  document.getElementById('quick-notes').value = '';
}

async function buscarClienteLlamada() {
  const input   = document.getElementById('quick-search-input');
  const termino = input?.value?.trim();

  if (!termino) {
    mostrarAlerta('alert-global', 'Ingresa un número o nombre.', 'error');
    return;
  }

  const noClientState = document.getElementById('no-client-state');
  const multiples      = document.getElementById('search-resultados-multiples');

  // Aseguramos estar en la pantalla de búsqueda mientras se consulta.
  document.getElementById('quick-search-panel')?.classList.remove('view-client');
  multiples.style.display     = 'none';
  noClientState.style.display = 'flex';
  noClientState.innerHTML     = '<div class="loading-dots">Buscando...</div>';

  const resultados = await buscarPacientes(termino);

  if (!resultados.length) {
    noClientState.innerHTML = `
      <div class="empty-illustration">❌</div>
      <p>Cliente no encontrado</p>
      <button class="btn btn-soft btn-sm" id="btn-registrar-desde-llamada" style="margin-top:10px">
        + Registrar paciente
      </button>`;
    document.getElementById('btn-registrar-desde-llamada')?.addEventListener('click', () => {
      abrirModalPacienteDesdeLlamada(termino);
    });
    return;
  }

  if (resultados.length === 1) {
    seleccionarClienteLlamada(resultados[0]);
    return;
  }

  noClientState.style.display = 'none';
  multiples.style.display = 'block';
  renderResultadosBusqueda('search-resultados-multiples', resultados, (cliente) => {
    multiples.style.display = 'none';
    seleccionarClienteLlamada(cliente);
  }, 'Seleccionar');
}

function abrirModalPacienteDesdeLlamada(termino) {
  const esTelefono = /^[\d+\s-]{6,}$/.test(termino);
  document.getElementById('p-nombre').value = esTelefono ? '' : termino;
  document.getElementById('p-tel').value    = esTelefono ? termino.replace(/\D/g, '') : '';
  _onPacienteRegistrado = (cliente) => seleccionarClienteLlamada(cliente);
  abrirModal('modal-paciente');
}

function seleccionarClienteLlamada(cliente) {
  clienteLlamadaActual = cliente;
  // Por defecto la fecha de agendamiento arranca en hoy, pero el agente
  // puede cambiarla si el cliente pide la cita para otro día.
  fechaLlamada = HOY;
  const inputFecha = document.getElementById('quick-book-fecha');
  if (inputFecha) { inputFecha.value = HOY; inputFecha.min = HOY; }
  mostrarInfoClienteLlamada(cliente);
  cargarHorariosDisponiblesLlamada();
  cargarHistorialClienteLlamada(cliente.id);
}

function mostrarInfoClienteLlamada(cliente) {
  document.getElementById('client-avatar-search').textContent = iniciales(cliente.nombre);
  document.getElementById('client-name-search').textContent   = cliente.nombre;
  document.getElementById('client-phone-search').textContent  = cliente.telefono || 'Sin teléfono';

  const ciudadEl = document.getElementById('client-city-search');
  if (cliente.ciudad) {
    ciudadEl.textContent  = `📍 ${cliente.ciudad}`;
    ciudadEl.style.display = 'block';
  } else {
    ciudadEl.style.display = 'none';
  }

  document.getElementById('quick-notes').value = '';

  // Desliza el track a la pantalla del cliente (horizontal) y muestra
  // el botón de "volver" en el encabezado.
  setText('qsp-titulo', cliente.nombre);
  const panel = document.getElementById('quick-search-panel');
  panel?.classList.add('view-client');
  panel?.scrollTo({ top: 0 });
}

function horaActualStr() {
  const ahora = new Date();
  return `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`;
}

async function cargarHorariosDisponiblesLlamada() {
  const container  = document.getElementById('available-slots-search');
  const selectHora = document.getElementById('quick-book-time');
  const btnAgendar = document.getElementById('btn-quick-book');
  if (!container) return;

  container.innerHTML = '<div class="loading-dots">Cargando...</div>';

  const fecha    = fechaLlamada || HOY;
  const citas    = await obtenerCitasPorFecha(fecha);
  const ocupadas = new Set(citas.filter(c => c.estado !== ESTADOS.CANCELADA).map(c => c.hora));
  let libres     = HORARIOS.filter(h => !ocupadas.has(h));

  // Si la cita es para HOY, descartamos horarios que ya pasaron.
  if (fecha === HOY) {
    const ahora = horaActualStr();
    libres = libres.filter(h => h >= ahora);
  }
  slotsLibresLlamada = libres;

  if (!slotsLibresLlamada.length) {
    const msg = fecha === HOY ? 'Sin disponibilidad hoy' : 'Sin disponibilidad ese día';
    container.innerHTML = `<div class="loading-dots">${msg}</div>`;
    selectHora.innerHTML = '<option value="">Sin horarios</option>';
    selectHora.disabled = true;
    btnAgendar.disabled = true;
    return;
  }

  container.innerHTML = slotsLibresLlamada.map(hora => `
    <div class="time-slot-search" data-time="${hora}">
      <span class="slot-time-search">${hora12Display(hora)}</span>
    </div>`).join('');

  container.querySelectorAll('.time-slot-search').forEach(el => {
    el.addEventListener('click', () => {
      const yaSeleccionado = el.classList.contains('selected');
      if (yaSeleccionado) {
        // Volver a tocar la hora elegida → se deselecciona y reaparecen
        // todas las horas disponibles.
        el.classList.remove('selected');
        container.classList.remove('has-selection');
        selectHora.value = '';
        btnAgendar.disabled = true;
      } else {
        // Al elegir una hora, las demás se ocultan (vía .has-selection).
        container.querySelectorAll('.time-slot-search').forEach(s => s.classList.remove('selected'));
        el.classList.add('selected');
        container.classList.add('has-selection');
        selectHora.value = el.dataset.time;
        btnAgendar.disabled = false;
      }
    });
  });

  selectHora.innerHTML = '<option value="">Selecciona horario</option>' +
    slotsLibresLlamada.map(h => `<option value="${h}">${hora12Display(h)}</option>`).join('');
  selectHora.disabled = false;
  btnAgendar.disabled = true;
  container.classList.remove('has-selection');
}

async function cargarHistorialClienteLlamada(clienteId) {
  const container = document.getElementById('history-citas-list');
  if (!container) return;

  container.innerHTML = '<div class="loading-dots">Cargando...</div>';
  const citas = await obtenerCitasPorCliente(clienteId);

  if (!citas.length) {
    container.innerHTML = '<p class="empty-state">Sin registros previos</p>';
    return;
  }

  container.innerHTML = citas.slice(0, 3).map(cita => `
    <div class="cita-history-item">
      <span class="cita-date">${formatearFechaCorta(cita.fecha)} · ${hora12Display(cita.hora)}</span>
      <span class="cita-service">${cita.tipo} — ${cita.estado}</span>
    </div>`).join('');
}

function formatearFechaCorta(fechaStr) {
  try {
    return new Date(fechaStr + 'T12:00:00').toLocaleDateString('es-CO', { month: 'short', day: 'numeric' });
  } catch { return fechaStr; }
}

async function agendarCitaRapidaLlamada() {
  if (!clienteLlamadaActual) {
    mostrarAlerta('alert-global', 'Selecciona un cliente primero.', 'error');
    return;
  }

  const selectHora     = document.getElementById('quick-book-time');
  const selectServicio = document.getElementById('quick-book-service');
  const notasInput     = document.getElementById('quick-notes');
  const hora           = selectHora?.value;
  const fecha          = fechaLlamada || HOY;

  if (!hora) {
    mostrarAlerta('alert-global', 'Selecciona un horario disponible.', 'error');
    return;
  }

  const btn = document.getElementById('btn-quick-book');
  btn.disabled = true; btn.textContent = '⏳ Guardando...';

  const res = await agendarCita({
    clienteId:     clienteLlamadaActual.id,
    clienteNombre: clienteLlamadaActual.nombre,
    clienteCiudad: clienteLlamadaActual.ciudad || '',
    usuarioId:     usuarioActual?.uid    || '',
    usuarioNombre: usuarioActual?.nombre || '',
    fecha,
    hora,
    tipo:          selectServicio?.value || 'Ajuste general',
    notas:         notasInput?.value?.trim() || '',
  });

  if (res.ok) {
    const cuando = fecha === HOY ? 'hoy' : `el ${formatearFechaCorta(fecha)}`;
    // Cerramos el panel; el toast global queda visible fuera de él.
    cerrarPanelLlamada();
    mostrarAlerta('alert-global', `✓ Cita guardada correctamente ${cuando} a las ${hora12Display(hora)}.`, 'success');
    await Promise.all([
      actualizarKpis(),
      renderDashboardPaneles(avisoAccionNoPermitida, abrirModalCitaDesdeVoz, false, false),
      document.getElementById('view-citas')?.classList.contains('active')
        ? cargarSlotsFecha(fechaAgenda)
        : Promise.resolve(),
    ]);
  } else {
    mostrarAlerta('alert-global', res.error, 'error');
  }

  btn.textContent = '✓ Agendar'; btn.disabled = false;
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

// ══════════════════════════════════════════════════════════
// LOGOUT
// ══════════════════════════════════════════════════════════
function bindLogout() {
  const salir = async () => {
    await logout();
    window.location.href = '/index.html';
  };
  document.getElementById('btn-logout')?.addEventListener('click', salir);
  document.getElementById('btn-logout-config')?.addEventListener('click', salir);
}
