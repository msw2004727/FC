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
      if (status === 'approved' || status === 'cancelled' || status === 'withdrawn' || status === 'removed') return false;
      return canManage || this._isTournamentViewerInTeam(user, application.teamId);
    });
  },

  _getFriendlyTournamentJoinedTeams(user = ApiService.getCurrentUser?.()) {
    const teamIds = typeof this._getUserTeamIds === 'function'
      ? this._getUserTeamIds(user)
        .map(teamId => String(teamId || '').trim())
        .filter(Boolean)
      : [];
    if (!teamIds.length) return [];

    const allTeams = ApiService.getTeams?.() || [];
    const teamsById = new Map();
    allTeams.forEach(team => {
      const id = String(team?.id || team?._docId || team?.docId || '').trim();
      if (id) teamsById.set(id, team);
    });

    const seen = new Set();
    return teamIds
      .map(teamId => {
        const team = ApiService.getTeam?.(teamId) || teamsById.get(teamId);
        if (!team || seen.has(teamId)) return null;
        seen.add(teamId);
        return {
          ...team,
          id: String(team.id || team._docId || team.docId || teamId).trim() || teamId,
        };
      })
      .filter(Boolean);
  },

  _mergeFriendlyTournamentTeamLists(...teamLists) {
    const seen = new Set();
    const merged = [];
    teamLists.flat().forEach(team => {
      const id = String(team?.id || team?.teamId || team?._docId || team?.docId || '').trim();
      if (!id || seen.has(id)) return;
      seen.add(id);
      merged.push({
        ...team,
        id,
      });
    });
    return merged;
  },

  _getFriendlyTournamentOfficerApplyTeams(user = ApiService.getCurrentUser?.()) {
    const responsibleTeams = this._getFriendlyResponsibleTeams?.(user) || [];
    const joinedOfficerTeams = this._getFriendlyTournamentJoinedTeams(user)
      .filter(team => this._isTournamentTeamOfficerForTeam?.(team, user));
    return this._mergeFriendlyTournamentTeamLists(responsibleTeams, joinedOfficerTeams);
  },

  _getFriendlyTournamentUserActionTeamIds(user = ApiService.getCurrentUser?.()) {
    const ids = [];
    const seen = new Set();
    const pushId = id => {
      const value = String(id || '').trim();
      if (!value || seen.has(value)) return;
      seen.add(value);
      ids.push(value);
    };
    if (typeof this._getUserTeamIds === 'function') {
      this._getUserTeamIds(user).forEach(pushId);
    }
    const teams = this._isTournamentGlobalAdmin?.(user) === true
      ? this._getFriendlyTournamentJoinedTeams(user)
      : this._getFriendlyTournamentOfficerApplyTeams(user);
    teams.forEach(team => pushId(team?.id || team?.teamId || team?._docId || team?.docId));
    return ids;
  },

  async _ensureFriendlyTournamentApplyTeamsLoaded(user = ApiService.getCurrentUser?.()) {
    const currentUser = user || ApiService.getCurrentUser?.();
    if (!currentUser) return [];

    const teamIds = typeof this._getUserTeamIds === 'function'
      ? this._getUserTeamIds(currentUser)
        .map(teamId => String(teamId || '').trim())
        .filter(Boolean)
      : [];
    const isGlobalAdmin = this._isTournamentGlobalAdmin?.(currentUser) === true;
    const getEligibleTeams = () => isGlobalAdmin
      ? this._getFriendlyTournamentJoinedTeams(currentUser)
      : this._getFriendlyTournamentOfficerApplyTeams(currentUser);

    const hasTeam = teamId => !!(
      ApiService.getTeam?.(teamId)
      || (ApiService.getTeams?.() || []).some(team =>
        String(team?.id || team?._docId || team?.docId || '').trim() === teamId
      )
    );
    const missingTeamIds = teamIds.filter(teamId => !hasTeam(teamId));

    try {
      if (missingTeamIds.length > 0 && typeof ApiService.getTeamAsync === 'function') {
        await Promise.all(missingTeamIds.map(teamId => ApiService.getTeamAsync(teamId).catch(() => null)));
      }

      if (getEligibleTeams().length === 0 && typeof FirebaseService !== 'undefined') {
        const hasAnyTeamCache = (ApiService.getTeams?.() || []).length > 0;
        if (typeof FirebaseService.ensureStaticCollectionsLoaded === 'function') {
          await FirebaseService.ensureStaticCollectionsLoaded(['teams']);
        } else if (typeof FirebaseService.ensureCollectionsForPage === 'function') {
          await FirebaseService.ensureCollectionsForPage('page-teams', { skipRealtimeStart: true });
        }
        if (!hasAnyTeamCache && getEligibleTeams().length === 0 && typeof FirebaseService.refreshCollectionsForPage === 'function') {
          await FirebaseService.refreshCollectionsForPage('page-teams');
        }
      }
    } catch (err) {
      console.warn('[Tournament] Failed to load teams for friendly tournament apply selector:', err);
    }
    return getEligibleTeams();
  },

  _getFriendlyTournamentApplyContext(tournament, state, user = ApiService.getCurrentUser?.()) {
    const isGlobalAdmin = this._isTournamentGlobalAdmin?.(user) === true;
    const eligibleTeams = isGlobalAdmin
      ? this._getFriendlyTournamentJoinedTeams(user)
      : this._getFriendlyTournamentOfficerApplyTeams(user);
    const activeApplications = (state?.applications || []).filter(item => {
      const status = String(item.status || '').trim().toLowerCase();
      return status !== 'cancelled' && status !== 'withdrawn';
    });
    const applicationsByTeam = new Map(activeApplications.map(item => [item.teamId, item]));
    const entriesByTeam = new Map((state?.entries || []).map(item => [item.teamId, item]));
    const tournamentSport = String(tournament?.sportTag || tournament?.sport || '').trim();
    const availableTeams = eligibleTeams.filter(team =>
      team.id !== tournament.hostTeamId
      && !applicationsByTeam.has(team.id)
      && !entriesByTeam.has(team.id)
      && (!tournamentSport || !String(team?.sportTag || team?.sport || '').trim() || String(team?.sportTag || team?.sport || '').trim() === tournamentSport)
    );
    const teamIds = typeof this._getFriendlyTournamentUserActionTeamIds === 'function'
      ? this._getFriendlyTournamentUserActionTeamIds(user)
      : (typeof this._getUserTeamIds === 'function'
        ? this._getUserTeamIds(user).map(teamId => String(teamId || '').trim()).filter(Boolean)
        : []);
    const teamIdSet = new Set(teamIds);
    const inStatusScope = item => {
      const teamId = String(item?.teamId || '').trim();
      if (!teamId) return false;
      return teamIdSet.has(teamId);
    };
    return {
      availableTeams,
      pendingTeams: (state?.applications || []).filter(item => inStatusScope(item) && item.status === 'pending'),
      rejectedTeams: (state?.applications || []).filter(item => inStatusScope(item) && item.status === 'rejected'),
      approvedTeams: (state?.entries || []).filter(item => inStatusScope(item) && (item.entryStatus === 'host' || item.entryStatus === 'approved')),
    };
  },

});
