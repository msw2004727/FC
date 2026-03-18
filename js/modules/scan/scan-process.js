/* ================================================
   SportHub — Scan: Attendance Processing
   Split from scan.js — scan result processing,
   attendance marking, validation, family checkin.
   innerHTML usage with escapeHTML() is safe and
   expected in this project per CLAUDE.md rules.
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  Core attendance processing
  // ══════════════════════════════════

  _findUserByUid(uid) {
    // Check adminUsers
    const adminUsers = ApiService.getAdminUsers();
    const found = adminUsers.find(u => u.uid === uid);
    if (found) return found;
    // Check currentUser
    const cur = ApiService.getCurrentUser();
    if (cur && (cur.uid === uid || cur.lineUserId === uid)) {
      return { name: cur.displayName || cur.name, uid: cur.uid };
    }
    return null;
  },

  async _processAttendance(uid, mode) {
    if (!this._scanSelectedEventId) {
      this.showToast('請先選擇活動');
      return;
    }

    const event = ApiService.getEvent(this._scanSelectedEventId);
    if (!event) {
      this.showToast('活動不存在');
      return;
    }

    const userInfo = this._findUserByUid(uid);
    if (!userInfo) {
      this._showScanResultPopup('error', '查無此用戶', uid);
      return;
    }
    const userName = userInfo.name;

    // 取得此用戶在此活動的 confirmed 報名（含同行者）
    const userRegs = ApiService._src('registrations').filter(
      r => r.userId === uid && r.eventId === this._scanSelectedEventId && r.status === 'confirmed'
    );
    if (userRegs.length > 1 || (userRegs.length === 1 && userRegs[0].companionId)) {
      this._showFamilyCheckinMenu(uid, userName, userRegs, mode);
      return;
    }

    const participants = event.participants || [];
    // 優先查 confirmed registrations（候補視同未報名）
    const userRegsForCheck = ApiService.getRegistrationsByEvent(this._scanSelectedEventId)
      .filter(r => (r.userId === uid || r.userName === userName) && r.status === 'confirmed');
    const isRegistered = userRegsForCheck.length > 0 || participants.includes(userName);

    // Get existing attendance records for this event
    const records = ApiService.getAttendanceRecords(this._scanSelectedEventId);
    const userCheckin = records.find(r => r.uid === uid && r.type === 'checkin');
    const userCheckout = records.find(r => r.uid === uid && r.type === 'checkout');

    let resultClass = '';
    let resultMsg = '';

    // Optimistic UI：addAttendanceRecord 會同步推入快取，Firestore 寫入在背景進行
    const _addRecord = (rec) => {
      ApiService.addAttendanceRecord(rec).catch(err => {
        console.error('[Scan] attendance write failed:', err);
        this.showToast(`寫入失敗：${err?.message || '請確認登入狀態與網路'}`);
        // rollback 後重新渲染 UI 以反映快取狀態
        this._renderScanResults();
        this._renderAttendanceSections();
      });
    };

    if (!isRegistered) {
      // 未報名 — 先寫 unreg 標記
      if (!records.find(r => r.uid === uid && r.type === 'unreg')) {
        const now = new Date();
        const timeStr = App._formatDateTime(now);
        _addRecord({
          id: 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2,5),
          eventId: this._scanSelectedEventId,
          uid, userName, type: 'unreg', time: timeStr,
        });
      }
      // 同時處理簽到/簽退（同報名者邏輯，但 resultClass 為 warning、不給 EXP）
      if (mode === 'checkin') {
        if (userCheckin) {
          resultClass = 'warning';
          resultMsg = `${userName} 未報名，已完成簽到`;
        } else {
          const now = new Date();
          const timeStr = App._formatDateTime(now);
          _addRecord({
            id: 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2,5),
            eventId: this._scanSelectedEventId,
            uid, userName, type: 'checkin', time: timeStr,
          });
          resultClass = 'warning';
          resultMsg = `${userName} 未報名，簽到成功`;
        }
      } else {
        if (userCheckout) {
          resultClass = 'warning';
          resultMsg = `${userName} 未報名，已完成簽退`;
        } else if (!userCheckin) {
          const now = new Date();
          const timeStr = App._formatDateTime(now);
          _addRecord({
            id: 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2,5),
            eventId: this._scanSelectedEventId,
            uid, userName, type: 'checkin', time: timeStr,
          });
          _addRecord({
            id: 'att_' + Date.now() + '_' + (Math.random().toString(36).slice(2,5)),
            eventId: this._scanSelectedEventId,
            uid, userName, type: 'checkout', time: timeStr,
          });
          resultClass = 'warning';
          resultMsg = `${userName} 未報名，已自動完成簽到與簽退`;
        } else {
          const now = new Date();
          const timeStr = App._formatDateTime(now);
          _addRecord({
            id: 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2,5),
            eventId: this._scanSelectedEventId,
            uid, userName, type: 'checkout', time: timeStr,
          });
          resultClass = 'warning';
          resultMsg = `${userName} 未報名，簽退成功`;
        }
      }
    } else if (mode === 'checkin') {
      if (userCheckin) {
        resultClass = 'warning';
        resultMsg = `${userName} 已完成簽到`;
      } else {
        const now = new Date();
        const timeStr = App._formatDateTime(now);
        _addRecord({
          id: 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2,5),
          eventId: this._scanSelectedEventId,
          uid,
          userName,
          type: 'checkin',
          time: timeStr,
        });
        resultClass = 'success';
        resultMsg = `${userName} 簽到成功`;
      }
    } else {
      // checkout
      if (userCheckout) {
        resultClass = 'warning';
        resultMsg = `${userName} 已完成簽退`;
      } else if (!userCheckin) {
        const now = new Date();
        const timeStr = App._formatDateTime(now);
        _addRecord({
          id: 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2,5),
          eventId: this._scanSelectedEventId,
          uid,
          userName,
          type: 'checkin',
          time: timeStr,
        });
        _addRecord({
          id: 'att_' + Date.now() + '_' + (Math.random().toString(36).slice(2,5)),
          eventId: this._scanSelectedEventId,
          uid,
          userName,
          type: 'checkout',
          time: timeStr,
        });
        resultClass = 'success';
        resultMsg = `${userName} 未簽到，已自動完成簽到與簽退`;
        // Auto EXP: complete activity
        const _evt = ApiService.getEvent(this._scanSelectedEventId);
        this._grantAutoExp(uid, 'complete_activity', _evt?.title || '');
        this._evaluateAchievements?.(_evt?.type);
      } else {
        const now = new Date();
        const timeStr = App._formatDateTime(now);
        _addRecord({
          id: 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2,5),
          eventId: this._scanSelectedEventId,
          uid,
          userName,
          type: 'checkout',
          time: timeStr,
        });
        resultClass = 'success';
        resultMsg = `${userName} 簽退成功`;
        // Auto EXP: complete activity
        const _evt = ApiService.getEvent(this._scanSelectedEventId);
        this._grantAutoExp(uid, 'complete_activity', _evt?.title || '');
        this._evaluateAchievements?.(_evt?.type);
      }
    }

    this._renderScanResults();
    this._renderAttendanceSections();

    // 彈跳結果視窗（相機掃碼 + 手動輸入皆觸發）
    this._showScanResultPopup(resultClass, resultMsg, userName);

    // Demo 模式：模擬被掃方收到通知
    if (resultClass === 'success' && ModeManager.isDemo() && typeof this._simulateAttendanceNotify === 'function') {
      this._simulateAttendanceNotify(this._scanSelectedEventId, mode);
    }
  },

  _showScanResultPopup(cls, msg, userName) {
    const icons = { success: '\u2705', warning: '\u26A0\uFE0F', error: '\u274C' };
    const modal = document.getElementById('scan-result-modal');
    const box = document.getElementById('scan-result-box');
    document.getElementById('scan-result-icon').textContent = icons[cls] || '';
    document.getElementById('scan-result-title').textContent = msg;
    const event = this._scanSelectedEventId ? ApiService.getEvent(this._scanSelectedEventId) : null;
    document.getElementById('scan-result-name').textContent = event ? event.title : '';
    box.className = 'scan-result-box ' + cls;
    modal.classList.add('open');
  },

  closeScanResult() {
    const modal = document.getElementById('scan-result-modal');
    if (modal) modal.classList.remove('open');
  },

  // 家庭簽到 → moved to scan-family.js

});
