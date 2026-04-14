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

  _getPageStrategy(pageId) {
    return (typeof PAGE_STRATEGY !== 'undefined' && PAGE_STRATEGY[pageId]) || 'fresh-first';
  },

  _hasCachedDataForPage(pageId) {
    if (this._hasPageSnapshotReady?.(pageId)) return true;
    if (!document.getElementById(pageId)) return false;
    const contract = typeof PAGE_DATA_CONTRACT !== 'undefined' && PAGE_DATA_CONTRACT[pageId];
    if (!contract) return false;
    if (!contract.required || contract.required.length === 0) return true;
    if (typeof FirebaseService === 'undefined' || !FirebaseService._cache) return false;
    return contract.required.every(name => {
      const cached = FirebaseService._cache[name];
      return cached && (Array.isArray(cached) ? cached.length > 0 : Object.keys(cached).length > 0);
    });
  },

  _canUseStaleNavigation(pageId, options = {}) {
    const { authPending = false } = options;
    if (authPending) return false;
    if (pageId === this.currentPage) return false;
    const strategy = this._getPageStrategy(pageId);
    if (strategy !== 'stale-first' && strategy !== 'stale-confirm') return false;
    return this._hasCachedDataForPage(pageId);
  },

  _activatePage(pageId, options = {}) {
    const target = document.getElementById(pageId);
    if (!target) return null;

    // 如果目標頁面已經 active，跳過 class toggle 避免 display:none→block 瞬間丟失捲動位置
    if (!target.classList.contains('active')) {
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      target.classList.add('active');
    }
    this.currentPage = pageId;

    if (typeof FirebaseService !== 'undefined'
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
    if (typeof FirebaseService !== 'undefined'
      && typeof FirebaseService.schedulePageScopedRealtimeForPage === 'function') {
      const contract = typeof PAGE_DATA_CONTRACT !== 'undefined' && PAGE_DATA_CONTRACT[pageId];
      if (contract && contract.realtime && contract.realtime.length > 0) {
        FirebaseService.schedulePageScopedRealtimeForPage(pageId);
      }
    }
    if (options.resetScroll !== false) this._resetPageScroll(pageId);
    if (pageId !== 'page-scan' && this._stopCamera) this._stopCamera();
    return target;
  },

  async _refreshStalePage(pageId, transitionSeq) {
    try {
      if (this._pageNeedsCloud(pageId)
        && !this._cloudReady
        && typeof this.ensureCloudReady === 'function') {
        try {
          await this.ensureCloudReady({ reason: `stale:${pageId}` });
        } catch (err) {
          if (transitionSeq !== this._pageTransitionSeq || this.currentPage !== pageId) return;
          console.warn(`[Navigation] stale background refresh cloud failed for ${pageId}:`, err);
          return;
        }
      }
      if (typeof FirebaseService === 'undefined' || typeof FirebaseService.ensureCollectionsForPage !== 'function') return;
      const contract = typeof PAGE_DATA_CONTRACT !== 'undefined' && PAGE_DATA_CONTRACT[pageId];
      const hasRealtime = contract && contract.realtime && contract.realtime.length > 0;
      const loaded = await FirebaseService.ensureCollectionsForPage(pageId, {
        skipRealtimeStart: hasRealtime,
      });
      if (transitionSeq !== this._pageTransitionSeq || this.currentPage !== pageId) return;
      // 確保 lazy script 已載入，避免 stale-first 初次渲染時 render 方法不存在
      if (typeof ScriptLoader !== 'undefined' && ScriptLoader.ensureForPage) {
        await ScriptLoader.ensureForPage(pageId);
      }
      if (transitionSeq !== this._pageTransitionSeq || this.currentPage !== pageId) return;
      if ((loaded || []).length > 0 || hasRealtime) {
        this._renderPageContent(pageId);
      }
    } catch (err) {
      if (transitionSeq !== this._pageTransitionSeq || this.currentPage !== pageId) return;
      console.warn(`[Navigation] stale background refresh failed for ${pageId}:`, err);
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
    if (this._instantDeepLinkMode) return false;
    return pageId !== 'page-home';
  },

  async _freshCheckBeforeAction(collection, docId, cachedData) {
    if (typeof db === 'undefined') return { ok: false, reason: 'OFFLINE' };
    try {
      const doc = await Promise.race([
        db.collection(collection).doc(docId).get(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 3000)),
      ]);
      if (!doc.exists) return { ok: false, reason: 'NOT_FOUND' };
      const freshData = doc.data();
      freshData.id = doc.id;
      const changed = JSON.stringify(freshData) !== JSON.stringify(cachedData);
      return { ok: true, changed, freshData };
    } catch (err) {
      if (err.message === 'TIMEOUT') {
        return { ok: false, reason: 'TIMEOUT' };
      }
      return { ok: false, reason: 'OFFLINE' };
    }
  },

  async _ensurePageHtmlReady(pageId) {
    if (typeof PageLoader !== 'undefined' && PageLoader.ensurePage) {
      await PageLoader.ensurePage(pageId);
    }
    if (!document.getElementById(pageId)) {
      throw new Error(`Page element missing: ${pageId}`);
    }
    if (typeof ScriptLoader !== 'undefined' && ScriptLoader.ensureForPage) {
      await ScriptLoader.ensureForPage(pageId);
    }
  },

  _isCurrentUserRestricted() {
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
    // stale-first 快取捷徑：有快取時只載 HTML + JS，跳過 cloud + data 等待
    const canStale = this._getPageStrategy(pageId) === 'stale-first'
      && this._hasCachedDataForPage(pageId);

    if (!canStale && this._pageNeedsCloud(pageId) && typeof this.ensureCloudReady === 'function') {
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

    if (canStale) {
      // 背景刷新：不阻塞頁面渲染
      void this._refreshStalePage(pageId, this._pageTransitionSeq);
    } else if (!this._instantDeepLinkMode
      && typeof FirebaseService !== 'undefined'
      && FirebaseService.ensureCollectionsForPage) {
      const contract = typeof PAGE_DATA_CONTRACT !== 'undefined' && PAGE_DATA_CONTRACT[pageId];
      const hasRealtime = contract && contract.realtime && contract.realtime.length > 0;
      await FirebaseService.ensureCollectionsForPage(pageId, {
        skipRealtimeStart: hasRealtime,
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

    const guardedPages = ['page-profile', 'page-teams', 'page-tournaments', 'page-messages', 'page-activities'];
    const authPending = typeof LineAuth !== 'undefined'
      && (
        (typeof LineAuth.isPendingLogin === 'function' && LineAuth.isPendingLogin())
        || (typeof LineAuth.hasLiffSession === 'function' && LineAuth.hasLiffSession() && !LineAuth._ready)
      );

    const strategy = this._getPageStrategy(pageId);
    // 非 guarded 頁面（如活動詳情）即使 auth 正在初始化也允許 stale 導航
    const staleAuthPending = guardedPages.includes(pageId) ? authPending : false;
    const canUseStale = (strategy === 'stale-first' || strategy === 'stale-confirm')
      && this._canUseStaleNavigation(pageId, { authPending: staleAuthPending });

    const needsCloudInit = this._pageNeedsCloud(pageId) && (!this._cloudReady || !!this._cloudReadyPromise);
    const shouldShowRouteLoading = pageId !== this.currentPage
      && typeof this._beginRouteLoading === 'function'
      && typeof this._endRouteLoading === 'function';
    const routeLoadingSeq = shouldShowRouteLoading
      ? this._beginRouteLoading({
          pageId,
          phase: authPending ? 'auth' : (needsCloudInit ? 'cloud' : 'page'),
          immediate: authPending,
          delayMs: canUseStale ? 500 : 220,
        })
      : 0;

    try {
      // 非 stale 路徑：需要雲端 + 登入 + 權限檢查
      if (!canUseStale
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

      // ── 首次登入守衛：缺少必填資料時攔截導航，強制彈出首次登入 modal ──
      if (this._pendingFirstLogin && !options.bypassFirstLoginGuard) {
        this._tryShowFirstLoginModal();
        return { ok: false, reason: 'first_login_pending' };
      }

      if (typeof this._canAccessPage === 'function' && !this._canAccessPage(pageId)) {
        if (options.suppressAccessDeniedToast) return { ok: false, reason: 'forbidden' };
        this.showToast('權限不足');
        return { ok: false, reason: 'forbidden' };
      }

      const transitionSeq = ++this._pageTransitionSeq;

      // 策略分派
      if (canUseStale) {
        return await this._showPageStale(pageId, transitionSeq, options);
      }
      if (strategy === 'prepare-first') {
        return await this._showPagePrepareFirst(pageId, transitionSeq, options);
      }
      // fresh-first（預設）+ 首次進入的 stale-first/stale-confirm 頁（無快取時 fallback）
      return await this._showPageFreshFirst(pageId, transitionSeq, options);
    } finally {
      this._endRouteLoading?.(routeLoadingSeq);
    }
  },

  async _showPageStale(pageId, transitionSeq, options) {
    this._cleanupBeforePageSwitch(pageId);
    this._pushPageHistory(pageId, options);
    // 確保動態腳本已載入，避免 _renderPageContent 呼叫尚未載入的函式
    if (typeof ScriptLoader !== 'undefined' && ScriptLoader.ensureForPage) {
      await ScriptLoader.ensureForPage(pageId);
    }
    const activated = this._activatePage(pageId, options);
    if (!activated) return { ok: false, reason: 'missing_target' };
    void this._refreshStalePage(pageId, transitionSeq);
    return { ok: true, pageId, staleFirst: true };
  },

  async _showPagePrepareFirst(pageId, transitionSeq, options) {
    try {
      // 準備 HTML + Script
      await this._awaitRouteStep(this._ensurePageHtmlReady(pageId), pageId, 'page');
      if (transitionSeq !== this._pageTransitionSeq) return { ok: false, reason: 'stale_transition' };

      // 確保雲端就緒
      if (this._pageNeedsCloud(pageId) && typeof this.ensureCloudReady === 'function') {
        await this._awaitRouteStep(
          this.ensureCloudReady({ reason: `prepare:${pageId}` }),
          pageId, 'cloud'
        );
      }
      if (transitionSeq !== this._pageTransitionSeq) return { ok: false, reason: 'stale_transition' };

      // 載入必要集合（instant deep link 模式跳過，避免未認證時 Firestore 權限錯誤）
      if (!this._instantDeepLinkMode && typeof FirebaseService !== 'undefined' && FirebaseService.ensureCollectionsForPage) {
        await FirebaseService.ensureCollectionsForPage(pageId, { skipRealtimeStart: true });
      }
      if (transitionSeq !== this._pageTransitionSeq) return { ok: false, reason: 'stale_transition' };
    } catch (err) {
      if (transitionSeq === this._pageTransitionSeq) {
        console.warn(`[Navigation] prepare-first ${pageId} 載入失敗:`, err);
        this.showToast(this._getRouteFailureToast(pageId, 'page', err));
      }
      return { ok: false, reason: 'load_failed', step: 'page', error: err };
    }

    this._cleanupBeforePageSwitch(pageId);
    this._pushPageHistory(pageId, options);
    const activated = this._activatePage(pageId, options);
    if (!activated) return { ok: false, reason: 'missing_target' };
    return { ok: true, pageId };
  },

  async _showPageFreshFirst(pageId, transitionSeq, options) {
    try {
      await this._awaitRouteStep(
        this._ensurePageEntryReady(pageId),
        pageId, 'page'
      );
    } catch (err) {
      if (transitionSeq === this._pageTransitionSeq) {
        console.warn(`[Navigation] 頁面 ${pageId} 載入失敗:`, err);
        this.showToast(this._getRouteFailureToast(pageId, 'page', err));
      }
      return { ok: false, reason: err?.code === 'route-step-timeout' ? 'route_timeout' : 'load_failed', step: 'page', error: err };
    }

    if (transitionSeq !== this._pageTransitionSeq) return { ok: false, reason: 'stale_transition' };
    this._cleanupBeforePageSwitch(pageId);
    this._pushPageHistory(pageId, options);
    const activated = this._activatePage(pageId, options);
    if (activated) {
      if (!options.suppressHashSync && location.hash !== '#' + pageId) location.hash = pageId;
      return { ok: true, pageId };
    }
    return { ok: false, reason: 'missing_target' };
  },

  _cleanupBeforePageSwitch(pageId) {
    // 清除待執行的 snapshot 背景渲染 timer，防止切頁後舊頁面渲染仍觸發
    if (typeof FirebaseService !== 'undefined') clearTimeout(FirebaseService._snapshotRenderTimer);
    // F4：離開活動詳情頁時強制清除翻牌動畫鎖，防止 _flipAnimating 卡死導致後續導航失效
    if (this.currentPage === 'page-activity-detail' && pageId !== 'page-activity-detail') {
      this._flipAnimating = false;
      this._flipAnimatingAt = 0;
    }
    if (this.currentPage === 'page-game' && pageId !== 'page-game' && this.destroyShotGamePage) {
      this.destroyShotGamePage();
    }
    if (this.currentPage === 'page-kick-game' && pageId !== 'page-kick-game' && this.destroyKickGamePage) {
      this.destroyKickGamePage();
    }
    if (this.currentPage === 'page-home' && pageId !== 'page-home') {
      this._cancelHomeDeferredRender?.();
      this.stopBannerCarousel?.();
      this._renderHomeVersionTag?.(false);
      // 暫停首頁無限循環動畫（跑馬燈、浮動廣告呼吸、遊戲卡片光效）
      document.getElementById('page-home')?.classList.add('home-paused');
    }
    if (this.currentPage === 'page-profile' && pageId !== 'page-profile') {
      this._destroyProfileScene?.();
    }
    // 離開俱樂部相關頁面：清理教育即時監聽
    // 教育子頁面（分組學員、簽到、行事曆等）保留 students listener
    const eduSubPages = ['page-team-detail', 'page-edu-students', 'page-edu-checkin', 'page-edu-calendar', 'page-edu-course-plan', 'page-edu-course-enrollment', 'page-edu-groups', 'page-edu-student-apply'];
    if (eduSubPages.includes(this.currentPage) && !eduSubPages.includes(pageId)) {
      this._cleanupEduListeners?.();
    }
    if (this.currentPage === 'page-teams' && pageId !== 'page-teams') {
      this._stopEduTeamsListener?.();
    }
  },

  _pushPageHistory(pageId, options) {
    if (options.resetHistory) {
      this.pageHistory = [];
    } else if (this.currentPage !== pageId) {
      this.pageHistory.push(this.currentPage);
    }
  },

  /** 根據頁面 ID 渲染對應內容 */
  _renderPageContent(pageId) {
    if (this.currentPage !== pageId) return;
    if (pageId === 'page-home') {
      document.getElementById('page-home')?.classList.remove('home-paused');
      this.renderAll();
      this.resetHomeHotEventsScroll?.();
    }
    if (pageId === 'page-activities') {
      // 不重設頁籤 — 保留用戶離開前的 _activityActiveTab（如「已結束」）
      this.renderActivityList?.();
    }
    if (pageId === 'page-achievements') this.renderAchievements();
    if (pageId === 'page-titles') this.renderTitlePage();
    if (pageId === 'page-my-activities') this.renderMyActivities?.();
    if (pageId === 'page-team-manage') this.renderTeamManage();
    if (pageId === 'page-admin-dashboard') this.renderDashboard();
    if (pageId === 'page-temp-participant-report' && this.renderParticipantQuerySharePage) {
      this.renderParticipantQuerySharePage();
    }
    if (pageId === 'page-personal-dashboard') this.renderPersonalDashboard?.();
    if (pageId === 'page-admin-auto-exp') this.renderAutoExpRules();
    if (pageId === 'page-scan') this.renderScanPage();
    if (pageId === 'page-qrcode') this.renderQrCodePage();
    if (pageId === 'page-game' && this.initShotGamePage) this.initShotGamePage();
    if (pageId === 'page-kick-game' && this.initKickGamePage) this.initKickGamePage();
    // 按需渲染：進入頁面時才渲染，減少啟動負擔
    if (pageId === 'page-teams') {
      this.renderTeamList?.();
      this._startEduTeamsListener?.();
    }
    if (pageId === 'page-messages') this.renderMessageList();
    if (pageId === 'page-tournaments') { this.renderTournamentTimeline(); }
    if (pageId === 'page-profile') { this.renderUserCard(); this.renderProfileData(); this.renderProfileFavorites(); if (this.renderActivityRecords) this.renderActivityRecords('all', 1); this._initProfileScene?.(); }
    if (pageId === 'page-shop') this.renderShop();
    if (pageId === 'page-leaderboard') this.renderLeaderboard?.();
    if (pageId === 'page-admin-users') this.renderAdminUsers();
    if (pageId === 'page-admin-banners') { this.renderBannerManage(); this.renderFloatingAdManage(); this.renderPopupAdManage(); this.renderSponsorManage(); this.renderShotGameAdManage(); this.renderBootBrandManage?.(); this.renderNewsToggle(); }
    if (pageId === 'page-admin-shop') this.renderShopManage();
    if (pageId === 'page-admin-messages') this.renderMsgManage();
    if (pageId === 'page-admin-notif') this.renderNotifSettings?.();
    if (pageId === 'page-admin-tournaments') this.renderTournamentManage();
    if (pageId === 'page-admin-achievements') this.renderAdminAchievements();
    if (pageId === 'page-admin-roles') this.renderRoleHierarchy();
    if (pageId === 'page-admin-inactive') this.renderInactiveData();
    if (pageId === 'page-admin-repair') this.renderUserCorrectionManager?.();
    if (pageId === 'page-admin-exp') { this.renderExpLogs(); }
    if (pageId === 'page-admin-announcements') this.renderAnnouncementManage();
    if (pageId === 'page-admin-games') { this.renderGameManage(); if (this.renderGameLogViewer) this.renderGameLogViewer(); }
    if (pageId === 'page-admin-themes') this.renderThemeManage();
    // 教育俱樂部詳情頁：返回時重繪教育區塊（需確認 listener 仍在且有教育區塊容器）
    if (pageId === 'page-team-detail' && this._eduDetailTeamId && document.getElementById('edu-member-section')) {
      this._renderEduMemberSection?.(this._eduDetailTeamId);
      if (document.getElementById('edu-group-list')) this.renderEduGroupList?.(this._eduDetailTeamId);
    }
    if (pageId === 'page-edu-groups' && this._eduCurrentTeamId) this.renderEduGroupList?.(this._eduCurrentTeamId);
    if (pageId === 'page-edu-students' && this._eduCurrentTeamId) {
      const gid = this._eduCurrentGroupId;
      if (gid) this.renderEduStudentList?.(this._eduCurrentTeamId, gid);
    }
    if (pageId === 'page-admin-logs' && this.renderAdminLogCenter) {
      this.renderAdminLogCenter(this._pendingAdminLogTab || this._adminLogActiveTab || 'operation');
    }
    if (pageId === 'page-admin-audit-logs' && this.renderAdminLogCenter) {
      this.renderAdminLogCenter('audit');
    }
    if (pageId === 'page-admin-error-logs' && this.renderAdminLogCenter) {
      this.renderAdminLogCenter('error');
    }

    /* 非預設語系時套用 data-i18n 翻譯 */
    if (typeof I18N !== 'undefined' && I18N.getLocale() !== 'zh-TW') {
      document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.dataset.i18n);
      });
    }
    /* 白屏卡住偵測：標記頁面內容已開始渲染 */
    window._contentReady = true;
    if (document.getElementById('content-stall-hint')) {
      document.getElementById('content-stall-hint').remove();
    }
  },

  async goBack() {
    if (this._isCurrentUserRestricted()) {
      this._handleRestrictedStateChange();
      return;
    }
    // 首次登入守衛：缺少必填資料時攔截返回導航
    if (this._pendingFirstLogin) {
      this._tryShowFirstLoginModal();
      return;
    }
    if (this.pageHistory.length > 0) {
      const prev = this.pageHistory.pop();
      // 清理當前頁面的資源（監聽器、動畫等）
      this._cleanupBeforePageSwitch(prev);
      if (typeof FirebaseService !== 'undefined'
        && typeof FirebaseService.ensureCollectionsForPage === 'function') {
        await FirebaseService.ensureCollectionsForPage(prev);
      }
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.getElementById(prev).classList.add('active');
      this.currentPage = prev;
      if (typeof FirebaseService !== 'undefined'
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

  // ── 首次登入 modal 顯示（Plan B：內聯到 index.html，不依賴 ScriptLoader）──
  _tryShowFirstLoginModal() {
    if (this._firstLoginShowing) return;
    var modal = document.getElementById('first-login-modal');
    if (!modal) { return; }  // 內聯後理論上永遠存在
    this._firstLoginShowing = true;
    try {
      this.initFirstLoginRegionPicker?.();
      this._populateBirthdaySelects?.('fl-birthday-y', 'fl-birthday-m', 'fl-birthday-d');
    } catch (e) {
      console.warn('[_tryShowFirstLoginModal] init error:', e);
    }
    this.showModal('first-login-modal');
    var overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.dataset.locked = '1';
  },

  showModal(id) { this.toggleModal(id); },

  toggleModal(id) {
    const modal = document.getElementById(id);
    const overlay = document.getElementById('modal-overlay');
    if (!modal) return;
    const isOpen = modal.classList.contains('open');
    if (isOpen) {
      // 鎖定中的 modal 不允許被 toggle 關閉
      if (overlay && overlay.dataset.locked === '1') return;
      modal.classList.remove('open');
      overlay.classList.remove('open');
    } else {
      // 開啟新 modal 時，不關閉帶有 locked 旗標的 modal
      var lockedOverlay = overlay && overlay.dataset.locked === '1';
      if (lockedOverlay) return;
      document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
      modal.classList.add('open');
      overlay.classList.add('open');
      modal.scrollTop = 0;
      const modalBody = modal.querySelector('.modal-body');
      if (modalBody) modalBody.scrollTop = 0;
    }
  },

  closeModal() {
    // 首次登入彈窗鎖定時不可關閉
    const overlay = document.getElementById('modal-overlay');
    if (overlay && overlay.dataset.locked === '1') return;
    document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
    overlay.classList.remove('open');
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

    // data-i18n 通用掃描器
    document.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });

    // Re-render drawer menu & dashboard if visible
    this.renderDrawerMenu();
    // Re-render current page for i18n updates
    if (this.currentPage === 'page-teams') this.renderTeamList?.();
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
