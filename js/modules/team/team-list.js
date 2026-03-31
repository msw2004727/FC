/* ================================================
   SportHub — Team: Search, Filter, Identity & Admin Actions
   依賴：config.js, api-service.js
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

  _normalizeIdentityValue(value) {
    return String(value || '').trim();
  },

  _toNameIdentityKey(name) {
    const normalized = this._normalizeIdentityValue(name).toLowerCase();
    return normalized ? `name:${normalized}` : null;
  },

  _getUserIdentityKey(user) {
    if (!user) return null;
    const uid = this._normalizeIdentityValue(user.uid);
    if (uid) return `uid:${uid}`;
    const docId = this._normalizeIdentityValue(user._docId);
    if (docId) return `doc:${docId}`;
    return this._toNameIdentityKey(user.name || user.displayName);
  },

  _resolveUserIdentityKeyByName(name, users = ApiService.getAdminUsers() || []) {
    const target = this._normalizeIdentityValue(name);
    if (!target) return null;
    const found = users.find(u => {
      const userName = this._normalizeIdentityValue(u.name);
      const displayName = this._normalizeIdentityValue(u.displayName);
      return userName === target || displayName === target;
    });
    return this._getUserIdentityKey(found);
  },

  _buildTeamStaffIdentity(team, users = ApiService.getAdminUsers() || []) {
    const keys = new Set();
    const names = new Set();
    if (!team) return { keys, names };

    const addKey = (key) => {
      if (key) keys.add(key);
    };
    const addByUidLike = (uidLike) => {
      const raw = this._normalizeIdentityValue(uidLike);
      if (!raw) return;
      const found = users.find(u =>
        this._normalizeIdentityValue(u.uid) === raw ||
        this._normalizeIdentityValue(u._docId) === raw
      );
      addKey(found ? this._getUserIdentityKey(found) : `uid:${raw}`);
    };
    const addByName = (name) => {
      const rawName = this._normalizeIdentityValue(name);
      if (!rawName) return;
      names.add(rawName.toLowerCase());
      const resolvedKey = this._resolveUserIdentityKeyByName(rawName, users);
      addKey(resolvedKey || this._toNameIdentityKey(rawName));
    };

    addByUidLike(team.captainUid);
    addByName(team.captain);

    const leaderUids = team.leaderUids || (team.leaderUid ? [team.leaderUid] : []);
    leaderUids.forEach(addByUidLike);

    const leaderNames = team.leaders || (team.leader ? [team.leader] : []);
    leaderNames.forEach(addByName);

    (team.coaches || []).forEach(addByName);

    return { keys, names };
  },

  _calcTeamMemberCountByTeam(team, users = ApiService.getAdminUsers() || []) {
    if (!team || !team.id) return 0;
    const uniqueIdentities = new Set();
    const staffIdentity = this._buildTeamStaffIdentity(team, users);
    staffIdentity.keys.forEach(key => uniqueIdentities.add(key));

    users.forEach(user => {
      if (!this._isUserInTeam(user, team.id)) return;
      const key = this._getUserIdentityKey(user);
      if (key) uniqueIdentities.add(key);
    });

    return uniqueIdentities.size;
  },

  _calcTeamMemberCount(teamId) {
    const team = ApiService.getTeam(teamId);
    if (!team) return 0;
    const users = ApiService.getAdminUsers() || [];
    return this._calcTeamMemberCountByTeam(team, users);
  },

  _isTeamOwner(t) {
    const user = ApiService.getCurrentUser();
    return !!(user && this._isUserInTeam(user, t.id));
  },

  _getTeamRank(teamExp) {
    const exp = teamExp || 0;
    for (let i = TEAM_RANK_CONFIG.length - 1; i >= 0; i--) {
      const cfg = TEAM_RANK_CONFIG[i];
      if (exp >= cfg.min) return { rank: cfg.rank, color: cfg.color };
    }
    return { rank: 'E', color: '#6b7280' };
  },

  _sortTeams(teams) {
    return [...teams].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      if (a.pinned && b.pinned) return (a.pinOrder || 0) - (b.pinOrder || 0);
      return (a.name || '').localeCompare(b.name || '');
    });
  },

  _hasRolePermission(code) {
    if (!code) return false;
    const role = (this.currentRole || ApiService.getCurrentUser?.()?.role || 'user');
    const perms = ApiService.getRolePermissions(role) || [];
    return perms.includes(code);
  },

  _findUserByUidOrDocId(uidOrDocId) {
    if (!uidOrDocId) return null;
    const users = ApiService.getAdminUsers() || [];
    return users.find(u => u.uid === uidOrDocId || u._docId === uidOrDocId) || null;
  },

  _resolveTeamCaptainUser(team) {
    if (!team) return null;
    const users = ApiService.getAdminUsers() || [];

    if (team.captainUid) {
      const byUid = this._findUserByUidOrDocId(team.captainUid);
      if (byUid) return byUid;
    }

    if (team.captain) {
      const byName = users.find(u =>
        u.name === team.captain || u.displayName === team.captain
      );
      if (byName) return byName;
    }

    if (team.id) {
      const teamUsers = users.filter(u => this._isUserInTeam(u, team.id));
      const captainUser = teamUsers.find(u => u.role === 'captain' || u.manualRole === 'captain');
      if (captainUser) return captainUser;
    }

    return null;
  },

  _isTeamCaptainUser(team) {
    if (!team) return false;

    const currentUser = ApiService.getCurrentUser?.();
    if (!currentUser) return false;

    if (team.captainUid && (team.captainUid === currentUser.uid || team.captainUid === currentUser._docId)) {
      return true;
    }

    const currentNames = new Set([currentUser.name, currentUser.displayName].filter(Boolean));
    if (team.captain && currentNames.has(team.captain)) return true;

    const captainUser = this._resolveTeamCaptainUser(team);
    return !!(captainUser && currentUser.uid && captainUser.uid === currentUser.uid);
  },

  _canEditTeamByRoleOrCaptain(team) {
    if (!team) return false;
    return this._isTeamCaptainUser(team) || this._hasRolePermission('team.manage_all') || this._hasRolePermission('team.manage_self');
  },

  _canCreateTeamByPermission() {
    return this._hasRolePermission('team.create');
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

});
