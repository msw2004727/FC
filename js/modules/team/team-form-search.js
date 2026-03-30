/* ================================================
   SportHub — Team: Form Search UI (Leader/Captain/Coach)
   Note: innerHTML usage is safe — all user content passes through escapeHTML()
   ================================================ */

Object.assign(App, {

  _teamSearchUsers(query, excludeUids) {
    const users = ApiService.getAdminUsers();
    const q = query.toLowerCase();
    return users.filter(u =>
      !excludeUids.includes(u.uid) &&
      ((u.name || '').toLowerCase().includes(q) || (u.uid || '').toLowerCase().includes(q))
    ).slice(0, 5);
  },

  _renderSuggestList(containerId, results, onSelectFn) {
    const el = document.getElementById(containerId);
    if (!results.length) { el.innerHTML = ''; el.classList.remove('show'); return; }
    el.innerHTML = results.map(u =>
      `<div class="team-user-suggest-item" onclick="App.${onSelectFn}('${escapeHTML(u.uid)}')">
        <span class="tus-name">${escapeHTML(u.name)}</span>
        <span class="tus-uid">${escapeHTML(u.uid)}</span>
      </div>`
    ).join('');
    el.classList.add('show');
  },

  searchTeamLeader() {
    const q = document.getElementById('ct-leader-search').value.trim();
    if (!q) { document.getElementById('ct-leader-suggest').classList.remove('show'); return; }
    const exclude = [...this._teamLeaderUids];
    const results = this._teamSearchUsers(q, exclude);
    this._renderSuggestList('ct-leader-suggest', results, 'selectTeamLeader');
  },

  selectTeamLeader(uid) {
    if (this._teamLeaderUids.includes(uid)) return;
    this._teamLeaderUids.push(uid);
    document.getElementById('ct-leader-search').value = '';
    document.getElementById('ct-leader-suggest').innerHTML = '';
    document.getElementById('ct-leader-suggest').classList.remove('show');
    this._renderLeaderTags();
  },

  _removeLeader(uid) {
    this._teamLeaderUids = this._teamLeaderUids.filter(u => u !== uid);
    this._renderLeaderTags();
  },

  _renderLeaderTags() {
    const users = ApiService.getAdminUsers();
    document.getElementById('ct-leaders-tags').innerHTML = this._teamLeaderUids.map(uid => {
      const u = users.find(u => u.uid === uid);
      return u ? `<span class="team-tag">${escapeHTML(u.name)}<span class="team-tag-x" onclick="App._removeLeader('${escapeHTML(uid)}')">×</span></span>` : '';
    }).join('');
  },

  searchTeamCaptain() {
    const q = document.getElementById('ct-captain-search').value.trim();
    if (!q) { document.getElementById('ct-captain-suggest').classList.remove('show'); return; }
    const exclude = [];
    if (this._teamCaptainUid) exclude.push(this._teamCaptainUid);
    const results = this._teamSearchUsers(q, exclude);
    this._renderSuggestList('ct-captain-suggest', results, 'selectTeamCaptain');
  },

  selectTeamCaptain(uid) {
    const users = ApiService.getAdminUsers();
    const user = users.find(u => u.uid === uid);
    if (!user) return;
    this._teamCaptainUid = uid;
    document.getElementById('ct-captain-search').value = '';
    document.getElementById('ct-captain-suggest').innerHTML = '';
    document.getElementById('ct-captain-suggest').classList.remove('show');
    const prefix = this._teamEditId ? '轉移至：' : '';
    document.getElementById('ct-captain-selected').innerHTML =
      `<span class="team-tag">${prefix}${user.name}<span class="team-tag-x" onclick="App.clearTeamCaptain()">×</span></span>`;
  },

  clearTeamCaptain() {
    // 編輯模式：恢復原領隊
    if (this._teamEditId) {
      const t = ApiService.getTeam(this._teamEditId);
      if (t && t.captain) {
        const users = ApiService.getAdminUsers();
        const found = users.find(u => u.name === t.captain);
        this._teamCaptainUid = found ? found.uid : null;
      } else {
        this._teamCaptainUid = null;
      }
    } else {
      // 新增模式：清除至空
      this._teamCaptainUid = null;
    }
    document.getElementById('ct-captain-selected').innerHTML = '';
  },

  searchTeamCoach() {
    if (this.hasPermission && !this.hasPermission('team.assign_coach') && !this.hasPermission('team.manage_all') && !this.hasPermission('admin.teams.entry')) { this.showToast('權限不足'); return; }
    const q = document.getElementById('ct-coach-search').value.trim();
    if (!q) { document.getElementById('ct-coach-suggest').classList.remove('show'); return; }
    const exclude = [...this._teamCoachUids];
    const results = this._teamSearchUsers(q, exclude);
    this._renderSuggestList('ct-coach-suggest', results, 'selectTeamCoach');
  },

  selectTeamCoach(uid) {
    if (this._teamCoachUids.includes(uid)) return;
    this._teamCoachUids.push(uid);
    document.getElementById('ct-coach-search').value = '';
    document.getElementById('ct-coach-suggest').innerHTML = '';
    document.getElementById('ct-coach-suggest').classList.remove('show');
    this._renderCoachTags();
  },

  removeTeamCoach(uid) {
    this._teamCoachUids = this._teamCoachUids.filter(u => u !== uid);
    this._renderCoachTags();
  },

  _renderCoachTags() {
    const users = ApiService.getAdminUsers();
    document.getElementById('ct-coach-tags').innerHTML = this._teamCoachUids.map(uid => {
      const u = users.find(u => u.uid === uid);
      return u ? `<span class="team-tag">${escapeHTML(u.name)}<span class="team-tag-x" onclick="App.removeTeamCoach('${escapeHTML(uid)}')">×</span></span>` : '';
    }).join('');
  },

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
    // Demo 模式：同步清除 _userTeam
    if (ModeManager.isDemo() && this._userTeam === id) this._userTeam = null;
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
