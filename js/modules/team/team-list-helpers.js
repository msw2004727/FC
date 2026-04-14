/* ================================================
   SportHub — Team: Identity Resolution & Permission Helpers
   純工具函式，無 DOM 操作、無副作用。
   從 team-list.js / team-detail.js / team-form-join.js 抽出。
   依賴：config.js, api-service.js
   ================================================ */

Object.assign(App, {

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

  _isTeamOwner(t) {
    const user = ApiService.getCurrentUser();
    return !!(user && this._isUserInTeam(user, t.id));
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

  // ── 從 team-detail.js 搬入 ──

  _canManageTeamMembers(team) {
    const curUser = ApiService.getCurrentUser?.();
    if (!team || !curUser) return false;
    const myUid = curUser.uid || null;
    const myNames = new Set([curUser.name, curUser.displayName].filter(Boolean));
    if (team.captainUid && myUid && team.captainUid === myUid) return true;
    if (!team.captainUid && team.captain && myNames.has(team.captain)) return true;
    const leaderUids = team.leaderUids || (team.leaderUid ? [team.leaderUid] : []);
    if (myUid && leaderUids.includes(myUid)) return true;
    const leaderNames = team.leaders || (team.leader ? [team.leader] : []);
    if (leaderNames.some(name => myNames.has(name))) return true;
    if ((team.coaches || []).some(name => myNames.has(name))) return true;
    return false;
  },

  // ── 教育型俱樂部學員計數（Phase 4 §10.2）──

  _getEduStudentCount(teamId) {
    if (!this._eduStudentsCache || !this._eduStudentsCache[teamId]) return 0;
    return this._eduStudentsCache[teamId].filter(s => s.enrollStatus === 'active').length;
  },

  /**
   * 依俱樂部類型回傳對應的 handler（Phase 4 §10.2 type handler pattern）。
   * 新增俱樂部類型時只需在此擴充，無需到各處加 if。
   */
  _getTeamTypeHandler(type) {
    if (type === 'education') return {
      memberCount: (teamId) => this._getEduStudentCount(teamId),
      detailRenderer: (teamId) => this.renderEduClubDetail(teamId),
      joinHandler: (teamId) => this.showEduStudentApply(teamId),
      showEduSettings: true,
    };
    return {
      memberCount: (teamId) => this._calcTeamMemberCount(teamId),
      detailRenderer: null,
      joinHandler: null,
      showEduSettings: false,
    };
  },

  // ── 從 team-form-join.js 搬入 ──

  _applyRoleChange(result) {
    if (!result) return;
    const { uid, oldRole, newRole, userName } = result;
    const isUpgrade = (ROLE_LEVEL_MAP[newRole] || 0) > (ROLE_LEVEL_MAP[oldRole] || 0);
    const roleName = ROLES[newRole]?.label || newRole;
    const action = isUpgrade ? '晉升' : '調整';
    this._sendNotifFromTemplate('role_upgrade', {
      userName, roleName,
    }, uid, 'private', '私訊');
    ApiService._writeOpLog('role', '角色變更', `${userName} 自動${action}為「${roleName}」（原：${ROLES[oldRole]?.label || oldRole}）`);
  },

});
