/* ================================================
   SportHub — Event List: Creator / Team / Gender / Ownership Helpers
   依賴：config.js, api-service.js
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  Creator Helpers
  // ══════════════════════════════════

  _getEventCreatorName() {
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
      const isManager = !!(t.captainUid && t.captainUid === myUid);
      const leaderUids = Array.isArray(t.leaderUids) ? t.leaderUids : (t.leaderUid ? [t.leaderUid] : []);
      const isLeader = !!(myUid && leaderUids.includes(myUid));
      const isCoach = !!(myUid && Array.isArray(t.coachUids) && t.coachUids.includes(myUid));
      if (isManager || isLeader || isCoach) ids.add(t.id);
    });

    return ids;
  },

  _isCurrentUserTeamStaff(teamId) {
    if (!teamId) return false;
    const user = ApiService.getCurrentUser?.() || null;
    if (!user || !user.uid) return false;
    const targetId = String(teamId || '').trim();
    const team = ApiService.getTeam?.(targetId)
      || (ApiService.getTeams?.() || []).find(t => {
        if (!t) return false;
        return [t.id, t._docId, t.docId]
          .map(v => String(v || '').trim())
          .filter(Boolean)
          .includes(targetId);
      });
    if (!team) return false;

    const myUid = user.uid;
    const isManager = !!(team.captainUid && team.captainUid === myUid);
    const leaderUids = Array.isArray(team.leaderUids) ? team.leaderUids : (team.leaderUid ? [team.leaderUid] : []);
    const isLeader = leaderUids.includes(myUid);
    const isCoach = Array.isArray(team.coachUids) && team.coachUids.includes(myUid);

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

  /**
   * 2026-04-19 UX：性別限定按鈕點擊處理
   * - 永遠顯示 Toast（限女性/限男性訊息）
   * - 若用戶個人資料不完整（_pendingFirstLogin=true）→ 同時彈出首次登入 modal
   *   讓用戶可直接填寫性別/生日/地區（missing_gender 常見情境）
   * - 若個人資料已完整但性別不符（gender_mismatch）→ 僅 Toast（modal 無法解決）
   */
  _handleGenderRestrictedClick(toastMsg) {
    this.showToast(toastMsg);
    if (this._pendingFirstLogin && typeof this._tryShowFirstLoginModal === 'function') {
      this._tryShowFirstLoginModal();
    }
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
    return this._canManageTeamOnlyVisibility(e);
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
    const myUid = this._getEventCreatorUid();
    if (!myUid || !e) return false;
    if (Array.isArray(e.delegateUids) && e.delegateUids.map(String).includes(String(myUid))) return true;
    if (!e.delegates || !e.delegates.length) return false;
    return e.delegates.some(d => d.uid === myUid);
  },

  _getCurrentActivityRoleKey() {
    return ApiService.getCurrentUser?.()?.role || this.currentRole || 'user';
  },

  _isCoachPlusRole(roleKey = this._getCurrentActivityRoleKey()) {
    return (ROLE_LEVEL_MAP[roleKey] || 0) >= (ROLE_LEVEL_MAP.coach || 1);
  },

  _canManageAllActivities() {
    return this.hasPermission('event.edit_all');
  },

  _canManageScopedActivity(e) {
    return !!e && (this._isEventOwner(e) || this._isEventDelegate(e));
  },

  _hasActivityManageEntry() {
    return this.hasPermission('activity.manage.entry') || this._isCoachPlusRole?.() || this._canManageAllActivities();
  },

  _canListPrivateEvent(e) {
    if (!e || !e.privateEvent) return true;
    const roleKey = this._getCurrentActivityRoleKey();
    if ((ROLE_LEVEL_MAP[roleKey] || 0) >= (ROLE_LEVEL_MAP.admin || 4)) return true;
    return this._isEventOwner(e) || this._isEventDelegate(e);
  },

  _canOperatePrivateEvent(e) {
    if (!e || !e.privateEvent) return true;
    const roleKey = this._getCurrentActivityRoleKey();
    if ((ROLE_LEVEL_MAP[roleKey] || 0) >= (ROLE_LEVEL_MAP.admin || 4)) return true;
    return this._isEventOwner(e) || this._isEventDelegate(e);
  },

  _hasUserActivityCapability(code) {
    if (this._getCurrentActivityRoleKey() !== 'user') return false;
    return !!ApiService.hasRoleActivityCapability?.('user', code);
  },

  async _ensureActivityRoleCapabilitiesReady(options = {}) {
    if (this._getCurrentActivityRoleKey?.() !== 'user') return;
    if (typeof FirebaseService === 'undefined') return;
    if (typeof FirebaseService.ensureRoleActivityCapabilitiesReady === 'function') {
      await FirebaseService.ensureRoleActivityCapabilitiesReady(options);
      return;
    }
    if (typeof FirebaseService.ensureStaticCollectionsLoaded === 'function') {
      await FirebaseService.ensureStaticCollectionsLoaded(['roleActivityCapabilities']);
    }
  },

  _canManageDelegatedActivity(e) {
    return !!e
      && this._getCurrentActivityRoleKey() === 'user'
      && this._isEventDelegate(e)
      && this._hasUserActivityCapability('user.activity.site_operate');
  },

  _showActivityAddonUpsellToast() {
    this.showToast('\u5982\u9700\u66f4\u591a\u529f\u80fd\u8acb\u806f\u7e6b\u5b98\u65b9Line@');
  },

  _canCreateBasicActivity() {
    const currentUser = ApiService.getCurrentUser?.();
    if (!currentUser?.uid) return false;
    return this.hasPermission('event.create')
      || this._hasActivityManageEntry()
      || this._hasUserActivityCapability('user.activity.basic_create');
  },

  _canCreateExternalActivity() {
    const currentUser = ApiService.getCurrentUser?.();
    if (!currentUser?.uid) return false;
    return this.hasPermission('event.create')
      || this._hasActivityManageEntry()
      || this._hasUserActivityCapability('user.activity.external_create');
  },

  _canAccessOwnActivityManageEntry() {
    const currentUser = ApiService.getCurrentUser?.();
    if (!currentUser?.uid) return false;
    return this._hasActivityManageEntry()
      || this._hasUserActivityCapability('user.activity.own_manage_entry');
  },

  _canEditOwnActivityBasic(e) {
    if (!e) return false;
    if (!this._canOperatePrivateEvent(e)) return false;
    if (this._canManageAllActivities()) return true;
    if (!this._canManageScopedActivity(e)) return false;
    if (this._hasActivityManageEntry() || this.hasPermission('event.edit_self')) return true;
    return this._getCurrentActivityRoleKey() === 'user'
      && this._hasUserActivityCapability('user.activity.own_edit_basic');
  },

  _canEditExternalActivity(e) {
    if (!e) return this._canCreateExternalActivity();
    return this._canEditOwnActivityBasic(e);
  },

  _canCancelOwnActivity(e) {
    if (!e) return false;
    if (!this._canOperatePrivateEvent(e)) return false;
    if (this._canManageAllActivities()) return true;
    if (!this._canManageScopedActivity(e)) return false;
    if (this._hasActivityManageEntry()) return true;
    return this._getCurrentActivityRoleKey() === 'user'
      && this._hasUserActivityCapability('user.activity.own_cancel');
  },

  _canReopenOrRelistActivity(e) {
    if (!e) return false;
    if (!this._canOperatePrivateEvent(e)) return false;
    return (this._canManageAllActivities() || this._hasActivityManageEntry())
      && (this._isEventOwner(e) || this._isEventDelegate(e) || this._canManageAllActivities());
  },

  _canDeleteActivity(e) {
    if (!e) return false;
    if (!this._canOperatePrivateEvent(e)) return false;
    return this.hasPermission('event.delete')
      || this._canManageAllActivities()
      || (this.hasPermission('event.delete_self') && this._isEventOwner(e));
  },

  _canOperateEventSite(e) {
    if (!e) return false;
    if (!this._canOperatePrivateEvent(e)) return false;
    if (this._canManageAllActivities()) return true;
    if (this._hasActivityManageEntry() && this._canManageScopedActivity(e)) return true;
    if (this.hasPermission('event.scan') || this.hasPermission('event.manual_checkin')) return true;
    return this._getCurrentActivityRoleKey() === 'user'
      && this._canManageScopedActivity(e)
      && this._hasUserActivityCapability('user.activity.site_operate');
  },

  _canRemoveWaitlistedParticipant(e) {
    return this._canOperateEventSite(e);
  },

  _canRemoveConfirmedParticipant(e) {
    if (!e) return false;
    if (!this._canOperatePrivateEvent(e)) return false;
    return this._canManageAllActivities()
      || (this._hasActivityManageEntry() && this._canManageScopedActivity(e))
      || this._canManageDelegatedActivity(e)
      || (
        this._getCurrentActivityRoleKey() === 'user'
        && this._isEventOwner(e)
        && this._hasUserActivityCapability('user.activity.site_operate')
      );
  },

  _canManageEventDelegates(e) {
    if (e && !this._canOperatePrivateEvent(e)) return false;
    if (e && !this._isEventOwner(e) && !this._canManageAllActivities()) return false;
    if (this._canManageAllActivities() || this._hasActivityManageEntry()) return true;
    return this._getCurrentActivityRoleKey() === 'user'
      && (!e || this._isEventOwner(e))
      && this._hasUserActivityCapability('user.activity.delegate_assign');
  },

  _canUseActivityAddons(e = null) {
    if (e && !this._canOperatePrivateEvent(e)) return false;
    if (this._canManageAllActivities()) return true;
    if (e && (this._hasActivityManageEntry() || this.hasPermission('team.create_event'))) return this._canManageScopedActivity(e);
    if (!e && (this._hasActivityManageEntry() || this.hasPermission('team.create_event'))) return true;
    if (this._getCurrentActivityRoleKey() !== 'user') return false;
    if (!this._hasUserActivityCapability('user.activity.addons_use')) return false;
    return !e || this._isEventOwner(e);
  },

  _canManageTeamSplit(e) {
    return !!e && this._canUseActivityAddons(e) && (this._canManageAllActivities() || this._canManageScopedActivity(e));
  },

  _canManageTeamOnlyVisibility(e) {
    if (!e || !e.teamOnly) return false;
    if (!this._canOperatePrivateEvent(e)) return false;
    if (this._canManageAllActivities()) return true;
    if ((this._hasActivityManageEntry() || this.hasPermission('team.toggle_event_visibility')) && this._canManageScopedActivity(e)) return true;
    if (!this._canUseActivityAddons(e)) return false;
    const eventTeamIds = this._getEventLimitedTeamIds(e);
    if (eventTeamIds.length === 0) return this._isEventOwner(e);
    return this._isEventOwner(e) || eventTeamIds.some(teamId => this._isCurrentUserTeamStaff(teamId));
  },

  _canViewEventOperationLog(e) {
    if (!this._canOperatePrivateEvent(e)) return false;
    return !!e && (this._canManageAllActivities() || (this._hasActivityManageEntry() && this._canManageScopedActivity(e)));
  },

  _isAnyActiveEventOperator() {
    if (typeof ApiService === 'undefined') return false;
    if (this._scanPresetEventId) {
      const presetEvent = this._scanPresetEventRecord || ApiService.getEvent(this._scanPresetEventId);
      if (presetEvent && this._canOperateEventSite(presetEvent)) return true;
    }
    const events = ApiService.getEvents?.() || [];
    return events.some(e =>
      (e.status === 'open' || e.status === 'full' || e.status === 'ended') &&
      this._canOperateEventSite(e)
    );
  },

  _refreshOwnActivityManageEntry() {
    const section = document.getElementById('own-activity-manage-entry');
    if (!section) return;
    section.style.display = this._canAccessOwnActivityManageEntry() ? '' : 'none';
  },

  /** 場主(含)以下只能管理自己的活動或受委託的活動，admin+ 可管理全部 */
  _canManageEvent(e) {
    if (!this._canOperatePrivateEvent(e)) return false;
    if (this._canManageAllActivities()) return true;
    return this._canManageScopedActivity(e);
  },

  /** 取得當前用戶可見的活動列表（過濾俱樂部限定 + 私密活動 + 黑名單） */
  _getVisibleEvents() {
    const all = ApiService.getEvents();
    // 2026-04-20：新增黑名單過濾（單一資料來源原則——所有列表渲染共用此函式）
    const uid = ApiService.getCurrentUser?.()?.uid || null;
    return all.filter(e => {
      if (!this._canViewEventByTeamScope(e)) return false;
      if (!this._canListPrivateEvent(e)) return false;
      if (typeof this._isEventVisibleToUser === 'function'
        && !this._isEventVisibleToUser(e, uid)) return false;
      return true;
    });
  },

  /** 依地區頁籤過濾活動 */
  _filterByRegionTab(events) {
    const tab = this._activeRegionTab || '全部';
    if (tab === '全部') return events;
    return events.filter(e => {
      // 舊活動或未設定地區 → 所有 tab 都顯示
      if (!e.regionEnabled && !e.region) return true;
      // regionEnabled: false（admin 關閉）→ 所有 tab 都顯示
      if (e.regionEnabled === false) return true;
      // regionEnabled: true → 比對 region
      return e.region === tab;
    });
  },

  /** 依運動項目過濾活動（'all' = 不過濾；無 sportTag 的舊活動預設歸類為 football） */
  _filterBySportTag(events) {
    const tag = (typeof App !== 'undefined' && App._activeSport) || 'all';
    if (tag === 'all') return events;
    return events.filter(e => (e.sportTag || 'football') === tag);
  },

  _isActivityMapFeatureEnabled() {
    return typeof isActivityMapEnabled === 'function' && isActivityMapEnabled();
  },

  _syncActivityMapEntry() {
    const button = document.getElementById('region-tab-nearby-activity');
    if (!button) return;
    const enabled = this._isActivityMapFeatureEnabled();
    button.classList.toggle('region-tab-disabled', !enabled);
    button.classList.toggle('region-tab-map-enabled', enabled);
    button.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    button.title = enabled ? '尋找附近活動' : '附近活動地圖尚未開啟';
  },

  async openActivityMapEntry(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (!this._isActivityMapFeatureEnabled()) {
      this._syncActivityMapEntry?.();
      this.showToast?.('附近活動地圖尚未開啟');
      return false;
    }
    try {
      if (typeof ScriptLoader === 'undefined' || typeof ScriptLoader.ensureGroup !== 'function') {
        throw new Error('ScriptLoader unavailable');
      }
      await ScriptLoader.ensureGroup('activityMap');
      if (typeof this.showActivityMap !== 'function') throw new Error('activity map module unavailable');
      await this.showActivityMap();
      return true;
    } catch (err) {
      console.error('[ActivityMap] open failed:', err);
      this.showToast?.('附近活動地圖載入失敗，請稍後再試');
      return false;
    }
  },

  _activeRegionTab: '全部',

  switchRegionTab(region) {
    // HTML entity decode（onclick 傳入的 &amp; 需還原為 &）
    var decoded = (region || '全部').replace(/&amp;/g, '&');
    this._activeRegionTab = decoded;
    // 同步所有地區頁籤 UI（首頁 + 活動頁）
    document.querySelectorAll('.region-tab').forEach(function(btn) {
      var btnRegion = (btn.getAttribute('data-region') || '').replace(/&amp;/g, '&');
      btn.classList.toggle('active', btnRegion === decoded);
    });
    // 重新渲染（頁面未載入時靜默跳過）
    try { this._syncActivityMapEntry?.(); } catch (_) {}
    try { this.renderHotEvents(); } catch (_) {}
    try { this.renderActivityList(); } catch (_) {}
    // 月曆 tab 下也要同步重 render（見 calendar-view-plan §12.D）
    try { if (this._activityActiveTab === 'calendar') this._renderActivityCalendar?.(); } catch (_) {}
  },

});
