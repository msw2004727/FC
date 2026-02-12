/* ================================================
   SportHub — Scan Check-in / Check-out Module
   ================================================ */

Object.assign(App, {

  _scanSelectedEventId: null,
  _scanMode: 'checkin',
  _scannerInstance: null,
  _lastScannedUid: null,
  _lastScanTime: 0,
  _scanResultsLog: [],

  // ══════════════════════════════════
  //  Render scan page
  // ══════════════════════════════════

  renderScanPage() {
    const select = document.getElementById('scan-event-select');
    if (!select) return;

    // Populate event options
    const myLevel = ROLE_LEVEL_MAP[this.currentRole] || 0;
    const isAdmin = myLevel >= ROLE_LEVEL_MAP.admin;
    let events = ApiService.getEvents().filter(e =>
      e.status === 'open' || e.status === 'full' || e.status === 'ended'
    );
    if (!isAdmin) {
      const now = new Date();
      const todayStr = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')}`;
      events = events.filter(e => {
        const isOwnerOrDelegate = this._isEventOwner(e) || this._isEventDelegate(e);
        const eventDateStr = (e.date || '').split(' ')[0];
        return isOwnerOrDelegate && eventDateStr === todayStr;
      });
    }

    // 依活動日期+時間排序：越早的越上面（升序）
    events.sort((a, b) => {
      const da = (a.date || '');
      const db = (b.date || '');
      return da.localeCompare(db);
    });

    select.innerHTML = '<option value="">— 請選擇活動 —</option>';
    events.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = `${e.title}（${e.date}）`;
      select.appendChild(opt);
    });

    // Restore previous selection if still valid
    if (this._scanSelectedEventId) {
      select.value = this._scanSelectedEventId;
    }

    this._updateScanControls();
    this._renderAttendanceSections();
    this._bindScanEvents();
  },

  _bindScanEvents() {
    const select = document.getElementById('scan-event-select');
    const cameraBtn = document.getElementById('scan-camera-btn');
    const manualBtn = document.getElementById('scan-manual-btn');
    const uidInput = document.getElementById('scan-uid-input');
    const modeToggles = document.querySelectorAll('#page-scan .scan-mode');

    // Prevent duplicate binding
    if (select.dataset.bound) return;
    select.dataset.bound = '1';

    select.addEventListener('change', () => {
      this._scanSelectedEventId = select.value || null;
      this._scanResultsLog = [];
      document.getElementById('scan-results').innerHTML = '';
      this._updateScanControls();
      this._renderAttendanceSections();
    });

    modeToggles.forEach(btn => {
      btn.addEventListener('click', () => {
        modeToggles.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._scanMode = btn.dataset.mode;
      });
    });

    cameraBtn.addEventListener('click', () => this._toggleCamera());

    manualBtn.addEventListener('click', () => this._handleManualInput());

    uidInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._handleManualInput();
    });

    // Choice modal buttons
    document.getElementById('scan-choice-checkin').addEventListener('click', () => {
      this._processScanChoice('checkin');
    });
    document.getElementById('scan-choice-checkout').addEventListener('click', () => {
      this._processScanChoice('checkout');
    });
    document.getElementById('scan-choice-cancel').addEventListener('click', () => {
      document.getElementById('scan-choice-modal').classList.remove('open');
    });
  },

  _updateScanControls() {
    const hasEvent = !!this._scanSelectedEventId;
    const cameraBtn = document.getElementById('scan-camera-btn');
    const manualBtn = document.getElementById('scan-manual-btn');
    const uidInput = document.getElementById('scan-uid-input');
    if (cameraBtn) cameraBtn.disabled = !hasEvent;
    if (manualBtn) manualBtn.disabled = !hasEvent;
    if (uidInput) uidInput.disabled = !hasEvent;
  },

  // ══════════════════════════════════
  //  Camera scanning
  // ══════════════════════════════════

  async _toggleCamera() {
    if (!this._scanSelectedEventId) {
      this.showToast('請先選擇活動');
      return;
    }

    // If scanner is running, stop it
    if (this._scannerInstance) {
      this._stopCamera();
      return;
    }

    // Check if mobile
    const isMobile = /Mobi|Android|iPhone/i.test(navigator.userAgent);
    if (!isMobile) {
      this.showToast('相機掃碼僅支援行動裝置');
      return;
    }

    // 動態載入 QR 掃碼庫（延遲載入，不阻塞啟動）
    if (typeof Html5Qrcode === 'undefined') {
      try {
        this.showToast('載入掃碼元件...');
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js';
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      } catch (e) {
        this.showToast('QR 掃碼元件載入失敗');
        return;
      }
    }

    const readerId = 'scan-qr-reader';
    const readerEl = document.getElementById(readerId);
    readerEl.innerHTML = '';

    const scanner = new Html5Qrcode(readerId);
    this._scannerInstance = scanner;
    document.getElementById('scan-camera-btn').textContent = '關閉相機';

    scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 200, height: 200 } },
      (decodedText) => {
        // 3-second dedup
        const now = Date.now();
        if (decodedText === this._lastScannedUid && now - this._lastScanTime < 3000) return;
        this._lastScannedUid = decodedText;
        this._lastScanTime = now;
        this._processAttendance(decodedText.trim(), this._scanMode);
      },
      () => {} // ignore scan error frames
    ).catch(err => {
      console.warn('[Scan] Camera error:', err);
      this.showToast('無法開啟相機，請確認權限');
      this._scannerInstance = null;
      document.getElementById('scan-camera-btn').textContent = '開啟相機掃碼';
      readerEl.innerHTML = '<span style="color:var(--text-muted);font-size:.85rem;">點擊下方按鈕開啟相機</span>';
    });
  },

  _stopCamera() {
    if (this._scannerInstance) {
      this._scannerInstance.stop().then(() => {
        this._scannerInstance.clear();
        this._scannerInstance = null;
      }).catch(() => {
        this._scannerInstance = null;
      });
    }
    const btn = document.getElementById('scan-camera-btn');
    if (btn) btn.textContent = '開啟相機掃碼';
    const readerEl = document.getElementById('scan-qr-reader');
    if (readerEl) readerEl.innerHTML = '<span style="color:var(--text-muted);font-size:.85rem;">點擊下方按鈕開啟相機</span>';
  },

  // ══════════════════════════════════
  //  Manual input
  // ══════════════════════════════════

  _handleManualInput() {
    const input = document.getElementById('scan-uid-input');
    const uid = (input.value || '').trim();
    if (!uid) {
      this.showToast('請輸入 UID');
      return;
    }
    if (!this._scanSelectedEventId) {
      this.showToast('請先選擇活動');
      return;
    }

    // Look up user info to show in choice modal
    const userInfo = this._findUserByUid(uid);
    const modal = document.getElementById('scan-choice-modal');
    document.getElementById('scan-choice-name').textContent = userInfo ? userInfo.name : '未知用戶';
    document.getElementById('scan-choice-uid').textContent = uid;
    modal.dataset.uid = uid;
    modal.classList.add('open');
    input.value = '';
  },

  _pendingChoiceUid: null,

  _processScanChoice(mode) {
    const modal = document.getElementById('scan-choice-modal');
    const uid = modal.dataset.uid;
    modal.classList.remove('open');
    if (uid) {
      this._processAttendance(uid, mode);
    }
  },

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

  _processAttendance(uid, mode) {
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
    const userName = userInfo ? userInfo.name : uid;
    const participants = event.participants || [];
    const isRegistered = participants.includes(userName);

    // Get existing attendance records for this event
    const records = ApiService.getAttendanceRecords(this._scanSelectedEventId);
    const userCheckin = records.find(r => r.uid === uid && r.type === 'checkin');
    const userCheckout = records.find(r => r.uid === uid && r.type === 'checkout');

    let resultClass = '';
    let resultMsg = '';

    if (!isRegistered) {
      // Unregistered — record in red
      resultClass = 'error';
      resultMsg = `${userName} 未報名此活動`;
      // Add unregistered record if not already present
      if (!records.find(r => r.uid === uid && r.type === 'unreg')) {
        const now = new Date();
        const timeStr = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        ApiService.addAttendanceRecord({
          id: 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2,5),
          eventId: this._scanSelectedEventId,
          uid,
          userName,
          type: 'unreg',
          time: timeStr,
        });
      }
    } else if (mode === 'checkin') {
      if (userCheckin) {
        resultClass = 'warning';
        resultMsg = `${userName} 已完成簽到`;
      } else {
        const now = new Date();
        const timeStr = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        ApiService.addAttendanceRecord({
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
      if (!userCheckin) {
        resultClass = 'warning';
        resultMsg = `${userName} 尚未簽到，無法簽退`;
      } else if (userCheckout) {
        resultClass = 'warning';
        resultMsg = `${userName} 已完成簽退`;
      } else {
        const now = new Date();
        const timeStr = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        ApiService.addAttendanceRecord({
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
      }
    }

    // Add result to log
    this._scanResultsLog.unshift({ cls: resultClass, msg: resultMsg });
    if (this._scanResultsLog.length > 20) this._scanResultsLog.length = 20;
    this._renderScanResults();
    this._renderAttendanceSections();

    // 彈跳結果視窗（相機掃碼 + 手動輸入皆觸發）
    this._showScanResultPopup(resultClass, resultMsg, userName);
  },

  _showScanResultPopup(cls, msg, userName) {
    const icons = { success: '\u2705', warning: '\u26A0\uFE0F', error: '\u274C' };
    const modal = document.getElementById('scan-result-modal');
    const box = document.getElementById('scan-result-box');
    document.getElementById('scan-result-icon').textContent = icons[cls] || '';
    document.getElementById('scan-result-title').textContent = msg;
    document.getElementById('scan-result-name').textContent = '';
    box.className = 'scan-result-box ' + cls;
    modal.classList.add('open');
  },

  closeScanResult() {
    const modal = document.getElementById('scan-result-modal');
    if (modal) modal.classList.remove('open');
  },

  // ══════════════════════════════════
  //  Render helpers
  // ══════════════════════════════════

  _renderScanResults() {
    const container = document.getElementById('scan-results');
    if (!container) return;
    container.innerHTML = this._scanResultsLog.map(r =>
      `<div class="scan-result ${r.cls}">${r.msg}</div>`
    ).join('');
  },

  _renderAttendanceSections() {
    const eventId = this._scanSelectedEventId;
    const checkinDiv = document.getElementById('scan-checkin-section');
    const checkoutDiv = document.getElementById('scan-checkout-section');
    const unregDiv = document.getElementById('scan-unreg-section');
    const statsDiv = document.getElementById('scan-stats');

    if (!checkinDiv) return;

    if (!eventId) {
      checkinDiv.innerHTML = '';
      checkoutDiv.innerHTML = '';
      unregDiv.innerHTML = '';
      statsDiv.innerHTML = '';
      return;
    }

    const event = ApiService.getEvent(eventId);
    if (!event) return;

    const records = ApiService.getAttendanceRecords(eventId);
    const participants = event.participants || [];

    // Build user sets
    const checkinUsers = new Map(); // uid -> {userName, time}
    const checkoutUsers = new Map();
    const unregUsers = new Map();

    records.forEach(r => {
      if (r.type === 'checkin' && !checkinUsers.has(r.uid)) {
        checkinUsers.set(r.uid, { name: r.userName, time: r.time });
      }
      if (r.type === 'checkout' && !checkoutUsers.has(r.uid)) {
        checkoutUsers.set(r.uid, { name: r.userName, time: r.time });
      }
      if (r.type === 'unreg' && !unregUsers.has(r.uid)) {
        unregUsers.set(r.uid, { name: r.userName, time: r.time });
      }
    });

    // checkedIn = 所有有簽到紀錄的人（不因簽退而消失）
    const checkedInOnly = [];
    checkinUsers.forEach((val) => {
      checkedInOnly.push(val.name);
    });

    // checkedOut = has both checkin + checkout
    const checkedOutList = [];
    checkoutUsers.forEach((val, uid) => {
      if (checkinUsers.has(uid)) checkedOutList.push(val.name);
    });

    // unregistered
    const unregList = [];
    unregUsers.forEach((val) => unregList.push(val.name));

    const tag = (name) => `<span class="scan-user-tag">${name}</span>`;

    checkinDiv.innerHTML = `<div class="scan-section scan-section-checkin">
      <h4>已簽到（${checkedInOnly.length}）</h4>
      <div class="scan-user-tags">${checkedInOnly.length ? checkedInOnly.map(tag).join('') : '<span style="font-size:.78rem;color:var(--text-muted)">尚無</span>'}</div>
    </div>`;

    checkoutDiv.innerHTML = `<div class="scan-section scan-section-checkout">
      <h4>已簽退（${checkedOutList.length}）</h4>
      <div class="scan-user-tags">${checkedOutList.length ? checkedOutList.map(tag).join('') : '<span style="font-size:.78rem;color:var(--text-muted)">尚無</span>'}</div>
    </div>`;

    unregDiv.innerHTML = unregList.length ? `<div class="scan-section scan-section-unreg">
      <h4>未報名（${unregList.length}）</h4>
      <div class="scan-user-tags">${unregList.map(tag).join('')}</div>
    </div>` : '';

    // Stats（已簽到 = checkedInOnly 已包含所有簽到者，不重複計算）
    const totalParticipants = participants.length;
    const totalCheckedIn = checkedInOnly.length;
    const completionRate = totalParticipants > 0 ? Math.round(totalCheckedIn / totalParticipants * 100) : 0;

    statsDiv.innerHTML = `
      <span>報名：<strong>${totalParticipants}</strong></span>
      <span>已簽到：<strong>${totalCheckedIn}</strong></span>
      <span>已簽退：<strong>${checkedOutList.length}</strong></span>
      <span>未報名：<strong>${unregList.length}</strong></span>
      <span>出席率：<strong>${completionRate}%</strong></span>
    `;
  },

});
