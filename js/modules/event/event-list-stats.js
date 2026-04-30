/* ================================================
   SportHub — Event List: Stats, Badges, Date Parsing, Status, Countdown
   依賴：config.js, api-service.js, event-list-helpers.js
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  People Summary & Participant Stats
  // ══════════════════════════════════

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

  // 2026-04-27（方案 A）：stats 計算結果 cache
  // cache key 包含 event 投影欄位（current/waitlist/max/status）、變動自動 invalidate
  // 對首頁 10 張卡片場景：第 1 張算完後、其餘 9 張直接命中 cache、快 10 倍
  _eventStatsCache: null,

  _getEventStatsCacheMap() {
    if (!this._eventStatsCache) this._eventStatsCache = new Map();
    return this._eventStatsCache;
  },

  _clearEventStatsCache() {
    if (this._eventStatsCache) this._eventStatsCache.clear();
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

    // 2026-04-27 方案 A：cache 命中直接返回（cache key 含投影欄位、event 變動自動失效）
    const _cache = this._getEventStatsCacheMap();
    const _cacheKey = event.id + '|' + (event.current || 0) + '|' + (event.waitlist || 0)
      + '|' + (event.max || 0) + '|' + (event.status || '');
    if (_cache.has(_cacheKey)) return _cache.get(_cacheKey);

    const fallbackConfirmed = Math.max(0, Number(event.current || 0));
    const fallbackWaitlist = Math.max(0, Number(event.waitlist || 0));
    let confirmedCount = fallbackConfirmed;
    let waitlistCount = fallbackWaitlist;

    // 2026-04-27 方案 B：_hasCompleteRegs = false 時跳過 _buildEventPeopleSummaryByStatus
    // 直接用 event.current（由 _rebuildOccupancy 保證、透過 events listener 即時推送）
    // 大幅減少 O(N×M) 遍歷成本（首頁 10 卡 × 平均 20 reg = 200+ 次操作 → 0）
    const _hasCompleteRegs = typeof FirebaseService !== 'undefined'
      && FirebaseService._realtimeListenerStarted?.registrations
      && FirebaseService._registrationListenerKey === 'all';

    if (_hasCompleteRegs) {
      // admin 全量 listener 啟動時、走精算路徑（不變）
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
      if (confirmedSummary.hasSource) confirmedCount = confirmedSummary.count;
      if (waitlistSummary.hasSource) waitlistCount = waitlistSummary.count;
    }

    const maxCount = Math.max(0, Number(event.max || 0));
    const remainingCount = maxCount > 0 ? Math.max(0, maxCount - confirmedCount) : 0;
    const isCapacityFull = maxCount > 0 && confirmedCount >= maxCount;
    const isTerminal = event.status === 'ended' || event.status === 'cancelled';

    const _result = {
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

    // 寫入 cache（LRU 限制 200 條、避免無限增長）
    _cache.set(_cacheKey, _result);
    if (_cache.size > 200) {
      const _firstKey = _cache.keys().next().value;
      _cache.delete(_firstKey);
    }
    return _result;
  },

  _renderEventCapacityBadge(event, stats = this._getEventParticipantStats(event)) {
    if (stats.showFullBadge) return '<span class="tl-almost-full-badge">已額滿</span>';
    if (stats.showAlmostFullBadge) return '<span class="tl-almost-full-badge">即將額滿</span>';
    return '';
  },

  _isEventTrulyFull(e) {
    return this._getEventParticipantStats(e).isCapacityFull;
  },

  // ══════════════════════════════════
  //  Sport Tag & Icon
  // ══════════════════════════════════

  _getEventSportTag(event) {
    const key = getSportKeySafe(event?.sportTag);
    return key || 'football';
  },

  _renderEventSportIcon(event, className = '') {
    const sportKey = this._getEventSportTag(event);
    const label = getSportLabelByKey(sportKey);
    const klass = className ? ` ${className}` : '';
    return `<span class="event-sport-icon${klass}" title="${escapeHTML(label)}" aria-label="${escapeHTML(label)}">${getSportIconSvg(sportKey)}</span>`;
  },

  // ══════════════════════════════════
  //  Date Parsing & Status
  // ══════════════════════════════════

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

  // ══════════════════════════════════
  //  User Signup Check
  // ══════════════════════════════════

  _getCurrentUserEventRegistrationState(e) {
    const uid = String(ApiService.getCurrentUser?.()?.uid || '').trim();
    if (!uid || !e?.id) return { signedUp: false, onWaitlist: false };
    const regs = ApiService.getRegistrationsByEvent?.(e.id) || [];
    const isActive = r => r && r.status !== 'cancelled' && r.status !== 'removed';
    const isMine = r => String(r?.userId || r?.uid || '').trim() === uid;
    const myRegs = regs.filter(r => isActive(r) && isMine(r));
    if (myRegs.length > 0) {
      return { signedUp: true, onWaitlist: myRegs.some(r => r.status === 'waitlisted') };
    }
    const hasUid = list => Array.isArray(list) && list.some(item =>
      String(item?.uid || item?.userId || '').trim() === uid
    );
    if (hasUid(e.waitlistWithUid)) return { signedUp: true, onWaitlist: true };
    if (hasUid(e.participantsWithUid)) return { signedUp: true, onWaitlist: false };
    return { signedUp: false, onWaitlist: false };
  },

  /** 判斷當前用戶是否已報名（用 UID 比對 registrations；快取缺漏時用活動名單投影補判斷） */
  _isUserSignedUp(e) {
    return this._getCurrentUserEventRegistrationState(e).signedUp;
  },

  /** 判斷當前用戶是否在候補名單中（用 UID 比對 registrations；快取缺漏時用活動名單投影補判斷） */
  _isUserOnWaitlist(e) {
    return this._getCurrentUserEventRegistrationState(e).onWaitlist;
  },

});
