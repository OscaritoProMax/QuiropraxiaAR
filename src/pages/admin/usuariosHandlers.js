// src/pages/admin/usuariosHandlers.js
// Módulo de gestión de usuarios — solo Administrador
// Página independiente: src/pages/admin/usuarios.html

import { protegerPagina }            from '../../core/router.js';
import { logout, ROLES }             from '../../core/authService.js';
import { iniciarVigilanteConcurrencia,
         iniciarVigilanteInactividad } from '../../core/authService.js';
import { crearUsuario }              from '../../core/authService.js';
import { obtenerUsuarios, cambiarRol,
         toggleActivoUsuario, eliminarUsuario,
         reautenticarAdmin, reautenticarAdminGoogle,
         esUsuarioGoogle, forzarCambioPassword } from '../../modules/usuarios/usuariosService.js';
import { mostrarAlerta, abrirModal, cerrarModal } from '../../shared/helpers.js';
import { renderPerfil }              from '../../modules/dashboard/ui.js';

// ── Estado ────────────────────────────────────────────────
let usuarioActual = null;
let listaUsuarios = [];
let uidObjetivo   = null;   // usuario sobre el que opera la acción pendiente

// ══════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════
export async function initUsuarios() {
  // Remover guard y mostrar app
  usuarioActual = await protegerPagina(ROLES.ADMINISTRADOR);
  // Mismo patrón que dashboard.html: eliminar el style tag que oculta el body
  document.getElementById('security-guard')?.remove();
  document.getElementById('auth-guard')?.remove();
  document.body.style.display = '';

  renderPerfil(usuarioActual);
  iniciarVigilanteConcurrencia(usuarioActual);
  iniciarVigilanteInactividad();

  await cargarTablaUsuarios();
  bindCerrarModales();
  bindNuevoUsuario();
  bindModalReauth();
  bindModalCambioRol();
  bindModalCambioPass();
  bindLogout();
}

// ── Listener global para botones data-close ───────────────
function bindCerrarModales() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-close]');
    if (btn) cerrarModal(btn.dataset.close);

    // Click en el overlay oscuro también cierra
    if (e.target.classList.contains('modal-overlay')) {
      e.target.id && cerrarModal(e.target.id);
    }
  });
}

