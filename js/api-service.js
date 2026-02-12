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

  // ════════════════════════════════
  //  通用工具方法（消除重複的 demo/production 分支）
  // ════════════════════════════════

  /** 取得資料來源陣列 */
  _src(key) {
    return this._demoMode ? DemoData[key] : FirebaseService._cache[key];
  },

  /** 根據 id 查找單筆資料 */
  _findById(key, id) {
    return this._src(key).find(item => item.id === id) || null;
  },

  /** 通用新增：寫入快取 + 非同步寫入 Firebase */
  _create(key, data, firebaseMethod, label, prepend) {
    const source = this._src(key);
    if (prepend !== false) { source.unshift(data); } else { source.push(data); }
    if (!this._demoMode && firebaseMethod) {
      firebaseMethod.call(FirebaseService, data).catch(err => console.error(`[${label}]`, err));
    }
    return data;
  },

  /** 通用更新：快取 Object.assign + 非同步寫入 Firebase */
  _update(key, id, updates, firebaseMethod, label) {
    const item = this._findById(key, id);
    if (item) Object.assign(item, updates);
    if (!this._demoMode && firebaseMethod) {
      firebaseMethod.call(FirebaseService, id, updates).catch(err => console.error(`[${label}]`, err));
    }
    return item;
  },

  /** 通用刪除：先呼叫 Firebase（需要讀取 _docId），再從快取 splice */
  _delete(key, id, firebaseMethod, label) {
    const source = this._src(key);
    // 必須先呼叫 Firebase 刪除（需要從 cache 中找到 _docId），再 splice
    if (!this._demoMode && firebaseMethod) {
      firebaseMethod.call(FirebaseService, id).catch(err => console.error(`[${label}]`, err));
    }
    const idx = source.findIndex(item => item.id === id);
    if (idx >= 0) source.splice(idx, 1);
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
    if (!this._demoMode && removed._docId) {
      db.collection('tournaments').doc(removed._docId).delete()
        .catch(err => console.error('[deleteTournament]', err));
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

  deleteTeam(id) {
    const source = this._src('teams');

    // 正式版：先取得 _docId 再刪 Firestore，最後才從快取移除
    if (!this._demoMode) {
      const doc = source.find(t => t.id === id);
      if (doc && doc._docId) {
        FirebaseService.deleteTeam(id).catch(err => console.error('[deleteTeam]', err));
      }
    }

    // 從快取移除
    const idx = source.findIndex(t => t.id === id);
    if (idx >= 0) source.splice(idx, 1);

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
      const u = DemoData.adminUsers.find(u => u.name === name);
      return u ? u.role : 'user';
    }
    const user = FirebaseService._cache.adminUsers.find(u => u.name === name);
    return user ? user.role : 'user';
  },

  updateAdminUser(name, updates) {
    const user = this._src('adminUsers').find(u => u.name === name);
    if (!user) return null;
    Object.assign(user, updates);
    if (!this._demoMode && user._docId) {
      FirebaseService.updateUser(user._docId, updates).catch(err => console.error('[updateAdminUser]', err));
    }
    return user;
  },

  getRolePermissions(role) {
    if (this._demoMode) return DemoData.rolePermissions[role] || [];
    return (FirebaseService._cache.rolePermissions || DemoData.rolePermissions || {})[role] || [];
  },

  // ════════════════════════════════
  //  Registrations（報名管理 — 僅 Firebase 模式）
  // ════════════════════════════════

  getRegistrationsByUser(userId) {
    if (this._demoMode) return [];
    return FirebaseService.getRegistrationsByUser(userId);
  },

  getRegistrationsByEvent(eventId) {
    if (this._demoMode) return [];
    return FirebaseService.getRegistrationsByEvent(eventId);
  },

  // ════════════════════════════════
  //  Messages（站內信）
  // ════════════════════════════════

  getMessages() { return this._src('messages'); },

  updateMessage(msgId, updates) { return this._update('messages', msgId, updates, FirebaseService.updateMessage, 'updateMessage'); },

  markMessageRead(msgId) {
    const msg = this._findById('messages', msgId);
    if (msg) msg.unread = false;
    if (!this._demoMode) {
      FirebaseService.updateMessageRead(msgId).catch(err => console.error('[markMessageRead]', err));
    }
  },

  markAllMessagesRead() {
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
    if (eventId) return source.filter(r => r.eventId === eventId);
    return source;
  },

  addAttendanceRecord(record) {
    this._src('attendanceRecords').push(record);
    if (!this._demoMode) {
      FirebaseService.addAttendanceRecord(record).catch(err => console.error('[addAttendanceRecord]', err));
    }
    return record;
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
    if (this._demoMode) return DemoData.sponsors;
    return (FirebaseService._cache.sponsors || []).filter(s => s.slot != null && s.slot <= 6);
  },

  getActiveSponsors() {
    return this.getSponsors().filter(s => s.status === 'active');
  },

  updateSponsor(id, updates) {
    const source = this._demoMode ? DemoData.sponsors : (FirebaseService._cache.sponsors || []);
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
    const opLog = { time: timeStr, operator: operatorLabel || '管理員', type: 'exp', typeName: '手動EXP', content: `${user.name} ${log.amount}「${reason}」` };
    this._src('operationLogs').unshift(opLog);
    if (!this._demoMode) {
      if (user._docId) {
        db.collection('users').doc(user._docId).update({ exp: user.exp }).catch(err => console.error('[adjustUserExp]', err));
      }
      db.collection('expLogs').add({ ...log, createdAt: firebase.firestore.FieldValue.serverTimestamp() }).catch(err => console.error('[adjustUserExp log]', err));
      FirebaseService.addOperationLog(opLog).catch(err => console.error('[adjustUserExp opLog]', err));
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
    const opLog = { time: timeStr, operator: operatorLabel || '管理員', type: 'team_exp', typeName: '球隊積分', content: `${team.name} ${log.amount}「${reason}」` };
    this._src('operationLogs').unshift(opLog);
    if (!this._demoMode) {
      if (team._docId) {
        db.collection('teams').doc(team._docId).update({ teamExp: team.teamExp }).catch(err => console.error('[adjustTeamExp]', err));
      }
      db.collection('teamExpLogs').add({ ...log, createdAt: firebase.firestore.FieldValue.serverTimestamp() }).catch(err => console.error('[adjustTeamExp log]', err));
      FirebaseService.addOperationLog(opLog).catch(err => console.error('[adjustTeamExp opLog]', err));
    }
    return team;
  },

  // ════════════════════════════════
  //  Current User（登入用戶）
  // ════════════════════════════════

  getCurrentUser() {
    if (this._demoMode) return DemoData.currentUser;
    return FirebaseService._cache.currentUser || null;
  },

  async loginUser(lineProfile) {
    if (this._demoMode) return DemoData.currentUser;
    return await FirebaseService.createOrUpdateUser(lineProfile);
  },

  updateCurrentUser(updates) {
    if (this._demoMode) {
      Object.assign(DemoData.currentUser, updates);
      return DemoData.currentUser;
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
