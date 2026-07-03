// src/modules/dashboard/semana.js
// Vista "Semana" — calendario del mes con ocupación de citas por color
// (paleta verde suave). Los domingos siempre se muestran en gris (no hay
// atención). Al seleccionar un día del mes, transiciona a la semana de
// ese día mostrando cupos disponibles; al seleccionar un día de la
// semana, se entrega la fecha para abrir el módulo de Citas.

import { obtenerCitasPorRangoFecha, ESTADOS, HORARIOS } from '../citas/citasService.js';
import { obtenerViajesEnRango } from '../viajes/viajesService.js';

// Paleta morada para indicar que el quiropráctico está de viaje en otra ciudad.
const COLOR_VIAJE = { bg: '#ede9fe', fg: '#6d28d9' };

function viajeDeFecha(viajes, fechaStr) {
  return viajes.find(v => v.fechaInicio <= fechaStr && v.fechaFin >= fechaStr) || null;
}

const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const COLOR_DOMINGO = { bg: '#e9ecef', fg: '#adb5bd' };

let _mesActual       = new Date();
let _onSeleccionarDia = null;

function pad(n) { return String(n).padStart(2, '0'); }
function fechaISO(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

// Paleta verde suave: más ocupación → verde más intenso.
function colorOcupacion(pct) {
  if (pct === 0) return { bg: '#f1f3f5', fg: '#868e96' };
  if (pct <= 25) return { bg: '#e3f6e8', fg: '#2f7a43' };
  if (pct <= 50) return { bg: '#bfe8cb', fg: '#236236' };
  if (pct <= 75) return { bg: '#8fd6a4', fg: '#1f4d2c' };
  if (pct <= 99) return { bg: '#57bd79', fg: '#143a1f' };
  return { bg: '#2e9e54', fg: '#ffffff' };
}

function calcularOcupacion(citasDelDia) {
  const ocupadas = citasDelDia.filter(c => c.estado !== ESTADOS.CANCELADA).length;
  const total    = HORARIOS.length;
  const libres   = Math.max(total - ocupadas, 0);
  const pct      = total > 0 ? Math.round((ocupadas / total) * 100) : 0;
  return { ocupadas, libres, total, pct };
}

// Badge de viaje — mismo ícono/color en la celda del mes (chico) y en la
// tarjeta de la semana (grande, legible).
function _viajeBadgeHtml(viaje, tamanoIcono = 12) {
  return `<span class="semana-viaje-badge">
    <svg width="${tamanoIcono}" height="${tamanoIcono}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
    </svg>${viaje.ciudad}</span>`;
}

// Barra de ocupación de la tarjeta semanal — reusa el color ya calculado
// por colorOcupacion() para el día, sin inventar una paleta nueva.
function _ocupacionBarHtml(pct, color) {
  return `<div class="semana-ocupacion-bar"><div class="semana-ocupacion-fill" style="width:${pct}%;background:${color.fg}"></div></div>`;
}

function obtenerDiasDeLaSemana(fechaStr) {
  const d   = new Date(fechaStr + 'T12:00:00');
  const dow = d.getDay(); // 0=domingo..6=sábado
  const diffLunes = dow === 0 ? -6 : 1 - dow;
  const lunes = new Date(d);
  lunes.setDate(d.getDate() + diffLunes);
  return Array.from({ length: 7 }, (_, i) => {
    const dia = new Date(lunes);
    dia.setDate(lunes.getDate() + i);
    return dia;
  });
}

// ── Punto de entrada ───────────────────────────────────────
export async function renderSemana(onSeleccionarDia) {
  _onSeleccionarDia = onSeleccionarDia;
  await renderMes(_mesActual);
}

// ── Vista mensual (calendario con color por ocupación) ─────
async function renderMes(fechaRef) {
  const cont = document.getElementById('semana-contenedor');
  if (!cont) return;

  const anio = fechaRef.getFullYear();
  const mes  = fechaRef.getMonth();
  const primerDia = new Date(anio, mes, 1);
  const ultimoDia = new Date(anio, mes + 1, 0);

  const [citas, viajes] = await Promise.all([
    obtenerCitasPorRangoFecha(fechaISO(primerDia), fechaISO(ultimoDia)),
    obtenerViajesEnRango(fechaISO(primerDia), fechaISO(ultimoDia)),
  ]);
  const porFecha = {};
  citas.forEach(c => { (porFecha[c.fecha] ||= []).push(c); });

  const dowPrimer  = (primerDia.getDay() + 6) % 7; // Lun=0..Dom=6
  const totalDias  = ultimoDia.getDate();

  let celdas = '';
  for (let i = 0; i < dowPrimer; i++) celdas += `<div class="semana-celda-vacia"></div>`;

  for (let dia = 1; dia <= totalDias; dia++) {
    const fechaObj  = new Date(anio, mes, dia);
    const fechaStr  = fechaISO(fechaObj);
    const esDomingo = fechaObj.getDay() === 0;
    const viaje     = viajeDeFecha(viajes, fechaStr);
    const { pct }   = calcularOcupacion(porFecha[fechaStr] || []);
    const color     = viaje ? COLOR_VIAJE : (esDomingo ? COLOR_DOMINGO : colorOcupacion(pct));
    const titulo    = viaje ? `Quiropráctico en ${viaje.ciudadFull}` : (esDomingo ? 'Cerrado' : pct + '% ocupado');

    celdas += `
      <div class="semana-dia-cell ${esDomingo && !viaje ? 'domingo' : ''}" data-fecha="${fechaStr}"
           style="background:${color.bg};color:${color.fg}" title="${titulo}">
        <span class="semana-dia-num">${dia}</span>
        ${viaje ? _viajeBadgeHtml(viaje, 9) : ''}
      </div>`;
  }

  cont.innerHTML = `
    <div class="semana-header">
      <button class="btn btn-gray btn-sm" id="semana-mes-prev">←</button>
      <div class="semana-mes-titulo">${MESES[mes]} ${anio}</div>
      <button class="btn btn-gray btn-sm" id="semana-mes-next">→</button>
    </div>
    <div class="semana-legend">
      <span class="semana-legend-item"><span class="semana-legend-dot" style="background:#f1f3f5;border:1px solid #ced4da"></span>Libre</span>
      <span class="semana-legend-item"><span class="semana-legend-dot" style="background:#57bd79"></span>Ocupado</span>
      <span class="semana-legend-item"><span class="semana-legend-dot" style="background:#2e9e54"></span>Lleno</span>
      <span class="semana-legend-item"><span class="semana-legend-dot" style="background:#adb5bd"></span>Domingo (cerrado)</span>
      <span class="semana-legend-item"><span class="semana-legend-dot" style="background:#6d28d9"></span>Viaje</span>
    </div>
    <div class="semana-grid-dias-header">
      ${DIAS_SEMANA.map(d => `<div>${d}</div>`).join('')}
    </div>
    <div class="semana-mes-grid">${celdas}</div>`;

  document.getElementById('semana-mes-prev')?.addEventListener('click', () => {
    _mesActual = new Date(anio, mes - 1, 1);
    renderMes(_mesActual);
  });
  document.getElementById('semana-mes-next')?.addEventListener('click', () => {
    _mesActual = new Date(anio, mes + 1, 1);
    renderMes(_mesActual);
  });

  cont.querySelectorAll('.semana-dia-cell:not(.domingo)').forEach(celda => {
    celda.addEventListener('click', () => transicionar(() => renderSemanaDeDias(celda.dataset.fecha)));
  });
}

// ── Transición limpia (fade) entre vistas ───────────────────
async function transicionar(renderFn) {
  const cont = document.getElementById('semana-contenedor');
  if (!cont) { await renderFn(); return; }
  cont.classList.add('semana-fade-out');
  await new Promise(r => setTimeout(r, 180));
  await renderFn();
  cont.classList.remove('semana-fade-out');
}

// ── Vista semanal (cupos disponibles por día) ───────────────
async function renderSemanaDeDias(fechaStr) {
  const cont = document.getElementById('semana-contenedor');
  if (!cont) return;

  const dias  = obtenerDiasDeLaSemana(fechaStr);
  const [citas, viajes] = await Promise.all([
    obtenerCitasPorRangoFecha(fechaISO(dias[0]), fechaISO(dias[6])),
    obtenerViajesEnRango(fechaISO(dias[0]), fechaISO(dias[6])),
  ]);
  const porFecha = {};
  citas.forEach(c => { (porFecha[c.fecha] ||= []).push(c); });

  const tarjetas = dias.map(d => {
    const fechaStrDia = fechaISO(d);
    const esDomingo    = d.getDay() === 0;
    const viaje        = viajeDeFecha(viajes, fechaStrDia);
    const { libres, total, pct } = calcularOcupacion(porFecha[fechaStrDia] || []);
    const color = viaje ? COLOR_VIAJE : (esDomingo ? COLOR_DOMINGO : colorOcupacion(pct));
    const titulo = viaje ? `Quiropráctico en ${viaje.ciudadFull}` : (esDomingo ? 'Cerrado' : pct + '% ocupado');

    return `
      <div class="semana-dia-card ${esDomingo && !viaje ? 'domingo' : ''}" data-fecha="${fechaStrDia}"
           style="background:${color.bg};color:${color.fg}" title="${titulo}">
        <div class="semana-dia-card-nombre">${DIAS_SEMANA[(d.getDay() + 6) % 7]}</div>
        <div class="semana-dia-card-num">${d.getDate()}</div>
        ${viaje
          ? _viajeBadgeHtml(viaje, 14)
          : `
            <div class="semana-dia-card-info">${esDomingo ? 'Cerrado' : `${libres}/${total} citas disponibles`}</div>
            ${!esDomingo ? _ocupacionBarHtml(pct, color) : ''}
          `}
      </div>`;
  }).join('');

  cont.innerHTML = `
    <div class="semana-header">
      <button class="btn btn-gray btn-sm" id="semana-volver-mes">← Volver al mes</button>
      <div class="semana-mes-titulo">Semana del ${dias[0].getDate()} al ${dias[6].getDate()} de ${MESES[dias[6].getMonth()]}</div>
      <div></div>
    </div>
    <div class="semana-grid-dias">${tarjetas}</div>`;

  document.getElementById('semana-volver-mes')?.addEventListener('click', () => {
    transicionar(() => renderMes(_mesActual));
  });

  cont.querySelectorAll('.semana-dia-card:not(.domingo)').forEach(card => {
    card.addEventListener('click', () => _onSeleccionarDia?.(card.dataset.fecha));
  });
}
