/**
 * inv-config.js
 * Firebase + LIFF 設定
 */
const INV_CONFIG = {
  LIFF_ID: '2009084941-vbH7G70A',
  FIREBASE: {
    apiKey: "AIzaSyA5TzRM_7XHaD8iQlrr3jZXrtXc-a5RXkE",
    authDomain: "fc-football-6c8dc.firebaseapp.com",
    projectId: "fc-football-6c8dc",
    storageBucket: "fc-football-6c8dc.firebasestorage.app",
    messagingSenderId: "468419387978",
    appId: "1:468419387978:web:7975c83c9ce7eb60d2bcb3",
  },
};

// 初始化 Firebase（若尚未初始化）
if (!firebase.apps.length) {
  firebase.initializeApp(INV_CONFIG.FIREBASE);
}
const db = firebase.firestore();
// LINE WebView 的 WebSocket 常被擋，強制用 Long Polling 確保連線穩定
try { db.settings({ experimentalForceLongPolling: true, useFetchStreams: false }); } catch (_) {}
const auth = firebase.auth();
