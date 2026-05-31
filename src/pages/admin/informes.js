// src/pages/admin/informes.js
// Módulo de informes — punto de entrada

import { protegerPagina }    from '../../core/router.js';
import { logout }            from '../../core/authService.js';
import { HOY, iniciales }    from '../../shared/helpers.js';
import {
  obtenerCitasPorRango, obtenerPagosPorRango,
  obtenerPacientesNuevosEnRango, obtenerTodosPacientes,
  agruparPorDia, agruparPorMes, agruparPorCampo,
  calcularResumenCitas, calcularResumenFinanciero,
  formatCOP, fechaLegible, mesLegible,
  primerDiaMes, ultimoDiaMes
} from '../../modules/informes/informesService.js';
import { obtenerCitasPorFecha, ESTADOS } from '../../modules/citas/citasService.js';
import { obtenerPagosHoy, calcularTotalesDia } from '../../modules/finanzas/pagosService.js';

// ── Estado ────────────────────────────────────────────────
let usuarioActual = null;
const MES_ACTUAL  = HOY.slice(0, 7);

// ── Init ──────────────────────────────────────────────────
(async () => {
  usuarioActual = await protegerPagina('Administrador');
  renderPerfil(usuarioActual);
  bindLogout();
  bindNavegacion();
  activarSeccion('sec-diario');
  cargarSeccionDiario();
})();

// ── Perfil ────────────────────────────────────────────────
function renderPerfil(u) {
  const p = (u.nombre || 'A').trim().split(' ');
  const av = (p[0][0] + (p[1] ? p[1][0] : '')).toUpperCase();
  document.getElementById('inf-avatar').textContent  = av;
  document.getElementById('inf-nombre').textContent  = u.nombre || u.email;
  document.getElementById('inf-rol').textContent     = u.rol || '—';
}

// ── Logout ────────────────────────────────────────────────
function bindLogout() {
  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await logout(); window.location.href = '/index.html';
  });
}

