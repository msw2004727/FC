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
    if (!id) return '未知俱樂部';

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

    return '未知俱樂部';
  },

  _isCurrentUserTeamStaffForEventScope(team) {
    const currentUser = ApiService.getCurrentUser?.() || null;
    if (!team || !currentUser) return false;

    const currentUserIds = new Set([currentUser.uid]
      .map(value => String(value || '').trim())
      .filter(Boolean));
    if (currentUserIds.size === 0) return false;

    const staffIds = [
      team.captainUid,
      team.creatorUid,
      team.ownerUid,
      team.leaderUid,
      ...(Array.isArray(team.leaderUids) ? team.leaderUids : []),
      ...(Array.isArray(team.coachUids) ? team.coachUids : []),
    ].map(value => String(value || '').trim()).filter(Boolean);

    return staffIds.some(uid => currentUserIds.has(uid));
  },

  _getTeamOnlyCandidateTeams() {
    const teams = ApiService.getTeamDirectory?.() || ApiService.getTeams?.() || [];
    const canManageAllActivities = !!this._canManageAllActivities?.();
    const resultMap = new Map();
    teams.forEach(team => {
      if (!team || team.active === false) return;
      if (!canManageAllActivities && !this._isCurrentUserTeamStaffForEventScope(team)) return;
      const id = String(team.id || team._docId || '').trim();
      if (!id || resultMap.has(id)) return;
      resultMap.set(id, {
        id,
        name: this._resolveTeamDisplayName(id, team.name || ''),
      });
    });

    const result = Array.from(resultMap.values());
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

  _getExistingEventTeamOnlyScopeIds() {
    if (!this._editEventId) return [];
    const eventRecord = ApiService.getEvent?.(this._editEventId) || null;
    if (!eventRecord?.teamOnly) return [];

    const ids = [];
    const seen = new Set();
    const pushId = (id) => {
      const value = String(id || '').trim();
      if (!value || seen.has(value)) return;
      seen.add(value);
      ids.push(value);
    };
    if (Array.isArray(eventRecord.creatorTeamIds)) eventRecord.creatorTeamIds.forEach(pushId);
    pushId(eventRecord.creatorTeamId);
    return ids;
  },

  _isSameTeamOnlyScope(leftIds = [], rightIds = []) {
    const normalize = (ids) => Array.from(new Set((Array.isArray(ids) ? ids : [ids])
      .map(id => String(id || '').trim())
      .filter(Boolean)))
      .sort();
    const left = normalize(leftIds);
    const right = normalize(rightIds);
    return left.length === right.length && left.every((id, index) => id === right[index]);
  },

  _isTeamOnlySelectionValidForSubmit(selectedTeams = []) {
    if (this._canManageAllActivities?.()) return true;
    const selectedIds = (Array.isArray(selectedTeams) ? selectedTeams : [])
      .map(team => String(team?.id || '').trim())
      .filter(Boolean);
    if (this._editEventId) {
      const eventRecord = ApiService.getEvent?.(this._editEventId) || null;
      const existingIds = this._getExistingEventTeamOnlyScopeIds();
      return !!eventRecord?.teamOnly
        && existingIds.length > 0
        && this._isSameTeamOnlyScope(selectedIds, existingIds);
    }

    if (selectedIds.length !== 1) return false;
    const allowedIds = new Set(this._getTeamOnlyCandidateTeams().map(team => String(team.id || '').trim()));
    return allowedIds.has(selectedIds[0]);
  },

  _canCreateTeamOnlyActivityForSubmit(selectedTeams = [], options = {}) {
    if (this._editEventId) return true;

    const currentUser = ApiService.getCurrentUser?.() || null;
    const currentUid = String(currentUser?.uid || '').trim();
    if (!currentUid) return false;

    const selectedIds = (Array.isArray(selectedTeams) ? selectedTeams : [])
      .map(team => String(team?.id || '').trim())
      .filter(Boolean);
    const canManageAllActivities = !!this._canManageAllActivities?.();
    const directory = ApiService.getTeamDirectory?.() || ApiService.getTeams?.() || [];
    const selectedTeamRecord = selectedIds.length === 1
      ? (directory.find(team => team && (
        String(team.id || '').trim() === selectedIds[0]
        || String(team._docId || '').trim() === selectedIds[0]
      )) || ApiService.getTeam?.(selectedIds[0]) || null)
      : null;
    const hasExactStaffScope = selectedIds.length === 1
      && this._isCurrentUserTeamStaffForEventScope(selectedTeamRecord);
    const roleKey = String(
      this._getCurrentActivityRoleKey?.()
      || currentUser.role
      || this.currentRole
      || 'user'
    ).trim().toLowerCase() || 'user';
    const hasPermission = code => !!this.hasPermission?.(code);
    const hasEventCreate = hasPermission('event.create');

    if (roleKey === 'user') {
      const hasTeamCreateEvent = hasPermission('team.create_event');
      const hasCapability = code => (typeof this._hasUserActivityCapability === 'function'
        ? !!this._hasUserActivityCapability(code)
        : !!ApiService.hasRoleActivityCapability?.('user', code));
      const hasBasicCreateCapability = hasCapability('user.activity.basic_create');
      const hasAddonCapability = hasCapability('user.activity.addons_use');
      const hasOnlyTeamScopedAddon = options.hasOnlyTeamScopedAddon !== false;
      const directGrantPath = hasOnlyTeamScopedAddon
        && hasEventCreate
        && hasTeamCreateEvent
        && hasExactStaffScope;
      const addonCapabilityPath = hasAddonCapability
        && (hasBasicCreateCapability || hasEventCreate)
        && (canManageAllActivities || (hasTeamCreateEvent && hasExactStaffScope));
      return directGrantPath || addonCapabilityPath;
    }

    const isCoachPlusRole = ['coach', 'captain', 'venue_owner', 'admin', 'super_admin'].includes(roleKey);
    const hasCreateEntry = isCoachPlusRole
      || hasPermission('activity.manage.entry')
      || hasPermission('event.edit_all')
      || hasEventCreate;
    const hasAllowedScope = canManageAllActivities || roleKey === 'super_admin' || hasExactStaffScope;
    return hasCreateEntry && hasAllowedScope;
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
    const canManageAllActivities = !!this._canManageAllActivities?.();
    const teamMap = new Map(teams.map(t => [String(t.id), t]));
    const normalizedPresetTeamIds = (Array.isArray(presetTeamIds) ? presetTeamIds : [presetTeamIds])
      .map(id => String(id || '').trim())
      .filter(Boolean);
    const presetNameHints = this._buildTeamNameHints(normalizedPresetTeamIds, presetTeamNames);
    const existingScopeIds = this._getExistingEventTeamOnlyScopeIds();
    const preserveExistingScope = !canManageAllActivities
      && existingScopeIds.length > 0
      && this._isSameTeamOnlyScope(normalizedPresetTeamIds, existingScopeIds);

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

      if (!canManageAllActivities && !existingScopeIds.includes(v)) return;
      teamMap.set(v, { id: v, name: this._resolveTeamDisplayName(v, hintedName) });
    });

    const renderTeamSource = preserveExistingScope
      ? existingScopeIds.map(id => teamMap.get(id)).filter(Boolean)
      : Array.from(teamMap.values());
    const renderTeams = renderTeamSource.map(team => {
      const teamId = String(team?.id || '').trim();
      const hintedName = presetNameHints.get(teamId) || '';
      return {
        ...team,
        id: teamId,
        name: this._resolveTeamDisplayName(teamId, preserveExistingScope ? hintedName : (team?.name || hintedName)),
      };
    }).filter(team => team.id);

    const selectedPresetTeamIds = (canManageAllActivities || preserveExistingScope)
      ? normalizedPresetTeamIds
      : normalizedPresetTeamIds.slice(0, 1);
    select.multiple = canManageAllActivities || (preserveExistingScope && selectedPresetTeamIds.length > 1);
    select.dataset.teamScopeLocked = preserveExistingScope ? '1' : '0';
    select.innerHTML = renderTeams.map(t =>
      `<option value="${t.id}" data-name="${escapeHTML(t.name || t.id)}">${escapeHTML(t.name || t.id)}</option>`
    ).join('');
    this._setTeamSelectValues(select, selectedPresetTeamIds);
    const teamOnlyToggle = document.getElementById('ce-team-only');
    if (teamOnlyToggle) {
      const lockCurrentEditScope = !!this._editEventId && !canManageAllActivities;
      teamOnlyToggle.disabled = lockCurrentEditScope;
      teamOnlyToggle.dataset.teamScopeLocked = lockCurrentEditScope ? '1' : '0';
      select.dataset.teamScopeLocked = lockCurrentEditScope ? '1' : '0';
    }
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
    if (select.dataset.teamScopeLocked === '1') return;
    const targetId = String(teamId || '').trim();
    if (!targetId) return;
    const option = Array.from(select.options || []).find(opt => String(opt.value || '').trim() === targetId);
    if (!option) return;
    const nextValue = !!selected;
    if (nextValue && !select.multiple) {
      Array.from(select.options || []).forEach(candidate => {
        candidate.selected = candidate === option;
      });
    } else {
      if (option.selected === nextValue) return;
      option.selected = nextValue;
    }
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
    const isScopeLocked = select.dataset.teamScopeLocked === '1';
    search.disabled = isScopeLocked;
    chips.innerHTML = selectedVals.length > 0
      ? selectedVals.map(team => `
          <button type="button" class="ce-team-chip" data-team-id="${escapeHTML(team.id)}" title="${isScopeLocked ? '限定俱樂部不可變更' : `取消選擇 ${escapeHTML(team.name)}`}"${isScopeLocked ? ' disabled aria-disabled="true"' : ''}>
            <span>${escapeHTML(team.name)}</span>
            <span class="ce-team-chip-remove">×</span>
          </button>
        `).join('')
      : '<span class="ce-team-placeholder">尚未選擇俱樂部</span>';

    const keyword = String(search.value || '').trim().toLowerCase();
    const filtered = options.filter(opt => {
      if (!keyword) return true;
      const name = String(opt.dataset?.name || opt.textContent || opt.value || '').toLowerCase();
      return name.includes(keyword);
    });

    if (filtered.length === 0) {
      list.innerHTML = '<div class="ce-team-empty">找不到符合的俱樂部</div>';
      return;
    }

    list.innerHTML = filtered.map(opt => {
      const teamId = String(opt.value || '').trim();
      const teamName = String(opt.dataset?.name || opt.textContent || teamId);
      const checkedAttr = opt.selected ? ' checked' : '';
      const inputType = select.multiple ? 'checkbox' : 'radio';
      const disabledAttr = isScopeLocked ? ' disabled' : '';
      return `
        <label class="ce-team-item">
          <input type="${inputType}" name="ce-team-scope" data-team-id="${escapeHTML(teamId)}"${checkedAttr}${disabledAttr}>
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
        if (!input || (input.type !== 'checkbox' && input.type !== 'radio')) return;
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

    const selectedVals = this._resolveTeamOnlySelection();
    if (teams.length === 0 && selectedVals.length === 0) {
      label.textContent = '已啟用：目前沒有可選俱樂部';
      this._renderTeamOnlyPicker();
      return;
    }
    if (selectedVals.length === 0) {
      label.textContent = '已啟用：請至少選擇 1 支俱樂部';
      this._renderTeamOnlyPicker();
      return;
    }

    if (selectedVals.length === 1) {
      label.textContent = `已啟用：僅限「${selectedVals[0].name}」`;
      this._renderTeamOnlyPicker();
      return;
    }

    label.textContent = `已啟用：已選 ${selectedVals.length} 支俱樂部`;
    this._renderTeamOnlyPicker();
  },

  _teamOnlyDirectoryRefreshSeq: 0,

  async _refreshTeamOnlyDirectoryIfOpen() {
    const requestSeq = ++this._teamOnlyDirectoryRefreshSeq;
    const modal = document.getElementById('create-event-modal');
    const cb = document.getElementById('ce-team-only');
    const select = document.getElementById('ce-team-select');
    if (!modal?.classList.contains('open') || !cb?.checked || !select) return true;

    let directoryReady = false;
    try {
      if (typeof ApiService.ensureTeamsReady === 'function') {
        directoryReady = await ApiService.ensureTeamsReady();
      }
    } catch (err) {
      console.warn('[EventCreate] team directory load failed:', err);
      return false;
    }
    if (requestSeq !== this._teamOnlyDirectoryRefreshSeq) return false;
    const directoryTeams = ApiService.getTeamDirectory?.() || ApiService.getTeams?.() || [];
    if (!directoryReady && directoryTeams.length === 0) return false;

    const currentModal = document.getElementById('create-event-modal');
    const currentCb = document.getElementById('ce-team-only');
    const currentSelect = document.getElementById('ce-team-select');
    if (!currentModal?.classList.contains('open') || !currentCb?.checked || !currentSelect) return true;

    const selectedTeams = this._getSelectedTeamValues(currentSelect);
    this._populateTeamSelect(
      currentSelect,
      selectedTeams.map(team => team.id),
      selectedTeams.map(team => team.name)
    );
    this._updateTeamOnlyLabel();
    return true;
  },

  bindTeamOnlyToggle() {
    const cb = document.getElementById('ce-team-only');
    const select = document.getElementById('ce-team-select');
    const lockCurrentEditScope = !!this._editEventId && !this._canManageAllActivities?.();
    if (cb) {
      cb.disabled = lockCurrentEditScope;
      cb.dataset.teamScopeLocked = lockCurrentEditScope ? '1' : '0';
    }
    if (select) select.dataset.teamScopeLocked = lockCurrentEditScope ? '1' : '0';
    this._bindTeamOnlyPickerEvents();
    if (cb && !cb.dataset.bound) {
      cb.dataset.bound = '1';
      cb.addEventListener('change', () => {
        this._teamOnlyDirectoryRefreshSeq += 1;
        if (cb.checked && !this._guardActivityAddonToggle?.(cb)) {
          if (select) Array.from(select.options || []).forEach(opt => { opt.selected = false; });
          this._updateTeamOnlyLabel();
          return;
        }
        if (cb.checked && select) {
          this._populateTeamSelect(select);
          void this._refreshTeamOnlyDirectoryIfOpen();
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
