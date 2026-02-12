/* ================================================
   SportHub — Favorites & Activity Reminders
   依賴：config.js, api-service.js
   ================================================ */
Object.assign(App, {

  // ══════════════════════════════════
  //  Favorites
  // ══════════════════════════════════

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

  toggleFavoriteEvent(eventId) {
    const favs = this._getFavorites();
    const idx = favs.events.indexOf(eventId);
    const added = idx < 0;
    if (added) { favs.events.push(eventId); } else { favs.events.splice(idx, 1); }
    ApiService.updateCurrentUser({ favorites: favs });
    this._syncFavHearts('Event', eventId, added);
    this.renderProfileFavorites();
    this.showToast(added ? '已加入收藏' : '已取消收藏');
  },

  toggleFavoriteTournament(tournId) {
    const favs = this._getFavorites();
    const idx = favs.tournaments.indexOf(tournId);
    const added = idx < 0;
    if (added) { favs.tournaments.push(tournId); } else { favs.tournaments.splice(idx, 1); }
    ApiService.updateCurrentUser({ favorites: favs });
    this._syncFavHearts('Tournament', tournId, added);
    this.renderProfileFavorites();
    this.showToast(added ? '已加入收藏' : '已取消收藏');
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
    let html = '';
    // 活動收藏
    favs.events.forEach(eid => {
      const ev = ApiService.getEvents().find(e => e.id === eid);
      if (!ev) return;
      const sc = STATUS_CONFIG[ev.status] || STATUS_CONFIG.open;
      html += `<div class="fav-item">
        <span class="fav-item-name" onclick="App.showEventDetail('${eid}')">${escapeHTML(ev.title)}</span>
        <span class="fav-item-date">${ev.date ? ev.date.split(' ')[0] : ''}</span>
        <span class="tl-event-status ${sc.css}" style="font-size:.62rem">${sc.label}</span>
        <button class="fav-remove-btn" onclick="event.stopPropagation();App.toggleFavoriteEvent('${eid}')" title="取消收藏">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`;
    });
    // 賽事收藏
    favs.tournaments.forEach(tid => {
      const t = ApiService.getTournaments().find(x => x.id === tid);
      if (!t) return;
      const ts = this._tournStatusCss(t);
      html += `<div class="fav-item">
        <span class="fav-item-name" onclick="App.showTournamentDetail('${tid}')">${escapeHTML(t.name)}</span>
        <span class="fav-item-date">${t.type || '賽事'}</span>
        <span class="tl-event-status ${ts.css}" style="font-size:.62rem">${ts.label}</span>
        <button class="fav-remove-btn" onclick="event.stopPropagation();App.toggleFavoriteTournament('${tid}')" title="取消收藏">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`;
    });
    list.innerHTML = html || '<div style="font-size:.82rem;color:var(--text-muted);padding:.3rem 0">暫無收藏</div>';
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
    const sent = JSON.parse(localStorage.getItem('sporthub_reminders') || '{}');

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
    localStorage.setItem('sporthub_reminders', JSON.stringify(sent));
  },

});
