/* === SportHub — Tournament CRUD & Tab Switching === */
Object.assign(App, {

  // ══════════════════════════════════
  //  Tournament Management (Admin)
  // ══════════════════════════════════
  _tmActiveTab: 'active',
  _editTournamentId: null,
  _tournamentFormMode: 'create',
  _tournamentFormEditId: null,

  switchTournamentManageTab(tab) {
    this._tmActiveTab = tab;
    document.querySelectorAll('#tm-tabs .tab').forEach(el => {
      el.classList.toggle('active', el.dataset.tmtab === tab);
    });
    this.renderTournamentManage();
  },

  renderTournamentManage() {
    const container = document.getElementById('tournament-manage-list');
    if (!container) return;
    const tab = this._tmActiveTab || 'active';
    this._refreshTournamentCenterCreateButton();
    const currentUser = ApiService.getCurrentUser?.();
    const isAdmin = this._isTournamentGlobalAdmin(currentUser);
    const all = (ApiService.getTournaments() || [])
      .map(t => this.getFriendlyTournamentRecord?.(t) || t)
      .filter(t => isAdmin || this._canManageTournamentRecord(t, currentUser));
    const filtered = all.filter(t => {
      const ended = this.isTournamentEnded(t);
      return tab === 'ended' ? ended : !ended;
    });
    if (filtered.length === 0) {
      // Note: innerHTML usage is safe — no user content in this template
      container.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:.85rem">${tab === 'ended' ? '目前沒有已結束的賽事。' : '目前沒有可管理的賽事。'}</div>`;
      return;
    }
    // Note: innerHTML usage is safe — all user content passes through escapeHTML()
    // 後台管理改用窄條版型(對齊賽事中心舊版),省空間更好掃讀
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const statusBgMap = {
      [TOURNAMENT_STATUS.REG_OPEN]:        { bg: 'rgba(52,211,153,.07)', border: '#10b981', darkBg: 'rgba(52,211,153,.15)' },
      [TOURNAMENT_STATUS.REG_CLOSED]:      { bg: 'rgba(251,191,36,.07)', border: '#f59e0b', darkBg: 'rgba(251,191,36,.15)' },
      [TOURNAMENT_STATUS.REG_CLOSED_ALT]:  { bg: 'rgba(251,191,36,.07)', border: '#f59e0b', darkBg: 'rgba(251,191,36,.15)' },
      [TOURNAMENT_STATUS.PREPARING]:       { bg: 'rgba(96,165,250,.07)', border: '#60a5fa', darkBg: 'rgba(96,165,250,.15)' },
      [TOURNAMENT_STATUS.ENDED]:           { bg: 'rgba(107,114,128,.07)', border: '#6b7280', darkBg: 'rgba(107,114,128,.15)' },
    };
    const statusCssMap = {
      [TOURNAMENT_STATUS.REG_OPEN]: 'open',
      [TOURNAMENT_STATUS.REG_CLOSED_ALT]: 'full',
      [TOURNAMENT_STATUS.REG_CLOSED]: 'full',
      [TOURNAMENT_STATUS.PREPARING]: 'upcoming',
      [TOURNAMENT_STATUS.ENDED]: 'ended',
    };
    container.innerHTML = filtered.map(t => {
      const status = this.getTournamentStatus(t);
      const isEnded = this.isTournamentEnded(t);
      const statusLabel = isEnded ? TOURNAMENT_STATUS.ENDED : status;
      const sBg = statusBgMap[statusLabel] || statusBgMap[TOURNAMENT_STATUS.ENDED];
      const css = statusCssMap[statusLabel] || 'ended';
      const registered = Array.isArray(t.registeredTeams) ? t.registeredTeams : [];
      const feeEnabled = typeof t.feeEnabled === 'boolean' ? t.feeEnabled : Number(t.fee || 0) > 0;
      const fee = feeEnabled ? (Number(t.fee || 0) || 0) : 0;
      const revenue = registered.length * fee;
      const canManage = isAdmin || this._canManageTournamentRecord(t, currentUser);
      const organizerDisplay = this._getTournamentOrganizerDisplayText?.(t) || t.organizer || '主辦俱樂部';
      const teamLimit = this._getFriendlyTournamentTeamLimit?.(t) || t.maxTeams || 4;
      const feeText = feeEnabled
        ? `應收 NT$${revenue.toLocaleString()}(${registered.length} × NT$${fee.toLocaleString()})`
        : '報名費未開啟';
      return `
        <div class="tl-event-row" style="margin-bottom:.4rem;flex-wrap:wrap;padding:.45rem .6rem .35rem;background:${isDark ? sBg.darkBg : sBg.bg};border-left:3px solid ${sBg.border};${isEnded ? 'opacity:.7;' : ''}">
          <div style="width:100%;display:flex;align-items:center;gap:.35rem">
            <div class="tl-event-title" style="flex:1">${escapeHTML(t.name)}</div>
            <span class="tl-event-status ${css}">${statusLabel}</span>
          </div>
          <div style="width:100%;font-size:.62rem;color:var(--text-muted);margin-top:.2rem;line-height:1.5">
            ${t.region ? escapeHTML(t.region) + ' · ' : ''}${teamLimit} 隊 · ${registered.length}/${teamLimit} 已報名 · ${feeText} · 主辦 ${escapeHTML(organizerDisplay)}
          </div>
          <div style="width:100%;display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.35rem">
            ${isEnded ? `
              <button class="outline-btn" style="font-size:.7rem;padding:.25rem .5rem" onclick="App.showTournamentDetail('${t.id}')">查看詳情</button>
              ${isAdmin ? `<button class="outline-btn" style="font-size:.7rem;padding:.25rem .5rem;background:#10b981;color:#fff;border-color:#10b981" onclick="App.handleReopenTournament('${t.id}')">重新開啟</button>` : ''}
              ${isAdmin ? `<button class="outline-btn" style="font-size:.7rem;padding:.25rem .5rem;color:var(--danger)" onclick="App.handleDeleteTournament('${t.id}', this)">刪除賽事</button>` : ''}
            ` : `
              ${canManage ? `<button class="outline-btn" style="font-size:.7rem;padding:.25rem .5rem;background:#10b981;color:#fff;border-color:#10b981" onclick="App.openEditTournamentSafe('${escapeHTML(t.id)}')">編輯賽事</button>` : ''}
              <button class="outline-btn" style="font-size:.7rem;padding:.25rem .5rem" onclick="App.showTournamentDetail('${t.id}')">查看詳情</button>
              ${canManage ? `<button class="outline-btn" style="font-size:.7rem;padding:.25rem .5rem;color:var(--danger)" onclick="App.handleEndTournament('${t.id}')">結束賽事</button>` : ''}
              ${isAdmin ? `<button class="outline-btn" style="font-size:.7rem;padding:.25rem .5rem;color:var(--danger)" onclick="App.handleDeleteTournament('${t.id}', this)">刪除賽事</button>` : ''}
            `}
          </div>
        </div>`;
    }).join('');
    this._markPageSnapshotReady?.('page-admin-tournaments');
  },

  // ══════════════════════════════════
  //  Mode-Switching (unified modal)
  // ══════════════════════════════════
  _openTournamentFormModal(mode, tournamentId) {
    const title = document.getElementById('tf-modal-title');
    const btn = document.getElementById('tf-save-btn');
    if (mode === 'create') {
      if (title) title.textContent = '新增賽事';
      if (btn) { btn.textContent = '建立賽事'; btn.onclick = () => App.handleCreateTournament(); }
      this._tournamentFormMode = 'create';
      this._tournamentFormEditId = null;
    } else {
      if (title) title.textContent = '編輯賽事';
      if (btn) { btn.textContent = '儲存變更'; btn.onclick = () => App.handleSaveEditTournament(); }
      this._tournamentFormMode = 'edit';
      this._tournamentFormEditId = tournamentId;
    }
    // Clear errors and bind focus-to-clear-error listeners
    this._tfClearErrors();
    document.querySelectorAll('#tournament-form-modal input, #tournament-form-modal select, #tournament-form-modal textarea').forEach(el => {
      el.addEventListener('focus', function() {
        var row = this.closest('.ce-row');
        if (row) row.classList.remove('tf-field-error');
      }, { once: false });
    });
    this.showModal('tournament-form-modal');
  },

  // ══════════════════════════════════
  //  Unified save dispatcher
  // ══════════════════════════════════
  handleSaveTournament() {
    if (this._tournamentFormMode === 'edit') {
      this.handleSaveEditTournament();
    } else {
      this.handleCreateTournament();
    }
  },

  // ══════════════════════════════════
  //  Validation helpers (field-level)
  // ══════════════════════════════════
  _tfClearErrors() {
    document.querySelectorAll('#tournament-form-modal .tf-field-error').forEach(el => el.classList.remove('tf-field-error'));
  },
  _tfSetError(inputId, message) {
    var input = document.getElementById(inputId);
    if (!input) return;
    var row = input.closest('.ce-row');
    if (row) {
      row.classList.add('tf-field-error');
      var msg = row.querySelector('.tf-error-msg');
      if (!msg) {
        msg = document.createElement('div');
        msg.className = 'tf-error-msg';
        row.appendChild(msg);
      }
      msg.textContent = message;
      msg.style.display = '';
    }
  },

  // ══════════════════════════════════
  //  Create Tournament
  // ── 地區 typeahead（2026-04-25：與俱樂部 / 個人資料統一、含「其他」）──
  _onTournamentRegionFocus() { this._renderTournamentRegionSuggest(''); },

  _onTournamentRegionInput() {
    const val = (document.getElementById('tf-region')?.value || '').trim();
    this._renderTournamentRegionSuggest(val);
  },

  _onTournamentRegionBlur() {
    setTimeout(() => {
      const sug = document.getElementById('tf-region-suggest');
      if (sug) sug.classList.remove('show');
    }, 200);
  },

  _renderTournamentRegionSuggest(query) {
    const sug = document.getElementById('tf-region-suggest');
    if (!sug) return;
    const matches = (typeof filterTwRegions === 'function') ? filterTwRegions(query, true) : [];
    if (matches.length === 0) {
      sug.classList.remove('show');
      return;
    }
    sug.innerHTML = matches.map(r =>
      `<div class="team-user-suggest-item" onmousedown="event.preventDefault();App._selectTournamentRegion('${escapeHTML(r)}')"><span class="tus-name">${escapeHTML(r)}</span></div>`
    ).join('');
    sug.classList.add('show');
  },

  _selectTournamentRegion(region) {
    const input = document.getElementById('tf-region');
    if (input) input.value = region;
    const sug = document.getElementById('tf-region-suggest');
    if (sug) sug.classList.remove('show');
  },

  // ══════════════════════════════════
  async openCreateTournamentModal() {
    await this._ensureTournamentHostTeamsLoaded?.();

    if (!this._canCreateFriendlyTournament()) {
      this.showToast('目前只有擁有俱樂部的領隊或經理可以建立友誼賽。');
      return;
    }
    this._ensureTournamentFormLayout('tf');
    const hostTeams = this._getTournamentSelectableHostTeams();
    if (hostTeams.length === 0) {
      this.showToast('目前沒有可代表建立賽事的主辦俱樂部。');
      return;
    }
    this._tournamentFormState.delegates = [];
    this._tournamentFormState.venues = [];
    this._tournamentFormState.matchDates = [];
    document.getElementById('tf-name').value = '';
    document.getElementById('tf-region').value = '';
    document.getElementById('tf-reg-start').value = '';
    document.getElementById('tf-reg-end').value = '';
    document.getElementById('tf-desc').value = '';
    document.getElementById('tf-desc-count').textContent = '0/500';
    document.getElementById('tf-teams').value = '4';
    document.getElementById('tf-match-date-picker').value = '';
    document.getElementById('tf-venue-input').value = '';
    document.getElementById('tf-delegate-search').value = '';
    this._renderTournamentHostTeamOptions('tf', hostTeams[0]?.id || '');
    this._setTournamentFeeFormState('tf', false, 300);
    this._renderVenueTags('tf');
    this._renderMatchDateTags('tf');
    this._renderTournamentDelegateTags('tf');
    this._updateTournamentDelegateInput('tf');
    this._resetTournamentImagePreview('tf');
    this._resetTournamentImagePreview('tf', true);
    this._initTournamentDelegateSearch('tf');
    document.getElementById('tf-image').value = '';
    document.getElementById('tf-content-image').value = '';
    this._bindTournamentImageUploads('tf');
    this._openTournamentFormModal('create');
  },

  async handleCreateTournament() {
    const createUser = ApiService.getCurrentUser?.();
    if (!this._canCreateFriendlyTournament(createUser)) {
      this.showToast('目前只有擁有俱樂部的領隊或經理可以建立友誼賽。');
      return;
    }
    this._tfClearErrors();
    const createName = document.getElementById('tf-name').value.trim();
    const createRegStartInput = document.getElementById('tf-reg-start').value || '';
    const createRegEnd = document.getElementById('tf-reg-end').value || null;
    const createDesc = document.getElementById('tf-desc').value.trim();
    const createRegion = document.getElementById('tf-region').value.trim();
    const createFeeEnabled = !!document.getElementById('tf-fee-enabled')?.checked;
    const createFeeInput = parseInt(document.getElementById('tf-fee').value, 10) || 0;
    const createFee = createFeeEnabled ? Math.max(0, createFeeInput) : 0;
    const createTeamLimitRaw = Number(document.getElementById('tf-teams')?.value);
    const createTeamLimit = this._getTournamentTeamLimitValue('tf', 4);
    const hostTeamId = document.getElementById('tf-host-team')?.value || '';
    const hostTeam = ApiService.getTeam?.(hostTeamId);
    const createMatchDates = [...this._tournamentFormState.matchDates];
    const createVenues = [...this._tournamentFormState.venues];
    const createDelegates = [...this._tournamentFormState.delegates];
    let hasError = false;
    if (!createName) { this._tfSetError('tf-name', '請輸入賽事名稱。'); hasError = true; }
    if (!hostTeam) { this._tfSetError('tf-host-team', '請先選擇主辦俱樂部。'); hasError = true; }
    if (!Number.isFinite(createTeamLimitRaw) || createTeamLimitRaw < 2 || createTeamLimitRaw > 4) {
      this._tfSetError('tf-teams', '參賽隊伍數需介於 2 到 4 隊。'); hasError = true;
    }
    if (!createRegEnd) { this._tfSetError('tf-reg-end', '請填寫報名截止時間。'); hasError = true; }
    // 2026-04-25：地區必填、必須在清單內（22 縣市 + 「其他」）
    if (!createRegion) { this._tfSetError('tf-region', '請選擇舉辦地區。'); hasError = true; }
    else if (typeof TW_REGIONS_WITH_OTHER !== 'undefined' && !TW_REGIONS_WITH_OTHER.includes(createRegion)) {
      this._tfSetError('tf-region', '舉辦地區必須從清單選擇。'); hasError = true;
    }
    if (hasError) { this.showToast('請修正標記欄位。'); return; }
    const createRegStart = this._getTournamentImmediateRegStartValue(createRegStartInput);
    if (new Date(createRegStart) >= new Date(createRegEnd)) {
      this._tfSetError('tf-reg-start', '報名開始時間不能晚於或等於截止時間。');
      this.showToast('報名開始時間不能晚於或等於截止時間。'); return;
    }

    return this._withButtonLoading('#tf-save-btn', '建立中...', async () => {

    const createCoverPreview = document.getElementById('tf-upload-preview');
    const createCoverImage = createCoverPreview?.querySelector('img')?.src || null;
    const createContentPreview = document.getElementById('tf-content-upload-preview');
    const createContentImage = createContentPreview?.querySelector('img')?.src || null;
    const createCreatorName = createUser?.displayName || createUser?.name || '使用者';
    const createCreatorUid = createUser?.uid || '';
    if (!createCreatorUid) {
      this.showToast('請先登入後再建立賽事。'); return;
    }
    const createData = {
      id: generateId('ct_'),
      name: createName,
      type: this._getTournamentModeLabel('friendly'),
      typeCode: 'friendly',
      mode: 'friendly',
      teams: createTeamLimit,
      maxTeams: createTeamLimit,
      teamLimit: createTeamLimit,
      matches: 3,
      region: createRegion,
      regStart: createRegStart,
      regEnd: createRegEnd,
      matchDates: createMatchDates,
      description: createDesc,
      image: createCoverImage,
      contentImage: createContentImage,
      venues: createVenues,
      feeEnabled: createFeeEnabled,
      fee: createFee,
      delegates: createDelegates,
      delegateUids: createDelegates.map(delegate => String(delegate.uid || '').trim()).filter(uid => uid.length > 0),
      organizer: createCreatorName,
      creatorName: createCreatorName,
      creatorUid: createCreatorUid,
      hostTeamId: hostTeam.id,
      hostTeamName: hostTeam.name || '',
      hostTeamImage: hostTeam.image || '',
      organizerDisplay: this._buildTournamentOrganizerDisplay(hostTeam.name, createCreatorName),
      registeredTeams: [hostTeam.id],
      friendlyConfig: {
        teamLimit: createTeamLimit,
        allowMemberSelfJoin: true,
        pendingVisibleToThirdParty: false,
      },
      ended: false,
      gradient: GRADIENT_MAP?.friendly || 'linear-gradient(135deg,#0d9488,#065f46)',
    };
    createData.status = this.getTournamentStatus(createData);
    try {
      const result = await ApiService.createFriendlyTournamentAtomic(createData);
      if (result?.tournament) {
        const tournaments = ApiService.getTournaments?.() || [];
        const idx = tournaments.findIndex(item => item.id === result.tournament.id);
        if (idx >= 0) tournaments[idx] = { ...tournaments[idx], ...result.tournament };
        else tournaments.unshift(result.tournament);
      }
    } catch (err) {
      this._showTournamentActionError?.('建立賽事', err); return;
    }
    ApiService._writeOpLog('tourn_create', '建立賽事', `建立「${createName}」`);
    this.renderTournamentTimeline();
    this.renderOngoingTournaments();
    this.renderTournamentManage();
    this.closeModal();
    this.showToast(`賽事「${createName}」已建立。`);
    document.getElementById('tf-name').value = '';
    document.getElementById('tf-region').value = '';
    document.getElementById('tf-reg-start').value = '';
    document.getElementById('tf-reg-end').value = '';
    document.getElementById('tf-desc').value = '';
    document.getElementById('tf-desc-count').textContent = '0/500';
    document.getElementById('tf-teams').value = '4';
    document.getElementById('tf-match-date-picker').value = '';
    document.getElementById('tf-venue-input').value = '';
    document.getElementById('tf-delegate-search').value = '';
    this._tournamentFormState.matchDates = [];
    this._tournamentFormState.venues = [];
    this._tournamentFormState.delegates = [];
    this._renderMatchDateTags('tf');
    this._renderVenueTags('tf');
    this._renderTournamentDelegateTags('tf');
    this._updateTournamentDelegateInput('tf');
    this._renderTournamentHostTeamOptions('tf');
    this._setTournamentFeeFormState('tf', false, 300);
    this._resetTournamentImagePreview('tf');
    this._resetTournamentImagePreview('tf', true);

    });  // _withButtonLoading
  },

  // ══════════════════════════════════
  //  End / Reopen / Delete Tournament
  // ══════════════════════════════════
  // Phase 2A §12.4：賽事操作拆分 — entry → end/reopen/delete 獨立權限守衛
  async handleEndTournament(id) {
    const t = ApiService.getTournament(id);
    if (!t) return;
    // 全域權限 or 委託人/主辦隊長 fallback
    if (!this._isTournamentGlobalAdmin() && !this._canManageTournamentRecord(t)) {
      this.showToast('權限不足'); return;
    }
    if (t.ended) { this.showToast('此賽事已結束'); return; }
    if (!(await this.appConfirm(`確定要結束賽事「${t.name}」？`))) return;
    try {
      await ApiService.updateTournamentAwait(id, { ended: true });
    } catch (err) {
      this._showTournamentActionError?.('結束賽事', err); return;
    }
    ApiService._writeOpLog('tourn_end', '結束賽事', `結束「${t.name}」`);
    this.renderTournamentTimeline();
    this.renderOngoingTournaments();
    this.renderTournamentManage();
    this.showToast(`賽事「${t.name}」已結束`);
  },
  async handleReopenTournament(id) {
    // 重開賽事 — 僅全域權限（管理員）
    if (!this._isTournamentGlobalAdmin()) {
      this.showToast('權限不足'); return;
    }
    const t = ApiService.getTournament(id);
    if (!t) return;
    if (!t.ended) { this.showToast('此賽事尚未結束'); return; }
    if (!(await this.appConfirm(`確定要重新開放賽事「${t.name}」？`))) return;
    try {
      await ApiService.updateTournamentAwait(id, { ended: false });
    } catch (err) {
      this._showTournamentActionError?.('重新開放賽事', err); return;
    }
    ApiService._writeOpLog('tourn_reopen', '重開賽事', `重開「${t.name}」`);
    this.renderTournamentTimeline();
    this.renderOngoingTournaments();
    this.renderTournamentManage();
    this.showToast(`賽事「${t.name}」已重新開放`);
  },

  async handleDeleteTournament(id, actionButton = null) {
    const t = ApiService.getTournament(id);
    if (!t) return;
    // 刪除賽事 — 僅全域權限（管理員）
    if (!this._isTournamentGlobalAdmin()) {
      this.showToast('僅管理員可刪除賽事'); return;
    }
    if (!(await this.appConfirm(`確定要永久刪除賽事「${t.name}」？此操作無法復原。`))) return;
    const tName = t.name;
    const deleteTask = async () => {
      try {
        await ApiService.deleteTournamentAwait(id);
      } catch (err) { if (!err?._toasted) this.showToast('刪除賽事失敗，請重試'); return; }
      ApiService._writeOpLog('tourn_delete', '刪除賽事', `刪除「${tName}」`);
      this.renderTournamentTimeline();
      this.renderOngoingTournaments();
      this.renderTournamentManage();
      if (String(this.currentTournament || '') === String(id) && this.currentPage === 'page-tournament-detail') {
        this.currentTournament = null;
        this._clearTournamentDetailRouteParam?.();
        await this.showPage?.('page-tournaments');
        this.renderTournamentTimeline?.();
      }
      this.showToast(`已刪除賽事「${tName}」`);
    };
    if (typeof this._withButtonLoading === 'function') {
      return this._withButtonLoading(actionButton, '刪除中...', deleteTask);
    }
    return deleteTask();
  },

});
