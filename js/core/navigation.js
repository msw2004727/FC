/* ================================================
   SportHub — Navigation, Drawer, Modal
   ================================================ */

Object.assign(App, {

  _pageTransitionSeq: 0,

  _getRouteStepTimeoutMs(pageId, step = 'page') {
    if (step === 'cloud') return Number(this._routeCloudTimeoutMs || 15000);
    return Number(this._routeStepTimeoutMs || 15000);
  },

  _awaitRouteStep(promise, pageId, step = 'page') {
    return _withSportHubTimeout(
      promise,
      this._getRouteStepTimeoutMs(pageId, step),
      'route-step-timeout',
      `Route step timeout (${step}:${pageId})`
    );
  },

  _getRouteFailureToast(pageId, step = 'page', err = null) {
    const isTimeout = err?.code === 'route-step-timeout';
    if (isTimeout) {
      if (pageId === 'page-activities') return '網路較慢，活動頁暫時無法開啟，請稍後再試';
      return '網路較慢，頁面暫時無法開啟，請稍後再試';
    }
    if (step === 'cloud') return '雲端連線失敗，請稍後再試';
    return '頁面載入失敗，請稍後再試';
  },

  _runPageScrollReset(targetPage) {
    const html = document.documentElement;
    const body = document.body;
    const mainContent = document.getElementById('main-content');
    const prevHtmlBehavior = html.style.scrollBehavior;
    const prevBodyBehavior = body ? body.style.scrollBehavior : '';

    html.style.scrollBehavior = 'auto';
    if (body) body.style.scrollBehavior = 'auto';

    window.scrollTo(0, 0);
    html.scrollTop = 0;
    if (body) body.scrollTop = 0;
    if (mainContent) mainContent.scrollTop = 0;
    if (targetPage) targetPage.scrollTop = 0;

    requestAnimationFrame(() => {
      html.style.scrollBehavior = prevHtmlBehavior;
      if (body) body.style.scrollBehavior = prevBodyBehavior;
    });
  },

  _resetPageScroll(pageId) {
    const performReset = () => {
      const targetPage = (pageId && document.getElementById(pageId)) || document.querySelector('.page.active');
      this._runPageScrollReset(targetPage);
    };

    performReset();
    requestAnimationFrame(() => performReset());

    clearTimeout(this._pageScrollResetTimer);
    this._pageScrollResetTimer = setTimeout(() => {
      performReset();
      this._pageScrollResetTimer = null;
    }, 120);
  },

  _hasActivityCacheForSoftEntry() {
    if (typeof ApiService === 'undefined' || typeof ApiService.getEvents !== 'function') return false;
    try {
      return (ApiService.getEvents() || []).length > 0;
    } catch (_) {
      return false;
    }
  },

  _canUseActivitySoftEntry(options = {}) {
    const { authPending = false } = options;
    if (ModeManager.isDemo() || authPending) return false;
    if (!document.getElementById('page-activities')) return false;
    return this._hasPageSnapshotReady?.('page-activities') || this._hasActivityCacheForSoftEntry();
  },

  _canUseStaleFirstNavigation(pageId, options = {}) {
    const { authPending = false } = options;
    if (pageId === 'page-activities') {
      return this._canUseActivitySoftEntry({ authPending });
    }
    if (!this._hasPageSnapshotReady?.(pageId)) return false;
    if (pageId === 'page-home') return true;
    return false;
  },

  _activatePage(pageId, options = {}) {
    const target = document.getElementById(pageId);
    if (!target) return null;

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    target.classList.add('active');
    this.currentPage = pageId;

    if (!ModeManager.isDemo()
      && typeof FirebaseService !== 'undefined'
      && typeof FirebaseService.finalizePageScopedRealtimeForPage === 'function') {
      FirebaseService.finalizePageScopedRealtimeForPage(pageId);
    }

    if (!options.suppressHashSync && location.hash !== '#' + pageId) {
      location.hash = pageId;
    }

    this._floatAdOffset = 0;
    this._floatAdTarget = 0;
    requestAnimationFrame(() => { if (this._positionFloatingAds) this._positionFloatingAds(); });

    if (options.render !== false) this._renderPageContent(pageId);
    if (!ModeManager.isDemo()
      && pageId === 'page-activities'
      && typeof FirebaseService !== 'undefined'
      && typeof FirebaseService.schedulePageScopedRealtimeForPage === 'function') {
      FirebaseService.schedulePageScopedRealtimeForPage(pageId);
    }
    if (options.resetScroll !== false) this._resetPageScroll(pageId);
    if (pageId !== 'page-scan' && this._stopCamera) this._stopCamera();
    return target;
  },

  async _refreshStaleFirstPage(pageId, transitionSeq) {
    try {
      if (pageId === 'page-activities'
        && !this._cloudReady
        && typeof this.ensureCloudReady === 'function') {
        try {
          await this.ensureCloudReady({ reason: `stale:${pageId}` });
        } catch (err) {
          if (transitionSeq !== this._pageTransitionSeq || this.currentPage !== pageId) return;
          console.warn(`[Navigation] stale-first cloud refresh failed for ${pageId}:`, err);
          return;
        }
      }
      if (typeof FirebaseService === 'undefined' || typeof FirebaseService.ensureCollectionsForPage !== 'function') return;
      const loaded = await FirebaseService.ensureCollectionsForPage(pageId, {
        skipRealtimeStart: pageId === 'page-activities',
      });
      if (transitionSeq !== this._pageTransitionSeq || this.currentPage !== pageId) return;
      if ((loaded || []).length > 0 || pageId === 'page-activities') {
        this._renderPageContent(pageId);
      }
    } catch (err) {
      if (transitionSeq !== this._pageTransitionSeq || this.currentPage !== pageId) return;
      console.warn(`[Navigation] stale-first refresh failed for ${pageId}:`, err);
    }
  },

  _normalizeAdminLogRoute(pageId, options = {}) {
    let normalizedPageId = pageId;
    let adminLogTab = options.adminLogTab || '';

    if (pageId === 'page-admin-audit-logs') {
      normalizedPageId = 'page-admin-logs';
      adminLogTab = 'audit';
    } else if (pageId === 'page-admin-error-logs') {
      normalizedPageId = 'page-admin-logs';
      adminLogTab = 'error';
    }

    if (normalizedPageId === 'page-admin-logs') {
      adminLogTab = adminLogTab || (pageId === 'page-admin-logs' ? 'operation' : this._adminLogActiveTab || 'operation');
      this._pendingAdminLogTab = adminLogTab;
    }

    return { pageId: normalizedPageId, adminLogTab };
  },

  _pageNeedsCloud(pageId) {
    return !ModeManager.isDemo() && pageId !== 'page-home';
  },

  _isCurrentUserRestricted() {
    if (ModeManager.isDemo()) return false;
    if (typeof ApiService === 'undefined' || typeof ApiService.getCurrentUser !== 'function') return false;
    const user = ApiService.getCurrentUser();
    return !!(user && user.isRestricted === true);
  },

  _showRestrictedToast() {
    this.showToast('帳號限制中');
  },

  _handleRestrictedStateChange() {
    if (this._restrictRedirecting) return;
    if (!this._isCurrentUserRestricted()) return;
    if (this.currentPage === 'page-home') return;

    this._restrictRedirecting = true;
    try {
      this._showRestrictedToast();
      this.showPage('page-home', { bypassRestrictionGuard: true, resetHistory: true });
    } finally {
      this._restrictRedirecting = false;
    }
  },

  /** 正式版未登入時擋住並提示，回傳 true 代表被擋 */
  _requireLogin() {
    if (ModeManager.isDemo()) return false;
    if (typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn()) return false;
    if (typeof LineAuth !== 'undefined'
      && typeof LineAuth.isPendingLogin === 'function'
      && LineAuth.isPendingLogin()) {
      this.showToast('LINE 登入確認中，請稍候...');
      return true;
    }
    this.showToast('請先登入LINE帳號');
    return true;
  },

  _requireProtectedActionLogin(action, options = {}) {
    if (!this._isLoginRequired()) return false;
    if (typeof this._requestLoginForAction === 'function' && action) {
      this._requestLoginForAction(action, options);
      return true;
    }
    return this._requireLogin();
  },

  _isLoginRequired() {
    if (ModeManager.isDemo()) return false;
    if (typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn()) return false;
    return true;
  },

  bindNavigation() {
    document.querySelectorAll('.bot-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const page = tab.dataset.page;
        if (this._isCurrentUserRestricted() && page !== 'page-home') {
          this._showRestrictedToast();
          return;
        }
        if (page === 'page-tournaments') {
          this.showToast('功能準備中');
          return;
        }
        const guardedPages = ['page-profile', 'page-teams', 'page-tournaments', 'page-messages', 'page-activities'];
        if (guardedPages.includes(page) && this._requireProtectedActionLogin({ type: 'showPage', pageId: page }, {
          suppressToast: true,
        })) {
          return;
        }
        this.pageHistory = [];
        void this.showPage(page);
        document.querySelectorAll('.bot-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
      });
    });
  },

  async _ensurePageEntryReady(pageId) {
    if (this._pageNeedsCloud(pageId) && typeof this.ensureCloudReady === 'function') {
      try {
        await this.ensureCloudReady({ reason: `page:${pageId}` });
      } catch (err) {
        console.warn(`[Navigation] cloud init failed before ${pageId}:`, err);
      }
    }

    if (typeof PageLoader !== 'undefined' && PageLoader.ensurePage) {
      await PageLoader.ensurePage(pageId);
    }

    if (!document.getElementById(pageId)) {
      throw new Error(`Page element missing: ${pageId}`);
    }

    if (typeof ScriptLoader !== 'undefined' && ScriptLoader.ensureForPage) {
      await ScriptLoader.ensureForPage(pageId);
    }

    if (!ModeManager.isDemo()
      && typeof FirebaseService !== 'undefined'
      && FirebaseService.ensureCollectionsForPage) {
      await FirebaseService.ensureCollectionsForPage(pageId, {
        skipRealtimeStart: pageId === 'page-activities',
      });
    }
  },

  async _invokeLazyRouteMethod(pageId, methodName, args = []) {
    const gateway = this._lazyRouteGateways && this._lazyRouteGateways[methodName];
    const currentMethod = this[methodName];

    if (typeof currentMethod === 'function' && (!gateway || currentMethod !== gateway)) {
      return await currentMethod.apply(this, args);
    }

    await this._ensurePageEntryReady(pageId);

    const loadedMethod = this[methodName];
    if (typeof loadedMethod !== 'function' || (gateway && loadedMethod === gateway)) {
      throw new Error(`Route method unavailable: ${methodName}`);
    }

    return await loadedMethod.apply(this, args);
  },

  async showEventDetail(id, options = {}) {
    return await this._invokeLazyRouteMethod('page-activity-detail', 'showEventDetail', [id, options]);
  },

  async showTeamDetail(id, options = {}) {
    if (this._requireProtectedActionLogin({ type: 'showTeamDetail', teamId: id }, {
      suppressToast: true,
    })) {
      return { ok: false, reason: 'auth' };
    }
    return await this._invokeLazyRouteMethod('page-team-detail', 'showTeamDetail', [id, options]);
  },

  goToScanForEvent(eventId) {
    if (this._requireProtectedActionLogin({ type: 'goToScanForEvent', eventId }, {
      suppressToast: true,
    })) {
      return;
    }
    // Keep the entrypoint in core so event detail can route to the lazy scan module safely.
    this._scanPresetEventId = eventId || null;
    void this.showPage('page-scan');
  },

  async showPage(pageId, options = {}) {
    const normalizedRoute = this._normalizeAdminLogRoute(pageId, options);
    pageId = normalizedRoute.pageId;

    if (!options.bypassRestrictionGuard && this._isCurrentUserRestricted() && pageId !== 'page-home') {
      this._showRestrictedToast();
      return { ok: false, reason: 'restricted' };
    }
    // 正式版未登入：擋住球隊、賽事、我的、訊息頁
    const guardedPages = ['page-profile', 'page-teams', 'page-tournaments', 'page-messages', 'page-activities'];
    const needsCloudInit = this._pageNeedsCloud(pageId) && (!this._cloudReady || !!this._cloudReadyPromise);
    const authPending = !ModeManager.isDemo()
      && typeof LineAuth !== 'undefined'
      && (
        (typeof LineAuth.isPendingLogin === 'function' && LineAuth.isPendingLogin())
        || (typeof LineAuth.hasLiffSession === 'function' && LineAuth.hasLiffSession() && !LineAuth._ready)
      );
    const canUseStaleFirst = pageId !== this.currentPage
      && this._canUseStaleFirstNavigation(pageId, { authPending });
    const shouldShowRouteLoading = pageId !== this.currentPage
      && !canUseStaleFirst
      && typeof this._beginRouteLoading === 'function'
      && typeof this._endRouteLoading === 'function';
    const routeLoadingSeq = shouldShowRouteLoading
      ? this._beginRouteLoading({
          pageId,
          phase: authPending ? 'auth' : (needsCloudInit ? 'cloud' : 'page'),
          immediate: authPending,
        })
      : 0;

    try {
      if (!canUseStaleFirst
        && guardedPages.includes(pageId)
        && this._pageNeedsCloud(pageId)
        && typeof this.ensureCloudReady === 'function') {
        try {
          await this._awaitRouteStep(
            this.ensureCloudReady({ reason: `guard:${pageId}` }),
            pageId,
            'cloud'
          );
        } catch (err) {
          console.warn(`[Navigation] guard cloud init failed for ${pageId}:`, err);
          this.showToast(this._getRouteFailureToast(pageId, 'cloud', err));
          return {
            ok: false,
            reason: err?.code === 'route-step-timeout' ? 'route_timeout' : 'cloud_init_failed',
            step: 'cloud',
            error: err,
          };
        }
      }
      if (guardedPages.includes(pageId) && options.suppressLoginToast && this._isLoginRequired()) {
        return { ok: false, reason: 'login_required' };
      }
      if (guardedPages.includes(pageId) && this._requireLogin()) return { ok: false, reason: 'login_required' };
      if (typeof this._canAccessPage === 'function' && !this._canAccessPage(pageId)) {
        if (options.suppressAccessDeniedToast) return { ok: false, reason: 'forbidden' };
        this.showToast('權限不足');
        return { ok: false, reason: 'forbidden' };
      }

      const transitionSeq = ++this._pageTransitionSeq;

      if (canUseStaleFirst) {
        if (this.currentPage === 'page-home' && pageId !== 'page-home') {
          this._cancelHomeDeferredRender?.();
          this.stopBannerCarousel?.();
        }

        const fromPage = this.currentPage;
        if (options.resetHistory) {
          this.pageHistory = [];
        } else if (fromPage !== pageId) {
          this.pageHistory.push(fromPage);
        }

        const activated = this._activatePage(pageId, options);
        if (!activated) return { ok: false, reason: 'missing_target' };

        void this._refreshStaleFirstPage(pageId, transitionSeq);
        return { ok: true, pageId, staleFirst: true };
      }

      try {
        await this._awaitRouteStep(
          this._ensurePageEntryReady(pageId),
          pageId,
          'page'
        );
      } catch (err) {
        if (transitionSeq === this._pageTransitionSeq) {
          console.warn(`[Navigation] 頁面 ${pageId} 載入失敗:`, err);
          this.showToast(this._getRouteFailureToast(pageId, 'page', err));
        }
        return {
          ok: false,
          reason: err?.code === 'route-step-timeout' ? 'route_timeout' : 'load_failed',
          step: 'page',
          error: err,
        };
      }

      if (transitionSeq !== this._pageTransitionSeq) return { ok: false, reason: 'stale_transition' };

      // 離開遊戲頁時銷毀引擎，釋放 WebGL context
      if (this.currentPage === 'page-game' && pageId !== 'page-game' && this.destroyShotGamePage) {
        this.destroyShotGamePage();
      }
      if (this.currentPage === 'page-home' && pageId !== 'page-home') {
        this._cancelHomeDeferredRender?.();
        this.stopBannerCarousel?.();
      }

      const fromPage = this.currentPage;
      if (options.resetHistory) {
        this.pageHistory = [];
      } else if (fromPage !== pageId) {
        this.pageHistory.push(fromPage);
      }
      const activated = this._activatePage(pageId, options);
      if (activated) {
        // 同步 URL hash，讓瀏覽器返回鍵可用（hash 相同時跳過，避免觸發 hashchange）
        if (!options.suppressHashSync && location.hash !== '#' + pageId) location.hash = pageId;
        // 重設浮動廣告位置，避免跨頁 scrollTo 觸發 scroll listener 造成跳位
        return { ok: true, pageId };
      }
      return { ok: false, reason: 'missing_target' };
    } finally {
      this._endRouteLoading?.(routeLoadingSeq);
    }
  },

  /** 根據頁面 ID 渲染對應內容 */
  _renderPageContent(pageId) {
    if (pageId === 'page-home') {
      this.renderAll();
      this.resetHomeHotEventsScroll?.();
    }
    if (pageId === 'page-activities') {
      this.resetActivityTab?.({ render: false });
      this.renderActivityList();
    }
    if (pageId === 'page-achievements') this.renderAchievements();
    if (pageId === 'page-titles') this.renderTitlePage();
    if (pageId === 'page-my-activities') this.renderMyActivities();
    if (pageId === 'page-team-manage') this.renderTeamManage();
    if (pageId === 'page-admin-dashboard') this.renderDashboard();
    if (pageId === 'page-temp-participant-report' && this.renderParticipantQuerySharePage) {
      this.renderParticipantQuerySharePage();
    }
    if (pageId === 'page-personal-dashboard') this.renderPersonalDashboard();
    if (pageId === 'page-admin-auto-exp') this.renderAutoExpRules();
    if (pageId === 'page-scan') this.renderScanPage();
    if (pageId === 'page-qrcode') this.renderQrCodePage();
    if (pageId === 'page-game' && this.initShotGamePage) this.initShotGamePage();
    // 按需渲染：進入頁面時才渲染，減少啟動負擔
    if (pageId === 'page-teams') this.renderTeamList();
    if (pageId === 'page-messages') this.renderMessageList();
    if (pageId === 'page-tournaments') { this.renderTournamentTimeline(); }
    if (pageId === 'page-profile') { this.renderUserCard(); this.renderProfileData(); this.renderProfileFavorites(); if (this.renderActivityRecords) this.renderActivityRecords('all', 1); }
    if (pageId === 'page-shop') this.renderShop();
    if (pageId === 'page-leaderboard') this.renderLeaderboard();
    if (pageId === 'page-admin-users') this.renderAdminUsers();
    if (pageId === 'page-admin-banners') { this.renderBannerManage(); this.renderFloatingAdManage(); this.renderPopupAdManage(); this.renderSponsorManage(); this.renderShotGameAdManage(); }
    if (pageId === 'page-admin-shop') this.renderShopManage();
    if (pageId === 'page-admin-messages') this.renderMsgManage();
    if (pageId === 'page-admin-tournaments') this.renderTournamentManage();
    if (pageId === 'page-admin-teams') this.renderAdminTeams();
    if (pageId === 'page-admin-achievements') this.renderAdminAchievements();
    if (pageId === 'page-admin-roles') this.renderRoleHierarchy();
    if (pageId === 'page-admin-inactive') this.renderInactiveData();
    if (pageId === 'page-admin-repair') this.renderUserCorrectionManager?.();
    if (pageId === 'page-admin-exp') { this.renderExpLogs(); }
    if (pageId === 'page-admin-announcements') this.renderAnnouncementManage();
    if (pageId === 'page-admin-games') this.renderGameManage();
    if (pageId === 'page-admin-themes') this.renderThemeManage();
    if (pageId === 'page-admin-logs' && this.renderAdminLogCenter) {
      this.renderAdminLogCenter(this._pendingAdminLogTab || this._adminLogActiveTab || 'operation');
    }
    if (pageId === 'page-admin-audit-logs' && this.renderAdminLogCenter) {
      this.renderAdminLogCenter('audit');
    }
    if (pageId === 'page-admin-error-logs' && this.renderAdminLogCenter) {
      this.renderAdminLogCenter('error');
    }
  },

  async goBack() {
    if (this._isCurrentUserRestricted()) {
      this._handleRestrictedStateChange();
      return;
    }
    if (this.pageHistory.length > 0) {
      const prev = this.pageHistory.pop();
      if (!ModeManager.isDemo()
        && typeof FirebaseService !== 'undefined'
        && typeof FirebaseService.ensureCollectionsForPage === 'function') {
        await FirebaseService.ensureCollectionsForPage(prev);
      }
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.getElementById(prev).classList.add('active');
      this.currentPage = prev;
      if (!ModeManager.isDemo()
        && typeof FirebaseService !== 'undefined'
        && typeof FirebaseService.finalizePageScopedRealtimeForPage === 'function') {
        FirebaseService.finalizePageScopedRealtimeForPage(prev);
      }
      // 同步 URL hash
      if (location.hash !== '#' + prev) location.hash = prev;
      const mainPages = ['page-home','page-activities','page-teams','page-messages','page-profile'];
      document.querySelectorAll('.bot-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.page === prev && mainPages.includes(prev));
      });
      this._renderPageContent(prev);
      this._resetPageScroll(prev);
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
    const tabKeys = ['nav.tournaments', 'nav.teams', 'nav.home', 'nav.activities', 'nav.profile'];
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

App._lazyRouteGateways = Object.assign({}, App._lazyRouteGateways, {
  showEventDetail: App.showEventDetail,
  showTeamDetail: App.showTeamDetail,
});
