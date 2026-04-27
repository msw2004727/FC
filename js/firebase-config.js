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
    //
    // synchronizeTabs: true — 多分頁共享 IndexedDB 快取，大幅減少 Firestore 讀取量
    // 歷史決策（詳見 docs/claude-memory.md 2026-04-21 / 2026-04-27 條目）：
    //   - 4/17 曾改為 false 消除「多 tab 權限加載卡住」bug（commit 6e0daede）
    //   - 但 4/18 讀取量爆增至 468 萬/天（+50%），月費上升至 NT$753（4 月 21 天實績）
    //   - 4/21 回滾為 true；原 bug 防護改由 multi-tab-guard.js 警告 + 關閉分頁按鈕承擔
    //   - 4/27 復發：iOS WKWebView 進 page-admin-users 後 1-2 秒被 native 強制 reload、
    //     伴隨強制深色主題 + 多分頁警告（IndexedDB 慢 + leader election 不穩）
    //   - 改為 iOS-only false：iOS 改用 memory cache（無離線快取代價）、桌機/Android 保留
    //     synchronizeTabs: true（保留 50% reads 節省）
    const _isIOSWebKit = typeof navigator !== 'undefined'
      && /iPad|iPhone|iPod/.test(navigator.userAgent || '');
    try {
      db.enablePersistence({ synchronizeTabs: !_isIOSWebKit }).catch(err => {
        if (err.code === 'failed-precondition') {
          // 極少數情況：多 tab leader election 競爭失敗 → 此 tab 降級為 memory cache
          // 若此時原「權限加載卡住」bug 復發，請回報並考慮改回 synchronizeTabs: false
          console.warn('[Firestore] 多 tab leader 競爭失敗，此分頁降級為 memory cache（不影響線上功能；若遇權限加載卡住請回報）');
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
