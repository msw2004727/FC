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
    const start = new Date(now);
    start.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const eventDays = new Set((events || []).map(e => {
      const date = typeof this._parseEventStartDate === 'function' ? this._parseEventStartDate(e.date) : null;
      return date ? date.toISOString().slice(0, 10) : '';
    }).filter(Boolean));
    const labels = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    const todayKey = now.toISOString().slice(0, 10);
    const days = labels.map((label, idx) => {
      const date = new Date(start);
      date.setDate(start.getDate() + idx);
      const key = date.toISOString().slice(0, 10);
      return '<div class="td-v2-day ' + (key === todayKey ? 'active' : '') + '"><span>' + label + '</span><strong>' + date.getDate() + '</strong>' + (eventDays.has(key) ? '<i></i>' : '') + '</div>';
    }).join('');
    return '<div class="td-v2-week">' + days + '</div>';
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
    const management = canManageMembers
      ? '<div class="td-v2-card td-v2-member-management"><div class="td-v2-section-head"><h3>成員管理</h3><button type="button" data-td-v2-action="toggle-member-management">' + (memberEditMode ? '完成' : '管理') + '</button></div>'
        + this._buildTeamMembersCard(t, canManageMembers, memberEditMode, staffIdentity) + '</div>'
      : '<div class="td-v2-card td-v2-member-management">' + this._buildTeamMembersCard(t, canManageMembers, memberEditMode, staffIdentity) + '</div>';
    return management;
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
