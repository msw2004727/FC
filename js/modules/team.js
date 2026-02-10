/* ================================================
   SportHub — Team (Render + Admin Management)
   ================================================ */

Object.assign(App, {

  _sortTeams(teams) {
    return [...teams].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      if (a.pinned && b.pinned) return (a.pinOrder || 0) - (b.pinOrder || 0);
      return 0;
    });
  },

  _teamCardHTML(t) {
    const pinnedClass = t.pinned ? ' tc-pinned' : '';
    return `
      <div class="tc-card${pinnedClass}" onclick="App.showTeamDetail('${t.id}')">
        ${t.pinned ? '<div class="tc-pin-badge">至頂</div>' : ''}
        <div class="tc-img-placeholder">球隊封面 800 × 300</div>
        <div class="tc-body">
          <div class="tc-name">${t.name}</div>
          <div class="tc-name-en">${t.nameEn || ''}</div>
          <div class="tc-info-row"><span class="tc-label">領隊</span><span>${this._userTag(t.captain, 'captain')}</span></div>
          <div class="tc-info-row"><span class="tc-label">教練</span><span>${t.coaches.length > 0 ? t.coaches.map(c => this._userTag(c, 'coach')).join(' ') : '—'}</span></div>
          <div class="tc-info-row"><span class="tc-label">隊員</span><span>${t.members} 人</span></div>
          <div class="tc-info-row"><span class="tc-label">地區</span><span>${t.region}</span></div>
        </div>
      </div>`;
  },

  renderTeamList() {
    const container = document.getElementById('team-list');
    if (!container) return;
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
      : '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-muted);font-size:.85rem">找不到符合的球隊</div>';
  },

  showTeamDetail(id) {
    const t = ApiService.getTeam(id);
    if (!t) return;
    document.getElementById('team-detail-title').textContent = t.name;
    document.getElementById('team-detail-name-en').textContent = t.nameEn || '';

    const totalGames = t.wins + t.draws + t.losses;
    const winRate = totalGames > 0 ? Math.round(t.wins / totalGames * 100) : 0;

    document.getElementById('team-detail-body').innerHTML = `
      <div class="td-card">
        <div class="td-card-title">球隊資訊</div>
        <div class="td-card-grid">
          <div class="td-card-item"><span class="td-card-label">領隊</span><span class="td-card-value">${this._userTag(t.captain, 'captain')}</span></div>
          <div class="td-card-item"><span class="td-card-label">教練</span><span class="td-card-value">${t.coaches.length > 0 ? t.coaches.map(c => this._userTag(c, 'coach')).join(' ') : '無'}</span></div>
          <div class="td-card-item"><span class="td-card-label">隊員數</span><span class="td-card-value">${t.members} 人</span></div>
          <div class="td-card-item"><span class="td-card-label">地區</span><span class="td-card-value">${t.region}</span></div>
        </div>
      </div>
      <div class="td-card">
        <div class="td-card-title">球隊戰績</div>
        <div class="td-stats-row">
          <div class="td-stat"><span class="td-stat-num" style="color:var(--success)">${t.wins}</span><span class="td-stat-label">勝</span></div>
          <div class="td-stat"><span class="td-stat-num" style="color:var(--warning)">${t.draws}</span><span class="td-stat-label">平</span></div>
          <div class="td-stat"><span class="td-stat-num" style="color:var(--danger)">${t.losses}</span><span class="td-stat-label">負</span></div>
          <div class="td-stat"><span class="td-stat-num">${winRate}%</span><span class="td-stat-label">勝率</span></div>
        </div>
        <div class="td-card-grid" style="margin-top:.5rem">
          <div class="td-card-item"><span class="td-card-label">進球</span><span class="td-card-value">${t.gf}</span></div>
          <div class="td-card-item"><span class="td-card-label">失球</span><span class="td-card-value">${t.ga}</span></div>
          <div class="td-card-item"><span class="td-card-label">淨勝球</span><span class="td-card-value">${t.gf - t.ga > 0 ? '+' : ''}${t.gf - t.ga}</span></div>
          <div class="td-card-item"><span class="td-card-label">總場次</span><span class="td-card-value">${totalGames}</span></div>
        </div>
      </div>
      <div class="td-card">
        <div class="td-card-title">賽事紀錄</div>
        ${(t.history || []).map(h => `
          <div class="td-history-row">
            <span class="td-history-name">${h.name}</span>
            <span class="td-history-result">${h.result}</span>
          </div>
        `).join('') || '<div style="font-size:.82rem;color:var(--text-muted);padding:.3rem">尚無賽事紀錄</div>'}
      </div>
      <div class="td-card">
        <div class="td-card-title">成員列表</div>
        <div class="td-member-list">
          ${Array.from({length: Math.min(t.members, 8)}, (_, i) => {
            const role = i === 0 ? 'captain' : i <= t.coaches.length ? 'coach' : 'user';
            const roleLabel = i === 0 ? '領隊' : i <= t.coaches.length ? '教練' : '球員';
            const roleClass = i === 0 ? 'captain' : i <= t.coaches.length ? 'coach' : 'player';
            const memberName = i === 0 ? t.captain : i <= t.coaches.length ? t.coaches[i - 1] : '球員' + String.fromCharCode(65 + i);
            return `
            <div class="td-member-card">
              <div class="td-member-avatar" style="background:${t.color}22;color:${t.color}">${i === 0 ? t.captain.charAt(t.captain.length - 1) : String.fromCharCode(65 + i)}</div>
              <div class="td-member-info">
                <div class="td-member-name">${this._userTag(memberName, role)}</div>
                <span class="td-member-role ${roleClass}">${roleLabel}</span>
              </div>
            </div>`;
          }).join('')}
          ${t.members > 8 ? `<div class="td-member-more">... 共 ${t.members} 人</div>` : ''}
        </div>
      </div>
      <div class="td-actions">
        <button class="primary-btn" onclick="App.handleJoinTeam()">申請加入</button>
        <button class="outline-btn" onclick="App.showToast('透過站內信聯繫')">聯繫領隊</button>
      </div>
    `;
    this.showPage('page-team-detail');
  },

  handleJoinTeam() {
    let teamId = this._userTeam;
    if (!ModeManager.isDemo()) {
      const user = ApiService.getCurrentUser();
      teamId = user && user.teamId ? user.teamId : null;
    }
    if (teamId) {
      const team = ApiService.getTeam(teamId);
      const teamName = team ? team.name : '球隊';
      this.showToast(`您已加入「${teamName}」，無法重複加入其他球隊`);
      return;
    }
    this.showToast('已送出加入申請！');
  },

  goMyTeam() {
    // 正式版：從資料庫取 teamId
    let teamId = this._userTeam;
    if (!ModeManager.isDemo()) {
      const user = ApiService.getCurrentUser();
      teamId = user && user.teamId ? user.teamId : null;
    }
    if (teamId) {
      this.showTeamDetail(teamId);
    } else {
      this.showToast('您目前沒有加入任何球隊');
    }
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
    if (q) teams = teams.filter(t => t.name.toLowerCase().includes(q) || t.nameEn.toLowerCase().includes(q) || t.captain.includes(q) || t.region.includes(q));
    container.innerHTML = teams.length ? teams.map(t => `
      <div class="event-card">
        <div class="event-card-body">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div class="event-card-title">${t.name} <span style="font-size:.72rem;color:var(--text-muted)">${t.nameEn}</span></div>
            ${t.pinned ? '<span style="font-size:.72rem;color:var(--warning);font-weight:600">至頂</span>' : ''}
          </div>
          <div class="event-meta">
            <span class="event-meta-item">領隊 ${t.captain}</span>
            <span class="event-meta-item">${t.members}人</span>
            <span class="event-meta-item">${t.region}</span>
            <span class="event-meta-item" style="color:${t.active ? 'var(--success)' : 'var(--danger)'}">${t.active ? '上架中' : '已下架'}</span>
          </div>
          <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.5rem">
            <button class="primary-btn small" onclick="App.toggleTeamPin('${t.id}')">${t.pinned ? '取消至頂' : '至頂'}</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="App.toggleTeamActive('${t.id}')">${t.active ? '下架' : '上架'}</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="App.showTeamDetail('${t.id}')">查看</button>
          </div>
        </div>
      </div>
    `).join('') : '<div style="padding:1rem;font-size:.82rem;color:var(--text-muted);text-align:center">未找到符合條件的球隊</div>';
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
    this.showToast(t.pinned ? `已至頂「${t.name}」` : `已取消至頂「${t.name}」`);
  },

  toggleTeamActive(id) {
    const t = ApiService.getTeam(id);
    if (!t) return;
    t.active = !t.active;
    ApiService.updateTeam(id, { active: t.active });
    this.renderAdminTeams();
    this.renderTeamList();
    this.showToast(t.active ? `已上架「${t.name}」` : `已下架「${t.name}」`);
  },

});
