/* Required by Firebase Cloud Messaging for background/web push.
   Must sit at the site root (same folder as index.html) so its scope
   covers the whole app. Fill in the same Firebase config as backend.js. */

importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyANgaHIpu0gY_GLWFhyIc_z0WY_S59PY3M",
  authDomain: "website01-7e1e2.firebaseapp.com",
  projectId: "website01-7e1e2",
  messagingSenderId: "835136877236",
  appId: "1:835136877236:web:b7a4178f036d7ecc25dde1"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || "TaskFlow";
  const body = (payload.notification && payload.notification.body) || "New message";
  self.registration.showNotification(title, { body, icon: undefined });
});
