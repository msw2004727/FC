/* ================================================
   SportHub — Event: Tab Management & Hot Events Render
   依賴：config.js, api-service.js
   拆分檔案：event-list-helpers.js, event-list-stats.js,
             event-list-home.js, event-list-timeline.js
   ================================================ */

Object.assign(App, {

  _activityActiveTab: 'normal',

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
    this._activityActiveTab = tab;
    document.querySelectorAll('#activity-tabs .tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.atab === tab);
    });
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
    if (render) this.renderActivityList();
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

  switchActivityTab(tab) {
    this._setActivityTab(tab);
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
    const colors = { hot: '#dc2626', warm: '#f59e0b', normal: '#3b82f6', cold: '#6b7280' };
    const labels = { hot: '極熱門 — 預計快速額滿', warm: '熱門 — 報名踴躍', normal: '一般 — 正常報名中', cold: '冷門 — 名額充裕' };
    return `<div class="detail-row"><span class="detail-label">熱度</span><span style="color:${colors[pred]};font-weight:600">${labels[pred]}</span></div>`;
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
        const _typeKey = TYPE_CONFIG?.[e.type] ? e.type : 'friendly';
        const _typeLabel = TYPE_CONFIG?.[_typeKey]?.label || '活動';
        const _typeRibbon = `<span class="h-card-type-ribbon h-card-type-ribbon-${_typeKey}">${escapeHTML(_typeLabel)}</span>`;
        const _sportIcon = this._renderEventSportIcon(e, 'h-card-sport-chip');
        const _dateTag = _dp.length >= 3
          ? `<span class="h-card-date-chip">${parseInt(_dp[1])}/${parseInt(_dp[2])}</span>`
          : '';
        const _cornerBadges = `<div class="h-card-corner-badges">${_sportIcon}${_dateTag}</div>`;
        const _isExternal = e.type === 'external';
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
          const _participantCount = `${_stats.confirmedCount}/${_stats.maxCount}${t('activity.participants')}${_stats.waitlistCount > 0 ? ' 候補' + _stats.waitlistCount : ''}`;
          const _metaBottomClass = _genderRibbon ? 'h-card-meta-bottom h-card-meta-bottom-has-ribbon' : 'h-card-meta-bottom';
          _metaBottom = `<div class="${_metaBottomClass}"><span class="${_participantCountClass}">${_participantCount}</span>${_capacityBadge}</div>`;
        }
        const _imagePriorityAttrs = index < 3
          ? 'loading="eager" fetchpriority="high" decoding="async"'
          : 'loading="lazy" decoding="async"';
        return `
        <div class="h-card" style="${e.pinned ? 'border:1px solid var(--warning);box-shadow:0 0 0 1px rgba(245,158,11,.15)' : ''}" onclick="App.openHomeEventDetailFromCard('${e.id}', this)">
          ${e.image
            ? `<div class="h-card-img">${_cornerBadges}${_typeRibbon}<img src="${e.image}" alt="${escapeHTML(e.title)}" ${_imagePriorityAttrs}></div>`
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
    var _fp = visible.map(function(e){ return e.id + '|' + (e.current||0) + '|' + (e.waitlist||0) + '|' + e.status + '|' + (e.pinned?1:0); }).join(',') + '|s:' + (App._activeSport || 'all');
    if (this._hotEventsLastFp === _fp && container.children.length > 0) return;
    this._hotEventsLastFp = _fp;

    // 方案 A：存 scrollTop
    var _prevWinScroll = window.scrollY || window.pageYOffset || 0;

    container.textContent = '';
    container.insertAdjacentHTML('beforeend', cards);

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
