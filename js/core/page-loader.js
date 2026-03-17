/* ================================================
   SportHub — Page Loader（HTML 頁面片段載入器）
   ================================================
   將 index.html 拆分為獨立的 HTML 片段檔案，
   啟動時只載入首頁 + 必要片段，其餘按需載入。
   ================================================ */

const PageLoader = {

  /** 啟動時必須載入的頁面（首頁 + 核心頁面） */
  _bootPages: ['home', 'activity', 'team', 'message', 'profile'],

  /** 延遲載入的頁面 */
  _deferredPages: [
    'scan', 'tournament', 'shop',
    'admin-users', 'admin-content', 'admin-system',
    'admin-dashboard', 'admin-auto-exp', 'personal-dashboard',
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
    'page-temp-participant-report': 'admin-dashboard',
    'page-admin-auto-exp':     'admin-auto-exp',
    'page-personal-dashboard': 'personal-dashboard',
    'page-admin-teams':        'admin-content',
    'page-game':               'game',
    'page-kick-game':          'kickball',
    'page-edu-groups':         'education',
    'page-edu-students':       'education',
    'page-edu-course-plan':    'education',
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
      const html = await fetch(`pages/${fileName}.html?v=${CACHE_VERSION}`).then(r => r.text());
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
      let priorityFile = null;
      try {
        if (sessionStorage.getItem('_pendingDeepEvent')) priorityFile = 'activity';
        else if (sessionStorage.getItem('_pendingDeepTeam')) priorityFile = 'team';
      } catch (_) {}

      // 所有 fetch 同時啟動（不論有無 priority，都並行）
      const fetchMap = {};
      for (const name of this._bootPages) {
        fetchMap[name] = fetch(`pages/${name}.html?v=${CACHE_VERSION}`)
          .then(r => r.text())
          .catch(err => { console.warn(`[PageLoader] pages/${name}.html 載入失敗:`, err); return ''; });
      }
      const modalFetch = Promise.all(
        this._modals.map(name =>
          fetch(`pages/${name}.html?v=${CACHE_VERSION}`).then(r => r.text())
            .catch(err => { console.warn(`[PageLoader] pages/${name}.html 載入失敗:`, err); return ''; })
        )
      );

      // Priority page：先 await → 立即 append → 觸發 instant deep link
      if (priorityFile && fetchMap[priorityFile]) {
        const html = await fetchMap[priorityFile];
        if (html) {
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

      // 其餘 boot pages 逐一 append（fetch 早已並行啟動，這裡只是 await 結果）
      for (const name of this._bootPages) {
        if (this._loaded[name]) continue;
        const html = await fetchMap[name];
        if (html) {
          this._appendToMainContent(html);
          this._loaded[name] = true;
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

    const bootReady = this._bootPages.every(name => this._loaded[name]);
    if (!bootReady) {
      await this.loadAll();
      if (this._loaded[fileName]) return;
    }

    if (this._bootPages.includes(fileName)) {
      return;
    }

    await this._loadSingleFile(fileName);
  },
};
