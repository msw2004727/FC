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

  /**
   * 平行預載入：用 <link rel="preload"> 讓瀏覽器同時下載所有檔案到 HTTP 快取，
   * 後續 <script> 標籤執行時直接命中快取，不再等網路。
   */
  _preloaded: {},

  _preloadFiles(scripts) {
    scripts.forEach(src => {
      if (this._preloaded[src] || this._loaded[src]) return;
      this._preloaded[src] = true;
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'script';
      link.href = src + '?v=' + CACHE_VERSION;
      document.head.appendChild(link);
    });
  },

  /** 載入一組 scripts（平行預載 + 嚴格依序執行，避免 Object.assign 順序競態） */
  async loadGroup(scripts) {
    const toLoad = scripts.filter(s => !this._loaded[s]);
    if (toLoad.length === 0) return;
    // 先觸發平行下載，再依序執行（命中快取後每個 script 幾乎秒完成）
    this._preloadFiles(toLoad);
    for (const src of toLoad) {
      await this._load(src);
    }
  },

  // ════════════════════════════════
  //  頁面群組定義
  // ════════════════════════════════

  _groups: {
    achievement: [
      'js/modules/auto-exp/index.js',
      'js/modules/auto-exp/rules.js',
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
    achievementProfile: [
      'js/modules/auto-exp/index.js',
      'js/modules/auto-exp/rules.js',
      'js/modules/achievement/index.js',
      'js/modules/achievement/registry.js',
      'js/modules/achievement/shared.js',
      'js/modules/achievement/stats.js',
      'js/modules/achievement/evaluator.js',
      'js/modules/achievement/badges.js',
      'js/modules/achievement/titles.js',
      'js/modules/achievement/profile.js',
      'js/modules/achievement.js',
    ],
    activity: [
      'js/modules/auto-exp/index.js',
      'js/modules/auto-exp/rules.js',
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
      'js/modules/event/event-create-multidate.js',
      'js/modules/event/event-create.js',
      'js/modules/event/event-team-split.js',
      'js/modules/event/event-manage-noshow.js',
      'js/modules/event/event-manage-attendance.js',
      'js/modules/event/event-manage-instant-save.js',
      'js/modules/event/event-manage-confirm.js',
      'js/modules/event/event-manage-lifecycle.js',
      'js/modules/event/event-manage-badges.js',
      'js/modules/event/event-manage-waitlist.js',
      'js/modules/event/event-manage-visibility.js',
      'js/modules/event/event-manage.js',
      'js/modules/registration-audit.js',
    ],
    teamList: [
      'js/modules/team/team-list-helpers.js',
      'js/modules/team/team-list-stats.js',
      'js/modules/team/team-list.js',
      'js/modules/team/team-list-render.js',
    ],
    teamDetail: [
      'js/modules/auto-exp/index.js',
      'js/modules/event/event-share-builders.js',
      'js/modules/event/event-share.js',
      'js/modules/team/team-detail.js',
      'js/modules/team/team-feed.js',
      'js/modules/team/team-detail-render.js',
      'js/modules/team/team-detail-invite.js',
      'js/modules/team/team-share-builders.js',
      'js/modules/team/team-share.js',
      'js/modules/team/team-form-join.js',
    ],
    teamForm: [
      'js/modules/team/team-form-search.js',
      'js/modules/team/team-form-init.js',
      'js/modules/team/team-form-validate.js',
      'js/modules/team/team-form-roles.js',
      'js/modules/team/team-form.js',
    ],
    team: [
      'js/modules/auto-exp/index.js',
      'js/modules/event/event-share-builders.js',
      'js/modules/event/event-share.js',
      'js/modules/team/team-list-helpers.js',
      'js/modules/team/team-list-stats.js',
      'js/modules/team/team-list.js',
      'js/modules/team/team-list-render.js',
      'js/modules/team/team-detail.js',
      'js/modules/team/team-feed.js',
      'js/modules/team/team-detail-render.js',
      'js/modules/team/team-detail-invite.js',
      'js/modules/team/team-share-builders.js',
      'js/modules/team/team-share.js',
      'js/modules/team/team-form-join.js',
      'js/modules/team/team-form-search.js',
      'js/modules/team/team-form-init.js',
      'js/modules/team/team-form-validate.js',
      'js/modules/team/team-form-roles.js',
      'js/modules/team/team-form.js',
    ],
    profile: [
      'js/modules/auto-exp/index.js',
      'js/modules/auto-exp/rules.js',
      'js/modules/profile/profile-avatar.js',
      'js/modules/profile/profile-core.js',
      'js/modules/profile/profile-form.js',
      'js/modules/profile/profile-data.js',
      'js/modules/profile/profile-data-render.js',
      'js/modules/profile/profile-data-stats.js',
      'js/modules/profile/profile-data-history.js',
      'js/modules/leaderboard.js',
    ],
    profileCard: [
      'js/modules/profile/profile-card.js',
    ],
    profileShare: [
      'js/modules/event/event-share-builders.js',
      'js/modules/event/event-share.js',
      'js/modules/profile/profile-share.js',
    ],
    profileScene: [
      'js/modules/color-cat/color-cat-config.js',
      'js/modules/color-cat/color-cat-mbti.js',
      'js/modules/color-cat/dialogue/color-cat-dialogue-data.js',
      'js/modules/color-cat/dialogue/color-cat-dialogue-mbti-analysts.js',
      'js/modules/color-cat/dialogue/color-cat-dialogue-mbti-diplomats.js',
      'js/modules/color-cat/dialogue/color-cat-dialogue-mbti-sentinels.js',
      'js/modules/color-cat/dialogue/color-cat-dialogue-mbti-explorers.js',
      'js/modules/color-cat/color-cat-stats.js',
      'js/modules/color-cat/color-cat-sprite.js',
      'js/modules/color-cat/color-cat-ball.js',
      'js/modules/color-cat/color-cat-character.js',
      'js/modules/color-cat/color-cat-character-stamina.js',
      'js/modules/color-cat/color-cat-character-particles.js',
      'js/modules/color-cat/color-cat-character-actions.js',
      'js/modules/color-cat/color-cat-character-actions-interact.js',
      'js/modules/color-cat/color-cat-character-actions-special.js',
      'js/modules/color-cat/color-cat-character-combat.js',
      'js/modules/color-cat/color-cat-character-combo.js',
      'js/modules/color-cat/color-cat-character-ai.js',
      'js/modules/color-cat/color-cat-character-bubble.js',
      'js/modules/color-cat/color-cat-profile.js',
      'js/modules/color-cat/color-cat-scene.js',
      'js/modules/color-cat/color-cat-scene-bg.js',
      'js/modules/color-cat/color-cat-scene-box.js',
      'js/modules/color-cat/color-cat-scene-flag.js',
      'js/modules/color-cat/color-cat-scene-flower.js',
      'js/modules/color-cat/color-cat-scene-grass.js',
      'js/modules/color-cat/color-cat-scene-butterfly.js',
      'js/modules/color-cat/color-cat-scene-panel.js',
      'js/modules/color-cat/color-cat-scene-panel-tab0.js',
      'js/modules/color-cat/color-cat-scene-panel-tab1.js',
      'js/modules/color-cat/color-cat-scene-panel-tab2.js',
      'js/modules/color-cat/color-cat-scene-panel-modal.js',
      'js/modules/color-cat/color-cat-scene-signpost-modal.js',
      'js/modules/color-cat/color-cat-enemy.js',
      'js/modules/color-cat/color-cat-enemy-util.js',
      'js/modules/color-cat/color-cat-enemy-draw.js',
      'js/modules/color-cat/color-cat-enemy-projectile.js',
      'js/modules/color-cat/color-cat-damage-number.js',
      'js/modules/color-cat/color-cat-scene-fog.js',
      'js/modules/color-cat/color-cat-scene-grave.js',
      'js/modules/color-cat/color-cat-scene-stats-modal.js',
      'js/modules/color-cat/color-cat-scene-weather.js',
      'js/modules/color-cat/color-cat-naming.js',
      'js/modules/color-cat/color-cat-cloud-save.js',
    ],
    shop: [
      'js/modules/shop.js',
      'js/modules/leaderboard.js',
    ],
    scan: [
      'js/modules/auto-exp/index.js',
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
    tournamentList: [
      'js/modules/tournament/tournament-helpers.js',
      'js/modules/tournament/tournament-core.js',
      'js/modules/tournament/tournament-render.js',
    ],
    tournamentDetail: [
      'js/modules/team/team-list-helpers.js',
      'js/modules/tournament/tournament-helpers.js',
      'js/modules/tournament/tournament-core.js',
      'js/modules/tournament/tournament-render.js',
      'js/modules/event/event-share-builders.js',
      'js/modules/event/event-share.js',
      'js/modules/tournament/tournament-share-builders.js',
      'js/modules/tournament/tournament-detail.js',
      'js/modules/tournament/tournament-friendly-apply-state.js',
      'js/modules/tournament/tournament-friendly-state.js',
      'js/modules/tournament/tournament-friendly-detail.js',
      'js/modules/tournament/tournament-friendly-withdraw.js',
      'js/modules/tournament/tournament-friendly-detail-view.js',
      'js/modules/tournament/tournament-share.js',
      'js/modules/tournament/tournament-friendly-roster.js',
      'js/modules/tournament/tournament-friendly-notify.js',
    ],
    tournament: [
      'js/modules/team/team-list-helpers.js',
      'js/modules/tournament/tournament-helpers.js',
      'js/modules/tournament/tournament-core.js',
      'js/modules/tournament/tournament-render.js',
      'js/modules/event/event-share-builders.js',
      'js/modules/event/event-share.js',
      'js/modules/tournament/tournament-share-builders.js',
      'js/modules/tournament/tournament-detail.js',
      'js/modules/tournament/tournament-friendly-apply-state.js',
      'js/modules/tournament/tournament-friendly-state.js',
      'js/modules/tournament/tournament-friendly-detail.js',
      'js/modules/tournament/tournament-friendly-withdraw.js',
      'js/modules/tournament/tournament-friendly-detail-view.js',
      'js/modules/tournament/tournament-share.js',
      'js/modules/tournament/tournament-friendly-roster.js',
      'js/modules/tournament/tournament-friendly-notify.js',
    ],
    tournamentAdmin: [
      'js/modules/event/event-share-builders.js',
      'js/modules/event/event-share.js',
      'js/modules/tournament/tournament-share-builders.js',
      'js/modules/tournament/tournament-manage-form.js',
      'js/modules/tournament/tournament-manage-people.js',
      'js/modules/tournament/tournament-manage-host-selection.js',
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
      'js/modules/dashboard/dashboard-usage.js',
      'js/modules/dashboard/dashboard-ci-usage.js',
      'js/modules/dashboard/dashboard-participant-query.js',
      'js/modules/dashboard/dashboard-participant-share.js',
      'js/modules/dashboard/dashboard-data-fetcher.js',
      'js/modules/dashboard/dashboard-snapshot.js',
      'js/modules/dashboard/dashboard-progress-modal.js',
      'js/modules/dashboard/dashboard-info-modal.js',
      'js/modules/dashboard/dashboard-drilldown-core.js',
      'js/modules/dashboard/dashboard-drilldown-users.js',
      'js/modules/dashboard/dashboard-drilldown-events.js',
      'js/modules/dashboard/dashboard-drilldown-teams.js',
      'js/modules/dashboard/dashboard-drilldown-tourns.js',
      'js/modules/dashboard/dashboard-drilldown-open.js',
      'js/modules/dashboard/dashboard-drilldown-ended.js',
      'js/modules/dashboard/dashboard-drilldown-records.js',
      'js/modules/dashboard/dashboard-drilldown-attend.js',
    ],
    personalDashboard: [
      'js/modules/dashboard/dashboard-widgets.js',
      'js/modules/dashboard/dashboard.js',
      'js/modules/dashboard/personal-dashboard.js',
    ],
    adminSeo: [
      'js/modules/admin-seo/seo-data-loader.js',
      'js/modules/admin-seo/seo-dashboard.js',
    ],
    // 月曆視圖：切到月曆 tab 時才動態載入（見 calendar-view-plan §5 lazy-load 方案 A）
    activityCalendar: [
      'js/modules/event/event-calendar-constants.js',
      'js/modules/event/event-list-calendar.js',
      'js/modules/event/event-list-calendar-build.js',
      'js/modules/event/event-list-calendar-nav.js',
    ],
    adminUsers: [
      'js/modules/auto-exp/index.js',
      'js/modules/auto-exp/rules.js',
      'js/modules/event/event-manage-noshow.js',
      'js/modules/user-admin/user-admin-list.js',
      'js/modules/user-admin/user-admin-exp.js',
      'js/modules/user-admin/user-admin-roles.js',
      'js/modules/user-admin/user-admin-perm-info.js',
      'js/modules/user-admin/user-admin-corrections.js',
      'js/modules/user-admin/user-admin-event-blocklist.js',
      'js/modules/achievement/batch.js',
      'js/modules/data-sync.js',
    ],
    adminContent: [
      'js/modules/ad-manage/ad-manage-core.js',
      'js/modules/ad-manage/ad-manage-banner.js',
      'js/modules/ad-manage/ad-manage-float.js',
      'js/modules/ad-manage/ad-manage-popup-sponsor.js',
      'js/modules/ad-manage/ad-manage-shotgame.js',
      'js/modules/ad-manage/boot-brand-manage.js',
    ],
    adminSystem: [
      'js/modules/auto-exp/index.js',
      'js/modules/game-manage.js',
      'js/modules/game-log-viewer.js',
      'js/modules/admin-log-tabs.js',
      'js/modules/error-log-diagnostics.js',
      'js/modules/error-log-insights.js',
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
      'js/modules/education/edu-course-plan-render.js',
      'js/modules/education/edu-course-plan-attendance.js',
      'js/modules/education/edu-course-enrollment.js',
      'js/modules/education/edu-course-enrollment-render.js',
      'js/modules/education/edu-checkin.js',
      'js/modules/education/edu-checkin-scan.js',
      'js/modules/education/edu-calendar-core.js',
      'js/modules/education/edu-calendar-stamp.js',
      'js/modules/education/edu-calendar-monthly.js',
      'js/modules/education/edu-parent-binding.js',
      'js/modules/education/edu-notify.js',
      'js/modules/education/edu-detail-realtime.js',
      'js/modules/education/edu-detail-withdraw.js',
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
    'page-teams':              ['teamList'],
    'page-team-detail':        ['teamList', 'teamDetail', 'education'],
    'page-team-manage':        ['teamList', 'teamForm'],
    'page-profile':            ['profile'],
    'page-qrcode':             ['profile', 'profileCard'],
    'page-user-card':          ['profile', 'achievementProfile', 'profileCard', 'profileShare'],
    'page-titles':             ['profile', 'achievementProfile'],
    'page-shop':               ['shop'],
    'page-leaderboard':        ['achievement', 'shop'],
    'page-tournaments':        ['tournamentList'],
    'page-tournament-detail':  ['tournamentDetail'],
    'page-messages':           ['message'],
    'page-scan':               ['scan'],
    'page-game':               ['game'],
    'page-kick-game':          ['kickball'],
    'page-personal-dashboard': ['achievement', 'personalDashboard'],
    'page-admin-dashboard':    ['adminDashboard'],
    'page-admin-seo':          ['adminSeo'],
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
    'page-admin-teams':        ['teamList', 'teamForm'],
    'page-admin-tournaments':  ['tournamentList', 'tournamentAdmin'],
    'page-admin-games':        ['adminSystem'],
    'page-admin-auto-exp':     ['adminSystem'],
    'page-admin-error-logs':   ['adminSystem'],
    'page-edu-groups':         ['education'],
    'page-edu-students':       ['education'],
    'page-edu-course-plan':    ['education'],
    'page-edu-course-enrollment': ['education'],
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

  async ensureGroup(groupName) {
    if (!groupName) return;
    this._primeLoadedFromDom();
    const scripts = this._groups[groupName] || [];
    if (scripts.length === 0) return;
    await this.loadGroup(scripts);
  },

  /** 檢查頁面所需腳本是否全部已載入（同步） */
  isPageReady(pageId) {
    this._primeLoadedFromDom();
    const groups = this._pageGroups[pageId] || [];
    for (const groupName of groups) {
      const scripts = this._groups[groupName] || [];
      for (const src of scripts) {
        if (!this._loaded[src]) return false;
      }
    }
    return true;
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

  _preloadQueued: false,

  /**
   * 首頁渲染完成後，背景預載入核心頁面 scripts
   * Step 1: 立即平行下載所有核心頁面的檔案（不阻塞、不執行）
   * Step 2: 閒置時依序執行（活動 → 俱樂部 → 賽事 → 個人）
   */
  preloadCorePages() {
    if (this._preloadQueued) return;
    this._preloadQueued = true;

    // Step 1: 立即觸發平行下載（只下載不執行，不影響首頁效能）
    this._primeLoadedFromDom();
    const corePages = ['page-activities', 'page-teams', 'page-tournaments', 'page-profile'];
    const allScripts = [];
    const seen = new Set();
    corePages.forEach(pageId => {
      const groups = this._pageGroups[pageId] || [];
      groups.forEach(g => {
        (this._groups[g] || []).forEach(src => {
          if (!seen.has(src) && !this._loaded[src]) { seen.add(src); allScripts.push(src); }
        });
      });
    });
    if (allScripts.length > 0) this._preloadFiles(allScripts);
    // Keep this as network warmup only. Executing every core page script after
    // a cache/version refresh causes visible main-thread jank during navigation.
    console.log('[ScriptLoader] core page scripts preloaded (network hints only)');
  },
};
