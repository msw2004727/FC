/**
 * inv-config.js
 * Firebase + LIFF 設定
 */
const INV_CONFIG = {
  LIFF_ID: 'YOUR_LIFF_ID', // 待替換
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
const auth = firebase.auth();
