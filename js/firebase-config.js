/* ================================================
   SportHub — Firebase Configuration
   ================================================
   Firebase 客戶端 API Key 為公開識別碼，非機密資訊。
   安全性由 Firestore Security Rules 控制。
   ================================================ */

const firebaseConfig = {
  apiKey: "AIzaSyA5TzRM_7XHaD8iQlrr3jZXrtXc-a5RXkE",
  authDomain: "fc-football-6c8dc.firebaseapp.com",
  projectId: "fc-football-6c8dc",
  storageBucket: "fc-football-6c8dc.firebasestorage.app",
  messagingSenderId: "468419387978",
  appId: "1:468419387978:web:7975c83c9ce7eb60d2bcb3",
  measurementId: "G-2673ME04J7"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Global references
const db = firebase.firestore();
const storage = firebase.storage();
// const auth = firebase.auth();  // 啟用 LINE@ Auth 時取消註解
