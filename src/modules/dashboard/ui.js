// src/modules/dashboard/ui.js — Renderizado de vistas, slots, pacientes y estadísticas
// ══════════════════════════════════════════════════════════
import { 
  obtenerPagosHoy, 
  obtenerPagosMes, 
  calcularTotalesDia, 
  calcularTotalesMes, 
  formatCOP 
} from '../finanzas/pagosService.js';
import { iniciales, badgeEstado, HOY, mostrarAlerta, copiarTelefono, escapeHtml } from '../../shared/helpers.js';
import { confirmar, toast }            from '../../shared/interactions.js';
import { hora12Display }               from '../../shared/timePicker.js';
import { obtenerCitasPorFecha, obtenerCitasPorRangoFecha, obtenerCitasPendientesConfirmacion, obtenerCitasPorCliente, ESTADOS, HORARIOS } from '../citas/citasService.js';
import { obtenerPacientes, obtenerPacientesPorCiudad, obtenerPacientePorId, buscarPacientes, actualizarPaciente, obtenerPacientesPaginados, filtrarPorCiudad } from '../pacientes/pacientesService.js';
import { obtenerDepartamentos, obtenerCiudades, restaurarUbicacion, inicializarSelectsUbicacion } from '../pacientes/colombiaService.js';

// ── Helper: escribe en un elemento solo si existe ─────────
function setEl(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// ── Helper: anima el conteo de 0 al valor final (KPIs) ─────
function animarValor(id, valorFinal, formatear = (v) => String(v)) {
  const el = document.getElementById(id);
  if (!el || !Number.isFinite(valorFinal)) { setEl(id, formatear(valorFinal)); return; }
  const duracion = 700;
  const inicio = performance.now();
  function paso(ahora) {
    const p = Math.min((ahora - inicio) / duracion, 1);
    const suavizado = 1 - Math.pow(1 - p, 3);
    el.textContent = formatear(Math.round(valorFinal * suavizado));
    if (p < 1) requestAnimationFrame(paso);
  }
  requestAnimationFrame(paso);
} 

// ══════════════════════════════════════════════════════════
// PERFIL SIDEBAR
// ══════════════════════════════════════════════════════════
export function renderPerfil(usuario) {
  const partes = (usuario.nombre || 'U').trim().split(' ');
  const avatar = (partes[0][0] + (partes[1] ? partes[1][0] : '')).toUpperCase();
  setEl('sidebar-avatar', avatar);
  setEl('sidebar-nombre', usuario.nombre || usuario.email);
  setEl('sidebar-rol',    usuario.rol    || '—');
}

// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
// ESTADÍSTICAS DEL DASHBOARD (Corregido con consulta de pagos)
// ══════════════════════════════════════════════════════════
export async function renderEstadisticas() {
  setEl('dash-fecha',
    new Date().toLocaleDateString('es-CO', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    })
  );

  // 1. CARGAMOS CITAS Y PACIENTES
  try {
    const [citasHoy, todosPac] = await Promise.all([
      obtenerCitasPorFecha(HOY),
      obtenerPacientes(),
    ]);

    const completadasHoy = citasHoy.filter(c => c.estado === ESTADOS.COMPLETADA).length;
    const activasHoy     = citasHoy.filter(c => c.estado === ESTADOS.ACTIVA).length;
    const canceladasHoy  = citasHoy.filter(c => c.estado === ESTADOS.CANCELADA).length;
    const totalDelDia    = citasHoy.length;                    // incluye canceladas — solo para el % de cancelación
    const totalAgendadas = totalDelDia - canceladasHoy;         // KPI "Citas hoy": lo realmente agendado, sin canceladas

    animarValor('stat-citas',      totalAgendadas);
    animarValor('stat-pacientes',  todosPac.length);
    animarValor('stat-pendientes', activasHoy);
    animarValor('stat-canceladas', canceladasHoy);

    setEl('kpi-sub-citas',   `${completadasHoy} completadas · ${activasHoy} activas`);
    setEl('kpi-sub-cancel',  totalDelDia > 0
      ? `${Math.round(canceladasHoy / totalDelDia * 100)}% de cancelacion hoy`
      : 'Sin citas registradas hoy');
  } catch (error) {
    console.error("Error cargando citas o pacientes:", error);
  }

  // 2. CARGAMOS FINANZAS Y CALCULAMOS TOTALES
  try {
    // Calculamos el mes actual en formato "YYYY-MM" para pasárselo a Firestore
    const fechaActual = new Date();
    const mesActual = `${fechaActual.getFullYear()}-${String(fechaActual.getMonth() + 1).padStart(2, '0')}`;

    // Descargamos los recibos de la base de datos (hoy y todo el mes)
    const [pagosDeHoy, pagosDelMes] = await Promise.all([
      obtenerPagosHoy(HOY),
      obtenerPagosMes(mesActual)
    ]);

    // Procesamos la suma usando tus funciones
    const sumaHoy = calcularTotalesDia(pagosDeHoy);
    const sumaMes = calcularTotalesMes(pagosDelMes);

    // Las funciones devuelven un objeto { total, soloSesiones, etc. }, extraemos el 'total'
    animarValor('stat-ingresos-dia', sumaHoy.total, formatCOP);
    animarValor('stat-ingresos-mes', sumaMes.total, formatCOP);

  } catch (error) {
    console.error("Error específico cargando ingresos:", error);
    setEl('stat-ingresos-dia', 'Sin datos');
    setEl('stat-ingresos-mes', 'Sin datos');
  }
}

// ══════════════════════════════════════════════════════════
// TABLA DE CITAS DE HOY
// ══════════════════════════════════════════════════════════
export async function renderCitasHoy(onCompletar) {
  const citas = await obtenerCitasPorFecha(HOY);
  const tbody = document.getElementById('dash-tbody');
  if (!tbody) return;

  if (!citas.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No hay citas para hoy</td></tr>';
    return;
  }

  tbody.innerHTML = citas.map(c => `
    <tr
        data-cliente-id="${escapeHtml(c.clienteId || '')}"
        data-cliente-ciudad="${escapeHtml(c.clienteCiudad || '')}"
        data-tipo-sesion="${escapeHtml(c.tipo || 'Ajuste general')}"
        data-hora="${escapeHtml(c.hora)}">
      <td>${hora12Display(c.hora)}</td>
      <td class="citahoy-nombre">${escapeHtml(c.clienteNombre)}</td>
      <td>${escapeHtml(c.clienteCiudad || '—')}</td>
      <td>${escapeHtml(c.tipo)}</td>
      <td>${badgeEstado(c.estado)}</td>
      <td>${c.estado === ESTADOS.ACTIVA
        ? `<button class="btn btn-soft btn-sm" data-completar="${c.id}">Completar</button>`
        : '—'
      }</td>
    </tr>`).join('');

  tbody.querySelectorAll('[data-completar]').forEach(btn =>
    btn.addEventListener('click', () => onCompletar(btn.dataset.completar))
  );
}

// ══════════════════════════════════════════════════════════
// SLOTS DE CITAS
// ══════════════════════════════════════════════════════════
export async function renderSlots(fecha, { onAgendar, onCompletar, onReprogramar, onCancelar, onVerPaciente = null, onVerHistorial = null, bloqueo = null, banner = null, horarios = null }) {
  const cont = document.getElementById('slots-container');
  if (!cont) return;
  cont.classList.remove('slots-viaje');
  cont.innerHTML = '<div class="empty-state">Cargando agenda...</div>';

  // Fecha bloqueada por viaje (sede local cerrada) — no se muestran slots.
  if (bloqueo) {
    cont.innerHTML = `
      <div class="empty-state" style="border:1px dashed #c4b5fd;background:#f5f3ff;color:#6d28d9;
                  border-radius:12px;padding:28px 20px">
        <div style="font-size:30px;margin-bottom:8px">🔒✈️</div>
        <div style="font-weight:700;font-size:15px">Bloqueado por motivo de viaje</div>
        <div style="font-size:13px;margin-top:4px">El quiropráctico estará en ${escapeHtml(bloqueo.ciudad)} esta fecha.</div>
      </div>`;
    return;
  }

  const slots = horarios || HORARIOS;
  if (!slots.length) {
    cont.innerHTML = '<div class="empty-state">Sin horarios configurados</div>';
    return;
  }

  // Tinte morado pastel cuando la fecha es un viaje (vista del admin).
  cont.classList.toggle('slots-viaje', !!banner);

  const citas      = await obtenerCitasPorFecha(fecha);
  const porHora     = Object.fromEntries(
    citas.filter(c => c.estado !== ESTADOS.CANCELADA).map(c => [c.hora, c])
  );
  const citasPorId  = Object.fromEntries(citas.map(c => [c.id, c]));

  const bannerHtml = banner
    ? `<div style="margin-bottom:12px;padding:10px 14px;border-radius:10px;border-left:4px solid #7c3aed;
              background:#f5f3ff;color:#6d28d9;font-size:13px;font-weight:600">${banner}</div>`
    : '';

  // Las citas de mostrador no caen en la grilla fija de 20 min (van en
  // huecos entre citas o hasta 1h antes/después de la jornada) — se
  // intercalan aquí en su posición cronológica real, entre los slots
  // normales, para que la vista de Citas también las muestre.
  const filas = slots.map(hora => ({ hora, cita: porHora[hora] || null }));
  citas
    .filter(c => c.estado !== ESTADOS.CANCELADA && !slots.includes(c.hora))
    .forEach(c => filas.push({ hora: c.hora, cita: c }));
  filas.sort((a, b) => a.hora.localeCompare(b.hora));

  cont.innerHTML = bannerHtml + filas.map(({ hora, cita }) => {
    const display = hora12Display(hora);
    if (cita) {
      return `
        <div class="slot-row${cita.mostrador ? ' slot-row-mostrador' : ''}"
             data-cliente-id="${escapeHtml(cita.clienteId || '')}"
             data-cliente-ciudad="${escapeHtml(cita.clienteCiudad || '')}"
             data-tipo-sesion="${escapeHtml(cita.tipo || 'Ajuste general')}"
             data-hora="${escapeHtml(cita.hora)}">
          <div class="slot-time">${display}</div>
          <div class="slot-info">
            <div class="slot-name" data-ver-paciente="${escapeHtml(cita.clienteId)}" style="cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px">${escapeHtml(cita.clienteNombre)}</div>
            <div class="slot-meta">${escapeHtml(cita.tipo)} · ${escapeHtml(cita.clienteCiudad || 'Ciudad no registrada')}</div>
          </div>
          ${cita.mostrador ? '<span class="badge-mostrador">Mostrador</span>' : ''}
          ${badgeEstado(cita.estado)}
          <div class="slot-actions" style="display:flex;gap:6px;margin-left:8px">
            <button class="btn btn-gray btn-sm" data-historial="${cita.id}" title="Ver información e historial">ℹ Info</button>
            ${cita.estado === ESTADOS.ACTIVA ? `
              <button class="btn btn-soft btn-sm"   data-reprog="${cita.id}">Reprogramar</button>
              <button class="btn btn-danger btn-sm" data-cancelar="${cita.id}">Cancelar</button>
              <button class="btn btn-gray btn-sm"   data-completar="${cita.id}">Completar</button>
            ` : ''}
          </div>
        </div>`;
    }
    return `
      <div class="slot-row slot-disponible">
        <div class="slot-time">${display}</div>
        <div class="slot-empty">Disponible</div>
        <button class="btn btn-soft btn-sm" data-agendar-hora="${hora}">+ Agendar</button>
      </div>`;
  }).join('');

  cont.querySelectorAll('[data-agendar-hora]').forEach(b =>
    b.addEventListener('click', () => onAgendar(b.dataset.agendarHora, fecha)));
  cont.querySelectorAll('[data-completar]').forEach(b =>
    b.addEventListener('click', () => onCompletar(b.dataset.completar, fecha)));
  cont.querySelectorAll('[data-reprog]').forEach(b =>
    b.addEventListener('click', () => onReprogramar(b.dataset.reprog, fecha)));
  cont.querySelectorAll('[data-cancelar]').forEach(b =>
    b.addEventListener('click', () => onCancelar(b.dataset.cancelar, fecha)));
  if (onVerPaciente) {
    cont.querySelectorAll('[data-ver-paciente]').forEach(b =>
      b.addEventListener('click', () => onVerPaciente(b.dataset.verPaciente)));
  }
  cont.querySelectorAll('[data-historial]').forEach(b =>
    b.addEventListener('click', () => {
      const cita = citasPorId[b.dataset.historial];
      if (cita) (onVerHistorial || mostrarHistorialCita)(cita);
    }));
}

