/* === SportHub — Attendance confirmation (batch write + instant save) ===
   Contains LOCKED function per CLAUDE.md — do not modify _confirmAllAttendance
   依賴：event-manage-attendance.js (rendering), event-manage.js (shared helpers)
         event-manage-instant-save.js (即時儲存 checkbox 變更)
   優化：Checkbox 勾選即時寫入（debounce 300ms），「完成簽到」只處理備註 + 收尾
   ============================================ */

Object.assign(App, {

  _attendanceSubmittingEventId: null,
  _attendancePendingStateByUid: null,
  _unregSubmittingEventId: null,
  _unregPendingStateByUid: null,

  async _startTableEdit(eventId) {
    if (!this.hasPermission('event.manual_checkin') && !this.hasPermission('activity.manage.entry')) {
      const _e = eventId && ApiService.getEvent(eventId);
      if (!_e || !this._canManageEvent(_e)) { this.showToast('權限不足'); return; }
    }
    this._attendanceEditingEventId = eventId;
    if (typeof this._initInstantSave === 'function') this._initInstantSave(eventId);
    await this._renderAttendanceTable(eventId, this._manualEditingContainerId);
  },

  /**
   * 收集單一參加者的出席變更操作（新增 / 軟刪除）
   * @returns {{ adds: Array, removes: Array, grantExp: boolean }}
   */
  _collectAttendanceOps(person, wanted, currentRecords, eventId, timeStr, baseRecord, idCounter) {
    const adds = [];
    const removes = [];
    let grantExp = false;

    const hasCheckin = currentRecords.some(r => this._matchAttendanceRecord(r, person) && r.type === 'checkin');
    const hasCheckout = currentRecords.some(r => this._matchAttendanceRecord(r, person) && r.type === 'checkout');
    const existingNote = this._getLatestAttendanceRecord(currentRecords, person, 'note');
    const existingNoteText = (existingNote?.note || '').trim();

    if (wanted.checkin === hasCheckin && wanted.checkout === hasCheckout && wanted.note === existingNoteText) {
      return { adds, removes, grantExp };
    }

    // 取消簽退
    if (!wanted.checkout && hasCheckout) {
      const rec = this._getLatestAttendanceRecord(currentRecords, person, 'checkout');
      if (rec) removes.push(rec);
    }
    // 取消簽到（連帶取消簽退）
    if (!wanted.checkin && hasCheckin) {
      const recOut = this._getLatestAttendanceRecord(currentRecords, person, 'checkout');
      if (recOut && !removes.some(r => r.id === recOut.id)) removes.push(recOut);
      const recIn = this._getLatestAttendanceRecord(currentRecords, person, 'checkin');
      if (recIn) removes.push(recIn);
    }
    // 新增簽到
    if (wanted.checkin && !hasCheckin) {
      adds.push({ ...baseRecord, id: 'att_' + idCounter.v++ + '_' + Math.random().toString(36).slice(2, 6), type: 'checkin', time: timeStr });
    }
    // 新增簽退
    if (wanted.checkout && !hasCheckout) {
      adds.push({ ...baseRecord, id: 'att_' + idCounter.v++ + '_' + Math.random().toString(36).slice(2, 6), type: 'checkout', time: timeStr });
      if (wanted.checkin && baseRecord.uid) grantExp = true;
    }
    // 備註變更
    if (wanted.note !== existingNoteText) {
      adds.push({ ...baseRecord, id: 'att_note_' + idCounter.v++, type: 'note', time: timeStr, note: wanted.note });
    }

    return { adds, removes, grantExp };
  },

  async _confirmAllAttendance(eventId) {
    if (this._attendanceSubmittingEventId) return;
    // 立即顯示「儲存中...」，讓用戶知道按鈕有反應
    this._attendanceSubmittingEventId = eventId;
    var _cId = this._manualEditingContainerId || 'attendance-table-container';
    await this._renderAttendanceTable(eventId, _cId);
    // flush 所有即時儲存中的 checkbox + 備註寫入
    if (typeof this._flushInstantSaves === 'function') await this._flushInstantSaves(eventId);
    const e = ApiService.getEvent(eventId);
    if (!e) return;
    const containerId = this._manualEditingContainerId || 'attendance-table-container';

    const allActiveRegs = ApiService.getRegistrationsByEvent(eventId);
    const confirmedRegs = allActiveRegs.filter(r => r.status === 'confirmed');
    let people = [];
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
        people.push({ name: mainName, uid: mainUid, isCompanion: false });
        addedNames.add(mainName);
        companions.forEach(c => {
          const cName = c.companionName || c.userName;
          const cUid = c.companionId || (mainUid + '_' + c.companionName);
          people.push({ name: cName, uid: cUid, isCompanion: true });
          addedNames.add(cName);
        });
      });
    }
    // Phase 3 (2026-04-19): 優先讀 participantsWithUid 物件陣列（含真 UID，消除同暱稱挑錯）
    // 若無 / 長度不符則 fallback 到舊路徑（從 users 集合 name 反查 uid）
    var wu = Array.isArray(e.participantsWithUid) ? e.participantsWithUid : [];
    var wuValid = wu.length > 0 && wu.length === Number(e.current || 0);
    if (wuValid) {
      wu.forEach(function (entry) {
        if (!entry || !entry.uid || !entry.name) return;
        if (addedNames.has(entry.name)) return;  // 已存在於 registrations 路徑者跳過
        people.push({ name: entry.name, uid: entry.uid, isCompanion: false });
        addedNames.add(entry.name);
      });
    } else {
      if (wu.length > 0) {
        console.warn('[pwu] _confirmAllAttendance inconsistent participantsWithUid', e.id);
      }
      // Fallback：從 users 集合 name 反查（Phase 1a fix: 未能解析跳過）
      var _allUsers = ApiService.getAdminUsers() || [];
      var _userByName = new Map();
      _allUsers.forEach(function (u) { var n = u.displayName || u.name; if (n) _userByName.set(n, u); });
      (e.participants || []).forEach(p => {
        if (!addedNames.has(p)) {
          const userDoc = _userByName.get(p) || null;
          const resolvedUid = (userDoc && (userDoc.uid || userDoc.lineUserId)) || null;
          if (!resolvedUid) {
            console.warn('[_confirmAllAttendance] 無法解析 UID，跳過:', p);
            return;
          }
          people.push({ name: p, uid: resolvedUid, isCompanion: false });
          addedNames.add(p);
        }
      });
    }

    const desiredStateByUid = Object.create(null);
    for (const p of people) {
      const checkinBox = document.getElementById('manual-checkin-' + p.uid);
      if (!checkinBox) continue;
      const checkoutBox = document.getElementById('manual-checkout-' + p.uid);
      const noteInput = document.getElementById('manual-note-' + p.uid);
      desiredStateByUid[String(p.uid)] = this._normalizeAttendanceSelection({
        checkin: !!checkinBox.checked,
        checkout: !!checkoutBox?.checked,
        note: (noteInput?.value || '').trim().slice(0, 20),
      });
    }

    this._attendancePendingStateByUid = desiredStateByUid;

    const timeStr = App._formatDateTime(new Date());
    const currentRecords = ApiService.getAttendanceRecords(eventId);
    const allAdds = [];
    const allRemoves = [];
    const expTargets = [];
    const idCounter = { v: Date.now() };

    for (const p of people) {
      if (!(String(p.uid) in desiredStateByUid)) continue;
      const wanted = desiredStateByUid[String(p.uid)];

      let recordUid = p.uid, recordUserName = p.name, companionId = null, companionName = null, participantType = 'self';
      if (p.isCompanion) {
        const cReg = allActiveRegs.find(r => r.companionId === p.uid);
        if (cReg) {
          recordUid = cReg.userId; recordUserName = cReg.userName;
          companionId = p.uid; companionName = p.name; participantType = 'companion';
        }
      }

      const baseRecord = { eventId, uid: recordUid, userName: recordUserName, participantType, companionId, companionName };
      const person = { uid: p.uid, name: p.name, isCompanion: p.isCompanion };
      const ops = this._collectAttendanceOps(person, wanted, currentRecords, eventId, timeStr, baseRecord, idCounter);

      allAdds.push(...ops.adds);
      allRemoves.push(...ops.removes);
      if (ops.grantExp) expTargets.push(recordUid);
    }

    let failed = false;
    let failMsg = '';
    try {
      if (allAdds.length > 0 || allRemoves.length > 0) {
        await ApiService.batchWriteAttendance(allAdds, allRemoves);
      }
    } catch (err) {
      console.error('[_confirmAllAttendance] batch failed:', err);
      failed = true;
      failMsg = err?.message || '';
      ApiService._writeErrorLog({ fn: '_confirmAllAttendance', eventId, adds: allAdds.length, removes: allRemoves.length }, err);
    } finally {
      this._attendanceSubmittingEventId = null;
      if (failed) {
        // 失敗：保留編輯狀態與勾選，讓用戶可直接重試
        await this._renderAttendanceTable(eventId, containerId);
      } else {
        this._attendancePendingStateByUid = null;
        this._attendanceEditingEventId = null;
        if (typeof this._cleanupInstantSave === 'function') this._cleanupInstantSave();
        await this._renderAttendanceTable(eventId, containerId);
      }
    }

    if (!failed) {
      // 手動確認簽退 → 發放完成活動 EXP（與掃碼簽退一致）
      for (const uid of expTargets) {
        this._grantAutoExp?.(uid, 'complete_activity', e.title);
      }
    }

    const totalOps = allAdds.length + allRemoves.length;
    ApiService._writeOpLog('manual_attendance', '編輯簽到', `活動 ${e.title} 已套用編輯簽到（共 ${people.length} 人，${totalOps} 筆操作）${failed ? '，批次寫入失敗' : ''}`);
    this._renderDetailFeeSummary(eventId);
    this.showToast(failed ? '儲存失敗，勾選已保留\n請再按一次「完成」重試' : '儲存完成');

    // 放鴿子 EXP 對帳：對本活動所有正取報名者進行 no-show reconciliation
    if (!failed && typeof this._reconcileNoShowExp === 'function') {
      var allRegs = ApiService.getRegistrationsByEvent(eventId);
      var reconcileUids = new Set();
      (allRegs || []).forEach(function (r) {
        if (r.status === 'confirmed' && r.participantType !== 'companion' && r.userId) {
          reconcileUids.add(r.userId);
        }
      });
      reconcileUids.forEach(function (uid) { App._reconcileNoShowExp(uid); });
    }
  },

  _startUnregTableEdit(eventId) {
    this._unregEditingEventId = eventId;
    if (typeof this._initUnregInstantSave === 'function') this._initUnregInstantSave(eventId);
    this._renderUnregTable(eventId, 'detail-unreg-table');
  },

  async _removeUnregUser(eventId, uid, name) {
    if (!await this.appConfirm(`確定要將 ${name} 從未報名單中移除嗎？`)) return;
    const records = ApiService.getAttendanceRecords(eventId);
    const person = { uid, name, isCompanion: false };
    // 軟刪除該用戶在此活動的所有出席記錄（unreg / checkin / checkout / note）
    const targets = records.filter(r => r.uid === uid || this._matchAttendanceRecord(r, person));
    for (const rec of targets) {
      await ApiService.removeAttendanceRecord(rec).catch(err => {
        console.error('[removeUnregUser]', err);
        ApiService._writeErrorLog({
          fn: '_removeUnregUser.removeAttendanceRecord',
          eventId,
          uid,
          recordId: rec?.id || rec?._docId || '',
          type: rec?.type || '',
        }, err);
      });
    }
    ApiService._writeOpLog('unreg_removed', '移除未報名掃碼', `從「${ApiService.getEvent(eventId)?.title}」移除 ${name}`);
    this._renderUnregTable(eventId, 'detail-unreg-table');
    this._renderDetailFeeSummary(eventId);
    this.showToast(`已將 ${name} 從未報名單中移除`);
  },

  async _confirmAllUnregAttendance(eventId) {
    if (this._unregSubmittingEventId) return;
    // 立即顯示「儲存中...」
    this._unregSubmittingEventId = eventId;
    this._renderUnregTable(eventId, 'detail-unreg-table');
    if (typeof this._flushUnregInstantSaves === 'function') await this._flushUnregInstantSaves(eventId);
    const e = ApiService.getEvent(eventId);
    if (!e) return;

    const records = ApiService.getAttendanceRecords(eventId);
    const unregMap = new Map();
    records.forEach(r => {
      if (r.type === 'unreg' && !unregMap.has(r.uid))
        unregMap.set(r.uid, { name: r.userName, uid: r.uid });
    });

    const people = [];
    unregMap.forEach(u => people.push(u));

    const desiredStateByUid = Object.create(null);
    for (const p of people) {
      const checkinBox = document.getElementById('unreg-checkin-' + p.uid);
      if (!checkinBox) continue;
      const checkoutBox = document.getElementById('unreg-checkout-' + p.uid);
      const noteInput = document.getElementById('unreg-note-' + p.uid);
      desiredStateByUid[String(p.uid)] = this._normalizeAttendanceSelection({
        checkin: !!checkinBox.checked,
        checkout: !!checkoutBox?.checked,
        note: (noteInput?.value || '').trim().slice(0, 20),
      });
    }

    this._unregPendingStateByUid = desiredStateByUid;

    const timeStr = App._formatDateTime(new Date());
    const currentRecords = ApiService.getAttendanceRecords(eventId);
    const allAdds = [];
    const allRemoves = [];
    const idCounter = { v: Date.now() };

    for (const p of people) {
      if (!(String(p.uid) in desiredStateByUid)) continue;
      const wanted = desiredStateByUid[String(p.uid)];
      const person = { uid: p.uid, name: p.name, isCompanion: false };
      const baseRecord = { eventId, uid: p.uid, userName: p.name, participantType: 'self', companionId: null, companionName: null };
      const ops = this._collectAttendanceOps(person, wanted, currentRecords, eventId, timeStr, baseRecord, idCounter);
      allAdds.push(...ops.adds);
      allRemoves.push(...ops.removes);
    }

    let failed = false;
    let failMsg = '';
    try {
      if (allAdds.length > 0 || allRemoves.length > 0) {
        await ApiService.batchWriteAttendance(allAdds, allRemoves);
      }
    } catch (err) {
      console.error('[_confirmAllUnregAttendance] batch failed:', err);
      failed = true;
      failMsg = err?.message || '';
      ApiService._writeErrorLog({ fn: '_confirmAllUnregAttendance', eventId, adds: allAdds.length, removes: allRemoves.length }, err);
    } finally {
      this._unregSubmittingEventId = null;
      if (failed) {
        // 失敗：保留編輯狀態與勾選，讓用戶可直接重試
        this._renderUnregTable(eventId, 'detail-unreg-table');
      } else {
        this._unregPendingStateByUid = null;
        this._unregEditingEventId = null;
        if (typeof this._cleanupUnregInstantSave === 'function') this._cleanupUnregInstantSave();
        this._renderUnregTable(eventId, 'detail-unreg-table');
      }
    }

    this._renderDetailFeeSummary(eventId);
    this.showToast(failed ? '儲存失敗，勾選已保留\n請再按一次「完成」重試' : '儲存完成');
  },

});
