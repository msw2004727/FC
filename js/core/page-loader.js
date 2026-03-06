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
    'page-admin-tournaments':  'tournament',
    'page-shop':               'shop',
    'page-leaderboard':        'shop',
    'page-admin-shop':         'shop',
    'page-admin-users':        'admin-users',
    'page-admin-exp':          'admin-users',
    'page-admin-roles':        'admin-system',
    'page-admin-logs':         'admin-system',
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
    'page-admin-auto-exp':     'admin-auto-exp',
    'page-personal-dashboard': 'personal-dashboard',
    'page-admin-teams':        'admin-content',
    'page-game':               'game',
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
   */
  async loadAll() {
    if (this._loadAllPromise) return this._loadAllPromise;

    this._loadAllPromise = (async () => {
      const mainEl = document.getElementById('main-content');
      const modalEl = document.getElementById('modal-container');

      const [pageResults, modalResults] = await Promise.all([
        Promise.all(
          this._bootPages.map(name =>
            fetch(`pages/${name}.html?v=${CACHE_VERSION}`).then(r => r.text()).catch(err => {
              console.warn(`[PageLoader] pages/${name}.html 載入失敗:`, err);
              return '';
            })
          )
        ),
        Promise.all(
          this._modals.map(name =>
            fetch(`pages/${name}.html?v=${CACHE_VERSION}`).then(r => r.text()).catch(err => {
              console.warn(`[PageLoader] pages/${name}.html 載入失敗:`, err);
              return '';
            })
          )
        )
      ]);

      mainEl.innerHTML = pageResults.join('\n');
      modalEl.innerHTML = modalResults.join('\n');

      // 標記已載入
      this._bootPages.forEach(name => { this._loaded[name] = true; });

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
