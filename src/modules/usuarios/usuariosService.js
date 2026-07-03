// src/modules/usuarios/usuariosService.js
// Gestión avanzada de usuarios — solo Administrador
// Operaciones: listar, cambiar rol, toggle activo, eliminar, cambiar contraseña

import {
  doc, setDoc, getDoc, getDocs,
  collection, updateDoc, deleteDoc, serverTimestamp
} from 'firebase/firestore';
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail
} from 'firebase/auth';
import { db, auth } from '../../core/firebase.js';

// ── Obtener todos los usuarios ────────────────────────────
export async function obtenerUsuarios() {
  try {
    const snap = await getDocs(collection(db, 'usuarios'));
    const lista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    lista.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
    return lista;
  } catch (error) {
    console.error('Error obteniendo usuarios:', error);
    return [];
  }
}

// ── Cambiar rol de un usuario ─────────────────────────────
export async function cambiarRol(uid, nuevoRol) {
  try {
    await updateDoc(doc(db, 'usuarios', uid), {
      rol: nuevoRol,
      ultimaModificacion: serverTimestamp()
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: 'No se pudo cambiar el rol.' };
  }
}

// ── Activar / desactivar usuario ──────────────────────────
export async function toggleActivoUsuario(uid, activoActual) {
  try {
    await updateDoc(doc(db, 'usuarios', uid), {
      activo: !activoActual,
      ultimaModificacion: serverTimestamp()
    });
    return { ok: true, nuevoEstado: !activoActual };
  } catch (error) {
    return { ok: false, error: 'No se pudo cambiar el estado.' };
  }
}

// ── Detectar si el usuario usa Google o email/password ───
export function esUsuarioGoogle() {
  const user = auth.currentUser;
  if (!user) return false;
  return user.providerData.some(p => p.providerId === 'google.com');
}

// ── Reautenticar con email y contraseña ───────────────────
export async function reautenticarAdmin(passwordAdmin) {
  try {
    const usuario = auth.currentUser;
    if (!usuario || !usuario.email) {
      return { ok: false, error: 'No hay sesión activa.' };
    }
    const credencial = EmailAuthProvider.credential(usuario.email, passwordAdmin);
    await reauthenticateWithCredential(usuario, credencial);
    return { ok: true };
  } catch (error) {
    if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
      return { ok: false, error: 'Contraseña incorrecta.' };
    }
    return { ok: false, error: 'No se pudo verificar la identidad.' };
  }
}

// ── Reautenticar con Google (para usuarios OAuth) ─────────
export async function reautenticarAdminGoogle() {
  try {
    const usuario = auth.currentUser;
    if (!usuario) return { ok: false, error: 'No hay sesión activa.' };
    const provider   = new GoogleAuthProvider();
    provider.setCustomParameters({ login_hint: usuario.email });
    await reauthenticateWithPopup(usuario, provider);
    return { ok: true };
  } catch (error) {
    if (error.code === 'auth/popup-closed-by-user') {
      return { ok: false, error: '' };
    }
    return { ok: false, error: 'No se pudo verificar con Google.' };
  }
}

// ── Restablecer contraseña de otro usuario ────────────────
// Firebase no permite fijarle una contraseña a OTRO usuario desde el
// cliente sin Admin SDK — cualquier intento de "escribirla" desde acá
// (como hacía la versión anterior, guardándola en Firestore) queda en
// texto plano y además nunca cambia la contraseña real de Firebase Auth.
// El mecanismo correcto y seguro desde el cliente es enviar un correo de
// restablecimiento: el propio usuario define su nueva contraseña desde
// el enlace, y nunca queda expuesta a nadie más (ni al admin).
export async function enviarResetPassword(email) {
  try {
    if (!email) return { ok: false, error: 'Este usuario no tiene un correo registrado.' };
    await sendPasswordResetEmail(auth, email);
    return { ok: true };
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      return { ok: false, error: 'No existe una cuenta de Firebase Auth con ese correo.' };
    }
    return { ok: false, error: 'No se pudo enviar el correo de restablecimiento.' };
  }
}

// ── Eliminar usuario de Firestore ─────────────────────────
// La cuenta de Firebase Auth solo puede eliminarse desde Admin SDK o
// desde el propio usuario autenticado. Aquí marcamos como eliminado
// y desactivamos — la cuenta Auth queda pero no puede entrar.
export async function eliminarUsuario(uid) {
  try {
    // No eliminamos el doc para mantener historial — lo marcamos
    await updateDoc(doc(db, 'usuarios', uid), {
      activo:           false,
      eliminado:        true,
      fechaEliminacion: serverTimestamp()
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: 'No se pudo eliminar el usuario.' };
  }
}