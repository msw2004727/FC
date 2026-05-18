/* ================================================
   SportHub — Event List: Timeline Card Loading & Activity List Render
   依賴：config.js, api-service.js, event-list-helpers.js, event-list-stats.js, event-list-home.js
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  Timeline Card Loading Bar
  // ══════════════════════════════════

  _tlCardLoadingState: null,

  _clearTimelineCardNavigationState(reason = '') {
    const state = this._tlCardLoadingState;
    if (state?.interval) {
      clearInterval(state.interval);
      state.interval = null;
    }
    this._tlCardLoadingState = null;

    const container = document.getElementById('activity-list');
    if (!container) return;
    container.querySelectorAll('.tl-event-row').forEach(row => {
      row.classList.remove('tl-pending', 'tl-loaded');
      row.removeAttribute('aria-busy');
      if (row.dataset) delete row.dataset.tlOpening;
      const bar = row.querySelector('.tl-loading-bar');
      if (bar) bar.remove();
    });

    if (reason && window._raceDebug) {
      console.log('[TimelineEventClick] cleared pending cards:', reason);
    }
  },

  _tlFindCardByEventId(eventId) {
    if (!eventId) return null;
    var container = document.getElementById('activity-list');
    if (!container) return null;
    var rows = container.querySelectorAll('.tl-event-row');
    for (var i = 0; i < rows.length; i++) {
      var onclick = rows[i].getAttribute('onclick') || '';
      if (onclick.indexOf("'" + eventId + "'") !== -1) return rows[i];
    }
    return null;
  },

  _markTlCardPending(cardEl) {
    if (!cardEl || !cardEl.classList) return;
    cardEl.classList.add('tl-pending');
    cardEl.setAttribute('aria-busy', 'true');
    if (!cardEl.querySelector('.tl-loading-bar')) {
      var bar = document.createElement('div');
      bar.className = 'tl-loading-bar';
      var fill = document.createElement('div');
      fill.className = 'tl-loading-fill';
      bar.appendChild(fill);
      cardEl.appendChild(bar);
    }
    var eventId = null;
    var onclick = cardEl.getAttribute('onclick') || '';
    var m = onclick.match(/openTimelineEventDetail\(['"]([^'"]+)['"]/);
    if (m) eventId = m[1];

    if (!this._tlCardLoadingState || this._tlCardLoadingState.eventId !== eventId) {
      clearInterval(this._tlCardLoadingState?.interval);
      var state = { eventId: eventId, progress: 0, startedAt: Date.now(), interval: null };
      var self = this;
      state.interval = setInterval(function() {
        var p = state.progress;
        var inc = p < 30 ? 4 : p < 60 ? 2 : p < 80 ? 0.5 : 0.15;
        state.progress = Math.min(p + inc, 85);
        var card = self._tlFindCardByEventId(state.eventId);
        var fill = card && card.querySelector('.tl-loading-fill');
        if (fill) fill.style.width = state.progress + '%';
      }, 100);
      this._tlCardLoadingState = state;
    }
    var st = this._tlCardLoadingState;
    if (st) {
      var currentFill = cardEl.querySelector('.tl-loading-fill');
      if (currentFill) currentFill.style.width = st.progress + '%';
    }
  },

  _clearTlCardPending(cardEl, minVisibleMs) {
    // 修復：不依賴 state.eventId（可能被後點擊的卡片覆蓋）
    // 優先用傳入的 cardEl 直接清自己，state 只用來 clearInterval
    var state = this._tlCardLoadingState;
    var stateEventId = state ? state.eventId : null;
    var clickedEventId = null;
    if (cardEl) {
      var onclick = cardEl.getAttribute ? (cardEl.getAttribute('onclick') || '') : '';
      var m = onclick.match(/openTimelineEventDetail\(['"]([^'"]+)['"]/);
      if (m) clickedEventId = m[1];
    }
    // 若本次 clear 的 card 正好是 state 對應的 card（最新點擊），clearInterval
    if (state && (!clickedEventId || clickedEventId === stateEventId)) {
      clearInterval(state.interval);
      state.interval = null;
    }
    // 同步解除 tl-pending（pointer-events: none 立刻釋放）。
    // 避免「從詳細頁快速返回時，_doRenderActivityList fp 短路跳過重繪、
    //       舊 DOM 殘留 tl-pending 造成卡片 1.4 秒內不能點」的時序 bug。
    // 後續 setTimeout 鏈仍負責 loading bar DOM 清理。
    var immediateCard = (cardEl && cardEl.isConnected) ? cardEl
             : (clickedEventId ? this._tlFindCardByEventId(clickedEventId) : null)
             || (stateEventId ? this._tlFindCardByEventId(stateEventId) : null);
    if (immediateCard) {
      immediateCard.classList.remove('tl-pending');
      immediateCard.removeAttribute('aria-busy');
    }
    var elapsed = state ? (Date.now() - state.startedAt) : 0;
    var waitMs = Math.max(0, (minVisibleMs || 0) - elapsed);
    var self = this;
    setTimeout(function() {
      // 優先清 cardEl 自己；若 cardEl 不在 DOM，fallback 用 eventId 找
      var card = (cardEl && cardEl.isConnected) ? cardEl
               : (clickedEventId ? self._tlFindCardByEventId(clickedEventId) : null)
               || (stateEventId ? self._tlFindCardByEventId(stateEventId) : null);
      if (!card) {
        // 新 DOM 中找不到：僅重置 state（若本次是最新點擊）
        if (state && clickedEventId === stateEventId) self._tlCardLoadingState = null;
        return;
      }
      var fill = card.querySelector('.tl-loading-fill');
      if (fill) fill.style.width = '100%';
      setTimeout(function() {
        if (card.isConnected) card.classList.add('tl-loaded');
        setTimeout(function() {
          if (card.isConnected) {
            card.classList.remove('tl-pending', 'tl-loaded');
            card.removeAttribute('aria-busy');
            var bar = card.querySelector('.tl-loading-bar');
            if (bar) bar.remove();
          }
          // 只在本次清理的是最新 state 時才重置
          if (state && self._tlCardLoadingState === state) self._tlCardLoadingState = null;
        }, 400);
      }, 350);
    }, waitMs);
  },

  async openTimelineEventDetail(eventId, cardEl) {
    var safeEventId = String(eventId || '').trim();
    var targetCard = cardEl && cardEl.closest ? cardEl.closest('.tl-event-row') : cardEl;
    if (!safeEventId) return;

    // 外部活動：中繼卡片
    var extEvent = ApiService.getEvent(safeEventId);
    if (extEvent && extEvent.type === 'external' && extEvent.externalUrl) {
      App.showExternalTransitCard(extEvent);
      return;
    }

    // 連點同一張卡：第一次仍在處理 → 立刻刷新遮罩讓用戶看到「處理中」、return 避免重複觸發 showEventDetail
    if (targetCard && targetCard.dataset.tlOpening === '1') {
      if (targetCard) this._markTlCardPending(targetCard);
      return;
    }
    if (targetCard && targetCard.dataset) targetCard.dataset.tlOpening = '1';

    // Round 3：延遲 150ms 才加遮罩 — 快場景（< 150ms 完成）不加遮罩、無閃爍；
    // 慢場景（> 150ms 還沒完成）才出現遮罩、給用戶 feedback。
    // 配合 css/activity.css 移除 pointer-events: none — 遮罩出現時仍可點。
    var self = this;
    var hintTimer = targetCard ? setTimeout(function() {
      if (targetCard.dataset && targetCard.dataset.tlOpening === '1') {
        self._markTlCardPending(targetCard);
      }
    }, 150) : null;

    try {
      var result = await this.showEventDetail(safeEventId);
      if (!result?.ok && result?.reason === 'missing') {
        this.showToast('活動資料暫時無法開啟，請稍後再試');
      }
    } catch (err) {
      console.error('[TimelineEventClick] open detail failed:', err);
      this.showToast('活動資料暫時無法開啟，請稍後再試');
    } finally {
      if (hintTimer) clearTimeout(hintTimer);
      this._clearTlCardPending(targetCard, 0);
      if (targetCard && targetCard.dataset) {
        var tc = targetCard;
        setTimeout(function() { delete tc.dataset.tlOpening; }, 320);
      }
    }
  },

  // ══════════════════════════════════
  //  Render: Activity Timeline
  // ══════════════════════════════════

  _activityListRenderTimer: null,

  _normalizeActivitySearchValue(value) {
    return String(value || '')
      .replace(/\u81fa/g, '\u53f0')
      .toLowerCase()
      .replace(/[^\w\u3400-\u9fff]+/g, '');
  },

  _fuzzyTextContains(text, keyword) {
    const hay = this._normalizeActivitySearchValue(text);
    const needle = this._normalizeActivitySearchValue(keyword);
    if (!needle) return true;
    if (!hay) return false;
    if (hay.includes(needle)) return true;
    let pos = 0;
    for (let i = 0; i < needle.length; i++) {
      pos = hay.indexOf(needle[i], pos);
      if (pos === -1) return false;
      pos++;
    }
    return true;
  },

  _getActivitySearchText(e) {
    const sportLabel = typeof getSportLabelByKey === 'function'
      ? getSportLabelByKey(e?.sportTag || e?.sport || '')
      : '';
    return [
      e?.title,
      e?.location,
      e?.venue,
      e?.region,
      e?.date,
      e?.hostName,
      e?.creatorName,
      e?.organizer,
      e?.host,
      e?.type,
      e?.sportTag,
      sportLabel,
    ].filter(Boolean).join(' ');
  },

  _matchesActivityKeyword(e, keyword) {
    const tokens = String(keyword || '')
      .trim()
      .split(/\s+/)
      .map(token => this._normalizeActivitySearchValue(token))
      .filter(Boolean);
    if (!tokens.length) return true;
    const text = this._getActivitySearchText(e);
    return tokens.every(token => this._fuzzyTextContains(text, token));
  },

  renderActivityList() {
    // 防抖 + 頁面守衛：多條路徑（onSnapshot / seed / revalidate / visibilitychange）
    // 可能在短時間內連續觸發，統一收束為 100ms 內只渲染一次，避免 DOM 連續替換導致捲動跳頂
    if (this.currentPage !== 'page-activities') return;
    this._syncActivityFemaleTheme?.(this._activityActiveTab);
    this._syncActivityMapEntry?.();
    this._refreshActivityCreateButton?.();
    clearTimeout(this._activityListRenderTimer);
    this._activityListRenderTimer = setTimeout(() => { this._doRenderActivityList(); }, 100);
  },

  _hasActivitySourceFinishedInitialLoad() {
    if (typeof FirebaseService === 'undefined') return true;
    if (FirebaseService._eventsServerSnapshotReceived) return true;
    if (FirebaseService._collectionLoadedAt?.events) return true;
    const source = FirebaseService._cache?.events || [];
    if (Array.isArray(source) && source.length > 0) return true;
    const slices = FirebaseService._eventSlices || {};
    return ['active', 'terminal', 'injected'].some(key => {
      const list = slices[key];
      return Array.isArray(list) && list.length > 0;
    });
  },

  _isActivityListInitialLoading() {
    const allEvents = (typeof ApiService !== 'undefined' && ApiService.getEvents)
      ? (ApiService.getEvents() || [])
      : [];
    if (Array.isArray(allEvents) && allEvents.length > 0) return false;
    return !this._hasActivitySourceFinishedInitialLoad?.();
  },

  _renderActivityListLoading(container) {
    if (!container) return;
    const fp = 'loading:activity-list';
    if (this._activityListLastFp === fp && container.querySelector('[data-activity-loading]')) return;
    this._activityListLastFp = fp;
    container.innerHTML = `
      <div class="activity-list-loading" data-activity-loading="runtime" aria-live="polite" aria-busy="true">
        <div class="activity-list-loading-bar" aria-hidden="true"><span></span></div>
        <div class="reg-loading">&#27963;&#21205;&#36039;&#26009;&#36617;&#20837;&#20013;...</div>
        <div class="reg-loading-skeleton">
          <div class="reg-loading-skeleton-row"></div>
          <div class="reg-loading-skeleton-row"></div>
          <div class="reg-loading-skeleton-row"></div>
        </div>
      </div>`;
  },

  _doRenderActivityList() {
    this._autoEndExpiredEvents();
    const container = document.getElementById('activity-list');
    if (!container) return;

    // 篩選：類別 + 關鍵字
    const filterType = document.getElementById('activity-filter-type')?.value || '';
    const filterKw = (document.getElementById('activity-filter-keyword')?.value || '').trim().toLowerCase();

    let events = this._getVisibleEvents();
    events = this._filterByRegionTab(events);
    events = this._filterBySportTag(events);

    // 頁簽篩選：取消立即進已結束；其他活動結束後 6 小時才移入已結束
    const activeTab = typeof this._normalizeActivityTab === 'function'
      ? this._normalizeActivityTab(this._activityActiveTab)
      : (this._activityActiveTab || 'normal');
    this._activityActiveTab = activeTab;
    const nowDateForEndedTab = new Date();
    const endedTabHelper = typeof this._isEventInActivityEndedTab === 'function'
      ? this._isEventInActivityEndedTab.bind(this)
      : null;
    const isInEndedTab = (e) => endedTabHelper
      ? endedTabHelper(e, nowDateForEndedTab)
      : (e.status === 'ended' || e.status === 'cancelled');
    if (activeTab === 'ended') {
      events = events.filter(e => isInEndedTab(e));
    } else {
      events = events.filter(e => !isInEndedTab(e));
    }
    if (activeTab === 'female') {
      events = events.filter(e => this._getEventAllowedGender?.(e) === '女');
    }

    if (filterType) events = events.filter(e => e.type === filterType);
    if (filterKw) events = events.filter(e => this._matchesActivityKeyword(e, filterKw));

    if (!events.length && this._isActivityListInitialLoading?.()) {
      this._renderActivityListLoading(container);
      return;
    }

    const monthGroups = {};
    events.forEach(e => {
      const parts = e.date.split(' ')[0].split('/');
      const monthKey = `${parts[0]}/${parts[1]}`;
      const day = parseInt(parts[2], 10);
      const dateObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, day);
      const dayName = DAY_NAMES[dateObj.getDay()];

      if (!monthGroups[monthKey]) monthGroups[monthKey] = {};
      if (!monthGroups[monthKey][day]) {
        monthGroups[monthKey][day] = { day, dayName, dateObj, events: [] };
      }
      monthGroups[monthKey][day].events.push(e);
    });

    const today = new Date();
    const todayStr = `${today.getFullYear()}/${today.getMonth()+1}/${today.getDate()}`;

    const isEndedTab = activeTab === 'ended';
    let html = '';
    Object.keys(monthGroups).sort((a, b) => isEndedTab ? b.localeCompare(a) : a.localeCompare(b)).forEach(monthKey => {
      const [y, m] = monthKey.split('/');
      const monthLabel = `${y} 年 ${parseInt(m)} 月`;
      html += `<div class="tl-month-group">`;
      html += `<div class="tl-month-header">${monthLabel}</div>`;

      const days = Object.values(monthGroups[monthKey]).sort((a, b) => isEndedTab ? b.day - a.day : a.day - b.day);
      days.forEach(dayInfo => {
        const isToday = todayStr === `${y}/${parseInt(m)}/${dayInfo.day}`;
        // 月曆 +N more 錨點用（padded YYYY-MM-DD、見 calendar-view-plan §12.N）
        const anchorKey = `${y}-${String(parseInt(m)).padStart(2, '0')}-${String(dayInfo.day).padStart(2, '0')}`;
        html += `<div class="tl-day-group" data-date-anchor="${anchorKey}">`;
        html += `<div class="tl-date-col${isToday ? ' today' : ''}">
          <div class="tl-day-num">${dayInfo.day}</div>
          <div class="tl-day-name">週${dayInfo.dayName}</div>
        </div>`;
        html += `<div class="tl-events-col">`;

        // 同一天內依開始時間排序（越早越上面）
        dayInfo.events.sort((a, b) => {
          const ap = a?.pinned ? 1 : 0;
          const bp = b?.pinned ? 1 : 0;
          if (ap !== bp) return bp - ap;
          if (ap && bp) {
            const ao = Number(a?.pinOrder) || 0;
            const bo = Number(b?.pinOrder) || 0;
            if (ao !== bo) return ao - bo;
          }
          const ta = (a.date || '').split(' ')[1] || '';
          const tb = (b.date || '').split(' ')[1] || '';
          return isEndedTab ? tb.localeCompare(ta) : ta.localeCompare(tb);
        });

        dayInfo.events.forEach(e => {
          const typeConf = TYPE_CONFIG[e.type] || TYPE_CONFIG.friendly;
          const time = e.date.split(' ')[1] || '';
          const isExternal = e.type === 'external';
          const effectiveStatus = !isExternal && typeof this._getEventEffectiveStatus === 'function'
            ? this._getEventEffectiveStatus(e)
            : e.status;
          const isEnded = effectiveStatus === 'ended' || effectiveStatus === 'cancelled';

          // 外部活動：自訂 status 與 meta
          let statusLabel, statusCss, metaText;
          if (isExternal) {
            if (e.status === 'cancelled') { statusLabel = '已取消'; statusCss = 'cancelled'; }
            else if (isEnded) { statusLabel = '已結束'; statusCss = 'ended'; }
            else { statusLabel = '外部活動'; statusCss = 'external'; }
            const locPart = e.location ? ` · ${escapeHTML((e.location || '').split('市')[1] || e.location)}` : '';
            metaText = `${typeConf.label} · ${time}${locPart}`;
          } else {
            const stats = this._getEventParticipantStats(e);
            const statusConf = STATUS_CONFIG[effectiveStatus] || STATUS_CONFIG.open;
            statusLabel = statusConf.label;
            statusCss = statusConf.css;
            const waitlistTag = stats.waitlistCount > 0 ? ` · 候補(${stats.waitlistCount})` : '';
            metaText = `${typeConf.label} · ${time} · ${escapeHTML((e.location || '').split('市')[1] || e.location)} · ${stats.confirmedCount}/${stats.maxCount}人${waitlistTag}`;
          }

          // 俱樂部限定用特殊色
          const isFemaleOnly = !isExternal && this._getEventAllowedGender?.(e) === '女';
          const rowBaseClass = e.teamOnly ? 'tl-type-teamonly' : `tl-type-${e.type}`;
          const rowClass = isFemaleOnly ? `${rowBaseClass} tl-type-female-only` : rowBaseClass;
          const rowStyle = e.pinned
            ? (isFemaleOnly ? 'box-shadow:0 0 0 1px rgba(236,72,153,.16)' : 'border:1px solid var(--warning);box-shadow:0 0 0 1px rgba(245,158,11,.12)')
            : '';
          const teamBadge = e.teamOnly ? '<span class="tl-teamonly-badge">限定</span>' : '';
          const genderRibbon = !isExternal && this._hasEventGenderRestriction(e)
            ? `<span class="tl-event-gender-ribbon">${escapeHTML(this._getEventGenderTimelineRibbonText(e))}</span>`
            : '';
          const sportIcon = this._renderEventSportIcon(e, 'tl-event-sport-corner');
          const favHeart = this._favHeartHtml(this.isEventFavorited(e.id), 'Event', e.id);
          const iconStack = `<div class="tl-event-icons">${favHeart}${sportIcon}</div>`;
          const eventImage = this._getEventImageUrl?.(e, 'cover') || e.image || '';

          // 報名狀態章
          const isSignedUp = !isExternal && this._isUserSignedUp(e);
          const isWaitlist = isSignedUp && this._isUserOnWaitlist(e);
          let regStamp = '';
          if (isWaitlist) regStamp = '<span class="tl-stamp-waitlisted">候補</span>';
          else if (isSignedUp) regStamp = '<span class="tl-stamp-confirmed">正取</span>';
          const privateStamp = e.privateEvent ? '<span class="tl-stamp-private">不公開</span>' : '';

          // 人數計量條
          let progressHtml = '';
          if (!isExternal && !isEnded) {
            const _ps = this._getEventParticipantStats(e);
            const _pPct = _ps.maxCount > 0 ? Math.min(100, Math.round(_ps.confirmedCount / _ps.maxCount * 100)) : 0;
            const _pClr = _pPct >= 100 ? 'var(--danger)' : _pPct >= 70 ? 'var(--warning)' : 'var(--success)';
            const _wTag = _ps.waitlistCount > 0 ? ` · 候補 ${_ps.waitlistCount}` : '';
            progressHtml = `<div style="display:flex;align-items:center;gap:.4rem;margin-top:.2rem"><div style="flex:1;height:5px;background:var(--border);border-radius:3px;overflow:hidden"><div style="width:${_pPct}%;height:100%;background:${_pClr};border-radius:3px"></div></div><span style="font-size:.65rem;color:var(--text-muted);white-space:nowrap">${_ps.confirmedCount}/${_ps.maxCount}人${_wTag}</span></div>`;
          }

          html += `
            <div class="tl-event-row ${rowClass}${isEnded ? ' tl-past' : ''}" style="${rowStyle}" onclick="App.openTimelineEventDetail('${e.id}', this)">
              ${genderRibbon}
              ${eventImage ? `<div class="tl-event-thumb"><img src="${eventImage}" loading="lazy"></div>` : ''}
              <div class="tl-event-info">
                <div class="tl-event-title-row"><div class="tl-event-title">${e.pinned ? '<span style="font-size:.62rem;padding:.08rem .35rem;border-radius:999px;border:1px solid var(--warning);color:var(--warning);font-weight:700;margin-right:.3rem">置頂</span>' : ''}${escapeHTML(e.title)}${teamBadge}</div></div>
                ${progressHtml}
                <div class="tl-event-meta">${metaText}</div>
              </div>
              <span class="tl-event-status ${statusCss}">${statusLabel}</span>
              ${iconStack}
              <span class="tl-event-arrow">›</span>
              ${privateStamp}${regStamp}
            </div>`;
        });

        html += `</div></div>`;
      });

      html += `</div>`;
    });

    // 方案 B：資料未變時跳過 re-render
    var _fp = events.map((e) => {
      var s = this._getEventParticipantStats(e);
      return e.id + '|' + e.status + '|' + (e.current||0) + '|' + (e.waitlist||0)
        + '|sc:' + (s?.confirmedCount ?? '') + '|sw:' + (s?.waitlistCount ?? '') + '|sm:' + (s?.maxCount ?? '')
        + '|' + (e.pinned?1:0) + '|' + (e.title||'') + '|' + (this._getEventImageUrl?.(e, 'cover') || e.image || '');
    }).join(',') + '|tab:' + activeTab + '|f:' + filterType + '|k:' + filterKw + '|s:' + (App._activeSport || 'all');
    if (this._activityListLastFp === _fp && container.children.length > 0) return;
    this._activityListLastFp = _fp;

    // 方案 A：存 scrollTop
    var _page = document.getElementById('page-activities');
    var _prevScroll = _page ? _page.scrollTop : 0;
    var _prevWinScroll = window.scrollY || window.pageYOffset || 0;

    container.textContent = '';
    if (html) {
      container.insertAdjacentHTML('beforeend', html);
    } else {
      this._activityListLastFp = '';
      const emptyDiv = document.createElement('div');
      emptyDiv.style.cssText = 'padding:1.5rem;font-size:.82rem;color:var(--text-muted);text-align:center';
      emptyDiv.textContent = t('activity.noMatch');
      container.appendChild(emptyDiv);
    }

    // 方案 A：還原 scrollTop
    if (_prevScroll > 0 && _page) _page.scrollTop = _prevScroll;
    if (_prevWinScroll > 0) window.scrollTo(0, _prevWinScroll);

    this._markPageSnapshotReady?.('page-activities');
    this._scheduleVisibleDetailPrefetch?.('events', events.map(e => e.id || e._docId).filter(Boolean));

    // 綁定左右滑動切換頁籤
    this._bindSwipeTabs('activity-list', 'activity-tabs',
      this.switchActivityTab,
      (btn) => this._unavailableActivityTabs?.includes(btn.dataset.atab) ? null : btn.dataset.atab
    );
  },

});