// ══════════════════════════════════════════════════════════
// MODAL DE INFORMACIÓN E HISTORIAL DE UNA CITA
// Muestra los datos del paciente y el registro de cambios
// (creación, reprogramación, cancelación, pago/confirmación)
// junto con el usuario responsable de cada acción.
// ══════════════════════════════════════════════════════════
function formatFechaHistorial(iso) {
  try {
    return new Date(iso).toLocaleString('es-CO', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso || '—'; }
}

export async function mostrarHistorialCita(cita) {
  let modal = document.getElementById('modal-historial-cita');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-historial-cita';
    modal.className = 'modal-overlay';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal-box" style="width:480px">
      <button class="modal-close" id="mhc-cerrar">&times;</button>
      <div class="modal-title">Información de la cita</div>
      <div id="mhc-paciente" style="font-size:13px;color:var(--text-muted)">Cargando datos del paciente...</div>
      <div style="margin-top:16px">
        <div style="font-weight:600;font-size:13px;color:var(--th-text);margin-bottom:8px">Historial de cambios</div>
        <div id="mhc-historial"></div>
      </div>
    </div>`;
  modal.classList.add('open');

  const cerrar = () => modal.classList.remove('open');
  document.getElementById('mhc-cerrar')?.addEventListener('click', cerrar);
  modal.addEventListener('click', e => { if (e.target === modal) cerrar(); });

  const historial = [...(cita.historial || [])].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  document.getElementById('mhc-historial').innerHTML = historial.length
    ? historial.map(h => `
        <div style="padding:10px 12px;border:1px solid var(--th-card-border);border-radius:8px;margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;font-size:12.5px;font-weight:600;color:var(--th-text)">
            <span>${escapeHtml(h.accion)}</span>
            <span style="color:var(--text-muted);font-weight:400">${formatFechaHistorial(h.fecha)}</span>
          </div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px">Por: ${escapeHtml(h.usuarioNombre || 'Sistema')}</div>
          ${h.detalle ? `<div style="font-size:12px;color:var(--th-text);margin-top:4px">${escapeHtml(h.detalle)}</div>` : ''}
        </div>`).join('')
    : `<div style="font-size:12.5px;color:var(--text-muted)">Sin registros de cambios todavía.</div>`;

  const pac = await obtenerPacientePorId(cita.clienteId).catch(() => null);
  const pacienteEl = document.getElementById('mhc-paciente');
  if (pacienteEl) {
    pacienteEl.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:2px">
        <div style="font-size:14px;font-weight:700;color:var(--th-text)">${escapeHtml(cita.clienteNombre || pac?.nombre || 'Paciente')}</div>
        <div>Ciudad: ${escapeHtml(cita.clienteCiudad || pac?.ciudad || '—')}</div>
        <div>Teléfono: ${escapeHtml(pac?.telefono || '—')}</div>
        <div>Documento: ${escapeHtml(pac?.documento || '—')}</div>
        <div>Tipo de sesión: ${escapeHtml(cita.tipo || '—')}</div>
        <div>Fecha/hora de la cita: ${escapeHtml(cita.fecha || '—')} ${escapeHtml(cita.hora || '')}</div>
      </div>`;
  }
}

// ══════════════════════════════════════════════════════════
// MODAL — Ver / editar paciente (usado desde Citas y desde el
// gestor de pacientes; mismo modal en ambos lugares).
// ══════════════════════════════════════════════════════════
export async function abrirModalPaciente(pacienteId, { onGuardado } = {}) {
  let modal = document.getElementById('modal-editar-paciente');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-editar-paciente';
    modal.className = 'modal-overlay';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="modal-box" style="width:560px">
      <button class="modal-close" id="mep-cerrar">&times;</button>
      <div class="modal-title">Editar paciente</div>
      <div id="mep-body" style="font-size:13px;color:var(--text-muted)">Cargando datos del paciente...</div>
    </div>`;
  modal.classList.add('open');

  const cerrar = () => modal.classList.remove('open');
  document.getElementById('mep-cerrar')?.addEventListener('click', cerrar);
  modal.addEventListener('click', e => { if (e.target === modal) cerrar(); });

  const pac = await obtenerPacientePorId(pacienteId);
  const body = document.getElementById('mep-body');
  if (!pac || !body) {
    if (body) body.innerHTML = `<div style="color:var(--danger)">No se encontró el paciente.</div>`;
    return;
  }

  body.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
      <div class="avatar" style="width:36px;height:36px;font-size:13px;flex-shrink:0">${escapeHtml(iniciales(pac.nombre))}</div>
      <div>
        <div style="font-weight:700;font-size:14px;color:var(--th-text)">${escapeHtml(pac.nombre)}</div>
        <div style="font-size:11px;color:var(--text-muted)">${escapeHtml(pac.telefono || '—')} · ${escapeHtml(pac.ciudad || 'Sin ciudad')}</div>
      </div>
    </div>
    <div id="alert-mep" style="margin-bottom:10px"></div>
    <div class="form-row-2col">
      <div class="form-group"><label class="form-label">Nombre completo <span>*</span></label>
        <input class="input-text" id="mep-nombre" value="${escapeHtml(pac.nombre || '')}"/></div>
      <div class="form-group"><label class="form-label">Teléfono <span style="font-weight:400;color:var(--text-muted);font-size:11px">(no editable)</span></label>
        <div style="display:flex;gap:6px;align-items:center">
          <input class="input-text" value="${escapeHtml(pac.telefono || '')}" disabled style="opacity:.6;cursor:not-allowed;flex:1"/>
          ${pac.telefono ? `<button class="crm-copy-btn" data-copiar="${escapeHtml(pac.telefono)}" title="Copiar número" type="button" style="width:32px;height:32px;border:1px solid var(--th-card-border)">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg></button>` : ''}
        </div></div>
    </div>
    <div class="form-row-2col">
      <div class="form-group"><label class="form-label">Documento</label>
        <input class="input-text" id="mep-doc" value="${escapeHtml(pac.documento || '')}"/></div>
      <div class="form-group"><label class="form-label">Correo</label>
        <input class="input-text" id="mep-email" type="email" value="${escapeHtml(pac.email || '')}"/></div>
    </div>
    <div class="form-row-2col">
      <div class="form-group"><label class="form-label">Departamento</label>
        <select class="input-text" id="mep-dpto"><option value="">Cargando...</option></select></div>
      <div class="form-group"><label class="form-label">Ciudad / Municipio</label>
        <select class="input-text" id="mep-ciudad" disabled><option value="">Ciudad...</option></select></div>
    </div>
    <div class="form-row-2col">
      <div class="form-group"><label class="form-label">Fecha de nacimiento</label>
        <input class="input-text" id="mep-nacimiento" type="date" value="${escapeHtml(pac.fechaNacimiento || '')}"/></div>
      <div class="form-group"><label class="form-label">Condición / motivo de consulta</label>
        <input class="input-text" id="mep-condicion" value="${escapeHtml(pac.condicion || '')}" placeholder="Ej: Dolor lumbar crónico"/></div>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:4px">
      <button class="btn btn-gray btn-sm" id="mep-cancelar">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="mep-guardar">Guardar cambios</button>
    </div>`;

  // Fix del bug de ciudades: SIEMPRE poblar el select de departamentos primero
  // (y conectar el listener que recarga ciudades al cambiar de departamento),
  // luego preseleccionar solo si el paciente ya tiene una ciudad guardada.
  // Antes esto solo llamaba a restaurarUbicacion(), que retorna de inmediato
  // sin poblar nada cuando el paciente no tiene ciudad — el select quedaba
  // atascado en "Cargando..." para siempre.
  const dptoEl   = document.getElementById('mep-dpto');
  const ciudadEl = document.getElementById('mep-ciudad');
  const getUbicacion = await inicializarSelectsUbicacion(dptoEl, ciudadEl);
  if (pac.ciudad) await restaurarUbicacion(dptoEl, ciudadEl, pac.ciudad);

  document.getElementById('mep-cancelar')?.addEventListener('click', cerrar);
  body.querySelectorAll('[data-copiar]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); copiarTelefono(btn.dataset.copiar); });
  });

  document.getElementById('mep-guardar')?.addEventListener('click', async () => {
    const btn = document.getElementById('mep-guardar');
    const datos = {
      nombre:          document.getElementById('mep-nombre')?.value.trim(),
      documento:       document.getElementById('mep-doc')?.value.trim(),
      email:           document.getElementById('mep-email')?.value.trim(),
      ciudad:          getUbicacion(),
      fechaNacimiento: document.getElementById('mep-nacimiento')?.value,
      condicion:       document.getElementById('mep-condicion')?.value.trim(),
    };
    if (!datos.nombre) { mostrarAlerta('alert-mep', 'El nombre es obligatorio.', 'error'); return; }

    btn.textContent = 'Guardando...'; btn.disabled = true;
    const res = await actualizarPaciente(pac.id, datos);
    btn.textContent = 'Guardar cambios'; btn.disabled = false;

    if (res.ok) {
      mostrarAlerta('alert-mep', 'Paciente actualizado correctamente.', 'success');
      await onGuardado?.(pac.id, datos);
      setTimeout(cerrar, 900);
    } else {
      mostrarAlerta('alert-mep', res.error || 'Error al guardar.', 'error');
    }
  });
}

// ══════════════════════════════════════════════════════════
// MÓDULO DE PACIENTES — GESTOR CRM COMPLETO
// Contiene: buscador, tarjetas, CRUD inline, geo-intel IA
// ══════════════════════════════════════════════════════════

// Estado de navegación del CRM — nada se carga hasta que el usuario busca
// o presiona "Mostrar todos" (evita leer la colección completa al abrir
// la vista, que antes pasaba en cada visita de Admin o Secretaria).
let _crmListaActual = [];       // lo que está pintado ahora mismo en #crm-lista
let _crmContexto    = 'vacio';  // 'vacio' | 'busqueda' | 'todos'
let _crmUltimaQuery  = '';

// Paginación de "Mostrar todos" — 50 en 50, A-Z. Las páginas ya visitadas
// se guardan en memoria (_crmPaginas) así que volver "Anterior" no vuelve
// a leer Firestore; _crmCursores guarda el último documento de cada
// página para poder pedir la siguiente con startAfter().
let _crmPaginas      = [];   // _crmPaginas[i] = array de pacientes de la página i
let _crmCursores     = [];   // _crmCursores[i] = cursor (doc) para pedir la página i
let _crmPaginaActual = -1;   // -1 = "Mostrar todos" aún no se ha usado
let _crmHayMasPaginas = true;

// Caché de distancias — persiste en localStorage para no repetir llamadas a Gemini
const _distanciaCache = new Map();
(function _cargarCacheLocal() {
  try {
    const raw = localStorage.getItem('qm-dist-cache');
    if (!raw) return;
    const { ts, data } = JSON.parse(raw);
    // Invalidar si tiene más de 30 días
    if (Date.now() - ts > 30 * 24 * 60 * 60 * 1000) { localStorage.removeItem('qm-dist-cache'); return; }
    Object.entries(data).forEach(([c, v]) => _distanciaCache.set(c, v));
  } catch (_) {}
})();

function _getDistanciaColor(km) {
  if (km < 120) return { color: '#15803d', bg: '#dcfce7', label: 'Cerca' };
  if (km < 200) return { color: '#b45309', bg: '#fef9c3', label: 'Moderado' };
  return { color: '#dc2626', bg: '#fee2e2', label: 'Lejos' };
}

export async function renderGestorPacientes({ onRegistrar, onActualizar, onEliminar, esAdmin = false }) {
  const cont = document.getElementById('view-pacientes');
  if (!cont) return;

  // No se lee la colección completa al abrir la vista — solo cuando el
  // usuario busca o (Admin) presiona "Mostrar todos".
  cont.innerHTML = `
    <!-- ── CONTROLES: BÚSQUEDA Y FILTROS ── -->
    <div class="crm-controls-panel">
      <div class="crm-controls-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        Búsqueda y filtros
      </div>
      <div class="crm-controls-row">
        <div class="crm-search-container">
          <span class="crm-search-label">Buscar paciente</span>
          <div class="crm-search-box" id="crm-search-wrap">
            <svg class="crm-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input class="crm-search-input" id="crm-search" type="text"
              placeholder="Buscar por nombre, telefono o documento..."/>
            <div class="crm-autocomplete" id="crm-autocomplete" style="display:none"></div>
          </div>
        </div>
        <div class="crm-filter-container" id="crm-filter-container" style="display:none">
          <span class="crm-filter-label">Filtrar por ciudad</span>
          <div class="crm-filter-wrapper" id="crm-ciudad-wrap">
            <svg class="crm-filter-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            <input class="crm-filter-input" id="crm-ciudad-input" type="text"
              placeholder="Filtrar por ciudad..." autocomplete="off"/>
            <div class="crm-autocomplete crm-ciudad-ac" id="crm-ciudad-ac" style="display:none"></div>
            <button class="crm-clear-btn" id="crm-clear-ciudad" style="display:none" title="Limpiar filtro">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ── TOOLBAR CRM ── -->
    <div class="crm-toolbar">
      <div class="crm-toolbar-left">
        <span class="crm-status-line" id="crm-status">Busca un paciente arriba o usa "Mostrar todos" para ver los primeros 50.</span>
      </div>
      <div class="crm-toolbar-right">
        ${esAdmin ? `<button class="crm-btn-new crm-btn-secondary" id="crm-btn-mostrar-todos">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>
          </svg>
          Mostrar todos
        </button>` : ''}
        <button class="crm-btn-new" id="crm-btn-nuevo">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nuevo paciente
        </button>
      </div>
    </div>

    <!-- ── BARRA DE ACCIONES ── -->
    <div class="crm-actions-bar">
      <div class="crm-view-controls">
        <button class="crm-view-btn active" id="crm-view-cards" title="Vista tarjetas">
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
      <span class="crm-counter" id="crm-count">0 pacientes</span>
    </div>

    <!-- ── FILTRO ANIDADO — solo aparece tras "Mostrar todos", pero busca en toda la base ── -->
    <div class="crm-nested-filter" id="crm-nested-filter" style="display:none">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input class="crm-nested-filter-input" id="crm-nested-filter-input" type="text"
        placeholder="Buscar en toda la base de datos..."/>
    </div>

    <!-- ── LISTA / TABLA DE PACIENTES ── -->
    <div id="crm-lista" class="crm-lista-cards"></div>

    <!-- ── PAGINACIÓN — solo aparece tras "Mostrar todos" ── -->
    <div class="crm-paginacion" id="crm-paginacion" style="display:none">
      <button class="btn btn-gray btn-sm" id="crm-pag-anterior">← Anterior</button>
      <span class="crm-paginacion-label" id="crm-paginacion-label">Página 1</span>
      <button class="btn btn-gray btn-sm" id="crm-pag-siguiente">Siguiente →</button>
    </div>

    <!-- ── GEO INTELLIGENCE CARD (solo con "Mostrar todos") ── -->
    <div class="crm-ia-container" id="crm-geo-card" style="display:none">
      <div class="crm-ia-header">
        <div class="crm-ia-badge">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 1 8 8c0 5.25-8 13-8 13S4 15.25 4 10a8 8 0 0 1 8-8z"/>
          </svg>
        </div>
        <div class="crm-ia-titles">
          <div class="crm-ia-title">Distribución geográfica · Sede: Santa Rosa de Vira</div>
          <div class="crm-ia-subtitle" style="display:flex;gap:12px;flex-wrap:wrap">
            <span style="display:inline-flex;align-items:center;gap:4px">
              <span style="width:8px;height:8px;border-radius:50%;background:#15803d;display:inline-block"></span>
              Cerca &lt;120 km
            </span>
            <span style="display:inline-flex;align-items:center;gap:4px">
              <span style="width:8px;height:8px;border-radius:50%;background:#b45309;display:inline-block"></span>
              Moderado 120–200 km
            </span>
            <span style="display:inline-flex;align-items:center;gap:4px">
              <span style="width:8px;height:8px;border-radius:50%;background:#dc2626;display:inline-block"></span>
              Lejos &gt;200 km
            </span>
          </div>
        </div>
        <button class="crm-ia-refresh" id="crm-ia-refresh" title="Sugerir proxima ciudad a visitar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        </button>
      </div>
      <div class="crm-ia-content">
        <div class="crm-ia-ciudades-group" id="crm-ia-ciudades">
          <div class="crm-ia-loading">
            <div class="crm-ia-spinner"></div> Calculando distancias desde Santa Rosa de Vira...
          </div>
        </div>
        <div class="crm-ia-body" id="crm-ia-body">
          <div class="crm-ia-estado">Presiona ★ para que Gemini sugiera la proxima ciudad a visitar</div>
        </div>
      </div>
    </div>

    <!-- ── CITY INTEL PANEL (oculto, aparece al filtrar ciudad) ── -->
    <div id="crm-city-intel" style="display:none"></div>
  `;

  const handlers = { onActualizar, onEliminar };
  _renderEstadoVacio();
  _bindCrmBusquedaLazy(handlers);
  _bindCrmVistas(handlers);
  if (esAdmin) _bindMostrarTodos(handlers);

  document.getElementById('crm-btn-nuevo')?.addEventListener('click', onRegistrar);
}

