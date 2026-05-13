// src/core/router.js — Paso 2: Protección de rutas y redirección por rol
//
// USO:
//   En cada página protegida (dashboard, secretaria, callcenter):
//     import { protegerPagina } from '../../core/router.js';
//     protegerPagina('Administrador');   // rol requerido
//
//   En loginController.js, reemplazar window.location.href por:
//     import { redirigirPorRol } from '../../core/router.js';
//     redirigirPorRol(usuario);

import { onAuthStateChanged } from 'firebase/auth';
import { auth }               from './firebase.js';
import { getUsuarioPorId }    from './authService.js';

// ── Mapa de rutas por rol ─────────────────────────────────
// Cuando existan las páginas de secretaria y callcenter
// solo hay que añadir su ruta aquí — sin tocar nada más.
const RUTAS_POR_ROL = {
  'Administrador': '/src/pages/admin/dashboard.html',
  'Secretaria':    '/src/pages/secretaria/index.html',
  'Call-center':   '/src/pages/callcenter/index.html',
};

const RUTA_LOGIN = '/index.html';

// ── Redirigir al destino correcto según rol ───────────────
// Llamar justo después de un login exitoso.
export function redirigirPorRol(usuario) {
  const destino = RUTAS_POR_ROL[usuario?.rol] ?? RUTA_LOGIN;
  window.location.href = destino;
}

// ── Proteger una página ───────────────────────────────────
// Llamar al inicio de cada página protegida.
// Si no hay sesión activa → redirige al login.
// Si el rol no tiene permiso → redirige al login.
//
// @param {string|string[]|null} rolRequerido
//   null  = cualquier usuario autenticado puede entrar
//   'Administrador' = solo ese rol
//   ['Administrador','Secretaria'] = cualquiera de esos roles
//
// Retorna una Promise que resuelve con el usuario si tiene acceso,
// o redirige si no. Úsala con await para pausar el init del módulo.
//
// Ejemplo:
//   const usuario = await protegerPagina(['Administrador', 'Secretaria']);
//   renderPerfil(usuario);
//
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
          // Tiene sesión pero no tiene permiso → mandarlo a su página correcta
          redirigirPorRol(usuario);
          return;
        }
      }

      resolve(usuario);
    });
  });
}
