/* ================================================
   SportHub — Dynamic Script Loader
   ================================================
   按頁面群組動態載入 JS 模組，啟動時只載核心。
   所有模組仍用 Object.assign(App, {...}) 模式。
   ================================================ */

const ScriptLoader = {

  _loaded: {},
  _loading: {},
  _domPrimed: false,

  _normalizeLocalSrc(src) {
    try {
      const url = new URL(src, window.location.href);
      if (url.origin !== window.location.origin) return null;
      return decodeURIComponent(url.pathname.replace(/^\//, ''));
    } catch (_) {
      return null;
    }
  },

  _primeLoadedFromDom() {
    if (this._domPrimed) return;
    document.querySelectorAll('script[src]').forEach(script => {
      const normalized = this._normalizeLocalSrc(script.src);
      if (!normalized) return;
      this._loaded[normalized] = true;
    });
    this._domPrimed = true;
  },

  /** 載入單一 script（回傳 Promise） */
  _load(src) {
    this._primeLoadedFromDom();
    if (this._loaded[src]) return Promise.resolve();
    if (this._loading[src]) return this._loading[src];

    this._loading[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src + '?v=' + CACHE_VERSION;
      s.async = false;
      s.onload = () => { this._loaded[src] = true; delete this._loading[src]; resolve(); };
      s.onerror = () => { delete this._loading[src]; reject(new Error('Failed: ' + src)); };
      document.head.appendChild(s);
    });
    return this._loading[src];
  },

  /** 載入一組 scripts（嚴格依序執行，避免 Object.assign 順序競態） */
  async loadGroup(scripts) {
    const toLoad = scripts.filter(s => !this._loaded[s]);
    if (toLoad.length === 0) return;
    for (const src of toLoad) {
      await this._load(src);
    }
  },

  // ════════════════════════════════
  //  頁面群組定義
  // ════════════════════════════════

  _groups: {
    achievement: [
      'js/modules/image-cropper.js',
      'js/modules/image-upload.js',
      'js/modules/achievement/index.js',
      'js/modules/achievement/registry.js',
      'js/modules/achievement/shared.js',
      'js/modules/achievement/stats.js',
      'js/modules/achievement/evaluator.js',
      'js/modules/achievement/badges.js',
      'js/modules/achievement/titles.js',
      'js/modules/achievement/profile.js',
      'js/modules/achievement/view.js',
      'js/modules/achievement/admin.js',
      'js/modules/achievement.js',
    ],
    activity: [
      'js/modules/event-list.js',
      'js/modules/event-share.js',
      'js/modules/event-detail.js',
      'js/modules/event-detail-signup.js',
      'js/modules/event-detail-companion.js',
      'js/modules/event-create.js',
      'js/modules/event-manage.js',
      'js/modules/registration-audit.js',
    ],
    team: [
      'js/modules/event-share.js',
      'js/modules/team-list.js',
      'js/modules/team-detail.js',
      'js/modules/team-share.js',
      'js/modules/team-form.js',
    ],
    profile: [
      'js/modules/event-share.js',
      'js/modules/profile-core.js',
      'js/modules/profile-data.js',
      'js/modules/profile-card.js',
      'js/modules/profile-share.js',
    ],
    shop: [
      'js/modules/shop.js',
      'js/modules/leaderboard.js',
    ],
    scan: [
      'js/modules/scan.js',
      'js/modules/attendance-notify.js',
    ],
    game: [
      'js/modules/shot-game-page.js',
    ],
    kickball: [
      'js/modules/kickball-game-page.js',
    ],
    tournamentAdmin: [
      'js/modules/event-share.js',
      'js/modules/tournament-manage.js',
      'js/modules/tournament-share.js',
    ],
    messageAdmin: [
      'js/modules/message-admin.js',
    ],
    adminDashboard: [
      'js/modules/dashboard.js',
      'js/modules/dashboard-participant-query.js',
      'js/modules/dashboard-participant-share.js',
    ],
    personalDashboard: [
      'js/modules/dashboard.js',
      'js/modules/personal-dashboard.js',
    ],
    adminUsers: [
      'js/modules/user-admin-list.js',
      'js/modules/user-admin-exp.js',
      'js/modules/user-admin-roles.js',
      'js/modules/user-admin-corrections.js',
    ],
    adminContent: [
      'js/modules/ad-manage-core.js',
      'js/modules/ad-manage-banner.js',
      'js/modules/ad-manage-float.js',
      'js/modules/ad-manage-popup-sponsor.js',
      'js/modules/ad-manage-shotgame.js',
    ],
    adminSystem: [
      'js/modules/auto-exp.js',
      'js/modules/game-manage.js',
      'js/modules/admin-log-tabs.js',
      'js/modules/error-log.js',
      'js/modules/audit-log.js',
    ],
  },

  // 頁面 ID → 需要的群組
  _pageGroups: {
    'page-achievements':       ['achievement'],
    'page-admin-achievements': ['achievement'],
    'page-activities':         ['activity'],
    'page-activity-detail':    ['activity', 'achievement'],
    'page-my-activities':      ['activity'],
    'page-teams':              ['team'],
    'page-team-detail':        ['team'],
    'page-team-manage':        ['team'],
    'page-profile':            ['achievement', 'profile'],
    'page-qrcode':             ['profile'],
    'page-user-card':          ['achievement', 'profile'],
    'page-titles':             ['achievement', 'profile'],
    'page-shop':               ['shop'],
    'page-leaderboard':        ['achievement', 'shop'],
    'page-scan':               ['scan'],
    'page-game':               ['game'],
    'page-kick-game':          ['kickball'],
    'page-personal-dashboard': ['achievement', 'personalDashboard'],
    'page-admin-dashboard':    ['adminDashboard'],
    'page-temp-participant-report': ['adminDashboard'],
    'page-admin-users':        ['adminUsers'],
    'page-admin-exp':          ['adminUsers'],
    'page-admin-roles':        ['adminUsers'],
    'page-admin-inactive':     ['adminUsers'],
    'page-admin-logs':         ['adminUsers', 'adminDashboard', 'adminSystem'],
    'page-admin-audit-logs':   ['adminSystem'],
    'page-admin-repair':       ['adminUsers'],
    'page-admin-banners':      ['adminContent'],
    'page-admin-shop':         ['shop'],
    'page-admin-messages':     ['messageAdmin'],
    'page-admin-teams':        ['team'],
    'page-admin-tournaments':  ['tournamentAdmin'],
    'page-admin-games':        ['adminSystem'],
    'page-admin-auto-exp':     ['adminSystem'],
    'page-admin-error-logs':   ['adminSystem'],
  },

  /** 確保頁面需要的群組已載入 */
  async ensureForPage(pageId) {
    this._primeLoadedFromDom();
    const groups = this._pageGroups[pageId] || [];
    if (groups.length === 0) return;

    const orderedScripts = [];
    const seen = new Set();

    groups.forEach(groupName => {
      const scripts = this._groups[groupName] || [];
      scripts.forEach(src => {
        if (seen.has(src)) return;
        seen.add(src);
        orderedScripts.push(src);
      });
    });

    await this.loadGroup(orderedScripts);
  },

  /** 預載入所有群組（背景，不阻塞） */
  preloadAll() {
    this._primeLoadedFromDom();
    const allScripts = Object.values(this._groups).flat();
    const toLoad = allScripts.filter(s => !this._loaded[s]);
    if (toLoad.length === 0) return;
    // 用低優先級預載入
    const load = () => this.loadGroup(toLoad).catch(() => {});
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(load);
    } else {
      setTimeout(load, 3000);
    }
  },
};
