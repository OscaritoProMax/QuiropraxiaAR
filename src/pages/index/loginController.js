// src/pages/index/loginController.js

import { login, loginConGoogle,
         getUsuarioPorId }        from "../../core/authService.js";
import { redirigirPorRol }        from "../../core/router.js";
import { auth }                   from "../../core/firebase.js";
import { onAuthStateChanged }     from "firebase/auth";
import {
  mostrarError,
  limpiarError,
  bloquearBoton,
  desbloquearBoton,
  resaltarCampos,
  resetearCampos
} from "./ui.js";
import { validarCampos } from "./validators.js";

export function initLogin() {
  const form      = document.getElementById("login-form");
  const btn       = document.getElementById("btn-login");
  const btnGoogle = document.getElementById("btn-google");

  resetearCampos();

  // ── Auto-login: si el dispositivo ya tiene una sesión válida guardada,
  //    entramos directo sin volver a pedir credenciales. ──────────────
  const splash       = document.getElementById("session-check");
  const ocultarSplash = () => { if (splash) splash.style.display = "none"; };
  const safety       = setTimeout(ocultarSplash, 5000); // por si algo falla

  const unsub = onAuthStateChanged(auth, async (fbUser) => {
    unsub();
    if (!fbUser) { clearTimeout(safety); ocultarSplash(); return; }
    try {
      const usuario = await getUsuarioPorId(fbUser.uid);
      if (usuario && usuario.activo) {
        await redirigirPorRol(usuario);   // dejamos el splash hasta navegar
        return;
      }
    } catch (_) { /* ignorar y mostrar login */ }
    clearTimeout(safety);
    ocultarSplash();
  });

  // ── Login con email y contraseña ──────────────────────
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    limpiarError();

    const email    = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    const errorValidacion = validarCampos(email, password);
    if (errorValidacion) {
      mostrarError(errorValidacion);
      return;
    }

    try {
      bloquearBoton(btn);
      const res = await login(email, password);

      if (!res.ok) {
        mostrarError(res.error);
        resaltarCampos();
        return;
      }

      // 💡 CORRECCIÓN CLAVE: Esperamos a que el router procese la redirección
      await redirigirPorRol(res.usuario);   

    } catch (err) {
      mostrarError("Error inesperado. Intenta de nuevo.");
      console.error(err);
    } finally {
      desbloquearBoton(btn);
    }
  });

  // ── Login con Google ───────────────────────────────────
  btnGoogle?.addEventListener("click", async () => {
    limpiarError();
    btnGoogle.disabled    = true;
    btnGoogle.textContent = "Conectando con Google...";

    try {
      const res = await loginConGoogle();

      if (!res.ok) {
        mostrarError(res.error);
        return;
      }

      // 💡 CORRECCIÓN CLAVE: Esperamos a que el router procese la redirección
      await redirigirPorRol(res.usuario);   

    } catch (err) {
      mostrarError("Error al iniciar con Google. Intenta de nuevo.");
      console.error(err);
    } finally {
      btnGoogle.disabled    = false;
      btnGoogle.textContent = "Continuar con Google";
    }
  });
}