/* === SportHub — Attendance confirmation ===
   Contains LOCKED function per CLAUDE.md — do not modify _confirmAllAttendance
   依賴：event-manage-attendance.js (rendering), event-manage.js (shared helpers)
   ============================================ */

Object.assign(App, {

  _attendanceSubmittingEventId: null,
  _attendancePendingStateByUid: null,
  _unregSubmittingEventId: null,
  _unregPendingStateByUid: null,

  _startTableEdit(eventId) {
    this._attendanceEditingEventId = eventId;
    this._renderAttendanceTable(eventId, this._manualEditingContainerId);
  },

  async _confirmAllAttendance(eventId) {
    if (this._attendanceSubmittingEventId) return;
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
    // 與 _buildConfirmedParticipantSummary 一致：從 users 集合查找正確 uid
    // Phase 1a fix: 未能解析 UID 時跳過，不再用 displayName 作為 uid 寫入
    (e.participants || []).forEach(p => {
      if (!addedNames.has(p)) {
        const userDoc = (ApiService.getAdminUsers() || []).find(u => (u.displayName || u.name) === p);
        const resolvedUid = (userDoc && (userDoc.uid || userDoc.lineUserId)) || null;
        if (!resolvedUid) {
          console.warn('[_confirmAllAttendance] 無法解析 UID，跳過:', p);
          return;
        }
        people.push({ name: p, uid: resolvedUid, isCompanion: false });
        addedNames.add(p);
      }
    });

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

    this._attendanceSubmittingEventId = eventId;
    this._attendancePendingStateByUid = desiredStateByUid;
    this._renderAttendanceTable(eventId, containerId);

    const now = new Date();
    const timeStr = App._formatDateTime(now);
    let errCount = 0;

    try {
      for (const p of people) {
        // 防護：checkbox 未找到的人（UID 不匹配）絕不處理，避免誤刪紀錄
        if (!(String(p.uid) in desiredStateByUid)) continue;
        const wanted = desiredStateByUid[String(p.uid)];

        const wantCheckin = wanted.checkin;
        const wantCheckout = wanted.checkout;
        const note = wanted.note;

        const person = { uid: p.uid, name: p.name, isCompanion: p.isCompanion };
        const currentRecords = ApiService.getAttendanceRecords(eventId);
        const hasCheckin = currentRecords.some(r => this._matchAttendanceRecord(r, person) && r.type === 'checkin');
        const hasCheckout = currentRecords.some(r => this._matchAttendanceRecord(r, person) && r.type === 'checkout');
        const existingNote = this._getLatestAttendanceRecord(currentRecords, person, 'note');
        const existingNoteText = (existingNote?.note || '').trim();

        if (wantCheckin === hasCheckin && wantCheckout === hasCheckout && note === existingNoteText) continue;

        let recordUid = p.uid, recordUserName = p.name, companionId = null, companionName = null, participantType = 'self';
        if (p.isCompanion) {
          const cReg = allActiveRegs.find(r => r.companionId === p.uid);
          if (cReg) {
            recordUid = cReg.userId; recordUserName = cReg.userName;
            companionId = p.uid; companionName = p.name; participantType = 'companion';
          }
        }

        try {
          if (!wantCheckout && hasCheckout) {
            const rec = this._getLatestAttendanceRecord(currentRecords, person, 'checkout');
            if (rec) await ApiService.removeAttendanceRecord(rec);
          }
          if (!wantCheckin && hasCheckin) {
            const recOut = this._getLatestAttendanceRecord(currentRecords, person, 'checkout');
            if (recOut) await ApiService.removeAttendanceRecord(recOut);
            const recIn = this._getLatestAttendanceRecord(currentRecords, person, 'checkin');
            if (recIn) await ApiService.removeAttendanceRecord(recIn);
          }
          if (wantCheckin && !hasCheckin) {
            await ApiService.addAttendanceRecord({
              id: 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
              eventId, uid: recordUid, userName: recordUserName,
              participantType, companionId, companionName,
              type: 'checkin', time: timeStr,
            });
          }
          if (wantCheckout && !hasCheckout) {
            await ApiService.addAttendanceRecord({
              id: 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
              eventId, uid: recordUid, userName: recordUserName,
              participantType, companionId, companionName,
              type: 'checkout', time: timeStr,
            });
            // 手動確認簽退 → 發放完成活動 EXP（與掃碼簽退一致）
            if (wantCheckin && recordUid) {
              this._grantAutoExp?.(recordUid, 'complete_activity', e.title);
            }
          }
          if (note !== existingNoteText) {
            await ApiService.addAttendanceRecord({
              id: 'att_note_' + Date.now(), eventId, uid: recordUid, userName: recordUserName,
              participantType, companionId, companionName,
              type: 'note', time: timeStr, note,
            });
          }
        } catch (err) {
          console.error('[_confirmAllAttendance]', p.name, err);
          errCount++;
        }
      }
    } finally {
      this._attendanceSubmittingEventId = null;
      this._attendancePendingStateByUid = null;
      this._attendanceEditingEventId = null;
      this._renderAttendanceTable(eventId, containerId);
    }

    if (errCount > 0) {
      ApiService._writeErrorLog({ fn: '_confirmAllAttendance', eventId, errCount }, new Error(`${errCount} 筆寫入失敗`));
    }
    ApiService._writeOpLog('manual_attendance', '手動簽到', `活動 ${e.title} 已套用手動簽到（共 ${people.length} 筆）${errCount > 0 ? `，${errCount} 筆失敗` : ''}`);
    this._renderDetailFeeSummary(eventId);
    this.showToast(errCount > 0 ? `儲存完成，但有 ${errCount} 筆失敗` : '儲存完成');
  },
  _startUnregTableEdit(eventId) {
    this._unregEditingEventId = eventId;
    this._renderUnregTable(eventId, 'detail-unreg-table');
  },

  async _removeUnregUser(eventId, uid, name) {
    if (!await this.appConfirm(`確定要將 ${name} 從未報名單中移除嗎？`)) return;
    const records = ApiService.getAttendanceRecords(eventId);
    const person = { uid, name, isCompanion: false };
    // 軟刪除該用戶在此活動的所有出席記錄（unreg / checkin / checkout / note）
    const targets = records.filter(r => r.uid === uid || this._matchAttendanceRecord(r, person));
    for (const rec of targets) {
      await ApiService.removeAttendanceRecord(rec).catch(err => console.error('[removeUnregUser]', err));
    }
    ApiService._writeOpLog('unreg_removed', '移除未報名掃碼', `從「${ApiService.getEvent(eventId)?.title}」移除 ${name}`);
    this._renderUnregTable(eventId, 'detail-unreg-table');
    this._renderDetailFeeSummary(eventId);
    this.showToast(`已將 ${name} 從未報名單中移除`);
  },

  async _confirmAllUnregAttendance(eventId) {
    if (this._unregSubmittingEventId) return;
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

    this._unregSubmittingEventId = eventId;
    this._unregPendingStateByUid = desiredStateByUid;
    this._renderUnregTable(eventId, 'detail-unreg-table');

    const now = new Date();
    const timeStr = App._formatDateTime(now);
    let errCount = 0;

    try {
      for (const p of people) {
        // 防護：checkbox 未找到的人（UID 不匹配）絕不處理，避免誤刪紀錄
        if (!(String(p.uid) in desiredStateByUid)) continue;
        const wanted = desiredStateByUid[String(p.uid)];

        const wantCheckin = wanted.checkin;
        const wantCheckout = wanted.checkout;
        const note = wanted.note;

        const person = { uid: p.uid, name: p.name, isCompanion: false };
        const currentRecords = ApiService.getAttendanceRecords(eventId);
        const hasCheckin = currentRecords.some(r => this._matchAttendanceRecord(r, person) && r.type === 'checkin');
        const hasCheckout = currentRecords.some(r => this._matchAttendanceRecord(r, person) && r.type === 'checkout');
        const existingNote = this._getLatestAttendanceRecord(currentRecords, person, 'note');
        const existingNoteText = (existingNote?.note || '').trim();

        if (wantCheckin === hasCheckin && wantCheckout === hasCheckout && note === existingNoteText) continue;

        try {
          if (!wantCheckout && hasCheckout) {
            const rec = this._getLatestAttendanceRecord(currentRecords, person, 'checkout');
            if (rec) await ApiService.removeAttendanceRecord(rec);
          }
          if (!wantCheckin && hasCheckin) {
            const recOut = this._getLatestAttendanceRecord(currentRecords, person, 'checkout');
            if (recOut) await ApiService.removeAttendanceRecord(recOut);
            const recIn = this._getLatestAttendanceRecord(currentRecords, person, 'checkin');
            if (recIn) await ApiService.removeAttendanceRecord(recIn);
          }
          if (wantCheckin && !hasCheckin) {
            await ApiService.addAttendanceRecord({
              id: 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
              eventId, uid: p.uid, userName: p.name,
              participantType: 'self', companionId: null, companionName: null,
              type: 'checkin', time: timeStr,
            });
          }
          if (wantCheckout && !hasCheckout) {
            await ApiService.addAttendanceRecord({
              id: 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
              eventId, uid: p.uid, userName: p.name,
              participantType: 'self', companionId: null, companionName: null,
              type: 'checkout', time: timeStr,
            });
          }
          if (note !== existingNoteText) {
            await ApiService.addAttendanceRecord({
              id: 'att_note_' + Date.now(), eventId, uid: p.uid, userName: p.name,
              participantType: 'self', companionId: null, companionName: null,
              type: 'note', time: timeStr, note,
            });
          }
        } catch (err) {
          console.error('[_confirmAllUnregAttendance]', p.name, err);
          errCount++;
        }
      }
    } finally {
      this._unregSubmittingEventId = null;
      this._unregPendingStateByUid = null;
      this._unregEditingEventId = null;
      this._renderUnregTable(eventId, 'detail-unreg-table');
    }

    this._renderDetailFeeSummary(eventId);
    this.showToast(errCount > 0 ? `儲存完成，但有 ${errCount} 筆失敗` : '儲存完成');
  },

});
