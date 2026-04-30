/* === SportHub — Attendance table rendering & helpers ===
   Note: innerHTML usage is safe — all user content passes through escapeHTML()
   依賴：event-manage-noshow.js (participant summary), event-manage.js (shared helpers)
   ======================================================= */

Object.assign(App, {

  _attendanceEditingEventId: null,
  _unregEditingEventId: null,
  _manualEditingContainerId: null,

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
    const allRegs = Array.isArray(regs) ? regs : ApiService.getRegistrationsByEvent(eventId);
    const companionRegs = (allRegs || []).filter(r =>
      r
      && this._isActiveAttendanceRegistration(r)
      && (r.participantType === 'companion' || r.companionId)
    );
    return companionRegs.find(r => String(r.companionId || '').trim() === safeUid)
      || (!this._isCompanionPseudoUid(safeUid)
        ? companionRegs.find(r => String(r.companionName || r.userName || '').trim() === safeName)
        : null)
      || null;
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
    if (person.isCompanion) {
      return record.companionId && (record.companionId === person.uid || record.companionName === person.name);
    }
    if (this._isCompanionPseudoUid(person?.uid)) return false;
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

  _attRenderTimers: {},

  /**
   * 2026-04-28 Plan B：用 event.participants / waitlistNames 陣列產出瞬間預覽 HTML
   * 結構與 full render 類似（避免 swap 視覺跳動）但只顯示名字 + 候補標籤
   * 後續 _doRenderAttendanceTable 走 fetch + full render 會無聲替換此內容
   */
  _renderAttendanceFastPreview(e) {
    const escName = (n) => escapeHTML(String(n || '').trim());
    const confirmed = Array.isArray(e.participants) ? e.participants : [];
    const waitlist = Array.isArray(e.waitlistNames) ? e.waitlistNames : [];
    const rows = [];
    confirmed.forEach((name) => {
      const safe = escName(name);
      if (!safe) return;
      rows.push('<tr class="reg-row reg-row-fast">'
        + '<td style="padding:.45rem .5rem"><span class="reg-name-text">' + safe + '</span></td>'
        + '<td style="padding:.45rem .2rem;text-align:center;color:var(--text-muted);font-size:.72rem">載入中...</td>'
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

  async _renderAttendanceTable(eventId, containerId) {
    // 防抖：多條路徑（onSnapshot / showEventDetail / instant-save）可能連續觸發
    // 100ms 內同一 containerId 只執行最後一次，避免 DOM 連續替換導致名單閃現
    // 不同 containerId 的呼叫互不影響（waitlist 操作後需同時更新兩個容器）
    var self = this;
    var key = containerId || 'attendance-table-container';
    // 啟用：window._perfAttLog = 1 或 localStorage.setItem('_perfAttLog','1')
    var _perfCallTs = (typeof window !== 'undefined' && (window._perfAttLog || (typeof localStorage !== 'undefined' && localStorage.getItem('_perfAttLog')))) ? performance.now() : 0;
    return new Promise(function (resolve) {
      clearTimeout(self._attRenderTimers[key]);
      self._attRenderTimers[key] = setTimeout(function () {
        self._doRenderAttendanceTable(eventId, key, _perfCallTs).then(resolve);
      }, 100);
    });
  },

  async _doRenderAttendanceTable(eventId, containerId, _perfCallTs) {
    const cId = containerId || 'attendance-table-container';
    const container = document.getElementById(cId);
    if (!container) return;
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
    if (_cachedRegsForFast.length === 0 && _hasFastData) {
      container.innerHTML = this._renderAttendanceFastPreview(e);
    }

    // 舊活動可能超出全站監聽器 limit → 一次性從子集合補查
    await Promise.all([
      ApiService.fetchAttendanceIfMissing(eventId),
      ApiService.fetchRegistrationsIfMissing(eventId),
    ]);
    const _t1 = _perfLog ? performance.now() : 0;

    const canManage = this._canManageEvent(e);
    const records = ApiService.getAttendanceRecords(eventId);
    const summary = this._buildConfirmedParticipantSummary(eventId);
    const people = summary.people;
    const _t2 = _perfLog ? performance.now() : 0;
    // 放鴿子 🕊 欄位查看權：admin(event.edit_all) / 主辦人 / 委託人 / 查看權持有者 / 放鴿子修改權持有者
    const canViewNoShow = canManage
      || (typeof this.hasPermission === 'function' && this.hasPermission('activity.view_noshow'))
      || (typeof this.hasPermission === 'function' && this.hasPermission('admin.repair.no_show_adjust'));
    const showNoShowColumn = cId === 'detail-attendance-table' && canViewNoShow;
    const noShowCountByUid = showNoShowColumn ? this._buildNoShowCountByUid() : null;
    const _t3 = _perfLog ? performance.now() : 0;

    if (people.length === 0) {
      // 若 event.current > 0 或 participantsWithUid / participants 有人 → 視為「資料還在加載」
      // 顯示 spinner + skeleton，避免用戶誤以為沒人報名（2026-04-19 UX 改善）
      const expectedCount = Number(e.current || 0)
        || (Array.isArray(e.participantsWithUid) ? e.participantsWithUid.length : 0)
        || (Array.isArray(e.participants) ? e.participants.length : 0);
      if (expectedCount > 0) {
        // 根據預期人數產出 1-3 個 skeleton row（最多 3 個避免佔太大）
        const rowCount = Math.min(3, expectedCount);
        const skeletonRows = Array(rowCount).fill('<div class="reg-loading-skeleton-row"></div>').join('');
        container.innerHTML = '<div class="reg-loading">報名名單載入中...</div>'
          + '<div class="reg-loading-skeleton">' + skeletonRows + '</div>';
      } else {
        container.innerHTML = '<div style="font-size:.8rem;color:var(--text-muted);padding:.3rem 0">尚無報名</div>';
      }
      // 2026-04-20：移除「_scrollEl.scrollTop = _savedScrollY」還原邏輯
      // 原因：入口記錄的 _savedScrollY 在 await 期間若用戶主動滑動，會被此行覆蓋拉回舊位
      // 現有 _lockContainerHeight 已保護 innerHTML 替換期間的 clamp，無需再強制還原
      return;
    }

    // 分隊活動：依球衣顏色排序（toggle）
    const _tsEnabled = e.teamSplit?.enabled && Array.isArray(e.teamSplit.teams) && e.teamSplit.teams.length > 0;
    if (_tsEnabled && this._attendanceSortByTeam) {
      const teamOrder = {};
      e.teamSplit.teams.forEach((t, i) => { teamOrder[t.key] = i; });
      people.sort((a, b) => {
        const ta = teamOrder[a.teamKey] ?? 999;
        const tb = teamOrder[b.teamKey] ?? 999;
        return ta - tb;
      });
    }

    // 整表編輯模式（編輯簽到）
    const tableEditing = canManage && this._attendanceEditingEventId === eventId;
    const isSubmitting = canManage && this._attendanceSubmittingEventId === eventId;
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
    const tableColspan = (tableEditing ? (1 + (hasDemote ? 1 : 0) + 1) : 1)
      + (showNoShowColumn ? 1 : 0)
      + 3;
    let rows = people.map(p => {
      if (p.isTeamHeader) {
        const canAdjustTeam = !isSubmitting && this._isCurrentUserTeamStaff?.(p.teamReservationTeamId);
        const adjustBtn = canAdjustTeam
          ? `<button style="font-size:.72rem;padding:.18rem .5rem;border:1px solid #0f766e;color:#0f766e;background:#fff;border-radius:var(--radius-sm);cursor:pointer;white-space:nowrap" onclick="App.openTeamReservationModal('${escapeHTML(eventId)}','${escapeHTML(p.teamReservationTeamId)}')">快速調整</button>`
          : '';
        return `<tr class="team-reservation-header-row"><td colspan="${tableColspan}" style="padding:.45rem .55rem;background:#eff6ff;border-bottom:1px solid #bfdbfe;color:#1e3a8a">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem;flex-wrap:wrap">
            <strong>${escapeHTML(p.teamReservationTeamName || p.displayName)}</strong>
            <span style="font-size:.76rem;color:#1d4ed8">原團隊佔位：${Number(p.reservedSlots || 0)}　已使用：${Number(p.usedSlots || 0)}　剩餘：${Number(p.remainingSlots || 0)}</span>
            ${adjustBtn}
          </div>
        </td></tr>`;
      }
      const isPlaceholder = !!p.isTeamPlaceholder;
      const pendingState = pendingStateByUid ? pendingStateByUid[String(p.uid)] : null;
      const hasCheckin = isPlaceholder ? false : (pendingState
        ? !!pendingState.checkin
        : records.some(r => this._matchAttendanceRecord(r, p) && r.type === 'checkin'));
      const hasCheckout = isPlaceholder ? false : (pendingState
        ? !!pendingState.checkout
        : records.some(r => this._matchAttendanceRecord(r, p) && r.type === 'checkout'));
      const noteRec = isPlaceholder ? null : this._getLatestAttendanceRecord(records, p, 'note');
      const noteText = pendingState ? (pendingState.note || '') : (noteRec?.note || '');
      const noShowCount = showNoShowColumn ? this._getParticipantNoShowCount(p, noShowCountByUid) : null;
      const noShowCell = showNoShowColumn
        ? `<td style="padding:.35rem .2rem;text-align:center;width:3rem"><span title="放鴿子次數（已結束、正式報名且未完成簽到）" style="font-size:.78rem;font-weight:${noShowCount > 0 ? '700' : '600'};color:${noShowCount > 0 ? 'var(--danger)' : 'var(--text-muted)'}">${noShowCount == null ? '—' : (noShowCount > 0 ? noShowCount : '')}</span></td>`
        : '';
      const autoNote = p.proxyOnly ? '僅代報' : '';
      const combinedNote = [autoNote, noteText].filter(Boolean).join('・');

      // 徽章縮圖
      const badges = p.displayBadges || [];
      const teamSeatImageUrl = p.teamReservationTeamId ? this._getTeamReservationMarkerImage?.(p.teamReservationTeamId) : '';
      const teamSeatMarker = p.teamReservationTeamId
        ? `<button type="button" class="team-seat-club-marker" title="俱樂部席位" aria-label="俱樂部席位" onclick="event.stopPropagation();App.showToast('${escapeHTML(p.teamReservationTeamName || '俱樂部')}俱樂部席位')">${teamSeatImageUrl ? `<img class="team-seat-club-marker-img" src="${escapeHTML(teamSeatImageUrl)}" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode('🚩'))">` : '🚩'}</button>`
        : '';
      const badgeHtml = badges.length
        ? '<span class="reg-badge-list">' + badges.map(b =>
            `<img class="reg-badge-icon" src="${escapeHTML(b.image || '')}" alt="${escapeHTML(b.name || '')}" loading="lazy">`
          ).join('') + '</span>'
        : '';

      // team-split: 傳遞 teamKey 給 _userTag 渲染色衣 badge
      // Phase 3 補強 (2026-04-19): 一律傳 uid 讓 showUserProfile 能跳對的人（修同暱稱 bug）
      const _tsTeams = e.teamSplit?.enabled ? e.teamSplit.teams : null;
      const _safeTeamKey = _tsTeams ? (this._tsSafeTeamKey?.(p.teamKey, e) || null) : null;
      const _tagOpts = _tsTeams
        ? { uid: p.uid, teamKey: _safeTeamKey, teams: _tsTeams, showEmptyJersey: e.teamSplit?.enabled, canPickTeam: canManage && !tableEditing, regDocId: p.regDocId, eventId: eventId }
        : { uid: p.uid };

      let nameInner;
      if (p.isCompanion) {
        nameInner = `<span class="reg-name-text" style="padding-left:1.2rem;color:var(--text-secondary)">↳ ${escapeHTML(p.displayName)}</span>`;
      } else if (p.isTeamPlaceholder) {
        nameInner = `<span class="reg-name-text" style="color:#1d4ed8;font-weight:600">${teamSeatMarker}${escapeHTML(p.displayName)}</span>`;
      } else if (p.hasSelfReg) {
        nameInner = `<span class="reg-name-text">${teamSeatMarker}${this._userTag(p.displayName, null, _tagOpts)}</span>`;
      } else {
        nameInner = `<span class="reg-name-text">${teamSeatMarker}${escapeHTML(p.displayName)}</span>`;
      }
      const nameHtml = badgeHtml
        ? `<div class="reg-name-badges-wrap"><div class="reg-name-badges">${nameInner}${badgeHtml}</div></div>`
        : nameInner;

      const safeUid = escapeHTML(p.uid);
      const safeName = escapeHTML(p.name);

      if (tableEditing) {
        if (p.isTeamPlaceholder) {
          const emptyDemoteTd = hasDemote ? `<td style="padding:.35rem .2rem"></td>` : '';
          return `<tr data-uid="${safeUid}" style="border-bottom:1px solid var(--border);background:#f8fbff">
          <td style="padding:.35rem .2rem"></td>${emptyDemoteTd}
          <td style="padding:.35rem .3rem;text-align:left">${nameHtml}</td>
          ${showNoShowColumn ? '<td style="padding:.35rem .2rem;text-align:center;color:var(--text-muted)">--</td>' : ''}
          <td style="padding:.35rem .2rem;text-align:center;color:var(--text-muted)">--</td>
          <td style="padding:.35rem .2rem;text-align:center;color:var(--text-muted)">--</td>
          <td style="padding:.35rem .3rem;font-size:.72rem;color:var(--text-muted)">保留席位</td>
        </tr>`;
        }
        const kickTd = `<td style="padding:.35rem .2rem;text-align:center"><button style="${kickStyle}" ${disabledAttr} onclick="App._removeParticipant('${escapeHTML(eventId)}','${safeUid}','${safeName}',${p.isCompanion})">踢</button></td>`;
        const demoteTd = hasDemote && !p.isCompanion
          ? `<td style="padding:.35rem .2rem;text-align:center"><button style="${demoteStyle}" ${disabledAttr} onclick="App._forceDemoteToWaitlist('${escapeHTML(eventId)}','${safeUid}','${safeName}',${p.isCompanion})">候</button></td>`
          : (hasDemote ? `<td style="padding:.35rem .2rem"></td>` : '');
        return `<tr data-uid="${safeUid}" style="border-bottom:1px solid var(--border)">
          ${kickTd}${demoteTd}
          <td style="padding:.35rem .3rem;text-align:left">${nameHtml}</td>
          ${noShowCell}
          <td style="padding:.35rem .2rem;text-align:center">${_attCb('manual-checkin-' + safeUid, hasCheckin)}</td>
          <td style="padding:.35rem .2rem;text-align:center">${_attCb('manual-checkout-' + safeUid, hasCheckout)}</td>
          <td style="padding:.35rem .3rem"><input type="text" maxlength="20" value="${escapeHTML(noteText)}" id="manual-note-${safeUid}" placeholder="備註" ${disabledAttr} style="${noteInputStyle}"></td>
        </tr>`;
      }
      if (p.isTeamPlaceholder) {
        return `<tr style="border-bottom:1px solid var(--border);background:#f8fbff">
        <td style="padding:.35rem .3rem;text-align:left">${nameHtml}</td>
        ${showNoShowColumn ? '<td style="padding:.35rem .2rem;text-align:center;color:var(--text-muted)">--</td>' : ''}
        <td style="padding:.35rem .2rem;text-align:center;color:var(--text-muted)">--</td>
        <td style="padding:.35rem .2rem;text-align:center;color:var(--text-muted)">--</td>
        <td style="padding:.35rem .3rem;font-size:.72rem;color:var(--text-muted)">保留席位</td>
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
    const _t4 = _perfLog ? performance.now() : 0;

    // 編輯 / 完成 按鈕（右上角，僅管理員）
    const topBtn = canManage ? (tableEditing
      ? `<button style="font-size:.75rem;padding:.25rem .6rem;background:#2e7d32;color:#fff;border:none;border-radius:var(--radius-sm);${isSubmitting ? 'cursor:not-allowed;opacity:.72' : 'cursor:pointer'}" ${isSubmitting ? 'disabled' : ''} onclick="App._confirmAllAttendance('${escapeHTML(eventId)}')">${isSubmitting ? '儲存中...' : '完成'}</button>`
      : `<button style="font-size:.75rem;padding:.25rem .6rem;background:#1565c0;color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer" onclick="App._startTableEdit('${escapeHTML(eventId)}')">編輯</button>`
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
    const thead = tableEditing
      ? `<tr style="border-bottom:2px solid var(--border)">
          <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2rem">踢</th>
          ${demoteTh}
          <th style="text-align:left;padding:.4rem .3rem;font-weight:600">${nameThContent}</th>
          ${noShowTh}
          <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2.5rem">簽到</th>
          <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2.5rem">簽退</th>
          <th style="text-align:left;padding:.4rem .3rem;font-weight:600;width:4.5rem">備註</th>
        </tr>`
      : `<tr style="border-bottom:2px solid var(--border)">
          <th style="text-align:left;padding:.4rem .3rem;font-weight:600">${nameThContent}</th>
          ${noShowTh}
          <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2.5rem">簽到</th>
          <th style="text-align:center;padding:.4rem .2rem;font-weight:600;width:2.5rem">簽退</th>
          <th style="text-align:left;padding:.4rem .3rem;font-weight:600;width:4.5rem">備註</th>
        </tr>`;

    container.innerHTML = `<div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:.8rem;table-layout:fixed">
        <thead>${thead}</thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
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
  _renderUnregTable(eventId, containerId) {
    const cId = containerId || 'detail-unreg-table';
    const container = document.getElementById(cId);
    if (!container) return;
    // 2026-04-20：鎖容器高度，防 innerHTML='' 後頁面縮短導致 scrollTop 被 clamp
    App._lockContainerHeight?.(container);
    const _scrollEl = document.scrollingElement || document.documentElement;
    const _savedScrollY = _scrollEl.scrollTop;
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