// ── Renderizar lista en modo cards o tabla ────────────────
function _renderListaPacientes(lista, modo = 'cards', handlers = {}) {
  const cont = document.getElementById('crm-lista');
  if (!cont) return;

  const { onActualizar, onEliminar } = handlers;
  setEl('crm-count', `${lista.length} paciente${lista.length !== 1 ? 's' : ''}`);

  if (!lista.length) {
    cont.innerHTML = `
      <div class="crm-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".3">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
        <p>No se encontraron pacientes</p>
      </div>`;
    return;
  }

  if (modo === 'tabla') {
    cont.className = 'crm-lista-tabla';
    cont.innerHTML = `
      <div class="crm-contact-list">
        <div class="crm-list-header">
          <div style="width:46px;flex-shrink:0"></div>
          <div class="crm-list-name" style="font-size:11px">Paciente</div>
          <div class="crm-list-tel"  style="font-size:11px">Teléfono</div>
          <div class="crm-list-ciudad" style="font-size:11px">Ciudad</div>
          <div class="crm-list-cond"  style="font-size:11px">Condición</div>
          <div style="width:64px;flex-shrink:0"></div>
        </div>
        ${lista.map(p => {
          const ciudad = _parseCiudad(p.ciudad);
          const dist   = _distanciaCache.get(ciudad.ciudad);
          const av     = _avatarColor(p.nombre);
          const distDot = dist
            ? `<div class="crm-dist-dot" style="background:${dist.color}" title="~${dist.km} km · ${dist.label}"></div>`
            : '';
          const distBadge = dist
            ? `<span class="crm-tag" style="background:${dist.bg};color:${dist.color}">~${dist.km} km</span>`
            : '';
          return `
          <div class="crm-list-row">
            <div class="crm-av-wrap" style="flex-shrink:0">
              <div class="crm-av" style="background:${av.bg};color:${av.fg};width:36px;height:36px;font-size:12px">${escapeHtml(iniciales(p.nombre))}</div>
              ${distDot}
            </div>
            <div class="crm-list-name">${escapeHtml(p.nombre)}</div>
            <div class="crm-list-tel">${escapeHtml(p.telefono || '—')} ${_btnCopiarTel(p.telefono)}</div>
            <div class="crm-list-ciudad">
              ${ciudad.display ? escapeHtml(ciudad.display) : '—'}
              ${distBadge}
            </div>
            <div class="crm-list-cond">${escapeHtml(p.condicion || '—')}</div>
            <div class="crm-list-actions">
              <button class="crm-icon-btn" data-editar="${escapeHtml(p.id)}" title="Editar">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
              <button class="crm-icon-btn crm-icon-del" data-eliminar="${escapeHtml(p.id)}" data-nombre="${escapeHtml(p.nombre)}" title="Eliminar">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/>
                </svg>
              </button>
            </div>
          </div>`;
        }).join('')}
      </div>`;
  } else {
    cont.className = 'crm-lista-cards';
    cont.innerHTML = lista.map(p => {
      const ciudad = _parseCiudad(p.ciudad);
      const dist   = _distanciaCache.get(ciudad.ciudad);
      const av     = _avatarColor(p.nombre);
      const distDot = dist
        ? `<div class="crm-dist-dot" style="background:${dist.color}" title="~${dist.km} km · ${dist.label}"></div>`
        : '';
      return `
        <div class="crm-card" data-id="${escapeHtml(p.id)}">
          <div class="crm-av-wrap">
            <div class="crm-av" style="background:${av.bg};color:${av.fg}">${escapeHtml(iniciales(p.nombre))}</div>
            ${distDot}
          </div>
          <div class="crm-info">
            <div class="crm-name">${escapeHtml(p.nombre)}</div>
            <div class="crm-contact-row">
              ${p.telefono
                ? `<span class="crm-contact-item">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13 19.79 19.79 0 0 1 1.62 4.4 2 2 0 0 1 3.6 2.2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.08 6.08l.98-.98a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 17z"/>
                    </svg>
                    ${escapeHtml(p.telefono)}
                    ${_btnCopiarTel(p.telefono)}
                  </span>`
                : ''}
              ${p.email
                ? `<span class="crm-contact-item">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
                    </svg>
                    ${escapeHtml(p.email)}
                  </span>`
                : ''}
            </div>
            <div class="crm-tags">
              ${ciudad.ciudad
                ? `<span class="crm-tag crm-tag-city">${escapeHtml(ciudad.display)}</span>`
                : ''}
              ${dist
                ? `<span class="crm-tag" style="background:${dist.bg};color:${dist.color}">~${dist.km} km</span>`
                : ''}
              ${p.condicion
                ? `<span class="crm-tag crm-tag-cond">${escapeHtml(p.condicion)}</span>`
                : ''}
            </div>
          </div>
          <div class="crm-actions-hover">
            <button class="crm-icon-btn" data-editar="${escapeHtml(p.id)}" title="Editar">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="crm-icon-btn crm-icon-del" data-eliminar="${escapeHtml(p.id)}" data-nombre="${escapeHtml(p.nombre)}" title="Eliminar">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6M14 11v6"/>
              </svg>
            </button>
          </div>
        </div>`;
    }).join('');
  }

  // Bind acciones
  cont.querySelectorAll('[data-copiar]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); copiarTelefono(btn.dataset.copiar); });
  });

  cont.querySelectorAll('[data-editar]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      abrirModalPaciente(btn.dataset.editar, {
        onGuardado: async (id, datosActualizados) => {
          await onActualizar?.();
          const idx = _crmListaActual.findIndex(p => p.id === id);
          if (idx !== -1) _crmListaActual[idx] = { ..._crmListaActual[idx], ...datosActualizados };
          // Mantener sincronizada la página en caché para que "Anterior" no
          // muestre datos viejos al volver a ella.
          if (_crmContexto === 'todos' && _crmPaginas[_crmPaginaActual]) {
            const idxPag = _crmPaginas[_crmPaginaActual].findIndex(p => p.id === id);
            if (idxPag !== -1) _crmPaginas[_crmPaginaActual][idxPag] = { ..._crmPaginas[_crmPaginaActual][idxPag], ...datosActualizados };
          }
          _renderListaPacientes(_crmListaActual, _modoActual(), { onActualizar, onEliminar });
        },
      });
    });
  });

  cont.querySelectorAll('[data-eliminar]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      _confirmarEliminar(btn.dataset.eliminar, btn.dataset.nombre, onEliminar, handlers);
    });
  });
}

// ── Confirmar y ejecutar eliminación ─────────────────────
async function _confirmarEliminar(id, nombre, onEliminar, handlers) {
  const ok = await confirmar({
    titulo: 'Eliminar paciente',
    mensaje: `¿Eliminar permanentemente a "${nombre}"?\nEsta acción no se puede deshacer.`,
    tipo: 'danger',
    textoConfirmar: 'Eliminar',
  });
  if (!ok) return;
  const res = await onEliminar(id);
  if (res?.ok) {
    toast(`Paciente "${nombre}" eliminado.`, 'success');
    _crmListaActual = _crmListaActual.filter(p => p.id !== id);
    if (_crmContexto === 'todos' && _crmPaginas[_crmPaginaActual]) {
      _crmPaginas[_crmPaginaActual] = _crmPaginas[_crmPaginaActual].filter(p => p.id !== id);
    }
    _renderListaPacientes(_crmListaActual, _modoActual(), handlers);
    if (_crmContexto === 'todos') {
      setEl('crm-status', `Página ${_crmPaginaActual + 1} — ${_crmListaActual.length} paciente${_crmListaActual.length !== 1 ? 's' : ''} (A–Z)`);
    } else {
      _actualizarStatusLine();
    }
  }
}

// ── Estado vacío por defecto — nada se lee hasta que el usuario actúa ──
function _renderEstadoVacio() {
  _crmContexto    = 'vacio';
  _crmListaActual = [];
  const lista = document.getElementById('crm-lista');
  if (lista) {
    lista.className = 'crm-lista-cards';
    lista.innerHTML = `
      <div class="crm-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".3">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
        </svg>
        <p>Busca un paciente o usa "Mostrar todos" para ver los primeros 50.</p>
      </div>`;
  }
  setEl('crm-count', '0 pacientes');
  const nested = document.getElementById('crm-nested-filter');
  if (nested) nested.style.display = 'none';
  const paginacion = document.getElementById('crm-paginacion');
  if (paginacion) paginacion.style.display = 'none';
  const geo = document.getElementById('crm-geo-card');
  if (geo) geo.style.display = 'none';
  const filtroCiudad = document.getElementById('crm-filter-container');
  if (filtroCiudad) filtroCiudad.style.display = 'none';
  _actualizarStatusLine();
}

function _actualizarStatusLine() {
  if (_crmContexto === 'todos') {
    setEl('crm-status', `Página ${_crmPaginaActual + 1} — ${_crmListaActual.length} paciente${_crmListaActual.length !== 1 ? 's' : ''} (A–Z)`);
  } else if (_crmContexto === 'busqueda') {
    setEl('crm-status', `${_crmListaActual.length} resultado${_crmListaActual.length !== 1 ? 's' : ''} para "${_crmUltimaQuery}"`);
  } else {
    setEl('crm-status', 'Busca un paciente arriba o usa "Mostrar todos" para ver los primeros 50.');
  }
}

// ── Busqueda bajo demanda con autocomplete ────────────────
// Solo lee la base de datos cuando el usuario efectivamente escribe una
// búsqueda (mínimo 2 caracteres, con debounce) — nunca al abrir la vista.
function _bindCrmBusquedaLazy(handlers) {
  const input = document.getElementById('crm-search');
  const ac    = document.getElementById('crm-autocomplete');
  if (!input || !ac) return;

  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const qRaw = input.value.trim();
    if (qRaw.length < 2) {
      ac.style.display = 'none';
      _renderEstadoVacio();
      return;
    }
    timer = setTimeout(async () => {
      const q = qRaw.toLowerCase();
      const filtrados = await buscarPacientes(q);
      _crmContexto    = 'busqueda';
      _crmListaActual = filtrados;
      _crmUltimaQuery = qRaw;

      // La búsqueda global reemplaza cualquier resultado de "Mostrar todos"
      document.getElementById('crm-nested-filter').style.display   = 'none';
      document.getElementById('crm-paginacion').style.display      = 'none';
      document.getElementById('crm-geo-card').style.display        = 'none';
      document.getElementById('crm-filter-container').style.display = 'none';

      // Autocomplete — top 6
      const top6 = filtrados.slice(0, 6);
      if (top6.length) {
        ac.innerHTML = top6.map(p => `
          <div class="crm-ac-item" data-id="${escapeHtml(p.id)}" data-nombre="${escapeHtml(p.nombre)}">
            <div class="avatar" style="width:28px;height:28px;font-size:10px;flex-shrink:0">${escapeHtml(iniciales(p.nombre))}</div>
            <div>
              <div style="font-size:13px;font-weight:500">${_highlight(p.nombre, q)}</div>
              <div style="font-size:11px;color:#8492a6">${escapeHtml(p.telefono || '—')} · ${escapeHtml(_parseCiudad(p.ciudad).ciudad || '—')}</div>
            </div>
          </div>`).join('');
        ac.style.display = 'block';

        ac.querySelectorAll('.crm-ac-item').forEach(item => {
          item.addEventListener('click', () => {
            input.value    = item.dataset.nombre;
            ac.style.display = 'none';
            const selec = filtrados.filter(p => p.id === item.dataset.id);
            _crmListaActual = selec;
            _renderListaPacientes(selec, _modoActual(), handlers);
            _actualizarStatusLine();
          });
        });
      } else {
        ac.style.display = 'none';
      }

      _renderListaPacientes(filtrados, _modoActual(), handlers);
      _actualizarStatusLine();
    }, 250);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#crm-search-wrap')) ac.style.display = 'none';
  });
}

