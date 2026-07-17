/* ================================================
   SportHub — Page Loader（HTML 頁面片段載入器）
   ================================================
   將 index.html 拆分為獨立的 HTML 片段檔案，
   啟動時只載入首頁 + 必要片段，其餘按需載入。
   ================================================ */

const PageLoader = {

  _getAssetVersion() {
    if (typeof window !== 'undefined' && typeof window.getSportHubAssetVersion === 'function') {
      const runtimeVersion = String(window.getSportHubAssetVersion() || '').trim();
      if (runtimeVersion) return runtimeVersion;
    }
    const indexVersion = (typeof window !== 'undefined' && window.__SPORTHUB_INDEX_VERSION__)
      ? String(window.__SPORTHUB_INDEX_VERSION__).trim()
      : '';
    if (indexVersion) return indexVersion;
    return typeof CACHE_VERSION !== 'undefined' ? String(CACHE_VERSION) : '';
  },

  /** 啟動時必須載入的頁面（首頁 + 核心頁面） */
  _bootPages: ['home'],

  /** 延遲載入的頁面 */
  _deferredPages: [
    'activity', 'team', 'message', 'profile', 'tournament',
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

  _pageFragmentTimeoutMs: 12000,
  _bootPageFragmentTimeoutMs: 15000,

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
    'page-edu-course-lessons':  'education',
    'page-edu-course-enrollment': 'education',
    'page-edu-checkin':        'education',
    'page-edu-calendar':       'education',
    'page-edu-student-apply':  'education',
  },

  _appendToMainContent(html) {
    const mainEl = document.getElementById('main-content');
    const temp = document.createElement('div');
    temp.innerHTML = html;
    const hasActivePage = !!mainEl.querySelector('.page.active');
    if (hasActivePage) {
      temp.querySelectorAll('.page.active').forEach(page => page.classList.remove('active'));
    }
    while (temp.firstChild) mainEl.appendChild(temp.firstChild);
  },

  _bindLoadedPageElements() {
    if (typeof App !== 'undefined' && App._bindPageElements) {
      try { App._bindPageElements(); } catch (e) {
        console.warn('[PageLoader] _bindPageElements:', e);
      }
    }
  },

  async _fetchPageFragment(fileName, options = {}) {
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || this._pageFragmentTimeoutMs);
    let timer = null;
    let controller = null;
    try {
      const requestOptions = {};
      if (typeof AbortController !== 'undefined') {
        controller = new AbortController();
        requestOptions.signal = controller.signal;
      }
      const requestUrl = `pages/${fileName}.html?v=${this._getAssetVersion()}`;
      const request = fetch(requestUrl, requestOptions)
        .then(async (r) => {
          if (!r.ok) {
            const versionMiss = r.status === 409
              || (r.headers && typeof r.headers.get === 'function'
                && r.headers.get('X-SportHub-Version-Miss') === '1');
            if (versionMiss
              && typeof window !== 'undefined'
              && typeof window.recoverSportHubScriptFailure === 'function') {
              window.recoverSportHubScriptFailure(requestUrl, {
                resourceType: 'page-fragment',
                versionMiss: true,
              });
            }
            console.warn(`[PageLoader] ${fileName} HTTP ${r.status}`);
            return '';
          }
          return await r.text();
        });
      request.catch(() => {});
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
          try { controller?.abort?.(); } catch (_) {}
          const err = new Error(`Page fragment timeout after ${timeoutMs}ms`);
          err.name = 'TimeoutError';
          reject(err);
        }, timeoutMs);
      });
      return await Promise.race([request, timeout]);
    } catch (err) {
      console.warn(`[PageLoader] ${fileName} 載入失敗:`, err);
      return '';
    } finally {
      if (timer) clearTimeout(timer);
    }
  },

  async _loadSingleFile(fileName, reason = '按需載入') {
    if (!fileName || this._loaded[fileName]) return;
    if (this._loading[fileName]) return this._loading[fileName];

    this._loading[fileName] = (async () => {
      const html = await this._fetchPageFragment(fileName, {
        reason,
        timeoutMs: this._pageFragmentTimeoutMs,
      });
      if (!html) return;
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
      const historyPage = String((typeof App !== 'undefined' && App._bootHistoryTargetPageId) || window._bootHistoryTargetPageId || '').trim();
      if (historyPage && /^page-[\w-]+$/.test(historyPage)) {
        const historyFile = this._pageFileMap[historyPage];
        if (historyFile) return historyFile;
      }

      const hashPage = (location.hash || '').replace(/^#/, '').trim();
      if (!hashPage || hashPage === 'page-home' || !/^page-[\w-]+$/.test(hashPage)) return null;
      const resolvedHash = (typeof App !== 'undefined' && typeof App._resolveBootPageId === 'function')
        ? App._resolveBootPageId(hashPage)
        : hashPage;
      const fileName = this._pageFileMap[resolvedHash] || this._pageFileMap[hashPage];
      return fileName || null;
    } catch (_) {
      return null;
    }
  },

  _queueBootFetch(name) {
    this._bootFetchMap[name] = this._fetchPageFragment(name, {
      reason: 'boot page',
      timeoutMs: this._bootPageFragmentTimeoutMs,
    }).then((html) => {
      if (!html) delete this._bootFetchMap[name];
      return html;
    });
    return this._bootFetchMap[name];
  },

  _startBootFetches(priorityFile = null) {
    if (!this._bootFetchMap) this._bootFetchMap = {};

    const files = new Set(this._bootPages);
    if (priorityFile) files.add(priorityFile);
    for (const name of files) {
      if (!this._bootFetchMap[name]) this._queueBootFetch(name);
    }

    if (!this._bootModalFetch) {
      this._bootModalFetch = Promise.all(
        this._modals.map(name =>
          this._fetchPageFragment(name, {
            reason: 'boot modal',
            timeoutMs: this._bootPageFragmentTimeoutMs,
          })
        )
      );
    }
  },

  _keepBootHashTargetActive() {
    if (typeof App !== 'undefined' && typeof App._activateBootHashShell === 'function') {
      try { App._activateBootHashShell(); } catch (_) {}
    }
    if (typeof App !== 'undefined' && typeof App._activateBootHistoryShell === 'function') {
      try { App._activateBootHistoryShell(); } catch (_) {}
    }
  },

  async _ensureBootFile(fileName, reason = 'boot page') {
    if (!fileName || this._loaded[fileName]) {
      this._keepBootHashTargetActive();
      return;
    }

    this._startBootFetches(fileName);
    const html = await (this._bootFetchMap[fileName] || this._queueBootFetch(fileName));
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
      this._startBootFetches(priorityFile);

      // 所有 fetch 同時啟動（不論有無 priority，都並行）
      const fetchMap = this._bootFetchMap;
      const modalFetch = this._bootModalFetch;

      // Priority page：先 await → 立即 append → 觸發 instant deep link
      if (priorityFile) {
        const html = await (fetchMap[priorityFile] || this._queueBootFetch(priorityFile));
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
        const html = await (fetchMap[name] || this._queueBootFetch(name));
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

    if (this._bootFetchMap?.[fileName] || this._bootPages.includes(fileName)) {
      await this._ensureBootFile(fileName, 'route requested');
      return;
    }

    await this._loadSingleFile(fileName);
  },
};
