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
    const rawMode = String(t?.mode || t?.typeCode || t?.type || 'friendly').trim().toLowerCase();
    if (rawMode === 'cup' || rawMode.includes('\u76c3') || rawMode.includes('\u676f')) return 'cup';
    if (rawMode === 'league' || rawMode.includes('\u806f\u8cfd') || rawMode.includes('\u8054\u8d5b')) return 'league';
    if (rawMode === 'friendly' || rawMode.includes('\u53cb\u8abc')) return 'friendly';
    return ['friendly', 'cup', 'league'].includes(rawMode) ? rawMode : 'friendly';
  },

  _getFriendlyTournamentTeamLimit(t) {
    const limit = Number(t?.friendlyConfig?.teamLimit ?? t?.teamLimit ?? t?.maxTeams ?? t?.teams ?? 4);
    return Number.isFinite(limit) && limit > 0 ? limit : 4;
  },

  _getTournamentModeLabel(modeOrRecord = 'friendly') {
    const mode = typeof modeOrRecord === 'string'
      ? this._getTournamentMode({ mode: modeOrRecord })
      : this._getTournamentMode(modeOrRecord);
    const labelMap = {
      friendly: '\u53cb\u8abc\u8cfd',
      cup: '\u76c3\u8cfd',
      league: '\u806f\u8cfd',
    };
    return labelMap[mode] || labelMap.friendly;
  },

  _buildTournamentOrganizerDisplay(teamName, userName) {
    const safeTeamName = String(teamName || '').trim();
    const safeUserName = String(userName || '').trim();
    if (safeTeamName && safeUserName) return `${safeTeamName}\uFF08${safeUserName}\uFF09`;
    return safeTeamName || safeUserName || '\u4e3b\u8fa6\u7403\u968a';
  },

  _showTournamentActionError(actionLabel, err) {
    console.error(`[Tournament:${actionLabel}]`, err);
    const raw = `${err?.code || ''} ${err?.message || err || ''}`.toLowerCase();
    if (raw.includes('permission') || raw.includes('unauth')) {
      this.showToast?.(`${actionLabel}失敗，請重新登入或確認權限。`);
      return;
    }
    this.showToast?.(`${actionLabel}失敗，請稍後再試。`);
  },

  _getTournamentOrganizerDisplayText(tournament) {
    if (!tournament) return '\u4e3b\u8fa6\u7403\u968a';
    const direct = String(tournament.organizerDisplay || '').trim();
    if (direct) return direct;
    const teamName = String(tournament.hostTeamName || '').trim();
    const userName = String(tournament.organizer || tournament.creatorName || '').trim();
    return this._buildTournamentOrganizerDisplay(teamName, userName);
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

  _buildFriendlyTournamentApplicationRecord(data = {}) {
    const requestedByUid = String(data.requestedByUid || data.creatorUid || '').trim();
    const requestedByName = String(data.requestedByName || data.creatorName || '').trim();
    return {
      id: String(data.id || '').trim(),
      teamId: String(data.teamId || '').trim(),
      teamName: String(data.teamName || '').trim(),
      teamImage: String(data.teamImage || '').trim(),
      status: String(data.status || 'pending').trim().toLowerCase(),
      requestedByUid,
      requestedByName,
      appliedAt: data.appliedAt || null,
      reviewedAt: data.reviewedAt || null,
      reviewedByUid: String(data.reviewedByUid || '').trim(),
      reviewedByName: String(data.reviewedByName || '').trim(),
      messageGroupId: String(data.messageGroupId || '').trim(),
    };
  },

  _buildFriendlyTournamentRosterMemberRecord(data = {}) {
    return {
      uid: String(data.uid || '').trim(),
      name: String(data.name || data.displayName || '').trim(),
      joinedAt: data.joinedAt || null,
    };
  },

  _buildFriendlyTournamentEntryRecord(data = {}) {
    const memberRoster = Array.isArray(data.memberRoster)
      ? data.memberRoster
          .map(member => this._buildFriendlyTournamentRosterMemberRecord(member))
          .filter(member => member.uid)
      : [];
    return {
      teamId: String(data.teamId || '').trim(),
      teamName: String(data.teamName || '').trim(),
      teamImage: String(data.teamImage || '').trim(),
      entryStatus: String(data.entryStatus || 'approved').trim().toLowerCase(),
      approvedAt: data.approvedAt || null,
      approvedByUid: String(data.approvedByUid || '').trim(),
      approvedByName: String(data.approvedByName || '').trim(),
      memberRoster,
    };
  },

  _buildFriendlyTournamentRecord(data = {}) {
    const base = data && typeof data === 'object' ? data : {};
    const mode = this._getTournamentMode(base);
    const delegates = this._normalizeTournamentDelegates(base.delegates);
    const delegateUids = this._getTournamentDelegateUids({ ...base, delegates });
    const teamLimit = this._getFriendlyTournamentTeamLimit(base);
    const feeEnabled = typeof base.feeEnabled === 'boolean'
      ? base.feeEnabled
      : Number(base.fee || 0) > 0;
    const fee = feeEnabled ? Math.max(0, Number(base.fee || 0) || 0) : 0;
    const creatorName = String(base.creatorName || base.organizer || '').trim();
    const hostTeamName = String(base.hostTeamName || '').trim();
    const teamEntries = Array.isArray(base.teamEntries)
      ? base.teamEntries
          .map(entry => this._buildFriendlyTournamentEntryRecord(entry))
          .filter(entry => entry.teamId)
      : [];
    const teamApplications = Array.isArray(base.teamApplications)
      ? base.teamApplications
          .map(application => this._buildFriendlyTournamentApplicationRecord(application))
          .filter(application => application.teamId)
      : [];
    const registeredTeams = Array.isArray(base.registeredTeams) && base.registeredTeams.length > 0
      ? base.registeredTeams
          .map(teamId => String(teamId || '').trim())
          .filter(Boolean)
      : teamEntries
          .filter(entry => entry.entryStatus === 'host' || entry.entryStatus === 'approved')
          .map(entry => entry.teamId);

    return {
      ...base,
      mode,
      schemaVersion: Math.max(2, Number(base.schemaVersion || 0) || 0),
      dataModel: String(base.dataModel || 'tournament_v2').trim(),
      creatorUid: String(base.creatorUid || '').trim(),
      creatorName,
      hostTeamId: String(base.hostTeamId || '').trim(),
      hostTeamName,
      hostTeamImage: String(base.hostTeamImage || '').trim(),
      organizerDisplay: String(base.organizerDisplay || '').trim() || this._buildTournamentOrganizerDisplay(hostTeamName, creatorName),
      delegates,
      delegateUids,
      feeEnabled,
      fee,
      teams: Number(base.teams || 0) || teamLimit,
      maxTeams: Number(base.maxTeams || 0) || teamLimit,
      friendlyConfig: {
        teamLimit,
        allowMemberSelfJoin: base?.friendlyConfig?.allowMemberSelfJoin !== false,
        pendingVisibleToThirdParty: base?.friendlyConfig?.pendingVisibleToThirdParty === true,
      },
      teamApplications,
      teamEntries,
      registeredTeams,
    };
  },
});
