/* === SportHub — Attendance table rendering & helpers ===
   Note: innerHTML usage is safe — all user content passes through escapeHTML()
   依賴：event-manage-noshow.js (participant summary), event-manage.js (shared helpers)
   ======================================================= */

Object.assign(App, {

  _attendanceEditingEventId: null,
  _unregEditingEventId: null,
  _manualEditingContainerId: null,
  _attendanceTableFetchTimeoutMs: 9000,
  _attendanceTableLatePatchTimers: null,

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

  _isCompanionPseudoUid(value) {
    return String(value || '').trim().startsWith('comp_');
  },

  _isActiveAttendanceRegistration(reg) {
    const status = String(reg?.status || 'confirmed').toLowerCase();
    return status !== 'cancelled' && status !== 'removed';
  },

  _getAttendanceTableFetchTimeoutMs(options = {}) {
    const fromOptions = Number(options?.timeoutMs || 0);
    if (fromOptions > 0) return Math.max(1500, fromOptions);
    return Math.max(3000, Number(this._attendanceTableFetchTimeoutMs) || 9000);
  },

  _getAttendanceTableFetchIssue(results) {
    const list = Array.isArray(results) ? results : [];
    const failed = list.find(r => r && r.ok === false);
    if (!failed) return null;
    return {
      reason: failed.reason || 'error',
      error: failed.error || null,
    };
  },

  _getEventExpectedRosterCount(e) {
    if (!e) return 0;
    return Number(e.current || 0)
      || (Array.isArray(e.participantsWithUid) ? e.participantsWithUid.length : 0)
      || (Array.isArray(e.participants) ? e.participants.length : 0);
  },

  _isCurrentAttendanceTableTarget(eventId, containerId) {
    if (containerId === 'detail-attendance-table') {
      if (typeof this._isCurrentEventDetailPatch === 'function') {
        return this._isCurrentEventDetailPatch(eventId, null, { containerId }).ok === true;
      }
      return this.currentPage === 'page-activity-detail'
        && this._currentDetailEventId === eventId
        && !!document.getElementById(containerId);
    }
    return !!document.getElementById(containerId);
  },

  _canPatchAttendanceTable(eventId, containerId, container, options = {}, patchType = 'attendance') {
    const cId = containerId || 'attendance-table-container';
    if (cId !== 'detail-attendance-table') return { ok: true, reason: 'ok' };
    if (typeof this._isCurrentEventDetailPatch !== 'function') return { ok: true, reason: 'ok' };
    const guardEnabled = typeof this._shouldUseActivityDetailOptimization === 'function'
      ? this._shouldUseActivityDetailOptimization('latePatchGuard')
      : true;
    if (!guardEnabled) return { ok: true, reason: 'ok' };
    return this._isCurrentEventDetailPatch(eventId, options?.requestSeq ?? null, {
      container,
      containerId: cId,
      renderToken: options?.renderToken || null,
      patchType,
    });
  },

  _shouldSplitDetailRosterFetch(containerId, options = {}) {
    if ((containerId || '') !== 'detail-attendance-table') return false;
    if (options?.mode !== 'detail') return false;
    if (typeof this._shouldUseActivityDetailOptimization === 'function') {
      return this._shouldUseActivityDetailOptimization('rosterSplitFetch');
    }
    try {
      return typeof shouldUseActivityDetailOptimization === 'function'
        && shouldUseActivityDetailOptimization('rosterSplitFetch') === true;
    } catch (_) {
      return false;
    }
  },

  /** P1（rosterProjectionFirst）：是否在 fetch 前先畫投影快顯（docs/activity-roster-loading-optimization-plan-v0.1.md §7） */
  _shouldPaintDetailRosterProjectionFirst(eventId, e, containerId, options = {}) {
    if ((containerId || '') !== 'detail-attendance-table') return false;
    if (options?.mode !== 'detail') return false;
    if (options?.skipFetch) return false; // mutation/late patch 走快取優先，不得被投影覆蓋（計畫書約束 10）
    let enabled = false;
    try {
      enabled = typeof shouldUseActivityDetailOptimization === 'function'
        && shouldUseActivityDetailOptimization('rosterProjectionFirst') === true;
    } catch (_) {
      enabled = false;
    }
    if (!enabled) return false;
    if (this._attendanceEditingEventId === eventId || this._unregEditingEventId === eventId) return false;
    if (typeof ApiService !== 'undefined'
      && ApiService._fetchedRegistrationServerIds?.has?.(eventId)) {
      return false; // 已有本活動 server 證明 → 直接走完整名單
    }
    return true;
  },

  /** P2（deferAttendanceRecords）：本次詳情渲染是否需要載入出席資料（計畫書 §8） */
  _shouldLoadDetailAttendanceData(e) {
    let deferEnabled = false;
    try {
      deferEnabled = typeof shouldUseActivityDetailOptimization === 'function'
        && shouldUseActivityDetailOptimization('deferAttendanceRecords') === true;
    } catch (_) {
      deferEnabled = false;
    }
    if (!deferEnabled) return true;
    const eventId = String(e?.id || '');
    let onDemandEnabled = false;
    try {
      onDemandEnabled = this._isActivityDetailAttendanceOnDemandEnabled?.() === true
        || (typeof shouldUseActivityDetailOptimization === 'function'
          && shouldUseActivityDetailOptimization('detailAttendanceOnDemand') === true);
    } catch (_) {
      onDemandEnabled = false;
    }
    const onDemandOpen = this._isDetailAttendanceOnDemandOpen?.(eventId) === true
      || (!!eventId && String(this._detailAttendanceOnDemandEventId || '') === eventId);
    if (onDemandEnabled && !onDemandOpen) {
      return false;
    }
    const status = String(e?.status || '');
    if (status === 'ended' || status === 'cancelled') return true;
    if (this._attendanceEditingEventId === eventId || this._unregEditingEventId === eventId) return true;
    if (typeof this._canOperateEventSite === 'function' && this._canOperateEventSite(e)) return true;
    if (typeof this.hasPermission === 'function'
      && (this.hasPermission('activity.view_noshow') || this.hasPermission('admin.repair.no_show_adjust'))) {
      return true;
    }
    return false;
  },

  _scheduleDetailAttendanceRecordsPatch(eventId, containerId, fetchOptions, options = {}) {
    if (typeof ApiService === 'undefined' || typeof ApiService.fetchAttendanceIfMissing !== 'function') {
      return null;
    }
    const cId = containerId || 'detail-attendance-table';
    const patchOptions = {
      ...options,
      mode: 'detail',
      skipFetch: true,
    };
    return ApiService.fetchAttendanceIfMissing(eventId, fetchOptions)
      .then((result) => {
        const issue = this._getAttendanceTableFetchIssue([result]);
        if (issue) {
          this._scheduleAttendanceTableLatePatch(eventId, cId, patchOptions);
          return { ok: false, reason: issue.reason || 'attendance-fetch-issue', error: issue.error || null };
        }
        const container = document.getElementById(cId);
        const guard = this._canPatchAttendanceTable(eventId, cId, container, patchOptions, 'attendance-records');
        if (!guard.ok) return guard;
        return this._renderAttendanceTable(eventId, cId, patchOptions);
      })
      .catch((err) => {
        console.warn('[AttendanceTable] attendance records background fetch failed:', err);
        this._scheduleAttendanceTableLatePatch(eventId, cId, patchOptions);
        return { ok: false, reason: err?.code === 'firestore-fetch-timeout' ? 'timeout' : 'error', error: err };
      });
  },

  _scheduleAttendanceTableLatePatch(eventId, containerId, options = {}) {
    const cId = containerId || 'attendance-table-container';
    this._attendanceTableLatePatchTimers = this._attendanceTableLatePatchTimers || {};
    const patchOptions = {
      ...options,
      mode: options?.mode || (cId === 'detail-attendance-table' ? 'detail' : options?.mode),
      skipFetch: true,
    };
    const key = `${cId}:${eventId}:${patchOptions?.renderToken || ''}`;
    if (this._attendanceTableLatePatchTimers[key]) return;
    const delays = [1800, 6000, 14000];
    let index = 0;
    const run = () => {
      if (!this._attendanceTableLatePatchTimers?.[key]) return;
      const container = document.getElementById(cId);
      const guard = this._canPatchAttendanceTable(eventId, cId, container, patchOptions, 'late-patch');
      if (!guard.ok || !this._isCurrentAttendanceTableTarget(eventId, cId)) {
        clearTimeout(this._attendanceTableLatePatchTimers[key]);
        delete this._attendanceTableLatePatchTimers[key];
        return;
      }
      const e = ApiService.getEvent?.(eventId);
      const regs = ApiService.getRegistrationsByEvent?.(eventId) || [];
      const expectedCount = this._getEventExpectedRosterCount(e);
      if (regs.length > 0 || expectedCount <= 0) {
        clearTimeout(this._attendanceTableLatePatchTimers[key]);
        delete this._attendanceTableLatePatchTimers[key];
        this._renderAttendanceTable(eventId, cId, patchOptions);
        return;
      }
      index++;
      if (index >= delays.length) {
        clearTimeout(this._attendanceTableLatePatchTimers[key]);
        delete this._attendanceTableLatePatchTimers[key];
        return;
      }
      this._attendanceTableLatePatchTimers[key] = setTimeout(run, delays[index]);
    };
    this._attendanceTableLatePatchTimers[key] = setTimeout(run, delays[index]);
  },

  _renderAttendanceLoadIssue(eventId, containerId, issue = {}) {
    const safeEventId = escapeHTML(eventId || '');
    const safeContainerId = escapeHTML(containerId || 'attendance-table-container');
    const isTimeout = issue?.reason === 'timeout';
    const title = isTimeout ? '報名名單同步較久' : '報名名單暫時無法同步';
    const note = isTimeout
      ? '先顯示目前可用資料；系統會在背景補回最新名單。'
      : '可以稍後重新同步，或先查看目前可用資料。';
    return `<div class="reg-loading reg-loading-issue" style="align-items:flex-start;text-align:left;gap:.35rem">
      <div style="font-weight:700;color:var(--text-primary)">${title}</div>
      <div style="font-size:.78rem;color:var(--text-secondary);line-height:1.5">${note}</div>
      <button type="button" style="font-size:.76rem;padding:.28rem .65rem;border:1px solid var(--border);background:var(--surface);color:var(--text-primary);border-radius:var(--radius-sm);cursor:pointer" onclick="App._retryAttendanceTableLoad('${safeEventId}','${safeContainerId}')">重新同步名單</button>
    </div>`;
  },

  _retryAttendanceTableLoad(eventId, containerId) {
    return this._renderAttendanceTable(eventId, containerId || 'attendance-table-container', {
      forceFetch: true,
      timeoutMs: this._getAttendanceTableFetchTimeoutMs(),
    });
  },

  _getTeamReservationMarkerImage(teamId) {
    const targetId = String(teamId || '').trim();
    if (!targetId || typeof ApiService === 'undefined') return '';
    const teams = ApiService.getTeams?.() || [];
    const team = ApiService.getTeam?.(targetId)
      || teams.find(t => {
        if (!t) return false;
        return [t.id, t._docId, t.docId, t.teamId]
          .map(v => String(v || '').trim())
          .filter(Boolean)
          .includes(targetId);
      });
    if (!team) return '';
    return this._getTeamImageUrl?.(team, 'card')
      || team.imageVariants?.card
      || team.imageVariants?.cover
      || team.image
      || team.coverImage
      || '';
  },

  _findCompanionRegistrationForAttendance(eventId, person, regs) {
    const safeUid = String(person?.uid || '').trim();
    const safeName = String(person?.name || person?.displayName || '').trim();
    const ownerUid = String(person?.ownerUid || person?.userId || '').trim();
    const allRegs = Array.isArray(regs) ? regs : ApiService.getRegistrationsByEvent(eventId);
    const companionRegs = (allRegs || []).filter(r =>
      r
      && this._isActiveAttendanceRegistration(r)
      && (r.participantType === 'companion' || r.companionId)
    );
    const byId = companionRegs.find(r => String(r.companionId || '').trim() === safeUid);
    if (byId) return byId;

    const scopedRegs = ownerUid
      ? companionRegs.filter(r => String(r.userId || '').trim() === ownerUid)
      : companionRegs;
    const byDerivedUid = scopedRegs.find(r => {
      const regOwnerUid = String(r.userId || '').trim();
      const regName = String(r.companionName || r.userName || '').trim();
      return regOwnerUid && regName && `${regOwnerUid}_${regName}` === safeUid;
    });
    if (byDerivedUid) return byDerivedUid;

    if (this._isCompanionPseudoUid(safeUid) || !safeName) return null;
    const nameMatches = scopedRegs.filter(r => String(r.companionName || r.userName || '').trim() === safeName);
    return nameMatches.length === 1 ? nameMatches[0] : null;
  },

  _buildAttendanceBaseRecord(eventId, person, regs) {
    const safeUid = String(person?.uid || '').trim();
    const safeName = String(person?.name || person?.displayName || '').trim();
    const mustBeCompanion = !!person?.isCompanion || this._isCompanionPseudoUid(safeUid);

    if (mustBeCompanion) {
      const cReg = this._findCompanionRegistrationForAttendance(eventId, person, regs);
      const ownerUid = String(cReg?.userId || '').trim();
      if (!cReg || !ownerUid || this._isCompanionPseudoUid(ownerUid)) {
        return {
          ok: false,
          reason: 'companion_registration_missing',
          personUid: safeUid,
          personName: safeName,
        };
      }
      const companionId = String(cReg.companionId || safeUid).trim();
      return {
        ok: true,
        record: {
          eventId,
          uid: ownerUid,
          userName: String(cReg.userName || '').trim(),
          participantType: 'companion',
          companionId,
          companionName: String(cReg.companionName || safeName).trim(),
        },
      };
    }

    if (!safeUid || this._isCompanionPseudoUid(safeUid)) {
      return {
        ok: false,
        reason: 'invalid_self_uid',
        personUid: safeUid,
        personName: safeName,
      };
    }

    return {
      ok: true,
      record: {
        eventId,
        uid: safeUid,
        userName: safeName,
        participantType: 'self',
        companionId: null,
        companionName: null,
      },
    };
  },

  _reportInvalidAttendanceBaseRecord(eventId, person, reason) {
    const msg = '同行者簽到資料尚未載入，請重新整理後再試';
    console.warn('[attendance-base-record-blocked]', {
      eventId,
      uid: person?.uid,
      name: person?.name || person?.displayName,
      reason,
    });
    this.showToast?.(msg);
    ApiService._writeErrorLog?.({
      fn: '_reportInvalidAttendanceBaseRecord',
      eventId,
      uid: person?.uid || '',
      name: person?.name || person?.displayName || '',
      reason,
    }, new Error(reason || 'invalid attendance base record'));
  },

  _matchAttendanceRecord(record, person) {
    if (person?.isTeamPlaceholder || person?.isTeamHeader) return false;
    const recordUid = String(record?.uid || '').trim();
    const recordUserName = String(record?.userName || '').trim();
    const recordCompanionId = String(record?.companionId || '').trim();
    const recordCompanionName = String(record?.companionName || '').trim();
    const personUid = String(person?.uid || '').trim();
    const personName = String(person?.name || person?.displayName || '').trim();
    const ownerUid = String(person?.ownerUid || person?.userId || '').trim();
    if (person.isCompanion) {
      if (!recordCompanionId) return false;
      if (ownerUid && recordUid !== ownerUid) return false;
      return recordCompanionId === personUid || (!!personName && recordCompanionName === personName);
    }
    if (this._isCompanionPseudoUid(personUid)) return false;
    return ((recordUid === personUid || (!!personName && recordUserName === personName)) && !recordCompanionId);
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

  _attRenderTimers: {},
  _attRenderJobs: {},

  /**
   * 2026-04-28 Plan B：用 event.participants / waitlistNames 陣列產出瞬間預覽 HTML
   * 結構與 full render 類似（避免 swap 視覺跳動）但只顯示名字 + 候補標籤
   * 後續 _doRenderAttendanceTable 走 fetch + full render 會無聲替換此內容
   */
  _renderAttendanceFastPreview(e, options = {}) {
    const escName = (n) => escapeHTML(String(n || '').trim());
    const confirmed = Array.isArray(e.participants) ? e.participants : [];
    const waitlist = Array.isArray(e.waitlistNames) ? e.waitlistNames : [];
    const pendingText = options?.degraded ? '待同步' : '載入中...';
    const rows = [];
    confirmed.forEach((name) => {
      const safe = escName(name);
      if (!safe) return;
      rows.push('<tr class="reg-row reg-row-fast">'
        + '<td style="padding:.45rem .5rem"><span class="reg-name-text">' + safe + '</span></td>'
        + '<td style="padding:.45rem .2rem;text-align:center;color:var(--text-muted);font-size:.72rem">' + pendingText + '</td>'
        + '</tr>');
    });
    waitlist.forEach((name) => {
      const safe = escName(name);
      if (!safe) return;
      rows.push('<tr class="reg-row reg-row-fast reg-row-waitlist">'
        + '<td style="padding:.45rem .5rem;color:var(--text-secondary)">'
        + '<span class="reg-name-text">↳ ' + safe + ' <span style="font-size:.7rem;color:var(--warning);font-weight:600">候補</span></span>'
        + '</td>'
        + '<td style="padding:.45rem .2rem;text-align:center;color:var(--text-muted);font-size:.72rem">—</td>'
        + '</tr>');
    });
    if (rows.length === 0) return '<div style="font-size:.8rem;color:var(--text-muted);padding:.3rem 0">尚無報名</div>';
    return '<table class="reg-attendance-table reg-attendance-fast">'
      + '<tbody>' + rows.join('') + '</tbody>'
      + '</table>';
  },

  async _renderAttendanceTable(eventId, containerId, options = {}) {
    // 防抖：多條路徑（onSnapshot / showEventDetail / instant-save）可能連續觸發
    // 100ms 內同一 containerId 只執行最後一次，避免 DOM 連續替換導致名單閃現
    // 不同 containerId 的呼叫互不影響（waitlist 操作後需同時更新兩個容器）
    var self = this;
    var key = containerId || 'attendance-table-container';
    if (key === 'detail-attendance-table'
      && typeof self._shouldRenderDetailAttendanceTable === 'function'
      && typeof self._renderDetailAttendanceSummaryShell === 'function') {
      var detailEvent = typeof ApiService !== 'undefined' ? ApiService.getEvent?.(eventId) : null;
      if (self._shouldRenderDetailAttendanceTable(eventId, detailEvent, options) === false) {
        var detailContainer = document.getElementById(key);
        if (detailContainer) detailContainer.innerHTML = self._renderDetailAttendanceSummaryShell(eventId, detailEvent, options);
        return Promise.resolve({ ok: true, reason: 'on-demand-summary' });
      }
    }
    // 啟用：window._perfAttLog = 1 或 localStorage.setItem('_perfAttLog','1')
    var _perfCallTs = (typeof window !== 'undefined' && (window._perfAttLog || (typeof localStorage !== 'undefined' && localStorage.getItem('_perfAttLog')))) ? performance.now() : 0;
    if (options?.skipFetch) {
      return Promise.resolve(self._doRenderAttendanceTable(eventId, key, _perfCallTs, options))
        .catch(function(err) {
          console.error('[AttendanceTable] render failed:', err);
          return { ok: false, reason: 'error', error: err };
        });
    }
    self._attRenderJobs = self._attRenderJobs || {};
    var job = self._attRenderJobs[key];
    if (!job) {
      job = { waiters: [] };
      self._attRenderJobs[key] = job;
    }
    job.eventId = eventId;
    job.containerId = key;
    job.perfCallTs = _perfCallTs;
    job.options = options || {};
    return new Promise(function (resolve) {
      job.waiters.push(resolve);
      clearTimeout(self._attRenderTimers[key]);
      self._attRenderTimers[key] = setTimeout(function () {
        var runJob = self._attRenderJobs[key] || job;
        delete self._attRenderJobs[key];
        self._attRenderTimers[key] = null;
        Promise.resolve(self._doRenderAttendanceTable(runJob.eventId, runJob.containerId, runJob.perfCallTs, runJob.options))
          .then(function(result) {
            runJob.waiters.splice(0).forEach(function(done) { done(result); });
          })
          .catch(function(err) {
            console.error('[AttendanceTable] render failed:', err);
            runJob.waiters.splice(0).forEach(function(done) {
              done({ ok: false, reason: 'error', error: err });
            });
          });
      }, 100);
    });
  },

  async _doRenderAttendanceTable(eventId, containerId, _perfCallTs, options = {}) {
    const cId = containerId || 'attendance-table-container';
    const container = document.getElementById(cId);
    if (!container) return;
    const startGuard = this._canPatchAttendanceTable(eventId, cId, container, options, 'start');
    if (!startGuard.ok) return startGuard;
    const _perfLog = _perfCallTs > 0;
    const _t0 = _perfLog ? performance.now() : 0;
    // 2026-04-20：鎖容器高度，防 innerHTML 替換期間頁面縮短導致 scrollTop 被瀏覽器 clamp
    App._lockContainerHeight?.(container);
    // 記住 containerId，供編輯流程重新渲染用
    this._manualEditingContainerId = cId;
    const e = ApiService.getEvent(eventId);
    if (!e) return;

    // ═══ 2026-04-28 Plan B：Fast Preview 瞬間預覽名單 ═══
    // 用 event 文件已維護的 participants / waitlistNames 陣列（CF 雙端維護、與子集合一致）
    // 條件：registrations cache 為空（首次進詳情頁、子集合尚未補查）
    // 效果：用戶 T+0 立刻看到名字、Phase B（fetch + full render）後再無聲替換為完整版
    const _cachedRegsForFast = ApiService.getRegistrationsByEvent(eventId);
    const _hasFastData = (Array.isArray(e.participants) && e.participants.length > 0)
      || (Array.isArray(e.waitlistNames) && e.waitlistNames.length > 0);
    // P1（rosterProjectionFirst）：尚無本活動 server 證明前，即使快取已有部分列，
    // detail 容器也先畫投影快顯，不讓登入用戶停在 skeleton 等網路往返
    const _projectionFirst = _hasFastData
      && this._shouldPaintDetailRosterProjectionFirst?.(eventId, e, cId, options) === true;
    if ((_cachedRegsForFast.length === 0 && _hasFastData) || _projectionFirst) {
      const fastPreviewGuard = this._canPatchAttendanceTable(eventId, cId, container, options, 'fast-preview');
      if (!fastPreviewGuard.ok) return fastPreviewGuard;
      container.innerHTML = this._renderAttendanceFastPreview(e);
      if (_perfLog) console.info('[perfAtt] roster preview painted +' + Math.round(performance.now() - _perfCallTs) + 'ms ' + (_projectionFirst ? 'projection-first' : 'empty-cache'));
    }

    // 舊活動可能超出全站監聽器 limit → 一次性從子集合補查
    let fetchIssue = null;
    if (!options?.skipFetch) {
      const fetchOptions = {
        timeoutMs: this._getAttendanceTableFetchTimeoutMs(options),
      };
      if (options?.forceFetch) fetchOptions.force = true;
      try {
        const publicRosterOnly = options?.publicRosterOnly === true;
        if (this._shouldSplitDetailRosterFetch(cId, options) || publicRosterOnly) {
          const registrationResult = await ApiService.fetchRegistrationsIfMissing(eventId, fetchOptions);
          fetchIssue = this._getAttendanceTableFetchIssue([registrationResult]);
          // P2（deferAttendanceRecords）：未結束活動的一般用戶不抓出席資料；
          // 已結束/可管理/具出席查看權者照常載入，並按需啟動 attendanceRecords listener
          if (!publicRosterOnly && this._shouldLoadDetailAttendanceData?.(e) !== false) {
            if (typeof FirebaseService !== 'undefined'
              && typeof FirebaseService.requestDetailAttendanceRealtime === 'function') {
              FirebaseService.requestDetailAttendanceRealtime();
            }
            this._scheduleDetailAttendanceRecordsPatch(eventId, cId, fetchOptions, options);
          }
        } else {
          const fetchResults = await Promise.all([
            ApiService.fetchAttendanceIfMissing(eventId, fetchOptions),
            ApiService.fetchRegistrationsIfMissing(eventId, fetchOptions),
          ]);
          fetchIssue = this._getAttendanceTableFetchIssue(fetchResults);
        }
      } catch (err) {
        console.warn('[AttendanceTable] fetch failed:', err);
        fetchIssue = {
          reason: err?.code === 'firestore-fetch-timeout' ? 'timeout' : 'error',
          error: err,
        };
      }
      if (fetchIssue) this._scheduleAttendanceTableLatePatch(eventId, cId, options);
    }
    const _t1 = _perfLog ? performance.now() : 0;

    const canManage = this._canOperateEventSite?.(e) === true;
    const publicRosterOnly = options?.publicRosterOnly === true;
    const showAttendanceRecordColumns = publicRosterOnly !== true;
    const records = showAttendanceRecordColumns ? ApiService.getAttendanceRecords(eventId) : [];
    const summary = this._buildConfirmedParticipantSummary(eventId);
    const people = summary.people;
    const _t2 = _perfLog ? performance.now() : 0;
    // 放鴿子 🕊 欄位查看權：admin(event.edit_all) / 主辦人 / 委託人 / 查看權持有者 / 放鴿子修改權持有者
    // 顯示限制：只在「管理名單」模式（tableEditing=true）才顯示，平時瀏覽名單一律隱藏
    const tableEditing = canManage && this._attendanceEditingEventId === eventId;
    const isSubmitting = canManage && this._attendanceSubmittingEventId === eventId;
    const noShowFeatureEnabled = typeof isNoShowFeatureEnabled === 'function'
      ? isNoShowFeatureEnabled()
      : true;
    const canViewNoShow = canManage
      || (typeof this.hasPermission === 'function' && this.hasPermission('activity.view_noshow'))
      || (typeof this.hasPermission === 'function' && this.hasPermission('admin.repair.no_show_adjust'));
    // 🕊 次數欄位：只在「管理名單」模式（tableEditing）才顯示，避免平時佔位
    const showNoShowColumn = showAttendanceRecordColumns && noShowFeatureEnabled && cId === 'detail-attendance-table' && canViewNoShow && tableEditing;
    const noShowCountByUid = showNoShowColumn ? this._buildNoShowCountByUid() : null;
    // 膠囊出席率染色：權限同步綁定（canViewNoShow），**不**受 tableEditing 限制 — 平時瀏覽名單時也染色
    const showAttendanceFill = showAttendanceRecordColumns && noShowFeatureEnabled && canViewNoShow;
    const endedRegCountByUid = showAttendanceFill ? this._buildEndedRegCountByUid() : null;
    // 膠囊染色獨立於欄位：即使欄位收起，仍需 noShow map 作為染色資料來源
    const noShowCountByUidForFill = showAttendanceFill
      ? (noShowCountByUid || this._buildNoShowCountByUid())
      : null;
    // 最近一場放鴿子泡泡：同條件，平時即顯示
    const lastNoShowSet = showAttendanceFill ? this._buildLastNoShowSet() : null;
    const _t3 = _perfLog ? performance.now() : 0;

    if (people.length === 0) {
      const emptyGuard = this._canPatchAttendanceTable(eventId, cId, container, options, 'empty');
      if (!emptyGuard.ok) return emptyGuard;
      const emptyManageBtn = canManage ? (tableEditing
        ? `<button style="font-size:.75rem;padding:.25rem .6rem;background:#2e7d32;color:#fff;border:none;border-radius:var(--radius-sm);${isSubmitting ? 'cursor:not-allowed;opacity:.72' : 'cursor:pointer'}" ${isSubmitting ? 'disabled' : ''} onclick="App._finishRosterManagement('${escapeHTML(eventId)}')">${isSubmitting ? '儲存中...' : '完成'}</button>`
        : `<button style="font-size:.75rem;padding:.25rem .6rem;background:#1565c0;color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer" onclick="App._startTableEdit('${escapeHTML(eventId)}')">管理名單</button>`
      ) : '';
      const emptyHeader = canManage
        ? `<div style="display:flex;align-items:center;gap:.4rem;white-space:nowrap;margin:.2rem 0 .4rem;font-size:.8rem;font-weight:600">報名名單（0/${escapeHTML(e.max || 0)}）${emptyManageBtn}</div>`
        : '';
      // 若 event.current > 0 或 participantsWithUid / participants 有人 → 視為「資料還在加載」
      // 顯示 spinner + skeleton，避免用戶誤以為沒人報名（2026-04-19 UX 改善）
      const expectedCount = this._getEventExpectedRosterCount(e);
      if (expectedCount > 0) {
        if (fetchIssue) {
          container.innerHTML = emptyHeader
            + (_hasFastData ? this._renderAttendanceFastPreview(e, { degraded: true }) : '')
            + this._renderAttendanceLoadIssue(eventId, cId, fetchIssue);
        } else {
          // 根據預期人數產出 1-3 個 skeleton row（最多 3 個避免佔太大）
          const rowCount = Math.min(3, expectedCount);
          const skeletonRows = Array(rowCount).fill('<div class="reg-loading-skeleton-row"></div>').join('');
          container.innerHTML = emptyHeader + '<div class="reg-loading">報名名單載入中...</div>'
            + '<div class="reg-loading-skeleton">' + skeletonRows + '</div>';
        }
      } else {
        container.innerHTML = emptyHeader + '<div style="font-size:.8rem;color:var(--text-muted);padding:.3rem 0">尚無報名</div>';
      }
      // 2026-04-20：移除「_scrollEl.scrollTop = _savedScrollY」還原邏輯
      // 原因：入口記錄的 _savedScrollY 在 await 期間若用戶主動滑動，會被此行覆蓋拉回舊位
      // 現有 _lockContainerHeight 已保護 innerHTML 替換期間的 clamp，無需再強制還原
      return;
    }

    // 分隊活動：依球衣顏色排序（toggle）
    const _tsEnabled = e.teamSplit?.enabled && Array.isArray(e.teamSplit.teams) && e.teamSplit.teams.length > 0;
    const canPickTeam = _tsEnabled && !tableEditing && this._canManageTeamSplit?.(e) === true;
    if (_tsEnabled && this._attendanceSortByTeam) {
      const teamOrder = {};
      e.teamSplit.teams.forEach((t, i) => { teamOrder[t.key] = i; });
      people.sort((a, b) => {
        const ta = teamOrder[a.teamKey] ?? 999;
        const tb = teamOrder[b.teamKey] ?? 999;
        return ta - tb;
      });
    }

    // 整表編輯模式（編輯簽到）— tableEditing 已於本函式上方宣告
    const pendingStateByUid = (isSubmitting || this._attendancePendingStateByUid) ? (this._attendancePendingStateByUid || Object.create(null)) : null;

    const kickStyle = 'font-size:.7rem;padding:.2rem .4rem;border:1px solid var(--danger);color:var(--danger);background:transparent;border-radius:var(--radius-sm);cursor:pointer;white-space:nowrap'
      + (isSubmitting ? ';opacity:.65;cursor:not-allowed' : '');
    const demoteStyle = 'font-size:.7rem;padding:.2rem .4rem;border:1px solid #8b5cf6;color:#8b5cf6;background:transparent;border-radius:var(--radius-sm);cursor:pointer;white-space:nowrap'
      + (isSubmitting ? ';opacity:.65;cursor:not-allowed' : '');
    const hasDemote = e.max > 0;
    const noteInputStyle = 'width:100%;font-size:.72rem;padding:.15rem .3rem;border:1px solid var(--border);border-radius:3px;box-sizing:border-box'
      + (isSubmitting ? ';opacity:.7;cursor:not-allowed' : '');
    const disabledAttr = isSubmitting ? 'disabled' : '';
    const _attCb = (id, checked) =>
      `<input type="checkbox" id="${id}" class="att-cb" ${checked ? 'checked' : ''} ${disabledAttr}><label for="${id}" class="att-lbl"><span class="att-box"></span></label>`;
    const attendanceRecordColumnCount = showAttendanceRecordColumns ? 3 : 0;
    const tableColspan = (tableEditing ? (1 + (hasDemote ? 1 : 0) + 1) : 1)
      + (showNoShowColumn ? 1 : 0)
      + attendanceRecordColumnCount;
    let rows = people.map(p => {
      if (p.isTeamGeneralSeparator) {
        return `<tr class="team-reservation-general-row"><td colspan="${tableColspan}">
          <div class="team-reservation-general-divider"><span>一般報名</span></div>
        </td></tr>`;
      }
      if (p.isTeamHeader) {
        const canAdjustTeam = !isSubmitting && this._isCurrentUserTeamStaff?.(p.teamReservationTeamId);
        const adjustBtn = canAdjustTeam
          ? `<button class="team-reservation-adjust-btn" onclick="App.openTeamReservationModal('${escapeHTML(eventId)}','${escapeHTML(p.teamReservationTeamId)}')">快速調整</button>`
          : '';
        const teamHeaderImageUrl = p.teamReservationTeamId ? this._getTeamReservationMarkerImage?.(p.teamReservationTeamId) : '';
        const teamHeaderAvatar = `<span class="team-reservation-section-avatar" aria-hidden="true">${
          teamHeaderImageUrl
            ? `<img class="team-reservation-section-avatar-img" src="${escapeHTML(teamHeaderImageUrl)}" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode('俱'))">`
            : '俱'
        }</span>`;
        return `<tr class="team-reservation-header-row"><td colspan="${tableColspan}" class="team-reservation-header-cell">
          <div class="team-reservation-section-title">
            <div class="team-reservation-section-main">
              ${teamHeaderAvatar}
              <strong class="team-reservation-section-name">${escapeHTML(p.teamReservationTeamName || p.displayName)}</strong>
            </div>
            <span class="team-reservation-summary">
              <span>佔位: ${Number(p.reservedSlots || 0)}</span>
              <span>已使用: ${Number(p.usedSlots || 0)}</span>
              <span>剩餘: ${Number(p.remainingSlots || 0)}</span>
            </span>
            ${adjustBtn}
          </div>
        </td></tr>`;
      }
      const isPlaceholder = !!p.isTeamPlaceholder;
      const isProxyOnly = !!p.proxyOnly || !!p.isProxyOnly;
      const pendingState = pendingStateByUid ? pendingStateByUid[String(p.uid)] : null;
      const hasCheckin = (isPlaceholder || isProxyOnly) ? false : (pendingState
        ? !!pendingState.checkin
        : records.some(r => this._matchAttendanceRecord(r, p) && r.type === 'checkin'));
      const hasCheckout = (isPlaceholder || isProxyOnly) ? false : (pendingState
        ? !!pendingState.checkout
        : records.some(r => this._matchAttendanceRecord(r, p) && r.type === 'checkout'));
      const noteRec = (isPlaceholder || isProxyOnly) ? null : this._getLatestAttendanceRecord(records, p, 'note');
      const noteText = pendingState ? (pendingState.note || '') : (noteRec?.note || '');
      const noShowCount = (showNoShowColumn && !isProxyOnly) ? this._getParticipantNoShowCount(p, noShowCountByUid) : null;
      const noShowCell = showNoShowColumn
        ? `<td style="padding:.35rem .2rem;text-align:center;width:3rem"><span title="放鴿子次數（已結束、正式報名且未完成簽到）" style="font-size:.78rem;font-weight:${noShowCount > 0 ? '700' : '600'};color:${noShowCount > 0 ? 'var(--danger)' : 'var(--text-muted)'}">${(noShowCount == null || isProxyOnly) ? '—' : (noShowCount > 0 ? noShowCount : '')}</span></td>`
        : '';
      const autoNote = p.proxyOnly ? '僅代報' : '';
      const combinedNote = [autoNote, noteText].filter(Boolean).join('・');
      const emptyAttendanceRecordCells = (label) => showAttendanceRecordColumns
        ? `<td style="padding:.35rem .2rem;text-align:center;color:var(--text-muted)">--</td>
          <td style="padding:.35rem .2rem;text-align:center;color:var(--text-muted)">--</td>
          <td style="padding:.35rem .3rem;font-size:.72rem;color:var(--text-muted)">${label}</td>`
        : '';
      const editAttendanceRecordCells = showAttendanceRecordColumns
        ? `<td style="padding:.35rem .2rem;text-align:center">${_attCb('manual-checkin-' + escapeHTML(p.uid), hasCheckin)}</td>
          <td style="padding:.35rem .2rem;text-align:center">${_attCb('manual-checkout-' + escapeHTML(p.uid), hasCheckout)}</td>
          <td style="padding:.35rem .3rem"><input type="text" maxlength="20" value="${escapeHTML(noteText)}" id="manual-note-${escapeHTML(p.uid)}" placeholder="備註" ${disabledAttr} style="${noteInputStyle}"></td>`
        : '';
      const readAttendanceRecordCells = showAttendanceRecordColumns
        ? `<td style="padding:.35rem .2rem;text-align:center">${hasCheckin ? '<span style="color:var(--success);font-size:1rem">✓</span>' : ''}</td>
          <td style="padding:.35rem .2rem;text-align:center">${hasCheckout ? '<span style="color:var(--success);font-size:1rem">✓</span>' : ''}</td>
          <td style="padding:.35rem .3rem;font-size:.72rem;color:var(--text-muted)">${escapeHTML(combinedNote)}</td>`
        : '';

      // 徽章縮圖
      const badges = p.displayBadges || [];
      const badgeHtml = badges.length
        ? '<span class="reg-badge-list">' + badges.map(b =>
            `<img class="reg-badge-icon" src="${escapeHTML(b.image || '')}" alt="${escapeHTML(b.name || '')}" loading="lazy">`
          ).join('') + '</span>'
        : '';

      // team-split: 傳遞 teamKey 給 _userTag 渲染色衣 badge
      // Phase 3 補強 (2026-04-19): 一律傳 uid 讓 showUserProfile 能跳對的人（修同暱稱 bug）
      const _tsTeams = e.teamSplit?.enabled ? e.teamSplit.teams : null;
      const _safeTeamKey = _tsTeams ? (this._tsSafeTeamKey?.(p.teamKey, e) || null) : null;
      const _attFill = (showAttendanceFill && !isProxyOnly && !p.isCompanion && !p.isTeamPlaceholder && p.uid)
        ? this._getParticipantAttendanceFill(p.uid, noShowCountByUidForFill, endedRegCountByUid)
        : null;
      const _recentNS = (lastNoShowSet && !isProxyOnly && !p.isCompanion && !p.isTeamPlaceholder && p.uid)
        ? lastNoShowSet.has(String(p.uid).trim())
        : false;
      const _canRenderTeamPicker = !!(_tsTeams && p.regDocId && !isProxyOnly && !p.isTeamPlaceholder);
      const _tagOpts = _tsTeams
        ? { uid: p.uid, teamKey: _safeTeamKey, teams: _tsTeams, showEmptyJersey: e.teamSplit?.enabled, canPickTeam: canPickTeam && !!p.regDocId, regDocId: p.regDocId, eventId: eventId, attendanceFill: _attFill, recentNoShow: _recentNS }
        : { uid: p.uid, attendanceFill: _attFill, recentNoShow: _recentNS };

      let nameInner;
      if (isProxyOnly) {
        nameInner = `<span class="reg-name-text" style="color:var(--text-muted);font-weight:600">${escapeHTML(p.displayName)}</span>`;
      } else if (p.isCompanion) {
        const companionName = _canRenderTeamPicker
          ? this._userTag(p.displayName, null, _tagOpts)
          : escapeHTML(p.displayName);
        nameInner = `<span class="reg-name-text" style="padding-left:1.2rem;color:var(--text-secondary)">↳ ${companionName}</span>`;
      } else if (p.isTeamPlaceholder) {
        nameInner = `<span class="reg-name-text team-reservation-placeholder-name">${escapeHTML(p.displayName)}</span>`;
      } else if (p.hasSelfReg || _canRenderTeamPicker) {
        nameInner = `<span class="reg-name-text">${this._userTag(p.displayName, null, _tagOpts)}</span>`;
      } else {
        nameInner = `<span class="reg-name-text">${escapeHTML(p.displayName)}</span>`;
      }
      const nameHtml = badgeHtml
        ? `<div class="reg-name-badges-wrap"><div class="reg-name-badges">${nameInner}${badgeHtml}</div></div>`
        : nameInner;

      const safeUid = escapeHTML(p.uid);
      const safeName = escapeHTML(p.name);
      const teamReservationRowAttr = p.teamReservationTeamId ? ' class="team-reservation-member-row"' : '';

      if (tableEditing) {
        if (isProxyOnly) {
          const emptyDemoteTd = hasDemote ? `<td style="padding:.35rem .2rem"></td>` : '';
          return `<tr data-uid="${safeUid}" style="border-bottom:1px solid var(--border);background:linear-gradient(90deg, rgba(148,163,184,.16), rgba(148,163,184,.04) 55%, transparent)">
          <td style="padding:.35rem .2rem"></td>${emptyDemoteTd}
          <td style="padding:.35rem .3rem;text-align:left">${nameHtml}</td>
          ${showNoShowColumn ? '<td style="padding:.35rem .2rem;text-align:center;color:var(--text-muted)">--</td>' : ''}
          ${emptyAttendanceRecordCells('僅代報')}
        </tr>`;
        }
        if (p.isTeamPlaceholder) {
          const emptyDemoteTd = hasDemote ? `<td style="padding:.35rem .2rem"></td>` : '';
          return `<tr data-uid="${safeUid}" class="team-reservation-placeholder-row">
          <td style="padding:.35rem .2rem"></td>${emptyDemoteTd}
          <td style="padding:.35rem .3rem;text-align:left">${nameHtml}</td>
          ${showNoShowColumn ? '<td style="padding:.35rem .2rem;text-align:center;color:var(--text-muted)">--</td>' : ''}
          ${emptyAttendanceRecordCells('保留席位')}
        </tr>`;
        }
        const kickTd = `<td style="padding:.35rem .2rem;text-align:center"><button style="${kickStyle}" ${disabledAttr} onclick="App._removeParticipant('${escapeHTML(eventId)}','${safeUid}','${safeName}',${p.isCompanion})">踢</button></td>`;
        const demotePending = !!this._isWaitlistActionPending?.('demote', eventId, p.uid);
        const demoteDisabledAttr = (isSubmitting || demotePending) ? 'disabled' : '';
        const demoteBtnStyle = demoteStyle + (demotePending && !isSubmitting ? ';opacity:.65;cursor:not-allowed' : '');
        const demoteTd = hasDemote && !p.isCompanion
          ? `<td style="padding:.35rem .2rem;text-align:center"><button style="${demoteBtnStyle}" ${demoteDisabledAttr} onclick="App._forceDemoteToWaitlist('${escapeHTML(eventId)}','${safeUid}','${safeName}',${p.isCompanion})">${demotePending ? '...' : '候'}</button></td>`
          : (hasDemote ? `<td style="padding:.35rem .2rem"></td>` : '');
        return `<tr data-uid="${safeUid}"${teamReservationRowAttr} style="border-bottom:1px solid var(--border)">
          ${kickTd}${demoteTd}
          <td style="padding:.35rem .3rem;text-align:left">${nameHtml}</td>
          ${noShowCell}
          ${editAttendanceRecordCells}
        </tr>`;
      }
      if (p.isTeamPlaceholder) {
        return `<tr class="team-reservation-placeholder-row">
        <td style="padding:.35rem .3rem;text-align:left">${nameHtml}</td>
        ${showNoShowColumn ? '<td style="padding:.35rem .2rem;text-align:center;color:var(--text-muted)">--</td>' : ''}
        ${emptyAttendanceRecordCells('保留席位')}
      </tr>`;
      }
      if (isProxyOnly) {
        return `<tr style="border-bottom:1px solid var(--border);background:linear-gradient(90deg, rgba(148,163,184,.16), rgba(148,163,184,.04) 55%, transparent)">
        <td style="padding:.35rem .3rem;text-align:left">${nameHtml}</td>
        ${showNoShowColumn ? '<td style="padding:.35rem .2rem;text-align:center;color:var(--text-muted)">--</td>' : ''}
        ${emptyAttendanceRecordCells('僅代報')}
      </tr>`;
      }
      return `<tr${teamReservationRowAttr} style="border-bottom:1px solid var(--border)">
        <td style="padding:.35rem .3rem;text-align:left">${nameHtml}</td>
        ${noShowCell}
        ${readAttendanceRecordCells}
      </tr>`;
    }).join('');
    const _t4 = _perfLog ? performance.now() : 0;

    // 編輯 / 完成 按鈕（右上角，僅管理員）
    const topBtn = canManage ? (tableEditing
      ? `<button style="font-size:.75rem;padding:.25rem .6rem;background:#2e7d32;color:#fff;border:none;border-radius:var(--radius-sm);${isSubmitting ? 'cursor:not-allowed;opacity:.72' : 'cursor:pointer'}" ${isSubmitting ? 'disabled' : ''} onclick="App._finishRosterManagement('${escapeHTML(eventId)}')">${isSubmitting ? '儲存中...' : '完成'}</button>`
      : `<button style="font-size:.75rem;padding:.25rem .6rem;background:#1565c0;color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer" onclick="App._startTableEdit('${escapeHTML(eventId)}')">管理名單</button>`
    ) : '';

    // 分隊排序按鈕（僅分隊活動顯示）
    const _sortBtnSvg = _tsEnabled
      ? `<button class="att-team-sort-btn${this._attendanceSortByTeam ? ' active' : ''}" onclick="event.stopPropagation();App._toggleAttendanceSortByTeam('${escapeHTML(eventId)}','${escapeHTML(cId)}')" title="依球衣顏色排序"><svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="${this._attendanceSortByTeam ? '#fff' : 'var(--text-secondary)'}" stroke-width="2" stroke-linecap="round"><path d="M6 4v12M6 4l-3 3M6 4l3 3"/><path d="M14 16V4M14 16l-3-3M14 16l3-3"/></svg></button>`
      : '';

    // 表頭：「報名名單（人數/上限）」欄含操作按鈕；編輯模式多「踢掉」欄
    const regCountText = `報名名單（${summary.count}/${e.max}）`;
    const nameThContent = `<div style="display:flex;align-items:center;gap:.4rem;white-space:nowrap">${_sortBtnSvg}${regCountText}${topBtn}</div>`;
    const noShowTh = showNoShowColumn
      ? `<th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:3rem" title="放鴿子次數（已結束、正式報名且未完成簽到）">🕊</th>`
      : '';
    const demoteTh = hasDemote ? '<th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2rem">候</th>' : '';
    const attendanceRecordHeaderTh = showAttendanceRecordColumns
      ? `<th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2.5rem">簽到</th>
          <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2.5rem">簽退</th>
          <th style="text-align:left;padding:.4rem .3rem;font-weight:600;width:4.5rem">備註</th>`
      : '';
    const thead = tableEditing
      ? `<tr style="border-bottom:2px solid var(--border)">
          <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2rem">踢</th>
          ${demoteTh}
          <th style="text-align:left;padding:.4rem .3rem;font-weight:600">${nameThContent}</th>
          ${noShowTh}
          ${attendanceRecordHeaderTh}
        </tr>`
      : `<tr style="border-bottom:2px solid var(--border)">
          <th style="text-align:left;padding:.4rem .3rem;font-weight:600">${nameThContent}</th>
          ${noShowTh}
          ${attendanceRecordHeaderTh}
        </tr>`;

    const fetchIssueHtml = fetchIssue ? this._renderAttendanceLoadIssue(eventId, cId, fetchIssue) : '';
    const finalGuard = this._canPatchAttendanceTable(eventId, cId, container, options, 'final');
    if (!finalGuard.ok) return finalGuard;
    container.innerHTML = `<div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:.8rem;table-layout:fixed">
        <thead>${thead}</thead>
        <tbody>${rows}</tbody>
      </table>
    </div>${fetchIssueHtml}`;
    // 2026-04-20：移除「_scrollEl.scrollTop = _savedScrollY」還原
    // （await 期間用戶滑走會被拉回的 bug）。_lockContainerHeight 已負責防 clamp
    this._bindAttendanceCheckboxLink(container, 'manual-checkin-', 'manual-checkout-');
    if (tableEditing && typeof this._bindInstantSaveHandler === 'function') {
      this._bindInstantSaveHandler(container, eventId, 'reg');
    }
    this._bindBadgeRowSnapBack(container);
    this._markBadgeRowOverflow(container);
    if (_perfLog) {
      const _t5 = performance.now();
      console.log('[att-perf]', {
        event: eventId,
        cid: cId,
        people: people.length,
        edit: tableEditing,
        debounce_ms: +(_t0 - _perfCallTs).toFixed(1),
        fetch_ms: +(_t1 - _t0).toFixed(1),
        summary_ms: +(_t2 - _t1).toFixed(1),
        noshow_ms: +(_t3 - _t2).toFixed(1),
        rows_ms: +(_t4 - _t3).toFixed(1),
        html_bind_ms: +(_t5 - _t4).toFixed(1),
        total_render_ms: +(_t5 - _t0).toFixed(1),
        total_with_debounce_ms: +(_t5 - _perfCallTs).toFixed(1),
      });
    }
  },

  // ── 分隊排序 toggle ──
  _attendanceSortByTeam: false,

  _toggleAttendanceSortByTeam(eventId, containerId) {
    this._attendanceSortByTeam = !this._attendanceSortByTeam;
    this._renderAttendanceTable(eventId, containerId);
  },

  /** 徽章行滑動彈回：放手後 scrollLeft 彈回 0 */
  _bindBadgeRowSnapBack(container) {
    if (!container) return;
    container.querySelectorAll('.reg-name-badges').forEach(row => {
      if (row.dataset.snapBound) return;
      row.dataset.snapBound = '1';
      const snapBack = () => {
        if (row.scrollLeft > 0) {
          row.style.scrollBehavior = 'smooth';
          row.scrollLeft = 0;
          setTimeout(() => { row.style.scrollBehavior = ''; }, 350);
        }
      };
      row.addEventListener('touchend', snapBack, { passive: true });
      row.addEventListener('touchcancel', snapBack, { passive: true });
    });
  },

  /** 徽章行溢出偵測：有溢出時在 wrapper 加 has-overflow 顯示漸層提示 */
  _markBadgeRowOverflow(container) {
    if (!container) return;
    requestAnimationFrame(() => {
      container.querySelectorAll('.reg-name-badges-wrap').forEach(wrap => {
        const row = wrap.querySelector('.reg-name-badges');
        if (row) wrap.classList.toggle('has-overflow', row.scrollWidth > row.clientWidth);
      });
    });
  },

  // ── 未報名單表格（活動詳情頁用）──
  _renderUnregTable(eventId, containerId, options = {}) {
    const cId = containerId || 'detail-unreg-table';
    const container = document.getElementById(cId);
    if (!container) return;
    const isDetailContainer = cId === 'detail-unreg-table' || options?.mode === 'detail';
    const patchOptions = isDetailContainer
      ? (this._getCurrentEventDetailPatchContext?.(cId, options) || options)
      : options;
    const canPatchUnreg = () => {
      if (!isDetailContainer
        || typeof this._isCurrentEventDetailPatch !== 'function'
        || this._isActivityDetailLatePatchGuardEnabled?.() === false) {
        return { ok: true, reason: 'ok' };
      }
      return this._isCurrentEventDetailPatch(eventId, patchOptions?.requestSeq ?? null, {
        container,
        containerId: cId,
        renderToken: patchOptions?.renderToken || null,
        patchType: 'unregistered',
      });
    };
    let patchGuard = canPatchUnreg();
    if (!patchGuard.ok) return patchGuard;
    // 2026-04-20：鎖容器高度，防 innerHTML='' 後頁面縮短導致 scrollTop 被 clamp
    App._lockContainerHeight?.(container);
    const _scrollEl = document.scrollingElement || document.documentElement;
    const _savedScrollY = _scrollEl.scrollTop;
    const e = ApiService.getEvent(eventId);
    if (!e) return;

    const canManage = this._canOperateEventSite?.(e) === true;
    const records = ApiService.getAttendanceRecords(eventId);

    // 收集不重複的未報名用戶
    const unregMap = new Map();
    records.forEach(r => {
      if (r.type === 'unreg' && !unregMap.has(r.uid))
        unregMap.set(r.uid, { name: r.userName, uid: r.uid });
    });

    const section = document.getElementById('detail-unreg-section');

    if (unregMap.size === 0) {
      patchGuard = canPatchUnreg();
      if (!patchGuard.ok) return patchGuard;
      if (section) section.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    patchGuard = canPatchUnreg();
    if (!patchGuard.ok) return patchGuard;
    if (section) section.style.display = '';

    const tableEditing = canManage && this._unregEditingEventId === eventId;
    const isSubmitting = canManage && this._unregSubmittingEventId === eventId;
    const pendingStateByUid = (isSubmitting || this._unregPendingStateByUid) ? (this._unregPendingStateByUid || Object.create(null)) : null;
    const kickStyle = 'font-size:.7rem;padding:.2rem .4rem;border:1px solid var(--danger);color:var(--danger);background:transparent;border-radius:var(--radius-sm);cursor:pointer;white-space:nowrap'
      + (isSubmitting ? ';opacity:.65;cursor:not-allowed' : '');
    const noteInputStyle = 'width:100%;font-size:.72rem;padding:.15rem .3rem;border:1px solid var(--border);border-radius:3px;box-sizing:border-box'
      + (isSubmitting ? ';opacity:.7;cursor:not-allowed' : '');
    const disabledAttr = isSubmitting ? 'disabled' : '';
    const _attCb = (id, checked) =>
      `<input type="checkbox" id="${id}" class="att-cb" ${checked ? 'checked' : ''} ${disabledAttr}><label for="${id}" class="att-lbl"><span class="att-box"></span></label>`;

    const people = [];
    unregMap.forEach(u => people.push(u));
    people.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

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
        return `<tr data-uid="${safeUid}" style="border-bottom:1px solid var(--border)">
          <td style="padding:.35rem .2rem;text-align:center"><button style="${kickStyle}" ${disabledAttr} onclick="App._removeUnregUser('${escapeHTML(eventId)}','${safeUid}','${safeName}')">踢掉</button></td>
          <td style="padding:.35rem .3rem;text-align:left" data-no-translate>${nameHtml}</td>
          <td style="padding:.35rem .2rem;text-align:center">${_attCb('unreg-checkin-' + safeUid, hasCheckin)}</td>
          <td style="padding:.35rem .2rem;text-align:center">${_attCb('unreg-checkout-' + safeUid, hasCheckout)}</td>
          <td style="padding:.35rem .3rem"><input type="text" maxlength="20" value="${escapeHTML(noteText)}" id="unreg-note-${safeUid}" placeholder="備註" ${disabledAttr} style="${noteInputStyle}"></td>
        </tr>`;
      }
      return `<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:.35rem .3rem;text-align:left" data-no-translate>${nameHtml}</td>
        <td style="padding:.35rem .2rem;text-align:center">${hasCheckin ? '<span style="color:var(--success);font-size:1rem">✓</span>' : ''}</td>
        <td style="padding:.35rem .2rem;text-align:center">${hasCheckout ? '<span style="color:var(--success);font-size:1rem">✓</span>' : ''}</td>
        <td style="padding:.35rem .3rem;font-size:.72rem;color:var(--text-muted)">${escapeHTML(combinedNote)}</td>
      </tr>`;
    }).join('');

    // 編輯 / 完成 按鈕（放在表頭「未報名單」右側）
    const topBtn = canManage ? (tableEditing
      ? `<button style="font-size:.75rem;padding:.25rem .6rem;background:#2e7d32;color:#fff;border:none;border-radius:var(--radius-sm);${isSubmitting ? 'cursor:not-allowed;opacity:.72' : 'cursor:pointer'}" ${isSubmitting ? 'disabled' : ''} onclick="App._confirmAllUnregAttendance('${escapeHTML(eventId)}')">${isSubmitting ? '儲存中...' : '完成'}</button>`
      : `<button style="font-size:.75rem;padding:.25rem .6rem;background:#1565c0;color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer" onclick="App._startUnregTableEdit('${escapeHTML(eventId)}')">編輯</button>`
    ) : '';

    const nameThContent = topBtn
      ? `<div style="display:flex;align-items:center;gap:.4rem;white-space:nowrap">未報名單（${people.length}）${topBtn}</div>`
      : `未報名單（${people.length}）`;

    const thead = tableEditing
      ? `<tr style="border-bottom:2px solid var(--border)">
          <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2rem">踢</th>
          <th style="text-align:left;padding:.4rem .3rem;font-weight:600">${nameThContent}</th>
          <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2.5rem">簽到</th>
          <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2.5rem">簽退</th>
          <th style="text-align:left;padding:.4rem .3rem;font-weight:600;width:4.5rem">備註</th>
        </tr>`
      : `<tr style="border-bottom:2px solid var(--border)">
          <th style="text-align:left;padding:.4rem .3rem;font-weight:600">${nameThContent}</th>
          <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2.5rem">簽到</th>
          <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2.5rem">簽退</th>
          <th style="text-align:left;padding:.4rem .3rem;font-weight:600;width:4.5rem">備註</th>
        </tr>`;

    patchGuard = canPatchUnreg();
    if (!patchGuard.ok) return patchGuard;
    container.innerHTML = `<div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:.8rem;table-layout:fixed">
        <thead>${thead}</thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
    _scrollEl.scrollTop = _savedScrollY;
    this._bindAttendanceCheckboxLink(container, 'unreg-checkin-', 'unreg-checkout-');
    if (tableEditing && typeof this._bindInstantSaveHandler === 'function') {
      this._bindInstantSaveHandler(container, eventId, 'unreg');
    }
  },

});
