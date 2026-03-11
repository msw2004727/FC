/* ================================================
   SportHub Tournament Core
   Shared helpers for public tournament pages and
   the upcoming friendly/cup/league refactor.
   ================================================ */

Object.assign(App, {

  getTournamentStatus(t) {
    if (!t || !t.regStart || !t.regEnd) return (t && t.status) || '\u5373\u5c07\u958b\u59cb';
    const now = new Date();
    const start = new Date(t.regStart);
    const end = new Date(t.regEnd);
    if (now < start) return '\u5373\u5c07\u958b\u59cb';
    if (now >= start && now <= end) return '\u5831\u540d\u4e2d';
    return '\u5df2\u622a\u6b62\u5831\u540d';
  },

  isTournamentEnded(t) {
    if (!t) return false;
    if (t.ended === true) return true;
    const dates = Array.isArray(t.matchDates) ? t.matchDates : [];
    if (dates.length === 0) return false;
    const lastDate = new Date(dates[dates.length - 1]);
    if (Number.isNaN(lastDate.getTime())) return false;
    lastDate.setHours(lastDate.getHours() + 24);
    return new Date() > lastDate;
  },

  _getTournamentMode(t) {
    return String(t?.mode || t?.type || 'friendly').trim().toLowerCase();
  },

  _getFriendlyTournamentTeamLimit(t) {
    const limit = Number(t?.friendlyConfig?.teamLimit ?? t?.teamLimit ?? t?.maxTeams ?? t?.teams ?? 4);
    return Number.isFinite(limit) && limit > 0 ? limit : 4;
  },

  _buildTournamentOrganizerDisplay(teamName, userName) {
    const safeTeamName = String(teamName || '').trim();
    const safeUserName = String(userName || '').trim();
    if (safeTeamName && safeUserName) return `${safeTeamName}\uFF08${safeUserName}\uFF09`;
    return safeTeamName || safeUserName || '\u4e3b\u8fa6\u7403\u968a';
  },

  _isTournamentLeaderForTeam(team, user) {
    if (!team || !user) return false;
    const uid = String(user.uid || '').trim();
    const displayName = String(user.displayName || user.name || '').trim();
    const leaderUids = Array.isArray(team.leaderUids)
      ? team.leaderUids
      : (team.leaderUid ? [team.leaderUid] : []);
    return leaderUids.includes(uid) || (!!team.leader && team.leader === displayName);
  },

  _isTournamentCaptainForTeam(team, user) {
    if (!team || !user) return false;
    const uid = String(user.uid || '').trim();
    const displayName = String(user.displayName || user.name || '').trim();
    return (team.captainUid && team.captainUid === uid) || (!!team.captain && team.captain === displayName);
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
    const roleLevel = ROLE_LEVEL_MAP[currentUser.role] || 0;
    if (roleLevel >= ROLE_LEVEL_MAP.admin) return true;
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
    const roleLevel = ROLE_LEVEL_MAP[currentUser.role] || 0;
    if (roleLevel >= ROLE_LEVEL_MAP.admin) return true;
    if (this._isTournamentDelegate(tournament, currentUser)) return true;
    const hostTeamId = String(tournament.hostTeamId || '').trim();
    if (!hostTeamId) return false;
    return this._getFriendlyResponsibleTeams(currentUser).some(team => team.id === hostTeamId);
  },
});
