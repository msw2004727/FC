/* ================================================
   SportHub — Navigation, Drawer, Modal
   ================================================ */

Object.assign(App, {

  /** 正式版未登入時擋住並提示，回傳 true 代表被擋 */
  _requireLogin() {
    if (ModeManager.isDemo()) return false;
    if (typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn()) return false;
    this.showToast('請先登入LINE帳號');
    return true;
  },

  bindNavigation() {
    document.querySelectorAll('.bot-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const page = tab.dataset.page;
        this.pageHistory = [];
        this.showPage(page);
        document.querySelectorAll('.bot-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
      });
    });
  },

  showPage(pageId) {
    // 正式版未登入：擋住球隊、賽事、我的、訊息頁
    const guardedPages = ['page-profile', 'page-teams', 'page-tournaments', 'page-messages'];
    if (guardedPages.includes(pageId) && this._requireLogin()) return;
    if (this.currentPage !== pageId) {
      this.pageHistory.push(this.currentPage);
    }
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(pageId);
    if (target) {
      target.classList.add('active');
      this.currentPage = pageId;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      // 重設浮動廣告位置，避免跨頁 scrollTo 觸發 scroll listener 造成跳位
      this._floatAdOffset = 0;
      this._floatAdTarget = 0;
      requestAnimationFrame(() => { if (this._positionFloatingAds) this._positionFloatingAds(); });
      if (pageId === 'page-home') { this.renderHotEvents(); this.renderOngoingTournaments(); }
      if (pageId === 'page-activities') this.renderActivityList();
      if (pageId === 'page-titles') this.renderTitlePage();
      if (pageId === 'page-my-activities') this.renderMyActivities();
      if (pageId === 'page-team-manage') this.renderTeamManage();
      if (pageId === 'page-admin-dashboard') this.renderDashboard();
      if (pageId === 'page-personal-dashboard') this.renderPersonalDashboard();
      if (pageId === 'page-admin-auto-exp') this.renderAutoExpRules();
      if (pageId === 'page-scan') this.renderScanPage();
      if (pageId === 'page-qrcode') this.renderQrCodePage();
      if (pageId !== 'page-scan' && this._stopCamera) this._stopCamera();
    }
  },

  goBack() {
    if (this.pageHistory.length > 0) {
      const prev = this.pageHistory.pop();
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.getElementById(prev).classList.add('active');
      this.currentPage = prev;
      const mainPages = ['page-home','page-activities','page-teams','page-messages','page-profile'];
      document.querySelectorAll('.bot-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.page === prev && mainPages.includes(prev));
      });
    }
  },

  bindDrawer() {
    document.getElementById('menu-toggle').addEventListener('click', () => this.openDrawer());
    document.getElementById('drawer-overlay').addEventListener('click', () => this.closeDrawer());
  },

  openDrawer() {
    document.getElementById('side-drawer').classList.add('open');
    document.getElementById('drawer-overlay').classList.add('open');
  },

  closeDrawer() {
    document.getElementById('side-drawer').classList.remove('open');
    document.getElementById('drawer-overlay').classList.remove('open');
  },

  showModal(id) { this.toggleModal(id); },

  toggleModal(id) {
    const modal = document.getElementById(id);
    const overlay = document.getElementById('modal-overlay');
    if (!modal) return;
    const isOpen = modal.classList.contains('open');
    if (isOpen) {
      modal.classList.remove('open');
      overlay.classList.remove('open');
    } else {
      document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
      modal.classList.add('open');
      overlay.classList.add('open');
      modal.scrollTop = 0;
      const modalBody = modal.querySelector('.modal-body');
      if (modalBody) modalBody.scrollTop = 0;
    }
  },

  closeModal() {
    document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
    document.getElementById('modal-overlay').classList.remove('open');
  },

  // ── Language Switcher ──
  initLangSwitcher() {
    const sel = document.getElementById('lang-select');
    if (!sel) return;
    const locales = I18N.getAvailableLocales();
    sel.innerHTML = locales.map(l => `<option value="${l.code}"${l.code === I18N.getLocale() ? ' selected' : ''}>${l.label}</option>`).join('');
  },

  switchLanguage(locale) {
    I18N.setLocale(locale);
    this._applyI18nToUI();
    this.showToast(t('toast.langChanged'));
  },

  /** 將 t() 套用到底部頁籤與 drawer 等靜態 UI */
  _applyI18nToUI() {
    // Bottom tabs
    const tabKeys = ['nav.home', 'nav.activities', 'nav.teams', 'nav.tournaments', 'nav.profile'];
    document.querySelectorAll('.bot-tab').forEach((tab, i) => {
      const span = tab.querySelector('span');
      if (span && tabKeys[i]) span.textContent = t(tabKeys[i]);
    });
    // Drawer footer labels
    const dmLabel = document.querySelector('#theme-toggle span:first-child');
    if (dmLabel) dmLabel.textContent = t('drawer.darkMode');
    const langLabel = document.querySelector('.lang-label');
    if (langLabel) langLabel.textContent = t('drawer.language');

    // Page headers
    const teamPageHeader = document.querySelector('#page-teams .page-header-title');
    if (teamPageHeader) teamPageHeader.textContent = t('nav.teams');
    const actPageHeader = document.querySelector('#page-activities .page-header-title');
    if (actPageHeader) actPageHeader.textContent = t('nav.activities');
    const profilePageHeader = document.querySelector('#page-profile .page-header-title');
    if (profilePageHeader) profilePageHeader.textContent = t('nav.profile');

    // Search placeholders
    const teamSearch = document.getElementById('team-search');
    if (teamSearch) teamSearch.placeholder = t('teamPage.searchPlaceholder');
    const actSearch = document.getElementById('activity-search');
    if (actSearch) actSearch.placeholder = t('activityPage.searchPlaceholder');

    // Team region filter first option
    const teamRegion = document.getElementById('team-region-filter');
    if (teamRegion && teamRegion.options.length > 0) {
      teamRegion.options[0].textContent = t('teamPage.allRegions');
    }

    // Re-render drawer menu & dashboard if visible
    this.renderDrawerMenu();
    // Re-render current page for i18n updates
    if (this.currentPage === 'page-teams') this.renderTeamList();
  },

  bindNotifBtn() {
    document.getElementById('notif-btn')?.addEventListener('click', () => {
      if (this._requireLogin()) return;
      this.showPage('page-messages');
      document.querySelectorAll('.bot-tab').forEach(t => t.classList.remove('active'));
    });
  },

});
