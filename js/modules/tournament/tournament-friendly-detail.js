/* ================================================
   SportHub Tournament Friendly Detail
   Friendly-first detail page: team application,
   host review, pending placeholders.
   ================================================ */

const _tournamentFriendlyDetailLegacy = {
  showTournamentDetail: App.showTournamentDetail,
  renderRegisterButton: App.renderRegisterButton,
  registerTournament: App.registerTournament,
  renderTournamentTab: App.renderTournamentTab,
};

Object.assign(App, {

  _friendlyTournamentDetailStateById: {},
  _friendlyTournamentDetailSeq: 0,
  _friendlyTournamentApplyBusyById: {},
  _friendlyTournamentReviewBusyById: {},

  _isFriendlyTournamentRecord(record) {
    return (this._getTournamentMode?.(record) || 'friendly') === 'friendly';
  },

  _isTournamentViewerInTeam(user, teamId) {
    if (!user || !teamId) return false;
    if (typeof this._isUserInTeam === 'function' && this._isUserInTeam(user, teamId)) return true;
    const team = ApiService.getTeam?.(teamId);
    if (!team) return false;
    return this._isTournamentCaptainForTeam?.(team, user)
      || this._isTournamentLeaderForTeam?.(team, user)
      || (team.coaches || []).includes(user.displayName || user.name || '');
  },

  _getFriendlyTournamentState(id = this.currentTournament) {
    return id ? (this._friendlyTournamentDetailStateById[id] || null) : null;
  },

  _syncFriendlyTournamentCacheRecord(tournamentId, applications, entries) {
    const live = ApiService.getTournament?.(tournamentId);
    if (!live) return;
    live.teamApplications = applications.map(item => ({ ...item }));
    live.teamEntries = entries.map(item => ({
      ...item,
      memberRoster: Array.isArray(item.memberRoster) ? item.memberRoster.map(member => ({ ...member })) : [],
    }));
    live.registeredTeams = entries
      .filter(entry => entry.entryStatus === 'host' || entry.entryStatus === 'approved')
      .map(entry => entry.teamId);
  },

  async _persistFriendlyTournamentCompatState(tournamentId, state = null) {
    const currentState = state || this._getFriendlyTournamentState?.(tournamentId);
    const tournament = currentState?.tournament;
    if (!tournament || !this._isFriendlyTournamentRecord(tournament)) return currentState;
    if (!this._canManageTournamentRecord?.(tournament)) return currentState;

    const teamApplications = (currentState.applications || [])
      .map(item => this._buildFriendlyTournamentApplicationRecord(item))
      .filter(item => item.id || item.teamId);
    const teamEntries = (currentState.entries || [])
      .map(item => this._buildFriendlyTournamentEntryRecord(item))
      .filter(item => item.teamId);
    const registeredTeams = teamEntries
      .filter(entry => entry.entryStatus === 'host' || entry.entryStatus === 'approved')
      .map(entry => entry.teamId);

    try {
      await ApiService.updateTournamentAwait(tournamentId, {
        teamApplications,
        teamEntries,
        registeredTeams,
      });
    } catch (err) {
      console.warn('[persistFriendlyTournamentCompatState] sync failed:', err);
    }

    const nextState = {
      ...currentState,
      applications: teamApplications,
      entries: teamEntries,
      tournament: this._buildFriendlyTournamentRecord({
        ...tournament,
        teamApplications,
        teamEntries,
        registeredTeams,
      }),
    };
    this._syncFriendlyTournamentCacheRecord(tournamentId, teamApplications, teamEntries);
    this._friendlyTournamentDetailStateById[tournamentId] = nextState;
    return nextState;
  },

  async _loadFriendlyTournamentDetailState(tournamentId) {
    const base = ApiService.getFriendlyTournamentRecord?.(tournamentId) || ApiService.getTournament?.(tournamentId);
    if (!base) return null;
    if (!this._isFriendlyTournamentRecord(base)) {
      return { tournament: base, applications: [], entries: [] };
    }

    const fallbackApplications = Array.isArray(base.teamApplications) ? base.teamApplications : [];
    const fallbackEntries = Array.isArray(base.teamEntries) ? base.teamEntries : [];
    const [rawApplications, rawEntries] = await Promise.all([
      ApiService.listTournamentApplications(tournamentId).catch(() => fallbackApplications),
      ApiService.listTournamentEntries(tournamentId).catch(() => fallbackEntries),
    ]);

    const applicationMap = new Map();
    [...fallbackApplications, ...rawApplications].forEach(item => {
      const record = this._buildFriendlyTournamentApplicationRecord(item);
      const key = record.id || record.teamId;
      if (key) applicationMap.set(key, record);
    });

    const entryMap = new Map();
    [...fallbackEntries, ...rawEntries].forEach(item => {
      const record = this._buildFriendlyTournamentEntryRecord(item);
      if (record.teamId) entryMap.set(record.teamId, record);
    });

    const hostTeam = ApiService.getTeam?.(base.hostTeamId);
    if (base.hostTeamId && !entryMap.has(base.hostTeamId)) {
      entryMap.set(base.hostTeamId, this._buildFriendlyTournamentEntryRecord({
        teamId: base.hostTeamId,
        teamName: base.hostTeamName || hostTeam?.name || '',
        teamImage: base.hostTeamImage || hostTeam?.image || '',
        entryStatus: 'host',
        memberRoster: [],
      }));
    }

    const applications = [...applicationMap.values()].sort((a, b) =>
      String(b.appliedAt || '').localeCompare(String(a.appliedAt || ''))
    );
    const entries = [...entryMap.values()].sort((a, b) => {
      if (a.entryStatus === 'host' && b.entryStatus !== 'host') return -1;
      if (a.entryStatus !== 'host' && b.entryStatus === 'host') return 1;
      return String(a.approvedAt || '').localeCompare(String(b.approvedAt || ''));
    });

    const tournament = this._buildFriendlyTournamentRecord({
      ...base,
      teamApplications: applications,
      teamEntries: entries,
      registeredTeams: entries
        .filter(entry => entry.entryStatus === 'host' || entry.entryStatus === 'approved')
        .map(entry => entry.teamId),
    });

    this._syncFriendlyTournamentCacheRecord(tournamentId, applications, entries);
    this._friendlyTournamentDetailStateById[tournamentId] = { tournament, applications, entries };
    return this._friendlyTournamentDetailStateById[tournamentId];
  },

  _getFriendlyTournamentVisibleApplications(state, user = ApiService.getCurrentUser?.()) {
    const tournament = state?.tournament;
    if (!tournament) return [];
    const canManage = this._canManageTournamentRecord?.(tournament, user);
    return (state.applications || []).filter(application => {
      const status = String(application.status || '').trim().toLowerCase();
      if (status === 'approved' || status === 'cancelled') return false;
      return canManage || this._isTournamentViewerInTeam(user, application.teamId);
    });
  },

  _getFriendlyTournamentApplyContext(tournament, state, user = ApiService.getCurrentUser?.()) {
    const eligibleTeams = this._getFriendlyResponsibleTeams?.(user) || [];
    const applicationsByTeam = new Map((state?.applications || []).map(item => [item.teamId, item]));
    const entriesByTeam = new Map((state?.entries || []).map(item => [item.teamId, item]));
    const availableTeams = eligibleTeams.filter(team =>
      team.id !== tournament.hostTeamId && !applicationsByTeam.has(team.id) && !entriesByTeam.has(team.id)
    );
    const teamIds = typeof this._getUserTeamIds === 'function' ? this._getUserTeamIds(user) : [];
    return {
      availableTeams,
      pendingTeams: (state?.applications || []).filter(item => teamIds.includes(item.teamId) && item.status === 'pending'),
      rejectedTeams: (state?.applications || []).filter(item => teamIds.includes(item.teamId) && item.status === 'rejected'),
      approvedTeams: (state?.entries || []).filter(item => teamIds.includes(item.teamId) && (item.entryStatus === 'host' || item.entryStatus === 'approved')),
    };
  },

  async showTournamentDetail(id) {
    const base = ApiService.getTournament?.(id);
    if (!base || !this._isFriendlyTournamentRecord(base)) {
      return await _tournamentFriendlyDetailLegacy.showTournamentDetail.call(this, id);
    }
    if (this._requireLogin()) return;

    const seq = ++this._friendlyTournamentDetailSeq;
    const statePromise = this._loadFriendlyTournamentDetailState(id);
    this.currentTournament = id;
    await this.showPage('page-tournament-detail');
    if (seq !== this._friendlyTournamentDetailSeq || this.currentPage !== 'page-tournament-detail') return;

    const state = await statePromise;
    if (!state || seq !== this._friendlyTournamentDetailSeq || this.currentPage !== 'page-tournament-detail') return;
    const tournament = state.tournament;

    const img = document.getElementById('td-img-placeholder');
    if (img) {
      if (tournament.image) {
        img.innerHTML = `<img src="${tournament.image}" alt="${escapeHTML(tournament.name)}" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:var(--radius)">`;
        img.style.border = 'none';
      } else {
        img.textContent = '賽事封面 800 x 300';
        img.style.border = '';
      }
    }

    const title = document.getElementById('td-title');
    if (title) {
      title.innerHTML = escapeHTML(tournament.name) + ' ' + this._favHeartHtml(this.isTournamentFavorited(id), 'Tournament', id);
    }

    this.renderRegisterButton(tournament);
    this.renderTournamentInfo(tournament);

    document.querySelectorAll('#td-tabs .tab').forEach(tab => {
      tab.onclick = () => {
        document.querySelectorAll('#td-tabs .tab').forEach(node => node.classList.remove('active'));
        tab.classList.add('active');
        this.renderTournamentTab(tab.dataset.ttab);
      };
    });
    document.querySelectorAll('#td-tabs .tab').forEach(node => node.classList.toggle('active', node.dataset.ttab === 'info'));
    this.renderTournamentTab('info');
  },

  async registerTournament(id) {
    const tournament = ApiService.getFriendlyTournamentRecord?.(id) || ApiService.getTournament?.(id);
    if (!tournament || !this._isFriendlyTournamentRecord(tournament)) {
      return _tournamentFriendlyDetailLegacy.registerTournament.call(this, id);
    }

    const user = ApiService.getCurrentUser?.();
    if (!user?.uid) {
      this.showToast('請先登入');
      return;
    }

    const busyId = String(id || '').trim();
    if (this._friendlyTournamentApplyBusyById[busyId]) return;
    this._friendlyTournamentApplyBusyById[busyId] = true;

    try {
      const state = await this._loadFriendlyTournamentDetailState(id);
    if (!state) { this.showToast('無法載入賽事資料'); return; }
    const latestTournament = state.tournament || tournament;
    const ctx = this._getFriendlyTournamentApplyContext(latestTournament, state, user);
    const approvedCount = (state.entries || []).filter(entry => entry.entryStatus === 'host' || entry.entryStatus === 'approved').length;
    const teamLimit = this._getFriendlyTournamentTeamLimit?.(latestTournament) || 4;

    if (this.getTournamentStatus(latestTournament) !== TOURNAMENT_STATUS.REG_OPEN) {
      this.showToast('目前尚未開放報名');
      return;
    }
    if (approvedCount >= teamLimit) {
      this.showToast('隊伍名額已滿');
      return;
    }
    if (ctx.availableTeams.length === 0) {
      const message = ctx.pendingTeams.length > 0
        ? '你的俱樂部申請已送出，等待主辦審核。'
        : ctx.approvedTeams.length > 0
          ? '你的俱樂部已通過審核。'
          : '需由俱樂部領隊或經理先行報名參賽。';
      this.showToast(message);
      return;
    }

    const selectedTeamId = document.getElementById('td-apply-team-select')?.value || ctx.availableTeams[0].id;
    const selectedTeam = ctx.availableTeams.find(team => team.id === selectedTeamId);
    if (!selectedTeam) {
      this.showToast('請先選擇要報名的俱樂部。');
      return;
    }

    await ApiService.createTournamentApplication(id, {
      id: `ta_${selectedTeam.id}`,
      teamId: selectedTeam.id,
      teamName: selectedTeam.name || '',
      teamImage: selectedTeam.image || '',
      status: 'pending',
      requestedByUid: user.uid,
      requestedByName: user.displayName || user.name || '',
      appliedAt: new Date().toISOString(),
      messageGroupId: `tfa_${id}_${selectedTeam.id}`,
    });

    await this._loadFriendlyTournamentDetailState(id);
    this.renderRegisterButton(this._getFriendlyTournamentState(id)?.tournament || latestTournament);
    this.renderTournamentTab('teams');
    this.showToast(`已送出「${selectedTeam.name}」的參賽申請。`);
    } catch (err) {
      this._showTournamentActionError?.('報名賽事', err);
    }
    finally {
      delete this._friendlyTournamentApplyBusyById[busyId];
    }
  },

  async reviewFriendlyTournamentApplication(tournamentId, applicationId, action) {
    if (!this.hasPermission('admin.tournaments.review') && !this.hasPermission('admin.tournaments.entry')) { this.showToast('權限不足'); return; }
    const busyKey = `${String(tournamentId || '').trim()}:${String(applicationId || '').trim()}:${String(action || '').trim().toLowerCase()}`;
    if (this._friendlyTournamentReviewBusyById[busyKey]) return;
    this._friendlyTournamentReviewBusyById[busyKey] = true;

    try {
      const state = await this._loadFriendlyTournamentDetailState(tournamentId);
    const tournament = state?.tournament;
    if (!tournament || !this._canManageTournamentRecord?.(tournament)) {
      this.showToast('你目前只能審核主辦或受委託的賽事。');
      return;
    }

    const application = (state.applications || []).find(item => item.id === applicationId);
    if (!application || application.status !== 'pending') {
      this.showToast('找不到待審核的申請。');
      return;
    }

    if (action === 'reject' && !(await this.appConfirm(`確定要拒絕「${application.teamName}」的報名申請？`))) return;

    const reviewer = ApiService.getCurrentUser?.();
    const reviewMeta = {
      status: action === 'approve' ? 'approved' : 'rejected',
      reviewedAt: new Date().toISOString(),
      reviewedByUid: reviewer?.uid || '',
      reviewedByName: reviewer?.displayName || reviewer?.name || '',
    };

    if (action === 'approve') {
      const freshState = await this._loadFriendlyTournamentDetailState(tournamentId);
      const freshEntries = freshState?.entries || state.entries || [];
      const approvedCount = freshEntries.filter(entry => entry.entryStatus === 'host' || entry.entryStatus === 'approved').length;
      const teamLimit = this._getFriendlyTournamentTeamLimit?.(tournament) || 4;
      if (!freshEntries.some(entry => entry.teamId === application.teamId) && approvedCount >= teamLimit) {
        this.showToast('隊伍名額已滿，無法再核准更多俱樂部。');
        return;
      }
      await ApiService.upsertTournamentEntry(tournamentId, application.teamId, {
        teamId: application.teamId,
        teamName: application.teamName,
        teamImage: application.teamImage,
        entryStatus: 'approved',
        approvedAt: reviewMeta.reviewedAt,
        approvedByUid: reviewMeta.reviewedByUid,
        approvedByName: reviewMeta.reviewedByName,
      });
    }

    await ApiService.updateTournamentApplication(tournamentId, applicationId, reviewMeta);
    const nextState = await this._loadFriendlyTournamentDetailState(tournamentId);
    const syncedState = await this._persistFriendlyTournamentCompatState(tournamentId, nextState);
    this.renderRegisterButton(syncedState?.tournament || tournament);
    this.renderTournamentTab('teams');
    this.showToast(action === 'approve' ? `已確認「${application.teamName}」參賽。` : `已拒絕「${application.teamName}」的申請。`);
    } catch (err) {
      this._showTournamentActionError?.(action === 'approve' ? '確認報名' : '拒絕報名', err);
    }
    finally {
      delete this._friendlyTournamentReviewBusyById[busyKey];
    }
  },

});
