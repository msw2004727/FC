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

// Initialize Firebase（支援 CDN 動態載入：SDK 可能在此腳本之後才載入）
let db, storage, auth;

/** 初始化 Firebase App — CDN SDK 載入後呼叫 */
function initFirebaseApp() {
  if (db) return true; // 已初始化
  if (typeof firebase === 'undefined') return false;
  try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    // 強制使用長輪詢模式，避免 WebChannel 被廣告阻擋器/防火牆攔截導致 onSnapshot 失效
    db.settings({
      experimentalForceLongPolling: true,
      useFetchStreams: false,
    });
    storage = firebase.storage();
    auth = firebase.auth();
    db.enablePersistence({ synchronizeTabs: true }).catch(err => {
      if (err.code === 'failed-precondition') {
        console.warn('[Firestore] 多個分頁開啟，僅一個可啟用離線快取');
      } else if (err.code === 'unimplemented') {
        console.warn('[Firestore] 此瀏覽器不支援離線持久化');
      }
    });
    console.log('[Firebase] App 初始化成功');
    return true;
  } catch (e) {
    console.error('[Firebase] 初始化失敗:', e.message);
    return false;
  }
}

// 嘗試立即初始化（CDN 若已被瀏覽器快取則可能已可用）
initFirebaseApp();
