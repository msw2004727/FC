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
    this._ensureTournamentFormLayout('tf');
    document.getElementById('tf-name').value = editRecord.name || '';
    document.getElementById('tf-type').value = 'friendly';
    document.getElementById('tf-teams').value = this._getFriendlyTournamentTeamLimit?.(editRecord) || 4;
    document.getElementById('tf-region').value = editRecord.region || '';
    document.getElementById('tf-reg-start').value = editRecord.regStart || '';
    document.getElementById('tf-reg-end').value = editRecord.regEnd || '';
    document.getElementById('tf-desc').value = editRecord.description || '';
    document.getElementById('tf-desc-count').textContent = `${(editRecord.description || '').length}/500`;
    document.getElementById('tf-match-date-picker').value = '';
    document.getElementById('tf-venue-input').value = '';
    document.getElementById('tf-delegate-search').value = '';
    this._tfVenues = [...(editRecord.venues || [])];
    this._tfDelegates = [...(editRecord.delegates || [])];
    this._tfMatchDates = [...(editRecord.matchDates || [])];
    this._renderVenueTags('tf');
    this._renderTournamentDelegateTags('tf');
    this._updateTournamentDelegateInput('tf');
    this._initTournamentDelegateSearch('tf');
    this._renderMatchDateTags('tf');
    this._renderTournamentHostTeamOptions('tf', editRecord.hostTeamId || '', { locked: !!editRecord.hostTeamId });
    this._setTournamentFeeFormState('tf', editRecord.feeEnabled, editRecord.fee || 300);

    const coverPreviewEl = document.getElementById('tf-upload-preview');
    if (editRecord.image && coverPreviewEl) {
      // Note: innerHTML usage is safe — image src comes from stored tournament data
      coverPreviewEl.innerHTML = `<img src="${editRecord.image}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`;
      coverPreviewEl.classList.add('has-image');
    } else {
      this._resetTournamentImagePreview('tf');
    }

    const contentPreviewEl = document.getElementById('tf-content-upload-preview');
    if (editRecord.contentImage && contentPreviewEl) {
      // Note: innerHTML usage is safe — image src comes from stored tournament data
      contentPreviewEl.innerHTML = `<img src="${editRecord.contentImage}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`;
      contentPreviewEl.classList.add('has-image');
    } else {
      this._resetTournamentImagePreview('tf', true);
    }

    this._openTournamentFormModal('edit', id);
  },

  async handleSaveEditTournament() {
    if (!this.hasPermission('admin.tournaments.manage_all') && !this.hasPermission('admin.tournaments.entry')) { this.showToast('權限不足'); return; }
    const editId = this._editTournamentId || this._tournamentFormEditId;
    const editTournament = this.getFriendlyTournamentRecord?.(ApiService.getTournament(editId));
    if (!editTournament) return;
    if (!this._canManageTournamentRecord(editTournament)) {
      this.showToast('你目前只能編輯主辦或受委託的賽事。');
      return;
    }

    this._tfClearErrors();
    const editName = document.getElementById('tf-name').value.trim();
    const editRegion = document.getElementById('tf-region').value.trim();
    const editRegStartInput = document.getElementById('tf-reg-start').value || '';
    const editRegEnd = document.getElementById('tf-reg-end').value || null;
    const editDescription = document.getElementById('tf-desc').value.trim();
    const editFeeEnabled = !!document.getElementById('tf-fee-enabled')?.checked;
    const editFeeInput = parseInt(document.getElementById('tf-fee').value, 10) || 0;
    const editFee = editFeeEnabled ? Math.max(0, editFeeInput) : 0;
    const editTeamLimitRaw = Number(document.getElementById('tf-teams')?.value);
    const editTeamLimit = this._getTournamentTeamLimitValue('tf', 4);
    const hostTeamId = document.getElementById('tf-host-team')?.value || '';
    const hostTeam = ApiService.getTeam?.(hostTeamId);
    let hasError = false;
    if (!editName) {
      this._tfSetError('tf-name', '請輸入賽事名稱。'); hasError = true;
    }
    if (!hostTeam) {
      this._tfSetError('tf-host-team', '請先選擇主辦俱樂部。'); hasError = true;
    }
    if (editTournament.hostTeamId && hostTeam && hostTeam.id !== editTournament.hostTeamId) {
      this._tfSetError('tf-host-team', '主辦俱樂部建立後暫不開放更換。'); hasError = true;
    }
    if (!Number.isFinite(editTeamLimitRaw) || editTeamLimitRaw < 2 || editTeamLimitRaw > 4) {
      this._tfSetError('tf-teams', '參賽隊伍數需介於 2 到 4 隊。'); hasError = true;
    }
    if (!editRegEnd) {
      this._tfSetError('tf-reg-end', '請填寫報名截止時間。'); hasError = true;
    }
    if (hasError) { this.showToast('請修正標記欄位。'); return; }

    const editRegStart = this._getTournamentImmediateRegStartValue(editRegStartInput);
    if (new Date(editRegStart) >= new Date(editRegEnd)) {
      this._tfSetError('tf-reg-start', '報名開始時間不能晚於或等於截止時間。');
      this.showToast('報名開始時間不能晚於或等於截止時間。');
      return;
    }
    const editVenues = [...this._tfVenues];
    const editDelegates = [...this._tfDelegates];
    const editMatchDates = [...this._tfMatchDates];
    const editCoverPreview = document.getElementById('tf-upload-preview');
    const editImage = editCoverPreview?.querySelector('img')?.src || editTournament.image || null;
    const editContentPreview = document.getElementById('tf-content-upload-preview');
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
    this._tournamentFormEditId = null;
    this.renderTournamentTimeline();
    this.renderOngoingTournaments();
    this.renderTournamentManage();
    this.closeModal();
    this.showToast(`賽事「${editName}」已更新。`);
  },

});
