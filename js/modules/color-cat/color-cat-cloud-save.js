/* ================================================
   ColorCat — Firestore 雲端存讀檔模組
   負責：登入時自動同步遊戲存檔至 Firestore，
         離線時 fallback 至 localStorage
   依賴：firebase, ColorCatStats, ColorCatProfile,
         ColorCatBall, ColorCatScene, ColorCatCharacter
   ================================================ */
;(function() {

var SAVE_VERSION = 1;
var AUTO_SAVE_MS = 5 * 60 * 1000;
var DEBOUNCE_MS  = 3000;
var TAG = '[CloudSave]';
var LS_KEY = 'colorCatCloudCache';
var _autoTimer = null, _debounceTimer = null, _destroyed = false;
var _boundVis = null, _boundUnload = null;

// ── 雙開偵測（localStorage 心跳） ──────────────
var HB_KEY = 'gg_session_heartbeat';
var HB_INTERVAL = 2000;   // 每 2 秒寫一次心跳
var HB_TIMEOUT  = 5000;   // 超過 5 秒未更新視為已離開
var _hbTimer = null;
var _sessionId = Date.now() + '_' + Math.random().toString(36).slice(2, 8);
var _isDuplicate = false;
var _boundStorage = null;

function _writeHeartbeat() {
  try {
    localStorage.setItem(HB_KEY, JSON.stringify({ sid: _sessionId, ts: Date.now() }));
  } catch (e) { /**/ }
}

function _checkDuplicate() {
  try {
    var raw = localStorage.getItem(HB_KEY);
    if (!raw) return false;
    var hb = JSON.parse(raw);
    // 不同 session 且心跳尚未超時 → 有另一個分頁在跑
    return hb.sid !== _sessionId && (Date.now() - hb.ts) < HB_TIMEOUT;
  } catch (e) { return false; }
}

/** 監聽其他分頁搶佔：新分頁寫入心跳時，舊分頁收到 storage 事件 */
function _onStorageEvent(e) {
  if (e.key !== HB_KEY || _isDuplicate) return;
  try {
    var hb = JSON.parse(e.newValue);
    if (hb && hb.sid !== _sessionId) {
      // 被新分頁搶佔 → 自己變成舊分頁，暫停遊戲
      _isDuplicate = true;
      _stopHeartbeat();
      destroy();
      if (window.ColorCatScene) ColorCatScene.destroy();
      _showDuplicateOverlay();
    }
  } catch (ex) { /**/ }
}

function _startHeartbeat() {
  _writeHeartbeat();
  _hbTimer = setInterval(_writeHeartbeat, HB_INTERVAL);
  _boundStorage = _onStorageEvent;
  window.addEventListener('storage', _boundStorage);
}

function _stopHeartbeat() {
  if (_hbTimer) { clearInterval(_hbTimer); _hbTimer = null; }
  if (_boundStorage) { window.removeEventListener('storage', _boundStorage); _boundStorage = null; }
}

function _clearHeartbeat() {
  _stopHeartbeat();
  try {
    var raw = localStorage.getItem(HB_KEY);
    if (raw) {
      var hb = JSON.parse(raw);
      if (hb.sid === _sessionId) localStorage.removeItem(HB_KEY);
    }
  } catch (e) { /**/ }
}

function _showDuplicateOverlay() {
  if (document.getElementById('gg-dup-overlay')) return;
  var ov = document.createElement('div');
  ov.id = 'gg-dup-overlay';
  var dark = document.documentElement.getAttribute('data-theme') === 'dark';
  ov.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:10002;'
    + 'display:flex;align-items:center;justify-content:center;'
    + 'background:' + (dark ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.6)');
  var box = document.createElement('div');
  box.style.cssText = 'background:' + (dark ? '#1e1e2e' : '#fff')
    + ';color:' + (dark ? '#e0e0e0' : '#222')
    + ';border-radius:12px;padding:28px 24px;max-width:320px;text-align:center;'
    + 'font-family:sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.3)';
  box.innerHTML = '<div style="font-size:18px;font-weight:bold;margin-bottom:10px">'
    + '\u904a\u6232\u5df2\u5728\u5176\u4ed6\u5206\u9801\u904b\u884c</div>'
    + '<div style="font-size:14px;color:#888;margin-bottom:16px">'
    + '\u8acb\u95dc\u9589\u6b64\u5206\u9801\uff0c\u6216\u9ede\u64ca\u4e0b\u65b9\u6309\u9215\u5728\u6b64\u5206\u9801\u7e7c\u7e8c</div>'
    + '<button id="gg-dup-takeover" style="padding:10px 24px;border-radius:8px;border:none;'
    + 'background:#4a7dff;color:#fff;font-size:15px;cursor:pointer">'
    + '\u5728\u6b64\u5206\u9801\u7e7c\u7e8c</button>';
  ov.appendChild(box);
  document.body.appendChild(ov);
  document.getElementById('gg-dup-takeover').addEventListener('click', function() {
    ov.parentNode.removeChild(ov);
    _isDuplicate = false;
    // 搶回主控權：重新寫心跳 + 重新初始化場景
    _startHeartbeat();
    if (window.ColorCatScene) {
      ColorCatScene.initInteractive('profile-slot-banner');
    }
  });
}

function _uid() {
  try { var u = firebase.auth().currentUser; return u ? u.uid : null; }
  catch (e) { return null; }
}
function _loggedIn() { return !!_uid(); }
function _db() {
  try { return firebase.firestore(); } catch (e) { return null; }
}
function _ref(sub, doc) {
  var uid = _uid(); if (!uid) return null;
  var d = _db(); if (!d) return null;
  return d.collection('users').doc(uid).collection(sub).doc(doc);
}
function _ts() { return firebase.firestore.FieldValue.serverTimestamp(); }

// ── 組裝存檔 ──────────────────────────────────
function _buildSaveDoc(isCreate) {
  var S = window.ColorCatStats, P = window.ColorCatProfile;
  var Ch = window.ColorCatCharacter, B = window.ColorCatBall;
  var Sc = window.ColorCatScene && window.ColorCatScene._;
  var r = S ? S.runtime : {}, b = S ? S.base : {}, st = P ? P.getStats() : {};
  var doc = {
    version: SAVE_VERSION,
    character: {
      skin: Ch ? Ch.getSkin() : (b.skin || 'whiteCat'),
      customName: b.name || '', level: b.level || 1,
      exp: b.exp || 0, expToNext: b.expToNext || 100,
      stats: { stamina: st.stamina || 100, agility: st.agility || 10,
        speed: st.speed || 10, luck: st.luck || 10,
        constitution: st.constitution || 10, intelligence: st.intelligence || 10 },
      mbti: P ? P.getMBTI() : (r.mbti || '----'),
      staminaCurrent: S ? S.stamina.current : 100, weakLevel: r.weakLevel || 0,
    },
    lifetime: {
      totalActions: r.totalActions || 0, totalKicks: r.totalKicks || 0,
      totalSleeps: r.totalSleeps || 0, flowersRed: r.flowersRed || 0,
      flowersGold: r.flowersGold || 0, enemyKills: r.enemyKills || 0,
      enemyBossKills: r.enemyBossKills || 0, playerKills: r.playerKills || 0,
      deaths: r.deaths || 0, visitsMade: r.visitsMade || 0,
      visitsReceived: r.visitsReceived || 0, tradesCompleted: r.tradesCompleted || 0,
      pvpWins: r.pvpWins || 0, pvpLosses: r.pvpLosses || 0,
    },
    scene: {
      flowers: (Sc && Sc.exportFlowers) ? Sc.exportFlowers() : [],
      ball: (B && B.exportState) ? B.exportState() : { x: 0, y: 0 },
      graves: (Sc && Sc.exportGraves) ? Sc.exportGraves() : [],
      grass: (Sc && Sc.exportGrass) ? Sc.exportGrass() : [],
      goldCounter: r.goldCounter || 0, nextGoldAt: r.nextGoldAt || 0,
      weather: r.weather || { type: 'clear', intensity: 0, changedAt: null },
    },
    savedAt: _ts(), playTimeMinutes: r.playTimeMinutes || 0,
  };
  if (isCreate) doc.createdAt = _ts();
  return doc;
}

function _buildProfileDoc() {
  var P = window.ColorCatProfile, S = window.ColorCatStats;
  var Ch = window.ColorCatCharacter, b = S ? S.base : {};
  var user = firebase.auth().currentUser;
  return {
    displayName: user ? (user.displayName || '') : '',
    customName: b.name || '', skin: Ch ? Ch.getSkin() : (b.skin || 'whiteCat'),
    level: b.level || 1, mbti: P ? P.getMBTI() : '----',
    equipped: P ? P.getEquipped() : {},
    allowVisit: true, allowPvp: true, allowTrade: true,
    lastOnline: _ts(), status: 'online', updatedAt: _ts(),
  };
}

// ── 儲存 ──────────────────────────────────────
function _doSave() {
  if (_destroyed || !_loggedIn()) return Promise.resolve(false);
  var ref = _ref('game', 'save');
  if (!ref) {
    // Firestore 不可用時存 localStorage
    try {
      var doc = _buildSaveDoc(false);
      doc.savedAt = Date.now();
      localStorage.setItem(LS_KEY, JSON.stringify(doc));
    } catch (e) { /**/ }
    return Promise.resolve(false);
  }
  return ref.get().then(function(snap) {
    return ref.set(_buildSaveDoc(!snap.exists), { merge: true });
  }).then(function() {
    console.log(TAG, 'saved to Firestore');
    var pRef = _ref('gamePublic', 'profile');
    if (pRef) return pRef.set(_buildProfileDoc(), { merge: true });
  }).then(function() {
    console.log(TAG, 'public profile synced');
    return true;
  }).catch(function(err) {
    console.warn(TAG, 'save failed:', err);
    return false;
  });
}

function saveToCloud() {
  clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(_doSave, DEBOUNCE_MS);
}

// ── 載入 ──────────────────────────────────────
function _toMs(ts) { return ts && ts.toMillis ? ts.toMillis() : 0; }

function _loadLocal() {
  try {
    var raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    var d = JSON.parse(raw);
    return (d && typeof d === 'object' && d.version) ? d : null;
  } catch (e) { return null; }
}

function loadFromCloud() {
  // 未登入 → 嘗試 localStorage
  if (!_loggedIn()) {
    console.log(TAG, 'not logged in, trying localStorage');
    return Promise.resolve(_loadLocal());
  }
  var ref = _ref('game', 'save');
  if (!ref) return Promise.resolve(_loadLocal());
  return ref.get().then(function(snap) {
    var local = _loadLocal();
    if (!snap.exists) {
      console.log(TAG, 'no cloud save, using localStorage');
      return local;  // 可能是 null（全新用戶），也可能有上次暫存
    }
    var cloud = _migrate(snap.data());
    // 衝突解決：比較 savedAt，取較新者
    if (local && local.savedAt && local.savedAt > _toMs(cloud.savedAt)) {
      console.log(TAG, 'local is newer, using local');
      return local;
    }
    // 快取至 localStorage
    var cache = Object.assign({}, cloud);
    cache.savedAt = _toMs(cloud.savedAt) || Date.now();
    try { localStorage.setItem(LS_KEY, JSON.stringify(cache)); } catch (e) { /**/ }
    console.log(TAG, 'loaded from Firestore');
    return cloud;
  }).catch(function(err) {
    console.warn(TAG, 'load failed:', err);
    return _loadLocal();  // 網路錯誤時 fallback localStorage
  });
}

// ── 版本遷移 ─────────────────────────────────
function _migrate(data) {
  if (!data) return data;
  // future: if (data.version < 2) { ... }
  if ((data.version || 0) < SAVE_VERSION) data.version = SAVE_VERSION;
  return data;
}

// ── 事件 ──────────────────────────────────────
function _onVisibility() {
  if (document.visibilityState === 'hidden') _doSave();  // 切頁立即存，不 debounce
}
function _onBeforeUnload() {
  // beforeunload 中 async 操作不可靠，優先存 localStorage
  try {
    var doc = _buildSaveDoc(false);
    doc.savedAt = Date.now();
    var json = JSON.stringify(doc);
    localStorage.setItem(LS_KEY, json);
    console.log(TAG, 'beforeunload saved to localStorage, flowers:', (doc.scene && doc.scene.flowers) ? doc.scene.flowers.length : 0);
  } catch (e) {
    console.warn(TAG, 'beforeunload save error:', e);
  }
  // 嘗試寫 Firestore（可能來不及完成，但 localStorage 已保底）
  if (_loggedIn()) _doSave();
}

// ── 初始化 / 銷毀 ────────────────────────────

/**
 * 初始化雲端存檔 + 雙開偵測
 * @returns {boolean} true=正常啟動, false=偵測到雙開已阻擋
 */
function init() {
  _destroyed = false;
  _isDuplicate = false;
  console.log(TAG, 'init');

  // 雙開偵測
  if (_checkDuplicate()) {
    console.warn(TAG, 'duplicate tab detected');
    _isDuplicate = true;
    _showDuplicateOverlay();
    return false;
  }
  _startHeartbeat();

  _autoTimer = setInterval(function() { if (_loggedIn()) saveToCloud(); }, AUTO_SAVE_MS);
  _boundVis = _onVisibility;
  _boundUnload = _onBeforeUnload;
  document.addEventListener('visibilitychange', _boundVis);
  window.addEventListener('beforeunload', _boundUnload);
  return true;
}

function destroy() {
  _destroyed = true;
  console.log(TAG, 'destroy');
  _clearHeartbeat();
  clearInterval(_autoTimer); clearTimeout(_debounceTimer);
  _autoTimer = null; _debounceTimer = null;
  if (_boundVis) document.removeEventListener('visibilitychange', _boundVis);
  if (_boundUnload) window.removeEventListener('beforeunload', _boundUnload);
  _boundVis = null; _boundUnload = null;
}

// ── 公開 API ─────────────────────────────────
window.ColorCatCloudSave = {
  init: init, loadFromCloud: loadFromCloud, saveToCloud: saveToCloud,
  destroy: destroy, isLoggedIn: _loggedIn, getUid: _uid,
  isDuplicate: function() { return _isDuplicate; },
};

})();
