/* ================================================
   SportHub — Team: Identity Resolution & Permission Helpers
   純工具函式，無 DOM 操作、無副作用。
   從 team-list.js / team-detail.js / team-form-join.js 抽出。
   依賴：config.js, api-service.js
   ================================================ */

Object.assign(App, {

  _defaultTeamCoverAssetPath: 'LOGO/Nocoverimage set.png',
  _defaultTeamCoverDataUrl: null,
  _defaultTeamCoverPromise: null,

  _normalizeIdentityValue(value) {
    return String(value || '').trim();
  },

  _normalizeTeamAttentionColor(value) {
    const raw = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(raw) ? raw : '#fbbf24';
  },

  _normalizeTeamThemeColor(value) {
    const raw = String(value || '').trim();
    return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : '';
  },

  _getTeamThemeColor(team) {
    return this._normalizeTeamThemeColor?.(team?.themeColor) || '';
  },

  _isTeamThemeOverlayEnabled(team) {
    return team?.themeOverlayEnabled !== false;
  },

  _getDefaultTeamCoverUrl() {
    const version = (typeof CACHE_VERSION !== 'undefined' && CACHE_VERSION) ? CACHE_VERSION : '';
    try {
      const baseUrl = (typeof document !== 'undefined' && document.baseURI)
        || (typeof window !== 'undefined' && window.location?.href)
        || '';
      const url = new URL(this._defaultTeamCoverAssetPath, baseUrl);
      if (version) url.searchParams.set('v', version);
      return url.toString();
    } catch (_) {
      const suffix = version ? `?v=${encodeURIComponent(version)}` : '';
      return `${encodeURI(this._defaultTeamCoverAssetPath)}${suffix}`;
    }
  },

  _getTeamCoverImageUrl(team, variantKey = 'cover') {
    return this._getTeamImageUrl?.(team, variantKey)
      || team?.image
      || team?.coverImage
      || this._getDefaultTeamCoverUrl?.()
      || '';
  },

  async _getDefaultTeamCoverDataUrl() {
    if (this._defaultTeamCoverDataUrl) return this._defaultTeamCoverDataUrl;
    if (!this._defaultTeamCoverPromise) {
      this._defaultTeamCoverPromise = (async () => {
        if (typeof fetch !== 'function') throw new Error('DEFAULT_TEAM_COVER_FETCH_UNAVAILABLE');
        if (typeof this._compressImage !== 'function') throw new Error('DEFAULT_TEAM_COVER_COMPRESS_UNAVAILABLE');
        const response = await fetch(this._getDefaultTeamCoverUrl(), { cache: 'force-cache' });
        if (!response || !response.ok) {
          throw new Error(`DEFAULT_TEAM_COVER_NOT_FOUND:${response?.status || 'unknown'}`);
        }
        const blob = await response.blob();
        const dataUrl = await this._compressImage(blob, 1200, 0.9, 'image/webp');
        this._defaultTeamCoverDataUrl = dataUrl;
        return dataUrl;
      })();
    }
    try {
      return await this._defaultTeamCoverPromise;
    } catch (err) {
      this._defaultTeamCoverPromise = null;
      throw err;
    }
  },

  async _resolveTeamCoverImage(image) {
    const currentImage = typeof image === 'string' ? image.trim() : image;
    if (currentImage) return currentImage;
    try {
      return await this._getDefaultTeamCoverDataUrl();
    } catch (err) {
      console.error('[TeamForm] default cover failed:', err);
      this.showToast?.('俱樂部替代封面載入失敗，請重新上傳圖片或稍後再試');
      throw err;
    }
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

  _isTeamOwnerUser(team) {
    if (!team) return false;
    const currentUser = ApiService.getCurrentUser?.();
    if (!currentUser || !currentUser.uid) return false;
    const currentIds = [currentUser.uid, currentUser._docId].filter(Boolean).map(id => String(id).trim());
    return ['captainUid', 'creatorUid', 'ownerUid'].some(field => {
      const ownerId = String(team[field] || '').trim();
      return ownerId && currentIds.includes(ownerId);
    });
  },

  _canEditTeamByRoleOrCaptain(team) {
    if (!team) return false;
    return this._isTeamOwnerUser(team) || this._hasRolePermission('team.manage_all');
  },

  _canAccessTeamManageRecord(team) {
    if (!team) return false;
    return this._canEditTeamByRoleOrCaptain(team) || this._canManageTeamMembers(team);
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

  _isTeamTeachingTagged(teamOrId) {
    const team = typeof teamOrId === 'string'
      ? ApiService.getTeam(teamOrId)
      : teamOrId;
    if (!team) return false;
    if (team.teachingEnabled === true) return true;
    if (team.teachingEnabled === false) return false;
    if (team.isTeaching === true || team.educationTag === true) return true;
    if (team.eduSettings?.teachingEnabled === true) return true;
    if (team.eduSettings?.teachingEnabled === false) return false;
    return team.type === 'education';
  },

  _getTeamCategoryOptions() {
    return [
      {
        key: 'competitive',
        label: '競技',
        formHint: '競技標籤只作為俱樂部分類，賽事系統設定已預留。',
        ribbonClass: 'tc-type-ribbon-competitive',
        pillClass: 'td-category-pill-competitive',
        showEduSettings: false,
        coursesEnabled: false,
        tournamentSettingsReserved: true,
      },
      {
        key: 'education',
        label: '教學',
        formHint: '教學標籤會啟用課程、學員與待審核功能。',
        ribbonClass: 'tc-type-ribbon-education',
        pillClass: 'td-category-pill-education',
        showEduSettings: true,
        coursesEnabled: true,
        tournamentSettingsReserved: false,
      },
      {
        key: 'leisure',
        label: '休閒',
        formHint: '休閒標籤只作為俱樂部分類，未來可銜接友誼賽或休閒賽事設定。',
        ribbonClass: 'tc-type-ribbon-leisure',
        pillClass: 'td-category-pill-leisure',
        showEduSettings: false,
        coursesEnabled: false,
        tournamentSettingsReserved: true,
      },
    ];
  },

  _normalizeTeamCategory(type) {
    const key = String(type || '').trim().toLowerCase();
    if (key === 'education' || key === 'teaching') return 'education';
    if (key === 'leisure' || key === 'casual' || key === 'recreational') return 'leisure';
    return 'competitive';
  },

  _getTeamTypeMeta(type) {
    const normalized = this._normalizeTeamCategory(type);
    const options = this._getTeamCategoryOptions();
    return options.find(item => item.key === normalized) || options[0];
  },

  _getTeamCategoryMeta(teamOrType) {
    if (teamOrType && typeof teamOrType === 'object') {
      const team = teamOrType;
      if (this._isTeamTeachingTagged(team)) return this._getTeamTypeMeta('education');
      if ((team.teachingEnabled === false || team.eduSettings?.teachingEnabled === false)
          && (!team.type || team.type === 'education')) {
        return this._getTeamTypeMeta('competitive');
      }
      return this._getTeamTypeMeta(team.type);
    }
    return this._getTeamTypeMeta(teamOrType);
  },

  /**
   * 依俱樂部類型回傳對應的 handler（Phase 4 §10.2 type handler pattern）。
   * 新增俱樂部類型時只需在此擴充，無需到各處加 if。
   */
  _getTeamTypeHandler(type) {
    const meta = this._getTeamTypeMeta(type);
    return {
      memberCount: (teamId) => this._calcTeamMemberCount(teamId),
      detailRenderer: null,
      joinHandler: null,
      showEduSettings: !!meta.showEduSettings,
      coursesEnabled: !!meta.coursesEnabled,
      tournamentSettingsReserved: !!meta.tournamentSettingsReserved,
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
