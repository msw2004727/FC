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
  // 載入所有頁面片段（pages/*.html → #main-content / #modal-container）
  await PageLoader.loadAll();

  // 正式版模式：動態載入 CDN SDK → Firebase + LIFF 初始化
  let _firebaseReady = false;
  if (!ModeManager.isDemo()) {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = '';
    let _tid;
    try {
      // 總預算 30 秒：CDN 下載 + Firebase 連線 + LIFF 認證
      const timeout = new Promise((_, reject) => {
        _tid = setTimeout(() => reject(new Error('載入逾時（30s）')), 30000);
      });

      // Step 1: 動態載入 CDN SDK（Firebase + LIFF）
      await Promise.race([_loadCDNScripts(), timeout]);

      // Step 2: 初始化 Firebase App（CDN 載入後才能呼叫）
      initFirebaseApp();

      // Step 3: Firebase Service + LIFF 平行初始化
      const liffReady = (typeof liff !== 'undefined') ? LineAuth.init() : Promise.resolve();
      await Promise.race([
        Promise.all([FirebaseService.init(), liffReady]),
        timeout,
      ]);
      _firebaseReady = true;
      console.log('[App] Firebase + LIFF 初始化完成');
    } catch (err) {
      console.error('[App] 初始化失敗:', err.message || err);
      // 不退回 Demo！維持 production 模式，使用 FirebaseService._cache（可能有 localStorage 快取）
      console.warn('[App] 維持正式版模式，使用快取資料');
    } finally {
      clearTimeout(_tid);
      if (overlay) overlay.style.display = 'none';
    }
  }
  try {
    App.init();
    // Firebase 失敗時提示用戶（不阻塞畫面）
    if (!ModeManager.isDemo() && !_firebaseReady) {
      App.showToast('網路連線異常，部分資料可能未更新');
    }
  } catch (initErr) {
    console.error('[App] init() 失敗:', initErr);
    // 顯示重試按鈕
    var rb = document.getElementById('_recovery_btn');
    if (!rb) {
      rb = document.createElement('button');
      rb.id = '_recovery_btn';
      rb.textContent = '載入失敗，點此重新整理';
      rb.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99999;padding:1rem 2rem;font-size:1rem;background:#dc2626;color:#fff;border:none;border-radius:8px;cursor:pointer';
      rb.onclick = function() { location.reload(); };
      document.body.appendChild(rb);
    }
  }
  // Deep link handling: ?event=xxx or ?team=xxx
  const urlParams = new URLSearchParams(location.search);
  const deepEvent = urlParams.get('event');
  const deepTeam = urlParams.get('team');
  if (deepEvent) { setTimeout(() => App.showEventDetail(deepEvent), 300); }
  else if (deepTeam) { setTimeout(() => App.showTeamDetail(deepTeam), 300); }
  // 自動下架過期廣告（啟動時 + 每 60 秒檢查）
  App._autoExpireAds();
  setInterval(() => App._autoExpireAds(), 60000);
  // 排程站內信自動發送（啟動時 + 每 60 秒檢查）
  App._processScheduledMessages();
  setInterval(() => App._processScheduledMessages(), 60000);
  // 活動提醒通知（啟動時 + 每 5 分鐘檢查）
  App._processEventReminders();
  setInterval(() => App._processEventReminders(), 300000);
  // 彈跳廣告（延遲 500ms 確保資料已載入）
  setTimeout(() => App.showPopupAdsOnLoad(), 500);
  // 移除早期模式偵測的 CSS class，讓 JS 接手控制
  document.documentElement.classList.remove('prod-early');
});
