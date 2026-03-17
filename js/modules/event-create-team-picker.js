/* === SportHub — Event Create: Team-only Picker === */
/* innerHTML uses escapeHTML() for all user-supplied values */

Object.assign(App, {

  _buildTeamNameHints(teamIds = [], teamNames = []) {
    const ids = Array.isArray(teamIds) ? teamIds : [teamIds];
    const names = Array.isArray(teamNames) ? teamNames : [teamNames];
    const hints = new Map();
    ids.forEach((id, idx) => {
      const key = String(id || '').trim();
      if (!key) return;
      const hintedName = String(names[idx] || '').trim();
      if (hintedName) hints.set(key, hintedName);
    });
    return hints;
  },

  _resolveTeamDisplayName(teamId, hintedName = '') {
    const id = String(teamId || '').trim();
    if (!id) return '未知球隊';

    const hint = String(hintedName || '').trim();
    if (hint) return hint;

    const currentTeam = ApiService.getTeam?.(id);
    const currentTeamName = String(currentTeam?.name || '').trim();
    if (currentTeamName) return currentTeamName;

    const events = ApiService.getEvents?.() || [];
    for (const e of events) {
      if (!e) continue;

      if (Array.isArray(e.creatorTeamIds) && Array.isArray(e.creatorTeamNames)) {
        const idx = e.creatorTeamIds.findIndex(v => String(v || '').trim() === id);
        if (idx >= 0) {
          const historicName = String(e.creatorTeamNames[idx] || '').trim();
          if (historicName) return historicName;
        }
      }

      if (String(e.creatorTeamId || '').trim() === id) {
        const legacyName = String(e.creatorTeamName || '').trim();
        if (legacyName) return legacyName;
      }
    }

    return '未知球隊';
  },

  _getTeamOnlyCandidateTeams() {
    const teams = ApiService.getTeams?.() || [];
    const activeTeamMap = new Map();
    teams.forEach(t => {
      if (!t?.id || t.active === false) return;
      activeTeamMap.set(String(t.id), t);
    });

    const ids = new Set();
    const pushId = (id) => {
      const v = String(id || '').trim();
      if (v) ids.add(v);
    };

    const currentUser = ApiService.getCurrentUser?.() || null;
    if (currentUser) {
      if (typeof this._getUserTeamIds === 'function') {
        this._getUserTeamIds(currentUser).forEach(pushId);
      } else {
        if (Array.isArray(currentUser.teamIds)) currentUser.teamIds.forEach(pushId);
        pushId(currentUser.teamId);
      }
    }

    if (typeof this._getVisibleTeamIdsForLimitedEvents === 'function') {
      this._getVisibleTeamIdsForLimitedEvents().forEach(pushId);
    }

    const result = [];
    ids.forEach(id => {
      const team = activeTeamMap.get(id);
      if (team) {
        result.push({
          id: String(team.id || id),
          name: this._resolveTeamDisplayName(team.id || id, team.name || ''),
        });
        return;
      }
      result.push({ id, name: this._resolveTeamDisplayName(id) });
    });

    result.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id), 'zh-Hant'));
    return result;
  },

  _getSelectedTeamValues(select) {
    if (!select) return [];
    return Array.from(select.selectedOptions || [])
      .map(opt => ({
        id: String(opt.value || '').trim(),
        name: opt.dataset?.name || opt.textContent || String(opt.value || '').trim(),
      }))
      .filter(t => t.id);
  },

  _setTeamSelectValues(select, teamIds = []) {
    if (!select) return;
    const selected = new Set((Array.isArray(teamIds) ? teamIds : [teamIds]).map(v => String(v || '').trim()).filter(Boolean));
    Array.from(select.options).forEach(opt => {
      opt.selected = selected.has(String(opt.value || '').trim());
    });
  },

  _populateTeamSelect(select, presetTeamIds = [], presetTeamNames = []) {
    if (!select) return [];
    const teams = this._getTeamOnlyCandidateTeams();
    const teamMap = new Map(teams.map(t => [String(t.id), t]));
    const normalizedPresetTeamIds = (Array.isArray(presetTeamIds) ? presetTeamIds : [presetTeamIds])
      .map(id => String(id || '').trim())
      .filter(Boolean);
    const presetNameHints = this._buildTeamNameHints(normalizedPresetTeamIds, presetTeamNames);

    normalizedPresetTeamIds.forEach(id => {
      const v = String(id || '').trim();
      if (!v) return;

      const hintedName = presetNameHints.get(v) || '';
      const existing = teamMap.get(v);
      if (existing) {
        teamMap.set(v, {
          ...existing,
          id: String(existing.id || v),
          name: this._resolveTeamDisplayName(existing.id || v, existing.name || hintedName),
        });
        return;
      }

      teamMap.set(v, { id: v, name: this._resolveTeamDisplayName(v, hintedName) });
    });

    const renderTeams = Array.from(teamMap.values()).map(team => {
      const teamId = String(team?.id || '').trim();
      const hintedName = presetNameHints.get(teamId) || '';
      return {
        ...team,
        id: teamId,
        name: this._resolveTeamDisplayName(teamId, team?.name || hintedName),
      };
    }).filter(team => team.id);

    select.multiple = true;
    select.innerHTML = renderTeams.map(t =>
      `<option value="${t.id}" data-name="${escapeHTML(t.name || t.id)}">${escapeHTML(t.name || t.id)}</option>`
    ).join('');
    this._setTeamSelectValues(select, normalizedPresetTeamIds);
    if (this._getSelectedTeamValues(select).length === 0 && renderTeams.length === 1) {
      select.options[0].selected = true;
    }
    select.size = Math.min(Math.max(renderTeams.length || 0, 2), 6);
    select.disabled = renderTeams.length === 0;
    select.style.display = 'none';
    this._renderTeamOnlyPicker();
    return renderTeams;
  },

  _setTeamOptionSelected(teamId, selected) {
    const select = document.getElementById('ce-team-select');
    if (!select) return;
    const targetId = String(teamId || '').trim();
    if (!targetId) return;
    const option = Array.from(select.options || []).find(opt => String(opt.value || '').trim() === targetId);
    if (!option) return;
    const nextValue = !!selected;
    if (option.selected === nextValue) return;
    option.selected = nextValue;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  },

  _renderTeamOnlyPicker() {
    const cb = document.getElementById('ce-team-only');
    const select = document.getElementById('ce-team-select');
    const picker = document.getElementById('ce-team-picker');
    const chips = document.getElementById('ce-team-chips');
    const search = document.getElementById('ce-team-search');
    const list = document.getElementById('ce-team-list');
    if (!select || !picker || !chips || !search || !list) return;

    if (!cb?.checked) {
      picker.style.display = 'none';
      chips.innerHTML = '';
      list.innerHTML = '';
      search.value = '';
      return;
    }

    const options = Array.from(select.options || []);
    if (options.length === 0) {
      picker.style.display = 'none';
      chips.innerHTML = '';
      list.innerHTML = '';
      return;
    }

    picker.style.display = '';
    const selectedVals = this._getSelectedTeamValues(select);
    chips.innerHTML = selectedVals.length > 0
      ? selectedVals.map(team => `
          <button type="button" class="ce-team-chip" data-team-id="${escapeHTML(team.id)}" title="取消選擇 ${escapeHTML(team.name)}">
            <span>${escapeHTML(team.name)}</span>
            <span class="ce-team-chip-remove">×</span>
          </button>
        `).join('')
      : '<span class="ce-team-placeholder">尚未選擇球隊</span>';

    const keyword = String(search.value || '').trim().toLowerCase();
    const filtered = options.filter(opt => {
      if (!keyword) return true;
      const name = String(opt.dataset?.name || opt.textContent || opt.value || '').toLowerCase();
      return name.includes(keyword);
    });

    if (filtered.length === 0) {
      list.innerHTML = '<div class="ce-team-empty">找不到符合的球隊</div>';
      return;
    }

    list.innerHTML = filtered.map(opt => {
      const teamId = String(opt.value || '').trim();
      const teamName = String(opt.dataset?.name || opt.textContent || teamId);
      const checkedAttr = opt.selected ? ' checked' : '';
      return `
        <label class="ce-team-item">
          <input type="checkbox" data-team-id="${escapeHTML(teamId)}"${checkedAttr}>
          <span>${escapeHTML(teamName)}</span>
        </label>
      `;
    }).join('');
  },

  _bindTeamOnlyPickerEvents() {
    const search = document.getElementById('ce-team-search');
    const list = document.getElementById('ce-team-list');
    const chips = document.getElementById('ce-team-chips');

    if (search && !search.dataset.bound) {
      search.dataset.bound = '1';
      search.addEventListener('input', () => this._renderTeamOnlyPicker());
    }

    if (list && !list.dataset.bound) {
      list.dataset.bound = '1';
      list.addEventListener('change', (ev) => {
        const input = ev.target instanceof HTMLInputElement ? ev.target : null;
        if (!input || input.type !== 'checkbox') return;
        this._setTeamOptionSelected(input.dataset.teamId, input.checked);
      });
    }

    if (chips && !chips.dataset.bound) {
      chips.dataset.bound = '1';
      chips.addEventListener('click', (ev) => {
        const target = ev.target instanceof Element ? ev.target : null;
        const chip = target ? target.closest('.ce-team-chip[data-team-id]') : null;
        if (!chip) return;
        this._setTeamOptionSelected(chip.dataset.teamId, false);
      });
    }
  },

  _resolveTeamOnlySelection() {
    const select = document.getElementById('ce-team-select');
    const selectedVals = this._getSelectedTeamValues(select);
    if (selectedVals.length > 0) return selectedVals;
    if (select && (select.options?.length || 0) > 0) return [];
    const team = this._getEventCreatorTeam();
    if (team?.teamId) {
      return [{ id: String(team.teamId), name: team.teamName || String(team.teamId) }];
    }
    return [];
  },

  _updateTeamOnlyLabel() {
    const cb = document.getElementById('ce-team-only');
    const label = document.getElementById('ce-team-only-label');
    const select = document.getElementById('ce-team-select');
    if (!cb || !label) return;

    if (!cb.checked) {
      label.textContent = '未啟用：所有人都可見';
      label.style.color = 'var(--text-muted)';
      if (select) select.style.display = 'none';
      this._renderTeamOnlyPicker();
      return;
    }

    label.style.color = '#e11d48';
    const teams = this._getTeamOnlyCandidateTeams();
    if (select) select.style.display = 'none';

    if (teams.length === 0) {
      label.textContent = '已啟用：目前沒有可選球隊';
      this._renderTeamOnlyPicker();
      return;
    }

    const selectedVals = this._resolveTeamOnlySelection();
    if (selectedVals.length === 0) {
      label.textContent = '已啟用：請至少選擇 1 支球隊';
      this._renderTeamOnlyPicker();
      return;
    }

    if (selectedVals.length === 1) {
      label.textContent = `已啟用：僅限「${selectedVals[0].name}」`;
      this._renderTeamOnlyPicker();
      return;
    }

    label.textContent = `已啟用：已選 ${selectedVals.length} 支球隊`;
    this._renderTeamOnlyPicker();
  },

  bindTeamOnlyToggle() {
    const cb = document.getElementById('ce-team-only');
    const select = document.getElementById('ce-team-select');
    this._bindTeamOnlyPickerEvents();
    if (cb && !cb.dataset.bound) {
      cb.dataset.bound = '1';
      cb.addEventListener('change', () => {
        if (cb.checked && select) {
          this._populateTeamSelect(select);
        } else if (select) {
          Array.from(select.options || []).forEach(opt => { opt.selected = false; });
        }
        this._updateTeamOnlyLabel();
      });
    }
    if (select && !select.dataset.bound) {
      select.dataset.bound = '1';
      select.addEventListener('change', () => this._updateTeamOnlyLabel());
    }
    this._updateTeamOnlyLabel();
  },

});