// ══════════════════════════════════════════════════════════
// TABLA DE USUARIOS
// ══════════════════════════════════════════════════════════
async function cargarTablaUsuarios() {
  const tbody = document.getElementById('usr-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Cargando...</td></tr>';

  listaUsuarios = await obtenerUsuarios();
  // Filtrar eliminados del listado
  const visibles = listaUsuarios.filter(u => !u.eliminado);

  if (!visibles.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No hay usuarios registrados</td></tr>';
    return;
  }

  tbody.innerHTML = visibles.map(u => `
    <tr data-uid="${u.id}" class="${!u.activo ? 'usr-row-inactivo' : ''}">
      <td>
        <div class="usr-avatar">${iniciales(u.nombre)}</div>
      </td>
      <td>
        <div class="usr-nombre">${u.nombre}</div>
        <div class="usr-email">${u.email}</div>
      </td>
      <td>
        <span class="badge ${badgeRol(u.rol)}">${u.rol}</span>
      </td>
      <td>
        <span class="badge ${u.activo ? 'badge-success' : 'badge-danger'}">
          ${u.activo ? 'Activo' : 'Inactivo'}
        </span>
      </td>
      <td>
        <div class="usr-acciones">
          <button class="btn btn-soft btn-sm" onclick="abrirCambioRol('${u.id}','${u.rol}','${u.nombre}')">
            Cambiar rol
          </button>
          <button class="btn btn-soft btn-sm" onclick="abrirCambioPass('${u.id}','${u.nombre}')">
            Contraseña
          </button>
          <button class="btn ${u.activo ? 'btn-yellow' : 'btn-soft'} btn-sm"
                  onclick="confirmarToggle('${u.id}','${u.activo}','${u.nombre}')">
            ${u.activo ? 'Desactivar' : 'Activar'}
          </button>
          ${u.id !== usuarioActual?.id ? `
          <button class="btn btn-danger btn-sm" onclick="confirmarEliminar('${u.id}','${u.nombre}')">
            Eliminar
          </button>` : '<span class="usr-yo-tag">(tú)</span>'}
        </div>
      </td>
    </tr>`).join('');
}

function iniciales(nombre) {
  const p = (nombre || 'U').trim().split(' ');
  return (p[0][0] + (p[1] ? p[1][0] : '')).toUpperCase();
}

function badgeRol(rol) {
  return {
    'Administrador': 'badge-primary',
    'Secretaria':    'badge-warning',
    'Call-center':   'badge-info',
  }[rol] || 'badge-default';
}

// ══════════════════════════════════════════════════════════
// MODAL CREAR USUARIO
// ══════════════════════════════════════════════════════════
function bindNuevoUsuario() {
  document.getElementById('btn-nuevo-usr')
    ?.addEventListener('click', () => abrirModal('modal-nuevo-usr'));

  document.getElementById('btn-guardar-nuevo-usr')
    ?.addEventListener('click', async () => {
      const btn      = document.getElementById('btn-guardar-nuevo-usr');
      const nombre   = document.getElementById('u-nombre').value.trim();
      const email    = document.getElementById('u-email').value.trim();
      const password = document.getElementById('u-password').value;
      const rol      = document.getElementById('u-rol').value;

      // Validaciones locales antes de llamar Firebase
      if (!nombre) {
        mostrarAlerta('alert-nuevo-usr', 'El nombre es obligatorio.', 'error');
        return;
      }
      if (!email || !email.includes('@')) {
        mostrarAlerta('alert-nuevo-usr', 'Ingresa un correo valido.', 'error');
        return;
      }
      if (!password || password.length < 6) {
        mostrarAlerta('alert-nuevo-usr', 'La contrasena debe tener al menos 6 caracteres.', 'error');
        return;
      }

      btn.disabled = true; btn.textContent = 'Creando...';

      // authService.crearUsuario usa una instancia secundaria de Firebase
      // Auth para crear el usuario, evitando que se reemplace la sesion
      // del administrador (createUserWithEmailAndPassword inicia sesion
      // automaticamente como el usuario recien creado).
      const res = await crearUsuario(nombre, email, password, rol);

      btn.disabled = false; btn.textContent = 'Crear usuario';

      if (res.ok) {
        mostrarAlerta('alert-nuevo-usr', 'Usuario creado correctamente.', 'success');
        setTimeout(() => {
          cerrarModal('modal-nuevo-usr');
          ['u-nombre','u-email','u-password'].forEach(id =>
            { const el = document.getElementById(id); if (el) el.value = ''; });
        }, 800);
        await cargarTablaUsuarios();
      } else {
        mostrarAlerta('alert-nuevo-usr', res.error, 'error');
      }
    });
}

// ══════════════════════════════════════════════════════════
// MODAL REAUTENTICACIÓN — requerido antes de acciones sensibles
// ══════════════════════════════════════════════════════════
let _accionTrasClave  = null;
let _modalOrigen      = null;   // modal que estaba abierto antes del reauth

async function pedirClave(accion, modalOrigen = null) {
  _accionTrasClave = accion;
  _modalOrigen     = modalOrigen;

  // Cerrar modal origen para que el reauth quede en primer plano
  if (modalOrigen) cerrarModal(modalOrigen);

  if (esUsuarioGoogle()) {
    // Usuario Google: reautenticar directamente con popup, sin modal de contraseña
    const btn = document.getElementById('btn-google-reauth');
    document.getElementById('reauth-seccion-pass').style.display    = 'none';
    document.getElementById('reauth-seccion-google').style.display  = 'block';
  } else {
    document.getElementById('reauth-seccion-pass').style.display    = 'block';
    document.getElementById('reauth-seccion-google').style.display  = 'none';
  }

  document.getElementById('reauth-password').value        = '';
  document.getElementById('alert-reauth').innerHTML       = '';
  abrirModal('modal-reauth');
}

async function _ejecutarAccion() {
  cerrarModal('modal-reauth');
  await _accionTrasClave?.();
  _accionTrasClave = null;
  _modalOrigen     = null;
}

function bindModalReauth() {
  // Confirmar con contraseña
  document.getElementById('btn-confirmar-reauth')
    ?.addEventListener('click', async () => {
      const btn  = document.getElementById('btn-confirmar-reauth');
      const pass = document.getElementById('reauth-password').value;
      if (!pass) {
        mostrarAlerta('alert-reauth', 'Ingresa tu contraseña.', 'error');
        return;
      }
      btn.disabled = true; btn.textContent = 'Verificando...';
      const res = await reautenticarAdmin(pass);
      btn.disabled = false; btn.textContent = 'Confirmar';

      if (!res.ok) {
        mostrarAlerta('alert-reauth', res.error, 'error');
        return;
      }
      await _ejecutarAccion();
    });

  // Confirmar con Google
  document.getElementById('btn-google-reauth')
    ?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-google-reauth');
      btn.disabled = true; btn.textContent = 'Abriendo Google...';
      const res = await reautenticarAdminGoogle();
      btn.disabled = false; btn.textContent = 'Verificar con Google';

      if (!res.ok) {
        if (res.error) mostrarAlerta('alert-reauth', res.error, 'error');
        return;
      }
      await _ejecutarAccion();
    });
}