// ── Navegación lateral ────────────────────────────────────
function bindNavegacion() {
  document.querySelectorAll('.inf-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activarSeccion(btn.dataset.sec);
      document.querySelectorAll('.inf-nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

function activarSeccion(id) {
  document.querySelectorAll('.inf-seccion').forEach(s => s.style.display = 'none');
  const el = document.getElementById(id);
  if (el) el.style.display = 'block';
  // Cargar datos según sección
  const loaders = {
    'sec-diario':     cargarSeccionDiario,
    'sec-finanzas':   cargarSeccionFinanzas,
    'sec-citas':      cargarSeccionCitas,
    'sec-pacientes':  cargarSeccionPacientes,
    'sec-cronograma': cargarSeccionCronograma,
    'sec-mensual':    cargarSeccionMensual,
  };
  loaders[id]?.();
}

// ══════════════════════════════════════════════════════════
// 1. RESUMEN DIARIO
// ══════════════════════════════════════════════════════════
async function cargarSeccionDiario() {
  const fechaInput = document.getElementById('d-fecha');
  if (!fechaInput.value) fechaInput.value = HOY;

  document.getElementById('btn-cargar-diario')?.addEventListener('click', () => {
    generarDiario(fechaInput.value);
  });

  await generarDiario(fechaInput.value);
}

async function generarDiario(fecha) {
  setLoading('d-resultado', 'Cargando resumen...');
  const [citas, pagos] = await Promise.all([
    obtenerCitasPorFecha(fecha),
    obtenerPagosHoy(fecha),
  ]);

  const res  = calcularResumenCitas(citas);
  const finz = calcularTotalesDia(pagos);
  const fechaFmt = fechaLegible(fecha, { weekday: 'long' });

  document.getElementById('d-resultado').innerHTML = `
    <div class="inf-titulo-reporte">
      Resumen del día — ${fechaFmt}
    </div>

    <div class="inf-kpi-row">
      ${kpiBox('Atendidos', res.completadas, 'green')}
      ${kpiBox('Cancelados', res.canceladas, 'red')}
      ${kpiBox('Reprogramados', res.reprogramadas, 'yellow')}
      ${kpiBox('Pendientes', res.activas, 'blue')}
    </div>
    <div class="inf-kpi-row" style="margin-top:12px">
      ${kpiBox('Ingresos del día', formatCOP(finz.total), 'green', true)}
      ${kpiBox('Sesiones cobradas', finz.cantidad, 'blue')}
      ${kpiBox('Adicionales', formatCOP(finz.soloMeds), 'purple', true)}
      ${kpiBox('Tasa de atención', res.tasaAtencion + '%', res.tasaAtencion >= 70 ? 'green' : 'yellow')}
    </div>

    ${tablaResumenCitas(citas, 'Detalle de citas del día')}
    ${pagos.length ? tablaResumenPagos(pagos, 'Cobros del día') : ''}

    ${btnImprimir('diario', { citas, pagos, fecha: fechaFmt, res, finz })}
  `;

  document.getElementById('btn-print-diario')?.addEventListener('click', () =>
    imprimirInforme('diario', { citas, pagos, fecha: fechaFmt, res, finz })
  );
}

// ══════════════════════════════════════════════════════════
// 2. INFORME DE FINANZAS
// ══════════════════════════════════════════════════════════
async function cargarSeccionFinanzas() {
  const desdeEl = document.getElementById('f-desde');
  const hastaEl = document.getElementById('f-hasta');
  if (!desdeEl.value) desdeEl.value = primerDiaMes(MES_ACTUAL);
  if (!hastaEl.value) hastaEl.value = HOY;

  document.getElementById('btn-cargar-finanzas')?.addEventListener('click', () =>
    generarFinanzas(desdeEl.value, hastaEl.value)
  );

  await generarFinanzas(desdeEl.value, hastaEl.value);
}

async function generarFinanzas(desde, hasta) {
  setLoading('f-resultado', 'Cargando datos financieros...');
  const pagos = await obtenerPagosPorRango(desde, hasta);
  const res   = calcularResumenFinanciero(pagos);
  const porDia = agruparPorDia(pagos);

  document.getElementById('f-resultado').innerHTML = `
    <div class="inf-titulo-reporte">
      Informe Financiero — ${fechaLegible(desde)} al ${fechaLegible(hasta)}
    </div>

    <div class="inf-kpi-row">
      ${kpiBox('Total ingresos', formatCOP(res.total), 'green', true)}
      ${kpiBox('Sesiones cobradas', res.cantidad, 'blue')}
      ${kpiBox('Promedio/día', formatCOP(res.promedioDia), 'purple', true)}
      ${kpiBox('Promedio/sesión', formatCOP(res.promedioSesion), 'yellow', true)}
    </div>
    <div class="inf-kpi-row" style="margin-top:12px">
      ${kpiBox('Solo sesiones', formatCOP(res.soloSesiones), 'green', true)}
      ${kpiBox('Adicionales', formatCOP(res.soloMeds), 'blue', true)}
      ${kpiBox('Días con ingresos', res.diasUnicos, 'yellow')}
      ${kpiBox('Top sesión', res.topTipos[0]?.tipo || '—', 'purple')}
    </div>

    <div class="inf-grid-2" style="margin-top:20px">
      <!-- Ingresos por día -->
      <div class="inf-card">
        <div class="inf-card-title">Ingresos por día</div>
        ${Object.entries(porDia).map(([dia, ps]) => {
          const tot = ps.reduce((s, p) => s + (p.totalCobrado || 0), 0);
          const pct = res.total > 0 ? Math.round((tot / res.total) * 100) : 0;
          return `
            <div class="inf-bar-row">
              <span class="inf-bar-label">${fechaLegible(dia, { day:'numeric', month:'short' })}</span>
              <div class="inf-bar-track">
                <div class="inf-bar-fill inf-bar-green" style="width:${pct}%"></div>
              </div>
              <span class="inf-bar-value">${formatCOP(tot)}</span>
            </div>`;
        }).join('')}
      </div>

      <!-- Top tipos de sesión -->
      <div class="inf-card">
        <div class="inf-card-title">Ingresos por tipo de sesión</div>
        ${res.topTipos.map(t => {
          const pct = res.total > 0 ? Math.round((t.total / res.total) * 100) : 0;
          return `
            <div class="inf-bar-row">
              <span class="inf-bar-label">${t.tipo}</span>
              <div class="inf-bar-track">
                <div class="inf-bar-fill inf-bar-blue" style="width:${pct}%"></div>
              </div>
              <span class="inf-bar-value">${formatCOP(t.total)} (${t.cantidad})</span>
            </div>`;
        }).join('')}
      </div>
    </div>

    ${tablaResumenPagos(pagos, 'Detalle de cobros')}
    ${btnImprimir('finanzas', { pagos, res, desde, hasta })}
  `;

  document.getElementById('btn-print-finanzas')?.addEventListener('click', () =>
    imprimirInforme('finanzas', { pagos, res, desde, hasta })
  );
}

// ══════════════════════════════════════════════════════════
// 3. INFORME DE CITAS
// ══════════════════════════════════════════════════════════
async function cargarSeccionCitas() {
  const desdeEl = document.getElementById('c-desde');
  const hastaEl = document.getElementById('c-hasta');
  if (!desdeEl.value) desdeEl.value = primerDiaMes(MES_ACTUAL);
  if (!hastaEl.value) hastaEl.value = HOY;

  document.getElementById('btn-cargar-citas')?.addEventListener('click', () =>
    generarCitas(desdeEl.value, hastaEl.value)
  );
  await generarCitas(desdeEl.value, hastaEl.value);
}

async function generarCitas(desde, hasta) {
  setLoading('c-resultado', 'Cargando citas...');
  const citas = await obtenerCitasPorRango(desde, hasta);
  const res   = calcularResumenCitas(citas);
  const porEstado = agruparPorCampo(citas, 'estado');
  const porTipo   = agruparPorCampo(citas, 'tipo');
  const porCiudad = agruparPorCampo(citas, 'clienteCiudad');
  const porDia    = agruparPorDia(citas);

  document.getElementById('c-resultado').innerHTML = `
    <div class="inf-titulo-reporte">
      Informe de Citas — ${fechaLegible(desde)} al ${fechaLegible(hasta)}
    </div>

    <div class="inf-kpi-row">
      ${kpiBox('Total citas', res.total, 'blue')}
      ${kpiBox('Completadas', res.completadas, 'green')}
      ${kpiBox('Canceladas', res.canceladas, 'red')}
      ${kpiBox('Tasa atención', res.tasaAtencion + '%', res.tasaAtencion >= 70 ? 'green' : 'yellow')}
    </div>

    <div class="inf-grid-2" style="margin-top:20px">
      <!-- Por tipo de sesión -->
      <div class="inf-card">
        <div class="inf-card-title">Por tipo de sesión</div>
        ${Object.entries(porTipo)
          .sort((a,b) => b[1].length - a[1].length)
          .map(([tipo, cs]) => `
            <div class="inf-bar-row">
              <span class="inf-bar-label">${tipo}</span>
              <div class="inf-bar-track">
                <div class="inf-bar-fill inf-bar-blue" style="width:${res.total > 0 ? Math.round((cs.length/res.total)*100) : 0}%"></div>
              </div>
              <span class="inf-bar-value">${cs.length}</span>
            </div>`).join('')}
      </div>

      <!-- Por ciudad -->
      <div class="inf-card">
        <div class="inf-card-title">Por ciudad de origen</div>
        ${Object.entries(porCiudad)
          .sort((a,b) => b[1].length - a[1].length)
          .slice(0, 8)
          .map(([ciudad, cs]) => `
            <div class="inf-bar-row">
              <span class="inf-bar-label">${ciudad || 'Sin ciudad'}</span>
              <div class="inf-bar-track">
                <div class="inf-bar-fill inf-bar-purple" style="width:${res.total > 0 ? Math.round((cs.length/res.total)*100) : 0}%"></div>
              </div>
              <span class="inf-bar-value">${cs.length}</span>
            </div>`).join('')}
      </div>
    </div>

    <!-- Citas canceladas detalle -->
    ${(porEstado['cancelada'] || []).length > 0 ? `
      <div class="inf-card" style="margin-top:16px;border-left:4px solid #e74c3c">
        <div class="inf-card-title" style="color:#c0392b">Citas canceladas (${(porEstado['cancelada']||[]).length})</div>
        ${tablaResumenCitas(porEstado['cancelada'] || [], '')}
      </div>` : ''}

    ${btnImprimir('citas', { citas, res, desde, hasta, porTipo, porCiudad })}
  `;

  document.getElementById('btn-print-citas')?.addEventListener('click', () =>
    imprimirInforme('citas', { citas, res, desde, hasta })
  );
}

// ══════════════════════════════════════════════════════════
// 4. INFORME DE PACIENTES
// ══════════════════════════════════════════════════════════
async function cargarSeccionPacientes() {
  const desdeEl = document.getElementById('p-desde');
  const hastaEl = document.getElementById('p-hasta');
  if (!desdeEl.value) desdeEl.value = primerDiaMes(MES_ACTUAL);
  if (!hastaEl.value) hastaEl.value = HOY;

  document.getElementById('btn-cargar-pacientes')?.addEventListener('click', () =>
    generarPacientes(desdeEl.value, hastaEl.value)
  );
  await generarPacientes(desdeEl.value, hastaEl.value);
}

async function generarPacientes(desde, hasta) {
  setLoading('p-resultado', 'Cargando pacientes...');
  const [todos, nuevos, citas] = await Promise.all([
    obtenerTodosPacientes(),
    obtenerPacientesNuevosEnRango(desde, hasta),
    obtenerCitasPorRango(desde, hasta),
  ]);

  const porCiudad = agruparPorCampo(todos, 'ciudad');

  // Pacientes más atendidos en el rango
  const atenciones = {};
  citas.filter(c => c.estado === ESTADOS.COMPLETADA).forEach(c => {
    atenciones[c.clienteNombre] = (atenciones[c.clienteNombre] || 0) + 1;
  });
  const topPacientes = Object.entries(atenciones)
    .sort((a,b) => b[1] - a[1]).slice(0, 10);

  document.getElementById('p-resultado').innerHTML = `
    <div class="inf-titulo-reporte">
      Informe de Pacientes — ${fechaLegible(desde)} al ${fechaLegible(hasta)}
    </div>

    <div class="inf-kpi-row">
      ${kpiBox('Total pacientes', todos.length, 'blue')}
      ${kpiBox('Nuevos en período', nuevos.length, 'green')}
      ${kpiBox('Ciudades', Object.keys(porCiudad).length, 'purple')}
      ${kpiBox('Sesiones completadas', citas.filter(c=>c.estado===ESTADOS.COMPLETADA).length, 'yellow')}
    </div>

    <div class="inf-grid-2" style="margin-top:20px">
      <!-- Pacientes más atendidos -->
      <div class="inf-card">
        <div class="inf-card-title">Pacientes más atendidos (top 10)</div>
        ${topPacientes.length === 0
          ? '<div class="inf-empty">Sin sesiones completadas en este período</div>'
          : topPacientes.map(([nombre, cnt], i) => `
            <div class="inf-bar-row">
              <span class="inf-bar-label">${i+1}. ${nombre}</span>
              <div class="inf-bar-track">
                <div class="inf-bar-fill inf-bar-green" style="width:${Math.round((cnt/(topPacientes[0][1]))*100)}%"></div>
              </div>
              <span class="inf-bar-value">${cnt} sesión${cnt>1?'es':''}</span>
            </div>`).join('')}
      </div>

      <!-- Por ciudad -->
      <div class="inf-card">
        <div class="inf-card-title">Pacientes por ciudad (top 10)</div>
        ${Object.entries(porCiudad)
          .sort((a,b) => b[1].length - a[1].length)
          .slice(0, 10)
          .map(([ciudad, ps]) => `
            <div class="inf-bar-row">
              <span class="inf-bar-label">${ciudad || 'Sin ciudad'}</span>
              <div class="inf-bar-track">
                <div class="inf-bar-fill inf-bar-blue" style="width:${Math.round((ps.length/todos.length)*100)}%"></div>
              </div>
              <span class="inf-bar-value">${ps.length}</span>
            </div>`).join('')}
      </div>
    </div>

    <!-- Pacientes nuevos en el período -->
    ${nuevos.length > 0 ? `
      <div class="inf-card" style="margin-top:16px">
        <div class="inf-card-title">Pacientes nuevos registrados en el período (${nuevos.length})</div>
        <table class="inf-tabla">
          <thead><tr><th>Nombre</th><th>Teléfono</th><th>Ciudad</th><th>Fecha registro</th></tr></thead>
          <tbody>
            ${nuevos.map(p => `
              <tr>
                <td>${p.nombre}</td>
                <td>${p.telefono || '—'}</td>
                <td>${p.ciudad || '—'}</td>
                <td>${p.fechaRegistro?.toDate ? fechaLegible(p.fechaRegistro.toDate().toISOString().split('T')[0]) : '—'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : ''}

    ${btnImprimir('pacientes', { todos, nuevos, topPacientes, porCiudad, desde, hasta })}
  `;

  document.getElementById('btn-print-pacientes')?.addEventListener('click', () =>
    imprimirInforme('pacientes', { todos, nuevos, topPacientes, porCiudad, desde, hasta })
  );
}

// ══════════════════════════════════════════════════════════
// 5. CRONOGRAMA IMPRIMIBLE
// ══════════════════════════════════════════════════════════
async function cargarSeccionCronograma() {
  const fechaEl = document.getElementById('cr-fecha');
  if (!fechaEl.value) fechaEl.value = HOY;

  document.getElementById('btn-cargar-crono')?.addEventListener('click', () =>
    generarCronograma(fechaEl.value)
  );
  await generarCronograma(fechaEl.value);
}

async function generarCronograma(fecha) {
  setLoading('cr-resultado', 'Cargando cronograma...');
  const citas = await obtenerCitasPorFecha(fecha);
  const fechaFmt = fechaLegible(fecha, { weekday: 'long' });

  document.getElementById('cr-resultado').innerHTML = `
    <div class="inf-titulo-reporte">Cronograma — ${fechaFmt}</div>

    <div class="inf-kpi-row">
      ${kpiBox('Total citas', citas.length, 'blue')}
      ${kpiBox('Completadas', citas.filter(c=>c.estado===ESTADOS.COMPLETADA).length, 'green')}
      ${kpiBox('Activas', citas.filter(c=>c.estado===ESTADOS.ACTIVA).length, 'yellow')}
      ${kpiBox('Canceladas', citas.filter(c=>c.estado===ESTADOS.CANCELADA).length, 'red')}
    </div>

    <div class="inf-card" style="margin-top:16px">
      <table class="inf-tabla">
        <thead>
          <tr>
            <th>Hora</th>
            <th>Paciente</th>
            <th>Ciudad</th>
            <th>Tipo sesión</th>
            <th>Estado</th>
            <th>Notas</th>
          </tr>
        </thead>
        <tbody>
          ${citas.length === 0
            ? '<tr><td colspan="6" class="inf-empty">Sin citas para este día</td></tr>'
            : citas.map(c => `
              <tr>
                <td><strong>${c.hora}</strong></td>
                <td>${c.clienteNombre}</td>
                <td>${c.clienteCiudad || '—'}</td>
                <td>${c.tipo}</td>
                <td>${badgeEstado(c.estado)}</td>
                <td style="font-size:12px;color:#888">${c.notas || '—'}</td>
              </tr>`).join('')}
        </tbody>
      </table>
    </div>

    ${btnImprimir('crono', { citas, fecha: fechaFmt })}
  `;

  document.getElementById('btn-print-crono')?.addEventListener('click', () =>
    imprimirInforme('crono', { citas, fecha: fechaFmt })
  );
}

// ══════════════════════════════════════════════════════════
// 6. CIERRE MENSUAL
// ══════════════════════════════════════════════════════════
async function cargarSeccionMensual() {
  const mesEl = document.getElementById('m-mes');
  if (!mesEl.value) mesEl.value = MES_ACTUAL;

  document.getElementById('btn-cargar-mensual')?.addEventListener('click', () =>
    generarMensual(mesEl.value)
  );
  await generarMensual(mesEl.value);
}

async function generarMensual(mes) {
  setLoading('m-resultado', 'Cargando cierre mensual...');
  const desde = primerDiaMes(mes);
  const hasta = ultimoDiaMes(mes);
  const mesNom = mesLegible(mes);

  const [citas, pagos, nuevos] = await Promise.all([
    obtenerCitasPorRango(desde, hasta),
    obtenerPagosPorRango(desde, hasta),
    obtenerPacientesNuevosEnRango(desde, hasta),
  ]);

  const resCitas = calcularResumenCitas(citas);
  const resFinz  = calcularResumenFinanciero(pagos);
  const porSemana = agruparPorSemana(pagos);

  document.getElementById('m-resultado').innerHTML = `
    <div class="inf-titulo-reporte">Cierre Mensual — ${mesNom}</div>

    <div class="inf-kpi-row">
      ${kpiBox('Ingresos totales', formatCOP(resFinz.total), 'green', true)}
      ${kpiBox('Sesiones atendidas', resCitas.completadas, 'blue')}
      ${kpiBox('Nuevos pacientes', nuevos.length, 'purple')}
      ${kpiBox('Tasa de atención', resCitas.tasaAtencion + '%', resCitas.tasaAtencion >= 70 ? 'green' : 'yellow')}
    </div>
    <div class="inf-kpi-row" style="margin-top:12px">
      ${kpiBox('Promedio/día', formatCOP(resFinz.promedioDia), 'green', true)}
      ${kpiBox('Promedio/sesión', formatCOP(resFinz.promedioSesion), 'blue', true)}
      ${kpiBox('Cancelaciones', resCitas.canceladas, 'red')}
      ${kpiBox('Adicionales', formatCOP(resFinz.soloMeds), 'yellow', true)}
    </div>

    <!-- Ingresos por semana -->
    <div class="inf-card" style="margin-top:20px">
      <div class="inf-card-title">Ingresos por semana</div>
      ${Object.entries(porSemana).map(([sem, ps]) => {
        const tot = ps.reduce((s, p) => s + (p.totalCobrado || 0), 0);
        const pct = resFinz.total > 0 ? Math.round((tot / resFinz.total) * 100) : 0;
        return `
          <div class="inf-bar-row">
            <span class="inf-bar-label">${sem}</span>
            <div class="inf-bar-track">
              <div class="inf-bar-fill inf-bar-green" style="width:${pct}%"></div>
            </div>
            <span class="inf-bar-value">${formatCOP(tot)} · ${ps.length} sesiones</span>
          </div>`;
      }).join('')}
    </div>

    <div class="inf-grid-2" style="margin-top:16px">
      <!-- Top tipos -->
      <div class="inf-card">
        <div class="inf-card-title">Top tipos de sesión</div>
        ${resFinz.topTipos.map(t => `
          <div class="inf-bar-row">
            <span class="inf-bar-label">${t.tipo}</span>
            <div class="inf-bar-track">
              <div class="inf-bar-fill inf-bar-blue" style="width:${resFinz.total>0?Math.round((t.total/resFinz.total)*100):0}%"></div>
            </div>
            <span class="inf-bar-value">${formatCOP(t.total)}</span>
          </div>`).join('')}
      </div>

      <!-- Pacientes nuevos -->
      <div class="inf-card">
        <div class="inf-card-title">Nuevos pacientes (${nuevos.length})</div>
        ${nuevos.length === 0
          ? '<div class="inf-empty">Sin nuevos registros este mes</div>'
          : nuevos.slice(0, 8).map(p => `
              <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">
                <div style="width:28px;height:28px;border-radius:50%;background:var(--color-blue-light);
                     display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:var(--color-blue)">
                  ${iniciales(p.nombre)}
                </div>
                <div>
                  <div style="font-size:13px;font-weight:500">${p.nombre}</div>
                  <div style="font-size:11px;color:var(--text-muted)">${p.ciudad || '—'}</div>
                </div>
              </div>`).join('')}
      </div>
    </div>

    ${btnImprimir('mensual', { citas, pagos, resCitas, resFinz, nuevos, mes: mesNom })}
  `;

  document.getElementById('btn-print-mensual')?.addEventListener('click', () =>
    imprimirInforme('mensual', { citas, pagos, resCitas, resFinz, nuevos, mes: mesNom })
  );
}

function agruparPorSemana(pagos) {
  return pagos.reduce((acc, p) => {
    const d   = new Date(p.fecha + 'T12:00:00');
    const sem = `Semana ${Math.ceil(d.getDate() / 7)}`;
    if (!acc[sem]) acc[sem] = [];
    acc[sem].push(p);
    return acc;
  }, {});
}

// ══════════════════════════════════════════════════════════
// COMPONENTES HTML REUTILIZABLES
// ══════════════════════════════════════════════════════════
function kpiBox(label, valor, color, isMoney = false) {
  return `
    <div class="inf-kpi inf-kpi-${color}">
      <div class="inf-kpi-valor">${valor}</div>
      <div class="inf-kpi-label">${label}</div>
    </div>`;
}

function tablaResumenCitas(citas, titulo) {
  if (!citas.length) return '';
  return `
    <div class="inf-card" style="margin-top:16px">
      ${titulo ? `<div class="inf-card-title">${titulo}</div>` : ''}
      <table class="inf-tabla">
        <thead>
          <tr><th>Fecha</th><th>Hora</th><th>Paciente</th><th>Ciudad</th><th>Tipo</th><th>Estado</th></tr>
        </thead>
        <tbody>
          ${citas.map(c => `
            <tr>
              <td>${fechaLegible(c.fecha, { day:'numeric', month:'short' })}</td>
              <td><strong>${c.hora}</strong></td>
              <td>${c.clienteNombre}</td>
              <td>${c.clienteCiudad || '—'}</td>
              <td>${c.tipo}</td>
              <td>${badgeEstado(c.estado)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function tablaResumenPagos(pagos, titulo) {
  if (!pagos.length) return '';
  const total = pagos.reduce((s, p) => s + (p.totalCobrado || 0), 0);
  return `
    <div class="inf-card" style="margin-top:16px">
      ${titulo ? `<div class="inf-card-title">${titulo}</div>` : ''}
      <table class="inf-tabla">
        <thead>
          <tr><th>Fecha</th><th>Hora</th><th>Paciente</th><th>Sesión</th><th>Tarifa</th><th>Adicionales</th><th>Total</th></tr>
        </thead>
        <tbody>
          ${pagos.map(p => `
            <tr>
              <td>${fechaLegible(p.fecha, { day:'numeric', month:'short' })}</td>
              <td>${p.hora}</td>
              <td>${p.clienteNombre}</td>
              <td>${p.tipoSesion}</td>
              <td>${formatCOP(p.tarifaBase)}</td>
              <td>${p.totalMedicamentos > 0 ? formatCOP(p.totalMedicamentos) : '—'}</td>
              <td><strong>${formatCOP(p.totalCobrado)}</strong></td>
            </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr style="font-weight:700">
            <td colspan="6">TOTAL</td>
            <td>${formatCOP(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>`;
}

function badgeEstado(estado) {
  const map = {
    activa:       '<span class="badge badge-warning">Activa</span>',
    completada:   '<span class="badge badge-success">Completada</span>',
    cancelada:    '<span class="badge badge-danger">Cancelada</span>',
    reprogramada: '<span class="badge badge-primary">Reprogramada</span>',
  };
  return map[estado] ?? estado;
}

function btnImprimir(id, datos) {
  return `
    <div style="display:flex;justify-content:flex-end;margin-top:16px">
      <button class="btn btn-soft" id="btn-print-${id}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          style="vertical-align:-2px;margin-right:6px">
          <polyline points="6 9 6 2 18 2 18 9"/>
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
          <rect x="6" y="14" width="12" height="8"/>
        </svg>
        Imprimir / PDF
      </button>
    </div>`;
}

// ══════════════════════════════════════════════════════════
// IMPRESIÓN EMPRESARIAL
// ══════════════════════════════════════════════════════════
function imprimirInforme(tipo, datos) {
  const ahora   = new Date();
  const horaImp = ahora.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  const usuNom  = usuarioActual?.nombre || 'Administrador';

  const encabezado = `
    <div style="display:flex;justify-content:space-between;border-bottom:3px solid #0A76D8;padding-bottom:14px;margin-bottom:20px">
      <div>
        <div style="font-size:20px;font-weight:700;color:#0A76D8">Quiromasajes E.F</div>
        <div style="font-size:11px;color:#555">Santa Rosa de Viterbo, Boyacá — Colombia</div>
        <div style="font-size:11px;color:#555">Clínica quiropráctica</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:13px;font-weight:600">${tituloInforme(tipo, datos)}</div>
        <div style="font-size:11px;color:#555;margin-top:3px">Impreso: ${horaImp} · por ${usuNom}</div>
      </div>
    </div>`;

  const cuerpo = cuerpoInforme(tipo, datos);
  const pie    = `
    <div style="border-top:1px solid #ddd;padding-top:10px;margin-top:20px;display:flex;justify-content:space-between;font-size:10px;color:#999">
      <span>Quiromasajes E.F · Santa Rosa de Viterbo, Boyacá</span>
      <span>Generado por ${usuNom}</span>
    </div>`;

  const div = document.getElementById('print-desprendible');
  if (!div) return;
  div.innerHTML = `<div style="font-family:Arial,sans-serif;padding:30px 36px;max-width:850px;margin:0 auto;color:#111">
    ${encabezado}${cuerpo}${pie}
  </div>`;

  window.print();
  window.addEventListener('afterprint', () => { div.innerHTML = ''; }, { once: true });
}

function tituloInforme(tipo, d) {
  const tit = {
    diario:    `Resumen Diario — ${d.fecha}`,
    finanzas:  `Informe Financiero — ${fechaLegible(d.desde)} al ${fechaLegible(d.hasta)}`,
    citas:     `Informe de Citas — ${fechaLegible(d.desde)} al ${fechaLegible(d.hasta)}`,
    pacientes: `Informe de Pacientes — ${fechaLegible(d.desde)} al ${fechaLegible(d.hasta)}`,
    crono:     `Cronograma — ${d.fecha}`,
    mensual:   `Cierre Mensual — ${d.mes}`,
  };
  return tit[tipo] || 'Informe';
}

function cuerpoInforme(tipo, d) {
  if (tipo === 'diario') {
    return `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px">
        ${miniKpi('Atendidos', d.res.completadas, '#1a7a47')}
        ${miniKpi('Cancelados', d.res.canceladas, '#e74c3c')}
        ${miniKpi('Ingresos', formatCOP(d.finz.total), '#0A76D8')}
        ${miniKpi('Tasa atención', d.res.tasaAtencion+'%', '#9b59b6')}
      </div>
      ${tablaPrint(d.citas, ['Hora','Paciente','Ciudad','Tipo','Estado'],
        c => [c.hora, c.clienteNombre, c.clienteCiudad||'—', c.tipo, c.estado])}
      ${d.pagos.length ? tablaPrint(d.pagos, ['Hora','Paciente','Tarifa','Adicionales','Total'],
        p => [p.hora, p.clienteNombre, formatCOP(p.tarifaBase), p.totalMedicamentos>0?formatCOP(p.totalMedicamentos):'—', formatCOP(p.totalCobrado)], formatCOP(d.finz.total)) : ''}`;
  }
  if (tipo === 'finanzas') {
    return `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px">
        ${miniKpi('Total ingresos', formatCOP(d.res.total), '#1a7a47')}
        ${miniKpi('Sesiones', d.res.cantidad, '#0A76D8')}
        ${miniKpi('Promedio/día', formatCOP(d.res.promedioDia), '#9b59b6')}
      </div>
      ${tablaPrint(d.pagos, ['Fecha','Hora','Paciente','Tipo sesión','Tarifa','Adicionales','Total'],
        p => [fechaLegible(p.fecha,{day:'numeric',month:'short'}), p.hora, p.clienteNombre, p.tipoSesion,
              formatCOP(p.tarifaBase), p.totalMedicamentos>0?formatCOP(p.totalMedicamentos):'—', formatCOP(p.totalCobrado)],
        formatCOP(d.res.total))}`;
  }
  if (tipo === 'citas') {
    return `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px">
        ${miniKpi('Total', d.res.total, '#0A76D8')}
        ${miniKpi('Completadas', d.res.completadas, '#1a7a47')}
        ${miniKpi('Canceladas', d.res.canceladas, '#e74c3c')}
        ${miniKpi('Tasa', d.res.tasaAtencion+'%', '#9b59b6')}
      </div>
      ${tablaPrint(d.citas, ['Fecha','Hora','Paciente','Ciudad','Tipo','Estado'],
        c => [fechaLegible(c.fecha,{day:'numeric',month:'short'}), c.hora, c.clienteNombre, c.clienteCiudad||'—', c.tipo, c.estado])}`;
  }
  if (tipo === 'pacientes') {
    return `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px">
        ${miniKpi('Total pacientes', d.todos.length, '#0A76D8')}
        ${miniKpi('Nuevos período', d.nuevos.length, '#1a7a47')}
        ${miniKpi('Ciudades', Object.keys(d.porCiudad).length, '#9b59b6')}
      </div>
      <div style="font-size:12px;font-weight:600;margin:12px 0 6px;color:#333">Nuevos pacientes registrados</div>
      ${tablaPrint(d.nuevos, ['Nombre','Teléfono','Ciudad'],
        p => [p.nombre, p.telefono||'—', p.ciudad||'—'])}`;
  }
  if (tipo === 'crono') {
    return tablaPrint(d.citas, ['Hora','Paciente','Ciudad','Tipo sesión','Estado','Notas'],
      c => [c.hora, c.clienteNombre, c.clienteCiudad||'—', c.tipo, c.estado, c.notas||'—']);
  }
  if (tipo === 'mensual') {
    return `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px">
        ${miniKpi('Ingresos mes', formatCOP(d.resFinz.total), '#1a7a47')}
        ${miniKpi('Sesiones', d.resCitas.completadas, '#0A76D8')}
        ${miniKpi('Nuevos pacientes', d.nuevos.length, '#9b59b6')}
        ${miniKpi('Tasa atención', d.resCitas.tasaAtencion+'%', d.resCitas.tasaAtencion>=70?'#1a7a47':'#e67e22')}
      </div>
      ${tablaPrint(d.pagos, ['Fecha','Paciente','Tipo','Tarifa','Adicionales','Total'],
        p => [fechaLegible(p.fecha,{day:'numeric',month:'short'}), p.clienteNombre, p.tipoSesion,
              formatCOP(p.tarifaBase), p.totalMedicamentos>0?formatCOP(p.totalMedicamentos):'—', formatCOP(p.totalCobrado)],
        formatCOP(d.resFinz.total))}`;
  }
  return '';
}

function tablaPrint(rows, headers, mapper, totalStr = null) {
  if (!rows?.length) return '<p style="font-size:12px;color:#888">Sin datos</p>';
  return `
    <table style="width:100%;border-collapse:collapse;font-size:11px">
      <thead>
        <tr style="background:#f5f7fa;border-bottom:2px solid #0A76D8">
          ${headers.map(h => `<th style="padding:6px 8px;text-align:left;font-weight:600">${h}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${rows.map((r, i) => `
          <tr style="border-bottom:1px solid #eee;background:${i%2===0?'#fff':'#fafbfc'}">
            ${mapper(r).map(v => `<td style="padding:5px 8px">${v}</td>`).join('')}
          </tr>`).join('')}
      </tbody>
      ${totalStr ? `<tfoot><tr style="font-weight:700;border-top:2px solid #0A76D8">
        <td colspan="${headers.length-1}" style="padding:6px 8px">TOTAL</td>
        <td style="padding:6px 8px">${totalStr}</td>
      </tr></tfoot>` : ''}
    </table>`;
}

function miniKpi(label, valor, color) {
  return `<div style="background:#f8f9fa;border-left:3px solid ${color};border-radius:4px;padding:10px 12px">
    <div style="font-size:16px;font-weight:700;color:${color}">${valor}</div>
    <div style="font-size:10px;color:#777;margin-top:2px;text-transform:uppercase">${label}</div>
  </div>`;
}

function setLoading(id, msg) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<div class="empty-state" style="padding:40px">${msg}</div>`;
}
