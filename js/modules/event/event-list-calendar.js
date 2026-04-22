/* ================================================
   ToosterX — Event List: Calendar View (主入口 / lifecycle)
   依賴：event-calendar-constants.js、event-list-calendar-build.js、event-list-calendar-nav.js
   計畫書：docs/calendar-view-plan.md
   ================================================ */

Object.assign(App, {

  _calendarCurrentMonthKey: null,   // "YYYY-MM"（當前可視月）
  _calendarRenderedMonths: new Set(),
  _calendarScrollObserver: null,

  /**
   * 月曆主 render 入口
   * 由 _setActivityTab('calendar') / realtime / filter 變化觸發
   */
  _renderActivityCalendar() {
    if (this.currentPage !== 'page-activities') return;
    if (this._activityActiveTab !== 'calendar') return;
    const container = document.getElementById('activity-calendar');
    if (!container) return;

    try { this._autoEndExpiredEvents?.(); } catch (_) {}

    if (!this._calendarCurrentMonthKey) {
      const now = new Date();
      this._calendarCurrentMonthKey = this._calMonthKeyFromDate(now);
      this._buildCalendarShell(container);
      this._renderCalendarMonths(container, this._calendarCurrentMonthKey);
      return;
    }
    this._updateCalendarMonthsContent(container);
  },

  _buildCalendarShell(container) {
    container.innerHTML = `
      <div class="evt-cal-nav" role="toolbar" aria-label="月曆月份導覽">
        <button class="evt-cal-nav-btn" id="evt-cal-prev" aria-label="上個月" onclick="App._calendarGoPrev()">‹</button>
        <span class="evt-cal-nav-label" id="evt-cal-label" aria-live="polite"></span>
        <button class="evt-cal-nav-btn" id="evt-cal-next" aria-label="下個月" onclick="App._calendarGoNext()">›</button>
      </div>
      <div class="evt-cal-container" id="evt-cal-scroll" role="grid" aria-label="活動月曆"></div>
    `;
    const scrollEl = container.querySelector('#evt-cal-scroll');
    this._bindCalendarScrollObserver(scrollEl);
    scrollEl.addEventListener('keydown', (ev) => this._handleCalendarKeydown(ev));
    scrollEl.addEventListener('click', (ev) => this._handleCalendarClick(ev));
  },

  _handleCalendarClick(ev) {
    const moreEl = ev.target.closest?.('.evt-cal-more[data-jump-date]');
    if (moreEl) { this._jumpToTimelineDate(moreEl.dataset.jumpDate); return; }
    const eventEl = ev.target.closest?.('.evt-cal-event[data-id]');
    if (eventEl) this.showEventDetail(eventEl.dataset.id);
  },

  _renderCalendarMonths(container, centerMonthKey) {
    const scrollEl = container.querySelector('#evt-cal-scroll');
    if (!scrollEl) return;
    scrollEl.innerHTML = '';
    this._calendarRenderedMonths.clear();

    const targetMonths = this._getWindowedMonthKeys(centerMonthKey);
    targetMonths.forEach(mk => {
      const monthEl = this._buildMonthSection(mk);
      scrollEl.appendChild(monthEl);
      this._calendarRenderedMonths.add(mk);
    });

    requestAnimationFrame(() => {
      const current = scrollEl.querySelector(`[data-month="${centerMonthKey}"]`);
      if (current) current.scrollIntoView({ block: 'start', behavior: 'auto' });
      this._updateCalendarLabel(centerMonthKey);
    });
  },

  _updateCalendarMonthsContent(container) {
    const scrollEl = container.querySelector('#evt-cal-scroll');
    if (!scrollEl) return;
    this._calendarRenderedMonths.forEach(mk => {
      const el = scrollEl.querySelector(`[data-month="${mk}"]`);
      if (!el) return;
      const gridEl = el.querySelector('.evt-cal-grid');
      if (gridEl) gridEl.innerHTML = this._buildMonthGridInnerHTML(mk);
    });
  },

  _getWindowedMonthKeys(centerKey) {
    const [cy, cm] = centerKey.split('-').map(Number);
    const keys = [];
    const now = new Date();
    const minDate = new Date(now.getFullYear(), now.getMonth() - MAX_PAST_MONTHS, 1);
    for (let off = -1; off <= 1; off++) {
      const d = new Date(cy, cm - 1 + off, 1);
      if (d < minDate) continue;
      keys.push(this._calMonthKeyFromDate(d));
    }
    return keys;
  },

  _calMonthKeyFromDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  },

});
