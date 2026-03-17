/* === SportHub — No-show statistics ===
   Contains LOCKED functions per CLAUDE.md — do not modify without explicit user authorization
   依賴：event-manage.js (shared helpers)
   =================================== */

Object.assign(App, {

  _buildConfirmedParticipantSummary(eventId) {
    const e = ApiService.getEvent(eventId);
    if (!e) return { people: [], count: 0 };

    const allActiveRegs = ApiService.getRegistrationsByEvent(eventId);
    const confirmedRegs = allActiveRegs.filter(r => r.status === 'confirmed');
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
        people.push({ name: mainName, uid: mainUid, isCompanion: false, displayName: mainName, hasSelfReg: !proxyOnly, proxyOnly, displayBadges: mainReg.displayBadges || [] });
        addedUids.add(mainUid);
        addedNames.add(mainName);
        companions.forEach(c => {
          const cName = c.companionName || c.userName;
          const cUid = c.companionId || (mainUid + '_' + c.companionName);
          people.push({ name: cName, uid: cUid, isCompanion: true, displayName: cName, hasSelfReg: false, proxyOnly: false });
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
    // 改用 registrations（權威資料，transaction 保障）取代 activityRecords（衍生資料）
    const allRegistrations = ApiService._src('registrations');
    // 全域快取已移除 limit，直接使用全域資料（不再合併 userStatsCache，避免切換用戶時汙染其他人的統計）
    const attendanceRecords = ApiService.getAttendanceRecords();
    const checkinKeys = new Set();
    const countByUid = new Map();
    const seenRegKeys = new Set();
    const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

    // Step 1: 建立簽到索引
    (attendanceRecords || []).forEach(record => {
      const uid = String(record?.uid || '').trim();
      const eventId = String(record?.eventId || '').trim();
      const type = String(record?.type || '').trim();
      const status = String(record?.status || '').trim();
      if (!uid || !eventId) return;
      if (status === 'removed' || status === 'cancelled') return;
      if (type === 'checkin') {
        checkinKeys.add(`${uid}::${eventId}`);
      }
    });

    // Step 2: 遍歷 registrations，僅計算本人（非同行者）的正式報名
    (allRegistrations || []).forEach(reg => {
      const uid = String(reg?.userId || '').trim();
      const eventId = String(reg?.eventId || '').trim();
      const status = String(reg?.status || '').trim();
      if (!uid || !eventId) return;
      // 只計算正取報名（confirmed）；候補（waitlisted）未被遞補不算放鴿子
      if (status !== 'confirmed') return;
      // 同行者不計算放鴿子
      if (reg.participantType === 'companion') return;

      const key = `${uid}::${eventId}`;
      if (seenRegKeys.has(key)) return;
      seenRegKeys.add(key);

      const event = ApiService.getEvent(eventId);
      if (!event || event.status !== 'ended') return;
      // 活動當天不計入放鴿子，隔天 00:00 後才算
      const eventDate = String(event.date || '').split(' ')[0].replace(/\//g, '-');
      if (!eventDate || eventDate >= today) return;

      // 有簽到紀錄就不算放鴿子
      if (checkinKeys.has(key)) return;

      countByUid.set(uid, (countByUid.get(uid) || 0) + 1);
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
    return this._buildNoShowCountByUid().get(safeUid) || 0;
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
