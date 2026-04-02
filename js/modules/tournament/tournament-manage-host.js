/* === SportHub — Tournament Host Team Selection & Form Layout === */

Object.assign(App, {

  // ══════════════════════════════════
  //  Create Button
  // ══════════════════════════════════

  _refreshTournamentCenterCreateButton() {
    const header = document.querySelector('#page-tournaments .page-header');
    if (!header) return;

    let button = document.getElementById('tournament-open-create-btn');
    if (!button) {
      button = document.createElement('button');
      button.id = 'tournament-open-create-btn';
      button.className = 'primary-btn small';
      button.textContent = '＋ 新增賽事';
      button.onclick = () => this.openCreateTournamentModal();
      button.textContent = '建立賽事';
      header.appendChild(button);
    }

    button.style.display = this._canCreateFriendlyTournament() ? '' : 'none';
  },

  // ══════════════════════════════════
  //  Host Team Selection
  // ══════════════════════════════════

  _getTournamentSelectableHostTeams(selectedId = '') {
    const currentUser = ApiService.getCurrentUser?.();
    const allTeams = ApiService.getTeams?.() || [];
    const source = this.hasPermission('admin.tournaments.manage_all')
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

  _buildTournamentHostEntry(team, actor) {
    if (!team) return null;
    return {
      teamId: team.id,
      teamName: team.name || '',
      teamImage: team.image || '',
      entryStatus: 'host',
      approvedAt: new Date().toISOString(),
      approvedByUid: actor?.uid || '',
      approvedByName: actor?.displayName || actor?.name || '',
      memberRoster: [],
    };
  },

});
