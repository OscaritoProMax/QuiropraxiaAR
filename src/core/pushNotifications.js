// src/core/pushNotifications.js — Registro de notificaciones push (FCM vía Capacitor)
// Solo tiene efecto cuando la app corre empaquetada en Android/iOS (Capacitor nativo).
// En el navegador web es un no-op silencioso.

import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { doc, setDoc } from 'firebase/firestore';
import { db } from './firebase.js';

let yaInicializado = false;

export async function initPushNotifications(usuario) {
  if (!Capacitor.isNativePlatform()) return;
  if (yaInicializado) return;

  const uid = usuario?.id || usuario?.uid;
  if (!uid) return;

  try {
    let permiso = await PushNotifications.checkPermissions();
    if (permiso.receive !== 'granted') {
      permiso = await PushNotifications.requestPermissions();
    }
    if (permiso.receive !== 'granted') {
      console.warn('Permiso de notificaciones push denegado.');
      return;
    }

    yaInicializado = true;

    await PushNotifications.register();

    PushNotifications.addListener('registration', (token) => {
      setDoc(doc(db, 'usuarios', uid), {
        fcmToken:            token.value,
        fcmTokenActualizado: new Date().toISOString(),
      }, { merge: true }).catch((err) => console.error('Error guardando token FCM:', err.code || err.message));
    });

    PushNotifications.addListener('registrationError', (err) => {
      console.error('Error de registro push:', err.code || err.message || err);
    });

    PushNotifications.addListener('pushNotificationReceived', () => {
      console.log('Notificación push recibida en primer plano.');
    });

    PushNotifications.addListener('pushNotificationActionPerformed', () => {
      console.log('Notificación push tocada.');
    });
  } catch (error) {
    console.error('Error inicializando push notifications:', error.code || error.message);
  }
}
