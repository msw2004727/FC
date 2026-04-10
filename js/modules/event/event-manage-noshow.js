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
        people.push({ name: mainName, uid: mainUid, isCompanion: false, displayName: mainName, hasSelfReg: !proxyOnly, proxyOnly, displayBadges: mainReg.displayBadges || [], teamKey: mainReg.teamKey || null, regDocId: mainReg._docId || mainReg.id || null });
        addedUids.add(mainUid);
        addedNames.add(mainName);
        companions.forEach(c => {
          const cName = c.companionName || c.userName;
          const cUid = c.companionId || (mainUid + '_' + c.companionName);
          people.push({ name: cName, uid: cUid, isCompanion: true, displayName: cName, hasSelfReg: false, proxyOnly: false, teamKey: c.teamKey || null, regDocId: c._docId || c.id || null });
          addedUids.add(cUid);
          addedNames.add(cName);
        });
      });
    }

    // fallback：從 event.participants 字串陣列補齊（非管理員只有自己的 registrations）
    // Phase 1b fix: 標記 uidResolved 以區分 UID 是否成功解析
    const badgeCache = this._eventBadgeCache?.[eventId] || {};
    (e.participants || []).forEach(p => {
      if (addedNames.has(p)) return;
      const userDoc = (ApiService.getAdminUsers() || []).find(u => (u.displayName || u.name) === p);
      const resolvedUid = (userDoc && (userDoc.uid || userDoc.lineUserId)) || p;
      if (addedUids.has(resolvedUid)) return;
      const uidResolved = resolvedUid !== p;
      people.push({ name: p, uid: resolvedUid, isCompanion: false, displayName: p, hasSelfReg: true, proxyOnly: false, uidResolved, displayBadges: badgeCache[resolvedUid] || [] });
      addedUids.add(resolvedUid);
      addedNames.add(p);
    });

    return { people, count: people.length };
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

    const allRegistrations = ApiService._src('registrations');
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
    if (!person || person.isCompanion || !noShowCountByUid) return null;
    const directUid = String(person.uid || '').trim();
    const fallbackUid = String(this._findUserByName?.(person.name)?.uid || '').trim();
    const resolvedUid = (directUid && directUid !== person.name) ? directUid : fallbackUid;
    if (!resolvedUid) return null;
    return noShowCountByUid.get(resolvedUid) || 0;
  },

});
