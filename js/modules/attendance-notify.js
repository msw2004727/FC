/* ================================================
   SportHub — Attendance Notification Module
   被掃方即時通知：偵測到簽到/簽退紀錄時彈出全螢幕通知
   Production: Firestore onSnapshot
   Demo: 掃碼後直接觸發
   ================================================ */

Object.assign(App, {

  _attendanceListenerUnsub: null,
  _lastKnownAttRecordCount: 0,

  // ── Production: Firestore onSnapshot ──
  startAttendanceListener() {
    const user = ApiService.getCurrentUser?.();
    if (!user?.uid || ModeManager.isDemo()) return;
    if (this._attendanceListenerUnsub) return;

    const uid = user.uid;
    this._lastKnownAttRecordCount = (FirebaseService._cache.attendanceRecords || [])
      .filter(r => r.uid === uid).length;

    this._attendanceListenerUnsub = db.collection('attendanceRecords')
      .where('uid', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(5)
      .onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
          if (change.type === 'added') {
            const data = change.doc.data();
            if (this._lastKnownAttRecordCount > 0) {
              this._lastKnownAttRecordCount--;
              return;
            }
            this._showAttendanceNotification(data);
          }
        });
      });
  },

  stopAttendanceListener() {
    if (this._attendanceListenerUnsub) {
      this._attendanceListenerUnsub();
      this._attendanceListenerUnsub = null;
    }
  },

  // ── Demo: 掃碼後直接觸發 ──
  _simulateAttendanceNotify(eventId, type) {
    const e = ApiService.getEvent(eventId);
    setTimeout(() => {
      this._showAttendanceNotification({
        eventId,
        type,
        eventTitle: e?.title || '',
      });
    }, 500);
  },

  // ── 通知彈窗 ──
  _showAttendanceNotification(data) {
    const type = data.type;
    if (type !== 'checkin' && type !== 'checkout') return;
    const icon = '\u2705';
    const title = type === 'checkin' ? '簽到成功' : '簽退成功';
    const eventName = data.eventTitle || data.eventName || '';
    this._showGlobalAttendanceModal(icon, title, eventName);
  },

  _showGlobalAttendanceModal(icon, title, eventName) {
    const modal = document.getElementById('attendance-notify-modal');
    if (!modal) return;
    const iconEl = document.getElementById('att-notify-icon');
    const titleEl = document.getElementById('att-notify-title');
    const eventEl = document.getElementById('att-notify-event');
    if (iconEl) iconEl.textContent = icon;
    if (titleEl) titleEl.textContent = title;
    if (eventEl) eventEl.textContent = eventName;
    modal.classList.add('open');
  },

  closeAttendanceNotify() {
    const modal = document.getElementById('attendance-notify-modal');
    if (modal) modal.classList.remove('open');
  },

});
