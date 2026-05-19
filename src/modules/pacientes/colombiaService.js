// ══════════════════════════════════════════════════════════════════
// src/modules/pacientes/colombiaService.js
// Reemplaza el objeto DEPARTAMENTOS hardcodeado de pacientesService.js
// Usa https://api-colombia.com — sin autenticación, gratuita
// ══════════════════════════════════════════════════════════════════

const BASE = "https://api-colombia.com/api/v1";

// Caché en memoria para la sesión (evita llamadas repetidas)
let _departamentos = null;          // [{ id, name }]
let _ciudadesPorDepto = {};         // { [deptoId]: ["Ciudad1", ...] }

// ══════════════════════════════════════════════════════════════════
// OBTENER DEPARTAMENTOS
// Retorna array ordenado: [{ id: 5, nombre: "Antioquia" }, ...]
// ══════════════════════════════════════════════════════════════════
export async function obtenerDepartamentos() {
  if (_departamentos) return _departamentos;

  // Intentar desde sessionStorage para no repetir en recarga suave
  const cached = sessionStorage.getItem("qm_deptos");
  if (cached) {
    _departamentos = JSON.parse(cached);
    return _departamentos;
  }

  try {
    const res  = await fetch(`${BASE}/Department`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    _departamentos = data
      .map(d => ({ id: d.id, nombre: d.name }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    sessionStorage.setItem("qm_deptos", JSON.stringify(_departamentos));
    return _departamentos;

  } catch (err) {
    console.warn("[colombiaService] Error obteniendo departamentos, usando fallback:", err.message);
    return _fallbackDepartamentos();
  }
}

// ══════════════════════════════════════════════════════════════════
// OBTENER CIUDADES / MUNICIPIOS DE UN DEPARTAMENTO
// Retorna array de strings ordenados: ["Abejorral", "Abriaquí", ...]
// ══════════════════════════════════════════════════════════════════
export async function obtenerCiudades(deptoId) {
  if (!deptoId) return [];
  if (_ciudadesPorDepto[deptoId]) return _ciudadesPorDepto[deptoId];

  const cacheKey = `qm_ciudades_${deptoId}`;
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) {
    _ciudadesPorDepto[deptoId] = JSON.parse(cached);
    return _ciudadesPorDepto[deptoId];
  }

  try {
    const res  = await fetch(`${BASE}/Department/${deptoId}/cities`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const ciudades = data
      .map(c => c.name)
      .sort((a, b) => a.localeCompare(b, "es"));

    _ciudadesPorDepto[deptoId] = ciudades;
    sessionStorage.setItem(cacheKey, JSON.stringify(ciudades));
    return ciudades;

  } catch (err) {
    console.warn(`[colombiaService] Error obteniendo ciudades del depto ${deptoId}:`, err.message);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════
// POBLAR SELECT DE DEPARTAMENTOS
// Uso: await poblarSelectDepartamentos(document.getElementById("p-dpto"))
// ══════════════════════════════════════════════════════════════════
export async function poblarSelectDepartamentos(selectEl, placeholder = "Departamento...") {
  if (!selectEl) return;

  selectEl.disabled = true;
  selectEl.innerHTML = `<option value="">Cargando departamentos...</option>`;

  const deptos = await obtenerDepartamentos();

  selectEl.innerHTML = `<option value="">— ${placeholder} —</option>`;
  deptos.forEach(d => {
    const opt = document.createElement("option");
    opt.value       = d.id;          // valor = ID numerico para pedir ciudades
    opt.dataset.nombre = d.nombre;   // nombre legible para guardar en Firebase
    opt.textContent = d.nombre;
    selectEl.appendChild(opt);
  });

  selectEl.disabled = false;
}

// ══════════════════════════════════════════════════════════════════
// POBLAR SELECT DE CIUDADES SEGÚN DEPARTAMENTO SELECCIONADO
// Uso: selectDepto.addEventListener("change", () => poblarSelectCiudades(selectDepto, selectCiudad))
// ══════════════════════════════════════════════════════════════════
export async function poblarSelectCiudades(selectDeptoEl, selectCiudadEl, placeholder = "Ciudad...") {
  if (!selectDeptoEl || !selectCiudadEl) return;

  const deptoId = selectDeptoEl.value;

  if (!deptoId) {
    selectCiudadEl.innerHTML = `<option value="">— ${placeholder} —</option>`;
    selectCiudadEl.disabled  = true;
    return;
  }

  selectCiudadEl.disabled  = true;
  selectCiudadEl.innerHTML = `<option value="">Cargando municipios...</option>`;

  const ciudades = await obtenerCiudades(deptoId);

  selectCiudadEl.innerHTML = `<option value="">— ${placeholder} —</option>`;
  ciudades.forEach(c => {
    const opt = document.createElement("option");
    opt.value       = c;
    opt.textContent = c;
    selectCiudadEl.appendChild(opt);
  });

  selectCiudadEl.disabled = ciudades.length === 0;
}

// ══════════════════════════════════════════════════════════════════
// INICIALIZAR PAR depto → ciudad
// Llama a esto una vez por cada par de selects.
// Devuelve una función para leer el valor canónico "Depto > Ciudad".
// ══════════════════════════════════════════════════════════════════
export async function inicializarSelectsUbicacion(selectDeptoEl, selectCiudadEl) {
  if (!selectDeptoEl || !selectCiudadEl) return () => "";

  await poblarSelectDepartamentos(selectDeptoEl);

  selectDeptoEl.addEventListener("change", () => {
    poblarSelectCiudades(selectDeptoEl, selectCiudadEl);
  });

  // Retorna helper para obtener "Boyacá > Tunja" listo para Firebase
  return function getUbicacion() {
    const deptoNombre = selectDeptoEl.selectedOptions[0]?.dataset?.nombre || "";
    const ciudad      = selectCiudadEl.value;
    if (!deptoNombre && !ciudad) return "";
    if (!ciudad) return deptoNombre;
    return `${deptoNombre} > ${ciudad}`;
  };
}

// ══════════════════════════════════════════════════════════════════
// RESTAURAR SELECTS CON UN VALOR GUARDADO "Boyacá > Tunja"
// Útil al editar un paciente existente
// ══════════════════════════════════════════════════════════════════
export async function restaurarUbicacion(selectDeptoEl, selectCiudadEl, valorGuardado) {
  if (!valorGuardado || !selectDeptoEl || !selectCiudadEl) return;

  const [deptoNombre, ciudad] = valorGuardado.includes(" > ")
    ? valorGuardado.split(" > ")
    : ["", valorGuardado];

  // Asegurarnos que los deptos están cargados
  await poblarSelectDepartamentos(selectDeptoEl);

  // Encontrar el option por nombre
  const opts = Array.from(selectDeptoEl.options);
  const opt  = opts.find(o => o.dataset.nombre === deptoNombre || o.textContent === deptoNombre);
  if (opt) {
    selectDeptoEl.value = opt.value;
    await poblarSelectCiudades(selectDeptoEl, selectCiudadEl);
    selectCiudadEl.value = ciudad;
  }
}

// ══════════════════════════════════════════════════════════════════
// OBTENER NOMBRE DEL DEPARTAMENTO POR ID
// ══════════════════════════════════════════════════════════════════
export async function nombreDepartamento(id) {
  const deptos = await obtenerDepartamentos();
  return deptos.find(d => d.id === Number(id))?.nombre || "";
}

// ══════════════════════════════════════════════════════════════════
// LIMPIAR CACHÉ (útil en pruebas o al cerrar sesión)
// ══════════════════════════════════════════════════════════════════
export function limpiarCacheGeografia() {
  _departamentos = null;
  _ciudadesPorDepto = {};
  Object.keys(sessionStorage)
    .filter(k => k.startsWith("qm_deptos") || k.startsWith("qm_ciudades_"))
    .forEach(k => sessionStorage.removeItem(k));
}

// ══════════════════════════════════════════════════════════════════
// FALLBACK — si la API falla, usa la lista local (igual que antes)
// pero completa con todos los departamentos
// ══════════════════════════════════════════════════════════════════
function _fallbackDepartamentos() {
  const nombres = [
    "Amazonas","Antioquia","Arauca","Atlántico","Bolívar","Boyacá",
    "Caldas","Caquetá","Casanare","Cauca","Cesar","Chocó","Córdoba",
    "Cundinamarca","Guainía","Guaviare","Huila","La Guajira","Magdalena",
    "Meta","Nariño","Norte de Santander","Putumayo","Quindío","Risaralda",
    "San Andrés","Santander","Sucre","Tolima","Valle del Cauca","Vaupés","Vichada"
  ];
  // IDs aproximados (orden alfabético en la API)
  return nombres.map((nombre, i) => ({ id: i + 1, nombre }));
}
