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
    _loadScript('https://static.line-scdn.net/liff/edge/2/sdk.js'),
  ]);
  console.log('[CDN] Firebase + LIFF SDK 載入完成');
}

// ── Init on DOM Ready ──
document.addEventListener('DOMContentLoaded', async () => {
  window._appInitializing = true;
  console.log('[Boot] DOMContentLoaded fired');

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

  // Phase 3 完成：移除 prod-early class（恢復角色切換器等 UI）
  // loading overlay 保留到 Phase 4 bindLineLogin 完成後才隱藏（正式版），Demo 版立即隱藏
  try {
    document.documentElement.classList.remove('prod-early');
    if (ModeManager.isDemo()) {
      var _ov = document.getElementById('loading-overlay');
      if (_ov) _ov.style.display = 'none';
      if (window._loadingSafety) clearTimeout(window._loadingSafety);
    }
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
    // Deep link 等待卡片（進度條已嵌入 loading-overlay，隨 overlay 自動顯示/隱藏）
    const _liffCard = document.getElementById('liff-deeplink-card');
    if (_liffCard && (sessionStorage.getItem('_pendingDeepEvent') || sessionStorage.getItem('_pendingDeepTeam'))) {
      _liffCard.style.display = 'flex';
    }
    const _hideLiffInitUI = () => {
      if (_liffCard && _liffCard.style.display !== 'none') {
        _liffCard.classList.add('liff-hide');
        setTimeout(() => { _liffCard.style.display = 'none'; _liffCard.classList.remove('liff-hide'); }, 450);
      }
    };
    const _hideLoadingOverlay = () => {
      setTimeout(() => {
        const ov = document.getElementById('loading-overlay');
        if (ov && ov.style.display !== 'none') ov.style.display = 'none';
        if (window._loadingSafety) clearTimeout(window._loadingSafety);
        console.log('[Boot] 載入畫面已隱藏（Phase 4 完成 + 0.5s）');
      }, 500);
    };
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
        const liffReady = (typeof liff !== 'undefined') ? LineAuth.init() : Promise.resolve();
        await Promise.all([FirebaseService.init(), liffReady]);
        App._firebaseConnected = true;
        console.log('[Boot] Phase 4: Firebase + LIFF 初始化完成');
        // 用即時資料重新渲染頁面
        try { App.renderAll(); } catch (e) {}
        // 更新 LINE 登入狀態（LIFF SDK 已載入，可正常運作）
        try { if (typeof App.bindLineLogin === 'function') await App.bindLineLogin(); } catch (e) {
          console.error('[Boot] bindLineLogin 執行失敗:', e?.message || e, e?.stack || '');
          try { App.showToast('LINE 登入流程異常，請重新整理頁面'); } catch (_) {}
        }
        // LIFF 已 ready，執行暫存的 deep link（分享連結進入的情境）
        try {
          const pendingEvent = sessionStorage.getItem('_pendingDeepEvent');
          const pendingTeam  = sessionStorage.getItem('_pendingDeepTeam');
          if (pendingEvent) {
            sessionStorage.removeItem('_pendingDeepEvent');
            setTimeout(() => App.showEventDetail(pendingEvent), 300);
          } else if (pendingTeam) {
            sessionStorage.removeItem('_pendingDeepTeam');
            setTimeout(() => App.showTeamDetail(pendingTeam), 300);
          }
        } catch (e) {}
        _hideLiffInitUI();
        _hideLoadingOverlay();
      } catch (err) {
        _hideLiffInitUI();
        _hideLoadingOverlay();
        console.error('[Boot] Phase 4 背景初始化失敗:', err && err.message || err, err && err.stack || '');
        try { App.showToast('網路連線異常，部分資料可能未更新'); } catch (e) {}
      }
    })();
  }

  // Deep link handling & 定時任務（全部 try-catch 保護）
  try {
    const urlParams = new URLSearchParams(location.search);
    const deepEvent = urlParams.get('event');
    const deepTeam = urlParams.get('team');
    if (ModeManager.isDemo()) {
      // Demo 模式無需登入，直接執行
      if (deepEvent) { setTimeout(() => App.showEventDetail(deepEvent), 300); }
      else if (deepTeam) { setTimeout(() => App.showTeamDetail(deepTeam), 300); }
    } else {
      // 正式版：暫存 deep link，等 LIFF 初始化完成後再執行
      // 使用 sessionStorage 可安全度過 LIFF OAuth redirect（redirect 後 URL 參數會消失）
      if (deepEvent) sessionStorage.setItem('_pendingDeepEvent', deepEvent);
      else if (deepTeam) sessionStorage.setItem('_pendingDeepTeam', deepTeam);
    }
    // 讀取完 deep link 後立即清除 query parameter，避免殘留在後續 hash 路由的 URL 中
    if (deepEvent || deepTeam) history.replaceState(null, '', location.pathname);
  } catch (e) {}
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
  try { App._processScheduledMessages(); } catch (e) {}
  setInterval(() => { try { App._processScheduledMessages(); } catch (e) {} }, 60000);
  try { App._processEventReminders(); } catch (e) {}
  setInterval(() => { try { App._processEventReminders(); } catch (e) {} }, 300000);
  setTimeout(() => { try { App.showPopupAdsOnLoad(); } catch (e) {} }, 2000);

  window._appInitializing = false;
  console.log('[Boot] 初始化流程結束');
});
