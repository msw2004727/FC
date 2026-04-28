/* ================================================
   ToosterX — Event List: Calendar DOM Builders
   月份 section / 日期格 / 活動格 / group by date
   依賴：event-calendar-constants.js、event-list-helpers.js
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  單月區塊（週標題 + 7xN 日期格）
  // ══════════════════════════════════

  _buildMonthSection(monthKey) {
    const section = document.createElement('section');
    section.className = 'evt-cal-month';
    section.dataset.month = monthKey;
    section.setAttribute('aria-label', this._calMonthLabelText(monthKey));
    // 週標題已移到 shell（.evt-cal-head/.evt-cal-weekhead）、每月只放 grid
    section.innerHTML = `
      <div class="evt-cal-grid" role="rowgroup">${this._buildMonthGridInnerHTML(monthKey)}</div>
    `;
    return section;
  },

  _calMonthLabelText(monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    return MONTH_FORMATTER.format(new Date(y, m - 1, 1));
  },

  _buildMonthGridInnerHTML(monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    const shape = getMonthGridShape(y, m - 1);
    const { firstWeekday, daysInMonth, weekRows } = shape;
    const totalCells = weekRows * 7;
    const eventsByDate = this._groupEventsByDateForMonth(y, m - 1);
    const today = new Date();
    const todayKey = dateObjToKey(today);
    const todayTs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

    let html = '';
    for (let i = 0; i < totalCells; i++) {
      const weekRow = Math.floor(i / 7) + 1;
      const weekCol = (i % 7) + 1;
      const dayOffset = i - firstWeekday;
      let cellDateObj, isOutside, dayNum;
      if (dayOffset < 0 || dayOffset >= daysInMonth) {
        cellDateObj = new Date(y, m - 1, dayOffset + 1);
        isOutside = true;
        dayNum = cellDateObj.getDate();
      } else {
        cellDateObj = new Date(y, m - 1, dayOffset + 1);
        isOutside = false;
        dayNum = dayOffset + 1;
      }
      const dateKey = dateObjToKey(cellDateObj);
      const isPast = cellDateObj.getTime() < todayTs;  // 嚴格小於今天 00:00
      const events = eventsByDate.get(dateKey) || [];
      html += this._buildDayCellHTML({
        dateKey, dayNum, isOutside,
        isToday: dateKey === todayKey,
        isPast,
        events, weekRow, weekCol,
      });
    }
    return html;
  },

  // ══════════════════════════════════
  //  日期格 HTML
  // ══════════════════════════════════

  _buildDayCellHTML({ dateKey, dayNum, isOutside, isToday, isPast, events, weekRow, weekCol }) {
    const sorted = this._sortEventsForCalendarCell(events);
    const sportCounts = this._buildCalendarSportCounts(sorted);
    const hasPinned = sorted.some(e => e?.pinned);
    const countAttr = sorted.length === 0 ? '0'
      : sorted.length <= 2 ? String(sorted.length)
      : sorted.length === 3 ? '3' : '4+';
    const summary = sorted.length === 0
      ? `${dayNum}日，無活動`
      : `${dayNum}日，${this._formatCalendarSportCountSummary(sportCounts)}，按 Enter 展開`;

    const eventsHTML = this._buildCalendarSportCountHTML(dateKey, sportCounts);
    const emptyMark = sorted.length === 0
      ? `<div class="evt-cal-empty-mark" aria-hidden="true">—</div>` : '';

    return `<div class="evt-cal-day"
          role="gridcell"
          tabindex="0"
          data-date="${escapeHTML(dateKey)}"
          data-event-count="${countAttr}"
          data-has-pinned="${hasPinned ? '1' : '0'}"
          data-today="${isToday ? '1' : '0'}"
          data-outside="${isOutside ? '1' : '0'}"
          data-past="${isPast ? '1' : '0'}"
          aria-rowindex="${weekRow}"
          aria-colindex="${weekCol}"
          aria-label="${escapeHTML(summary)}">
      <div class="evt-cal-day-num">${dayNum}</div>
      ${eventsHTML}${emptyMark}
    </div>`;
  },

  // ══════════════════════════════════
  //  活動格 HTML（XSS 防禦：data-id + event delegation）
  // ══════════════════════════════════

  _buildEventCellHTML(event) {
    const sportDef = getSportDef(event.sportTag || 'other');
    const isPinned = !!event.pinned;
    const pinnedClass = isPinned ? ' evt-cal-is-pinned' : '';
    const status = event.status || 'open';
    const stateClass = this._getEventSignupStateClassForCal(event);
    const timeStr = (event.date || '').split(' ')[1]?.split('~')[0] || '';
    const statePrefix = isPinned ? '置頂活動：'
      : status === 'cancelled' ? '已取消活動：'
      : status === 'ended' ? '已結束活動：' : '';
    const label = `${statePrefix}${event.title || ''}，${sportDef.label}${timeStr ? '，' + timeStr : ''}`;

    return `<div class="evt-cal-event${pinnedClass}${stateClass ? ' ' + stateClass : ''}"
            data-id="${escapeHTML(event.id)}"
            data-status="${escapeHTML(status)}"
            style="--sport-color: var(${sportDef.var})"
            role="button"
            tabindex="0"
            aria-label="${escapeHTML(label)}"
            title="${escapeHTML(event.title || '')}">
      <span class="evt-cal-emoji" aria-hidden="true">${sportDef.emoji}</span>
      ${timeStr ? `<span class="evt-cal-time">${escapeHTML(timeStr)}</span>` : ''}
      <span class="evt-cal-title">${escapeHTML(event.title || '')}</span>
    </div>`;
  },

  _buildCalendarSportCounts(events) {
    const counts = new Map();
    (events || []).forEach(event => {
      const sportKey = this._getCalendarEventSportKey(event);
      counts.set(sportKey, (counts.get(sportKey) || 0) + 1);
    });

    const orderMap = this._getCalendarSportOrderMap();
    return Array.from(counts, ([sportKey, count]) => ({ sportKey, count }))
      .sort((a, b) => {
        const ao = orderMap.get(a.sportKey) ?? Number.MAX_SAFE_INTEGER;
        const bo = orderMap.get(b.sportKey) ?? Number.MAX_SAFE_INTEGER;
        if (ao !== bo) return ao - bo;
        return this._getCalendarSportLabel(a.sportKey)
          .localeCompare(this._getCalendarSportLabel(b.sportKey), 'zh-TW');
      });
  },

  _getCalendarEventSportKey(event) {
    if (typeof this._getEventSportTag === 'function') return this._getEventSportTag(event);
    const key = typeof getSportKeySafe === 'function'
      ? getSportKeySafe(event?.sportTag)
      : String(event?.sportTag || '').trim();
    return key || 'football';
  },

  _getCalendarSportOrderMap() {
    const options = typeof EVENT_SPORT_OPTIONS !== 'undefined' && Array.isArray(EVENT_SPORT_OPTIONS)
      ? EVENT_SPORT_OPTIONS : [];
    return new Map(options.map((item, index) => [item.key, index]));
  },

  _getCalendarSportLabel(sportKey) {
    return typeof getSportLabelByKey === 'function'
      ? getSportLabelByKey(sportKey)
      : (sportKey || 'football');
  },

  _buildCalendarSportCountHTML(dateKey, sportCounts) {
    if (!sportCounts.length) return '';
    const summary = this._formatCalendarSportCountSummary(sportCounts);
    const itemsHTML = sportCounts.map(({ sportKey, count }) => {
      const sportDef = typeof getSportDef === 'function'
        ? getSportDef(sportKey)
        : { var: '--sport-other' };
      const label = this._getCalendarSportLabel(sportKey);
      return `<span class="evt-cal-sport-count-item"
              style="--sport-color: var(${sportDef.var || '--sport-other'})"
              title="${escapeHTML(`${label} x${count}`)}">
        ${this._renderCalendarSportCountIcon(sportKey)}
        <span class="evt-cal-sport-count-text">x${count}</span>
      </span>`;
    }).join('');
    return `<div class="evt-cal-sport-summary"
            role="button"
            tabindex="0"
            data-jump-date="${escapeHTML(dateKey)}"
            aria-label="${escapeHTML(`${summary}，跳到直瀑視圖`)}">
      ${itemsHTML}
    </div>`;
  },

  _renderCalendarSportCountIcon(sportKey) {
    if (typeof getSportIconSvg === 'function') {
      return getSportIconSvg(sportKey, 'evt-cal-sport-icon');
    }
    const emoji = typeof SPORT_ICON_EMOJI !== 'undefined'
      ? (SPORT_ICON_EMOJI[sportKey] || SPORT_ICON_EMOJI.football || '')
      : '';
    return `<span class="sport-emoji evt-cal-sport-icon" aria-hidden="true">${emoji}</span>`;
  },

  _formatCalendarSportCountSummary(sportCounts) {
    return (sportCounts || [])
      .map(({ sportKey, count }) => `${this._getCalendarSportLabel(sportKey)} x${count}`)
      .join('、');
  },

  _getEventSignupStateClassForCal(event) {
    try {
      if (!this._isUserSignedUp?.(event)) return '';
      if (this._isUserOnWaitlist?.(event)) return 'is-waitlisted';
      return 'is-signed-up';
    } catch (_) { return ''; }
  },

  // ══════════════════════════════════
  //  資料：event group by date
  // ══════════════════════════════════

  _groupEventsByDateForMonth(year, monthIdx) {
    let events = this._getVisibleEvents();
    events = this._filterByRegionTab(events);
    events = this._filterBySportTag(events);
    const filterType = document.getElementById('activity-filter-type')?.value || '';
    const filterKw = (document.getElementById('activity-filter-keyword')?.value || '').trim().toLowerCase();
    if (filterType) events = events.filter(e => e.type === filterType);
    if (filterKw) {
      events = events.filter(e =>
        (e.title || '').toLowerCase().includes(filterKw) ||
        (e.location || '').toLowerCase().includes(filterKw)
      );
    }
    const map = new Map();
    const monthStart = new Date(year, monthIdx, 1).getTime();
    const monthEnd = new Date(year, monthIdx + 1, 1).getTime();
    events.forEach(e => {
      const key = toDateKey(e.date);
      if (!key) return;
      const [ey, em, ed] = key.split('-').map(Number);
      const ts = new Date(ey, em - 1, ed).getTime();
      if (ts < monthStart || ts >= monthEnd) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(e);
    });
    return map;
  },

  _sortEventsForCalendarCell(events) {
    return [...events].sort((a, b) => {
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
      return ta.localeCompare(tb);
    });
  },

});
