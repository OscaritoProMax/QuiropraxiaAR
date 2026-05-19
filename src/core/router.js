// src/core/router.js — Paso 2: Protección de rutas y redirección por rol

import { onAuthStateChanged } from 'firebase/auth';
import { auth }               from './firebase.js';
import { getUsuarioPorId }    from './authService.js';

// ── Detectar base path según dónde estamos ────────────────
// Con base: './' de Vite, las rutas absolutas no funcionan.
// Usamos rutas relativas desde la raíz del servidor.
const RUTAS_POR_ROL = {
  'Administrador': '/src/pages/admin/dashboard.html',
  'Secretaria':    '/src/pages/secretaria/index.html',
  'Call-center':   '/src/pages/callcenter/index.html',
};

const RUTA_LOGIN = '/index.html';

// ── Página actual ─────────────────────────────────────────
function rutaActual() {
  return window.location.pathname;
}

function esRutaDeRol(rol) {
  const ruta = RUTAS_POR_ROL[rol];
  return ruta && rutaActual().endsWith(ruta.replace(/^\//, ''));
}

// ── Redirigir al destino correcto según rol ───────────────
export function redirigirPorRol(usuario) {
  const destino = RUTAS_POR_ROL[usuario?.rol] ?? RUTA_LOGIN;

  // ── GUARD: no redirigir si ya estamos en la página correcta ──
  // Evita el loop infinito cuando protegerPagina llama redirigirPorRol
  if (rutaActual().includes(destino.replace('/src/pages/', '').replace('.html', ''))) {
    console.warn('[router] Ya estamos en la página correcta — redirect cancelado');
    return;
  }

  window.location.href = destino;
}

// ── Proteger una página ───────────────────────────────────
export function protegerPagina(rolRequerido = null) {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      unsub(); // escuchar solo una vez

      if (!firebaseUser) {
        window.location.href = RUTA_LOGIN;
        return;
      }

      const usuario = await getUsuarioPorId(firebaseUser.uid);

      if (!usuario || !usuario.activo) {
        window.location.href = RUTA_LOGIN;
        return;
      }

      // Verificar rol si se especificó
      if (rolRequerido !== null) {
        const rolesPermitidos = Array.isArray(rolRequerido)
          ? rolRequerido
          : [rolRequerido];

        if (!rolesPermitidos.includes(usuario.rol)) {
          // ── GUARD: si ya estamos en la página de su rol, resolver ──
          if (esRutaDeRol(usuario.rol)) {
            resolve(usuario);
            return;
          }
          // Tiene sesión pero rol incorrecto → mandarlo a su página
          redirigirPorRol(usuario);
          return;
        }
      }

      resolve(usuario);
    });
  });
}
