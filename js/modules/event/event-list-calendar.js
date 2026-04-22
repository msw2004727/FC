/* ================================================
   ToosterX — Event List: Calendar View (主入口 / lifecycle)
   依賴：event-calendar-constants.js、event-list-calendar-build.js、event-list-calendar-nav.js
   計畫書：docs/calendar-view-plan.md
   ================================================ */

Object.assign(App, {

  _calendarCurrentMonthKey: null,   // "YYYY-MM"（當前可視月）
  _calendarRenderedMonths: new Set(),
  _calendarScrollHandler: null,     // scroll 事件 handler（_bindCalendarScrollObserver 維護）
  _calendarProgrammaticScroll: false,  // 程式化捲動 guard（避免 scroll event race condition）
  _calScrollGuardTimer: null,

  /** 程式化設定 scrollTop + 短暫停用 scroll event update（避免 race） */
  _calSetScrollTopGuarded(scrollEl, newTop) {
    this._calendarProgrammaticScroll = true;
    scrollEl.scrollTop = newTop;
    clearTimeout(this._calScrollGuardTimer);
    this._calScrollGuardTimer = setTimeout(() => {
      this._calendarProgrammaticScroll = false;
    }, 250);
  },

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
      // 首次進入：當日置中（切 tab / 返回頁都會走此路徑、因為前置邏輯會清 state）
      this._renderCalendarMonths(container, this._calendarCurrentMonthKey, { centerToday: true });
      return;
    }
    this._updateCalendarMonthsContent(container);
  },

  _buildCalendarShell(container) {
    const weekHeadCells = WEEK_DAY_NAMES.map((d, i) => {
      const extra = i === 5 ? ' evt-cal-weekhead-sat'
        : i === 6 ? ' evt-cal-weekhead-sun' : '';
      return `<div class="evt-cal-weekhead-cell${extra}" aria-hidden="true">${d}</div>`;
    }).join('');
    container.innerHTML = `
      <div class="evt-cal-head">
        <div class="evt-cal-nav" role="toolbar" aria-label="月曆月份導覽">
          <button class="evt-cal-nav-btn" id="evt-cal-prev" aria-label="上個月" onclick="App._calendarGoPrev()">‹</button>
          <span class="evt-cal-nav-label" id="evt-cal-label" aria-live="polite"></span>
          <button class="evt-cal-nav-btn" id="evt-cal-next" aria-label="下個月" onclick="App._calendarGoNext()">›</button>
        </div>
        <div class="evt-cal-weekhead" role="presentation">${weekHeadCells}</div>
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

  _renderCalendarMonths(container, centerMonthKey, options = {}) {
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

    // 雙 rAF：第一次讓瀏覽器處理 append、第二次讀 offsetTop / clientHeight 才穩定
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        let scrollTo = null;
        if (options.centerToday) {
          // 當日 cell 置中於可視區（用戶要求 2026-04-22）
          const todayEl = scrollEl.querySelector('[data-today="1"]');
          if (todayEl) {
            scrollTo = todayEl.offsetTop + todayEl.offsetHeight / 2 - scrollEl.clientHeight / 2;
          }
        }
        if (scrollTo === null) {
          const current = scrollEl.querySelector(`[data-month="${centerMonthKey}"]`);
          if (current) scrollTo = current.offsetTop;
        }
        if (scrollTo !== null) {
          this._calSetScrollTopGuarded(scrollEl, Math.max(0, scrollTo));
        }
        this._updateCalendarLabel(centerMonthKey);
      });
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

  _calAddMonthKey(monthKey, delta) {
    const [y, m] = monthKey.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return this._calMonthKeyFromDate(d);
  },

  /**
   * 邊界 buffer：當前月為 DOM 最前/最後時自動追加相鄰月、讓用戶能持續下滑
   * 見 2026-04-22 用戶回報「手勢拖曳只能到下個月份」bug
   */
  _ensureCalendarBuffer(scrollEl) {
    if (!scrollEl) return;
    const months = Array.from(scrollEl.querySelectorAll('.evt-cal-month'));
    if (months.length === 0) return;
    const firstMk = months[0].dataset.month;
    const lastMk = months[months.length - 1].dataset.month;
    const current = this._calendarCurrentMonthKey;

    // 下邊界：當前 = 最後一個 → 追加下個月（未來無限）
    if (current === lastMk) {
      const nextKey = this._calAddMonthKey(current, 1);
      if (!this._calendarRenderedMonths.has(nextKey)) {
        const section = this._buildMonthSection(nextKey);
        scrollEl.appendChild(section);
        this._calendarRenderedMonths.add(nextKey);
      }
    }

    // 上邊界：當前 = 第一個、且未超過 MAX_PAST_MONTHS → 前面追加上個月
    if (current === firstMk) {
      const prevKey = this._calAddMonthKey(current, -1);
      if (!this._calendarRenderedMonths.has(prevKey)) {
        const [py, pm] = prevKey.split('-').map(Number);
        const d = new Date(py, pm - 1, 1);
        const now = new Date();
        const minDate = new Date(now.getFullYear(), now.getMonth() - MAX_PAST_MONTHS, 1);
        if (d >= minDate) {
          const prevScrollTop = scrollEl.scrollTop;
          const section = this._buildMonthSection(prevKey);
          scrollEl.insertBefore(section, scrollEl.firstChild);
          this._calendarRenderedMonths.add(prevKey);
          // 調整 scrollTop 保持視覺位置（防止視覺跳動）+ guard 避免 scroll event race
          requestAnimationFrame(() => {
            this._calSetScrollTopGuarded(scrollEl, prevScrollTop + section.offsetHeight);
          });
        }
      }
    }
  },

});