// ── Filtro por ciudad con autocomplete ───────────────────
function _bindCrmFiltrosCiudad(todos, handlers) {
  const input   = document.getElementById('crm-ciudad-input');
  const ac      = document.getElementById('crm-ciudad-ac');
  const clearBtn = document.getElementById('crm-clear-ciudad');
  if (!input || !ac) return;

  // Construir índice de ciudades únicas desde los pacientes
  const ciudadesUnicas = [...new Set(
    todos.map(p => _parseCiudad(p.ciudad).display).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'es'));

  // También pedir ciudades de la API si el usuario escribe algo nuevo
  let timer;
  input.addEventListener('input', async () => {
    clearTimeout(timer);
    const q = input.value.trim().toLowerCase();

    if (!q) {
      ac.style.display   = 'none';
      clearBtn.style.display = 'none';
      _renderListaPacientes(todos, _modoActual(), handlers);
      return;
    }

    clearBtn.style.display = 'flex';

    // Sugerir desde ciudades de los pacientes primero
    const localSugg = ciudadesUnicas.filter(c => c.toLowerCase().includes(q)).slice(0, 8);

    // Además buscar municipios de la API (debounced)
    timer = setTimeout(async () => {
      let apiSugg = [];
      try {
        const deptos = await obtenerDepartamentos();
        // Buscar en departamentos cuyo nombre matchea
        const deptosMatch = deptos.filter(d => d.nombre.toLowerCase().includes(q));
        for (const d of deptosMatch.slice(0, 3)) {
          const ciudades = await obtenerCiudades(d.id);
          ciudades.slice(0, 5).forEach(c => {
            const full = `${d.nombre} > ${c}`;
            if (!apiSugg.some(x => x.label === full)) {
              apiSugg.push({ label: full, ciudad: c, depto: d.nombre });
            }
          });
        }
        // También buscar municipios por nombre
        const allDeptos = deptos.filter(d => !deptosMatch.includes(d)).slice(0, 8);
        for (const d of allDeptos) {
          const ciudades = await obtenerCiudades(d.id);
          const match = ciudades.filter(c => c.toLowerCase().includes(q));
          match.slice(0, 2).forEach(c => {
            const full = `${d.nombre} > ${c}`;
            if (!apiSugg.some(x => x.label === full)) {
              apiSugg.push({ label: full, ciudad: c, depto: d.nombre });
            }
          });
          if (apiSugg.length > 10) break;
        }
      } catch (_) {}

      const todasSugg = [
        ...localSugg.map(c => ({ label: c, source: 'local' })),
        ...apiSugg.filter(a => !localSugg.some(l => l.includes(a.ciudad))).slice(0, 5),
      ].slice(0, 10);

      if (todasSugg.length) {
        ac.innerHTML = todasSugg.map(s => `
          <div class="crm-ac-item" data-ciudad="${s.label}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;color:#0A76D8">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            <div>
              <div style="font-size:13px">${_highlight(s.label, q)}</div>
              ${s.source !== 'local' && s.label ? `<div style="font-size:11px;color:#8492a6">Colombia</div>` : ''}
            </div>
          </div>`).join('');
        ac.style.display = 'block';

        ac.querySelectorAll('.crm-ac-item').forEach(item => {
          item.addEventListener('click', async () => {
            const val = item.dataset.ciudad;
            input.value = val;
            ac.style.display = 'none';
            await _filtrarPorCiudad(val, _modoActual(), handlers);
            _mostrarCityIntelPanel(_parseCiudad(val).ciudad || val, todos);
          });
        });
      } else {
        ac.style.display = 'none';
        await _filtrarPorCiudad(q, _modoActual(), handlers);
        _mostrarCityIntelPanel(q, todos);
      }
    }, 300);
  });

  clearBtn?.addEventListener('click', () => {
    input.value = '';
    clearBtn.style.display = 'none';
    ac.style.display = 'none';
    _crmContexto    = 'todos';
    _crmListaActual = todos;
    _renderListaPacientes(todos, _modoActual(), handlers);
    _actualizarStatusLine();
    const intel = document.getElementById('crm-city-intel');
    if (intel) { intel.style.display = 'none'; intel.innerHTML = ''; }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#crm-ciudad-wrap')) ac.style.display = 'none';
  });
}

// Busca en TODA la base de datos (no solo en la página de 50 cargada por
// "Mostrar todos") — mismo criterio que ya usa el buscador de nombre.
async function _filtrarPorCiudad(q, modo, handlers) {
  const filtrados = await filtrarPorCiudad(q);
  _crmContexto    = 'busqueda';
  _crmUltimaQuery = q;
  _crmListaActual = filtrados;
  _renderListaPacientes(filtrados, modo, handlers);
  _actualizarStatusLine();
}

// ── Toggle vista cards / tabla — repinta lo que esté cargado ahora ──
function _bindCrmVistas(handlers) {
  const btnCards = document.getElementById('crm-view-cards');
  const btnTabla = document.getElementById('crm-view-tabla');

  btnCards?.addEventListener('click', () => {
    btnCards.classList.add('active');
    btnTabla?.classList.remove('active');
    window.__crmModo = 'cards';
    _renderListaPacientes(_crmListaActual, 'cards', handlers);
  });

  btnTabla?.addEventListener('click', () => {
    btnTabla.classList.add('active');
    btnCards?.classList.remove('active');
    window.__crmModo = 'tabla';
    _renderListaPacientes(_crmListaActual, 'tabla', handlers);
  });
}

function _modoActual() { return window.__crmModo || 'cards'; }

// ── "Mostrar todos" (solo Admin) — trae únicamente 50 vía Firestore ──
function _bindMostrarTodos(handlers) {
  const btn = document.getElementById('crm-btn-mostrar-todos');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    // Reinicia la paginación cada vez que se presiona "Mostrar todos" —
    // siempre arranca de nuevo desde la página 1.
    _crmPaginas       = [];
    _crmCursores      = [];
    _crmPaginaActual  = -1;
    _crmHayMasPaginas = true;

    const search = document.getElementById('crm-search');
    if (search) search.value = '';
    document.getElementById('crm-autocomplete').style.display = 'none';

    document.getElementById('crm-nested-filter').style.display = 'flex';
    document.getElementById('crm-nested-filter-input').value   = '';
    document.getElementById('crm-paginacion').style.display    = 'flex';
    document.getElementById('crm-geo-card').style.display         = '';
    document.getElementById('crm-filter-container').style.display = '';

    _bindFiltroNested(handlers);
    _bindPaginacion(handlers);
    await _cargarPaginaSiguiente(handlers);
  });
}

// ── Paginación de "Mostrar todos" — 50 en 50, con cursores de Firestore.
// Las páginas ya visitadas quedan en memoria: "Anterior" nunca vuelve a
// leer la base de datos, solo "Siguiente" cuando la página aún no existe. ──
async function _cargarPaginaSiguiente(handlers) {
  const indice = _crmPaginaActual + 1;

  if (_crmPaginas[indice]) {
    // Ya visitada — no se repite la lectura.
    _crmPaginaActual = indice;
    _mostrarPaginaActual(handlers);
    return;
  }

  setEl('crm-status', 'Cargando...');
  const cursor = _crmCursores[indice] || null;
  const { pacientes, ultimoDoc, hayMas } = await obtenerPacientesPaginados(50, cursor);

  _crmPaginas[indice] = pacientes;
  if (ultimoDoc) _crmCursores[indice + 1] = ultimoDoc;
  _crmHayMasPaginas = hayMas;
  _crmPaginaActual  = indice;
  _mostrarPaginaActual(handlers);
}

function _cargarPaginaAnterior(handlers) {
  if (_crmPaginaActual <= 0) return;
  _crmPaginaActual -= 1;
  _mostrarPaginaActual(handlers);
}

function _mostrarPaginaActual(handlers) {
  const pagina = _crmPaginas[_crmPaginaActual] || [];
  _crmContexto    = 'todos';
  _crmListaActual = pagina;

  _renderListaPacientes(pagina, _modoActual(), handlers);
  setEl('crm-status', `Página ${_crmPaginaActual + 1} — ${pagina.length} paciente${pagina.length !== 1 ? 's' : ''} (A–Z)`);
  setEl('crm-paginacion-label', `Página ${_crmPaginaActual + 1}`);

  const btnAnt = document.getElementById('crm-pag-anterior');
  const btnSig = document.getElementById('crm-pag-siguiente');
  if (btnAnt) btnAnt.disabled = _crmPaginaActual <= 0;
  if (btnSig) btnSig.disabled = !_crmHayMasPaginas && !_crmPaginas[_crmPaginaActual + 1];

  // La inteligencia geográfica y el filtro por ciudad solo se activan al
  // navegar "Mostrar todos" (no en cada búsqueda) para no disparar
  // llamadas a Gemini por cada tecleo.
  _bindCrmFiltrosCiudad(pagina, handlers);
  _bindCrmIA(pagina);
  _cargarDistanciasBatch(pagina).then(() => {
    if (_crmContexto === 'todos') {
      _renderListaPacientes(_crmListaActual, _modoActual(), handlers);
      _renderGeoCiudades(pagina, handlers);
    }
  });
}

function _bindPaginacion(handlers) {
  const btnAnt = document.getElementById('crm-pag-anterior');
  const btnSig = document.getElementById('crm-pag-siguiente');
  if (btnAnt) btnAnt.onclick = () => _cargarPaginaAnterior(handlers);
  if (btnSig) btnSig.onclick = () => _cargarPaginaSiguiente(handlers);
}

// ── Filtro anidado — busca en TODA la base de datos (igual que el buscador
// de arriba), no solo en la página actual. Solo lee la base cuando el
// usuario efectivamente escribe algo; al vaciarlo vuelve a la página que
// se estaba viendo, sin nueva lectura. ──
function _bindFiltroNested(handlers) {
  const input = document.getElementById('crm-nested-filter-input');
  if (!input) return;
  let timer;
  input.oninput = () => {
    clearTimeout(timer);
    const qRaw = input.value.trim();
    if (qRaw.length < 2) {
      _mostrarPaginaActual(handlers);
      return;
    }
    timer = setTimeout(async () => {
      const q = qRaw.toLowerCase();
      setEl('crm-status', 'Buscando...');
      const filtrados = await buscarPacientes(q);
      _crmContexto    = 'busqueda';
      _crmListaActual = filtrados;
      _renderListaPacientes(filtrados, _modoActual(), handlers);
      setEl('crm-status', `${filtrados.length} resultado${filtrados.length !== 1 ? 's' : ''} para "${qRaw}" en toda la base`);
    }, 250);
  };
}

// ── IA: botón de sugerencia de visita ────────────────────
function _bindCrmIA(todos) {
  const btn  = document.getElementById('crm-ia-refresh');
  const body = document.getElementById('crm-ia-body');
  if (!btn || !body) return;

  const conteo = {};
  todos.forEach(p => {
    const c = _parseCiudad(p.ciudad).ciudad;
    if (c) conteo[c] = (conteo[c] || 0) + 1;
  });
  const topCiudades = Object.entries(conteo).sort((a, b) => b[1] - a[1]).slice(0, 8);

  btn.addEventListener('click', async () => {
    if (!topCiudades.length) {
      body.innerHTML = '<div class="crm-ia-placeholder">No hay suficientes pacientes para analizar.</div>';
      return;
    }
    btn.style.opacity = '0.5'; btn.disabled = true;
    body.innerHTML = '<div class="crm-ia-loading"><div class="crm-ia-spinner"></div> Gemini analizando concentracion de pacientes...</div>';

    const resumen = topCiudades.map(([c, n]) => {
      const d = _distanciaCache.get(c);
      return `- ${c}: ${n} paciente${n !== 1 ? 's' : ''}${d ? ` (~${d.km} km de Santa Rosa de Vira)` : ''}`;
    }).join('\n');

    try {
      const KEY = import.meta.env?.VITE_GEMINI_KEY || '';
      const URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${KEY}`;
      const r = await fetch(URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text:
            `Eres el asistente de un quiropractico colombiano con sede en Santa Rosa de Viracocha, Boyaca. Viaja a distintas ciudades a dar consultas a domicilio.

Concentracion de pacientes por ciudad:
${resumen}

Sugiere cual seria la proxima ciudad a visitar considerando: numero de pacientes, distancia desde la sede y agrupacion geografica.

Responde en este formato exacto (sin markdown, sin asteriscos):
CIUDAD SUGERIDA: [nombre]
RAZON: [1-2 oraciones informal colombiano]
CONSEJO: [tip logistico practico]` }] }],
          generationConfig: { maxOutputTokens: 300, temperature: 0.7, thinkingConfig: { thinkingBudget: 0 } }
        })
      });
      if (!r.ok) throw new Error(`Error ${r.status}`);
      const data  = await r.json();
      const texto = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const ciudad  = texto.match(/CIUDAD SUGERIDA:\s*(.+)/i)?.[1]?.trim() || '—';
      const razon   = texto.match(/RAZON:\s*(.+)/i)?.[1]?.trim() || '';
      const consejo = texto.match(/CONSEJO:\s*(.+)/i)?.[1]?.trim() || '';
      const distSug = _distanciaCache.get(ciudad);
      const badgeSug = distSug ? `<span style="padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;background:${distSug.bg};color:${distSug.color}">~${distSug.km} km</span>` : '';
      body.innerHTML = `
        <div class="crm-ia-resultado">
          <div class="crm-ia-ciudad-sugerida" style="display:flex;align-items:center;gap:8px">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            ${escapeHtml(ciudad)} ${badgeSug}
          </div>
          ${razon   ? `<div class="crm-ia-razon">${escapeHtml(razon)}</div>` : ''}
          ${consejo ? `<div class="crm-ia-consejo"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>${escapeHtml(consejo)}</div>` : ''}
        </div>`;
    } catch (err) {
      body.innerHTML = `<div class="crm-ia-error">No se pudo conectar con Gemini: ${escapeHtml(err.message)}</div>`;
    }
    btn.style.opacity = '1'; btn.disabled = false;
  });
}

// ── Helpers internos ──────────────────────────────────────
function _btnCopiarTel(numero) {
  if (!numero) return '';
  return `<button class="crm-copy-btn" data-copiar="${escapeHtml(numero)}" title="Copiar número" type="button">
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg></button>`;
}

function _avatarColor(nombre) {
  const p = [
    { bg: '#dbeafe', fg: '#1d4ed8' },
    { bg: '#dcfce7', fg: '#16a34a' },
    { bg: '#fce7f3', fg: '#be185d' },
    { bg: '#fef3c7', fg: '#b45309' },
    { bg: '#f3e8ff', fg: '#7c3aed' },
    { bg: '#ffedd5', fg: '#c2410c' },
    { bg: '#e0f2fe', fg: '#0369a1' },
    { bg: '#fdf2f8', fg: '#9d174d' },
  ];
  let h = 0;
  for (const c of nombre) h = h * 31 + c.charCodeAt(0);
  return p[Math.abs(h) % p.length];
}

function _parseCiudad(valor) {
  if (!valor) return { depto: '', ciudad: '', display: '' };
  if (valor.includes(' > ')) {
    const [depto, ciudad] = valor.split(' > ');
    return { depto, ciudad, display: `${depto} > ${ciudad}` };
  }
  return { depto: '', ciudad: valor, display: valor };
}

function _highlight(texto, q) {
  const seguro = escapeHtml(texto);
  if (!q) return seguro;
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return seguro.replace(re, '<strong style="color:#0A76D8">$1</strong>');
}

// ── Carga distancias batch desde Gemini (una sola llamada) ─
async function _cargarDistanciasBatch(todos) {
  const ciudades = [...new Set(
    todos.map(p => _parseCiudad(p.ciudad).ciudad).filter(Boolean)
  )].filter(c => !_distanciaCache.has(c));

  if (!ciudades.length) return;

  const KEY = import.meta.env?.VITE_GEMINI_KEY || '';
  const URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${KEY}`;
  try {
    const r = await fetch(URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text:
          `Experto en geografía colombiana. Calcula la distancia aproximada por carretera en km desde Santa Rosa de Viracocha (Santa Rosa de Vira), Boyacá, Colombia hasta cada ciudad de esta lista. Responde ÚNICAMENTE con JSON válido, sin texto adicional:
{"distancias":[{"ciudad":"nombre","km":numero},...]}\n\nCiudades:\n${ciudades.join('\n')}` }] }],
        generationConfig: { maxOutputTokens: 600, temperature: 0, thinkingConfig: { thinkingBudget: 0 } }
      })
    });
    if (!r.ok) return;
    const data  = await r.json();
    const texto = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const match = texto.match(/\{[\s\S]*\}/);
    if (!match) return;
    const parsed = JSON.parse(match[0]);
    (parsed.distancias || []).forEach(({ ciudad, km }) => {
      if (ciudad && typeof km === 'number') {
        _distanciaCache.set(ciudad, { km, ..._getDistanciaColor(km) });
      }
    });
    // Persistir en localStorage para evitar 429 en futuras cargas
    try {
      const data = Object.fromEntries(_distanciaCache);
      localStorage.setItem('qm-dist-cache', JSON.stringify({ ts: Date.now(), data }));
    } catch (_) {}
  } catch (_) {}
}

