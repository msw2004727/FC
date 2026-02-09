/* ================================================
   SportHub — API Service 抽象層
   ================================================
   _demoMode = true  → 讀取 DemoData（Demo 演示）
   _demoMode = false → 讀取 FirebaseService._cache（正式版）

   切換方式：將 _demoMode 改為 false 即可。
   App 層的渲染邏輯完全不需要改動。
   ================================================ */

const ApiService = {

  _demoMode: true,   // ← 改為 false 啟用 Firebase

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

  createBanner(data) {
    const source = this._demoMode ? DemoData.banners : FirebaseService._cache.banners;
    source.unshift(data);
    return data;
  },

  updateBanner(id, updates) {
    const source = this._demoMode ? DemoData.banners : FirebaseService._cache.banners;
    const item = source.find(b => b.id === id);
    if (item) Object.assign(item, updates);
    return item;
  },

  deleteBanner(id) {
    const source = this._demoMode ? DemoData.banners : FirebaseService._cache.banners;
    const idx = source.findIndex(b => b.id === id);
    if (idx >= 0) source.splice(idx, 1);
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
    return data;
  },

  updateAnnouncement(id, updates) {
    const source = this._demoMode ? DemoData.announcements : FirebaseService._cache.announcements;
    const item = source.find(a => a.id === id);
    if (item) Object.assign(item, updates);
    return item;
  },

  deleteAnnouncement(id) {
    const source = this._demoMode ? DemoData.announcements : FirebaseService._cache.announcements;
    const idx = source.findIndex(a => a.id === id);
    if (idx >= 0) source.splice(idx, 1);
  },

  // ════════════════════════════════
  //  Floating Ads（浮動廣告）
  // ════════════════════════════════

  getFloatingAds() {
    if (this._demoMode) return DemoData.floatingAds;
    return FirebaseService._cache.floatingAds;
  },

  createFloatingAd(data) {
    const source = this._demoMode ? DemoData.floatingAds : FirebaseService._cache.floatingAds;
    source.unshift(data);
    return data;
  },

  updateFloatingAd(id, updates) {
    const source = this._demoMode ? DemoData.floatingAds : FirebaseService._cache.floatingAds;
    const item = source.find(a => a.id === id);
    if (item) Object.assign(item, updates);
    return item;
  },

  deleteFloatingAd(id) {
    const source = this._demoMode ? DemoData.floatingAds : FirebaseService._cache.floatingAds;
    const idx = source.findIndex(a => a.id === id);
    if (idx >= 0) source.splice(idx, 1);
  },

  getPermissions() {
    if (this._demoMode) return DemoData.permissions;
    return FirebaseService._cache.permissions;
  },
};
