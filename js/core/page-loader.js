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
  ],

  /** 全域彈窗片段 */
  _modals: ['modals'],

  /** 已載入的頁面記錄 */
  _loaded: {},

  /** 頁面 ID → 片段檔名映射 */
  _pageFileMap: {
    'page-scan':               'scan',
    'page-tournaments':        'tournament',
    'page-admin-tournaments':  'tournament',
    'page-shop':               'shop',
    'page-admin-shop':         'shop',
    'page-admin-users':        'admin-users',
    'page-admin-exp':          'admin-users',
    'page-admin-roles':        'admin-system',
    'page-admin-logs':         'admin-system',
    'page-admin-inactive':     'admin-system',
    'page-admin-banners':      'admin-content',
    'page-admin-messages':     'admin-content',
    'page-admin-achievements': 'admin-content',
    'page-admin-announcements':'admin-content',
    'page-admin-themes':       'admin-system',
    'page-admin-dashboard':    'admin-dashboard',
    'page-admin-auto-exp':     'admin-auto-exp',
    'page-personal-dashboard': 'personal-dashboard',
    'page-admin-teams':        'admin-content',
    'page-qrcode':             'scan',
  },

  /**
   * 啟動時載入核心頁面 + 彈窗（快速啟動）
   */
  async loadAll() {
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
      ),
    ]);

    mainEl.innerHTML = pageResults.join('\n');
    modalEl.innerHTML = modalResults.join('\n');

    // 標記已載入
    this._bootPages.forEach(name => { this._loaded[name] = true; });

    console.log(`[PageLoader] 啟動載入 ${this._bootPages.length} 頁 + ${this._modals.length} 彈窗，延遲 ${this._deferredPages.length} 頁`);

    // 背景預載入延遲頁面（不阻塞啟動）
    requestIdleCallback ? requestIdleCallback(() => this._loadDeferred()) : setTimeout(() => this._loadDeferred(), 2000);
  },

  /** 背景載入延遲頁面 */
  async _loadDeferred() {
    const mainEl = document.getElementById('main-content');
    const toLoad = this._deferredPages.filter(name => !this._loaded[name]);
    if (toLoad.length === 0) return;

    const results = await Promise.all(
      toLoad.map(name =>
        fetch(`pages/${name}.html?v=${CACHE_VERSION}`).then(r => r.text()).catch(() => '')
      )
    );

    const fragment = document.createDocumentFragment();
    const temp = document.createElement('div');
    temp.innerHTML = results.join('\n');
    while (temp.firstChild) fragment.appendChild(temp.firstChild);
    mainEl.appendChild(fragment);

    toLoad.forEach(name => { this._loaded[name] = true; });
    console.log(`[PageLoader] 背景載入完成: ${toLoad.join(', ')}`);
  },

  /** 確保指定頁面 ID 的 HTML 片段已載入 */
  async ensurePage(pageId) {
    const fileName = this._pageFileMap[pageId];
    if (!fileName || this._loaded[fileName]) return;

    // 立即載入
    try {
      const html = await fetch(`pages/${fileName}.html?v=${CACHE_VERSION}`).then(r => r.text());
      const mainEl = document.getElementById('main-content');
      const temp = document.createElement('div');
      temp.innerHTML = html;
      while (temp.firstChild) mainEl.appendChild(temp.firstChild);
      this._loaded[fileName] = true;
      console.log(`[PageLoader] 按需載入: ${fileName}`);
    } catch (err) {
      console.warn(`[PageLoader] ${fileName} 載入失敗:`, err);
    }
  },
};
