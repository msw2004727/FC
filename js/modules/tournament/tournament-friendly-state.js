/* ================================================
   SportHub — Tournament Friendly: State Management
   從 tournament-friendly-detail.js 抽出（Phase 4 §10.3）
   狀態載入、快取同步、可見性判斷、申請上下文。
   ================================================ */

Object.assign(App, {

  _isTournamentViewerInTeam(user, teamId) {
    if (!user || !teamId) return false;
    if (typeof this._isUserInTeam === 'function' && this._isUserInTeam(user, teamId)) return true;
    const team = ApiService.getTeam?.(teamId);
    if (!team) return false;
    const uid = String(user.uid || '').trim();
    if (!uid) return false;
    return this._isTournamentCaptainForTeam?.(team, user)
      || this._isTournamentLeaderForTeam?.(team, user)
      || (Array.isArray(team.coachUids) && team.coachUids.includes(uid));
  },

  _syncFriendlyTournamentCacheRecord(tournamentId, applications, entries) {
    const live = ApiService.getTournament?.(tournamentId);
    if (!live) return;
    live.registeredTeams = entries
      .filter(entry => entry.entryStatus === 'host' || entry.entryStatus === 'approved')
      .map(entry => entry.teamId);
  },

  async _persistFriendlyTournamentCompatState(tournamentId, state = null) {
    const currentState = state || this._getFriendlyTournamentState?.(tournamentId);
    const tournament = currentState?.tournament;
    if (!tournament || !this._isFriendlyTournamentRecord(tournament)) return currentState;
    if (!this._canManageTournamentRecord?.(tournament)) return currentState;

    const applications = (currentState.applications || [])
      .map(item => this._buildFriendlyTournamentApplicationRecord(item))
      .filter(item => item.id || item.teamId);
    const entries = (currentState.entries || [])
      .map(item => this._buildFriendlyTournamentEntryRecord(item))
      .filter(item => item.teamId);
    const registeredTeams = entries
      .filter(entry => entry.entryStatus === 'host' || entry.entryStatus === 'approved')
      .map(entry => entry.teamId);

    try {
      await ApiService.updateTournamentAwait(tournamentId, { registeredTeams });
    } catch (err) {
      console.warn('[persistFriendlyTournamentCompatState] sync failed:', err);
    }

    const nextState = {
      ...currentState,
      applications,
      entries,
      tournament: this._buildFriendlyTournamentRecord({
        ...tournament,
        registeredTeams,
      }),
    };
    this._syncFriendlyTournamentCacheRecord(tournamentId, applications, entries);
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

});
