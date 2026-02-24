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

// ─── WebSocket 降級偵測 ───
const _WS_BLOCKED_KEY = 'shub_ws_blocked';
const _WS_BLOCKED_TTL = 24 * 60 * 60 * 1000; // 24 小時後重新偵測

/** 檢查 localStorage 標記：WebSocket 是否曾被擋 */
function _isWsBlocked() {
  try {
    const ts = parseInt(localStorage.getItem(_WS_BLOCKED_KEY) || '0', 10);
    if (!ts) return false;
    if (Date.now() - ts > _WS_BLOCKED_TTL) {
      localStorage.removeItem(_WS_BLOCKED_KEY);
      return false; // 標記已過期，重新偵測
    }
    return true;
  } catch (e) { return false; }
}

/** 標記 WebSocket 被擋（寫入時間戳） */
function _markWsBlocked() {
  try { localStorage.setItem(_WS_BLOCKED_KEY, Date.now().toString()); } catch (e) { /* ignore */ }
}

/** 初始化 Firebase App — CDN SDK 載入後呼叫 */
function initFirebaseApp() {
  if (db) return true; // 已初始化
  if (typeof firebase === 'undefined') return false;
  try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();

    // WebSocket 降級策略：預設用 WebSocket，被擋過則自動切回長輪詢
    const useLongPolling = _isWsBlocked();
    if (useLongPolling) {
      db.settings({
        experimentalForceLongPolling: true,
        useFetchStreams: false,
      });
      console.log('[Firebase] WebSocket 曾被擋，使用長輪詢模式');
    } else {
      console.log('[Firebase] 使用 WebSocket 模式');
    }
    window._firestoreUsingLongPolling = useLongPolling;

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
