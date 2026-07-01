// src/shared/timePicker.js — Selector de hora AM/PM de tres partes
// Reemplaza visualmente un <select> estándar manteniéndolo sincronizado
// para compatibilidad con el código existente que lee .value (formato "HH:MM").

// ── Conversión 24h ↔ 12h ─────────────────────────────────

export function hora24a12(h24) {
  const [hStr, mStr] = h24.split(':');
  const h = parseInt(hStr, 10);
  return { h12: h % 12 || 12, min: mStr, ampm: h < 12 ? 'AM' : 'PM' };
}

export function hora12a24(h12, min, ampm) {
  let h = parseInt(h12, 10);
  if (ampm === 'PM' && h !== 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${min}`;
}

export function hora12Display(h24) {
  if (!h24) return '';
  const { h12, min, ampm } = hora24a12(h24);
  return `${h12}:${min} ${ampm}`;
}

// ── Estado interno ────────────────────────────────────────

const pickers = {};

function buildGroups(horarios) {
  const g = {};
  for (const h24 of horarios) {
    const { h12, min, ampm } = hora24a12(h24);
    if (!g[ampm]) g[ampm] = {};
    if (!g[ampm][h12]) g[ampm][h12] = [];
    g[ampm][h12].push(min);
  }
  return g;
}

function sortedHours(ampm, groups) {
  const hrs = Object.keys(groups[ampm] || {}).map(Number);
  if (ampm === 'PM') {
    hrs.sort((a, b) => (a === 12 ? -1 : b === 12 ? 1 : a - b));
  } else {
    hrs.sort((a, b) => a - b);
  }
  return hrs;
}

// ── Helpers de rebuild (leen siempre desde pickers[id]) ──

function rebuildAmpm(id) {
  const p = pickers[id];
  const cur = p.selAmpm.value;
  p.selAmpm.innerHTML = '';
  ['AM', 'PM'].forEach(v => {
    if (!p.groups[v] || !Object.keys(p.groups[v]).length) return;
    const o = document.createElement('option');
    o.value = v; o.textContent = v;
    p.selAmpm.appendChild(o);
  });
  if (p.groups[cur] && Object.keys(p.groups[cur]).length) p.selAmpm.value = cur;
}

function rebuildHours(id, preferH12) {
  const p = pickers[id];
  const ampm = p.selAmpm.value;
  const hrs  = sortedHours(ampm, p.groups);
  p.selHour.innerHTML = '';
  hrs.forEach(h => {
    const o = document.createElement('option');
    o.value = h; o.textContent = h;
    p.selHour.appendChild(o);
  });
  const sel = hrs.includes(preferH12) ? preferH12 : hrs[0];
  if (sel != null) p.selHour.value = sel;
}

function rebuildMins(id, preferMin) {
  const p = pickers[id];
  const ampm = p.selAmpm.value;
  const h12  = parseInt(p.selHour.value, 10);
  const mins = (p.groups[ampm]?.[h12] || []).slice();
  p.selMin.innerHTML = '';
  mins.forEach(m => {
    const o = document.createElement('option');
    o.value = m; o.textContent = m;
    p.selMin.appendChild(o);
  });
  const sel = mins.includes(preferMin) ? preferMin : mins[0];
  if (sel != null) p.selMin.value = sel;
}

function syncHidden(id) {
  const p = pickers[id];
  const h24 = hora12a24(parseInt(p.selHour.value, 10), p.selMin.value, p.selAmpm.value);
  p.hiddenSel.value = h24;
}

function setDisabledState(id, empty) {
  const p = pickers[id];
  [p.selHour, p.selMin, p.selAmpm].forEach(s => { s.disabled = empty; });
  p.wrap.style.opacity       = empty ? '0.45' : '';
  p.wrap.style.pointerEvents = empty ? 'none'  : '';
}

function applyValue(id, h24) {
  const p = pickers[id];
  const slot = (h24 && p.horarios.includes(h24))
    ? hora24a12(h24)
    : p.horarios.length ? hora24a12(p.horarios[0]) : null;

  if (!slot) { setDisabledState(id, true); p.hiddenSel.value = ''; return; }
  setDisabledState(id, false);

  rebuildAmpm(id);
  if (p.selAmpm.value !== slot.ampm && p.groups[slot.ampm]) p.selAmpm.value = slot.ampm;

  rebuildHours(id, slot.h12);
  rebuildMins(id, slot.min);
  syncHidden(id);
}

// ── API pública ───────────────────────────────────────────

export function initTimePicker(id, horarios, valorInicial = null) {
  const hiddenSel = document.getElementById(id);
  if (!hiddenSel) return;

  const prev = hiddenSel.parentNode.querySelector(`.time-picker-wrap[data-for="${id}"]`);
  if (prev) prev.remove();
  hiddenSel.style.display = 'none';
  // Populate hidden select so .value assignment works (browser ignores unknown option values)
  hiddenSel.innerHTML = horarios.map(h => `<option value="${h}">${h}</option>`).join('');

  const selHour = document.createElement('select');
  const selMin  = document.createElement('select');
  const selAmpm = document.createElement('select');
  const wrap    = document.createElement('div');
  const colon   = document.createElement('span');

  selHour.className = 'tp-sel tp-hour input-text';
  selMin.className  = 'tp-sel tp-min input-text';
  selAmpm.className = 'tp-sel tp-ampm input-text';
  wrap.className    = 'time-picker-wrap';
  wrap.dataset.for  = id;
  colon.className   = 'tp-colon';
  colon.textContent = ':';

  wrap.appendChild(selHour);
  wrap.appendChild(colon);
  wrap.appendChild(selMin);
  wrap.appendChild(selAmpm);

  hiddenSel.parentNode.insertBefore(wrap, hiddenSel.nextSibling);

  pickers[id] = {
    hiddenSel, selHour, selMin, selAmpm, wrap,
    horarios, groups: buildGroups(horarios),
  };

  selAmpm.addEventListener('change', () => {
    const prevH = parseInt(selHour.value, 10);
    const prevM = selMin.value;
    rebuildHours(id, prevH);
    rebuildMins(id, prevM);
    syncHidden(id);
  });
  selHour.addEventListener('change', () => {
    rebuildMins(id, selMin.value);
    syncHidden(id);
  });
  selMin.addEventListener('change', () => syncHidden(id));

  applyValue(id, valorInicial);
}

export function updateTimePicker(id, horarios, valorActual = null) {
  const p = pickers[id];
  if (!p) { initTimePicker(id, horarios, valorActual); return; }
  const prevVal = p.hiddenSel.value;
  p.horarios = horarios;
  p.groups   = buildGroups(horarios);
  p.hiddenSel.innerHTML = horarios.map(h => `<option value="${h}">${h}</option>`).join('');
  const target = valorActual != null ? valorActual
    : (horarios.includes(prevVal) ? prevVal : null);
  applyValue(id, target);
}

export function setTimePicker(id, h24) {
  const p = pickers[id];
  if (!p || !p.horarios.includes(h24)) return;
  applyValue(id, h24);
}

export function disableTimePicker(id) {
  if (pickers[id]) setDisabledState(id, true);
}

export function enableTimePicker(id) {
  if (pickers[id]) setDisabledState(id, false);
}
