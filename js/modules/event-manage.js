/* ================================================
   SportHub — Event: My Activity Management (Coach+)
   依賴：event-list.js (helpers)
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  My Activities (Coach+)
  // ══════════════════════════════════

  _myActivityFilter: 'all',
  _myActivityCreatorFilter: '',
  _manualEditingUid: null,
  _manualEditingEventId: null,
  _attendanceSubmittingEventId: null,
  _attendancePendingStateByUid: null,
  _unregSubmittingEventId: null,
  _unregPendingStateByUid: null,
  _eventPinCounter: 100,
  _cancelActivityBusyMap: Object.create(null),

  _normalizeAttendanceSelection(state) {
    const normalized = {
      checkin: !!state?.checkin,
      checkout: !!state?.checkout,
      note: typeof state?.note === 'string' ? state.note : '',
    };
    if (normalized.checkout) normalized.checkin = true;
    return normalized;
  },

  _bindAttendanceCheckboxLink(container, checkinPrefix, checkoutPrefix) {
    if (!container || container.dataset.attendanceLinkBound === '1') return;
    container.dataset.attendanceLinkBound = '1';
    container.addEventListener('change', (e) => {
      const target = e.target;
      if (!target || target.tagName !== 'INPUT' || target.type !== 'checkbox' || target.disabled) return;

      const targetId = String(target.id || '');
      const isCheckin = targetId.startsWith(checkinPrefix);
      const isCheckout = targetId.startsWith(checkoutPrefix);
      if (!isCheckin && !isCheckout) return;

      const uid = targetId.slice((isCheckin ? checkinPrefix : checkoutPrefix).length);
      const checkinBox = document.getElementById(checkinPrefix + uid);
      const checkoutBox = document.getElementById(checkoutPrefix + uid);
      if (!checkinBox || !checkoutBox) return;

      if (isCheckout && checkoutBox.checked) {
        checkinBox.checked = true;
      } else if (isCheckin && !checkinBox.checked && checkoutBox.checked) {
        checkoutBox.checked = false;
      }
    });
  },

  _nextEventPinOrder() {
    const maxExisting = (ApiService.getEvents?.() || []).reduce((max, e) => {
      const n = Number(e?.pinOrder) || 0;
      return n > max ? n : max;
    }, 0);
    this._eventPinCounter = Math.max(this._eventPinCounter || 0, maxExisting) + 1;
    return this._eventPinCounter;
  },

  _sortMyActivitiesByNearestTime(events) {
    const nowMs = Date.now();
    const getStartMs = (e) => {
      const d = this._parseEventStartDate ? this._parseEventStartDate(e?.date) : null;
      const ms = d instanceof Date ? d.getTime() : NaN;
      return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
    };
    const isTerminal = (e) => e?.status === 'ended' || e?.status === 'cancelled';

    return [...events].sort((a, b) => {
      const ta = isTerminal(a) ? 1 : 0;
      const tb = isTerminal(b) ? 1 : 0;
      if (ta !== tb) return ta - tb; // 已結束/取消排最後

      const aMs = getStartMs(a);
      const bMs = getStartMs(b);
      const aDist = Math.abs(aMs - nowMs);
      const bDist = Math.abs(bMs - nowMs);
      if (aDist !== bDist) return aDist - bDist; // 距離現在越近越前面

      if (aMs !== bMs) return aMs - bMs;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
  },

  async _ensureActivityRecordsReady({ required = false } = {}) {
    if (ModeManager.isDemo()) return true;
    if (typeof FirebaseService === 'undefined' || typeof FirebaseService.ensureStaticCollectionsLoaded !== 'function') {
      return true;
    }
    try {
      const ready = await FirebaseService.ensureStaticCollectionsLoaded(['activityRecords']);
      const ok = ready.includes('activityRecords');
      if (!ok && required) this.showToast('活動紀錄載入失敗，請稍後再試');
      return ok;
    } catch (err) {
      console.warn('[event-manage] ensure activityRecords failed:', err);
      if (required) this.showToast('活動紀錄載入失敗，請稍後再試');
      return false;
    }
  },

  _collectEventNotifyRecipientUids(event, eventId) {
    const notifyUids = new Set();
    if (!eventId) return notifyUids;

    const regs = ApiService.getRegistrationsByEvent(eventId) || [];
    regs.forEach(r => {
      if (r?.userId) notifyUids.add(r.userId);
    });

    const allNames = [...(event?.participants || []), ...(event?.waitlistNames || [])];
    if (!allNames.length) return notifyUids;

    const nameToUid = new Map();
    (ApiService.getAdminUsers() || []).forEach(u => {
      if (!u?.name || !u?.uid) return;
      if (!nameToUid.has(u.name)) nameToUid.set(u.name, u.uid);
    });
    allNames.forEach(name => {
      const uid = nameToUid.get(name);
      if (uid) notifyUids.add(uid);
    });
    return notifyUids;
  },

  _getRegistrationParticipantName(registration) {
    if (!registration) return '';
    const rawName = registration.participantType === 'companion'
      ? (registration.companionName || registration.userName)
      : registration.userName;
    return String(rawName || '').trim();
  },

  _getConfirmedParticipantNameSet(eventId, eventData = null, allRegs = null) {
    const names = new Set();
    const event = eventData || ApiService.getEvent(eventId);
    const sourceRegs = Array.isArray(allRegs) ? allRegs : (ApiService.getRegistrationsByEvent(eventId) || []);

    (event?.participants || []).forEach(name => {
      const safeName = String(name || '').trim();
      if (safeName) names.add(safeName);
    });

    sourceRegs.forEach(reg => {
      if (reg?.status !== 'confirmed') return;
      const safeName = this._getRegistrationParticipantName(reg);
      if (safeName) names.add(safeName);
    });

    return names;
  },

  _getWaitlistFallbackNames(eventId, eventData = null, allRegs = null) {
    const event = eventData || ApiService.getEvent(eventId);
    if (!event) return [];

    const confirmedNames = this._getConfirmedParticipantNameSet(eventId, event, allRegs);
    const fallbackNames = [];
    const seen = new Set();

    (event.waitlistNames || []).forEach(name => {
      const safeName = String(name || '').trim();
      if (!safeName || seen.has(safeName) || confirmedNames.has(safeName)) return;
      seen.add(safeName);
      fallbackNames.push(safeName);
    });

    return fallbackNames;
  },

  _getEventWaitlistDisplayCount(eventId, eventData = null, allRegs = null) {
    const sourceRegs = Array.isArray(allRegs) ? allRegs : (ApiService.getRegistrationsByEvent(eventId) || []);
    const waitlistNames = new Set();

    sourceRegs.forEach(reg => {
      if (reg?.status !== 'waitlisted') return;
      const safeName = this._getRegistrationParticipantName(reg);
      if (safeName) waitlistNames.add(safeName);
    });

    this._getWaitlistFallbackNames(eventId, eventData, sourceRegs).forEach(name => waitlistNames.add(name));
    return waitlistNames.size;
  },

  switchMyActivityTab(filter) {
    this._myActivityFilter = filter || 'all';
    document.querySelectorAll('#my-activity-tabs .tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.afilter === this._myActivityFilter);
    });
    this.renderMyActivities(this._myActivityFilter);
  },

  renderMyActivities(filter) {
    this._autoEndExpiredEvents();
    const container = document.getElementById('my-activity-list');
    if (!container) return;
    const f = filter || this._myActivityFilter || 'all';
    this._myActivityFilter = f;

    const myLevel = ROLE_LEVEL_MAP[this.currentRole] || 0;
    const isAdmin = myLevel >= ROLE_LEVEL_MAP.admin;

    // 場主(含)以下只看自己的活動或受委託的活動
    let allEvents = ApiService.getEvents();
    if (!isAdmin) {
      allEvents = allEvents.filter(e => this._isEventOwner(e) || this._isEventDelegate(e));
    }

    // 管理員主辦人篩選
    const creatorWrap = document.getElementById('my-activity-creator-wrap');
    if (creatorWrap) creatorWrap.style.display = isAdmin ? '' : 'none';
    const creatorInput = document.getElementById('my-activity-creator-input');
    const creatorClear = document.getElementById('my-activity-creator-clear');
    const creatorFilter = this._myActivityCreatorFilter;
    if (creatorInput && creatorFilter) creatorInput.value = creatorFilter;
    if (creatorClear) creatorClear.style.display = creatorFilter ? '' : 'none';
    if (creatorFilter) {
      allEvents = allEvents.filter(e => e.creator === creatorFilter);
    }

    const rawFiltered = f === 'all' ? allEvents : allEvents.filter(e => e.status === f);
    const filtered = this._sortMyActivitiesByNearestTime(rawFiltered).sort((a, b) => {
      const ap = a?.pinned ? 1 : 0;
      const bp = b?.pinned ? 1 : 0;
      if (ap !== bp) return bp - ap;
      if (ap && bp) {
        const ao = Number(a?.pinOrder) || 0;
        const bo = Number(b?.pinOrder) || 0;
        if (ao !== bo) return ao - bo;
      }
      return 0;
    });

    // 同步 tab active 狀態
    const tabsEl = document.getElementById('my-activity-tabs');
    if (tabsEl) {
      tabsEl.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('active', t.dataset.afilter === f);
      });
    }

    // 統計（單次 reduce 取代 5 次 filter）
    const statsEl = document.getElementById('my-activity-stats');
    if (statsEl) {
      const counts = allEvents.reduce((acc, e) => {
        acc[e.status] = (acc[e.status] || 0) + 1;
        return acc;
      }, {});
      const upcomingCount = counts.upcoming || 0;
      const openCount = counts.open || 0;
      const fullCount = counts.full || 0;
      const endedCount = counts.ended || 0;
      const cancelledCount = counts.cancelled || 0;
      statsEl.textContent = `共 ${allEvents.length} 場${upcomingCount ? ' ・ 即將開放 ' + upcomingCount : ''} ・ 報名中 ${openCount} ・ 已額滿 ${fullCount} ・ 已結束 ${endedCount} ・ 已取消 ${cancelledCount}`;
    }

    // 預計算簽退次數 Map（避免每筆活動重新 filter 全部出席紀錄）
    const isSuperAdmin = (ROLE_LEVEL_MAP[this.currentRole] || 0) >= ROLE_LEVEL_MAP.super_admin;
    const checkoutCountMap = new Map();
    const unregCountMap = new Map();
    if (isSuperAdmin) {
      const unregSets = new Map();
      ApiService.getAttendanceRecords().forEach(r => {
        if (r.type === 'checkout') {
          checkoutCountMap.set(r.eventId, (checkoutCountMap.get(r.eventId) || 0) + 1);
        }
        if (r.type === 'unreg') {
          if (!unregSets.has(r.eventId)) unregSets.set(r.eventId, new Set());
          unregSets.get(r.eventId).add(r.uid);
        }
      });
      unregSets.forEach((s, eid) => unregCountMap.set(eid, s.size));
    }

    const s = 'font-size:.72rem;padding:.2rem .5rem';
    container.innerHTML = filtered.length > 0
      ? filtered.map(e => {
        const statusConf = STATUS_CONFIG[e.status] || STATUS_CONFIG.open;
        const canManage = this._canManageEvent(e);
        let btns = '';
        const pinBtn = canManage
          ? `<button class="outline-btn" style="${s}" onclick="App.toggleMyActivityPin('${e.id}')">${e.pinned ? '取消置頂' : '置頂'}</button>`
          : '';
        if (canManage) {
          if (e.status === 'upcoming') {
            btns = `<button class="primary-btn small" style="${s}" onclick="App.showMyActivityDetail('${e.id}')">查看名單</button>`
                 + `<button class="outline-btn" style="${s}" onclick="App.editMyActivity('${e.id}')">編輯</button>`
                 + `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.cancelMyActivity('${e.id}')">取消</button>`;
          } else if (e.status === 'open' || e.status === 'full') {
            btns = `<button class="primary-btn small" style="${s}" onclick="App.showMyActivityDetail('${e.id}')">查看名單</button>`
                 + `<button class="outline-btn" style="${s}" onclick="App.editMyActivity('${e.id}')">編輯</button>`
                 + `<button class="outline-btn" style="${s};color:var(--warning)" onclick="App.closeMyActivity('${e.id}')">結束</button>`
                 + `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.cancelMyActivity('${e.id}')">取消</button>`;
          } else if (e.status === 'ended') {
            btns = `<button class="primary-btn small" style="${s}" onclick="App.showMyActivityDetail('${e.id}')">查看名單</button>`
                 + `<button class="outline-btn" style="${s}" onclick="App.editMyActivity('${e.id}')">編輯</button>`
                 + `<button class="outline-btn" style="${s};color:var(--success)" onclick="App.relistMyActivity('${e.id}')">上架</button>`
                 + (isAdmin ? `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.deleteMyActivity('${e.id}')">刪除</button>` : '');
          } else if (e.status === 'cancelled') {
            btns = `<button class="primary-btn small" style="${s}" onclick="App.showMyActivityDetail('${e.id}')">查看名單</button>`
                 + `<button class="outline-btn" style="${s};color:var(--success)" onclick="App.reopenMyActivity('${e.id}')">重新開放</button>`
                 + (isAdmin ? `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.deleteMyActivity('${e.id}')">刪除</button>` : '');
          }
        } else {
          btns = `<button class="primary-btn small" style="${s}" onclick="App.showMyActivityDetail('${e.id}')">查看名單</button>`;
        }
        if (canManage && pinBtn && btns) {
          const firstBtnEnd = btns.indexOf('</button>');
          if (firstBtnEnd >= 0) {
            btns = btns.slice(0, firstBtnEnd + 9) + pinBtn + btns.slice(firstBtnEnd + 9);
          }
        }
        const progressPct = e.max > 0 ? Math.min(100, Math.round(e.current / e.max * 100)) : 0;
        const progressColor = progressPct >= 100 ? 'var(--danger)' : progressPct >= 70 ? 'var(--warning)' : 'var(--success)';
        const teamBadge = e.teamOnly ? '<span class="tl-teamonly-badge" style="margin-left:.3rem">限定</span>' : '';
        const sportIcon = this._renderEventSportIcon(e, 'my-event-sport-icon');
        // Fee summary
        const feeEnabled = this._isEventFeeEnabled?.(e) ?? Number(e?.fee || 0) > 0;
        const fee = this._getEventRecordedFeeAmount?.(e) ?? (Number(e?.fee || 0) > 0 ? Math.floor(Number(e.fee || 0)) : 0);
        const confirmedRegs = fee > 0 ? ApiService.getRegistrationsByEvent(e.id) : [];
        const confirmedCount = confirmedRegs.length > 0 ? confirmedRegs.length : (e.current || 0);
        const unregCount = fee > 0 ? (unregCountMap.get(e.id) || 0) : 0;
        const checkoutCount = fee > 0 ? (checkoutCountMap.get(e.id) || 0) : 0;
        const feeExpected = fee * (confirmedCount + unregCount);
        const feeActual = fee * checkoutCount;
        const feeShort = feeExpected - feeActual;
        const feeBox = (fee > 0 && isSuperAdmin) ? `<div style="margin-left:auto;padding:.2rem .45rem;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:.68rem;color:var(--text-secondary);display:inline-flex;gap:.5rem;background:var(--bg-elevated);white-space:nowrap">
          <span>應收<b style="color:var(--text-primary)">$${feeExpected}</b></span>
          <span>實收<b style="color:var(--success)">$${feeActual}</b></span>
          <span>短收<b style="color:${feeShort > 0 ? 'var(--danger)' : 'var(--success)'}">$${feeShort}</b></span>
        </div>` : '';
        const pinCardStyle = e.pinned
          ? ';border:1px solid var(--warning);box-shadow:0 0 0 1px rgba(245,158,11,.15)'
          : '';
        const pinBadge = e.pinned
          ? '<span style="font-size:.68rem;color:var(--warning);font-weight:700;border:1px solid var(--warning);border-radius:999px;padding:.05rem .35rem">置頂</span>'
          : '';
        return `
      <div class="msg-manage-card" style="margin-bottom:.5rem;cursor:pointer${pinCardStyle}" onclick="if(!event.target.closest('button')&&!event.target.closest('.user-capsule'))App.showEventDetail('${e.id}')">
        <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.2rem">
          <span class="msg-manage-title" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(e.title)}${teamBadge}</span>
          ${pinBadge}
          ${this._userTag(e.creator, ApiService.getUserRole(e.creator))}
          <span class="banner-manage-status status-${statusConf.css}">${statusConf.label}</span>
        </div>
        <div style="font-size:.75rem;color:var(--text-muted)">${escapeHTML(e.location)} ・ ${escapeHTML(e.date)}</div>
        <div style="display:flex;align-items:center;gap:.5rem;margin-top:.3rem">
          <div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden">
            <div style="width:${progressPct}%;height:100%;background:${progressColor};border-radius:3px;transition:width .3s"></div>
          </div>
          <span style="font-size:.72rem;color:var(--text-muted);white-space:nowrap">${e.current}/${e.max} 人${e.waitlist > 0 ? ' ・ 候補 ' + e.waitlist : ''}</span>
        </div>
        <div style="display:flex;gap:.3rem;margin-top:.4rem;flex-wrap:wrap;align-items:center">${sportIcon}${btns}${feeBox}</div>
      </div>`;
      }).join('')
      : '<div style="padding:1rem;font-size:.82rem;color:var(--text-muted);text-align:center">此分類沒有活動</div>';

  },

  // ── 活動置頂 ──
  toggleMyActivityPin(id) {
    const e = ApiService.getEvent(id);
    if (!e) return;
    if (!this._canManageEvent(e)) { this.showToast('您只能管理自己的活動'); return; }

    const nextPinned = !e.pinned;
    const updates = nextPinned
      ? { pinned: true, pinOrder: this._nextEventPinOrder() }
      : { pinned: false, pinOrder: 0 };

    e.pinned = updates.pinned;
    e.pinOrder = updates.pinOrder;
    ApiService.updateEvent(id, updates);

    this.renderMyActivities();
    this.renderActivityList();
    this.renderHotEvents();
    this.showToast(nextPinned ? `已置頂「${e.title}」` : `已取消置頂「${e.title}」`);
  },

  // ── 查看活動名單 ──
  showMyActivityDetail(id) {
    const e = ApiService.getEvent(id);
    if (!e) return;
    const modal = document.getElementById('my-activity-detail-modal');
    const content = document.getElementById('my-activity-detail-content');
    if (!modal || !content) return;
    const statusConf = STATUS_CONFIG[e.status] || STATUS_CONFIG.open;

    // ── 取得簽到/簽退/未報名紀錄 ──
    const records = ApiService.getAttendanceRecords(id);
    const checkinUsers = new Map();
    const checkoutUsers = new Map();
    const unregUsers = new Map();
    records.forEach(r => {
      if (r.type === 'checkin' && !checkinUsers.has(r.uid))
        checkinUsers.set(r.uid, { name: r.userName, time: r.time });
      if (r.type === 'checkout' && !checkoutUsers.has(r.uid))
        checkoutUsers.set(r.uid, { name: r.userName, time: r.time });
      if (r.type === 'unreg' && !unregUsers.has(r.uid))
        unregUsers.set(r.uid, { name: r.userName, time: r.time });
    });

    // ── 簽到/簽退/未報名紀錄 helper ──
    const recRow = (v) =>
      `<div style="display:flex;align-items:center;gap:.4rem;padding:.25rem 0;border-bottom:1px solid var(--border)">
        <span style="font-size:.82rem;flex:1">${escapeHTML(v.name)}</span>
        <span style="font-size:.68rem;color:var(--text-muted)">${escapeHTML(v.time || '')}</span>
      </div>`;

    const checkinList = [];
    checkinUsers.forEach(v => checkinList.push(v));
    const checkoutList = [];
    checkoutUsers.forEach(v => checkoutList.push(v));
    const unregList = [];
    unregUsers.forEach(v => unregList.push(v));

    const checkinSection = checkinList.length
      ? `<div style="font-size:.85rem;font-weight:700;margin:.6rem 0 .3rem">📍 簽到紀錄（${checkinList.length}）</div>${checkinList.map(recRow).join('')}`
      : '';
    const checkoutSection = checkoutList.length
      ? `<div style="font-size:.85rem;font-weight:700;margin:.6rem 0 .3rem">✅ 簽退紀錄（${checkoutList.length}）</div>${checkoutList.map(recRow).join('')}`
      : '';
    const unregSection = unregList.length
      ? `<div style="font-size:.85rem;font-weight:700;margin:.6rem 0 .3rem;color:var(--danger)">⚠️ 未報名掃碼（${unregList.length}）</div>${unregList.map(recRow).join('')}`
      : '';

    // ── 費用摘要（計費來源：報名記錄 + 未報名簽到）──
    const feeEnabled = this._isEventFeeEnabled?.(e) ?? Number(e?.fee || 0) > 0;
    const fee = this._getEventRecordedFeeAmount?.(e) ?? (Number(e?.fee || 0) > 0 ? Math.floor(Number(e.fee || 0)) : 0);
    const confirmedRegsDetail = fee > 0 ? ApiService.getRegistrationsByEvent(e.id) : [];
    const confirmedCountDetail = confirmedRegsDetail.length > 0 ? confirmedRegsDetail.length : (e.current || 0);
    const unregCountDetail = fee > 0 ? new Set(records.filter(r => r.type === 'unreg').map(r => r.uid)).size : 0;
    const feeExpected = fee * (confirmedCountDetail + unregCountDetail);
    const feeActual = fee * (fee > 0 ? ApiService.getAttendanceRecords(e.id).filter(r => r.type === 'checkout').length : 0);
    const feeShort = feeExpected - feeActual;
    const isSuperAdmin = (ROLE_LEVEL_MAP[this.currentRole] || 0) >= ROLE_LEVEL_MAP.super_admin;
    const feeSection = (fee > 0 && isSuperAdmin)
      ? `<div style="margin:.6rem 0 .2rem;padding:.4rem .6rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-elevated);font-size:.78rem;display:flex;gap:.8rem;flex-wrap:wrap">
          <span>應收 <b style="color:var(--text-primary)">$${feeExpected}</b></span>
          <span>實收 <b style="color:var(--success)">$${feeActual}</b></span>
          <span>短收 <b style="color:${feeShort > 0 ? 'var(--danger)' : 'var(--success)'}">$${feeShort}</b></span>
        </div>`
      : '';

    const metaParts = [];
    if (feeEnabled || fee > 0) metaParts.push(`費用：${fee > 0 ? 'NT$' + fee : '免費'}`);
    metaParts.push(`狀態：${statusConf.label}`);
    metaParts.push(`主辦：${escapeHTML(e.creator)}`);

    content.innerHTML = `
      <h3 style="margin:0 0 .4rem;font-size:1rem">${escapeHTML(e.title)}</h3>
      <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:.6rem">
        <div>${escapeHTML(e.location)} ・ ${escapeHTML(e.date)}</div>
        <div>${metaParts.join(' ・ ')}</div>
      </div>
      <div id="attendance-table-container"></div>
      <div id="waitlist-table-container"></div>
      ${checkinSection}
      ${checkoutSection}
      ${unregSection}
      ${feeSection}
    `;
    this._renderAttendanceTable(e.id);
    this._renderWaitlistSection(e.id, 'waitlist-table-container');
    modal.style.display = 'flex';
  },

  // ── 候補名單表格（管理模態 - 分組顯示 + 正取編輯模式）──
  _renderWaitlistSection(eventId, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const e = ApiService.getEvent(eventId);
    if (!e) { container.innerHTML = ''; return; }

    const canManage = this._canManageEvent(e);
    const tableEditing = this._waitlistEditingEventId === eventId;
    const allActiveRegs = ApiService.getRegistrationsByEvent(eventId);
    const waitlistedRegs = allActiveRegs.filter(r => r.status === 'waitlisted');
    const addedNames = new Set();
    let items = [];

    if (waitlistedRegs.length > 0) {
      const groups = new Map();
      waitlistedRegs.forEach(r => {
        if (!groups.has(r.userId)) groups.set(r.userId, []);
        groups.get(r.userId).push(r);
      });
      groups.forEach((regs, userId) => {
        const selfReg = regs.find(r => r.participantType === 'self');
        const companions = regs.filter(r => r.participantType === 'companion');
        const mainName = selfReg ? selfReg.userName : regs[0].userName;
        const companionItems = companions.map(c => {
          const cName = c.companionName || c.userName;
          const selfConfirmed = allActiveRegs.find(
            r => r.userId === userId && r.participantType === 'self' && r.status === 'confirmed'
          );
          return { name: cName, orphanInfo: selfConfirmed ? selfConfirmed.userName : null };
        });
        let selfOrphanInfo = null;
        if (!selfReg) {
          const selfConfirmed = allActiveRegs.find(
            r => r.userId === userId && r.participantType === 'self' && r.status === 'confirmed'
          );
          if (selfConfirmed) selfOrphanInfo = selfConfirmed.userName;
        }
        items.push({ name: mainName, userId, companions: companionItems, selfOrphanInfo });
        addedNames.add(mainName);
        companionItems.forEach(c => addedNames.add(c.name));
      });
    }
    this._getWaitlistFallbackNames(eventId, e, allActiveRegs).forEach(p => {
      if (!addedNames.has(p)) {
        items.push({ name: p, userId: null, companions: [], selfOrphanInfo: null });
        addedNames.add(p);
      }
    });

    if (items.length === 0) { container.innerHTML = ''; return; }

    const totalCount = items.reduce((sum, it) => sum + 1 + it.companions.length, 0);
    const safeEId = escapeHTML(eventId);
    const safeCId = escapeHTML(containerId);
    const colCount = tableEditing ? 3 : 2;
    const doneBtnStyle = 'font-size:.72rem;padding:.2rem .5rem;background:transparent;border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;color:var(--text-primary)';
    const editBtnStyle = 'font-size:.72rem;padding:.2rem .5rem;background:#8b5cf6;color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer';
    const editBtnHtml = canManage
      ? (tableEditing
          ? `<button style="${doneBtnStyle}" onclick="App._stopWaitlistEdit('${safeEId}','${safeCId}')">完成</button>`
          : `<button style="${editBtnStyle}" onclick="App._startWaitlistEdit('${safeEId}','${safeCId}')">編輯</button>`)
      : '';
    const promoteStyle = 'font-size:.72rem;padding:.2rem .45rem;background:#8b5cf6;color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer';

    let rows = '';
    items.forEach((item, idx) => {
      const safeUid = item.userId ? escapeHTML(item.userId) : '';
      const promoteTd = tableEditing
        ? (item.userId
            ? `<td style="padding:.35rem .3rem;text-align:center;width:3rem"><button style="${promoteStyle}" onclick="App._forcePromoteWaitlist('${safeEId}','${safeUid}')">正取</button></td>`
            : `<td></td>`)
        : '';
      rows += `<tr style="border-bottom:1px solid var(--border)">
        ${promoteTd}
        <td style="padding:.35rem .3rem;text-align:center;width:2rem"><span class="wl-pos">${idx + 1}</span></td>
        <td style="padding:.35rem .3rem;text-align:left">${this._userTag(item.name)}</td>
      </tr>`;
      if (item.selfOrphanInfo) {
        rows += `<tr><td colspan="${colCount - 1}"></td><td style="padding:.1rem .3rem;padding-left:1.2rem;font-size:.72rem;color:var(--text-muted)">↳ 報名人：${escapeHTML(item.selfOrphanInfo)}（<span style="color:var(--success)">已正取</span>）</td></tr>`;
      }
      item.companions.forEach(c => {
        const cName = typeof c === 'string' ? c : c.name;
        const orphan = typeof c === 'object' ? c.orphanInfo : null;
        rows += `<tr style="border-bottom:1px solid var(--border)">
          ${tableEditing ? '<td></td>' : ''}
          <td style="padding:.3rem .3rem"></td>
          <td style="padding:.3rem .3rem;text-align:left;padding-left:1.2rem"><span style="color:var(--text-secondary)">↳ ${escapeHTML(cName)}</span></td>
        </tr>`;
        if (orphan) {
          rows += `<tr><td colspan="${colCount - 1}"></td><td style="padding:.1rem .3rem;padding-left:1.8rem;font-size:.72rem;color:var(--text-muted)">↳ 報名人：${escapeHTML(orphan)}（<span style="color:var(--success)">已正取</span>）</td></tr>`;
        }
      });
    });

    const promoteTh = tableEditing
      ? `<th style="text-align:center;padding:.4rem .3rem;font-weight:600;width:3rem">正取</th>`
      : '';
    container.innerHTML = `
      <div style="font-size:.85rem;font-weight:700;margin:.6rem 0 .3rem;display:flex;align-items:center;gap:.5rem">
        <span>候補名單（${totalCount}）</span>${editBtnHtml}
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:.8rem">
          <thead><tr style="border-bottom:2px solid var(--border)">
            ${promoteTh}
            <th style="text-align:center;padding:.4rem .3rem;font-weight:600;width:2rem">#</th>
            <th style="text-align:left;padding:.4rem .3rem;font-weight:600">姓名</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  },

  _startWaitlistEdit(eventId, containerId) {
    this._waitlistEditingEventId = eventId;
    this._renderWaitlistSection(eventId, containerId);
  },

  _stopWaitlistEdit(eventId, containerId) {
    this._waitlistEditingEventId = null;
    this._renderWaitlistSection(eventId, containerId);
  },

  async _forcePromoteWaitlist(eventId, userId) {
    const e = ApiService.getEvent(eventId);
    if (!e) return;
    const allRegs = ApiService.getRegistrationsByEvent(eventId);
    const userWaitlisted = allRegs.filter(r => r.userId === userId && r.status === 'waitlisted');
    if (userWaitlisted.length === 0) { this.showToast('找不到候補紀錄'); return; }
    if (!await this._ensureActivityRecordsReady({ required: true })) return;

    // 容量檢查：正取後是否超額
    const currentConfirmed = allRegs.filter(r => r.status === 'confirmed').length;
    const afterCount = currentConfirmed + userWaitlisted.length;
    if (afterCount > (e.max || 0)) {
      const ok = await this.appConfirm(`正取後將超過名額上限（${afterCount}/${e.max}），確定要繼續嗎？`);
      if (!ok) return;
    }

    // 蒐集 activityRecord
    const arSource = ApiService._src('activityRecords');
    const arRecords = [];
    for (const reg of userWaitlisted) {
      if (reg.participantType !== 'companion') {
        const ar = arSource.find(a => a.eventId === eventId && a.uid === reg.userId && a.status === 'waitlisted');
        if (ar && ar._docId) arRecords.push(ar);
      }
    }

    // 先更新 registration status（本地快取）
    userWaitlisted.forEach(reg => { reg.status = 'confirmed'; });
    arRecords.forEach(record => { record.status = 'registered'; });

    // 用 _rebuildOccupancy 統一重建投影
    const activeAfter = (ApiService._src('registrations') || []).filter(
      r => r.eventId === eventId && (r.status === 'confirmed' || r.status === 'waitlisted')
    );
    let occupancy;
    if (typeof FirebaseService !== 'undefined' && typeof FirebaseService._rebuildOccupancy === 'function') {
      occupancy = FirebaseService._rebuildOccupancy(e, activeAfter);
    } else {
      // fallback
      const confirmed = activeAfter.filter(r => r.status === 'confirmed');
      const waitlisted = activeAfter.filter(r => r.status === 'waitlisted');
      occupancy = {
        participants: confirmed.map(r => this._getRegistrationParticipantName(r)).filter(Boolean),
        waitlistNames: waitlisted.map(r => this._getRegistrationParticipantName(r)).filter(Boolean),
        current: confirmed.length,
        waitlist: waitlisted.length,
        status: confirmed.length >= (e.max || 0) ? 'full' : 'open',
      };
    }

    if (!ModeManager.isDemo()) {
      try {
        const eventDocId = String(e._docId || '').trim();
        if (!eventDocId) throw new Error('EVENT_DOC_ID_MISSING');
        const batch = db.batch();
        for (const reg of userWaitlisted) {
          if (reg._docId) {
            batch.update(db.collection('registrations').doc(reg._docId), { status: 'confirmed' });
          }
        }
        [...new Set(arRecords.map(record => record._docId).filter(Boolean))].forEach(docId => {
          batch.update(db.collection('activityRecords').doc(docId), { status: 'registered' });
        });
        batch.update(db.collection('events').doc(eventDocId), {
          current: occupancy.current,
          waitlist: occupancy.waitlist,
          participants: occupancy.participants,
          waitlistNames: occupancy.waitlistNames,
          status: occupancy.status,
        });
        await batch.commit();
      } catch (err) {
        console.error('[forcePromote]', err);
        // rollback local changes
        userWaitlisted.forEach(reg => { reg.status = 'waitlisted'; });
        arRecords.forEach(record => { record.status = 'waitlisted'; });
        this.showToast('儲存失敗，請重試');
        return;
      }
    }

    // 套用投影到本地快取
    e.current = occupancy.current;
    e.waitlist = occupancy.waitlist;
    e.participants = occupancy.participants;
    e.waitlistNames = occupancy.waitlistNames;
    e.status = occupancy.status;

    if (!ModeManager.isDemo() && typeof FirebaseService !== 'undefined' && typeof FirebaseService._saveToLS === 'function') {
      FirebaseService._saveToLS('registrations', FirebaseService._cache.registrations);
      FirebaseService._saveToLS('activityRecords', FirebaseService._cache.activityRecords);
      FirebaseService._saveToLS('events', FirebaseService._cache.events);
    }

    const notifiedUsers = new Set();
    userWaitlisted.forEach(reg => {
      if (!reg?.userId || notifiedUsers.has(reg.userId)) return;
      notifiedUsers.add(reg.userId);
      this._sendNotifFromTemplate('waitlist_promoted', {
        eventName: e.title,
        date: e.date,
        location: e.location,
      }, reg.userId, 'activity', '活動');
    });

    // Re-render both possible containers (one will be absent = no-op)
    this._renderWaitlistSection(eventId, 'waitlist-table-container');
    this._renderGroupedWaitlistSection(eventId, 'detail-waitlist-container');
    // Re-render attendance tables
    this._renderAttendanceTable(eventId, this._manualEditingContainerId || 'attendance-table-container');
    this._renderAttendanceTable(eventId, 'detail-attendance-table');
    this.showToast('已正取');
  },

  // ── 出勤紀錄匹配：正確區分本人與同行者 ──
  _matchAttendanceRecord(record, person) {
    if (person.isCompanion) {
      return record.companionId && (record.companionId === person.uid || record.companionName === person.name);
    }
    return ((record.uid === person.uid || record.userName === person.name) && !record.companionId);
  },

  _attendanceRecordMs(record, fallbackOrder = 0) {
    if (!record) return fallbackOrder;

    const createdAt = record.createdAt;
    if (createdAt && typeof createdAt.toDate === 'function') {
      const ms = createdAt.toDate().getTime();
      if (Number.isFinite(ms)) return ms;
    }
    if (createdAt && typeof createdAt.seconds === 'number') {
      return createdAt.seconds * 1000 + Math.floor((createdAt.nanoseconds || 0) / 1e6);
    }
    if (typeof createdAt === 'string') {
      const ms = Date.parse(createdAt);
      if (Number.isFinite(ms)) return ms;
    }
    if (record.time) {
      const ms = Date.parse(String(record.time).replace(/\//g, '-'));
      if (Number.isFinite(ms)) return ms;
    }
    const id = String(record.id || '');
    const m = id.match(/(\d{10,13})/);
    if (m && Number.isFinite(Number(m[1]))) return Number(m[1]);
    return fallbackOrder;
  },

  _getLatestAttendanceRecord(records, person, type) {
    let latest = null;
    let latestMs = -Infinity;
    (records || []).forEach((r, idx) => {
      if (r?.type !== type) return;
      if (!this._matchAttendanceRecord(r, person)) return;
      const ms = this._attendanceRecordMs(r, idx);
      if (ms >= latestMs) {
        latestMs = ms;
        latest = r;
      }
    });
    return latest;
  },

  // ── 報名名單表格（活動管理 + 活動詳細頁共用）──
  _buildConfirmedParticipantSummary(eventId) {
    const e = ApiService.getEvent(eventId);
    if (!e) return { people: [], count: 0 };

    const allActiveRegs = ApiService.getRegistrationsByEvent(eventId);
    const confirmedRegs = allActiveRegs.filter(r => r.status === 'confirmed');
    const people = [];
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
        const proxyOnly = !selfReg;
        people.push({ name: mainName, uid: mainUid, isCompanion: false, displayName: mainName, hasSelfReg: !proxyOnly, proxyOnly });
        addedNames.add(mainName);
        companions.forEach(c => {
          const cName = c.companionName || c.userName;
          const cUid = c.companionId || (mainUid + '_' + c.companionName);
          people.push({ name: cName, uid: cUid, isCompanion: true, displayName: cName, hasSelfReg: false, proxyOnly: false });
          addedNames.add(cName);
        });
      });
    }

    (e.participants || []).forEach(p => {
      if (!addedNames.has(p)) {
        people.push({ name: p, uid: p, isCompanion: false, displayName: p, hasSelfReg: true, proxyOnly: false });
        addedNames.add(p);
      }
    });

    return { people, count: people.length };
  },

  _buildRawNoShowCountByUid() {
    const activityRecords = ApiService.getActivityRecords();
    const attendanceRecords = ApiService.getAttendanceRecords();
    const attendanceStateByKey = new Map();
    const countByUid = new Map();
    const seenActivityKeys = new Set();

    (attendanceRecords || []).forEach(record => {
      const uid = String(record?.uid || '').trim();
      const eventId = String(record?.eventId || '').trim();
      const type = String(record?.type || '').trim();
      const status = String(record?.status || '').trim();
      if (!uid || !eventId) return;
      if (status === 'removed' || status === 'cancelled') return;
      if (type !== 'checkin') return;

      const key = `${uid}::${eventId}`;
      const state = attendanceStateByKey.get(key) || { checkin: false };
      if (type === 'checkin') state.checkin = true;
      attendanceStateByKey.set(key, state);
    });

    (activityRecords || []).forEach(record => {
      const uid = String(record?.uid || '').trim();
      const eventId = String(record?.eventId || '').trim();
      const status = String(record?.status || '').trim();
      if (!uid || !eventId) return;
      if (status !== 'registered') return;

      const key = `${uid}::${eventId}`;
      if (seenActivityKeys.has(key)) return;
      seenActivityKeys.add(key);

      const event = ApiService.getEvent(eventId);
      if (!event || event.status !== 'ended') return;

      const attendance = attendanceStateByKey.get(key) || { checkin: false };
      if (attendance.checkin) return;

      countByUid.set(uid, (countByUid.get(uid) || 0) + 1);
    });

    return countByUid;
  },

  _getUserNoShowCorrection(uid) {
    const safeUid = String(uid || '').trim();
    if (!safeUid || typeof ApiService?.getUserCorrection !== 'function') return null;
    return ApiService.getUserCorrection(safeUid);
  },

  _getUserNoShowAdjustment(uid) {
    const adjustment = Number(this._getUserNoShowCorrection(uid)?.noShow?.adjustment || 0);
    return Number.isFinite(adjustment) ? Math.trunc(adjustment) : 0;
  },

  _buildNoShowCountByUid() {
    const rawCountByUid = this._buildRawNoShowCountByUid();
    const effectiveCountByUid = new Map(rawCountByUid);
    const corrections = typeof ApiService?.getUserCorrections === 'function'
      ? ApiService.getUserCorrections()
      : [];

    (corrections || []).forEach(doc => {
      const uid = String(doc?.uid || doc?._docId || '').trim();
      if (!uid) return;
      const adjustment = Number(doc?.noShow?.adjustment || 0);
      if (!Number.isFinite(adjustment) || adjustment === 0) return;
      const next = Math.max(0, (effectiveCountByUid.get(uid) || 0) + Math.trunc(adjustment));
      effectiveCountByUid.set(uid, next);
    });

    return effectiveCountByUid;
  },

  _getRawNoShowCount(uid) {
    const safeUid = String(uid || '').trim();
    if (!safeUid) return 0;
    return this._buildRawNoShowCountByUid().get(safeUid) || 0;
  },

  _getEffectiveNoShowCount(uid) {
    const safeUid = String(uid || '').trim();
    if (!safeUid) return 0;
    return this._buildNoShowCountByUid().get(safeUid) || 0;
  },

  _getParticipantNoShowCount(person, noShowCountByUid) {
    if (!person || person.isCompanion || !noShowCountByUid) return null;
    const directUid = String(person.uid || '').trim();
    const fallbackUid = String(this._findUserByName?.(person.name)?.uid || '').trim();
    const resolvedUid = (directUid && directUid !== person.name) ? directUid : fallbackUid;
    if (!resolvedUid) return null;
    return noShowCountByUid.get(resolvedUid) || 0;
  },

  _renderAttendanceTable(eventId, containerId) {
    const cId = containerId || 'attendance-table-container';
    const container = document.getElementById(cId);
    if (!container) return;
    // 記住 containerId，供編輯流程重新渲染用
    this._manualEditingContainerId = cId;
    const e = ApiService.getEvent(eventId);
    if (!e) return;

    const canManage = this._canManageEvent(e);
    const records = ApiService.getAttendanceRecords(eventId);
    const summary = this._buildConfirmedParticipantSummary(eventId);
    const people = summary.people;
    const showNoShowColumn = cId === 'detail-attendance-table';
    const noShowCountByUid = showNoShowColumn ? this._buildNoShowCountByUid() : null;

    if (people.length === 0) {
      container.innerHTML = '<div style="font-size:.8rem;color:var(--text-muted);padding:.3rem 0">尚無報名</div>';
      return;
    }

    // 整表編輯模式（手動簽到）
    const tableEditing = canManage && this._attendanceEditingEventId === eventId;
    const isSubmitting = canManage && this._attendanceSubmittingEventId === eventId;
    const pendingStateByUid = isSubmitting ? (this._attendancePendingStateByUid || Object.create(null)) : null;

    const kickStyle = 'font-size:.7rem;padding:.2rem .4rem;border:1px solid var(--danger);color:var(--danger);background:transparent;border-radius:var(--radius-sm);cursor:pointer;white-space:nowrap'
      + (isSubmitting ? ';opacity:.65;cursor:not-allowed' : '');
    const cbStyle = 'width:1.4rem;height:1.4rem;cursor:pointer;vertical-align:middle'
      + (isSubmitting ? ';opacity:.7;cursor:not-allowed' : '');
    const noteInputStyle = 'width:100%;font-size:.72rem;padding:.15rem .3rem;border:1px solid var(--border);border-radius:3px;box-sizing:border-box'
      + (isSubmitting ? ';opacity:.7;cursor:not-allowed' : '');
    const disabledAttr = isSubmitting ? 'disabled' : '';

    let rows = people.map(p => {
      const pendingState = pendingStateByUid ? pendingStateByUid[String(p.uid)] : null;
      const hasCheckin = pendingState
        ? !!pendingState.checkin
        : records.some(r => this._matchAttendanceRecord(r, p) && r.type === 'checkin');
      const hasCheckout = pendingState
        ? !!pendingState.checkout
        : records.some(r => this._matchAttendanceRecord(r, p) && r.type === 'checkout');
      const noteRec = this._getLatestAttendanceRecord(records, p, 'note');
      const noteText = pendingState ? (pendingState.note || '') : (noteRec?.note || '');
      const noShowCount = showNoShowColumn ? this._getParticipantNoShowCount(p, noShowCountByUid) : null;
      const noShowCell = showNoShowColumn
        ? `<td style="padding:.35rem .2rem;text-align:center;width:3rem"><span title="放鴿子次數（已結束、正式報名且未完成簽到）" style="font-size:.78rem;font-weight:${noShowCount > 0 ? '700' : '600'};color:${noShowCount > 0 ? 'var(--danger)' : 'var(--text-muted)'}">${noShowCount == null ? '—' : (noShowCount > 0 ? noShowCount : '')}</span></td>`
        : '';
      const autoNote = p.proxyOnly ? '僅代報' : '';
      const combinedNote = [autoNote, noteText].filter(Boolean).join('・');

      let nameHtml;
      if (p.isCompanion) {
        nameHtml = `<span style="padding-left:1.2rem;color:var(--text-secondary)">↳ ${escapeHTML(p.displayName)}</span>`;
      } else if (p.hasSelfReg) {
        nameHtml = this._userTag(p.displayName);
      } else {
        nameHtml = ` ${escapeHTML(p.displayName)}`;
      }

      const safeUid = escapeHTML(p.uid);
      const safeName = escapeHTML(p.name);

      if (tableEditing) {
        const kickTd = `<td style="padding:.35rem .2rem;text-align:center"><button style="${kickStyle}" ${disabledAttr} onclick="App._removeParticipant('${escapeHTML(eventId)}','${safeUid}','${safeName}',${p.isCompanion})">踢掉</button></td>`;
        return `<tr style="border-bottom:1px solid var(--border)">
          ${kickTd}
          <td style="padding:.35rem .3rem;text-align:left">${nameHtml}</td>
          ${noShowCell}
          <td style="padding:.35rem .2rem;text-align:center"><input type="checkbox" id="manual-checkin-${safeUid}" ${hasCheckin ? 'checked' : ''} ${disabledAttr} style="${cbStyle}"></td>
          <td style="padding:.35rem .2rem;text-align:center"><input type="checkbox" id="manual-checkout-${safeUid}" ${hasCheckout ? 'checked' : ''} ${disabledAttr} style="${cbStyle}"></td>
          <td style="padding:.35rem .3rem"><input type="text" maxlength="20" value="${escapeHTML(noteText)}" id="manual-note-${safeUid}" placeholder="備註" ${disabledAttr} style="${noteInputStyle}"></td>
        </tr>`;
      }
      return `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:.35rem .3rem;text-align:left">${nameHtml}</td>
        ${noShowCell}
        <td style="padding:.35rem .2rem;text-align:center">${hasCheckin ? '<span style="color:var(--success);font-size:1rem">✓</span>' : ''}</td>
        <td style="padding:.35rem .2rem;text-align:center">${hasCheckout ? '<span style="color:var(--success);font-size:1rem">✓</span>' : ''}</td>
        <td style="padding:.35rem .3rem;font-size:.72rem;color:var(--text-muted)">${escapeHTML(combinedNote)}</td>
      </tr>`;
    }).join('');

    // 手動簽到 / 完成簽到 按鈕（右上角，僅管理員）
    const topBtn = canManage ? (tableEditing
      ? `<button style="font-size:.75rem;padding:.25rem .6rem;background:#2e7d32;color:#fff;border:none;border-radius:var(--radius-sm);${isSubmitting ? 'cursor:not-allowed;opacity:.72' : 'cursor:pointer'}" ${isSubmitting ? 'disabled' : ''} onclick="App._confirmAllAttendance('${escapeHTML(eventId)}')">${isSubmitting ? '儲存中...' : '完成簽到'}</button>`
      : `<button style="font-size:.75rem;padding:.25rem .6rem;background:#1565c0;color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer" onclick="App._startTableEdit('${escapeHTML(eventId)}')">手動簽到</button>`
    ) : '';

    // 表頭：「報名名單（人數/上限）」欄含操作按鈕；編輯模式多「踢掉」欄
    const regCountText = `報名名單（${summary.count}/${e.max}）`;
    const nameThContent = topBtn
      ? `<div style="display:flex;align-items:center;gap:.4rem;white-space:nowrap">${regCountText}${topBtn}</div>`
      : regCountText;
    const noShowTh = showNoShowColumn
      ? `<th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:3rem" title="放鴿子次數（已結束、正式報名且未完成簽到）">🕊</th>`
      : '';
    const thead = tableEditing
      ? `<tr style="border-bottom:2px solid var(--border)">
          <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:3rem">踢掉</th>
          <th style="text-align:left;padding:.4rem .3rem;font-weight:600">${nameThContent}</th>
          ${noShowTh}
          <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2.5rem">簽到</th>
          <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2.5rem">簽退</th>
          <th style="text-align:left;padding:.4rem .3rem;font-weight:600">備註</th>
        </tr>`
      : `<tr style="border-bottom:2px solid var(--border)">
          <th style="text-align:left;padding:.4rem .3rem;font-weight:600">${nameThContent}</th>
          ${noShowTh}
          <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2.5rem">簽到</th>
          <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2.5rem">簽退</th>
          <th style="text-align:left;padding:.4rem .3rem;font-weight:600">備註</th>
        </tr>`;

    container.innerHTML = `<div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:.8rem">
        <thead>${thead}</thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
    this._bindAttendanceCheckboxLink(container, 'manual-checkin-', 'manual-checkout-');
  },

  // ── 未報名單表格（活動詳情頁用）──
  _renderUnregTable(eventId, containerId) {
    const cId = containerId || 'detail-unreg-table';
    const container = document.getElementById(cId);
    if (!container) return;
    const e = ApiService.getEvent(eventId);
    if (!e) return;

    const canManage = this._canManageEvent(e);
    const records = ApiService.getAttendanceRecords(eventId);

    // 收集不重複的未報名用戶
    const unregMap = new Map();
    records.forEach(r => {
      if (r.type === 'unreg' && !unregMap.has(r.uid))
        unregMap.set(r.uid, { name: r.userName, uid: r.uid });
    });

    const section = document.getElementById('detail-unreg-section');

    if (unregMap.size === 0) {
      if (section) section.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    if (section) section.style.display = '';

    const tableEditing = canManage && this._unregEditingEventId === eventId;
    const isSubmitting = canManage && this._unregSubmittingEventId === eventId;
    const pendingStateByUid = isSubmitting ? (this._unregPendingStateByUid || Object.create(null)) : null;
    const kickStyle = 'font-size:.7rem;padding:.2rem .4rem;border:1px solid var(--danger);color:var(--danger);background:transparent;border-radius:var(--radius-sm);cursor:pointer;white-space:nowrap'
      + (isSubmitting ? ';opacity:.65;cursor:not-allowed' : '');
    const cbStyle = 'width:1.4rem;height:1.4rem;cursor:pointer;vertical-align:middle'
      + (isSubmitting ? ';opacity:.7;cursor:not-allowed' : '');
    const noteInputStyle = 'width:100%;font-size:.72rem;padding:.15rem .3rem;border:1px solid var(--border);border-radius:3px;box-sizing:border-box'
      + (isSubmitting ? ';opacity:.7;cursor:not-allowed' : '');
    const disabledAttr = isSubmitting ? 'disabled' : '';

    const people = [];
    unregMap.forEach(u => people.push(u));

    let rows = people.map(p => {
      const person = { uid: p.uid, name: p.name, isCompanion: false };
      const pendingState = pendingStateByUid ? pendingStateByUid[String(p.uid)] : null;
      const hasCheckin = pendingState
        ? !!pendingState.checkin
        : records.some(r => this._matchAttendanceRecord(r, person) && r.type === 'checkin');
      const hasCheckout = pendingState
        ? !!pendingState.checkout
        : records.some(r => this._matchAttendanceRecord(r, person) && r.type === 'checkout');
      const noteRec = this._getLatestAttendanceRecord(records, person, 'note');
      const noteText = pendingState ? (pendingState.note || '') : (noteRec?.note || '');
      const combinedNote = ['未報名', noteText].filter(Boolean).join('・');
      const nameHtml = escapeHTML(p.name);
      const safeUid = escapeHTML(p.uid);
      const safeName = escapeHTML(p.name);

      if (tableEditing) {
        return `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:.35rem .2rem;text-align:center"><button style="${kickStyle}" ${disabledAttr} onclick="App._removeUnregUser('${escapeHTML(eventId)}','${safeUid}','${safeName}')">踢掉</button></td>
          <td style="padding:.35rem .3rem;text-align:left">${nameHtml}</td>
          <td style="padding:.35rem .2rem;text-align:center"><input type="checkbox" id="unreg-checkin-${safeUid}" ${hasCheckin ? 'checked' : ''} ${disabledAttr} style="${cbStyle}"></td>
          <td style="padding:.35rem .2rem;text-align:center"><input type="checkbox" id="unreg-checkout-${safeUid}" ${hasCheckout ? 'checked' : ''} ${disabledAttr} style="${cbStyle}"></td>
          <td style="padding:.35rem .3rem"><input type="text" maxlength="20" value="${escapeHTML(noteText)}" id="unreg-note-${safeUid}" placeholder="備註" ${disabledAttr} style="${noteInputStyle}"></td>
        </tr>`;
      }
      return `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:.35rem .3rem;text-align:left">${nameHtml}</td>
        <td style="padding:.35rem .2rem;text-align:center">${hasCheckin ? '<span style="color:var(--success);font-size:1rem">✓</span>' : ''}</td>
        <td style="padding:.35rem .2rem;text-align:center">${hasCheckout ? '<span style="color:var(--success);font-size:1rem">✓</span>' : ''}</td>
        <td style="padding:.35rem .3rem;font-size:.72rem;color:var(--text-muted)">${escapeHTML(combinedNote)}</td>
      </tr>`;
    }).join('');

    // 手動簽到 / 完成簽到 按鈕（放在表頭「未報名單」右側）
    const topBtn = canManage ? (tableEditing
      ? `<button style="font-size:.75rem;padding:.25rem .6rem;background:#2e7d32;color:#fff;border:none;border-radius:var(--radius-sm);${isSubmitting ? 'cursor:not-allowed;opacity:.72' : 'cursor:pointer'}" ${isSubmitting ? 'disabled' : ''} onclick="App._confirmAllUnregAttendance('${escapeHTML(eventId)}')">${isSubmitting ? '儲存中...' : '完成簽到'}</button>`
      : `<button style="font-size:.75rem;padding:.25rem .6rem;background:#1565c0;color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer" onclick="App._startUnregTableEdit('${escapeHTML(eventId)}')">手動簽到</button>`
    ) : '';

    const nameThContent = topBtn
      ? `<div style="display:flex;align-items:center;gap:.4rem;white-space:nowrap">未報名單（${people.length}）${topBtn}</div>`
      : `未報名單（${people.length}）`;

    const thead = tableEditing
      ? `<tr style="border-bottom:2px solid var(--border)">
          <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:3rem">踢掉</th>
          <th style="text-align:left;padding:.4rem .3rem;font-weight:600">${nameThContent}</th>
          <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2.5rem">簽到</th>
          <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2.5rem">簽退</th>
          <th style="text-align:left;padding:.4rem .3rem;font-weight:600">備註</th>
        </tr>`
      : `<tr style="border-bottom:2px solid var(--border)">
          <th style="text-align:left;padding:.4rem .3rem;font-weight:600">${nameThContent}</th>
          <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2.5rem">簽到</th>
          <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2.5rem">簽退</th>
          <th style="text-align:left;padding:.4rem .3rem;font-weight:600">備註</th>
        </tr>`;

    container.innerHTML = `<div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:.8rem">
        <thead>${thead}</thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
    this._bindAttendanceCheckboxLink(container, 'unreg-checkin-', 'unreg-checkout-');
  },

  // ── 整表手動簽到模式（報名名單用）──

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
    (e.participants || []).forEach(p => {
      if (!addedNames.has(p)) {
        people.push({ name: p, uid: p, isCompanion: false });
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
        const wanted = this._normalizeAttendanceSelection(desiredStateByUid[String(p.uid)]);
        if (!wanted) continue;

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
        const wanted = this._normalizeAttendanceSelection(desiredStateByUid[String(p.uid)]);
        if (!wanted) continue;

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

    this.showToast(errCount > 0 ? `儲存完成，但有 ${errCount} 筆失敗` : '儲存完成');
  },
  editMyActivity(id) {
    const e = ApiService.getEvent(id);
    if (!e) return;
    if (!this._canManageEvent(e)) { this.showToast('您只能編輯自己的活動'); return; }
    this._editEventId = id;
    // 確保事件已綁定（防止 Phase 1 非同步時機導致未綁定）
    this.bindImageUpload('ce-image', 'ce-upload-preview');
    this.bindTeamOnlyToggle();
    this.bindEventFeeToggle?.();
    this.bindGenderRestrictionToggle?.();
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
    // 開放報名時間
    this._setEventRegOpenTimeValue?.(e.regOpenTime || '');
    // 球隊限定
    const ceTeamOnly = document.getElementById('ce-team-only');
    if (ceTeamOnly) {
      ceTeamOnly.checked = !!e.teamOnly;
      // 編輯模式：若為球隊限定且建立者無球隊，需先填充下拉再還原選擇
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
  },

  // ── 結束活動 ──
  async closeMyActivity(id) {
    const e = ApiService.getEvent(id);
    if (e && !this._canManageEvent(e)) { this.showToast('您只能管理自己的活動'); return; }
    if (!await this.appConfirm('確定要結束此活動？')) return;
    ApiService.updateEvent(id, { status: 'ended' });
    ApiService._writeOpLog('event_end', '結束活動', `結束「${e.title}」`);
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

      // Trigger 4：活動取消通知 — 通知所有報名者與候補者
      const notifyUids = this._collectEventNotifyRecipientUids(e, id);
      notifyUids.forEach(uid => {
        this._sendNotifFromTemplate('event_cancelled', {
          eventName: e.title, date: e.date, location: e.location,
        }, uid, 'activity', '活動');
      });

      ApiService.updateEvent(id, { status: 'cancelled' });
      // 活動被取消 → 刪除所有個人取消紀錄
      await this._cleanupCancelledRecords(id);
      ApiService._writeOpLog('event_cancel', '取消活動', `取消「${e.title}」`);
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
    ApiService.updateEvent(id, { status: newStatus });
    ApiService._writeOpLog('event_reopen', '重開活動', `重開「${e.title}」`);
    this.renderMyActivities();
    this.renderActivityList();
    this.renderHotEvents();
    this.showToast('活動已重新開放');
  },

  // ── 重新上架（已結束 → open/full） ──
  async relistMyActivity(id) {
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
    ApiService.updateEvent(id, { status: newStatus });
    ApiService._writeOpLog('event_relist', '重新上架', `重新上架「${e.title}」`);

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

  // ── 主辦人模糊搜尋篩選（管理員+） ──
  searchCreatorFilter() {
    const input = document.getElementById('my-activity-creator-input');
    const dd = document.getElementById('my-activity-creator-dropdown');
    if (!input || !dd) return;
    const keyword = input.value.trim().toLowerCase();
    if (!keyword) {
      dd.classList.remove('open');
      if (this._myActivityCreatorFilter) {
        this._myActivityCreatorFilter = '';
        this.renderMyActivities();
      }
      return;
    }
    const allEvents = ApiService.getEvents();
    const creators = [...new Set(allEvents.map(e => e.creator).filter(Boolean))];
    const matched = creators.filter(c => c.toLowerCase().includes(keyword)).slice(0, 8);
    if (!matched.length) { dd.classList.remove('open'); return; }
    dd.innerHTML = matched.map(c => {
      const safeC = escapeHTML(c).replace(/'/g, "\\'");
      const count = allEvents.filter(e => e.creator === c).length;
      return `<div class="ce-delegate-item" onclick="App._selectCreatorFilter('${safeC}')"><span class="ce-delegate-item-name">${escapeHTML(c)}</span><span style="color:var(--text-muted);font-size:.68rem">${count} 場</span></div>`;
    }).join('');
    dd.classList.add('open');
  },

  _selectCreatorFilter(name) {
    const input = document.getElementById('my-activity-creator-input');
    const dd = document.getElementById('my-activity-creator-dropdown');
    if (input) input.value = name;
    if (dd) dd.classList.remove('open');
    this._myActivityCreatorFilter = name;
    this.renderMyActivities();
  },

  clearCreatorFilter() {
    const input = document.getElementById('my-activity-creator-input');
    if (input) input.value = '';
    this._myActivityCreatorFilter = '';
    this.renderMyActivities();
  },

  /** 清理某活動的所有個人取消紀錄（活動被刪除或取消時呼叫） */
  async _cleanupCancelledRecords(eventId) {
    if (!await this._ensureActivityRecordsReady()) return;
    const source = ApiService._src('activityRecords');
    for (let i = source.length - 1; i >= 0; i--) {
      if (source[i].eventId === eventId && source[i].status === 'cancelled') {
        if (!ModeManager.isDemo() && source[i]._docId) {
          db.collection('activityRecords').doc(source[i]._docId).delete()
            .catch(err => console.error('[cleanupCancelledRecords]', err));
        }
        source.splice(i, 1);
      }
    }
  },

  // ── 管理者移除參加者 ──
  async _removeParticipant(eventId, uid, name, isCompanion) {
    if (!await this.appConfirm(`確定要將 ${name} 從報名名單中移除嗎？`)) return;

    const event = ApiService.getEvent(eventId);
    if (!event) return;
    if (!isCompanion && !await this._ensureActivityRecordsReady({ required: true })) return;

    const allRegs = ApiService._src('registrations');
    const batch = (!ModeManager.isDemo() && typeof db !== 'undefined') ? db.batch() : null;

    // 找到對應的 registration
    let reg;
    if (isCompanion) {
      reg = allRegs.find(r => r.eventId === eventId && r.companionId === uid && r.status !== 'cancelled' && r.status !== 'removed');
    } else {
      reg = allRegs.find(r => r.eventId === eventId && r.userId === uid && r.participantType !== 'companion' && r.status !== 'cancelled' && r.status !== 'removed');
    }

    const wasConfirmed = reg ? reg.status === 'confirmed' : false;

    if (reg) {
      reg.status = 'removed';
      reg.removedAt = new Date().toISOString();
      if (batch && reg._docId) {
        batch.update(db.collection('registrations').doc(reg._docId), {
          status: 'removed',
          removedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    // 更新 activityRecord → removed
    if (!isCompanion) {
      const arSource = ApiService._src('activityRecords');
      const ar = arSource.find(a => a.eventId === eventId && a.uid === uid && a.status !== 'cancelled' && a.status !== 'removed');
      if (ar) {
        ar.status = 'removed';
        if (batch && ar._docId) {
          batch.update(db.collection('activityRecords').doc(ar._docId), { status: 'removed' });
        }
      }
    }

    // 正取被移除 → 觸發候補遞補（while loop 填滿所有空位）
    if (wasConfirmed) {
      const activeRegs = allRegs.filter(
        r => r.eventId === eventId && (r.status === 'confirmed' || r.status === 'waitlisted')
      );
      const confirmedCount = activeRegs.filter(r => r.status === 'confirmed').length;
      let slotsAvailable = (event.max || 0) - confirmedCount;

      while (slotsAvailable > 0) {
        const candidate = this._getNextWaitlistCandidate(eventId);
        if (!candidate) break;
        this._promoteSingleCandidateLocal(event, candidate);
        if (batch && candidate._docId) {
          batch.update(db.collection('registrations').doc(candidate._docId), { status: 'confirmed' });
        }
        const arDocIds = this._getPromotedArDocIds(event, candidate);
        if (batch) {
          arDocIds.forEach(docId => batch.update(db.collection('activityRecords').doc(docId), { status: 'registered' }));
        }
        slotsAvailable--;
      }
    }

    // 統一重建投影
    const activeAfterRemoval = allRegs.filter(
      r => r.eventId === eventId && (r.status === 'confirmed' || r.status === 'waitlisted')
    );
    if (typeof FirebaseService !== 'undefined' && typeof FirebaseService._rebuildOccupancy === 'function') {
      const occupancy = FirebaseService._rebuildOccupancy(event, activeAfterRemoval);
      FirebaseService._applyRebuildOccupancy(event, occupancy);
    }

    // 所有寫入合併到同一個 batch
    if (batch && event._docId) {
      batch.update(db.collection('events').doc(event._docId), {
        current: event.current, waitlist: event.waitlist,
        participants: event.participants || [], waitlistNames: event.waitlistNames || [],
        status: event.status,
      });
      try {
        await batch.commit();
      } catch (err) {
        console.error('[removeParticipant] batch commit failed:', err);
        this.showToast('移除同步失敗，請重試');
        return;
      }
    }
    if (typeof FirebaseService !== 'undefined' && typeof FirebaseService._saveToLS === 'function') {
      FirebaseService._saveToLS('registrations', FirebaseService._cache.registrations);
      FirebaseService._saveToLS('events', FirebaseService._cache.events);
    }

    // 寫操作日誌
    ApiService._writeOpLog('participant_removed', '移除參加者', `從「${event.title}」移除 ${name}`);

    // 關閉編輯狀態並重新渲染
    this._manualEditingUid = null;
    this._manualEditingEventId = null;
    this._renderAttendanceTable(eventId, this._manualEditingContainerId);
    this.showToast(`已將 ${name} 從報名名單中移除`);
  },

  // ── 刪除活動 ──
  async deleteMyActivity(id) {
    const e = ApiService.getEvent(id);
    if (e && !this._canManageEvent(e)) { this.showToast('您只能管理自己的活動'); return; }
    if (!(await this.appConfirm('確定要刪除此活動？刪除後無法恢復。'))) return;
    const title = e.title;
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
    await this._cleanupCancelledRecords(id);
    ApiService._writeOpLog('event_delete', '刪除活動', `刪除「${title}」`);
    this.renderMyActivities();
    this.renderActivityList();
    this.renderHotEvents();
    this.showToast('活動已刪除');
  },

});
