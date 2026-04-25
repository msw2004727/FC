/* ================================================
   SportHub — Team: Card Rendering & List Display
   依賴：config.js, api-service.js, team-list.js
   ================================================ */

Object.assign(App, {

  _teamCardHTML(t) {
    const pinnedClass = t.pinned ? ' tc-pinned' : '';
    const color = t.color || '#6b7280';
    const rank = this._getTeamRank(t.teamExp);
    const isEdu = t.type === 'education';
    const eduBadge = isEdu ? '<span class="tc-edu-badge">教學</span>' : '';
    const eduRibbon = isEdu ? '<span class="tc-edu-ribbon">教學</span>' : '';
    const sportEmoji = t.sportTag && typeof SPORT_ICON_EMOJI !== 'undefined' ? (SPORT_ICON_EMOJI[t.sportTag] || '') : '';
    const sportBadge = sportEmoji ? `<span class="tc-sport-badge">${sportEmoji}</span>` : '';
    const typeHandler = this._getTeamTypeHandler(t.type);
    const memberLabel = isEdu ? '學員' : I18N.t('team.memberLabel');
    const memberCount = typeHandler.memberCount(t.id);
    return `
      <div class="tc-card${pinnedClass}" onclick="App.showTeamDetail('${t.id}')">
        ${t.pinned ? '<div class="tc-pin-badge">置頂</div>' : ''}
        ${t.image
          ? `<div style="position:relative;width:100%;aspect-ratio:1;overflow:hidden;border-radius:var(--radius) var(--radius) 0 0">${sportBadge}<img src="${t.image}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block"><span class="tc-rank-badge" style="color:${rank.color}"><span class="tc-rank-score">${(t.teamExp || 0).toLocaleString()}</span>${rank.rank}</span>${eduRibbon}</div>`
          : `<div class="tc-img-placeholder" style="position:relative">${sportBadge}俱樂部圖片<span class="tc-rank-badge" style="color:${rank.color}"><span class="tc-rank-score">${(t.teamExp || 0).toLocaleString()}</span>${rank.rank}</span>${eduRibbon}</div>`}
        <div class="tc-body">
          <div class="tc-name">${escapeHTML(t.name)}${eduBadge}</div>
          <div class="tc-info-row"><span class="tc-label">${memberLabel}</span><span>${memberCount} ${I18N.t('team.personUnit')}</span></div>
          <div class="tc-info-row"><span class="tc-label">${I18N.t('team.regionLabel')}</span><span>${escapeHTML(t.region || '')}</span></div>
        </div>
      </div>`;
  },

  _teamListLastFp: '',

  renderTeamList() {
    const container = document.getElementById('team-list');
    if (!container) return;
    this._initTeamListSportFilter?.();
    this._refreshTeamCreateButtons();
    let teams = ApiService.getActiveTeams();
    const typeTab = this._currentTeamTypeTab || '';
    if (typeTab) {
      teams = teams.filter(t => (t.type || 'general') === typeTab);
    }
    const activeTeamSport = this._syncTeamSportFilterWithGlobal?.() || this._getActiveTeamGlobalSport?.() || '';
    if (activeTeamSport) {
      teams = teams.filter(t => t.sportTag === activeTeamSport);
    }
    const sorted = this._sortTeams(teams);

    // Phase 2B §8.2B：指紋跳過重繪
    var fp = sorted.map(function(t) {
      return t.id + '|' + (t.name || '') + '|' + (t.sportTag || '') + '|' + (t.active ? 1 : 0) + '|' + (t.pinned ? 1 : 0) + '|' + (t.teamExp || 0);
    }).join(',');
    if (this._teamListLastFp === fp && container.children.length > 0) return;
    this._teamListLastFp = fp;

    var _tlScrollEl = document.scrollingElement || document.documentElement;
    var _tlSavedScroll = _tlScrollEl.scrollTop;
    container.innerHTML = sorted.length > 0
      ? sorted.map(t => this._teamCardHTML(t)).join('')
      : '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-muted);font-size:.85rem">此類型尚無俱樂部</div>';
    _tlScrollEl.scrollTop = _tlSavedScroll;
    this._markPageSnapshotReady?.('page-teams');

    // ★ 背景載入所有教育俱樂部學員數，完成後重繪
    const eduTeams = sorted.filter(t => t.type === 'education');
    if (eduTeams.length) {
      Promise.all(eduTeams.map(t => this._loadEduStudents?.(t.id).catch(() => {}))).then(() => {
        if (this.currentPage !== 'page-teams') return;
        const c = document.getElementById('team-list');
        if (!c) return;
        // 2026-04-25：重新讀取「當下」的 sport / typeTab，避免用閉包過時值覆寫使用者
        // 切換後的列表（race：切 football → 觸發此 Promise → 切 pickleball →
        // Promise resolve 用閉包 'football' 覆寫成 5 個足球、看起來像「沒過濾」）
        // 只讀「當下狀態」，不呼叫 _syncTeamSportFilterWithGlobal（避免在背景 callback 改 DOM）
        const _curSport = this._getActiveTeamGlobalSport?.() || '';
        const _curTypeTab = this._currentTeamTypeTab || '';
        var _s2 = _tlScrollEl.scrollTop;
        let ts = ApiService.getActiveTeams();
        if (_curTypeTab) ts = ts.filter(t => (t.type || 'general') === _curTypeTab);
        if (_curSport) ts = ts.filter(t => t.sportTag === _curSport);
        this._teamListLastFp = '';
        c.innerHTML = this._sortTeams(ts).map(t => this._teamCardHTML(t)).join('') || c.innerHTML;
        _tlScrollEl.scrollTop = _s2;
      });
    }
  },

  // ══════════════════════════════════
  //  Team Manage Page (Captain+)
  // ══════════════════════════════════

  renderTeamManage() {
    const container = document.getElementById('team-manage-list');
    if (!container) return;
    this._refreshTeamCreateButtons();

    const isAdmin = this.hasPermission('team.manage_all');

    let teams;
    if (isAdmin) {
      teams = ApiService.getTeams();
    } else {
      teams = ApiService.getTeams().filter(t => this._isTeamOwner(t));
    }

    // 2026-04-25：管理頁尊重全域 sport picker（與 renderTeamList 一致）
    const manageSport = this._getActiveTeamGlobalSport?.() || '';
    if (manageSport) teams = teams.filter(t => t.sportTag === manageSport);

    if (!teams.length) {
      container.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:.85rem">尚無俱樂部資料</div>';
      return;
    }

    const activeTeams = teams.filter(t => t.active);
    const inactiveTeams = teams.filter(t => !t.active);
    const renderCard = (t) => {
      const canEdit = isAdmin || this._isTeamOwner(t);
      const dim = !t.active ? ' team-inactive' : '';
      const mSportEmoji = t.sportTag && typeof SPORT_ICON_EMOJI !== 'undefined' ? (SPORT_ICON_EMOJI[t.sportTag] || '') : '';
      return `
      <div class="event-card${dim}" onclick="App.showTeamDetail('${t.id}')" style="cursor:pointer">
        <div class="event-card-body">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div class="event-card-title">${mSportEmoji ? mSportEmoji + ' ' : ''}${escapeHTML(t.name)} <span style="font-size:.72rem;color:var(--text-muted)">${escapeHTML(t.nameEn || '')}</span></div>
            <div style="display:flex;gap:.4rem;align-items:center">
              ${isAdmin && t.pinned ? '<span style="font-size:.72rem;color:var(--warning);font-weight:600">置頂</span>' : ''}
              <span style="font-size:.72rem;color:${t.active ? 'var(--success)' : 'var(--danger)'}">${t.active ? '上架中' : '已下架'}</span>
            </div>
          </div>
          <div class="event-meta">
            <span class="event-meta-item">領隊 ${escapeHTML(t.leader || '未設定')}</span>
            <span class="event-meta-item">俱樂部經理 ${escapeHTML(t.captain || '未設定')}</span>
            <span class="event-meta-item">${this._calcTeamMemberCount(t.id)}人</span>
            <span class="event-meta-item">${escapeHTML(t.region)}</span>
          </div>
          <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.5rem" onclick="event.stopPropagation()">
            ${canEdit ? `<button class="primary-btn small" onclick="App.showTeamForm('${t.id}')">編輯</button>` : ''}
            ${isAdmin ? `<button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="App.toggleTeamPin('${t.id}')">${t.pinned ? '取消置頂' : '置頂'}</button>` : ''}
            ${isAdmin ? `<button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="App.toggleTeamActive('${t.id}')">${t.active ? '下架' : '上架'}</button>` : ''}
            ${canEdit ? `<button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem;color:var(--danger)" onclick="App.removeTeam('${t.id}')">刪除</button>` : ''}
          </div>
        </div>
      </div>`;
    };
    let html = activeTeams.map(renderCard).join('');
    if (inactiveTeams.length) {
      html += '<hr class="team-section-divider"><div class="team-section-label">已下架俱樂部</div>';
      html += inactiveTeams.map(renderCard).join('');
    }
    container.innerHTML = html;
  },

  // ══════════════════════════════════
  //  Admin Team Management
  // ══════════════════════════════════

  renderAdminTeams(searchQuery) {
    const container = document.getElementById('admin-team-list');
    if (!container) return;
    const q = searchQuery || '';
    let teams = ApiService.getTeams();
    if (q) teams = teams.filter(t =>
      t.name.toLowerCase().includes(q) ||
      (t.nameEn || '').toLowerCase().includes(q) ||
      (t.captain || '').toLowerCase().includes(q) ||
      (t.leader || '').toLowerCase().includes(q) ||
      (t.region || '').toLowerCase().includes(q)
    );
    // 2026-04-25：管理頁尊重全域 sport picker（與 renderTeamList 一致）
    const adminSport = this._getActiveTeamGlobalSport?.() || '';
    if (adminSport) teams = teams.filter(t => t.sportTag === adminSport);
    if (!teams.length) {
      container.innerHTML = '<div style="padding:1rem;font-size:.82rem;color:var(--text-muted);text-align:center">未找到符合條件的俱樂部</div>';
      return;
    }
    const activeT = teams.filter(t => t.active);
    const inactiveT = teams.filter(t => !t.active);
    const adminCard = (t) => {
      const dim = !t.active ? ' team-inactive' : '';
      const aSportEmoji = t.sportTag && typeof SPORT_ICON_EMOJI !== 'undefined' ? (SPORT_ICON_EMOJI[t.sportTag] || '') : '';
      return `
      <div class="event-card${dim}" onclick="App.showTeamDetail('${t.id}')" style="cursor:pointer">
        <div class="event-card-body">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div class="event-card-title">${aSportEmoji ? aSportEmoji + ' ' : ''}${escapeHTML(t.name)} <span style="font-size:.72rem;color:var(--text-muted)">${escapeHTML(t.nameEn || '')}</span></div>
            ${t.pinned ? '<span style="font-size:.72rem;color:var(--warning);font-weight:600">置頂</span>' : ''}
          </div>
          <div class="event-meta">
            <span class="event-meta-item">領隊 ${escapeHTML(t.leader || '未設定')}</span>
            <span class="event-meta-item">俱樂部經理 ${escapeHTML(t.captain || '未設定')}</span>
            <span class="event-meta-item">${this._calcTeamMemberCount(t.id)}人</span>
            <span class="event-meta-item">${escapeHTML(t.region)}</span>
            <span class="event-meta-item" style="color:${t.active ? 'var(--success)' : 'var(--danger)'}">${t.active ? '上架中' : '已下架'}</span>
          </div>
          <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.5rem" onclick="event.stopPropagation()">
            <button class="primary-btn small" onclick="App.showTeamForm('${t.id}')">編輯</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="App.toggleTeamPin('${t.id}')">${t.pinned ? '取消置頂' : '置頂'}</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="App.toggleTeamActive('${t.id}')">${t.active ? '下架' : '上架'}</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="App.showTeamDetail('${t.id}')">查看</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem;color:var(--danger)" onclick="App.removeTeam('${t.id}')">刪除</button>
          </div>
        </div>
      </div>`;
    };
    let html = activeT.map(adminCard).join('');
    if (inactiveT.length) {
      html += '<hr class="team-section-divider"><div class="team-section-label">已下架俱樂部</div>';
      html += inactiveT.map(adminCard).join('');
    }
    container.innerHTML = html;
    this._markPageSnapshotReady?.('page-admin-teams');
  },

  // ── 從 team-form-init.js 搬入（渲染時初始化篩選器）──

  _initTeamListSportFilter() {
    const sel = document.getElementById('team-sport-filter');
    if (!sel || sel.dataset.inited) return;
    sel.dataset.inited = '1';
    (Array.isArray(EVENT_SPORT_OPTIONS) ? EVENT_SPORT_OPTIONS : []).forEach(item => {
      const emoji = (typeof SPORT_ICON_EMOJI !== 'undefined' ? SPORT_ICON_EMOJI[item.key] : '') || '';
      const opt = document.createElement('option');
      opt.value = item.key;
      opt.textContent = emoji ? emoji + ' ' + item.label : item.label;
      sel.appendChild(opt);
    });
  },

  // ══════════════════════════════════
  //  §8.2D Loading Progress Bar
  // ══════════════════════════════════
  _teamCardLoadingState: null,

  _markTeamCardPending(cardEl) {
    if (!cardEl || !cardEl.classList) return;
    cardEl.classList.add('is-pending');
    cardEl.setAttribute('aria-busy', 'true');
    // Inject bar into first child (image area)
    var imgArea = cardEl.querySelector('[style*="aspect-ratio"]') || cardEl.querySelector('.tc-img-placeholder');
    if (imgArea && !imgArea.querySelector('.tc-loading-bar')) {
      var bar = document.createElement('div');
      bar.className = 'tc-loading-bar';
      var fill = document.createElement('div');
      fill.className = 'tc-loading-fill';
      bar.appendChild(fill);
      imgArea.appendChild(bar);
    }
    // Start simulated progress
    var teamId = cardEl.getAttribute('onclick')?.match(/'([^']+)'/)?.[1] || '';
    if (!this._teamCardLoadingState || this._teamCardLoadingState.teamId !== teamId) {
      clearInterval(this._teamCardLoadingState?.interval);
      var state = { teamId: teamId, progress: 0, startedAt: Date.now(), interval: null };
      state.interval = setInterval(function () {
        var p = state.progress;
        var inc = p < 30 ? 4 : p < 60 ? 2 : p < 80 ? 0.5 : 0.15;
        state.progress = Math.min(p + inc, 85);
        if (cardEl) {
          var f = cardEl.querySelector('.tc-loading-fill');
          if (f) f.style.width = state.progress + '%';
        }
      }, 100);
      this._teamCardLoadingState = state;
    }
  },

  _clearTeamCardPending(cardEl, minVisibleMs) {
    var state = this._teamCardLoadingState;
    if (!state) return;
    clearInterval(state.interval);
    state.interval = null;
    var elapsed = Date.now() - state.startedAt;
    var waitMs = Math.max(0, (minVisibleMs || 0) - elapsed);
    var self = this;
    setTimeout(function () {
      if (!cardEl) { self._teamCardLoadingState = null; return; }
      var fill = cardEl.querySelector('.tc-loading-fill');
      if (fill) fill.style.width = '100%';
      setTimeout(function () {
        if (cardEl) cardEl.classList.add('is-loaded');
        setTimeout(function () {
          if (cardEl) {
            cardEl.classList.remove('is-pending', 'is-loaded');
            cardEl.removeAttribute('aria-busy');
            var bar = cardEl.querySelector('.tc-loading-bar');
            if (bar) bar.remove();
          }
          self._teamCardLoadingState = null;
        }, 400);
      }, 350);
    }, waitMs);
  },

});
