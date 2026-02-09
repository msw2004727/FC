/* ================================================
   SportHub — Firebase Service (Cache-First Pattern)
   ================================================
   策略：
   1. init() 平行載入所有 Firestore 集合到 _cache
   2. _cache 結構與 DemoData 完全相同 → render 方法零修改
   3. 寫入操作：先更新 cache（同步），再寫 Firestore（背景）
   4. onSnapshot 監聽器即時同步遠端更新
   ================================================ */

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
    operationLogs: [],
    banners: [],
    achievements: [],
    badges: [],
    adminUsers: [],
    permissions: [],
    activityRecords: [],
    registrations: [],
  },

  _listeners: [],
  _initialized: false,

  // ════════════════════════════════
  //  初始化：載入所有集合到快取
  // ════════════════════════════════

  async init() {
    const collectionNames = Object.keys(this._cache);

    // 平行載入所有集合
    const snapshots = await Promise.all(
      collectionNames.map(name =>
        db.collection(name).get().catch(err => {
          console.warn(`Collection "${name}" 載入失敗:`, err);
          return { docs: [] };
        })
      )
    );

    // 填入快取
    collectionNames.forEach((name, i) => {
      this._cache[name] = snapshots[i].docs.map(doc => ({
        ...doc.data(),
        _docId: doc.id,
      }));
    });

    // 啟動即時監聽
    this._setupListeners();
    this._initialized = true;
    console.log('[FirebaseService] 快取載入完成，共', collectionNames.length, '個集合');
  },

  // ════════════════════════════════
  //  即時監聽（可變集合）
  // ════════════════════════════════

  _setupListeners() {
    const liveCollections = [
      'events', 'tournaments', 'teams', 'shopItems',
      'messages', 'registrations', 'leaderboard',
      'standings', 'matches', 'trades',
    ];

    liveCollections.forEach(name => {
      const unsub = db.collection(name).onSnapshot(
        snapshot => {
          this._cache[name] = snapshot.docs.map(doc => ({
            ...doc.data(),
            _docId: doc.id,
          }));
        },
        err => console.warn(`[onSnapshot] ${name} 監聽錯誤:`, err)
      );
      this._listeners.push(unsub);
    });
  },

  // ════════════════════════════════
  //  Events CRUD
  // ════════════════════════════════

  async addEvent(eventData) {
    // 圖片上傳至 Storage
    if (eventData.image && eventData.image.startsWith('data:')) {
      eventData.image = await this._uploadImage(eventData.image, `events/${eventData.id}`);
    }
    const docRef = await db.collection('events').add({
      ...eventData,
      _docId: undefined,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    eventData._docId = docRef.id;
    return eventData;
  },

  async updateEvent(id, updates) {
    const doc = this._cache.events.find(e => e.id === id);
    if (!doc || !doc._docId) return null;
    updates.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection('events').doc(doc._docId).update(updates);
    return doc;
  },

  async deleteEvent(id) {
    const doc = this._cache.events.find(e => e.id === id);
    if (!doc || !doc._docId) return false;
    await db.collection('events').doc(doc._docId).delete();
    return true;
  },

  // ════════════════════════════════
  //  Registrations（報名系統）
  // ════════════════════════════════

  async registerForEvent(eventId, userId, userName) {
    const event = this._cache.events.find(e => e.id === eventId);
    if (!event) throw new Error('活動不存在');

    // 檢查重複報名
    const existing = this._cache.registrations.find(
      r => r.eventId === eventId && r.userId === userId && r.status !== 'cancelled'
    );
    if (existing) throw new Error('已報名此活動');

    const status = event.current >= event.max ? 'waitlisted' : 'confirmed';
    const registration = {
      id: 'reg_' + Date.now(),
      eventId,
      userId,
      userName,
      status,
      registeredAt: new Date().toISOString(),
    };

    // 寫入 Firestore
    const docRef = await db.collection('registrations').add({
      ...registration,
      registeredAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    registration._docId = docRef.id;
    this._cache.registrations.push(registration);

    // 更新活動計數
    if (status === 'confirmed') {
      event.current++;
      if (!event.participants) event.participants = [];
      event.participants.push(userName);
    } else {
      event.waitlist++;
      if (!event.waitlistNames) event.waitlistNames = [];
      event.waitlistNames.push(userName);
    }

    await db.collection('events').doc(event._docId).update({
      current: event.current,
      waitlist: event.waitlist,
      participants: event.participants,
      waitlistNames: event.waitlistNames,
    });

    return { registration, status };
  },

  async cancelRegistration(registrationId) {
    const reg = this._cache.registrations.find(r => r.id === registrationId);
    if (!reg) throw new Error('報名記錄不存在');

    reg.status = 'cancelled';
    reg.cancelledAt = new Date().toISOString();

    await db.collection('registrations').doc(reg._docId).update({
      status: 'cancelled',
      cancelledAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    // 更新活動計數
    const event = this._cache.events.find(e => e.id === reg.eventId);
    if (event) {
      const pIdx = (event.participants || []).indexOf(reg.userName);
      if (pIdx >= 0) {
        event.participants.splice(pIdx, 1);
        event.current = Math.max(0, event.current - 1);
      }
      const wIdx = (event.waitlistNames || []).indexOf(reg.userName);
      if (wIdx >= 0) {
        event.waitlistNames.splice(wIdx, 1);
        event.waitlist = Math.max(0, event.waitlist - 1);
      }

      // 候補遞補：將第一位候補轉為正式
      if (event.waitlistNames && event.waitlistNames.length > 0 && event.current < event.max) {
        const promoted = event.waitlistNames.shift();
        event.waitlist = Math.max(0, event.waitlist - 1);
        event.participants.push(promoted);
        event.current++;

        // 更新被遞補者的 registration 狀態
        const promotedReg = this._cache.registrations.find(
          r => r.eventId === event.id && r.userName === promoted && r.status === 'waitlisted'
        );
        if (promotedReg) {
          promotedReg.status = 'confirmed';
          if (promotedReg._docId) {
            db.collection('registrations').doc(promotedReg._docId).update({ status: 'confirmed' });
          }
        }
      }

      if (event._docId) {
        await db.collection('events').doc(event._docId).update({
          current: event.current,
          waitlist: event.waitlist,
          participants: event.participants,
          waitlistNames: event.waitlistNames,
        });
      }
    }

    return reg;
  },

  getRegistrationsByUser(userId) {
    return this._cache.registrations.filter(
      r => r.userId === userId && r.status !== 'cancelled'
    );
  },

  getRegistrationsByEvent(eventId) {
    return this._cache.registrations.filter(
      r => r.eventId === eventId && r.status !== 'cancelled'
    );
  },

  // ════════════════════════════════
  //  Tournaments
  // ════════════════════════════════

  async addTournament(data) {
    if (data.image && data.image.startsWith('data:')) {
      data.image = await this._uploadImage(data.image, `tournaments/${data.id}`);
    }
    const docRef = await db.collection('tournaments').add({
      ...data,
      _docId: undefined,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    data._docId = docRef.id;
    return data;
  },

  // ════════════════════════════════
  //  Teams
  // ════════════════════════════════

  async updateTeam(id, updates) {
    const doc = this._cache.teams.find(t => t.id === id);
    if (!doc || !doc._docId) return null;
    await db.collection('teams').doc(doc._docId).update(updates);
    return doc;
  },

  // ════════════════════════════════
  //  Shop
  // ════════════════════════════════

  async addShopItem(data) {
    const docRef = await db.collection('shopItems').add({
      ...data,
      _docId: undefined,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    data._docId = docRef.id;
    return data;
  },

  // ════════════════════════════════
  //  User Points（積分系統）
  // ════════════════════════════════

  async updateUserPoints(userId, pointsDelta, reason) {
    const user = this._cache.adminUsers.find(u => u.uid === userId);
    if (!user) throw new Error('用戶不存在');

    user.exp = (user.exp || 0) + pointsDelta;

    if (user._docId) {
      await db.collection('adminUsers').doc(user._docId).update({
        exp: user.exp,
      });
    }

    // 記錄 EXP 操作日誌
    const now = new Date();
    const log = {
      time: `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      target: user.name,
      amount: (pointsDelta > 0 ? '+' : '') + pointsDelta,
      reason: reason,
    };
    await db.collection('expLogs').add({
      ...log,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    this._cache.expLogs.unshift(log);

    return user;
  },

  // ════════════════════════════════
  //  Image Upload（Firebase Storage）
  // ════════════════════════════════

  async _uploadImage(base64DataUrl, path) {
    try {
      const ref = storage.ref().child(`images/${path}_${Date.now()}`);
      const snapshot = await ref.putString(base64DataUrl, 'data_url');
      return await snapshot.ref.getDownloadURL();
    } catch (err) {
      console.error('[Storage] 圖片上傳失敗:', err);
      return null;
    }
  },

  // ════════════════════════════════
  //  清理
  // ════════════════════════════════

  destroy() {
    this._listeners.forEach(unsub => unsub());
    this._listeners = [];
    this._initialized = false;
  },
};
