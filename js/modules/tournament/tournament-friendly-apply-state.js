/* ================================================
   SportHub Tournament Friendly Apply State
   可報名俱樂部、隊伍別名與申請狀態判斷。
   ================================================ */

Object.assign(App, {

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
      const aliases = this._getFriendlyTournamentTeamAliasIds?.(team) || [];
      aliases.forEach(alias => teamsById.set(alias, team));
    });

    const seen = new Set();
    return teamIds
      .map(teamId => {
        const team = ApiService.getTeam?.(teamId) || teamsById.get(teamId);
        if (!team) return null;
        const aliases = this._getFriendlyTournamentTeamAliasIds?.(team) || [teamId];
        if (aliases.some(alias => seen.has(alias))) return null;
        aliases.forEach(alias => seen.add(alias));
        return {
          ...team,
          id: String(team.id || team.teamId || team._docId || team.docId || teamId).trim() || teamId,
        };
      })
      .filter(Boolean);
  },

  _getFriendlyTournamentTeamAliasIds(team, options = {}) {
    if (team == null || typeof team !== 'object') {
      const value = String(team || '').trim();
      return value ? [value] : [];
    }
    const includeRecordId = options.includeRecordId !== false;
    const values = [
      includeRecordId ? team?.id : '',
      team?.teamId,
      team?.canonicalTeamId,
      team?.sourceTeamId,
      team?._docId,
      team?.docId,
    ];
    const seen = new Set();
    return values
      .map(value => String(value || '').trim())
      .filter(value => {
        if (!value || seen.has(value)) return false;
        seen.add(value);
        return true;
      });
  },

  _getFriendlyTournamentTeamNameKey(team) {
    return String(team?.name || team?.teamName || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  },

  _buildFriendlyTournamentTeamLookup(teams = []) {
    const aliasToKey = new Map();
    const nameToKey = new Map();
    const ambiguousNames = new Set();
    (teams || []).forEach(team => {
      const aliases = this._getFriendlyTournamentTeamAliasIds(team);
      const key = aliases[0] || '';
      if (!key) return;
      aliases.forEach(alias => aliasToKey.set(alias, key));
      const nameKey = this._getFriendlyTournamentTeamNameKey(team);
      if (!nameKey) return;
      if (!nameToKey.has(nameKey)) {
        nameToKey.set(nameKey, key);
      } else if (nameToKey.get(nameKey) !== key) {
        ambiguousNames.add(nameKey);
      }
    });
    ambiguousNames.forEach(nameKey => nameToKey.delete(nameKey));
    return { aliasToKey, nameToKey };
  },

  _getFriendlyTournamentCanonicalTeamKey(team, lookup = {}, options = {}) {
    const aliases = this._getFriendlyTournamentTeamAliasIds(team, options);
    for (const alias of aliases) {
      const key = lookup.aliasToKey?.get(alias);
      if (key) return key;
    }
    const nameKey = this._getFriendlyTournamentTeamNameKey(team);
    const keyByName = nameKey ? lookup.nameToKey?.get(nameKey) : '';
    return keyByName || aliases[0] || '';
  },

  _mergeFriendlyTournamentTeamLists(...teamLists) {
    const seen = new Set();
    const merged = [];
    teamLists.flat().forEach(team => {
      const aliases = this._getFriendlyTournamentTeamAliasIds(team);
      const id = aliases[0] || '';
      if (!id || aliases.some(alias => seen.has(alias))) return;
      aliases.forEach(alias => seen.add(alias));
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

  _getFriendlyTournamentRepresentativeTeams(user = ApiService.getCurrentUser?.()) {
    return this._mergeFriendlyTournamentTeamLists(
      this._getFriendlyTournamentJoinedTeams(user),
      this._getFriendlyTournamentOfficerApplyTeams(user)
    );
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
      ? this._getFriendlyTournamentRepresentativeTeams(user)
      : this._getFriendlyTournamentOfficerApplyTeams(user);
    teams.forEach(team => {
      (this._getFriendlyTournamentTeamAliasIds?.(team) || []).forEach(pushId);
    });
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
      ? this._getFriendlyTournamentRepresentativeTeams(currentUser)
      : this._getFriendlyTournamentOfficerApplyTeams(currentUser);

    const hasTeam = teamId => !!(
      ApiService.getTeam?.(teamId)
      || (ApiService.getTeams?.() || []).some(team =>
        (this._getFriendlyTournamentTeamAliasIds?.(team) || []).includes(teamId)
      )
    );
    const missingTeamIds = teamIds.filter(teamId => !hasTeam(teamId));

    try {
      if (missingTeamIds.length > 0 && typeof ApiService.getTeamAsync === 'function') {
        await Promise.all(missingTeamIds.map(teamId => ApiService.getTeamAsync(teamId).catch(() => null)));
      }

      if ((isGlobalAdmin || getEligibleTeams().length === 0) && typeof FirebaseService !== 'undefined') {
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
      ? this._getFriendlyTournamentRepresentativeTeams(user)
      : this._getFriendlyTournamentOfficerApplyTeams(user);
    const teamLookup = this._buildFriendlyTournamentTeamLookup(eligibleTeams);
    const terminalApplicationStatuses = new Set(['cancelled', 'withdrawn', 'removed', 'rejected']);
    const priorRejectedStatuses = new Set(['removed', 'rejected']);
    const activeApplications = (state?.applications || []).filter(item => {
      const status = String(item.status || '').trim().toLowerCase();
      return !terminalApplicationStatuses.has(status);
    });
    const recordTeamKey = item => this._getFriendlyTournamentCanonicalTeamKey(item, teamLookup, { includeRecordId: false });
    const applicationsByTeam = new Map();
    activeApplications.forEach(item => {
      const key = recordTeamKey(item);
      if (key) applicationsByTeam.set(key, item);
    });
    const priorRejectedApplicationsByTeam = new Map();
    (state?.applications || [])
      .filter(item => priorRejectedStatuses.has(String(item.status || '').trim().toLowerCase()))
      .forEach(item => {
        const key = recordTeamKey(item);
        if (key && !priorRejectedApplicationsByTeam.has(key)) priorRejectedApplicationsByTeam.set(key, item);
      });
    const entriesByTeam = new Map();
    (state?.entries || []).forEach(item => {
      const key = recordTeamKey(item);
      if (key) entriesByTeam.set(key, item);
    });
    const tournamentSport = this._getTournamentSportTag?.(tournament) || String(tournament?.sportTag || tournament?.sport || '').trim();
    const hostTeamKey = this._getFriendlyTournamentCanonicalTeamKey({ teamId: tournament?.hostTeamId }, teamLookup, { includeRecordId: false });
    const availableTeamKeys = new Set();
    const blockedTeams = [];
    const decorateAvailableTeam = (team, teamKey) => {
      const priorApplication = priorRejectedApplicationsByTeam.get(teamKey);
      if (!priorApplication) {
        return {
          ...team,
          canonicalTeamId: teamKey,
          sourceTeamId: String(team.id || team.teamId || team._docId || team.docId || '').trim(),
        };
      }
      const applicationTeamId = String(priorApplication.teamId || '').trim();
      return {
        ...team,
        id: applicationTeamId || team.id,
        teamId: applicationTeamId || team.teamId || team.id,
        canonicalTeamId: teamKey,
        sourceTeamId: String(team.id || team.teamId || team._docId || team.docId || '').trim(),
        hasPriorRejectedApplication: true,
        priorApplicationStatus: String(priorApplication.status || '').trim().toLowerCase(),
      };
    };
    const availableTeams = [];
    eligibleTeams.forEach(team => {
      const teamKey = this._getFriendlyTournamentCanonicalTeamKey(team, teamLookup);
      if (!teamKey
        || teamKey === hostTeamKey
        || applicationsByTeam.has(teamKey)
        || entriesByTeam.has(teamKey)) return;
      const teamSport = this._getTournamentTeamSportTag?.(team) || String(team?.sportTag || team?.sport || '').trim();
      const sportCompatible = !!tournamentSport && !!teamSport && teamSport === tournamentSport;
      if (!sportCompatible) {
        blockedTeams.push({
          ...team,
          canonicalTeamId: teamKey,
          sourceTeamId: String(team.id || team.teamId || team._docId || team.docId || '').trim(),
          sportMismatch: true,
          disabledReason: 'sport-mismatch',
        });
        return;
      }
      availableTeamKeys.add(teamKey);
      availableTeams.push(decorateAvailableTeam(team, teamKey));
    });
    const teamIds = typeof this._getFriendlyTournamentUserActionTeamIds === 'function'
      ? this._getFriendlyTournamentUserActionTeamIds(user)
      : (typeof this._getUserTeamIds === 'function'
        ? this._getUserTeamIds(user).map(teamId => String(teamId || '').trim()).filter(Boolean)
        : []);
    const teamIdSet = new Set(teamIds);
    eligibleTeams.forEach(team => {
      const canonicalKey = this._getFriendlyTournamentCanonicalTeamKey(team, teamLookup);
      if (canonicalKey) teamIdSet.add(canonicalKey);
      (this._getFriendlyTournamentTeamAliasIds(team) || []).forEach(alias => teamIdSet.add(alias));
    });
    const inStatusScope = item => {
      const teamKey = recordTeamKey(item);
      const aliases = this._getFriendlyTournamentTeamAliasIds(item, { includeRecordId: false });
      return !!teamKey && (teamIdSet.has(teamKey) || aliases.some(alias => teamIdSet.has(alias)));
    };
    return {
      availableTeams,
      blockedTeams,
      pendingTeams: (state?.applications || []).filter(item => inStatusScope(item) && String(item.status || '').trim().toLowerCase() === 'pending'),
      rejectedTeams: (state?.applications || []).filter(item =>
        inStatusScope(item)
        && String(item.status || '').trim().toLowerCase() === 'rejected'
        && !availableTeamKeys.has(recordTeamKey(item))
      ),
      approvedTeams: (state?.entries || []).filter(item => inStatusScope(item) && (item.entryStatus === 'host' || item.entryStatus === 'approved')),
    };
  },

});
