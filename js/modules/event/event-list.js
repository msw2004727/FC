/* ================================================
   SportHub — Event: Tab Management & Hot Events Render
   依賴：config.js, api-service.js
   拆分檔案：event-list-helpers.js, event-list-stats.js,
             event-list-home.js, event-list-timeline.js
   ================================================ */

Object.assign(App, {

  _activityActiveTab: 'normal',
  _unavailableActivityTabs: ['beginner', 'high-intensity'],
  _hiddenActivityTabs: ['ended'],

  _normalizeActivityTab(tab) {
    return this._hiddenActivityTabs.includes(tab) ? 'normal' : (tab || 'normal');
  },

  _canCreateActivityByPermission() {
    const currentUser = ApiService.getCurrentUser?.();
    if (!currentUser || typeof this.hasPermission !== 'function') return false;
    return this._canCreateBasicActivity?.() || this._canCreateExternalActivity?.();
  },

  _isActivityCreateProfileComplete(user = null) {
    const currentUser = user || ApiService.getCurrentUser?.();
    if (!currentUser) return false;
    return ['gender', 'birthday', 'region'].every(key => String(currentUser[key] || '').trim());
  },

  _isActivityCreateProfileLocked() {
    const currentUser = ApiService.getCurrentUser?.();
    if (!currentUser) return false;
    return !!this._pendingFirstLogin || !this._isActivityCreateProfileComplete(currentUser);
  },

  _showActivityCreateProfileRequired() {
    this.showToast?.('請先完成個人資料，再建立活動。');
    this._pendingFirstLogin = true;
    this._tryShowFirstLoginModal?.();
  },

  _requireActivityCreateProfileComplete() {
    if (!this._isActivityCreateProfileLocked()) return false;
    this._showActivityCreateProfileRequired();
    return true;
  },

  _activityCreateEntryTimeoutMs: 20000,
  _activityCreateEntryPromise: null,
  _activityCreateEntryContext: null,
  _activityCreateEntryButtonStates: null,
  _activityCreateEntrySeq: 0,

  _setActivityCreateEntryBusy() {
    return ['activity-create-btn', 'my-activity-create-btn']
      .map(id => document.getElementById(id))
      .filter(Boolean)
      .map(button => {
        const state = {
          button,
          disabled: !!button.disabled,
          ariaBusy: button.getAttribute('aria-busy'),
        };
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        return state;
      });
  },

  _restoreActivityCreateEntryBusy(states = []) {
    states.forEach(state => {
      const button = state?.button;
      if (!button) return;
      button.disabled = !!state.disabled;
      if (state.ariaBusy == null) button.removeAttribute('aria-busy');
      else button.setAttribute('aria-busy', state.ariaBusy);
    });
  },

  async _waitForActivityCreateEntry(
    promise,
    timeoutMs = this._activityCreateEntryTimeoutMs,
    cancelPromise = null
  ) {
    const safeTimeoutMs = Math.max(1, Number(timeoutMs) || 20000);
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error('Activity create entry timeout');
        err.code = 'activity-create-entry-timeout';
        reject(err);
      }, safeTimeoutMs);
    });
    try {
      const candidates = [promise, timeout];
      if (cancelPromise && typeof cancelPromise.then === 'function') candidates.push(cancelPromise);
      return await Promise.race(candidates);
    } finally {
      if (timer != null) clearTimeout(timer);
    }
  },

  _isActivityCreateEntryCurrent(context) {
    if (!context || Number(context.requestSeq) !== Number(this._activityCreateEntrySeq)) return false;
    if (context.pageId && this.currentPage !== context.pageId) return false;
    if (Number.isSafeInteger(context.transitionSeq)
      && Number(context.transitionSeq) !== Number(this._pageTransitionSeq)) return false;
    return true;
  },

  _cancelActivityCreateEntry(reason = 'page-context-changed') {
    const entryPromise = this._activityCreateEntryPromise;
    const context = this._activityCreateEntryContext;
    const states = this._activityCreateEntryButtonStates || [];
    if (!entryPromise && !context && states.length === 0) return false;

    this._activityCreateEntrySeq += 1;
    if (context) context.cancelledReason = reason;
    this._activityCreateEntryPromise = null;
    this._activityCreateEntryContext = null;
    this._activityCreateEntryButtonStates = null;
    this._restoreActivityCreateEntryBusy(states);
    context?.cancel?.(false);
    return true;
  },

  async _runActivityCreateEntry(context) {
    try {
      if (typeof ScriptLoader === 'undefined' || typeof ScriptLoader.ensureGroup !== 'function') {
        throw new Error('Activity create loader unavailable');
      }
      await this._waitForActivityCreateEntry(
        ScriptLoader.ensureGroup('activityCreate'),
        this._activityCreateEntryTimeoutMs,
        context?.cancelPromise
      );
      if (!this._isActivityCreateEntryCurrent(context)) return false;
      if (typeof this.openCreateEventModal !== 'function') {
        throw new Error('Activity create module unavailable');
      }
      return await this.openCreateEventModal({
        entryGuard: () => this._isActivityCreateEntryCurrent(context),
      });
    } catch (err) {
      if (!this._isActivityCreateEntryCurrent(context)) return false;
      console.error('[ActivityCreateEntry] open failed:', err);
      this.showToast?.(
        err?.code === 'activity-create-entry-timeout'
          ? '活動建立功能載入逾時，請檢查網路後再試'
          : '活動建立功能載入失敗，請稍後再試'
      );
      return false;
    }
  },

  async openActivityCreateEvent() {
    if (this._activityCreateEntryPromise
      && this._isActivityCreateEntryCurrent(this._activityCreateEntryContext)) {
      return await this._activityCreateEntryPromise;
    }
    if (this._activityCreateEntryPromise || this._activityCreateEntryContext) {
      this._cancelActivityCreateEntry('stale-entry-retry');
    }
    let cancelEntry = null;
    const cancelPromise = new Promise(resolve => {
      cancelEntry = resolve;
    });
    const context = {
      requestSeq: ++this._activityCreateEntrySeq,
      pageId: this.currentPage || '',
      transitionSeq: Number.isSafeInteger(this._pageTransitionSeq)
        ? this._pageTransitionSeq
        : null,
      cancel: cancelEntry,
      cancelPromise,
    };
    if (!this._activityCreateEntryButtonStates) {
      this._activityCreateEntryButtonStates = this._setActivityCreateEntryBusy();
    }
    this._beginSwLazyContinuation?.();
    const workPromise = this._runActivityCreateEntry(context);
    const entryPromise = Promise.race([workPromise, cancelPromise]);
    this._activityCreateEntryPromise = entryPromise;
    this._activityCreateEntryContext = context;
    try {
      return await entryPromise;
    } finally {
      this._endSwLazyContinuation?.('activity-create-entry-complete');
      if (this._activityCreateEntryPromise === entryPromise) {
        this._activityCreateEntryPromise = null;
        this._activityCreateEntryContext = null;
        this._restoreActivityCreateEntryBusy(this._activityCreateEntryButtonStates || []);
        this._activityCreateEntryButtonStates = null;
      }
    }
  },

  _refreshActivityCreateButton() {
    const canCreate = this._canCreateActivityByPermission();
    const profileLocked = canCreate && this._isActivityCreateProfileLocked();
    const buttonSet = new Set([
      ...['activity-create-btn', 'my-activity-create-btn']
        .map(id => document.getElementById(id))
        .filter(Boolean),
      ...document.querySelectorAll('.home-create-event-btn'),
    ]);

    buttonSet.forEach(button => {
      button.style.display = canCreate ? '' : 'none';
      button.classList.toggle('activity-create-profile-locked', !!profileLocked);
      button.setAttribute('aria-disabled', profileLocked ? 'true' : 'false');
      if (profileLocked) {
        button.dataset.profileIncomplete = '1';
        button.title = '請先完成個人資料，再建立活動';
      } else {
        delete button.dataset.profileIncomplete;
        button.removeAttribute('title');
      }
    });
  },

  resetHomeHotEventsScroll() {
    const container = document.getElementById('hot-events');
    if (!container) return;

    const prevBehavior = container.style.scrollBehavior;
    container.style.scrollBehavior = 'auto';
    container.scrollLeft = 0;
    requestAnimationFrame(() => {
      container.style.scrollBehavior = prevBehavior;
    });
  },

  _setActivityTab(tab, options = {}) {
    const { render = true } = options;
    tab = this._normalizeActivityTab(tab);
    this._activityActiveTab = tab;
    document.querySelectorAll('#activity-tabs .tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.atab === tab);
    });
    this._syncActivityFemaleTheme?.(tab);
    if (options.syncUrl !== false && this.currentPage === 'page-activities' && !this._applyingActivityUrlFilters) {
      this._syncActivityUrlFilters?.({ replace: true });
    }
    // 容器顯示切換（timeline 與月曆互斥）
    const listEl = document.getElementById('activity-list');
    const calEl = document.getElementById('activity-calendar');
    if (tab === 'calendar') {
      if (listEl) listEl.hidden = true;
      if (calEl) calEl.hidden = false;
      try { window.scrollTo(0, 0); } catch (_) {}
      // 切換到月曆 tab 時重設到今日（用戶要求 2026-04-22）
      App._calendarCurrentMonthKey = null;
      App._calendarRenderedMonths?.clear?.();
      if (render) this._loadAndRenderCalendar();
      return;
    }
    if (listEl) listEl.hidden = false;
    if (calEl) calEl.hidden = true;
    if (render) this.renderActivityList?.();
  },

  /** 月曆 tab lazy-load：首次切才載入對應 scripts（見 calendar-view-plan §5 方案 A） */
  _loadAndRenderCalendar() {
    // 若模組已載入，直接 render（同步、不走防抖）
    if (typeof App._renderActivityCalendar === 'function') {
      try { App._renderActivityCalendar(); } catch (err) { console.error('[Calendar] render failed:', err); }
      return;
    }
    // 尚未載入：動態載入群組
    if (typeof ScriptLoader === 'undefined' || !ScriptLoader._groups?.activityCalendar) {
      console.error('[Calendar] script-loader unavailable');
      this.showToast?.('月曆載入失敗，請重試');
      return;
    }
    ScriptLoader.loadGroup(ScriptLoader._groups.activityCalendar)
      .then(() => { try { App._renderActivityCalendar?.(); } catch (e) { console.error('[Calendar] render failed:', e); } })
      .catch(err => {
        console.error('[Calendar] load failed:', err);
        this.showToast?.('月曆載入失敗，請重試');
      });
  },

  switchActivityTab(tab, event) {
    tab = this._normalizeActivityTab(tab);
    if (this._unavailableActivityTabs.includes(tab)) {
      event?.preventDefault?.();
      event?.stopImmediatePropagation?.();
      this.showToast?.('功能尚未開放');
      document.querySelectorAll('#activity-tabs .tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.atab === this._activityActiveTab);
      });
      this._syncActivityFemaleTheme?.(this._activityActiveTab);
      return false;
    }
    this._setActivityTab(tab);
    return true;
  },

  resetActivityTab(options = {}) {
    this._setActivityTab('normal', options);
  },

  // ══════════════════════════════════
  //  Heat Prediction
  // ══════════════════════════════════

  _renderHeatPrediction(e) {
    if (e.status === 'ended' || e.status === 'cancelled') return '';
    const pred = this._calcHeatPrediction(e);
    if (!pred) return '';
    const colors = { hot: '#dc2626', warm: '#f59e0b', normal: '#3b82f6', cold: '#059669' };
    const labels = { hot: '高人氣即將額滿', warm: '報名熱烈增加中', normal: '穩定開放報名中', cold: '潛力場次招募中' };
    return `<div class="detail-row"><span class="detail-label">熱度</span><span style="color:${colors[pred]};font-weight:600;white-space:nowrap">${labels[pred]}</span></div>`;
  },

  _calcHeatPrediction(e) {
    if (!e.max || e.max === 0) return null;
    const fillRate = e.current / e.max;
    const start = this._parseEventStartDate(e.date);
    if (!start) return fillRate >= 0.8 ? 'hot' : fillRate >= 0.5 ? 'warm' : 'normal';
    const now = new Date();
    const daysLeft = Math.max(0, (start - now) / 86400000);
    // High fill rate + lots of time left = very hot
    if (fillRate >= 0.9) return 'hot';
    if (fillRate >= 0.7 && daysLeft > 3) return 'hot';
    if (fillRate >= 0.5) return 'warm';
    if (fillRate >= 0.3 && daysLeft > 7) return 'warm';
    if (fillRate < 0.15 && daysLeft < 3) return 'cold';
    return 'normal';
  },

  // ══════════════════════════════════
  //  Render: Hot Events
  // ══════════════════════════════════

  renderHotEvents() {
    this._autoEndExpiredEvents();
    this.renderHomeGameShortcut();
    const container = document.getElementById('hot-events');
    if (!container) return;
    // 2026-04-20：冷啟動載入指示器（skel-hint + progress-bar），cloud ready 後隱藏
    const _loadingIndicator = document.getElementById('hot-events-loading');
    const _hideLoading = () => { if (_loadingIndicator) _loadingIndicator.style.display = 'none'; };
    const _showLoading = () => { if (_loadingIndicator) _loadingIndicator.style.display = ''; };
    // 顯示最近 10 場未結束活動（依日期排序）
    const visible = this._filterBySportTag(this._filterByRegionTab(this._getVisibleEvents()))
      .filter(e => e.status !== 'ended' && e.status !== 'cancelled')
      .sort((a, b) => {
        const ap = a?.pinned ? 1 : 0;
        const bp = b?.pinned ? 1 : 0;
        if (ap !== bp) return bp - ap;
        if (ap && bp) {
          const ao = Number(a?.pinOrder) || 0;
          const bo = Number(b?.pinOrder) || 0;
          if (ao !== bo) return ao - bo;
        }
        const da = this._parseEventStartDate(a.date);
        const db = this._parseEventStartDate(b.date);
        return (da || 0) - (db || 0);
      })
      .slice(0, (typeof NetDevice !== 'undefined' && NetDevice.shouldDegrade()) ? 6 : 10);
    if (visible.length === 0) {
      this._hotEventsLastFp = '';
      if (!this._cloudReady) {
        // 冷啟動：保留 home.html 預設的骨架 + loading indicator（不動）
        this._setHomeSectionVisibility(container, true);
        _showLoading();
      } else if (App._activeSport && App._activeSport !== 'all') {
        // Cloud ready 但無資料：隱藏 loading indicator
        _hideLoading();
        const sportLabel = (typeof EVENT_SPORT_OPTIONS !== 'undefined' ? EVENT_SPORT_OPTIONS : []).find(o => o.key === App._activeSport)?.label || App._activeSport;
        this._setHomeSectionVisibility(container, true);
        container.innerHTML = `<div style="text-align:center;padding:1.5rem 0;color:var(--text-secondary);font-size:.82rem">目前沒有${escapeHTML(sportLabel)}相關活動</div>`;
      } else {
        // Cloud ready 無資料無 filter：隱藏 loading indicator + 隱藏整個 section
        _hideLoading();
        this._setHomeSectionVisibility(container, false);
        container.textContent = '';
      }
      return;
    }
    // 有資料：隱藏 loading indicator，顯示活動卡
    _hideLoading();
    this._setHomeSectionVisibility(container, true);

    const cards = visible.map((e, index) => {
        const _dp = (e.date || '').split(' ')[0].split('/');
        const _typeKey = this._getEventDisplayTypeKey?.(e) || (TYPE_CONFIG?.[e.type] ? e.type : 'friendly');
        const _typeLabel = (this._getEventDisplayTypeConfig?.(e) || TYPE_CONFIG?.[_typeKey])?.label || '活動';
        const _typeRibbon = `<span class="h-card-type-ribbon h-card-type-ribbon-${_typeKey}">${escapeHTML(_typeLabel)}</span>`;
        const _sportIcon = this._renderEventSportIcon(e, 'h-card-sport-chip');
        const _dateTag = _dp.length >= 3
          ? `<span class="h-card-date-chip">${parseInt(_dp[1])}/${parseInt(_dp[2])}</span>`
          : '';
        const _cornerBadges = `<div class="h-card-corner-badges">${_sportIcon}${_dateTag}</div>`;
        const _image = this._getEventImageUrl?.(e, 'cover') || e.image || '';
        const _isExternal = _typeKey === 'external';
        const _genderRibbon = !_isExternal && this._hasEventGenderRestriction(e)
          ? `<span class="h-card-gender-ribbon">${escapeHTML(this._getEventGenderRibbonText(e))}</span>`
          : '';
        let _metaBottom = '';
        if (_isExternal) {
          _metaBottom = `<div class="h-card-meta-bottom"><span class="h-card-meta-count" style="color:var(--info)">外部活動</span></div>`;
        } else {
          const _stats = this._getEventParticipantStats(e);
          const _capacityBadge = this._renderEventCapacityBadge(e, _stats);
          const _participantCountClass = _stats.isCapacityFull ? 'h-card-meta-count h-card-meta-count-full' : 'h-card-meta-count';
          const _reservationTag = _stats.reservedRemainingCount > 0 ? ` 預留 ${_stats.reservedRemainingCount}` : '';
          const _participantCount = `${_stats.confirmedCount}/${_stats.maxCount}${t('activity.participants')}${_reservationTag}${_stats.waitlistCount > 0 ? ' 候補' + _stats.waitlistCount : ''}`;
          const _metaBottomClass = _genderRibbon ? 'h-card-meta-bottom h-card-meta-bottom-has-ribbon' : 'h-card-meta-bottom';
          _metaBottom = `<div class="${_metaBottomClass}"><span class="${_participantCountClass}">${_participantCount}</span>${_capacityBadge}</div>`;
        }
        const _imagePriorityAttrs = index < 3
          ? 'loading="eager" fetchpriority="high" decoding="async"'
          : 'loading="lazy" decoding="async"';
        return `
        <div class="h-card" style="${e.pinned ? 'border:1px solid var(--warning);box-shadow:0 0 0 1px rgba(245,158,11,.15)' : ''}" onclick="App.openHomeEventDetailFromCard('${e.id}', this)">
          ${_image
            ? `<div class="h-card-img">${_cornerBadges}${_typeRibbon}<img src="${_image}" alt="${escapeHTML(e.title)}" width="1200" height="450" ${_imagePriorityAttrs}></div>`
            : `<div class="h-card-img h-card-placeholder">${_cornerBadges}${_typeRibbon}220 × 90</div>`}
          <div class="h-card-body">
            <div class="h-card-title">${e.pinned ? '<span style="font-size:.62rem;padding:.08rem .35rem;border-radius:999px;border:1px solid var(--warning);color:var(--warning);font-weight:700;margin-right:.3rem">置頂</span>' : ''}${escapeHTML(e.title)}${e.teamOnly ? '<span class="tl-teamonly-badge">俱樂部限定</span>' : ''} ${this._favHeartHtml(this.isEventFavorited(e.id), 'Event', e.id)}</div>
            <div class="h-card-meta">
              <span class="h-card-meta-location">${escapeHTML(e.location || '')}</span>
              ${_metaBottom}
            </div>
          </div>
          ${_genderRibbon}
          ${e.privateEvent ? '<span class="stamp-circle">不公開</span>' : ''}
        </div>
      `; }).join('');

    // 方案 B：資料未變時跳過 re-render
    var _fp = visible.map((e) => {
      const s = this._getEventParticipantStats(e);
      return e.id + '|' + (e.current||0) + '|' + (e.waitlist||0)
        + '|sc:' + (s?.confirmedCount ?? '') + '|sw:' + (s?.waitlistCount ?? '') + '|sm:' + (s?.maxCount ?? '')
        + '|' + e.status + '|' + (e.pinned?1:0) + '|' + (this._getEventImageUrl?.(e, 'cover') || e.image || '');
    }).join(',') + '|s:' + (App._activeSport || 'all');
    if (this._hotEventsLastFp === _fp && container.children.length > 0) return;
    this._hotEventsLastFp = _fp;

    // 方案 A：存 scrollTop
    var _prevWinScroll = window.scrollY || window.pageYOffset || 0;

    container.textContent = '';
    container.insertAdjacentHTML('beforeend', cards);
    this._scheduleVisibleDetailPrefetch?.('events', visible.map(e => e.id || e._docId).filter(Boolean));

    // 方案 A：還原 scrollTop
    if (_prevWinScroll > 0) window.scrollTo(0, _prevWinScroll);

    // Restore loading bar if a card was being loaded when DOM was rebuilt
    const loadState = this._homeCardLoadingState;
    if (loadState && loadState.eventId) {
      const card = this._findCardByEventId(loadState.eventId);
      if (card) {
        card.classList.add('is-pending');
        card.setAttribute('aria-busy', 'true');
        this._injectCardLoadingBar(card);
      }
    }
  },

});

try {
  if (App.currentPage === 'page-activities' && App._readActivityUrlFilters?.().hasExplicit) {
    App._applyActivityUrlFilters?.({ replace: true });
    App.renderActivityList?.();
    if (App._activityActiveTab === 'calendar') {
      App._calendarCurrentMonthKey = null;
      App._calendarRenderedMonths?.clear?.();
      if (typeof App._renderActivityCalendar === 'function') {
        App._renderActivityCalendar();
      } else if (typeof App._loadAndRenderCalendar === 'function') {
        App._loadAndRenderCalendar();
      }
    }
  }
} catch (err) {
  console.warn('[ActivityUrl] post-load apply failed:', err);
}
