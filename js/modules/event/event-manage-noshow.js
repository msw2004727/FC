/* === SportHub — No-show statistics ===
   Contains LOCKED functions per CLAUDE.md — do not modify without explicit user authorization
   依賴：event-manage.js (shared helpers)
   =================================== */

Object.assign(App, {

  _buildConfirmedParticipantSummary(eventId) {
    const e = ApiService.getEvent(eventId);
    if (!e) return { people: [], count: 0 };

    const allActiveRegs = ApiService.getRegistrationsByEvent(eventId);
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
      confirmedRegs.forEach(r => {
        if (!groups.has(r.userId)) groups.set(r.userId, []);
        groups.get(r.userId).push(r);
      });
      groups.forEach(regs => {
        const selfReg = regs.find(r => r.participantType === 'self');
        const companions = regs.filter(r => r.participantType === 'companion');
        const mainName = selfReg ? selfReg.userName : regs[0].userName;
        const mainUid = regs[0].userId;
        const proxyOnly = !selfReg;
        const mainReg = selfReg || regs[0];
        people.push({
          name: mainName, uid: mainUid, isCompanion: false, displayName: mainName,
          hasSelfReg: !proxyOnly, proxyOnly, displayBadges: mainReg.displayBadges || [],
          teamKey: mainReg.teamKey || null, regDocId: mainReg._docId || mainReg.id || null,
          teamReservationTeamId: mainReg.teamReservationTeamId || null,
          teamReservationTeamName: mainReg.teamReservationTeamName || null,
          teamSeatSource: mainReg.teamSeatSource || null,
        });
        addedUids.add(mainUid);
        addedNames.add(mainName);
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

    if (wuValid) {
      // 新路徑：直接用 participantsWithUid 的真 UID（消除同暱稱挑錯問題）
      wu.forEach(function (entry) {
        if (!entry || !entry.uid || !entry.name) return;
        if (addedUids.has(entry.uid) || addedNames.has(entry.name)) return;
        people.push({
          name: entry.name, uid: entry.uid, isCompanion: false, displayName: entry.name,
          hasSelfReg: true, proxyOnly: false, uidResolved: true,
          teamKey: entry.teamKey || null, displayBadges: badgeCache[entry.uid] || [],
          teamReservationTeamId: entry.teamReservationTeamId || null,
          teamReservationTeamName: entry.teamReservationTeamName || null,
          teamSeatSource: entry.teamSeatSource || null,
        });
        addedUids.add(entry.uid);
        addedNames.add(entry.name);
      });
    } else {
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
        people.push({ name: p, uid: resolvedUid, isCompanion: false, displayName: p, hasSelfReg: true, proxyOnly: false, uidResolved, displayBadges: badgeCache[resolvedUid] || [] });
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
    const orderedPeople = teamRows.concat(normalRows);
    const count = Math.max(orderedPeople.filter(p => !p.isTeamHeader).length, Number(e.current || 0) || 0);
    const realCount = people.length;

    return { people: orderedPeople, count, realCount, teamSummaries };
  },

  _buildRawNoShowCountByUid() {
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
    const safeUid = String(uid || '').trim();
    if (!safeUid || typeof ApiService?.getUserCorrection !== 'function') return null;
    return ApiService.getUserCorrection(safeUid);
  },

  _getUserNoShowAdjustment(uid) {
    const adjustment = Number(this._getUserNoShowCorrection(uid)?.noShow?.adjustment || 0);
    return Number.isFinite(adjustment) ? Math.trunc(adjustment) : 0;
  },

  _buildNoShowCountByUid() {
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
    const safeUid = String(uid || '').trim();
    if (!safeUid) return 0;
    return this._buildRawNoShowCountByUid().get(safeUid) || 0;
  },

  _getEffectiveNoShowCount(uid) {
    const safeUid = String(uid || '').trim();
    if (!safeUid) return 0;
    const map = this._buildNoShowCountByUid();
    if (!map) return 0;
    return map.get(safeUid) || 0;
  },

  _getNoShowDetailsByUid(uid) {
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
    if (!person || person.isCompanion || person.isTeamPlaceholder || person.isTeamHeader || !noShowCountByUid) return null;
    const directUid = String(person.uid || '').trim();
    const fallbackUid = String(this._findUserByName?.(person.name)?.uid || '').trim();
    const resolvedUid = (directUid && directUid !== person.name) ? directUid : fallbackUid;
    if (!resolvedUid) return null;
    return noShowCountByUid.get(resolvedUid) || 0;
  },

});
