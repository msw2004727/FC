/* ================================================
   SportHub Tournament Friendly Detail View
   Friendly-first detail page rendering.
   ================================================ */

const _tournamentFriendlyDetailViewLegacy = {
  renderRegisterButton: App.renderRegisterButton,
  renderTournamentTab: App.renderTournamentTab,
};

Object.assign(App, {

  _friendlyTournamentSelectedActionTeamById: {},

  _getFriendlyTournamentWithdrawSelection(selectId, fallbackTeamId) {
    return document.getElementById(selectId)?.value || fallbackTeamId;
  },

  _rememberFriendlyTournamentActionTeam(tournamentId, teamId) {
    const safeTournamentId = String(tournamentId || '').trim();
    const safeTeamId = String(teamId || '').trim();
    if (!safeTournamentId) return;
    if (safeTeamId) this._friendlyTournamentSelectedActionTeamById[safeTournamentId] = safeTeamId;
    else delete this._friendlyTournamentSelectedActionTeamById[safeTournamentId];
  },

  _handleFriendlyTournamentActionTeamChange(tournamentId, teamId) {
    const safeTournamentId = String(tournamentId || '').trim();
    this._rememberFriendlyTournamentActionTeam(safeTournamentId, teamId);
    const tournament = this._getFriendlyTournamentState?.(safeTournamentId)?.tournament
      || ApiService.getFriendlyTournamentRecord?.(safeTournamentId)
      || ApiService.getTournament?.(safeTournamentId);
    if (tournament) this.renderRegisterButton(tournament);
  },

  _normalizeFriendlyTournamentActionTeam(team, status) {
    const id = String(team?.id || team?.teamId || '').trim();
    if (!id) return null;
    const priorApplicationStatus = String(team?.priorApplicationStatus || '').trim().toLowerCase();
    const hasPriorRejectedApplication = team?.hasPriorRejectedApplication === true
      || priorApplicationStatus === 'removed'
      || priorApplicationStatus === 'rejected';
    return {
      id,
      status,
      name: String(team?.name || team?.teamName || '未命名俱樂部').trim(),
      image: team?.image || team?.teamImage || '',
      priorApplicationStatus,
      hasPriorRejectedApplication,
      source: team,
    };
  },

  _getFriendlyTournamentActionTeams(ctx) {
    const seen = new Set();
    const options = [];
    const push = (items, status) => {
      (items || []).forEach(item => {
        const option = this._normalizeFriendlyTournamentActionTeam(item, status);
        if (!option || seen.has(option.id)) return;
        seen.add(option.id);
        options.push(option);
      });
    };
    push(ctx.pendingTeams, 'pending');
    push(ctx.approvedTeams, 'approved');
    push(ctx.availableTeams, 'available');
    push(ctx.rejectedTeams, 'rejected');
    return options;
  },

  _getFriendlyTournamentSelectedActionTeam(tournamentId, actionTeams) {
    const safeTournamentId = String(tournamentId || '').trim();
    const domSelected = document.getElementById('td-apply-team-select')?.value || '';
    const remembered = safeTournamentId ? this._friendlyTournamentSelectedActionTeamById?.[safeTournamentId] : '';
    const selectedId = String(domSelected || remembered || '').trim();
    return actionTeams.find(team => team.id === selectedId) || actionTeams[0] || null;
  },

  _buildFriendlyTournamentActionTeamSelector(tournamentId, actionTeams, selectedTeamId) {
    if (!Array.isArray(actionTeams) || actionTeams.length === 0) return '';
    const safeTournamentId = String(tournamentId || '').trim();
    const selectedTeam = actionTeams.find(team => team.id === selectedTeamId);
    const selectClass = selectedTeam?.hasPriorRejectedApplication
      ? 'tfd-team-select tfd-team-select-reapply'
      : 'tfd-team-select';
    return `<select id="td-apply-team-select" class="${selectClass}" onchange="App._handleFriendlyTournamentActionTeamChange('${escapeHTML(safeTournamentId)}', this.value)">${actionTeams.map(team => {
      const selected = team.id === selectedTeamId ? ' selected' : '';
      const optionClass = team.hasPriorRejectedApplication ? ' class="tfd-apply-option-reapply"' : '';
      const labelSuffix = team.status === 'pending'
        ? '（審核中）'
        : team.status === 'approved'
          ? '（已通過）'
          : team.status === 'rejected'
            ? '（未通過）'
            : '';
      return `<option value="${escapeHTML(team.id)}"${selected}${optionClass}>${escapeHTML(team.name + labelSuffix)}</option>`;
    }).join('')}</select>`;
  },

  _isFriendlyTournamentViewerTeamOfficer(teamId, viewer = ApiService.getCurrentUser?.()) {
    const team = ApiService.getTeam?.(teamId);
    return !!(team && this._isTournamentTeamOfficerForTeam?.(team, viewer));
  },

  _buildFriendlyTournamentWithdrawControl(tournamentId, teams, label) {
    const safeTournamentId = String(tournamentId || '').trim();
    const options = (teams || [])
      .map(team => ({
        teamId: String(team?.teamId || team?.id || '').trim(),
        teamName: String(team?.teamName || team?.name || '未命名俱樂部').trim(),
      }))
      .filter(team => team.teamId);
    if (!safeTournamentId || options.length === 0) return '';

    const firstTeamId = options[0].teamId;
    const selectId = `tfd-withdraw-team-${safeTournamentId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const selector = options.length > 1
      ? `<select id="${escapeHTML(selectId)}" class="tfd-team-select">${options.map(team => `<option value="${escapeHTML(team.teamId)}">${escapeHTML(team.teamName)}</option>`).join('')}</select>`
      : '';

    return `
      <div class="tfd-action-withdraw">
        ${selector}
        <button type="button" class="outline-btn full-width tfd-team-withdraw-btn" onclick="return App.withdrawFriendlyTournamentTeam('${escapeHTML(safeTournamentId)}', App._getFriendlyTournamentWithdrawSelection('${escapeHTML(selectId)}','${escapeHTML(firstTeamId)}'), this)">${escapeHTML(label)}</button>
      </div>`;
  },

  renderRegisterButton(tournament) {
    if (!this._isFriendlyTournamentRecord?.(tournament)) {
      return _tournamentFriendlyDetailViewLegacy.renderRegisterButton.call(this, tournament);
    }
    const area = document.getElementById('td-register-area');
    if (!area) return;

    const state = this._getFriendlyTournamentState(tournament.id) || { tournament, applications: [], entries: [] };
    const user = ApiService.getCurrentUser?.();
    const ctx = this._getFriendlyTournamentApplyContext(tournament, state, user);
    const approvedCount = (this._getFriendlyTournamentRegisteredTeamIdsFromEntries?.(state.entries || [], tournament) || []).length;
    const teamLimit = this._getFriendlyTournamentTeamLimit?.(tournament) || 4;
    const status = this.getTournamentStatus(tournament);
    const isEnded = this.isTournamentEnded?.(tournament);
    const actionTeams = this._getFriendlyTournamentActionTeams(ctx);
    const selectedTeam = this._getFriendlyTournamentSelectedActionTeam(tournament.id, actionTeams);
    if (selectedTeam) this._rememberFriendlyTournamentActionTeam(tournament.id, selectedTeam.id);
    let selector = this._buildFriendlyTournamentActionTeamSelector(tournament.id, actionTeams, selectedTeam?.id);
    const priorRejectedHint = selectedTeam?.hasPriorRejectedApplication
      ? '<div class="tfd-reapply-note"><span>已被拒絕過</span>，仍可重新送出申請。</div>'
      : '';
    if (selectedTeam?.status === 'available' && priorRejectedHint) selector += priorRejectedHint;
    const responsibleTeamIds = new Set((this._getFriendlyResponsibleTeams?.(user) || []).map(team => team.id));
    const joinedTeamIds = new Set((typeof this._getUserTeamIds === 'function' ? this._getUserTeamIds(user) : [])
      .map(teamId => String(teamId || '').trim())
      .filter(Boolean));
    const canGlobalAdminWithdrawSelectedTeam = !!(
      this._isTournamentGlobalAdmin?.(user)
      && selectedTeam
      && joinedTeamIds.has(String(selectedTeam.id || '').trim())
    );
    const canWithdrawSelectedTeam = !!(
      selectedTeam
      && !isEnded
      && String(selectedTeam.id || '').trim() !== String(tournament.hostTeamId || '').trim()
      && (
        canGlobalAdminWithdrawSelectedTeam
        || responsibleTeamIds.has(selectedTeam.id)
        || this._isFriendlyTournamentViewerTeamOfficer?.(selectedTeam.id, user)
      )
    );

    let primaryHtml = '';
    let extraActionHtml = '';
    const pendingStatusButton = `<button type="button" class="primary-btn full-width tfd-status-btn" onclick="App.showToast('審核中請耐心等待')">俱樂部審核中</button>`;
    if (selectedTeam?.status === 'pending') {
      primaryHtml = `${selector}${pendingStatusButton}`;
      if (canWithdrawSelectedTeam) {
        extraActionHtml = `<button type="button" class="outline-btn full-width" onclick="return App.withdrawFriendlyTournamentTeam('${escapeHTML(tournament.id)}','${escapeHTML(selectedTeam.id)}', this)">撤回申請</button>`;
      }
    } else if (selectedTeam?.status === 'approved') {
      primaryHtml = `${selector}<button class="primary-btn full-width" disabled>俱樂部已通過審核</button>`;
      if (canWithdrawSelectedTeam) {
        extraActionHtml = `<button type="button" class="outline-btn full-width" onclick="return App.withdrawFriendlyTournamentTeam('${escapeHTML(tournament.id)}','${escapeHTML(selectedTeam.id)}', this)">取消報名</button>`;
      }
    } else if (selectedTeam?.status === 'rejected') {
      primaryHtml = `${selector}<button class="primary-btn full-width" disabled>俱樂部申請未通過</button>`;
    } else if (status === TOURNAMENT_STATUS.PREPARING) {
      primaryHtml = `${selector}<button class="primary-btn full-width" disabled>報名尚未開始</button>`;
    } else if (status === TOURNAMENT_STATUS.REG_CLOSED || isEnded) {
      primaryHtml = `${selector}<button class="primary-btn full-width" disabled>報名已截止</button>`;
    } else if (approvedCount >= teamLimit) {
      primaryHtml = `${selector}<button class="primary-btn full-width" disabled>隊伍名額已滿</button>`;
    } else if (selectedTeam?.status === 'available') {
      primaryHtml = `${selector}<button class="primary-btn full-width" onclick="return App.registerTournament('${tournament.id}', this)">參加賽事</button>`;
    } else if (ctx.pendingTeams.length > 0) {
      primaryHtml = pendingStatusButton;
    } else if (ctx.approvedTeams.length > 0) {
      primaryHtml = `<button class="primary-btn full-width" disabled>俱樂部已通過審核</button>`;
    } else if (ctx.rejectedTeams.length > 0) {
      primaryHtml = `<button class="primary-btn full-width" disabled>俱樂部申請未通過</button>`;
    } else {
      primaryHtml = `<button class="primary-btn full-width" onclick="App.showToast('需由俱樂部領隊或經理先行報名參賽。')">參加賽事</button>`;
    }

    const safeTournamentId = escapeHTML(tournament.id);
    const contactBtn = `<button type="button" class="outline-btn full-width" onclick="App.contactTournamentOrganizer('${safeTournamentId}')">聯繫主辦人</button>`;
    const shareBtn = `<button type="button" class="outline-btn full-width" onclick="return App.shareTournament('${safeTournamentId}', this)">分享賽事</button>`;
    const actionGridClass = extraActionHtml ? 'tfd-action-grid tfd-action-grid-three' : 'tfd-action-grid';

    area.innerHTML = `
      <div class="tfd-action-card" data-friendly-team-action-status="${escapeHTML(selectedTeam?.status || '')}">
        <div class="tfd-action-main" data-friendly-team-action-status="${escapeHTML(selectedTeam?.status || '')}" data-friendly-team-id="${escapeHTML(selectedTeam?.id || '')}">${primaryHtml}</div>
        <div class="${actionGridClass}">
          ${contactBtn}
          ${shareBtn}
          ${extraActionHtml}
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
    const canManage = !!(this._isTournamentGlobalAdmin?.(viewer) || this._canManageTournamentRecord?.(tournament, viewer));
    const teamLimit = this._getFriendlyTournamentTeamLimit?.(tournament) || 4;
    const approvedEntries = (state.entries || []).filter(entry => entry.entryStatus === 'host' || entry.entryStatus === 'approved');
    const approvedCount = (this._getFriendlyTournamentRegisteredTeamIdsFromEntries?.(approvedEntries, tournament) || []).length;
    const visibleApplications = this._getFriendlyTournamentVisibleApplications(state, viewer);
    const emptySlots = Math.max(0, teamLimit - approvedCount);

    const entryRows = approvedEntries.map(entry => {
      const teamName = entry.teamName || '未命名俱樂部';
      const roster = Array.isArray(entry.memberRoster) && entry.memberRoster.length
        ? entry.memberRoster.map(member => `<span class="tfd-member-chip">${escapeHTML(member.name || member.uid)}</span>`).join('')
        : '<span class="tfd-empty-text">尚無隊員報名</span>';
      const isViewerTeamOfficer = this._isFriendlyTournamentViewerTeamOfficer?.(entry.teamId, viewer);
      const removeAction = canManage && entry.entryStatus !== 'host'
        ? `<button type="button" class="tfd-entry-remove-btn" onclick="event.stopPropagation();return App.removeFriendlyTournamentEntry('${escapeHTML(tournament.id)}','${escapeHTML(entry.teamId)}', this)">剔除</button>`
        : (!canManage && isViewerTeamOfficer && entry.entryStatus !== 'host'
          ? `<button type="button" class="tfd-entry-withdraw-btn" onclick="event.stopPropagation();return App.withdrawFriendlyTournamentTeam('${escapeHTML(tournament.id)}','${escapeHTML(entry.teamId)}', this)">退出賽事</button>`
          : '');
      return `
        <div class="tfd-team-row">
          <div class="tfd-team-side">
            <div class="tfd-team-thumb">${entry.teamImage ? `<img src="${entry.teamImage}" alt="${escapeHTML(teamName)}">` : `<span>${escapeHTML((teamName || '?').slice(0, 1))}</span>`}</div>
            <div class="tfd-team-meta">
              <div class="tfd-team-name" title="${escapeHTML(teamName)}">${escapeHTML(teamName)}</div>
              <div class="tfd-team-status">${entry.entryStatus === 'host' ? (this._friendlyTournamentEntryCountsTowardLimit?.(entry, tournament) ? '主辦俱樂部・參賽' : '主辦俱樂部・未參賽') : '已核准參賽'}</div>
            </div>
          </div>
          <div class="tfd-team-roster">${roster}</div>
          ${removeAction ? `<div class="tfd-team-action">${removeAction}</div>` : ''}
        </div>`;
    }).join('');

    const pendingRows = visibleApplications.map(application => {
      const isRejected = application.status === 'rejected';
      const isViewerTeamOfficer = this._isFriendlyTournamentViewerTeamOfficer?.(application.teamId, viewer);
      const applicationTeamName = application.teamName || '未命名俱樂部';
      const requesterName = application.requestedByName || '申請人';
      const actions = canManage && !isRejected
        ? `<div class="tfd-review-actions">
             <button type="button" class="primary-btn small" onclick="return App.reviewFriendlyTournamentApplication('${escapeHTML(tournament.id)}','${escapeHTML(application.id)}','approve', this)">確認</button>
             <button type="button" class="outline-btn small" onclick="return App.reviewFriendlyTournamentApplication('${escapeHTML(tournament.id)}','${escapeHTML(application.id)}','reject', this)">拒絕</button>
           </div>`
        : (!canManage && isViewerTeamOfficer && !isRejected
          ? `<div class="tfd-team-action"><button type="button" class="tfd-entry-withdraw-btn" onclick="event.stopPropagation();return App.withdrawFriendlyTournamentTeam('${escapeHTML(tournament.id)}','${escapeHTML(application.teamId)}', this)">撤回申請</button></div>`
          : '');
      return `
        <div class="tfd-team-row tfd-team-row-pending${isRejected ? ' tfd-team-row-rejected' : ''}">
          <div class="tfd-team-side">
            <div class="tfd-team-thumb">${application.teamImage ? `<img src="${application.teamImage}" alt="${escapeHTML(applicationTeamName)}">` : `<span>${escapeHTML((applicationTeamName || '?').slice(0, 1))}</span>`}</div>
            <div class="tfd-team-meta">
              <div class="tfd-team-name" title="${escapeHTML(applicationTeamName)}">${escapeHTML(applicationTeamName)}</div>
              <div class="tfd-team-status">${isRejected ? '申請未通過' : '審核中(僅自己與主辦能見)'}</div>
            </div>
          </div>
          <div class="tfd-team-roster" title="${escapeHTML(requesterName)}"><span class="tfd-empty-text">${escapeHTML(requesterName)}</span></div>
          ${actions}
        </div>`;
    }).join('');

    const slotRows = Array.from({ length: emptySlots }).map(() => `
      <div class="tfd-team-row tfd-team-row-slot">
        <div class="tfd-team-side">
          <div class="tfd-team-thumb tfd-team-thumb-slot"><span>+</span></div>
          <div class="tfd-team-meta">
            <div class="tfd-team-name">待報名俱樂部</div>
            <div class="tfd-team-status">保留友誼賽名額</div>
          </div>
        </div>
        <div class="tfd-team-roster"><span class="tfd-empty-text">核准後顯示</span></div>
      </div>`).join('');

    return `
      <div class="tfd-team-board">
        <div class="tfd-team-summary">已核准 ${approvedCount} / ${teamLimit} 隊${visibleApplications.length ? `，待審 ${visibleApplications.filter(item => item.status === 'pending').length} 隊` : ''}</div>
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

  // shareTournament 已移至 js/modules/tournament-share.js（LIFF Flex Message 版）
});
