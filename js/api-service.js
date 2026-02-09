/* ================================================
   SportHub — API Service 抽象層
   ================================================
   目前為 Demo 模式，直接讀取 DemoData。
   實裝時將 _demoMode 改為 false，
   並實作各方法內的 fetch() 呼叫即可，
   App 層的渲染邏輯完全不需要改動。

   實裝時需要：
   1. 將 _demoMode 改為 false
   2. 設定 _baseUrl 為後端 API 位址
   3. 實作 _request() 中的 token 管理（LINE@ OAuth）
   4. 各方法改為 async，回傳 fetch 結果
   ================================================ */

const ApiService = {

  _demoMode: true,
  _baseUrl: '/api',  // 實裝時改為真實 API 位址，例如 'https://api.sporthub.tw/v1'

  // ─── 內部：統一 HTTP 請求（實裝時啟用） ───
  async _request(method, endpoint, body) {
    // 實裝時取消註解：
    // const token = AuthService.getToken();
    // const res = await fetch(this._baseUrl + endpoint, {
    //   method,
    //   headers: {
    //     'Content-Type': 'application/json',
    //     'Authorization': `Bearer ${token}`,
    //   },
    //   body: body ? JSON.stringify(body) : undefined,
    // });
    // if (!res.ok) throw new Error(`API Error: ${res.status}`);
    // return res.json();
  },

  // ════════════════════════════════
  //  Events（活動）
  // ════════════════════════════════

  getEvents() {
    if (this._demoMode) return DemoData.events;
    // return this._request('GET', '/events');
  },

  getEvent(id) {
    if (this._demoMode) return DemoData.events.find(e => e.id === id) || null;
    // return this._request('GET', `/events/${id}`);
  },

  getActiveEvents() {
    if (this._demoMode) return DemoData.events.filter(e => e.status !== 'ended' && e.status !== 'cancelled');
    // return this._request('GET', '/events?status=active');
  },

  getHotEvents(withinDays) {
    if (this._demoMode) {
      const now = new Date();
      const limit = new Date(now.getTime() + (withinDays || 14) * 24 * 60 * 60 * 1000);
      return DemoData.events.filter(e => {
        if (e.status === 'ended' || e.status === 'cancelled') return false;
        const parts = e.date.split(' ')[0].split('/');
        const eventDate = new Date(+parts[0], +parts[1] - 1, +parts[2]);
        return eventDate >= now && eventDate <= limit;
      });
    }
    // return this._request('GET', `/events/hot?days=${withinDays}`);
  },

  createEvent(data) {
    if (this._demoMode) {
      DemoData.events.unshift(data);
      return data;
    }
    // return this._request('POST', '/events', data);
  },

  updateEvent(id, updates) {
    if (this._demoMode) {
      const e = DemoData.events.find(ev => ev.id === id);
      if (e) Object.assign(e, updates);
      return e;
    }
    // return this._request('PATCH', `/events/${id}`, updates);
  },

  deleteEvent(id) {
    if (this._demoMode) {
      const idx = DemoData.events.findIndex(e => e.id === id);
      if (idx >= 0) DemoData.events.splice(idx, 1);
      return true;
    }
    // return this._request('DELETE', `/events/${id}`);
  },

  // ════════════════════════════════
  //  Tournaments（賽事）
  // ════════════════════════════════

  getTournaments() {
    if (this._demoMode) return DemoData.tournaments;
    // return this._request('GET', '/tournaments');
  },

  getTournament(id) {
    if (this._demoMode) return DemoData.tournaments.find(t => t.id === id) || null;
    // return this._request('GET', `/tournaments/${id}`);
  },

  createTournament(data) {
    if (this._demoMode) {
      DemoData.tournaments.unshift(data);
      return data;
    }
    // return this._request('POST', '/tournaments', data);
  },

  getStandings() {
    if (this._demoMode) return DemoData.standings;
    // return this._request('GET', '/tournaments/standings');
  },

  getMatches() {
    if (this._demoMode) return DemoData.matches;
    // return this._request('GET', '/tournaments/matches');
  },

  getTrades() {
    if (this._demoMode) return DemoData.trades;
    // return this._request('GET', '/tournaments/trades');
  },

  // ════════════════════════════════
  //  Teams（球隊）
  // ════════════════════════════════

  getTeams() {
    if (this._demoMode) return DemoData.teams;
    // return this._request('GET', '/teams');
  },

  getActiveTeams() {
    if (this._demoMode) return DemoData.teams.filter(t => t.active);
    // return this._request('GET', '/teams?active=true');
  },

  getTeam(id) {
    if (this._demoMode) return DemoData.teams.find(t => t.id === id) || null;
    // return this._request('GET', `/teams/${id}`);
  },

  updateTeam(id, updates) {
    if (this._demoMode) {
      const t = DemoData.teams.find(tm => tm.id === id);
      if (t) Object.assign(t, updates);
      return t;
    }
    // return this._request('PATCH', `/teams/${id}`, updates);
  },

  // ════════════════════════════════
  //  Shop（二手商品）
  // ════════════════════════════════

  getShopItems() {
    if (this._demoMode) return DemoData.shopItems;
    // return this._request('GET', '/shop');
  },

  getShopItem(id) {
    if (this._demoMode) return DemoData.shopItems.find(s => s.id === id) || null;
    // return this._request('GET', `/shop/${id}`);
  },

  createShopItem(data) {
    if (this._demoMode) {
      DemoData.shopItems.unshift(data);
      return data;
    }
    // return this._request('POST', '/shop', data);
  },

  // ════════════════════════════════
  //  Users & Admin（用戶管理）
  // ════════════════════════════════

  getAdminUsers() {
    if (this._demoMode) return DemoData.adminUsers;
    // return this._request('GET', '/admin/users');
  },

  getUserRole(name) {
    if (this._demoMode) return DEMO_USERS[name] || 'user';
    // return this._request('GET', `/users/${name}/role`);
  },

  // ════════════════════════════════
  //  Messages（站內信）
  // ════════════════════════════════

  getMessages() {
    if (this._demoMode) return DemoData.messages;
    // return this._request('GET', '/messages');
  },

  // ════════════════════════════════
  //  Leaderboard & Records（排行榜 & 紀錄）
  // ════════════════════════════════

  getLeaderboard() {
    if (this._demoMode) return DemoData.leaderboard;
    // return this._request('GET', '/leaderboard');
  },

  getActivityRecords() {
    if (this._demoMode) return DemoData.activityRecords;
    // return this._request('GET', '/users/me/activity-records');
  },

  // ════════════════════════════════
  //  Achievements & Badges
  // ════════════════════════════════

  getAchievements() {
    if (this._demoMode) return DemoData.achievements;
    // return this._request('GET', '/achievements');
  },

  getBadges() {
    if (this._demoMode) return DemoData.badges;
    // return this._request('GET', '/badges');
  },

  // ════════════════════════════════
  //  Admin：Logs, Banners, Permissions
  // ════════════════════════════════

  getExpLogs() {
    if (this._demoMode) return DemoData.expLogs;
    // return this._request('GET', '/admin/exp-logs');
  },

  getOperationLogs() {
    if (this._demoMode) return DemoData.operationLogs;
    // return this._request('GET', '/admin/operation-logs');
  },

  getBanners() {
    if (this._demoMode) return DemoData.banners;
    // return this._request('GET', '/admin/banners');
  },

  getPermissions() {
    if (this._demoMode) return DemoData.permissions;
    // return this._request('GET', '/admin/permissions');
  },
};
