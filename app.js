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
  },

  _completeDeepLinkFallback(message, targetPage = 'page-activities') {
    this._stopDeepLinkGuard();
    this._clearPendingDeepLink();
    this._clearDeepLinkQueryParams();
    this._hideDeepLinkOverlay();
    this._bootDeepLink = null;
    const canOpenProtected = ModeManager.isDemo() || (typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn());
    const fallbackPage = (!canOpenProtected && targetPage !== 'page-home') ? 'page-home' : targetPage;
    if (fallbackPage && this.currentPage !== fallbackPage) this.showPage(fallbackPage);
    if (message) this.showToast(message);
  },

  _startDeepLinkGuard() {
    const pending = this._getPendingDeepLink();
    if (!pending) return;
    this._bootDeepLink = pending;
    this._showDeepLinkOverlay(pending.type);
    this._stopDeepLinkGuard();

    this._bootDeepLinkTimer = setTimeout(() => {
      if (!this._getPendingDeepLink()) return;
      const targetPage = pending.type === 'team' ? 'page-teams' : 'page-activities';
      this._completeDeepLinkFallback('頁面載入逾時，已切換到列表。', targetPage);
    }, this._deepLinkBootTimeoutMs);

    this._bootDeepLinkPoller = setInterval(() => {
      try {
        this._tryOpenPendingDeepLink();
      } catch (_) {}
    }, 280);
  },

  _tryOpenPendingDeepLink() {
    const pending = this._getPendingDeepLink();
    if (!pending) return true;

    const isAuthed = ModeManager.isDemo() || (typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn());
    if (!isAuthed) return false;

    if (pending.type === 'event') {
      const event = ApiService.getEvent?.(pending.id);
      if (!event) return false;
      this.showEventDetail(pending.id);
      if (this.currentPage === 'page-activity-detail' && this._currentDetailEventId === pending.id) {
        this._completeDeepLinkSuccess();
        return true;
      }
      return false;
    }

    if (pending.type === 'team') {
      const team = ApiService.getTeam?.(pending.id);
      if (!team) return false;
      this.showTeamDetail(pending.id);
      if (this.currentPage === 'page-team-detail') {
        this._completeDeepLinkSuccess();
        return true;
      }
      return false;
    }

    return false;
  },
};

// ── CDN SDK 動態載入器（不阻塞 DOMContentLoaded）──
function _loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Script load failed: ' + src));
    document.head.appendChild(s);
  });
}

async function _loadCDNScripts() {
  // firebase-app 必須先載入（提供 firebase 全域物件）
  await _loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
  // 其餘 Firebase 模組 + LIFF SDK 可平行載入
  await Promise.all([
    _loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js'),
    _loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-storage-compat.js'),
    _loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js'),
    _loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-functions-compat.js'),
    _loadScript('https://static.line-scdn.net/liff/edge/2/sdk.js'),
  ]);
  console.log('[CDN] Firebase + LIFF SDK 載入完成');
}

// ── Init on DOM Ready ──
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

  // ── Phase 4: 背景載入 CDN SDK → Firebase + LIFF（不阻塞頁面）──
  if (!ModeManager.isDemo()) {
    console.log('[Boot] Phase 4: 開始背景載入 CDN');
    (async () => {
      try {
        await _loadCDNScripts();
        console.log('[Boot] Phase 4: CDN 載入完成');
        initFirebaseApp();
        console.log('[Boot] Phase 4: Firebase App 初始化完成');
        // 重置 LIFF 狀態（Phase 3 可能因 SDK 未載入而標記為 ready + error）
        if (typeof liff !== 'undefined') {
          LineAuth._ready = false;
          LineAuth._initError = null;
        }

        // Step 1: LIFF SDK 初始化（Access Token 就緒，不含 ensureProfile）
        if (typeof liff !== 'undefined') {
          await LineAuth.initSDK();
          console.log('[Boot] Phase 4: LIFF SDK 初始化完成');
        }

        // Step 2: 返回用戶快取 → 立即顯示頭像（不等網路）
        if (LineAuth.hasLiffSession()) {
          LineAuth.restoreCachedProfile();
          if (LineAuth._profile) {
            try { App.renderLoginUI(); } catch (e) {}
          }
        }

        // Step 3: 並行 — profile 網路更新 + Firebase 完整初始化
        // force: true 確保即使有快取也從 LINE 伺服器取得最新 profile
        const profilePromise = LineAuth.hasLiffSession()
          ? LineAuth.ensureProfile({ force: true }).catch(e => console.warn('[Boot] ensureProfile failed:', e))
          : Promise.resolve();

        await Promise.all([profilePromise, FirebaseService.init()]);
        App._firebaseConnected = true;
        ApiService._errorLogReady = true;
        console.log('[Boot] Phase 4: Firebase + LIFF 初始化完成（並行）');
        // 用即時資料重新渲染頁面
        try { App.renderAll(); } catch (e) {}
        // 更新 LINE 登入狀態（LIFF SDK 已載入，可正常運作）
        try { if (typeof App.bindLineLogin === 'function') await App.bindLineLogin(); } catch (e) {
          console.error('[Boot] bindLineLogin 執行失敗:', e?.message || e, e?.stack || '');
          try { App.showToast('LINE 登入流程異常，請重新整理頁面'); } catch (_) {}
        }
        // LIFF ready 後再嘗試開 deep link，成功才會清除 query 參數
        try { App._tryOpenPendingDeepLink(); } catch (_) {}
      } catch (err) {
        console.error('[Boot] Phase 4 背景初始化失敗:', err?.message || err);
        try { App.showToast('網路連線異常，部分資料可能未更新'); } catch (e) {}
        // 即使失敗也更新登入 UI，避免卡在 pending 狀態
        try { if (typeof App.bindLineLogin === 'function') await App.bindLineLogin(); } catch (e) {}
        try { App._tryOpenPendingDeepLink(); } catch (_) {}
      }
    })();
  }

  // Global unhandled rejection → errorLog（過濾第三方 SDK 雜訊）
  window.addEventListener('unhandledrejection', (event) => {
    if (!ApiService._errorLogReady) return;
    const msg = (event.reason?.message || '').toLowerCase();
    if (msg.includes('liff') || msg.includes('firebase') || msg.includes('firestore') || msg.includes('chunkloaderror')) return;
    ApiService._writeErrorLog('unhandledrejection', event.reason);
  });

  // 嘗試立即開啟 deep link（其餘會由 guard 持續輪詢）
  try { App._tryOpenPendingDeepLink(); } catch (_) {}

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
