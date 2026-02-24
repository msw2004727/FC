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
    this._renderScanResults();
    this._renderAttendanceSections();
    this._bindScanEvents();
  },

  _bindScanEvents() {
    const select = document.getElementById('scan-event-select');
    const cameraBtn = document.getElementById('scan-camera-btn');
    const modeToggles = document.querySelectorAll('#page-scan .scan-mode');

    // Prevent duplicate binding
    if (select.dataset.bound) return;
    select.dataset.bound = '1';

    select.addEventListener('change', () => {
      this._scanSelectedEventId = select.value || null;
      this._updateScanControls();
      this._renderScanResults();
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
  },

  _updateScanControls() {
    const hasEvent = !!this._scanSelectedEventId;
    const cameraBtn = document.getElementById('scan-camera-btn');
    if (cameraBtn) cameraBtn.disabled = !hasEvent;
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
      { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      { fps: 15, qrbox: { width: 200, height: 200 }, experimentalFeatures: { useBarCodeDetectorIfSupported: true } },
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
      // html5-qrcode 庫 reject 的是純字串（非 Error 物件），用 String() 統一處理
      const errStr = String(err).toLowerCase();
      let errMsg;
      if (errStr.includes('notallowed') || errStr.includes('permission') || errStr.includes('denied')) {
        errMsg = '相機權限被拒絕，請在瀏覽器設定中允許相機存取';
      } else if (errStr.includes('notfound') || errStr.includes('device') || errStr.includes('nosource')) {
        errMsg = '找不到相機裝置，請確認此設備有相機';
      } else if (errStr.includes('notreadable') || errStr.includes('could not start')) {
        errMsg = '相機被其他應用程式佔用，請關閉後再試';
      } else if (errStr.includes('overconstrained')) {
        errMsg = '相機不支援所需規格，請嘗試其他裝置';
      } else if (errStr.includes('not supported') || errStr.includes('streaming')) {
        errMsg = '此瀏覽器不支援相機掃碼，請改用 Chrome 或 Safari';
      } else {
        errMsg = '無法開啟相機，請確認權限或改用手動輸入';
      }
      this.showToast(errMsg);
      this._scannerInstance = null;
      document.getElementById('scan-camera-btn').textContent = '開啟相機掃碼';
      readerEl.innerHTML = `<span style="color:var(--danger);font-size:.82rem;">${errMsg}</span>`;
      // 顯示手動輸入備援
      const manualSection = document.getElementById('scan-manual-section');
      if (manualSection) manualSection.style.display = '';
    });
  },

  /** 手動輸入 UID 後觸發簽到/簽退（相機失敗備援） */
  _processManualUid() {
    const input = document.getElementById('scan-manual-uid');
    if (!input) return;
    const uid = (input.value || '').trim();
    if (!uid) { this.showToast('請輸入 UID'); return; }
    if (!this._scanSelectedEventId) { this.showToast('請先選擇活動'); return; }
    input.value = '';
    this._processAttendance(uid, this._scanMode);
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
      // 未報名 — 先寫 unreg 標記
      if (!records.find(r => r.uid === uid && r.type === 'unreg')) {
        const now = new Date();
        const timeStr = App._formatDateTime(now);
        await ApiService.addAttendanceRecord({
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
          await ApiService.addAttendanceRecord({
            id: 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2,5),
            eventId: this._scanSelectedEventId,
            uid, userName, type: 'checkin', time: timeStr,
          });
          resultClass = 'warning';
          resultMsg = `${userName} 未報名，簽到成功`;
        }
      } else {
        if (!userCheckin) {
          resultClass = 'warning';
          resultMsg = `${userName} 未報名，尚未簽到`;
        } else if (userCheckout) {
          resultClass = 'warning';
          resultMsg = `${userName} 未報名，已完成簽退`;
        } else {
          const now = new Date();
          const timeStr = App._formatDateTime(now);
          await ApiService.addAttendanceRecord({
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
        await ApiService.addAttendanceRecord({
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
        const timeStr = App._formatDateTime(now);
        await ApiService.addAttendanceRecord({
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

  // ══════════════════════════════════
  //  Render helpers
  // ══════════════════════════════════

  _renderScanResults() {
    const container = document.getElementById('scan-results');
    if (!container) return;
    if (!this._scanSelectedEventId) { container.innerHTML = ''; return; }
    const records = ApiService.getAttendanceRecords(this._scanSelectedEventId);
    const sorted = [...records].sort((a, b) => (b.time || '').localeCompare(a.time || ''));
    container.innerHTML = sorted.map(r => {
      const name = r.companionName || r.userName || r.uid;
      let cls, msg;
      if (r.type === 'checkin')  { cls = 'success'; msg = `${name} 簽到成功`; }
      else if (r.type === 'checkout') { cls = 'success'; msg = `${name} 簽退成功`; }
      else { cls = 'error'; msg = `${name} 未報名此活動`; }
      return `<div class="scan-result ${cls}">${escapeHTML(msg)}</div>`;
    }).join('');
  },

  _renderAttendanceSections() {
    const eventId = this._scanSelectedEventId;
    const regDiv = document.getElementById('scan-registered-section');
    const unregDiv = document.getElementById('scan-unreg-section');
    const statsDiv = document.getElementById('scan-stats');

    if (!regDiv) return;

    if (!eventId) {
      regDiv.innerHTML = '';
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

    // Build per-person state：按 uid+companionId 分組
    const personMap = new Map();
    records.forEach(r => {
      const key = r.companionId ? `${r.uid}_${r.companionId}` : r.uid;
      if (!personMap.has(key)) {
        personMap.set(key, {
          name: r.companionId ? (r.companionName || r.userName) : r.userName,
          uid: r.uid, companionId: r.companionId || null,
          checkin: false, checkout: false, unreg: false,
        });
      }
      const p = personMap.get(key);
      if (r.type === 'checkin') p.checkin = true;
      if (r.type === 'checkout') p.checkout = true;
      if (r.type === 'unreg') p.unreg = true;
    });

    // 分流：已報名 vs 未報名
    const regPersons = [];
    const unregPersons = [];
    personMap.forEach(p => {
      if (p.unreg) unregPersons.push(p);
      else regPersons.push(p);
    });

    // 產生帶 *N 計數與勾勾的膠囊標籤
    const buildTag = (person, isUnreg) => {
      const count = confirmedCountByUid.get(person.uid) || 1;
      const suffix = !isUnreg && count > 1 ? ` *${count}` : '';
      let checks = '';
      if (person.checkin) checks += '<span class="scan-check scan-check-in">\u2713</span>';
      if (person.checkout) {
        const cls = isUnreg ? 'scan-check-out-unreg' : 'scan-check-out-ok';
        checks += `<span class="scan-check ${cls}">\u2713</span>`;
      }
      const checksHtml = checks ? `<span class="scan-tag-checks">${checks}</span>` : '';
      const tagCls = checks ? 'scan-user-tag has-checks' : 'scan-user-tag';
      return `<span class="${tagCls}">${escapeHTML(person.name)}${suffix}${checksHtml}</span>`;
    };

    // 已報名：按主 uid 分組顯示，合併勾勾狀態
    const regByUid = new Map();
    regPersons.forEach(p => {
      if (!regByUid.has(p.uid)) {
        regByUid.set(p.uid, { ...p });
      } else {
        const ex = regByUid.get(p.uid);
        if (p.checkin) ex.checkin = true;
        if (p.checkout) ex.checkout = true;
      }
    });
    const regTags = [];
    regByUid.forEach(p => regTags.push(buildTag(p, false)));

    // 未報名
    const unregTags = unregPersons.map(p => buildTag(p, true));

    // 統計（僅計已報名者）
    const regCheckinCount = [...personMap.values()].filter(p => p.checkin && !p.unreg).length;
    const regCheckoutCount = [...personMap.values()].filter(p => p.checkout && !p.unreg).length;

    regDiv.innerHTML = `<div class="scan-section scan-section-registered">
      <h4>已報名（${regByUid.size}）</h4>
      <div class="scan-user-tags">${regTags.length ? regTags.join('') : '<span style="font-size:.78rem;color:var(--text-muted)">尚無</span>'}</div>
    </div>`;

    unregDiv.innerHTML = unregTags.length ? `<div class="scan-section scan-section-unreg">
      <h4>未報名（${unregPersons.length}）</h4>
      <div class="scan-user-tags">${unregTags.join('')}</div>
    </div>` : '';

    // Stats
    const totalConfirmed = confirmedRegs.length > 0 ? confirmedRegs.length : (event.participants || []).length;
    const completionRate = totalConfirmed > 0 ? Math.round(regCheckinCount / totalConfirmed * 100) : 0;

    statsDiv.innerHTML = `
      <span>報名：<strong>${totalConfirmed}</strong></span>
      <span>已簽到：<strong>${regCheckinCount}</strong></span>
      <span>已簽退：<strong>${regCheckoutCount}</strong></span>
      <span>未報名：<strong>${unregPersons.length}</strong></span>
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

  async _confirmFamilyCheckin() {
    const uid = this._familyScanUid;
    const userName = this._familyScanUserName;
    const mode = this._familyScanMode;
    if (!uid || !mode) return;

    const checked = [...document.querySelectorAll('#scan-family-list input[name="family-scan"]:not([disabled]):checked')];
    if (checked.length === 0) { this.showToast('請選擇要處理的成員'); return; }
    const eventId = this._scanSelectedEventId;
    const records = ApiService.getAttendanceRecords(eventId);
    const now = new Date();
    const timeStr = App._formatDateTime(now);

    for (const cb of checked) {
      const cId = cb.dataset.companionId || null;
      const displayName = cb.dataset.name;
      const hasCheckin = records.some(r => r.uid === uid && r.type === 'checkin' && (r.companionId || null) === cId);
      const hasCheckout = records.some(r => r.uid === uid && r.type === 'checkout' && (r.companionId || null) === cId);
      if (mode === 'checkin' && !hasCheckin) {
        await ApiService.addAttendanceRecord({
          id: 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
          eventId, uid, userName,
          participantType: cId ? 'companion' : 'self',
          companionId: cId || null,
          companionName: cId ? displayName : null,
          type: 'checkin', time: timeStr,
        });
      } else if (mode === 'checkout' && hasCheckin && !hasCheckout) {
        await ApiService.addAttendanceRecord({
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
    }

    // 關閉 family modal
    this._closeFamilyModal();

    this._renderScanResults();
    this._renderAttendanceSections();
    this._showScanResultPopup('success', `${userName} 等 ${checked.length} 人${modeLabel}成功`, userName);

    // Demo 模式：模擬被掃方收到通知
    if (ModeManager.isDemo() && typeof this._simulateAttendanceNotify === 'function') {
      this._simulateAttendanceNotify(eventId, mode);
    }
  },

});
