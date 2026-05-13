// js/index/validators.js

export function validarCampos(email, password) {
  if (!email || !password) {
    return "Por favor completa todos los campos.";
  }

  if (!email.includes("@")) {
    return "Correo inválido.";
  }

  return null;
}