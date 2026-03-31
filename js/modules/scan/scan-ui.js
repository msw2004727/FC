/* ================================================
   SportHub — Scan: UI Rendering
   Split from scan.js — event categorization,
   select population, scan results & attendance
   section rendering.
   All innerHTML assignments use escapeHTML() for
   XSS safety, per project convention (CLAUDE.md).
   ================================================ */

Object.assign(App, {

  /** 取得活動類型前綴標籤 */
  _getScanEventTypeLabel(e) {
    if (!e || !e.type) return '';
    const cfg = (typeof TYPE_CONFIG !== 'undefined') ? TYPE_CONFIG[e.type] : null;
    return cfg ? `[${cfg.label}] ` : '';
  },

  /** 將事件分入 today / past / future 三個 bucket */
  _categorizeScanEvents(events) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrowStart = new Date(todayStart.getTime() + 86400000);

    const buckets = { today: [], past: [], future: [] };
    events.forEach(e => {
      const parsed = this._parseEventStartDate ? this._parseEventStartDate(e.date) : null;
      if (!parsed) { buckets.past.push(e); return; }
      const eventDay = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
      if (eventDay >= todayStart && eventDay < tomorrowStart) {
        buckets.today.push(e);
      } else if (eventDay < todayStart) {
        buckets.past.push(e);
      } else {
        buckets.future.push(e);
      }
    });

    // Sort: today = ascending, past = descending, future = ascending
    const cmpAsc = (a, b) => (a.date || '').localeCompare(b.date || '');
    const cmpDesc = (a, b) => (b.date || '').localeCompare(a.date || '');
    buckets.today.sort(cmpAsc);
    buckets.past.sort(cmpDesc);
    buckets.future.sort(cmpAsc);

    return buckets;
  },

  /** 更新 tab 上的事件數量文字 */
  _updateScanDateTabCounts() {
    const buckets = this._scanEventBuckets;
    if (!buckets) return;
    const labels = { today: '今日', past: '過期', future: '未來' };
    const container = document.getElementById('scan-date-filter');
    if (!container) return;
    container.querySelectorAll('.scan-date-tab').forEach(btn => {
      const key = btn.dataset.scanDate;
      if (key && labels[key] != null) {
        btn.textContent = `${labels[key]} (${buckets[key].length})`;
      }
    });
  },

  /** 依當前 tab 填充 select 選項 */
  _populateScanSelect() {
    const select = document.getElementById('scan-event-select');
    if (!select) return;
    const buckets = this._scanEventBuckets;
    const list = buckets ? (buckets[this._scanDateFilter] || []) : [];

    select.innerHTML = '<option value="">— 請選擇活動 —</option>';
    list.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.id;
      const typeLabel = this._getScanEventTypeLabel(e);
      opt.textContent = `${typeLabel}${e.title}（${e.date}）`;
      select.appendChild(opt);
    });

    // Restore previous selection if still in list
    if (this._scanSelectedEventId && list.some(e => e.id === this._scanSelectedEventId)) {
      select.value = this._scanSelectedEventId;
    } else if (list.length === 1) {
      // Auto-select if only 1 event
      select.value = list[0].id;
      this._scanSelectedEventId = list[0].id;
    } else {
      this._scanSelectedEventId = null;
      select.value = '';
    }
  },

  /** 切換日期 tab 時呼叫 */
  _applyScanDateFilter(tabKey) {
    this._scanDateFilter = tabKey;
    const container = document.getElementById('scan-date-filter');
    if (container) {
      container.querySelectorAll('.scan-date-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.scanDate === tabKey);
      });
    }
    this._populateScanSelect();
    this._updateScanControls();
    this._renderScanResults();
    this._renderAttendanceSections();
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

    // Date filter tabs
    const dateFilter = document.getElementById('scan-date-filter');
    if (dateFilter && !dateFilter.dataset.bound) {
      dateFilter.dataset.bound = '1';
      dateFilter.addEventListener('click', (ev) => {
        const tab = ev.target.closest('.scan-date-tab');
        if (!tab || !tab.dataset.scanDate) return;
        this._applyScanDateFilter(tab.dataset.scanDate);
      });
    }
  },

  _updateScanControls() {
    const hasEvent = !!this._scanSelectedEventId;
    const cameraBtn = document.getElementById('scan-camera-btn');
    if (cameraBtn) cameraBtn.disabled = !hasEvent;
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
      return `<div class="scan-result ${cls}" data-no-translate>${escapeHTML(msg)}</div>`;
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
    // 使用 event.current（文件欄位，由 transaction 維護）作為可靠的正取總人數
    const confirmedTotalFromDoc = Number(event.current || 0);

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
      return `<span class="${tagCls}" data-no-translate>${escapeHTML(person.name)}${suffix}${checksHtml}</span>`;
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
    regByUid.forEach(p => regTags.push(p));
    regTags.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const regTagsHtml = regTags.map(p => buildTag(p, false));

    // 未報名
    unregPersons.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const unregTags = unregPersons.map(p => buildTag(p, true));

    // 統計（僅計已報名者）
    const regCheckinCount = [...personMap.values()].filter(p => p.checkin && !p.unreg).length;
    const regCheckoutCount = [...personMap.values()].filter(p => p.checkout && !p.unreg).length;

    regDiv.innerHTML = `<div class="scan-section scan-section-registered">
      <h4>已報名（${regByUid.size}）</h4>
      <div class="scan-user-tags">${regTagsHtml.length ? regTagsHtml.join('') : '<span style="font-size:.78rem;color:var(--text-muted)">尚無</span>'}</div>
    </div>`;

    unregDiv.innerHTML = unregTags.length ? `<div class="scan-section scan-section-unreg">
      <h4>未報名（${unregPersons.length}）</h4>
      <div class="scan-user-tags">${unregTags.join('')}</div>
    </div>` : '';

    // Stats
    const totalConfirmed = confirmedTotalFromDoc > 0 ? confirmedTotalFromDoc : (confirmedRegs.length > 0 ? confirmedRegs.length : (event.participants || []).length);
    const completionRate = totalConfirmed > 0 ? Math.round(regCheckinCount / totalConfirmed * 100) : 0;

    statsDiv.innerHTML = `
      <span>報名：<strong>${totalConfirmed}</strong></span>
      <span>已簽到：<strong>${regCheckinCount}</strong></span>
      <span>已簽退：<strong>${regCheckoutCount}</strong></span>
      <span>未報名：<strong>${unregPersons.length}</strong></span>
      <span>出席率：<strong>${completionRate}%</strong></span>
    `;
  },

});
