/* ================================================
   SportHub Tournament Core
   Shared helpers for public tournament pages and
   the upcoming friendly/cup/league refactor.
   ================================================ */

// Tournament status constants (used for logic comparisons — do NOT i18n these)
const TOURNAMENT_STATUS = {
  PREPARING: '\u5373\u5c07\u958b\u59cb',
  REG_OPEN: '\u5831\u540d\u4e2d',
  REG_CLOSED: '\u5df2\u622a\u6b62\u5831\u540d',
  ENDED: '\u5df2\u7d50\u675f',
  REG_CLOSED_ALT: '\u622a\u6b62\u5831\u540d',
};

Object.assign(App, {

  getTournamentStatus(t) {
    if (!t || !t.regStart || !t.regEnd) return (t && t.status) || TOURNAMENT_STATUS.PREPARING;
    const now = new Date();
    const start = new Date(t.regStart);
    const end = new Date(t.regEnd);
    if (now < start) return TOURNAMENT_STATUS.PREPARING;
    if (now >= start && now <= end) return TOURNAMENT_STATUS.REG_OPEN;
    return TOURNAMENT_STATUS.REG_CLOSED;
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
    return this._sanitizeFriendlyTournamentTeamLimit(limit);
  },

  _sanitizeFriendlyTournamentTeamLimit(value, fallback = 4) {
    const limit = Number(value);
    if (!Number.isFinite(limit)) return fallback;
    return Math.min(4, Math.max(2, Math.floor(limit)));
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

  // _resolveTournamentOrganizerUser → 已移至 tournament-helpers.js

  contactTournamentOrganizer(tournamentId) {
    const rawTournament = ApiService.getTournament?.(tournamentId);
    const tournament = this.getFriendlyTournamentRecord?.(rawTournament) || rawTournament;
    if (!tournament) {
      this.showToast?.('暫時找不到主辦人資料。');
      return;
    }

    const organizerUser = this._resolveTournamentOrganizerUser(tournament);
    const lineId = String(organizerUser?.socialLinks?.line || '').trim();
    if (lineId) {
      window.open(`https://line.me/ti/p/${encodeURIComponent(lineId)}`, 'sporthub_line', 'noopener');
      return;
    }

    const profileName = String(
      organizerUser?.name ||
      organizerUser?.displayName ||
      tournament.creatorName ||
      tournament.organizer ||
      ''
    ).trim();

    if (profileName) {
      this.showUserProfile(profileName);
      return;
    }

    this.showToast?.('暫時找不到主辦人資料。');
  },

  // _normalizeTournamentDelegates → 已移至 tournament-helpers.js
  // _getTournamentDelegateUids → 已移至 tournament-helpers.js
  // _isTournamentLeaderForTeam → 已移至 tournament-helpers.js
  // _isTournamentCaptainForTeam → 已移至 tournament-helpers.js
  // _getFriendlyResponsibleTeams → 已移至 tournament-helpers.js
  // _canCreateFriendlyTournament → 已移至 tournament-helpers.js
  // _isTournamentDelegate → 已移至 tournament-helpers.js
  // _canManageTournamentRecord → 已移至 tournament-helpers.js

  _buildFriendlyTournamentApplicationRecord(data = {}) {
    const id = String(data.id || data._docId || data.teamId || '').trim();
    const requestedByUid = String(data.requestedByUid || data.creatorUid || '').trim();
    const requestedByName = String(data.requestedByName || data.creatorName || '').trim();
    return {
      id,
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
    const registeredTeams = Array.isArray(base.registeredTeams)
      ? base.registeredTeams
          .map(teamId => String(teamId || '').trim())
          .filter(Boolean)
      : [];

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
      registeredTeams,
    };
  },

  // 賽事中心「建立賽事」按鈕（需在 eager 模組，不能放 tournamentAdmin 群組）
  _refreshTournamentCenterCreateButton() {
    const header = document.querySelector('#page-tournaments .page-header');
    if (!header) return;
    let button = document.getElementById('tournament-open-create-btn');
    if (!button) {
      button = document.createElement('button');
      button.id = 'tournament-open-create-btn';
      button.className = 'primary-btn small';
      button.textContent = '建立賽事';
      button.onclick = () => this.openCreateTournamentModal?.();
      header.appendChild(button);
    }
    button.style.display = this._canCreateFriendlyTournament() ? '' : 'none';
  },
});
