/* ================================================
   SportHub Tournament Friendly Detail View
   Friendly-first detail page rendering.
   ================================================ */

const _tournamentFriendlyDetailViewLegacy = {
  renderRegisterButton: App.renderRegisterButton,
  renderTournamentTab: App.renderTournamentTab,
};

Object.assign(App, {

  renderRegisterButton(tournament) {
    if (!this._isFriendlyTournamentRecord?.(tournament)) {
      return _tournamentFriendlyDetailViewLegacy.renderRegisterButton.call(this, tournament);
    }
    const area = document.getElementById('td-register-area');
    if (!area) return;

    const state = this._getFriendlyTournamentState(tournament.id) || { tournament, applications: [], entries: [] };
    const user = ApiService.getCurrentUser?.();
    const ctx = this._getFriendlyTournamentApplyContext(tournament, state, user);
    const approvedCount = (state.entries || []).filter(entry => entry.entryStatus === 'host' || entry.entryStatus === 'approved').length;
    const teamLimit = this._getFriendlyTournamentTeamLimit?.(tournament) || 4;
    const status = this.getTournamentStatus(tournament);

    let primaryHtml = '';
    if (status === '即將開始') {
      primaryHtml = `<button class="primary-btn full-width" disabled>報名尚未開始</button>`;
    } else if (status === '已截止報名' || this.isTournamentEnded?.(tournament)) {
      primaryHtml = `<button class="primary-btn full-width" disabled>報名已截止</button>`;
    } else if (approvedCount >= teamLimit && ctx.availableTeams.length > 0) {
      primaryHtml = `<button class="primary-btn full-width" disabled>隊伍名額已滿</button>`;
    } else if (ctx.availableTeams.length > 0) {
      const selector = ctx.availableTeams.length > 1
        ? `<select id="td-apply-team-select" class="tfd-team-select">${ctx.availableTeams.map(team => `<option value="${escapeHTML(team.id)}">${escapeHTML(team.name)}</option>`).join('')}</select>`
        : '';
      primaryHtml = `${selector}<button class="primary-btn full-width" onclick="App.registerTournament('${tournament.id}')">參加賽事</button>`;
    } else if (ctx.pendingTeams.length > 0) {
      primaryHtml = `<button class="primary-btn full-width" disabled>球隊審核中</button>`;
    } else if (ctx.approvedTeams.length > 0) {
      primaryHtml = `<button class="primary-btn full-width" disabled>球隊已通過審核</button>`;
    } else if (ctx.rejectedTeams.length > 0) {
      primaryHtml = `<button class="primary-btn full-width" disabled>球隊申請未通過</button>`;
    } else {
      primaryHtml = `<button class="primary-btn full-width" onclick="App.showToast('需由球隊領隊或經理先行報名參賽。')">參加賽事</button>`;
    }

    const contactName = tournament.creatorName || tournament.organizer || '';
    const contactBtn = contactName
      ? `<button class="outline-btn full-width" onclick="App.showUserProfile(${JSON.stringify(contactName)})">聯繫主辦人</button>`
      : `<button class="outline-btn full-width" onclick="App.showToast('暫時找不到主辦人資料。')">聯繫主辦人</button>`;

    area.innerHTML = `
      <div class="tfd-action-card">
        <div class="tfd-action-main">${primaryHtml}</div>
        <div class="tfd-action-grid">
          ${contactBtn}
          <button class="outline-btn full-width" onclick="App.shareTournament('${tournament.id}')">分享賽事</button>
        </div>
        <div class="tfd-action-meta">已核准 ${approvedCount} / ${teamLimit} 隊${ctx.pendingTeams.length ? `，待審 ${ctx.pendingTeams.length} 隊` : ''}</div>
      </div>`;
  },

  _renderFriendlyTournamentTeamsTab(state) {
    const tournament = state?.tournament;
    if (!tournament) {
      return '<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:.85rem">找不到賽事資料</div>';
    }

    const viewer = ApiService.getCurrentUser?.();
    const canManage = this._canManageTournamentRecord?.(tournament, viewer);
    const teamLimit = this._getFriendlyTournamentTeamLimit?.(tournament) || 4;
    const approvedEntries = (state.entries || []).filter(entry => entry.entryStatus === 'host' || entry.entryStatus === 'approved');
    const visibleApplications = this._getFriendlyTournamentVisibleApplications(state, viewer);
    const emptySlots = Math.max(0, teamLimit - approvedEntries.length);

    const entryRows = approvedEntries.map(entry => {
      const roster = Array.isArray(entry.memberRoster) && entry.memberRoster.length
        ? entry.memberRoster.map(member => `<span class="tfd-member-chip">${escapeHTML(member.name || member.uid)}</span>`).join('')
        : '<span class="tfd-empty-text">尚無隊員報名</span>';
      return `
        <div class="tfd-team-row">
          <div class="tfd-team-side">
            <div class="tfd-team-thumb">${entry.teamImage ? `<img src="${entry.teamImage}" alt="${escapeHTML(entry.teamName)}">` : `<span>${escapeHTML((entry.teamName || '?').slice(0, 1))}</span>`}</div>
            <div class="tfd-team-meta">
              <div class="tfd-team-name">${escapeHTML(entry.teamName || '未命名球隊')}</div>
              <div class="tfd-team-status">${entry.entryStatus === 'host' ? '主辦球隊' : '已核准參賽'}</div>
            </div>
          </div>
          <div class="tfd-team-roster">${roster}</div>
        </div>`;
    }).join('');

    const pendingRows = visibleApplications.map(application => {
      const isRejected = application.status === 'rejected';
      const actions = canManage && !isRejected
        ? `<div class="tfd-review-actions">
             <button class="primary-btn small" onclick="App.reviewFriendlyTournamentApplication('${tournament.id}','${application.id}','approve')">確認</button>
             <button class="outline-btn small" onclick="App.reviewFriendlyTournamentApplication('${tournament.id}','${application.id}','reject')">拒絕</button>
           </div>`
        : '';
      return `
        <div class="tfd-team-row tfd-team-row-pending${isRejected ? ' tfd-team-row-rejected' : ''}">
          <div class="tfd-team-side">
            <div class="tfd-team-thumb">${application.teamImage ? `<img src="${application.teamImage}" alt="${escapeHTML(application.teamName)}">` : `<span>${escapeHTML((application.teamName || '?').slice(0, 1))}</span>`}</div>
            <div class="tfd-team-meta">
              <div class="tfd-team-name">${escapeHTML(application.teamName || '未命名球隊')}</div>
              <div class="tfd-team-status">${isRejected ? '申請未通過' : '審核中，僅主辦方與申請方可見'}</div>
            </div>
          </div>
          <div class="tfd-team-roster"><span class="tfd-empty-text">${escapeHTML(application.requestedByName || '申請人')}</span></div>
          ${actions}
        </div>`;
    }).join('');

    const slotRows = Array.from({ length: emptySlots }).map(() => `
      <div class="tfd-team-row tfd-team-row-slot">
        <div class="tfd-team-side">
          <div class="tfd-team-thumb tfd-team-thumb-slot"><span>+</span></div>
          <div class="tfd-team-meta">
            <div class="tfd-team-name">待報名球隊</div>
            <div class="tfd-team-status">保留友誼賽名額</div>
          </div>
        </div>
        <div class="tfd-team-roster"><span class="tfd-empty-text">主辦核准後將顯示於此</span></div>
      </div>`).join('');

    return `
      <div class="tfd-team-board">
        <div class="tfd-team-summary">已核准 ${approvedEntries.length} / ${teamLimit} 隊${visibleApplications.length ? `，待審 ${visibleApplications.filter(item => item.status === 'pending').length} 隊` : ''}</div>
        ${entryRows || '<div class="tfd-empty-state">目前尚無已核准隊伍</div>'}
        ${slotRows}
        ${pendingRows}
      </div>`;
  },

  renderTournamentTab(tab) {
    const tournament = ApiService.getFriendlyTournamentRecord?.(this.currentTournament) || ApiService.getTournament?.(this.currentTournament);
    if (!tournament || !this._isFriendlyTournamentRecord?.(tournament) || tab !== 'teams') {
      return _tournamentFriendlyDetailViewLegacy.renderTournamentTab.call(this, tab);
    }
    const container = document.getElementById('tournament-content');
    if (!container) return;
    const state = this._getFriendlyTournamentState(tournament.id) || { tournament, applications: [], entries: tournament.teamEntries || [] };
    container.innerHTML = this._renderFriendlyTournamentTeamsTab(state);
  },

  shareTournament(tournamentId) {
    const tournament = ApiService.getFriendlyTournamentRecord?.(tournamentId) || ApiService.getTournament?.(tournamentId);
    if (!tournament) return;
    const url = `${location.origin}${location.pathname}?tournament=${encodeURIComponent(tournamentId)}`;
    const shareText = [
      `賽事：${tournament.name}`,
      `類型：${this._getTournamentModeLabel?.(tournament) || '友誼賽'}`,
      `主辦：${this._getTournamentOrganizerDisplayText?.(tournament) || tournament.organizer || '主辦球隊'}`,
      tournament.region ? `地區：${tournament.region}` : '',
      url,
    ].filter(Boolean).join('\n');
    if (navigator.share) {
      navigator.share({ text: shareText }).catch(() => {});
      return;
    }
    navigator.clipboard.writeText(shareText)
      .then(() => this.showToast('賽事分享內容已複製。'))
      .catch(() => this.showToast('複製失敗'));
  },
});
