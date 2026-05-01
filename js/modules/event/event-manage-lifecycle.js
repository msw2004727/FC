/* === SportHub — Activity CRUD operations ===
   依賴：event-manage.js (shared helpers)
   ============================================ */

Object.assign(App, {

  _cancelActivityBusyMap: Object.create(null),

  editExternalActivity(id) {
    const e = ApiService.getEvent(id);
    if (!e || e.type !== 'external') return;
    if (!this._canManageEvent(e)) { this.showToast('您只能編輯自己的活動'); return; }
    this.openCreateExternalEventModal(id);
  },

  editMyActivity(id) {
    if (!this.hasPermission('event.edit_self') && !this.hasPermission('event.edit_all') && !this.hasPermission('activity.manage.entry')) { this.showToast('權限不足'); return; }
    const e = ApiService.getEvent(id);
    if (!e) return;
    if (!this._canManageEvent(e)) { this.showToast('您只能編輯自己的活動'); return; }
    // 外部活動走專用編輯流程
    if (e.type === 'external') { this.editExternalActivity(id); return; }
    this._editEventId = id;
    // 確保事件已綁定（防止 Phase 1 非同步時機導致未綁定）
    this.bindImageUpload('ce-image', 'ce-upload-preview', 8 / 3);
    this.bindTeamOnlyToggle();
    this.bindEventFeeToggle?.();
    this.bindGenderRestrictionToggle?.();
    this.bindPrivateEventToggle?.();
    this.bindTeamSplitToggle?.();
    this.bindRegionToggle?.();
    this.showModal('create-event-modal');
    this._eventSubmitInFlight = false;
    this._setCreateEventSubmitIdleLabel('儲存修改');
    document.getElementById('ce-title').value = e.title || '';
    document.getElementById('ce-type').value = e.type || 'friendly';
    document.getElementById('ce-location').value = e.location || '';
    // 解析儲存格式 YYYY/MM/DD HH:mm~HH:mm → datetime-local
    const dateTime = (e.date || '').split(' ');
    const dateParts = (dateTime[0] || '').split('/');
    const timeStr = dateTime[1] || '';
    const timeParts = timeStr.split('~');
    if (dateParts.length === 3) {
      document.getElementById('ce-date').value = `${dateParts[0]}-${dateParts[1].padStart(2,'0')}-${dateParts[2].padStart(2,'0')}`;
    }
    const ceTS = document.getElementById('ce-time-start');
    const ceTE = document.getElementById('ce-time-end');
    if (ceTS) ceTS.value = timeParts[0] || '14:00';
    if (ceTE) ceTE.value = timeParts[1] || '16:00';
    this._setEventFeeFormState?.(
      this._isEventFeeEnabled?.(e) ?? Number(e?.fee || 0) > 0,
      Number(e?.fee || 0) > 0 ? e.fee : 0
    );
    document.getElementById('ce-max').value = e.max || 20;
    document.getElementById('ce-waitlist').value = 0;
    document.getElementById('ce-min-age').value = e.minAge || 0;
    document.getElementById('ce-notes').value = e.notes || '';
    this._initSportTagPicker(e.sportTag || 'football');
    this._setGenderRestrictionState?.(!!e.genderRestrictionEnabled, e.allowedGender || '');
    this._setPrivateEventState?.(!!e.privateEvent);
    // 開放報名時間
    this._setEventRegOpenTimeValue?.(e.regOpenTime || '');
    // 俱樂部限定
    const ceTeamOnly = document.getElementById('ce-team-only');
    if (ceTeamOnly) {
      ceTeamOnly.checked = !!e.teamOnly;
      // 編輯模式：若為俱樂部限定且建立者無俱樂部，需先填充下拉再還原選擇
      if (e.teamOnly) {
        const ceTeamSelect = document.getElementById('ce-team-select');
        if (ceTeamSelect) {
          const presetTeamIds = (Array.isArray(e.creatorTeamIds) && e.creatorTeamIds.length > 0)
            ? e.creatorTeamIds
            : (e.creatorTeamId ? [e.creatorTeamId] : []);
          const presetTeamNames = (Array.isArray(e.creatorTeamNames) && e.creatorTeamNames.length > 0)
            ? e.creatorTeamNames
            : (e.creatorTeamName ? [e.creatorTeamName] : []);
          this._populateTeamSelect(ceTeamSelect, presetTeamIds, presetTeamNames);
        }
      }
      this._updateTeamOnlyLabel();
    }
    const preview = document.getElementById('ce-upload-preview');
    if (e.image && preview) {
      preview.innerHTML = `<img src="${e.image}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius-sm)">`;
      preview.classList.add('has-image');
    }
    // 委託人預填
    this._delegates = Array.isArray(e.delegates) ? [...e.delegates] : [];
    this._initDelegateSearch();
    // 分隊設定還原
    this._tsSetFormData?.(e.teamSplit || null);
    // 活動地區還原
    this._regionSetFormData?.(e.regionEnabled !== false, e.region || '', e.cities || []);
  },

  // ── 結束活動 ──
  async closeMyActivity(id) {
    if (!this.hasPermission('event.publish') && !this.hasPermission('activity.manage.entry')) { this.showToast('權限不足'); return; }
    const e = ApiService.getEvent(id);
    if (!e) return;
    if (e && !this._canManageEvent(e)) { this.showToast('您只能管理自己的活動'); return; }

    const startDate = this._parseEventStartDate?.(e.date);
    const notStarted = startDate && startDate > new Date();

    if (notStarted) {
      const msgEl = document.getElementById('app-confirm-msg');
      const modal = document.getElementById('app-confirm-modal');
      msgEl.innerHTML = '<div class="app-confirm-warning">⚠ 注意</div>'
        + '此活動尚未開始，提前結束將導致已報名用戶被記錄為<b>「未到場」</b>。<br><br>'
        + '若您只是不舉辦了，請改用<b>「取消活動」</b>功能，已報名用戶將不會產生未到場紀錄。';
      modal.classList.add('open');
      document.body.classList.add('modal-open');
      const ok = document.getElementById('app-confirm-ok');
      const cancel = document.getElementById('app-confirm-cancel');
      const yes = await new Promise(resolve => {
        const cleanup = (result) => {
          modal.classList.remove('open');
          document.body.classList.remove('modal-open');
          msgEl.innerHTML = '';
          ok.replaceWith(ok.cloneNode(true));
          cancel.replaceWith(cancel.cloneNode(true));
          resolve(result);
        };
        ok.addEventListener('click', () => cleanup(true), { once: true });
        cancel.addEventListener('click', () => cleanup(false), { once: true });
      });
      if (!yes) return;
    } else {
      if (!await this.appConfirm('確定要結束此活動？')) return;
    }

    try {
      await ApiService.updateEventAwait(id, { status: 'ended' });
    } catch (err) { if (!err?._toasted) this.showToast('結束活動失敗，請重試'); return; }
    ApiService._writeOpLog('event_end', '結束活動', `結束「${e.title}」`, id);
    this.renderMyActivities();
    this.renderActivityList();
    this.renderHotEvents();
    this.showToast('活動已結束');
  },

  // ── 取消活動 ──
  async cancelMyActivity(id) {
    if (this._cancelActivityBusyMap[id]) return;

    const e = ApiService.getEvent(id);
    if (!e) return;
    if (e && !this._canManageEvent(e)) { this.showToast('您只能管理自己的活動'); return; }
    this._cancelActivityBusyMap[id] = true;
    try {
      if (!await this.appConfirm('確定要取消此活動？')) return;

      try {
        await ApiService._updateAwaitWrite('events', id, ApiService._normalizeEventUpdates({ status: 'cancelled' }), FirebaseService.updateEvent, 'cancelMyActivity');
      } catch (writeErr) {
        console.error('[cancelMyActivity] Firestore write failed:', writeErr);
        this.showToast('取消失敗，請重試');
        return;
      }

      // Trigger 4：活動取消通知 — 寫入成功後才通知所有報名者與候補者
      const notifyUids = this._collectEventNotifyRecipientUids(e, id);
      notifyUids.forEach(uid => {
        this._sendNotifFromTemplate('event_cancelled', {
          eventName: e.title, date: e.date, location: e.location,
        }, uid, 'activity', '活動');
      });
      // 活動被取消 → 刪除所有個人取消紀錄
      await this._cleanupCancelledRecords(id);
      ApiService._writeOpLog('event_cancel', '取消活動', `取消「${e.title}」`, id);
      this.renderMyActivities();
      this.renderActivityList();
      this.renderHotEvents();
      this.showToast('活動已取消');
    } finally {
      delete this._cancelActivityBusyMap[id];
    }
  },

  // ── 重新開放（已取消 → open/full） ──
  async reopenMyActivity(id) {
    if (!this.hasPermission('event.publish') && !this.hasPermission('activity.manage.entry')) { this.showToast('權限不足'); return; }
    const e = ApiService.getEvent(id);
    if (!e) return;
    if (!this._canManageEvent(e)) { this.showToast('您只能管理自己的活動'); return; }

    // 檢查活動時間是否在未來
    const startDate = this._parseEventStartDate(e.date);
    if (startDate && startDate <= new Date()) {
      await this.appConfirm('活動時間已過，請先編輯活動並更新時間後再重新開放。');
      return;
    }

    if (!await this.appConfirm('確定要重新開放此活動？')) return;

    const newStatus = this._isEventTrulyFull(e) ? 'full' : 'open';
    try {
      await ApiService.updateEventAwait(id, { status: newStatus });
    } catch (err) { if (!err?._toasted) this.showToast('重新開放失敗，請重試'); return; }
    ApiService._writeOpLog('event_reopen', '重開活動', `重開「${e.title}」`, id);
    this.renderMyActivities();
    this.renderActivityList();
    this.renderHotEvents();
    this.showToast('活動已重新開放');
  },

  // ── 重新上架（已結束 → open/full） ──
  async relistMyActivity(id) {
    if (!this.hasPermission('event.publish') && !this.hasPermission('activity.manage.entry')) { this.showToast('權限不足'); return; }
    const e = ApiService.getEvent(id);
    if (!e) return;
    if (!this._canManageEvent(e)) { this.showToast('您只能管理自己的活動'); return; }

    // 檢查活動時間是否在未來
    const startDate = this._parseEventStartDate(e.date);
    if (startDate && startDate <= new Date()) {
      await this.appConfirm('活動時間已過，請先編輯活動並更新時間後再上架。');
      return;
    }

    if (!await this.appConfirm('確定要重新上架此活動？\n報名名單與候補名單將會保留。')) return;

    const newStatus = this._isEventTrulyFull(e) ? 'full' : 'open';
    try {
      await ApiService.updateEventAwait(id, { status: newStatus });
    } catch (err) { if (!err?._toasted) this.showToast('重新上架失敗，請重試'); return; }
    ApiService._writeOpLog('event_relist', '重新上架', `重新上架「${e.title}」`, id);

    // 通知已報名的用戶
    const notifyUids = this._collectEventNotifyRecipientUids(e, id);
    notifyUids.forEach(uid => {
      this._sendNotifFromTemplate('event_relisted', {
        eventName: e.title, date: e.date, location: e.location,
      }, uid, 'activity', '活動');
    });

    this.renderMyActivities();
    this.renderActivityList();
    this.renderHotEvents();
    this.showToast('活動已重新上架');
  },

  /** 清理某活動的所有個人取消紀錄（活動被刪除或取消時呼叫） */
  async _cleanupCancelledRecords(eventId, eventDocIdOverride) {
    if (!await this._ensureActivityRecordsReady()) return;
    const source = ApiService._src('activityRecords');
    const toRemove = [];
    for (let i = source.length - 1; i >= 0; i--) {
      if (source[i].eventId === eventId && source[i].status === 'cancelled') {
        toRemove.push({ idx: i, docId: source[i]._docId });
      }
    }
    if (toRemove.length === 0) return;
    // 解析 eventDocId（子集合寫入必要）
    var _eventDocId = eventDocIdOverride || null;
    if (!_eventDocId && typeof FirebaseService !== 'undefined' && typeof FirebaseService._getEventDocIdAsync === 'function') {
      _eventDocId = await FirebaseService._getEventDocIdAsync(eventId);
    }
    if (!_eventDocId) throw new Error('無法取得活動文件 ID: ' + eventId);

    // batch 刪除 Firestore（每 500 筆一批）
    if (typeof db !== 'undefined') {
      for (let start = 0; start < toRemove.length; start += 450) {
        const chunk = toRemove.slice(start, start + 450);
        const batch = db.batch();
        chunk.forEach(item => {
          if (item.docId) {
            batch.delete(db.collection('events').doc(_eventDocId).collection('activityRecords').doc(item.docId));
          }
        });
        try { await batch.commit(); } catch (err) { console.error('[cleanupCancelledRecords] batch failed:', err); return; }
      }
    }
    // commit 成功後才從 cache splice
    toRemove.forEach(item => {
      const idx = source.findIndex((r, i) => i === item.idx && r._docId === item.docId);
      if (idx >= 0) source.splice(idx, 1);
    });
  },

  // ── 管理者移除參加者 ──
  async _removeParticipant(eventId, uid, name, isCompanion) {
    if (!await this.appConfirm(`確定要將 ${name} 從報名名單中移除嗎？`)) return;

    const event = ApiService.getEvent(eventId);
    if (!event) return;

    const useCF = typeof shouldUseServerRegistrationForCancel === 'function'
      ? shouldUseServerRegistrationForCancel()
      : (typeof shouldUseServerRegistration === 'function' && shouldUseServerRegistration());

    if (useCF) {
      // ═══ CF 路徑：呼叫 cancelRegistration（reason='manager_remove'）═══
      try {
        // 找到對應的 registration ID
        const allRegs = ApiService._src('registrations');
        let reg;
        if (isCompanion) {
          reg = allRegs.find(r => r.eventId === eventId && r.companionId === uid && r.status !== 'cancelled' && r.status !== 'removed');
        } else {
          reg = allRegs.find(r => r.eventId === eventId && r.userId === uid && r.participantType !== 'companion' && r.status !== 'cancelled' && r.status !== 'removed');
        }
        if (!reg) { this.showToast('找不到對應的報名紀錄'); return; }

        const _removeTimeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('移除操作逾時，請重新整理後再試')), 15000));
        const cfResult = await Promise.race([
          firebase.app().functions('asia-east1').httpsCallable('cancelRegistration')({
            eventId,
            registrationIds: [reg.id],
            reason: 'manager_remove',
            requestId: `remove_${uid}_${eventId}_${Date.now()}`,
          }),
          _removeTimeout,
        ]);
        const data = cfResult.data;
        // 樂觀更新本地快取
        reg.status = 'removed';
        reg.removedAt = new Date().toISOString();
        if (data.event && event) {
          event.current = data.event.current;
          event.realCurrent = data.event.realCurrent;
          event.waitlist = data.event.waitlist;
          event.participants = data.event.participants;
          event.waitlistNames = data.event.waitlistNames;
          event.participantsWithUid = data.event.participantsWithUid;
          event.waitlistWithUid = data.event.waitlistWithUid;
          event.teamReservationSummaries = data.event.teamReservationSummaries || [];
          event.status = data.event.status;
        }
        FirebaseService._saveToLS?.('registrations', FirebaseService._cache?.registrations);
        FirebaseService._saveToLS?.('events', FirebaseService._cache?.events);
      } catch (err) {
        console.error('[removeParticipant CF]', err);
        const cfMsg = {
          ALREADY_CANCELLED: '已取消此報名',
          REG_NOT_FOUND: '找不到報名紀錄',
          EVENT_NOT_FOUND: '活動不存在',
          PERMISSION_DENIED: '無權限執行此操作',
        };
        const errCode = err?.details || err?.message || '';
        const isNetworkOrTimeout = /timeout|network|fetch|ECONNREFUSED|逾時/i.test(err?.message || '');
        this.showToast('移除失敗：' + (cfMsg[errCode] || (isNetworkOrTimeout ? '連線逾時，請檢查網路後重新整理再試' : err.message || '')));
        return;
      }
    } else {
      // ═══ 原有路徑（fallback）— 模擬先行（Rule #10）═══
      if (!isCompanion && !await this._ensureActivityRecordsReady({ required: true })) return;

      // Firestore refresh：取得最新 registrations（修正 10：H4 也加入 refresh step）
      let firestoreRegs = [];
      if (typeof db !== 'undefined') {
        try {
          const _eventDocId = event._docId || await FirebaseService._getEventDocIdAsync(eventId);
          if (!_eventDocId) throw new Error('eventDocId not found for ' + eventId);
          const snap = await db.collection('events').doc(_eventDocId).collection('registrations').get();
          firestoreRegs = snap.docs.map(d => {
            const data = d.data();
            const mapped = FirebaseService._mapSubcollectionDoc(d, 'registrations');
            mapped.registeredAt = data.registeredAt?.toDate?.()?.toISOString?.() || data.registeredAt;
            return mapped;
          });
        } catch (err) {
          console.warn('[removeParticipant] Firestore refresh failed, using cache:', err);
          firestoreRegs = (ApiService._src('registrations') || []).filter(r => r.eventId === eventId);
        }
      } else {
        firestoreRegs = (ApiService._src('registrations') || []).filter(r => r.eventId === eventId);
      }

      // 1. 建立副本
      const simRegs = firestoreRegs.map(r => ({ ...r }));
      const arSource = ApiService._src('activityRecords') || [];
      const batch = (typeof db !== 'undefined') ? db.batch() : null;
      const promotedSim = [];
      const arPromoteUpdates = [];
      let arRemoveDocId = null;

      // 2. 模擬移除
      let simTarget;
      if (isCompanion) {
        simTarget = simRegs.find(r => r.companionId === uid && r.status !== 'cancelled' && r.status !== 'removed');
      } else {
        simTarget = simRegs.find(r => r.userId === uid && r.participantType !== 'companion' && r.status !== 'cancelled' && r.status !== 'removed');
      }
      const wasConfirmed = simTarget ? simTarget.status === 'confirmed' : false;
      if (simTarget) simTarget.status = 'removed';

      // 3. 模擬 AR 移除
      if (!isCompanion) {
        const ar = arSource.find(a => a.eventId === eventId && a.uid === uid && a.status !== 'cancelled' && a.status !== 'removed');
        if (ar && ar._docId) arRemoveDocId = ar._docId;
      }

      // 4. 模擬遞補（Rule #7 排序，從 clone 找候補者）
      if (wasConfirmed) {
        const confirmedCount = (typeof FirebaseService !== 'undefined' && typeof FirebaseService._countUniqueConfirmedRegistrations === 'function')
          ? FirebaseService._countUniqueConfirmedRegistrations(simRegs)
          : simRegs.filter(r => r.status === 'confirmed').length;
        let slotsAvailable = (event.max || 0) - confirmedCount;
        const _sortTime = (r) => { const t = new Date(r.registeredAt).getTime(); return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY; };

        while (slotsAvailable > 0) {
          const candidate = simRegs
            .filter(r => r.status === 'waitlisted')
            .sort((a, b) => { const d = _sortTime(a) - _sortTime(b); return d !== 0 ? d : (a.promotionOrder || 0) - (b.promotionOrder || 0); })[0];
          if (!candidate) break;
          candidate.status = 'confirmed';
          promotedSim.push(candidate);
          if (candidate.participantType !== 'companion') {
            const ar = arSource.find(a => a.eventId === eventId && a.uid === candidate.userId && a.status === 'waitlisted');
            if (ar && ar._docId) arPromoteUpdates.push({ docId: ar._docId, uid: candidate.userId });
          }
          slotsAvailable--;
        }
      }

      // 5. 用副本計算 occupancy
      const simActive = simRegs.filter(r => r.status === 'confirmed' || r.status === 'waitlisted');
      const occupancy = (typeof FirebaseService !== 'undefined' && typeof FirebaseService._rebuildOccupancy === 'function')
        ? FirebaseService._rebuildOccupancy(event, simActive)
        : null;

      // 解析 eventDocId（子集合寫入必要）
      var _eventDocId2 = null;
      if (typeof FirebaseService !== 'undefined' && typeof FirebaseService._getEventDocIdAsync === 'function') {
        _eventDocId2 = await FirebaseService._getEventDocIdAsync(eventId);
      }
      if (!_eventDocId2) throw new Error('無法取得活動文件 ID: ' + eventId);

      // 6. 建 batch
      if (batch) {
        if (simTarget && simTarget._docId) {
          batch.update(db.collection('events').doc(_eventDocId2).collection('registrations').doc(simTarget._docId), { status: 'removed', removedAt: firebase.firestore.FieldValue.serverTimestamp() });
        }
        if (arRemoveDocId) {
          batch.update(db.collection('events').doc(_eventDocId2).collection('activityRecords').doc(arRemoveDocId), { status: 'removed' });
        }
        promotedSim.forEach(sim => {
          if (sim._docId) {
            batch.update(db.collection('events').doc(_eventDocId2).collection('registrations').doc(sim._docId), { status: 'confirmed' });
          }
        });
        arPromoteUpdates.forEach(au => {
          batch.update(db.collection('events').doc(_eventDocId2).collection('activityRecords').doc(au.docId), { status: 'registered' });
        });
        if (event._docId && occupancy) {
          batch.update(db.collection('events').doc(event._docId), {
            current: occupancy.current,
            realCurrent: occupancy.realCurrent,
            waitlist: occupancy.waitlist,
            participants: occupancy.participants, waitlistNames: occupancy.waitlistNames,
            participantsWithUid: occupancy.participantsWithUid,
            waitlistWithUid: occupancy.waitlistWithUid,
            teamReservationSummaries: occupancy.teamReservationSummaries,
            schemaVersion: 2,
            status: occupancy.status,
          });
        }
        try {
          await batch.commit();
        } catch (err) {
          console.error('[removeParticipant] batch commit failed:', err);
          this.showToast('移除同步失敗，請重試');
          return;
        }
      }

      // 7. commit 成功 → 寫入 live cache（重新查詢 live array，防 onSnapshot 替換）
      const liveRegs = ApiService._src('registrations') || [];
      if (simTarget) {
        const liveTarget = liveRegs.find(r => r._docId === simTarget._docId || r.id === simTarget.id);
        if (liveTarget) { liveTarget.status = 'removed'; liveTarget.removedAt = new Date().toISOString(); }
      }
      if (arRemoveDocId) {
        const liveAr = arSource.find(a => a._docId === arRemoveDocId);
        if (liveAr) liveAr.status = 'removed';
      }
      for (const sim of promotedSim) {
        const live = liveRegs.find(r => r._docId === sim._docId || r.id === sim.id);
        if (live) live.status = 'confirmed';
      }
      for (const au of arPromoteUpdates) {
        const liveAr = arSource.find(a => a._docId === au.docId);
        if (liveAr) liveAr.status = 'registered';
      }
      if (occupancy) FirebaseService._applyRebuildOccupancy(event, occupancy);

      // 8. commit 成功 → 發通知 + 寫 opLog
      for (const sim of promotedSim) {
        this._sendNotifFromTemplate('waitlist_promoted', { eventName: event.title, date: event.date, location: event.location }, sim.userId, 'activity', '活動');
        const _pName = sim.participantType === 'companion' ? (sim.companionName || sim.userName) : sim.userName;
        ApiService._writeOpLog('auto_promote', '自動遞補', `活動「${event.title}」候補 ${_pName || '未知'} 自動遞補為正取`, eventId);
      }

      if (typeof FirebaseService !== 'undefined' && typeof FirebaseService._saveToLS === 'function') {
        FirebaseService._saveToLS('registrations', FirebaseService._cache.registrations);
        FirebaseService._saveToLS('events', FirebaseService._cache.events);
      }
    }

    ApiService._writeOpLog('participant_removed', '移除參加者', `從「${event.title}」移除 ${name}`, eventId);

    this._manualEditingUid = null;
    this._manualEditingEventId = null;
    this._renderAttendanceTable(eventId, this._manualEditingContainerId);
    this.showToast(`已將 ${name} 從報名名單中移除`);
  },

  // ── 刪除活動 ──
  async deleteMyActivity(id) {
    if (!this.hasPermission('event.delete') && !this.hasPermission('event.delete_self') && !this.hasPermission('activity.manage.entry')) { this.showToast('權限不足'); return; }
    const e = ApiService.getEvent(id);
    if (!e) return;
    if (e && !this._canManageEvent(e)) { this.showToast('您只能管理自己的活動'); return; }
    if (!(await this.appConfirm('確定要刪除此活動？刪除後無法恢復。'))) return;
    const title = e.title;
    const eventDocId = e._docId || await FirebaseService._getEventDocIdAsync?.(id);
    let deleted = false;
    try {
      deleted = await ApiService.deleteEvent(id);
    } catch (err) {
      console.error('[deleteMyActivity]', err);
      this.showToast('刪除失敗，請稍後再試');
      return;
    }
    if (!deleted) {
      this.showToast('刪除失敗，請重新整理後再試');
      return;
    }
    // 活動被刪除 → 刪除所有個人取消紀錄
    await this._cleanupCancelledRecords(id, eventDocId);
    ApiService._writeOpLog('event_delete', '刪除活動', `刪除「${title}」`, id);
    this.renderMyActivities();
    this.renderActivityList();
    this.renderHotEvents();
    this.showToast('活動已刪除');
  },

});
