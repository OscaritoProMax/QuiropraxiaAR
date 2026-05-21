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
  doc, setDoc, getDoc, serverTimestamp
} from "firebase/firestore";
import { auth, db } from "./firebase";   // ← mismo directorio core/

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

    // Registrar sesión (sin bloquear)
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

// ── Login con Google ──────────────────────────────────────
export async function loginConGoogle() {
  try {
    const provider   = new GoogleAuthProvider();
    const credencial = await signInWithPopup(auth, provider);
    const user       = credencial.user;

    // ── VERIFICACIÓN DE SEGURIDAD ─────────────────────
    // Solo puede entrar si ya existe en Firestore
    // El admin debe haber creado su cuenta previamente
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

    // ── Registrar sesión ──────────────────────────────
    setDoc(doc(db, "sesiones", user.uid + "_" + Date.now()), {
      usuarioId:    user.uid,
      email:        user.email,
      metodo:       "google",
      fechaIngreso: serverTimestamp()
    }).catch(() => {});

    return { ok: true, usuario: datosUsuario };

  } catch (error) {
    if (error.code === "auth/popup-closed-by-user") {
      return { ok: false, error: "" };
    }
    return { ok: false, error: "No se pudo iniciar con Google. Intenta de nuevo." };
  }
}

// ── Logout ────────────────────────────────────────────────
export async function logout() {
  try {
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

// ── Cierre de sesión manual o por inactividad ─────────────────
export async function cerrarSesion() {
  try {
    await signOut(auth); // Le dice a Firebase que cierre la sesión
    // Opcional: limpiar datos locales si guardas algo
    // localStorage.clear(); 
    // sessionStorage.clear();
    
    // Redirigir al index (login)
    window.location.href = '/index.html';
  } catch (error) {
    console.error("Error al cerrar sesión:", error);
  }
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