// ── Renderiza los chips de ciudades en el geo card ─────────
function _renderGeoCiudades(todos, handlers) {
  const cont = document.getElementById('crm-ia-ciudades');
  if (!cont) return;

  const conteo = {};
  todos.forEach(p => {
    const c = _parseCiudad(p.ciudad).ciudad;
    if (c) conteo[c] = (conteo[c] || 0) + 1;
  });
  const topCiudades = Object.entries(conteo).sort((a, b) => b[1] - a[1]).slice(0, 10);

  if (!topCiudades.length) { cont.innerHTML = ''; return; }

  cont.innerHTML = topCiudades.map(([c, n]) => {
    const d = _distanciaCache.get(c);
    const dot = d
      ? `<span style="width:8px;height:8px;border-radius:50%;background:${d.color};flex-shrink:0;display:inline-block"></span>`
      : `<span style="width:8px;height:8px;border-radius:50%;background:#cbd5e1;flex-shrink:0;display:inline-block"></span>`;
    const kmTag = d
      ? `<span style="font-size:10px;font-weight:700;background:${d.bg};color:${d.color};padding:1px 5px;border-radius:8px">~${d.km}km</span>`
      : '';
    return `
      <div class="crm-ia-ciudad-chip" data-ciudad-chip="${escapeHtml(c)}" style="cursor:pointer"
           title="Filtrar por ${escapeHtml(c)}">
        ${dot}
        <span class="crm-ia-chip-nombre">${escapeHtml(c)}</span>
        <span class="crm-ia-chip-num">${n}</span>
        ${kmTag}
      </div>`;
  }).join('');

  cont.querySelectorAll('[data-ciudad-chip]').forEach(chip => {
    chip.addEventListener('click', () => {
      const ciudad = chip.dataset.ciudadChip;
      const input  = document.getElementById('crm-ciudad-input');
      const clear  = document.getElementById('crm-clear-ciudad');
      if (input) { input.value = ciudad; }
      if (clear) { clear.style.display = 'flex'; }
      _filtrarPorCiudad(ciudad, _modoActual(), handlers);
      _mostrarCityIntelPanel(ciudad, todos);
    });
  });
}

// ── Panel de inteligencia de ciudad ──────────────────────
async function _mostrarCityIntelPanel(ciudad, todos) {
  const panel = document.getElementById('crm-city-intel');
  if (!panel) return;

  const numPac = todos.filter(p => {
    const c = _parseCiudad(p.ciudad).ciudad || '';
    return c.toLowerCase() === ciudad.toLowerCase() || (p.ciudad || '').toLowerCase().includes(ciudad.toLowerCase());
  }).length;

  const dist = _distanciaCache.get(ciudad);
  const badgeHtml = dist
    ? `<span style="padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${dist.bg};color:${dist.color};display:inline-flex;align-items:center;gap:4px">
        <span style="width:7px;height:7px;border-radius:50%;background:${dist.color};display:inline-block"></span>
        ~${dist.km} km · ${dist.label}
      </span>`
    : '';

  panel.style.display = 'block';
  panel.innerHTML = `
    <div style="background:var(--th-card,#fff);border:1px solid var(--th-border,#e8edf5);border-radius:14px;padding:16px 20px;box-shadow:0 2px 12px rgba(0,0,0,.06)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:#0A76D8;flex-shrink:0">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
          </svg>
          <span style="font-size:15px;font-weight:700;color:var(--th-text,#161c2d)">${escapeHtml(ciudad)}</span>
          ${badgeHtml}
          <span style="font-size:12px;color:var(--th-text2,#8492a6)">${numPac} paciente${numPac !== 1 ? 's' : ''}</span>
        </div>
        <button id="city-intel-close" style="background:none;border:none;cursor:pointer;font-size:18px;color:var(--th-text2,#8492a6);line-height:1;padding:2px 6px;border-radius:6px" title="Cerrar">×</button>
      </div>
      <div id="city-intel-body">
        <div class="crm-ia-loading" style="font-size:12px">
          <div class="crm-ia-spinner"></div> Analizando ${escapeHtml(ciudad)} con Gemini...
        </div>
      </div>
    </div>`;

  document.getElementById('city-intel-close')?.addEventListener('click', () => {
    panel.style.display = 'none';
    panel.innerHTML = '';
    const input = document.getElementById('crm-ciudad-input');
    const clear = document.getElementById('crm-clear-ciudad');
    if (input) input.value = '';
    if (clear) clear.style.display = 'none';
  });

  try {
    const KEY = import.meta.env?.VITE_GEMINI_KEY || '';
    const URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${KEY}`;
    const kmInfo = dist ? `${dist.km} km (${dist.label} de la sede)` : 'distancia no calculada';
    const r = await fetch(URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text:
          `Eres el asistente de un quiropráctico colombiano con sede en Santa Rosa de Viracocha, Boyacá.
Ciudad analizada: ${ciudad}
Pacientes registrados desde allí: ${numPac}
Distancia desde Santa Rosa de Viracocha: ${kmInfo}

Responde en este formato exacto (sin asteriscos, sin markdown, sin bullets):
CONTEXTO: [descripción de la ciudad: tipo, economía, características - máx 2 oraciones]
DEMANDA: [por qué hay/habría demanda de quiropraxia allí - 1 oración]
RUTA: [mejor forma de llegar desde Santa Rosa de Vira - 1 oración]` }] }],
        generationConfig: { maxOutputTokens: 400, temperature: 0.6, thinkingConfig: { thinkingBudget: 0 } }
      })
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data  = await r.json();
    const texto = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const contexto = texto.match(/CONTEXTO:\s*(.+)/i)?.[1]?.trim() || '';
    const demanda  = texto.match(/DEMANDA:\s*(.+)/i)?.[1]?.trim()  || '';
    const ruta     = texto.match(/RUTA:\s*(.+)/i)?.[1]?.trim()     || '';
    const body = document.getElementById('city-intel-body');
    if (!body) return;
    body.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:10px">
        ${contexto ? `<div style="display:flex;gap:10px;align-items:flex-start">
          <span style="font-size:13px;min-width:22px">📍</span>
          <div>
            <div style="font-size:11px;font-weight:600;color:var(--th-text2,#8492a6);text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">Contexto</div>
            <div style="font-size:13px;color:var(--th-text,#161c2d);line-height:1.5">${escapeHtml(contexto)}</div>
          </div>
        </div>` : ''}
        ${demanda ? `<div style="display:flex;gap:10px;align-items:flex-start">
          <span style="font-size:13px;min-width:22px">💡</span>
          <div>
            <div style="font-size:11px;font-weight:600;color:var(--th-text2,#8492a6);text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">Demanda</div>
            <div style="font-size:13px;color:var(--th-text,#161c2d);line-height:1.5">${escapeHtml(demanda)}</div>
          </div>
        </div>` : ''}
        ${ruta ? `<div style="display:flex;gap:10px;align-items:flex-start">
          <span style="font-size:13px;min-width:22px">🛣</span>
          <div>
            <div style="font-size:11px;font-weight:600;color:var(--th-text2,#8492a6);text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">Ruta</div>
            <div style="font-size:13px;color:var(--th-text,#161c2d);line-height:1.5">${escapeHtml(ruta)}</div>
          </div>
        </div>` : ''}
      </div>`;
  } catch (err) {
    const body = document.getElementById('city-intel-body');
    if (body) body.innerHTML = `<div class="crm-ia-error">Error al analizar: ${err.message}</div>`;
  }
}

// ══════════════════════════════════════════════════════════
// ESTAS FUNCIONES SE MANTIENEN PARA COMPATIBILIDAD
// con el código existente en handlers.js
// ══════════════════════════════════════════════════════════

export function renderPacientes(lista, handlers = {}) {
  _renderListaPacientes(lista, _modoActual(), handlers);
}

export function renderResultadosBusqueda(containerId, lista, onSeleccionar, labelAccion) {
  const cont = document.getElementById(containerId);
  if (!cont) return;
  if (!lista.length) {
    cont.innerHTML = '<div class="empty-state" style="padding:12px">Sin resultados</div>';
    return;
  }
  cont.innerHTML = lista.slice(0, 10).map(p => `
    <div class="pac-resultado" data-id="${escapeHtml(p.id)}"
      style="display:flex;align-items:center;gap:12px;padding:10px 14px;
             cursor:pointer;border-bottom:1px solid #f0f4f8;transition:background .15s">
      <div class="avatar" style="width:34px;height:34px;font-size:12px">${escapeHtml(iniciales(p.nombre))}</div>
      <div style="flex:1">
        <div style="font-size:14px;font-weight:500;color:#161c2d">${escapeHtml(p.nombre)}</div>
        <div style="font-size:12px;color:#8492a6">Tel: ${escapeHtml(p.telefono || '—')} · ${escapeHtml(p.ciudad || '—')}</div>
      </div>
      <button class="btn btn-soft btn-sm">${escapeHtml(labelAccion)}</button>
    </div>`).join('');

  cont.querySelectorAll('.pac-resultado').forEach(row => {
    row.addEventListener('mouseover', () => row.style.background = '#f8fbff');
    row.addEventListener('mouseout',  () => row.style.background = '');
    row.addEventListener('click', () =>
      onSeleccionar(lista.find(p => p.id === row.dataset.id))
    );
  });
}

// ══════════════════════════════════════════════════════════
// BUSCADOR DE CITAS — búsqueda de paciente + citas próximas/historial
// Reutilizado idénticamente en admin/secretaria/callcenter.
// ══════════════════════════════════════════════════════════

const ESTADOS_PROXIMAS = new Set([
  ESTADOS.ACTIVA, ESTADOS.REPROGRAMADA,
  ESTADOS.PENDIENTE_CONFIRMACION, ESTADOS.PENDIENTE_REPROGRAMAR,
]);

export function renderBuscadorCitas(containerId) {
  const cont = document.getElementById(containerId);
  if (!cont) return;

  cont.innerHTML = `
    <div class="buscador-citas-search">
      <input class="input-text" id="search-cita-paciente"
        placeholder="Buscar paciente por nombre, telefono o documento..."
        style="width:100%;max-width:360px"/>
      <div id="resultados-cita-paciente" style="margin-top:8px"></div>
    </div>
    <div id="citas-paciente-detalle"></div>`;

  cont.querySelector('#search-cita-paciente').addEventListener('input', async (e) => {
    const q = e.target.value.trim();
    const resultados = document.getElementById('resultados-cita-paciente');
    const detalle     = document.getElementById('citas-paciente-detalle');
    if (q.length < 2) { resultados.innerHTML = ''; detalle.innerHTML = ''; return; }
    const lista = await buscarPacientes(q);
    renderResultadosBusqueda('resultados-cita-paciente', lista, async (paciente) => {
      resultados.innerHTML = '';
      e.target.value = paciente.nombre;
      await _renderCitasDePaciente('citas-paciente-detalle', paciente);
    }, 'Ver citas');
  });
}

async function _renderCitasDePaciente(containerId, paciente) {
  const cont = document.getElementById(containerId);
  if (!cont) return;
  cont.innerHTML = '<div class="loading-dots">Cargando citas...</div>';

  const citas = await obtenerCitasPorCliente(paciente.id);
  const esProxima  = c => c.fecha >= HOY && ESTADOS_PROXIMAS.has(c.estado);
  const proximas   = citas.filter(esProxima).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const historial  = citas.filter(c => !esProxima(c)); // ya viene desc. por fecha desde obtenerCitasPorCliente

  const fila = c => `
    <div class="cita-row-card">
      <div class="cita-row-fecha">${escapeHtml(c.fecha)} · ${hora12Display(c.hora)}</div>
      <div class="cita-row-tipo">${escapeHtml(c.tipo || '—')}</div>
      ${badgeEstado(c.estado)}
    </div>`;

  cont.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-top:16px;margin-bottom:4px">
      <div class="avatar" style="width:34px;height:34px;font-size:12px">${escapeHtml(iniciales(paciente.nombre))}</div>
      <div style="font-size:15px;font-weight:600;color:var(--th-text,#161c2d)">${escapeHtml(paciente.nombre)}</div>
    </div>
    <div class="citas-seccion-titulo">Próximas citas</div>
    ${proximas.length ? proximas.map(fila).join('') : '<div class="empty-state">Sin citas próximas</div>'}
    <div class="citas-seccion-titulo">Historial</div>
    ${historial.length ? historial.map(fila).join('') : '<div class="empty-state">Sin historial</div>'}`;
}

export function bindTabsCitas() {
  const tabFecha   = document.getElementById('tab-citas-fecha');
  const tabBuscar  = document.getElementById('tab-citas-buscar');
  const modoFecha  = document.getElementById('citas-modo-fecha');
  const modoBuscar = document.getElementById('citas-modo-buscar');
  if (!tabFecha || !tabBuscar || !modoFecha || !modoBuscar) return;

  let montado = false;
  tabFecha.addEventListener('click', () => {
    tabFecha.classList.add('active'); tabBuscar.classList.remove('active');
    modoFecha.style.display = ''; modoBuscar.style.display = 'none';
  });
  tabBuscar.addEventListener('click', () => {
    tabBuscar.classList.add('active'); tabFecha.classList.remove('active');
    modoFecha.style.display = 'none'; modoBuscar.style.display = '';
    if (!montado) { renderBuscadorCitas('buscador-citas-container'); montado = true; }
  });
}

export function renderFormEditar(paciente) {
  const cont = document.getElementById('pac-editar-form');
  if (!cont) return;
  cont.innerHTML = `
    <div style="background:#f8fbff;border:1px solid #d0e8fb;border-radius:8px;padding:18px 20px;margin-top:12px">
      <div style="font-size:12px;font-weight:600;color:#0A76D8;margin-bottom:14px;text-transform:uppercase;letter-spacing:.05em">
        Editando: ${escapeHtml(paciente.nombre)}
      </div>
      <div class="form-row-2col">
        <div class="form-group">
          <label class="form-label">Nombre completo <span>*</span></label>
          <input class="input-text" id="edit-nombre" value="${escapeHtml(paciente.nombre || '')}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Telefono <span style="color:#8492a6;font-weight:400">(no editable)</span></label>
          <input class="input-text" value="${escapeHtml(paciente.telefono || '')}" disabled
            style="background:#f0f4f8;color:#8492a6;cursor:not-allowed"/>
        </div>
      </div>
      <div class="form-row-2col">
        <div class="form-group">
          <label class="form-label">Documento</label>
          <input class="input-text" id="edit-documento" value="${escapeHtml(paciente.documento || '')}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Correo</label>
          <input class="input-text" id="edit-email" type="email" value="${escapeHtml(paciente.email || '')}"/>
        </div>
      </div>
      <div class="form-row-2col">
        <div class="form-group">
          <label class="form-label">Departamento</label>
          <select class="input-text" id="edit-dpto"><option value="">Cargando...</option></select>
        </div>
        <div class="form-group">
          <label class="form-label">Ciudad</label>
          <select class="input-text" id="edit-ciudad" disabled><option value="">Seleccionar depto...</option></select>
        </div>
      </div>
      <div class="form-row-2col">
        <div class="form-group">
          <label class="form-label">Fecha de nacimiento</label>
          <input class="input-text" id="edit-nacimiento" type="date" value="${escapeHtml(paciente.fechaNacimiento || '')}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Condicion / motivo</label>
          <input class="input-text" id="edit-condicion" value="${escapeHtml(paciente.condicion || '')}"
            placeholder="Dolor lumbar cronico..."/>
        </div>
      </div>
      <div id="alert-editar-pac" style="margin-top:8px"></div>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn btn-gray" id="btn-cancelar-editar">Cancelar</button>
        <button class="btn btn-primary" id="btn-guardar-editar" data-id="${escapeHtml(paciente.id)}">Guardar cambios</button>
      </div>
    </div>`;
}

export function renderPills(ciudades, ciudadActiva, onSeleccionar) {
  const cont = document.getElementById('ciudad-pills');
  if (!cont) return;
  if (!ciudades.length) { cont.innerHTML = ''; return; }
  cont.innerHTML =
    `<span class="pill ${!ciudadActiva ? 'active' : ''}" data-ciudad="">Todas</span>` +
    ciudades.map(c =>
      `<span class="pill ${ciudadActiva === c ? 'active' : ''}" data-ciudad="${escapeHtml(c)}">${escapeHtml(c)}</span>`
    ).join('');
  cont.querySelectorAll('.pill').forEach(pill =>
    pill.addEventListener('click', () => onSeleccionar(pill.dataset.ciudad)));
}

export function renderUsuarios(lista) {
  const tbody = document.getElementById('usuarios-tbody');
  if (!tbody) return;
  tbody.innerHTML = lista.length
    ? lista.map(u => `
        <tr>
          <td>${escapeHtml(u.nombre || '—')}</td>
          <td>${escapeHtml(u.email)}</td>
          <td><span class="badge badge-primary">${escapeHtml(u.rol)}</span></td>
          <td>${u.activo
            ? '<span class="badge badge-success">Activo</span>'
            : '<span class="badge badge-gray">Inactivo</span>'
          }</td>
        </tr>`).join('')
    : '<tr><td colspan="4" class="empty-state">Sin usuarios</td></tr>';
}

// ══════════════════════════════════════════════════════════
// PANELES DEL DASHBOARD (sin cambios)
// ══════════════════════════════════════════════════════════
function horaActualStr() {
  const n = new Date();
  return `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`;
}

function clasificarCita(hora) {
  const ahora = horaActualStr();
  const [hh, mm] = hora.split(':').map(Number);
  const finMin = mm + 20;
  const fin = `${String(hh + Math.floor(finMin / 60)).padStart(2,'0')}:${String(finMin % 60).padStart(2,'0')}`;
  if (ahora >= hora && ahora < fin) return 'en_curso';
  if (ahora >= fin)                 return 'pasada';
  return 'proxima';
}

export async function renderDashboardPaneles(onCompletar, onVozCita, mostrarPendientes = false, permitirCompletar = true, usarAsistenteFlotante = false, asistenteAcciones = {}) {
  const cont = document.getElementById('dash-panel-wrap');
  if (!cont) return;

  const citas      = await obtenerCitasPorFecha(HOY);
  const activas    = citas.filter(c => c.estado === ESTADOS.ACTIVA);
  const pendientes = mostrarPendientes ? await obtenerCitasPendientesConfirmacion() : [];

  const enCurso   = activas.find(c => clasificarCita(c.hora) === 'en_curso');
  const proxima   = activas.find(c => clasificarCita(c.hora) === 'proxima');
  const foco       = enCurso || proxima || null;
  const esEnCurso = !!enCurso;

  cont.innerHTML = `
    <div class="dash-panels-grid ${usarAsistenteFlotante ? 'dash-panels-grid-solo' : ''}">
      <div class="dash-panel dash-panel-cita">
        <div class="dash-panel-label">
          ${esEnCurso
            ? '<span class="dash-dot dash-dot-verde"></span> Atendiendo ahora'
            : '<span class="dash-dot dash-dot-azul"></span> Proxima cita'}
        </div>
        ${foco ? `
          <div class="dash-cita-card"
               data-cliente-id="${escapeHtml(foco.clienteId || '')}"
               data-cliente-ciudad="${escapeHtml(foco.clienteCiudad || '')}"
               data-tipo-sesion="${escapeHtml(foco.tipo || 'Ajuste general')}"
               data-hora="${escapeHtml(foco.hora)}">
            <div class="dash-cita-hora">${hora12Display(foco.hora)}</div>
            <div class="dash-cita-avatar">${escapeHtml(iniciales(foco.clienteNombre))}</div>
            <div class="dash-cita-info">
              <div class="dash-cita-nombre">${escapeHtml(foco.clienteNombre)}</div>
              <div class="dash-cita-meta">${escapeHtml(foco.tipo)}</div>
              <div class="dash-cita-ciudad">${escapeHtml(foco.clienteCiudad || '—')}</div>
            </div>
            ${esEnCurso && permitirCompletar ? `
              <button class="btn btn-soft btn-sm" id="btn-completar-foco" data-id="${foco.id}">
                Completar
              </button>` : ''}
          </div>
          <div class="dash-proximas-lista" id="dash-proximas-lista"></div>
        ` : `<div class="dash-panel-empty">Sin citas pendientes para hoy</div>`}
      </div>

      ${usarAsistenteFlotante ? '' : `
      <div class="dash-panel dash-panel-ia" id="dash-panel-ia">
        <div class="dash-panel-label">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            stroke-width="2" style="vertical-align:-2px;margin-right:5px">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8"  y1="23" x2="16" y2="23"/>
          </svg>
          Agente IA — agendar por voz
        </div>
        <div class="ia-voz-estado" id="ia-voz-estado">
          Di algo como: <em>"Cita para Juan Perez el viernes a las 10 de la manana"</em>
        </div>
        <div class="ia-voz-controles">
          <button class="ia-mic-btn" id="ia-mic-btn" title="Clic para hablar">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            </svg>
          </button>
          <span class="ia-mic-hint" id="ia-mic-hint">Presiona para hablar</span>
        </div>
        <div class="ia-voz-transcript" id="ia-voz-transcript" style="display:none"></div>
        <div class="ia-voz-resultado"  id="ia-voz-resultado"  style="display:none"></div>
        <div class="ia-voz-acciones"   id="ia-voz-acciones"   style="display:none">
          <button class="btn btn-primary btn-sm" id="ia-btn-confirmar">Confirmar cita</button>
          <button class="btn btn-gray btn-sm"     id="ia-btn-descartar">Descartar</button>
        </div>
      </div>`}

      ${pendientes.length ? `
        <div class="dash-panel dash-panel-pendientes" id="dash-panel-pendientes" style="${usarAsistenteFlotante ? '' : 'grid-column:2;'}cursor:pointer" title="Ir a Finanzas a confirmar">
          <div class="dash-panel-label">
            <span class="dash-dot dash-dot-yellow"></span> Pendientes por confirmar
          </div>
          <div class="dash-proximas-lista">
            ${pendientes.slice(0, 3).map(c => `
              <div class="dash-proxima-item">
                <span class="dash-proxima-hora">${hora12Display(c.hora)}</span>
                <span class="dash-proxima-nombre">${escapeHtml(c.clienteNombre)}</span>
                <span class="dash-proxima-tipo">${formatCOP(c.pagoPendiente?.totalCobrado || 0)}</span>
              </div>`).join('')}
            ${pendientes.length > 3 ? `<div class="dash-proxima-item" style="justify-content:center;color:var(--th-text2)">+${pendientes.length - 3} más</div>` : ''}
          </div>
        </div>
      ` : ''}
    </div>`;

  document.getElementById('dash-panel-pendientes')?.addEventListener('click', () => {
    document.querySelector('[data-view="finanzas"]')?.click();
  });

  document.getElementById('btn-completar-foco')
    ?.addEventListener('click', async (e) => {
      await onCompletar(e.currentTarget.dataset.id);
      await renderDashboardPaneles(onCompletar, onVozCita, mostrarPendientes, permitirCompletar, usarAsistenteFlotante, asistenteAcciones);
    });

  const listaCont = document.getElementById('dash-proximas-lista');
  if (listaCont && foco) {
    const resto = activas
      .filter(c => c.id !== foco.id && clasificarCita(c.hora) === 'proxima')
      .slice(0, 3);
    listaCont.innerHTML = resto.map(c => `
      <div class="dash-proxima-item">
        <span class="dash-proxima-hora">${hora12Display(c.hora)}</span>
        <span class="dash-proxima-nombre">${escapeHtml(c.clienteNombre)}</span>
        <span class="dash-proxima-tipo">${escapeHtml(c.tipo)}</span>
      </div>`).join('');
  }

  if (usarAsistenteFlotante) {
    initAsistenteFlotante(onVozCita, asistenteAcciones);
  } else {
    initAgenteVoz(onVozCita);
  }
}

// Gemini suele envolver el JSON en fences de markdown (```json ... ```)
// pese a pedir responseMimeType:'application/json', o agrega texto
// alrededor. Esto limpia esos casos antes de parsear.
function parsearJSONGemini(texto) {
  if (!texto) return {};
  const limpio = texto.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(limpio);
  } catch {
    const match = limpio.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    return {};
  }
}

// ── Agente de voz (Gemini) — sin cambios ─────────────────
function initAgenteVoz(onVozCita) {
  const micBtn     = document.getElementById('ia-mic-btn');
  const micHint    = document.getElementById('ia-mic-hint');
  const estadoEl   = document.getElementById('ia-voz-estado');
  const transcEl   = document.getElementById('ia-voz-transcript');
  const resultEl   = document.getElementById('ia-voz-resultado');
  const accionesEl = document.getElementById('ia-voz-acciones');

  if (!micBtn) return;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    estadoEl.textContent = 'Tu navegador no soporta voz. Usa Chrome o Edge.';
    micBtn.disabled      = false;
    micBtn.style.opacity = '0.4';
    return;
  }

  const rec = new SR();
  rec.lang = 'es-CO'; rec.interimResults = false; rec.maxAlternatives = 1; rec.continuous = false;
  let grabando = false; let citaExtraida = null;

  micBtn.addEventListener('click', () => {
    if (grabando) {
      grabando = false;
      micBtn.classList.remove('grabando');
      micHint.textContent = 'Procesando...';
      rec.stop(); return;
    }
    grabando = true; citaExtraida = null;
    micBtn.classList.add('grabando');
    micHint.textContent = 'Escuchando... (clic para detener)';
    estadoEl.innerHTML  = 'Te estoy escuchando...';
    transcEl.textContent = ''; transcEl.style.display = 'none';
    resultEl.style.display = 'none'; accionesEl.style.display = 'none';
    try { rec.start(); } catch { rec.stop(); setTimeout(() => rec.start(), 300); }
  });

  rec.onresult = (e) => {
    const texto = Array.from(e.results).map(r => r[0].transcript).join('');
    transcEl.textContent = `"${texto}"`; transcEl.style.display = 'block';
  };

  rec.onend = async () => {
    // Se limpia aquí (no solo en el click) porque rec.onspeechend puede
    // detener el reconocimiento automáticamente sin pasar por el click
    // handler — si no, el botón se queda en rojo como si siguiera escuchando.
    grabando = false;
    micBtn.classList.remove('grabando');
    micHint.textContent = 'Presiona para hablar';
    const textoFinal = (transcEl.textContent || '').replace(/^"|"$/g, '').trim();
    if (!textoFinal) { estadoEl.innerHTML = 'No detecte audio. Habla mas cerca del microfono.'; return; }

    estadoEl.innerHTML = 'Analizando cita con Gemini...';
    micBtn.disabled = true;
    const hoy = new Date().toISOString().split('T')[0];

    try {
      const _gKey = import.meta.env.VITE_GEMINI_KEY;
      const _gUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${_gKey}`;
      const res = await fetch(_gUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: `Eres el asistente de recepcion de un consultorio quiropractico en Colombia. Extrae datos de citas del texto dictado. Hoy es ${hoy}. Calcula fechas relativas. Convierte horas a formato 24h. Formato de salida: {"clienteNombre":string|null,"fecha":"YYYY-MM-DD"|null,"hora":"HH:MM"|null,"tipo":string,"notas":string}` }] },
          contents: [{ role: 'user', parts: [{ text: `DICTADO: "${textoFinal}"` }] }],
          generationConfig: { maxOutputTokens: 400, temperature: 0.1, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } }
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      citaExtraida = parsearJSONGemini(data.candidates?.[0]?.content?.parts?.[0]?.text);

      resultEl.style.display = 'block';
      resultEl.innerHTML = `
        <div class="ia-resultado-item"><span class="ia-resultado-label">Paciente</span><span class="ia-resultado-val">${citaExtraida.clienteNombre ? escapeHtml(citaExtraida.clienteNombre) : '<span style="color:#e67e22">No detectado</span>'}</span></div>
        <div class="ia-resultado-item"><span class="ia-resultado-label">Fecha</span><span class="ia-resultado-val">${citaExtraida.fecha ? escapeHtml(citaExtraida.fecha) : '<span style="color:#e67e22">No detectada</span>'}</span></div>
        <div class="ia-resultado-item"><span class="ia-resultado-label">Hora</span><span class="ia-resultado-val">${citaExtraida.hora ? escapeHtml(citaExtraida.hora) : '<span style="color:#e67e22">No detectada</span>'}</span></div>
        <div class="ia-resultado-item"><span class="ia-resultado-label">Tipo</span><span class="ia-resultado-val">${escapeHtml(citaExtraida.tipo || 'Ajuste general')}</span></div>`;
      estadoEl.innerHTML = 'Datos extraidos correctamente:';
      accionesEl.style.display = 'flex';
    } catch (err) {
      estadoEl.innerHTML = `Error: ${err.message}`;
    }
    micBtn.disabled = false;
  };

  rec.onspeechend = () => {
    if (grabando) rec.stop();
  };

  rec.onerror = (e) => {
    grabando = false; micBtn.classList.remove('grabando'); micBtn.disabled = false;
    micHint.textContent = 'Presiona para hablar'; estadoEl.textContent = `Error: ${e.error}`;
  };

  document.getElementById('ia-btn-confirmar')?.addEventListener('click', () => {
    if (!citaExtraida) return; onVozCita(citaExtraida);
    resultEl.style.display = 'none'; transcEl.style.display = 'none';
    accionesEl.style.display = 'none';
    estadoEl.innerHTML = 'Di algo como: <em>"Cita para Juan Perez el viernes a las 10"</em>';
    citaExtraida = null;
  });
  document.getElementById('ia-btn-descartar')?.addEventListener('click', () => {
    resultEl.style.display = 'none'; transcEl.style.display = 'none';
    accionesEl.style.display = 'none';
    estadoEl.innerHTML = 'Di algo como: <em>"Cita para Juan Perez el viernes a las 10"</em>';
    citaExtraida = null;
  });
}

// ══════════════════════════════════════════════════════════
// ASISTENTE IA FLOTANTE (panel de administrador)
// Botón flotante + chat: agenda citas por voz/texto y responde
// preguntas sobre el uso de la aplicación en un único flujo.
// ══════════════════════════════════════════════════════════
let _iaFabInicializado    = false;
let _onVozCitaFab         = null;
let _onCancelarCitaFab    = null;
let _onReprogramarCitaFab = null;
let _iaFabHistorial       = []; // [{ role: 'user'|'model', text }]
let _iaEnviando           = false;

const IA_SUGERENCIAS = [
  '¿Cómo agendo una cita?',
  'Agenda una cita para Juan Pérez mañana a las 10',
  'Cancela la cita de María López de mañana',
  'Reprograma la cita de Juan Pérez para el viernes a las 3',
];

/**
 * Inicializa el asistente flotante (botón + chat).
 * @param {Function} onVozCita — abre el modal de nueva cita prellenado.
 * @param {{onCancelarCita?: Function, onReprogramarCita?: Function}} acciones
 *   onCancelarCita(cita)                    → Promise<boolean>, cancela con motivo.
 *   onReprogramarCita(cita, nuevaFecha, nuevaHora) → abre el modal de reprogramar.
 */
function initAsistenteFlotante(onVozCita, acciones = {}) {
  _onVozCitaFab         = onVozCita;
  _onCancelarCitaFab    = acciones.onCancelarCita    || null;
  _onReprogramarCitaFab = acciones.onReprogramarCita || null;
  if (_iaFabInicializado) return;

  const fab      = document.getElementById('ia-fab');
  const panel    = document.getElementById('ia-chat-panel');
  const closeBtn = document.getElementById('ia-chat-close');
  const input    = document.getElementById('ia-chat-input');
  const sendBtn  = document.getElementById('ia-chat-send');
  const micBtn   = document.getElementById('ia-chat-mic-btn');
  if (!fab || !panel) return;
  _iaFabInicializado = true;

  const cerrarChatIA = () => {
    panel.classList.remove('open');
    fab.classList.remove('ia-fab-open');
  };

  fab.addEventListener('click', () => {
    const abierto = panel.classList.toggle('open');
    fab.classList.toggle('ia-fab-open', abierto);
    if (abierto) {
      if (!_iaFabHistorial.length) mostrarBienvenidaIA();
      input?.focus();
      scrollChatAbajo();
    }
  });
  closeBtn?.addEventListener('click', cerrarChatIA);

  sendBtn?.addEventListener('click', () => enviarMensajeIA(input?.value));
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); enviarMensajeIA(input.value); }
  });

  initMicIA(micBtn, input);
}

function mostrarBienvenidaIA() {
  agregarBurbujaIA('bot', 'Hola, soy tu asistente. Puedo ayudarte a agendar citas por voz o texto, y responder preguntas sobre cómo usar la aplicación.');
  const cont = document.getElementById('ia-chat-messages');
  if (!cont) return;
  const chipsWrap = document.createElement('div');
  chipsWrap.className = 'ia-chat-chips';
  chipsWrap.innerHTML = IA_SUGERENCIAS.map(s => `<button class="ia-chip" type="button">${s}</button>`).join('');
  chipsWrap.querySelectorAll('.ia-chip').forEach(chip => {
    chip.addEventListener('click', () => enviarMensajeIA(chip.textContent));
  });
  cont.appendChild(chipsWrap);
  scrollChatAbajo();
}

function scrollChatAbajo() {
  const cont = document.getElementById('ia-chat-messages');
  if (cont) cont.scrollTop = cont.scrollHeight;
}

function agregarBurbujaIA(tipo, texto) {
  const cont = document.getElementById('ia-chat-messages');
  if (!cont) return null;
  const el = document.createElement('div');
  el.className = `ia-msg ia-msg-${tipo}`;
  el.textContent = texto;
  cont.appendChild(el);
  scrollChatAbajo();
  return el;
}

function agregarTypingIA() {
  const cont = document.getElementById('ia-chat-messages');
  if (!cont) return null;
  const el = document.createElement('div');
  el.className = 'ia-msg ia-msg-bot ia-msg-typing';
  el.innerHTML = '<span></span><span></span><span></span>';
  cont.appendChild(el);
  scrollChatAbajo();
  return el;
}

function agregarBurbujaCitaIA(datos) {
  const cont = document.getElementById('ia-chat-messages');
  if (!cont) return;
  const el = document.createElement('div');
  el.className = 'ia-msg ia-msg-bot ia-msg-cita';
  el.innerHTML = `
    <div class="ia-msg-cita-titulo">📅 Datos de la cita detectados</div>
    <div class="ia-resultado-item"><span class="ia-resultado-label">Paciente</span><span class="ia-resultado-val">${datos.clienteNombre ? escapeHtml(datos.clienteNombre) : '<span style="color:#e67e22">No detectado</span>'}</span></div>
    <div class="ia-resultado-item"><span class="ia-resultado-label">Fecha</span><span class="ia-resultado-val">${datos.fecha ? escapeHtml(datos.fecha) : '<span style="color:#e67e22">No detectada</span>'}</span></div>
    <div class="ia-resultado-item"><span class="ia-resultado-label">Hora</span><span class="ia-resultado-val">${datos.hora ? escapeHtml(datos.hora) : '<span style="color:#e67e22">No detectada</span>'}</span></div>
    <div class="ia-resultado-item"><span class="ia-resultado-label">Tipo</span><span class="ia-resultado-val">${escapeHtml(datos.tipo || 'Ajuste general')}</span></div>
    <div class="ia-msg-cita-acciones">
      <button class="btn btn-primary btn-sm" type="button" data-accion="confirmar">Confirmar cita</button>
      <button class="btn btn-gray btn-sm" type="button" data-accion="descartar">Descartar</button>
    </div>`;
  cont.appendChild(el);

  el.querySelector('[data-accion="confirmar"]').addEventListener('click', () => {
    document.getElementById('ia-chat-panel')?.classList.remove('open');
    document.getElementById('ia-fab')?.classList.remove('ia-fab-open');
    _onVozCitaFab?.(datos);
    el.querySelector('.ia-msg-cita-acciones')?.remove();
    const aviso = document.createElement('div');
    aviso.className = 'ia-msg-cita-estado';
    aviso.textContent = '✓ Abrí el formulario de la cita para que la confirmes.';
    el.appendChild(aviso);
  });
  el.querySelector('[data-accion="descartar"]').addEventListener('click', () => {
    el.querySelector('.ia-msg-cita-acciones')?.remove();
    const aviso = document.createElement('div');
    aviso.className = 'ia-msg-cita-estado';
    aviso.textContent = 'Descartado.';
    el.appendChild(aviso);
  });
  scrollChatAbajo();
}

// ── Buscar cita(s) existentes para cancelar/reprogramar por voz/texto ──
async function buscarCitasParaAsistente({ clienteNombre, fecha }) {
  let candidatas;
  if (fecha) {
    candidatas = await obtenerCitasPorFecha(fecha);
  } else {
    const d = new Date(HOY + 'T12:00:00');
    d.setDate(d.getDate() + 60);
    candidatas = await obtenerCitasPorRangoFecha(HOY, d.toLocaleDateString('en-CA'));
  }
  candidatas = candidatas.filter(c => c.estado === ESTADOS.ACTIVA);
  if (clienteNombre) {
    const q = clienteNombre.trim().toLowerCase();
    candidatas = candidatas.filter(c => (c.clienteNombre || '').toLowerCase().includes(q));
  }
  return candidatas
    .sort((a, b) => `${a.fecha}${a.hora}`.localeCompare(`${b.fecha}${b.hora}`))
    .slice(0, 5);
}

// Punto de entrada para intents "cancelar_cita" / "reprogramar_cita":
// ubica la(s) cita(s) que coinciden y muestra la tarjeta de acción,
// o una lista para elegir si hay varias coincidencias.
async function manejarAccionCitaIA(intent, datos) {
  if (!datos.clienteNombre && !datos.fecha) {
    agregarBurbujaIA('bot', 'Necesito al menos el nombre del paciente o la fecha de la cita para poder ubicarla.');
    return;
  }

  const candidatas = await buscarCitasParaAsistente({ clienteNombre: datos.clienteNombre, fecha: datos.fecha });

  if (!candidatas.length) {
    agregarBurbujaIA('bot', 'No encontré ninguna cita activa que coincida. ¿Puedes darme el nombre completo del paciente o la fecha exacta?');
    return;
  }
  if (candidatas.length === 1) {
    agregarBurbujaAccionCitaIA(intent, candidatas[0], datos);
    return;
  }

  const cont = document.getElementById('ia-chat-messages');
  if (!cont) return;
  const el = document.createElement('div');
  el.className = 'ia-msg ia-msg-bot ia-msg-lista';
  el.innerHTML = `<div class="ia-msg-cita-titulo">Encontré varias citas, ¿cuál?</div>` +
    candidatas.map((c, i) => `
      <button class="ia-lista-item" type="button" data-idx="${i}">
        <span class="ia-lista-fecha">${escapeHtml(c.fecha)} · ${hora12Display(c.hora)}</span>
        <span class="ia-lista-nombre">${escapeHtml(c.clienteNombre)}</span>
      </button>`).join('');
  cont.appendChild(el);
  el.querySelectorAll('[data-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      el.remove();
      agregarBurbujaAccionCitaIA(intent, candidatas[Number(btn.dataset.idx)], datos);
    });
  });
  scrollChatAbajo();
}

function agregarBurbujaAccionCitaIA(intent, cita, datos) {
  const cont = document.getElementById('ia-chat-messages');
  if (!cont) return;
  const esCancelar = intent === 'cancelar_cita';
  const el = document.createElement('div');
  el.className = 'ia-msg ia-msg-bot ia-msg-cita';
  el.innerHTML = `
    <div class="ia-msg-cita-titulo">${esCancelar ? '🗑️ Cita a cancelar' : '🔁 Cita a reprogramar'}</div>
    <div class="ia-resultado-item"><span class="ia-resultado-label">Paciente</span><span class="ia-resultado-val">${escapeHtml(cita.clienteNombre)}</span></div>
    <div class="ia-resultado-item"><span class="ia-resultado-label">Fecha actual</span><span class="ia-resultado-val">${escapeHtml(cita.fecha)}</span></div>
    <div class="ia-resultado-item"><span class="ia-resultado-label">Hora actual</span><span class="ia-resultado-val">${hora12Display(cita.hora)}</span></div>
    ${!esCancelar ? `
    <div class="ia-resultado-item"><span class="ia-resultado-label">Nueva fecha</span><span class="ia-resultado-val">${datos.nuevaFecha ? escapeHtml(datos.nuevaFecha) : '<span style="color:#e67e22">por definir</span>'}</span></div>
    <div class="ia-resultado-item"><span class="ia-resultado-label">Nueva hora</span><span class="ia-resultado-val">${datos.nuevaHora ? hora12Display(datos.nuevaHora) : '<span style="color:#e67e22">por definir</span>'}</span></div>
    ` : ''}
    <div class="ia-msg-cita-acciones">
      <button class="btn ${esCancelar ? 'btn-danger' : 'btn-primary'} btn-sm" type="button" data-accion="ejecutar">${esCancelar ? 'Cancelar cita' : 'Reprogramar'}</button>
      <button class="btn btn-gray btn-sm" type="button" data-accion="descartar">Descartar</button>
    </div>`;
  cont.appendChild(el);

  el.querySelector('[data-accion="ejecutar"]').addEventListener('click', async () => {
    const btnEjecutar = el.querySelector('[data-accion="ejecutar"]');
    btnEjecutar.disabled = true;

    if (esCancelar) {
      const ok = await _onCancelarCitaFab?.(cita);
      el.querySelector('.ia-msg-cita-acciones')?.remove();
      const aviso = document.createElement('div');
      aviso.className = 'ia-msg-cita-estado';
      aviso.textContent = ok ? '✓ Cita cancelada.' : 'No se canceló la cita.';
      el.appendChild(aviso);
    } else {
      document.getElementById('ia-chat-panel')?.classList.remove('open');
      document.getElementById('ia-fab')?.classList.remove('ia-fab-open');
      _onReprogramarCitaFab?.(cita, datos.nuevaFecha, datos.nuevaHora);
      el.querySelector('.ia-msg-cita-acciones')?.remove();
      const aviso = document.createElement('div');
      aviso.className = 'ia-msg-cita-estado';
      aviso.textContent = '✓ Abrí el formulario para que confirmes la nueva fecha y hora.';
      el.appendChild(aviso);
    }
    scrollChatAbajo();
  });
  el.querySelector('[data-accion="descartar"]').addEventListener('click', () => {
    el.querySelector('.ia-msg-cita-acciones')?.remove();
    const aviso = document.createElement('div');
    aviso.className = 'ia-msg-cita-estado';
    aviso.textContent = 'Descartado.';
    el.appendChild(aviso);
  });
  scrollChatAbajo();
}

async function enviarMensajeIA(texto) {
  if (_iaEnviando) return;
  texto = (texto || '').trim();
  if (!texto) return;

  const input   = document.getElementById('ia-chat-input');
  const sendBtn = document.getElementById('ia-chat-send');
  if (input) input.value = '';
  agregarBurbujaIA('user', texto);

  _iaEnviando = true;
  if (sendBtn) sendBtn.disabled = true;
  const typingEl = agregarTypingIA();

  try {
    const data = await consultarAsistenteIA(texto, _iaFabHistorial);
    _iaFabHistorial.push({ role: 'user', text: texto }, { role: 'model', text: data.mensaje || '' });
    if (_iaFabHistorial.length > 12) _iaFabHistorial = _iaFabHistorial.slice(-12);

    typingEl?.remove();
    if (data.intent === 'agendar_cita' && (data.clienteNombre || data.fecha || data.hora)) {
      if (data.mensaje) agregarBurbujaIA('bot', data.mensaje);
      agregarBurbujaCitaIA(data);
    } else if (data.intent === 'cancelar_cita' || data.intent === 'reprogramar_cita') {
      if (data.mensaje) agregarBurbujaIA('bot', data.mensaje);
      await manejarAccionCitaIA(data.intent, data);
    } else {
      agregarBurbujaIA('bot', data.mensaje || 'No logré entenderte bien, ¿puedes reformular la pregunta?');
    }
  } catch (err) {
    typingEl?.remove();
    agregarBurbujaIA('bot', 'Tuve un problema para responder. Intenta de nuevo en un momento.');
  } finally {
    _iaEnviando = false;
    if (sendBtn) sendBtn.disabled = false;
  }
}

// Llamada unificada a Gemini: detecta si el mensaje pide agendar una cita
// o es una pregunta general sobre el uso de la aplicación, y responde
// siempre con el mismo esquema JSON para que el chat lo pueda renderizar.
async function consultarAsistenteIA(texto, historial) {
  const hoy = new Date().toISOString().split('T')[0];
  const systemPrompt = `Eres el asistente virtual del panel de administración de "Quiromasajes E.F", un sistema para gestionar un consultorio quiropráctico en Colombia. Debes clasificar cada mensaje en uno de estos 4 tipos (intent):

1) "agendar_cita": el usuario quiere programar una cita NUEVA. Extrae clienteNombre, fecha, hora, tipo y notas de la nueva cita. IMPORTANTE: clasifica como "agendar_cita" aunque falten datos — incluso si el mensaje solo dice "créame una cita para Juan" o "agenda una cita" sin más detalles. Nunca uses "pregunta" solo porque el mensaje está incompleto: deja en null lo que no te dieron, y en "mensaje" pide amablemente el dato que falte (ej. "¿Qué fecha y hora prefieres para Juan?").

2) "cancelar_cita": el usuario quiere cancelar una cita YA EXISTENTE. Extrae clienteNombre y, si los menciona, fecha y/u hora de ESA cita existente (para poder ubicarla en la agenda). No inventes fecha/hora si no las menciona.

3) "reprogramar_cita": el usuario quiere mover una cita YA EXISTENTE a otro horario. Extrae clienteNombre y fecha/hora de la cita existente si las menciona, y además nuevaFecha/nuevaHora con el horario nuevo deseado (si lo dijo).

4) "pregunta": si el mensaje es una pregunta o pide ayuda sobre cómo usar el sistema, respóndela basándote en esta guía de secciones:
- Dashboard: resumen del día — KPIs de citas, ingresos, pacientes y cancelaciones; cita en curso o próxima; este asistente.
- Pacientes: registrar, buscar, editar y eliminar pacientes; filtrar por ciudad.
- Citas: agendar, reprogramar, cancelar y completar las citas del día por horario.
- Cronograma: vista de las citas de hoy agrupadas por estado.
- Semana: ocupación mensual y semanal, clic en un día para ver sus citas.
- Finanzas: ingresos del día y del mes, cobros pendientes de aprobación enviados por secretaría o call-center (se pueden editar antes de aprobar), desprendible imprimible, citas canceladas.
- Usuarios: crear usuarios, cambiar rol, activar/desactivar, cambiar contraseña o eliminar (solo Administrador).
- Configuración: tema claro/oscuro, tarifa e ingresos, horario de trabajo, notificaciones, roles del equipo, cerrar sesión.
- Sedes y viajes: programar viajes a otras ciudades; bloquean la sede local esas fechas y reprograman las citas afectadas.
- Informes: reportes imprimibles de resumen diario, finanzas, citas, pacientes, cronograma y cierre mensual.

Hoy es ${hoy}; calcula fechas relativas ("mañana", "el viernes", etc.) y usa formato 24h para las horas.
Responde siempre en español de Colombia, con tono cercano, claro y breve (máximo 3-4 oraciones si es una pregunta).

Ejemplos de mensajes incompletos que SIGUEN siendo "agendar_cita" (no "pregunta"):
- "créame una cita para Juan" → {"intent":"agendar_cita","clienteNombre":"Juan","fecha":null,"hora":null,"nuevaFecha":null,"nuevaHora":null,"tipo":null,"notas":null,"mensaje":"Listo, ¿qué fecha y hora prefieres para Juan?"}
- "agenda una cita" → {"intent":"agendar_cita","clienteNombre":null,"fecha":null,"hora":null,"nuevaFecha":null,"nuevaHora":null,"tipo":null,"notas":null,"mensaje":"Claro, ¿para quién es la cita y qué fecha y hora prefieres?"}

Responde ÚNICAMENTE con JSON válido, sin texto adicional ni markdown, con esta forma exacta:
{"intent":"agendar_cita"|"cancelar_cita"|"reprogramar_cita"|"pregunta","clienteNombre":string|null,"fecha":"YYYY-MM-DD"|null,"hora":"HH:MM"|null,"nuevaFecha":"YYYY-MM-DD"|null,"nuevaHora":"HH:MM"|null,"tipo":string|null,"notas":string|null,"mensaje":string}

En "mensaje" escribe siempre una respuesta breve: para agendar/cancelar/reprogramar, una confirmación de lo que entendiste; para pregunta, la respuesta. Deja en null cualquier campo que no aplique o no puedas extraer.`;

  const KEY  = import.meta.env?.VITE_GEMINI_KEY || '';
  const URL  = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${KEY}`;
  const contents = [
    ...historial.map(h => ({ role: h.role, parts: [{ text: h.text }] })),
    { role: 'user', parts: [{ text: texto }] },
  ];
  const res = await fetch(URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: { maxOutputTokens: 500, temperature: 0.3, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } }
    })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return parsearJSONGemini(data.candidates?.[0]?.content?.parts?.[0]?.text);
}

// ── Reconocimiento de voz para el chat flotante ───────────
function initMicIA(micBtn, input) {
  if (!micBtn || !input) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    micBtn.disabled = true;
    micBtn.title = 'Tu navegador no soporta voz (usa Chrome o Edge)';
    micBtn.style.opacity = '0.4';
    return;
  }

  const rec = new SR();
  rec.lang = 'es-CO'; rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
  let grabando = false;
  const placeholderOriginal = input.placeholder;

  micBtn.addEventListener('click', () => {
    if (grabando) { rec.stop(); return; }
    grabando = true;
    micBtn.classList.add('grabando');
    input.placeholder = 'Escuchando... (clic para detener)';
    try { rec.start(); } catch { rec.stop(); setTimeout(() => rec.start(), 300); }
  });

  rec.onresult = (e) => {
    input.value = Array.from(e.results).map(r => r[0].transcript).join('');
  };

  rec.onend = () => {
    grabando = false;
    micBtn.classList.remove('grabando');
    input.placeholder = placeholderOriginal;
    if (input.value.trim()) enviarMensajeIA(input.value);
  };

  rec.onspeechend = () => { if (grabando) rec.stop(); };
  rec.onerror = () => {
    grabando = false;
    micBtn.classList.remove('grabando');
    input.placeholder = placeholderOriginal;
  };
}

// =========================================================================
// NAVEGACIÓN INTELIGENTE DE TARJETAS KPI (DASHBOARD)
// =========================================================================
document.addEventListener('click', (e) => {
  // 1. Verificamos que el clic haya sido dentro de una tarjeta KPI 
  // Y que SOLO sea en la pantalla principal de Dashboard
  const kpiCard = e.target.closest('#view-dashboard .kpi-card');
  if (!kpiCard) return;

  let vistaDestino = '';

  // 2. Determinamos a dónde ir basados en el color de la tarjeta
  if (kpiCard.classList.contains('kpi-blue') || kpiCard.classList.contains('kpi-cyan')) {
    vistaDestino = 'citas';     // Citas hoy y Pendientes
  } else if (kpiCard.classList.contains('kpi-yellow')) {
    vistaDestino = 'pacientes'; // Pacientes activos
  } else if (kpiCard.classList.contains('kpi-green') || kpiCard.classList.contains('kpi-purple') || kpiCard.classList.contains('kpi-red')) {
    vistaDestino = 'finanzas';  // Ingresos del día, mes y Cancelaciones
  }

  // 3. Simulamos el clic en el botón correspondiente de tu menú lateral (Sidebar)
  if (vistaDestino) {
    const botonMenu = document.querySelector(`[data-view="${vistaDestino}"]`);
    if (botonMenu) {
      botonMenu.click();
    } else {
      console.warn(`No se encontró el botón del menú lateral para: ${vistaDestino}`);
    }
  }
});