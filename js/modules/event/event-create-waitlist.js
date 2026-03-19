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

    // 從 Firestore 查詢最新報名資料（不依賴快取），避免快取過時導致遞補/降級錯誤
    if (!ModeManager.isDemo() && typeof db !== 'undefined') {
      try {
        const snap = await db.collection('registrations')
          .where('eventId', '==', eventId)
          .get();
        const firestoreRegs = snap.docs.map(d => {
          const data = d.data();
          return {
            ...data,
            _docId: d.id,
            registeredAt: data.registeredAt?.toDate?.()?.toISOString?.() || data.registeredAt,
          };
        });
        // 同步 Firestore 資料到快取
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
      // ── 容量增加 → 遞補候補 ──
      const confirmedCount = allRegs.filter(r => r.status === 'confirmed').length;
      let slotsAvailable = newMax - confirmedCount;
      if (slotsAvailable <= 0) return;

      const batch = (!ModeManager.isDemo() && typeof db !== 'undefined') ? db.batch() : null;
      const promotedList = [];

      while (slotsAvailable > 0) {
        const candidate = this._getNextWaitlistCandidate(eventId);
        if (!candidate) break;

        // 本地狀態變更 + 通知
        this._promoteSingleCandidateLocal(event, candidate);
        promotedList.push(candidate);

        // 收集 Firestore 寫入到 batch
        if (batch && candidate._docId) {
          batch.update(db.collection('registrations').doc(candidate._docId), { status: 'confirmed' });
        }
        // activityRecord 寫入到 batch
        const arDocIds = this._getPromotedArDocIds(event, candidate);
        if (batch) {
          arDocIds.forEach(docId => batch.update(db.collection('activityRecords').doc(docId), { status: 'registered' }));
        }

        slotsAvailable--;
      }

      // 統一重建投影
      const activeAfter = (ApiService._src('registrations') || []).filter(
        r => r.eventId === eventId && (r.status === 'confirmed' || r.status === 'waitlisted')
      );
      if (typeof FirebaseService !== 'undefined' && typeof FirebaseService._rebuildOccupancy === 'function') {
        const occupancy = FirebaseService._rebuildOccupancy({ max: newMax, status: event.status }, activeAfter);
        FirebaseService._applyRebuildOccupancy(event, occupancy);
      }

      // 把 event 投影也加進 batch，一次寫入
      if (batch && event._docId) {
        batch.update(db.collection('events').doc(event._docId), {
          current: event.current, waitlist: event.waitlist,
          participants: event.participants || [], waitlistNames: event.waitlistNames || [],
          status: event.status,
        });
        try {
          await batch.commit();
        } catch (err) {
          console.error('[adjustWaitlist] batch commit failed:', err);
          if (typeof this.showToast === 'function') this.showToast('遞補同步失敗，請重試');
        }
      }
      // 同步 localStorage
      if (typeof FirebaseService !== 'undefined' && typeof FirebaseService._saveToLS === 'function') {
        FirebaseService._saveToLS('registrations', FirebaseService._cache.registrations);
        FirebaseService._saveToLS('events', FirebaseService._cache.events);
      }

      if (promotedList.length > 0) {
        console.log(`[adjustWaitlist] 容量增加，已遞補 ${promotedList.length} 位候補者`);
      }
    } else if (newMax < oldMax) {
      // ── 容量減少 → 降級多餘正取者到候補 ──
      const confirmedRegs = allRegs
        .filter(r => r.status === 'confirmed')
        .sort((a, b) => {
          const ta = new Date(a.registeredAt).getTime();
          const tb = new Date(b.registeredAt).getTime();
          if (ta !== tb) return tb - ta;
          return (b.promotionOrder || 0) - (a.promotionOrder || 0);
        });
      const excess = confirmedRegs.length - newMax;
      if (excess <= 0) return;

      const batch = (!ModeManager.isDemo() && typeof db !== 'undefined') ? db.batch() : null;
      let demoted = 0;

      for (const reg of confirmedRegs) {
        if (demoted >= excess) break;
        reg.status = 'waitlisted';
        if (batch && reg._docId) {
          batch.update(db.collection('registrations').doc(reg._docId), { status: 'waitlisted' });
        }
        // 同步更新 activityRecord：registered → waitlisted（同行者不動）
        if (reg.participantType !== 'companion') {
          const arSource = ApiService._src('activityRecords');
          const ar = arSource.find(a => a.eventId === event.id && a.uid === reg.userId && a.status === 'registered');
          if (ar) {
            ar.status = 'waitlisted';
            if (batch && ar._docId) {
              batch.update(db.collection('activityRecords').doc(ar._docId), { status: 'waitlisted' });
            }
          }
        }
        demoted++;
        this._sendNotifFromTemplate('waitlist_demoted', {
          eventName: event.title, date: event.date, location: event.location,
        }, reg.userId, 'activity', '活動');
      }

      // 統一重建投影
      const activeAfter = (ApiService._src('registrations') || []).filter(
        r => r.eventId === eventId && (r.status === 'confirmed' || r.status === 'waitlisted')
      );
      if (typeof FirebaseService !== 'undefined' && typeof FirebaseService._rebuildOccupancy === 'function') {
        const occupancy = FirebaseService._rebuildOccupancy({ max: newMax, status: event.status }, activeAfter);
        FirebaseService._applyRebuildOccupancy(event, occupancy);
      }

      if (batch && event._docId) {
        batch.update(db.collection('events').doc(event._docId), {
          current: event.current, waitlist: event.waitlist,
          participants: event.participants || [], waitlistNames: event.waitlistNames || [],
          status: event.status,
        });
        try {
          await batch.commit();
        } catch (err) {
          console.error('[adjustWaitlist] batch commit failed:', err);
          if (typeof this.showToast === 'function') this.showToast('降級同步失敗，請重試');
        }
      }
      if (typeof FirebaseService !== 'undefined' && typeof FirebaseService._saveToLS === 'function') {
        FirebaseService._saveToLS('registrations', FirebaseService._cache.registrations);
        FirebaseService._saveToLS('events', FirebaseService._cache.events);
      }

      if (demoted > 0) {
        console.log(`[adjustWaitlist] 容量減少，已降級 ${demoted} 位正取者到候補`);
      }
    }
  },

});
