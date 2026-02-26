/* ================================================
   SportHub — Team: List, Filter, Admin Management
   依賴：config.js, api-service.js
   ================================================ */

Object.assign(App, {

  _isTeamOwner(t) {
    if (ModeManager.isDemo()) {
      return t.id === this._userTeam;
    }
    const user = ApiService.getCurrentUser();
    return user && user.teamId === t.id;
  },

  _getTeamRank(teamExp) {
    const exp = teamExp || 0;
    for (let i = TEAM_RANK_CONFIG.length - 1; i >= 0; i--) {
      const cfg = TEAM_RANK_CONFIG[i];
      if (exp >= cfg.min) return { rank: cfg.rank, color: cfg.color };
    }
    return { rank: 'E', color: '#6b7280' };
  },

  _sortTeams(teams) {
    return [...teams].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      if (a.pinned && b.pinned) return (a.pinOrder || 0) - (b.pinOrder || 0);
      return 0;
    });
  },

  _hasRolePermission(code) {
    if (!code) return false;
    const role = (this.currentRole || ApiService.getCurrentUser?.()?.role || 'user');
    const perms = ApiService.getRolePermissions(role) || [];
    return perms.includes(code);
  },

  _findUserByUidOrDocId(uidOrDocId) {
    if (!uidOrDocId) return null;
    const users = ApiService.getAdminUsers() || [];
    return users.find(u => u.uid === uidOrDocId || u._docId === uidOrDocId) || null;
  },

  _resolveTeamCaptainUser(team) {
    if (!team) return null;
    const users = ApiService.getAdminUsers() || [];

    if (team.captainUid) {
      const byUid = this._findUserByUidOrDocId(team.captainUid);
      if (byUid) return byUid;
    }

    if (team.captain) {
      const byName = users.find(u =>
        u.name === team.captain || u.displayName === team.captain
      );
      if (byName) return byName;
    }

    if (team.id) {
      const teamUsers = users.filter(u => u.teamId === team.id);
      const captainUser = teamUsers.find(u => u.role === 'captain' || u.manualRole === 'captain');
      if (captainUser) return captainUser;
    }

    return null;
  },

  _isTeamCaptainUser(team) {
    if (!team) return false;
    if (ModeManager.isDemo()) {
      const cap = this._resolveTeamCaptainUser(team);
      if (!cap) return false;
      return cap.uid === DemoData.currentUser?.uid;
    }

    const currentUser = ApiService.getCurrentUser?.();
    if (!currentUser) return false;

    if (team.captainUid && (team.captainUid === currentUser.uid || team.captainUid === currentUser._docId)) {
      return true;
    }

    const currentNames = new Set([currentUser.name, currentUser.displayName].filter(Boolean));
    if (team.captain && currentNames.has(team.captain)) return true;

    const captainUser = this._resolveTeamCaptainUser(team);
    return !!(captainUser && currentUser.uid && captainUser.uid === currentUser.uid);
  },

  _canEditTeamByRoleOrCaptain(team) {
    if (!team) return false;
    return this._isTeamCaptainUser(team) || this._hasRolePermission('team.manage_all');
  },

  _canCreateTeamByPermission() {
    return this._hasRolePermission('team.create');
  },

  _refreshTeamCreateButtons() {
    const canCreate = this._canCreateTeamByPermission();
    const pageBtn = document.getElementById('team-page-create-btn');
    if (pageBtn) pageBtn.style.display = canCreate ? '' : 'none';

    const manageBtn = document.getElementById('team-manage-create-btn');
    if (manageBtn) manageBtn.style.display = canCreate ? '' : 'none';
  },

  openTeamCreateFromTeamsPage() {
    if (!this._canCreateTeamByPermission()) {
      this.showToast('目前未開啟建立球隊權限');
      return;
    }
    this.showTeamForm();
  },

  _teamCardHTML(t) {
    const pinnedClass = t.pinned ? ' tc-pinned' : '';
    const color = t.color || '#6b7280';
    const rank = this._getTeamRank(t.teamExp);
    return `
      <div class="tc-card${pinnedClass}" onclick="App.showTeamDetail('${t.id}')">
        ${t.pinned ? '<div class="tc-pin-badge">置頂</div>' : ''}
        ${t.image
          ? `<div style="position:relative;width:100%;aspect-ratio:1;overflow:hidden;border-radius:var(--radius) var(--radius) 0 0"><img src="${t.image}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block"><span class="tc-rank-badge" style="color:${rank.color}"><span class="tc-rank-score">${(t.teamExp || 0).toLocaleString()}</span>${rank.rank}</span></div>`
          : `<div class="tc-img-placeholder" style="position:relative">球隊圖片<span class="tc-rank-badge" style="color:${rank.color}"><span class="tc-rank-score">${(t.teamExp || 0).toLocaleString()}</span>${rank.rank}</span></div>`}
        <div class="tc-body">
          <div class="tc-name">${escapeHTML(t.name)}</div>
          <div class="tc-info-row"><span class="tc-label">${I18N.t('team.memberLabel')}</span><span>${t.members} ${I18N.t('team.personUnit')}</span></div>
          <div class="tc-info-row"><span class="tc-label">${I18N.t('team.regionLabel')}</span><span>${escapeHTML(t.region || '')}</span></div>
        </div>
      </div>`;
  },

  renderTeamList() {
    const container = document.getElementById('team-list');
    if (!container) return;
    this._refreshTeamCreateButtons();
    const sorted = this._sortTeams(ApiService.getActiveTeams());
    container.innerHTML = sorted.map(t => this._teamCardHTML(t)).join('');
  },

  filterTeams() {
    const query = (document.getElementById('team-search')?.value || '').trim().toLowerCase();
    const region = document.getElementById('team-region-filter')?.value || '';
    const container = document.getElementById('team-list');

    let filtered = ApiService.getActiveTeams();
    if (query) {
      filtered = filtered.filter(t =>
        t.name.toLowerCase().includes(query) ||
        (t.nameEn || '').toLowerCase().includes(query) ||
        t.captain.toLowerCase().includes(query)
      );
    }
    if (region) {
      filtered = filtered.filter(t => t.region === region);
    }

    const sorted = this._sortTeams(filtered);
    container.innerHTML = sorted.length > 0
      ? sorted.map(t => this._teamCardHTML(t)).join('')
      : `<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-muted);font-size:.85rem">${t('team.noMatch')}</div>`;
  },

  // ══════════════════════════════════
  //  Team Manage Page (Captain+)
  // ══════════════════════════════════

  renderTeamManage(filter) {
    const container = document.getElementById('team-manage-list');
    if (!container) return;
    this._refreshTeamCreateButtons();

    const tabs = document.getElementById('team-manage-tabs');
    if (tabs && !tabs.dataset.bound) {
      tabs.dataset.bound = '1';
      tabs.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          this.renderTeamManage(tab.dataset.tab);
        });
      });
    }

    const currentFilter = filter || tabs?.querySelector('.tab.active')?.dataset.tab || 'my-teams';
    const isAdmin = ROLE_LEVEL_MAP[this.currentRole] >= ROLE_LEVEL_MAP['admin'];

    let teams;
    if (currentFilter === 'my-teams' && !isAdmin) {
      teams = ApiService.getTeams().filter(t => this._isTeamOwner(t));
    } else {
      teams = ApiService.getTeams();
    }

    if (!teams.length) {
      container.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:.85rem">尚無球隊資料</div>';
      return;
    }

    const activeTeams = teams.filter(t => t.active);
    const inactiveTeams = teams.filter(t => !t.active);
    const renderCard = (t) => {
      const canEdit = isAdmin || this._isTeamOwner(t);
      const dim = !t.active ? ' team-inactive' : '';
      return `
      <div class="event-card${dim}">
        <div class="event-card-body">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div class="event-card-title">${escapeHTML(t.name)} <span style="font-size:.72rem;color:var(--text-muted)">${escapeHTML(t.nameEn || '')}</span></div>
            <span style="font-size:.72rem;color:${t.active ? 'var(--success)' : 'var(--danger)'}">${t.active ? '上架中' : '已下架'}</span>
          </div>
          <div class="event-meta">
            <span class="event-meta-item">領隊 ${escapeHTML(t.captain)}</span>
            <span class="event-meta-item">${t.members}人</span>
            <span class="event-meta-item">${escapeHTML(t.region)}</span>
          </div>
          <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.5rem">
            ${canEdit ? `<button class="primary-btn small" onclick="App.showTeamForm('${t.id}')">編輯</button>` : ''}
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="App.showTeamDetail('${t.id}')">查看</button>
            ${canEdit ? `<button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem;color:var(--danger)" onclick="App.removeTeam('${t.id}')">刪除</button>` : ''}
          </div>
        </div>
      </div>`;
    };
    let html = activeTeams.map(renderCard).join('');
    if (inactiveTeams.length) {
      html += '<hr class="team-section-divider"><div class="team-section-label">已下架球隊</div>';
      html += inactiveTeams.map(renderCard).join('');
    }
    container.innerHTML = html;
  },

  // ══════════════════════════════════
  //  Admin Team Management
  // ══════════════════════════════════

  _pinCounter: 100,

  filterAdminTeams() {
    const q = (document.getElementById('team-search-input')?.value || '').trim().toLowerCase();
    this.renderAdminTeams(q);
  },

  renderAdminTeams(searchQuery) {
    const container = document.getElementById('admin-team-list');
    if (!container) return;
    const q = searchQuery || '';
    let teams = ApiService.getTeams();
    if (q) teams = teams.filter(t => t.name.toLowerCase().includes(q) || (t.nameEn || '').toLowerCase().includes(q) || t.captain.includes(q) || t.region.includes(q));
    if (!teams.length) {
      container.innerHTML = '<div style="padding:1rem;font-size:.82rem;color:var(--text-muted);text-align:center">未找到符合條件的球隊</div>';
      return;
    }
    const activeT = teams.filter(t => t.active);
    const inactiveT = teams.filter(t => !t.active);
    const adminCard = (t) => {
      const dim = !t.active ? ' team-inactive' : '';
      return `
      <div class="event-card${dim}">
        <div class="event-card-body">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div class="event-card-title">${escapeHTML(t.name)} <span style="font-size:.72rem;color:var(--text-muted)">${escapeHTML(t.nameEn || '')}</span></div>
            ${t.pinned ? '<span style="font-size:.72rem;color:var(--warning);font-weight:600">置頂</span>' : ''}
          </div>
          <div class="event-meta">
            <span class="event-meta-item">領隊 ${escapeHTML(t.captain)}</span>
            <span class="event-meta-item">${t.members}人</span>
            <span class="event-meta-item">${escapeHTML(t.region)}</span>
            <span class="event-meta-item" style="color:${t.active ? 'var(--success)' : 'var(--danger)'}">${t.active ? '上架中' : '已下架'}</span>
          </div>
          <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.5rem">
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
      html += '<hr class="team-section-divider"><div class="team-section-label">已下架球隊</div>';
      html += inactiveT.map(adminCard).join('');
    }
    container.innerHTML = html;
  },

  toggleTeamPin(id) {
    const t = ApiService.getTeam(id);
    if (!t) return;
    t.pinned = !t.pinned;
    if (t.pinned) {
      this._pinCounter++;
      t.pinOrder = this._pinCounter;
    } else {
      t.pinOrder = 0;
    }
    ApiService.updateTeam(id, { pinned: t.pinned, pinOrder: t.pinOrder });
    this.renderAdminTeams();
    this.renderTeamList();
    this.showToast(t.pinned ? `已置頂「${t.name}」` : `已取消置頂「${t.name}」`);
  },

  toggleTeamActive(id) {
    const t = ApiService.getTeam(id);
    if (!t) return;
    t.active = !t.active;
    ApiService.updateTeam(id, { active: t.active });
    this.renderAdminTeams();
    this.renderTeamList();
    this.renderTeamManage();
    this.showToast(t.active ? `已上架「${t.name}」` : `已下架「${t.name}」`);
  },

});
