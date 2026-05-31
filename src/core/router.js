// src/core/router.js

import { onAuthStateChanged } from 'firebase/auth';
import { auth }               from './firebase.js';
import { getUsuarioPorId }    from './authService.js';

const RUTAS_POR_ROL = {
  'Administrador': '/src/pages/admin/dashboard.html',
  'Secretaria':    '/src/pages/secretaria/index.html',
  'Call-center':   '/src/pages/callcenter/index.html',
};

const RUTA_LOGIN = '/index.html';

function rutaActual() {
  return window.location.pathname;
}

function esRutaDeRol(rol) {
  const rutaDestino = RUTAS_POR_ROL[rol];
  if (!rutaDestino) return false;
  
  const actualLimpia = rutaActual().replace(/^\/|\/$/g, '');
  const destinoLimpio = rutaDestino.replace(/^\/|\/$/g, '');
  
  return actualLimpia.endsWith(destinoLimpio);
}

// ── Redirigir al destino correcto según rol (BLINDADO) ──
export async function redirigirPorRol(usuario) {
  // 1. Extraemos el ID real sin importar si viene como .uid o .id, o usamos la sesión activa de Firebase
  const uidValido = usuario?.uid || usuario?.id || auth.currentUser?.uid;
  let rolActual   = usuario?.rol;

  // 2. Si no hay ID ni sesión iniciada de ninguna forma, directo al login
  if (!uidValido) {
    const enLogin = rutaActual() === '/' || rutaActual().endsWith('index.html');
    if (!enLogin) window.location.href = RUTA_LOGIN;
    return;
  }

  // 3. Si no detectamos el rol en el parámetro recibido, forzamos la descarga desde Firestore usando el ID seguro
  if (!rolActual) {
    console.log(`[router] No se detectó rol directo. Buscando en Firestore para el ID: ${uidValido}...`);
    const perfilFresco = await getUsuarioPorId(uidValido);
    rolActual = perfilFresco?.rol;
  }

  const destino = RUTAS_POR_ROL[rolActual] ?? RUTA_LOGIN;

  // 4. Si el navegador ya está en la pantalla correspondiente al rol, cancelar navegación
  if (esRutaDeRol(rolActual)) {
    console.log('[router] El usuario ya está en la vista asignada a su rol.');
    return;
  }

  // 5. Si el destino final es el login y el usuario ya está ahí, evitar bucle infinito
  const enLogin = rutaActual() === '/' || rutaActual().endsWith('index.html');
  if (destino === RUTA_LOGIN && enLogin) {
    console.warn(`[router] El destino es el login y ya estamos en él (Rol detectado: ${rolActual || 'Ninguno'}). Redirección cancelada.`);
    return;
  }

  console.log(`[router] Redirigiendo con éxito a: ${destino}`);
  window.location.href = destino;
}

// ── Proteger una página ───────────────────────────────────
export function protegerPagina(rolRequerido = null) {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      unsub(); 

      if (!firebaseUser) {
        window.location.href = RUTA_LOGIN;
        return;
      }

      const usuario = await getUsuarioPorId(firebaseUser.uid);

      if (!usuario || !usuario.activo) {
        window.location.href = RUTA_LOGIN;
        return;
      }

      if (rolRequerido !== null) {
        const rolesPermitidos = Array.isArray(rolRequerido) ? rolRequerido : [rolRequerido];

        if (!rolesPermitidos.includes(usuario.rol)) {
          if (esRutaDeRol(usuario.rol)) {
            resolve(usuario);
            return;
          }
          redirigirPorRol(usuario);
          return;
        }
      }

      resolve(usuario);
    });
  });
}