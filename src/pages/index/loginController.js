// src/pages/index/loginController.js

import { login, loginConGoogle }  from "../../core/authService.js";
import { redirigirPorRol }        from "../../core/router.js";       // ← Paso 2
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

      redirigirPorRol(res.usuario);   // ← era: window.location.href = "./dashboard.html"

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

      redirigirPorRol(res.usuario);   // ← era: window.location.href = "./dashboard.html"

    } catch (err) {
      mostrarError("Error al iniciar con Google. Intenta de nuevo.");
      console.error(err);
    } finally {
      btnGoogle.disabled    = false;
      btnGoogle.textContent = "Continuar con Google";
    }
  });
}
