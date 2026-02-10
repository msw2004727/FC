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
    this.bindImageUpload('cs-img1', 'cs-preview1');
    this.bindImageUpload('cs-img2', 'cs-preview2');
    this.bindImageUpload('cs-img3', 'cs-preview3');
    this.bindImageUpload('banner-image', 'banner-preview');
    this.bindImageUpload('floatad-image', 'floatad-preview');
    this.bindImageUpload('popupad-image', 'popupad-preview');
    this.renderBannerCarousel();
    this.startBannerCarousel();
    this.renderAll();
    this.applyRole('user');
  },

  renderAll() {
    this.renderHotEvents();
    this.renderOngoingTournaments();
    this.renderActivityList();
    this.renderTeamList();
    this.renderMessageList();
    this.renderAchievements();
    this.renderBadges();
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
    this.renderAnnouncementManage();
    this.renderShopManage();
    this.renderMsgManage();
    this.renderTournamentManage();
    this.renderAdminTeams();
    this.renderAdminAchievements();
    this.renderRoleHierarchy();
    this.renderInactiveData();
    this.renderMyActivities();
    this.renderUserCard();
    this.renderProfileData();
    this.updateNotifBadge();
    this.updateStorageBar();
  },

  showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
  },
};

// ── Init on DOM Ready ──
document.addEventListener('DOMContentLoaded', async () => {
  // 正式版模式：先初始化 Firebase 快取，再啟動 App
  if (!ModeManager.isDemo()) {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = '';
    try {
      // 設定 10 秒超時，避免 Firebase 連線問題導致永久載入
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Firebase init timeout')), 10000)
      );
      await Promise.race([FirebaseService.init(), timeout]);
      console.log('[App] Firebase 模式啟動');
    } catch (err) {
      console.error('[App] Firebase 初始化失敗，退回 Demo 模式:', err);
      ModeManager.setMode('demo');
    } finally {
      if (overlay) overlay.style.display = 'none';
    }
  }
  App.init();
  // 彈跳廣告（延遲 500ms 確保資料已載入）
  setTimeout(() => App.showPopupAdsOnLoad(), 500);
  // 移除早期模式偵測的 CSS class，讓 JS 接手控制
  document.documentElement.classList.remove('prod-early');
});
