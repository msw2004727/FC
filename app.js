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

  renderAll() {
    this.renderHotEvents();
    this.renderOngoingTournaments();
    this.renderActivityList();
    this.renderTeamList();
    this.renderMessageList();
    this.renderAchievements();
    this.renderShop();
    this.renderLeaderboard();
    this.renderTournamentTimeline();
    this.renderActivityRecords();
    this.renderAdminUsers();
    this.renderExpLogs();
    this.renderOperationLogs();
    this.renderAnnouncement();
    this.renderFloatingAds();
    this.renderBannerCarousel();
    this.renderBannerManage();
    this.renderFloatingAdManage();
    this.renderPopupAdManage();
    this.renderSponsorManage();
    this.renderSponsors();
    this.renderThemeManage();
    this.applySiteThemes();
    this.renderAnnouncementManage();
    this.renderShopManage();
    this.renderMsgManage();
    this.renderTournamentManage();
    this.renderAdminTeams();
    this.renderTeamManage();
    this.renderAdminAchievements();
    this.renderRoleHierarchy();
    this.renderInactiveData();
    this.renderMyActivities();
    this.renderUserCard();
    this.renderProfileData();
    this.renderProfileFavorites();
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

// ── Init on DOM Ready ──
document.addEventListener('DOMContentLoaded', async () => {
  // 載入所有頁面片段（pages/*.html → #main-content / #modal-container）
  await PageLoader.loadAll();

  // 正式版模式：Firebase + LIFF 平行初始化（避免 LIFF auth code 過期）
  if (!ModeManager.isDemo()) {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = '';
    try {
      // 設定 10 秒超時，避免 Firebase 連線問題導致永久載入
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Firebase init timeout')), 10000)
      );
      // LIFF 與 Firebase 平行初始化：LIFF 需盡早處理 URL 中的 auth code
      const liffReady = (typeof LineAuth !== 'undefined') ? LineAuth.init() : Promise.resolve();
      await Promise.race([
        Promise.all([FirebaseService.init(), liffReady]),
        timeout,
      ]);
      console.log('[App] Firebase + LIFF 初始化完成');
    } catch (err) {
      console.error('[App] 初始化失敗，退回 Demo 模式:', err.message || err);
      ModeManager.setMode('demo');
    } finally {
      if (overlay) overlay.style.display = 'none';
    }
  }
  App.init();
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
