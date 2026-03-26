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
    const memberLabel = isEdu ? '學員' : I18N.t('team.memberLabel');
    const memberCount = isEdu
      ? ((this._eduStudentsCache && this._eduStudentsCache[t.id])
        ? this._eduStudentsCache[t.id].filter(s => s.enrollStatus === 'active').length
        : 0)
      : this._calcTeamMemberCount(t.id);
    return `
      <div class="tc-card${pinnedClass}" onclick="App.showTeamDetail('${t.id}')">
        ${t.pinned ? '<div class="tc-pin-badge">置頂</div>' : ''}
        ${t.image
          ? `<div style="position:relative;width:100%;aspect-ratio:1;overflow:hidden;border-radius:var(--radius) var(--radius) 0 0"><img src="${t.image}" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block"><span class="tc-rank-badge" style="color:${rank.color}"><span class="tc-rank-score">${(t.teamExp || 0).toLocaleString()}</span>${rank.rank}</span></div>`
          : `<div class="tc-img-placeholder" style="position:relative">俱樂部圖片<span class="tc-rank-badge" style="color:${rank.color}"><span class="tc-rank-score">${(t.teamExp || 0).toLocaleString()}</span>${rank.rank}</span></div>`}
        <div class="tc-body">
          <div class="tc-name">${escapeHTML(t.name)}${eduBadge}</div>
          <div class="tc-info-row"><span class="tc-label">${memberLabel}</span><span>${memberCount} ${I18N.t('team.personUnit')}</span></div>
          <div class="tc-info-row"><span class="tc-label">${I18N.t('team.regionLabel')}</span><span>${escapeHTML(t.region || '')}</span></div>
        </div>
      </div>`;
  },

  renderTeamList() {
    const container = document.getElementById('team-list');
    if (!container) return;
    this._refreshTeamCreateButtons();
    let teams = ApiService.getActiveTeams();
    const typeTab = this._currentTeamTypeTab || '';
    if (typeTab) {
      teams = teams.filter(t => (t.type || 'general') === typeTab);
    }
    const sorted = this._sortTeams(teams);
    container.innerHTML = sorted.length > 0
      ? sorted.map(t => this._teamCardHTML(t)).join('')
      : '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-muted);font-size:.85rem">此類型尚無俱樂部</div>';
    this._markPageSnapshotReady?.('page-teams');

    // ★ 背景載入所有教育俱樂部學員數，完成後重繪
    const eduTeams = sorted.filter(t => t.type === 'education');
    if (eduTeams.length) {
      Promise.all(eduTeams.map(t => this._loadEduStudents?.(t.id).catch(() => {}))).then(() => {
        if (this.currentPage === 'page-teams') {
          const c = document.getElementById('team-list');
          if (!c) return;
          let ts = ApiService.getActiveTeams();
          if (typeTab) ts = ts.filter(t => (t.type || 'general') === typeTab);
          c.innerHTML = this._sortTeams(ts).map(t => this._teamCardHTML(t)).join('') || c.innerHTML;
        }
      });
    }
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
    const isAdmin = ROLE_LEVEL_MAP[this.currentRole] >= ROLE_LEVEL_MAP['admin'] || this.hasPermission('team.manage_all');

    let teams;
    if (currentFilter === 'my-teams' && !isAdmin) {
      teams = ApiService.getTeams().filter(t => this._isTeamOwner(t));
    } else {
      teams = ApiService.getTeams();
    }

    if (!teams.length) {
      container.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:.85rem">尚無俱樂部資料</div>';
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
            <span class="event-meta-item">領隊 ${escapeHTML(t.leader || '未設定')}</span>
            <span class="event-meta-item">俱樂部經理 ${escapeHTML(t.captain || '未設定')}</span>
            <span class="event-meta-item">${this._calcTeamMemberCount(t.id)}人</span>
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
    if (!teams.length) {
      container.innerHTML = '<div style="padding:1rem;font-size:.82rem;color:var(--text-muted);text-align:center">未找到符合條件的俱樂部</div>';
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
            <span class="event-meta-item">領隊 ${escapeHTML(t.leader || '未設定')}</span>
            <span class="event-meta-item">俱樂部經理 ${escapeHTML(t.captain || '未設定')}</span>
            <span class="event-meta-item">${this._calcTeamMemberCount(t.id)}人</span>
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
      html += '<hr class="team-section-divider"><div class="team-section-label">已下架俱樂部</div>';
      html += inactiveT.map(adminCard).join('');
    }
    container.innerHTML = html;
    this._markPageSnapshotReady?.('page-admin-teams');
  },

});
