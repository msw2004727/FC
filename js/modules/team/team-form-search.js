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
    const exclude = [...this._teamFormState.leaders];
    const results = this._teamSearchUsers(q, exclude);
    this._renderSuggestList('ct-leader-suggest', results, 'selectTeamLeader');
  },

  selectTeamLeader(uid) {
    if (this._teamFormState.leaders.includes(uid)) return;
    this._teamFormState.leaders.push(uid);
    document.getElementById('ct-leader-search').value = '';
    document.getElementById('ct-leader-suggest').innerHTML = '';
    document.getElementById('ct-leader-suggest').classList.remove('show');
    this._renderLeaderTags();
  },

  _removeLeader(uid) {
    this._teamFormState.leaders = this._teamFormState.leaders.filter(u => u !== uid);
    this._renderLeaderTags();
  },

  _renderLeaderTags() {
    const users = ApiService.getAdminUsers();
    document.getElementById('ct-leaders-tags').innerHTML = this._teamFormState.leaders.map(uid => {
      const u = users.find(u => u.uid === uid);
      return u ? `<span class="team-tag" data-no-translate>${escapeHTML(u.name)}<span class="team-tag-x" onclick="App._removeLeader('${escapeHTML(uid)}')">×</span></span>` : '';
    }).join('');
  },

  searchTeamCaptain() {
    const q = document.getElementById('ct-captain-search').value.trim();
    if (!q) { document.getElementById('ct-captain-suggest').classList.remove('show'); return; }
    const exclude = [];
    if (this._teamFormState.captain) exclude.push(this._teamFormState.captain);
    const results = this._teamSearchUsers(q, exclude);
    this._renderSuggestList('ct-captain-suggest', results, 'selectTeamCaptain');
  },

  selectTeamCaptain(uid) {
    const users = ApiService.getAdminUsers();
    const user = users.find(u => u.uid === uid);
    if (!user) return;
    this._teamFormState.captain = uid;
    document.getElementById('ct-captain-search').value = '';
    document.getElementById('ct-captain-suggest').innerHTML = '';
    document.getElementById('ct-captain-suggest').classList.remove('show');
    const prefix = this._teamFormState.editId ? '轉移至：' : '';
    document.getElementById('ct-captain-selected').innerHTML =
      `<span class="team-tag" data-no-translate>${prefix}${user.name}<span class="team-tag-x" onclick="App.clearTeamCaptain()">×</span></span>`;
  },

  clearTeamCaptain() {
    // 編輯模式：恢復原領隊
    if (this._teamFormState.editId) {
      const t = ApiService.getTeam(this._teamFormState.editId);
      if (t && t.captain) {
        const users = ApiService.getAdminUsers();
        const found = users.find(u => u.name === t.captain);
        this._teamFormState.captain = found ? found.uid : null;
      } else {
        this._teamFormState.captain = null;
      }
    } else {
      // 新增模式：清除至空
      this._teamFormState.captain = null;
    }
    document.getElementById('ct-captain-selected').innerHTML = '';
  },

  searchTeamCoach() {
    if (this.hasPermission && !this.hasPermission('team.assign_coach') && !this.hasPermission('team.manage_all') && !this.hasPermission('admin.teams.entry')) { this.showToast('權限不足'); return; }
    const q = document.getElementById('ct-coach-search').value.trim();
    if (!q) { document.getElementById('ct-coach-suggest').classList.remove('show'); return; }
    const exclude = [...this._teamFormState.coaches];
    const results = this._teamSearchUsers(q, exclude);
    this._renderSuggestList('ct-coach-suggest', results, 'selectTeamCoach');
  },

  selectTeamCoach(uid) {
    if (this._teamFormState.coaches.includes(uid)) return;
    this._teamFormState.coaches.push(uid);
    document.getElementById('ct-coach-search').value = '';
    document.getElementById('ct-coach-suggest').innerHTML = '';
    document.getElementById('ct-coach-suggest').classList.remove('show');
    this._renderCoachTags();
  },

  removeTeamCoach(uid) {
    this._teamFormState.coaches = this._teamFormState.coaches.filter(u => u !== uid);
    this._renderCoachTags();
  },

  _renderCoachTags() {
    const users = ApiService.getAdminUsers();
    document.getElementById('ct-coach-tags').innerHTML = this._teamFormState.coaches.map(uid => {
      const u = users.find(u => u.uid === uid);
      return u ? `<span class="team-tag" data-no-translate>${escapeHTML(u.name)}<span class="team-tag-x" onclick="App.removeTeamCoach('${escapeHTML(uid)}')">×</span></span>` : '';
    }).join('');
  },

  // removeTeam → 已搬至 team-list.js

});
