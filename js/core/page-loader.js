/* ================================================
   SportHub — Page Loader（HTML 頁面片段載入器）
   ================================================
   將 index.html 拆分為獨立的 HTML 片段檔案，
   啟動時只載入首頁 + 必要片段，其餘按需載入。
   ================================================ */

const PageLoader = {

  /** 啟動時必須載入的頁面（首頁 + 核心頁面） */
  _bootPages: ['home', 'activity', 'team', 'message', 'profile', 'tournament'],

  /** 延遲載入的頁面 */
  _deferredPages: [
    'scan', 'shop',
    'admin-users', 'admin-content', 'admin-system',
    'admin-notif',
    'admin-dashboard', 'admin-seo', 'admin-auto-exp', 'personal-dashboard',
    'game',
    'kickball',
    'education',
  ],

  /** 全域彈窗片段 */
  _modals: ['modals'],

  /** 已載入的頁面記錄 */
  _loaded: {},

  /** 正在載入中的片段 Promise */
  _loading: {},

  /** 首次 boot pages 載入 Promise */
  _loadAllPromise: null,

  /** Shared boot fetches so ensurePage(pageId) can wait for only one fragment. */
  _bootFetchMap: null,
  _bootModalFetch: null,

  /** 頁面 ID → 片段檔名映射 */
  _pageFileMap: {
    'page-home':               'home',
    'page-activities':         'activity',
    'page-activity-detail':    'activity',
    'page-my-activities':      'activity',
    'page-teams':              'team',
    'page-team-detail':        'team',
    'page-team-manage':        'team',
    'page-messages':           'message',
    'page-profile':            'profile',
    'page-qrcode':             'profile',
    'page-achievements':       'profile',
    'page-titles':             'profile',
    'page-user-card':          'profile',
    'page-scan':               'scan',
    'page-tournaments':        'tournament',
    'page-tournament-detail':  'tournament',
    'page-admin-tournaments':  'tournament',
    'page-shop':               'shop',
    'page-shop-detail':        'shop',
    'page-leaderboard':        'shop',
    'page-admin-shop':         'shop',
    'page-admin-users':        'admin-users',
    'page-admin-exp':          'admin-users',
    'page-admin-notif':        'admin-notif',
    'page-admin-roles':        'admin-system',
    'page-admin-logs':         'admin-system',
    'page-admin-audit-logs':   'admin-system',
    'page-admin-inactive':     'admin-system',
    'page-admin-error-logs':   'admin-system',
    'page-admin-repair':       'admin-system',
    'page-admin-banners':      'admin-content',
    'page-admin-messages':     'admin-content',
    'page-admin-achievements': 'admin-content',
    'page-admin-announcements':'admin-content',
    'page-admin-games':        'admin-system',
    'page-admin-themes':       'admin-system',
    'page-admin-dashboard':    'admin-dashboard',
    'page-admin-seo':          'admin-seo',
    'page-temp-participant-report': 'admin-dashboard',
    'page-admin-auto-exp':     'admin-auto-exp',
    'page-personal-dashboard': 'personal-dashboard',
    'page-admin-teams':        'admin-content',
    'page-game':               'game',
    'page-kick-game':          'kickball',
    'page-edu-groups':         'education',
    'page-edu-students':       'education',
    'page-edu-course-plan':    'education',
    'page-edu-course-enrollment': 'education',
    'page-edu-checkin':        'education',
    'page-edu-calendar':       'education',
    'page-edu-student-apply':  'education',
  },

  _appendToMainContent(html) {
    const mainEl = document.getElementById('main-content');
    const temp = document.createElement('div');
    temp.innerHTML = html;
    while (temp.firstChild) mainEl.appendChild(temp.firstChild);
  },

  _bindLoadedPageElements() {
    if (typeof App !== 'undefined' && App._bindPageElements) {
      try { App._bindPageElements(); } catch (e) {
        console.warn('[PageLoader] _bindPageElements:', e);
      }
    }
  },

  async _loadSingleFile(fileName, reason = '按需載入') {
    if (!fileName || this._loaded[fileName]) return;
    if (this._loading[fileName]) return this._loading[fileName];

    this._loading[fileName] = (async () => {
      const r = await fetch(`pages/${fileName}.html?v=${CACHE_VERSION}`);
      if (!r.ok) { console.warn(`[PageLoader] ${fileName} HTTP ${r.status}`); return; }
      const html = await r.text();
      this._appendToMainContent(html);
      this._loaded[fileName] = true;
      console.log(`[PageLoader] ${reason}: ${fileName}`);
      this._bindLoadedPageElements();
    })()
      .catch(err => {
        console.warn(`[PageLoader] ${fileName} 載入失敗:`, err);
      })
      .finally(() => {
        delete this._loading[fileName];
      });

    return this._loading[fileName];
  },

  _getBootPriorityFile() {
    try {
      if (sessionStorage.getItem('_pendingDeepEvent')) return 'activity';
      if (sessionStorage.getItem('_pendingDeepTeam')) return 'team';
      if (sessionStorage.getItem('_pendingDeepTournament')) return 'tournament';
      if (sessionStorage.getItem('_pendingDeepProfile')) return 'profile';
    } catch (_) {}

    try {
      const hashPage = (location.hash || '').replace(/^#/, '').trim();
      if (!hashPage || hashPage === 'page-home' || !/^page-[\w-]+$/.test(hashPage)) return null;
      const resolvedHash = (typeof App !== 'undefined' && typeof App._resolveBootPageId === 'function')
        ? App._resolveBootPageId(hashPage)
        : hashPage;
      const fileName = this._pageFileMap[resolvedHash] || this._pageFileMap[hashPage];
      return this._bootPages.includes(fileName) ? fileName : null;
    } catch (_) {
      return null;
    }
  },

  _startBootFetches() {
    if (this._bootFetchMap) return;

    this._bootFetchMap = {};
    for (const name of this._bootPages) {
      this._bootFetchMap[name] = fetch(`pages/${name}.html?v=${CACHE_VERSION}`)
        .then(r => { if (!r.ok) { console.warn(`[PageLoader] pages/${name}.html HTTP ${r.status}`); return ''; } return r.text(); })
        .catch(err => { console.warn(`[PageLoader] pages/${name}.html 載入失敗:`, err); return ''; });
    }

    this._bootModalFetch = Promise.all(
      this._modals.map(name =>
        fetch(`pages/${name}.html?v=${CACHE_VERSION}`)
          .then(r => { if (!r.ok) { console.warn(`[PageLoader] pages/${name}.html HTTP ${r.status}`); return ''; } return r.text(); })
          .catch(err => { console.warn(`[PageLoader] pages/${name}.html 載入失敗:`, err); return ''; })
      )
    );
  },

  _keepBootHashTargetActive() {
    if (typeof App !== 'undefined' && typeof App._activateBootHashShell === 'function') {
      try { App._activateBootHashShell(); } catch (_) {}
    }
  },

  async _ensureBootFile(fileName, reason = 'boot page') {
    if (!fileName || this._loaded[fileName]) {
      this._keepBootHashTargetActive();
      return;
    }

    this._startBootFetches();
    const html = await this._bootFetchMap[fileName];
    if (html && !this._loaded[fileName]) {
      this._appendToMainContent(html);
      this._loaded[fileName] = true;
      this._bindLoadedPageElements();
      console.log(`[PageLoader] ${reason}: ${fileName}`);
    }
    this._keepBootHashTargetActive();
  },

  /**
   * 啟動時載入核心頁面 + 彈窗（快速啟動）
   * 若偵測到 deep link，優先載入對應頁面並立即觸發渲染，不等其餘頁面。
   */
  async loadAll() {
    if (this._loadAllPromise) return this._loadAllPromise;

    this._loadAllPromise = (async () => {
      const mainEl = document.getElementById('main-content');
      const modalEl = document.getElementById('modal-container');

      // ── Deep link 優先載入偵測 ──
      const priorityFile = this._getBootPriorityFile();
      this._startBootFetches();

      // 所有 fetch 同時啟動（不論有無 priority，都並行）
      const fetchMap = this._bootFetchMap;
      const modalFetch = this._bootModalFetch;

      // Priority page：先 await → 立即 append → 觸發 instant deep link
      if (priorityFile && fetchMap[priorityFile]) {
        const html = await fetchMap[priorityFile];
        if (html && !this._loaded[priorityFile]) {
          this._appendToMainContent(html);
          this._loaded[priorityFile] = true;
          this._bindLoadedPageElements();
          console.log(`[PageLoader] deep-link 優先載入: ${priorityFile}`);
          // 觸發 instant deep link 渲染（fire-and-forget，不阻塞後續載入）
          if (typeof App !== 'undefined' && App._deepLinkRestFetch && !App._deepLinkRendered) {
            void App._tryInstantEventDeepLink().catch(() => {});
          }
        }
      }
      this._keepBootHashTargetActive();

      // 其餘 boot pages 逐一 append（fetch 早已並行啟動，這裡只是 await 結果）
      for (const name of this._bootPages) {
        if (this._loaded[name]) continue;
        const html = await fetchMap[name];
        if (html && !this._loaded[name]) {
          this._appendToMainContent(html);
          this._loaded[name] = true;
          this._keepBootHashTargetActive();
        }
      }

      // Modals
      const modalResults = await modalFetch;
      modalEl.innerHTML = modalResults.join('\n');

      this._bindLoadedPageElements();
      console.log(`[PageLoader] 啟動載入 ${this._bootPages.length} 頁 + ${this._modals.length} 彈窗，延遲 ${this._deferredPages.length} 頁`);

      // 背景預載入延遲頁面（不阻塞啟動）
      // 注意：iOS Safari 不支援 requestIdleCallback，必須用 window. 存取避免 ReferenceError
      (window.requestIdleCallback || function(cb) { setTimeout(cb, 2000); })(() => this._loadDeferred());
    })();

    return this._loadAllPromise;
  },

  /** 背景載入延遲頁面 */
  async _loadDeferred() {
    const toLoad = this._deferredPages.filter(name => !this._loaded[name]);
    if (toLoad.length === 0) return;

    await Promise.all(toLoad.map(name => this._loadSingleFile(name, '背景載入')));
    console.log(`[PageLoader] 背景載入完成: ${toLoad.join(', ')}`);
  },

  /** 確保指定頁面 ID 的 HTML 片段已載入 */
  async ensurePage(pageId) {
    const fileName = this._pageFileMap[pageId];
    if (!fileName || this._loaded[fileName]) return;

    if (this._bootPages.includes(fileName)) {
      await this._ensureBootFile(fileName, 'boot page requested');
      return;
    }

    const bootReady = this._bootPages.every(name => this._loaded[name]);
    if (!bootReady) {
      await this.loadAll();
      if (this._loaded[fileName]) return;
    }

    await this._loadSingleFile(fileName);
  },
};
