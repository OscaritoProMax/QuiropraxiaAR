// src/core/authService.js — Sprint 1: Módulo 001 - Login y control de roles

import {
  signInWithEmailAndPassword,
  signOut,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCredential
} from "firebase/auth";
import {
  doc, setDoc, getDoc, serverTimestamp, onSnapshot
} from "firebase/firestore";
import { Capacitor } from "@capacitor/core";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import { auth, db, secondaryAuth } from "./firebase";   // ← mismo directorio core/

let desuscribirConcurrencia = null;

// 🛡️ Generador a prueba de fallos para celulares o navegadores antiguos
function generarTokenUnico() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
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

    // Forzamos que el token de Auth quede propagado antes de leer Firestore.
    // Justo después de signIn, el cliente de Firestore puede no tener aún
    // el token adjunto a su canal interno — el primer getDoc() de abajo
    // fallaba en silencio (permission-denied, tragado por el catch de
    // getUsuarioPorId) y el login se quedaba "atascado" la primera vez,
    // funcionando recién al reintentar.
    await user.getIdToken();

    // ── CONTROL DE CONCURRENCIA OPTIMIZADO ──
    const tokenSesionUnico = generarTokenUnico();
    localStorage.setItem('id_sesion_local', tokenSesionUnico);

    // ✅ OPTIMIZACIÓN: Guardamos en Firestore en segundo plano (sin usar await que congele la interfaz)
    setDoc(doc(db, "usuarios", user.uid), {
      sesionActivaId: tokenSesionUnico
    }, { merge: true }).catch((err) => console.error("Error guardando sesión activa:", err));

    // Registrar sesión histórica (en segundo plano)
    setDoc(doc(db, "sesiones", user.uid + "_" + Date.now()), {
      usuarioId:    user.uid,
      email:        user.email,
      metodo:       "email",
      fechaIngreso: serverTimestamp()
    }).catch(() => {});

    // Obtenemos los datos del usuario para el router
    const datosUsuario = await getUsuarioPorId(user.uid);
    return { ok: true, usuario: datosUsuario };

  } catch (error) {
    console.error("Error en login:", error);
    return { ok: false, error: "Credenciales incorrectas." };
  }
}

// ── Inicio de sesión con Google según plataforma ──────────
// En Android (Capacitor nativo) usamos el plugin nativo: el login de
// Google ocurre DENTRO de la app (no abre el navegador) y luego firmamos
// en el SDK web de Firebase con la credencial obtenida, para que
// auth.currentUser, Firestore y el resto del flujo funcionen igual.
// En web/PC seguimos usando el popup estándar.
async function iniciarSesionGoogle() {
  if (Capacitor.isNativePlatform()) {
    const result   = await FirebaseAuthentication.signInWithGoogle();
    const idToken   = result.credential?.idToken;
    const accessTok = result.credential?.accessToken;
    if (!idToken && !accessTok) {
      throw new Error("No se recibió la credencial de Google.");
    }
    const credential = GoogleAuthProvider.credential(idToken, accessTok);
    const credencial = await signInWithCredential(auth, credential);
    return credencial.user;
  }
  const provider   = new GoogleAuthProvider();
  const credencial = await signInWithPopup(auth, provider);
  return credencial.user;
}

// ── Login con Google ──────────────────
export async function loginConGoogle() {
  try {
    const user = await iniciarSesionGoogle();

    // Mismo fix que en login(): asegurar que el token esté propagado
    // antes del primer getDoc(), para que no falle por una carrera con
    // el canal interno de Firestore.
    await user.getIdToken();

    const datosUsuario = await getUsuarioPorId(user.uid);

    if (!datosUsuario) {
      await signOut(auth);
      return { ok: false, error: "Tu cuenta de Google no está autorizada. Contacta al administrador." };
    }

    if (!datosUsuario.activo) {
      await signOut(auth);
      return { ok: false, error: "Tu cuenta está desactivada. Contacta al administrador." };
    }

    // ── CONTROL DE CONCURRENCIA — FIX RACE CONDITION ──
    // CRITICO: debe ser await para que Firestore tenga el token
    // ANTES de que el vigilante onSnapshot arranque en el dashboard.
    const tokenSesionUnico = generarTokenUnico();
    localStorage.setItem('id_sesion_local', tokenSesionUnico);

    // FIX: await aqui — sin esto el vigilante lee el token viejo
    // y cierra la sesion inmediatamente al llegar al dashboard.
    await setDoc(doc(db, "usuarios", user.uid), {
      sesionActivaId: tokenSesionUnico
    }, { merge: true });

    // Registrar sesión histórica (segundo plano — este sí puede ser sin await)
    setDoc(doc(db, "sesiones", user.uid + "_" + Date.now()), {
      usuarioId:    user.uid,
      email:        user.email,
      metodo:       "google",
      fechaIngreso: serverTimestamp()
    }).catch(() => {});

    return { ok: true, usuario: datosUsuario };

  } catch (error) {
    console.error("🔥 Error real de Firebase Auth con Google:", error);
    // Cancelación por el usuario — no mostramos error (web y nativo).
    const msg = (error?.message || "").toLowerCase();
    const cancelado =
      error.code === "auth/popup-closed-by-user" ||
      error.code === "auth/cancelled-popup-request" ||
      msg.includes("canceled") || msg.includes("cancelled") ||
      msg.includes("12501");   // Android: SIGN_IN_CANCELLED
    if (cancelado) {
      return { ok: false, error: "" };
    }
    return { ok: false, error: `Error de autenticación (${error.code || 'Bloqueo COOP'}). Intenta de nuevo.` };
  }
}


