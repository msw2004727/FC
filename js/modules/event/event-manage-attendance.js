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

    // 整表編輯模式（編輯簽到）
    const tableEditing = canManage && this._attendanceEditingEventId === eventId;
    const isSubmitting = canManage && this._attendanceSubmittingEventId === eventId;
    const pendingStateByUid = (isSubmitting || this._attendancePendingStateByUid) ? (this._attendancePendingStateByUid || Object.create(null)) : null;

    const kickStyle = 'font-size:.7rem;padding:.2rem .4rem;border:1px solid var(--danger);color:var(--danger);background:transparent;border-radius:var(--radius-sm);cursor:pointer;white-space:nowrap'
      + (isSubmitting ? ';opacity:.65;cursor:not-allowed' : '');
    const noteInputStyle = 'width:100%;font-size:.72rem;padding:.15rem .3rem;border:1px solid var(--border);border-radius:3px;box-sizing:border-box'
      + (isSubmitting ? ';opacity:.7;cursor:not-allowed' : '');
    const disabledAttr = isSubmitting ? 'disabled' : '';
    const _attCb = (id, checked) =>
      `<input type="checkbox" id="${id}" class="att-cb" ${checked ? 'checked' : ''} ${disabledAttr}><label for="${id}" class="att-lbl"><span class="att-box"></span></label>`;

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

      // 徽章縮圖
      const badges = p.displayBadges || [];
      const badgeHtml = badges.length
        ? '<span class="reg-badge-list">' + badges.map(b =>
            `<img class="reg-badge-icon" src="${escapeHTML(b.image || '')}" alt="${escapeHTML(b.name || '')}" loading="lazy">`
          ).join('') + '</span>'
        : '';

      // team-split: 傳遞 teamKey 給 _userTag 渲染色衣 badge
      const _tsTeams = e.teamSplit?.enabled ? e.teamSplit.teams : null;
      const _safeTeamKey = _tsTeams ? (this._tsSafeTeamKey?.(p.teamKey, e) || null) : null;
      const _tagOpts = _tsTeams ? { teamKey: _safeTeamKey, teams: _tsTeams, showEmptyJersey: e.teamSplit?.enabled, canPickTeam: canManage && !tableEditing, regDocId: p.regDocId, eventId: eventId } : undefined;

      let nameInner;
      if (p.isCompanion) {
        nameInner = `<span class="reg-name-text" style="padding-left:1.2rem;color:var(--text-secondary)">↳ ${escapeHTML(p.displayName)}</span>`;
      } else if (p.hasSelfReg) {
        nameInner = `<span class="reg-name-text">${this._userTag(p.displayName, null, _tagOpts)}</span>`;
      } else {
        nameInner = `<span class="reg-name-text">${escapeHTML(p.displayName)}</span>`;
      }
      const nameHtml = badgeHtml
        ? `<div class="reg-name-badges-wrap"><div class="reg-name-badges">${nameInner}${badgeHtml}</div></div>`
        : nameInner;

      const safeUid = escapeHTML(p.uid);
      const safeName = escapeHTML(p.name);

      if (tableEditing) {
        const kickTd = `<td style="padding:.35rem .2rem;text-align:center"><button style="${kickStyle}" ${disabledAttr} onclick="App._removeParticipant('${escapeHTML(eventId)}','${safeUid}','${safeName}',${p.isCompanion})">踢掉</button></td>`;
        return `<tr data-uid="${safeUid}" style="border-bottom:1px solid var(--border)">
          ${kickTd}
          <td style="padding:.35rem .3rem;text-align:left">${nameHtml}</td>
          ${noShowCell}
          <td style="padding:.35rem .2rem;text-align:center">${_attCb('manual-checkin-' + safeUid, hasCheckin)}</td>
          <td style="padding:.35rem .2rem;text-align:center">${_attCb('manual-checkout-' + safeUid, hasCheckout)}</td>
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

    // 編輯 / 完成簽到 按鈕（右上角，僅管理員）
    const topBtn = canManage ? (tableEditing
      ? `<button style="font-size:.75rem;padding:.25rem .6rem;background:#2e7d32;color:#fff;border:none;border-radius:var(--radius-sm);${isSubmitting ? 'cursor:not-allowed;opacity:.72' : 'cursor:pointer'}" ${isSubmitting ? 'disabled' : ''} onclick="App._confirmAllAttendance('${escapeHTML(eventId)}')">${isSubmitting ? '儲存中...' : '完成簽到'}</button>`
      : `<button style="font-size:.75rem;padding:.25rem .6rem;background:#1565c0;color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer" onclick="App._startTableEdit('${escapeHTML(eventId)}')">編輯</button>`
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
    this._bindAttendanceCheckboxLink(container, 'manual-checkin-', 'manual-checkout-');
    if (tableEditing && typeof this._bindInstantSaveHandler === 'function') {
      this._bindInstantSaveHandler(container, eventId, 'reg');
    }
    this._bindBadgeRowSnapBack(container);
    this._markBadgeRowOverflow(container);
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

    // 編輯 / 完成簽到 按鈕（放在表頭「未報名單」右側）
    const topBtn = canManage ? (tableEditing
      ? `<button style="font-size:.75rem;padding:.25rem .6rem;background:#2e7d32;color:#fff;border:none;border-radius:var(--radius-sm);${isSubmitting ? 'cursor:not-allowed;opacity:.72' : 'cursor:pointer'}" ${isSubmitting ? 'disabled' : ''} onclick="App._confirmAllUnregAttendance('${escapeHTML(eventId)}')">${isSubmitting ? '儲存中...' : '完成簽到'}</button>`
      : `<button style="font-size:.75rem;padding:.25rem .6rem;background:#1565c0;color:#fff;border:none;border-radius:var(--radius-sm);cursor:pointer" onclick="App._startUnregTableEdit('${escapeHTML(eventId)}')">編輯</button>`
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
    this._bindAttendanceCheckboxLink(container, 'unreg-checkin-', 'unreg-checkout-');
    if (tableEditing && typeof this._bindInstantSaveHandler === 'function') {
      this._bindInstantSaveHandler(container, eventId, 'unreg');
    }
  },

});
