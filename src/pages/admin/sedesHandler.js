// src/pages/admin/sedesHandler.js
// Lógica de la pantalla "Sedes y viajes" (solo administrador).

import { inicializarSelectsUbicacion, restaurarUbicacion } from '../../modules/pacientes/colombiaService.js';
import { crearViaje, obtenerViajes, eliminarViaje, actualizarViaje } from '../../modules/viajes/viajesService.js';
import { obtenerCitasPorRangoFecha, ESTADOS } from '../../modules/citas/citasService.js';
import { mostrarAlerta, abrirModal, cerrarModal, HOY } from '../../shared/helpers.js';
import { confirmar, toast } from '../../shared/interactions.js';
import { hora12Display } from '../../shared/timePicker.js';

let usuarioActual = null;
let _getUbicacion = () => '';     // form nuevo viaje
let _getUbicacionEdit = () => ''; // modal editar
let _editSelectsListo = false;
let _viajesCache = [];

export async function initSedes(usuario) {
  usuarioActual = usuario || null;

  // Selects del formulario "nuevo viaje"
  _getUbicacion = await inicializarSelectsUbicacion(
    document.getElementById('v-dpto'), document.getElementById('v-ciudad'));

  const fIni = document.getElementById('v-fecha-inicio');
  const fFin = document.getElementById('v-fecha-fin');
  if (fIni) fIni.min = HOY;
  if (fFin) fFin.min = HOY;
  fIni?.addEventListener('change', () => { if (fFin) fFin.min = fIni.value || HOY; });

  document.getElementById('btn-guardar-viaje')?.addEventListener('click', guardarViaje);

  // Filtro de historial (por defecto últimos 3 meses, modificable)
  setRango3Meses();
  document.getElementById('btn-hist-filtrar')?.addEventListener('click', renderHistorial);
  document.getElementById('btn-hist-3meses')?.addEventListener('click', () => { setRango3Meses(); renderHistorial(); });

  // Cierre de modales
  document.querySelectorAll('[data-close]').forEach(el =>
    el.addEventListener('click', () => cerrarModal(el.dataset.close)));
  document.querySelectorAll('.modal-overlay').forEach(ov =>
    ov.addEventListener('click', e => { if (e.target === ov) cerrarModal(ov.id); }));

  document.getElementById('btn-actualizar-viaje')?.addEventListener('click', actualizarViajeHandler);

  await recargar();
}

// Recarga la lista completa desde Firestore y pinta ambas secciones.
async function recargar() {
  _viajesCache = await obtenerViajes();
  renderProximos();
  renderHistorial();
}

// ── Crear viaje ────────────────────────────────────────────
async function guardarViaje() {
  const btn  = document.getElementById('btn-guardar-viaje');
  const ubic = _getUbicacion();
  const [departamento, ciudad] = ubic.includes(' > ') ? ubic.split(' > ') : ['', ubic];

  const datos = {
    departamento, ciudad,
    fechaInicio: getVal('v-fecha-inicio'),
    fechaFin:    getVal('v-fecha-fin'),
    horaInicio:  getVal('v-hora-inicio'),
    horaFin:     getVal('v-hora-fin'),
  };

  if (!ciudad)                              { toast('Selecciona el departamento y la ciudad destino.', 'error'); return; }
  if (!datos.fechaInicio || !datos.fechaFin) { toast('Selecciona las fechas del viaje.', 'error'); return; }

  btn.disabled = true; btn.textContent = 'Guardando...';
  const res = await crearViaje(datos, usuarioActual?.uid, usuarioActual?.nombre);
  btn.disabled = false; btn.textContent = 'Programar viaje';

  if (res.ok) {
    let msg = `Viaje a ${res.ciudadFull} programado.`;
    if (res.citasAfectadas > 0) msg += ` ${res.citasAfectadas} cita(s) quedaron pendientes por reprogramar.`;
    toast(msg, 'success');
    document.getElementById('v-fecha-inicio').value = '';
    document.getElementById('v-fecha-fin').value    = '';
    await recargar();
  } else {
    toast(res.error, 'error');
  }
}

// ── Historial / gestión ────────────────────────────────────
function setRango3Meses() {
  const hasta = HOY;
  const d = new Date(HOY + 'T12:00:00');
  d.setMonth(d.getMonth() - 3);
  const desde = d.toLocaleDateString('en-CA');
  setVal('hist-desde', desde);
  setVal('hist-hasta', hasta);
}

