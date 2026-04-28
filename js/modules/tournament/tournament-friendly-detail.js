/* ================================================
   SportHub Tournament Friendly Detail
   Phase 4 §10.3 瘦身：狀態管理→tournament-friendly-state.js
   本檔只留渲染 + 使用者操作（showTournamentDetail / registerTournament / reviewFriendlyTournamentApplication）
   ================================================ */

const _tournamentFriendlyDetailLegacy = {
  showTournamentDetail: App.showTournamentDetail,
  renderRegisterButton: App.renderRegisterButton,
  registerTournament: App.registerTournament,
  renderTournamentTab: App.renderTournamentTab,
};

Object.assign(App, {

  _friendlyTournamentDetailStateById: {},
  _friendlyTournamentDetailSeq: 0,
  _friendlyTournamentApplyBusyById: {},
  _friendlyTournamentReviewBusyById: {},
  _friendlyTournamentEntryRemoveBusyById: {},

  _isFriendlyTournamentRecord(record) {
    return (this._getTournamentMode?.(record) || 'friendly') === 'friendly';
  },

  _getFriendlyTournamentState(id = this.currentTournament) {
    return id ? (this._friendlyTournamentDetailStateById[id] || null) : null;
  },

  async showTournamentDetail(id, options) {
    let base = ApiService.getTournament?.(id);
    // 快取 miss → 單筆查詢 Firestore（Phase 2A §7.4）
    if (!base) base = await ApiService.getTournamentAsync?.(id);
    if (!base || !this._isFriendlyTournamentRecord(base)) {
      return await _tournamentFriendlyDetailLegacy.showTournamentDetail.call(this, id, options);
    }
    if (!(options && options.allowGuest) && this._requireLogin()) return;

    const seq = ++this._friendlyTournamentDetailSeq;
    const statePromise = this._loadFriendlyTournamentDetailState(id);
    this.currentTournament = id;
    await this.showPage('page-tournament-detail');
    if (seq !== this._friendlyTournamentDetailSeq || this.currentPage !== 'page-tournament-detail') return;

    const state = await statePromise;
    if (!state || seq !== this._friendlyTournamentDetailSeq || this.currentPage !== 'page-tournament-detail') return;
    const tournament = state.tournament;
    this._syncTournamentDetailRoute?.(id);

    const img = document.getElementById('td-img-placeholder');
    if (img) {
      if (tournament.image) {
        img.innerHTML = `<img src="${tournament.image}" alt="${escapeHTML(tournament.name)}" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:var(--radius)">`;
        img.style.border = 'none';
      } else {
        img.textContent = '賽事封面 800 x 300';
        img.style.border = '';
      }
    }

    const title = document.getElementById('td-title');
    if (title) {
      title.innerHTML = escapeHTML(tournament.name) + ' ' + this._favHeartHtml(this.isTournamentFavorited(id), 'Tournament', id);
    }

    this.renderRegisterButton(tournament);
    this.renderTournamentInfo(tournament);

    document.querySelectorAll('#td-tabs .tab').forEach(tab => {
      tab.onclick = () => {
        document.querySelectorAll('#td-tabs .tab').forEach(node => node.classList.remove('active'));
        tab.classList.add('active');
        this.renderTournamentTab(tab.dataset.ttab);
      };
    });
    document.querySelectorAll('#td-tabs .tab').forEach(node => node.classList.toggle('active', node.dataset.ttab === 'info'));
    this.renderTournamentTab('info');
  },

  async registerTournament(id) {
    // 2026-04-19 UX：寫入類動作必須先補齊個人資料
    if (this._requireProfileComplete()) return;
    const tournament = ApiService.getFriendlyTournamentRecord?.(id) || ApiService.getTournament?.(id);
    if (!tournament || !this._isFriendlyTournamentRecord(tournament)) {
      return _tournamentFriendlyDetailLegacy.registerTournament.call(this, id);
    }

    const user = ApiService.getCurrentUser?.();
    if (!user?.uid) {
      this.showToast('請先登入');
      return;
    }

    const busyId = String(id || '').trim();
    if (this._friendlyTournamentApplyBusyById[busyId]) return;
    this._friendlyTournamentApplyBusyById[busyId] = true;

    try {
      const state = await this._loadFriendlyTournamentDetailState(id);
    if (!state) { this.showToast('無法載入賽事資料'); return; }
    const latestTournament = state.tournament || tournament;
    const ctx = this._getFriendlyTournamentApplyContext(latestTournament, state, user);
    const approvedCount = (state.entries || []).filter(entry => entry.entryStatus === 'host' || entry.entryStatus === 'approved').length;
    const teamLimit = this._getFriendlyTournamentTeamLimit?.(latestTournament) || 4;

    if (this.getTournamentStatus(latestTournament) !== TOURNAMENT_STATUS.REG_OPEN) {
      this.showToast('目前尚未開放報名');
      return;
    }
    if (approvedCount >= teamLimit) {
      this.showToast('隊伍名額已滿');
      return;
    }
    if (ctx.availableTeams.length === 0) {
      const message = ctx.pendingTeams.length > 0
        ? '你的俱樂部申請已送出，等待主辦審核。'
        : ctx.approvedTeams.length > 0
          ? '你的俱樂部已通過審核。'
          : '需由俱樂部領隊或經理先行報名參賽。';
      this.showToast(message);
      return;
    }

    const selectedTeamId = document.getElementById('td-apply-team-select')?.value || ctx.availableTeams[0].id;
    const selectedTeam = ctx.availableTeams.find(team => team.id === selectedTeamId);
    if (!selectedTeam) {
      this.showToast('請先選擇要報名的俱樂部。');
      return;
    }

    await ApiService.applyFriendlyTournamentAtomic(id, selectedTeam.id);

    await this._loadFriendlyTournamentDetailState(id);
    this.renderRegisterButton(this._getFriendlyTournamentState(id)?.tournament || latestTournament);
    this.renderTournamentTab('teams');
    this.showToast(`已送出「${selectedTeam.name}」的參賽申請。`);
    } catch (err) {
      this._showTournamentActionError?.('報名賽事', err);
    }
    finally {
      delete this._friendlyTournamentApplyBusyById[busyId];
    }
  },

  async reviewFriendlyTournamentApplication(tournamentId, applicationId, action) {
    const normalizedAction = String(action || '').trim().toLowerCase();
    if (!['approve', 'reject'].includes(normalizedAction)) {
      this.showToast('未知的審核操作');
      return;
    }
    const busyKey = `${String(tournamentId || '').trim()}:${String(applicationId || '').trim()}:${normalizedAction}`;
    if (this._friendlyTournamentReviewBusyById[busyKey]) return;
    this._friendlyTournamentReviewBusyById[busyKey] = true;

    try {
      const state = await this._loadFriendlyTournamentDetailState(tournamentId);
      const tournament = state?.tournament || await ApiService.getTournamentAsync?.(tournamentId);
      if (!tournament) {
        this.showToast('找不到此賽事。');
        return;
      }
      if (!this._isTournamentGlobalAdmin() && !this._canManageTournamentRecord?.(tournament)) {
        this.showToast('你目前只能審核主辦或受委託的賽事。');
        return;
      }

      const application = (state.applications || []).find(item => item.id === applicationId);
      if (!application || application.status !== 'pending') {
        this.showToast('找不到待審核的申請。');
        return;
      }

      if (normalizedAction === 'reject' && !(await this.appConfirm(`確定要拒絕「${application.teamName}」的報名申請？`))) return;

      const result = await ApiService.reviewFriendlyTournamentApplicationAtomic(tournamentId, applicationId, normalizedAction);
      const nextState = await this._loadFriendlyTournamentDetailState(tournamentId);
      this.renderRegisterButton(nextState?.tournament || tournament);
      this.renderTournamentTab('teams');
      this.showToast(result?.alreadyReviewed
        ? '此申請已被處理過。'
        : (normalizedAction === 'approve' ? `已確認「${application.teamName}」參賽。` : `已拒絕「${application.teamName}」的申請。`));
    } catch (err) {
      this._showTournamentActionError?.(normalizedAction === 'approve' ? '確認報名' : '拒絕報名', err);
    }
    finally {
      delete this._friendlyTournamentReviewBusyById[busyKey];
    }
  },

  async removeFriendlyTournamentEntry(tournamentId, teamId) {
    const safeTournamentId = String(tournamentId || '').trim();
    const safeTeamId = String(teamId || '').trim();
    if (!safeTournamentId || !safeTeamId) {
      this.showToast('缺少賽事或俱樂部資料');
      return;
    }

    const busyKey = `${safeTournamentId}:${safeTeamId}`;
    if (this._friendlyTournamentEntryRemoveBusyById[busyKey]) return;
    this._friendlyTournamentEntryRemoveBusyById[busyKey] = true;

    try {
      const state = await this._loadFriendlyTournamentDetailState(safeTournamentId);
      const tournament = state?.tournament || await ApiService.getTournamentAsync?.(safeTournamentId);
      const entry = (state?.entries || []).find(item => item.teamId === safeTeamId);
      if (!tournament || !this._isFriendlyTournamentRecord?.(tournament)) {
        this.showToast('找不到賽事資料');
        return;
      }
      if (!this._isTournamentGlobalAdmin() && !this._canManageTournamentRecord?.(tournament)) {
        this.showToast('你沒有管理此賽事的權限');
        return;
      }
      if (!entry || entry.entryStatus === 'host') {
        this.showToast('主辦俱樂部不能從賽事中剔除');
        return;
      }

      const teamName = entry.teamName || '此俱樂部';
      if (!(await this.appConfirm(`確定要將「${teamName}」從此賽事中剔除嗎？該隊球員名單也會一併移除。`))) return;

      await ApiService.removeFriendlyTournamentEntryAtomic(safeTournamentId, safeTeamId);
      const nextState = await this._loadFriendlyTournamentDetailState(safeTournamentId);
      this.renderRegisterButton(nextState?.tournament || tournament);
      this.renderTournamentTab('teams');
      this.showToast(`已剔除「${teamName}」。`);
    } catch (err) {
      this._showTournamentActionError?.('剔除參賽俱樂部', err);
    }
    finally {
      delete this._friendlyTournamentEntryRemoveBusyById[busyKey];
    }
  },

});
