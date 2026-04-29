/* ================================================
   SportHub — Tournament Helpers (Pure Utilities)
   從 tournament-core.js 抽出的純工具函式。
   無 DOM 操作、無 API 呼叫、無副作用。
   ================================================ */

Object.assign(App, {

  _resolveTournamentOrganizerUser(tournament) {
    if (!tournament) return null;
    const users = ApiService.getAdminUsers?.() || [];
    const organizerUid = String(tournament.creatorUid || '').trim();
    const organizerNames = [
      String(tournament.creatorName || '').trim(),
      String(tournament.organizer || '').trim(),
    ].filter(Boolean);

    let user = null;
    if (organizerUid) {
      user = users.find(item =>
        String(item?.uid || '').trim() === organizerUid ||
        String(item?.lineUserId || '').trim() === organizerUid
      ) || null;
    }

    if (!user && organizerNames.length > 0) {
      user = users.find(item => {
        const name = String(item?.name || '').trim();
        const displayName = String(item?.displayName || '').trim();
        return organizerNames.includes(name) || organizerNames.includes(displayName);
      }) || null;
    }

    if (!user) {
      const currentUser = ApiService.getCurrentUser?.();
      if (currentUser) {
        const currentName = String(currentUser.name || '').trim();
        const currentDisplayName = String(currentUser.displayName || '').trim();
        const currentUid = String(currentUser.uid || currentUser.lineUserId || '').trim();
        const uidMatched = organizerUid && currentUid === organizerUid;
        const nameMatched = organizerNames.includes(currentName) || organizerNames.includes(currentDisplayName);
        if (uidMatched || nameMatched) user = currentUser;
      }
    }

    return user || null;
  },

  _normalizeTournamentPeople(people, limit = 10) {
    if (!Array.isArray(people)) return [];
    const seen = new Set();
    return people.reduce((list, person) => {
      if (list.length >= limit) return list;
      const uid = String(person?.uid || '').trim();
      const name = String(person?.name || '').trim();
      const dedupeKey = uid || (name ? `name:${name}` : '');
      if (!dedupeKey || seen.has(dedupeKey)) return list;
      seen.add(dedupeKey);
      list.push({ uid, name });
      return list;
    }, []);
  },

  _normalizeTournamentDelegates(delegates) {
    return this._normalizeTournamentPeople(delegates, 10);
  },

  _normalizeTournamentReferees(referees) {
    return this._normalizeTournamentPeople(referees, 10);
  },

  _getTournamentDelegateUids(tournament) {
    const direct = Array.isArray(tournament?.delegateUids) ? tournament.delegateUids : [];
    const delegates = this._normalizeTournamentDelegates(tournament?.delegates);
    const merged = [...direct, ...delegates.map(delegate => delegate.uid)];
    const seen = new Set();
    return merged.reduce((list, uid) => {
      const safeUid = String(uid || '').trim();
      if (!safeUid || seen.has(safeUid)) return list;
      seen.add(safeUid);
      list.push(safeUid);
      return list;
    }, []);
  },

  _getTournamentRefereeUids(tournament) {
    const direct = Array.isArray(tournament?.refereeUids) ? tournament.refereeUids : [];
    const referees = this._normalizeTournamentReferees(tournament?.referees);
    const merged = [...direct, ...referees.map(referee => referee.uid)];
    const seen = new Set();
    return merged.reduce((list, uid) => {
      const safeUid = String(uid || '').trim();
      if (!safeUid || seen.has(safeUid)) return list;
      seen.add(safeUid);
      list.push(safeUid);
      return list;
    }, []);
  },

  _isTournamentHostParticipating(tournament) {
    if (!tournament) return true;
    if (typeof tournament.hostParticipates === 'boolean') return tournament.hostParticipates;
    if (typeof tournament.friendlyConfig?.hostParticipates === 'boolean') return tournament.friendlyConfig.hostParticipates;
    return true;
  },

  _friendlyTournamentEntryCountsTowardLimit(entry, tournament = null) {
    const status = String(entry?.entryStatus || '').trim().toLowerCase();
    if (status === 'approved') return true;
    if (status !== 'host') return false;
    if (entry?.countsTowardLimit === false) return false;
    return this._isTournamentHostParticipating(tournament) !== false;
  },

  _getFriendlyTournamentRegisteredTeamIdsFromEntries(entries, tournament = null) {
    const seen = new Set();
    return (Array.isArray(entries) ? entries : []).reduce((list, entry) => {
      if (!this._friendlyTournamentEntryCountsTowardLimit(entry, tournament)) return list;
      const teamId = String(entry?.teamId || '').trim();
      if (!teamId || seen.has(teamId)) return list;
      seen.add(teamId);
      list.push(teamId);
      return list;
    }, []);
  },

  _isTournamentGlobalAdmin(user = null) {
    const currentUser = user || ApiService.getCurrentUser?.();
    if (!currentUser) return false;
    const role = String(currentUser.role || '').trim().toLowerCase();
    return role === 'admin' || role === 'super_admin';
  },

  _isTournamentTeamOfficerForTeam(team, user = null) {
    const currentUser = user || ApiService.getCurrentUser?.();
    if (!team || !currentUser) return false;
    const uid = String(currentUser?.uid || currentUser?.lineUserId || '').trim();
    if (!uid) return false;
    return String(team.captainUid || '').trim() === uid
      || String(team.creatorUid || '').trim() === uid
      || String(team.ownerUid || '').trim() === uid
      || String(team.leaderUid || '').trim() === uid
      || (Array.isArray(team.leaderUids) && team.leaderUids.map(item => String(item || '').trim()).includes(uid));
  },

  _isTournamentLeaderForTeam(team, user) {
    if (!team || !user) return false;
    const uid = String(user.uid || user.lineUserId || '').trim();
    if (!uid) return false;
    return String(team.leaderUid || '').trim() === uid
      || (Array.isArray(team.leaderUids) && team.leaderUids.map(item => String(item || '').trim()).includes(uid));
  },

  _isTournamentCaptainForTeam(team, user) {
    if (!team || !user) return false;
    const uid = String(user.uid || user.lineUserId || '').trim();
    if (!uid) return false;
    return String(team.captainUid || '').trim() === uid;
  },

  _getFriendlyResponsibleTeams(user = null) {
    const currentUser = user || ApiService.getCurrentUser?.();
    if (!currentUser) return [];
    const allTeams = ApiService.getTeams?.() || [];
    return allTeams.filter(team => this._isTournamentTeamOfficerForTeam(team, currentUser));
  },

  _canCreateFriendlyTournament(user = null) {
    const currentUser = user || ApiService.getCurrentUser?.();
    if (!currentUser) return false;
    if (this._isTournamentGlobalAdmin(currentUser)) return true;
    return this._getFriendlyResponsibleTeams(currentUser).length > 0;
  },

  _isTournamentDelegate(tournament, user = null) {
    const currentUser = user || ApiService.getCurrentUser?.();
    if (!tournament || !currentUser) return false;
    const currentUid = String(currentUser.uid || currentUser.lineUserId || '').trim();
    if (!currentUid) return false;
    return this._getTournamentDelegateUids(tournament).includes(currentUid);
  },

  _canManageTournamentRecord(tournament, user = null) {
    const currentUser = user || ApiService.getCurrentUser?.();
    if (!tournament || !currentUser) return false;
    if (this._isTournamentGlobalAdmin(currentUser)) return true;
    const currentUid = String(currentUser.uid || currentUser.lineUserId || '').trim();
    const creatorUid = String(tournament.creatorUid || '').trim();
    if (currentUid && creatorUid && currentUid === creatorUid) return true;
    if (this._isTournamentDelegate(tournament, currentUser)) return true;
    const hostTeamId = String(tournament.hostTeamId || '').trim();
    if (!hostTeamId) return false;
    return this._getFriendlyResponsibleTeams(currentUser).some(team => team.id === hostTeamId);
  },

});
