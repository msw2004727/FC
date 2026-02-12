/* ================================================
   SportHub — Tournament: Management, Create & Edit
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  Tournament Status Helpers
  // ══════════════════════════════════

  /** 根據報名區間計算賽事狀態 */
  getTournamentStatus(t) {
    if (!t.regStart || !t.regEnd) return t.status || '準備中';
    const now = new Date();
    const start = new Date(t.regStart);
    const end = new Date(t.regEnd);
    if (now < start) return '準備中';
    if (now >= start && now <= end) return '報名中';
    return '截止報名';
  },

  /** 判斷賽事是否已結束（手動結束 或 最後比賽日+24h 自動結束） */
  isTournamentEnded(t) {
    if (t.ended === true) return true;
    const dates = t.matchDates || [];
    if (dates.length === 0) return false;
    const lastDate = new Date(dates[dates.length - 1]);
    lastDate.setHours(lastDate.getHours() + 24);
    return new Date() > lastDate;
  },

  // ══════════════════════════════════
  //  Tournament Management (Admin)
  // ══════════════════════════════════

  _tmActiveTab: 'active',

  switchTournamentManageTab(tab) {
    this._tmActiveTab = tab;
    document.querySelectorAll('#tm-tabs .tab').forEach(el => {
      el.classList.toggle('active', el.dataset.tmtab === tab);
    });
    this.renderTournamentManage();
  },

  renderTournamentManage() {
    const container = document.getElementById('tournament-manage-list');
    if (!container) return;
    const tab = this._tmActiveTab || 'active';
    const all = ApiService.getTournaments();

    const filtered = all.filter(t => {
      const ended = this.isTournamentEnded(t);
      return tab === 'ended' ? ended : !ended;
    });

    if (filtered.length === 0) {
      container.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:.85rem">${tab === 'ended' ? '沒有已結束的賽事' : '沒有進行中的賽事'}</div>`;
      return;
    }

    container.innerHTML = filtered.map(t => {
      const status = this.getTournamentStatus(t);
      const isEnded = this.isTournamentEnded(t);
      const statusLabel = isEnded ? '已結束' : status;
      const statusColorMap = { '準備中': '#6b7280', '報名中': '#10b981', '截止報名': '#f59e0b', '已結束': '#6b7280' };
      const statusColor = statusColorMap[statusLabel] || '#6b7280';
      const registered = t.registeredTeams || [];
      const fee = t.fee || 0;
      const revenue = registered.length * fee;

      return `
      <div class="event-card" style="${isEnded ? 'opacity:.55;filter:grayscale(.4)' : ''}">
        ${t.image ? `<div class="event-card-img"><img src="${t.image}" style="width:100%;height:120px;object-fit:cover;display:block;border-radius:var(--radius) var(--radius) 0 0"></div>` : ''}
        <div class="event-card-body">
          <div style="display:flex;align-items:center;gap:.4rem">
            <div class="event-card-title" style="flex:1">${escapeHTML(t.name)}</div>
            <span style="font-size:.68rem;padding:.15rem .45rem;border-radius:20px;background:${statusColor}18;color:${statusColor};font-weight:600;white-space:nowrap">${statusLabel}</span>
          </div>
          <div class="event-meta">
            <span class="event-meta-item">${escapeHTML(t.type)}</span>
            ${t.region ? `<span class="event-meta-item">${escapeHTML(t.region)}</span>` : ''}
            <span class="event-meta-item">${t.teams} 隊</span>
            ${t.matchDates && t.matchDates.length ? `<span class="event-meta-item">比賽日 ${t.matchDates.length} 天</span>` : ''}
            <span class="event-meta-item">主辦 ${this._userTag(t.organizer || '管理員')}</span>
          </div>
          <div style="font-size:.78rem;color:var(--text-secondary);margin-top:.3rem">
            應收費用：<strong>NT$${revenue.toLocaleString()}</strong>（${registered.length} 隊 × NT$${fee.toLocaleString()}）
          </div>
          <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.5rem">
            ${isEnded ? `
              <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem;background:#10b981;color:#fff;border-color:#10b981" onclick="App.handleReopenTournament('${t.id}')">重新開放</button>
              ${ROLE_LEVEL_MAP[App.currentRole] >= ROLE_LEVEL_MAP['admin'] ? `<button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem;color:var(--danger)" onclick="App.handleDeleteTournament('${t.id}')">刪除賽事</button>` : ''}
            ` : `
              <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem;background:#10b981;color:#fff;border-color:#10b981" onclick="App.showEditTournament('${t.id}')">編輯賽事</button>
              <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem">賽程管理</button>
              <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem">賽事統計</button>
              <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem">參賽管理</button>
              <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem;color:var(--danger)" onclick="App.handleEndTournament('${t.id}')">結束</button>
            `}
          </div>
        </div>
      </div>`;
    }).join('');
  },

  // ══════════════════════════════════
  //  Venue Management (Create & Edit)
  // ══════════════════════════════════

  _ctVenues: [],
  _etVenues: [],

  addTournamentVenue(prefix) {
    const p = prefix || 'ct';
    const input = document.getElementById(`${p}-venue-input`);
    if (!input) return;
    const val = input.value.trim();
    if (!val) return;
    const arr = p === 'et' ? this._etVenues : this._ctVenues;
    if (arr.includes(val)) { this.showToast('此場地已存在'); return; }
    arr.push(val);
    input.value = '';
    this._renderVenueTags(p);
  },

  removeTournamentVenue(prefix, idx) {
    const arr = prefix === 'et' ? this._etVenues : this._ctVenues;
    arr.splice(idx, 1);
    this._renderVenueTags(prefix);
  },

  _renderVenueTags(prefix) {
    const container = document.getElementById(`${prefix}-venue-tags`);
    if (!container) return;
    const arr = prefix === 'et' ? this._etVenues : this._ctVenues;
    container.innerHTML = arr.map((v, i) => {
      const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v)}`;
      return `<span style="display:inline-flex;align-items:center;gap:.25rem;font-size:.72rem;padding:.2rem .5rem;border-radius:20px;background:var(--surface-alt);border:1px solid var(--border)">
        <a href="${mapUrl}" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:none">${escapeHTML(v)} 📍</a>
        <span style="cursor:pointer;color:var(--text-muted)" onclick="App.removeTournamentVenue('${prefix}',${i})">✕</span>
      </span>`;
    }).join('');
  },

  // ══════════════════════════════════
  //  Delegate Management (Create & Edit)
  // ══════════════════════════════════

  _ctDelegates: [],
  _etDelegates: [],

  _initTournamentDelegateSearch(prefix) {
    const p = prefix || 'ct';
    const input = document.getElementById(`${p}-delegate-search`);
    const dropdown = document.getElementById(`${p}-delegate-dropdown`);
    if (!input || !dropdown) return;

    input.addEventListener('input', () => {
      const q = input.value.trim();
      if (q.length < 1) { dropdown.classList.remove('open'); dropdown.innerHTML = ''; return; }
      this._searchTournamentDelegates(q, p);
    });
    input.addEventListener('blur', () => {
      setTimeout(() => { dropdown.classList.remove('open'); }, 200);
    });
    input.addEventListener('focus', () => {
      const q = input.value.trim();
      if (q.length >= 1) this._searchTournamentDelegates(q, p);
    });

    this._renderTournamentDelegateTags(p);
    this._updateTournamentDelegateInput(p);
  },

  _searchTournamentDelegates(query, prefix) {
    const p = prefix || 'ct';
    const dropdown = document.getElementById(`${p}-delegate-dropdown`);
    if (!dropdown) return;
    const q = query.toLowerCase();
    const delegates = p === 'et' ? this._etDelegates : this._ctDelegates;
    const selectedUids = delegates.map(d => d.uid);

    const allUsers = ApiService.getAdminUsers?.() || [];
    const results = allUsers.filter(u => {
      if (selectedUids.includes(u.uid)) return false;
      return (u.name || '').toLowerCase().includes(q) || (u.uid || '').toLowerCase().includes(q);
    }).slice(0, 5);

    if (results.length === 0) {
      dropdown.innerHTML = '<div style="padding:.4rem .6rem;font-size:.78rem;color:var(--text-muted)">找不到符合的用戶</div>';
    } else {
      const roleLabels = typeof ROLES !== 'undefined' ? ROLES : {};
      dropdown.innerHTML = results.map(u => {
        const roleLabel = roleLabels[u.role]?.label || u.role || '';
        return `<div class="ce-delegate-item" data-uid="${u.uid}" data-name="${escapeHTML(u.name)}">
          <span class="ce-delegate-item-name">${escapeHTML(u.name)}</span>
          <span class="ce-delegate-item-meta">${u.uid} · ${roleLabel}</span>
        </div>`;
      }).join('');

      dropdown.querySelectorAll('.ce-delegate-item').forEach(item => {
        item.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          this._addTournamentDelegate(item.dataset.uid, item.dataset.name, p);
          document.getElementById(`${p}-delegate-search`).value = '';
          dropdown.classList.remove('open');
        });
      });
    }
    dropdown.classList.add('open');
  },

  _addTournamentDelegate(uid, name, prefix) {
    const p = prefix || 'ct';
    const delegates = p === 'et' ? this._etDelegates : this._ctDelegates;
    if (delegates.length >= 10) return;
    if (delegates.some(d => d.uid === uid)) return;
    delegates.push({ uid, name });
    this._renderTournamentDelegateTags(p);
    this._updateTournamentDelegateInput(p);
  },

  _removeTournamentDelegate(uid, prefix) {
    const p = prefix || 'ct';
    if (p === 'et') {
      this._etDelegates = this._etDelegates.filter(d => d.uid !== uid);
    } else {
      this._ctDelegates = this._ctDelegates.filter(d => d.uid !== uid);
    }
    this._renderTournamentDelegateTags(p);
    this._updateTournamentDelegateInput(p);
  },

  _renderTournamentDelegateTags(prefix) {
    const p = prefix || 'ct';
    const container = document.getElementById(`${p}-delegate-tags`);
    if (!container) return;
    const delegates = p === 'et' ? this._etDelegates : this._ctDelegates;
    const users = ApiService.getAdminUsers?.() || [];
    container.innerHTML = delegates.map(d => {
      const u = users.find(u => u.uid === d.uid);
      const role = u?.role || 'user';
      return `<span class="ce-delegate-tag">${this._userTag(d.name, role)}<span class="ce-delegate-remove" onclick="App._removeTournamentDelegate('${d.uid}','${p}')">✕</span></span>`;
    }).join('');
  },

  _updateTournamentDelegateInput(prefix) {
    const p = prefix || 'ct';
    const input = document.getElementById(`${p}-delegate-search`);
    if (!input) return;
    const delegates = p === 'et' ? this._etDelegates : this._ctDelegates;
    input.disabled = delegates.length >= 10;
    input.placeholder = delegates.length >= 10 ? '已達上限 10 人' : '搜尋 UID 或暱稱...';
  },

  // ══════════════════════════════════
  //  Match Dates
  // ══════════════════════════════════

  _ctMatchDates: [],
  _etMatchDates: [],

  addMatchDate(val) {
    if (!val || this._ctMatchDates.includes(val)) return;
    this._ctMatchDates.push(val);
    this._ctMatchDates.sort();
    this._renderMatchDateTags('ct');
    document.getElementById('ct-match-date-picker').value = '';
  },

  removeMatchDate(val) {
    this._ctMatchDates = this._ctMatchDates.filter(d => d !== val);
    this._renderMatchDateTags('ct');
  },

  addEditMatchDate(val) {
    if (!val || this._etMatchDates.includes(val)) return;
    this._etMatchDates.push(val);
    this._etMatchDates.sort();
    this._renderMatchDateTags('et');
    document.getElementById('et-match-date-picker').value = '';
  },

  removeEditMatchDate(val) {
    this._etMatchDates = this._etMatchDates.filter(d => d !== val);
    this._renderMatchDateTags('et');
  },

  _renderMatchDateTags(prefix) {
    const p = prefix || 'ct';
    const wrap = document.getElementById(`${p}-match-dates-wrap`);
    if (!wrap) return;
    const dates = p === 'et' ? this._etMatchDates : this._ctMatchDates;
    const removeFn = p === 'et' ? 'removeEditMatchDate' : 'removeMatchDate';
    wrap.innerHTML = dates.map(d => {
      const parts = d.split('-');
      const label = `${parseInt(parts[1])}/${parseInt(parts[2])}`;
      return `<span style="display:inline-flex;align-items:center;gap:.2rem;font-size:.72rem;padding:.2rem .5rem;border-radius:20px;background:var(--accent);color:#fff">${label}<span style="cursor:pointer;margin-left:.1rem" onclick="App.${removeFn}('${d}')">✕</span></span>`;
    }).join('');
  },

  // ══════════════════════════════════
  //  Create Tournament
  // ══════════════════════════════════

  openCreateTournamentModal() {
    this._ctDelegates = [];
    this._ctVenues = [];
    this._ctMatchDates = [];
    this.showModal('create-tournament-modal');
    this._initTournamentDelegateSearch('ct');
    this._renderVenueTags('ct');
    this._renderMatchDateTags('ct');
    this._renderTournamentDelegateTags('ct');
    this._updateTournamentDelegateInput('ct');
    this._renderHistoryChips('ct-region', 'ct-region');
    this._renderHistoryChips('ct-fee', 'ct-fee');
    this._renderHistoryChips('ct-venue', 'ct-venue-input');
    this._renderRecentDelegateChips('ct-delegate-tags', 'ct');
  },

  handleCreateTournament() {
    const name = document.getElementById('ct-name').value.trim();
    const type = document.getElementById('ct-type').value;
    const teams = parseInt(document.getElementById('ct-teams').value) || 8;
    const regStart = document.getElementById('ct-reg-start').value || null;
    const regEnd = document.getElementById('ct-reg-end').value || null;
    const desc = document.getElementById('ct-desc').value.trim();
    const fee = parseInt(document.getElementById('ct-fee').value) || 0;
    const region = document.getElementById('ct-region').value.trim();
    const matchDates = [...this._ctMatchDates];
    const venues = [...this._ctVenues];
    const delegates = [...this._ctDelegates];

    if (!name) { this.showToast('請輸入賽事名稱'); return; }

    const ctPreviewEl = document.getElementById('ct-upload-preview');
    const ctImg = ctPreviewEl?.querySelector('img');
    const image = ctImg ? ctImg.src : null;

    const ctContentPreviewEl = document.getElementById('ct-content-upload-preview');
    const ctContentImg = ctContentPreviewEl?.querySelector('img');
    const contentImage = ctContentImg ? ctContentImg.src : null;

    const curUser = ApiService.getCurrentUser();
    const creatorName = curUser?.displayName || '管理員';
    const creatorUid = curUser?.uid || 'demo-user';

    const data = {
      id: 'ct_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      name, type, teams, region,
      matches: teams - 1,
      regStart, regEnd, matchDates, description: desc,
      image, contentImage, venues, fee, delegates,
      organizer: creatorName, creatorUid,
      registeredTeams: [], maxTeams: teams, ended: false,
      gradient: TOURNAMENT_GRADIENT_MAP[type] || 'linear-gradient(135deg,#7c3aed,#4338ca)',
    };
    data.status = this.getTournamentStatus(data);

    ApiService.createTournament(data);

    this._saveInputHistory('ct-region', region);
    if (fee > 0) this._saveInputHistory('ct-fee', fee);
    venues.forEach(v => this._saveInputHistory('ct-venue', v));
    this._saveRecentDelegates(this._ctDelegates);

    this.renderTournamentTimeline();
    this.renderOngoingTournaments();
    this.renderTournamentManage();
    this.closeModal();
    this.showToast(`賽事「${name}」已建立！`);

    // Reset form
    document.getElementById('ct-name').value = '';
    document.getElementById('ct-teams').value = '8';
    document.getElementById('ct-fee').value = '0';
    document.getElementById('ct-region').value = '';
    document.getElementById('ct-reg-start').value = '';
    document.getElementById('ct-reg-end').value = '';
    document.getElementById('ct-desc').value = '';
    document.getElementById('ct-desc-count').textContent = '0/500';
    this._ctMatchDates = [];
    this._ctVenues = [];
    this._ctDelegates = [];
    this._renderMatchDateTags('ct');
    this._renderVenueTags('ct');
    this._renderTournamentDelegateTags('ct');
    this._updateTournamentDelegateInput('ct');
    const preview = document.getElementById('ct-upload-preview');
    if (preview) {
      preview.classList.remove('has-image');
      preview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 800 × 300 px｜JPG / PNG｜最大 5MB</span>';
    }
    const contentPreview = document.getElementById('ct-content-upload-preview');
    if (contentPreview) {
      contentPreview.classList.remove('has-image');
      contentPreview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 800 × 600 px｜JPG / PNG｜最大 5MB</span>';
    }
  },

  // ══════════════════════════════════
  //  Edit Tournament
  // ══════════════════════════════════

  _editTournamentId: null,

  showEditTournament(id) {
    const t = ApiService.getTournament(id);
    if (!t) return;
    this._editTournamentId = id;

    document.getElementById('et-name').value = t.name || '';
    document.getElementById('et-type').value = t.type || '盃賽';
    document.getElementById('et-teams').value = t.teams || 8;
    document.getElementById('et-fee').value = t.fee || 0;
    document.getElementById('et-region').value = t.region || '';
    document.getElementById('et-reg-start').value = t.regStart || '';
    document.getElementById('et-reg-end').value = t.regEnd || '';
    document.getElementById('et-desc').value = t.description || '';
    document.getElementById('et-desc-count').textContent = (t.description || '').length + '/500';

    // Venues
    this._etVenues = [...(t.venues || [])];
    this._renderVenueTags('et');

    // Delegates
    this._etDelegates = [...(t.delegates || [])];
    this._renderTournamentDelegateTags('et');
    this._updateTournamentDelegateInput('et');
    this._initTournamentDelegateSearch('et');

    // Match Dates
    this._etMatchDates = [...(t.matchDates || [])];
    this._renderMatchDateTags('et');

    // Cover image
    const preview = document.getElementById('et-upload-preview');
    if (t.image && preview) {
      preview.innerHTML = `<img src="${t.image}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`;
      preview.classList.add('has-image');
    } else if (preview) {
      preview.classList.remove('has-image');
      preview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 800 × 300 px｜JPG / PNG｜最大 5MB</span>';
    }

    // Content image
    const contentPreview = document.getElementById('et-content-upload-preview');
    if (t.contentImage && contentPreview) {
      contentPreview.innerHTML = `<img src="${t.contentImage}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`;
      contentPreview.classList.add('has-image');
    } else if (contentPreview) {
      contentPreview.classList.remove('has-image');
      contentPreview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 800 × 600 px｜JPG / PNG｜最大 5MB</span>';
    }

    this.toggleModal('edit-tournament-modal');
  },

  handleSaveEditTournament() {
    const id = this._editTournamentId;
    const t = ApiService.getTournament(id);
    if (!t) return;

    const name = document.getElementById('et-name').value.trim();
    const type = document.getElementById('et-type').value;
    const teams = parseInt(document.getElementById('et-teams').value) || 8;
    const fee = parseInt(document.getElementById('et-fee').value) || 0;
    const region = document.getElementById('et-region').value.trim();
    const regStart = document.getElementById('et-reg-start').value || null;
    const regEnd = document.getElementById('et-reg-end').value || null;
    const description = document.getElementById('et-desc').value.trim();
    const venues = [...this._etVenues];
    const delegates = [...this._etDelegates];
    const matchDates = [...this._etMatchDates];

    const etPreviewEl = document.getElementById('et-upload-preview');
    const etImg = etPreviewEl?.querySelector('img');
    const image = etImg ? etImg.src : (t.image || null);

    const etContentPreviewEl = document.getElementById('et-content-upload-preview');
    const etContentImg = etContentPreviewEl?.querySelector('img');
    const contentImage = etContentImg ? etContentImg.src : (t.contentImage || null);

    const updates = {
      name, type, teams, maxTeams: teams, fee, region,
      regStart, regEnd, description,
      matches: teams - 1,
      venues, delegates, matchDates,
      image, contentImage,
    };
    updates.status = this.getTournamentStatus({ ...t, ...updates });

    ApiService.updateTournament(id, updates);

    this._editTournamentId = null;
    this.renderTournamentTimeline();
    this.renderOngoingTournaments();
    this.renderTournamentManage();
    this.closeModal();
    this.showToast(`賽事「${name}」已更新！`);
  },

  // ══════════════════════════════════
  //  End / Reopen Tournament
  // ══════════════════════════════════

  async handleEndTournament(id) {
    const t = ApiService.getTournament(id);
    if (!t) return;
    if (!(await this.appConfirm(`確定要結束賽事「${t.name}」？`))) return;
    ApiService.updateTournament(id, { ended: true });
    this.renderTournamentTimeline();
    this.renderOngoingTournaments();
    this.renderTournamentManage();
    this.showToast(`賽事「${t.name}」已結束`);
  },

  async handleReopenTournament(id) {
    const t = ApiService.getTournament(id);
    if (!t) return;
    if (!(await this.appConfirm(`確定要重新開放賽事「${t.name}」？`))) return;
    ApiService.updateTournament(id, { ended: false });
    this.renderTournamentTimeline();
    this.renderOngoingTournaments();
    this.renderTournamentManage();
    this.showToast(`賽事「${t.name}」已重新開放`);
  },

  async handleDeleteTournament(id) {
    const t = ApiService.getTournament(id);
    if (!t) return;
    if (ROLE_LEVEL_MAP[this.currentRole] < ROLE_LEVEL_MAP['admin']) {
      this.showToast('僅管理員可刪除賽事');
      return;
    }
    if (!(await this.appConfirm(`確定要永久刪除賽事「${t.name}」？此操作無法復原。`))) return;
    ApiService.deleteTournament(id);
    this.renderTournamentTimeline();
    this.renderOngoingTournaments();
    this.renderTournamentManage();
    this.showToast(`已刪除賽事「${t.name}」`);
  },

});
