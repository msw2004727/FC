/* ================================================
   SportHub Tournament Host Selection Helpers
   ================================================ */

Object.assign(App, {

  _getTournamentTeamAliasIds(team) {
    if (!team || typeof team !== 'object') {
      const value = String(team || '').trim();
      return value ? [value] : [];
    }
    const values = [
      team.id,
      team.teamId,
      team.canonicalTeamId,
      team.sourceTeamId,
      team._docId,
      team.docId,
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

  _getTournamentCurrentUserTeamIds(user = null) {
    const currentUser = user || ApiService.getCurrentUser?.();
    const ids = [];
    const seen = new Set();
    const pushId = (teamId) => {
      const safeId = String(teamId || '').trim();
      if (!safeId || seen.has(safeId)) return;
      seen.add(safeId);
      ids.push(safeId);
    };

    if (Array.isArray(currentUser?.teamIds)) currentUser.teamIds.forEach(pushId);
    pushId(currentUser?.teamId);
    return ids;
  },

  _canCreateTournamentWithoutHostTeam(user = null) {
    const currentUser = user || ApiService.getCurrentUser?.();
    return this._isTournamentGlobalAdmin?.(currentUser) === true;
  },

  _getTournamentSelectableHostTeams(selectedId = '') {
    const currentUser = ApiService.getCurrentUser?.();
    const allTeams = ApiService.getTeams?.() || [];
    const isGlobalAdmin = this._isTournamentGlobalAdmin?.(currentUser) === true;
    const joinedIds = new Set(this._getTournamentCurrentUserTeamIds(currentUser));
    const source = isGlobalAdmin
      ? allTeams.filter(team => {
        const aliases = this._getTournamentTeamAliasIds(team);
        return aliases.some(alias => joinedIds.has(alias))
          || this._isTournamentTeamOfficerForTeam?.(team, currentUser) === true;
      })
      : this._getFriendlyResponsibleTeams(currentUser);

    const teams = [];
    const seen = new Set();
    const pushTeam = team => {
      const aliases = this._getTournamentTeamAliasIds(team);
      const safeId = aliases[0] || '';
      if (!safeId || aliases.some(alias => seen.has(alias))) return;
      aliases.forEach(alias => seen.add(alias));
      teams.push({ ...team, id: safeId });
    };

    (source || []).forEach(pushTeam);

    const safeSelectedId = String(selectedId || '').trim();
    if (safeSelectedId && !seen.has(safeSelectedId)) {
      const selectedTeam = allTeams.find(team =>
        this._getTournamentTeamAliasIds(team).includes(safeSelectedId)
      );
      if (selectedTeam) pushTeam(selectedTeam);
    }
    return teams;
  },

  _getTournamentSelectedHostTeam(prefix = 'tf') {
    const select = document.getElementById(`${prefix}-host-team`);
    const selectedId = String(select?.value || '').trim();
    if (!selectedId) return null;
    const teams = ApiService.getTeams?.() || [];
    return ApiService.getTeam?.(selectedId)
      || teams.find(team => this._getTournamentTeamAliasIds(team).includes(selectedId))
      || null;
  },

  _isTournamentSelectedHostParticipationAllowed(prefix = 'tf', user = null) {
    const currentUser = user || ApiService.getCurrentUser?.();
    const team = this._getTournamentSelectedHostTeam(prefix);
    return !!team && this._isTournamentTeamOfficerForTeam?.(team, currentUser) === true;
  },

  _syncTournamentHostParticipationAvailability(prefix = 'tf') {
    const p = prefix || 'tf';
    const toggle = document.getElementById(`${p}-host-participates`);
    if (!toggle) return;
    const allowed = this._isTournamentSelectedHostParticipationAllowed(p);
    if (!allowed) toggle.checked = false;
    toggle.disabled = !allowed;
    this._updateTournamentHostParticipationNote(p, {
      disabled: !allowed,
      reason: allowed ? '' : 'host-unavailable',
    });
  },

  async _ensureTournamentHostTeamsLoaded(user = null) {
    const currentUser = user || ApiService.getCurrentUser?.();

    try {
      if (typeof FirebaseService !== 'undefined') {
        if (typeof FirebaseService.ensureStaticCollectionsLoaded === 'function') {
          await FirebaseService.ensureStaticCollectionsLoaded(['teams']);
        } else if (typeof FirebaseService.ensureCollectionsForPage === 'function') {
          await FirebaseService.ensureCollectionsForPage('page-teams', { skipRealtimeStart: true });
        }

        const userTeamIds = this._getTournamentCurrentUserTeamIds(currentUser);
        if (userTeamIds.length && typeof FirebaseService.fetchTeamIfMissing === 'function') {
          await Promise.all(userTeamIds.map(teamId => FirebaseService.fetchTeamIfMissing(teamId)));
        }
      }
      return ApiService.getTeams?.() || [];
    } catch (err) {
      console.warn('[Tournament] Failed to load host teams before create:', err);
      return ApiService.getTeams?.() || [];
    }
  },

});
