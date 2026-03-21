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
      'js/modules/auto-exp.js',
      'js/modules/auto-exp-rules.js',
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
      'js/modules/auto-exp.js',
      'js/modules/auto-exp-rules.js',
      'js/modules/event/event-list-helpers.js',
      'js/modules/event/event-list-stats.js',
      'js/modules/event/event-list-home.js',
      'js/modules/event/event-list-timeline.js',
      'js/modules/event/event-list.js',
      'js/modules/event/event-share-builders.js',
      'js/modules/event/event-share.js',
      'js/modules/event/event-detail-calendar.js',
      'js/modules/event/event-detail.js',
      'js/modules/event/event-detail-signup.js',
      'js/modules/event/event-detail-notify-prompt.js',
      'js/modules/event/event-detail-companion.js',
      'js/modules/event/event-create-input-history.js',
      'js/modules/event/event-create-sport-picker.js',
      'js/modules/event/event-create-delegates.js',
      'js/modules/event/event-create-options.js',
      'js/modules/event/event-create-team-picker.js',
      'js/modules/event/event-create-external.js',
      'js/modules/event/event-create-template.js',
      'js/modules/event/event-create-waitlist.js',
      'js/modules/event/event-create.js',
      'js/modules/event/event-manage-noshow.js',
      'js/modules/event/event-manage-attendance.js',
      'js/modules/event/event-manage-confirm.js',
      'js/modules/event/event-manage-lifecycle.js',
      'js/modules/event/event-manage-badges.js',
      'js/modules/event/event-manage-waitlist.js',
      'js/modules/event/event-manage.js',
      'js/modules/registration-audit.js',
    ],
    team: [
      'js/modules/auto-exp.js',
      'js/modules/event/event-share-builders.js',
      'js/modules/event/event-share.js',
      'js/modules/team/team-list.js',
      'js/modules/team/team-list-render.js',
      'js/modules/team/team-detail.js',
      'js/modules/team/team-detail-render.js',
      'js/modules/team/team-detail-members.js',
      'js/modules/team/team-share.js',
      'js/modules/team/team-form-join.js',
      'js/modules/team/team-form-search.js',
      'js/modules/team/team-form-init.js',
      'js/modules/team/team-form.js',
    ],
    profile: [
      'js/modules/auto-exp.js',
      'js/modules/auto-exp-rules.js',
      'js/modules/event/event-share-builders.js',
      'js/modules/event/event-share.js',
      'js/modules/profile/profile-avatar.js',
      'js/modules/profile/profile-core.js',
      'js/modules/profile/profile-form.js',
      'js/modules/profile/profile-data.js',
      'js/modules/profile/profile-data-render.js',
      'js/modules/profile/profile-data-stats.js',
      'js/modules/profile/profile-data-history.js',
      'js/modules/profile/profile-card.js',
      'js/modules/profile/profile-share.js',
      'js/modules/leaderboard.js',
      'js/modules/color-cat/color-cat-config.js',
      'js/modules/color-cat/color-cat-stats.js',
      'js/modules/color-cat/color-cat-sprite.js',
      'js/modules/color-cat/color-cat-ball.js',
      'js/modules/color-cat/color-cat-character.js',
      'js/modules/color-cat/color-cat-character-stamina.js',
      'js/modules/color-cat/color-cat-character-particles.js',
      'js/modules/color-cat/color-cat-character-actions.js',
      'js/modules/color-cat/color-cat-character-actions-interact.js',
      'js/modules/color-cat/color-cat-character-actions-special.js',
      'js/modules/color-cat/color-cat-character-combo.js',
      'js/modules/color-cat/color-cat-character-ai.js',
      'js/modules/color-cat/color-cat-profile.js',
      'js/modules/color-cat/color-cat-scene.js',
      'js/modules/color-cat/color-cat-scene-bg.js',
      'js/modules/color-cat/color-cat-scene-box.js',
      'js/modules/color-cat/color-cat-scene-flag.js',
      'js/modules/color-cat/color-cat-scene-flower.js',
      'js/modules/color-cat/color-cat-scene-butterfly.js',
      'js/modules/color-cat/color-cat-scene-panel.js',
      'js/modules/color-cat/color-cat-scene-panel-tab0.js',
      'js/modules/color-cat/color-cat-scene-panel-tab1.js',
      'js/modules/color-cat/color-cat-scene-panel-tab2.js',
    ],
    shop: [
      'js/modules/shop.js',
      'js/modules/leaderboard.js',
    ],
    scan: [
      'js/modules/auto-exp.js',
      'js/modules/scan/scan.js',
      'js/modules/scan/scan-ui.js',
      'js/modules/scan/scan-camera.js',
      'js/modules/scan/scan-process.js',
      'js/modules/scan/scan-family.js',
      'js/modules/attendance-notify.js',
    ],
    game: [
      'js/modules/shot-game/shot-page-ui.js',
      'js/modules/shot-game/shot-game-page.js',
    ],
    kickball: [
      'js/modules/kickball/kickball-helpers.js',
      'js/modules/kickball/kickball-leaderboard.js',
      'js/modules/kickball/kickball-renderer.js',
      'js/modules/kickball/kickball-ui.js',
      'js/modules/kickball/kickball-physics.js',
      'js/modules/kickball/kickball-game-page.js',
    ],
    tournament: [
      'js/modules/tournament/tournament-detail.js',
      'js/modules/tournament/tournament-friendly-detail.js',
      'js/modules/tournament/tournament-friendly-detail-view.js',
      'js/modules/tournament/tournament-share.js',
      'js/modules/tournament/tournament-friendly-roster.js',
      'js/modules/tournament/tournament-friendly-notify.js',
    ],
    tournamentAdmin: [
      'js/modules/event/event-share-builders.js',
      'js/modules/event/event-share.js',
      'js/modules/tournament/tournament-manage-form.js',
      'js/modules/tournament/tournament-manage-host.js',
      'js/modules/tournament/tournament-manage-edit.js',
      'js/modules/tournament/tournament-manage.js',
      'js/modules/tournament/tournament-share.js',
    ],
    message: [
      'js/modules/message/message-actions.js',
      'js/modules/message/message-actions-team.js',
      'js/modules/message/message-inbox.js',
    ],
    messageAdmin: [
      'js/modules/message/message-admin-list.js',
      'js/modules/message/message-admin-compose.js',
      'js/modules/message/message-admin.js',
    ],
    adminDashboard: [
      'js/modules/dashboard/dashboard-widgets.js',
      'js/modules/dashboard/dashboard.js',
      'js/modules/dashboard/dashboard-participant-query.js',
      'js/modules/dashboard/dashboard-participant-share.js',
    ],
    personalDashboard: [
      'js/modules/dashboard/dashboard-widgets.js',
      'js/modules/dashboard/dashboard.js',
      'js/modules/dashboard/personal-dashboard.js',
    ],
    adminUsers: [
      'js/modules/auto-exp.js',
      'js/modules/auto-exp-rules.js',
      'js/modules/event/event-manage-noshow.js',
      'js/modules/user-admin/user-admin-list.js',
      'js/modules/user-admin/user-admin-exp.js',
      'js/modules/user-admin/user-admin-roles.js',
      'js/modules/user-admin/user-admin-corrections.js',
      'js/modules/achievement-batch.js',
      'js/modules/data-sync.js',
    ],
    adminContent: [
      'js/modules/ad-manage/ad-manage-core.js',
      'js/modules/ad-manage/ad-manage-banner.js',
      'js/modules/ad-manage/ad-manage-float.js',
      'js/modules/ad-manage/ad-manage-popup-sponsor.js',
      'js/modules/ad-manage/ad-manage-shotgame.js',
    ],
    adminSystem: [
      'js/modules/auto-exp.js',
      'js/modules/game-manage.js',
      'js/modules/admin-log-tabs.js',
      'js/modules/error-log.js',
      'js/modules/audit-log.js',
    ],
    education: [
      'js/modules/education/edu-helpers.js',
      'js/modules/education/edu-group-list.js',
      'js/modules/education/edu-group-form.js',
      'js/modules/education/edu-student-list.js',
      'js/modules/education/edu-student-form.js',
      'js/modules/education/edu-student-join.js',
      'js/modules/education/edu-course-plan.js',
      'js/modules/education/edu-checkin.js',
      'js/modules/education/edu-checkin-scan.js',
      'js/modules/education/edu-calendar-core.js',
      'js/modules/education/edu-calendar-stamp.js',
      'js/modules/education/edu-calendar-monthly.js',
      'js/modules/education/edu-parent-binding.js',
      'js/modules/education/edu-notify.js',
      'js/modules/education/edu-detail-render.js',
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
    'page-team-detail':        ['team', 'education'],
    'page-team-manage':        ['team'],
    'page-profile':            ['achievement', 'profile'],
    'page-qrcode':             ['profile'],
    'page-user-card':          ['achievement', 'profile'],
    'page-titles':             ['achievement', 'profile'],
    'page-shop':               ['shop'],
    'page-leaderboard':        ['achievement', 'shop'],
    'page-tournaments':        ['tournament'],
    'page-tournament-detail':  ['tournament'],
    'page-messages':           ['message'],
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
    'page-admin-repair':       ['adminUsers', 'achievement'],
    'page-admin-banners':      ['adminContent'],
    'page-admin-shop':         ['shop'],
    'page-admin-messages':     ['messageAdmin'],
    'page-admin-teams':        ['team'],
    'page-admin-tournaments':  ['tournamentAdmin'],
    'page-admin-games':        ['adminSystem'],
    'page-admin-auto-exp':     ['adminSystem'],
    'page-admin-error-logs':   ['adminSystem'],
    'page-edu-groups':         ['education'],
    'page-edu-students':       ['education'],
    'page-edu-course-plan':    ['education'],
    'page-edu-checkin':        ['education'],
    'page-edu-calendar':       ['education'],
    'page-edu-student-apply':  ['education'],
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
