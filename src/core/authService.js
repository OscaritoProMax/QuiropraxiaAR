// src/core/authService.js — Sprint 1: Módulo 001 - Login y control de roles

import {
  signInWithEmailAndPassword,
  signOut,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup
} from "firebase/auth";
import {
  doc, setDoc, getDoc, serverTimestamp, onSnapshot, updateDoc
} from "firebase/firestore";
import { auth, db } from "./firebase";   // ← mismo directorio core/

let desuscribirConcurrencia = null;
// 🛡️ NUEVO: Generador a prueba de fallos para celulares o navegadores antiguos
function generarTokenUnico() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Respaldo matemático si crypto falla
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}
// ── Roles disponibles ─────────────────────────────────────
export const ROLES = {
  ADMINISTRADOR: "Administrador",
  SECRETARIA:    "Secretaria",
  CALL_CENTER:   "Call-center"
};

// ── Login con email y contraseña ──────────────────────────
export async function login(email, password) {
  try {
    const credencial = await signInWithEmailAndPassword(auth, email, password);
    const user       = credencial.user;

    // ── NUEVO: Control de Concurrencia ──
    const tokenSesionUnico = generarTokenUnico();
    localStorage.setItem('id_sesion_local', tokenSesionUnico);

    // Guardamos el token en el documento de su perfil
    await updateDoc(doc(db, "usuarios", user.uid), {
      sesionActivaId: tokenSesionUnico
    });

    // Registrar sesión histórica (Tu lógica existente)
    setDoc(doc(db, "sesiones", user.uid + "_" + Date.now()), {
      usuarioId:    user.uid,
      email:        user.email,
      metodo:       "email",
      fechaIngreso: serverTimestamp()
    }).catch(() => {});

    const datosUsuario = await getUsuarioPorId(user.uid);
    return { ok: true, usuario: datosUsuario };

  } catch {
    return { ok: false, error: "Credenciales incorrectas." };
  }
}

// ── Login con Google (Actualizado con Diagnóstico y Concurrencia) ──
export async function loginConGoogle() {
  try {
    const provider   = new GoogleAuthProvider();
    const credencial = await signInWithPopup(auth, provider);
    const user       = credencial.user;

    // Verificar si el usuario está registrado en tu base de datos
    const datosUsuario = await getUsuarioPorId(user.uid);

    if (!datosUsuario) {
      await signOut(auth);
      return {
        ok: false,
        error: "Tu cuenta de Google no está autorizada. Contacta al administrador."
      };
    }

    if (!datosUsuario.activo) {
      await signOut(auth);
      return {
        ok: false,
        error: "Tu cuenta está desactivada. Contacta al administrador."
      };
    }

    // ── CONTROL DE CONCURRENCIA (Pestaña Única) ──
    const tokenSesionUnico = generarTokenUnico();
    localStorage.setItem('id_sesion_local', tokenSesionUnico);

    // Guardamos el token en Firestore usando merge:true para no borrar otros campos
    await setDoc(doc(db, "usuarios", user.uid), {
      sesionActivaId: tokenSesionUnico
    }, { merge: true });

    // Registrar sesión histórica
    setDoc(doc(db, "sesiones", user.uid + "_" + Date.now()), {
      usuarioId:    user.uid,
      email:        user.email,
      metodo:       "google",
      fechaIngreso: serverTimestamp()
    }).catch(() => {});

    return { ok: true, usuario: datosUsuario };

  } catch (error) {
    // 🚨 ESTA LÍNEA ES VITAL: Nos dirá en la consola el código de error real de Firebase
    console.error("🔥 Error real de Firebase Auth con Google:", error);

    if (error.code === "auth/popup-closed-by-user") {
      return { ok: false, error: "" };
    }
    // Te mostrará el código exacto en el recuadro rojo para saber qué configuración falta
    return { ok: false, error: `Error de autenticación (${error.code || 'Bloqueo COOP'}). Intenta de nuevo.` };
  }
}

