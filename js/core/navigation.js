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
    // 2026-04-20 診斷：記錄 scroll reset 的來源 stack trace，追查「詳情頁資料更新後跳頂」的真兇
    // 加 log 用意是下次用戶再遇到跳頂時，從 log 直接抓到呼叫者
    try {
      var _prevScroll = window.scrollY || window.pageYOffset || 0;
      if (_prevScroll > 50) {
        var _stack = (new Error().stack || '').split('\n').slice(2, 7).map(function(s){return s.trim()}).join(' | ');
        console.log('[Nav] _runPageScrollReset', (targetPage && targetPage.id) || '(no-target)',
          '| prevScroll:', _prevScroll, '| currentPage:', this.currentPage, '| caller:', _stack);
      }
    } catch (_) {}

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

  _canActivateBeforeCloud(pageId) {
    return pageId === 'page-tournaments'
      || pageId === 'page-activities'
      || pageId === 'page-teams';
  },

  _getPerformanceFlag(name, fallback = true) {
    try {
      if (typeof PERFORMANCE_FLAGS === 'undefined') return fallback;
      if (Object.prototype.hasOwnProperty.call(PERFORMANCE_FLAGS, name)) {
        return PERFORMANCE_FLAGS[name] !== false;
      }
    } catch (_) {}
    return fallback;
  },

  _getPerformanceLimit(name, fallback) {
    try {
      if (typeof PERFORMANCE_LIMITS !== 'undefined') {
        const value = Number(PERFORMANCE_LIMITS[name]);
        if (Number.isFinite(value)) return value;
      }
    } catch (_) {}
    return fallback;
  },

  _isFastShellListPage(pageId) {
    return pageId === 'page-activities'
      || pageId === 'page-teams'
      || pageId === 'page-tournaments';
  },

  _shouldUseShellFirstPage(pageId, options = {}) {
    if (!this._getPerformanceFlag('fastShellNavigation', true)) return false;
    if (options.disableShellFirst) return false;
    if (pageId === this.currentPage) return false;
    return this._isFastShellListPage(pageId);
  },

  _escapeShellText(value) {
    if (typeof escapeHTML === 'function') return escapeHTML(value == null ? '' : String(value));
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

    // 2026-04-19 diag: 抓出誰呼叫 _activatePage → this.currentPage = X
    const _prevPage = this.currentPage;
    if (_prevPage && _prevPage !== pageId) {
      const _stack = (new Error().stack || '').split('\n').slice(2, 6).map(function(s){return s.trim()}).join(' | ');
      console.log('[Nav] _activatePage:', _prevPage, '→', pageId, '| caller stack:', _stack);
    }

    // Lazy fragments can carry stale active classes; keep exactly one active page.
    document.querySelectorAll('.page.active').forEach(p => {
      if (p !== target) p.classList.remove('active');
    });
    target.classList.add('active');
    this.currentPage = pageId;
    this._syncBottomTabForPage?.(pageId);

    if (typeof FirebaseService !== 'undefined'
      && typeof FirebaseService.finalizePageScopedRealtimeForPage === 'function') {
      FirebaseService.finalizePageScopedRealtimeForPage(pageId);
    }

    if (!options.suppressHashSync && location.hash !== '#' + pageId) {
      if (typeof this._setRouteUrl === 'function') this._setRouteUrl(pageId, options);
      else location.hash = pageId;
    }

    // 2026-04-25：離開臨時參與報表頁時清掉 ?rid=、避免 refresh 又被拉回
    // 放在 _activatePage（所有 showPage 路徑共用入口）才能蓋到 stale + fresh 兩條路徑
    if (pageId !== 'page-temp-participant-report') {
      try {
        const _u = new URL(window.location.href);
        if (_u.searchParams.has('rid')) {
          _u.searchParams.delete('rid');
          history.replaceState(null, '', _u.pathname + (_u.search || '') + (_u.hash || ''));
        }
      } catch (_) {}
    }
    if (pageId !== 'page-tournament-detail') {
      this._clearTournamentDetailRouteParam?.();
    }

    this._floatAdOffset = 0;
    this._floatAdTarget = 0;
    requestAnimationFrame(() => { if (this._positionFloatingAds) this._positionFloatingAds(); });

    if (options.render !== false) this._renderPageContent(pageId);
    if (typeof FirebaseService !== 'undefined'
      && typeof FirebaseService.schedulePageScopedRealtimeForPage === 'function') {
      const contract = typeof PAGE_DATA_CONTRACT !== 'undefined' && PAGE_DATA_CONTRACT[pageId];
      if (contract && contract.realtime && contract.realtime.length > 0) {
        const realtimeOptions = pageId === 'page-tournaments' ? { delayMs: 0 } : undefined;
        FirebaseService.schedulePageScopedRealtimeForPage(pageId, realtimeOptions);
      }
    }
    // 2026-04-20：同頁重新 activate（例如 Background reload 完成觸發的 showPage(currentPage)）
    //             不該 reset scroll — 否則會把用戶滑到中間的位置強制拉回頂，造成畫面跳動
    if (options.resetScroll !== false && _prevPage !== pageId) this._resetPageScroll(pageId);

    // 2026-04-20：Page Lock — 進 detail 類頁設 10 秒鎖，離開則解鎖
    // 擋下「進頁後被自動機制拉走」的老 bug（深層次 showPage / pending route / poller）
    const _DETAIL_LOCK_PAGES = ['page-activity-detail', 'page-team-detail',
      'page-tournament-detail', 'page-user-card'];
    if (_DETAIL_LOCK_PAGES.indexOf(pageId) !== -1) {
      this._pageLockUntil = Date.now() + 10000;
    } else if (_prevPage !== pageId) {
      this._pageLockUntil = 0;
    }
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
    // v8 Blocker 2 Part 2：Tier 2 換帳號污染檢查（UI 層第一道）
    // 已登入但 LIFF profile 與 Firebase Auth uid 不一致（A 登出 LIFF 保留 Firebase Auth、B 換帳號）
    // 此時必須強制重登、避免 B 帶 A 的 uid 寫入
    // QA B1 修復：`auth?.currentUser` 前置守衛——Firebase Auth 尚未完成時（boot 瞬間）
    //            不跑此分支、避免誤觸「登入狀態異常」toast；由 _ensureAuth 後端層處理
    if (!this._isLoginRequired()
      && typeof LineAuth !== 'undefined'
      && typeof auth !== 'undefined'
      && auth?.currentUser
      && typeof LineAuth._isActiveAuthUidConsistent === 'function'
      && LineAuth._profile
      && !LineAuth._isActiveAuthUidConsistent()) {
      this.showToast('登入狀態異常、請重新登入');
      // 用 LIFF re-login 而非 logout+reload、避免打斷 in-flight writes
      if (action && typeof this._setPendingAuthAction === 'function') {
        this._setPendingAuthAction(action);
      }
      if (typeof LineAuth.login === 'function') LineAuth.login();
      return true;
    }
    if (!this._isLoginRequired()) return false;
    if (typeof this._requestLoginForAction === 'function' && action) {
      this._requestLoginForAction(action, options);
      return true;
    }
    return this._requireLogin();
  },

  /**
   * 2026-04-19 UX: 需要個人資料完整才能執行「寫入類」操作（報名/候補/加入俱樂部/
   * 建立活動/賽事報名等）。首次登入流程改為「可自由瀏覽、寫入才擋」：
   *  - _pendingFirstLogin 未設置 → 回傳 false 放行
   *  - 已設置 → 彈出首次登入 modal 並回傳 true，讓呼叫者中止本次動作
   * 用法：`if (this._requireProfileComplete()) return;`（在需要寫入的函式入口）
   */
  _requireProfileComplete() {
    if (!this._pendingFirstLogin) return false;
    this._tryShowFirstLoginModal();
    return true;
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
        // v8：延遲登入——活動/俱樂部/賽事改為訪客可瀏覽、只個人/訊息仍擋（見 js/config.js AUTH_REQUIRED_PAGES）
        const guardedPages = AUTH_REQUIRED_PAGES;
        if (guardedPages.includes(page) && this._requireProtectedActionLogin({ type: 'showPage', pageId: page }, {
          suppressToast: true,
        })) {
          return;
        }
        this.pageHistory = [];
        if (page === 'page-home') this.resetHomeEntryFilters?.();
        void this.showPage(page);
        document.querySelectorAll('.bot-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
      });
    });

    // 2026-04-20：全域記錄用戶主動操作時間戳，供 Page Lock 判斷是否用戶主動導航
    // touchstart + click 雙監聽（某些 WebView 不觸發 click 但有 touchstart）
    const _this = this;
    const _markTouched = function () { _this._userTouchedAt = Date.now(); };
    document.addEventListener('touchstart', _markTouched, { passive: true, capture: true });
    document.addEventListener('click', _markTouched, { passive: true, capture: true });
  },

  async _showPageShellFirst(pageId, transitionSeq, options = {}) {
    try {
      if (typeof PageLoader !== 'undefined' && PageLoader.ensurePage) {
        await this._awaitRouteStep(PageLoader.ensurePage(pageId), pageId, 'page');
      }
      if (transitionSeq !== this._pageTransitionSeq) return { ok: false, reason: 'stale_transition' };
      if (!document.getElementById(pageId)) return { ok: false, reason: 'missing_target' };

      this._cleanupBeforePageSwitch(pageId);
      this._pushPageHistory(pageId, options);
      const activated = this._activatePage(pageId, { ...options, render: false });
      if (!activated) return { ok: false, reason: 'missing_target' };

      if (typeof ScriptLoader !== 'undefined'
        && typeof ScriptLoader.isPageReady === 'function'
        && ScriptLoader.isPageReady(pageId)) {
        this._renderPageContent(pageId);
      }

      void this._continueShellFirstPage(pageId, transitionSeq);
      return { ok: true, pageId, shellFirst: true };
    } catch (err) {
      if (transitionSeq === this._pageTransitionSeq) {
        console.warn(`[Navigation] shell-first ${pageId} failed:`, err);
        this.showToast(this._getRouteFailureToast(pageId, 'page', err));
      }
      return { ok: false, reason: err?.code === 'route-step-timeout' ? 'route_timeout' : 'load_failed', step: 'page', error: err };
    }
  },

  async _continueShellFirstPage(pageId, transitionSeq) {
    try {
      if (typeof ScriptLoader !== 'undefined' && ScriptLoader.ensureForPage) {
        await ScriptLoader.ensureForPage(pageId);
      }
      if (transitionSeq !== this._pageTransitionSeq || this.currentPage !== pageId) return;
      this._renderPageContent(pageId);

      if (this._pageNeedsCloud(pageId)
        && !this._cloudReady
        && typeof this.ensureCloudReady === 'function') {
        await this.ensureCloudReady({ reason: `shell-first:${pageId}` }).catch(err => {
          console.warn(`[Navigation] shell-first cloud init failed for ${pageId}:`, err);
        });
      }
      if (transitionSeq !== this._pageTransitionSeq || this.currentPage !== pageId) return;

      if (!this._instantDeepLinkMode
        && typeof FirebaseService !== 'undefined'
        && typeof FirebaseService.ensureCollectionsForPage === 'function') {
        const contract = typeof PAGE_DATA_CONTRACT !== 'undefined' && PAGE_DATA_CONTRACT[pageId];
        const hasRealtime = contract && contract.realtime && contract.realtime.length > 0;
        const loaded = await FirebaseService.ensureCollectionsForPage(pageId, {
          skipRealtimeStart: hasRealtime,
        });
        if (transitionSeq !== this._pageTransitionSeq || this.currentPage !== pageId) return;
        if ((loaded || []).length > 0 || hasRealtime) this._renderPageContent(pageId);
      }
      if (typeof FirebaseService !== 'undefined'
        && typeof FirebaseService.schedulePageScopedRealtimeForPage === 'function') {
        FirebaseService.schedulePageScopedRealtimeForPage(pageId, { delayMs: 0 });
      }
    } catch (err) {
      if (transitionSeq !== this._pageTransitionSeq || this.currentPage !== pageId) return;
      console.warn(`[Navigation] shell-first continuation failed for ${pageId}:`, err);
    }
  },

  _isFastDetailRouteMethod(methodName) {
    return methodName === 'showEventDetail'
      || methodName === 'showTeamDetail'
      || methodName === 'showTournamentDetail';
  },

  async _showDetailRouteShell(pageId, methodName, args = []) {
    if (!this._getPerformanceFlag('fastShellNavigation', true)) return { ok: false, reason: 'disabled' };
    const id = String(args[0] || '').trim();
    const options = (args[1] && typeof args[1] === 'object') ? args[1] : {};
    if (!id || options.disableShellFirst) return { ok: false, reason: 'disabled' };

    try {
      const transitionSeq = ++this._pageTransitionSeq;
      if (typeof PageLoader !== 'undefined' && PageLoader.ensurePage) {
        await this._awaitRouteStep(PageLoader.ensurePage(pageId), pageId, 'page');
      }
      if (transitionSeq !== this._pageTransitionSeq) return { ok: false, reason: 'stale_transition' };
      if (!document.getElementById(pageId)) return { ok: false, reason: 'missing_target' };

      this._cleanupBeforePageSwitch(pageId);
      this._pushPageHistory(pageId, options);
      const activated = this._activatePage(pageId, { ...options, render: false, suppressHashSync: true });
      if (!activated) return { ok: false, reason: 'missing_target' };
      this._renderFastDetailShell(pageId, methodName, id);
      if (!options.suppressHashSync && typeof this._setRouteUrl === 'function') {
        this._setRouteUrl({ pageId, id }, { mode: this._hasLegacyRouteSignal?.() ? 'replace' : undefined });
      }
      return { ok: true, pageId, id, shellFirst: true };
    } catch (err) {
      console.warn(`[Navigation] detail shell failed for ${methodName}:`, err);
      return { ok: false, reason: 'load_failed', error: err };
    }
  },

  _renderShellImage(container, imageUrl, label) {
    if (!container) return;
    const safeLabel = this._escapeShellText(label || '');
    const safeUrl = this._escapeShellText(imageUrl || '');
    if (safeUrl) {
      container.innerHTML = `<img src="${safeUrl}" alt="${safeLabel}" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:var(--radius)">`;
      container.style.border = 'none';
    } else {
      container.textContent = label || '';
      container.style.border = '';
    }
  },

  _renderFastDetailShell(pageId, methodName, id) {
    if (methodName === 'showEventDetail') return this._renderFastEventDetailShell(id);
    if (methodName === 'showTeamDetail') return this._renderFastTeamDetailShell(id);
    if (methodName === 'showTournamentDetail') return this._renderFastTournamentDetailShell(id);
    return null;
  },

  _renderFastEventDetailShell(id) {
    const event = (typeof ApiService !== 'undefined' && ApiService.getEvent?.(id)) || null;
    this._currentDetailEventId = id;
    this._currentDetailEventRecord = event || null;
    const title = document.getElementById('detail-title');
    if (title) title.textContent = event?.title || '活動詳情';
    const img = document.getElementById('detail-img-placeholder');
    const imageUrl = event?.imageVariants?.cover || event?.image || '';
    this._renderShellImage(img, imageUrl, event?.title || '活動封面');
    const body = document.getElementById('detail-body');
    if (body) {
      const location = event?.location ? `<div class="detail-row detail-row-wide"><span class="detail-label">地點</span>${this._escapeShellText(event.location)}</div>` : '';
      const date = event?.date ? `<div class="detail-row detail-row-wide"><span class="detail-label">時間</span>${this._escapeShellText(event.date)}</div>` : '';
      body.innerHTML = `${location}${date}<div class="detail-section"><div class="reg-loading">資料更新中...</div><div class="reg-loading-skeleton"><div class="reg-loading-skeleton-row"></div><div class="reg-loading-skeleton-row"></div></div></div>`;
    }
    document.getElementById('detail-view-count-num')?.replaceChildren(document.createTextNode(String(event?.viewCount || 0)));
  },

  _renderFastTeamDetailShell(id) {
    const team = (typeof ApiService !== 'undefined' && ApiService.getTeam?.(id)) || null;
    this._teamDetailId = id;
    const useV2 = typeof isTeamDetailV2Enabled === 'function' && isTeamDetailV2Enabled();
    document.getElementById('page-team-detail')?.classList.toggle('td-v2-active', !!useV2);
    const title = document.getElementById('team-detail-title');
    if (title) title.textContent = team?.name || '俱樂部詳情';
    const nameEn = document.getElementById('team-detail-name-en');
    if (nameEn) nameEn.textContent = team?.nameEn || '';
    const img = document.getElementById('team-detail-img');
    if (useV2) {
      if (img) img.innerHTML = '';
    } else {
      const imageUrl = team?.imageVariants?.cover || team?.image || '';
      this._renderShellImage(img, imageUrl, team?.name || '俱樂部封面');
    }
    const body = document.getElementById('team-detail-body');
    if (body) {
      body.innerHTML = useV2
        ? '<div class="td-v2-shell td-v2-fast-shell" aria-busy="true" aria-live="polite"><div class="td-v2-fast-loading-card"><span class="td-v2-fast-spinner" aria-hidden="true"></span><span class="td-v2-fast-copy"><strong>資料更新中</strong><small>正在同步俱樂部最新資料</small></span></div><div class="td-v2-fast-skeleton" aria-hidden="true"><span class="td-v2-fast-skeleton-row"></span><span class="td-v2-fast-skeleton-row"></span><span class="td-v2-fast-skeleton-row"></span></div></div>'
        : '<div class="detail-section team-fast-loading" aria-busy="true" aria-live="polite"><div class="reg-loading team-fast-loading-status"><span class="team-fast-loading-text"><strong>資料更新中</strong><small>正在同步俱樂部最新資料</small></span></div><div class="reg-loading-skeleton team-fast-loading-skeleton" aria-hidden="true"><div class="reg-loading-skeleton-row"></div><div class="reg-loading-skeleton-row"></div><div class="reg-loading-skeleton-row"></div></div></div>';
    }
  },

  _renderFastTournamentDetailShell(id) {
    const tournament = (typeof ApiService !== 'undefined' && ApiService.getTournament?.(id)) || null;
    this.currentTournament = id;
    const title = document.getElementById('td-title');
    if (title) title.textContent = tournament?.name || '賽事詳情';
    this._renderShellImage(
      document.getElementById('td-img-placeholder'),
      tournament?.image || '',
      tournament?.name || '賽事封面'
    );
    const registerArea = document.getElementById('td-register-area');
    if (registerArea) registerArea.innerHTML = '<div class="reg-loading">資料更新中...</div>';
    const info = document.getElementById('td-info-section');
    if (info) {
      const type = tournament?.type ? `<div class="detail-row"><span class="detail-label">類型</span>${this._escapeShellText(tournament.type)}</div>` : '';
      info.innerHTML = `${type}<div class="reg-loading-skeleton"><div class="reg-loading-skeleton-row"></div><div class="reg-loading-skeleton-row"></div></div>`;
    }
    const content = document.getElementById('tournament-content');
    if (content) content.innerHTML = '<div class="reg-loading">資料更新中...</div>';
  },

  _scheduleVisibleDetailPrefetch(collectionName, ids) {
    if (!this._getPerformanceFlag('visibleCardPrefetch', true)) return;
    if (!collectionName || !Array.isArray(ids) || ids.length === 0) return;
    if (typeof FirebaseService === 'undefined' || typeof FirebaseService.prefetchDocs !== 'function') return;
    if (!this._visibleDetailPrefetchTimers) this._visibleDetailPrefetchTimers = {};
    clearTimeout(this._visibleDetailPrefetchTimers[collectionName]);
    const delayMs = this._getPerformanceLimit('visibleCardPrefetchDelayMs', 650);
    const limit = this._getPerformanceLimit('visibleCardPrefetchLimit', 8);
    this._visibleDetailPrefetchTimers[collectionName] = setTimeout(() => {
      delete this._visibleDetailPrefetchTimers[collectionName];
      FirebaseService.prefetchDocs(collectionName, ids, { limit }).catch(err => {
        console.warn('[Navigation] visible detail prefetch failed:', collectionName, err);
      });
    }, delayMs);
  },

  async _ensurePageEntryReady(pageId) {
    // stale-first 快取捷徑：有快取時只載 HTML + JS，跳過 cloud + data 等待
    const canStale = this._getPageStrategy(pageId) === 'stale-first'
      && this._hasCachedDataForPage(pageId);
    const canActivateBeforeCloud = this._canActivateBeforeCloud(pageId);

    if (!canStale
      && !canActivateBeforeCloud
      && this._pageNeedsCloud(pageId)
      && typeof this.ensureCloudReady === 'function') {
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

    if (canActivateBeforeCloud
      && !this._cloudReady
      && typeof this.ensureCloudReady === 'function') {
      void this.ensureCloudReady({ reason: `shell:${pageId}` })
        .then(() => {
          if (this.currentPage !== pageId || typeof FirebaseService === 'undefined') return;
          if (typeof FirebaseService.ensureCollectionsForPage === 'function') {
            void FirebaseService.ensureCollectionsForPage(pageId, { skipRealtimeStart: true }).catch(() => {});
          }
          if (typeof FirebaseService.schedulePageScopedRealtimeForPage === 'function') {
            FirebaseService.schedulePageScopedRealtimeForPage(pageId, { delayMs: 0 });
          }
        })
        .catch(err => {
          console.warn(`[Navigation] shell cloud init failed for ${pageId}:`, err);
        });
    }
  },

  async _invokeLazyRouteMethod(pageId, methodName, args = []) {
    const gateway = this._lazyRouteGateways && this._lazyRouteGateways[methodName];
    const currentMethod = this[methodName];

    if (typeof currentMethod === 'function' && (!gateway || currentMethod !== gateway)) {
      return await currentMethod.apply(this, args);
    }

    if (gateway && this._isFastDetailRouteMethod(methodName)) {
      const shellResult = await this._showDetailRouteShell(pageId, methodName, args);
      if (shellResult?.ok) {
        const options = (args[1] && typeof args[1] === 'object') ? args[1] : {};
        args[1] = {
          ...options,
          skipPageHistory: true,
          bypassPageLock: true,
        };
      }
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

  async showTournamentDetail(id, options = {}) {
    if (!options.allowGuest && this._requireLogin()) return { ok: false, reason: 'auth' };
    return await this._invokeLazyRouteMethod('page-tournament-detail', 'showTournamentDetail', [id, options]);
  },

  goToScanForEvent(eventId) {
    if (this._requireProtectedActionLogin({ type: 'goToScanForEvent', eventId }, {
      suppressToast: true,
    })) {
      return;
    }
    // Keep the entrypoint in core so event detail can route to the lazy scan module safely.
    const presetId = String(eventId || '').trim();
    const detailEvent = this._currentDetailEventRecord || null;
    const detailEventId = detailEvent
      ? String(detailEvent.id || detailEvent._docId || detailEvent.docId || '').trim()
      : '';
    const presetEvent = presetId && typeof ApiService !== 'undefined'
      ? (ApiService.getEvent?.(presetId) || (detailEventId === presetId ? detailEvent : null))
      : null;
    this._scanPresetEventId = presetId || null;
    this._scanPresetEventRecord = presetEvent;
    this._scanSelectedEventRecord = presetEvent;
    void this.showPage('page-scan');
  },

  async showPage(pageId, options = {}) {
    const normalizedRoute = this._normalizeAdminLogRoute(pageId, options);
    pageId = normalizedRoute.pageId;

    // 2026-04-20: 用戶意圖頁面追蹤（修正「刷新後被拉回上次頁」的 race condition）
    // 非 boot flush 自身呼叫才更新（避免 flush 的 showPage 反向設為自己的目標頁）
    if (!options.fromBootFlush && pageId) {
      this._userIntendedPage = pageId;
    }

    // 2026-04-20：Page Lock — 防止用戶進 detail 類頁後被自動機制拉走
    // 規則：用戶近期 800ms 內有 touch/click → 視為主動導航，放行
    //       否則在鎖期間（10s），非同頁的 showPage 一律擋下
    //       顯式繞過可傳 options.bypassPageLock = true
    if (this._pageLockUntil && Date.now() < this._pageLockUntil
      && pageId !== this.currentPage
      && !options.bypassPageLock) {
      const recentlyTouched = this._userTouchedAt
        && (Date.now() - this._userTouchedAt < 800);
      if (!recentlyTouched) {
        console.log('[Nav] showPage blocked by page lock:', pageId,
          '| currentPage:', this.currentPage,
          '| lockExpires in:', Math.ceil((this._pageLockUntil - Date.now()) / 1000), 's');
        return { ok: false, reason: 'page_locked' };
      }
    }

    if (!options.bypassRestrictionGuard && this._isCurrentUserRestricted() && pageId !== 'page-home') {
      this._showRestrictedToast();
      return { ok: false, reason: 'restricted' };
    }

    // v8：延遲登入——見 js/config.js AUTH_REQUIRED_PAGES
    const guardedPages = AUTH_REQUIRED_PAGES;
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

    const needsCloudInit = !this._canActivateBeforeCloud(pageId)
      && this._pageNeedsCloud(pageId)
      && (!this._cloudReady || !!this._cloudReadyPromise);
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

    // 2026-04-20：記錄進入 showPage 時的 currentPage，供 await 後比對。
    // 若 await ensureCloudReady 期間用戶主動導航（例如 boot hash 卡住時用戶點其他頁），
    // 需放棄本次切頁，不可強制拉回。
    const _showPageStartingPage = this.currentPage;

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
        // 2026-04-20：cloud init 期間用戶可能已主動導航到其他頁面，
        // 若 currentPage 已變且不是本次目標 → 放棄，避免把用戶拉走
        if (this.currentPage !== _showPageStartingPage && this.currentPage !== pageId) {
          console.log('[Nav] showPage aborted after cloud init:',
            _showPageStartingPage, '→', this.currentPage, '— skip', pageId);
          return { ok: false, reason: 'user_navigated' };
        }
      }
      if (guardedPages.includes(pageId) && options.suppressLoginToast && this._isLoginRequired()) {
        return { ok: false, reason: 'login_required' };
      }
      if (guardedPages.includes(pageId) && this._requireLogin()) return { ok: false, reason: 'login_required' };

      // 2026-04-19 UX 調整：移除「_pendingFirstLogin 攔截導航」守衛。
      // 首次登入後允許用戶自由瀏覽，只在執行寫入類動作（報名/加入俱樂部/建立活動等）
      // 時由對應函式呼叫 _requireProfileComplete() 攔截。

      if (typeof this._canAccessPage === 'function' && !this._canAccessPage(pageId)) {
        if (options.suppressAccessDeniedToast) return { ok: false, reason: 'forbidden' };
        this.showToast('權限不足');
        return { ok: false, reason: 'forbidden' };
      }

      const transitionSeq = ++this._pageTransitionSeq;
      console.log('[Nav] showPage:', pageId, 'seq=', transitionSeq, 'currentPage=', this.currentPage, 'canUseStale=', canUseStale, 'strategy=', strategy);
      if (this._shouldUseShellFirstPage(pageId, options)) {
        return await this._showPageShellFirst(pageId, transitionSeq, options);
      }

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
    // 2026-04-19 safeguard: 同 _showPageFreshFirst 策略
    const _startingPage = this.currentPage;
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

    // await 期間 currentPage 變化 = 用戶主動導航到其他頁面，放棄本次切頁
    if (this.currentPage !== _startingPage && this.currentPage !== pageId) {
      console.log('[Nav] _showPagePrepareFirst currentPage changed during await:',
        _startingPage, '→', this.currentPage, '— aborting show', pageId);
      return { ok: false, reason: 'user_navigated' };
    }
    this._cleanupBeforePageSwitch(pageId);
    this._pushPageHistory(pageId, options);
    const activated = this._activatePage(pageId, options);
    if (!activated) return { ok: false, reason: 'missing_target' };
    return { ok: true, pageId };
  },

  async _showPageFreshFirst(pageId, transitionSeq, options) {
    // 2026-04-19 safeguard: 記錄 await 開始時的 currentPage，await 完成後比對。
    // 只有「currentPage 在 await 期間實際變化且變到 pageId 以外」才視為用戶主動導航，
    // 避免誤擋正常的頁面切換（例如從 page-activities 切到 page-teams，
    // await 前 currentPage='page-activities'，結束後仍是 'page-activities'，不該擋）
    const _startingPage = this.currentPage;
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
    // await 期間 currentPage 變化 = 用戶主動導航到其他頁面（例如 boot 時 showPage
    // 被用戶點擊搶先完成），放棄本次切頁。
    if (this.currentPage !== _startingPage && this.currentPage !== pageId) {
      console.log('[Nav] _showPageFreshFirst currentPage changed during await:',
        _startingPage, '→', this.currentPage, '— aborting show', pageId);
      return { ok: false, reason: 'user_navigated' };
    }
    this._cleanupBeforePageSwitch(pageId);
    this._pushPageHistory(pageId, options);
    const activated = this._activatePage(pageId, options);
    if (activated) {
      if (!options.suppressHashSync && location.hash !== '#' + pageId) {
        if (typeof this._setRouteUrl === 'function') this._setRouteUrl(pageId, options);
        else location.hash = pageId;
      }
      return { ok: true, pageId };
    }
    return { ok: false, reason: 'missing_target' };
  },

  _cleanupBeforePageSwitch(pageId) {
    // 清除待執行的 snapshot 背景渲染 timer，防止切頁後舊頁面渲染仍觸發
    if (typeof FirebaseService !== 'undefined') clearTimeout(FirebaseService._snapshotRenderTimer);
    if (pageId === 'page-activities') {
      this._clearTimelineCardNavigationState?.('enter-activities');
    }
    // F4：離開活動詳情頁時強制清除翻牌動畫鎖，防止 _flipAnimating 卡死導致後續導航失效
    if (this.currentPage === 'page-activity-detail' && pageId !== 'page-activity-detail') {
      this._flipAnimating = false;
      this._flipAnimatingAt = 0;
      // 離開活動詳細頁 → 自動退出編輯模式（報名 / 候補 / 未報名掃碼）
      // instant save 已逐筆寫入、flush 處理剩餘 debounce、候補無待存資料
      if (typeof this._autoExitDetailEdits === 'function') this._autoExitDetailEdits();
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
      this._profileDeferredSeq = (this._profileDeferredSeq || 0) + 1;
      this._destroyProfileScene?.();
    }
    // 離開俱樂部相關頁面：清理教育即時監聽
    // 教育子頁面（分組學員、簽到、行事曆等）保留 students listener
    if (this.currentPage === 'page-team-detail' && pageId !== 'page-team-detail') {
      this._completeTeamMemberManagement?.(this._teamDetailId);
      this._cleanupTeamDetailV2Runtime?.(this._teamDetailId);
    }
    const eduSubPages = ['page-team-detail', 'page-edu-students', 'page-edu-checkin', 'page-edu-calendar', 'page-edu-course-plan', 'page-edu-course-enrollment', 'page-edu-groups', 'page-edu-student-apply'];
    if (eduSubPages.includes(this.currentPage) && !eduSubPages.includes(pageId)) {
      this._cleanupEduListeners?.();
    }
    if (this.currentPage === 'page-teams' && pageId !== 'page-teams') {
      this._stopEduTeamsListener?.();
    }
  },

  _pushPageHistory(pageId, options) {
    // Phase 6 Commit A:popstate-driven 切頁帶 skipPageHistory=true,避免污染站內返回 stack
    if (options.skipPageHistory) return;
    if (options.resetHistory) {
      this.pageHistory = [];
    } else if (this.currentPage !== pageId) {
      this.pageHistory.push(this.currentPage);
    }
  },

  /** 根據頁面 ID 渲染對應內容 */
  _scheduleProfileDeferredWork() {
    const seq = (this._profileDeferredSeq || 0) + 1;
    this._profileDeferredSeq = seq;
    const stillCurrent = () => seq === this._profileDeferredSeq && this.currentPage === 'page-profile';
    const runWhenIdle = (task, options = {}) => {
      const delayMs = options.delayMs || 0;
      const timeout = options.timeout || 1500;
      const fallbackDelayMs = options.fallbackDelayMs != null ? options.fallbackDelayMs : 600;
      const runner = () => {
        if (!stillCurrent()) return;
        try {
          const result = task();
          if (result && typeof result.catch === 'function') {
            result.catch(err => { if (stillCurrent()) console.warn('[ProfileDeferred]', err); });
          }
        } catch (err) {
          if (stillCurrent()) console.warn('[ProfileDeferred]', err);
        }
      };
      const scheduleIdle = () => {
        if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
          window.requestIdleCallback(runner, { timeout });
        } else {
          setTimeout(runner, fallbackDelayMs);
        }
      };
      if (delayMs > 0) setTimeout(scheduleIdle, delayMs);
      else scheduleIdle();
    };

    runWhenIdle(async () => {
      if (!stillCurrent() || typeof ScriptLoader === 'undefined') return;
      await ScriptLoader.ensureGroup?.('achievementProfile');
      if (!stillCurrent()) return;
      this.renderProfileData?.();
    }, { timeout: 1200, fallbackDelayMs: 350 });

    runWhenIdle(() => {
      if (this.renderActivityRecords) this.renderActivityRecords('all', 1);
    }, { delayMs: 120, timeout: 900, fallbackDelayMs: 120 });

    runWhenIdle(async () => {
      if (!stillCurrent() || typeof ScriptLoader === 'undefined') return;
      await ScriptLoader.ensureGroup?.('profileScene');
      if (!stillCurrent()) return;
      this._initProfileScene?.();
    }, { delayMs: 450, timeout: 2500, fallbackDelayMs: 900 });
  },

  _renderPageContent(pageId) {
    if (this.currentPage !== pageId) return;
    if (pageId === 'page-home') {
      document.getElementById('page-home')?.classList.remove('home-paused');
      this.renderAll();
      this.resetHomeHotEventsScroll?.();
    }
    if (pageId === 'page-activities') {
      // 不重設頁籤 — 保留用戶離開前的 _activityActiveTab（如「已結束」/「月曆」）
      this._clearTimelineCardNavigationState?.('render-activities');
      this._applyActivityUrlFilters?.({ replace: true });
      this._syncActivityMapEntry?.();
      this.renderActivityList?.();
      // 月曆 tab 下返回頁面時重設到今日（用戶要求 2026-04-22、見 calendar-view-plan §12.M）
      if (this._activityActiveTab === 'calendar') {
        this._calendarCurrentMonthKey = null;
        this._calendarRenderedMonths?.clear?.();
        if (typeof this._renderActivityCalendar === 'function') {
          this._renderActivityCalendar();
        } else if (typeof this._loadAndRenderCalendar === 'function') {
          this._loadAndRenderCalendar();
        }
      }
    }
    if (pageId === 'page-achievements') this.renderAchievements();
    if (pageId === 'page-titles') this.renderTitlePage();
    if (pageId === 'page-my-activities') this.renderMyActivities?.();
    if (pageId === 'page-team-manage') this.renderTeamManage();
    if (pageId === 'page-admin-dashboard') this.renderDashboard();
    if (pageId === 'page-admin-seo') this.renderSeoDashboard?.();
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
    if (pageId === 'page-profile') {
      this.renderProfileData();
      this.renderProfileFavorites();
      this._scheduleProfileDeferredWork?.();
    }
    if (pageId === 'page-shop') this.renderShop();
    if (pageId === 'page-leaderboard') this.renderLeaderboard?.();
    if (pageId === 'page-admin-users') this.renderAdminUsers();
    if (pageId === 'page-admin-banners') { this.renderHomeLayoutManage?.({ resetFromData: true }); this.renderBannerManage(); this.renderWatchPartyBgManage?.(); this.renderHomeInfoManage?.(); this.renderFloatingAdManage(); this.renderPopupAdManage(); this.renderSponsorManage(); this.renderShotGameAdManage(); this.renderBootBrandManage?.(); this.renderNewsToggle(); this.renderActivityMapToggle?.(); }
    if (pageId === 'page-admin-shop') this.renderShopManage();
    if (pageId === 'page-admin-messages') this.renderMsgManage();
    if (pageId === 'page-admin-notif') this.renderNotifSettings?.();
    if (pageId === 'page-admin-tournaments') this.renderTournamentManage();
    if (pageId === 'page-admin-achievements') this.renderAdminAchievements();
    if (pageId === 'page-admin-roles') {
      this.renderRoleHierarchy();
      this.renderPermissionAuditShell?.();
    }
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
      // v4: 改用純同步 cache render、避免與 showEduStudentList 的 async race
      if (gid) this._renderEduStudentListFromCache?.(this._eduCurrentTeamId, gid);
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

    /* 非預設語系時套用靜態 i18n 翻譯 */
    if (typeof I18N !== 'undefined' && I18N.getLocale() !== 'zh-TW') {
      this._applyStaticI18n?.(document);
    }
    /* 白屏卡住偵測：標記頁面內容已開始渲染 */
    window._contentReady = true;
    if (document.getElementById('content-stall-hint')) {
      document.getElementById('content-stall-hint').remove();
    }

    // Phase 5.5: detail 頁交由 detail handler 在資料載入後呼叫，避免無 id 時誤寫 canonical
    if (typeof this._updateRouteMetaTags === 'function' && !/-detail$/.test(pageId)) {
      this._updateRouteMetaTags(pageId);
    }
  },

  async goBack() {
    if (this._isCurrentUserRestricted()) {
      this._handleRestrictedStateChange();
      return;
    }
    // 2026-04-19 UX 調整：移除返回導航的 _pendingFirstLogin 守衛，允許自由瀏覽。
    // 寫入類動作由對應函式的 _requireProfileComplete() 守衛負責攔截。
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
      if (prev === 'page-team-detail') {
        this._restoreTeamDetailV2ShellIfPresent?.(this._teamDetailId);
      }
      if (typeof FirebaseService !== 'undefined'
        && typeof FirebaseService.finalizePageScopedRealtimeForPage === 'function') {
        FirebaseService.finalizePageScopedRealtimeForPage(prev);
      }
      // 同步 URL hash(Phase 6 Commit A:改 push → replace,避免 browser history 隨 goBack 持續膨脹)
      if (location.hash !== '#' + prev) {
        if (typeof this._setRouteUrl === 'function') {
          this._setRouteUrl(prev, { mode: 'replace' });
        } else {
          history.replaceState(null, '', '#' + prev);
        }
      }
      this._syncBottomTabForPage?.(prev);
      if (prev !== 'page-tournament-detail') {
        this._clearTournamentDetailRouteParam?.();
      }
      this._renderPageContent(prev);
      this._resetPageScroll(prev);
    }
  },

  bindDrawer() {
    document.getElementById('menu-toggle').addEventListener('click', () => this.openDrawer());
    document.getElementById('drawer-overlay').addEventListener('click', () => this.closeDrawer());
  },

  openDrawer() {
    this._renderHomeVersionTag?.();
    document.getElementById('side-drawer').classList.add('open');
    document.getElementById('drawer-overlay').classList.add('open');
  },

  closeDrawer() {
    document.getElementById('side-drawer').classList.remove('open');
    document.getElementById('drawer-overlay').classList.remove('open');
  },

  _setFirstLoginOverlayState(enabled) {
    var overlay = document.getElementById('modal-overlay');
    if (!overlay) return;
    if (enabled) {
      overlay.dataset.locked = '1';
      overlay.dataset.profileComplete = '1';
      return;
    }
    delete overlay.dataset.locked;
    delete overlay.dataset.profileComplete;
  },

  _prefillFirstLoginModal(user) {
    user = user || ((typeof ApiService !== 'undefined' && ApiService.getCurrentUser) ? ApiService.getCurrentUser() : null);
    if (!user) return;

    var genderEl = document.getElementById('fl-gender');
    var regionEl = document.getElementById('fl-region-input');
    var emailEl = document.getElementById('fl-email');
    var legalEl = document.getElementById('fl-legal-consent');
    if (genderEl && !genderEl.value && user.gender) genderEl.value = user.gender;
    if (regionEl && !regionEl.value && user.region) regionEl.value = user.region;
    if (emailEl && !emailEl.value && user.email) emailEl.value = user.email;
    if (legalEl) legalEl.checked = false;
  },

  _lockFirstLoginScroll() {
    if (this._firstLoginScrollLocked) return;
    var body = document.body;
    var docEl = document.documentElement;
    if (!body || !docEl) return;

    var scrollY = window.pageYOffset || docEl.scrollTop || body.scrollTop || 0;
    this._firstLoginScrollLocked = true;
    this._firstLoginScrollY = scrollY;
    this._firstLoginBodyStyleSnapshot = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
    };

    docEl.classList.add('profile-complete-scroll-lock');
    body.classList.add('modal-open', 'profile-complete-scroll-lock');
    body.style.position = 'fixed';
    body.style.top = '-' + scrollY + 'px';
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
  },

  _unlockFirstLoginScroll() {
    var body = document.body;
    var docEl = document.documentElement;
    if (docEl) docEl.classList.remove('profile-complete-scroll-lock');
    if (body) body.classList.remove('profile-complete-scroll-lock', 'modal-open');

    if (!this._firstLoginScrollLocked || !body) return;
    var snapshot = this._firstLoginBodyStyleSnapshot || {};
    body.style.position = snapshot.position || '';
    body.style.top = snapshot.top || '';
    body.style.left = snapshot.left || '';
    body.style.right = snapshot.right || '';
    body.style.width = snapshot.width || '';

    var scrollY = Number(this._firstLoginScrollY || 0);
    this._firstLoginScrollLocked = false;
    this._firstLoginScrollY = 0;
    this._firstLoginBodyStyleSnapshot = null;
    try { window.scrollTo(0, scrollY); } catch (_) {}
  },

  // ── 首次登入 modal 顯示（Plan B：內聯到 index.html，不依賴 ScriptLoader）──
  _tryShowFirstLoginModal() {
    if (this._firstLoginShowing) return;
    var modal = document.getElementById('first-login-modal');
    if (!modal) { return; }  // 內聯後理論上永遠存在
    this._firstLoginShowing = true;
    var user = (typeof ApiService !== 'undefined' && ApiService.getCurrentUser) ? ApiService.getCurrentUser() : null;
    try {
      this.initFirstLoginRegionPicker?.();
      this._populateBirthdaySelects?.('fl-birthday-y', 'fl-birthday-m', 'fl-birthday-d', user?.birthday || '');
      this._prefillFirstLoginModal?.(user);
    } catch (e) {
      console.warn('[_tryShowFirstLoginModal] init error:', e);
    }
    this.showModal('first-login-modal');
    this._setFirstLoginOverlayState?.(true);
    this._lockFirstLoginScroll?.();
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
      if (overlay) overlay.classList.remove('open');
    } else {
      // 開啟新 modal 時，不關閉帶有 locked 旗標的 modal
      var lockedOverlay = overlay && overlay.dataset.locked === '1';
      if (lockedOverlay) return;
      document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
      modal.classList.add('open');
      if (overlay) overlay.classList.add('open');
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
    if (overlay) overlay.classList.remove('open');
  },

  /**
   * Modal 外圍空白處點擊 handler。
   * 2026-04-25：若當前開啟的 modal 有 data-no-backdrop-close="1"（建立流程），
   * 不關閉 modal、避免誤觸關閉填到一半的表單。其他 modal 維持原本「點外圍關閉」。
   */
  _handleModalBackdropClick(event) {
    if (event.target !== event.currentTarget) return;
    const openModal = document.querySelector('.modal.open[data-no-backdrop-close="1"]');
    if (openModal) return;
    this.closeModal();
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

  _applyStaticI18n(root) {
    if (typeof I18N === 'undefined' || typeof t !== 'function') return;
    const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    const resolveText = (key, fallback) => {
      if (!key) return fallback || '';
      const translated = t(key);
      return translated === key && fallback != null ? fallback : translated;
    };

    scope.querySelectorAll('[data-i18n]').forEach(el => {
      if (el.children && el.children.length > 0) return;
      const key = el.getAttribute('data-i18n');
      el.textContent = resolveText(key, el.textContent);
    });

    ['placeholder', 'title', 'aria-label', 'value'].forEach(attr => {
      const dataAttr = `data-i18n-${attr}`;
      scope.querySelectorAll(`[${dataAttr}]`).forEach(el => {
        const key = el.getAttribute(dataAttr);
        el.setAttribute(attr, resolveText(key, el.getAttribute(attr)));
      });
    });
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
    if (profilePageHeader) profilePageHeader.textContent = t('profile.myProfile');

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

    this._applyStaticI18n(document);

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
  showTournamentDetail: App.showTournamentDetail,
});
