// firebase.js — Archivo de conexión principal
// Proyecto: Quiromasajes | quiromasajes-753c1

import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDAbqMBBb7-zXYn-RKDGE16vLi-zeOEJLo",
  authDomain: "quiromasajes-753c1.firebaseapp.com",
  projectId: "quiromasajes-753c1",
  storageBucket: "quiromasajes-753c1.firebasestorage.app",
  messagingSenderId: "663937519041",
  appId: "1:663937519041:web:23fce6ce0500dabb7d3340",
  measurementId: "G-MB2VCYYYRZ"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);

// Exportar servicios que usarás en toda la app
export const db = getFirestore(app);   // Base de datos Firestore
export const auth = getAuth(app);      // Autenticación
export default app;