// ── NUEVO: FUNCIÓN VIGILANTE DE CONCURRENCIA ─────────────────
export function iniciarVigilanteConcurrencia(usuarioObjeto) {
  const uid = usuarioObjeto?.id || usuarioObjeto?.uid;
  if (!uid) return;

  // 🛡️ PROTECCIÓN DE MEMORIA: Apagamos cualquier vigilante fantasma previo
  if (desuscribirConcurrencia) {
    desuscribirConcurrencia();
    desuscribirConcurrencia = null;
  }

  const idSesionLocal = localStorage.getItem('id_sesion_local');
  
  // 🛡️ PROTECCIÓN 2: Si por error no hay token, no ejecutamos nada
  if (!idSesionLocal) return;

  const userRef = doc(db, 'usuarios', uid);

  desuscribirConcurrencia = onSnapshot(userRef, (snapshot) => {
    if (snapshot.exists()) {
      const datosUsuario = snapshot.data();
      
      if (datosUsuario.sesionActivaId && datosUsuario.sesionActivaId !== idSesionLocal) {
  
        if (desuscribirConcurrencia) {
          desuscribirConcurrencia();
          desuscribirConcurrencia = null;
        }

        console.warn("Sesión cerrada automáticamente porque se abrió en otro dispositivo.");
        cerrarSesion(); 
      }
    }
  });
}
// ── Cierre de sesión manual o por inactividad ─────────────────
export async function cerrarSesion() {
  try {
    if (desuscribirConcurrencia) {
      desuscribirConcurrencia();
      desuscribirConcurrencia = null;
    }
    localStorage.removeItem('id_sesion_local');

    await signOut(auth); 
    window.location.href = '/index.html';
  } catch (error) {
    console.error("Error al cerrar sesión:", error);
  }
}

// ── Logout alternativo ──────────────────────────────────────
export async function logout() {
  try {
    if (desuscribirConcurrencia) {
      desuscribirConcurrencia();
      desuscribirConcurrencia = null;
    }
    localStorage.removeItem('id_sesion_local');

    await signOut(auth);
    return { ok: true };
  } catch {
    return { ok: false, error: "Error al cerrar sesión." };
  }
}
// ── Crear usuario (solo Administrador) ───────────────────
export async function crearUsuario(nombre, email, password, rol) {
  try {
    if (!Object.values(ROLES).includes(rol)) {
      return { ok: false, error: "Rol inválido." };
    }
    const credencial = await createUserWithEmailAndPassword(auth, email, password);
    const uid = credencial.user.uid;

    await setDoc(doc(db, "usuarios", uid), {
      uid, nombre, email, rol,
      activo: true,
      fechaCreacion: serverTimestamp()
    });
    return { ok: true, uid };
  } catch (error) {
    if (error.code === "auth/email-already-in-use") {
      return { ok: false, error: "Ese correo ya está registrado." };
    }
    if (error.code === "auth/weak-password") {
      return { ok: false, error: "La contraseña debe tener al menos 6 caracteres." };
    }
    return { ok: false, error: "No se pudo crear el usuario." };
  }
}

// ── Obtener usuario por UID ───────────────────────────────
export async function getUsuarioPorId(uid) {
  try {
    const snap = await getDoc(doc(db, "usuarios", uid));
    if (snap.exists()) return { id: snap.id, ...snap.data() };
    return null;
  } catch {
    return null;
  }
}

// ── Verificar permiso por rol ─────────────────────────────
export function tienePermiso(usuario, rolesPermitidos) {
  if (!usuario) return false;
  return rolesPermitidos.includes(usuario.rol);
}

// ── Escuchar cambios de sesión ────────────────────────────
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (user) {
      const datos = await getUsuarioPorId(user.uid);
      callback(datos || {
        uid:    user.uid,
        email:  user.email,
        nombre: user.displayName || user.email,
        rol:    ROLES.ADMINISTRADOR
      });
    } else {
      callback(null);
    }
  });
}


// ── Controlador de Inactividad (Timeout de sesión) ────────────
let temporizadorInactividad;
const TIEMPO_LIMITE = 10 * 60 * 1000; // 15 minutos en milisegundos (puedes ajustarlo)

export function iniciarVigilanteInactividad() {
  // Función que reinicia el cronómetro cada vez que el usuario hace algo
  function reiniciarTemporizador() {
    clearTimeout(temporizadorInactividad);
    
    temporizadorInactividad = setTimeout(() => {
      console.warn("⏳ Sesión expirada por inactividad.");
      // Remover los escuchadores para evitar bucles
      limpiarVigilante();
      // Forzar el cierre de sesión
      cerrarSesion();
    }, TIEMPO_LIMITE);
  }

  // Función para dejar de vigilar (útil si cierra sesión manualmente)
  function limpiarVigilante() {
    window.removeEventListener('mousemove', reiniciarTemporizador);
    window.removeEventListener('keydown', reiniciarTemporizador);
    window.removeEventListener('click', reiniciarTemporizador);
    window.removeEventListener('touchstart', reiniciarTemporizador);
    window.removeEventListener('scroll', reiniciarTemporizador);
    clearTimeout(temporizadorInactividad);
  }

  // Escuchar todos los eventos que demuestran que el usuario está "vivo"
  window.addEventListener('mousemove', reiniciarTemporizador);
  window.addEventListener('keydown', reiniciarTemporizador);
  window.addEventListener('click', reiniciarTemporizador);
  window.addEventListener('touchstart', reiniciarTemporizador); // Para celulares
  window.addEventListener('scroll', reiniciarTemporizador);

  // Iniciar el cronómetro por primera vez al cargar
  reiniciarTemporizador();
}