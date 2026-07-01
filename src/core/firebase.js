// firebase.js — Archivo de conexión principal
// Proyecto: Quiromasajes | quiromasajes-753c1

import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, inMemoryPersistence, setPersistence,
         indexedDBLocalPersistence, browserLocalPersistence } from "firebase/auth";

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId:     import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);

// Exportar servicios que usarás en toda la app
export const db = getFirestore(app);   // Base de datos Firestore
export const auth = getAuth(app);      // Autenticación
export default app;

// ── Persistencia local de la sesión ───────────────────────
// La sesión queda guardada en el dispositivo para NO pedir credenciales
// cada vez que se abre la app. En el WebView de Android IndexedDB es la
// más fiable; si no está disponible, caemos a localStorage.
setPersistence(auth, indexedDBLocalPersistence)
  .catch(() => setPersistence(auth, browserLocalPersistence))
  .catch(() => {});

// ── Instancia secundaria de Auth — SOLO para crear usuarios nuevos ──
// createUserWithEmailAndPassword() inicia sesión automáticamente como
// el usuario recién creado en la instancia de Auth que se le pase. Si
// usáramos `auth` (la principal), el administrador perdería su sesión
// activa al crear cada usuario. Esta segunda app (mismo proyecto, mismo
// config) tiene su propia instancia de Auth en memoria (sin persistir
// en localStorage) para no pisar la sesión del admin en `auth`.
const secondaryApp = initializeApp(firebaseConfig, "secondary");
export const secondaryAuth = getAuth(secondaryApp);
setPersistence(secondaryAuth, inMemoryPersistence).catch(() => {});
