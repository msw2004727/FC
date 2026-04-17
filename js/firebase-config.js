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
const firebaseStorageConfig = {
  uploadBucket: "fc-football-6c8dc-asia-east1",
};

let db, storage, uploadStorage, auth;

// ─── Firebase Auth 狀態恢復追蹤 ───
// Firebase Auth 從 indexedDB/localStorage 恢復登入狀態是非同步的，
// 必須等 onAuthStateChanged 首次觸發後才能信賴 auth.currentUser。
let _firebaseAuthReady = false;
let _firebaseAuthReadyResolve;
const _firebaseAuthReadyPromise = new Promise(resolve => {
  _firebaseAuthReadyResolve = resolve;
});

// ─── WebSocket 降級偵測 ───
const _WS_BLOCKED_KEY = 'shub_ws_blocked';
const _WS_BLOCKED_SESSION_KEY = 'shub_ws_blocked_tab';
const _WS_BLOCKED_TTL = 10 * 60 * 1000; // current-tab fallback only

/** 檢查 localStorage 標記：WebSocket 是否曾被擋 */
function _isWsBlocked() {
  try { localStorage.removeItem(_WS_BLOCKED_KEY); } catch (e) { /* clear legacy cross-tab marker */ }
  try {
    const ts = parseInt(sessionStorage.getItem(_WS_BLOCKED_SESSION_KEY) || '0', 10);
    if (!ts) return false;
    if (Date.now() - ts > _WS_BLOCKED_TTL) {
      sessionStorage.removeItem(_WS_BLOCKED_SESSION_KEY);
      return false; // 標記已過期，重新偵測
    }
    return true;
  } catch (e) { return false; }
}

/** 標記 WebSocket 被擋（寫入時間戳） */
function _markWsBlocked() {
  try { sessionStorage.setItem(_WS_BLOCKED_SESSION_KEY, Date.now().toString()); } catch (e) { /* ignore */ }
}

function _clearWsBlocked() {
  try { sessionStorage.removeItem(_WS_BLOCKED_SESSION_KEY); } catch (e) { /* ignore */ }
}

function _normalizeStorageBucketUrl(bucket) {
  if (typeof bucket !== 'string') return '';
  const trimmed = bucket.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return trimmed.startsWith('gs://') ? trimmed : `gs://${trimmed}`;
}

/** 初始化 Firebase App — CDN SDK 載入後呼叫 */
function initFirebaseApp() {
  if (db) return true; // 已初始化
  if (typeof firebase === 'undefined') return false;
  try {
    if (!firebase.apps || firebase.apps.length === 0) {
      firebase.initializeApp(firebaseConfig);
    }
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

    storage = (typeof firebase.storage === 'function') ? firebase.storage() : null;
    if (!storage) {
      console.warn('[Firebase] Storage SDK not loaded; storage features disabled.');
      uploadStorage = null;
      window._firebaseDefaultStorageBucket = '';
      window._firebaseUploadStorageBucket = '';
    } else {
      const defaultBucketUrl = _normalizeStorageBucketUrl(firebaseConfig.storageBucket);
      const uploadBucketUrl = _normalizeStorageBucketUrl(firebaseStorageConfig.uploadBucket);
      window._firebaseDefaultStorageBucket = defaultBucketUrl;
      window._firebaseUploadStorageBucket = uploadBucketUrl || defaultBucketUrl;

      if (uploadBucketUrl && uploadBucketUrl !== defaultBucketUrl) {
        try {
          uploadStorage = firebase.app().storage(uploadBucketUrl);
          console.log('[Firebase] Upload bucket ready:', uploadBucketUrl);
        } catch (err) {
          uploadStorage = storage;
          window._firebaseUploadStorageBucket = defaultBucketUrl;
          console.error('[Firebase] Upload bucket init failed, fallback to default bucket:', err.message);
        }
      } else {
        uploadStorage = storage;
      }
    }
    auth = firebase.auth();

    // 監聽 Auth 狀態恢復（首次觸發代表 persistence 已讀取完成）
    auth.onAuthStateChanged(user => {
      if (!_firebaseAuthReady) {
        _firebaseAuthReady = true;
        _firebaseAuthReadyResolve(user);
        console.log('[Firebase] Auth 狀態已恢復:', user ? ('uid=' + user.uid) : '未登入');
      }
    });

    // Firestore 離線持久化（IndexedDB）
    // 已知問題：Firebase 10.14.1 compat 在 LINE WebView 中可能觸發
    // "INTERNAL ASSERTION FAILED" — 用 try-catch 包裹防止影響啟動流程
    // synchronizeTabs: false — 單分頁模式，避免多 tab leader election 競爭造成權限加載卡住
    // 第一個 tab 拿 IndexedDB 快取，後續 tab 自動走 memory（SDK 自動降級，有 catch handle）
    try {
      db.enablePersistence({ synchronizeTabs: false }).catch(err => {
        if (err.code === 'failed-precondition') {
          console.warn('[Firestore] 多個分頁開啟，此分頁無離線快取（設計如此，不影響線上功能）');
        } else if (err.code === 'unimplemented') {
          console.warn('[Firestore] 此瀏覽器不支援離線持久化');
        } else {
          console.warn('[Firestore] enablePersistence 失敗:', err.code || '', err.message || err);
        }
      });
    } catch (persistErr) {
      // Firebase SDK 內部 assertion failure — 放棄離線持久化，不影響線上功能
      console.warn('[Firestore] enablePersistence 同步例外（已降級為無離線快取）:', persistErr.message || persistErr);
    }
    console.log('[Firebase] App 初始化成功');
    return true;
  } catch (e) {
    console.error('[Firebase] 初始化失敗:', e.message);
    return false;
  }
}

// 嘗試立即初始化（CDN 若已被瀏覽器快取則可能已可用）
initFirebaseApp();
