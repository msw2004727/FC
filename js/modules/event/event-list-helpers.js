/* ================================================
   SportHub — Event List: Creator / Team / Gender / Ownership Helpers
   依賴：config.js, api-service.js
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  Creator Helpers
  // ══════════════════════════════════

  _getEventCreatorName() {
    if (typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn()) {
      const profile = LineAuth.getProfile();
      if (profile && profile.displayName) return profile.displayName;
    }
    const user = ApiService.getCurrentUser?.() || null;
    if (user && user.displayName) return user.displayName;
    return ROLES[this.currentRole]?.label || '一般用戶';
  },

  _getEventCreatorUid() {
    const user = ApiService.getCurrentUser?.() || null;
    return user?.uid || 'unknown';
  },

  _getEventCreatorTeam() {
    const user = ApiService.getCurrentUser?.() || null;
    if (!user) return { teamId: null, teamName: null };
    // 優先從 currentUser 取
    if (user.teamId) return { teamId: user.teamId, teamName: user.teamName || null };
    // 從 adminUsers 查找（正式版 currentUser 可能沒有 teamId）
    const uid = user.uid || '';
    const name = user.displayName || user.name || '';
    const adminUsers = ApiService.getAdminUsers?.() || [];
    const match = adminUsers.find(u => (uid && u.uid === uid) || (name && u.name === name));
    if (match && match.teamId) return { teamId: match.teamId, teamName: match.teamName || null };
    return { teamId: null, teamName: null };
  },

  // ══════════════════════════════════
  //  Team Scope Helpers
  // ══════════════════════════════════

  _getVisibleTeamIdsForLimitedEvents() {
    const ids = new Set();
    const user = ApiService.getCurrentUser?.() || null;
    if (!user) return ids;

    if (typeof this._getUserTeamIds === 'function') {
      this._getUserTeamIds(user).forEach(id => ids.add(id));
    } else {
      if (Array.isArray(user.teamIds)) user.teamIds.forEach(id => { if (id) ids.add(String(id)); });
      if (user.teamId) ids.add(user.teamId);
    }
    // currentUser 可能尚未同步 teamId，補用 adminUsers 對照（與建立活動相同策略）
    const uid = user.uid || '';
    const name = user.displayName || user.name || '';
    const adminUsers = ApiService.getAdminUsers?.() || [];
    const match = adminUsers.find(u => (uid && u.uid === uid) || (name && u.name === name));
    if (match) {
      if (Array.isArray(match.teamIds)) match.teamIds.forEach(id => { if (id) ids.add(String(id)); });
      if (match.teamId) ids.add(match.teamId);
    }

    const myUid = user.uid || '';
    const myDocId = user._docId || '';
    const myNames = new Set([user.name, user.displayName].filter(Boolean));
    const teams = ApiService.getTeams?.() || [];

    teams.forEach(t => {
      if (!t || !t.id) return;
      const isManager =
        !!(t.captainUid && [myUid, myDocId].filter(Boolean).includes(t.captainUid)) ||
        !!(t.captain && myNames.has(t.captain));
      const isLeader =
        !!(t.leaderUid && [myUid, myDocId].filter(Boolean).includes(t.leaderUid)) ||
        !!(t.leader && myNames.has(t.leader));
      const isCoach = (t.coaches || []).some(name => myNames.has(name));
      if (isManager || isLeader || isCoach) ids.add(t.id);
    });

    return ids;
  },

  _isCurrentUserTeamStaff(teamId) {
    if (!teamId) return false;
    const user = ApiService.getCurrentUser?.() || null;
    if (!user) return false;
    const team = ApiService.getTeam?.(teamId);
    if (!team) return false;

    const myUid = user.uid || '';
    const myDocId = user._docId || '';
    const myNames = new Set([user.name, user.displayName].filter(Boolean));

    const isLeader =
      !!(team.leaderUid && [myUid, myDocId].filter(Boolean).includes(team.leaderUid)) ||
      !!(team.leader && myNames.has(team.leader));
    const isManager =
      !!(team.captainUid && [myUid, myDocId].filter(Boolean).includes(team.captainUid)) ||
      !!(team.captain && myNames.has(team.captain));
    const isCoach = (team.coaches || []).some(name => myNames.has(name));

    return isLeader || isManager || isCoach;
  },

  _getEventLimitedTeamIds(e) {
    if (!e) return [];
    const ids = [];
    const seen = new Set();
    const pushId = (id) => {
      const v = String(id || '').trim();
      if (!v || seen.has(v)) return;
      seen.add(v);
      ids.push(v);
    };
    if (Array.isArray(e.creatorTeamIds)) e.creatorTeamIds.forEach(pushId);
    pushId(e.creatorTeamId);
    return ids;
  },

  _canSignupTeamOnlyEvent(e) {
    if (!e || !e.teamOnly) return true;
    const eventTeamIds = this._getEventLimitedTeamIds(e);
    if (eventTeamIds.length === 0) return false;
    const myTeamIds = this._getVisibleTeamIdsForLimitedEvents();
    return eventTeamIds.some(id => myTeamIds.has(id));
  },

  // ══════════════════════════════════
  //  Gender Restriction Helpers
  // ══════════════════════════════════

  _normalizeBinaryGender(value) {
    return value === '男' || value === '女' ? value : '';
  },

  _getEventAllowedGender(e) {
    if (!e?.genderRestrictionEnabled) return '';
    return this._normalizeBinaryGender(e.allowedGender);
  },

  _hasEventGenderRestriction(e) {
    return !!this._getEventAllowedGender(e);
  },

  _getEventGenderRibbonText(e) {
    const allowedGender = this._getEventAllowedGender(e);
    if (!allowedGender) return '';
    return allowedGender === '男' ? '男生限定' : '女生限定';
  },

  _getEventGenderTimelineRibbonText(e) {
    const allowedGender = this._getEventAllowedGender(e);
    if (!allowedGender) return '';
    return allowedGender === '男' ? '限男生' : '限女生';
  },

  _getEventGenderDetailText(e) {
    const allowedGender = this._getEventAllowedGender(e);
    if (!allowedGender) return '';
    return allowedGender === '男' ? '限男性報名' : '限女性報名';
  },

  _canEventGenderParticipantSignup(e, gender) {
    const allowedGender = this._getEventAllowedGender(e);
    if (!allowedGender) return true;
    return this._normalizeBinaryGender(gender) === allowedGender;
  },

  _getEventGenderSignupState(e, user = ApiService.getCurrentUser?.() || null) {
    const allowedGender = this._getEventAllowedGender(e);
    if (!allowedGender) {
      return { restricted: false, allowedGender: '', canSignup: true, requiresLogin: false, reason: '' };
    }
    if (!user?.uid) {
      return { restricted: true, allowedGender, canSignup: true, requiresLogin: true, reason: '' };
    }
    const userGender = this._normalizeBinaryGender(user.gender);
    if (!userGender) {
      return { restricted: true, allowedGender, canSignup: false, requiresLogin: false, reason: 'missing_gender' };
    }
    if (userGender !== allowedGender) {
      return { restricted: true, allowedGender, canSignup: false, requiresLogin: false, reason: 'gender_mismatch' };
    }
    return { restricted: true, allowedGender, canSignup: true, requiresLogin: false, reason: '' };
  },

  _getEventGenderRestrictionMessage(e, reason = '') {
    const detailText = this._getEventGenderDetailText(e);
    if (!detailText) return '';
    if (reason === 'missing_gender') {
      return `${detailText}，請先到個人資料填寫性別`;
    }
    return `${detailText}，目前無法報名`;
  },

  _getCompanionGenderRestrictionMessage(e, companionName = '') {
    const allowedGender = this._getEventAllowedGender(e);
    if (!allowedGender) return '';
    const label = allowedGender === '男' ? '男性限制' : '女性限制';
    return companionName
      ? `${companionName} 不符合此活動的${label}`
      : `所選同行者不符合此活動的${label}`;
  },

  // ══════════════════════════════════
  //  Ownership / Visibility / Permission
  // ══════════════════════════════════

  _canViewEventByTeamScope(e) {
    if (!e) return false;
    if (!e.teamOnly) return true;
    if (this._isEventOwner(e)) return true;
    if (this.hasPermission('event.edit_all')) return true;
    const eventTeamIds = this._getEventLimitedTeamIds(e);
    const myTeamIds = this._getVisibleTeamIdsForLimitedEvents();
    if (eventTeamIds.some(id => myTeamIds.has(id))) return true;
    return !!e.isPublic;
  },

  _canToggleEventPublic(e) {
    if (!e || !e.teamOnly) return false;
    if (this.hasPermission('event.edit_all')) return true;
    if (this.hasPermission('team.toggle_event_visibility')) return true;
    const eventTeamIds = this._getEventLimitedTeamIds(e);
    if (eventTeamIds.length === 0) return this._isEventOwner(e);
    return this._isEventOwner(e) || eventTeamIds.some(teamId => this._isCurrentUserTeamStaff(teamId));
  },

  /** 判斷當前用戶是否為該活動建立者 */
  _isEventOwner(e) {
    if (!e.creatorUid) {
      // 舊資料無 creatorUid，用 creator 名稱比對
      const name = this._getEventCreatorName();
      return e.creator === name;
    }
    return e.creatorUid === this._getEventCreatorUid();
  },

  /** 判斷當前用戶是否為該活動委託人 */
  _isEventDelegate(e) {
    if (!e.delegates || !e.delegates.length) return false;
    const myUid = this._getEventCreatorUid();
    return e.delegates.some(d => d.uid === myUid);
  },

  /** 場主(含)以下只能管理自己的活動或受委託的活動，admin+ 可管理全部 */
  _canManageEvent(e) {
    if (this.hasPermission('event.edit_all')) return true;
    return this._isEventOwner(e) || this._isEventDelegate(e);
  },

  /** 取得當前用戶可見的活動列表（過濾俱樂部限定 + 私密活動 + 地區鎖） */
  _getVisibleEvents() {
    const all = ApiService.getEvents();
    return all.filter(e => {
      if (!this._canViewEventByTeamScope(e)) return false;
      // 私密活動：僅建立者/委託人/管理員可在列表中看到
      if (e.privateEvent && !this._canManageEvent(e)) return false;
      // 地區鎖：用戶地區需在 allowedRegions 內（主辦/委託/管理員不受限）
      if (e.regionLock && !this._canManageEvent(e)) {
        const userRegion = ApiService.getCurrentUser?.()?.region || '';
        if (!userRegion || !Array.isArray(e.allowedRegions) || !e.allowedRegions.includes(userRegion)) return false;
      }
      return true;
    });
  },

});
