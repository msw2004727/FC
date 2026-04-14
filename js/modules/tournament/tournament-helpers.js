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

  _normalizeTournamentDelegates(delegates) {
    if (!Array.isArray(delegates)) return [];
    const seen = new Set();
    return delegates.reduce((list, delegate) => {
      const uid = String(delegate?.uid || '').trim();
      const name = String(delegate?.name || '').trim();
      const dedupeKey = uid || (name ? `name:${name}` : '');
      if (!dedupeKey || seen.has(dedupeKey)) return list;
      seen.add(dedupeKey);
      list.push({ uid, name });
      return list;
    }, []);
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

  _isTournamentLeaderForTeam(team, user) {
    if (!team || !user) return false;
    const uid = String(user.uid || '').trim();
    if (!uid) return false;
    const leaderUids = Array.isArray(team.leaderUids)
      ? team.leaderUids
      : (team.leaderUid ? [team.leaderUid] : []);
    return leaderUids.includes(uid);
  },

  _isTournamentCaptainForTeam(team, user) {
    if (!team || !user) return false;
    const uid = String(user.uid || '').trim();
    if (!uid) return false;
    return !!(team.captainUid && team.captainUid === uid);
  },

  _getFriendlyResponsibleTeams(user = null) {
    const currentUser = user || ApiService.getCurrentUser?.();
    if (!currentUser) return [];
    const allTeams = ApiService.getTeams?.() || [];
    return allTeams.filter(team =>
      this._isTournamentCaptainForTeam(team, currentUser) || this._isTournamentLeaderForTeam(team, currentUser)
    );
  },

  _canCreateFriendlyTournament(user = null) {
    const currentUser = user || ApiService.getCurrentUser?.();
    if (!currentUser) return false;
    if (this.hasPermission('admin.tournaments.manage_all')) return true;
    return this._getFriendlyResponsibleTeams(currentUser).length > 0;
  },

  _isTournamentDelegate(tournament, user = null) {
    const currentUser = user || ApiService.getCurrentUser?.();
    if (!tournament || !currentUser) return false;
    const delegates = Array.isArray(tournament.delegates) ? tournament.delegates : [];
    return delegates.some(delegate => delegate && delegate.uid === currentUser.uid);
  },

  _canManageTournamentRecord(tournament, user = null) {
    const currentUser = user || ApiService.getCurrentUser?.();
    if (!tournament || !currentUser) return false;
    if (this.hasPermission('admin.tournaments.manage_all')) return true;
    if (this._isTournamentDelegate(tournament, currentUser)) return true;
    const hostTeamId = String(tournament.hostTeamId || '').trim();
    if (!hostTeamId) return false;
    return this._getFriendlyResponsibleTeams(currentUser).some(team => team.id === hostTeamId);
  },

});
