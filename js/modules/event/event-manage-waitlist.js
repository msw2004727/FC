/* === SportHub — Waitlist management table ===
   Note: innerHTML usage is safe — all user content passes through escapeHTML()
   依賴：event-manage.js (shared helpers), event-manage-attendance.js (rendering)
   ============================================= */

Object.assign(App, {

  // ── 候補名單表格（管理模態 - 分組顯示 + 正取編輯模式）──
  _renderWaitlistSection(eventId, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const e = ApiService.getEvent(eventId);
    if (!e) { container.innerHTML = ''; return; }

    const canManage = this._canManageEvent(e);
    const tableEditing = this._waitlistEditingEventId === eventId;
    const allActiveRegs = ApiService.getRegistrationsByEvent(eventId);
    const _regTime = (r) => {
      const v = r && r.registeredAt;
      if (!v) return Number.POSITIVE_INFINITY;
      if (typeof v.toMillis === 'function') { try { return v.toMillis(); } catch (_e) {} }
      if (typeof v === 'object' && typeof v.seconds === 'number')
        return (v.seconds * 1000) + Math.floor((v.nanoseconds || 0) / 1000000);
      const t = new Date(v).getTime();
      return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
    };
    const waitlistedRegs = allActiveRegs.filter(r => r.status === 'waitlisted')
      .sort((a, b) => {
        const ta = _regTime(a), tb = _regTime(b);
        if (ta !== tb) return ta - tb;
        return String(a._docId || a.id || '').localeCompare(String(b._docId || b.id || ''));
      });
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

    // 依 event.waitlistNames 順序重排，確保所有角色看到一致排序
    const wlOrder = e.waitlistNames || [];
    if (wlOrder.length > 0) {
      const orderMap = new Map();
      wlOrder.forEach((name, i) => orderMap.set(name, i));
      items.sort((a, b) => {
        const ia = orderMap.has(a.name) ? orderMap.get(a.name) : 99999;
        const ib = orderMap.has(b.name) ? orderMap.get(b.name) : 99999;
        return ia - ib;
      });
    }

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
        rows += `<tr><td colspan="${colCount - 1}"></td><td style="padding:.1rem .3rem;padding-left:1.2rem;font-size:.72rem;color:var(--text-muted)" data-no-translate>↳ 報名人：${escapeHTML(item.selfOrphanInfo)}（<span style="color:var(--success)">已正取</span>）</td></tr>`;
      }
      item.companions.forEach(c => {
        const cName = typeof c === 'string' ? c : c.name;
        const orphan = typeof c === 'object' ? c.orphanInfo : null;
        rows += `<tr style="border-bottom:1px solid var(--border)">
          ${tableEditing ? '<td></td>' : ''}
          <td style="padding:.3rem .3rem"></td>
          <td style="padding:.3rem .3rem;text-align:left;padding-left:1.2rem" data-no-translate><span style="color:var(--text-secondary)">↳ ${escapeHTML(cName)}</span></td>
        </tr>`;
        if (orphan) {
          rows += `<tr><td colspan="${colCount - 1}"></td><td style="padding:.1rem .3rem;padding-left:1.8rem;font-size:.72rem;color:var(--text-muted)" data-no-translate>↳ 報名人：${escapeHTML(orphan)}（<span style="color:var(--success)">已正取</span>）</td></tr>`;
        }
      });
    });

    const promoteTh = tableEditing
      ? `<th style="text-align:center;padding:.4rem .3rem;font-weight:600;width:3rem">正取</th>`
      : '';
    /* innerHTML — safe: all dynamic values pass through escapeHTML() */
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

    // 套用投影到本地快取
    e.current = occupancy.current;
    e.waitlist = occupancy.waitlist;
    e.participants = occupancy.participants;
    e.waitlistNames = occupancy.waitlistNames;
    e.status = occupancy.status;

    if (typeof FirebaseService !== 'undefined' && typeof FirebaseService._saveToLS === 'function') {
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

    var _promotedNames = userWaitlisted.map(function(r) { return r.participantType === 'companion' ? (r.companionName || r.userName) : r.userName; }).filter(Boolean);
    ApiService._writeOpLog('force_promote', '手動正取', `活動「${e.title}」將 ${_promotedNames.join('、')} 從候補升為正取`, eventId);

    // Re-render both possible containers (one will be absent = no-op)
    this._renderWaitlistSection(eventId, 'waitlist-table-container');
    this._renderGroupedWaitlistSection(eventId, 'detail-waitlist-container');
    // Re-render attendance tables
    this._renderAttendanceTable(eventId, this._manualEditingContainerId || 'attendance-table-container');
    this._renderAttendanceTable(eventId, 'detail-attendance-table');
    this.showToast('已正取');
  },

  /** 強制將正取用戶下放至候補（含同行者），方案 A：自然排序 */
  async _forceDemoteToWaitlist(eventId, userId, userName, isCompanion) {
    // 同行者不能單獨下放，必須從主報名者操作
    if (isCompanion) { this.showToast('請從主報名者操作下放'); return; }
    const e = ApiService.getEvent(eventId);
    if (!e) return;
    if (!e.max || e.max <= 0) { this.showToast('此活動無名額上限，無法下放候補'); return; }

    const allRegs = ApiService.getRegistrationsByEvent(eventId);
    const userConfirmed = allRegs.filter(r => r.userId === userId && r.status === 'confirmed');
    if (userConfirmed.length === 0) { this.showToast('找不到正取紀錄'); return; }

    const companionCount = userConfirmed.filter(r => r.participantType === 'companion').length;
    const confirmMsg = companionCount > 0
      ? `確定將 ${userName}（含 ${companionCount} 位同行者）下放到候補嗎？`
      : `確定將 ${userName} 下放到候補嗎？`;
    if (!await this.appConfirm(confirmMsg)) return;

    if (!await this._ensureActivityRecordsReady({ required: true })) return;

    // 蒐集 activityRecord（非同行者才有）
    const arSource = ApiService._src('activityRecords');
    const arRecords = [];
    for (const reg of userConfirmed) {
      if (reg.participantType !== 'companion') {
        const ar = arSource.find(a => a.eventId === eventId && a.uid === reg.userId && a.status === 'registered');
        if (ar && ar._docId) arRecords.push(ar);
      }
    }

    // 模擬模式：先在副本上計算，commit 成功後才寫快取
    const prevRegStates = userConfirmed.map(r => ({ ref: r, prev: r.status }));
    const prevArStates = arRecords.map(r => ({ ref: r, prev: r.status }));
    userConfirmed.forEach(r => { r.status = 'waitlisted'; });
    arRecords.forEach(r => { r.status = 'waitlisted'; });

    const activeAfter = (ApiService._src('registrations') || []).filter(
      r => r.eventId === eventId && (r.status === 'confirmed' || r.status === 'waitlisted')
    );
    var occupancy;
    if (typeof FirebaseService !== 'undefined' && typeof FirebaseService._rebuildOccupancy === 'function') {
      occupancy = FirebaseService._rebuildOccupancy(e, activeAfter);
    } else {
      var confirmed = activeAfter.filter(r => r.status === 'confirmed');
      var waitlisted = activeAfter.filter(r => r.status === 'waitlisted');
      occupancy = {
        participants: confirmed.map(r => this._getRegistrationParticipantName(r)).filter(Boolean),
        waitlistNames: waitlisted.map(r => this._getRegistrationParticipantName(r)).filter(Boolean),
        current: confirmed.length,
        waitlist: waitlisted.length,
        status: confirmed.length >= (e.max || 0) ? 'full' : 'open',
      };
    }

    try {
      var eventDocId = String(e._docId || '').trim();
      if (!eventDocId) throw new Error('EVENT_DOC_ID_MISSING');
      var batch = db.batch();
      for (var i = 0; i < userConfirmed.length; i++) {
        if (userConfirmed[i]._docId) {
          batch.update(db.collection('registrations').doc(userConfirmed[i]._docId), { status: 'waitlisted' });
        }
      }
      var arDocIds = new Set();
      arRecords.forEach(function (r) {
        if (r._docId && !arDocIds.has(r._docId)) {
          arDocIds.add(r._docId);
          batch.update(db.collection('activityRecords').doc(r._docId), { status: 'waitlisted' });
        }
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
      console.error('[forceDemote]', err);
      // rollback
      prevRegStates.forEach(function (s) { s.ref.status = s.prev; });
      prevArStates.forEach(function (s) { s.ref.status = s.prev; });
      this.showToast('儲存失敗，請重試');
      return;
    }

    // commit 成功 → 套用投影
    e.current = occupancy.current;
    e.waitlist = occupancy.waitlist;
    e.participants = occupancy.participants;
    e.waitlistNames = occupancy.waitlistNames;
    e.status = occupancy.status;

    if (typeof FirebaseService !== 'undefined' && typeof FirebaseService._saveToLS === 'function') {
      FirebaseService._saveToLS('registrations', FirebaseService._cache.registrations);
      FirebaseService._saveToLS('activityRecords', FirebaseService._cache.activityRecords);
      FirebaseService._saveToLS('events', FirebaseService._cache.events);
    }

    // 通知被下放的用戶
    this._sendNotifFromTemplate('waitlist_demoted', {
      eventName: e.title,
      date: e.date,
      location: e.location,
    }, userId, 'activity', '活動');

    ApiService._writeOpLog('force_demote', '下放候補', `活動「${e.title}」將 ${userName} 下放至候補`, eventId);

    // 重新渲染
    this._renderWaitlistSection(eventId, 'waitlist-table-container');
    this._renderGroupedWaitlistSection(eventId, 'detail-waitlist-container');
    this._renderAttendanceTable(eventId, this._manualEditingContainerId || 'attendance-table-container');
    this._renderAttendanceTable(eventId, 'detail-attendance-table');
    this.showToast(`已將 ${userName} 下放至候補`);
  },

});
