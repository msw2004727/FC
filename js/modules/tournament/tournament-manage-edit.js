/* === SportHub — Tournament Edit Modal & Save Handler === */

Object.assign(App, {

  showEditTournament(id) {
    if (!this.hasPermission('admin.tournaments.manage_all') && !this.hasPermission('admin.tournaments.entry')) { this.showToast('權限不足'); return; }
    const editRecord = this.getFriendlyTournamentRecord?.(ApiService.getTournament(id));
    if (!editRecord) return;
    if (!this._canManageTournamentRecord(editRecord)) {
      this.showToast('你目前只能編輯主辦或受委託的賽事。');
      return;
    }

    this._editTournamentId = id;
    this._ensureTournamentFormLayout('et');
    document.getElementById('et-name').value = editRecord.name || '';
    document.getElementById('et-type').value = 'friendly';
    document.getElementById('et-teams').value = this._getFriendlyTournamentTeamLimit?.(editRecord) || 4;
    document.getElementById('et-region').value = editRecord.region || '';
    document.getElementById('et-reg-start').value = editRecord.regStart || '';
    document.getElementById('et-reg-end').value = editRecord.regEnd || '';
    document.getElementById('et-desc').value = editRecord.description || '';
    document.getElementById('et-desc-count').textContent = `${(editRecord.description || '').length}/500`;
    document.getElementById('et-match-date-picker').value = '';
    document.getElementById('et-venue-input').value = '';
    document.getElementById('et-delegate-search').value = '';
    this._etVenues = [...(editRecord.venues || [])];
    this._etDelegates = [...(editRecord.delegates || [])];
    this._etMatchDates = [...(editRecord.matchDates || [])];
    this._renderVenueTags('et');
    this._renderTournamentDelegateTags('et');
    this._updateTournamentDelegateInput('et');
    this._initTournamentDelegateSearch('et');
    this._renderMatchDateTags('et');
    this._renderTournamentHostTeamOptions('et', editRecord.hostTeamId || '', { locked: !!editRecord.hostTeamId });
    this._setTournamentFeeFormState('et', editRecord.feeEnabled, editRecord.fee || 300);

    const coverPreviewEl = document.getElementById('et-upload-preview');
    if (editRecord.image && coverPreviewEl) {
      // Note: innerHTML usage is safe — image src comes from stored tournament data
      coverPreviewEl.innerHTML = `<img src="${editRecord.image}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`;
      coverPreviewEl.classList.add('has-image');
    } else {
      this._resetTournamentImagePreview('et');
    }

    const contentPreviewEl = document.getElementById('et-content-upload-preview');
    if (editRecord.contentImage && contentPreviewEl) {
      // Note: innerHTML usage is safe — image src comes from stored tournament data
      contentPreviewEl.innerHTML = `<img src="${editRecord.contentImage}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`;
      contentPreviewEl.classList.add('has-image');
    } else {
      this._resetTournamentImagePreview('et', true);
    }

    this.showModal('edit-tournament-modal');
  },

  async handleSaveEditTournament() {
    if (!this.hasPermission('admin.tournaments.manage_all') && !this.hasPermission('admin.tournaments.entry')) { this.showToast('權限不足'); return; }
    const editId = this._editTournamentId;
    const editTournament = this.getFriendlyTournamentRecord?.(ApiService.getTournament(editId));
    if (!editTournament) return;
    if (!this._canManageTournamentRecord(editTournament)) {
      this.showToast('你目前只能編輯主辦或受委託的賽事。');
      return;
    }

    const editName = document.getElementById('et-name').value.trim();
    const editRegion = document.getElementById('et-region').value.trim();
    const editRegStartInput = document.getElementById('et-reg-start').value || '';
    const editRegEnd = document.getElementById('et-reg-end').value || null;
    const editDescription = document.getElementById('et-desc').value.trim();
    const editFeeEnabled = !!document.getElementById('et-fee-enabled')?.checked;
    const editFeeInput = parseInt(document.getElementById('et-fee').value, 10) || 0;
    const editFee = editFeeEnabled ? Math.max(0, editFeeInput) : 0;
    const editTeamLimitRaw = Number(document.getElementById('et-teams')?.value);
    const editTeamLimit = this._getTournamentTeamLimitValue('et', 4);
    const hostTeamId = document.getElementById('et-host-team')?.value || '';
    const hostTeam = ApiService.getTeam?.(hostTeamId);
    if (!editName) {
      this.showToast('請輸入賽事名稱。');
      return;
    }
    if (!hostTeam) {
      this.showToast('請先選擇主辦俱樂部。');
      return;
    }
    if (editTournament.hostTeamId && hostTeam.id !== editTournament.hostTeamId) {
      this.showToast('主辦俱樂部建立後暫不開放更換。');
      return;
    }
    if (!Number.isFinite(editTeamLimitRaw) || editTeamLimitRaw < 2 || editTeamLimitRaw > 4) {
      this.showToast('參賽隊伍數需介於 2 到 4 隊。');
      return;
    }
    if (!editRegEnd) {
      this.showToast('請填寫報名截止時間。');
      return;
    }

    const editRegStart = this._getTournamentImmediateRegStartValue(editRegStartInput);
    if (new Date(editRegStart) >= new Date(editRegEnd)) {
      this.showToast('報名開始時間不能晚於或等於截止時間。');
      return;
    }
    const editVenues = [...this._etVenues];
    const editDelegates = [...this._etDelegates];
    const editMatchDates = [...this._etMatchDates];
    const editCoverPreview = document.getElementById('et-upload-preview');
    const editImage = editCoverPreview?.querySelector('img')?.src || editTournament.image || null;
    const editContentPreview = document.getElementById('et-content-upload-preview');
    const editContentImage = editContentPreview?.querySelector('img')?.src || editTournament.contentImage || null;
    const editUser = ApiService.getCurrentUser?.();
    const editCreatorName = editTournament.creatorName || editTournament.organizer || editUser?.displayName || editUser?.name || '使用者';
    const editUpdates = {
      name: editName,
      type: this._getTournamentModeLabel('friendly'),
      typeCode: 'friendly',
      mode: 'friendly',
      teams: editTeamLimit,
      maxTeams: editTeamLimit,
      teamLimit: editTeamLimit,
      region: editRegion,
      regStart: editRegStart,
      regEnd: editRegEnd,
      description: editDescription,
      matches: 3,
      venues: editVenues,
      delegates: editDelegates,
      delegateUids: editDelegates.map(delegate => String(delegate.uid || '').trim()).filter(uid => uid.length > 0),
      matchDates: editMatchDates,
      image: editImage,
      contentImage: editContentImage,
      feeEnabled: editFeeEnabled,
      fee: editFee,
      organizer: editTournament.organizer || editCreatorName,
      creatorName: editCreatorName,
      hostTeamId: editTournament.hostTeamId || hostTeam.id,
      hostTeamName: editTournament.hostTeamName || hostTeam.name || '',
      hostTeamImage: editTournament.hostTeamImage || hostTeam.image || '',
      organizerDisplay: this._buildTournamentOrganizerDisplay(editTournament.hostTeamName || hostTeam.name, editCreatorName),
      friendlyConfig: {
        teamLimit: editTeamLimit,
        allowMemberSelfJoin: true,
        pendingVisibleToThirdParty: false,
      },
    };

    if (!editTournament.hostTeamId && (!Array.isArray(editTournament.teamEntries) || editTournament.teamEntries.length === 0) && (!Array.isArray(editTournament.registeredTeams) || editTournament.registeredTeams.length === 0)) {
      const hostEntry = this._buildTournamentHostEntry(hostTeam, editUser);
      if (hostEntry) {
        editUpdates.teamEntries = [hostEntry];
        editUpdates.registeredTeams = [hostTeam.id];
      }
    }

    editUpdates.status = this.getTournamentStatus({ ...editTournament, ...editUpdates });
    try {
      await ApiService.updateTournamentAwait(editId, editUpdates);
    } catch (err) {
      this._showTournamentActionError?.('更新賽事', err);
      return;
    }
    ApiService._writeOpLog('tourn_edit', '編輯賽事', `更新「${editName}」`);
    this._editTournamentId = null;
    this.renderTournamentTimeline();
    this.renderOngoingTournaments();
    this.renderTournamentManage();
    this.closeModal();
    this.showToast(`賽事「${editName}」已更新。`);
  },

});
