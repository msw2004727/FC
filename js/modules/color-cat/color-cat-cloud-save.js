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
    var localData = _loadLocal();
    var flCount = localData && localData.scene && localData.scene.flowers ? localData.scene.flowers.length : 0;
    alert('[CloudSave] 未登入，localStorage ' + (localData ? '有資料(花:' + flCount + ')' : '無資料'));
    return Promise.resolve(localData);
  }
  var ref = _ref('game', 'save');
  if (!ref) {
    var ld = _loadLocal();
    alert('[CloudSave] Firestore ref 取不到，localStorage ' + (ld ? '有資料' : '無資料'));
    return Promise.resolve(ld);
  }
  return ref.get().then(function(snap) {
    var local = _loadLocal();
    if (!snap.exists) {
      var fc = local && local.scene && local.scene.flowers ? local.scene.flowers.length : 0;
      alert('[CloudSave] Firestore 無資料，localStorage ' + (local ? '有資料(花:' + fc + ')' : '無資料'));
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
function init() {
  _destroyed = false;
  console.log(TAG, 'init');
  _autoTimer = setInterval(function() { if (_loggedIn()) saveToCloud(); }, AUTO_SAVE_MS);
  _boundVis = _onVisibility;
  _boundUnload = _onBeforeUnload;
  document.addEventListener('visibilitychange', _boundVis);
  window.addEventListener('beforeunload', _boundUnload);
}

function destroy() {
  _destroyed = true;
  console.log(TAG, 'destroy');
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
};

})();