// ══════════════════════════════════════════════════════════
// CAMBIAR ROL
// ══════════════════════════════════════════════════════════
window.abrirCambioRol = function(uid, rolActual, nombre) {
  uidObjetivo = uid;
  document.getElementById('cambio-rol-nombre').textContent = nombre;
  document.getElementById('nuevo-rol-select').value = rolActual;
  document.getElementById('alert-cambio-rol').innerHTML = '';
  abrirModal('modal-cambio-rol');
};

function bindModalCambioRol() {
  document.getElementById('btn-confirmar-rol')
    ?.addEventListener('click', () => {
      const nuevoRol = document.getElementById('nuevo-rol-select').value;
      pedirClave(async () => {
        const res = await cambiarRol(uidObjetivo, nuevoRol);
        if (res.ok) {
          mostrarAlerta('alert-global', 'Rol actualizado correctamente.', 'success');
          cerrarModal('modal-cambio-rol');
          await cargarTablaUsuarios();
        } else {
          mostrarAlerta('alert-cambio-rol', res.error, 'error');
        }
      }, 'modal-cambio-rol');
    });
}

// ══════════════════════════════════════════════════════════
// CAMBIAR CONTRASEÑA
// ══════════════════════════════════════════════════════════
window.abrirCambioPass = function(uid, nombre) {
  uidObjetivo = uid;
  document.getElementById('cambio-pass-nombre').textContent = nombre;
  document.getElementById('nueva-password').value = '';
  document.getElementById('alert-cambio-pass').innerHTML = '';
  abrirModal('modal-cambio-pass');
};

function bindModalCambioPass() {
  document.getElementById('btn-confirmar-pass')
    ?.addEventListener('click', () => {
      const nuevaPass = document.getElementById('nueva-password').value;
      if (!nuevaPass || nuevaPass.length < 6) {
        mostrarAlerta('alert-cambio-pass', 'Mínimo 6 caracteres.', 'error');
        return;
      }
      pedirClave(async () => {
        const res = await forzarCambioPassword(uidObjetivo, nuevaPass);
        if (res.ok) {
          mostrarAlerta('alert-global', 'Contraseña actualizada. El usuario deberá iniciar sesión de nuevo.', 'success');
          cerrarModal('modal-cambio-pass');
        } else {
          mostrarAlerta('alert-cambio-pass', res.error, 'error');
        }
      }, 'modal-cambio-pass');
    });
}

// ══════════════════════════════════════════════════════════
// TOGGLE ACTIVO / INACTIVO
// ══════════════════════════════════════════════════════════
window.confirmarToggle = function(uid, activoActual, nombre) {
  const accion = activoActual === 'true' ? 'desactivar' : 'activar';
  if (!confirm(`¿${accion.charAt(0).toUpperCase() + accion.slice(1)} a ${nombre}?`)) return;
  pedirClave(async () => {
    const res = await toggleActivoUsuario(uid, activoActual === 'true');
    if (res.ok) {
      mostrarAlerta('alert-global',
        `Usuario ${res.nuevoEstado ? 'activado' : 'desactivado'} correctamente.`, 'success');
      await cargarTablaUsuarios();
    }
  });
};

// ══════════════════════════════════════════════════════════
// ELIMINAR USUARIO
// ══════════════════════════════════════════════════════════
window.confirmarEliminar = function(uid, nombre) {
  if (!confirm(`¿Eliminar a ${nombre}? Esta acción desactiva el acceso permanentemente.`)) return;
  pedirClave(async () => {
    const res = await eliminarUsuario(uid);
    if (res.ok) {
      mostrarAlerta('alert-global', `${nombre} eliminado del sistema.`, 'success');
      await cargarTablaUsuarios();
    }
  });
};

// ══════════════════════════════════════════════════════════
// LOGOUT
// ══════════════════════════════════════════════════════════
function bindLogout() {
  document.getElementById('btn-logout')
    ?.addEventListener('click', async () => {
      await logout();
      sessionStorage.clear();
      window.location.replace('/index.html');
    });
}