// js/index/ui.js

export function mostrarError(mensaje) {
  const error = document.getElementById("error-msg");
  error.textContent = mensaje;
  error.style.display = "block";
}

export function limpiarError() {
  const error = document.getElementById("error-msg");
  error.textContent = "";
  error.style.display = "none";
}

export function bloquearBoton(btn) {
  btn.disabled = true;
  btn.textContent = "Ingresando...";
}

export function desbloquearBoton(btn) {
  btn.disabled = false;
  btn.textContent = "Ingresar";
}

export function resaltarCampos() {
  document.getElementById('email').style.borderColor = '#e74c3c';
  document.getElementById('password').style.borderColor = '#e74c3c';
}

export function resetearCampos() {
  document.querySelectorAll('.input-text').forEach(input => {
    input.addEventListener('input', () => {
      input.style.borderColor = '#d0d5da';
    });
  });
}