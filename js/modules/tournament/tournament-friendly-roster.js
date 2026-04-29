/* ================================================
   SportHub Tournament Friendly Roster
   Friendly-only roster join/leave flow with
   multi-team selection modal.
   ================================================ */

const _tournamentFriendlyRosterLegacy = {
  showTournamentDetail: App.showTournamentDetail,
  renderRegisterButton: App.renderRegisterButton,
};

Object.assign(App, {

  _friendlyTournamentRosterPickerState: null,

  _getFriendlyTournamentRosterMembership(state, user = ApiService.getCurrentUser?.()) {
    const uid = String(user?.uid || '').trim();
    const memberships = uid
      ? (state?.entries || []).reduce((list, entry) => {
          const hit = (entry.memberRoster || []).some(member => member.uid === uid);
          if (hit) list.push(entry);
          return list;
        }, [])
      : [];
    return { primary: memberships[0] || null, list: memberships };
  },

  _isFriendlyTournamentResponsibleMember(team, user = ApiService.getCurrentUser?.()) {
    return !!(team && user && (
      this._isTournamentCaptainForTeam?.(team, user)
      || this._isTournamentLeaderForTeam?.(team, user)
    ));
  },

  _isFriendlyTournamentRosterUnlocked(entry, team = ApiService.getTeam?.(entry?.teamId)) {
    if (!entry || !team) return false;
    const responsibleUids = new Set();
    if (team.captainUid) responsibleUids.add(String(team.captainUid).trim());
    const leaderUids = Array.isArray(team.leaderUids)
      ? team.leaderUids
      : (team.leaderUid ? [team.leaderUid] : []);
    leaderUids.forEach(uid => {
      const safeUid = String(uid || '').trim();
      if (safeUid) responsibleUids.add(safeUid);
    });
    const coachUids = Array.isArray(team.coachUids) ? team.coachUids : [];
    coachUids.forEach(uid => {
      const safeUid = String(uid || '').trim();
      if (safeUid) responsibleUids.add(safeUid);
    });

    return (entry.memberRoster || []).some(member => {
      const uid = String(member?.uid || '').trim();
      return responsibleUids.has(uid);
    });
  },

  _getFriendlyTournamentApprovedUserEntries(state, user = ApiService.getCurrentUser?.()) {
    const teamIds = typeof this._getFriendlyTournamentUserActionTeamIds === 'function'
      ? this._getFriendlyTournamentUserActionTeamIds(user)
      : (typeof this._getUserTeamIds === 'function' ? this._getUserTeamIds(user) : []);
    return (state?.entries || []).filter(entry =>
      (entry.entryStatus === 'host' || entry.entryStatus === 'approved')
      && teamIds.includes(entry.teamId)
    );
  },

  _getFriendlyTournamentJoinableEntries(state, user = ApiService.getCurrentUser?.()) {
    return this._getFriendlyTournamentApprovedUserEntries(state, user).filter(entry => {
      const team = ApiService.getTeam?.(entry.teamId);
      return this._isFriendlyTournamentResponsibleMember(team, user)
        || this._isFriendlyTournamentRosterUnlocked(entry, team);
    });
  },

  async _hydrateFriendlyTournamentRosterState(tournamentId) {
    const state = this._getFriendlyTournamentState?.(tournamentId) || await this._loadFriendlyTournamentDetailState?.(tournamentId);
    const tournament = state?.tournament;
    if (!tournament || !this._isFriendlyTournamentRecord?.(tournament)) return state || null;

    const entries = await Promise.all((state.entries || []).map(async entry => {
      if (!entry.teamId || (entry.entryStatus !== 'host' && entry.entryStatus !== 'approved')) {
        return this._buildFriendlyTournamentEntryRecord(entry);
      }
      const fallbackMembers = Array.isArray(entry.memberRoster) ? entry.memberRoster : [];
      const rawMembers = await ApiService.listTournamentEntryMembers(tournamentId, entry.teamId).catch(() => fallbackMembers);
      const _seenUids = new Set();
      const memberRoster = (Array.isArray(rawMembers) ? rawMembers : fallbackMembers)
        .map(member => this._buildFriendlyTournamentRosterMemberRecord(member))
        .filter(member => {
          if (!member.uid || _seenUids.has(member.uid)) return false;
          _seenUids.add(member.uid);
          return true;
        })
        .sort((a, b) => String(a.joinedAt || '').localeCompare(String(b.joinedAt || '')));
      return this._buildFriendlyTournamentEntryRecord({ ...entry, memberRoster });
    }));

    const nextState = {
      ...state,
      entries,
      tournament: this._buildFriendlyTournamentRecord({ ...tournament }),
    };
    if (typeof this._syncFriendlyTournamentCacheRecord === 'function') {
      this._syncFriendlyTournamentCacheRecord(tournamentId, nextState.applications || [], entries);
    }
    this._friendlyTournamentDetailStateById[tournamentId] = nextState;
    return nextState;
  },

  _getFriendlyTournamentActiveTab() {
    return document.querySelector('#td-tabs .tab.active')?.dataset?.ttab || 'info';
  },

  _refreshFriendlyTournamentRosterUi(tournamentId = this.currentTournament) {
    const safeTournamentId = String(tournamentId || '').trim();
    if (!safeTournamentId || this.currentPage !== 'page-tournament-detail' || String(this.currentTournament || '') !== safeTournamentId) return;
    const state = this._getFriendlyTournamentState?.(safeTournamentId);
    const tournament = state?.tournament || ApiService.getFriendlyTournamentRecord?.(safeTournamentId) || ApiService.getTournament?.(safeTournamentId);
    if (!tournament || !this._isFriendlyTournamentRecord?.(tournament)) return;
    this.renderRegisterButton(tournament);
    if (this._getFriendlyTournamentActiveTab() === 'teams') this.renderTournamentTab('teams');
  },

  _ensureFriendlyTournamentRosterPickerModal() {
    let overlay = document.getElementById('friendly-roster-picker-overlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'friendly-roster-picker-overlay';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal tfd-picker-modal" id="friendly-roster-picker-modal">
        <div class="modal-header">
          <h3>選擇參賽俱樂部</h3>
          <button class="modal-close" type="button" data-action="close">✕</button>
        </div>
        <div class="modal-body">
          <div class="tfd-picker-meta" id="friendly-roster-picker-meta">請選擇要代表出賽的俱樂部。</div>
          <div class="tfd-picker-list" id="friendly-roster-picker-list"></div>
        </div>
        <div class="modal-actions">
          <button class="outline-btn" type="button" data-action="close">取消</button>
        </div>
      </div>`;
    overlay.addEventListener('click', event => {
      if (event.target === overlay || event.target?.dataset?.action === 'close') {
        this.closeFriendlyTournamentRosterPicker();
      }
    });
    overlay.querySelector('#friendly-roster-picker-list')?.addEventListener('click', event => {
      const button = event.target.closest('[data-team-id]');
      if (button?.dataset?.teamId) this.selectFriendlyTournamentRosterTeam(button.dataset.teamId);
    });
    document.body.appendChild(overlay);
    return overlay;
  },

  closeFriendlyTournamentRosterPicker() {
    const overlay = document.getElementById('friendly-roster-picker-overlay');
    const modal = document.getElementById('friendly-roster-picker-modal');
    overlay?.classList.remove('open');
    modal?.classList.remove('open');
    this._friendlyTournamentRosterPickerState = null;
  },

  async openFriendlyTournamentRosterPicker(tournamentId) {
    try {
      const state = await this._hydrateFriendlyTournamentRosterState(tournamentId);
    const tournament = state?.tournament;
    if (!tournament || !this._isFriendlyTournamentRecord?.(tournament)) return;
    if (this.getTournamentStatus(tournament) !== TOURNAMENT_STATUS.REG_OPEN) {
      this.showToast('目前尚未開放球員名單報名。');
      return;
    }

    const membership = this._getFriendlyTournamentRosterMembership(state);
    if (membership.primary) {
      this.showToast(`你已以「${membership.primary.teamName}」身分參賽。`);
      return;
    }

    const joinableEntries = this._getFriendlyTournamentJoinableEntries(state);
    if (joinableEntries.length === 0) {
      this.showToast('需俱樂部負責人先行報名參賽並經主辦核准後，才可加入名單。');
      return;
    }
    if (joinableEntries.length === 1) {
      await this.joinFriendlyTournamentRoster(tournamentId, joinableEntries[0].teamId);
      return;
    }

    const overlay = this._ensureFriendlyTournamentRosterPickerModal();
    const modal = document.getElementById('friendly-roster-picker-modal');
    const meta = document.getElementById('friendly-roster-picker-meta');
    const list = document.getElementById('friendly-roster-picker-list');
    this._friendlyTournamentRosterPickerState = { tournamentId: String(tournamentId || '').trim() };
    if (meta) meta.textContent = `你目前可代表 ${joinableEntries.length} 支已核准俱樂部參賽，請選擇身份。`;
    if (list) {
      list.innerHTML = joinableEntries.map(entry => `
        <button class="tfd-picker-option" type="button" data-team-id="${escapeHTML(entry.teamId)}">
          <span class="tfd-picker-title">${escapeHTML(entry.teamName || '未命名俱樂部')}</span>
          <span class="tfd-picker-sub">${entry.entryStatus === 'host' ? '主辦俱樂部名單' : '已核准參賽隊伍'}</span>
        </button>`).join('');
    }
      overlay.classList.add('open');
      modal?.classList.add('open');
    } catch (err) {
      this._showTournamentActionError?.('載入球員名單', err);
    }
  },

  async selectFriendlyTournamentRosterTeam(teamId) {
    const tournamentId = this._friendlyTournamentRosterPickerState?.tournamentId;
    if (!tournamentId) return;
    await this.joinFriendlyTournamentRoster(tournamentId, teamId);
  },

  async joinFriendlyTournamentRoster(tournamentId, explicitTeamId = '') {
    const user = ApiService.getCurrentUser?.();
    if (!user?.uid) {
      this.showToast('請先登入');
      return;
    }

    try {
      let state = await this._hydrateFriendlyTournamentRosterState(tournamentId);
    const tournament = state?.tournament;
    if (!tournament || !this._isFriendlyTournamentRecord?.(tournament)) return;
    if (this.getTournamentStatus(tournament) !== TOURNAMENT_STATUS.REG_OPEN) {
      this.showToast('目前尚未開放球員名單報名。');
      return;
    }

    const membership = this._getFriendlyTournamentRosterMembership(state, user);
    if (membership.primary) {
      const message = explicitTeamId && membership.primary.teamId !== explicitTeamId
        ? '如需改以其他俱樂部身份參賽，請先取消目前的參賽名單。'
        : `你已以「${membership.primary.teamName}」身分參賽。`;
      this.showToast(message);
      return;
    }

    const joinableEntries = this._getFriendlyTournamentJoinableEntries(state, user);
    const selectedEntry = joinableEntries.find(entry => entry.teamId === String(explicitTeamId || '').trim()) || joinableEntries[0];
    if (!selectedEntry) {
      this.showToast('目前沒有可加入的俱樂部名單。');
      return;
    }

    await ApiService.joinFriendlyTournamentRosterAtomic(tournamentId, selectedEntry.teamId);

      this.closeFriendlyTournamentRosterPicker();
      state = await this._hydrateFriendlyTournamentRosterState(tournamentId);
      this._refreshFriendlyTournamentRosterUi(tournamentId);
    this.showToast(`已加入「${selectedEntry.teamName}」球員名單。`);
    return state;
    } catch (err) {
      this._showTournamentActionError?.('加入球員名單', err);
    }
  },

  async cancelFriendlyTournamentRoster(tournamentId) {
    const user = ApiService.getCurrentUser?.();
    if (!user?.uid) {
      this.showToast('請先登入');
      return;
    }

    try {
      let state = await this._hydrateFriendlyTournamentRosterState(tournamentId);
    const memberships = this._getFriendlyTournamentRosterMembership(state, user).list;
    if (memberships.length === 0) {
      this.showToast('你目前尚未加入任何參賽名單。');
      return;
    }

    const confirmText = memberships.length === 1
      ? `確定取消「${memberships[0].teamName}」的參賽名單？`
      : '偵測到你同時存在多支俱樂部名單，確定要全部取消後重新選擇嗎？';
    if (!(await this.appConfirm(confirmText))) return;

    await ApiService.leaveFriendlyTournamentRosterAtomic(tournamentId);

      this.closeFriendlyTournamentRosterPicker();
      state = await this._hydrateFriendlyTournamentRosterState(tournamentId);
      this._refreshFriendlyTournamentRosterUi(tournamentId);
    this.showToast(memberships.length === 1 ? '已取消參賽。' : '已清除目前參賽身份，可重新選擇俱樂部。');
    return state;
    } catch (err) {
      this._showTournamentActionError?.('取消參賽', err);
    }
  },

  async showTournamentDetail(id, options) {
    await _tournamentFriendlyRosterLegacy.showTournamentDetail.call(this, id, options);
    const tournament = this._getFriendlyTournamentState?.(id)?.tournament
      || ApiService.getFriendlyTournamentRecord?.(id)
      || ApiService.getTournament?.(id);
    const safeTournamentId = String(id || '').trim();
    if (!tournament || !this._isFriendlyTournamentRecord?.(tournament)) return;
    if (this.currentPage !== 'page-tournament-detail' || String(this.currentTournament || '') !== safeTournamentId) return;
    await this._hydrateFriendlyTournamentRosterState(safeTournamentId);
    this._refreshFriendlyTournamentRosterUi(safeTournamentId);
  },

  renderRegisterButton(tournament) {
    _tournamentFriendlyRosterLegacy.renderRegisterButton.call(this, tournament);
    if (!this._isFriendlyTournamentRecord?.(tournament)) return;

    const area = document.getElementById('td-register-area');
    const card = area?.querySelector('.tfd-action-card');
    const actionMain = area?.querySelector('.tfd-action-main');
    if (!card || !actionMain) return;
    const applicationActionStatus = String(actionMain.dataset?.friendlyTeamActionStatus || card.dataset?.friendlyTeamActionStatus || '').trim();
    if (['pending', 'approved', 'rejected'].includes(applicationActionStatus)) return;

    const state = this._getFriendlyTournamentState?.(tournament.id) || { tournament, entries: tournament.teamEntries || [] };
    const status = this.getTournamentStatus(tournament);
    const membership = this._getFriendlyTournamentRosterMembership(state);
    const approvedEntries = this._getFriendlyTournamentApprovedUserEntries(state);
    const joinableEntries = this._getFriendlyTournamentJoinableEntries(state);

    let buttonHtml = '';
    let noteText = '';
    if (membership.primary) {
      buttonHtml = status === TOURNAMENT_STATUS.REG_OPEN
        ? `<button class="primary-btn full-width" onclick="App.cancelFriendlyTournamentRoster('${tournament.id}')">取消參賽</button>`
        : `<button class="primary-btn full-width" disabled>已列入球員名單</button>`;
      noteText = `目前以「${membership.primary.teamName}」身分參賽${status === TOURNAMENT_STATUS.REG_OPEN ? '，可取消後重新選擇俱樂部。' : '。'}`;
    } else if (status === TOURNAMENT_STATUS.REG_OPEN && joinableEntries.length === 1) {
      buttonHtml = `<button class="primary-btn full-width" onclick="App.joinFriendlyTournamentRoster('${tournament.id}','${joinableEntries[0].teamId}')">加入球員名單</button>`;
      noteText = `你的俱樂部「${joinableEntries[0].teamName}」已通過審核，現在可加入參賽名單。`;
    } else if (status === TOURNAMENT_STATUS.REG_OPEN && joinableEntries.length > 1) {
      buttonHtml = `<button class="primary-btn full-width" onclick="App.openFriendlyTournamentRosterPicker('${tournament.id}')">選擇俱樂部參賽</button>`;
      noteText = `你所屬的 ${joinableEntries.length} 支已核准俱樂部都可參賽，請先選擇代表俱樂部。`;
    } else if (status === TOURNAMENT_STATUS.REG_OPEN && approvedEntries.length > 0) {
      buttonHtml = `<button class="primary-btn full-width" style="opacity:.6" onclick="App.showToast('需俱樂部負責人先行報名參賽並經主辦核准後，才可加入名單。')">等待負責人先加入</button>`;
      noteText = '你的俱樂部已通過審核，但需先由該隊領隊或經理加入球員名單後，其他隊員才可加入。';
    } else {
      return;
    }

    actionMain.innerHTML = buttonHtml;
    let note = card.querySelector('.tfd-action-note');
    if (!note) {
      note = document.createElement('div');
      note.className = 'tfd-action-note';
      const anchor = card.querySelector('.tfd-action-grid');
      if (anchor) card.insertBefore(note, anchor);
      else card.appendChild(note);
    }
    note.textContent = noteText;
  },
});
