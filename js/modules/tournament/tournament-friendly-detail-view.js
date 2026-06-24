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
  _friendlyTournamentRosterListState: null,

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
      canonicalTeamId: String(team?.canonicalTeamId || team?.sourceTeamId || id).trim(),
      status,
      name: String(team?.name || team?.teamName || '未命名俱樂部').trim(),
      image: team?.image || team?.teamImage || '',
      priorApplicationStatus,
      hasPriorRejectedApplication,
      disabled: team?.sportMismatch === true || status === 'sport-mismatch',
      disabledReason: team?.disabledReason || '',
      source: team,
    };
  },

  _getFriendlyTournamentActionTeams(ctx) {
    const seen = new Set();
    const options = [];
    const push = (items, status) => {
      (items || []).forEach(item => {
        const option = this._normalizeFriendlyTournamentActionTeam(item, status);
        const dedupeKey = option?.canonicalTeamId || option?.id;
        if (!option || seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        options.push(option);
      });
    };
    push(ctx.availableTeams, 'available');
    push(ctx.pendingTeams, 'pending');
    push(ctx.approvedTeams, 'approved');
    push(ctx.blockedTeams, 'sport-mismatch');
    return options;
  },

  _getFriendlyTournamentSelectedActionTeam(tournamentId, actionTeams) {
    const safeTournamentId = String(tournamentId || '').trim();
    const domSelected = document.getElementById('td-apply-team-select')?.value || '';
    const remembered = safeTournamentId ? this._friendlyTournamentSelectedActionTeamById?.[safeTournamentId] : '';
    const selectedId = String(domSelected || remembered || '').trim();
    const selectedTeam = actionTeams.find(team => team.id === selectedId);
    if (selectedTeam && !selectedTeam.disabled) return selectedTeam;
    const availableTeam = actionTeams.find(team => team.status === 'available' && !team.disabled);
    if (availableTeam) return availableTeam;
    return actionTeams.find(team => !team.disabled) || selectedTeam || actionTeams[0] || null;
  },

  _buildFriendlyTournamentActionTeamSelector(tournamentId, actionTeams, selectedTeamId) {
    if (!Array.isArray(actionTeams) || actionTeams.length === 0) return '';
    const safeTournamentId = String(tournamentId || '').trim();
    const selectedTeam = actionTeams.find(team => team.id === selectedTeamId);
    const selectClass = selectedTeam?.hasPriorRejectedApplication
      ? 'tfd-team-select tfd-team-select-reapply'
      : selectedTeam?.disabled
        ? 'tfd-team-select tfd-team-select-disabled'
        : 'tfd-team-select';
    return `<select id="td-apply-team-select" class="${selectClass}" onchange="App._handleFriendlyTournamentActionTeamChange('${escapeHTML(safeTournamentId)}', this.value)">${actionTeams.map(team => {
      const selected = team.id === selectedTeamId ? ' selected' : '';
      const classes = [
        team.hasPriorRejectedApplication ? 'tfd-apply-option-reapply' : '',
        team.disabled ? 'tfd-apply-option-disabled' : '',
      ].filter(Boolean).join(' ');
      const optionClass = classes ? ` class="${classes}"` : '';
      const disabled = team.disabled ? ' disabled' : '';
      const labelSuffix = team.status === 'pending'
        ? '（審核中）'
        : team.status === 'approved'
          ? '（已通過）'
          : team.status === 'rejected'
            ? '（未通過）'
            : '';
      const optionLabel = team.status === 'sport-mismatch'
        ? `${team.name}（非本類賽事運動）`
        : team.name + labelSuffix;
      return `<option value="${escapeHTML(team.id)}"${selected}${disabled}${optionClass}>${escapeHTML(optionLabel)}</option>`;
    }).join('')}</select>`;
  },

  _isFriendlyTournamentViewerTeamOfficer(teamId, viewer = ApiService.getCurrentUser?.()) {
    const team = ApiService.getTeam?.(teamId);
    return !!(team && this._isTournamentTeamOfficerForTeam?.(team, viewer));
  },

  _getFriendlyTournamentEntryAliasIds(entry) {
    const aliases = [];
    const seen = new Set();
    const add = value => {
      const safeValue = String(value || '').trim();
      if (!safeValue || seen.has(safeValue)) return;
      seen.add(safeValue);
      aliases.push(safeValue);
    };
    add(entry?.teamId);
    add(entry?.id);
    add(entry?._docId);
    add(entry?.docId);
    add(entry?.canonicalTeamId);
    add(entry?.sourceTeamId);

    const entryTeamId = String(entry?.teamId || entry?.id || '').trim();
    const team = entryTeamId
      ? (ApiService.getTeam?.(entryTeamId)
        || (ApiService.getTeams?.() || []).find(item =>
          (this._getFriendlyTournamentTeamAliasIds?.(item) || []).includes(entryTeamId)
        ))
      : null;
    (this._getFriendlyTournamentTeamAliasIds?.(team) || []).forEach(add);
    return aliases;
  },

  _getFriendlyTournamentUserRosterTeamIdSet(user = ApiService.getCurrentUser?.()) {
    const ids = new Set();
    const add = value => {
      const safeValue = String(value || '').trim();
      if (safeValue) ids.add(safeValue);
    };
    if (typeof this._getUserTeamIds === 'function') {
      this._getUserTeamIds(user).forEach(add);
    }
    if (typeof this._getFriendlyTournamentUserActionTeamIds === 'function') {
      this._getFriendlyTournamentUserActionTeamIds(user).forEach(add);
    }
    (this._getFriendlyTournamentJoinedTeams?.(user) || []).forEach(team => {
      (this._getFriendlyTournamentTeamAliasIds?.(team) || []).forEach(add);
    });
    return ids;
  },

  _isFriendlyTournamentViewerOnEntryTeam(entry, user = ApiService.getCurrentUser?.()) {
    const userTeamIds = this._getFriendlyTournamentUserRosterTeamIdSet(user);
    if (!userTeamIds.size) return false;
    return this._getFriendlyTournamentEntryAliasIds(entry).some(alias => userTeamIds.has(alias));
  },

  _getFriendlyTournamentRosterMembershipForUser(state, user = ApiService.getCurrentUser?.()) {
    const uidCandidates = new Set([
      user?.uid,
      user?.lineUserId,
    ].map(value => String(value || '').trim()).filter(Boolean));
    if (!uidCandidates.size) return { primary: null, list: [] };
    const list = (state?.entries || []).filter(entry =>
      (entry.memberRoster || []).some(member => uidCandidates.has(String(member?.uid || '').trim()))
    );
    return { primary: list[0] || null, list };
  },

  _isSameFriendlyTournamentEntry(left, right) {
    const rightAliases = new Set(this._getFriendlyTournamentEntryAliasIds(right));
    return this._getFriendlyTournamentEntryAliasIds(left).some(alias => rightAliases.has(alias));
  },

  _findFriendlyTournamentEntryForActionTeam(state, actionTeam) {
    if (!actionTeam) return null;
    return (state?.entries || []).find(entry => this._isSameFriendlyTournamentEntry(entry, actionTeam)) || null;
  },

  _buildFriendlyTournamentRosterActionButton(tournamentId, entry, membership, status, options = {}) {
    const safeTournamentId = escapeHTML(String(tournamentId || '').trim());
    const safeTeamId = escapeHTML(String(entry?.teamId || entry?.id || '').trim());
    if (!safeTournamentId || !safeTeamId) return '';
    const stop = options.stopPropagation ? 'event.stopPropagation();' : '';
    const fullWidth = options.fullWidth === true;
    const isCurrentEntry = !!(membership?.primary && this._isSameFriendlyTournamentEntry(membership.primary, entry));
    const hasOtherEntry = !!(membership?.primary && !isCurrentEntry);
    const alreadyJoinedToast = '你已有參賽隊伍';

    if (isCurrentEntry) {
      if (status !== TOURNAMENT_STATUS.REG_OPEN) {
        return `<button type="button" class="${fullWidth ? 'primary-btn full-width ' : ''}tfd-roster-joined-btn" disabled>已參賽</button>`;
      }
      return `<button type="button" class="${fullWidth ? 'outline-btn full-width ' : ''}tfd-roster-leave-btn" onclick="${stop}return App.cancelFriendlyTournamentRoster('${safeTournamentId}', this)">取消參賽</button>`;
    }
    if (hasOtherEntry) {
      return `<button type="button" class="${fullWidth ? 'primary-btn full-width ' : ''}tfd-roster-blocked-btn" onclick="${stop}App.showToast('${alreadyJoinedToast}');return false;">參賽</button>`;
    }
    if (status !== TOURNAMENT_STATUS.REG_OPEN) return '';
    return `<button type="button" class="${fullWidth ? 'primary-btn full-width ' : ''}tfd-roster-join-btn" onclick="${stop}return App.joinFriendlyTournamentRoster('${safeTournamentId}','${safeTeamId}', this)">參賽</button>`;
  },

  _normalizeFriendlyTournamentJerseyNumber(value) {
    const safeValue = String(value || '').trim();
    if (!safeValue) return '';
    return /^\d{1,3}$/.test(safeValue) ? safeValue : null;
  },

  _formatFriendlyTournamentRosterMemberName(member) {
    const rawName = String(member?.name || member?.displayName || member?.uid || '成員').trim();
    const baseName = this._displayNameOrUidFallback?.(member?.name || member?.displayName, member?.uid, rawName || '成員') || rawName || '成員';
    const jerseyNumber = this._normalizeFriendlyTournamentJerseyNumber(member?.jerseyNumber);
    return jerseyNumber ? `${jerseyNumber}-${baseName}` : baseName;
  },

  _renderFriendlyTournamentRosterMemberChip(tournamentId, entry, member, canEditJersey) {
    const safeTournamentId = escapeHTML(String(tournamentId || '').trim());
    const safeTeamId = escapeHTML(String(entry?.teamId || entry?.id || '').trim());
    const safeUid = escapeHTML(String(member?.uid || '').trim());
    const displayName = this._formatFriendlyTournamentRosterMemberName(member);
    const editButton = canEditJersey && safeTournamentId && safeTeamId && safeUid
      ? `<button type="button" class="tfd-jersey-btn" title="登入背號" onclick="event.stopPropagation();return App.promptFriendlyTournamentMemberJersey('${safeTournamentId}','${safeTeamId}','${safeUid}', this)">背號</button>`
      : '';
    return `<span class="tfd-member-chip${editButton ? ' tfd-member-chip-editable' : ''}"><span class="tfd-member-name">${escapeHTML(displayName)}</span>${editButton}</span>`;
  },

  _getFriendlyTournamentEntryRosterCount(entry) {
    return Array.isArray(entry?.memberRoster) ? entry.memberRoster.length : 0;
  },

  _getFriendlyTournamentEntryClubMemberTotal(entry) {
    const teamId = String(entry?.teamId || entry?.id || '').trim();
    const team = teamId ? ApiService.getTeam?.(teamId) : null;
    const candidates = [
      entry?.teamMemberCount,
      entry?.clubMemberCount,
      entry?.memberCount,
      entry?.membersCount,
      team?.memberCount,
      team?.membersCount,
      team?.playerCount,
      Array.isArray(team?.members) ? team.members.length : null,
      typeof team?.members === 'number' ? team.members : null,
    ];
    const rosterCount = this._getFriendlyTournamentEntryRosterCount(entry);
    const total = candidates
      .map(value => Number(value))
      .find(value => Number.isFinite(value) && value > 0);
    return Math.max(rosterCount, Math.floor(total || rosterCount || 0));
  },

  _getFriendlyTournamentRosterSummaryText(entry) {
    const rosterCount = this._getFriendlyTournamentEntryRosterCount(entry);
    const total = this._getFriendlyTournamentEntryClubMemberTotal(entry);
    return `${rosterCount}/${total}`;
  },

  _canEditFriendlyTournamentRosterEntry(entry, viewer = ApiService.getCurrentUser?.()) {
    const teamId = String(entry?.teamId || entry?.id || '').trim();
    if (teamId && typeof this._isFriendlyTournamentViewerTeamOfficer === 'function') {
      return !!this._isFriendlyTournamentViewerTeamOfficer(teamId, viewer);
    }
    const team = teamId ? ApiService.getTeam?.(teamId) : null;
    return !!(teamId && viewer?.uid && this._isTournamentTeamOfficerForTeam?.(team, viewer));
  },

  _getFriendlyTournamentRosterListEntry(tournamentId, teamId) {
    const state = this._getFriendlyTournamentState?.(tournamentId);
    const safeTeamId = String(teamId || '').trim();
    return (state?.entries || []).find(entry =>
      String(entry?.teamId || entry?.id || '').trim() === safeTeamId
      || this._isSameFriendlyTournamentEntry?.(entry, { teamId: safeTeamId, id: safeTeamId })
    ) || null;
  },

  _getFriendlyTournamentRosterMemberInputId(memberUid, field) {
    const key = String(memberUid || '').replace(/[^a-zA-Z0-9_-]/g, '_');
    return `tfd-roster-${field}-${key}`;
  },

  _ensureFriendlyTournamentRosterListModal() {
    let overlay = document.getElementById('friendly-roster-list-overlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'friendly-roster-list-overlay';
    overlay.className = 'modal-overlay tfd-roster-list-overlay';
    overlay.innerHTML = `
      <div class="modal tfd-roster-list-modal" id="friendly-roster-list-modal">
        <div class="modal-header">
          <h3 id="friendly-roster-list-title">參賽球員名單</h3>
          <button class="modal-close" type="button" data-action="close">×</button>
        </div>
        <div class="modal-body" id="friendly-roster-list-body"></div>
        <div class="modal-actions">
          <button class="outline-btn" type="button" data-action="close">關閉</button>
        </div>
      </div>`;
    overlay.addEventListener('click', event => {
      if (event.target === overlay || event.target?.dataset?.action === 'close') {
        this.closeFriendlyTournamentRosterList();
      }
    });
    document.body.appendChild(overlay);
    return overlay;
  },

  closeFriendlyTournamentRosterList() {
    document.getElementById('friendly-roster-list-overlay')?.classList.remove('open');
    document.getElementById('friendly-roster-list-modal')?.classList.remove('open');
    document.body?.classList?.remove('modal-open');
    this._friendlyTournamentRosterListState = null;
  },

  async openFriendlyTournamentRosterList(tournamentId, teamId) {
    const safeTournamentId = String(tournamentId || '').trim();
    const safeTeamId = String(teamId || '').trim();
    if (!safeTournamentId || !safeTeamId) return false;
    try {
      const state = await (this._hydrateFriendlyTournamentRosterState?.(safeTournamentId)
        || this._loadFriendlyTournamentDetailState?.(safeTournamentId));
      const entry = (state?.entries || []).find(item =>
        String(item?.teamId || item?.id || '').trim() === safeTeamId
        || this._isSameFriendlyTournamentEntry?.(item, { teamId: safeTeamId, id: safeTeamId })
      );
      if (!entry) {
        this.showToast?.('找不到此俱樂部參賽名單');
        return false;
      }
      this._friendlyTournamentRosterListState = {
        tournamentId: safeTournamentId,
        teamId: safeTeamId,
        editingUid: null,
      };
      const overlay = this._ensureFriendlyTournamentRosterListModal();
      this._renderFriendlyTournamentRosterListModal();
      overlay.classList.add('open');
      document.getElementById('friendly-roster-list-modal')?.classList.add('open');
      document.body?.classList?.add('modal-open');
      return true;
    } catch (err) {
      this._showTournamentActionError?.('開啟參賽球員名單', err);
      return false;
    }
  },

  _renderFriendlyTournamentRosterListModal() {
    const state = this._friendlyTournamentRosterListState;
    const title = document.getElementById('friendly-roster-list-title');
    const body = document.getElementById('friendly-roster-list-body');
    if (!state || !body) return;
    const entry = this._getFriendlyTournamentRosterListEntry(state.tournamentId, state.teamId);
    if (!entry) {
      body.innerHTML = '<div class="tfd-empty-state">找不到此俱樂部參賽名單</div>';
      return;
    }
    const canEdit = this._canEditFriendlyTournamentRosterEntry(entry);
    const roster = Array.isArray(entry.memberRoster) ? entry.memberRoster : [];
    if (title) title.textContent = `${entry.teamName || '俱樂部'} 參賽球員名單`;
    const summary = this._getFriendlyTournamentRosterSummaryText(entry);
    body.innerHTML = `
      <div class="tfd-roster-list-summary">
        <div>
          <strong>${escapeHTML(entry.teamName || '俱樂部')}</strong>
          <span>參賽 / 俱樂部球員：${escapeHTML(summary)}</span>
        </div>
        <span class="tfd-roster-list-mode">${canEdit ? '可編輯' : '僅查看'}</span>
      </div>
      <div class="tfd-roster-list-table" role="table" aria-label="參賽球員名單">
        <div class="tfd-roster-list-head" role="row">
          <span>背號</span>
          <span>球員暱稱</span>
          <span>位置</span>
          <span>備註</span>
          <span>操作</span>
        </div>
        ${roster.length
          ? roster.map(member => this._renderFriendlyTournamentRosterListRow(state.tournamentId, entry, member, canEdit, state.editingUid === String(member?.uid || '').trim())).join('')
          : '<div class="tfd-roster-list-empty">尚無球員登錄參賽</div>'}
      </div>`;
  },

  _renderFriendlyTournamentRosterListRow(tournamentId, entry, member, canEdit, isEditing) {
    const safeTournamentId = escapeHTML(String(tournamentId || '').trim());
    const safeTeamId = escapeHTML(String(entry?.teamId || entry?.id || '').trim());
    const uid = String(member?.uid || '').trim();
    const safeUid = escapeHTML(uid);
    const displayName = this._displayNameOrUidFallback?.(member?.name || member?.displayName, uid, member?.name || uid || '球員') || member?.name || uid || '球員';
    const jerseyNumber = this._normalizeFriendlyTournamentJerseyNumber(member?.jerseyNumber) || '';
    const position = String(member?.position || '').trim();
    const note = String(member?.note || '').trim();
    if (isEditing && canEdit) {
      const jerseyId = this._getFriendlyTournamentRosterMemberInputId(uid, 'jersey');
      const positionId = this._getFriendlyTournamentRosterMemberInputId(uid, 'position');
      const noteId = this._getFriendlyTournamentRosterMemberInputId(uid, 'note');
      return `
        <div class="tfd-roster-list-row tfd-roster-list-row-edit" role="row">
          <label><span>背號</span><input id="${escapeHTML(jerseyId)}" type="text" inputmode="numeric" maxlength="3" value="${escapeHTML(jerseyNumber)}" placeholder="1-999"></label>
          <span class="user-capsule tfd-roster-name-pill">${escapeHTML(displayName)}</span>
          <label><span>位置</span><input id="${escapeHTML(positionId)}" type="text" maxlength="20" value="${escapeHTML(position)}" placeholder="例：前鋒"></label>
          <label><span>備註</span><input id="${escapeHTML(noteId)}" type="text" maxlength="30" value="${escapeHTML(note)}" placeholder="最多 30 字"></label>
          <div class="tfd-roster-list-actions">
            <button type="button" class="primary-btn small" onclick="return App.saveFriendlyTournamentRosterMemberProfile('${safeTournamentId}','${safeTeamId}','${safeUid}', this)">儲存</button>
            <button type="button" class="outline-btn small" onclick="App.cancelFriendlyTournamentRosterMemberEdit();return false;">取消</button>
          </div>
        </div>`;
    }
    return `
      <div class="tfd-roster-list-row" role="row">
        <div class="tfd-roster-cell">
          <span class="tfd-roster-cell-label">背號</span>
          <span class="tfd-roster-number">${escapeHTML(jerseyNumber || '-')}</span>
        </div>
        <div class="tfd-roster-cell">
          <span class="tfd-roster-cell-label">球員暱稱</span>
          <span class="user-capsule tfd-roster-name-pill">${escapeHTML(displayName)}</span>
        </div>
        <div class="tfd-roster-cell">
          <span class="tfd-roster-cell-label">位置</span>
          <span>${escapeHTML(position || '-')}</span>
        </div>
        <div class="tfd-roster-cell">
          <span class="tfd-roster-cell-label">備註</span>
          <span class="tfd-roster-note">${escapeHTML(note || '-')}</span>
        </div>
        <div class="tfd-roster-list-actions">
          ${canEdit ? `<button type="button" class="outline-btn small" onclick="App.editFriendlyTournamentRosterMember('${safeTournamentId}','${safeTeamId}','${safeUid}');return false;">編輯</button>` : ''}
          ${canEdit ? `<button type="button" class="tfd-roster-delete-btn" aria-label="刪除 ${escapeHTML(displayName)}" onclick="return App.deleteFriendlyTournamentRosterMember('${safeTournamentId}','${safeTeamId}','${safeUid}', this)">×</button>` : ''}
        </div>
      </div>`;
  },

  editFriendlyTournamentRosterMember(tournamentId, teamId, memberUid) {
    const safeTournamentId = String(tournamentId || '').trim();
    const safeTeamId = String(teamId || '').trim();
    const safeUid = String(memberUid || '').trim();
    if (!safeTournamentId || !safeTeamId || !safeUid) return false;
    this._friendlyTournamentRosterListState = {
      tournamentId: safeTournamentId,
      teamId: safeTeamId,
      editingUid: safeUid,
    };
    this._renderFriendlyTournamentRosterListModal();
    return false;
  },

  cancelFriendlyTournamentRosterMemberEdit() {
    if (!this._friendlyTournamentRosterListState) return false;
    this._friendlyTournamentRosterListState.editingUid = null;
    this._renderFriendlyTournamentRosterListModal();
    return false;
  },

  async saveFriendlyTournamentRosterMemberProfile(tournamentId, teamId, memberUid, actionButton = null) {
    const safeTournamentId = String(tournamentId || '').trim();
    const safeTeamId = String(teamId || '').trim();
    const safeUid = String(memberUid || '').trim();
    const entry = this._getFriendlyTournamentRosterListEntry(safeTournamentId, safeTeamId);
    const member = (entry?.memberRoster || []).find(item => String(item?.uid || '').trim() === safeUid);
    if (!entry || !member || !this._canEditFriendlyTournamentRosterEntry(entry)) {
      this.showToast?.('只有該俱樂部職員可以編輯參賽球員');
      return false;
    }
    const jerseyId = this._getFriendlyTournamentRosterMemberInputId(safeUid, 'jersey');
    const positionId = this._getFriendlyTournamentRosterMemberInputId(safeUid, 'position');
    const noteId = this._getFriendlyTournamentRosterMemberInputId(safeUid, 'note');
    const jerseyNumber = this._normalizeFriendlyTournamentJerseyNumber(document.getElementById(jerseyId)?.value);
    if (jerseyNumber === null) {
      this.showToast?.('背號只能輸入 1-3 位數字');
      return false;
    }
    const profile = {
      jerseyNumber,
      position: String(document.getElementById(positionId)?.value || '').trim().slice(0, 20),
      note: String(document.getElementById(noteId)?.value || '').trim().slice(0, 30),
    };
    const save = async () => {
      await ApiService.updateTournamentEntryMemberProfile(safeTournamentId, safeTeamId, safeUid, profile);
      await this._hydrateFriendlyTournamentRosterState?.(safeTournamentId);
      this._friendlyTournamentRosterListState = { tournamentId: safeTournamentId, teamId: safeTeamId, editingUid: null };
      this._renderFriendlyTournamentRosterListModal();
      this._refreshFriendlyTournamentRosterUi?.(safeTournamentId);
      this.showToast?.('球員資料已更新');
    };
    try {
      if (typeof this._withButtonLoading === 'function') {
        await this._withButtonLoading(actionButton, '儲存中...', save);
      } else {
        await save();
      }
      return true;
    } catch (err) {
      this._showTournamentActionError?.('更新參賽球員', err);
      return false;
    }
  },

  async deleteFriendlyTournamentRosterMember(tournamentId, teamId, memberUid, actionButton = null) {
    const safeTournamentId = String(tournamentId || '').trim();
    const safeTeamId = String(teamId || '').trim();
    const safeUid = String(memberUid || '').trim();
    const entry = this._getFriendlyTournamentRosterListEntry(safeTournamentId, safeTeamId);
    const member = (entry?.memberRoster || []).find(item => String(item?.uid || '').trim() === safeUid);
    if (!entry || !member || !this._canEditFriendlyTournamentRosterEntry(entry)) {
      this.showToast?.('只有該俱樂部職員可以刪除參賽球員');
      return false;
    }
    const displayName = this._displayNameOrUidFallback?.(member?.name || member?.displayName, safeUid, member?.name || safeUid) || member?.name || safeUid;
    if (!(await this.appConfirm?.(`確定刪除 ${displayName} 的參賽資格？確認後無法還原，需要球員重新申請參賽。`))) return false;
    const remove = async () => {
      await ApiService.removeTournamentEntryMember(safeTournamentId, safeTeamId, safeUid);
      await this._hydrateFriendlyTournamentRosterState?.(safeTournamentId);
      this._friendlyTournamentRosterListState = { tournamentId: safeTournamentId, teamId: safeTeamId, editingUid: null };
      this._renderFriendlyTournamentRosterListModal();
      this._refreshFriendlyTournamentRosterUi?.(safeTournamentId);
      this.showToast?.('已刪除參賽球員');
    };
    try {
      if (typeof this._withButtonLoading === 'function') {
        await this._withButtonLoading(actionButton, '刪除中...', remove);
      } else {
        await remove();
      }
      return true;
    } catch (err) {
      this._showTournamentActionError?.('刪除參賽球員', err);
      return false;
    }
  },

  async promptFriendlyTournamentMemberJersey(tournamentId, teamId, memberUid, actionButton = null) {
    const safeTournamentId = String(tournamentId || '').trim();
    const safeTeamId = String(teamId || '').trim();
    const safeUid = String(memberUid || '').trim();
    const viewer = ApiService.getCurrentUser?.();
    if (!safeTournamentId || !safeTeamId || !safeUid || !viewer?.uid) {
      this.showToast('無法更新背號');
      return false;
    }

    try {
      const state = await (this._hydrateFriendlyTournamentRosterState?.(safeTournamentId)
        || this._loadFriendlyTournamentDetailState?.(safeTournamentId));
      const entry = (state?.entries || []).find(item =>
        String(item?.teamId || item?.id || '').trim() === safeTeamId
        || this._isSameFriendlyTournamentEntry?.(item, { teamId: safeTeamId, id: safeTeamId })
      );
      const team = ApiService.getTeam?.(safeTeamId);
      if (!entry || !this._isTournamentTeamOfficerForTeam?.(team, viewer)) {
        this.showToast('只有該俱樂部職員可以登入背號');
        return false;
      }
      const member = (entry.memberRoster || []).find(item => String(item?.uid || '').trim() === safeUid);
      if (!member) {
        this.showToast('找不到球員名單');
        return false;
      }
      const currentNumber = this._normalizeFriendlyTournamentJerseyNumber(member.jerseyNumber) || '';
      const promptFn = (typeof window !== 'undefined' && typeof window.prompt === 'function')
        ? window.prompt.bind(window)
        : (typeof prompt === 'function' ? prompt : null);
      if (!promptFn) {
        this.showToast('目前無法開啟背號輸入');
        return false;
      }
      const input = promptFn('輸入球員背號（1-3 位數字；留空可清除）', currentNumber);
      if (input === null) return false;
      const jerseyNumber = this._normalizeFriendlyTournamentJerseyNumber(input);
      if (jerseyNumber === null) {
        this.showToast('背號只能輸入 1-3 位數字');
        return false;
      }
      const save = async () => {
        await ApiService.updateTournamentEntryMemberJersey(safeTournamentId, safeTeamId, safeUid, jerseyNumber);
        await this._hydrateFriendlyTournamentRosterState?.(safeTournamentId);
        this._refreshFriendlyTournamentRosterUi?.(safeTournamentId);
        this.showToast(jerseyNumber ? '背號已更新' : '背號已清除');
      };
      if (typeof this._withButtonLoading === 'function') {
        await this._withButtonLoading(actionButton, '儲存中...', save);
      } else {
        await save();
      }
      return true;
    } catch (err) {
      this._showTournamentActionError?.('更新背號', err);
      return false;
    }
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
    const applyButtonHtml = `
      <div class="signup-glow-wrap tfd-apply-glow-wrap" style="--glow-c:var(--accent);--glow-c-light:var(--accent-hover)">
        <div class="signup-glow-border"></div>
        <div class="signup-glow-shadow"></div>
        <div class="signup-flipper">
          <button class="primary-btn full-width" onclick="return App.registerTournament('${escapeHTML(tournament.id)}', this)">參加賽事</button>
        </div>
        <div class="signup-loading-hint"><div class="mini-spinner"></div><span class="mini-text">報名中</span></div>
      </div>`;
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
    } else if (selectedTeam?.status === 'sport-mismatch') {
      primaryHtml = `${selector}<button class="primary-btn full-width" disabled>非本類賽事運動</button>`;
    } else if (status === TOURNAMENT_STATUS.PREPARING) {
      primaryHtml = `${selector}<button class="primary-btn full-width" disabled>報名尚未開始</button>`;
    } else if (status === TOURNAMENT_STATUS.REG_CLOSED || isEnded) {
      primaryHtml = `${selector}<button class="primary-btn full-width" disabled>報名已截止</button>`;
    } else if (approvedCount >= teamLimit) {
      primaryHtml = `${selector}<button class="primary-btn full-width" disabled>隊伍名額已滿</button>`;
    } else if (selectedTeam?.status === 'available') {
      primaryHtml = `${selector}${applyButtonHtml}`;
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

  _getFriendlyTournamentScheduleDateParts(value) {
    if (!value) return { date: '時間待定', time: '待定', weekday: '', sortKey: Number.POSITIVE_INFINITY, groupKey: 'unscheduled' };
    let millis = Number.NaN;
    if (typeof value?.toMillis === 'function') millis = value.toMillis();
    else if (typeof value?.toDate === 'function') millis = value.toDate().getTime();
    else if (typeof this._getTournamentDateTimeMillis === 'function') millis = this._getTournamentDateTimeMillis(value);
    if (!Number.isFinite(millis)) millis = new Date(value).getTime();
    if (!Number.isFinite(millis)) {
      const text = String(value || '').trim();
      return { date: text || '時間待定', time: '待定', weekday: '', sortKey: Number.POSITIVE_INFINITY, groupKey: text || 'unscheduled' };
    }
    const dt = new Date(millis);
    const pad = n => String(n).padStart(2, '0');
    const weekday = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'][dt.getDay()] || '';
    const date = `${dt.getFullYear()}/${pad(dt.getMonth() + 1)}/${pad(dt.getDate())}`;
    return {
      date,
      time: `${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
      weekday,
      sortKey: millis,
      groupKey: date,
    };
  },

  _sortFriendlyTournamentScheduleMatches(matches = []) {
    return (Array.isArray(matches) ? matches : [])
      .slice()
      .sort((a, b) => {
        const timeA = this._getFriendlyTournamentScheduleDateParts(a?.scheduledAt).sortKey;
        const timeB = this._getFriendlyTournamentScheduleDateParts(b?.scheduledAt).sortKey;
        return timeA - timeB
          || Number(a?.round || 0) - Number(b?.round || 0)
          || Number(a?.slot || 0) - Number(b?.slot || 0)
          || Number(a?.matchNo || 0) - Number(b?.matchNo || 0);
      });
  },

  _getFriendlyTournamentScheduleStatusMeta(match = {}) {
    const status = String(match.status || 'scheduled').trim();
    if (status === 'finished') return { key: 'finished', label: '已完賽', center: 'FT' };
    if (status === 'walkover') return { key: 'walkover', label: '判定勝', center: 'WO' };
    if (status === 'bye') return { key: 'bye', label: '輪空', center: 'BYE' };
    const hasLiveData = (Array.isArray(match.events) && match.events.length > 0)
      || match.scoreHome !== null || match.scoreAway !== null;
    return hasLiveData
      ? { key: 'live', label: '進行中', center: 'LIVE' }
      : { key: 'scheduled', label: '未開賽', center: '' };
  },

  _renderFriendlyTournamentScheduleTeam(team = {}, side = 'home', logoById = {}) {
    const teamId = String(team.teamId || '').trim();
    const label = String(team.label || teamId || '待定球隊').trim();
    const logo = logoById[teamId] || '';
    const initial = label.slice(0, 1) || '?';
    return `
      <div class="tfg-team tfg-team-${escapeHTML(side)}">
        <span class="tfg-team-logo">${logo ? `<img src="${escapeHTML(logo)}" alt="${escapeHTML(label)}">` : `<b>${escapeHTML(initial)}</b>`}</span>
        <span class="tfg-team-name" title="${escapeHTML(label)}">${escapeHTML(label)}</span>
      </div>`;
  },

  _renderFriendlyTournamentScheduleLiveSlot(match = {}) {
    const liveUrl = String(match.liveUrl || match.streamUrl || '').trim();
    const hasLive = !!liveUrl;
    const liveLabel = hasLive ? '直播連結已設定' : '直播尚未提供';
    return `
      <div class="tfg-live-slot ${hasLive ? 'has-live' : 'is-empty'}" data-live-state="${hasLive ? 'ready' : 'empty'}" data-live-url="${escapeHTML(liveUrl)}" aria-label="${escapeHTML(liveLabel)}">
        <div class="tfg-live-stage">
          <span class="tfg-live-pill">LIVE</span>
          <span class="tfg-live-label">${escapeHTML(liveLabel)}</span>
        </div>
      </div>`;
  },
  _renderFriendlyTournamentScheduleMatchCard(tournament, match, context = {}) {
    const matchesBySlot = context.matchesBySlot || {};
    const nameById = context.nameById || {};
    const logoById = context.logoById || {};
    const viewer = context.viewer || ApiService.getCurrentUser?.();
    const modeLabel = context.modeLabel || this._getTournamentModeLabel?.(tournament) || '友誼賽';
    const home = this._renderTournamentMatchSideLabel(match, 'home', matchesBySlot, nameById);
    const away = this._renderTournamentMatchSideLabel(match, 'away', matchesBySlot, nameById);
    const dateParts = this._getFriendlyTournamentScheduleDateParts(match.scheduledAt);
    const statusMeta = this._getFriendlyTournamentScheduleStatusMeta(match);
    const hasScore = match.scoreHome !== null && match.scoreAway !== null;
    const scoreHtml = hasScore
      ? `<span class="tfg-score"><b>${escapeHTML(String(match.scoreHome))}</b><span>-</span><b>${escapeHTML(String(match.scoreAway))}</b></span>`
      : `<span class="tfg-time">${escapeHTML(dateParts.time)}</span>`;
    const roundLabel = this._getTournamentRoundLabel?.(match) || (match.round ? `第 ${match.round} 輪` : modeLabel);
    const refereeNames = (match.referees || [])
      .map(ref => String(ref?.name || '').trim())
      .filter(Boolean)
      .join('、');
    const metaItems = [roundLabel, match.venue || '', refereeNames ? `裁判 ${refereeNames}` : '']
      .map(item => String(item || '').trim())
      .filter(Boolean);
    const canRecord = !!(this._canRecordTournamentMatch?.(tournament, match, viewer) && match.status !== 'bye');
    const manageHtml = canRecord
      ? `<button type="button" class="tfg-record-btn" onclick="event.stopPropagation();return App.openTournamentMatchRecordModal('${escapeHTML(tournament.id)}','${escapeHTML(match.id)}')">更新賽況</button>`
      : '';
    return `
      <article class="tfg-match-card tfg-match-${escapeHTML(statusMeta.key)}" role="button" tabindex="0" onclick="App.openTournamentMatchDetailModal('${escapeHTML(tournament.id)}','${escapeHTML(match.id)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();App.openTournamentMatchDetailModal('${escapeHTML(tournament.id)}','${escapeHTML(match.id)}');}">
        <div class="tfg-match-main">
          ${this._renderFriendlyTournamentScheduleTeam(home, 'home', logoById)}
          <div class="tfg-center">
            ${scoreHtml}
            <span class="tfg-status">${escapeHTML(statusMeta.label)}</span>
          </div>
          ${this._renderFriendlyTournamentScheduleTeam(away, 'away', logoById)}
        </div>
        <div class="tfg-match-meta">
          <span>${escapeHTML(metaItems.join(' · ') || '場次資訊待補')}</span>
          ${manageHtml}
        </div>
        ${this._renderFriendlyTournamentScheduleLiveSlot(match)}
      </article>`;
  },

  _renderFriendlyTournamentScheduleHtml(state) {
    const tournament = state?.tournament;
    if (!tournament) return '<div class="tfg-empty">找不到賽事資料</div>';
    const modeLabel = this._getTournamentModeLabel?.(tournament) || (this._getTournamentMode?.(tournament) === 'single' ? '單賽制' : '友誼賽');
    const scheduleTitle = `${modeLabel}賽程`;
    const matches = this._sortFriendlyTournamentScheduleMatches(state.matches || []);
    const viewer = ApiService.getCurrentUser?.();
    const canManage = !!(this._isTournamentGlobalAdmin?.(viewer) || this._canManageTournamentRecord?.(tournament, viewer));
    const finishedCount = matches.filter(match => match.status === 'finished' || match.status === 'walkover').length;
    const safeTournamentId = escapeHTML(tournament.id);
    const manageButton = canManage
      ? `<button type="button" class="tfg-manage-btn" onclick="return App.openTournamentScheduleManager('${safeTournamentId}')">賽程管理</button>`
      : '';
    if (!matches.length) {
      return `
        <section class="tfg-schedule">
          <div class="tfg-head">
            <div><span>Matches</span><strong>${escapeHTML(scheduleTitle)}</strong></div>
            ${manageButton}
          </div>
          <div class="tfg-empty">
            <strong>尚未產生賽程</strong>
            <span>可依已核准俱樂部與賽事日期隨機產生對戰，產生後再手動微調時間、場地與裁判。</span>
          </div>
        </section>`;
    }
    const matchesBySlot = this._buildTournamentMatchesBySlot(matches);
    const nameById = this._getTournamentTeamNameMap(state);
    const logoById = this._getTournamentTeamLogoMap?.(state) || {};
    const context = { matchesBySlot, nameById, logoById, viewer, modeLabel };
    const groups = new Map();
    matches.forEach(match => {
      const parts = this._getFriendlyTournamentScheduleDateParts(match.scheduledAt);
      const key = parts.groupKey || 'unscheduled';
      if (!groups.has(key)) groups.set(key, { parts, items: [] });
      groups.get(key).items.push(match);
    });
    const groupHtml = [...groups.values()].map(group => `
      <section class="tfg-date-group">
        <div class="tfg-date-row">
          <strong>${escapeHTML(group.parts.date)}</strong>
          ${group.parts.weekday ? `<span>${escapeHTML(group.parts.weekday)}</span>` : ''}
        </div>
        <div class="tfg-match-list">
          ${group.items.map(match => this._renderFriendlyTournamentScheduleMatchCard(tournament, match, context)).join('')}
        </div>
      </section>`).join('');
    return `
      <section class="tfg-schedule">
        <div class="tfg-head">
          <div><span>Matches</span><strong>${escapeHTML(scheduleTitle)}</strong></div>
          <div class="tfg-head-actions">
            <span>${escapeHTML(String(finishedCount))}/${escapeHTML(String(matches.length))} 已完成</span>
            ${manageButton}
          </div>
        </div>
        ${groupHtml}
      </section>`;
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
    const status = this.getTournamentStatus?.(tournament);
    const isRosterHydrated = state?.rosterHydrated !== false;
    const rosterMembership = isRosterHydrated
      ? this._getFriendlyTournamentRosterMembershipForUser(state, viewer)
      : { primary: null, list: [] };

    const entryRows = approvedEntries.map(entry => {
      const teamName = entry.teamName || '未命名俱樂部';
      const isViewerTeamOfficer = this._isFriendlyTournamentViewerTeamOfficer?.(entry.teamId, viewer);
      const rosterSummary = isRosterHydrated ? this._getFriendlyTournamentRosterSummaryText(entry) : '-';
      const rosterTeamId = String(entry.teamId || entry.id || '').trim();
      const rosterListButton = isRosterHydrated
        ? `<button type="button" class="tfd-roster-list-btn" onclick="event.stopPropagation();return App.openFriendlyTournamentRosterList('${escapeHTML(tournament.id)}','${escapeHTML(rosterTeamId)}')">${isViewerTeamOfficer ? '管理名單' : '球員名單'}</button>`
        : '<button type="button" class="tfd-roster-loading-btn" disabled>載入中</button>';
      const roster = `
        <div class="tfd-roster-summary">
          <span>球員 ${escapeHTML(rosterSummary)}</span>
          ${rosterListButton}
        </div>`;
      const rosterAction = this._isFriendlyTournamentViewerOnEntryTeam(entry, viewer)
        ? (isRosterHydrated
          ? this._buildFriendlyTournamentRosterActionButton(tournament.id, entry, rosterMembership, status, { stopPropagation: true })
          : '<button type="button" class="tfd-roster-loading-btn" disabled>載入中</button>')
        : '';
      const managementAction = canManage && entry.entryStatus !== 'host'
        ? `<button type="button" class="tfd-entry-remove-btn" onclick="event.stopPropagation();return App.removeFriendlyTournamentEntry('${escapeHTML(tournament.id)}','${escapeHTML(entry.teamId)}', this)">剔除</button>`
        : (!canManage && isViewerTeamOfficer && entry.entryStatus !== 'host'
          ? `<button type="button" class="tfd-entry-withdraw-btn" onclick="event.stopPropagation();return App.withdrawFriendlyTournamentTeam('${escapeHTML(tournament.id)}','${escapeHTML(entry.teamId)}', this)">退出賽事</button>`
          : '');
      const rowActions = [rosterAction, managementAction].filter(Boolean).join('');
      return `
        <div class="tfd-team-row">
          <div class="tfd-team-side">
            <div class="tfd-team-thumb">${entry.teamImage ? `<img src="${entry.teamImage}" alt="${escapeHTML(teamName)}">` : `<span>${escapeHTML((teamName || '?').slice(0, 1))}</span>`}</div>
            <div class="tfd-team-meta">
              <div class="tfd-team-name" title="${escapeHTML(teamName)}">${escapeHTML(teamName)}</div>
              <div class="tfd-team-status">${entry.entryStatus === 'host' ? (this._friendlyTournamentEntryCountsTowardLimit?.(entry, tournament) ? '主辦俱樂部・參賽' : '主辦俱樂部・未參賽') : '已核准參賽'}</div>
            </div>
          </div>
          <div class="tfd-team-footer">
            <div class="tfd-team-roster">${roster}</div>
            ${rowActions ? `<div class="tfd-team-action${rowActions.includes('</button><button') ? ' tfd-team-action-multi' : ''}">${rowActions}</div>` : ''}
          </div>
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
            <div class="tfd-team-status">保留${escapeHTML(this._getTournamentModeLabel?.(tournament) || '友誼賽')}名額</div>
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
    if (!tournament || !this._isFriendlyTournamentRecord?.(tournament) || !['teams', 'schedule'].includes(tab)) {
      return _tournamentFriendlyDetailViewLegacy.renderTournamentTab.call(this, tab);
    }
    const container = document.getElementById('tournament-content');
    if (!container) return;
    const state = this._getFriendlyTournamentState(tournament.id) || { tournament, applications: [], entries: tournament.teamEntries || [], matches: [] };
    if (tab === 'schedule') {
      container.innerHTML = this._renderFriendlyTournamentScheduleHtml(state);
      return;
    }
    container.innerHTML = this._renderFriendlyTournamentTeamsTab(state);
    this._ensureFriendlyTournamentRosterHydratedForRender?.(tournament.id);
  },

  // shareTournament 已移至 js/modules/tournament-share.js（LIFF Flex Message 版）
});
