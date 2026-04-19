/* === SportHub — Attendance instant save (per-click auto-save) ===
   每次勾選簽到/簽退 checkbox 後 300ms debounce 自動寫入 Firestore，
   不需等到「完成簽到」才批次送出。
   依賴：event-manage-confirm.js (batch/notes), event-manage-attendance.js (render)
   ============================================ */

Object.assign(App, {

  // ── 報名單即時儲存狀態 ──
  _iSaveTimers: Object.create(null),      // uid → setTimeout id
  _iSavePeople: null,                      // Map<uid, person>
  _iSaveInFlight: Object.create(null),     // uid → true (寫入中)
  _iSaveQueued: Object.create(null),       // uid → true (寫入中又有新變更)

  // ── 未報名單即時儲存狀態 ──
  _iSaveUnregTimers: Object.create(null),
  _iSaveUnregPeople: null,
  _iSaveUnregInFlight: Object.create(null),
  _iSaveUnregQueued: Object.create(null),

  // ────────────────── 報名單 ──────────────────

  /** 進入編輯模式時初始化：建立 uid→person 查找表 */
  _initInstantSave(eventId) {
    const summary = this._buildConfirmedParticipantSummary(eventId);
    const map = new Map();
    summary.people.forEach(p => map.set(String(p.uid), p));
    // Phase 3 (2026-04-19): 優先從 participantsWithUid 補齊（消除同暱稱挑錯），不足再 fallback
    const e = ApiService.getEvent(eventId);
    const addedNames = new Set(summary.people.map(p => p.name));
    const wu = Array.isArray(e?.participantsWithUid) ? e.participantsWithUid : [];
    if (wu.length > 0) {
      wu.forEach(entry => {
        if (!entry || !entry.uid || !entry.name) return;
        if (addedNames.has(entry.name) || map.has(String(entry.uid))) return;
        map.set(String(entry.uid), { name: entry.name, uid: entry.uid, isCompanion: false });
        addedNames.add(entry.name);
      });
    } else {
      // Fallback：從 event.participants 字串陣列 + users 反查（同暱稱會挑錯，Phase 3 後應少發生）
      (e?.participants || []).forEach(pName => {
        if (addedNames.has(pName)) return;
        const userDoc = (ApiService.getAdminUsers() || []).find(u => (u.displayName || u.name) === pName);
        const resolvedUid = (userDoc && (userDoc.uid || userDoc.lineUserId)) || null;
        if (!resolvedUid || map.has(resolvedUid)) return;
        map.set(resolvedUid, { name: pName, uid: resolvedUid, isCompanion: false });
      });
    }
    this._iSavePeople = map;
    this._iSaveTimers = Object.create(null);
    this._iSaveInFlight = Object.create(null);
    this._iSaveQueued = Object.create(null);
  },

  /** Checkbox change → 300ms debounce per UID */
  _onAttendanceCheckboxChange(eventId, uid) {
    if (this._iSaveTimers[uid]) clearTimeout(this._iSaveTimers[uid]);
    this._iSaveTimers[uid] = setTimeout(() => {
      delete this._iSaveTimers[uid];
      this._writeInstantAttendance(eventId, uid);
    }, 300);
  },

  /** 單人簽到/簽退寫入（per-UID sequential） */
  async _writeInstantAttendance(eventId, uid) {
    if (this._iSaveInFlight[uid]) {
      this._iSaveQueued[uid] = true;
      return;
    }
    const person = this._iSavePeople?.get(String(uid));
    if (!person) return;

    const checkinBox = document.getElementById('manual-checkin-' + uid);
    const checkoutBox = document.getElementById('manual-checkout-' + uid);
    if (!checkinBox) return;

    const noteInput = document.getElementById('manual-note-' + uid);
    const wanted = this._normalizeAttendanceSelection({
      checkin: !!checkinBox.checked,
      checkout: !!checkoutBox?.checked,
      note: (noteInput?.value || '').trim().slice(0, 20),
    });

    const currentRecords = ApiService.getAttendanceRecords(eventId);
    const allActiveRegs = ApiService.getRegistrationsByEvent(eventId);
    const timeStr = App._formatDateTime(new Date());
    let recordUid = person.uid, recordUserName = person.name;
    let companionId = null, companionName = null, participantType = 'self';
    if (person.isCompanion) {
      const cReg = allActiveRegs.find(r => r.companionId === person.uid);
      if (cReg) {
        recordUid = cReg.userId;
        recordUserName = cReg.userName;
        companionId = person.uid;
        companionName = person.name;
        participantType = 'companion';
      }
    }

    const baseRecord = { eventId, uid: recordUid, userName: recordUserName, participantType, companionId, companionName };
    const personObj = { uid: person.uid, name: person.name, isCompanion: person.isCompanion };
    const idCounter = { v: Date.now() };
    const ops = this._collectAttendanceOps(personObj, wanted, currentRecords, eventId, timeStr, baseRecord, idCounter);

    if (ops.adds.length === 0 && ops.removes.length === 0) return;

    this._iSaveInFlight[uid] = true;
    const containerId = this._manualEditingContainerId || 'attendance-table-container';
    const row = this._findAttendanceRow(containerId, uid);
    const rowCbs = row ? row.querySelectorAll('.att-cb') : [];
    rowCbs.forEach(cb => { cb.disabled = true; });

    try {
      await ApiService.batchWriteAttendance(ops.adds, ops.removes);
      if (ops.grantExp) {
        this._grantAutoExp?.(recordUid, 'complete_activity', ApiService.getEvent(eventId)?.title);
      }
      if (row) {
        row.classList.remove('att-row-saved');
        void row.offsetWidth;
        row.classList.add('att-row-saved');
        setTimeout(() => row.classList.remove('att-row-saved'), 600);
      }
    } catch (err) {
      console.error('[_writeInstantAttendance]', uid, err);
      // 還原 checkbox 至實際 DB 狀態
      const records = ApiService.getAttendanceRecords(eventId);
      const hasCI = records.some(r => this._matchAttendanceRecord(r, personObj) && r.type === 'checkin');
      const hasCO = records.some(r => this._matchAttendanceRecord(r, personObj) && r.type === 'checkout');
      if (checkinBox) checkinBox.checked = hasCI;
      if (checkoutBox) checkoutBox.checked = hasCO;
      if (row) {
        row.classList.add('att-row-failed');
        setTimeout(() => row.classList.remove('att-row-failed'), 1200);
      }
      this.showToast((person.name || '') + ' 儲存失敗，已還原');
    } finally {
      delete this._iSaveInFlight[uid];
      rowCbs.forEach(cb => { cb.disabled = false; });
      if (this._iSaveQueued[uid]) {
        delete this._iSaveQueued[uid];
        this._writeInstantAttendance(eventId, uid);
      }
    }
  },

  /** 「完成簽到」前呼叫：flush 所有 pending debounce + 等待 in-flight */
  async _flushInstantSaves(eventId) {
    // 立即觸發所有 debounce 中的寫入（checkbox + note）
    var pending = [];
    for (var uid of Object.keys(this._iSaveTimers)) {
      clearTimeout(this._iSaveTimers[uid]);
      delete this._iSaveTimers[uid];
      pending.push(this._writeInstantAttendance(eventId, uid));
    }
    if (this._iSaveNoteTimers) {
      for (var k of Object.keys(this._iSaveNoteTimers)) {
        if (k.indexOf('reg_') !== 0) continue;
        clearTimeout(this._iSaveNoteTimers[k]);
        delete this._iSaveNoteTimers[k];
        var noteUid = k.slice(4);
        if (noteUid) pending.push(this._writeInstantAttendance(eventId, noteUid));
      }
    }
    if (pending.length) await Promise.allSettled(pending);
    // 等待所有 in-flight 寫入完成（最多 5 秒）
    var start = Date.now();
    while (Object.keys(this._iSaveInFlight).length > 0 && Date.now() - start < 5000) {
      await new Promise(function (r) { setTimeout(r, 50); });
    }
  },

  // ────────────────── 未報名單 ──────────────────

  _initUnregInstantSave(eventId) {
    const records = ApiService.getAttendanceRecords(eventId);
    const map = new Map();
    records.forEach(r => {
      if (r.type === 'unreg' && !map.has(r.uid)) {
        map.set(r.uid, { name: r.userName, uid: r.uid, isCompanion: false });
      }
    });
    this._iSaveUnregPeople = map;
    this._iSaveUnregTimers = Object.create(null);
    this._iSaveUnregInFlight = Object.create(null);
    this._iSaveUnregQueued = Object.create(null);
  },

  _onUnregCheckboxChange(eventId, uid) {
    if (this._iSaveUnregTimers[uid]) clearTimeout(this._iSaveUnregTimers[uid]);
    this._iSaveUnregTimers[uid] = setTimeout(() => {
      delete this._iSaveUnregTimers[uid];
      this._writeInstantUnregAttendance(eventId, uid);
    }, 300);
  },

  async _writeInstantUnregAttendance(eventId, uid) {
    if (this._iSaveUnregInFlight[uid]) {
      this._iSaveUnregQueued[uid] = true;
      return;
    }
    const person = this._iSaveUnregPeople?.get(String(uid));
    if (!person) return;

    const checkinBox = document.getElementById('unreg-checkin-' + uid);
    const checkoutBox = document.getElementById('unreg-checkout-' + uid);
    if (!checkinBox) return;

    const noteInput = document.getElementById('unreg-note-' + uid);
    const wanted = this._normalizeAttendanceSelection({
      checkin: !!checkinBox.checked,
      checkout: !!checkoutBox?.checked,
      note: (noteInput?.value || '').trim().slice(0, 20),
    });

    const currentRecords = ApiService.getAttendanceRecords(eventId);
    const timeStr = App._formatDateTime(new Date());
    const baseRecord = { eventId, uid: person.uid, userName: person.name, participantType: 'self', companionId: null, companionName: null };
    const personObj = { uid: person.uid, name: person.name, isCompanion: false };
    const idCounter = { v: Date.now() };
    const ops = this._collectAttendanceOps(personObj, wanted, currentRecords, eventId, timeStr, baseRecord, idCounter);

    if (ops.adds.length === 0 && ops.removes.length === 0) return;

    this._iSaveUnregInFlight[uid] = true;
    const row = this._findAttendanceRow('detail-unreg-table', uid);
    const rowCbs = row ? row.querySelectorAll('.att-cb') : [];
    rowCbs.forEach(cb => { cb.disabled = true; });

    try {
      await ApiService.batchWriteAttendance(ops.adds, ops.removes);
      if (row) {
        row.classList.remove('att-row-saved');
        void row.offsetWidth;
        row.classList.add('att-row-saved');
        setTimeout(() => row.classList.remove('att-row-saved'), 600);
      }
    } catch (err) {
      console.error('[_writeInstantUnregAttendance]', uid, err);
      const records = ApiService.getAttendanceRecords(eventId);
      const hasCI = records.some(r => this._matchAttendanceRecord(r, personObj) && r.type === 'checkin');
      const hasCO = records.some(r => this._matchAttendanceRecord(r, personObj) && r.type === 'checkout');
      if (checkinBox) checkinBox.checked = hasCI;
      if (checkoutBox) checkoutBox.checked = hasCO;
      if (row) {
        row.classList.add('att-row-failed');
        setTimeout(() => row.classList.remove('att-row-failed'), 1200);
      }
      this.showToast((person.name || '') + ' 儲存失敗，已還原');
    } finally {
      delete this._iSaveUnregInFlight[uid];
      rowCbs.forEach(cb => { cb.disabled = false; });
      if (this._iSaveUnregQueued[uid]) {
        delete this._iSaveUnregQueued[uid];
        this._writeInstantUnregAttendance(eventId, uid);
      }
    }
  },

  async _flushUnregInstantSaves(eventId) {
    var pending = [];
    for (var uid of Object.keys(this._iSaveUnregTimers)) {
      clearTimeout(this._iSaveUnregTimers[uid]);
      delete this._iSaveUnregTimers[uid];
      pending.push(this._writeInstantUnregAttendance(eventId, uid));
    }
    if (this._iSaveNoteTimers) {
      for (var k of Object.keys(this._iSaveNoteTimers)) {
        if (k.indexOf('unreg_') !== 0) continue;
        clearTimeout(this._iSaveNoteTimers[k]);
        delete this._iSaveNoteTimers[k];
        var noteUid = k.slice(6);
        if (noteUid) pending.push(this._writeInstantUnregAttendance(eventId, noteUid));
      }
    }
    if (pending.length) await Promise.allSettled(pending);
    var start = Date.now();
    while (Object.keys(this._iSaveUnregInFlight).length > 0 && Date.now() - start < 5000) {
      await new Promise(function (r) { setTimeout(r, 50); });
    }
  },

  // ────────────────── 共用工具 ──────────────────

  /** 透過 data-uid 查找表格行 */
  _findAttendanceRow(containerId, uid) {
    var container = document.getElementById(containerId);
    if (!container) return null;
    var rows = container.querySelectorAll('tr[data-uid]');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].dataset.uid === uid) return rows[i];
    }
    return null;
  },

  /** 綁定 checkbox change + note input 事件，觸發即時儲存（事件代理） */
  _bindInstantSaveHandler(container, eventId, type) {
    if (!container || container.dataset.instantSaveBound === '1') return;
    container.dataset.instantSaveBound = '1';
    var prefix = type === 'reg' ? 'manual-' : 'unreg-';
    var ciPrefix = prefix + 'checkin-';
    var coPrefix = prefix + 'checkout-';
    var notePrefix = prefix + 'note-';
    var self = this;
    // Checkbox change → 300ms debounce
    container.addEventListener('change', function (e) {
      var target = e.target;
      if (!target || target.tagName !== 'INPUT' || target.type !== 'checkbox') return;
      var id = String(target.id || '');
      var uid = null;
      if (id.indexOf(ciPrefix) === 0) uid = id.slice(ciPrefix.length);
      else if (id.indexOf(coPrefix) === 0) uid = id.slice(coPrefix.length);
      if (!uid) return;
      var curEvtId = type === 'reg' ? self._attendanceEditingEventId : self._unregEditingEventId;
      if (!curEvtId) return;
      if (type === 'reg') {
        self._onAttendanceCheckboxChange(curEvtId, uid);
      } else {
        self._onUnregCheckboxChange(curEvtId, uid);
      }
    });
    // Note input → 1000ms debounce
    if (!self._iSaveNoteTimers) self._iSaveNoteTimers = Object.create(null);
    container.addEventListener('input', function (e) {
      var target = e.target;
      if (!target || target.tagName !== 'INPUT' || target.type !== 'text') return;
      var id = String(target.id || '');
      if (id.indexOf(notePrefix) !== 0) return;
      var uid = id.slice(notePrefix.length);
      if (!uid) return;
      var curEvtId = type === 'reg' ? self._attendanceEditingEventId : self._unregEditingEventId;
      if (!curEvtId) return;
      var timerKey = type + '_' + uid;
      if (self._iSaveNoteTimers[timerKey]) clearTimeout(self._iSaveNoteTimers[timerKey]);
      self._iSaveNoteTimers[timerKey] = setTimeout(function() {
        delete self._iSaveNoteTimers[timerKey];
        if (type === 'reg') {
          self._onAttendanceCheckboxChange(curEvtId, uid);
        } else {
          self._onUnregCheckboxChange(curEvtId, uid);
        }
      }, 1000);
    });
  },

  /** 清理即時儲存狀態（離開編輯模式時） */
  _cleanupInstantSave() {
    for (var uid of Object.keys(this._iSaveTimers)) clearTimeout(this._iSaveTimers[uid]);
    this._iSaveTimers = Object.create(null);
    this._iSavePeople = null;
    this._iSaveInFlight = Object.create(null);
    this._iSaveQueued = Object.create(null);
    if (this._iSaveNoteTimers) {
      for (var k of Object.keys(this._iSaveNoteTimers)) clearTimeout(this._iSaveNoteTimers[k]);
      this._iSaveNoteTimers = Object.create(null);
    }
  },

  _cleanupUnregInstantSave() {
    for (var uid of Object.keys(this._iSaveUnregTimers)) clearTimeout(this._iSaveUnregTimers[uid]);
    this._iSaveUnregTimers = Object.create(null);
    this._iSaveUnregPeople = null;
    this._iSaveUnregInFlight = Object.create(null);
    this._iSaveUnregQueued = Object.create(null);
    if (this._iSaveNoteTimers) {
      for (var k of Object.keys(this._iSaveNoteTimers)) {
        if (k.indexOf('unreg_') === 0) { clearTimeout(this._iSaveNoteTimers[k]); delete this._iSaveNoteTimers[k]; }
      }
    }
  },

});
