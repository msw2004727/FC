/* ================================================
   SportHub — Team: Filter, Tab, Pin & Admin Actions
   純函式已抽至 team-list-helpers.js / team-list-stats.js。
   本檔只留 DOM 操作膠水 + 管理操作。
   依賴：team-list-helpers.js, team-list-stats.js, api-service.js
   ================================================ */

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

  openTeamCreateFromTeamsPage() {
    this._showTeamTypeSelect();
  },

  _currentTeamTypeTab: '',

  switchTeamTypeTab(type) {
    this._currentTeamTypeTab = type || '';
    document.querySelectorAll('.team-type-tab').forEach(btn => {
      btn.classList.toggle('active', (btn.dataset.type || '') === this._currentTeamTypeTab);
    });
    this.filterTeams();
  },

  filterTeams() {
    const query = (document.getElementById('team-search')?.value || '').trim().toLowerCase();
    const region = document.getElementById('team-region-filter')?.value || '';
    const sport = document.getElementById('team-sport-filter')?.value || '';
    const typeTab = this._currentTeamTypeTab || '';
    const container = document.getElementById('team-list');

    this._initTeamListSportFilter?.();
    // 同步右上角運動篩選到下拉選單
    const sportSel = document.getElementById('team-sport-filter');
    const globalSportSync = (typeof App !== 'undefined' && App._activeSport && App._activeSport !== 'all') ? App._activeSport : '';
    if (sportSel && globalSportSync && !sport) sportSel.value = globalSportSync;

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
    const globalSport = (typeof App !== 'undefined' && App._activeSport && App._activeSport !== 'all') ? App._activeSport : '';
    const effectiveSport = sport || globalSport;
    if (effectiveSport) {
      filtered = filtered.filter(t => t.sportTag === effectiveSport);
    }
    if (typeTab) {
      filtered = filtered.filter(t => {
        const teamType = t.type || 'general';
        return teamType === typeTab;
      });
    }

    const sorted = this._sortTeams(filtered);
    container.innerHTML = sorted.length > 0
      ? sorted.map(t => this._teamCardHTML(t)).join('')
      : `<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-muted);font-size:.85rem">${t('team.noMatch')}</div>`;
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

  // ── 從 team-form-search.js 搬入（與 toggleTeamPin/toggleTeamActive 同級）──

  async removeTeam(id) {
    const t = ApiService.getTeam(id);
    if (!t) return;
    if (!(await this.appConfirm(`確定要刪除「${t.name}」？此操作無法復原。`))) return;
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
  },

});
