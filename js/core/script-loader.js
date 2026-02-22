/* ================================================
   SportHub — Dynamic Script Loader
   ================================================
   按頁面群組動態載入 JS 模組，啟動時只載核心。
   所有模組仍用 Object.assign(App, {...}) 模式。
   ================================================ */

const ScriptLoader = {

  _loaded: {},
  _loading: {},

  /** 載入單一 script（回傳 Promise） */
  _load(src) {
    if (this._loaded[src]) return Promise.resolve();
    if (this._loading[src]) return this._loading[src];

    this._loading[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src + '?v=' + CACHE_VERSION;
      s.onload = () => { this._loaded[src] = true; delete this._loading[src]; resolve(); };
      s.onerror = () => { delete this._loading[src]; reject(new Error('Failed: ' + src)); };
      document.head.appendChild(s);
    });
    return this._loading[src];
  },

  /** 載入一組 scripts（平行下載，保持執行順序） */
  async loadGroup(scripts) {
    const toLoad = scripts.filter(s => !this._loaded[s]);
    if (toLoad.length === 0) return;
    // 平行 fetch，但依序 append 以維持 Object.assign 順序
    await Promise.all(toLoad.map(s => this._load(s)));
  },

  // ════════════════════════════════
  //  頁面群組定義
  // ════════════════════════════════

  _groups: {
    // 活動群組
    activity: [
      'js/modules/event-list.js',
      'js/modules/event-detail.js',
      'js/modules/event-detail-signup.js',
      'js/modules/event-detail-companion.js',
      'js/modules/event-create.js',
      'js/modules/event-manage.js',
    ],
    // 球隊群組
    team: [
      'js/modules/team-list.js',
      'js/modules/team-detail.js',
      'js/modules/team-form.js',
    ],
    // 賽事群組
    tournament: [
      'js/modules/tournament-render.js',
      'js/modules/tournament-manage.js',
    ],
    // 訊息群組
    message: [
      'js/modules/message-inbox.js',
      'js/modules/message-admin.js',
    ],
    // 個人資料群組
    profile: [
      'js/modules/profile-core.js',
      'js/modules/profile-data.js',
      'js/modules/profile-card.js',
      'js/modules/favorites.js',
      'js/modules/leaderboard.js',
    ],
    // 商品
    shop: ['js/modules/shop.js'],
    // 掃碼
    scan: ['js/modules/scan.js'],
    // Admin 後台
    admin: [
      'js/modules/dashboard.js',
      'js/modules/personal-dashboard.js',
      'js/modules/user-admin-list.js',
      'js/modules/user-admin-exp.js',
      'js/modules/user-admin-roles.js',
      'js/modules/auto-exp.js',
      'js/modules/achievement.js',
      'js/modules/ad-manage-core.js',
      'js/modules/ad-manage-banner.js',
      'js/modules/ad-manage-float.js',
      'js/modules/ad-manage-popup-sponsor.js',
      'js/modules/leaderboard.js',
    ],
  },

  // 頁面 ID → 需要的群組
  _pageGroups: {
    'page-home':               ['activity'],
    'page-activities':         ['activity'],
    'page-teams':              ['team'],
    'page-tournaments':        ['tournament'],
    'page-messages':           ['message'],
    'page-profile':            ['profile'],
    'page-shop':               ['shop'],
    'page-scan':               ['scan'],
    'page-activity-detail':    ['activity'],
    'page-my-activities':      ['activity'],
    'page-team-detail':        ['team'],
    'page-team-manage':        ['team'],
    'page-user-card':          ['profile'],
    'page-titles':             ['profile'],
    'page-personal-dashboard': ['admin'],
    'page-admin-dashboard':    ['admin'],
    'page-admin-users':        ['admin'],
    'page-admin-banners':      ['admin'],
    'page-admin-shop':         ['shop', 'admin'],
    'page-admin-messages':     ['admin', 'message'],
    'page-admin-teams':        ['team', 'admin'],
    'page-admin-tournaments':  ['tournament', 'admin'],
    'page-admin-achievements': ['admin'],
    'page-admin-roles':        ['admin'],
    'page-admin-inactive':     ['admin'],
    'page-admin-exp':          ['admin'],
    'page-admin-auto-exp':     ['admin'],
    'page-admin-announcements':['admin'],
    'page-admin-themes':       ['admin'],
    'page-admin-logs':         ['admin'],
    'page-qrcode':             ['scan'],
    'page-leaderboard':        ['admin'],
  },

  /** 確保頁面需要的群組已載入 */
  async ensureForPage(pageId) {
    const groups = this._pageGroups[pageId];
    if (!groups) return;
    const promises = groups.map(g => {
      const scripts = this._groups[g];
      return scripts ? this.loadGroup(scripts) : Promise.resolve();
    });
    await Promise.all(promises);
  },

  /** 預載入所有群組（背景，不阻塞） */
  preloadAll() {
    const allScripts = Object.values(this._groups).flat();
    const toLoad = allScripts.filter(s => !this._loaded[s]);
    if (toLoad.length === 0) return;
    // 用低優先級預載入
    const load = () => toLoad.forEach(s => this._load(s).catch(() => {}));
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(load);
    } else {
      setTimeout(load, 3000);
    }
  },
};
