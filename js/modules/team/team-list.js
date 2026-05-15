/* ================================================
   SportHub — Team: Filter, Tab, Pin & Admin Actions
   純函式已抽至 team-list-helpers.js / team-list-stats.js。
   本檔只留 DOM 操作膠水 + 管理操作。
   依賴：team-list-helpers.js, team-list-stats.js, api-service.js
   ================================================ */

function _resolveTeamSportFilterSync(currentValue, lastSyncedGlobalSport, globalSport, forceSync) {
  const current = String(currentValue || '');
  const lastSynced = String(lastSyncedGlobalSport || '');
  const globalValue = String(globalSport || '');
  const shouldSync = !!forceSync || current === '' || current === lastSynced;
  const value = shouldSync ? globalValue : current;
  return {
    value,
    syncedGlobalSport: shouldSync ? globalValue : lastSynced,
    effectiveSport: value || globalValue,
  };
}

Object.assign(App, {

  _getUserTeamIds(user) {
    if (!user) return [];
    const ids = [];
    const seen = new Set();
    const pushId = (id) => {
      const v = String(id || '').trim();
      if (!v || seen.has(v)) return;
      seen.add(v);
      ids.push(v);
    };
    if (Array.isArray(user.teamIds)) user.teamIds.forEach(pushId);
    pushId(user.teamId);
    return ids;
  },

  _isUserInTeam(user, teamId) {
    if (!user || !teamId) return false;
    return this._getUserTeamIds(user).includes(String(teamId));
  },

  _refreshTeamCreateButtons() {
    const canCreate = this._canCreateTeamByPermission();
    const pageBtn = document.getElementById('team-page-create-btn');
    if (pageBtn) pageBtn.style.display = canCreate ? '' : 'none';

    const manageBtn = document.getElementById('team-manage-create-btn');
    if (manageBtn) manageBtn.style.display = canCreate ? '' : 'none';
  },

  async openTeamCreateFromTeamsPage() {
    if (typeof this._showTeamTypeSelect !== 'function'
      && typeof ScriptLoader !== 'undefined'
      && typeof ScriptLoader.ensureGroup === 'function') {
      try {
        await ScriptLoader.ensureGroup('teamForm');
      } catch (err) {
        console.error('[TeamList] team form scripts failed to load:', err);
        this.showToast?.('無法開啟新增俱樂部表單，請稍後再試');
        return;
      }
    }
    if (typeof this.showTeamForm === 'function') {
      this._pendingTeamCreateType = 'general';
      this.showTeamForm(null);
    }
  },

  _currentTeamTypeTab: '',
  _teamFilterExpanded: false,

  switchTeamTypeTab(type) {
    this._currentTeamTypeTab = type === 'education' ? 'education' : '';
    document.querySelectorAll('.team-type-tab').forEach(btn => {
      btn.classList.toggle('active', (btn.dataset.type || '') === this._currentTeamTypeTab);
    });
    this.filterTeams();
  },

  _hasActiveTeamListFilters() {
    return !!(
      (document.getElementById('team-search')?.value || '').trim() ||
      (document.getElementById('team-sport-filter')?.value || '') ||
      (document.getElementById('team-region-filter')?.value || '')
    );
  },

  _syncTeamFilterPanelState() {
    const panel = document.getElementById('team-filter-panel');
    const btn = document.getElementById('team-filter-toggle-btn');
    const isOpen = !!panel && panel.hidden !== true;
    const isActive = isOpen || this._hasActiveTeamListFilters();
    this._teamFilterExpanded = isOpen;
    if (panel) panel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    if (btn) {
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }
  },

  toggleTeamFilterPanel(force) {
    const panel = document.getElementById('team-filter-panel');
    if (!panel) return;
    const nextOpen = typeof force === 'boolean' ? force : panel.hidden === true;
    panel.hidden = !nextOpen;
    this._teamFilterExpanded = nextOpen;
    this._syncTeamFilterPanelState();
    if (nextOpen) {
      this._initTeamListSportFilter?.();
      requestAnimationFrame(() => {
        document.getElementById('team-search')?.focus?.({ preventScroll: true });
      });
    }
  },

  _teamFilterTimer: null,

  filterTeams() {
    this._syncTeamFilterPanelState?.();
    clearTimeout(this._teamFilterTimer);
    this._teamFilterTimer = setTimeout(() => this._doFilterTeams(), 300);
  },

  _getActiveTeamGlobalSport() {
    return (typeof App !== 'undefined' && App._activeSport && App._activeSport !== 'all') ? App._activeSport : '';
  },

  _syncTeamSportFilterWithGlobal(options = {}) {
    this._initTeamListSportFilter?.();
    const sportSel = document.getElementById('team-sport-filter');
    const globalSport = this._getActiveTeamGlobalSport();
    if (!sportSel) return globalSport;

    const resolved = _resolveTeamSportFilterSync(
      sportSel.value,
      sportSel.dataset.syncedGlobalSport,
      globalSport,
      options.force === true
    );
    if (sportSel.value !== resolved.value) sportSel.value = resolved.value;
    sportSel.dataset.syncedGlobalSport = resolved.syncedGlobalSport;
    return resolved.effectiveSport;
  },

  _doFilterTeams() {
    const query = (document.getElementById('team-search')?.value || '').trim().toLowerCase();
    const region = document.getElementById('team-region-filter')?.value || '';
    const sport = this._syncTeamSportFilterWithGlobal?.() || '';
    const typeTab = this._currentTeamTypeTab || '';
    const container = document.getElementById('team-list');

    let filtered = ApiService.getActiveTeams();
    if (query) {
      filtered = filtered.filter(t =>
        t.name.toLowerCase().includes(query) ||
        (t.nameEn || '').toLowerCase().includes(query) ||
        (t.captain || '').toLowerCase().includes(query) ||
        (t.leader || '').toLowerCase().includes(query)
      );
    }
    if (region) {
      filtered = filtered.filter(t => t.region === region);
    }
    if (sport) {
      filtered = filtered.filter(t => t.sportTag === sport);
    }
    if (typeTab) {
      filtered = filtered.filter(t => {
        const isTeaching = typeof this._isTeamTeachingTagged === 'function'
          ? this._isTeamTeachingTagged(t)
          : (t.type || 'general') === 'education';
        return typeTab === 'education' ? isTeaching : !isTeaching;
      });
    }

    const sorted = this._sortTeams(filtered);
    const memberCountByTeam = this._buildTeamMemberCountMap?.(sorted, ApiService.getAdminUsers() || []) || null;
    container.innerHTML = sorted.length > 0
      ? sorted.map(t => this._teamCardHTML(t, { memberCountByTeam })).join('')
      : `<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-muted);font-size:.85rem">${t('team.noMatch')}</div>`;

    // Phase 2B §8.2A：快取不完整且搜尋無結果 → 顯示「搜尋所有俱樂部」按鈕
    if (query && sorted.length === 0 && !FirebaseService._teamAllLoaded) {
      container.insertAdjacentHTML('beforeend',
        '<div style="grid-column:1/-1;text-align:center;padding:1rem">' +
        '<button class="outline-btn" style="font-size:.8rem;padding:.4rem 1rem" ' +
        'onclick="App.searchTeamsFromServer()">找不到？搜尋所有俱樂部</button></div>');
    }
  },

  /** Phase 2B §8.2A：server-side 全集合搜尋（載入所有尚未載入的俱樂部） */
  async searchTeamsFromServer() {
    var query = (document.getElementById('team-search')?.value || '').trim();
    if (!query) return;
    this.showToast('搜尋中...');
    while (!FirebaseService._teamAllLoaded) {
      var loaded = await FirebaseService.loadMoreTeams();
      if (loaded <= 0) break;
    }
    this._doFilterTeams();
  },

  _pinCounter: 100,

  filterAdminTeams() {
    const q = (document.getElementById('team-search-input')?.value || '').trim().toLowerCase();
    this.renderAdminTeams(q);
  },

  toggleTeamPin(id) {
    const t = ApiService.getTeam(id);
    if (!t) return;
    t.pinned = !t.pinned;
    if (t.pinned) {
      this._pinCounter++;
      t.pinOrder = this._pinCounter;
    } else {
      t.pinOrder = 0;
    }
    ApiService.updateTeam(id, { pinned: t.pinned, pinOrder: t.pinOrder });
    this.renderAdminTeams();
    this.renderTeamManage();
    this.renderTeamList();
    this.showToast(t.pinned ? `已置頂「${t.name}」` : `已取消置頂「${t.name}」`);
  },

  toggleTeamActive(id) {
    const t = ApiService.getTeam(id);
    if (!t) return;
    t.active = !t.active;
    ApiService.updateTeam(id, { active: t.active });
    this.renderAdminTeams();
    this.renderTeamList();
    this.renderTeamManage();
    this.showToast(t.active ? `已上架「${t.name}」` : `已下架「${t.name}」`);
  },

  async toggleTeamAttentionEffect(id, enabled, inputEl) {
    const t = ApiService.getTeam(id);
    if (!t) return;
    if (!this.hasPermission('team.manage_all')) {
      if (inputEl) inputEl.checked = !enabled;
      this.showToast('\u53ea\u6709\u7ba1\u7406\u54e1\u53ef\u4ee5\u8abf\u6574\u5149\u8de1\u6548\u679c');
      return;
    }
    const previousEnabled = t.attentionEffectEnabled === true;
    const color = this._normalizeTeamAttentionColor?.(t.attentionEffectColor) || '#fbbf24';
    if (inputEl) inputEl.disabled = true;
    try {
      await ApiService.updateTeamAwait(id, {
        attentionEffectEnabled: !!enabled,
        attentionEffectColor: color,
      });
      t.attentionEffectEnabled = !!enabled;
      t.attentionEffectColor = color;
      this.renderAdminTeams();
      this.renderTeamManage();
      this.renderTeamList();
      ApiService._writeOpLog?.(
        'team_attention_effect',
        '\u5149\u8de1\u6548\u679c',
        '\u5c07\u300c' + (t.name || id) + '\u300d\u5149\u8de1\u6548\u679c' + (enabled ? '\u958b\u555f' : '\u95dc\u9589')
      );
      this.showToast(enabled ? '\u5149\u8de1\u6548\u679c\u5df2\u958b\u555f' : '\u5149\u8de1\u6548\u679c\u5df2\u95dc\u9589');
    } catch (err) {
      console.error('[toggleTeamAttentionEffect]', err);
      if (inputEl) inputEl.checked = previousEnabled;
      if (!err?._toasted) this.showToast('\u5149\u8de1\u6548\u679c\u66f4\u65b0\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
    } finally {
      if (inputEl) inputEl.disabled = false;
    }
  },

  async changeTeamAttentionEffectColor(id, colorValue, inputEl) {
    const t = ApiService.getTeam(id);
    if (!t) return;
    if (!this.hasPermission('team.manage_all')) {
      if (inputEl) inputEl.value = this._normalizeTeamAttentionColor?.(t.attentionEffectColor) || '#fbbf24';
      this.showToast('\u53ea\u6709\u7ba1\u7406\u54e1\u53ef\u4ee5\u8abf\u6574\u5149\u8de1\u984f\u8272');
      return;
    }
    const previousColor = this._normalizeTeamAttentionColor?.(t.attentionEffectColor) || '#fbbf24';
    const nextColor = this._normalizeTeamAttentionColor?.(colorValue) || previousColor;
    if (inputEl) {
      inputEl.value = nextColor;
      inputEl.disabled = true;
    }
    try {
      await ApiService.updateTeamAwait(id, { attentionEffectColor: nextColor });
      t.attentionEffectColor = nextColor;
      this.renderAdminTeams();
      this.renderTeamManage();
      this.renderTeamList();
      ApiService._writeOpLog?.('team_attention_effect_color', '\u5149\u8de1\u984f\u8272', '\u66f4\u65b0\u300c' + (t.name || id) + '\u300d\u5149\u8de1\u984f\u8272');
      this.showToast('\u5149\u8de1\u984f\u8272\u5df2\u66f4\u65b0');
    } catch (err) {
      console.error('[changeTeamAttentionEffectColor]', err);
      if (inputEl) inputEl.value = previousColor;
      if (!err?._toasted) this.showToast('\u5149\u8de1\u984f\u8272\u66f4\u65b0\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
    } finally {
      if (inputEl) inputEl.disabled = false;
    }
  },

  // ── 從 team-form-search.js 搬入（與 toggleTeamPin/toggleTeamActive 同級）──

  async removeTeam(btn, id) {
    const t = ApiService.getTeam(id);
    if (!t) return;
    if (!(await this.appConfirm(`確定要刪除「${t.name}」？此操作無法復原。`))) return;

    return this._withButtonLoading(btn, '刪除中...', async () => {
      const tName = t.name;

      // 刪隊前收集俱樂部經理 + 領隊 + 教練 uid，用於刪隊後降級檢查
      const affectedUids = [];
      const allUsers = ApiService.getAdminUsers();
      if (t.captainUid) {
        affectedUids.push(t.captainUid);
      } else if (t.captain) {
        const capUser = allUsers.find(u => u.name === t.captain);
        if (capUser) affectedUids.push(capUser.uid);
      }
      (t.leaderUids || (t.leaderUid ? [t.leaderUid] : [])).forEach(lUid => {
        if (lUid && !affectedUids.includes(lUid)) affectedUids.push(lUid);
      });
      (t.coaches || []).forEach(cName => {
        const cUser = allUsers.find(u => u.name === cName);
        if (cUser && !affectedUids.includes(cUser.uid)) affectedUids.push(cUser.uid);
      });

      try {
        await ApiService.deleteTeam(id);
      } catch (err) {
        console.error('[removeTeam] delete failed:', err);
        this.showToast('刪除俱樂部失敗，請稍後再試');
        ApiService._writeErrorLog({ fn: 'removeTeam', teamId: id, teamName: tName }, err);
        return;
      }
      ApiService._writeOpLog('team_delete', '刪除俱樂部', `刪除「${tName}」`);

      // 刪隊後逐一重新計算角色
      affectedUids.forEach(uid => {
        this._applyRoleChange(ApiService._recalcUserRole(uid));
      });

      this.showToast(`已刪除「${tName}」`);
      this.showPage('page-teams');
      this.renderTeamList();
      this.renderAdminTeams();
      this.renderTeamManage();
      this.renderProfileData();
      this.renderHotEvents();
      this.renderActivityList();
    });
  },

});
