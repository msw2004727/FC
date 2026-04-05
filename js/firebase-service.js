/* ================================================
   SportHub — Firebase Service (Cache-First Pattern)
   ================================================

   === Function Index ===
   L166:  _mapUserDoc(data, docId) — 用戶文件正規化
   L181:  _getLSKey / _setLSUidPrefix — localStorage key 管理
   L198:  _saveToLS / L227: _loadFromLS — 快取持久化
   L263:  _getEffectiveTTL / L273: _restoreCache — TTL + 快取還原
   L447:  _buildCollectionQuery — Firestore 查詢建構
   L540:  _startPageScopedRealtimeForPage — 頁面即時監聯
   L632:  ensureUserStatsLoaded / L653: getUserStatsCache — [LOCKED] 用戶統計
   L711:  _schedulePostInitWarmups — 初始化後預熱
   L797:  _syncCurrentUserFromUsersSnapshot — 當前用戶同步
   L864:  _watchRolePermissionsRealtime — 權限即時監聽
   L1012: getCachedDoc — 依 ID 取快取文件
   ================================================

   策略：
   1. init() 按需載入 Firestore 集合到 _cache
   2. _cache 結構與 render 方法一致
   3. 寫入操作：先更新 cache（同步），再寫 Firestore（背景）
   4. onSnapshot 監聽器即時同步遠端更新
   5. localStorage 持久化快取：returning user 秒開
   6. 懶載入：非首頁集合按需載入
   ================================================
   CRUD 操作已拆分至 firebase-crud.js（Object.assign 擴充）
   ================================================ */

// 移除 _docId（Firestore 不接受 undefined 值）
function _stripDocId(obj) {
  const { _docId, ...rest } = obj;
  return rest;
}

