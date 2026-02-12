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

// Initialize Firebase（安全包裝：SDK 未載入時不會崩潰）
let db, storage, auth;
try {
  if (typeof firebase === 'undefined') throw new Error('Firebase SDK 未載入');
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  storage = firebase.storage();
  auth = firebase.auth();

  // 啟用 Firestore 離線持久化（減少重複讀取計費）
  db.enablePersistence({ synchronizeTabs: true })
    .catch(err => {
      if (err.code === 'failed-precondition') {
        console.warn('[Firestore] 多個分頁開啟，僅一個可啟用離線快取');
      } else if (err.code === 'unimplemented') {
        console.warn('[Firestore] 此瀏覽器不支援離線持久化');
      }
    });
} catch (e) {
  console.error('[Firebase] 初始化失敗:', e.message);
  // db/storage/auth 維持 undefined，後續 FirebaseService.init() 會 catch 並走降級流程
}
