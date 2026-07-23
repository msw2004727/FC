/* === SportHub — No-show statistics ===
   Contains LOCKED functions per CLAUDE.md — do not modify without explicit user authorization
   依賴：event-manage.js (shared helpers)
   =================================== */

Object.assign(App, {

  _isNoShowFeatureEnabled() {
    return typeof isNoShowFeatureEnabled === 'function'
      ? isNoShowFeatureEnabled()
      : true;
  },

  _buildConfirmedParticipantSummary(eventId) {
    const e = ApiService.getEvent(eventId);
    if (!e) return { people: [], count: 0 };

    const cachedActiveRegs = ApiService.getRegistrationsByEvent(eventId) || [];
    const serverFetchedIds = (typeof ApiService !== 'undefined')
      ? ApiService._fetchedRegistrationServerIds
      : null;
    const eventRegsFetchedFromServer = !!(serverFetchedIds
      && typeof serverFetchedIds.has === 'function'
      && serverFetchedIds.has(eventId));
    const hasRealtimeRegistrationState = typeof FirebaseService !== 'undefined'
      && !!FirebaseService._realtimeListenerStarted;
    // The all-registration listener is limit-based; only per-event fetch proves a full roster.
    const hasCompleteRegistrationSnapshot = false;
    const canUseRegistrationRows = !hasRealtimeRegistrationState
      || hasCompleteRegistrationSnapshot
      || eventRegsFetchedFromServer;
    const allActiveRegs = canUseRegistrationRows ? cachedActiveRegs : [];
    const _regTime = (r) => {
      const v = r && r.registeredAt;
      if (!v) return Number.POSITIVE_INFINITY;
      if (typeof v.toMillis === 'function') { try { return v.toMillis(); } catch (_e) {} }
      if (typeof v === 'object' && typeof v.seconds === 'number')
        return (v.seconds * 1000) + Math.floor((v.nanoseconds || 0) / 1000000);
      const t = new Date(v).getTime();
      return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
    };
    const confirmedRegs = allActiveRegs.filter(r => r.status === 'confirmed')
      .sort((a, b) => {
        const ta = _regTime(a), tb = _regTime(b);
        if (ta !== tb) return ta - tb;
        const pa = Number(a.promotionOrder || 0), pb = Number(b.promotionOrder || 0);
        if (pa !== pb) return pa - pb;
        return String(a._docId || a.id || '').localeCompare(String(b._docId || b.id || ''));
      });
    const people = [];
    const addedUids = new Set();
    const addedNames = new Set();

    if (confirmedRegs.length > 0) {
      const groups = new Map();
      confirmedRegs.forEach((r, index) => {
        const isCourseLinked = String(r?.courseLinkSource || r?.source || '').trim() === 'eduCourseLesson'
          || String(r?.courseLinkId || '').trim()
          || String(r?.courseStudentId || '').trim();
        const registrationIdentity = String(r?._docId || r?.id || r?._path || '').trim();
        const groupKey = isCourseLinked
          ? `course:${String(r?.courseStudentId || registrationIdentity || `row-${index}`).trim()}`
          : `user:${String(r?.userId || r?.uid || '').trim()}`;
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey).push(r);
      });
      groups.forEach(regs => {
        const selfReg = regs.find(r => r.participantType === 'self');
        const isCourseLinked = regs.some(r => (
          String(r?.courseLinkSource || r?.source || '').trim() === 'eduCourseLesson'
          || String(r?.courseLinkId || '').trim()
          || String(r?.courseStudentId || '').trim()
        ));
        const companions = regs.filter(r => r.participantType === 'companion');
        const mainUid = regs[0].userId;
        if (selfReg) {
          const mainName = selfReg.userName;
          people.push({
            name: mainName, uid: mainUid, isCompanion: false, displayName: mainName,
            hasSelfReg: true, proxyOnly: false, displayBadges: selfReg.displayBadges || [],
            teamKey: selfReg.teamKey || null, regDocId: selfReg._docId || selfReg.id || null,
            teamReservationTeamId: selfReg.teamReservationTeamId || null,
            teamReservationTeamName: selfReg.teamReservationTeamName || null,
            teamSeatSource: selfReg.teamSeatSource || null,
            courseLinkedRegistration: isCourseLinked,
            courseStudentId: isCourseLinked ? String(selfReg.courseStudentId || '').trim() : '',
          });
          addedUids.add(mainUid);
          addedNames.add(mainName);
        } else {
          const proxyName = regs[0].userName;
          if (mainUid && proxyName) {
            people.push({
              name: proxyName, uid: mainUid, isCompanion: false, displayName: proxyName,
              hasSelfReg: false, proxyOnly: true, isProxyOnly: true,
              displayBadges: regs[0].displayBadges || [],
              teamKey: null, regDocId: null,
              teamReservationTeamId: null,
              teamReservationTeamName: null,
              teamSeatSource: null,
            });
          }
        }
        companions.forEach(c => {
          const cName = c.companionName || c.userName;
          const cUid = c.companionId || (mainUid + '_' + c.companionName);
          people.push({
            name: cName, uid: cUid, isCompanion: true, displayName: cName,
            hasSelfReg: false, proxyOnly: false, teamKey: c.teamKey || null,
            regDocId: c._docId || c.id || null,
            teamReservationTeamId: c.teamReservationTeamId || null,
            teamReservationTeamName: c.teamReservationTeamName || null,
            teamSeatSource: c.teamSeatSource || null,
          });
          addedUids.add(cUid);
          addedNames.add(cName);
        });
      });
    }

    // fallback（Phase 3 2026-04-19）：優先用 event.participantsWithUid 物件陣列（含真 UID）
    // 若無 / 長度不一致，才 fallback 回舊 participants[] 字串反查（同暱稱會挑錯）
    const badgeCache = this._eventBadgeCache?.[eventId] || {};
    const wu = Array.isArray(e.participantsWithUid) ? e.participantsWithUid : [];
    const expectedLen = Number(e.realCurrent || 0) || (Number(e.current || 0) - (Array.isArray(e.teamReservationSummaries) ? e.teamReservationSummaries.reduce((sum, s) => sum + Math.max(0, Number(s.remainingSlots || 0) || 0), 0) : 0));
    const wuValid = wu.length > 0 && wu.length === expectedLen;
    const useProjectedFallbackPeople = !canUseRegistrationRows || confirmedRegs.length === 0;
    const cachedConfirmedRegs = (Array.isArray(cachedActiveRegs) ? cachedActiveRegs : [])
      .filter(r => String(r?.status || 'confirmed').toLowerCase() === 'confirmed');
    const _projectionUidForReg = (reg) => {
      if (!reg) return '';
      const isCompanion = reg.participantType === 'companion' || !!reg.companionId;
      if (isCompanion) {
        const ownerUid = String(reg.userId || reg.uid || '').trim();
        const companionName = String(reg.companionName || reg.userName || reg.name || '').trim();
        return String(reg.companionId || (ownerUid && companionName ? `${ownerUid}_${companionName}` : '')).trim();
      }
      return String(reg.userId || reg.uid || '').trim();
    };
    const _projectionNameForReg = (reg) => {
      if (!reg) return '';
      const isCompanion = reg.participantType === 'companion' || !!reg.companionId;
      return String(isCompanion ? (reg.companionName || reg.userName || reg.name || '') : (reg.userName || reg.name || '')).trim();
    };
    const _lookupProjectedRegistration = (entry) => {
      if (!entry) return null;
      const uid = String(entry.uid || '').trim();
      const name = String(entry.name || entry.displayName || '').trim();
      if (uid) {
        const uidMatches = cachedConfirmedRegs.filter(r => _projectionUidForReg(r) === uid);
        if (uidMatches.length === 1) return uidMatches[0];
      }
      if (name) {
        const nameMatches = cachedConfirmedRegs.filter(r => _projectionNameForReg(r) === name);
        if (nameMatches.length === 1) return nameMatches[0];
      }
      return null;
    };

    if (useProjectedFallbackPeople && wuValid) {
      // 新路徑：直接用 participantsWithUid 的真 UID（消除同暱稱挑錯問題）
      wu.forEach(function (entry) {
        if (!entry || !entry.uid || !entry.name) return;
        if (addedUids.has(entry.uid) || addedNames.has(entry.name)) return;
        const matchedReg = _lookupProjectedRegistration(entry);
        people.push({
          name: entry.name, uid: entry.uid, isCompanion: false, displayName: entry.name,
          hasSelfReg: true, proxyOnly: false, uidResolved: true,
          teamKey: entry.teamKey || matchedReg?.teamKey || null,
          regDocId: matchedReg?._docId || null,
          displayBadges: badgeCache[entry.uid] || matchedReg?.displayBadges || [],
          teamReservationTeamId: entry.teamReservationTeamId || matchedReg?.teamReservationTeamId || null,
          teamReservationTeamName: entry.teamReservationTeamName || matchedReg?.teamReservationTeamName || null,
          teamSeatSource: entry.teamSeatSource || matchedReg?.teamSeatSource || null,
        });
        addedUids.add(entry.uid);
        addedNames.add(entry.name);
      });
    } else if (useProjectedFallbackPeople) {
      if (wu.length > 0) {
        console.warn('[pwu] inconsistent participantsWithUid', e.id, 'wu=', wu.length, 'current=', expectedLen);
      }
      // 舊 fallback：從 event.participants 字串陣列補齊（同暱稱會挑錯 UID，本計劃 Phase 3 已最小化此路徑）
      // 效能優化：先建 displayName → user Map，避免對每位參加者做 O(n) 線性搜尋
      const _allUsers = ApiService.getAdminUsers() || [];
      const _userByName = new Map();
      _allUsers.forEach(function (u) { var n = u.displayName || u.name; if (n) _userByName.set(n, u); });
      (e.participants || []).forEach(p => {
        if (addedNames.has(p)) return;
        const userDoc = _userByName.get(p) || null;
        const resolvedUid = (userDoc && (userDoc.uid || userDoc.lineUserId)) || p;
        if (addedUids.has(resolvedUid)) return;
        const uidResolved = resolvedUid !== p;
        const matchedReg = _lookupProjectedRegistration({ uid: resolvedUid, name: p });
        people.push({
          name: p, uid: resolvedUid, isCompanion: false, displayName: p,
          hasSelfReg: true, proxyOnly: false, uidResolved,
          teamKey: matchedReg?.teamKey || null,
          regDocId: matchedReg?._docId || null,
          displayBadges: badgeCache[resolvedUid] || matchedReg?.displayBadges || [],
          teamReservationTeamId: matchedReg?.teamReservationTeamId || null,
          teamReservationTeamName: matchedReg?.teamReservationTeamName || null,
          teamSeatSource: matchedReg?.teamSeatSource || null,
        });
        addedUids.add(resolvedUid);
        addedNames.add(p);
      });
    }

    const teamSummaries = (typeof FirebaseService !== 'undefined' && FirebaseService._normalizeTeamReservationSummaries)
      ? FirebaseService._normalizeTeamReservationSummaries(e)
      : (Array.isArray(e.teamReservationSummaries) ? e.teamReservationSummaries : []);
    const teamRows = [];
    const groupedTeamIds = new Set();
    teamSummaries
      .filter(s => Number(s.reservedSlots || 0) > 0 || Number(s.usedSlots || 0) > 0)
      .forEach(summary => {
        const teamId = String(summary.teamId || '').trim();
        if (!teamId) return;
        const realPeople = people.filter(p => String(p.teamReservationTeamId || '') === teamId);
        if (realPeople.length === 0 && Number(summary.remainingSlots || 0) <= 0) return;
        groupedTeamIds.add(teamId);
        teamRows.push({
          isTeamHeader: true,
          uid: `team-header-${teamId}`,
          name: summary.teamName || teamId,
          displayName: summary.teamName || teamId,
          teamReservationTeamId: teamId,
          teamReservationTeamName: summary.teamName || teamId,
          reservedSlots: Number(summary.reservedSlots || 0),
          usedSlots: Number(summary.usedSlots || 0),
          remainingSlots: Number(summary.remainingSlots || 0),
        });
        realPeople.forEach(p => teamRows.push(p));
        const remaining = Math.max(0, Number(summary.remainingSlots || 0) || 0);
        for (let i = 0; i < remaining; i++) {
          teamRows.push({
            isTeamPlaceholder: true,
            uid: `team-seat-${teamId}-${i + 1}`,
            name: `${summary.teamName || teamId} 保留席位`,
            displayName: `${summary.teamName || teamId} 保留席位`,
            teamReservationTeamId: teamId,
            teamReservationTeamName: summary.teamName || teamId,
            hasSelfReg: false,
            proxyOnly: false,
          });
        }
      });
    const normalRows = people.filter(p => !p.teamReservationTeamId || !groupedTeamIds.has(String(p.teamReservationTeamId)));
    const orderedPeople = teamRows.length > 0 && normalRows.length > 0
      ? teamRows.concat([{
          isTeamGeneralSeparator: true,
          uid: 'team-reservation-general-separator',
          name: '一般報名',
          displayName: '一般報名',
        }], normalRows)
      : teamRows.concat(normalRows);
    const countablePeople = orderedPeople.filter(p => !p.isTeamHeader && !p.isTeamGeneralSeparator && !p.isTeamPlaceholder && !p.proxyOnly && !p.isProxyOnly);
    const remainingReservedSlots = (Array.isArray(e.teamReservationSummaries) ? e.teamReservationSummaries : [])
      .reduce((sum, s) => sum + Math.max(0, Number(s.remainingSlots || 0) || 0), 0);
    const fallbackCount = typeof this._getEventProjectedConfirmedCount === 'function'
      ? (typeof this._getEventActualConfirmedCount === 'function'
        ? this._getEventActualConfirmedCount(e)
        : Math.max(0, this._getEventProjectedConfirmedCount(e) - remainingReservedSlots))
      : Math.max(0, Number(e.realCurrent ?? (Number(e.current || 0) - remainingReservedSlots) ?? 0) || 0);
    const hasCountSource = orderedPeople.length > 0
      || (Array.isArray(e.participantsWithUid) && e.participantsWithUid.length > 0)
      || (Array.isArray(e.participants) && e.participants.length > 0);
    const count = canUseRegistrationRows
      ? (hasCountSource ? countablePeople.length : fallbackCount)
      : Math.max(countablePeople.length, fallbackCount);
    const realCount = people.filter(p => !p.proxyOnly && !p.isProxyOnly).length;

    return { people: orderedPeople, count, realCount, teamSummaries };
  },

  _buildRawNoShowCountByUid() {
    if (!this._isNoShowFeatureEnabled()) return new Map();
    // 讀取 Cloud Function calcNoShowCounts 預先計算並寫入 users 文件的 noShowCount
    // 不再前端即時跨集合計算（避免 onSnapshot limit 截斷導致誤判）
    const users = ApiService.getAdminUsers() || [];
    const countByUid = new Map();
    users.forEach(function (u) {
      var uid = String(u.uid || u.lineUserId || u._docId || '').trim();
      var count = Number(u.noShowCount || 0);
      if (uid && count > 0) {
        countByUid.set(uid, count);
      }
    });
    return countByUid;
  },

  _getUserNoShowCorrection(uid) {
    if (!this._isNoShowFeatureEnabled()) return null;
    const safeUid = String(uid || '').trim();
    if (!safeUid || typeof ApiService?.getUserCorrection !== 'function') return null;
    return ApiService.getUserCorrection(safeUid);
  },

  _getUserNoShowAdjustment(uid) {
    const adjustment = Number(this._getUserNoShowCorrection(uid)?.noShow?.adjustment || 0);
    return Number.isFinite(adjustment) ? Math.trunc(adjustment) : 0;
  },

  _buildNoShowCountByUid() {
    if (!this._isNoShowFeatureEnabled()) return new Map();
    const rawCountByUid = this._buildRawNoShowCountByUid();
    const effectiveCountByUid = new Map(rawCountByUid);
    const corrections = typeof ApiService?.getUserCorrections === 'function'
      ? ApiService.getUserCorrections()
      : [];

    (corrections || []).forEach(doc => {
      const uid = String(doc?.uid || doc?._docId || '').trim();
      if (!uid) return;
      const adjustment = Number(doc?.noShow?.adjustment || 0);
      if (!Number.isFinite(adjustment) || adjustment === 0) return;
      const next = Math.max(0, (effectiveCountByUid.get(uid) || 0) + Math.trunc(adjustment));
      effectiveCountByUid.set(uid, next);
    });

    return effectiveCountByUid;
  },

  _getRawNoShowCount(uid) {
    if (!this._isNoShowFeatureEnabled()) return 0;
    const safeUid = String(uid || '').trim();
    if (!safeUid) return 0;
    return this._buildRawNoShowCountByUid().get(safeUid) || 0;
  },

  _getEffectiveNoShowCount(uid) {
    if (!this._isNoShowFeatureEnabled()) return 0;
    const safeUid = String(uid || '').trim();
    if (!safeUid) return 0;
    const map = this._buildNoShowCountByUid();
    if (!map) return 0;
    return map.get(safeUid) || 0;
  },

  // 讀取 Cloud Function 預先寫入的「已結束活動正取場次」分母
  _buildEndedRegCountByUid() {
    if (!this._isNoShowFeatureEnabled()) return new Map();
    const users = ApiService.getAdminUsers() || [];
    const map = new Map();
    users.forEach(function (u) {
      var uid = String(u.uid || u.lineUserId || u._docId || '').trim();
      var ended = Number(u.endedRegCount || 0);
      if (uid && ended > 0) map.set(uid, ended);
    });
    return map;
  },

  // 讀取 Cloud Function 預先寫入的「最近一場是否放鴿子」標記
  // 用於膠囊上方的紅底鴿子泡泡，視覺上提示主辦人此用戶最近才剛缺席
  _buildLastNoShowSet() {
    if (!this._isNoShowFeatureEnabled()) return new Set();
    const users = ApiService.getAdminUsers() || [];
    const set = new Set();
    users.forEach(function (u) {
      if (!u || !u.lastEventWasNoShow) return;
      var uid = String(u.uid || u.lineUserId || u._docId || '').trim();
      if (uid) set.add(uid);
    });
    return set;
  },

  // 出席率膠囊填充：返回 { pct, color } 或 null（不渲染）
  // 設計：填充長度 = 放鴿子率（負面比例），完美用戶膠囊保持原色
  // 少樣本豁免：分母 < 3 不渲染（避免新用戶被貼標籤）
  _getParticipantAttendanceFill(uid, noShowCountByUid, endedRegCountByUid) {
    if (!this._isNoShowFeatureEnabled()) return null;
    const safeUid = String(uid || '').trim();
    if (!safeUid) return null;
    const noShowMap = noShowCountByUid || this._buildNoShowCountByUid();
    const endedMap = endedRegCountByUid || this._buildEndedRegCountByUid();
    const ended = Number(endedMap.get(safeUid) || 0);
    if (ended < 3) return null;
    const noShow = Number(noShowMap.get(safeUid) || 0);
    if (noShow <= 0) return null;
    const ratio = Math.min(1, noShow / ended);
    const pct = Math.round(ratio * 100);
    const color = ratio >= 0.5 ? 'rgba(220,38,38,.55)'
      : ratio >= 0.2 ? 'rgba(239,68,68,.45)'
        : 'rgba(251,146,60,.45)';
    return { pct, color, ended, noShow };
  },

  _getNoShowDetailsByUid(uid) {
    if (!this._isNoShowFeatureEnabled()) return [];
    const safeUid = String(uid || '').trim();
    if (!safeUid) return [];

    const allRegistrations = typeof ApiService.getRegistrations === 'function'
      ? ApiService.getRegistrations({ userId: safeUid, includeTerminal: true })
      : [];
    // 全域快取已移除 limit，直接使用全域資料（不再合併 userStatsCache，避免切換用戶時汙染統計）
    const attendanceRecords = ApiService.getAttendanceRecords();
    const checkinKeys = new Set();
    const seenRegKeys = new Set();
    const details = [];
    const today = new Date().toISOString().slice(0, 10);

    (attendanceRecords || []).forEach(record => {
      const rUid = String(record?.uid || '').trim();
      const eventId = String(record?.eventId || '').trim();
      const type = String(record?.type || '').trim();
      const status = String(record?.status || '').trim();
      if (!rUid || !eventId) return;
      if (status === 'removed' || status === 'cancelled') return;
      if (type === 'checkin') {
        checkinKeys.add(`${rUid}::${eventId}`);
      }
    });

    (allRegistrations || []).forEach(reg => {
      const regUid = String(reg?.userId || '').trim();
      const eventId = String(reg?.eventId || '').trim();
      const status = String(reg?.status || '').trim();
      if (regUid !== safeUid || !eventId) return;
      if (status !== 'confirmed') return;
      if (reg.participantType === 'companion') return;

      const key = `${regUid}::${eventId}`;
      if (seenRegKeys.has(key)) return;
      seenRegKeys.add(key);

      const event = ApiService.getEvent(eventId);
      if (!event || event.status !== 'ended') return;
      const eventDate = String(event.date || '').split(' ')[0].replace(/\//g, '-');
      if (!eventDate || eventDate >= today) return;
      if (checkinKeys.has(key)) return;

      details.push({
        eventId,
        eventName: event.title || event.name || eventId,
        eventDate: eventDate.replace(/-/g, '/'),
      });
    });

    details.sort((a, b) => (b.eventDate > a.eventDate ? 1 : b.eventDate < a.eventDate ? -1 : 0));
    return details;
  },

  _getParticipantNoShowCount(person, noShowCountByUid) {
    if (!this._isNoShowFeatureEnabled()) return null;
    if (!person || person.isCompanion || person.isTeamPlaceholder || person.isTeamHeader || !noShowCountByUid) return null;
    const directUid = String(person.uid || '').trim();
    const fallbackUid = String(this._findUserByName?.(person.name)?.uid || '').trim();
    const resolvedUid = (directUid && directUid !== person.name) ? directUid : fallbackUid;
    if (!resolvedUid) return null;
    return noShowCountByUid.get(resolvedUid) || 0;
  },

});
