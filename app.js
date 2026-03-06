/* ================================================
   SportHub — App Controller (Core)
   依賴：config.js, data.js, api-service.js
   擴充：js/core/*.js, js/modules/*.js (Object.assign)
   ================================================ */

const App = {
  currentRole: 'user',
  currentPage: 'page-home',
  currentTournament: 't1',
  _userTeam: 'tm1',
  pageHistory: [],
  bannerIndex: 0,
  bannerTimer: null,
  _bootDeepLink: null,
  _bootDeepLinkTimer: null,
  _bootDeepLinkPoller: null,
  _deepLinkBootTimeoutMs: 12000,
  _deepLinkAuthRedirecting: false,
  _pendingDeepLinkOpenKey: '',
  _pendingDeepLinkOpenPromise: null,
  _cloudReady: false,
  _cloudBootScheduled: false,
  _cloudReadyPromise: null,
  _cloudReadyError: null,

  init() {
    this.bindRoleSwitcher();
    this.bindSportPicker();
    this.bindNavigation();
    this.bindDrawer();
    this.bindTheme();
    this.bindFilterToggle();
    this.bindTabBars();
    this.bindTournamentTabs();
    this.bindScanModes();
    this.bindFloatingAds();
    this.bindNotifBtn();
    this.bindModeSwitch();
    this.bindLineLogin();
    this.bindImageUpload('ce-image', 'ce-upload-preview');
    this.bindImageUpload('ct-image', 'ct-upload-preview');
    this.bindImageUpload('ct-content-image', 'ct-content-upload-preview');
    this.bindImageUpload('et-image', 'et-upload-preview');
    this.bindImageUpload('et-content-image', 'et-content-upload-preview');
    this.bindImageUpload('cs-img1', 'cs-preview1');
    this.bindImageUpload('cs-img2', 'cs-preview2');
    this.bindImageUpload('cs-img3', 'cs-preview3');
    this.bindImageUpload('banner-image', 'banner-preview');
    this.bindImageUpload('floatad-image', 'floatad-preview');
    this.bindImageUpload('popupad-image', 'popupad-preview');
    this.bindImageUpload('ct-team-image', 'ct-team-preview');
    this.bindImageUpload('theme-image', 'theme-preview');
    this._bindAchBadgeUpload();
    this._populateAchConditionSelects();
    this.bindShopSearch();
    this.bindTeamOnlyToggle();
    this.renderBannerCarousel();
    this.startBannerCarousel();
    this.applySiteThemes();
    this.initLangSwitcher();
    this._applyI18nToUI();
    this.renderAll();
    this.applyRole('user', true);
  },

  /** 啟動時只渲染首頁必要元件，其餘由 showPage → _renderPageContent 按需渲染 */
  renderAll() {
    // ── 首頁必要 ──
    this.renderHotEvents();
    this.renderOngoingTournaments();
    this.renderBannerCarousel();
    this.renderFloatingAds();
    this.renderSponsors();
    this.renderAnnouncement();
    this.renderAchievements();
    // ── 全域 UI 狀態 ──
    this.updateNotifBadge();
    this.updatePointsDisplay();
    this.updateStorageBar();
  },

  /** Phase 1 完成後才執行：綁定 pages/*.html 內的動態元素事件 */
  _bindPageElements() {
    this.bindFilterToggle();
    this.bindTabBars();
    this.bindShopSearch();
    this.bindTeamOnlyToggle();
    this._bindAchBadgeUpload();
    this._populateAchConditionSelects();
    this.bindImageUpload('ce-image',         'ce-upload-preview');
    this.bindImageUpload('ct-image',         'ct-upload-preview');
    this.bindImageUpload('ct-content-image', 'ct-content-upload-preview');
    this.bindImageUpload('et-image',         'et-upload-preview');
    this.bindImageUpload('et-content-image', 'et-content-upload-preview');
    this.bindImageUpload('cs-img1',          'cs-preview1');
    this.bindImageUpload('cs-img2',          'cs-preview2');
    this.bindImageUpload('cs-img3',          'cs-preview3');
    this.bindImageUpload('banner-image',     'banner-preview');
    this.bindImageUpload('floatad-image',    'floatad-preview');
    this.bindImageUpload('popupad-image',    'popupad-preview');
    this.bindImageUpload('ct-team-image',    'ct-team-preview');
    this.bindImageUpload('theme-image',      'theme-preview');
  },

  /** 將 Date 格式化為 YYYY/MM/DD HH:MM 字串（省略時間時傳 false） */
  _formatDateTime(d, includeTime = true) {
    d = d || new Date();
    const base = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
    return includeTime
      ? `${base} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
      : base;
  },

  showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
  },

  /** 自訂確認 Modal（取代原生 confirm，不會被瀏覽器封鎖） */
  appConfirm(msg) {
    return new Promise(resolve => {
      const modal = document.getElementById('app-confirm-modal');
      document.getElementById('app-confirm-msg').textContent = msg;
      modal.classList.add('open');
      const ok = document.getElementById('app-confirm-ok');
      const cancel = document.getElementById('app-confirm-cancel');
      const cleanup = (result) => {
        modal.classList.remove('open');
        ok.replaceWith(ok.cloneNode(true));
        cancel.replaceWith(cancel.cloneNode(true));
        resolve(result);
      };
      ok.addEventListener('click', () => cleanup(true), { once: true });
      cancel.addEventListener('click', () => cleanup(false), { once: true });
    });
  },

  _getPendingDeepLink() {
    try {
      const pendingEvent = String(sessionStorage.getItem('_pendingDeepEvent') || '').trim();
      if (pendingEvent) return { type: 'event', id: pendingEvent };
      const pendingTeam = String(sessionStorage.getItem('_pendingDeepTeam') || '').trim();
      if (pendingTeam) return { type: 'team', id: pendingTeam };
    } catch (_) {}
    return null;
  },

  _clearPendingDeepLink() {
    try {
      sessionStorage.removeItem('_pendingDeepEvent');
      sessionStorage.removeItem('_pendingDeepTeam');
    } catch (_) {}
  },

  _clearDeepLinkQueryParams() {
    try {
      const url = new URL(window.location.href);
      let changed = false;
      ['event', 'team'].forEach((key) => {
        if (!url.searchParams.has(key)) return;
        url.searchParams.delete(key);
        changed = true;
      });
      if (changed) {
        history.replaceState(null, '', url.pathname + (url.search || '') + (url.hash || ''));
      }
    } catch (_) {}
  },

  _showDeepLinkOverlay(type) {
    const overlay = document.getElementById('deep-link-overlay');
    if (!overlay) return;
    const title = overlay.querySelector('[data-deep-link-title]');
    const sub = overlay.querySelector('[data-deep-link-sub]');
    if (title) title.textContent = type === 'team' ? '正在前往球隊頁面' : '正在前往活動頁面';
    if (sub) sub.textContent = '正在確認登入與資料，請稍候...';
    overlay.classList.remove('is-hiding');
    overlay.style.display = 'flex';
  },

  _hideDeepLinkOverlay() {
    const overlay = document.getElementById('deep-link-overlay');
    if (!overlay || overlay.style.display === 'none') return;
    overlay.classList.add('is-hiding');
    setTimeout(() => {
      overlay.style.display = 'none';
      overlay.classList.remove('is-hiding');
    }, 220);
  },

  _stopDeepLinkGuard() {
    if (this._bootDeepLinkTimer) {
      clearTimeout(this._bootDeepLinkTimer);
      this._bootDeepLinkTimer = null;
    }
    if (this._bootDeepLinkPoller) {
      clearInterval(this._bootDeepLinkPoller);
      this._bootDeepLinkPoller = null;
    }
  },

  _completeDeepLinkSuccess() {
    this._stopDeepLinkGuard();
    this._clearPendingDeepLink();
    this._clearDeepLinkQueryParams();
    this._hideDeepLinkOverlay();
    this._bootDeepLink = null;
    this._deepLinkAuthRedirecting = false;
    this._pendingDeepLinkOpenKey = '';
    this._pendingDeepLinkOpenPromise = null;
  },

  _completeDeepLinkFallback(message, targetPage = 'page-activities') {
    this._stopDeepLinkGuard();
    this._clearPendingDeepLink();
    this._clearDeepLinkQueryParams();
    this._hideDeepLinkOverlay();
    this._bootDeepLink = null;
    this._deepLinkAuthRedirecting = false;
    this._pendingDeepLinkOpenKey = '';
    this._pendingDeepLinkOpenPromise = null;
    const canOpenProtected = ModeManager.isDemo() || (typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn());
    const fallbackPage = (!canOpenProtected && targetPage !== 'page-home') ? 'page-home' : targetPage;
    if (fallbackPage && this.currentPage !== fallbackPage) this.showPage(fallbackPage);
    if (message) this.showToast(message);
  },

  _tryStartDeepLinkLogin() {
    if (ModeManager.isDemo()) return false;
    if (this._deepLinkAuthRedirecting) return true;
    if (typeof LineAuth === 'undefined') return false;
    if (typeof LineAuth.isLoggedIn === 'function' && LineAuth.isLoggedIn()) return false;

    // LIFF session exists but profile is still loading.
    if (typeof LineAuth.isPendingLogin === 'function' && LineAuth.isPendingLogin()) {
      this._deepLinkAuthRedirecting = true;
      return true;
    }

    // Wait until SDK is ready (Phase 4) before triggering login.
    if (typeof liff === 'undefined' || !LineAuth._ready) {
      if (typeof this.ensureCloudReady === 'function') {
        void this.ensureCloudReady({ reason: 'deep-link-login' }).catch(() => {});
      }
      return false;
    }

    try {
      this._deepLinkAuthRedirecting = true;
      console.log('[DeepLink] unauthenticated, redirecting to LINE login');
      LineAuth.login();
      return true;
    } catch (err) {
      this._deepLinkAuthRedirecting = false;
      console.warn('[DeepLink] login redirect failed:', err);
      return false;
    }
  },

  _startDeepLinkGuard() {
    const pending = this._getPendingDeepLink();
    if (!pending) return;
    this._bootDeepLink = pending;
    this._deepLinkAuthRedirecting = false;
    this._showDeepLinkOverlay(pending.type);
    this._stopDeepLinkGuard();

    this._bootDeepLinkTimer = setTimeout(() => {
      if (!this._getPendingDeepLink()) return;
      const isAuthedNow = ModeManager.isDemo() || (typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn());
      if (!isAuthedNow) {
        // For unauthenticated deep links, prioritize LINE login redirect.
        this._tryStartDeepLinkLogin();
        this._bootDeepLinkTimer = setTimeout(() => {
          if (!this._getPendingDeepLink()) return;
          const isAuthedRetry = ModeManager.isDemo() || (typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn());
          if (!isAuthedRetry) {
            this._completeDeepLinkFallback('\u8acb\u5148\u5b8c\u6210 LINE \u767b\u5165\u5f8c\u518d\u958b\u555f\u9023\u7d50\u3002', 'page-home');
            return;
          }
          const retryTarget = pending.type === 'team' ? 'page-teams' : 'page-activities';
          this._completeDeepLinkFallback('\u9801\u9762\u8f09\u5165\u5df2\u903e\u6642\uff0c\u5df2\u5207\u63db\u5230\u5217\u8868\u3002', retryTarget);
        }, this._deepLinkBootTimeoutMs);
        return;
      }
      const targetPage = pending.type === 'team' ? 'page-teams' : 'page-activities';
      this._completeDeepLinkFallback('\u9801\u9762\u8f09\u5165\u5df2\u903e\u6642\uff0c\u5df2\u5207\u63db\u5230\u5217\u8868\u3002', targetPage);
    }, this._deepLinkBootTimeoutMs);

    this._bootDeepLinkPoller = setInterval(() => {
      void this._tryOpenPendingDeepLink();
    }, 280);
  },

  async _tryOpenPendingDeepLink() {
    try {
      const pending = this._getPendingDeepLink();
      if (!pending) return true;

      const key = `${pending.type}:${pending.id}`;
      if (this._pendingDeepLinkOpenPromise && this._pendingDeepLinkOpenKey === key) {
        return await this._pendingDeepLinkOpenPromise;
      }

      const isAuthed = ModeManager.isDemo() || (typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn());
      if (!isAuthed) {
        this._tryStartDeepLinkLogin();
        return false;
      }

      const openPromise = (async () => {
        if (pending.type === 'event') {
          const event = ApiService.getEvent?.(pending.id);
          if (!event) return false;

          const result = await this.showEventDetail(pending.id);
          if (result?.ok && this.currentPage === 'page-activity-detail' && this._currentDetailEventId === pending.id) {
            this._completeDeepLinkSuccess();
            return true;
          }
          if (result?.reason === 'forbidden') {
            this._completeDeepLinkFallback('\u7121\u6cd5\u958b\u555f\u6d3b\u52d5\u8a73\u60c5\uff0c\u5df2\u5207\u56de\u5217\u8868\u3002', 'page-activities');
            return true;
          }
          return false;
        }

        if (pending.type === 'team') {
          const team = ApiService.getTeam?.(pending.id);
          if (!team) return false;

          const result = await this.showTeamDetail(pending.id);
          if (result?.ok && this.currentPage === 'page-team-detail' && this._teamDetailId === pending.id) {
            this._completeDeepLinkSuccess();
            return true;
          }
          return false;
        }

        return false;
      })();

      this._pendingDeepLinkOpenKey = key;
      this._pendingDeepLinkOpenPromise = openPromise.finally(() => {
        if (this._pendingDeepLinkOpenKey === key) {
          this._pendingDeepLinkOpenKey = '';
          this._pendingDeepLinkOpenPromise = null;
        }
      });

      return await this._pendingDeepLinkOpenPromise;
    } catch (err) {
      console.warn('[DeepLink] pending open failed:', err);
      return false;
    }
  },

  _scheduleCloudBoot(reason = 'post-boot') {
    if (ModeManager.isDemo()) return;
    if (this._cloudReady || this._cloudReadyPromise || this._cloudBootScheduled) return;

    this._cloudBootScheduled = true;
    const kickoff = () => {
      this._cloudBootScheduled = false;
      void this.ensureCloudReady({ reason }).catch(() => {});
    };

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(kickoff, 0));
      return;
    }
    setTimeout(kickoff, 0);
  },

  async ensureCloudReady(options = {}) {
    const { reason = 'unknown' } = options;
    if (ModeManager.isDemo()) return false;
    if (this._cloudReady) return true;
    if (this._cloudReadyPromise) return await this._cloudReadyPromise;

    console.log(`[Cloud] ensureCloudReady start: ${reason}`);
    this._cloudReadyError = null;

    const bootPromise = (async () => {
      await _loadCDNScripts();
      if (!initFirebaseApp()) {
        throw new Error('FIREBASE_APP_INIT_FAILED');
      }

      if (typeof liff !== 'undefined') {
        LineAuth._ready = false;
        LineAuth._initError = null;
      }

      if (typeof liff !== 'undefined') {
        await LineAuth.initSDK();
        console.log('[Cloud] LIFF SDK ready');
      }

      if (LineAuth.hasLiffSession()) {
        LineAuth.restoreCachedProfile();
        if (LineAuth._profile) {
          try { this.renderLoginUI(); } catch (_) {}
        }
      }

      const profilePromise = LineAuth.hasLiffSession()
        ? LineAuth.ensureProfile({ force: true }).catch(err => {
            console.warn('[Cloud] ensureProfile failed:', err);
          })
        : Promise.resolve();

      await Promise.all([profilePromise, FirebaseService.init()]);

      this._firebaseConnected = true;
      this._cloudReady = true;
      this._cloudReadyError = null;
      ApiService._errorLogReady = true;
      console.log('[Cloud] Firebase + LIFF ready');

      try { this.renderAll(); } catch (_) {}
      try {
        if (typeof this.bindLineLogin === 'function') {
          await this.bindLineLogin();
        }
      } catch (err) {
        console.error('[Cloud] bindLineLogin failed:', err?.message || err, err?.stack || '');
        try { this.showToast('LINE login init failed.'); } catch (_) {}
      }
      void this._tryOpenPendingDeepLink();
      return true;
    })();

    this._cloudReadyPromise = bootPromise;

    try {
      return await bootPromise;
    } catch (err) {
      this._cloudReadyError = err;
      console.error(`[Cloud] ensureCloudReady failed (${reason}):`, err?.message || err);
      try { this.showToast('Cloud init failed. Please retry.'); } catch (_) {}
      try {
        if (typeof this.bindLineLogin === 'function') {
          await this.bindLineLogin();
        }
      } catch (_) {}
      void this._tryOpenPendingDeepLink();
      throw err;
    } finally {
      if (!this._cloudReady) {
        this._cloudReadyPromise = null;
      }
    }
  },
};

// ── CDN SDK 動態載入器（不阻塞 DOMContentLoaded）──
const _dynamicScriptPromises = {};
let _cdnScriptsPromise = null;

function _loadScript(src) {
  if (_dynamicScriptPromises[src]) return _dynamicScriptPromises[src];

  const existing = document.querySelector(`script[src="${src}"]`);
  if (existing) {
    if (existing.dataset.loaded === 'true') {
      return Promise.resolve();
    }
    _dynamicScriptPromises[src] = new Promise((resolve, reject) => {
      existing.addEventListener('load', () => {
        existing.dataset.loaded = 'true';
        resolve();
      }, { once: true });
      existing.addEventListener('error', () => reject(new Error('Script load failed: ' + src)), { once: true });
    });
    return _dynamicScriptPromises[src];
  }

  _dynamicScriptPromises[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => {
      s.dataset.loaded = 'true';
      resolve();
    };
    s.onerror = () => reject(new Error('Script load failed: ' + src));
    document.head.appendChild(s);
  });
  return _dynamicScriptPromises[src];
}

async function _loadCDNScripts() {
  if (_cdnScriptsPromise) return await _cdnScriptsPromise;

  _cdnScriptsPromise = (async () => {
    await _loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
    await Promise.all([
      _loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js'),
      _loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-storage-compat.js'),
      _loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js'),
      _loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-functions-compat.js'),
      _loadScript('https://static.line-scdn.net/liff/edge/2/sdk.js'),
    ]);
    console.log('[CDN] Firebase + LIFF SDK loaded');
    return true;
  })();

  try {
    return await _cdnScriptsPromise;
  } catch (err) {
    _cdnScriptsPromise = null;
    throw err;
  }
}

// Init on DOM Ready ──
document.addEventListener('DOMContentLoaded', async () => {
  window._appInitializing = true;
  console.log('[Boot] DOMContentLoaded fired');

  // 先解析 deep link，避免先看到首頁再跳轉
  try {
    const urlParams = new URLSearchParams(location.search);
    const deepEvent = String(urlParams.get('event') || '').trim();
    const deepTeam = String(urlParams.get('team') || '').trim();
    if (deepEvent) sessionStorage.setItem('_pendingDeepEvent', deepEvent);
    if (deepTeam) sessionStorage.setItem('_pendingDeepTeam', deepTeam);
  } catch (_) {}
  App._startDeepLinkGuard();

  // ── Phase 1: 載入頁面 HTML 片段（10 秒超時保護）──
  console.log('[Boot] Phase 1: PageLoader.loadAll() 開始（背景執行）');
  const htmlReady = Promise.race([
    PageLoader.loadAll().catch(function(e) {
      console.warn('[Boot] PageLoader.loadAll() 失敗:', e && e.message || e);
    }),
    new Promise(resolve => setTimeout(resolve, 10000)),
  ]).then(() => {
    console.log('[Boot] Phase 1: 完成');
  }).catch((e) => {
    console.error('[Boot] Phase 1 異常:', e && e.message || e);
  });

  // ── Phase 2: 正式版先從 localStorage 恢復快取資料 ──
  try {
    if (!ModeManager.isDemo()) {
      console.log('[Boot] Phase 2: 恢復快取');
      FirebaseService._restoreCache();
      console.log('[Boot] Phase 2: 完成');
    }
  } catch (e) {
    console.warn('[Boot] Phase 2 快取恢復失敗:', e && e.message || e);
  }

  // ── Phase 3: 立即顯示頁面（不等 HTML / CDN / Firebase）──
  try {
    console.log('[Boot] Phase 3: App.init() 開始');
    App.init();
    console.log('[Boot] Phase 3: App.init() 完成');
  } catch (initErr) {
    console.error('[Boot] Phase 3 App.init() 失敗:', initErr && initErr.message || initErr, initErr && initErr.stack || '');
    try {
      var rb = document.getElementById('_recovery_btn');
      if (!rb) {
        rb = document.createElement('button');
        rb.id = '_recovery_btn';
        rb.textContent = '載入失敗，點此重新整理';
        rb.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99999;padding:1rem 2rem;font-size:1rem;background:#dc2626;color:#fff;border:none;border-radius:8px;cursor:pointer';
        rb.onclick = function() { location.reload(); };
        document.body.appendChild(rb);
      }
    } catch (e2) {}
  }

  // Phase 3 完成：移除 prod-early class + 隱藏載入畫面（框架已就緒，Phase 4 背景執行）
  try {
    document.documentElement.classList.remove('prod-early');
    // 進度條跳到 100% 後淡出
    var _ov = document.getElementById('loading-overlay');
    if (_ov && _ov.style.display !== 'none') {
      // 讓進度條繼續跑滿 1 秒再跳 100%
      setTimeout(function() {
        if (window._bootLoadingAnim) window._bootLoadingAnim.stop();
        var _pct = _ov.querySelector('.boot-loading__pct');
        var _fill = _ov.querySelector('.boot-loading__fill');
        var _bar = _ov.querySelector('.boot-loading__bar');
        if (_pct) _pct.textContent = '100%';
        if (_fill) _fill.style.width = '100%';
        if (_bar) _bar.setAttribute('aria-valuenow', '100');
        setTimeout(function() {
          _ov.style.display = 'none';
          console.log('[Boot] 載入畫面已隱藏（Phase 3 框架就緒）');
        }, 400);
      }, 1000);
    }
    if (window._loadingSafety) clearTimeout(window._loadingSafety);
    console.log('[Boot] Phase 3 完成');
  } catch (e) {
    console.warn('[Boot] Phase 3 完成處理失敗:', e && e.message || e);
  }

  // ── Phase 1 完成後補跑一次 renderAll + 動態頁面事件綁定（非阻塞）──
  htmlReady.then(function() {
    try {
      App.renderAll();
      console.log('[Boot] Phase 1 後補跑 renderAll 完成');
    } catch (e) {
      console.warn('[Boot] Phase 1 完成後 renderAll 失敗:', e && e.message || e);
    }
    try {
      App._bindPageElements();
      console.log('[Boot] Phase 1 後補跑 _bindPageElements 完成');
    } catch (e) {
      console.warn('[Boot] _bindPageElements 失敗:', e && e.message || e);
    }
  });

  // Phase 4: deep link boots cloud immediately; normal home boot defers until first paint.
  if (!ModeManager.isDemo()) {
    const pendingDeepLink = App._getPendingDeepLink();
    if (pendingDeepLink) {
      console.log('[Boot] Phase 4: immediate cloud init for deep link');
      void App.ensureCloudReady({ reason: 'boot-deep-link' }).catch(() => {});
    } else {
      console.log('[Boot] Phase 4: schedule deferred cloud init');
      App._scheduleCloudBoot('boot-idle');
    }
  }

  // Global unhandled rejection → errorLog（過濾第三方 SDK 雜訊）
  window.addEventListener('unhandledrejection', (event) => {
    if (!ApiService._errorLogReady) return;
    const msg = (event.reason?.message || '').toLowerCase();
    if (msg.includes('liff') || msg.includes('firebase') || msg.includes('firestore') || msg.includes('chunkloaderror')) return;
    ApiService._writeErrorLog('unhandledrejection', event.reason);
  });

  // 嘗試立即開啟 deep link（其餘會由 guard 持續輪詢）
  void App._tryOpenPendingDeepLink();

  // 定時任務（全部 try-catch 保護）
  // Hash 路由：瀏覽器返回/前進鍵同步頁面
  // pageId !== App.currentPage 條件防止 showPage() 設 hash 後再次觸發無窮迴圈
  try {
    window.addEventListener('hashchange', () => {
      const pageId = location.hash.replace(/^#/, '');
      if (pageId && pageId !== App.currentPage && document.getElementById(pageId)) {
        App.showPage(pageId);
      }
    });
  } catch (e) {}
  try { App._autoExpireAds(); } catch (e) {}
  setInterval(() => { try { App._autoExpireAds(); } catch (e) {} }, 60000);
  try { Promise.resolve(App._processScheduledMessages()).catch(() => {}); } catch (e) {}
  setInterval(() => { try { Promise.resolve(App._processScheduledMessages()).catch(() => {}); } catch (e) {} }, 60000);
  try { App._processEventReminders(); } catch (e) {}
  setInterval(() => { try { App._processEventReminders(); } catch (e) {} }, 300000);
  setTimeout(() => { try { App.showPopupAdsOnLoad(); } catch (e) {} }, 2000);

  window._appInitializing = false;
  console.log('[Boot] 初始化流程結束');
});
