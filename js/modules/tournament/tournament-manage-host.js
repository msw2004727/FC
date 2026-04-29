/* === SportHub — Tournament Host Team Selection & Form Layout === */

Object.assign(App, {

  // Create Button 已移至 tournament-core.js（eager 載入）

  // ══════════════════════════════════
  //  Host Team Selection
  // ══════════════════════════════════

  _getTournamentSelectableHostTeams(selectedId = '') {
    const currentUser = ApiService.getCurrentUser?.();
    const allTeams = ApiService.getTeams?.() || [];
    const source = this._isTournamentGlobalAdmin?.(currentUser)
      ? allTeams
      : this._getFriendlyResponsibleTeams(currentUser);
    const teams = [];
    const seen = new Set();

    source.forEach(team => {
      const safeId = String(team?.id || '').trim();
      if (!safeId || seen.has(safeId)) return;
      seen.add(safeId);
      teams.push(team);
    });

    const safeSelectedId = String(selectedId || '').trim();
    if (safeSelectedId && !seen.has(safeSelectedId)) {
      const selectedTeam = allTeams.find(team => team.id === safeSelectedId);
      if (selectedTeam) teams.push(selectedTeam);
    }
    return teams;
  },

  _getTournamentCurrentUserTeamIds(user = null) {
    const currentUser = user || ApiService.getCurrentUser?.();
    const ids = [];
    const seen = new Set();
    const pushId = (teamId) => {
      const safeId = String(teamId || '').trim();
      if (!safeId || seen.has(safeId)) return;
      seen.add(safeId);
      ids.push(safeId);
    };

    if (Array.isArray(currentUser?.teamIds)) currentUser.teamIds.forEach(pushId);
    pushId(currentUser?.teamId);
    return ids;
  },

  async _ensureTournamentHostTeamsLoaded(user = null) {
    const currentUser = user || ApiService.getCurrentUser?.();

    try {
      if (typeof FirebaseService !== 'undefined') {
        if (typeof FirebaseService.ensureStaticCollectionsLoaded === 'function') {
          await FirebaseService.ensureStaticCollectionsLoaded(['teams']);
        } else if (typeof FirebaseService.ensureCollectionsForPage === 'function') {
          await FirebaseService.ensureCollectionsForPage('page-teams', { skipRealtimeStart: true });
        }

        const userTeamIds = this._getTournamentCurrentUserTeamIds(currentUser);
        if (userTeamIds.length && typeof FirebaseService.fetchTeamIfMissing === 'function') {
          await Promise.all(userTeamIds.map(teamId => FirebaseService.fetchTeamIfMissing(teamId)));
        }
      }
      return ApiService.getTeams?.() || [];
    } catch (err) {
      console.warn('[Tournament] Failed to load host teams before create:', err);
      return ApiService.getTeams?.() || [];
    }
  },

  _ensureTournamentHostRow(prefix) {
    const p = prefix || 'tf';
    let select = document.getElementById(`${p}-host-team`);
    if (select) return select;

    const typeSelect = document.getElementById(`${p}-type`);
    const typeRow = typeSelect?.closest('.ce-row');
    if (!typeRow || !typeRow.parentElement) return null;

    const hostRow = document.createElement('div');
    hostRow.className = 'ce-row';
    // Note: innerHTML usage is safe — no user content in this template
    hostRow.innerHTML = `
      <label>主辦俱樂部 <span class="required">*</span></label>
      <select id="${p}-host-team"></select>
      <div id="${p}-host-team-summary" class="ce-field-note"></div>
    `;
    typeRow.insertAdjacentElement('afterend', hostRow);
    select = hostRow.querySelector('select');
    select.addEventListener('change', () => this._updateTournamentHostTeamSummary(p));
    return select;
  },

  _ensureTournamentHostParticipationRow(prefix) {
    const p = prefix || 'tf';
    let toggle = document.getElementById(`${p}-host-participates`);
    if (toggle) return toggle;

    const hostRow = document.getElementById(`${p}-host-team`)?.closest('.ce-row');
    if (!hostRow || !hostRow.parentElement) return null;

    const row = document.createElement('div');
    row.className = 'ce-row';
    row.innerHTML = `
      <div class="ce-fee-toggle-wrap">
        <div class="ce-fee-toggle-header">
          <label for="${p}-host-participates" class="ce-fee-title">主辦俱樂部是否參賽？</label>
          <label class="toggle-switch">
            <input type="checkbox" id="${p}-host-participates">
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div id="${p}-host-participates-note" class="ce-field-note">關閉時仍會顯示主辦俱樂部，但不佔參賽名額。</div>
      </div>
    `;
    hostRow.insertAdjacentElement('afterend', row);
    toggle = row.querySelector(`#${p}-host-participates`);
    toggle.addEventListener('change', () => this._updateTournamentHostParticipationNote(p));
    return toggle;
  },

  _getTournamentHostParticipates(prefix) {
    const p = prefix || 'tf';
    return document.getElementById(`${p}-host-participates`)?.checked === true;
  },

  _setTournamentHostParticipationFormState(prefix, participates, options = {}) {
    const p = prefix || 'tf';
    const toggle = this._ensureTournamentHostParticipationRow(p);
    if (!toggle) return;
    toggle.checked = participates === true;
    toggle.disabled = options.disabled === true;
    this._updateTournamentHostParticipationNote(p, options);
  },

  _updateTournamentHostParticipationNote(prefix, options = {}) {
    const p = prefix || 'tf';
    const toggle = document.getElementById(`${p}-host-participates`);
    const note = document.getElementById(`${p}-host-participates-note`);
    if (!toggle || !note) return;
    if (options.disabled === true || toggle.disabled) {
      note.textContent = toggle.checked
        ? '此賽事建立時主辦俱樂部已設定為參賽，會佔用名額。'
        : '此賽事建立時主辦俱樂部未參賽，不佔用名額。';
      return;
    }
    note.textContent = toggle.checked
      ? '開啟時會沿用現狀：建立後主辦俱樂部直接參賽並佔用 1 個名額。'
      : '關閉時仍會顯示主辦俱樂部，但不佔參賽名額。';
  },

  _renderTournamentHostTeamOptions(prefix, selectedId = '', options = {}) {
    const p = prefix || 'tf';
    const { locked = false } = options;
    const select = this._ensureTournamentHostRow(p);
    if (!select) return;

    const teams = this._getTournamentSelectableHostTeams(selectedId);
    const safeSelectedId = String(selectedId || '').trim();
    // Note: innerHTML usage is safe — all user content passes through escapeHTML()
    select.innerHTML = teams.length
      ? teams.map(team => `<option value="${escapeHTML(team.id)}">${escapeHTML(team.name)}</option>`).join('')
      : '<option value="">目前沒有可選擇的主辦俱樂部</option>';

    if (safeSelectedId && teams.some(team => team.id === safeSelectedId)) {
      select.value = safeSelectedId;
    } else if (teams.length > 0) {
      select.value = teams[0].id;
    } else {
      select.value = '';
    }

    select.disabled = locked || teams.length === 0;
    this._updateTournamentHostTeamSummary(p, { locked });
  },

  _updateTournamentHostTeamSummary(prefix, options = {}) {
    const p = prefix || 'tf';
    const { locked = false } = options;
    const select = document.getElementById(`${p}-host-team`);
    const summary = document.getElementById(`${p}-host-team-summary`);
    if (!select || !summary) return;

    const team = ApiService.getTeam?.(select.value);
    const actor = ApiService.getCurrentUser?.();
    const actorName = actor?.displayName || actor?.name || '';
    if (!team) {
      summary.textContent = '請先選擇主辦俱樂部。';
      return;
    }

    const organizerText = this._buildTournamentOrganizerDisplay(team.name, actorName);
    summary.textContent = locked
      ? `主辦顯示：${organizerText}｜主辦俱樂部建立後暫不開放更換。`
      : `主辦顯示：${organizerText}`;
  },

  // ══════════════════════════════════
  //  Form Layout
  // ══════════════════════════════════

  _ensureTournamentFormLayout(prefix) {
    const p = prefix || 'tf';
    const form = document.querySelector('#tournament-form-modal .ce-form');
    if (!form) return;

    this._refreshTournamentCenterCreateButton();

    const uploadRow = document.getElementById(`${p}-upload-area`)?.closest('.ce-row');
    if (uploadRow && form.firstElementChild !== uploadRow) {
      form.insertBefore(uploadRow, form.firstElementChild);
    }

    const typeSelect = document.getElementById(`${p}-type`);
    if (typeSelect) {
      // Note: innerHTML usage is safe — no user content in this template
      typeSelect.innerHTML = `
        <option value="friendly">友誼賽</option>
        <option value="cup">盃賽（預留）</option>
        <option value="league">聯賽（預留）</option>
      `;
      typeSelect.value = 'friendly';
      typeSelect.disabled = true;
      typeSelect.classList.add('ce-static-select');
      this._ensureTournamentFieldNote(typeSelect.closest('.ce-row'), `tournament-mode-note-${p}`, '第一階段先開放友誼賽，盃賽與聯賽欄位位置先保留。');
    }

    this._ensureTournamentHostRow(p);
    this._ensureTournamentHostParticipationRow(p);
    this._ensureTournamentFeeToggle(p);

    const teamsInput = document.getElementById(`${p}-teams`);
    if (teamsInput) {
      teamsInput.value = String(this._sanitizeFriendlyTournamentTeamLimit?.(teamsInput.value, 4) ?? 4);
      teamsInput.min = '2';
      teamsInput.max = '4';
      teamsInput.step = '1';
      teamsInput.readOnly = false;
      teamsInput.classList.remove('ce-readonly-input');
      if (!teamsInput.dataset.teamLimitBound) {
        teamsInput.dataset.teamLimitBound = 'true';
        teamsInput.addEventListener('change', () => {
          teamsInput.value = String(this._getTournamentTeamLimitValue(p, 4));
        });
      }
      this._ensureTournamentFieldNote(teamsInput.closest('.ce-row'), `tournament-team-limit-note-${p}`, '第一階段上限四隊，資料結構已保留後續擴充空間');
    }

    const regStartInput = document.getElementById(`${p}-reg-start`);
    const regStartWrap = regStartInput?.parentElement || null;
    const regStartLabel = regStartWrap?.querySelector('label');
    if (regStartLabel) {
      regStartLabel.textContent = '報名開始';
    }

    const regEndInput = document.getElementById(`${p}-reg-end`);
    const regEndWrap = regEndInput?.parentElement || null;
    const regEndLabel = regEndWrap?.querySelector('label');
    if (regEndLabel) {
      // Note: innerHTML usage is safe — no user content in this template
      regEndLabel.innerHTML = '報名截止 <span class="required">*必填</span>';
    }

    const regRow = regStartWrap?.parentElement;
    if (regRow?.classList.contains('ce-row-half')) {
      this._ensureTournamentFieldNote(regRow, `tournament-reg-period-note-${p}`, '未設定則立即開放');
    }
  },

  // ══════════════════════════════════
  //  Host Entry Builder
  // ══════════════════════════════════

  _buildTournamentHostEntry(team, actor, options = {}) {
    if (!team) return null;
    return {
      teamId: team.id,
      teamName: team.name || '',
      teamImage: team.image || '',
      entryStatus: 'host',
      countsTowardLimit: options.countsTowardLimit !== false,
      approvedAt: new Date().toISOString(),
      approvedByUid: actor?.uid || '',
      approvedByName: actor?.displayName || actor?.name || '',
      memberRoster: [],
    };
  },

});
