/* === SportHub — Tournament CRUD & Tab Switching === */
Object.assign(App, {

  // ══════════════════════════════════
  //  Tournament Management (Admin)
  // ══════════════════════════════════
  _tmActiveTab: 'active',
  _editTournamentId: null,
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
    const isAdmin = this.hasPermission('admin.tournaments.manage_all');
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
    container.innerHTML = filtered.map(t => {
      const status = this.getTournamentStatus(t);
      const isEnded = this.isTournamentEnded(t);
      const statusLabel = isEnded ? '已結束' : status;
      const statusColorMap = {
        '即將開始': '#6b7280',
        '報名中': '#10b981',
        '已截止報名': '#f59e0b',
        '已結束': '#6b7280',
      };
      const statusColor = statusColorMap[statusLabel] || '#6b7280';
      const registered = Array.isArray(t.registeredTeams) ? t.registeredTeams : [];
      const feeEnabled = typeof t.feeEnabled === 'boolean' ? t.feeEnabled : Number(t.fee || 0) > 0;
      const fee = feeEnabled ? (Number(t.fee || 0) || 0) : 0;
      const revenue = registered.length * fee;
      const canManage = isAdmin || this._canManageTournamentRecord(t, currentUser);
      const organizerDisplay = this._getTournamentOrganizerDisplayText?.(t) || t.organizer || '主辦俱樂部';
      const typeLabel = this._getTournamentModeLabel?.(t) || t.type || '友誼賽';
      const teamLimit = this._getFriendlyTournamentTeamLimit?.(t) || t.maxTeams || 4;
      const scheduleCount = Array.isArray(t.matchDates) ? t.matchDates.length : 0;
      const feeText = feeEnabled
        ? `應收費用：<strong>NT$${revenue.toLocaleString()}</strong>（${registered.length} 隊 × NT$${fee.toLocaleString()}）`
        : '報名費未開啟';
      return `
      <div class="event-card" style="${isEnded ? 'opacity:.55;filter:grayscale(.4)' : ''}">
        ${t.image ? `<div class="event-card-img"><img src="${t.image}" style="width:100%;height:120px;object-fit:cover;display:block;border-radius:var(--radius) var(--radius) 0 0"></div>` : ''}
        <div class="event-card-body">
          <div style="display:flex;align-items:center;gap:.4rem">
            <div class="event-card-title" style="flex:1">${escapeHTML(t.name)}</div>
            <span style="font-size:.68rem;padding:.15rem .45rem;border-radius:20px;background:${statusColor}18;color:${statusColor};font-weight:600;white-space:nowrap">${statusLabel}</span>
          </div>
          <div class="event-meta">
            <span class="event-meta-item">${escapeHTML(typeLabel)}</span>
            ${t.region ? `<span class="event-meta-item">${escapeHTML(t.region)}</span>` : ''}
            <span class="event-meta-item">${teamLimit} 隊</span>
            ${scheduleCount ? `<span class="event-meta-item">比賽日 ${scheduleCount} 天</span>` : ''}
            <span class="event-meta-item">主辦 ${escapeHTML(organizerDisplay)}</span>
          </div>
          <div style="font-size:.78rem;color:var(--text-secondary);margin-top:.3rem">${feeText}</div>
          <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.5rem">
            ${isEnded ? `
              <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="App.showTournamentDetail('${t.id}')">查看詳情</button>
              ${isAdmin ? `<button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem;background:#10b981;color:#fff;border-color:#10b981" onclick="App.handleReopenTournament('${t.id}')">重新開啟</button>` : ''}
              ${isAdmin ? `<button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem;color:var(--danger)" onclick="App.handleDeleteTournament('${t.id}')">刪除賽事</button>` : ''}
            ` : `
              ${canManage ? `<button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem;background:#10b981;color:#fff;border-color:#10b981" onclick="App.showEditTournament('${t.id}')">編輯賽事</button>` : ''}
              <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem" onclick="App.showTournamentDetail('${t.id}')">查看詳情</button>
              ${isAdmin ? `<button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem;color:var(--danger)" onclick="App.handleEndTournament('${t.id}')">結束賽事</button>` : ''}
            `}
          </div>
        </div>
      </div>`;
    }).join('');
    this._markPageSnapshotReady?.('page-admin-tournaments');
  },

  // ══════════════════════════════════
  //  Create Tournament
  // ══════════════════════════════════
  openCreateTournamentModal() {
    if (!this._canCreateFriendlyTournament()) {
      this.showToast('目前只有擁有俱樂部的領隊或經理可以建立友誼賽。');
      return;
    }
    this._ensureTournamentFormLayout('ct');
    const hostTeams = this._getTournamentSelectableHostTeams();
    if (hostTeams.length === 0) {
      this.showToast('目前沒有可代表建立賽事的主辦俱樂部。');
      return;
    }
    this._ctDelegates = [];
    this._ctVenues = [];
    this._ctMatchDates = [];
    document.getElementById('ct-name').value = '';
    document.getElementById('ct-region').value = '';
    document.getElementById('ct-reg-start').value = '';
    document.getElementById('ct-reg-end').value = '';
    document.getElementById('ct-desc').value = '';
    document.getElementById('ct-desc-count').textContent = '0/500';
    document.getElementById('ct-teams').value = '4';
    document.getElementById('ct-match-date-picker').value = '';
    document.getElementById('ct-venue-input').value = '';
    document.getElementById('ct-delegate-search').value = '';
    this._renderTournamentHostTeamOptions('ct', hostTeams[0]?.id || '');
    this._setTournamentFeeFormState('ct', false, 300);
    this._renderVenueTags('ct');
    this._renderMatchDateTags('ct');
    this._renderTournamentDelegateTags('ct');
    this._updateTournamentDelegateInput('ct');
    this._resetTournamentImagePreview('ct');
    this._resetTournamentImagePreview('ct', true);
    this._initTournamentDelegateSearch('ct');
    this.showModal('create-tournament-modal');
  },

  async handleCreateTournament() {
    if (!this.hasPermission('admin.tournaments.create') && !this.hasPermission('admin.tournaments.entry')) { this.showToast('權限不足'); return; }
    const createUser = ApiService.getCurrentUser?.();
    if (!this._canCreateFriendlyTournament(createUser)) {
      this.showToast('目前只有擁有俱樂部的領隊或經理可以建立友誼賽。');
      return;
    }
    const createName = document.getElementById('ct-name').value.trim();
    const createRegStartInput = document.getElementById('ct-reg-start').value || '';
    const createRegEnd = document.getElementById('ct-reg-end').value || null;
    const createDesc = document.getElementById('ct-desc').value.trim();
    const createRegion = document.getElementById('ct-region').value.trim();
    const createFeeEnabled = !!document.getElementById('ct-fee-enabled')?.checked;
    const createFeeInput = parseInt(document.getElementById('ct-fee').value, 10) || 0;
    const createFee = createFeeEnabled ? Math.max(0, createFeeInput) : 0;
    const createTeamLimitRaw = Number(document.getElementById('ct-teams')?.value);
    const createTeamLimit = this._getTournamentTeamLimitValue('ct', 4);
    const hostTeamId = document.getElementById('ct-host-team')?.value || '';
    const hostTeam = ApiService.getTeam?.(hostTeamId);
    const createMatchDates = [...this._ctMatchDates];
    const createVenues = [...this._ctVenues];
    const createDelegates = [...this._ctDelegates];
    if (!createName) { this.showToast('請輸入賽事名稱。'); return; }
    if (!hostTeam) { this.showToast('請先選擇主辦俱樂部。'); return; }
    if (!Number.isFinite(createTeamLimitRaw) || createTeamLimitRaw < 2 || createTeamLimitRaw > 4) {
      this.showToast('參賽隊伍數需介於 2 到 4 隊。'); return;
    }
    if (!createRegEnd) { this.showToast('請填寫報名截止時間。'); return; }
    const createRegStart = this._getTournamentImmediateRegStartValue(createRegStartInput);
    if (new Date(createRegStart) >= new Date(createRegEnd)) {
      this.showToast('報名開始時間不能晚於或等於截止時間。'); return;
    }
    const createCoverPreview = document.getElementById('ct-upload-preview');
    const createCoverImage = createCoverPreview?.querySelector('img')?.src || null;
    const createContentPreview = document.getElementById('ct-content-upload-preview');
    const createContentImage = createContentPreview?.querySelector('img')?.src || null;
    const createCreatorName = createUser?.displayName || createUser?.name || '使用者';
    const createCreatorUid = createUser?.uid || '';
    if (!createCreatorUid) {
      this.showToast('請先登入後再建立賽事。'); return;
    }
    const hostEntry = this._buildTournamentHostEntry(hostTeam, createUser);
    const createData = {
      id: 'ct_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
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
      registeredTeams: hostEntry ? [hostTeam.id] : [],
      teamEntries: hostEntry ? [hostEntry] : [],
      teamApplications: [],
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
      await ApiService.createTournamentAwait(createData);
    } catch (err) {
      this._showTournamentActionError?.('建立賽事', err); return;
    }
    ApiService._writeOpLog('tourn_create', '建立賽事', `建立「${createName}」`);
    this.renderTournamentTimeline();
    this.renderOngoingTournaments();
    this.renderTournamentManage();
    this.closeModal();
    this.showToast(`賽事「${createName}」已建立。`);
    document.getElementById('ct-name').value = '';
    document.getElementById('ct-region').value = '';
    document.getElementById('ct-reg-start').value = '';
    document.getElementById('ct-reg-end').value = '';
    document.getElementById('ct-desc').value = '';
    document.getElementById('ct-desc-count').textContent = '0/500';
    document.getElementById('ct-teams').value = '4';
    document.getElementById('ct-match-date-picker').value = '';
    document.getElementById('ct-venue-input').value = '';
    document.getElementById('ct-delegate-search').value = '';
    this._ctMatchDates = [];
    this._ctVenues = [];
    this._ctDelegates = [];
    this._renderMatchDateTags('ct');
    this._renderVenueTags('ct');
    this._renderTournamentDelegateTags('ct');
    this._updateTournamentDelegateInput('ct');
    this._renderTournamentHostTeamOptions('ct');
    this._setTournamentFeeFormState('ct', false, 300);
    this._resetTournamentImagePreview('ct');
    this._resetTournamentImagePreview('ct', true);
  },

  // ══════════════════════════════════
  //  End / Reopen / Delete Tournament
  // ══════════════════════════════════
  async handleEndTournament(id) {
    if (!this.hasPermission('admin.tournaments.entry')) {
      this.showToast('權限不足'); return;
    }
    const t = ApiService.getTournament(id);
    if (!t) return;
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
    if (!this.hasPermission('admin.tournaments.entry')) {
      this.showToast('權限不足'); return;
    }
    const t = ApiService.getTournament(id);
    if (!t) return;
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

  async handleDeleteTournament(id) {
    const t = ApiService.getTournament(id);
    if (!t) return;
    if (!this.hasPermission('admin.tournaments.entry')) {
      this.showToast('僅管理員可刪除賽事'); return;
    }
    if (!(await this.appConfirm(`確定要永久刪除賽事「${t.name}」？此操作無法復原。`))) return;
    const tName = t.name;
    ApiService.deleteTournament(id);
    ApiService._writeOpLog('tourn_delete', '刪除賽事', `刪除「${tName}」`);
    this.renderTournamentTimeline();
    this.renderOngoingTournaments();
    this.renderTournamentManage();
    this.showToast(`已刪除賽事「${tName}」`);
  },

});
