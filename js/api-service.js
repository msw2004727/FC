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
  //  Events（活動）
  // ════════════════════════════════

  getEvents() {
    if (this._demoMode) return DemoData.events;
    return FirebaseService._cache.events;
  },

  getEvent(id) {
    if (this._demoMode) return DemoData.events.find(e => e.id === id) || null;
    return FirebaseService._cache.events.find(e => e.id === id) || null;
  },

  getActiveEvents() {
    if (this._demoMode) return DemoData.events.filter(e => e.status !== 'ended' && e.status !== 'cancelled');
    return FirebaseService._cache.events.filter(e => e.status !== 'ended' && e.status !== 'cancelled');
  },

  getHotEvents(withinDays) {
    const source = this._demoMode ? DemoData.events : FirebaseService._cache.events;
    const now = new Date();
    const limit = new Date(now.getTime() + (withinDays || 14) * 24 * 60 * 60 * 1000);
    return source.filter(e => {
      if (e.status === 'ended' || e.status === 'cancelled') return false;
      const parts = e.date.split(' ')[0].split('/');
      const eventDate = new Date(+parts[0], +parts[1] - 1, +parts[2]);
      return eventDate >= now && eventDate <= limit;
    });
  },

  createEvent(data) {
    if (this._demoMode) {
      DemoData.events.unshift(data);
      return data;
    }
    FirebaseService._cache.events.unshift(data);
    FirebaseService.addEvent(data).catch(err => console.error('[createEvent]', err));
    return data;
  },

  updateEvent(id, updates) {
    const source = this._demoMode ? DemoData.events : FirebaseService._cache.events;
    const e = source.find(ev => ev.id === id);
    if (e) Object.assign(e, updates);
    if (!this._demoMode) {
      FirebaseService.updateEvent(id, updates).catch(err => console.error('[updateEvent]', err));
    }
    return e;
  },

  deleteEvent(id) {
    const source = this._demoMode ? DemoData.events : FirebaseService._cache.events;
    const idx = source.findIndex(e => e.id === id);
    if (idx >= 0) source.splice(idx, 1);
    if (!this._demoMode) {
      FirebaseService.deleteEvent(id).catch(err => console.error('[deleteEvent]', err));
    }
    return true;
  },

  // ════════════════════════════════
  //  Tournaments（賽事）
  // ════════════════════════════════

  getTournaments() {
    if (this._demoMode) return DemoData.tournaments;
    return FirebaseService._cache.tournaments;
  },

  getTournament(id) {
    if (this._demoMode) return DemoData.tournaments.find(t => t.id === id) || null;
    return FirebaseService._cache.tournaments.find(t => t.id === id) || null;
  },

  createTournament(data) {
    if (this._demoMode) {
      DemoData.tournaments.unshift(data);
      return data;
    }
    FirebaseService._cache.tournaments.unshift(data);
    FirebaseService.addTournament(data).catch(err => console.error('[createTournament]', err));
    return data;
  },

  getStandings() {
    if (this._demoMode) return DemoData.standings;
    return FirebaseService._cache.standings;
  },

  getMatches() {
    if (this._demoMode) return DemoData.matches;
    return FirebaseService._cache.matches;
  },

  getTrades() {
    if (this._demoMode) return DemoData.trades;
    return FirebaseService._cache.trades;
  },

  // ════════════════════════════════
  //  Teams（球隊）
  // ════════════════════════════════

  getTeams() {
    if (this._demoMode) return DemoData.teams;
    return FirebaseService._cache.teams;
  },

  getActiveTeams() {
    if (this._demoMode) return DemoData.teams.filter(t => t.active);
    return FirebaseService._cache.teams.filter(t => t.active);
  },

  getTeam(id) {
    if (this._demoMode) return DemoData.teams.find(t => t.id === id) || null;
    return FirebaseService._cache.teams.find(t => t.id === id) || null;
  },

  updateTeam(id, updates) {
    const source = this._demoMode ? DemoData.teams : FirebaseService._cache.teams;
    const t = source.find(tm => tm.id === id);
    if (t) Object.assign(t, updates);
    if (!this._demoMode) {
      FirebaseService.updateTeam(id, updates).catch(err => console.error('[updateTeam]', err));
    }
    return t;
  },

  // ════════════════════════════════
  //  Shop（二手商品）
  // ════════════════════════════════

  getShopItems() {
    if (this._demoMode) return DemoData.shopItems;
    return FirebaseService._cache.shopItems;
  },

  getShopItem(id) {
    if (this._demoMode) return DemoData.shopItems.find(s => s.id === id) || null;
    return FirebaseService._cache.shopItems.find(s => s.id === id) || null;
  },

  createShopItem(data) {
    if (this._demoMode) {
      DemoData.shopItems.unshift(data);
      return data;
    }
    FirebaseService._cache.shopItems.unshift(data);
    FirebaseService.addShopItem(data).catch(err => console.error('[createShopItem]', err));
    return data;
  },

  updateShopItem(id, updates) {
    const source = this._demoMode ? DemoData.shopItems : FirebaseService._cache.shopItems;
    const item = source.find(s => s.id === id);
    if (item) Object.assign(item, updates);
    if (!this._demoMode) {
      FirebaseService.updateShopItem(id, updates).catch(err => console.error('[updateShopItem]', err));
    }
    return item;
  },

  deleteShopItem(id) {
    const source = this._demoMode ? DemoData.shopItems : FirebaseService._cache.shopItems;
    const idx = source.findIndex(s => s.id === id);
    if (idx >= 0) source.splice(idx, 1);
    if (!this._demoMode) {
      FirebaseService.deleteShopItem(id).catch(err => console.error('[deleteShopItem]', err));
    }
    return true;
  },

  // ════════════════════════════════
  //  Users & Admin（用戶管理）
  // ════════════════════════════════

  getAdminUsers() {
    if (this._demoMode) return DemoData.adminUsers;
    return FirebaseService._cache.adminUsers;
  },

  getUserRole(name) {
    if (this._demoMode) return DEMO_USERS[name] || 'user';
    const user = FirebaseService._cache.adminUsers.find(u => u.name === name);
    return user ? user.role : 'user';
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

  getMessages() {
    if (this._demoMode) return DemoData.messages;
    return FirebaseService._cache.messages;
  },

  // ════════════════════════════════
  //  Leaderboard & Records（排行榜 & 紀錄）
  // ════════════════════════════════

  getLeaderboard() {
    if (this._demoMode) return DemoData.leaderboard;
    return FirebaseService._cache.leaderboard;
  },

  getActivityRecords() {
    if (this._demoMode) return DemoData.activityRecords;
    return FirebaseService._cache.activityRecords;
  },

  // ════════════════════════════════
  //  Achievements & Badges
  // ════════════════════════════════

  getAchievements() {
    if (this._demoMode) return DemoData.achievements;
    return FirebaseService._cache.achievements;
  },

  getBadges() {
    if (this._demoMode) return DemoData.badges;
    return FirebaseService._cache.badges;
  },

  // ════════════════════════════════
  //  Admin：Logs, Banners, Permissions
  // ════════════════════════════════

  getExpLogs() {
    if (this._demoMode) return DemoData.expLogs;
    return FirebaseService._cache.expLogs;
  },

  getOperationLogs() {
    if (this._demoMode) return DemoData.operationLogs;
    return FirebaseService._cache.operationLogs;
  },

  getBanners() {
    if (this._demoMode) return DemoData.banners;
    return FirebaseService._cache.banners;
  },

  updateBanner(id, updates) {
    const source = this._demoMode ? DemoData.banners : FirebaseService._cache.banners;
    const item = source.find(b => b.id === id);
    if (item) Object.assign(item, updates);
    if (!this._demoMode) {
      FirebaseService.updateBanner(id, updates).catch(err => console.error('[updateBanner]', err));
    }
    return item;
  },

  // ════════════════════════════════
  //  Announcements（系統公告）
  // ════════════════════════════════

  getAnnouncements() {
    if (this._demoMode) return DemoData.announcements;
    return FirebaseService._cache.announcements;
  },

  getActiveAnnouncement() {
    return this.getAnnouncements().find(a => a.status === 'active') || null;
  },

  createAnnouncement(data) {
    const source = this._demoMode ? DemoData.announcements : FirebaseService._cache.announcements;
    source.unshift(data);
    if (!this._demoMode) {
      FirebaseService.addAnnouncement(data).catch(err => console.error('[createAnnouncement]', err));
    }
    return data;
  },

  updateAnnouncement(id, updates) {
    const source = this._demoMode ? DemoData.announcements : FirebaseService._cache.announcements;
    const item = source.find(a => a.id === id);
    if (item) Object.assign(item, updates);
    if (!this._demoMode) {
      FirebaseService.updateAnnouncement(id, updates).catch(err => console.error('[updateAnnouncement]', err));
    }
    return item;
  },

  deleteAnnouncement(id) {
    const source = this._demoMode ? DemoData.announcements : FirebaseService._cache.announcements;
    const idx = source.findIndex(a => a.id === id);
    if (idx >= 0) source.splice(idx, 1);
    if (!this._demoMode) {
      FirebaseService.deleteAnnouncement(id).catch(err => console.error('[deleteAnnouncement]', err));
    }
  },

  // ════════════════════════════════
  //  Floating Ads（浮動廣告）
  // ════════════════════════════════

  getFloatingAds() {
    if (this._demoMode) return DemoData.floatingAds;
    return FirebaseService._cache.floatingAds;
  },

  updateFloatingAd(id, updates) {
    const source = this._demoMode ? DemoData.floatingAds : FirebaseService._cache.floatingAds;
    const item = source.find(a => a.id === id);
    if (item) Object.assign(item, updates);
    if (!this._demoMode) {
      FirebaseService.updateFloatingAd(id, updates).catch(err => console.error('[updateFloatingAd]', err));
    }
    return item;
  },

  getPermissions() {
    if (this._demoMode) return DemoData.permissions;
    return FirebaseService._cache.permissions;
  },

  // ════════════════════════════════
  //  Popup Ads（彈跳廣告）
  // ════════════════════════════════

  getPopupAds() {
    if (this._demoMode) return DemoData.popupAds;
    return FirebaseService._cache.popupAds;
  },

  getActivePopupAds() {
    return this.getPopupAds().filter(a => a.status === 'active');
  },

  createPopupAd(data) {
    const source = this._demoMode ? DemoData.popupAds : FirebaseService._cache.popupAds;
    source.push(data);
    if (!this._demoMode) {
      FirebaseService.addPopupAd(data).catch(err => console.error('[createPopupAd]', err));
    }
    return data;
  },

  updatePopupAd(id, updates) {
    const source = this._demoMode ? DemoData.popupAds : FirebaseService._cache.popupAds;
    const item = source.find(a => a.id === id);
    if (item) Object.assign(item, updates);
    if (!this._demoMode) {
      FirebaseService.updatePopupAd(id, updates).catch(err => console.error('[updatePopupAd]', err));
    }
    return item;
  },

  deletePopupAd(id) {
    const source = this._demoMode ? DemoData.popupAds : FirebaseService._cache.popupAds;
    const idx = source.findIndex(a => a.id === id);
    if (idx >= 0) source.splice(idx, 1);
    if (!this._demoMode) {
      FirebaseService.deletePopupAd(id).catch(err => console.error('[deletePopupAd]', err));
    }
  },

  // ════════════════════════════════
  //  Achievements CRUD
  // ════════════════════════════════

  createAchievement(data) {
    const source = this._demoMode ? DemoData.achievements : FirebaseService._cache.achievements;
    source.push(data);
    if (!this._demoMode) {
      FirebaseService.addAchievement(data).catch(err => console.error('[createAchievement]', err));
    }
    return data;
  },

  updateAchievement(id, updates) {
    const source = this._demoMode ? DemoData.achievements : FirebaseService._cache.achievements;
    const item = source.find(a => a.id === id);
    if (item) Object.assign(item, updates);
    if (!this._demoMode) {
      FirebaseService.updateAchievement(id, updates).catch(err => console.error('[updateAchievement]', err));
    }
    return item;
  },

  deleteAchievement(id) {
    const source = this._demoMode ? DemoData.achievements : FirebaseService._cache.achievements;
    const idx = source.findIndex(a => a.id === id);
    if (idx >= 0) source.splice(idx, 1);
    if (!this._demoMode) {
      FirebaseService.deleteAchievement(id).catch(err => console.error('[deleteAchievement]', err));
    }
  },

  // ════════════════════════════════
  //  Badges CRUD
  // ════════════════════════════════

  createBadge(data) {
    const source = this._demoMode ? DemoData.badges : FirebaseService._cache.badges;
    source.push(data);
    if (!this._demoMode) {
      FirebaseService.addBadge(data).catch(err => console.error('[createBadge]', err));
    }
    return data;
  },

  updateBadge(id, updates) {
    const source = this._demoMode ? DemoData.badges : FirebaseService._cache.badges;
    const item = source.find(b => b.id === id);
    if (item) Object.assign(item, updates);
    if (!this._demoMode) {
      FirebaseService.updateBadge(id, updates).catch(err => console.error('[updateBadge]', err));
    }
    return item;
  },

  deleteBadge(id) {
    const source = this._demoMode ? DemoData.badges : FirebaseService._cache.badges;
    const idx = source.findIndex(b => b.id === id);
    if (idx >= 0) source.splice(idx, 1);
    if (!this._demoMode) {
      FirebaseService.deleteBadge(id).catch(err => console.error('[deleteBadge]', err));
    }
  },

  // ════════════════════════════════
  //  User Promotion（用戶晉升）
  // ════════════════════════════════

  promoteUser(name, newRole) {
    const source = this._demoMode ? DemoData.adminUsers : FirebaseService._cache.adminUsers;
    const user = source.find(u => u.name === name);
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
    const source = this._demoMode ? DemoData.adminUsers : FirebaseService._cache.adminUsers;
    const user = source.find(u => u.name === nameOrUid || u.uid === nameOrUid);
    if (!user) return null;
    user.exp = (user.exp || 0) + amount;
    const now = new Date();
    const timeStr = `${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    const log = { time: timeStr, target: user.name, amount: (amount > 0 ? '+' : '') + amount, reason };
    const logSource = this._demoMode ? DemoData.expLogs : FirebaseService._cache.expLogs;
    logSource.unshift(log);
    const opLog = { time: timeStr, operator: operatorLabel || '管理員', type: 'exp', typeName: '手動EXP', content: `${user.name} ${log.amount}「${reason}」` };
    const opSource = this._demoMode ? DemoData.operationLogs : FirebaseService._cache.operationLogs;
    opSource.unshift(opLog);
    if (!this._demoMode) {
      if (user._docId) {
        db.collection('adminUsers').doc(user._docId).update({ exp: user.exp }).catch(err => console.error('[adjustUserExp]', err));
      }
      db.collection('expLogs').add({ ...log, createdAt: firebase.firestore.FieldValue.serverTimestamp() }).catch(err => console.error('[adjustUserExp log]', err));
      FirebaseService.addOperationLog(opLog).catch(err => console.error('[adjustUserExp opLog]', err));
    }
    return user;
  },

  // ════════════════════════════════
  //  Admin Messages（後台站內信）
  // ════════════════════════════════

  getAdminMessages() {
    if (this._demoMode) return DemoData.adminMessages;
    return FirebaseService._cache.adminMessages;
  },

  createAdminMessage(data) {
    const source = this._demoMode ? DemoData.adminMessages : FirebaseService._cache.adminMessages;
    source.unshift(data);
    if (!this._demoMode) {
      FirebaseService.addAdminMessage(data).catch(err => console.error('[createAdminMessage]', err));
    }
    return data;
  },

  updateAdminMessage(id, updates) {
    const source = this._demoMode ? DemoData.adminMessages : FirebaseService._cache.adminMessages;
    const item = source.find(m => m.id === id);
    if (item) Object.assign(item, updates);
    if (!this._demoMode) {
      FirebaseService.updateAdminMessage(id, updates).catch(err => console.error('[updateAdminMessage]', err));
    }
    return item;
  },

  deleteAdminMessage(id) {
    const source = this._demoMode ? DemoData.adminMessages : FirebaseService._cache.adminMessages;
    const idx = source.findIndex(m => m.id === id);
    if (idx >= 0) {
      source.splice(idx, 1);
      if (!this._demoMode) {
        FirebaseService.deleteAdminMessage(id).catch(err => console.error('[deleteAdminMessage]', err));
      }
    }
  },

  // ════════════════════════════════
  //  Message Read（訊息已讀持久化）
  // ════════════════════════════════

  markMessageRead(msgId) {
    const source = this._demoMode ? DemoData.messages : FirebaseService._cache.messages;
    const msg = source.find(m => m.id === msgId);
    if (msg) msg.unread = false;
    if (!this._demoMode) {
      FirebaseService.updateMessageRead(msgId).catch(err => console.error('[markMessageRead]', err));
    }
  },

  markAllMessagesRead() {
    const source = this._demoMode ? DemoData.messages : FirebaseService._cache.messages;
    source.forEach(m => { m.unread = false; });
    if (!this._demoMode) {
      FirebaseService.markAllMessagesRead().catch(err => console.error('[markAllMessagesRead]', err));
    }
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