// ── FUNCIÓN VIGILANTE DE CONCURRENCIA (Blindada contra fugas de memoria) ─────────────────
export function iniciarVigilanteConcurrencia(usuarioObjeto) {
  const uid = usuarioObjeto?.id || usuarioObjeto?.uid;
  if (!uid) return;

  // 🛡️ PROTECCIÓN DE MEMORIA: Matamos cualquier escucha activa vieja para que la app no se ponga pesada
  if (desuscribirConcurrencia) {
    desuscribirConcurrencia();
    desuscribirConcurrencia = null;
  }

  const idSesionLocal = localStorage.getItem('id_sesion_local');
  if (!idSesionLocal) return;

  const userRef = doc(db, 'usuarios', uid);

  // FIX: delay de arranque — da tiempo a que Firestore propague
  // el token antes de que el primer snapshot lo evalúe.
  // Sin este delay, el onSnapshot lee el token anterior y
  // cierra la sesión recién iniciada con Google.
  const _arrancarVigilante = () => {
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
  }; // fin _arrancarVigilante

  // 1500ms: margen seguro para propagación de Firestore
  // incluso en conexiones lentas de Colombia (3G/4G rural).
  setTimeout(_arrancarVigilante, 1500);
}

// En Android también hay que cerrar la sesión nativa del plugin de Google,
// si no la próxima vez podría reusar la cuenta sin volver a preguntar.
async function cerrarSesionNativa() {
  if (!Capacitor.isNativePlatform()) return;
  try { await FirebaseAuthentication.signOut(); } catch (_) {}
}

// ── Cierre de sesión manual o por inactividad ─────────────────
export async function cerrarSesion() {
  try {
    if (desuscribirConcurrencia) {
      desuscribirConcurrencia();
      desuscribirConcurrencia = null;
    }
    localStorage.removeItem('id_sesion_local');
    await cerrarSesionNativa();
    await signOut(auth);
    // FIX: replace en lugar de href para evitar entrada en historial
    // y compatibilidad con Vite base path
    window.location.replace('/index.html');
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
    await cerrarSesionNativa();
    await signOut(auth);
    return { ok: true };
  } catch {
    return { ok: false, error: "Error al cerrar sesión." };
  }
}

// ── Crear usuario (solo Administrador) ───────────────────
// Usa `secondaryAuth` (instancia de Auth separada) para crear el usuario
// en Firebase Auth. createUserWithEmailAndPassword() inicia sesión
// automáticamente como el usuario nuevo en la instancia que se le pasa;
// si usáramos `auth` (la del admin logueado), el administrador perdería
// su sesión a mitad de la operación y el setDoc() de abajo fallaría por
// las reglas de Firestore (esAdmin() ya no vería al admin autenticado).
export async function crearUsuario(nombre, email, password, rol) {
  try {
    if (!Object.values(ROLES).includes(rol)) {
      return { ok: false, error: "Rol inválido." };
    }
    const credencial = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const uid = credencial.user.uid;
    await signOut(secondaryAuth);

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
  } catch (error) {
    console.error("Error obteniendo usuario:", error);
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
const TIEMPO_LIMITE = 10 * 60 * 1000; 

export function iniciarVigilanteInactividad() {
  function reiniciarTemporizador() {
    clearTimeout(temporizadorInactividad);
    temporizadorInactividad = setTimeout(() => {
      console.warn("⏳ Sesión expirada por inactividad.");
      limpiarVigilante();
      cerrarSesion();
    }, TIEMPO_LIMITE);
  }

  function limpiarVigilante() {
    window.removeEventListener('mousemove', reiniciarTemporizador);
    window.removeEventListener('keydown', reiniciarTemporizador);
    window.removeEventListener('click', reiniciarTemporizador);
    window.removeEventListener('touchstart', reiniciarTemporizador);
    window.removeEventListener('scroll', reiniciarTemporizador);
    clearTimeout(temporizadorInactividad);
  }

  window.addEventListener('mousemove', reiniciarTemporizador);
  window.addEventListener('keydown', reiniciarTemporizador);
  window.addEventListener('click', reiniciarTemporizador);
  window.addEventListener('touchstart', reiniciarTemporizador); 
  window.addEventListener('scroll', reiniciarTemporizador);

  reiniciarTemporizador();
}