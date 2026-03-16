/* ================================================
   SportHub — Event: Helpers, Hot Events, Activity List
   依賴：config.js, api-service.js
   ================================================ */

Object.assign(App, {

  _activityActiveTab: 'normal',

  resetHomeHotEventsScroll() {
    const container = document.getElementById('hot-events');
    if (!container) return;

    const prevBehavior = container.style.scrollBehavior;
    container.style.scrollBehavior = 'auto';
    container.scrollLeft = 0;
    requestAnimationFrame(() => {
      container.style.scrollBehavior = prevBehavior;
    });
  },

  _setActivityTab(tab, options = {}) {
    const { render = true } = options;
    this._activityActiveTab = tab;
    document.querySelectorAll('#activity-tabs .tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.atab === tab);
    });
    if (render) this.renderActivityList();
  },

  switchActivityTab(tab) {
    this._setActivityTab(tab);
  },

  resetActivityTab(options = {}) {
    this._setActivityTab('normal', options);
  },

  // ══════════════════════════════════
  //  Helpers
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

  _canViewEventByTeamScope(e) {
    if (!e) return false;
    if (!e.teamOnly) return true;
    if (this._isEventOwner(e)) return true;
    const myLevel = ROLE_LEVEL_MAP[this.currentRole] || 0;
    if (myLevel >= ROLE_LEVEL_MAP.admin) return true;
    const eventTeamIds = this._getEventLimitedTeamIds(e);
    const myTeamIds = this._getVisibleTeamIdsForLimitedEvents();
    if (eventTeamIds.some(id => myTeamIds.has(id))) return true;
    return !!e.isPublic;
  },

  _canToggleEventPublic(e) {
    if (!e || !e.teamOnly) return false;
    const myLevel = ROLE_LEVEL_MAP[this.currentRole] || 0;
    if (myLevel >= ROLE_LEVEL_MAP.admin) return true;
    if (this.hasPermission('event.edit_all')) return true;
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

  /** 活動卡片與列表共用的人數摘要（正取 / 候補） */
  _buildEventPeopleSummaryByStatus(eventInput, registrations, status, fallbackNames = []) {
    const event = typeof eventInput === 'string' ? ApiService.getEvent(eventInput) : eventInput;
    if (!event) return { people: [], count: 0, hasSource: false };

    const targetRegs = (Array.isArray(registrations) ? registrations : [])
      .filter(r => r?.status === status);
    const people = [];
    const addedNames = new Set();

    if (targetRegs.length > 0) {
      const groups = new Map();
      targetRegs.forEach(reg => {
        const groupKey = String(reg.userId || reg.userName || reg.id || '').trim() || `anon-${groups.size}`;
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey).push(reg);
      });

      groups.forEach(regs => {
        const selfReg = regs.find(reg => reg.participantType === 'self');
        const companions = regs.filter(reg => reg.participantType === 'companion');
        const mainName = String(selfReg?.userName || regs[0]?.userName || '').trim();

        if (mainName && !addedNames.has(mainName)) {
          people.push({ name: mainName, isCompanion: false });
          addedNames.add(mainName);
        }

        companions.forEach(companionReg => {
          const companionName = String(companionReg.companionName || companionReg.userName || '').trim();
          if (!companionName || addedNames.has(companionName)) return;
          people.push({ name: companionName, isCompanion: true });
          addedNames.add(companionName);
        });
      });
    }

    (Array.isArray(fallbackNames) ? fallbackNames : []).forEach(name => {
      const safeName = String(name || '').trim();
      if (!safeName || addedNames.has(safeName)) return;
      people.push({ name: safeName, isCompanion: false });
      addedNames.add(safeName);
    });

    return {
      people,
      count: people.length,
      hasSource: targetRegs.length > 0,
    };
  },

  _getEventParticipantStats(eventInput) {
    const event = typeof eventInput === 'string' ? ApiService.getEvent(eventInput) : eventInput;
    if (!event) {
      return {
        confirmedCount: 0,
        waitlistCount: 0,
        maxCount: 0,
        remainingCount: 0,
        isCapacityFull: false,
        showFullBadge: false,
        showAlmostFullBadge: false,
      };
    }

    const registrations = ApiService.getRegistrationsByEvent?.(event.id) || [];
    const confirmedSummary = this._buildEventPeopleSummaryByStatus(
      event,
      registrations,
      'confirmed',
      Array.isArray(event.participants) ? event.participants : []
    );
    const waitlistSummary = this._buildEventPeopleSummaryByStatus(
      event,
      registrations,
      'waitlisted',
      Array.isArray(event.waitlistNames) ? event.waitlistNames : []
    );

    const fallbackConfirmed = Math.max(0, Number(event.current || 0));
    const fallbackWaitlist = Math.max(0, Number(event.waitlist || 0));
    const confirmedCount = confirmedSummary.hasSource ? confirmedSummary.count : fallbackConfirmed;
    const waitlistCount = waitlistSummary.hasSource ? waitlistSummary.count : fallbackWaitlist;
    const maxCount = Math.max(0, Number(event.max || 0));
    const remainingCount = maxCount > 0 ? Math.max(0, maxCount - confirmedCount) : 0;
    const isCapacityFull = maxCount > 0 && confirmedCount >= maxCount;
    const isTerminal = event.status === 'ended' || event.status === 'cancelled';

    return {
      confirmedCount,
      waitlistCount,
      maxCount,
      remainingCount,
      isCapacityFull,
      showFullBadge: !isTerminal && isCapacityFull,
      showAlmostFullBadge: !isTerminal
        && event.status === 'open'
        && maxCount > 0
        && confirmedCount < maxCount
        && (remainingCount / maxCount) < 0.2,
    };
  },

  _renderEventCapacityBadge(event, stats = this._getEventParticipantStats(event)) {
    if (stats.showFullBadge) return '<span class="tl-almost-full-badge">已額滿</span>';
    if (stats.showAlmostFullBadge) return '<span class="tl-almost-full-badge">即將額滿</span>';
    return '';
  },

  _isEventTrulyFull(e) {
    return this._getEventParticipantStats(e).isCapacityFull;
  },

  /** 判斷當前用戶是否為該活動委託人 */
  _isEventDelegate(e) {
    if (!e.delegates || !e.delegates.length) return false;
    const myUid = this._getEventCreatorUid();
    return e.delegates.some(d => d.uid === myUid);
  },

  /** 場主(含)以下只能管理自己的活動或受委託的活動，admin+ 可管理全部 */
  _canManageEvent(e) {
    const myLevel = ROLE_LEVEL_MAP[this.currentRole] || 0;
    if (myLevel >= ROLE_LEVEL_MAP.admin) return true; // admin, super_admin
    if (this.hasPermission('event.edit_all')) return true;
    return this._isEventOwner(e) || this._isEventDelegate(e);
  },

  /** 取得當前用戶可見的活動列表（過濾球隊限定） */
  _getVisibleEvents() {
    const all = ApiService.getEvents();
    return all.filter(e => this._canViewEventByTeamScope(e));
  },
  _getEventSportTag(event) {
    const key = getSportKeySafe(event?.sportTag);
    return key || 'football';
  },
  _setHomeSectionVisibility(sectionContent, isVisible) {
    const contentEl = typeof sectionContent === 'string'
      ? document.getElementById(sectionContent)
      : sectionContent;
    if (!contentEl) return;

    const titleEl = contentEl.previousElementSibling && contentEl.previousElementSibling.classList?.contains('section-title')
      ? contentEl.previousElementSibling
      : null;

    contentEl.style.display = isVisible ? '' : 'none';
    if (titleEl) titleEl.style.display = isVisible ? '' : 'none';
  },
  _isHomeGameVisible(gameKey) {
    const gameConfig = Array.isArray(HOME_GAME_PRESETS)
      ? HOME_GAME_PRESETS.find(item => item && item.gameKey === gameKey)
      : null;
    if (!gameConfig) return false;
    if (gameConfig.enabled === false) return false;

    const minRole = 'user';
    const minLevel = ROLE_LEVEL_MAP[minRole] || 0;
    const currentLevel = ROLE_LEVEL_MAP[this.currentRole] || 0;
    if (currentLevel < minLevel) return false;

    // Firestore gameConfigs 可覆蓋 preset 的 homeVisible 設定
    if (typeof ApiService !== 'undefined' && typeof ApiService.isHomeGameVisible === 'function') {
      return ApiService.isHomeGameVisible(gameKey);
    }
    // 無 Firestore 覆蓋時使用 preset 預設值
    return gameConfig.homeVisible !== false;
  },
  _isHomeGameShortcutAvailable() {
    return this._isHomeGameVisible('shot-game');
  },
  renderHomeGameShortcut() {
    const shotCard = document.getElementById('home-game-card-shot');
    const kickCard = document.getElementById('home-game-card-kick');
    const shotAvailable = this._isHomeGameVisible('shot-game');
    const kickAvailable = this._isHomeGameVisible('kick-game');
    const anyVisible = shotAvailable || kickAvailable;

    // Toggle individual cards (without touching section title)
    if (shotCard) shotCard.style.display = shotAvailable ? '' : 'none';
    if (kickCard) kickCard.style.display = kickAvailable ? '' : 'none';

    // Toggle the shared section title based on whether any card is visible
    const firstCard = shotCard || kickCard;
    if (firstCard) {
      const titleEl = firstCard.previousElementSibling;
      if (titleEl && titleEl.classList && titleEl.classList.contains('section-title')) {
        titleEl.style.display = anyVisible ? '' : 'none';
      }
    }
  },
  _renderEventSportIcon(event, className = '') {
    const sportKey = this._getEventSportTag(event);
    const label = getSportLabelByKey(sportKey);
    const klass = className ? ` ${className}` : '';
    return `<span class="event-sport-icon${klass}" title="${escapeHTML(label)}" aria-label="${escapeHTML(label)}">${getSportIconSvg(sportKey)}</span>`;
  },

  /** 解析活動日期字串，回傳開始時間的 Date 物件 */
  _parseEventStartDate(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split(' ');
    const dateParts = parts[0].split('/');
    if (dateParts.length < 3) return null;
    const y = parseInt(dateParts[0]);
    const m = parseInt(dateParts[1]) - 1;
    const d = parseInt(dateParts[2]);
    if (parts[1]) {
      const timePart = parts[1].split('~')[0];
      const [hh, mm] = timePart.split(':').map(Number);
      return new Date(y, m, d, hh || 0, mm || 0);
    }
    return new Date(y, m, d);
  },

  /** 解析活動日期字串，回傳結束時間的 Date 物件（若無結束時間則回傳開始時間） */
  _parseEventEndDate(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split(' ');
    const dateParts = parts[0].split('/');
    if (dateParts.length < 3) return null;
    const y = parseInt(dateParts[0], 10);
    const m = parseInt(dateParts[1], 10) - 1;
    const d = parseInt(dateParts[2], 10);

    if (!parts[1]) return new Date(y, m, d, 23, 59, 59);
    const timePart = parts[1];
    const endRaw = timePart.includes('~') ? timePart.split('~')[1] : timePart.split('~')[0];
    const [hh, mm] = (endRaw || '').split(':').map(Number);
    if (!Number.isFinite(hh) || !Number.isFinite(mm)) return this._parseEventStartDate(dateStr);
    return new Date(y, m, d, hh, mm);
  },

  /** 計算倒數文字 */
  _getEventEffectiveStatus(event, nowDate = new Date()) {
    if (!event) return 'ended';
    if (event.status === 'cancelled') return 'cancelled';
    if (event.status === 'ended') return 'ended';

    const start = this._parseEventStartDate(event.date);
    if (start && start <= nowDate) return 'ended';

    if (event.regOpenTime) {
      const regOpen = new Date(event.regOpenTime);
      if (!Number.isNaN(regOpen.getTime()) && regOpen > nowDate) return 'upcoming';
    }

    return this._isEventTrulyFull(event) ? 'full' : 'open';
  },

  _syncEventEffectiveStatus(event, nowDate = new Date()) {
    if (!event?.id) return event;
    const nextStatus = this._getEventEffectiveStatus(event, nowDate);
    if (event.status !== nextStatus) {
      ApiService.updateEvent(event.id, { status: nextStatus });
      return ApiService.getEvent(event.id) || event;
    }
    return event;
  },

  _calcCountdown(e) {
    if (e.status === 'ended') return '已結束';
    if (e.status === 'cancelled') return '已取消';
    if (e.status === 'upcoming' && e.regOpenTime) return '即將開放';
    const start = this._parseEventStartDate(e.date);
    if (!start) return '';
    const now = new Date();
    const diff = start - now;
    if (diff <= 0) return '已結束';
    const totalMin = Math.floor(diff / 60000);
    const days = Math.floor(totalMin / 1440);
    const hours = Math.floor((totalMin % 1440) / 60);
    const mins = totalMin % 60;
    if (days > 0) return `剩餘 ${days}日${hours}時`;
    if (hours > 0) return `剩餘 ${hours}時${mins}分`;
    return `剩餘 ${mins}分`;
  },

  /** 自動將過期的 open/full 活動改為 ended；報名時間到達的 upcoming 改為 open；人數達上限的 open 改為 full */
  _autoEndLastCheck: 0,
  _autoEndExpiredEvents() {
    const now = Date.now();
    if (now - this._autoEndLastCheck < 30000) return; // 30 秒內不重複檢查
    this._autoEndLastCheck = now;
    const nowDate = new Date();
    ApiService.getEvents().forEach(e => {
      this._syncEventEffectiveStatus(e, nowDate);
      // 已結束/已取消 → 跳過
      if (e.status === 'ended' || e.status === 'cancelled') return;
      // upcoming → open（報名時間已到）
      if (e.status === 'upcoming' && e.regOpenTime) {
        const regOpen = new Date(e.regOpenTime);
        if (regOpen <= nowDate) {
          ApiService.updateEvent(e.id, { status: 'open' });
        }
        return;
      }
      // open → full（人數已達上限，外部活動不適用）
      if (e.status === 'open' && e.type !== 'external' && e.max > 0 && e.current >= e.max) {
        ApiService.updateEvent(e.id, { status: 'full' });
      }
      if (e.status !== 'open' && e.status !== 'full') return;
      const end = this._parseEventEndDate(e.date) || this._parseEventStartDate(e.date);
      if (end && end <= nowDate) {
        ApiService.updateEvent(e.id, { status: 'ended' });
      }
    });
  },

  /** 判斷當前用戶是否已報名 */
  _isUserSignedUp(e) {
    const user = ApiService.getCurrentUser?.();
    if (!user) return false;
    const uid = user.uid || '';
    const name = user.displayName || user.name || '';

    // 優先查 registrations（demo + production 通用）
    const regs = ApiService.getRegistrationsByEvent?.(e.id) || [];
    if (regs.some(r => r.userId === uid && r.status !== 'cancelled' && r.status !== 'removed')) return true;

    // Fallback: 舊資料用 participants/waitlistNames
    const inParticipants = (e.participants || []).some(p => p === name || p === uid);
    const inWaitlist = (e.waitlistNames || []).some(p => p === name || p === uid);
    return inParticipants || inWaitlist;
  },

  /** 判斷當前用戶是否在候補名單中 */
  _isUserOnWaitlist(e) {
    const user = ApiService.getCurrentUser?.();
    if (!user) return false;
    const uid = user.uid || '';
    const name = user.displayName || user.name || '';

    // 優先查 registrations（demo + production 通用）
    const regs = ApiService.getRegistrationsByEvent?.(e.id) || [];
    if (regs.some(r => r.userId === uid && r.status === 'waitlisted')) return true;

    // Fallback: 舊資料
    return (e.waitlistNames || []).some(p => p === name || p === uid);
  },

  // ══════════════════════════════════
  //  Render: Hot Events
  // ══════════════════════════════════

  _shouldShowHomeEventLoadingHint() {
    if (ModeManager.isDemo()) return false;

    const lineAuth = typeof LineAuth !== 'undefined' ? LineAuth : null;
    const isLoggedIn = !!lineAuth?.isLoggedIn?.();
    const hasSession = !!lineAuth?.hasLiffSession?.();
    const authPending = !!lineAuth?.isPendingLogin?.() || (hasSession && !isLoggedIn);
    const definitelyLoggedOut = !isLoggedIn && !authPending && !hasSession;
    if (definitelyLoggedOut) return false;

    const publicDataPending = typeof FirebaseService !== 'undefined' && FirebaseService && !FirebaseService._initialized;
    const cloudPending = !this._cloudReady || !!this._cloudReadyPromise;
    return authPending || publicDataPending || cloudPending;
  },

  _showHomeEventLoadingToast(isSlow = false) {
    const now = Date.now();
    const cooldownMs = isSlow ? 1400 : 900;
    if (now - (this._homeEventLoadingToastAt || 0) < cooldownMs) return;
    this._homeEventLoadingToastAt = now;

    // Show persistent toast (no auto-dismiss)
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = isSlow ? '網路較慢，活動資料仍在載入中...' : '活動資料載入中，請稍候 1-2 秒';
    toast.classList.add('show');
    clearTimeout(this._toastTimer);
    // Keep toast visible — do NOT set auto-dismiss timer

    // 5s escalation: change message to reload hint
    clearTimeout(this._homeEventLoadingEscalateTimer);
    this._homeEventLoadingEscalateTimer = setTimeout(() => {
      if (!toast.classList.contains('show')) return;
      toast.textContent = '若加載過久請關閉所有分頁並重整瀏覽器';
    }, 5000);
  },

  _dismissHomeEventLoadingToast() {
    clearTimeout(this._homeEventLoadingEscalateTimer);
    this._homeEventLoadingEscalateTimer = null;
    const toast = document.getElementById('toast');
    if (toast) toast.classList.remove('show');
  },

  // ── Home card loading bar (survives DOM rebuilds via eventId tracking) ──
  _homeCardLoadingState: null, // { eventId, progress, startedAt, interval }

  _markHomeEventCardPending(cardEl) {
    if (!cardEl || !cardEl.classList) return;
    const eventId = this._getCardEventId(cardEl);
    cardEl.classList.add('is-pending');
    cardEl.setAttribute('aria-busy', 'true');
    this._injectCardLoadingBar(cardEl);

    // Start or continue simulated progress tracked by eventId
    if (!this._homeCardLoadingState || this._homeCardLoadingState.eventId !== eventId) {
      clearInterval(this._homeCardLoadingState?.interval);
      const state = { eventId, progress: 0, startedAt: Date.now(), interval: null };
      state.interval = setInterval(() => {
        const p = state.progress;
        const inc = p < 30 ? 4 : p < 60 ? 2 : p < 80 ? 0.5 : 0.15;
        state.progress = Math.min(p + inc, 85);
        // Update fill on the current DOM element (may have been rebuilt)
        const card = this._findCardByEventId(state.eventId);
        const fill = card && card.querySelector('.h-card-loading-fill');
        if (fill) fill.style.width = state.progress + '%';
      }, 100);
      this._homeCardLoadingState = state;
    }
  },

  _clearHomeEventCardPending(cardEl, minVisibleMs = 0) {
    const state = this._homeCardLoadingState;
    if (!state) return;

    clearInterval(state.interval);
    state.interval = null;

    const elapsed = Date.now() - state.startedAt;
    const waitMs = Math.max(0, minVisibleMs - elapsed);
    const eventId = state.eventId;

    setTimeout(() => {
      const card = this._findCardByEventId(eventId) || cardEl;
      if (!card) { this._homeCardLoadingState = null; return; }

      // Snap to 100%
      const fill = card.querySelector('.h-card-loading-fill');
      if (fill) fill.style.width = '100%';

      // After fill reaches 100%, fade out overlay + remove bar
      setTimeout(() => {
        const card2 = this._findCardByEventId(eventId) || card;
        if (card2) card2.classList.add('is-loaded');
        setTimeout(() => {
          const card3 = this._findCardByEventId(eventId) || card2;
          if (card3) {
            card3.classList.remove('is-pending', 'is-loaded');
            card3.removeAttribute('aria-busy');
            const bar = card3.querySelector('.h-card-loading-bar');
            if (bar) bar.remove();
          }
          this._homeCardLoadingState = null;
        }, 400);
      }, 350);
    }, waitMs);
  },

  _injectCardLoadingBar(cardEl) {
    const imgEl = cardEl && cardEl.querySelector('.h-card-img');
    if (!imgEl || imgEl.querySelector('.h-card-loading-bar')) return;
    const bar = document.createElement('div');
    bar.className = 'h-card-loading-bar';
    bar.innerHTML = '<div class="h-card-loading-fill"></div>';
    imgEl.appendChild(bar);
    // Restore current progress if available
    const state = this._homeCardLoadingState;
    if (state) {
      const fill = bar.querySelector('.h-card-loading-fill');
      if (fill) fill.style.width = state.progress + '%';
    }
  },

  _getCardEventId(cardEl) {
    if (!cardEl) return null;
    const onclick = cardEl.getAttribute('onclick') || '';
    const m = onclick.match(/openHomeEventDetailFromCard\(['"]([^'"]+)['"]/);
    return m ? m[1] : null;
  },

  _findCardByEventId(eventId) {
    if (!eventId) return null;
    const container = document.getElementById('hot-events');
    if (!container) return null;
    const cards = container.querySelectorAll('.h-card');
    for (const c of cards) {
      if (this._getCardEventId(c) === eventId) return c;
    }
    return null;
  },

  async openHomeEventDetailFromCard(eventId, cardEl) {
    const safeEventId = String(eventId || '').trim();
    const targetCard = cardEl?.closest ? cardEl.closest('.h-card') : cardEl;
    if (!safeEventId) return { ok: false, reason: 'missing-id' };

    // 外部活動：直接跳轉
    const extEvent = ApiService.getEvent(safeEventId);
    if (extEvent?.type === 'external' && extEvent.externalUrl) {
      location.href = extEvent.externalUrl;
      return { ok: true };
    }

    if (targetCard?.dataset?.homeEventOpening === '1') {
      this._markHomeEventCardPending(targetCard);
      if (Date.now() - Number(targetCard?._homeEventOpenStartedAt || 0) >= 1000) {
        this._showHomeEventLoadingToast(true);
      }
      return { ok: false, reason: 'pending' };
    }

    const shouldHintLoading = this._shouldShowHomeEventLoadingHint();
    if (targetCard?.dataset) {
      targetCard.dataset.homeEventOpening = '1';
    }
    if (targetCard) {
      targetCard._homeEventOpenStartedAt = Date.now();
    }
    if (shouldHintLoading) {
      this._markHomeEventCardPending(targetCard);
      if (targetCard) {
        clearTimeout(targetCard._homeEventLoadingToastTimer);
        targetCard._homeEventLoadingToastTimer = setTimeout(() => {
          if (targetCard?.dataset?.homeEventOpening === '1') {
            this._showHomeEventLoadingToast(false);
          }
        }, 1000);
      }
    }

    try {
      const result = await this.showEventDetail(safeEventId);
      if (!result?.ok && result?.reason === 'missing') {
        this.showToast('活動資料暫時無法開啟，請稍後再試');
      }
      return result;
    } catch (err) {
      console.error('[HomeEventClick] open detail failed:', err);
      this.showToast('活動資料暫時無法開啟，請稍後再試');
      return { ok: false, reason: 'error' };
    } finally {
      if (targetCard) {
        clearTimeout(targetCard._homeEventLoadingToastTimer);
        targetCard._homeEventLoadingToastTimer = null;
      }
      this._dismissHomeEventLoadingToast();
      this._clearHomeEventCardPending(targetCard, shouldHintLoading ? 650 : 0);
      if (targetCard?.dataset) {
        clearTimeout(targetCard._homeEventOpenLockTimer);
        targetCard._homeEventOpenLockTimer = setTimeout(() => {
          delete targetCard.dataset.homeEventOpening;
          targetCard._homeEventOpenStartedAt = 0;
          targetCard._homeEventOpenLockTimer = null;
        }, shouldHintLoading ? 900 : 320);
      }
    }
  },

  // ── Timeline card loading bar ──
  _tlCardLoadingState: null,

  _tlFindCardByEventId(eventId) {
    if (!eventId) return null;
    var container = document.getElementById('activity-list');
    if (!container) return null;
    var rows = container.querySelectorAll('.tl-event-row');
    for (var i = 0; i < rows.length; i++) {
      var onclick = rows[i].getAttribute('onclick') || '';
      if (onclick.indexOf("'" + eventId + "'") !== -1) return rows[i];
    }
    return null;
  },

  _markTlCardPending(cardEl) {
    if (!cardEl || !cardEl.classList) return;
    cardEl.classList.add('tl-pending');
    cardEl.setAttribute('aria-busy', 'true');
    if (!cardEl.querySelector('.tl-loading-bar')) {
      var bar = document.createElement('div');
      bar.className = 'tl-loading-bar';
      bar.innerHTML = '<div class="tl-loading-fill"></div>';
      cardEl.appendChild(bar);
    }
    var eventId = null;
    var onclick = cardEl.getAttribute('onclick') || '';
    var m = onclick.match(/openTimelineEventDetail\(['"]([^'"]+)['"]/);
    if (m) eventId = m[1];

    if (!this._tlCardLoadingState || this._tlCardLoadingState.eventId !== eventId) {
      clearInterval(this._tlCardLoadingState?.interval);
      var state = { eventId: eventId, progress: 0, startedAt: Date.now(), interval: null };
      var self = this;
      state.interval = setInterval(function() {
        var p = state.progress;
        var inc = p < 30 ? 4 : p < 60 ? 2 : p < 80 ? 0.5 : 0.15;
        state.progress = Math.min(p + inc, 85);
        var card = self._tlFindCardByEventId(state.eventId);
        var fill = card && card.querySelector('.tl-loading-fill');
        if (fill) fill.style.width = state.progress + '%';
      }, 100);
      this._tlCardLoadingState = state;
    }
    var st = this._tlCardLoadingState;
    if (st) {
      var fill = cardEl.querySelector('.tl-loading-fill');
      if (fill) fill.style.width = st.progress + '%';
    }
  },

  _clearTlCardPending(cardEl, minVisibleMs) {
    var state = this._tlCardLoadingState;
    if (!state) return;
    clearInterval(state.interval);
    state.interval = null;
    var elapsed = Date.now() - state.startedAt;
    var waitMs = Math.max(0, (minVisibleMs || 0) - elapsed);
    var eventId = state.eventId;
    var self = this;
    setTimeout(function() {
      var card = self._tlFindCardByEventId(eventId) || cardEl;
      if (!card) { self._tlCardLoadingState = null; return; }
      var fill = card.querySelector('.tl-loading-fill');
      if (fill) fill.style.width = '100%';
      setTimeout(function() {
        var card2 = self._tlFindCardByEventId(eventId) || card;
        if (card2) card2.classList.add('tl-loaded');
        setTimeout(function() {
          var card3 = self._tlFindCardByEventId(eventId) || card2;
          if (card3) {
            card3.classList.remove('tl-pending', 'tl-loaded');
            card3.removeAttribute('aria-busy');
            var bar = card3.querySelector('.tl-loading-bar');
            if (bar) bar.remove();
          }
          self._tlCardLoadingState = null;
        }, 400);
      }, 350);
    }, waitMs);
  },

  async openTimelineEventDetail(eventId, cardEl) {
    var safeEventId = String(eventId || '').trim();
    var targetCard = cardEl && cardEl.closest ? cardEl.closest('.tl-event-row') : cardEl;
    if (!safeEventId) return;

    // 外部活動：直接跳轉
    var extEvent = ApiService.getEvent(safeEventId);
    if (extEvent && extEvent.type === 'external' && extEvent.externalUrl) {
      location.href = extEvent.externalUrl;
      return;
    }

    if (targetCard && targetCard.dataset.tlOpening === '1') return;
    var shouldHint = this._shouldShowHomeEventLoadingHint();
    if (targetCard && targetCard.dataset) targetCard.dataset.tlOpening = '1';
    if (shouldHint && targetCard) this._markTlCardPending(targetCard);

    try {
      var result = await this.showEventDetail(safeEventId);
      if (!result?.ok && result?.reason === 'missing') {
        this.showToast('活動資料暫時無法開啟，請稍後再試');
      }
    } catch (err) {
      console.error('[TimelineEventClick] open detail failed:', err);
      this.showToast('活動資料暫時無法開啟，請稍後再試');
    } finally {
      this._clearTlCardPending(targetCard, shouldHint ? 650 : 0);
      if (targetCard && targetCard.dataset) {
        var tc = targetCard;
        setTimeout(function() { delete tc.dataset.tlOpening; }, shouldHint ? 900 : 320);
      }
    }
  },

  renderHotEvents() {
    this._autoEndExpiredEvents();
    this.renderHomeGameShortcut();
    const container = document.getElementById('hot-events');
    if (!container) return;
    // 顯示最近 10 場未結束活動（依日期排序）
    const visible = this._getVisibleEvents()
      .filter(e => e.status !== 'ended' && e.status !== 'cancelled')
      .sort((a, b) => {
        const ap = a?.pinned ? 1 : 0;
        const bp = b?.pinned ? 1 : 0;
        if (ap !== bp) return bp - ap;
        if (ap && bp) {
          const ao = Number(a?.pinOrder) || 0;
          const bo = Number(b?.pinOrder) || 0;
          if (ao !== bo) return ao - bo;
        }
        const da = this._parseEventStartDate(a.date);
        const db = this._parseEventStartDate(b.date);
        return (da || 0) - (db || 0);
      })
      .slice(0, 10);
    this._setHomeSectionVisibility(container, visible.length > 0);
    if (visible.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = visible.map(e => {
        const _dp = (e.date || '').split(' ')[0].split('/');
        const _typeKey = TYPE_CONFIG?.[e.type] ? e.type : 'friendly';
        const _typeLabel = TYPE_CONFIG?.[_typeKey]?.label || '活動';
        const _typeRibbon = `<span class="h-card-type-ribbon h-card-type-ribbon-${_typeKey}">${escapeHTML(_typeLabel)}</span>`;
        const _sportIcon = this._renderEventSportIcon(e, 'h-card-sport-chip');
        const _dateTag = _dp.length >= 3
          ? `<span class="h-card-date-chip">${parseInt(_dp[1])}/${parseInt(_dp[2])}</span>`
          : '';
        const _cornerBadges = `<div class="h-card-corner-badges">${_sportIcon}${_dateTag}</div>`;
        const _isExternal = e.type === 'external';
        const _genderRibbon = !_isExternal && this._hasEventGenderRestriction(e)
          ? `<span class="h-card-gender-ribbon">${escapeHTML(this._getEventGenderRibbonText(e))}</span>`
          : '';
        let _metaBottom = '';
        if (_isExternal) {
          _metaBottom = `<div class="h-card-meta-bottom"><span class="h-card-meta-count" style="color:var(--info)">外部活動</span></div>`;
        } else {
          const _stats = this._getEventParticipantStats(e);
          const _capacityBadge = this._renderEventCapacityBadge(e, _stats);
          const _participantCountClass = _stats.isCapacityFull ? 'h-card-meta-count h-card-meta-count-full' : 'h-card-meta-count';
          const _participantCount = `${_stats.confirmedCount}/${_stats.maxCount}${t('activity.participants')}${_stats.waitlistCount > 0 ? ' 候補' + _stats.waitlistCount : ''}`;
          const _metaBottomClass = _genderRibbon ? 'h-card-meta-bottom h-card-meta-bottom-has-ribbon' : 'h-card-meta-bottom';
          _metaBottom = `<div class="${_metaBottomClass}"><span class="${_participantCountClass}">${_participantCount}</span>${_capacityBadge}</div>`;
        }
        return `
        <div class="h-card" style="${e.pinned ? 'border:1px solid var(--warning);box-shadow:0 0 0 1px rgba(245,158,11,.15)' : ''}" onclick="App.openHomeEventDetailFromCard('${e.id}', this)">
          ${e.image
            ? `<div class="h-card-img">${_cornerBadges}${_typeRibbon}<img src="${e.image}" alt="${escapeHTML(e.title)}" loading="lazy"></div>`
            : `<div class="h-card-img h-card-placeholder">${_cornerBadges}${_typeRibbon}220 × 90</div>`}
          <div class="h-card-body">
            <div class="h-card-title">${e.pinned ? '<span style="font-size:.62rem;padding:.08rem .35rem;border-radius:999px;border:1px solid var(--warning);color:var(--warning);font-weight:700;margin-right:.3rem">置頂</span>' : ''}${escapeHTML(e.title)}${e.teamOnly ? '<span class="tl-teamonly-badge">球隊限定</span>' : ''} ${this._favHeartHtml(this.isEventFavorited(e.id), 'Event', e.id)}</div>
            <div class="h-card-meta">
              <span class="h-card-meta-location">${escapeHTML(e.location || '')}</span>
              ${_metaBottom}
            </div>
          </div>
          ${_genderRibbon}
        </div>
      `; }).join('');

    // Restore loading bar if a card was being loaded when DOM was rebuilt
    const loadState = this._homeCardLoadingState;
    if (loadState && loadState.eventId) {
      const card = this._findCardByEventId(loadState.eventId);
      if (card) {
        card.classList.add('is-pending');
        card.setAttribute('aria-busy', 'true');
        this._injectCardLoadingBar(card);
      }
    }
  },

  // ══════════════════════════════════
  //  Render: Activity Timeline
  // ══════════════════════════════════

  renderActivityList() {
    this._autoEndExpiredEvents();
    const container = document.getElementById('activity-list');
    if (!container) return;

    // 篩選：類別 + 關鍵字
    const filterType = document.getElementById('activity-filter-type')?.value || '';
    const filterKw = (document.getElementById('activity-filter-keyword')?.value || '').trim().toLowerCase();

    let events = this._getVisibleEvents();

    // 頁簽篩選：一般 = 非已結束/已取消，已結束 = ended/cancelled
    const activeTab = this._activityActiveTab || 'normal';
    if (activeTab === 'ended') {
      events = events.filter(e => e.status === 'ended' || e.status === 'cancelled');
    } else {
      events = events.filter(e => e.status !== 'ended' && e.status !== 'cancelled');
    }

    if (filterType) events = events.filter(e => e.type === filterType);
    if (filterKw) events = events.filter(e =>
      (e.title || '').toLowerCase().includes(filterKw) ||
      (e.location || '').toLowerCase().includes(filterKw)
    );

    const monthGroups = {};
    events.forEach(e => {
      const parts = e.date.split(' ')[0].split('/');
      const monthKey = `${parts[0]}/${parts[1]}`;
      const day = parseInt(parts[2], 10);
      const dateObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, day);
      const dayName = DAY_NAMES[dateObj.getDay()];

      if (!monthGroups[monthKey]) monthGroups[monthKey] = {};
      if (!monthGroups[monthKey][day]) {
        monthGroups[monthKey][day] = { day, dayName, dateObj, events: [] };
      }
      monthGroups[monthKey][day].events.push(e);
    });

    const today = new Date();
    const todayStr = `${today.getFullYear()}/${today.getMonth()+1}/${today.getDate()}`;

    const isEndedTab = activeTab === 'ended';
    let html = '';
    Object.keys(monthGroups).sort((a, b) => isEndedTab ? b.localeCompare(a) : a.localeCompare(b)).forEach(monthKey => {
      const [y, m] = monthKey.split('/');
      const monthLabel = `${y} 年 ${parseInt(m)} 月`;
      html += `<div class="tl-month-group">`;
      html += `<div class="tl-month-header">${monthLabel}</div>`;

      const days = Object.values(monthGroups[monthKey]).sort((a, b) => isEndedTab ? b.day - a.day : a.day - b.day);
      days.forEach(dayInfo => {
        const isToday = todayStr === `${y}/${parseInt(m)}/${dayInfo.day}`;
        html += `<div class="tl-day-group">`;
        html += `<div class="tl-date-col${isToday ? ' today' : ''}">
          <div class="tl-day-num">${dayInfo.day}</div>
          <div class="tl-day-name">週${dayInfo.dayName}</div>
        </div>`;
        html += `<div class="tl-events-col">`;

        // 同一天內依開始時間排序（越早越上面）
        dayInfo.events.sort((a, b) => {
          const ap = a?.pinned ? 1 : 0;
          const bp = b?.pinned ? 1 : 0;
          if (ap !== bp) return bp - ap;
          if (ap && bp) {
            const ao = Number(a?.pinOrder) || 0;
            const bo = Number(b?.pinOrder) || 0;
            if (ao !== bo) return ao - bo;
          }
          const ta = (a.date || '').split(' ')[1] || '';
          const tb = (b.date || '').split(' ')[1] || '';
          return isEndedTab ? tb.localeCompare(ta) : ta.localeCompare(tb);
        });

        dayInfo.events.forEach(e => {
          const typeConf = TYPE_CONFIG[e.type] || TYPE_CONFIG.friendly;
          const time = e.date.split(' ')[1] || '';
          const isEnded = e.status === 'ended' || e.status === 'cancelled';
          const isExternal = e.type === 'external';

          // 外部活動：自訂 status 與 meta
          let statusLabel, statusCss, metaText;
          if (isExternal) {
            if (e.status === 'cancelled') { statusLabel = '已取消'; statusCss = 'cancelled'; }
            else if (isEnded) { statusLabel = '已結束'; statusCss = 'ended'; }
            else { statusLabel = '外部活動'; statusCss = 'external'; }
            const locPart = e.location ? ` · ${escapeHTML((e.location || '').split('市')[1] || e.location)}` : '';
            metaText = `${typeConf.label} · ${time}${locPart}`;
          } else {
            const statusConf = STATUS_CONFIG[e.status] || STATUS_CONFIG.open;
            statusLabel = statusConf.label;
            statusCss = statusConf.css;
            const stats = this._getEventParticipantStats(e);
            const waitlistTag = stats.waitlistCount > 0 ? ` · 候補(${stats.waitlistCount})` : '';
            metaText = `${typeConf.label} · ${time} · ${escapeHTML((e.location || '').split('市')[1] || e.location)} · ${stats.confirmedCount}/${stats.maxCount}人${waitlistTag}`;
          }

          // 球隊限定用特殊色
          const rowClass = e.teamOnly ? 'tl-type-teamonly' : `tl-type-${e.type}`;
          const teamBadge = e.teamOnly ? '<span class="tl-teamonly-badge">限定</span>' : '';
          const genderRibbon = !isExternal && this._hasEventGenderRestriction(e)
            ? `<span class="tl-event-gender-ribbon">${escapeHTML(this._getEventGenderTimelineRibbonText(e))}</span>`
            : '';
          const sportIcon = this._renderEventSportIcon(e, 'tl-event-sport-corner');
          const favHeart = this._favHeartHtml(this.isEventFavorited(e.id), 'Event', e.id);
          const iconStack = `<div class="tl-event-icons">${favHeart}${sportIcon}</div>`;

          html += `
            <div class="tl-event-row ${rowClass}${isEnded ? ' tl-past' : ''}" style="${e.pinned ? 'border:1px solid var(--warning);box-shadow:0 0 0 1px rgba(245,158,11,.12)' : ''}" onclick="App.openTimelineEventDetail('${e.id}', this)">
              ${genderRibbon}
              ${e.image ? `<div class="tl-event-thumb"><img src="${e.image}" loading="lazy"></div>` : ''}
              <div class="tl-event-info">
                <div class="tl-event-title-row"><div class="tl-event-title">${e.pinned ? '<span style="font-size:.62rem;padding:.08rem .35rem;border-radius:999px;border:1px solid var(--warning);color:var(--warning);font-weight:700;margin-right:.3rem">置頂</span>' : ''}${escapeHTML(e.title)}${teamBadge}</div></div>
                <div class="tl-event-meta">${metaText}</div>
              </div>
              <span class="tl-event-status ${statusCss}">${statusLabel}</span>
              ${iconStack}
              <span class="tl-event-arrow">›</span>
            </div>`;
        });

        html += `</div></div>`;
      });

      html += `</div>`;
    });

    container.innerHTML = html || `<div style="padding:1.5rem;font-size:.82rem;color:var(--text-muted);text-align:center">${t('activity.noMatch')}</div>`;
    this._markPageSnapshotReady?.('page-activities');
  },

  // ══════════════════════════════════
  //  Heat Prediction & Share
  // ══════════════════════════════════

  _renderHeatPrediction(e) {
    if (e.status === 'ended' || e.status === 'cancelled') return '';
    const pred = this._calcHeatPrediction(e);
    if (!pred) return '';
    const colors = { hot: '#dc2626', warm: '#f59e0b', normal: '#3b82f6', cold: '#6b7280' };
    const labels = { hot: '極熱門 — 預計快速額滿', warm: '熱門 — 報名踴躍', normal: '一般 — 正常報名中', cold: '冷門 — 名額充裕' };
    return `<div class="detail-row"><span class="detail-label">熱度</span><span style="color:${colors[pred]};font-weight:600">${labels[pred]}</span></div>`;
  },

  _calcHeatPrediction(e) {
    if (!e.max || e.max === 0) return null;
    const fillRate = e.current / e.max;
    const start = this._parseEventStartDate(e.date);
    if (!start) return fillRate >= 0.8 ? 'hot' : fillRate >= 0.5 ? 'warm' : 'normal';
    const now = new Date();
    const daysLeft = Math.max(0, (start - now) / 86400000);
    // High fill rate + lots of time left = very hot
    if (fillRate >= 0.9) return 'hot';
    if (fillRate >= 0.7 && daysLeft > 3) return 'hot';
    if (fillRate >= 0.5) return 'warm';
    if (fillRate >= 0.3 && daysLeft > 7) return 'warm';
    if (fillRate < 0.15 && daysLeft < 3) return 'cold';
    return 'normal';
  },

});
