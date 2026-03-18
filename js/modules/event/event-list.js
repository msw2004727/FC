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
    if (render) this.renderActivityList();
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
    // 顯示最近 10 場未結束活動（依日期排序）
    const visible = this._getVisibleEvents()
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
      .slice(0, 10);
    this._setHomeSectionVisibility(container, visible.length > 0);
    if (visible.length === 0) {
      container.textContent = '';
      return;
    }

    const cards = visible.map(e => {
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
        return `
        <div class="h-card" style="${e.pinned ? 'border:1px solid var(--warning);box-shadow:0 0 0 1px rgba(245,158,11,.15)' : ''}" onclick="App.openHomeEventDetailFromCard('${e.id}', this)">
          ${e.image
            ? `<div class="h-card-img">${_cornerBadges}${_typeRibbon}<img src="${e.image}" alt="${escapeHTML(e.title)}" loading="lazy"></div>`
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

    container.textContent = '';
    container.insertAdjacentHTML('beforeend', cards);

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
