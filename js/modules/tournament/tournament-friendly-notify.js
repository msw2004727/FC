/* ================================================
   SportHub Tournament Friendly Notify
   Friendly-only inbox notification hooks.
   ================================================ */

const _tournamentFriendlyNotifyLegacy = {
  handleCreateTournament: App.handleCreateTournament,
  registerTournament: App.registerTournament,
  reviewFriendlyTournamentApplication: App.reviewFriendlyTournamentApplication,
};

Object.assign(App, {

  _getFriendlyTournamentTeamRecipientUids(teamId, options = {}) {
    const safeTeamId = String(teamId || '').trim();
    if (!safeTeamId) return [];
    const team = ApiService.getTeam?.(safeTeamId);
    const excluded = new Set((options.excludeUids || []).map(uid => String(uid || '').trim()).filter(Boolean));
    const source = [...(ApiService.getAdminUsers?.() || [])];
    const currentUser = ApiService.getCurrentUser?.();
    if (currentUser?.uid && !source.some(user => user?.uid === currentUser.uid)) source.push(currentUser);

    const recipients = new Set();
    source.forEach(user => {
      const uid = String(user?.uid || '').trim();
      if (!uid || excluded.has(uid)) return;
      const userName = String(user?.displayName || user?.name || '').trim();
      const inTeam = (typeof this._isUserInTeam === 'function' && this._isUserInTeam(user, safeTeamId))
        || this._isTournamentCaptainForTeam?.(team, user)
        || this._isTournamentLeaderForTeam?.(team, user)
        || (!!team && Array.isArray(team.coaches) && team.coaches.includes(userName));
      if (inTeam) recipients.add(uid);
    });
    return [...recipients];
  },

  _buildFriendlyTournamentNotifVars(tournament, extra = {}) {
    const safeTournament = tournament || {};
    return {
      tournamentName: String(safeTournament.name || '').trim() || '未命名賽事',
      hostTeamName: String(safeTournament.hostTeamName || '').trim() || '主辦球隊',
      teamName: String(extra.teamName || '').trim(),
      creatorName: String(extra.creatorName || safeTournament.creatorName || safeTournament.organizer || '').trim() || '主辦人',
      applicantName: String(extra.applicantName || '').trim() || '申請人',
      reviewerName: String(extra.reviewerName || '').trim() || '主辦人',
      regEnd: String(extra.regEnd || safeTournament.regEnd || '').trim().replace('T', ' '),
    };
  },

  _buildFriendlyTournamentNotifExtra(tournament, extra = {}) {
    const safeTournament = tournament || {};
    return {
      tournamentId: String(safeTournament.id || '').trim(),
      tournamentName: String(safeTournament.name || '').trim(),
      hostTeamId: String(safeTournament.hostTeamId || '').trim(),
      hostTeamName: String(safeTournament.hostTeamName || '').trim(),
      teamId: String(extra.teamId || '').trim(),
      teamName: String(extra.teamName || '').trim(),
      applicationId: String(extra.applicationId || '').trim(),
      messageGroupId: String(extra.messageGroupId || '').trim(),
      actionType: 'tournament_friendly_application',
      actionStatus: String(extra.actionStatus || '').trim(),
      linkType: 'tournament',
    };
  },

  _sendFriendlyTournamentTemplate(key, tournament, targetUid, extra = {}) {
    const safeTargetUid = String(targetUid || '').trim();
    if (!safeTargetUid || typeof this._sendNotifFromTemplate !== 'function') return;
    this._sendNotifFromTemplate(
      key,
      this._buildFriendlyTournamentNotifVars(tournament, extra),
      safeTargetUid,
      'tournament',
      '賽事',
      this._buildFriendlyTournamentNotifExtra(tournament, extra),
      { lineCategory: 'tournament', lineOptions: { source: `template:${key}` } }
    );
  },

  _notifyFriendlyTournamentHostOpened(tournament) {
    if (!tournament?.hostTeamId) return;
    this._getFriendlyTournamentTeamRecipientUids(tournament.hostTeamId).forEach(uid => {
      this._sendFriendlyTournamentTemplate('tournament_friendly_host_opened', tournament, uid, {
        teamId: tournament.hostTeamId,
        teamName: tournament.hostTeamName || '',
        actionStatus: 'opened',
      });
    });
  },

  _notifyFriendlyTournamentApplicationSubmitted(tournament, application) {
    if (!tournament || !application) return;
    const notifyUids = new Set();
    if (tournament.creatorUid) notifyUids.add(tournament.creatorUid);
    (tournament.delegates || []).forEach(delegate => {
      if (delegate?.uid) notifyUids.add(delegate.uid);
    });
    notifyUids.forEach(uid => {
      this._sendFriendlyTournamentTemplate('tournament_friendly_team_apply_host', tournament, uid, {
        teamId: application.teamId,
        teamName: application.teamName || '',
        applicantName: application.requestedByName || '',
        applicationId: application.id || '',
        messageGroupId: application.messageGroupId || '',
        actionStatus: 'pending',
      });
    });
  },

  _notifyFriendlyTournamentApplicationReviewed(tournament, application, action) {
    if (!tournament || !application) return;
    const reviewedExtra = {
      teamId: application.teamId,
      teamName: application.teamName || '',
      applicantName: application.requestedByName || '',
      reviewerName: application.reviewedByName || '',
      applicationId: application.id || '',
      messageGroupId: application.messageGroupId || '',
      actionStatus: action === 'approve' ? 'approved' : 'rejected',
    };

    if (application.requestedByUid) {
      this._sendFriendlyTournamentTemplate(
        action === 'approve'
          ? 'tournament_friendly_team_approved_applicant'
          : 'tournament_friendly_team_rejected_applicant',
        tournament,
        application.requestedByUid,
        reviewedExtra
      );
    }

    if (action !== 'approve') return;
    this._getFriendlyTournamentTeamRecipientUids(application.teamId, {
      excludeUids: application.requestedByUid ? [application.requestedByUid] : [],
    }).forEach(uid => {
      this._sendFriendlyTournamentTemplate('tournament_friendly_team_approved_broadcast', tournament, uid, reviewedExtra);
    });
  },

  async handleCreateTournament(...args) {
    const beforeIds = new Set((ApiService.getTournaments?.() || []).map(item => item?.id).filter(Boolean));
    const result = await _tournamentFriendlyNotifyLegacy.handleCreateTournament.apply(this, args);
    const createdTournament = (ApiService.getTournaments?.() || []).find(item => item?.id && !beforeIds.has(item.id));
    const friendlyTournament = ApiService.getFriendlyTournamentRecord?.(createdTournament);
    if (friendlyTournament && this._isFriendlyTournamentRecord?.(friendlyTournament)) {
      this._notifyFriendlyTournamentHostOpened(friendlyTournament);
    }
    return result;
  },

  async registerTournament(...args) {
    const tournamentId = String(args[0] || '').trim();
    const beforeState = tournamentId ? await this._loadFriendlyTournamentDetailState?.(tournamentId) : null;
    const beforeIds = new Set((beforeState?.applications || []).map(item => item.id).filter(Boolean));
    const result = await _tournamentFriendlyNotifyLegacy.registerTournament.apply(this, args);
    const afterState = tournamentId ? (this._getFriendlyTournamentState?.(tournamentId) || await this._loadFriendlyTournamentDetailState?.(tournamentId)) : null;
    const tournament = afterState?.tournament;
    if (!tournament || !this._isFriendlyTournamentRecord?.(tournament)) return result;
    const createdApplication = (afterState?.applications || []).find(item => item.id && !beforeIds.has(item.id));
    if (createdApplication) this._notifyFriendlyTournamentApplicationSubmitted(tournament, createdApplication);
    return result;
  },

  async reviewFriendlyTournamentApplication(...args) {
    const tournamentId = String(args[0] || '').trim();
    const applicationId = String(args[1] || '').trim();
    const action = String(args[2] || '').trim().toLowerCase();
    const beforeState = tournamentId ? await this._loadFriendlyTournamentDetailState?.(tournamentId) : null;
    const beforeApplication = (beforeState?.applications || []).find(item => item.id === applicationId);
    const result = await _tournamentFriendlyNotifyLegacy.reviewFriendlyTournamentApplication.apply(this, args);
    const afterState = tournamentId ? (this._getFriendlyTournamentState?.(tournamentId) || await this._loadFriendlyTournamentDetailState?.(tournamentId)) : null;
    const tournament = afterState?.tournament;
    const afterApplication = (afterState?.applications || []).find(item => item.id === applicationId);
    if (
      tournament
      && this._isFriendlyTournamentRecord?.(tournament)
      && beforeApplication?.status === 'pending'
      && afterApplication
      && afterApplication.status !== beforeApplication.status
      && ['approve', 'reject'].includes(action)
    ) {
      this._notifyFriendlyTournamentApplicationReviewed(tournament, afterApplication, action);
    }
    return result;
  },
});
