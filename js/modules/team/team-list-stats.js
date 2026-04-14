/* ================================================
   SportHub — Team: Member Count & Ranking (Pure Calculations)
   唯一真相來源：成員計數只在此檔案實作。
   從 team-list.js 抽出。
   依賴：config.js, api-service.js, team-list-helpers.js
   ================================================ */

Object.assign(App, {

  _calcTeamMemberCountByTeam(team, users = ApiService.getAdminUsers() || []) {
    if (!team || !team.id) return 0;
    const uniqueIdentities = new Set();
    const staffIdentity = this._buildTeamStaffIdentity(team, users);
    staffIdentity.keys.forEach(key => uniqueIdentities.add(key));

    users.forEach(user => {
      if (!this._isUserInTeam(user, team.id)) return;
      const key = this._getUserIdentityKey(user);
      if (key) uniqueIdentities.add(key);
    });

    return uniqueIdentities.size;
  },

  _calcTeamMemberCount(teamId) {
    const team = ApiService.getTeam(teamId);
    if (!team) return 0;
    const users = ApiService.getAdminUsers() || [];
    return this._calcTeamMemberCountByTeam(team, users);
  },

  _getTeamRank(teamExp) {
    const exp = teamExp || 0;
    for (let i = TEAM_RANK_CONFIG.length - 1; i >= 0; i--) {
      const cfg = TEAM_RANK_CONFIG[i];
      if (exp >= cfg.min) return { rank: cfg.rank, color: cfg.color };
    }
    return { rank: 'E', color: '#6b7280' };
  },

  _sortTeams(teams) {
    return [...teams].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      if (a.pinned && b.pinned) return (a.pinOrder || 0) - (b.pinOrder || 0);
      return (a.name || '').localeCompare(b.name || '');
    });
  },

});