const FirebaseService = {

  // ─── 記憶體快取 ───
  _cache: {
    events: [],
    eventTemplates: [],
    tournaments: [],
    teams: [],
    shopItems: [],
    messages: [],
    leaderboard: [],
    standings: [],
    matches: [],
    trades: [],
    expLogs: [],
    teamExpLogs: [],
    operationLogs: [],
    banners: [],
    achievements: [],
    badges: [],
    adminUsers: [],
    permissions: [],
    attendanceRecords: [],
    activityRecords: [],
    registrations: [],
    announcements: [],
    floatingAds: [],
    popupAds: [],
    sponsors: [],
    siteThemes: [],
    gameConfigs: [],
    adminMessages: [],
    notifTemplates: [],
    userCorrections: [],
    newsArticles: [],
    rolePermissions: {},
    rolePermissionMeta: {},
    customRoles: [],
    currentUser: null,
  },

  _singleDocCache: {},  // { 'collection/docId': { ...data } }

  _listeners: [],
  _usersUnsub: null,
  _userListener: null,
  _onUserChanged: null,
  _initialized: false,
  _initInFlight: false,
  _messageListeners: [],
  _messageListenerResults: {},
  _messageVisibilityKey: '',
  _lazyLoaded: {},  // 記錄已懶載入的集合
  _bootCollectionLoadFailed: {},
  _persistDebounceTimer: null,
  _eventSlices: { active: [], terminal: [] },
  _authDependentWorkPromise: null,
  _authDependentWorkUid: null,
  _lastLoginAuditAtByUid: {},
  _postInitWarmupPromise: null,
  _registrationListenerKey: '',
  _pageScopedRealtimeListeners: {
    registrations: null,
    attendanceRecords: null,
    events: null,
  },
  _pageScopedRealtimeStartTimers: {},
  _collectionLoadedAt: {},
  _realtimeListenerStarted: {},  // 追蹤已啟動的延遲即時監聽器
  _registrationsFirstSnapshotReceived: false, // Fix A: 首次 snapshot 到達旗標
  _authPromise: null,            // Auth 並行 Promise
  _userStatsCache: { uid: null, activityRecords: null, attendanceRecords: null },
  _userAchievementProgress: [],  // Per-user achievement progress from subcollection
  _userAchievementProgressUid: null,

  // ─── localStorage 快取設定 ───
  _LS_PREFIX: 'shub_c_',
  _LS_TS_KEY: 'shub_cache_ts',
  _LS_TTL: 60 * 60 * 1000, // admin/super_admin 60 分鐘
  _LS_TTL_LONG: 24 * 60 * 60 * 1000, // 一般用戶 24 小時（隔夜仍可恢復快取）
  _visibilityRefreshDebounce: null, // visibilitychange 防抖 timer
  _snapshotReconnectAttempts: {},   // onSnapshot 重連計數
  _reconnectTimers: {},             // onSnapshot 重連 setTimeout ID
  _registrationsRevalidating: false, // 防止並行 revalidation 競爭
  _snapshotRenderTimer: null, // onSnapshot 渲染防抖 timer

  /**
   * onSnapshot 觸發的 UI 更新
   * - 用戶操作頁（detail / scan）：立即渲染，避免延遲感
   * - 背景頁（home / activities / my-activities）：500ms 防抖，減少連續渲染
   * @param {'registrations'|'events'|'attendance'} source - 觸發來源
   */
  _debouncedSnapshotRender(source) {
    if (typeof App === 'undefined') return;
    const page = App.currentPage;

    // 用戶操作頁：立即渲染
    if (page === 'page-activity-detail') {
      if (source === 'attendance') {
        // 簽到簽退只影響出席表格，不需整頁重渲染（避免 showPage 重置捲動位置）
        App._renderAttendanceTable?.(App._currentDetailEventId, 'detail-attendance-table');
        App._renderUnregTable?.(App._currentDetailEventId, 'detail-unreg-table');
        App._refreshRegistrationBadges?.(App._currentDetailEventId, 'detail-attendance-table')?.catch?.(() => {});
      } else {
        App.showEventDetail?.(App._currentDetailEventId);
      }
      return;
    }
    if (page === 'page-scan' && source === 'attendance') {
      App._renderScanResults?.();
      App._renderAttendanceSections?.();
      return;
    }

    // attendance 變更不影響列表頁，跳過
    if (source === 'attendance') return;

    // messages 變更：立即更新徽章 + 訊息列表
    if (source === 'messages') {
      App.updateNotifBadge?.();
      if (page === 'page-messages') App.renderMessageList?.();
      return;
    }

    // 背景頁：500ms 防抖 + 頂層 scrollTop 保護
    clearTimeout(this._snapshotRenderTimer);
    this._snapshotRenderTimer = setTimeout(() => {
      if (typeof App === 'undefined') return;
      var _s = window.scrollY || window.pageYOffset || 0;
      var p = App.currentPage;
      if (p === 'page-home') App.renderHotEvents?.();
      if (p === 'page-activities') App.renderActivityList?.();
      if (p === 'page-my-activities') App.renderMyActivities?.();
      if (_s > 0) requestAnimationFrame(function() { window.scrollTo(0, _s); });
    }, 500);
  },

  /** 將 users 集合文件映射為 adminUsers 格式（補齊 name / uid / lastActive） */
  _mapUserDoc(data, docId) {
    return {
      ...data,
      name: data.displayName || data.name || '未知',
      uid: data.uid || data.lineUserId || docId,
      lastActive: data.lastLogin || data.lastActive || null,
      _docId: docId,
    };
  },

  // ════════════════════════════════
  //  localStorage 快取層
  // ════════════════════════════════

  /** 取得當前 UID 前綴的 localStorage key（RC8：跨用戶隔離） */
  _getLSKey(name) {
    const uid = this._lsUidPrefix || '';
    return uid ? `shub_c_${uid}_${name}` : `${this._LS_PREFIX}${name}`;
  },

  /** 取得當前 UID 前綴的 TS key */
  _getLSTsKey() {
    const uid = this._lsUidPrefix || '';
    return uid ? `shub_ts_${uid}` : this._LS_TS_KEY;
  },

  /** 設定 localStorage UID 前綴（登入後呼叫） */
  _setLSUidPrefix(uid) {
    this._lsUidPrefix = uid || '';
  },

  /** 儲存集合到 localStorage */
  _saveToLS(name, data) {
    try {
      const json = JSON.stringify(data);
      // 單一集合超過 500KB 就不存（避免 localStorage 爆掉）
      if (json.length > 512000) return;
      try {
        localStorage.setItem(this._getLSKey(name), json);
      } catch (e) {
        // quota exceeded — 嘗試淘汰非 boot 集合騰空間
        const expendable = [
          'newsArticles', 'gameConfigs',
          'operationLogs', 'expLogs', 'teamExpLogs',
          'errorLogs',
        ];
        for (const lp of expendable) {
          if (lp === name) continue; // 不淘汰自己
          try {
            localStorage.removeItem(this._getLSKey(lp));
            localStorage.setItem(this._getLSKey(name), json);
            console.warn(`[LS] Evicted "${lp}" to save "${name}"`);
            return;
          } catch (_) { continue; }
        }
        console.warn(`[LS] quota exceeded for "${name}" (${(json.length / 1024).toFixed(1)}KB), eviction failed`);
      }
    } catch (e) { /* JSON.stringify 失敗 — 忽略，不中斷其他集合 */ }
  },

  /** 從 localStorage 讀取集合 */
  _loadFromLS(name) {
    try {
      const raw = localStorage.getItem(this._getLSKey(name));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },

  /** 延遲 30s 批次寫入（onSnapshot 高頻觸發時避免重複 I/O） */
  _debouncedPersistCache() {
    clearTimeout(this._persistDebounceTimer);
    this._persistDebounceTimer = setTimeout(() => this._persistCache(), 30000);
  },

  /**
   * 快取更新通知機制（SWR 核心）
   * 每當集合資料從 Firestore 到達並寫入 _cache 後呼叫此函式，
   * 觸發：(1) 延遲持久化 localStorage (2) 選擇性 UI 重渲染
   */
  _notifyCacheUpdated(collectionName) {
    this._debouncedPersistCache();
    // 選擇性重渲染：根據集合名稱只更新相關 UI
    clearTimeout(this._cacheUpdateRenderTimers?.[collectionName]);
    if (!this._cacheUpdateRenderTimers) this._cacheUpdateRenderTimers = {};
    this._cacheUpdateRenderTimers[collectionName] = setTimeout(() => {
      if (typeof App === 'undefined') return;
      var _s = window.scrollY || window.pageYOffset || 0;
      try {
        switch (collectionName) {
          case 'events':
            App.renderHotEvents?.(); App.renderActivityList?.(); App.renderMyActivities?.();
            break;
          case 'banners':
            App.renderBannerCarousel?.();
            break;
          case 'announcements':
            App.renderAnnouncement?.();
            break;
          case 'teams':
            if (App.currentPage === 'page-teams') App.renderTeamList?.();
            break;
          case 'tournaments':
          case 'standings':
          case 'matches':
            if (App.currentPage === 'page-tournaments') App.renderTournamentList?.();
            break;
          case 'shopItems':
            if (App.currentPage === 'page-shop') App.renderShopItems?.();
            break;
          case 'registrations':
          case 'attendanceRecords':
          case 'activityRecords':
            break;
          default:
            break;
        }
      } catch (e) { console.warn('[SWR] render for', collectionName, 'failed:', e); }
      if (_s > 0) requestAnimationFrame(function() { window.scrollTo(0, _s); });
    }, 300);
  },

  /** 儲存全部快取到 localStorage */
  _persistCache() {
    const toSave = [
      ...this._bootCollections, ...this._liveCollections, 'adminUsers',
      ...this._deferredCollections,
    ];
    toSave.forEach(name => {
      const key = name === 'adminUsers' ? 'adminUsers' : name;
      if (this._cache[key] && this._cache[key].length > 0) {
        this._saveToLS(key, this._cache[key]);
      }
    });
    // rolePermissions 特殊處理
    if (Object.keys(this._cache.rolePermissions).length > 0) {
      this._saveToLS('rolePermissions', this._cache.rolePermissions);
    }
    if (Object.keys(this._cache.rolePermissionMeta).length > 0) {
      this._saveToLS('rolePermissionMeta', this._cache.rolePermissionMeta);
    }
    localStorage.setItem(this._getLSTsKey(), Date.now().toString());
  },

  /** 根據快取中的用戶角色決定 TTL */
  _getEffectiveTTL() {
    try {
      const saved = this._loadFromLS('currentUser');
      const role = saved?.role || 'user';
      if (role === 'admin' || role === 'super_admin') return this._LS_TTL;
    } catch (_) {}
    return this._LS_TTL_LONG;
  },

  /** 從 localStorage 恢復快取（回傳是否成功） */
  _restoreCache() {
    // RC8：嘗試從 legacy key 中恢復 currentUser 以取得 UID 前綴
    // （此時 auth 尚未就緒，無法直接取得 UID）
    if (!this._lsUidPrefix) {
      try {
        const raw = localStorage.getItem(this._LS_PREFIX + 'currentUser');
        const saved = raw ? JSON.parse(raw) : null;
        if (saved && saved.uid) {
          this._setLSUidPrefix(saved.uid);
        }
      } catch (_) {}
    }

    const ts = parseInt(localStorage.getItem(this._getLSTsKey()) || '0', 10);
    const ttl = this._getEffectiveTTL();
    // 嘗試 UID-scoped key 失敗時，回退到 legacy key
    if (Date.now() - ts > ttl) {
      if (this._lsUidPrefix) {
        const legacyTs = parseInt(localStorage.getItem(this._LS_TS_KEY) || '0', 10);
        if (Date.now() - legacyTs <= ttl) {
          this._setLSUidPrefix(''); // 暫時用 legacy key 讀取
          console.log('[FirebaseService] UID-scoped 快取過期，回退 legacy key');
        } else {
          // 快取已過期但仍恢復作為 Firestore 失敗的兜底（不 return false）
          console.log('[FirebaseService] 快取已過期（' + Math.round((Date.now() - ts) / 60000) + '分鐘），仍恢復作為兜底');
        }
      } else {
        // 快取已過期但仍恢復作為 Firestore 失敗的兜底
        console.log('[FirebaseService] 快取已過期（' + Math.round((Date.now() - ts) / 60000) + '分鐘），仍恢復作為兜底');
      }
    }

    let restored = 0;
    const allCollections = [
      ...this._bootCollections, ...this._liveCollections,
      ...this._deferredCollections, 'adminUsers',
    ];
    allCollections.forEach(name => {
      const data = this._loadFromLS(name);
      if (data && data.length > 0) {
        this._cache[name] = data;
        this._collectionLoadedAt[name] = ts;
        restored++;
      }
    });
    const rp = this._loadFromLS('rolePermissions');
    if (rp && Object.keys(rp).length > 0) {
      this._cache.rolePermissions = rp;
      restored++;
    }
    const rpMeta = this._loadFromLS('rolePermissionMeta');
    if (rpMeta && Object.keys(rpMeta).length > 0) {
      this._cache.rolePermissionMeta = rpMeta;
      restored++;
    }
    // 恢復 currentUser（防止刷新後 currentUser 為 null 導致幽靈用戶）
    const savedUser = this._loadFromLS('currentUser');
    if (savedUser && savedUser.uid) {
      this._cache.currentUser = savedUser;
      // Issue 5：若剛才用 legacy key 讀取，恢復 UID 前綴避免後續寫入汙染共用命名空間
      if (!this._lsUidPrefix && savedUser.uid) {
        this._setLSUidPrefix(savedUser.uid);
      }
      console.log('[FirebaseService] currentUser 從 localStorage 恢復:', savedUser.displayName);
    }
    console.log(`[FirebaseService] localStorage 快取恢復: ${restored} 個集合 (${Math.round((Date.now() - ts) / 1000)}s ago)`);
    return restored > 3; // 至少恢復 3 個集合才算有效
  },

  // ════════════════════════════════
  //  初始化：分層載入集合到快取
  // ════════════════════════════════

  // 啟動時立即監聽的公開集合（不需 Auth，首頁核心）
  _liveCollections: [],

  // 啟動時必要的靜態集合（首頁 + 全域 UI 需要，全部公開讀取）
  _bootCollections: [
    'banners', 'announcements', 'siteThemes', 'achievements', 'badges',
  ],

  _postInitWarmupCollections: [
    'floatingAds', 'popupAds', 'sponsors', 'tournaments', 'gameConfigs',
  ],

  // 延遲載入的集合（進入對應頁面時才載入，含原 live 中需 Auth 的集合）
  _deferredCollections: [
    'floatingAds', 'popupAds', 'sponsors', 'gameConfigs', 'newsArticles',
    'events', 'teams', 'tournaments', 'shopItems', 'leaderboard', 'standings', 'matches',
    'trades', 'attendanceRecords', 'activityRecords',
    'expLogs', 'teamExpLogs', 'operationLogs',
    'adminMessages', 'notifTemplates', 'eventTemplates', 'permissions', 'customRoles',
    'userCorrections',
    'errorLogs',
    'registrations', 'messages',
  ],

  // 由即時監聽器管理的集合（ensureCollectionsForPage 不走 static .get()）

  // 集合 → 頁面映射（用於懶載入觸發）
  _collectionPageMap: {
    'page-home':              ['events', 'newsArticles'],
    'page-teams':             ['teams'],
    'page-team-detail':       ['teams', 'events'],
    'page-team-manage':       ['teams'],
    'page-tournaments':       ['tournaments', 'standings', 'matches'],
    'page-tournament-detail': ['tournaments', 'standings', 'matches'],
    'page-shop':              ['shopItems', 'trades'],
    'page-shop-detail':       ['shopItems', 'trades'],
    'page-activities':        ['events', 'attendanceRecords', 'activityRecords', 'registrations'],
    'page-activity-detail':   ['events', 'registrations', 'attendanceRecords', 'activityRecords', 'userCorrections', 'operationLogs'],
    'page-my-activities':     ['events', 'attendanceRecords', 'registrations'],
    'page-scan':              ['attendanceRecords', 'registrations'],
    'page-admin-dashboard':   ['expLogs', 'teamExpLogs', 'operationLogs', 'attendanceRecords', 'activityRecords'],
    'page-admin-users':       ['permissions', 'customRoles'],
    'page-admin-messages':    ['adminMessages', 'notifTemplates'],
    'page-admin-exp':         ['expLogs', 'teamExpLogs'],
    'page-admin-auto-exp':    ['expLogs'],
    'page-admin-achievements': ['achievements', 'badges'],
    'page-admin-games':       ['gameConfigs'],
    'page-admin-roles':       ['permissions', 'customRoles'],
    'page-admin-logs':        ['operationLogs', 'errorLogs'],
    'page-admin-error-logs':  ['errorLogs'],
    'page-admin-inactive':    ['attendanceRecords', 'activityRecords', 'operationLogs'],
    'page-admin-repair':      ['events', 'attendanceRecords', 'activityRecords', 'userCorrections', 'teams'],
    'page-admin-teams':       ['teams', 'tournaments', 'standings', 'matches'],
    'page-admin-tournaments': ['tournaments', 'standings', 'matches'],
    'page-admin-banners':     ['banners', 'floatingAds', 'popupAds', 'sponsors'],
    'page-admin-shop':        ['shopItems', 'trades'],
    'page-admin-themes':      ['siteThemes'],
    'page-admin-announcements': ['announcements'],
    'page-personal-dashboard': ['attendanceRecords', 'activityRecords'],
    'page-profile':            ['attendanceRecords', 'activityRecords', 'teams'],
    'page-leaderboard':       ['leaderboard'],
  },

  _pageScopedRealtimeMap: {
    'page-home':            ['events'],
    'page-activities':      ['registrations', 'attendanceRecords'],
    'page-activity-detail': ['registrations', 'attendanceRecords', 'events'],
    'page-my-activities':   ['registrations', 'attendanceRecords'],
    'page-scan':            ['attendanceRecords', 'registrations'],
  },

  _staticReloadMaxAgeMs: {
    events: 60 * 1000,           // 60 秒 — 報名中活動需較新資料
    teams: 5 * 60 * 1000,       // 5 分鐘 — 俱樂部變動頻率低
    tournaments: 5 * 60 * 1000, // 5 分鐘
    standings: 5 * 60 * 1000,   // 5 分鐘
    matches: 5 * 60 * 1000,     // 5 分鐘
    shopItems: 10 * 60 * 1000,  // 10 分鐘 — 商品變動頻率極低
    leaderboard: 15 * 60 * 1000,// 15 分鐘 — 排行榜計算後才變
    achievements: 30 * 60 * 1000,// 30 分鐘 — 成就定義幾乎不變
    badges: 30 * 60 * 1000,     // 30 分鐘 — 徽章定義幾乎不變
    // 後台管理集合 — 支援 stale-first 背景刷新
    operationLogs: 2 * 60 * 1000,   // 2 分鐘 — 操作紀錄較頻繁
    errorLogs: 2 * 60 * 1000,       // 2 分鐘
    adminMessages: 2 * 60 * 1000,   // 2 分鐘 — 站內信管理需即時
    expLogs: 3 * 60 * 1000,         // 3 分鐘
    teamExpLogs: 3 * 60 * 1000,     // 3 分鐘
    trades: 5 * 60 * 1000,          // 5 分鐘
    banners: 5 * 60 * 1000,         // 5 分鐘
    floatingAds: 5 * 60 * 1000,     // 5 分鐘
    popupAds: 5 * 60 * 1000,        // 5 分鐘
    sponsors: 5 * 60 * 1000,        // 5 分鐘
    announcements: 5 * 60 * 1000,   // 5 分鐘
    gameConfigs: 5 * 60 * 1000,     // 5 分鐘
    userCorrections: 5 * 60 * 1000, // 5 分鐘
    permissions: 10 * 60 * 1000,    // 10 分鐘 — 權限設定少變
    customRoles: 10 * 60 * 1000,    // 10 分鐘
    notifTemplates: 10 * 60 * 1000, // 10 分鐘
    siteThemes: 10 * 60 * 1000,     // 10 分鐘 — 佈景主題少變
  },

  _buildCollectionQuery(name, limitCount = 200) {
    if (name === 'operationLogs') {
      return db.collection(name)
        .orderBy('createdAt', 'desc')
        .limit(limitCount);
    }
    if (name === 'newsArticles') {
      return db.collection(name)
        .orderBy('publishedAt', 'desc')
        .limit(8);
    }
    // 統計關鍵集合不設 limit，避免截斷導致放鴿子/出席率計算錯誤
    if (name === 'attendanceRecords' || name === 'registrations' || name === 'activityRecords') {
      return db.collection(name);
    }
    return db.collection(name).limit(limitCount);
  },

  _getPageScopedRealtimeCollections(pageId) {
    return this._pageScopedRealtimeMap[pageId] || [];
  },

  _shouldReloadCollection(name) {
    if (!this._lazyLoaded[name]) return true;
    const ttl = this._staticReloadMaxAgeMs[name];
    if (!ttl) return false;
    const loadedAt = this._collectionLoadedAt[name] || 0;
    return !loadedAt || (Date.now() - loadedAt > ttl);
  },

  _markCollectionsLoaded(names, loadedAt = Date.now()) {
    (names || []).forEach(name => {
      this._lazyLoaded[name] = true;
      this._collectionLoadedAt[name] = loadedAt;
      delete this._bootCollectionLoadFailed[name];
    });
  },

  _replaceCollectionCache(name, docs) {
    const seen = new Set();
    this._cache[name] = (docs || []).filter(doc => {
      if (!doc?.id) return true;
      if (seen.has(doc.id)) return false;
      seen.add(doc.id);
      return true;
    });
    // SWR：通知 UI 此集合已更新（僅在 init 完成後，避免啟動時連發）
    if (this._initialized) this._notifyCacheUpdated(name);
  },

  async _loadEventsStatic() {
    const [activeResult, terminalResult] = await Promise.all([
      this._fetchQuerySnapshot(
        'events:active',
        db.collection('events')
          .where('status', 'in', ['open', 'full', 'upcoming'])
          .limit(200)
      ),
      this._fetchQuerySnapshot(
        'events:terminal',
        db.collection('events')
          .where('status', 'in', ['ended', 'cancelled'])
          .limit(100)
      ),
    ]);

    if (!activeResult.ok && !terminalResult.ok) {
      console.warn('[FirebaseService] Skip cache overwrite for "events" due to load failure.');
      return [];
    }

    this._eventSlices.active = (activeResult.docs || []).map(doc => ({ ...doc.data(), _docId: doc.id }));
    this._eventSlices.terminal = (terminalResult.docs || []).map(doc => ({ ...doc.data(), _docId: doc.id }));
    // 記錄 terminal 最後一筆 doc snapshot，供分頁用
    this._terminalLastDoc = (terminalResult.docs && terminalResult.docs.length > 0)
      ? terminalResult.docs[terminalResult.docs.length - 1] : null;
    this._terminalAllLoaded = !terminalResult.docs || terminalResult.docs.length < 100;
    this._mergeRealtimeEventSlices(false);
    this._markCollectionsLoaded(['events']);
    this._saveToLS('events', this._cache.events);
    return ['events'];
  },

  /**
   * 分頁載入更多已結束/已取消活動（startAfter 上一批最後一筆）
   * @returns {number} 本次載入的筆數（0 = 已全部載完）
   */
  async loadMoreTerminalEvents() {
    if (this._terminalAllLoaded || !this._terminalLastDoc) return 0;
    if (this._loadingMoreTerminal) return -1;
    this._loadingMoreTerminal = true;
    try {
      var query = db.collection('events')
        .where('status', 'in', ['ended', 'cancelled'])
        .startAfter(this._terminalLastDoc)
        .limit(100);
      var snap = await query.get();
      var newDocs = snap.docs.map(function(doc) { return Object.assign({}, doc.data(), { _docId: doc.id }); });
      if (newDocs.length > 0) {
        this._eventSlices.terminal = this._eventSlices.terminal.concat(newDocs);
        this._terminalLastDoc = snap.docs[snap.docs.length - 1];
        this._mergeRealtimeEventSlices(false);
        this._saveToLS('events', this._cache.events);
      }
      if (newDocs.length < 100) this._terminalAllLoaded = true;
      return newDocs.length;
    } catch (err) {
      console.error('[loadMoreTerminalEvents]', err);
      throw err;
    } finally {
      this._loadingMoreTerminal = false;
    }
  },

  async _loadCollectionsByName(names) {
    const uniqueNames = [...new Set((names || []).filter(Boolean))];
    if (!uniqueNames.length) return [];

    const tasks = uniqueNames.map(async name => {
      if (name === 'events') {
        return await this._loadEventsStatic();
      }
      const loaded = await this._loadStaticCollections([name]);
      this._markCollectionsLoaded(loaded);
      return loaded;
    });

    return (await Promise.all(tasks)).flat();
  },

  _startPageScopedRealtimeForPage(pageId) {
    const needed = new Set(this._getPageScopedRealtimeCollections(pageId));
    if (needed.has('registrations')) this._startRegistrationsListener();
    if (needed.has('attendanceRecords')) this._startAttendanceRecordsListener();
    if (needed.has('events')) this._startEventsRealtimeListener();
  },

  _cancelDeferredPageScopedRealtimeStart(pageId) {
    const timer = this._pageScopedRealtimeStartTimers[pageId];
    if (!timer) return;
    clearTimeout(timer);
    delete this._pageScopedRealtimeStartTimers[pageId];
  },

  _cancelAllDeferredPageScopedRealtimeStarts() {
    Object.keys(this._pageScopedRealtimeStartTimers).forEach(pageId => {
      this._cancelDeferredPageScopedRealtimeStart(pageId);
    });
  },

  schedulePageScopedRealtimeForPage(pageId, options = {}) {
    const needed = this._getPageScopedRealtimeCollections(pageId);
    if (!needed.length) return;

    this._cancelDeferredPageScopedRealtimeStart(pageId);

    const delayMs = Number(options.delayMs ?? 350);
    const start = () => {
      delete this._pageScopedRealtimeStartTimers[pageId];
      if (typeof App !== 'undefined' && App.currentPage !== pageId) return;
      this._startPageScopedRealtimeForPage(pageId);
    };

    if (!Number.isFinite(delayMs) || delayMs <= 0) {
      start();
      return;
    }

    this._pageScopedRealtimeStartTimers[pageId] = setTimeout(start, delayMs);
  },

  finalizePageScopedRealtimeForPage(pageId) {
    this._cancelAllDeferredPageScopedRealtimeStarts();
    const needed = new Set(this._getPageScopedRealtimeCollections(pageId));
    if (!needed.has('registrations')) this._stopRegistrationsListener();
    if (!needed.has('attendanceRecords')) this._stopAttendanceRecordsListener();
    if (!needed.has('events')) this._stopEventsRealtimeListener();
  },

  /** 根據頁面 ID 懶載入對應的集合 */
  async ensureCollectionsForPage(pageId, options = {}) {
    if (!this._initialized) return [];
    const needed = this._collectionPageMap[pageId];
    if (!needed) return [];
    const skipRealtimeStart = options.skipRealtimeStart === true;

    // 啟動延遲即時監聽器（registrations / attendanceRecords 需 Auth）
    if (!skipRealtimeStart) {
      this._startPageScopedRealtimeForPage(pageId);
    }
    const realtimeNeeded = new Set(this._getPageScopedRealtimeCollections(pageId));

    // 用戶統計頁面：並行載入 user-specific records（無 limit 截斷）
    const _userStatsPages = ['page-profile', 'page-personal-dashboard'];
    let userStatsPromise = null;
    if (_userStatsPages.includes(pageId) && auth?.currentUser?.uid) {
      userStatsPromise = this.ensureUserStatsLoaded(auth.currentUser.uid);
    }

    // 靜態集合載入（排除即時監聽器管理的集合）
    const toLoad = needed.filter(name =>
      !realtimeNeeded.has(name) && this._shouldReloadCollection(name)
    );
    if (toLoad.length === 0) {
      if (userStatsPromise) await userStatsPromise;
      return [];
    }

    console.log(`[FirebaseService] 懶載入 ${pageId} 需要的集合:`, toLoad.join(', '));
    const [loaded] = await Promise.all([
      this._loadCollectionsByName(toLoad),
      userStatsPromise,
    ].filter(Boolean));
    // 持久化新載入的集合
    this._persistCache();
    return loaded;
  },

  /**
   * 載入指定用戶的完整 activityRecords + attendanceRecords（無 limit 截斷）
   * 結果存入 _userStatsCache，供統計函式優先使用
   */
  async ensureUserStatsLoaded(uid) {
    if (!uid) return;
    if (this._userStatsCache.uid === uid && this._userStatsCache.activityRecords !== null) return;

    try {
      const [actSnap, attSnap] = await Promise.all([
        db.collection('activityRecords').where('uid', '==', uid).get(),
        db.collection('attendanceRecords').where('uid', '==', uid).get(),
      ]);
      const attDocs = attSnap.docs.map(doc => ({ ...doc.data(), _docId: doc.id }));

      this._userStatsCache = {
        uid,
        activityRecords: actSnap.docs.map(doc => ({ ...doc.data(), _docId: doc.id })),
        attendanceRecords: attDocs,
      };
    } catch (err) {
      console.warn('[FirebaseService] ensureUserStatsLoaded failed:', err);
    }
  },

  getUserStatsCache() {
    return this._userStatsCache;
  },

  async ensureStaticCollectionsLoaded(names) {
    if (!this._initialized) return [];

    const requested = [...new Set((names || []).filter(Boolean))];
    if (!requested.length) return [];

    const toLoad = requested.filter(name => this._shouldReloadCollection(name));
    if (toLoad.length > 0) {
      console.log('[FirebaseService] Ensure static collections:', toLoad.join(', '));
      await this._loadCollectionsByName(toLoad);
      this._persistCache();
    }

    return requested.filter(name => !this._shouldReloadCollection(name));
  },

  async refreshCollectionsForPage(pageId) {
    if (!this._initialized) return [];
    const needed = this._collectionPageMap[pageId];
    if (!needed || !needed.length) return [];

    const realtimeNeeded = new Set(this._getPageScopedRealtimeCollections(pageId));
    const toLoad = needed.filter(name => !realtimeNeeded.has(name));
    if (!toLoad.length) return [];

    console.log(`[FirebaseService] Manual refresh for ${pageId}:`, toLoad.join(', '));
    const loaded = await this._loadCollectionsByName(toLoad);
    this._persistCache();
    return loaded;
  },

  _handleWarmLoadedCollections(loadedNames) {
    const loaded = new Set(loadedNames || []);
    if (!loaded.size || typeof App === 'undefined') return;

    try {
      if (loaded.has('siteThemes')) {
        App.applySiteThemes?.();
      }
      const shouldRefreshHome = App.currentPage === 'page-home'
        && ['banners', 'announcements', 'events', 'floatingAds', 'popupAds', 'sponsors', 'tournaments', 'gameConfigs']
          .some(name => loaded.has(name));
      if (shouldRefreshHome) {
        var _s = window.scrollY || window.pageYOffset || 0;
        App.renderAll?.();
        if (_s > 0) requestAnimationFrame(function() { window.scrollTo(0, _s); });
      }
      // teams 載入後刷新賽事中心建立按鈕（解決首次進入時按鈕不顯示的時序問題）
      if (loaded.has('teams') && App.currentPage === 'page-tournaments') {
        App._refreshTournamentCenterCreateButton?.();
      }
    } catch (err) {
      console.warn('[FirebaseService] warm collection UI refresh failed:', err);
    }
  },

  _schedulePostInitWarmups() {
    if (!this._initialized) return;
    if (this._postInitWarmupPromise) return;

    const warmNames = this._postInitWarmupCollections.filter(name => this._shouldReloadCollection(name));
    if (!warmNames.length) return;

    const warmPromise = (async () => {
      console.log('[FirebaseService] Warm static collections:', warmNames.join(', '));
      const loaded = await this._loadCollectionsByName(warmNames);
      this._persistCache();
      this._handleWarmLoadedCollections(loaded);
      return loaded;
    })().catch(err => {
      console.warn('[FirebaseService] Warm static collections failed:', err);
      return [];
    });

    this._postInitWarmupPromise = warmPromise.finally(() => {
      if (this._postInitWarmupPromise === warmPromise) {
        this._postInitWarmupPromise = null;
      }
    });
  },

  _onRolePermissionsUpdated() {
    if (typeof App === 'undefined') return;
    try {
      App.applyRole?.(App.currentRole || 'user', true);
      if (App.currentPage === 'page-teams') {
        App.renderTeamList?.();
      } else if (App.currentPage === 'page-team-manage') {
        App.renderTeamManage?.();
      } else if (App.currentPage === 'page-team-detail' && App._teamDetailId) {
        App.showTeamDetail?.(App._teamDetailId);
      } else if (App.currentPage === 'page-admin-roles') {
        App.renderRoleHierarchy?.();
        if (App._permSelectedRole) App.renderPermissions?.(App._permSelectedRole);
      } else if (App.currentPage === 'page-admin-repair') {
        App.renderUserCorrectionManager?.();
      }
      if (App.currentPage && typeof App._canAccessPage === 'function' && !App._canAccessPage(App.currentPage)) {
        void App.showPage('page-home', { bypassRestrictionGuard: true, resetHistory: true });
      }
    } catch (err) {
      console.warn('[FirebaseService] rolePermissions UI refresh failed:', err);
    }
  },

  _onTeamsUpdated() {
    if (typeof App === 'undefined') return;
    try {
      if (App.currentPage === 'page-teams') {
        App.renderTeamList?.();
      } else if (App.currentPage === 'page-team-manage') {
        App.renderTeamManage?.();
      } else if (App.currentPage === 'page-admin-teams') {
        App.renderAdminTeams?.();
      } else if (App.currentPage === 'page-team-detail' && App._teamDetailId) {
        App.showTeamDetail?.(App._teamDetailId);
      }
    } catch (err) {
      console.warn('[FirebaseService] teams UI refresh failed:', err);
    }
  },

  _mergeRealtimeEventSlices(shouldRefreshUI = false) {
    const merged = [];
    const seen = new Set();
    const pushUnique = (docs) => {
      (docs || []).forEach(doc => {
        if (!doc || !doc._docId || seen.has(doc._docId)) return;
        seen.add(doc._docId);
        merged.push(doc);
      });
    };
    // 先放 active，避免同 ID 被 terminal 舊快取覆蓋
    pushUnique(this._eventSlices.active);
    pushUnique(this._eventSlices.terminal);
    this._cache.events = merged;
    this._debouncedPersistCache();

    if (!shouldRefreshUI) return;
    this._debouncedSnapshotRender('events');
  },

  _syncCurrentUserFromUsersSnapshot() {
    const authUid = (typeof auth !== 'undefined' && auth?.currentUser?.uid)
      ? auth.currentUser.uid
      : (this._cache.currentUser?.uid || null);
    if (!authUid) return;

    const candidates = (this._cache.adminUsers || []).filter(u =>
      u && (u._docId === authUid || u.uid === authUid || u.lineUserId === authUid)
    );
    if (!candidates.length) return;

    const preferred =
      candidates.find(u => u._docId === authUid)
      || candidates.find(u => u.uid === authUid)
      || candidates.find(u => u.lineUserId === authUid)
      || candidates[0];

    const prev = this._cache.currentUser || null;
    const next = {
      ...(prev || {}),
      ...preferred,
      uid: preferred.uid || authUid,
      lineUserId: preferred.lineUserId || authUid,
    };

    // 輕量更新：exp 變更只需刷新頂部顯示，不觸發重量級同步
    const expChanged = prev && (prev.exp || 0) !== (next.exp || 0);
    if (expChanged) {
      this._cache.currentUser = next;
      this._saveToLS('currentUser', next);
      if (typeof App !== 'undefined' && typeof App.updatePointsDisplay === 'function') {
        App.updatePointsDisplay();
      }
    }

    const changed = !prev
      || prev._docId !== next._docId
      || prev.role !== next.role
      || prev.isRestricted !== next.isRestricted
      || prev.displayName !== next.displayName
      || prev.pictureUrl !== next.pictureUrl
      || prev.teamId !== next.teamId
      || JSON.stringify(prev.teamIds || []) !== JSON.stringify(next.teamIds || []);
    if (!changed) return;

    const roleChanged = prev && prev.role !== next.role;

    this._cache.currentUser = next;
    this._saveToLS('currentUser', next);
    this._startMessagesListener();
    if (typeof App !== 'undefined' && this._getPageScopedRealtimeCollections(App?.currentPage).includes('registrations')) {
      this._startRegistrationsListener();
    }
    if (this._onUserChanged) this._onUserChanged();

    if (roleChanged && auth?.currentUser) {
      auth.currentUser.getIdToken(true).then(() => {
        console.log('[FirebaseService] Role changed to', next.role, '— token refreshed');
        if (typeof App !== 'undefined' && typeof App.applyRole === 'function') {
          App.applyRole(next.role, true);
        }
      }).catch(err => {
        console.warn('[FirebaseService] Token refresh after role change failed:', err);
        if (typeof App !== 'undefined' && typeof App.applyRole === 'function') {
          App.applyRole(next.role, true);
        }
      });
    }
  },

  _watchRolePermissionsRealtime(waitForFirstSnapshot = false) {
    return new Promise(resolve => {
      if (!auth?.currentUser) {
        resolve();
        return;
      }
      let firstSnapshot = true;
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      const unsub = db.collection('rolePermissions').onSnapshot(
        snapshot => {
          const nextRolePermissions = {};
          const nextRolePermissionMeta = {};
          snapshot.docs.forEach(doc => {
            const data = doc.data() || {};
            if (Object.prototype.hasOwnProperty.call(data, 'permissions')) {
              nextRolePermissions[doc.id] = sanitizePermissionCodeList(data.permissions);
            }
            nextRolePermissionMeta[doc.id] = {
              catalogVersion: data.catalogVersion || '',
              defaultPermissions: Array.isArray(data.defaultPermissions)
                ? sanitizePermissionCodeList(data.defaultPermissions)
                : null,
            };
          });

          const prev = JSON.stringify(this._cache.rolePermissions || {});
          const prevMeta = JSON.stringify(this._cache.rolePermissionMeta || {});
          const next = JSON.stringify(nextRolePermissions);
          const nextMeta = JSON.stringify(nextRolePermissionMeta);
          this._cache.rolePermissions = nextRolePermissions;
          this._cache.rolePermissionMeta = nextRolePermissionMeta;
          this._saveToLS('rolePermissions', this._cache.rolePermissions);
          this._saveToLS('rolePermissionMeta', this._cache.rolePermissionMeta);

          if (firstSnapshot) {
            firstSnapshot = false;
            done();
            return;
          }

          if (prev !== next || prevMeta !== nextMeta) {
            this._onRolePermissionsUpdated();
          }
        },
        err => {
          console.warn('[FirebaseService] rolePermissions 即時同步失敗:', err);
          done();
        }
      );

      this._listeners.push(unsub);
      if (!waitForFirstSnapshot) done();
    });
  },

  /** Firebase Auth 登入方式 */
  async _signInWithAppropriateMethod(expectedUid = null) {
    // 先等待 Auth 狀態恢復——若先前已登入成功且有 persistence，不需重新走 LINE 驗證
    if (typeof _firebaseAuthReadyPromise !== 'undefined' && !_firebaseAuthReady) {
      try {
        await Promise.race([_firebaseAuthReadyPromise, new Promise(r => setTimeout(r, 3000))]);
      } catch (_) {}
    }
    if (auth?.currentUser) {
      if (!expectedUid || auth.currentUser.uid === expectedUid) {
        console.log('[FirebaseService] Auth 已從 persistence 恢復, uid:', auth.currentUser.uid);
        return;
      }
      console.warn('[FirebaseService] Auth uid 與 LINE userId 不一致，將強制重走 Custom Token 登入', {
        currentUid: auth.currentUser.uid,
        expectedUid,
      });
    }

    // Prod 模式：只做 Custom Token 登入，不產生匿名用戶
    if (typeof liff === 'undefined' || !liff.isLoggedIn()) {
      console.warn('[FirebaseService] LIFF 未登入，跳過 Firebase Auth（使用快取瀏覽）');
      return;
    }

    const accessToken = typeof LineAuth !== 'undefined' ? LineAuth.getAccessToken?.() : null;
    if (!accessToken) {
      console.warn('[FirebaseService] 無 LINE Access Token，跳過 Firebase Auth');
      return;
    }

    try {
      console.log('[FirebaseService] 呼叫 createCustomToken Cloud Function...');
      const fn = firebase.app().functions('asia-east1').httpsCallable('createCustomToken');
      const result = await fn({ accessToken });
      const { customToken } = result.data;
      console.log('[FirebaseService] 收到 Custom Token, 執行 signInWithCustomToken...');
      const cred = await auth.signInWithCustomToken(customToken);
      const signedUid = cred?.user?.uid || null;
      if (expectedUid && signedUid && signedUid !== expectedUid) {
        console.error('[FirebaseService] Custom Token 登入後 uid 仍不一致', { expectedUid, signedUid });
      }
      console.log('[FirebaseService] Custom Token 登入成功, uid:', signedUid);
      const nowMs = Date.now();
      const lastAuditMs = signedUid ? (this._lastLoginAuditAtByUid[signedUid] || 0) : 0;
      const shouldWriteLoginAudit = !!signedUid && (!lastAuditMs || (nowMs - lastAuditMs > 15000));
      if (signedUid && shouldWriteLoginAudit) {
        this._lastLoginAuditAtByUid[signedUid] = nowMs;
      } else if (signedUid) {
        console.warn('[FirebaseService] Skip duplicate login_success audit log', {
          signedUid,
          deltaMs: nowMs - lastAuditMs,
        });
      }
      if (typeof ApiService !== 'undefined' && typeof ApiService.writeAuditLog === 'function' && shouldWriteLoginAudit) {
        void ApiService.writeAuditLog({
          action: 'login_success',
          targetType: 'system',
          targetId: signedUid,
          targetLabel: 'LINE login',
          result: 'success',
          source: 'liff',
        });
      }
    } catch (err) {
      const errMsg = err?.message || '';
      const errCode = err?.code || '';
      console.error('[FirebaseService] Custom Token 登入失敗:', errCode, errMsg, err?.stack || '');
      if (typeof App !== 'undefined' && App.showToast) {
        if (errMsg.toLowerCase().includes('assertion') || errMsg.toLowerCase().includes('internal')) {
          App.showToast('系統初始化異常，請關閉所有分頁後重新開啟');
        } else if (errCode === 'functions/unavailable' || errCode === 'unavailable') {
          App.showToast('伺服器暫時不可用，請稍後再試');
        } else {
          App.showToast('LINE 驗證失敗，部分功能可能受限');
        }
      }
    }
  },

  /**
   * 讀取快取中的單一文件
   * @param {string} collection - 集合名稱
   * @param {string} docId - 文件 ID
   * @returns {object|null}
   */
  getCachedDoc(collection, docId) {
    return this._singleDocCache[collection + '/' + docId] || null;
  },

  async ensureSingleDocLoaded(collection, docId) {
    const cacheKey = collection + '/' + docId;
    if (this._singleDocCache[cacheKey]) {
      return this._singleDocCache[cacheKey];
    }

    if (typeof db === 'undefined') {
      return null;
    }

    const snap = await db.collection(collection).doc(docId).get();
    if (snap.exists) {
      const current = this._singleDocCache[cacheKey] || {};
      this._singleDocCache[cacheKey] = { ...current, ...snap.data() };
      return this._singleDocCache[cacheKey];
    }

    return null;
  },

  getNotificationToggles() {
    const doc = this.getCachedDoc('siteConfig', 'featureFlags') || {};
    return (doc.notificationToggles && typeof doc.notificationToggles === 'object' && !Array.isArray(doc.notificationToggles))
      ? doc.notificationToggles
      : {};
  },

  setNotificationTogglesCache(toggles) {
    const cacheKey = 'siteConfig/featureFlags';
    const current = this._singleDocCache[cacheKey] || {};
    this._singleDocCache[cacheKey] = {
      ...current,
      notificationToggles: { ...(toggles || {}) },
    };
    return this._singleDocCache[cacheKey];
  },

  /**
   * 載入單一 Firestore 文件到快取
   * @param {string} collection
   * @param {string} docId
   */
  async _fetchSingleDoc(collection, docId) {
    try {
      const snap = await db.collection(collection).doc(docId).get();
      if (snap.exists) {
        this._singleDocCache[collection + '/' + docId] = snap.data();
      }
    } catch (err) {
      console.warn('[FirebaseService] Failed to fetch ' + collection + '/' + docId + ':', err);
    }
  },

  _roleLevel(role) {
    if (typeof ROLE_LEVEL_MAP === 'undefined') return 0;
    return ROLE_LEVEL_MAP[role] || 0;
  },

  async _resolveCurrentAuthRole() {
    const fallbackRole =
      (this._cache.currentUser && typeof this._cache.currentUser.role === 'string')
        ? this._cache.currentUser.role
        : 'user';

    try {
      const authUser = (typeof auth !== 'undefined' && auth && auth.currentUser) ? auth.currentUser : null;
      if (!authUser) return fallbackRole;

      // Prefer Custom Claims first (source of truth after createCustomToken).
      const tokenResult = await authUser.getIdTokenResult();
      const claimRole = (tokenResult && tokenResult.claims && typeof tokenResult.claims.role === 'string')
        ? tokenResult.claims.role
        : null;
      if (claimRole) return claimRole;

      // Fallback to users cache from onSnapshot.
      const uid = authUser.uid;
      const userDoc = this._cache.adminUsers.find(u =>
        u.uid === uid || u.lineUserId === uid || u._docId === uid
      );
      if (userDoc && typeof userDoc.role === 'string') return userDoc.role;

      // Last fallback to currentUser cache.
      if (this._cache.currentUser && this._cache.currentUser.uid === uid && typeof this._cache.currentUser.role === 'string') {
        return this._cache.currentUser.role;
      }

      return 'user';
    } catch (err) {
      console.warn('[FirebaseService] Resolve auth role failed, fallback to cache:', err);
      return fallbackRole;
    }
  },

  async _loadStaticCollections(names) {
    const requested = [...new Set((names || []).filter(Boolean))];
    if (!requested.length) return [];

    const results = await Promise.all(requested.map(async name => ({
      name,
      result: await this._fetchCollectionSnapshot(name, 500),
    })));

    const loadedNames = [];
    results.forEach(({ name, result }) => {
      if (!result || !result.ok) {
        console.warn(`[FirebaseService] Skip cache overwrite for "${name}" due to load failure.`);
        return;
      }
      const docs = result.docs.map(doc => ({ ...doc.data(), _docId: doc.id }));
      this._replaceCollectionCache(name, docs);
      loadedNames.push(name);
    });
    return loadedNames;
  },

  async _fetchQuerySnapshot(label, query) {
    try {
      const snapshot = await query.get();
      return { ok: true, docs: snapshot.docs };
    } catch (err) {
      console.warn(`[FirebaseService] Query "${label}" load failed:`, err);
      return { ok: false, docs: null };
    }
  },

  async _fetchCollectionSnapshot(name, limitCount = 200) {
    return await this._fetchQuerySnapshot(
      `collection:${name}`,
      this._buildCollectionQuery(name, limitCount)
    );
  },

  // ════════════════════════════════
  //  Auth 寫入守衛
  // ════════════════════════════════

  /** 等待 Auth 完成（供寫入操作使用，避免 permission-denied） */
  async ensureAuthReadyForWrite() {
    if (auth?.currentUser) return true;
    if (this._authPromise) {
      try {
        await Promise.race([
          this._authPromise,
          new Promise(r => setTimeout(r, 10000))
        ]);
      } catch (_) {}
    }
    return !!auth?.currentUser;
  },

  // ════════════════════════════════
  //  延遲即時監聯器（Auth 完成後 / 進入頁面時啟動）
  // ════════════════════════════════

  /** 啟動 messages 監聽器（需 Auth） */
  // ── Phase 3: Per-user inbox — 單一 listener 取代 7+ 條 ──
  _startMessagesListener() {
    if (!auth?.currentUser) return;
    const uid = auth.currentUser.uid;
    if (!uid) return;
    if (this._realtimeListenerStarted.messages && this._messageVisibilityKey === uid) return;

    this._stopMessagesListener();
    this._realtimeListenerStarted.messages = true;
    this._messageVisibilityKey = uid;

    // 單一 listener：users/{uid}/inbox，按 createdAt 倒序取最新 200 筆
    const query = db.collection('users').doc(uid).collection('inbox')
      .orderBy('createdAt', 'desc').limit(200);
    const unsub = query.onSnapshot(
      snapshot => {
        this._cache.messages = snapshot.docs.map(doc => ({ ...doc.data(), _docId: doc.id }));
        this._snapshotReconnectAttempts.messages = 0;
        this._debouncedPersistCache();
        this._debouncedSnapshotRender('messages');
      },
      err => {
        console.warn('[onSnapshot] inbox 監聽錯誤:', err);
      }
    );
    this._messageListeners.push(unsub);
  },

  _stopMessagesListener() {
    this._messageListeners.forEach(unsub => {
      try { unsub(); } catch (_) {}
    });
    this._messageListeners = [];
    this._messageListenerResults = {};
    this._messageVisibilityKey = '';
    this._realtimeListenerStarted.messages = false;
  },

  _getMessageVisibilityContext() {
    const user = this._cache.currentUser || null;
    const uid = auth?.currentUser?.uid || user?.uid || user?.lineUserId || null;
    const role = user?.role || 'user';
    const teamIds = [];
    const seen = new Set();
    const pushId = (id) => {
      const value = String(id || '').trim();
      if (!value || seen.has(value)) return;
      seen.add(value);
      teamIds.push(value);
    };
    if (Array.isArray(user?.teamIds)) user.teamIds.forEach(pushId);
    pushId(user?.teamId);
    return { uid, role, teamIds };
  },

  _getMessageVisibilityKey(ctx) {
    return `${ctx.uid || ''}__${ctx.role || 'user'}__${(ctx.teamIds || []).join(',')}`;
  },

  _getMessageQuerySpecs(ctx) {
    const specs = [];
    const addSpec = (key, query) => {
      if (!key || !query) return;
      specs.push({ key, query });
    };

    addSpec(`targetUid:${ctx.uid}`, db.collection('messages').where('targetUid', '==', ctx.uid).limit(200));
    addSpec(`toUid:${ctx.uid}`, db.collection('messages').where('toUid', '==', ctx.uid).limit(200));
    addSpec(`fromUid:${ctx.uid}`, db.collection('messages').where('fromUid', '==', ctx.uid).limit(200));
    addSpec(`senderUid:${ctx.uid}`, db.collection('messages').where('senderUid', '==', ctx.uid).limit(200));
    addSpec('targetType:all', db.collection('messages').where('targetType', '==', 'all').limit(200));

    if (ctx.role) {
      addSpec(`targetRoles:${ctx.role}`, db.collection('messages').where('targetRoles', 'array-contains', ctx.role).limit(200));
    }

    (ctx.teamIds || []).forEach(teamId => {
      addSpec(`targetTeamId:${teamId}`, db.collection('messages').where('targetTeamId', '==', teamId).limit(200));
    });

    return specs;
  },

  _getMessageTimeMs(msg) {
    const parseValue = (value) => {
      if (!value) return 0;
      if (typeof value.toMillis === 'function') return value.toMillis();
      if (typeof value.seconds === 'number') {
        return (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1000000);
      }
      if (typeof value === 'number') return value;
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const direct = parseValue(msg?.timestamp) || parseValue(msg?.createdAt);
    if (direct) return direct;

    const timeStr = String(msg?.time || '').trim();
    if (timeStr) {
      const [datePart, timePart = '0:0'] = timeStr.split(' ');
      const [y, mo, d] = datePart.split('/').map(Number);
      const [h, mi] = timePart.split(':').map(Number);
      const parsed = new Date(y, (mo || 1) - 1, d || 1, h || 0, mi || 0).getTime();
      if (Number.isFinite(parsed)) return parsed;
    }

    return 0;
  },

  _isMessageVisibleForContext(msg, ctx) {
    if (!msg || !ctx?.uid) return false;
    if (Array.isArray(msg.hiddenBy) && msg.hiddenBy.includes(ctx.uid)) return false;

    const senderUid = String(msg.fromUid || msg.senderUid || '').trim();
    if (senderUid && senderUid === ctx.uid) return true;

    const targetUid = String(msg.targetUid || msg.toUid || '').trim();
    if (targetUid) return targetUid === ctx.uid;

    const targetTeamId = String(msg.targetTeamId || '').trim();
    if (targetTeamId) return (ctx.teamIds || []).includes(targetTeamId);

    if (Array.isArray(msg.targetRoles) && msg.targetRoles.length) {
      return msg.targetRoles.includes(ctx.role || 'user');
    }

    return true;
  },

  _mergeVisibleMessagesFromListenerResults(ctx = this._getMessageVisibilityContext()) {
    const merged = new Map();

    Object.values(this._messageListenerResults || {}).forEach(list => {
      (list || []).forEach(msg => {
        if (!this._isMessageVisibleForContext(msg, ctx)) return;
        const key = msg._docId || msg.id;
        if (!key) return;
        const prev = merged.get(key);
        if (!prev || this._getMessageTimeMs(msg) >= this._getMessageTimeMs(prev)) {
          merged.set(key, msg);
        }
      });
    });

    this._cache.messages = Array.from(merged.values())
      .sort((a, b) => this._getMessageTimeMs(b) - this._getMessageTimeMs(a))
      .slice(0, 200);
    this._debouncedPersistCache();
  },

  /** 啟動 users 監聽器（需 Auth） */
  _startUsersListener() {
    if (!auth?.currentUser) return;
    if (this._realtimeListenerStarted.users) return;
    this._realtimeListenerStarted.users = true;
    this._usersUnsub = db.collection('users')
      .onSnapshot(
        snapshot => {
          this._cache.adminUsers = snapshot.docs.map(doc => this._mapUserDoc(doc.data(), doc.id));
          this._syncCurrentUserFromUsersSnapshot();
          this._debouncedPersistCache();
        },
        err => { console.warn('[onSnapshot] users 監聽錯誤:', err); }
      );
  },

  _stopUsersListener() {
    if (this._usersUnsub) {
      try { this._usersUnsub(); } catch (_) {}
      this._usersUnsub = null;
    }
    this._realtimeListenerStarted.users = false;
  },

  /** 啟動 registrations 監聽器（需 Auth，進入活動頁面時觸發） */
  _startRegistrationsListener() {
    if (!auth?.currentUser) {
      if (this._authPromise && !this._realtimeListenerStarted._pendingRegistrations) {
        this._realtimeListenerStarted._pendingRegistrations = true;
        this._authPromise.then(() => {
          this._realtimeListenerStarted._pendingRegistrations = false;
          if (auth?.currentUser && this._getPageScopedRealtimeCollections(App?.currentPage).includes('registrations')) {
            this._startRegistrationsListener();
          }
        });
      }
      return;
    }
    const ctx = this._getRegistrationsVisibilityContext();
    if (!ctx.uid && !ctx.canReadAll) {
      // 場景 B：UID 尚未解析 → 排程 3 秒後重試（僅一次，避免無限迴圈）
      if (!this._realtimeListenerStarted._retryNoUid) {
        this._realtimeListenerStarted._retryNoUid = true;
        this._retryNoUidTimer = setTimeout(() => {
          this._realtimeListenerStarted._retryNoUid = false;
          this._retryNoUidTimer = null;
          if (!this._realtimeListenerStarted.registrations
            && this._getPageScopedRealtimeCollections(App?.currentPage).includes('registrations')) {
            this._startRegistrationsListener();
          }
        }, 3000);
      }
      return;
    }
    const nextKey = this._getRegistrationsListenerKey(ctx);
    if (this._realtimeListenerStarted.registrations && this._registrationListenerKey === nextKey) return;

    this._stopRegistrationsListener();
    this._realtimeListenerStarted.registrations = true;
    this._lazyLoaded.registrations = true;
    this._registrationListenerKey = nextKey;
    const unsub = this._getRegistrationsListenerQuery(ctx)
      .onSnapshot(
        snapshot => {
          this._cache.registrations = snapshot.docs.map(doc => {
            const d = { ...doc.data(), _docId: doc.id };
            if (d.userId && !d.uid) d.uid = d.userId;
            if (d.uid && !d.userId) d.userId = d.uid;
            return d;
          });
          this._registrationsFirstSnapshotReceived = true; // Fix A
          this._snapshotReconnectAttempts.registrations = 0; // RC4：成功時重置重連計數
          this._debouncedPersistCache();
          this._debouncedSnapshotRender('registrations');
        },
        err => this._reconnectRegistrationsListener(err) // RC4：自動重連
      );
    this._pageScopedRealtimeListeners.registrations = unsub;
  },

  _getRegistrationsVisibilityContext() {
    const user = this._cache.currentUser || null;
    const uid = auth?.currentUser?.uid || user?.uid || user?.lineUserId || null;
    const role = user?.role || 'user';
    const canReadAll = role === 'admin' || role === 'super_admin';
    return { uid, role, canReadAll };
  },

  _getRegistrationsListenerKey(ctx) {
    return ctx.canReadAll ? 'all' : `user:${ctx.uid || ''}`;
  },

  _getRegistrationsListenerQuery(ctx) {
    if (ctx.canReadAll) {
      return db.collection('registrations');
    }
    return db.collection('registrations')
      .where('userId', '==', ctx.uid);
  },

  _stopRegistrationsListener() {
    if (this._pageScopedRealtimeListeners.registrations) {
      this._pageScopedRealtimeListeners.registrations();
      this._pageScopedRealtimeListeners.registrations = null;
    }
    this._registrationListenerKey = '';
    this._realtimeListenerStarted.registrations = false;
    this._realtimeListenerStarted._pendingRegistrations = false;
    this._realtimeListenerStarted._retryNoUid = false;
    this._registrationsFirstSnapshotReceived = false; // Fix A: 重設旗標
    clearTimeout(this._retryNoUidTimer);
    this._retryNoUidTimer = null;
  },

  /** 啟動 attendanceRecords 監聽器（需 Auth，進入掃描/管理頁時觸發） */
  _startAttendanceRecordsListener() {
    if (this._realtimeListenerStarted.attendanceRecords) return;
    if (!auth?.currentUser) {
      if (this._authPromise && !this._realtimeListenerStarted._pendingAttendance) {
        this._realtimeListenerStarted._pendingAttendance = true;
        this._authPromise.then(() => {
          this._realtimeListenerStarted._pendingAttendance = false;
          if (auth?.currentUser && this._getPageScopedRealtimeCollections(App?.currentPage).includes('attendanceRecords')) {
            this._startAttendanceRecordsListener();
          }
        });
      }
      return;
    }
    this._realtimeListenerStarted.attendanceRecords = true;
    this._lazyLoaded.attendanceRecords = true;
    this._attendanceSnapshotReady = false;
    const unsub = db.collection('attendanceRecords')
      .orderBy('createdAt', 'desc')
      .onSnapshot(
        snapshot => {
          this._cache.attendanceRecords = snapshot.docs.map(doc => ({ ...doc.data(), _docId: doc.id }));
          this._attendanceSnapshotReady = true;
          this._snapshotReconnectAttempts.attendanceRecords = 0; // RC4：成功時重置重連計數
          this._debouncedPersistCache();
          this._debouncedSnapshotRender('attendance');
        },
        err => this._reconnectAttendanceRecordsListener(err) // RC4：自動重連
      );
    this._pageScopedRealtimeListeners.attendanceRecords = unsub;
  },

  _stopAttendanceRecordsListener() {
    if (this._pageScopedRealtimeListeners.attendanceRecords) {
      this._pageScopedRealtimeListeners.attendanceRecords();
      this._pageScopedRealtimeListeners.attendanceRecords = null;
    }
    this._realtimeListenerStarted.attendanceRecords = false;
    this._realtimeListenerStarted._pendingAttendance = false;
    this._attendanceSnapshotReady = false;
  },

  /** Auth 完成後啟動需驗證的監聽器 + seed（背景執行，不阻塞首頁） */
  async _startAuthDependentWork() {
    if (!this._initialized) {
      console.log('[FirebaseService] Defer auth-dependent init until public init is ready.');
      return;
    }

    const currentUid = auth?.currentUser?.uid || '__pending__';
    if (this._authDependentWorkPromise && this._authDependentWorkUid === currentUid) {
      return this._authDependentWorkPromise;
    }

    const workPromise = (async () => {
      try {
        await Promise.race([
          this._authPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('AUTH_TIMEOUT')), 15000))
        ]);
      } catch (err) {
        console.error('[FirebaseService] Firebase Auth 登入失敗:', err?.code || err?.message);
        this._authError = err;
        return;
      }

      const authUid = auth?.currentUser?.uid || null;
      if (!authUid) {
        console.log('[FirebaseService] Skip auth-dependent listeners: auth user not ready yet.');
        return;
      }

      // RC8：設定 UID 前綴，確保 localStorage 快取隔離
      this._setLSUidPrefix(authUid);

      // 強制刷新 token，確保 persistence 恢復的 token 仍有效
      try {
        await auth.currentUser.getIdToken(true);
      } catch (tokenErr) {
        console.warn('[FirebaseService] Token refresh failed, skip auth-dependent work:', tokenErr?.code || tokenErr?.message);
        return;
      }

      this._startMessagesListener();
      this._startUsersListener();

      // Fix 2：Auth 就緒後，若當前頁需要 registrations listener 則主動補啟動
      if (typeof App !== 'undefined'
        && this._getPageScopedRealtimeCollections(App?.currentPage).includes('registrations')
        && !this._realtimeListenerStarted.registrations) {
        this._startRegistrationsListener();
      }

      // RC1：stale-while-revalidate — Auth 就緒後立即背景刷新 registrations
      // 不 await，不阻塞後續初始化；UI 已用 localStorage 快取渲染，刷新後自動覆蓋
      this._staleWhileRevalidateRegistrations(authUid);

      try {
        await this._watchRolePermissionsRealtime(true);
      } catch (err) { console.warn('[FirebaseService] rolePermissions 載入失敗:', err); }

      const authRole = await this._resolveCurrentAuthRole();
      if (!BUILTIN_ROLE_KEYS.includes(authRole)) {
        try {
          await this._loadCollectionsByName(['customRoles']);
          if (typeof App !== 'undefined' && App.currentRole === authRole) {
            App.applyRole?.(authRole, true);
          }
        } catch (err) {
          console.warn('[FirebaseService] customRoles 載入失敗:', err);
        }
      }
      const canAdminSeed = this._roleLevel(authRole) >= this._roleLevel('admin');
      const canSuperAdminSeed = this._roleLevel(authRole) >= this._roleLevel('super_admin');
      const seedTasks = [];

      if (canAdminSeed) {
        seedTasks.push(
          this._cleanupDuplicateDocs(),
          this._seedAdSlots().then(() => this._ensureSga1Slot()),
          this._seedNotifTemplates(),
          this._seedAchievements(),
        );
      } else {
        console.log(`[FirebaseService] Skip admin seed for role "${authRole}"`);
      }

      if (canSuperAdminSeed) {
        seedTasks.push(this._seedRoleData());
      } else {
        console.log(`[FirebaseService] Skip super_admin seed for role "${authRole}"`);
      }

      if (seedTasks.length > 0) {
        await Promise.all(seedTasks);
      }

      // 非阻塞載入 per-user 成就進度（失敗不影響任何功能）
      this._loadCurrentUserAchievementProgress(authUid);

      this._persistCache();
      console.log('[FirebaseService] Auth-dependent init complete.');
    })();

    this._authDependentWorkUid = currentUid;
    this._authDependentWorkPromise = workPromise;
    try {
      await workPromise;
    } finally {
      if (this._authDependentWorkPromise === workPromise) {
        this._authDependentWorkPromise = null;
        this._authDependentWorkUid = null;
      }
    }
  },

  // ════════════════════════════════
  //  主初始化：分層啟動（公開資料先行，Auth 並行）
  // ════════════════════════════════

  async init() {
    if (this._initialized) return;
    if (this._initInFlight) { console.warn('[FirebaseService] init() 已在執行中，跳過重複呼叫'); return; }
    this._initInFlight = true;
    try {
    this._bootCollectionLoadFailed = {};
    this._realtimeListenerStarted = {};
    this._registrationsFirstSnapshotReceived = false; // Fix A: init 時重設
    this._authDependentWorkPromise = null;
    this._authDependentWorkUid = null;
    this._postInitWarmupPromise = null;
    this._cancelAllDeferredPageScopedRealtimeStarts();

    // ── Step 1: 嘗試從 localStorage 恢復快取 ──
    this._restoreCache();

    // ── Step 2: 並行啟動 — 公開資料 + Auth ──
    this._eventSlices = { active: [], terminal: [] };

    // 2a. Boot collections（全部公開讀取，不需 Auth）
    // 2b. 公開即時監聽器（events active + teams，不需 Auth）

    // 2c. Auth 並行啟動（不阻塞公開資料載入）
    this._authPromise = this._signInWithAppropriateMethod().catch(err => {
      console.error('[FirebaseService] Firebase Auth failed:', err?.code || err?.message);
      this._authError = err;
    });
    if (!this._realtimeListenerStarted._authStateObserver && auth?.onAuthStateChanged) {
      this._realtimeListenerStarted._authStateObserver = true;
      const unsubAuthObserver = auth.onAuthStateChanged(user => {
        if (!user) {
          this._lastLoginAuditAtByUid = {};
          return;
        }
        Promise.resolve(this._startAuthDependentWork()).catch(err => {
          console.warn('[FirebaseService] start auth-dependent work after auth state changed failed:', err);
        });
      });
      this._listeners.push(unsubAuthObserver);
    }

    // Step 2.5: 若 localStorage 快取夠新（< 15 分鐘），直接用快取渲染，Firestore 背景更新
    const _FRESH_CACHE_TTL = 15 * 60 * 1000;
    const _cacheTs = parseInt(localStorage.getItem(this._getLSTsKey()) || '0', 10);
    const _cacheAge = Date.now() - _cacheTs;
    if (_cacheAge < _FRESH_CACHE_TTL && this._cache.events.length > 0) {
      this._initialized = true;
      this._setupVisibilityRefresh();
      console.log(`[FirebaseService] Fresh cache hit (${Math.round(_cacheAge / 1000)}s old) — skip boot wait`);
      this._startAuthDependentWork();
      this._schedulePostInitWarmups();
      this._continueLoadAfterTimeout(); // 背景靜默更新 Firestore 資料
      return;
    }

    // Step 3: wait for boot collections + public preload with timeout protection.
    const _INIT_TIMEOUT = 6000;
    let bootSnapshots = null;
    let timedOut = false;

    try {
      const dataPromise = (async () => {
        await this._loadEventsStatic().catch(err => {
          console.warn('[FirebaseService] Initial events preload failed:', err);
          return [];
        });
        const [bootSnapshots] = await Promise.all([
          Promise.all(this._bootCollections.map(name => this._fetchCollectionSnapshot(name, 200))),
          this._fetchSingleDoc('siteConfig', 'featureFlags'),
        ]);
        return [bootSnapshots];
      })();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('INIT_TIMEOUT')), _INIT_TIMEOUT)
      );
      const [bs] = await Promise.race([dataPromise, timeoutPromise]);
      bootSnapshots = bs;
    } catch (err) {
      if (err.message === 'INIT_TIMEOUT') {
        timedOut = true;
        if (!window._firestoreUsingLongPolling) {
          _markWsBlocked();
          console.warn('[FirebaseService] WebSocket init timeout; switch to long polling next time.');
          if (typeof App !== 'undefined' && App.showToast) {
            App.showToast('連線較慢，重新整理頁面可改善速度');
          }
        } else {
          if (typeof _clearWsBlocked === 'function') _clearWsBlocked();
          console.warn('[FirebaseService] Long-polling init timed out; clear fallback and retry WebSocket next time.');
        }
      } else {
        throw err;
      }
    }

    // 超時 → 用 localStorage 快取兜底 + REST API fallback + 背景繼續載入
    if (timedOut) {
      this._initialized = true;
      this._setupVisibilityRefresh();
      console.log('[FirebaseService] Init timed out; continue with localStorage cache.');
      this._startAuthDependentWork();
      this._fetchBootViaRest();
      this._continueLoadAfterTimeout();
      return;
    }

    // ── Step 4: 填入 boot 集合快取 ──
    this._bootCollections.forEach((name, i) => {
      const result = bootSnapshots[i];
      if (!result || !result.ok) {
        this._bootCollectionLoadFailed[name] = true;
        console.warn(`[FirebaseService] Boot collection "${name}" failed; keep existing cache.`);
        return;
      }
      this._bootCollectionLoadFailed[name] = false;
      const docs = result.docs.map(doc => ({ ...doc.data(), _docId: doc.id }));
      this._replaceCollectionCache(name, docs);
    });
    this._markCollectionsLoaded(this._bootCollections.filter(name => !this._bootCollectionLoadFailed[name]));

    // ── 標記初始化完成（首頁可渲染）──
    this._initialized = true;
    this._persistCache();

    // RC3：啟動 visibilitychange 監聽（頁面切回自動刷新）
    this._setupVisibilityRefresh();

    const bootCount = this._bootCollections.length;
    console.log(`[FirebaseService] Public data init complete - boot: ${bootCount}, static events preload, deferred: ${this._deferredCollections.length}`);
    // ── Step 6: 背景啟動 Auth 依賴的監聽器 + seed ──
    this._startAuthDependentWork();
    this._schedulePostInitWarmups();
    } finally {
      this._initInFlight = false;
    }
  },

  /** timeout 後背景繼續載入 events + boot collections，完成後觸發首頁渲染 */
  _continueLoadAfterTimeout() {
    (async () => {
      try {
        // 重試載入 events
        const eventsLoaded = await this._loadEventsStatic().catch(() => []);
        // 重試載入 boot collections + feature flags
        const [bootResults] = await Promise.all([
          Promise.all(this._bootCollections.map(name => this._fetchCollectionSnapshot(name, 200))).catch(() => []),
          this._fetchSingleDoc('siteConfig', 'featureFlags'),
        ]);
        this._bootCollections.forEach((name, i) => {
          const result = bootResults[i];
          if (!result || !result.ok) return;
          const docs = result.docs.map(doc => ({ ...doc.data(), _docId: doc.id }));
          this._replaceCollectionCache(name, docs);
        });
        this._markCollectionsLoaded(this._bootCollections.filter((name, i) => bootResults[i]?.ok));
        this._persistCache();
        // 觸發重新渲染（不限首頁）
        if (typeof App !== 'undefined') {
          App._cloudReady = true;
          App.renderAll?.();
          if (App.currentPage !== 'page-home') App.showPage?.(App.currentPage);
        }
        console.log('[FirebaseService] Background reload after timeout complete');
        this._schedulePostInitWarmups();
      } catch (err) {
        console.warn('[FirebaseService] Background reload after timeout failed:', err);
      }
    })();
  },

  /** REST API fallback：繞過 WebSocket，直接用 fetch 取 boot collections */
  _fetchBootViaRest() {
    var self = this;
    var projectId = 'fc-football-6c8dc';
    var apiKey = 'AIzaSyA5TzRM_7XHaD8iQlrr3jZXrtXc-a5RXkE';
    var base = 'https://firestore.googleapis.com/v1/projects/' + projectId + '/databases/(default)/documents/';
    var collections = this._bootCollections.slice();
    collections.push('events');

    (async function() {
      try {
        var results = await Promise.all(collections.map(function(name) {
          return fetch(base + name + '?key=' + apiKey + '&pageSize=300')
            .then(function(r) { return r.ok ? r.json() : null; })
            .catch(function() { return null; });
        }));
        var updated = false;
        results.forEach(function(json, i) {
          if (!json || !json.documents) return;
          var docs = json.documents.map(function(d) { return self._convertRestDoc(d); });
          if (collections[i] === 'events') {
            if (docs.length > 0 && (!self._cache.events || self._cache.events.length === 0)) {
              self._cache.events = docs;
              updated = true;
            }
          } else {
            self._replaceCollectionCache(collections[i], docs);
            updated = true;
          }
        });
        if (updated) {
          self._persistCache();
          if (typeof App !== 'undefined') {
            App._cloudReady = true;
            App.renderAll?.();
          }
          console.log('[FirebaseService] REST API fallback: boot data loaded');
        }
      } catch (err) {
        console.warn('[FirebaseService] REST API fallback failed:', err);
      }
    })();
  },

  /** Firestore REST API document → plain object 轉換 */
  _convertRestDoc(restDoc) {
    var obj = {};
    if (restDoc.name) {
      var parts = restDoc.name.split('/');
      obj._docId = parts[parts.length - 1];
      obj.id = obj._docId;
    }
    if (restDoc.fields) {
      var keys = Object.keys(restDoc.fields);
      for (var i = 0; i < keys.length; i++) {
        obj[keys[i]] = this._convertRestValue(restDoc.fields[keys[i]]);
      }
    }
    return obj;
  },

  _convertRestValue(v) {
    if (!v) return null;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return parseInt(v.integerValue, 10);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('nullValue' in v) return null;
    if ('timestampValue' in v) return v.timestampValue;
    if ('arrayValue' in v) {
      return (v.arrayValue.values || []).map(this._convertRestValue.bind(this));
    }
    if ('mapValue' in v) {
      var result = {};
      var fields = v.mapValue.fields || {};
      var mk = Object.keys(fields);
      for (var j = 0; j < mk.length; j++) {
        result[mk[j]] = this._convertRestValue(fields[mk[j]]);
      }
      return result;
    }
    return null;
  },

  /** 背景載入已結束/取消的活動（不阻塞啟動） */
  async _loadEndedEvents() {
    try {
      const snap = await db.collection('events')
        .where('status', 'in', ['ended', 'cancelled'])
        .orderBy('date', 'desc')
        .limit(200)
        .get();
      const endedDocs = snap.docs.map(doc => ({ ...doc.data(), _docId: doc.id }));
      // 合併，避免重複
      const existingIds = new Set(this._cache.events.map(e => e._docId));
      const newDocs = endedDocs.filter(d => !existingIds.has(d._docId));
      if (newDocs.length > 0) {
        this._cache.events.push(...newDocs);
        this._saveToLS('events', this._cache.events);
        console.log(`[FirebaseService] 背景載入 ${newDocs.length} 筆已結束活動`);
      }
    } catch (err) {
      console.warn('[FirebaseService] 背景載入已結束活動失敗:', err);
    }
  },

  // ════════════════════════════════
  //  清除重複文件（一次性修復）
  // ════════════════════════════════

  async _cleanupDuplicateDocs() {
    const collectionsToCheck = ['achievements', 'badges'];
    for (const name of collectionsToCheck) {
      try {
        const snap = await db.collection(name).get();
        const seen = new Map();
        const toDelete = [];
        snap.docs.forEach(doc => {
          const id = doc.data().id;
          if (!id) return;
          if (seen.has(id)) {
            // 保留 doc ID === id 的文件（seed 建立的），刪除 auto-generated 的
            const kept = seen.get(id);
            if (kept === id) {
              toDelete.push(doc.id);
            } else {
              toDelete.push(kept);
              seen.set(id, doc.id === id ? id : doc.id);
            }
          } else {
            seen.set(id, doc.id);
          }
        });
        if (toDelete.length > 0) {
          console.log(`[FirebaseService] 清除 ${name} 重複文件:`, toDelete.length, '筆');
          const batch = db.batch();
          toDelete.forEach(docId => batch.delete(db.collection(name).doc(docId)));
          await batch.commit();
        }
      } catch (err) { console.warn(`[FirebaseService] ${name} 重複清除失敗:`, err); }
    }
  },

  // ════════════════════════════════
  //  自動建立空白廣告欄位
  // ════════════════════════════════

  async _seedAdSlots() {
    // 使用固定 doc ID + set(merge) 確保冪等性，避免重複建立
    const seedCollection = async (collectionName, slots) => {
      if (this._bootCollectionLoadFailed[collectionName]) {
        console.warn(`[FirebaseService] Skip seeding "${collectionName}" because initial load failed.`);
        return;
      }
      if (this._cache[collectionName].length > 0) return;
      const refs = slots.map(slot => db.collection(collectionName).doc(slot.id));
      const snaps = await Promise.all(refs.map(ref => ref.get()));
      const batch = db.batch();
      const cacheDocs = [];
      let createdCount = 0;

      slots.forEach((slot, idx) => {
        const snap = snaps[idx];
        if (snap.exists) {
          cacheDocs.push({ _docId: snap.id, ...snap.data() });
          return;
        }
        createdCount += 1;
        batch.set(refs[idx], {
          ...slot,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        cacheDocs.push({ ...slot, _docId: slot.id });
      });

      if (createdCount > 0) {
        console.log(`[FirebaseService] 補齊 ${collectionName} 缺漏欄位: ${createdCount} 筆`);
        await batch.commit();
      } else {
        console.log(`[FirebaseService] ${collectionName} 欄位已齊全，略過補建`);
      }

      if (this._cache[collectionName].length === 0 && cacheDocs.length > 0) {
        this._cache[collectionName].push(...cacheDocs);
      }
    };

    // 每個集合獨立 try-catch，避免單一失敗導致後續全部跳過
    const seeds = [
      ['banners', [
        { id: 'ban1', slot: 1, title: '', image: null, status: 'empty', publishAt: null, unpublishAt: null, clicks: 0, gradient: '' },
        { id: 'ban2', slot: 2, title: '', image: null, status: 'empty', publishAt: null, unpublishAt: null, clicks: 0, gradient: '' },
        { id: 'ban3', slot: 3, title: '', image: null, status: 'empty', publishAt: null, unpublishAt: null, clicks: 0, gradient: '' },
        { id: 'sga1', slot: 'sga1', type: 'shotgame', slotName: '射門遊戲廣告位', title: '', image: null, status: 'empty', publishAt: null, unpublishAt: null, clicks: 0, linkUrl: '' },
      ]],
      ['floatingAds', [
        { id: 'fad1', slot: 'AD1', title: '', image: null, status: 'empty', publishAt: null, unpublishAt: null, clicks: 0 },
        { id: 'fad2', slot: 'AD2', title: '', image: null, status: 'empty', publishAt: null, unpublishAt: null, clicks: 0 },
      ]],
      ['popupAds', [
        { id: 'pad1', layer: 1, title: '', image: null, status: 'empty', publishAt: null, unpublishAt: null, clicks: 0, linkUrl: '' },
        { id: 'pad2', layer: 2, title: '', image: null, status: 'empty', publishAt: null, unpublishAt: null, clicks: 0, linkUrl: '' },
        { id: 'pad3', layer: 3, title: '', image: null, status: 'empty', publishAt: null, unpublishAt: null, clicks: 0, linkUrl: '' },
      ]],
      ['sponsors', [
        { id: 'sp1', slot: 1, title: '', image: null, status: 'empty', linkUrl: '', publishAt: null, unpublishAt: null, clicks: 0 },
        { id: 'sp2', slot: 2, title: '', image: null, status: 'empty', linkUrl: '', publishAt: null, unpublishAt: null, clicks: 0 },
        { id: 'sp3', slot: 3, title: '', image: null, status: 'empty', linkUrl: '', publishAt: null, unpublishAt: null, clicks: 0 },
        { id: 'sp4', slot: 4, title: '', image: null, status: 'empty', linkUrl: '', publishAt: null, unpublishAt: null, clicks: 0 },
        { id: 'sp5', slot: 5, title: '', image: null, status: 'empty', linkUrl: '', publishAt: null, unpublishAt: null, clicks: 0 },
        { id: 'sp6', slot: 6, title: '', image: null, status: 'empty', linkUrl: '', publishAt: null, unpublishAt: null, clicks: 0 },
      ]],
      ['siteThemes', [
        { id: 'sth1', slot: 'theme_topbar', label: '上方橫條背景', spec: '750 × 56 px', image: null, status: 'empty' },
        { id: 'sth2', slot: 'theme_bottombar', label: '下方橫條背景', spec: '750 × 64 px', image: null, status: 'empty' },
        { id: 'sth3', slot: 'theme_bg', label: '網站背景', spec: '750 × 1334 px', image: null, status: 'empty' },
      ]],
      ['gameConfigs', (Array.isArray(HOME_GAME_PRESETS) && HOME_GAME_PRESETS.length > 0
        ? HOME_GAME_PRESETS
        : [{ id: 'home_game_shot', gameKey: 'shot-game', name: '蓄力射門 誰與爭鋒', page: 'page-game', sortOrder: 10, enabled: true, homeVisible: true }]
      ).map(item => ({ ...item }))],
    ];
    for (const [name, slots] of seeds) {
      try {
        await seedCollection(name, slots);
      } catch (err) {
        console.warn(`[FirebaseService] ${name} 欄位建立失敗:`, err);
      }
    }
  },

  // ════════════════════════════════
  //  確保射門遊戲廣告位存在
  // ════════════════════════════════

  async _ensureSga1Slot() {
    if (!db) return;
    if (this._cache.banners && this._cache.banners.find(b => b.id === 'sga1' || b._docId === 'sga1')) return;
    try {
      if (typeof _firebaseAuthReadyPromise !== 'undefined' && !_firebaseAuthReady) {
        await Promise.race([_firebaseAuthReadyPromise, new Promise(r => setTimeout(r, 5000))]);
      }
      const ref = db.collection('banners').doc('sga1');
      const snap = await ref.get();
      if (!snap.exists) {
        const data = { id: 'sga1', slot: 'sga1', type: 'shotgame', slotName: '射門遊戲廣告位',
          title: '', image: null, status: 'empty', publishAt: null, unpublishAt: null, clicks: 0, linkUrl: '' };
        await ref.set({ ...data, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        if (this._cache.banners) this._cache.banners.push({ ...data, _docId: 'sga1' });
        console.log('[FirebaseService] 射門遊戲廣告位 sga1 已建立');
      } else {
        if (this._cache.banners) this._cache.banners.push({ _docId: snap.id, ...snap.data() });
      }
      // 若廣告管理頁面正開著，通知重繪
      if (typeof App !== 'undefined' && typeof App.renderShotGameAdManage === 'function') {
        App.renderShotGameAdManage();
      }
    } catch (err) {
      console.warn('[FirebaseService] _ensureSga1Slot 失敗:', err);
    }
  },

  // ════════════════════════════════
  //  自動建立通知模板
  // ════════════════════════════════

  async _seedNotifTemplates() {
    {
      const existing = new Set((this._cache.notifTemplates || []).map(t => t.key));
      const defaults = [
        { key: 'welcome', title: '歡迎加入 SportHub！', body: '嗨 {userName}，歡迎加入 SportHub 平台！\n\n您可以在這裡瀏覽並報名各類足球活動、加入俱樂部、參與聯賽。\n祝您使用愉快！' },
        { key: 'signup_success', title: '報名成功通知', body: '您已成功報名以下活動：\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n報名狀態：{status}\n\n請準時出席，如需取消請提前至活動頁面操作。' },
        { key: 'cancel_signup', title: '取消報名通知', body: '{status}。\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n如需再次參加，可回到活動頁重新報名。' },
        { key: 'waitlist_promoted', title: '候補遞補通知', body: '恭喜！由於有人取消報名，您已從候補名單自動遞補為正式參加者。\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n請準時出席！' },
        { key: 'waitlist_demoted', title: '候補降級通知', body: '因活動名額調整，您目前已改為候補狀態。\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n若後續有名額釋出，系統會再通知您。' },
        { key: 'event_cancelled', title: '活動取消通知', body: '很抱歉通知您，以下活動因故取消：\n\n活動名稱：{eventName}\n原定時間：{date}\n原定地點：{location}\n\n如您已繳費，費用將於 3 個工作天內退還。造成不便深感抱歉。' },
        { key: 'role_upgrade', title: '身份變更通知', body: '恭喜 {userName}！您的身份已變更為「{roleName}」。\n\n新身份可能帶來新的權限與功能，請至個人資料頁面查看詳情。\n感謝您對社群的貢獻！' },
        { key: 'event_changed', title: '活動變更通知', body: '您報名的活動資訊有所變更，請留意：\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n如因變更需要取消報名，請至活動頁面操作。' },
        { key: 'event_relisted', title: '活動重新上架通知', body: '您先前報名的活動已重新上架：\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n您的報名資格仍然保留，請留意活動時間。' },
      ];
      const missing = defaults.filter(t => !existing.has(t.key));
      if (!missing.length) return;
      console.log('[FirebaseService] 補齊通知模板:', missing.map(t => t.key).join(', '));
      try {
        const batch = db.batch();
        missing.forEach(t => {
          const ref = db.collection('notifTemplates').doc(t.key);
          batch.set(ref, {
            ...t,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
        });
        await batch.commit();
        missing.forEach(t => {
          this._cache.notifTemplates.push({ ...t, _docId: t.key });
        });
        this._saveToLS('notifTemplates', this._cache.notifTemplates);
      } catch (err) {
        console.warn('[FirebaseService] 通知模板補齊失敗:', err);
      }
      return;
    }
    const existing = new Set((this._cache.notifTemplates || []).map(t => t.key));
    const defaults = [
      { key: 'welcome', title: '歡迎加入 SportHub！', body: '嗨 {userName}，歡迎加入 SportHub 平台！\n\n您可以在這裡瀏覽並報名各類足球活動、加入俱樂部、參與聯賽。\n祝您使用愉快！' },
      { key: 'signup_success', title: '報名成功通知', body: '您已成功報名以下活動：\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n報名狀態：{status}\n\n請準時出席，如需取消請提前至活動頁面操作。' },
      { key: 'cancel_signup', title: '取消報名通知', body: '{status}：\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n如之後想再次參加，請回到活動頁重新報名。' },
      { key: 'waitlist_promoted', title: '候補遞補通知', body: '恭喜！由於有人取消報名，您已從候補名單自動遞補為正式參加者。\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n請準時出席！' },
      { key: 'waitlist_demoted', title: '候補調整通知', body: '很抱歉通知您，因活動名額調整，您的報名狀態已改為候補。\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n若有名額釋出，系統將依候補順序自動遞補。' },
      { key: 'event_cancelled', title: '活動取消通知', body: '很抱歉通知您，以下活動因故取消：\n\n活動名稱：{eventName}\n原定時間：{date}\n原定地點：{location}\n\n如您已繳費，費用將於 3 個工作天內退還。造成不便深感抱歉。' },
      { key: 'role_upgrade', title: '身份變更通知', body: '恭喜 {userName}！您的身份已變更為「{roleName}」。\n\n新身份可能帶來新的權限與功能，請至個人資料頁面查看詳情。\n感謝您對社群的貢獻！' },
      { key: 'event_changed', title: '活動變更通知', body: '您報名的活動資訊有所變更，請留意：\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n如因變更需要取消報名，請至活動頁面操作。' },
      { key: 'event_relisted', title: '活動重新上架通知', body: '您先前報名的活動已重新上架：\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n您的報名資格仍然保留，請留意活動時間。' },
    ];
    const missing = defaults.filter(t => !existing.has(t.key));
    if (!missing.length) return;
    console.log('[FirebaseService] 補齊通知模板:', missing.map(t => t.key).join(', '));
    try {
      const batch = db.batch();
      missing.forEach(t => {
        const ref = db.collection('notifTemplates').doc(t.key);
        batch.set(ref, {
          ...t,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      });
      await batch.commit();
      missing.forEach(t => {
        this._cache.notifTemplates.push({ ...t, _docId: t.key });
      });
      this._saveToLS('notifTemplates', this._cache.notifTemplates);
    } catch (err) {
      console.warn('[FirebaseService] 通知模板補齊失敗:', err);
    }
  },

  // ════════════════════════════════
  //  自動建立預設成就與徽章
  // ════════════════════════════════

  // 預設成就資料（正式版 seed 用，current/completedAt 一律為 0/null，進度由系統計算）
  _defaultAchievements: [
    { id: 'a1', name: '初心者', category: 'bronze', badgeId: 'b1', completedAt: null, current: 0, status: 'active', condition: { timeRange: 'none', action: 'register_event', filter: 'all', threshold: 1 } },
    { id: 'a2', name: '全勤之星', category: 'silver', badgeId: 'b2', completedAt: null, current: 0, status: 'active', condition: { timeRange: 'none', action: 'attendance_rate', filter: 'all', threshold: 90 } },
    { id: 'a3', name: '鐵人精神', category: 'silver', badgeId: 'b3', completedAt: null, current: 0, status: 'active', condition: { timeRange: 'none', action: 'complete_event', filter: 'all', threshold: 30 } },
    { id: 'a4', name: '社群達人', category: 'silver', badgeId: 'b4', completedAt: null, current: 0, status: 'active', condition: { timeRange: 'none', action: 'bind_line_notify', filter: 'all', threshold: 1 } },
    { id: 'a5', name: '俱樂部新人', category: 'gold', badgeId: 'b5', completedAt: null, current: 0, status: 'active', condition: { timeRange: 'none', action: 'join_team', filter: 'all', threshold: 1 } },
    { id: 'a6', name: '個人門面', category: 'gold', badgeId: 'b6', completedAt: null, current: 0, status: 'active', condition: { timeRange: 'none', action: 'complete_profile', filter: 'all', threshold: 1 } },
    { id: 'a7', name: '百場達人', category: 'gold', badgeId: 'b7', completedAt: null, current: 0, status: 'active', condition: { timeRange: 'none', action: 'complete_event', filter: 'all', threshold: 100 } },
  ],
  _defaultBadges: [
    { id: 'b1', name: '新手徽章', achId: 'a1', category: 'bronze', image: null },
    { id: 'b2', name: '全勤徽章', achId: 'a2', category: 'silver', image: null },
    { id: 'b3', name: '鐵人徽章', achId: 'a3', category: 'silver', image: null },
    { id: 'b4', name: '社群徽章', achId: 'a4', category: 'silver', image: null },
    { id: 'b5', name: '俱樂部新人徽章', achId: 'a5', category: 'gold', image: null },
    { id: 'b6', name: '個人門面徽章', achId: 'a6', category: 'gold', image: null },
    { id: 'b7', name: '百場徽章', achId: 'a7', category: 'gold', image: null },
  ],

  _loadCurrentUserAchievementProgress(uid) {
    if (!uid) return;
    // 非阻塞：不 await，失敗時快取保持空陣列，觸發 fallback 到即時計算
    this.loadUserAchievementProgress(uid).then(progress => {
      this._userAchievementProgress = progress || [];
      this._userAchievementProgressUid = uid;
      console.log(`[FirebaseService] Per-user achievement progress loaded: ${this._userAchievementProgress.length} records`);
    }).catch(err => {
      console.warn('[FirebaseService] Per-user achievement progress load failed (fallback to realtime calc):', err);
      this._userAchievementProgress = [];
      this._userAchievementProgressUid = uid;
    });
  },

  getUserAchievementProgressMap() {
    if (!this._userAchievementProgress || !this._userAchievementProgress.length) return null;
    const map = new Map();
    this._userAchievementProgress.forEach(record => {
      const achId = record.achId || record._docId;
      if (achId) map.set(achId, record);
    });
    return map.size > 0 ? map : null;
  },

  async _seedAchievements() {
    // ── 一次性清除全域汙染：重設 current/completedAt 為模板狀態 ──
    // Per-user 遷移後，全域 achievements 僅作模板，不應殘留進度資料
    if (!localStorage.getItem('sporthub_ach_clean_v2')) {
      const existing = this._cache.achievements;
      const polluted = existing.some(a => a.current || a.completedAt);
      if (polluted) {
        try {
          const batch = db.batch();
          existing.forEach(doc => {
            if (doc._docId) {
              batch.update(db.collection('achievements').doc(doc._docId), { current: 0, completedAt: null });
              doc.current = 0;
              doc.completedAt = null;
            }
          });
          await batch.commit();
          console.log('[FirebaseService] 全域成就模板已重設（per-user 遷移清理）');
        } catch (err) { console.warn('[FirebaseService] 全域成就重設失敗:', err); }
      }
      localStorage.setItem('sporthub_ach_clean_v2', '1');
    }

    // ── Seed：首次建立預設成就與徽章 ──
    if (localStorage.getItem('sporthub_ach_seeded')) return;

    const existing = this._cache.achievements;
    if (existing.length > 0) {
      localStorage.setItem('sporthub_ach_seeded', '1');
      return;
    }

    console.log('[FirebaseService] 建立預設成就與徽章...');
    try {
      const batch = db.batch();
      this._defaultAchievements.forEach(a => {
        batch.set(db.collection('achievements').doc(a.id), { ...a, createdAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      });
      this._defaultBadges.forEach(b => {
        batch.set(db.collection('badges').doc(b.id), { ...b, createdAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      });
      await batch.commit();
      localStorage.setItem('sporthub_ach_seeded', '1');
      this._defaultAchievements.forEach(a => { a._docId = a.id; this._cache.achievements.push({ ...a }); });
      this._defaultBadges.forEach(b => { b._docId = b.id; this._cache.badges.push({ ...b }); });
      console.log('[FirebaseService] 預設成就與徽章建立完成');
    } catch (err) {
      console.warn('[FirebaseService] 成就與徽章建立失敗:', err);
    }
  },

  // ════════════════════════════════
  //  自動建立權限定義與角色權限
  // ════════════════════════════════

  async _seedRoleData() {
    // 權限定義頁面以本地 built-in catalog 為主，這裡只做角色權限補遷移，避免舊角色在新入口權限上線後掉入口。
    console.log('[FirebaseService] 檢查後台入口預設權限...');
    try {
      const rolesToSync = ['admin', 'super_admin'];
      const batch = db.batch();
      const nextRolePermissions = { ...(this._cache.rolePermissions || {}) };
      const nextRolePermissionMeta = { ...(this._cache.rolePermissionMeta || {}) };
      let hasChanges = false;

      rolesToSync.forEach(roleKey => {
        const defaults = sanitizePermissionCodeList(getDefaultRolePermissions(roleKey) || []);
        const hasStoredPermissions = Object.prototype.hasOwnProperty.call(nextRolePermissions, roleKey);
        const currentPerms = hasStoredPermissions && Array.isArray(nextRolePermissions[roleKey])
          ? sanitizePermissionCodeList(nextRolePermissions[roleKey])
          : [];
        const currentMeta = nextRolePermissionMeta[roleKey] || {};
        const savedDefaults = Array.isArray(currentMeta.defaultPermissions)
          ? sanitizePermissionCodeList(currentMeta.defaultPermissions)
          : null;
        if (currentMeta.catalogVersion === ROLE_PERMISSION_CATALOG_VERSION) return;

        const payload = {
          catalogVersion: ROLE_PERMISSION_CATALOG_VERSION,
        };

        if (!hasStoredPermissions) {
          // 首次：完整 seed
          const seededPerms = Array.isArray(savedDefaults) ? [...savedDefaults] : [...defaults];
          nextRolePermissions[roleKey] = seededPerms;
          payload.permissions = seededPerms;
        } else if (Array.isArray(savedDefaults)) {
          // 既有角色：自動加入「新增的」預設權限碼（在 defaults 但不在 savedDefaults 的碼）
          var prevDefaultSet = new Set(savedDefaults);
          var newCodes = defaults.filter(function(code) { return !prevDefaultSet.has(code); });
          if (newCodes.length > 0) {
            var merged = sanitizePermissionCodeList([].concat(currentPerms, newCodes));
            nextRolePermissions[roleKey] = merged;
            payload.permissions = merged;
            console.log('[FirebaseService] ' + roleKey + ': 自動加入 ' + newCodes.length + ' 個新權限碼', newCodes);
          }
        }

        nextRolePermissionMeta[roleKey] = {
          ...currentMeta,
          catalogVersion: ROLE_PERMISSION_CATALOG_VERSION,
          defaultPermissions: Array.isArray(savedDefaults)
            ? [...savedDefaults]
            : (hasStoredPermissions ? [...currentPerms] : [...defaults]),
        };
        if (!Array.isArray(savedDefaults)) {
          payload.defaultPermissions = nextRolePermissionMeta[roleKey].defaultPermissions;
        }

        batch.set(db.collection('rolePermissions').doc(roleKey), payload, { merge: true });
        hasChanges = true;
      });

      if (!hasChanges) return;

      await batch.commit();
      this._cache.rolePermissions = nextRolePermissions;
      this._cache.rolePermissionMeta = nextRolePermissionMeta;
      this._saveToLS('rolePermissions', this._cache.rolePermissions);
      this._saveToLS('rolePermissionMeta', this._cache.rolePermissionMeta);
      console.log('[FirebaseService] 後台入口預設權限補遷移完成');
    } catch (err) {
      console.warn('[FirebaseService] 後台入口預設權限補遷移失敗:', err);
    }
  },

  // ════════════════════════════════
  //  清理
  // ════════════════════════════════

  // ════════════════════════════════
  //  RC8：登出時清除用戶 localStorage 快取
  // ════════════════════════════════
  clearUserCache() {
    try {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('shub_c_') || key.startsWith('shub_ts_'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
      // 也清除舊格式 key（向下相容）
      localStorage.removeItem(this._LS_TS_KEY);
      // 清除 QR code 快取
      localStorage.removeItem('shub_qr_uid');
      localStorage.removeItem('shub_qr_data');
      console.log(`[FirebaseService] 已清除 ${keysToRemove.length} 筆 localStorage 快取`);
    } catch (e) { /* 忽略 */ }
  },

  // ════════════════════════════════
  //  RC1：stale-while-revalidate（背景刷新 registrations）
  // ════════════════════════════════
  _staleWhileRevalidateRegistrations(authUid) {
    // 如果 registrations listener 已啟動（例如用戶直接進活動頁），不重複查詢
    if (this._realtimeListenerStarted.registrations) return;
    // Issue 1：防止並行 revalidation 競爭
    if (this._registrationsRevalidating) return;
    this._registrationsRevalidating = true;

    const ctx = this._getRegistrationsVisibilityContext();
    if (!ctx.uid && !ctx.canReadAll) { this._registrationsRevalidating = false; return; }

    this._getRegistrationsListenerQuery(ctx).get().then(snapshot => {
      this._registrationsRevalidating = false;
      const fresh = snapshot.docs.map(doc => {
        const d = { ...doc.data(), _docId: doc.id };
        if (d.userId && !d.uid) d.uid = d.userId;
        if (d.uid && !d.userId) d.userId = d.uid;
        return d;
      });
      const oldCount = this._cache.registrations.length;
      this._cache.registrations = fresh;
      this._registrationsFirstSnapshotReceived = true; // Fix A: .get() 也視為新鮮資料
      this._debouncedPersistCache();
      if (oldCount !== fresh.length) {
        console.log(`[FirebaseService] RC1 stale-while-revalidate: registrations ${oldCount} → ${fresh.length}`);
      }
      // 若用戶正在活動相關頁面，觸發 UI 更新（保留捲動位置）
      if (typeof App !== 'undefined') {
        var _s2 = window.scrollY || window.pageYOffset || 0;
        if (App.currentPage === 'page-activity-detail') App.showEventDetail?.(App._currentDetailEventId);
        if (App.currentPage === 'page-activities') App.renderActivityList?.();
        if (App.currentPage === 'page-my-activities') App.renderMyActivities?.();
        if (_s2 > 0) requestAnimationFrame(function() { window.scrollTo(0, _s2); });
      }
    }).catch(err => {
      this._registrationsRevalidating = false;
      console.warn('[FirebaseService] RC1 stale-while-revalidate registrations 失敗:', err);
    });
  },

  // ════════════════════════════════
  //  RC3：visibilitychange 頁面切回刷新
  // ════════════════════════════════
  _listenersSuspended: false,

  /** 背景分頁省頻寬：卸載所有 data listeners（保留 auth + rolePermissions） */
  _suspendListeners() {
    if (this._listenersSuspended) return;
    this._listenersSuspended = true;
    this._stopUsersListener();
    this._stopMessagesListener();
    this._stopRegistrationsListener();
    this._stopAttendanceRecordsListener();
    this._stopEventsRealtimeListener();
    this._persistCache();
    console.log('[FirebaseService] 背景分頁：已暫停所有 data listeners');
  },

  /** 前景恢復：重新啟動 listeners + 刷新資料 */
  _resumeListeners() {
    if (!this._listenersSuspended) return;
    this._listenersSuspended = false;
    if (!auth?.currentUser) return;
    // 重啟全域 listeners
    this._startUsersListener();
    this._startMessagesListener();
    // 重啟當前頁面需要的 page-scoped listeners
    if (typeof App !== 'undefined') {
      const pageId = App.currentPage;
      this.schedulePageScopedRealtimeForPage?.(pageId, { delayMs: 0 });
    }
    console.log('[FirebaseService] 前景恢復：已重啟 data listeners');
  },

  _setupVisibilityRefresh() {
    if (this._visibilityRefreshBound) return;
    this._visibilityRefreshBound = true;
    this._visibilityRefreshHandler = () => {
      // 分頁進入背景 → 卸載 listeners 省頻寬
      if (document.visibilityState === 'hidden') {
        this._suspendListeners();
        return;
      }
      // 分頁切回前景 → 重啟 listeners + 刷新
      clearTimeout(this._visibilityRefreshDebounce);
      this._visibilityRefreshDebounce = setTimeout(() => {
        this._resumeListeners();
        this._handleVisibilityResume();
      }, 1000);
    };
    document.addEventListener('visibilitychange', this._visibilityRefreshHandler);
    // pagehide：PWA 關閉 / LINE WebView 切頁前強制持久化快取
    // 用 pagehide 而非 beforeunload — iOS Safari 不可靠觸發 beforeunload
    window.addEventListener('pagehide', () => {
      clearTimeout(this._persistDebounceTimer);
      this._persistCache();
    });
  },

  _handleVisibilityResume() {
    if (!this._initialized || !auth?.currentUser) return;
    console.log('[FirebaseService] 頁面切回，觸發 stale-while-revalidate');

    // ── events 刷新（首頁 + 所有需要活動人數的頁面）──
    // Safari PWA 凍結/恢復後 onSnapshot 可能已失效（zombie listener），
    // 一律做一次性查詢確保 event.current / event.waitlist 是最新的
    this._refreshEventsOnResume();

    // 如果 registrations listener 存活 → 已有即時同步，不需額外操作
    if (this._pageScopedRealtimeListeners.registrations) return;

    // Issue 1：防止並行 revalidation 競爭
    if (this._registrationsRevalidating) return;
    this._registrationsRevalidating = true;

    // listener 不在（首頁、或已被 finalize 停止）→ 做一次性 Firestore 查詢刷新 registrations
    const ctx = this._getRegistrationsVisibilityContext();
    if (!ctx.uid && !ctx.canReadAll) { this._registrationsRevalidating = false; return; }

    this._getRegistrationsListenerQuery(ctx).get().then(snapshot => {
      this._registrationsRevalidating = false;
      const fresh = snapshot.docs.map(doc => {
        const d = { ...doc.data(), _docId: doc.id };
        if (d.userId && !d.uid) d.uid = d.userId;
        if (d.uid && !d.userId) d.userId = d.uid;
        return d;
      });
      const oldLen = this._cache.registrations.length;
      this._cache.registrations = fresh;
      this._debouncedPersistCache();
      if (fresh.length !== oldLen) {
        console.log(`[FirebaseService] registrations 刷新: ${oldLen} → ${fresh.length}`);
      }
      // 觸發當前頁面 UI 更新（保留捲動位置）
      if (typeof App !== 'undefined') {
        var _s3 = window.scrollY || window.pageYOffset || 0;
        if (App.currentPage === 'page-activity-detail') App.showEventDetail?.(App._currentDetailEventId);
        if (App.currentPage === 'page-activities') App.renderActivityList?.();
        if (App.currentPage === 'page-my-activities') App.renderMyActivities?.();
        if (_s3 > 0) requestAnimationFrame(function() { window.scrollTo(0, _s3); });
      }
    }).catch(err => {
      this._registrationsRevalidating = false;
      console.warn('[FirebaseService] visibilitychange registrations 刷新失敗:', err);
    });
  },

  /** visibilitychange 恢復時刷新 events（解決 Safari PWA zombie listener 問題） */
  _refreshEventsOnResume() {
    if (this._eventsRevalidating) return;
    this._eventsRevalidating = true;
    this._loadEventsStatic().then(() => {
      this._eventsRevalidating = false;
      // 觸發首頁重新渲染（保留捲動位置）
      if (typeof App !== 'undefined') {
        var _s4 = window.scrollY || window.pageYOffset || 0;
        if (App.currentPage === 'page-home') App.renderHotEvents?.();
        if (App.currentPage === 'page-activities') App.renderActivityList?.();
        if (App.currentPage === 'page-my-activities') App.renderMyActivities?.();
        if (_s4 > 0) requestAnimationFrame(function() { window.scrollTo(0, _s4); });
      }
      console.log('[FirebaseService] events 恢復刷新完成');
    }).catch(err => {
      this._eventsRevalidating = false;
      console.warn('[FirebaseService] events 恢復刷新失敗:', err);
    });
  },

  // ════════════════════════════════
  //  RC4：onSnapshot 斷線自動重連
  // ════════════════════════════════
  _reconnectRegistrationsListener(err) {
    console.warn('[onSnapshot] registrations 監聽錯誤:', err);
    this._pageScopedRealtimeListeners.registrations = null;
    this._realtimeListenerStarted.registrations = false;
    this._registrationListenerKey = '';

    const key = 'registrations';
    const attempts = (this._snapshotReconnectAttempts[key] || 0) + 1;
    this._snapshotReconnectAttempts[key] = attempts;
    if (attempts > 5) {
      console.warn(`[onSnapshot] registrations 重連已達上限 (${attempts} 次)，停止重試`);
      return;
    }
    const baseDelay = Math.min(1000 * Math.pow(2, attempts - 1), 30000);
    const delay = Math.round(baseDelay + baseDelay * Math.random() * 0.3); // +0~30% jitter
    console.log(`[onSnapshot] registrations 將在 ${delay}ms 後重連 (第 ${attempts} 次)`);
    this._reconnectTimers.registrations = setTimeout(() => {
      delete this._reconnectTimers.registrations;
      if (!auth?.currentUser) return;
      const pageId = typeof App !== 'undefined' ? App.currentPage : '';
      if (this._getPageScopedRealtimeCollections(pageId).includes('registrations')) {
        this._startRegistrationsListener();
      }
    }, delay);
  },

  // ════════════════════════════════
  //  Events 即時監聽（首頁活動卡片即時更新）
  // ════════════════════════════════

  _startEventsRealtimeListener() {
    if (this._realtimeListenerStarted.events) return;
    this._realtimeListenerStarted.events = true;
    this._lazyLoaded.events = true;
    const unsub = db.collection('events')
      .where('status', 'in', ['open', 'full', 'upcoming'])
      .onSnapshot(
        snapshot => {
          this._eventSlices.active = snapshot.docs.map(doc => ({ ...doc.data(), _docId: doc.id }));
          this._mergeRealtimeEventSlices(true);
          this._snapshotReconnectAttempts.events = 0;
        },
        err => this._reconnectEventsListener(err)
      );
    this._pageScopedRealtimeListeners.events = unsub;
  },

  _stopEventsRealtimeListener() {
    if (this._pageScopedRealtimeListeners.events) {
      this._pageScopedRealtimeListeners.events();
      this._pageScopedRealtimeListeners.events = null;
    }
    this._realtimeListenerStarted.events = false;
  },

  _reconnectEventsListener(err) {
    console.warn('[onSnapshot] events 監聽錯誤:', err);
    this._pageScopedRealtimeListeners.events = null;
    this._realtimeListenerStarted.events = false;
    const key = 'events';
    const attempts = (this._snapshotReconnectAttempts[key] || 0) + 1;
    this._snapshotReconnectAttempts[key] = attempts;
    if (attempts > 5) {
      console.warn(`[onSnapshot] events 重連已達上限 (${attempts} 次)，停止重試`);
      return;
    }
    const baseDelay = Math.min(1000 * Math.pow(2, attempts - 1), 30000);
    const delay = Math.round(baseDelay + baseDelay * Math.random() * 0.3); // +0~30% jitter
    console.log(`[onSnapshot] events 將在 ${delay}ms 後重連 (第 ${attempts} 次)`);
    this._reconnectTimers.events = setTimeout(() => {
      delete this._reconnectTimers.events;
      const pageId = typeof App !== 'undefined' ? App.currentPage : '';
      if (this._getPageScopedRealtimeCollections(pageId).includes('events')) {
        this._startEventsRealtimeListener();
      }
    }, delay);
  },

  _reconnectAttendanceRecordsListener(err) {
    console.warn('[onSnapshot] attendanceRecords 監聯錯誤:', err);
    this._pageScopedRealtimeListeners.attendanceRecords = null;
    this._realtimeListenerStarted.attendanceRecords = false;

    const key = 'attendanceRecords';
    const attempts = (this._snapshotReconnectAttempts[key] || 0) + 1;
    this._snapshotReconnectAttempts[key] = attempts;
    if (attempts > 5) {
      console.warn(`[onSnapshot] attendanceRecords 重連已達上限 (${attempts} 次)，停止重試`);
      return;
    }
    const baseDelay = Math.min(1000 * Math.pow(2, attempts - 1), 30000);
    const delay = Math.round(baseDelay + baseDelay * Math.random() * 0.3); // +0~30% jitter
    console.log(`[onSnapshot] attendanceRecords 將在 ${delay}ms 後重連 (第 ${attempts} 次)`);
    this._reconnectTimers.attendanceRecords = setTimeout(() => {
      delete this._reconnectTimers.attendanceRecords;
      if (!auth?.currentUser) return;
      const pageId = typeof App !== 'undefined' ? App.currentPage : '';
      if (this._getPageScopedRealtimeCollections(pageId).includes('attendanceRecords')) {
        this._startAttendanceRecordsListener();
      }
    }, delay);
  },

  destroy() {
    this._listeners.forEach(unsub => unsub());
    this._listeners = [];
    this._listenersSuspended = false;
    this._stopUsersListener();
    this._stopMessagesListener();
    this._stopRegistrationsListener();
    this._stopAttendanceRecordsListener();
    this._stopEventsRealtimeListener();
    if (this._userListener) {
      this._userListener();
      this._userListener = null;
    }
    this._onUserChanged = null;
    this._initialized = false;
    this._lazyLoaded = {};
    this._bootCollectionLoadFailed = {};
    this._collectionLoadedAt = {};
    this._realtimeListenerStarted = {};
    this._authPromise = null;
    this._authDependentWorkPromise = null;
    this._authDependentWorkUid = null;
    // RC4：清除重連 timer + 計數
    Object.values(this._reconnectTimers).forEach(id => clearTimeout(id));
    this._reconnectTimers = {};
    this._snapshotReconnectAttempts = {};
    // RC3：清除 visibilitychange listener + debounce timer
    clearTimeout(this._visibilityRefreshDebounce);
    if (this._visibilityRefreshHandler) {
      document.removeEventListener('visibilitychange', this._visibilityRefreshHandler);
      this._visibilityRefreshHandler = null;
      this._visibilityRefreshBound = false;
    }
    this._registrationsRevalidating = false;
    // 重置快取到初始空白狀態
    Object.keys(this._cache).forEach(k => {
      if (k === 'currentUser') { this._cache[k] = null; }
      else if (k === 'rolePermissions' || k === 'rolePermissionMeta') { this._cache[k] = {}; }
      else { this._cache[k] = []; }
    });
  },
};
