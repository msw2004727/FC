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
  _eventPinCounter: 100,

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
        // Fee summary
        const fee = e.fee || 0;
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
        <div style="display:flex;gap:.3rem;margin-top:.4rem;flex-wrap:wrap;align-items:center">${btns}${feeBox}</div>
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

    // 以姓名反查狀態（報名名單用）

    const allActiveRegs = ApiService.getRegistrationsByEvent(e.id);
    const waitlistedRegs = allActiveRegs.filter(r => r.status === 'waitlisted');
    const waitlistHtml = this._buildWaitlistTable(e, waitlistedRegs);

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
    const fee = e.fee || 0;
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

    content.innerHTML = `
      <h3 style="margin:0 0 .4rem;font-size:1rem">${escapeHTML(e.title)}</h3>
      <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:.6rem">
        <div>${escapeHTML(e.location)} ・ ${escapeHTML(e.date)}</div>
        <div>費用：${fee > 0 ? 'NT$' + fee : '免費'} ・ 狀態：${statusConf.label} ・ 主辦：${escapeHTML(e.creator)}</div>
      </div>
      <div style="font-size:.85rem;font-weight:700;margin-bottom:.3rem">報名名單（${e.current}/${e.max}）</div>
      <div id="attendance-table-container"></div>
      ${waitlistHtml}
      ${checkinSection}
      ${checkoutSection}
      ${unregSection}
      ${feeSection}
    `;
    this._renderAttendanceTable(e.id);
    modal.style.display = 'flex';
  },

  // ── 候補名單表格（分組顯示同行者 + 孤立同行者關聯）──
  _buildWaitlistTable(e, waitlistedRegs) {
    const allRegs = ApiService.getRegistrationsByEvent(e.id);
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
          let orphanInfo = null;
          if (c.participantType === 'companion') {
            const selfConfirmed = allRegs.find(
              r => r.userId === userId && r.participantType === 'self' && r.status === 'confirmed'
            );
            if (selfConfirmed) orphanInfo = selfConfirmed.userName;
          }
          return { name: cName, orphanInfo };
        });

        let selfOrphanInfo = null;
        if (!selfReg) {
          const selfConfirmed = allRegs.find(
            r => r.userId === userId && r.participantType === 'self' && r.status === 'confirmed'
          );
          if (selfConfirmed) selfOrphanInfo = selfConfirmed.userName;
        }

        items.push({ name: mainName, companions: companionItems, selfOrphanInfo });
        addedNames.add(mainName);
        companionItems.forEach(c => addedNames.add(c.name));
      });
    }
    // 混合資料：補上只在 waitlistNames 但沒有 registration 的舊成員
    (e.waitlistNames || []).forEach(p => {
      if (!addedNames.has(p)) {
        items.push({ name: p, companions: [], selfOrphanInfo: null });
        addedNames.add(p);
      }
    });

    if (items.length === 0) return '';

    let rows = '';
    items.forEach((item, idx) => {
      rows += `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:.35rem .3rem;text-align:center;width:2rem"><span class="wl-pos">${idx + 1}</span></td>
        <td style="padding:.35rem .3rem;text-align:left">${this._userTag(item.name)}</td>
      </tr>`;
      if (item.selfOrphanInfo) {
        rows += `<tr><td></td><td style="padding:.1rem .3rem;padding-left:1.2rem;font-size:.72rem;color:var(--text-muted)">↳ 報名人：${escapeHTML(item.selfOrphanInfo)}（<span style="color:var(--success)">已正取</span>）</td></tr>`;
      }
      item.companions.forEach(c => {
        const cName = typeof c === 'string' ? c : c.name;
        const orphan = typeof c === 'object' ? c.orphanInfo : null;
        rows += `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:.3rem .3rem"></td>
          <td style="padding:.3rem .3rem;text-align:left;padding-left:1.2rem"><span style="color:var(--text-secondary)">↳ ${escapeHTML(cName)}</span></td>
        </tr>`;
        if (orphan) {
          rows += `<tr><td></td><td style="padding:.1rem .3rem;padding-left:1.8rem;font-size:.72rem;color:var(--text-muted)">↳ 報名人：${escapeHTML(orphan)}（<span style="color:var(--success)">已正取</span>）</td></tr>`;
        }
      });
    });

    const totalCount = items.reduce((sum, it) => sum + 1 + it.companions.length, 0);
    return `<div style="font-size:.85rem;font-weight:700;margin:.6rem 0 .3rem">候補名單（${totalCount}）</div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:.8rem">
          <thead><tr style="border-bottom:2px solid var(--border)">
            <th style="text-align:center;padding:.4rem .3rem;font-weight:600;width:2rem">#</th>
            <th style="text-align:left;padding:.4rem .3rem;font-weight:600">姓名</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
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
        const proxyOnly = !selfReg; // 僅代報：沒有 self registration
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
    // 混合資料：補上只在 e.participants 但沒有 registration 的舊成員
    (e.participants || []).forEach(p => {
      if (!addedNames.has(p)) {
        people.push({ name: p, uid: p, isCompanion: false, displayName: p, hasSelfReg: true, proxyOnly: false });
        addedNames.add(p);
      }
    });

    if (people.length === 0) {
      container.innerHTML = '<div style="font-size:.8rem;color:var(--text-muted);padding:.3rem 0">尚無報名</div>';
      return;
    }

    const editingUid = this._manualEditingUid;
    const isEditing = (uid) => this._manualEditingEventId === eventId && !this._manualEditingIsUnreg && editingUid === uid;

    const kickStyle = 'font-size:.7rem;padding:.2rem .4rem;border:1px solid var(--danger);color:var(--danger);background:transparent;border-radius:var(--radius-sm);cursor:pointer;white-space:nowrap';
    const manualStyle = 'font-size:.7rem;padding:.2rem .45rem;background:#1565c0;color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer;white-space:nowrap';
    const doneStyle = 'font-size:.7rem;padding:.2rem .45rem;background:#2e7d32;color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer;white-space:nowrap';
    const cbStyle = 'width:1.4rem;height:1.4rem;cursor:pointer;vertical-align:middle';

    let rows = people.map(p => {
      const hasCheckin = records.some(r => this._matchAttendanceRecord(r, p) && r.type === 'checkin');
      const hasCheckout = records.some(r => this._matchAttendanceRecord(r, p) && r.type === 'checkout');
      const noteRec = this._getLatestAttendanceRecord(records, p, 'note');
      const noteText = noteRec?.note || '';
      // 備註：僅代報自動標注，手動備註附加在後面
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

      // 踢掉按鈕（左欄，始終顯示給管理員）
      const kickTd = canManage
        ? `<td style="padding:.35rem .2rem;text-align:center"><button style="${kickStyle}" onclick="App._removeParticipant('${escapeHTML(eventId)}','${safeUid}','${safeName}',${p.isCompanion})">踢掉</button></td>`
        : '';

      if (canManage && isEditing(p.uid)) {
        return `<tr style="border-bottom:1px solid var(--border)">
          ${kickTd}
          <td style="padding:.35rem .3rem;text-align:left">${nameHtml}</td>
          <td style="padding:.35rem .2rem;text-align:center"><input type="checkbox" id="manual-checkin-${safeUid}" ${hasCheckin ? 'checked' : ''} style="${cbStyle}"></td>
          <td style="padding:.35rem .2rem;text-align:center"><input type="checkbox" id="manual-checkout-${safeUid}" ${hasCheckout ? 'checked' : ''} style="${cbStyle}"></td>
          <td style="padding:.35rem .3rem"><input type="text" maxlength="20" value="${escapeHTML(noteText)}" id="manual-note-${safeUid}" placeholder="備註" style="width:100%;font-size:.72rem;padding:.15rem .3rem;border:1px solid var(--border);border-radius:3px;box-sizing:border-box"></td>
          <td style="padding:.35rem .2rem;text-align:center"><button style="${doneStyle}" onclick="App._confirmManualAttendance('${escapeHTML(eventId)}','${safeUid}','${safeName}')">完成簽到</button></td>
        </tr>`;
      }
      return `<tr style="border-bottom:1px solid var(--border)">
        ${kickTd}
        <td style="padding:.35rem .3rem;text-align:left">${nameHtml}</td>
        <td style="padding:.35rem .2rem;text-align:center">${hasCheckin ? '<span style="color:var(--success);font-size:1rem">✓</span>' : ''}</td>
        <td style="padding:.35rem .2rem;text-align:center">${hasCheckout ? '<span style="color:var(--success);font-size:1rem">✓</span>' : ''}</td>
        <td style="padding:.35rem .3rem;font-size:.72rem;color:var(--text-muted)">${escapeHTML(combinedNote)}</td>
        ${canManage ? `<td style="padding:.35rem .2rem;text-align:center"><button style="${manualStyle}" onclick="App._startManualAttendance('${escapeHTML(eventId)}','${safeUid}','${safeName}',${p.isCompanion})">手動簽到</button></td>` : ''}
      </tr>`;
    }).join('');

    container.innerHTML = `<div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:.8rem">
        <thead><tr style="border-bottom:2px solid var(--border)">
          ${canManage ? '<th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:3rem">踢掉</th>' : ''}
          <th style="text-align:left;padding:.4rem .3rem;font-weight:600">姓名</th>
          <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2.5rem">簽到</th>
          <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2.5rem">簽退</th>
          <th style="text-align:left;padding:.4rem .3rem;font-weight:600">備註</th>
          ${canManage ? '<th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:4.5rem">操作</th>' : ''}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
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
    const countEl = document.getElementById('detail-unreg-count');

    if (unregMap.size === 0) {
      if (section) section.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    if (section) section.style.display = '';
    if (countEl) countEl.textContent = unregMap.size;

    const editingUid = this._manualEditingUid;
    const isEditing = (uid) => this._manualEditingEventId === eventId && this._manualEditingIsUnreg && editingUid === uid;

    const manualStyle = 'font-size:.7rem;padding:.2rem .45rem;background:#1565c0;color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer;white-space:nowrap';
    const doneStyle = 'font-size:.7rem;padding:.2rem .45rem;background:#2e7d32;color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer;white-space:nowrap';
    const cbStyle = 'width:1.4rem;height:1.4rem;cursor:pointer;vertical-align:middle';

    const people = [];
    unregMap.forEach(u => people.push(u));

    let rows = people.map(p => {
      const person = { uid: p.uid, name: p.name, isCompanion: false };
      const hasCheckin = records.some(r => this._matchAttendanceRecord(r, person) && r.type === 'checkin');
      const hasCheckout = records.some(r => this._matchAttendanceRecord(r, person) && r.type === 'checkout');
      const noteRec = this._getLatestAttendanceRecord(records, person, 'note');
      const noteText = noteRec?.note || '';
      const autoNote = '未報名';
      const combinedNote = [autoNote, noteText].filter(Boolean).join('・');

      const nameHtml = escapeHTML(p.name);
      const safeUid = escapeHTML(p.uid);
      const safeName = escapeHTML(p.name);

      if (canManage && isEditing(p.uid)) {
        return `<tr style="border-bottom:1px solid var(--border)">
          <td style="padding:.35rem .3rem;text-align:left">${nameHtml}</td>
          <td style="padding:.35rem .2rem;text-align:center"><input type="checkbox" id="manual-checkin-${safeUid}" ${hasCheckin ? 'checked' : ''} style="${cbStyle}"></td>
          <td style="padding:.35rem .2rem;text-align:center"><input type="checkbox" id="manual-checkout-${safeUid}" ${hasCheckout ? 'checked' : ''} style="${cbStyle}"></td>
          <td style="padding:.35rem .3rem"><input type="text" maxlength="20" value="${escapeHTML(noteText)}" id="manual-note-${safeUid}" placeholder="備註" style="width:100%;font-size:.72rem;padding:.15rem .3rem;border:1px solid var(--border);border-radius:3px;box-sizing:border-box"></td>
          <td style="padding:.35rem .2rem;text-align:center"><button style="${doneStyle}" onclick="App._confirmManualAttendance('${escapeHTML(eventId)}','${safeUid}','${safeName}')">完成簽到</button></td>
        </tr>`;
      }
      return `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:.35rem .3rem;text-align:left">${nameHtml}</td>
        <td style="padding:.35rem .2rem;text-align:center">${hasCheckin ? '<span style="color:var(--success);font-size:1rem">✓</span>' : ''}</td>
        <td style="padding:.35rem .2rem;text-align:center">${hasCheckout ? '<span style="color:var(--success);font-size:1rem">✓</span>' : ''}</td>
        <td style="padding:.35rem .3rem;font-size:.72rem;color:var(--text-muted)">${escapeHTML(combinedNote)}</td>
        ${canManage ? `<td style="padding:.35rem .2rem;text-align:center"><button style="${manualStyle}" onclick="App._startManualAttendance('${escapeHTML(eventId)}','${safeUid}','${safeName}',false,true)">手動簽到</button></td>` : ''}
      </tr>`;
    }).join('');

    container.innerHTML = `<div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:.8rem">
        <thead><tr style="border-bottom:2px solid var(--border)">
          <th style="text-align:left;padding:.4rem .3rem;font-weight:600">姓名</th>
          <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2.5rem">簽到</th>
          <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2.5rem">簽退</th>
          <th style="text-align:left;padding:.4rem .3rem;font-weight:600">備註</th>
          ${canManage ? '<th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:4.5rem">操作</th>' : ''}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  },

  _startManualAttendance(eventId, uid, name, isCompanion, isUnreg) {
    this._manualEditingUid = uid;
    this._manualEditingEventId = eventId;
    this._manualEditingIsCompanion = !!isCompanion;
    this._manualEditingIsUnreg = !!isUnreg;
    if (isUnreg) {
      this._renderUnregTable(eventId, 'detail-unreg-table');
    } else {
      this._renderAttendanceTable(eventId, this._manualEditingContainerId);
    }
  },

  async _confirmManualAttendance(eventId, uid, name) {
    const checkinBox = document.getElementById('manual-checkin-' + uid);
    const checkoutBox = document.getElementById('manual-checkout-' + uid);
    const noteInput = document.getElementById('manual-note-' + uid);
    const wantCheckin = checkinBox?.checked || false;
    const wantCheckout = checkoutBox?.checked || false;
    const note = (noteInput?.value || '').trim().slice(0, 20);

    const isCompanion = this._manualEditingIsCompanion;
    const person = { uid, name, isCompanion };
    const records = ApiService.getAttendanceRecords(eventId);
    const hasCheckin = records.some(r => this._matchAttendanceRecord(r, person) && r.type === 'checkin');
    const hasCheckout = records.some(r => this._matchAttendanceRecord(r, person) && r.type === 'checkout');
    const now = new Date();
    const timeStr = App._formatDateTime(now);

    // 同行者：找到主用戶資訊以寫入正確格式的紀錄
    let recordUid = uid, recordUserName = name, companionId = null, companionName = null, participantType = 'self';
    if (isCompanion) {
      const allRegs = ApiService.getRegistrationsByEvent(eventId);
      const cReg = allRegs.find(r => r.companionId === uid);
      if (cReg) {
        recordUid = cReg.userId;
        recordUserName = cReg.userName;
        companionId = uid;
        companionName = name;
        participantType = 'companion';
      }
    }

    try {
      // 取消簽退（先取消簽退再處理簽到，避免依賴順序問題）
      if (!wantCheckout && hasCheckout) {
        const rec = this._getLatestAttendanceRecord(records, person, 'checkout');
        if (rec) await ApiService.removeAttendanceRecord(rec);
      }
      // 取消簽到（同時移除簽退）
      if (!wantCheckin && hasCheckin) {
        const recOut = this._getLatestAttendanceRecord(records, person, 'checkout');
        if (recOut) await ApiService.removeAttendanceRecord(recOut);
        const recIn = this._getLatestAttendanceRecord(records, person, 'checkin');
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
        if (!wantCheckin && !hasCheckin) {
          this.showToast('需先簽到才能簽退');
          return;
        }
        await ApiService.addAttendanceRecord({
          id: 'att_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
          eventId, uid: recordUid, userName: recordUserName,
          participantType, companionId, companionName,
          type: 'checkout', time: timeStr,
        });
      }
      const existingNote = this._getLatestAttendanceRecord(records, person, 'note');
      const existingNoteText = (existingNote?.note || '').trim();
      if (note !== existingNoteText) {
        await ApiService.addAttendanceRecord({
          id: 'att_note_' + Date.now(), eventId, uid: recordUid, userName: recordUserName,
          participantType, companionId, companionName,
          type: 'note', time: timeStr, note,
        });
      }
    } catch (err) {
      console.error('[_confirmManualAttendance]', err);
      const rawMsg = String(err?.message || '');
      this.showToast('更新失敗：' + (rawMsg || '請確認登入狀態後再試'));
      return;
    }

    const wasUnreg = this._manualEditingIsUnreg;
    this._manualEditingUid = null;
    this._manualEditingEventId = null;
    this._manualEditingIsCompanion = false;
    this._manualEditingIsUnreg = false;
    if (wasUnreg) {
      this._renderUnregTable(eventId, 'detail-unreg-table');
    } else {
      this._renderAttendanceTable(eventId, this._manualEditingContainerId);
    }
    this.showToast('已更新');
  },

  editMyActivity(id) {
    const e = ApiService.getEvent(id);
    if (!e) return;
    if (!this._canManageEvent(e)) { this.showToast('您只能編輯自己的活動'); return; }
    this._editEventId = id;
    // 確保事件已綁定（防止 Phase 1 非同步時機導致未綁定）
    this.bindImageUpload('ce-image', 'ce-upload-preview');
    this.bindTeamOnlyToggle();
    this.showModal('create-event-modal');
    const submitBtn = document.getElementById('ce-submit-btn');
    if (submitBtn) submitBtn.textContent = '儲存變更';
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
    document.getElementById('ce-fee').value = e.fee || 0;
    document.getElementById('ce-max').value = e.max || 20;
    document.getElementById('ce-waitlist').value = 0;
    document.getElementById('ce-min-age').value = e.minAge || 0;
    document.getElementById('ce-notes').value = e.notes || '';
    // 開放報名時間
    const regOpenInput = document.getElementById('ce-reg-open-time');
    if (regOpenInput) regOpenInput.value = e.regOpenTime || '';
    // 球隊限定
    const ceTeamOnly = document.getElementById('ce-team-only');
    if (ceTeamOnly) {
      ceTeamOnly.checked = !!e.teamOnly;
      // 編輯模式：若為球隊限定且建立者無球隊，需先填充下拉再還原選擇
      if (e.teamOnly) {
        const team = this._getEventCreatorTeam();
        if (!team.teamId) {
          const ceTeamSelect = document.getElementById('ce-team-select');
          if (ceTeamSelect) {
            this._populateTeamSelect(ceTeamSelect);
            if (e.creatorTeamId) ceTeamSelect.value = e.creatorTeamId;
          }
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
    const e = ApiService.getEvent(id);
    if (e && !this._canManageEvent(e)) { this.showToast('您只能管理自己的活動'); return; }
    if (!await this.appConfirm('確定要取消此活動？')) return;

    // Trigger 4：活動取消通知 — 通知所有報名者與候補者
    if (e) {
      const adminUsers = ApiService.getAdminUsers();
      const allNames = [...(e.participants || []), ...(e.waitlistNames || [])];
      allNames.forEach(name => {
        const u = adminUsers.find(au => au.name === name);
        if (u) {
          this._sendNotifFromTemplate('event_cancelled', {
            eventName: e.title, date: e.date, location: e.location,
          }, u.uid, 'activity', '活動');
        }
      });
      // Firebase 模式：補查 registrations 確保不遺漏
      if (!ModeManager.isDemo()) {
        const regs = (FirebaseService._cache.registrations || []).filter(
          r => r.eventId === id && r.status !== 'cancelled'
        );
        const notifiedNames = new Set(allNames);
        regs.forEach(r => {
          if (r.userId && !notifiedNames.has(r.userName)) {
            this._sendNotifFromTemplate('event_cancelled', {
              eventName: e.title, date: e.date, location: e.location,
            }, r.userId, 'activity', '活動');
          }
        });
      }
    }

    ApiService.updateEvent(id, { status: 'cancelled' });
    // 活動被取消 → 刪除所有個人取消紀錄
    this._cleanupCancelledRecords(id);
    ApiService._writeOpLog('event_cancel', '取消活動', `取消「${e.title}」`);
    this.renderMyActivities();
    this.renderActivityList();
    this.renderHotEvents();
    this.showToast('活動已取消');
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
    const eventRegs = ApiService.getRegistrationsByEvent(id);
    if (eventRegs.length > 0) {
      const notifyUids = [...new Set(eventRegs.map(r => r.userId))];
      notifyUids.forEach(uid => {
        this._sendNotifFromTemplate('event_relisted', {
          eventName: e.title, date: e.date, location: e.location,
        }, uid, 'activity', '活動');
      });
    } else {
      // fallback: 舊資料沒有 registrations，用名字查找
      const allNames = [...(e.participants || []), ...(e.waitlistNames || [])];
      if (allNames.length > 0) {
        const adminUsers = ApiService.getAdminUsers();
        allNames.forEach(name => {
          const u = adminUsers.find(au => au.name === name);
          if (u) {
            this._sendNotifFromTemplate('event_relisted', {
              eventName: e.title, date: e.date, location: e.location,
            }, u.uid, 'activity', '活動');
          }
        });
      }
    }

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
  _cleanupCancelledRecords(eventId) {
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

    // 找到對應的 registration（相容沒有 participantType 的舊資料與幽靈用戶）
    const allRegs = ApiService._src('registrations');
    let reg;
    if (isCompanion) {
      reg = allRegs.find(r => r.eventId === eventId && r.companionId === uid && r.status !== 'cancelled' && r.status !== 'removed');
    } else {
      reg = allRegs.find(r => r.eventId === eventId && r.userId === uid && r.participantType !== 'companion' && r.status !== 'cancelled' && r.status !== 'removed');
    }

    if (reg) {
      reg.status = 'removed';
      reg.removedAt = new Date().toISOString();
      if (!ModeManager.isDemo() && reg._docId) {
        db.collection('registrations').doc(reg._docId).update({
          status: 'removed',
          removedAt: firebase.firestore.FieldValue.serverTimestamp(),
        }).catch(err => console.error('[removeParticipant]', err));
      }
    }

    // 更新 activityRecord → removed（不留取消記錄，管理員移除不算用戶自行取消）
    if (!isCompanion) {
      const arSource = ApiService._src('activityRecords');
      const ar = arSource.find(a => a.eventId === eventId && a.uid === uid && a.status !== 'cancelled' && a.status !== 'removed');
      if (ar) {
        ar.status = 'removed';
        if (!ModeManager.isDemo() && ar._docId) {
          db.collection('activityRecords').doc(ar._docId).update({ status: 'removed' })
            .catch(err => console.error('[removeParticipantAR]', err));
        }
      }
    }

    // 從活動名單移除
    const pIdx = (event.participants || []).indexOf(name);
    const wasConfirmed = pIdx >= 0;
    if (pIdx >= 0) {
      event.participants.splice(pIdx, 1);
      event.current = Math.max(0, event.current - 1);
    }
    const wIdx = (event.waitlistNames || []).indexOf(name);
    if (wIdx >= 0) {
      event.waitlistNames.splice(wIdx, 1);
      event.waitlist = Math.max(0, event.waitlist - 1);
    }

    // 正取被移除 → 觸發候補遞補
    if (wasConfirmed && event.current < event.max) {
      const candidate = this._getNextWaitlistCandidate(eventId);
      if (candidate) {
        this._promoteSingleCandidate(event, candidate);
      }
    }

    event.status = event.current >= event.max ? 'full' : 'open';
    this._syncEventToFirebase(event);

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
    // 活動被刪除 → 刪除所有個人取消紀錄
    this._cleanupCancelledRecords(id);
    ApiService.deleteEvent(id);
    ApiService._writeOpLog('event_delete', '刪除活動', `刪除「${title}」`);
    this.renderMyActivities();
    this.renderActivityList();
    this.renderHotEvents();
    this.showToast('活動已刪除');
  },

});
