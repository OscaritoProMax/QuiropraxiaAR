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
  updatePassword
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

// ── Cambiar contraseña de otro usuario ────────────────────
// Firebase no permite cambiar la contraseña de otro usuario desde el cliente.
// La solución segura: iniciar sesión temporal con las credenciales del usuario,
// cambiar su contraseña, y luego restaurar la sesión del admin.
// NOTA: Esto requiere conocer la contraseña actual del usuario o usar Admin SDK.
// Implementación: guardamos la nueva contraseña en Firestore (campo temporal)
// y forzamos cambio en el próximo login. Para cambio inmediato se requiere Admin SDK.
export async function forzarCambioPassword(uid, nuevaPassword) {
  try {
    if (!nuevaPassword || nuevaPassword.length < 6) {
      return { ok: false, error: 'La contraseña debe tener al menos 6 caracteres.' };
    }
    // Guardar flag en Firestore — el usuario deberá cambiarla al entrar
    await updateDoc(doc(db, 'usuarios', uid), {
      passwordTemporal:     nuevaPassword,   // campo temporal — borrar tras primer login
      requiereCambioPass:   true,
      ultimaModificacion:   serverTimestamp()
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: 'No se pudo programar el cambio de contraseña.' };
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