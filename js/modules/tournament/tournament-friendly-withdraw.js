/* ================================================
   SportHub Tournament Friendly Withdrawal
   Applicant-side team application / entry withdrawal.
   ================================================ */

Object.assign(App, {

  _friendlyTournamentWithdrawBusyById: {},

  async withdrawFriendlyTournamentTeam(tournamentId, teamId, actionButton = null) {
    const safeTournamentId = String(tournamentId || '').trim();
    const safeTeamId = String(teamId || '').trim();
    if (!safeTournamentId || !safeTeamId) {
      this.showToast('缺少賽事或俱樂部資料');
      return;
    }

    const busyKey = `${safeTournamentId}:${safeTeamId}`;
    if (this._friendlyTournamentWithdrawBusyById[busyKey]) return;
    this._friendlyTournamentWithdrawBusyById[busyKey] = true;

    try {
      const state = await this._loadFriendlyTournamentDetailState(safeTournamentId);
      const tournament = state?.tournament || await ApiService.getTournamentAsync?.(safeTournamentId);
      if (!tournament || !this._isFriendlyTournamentRecord?.(tournament)) {
        this.showToast('找不到賽事資料');
        return;
      }
      if (String(tournament.hostTeamId || '').trim() === safeTeamId) {
        this.showToast('主辦俱樂部不能退出自己的賽事');
        return;
      }
      if (this.isTournamentEnded?.(tournament)) {
        this.showToast('賽事已結束，無法退出');
        return;
      }

      const user = ApiService.getCurrentUser?.();
      const team = ApiService.getTeam?.(safeTeamId);
      if (!this._isTournamentGlobalAdmin?.(user) && !this._isTournamentTeamOfficerForTeam?.(team, user)) {
        this.showToast('需由該俱樂部領隊或經理操作退出賽事。');
        return;
      }

      const entry = (state?.entries || []).find(item => item.teamId === safeTeamId);
      const application = (state?.applications || []).find(item => item.teamId === safeTeamId);
      if (!entry && !application) {
        this.showToast('找不到此俱樂部的參賽申請。');
        return;
      }
      const applicationStatus = String(application?.status || '').trim().toLowerCase();
      const isPendingApplication = !entry && applicationStatus === 'pending';
      const isApprovedApplicationWithoutEntry = !entry && applicationStatus === 'approved';
      if (!entry && !isPendingApplication && !isApprovedApplicationWithoutEntry) {
        this.showToast('目前沒有可撤回或退出的參賽狀態。');
        return;
      }

      const teamName = entry?.teamName || application?.teamName || team?.name || '此俱樂部';
      const isApprovedEntry = !!entry && (entry.entryStatus === 'approved' || entry.entryStatus === 'host');
      const shouldWithdrawApproved = isApprovedEntry || isApprovedApplicationWithoutEntry;
      const confirmText = shouldWithdrawApproved
        ? `確定讓「${teamName}」退出此賽事嗎？該隊球員名單也會一併移除。`
        : `確定撤回「${teamName}」的參賽申請嗎？`;
      if (!(await this.appConfirm(confirmText))) return;

      const withdraw = async () => {
        const result = await ApiService.withdrawFriendlyTournamentTeamAtomic(safeTournamentId, safeTeamId);
        const nextState = await this._loadFriendlyTournamentDetailState(safeTournamentId);
        this.renderRegisterButton(nextState?.tournament || tournament);
        this.renderTournamentTab('teams');
        this.showToast(result?.status === 'withdrawn'
          ? `「${teamName}」已退出賽事。`
          : `已撤回「${teamName}」的參賽申請。`);
      };

      if (typeof this._withButtonLoading === 'function') {
        await this._withButtonLoading(actionButton, shouldWithdrawApproved ? '退出中...' : '撤回中...', withdraw);
      } else {
        await withdraw();
      }
    } catch (err) {
      this._showTournamentActionError?.('退出賽事', err);
    }
    finally {
      delete this._friendlyTournamentWithdrawBusyById[busyKey];
    }
  },

});
