/* ================================================
   ToosterX — Event List: Calendar Navigation
   月份切換、IntersectionObserver、鍵盤導航、+N 跳 timeline
   依賴：event-calendar-constants.js、event-list-calendar.js
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  月份 ←→ 按鈕
  // ══════════════════════════════════

  _calendarGoPrev() {
    const [y, m] = this._calendarCurrentMonthKey.split('-').map(Number);
    const prev = new Date(y, m - 2, 1);
    const now = new Date();
    const minDate = new Date(now.getFullYear(), now.getMonth() - MAX_PAST_MONTHS, 1);
    if (prev < minDate) { this.showToast?.('無更早資料'); return; }
    this._calendarCurrentMonthKey = this._calMonthKeyFromDate(prev);
    const container = document.getElementById('activity-calendar');
    this._renderCalendarMonths(container, this._calendarCurrentMonthKey);
  },

  _calendarGoNext() {
    const [y, m] = this._calendarCurrentMonthKey.split('-').map(Number);
    const next = new Date(y, m, 1);
    this._calendarCurrentMonthKey = this._calMonthKeyFromDate(next);
    const container = document.getElementById('activity-calendar');
    this._renderCalendarMonths(container, this._calendarCurrentMonthKey);
  },

  _updateCalendarLabel(monthKey) {
    const label = document.getElementById('evt-cal-label');
    if (label) label.textContent = this._calMonthLabelText(monthKey);
    const prevBtn = document.getElementById('evt-cal-prev');
    if (prevBtn) {
      const [y, m] = monthKey.split('-').map(Number);
      const now = new Date();
      const minMonth = new Date(now.getFullYear(), now.getMonth() - MAX_PAST_MONTHS, 1);
      const current = new Date(y, m - 1, 1);
      prevBtn.disabled = current <= minMonth;
    }
  },

  // ══════════════════════════════════
  //  IntersectionObserver（scroll-snap 切月時同步 label）
  // ══════════════════════════════════

  _bindCalendarScrollObserver(scrollEl) {
    if (typeof IntersectionObserver === 'undefined') return;
    // 清除舊 observer
    try { this._calendarScrollObserver?.disconnect?.(); } catch (_) {}
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.intersectionRatio >= 0.5) {
          const mk = entry.target.dataset.month;
          if (mk && mk !== this._calendarCurrentMonthKey) {
            this._calendarCurrentMonthKey = mk;
            this._updateCalendarLabel(mk);
          }
        }
      });
    }, { root: scrollEl, threshold: [0.5] });
    this._calendarScrollObserver = io;
    scrollEl.querySelectorAll('.evt-cal-month').forEach(el => io.observe(el));
    // 觀察後續動態新增的月份
    new MutationObserver((muts) => {
      muts.forEach(mu => mu.addedNodes.forEach(n => {
        if (n.classList?.contains('evt-cal-month')) io.observe(n);
      }));
    }).observe(scrollEl, { childList: true });
  },

  // ══════════════════════════════════
  //  鍵盤導航（WCAG 2.1.2 無 keyboard trap）
  // ══════════════════════════════════

  _handleCalendarKeydown(ev) {
    const { key, target } = ev;
    // Enter / Space 在活動格 → 點擊
    if (key === 'Enter' || key === ' ') {
      const evCell = target.closest?.('.evt-cal-event[data-id]');
      if (evCell) { ev.preventDefault(); this.showEventDetail(evCell.dataset.id); return; }
      const moreCell = target.closest?.('.evt-cal-more[data-jump-date]');
      if (moreCell) { ev.preventDefault(); this._jumpToTimelineDate(moreCell.dataset.jumpDate); return; }
    }
    // Escape 跳回 tab button（離開月曆）
    if (key === 'Escape') {
      document.querySelector('[data-atab="calendar"]')?.focus();
      ev.preventDefault();
      return;
    }
    // 方向鍵只在 gridcell 有效
    const cell = target.closest?.('.evt-cal-day[role="gridcell"]');
    if (!cell) return;
    let dx = 0, dy = 0;
    switch (key) {
      case 'ArrowUp':    dy = -1; break;
      case 'ArrowDown':  dy = +1; break;
      case 'ArrowLeft':  dx = -1; break;
      case 'ArrowRight': dx = +1; break;
      case 'Home':       dx = -999; break;
      case 'End':        dx = +999; break;
      case 'PageUp':     this._calendarGoPrev(); ev.preventDefault(); return;
      case 'PageDown':   this._calendarGoNext(); ev.preventDefault(); return;
      case 'Enter': case ' ': {
        const first = cell.querySelector('.evt-cal-event[data-id]');
        if (first) { first.click(); ev.preventDefault(); }
        return;
      }
      default: return;  // Tab 等其他鍵放行（無 keyboard trap）
    }
    const row = parseInt(cell.getAttribute('aria-rowindex') || '1', 10);
    const col = parseInt(cell.getAttribute('aria-colindex') || '1', 10);
    const targetRow = row + dy;
    let targetCol = dx === -999 ? 1 : dx === 999 ? 7 : col + dx;
    if (targetCol < 1) targetCol = 7;
    if (targetCol > 7) targetCol = 1;
    const container = cell.closest('.evt-cal-month');
    const next = container?.querySelector(`[aria-rowindex="${targetRow}"][aria-colindex="${targetCol}"]`);
    if (next) { next.focus(); ev.preventDefault(); }
  },

  // ══════════════════════════════════
  //  +N more 跳回 timeline 並錨點到該日
  // ══════════════════════════════════

  _jumpToTimelineDate(dateKey) {
    if (!dateKey) return;
    this.switchActivityTab?.('normal');
    requestAnimationFrame(() => {
      const anchor = document.querySelector(`#activity-list [data-date-anchor="${dateKey}"]`);
      if (anchor) {
        anchor.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    });
  },

});
