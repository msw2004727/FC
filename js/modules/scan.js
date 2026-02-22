/* ================================================
   SportHub — Scan Check-in / Check-out Module
   ================================================ */

Object.assign(App, {

  _scanSelectedEventId: null,
  _scanPresetEventId: null,
  _scanMode: 'checkin',
  _scannerInstance: null,
  _lastScannedUid: null,
  _lastScanTime: 0,
  _scanResultsLog: [],

  goToScanForEvent(eventId) {
    this._scanPresetEventId = eventId;
    this.showPage('page-scan');
  },

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

    // ── 預設活動模式：從活動詳情頁帶入 ──
    if (this._scanPresetEventId) {
      const presetId = this._scanPresetEventId;
      this._scanPresetEventId = null;
      const presetEvent = ApiService.getEvent(presetId);
      if (presetEvent) {
        if (!select.querySelector(`option[value="${presetId}"]`)) {
          const opt = document.createElement('option');
          opt.value = presetId;
          opt.textContent = `${presetEvent.title}（${presetEvent.date}）`;
          select.appendChild(opt);
        }
        select.value = presetId;
        this._scanSelectedEventId = presetId;
        select.disabled = true;
      }
    } else {
      select.disabled = false;
      if (this._scanSelectedEventId) {
        select.value = this._scanSelectedEventId;
      }
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

    // Demo 模式：模擬被掃方收到通知
    if (resultClass === 'success' && typeof this._simulateAttendanceNotify === 'function') {
      this._simulateAttendanceNotify(this._scanSelectedEventId, mode);
    }
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

    // 只計算正取（confirmed）registrations
    const allRegs = ApiService.getRegistrationsByEvent(eventId);
    const confirmedRegs = allRegs.filter(r => r.status === 'confirmed');
    const confirmedCountByUid = new Map();
    confirmedRegs.forEach(r => {
      confirmedCountByUid.set(r.userId, (confirmedCountByUid.get(r.userId) || 0) + 1);
    });

    // Build user sets：用 uid+companionId 去重，正確計入同行者
    const checkinMap = new Map();  // key -> {name, time}
    const checkoutMap = new Map();
    const unregMap = new Map();

    records.forEach(r => {
      const key = r.companionId ? `${r.uid}_${r.companionId}` : r.uid;
      const displayName = r.companionId ? (r.companionName || r.userName) : r.userName;
      if (r.type === 'checkin' && !checkinMap.has(key)) {
        checkinMap.set(key, { name: displayName, time: r.time, uid: r.uid, companionId: r.companionId });
      }
      if (r.type === 'checkout' && !checkoutMap.has(key)) {
        checkoutMap.set(key, { name: displayName, time: r.time, uid: r.uid, companionId: r.companionId });
      }
      if (r.type === 'unreg' && !unregMap.has(key)) {
        unregMap.set(key, { name: displayName, time: r.time });
      }
    });

    // 產生帶 *N 的標籤（只計正取人數）
    const tagWithCount = (name, uid) => {
      const count = confirmedCountByUid.get(uid) || 1;
      const suffix = count > 1 ? ` *${count}` : '';
      return `<span class="scan-user-tag">${escapeHTML(name)}${suffix}</span>`;
    };

    // 已簽到：按主用戶分組顯示（含同行者人數）
    const checkinByUid = new Map();
    checkinMap.forEach((val) => {
      if (!checkinByUid.has(val.uid)) checkinByUid.set(val.uid, val);
    });
    const checkedInTags = [];
    checkinByUid.forEach((val, uid) => checkedInTags.push(tagWithCount(val.name, uid)));

    // 已簽退：按主用戶分組顯示
    const checkoutByUid = new Map();
    checkoutMap.forEach((val) => {
      if (checkinMap.has(val.companionId ? `${val.uid}_${val.companionId}` : val.uid)) {
        if (!checkoutByUid.has(val.uid)) checkoutByUid.set(val.uid, val);
      }
    });
    const checkedOutTags = [];
    checkoutByUid.forEach((val, uid) => checkedOutTags.push(tagWithCount(val.name, uid)));

    // 未報名
    const unregTags = [];
    unregMap.forEach((val) => unregTags.push(`<span class="scan-user-tag">${escapeHTML(val.name)}</span>`));

    checkinDiv.innerHTML = `<div class="scan-section scan-section-checkin">
      <h4>已簽到（${checkinMap.size}）</h4>
      <div class="scan-user-tags">${checkedInTags.length ? checkedInTags.join('') : '<span style="font-size:.78rem;color:var(--text-muted)">尚無</span>'}</div>
    </div>`;

    checkoutDiv.innerHTML = `<div class="scan-section scan-section-checkout">
      <h4>已簽退（${checkoutMap.size}）</h4>
      <div class="scan-user-tags">${checkedOutTags.length ? checkedOutTags.join('') : '<span style="font-size:.78rem;color:var(--text-muted)">尚無</span>'}</div>
    </div>`;

    unregDiv.innerHTML = unregTags.length ? `<div class="scan-section scan-section-unreg">
      <h4>未報名（${unregTags.length}）</h4>
      <div class="scan-user-tags">${unregTags.join('')}</div>
    </div>` : '';

    // Stats：報名 = 正取人數，出席率 = 已簽到人頭 / 正取人數
    const totalConfirmed = confirmedRegs.length > 0 ? confirmedRegs.length : (event.participants || []).length;
    const totalCheckedIn = checkinMap.size;
    const totalCheckedOut = checkoutMap.size;
    const completionRate = totalConfirmed > 0 ? Math.round(totalCheckedIn / totalConfirmed * 100) : 0;

    statsDiv.innerHTML = `
      <span>報名：<strong>${totalConfirmed}</strong></span>
      <span>已簽到：<strong>${totalCheckedIn}</strong></span>
      <span>已簽退：<strong>${totalCheckedOut}</strong></span>
      <span>未報名：<strong>${unregTags.length}</strong></span>
      <span>出席率：<strong>${completionRate}%</strong></span>
    `;
  },

  // ── 家庭簽到 Modal ──

  _familyScanUid: null,
  _familyScanUserName: null,
  _familyScanMode: null,

  _showFamilyCheckinMenu(uid, userName, regs, mode) {
    const eventId = this._scanSelectedEventId;
    const records = ApiService.getAttendanceRecords(eventId);
    const modeLabel = mode === 'checkin' ? '簽到' : '簽退';

    this._familyScanUid = uid;
    this._familyScanUserName = userName;
    this._familyScanMode = mode;

    const titleEl = document.getElementById('scan-family-title');
    const listEl = document.getElementById('scan-family-list');
    const confirmBtn = document.getElementById('scan-family-confirm-btn');
    if (!titleEl || !listEl) return;

    titleEl.textContent = `👨‍👩‍👧 家庭${modeLabel}（${userName}）`;
    if (confirmBtn) confirmBtn.textContent = `確認${modeLabel}`;

    const rows = regs.map(r => {
      const displayName = r.companionName || r.userName;
      const cId = r.companionId || null;
      const hasCheckin = records.some(a => a.uid === uid && a.type === 'checkin' && (a.companionId || null) === cId);
      const hasCheckout = records.some(a => a.uid === uid && a.type === 'checkout' && (a.companionId || null) === cId);
      const statusLabel = hasCheckout ? '✅ 已簽退' : hasCheckin ? '📍 已簽到' : '—';
      const disabled = (mode === 'checkin' && hasCheckin) || (mode === 'checkout' && (hasCheckout || !hasCheckin));
      return `<label style="display:flex;align-items:center;gap:.5rem;padding:.3rem 0;border-bottom:1px solid var(--border);cursor:pointer">
        <input type="checkbox" name="family-scan" data-companion-id="${escapeHTML(cId || '')}" data-name="${escapeHTML(displayName)}" ${!disabled ? 'checked' : 'disabled'} style="width:15px;height:15px">
        <span style="flex:1;font-size:.82rem">${escapeHTML(displayName)}${!cId ? '（本人）' : ''}</span>
        <span style="font-size:.68rem;color:var(--text-muted)">${statusLabel}</span>
      </label>`;
    }).join('');
    listEl.innerHTML = rows;

    document.getElementById('scan-family-modal').classList.add('open');
  },

  _closeFamilyModal() {
    const modal = document.getElementById('scan-family-modal');
    if (modal) modal.classList.remove('open');
    this._familyScanUid = null;
    this._familyScanUserName = null;
    this._familyScanMode = null;
  },

  _confirmFamilyCheckin() {
    const uid = this._familyScanUid;
    const userName = this._familyScanUserName;
    const mode = this._familyScanMode;
    if (!uid || !mode) return;

    const checked = [...document.querySelectorAll('#scan-family-list input[name="family-scan"]:not([disabled]):checked')];
    if (checked.length === 0) { this.showToast('請選擇要處理的成員'); return; }
    const eventId = this._scanSelectedEventId;
    const records = ApiService.getAttendanceRecords(eventId);
    const now = new Date();
    const timeStr = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    checked.forEach(cb => {
      const cId = cb.dataset.companionId || null;
      const displayName = cb.dataset.name;
      const hasCheckin = records.some(r => r.uid === uid && r.type === 'checkin' && (r.companionId || null) === cId);
      const hasCheckout = records.some(r => r.uid === uid && r.type === 'checkout' && (r.companionId || null) === cId);
      if (mode === 'checkin' && !hasCheckin) {
        ApiService.addAttendanceRecord({
          id: 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
          eventId, uid, userName,
          participantType: cId ? 'companion' : 'self',
          companionId: cId || null,
          companionName: cId ? displayName : null,
          type: 'checkin', time: timeStr,
        });
      } else if (mode === 'checkout' && hasCheckin && !hasCheckout) {
        ApiService.addAttendanceRecord({
          id: 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
          eventId, uid, userName,
          participantType: cId ? 'companion' : 'self',
          companionId: cId || null,
          companionName: cId ? displayName : null,
          type: 'checkout', time: timeStr,
        });
        if (!cId) {
          const _evt = ApiService.getEvent(eventId);
          this._grantAutoExp(uid, 'complete_activity', _evt?.title || '');
        }
      }
    });

    // 關閉 family modal
    this._closeFamilyModal();

    const modeLabel = mode === 'checkin' ? '簽到' : '簽退';
    this._scanResultsLog.unshift({ cls: 'success', msg: `${userName} 等 ${checked.length} 人${modeLabel}成功` });
    if (this._scanResultsLog.length > 20) this._scanResultsLog.length = 20;
    this._renderScanResults();
    this._renderAttendanceSections();
    this._showScanResultPopup('success', `${userName} 等 ${checked.length} 人${modeLabel}成功`, userName);

    // Demo 模式：模擬被掃方收到通知
    if (typeof this._simulateAttendanceNotify === 'function') {
      this._simulateAttendanceNotify(eventId, mode);
    }
  },

});
