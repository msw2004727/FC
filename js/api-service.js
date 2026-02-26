/* ================================================
   SportHub — API Service 抽象層
   ================================================
   ModeManager.isDemo() = true  → 讀取 DemoData（Demo 演示）
   ModeManager.isDemo() = false → 讀取 FirebaseService._cache（正式版）

   切換方式：透過 ModeManager 統一管理
   App 層的渲染邏輯完全不需要改動。
   ================================================ */

const ApiService = {

  get _demoMode() { return ModeManager.isDemo(); },

  _isCurrentUserRestricted() {
    if (this._demoMode) return false;
    const user = this.getCurrentUser ? this.getCurrentUser() : null;
    return !!(user && user.isRestricted === true);
  },

  _handleRestrictedAction() {
    if (!this._isCurrentUserRestricted()) return false;
    try {
      if (typeof App !== 'undefined') {
        App.showToast?.('帳號限制中');
        App._handleRestrictedStateChange?.();
      }
    } catch (_) {}
    return true;
  },

  async _hasFreshFirebaseUser(forceRefreshToken = false) {
    if (typeof auth === 'undefined' || !auth) return false;
    // 等待 Firebase Auth 從持久化儲存恢復登入狀態（最多 5 秒）
    if (typeof _firebaseAuthReadyPromise !== 'undefined' && !_firebaseAuthReady) {
      try {
        await Promise.race([
          _firebaseAuthReadyPromise,
          new Promise(r => setTimeout(r, 5000)),
        ]);
      } catch (_) {}
    }
    if (!auth.currentUser) return false;
    try {
      await auth.currentUser.getIdToken(!!forceRefreshToken);
      return true;
    } catch (err) {
      console.warn('[ApiService] Firebase token check failed:', err);
      return false;
    }
  },

  _hasLiffSession() {
    try {
      return typeof LineAuth !== 'undefined'
        && typeof LineAuth.hasLiffSession === 'function'
        && LineAuth.hasLiffSession();
    } catch (_) {
      return false;
    }
  },

  _hasLineAccessToken() {
    try {
      return typeof LineAuth !== 'undefined'
        && typeof LineAuth.getAccessToken === 'function'
        && !!LineAuth.getAccessToken();
    } catch (_) {
      return false;
    }
  },

  _logAttendanceAuthState(stage, err) {
    try {
      console.warn('[ApiService][AttendanceAuth]', {
        stage,
        authUid: (typeof auth !== 'undefined' && auth?.currentUser) ? auth.currentUser.uid : null,
        hasLiffSession: this._hasLiffSession(),
        hasLineAccessToken: this._hasLineAccessToken(),
        errorCode: err?.code || null,
        errorMessage: err?.message || String(err || ''),
      });
    } catch (_) {}
  },

  async _ensureFirebaseWriteAuth(options = {}) {
    const { forceRefreshToken = false, forceReauth = false } = options;
    if (this._demoMode) return true;

    if (!forceReauth && await this._hasFreshFirebaseUser(forceRefreshToken)) {
      return true;
    }

    console.warn('[ApiService] auth.currentUser 為空或 token 無效，嘗試重新登入...',
      { hasAuth: typeof auth !== 'undefined' && !!auth,
        currentUser: auth?.currentUser?.uid || null,
        liffLoggedIn: this._hasLiffSession(),
        hasAccessToken: this._hasLineAccessToken() });

    if (forceReauth && typeof auth !== 'undefined' && auth?.currentUser) {
      try {
        await auth.signOut();
      } catch (err) {
        console.warn('[ApiService] Firebase signOut before reauth failed:', err);
      }
    }

    if (typeof FirebaseService !== 'undefined' && typeof FirebaseService._signInWithAppropriateMethod === 'function') {
      try {
        await FirebaseService._signInWithAppropriateMethod();
      } catch (err) {
        console.warn('[ApiService] Firebase write auth retry failed:', err);
      }
    }

    const result = await this._hasFreshFirebaseUser(true);
    if (!result) {
      console.error('[ApiService] 重新登入後 auth.currentUser 仍為空',
        { currentUser: auth?.currentUser?.uid || null });
    }
    return result;
  },

  _isAttendancePermissionError(err) {
    const raw = String(err?.message || err || '').trim();
    const normalized = raw.toLowerCase().replace(/\s+/g, '');
    const code = String(err?.code || '').toLowerCase();
    return (
      normalized.includes('missingorinsufficientpermissions')
      || normalized.includes('permission-denied')
      || normalized.includes('insufficientpermissions')
      || normalized.includes('unauthenticated')
      || code.includes('permission-denied')
      || code.includes('unauthenticated')
    );
  },

  _mapAttendanceWriteError(err) {
    const raw = String(err?.message || err || '').trim();
    const normalized = raw.toLowerCase().replace(/\s+/g, '');
    if (this._isAttendancePermissionError(err)) {
      if (!this._hasLiffSession()) {
        return '未偵測到 LINE 登入，請關閉後重新從 LINE 開啟';
      }
      if (!this._hasLineAccessToken()) {
        return 'LINE 登入已過期，請關閉後重新從 LINE 開啟';
      }
      // auth.currentUser 存在但 Firestore 拒絕 vs 根本未登入
      const hasUser = typeof auth !== 'undefined' && !!auth?.currentUser;
      if (!hasUser) {
        return 'Firebase 登入失敗，請關閉此頁面後重新從 LINE 開啟';
      }
      return 'Firebase 權限不足，請聯繫管理員確認帳號權限';
    }
    if (normalized.includes('missingrequiredfields')) {
      return '簽到資料格式錯誤，缺少必要欄位';
    }
    return raw || '簽到寫入失敗，請稍後再試';
  },

  async _runAttendanceWriteWithAuthRetry(writeFn, label) {
    if (this._demoMode) return await writeFn();

    const authed = await this._ensureFirebaseWriteAuth({ forceRefreshToken: true });
    if (!authed) {
      this._logAttendanceAuthState(label + ':precheck_failed');
      throw new Error('unauthenticated');
    }

    try {
      return await writeFn();
    } catch (err) {
      if (!this._isAttendancePermissionError(err)) throw err;
      this._logAttendanceAuthState(label + ':first_attempt_denied', err);

      const reauthed = await this._ensureFirebaseWriteAuth({
        forceRefreshToken: true,
        forceReauth: true,
      });
      if (!reauthed) {
        this._logAttendanceAuthState(label + ':reauth_failed', err);
        throw err;
      }

      try {
        return await writeFn();
      } catch (retryErr) {
        this._logAttendanceAuthState(label + ':retry_denied', retryErr);
        throw retryErr;
      }
    }
  },

  // ════════════════════════════════
  //  通用工具方法（消除重複的 demo/production 分支）
  // ════════════════════════════════

  /** 取得資料來源陣列（安全：DemoData 未載入時降級為空陣列） */
  _src(key) {
    if (this._demoMode) {
      return (typeof DemoData !== 'undefined' && DemoData[key]) ? DemoData[key] : [];
    }
    return FirebaseService._cache[key] || [];
  },

  /** 根據 id 查找單筆資料 */
  _findById(key, id) {
    return this._src(key).find(item => item.id === id) || null;
  },

  /** 通用新增：寫入快取 + 非同步寫入 Firebase */
  _create(key, data, firebaseMethod, label, prepend) {
    if (this._handleRestrictedAction()) return null;
    const source = this._src(key);
    if (prepend !== false) { source.unshift(data); } else { source.push(data); }
    if (!this._demoMode && firebaseMethod) {
      firebaseMethod.call(FirebaseService, data).catch(err => console.error(`[${label}]`, err));
    }
    return data;
  },

  /** 通用更新：快取 Object.assign + 非同步寫入 Firebase */
  _update(key, id, updates, firebaseMethod, label) {
    if (this._handleRestrictedAction()) return null;
    const item = this._findById(key, id);
    if (item) Object.assign(item, updates);
    if (!this._demoMode && firebaseMethod) {
      firebaseMethod.call(FirebaseService, id, updates).catch(err => console.error(`[${label}]`, err));
    }
    return item;
  },

  /** 通用刪除：先呼叫 Firebase（需要讀取 _docId），再從快取 splice */
  _delete(key, id, firebaseMethod, label) {
    if (this._handleRestrictedAction()) return false;
    const source = this._src(key);
    // 必須先呼叫 Firebase 刪除（需要從 cache 中找到 _docId），再 splice
    if (!this._demoMode && firebaseMethod) {
      firebaseMethod.call(FirebaseService, id).catch(err => console.error(`[${label}]`, err));
    }
    const idx = source.findIndex(item => item.id === id);
    if (idx >= 0) source.splice(idx, 1);
    // Persist updated cache to localStorage so deleted items don't reappear on refresh
    if (!this._demoMode) {
      FirebaseService._saveToLS(key, source);
    }
    return true;
  },

  // ════════════════════════════════
  //  Events（活動）
  // ════════════════════════════════

  getEvents()       { return this._src('events'); },
  getEvent(id)      { return this._findById('events', id); },

  getActiveEvents() {
    return this._src('events').filter(e => e.status !== 'ended' && e.status !== 'cancelled');
  },

  getHotEvents(withinDays) {
    const now = new Date();
    const limit = new Date(now.getTime() + (withinDays || 14) * 24 * 60 * 60 * 1000);
    return this._src('events').filter(e => {
      if (e.status === 'ended' || e.status === 'cancelled') return false;
      const parts = e.date.split(' ')[0].split('/');
      const eventDate = new Date(+parts[0], +parts[1] - 1, +parts[2]);
      return eventDate >= now && eventDate <= limit;
    });
  },

  createEvent(data)         { return this._create('events', data, FirebaseService.addEvent, 'createEvent'); },
  updateEvent(id, updates)  { return this._update('events', id, updates, FirebaseService.updateEvent, 'updateEvent'); },
  deleteEvent(id)           { return this._delete('events', id, FirebaseService.deleteEvent, 'deleteEvent'); },

  // ════════════════════════════════
  //  Tournaments（賽事）
  // ════════════════════════════════

  getTournaments()    { return this._src('tournaments'); },
  getTournament(id)   { return this._findById('tournaments', id); },
  getStandings()      { return this._src('standings'); },
  getMatches()        { return this._src('matches'); },
  getTrades()         { return this._src('trades'); },

  createTournament(data) { return this._create('tournaments', data, FirebaseService.addTournament, 'createTournament'); },
  updateTournament(id, updates) { return this._update('tournaments', id, updates, FirebaseService.updateTournament, 'updateTournament'); },

  deleteTournament(id) {
    const source = this._src('tournaments');
    const idx = source.findIndex(t => t.id === id);
    if (idx === -1) return;
    const removed = source.splice(idx, 1)[0];
    if (!this._demoMode) {
      if (removed._docId) {
        db.collection('tournaments').doc(removed._docId).delete()
          .catch(err => console.error('[deleteTournament]', err));
      }
      FirebaseService._saveToLS('tournaments', source);
    }
  },

  // ════════════════════════════════
  //  Teams（球隊）
  // ════════════════════════════════

  getTeams()        { return this._src('teams'); },
  getTeam(id)       { return this._findById('teams', id); },
  getActiveTeams()  { return this._src('teams').filter(t => t.active); },

  createTeam(data)        { return this._create('teams', data, FirebaseService.addTeam, 'createTeam'); },
  updateTeam(id, updates) { return this._update('teams', id, updates, FirebaseService.updateTeam, 'updateTeam'); },

  async deleteTeam(id) {
    const source = this._src('teams');

    // 正式版：先取得 _docId 再刪 Firestore，最後才從快取移除
    if (!this._demoMode) {
      const doc = source.find(t => t.id === id);
      if (doc && doc._docId) {
        await FirebaseService.deleteTeam(id);
      } else {
        throw new Error('TEAM_DOC_NOT_FOUND');
      }
    }

    // 從快取移除
    const idx = source.findIndex(t => t.id === id);
    if (idx >= 0) source.splice(idx, 1);
    if (!this._demoMode) FirebaseService._saveToLS('teams', source);

    // 清除所有引用此球隊的用戶
    const users = this._src('adminUsers');
    users.forEach(u => {
      if (u.teamId === id) {
        u.teamId = null;
        u.teamName = null;
        if (!this._demoMode && u._docId) {
          FirebaseService.updateUser(u._docId, { teamId: null, teamName: null })
            .catch(err => console.error('[deleteTeam] clear user team:', err));
        }
      }
    });
    // 清除 currentUser 的球隊引用
    const cur = this.getCurrentUser();
    if (cur && cur.teamId === id) {
      cur.teamId = null;
      cur.teamName = null;
      if (!this._demoMode && cur._docId) {
        FirebaseService.updateUser(cur._docId, { teamId: null, teamName: null })
          .catch(err => console.error('[deleteTeam] clear currentUser team:', err));
      }
    }

    return true;
  },

  // ════════════════════════════════
  //  Shop（二手商品）
  // ════════════════════════════════

  getShopItems()    { return this._src('shopItems'); },
  getShopItem(id)   { return this._findById('shopItems', id); },

  createShopItem(data)        { return this._create('shopItems', data, FirebaseService.addShopItem, 'createShopItem'); },
  updateShopItem(id, updates) { return this._update('shopItems', id, updates, FirebaseService.updateShopItem, 'updateShopItem'); },
  deleteShopItem(id)          { return this._delete('shopItems', id, FirebaseService.deleteShopItem, 'deleteShopItem'); },

  // ════════════════════════════════
  //  Users & Admin（用戶管理）
  // ════════════════════════════════

  getAdminUsers() { return this._src('adminUsers'); },

  getUserRole(name) {
    if (this._demoMode) {
      if (DEMO_USERS[name]) return DEMO_USERS[name];
      if (typeof DemoData !== 'undefined') {
        const u = DemoData.adminUsers.find(u => u.name === name);
        return u ? u.role : 'user';
      }
      return 'user';
    }
    const user = FirebaseService._cache.adminUsers.find(u => u.name === name);
    return user ? user.role : 'user';
  },

  async updateAdminUser(name, updates) {
    const user = this._src('adminUsers').find(u => u.name === name);
    if (!user) return null;
    const rollback = { ...user };
    Object.assign(user, updates);
    if (!this._demoMode && user._docId) {
      try {
        await FirebaseService.updateUser(user._docId, updates);
      } catch (err) {
        Object.assign(user, rollback);
        console.error('[updateAdminUser]', err);
        throw err;
      }
    }
    return user;
  },

  getRolePermissions(role) {
    if (this._demoMode) {
      return (typeof DemoData !== 'undefined' && DemoData.rolePermissions) ? (DemoData.rolePermissions[role] || []) : [];
    }
    return (FirebaseService._cache.rolePermissions || {})[role] || [];
  },

  // ════════════════════════════════
  //  Registrations（報名管理 — 僅 Firebase 模式）
  // ════════════════════════════════

  getRegistrationsByUser(userId) {
    return this._src('registrations').filter(
      r => r.userId === userId && r.status !== 'cancelled' && r.status !== 'removed'
    );
  },

  getRegistrationsByEvent(eventId) {
    return this._src('registrations').filter(
      r => r.eventId === eventId && r.status !== 'cancelled' && r.status !== 'removed'
    );
  },

  // ════════════════════════════════
  //  Messages（站內信）
  // ════════════════════════════════

  getMessages() { return this._src('messages'); },

  updateMessage(msgId, updates) { return this._update('messages', msgId, updates, FirebaseService.updateMessage, 'updateMessage'); },

  markMessageRead(msgId) {
    if (this._handleRestrictedAction()) return;
    const msg = this._findById('messages', msgId);
    if (msg) msg.unread = false;
    if (!this._demoMode) {
      FirebaseService.updateMessageRead(msgId).catch(err => console.error('[markMessageRead]', err));
    }
  },

  markAllMessagesRead() {
    if (this._handleRestrictedAction()) return;
    this._src('messages').forEach(m => { m.unread = false; });
    if (!this._demoMode) {
      FirebaseService.markAllMessagesRead().catch(err => console.error('[markAllMessagesRead]', err));
    }
  },

  // ════════════════════════════════
  //  Leaderboard & Records（排行榜 & 紀錄）
  // ════════════════════════════════

  getLeaderboard() { return this._src('leaderboard'); },

  getActivityRecords(uid) {
    const source = this._src('activityRecords');
    if (uid) return source.filter(r => r.uid === uid);
    return source;
  },

  addActivityRecord(record) {
    this._src('activityRecords').unshift(record);
    return record;
  },

  removeActivityRecord(eventId, uid) {
    const source = this._src('activityRecords');
    const idx = source.findIndex(r => r.eventId === eventId && r.uid === uid);
    if (idx >= 0) {
      source.splice(idx, 1);
      return true;
    }
    return false;
  },

  // ════════════════════════════════
  //  Attendance Records（簽到/簽退）
  // ════════════════════════════════

  getAttendanceRecords(eventId) {
    const source = this._src('attendanceRecords');
    const active = source.filter(r => r.status !== 'removed' && r.status !== 'cancelled');
    if (eventId) return active.filter(r => r.eventId === eventId);
    return active;
  },

  async addAttendanceRecord(record) {
    if (this._handleRestrictedAction()) return null;
    const normalized = { ...record, status: record.status || 'active' };
    if (
      !this._demoMode
      && (typeof normalized.eventId !== 'string' || !normalized.eventId || typeof normalized.uid !== 'string' || !normalized.uid)
    ) {
      throw new Error('missing required fields: eventId/uid');
    }
    const source = this._src('attendanceRecords');
    source.push(normalized);
    if (!this._demoMode) {
      try {
        await this._runAttendanceWriteWithAuthRetry(async () => {
          await FirebaseService.addAttendanceRecord(normalized);
          FirebaseService._saveToLS('attendanceRecords', FirebaseService._cache.attendanceRecords);
        }, 'addAttendanceRecord');
      } catch (err) {
        const idx = source.findIndex(r => r.id === normalized.id);
        if (idx !== -1) source.splice(idx, 1);
        console.error('[addAttendanceRecord]', err);
        throw new Error(this._mapAttendanceWriteError(err));
      }
    }
    return normalized;
  },

  async removeAttendanceRecord(record) {
    if (this._handleRestrictedAction()) return;
    const source = this._src('attendanceRecords');
    const idx = source.findIndex(r => r.id === record.id);
    const target = idx !== -1 ? source[idx] : null;
    const prev = target ? { ...target } : null;
    if (target) {
      target.status = 'removed';
      target.removedAt = new Date().toISOString();
    }
    if (!this._demoMode) {
      try {
        await this._runAttendanceWriteWithAuthRetry(async () => {
          await FirebaseService.removeAttendanceRecord(target || record);
        }, 'removeAttendanceRecord');
      } catch (err) {
        if (target && prev) Object.assign(target, prev);
        console.error('[removeAttendanceRecord]', err);
        throw new Error(this._mapAttendanceWriteError(err));
      }
    }
    return target;
  },

  // ════════════════════════════════
  //  Achievements & Badges
  // ════════════════════════════════

  getAchievements() { return this._src('achievements'); },
  getBadges()       { return this._src('badges'); },

  createAchievement(data)        { return this._create('achievements', data, FirebaseService.addAchievement, 'createAchievement', false); },
  updateAchievement(id, updates) { return this._update('achievements', id, updates, FirebaseService.updateAchievement, 'updateAchievement'); },
  deleteAchievement(id)          { return this._delete('achievements', id, FirebaseService.deleteAchievement, 'deleteAchievement'); },

  createBadge(data)        { return this._create('badges', data, FirebaseService.addBadge, 'createBadge', false); },
  updateBadge(id, updates) { return this._update('badges', id, updates, FirebaseService.updateBadge, 'updateBadge'); },
  deleteBadge(id)          { return this._delete('badges', id, FirebaseService.deleteBadge, 'deleteBadge'); },

  // ════════════════════════════════
  //  Operation Log（統一日誌工具）
  // ════════════════════════════════

  _writeOpLog(type, typeName, content) {
    const now = new Date();
    const timeStr = `${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const curUser = this.getCurrentUser();
    const operator = curUser?.displayName || ROLES[App.currentRole]?.label || '系統';
    const opLog = { time: timeStr, operator, type, typeName, content };
    this._src('operationLogs').unshift(opLog);
    if (!this._demoMode) {
      FirebaseService.addOperationLog(opLog).catch(err => console.error('[opLog]', err));
    }
  },

  // ════════════════════════════════
  //  Admin：Logs, Banners, Permissions
  // ════════════════════════════════

  getExpLogs()       { return this._src('expLogs'); },
  getTeamExpLogs()   { return this._src('teamExpLogs'); },
  getOperationLogs() { return this._src('operationLogs'); },
  getBanners()       { return this._src('banners'); },
  getPermissions()   { return this._src('permissions'); },

  updateBanner(id, updates) { return this._update('banners', id, updates, FirebaseService.updateBanner, 'updateBanner'); },

  // ════════════════════════════════
  //  Site Themes（佈景主題）
  // ════════════════════════════════

  getSiteThemes() { return this._src('siteThemes'); },

  updateSiteTheme(id, updates) { return this._update('siteThemes', id, updates, FirebaseService.updateSiteTheme, 'updateSiteTheme'); },

  // ════════════════════════════════
  //  Announcements（系統公告）
  // ════════════════════════════════

  getAnnouncements()       { return this._src('announcements'); },
  getActiveAnnouncements() { return this.getAnnouncements().filter(a => a.status === 'active').sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99)); },
  getActiveAnnouncement()  { return this.getActiveAnnouncements()[0] || null; },

  createAnnouncement(data)        { return this._create('announcements', data, FirebaseService.addAnnouncement, 'createAnnouncement'); },
  updateAnnouncement(id, updates) { return this._update('announcements', id, updates, FirebaseService.updateAnnouncement, 'updateAnnouncement'); },
  deleteAnnouncement(id)          { return this._delete('announcements', id, FirebaseService.deleteAnnouncement, 'deleteAnnouncement'); },

  // ════════════════════════════════
  //  Floating Ads（浮動廣告）
  // ════════════════════════════════

  getFloatingAds() { return this._src('floatingAds'); },

  updateFloatingAd(id, updates) { return this._update('floatingAds', id, updates, FirebaseService.updateFloatingAd, 'updateFloatingAd'); },

  // ════════════════════════════════
  //  Popup Ads（彈跳廣告）
  // ════════════════════════════════

  getPopupAds()       { return this._src('popupAds'); },
  getActivePopupAds() { return this.getPopupAds().filter(a => a.status === 'active'); },

  createPopupAd(data)        { return this._create('popupAds', data, FirebaseService.addPopupAd, 'createPopupAd', false); },
  updatePopupAd(id, updates) { return this._update('popupAds', id, updates, FirebaseService.updatePopupAd, 'updatePopupAd'); },
  deletePopupAd(id)          { return this._delete('popupAds', id, FirebaseService.deletePopupAd, 'deletePopupAd'); },

  // ════════════════════════════════
  //  Admin Messages（後台站內信）
  // ════════════════════════════════

  getAdminMessages() { return this._src('adminMessages'); },

  // ════════════════════════════════
  //  Notification Templates（通知模板）
  // ════════════════════════════════

  getNotifTemplates() { return this._src('notifTemplates'); },

  getNotifTemplate(key) {
    return this._src('notifTemplates').find(t => t.key === key) || null;
  },

  updateNotifTemplate(key, updates) {
    const t = this._src('notifTemplates').find(t => t.key === key);
    if (t) Object.assign(t, updates);
    if (!this._demoMode) {
      FirebaseService.updateNotifTemplate(key, updates).catch(err => console.error('[updateNotifTemplate]', err));
    }
    return t;
  },

  createAdminMessage(data)        { return this._create('adminMessages', data, FirebaseService.addAdminMessage, 'createAdminMessage'); },
  updateAdminMessage(id, updates) { return this._update('adminMessages', id, updates, FirebaseService.updateAdminMessage, 'updateAdminMessage'); },

  deleteAdminMessage(id) {
    const source = this._src('adminMessages');
    // 先呼叫 Firebase 刪除（需要從 cache 中找到 _docId），再 splice
    if (!this._demoMode) {
      FirebaseService.deleteAdminMessage(id).catch(err => console.error('[deleteAdminMessage]', err));
    }
    const idx = source.findIndex(m => m.id === id);
    if (idx >= 0) source.splice(idx, 1);
  },

  // ════════════════════════════════
  //  Sponsors（贊助商）
  // ════════════════════════════════

  getSponsors() {
    if (this._demoMode) return (typeof DemoData !== 'undefined' && DemoData.sponsors) ? DemoData.sponsors : [];
    return (FirebaseService._cache.sponsors || []).filter(s => s.slot != null && s.slot <= 6);
  },

  getActiveSponsors() {
    return this.getSponsors().filter(s => s.status === 'active');
  },

  updateSponsor(id, updates) {
    const source = this._demoMode ? ((typeof DemoData !== 'undefined' && DemoData.sponsors) ? DemoData.sponsors : []) : (FirebaseService._cache.sponsors || []);
    const item = source.find(s => s.id === id);
    if (item) Object.assign(item, updates);
    if (!this._demoMode) {
      FirebaseService.updateSponsor(id, updates).catch(err => console.error('[updateSponsor]', err));
    }
    return item;
  },

  // ════════════════════════════════
  //  User Promotion（用戶晉升）
  // ════════════════════════════════

  promoteUser(name, newRole) {
    const user = this._src('adminUsers').find(u => u.name === name);
    if (user) {
      user.role = newRole;
      if (!this._demoMode && user._docId) {
        FirebaseService.updateUserRole(user._docId, newRole).catch(err => console.error('[promoteUser]', err));
      }
    }
    return user;
  },

  /**
   * 重新計算用戶角色：掃描所有球隊職位 + manualRole 底線，取最高。
   * @param {string} uid
   * @returns {{ uid, oldRole, newRole, userName }|null} 有變化回傳結果，無變化回傳 null
   */
  _recalcUserRole(uid) {
    const user = this._src('adminUsers').find(u => u.uid === uid);
    if (!user) return null;
    const oldRole = user.role;
    // venue_owner 以上由管理員手動管理，不做自動降級
    if ((ROLE_LEVEL_MAP[oldRole] || 0) >= ROLE_LEVEL_MAP['venue_owner']) return null;

    // 掃描所有球隊，找出此用戶擔任的最高職位
    let highestTeamLevel = 0;
    const teams = this._src('teams');
    teams.forEach(t => {
      if (t.captainUid === uid || t.captain === user.name) {
        highestTeamLevel = Math.max(highestTeamLevel, ROLE_LEVEL_MAP['captain']);
      }
      if ((t.coaches || []).includes(user.name)) {
        highestTeamLevel = Math.max(highestTeamLevel, ROLE_LEVEL_MAP['coach']);
      }
    });

    // manualRole 底線（未設定等同 user）
    const manualLevel = ROLE_LEVEL_MAP[user.manualRole] || 0;
    const targetLevel = Math.max(highestTeamLevel, manualLevel);

    // 反查角色名稱
    const levelToRole = Object.entries(ROLE_LEVEL_MAP).reduce((m, [k, v]) => { m[v] = k; return m; }, {});
    const newRole = levelToRole[targetLevel] || 'user';

    if (newRole === oldRole) return null;

    // 更新角色
    user.role = newRole;
    if (!this._demoMode && user._docId) {
      FirebaseService.updateUserRole(user._docId, newRole).catch(err => console.error('[_recalcUserRole]', err));
    }
    return { uid, oldRole, newRole, userName: user.name };
  },

  // ════════════════════════════════
  //  EXP Adjustment（手動 EXP）
  // ════════════════════════════════

  adjustUserExp(nameOrUid, amount, reason, operatorLabel) {
    const user = this._src('adminUsers').find(u => u.name === nameOrUid || u.uid === nameOrUid);
    if (!user) return null;
    user.exp = Math.max(0, (user.exp || 0) + amount);
    const now = new Date();
    const timeStr = `${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const log = { time: timeStr, target: user.name, amount: (amount > 0 ? '+' : '') + amount, reason, operator: operatorLabel || '管理員' };
    this._src('expLogs').unshift(log);
    this._writeOpLog('exp', '手動EXP', `${user.name} ${log.amount}「${reason}」`);
    if (!this._demoMode) {
      if (user._docId) {
        db.collection('users').doc(user._docId).update({ exp: user.exp }).catch(err => console.error('[adjustUserExp]', err));
      }
      db.collection('expLogs').add({ ...log, createdAt: firebase.firestore.FieldValue.serverTimestamp() }).catch(err => console.error('[adjustUserExp log]', err));
    }
    return user;
  },

  adjustTeamExp(teamId, amount, reason, operatorLabel) {
    const team = this._findById('teams', teamId);
    if (!team) return null;
    team.teamExp = Math.min(10000, Math.max(0, (team.teamExp || 0) + amount));
    const now = new Date();
    const timeStr = `${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const log = { time: timeStr, target: team.name, targetId: teamId, amount: (amount > 0 ? '+' : '') + amount, reason, operator: operatorLabel || '管理員' };
    this._src('teamExpLogs').unshift(log);
    this._writeOpLog('team_exp', '球隊積分', `${team.name} ${log.amount}「${reason}」`);
    if (!this._demoMode) {
      if (team._docId) {
        db.collection('teams').doc(team._docId).update({ teamExp: team.teamExp }).catch(err => console.error('[adjustTeamExp]', err));
      }
      db.collection('teamExpLogs').add({ ...log, createdAt: firebase.firestore.FieldValue.serverTimestamp() }).catch(err => console.error('[adjustTeamExp log]', err));
    }
    return team;
  },

  // ════════════════════════════════
  //  Companions（同行者）
  // ════════════════════════════════

  getCompanions() {
    const user = this.getCurrentUser();
    return user?.companions || [];
  },

  addCompanion(data) {
    if (this._handleRestrictedAction()) return null;
    const user = this.getCurrentUser();
    if (!user) return null;
    if (!user.companions) user.companions = [];
    user.companions.push(data);
    if (!this._demoMode && user._docId) {
      FirebaseService.updateUserCompanions(user._docId, user.companions)
        .catch(err => console.error('[addCompanion]', err));
    }
    return data;
  },

  updateCompanion(companionId, updates) {
    if (this._handleRestrictedAction()) return null;
    const user = this.getCurrentUser();
    if (!user || !user.companions) return null;
    const comp = user.companions.find(c => c.id === companionId);
    if (!comp) return null;
    Object.assign(comp, updates);
    if (!this._demoMode && user._docId) {
      FirebaseService.updateUserCompanions(user._docId, user.companions)
        .catch(err => console.error('[updateCompanion]', err));
    }
    return comp;
  },

  deleteCompanion(companionId) {
    if (this._handleRestrictedAction()) return false;
    const user = this.getCurrentUser();
    if (!user || !user.companions) return false;
    const idx = user.companions.findIndex(c => c.id === companionId);
    if (idx < 0) return false;
    user.companions.splice(idx, 1);
    if (!this._demoMode && user._docId) {
      FirebaseService.updateUserCompanions(user._docId, user.companions)
        .catch(err => console.error('[deleteCompanion]', err));
    }
    return true;
  },

  getMyRegistrationsByEvent(eventId) {
    const uid = this.getCurrentUser()?.uid;
    if (!uid) return [];
    return this._src('registrations').filter(
      r => r.eventId === eventId && r.userId === uid && r.status !== 'cancelled' && r.status !== 'removed'
    );
  },

  async registerEventWithCompanions(eventId, participantList) {
    if (this._handleRestrictedAction()) {
      throw new Error('ACCOUNT_RESTRICTED');
    }
    const e = ApiService.getEvent(eventId);
    if (!e) throw new Error('活動不存在');
    const user = this.getCurrentUser();
    const userId = user?.uid || 'unknown';
    const userName = user?.displayName || user?.name || '用戶';

    if (this._demoMode) {
      const registrations = [];
      let confirmed = 0, waitlisted = 0;
      let promotionIdx = 0;
      for (const p of participantList) {
        // 重複檢查：跳過已報名的相同人員
        const dupKey = p.companionId ? `${userId}_${p.companionId}` : userId;
        const existing = this._src('registrations').find(r => {
          if (r.eventId !== eventId || r.status === 'cancelled' || r.status === 'removed') return false;
          const rKey = r.companionId ? `${r.userId}_${r.companionId}` : r.userId;
          return rKey === dupKey;
        });
        if (existing) { promotionIdx++; continue; }

        const isWaitlist = e.current >= e.max;
        if (isWaitlist) {
          e.waitlist = (e.waitlist || 0) + 1;
          waitlisted++;
        } else {
          e.current++;
          confirmed++;
        }
        const reg = {
          id: 'reg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
          eventId,
          userId,
          userName,
          participantType: p.type,
          companionId: p.companionId || null,
          companionName: p.companionName || null,
          status: isWaitlist ? 'waitlisted' : 'confirmed',
          promotionOrder: promotionIdx,
          registeredAt: new Date().toISOString(),
        };
        promotionIdx++;
        this._src('registrations').push(reg);
        registrations.push(reg);
        if (e.current >= e.max) e.status = 'full';
      }
      return { registrations, confirmed, waitlisted };
    }

    const entries = participantList.map(p => ({
      userId,
      userName,
      participantType: p.type,
      companionId: p.type === 'companion' ? p.companionId : null,
      companionName: p.type === 'companion' ? p.companionName : null,
    }));
    return await FirebaseService.batchRegisterForEvent(eventId, entries);
  },

  // ════════════════════════════════
  //  Current User（登入用戶）
  // ════════════════════════════════

  getCurrentUser() {
    if (this._demoMode) return (typeof DemoData !== 'undefined') ? DemoData.currentUser : null;
    return FirebaseService._cache.currentUser || null;
  },

  async loginUser(lineProfile) {
    if (this._demoMode) return (typeof DemoData !== 'undefined') ? DemoData.currentUser : null;
    return await FirebaseService.createOrUpdateUser(lineProfile);
  },

  updateCurrentUser(updates) {
    if (this._handleRestrictedAction()) return null;
    if (this._demoMode) {
      if (typeof DemoData !== 'undefined' && DemoData.currentUser) {
        Object.assign(DemoData.currentUser, updates);
        return DemoData.currentUser;
      }
      return null;
    }
    const user = FirebaseService._cache.currentUser;
    if (user) {
      Object.assign(user, updates);
      if (user._docId) {
        FirebaseService.updateUser(user._docId, updates).catch(err => console.error('[updateCurrentUser]', err));
      }
    }
    return user;
  },
};
