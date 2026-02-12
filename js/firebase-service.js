/* ================================================
   SportHub — Firebase Service (Cache-First Pattern)
   ================================================
   策略：
   1. init() 平行載入所有 Firestore 集合到 _cache
   2. _cache 結構與 DemoData 完全相同 → render 方法零修改
   3. 寫入操作：先更新 cache（同步），再寫 Firestore（背景）
   4. onSnapshot 監聽器即時同步遠端更新
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
  //  初始化：載入所有集合到快取
  // ════════════════════════════════

  // 需要即時監聽的集合（核心互動功能）
  _liveCollections: ['events', 'messages', 'registrations', 'teams'],

  // 一次性載入的集合（低頻變動，不需即時同步）
  _staticCollections: [
    'tournaments', 'shopItems', 'leaderboard', 'standings', 'matches',
    'trades', 'banners', 'floatingAds', 'popupAds', 'sponsors',
    'announcements', 'attendanceRecords', 'achievements', 'badges',
    'expLogs', 'teamExpLogs', 'operationLogs', 'activityRecords', 'siteThemes',
    'adminMessages', 'notifTemplates', 'permissions', 'customRoles',
  ],

  async init() {
    if (this._initialized) return;

    // 匿名登入 Firebase Auth（讓 Firestore 安全規則 request.auth != null 通過）
    try {
      const cred = await auth.signInAnonymously();
      console.log('[FirebaseService] Firebase Auth 匿名登入成功, uid:', cred.user?.uid);
    } catch (err) {
      console.error('[FirebaseService] Firebase Auth 匿名登入失敗:', err.code, err.message);
      this._authError = err;
    }

    // ── 靜態集合：一次性 .get() 載入（不開 onSnapshot）──
    const staticPromises = this._staticCollections.map(name =>
      db.collection(name).get().catch(err => {
        console.warn(`Collection "${name}" 載入失敗:`, err);
        return { docs: [] };
      })
    );

    // ── 即時集合 + users：用 onSnapshot 載入（首次快照即為初始資料，無需額外 .get()）──
    const livePromise = new Promise(resolve => {
      let pending = this._liveCollections.length + 1; // +1 for users
      const checkDone = () => { if (--pending === 0) resolve(); };

      // 即時集合監聽
      this._liveCollections.forEach(name => {
        let firstSnapshot = true;
        const unsub = db.collection(name).onSnapshot(
          snapshot => {
            this._cache[name] = snapshot.docs.map(doc => ({ ...doc.data(), _docId: doc.id }));
            if (firstSnapshot) { firstSnapshot = false; checkDone(); }
          },
          err => { console.warn(`[onSnapshot] ${name} 監聽錯誤:`, err); checkDone(); }
        );
        this._listeners.push(unsub);
      });

      // users → adminUsers 即時監聽
      let firstUserSnapshot = true;
      const unsubUsers = db.collection('users').onSnapshot(
        snapshot => {
          this._cache.adminUsers = snapshot.docs.map(doc => this._mapUserDoc(doc.data(), doc.id));
          if (firstUserSnapshot) { firstUserSnapshot = false; checkDone(); }
        },
        err => { console.warn('[onSnapshot] users 監聽錯誤:', err); checkDone(); }
      );
      this._listeners.push(unsubUsers);
    });

    // 平行等待：靜態集合 .get() + 即時集合首次快照
    const [staticSnapshots] = await Promise.all([
      Promise.all(staticPromises),
      livePromise,
    ]);

    // 填入靜態集合快取（以 id 欄位去重，防止 Firestore 有重複文件）
    this._staticCollections.forEach((name, i) => {
      const docs = staticSnapshots[i].docs.map(doc => ({ ...doc.data(), _docId: doc.id }));
      const seen = new Set();
      this._cache[name] = docs.filter(d => {
        if (!d.id) return true;
        if (seen.has(d.id)) return false;
        seen.add(d.id);
        return true;
      });
    });

    // ── rolePermissions：特殊載入（map 結構，非 flat array）──
    try {
      const rpSnap = await db.collection('rolePermissions').get();
      if (!rpSnap.empty) {
        this._cache.rolePermissions = {};
        rpSnap.docs.forEach(doc => { this._cache.rolePermissions[doc.id] = doc.data().permissions || []; });
      }
    } catch (err) { console.warn('[FirebaseService] rolePermissions 載入失敗:', err); }

    // 清除 Firestore 中的重複文件（一次性修復）
    await this._cleanupDuplicateDocs();
    // 自動建立空白廣告欄位（若 Firestore 尚無資料）
    await this._seedAdSlots();
    // 自動建立通知模板（若 Firestore 尚無資料）
    await this._seedNotifTemplates();
    // 自動建立預設成就與徽章（若 Firestore 尚無資料）
    await this._seedAchievements();
    // 自動建立權限定義與角色權限（若 Firestore 尚無資料）
    await this._seedRoleData();

    this._initialized = true;
    const totalCollections = this._liveCollections.length + this._staticCollections.length + 1;
    console.log('[FirebaseService] 快取載入完成，共', totalCollections, '個集合（即時:', this._liveCollections.length + 1, '/ 靜態:', this._staticCollections.length, '）');
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
    // 重置快取到初始空白狀態
    Object.keys(this._cache).forEach(k => {
      if (k === 'currentUser') { this._cache[k] = null; }
      else if (k === 'rolePermissions') { this._cache[k] = {}; }
      else { this._cache[k] = []; }
    });
  },
};
