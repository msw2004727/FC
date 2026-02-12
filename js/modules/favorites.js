/* ================================================
   SportHub — Favorites & Activity Reminders
   依賴：config.js, api-service.js
   ================================================ */
Object.assign(App, {

  // ══════════════════════════════════
  //  Favorites
  // ══════════════════════════════════

  _favSortMode: 'time',

  _getFavorites() {
    const user = ApiService.getCurrentUser();
    return (user && user.favorites) || { events: [], tournaments: [] };
  },

  /** 賽事狀態文字 → CSS class 對照 */
  _tournStatusCss(t) {
    if (!t) return { css: 'ended', label: '已結束' };
    const isEnded = (typeof this.isTournamentEnded === 'function') ? this.isTournamentEnded(t) : !!t.ended;
    if (isEnded) return { css: 'ended', label: '已結束' };
    const status = (typeof this.getTournamentStatus === 'function') ? this.getTournamentStatus(t) : (t.status || '');
    const map = { '報名中': 'open', '截止報名': 'full', '準備中': 'upcoming', '已結束': 'ended' };
    return { css: map[status] || 'open', label: status || '報名中' };
  },

  /** 狀態排序權重（open 最前，ended 最後） */
  _statusSortWeight(css) {
    const w = { open: 1, upcoming: 2, full: 3, ended: 4, cancelled: 5 };
    return w[css] || 9;
  },

  toggleFavoriteEvent(eventId) {
    const favs = this._getFavorites();
    const idx = favs.events.indexOf(eventId);
    const added = idx < 0;
    if (added) { favs.events.push(eventId); } else { favs.events.splice(idx, 1); }
    ApiService.updateCurrentUser({ favorites: favs });
    this._syncFavHearts('Event', eventId, added);
    this.renderProfileFavorites();
    this.showToast(added ? t('toast.favoriteAdded') : t('toast.favoriteRemoved'));
  },

  toggleFavoriteTournament(tournId) {
    const favs = this._getFavorites();
    const idx = favs.tournaments.indexOf(tournId);
    const added = idx < 0;
    if (added) { favs.tournaments.push(tournId); } else { favs.tournaments.splice(idx, 1); }
    ApiService.updateCurrentUser({ favorites: favs });
    this._syncFavHearts('Tournament', tournId, added);
    this.renderProfileFavorites();
    this.showToast(added ? t('toast.favoriteAdded') : t('toast.favoriteRemoved'));
  },

  /** 立即切換頁面上所有匹配的心形按鈕外觀 */
  _syncFavHearts(type, id, isFav) {
    document.querySelectorAll(`.fav-heart[data-fav-type="${type}"][data-fav-id="${id}"]`).forEach(btn => {
      const svg = btn.querySelector('svg');
      if (!svg) return;
      if (isFav) {
        btn.classList.add('active');
        svg.setAttribute('fill', 'var(--danger)');
        svg.setAttribute('stroke', 'var(--danger)');
        btn.title = '取消收藏';
      } else {
        btn.classList.remove('active');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'var(--text-muted)');
        btn.title = '加入收藏';
      }
    });
  },

  isEventFavorited(eventId) {
    return this._getFavorites().events.includes(eventId);
  },

  isTournamentFavorited(tournId) {
    return this._getFavorites().tournaments.includes(tournId);
  },

  _favHeartHtml(isFav, type, id) {
    const cls = isFav ? 'fav-heart active' : 'fav-heart';
    return `<button class="${cls}" data-fav-type="${type}" data-fav-id="${id}" onclick="event.stopPropagation();App.toggleFavorite${type}('${id}')" title="${isFav ? '取消收藏' : '加入收藏'}">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="${isFav ? 'var(--danger)' : 'none'}" stroke="${isFav ? 'var(--danger)' : 'var(--text-muted)'}" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
    </button>`;
  },

  /** 輕量判斷：計算收藏數量 → 更新 badge → 控制卡片 display（不渲染列表） */
  _showFavoritesCard() {
    const card = document.getElementById('profile-favorites-card');
    if (!card) return;
    const favs = this._getFavorites();
    const total = favs.events.length + favs.tournaments.length;
    if (!total) { card.style.display = 'none'; return; }
    card.style.display = '';
    const badge = document.getElementById('fav-count-badge');
    if (badge) badge.textContent = total;
    // 重置收折狀態
    const toggle = card.querySelector('.profile-collapse-toggle');
    const content = document.getElementById('profile-favorites-list');
    if (toggle) toggle.classList.remove('open');
    if (content) content.style.display = 'none';
  },

  renderProfileFavorites() {
    const card = document.getElementById('profile-favorites-card');
    const list = document.getElementById('profile-favorites-list');
    if (!card || !list) return;
    const favs = this._getFavorites();
    const total = favs.events.length + favs.tournaments.length;
    if (!total) { card.style.display = 'none'; return; }
    card.style.display = '';
    const badge = document.getElementById('fav-count-badge');
    if (badge) badge.textContent = total;

    // 收集所有收藏項目
    const items = [];
    favs.events.forEach(eid => {
      const ev = ApiService.getEvents().find(e => e.id === eid);
      if (!ev) return;
      const sc = STATUS_CONFIG[ev.status] || STATUS_CONFIG.open;
      const dateStr = ev.date ? ev.date.split(' ')[0] : '';
      items.push({ type: 'event', id: eid, name: ev.title, date: dateStr, statusCss: sc.css, statusLabel: sc.label, sortDate: dateStr });
    });
    favs.tournaments.forEach(tid => {
      const tm = ApiService.getTournaments().find(x => x.id === tid);
      if (!tm) return;
      const ts = this._tournStatusCss(tm);
      items.push({ type: 'tournament', id: tid, name: tm.name, date: tm.type || '賽事', statusCss: ts.css, statusLabel: ts.label, sortDate: (tm.matchDates || [])[0] || '' });
    });

    // 排序
    const mode = this._favSortMode || 'time';
    if (mode === 'status') {
      items.sort((a, b) => this._statusSortWeight(a.statusCss) - this._statusSortWeight(b.statusCss));
    } else if (mode === 'name') {
      items.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
    } else {
      // time: 按日期倒序
      items.sort((a, b) => (b.sortDate || '').localeCompare(a.sortDate || ''));
    }

    // 排序控件
    const sortOpts = [
      { val: 'time', label: t('fav.sortTime') },
      { val: 'status', label: t('fav.sortStatus') },
      { val: 'name', label: t('fav.sortName') },
    ];
    const sortHtml = `<div style="display:flex;justify-content:flex-end;margin-bottom:.25rem">
      <select id="fav-sort" onchange="App._favSortMode=this.value;App.renderProfileFavorites()" style="font-size:.7rem;padding:.15rem .35rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card);color:var(--text-primary);cursor:pointer">
        ${sortOpts.map(o => `<option value="${o.val}"${mode === o.val ? ' selected' : ''}>${o.label}</option>`).join('')}
      </select>
    </div>`;

    // 渲染列表
    let html = sortHtml;
    items.forEach(it => {
      const onclick = it.type === 'event'
        ? `App.showEventDetail('${it.id}')`
        : `App.showTournamentDetail('${it.id}')`;
      const toggleFn = it.type === 'event'
        ? `App.toggleFavoriteEvent('${it.id}')`
        : `App.toggleFavoriteTournament('${it.id}')`;
      html += `<div class="fav-item">
        <span class="fav-item-name" onclick="${onclick}">${escapeHTML(it.name)}</span>
        <span class="fav-item-date">${it.date}</span>
        <span class="tl-event-status ${it.statusCss}" style="font-size:.62rem">${it.statusLabel}</span>
        <button class="fav-remove-btn" onclick="event.stopPropagation();${toggleFn}" title="${t('toast.favoriteRemoved')}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`;
    });
    list.innerHTML = html || '<div style="font-size:.82rem;color:var(--text-muted);padding:.3rem 0">暫無收藏</div>';
    // 設定為展開狀態
    const toggle = card.querySelector('.profile-collapse-toggle');
    if (toggle) toggle.classList.add('open');
    list.style.display = '';
  },

  // ══════════════════════════════════
  //  Activity Reminders
  // ══════════════════════════════════

  _processEventReminders() {
    const user = ApiService.getCurrentUser();
    if (!user) return;
    const uid = user.uid || user.lineUserId || (ModeManager.isDemo() ? 'demo-user' : null);
    if (!uid) return;
    const records = ApiService.getActivityRecords(uid).filter(r => r.status === 'registered');
    const events = ApiService.getEvents();
    const now = new Date();
    const sent = JSON.parse(localStorage.getItem('sporthub_reminders_' + ModeManager.getMode()) || '{}');

    records.forEach(r => {
      const ev = events.find(e => e.id === r.eventId);
      if (!ev || !ev.date) return;
      // Parse date like "2026/03/15 14:00~16:00"
      const dateStr = ev.date.split('~')[0].trim();
      const eventDate = new Date(dateStr.replace(/\//g, '-'));
      if (isNaN(eventDate)) return;
      const hoursUntil = (eventDate - now) / (1000 * 60 * 60);
      const key24 = r.eventId + '_24h';
      const key1 = r.eventId + '_1h';
      // 24h reminder
      if (hoursUntil > 0 && hoursUntil <= 24 && !sent[key24]) {
        sent[key24] = true;
        const title = '活動即將開始提醒';
        const body = `您報名的「${ev.title}」將於 ${ev.date} 開始，請做好準備！\n地點：${ev.location}`;
        this._deliverMessageToInbox(title, body, 'activity', '活動', uid, '系統');
        this._queueLinePush(uid, 'activity', title, body);
      }
      // 1h reminder
      if (hoursUntil > 0 && hoursUntil <= 1 && !sent[key1]) {
        sent[key1] = true;
        const title = '活動即將開始（1小時內）';
        const body = `您報名的「${ev.title}」即將在 1 小時內開始！\n地點：${ev.location}\n請盡速前往！`;
        this._deliverMessageToInbox(title, body, 'activity', '活動', uid, '系統');
        this._queueLinePush(uid, 'activity', title, body);
      }
    });
    localStorage.setItem('sporthub_reminders_' + ModeManager.getMode(), JSON.stringify(sent));
  },

});
