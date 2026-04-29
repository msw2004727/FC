/* === SportHub — Tournament Edit Modal & Save Handler === */

Object.assign(App, {

  async showEditTournament(id) {
    const safeId = String(id || '').trim();
    if (!safeId) {
      console.error('[showEditTournament] empty/invalid id, raw =', id);
      this.showToast('賽事 ID 無效');
      return;
    }
    let rawRecord = ApiService.getTournament(safeId);
    let fetchedFromServer = false;
    let fetchError = null;
    if (!rawRecord) {
      // cache miss → fallback Firestore 單筆查詢(初次進入頁面、limit 截斷、深層連結等情境)
      try {
        rawRecord = await ApiService.getTournamentAsync(safeId);
        fetchedFromServer = true;
      } catch (err) {
        fetchError = err;
        console.error('[showEditTournament] getTournamentAsync threw:', err);
      }
    }
    // 注意:getFriendlyTournamentRecord 定義在 ApiService 不是 App,
    // 用 this.xxx 永遠 undefined。歷史 bug 的根因。
    const editRecord = ApiService.getFriendlyTournamentRecord?.(rawRecord) || rawRecord;
    if (!editRecord) {
      const cacheCount = (ApiService.getTournaments?.() || []).length;
      const shortId = safeId.length > 12 ? safeId.slice(-12) : safeId;
      console.error('[showEditTournament] tournament not found',
        { id: safeId, cacheSize: cacheCount, fetchedFromServer, fetchError });
      const reason = fetchError ? '網路錯誤' : (fetchedFromServer ? '已被刪除' : '快取不一致');
      this.showToast(`找不到此賽事 (${reason}, …${shortId})`);
      return;
    }
    if (!this._isTournamentGlobalAdmin() && !this._canManageTournamentRecord(editRecord)) {
      this.showToast('你目前只能編輯主辦或受委託的賽事。');
      return;
    }

    this._editTournamentId = safeId;
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
    document.getElementById('tf-referee-search').value = '';
    this._tournamentFormState.venues = [...(editRecord.venues || [])];
    this._tournamentFormState.delegates = [...(editRecord.delegates || [])];
    this._tournamentFormState.referees = [...(editRecord.referees || [])];
    this._tournamentFormState.matchDates = [...(editRecord.matchDates || [])];
    this._renderVenueTags('tf');
    this._renderTournamentDelegateTags('tf');
    this._updateTournamentDelegateInput('tf');
    this._initTournamentDelegateSearch('tf');
    this._renderTournamentRefereeTags('tf');
    this._updateTournamentRefereeInput('tf');
    this._initTournamentRefereeSearch('tf');
    this._renderMatchDateTags('tf');
    this._renderTournamentHostTeamOptions('tf', editRecord.hostTeamId || '', { locked: !!editRecord.hostTeamId });
    this._setTournamentHostParticipationFormState('tf', this._isTournamentHostParticipating?.(editRecord) !== false, { disabled: true });
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

    this._bindTournamentImageUploads('tf');
    this._openTournamentFormModal('edit', id);
  },

  async handleSaveEditTournament() {
    const editId = this._editTournamentId || this._tournamentFormEditId;
    const cachedTournament = ApiService.getTournament(editId);
    const editTournament = ApiService.getFriendlyTournamentRecord?.(cachedTournament) || cachedTournament;
    if (!editTournament) {
      this.showToast('找不到此賽事,請重新整理後再試');
      return;
    }
    if (!this._isTournamentGlobalAdmin() && !this._canManageTournamentRecord(editTournament)) {
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
    // 2026-04-25：地區必填、必須在清單內（22 縣市 + 「其他」）
    if (!editRegion) { this._tfSetError('tf-region', '請選擇舉辦地區。'); hasError = true; }
    else if (typeof TW_REGIONS_WITH_OTHER !== 'undefined' && !TW_REGIONS_WITH_OTHER.includes(editRegion)) {
      this._tfSetError('tf-region', '舉辦地區必須從清單選擇。'); hasError = true;
    }
    if (hasError) { this.showToast('請修正標記欄位。'); return; }

    const editRegStart = this._getTournamentImmediateRegStartValue(editRegStartInput);
    if (new Date(editRegStart) >= new Date(editRegEnd)) {
      this._tfSetError('tf-reg-start', '報名開始時間不能晚於或等於截止時間。');
      this.showToast('報名開始時間不能晚於或等於截止時間。');
      return;
    }

    return this._withButtonLoading('#tf-save-btn', '儲存中...', async () => {

    const editVenues = [...this._tournamentFormState.venues];
    const editDelegates = [...this._tournamentFormState.delegates];
    const editReferees = [...this._tournamentFormState.referees];
    const editMatchDates = [...this._tournamentFormState.matchDates];
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
      referees: editReferees,
      refereeUids: editReferees.map(referee => String(referee.uid || '').trim()).filter(uid => uid.length > 0),
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
      hostParticipates: this._isTournamentHostParticipating?.(editTournament) !== false,
      friendlyConfig: {
        teamLimit: editTeamLimit,
        allowMemberSelfJoin: true,
        pendingVisibleToThirdParty: false,
        hostParticipates: this._isTournamentHostParticipating?.(editTournament) !== false,
      },
    };

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

    });  // _withButtonLoading
  },

});
