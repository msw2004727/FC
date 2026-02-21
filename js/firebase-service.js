/* ================================================
   SportHub — Firebase Service (Cache-First Pattern)
   ================================================
   策略：
   1. init() 按需載入 Firestore 集合到 _cache
   2. _cache 結構與 DemoData 完全相同 → render 方法零修改
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

  // ─── 記憶體快取（與 DemoData 結構一致）───
  _cache: {
    events: [],
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
    adminMessages: [],
    notifTemplates: [],
    rolePermissions: {},
    customRoles: [],
    currentUser: null,
  },

  _listeners: [],
  _userListener: null,
  _onUserChanged: null,
  _initialized: false,
  _lazyLoaded: {},  // 記錄已懶載入的集合

  // ─── localStorage 快取設定 ───
  _LS_PREFIX: 'shub_c_',
  _LS_TS_KEY: 'shub_cache_ts',
  _LS_TTL: 30 * 60 * 1000, // 30 分鐘快取有效期

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

  /** 儲存集合到 localStorage */
  _saveToLS(name, data) {
    try {
      const json = JSON.stringify(data);
      // 單一集合超過 500KB 就不存（避免 localStorage 爆掉）
      if (json.length > 512000) return;
      localStorage.setItem(this._LS_PREFIX + name, json);
    } catch (e) { /* quota exceeded — 忽略 */ }
  },

  /** 從 localStorage 讀取集合 */
  _loadFromLS(name) {
    try {
      const raw = localStorage.getItem(this._LS_PREFIX + name);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
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
    localStorage.setItem(this._LS_TS_KEY, Date.now().toString());
  },

  /** 從 localStorage 恢復快取（回傳是否成功） */
  _restoreCache() {
    const ts = parseInt(localStorage.getItem(this._LS_TS_KEY) || '0', 10);
    if (Date.now() - ts > this._LS_TTL) return false;

    let restored = 0;
    const allCollections = [
      ...this._bootCollections, ...this._liveCollections,
      ...this._deferredCollections, 'adminUsers',
    ];
    allCollections.forEach(name => {
      const data = this._loadFromLS(name);
      if (data && data.length > 0) {
        this._cache[name] = data;
        restored++;
      }
    });
    const rp = this._loadFromLS('rolePermissions');
    if (rp && Object.keys(rp).length > 0) {
      this._cache.rolePermissions = rp;
      restored++;
    }
    console.log(`[FirebaseService] localStorage 快取恢復: ${restored} 個集合 (${Math.round((Date.now() - ts) / 1000)}s ago)`);
    return restored > 3; // 至少恢復 3 個集合才算有效
  },

  // ════════════════════════════════
  //  初始化：分層載入集合到快取
  // ════════════════════════════════

  // 需要即時監聽的集合（核心互動功能）— 加 query 過濾
  _liveCollections: ['events', 'messages', 'registrations', 'teams'],

  // 啟動時必要的靜態集合（首頁 + 全域 UI 需要）
  _bootCollections: [
    'banners', 'floatingAds', 'popupAds', 'sponsors',
    'announcements', 'siteThemes', 'achievements', 'badges',
  ],

  // 延遲載入的靜態集合（進入對應頁面時才載入）
  _deferredCollections: [
    'tournaments', 'shopItems', 'leaderboard', 'standings', 'matches',
    'trades', 'attendanceRecords', 'activityRecords',
    'expLogs', 'teamExpLogs', 'operationLogs',
    'adminMessages', 'notifTemplates', 'permissions', 'customRoles',
  ],

  // 集合 → 頁面映射（用於懶載入觸發）
  _collectionPageMap: {
    'page-tournaments':       ['tournaments', 'standings', 'matches'],
    'page-shop':              ['shopItems', 'trades'],
    'page-activities':        ['attendanceRecords', 'activityRecords'],
    'page-my-activities':     ['attendanceRecords', 'activityRecords', 'registrations'],
    'page-admin-dashboard':   ['expLogs', 'teamExpLogs', 'operationLogs', 'attendanceRecords', 'activityRecords'],
    'page-admin-users':       ['permissions', 'customRoles'],
    'page-admin-messages':    ['adminMessages', 'notifTemplates'],
    'page-admin-exp':         ['expLogs', 'teamExpLogs'],
    'page-admin-auto-exp':    ['expLogs'],
    'page-admin-achievements': ['achievements', 'badges'],
    'page-admin-roles':       ['permissions', 'customRoles'],
    'page-admin-logs':        ['operationLogs'],
    'page-admin-inactive':    ['attendanceRecords', 'activityRecords', 'operationLogs'],
    'page-admin-teams':       ['tournaments', 'standings', 'matches'],
    'page-personal-dashboard': ['attendanceRecords', 'activityRecords'],
    'page-leaderboard':       ['leaderboard'],
  },

  /** 根據頁面 ID 懶載入對應的集合 */
  async ensureCollectionsForPage(pageId) {
    if (ModeManager.isDemo()) return;
    if (!this._initialized) return;
    const needed = this._collectionPageMap[pageId];
    if (!needed) return;

    const toLoad = needed.filter(name => !this._lazyLoaded[name]);
    if (toLoad.length === 0) return;

    console.log(`[FirebaseService] 懶載入 ${pageId} 需要的集合:`, toLoad.join(', '));
    await this._loadStaticCollections(toLoad);
    toLoad.forEach(name => { this._lazyLoaded[name] = true; });
    // 持久化新載入的集合
    this._persistCache();
  },

  /** 載入指定的靜態集合 */
  async _loadStaticCollections(names) {
    const promises = names.map(name =>
      db.collection(name).orderBy(firebase.firestore.FieldPath.documentId()).limit(500).get().catch(err => {
        console.warn(`Collection "${name}" 載入失敗:`, err);
        return { docs: [] };
      })
    );
    const snapshots = await Promise.all(promises);
    names.forEach((name, i) => {
      const docs = snapshots[i].docs.map(doc => ({ ...doc.data(), _docId: doc.id }));
      const seen = new Set();
      this._cache[name] = docs.filter(d => {
        if (!d.id) return true;
        if (seen.has(d.id)) return false;
        seen.add(d.id);
        return true;
      });
    });
  },

  async init() {
    if (this._initialized) return;

    // ── Step 1: 嘗試從 localStorage 恢復快取 ──
    const hasLocalCache = this._restoreCache();

    // 匿名登入 Firebase Auth（讓 Firestore 安全規則 request.auth != null 通過）
    try {
      const cred = await auth.signInAnonymously();
      console.log('[FirebaseService] Firebase Auth 匿名登入成功, uid:', cred.user?.uid);
    } catch (err) {
      console.error('[FirebaseService] Firebase Auth 匿名登入失敗:', err.code, err.message);
      this._authError = err;
    }

    // ── Step 2: 啟動集合（首頁需要的靜態集合）──
    const bootPromises = this._bootCollections.map(name =>
      db.collection(name).orderBy(firebase.firestore.FieldPath.documentId()).limit(200).get().catch(err => {
        console.warn(`Collection "${name}" 載入失敗:`, err);
        return { docs: [] };
      })
    );

    // ── Step 3: 即時集合 + users — onSnapshot 加 query 過濾 ──
    const livePromise = new Promise(resolve => {
      let pending = this._liveCollections.length + 1; // +1 for users
      const checkDone = () => { if (--pending === 0) resolve(); };

      // events: 只監聽非結束/取消的活動（limit 200）
      {
        let firstSnapshot = true;
        const unsub = db.collection('events')
          .where('status', 'in', ['open', 'full', 'upcoming'])
          .limit(200)
          .onSnapshot(
            snapshot => {
              // 合併：快取中的 ended/cancelled + 遠端的 active
              const activeIds = new Set(snapshot.docs.map(d => d.id));
              const kept = this._cache.events.filter(e =>
                (e.status === 'ended' || e.status === 'cancelled') && !activeIds.has(e._docId)
              );
              const active = snapshot.docs.map(doc => ({ ...doc.data(), _docId: doc.id }));
              this._cache.events = [...active, ...kept];
              this._saveToLS('events', this._cache.events);
              if (firstSnapshot) { firstSnapshot = false; checkDone(); }
            },
            err => { console.warn('[onSnapshot] events 監聽錯誤:', err); checkDone(); }
          );
        this._listeners.push(unsub);
      }

      // messages: 最新 200 筆
      {
        let firstSnapshot = true;
        const unsub = db.collection('messages')
          .orderBy('timestamp', 'desc')
          .limit(200)
          .onSnapshot(
            snapshot => {
              this._cache.messages = snapshot.docs.map(doc => ({ ...doc.data(), _docId: doc.id }));
              this._saveToLS('messages', this._cache.messages);
              if (firstSnapshot) { firstSnapshot = false; checkDone(); }
            },
            err => { console.warn('[onSnapshot] messages 監聽錯誤:', err); checkDone(); }
          );
        this._listeners.push(unsub);
      }

      // registrations: limit 500（報名資料量較大）
      {
        let firstSnapshot = true;
        const unsub = db.collection('registrations')
          .limit(500)
          .onSnapshot(
            snapshot => {
              this._cache.registrations = snapshot.docs.map(doc => ({ ...doc.data(), _docId: doc.id }));
              this._saveToLS('registrations', this._cache.registrations);
              if (firstSnapshot) { firstSnapshot = false; checkDone(); }
            },
            err => { console.warn('[onSnapshot] registrations 監聽錯誤:', err); checkDone(); }
          );
        this._listeners.push(unsub);
      }

      // teams: limit 100
      {
        let firstSnapshot = true;
        const unsub = db.collection('teams')
          .limit(100)
          .onSnapshot(
            snapshot => {
              this._cache.teams = snapshot.docs.map(doc => ({ ...doc.data(), _docId: doc.id }));
              this._saveToLS('teams', this._cache.teams);
              if (firstSnapshot) { firstSnapshot = false; checkDone(); }
            },
            err => { console.warn('[onSnapshot] teams 監聯錯誤:', err); checkDone(); }
          );
        this._listeners.push(unsub);
      }

      // users → adminUsers: limit 300
      {
        let firstUserSnapshot = true;
        const unsubUsers = db.collection('users')
          .limit(300)
          .onSnapshot(
            snapshot => {
              this._cache.adminUsers = snapshot.docs.map(doc => this._mapUserDoc(doc.data(), doc.id));
              this._saveToLS('adminUsers', this._cache.adminUsers);
              if (firstUserSnapshot) { firstUserSnapshot = false; checkDone(); }
            },
            err => { console.warn('[onSnapshot] users 監聽錯誤:', err); checkDone(); }
          );
        this._listeners.push(unsubUsers);
      }
    });

    // ── Step 4: 平行等待 boot + live ──
    const [bootSnapshots] = await Promise.all([
      Promise.all(bootPromises),
      livePromise,
    ]);

    // 填入 boot 集合快取
    this._bootCollections.forEach((name, i) => {
      const docs = bootSnapshots[i].docs.map(doc => ({ ...doc.data(), _docId: doc.id }));
      const seen = new Set();
      this._cache[name] = docs.filter(d => {
        if (!d.id) return true;
        if (seen.has(d.id)) return false;
        seen.add(d.id);
        return true;
      });
    });
    this._bootCollections.forEach(name => { this._lazyLoaded[name] = true; });

    // ── Step 5: rolePermissions ──
    try {
      const rpSnap = await db.collection('rolePermissions').get();
      if (!rpSnap.empty) {
        this._cache.rolePermissions = {};
        rpSnap.docs.forEach(doc => { this._cache.rolePermissions[doc.id] = doc.data().permissions || []; });
      }
    } catch (err) { console.warn('[FirebaseService] rolePermissions 載入失敗:', err); }

    // ── Step 6: Seed 操作（僅首次需要）──
    await this._cleanupDuplicateDocs();
    await this._seedAdSlots();
    await this._seedNotifTemplates();
    await this._seedAchievements();
    await this._seedRoleData();

    this._initialized = true;

    // ── Step 7: 持久化快取到 localStorage ──
    this._persistCache();

    const bootCount = this._bootCollections.length;
    const liveCount = this._liveCollections.length + 1;
    console.log(`[FirebaseService] 初始化完成 — boot: ${bootCount}, live: ${liveCount}, deferred: ${this._deferredCollections.length} 個集合待懶載入`);

    // ── Step 8: 背景載入已結束的活動（補齊完整列表）──
    this._loadEndedEvents();
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
      if (this._cache[collectionName].length > 0) return;
      console.log(`[FirebaseService] 建立空白 ${collectionName} 欄位...`);
      const batch = db.batch();
      slots.forEach(slot => {
        const ref = db.collection(collectionName).doc(slot.id);
        batch.set(ref, { ...slot, createdAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      });
      await batch.commit();
      slots.forEach(slot => {
        slot._docId = slot.id;
        this._cache[collectionName].push(slot);
      });
    };

    // 每個集合獨立 try-catch，避免單一失敗導致後續全部跳過
    const seeds = [
      ['banners', [
        { id: 'ban1', slot: 1, title: '', image: null, status: 'empty', publishAt: null, unpublishAt: null, clicks: 0, gradient: '' },
        { id: 'ban2', slot: 2, title: '', image: null, status: 'empty', publishAt: null, unpublishAt: null, clicks: 0, gradient: '' },
        { id: 'ban3', slot: 3, title: '', image: null, status: 'empty', publishAt: null, unpublishAt: null, clicks: 0, gradient: '' },
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
  //  自動建立通知模板
  // ════════════════════════════════

  async _seedNotifTemplates() {
    if (this._cache.notifTemplates.length > 0) return;
    console.log('[FirebaseService] 建立預設通知模板...');
    const defaults = [
      { key: 'welcome', title: '歡迎加入 SportHub！', body: '嗨 {userName}，歡迎加入 SportHub 平台！\n\n您可以在這裡瀏覽並報名各類足球活動、加入球隊、參與聯賽。\n祝您使用愉快！' },
      { key: 'signup_success', title: '報名成功通知', body: '您已成功報名以下活動：\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n報名狀態：{status}\n\n請準時出席，如需取消請提前至活動頁面操作。' },
      { key: 'waitlist_promoted', title: '候補遞補通知', body: '恭喜！由於有人取消報名，您已從候補名單自動遞補為正式參加者。\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n請準時出席！' },
      { key: 'event_cancelled', title: '活動取消通知', body: '很抱歉通知您，以下活動因故取消：\n\n活動名稱：{eventName}\n原定時間：{date}\n原定地點：{location}\n\n如您已繳費，費用將於 3 個工作天內退還。造成不便深感抱歉。' },
      { key: 'role_upgrade', title: '身份變更通知', body: '恭喜 {userName}！您的身份已變更為「{roleName}」。\n\n新身份可能帶來新的權限與功能，請至個人資料頁面查看詳情。\n感謝您對社群的貢獻！' },
      { key: 'event_changed', title: '活動變更通知', body: '您報名的活動資訊有所變更，請留意：\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n如因變更需要取消報名，請至活動頁面操作。' },
    ];
    try {
      const batch = db.batch();
      defaults.forEach(t => {
        const ref = db.collection('notifTemplates').doc(t.key);
        batch.set(ref, { ...t, createdAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      });
      await batch.commit();
      defaults.forEach(t => {
        t._docId = t.key;
        this._cache.notifTemplates.push(t);
      });
    } catch (err) {
      console.warn('[FirebaseService] 通知模板建立失敗:', err);
    }
  },

  // ════════════════════════════════
  //  自動建立預設成就與徽章
  // ════════════════════════════════

  // 預設成就與徽章資料（與 DemoData 一致）
  _defaultAchievements: [
    { id: 'a1', name: '初心者', category: 'bronze', badgeId: 'b1', completedAt: '2025/09/10', current: 1, status: 'active', condition: { timeRange: 'none', action: 'register_event', filter: 'all', threshold: 1 } },
    { id: 'a2', name: '全勤之星', category: 'silver', badgeId: 'b2', completedAt: '2026/01/20', current: 90, status: 'active', condition: { timeRange: 'none', action: 'attendance_rate', filter: 'all', threshold: 90 } },
    { id: 'a3', name: '鐵人精神', category: 'silver', badgeId: 'b3', completedAt: '2026/02/05', current: 30, status: 'active', condition: { timeRange: 'none', action: 'complete_event', filter: 'all', threshold: 30 } },
    { id: 'a4', name: '社群達人', category: 'silver', badgeId: 'b4', completedAt: '2026/01/15', current: 1, status: 'active', condition: { timeRange: 'none', action: 'bind_line_notify', filter: 'all', threshold: 1 } },
    { id: 'a5', name: '月活躍玩家', category: 'gold', badgeId: 'b5', completedAt: null, current: 3, status: 'active', condition: { timeRange: '30d', action: 'complete_event', filter: 'all', threshold: 5 } },
    { id: 'a6', name: '活動策劃師', category: 'gold', badgeId: 'b6', completedAt: null, current: 2, status: 'active', condition: { timeRange: 'none', action: 'organize_event', filter: 'all', threshold: 10 } },
    { id: 'a7', name: '百場達人', category: 'gold', badgeId: 'b7', completedAt: null, current: 42, status: 'active', condition: { timeRange: 'none', action: 'complete_event', filter: 'all', threshold: 100 } },
  ],
  _defaultBadges: [
    { id: 'b1', name: '新手徽章', achId: 'a1', category: 'bronze', image: null },
    { id: 'b2', name: '全勤徽章', achId: 'a2', category: 'silver', image: null },
    { id: 'b3', name: '鐵人徽章', achId: 'a3', category: 'silver', image: null },
    { id: 'b4', name: '社群徽章', achId: 'a4', category: 'silver', image: null },
    { id: 'b5', name: '月活躍徽章', achId: 'a5', category: 'gold', image: null },
    { id: 'b6', name: '策劃師徽章', achId: 'a6', category: 'gold', image: null },
    { id: 'b7', name: '百場徽章', achId: 'a7', category: 'gold', image: null },
  ],

  async _seedAchievements() {
    // 使用 localStorage 標記（比 Firestore _meta 更可靠，不受權限影響）
    if (localStorage.getItem('sporthub_ach_seeded')) return;

    const existing = this._cache.achievements;

    // 已有資料 → 標記已初始化並檢查遷移
    if (existing.length > 0) {
      localStorage.setItem('sporthub_ach_seeded', '1');
      // 檢查是否需要遷移（舊版 seed 全部 current:0）
      const needsMigration = existing.every(a => !a.current && !a.completedAt);
      if (!needsMigration) return;
      console.log('[FirebaseService] 遷移成就資料（補上初始進度）...');
      try {
        const batch = db.batch();
        this._defaultAchievements.forEach(def => {
          const doc = existing.find(a => a.id === def.id);
          if (doc && doc._docId) {
            batch.update(db.collection('achievements').doc(doc._docId), { current: def.current, completedAt: def.completedAt });
            doc.current = def.current;
            doc.completedAt = def.completedAt;
          }
        });
        await batch.commit();
        console.log('[FirebaseService] 成就資料遷移完成');
      } catch (err) { console.warn('[FirebaseService] 成就遷移失敗:', err); }
      return;
    }

    // 全新建立
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
    // DemoData 未載入時跳過 seed（正式版不需要 Demo 資料）
    if (typeof DemoData === 'undefined') return;

    // 1. Seed permissions（權限分類定義）
    if (this._cache.permissions.length === 0) {
      console.log('[FirebaseService] 建立預設權限定義...');
      try {
        const perms = DemoData.permissions;
        const batch = db.batch();
        perms.forEach((cat, i) => {
          const docId = 'perm_' + i;
          batch.set(db.collection('permissions').doc(docId), cat, { merge: true });
        });
        await batch.commit();
        this._cache.permissions = perms.map((cat, i) => ({ ...cat, _docId: 'perm_' + i }));
      } catch (err) { console.warn('[FirebaseService] 權限定義建立失敗:', err); }
    }

    // 2. Seed rolePermissions（角色→權限映射）
    if (Object.keys(this._cache.rolePermissions).length === 0) {
      console.log('[FirebaseService] 建立預設角色權限...');
      try {
        const rp = DemoData.rolePermissions;
        const batch = db.batch();
        Object.entries(rp).forEach(([role, permissions]) => {
          batch.set(db.collection('rolePermissions').doc(role), { permissions }, { merge: true });
        });
        await batch.commit();
        this._cache.rolePermissions = { ...rp };
        console.log('[FirebaseService] 預設角色權限建立完成');
      } catch (err) { console.warn('[FirebaseService] 角色權限建立失敗:', err); }
    }
  },

  // ════════════════════════════════
  //  清理
  // ════════════════════════════════

  destroy() {
    this._listeners.forEach(unsub => unsub());
    this._listeners = [];
    if (this._userListener) {
      this._userListener();
      this._userListener = null;
    }
    this._onUserChanged = null;
    this._initialized = false;
    this._lazyLoaded = {};
    // 重置快取到初始空白狀態
    Object.keys(this._cache).forEach(k => {
      if (k === 'currentUser') { this._cache[k] = null; }
      else if (k === 'rolePermissions') { this._cache[k] = {}; }
      else { this._cache[k] = []; }
    });
  },
};
