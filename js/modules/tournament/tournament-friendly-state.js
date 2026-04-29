/* ================================================
   SportHub — Tournament Friendly: State Management
   從 tournament-friendly-detail.js 抽出（Phase 4 §10.3）
   狀態載入、快取同步、可見性判斷。
   ================================================ */

Object.assign(App, {

  _isTournamentViewerInTeam(user, teamId) {
    if (!user || !teamId) return false;
    if (typeof this._isUserInTeam === 'function' && this._isUserInTeam(user, teamId)) return true;
    const team = ApiService.getTeam?.(teamId);
    if (!team) return false;
    return this._isTournamentTeamOfficerForTeam?.(team, user) === true;
  },

  _syncFriendlyTournamentCacheRecord(tournamentId, applications, entries) {
    const live = ApiService.getTournament?.(tournamentId);
    if (!live) return;
    live.registeredTeams = this._getFriendlyTournamentRegisteredTeamIdsFromEntries?.(entries, live) || [];
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
    const registeredTeams = this._getFriendlyTournamentRegisteredTeamIdsFromEntries?.(entries, tournament) || [];

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
    const currentUser = ApiService.getCurrentUser?.();
    const currentUserTeamIds = currentUser
      ? (typeof this._getFriendlyTournamentUserActionTeamIds === 'function'
        ? this._getFriendlyTournamentUserActionTeamIds(currentUser)
        : (typeof this._getUserTeamIds === 'function' ? this._getUserTeamIds(currentUser) : []))
      : [];
    const teamHydrationPromise = (async () => {
      if (!currentUserTeamIds.length || typeof ApiService.getTeamAsync !== 'function') return [];
      return await Promise.all(currentUserTeamIds.map(teamId =>
        ApiService.getTeamAsync(teamId).catch(() => null)
      ));
    })();
    const canManage = this._canManageTournamentRecord?.(base, currentUser);
    const applicationPromise = (async () => {
      if (canManage) {
        return await ApiService.listTournamentApplications(tournamentId).catch(() => fallbackApplications);
      }
      if (!currentUser) return fallbackApplications;
      if (currentUserTeamIds.length === 0) return fallbackApplications;
      const fetched = await Promise.all(currentUserTeamIds.map(teamId =>
        ApiService.getTournamentApplication(tournamentId, `ta_${teamId}`).catch(() => null)
      ));
      return [...fallbackApplications, ...fetched.filter(Boolean)];
    })();
    const [rawApplications, rawEntries] = await Promise.all([
      applicationPromise,
      ApiService.listTournamentEntries(tournamentId).catch(() => fallbackEntries),
      teamHydrationPromise,
    ]).then(([applications, entries]) => [applications, entries]);

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
        countsTowardLimit: this._isTournamentHostParticipating?.(base) !== false,
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
      registeredTeams: this._getFriendlyTournamentRegisteredTeamIdsFromEntries?.(entries, base) || [],
    });

    this._syncFriendlyTournamentCacheRecord(tournamentId, applications, entries);
    this._friendlyTournamentDetailStateById[tournamentId] = {
      tournament,
      applications,
      entries,
      rosterHydrated: false,
    };
    return this._friendlyTournamentDetailStateById[tournamentId];
  },

  _getFriendlyTournamentVisibleApplications(state, user = ApiService.getCurrentUser?.()) {
    const tournament = state?.tournament;
    if (!tournament) return [];
    const canManage = this._canManageTournamentRecord?.(tournament, user);
    return (state.applications || []).filter(application => {
      const status = String(application.status || '').trim().toLowerCase();
      if (status === 'approved' || status === 'cancelled' || status === 'withdrawn' || status === 'removed' || status === 'rejected') return false;
      return canManage || this._isTournamentViewerInTeam(user, application.teamId);
    });
  },

});