// Próximos viajes: en curso o a futuro (fechaFin >= hoy). Soonest primero.
function renderProximos() {
  const proximos = _viajesCache
    .filter(v => v.fechaFin >= HOY)
    .sort((a, b) => (a.fechaInicio || '').localeCompare(b.fechaInicio || ''));
  pintarLista('proximos-lista', proximos, 'No hay viajes próximos programados.');
}

// Historial: viajes ya pasados (fechaFin < hoy) dentro del rango filtrado.
function renderHistorial() {
  const desde = getVal('hist-desde');
  const hasta = getVal('hist-hasta');
  const pasados = _viajesCache
    .filter(v => v.fechaFin < HOY)
    .filter(v => (!desde || v.fechaFin >= desde) && (!hasta || v.fechaInicio <= hasta))
    .sort((a, b) => (b.fechaInicio || '').localeCompare(a.fechaInicio || ''));
  pintarLista('viajes-lista', pasados, 'No hay viajes en este rango de fechas.');
}

// Pinta una lista de viajes en un contenedor y enlaza sus acciones.
function pintarLista(containerId, viajes, vacioMsg) {
  const cont = document.getElementById(containerId);
  if (!cont) return;

  if (!viajes.length) {
    cont.innerHTML = `<div class="empty-state">${vacioMsg}</div>`;
    return;
  }

  cont.innerHTML = viajes.map(v => {
    const vigente = v.fechaInicio <= HOY && v.fechaFin >= HOY;
    return `
      <div style="border:1px solid var(--th-card-border,#ebebeb);border-left:4px solid #7c3aed;
                  border-radius:10px;margin-bottom:12px;background:var(--th-card,#fff);overflow:hidden">
        <div style="padding:12px 14px">
          <div style="font-weight:700;color:var(--th-text,#161c2d);display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            📍 ${v.ciudadFull}
            ${vigente ? '<span class="badge" style="background:#ede9fe;color:#6d28d9">En curso</span>' : ''}
          </div>
          <div style="font-size:12.5px;color:var(--th-text2,#8492a6);margin-top:3px">
            ${formatFecha(v.fechaInicio)} → ${formatFecha(v.fechaFin)} · ${hora12Display(v.horaInicio)} a ${hora12Display(v.horaFin)}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;padding:0 14px 12px">
          <button class="btn btn-soft btn-sm"  data-finanzas="${v.id}">💰 Finanzas</button>
          <button class="btn btn-soft btn-sm"  data-citas="${v.id}">📅 Citas</button>
          <button class="btn btn-soft btn-sm"  data-clientes="${v.id}">👥 Clientes atendidos</button>
          <button class="btn btn-soft btn-sm"  data-informe="${v.id}">📄 Informe</button>
          <button class="btn btn-gray btn-sm"  data-editar="${v.id}">✎ Editar</button>
          <button class="btn btn-danger btn-sm" data-eliminar="${v.id}">🗑 Eliminar</button>
        </div>
      </div>`;
  }).join('');

  // Redirecciones (reutilizan informes.html y el dashboard con parámetros)
  cont.querySelectorAll('[data-finanzas]').forEach(b => b.addEventListener('click', () => {
    const v = viajePorId(b.dataset.finanzas);
    if (v) window.location.href = `./informes.html?sec=sec-finanzas&desde=${v.fechaInicio}&hasta=${v.fechaFin}`;
  }));
  cont.querySelectorAll('[data-citas]').forEach(b => b.addEventListener('click', () => {
    const v = viajePorId(b.dataset.citas);
    if (v) window.location.href = `./dashboard.html?view=citas&fecha=${v.fechaInicio}`;
  }));
  cont.querySelectorAll('[data-informe]').forEach(b => b.addEventListener('click', () => {
    const v = viajePorId(b.dataset.informe);
    if (v) window.location.href = `./informes.html?sec=sec-citas&desde=${v.fechaInicio}&hasta=${v.fechaFin}`;
  }));
  cont.querySelectorAll('[data-clientes]').forEach(b => b.addEventListener('click', () =>
    verClientesAtendidos(viajePorId(b.dataset.clientes))));
  cont.querySelectorAll('[data-editar]').forEach(b => b.addEventListener('click', () =>
    abrirEditarViaje(viajePorId(b.dataset.editar))));
  cont.querySelectorAll('[data-eliminar]').forEach(b => b.addEventListener('click', () =>
    eliminarViajeHandler(b.dataset.eliminar)));
}

function viajePorId(id) { return _viajesCache.find(v => v.id === id) || null; }

