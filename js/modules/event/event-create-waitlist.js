/* ================================================
   SportHub — Event Create: Waitlist Auto-Promotion
   ================================================ */

Object.assign(App, {

  /** 取得下一位應遞補的候補者（按報名時間排序，同 userId 內按 promotionOrder 排） */
  _getNextWaitlistCandidate(eventId) {
    const regs = ApiService.getRegistrationsByEvent(eventId);
    return regs
      .filter(r => r.status === 'waitlisted')
      .sort((a, b) => {
        const ta = new Date(a.registeredAt).getTime();
        const tb = new Date(b.registeredAt).getTime();
        if (ta !== tb) return ta - tb;
        return (a.promotionOrder || 0) - (b.promotionOrder || 0);
      })[0] || null;
  },

  /**
   * 執行單人遞補：僅做本地狀態變更 + 通知，不做 Firestore 寫入也不做投影重建。
   * 呼叫端負責：batch/transaction 寫入 Firestore + 統一 _rebuildOccupancy + _syncEventToFirebase。
   */
  _promoteSingleCandidateLocal(event, reg) {
    if (!reg) return false;

    reg.status = 'confirmed';

    // 更新 activityRecord：waitlisted → registered（同行者不動）
    if (reg.participantType !== 'companion') {
      const arSource = ApiService._src('activityRecords');
      const ar = arSource.find(a => a.eventId === event.id && a.uid === reg.userId && a.status === 'waitlisted');
      if (ar) ar.status = 'registered';
    }

    // 發送遞補通知
    this._sendNotifFromTemplate('waitlist_promoted', {
      eventName: event.title, date: event.date, location: event.location,
    }, reg.userId, 'activity', '活動');

    var _pName = reg.participantType === 'companion' ? (reg.companionName || reg.userName) : reg.userName;
    ApiService._writeOpLog('auto_promote', '自動遞補', `活動「${event.title}」候補 ${_pName || '未知'} 自動遞補為正取`, event.id);

    return true;
  },

  /** 回傳需要 Firestore 寫入的 activityRecord docId 列表（供 batch 使用） */
  _getPromotedArDocIds(event, reg) {
    if (!reg || reg.participantType === 'companion') return [];
    const arSource = ApiService._src('activityRecords');
    const ar = arSource.find(a => a.eventId === event.id && a.uid === reg.userId && a.status === 'registered');
    return (ar && ar._docId) ? [ar._docId] : [];
  },

  // ══════════════════════════════════
  //  候補自動遞補 / 降級（容量變更時）
  // ══════════════════════════════════

  async _adjustWaitlistOnCapacityChange(eventId, oldMax, newMax) {
    const event = ApiService.getEvent(eventId);
    if (!event) return;

    const useCF = typeof shouldUseServerRegistration === 'function' && shouldUseServerRegistration();

    if (useCF && newMax !== oldMax) {
      // ═══ CF 路徑：容量變更的遞補/降級由 cancelRegistration(reason='capacity_change') 處理 ═══
      // 容量變更不需要取消任何報名，只需要調整候補狀態
      // CF cancelRegistration 的 capacity_change 模式會在 transaction 內重建 occupancy
      // 但目前 CF 的 cancelRegistration 需要 registrationIds，容量變更不一定有要取消的
      // 所以這個情境暫時仍用 fallback 路徑，直到 Wave 2 的 onRegistrationWritten trigger 接管
      // fallthrough to original logic
    }

    // ═══ 原有路徑（包含 CF 模式下的容量變更）═══
    if (typeof db !== 'undefined') {
      try {
        const _eventDocId = event._docId || await FirebaseService._getEventDocIdAsync(eventId);
        if (!_eventDocId) throw new Error('[waitlist] eventDocId not found for ' + eventId);
        const snap = await db.collection('events').doc(_eventDocId)
          .collection('registrations')
          .get();
        const firestoreRegs = snap.docs.map(d => {
          const data = d.data();
          return {
            ...data,
            _docId: d.id,
            registeredAt: data.registeredAt?.toDate?.()?.toISOString?.() || data.registeredAt,
          };
        });
        const cacheRegs = ApiService._src('registrations') || [];
        for (const fsReg of firestoreRegs) {
          const cached = cacheRegs.find(r => r.id === fsReg.id || (r._docId && r._docId === fsReg._docId));
          if (cached) {
            cached.status = fsReg.status;
            cached._docId = fsReg._docId;
            cached.registeredAt = fsReg.registeredAt;
            cached.promotionOrder = fsReg.promotionOrder;
          } else {
            cacheRegs.push(fsReg);
          }
        }
      } catch (err) {
        console.warn('[adjustWaitlist] Firestore refresh failed, using cache:', err);
      }
    }

    const allRegs = (ApiService._src('registrations') || []).filter(
      r => r.eventId === eventId && (r.status === 'confirmed' || r.status === 'waitlisted')
    );

    if (newMax > oldMax) {
      // ── 模擬先行：在副本上遞補，commit 成功後才寫入 live cache（Rule #10）──
      const confirmedCount = allRegs.filter(r => r.status === 'confirmed').length;
      let slotsAvailable = newMax - confirmedCount;
      if (slotsAvailable <= 0) return;

      const simRegs = allRegs.map(r => ({ ...r }));
      const arSource = ApiService._src('activityRecords') || [];
      const promotedSim = [];
      const arUpdates = [];

      // 1. 模擬遞補（registeredAt ASC, promotionOrder ASC — Rule #7，從 clone 找候補者）
      const _sortTime = (r) => { const t = new Date(r.registeredAt).getTime(); return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY; };
      while (slotsAvailable > 0) {
        const candidate = simRegs
          .filter(r => r.status === 'waitlisted')
          .sort((a, b) => { const d = _sortTime(a) - _sortTime(b); return d !== 0 ? d : (a.promotionOrder || 0) - (b.promotionOrder || 0); })[0];
        if (!candidate) break;
        candidate.status = 'confirmed';
        promotedSim.push(candidate);
        if (candidate.participantType !== 'companion') {
          const ar = arSource.find(a => a.eventId === event.id && a.uid === candidate.userId && a.status === 'waitlisted');
          if (ar && ar._docId) arUpdates.push({ docId: ar._docId, uid: candidate.userId });
        }
        slotsAvailable--;
      }

      // 2. 用副本計算 occupancy
      const simActive = simRegs.filter(r => r.status === 'confirmed' || r.status === 'waitlisted');
      const occupancy = (typeof FirebaseService !== 'undefined' && typeof FirebaseService._rebuildOccupancy === 'function')
        ? FirebaseService._rebuildOccupancy({ max: newMax, status: event.status }, simActive)
        : null;

      // 3. 建 batch + commit
      // 解析 eventDocId（子集合寫入必要）
      var eventDocId = null;
      if (typeof FirebaseService !== 'undefined' && typeof FirebaseService._getEventDocIdAsync === 'function') {
        eventDocId = await FirebaseService._getEventDocIdAsync(eventId);
      }
      if (!eventDocId) throw new Error('無法取得活動文件 ID: ' + eventId);

      const batch = (typeof db !== 'undefined') ? db.batch() : null;
      if (batch) {
        promotedSim.forEach(sim => {
          if (sim._docId) {
            batch.update(db.collection('events').doc(eventDocId).collection('registrations').doc(sim._docId), { status: 'confirmed' });
          }
        });
        arUpdates.forEach(au => {
          batch.update(db.collection('events').doc(eventDocId).collection('activityRecords').doc(au.docId), { status: 'registered' });
        });
        if (event._docId && occupancy) {
          batch.update(db.collection('events').doc(event._docId), {
            current: occupancy.current, waitlist: occupancy.waitlist,
            participants: occupancy.participants, waitlistNames: occupancy.waitlistNames,
            status: occupancy.status,
          });
        }
        try {
          await batch.commit();
        } catch (err) {
          console.error('[adjustWaitlist] promote batch failed:', err);
          if (typeof this.showToast === 'function') this.showToast('遞補同步失敗，請重試');
          return;
        }
      }

      // 4. commit 成功 → 寫入 live cache（重新查詢 live array，防 onSnapshot 替換）
      const liveRegs = ApiService._src('registrations') || [];
      for (const sim of promotedSim) {
        const live = liveRegs.find(r => r._docId === sim._docId || r.id === sim.id);
        if (live) live.status = 'confirmed';
      }
      for (const au of arUpdates) {
        const liveAr = arSource.find(a => a._docId === au.docId);
        if (liveAr) liveAr.status = 'registered';
      }
      if (occupancy) FirebaseService._applyRebuildOccupancy(event, occupancy);

      // 5. commit 成功 → 發通知 + 寫 opLog
      for (const sim of promotedSim) {
        this._sendNotifFromTemplate('waitlist_promoted', {
          eventName: event.title, date: event.date, location: event.location,
        }, sim.userId, 'activity', '活動');
        const _pName = sim.participantType === 'companion' ? (sim.companionName || sim.userName) : sim.userName;
        ApiService._writeOpLog('auto_promote', '自動遞補', `活動「${event.title}」候補 ${_pName || '未知'} 自動遞補為正取`, eventId);
      }

      if (typeof FirebaseService !== 'undefined' && typeof FirebaseService._saveToLS === 'function') {
        FirebaseService._saveToLS('registrations', FirebaseService._cache.registrations);
        FirebaseService._saveToLS('events', FirebaseService._cache.events);
      }
      if (promotedSim.length > 0) {
        console.log(`[adjustWaitlist] 容量增加，已遞補 ${promotedSim.length} 位候補者`);
      }
    } else if (newMax < oldMax) {
      // ── 模擬先行：在副本上降級，commit 成功後才寫入 live cache（Rule #10）──
      const simRegs = allRegs.map(r => ({ ...r }));
      const arSource = ApiService._src('activityRecords') || [];
      const demotedSim = [];
      const arDemoteUpdates = [];

      // 1. 模擬降級（registeredAt DESC, promotionOrder DESC — Rule #8）
      const sortedForDemote = simRegs
        .filter(r => r.status === 'confirmed')
        .sort((a, b) => {
          const ta = new Date(a.registeredAt).getTime();
          const tb = new Date(b.registeredAt).getTime();
          if (ta !== tb) return tb - ta;
          return (b.promotionOrder || 0) - (a.promotionOrder || 0);
        });
      const excess = sortedForDemote.length - newMax;
      if (excess <= 0) return;

      for (let i = 0; i < excess; i++) {
        const sim = sortedForDemote[i];
        if (!sim) break;
        sim.status = 'waitlisted';
        demotedSim.push(sim);
        if (sim.participantType !== 'companion') {
          const ar = arSource.find(a => a.eventId === event.id && a.uid === sim.userId && a.status === 'registered');
          if (ar && ar._docId) arDemoteUpdates.push({ docId: ar._docId, uid: sim.userId });
        }
      }

      // 2. 用副本計算 occupancy
      const simActive = simRegs.filter(r => r.status === 'confirmed' || r.status === 'waitlisted');
      const occupancy = (typeof FirebaseService !== 'undefined' && typeof FirebaseService._rebuildOccupancy === 'function')
        ? FirebaseService._rebuildOccupancy({ max: newMax, status: event.status }, simActive)
        : null;

      // 3. 建 batch + commit
      // 解析 eventDocId（子集合寫入必要）
      var eventDocId2 = null;
      if (typeof FirebaseService !== 'undefined' && typeof FirebaseService._getEventDocIdAsync === 'function') {
        eventDocId2 = await FirebaseService._getEventDocIdAsync(eventId);
      }
      if (!eventDocId2) throw new Error('無法取得活動文件 ID: ' + eventId);

      const batch = (typeof db !== 'undefined') ? db.batch() : null;
      if (batch) {
        demotedSim.forEach(sim => {
          if (sim._docId) {
            batch.update(db.collection('events').doc(eventDocId2).collection('registrations').doc(sim._docId), { status: 'waitlisted' });
          }
        });
        arDemoteUpdates.forEach(au => {
          batch.update(db.collection('events').doc(eventDocId2).collection('activityRecords').doc(au.docId), { status: 'waitlisted' });
        });
        if (event._docId && occupancy) {
          batch.update(db.collection('events').doc(event._docId), {
            current: occupancy.current, waitlist: occupancy.waitlist,
            participants: occupancy.participants, waitlistNames: occupancy.waitlistNames,
            status: occupancy.status,
          });
        }
        try {
          await batch.commit();
        } catch (err) {
          console.error('[adjustWaitlist] demote batch failed:', err);
          if (typeof this.showToast === 'function') this.showToast('降級同步失敗，請重試');
          return;
        }
      }

      // 4. commit 成功 → 寫入 live cache（重新查詢 live array，防 onSnapshot 替換）
      const liveRegs = ApiService._src('registrations') || [];
      for (const sim of demotedSim) {
        const live = liveRegs.find(r => r._docId === sim._docId || r.id === sim.id);
        if (live) live.status = 'waitlisted';
      }
      for (const au of arDemoteUpdates) {
        const liveAr = arSource.find(a => a._docId === au.docId);
        if (liveAr) liveAr.status = 'waitlisted';
      }
      if (occupancy) FirebaseService._applyRebuildOccupancy(event, occupancy);

      // 5. commit 成功 → 發通知 + 寫 opLog
      for (const sim of demotedSim) {
        this._sendNotifFromTemplate('waitlist_demoted', {
          eventName: event.title, date: event.date, location: event.location,
        }, sim.userId, 'activity', '活動');
      }

      if (typeof FirebaseService !== 'undefined' && typeof FirebaseService._saveToLS === 'function') {
        FirebaseService._saveToLS('registrations', FirebaseService._cache.registrations);
        FirebaseService._saveToLS('events', FirebaseService._cache.events);
      }
      if (demotedSim.length > 0) {
        console.log(`[adjustWaitlist] 容量減少，已降級 ${demotedSim.length} 位正取者到候補`);
        ApiService._writeOpLog('capacity_demote', '容量降級', `活動「${event.title}」因名額調整，${demotedSim.length} 位正取者降為候補`, eventId);
      }
    }
  },

});
