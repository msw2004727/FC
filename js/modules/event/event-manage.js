/* ================================================
   SportHub — Event: My Activity Management (Coach+)
   依賴：event-list.js (helpers),
         event-manage-noshow.js, event-manage-attendance.js,
         event-manage-confirm.js, event-manage-lifecycle.js,
         event-manage-badges.js, event-manage-waitlist.js
   Note: innerHTML usage is safe — all user content passes through escapeHTML()
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  My Activities (Coach+)
  // ══════════════════════════════════

  _myActivityFilter: 'all',

  // ── 活動統計彈窗 ──
  _showActivityStatsModal() {
    const isAdmin = this.hasPermission('event.edit_all');
    let events = ApiService.getEvents() || [];
    if (!isAdmin) {
      events = events.filter(e => this._isEventOwner(e) || this._isEventDelegate(e));
    }
    const counts = events.reduce((acc, e) => { acc[e.status] = (acc[e.status] || 0) + 1; return acc; }, {});
    const scope = isAdmin ? '所有活動' : '我管理的活動';
    const items = [
      { label: '總活動', count: events.length, color: '#0d9488', bg: 'rgba(13,148,136,.1)' },
      { label: '即將開放', count: counts.upcoming || 0, color: '#6366f1', bg: 'rgba(99,102,241,.1)' },
      { label: '報名中', count: counts.open || 0, color: '#10b981', bg: 'rgba(16,185,129,.1)' },
      { label: '已額滿', count: counts.full || 0, color: '#f59e0b', bg: 'rgba(245,158,11,.1)' },
      { label: '已結束', count: counts.ended || 0, color: '#6b7280', bg: 'rgba(107,114,128,.1)' },
      { label: '已取消', count: counts.cancelled || 0, color: '#ef4444', bg: 'rgba(239,68,68,.1)' },
    ];
    const cards = items.map(it =>
      `<div style="background:${it.bg};border-radius:10px;padding:.6rem .7rem;text-align:center">`
      + `<div style="font-size:1.4rem;font-weight:800;color:${it.color}">${it.count}</div>`
      + `<div style="font-size:.72rem;color:var(--text-secondary);margin-top:.15rem">${it.label}</div>`
      + `</div>`
    ).join('');
    const overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="edu-info-dialog" style="max-width:360px">'
      + '<div class="edu-info-dialog-title">活動統計</div>'
      + `<div style="font-size:.72rem;color:var(--text-muted);text-align:center;margin-bottom:.6rem">統計範圍：${scope}</div>`
      + `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.45rem">${cards}</div>`
      + '<button class="primary-btn" style="width:100%;margin-top:.8rem;flex-shrink:0" onclick="this.closest(\'.edu-info-overlay\').remove()">關閉</button>'
      + '</div>';
    document.body.appendChild(overlay);
  },

  // _scanUserRegions 已移至 data-sync.js（用戶補正管理 > 系統資料同步）
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

  async _ensureActivityRecordsReady({ required = false } = {}) {
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
    const event = eventData || ApiService.getEvent(eventId);
    // 優先使用 event 文件上由 _rebuildOccupancy 寫入的 waitlist 數字，
    // 確保所有用戶（不論角色）看到一致的候補人數
    const docCount = Number(event?.waitlist || 0);
    if (docCount > 0) return docCount;

    // fallback：event.waitlist 為 0 時，從 registrations + waitlistNames 合併計算
    const sourceRegs = Array.isArray(allRegs) ? allRegs : (ApiService.getRegistrationsByEvent(eventId) || []);
    const waitlistNames = new Set();

    sourceRegs.forEach(reg => {
      if (reg?.status !== 'waitlisted') return;
      const safeName = this._getRegistrationParticipantName(reg);
      if (safeName) waitlistNames.add(safeName);
    });

    this._getWaitlistFallbackNames(eventId, event, sourceRegs).forEach(name => waitlistNames.add(name));
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

    const isAdmin = this.hasPermission('event.edit_all');

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

    // 統計已移至彈窗 _showActivityStatsModal

    // 預計算出席紀錄 Map（避免每筆活動重新 filter 全部出席紀錄）
    const isSuperAdmin = (ROLE_LEVEL_MAP[this.currentRole] || 0) >= ROLE_LEVEL_MAP.super_admin;
    const checkoutsByEvent = new Map();
    const unregUidsByEvent = new Map();
    if (isSuperAdmin) {
      ApiService.getAttendanceRecords().forEach(r => {
        if (r.type === 'checkout') {
          if (!checkoutsByEvent.has(r.eventId)) checkoutsByEvent.set(r.eventId, []);
          checkoutsByEvent.get(r.eventId).push(r);
        }
        if (r.type === 'unreg') {
          if (!unregUidsByEvent.has(r.eventId)) unregUidsByEvent.set(r.eventId, new Set());
          unregUidsByEvent.get(r.eventId).add(r.uid);
        }
      });
    }

    const s = 'font-size:.72rem;padding:.2rem .5rem';
    // 方案 B：資料未變時跳過 re-render
    var _fp = filtered.map(function(e){ return e.id + '|' + e.status + '|' + (e.current||0) + '|' + (e.waitlist||0) + '|' + (e.pinned?1:0); }).join(',') + '|f:' + f + '|c:' + (creatorFilter||'');
    if (this._myActivitiesLastFp === _fp && container.children.length > 0) return;
    this._myActivitiesLastFp = _fp;

    // 方案 A：存 scrollTop
    var _page = document.getElementById('page-my-activities');
    var _prevScroll = _page ? _page.scrollTop : 0;
    var _prevWinScroll = window.scrollY || window.pageYOffset || 0;

    /* innerHTML — safe: all dynamic values pass through escapeHTML() */
    container.innerHTML = filtered.length > 0
      ? filtered.map(e => {
        const statusConf = STATUS_CONFIG[e.status] || STATUS_CONFIG.open;
        const isExternal = e.type === 'external';
        const canManage = this._canManageEvent(e);
        let btns = '';
        const pinBtn = canManage
          ? `<button class="outline-btn" style="${s}" onclick="App.toggleMyActivityPin('${e.id}')">${e.pinned ? '取消置頂' : '置頂'}</button>`
          : '';
        if (isExternal && canManage) {
          // 外部活動管理按鈕
          btns = `<button class="outline-btn" style="${s}" onclick="App.editExternalActivity('${e.id}')">編輯</button>`;
          if (e.status !== 'cancelled') {
            btns += `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.cancelMyActivity('${e.id}')">取消</button>`;
          } else {
            btns += `<button class="outline-btn" style="${s};color:var(--success)" onclick="App.reopenMyActivity('${e.id}')">重新開放</button>`;
          }
          if (isAdmin) btns += `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.deleteMyActivity('${e.id}')">刪除</button>`;
          btns += `<button class="outline-btn" style="${s};margin-left:auto;color:var(--accent)" onclick="event.stopPropagation();App.shareExternalEvent('${e.id}')">分享</button>`;
        } else if (canManage) {
          if (e.status === 'upcoming') {
            btns = `<button class="outline-btn" style="${s}" onclick="App.editMyActivity('${e.id}')">編輯</button>`
                 + `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.cancelMyActivity('${e.id}')">取消</button>`;
          } else if (e.status === 'open' || e.status === 'full') {
            btns = `<button class="outline-btn" style="${s}" onclick="App.editMyActivity('${e.id}')">編輯</button>`
                 + `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.cancelMyActivity('${e.id}')">取消</button>`;
          } else if (e.status === 'ended') {
            btns = `<button class="outline-btn" style="${s}" onclick="App.editMyActivity('${e.id}')">編輯</button>`
                 + `<button class="outline-btn" style="${s};color:var(--success)" onclick="App.relistMyActivity('${e.id}')">上架</button>`
                 + (isAdmin ? `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.deleteMyActivity('${e.id}')">刪除</button>` : '');
          } else if (e.status === 'cancelled') {
            btns = `<button class="outline-btn" style="${s};color:var(--success)" onclick="App.reopenMyActivity('${e.id}')">重新開放</button>`
                 + (isAdmin ? `<button class="outline-btn" style="${s};color:var(--danger)" onclick="App.deleteMyActivity('${e.id}')">刪除</button>` : '');
          }
        } else {
          btns = '';
        }
        if (canManage && pinBtn && btns) {
          const firstBtnEnd = btns.indexOf('</button>');
          if (firstBtnEnd >= 0) {
            btns = btns.slice(0, firstBtnEnd + 9) + pinBtn + btns.slice(firstBtnEnd + 9);
          }
        }
        const teamBadge = e.teamOnly ? '<span class="tl-teamonly-badge" style="margin-left:.3rem">限定</span>' : '';
        const sportIcon = this._renderEventSportIcon(e, 'my-event-sport-icon');
        const pinCardStyle = e.pinned
          ? ';border:1px solid var(--warning);box-shadow:0 0 0 1px rgba(245,158,11,.15)'
          : '';
        const pinBadge = e.pinned
          ? '<span style="font-size:.68rem;color:var(--warning);font-weight:700;border:1px solid var(--warning);border-radius:999px;padding:.05rem .35rem">置頂</span>'
          : '';

        // 外部活動：不顯示進度條與費用
        let progressRow = '';
        let feeBox = '';
        if (isExternal) {
          progressRow = `<div style="font-size:.72rem;color:var(--info);margin-top:.3rem">🔗 外部活動連結</div>`;
        } else {
          const _stats = typeof this._getEventParticipantStats === 'function'
            ? this._getEventParticipantStats(e)
            : { confirmedCount: Number(e.current || 0), waitlistCount: Number(e.waitlist || 0), maxCount: Number(e.max || 0) };
          const _confirmedDisplay = _stats.confirmedCount;
          const _waitlistDisplay = _stats.waitlistCount;
          const progressPct = _stats.maxCount > 0 ? Math.min(100, Math.round(_confirmedDisplay / _stats.maxCount * 100)) : 0;
          const progressColor = progressPct >= 100 ? 'var(--danger)' : progressPct >= 70 ? 'var(--warning)' : 'var(--success)';
          progressRow = `<div style="display:flex;align-items:center;gap:.5rem;margin-top:.3rem">
            <div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden">
              <div style="width:${progressPct}%;height:100%;background:${progressColor};border-radius:3px;transition:width .3s"></div>
            </div>
            <span style="font-size:.72rem;color:var(--text-muted);white-space:nowrap">${_confirmedDisplay}/${_stats.maxCount} 人${_waitlistDisplay > 0 ? ' ・ 候補 ' + _waitlistDisplay : ''}</span>
          </div>`;
          // Fee summary
          const feeEnabled = this._isEventFeeEnabled?.(e) ?? Number(e?.fee || 0) > 0;
          const fee = this._getEventRecordedFeeAmount?.(e) ?? (Number(e?.fee || 0) > 0 ? Math.floor(Number(e.fee || 0)) : 0);
          const confirmedRegs = fee > 0 ? ApiService.getRegistrationsByEvent(e.id).filter(r => r.status === 'confirmed' || r.status === 'registered') : [];
          const confirmedCount = confirmedRegs.length > 0 ? confirmedRegs.length : _confirmedDisplay;
          const _confirmedKeys = fee > 0 ? new Set(confirmedRegs.map(r => r.userId + '|' + (r.companionId || ''))) : null;
          const _unregUids = fee > 0 ? (unregUidsByEvent.get(e.id) || null) : null;
          let checkoutCount = 0;
          if (fee > 0) {
            const _seen = new Set();
            (checkoutsByEvent.get(e.id) || []).forEach(r => {
              const k = r.uid + '|' + (r.companionId || '');
              if (_seen.has(k)) return;
              if ((_confirmedKeys && _confirmedKeys.has(k)) || (!r.companionId && _unregUids && _unregUids.has(r.uid))) { _seen.add(k); checkoutCount++; }
            });
          }
          const feeExpected = fee * confirmedCount;
          const feeActual = fee * checkoutCount;
          const feeShort = feeExpected - feeActual;
          feeBox = (fee > 0 && isSuperAdmin) ? `<div style="margin-left:auto;padding:.2rem .45rem;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:.68rem;color:var(--text-secondary);display:inline-flex;gap:.5rem;background:var(--bg-elevated);white-space:nowrap">
            <span>應收<b style="color:var(--text-primary)">$${feeExpected}</b></span>
            <span>實收<b style="color:var(--success)">$${feeActual}</b></span>
            <span>短收<b style="color:${feeShort > 0 ? 'var(--danger)' : 'var(--success)'}">$${feeShort}</b></span>
          </div>` : '';
        }

        const cardOnclick = isExternal
          ? `if(!event.target.closest('button'))window.open('${escapeHTML(e.externalUrl || '')}','_blank')`
          : `if(!event.target.closest('button')&&!event.target.closest('.user-capsule'))App.showEventDetail('${e.id}')`;
        return `
      <div class="msg-manage-card" style="margin-bottom:.5rem;cursor:pointer${pinCardStyle}" onclick="${cardOnclick}">
        <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.2rem">
          <span class="msg-manage-title" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(e.title)}${teamBadge}</span>
          ${pinBadge}
          ${this._userTag(e.creator, ApiService.getUserRole(e.creator), { uid: e.creatorUid })}
          <span class="banner-manage-status status-${statusConf.css}">${statusConf.label}</span>
        </div>
        <div style="font-size:.75rem;color:var(--text-muted)">${escapeHTML(e.location || '')} ・ ${escapeHTML(e.date)}</div>
        ${progressRow}
        <div style="display:flex;gap:.3rem;margin-top:.4rem;flex-wrap:wrap;align-items:center">${sportIcon}${btns}${feeBox}</div>
      </div>`;
      }).join('')
      : '<div style="padding:1rem;font-size:.82rem;color:var(--text-muted);text-align:center">此分類沒有活動</div>';

    // 「載入更多歷史活動」按鈕（已結束/已取消/全部 tab，且尚未全部載完）
    var _showLoadMore = (f === 'ended' || f === 'cancelled' || f === 'all')
      && typeof FirebaseService !== 'undefined'
      && !FirebaseService._terminalAllLoaded
      && FirebaseService._terminalLastDoc;
    if (_showLoadMore) {
      container.insertAdjacentHTML('beforeend',
        '<div style="text-align:center;padding:.8rem 0">'
        + '<div style="font-size:.68rem;color:var(--text-muted);margin-bottom:.4rem">目前顯示近 ' + filtered.length + ' 場活動</div>'
        + '<button class="outline-btn" style="font-size:.78rem;padding:.4rem 1.2rem" onclick="App._loadMoreHistoryEvents()">載入更多歷史活動</button>'
        + '</div>'
      );
    }

    // 方案 A：還原 scrollTop
    if (_prevScroll > 0 && _page) _page.scrollTop = _prevScroll;
    if (_prevWinScroll > 0) window.scrollTo(0, _prevWinScroll);

    // 綁定左右滑動切換頁籤
    this._bindSwipeTabs('my-activity-list', 'my-activity-tabs',
      this.switchMyActivityTab,
      (btn) => btn.dataset.afilter
    );
  },

  // ── 活動置頂（僅 admin 以上）──
  toggleMyActivityPin(id) {
    const e = ApiService.getEvent(id);
    if (!e) return;
    if (!this.hasPermission('admin.users.entry') && !this.hasPermission('admin.entry')) {
      this.showToast('請聯繫管理員');
      return;
    }

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
        <span style="font-size:.82rem;flex:1" data-no-translate>${escapeHTML(v.name)}</span>
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

    // ── 費用摘要（使用獨立容器，供編輯簽到後即時刷新）──
    const isSuperAdmin = (ROLE_LEVEL_MAP[this.currentRole] || 0) >= ROLE_LEVEL_MAP.super_admin;
    const feeSection = isSuperAdmin ? `<div id="detail-fee-summary"></div>` : '';

    const feeEnabled = this._isEventFeeEnabled?.(e) ?? Number(e?.fee || 0) > 0;
    const fee = Number(e?.fee || 0);
    const metaParts = [];
    if (feeEnabled || fee > 0) metaParts.push(`費用：${fee > 0 ? 'NT$' + fee : '免費'}`);
    metaParts.push(`狀態：${statusConf.label}`);
    metaParts.push(`主辦：<span data-no-translate>${escapeHTML(e.creator)}</span>`);

    /* innerHTML — safe: all dynamic values pass through escapeHTML() */
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
    this._renderDetailFeeSummary(e.id);
    modal.style.display = 'flex';
  },

  /** 費用摘要即時渲染（獨立函式，供編輯簽到後刷新） */
  _renderDetailFeeSummary(eventId) {
    const container = document.getElementById('detail-fee-summary');
    if (!container) return;
    const e = ApiService.getEvent(eventId);
    if (!e) { container.innerHTML = ''; return; }
    const fee = this._getEventRecordedFeeAmount?.(e) ?? (Number(e?.fee || 0) > 0 ? Math.floor(Number(e.fee || 0)) : 0);
    if (fee <= 0) { container.innerHTML = ''; return; }
    const records = ApiService.getAttendanceRecords(eventId);
    const confirmedRegs = ApiService.getRegistrationsByEvent(eventId).filter(r => r.status === 'confirmed' || r.status === 'registered');
    const confirmedCount = Number(e.current || 0) > 0 ? Number(e.current) : confirmedRegs.length;
    const confirmedKeys = new Set(confirmedRegs.map(r => r.userId + '|' + (r.companionId || '')));
    const unregUids = new Set(records.filter(r => r.type === 'unreg').map(r => r.uid));
    const _seen = new Set();
    let checkoutCount = 0;
    records.forEach(r => {
      if (r.type !== 'checkout') return;
      const k = r.uid + '|' + (r.companionId || '');
      if (_seen.has(k)) return;
      if (confirmedKeys.has(k) || (!r.companionId && unregUids.has(r.uid))) { _seen.add(k); checkoutCount++; }
    });
    const feeExpected = fee * confirmedCount;
    const feeActual = fee * checkoutCount;
    const feeShort = feeExpected - feeActual;
    /* innerHTML — safe: only numeric values interpolated */
    container.innerHTML = `<div style="margin:.6rem 0 .2rem;padding:.4rem .6rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-elevated);font-size:.78rem;display:flex;gap:.8rem;flex-wrap:wrap">
      <span>應收 <b style="color:var(--text-primary)">$${feeExpected}</b></span>
      <span>實收 <b style="color:var(--success)">$${feeActual}</b></span>
      <span>短收 <b style="color:${feeShort > 0 ? 'var(--danger)' : 'var(--success)'}">$${feeShort}</b></span>
    </div>`;
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
    /* innerHTML — safe: all dynamic values pass through escapeHTML() */
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

  async _loadMoreHistoryEvents() {
    var btn = document.querySelector('#my-activity-list .outline-btn[onclick*="loadMore"]');
    if (btn) { btn.disabled = true; btn.textContent = '載入中…'; }
    try {
      var count = await FirebaseService.loadMoreTerminalEvents();
      if (count < 0) return;
      // 指紋重置，強制 re-render
      this._myActivitiesLastFp = '';
      this.renderMyActivities();
      if (count === 0) {
        this.showToast('已載入全部歷史活動');
      } else {
        this.showToast('已載入 ' + count + ' 場歷史活動');
      }
    } catch (err) {
      console.error('[_loadMoreHistoryEvents]', err);
      this.showToast('載入失敗，請稍後再試');
      if (btn) { btn.disabled = false; btn.textContent = '載入更多歷史活動'; }
    }
  },

});
