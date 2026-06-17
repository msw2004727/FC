/* ================================================
   SportHub - Team Detail V2: Events / Members / Record / Feed
   ================================================ */

Object.assign(App, {

  _buildTeamDetailV2EventsPanel(t) {
    const events = typeof this._getTeamFutureEvents === 'function' ? this._getTeamFutureEvents(t.id) : [];
    const create = this._canCreateTeamDetailActivity?.(t.id)
      ? '<button class="td-v2-ghost" type="button" data-td-v2-action="create-event">+ 新增俱樂部活動</button>'
      : '';
    return '<div class="td-v2-card"><div class="td-v2-section-head"><h3>本週行事曆</h3><span>' + events.length + ' 場活動</span></div>'
      + this._buildTeamDetailV2WeekStrip(events) + '</div>'
      + '<div class="td-v2-card"><div class="td-v2-section-head"><h3>即將舉辦</h3><span>' + events.length + ' 場</span></div>'
      + this._buildTeamDetailV2EventRows(t, 8) + create + '</div>';
  },

  _buildTeamDetailV2WeekStrip(events) {
    const now = new Date();
    const eventDays = this._getTeamDetailV2EventDaySet(events);
    const todayKey = this._getTeamDetailV2DateKey(now);
    const startOffset = 0;
    const endOffset = 13;
    const days = this._renderTeamDetailV2WeekDays(startOffset, endOffset, eventDays, todayKey);
    return '<div class="td-v2-week" role="list" tabindex="0" aria-label="Activity calendar" data-range-start="' + startOffset + '" data-range-end="' + endOffset + '" data-event-days="' + escapeHTML(Array.from(eventDays).join('|')) + '" onscroll="App._handleTeamDetailV2WeekScroll(this)" onwheel="App._wheelTeamDetailV2Week(this,event)" onpointerdown="App._startTeamDetailV2WeekDrag(this,event)" onpointermove="App._moveTeamDetailV2WeekDrag(this,event)" onpointerup="App._endTeamDetailV2WeekDrag(this,event)" onpointercancel="App._endTeamDetailV2WeekDrag(this,event)" onpointerleave="App._endTeamDetailV2WeekDrag(this,event)">' + days + '</div>';
  },

  _getTeamDetailV2EventDaySet(events) {
    return new Set((events || []).map(e => {
      const date = typeof this._parseEventStartDate === 'function' ? this._parseEventStartDate(e.date) : null;
      return this._getTeamDetailV2DateKey(date);
    }).filter(Boolean));
  },

  _getTeamDetailV2DateKey(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  _getTeamDetailV2DateFromOffset(offset) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + Number(offset || 0));
    return date;
  },

  _renderTeamDetailV2WeekDays(startOffset, endOffset, eventDays, todayKey) {
    const days = [];
    for (let offset = Number(startOffset); offset <= Number(endOffset); offset += 1) {
      days.push(this._buildTeamDetailV2WeekDay(this._getTeamDetailV2DateFromOffset(offset), eventDays, todayKey));
    }
    return days.join('');
  },

  _buildTeamDetailV2WeekDay(date, eventDays, todayKey) {
    const key = this._getTeamDetailV2DateKey(date);
    const labels = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const weekday = date.getDay();
    const weekendClass = weekday === 6 ? ' weekend-sat' : (weekday === 0 ? ' weekend-sun' : '');
    const activeClass = key === todayKey ? ' active' : '';
    const dot = eventDays?.has(key) ? '<i></i>' : '';
    return '<div class="td-v2-day' + weekendClass + activeClass + '" data-date="' + escapeHTML(key) + '" role="listitem"><span>' + labels[weekday] + '</span><strong>' + date.getDate() + '</strong>' + dot + '</div>';
  },

  _readTeamDetailV2WeekEventDays(el) {
    return new Set(String(el?.dataset?.eventDays || '').split('|').filter(Boolean));
  },

  _extendTeamDetailV2WeekRange(el, direction) {
    if (!el?.dataset) return;
    const blockSize = 14;
    const eventDays = this._readTeamDetailV2WeekEventDays(el);
    const todayKey = this._getTeamDetailV2DateKey(new Date());
    const rangeStart = Number(el.dataset.rangeStart || 0);
    const rangeEnd = Number(el.dataset.rangeEnd || 0);
    if (direction === 'next') {
      const nextStart = rangeEnd + 1;
      const nextEnd = rangeEnd + blockSize;
      el.insertAdjacentHTML('beforeend', this._renderTeamDetailV2WeekDays(nextStart, nextEnd, eventDays, todayKey));
      el.dataset.rangeEnd = String(nextEnd);
      return;
    }
    const prevStart = rangeStart - blockSize;
    const prevEnd = rangeStart - 1;
    const previousWidth = el.scrollWidth || 0;
    el.insertAdjacentHTML('afterbegin', this._renderTeamDetailV2WeekDays(prevStart, prevEnd, eventDays, todayKey));
    el.dataset.rangeStart = String(prevStart);
    el.scrollLeft += Math.max(0, (el.scrollWidth || 0) - previousWidth);
  },

  _handleTeamDetailV2WeekScroll(el) {
    this._loadTeamDetailV2WeekNext(el);
  },

  _loadTeamDetailV2WeekPrevious(el) {
    if (!el || el.dataset?.loadingWeek === '1' || Number(el.dataset?.rangeStart || 0) <= -182) return false;
    if ((el.scrollLeft || 0) > 1) return false;
    el.dataset.loadingWeek = '1';
    this._extendTeamDetailV2WeekRange(el, 'prev');
    delete el.dataset.loadingWeek;
    return true;
  },

  _wheelTeamDetailV2Week(el, event) {
    if (!el || !event) return;
    if ((event.deltaX || 0) < -12) {
      this._loadTeamDetailV2WeekPrevious(el);
      return;
    }
    if ((event.deltaX || 0) > 12) {
      this._handleTeamDetailV2WeekScroll(el);
    }
  },

  _maybeLoadTeamDetailV2WeekPreviousFromDrag(el, dragDistance, event) {
    if (dragDistance <= 24) return false;
    const loaded = this._loadTeamDetailV2WeekPrevious(el);
    if (!loaded) return false;
    el.dataset.dragStartX = String(event?.clientX || 0);
    el.dataset.dragStartScroll = String(el.scrollLeft || 0);
    return true;
  },

  _loadTeamDetailV2WeekNext(el) {
    if (!el || el.dataset?.loadingWeek === '1') return;
    const threshold = Math.max(80, (el.clientWidth || 0) * 0.65);
    const scrollRight = (el.scrollLeft || 0) + (el.clientWidth || 0);
    if (scrollRight >= (el.scrollWidth || 0) - threshold) {
      el.dataset.loadingWeek = '1';
      this._extendTeamDetailV2WeekRange(el, 'next');
      delete el.dataset.loadingWeek;
    }
  },

  _startTeamDetailV2WeekDrag(el, event) {
    if (!el || !event || (event.pointerType === 'mouse' && event.button !== 0)) return;
    el.dataset.dragging = '1';
    el.dataset.dragStartX = String(event.clientX || 0);
    el.dataset.dragStartScroll = String(el.scrollLeft || 0);
    el.classList?.add('dragging');
    try { el.setPointerCapture?.(event.pointerId); } catch (_) {}
  },

  _moveTeamDetailV2WeekDrag(el, event) {
    if (!el || el.dataset?.dragging !== '1' || !event) return;
    const dragDistance = (event.clientX || 0) - Number(el.dataset.dragStartX || 0);
    el.scrollLeft = Number(el.dataset.dragStartScroll || 0) - dragDistance;
    event.preventDefault?.();
    if (this._maybeLoadTeamDetailV2WeekPreviousFromDrag(el, dragDistance, event)) return;
    this._loadTeamDetailV2WeekNext(el);
  },

  _endTeamDetailV2WeekDrag(el, event) {
    if (!el) return;
    delete el.dataset.dragging;
    delete el.dataset.dragStartX;
    delete el.dataset.dragStartScroll;
    el.classList?.remove('dragging');
    try { el.releasePointerCapture?.(event?.pointerId); } catch (_) {}
  },

  _buildTeamDetailV2EventRows(t, limit = 3) {
    const teamId = typeof t === 'string' ? t : t?.id;
    const events = typeof this._getTeamFutureEvents === 'function' ? this._getTeamFutureEvents(teamId) : [];
    const visible = events.slice(0, limit);
    if (!visible.length) return '<div class="td-v2-empty">目前沒有即將開始的俱樂部活動</div>';
    return visible.map(e => {
      const date = typeof this._parseEventStartDate === 'function' ? this._parseEventStartDate(e.date) : null;
      const month = date ? `${date.getMonth() + 1}月` : escapeHTML(String(e.date || '').split(' ')[0] || '');
      const day = date ? date.getDate() : '';
      const statusKey = typeof this._getEventEffectiveStatus === 'function' ? this._getEventEffectiveStatus(e) : e.status;
      const status = statusKey === 'full' ? '已額滿' : (statusKey === 'upcoming' ? '即將開放' : '報名中');
      const countText = e.max > 0 ? ` · ${Number(e.current || 0)}/${Number(e.max || 0)} 名` : '';
      const image = this._getEventImageUrl?.(e, 'cover') || e?.imageVariants?.cover || e?.coverImage || e?.image || '';
      const cover = image
        ? '<span class="td-v2-event-cover"><img src="' + escapeHTML(image) + '" alt="" loading="lazy" decoding="async"></span>'
        : '<span class="td-v2-event-cover empty"><em>' + escapeHTML(month) + '</em><strong>' + escapeHTML(day || '') + '</strong></span>';
      return '<button class="td-v2-event-card" type="button" data-td-v2-action="event" data-event-id="' + escapeHTML(e.id || '') + '">'
        + cover
        + '<span class="td-v2-event-card-body"><span class="td-v2-event-date"><em>' + escapeHTML(month) + '</em><strong>' + escapeHTML(day || '') + '</strong></span>'
        + '<span class="td-v2-event-main"><strong>' + escapeHTML(e.title || '未命名活動') + '<i class="' + (statusKey === 'full' ? 'full' : '') + '">' + escapeHTML(status) + '</i></strong>'
        + '<em>' + escapeHTML([String(e.date || '').split(' ')[1] || '', e.location || ''].filter(Boolean).join(' · ') + countText) + '</em></span><b>›</b></span></button>';
    }).join('');
  },

  _buildTeamDetailV2MembersPanel(t, canManageMembers, memberEditMode, staffIdentity) {
    return '<div class="td-v2-member-management">'
      + this._buildTeamMembersCard(t, canManageMembers, memberEditMode, staffIdentity)
      + '</div>';
  },

  _buildTeamDetailV2MemberGrid(rows) {
    if (!rows.length) return '<div class="td-v2-empty">尚無成員資料</div>';
    return '<div class="td-v2-member-grid">' + rows.map((row, idx) => {
      const name = row.name || row.uid || '成員';
      const role = row.tag || (row.roles ? Array.from(row.roles).join('、') : '') || (row.isStudent ? '學員' : '會員');
      const initial = String(name).trim().charAt(0) || '?';
      const uid = row.uid ? ' data-user-uid="' + escapeHTML(row.uid) + '"' : '';
      const nameClass = typeof this._getTeamDetailMemberNameClass === 'function'
        ? this._getTeamDetailMemberNameClass(row)
        : 'td-member-name-pill uc-user';
      return '<button class="td-v2-member" type="button" data-td-v2-action="user" data-user-name="' + escapeHTML(name) + '"' + uid + '>'
        + '<span class="td-v2-member-av c' + ((idx % 5) + 1) + '">' + escapeHTML(initial) + '</span>'
        + '<strong><span class="' + escapeHTML(nameClass) + '">' + escapeHTML(name) + '</span></strong><em>' + escapeHTML(role) + '</em></button>';
    }).join('') + '</div>';
  },

  _buildTeamDetailV2RecordPanel(t, totalGames, winRate) {
    const wins = Number(t.wins || 0);
    const draws = Number(t.draws || 0);
    const losses = Number(t.losses || 0);
    const circle = Math.max(0, Math.min(289, Math.round((winRate || 0) / 100 * 289)));
    const row = (label, value, cls) => {
      const pct = totalGames > 0 ? Math.round(value / totalGames * 100) : 0;
      return '<div class="td-v2-record-row"><span class="' + cls + '">' + label + '</span><div><i style="width:' + pct + '%"></i></div><strong>' + value + '</strong></div>';
    };
    const tournaments = this._isTeamDetailSectionVisible?.(t, 'matches') ? this._renderTeamTournaments(t.id) : '';
    return '<div class="td-v2-card"><div class="td-v2-section-head"><h3>俱樂部戰績</h3><span>近況總覽</span></div>'
      + '<div class="td-v2-record-hero"><div class="td-v2-donut"><svg viewBox="0 0 110 110"><circle cx="55" cy="55" r="46"></circle><circle cx="55" cy="55" r="46" style="stroke-dasharray:' + circle + ' 289"></circle></svg><div><strong>' + (totalGames > 0 ? winRate + '%' : '-') + '</strong><span>勝率</span></div></div>'
      + '<div class="td-v2-record-list">' + row('勝', wins, 'w') + row('和', draws, 'd') + row('負', losses, 'l') + '</div></div></div>'
      + (tournaments ? '<div class="td-v2-card td-v2-tournaments">' + tournaments + '</div>' : '');
  },

  _buildTeamDetailV2FeedPanel(t) {
    const posts = Array.isArray(t.feed) ? t.feed.slice(0, 10) : [];
    if (!posts.length) {
      return '<div class="td-v2-card"><div class="td-v2-section-head"><h3>俱樂部動態</h3><span>公告與貼文</span></div><div class="td-v2-empty">目前沒有公開動態</div></div>';
    }
    const rows = posts.map(post => {
      const name = post.name || post.authorName || post.author || '俱樂部';
      const text = post.text || post.body || post.content || '';
      const time = post.time || post.createdAtText || post.date || '';
      return '<article class="td-v2-post"><div class="td-v2-post-head"><span>' + escapeHTML(String(name).charAt(0) || '俱') + '</span><div><strong>' + escapeHTML(name) + '</strong><em>' + escapeHTML(time) + '</em></div></div><p>' + escapeHTML(text) + '</p></article>';
    }).join('');
    return '<div class="td-v2-card"><div class="td-v2-section-head"><h3>俱樂部動態</h3><span>' + posts.length + ' 則</span></div>' + rows + '</div>';
  },

});