// ── Clientes atendidos en el viaje ─────────────────────────
async function verClientesAtendidos(v) {
  if (!v) return;
  abrirModal('modal-clientes');
  setText('modal-clientes-sub', `${v.ciudadFull} · ${formatFecha(v.fechaInicio)} → ${formatFecha(v.fechaFin)}`);
  const cont = document.getElementById('modal-clientes-lista');
  cont.innerHTML = '<div class="empty-state">Cargando...</div>';

  const citas = await obtenerCitasPorRangoFecha(v.fechaInicio, v.fechaFin);
  // Citas atendidas (completadas) de la sede del viaje
  const atendidas = citas.filter(c =>
    c.estado === ESTADOS.COMPLETADA && (c.sede || '') === v.ciudadFull);

  if (!atendidas.length) {
    cont.innerHTML = '<div class="empty-state">No se registraron clientes atendidos en este viaje.</div>';
    return;
  }

  atendidas.sort((a, b) => `${a.fecha}${a.hora}`.localeCompare(`${b.fecha}${b.hora}`));
  cont.innerHTML = `
    <div style="overflow-x:auto">
      <table class="data-table">
        <thead><tr><th>Fecha</th><th>Hora</th><th>Paciente</th><th>Tipo</th></tr></thead>
        <tbody>
          ${atendidas.map(c => `
            <tr>
              <td>${formatFecha(c.fecha)}</td>
              <td>${hora12Display(c.hora)}</td>
              <td>${c.clienteNombre}</td>
              <td>${c.tipo}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <p style="font-size:12px;color:var(--th-text2,#8492a6);margin-top:10px">${atendidas.length} cliente(s) atendido(s).</p>`;
}

// ── Editar viaje ───────────────────────────────────────────
async function abrirEditarViaje(v) {
  if (!v) return;
  setVal('e-id', v.id);
  setVal('e-fecha-inicio', v.fechaInicio);
  setVal('e-fecha-fin',    v.fechaFin);
  setVal('e-hora-inicio',  v.horaInicio || '09:00');
  setVal('e-hora-fin',     v.horaFin    || '18:00');

  if (!_editSelectsListo) {
    _getUbicacionEdit = await inicializarSelectsUbicacion(
      document.getElementById('e-dpto'), document.getElementById('e-ciudad'));
    _editSelectsListo = true;
  }
  await restaurarUbicacion(document.getElementById('e-dpto'), document.getElementById('e-ciudad'), v.ciudadFull);

  abrirModal('modal-editar-viaje');
}

async function actualizarViajeHandler() {
  const btn  = document.getElementById('btn-actualizar-viaje');
  const id   = getVal('e-id');
  const ubic = _getUbicacionEdit();
  const [departamento, ciudad] = ubic.includes(' > ') ? ubic.split(' > ') : ['', ubic];

  const datos = {
    departamento, ciudad,
    fechaInicio: getVal('e-fecha-inicio'),
    fechaFin:    getVal('e-fecha-fin'),
    horaInicio:  getVal('e-hora-inicio'),
    horaFin:     getVal('e-hora-fin'),
  };

  if (!ciudad) { mostrarAlerta('alert-editar-viaje', 'Selecciona departamento y ciudad.', 'error'); return; }

  btn.disabled = true; btn.textContent = 'Guardando...';
  const res = await actualizarViaje(id, datos, usuarioActual?.uid, usuarioActual?.nombre);
  btn.disabled = false; btn.textContent = 'Guardar cambios';

  if (res.ok) {
    cerrarModal('modal-editar-viaje');
    toast(`Viaje actualizado a ${res.ciudadFull}.`, 'success');
    await recargar();
  } else {
    mostrarAlerta('alert-editar-viaje', res.error, 'error');
  }
}

// ── Eliminar viaje ─────────────────────────────────────────
async function eliminarViajeHandler(id) {
  const ok = await confirmar({
    titulo: 'Eliminar viaje',
    mensaje: 'Las citas que quedaron pendientes se reactivarán si su cupo sigue libre.',
    tipo: 'danger',
    textoConfirmar: 'Eliminar',
  });
  if (!ok) return;
  const res = await eliminarViaje(id, usuarioActual?.uid, usuarioActual?.nombre);
  if (res.ok) {
    let msg = 'Viaje eliminado.';
    if (res.reactivadas > 0) msg += ` ${res.reactivadas} cita(s) reactivada(s).`;
    toast(msg, 'success');
    await recargar();
  } else {
    toast(res.error, 'error');
  }
}

// ── Utilidades ─────────────────────────────────────────────
function formatFecha(fecha) {
  try {
    return new Date(fecha + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return fecha; }
}
function getVal(id) { return document.getElementById(id)?.value || ''; }
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
function setText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }
