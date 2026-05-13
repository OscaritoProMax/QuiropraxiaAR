// src/modules/dashboard/ui.js — Renderizado de vistas, slots, pacientes y estadísticas
// ui.js — Renderizado de vistas, slots, pacientes y estadísticas
// ══════════════════════════════════════════════════════════

import { iniciales, badgeEstado, HOY } from '../../shared/helpers.js';
import { obtenerCitasPorFecha, ESTADOS, HORARIOS } from '../citas/citasService.js';
import { obtenerPacientes }                         from '../pacientes/pacientesService.js';

// ── Helper: escribe en un elemento solo si existe ─────────
function setEl(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// ── Perfil en sidebar ─────────────────────────────────────
export function renderPerfil(usuario) {
  const partes = (usuario.nombre || 'U').trim().split(' ');
  const avatar = (partes[0][0] + (partes[1] ? partes[1][0] : '')).toUpperCase();
  setEl('sidebar-avatar', avatar);
  setEl('sidebar-nombre', usuario.nombre || usuario.email);
  setEl('sidebar-rol',     usuario.rol    || '—');
}

// ── Estadísticas del dashboard ────────────────────────────
export async function renderEstadisticas() {
  setEl('dash-fecha',
    new Date().toLocaleDateString('es-CO', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    })
  );

  const [citasHoy, todosPac] = await Promise.all([
    obtenerCitasPorFecha(HOY),
    obtenerPacientes(),
  ]);

  setEl('stat-citas',      citasHoy.length);
  setEl('stat-pacientes',  todosPac.length);
  setEl('stat-pendientes', citasHoy.filter(c => c.estado === ESTADOS.ACTIVA).length);
  setEl('stat-canceladas', citasHoy.filter(c => c.estado === ESTADOS.COMPLETADA).length);
}

// ── Tabla de citas de hoy (dashboard) ────────────────────
export async function renderCitasHoy(onCompletar) {
  const citas = await obtenerCitasPorFecha(HOY);
  const tbody = document.getElementById('dash-tbody');
  if (!tbody) return;

  if (!citas.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No hay citas para hoy</td></tr>';
    return;
  }

  tbody.innerHTML = citas.map(c => `
    <tr>
      <td>${c.hora}</td>
      <td>${c.clienteNombre}</td>
      <td>${c.clienteCiudad || '—'}</td>
      <td>${c.tipo}</td>
      <td>${badgeEstado(c.estado)}</td>
      <td>${c.estado === ESTADOS.ACTIVA
        ? `<button class="btn btn-soft btn-sm" data-completar="${c.id}">✓ Completar</button>`
        : '—'
      }</td>
    </tr>`).join('');

  tbody.querySelectorAll('[data-completar]').forEach(btn =>
    btn.addEventListener('click', () => onCompletar(btn.dataset.completar))
  );
}

// ── Vista de slots ────────────────────────────────────────
export async function renderSlots(fecha, { onAgendar, onCompletar, onReprogramar, onCancelar }) {
  const cont = document.getElementById('slots-container');
  if (!cont) return;
  cont.innerHTML = '<div class="empty-state">Cargando agenda...</div>';

  if (!HORARIOS.length) {
    cont.innerHTML = '<div class="empty-state">Sin horarios configurados</div>';
    return;
  }

  const citas   = await obtenerCitasPorFecha(fecha);
  const porHora = Object.fromEntries(citas.map(c => [c.hora, c]));

  cont.innerHTML = HORARIOS.map(hora => {
    const cita = porHora[hora];
    if (cita) {
      return `
        <div class="slot-row">
          <div class="slot-time">${hora}</div>
          <div class="slot-info">
            <div class="slot-name">${cita.clienteNombre}</div>
            <div class="slot-meta">${cita.tipo} · ${cita.clienteCiudad || 'Ciudad no registrada'}</div>
          </div>
          ${badgeEstado(cita.estado)}
          <div style="display:flex;gap:6px;margin-left:8px">
            ${cita.estado !== ESTADOS.CANCELADA ? `
              <button class="btn btn-soft btn-sm"   data-reprog="${cita.id}">↺</button>
              <button class="btn btn-danger btn-sm" data-cancelar="${cita.id}">✕</button>
            ` : ''}
            ${cita.estado === ESTADOS.ACTIVA ? `
              <button class="btn btn-gray btn-sm" data-completar="${cita.id}">✓</button>
            ` : ''}
          </div>
        </div>`;
    }
    return `
      <div class="slot-row slot-disponible">
        <div class="slot-time">${hora}</div>
        <div class="slot-empty">Disponible</div>
        <button class="btn btn-soft btn-sm" data-agendar-hora="${hora}">+ Agendar</button>
      </div>`;
  }).join('');

  cont.querySelectorAll('[data-agendar-hora]').forEach(b =>
    b.addEventListener('click', () => onAgendar(b.dataset.agendarHora, fecha)));  // fecha viene del closure de renderSlots
  cont.querySelectorAll('[data-completar]').forEach(b =>
    b.addEventListener('click', () => onCompletar(b.dataset.completar, fecha)));
  cont.querySelectorAll('[data-reprog]').forEach(b =>
    b.addEventListener('click', () => onReprogramar(b.dataset.reprog, fecha)));
  cont.querySelectorAll('[data-cancelar]').forEach(b =>
    b.addEventListener('click', () => onCancelar(b.dataset.cancelar, fecha)));
}

// ── Lista de pacientes ────────────────────────────────────
// ── Lista de pacientes (tab Buscar) ──────────────────────
export function renderPacientes(lista, { onEditar, onEliminar } = {}) {
  const cont = document.getElementById('lista-pacientes');
  if (!cont) return;
  if (!lista.length) {
    cont.innerHTML = '<div class="empty-state">No se encontraron pacientes</div>';
    return;
  }
  cont.innerHTML = lista.map(p => `
    <div class="patient-card" data-id="${p.id}">
      <div class="avatar">${iniciales(p.nombre)}</div>
      <div class="patient-info" style="flex:1">
        <div class="patient-name">${p.nombre}</div>
        <div class="patient-meta">Tel: ${p.telefono || '—'} · Doc: ${p.documento || '—'} · ${p.ciudad || '—'}</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <span class="badge badge-success">Activo</span>
        ${onEditar  ? `<button class="btn btn-soft btn-sm"   data-editar="${p.id}"   title="Editar">✎</button>` : ''}
        ${onEliminar ? `<button class="btn btn-danger btn-sm" data-eliminar="${p.id}" title="Eliminar">✕</button>` : ''}
      </div>
    </div>`).join('');

  if (onEditar) {
    cont.querySelectorAll('[data-editar]').forEach(btn =>
      btn.addEventListener('click', () => onEditar(
        lista.find(p => p.id === btn.dataset.editar)
      ))
    );
  }
  if (onEliminar) {
    cont.querySelectorAll('[data-eliminar]').forEach(btn =>
      btn.addEventListener('click', () => onEliminar(btn.dataset.eliminar,
        lista.find(p => p.id === btn.dataset.eliminar)?.nombre
      ))
    );
  }
}

// ── Resultados de búsqueda para Editar / Eliminar ────────
export function renderResultadosBusqueda(containerId, lista, onSeleccionar, labelAccion) {
  const cont = document.getElementById(containerId);
  if (!cont) return;
  if (!lista.length) {
    cont.innerHTML = '<div class="empty-state" style="padding:12px">Sin resultados</div>';
    return;
  }
  cont.innerHTML = lista.slice(0, 10).map(p => `
    <div class="pac-resultado" data-id="${p.id}"
      style="display:flex;align-items:center;gap:12px;padding:10px 14px;
             cursor:pointer;border-bottom:1px solid #f0f4f8;transition:background .15s">
      <div class="avatar" style="width:34px;height:34px;font-size:12px">${iniciales(p.nombre)}</div>
      <div style="flex:1">
        <div style="font-size:14px;font-weight:500;color:#161c2d">${p.nombre}</div>
        <div style="font-size:12px;color:#8492a6">Tel: ${p.telefono || '—'} · ${p.ciudad || '—'}</div>
      </div>
      <button class="btn btn-soft btn-sm">${labelAccion}</button>
    </div>`).join('');

  cont.querySelectorAll('.pac-resultado').forEach(row => {
    row.addEventListener('mouseover', () => row.style.background = '#f8fbff');
    row.addEventListener('mouseout',  () => row.style.background = '');
    row.addEventListener('click', () =>
      onSeleccionar(lista.find(p => p.id === row.dataset.id))
    );
  });
}

// ── Formulario de edición prellenado ─────────────────────
export function renderFormEditar(paciente) {
  const cont = document.getElementById('pac-editar-form');
  if (!cont) return;
  const CIUDADES_OPT = window.__CIUDADES__ || [];
  cont.innerHTML = `
    <div style="background:#f8fbff;border:1px solid #d0e8fb;border-radius:8px;padding:18px 20px;margin-top:12px">
      <div style="font-size:12px;font-weight:600;color:#0A76D8;margin-bottom:14px;text-transform:uppercase;letter-spacing:.05em">
        Editando: ${paciente.nombre}
      </div>
      <div class="form-row-2col">
        <div class="form-group">
          <label class="form-label">Nombre completo <span>*</span></label>
          <input class="input-text" id="edit-nombre" value="${paciente.nombre || ''}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Teléfono <span style="color:#8492a6;font-weight:400">(no editable)</span></label>
          <input class="input-text" value="${paciente.telefono || ''}" disabled
            style="background:#f0f4f8;color:#8492a6;cursor:not-allowed"/>
        </div>
      </div>
      <div class="form-row-2col">
        <div class="form-group">
          <label class="form-label">Documento</label>
          <input class="input-text" id="edit-documento" value="${paciente.documento || ''}"/>
        </div>
        <div class="form-group">
          <label class="form-label">Correo</label>
          <input class="input-text" id="edit-email" type="email" value="${paciente.email || ''}"/>
        </div>
      </div>
      <div class="form-row-2col">
        <div class="form-group">
          <label class="form-label">Ciudad</label>
          <select class="input-text" id="edit-ciudad">
            ${CIUDADES_OPT.map(c => `<option ${paciente.ciudad === c ? 'selected' : ''}>${c}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Fecha de nacimiento</label>
          <input class="input-text" id="edit-nacimiento" type="date" value="${paciente.fechaNacimiento || ''}"/>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Condición / motivo de consulta</label>
        <input class="input-text" id="edit-condicion" value="${paciente.condicion || ''}"
          placeholder="Ej: Dolor lumbar crónico"/>
      </div>
      <div id="alert-editar-pac" style="margin-top:8px"></div>
      <div style="display:flex;gap:8px;margin-top:14px">
        <button class="btn btn-gray" id="btn-cancelar-editar">Cancelar</button>
        <button class="btn btn-primary" id="btn-guardar-editar" data-id="${paciente.id}">Guardar cambios</button>
      </div>
    </div>`;
}

// ── Pills de ciudad ───────────────────────────────────────
export function renderPills(ciudades, ciudadActiva, onSeleccionar) {
  const cont = document.getElementById('ciudad-pills');
  if (!cont) return;
  if (!ciudades.length) { cont.innerHTML = ''; return; }

  cont.innerHTML =
    `<span class="pill ${!ciudadActiva ? 'active' : ''}" data-ciudad="">Todas</span>` +
    ciudades.map(c =>
      `<span class="pill ${ciudadActiva === c ? 'active' : ''}" data-ciudad="${c}">${c}</span>`
    ).join('');

  cont.querySelectorAll('.pill').forEach(pill =>
    pill.addEventListener('click', () => onSeleccionar(pill.dataset.ciudad)));
}

// ── Tabla de usuarios ─────────────────────────────────────
export function renderUsuarios(lista) {
  const tbody = document.getElementById('usuarios-tbody');
  if (!tbody) return;
  tbody.innerHTML = lista.length
    ? lista.map(u => `
        <tr>
          <td>${u.nombre || '—'}</td>
          <td>${u.email}</td>
          <td><span class="badge badge-primary">${u.rol}</span></td>
          <td>${u.activo
            ? '<span class="badge badge-success">Activo</span>'
            : '<span class="badge badge-gray">Inactivo</span>'
          }</td>
        </tr>`).join('')
    : '<tr><td colspan="4" class="empty-state">Sin usuarios</td></tr>';
}

// ── Helpers de tiempo ─────────────────────────────────────
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

// ── Paneles del dashboard ─────────────────────────────────
export async function renderDashboardPaneles(onCompletar, onVozCita) {
  const cont = document.getElementById('dash-panel-wrap');
  if (!cont) return;

  const citas   = await obtenerCitasPorFecha(HOY);
  const activas = citas.filter(c => c.estado === ESTADOS.ACTIVA);

  const enCurso   = activas.find(c => clasificarCita(c.hora) === 'en_curso');
  const proxima   = activas.find(c => clasificarCita(c.hora) === 'proxima');
  const foco       = enCurso || proxima || null;
  const esEnCurso = !!enCurso;

  cont.innerHTML = `
    <div class="dash-panels-grid">

      <div class="dash-panel dash-panel-cita">
        <div class="dash-panel-label">
          ${esEnCurso
            ? '<span class="dash-dot dash-dot-verde"></span> Atendiendo ahora'
            : '<span class="dash-dot dash-dot-azul"></span> Próxima cita'}
        </div>
        ${foco ? `
          <div class="dash-cita-card">
            <div class="dash-cita-hora">${foco.hora}</div>
            <div class="dash-cita-avatar">${iniciales(foco.clienteNombre)}</div>
            <div class="dash-cita-info">
              <div class="dash-cita-nombre">${foco.clienteNombre}</div>
              <div class="dash-cita-meta">${foco.tipo}</div>
              <div class="dash-cita-ciudad">${foco.clienteCiudad || '—'}</div>
            </div>
            ${esEnCurso ? `
              <button class="btn btn-soft btn-sm" id="btn-completar-foco" data-id="${foco.id}">
                ✓ Completar
              </button>` : ''}
          </div>
          <div class="dash-proximas-lista" id="dash-proximas-lista"></div>
        ` : `
          <div class="dash-panel-empty">Sin citas pendientes para hoy</div>
        `}
      </div>

      <div class="dash-panel dash-panel-ia" id="dash-panel-ia">
        <div class="dash-panel-label">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:5px">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8"  y1="23" x2="16" y2="23"/>
          </svg>
          Agente IA — agendar por voz
        </div>
        <div class="ia-voz-estado" id="ia-voz-estado">
          Di algo como: <em>"Cita para Juan Pérez el viernes a las 10 de la mañana"</em>
        </div>
        <div class="ia-voz-controles">
          <button class="ia-mic-btn" id="ia-mic-btn" title="Clic para hablar">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            </svg>
          </button>
          <span class="ia-mic-hint" id="ia-mic-hint">Presiona para hablar</span>
        </div>
        <div class="ia-voz-transcript" id="ia-voz-transcript" style="display:none"></div>
        <div class="ia-voz-resultado"  id="ia-voz-resultado"  style="display:none"></div>
        <div class="ia-voz-acciones"   id="ia-voz-acciones"   style="display:none">
          <button class="btn btn-primary btn-sm" id="ia-btn-confirmar">✓ Confirmar cita</button>
          <button class="btn btn-gray btn-sm"     id="ia-btn-descartar">✕ Descartar</button>
        </div>
      </div>

    </div>`;

  document.getElementById('btn-completar-foco')
    ?.addEventListener('click', async (e) => {
      await onCompletar(e.currentTarget.dataset.id);
      await renderDashboardPaneles(onCompletar, onVozCita);
    });

  const listaCont = document.getElementById('dash-proximas-lista');
  if (listaCont && foco) {
    const resto = activas
      .filter(c => c.id !== foco.id && clasificarCita(c.hora) === 'proxima')
      .slice(0, 3);
    listaCont.innerHTML = resto.map(c => `
      <div class="dash-proxima-item">
        <span class="dash-proxima-hora">${c.hora}</span>
        <span class="dash-proxima-nombre">${c.clienteNombre}</span>
        <span class="dash-proxima-tipo">${c.tipo}</span>
      </div>`).join('');
  }

  initAgenteVoz(onVozCita);
}

// ── Agente de voz (Gemini 3.1 Flash Lite) ─────────────────────
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
    micBtn.disabled      = true;
    micBtn.style.opacity = '0.4';
    return;
  }

  const rec = new SR();
  rec.lang            = 'es-CO';
  rec.interimResults  = true;
  rec.maxAlternatives = 1;
  rec.continuous      = false;

  let grabando     = false;
  let citaExtraida = null;

  micBtn.addEventListener('click', () => {
    if (grabando) {
      grabando = false;
      micBtn.classList.remove('grabando');
      micHint.textContent = 'Procesando...';
      rec.stop();
      return;
    }

    grabando      = true;
    citaExtraida  = null;
    micBtn.classList.add('grabando');
    micHint.textContent      = 'Escuchando… (clic para detener)';
    estadoEl.innerHTML       = '🎙️ Te estoy escuchando...';
    transcEl.textContent     = '';
    transcEl.style.display   = 'none';
    resultEl.style.display   = 'none';
    accionesEl.style.display = 'none';

    try { rec.start(); } catch { rec.stop(); setTimeout(() => rec.start(), 300); }
  });

  rec.onresult = (e) => {
    const texto = Array.from(e.results).map(r => r[0].transcript).join('');
    transcEl.textContent   = `"${texto}"`;
    transcEl.style.display = 'block';
  };

  rec.onend = async () => {
    micHint.textContent = 'Presiona para hablar';

    const textoFinal = (transcEl.textContent || '').replace(/^"|"$/g, '').trim();
    if (!textoFinal) {
      estadoEl.innerHTML = 'No detecté audio. Intenta hablar más cerca del micrófono.';
      return;
    }

    estadoEl.innerHTML = '⏳ Analizando cita con Gemini 3.1...';
    micBtn.disabled    = true;

    const hoy = new Date().toISOString().split('T')[0];

    try {
      const res = await fetch('/api/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // 1. Instrucciones de Sistema Nativas
          systemInstruction: {
            parts: [{
              text: `Eres el asistente de recepción de un consultorio quiropráctico en Colombia.
              Extrae datos de citas del texto dictado. Hoy es ${hoy}.
              Calcula fechas relativas ("mañana", "el próximo lunes").
              Convierte horas a formato 24h ("3 de la tarde" -> "15:00").
              
              Formato de salida esperado:
              {
                "clienteNombre": string o null,
                "fecha": "YYYY-MM-DD" o null,
                "hora": "HH:MM" o null,
                "tipo": string (defecto: "Ajuste general"),
                "notas": string (observaciones adicionales)
              }`
            }]
          },
          contents: [{
            role: 'user',
            parts: [{ text: `DICTADO POR VOZ: "${textoFinal}"` }]
          }],
          generationConfig: {
            maxOutputTokens: 400,
            temperature: 0.1,
            // 2. Forzar respuesta JSON nativa
            responseMimeType: "application/json"
          }
        })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error?.message || `HTTP ${res.status}`);
      }

      const data = await res.json();
      
      // 3. Obtenemos el texto y parseamos (ya viene como JSON limpio)
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      citaExtraida = JSON.parse(rawText);

      // Renderizado de resultados en UI
      resultEl.style.display = 'block';
      resultEl.innerHTML = `
        <div class="ia-resultado-item">
          <span class="ia-resultado-label">Paciente</span>
          <span class="ia-resultado-val">${citaExtraida.clienteNombre || '<span style="color:#e67e22">No detectado</span>'}</span>
        </div>
        <div class="ia-resultado-item">
          <span class="ia-resultado-label">Fecha</span>
          <span class="ia-resultado-val">${citaExtraida.fecha || '<span style="color:#e67e22">No detectada</span>'}</span>
        </div>
        <div class="ia-resultado-item">
          <span class="ia-resultado-label">Hora</span>
          <span class="ia-resultado-val">${citaExtraida.hora || '<span style="color:#e67e22">No detectada</span>'}</span>
        </div>
        <div class="ia-resultado-item">
          <span class="ia-resultado-label">Tipo</span>
          <span class="ia-resultado-val">${citaExtraida.tipo || 'Ajuste general'}</span>
        </div>
        ${citaExtraida.notas ? `
        <div class="ia-resultado-item">
          <span class="ia-resultado-label">Notas</span>
          <span class="ia-resultado-val">${citaExtraida.notas}</span>
        </div>` : ''}`;

      estadoEl.innerHTML       = '✅ Datos extraídos correctamente:';
      accionesEl.style.display = 'flex';

    } catch (err) {
      console.error('Error agente IA voz:', err);
      estadoEl.innerHTML = `❌ Error: ${err.message}`;
    }

    micBtn.disabled = false;
  };

  rec.onerror = (e) => {
    grabando = false;
    micBtn.classList.remove('grabando');
    micBtn.disabled     = false;
    micHint.textContent = 'Presiona para hablar';
    estadoEl.textContent = `Error de audio: ${e.error}`;
  };

  document.getElementById('ia-btn-confirmar')?.addEventListener('click', () => {
    if (!citaExtraida) return;
    onVozCita(citaExtraida);
    resetPanel();
  });
  
  document.getElementById('ia-btn-descartar')?.addEventListener('click', resetPanel);

  function resetPanel() {
    resultEl.style.display   = 'none';
    transcEl.style.display   = 'none';
    accionesEl.style.display = 'none';
    estadoEl.innerHTML = 'Di algo como: <em>"Cita para Juan Pérez el viernes a las 10"</em>';
    citaExtraida = null;
  }
}