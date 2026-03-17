/* ================================================
   SportHub — Event List: Timeline Card Loading & Activity List Render
   依賴：config.js, api-service.js, event-list-helpers.js, event-list-stats.js, event-list-home.js
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  Timeline Card Loading Bar
  // ══════════════════════════════════

  _tlCardLoadingState: null,

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
    var state = this._tlCardLoadingState;
    if (!state) return;
    clearInterval(state.interval);
    state.interval = null;
    var elapsed = Date.now() - state.startedAt;
    var waitMs = Math.max(0, (minVisibleMs || 0) - elapsed);
    var eventId = state.eventId;
    var self = this;
    setTimeout(function() {
      var card = self._tlFindCardByEventId(eventId) || cardEl;
      if (!card) { self._tlCardLoadingState = null; return; }
      var fill = card.querySelector('.tl-loading-fill');
      if (fill) fill.style.width = '100%';
      setTimeout(function() {
        var card2 = self._tlFindCardByEventId(eventId) || card;
        if (card2) card2.classList.add('tl-loaded');
        setTimeout(function() {
          var card3 = self._tlFindCardByEventId(eventId) || card2;
          if (card3) {
            card3.classList.remove('tl-pending', 'tl-loaded');
            card3.removeAttribute('aria-busy');
            var bar = card3.querySelector('.tl-loading-bar');
            if (bar) bar.remove();
          }
          self._tlCardLoadingState = null;
        }, 400);
      }, 350);
    }, waitMs);
  },

  async openTimelineEventDetail(eventId, cardEl) {
    var safeEventId = String(eventId || '').trim();
    var targetCard = cardEl && cardEl.closest ? cardEl.closest('.tl-event-row') : cardEl;
    if (!safeEventId) return;

    // 外部活動：直接跳轉
    var extEvent = ApiService.getEvent(safeEventId);
    if (extEvent && extEvent.type === 'external' && extEvent.externalUrl) {
      location.href = extEvent.externalUrl;
      return;
    }

    if (targetCard && targetCard.dataset.tlOpening === '1') return;
    var shouldHint = this._shouldShowHomeEventLoadingHint();
    if (targetCard && targetCard.dataset) targetCard.dataset.tlOpening = '1';
    if (shouldHint && targetCard) this._markTlCardPending(targetCard);

    try {
      var result = await this.showEventDetail(safeEventId);
      if (!result?.ok && result?.reason === 'missing') {
        this.showToast('活動資料暫時無法開啟，請稍後再試');
      }
    } catch (err) {
      console.error('[TimelineEventClick] open detail failed:', err);
      this.showToast('活動資料暫時無法開啟，請稍後再試');
    } finally {
      this._clearTlCardPending(targetCard, shouldHint ? 650 : 0);
      if (targetCard && targetCard.dataset) {
        var tc = targetCard;
        setTimeout(function() { delete tc.dataset.tlOpening; }, shouldHint ? 900 : 320);
      }
    }
  },

  // ══════════════════════════════════
  //  Render: Activity Timeline
  // ══════════════════════════════════

  renderActivityList() {
    this._autoEndExpiredEvents();
    const container = document.getElementById('activity-list');
    if (!container) return;

    // 篩選：類別 + 關鍵字
    const filterType = document.getElementById('activity-filter-type')?.value || '';
    const filterKw = (document.getElementById('activity-filter-keyword')?.value || '').trim().toLowerCase();

    let events = this._getVisibleEvents();

    // 頁簽篩選：一般 = 非已結束/已取消，已結束 = ended/cancelled
    const activeTab = this._activityActiveTab || 'normal';
    if (activeTab === 'ended') {
      events = events.filter(e => e.status === 'ended' || e.status === 'cancelled');
    } else {
      events = events.filter(e => e.status !== 'ended' && e.status !== 'cancelled');
    }

    if (filterType) events = events.filter(e => e.type === filterType);
    if (filterKw) events = events.filter(e =>
      (e.title || '').toLowerCase().includes(filterKw) ||
      (e.location || '').toLowerCase().includes(filterKw)
    );

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
        html += `<div class="tl-day-group">`;
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
          const isEnded = e.status === 'ended' || e.status === 'cancelled';
          const isExternal = e.type === 'external';

          // 外部活動：自訂 status 與 meta
          let statusLabel, statusCss, metaText;
          if (isExternal) {
            if (e.status === 'cancelled') { statusLabel = '已取消'; statusCss = 'cancelled'; }
            else if (isEnded) { statusLabel = '已結束'; statusCss = 'ended'; }
            else { statusLabel = '外部活動'; statusCss = 'external'; }
            const locPart = e.location ? ` · ${escapeHTML((e.location || '').split('市')[1] || e.location)}` : '';
            metaText = `${typeConf.label} · ${time}${locPart}`;
          } else {
            const statusConf = STATUS_CONFIG[e.status] || STATUS_CONFIG.open;
            statusLabel = statusConf.label;
            statusCss = statusConf.css;
            const stats = this._getEventParticipantStats(e);
            const waitlistTag = stats.waitlistCount > 0 ? ` · 候補(${stats.waitlistCount})` : '';
            metaText = `${typeConf.label} · ${time} · ${escapeHTML((e.location || '').split('市')[1] || e.location)} · ${stats.confirmedCount}/${stats.maxCount}人${waitlistTag}`;
          }

          // 球隊限定用特殊色
          const rowClass = e.teamOnly ? 'tl-type-teamonly' : `tl-type-${e.type}`;
          const teamBadge = e.teamOnly ? '<span class="tl-teamonly-badge">限定</span>' : '';
          const genderRibbon = !isExternal && this._hasEventGenderRestriction(e)
            ? `<span class="tl-event-gender-ribbon">${escapeHTML(this._getEventGenderTimelineRibbonText(e))}</span>`
            : '';
          const sportIcon = this._renderEventSportIcon(e, 'tl-event-sport-corner');
          const favHeart = this._favHeartHtml(this.isEventFavorited(e.id), 'Event', e.id);
          const iconStack = `<div class="tl-event-icons">${favHeart}${sportIcon}</div>`;

          html += `
            <div class="tl-event-row ${rowClass}${isEnded ? ' tl-past' : ''}" style="${e.pinned ? 'border:1px solid var(--warning);box-shadow:0 0 0 1px rgba(245,158,11,.12)' : ''}" onclick="App.openTimelineEventDetail('${e.id}', this)">
              ${genderRibbon}
              ${e.image ? `<div class="tl-event-thumb"><img src="${e.image}" loading="lazy"></div>` : ''}
              <div class="tl-event-info">
                <div class="tl-event-title-row"><div class="tl-event-title">${e.pinned ? '<span style="font-size:.62rem;padding:.08rem .35rem;border-radius:999px;border:1px solid var(--warning);color:var(--warning);font-weight:700;margin-right:.3rem">置頂</span>' : ''}${escapeHTML(e.title)}${teamBadge}</div></div>
                <div class="tl-event-meta">${metaText}</div>
              </div>
              <span class="tl-event-status ${statusCss}">${statusLabel}</span>
              ${iconStack}
              <span class="tl-event-arrow">›</span>
            </div>`;
        });

        html += `</div></div>`;
      });

      html += `</div>`;
    });

    container.textContent = '';
    if (html) {
      container.insertAdjacentHTML('beforeend', html);
    } else {
      const emptyDiv = document.createElement('div');
      emptyDiv.style.cssText = 'padding:1.5rem;font-size:.82rem;color:var(--text-muted);text-align:center';
      emptyDiv.textContent = t('activity.noMatch');
      container.appendChild(emptyDiv);
    }
    this._markPageSnapshotReady?.('page-activities');

    // 綁定左右滑動切換頁籤
    this._bindSwipeTabs('activity-list', 'activity-tabs',
      this.switchActivityTab,
      (btn) => btn.dataset.atab
    );
  },

});
