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

    const leaderUids = team.leaderUids || (team.leaderUid ? [team.leaderUid] : []);
    leaderUids.forEach(addByUidLike);

    const coachUids = Array.isArray(team.coachUids) ? team.coachUids : [];
    coachUids.forEach(addByUidLike);

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
    if (team.captainUid) {
      return this._findUserByUidOrDocId(team.captainUid) || null;
    }
    return null;
  },

  _isTeamCaptainUser(team) {
    if (!team) return false;
    const currentUser = ApiService.getCurrentUser?.();
    if (!currentUser || !currentUser.uid) return false;
    return !!(team.captainUid && (team.captainUid === currentUser.uid || team.captainUid === currentUser._docId));
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
    if (!team) return false;
    const curUser = ApiService.getCurrentUser?.();
    if (!curUser || !curUser.uid) return false;
    const myUid = curUser.uid;
    if (team.captainUid === myUid) return true;
    if (Array.isArray(team.leaderUids) && team.leaderUids.includes(myUid)) return true;
    if (Array.isArray(team.coachUids) && team.coachUids.includes(myUid)) return true;
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
