/* ================================================
   SportHub — Event: Signup & Cancel (with Companions)
   依賴：event-detail.js, event-list.js, api-service.js, auto-exp.js, message-inbox.js
   同行者 Modal 邏輯位於 event-detail-companion.js
   ================================================ */

Object.assign(App, {

  _beginEventActionBusy(key, message = '系統已在處理中') {
    const busyKey = String(key || '').trim();
    if (!busyKey) return false;
    this._eventActionBusyMap = this._eventActionBusyMap || Object.create(null);
    if (this._eventActionBusyMap[busyKey]) {
      this.showToast(message);
      return false;
    }
    const timeoutId = setTimeout(() => {
      delete this._eventActionBusyMap[busyKey];
    }, 20000);
    this._eventActionBusyMap[busyKey] = { timeoutId };
    return true;
  },

  _endEventActionBusy(key) {
    const busyKey = String(key || '').trim();
    const item = this._eventActionBusyMap?.[busyKey];
    if (item?.timeoutId) clearTimeout(item.timeoutId);
    if (this._eventActionBusyMap) delete this._eventActionBusyMap[busyKey];
  },

  _isActiveSelfRegistrationRecord(reg) {
    const status = String(reg?.status || '').trim();
    const participantType = String(reg?.participantType || '').trim();
    return participantType !== 'companion' && status !== 'cancelled' && status !== 'removed';
  },

  _hasActiveSelfRegistrationForEvent(eventId, userId) {
    const regs = ApiService.getMyRegistrationsByEvent?.(eventId) || [];
    return regs.some(reg =>
      this._isActiveSelfRegistrationRecord(reg)
      && (!userId || reg.userId === userId || reg.uid === userId)
    );
  },

  _isDuplicateSignupError(err) {
    const code = String(err?.details || err?.code || '').trim();
    const message = String(err?.message || err || '');
    return code === 'ALREADY_REGISTERED'
      || message.includes('已報名')
      || message.includes('已經報名')
      || (message.includes('撌脣') && message.includes('瘣餃'));
  },

  _isMissingCancelRegistrationError(err) {
    const code = String(err?.details || err?.code || '').trim();
    const message = String(err?.message || err || '');
    return code === 'REG_NOT_FOUND'
      || message.includes('報名記錄不存在')
      || message.includes('找不到報名');
  },

  // ══════════════════════════════════
  //  Signup & Cancel
  // ══════════════════════════════════

  /** 恢復報名時移除該活動的取消紀錄（恢復報名則不列為取消） */
  _removeCancelRecordOnResignup(eventId, uid) {
    const source = ApiService._src('activityRecords');
    const canDelete = this.hasPermission('event.edit_all');
    for (let i = source.length - 1; i >= 0; i--) {
      if (source[i].eventId === eventId && source[i].uid === uid && source[i].status === 'cancelled') {
        if (canDelete && source[i]._docId) {
          var _delDocId = source[i]._docId;
          FirebaseService._getEventDocIdAsync(eventId).then(function(_evDocId) {
            if (_evDocId) db.collection('events').doc(_evDocId).collection('activityRecords').doc(_delDocId).delete();
          }).catch(function(err) { console.error('[removeCancelRecord]', err); });
        }
        source.splice(i, 1);
      }
    }
  },

  _notifySignupCancelledInbox(eventData, targetUid, isWaitlist) {
    if (!eventData || !targetUid || typeof this._deliverMessageWithLinePush !== 'function') return;
    const title = isWaitlist ? '取消候補通知' : '取消報名通知';
    const statusLabel = isWaitlist ? '已取消候補' : '已取消報名';
    const body =
      `${statusLabel}：\n\n` +
      `活動名稱：${eventData.title || '-'}\n` +
      `活動時間：${eventData.date || '-'}\n` +
      `活動地點：${eventData.location || '-'}\n\n` +
      '如需再次參加，可回到活動頁重新報名。';
    this._deliverMessageWithLinePush(
      title,
      body,
      'activity',
      '活動',
      targetUid,
      '系統',
      null,
      { lineOptions: { source: 'event_cancel_signup:legacy' } }
    );
  },

  _notifySignupCancelledInboxFromTemplate(eventData, targetUid, isWaitlist) {
    if (
      !eventData ||
      !targetUid ||
      typeof this._deliverMessageWithLinePush !== 'function' ||
      typeof this._renderTemplate !== 'function'
    ) return;
    const vars = {
      eventName: eventData.title || '-',
      date: eventData.date || '-',
      location: eventData.location || '-',
      status: isWaitlist ? '已取消候補' : '已取消報名',
    };
    const fallbackTemplate = {
      title: '取消報名通知',
      body: '{status}：\n\n活動名稱：{eventName}\n活動時間：{date}\n活動地點：{location}\n\n如之後想再次參加，請回到活動頁重新報名。',
    };
    const tpl = ApiService.getNotifTemplate?.('cancel_signup') || fallbackTemplate;
    const title = this._renderTemplate(tpl.title, vars);
    const body = this._renderTemplate(tpl.body, vars);
    this._deliverMessageWithLinePush(
      title,
      body,
      'activity',
      '活動',
      targetUid,
      '系統',
      null,
      { lineOptions: { source: 'template:cancel_signup' } }
    );
  },

  async _syncMyEventRegistrations(eventId, userId) {
    if (!eventId || !userId) return [];
    try {
      await FirebaseService.ensureAuthReadyForWrite?.();
      if (!auth?.currentUser) return ApiService.getMyRegistrationsByEvent(eventId);

      const _eventDocId = await FirebaseService._getEventDocIdAsync(eventId);
      if (!_eventDocId) return ApiService.getMyRegistrationsByEvent(eventId);
      const regsRef = db.collection('events').doc(_eventDocId).collection('registrations');
      let snapshot = await regsRef
        .where('userId', '==', userId)
        .get();
      if (snapshot.empty) {
        snapshot = await regsRef
          .where('uid', '==', userId)
          .get();
      }

      const allDocs = snapshot.docs.map(doc => {
        const data = { ...doc.data(), _docId: doc.id };
        if (data.userId && !data.uid) data.uid = data.userId;
        if (data.uid && !data.userId) data.userId = data.uid;
        return data;
      });
      const activeDocs = allDocs.filter(r => r.status !== 'cancelled' && r.status !== 'removed');
      const source = FirebaseService._cache.registrations || [];
      FirebaseService._cache.registrations = source
        .filter(r => !(r.eventId === eventId && (r.userId === userId || r.uid === userId)))
        .concat(allDocs);
      FirebaseService._saveToLS?.('registrations', FirebaseService._cache.registrations);
      return activeDocs;
    } catch (err) {
      console.warn('[cancelSignup] sync registrations fallback failed:', err);
      return ApiService.getMyRegistrationsByEvent(eventId);
    }
  },

  _getTeamReservationStaffTeams(e) {
    const user = ApiService.getCurrentUser?.() || null;
    if (!user?.uid) return [];
    const teams = ApiService.getTeams?.() || [];
    return teams.filter(t => t?.id && this._isCurrentUserTeamStaff?.(t.id));
  },

  _getTeamReservationCandidateTeamIds() {
    const user = ApiService.getCurrentUser?.() || null;
    if (!user?.uid) return [];
    const ids = [];
    const seen = new Set();
    const pushId = (id) => {
      const value = String(id || '').trim();
      if (!value || seen.has(value)) return;
      seen.add(value);
      ids.push(value);
    };

    if (typeof this._getUserTeamIds === 'function') {
      this._getUserTeamIds(user).forEach(pushId);
    } else {
      if (Array.isArray(user.teamIds)) user.teamIds.forEach(pushId);
      pushId(user.teamId);
    }

    const uid = user.uid || '';
    const name = user.displayName || user.name || '';
    const adminUsers = ApiService.getAdminUsers?.() || [];
    const adminUser = adminUsers.find(u => (uid && u.uid === uid) || (name && u.name === name));
    if (adminUser) {
      if (Array.isArray(adminUser.teamIds)) adminUser.teamIds.forEach(pushId);
      pushId(adminUser.teamId);
    }

    (ApiService.getTeams?.() || []).forEach(t => {
      if (t?.id && this._isCurrentUserTeamStaff?.(t.id)) pushId(t.id);
      if (t?._docId && this._isCurrentUserTeamStaff?.(t._docId)) pushId(t._docId);
    });
    return ids;
  },

  async _ensureTeamReservationStaffTeamsLoaded() {
    if (this._getTeamReservationStaffTeams().length > 0) {
      return this._getTeamReservationStaffTeams();
    }
    try {
      const candidateIds = this._getTeamReservationCandidateTeamIds();
      const missingIds = candidateIds.filter(id => {
        const targetId = String(id || '').trim();
        if (!targetId) return false;
        return !(ApiService.getTeams?.() || []).some(t =>
          [t?.id, t?._docId, t?.docId].map(v => String(v || '').trim()).includes(targetId)
        );
      });

      if (missingIds.length && typeof FirebaseService !== 'undefined' && FirebaseService.fetchTeamIfMissing) {
        await Promise.all(missingIds.map(id => FirebaseService.fetchTeamIfMissing(id)));
      }

      let teams = this._getTeamReservationStaffTeams();
      if (!teams.length && typeof FirebaseService !== 'undefined' && FirebaseService.ensureStaticCollectionsLoaded) {
        const role = String((ApiService.getCurrentUser?.() || {}).role || '');
        const staffRole = ['coach', 'captain', 'venue_owner', 'admin', 'super_admin'].includes(role);
        if (staffRole) {
          await FirebaseService.ensureStaticCollectionsLoaded(['teams']);
          teams = this._getTeamReservationStaffTeams();
        }
      }
      return teams;
    } catch (err) {
      console.warn('[teamReservation] staff teams hydrate failed:', err);
    }
    return this._getTeamReservationStaffTeams();
  },

  _getTeamReservationSummary(e, teamId) {
    const summaries = (typeof FirebaseService !== 'undefined' && FirebaseService._normalizeTeamReservationSummaries)
      ? FirebaseService._normalizeTeamReservationSummaries(e)
      : (Array.isArray(e?.teamReservationSummaries) ? e.teamReservationSummaries : []);
    return summaries.find(item => String(item.teamId || '') === String(teamId || '')) || null;
  },

  _getTeamReservationSignupChoices(e) {
    if (!e) return [];
    const candidateIds = new Set(this._getTeamReservationCandidateTeamIds().map(id => String(id || '').trim()).filter(Boolean));
    if (!candidateIds.size) return [];
    const summaries = (typeof FirebaseService !== 'undefined' && FirebaseService._normalizeTeamReservationSummaries)
      ? FirebaseService._normalizeTeamReservationSummaries(e)
      : (Array.isArray(e?.teamReservationSummaries) ? e.teamReservationSummaries : []);
    const seen = new Set();
    return summaries
      .filter(item => item && candidateIds.has(String(item.teamId || '').trim()))
      .filter(item => Number(item.reservedSlots || 0) > 0 || Number(item.usedSlots || 0) > 0)
      .map(item => {
        const teamId = String(item.teamId || '').trim();
        if (!teamId || seen.has(teamId)) return null;
        seen.add(teamId);
        return {
          teamId,
          teamName: item.teamName || item.name || teamId,
          reservedSlots: Math.max(0, Number(item.reservedSlots || 0) || 0),
          usedSlots: Math.max(0, Number(item.usedSlots || 0) || 0),
          remainingSlots: Math.max(0, Number(item.remainingSlots || 0) || 0),
        };
      })
      .filter(Boolean);
  },

  async _resolveTeamReservationSignupChoice(e, opts = {}) {
    await this._ensureTeamReservationStaffTeamsLoaded?.();
    const choices = this._getTeamReservationSignupChoices(e);
    if (!choices.length) return { teamId: '', choices };
    const preferredTeamId = String(opts?.preferredTeamReservationTeamId || '').trim();
    if (preferredTeamId) {
      const selected = choices.find(item => item.teamId === preferredTeamId);
      if (selected) return { teamId: selected.teamId, choices };
    }
    if (choices.length === 1) return { teamId: choices[0].teamId, choices };
    return { teamId: '', choices, requiresSelection: true };
  },

  openTeamReservationSignupChoiceModal(eventId, choices = [], mode = 'signup') {
    const validChoices = (Array.isArray(choices) ? choices : []).filter(item => item?.teamId);
    if (!validChoices.length) return;
    let modal = document.getElementById('team-reservation-signup-choice-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'team-reservation-signup-choice-modal';
      document.body.appendChild(modal);
    }
    const safeMode = mode === 'companion' ? 'companion' : 'signup';
    modal.className = 'team-reservation-overlay';
    modal.setAttribute('role', 'presentation');
    modal.removeAttribute('onclick');
    const optionHtml = validChoices.map((item, idx) => {
      const selectedClass = idx === 0 ? ' is-selected' : '';
      const ariaChecked = idx === 0 ? 'true' : 'false';
      const reserved = Math.max(0, Number(item.reservedSlots || 0) || 0);
      const used = Math.max(0, Number(item.usedSlots || 0) || 0);
      const remaining = Math.max(0, Number(item.remainingSlots || 0) || 0);
      const safeTeamId = escapeHTML(item.teamId);
      return `
        <button type="button" class="team-reservation-choice-card${selectedClass}" data-team-id="${safeTeamId}" role="radio" aria-checked="${ariaChecked}" onclick="App.selectTeamReservationSignupChoice(this.dataset.teamId)">
          <span class="team-reservation-choice-mark" aria-hidden="true"></span>
          <span class="team-reservation-choice-main">
            <span class="team-reservation-choice-name">${escapeHTML(item.teamName || item.teamId)}</span>
            <span class="team-reservation-choice-meta">席位 ${reserved} · 已用 ${used} · 剩 ${remaining}</span>
          </span>
        </button>`;
    }).join('');
    modal.innerHTML = `
      <div class="team-reservation-dialog" role="dialog" aria-modal="true" aria-labelledby="team-reservation-signup-choice-title" onclick="event.stopPropagation()">
        <div class="team-reservation-dialog-header">
          <h3 id="team-reservation-signup-choice-title">選擇報名俱樂部</h3>
          <button type="button" class="team-reservation-close" onclick="App.closeTeamReservationSignupChoiceModal()" aria-label="關閉">×</button>
        </div>
        <div class="team-reservation-dialog-body">
          <div class="team-reservation-note">你符合多個俱樂部席位，請選擇本次要使用的俱樂部。</div>
          <div class="team-reservation-choice-list" role="radiogroup" aria-label="報名俱樂部">
            ${optionHtml}
          </div>
        </div>
        <div class="team-reservation-dialog-actions">
          <button type="button" class="outline-btn" onclick="App.closeTeamReservationSignupChoiceModal()">取消</button>
          <button type="button" class="primary-btn" id="team-reservation-signup-choice-confirm-btn" onclick="App.confirmTeamReservationSignupChoice('${escapeHTML(eventId)}','${safeMode}')">確認報名</button>
        </div>
      </div>`;
    modal.classList.add('open');
    document.body.classList.add('modal-open');
  },

  selectTeamReservationSignupChoice(teamId) {
    const modal = document.getElementById('team-reservation-signup-choice-modal');
    if (!modal) return;
    const selectedTeamId = String(teamId || '').trim();
    modal.querySelectorAll('.team-reservation-choice-card').forEach(card => {
      const isSelected = String(card.dataset.teamId || '').trim() === selectedTeamId;
      card.classList.toggle('is-selected', isSelected);
      card.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    });
  },

  closeTeamReservationSignupChoiceModal() {
    const modal = document.getElementById('team-reservation-signup-choice-modal');
    if (modal) modal.classList.remove('open');
    const teamModal = document.getElementById('team-reservation-modal');
    const companionModalOpen = document.getElementById('companion-select-overlay')?.classList?.contains('open');
    if (!teamModal?.classList?.contains('open') && !companionModalOpen) {
      document.body.classList.remove('modal-open');
    }
  },

  confirmTeamReservationSignupChoice(eventId, mode = 'signup') {
    const busyKey = 'team-reservation-choice:' + String(mode || 'signup') + ':' + String(eventId || '');
    if (!this._beginEventActionBusy(busyKey)) return;
    const confirmBtn = document.getElementById('team-reservation-signup-choice-confirm-btn');
    const originalText = confirmBtn?.textContent || '';
    const selected = document.querySelector('#team-reservation-signup-choice-modal .team-reservation-choice-card.is-selected');
    const teamId = String(selected?.dataset?.teamId || '').trim();
    if (!teamId) {
      this._endEventActionBusy(busyKey);
      this.showToast('請先選擇報名俱樂部');
      return;
    }
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = '處理中...';
    }
    this.closeTeamReservationSignupChoiceModal();
    const opts = { preferredTeamReservationTeamId: teamId };
    const action = mode === 'companion'
      ? this._confirmCompanionRegister?.(opts)
      : this.handleSignup(eventId, opts);
    void Promise.resolve(action).finally(() => {
      this._endEventActionBusy(busyKey);
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = originalText || '確認報名';
      }
    });
  },

  _renderTeamReservationActionButton(e, opts = {}) {
    if (!e || opts.regsLoading || opts.isGuestView || opts.isEnded || opts.isUpcoming || opts.teamBlocked) return '';
    const teams = this._getTeamReservationStaffTeams(e);
    if (!teams.length) return '';
    const active = teams.find(t => {
      const summary = this._getTeamReservationSummary(e, t.id);
      return summary && (Number(summary.reservedSlots || 0) > 0 || Number(summary.usedSlots || 0) > 0);
    });
    const label = active ? '調整名額' : '團隊報名';
    const bg = '#2563eb';
    const glow = '#60a5fa';
    const hint = active ? '調整團隊名額中' : '建立團隊名額中';
    const onclick = `App.openTeamReservationModal('${escapeHTML(e.id)}'${active ? `,'${escapeHTML(active.id)}'` : ''})`;
    return '<div class="signup-glow-wrap team-reservation-action" style="--glow-c:' + bg + ';--glow-c-light:' + glow + '">'
      + '<div class="signup-glow-border"></div><div class="signup-glow-shadow"></div>'
      + '<div class="signup-flipper"><button class="event-signup-team-button" style="background:' + bg + ';color:#fff" onclick="' + onclick + '">' + label + '</button></div>'
      + '<div class="signup-loading-hint"><div class="mini-spinner"></div><span class="mini-text">' + hint + '</span></div></div>';
  },

  _composeEventSignupActions(e, personalHtml, opts = {}) {
    const teamHtml = this._renderTeamReservationActionButton(e, opts);
    if (!teamHtml) return personalHtml;
    return '<div class="event-signup-action-row">'
      + '<div class="event-signup-personal-action">' + (personalHtml || '') + '</div>'
      + '<div class="event-signup-team-action">' + teamHtml + '</div>'
      + '</div>';
  },

  _getTeamReservationModalState(eventId, preferredTeamId) {
    const e = ApiService.getEvent(eventId);
    const teams = this._getTeamReservationStaffTeams(e);
    if (!e || teams.length === 0) return null;
    const selectedTeam = teams.find(t => String(t.id) === String(preferredTeamId || '')) || teams[0];
    const summary = this._getTeamReservationSummary(e, selectedTeam.id) || {
      teamId: selectedTeam.id,
      teamName: selectedTeam.name || selectedTeam.teamName || selectedTeam.id,
      reservedSlots: 0,
      usedSlots: 0,
      remainingSlots: 0,
    };
    const current = Math.max(0, Number(e.current || 0) || 0);
    const max = Math.max(0, Number(e.max || 0) || 0);
    const used = Math.max(0, Number(summary.usedSlots || 0) || 0);
    const remaining = Math.max(0, Number(summary.remainingSlots || 0) || 0);
    const maxReserved = used + Math.max(0, max - Math.max(0, current - remaining));
    return { event: e, teams, selectedTeam, summary, used, remaining, maxReserved };
  },

  async openTeamReservationModal(eventId, preferredTeamId) {
    if (this._requireProtectedActionLogin({ type: 'teamReservation', eventId }, { suppressToast: true })) return;
    await this._ensureTeamReservationStaffTeamsLoaded?.();
    const state = this._getTeamReservationModalState(eventId, preferredTeamId);
    if (!state) {
      this.showToast('只有俱樂部職員可以建立團隊名額');
      return;
    }
    const storageKey = 'teamReservationSlots:' + state.selectedTeam.id;
    const savedSlots = Number(localStorage.getItem(storageKey) || 0);
    const initialSlots = Number(state.summary.reservedSlots || 0) || (Number.isFinite(savedSlots) && savedSlots > 0 ? savedSlots : state.used);
    let modal = document.getElementById('team-reservation-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'team-reservation-modal';
      document.body.appendChild(modal);
    }
    modal.className = 'team-reservation-overlay';
    modal.setAttribute('role', 'presentation');
    modal.removeAttribute('onclick');
    const teamOptions = state.teams.map(t => {
      const selected = String(t.id) === String(state.selectedTeam.id) ? ' selected' : '';
      return `<option value="${escapeHTML(t.id)}"${selected}>${escapeHTML(t.name || t.teamName || t.id)}</option>`;
    }).join('');
    modal.innerHTML = `
      <div class="team-reservation-dialog" role="dialog" aria-modal="true" aria-labelledby="team-reservation-title" onclick="event.stopPropagation()">
        <div class="team-reservation-dialog-header">
          <h3 id="team-reservation-title">團隊報名</h3>
          <button type="button" class="team-reservation-close" onclick="App.closeTeamReservationModal()" aria-label="關閉">×</button>
        </div>
        <div class="team-reservation-dialog-body">
          <div class="team-reservation-note">
            團隊名額不包含你本人；如果你也要參加，請再點「個人報名」。
          </div>
          <label class="team-reservation-label" for="team-reservation-team-select">俱樂部</label>
          <select id="team-reservation-team-select" class="team-reservation-control" onchange="App.openTeamReservationModal('${escapeHTML(eventId)}', this.value)">
            ${teamOptions}
          </select>
          <label class="team-reservation-label" for="team-reservation-slots-input">團隊名額</label>
          <input id="team-reservation-slots-input" class="team-reservation-control" type="number" min="${state.used}" max="${state.maxReserved}" value="${initialSlots}" inputmode="numeric">
          <div class="team-reservation-help">
            此人數佔位僅於相同俱樂部成員報名時適用。<br>
            已被俱樂部成員使用：${state.used}　剩餘佔位：${state.remaining}<br>
            可調整範圍：${state.used} - ${state.maxReserved}
          </div>
        </div>
        <div class="team-reservation-dialog-actions">
          <button type="button" class="outline-btn" onclick="App.closeTeamReservationModal()">取消</button>
          <button type="button" class="primary-btn" id="team-reservation-confirm-btn" onclick="App.confirmTeamReservation('${escapeHTML(eventId)}','${escapeHTML(state.selectedTeam.id)}')">確認</button>
        </div>
      </div>`;
    modal.classList.add('open');
    document.body.classList.add('modal-open');
  },

  closeTeamReservationModal() {
    const modal = document.getElementById('team-reservation-modal');
    if (modal) modal.classList.remove('open');
    document.body.classList.remove('modal-open');
  },

  async confirmTeamReservation(eventId, teamId) {
    const input = document.getElementById('team-reservation-slots-input');
    const btn = document.getElementById('team-reservation-confirm-btn');
    const busyKey = 'team-reservation:' + String(eventId || '') + ':' + String(teamId || '');
    if (!this._beginEventActionBusy(busyKey)) return;
    const slots = Math.max(0, Math.trunc(Number(input?.value || 0) || 0));
    const state = this._getTeamReservationModalState(eventId, teamId);
    if (!state) {
      this._endEventActionBusy(busyKey);
      return;
    }
    if (slots < state.used) {
      this._endEventActionBusy(busyKey);
      this.showToast('團隊名額不能低於已使用人數');
      return;
    }
    if (slots > state.maxReserved) {
      this._endEventActionBusy(busyKey);
      this.showToast('團隊名額超過目前活動可用名額');
      return;
    }
    try {
      if (btn) { btn.disabled = true; btn.textContent = '處理中...'; }
      localStorage.setItem('teamReservationSlots:' + teamId, String(slots));
      const data = await FirebaseService.adjustTeamReservation(eventId, teamId, slots);
      if (data?.deduplicated) {
        this.showToast('團隊名額處理中，請稍候');
        return;
      }
      this.closeTeamReservationModal();
      this.showToast(slots > 0 ? '已更新團隊名額' : '已取消團隊名額');
      this._patchDetailAfterSignup?.(eventId);
    } catch (err) {
      console.error('[confirmTeamReservation]', err);
      const code = err?.details || err?.message || '';
      const msgMap = {
        RESERVED_BELOW_USED: '團隊名額不能低於已使用人數',
        RESERVED_OVER_CAPACITY: '團隊名額超過目前活動可用名額',
        PERMISSION_DENIED: '你沒有調整此俱樂部名額的權限',
        EVENT_ENDED: '活動已開始，無法調整名額',
        EVENT_CANCELLED: '活動已取消，無法調整名額',
      };
      this.showToast(msgMap[code] || err.message || '團隊名額調整失敗');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '確認'; }
      this._endEventActionBusy(busyKey);
    }
  },

  async handleSignup(id, opts = {}) {
    if (this._requireProtectedActionLogin({ type: 'eventSignup', eventId: id }, { suppressToast: true })) {
      return;
    }
    // 2026-04-19 UX：寫入類動作必須先補齊個人資料（地區/性別/生日）
    if (this._requireProfileComplete()) return;
    let e = ApiService.getEvent(id);
    if (!e) return;
    // 2026-04-20：活動黑名單寫入守衛（未登入先入頁→登入後報名的繞過路徑）
    // 被擋且未報名用戶嘗試報名時擋下。已報名用戶因 _isEventVisibleToUser 尊重歷史，自動放行
    if (typeof this._isEventVisibleToUser === 'function') {
      const _uid = ApiService.getCurrentUser?.()?.uid || null;
      if (!this._isEventVisibleToUser(e, _uid)) {
        this.showToast('\u6b64\u6d3b\u52d5\u76ee\u524d\u7121\u6cd5\u5831\u540d');  // 此活動目前無法報名
        return;
      }
    }
    e = this._syncEventEffectiveStatus?.(e) || e;
    if (e.status === 'ended' || e.status === 'cancelled') {
      this.showToast('\u6d3b\u52d5\u5df2\u958b\u59cb\uff0c\u5831\u540d\u5df2\u7d50\u675f');
      this.showEventDetail(id);
      return;
    }
    if (e.status === 'upcoming') {
      this.showToast('\u5831\u540d\u5c1a\u672a\u958b\u653e\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
      return;
    }
    if (e.teamOnly && typeof this._canSignupTeamOnlyEvent === 'function' && !this._canSignupTeamOnlyEvent(e)) {
      this.showToast('俱樂部限定活動，僅限該隊成員報名');
      return;
    }
    const genderSignupState = typeof this._getEventGenderSignupState === 'function'
      ? this._getEventGenderSignupState(e, ApiService.getCurrentUser?.() || null)
      : { restricted: false, canSignup: true, requiresLogin: false, reason: '' };
    if (genderSignupState.restricted && !genderSignupState.requiresLogin && !genderSignupState.canSignup) {
      this.showToast(this._getEventGenderRestrictionMessage?.(e, genderSignupState.reason) || '此活動不符合目前性別限制');
      return;
    }
    // 活動開始時間已過 → 自動結束並阻止操作
    const _startGuard = App._parseEventStartDate?.(e.date);
    if (_startGuard && _startGuard <= new Date() && e.status !== 'ended' && e.status !== 'cancelled') {
      ApiService.updateEvent(id, { status: 'ended' });
      this.showToast('活動已於開始時間結束，無法報名');
      this.showEventDetail(id);
      return;
    }
    if (e.status === 'upcoming') { this.showToast('報名尚未開放，請稍後再試'); return; }

    // team-split: 自選模式需先選隊
    const _tsEnabled = e.teamSplit?.enabled;
    const _tsMode = e.teamSplit?.mode;
    let _tsTeamKey = null;
    if (_tsEnabled && _tsMode === 'self-select') {
      _tsTeamKey = this._tsSelectedTeamKey || null;
      if (!_tsTeamKey) {
        this.showToast(I18N?.t?.('teamSplit.select.required') || '請先選擇隊伍');
        return;
      }
    }

    const user = ApiService.getCurrentUser();
    if (!user?.uid) { this.showToast('用戶資料載入中，請稍候再試'); return; }
    const userName = user.displayName || user.name || '用戶';
    const userId = user.uid;

    if (this._hasActiveSelfRegistrationForEvent(id, userId)) {
      this.showToast('你已經報名這場活動');
      this._patchDetailAfterSignup(id);
      return;
    }

    // 有同行者 → 顯示選人 Modal
    const companions = ApiService.getCompanions();
    if (companions.length > 0) {
      if (_tsEnabled) this._tsPendingTeamKey = _tsTeamKey;
      this._openCompanionSelectModal(id);
      return;
    }

    // 恢復報名 → 移除之前的取消紀錄
    this._removeCancelRecordOnResignup(id, userId);

    // 確保 Firebase SDK + Auth 已就緒（首次開啟或長時間未操作時可能未完成初始化）
    if (!this._cloudReady) {
      this.showToast('系統載入中，請稍候再試');
      void this.ensureCloudReady?.({ reason: 'signup' });
      return;
    }

    // 防幽靈 UI 層：報名期間禁用按鈕，啟動光跡載入特效
    const signupBusyKey = 'signup:' + String(id || '') + ':' + String(userId || '');
    if (!this._beginEventActionBusy(signupBusyKey)) return;
    let reservationChoice;
    try {
      reservationChoice = await this._resolveTeamReservationSignupChoice(e, opts);
    } catch (err) {
      this._endEventActionBusy(signupBusyKey);
      console.error('[handleSignup reservationChoice]', err);
      this.showToast(err?.message || '報名處理失敗，請稍後再試');
      return;
    }
    if (reservationChoice?.requiresSelection) {
      this._endEventActionBusy(signupBusyKey);
      this.openTeamReservationSignupChoiceModal(id, reservationChoice.choices, 'signup');
      return;
    }
    const selectedTeamReservationTeamId = String(reservationChoice?.teamId || '').trim();

    const signupBtns = document.querySelectorAll('#detail-body button');
    let activeBtn = null;
    let glowWrap = null;
    signupBtns.forEach(b => {
      b.disabled = true; b.style.opacity = '0.6';
      if ((b.getAttribute('onclick') || '').includes('handleSignup')) {
        activeBtn = b;
        b._origText = b.textContent;
        const txt = b.textContent.trim();
        b.textContent = txt.includes('候補') ? '候補中...' : '報名中...';
        b.style.opacity = '';
        glowWrap = b.closest('.signup-glow-wrap');
        if (glowWrap) glowWrap.classList.add('loading');
      }
    });
    if (glowWrap) {
      this._flipAnimating = true;
      this._flipAnimatingAt = Date.now();
    }
    try {
      const _signupTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('報名操作逾時，請重新整理後再試')), 15000));

      let result;
      const useCF = typeof shouldUseServerRegistration === 'function' && shouldUseServerRegistration();
      if (useCF) {
        // ═══ CF 路徑：呼叫 Cloud Function ═══
        const cfPayload = {
          eventId: id,
          participants: [{ userId, userName }],
          requestId: `${userId}_${id}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        };
        if (_tsTeamKey) cfPayload.teamKey = _tsTeamKey;
        if (selectedTeamReservationTeamId) cfPayload.preferredTeamReservationTeamId = selectedTeamReservationTeamId;
        const cfResult = await Promise.race([
          firebase.app().functions('asia-east1').httpsCallable('registerForEvent')(cfPayload),
          _signupTimeout,
        ]);
        const data = cfResult.data;
        if (data.deduplicated) { this.showToast('報名處理中，請稍候'); return; }
        // 同步 CF 回傳結果到本地快取
        const selfReg = (data.registrations || []).find(r => r.participantType === 'self') || data.registrations?.[0];
        // 若 CF 回傳 waitlisted 計數 > 0 且 selfReg 未定義，使用 waitlisted 狀態以避免誤報
        const inferredStatus = (!selfReg && data.waitlisted > 0) ? 'waitlisted' : (selfReg?.status || 'confirmed');
        result = { status: inferredStatus };
        // 樂觀更新本地快取（onSnapshot 到來時會以 Firestore 為準覆蓋）
        if (data.event && e) {
          e.current = data.event.current;
          e.realCurrent = data.event.realCurrent;
          e.waitlist = data.event.waitlist;
          e.participants = data.event.participants;
          e.waitlistNames = data.event.waitlistNames;
          e.participantsWithUid = data.event.participantsWithUid;
          e.waitlistWithUid = data.event.waitlistWithUid;
          e.teamReservationSummaries = data.event.teamReservationSummaries || [];
          e.status = data.event.status;
          FirebaseService._saveToLS?.('events', FirebaseService._cache?.events);
        }
        // 樂觀補入 registration 到快取（防止 _refreshSignupButton 在 snapshot 到達前讀到空快取閃回「報名」）
        var _regCache = FirebaseService._cache.registrations || [];
        if (!_regCache.some(function(r) { return r.eventId === id && r.userId === userId && r.status !== 'cancelled' && r.status !== 'removed'; })) {
          _regCache.push({
            eventId: id, userId: userId, userName: userName,
            status: inferredStatus, participantType: 'self',
            teamReservationTeamId: selfReg?.teamReservationTeamId || null,
            teamReservationTeamName: selfReg?.teamReservationTeamName || null,
            teamSeatSource: selfReg?.teamSeatSource || null,
            registeredAt: new Date().toISOString(),
            _docId: selfReg?._docId || selfReg?.id || ('reg_optimistic_' + Date.now()),
          });
        }
        // CF 已完成 activityRecord / auditLog / EXP / 通知，前端不需要再做
      } else {
        // ═══ 原有路徑：前端 Firestore Transaction（fallback）═══
        result = await Promise.race([
          FirebaseService.registerForEvent(id, userId, userName, _tsTeamKey, {
            preferredTeamReservationTeamId: selectedTeamReservationTeamId,
          }),
          _signupTimeout,
        ]);
      }

      // ── 即時回饋：翻牌動畫 + toast ──
      const isWL = result.status === 'waitlisted';
      let toastMsg = isWL ? '已加入候補名單' : '報名成功！';
      // team-split: random 模式顯示分配結果
      if (!isWL && _tsEnabled && _tsMode === 'random' && result.registration?.teamKey) {
        const _assignedTeam = e.teamSplit?.teams?.find(t => t.key === result.registration.teamKey);
        if (_assignedTeam) toastMsg += ` 你被分配到 ${_assignedTeam.name || _assignedTeam.key + ' 隊'}`;
      }
      this.showToast(toastMsg);
      if (glowWrap) {
        glowWrap.classList.remove('loading');
        const flipper = glowWrap.querySelector('.signup-flipper');
        if (flipper) {
          const backEl = document.createElement('div');
          backEl.className = 'signup-flip-back';
          backEl.style.cssText = isWL
            ? 'background:#7c3aed;color:#fff;padding:.55rem 1.2rem'
            : 'background:#dc2626;color:#fff;padding:.55rem 1.2rem';
          backEl.textContent = isWL ? '取消候補' : '取消報名';
          flipper.appendChild(backEl);
          void flipper.offsetHeight;
          flipper.classList.add('flipped');
          glowWrap.classList.add('flipped');
          // 2026-04-28：原本 await 1200ms 拖慢「秒成功」體感、改為 fire-and-forget
          // CSS transition 會自己跑完（750ms）、UI 立即更新成「取消報名」按鈕
        }
      }
      this._flipAnimating = false;
      this._flipAnimatingAt = 0;
      // 局部更新：只換按鈕和名單，不做全頁重繪（避免跳頂）
      this._patchDetailAfterSignup(id);
      this._maybeShowLineNotifyPrompt?.();

      // ── 背景 post-ops（僅 fallback 路徑需要，CF 路徑已在伺服器完成）──
      if (!useCF) {
        if (result.activityRecord && typeof ApiService !== 'undefined' && typeof ApiService._src === 'function') {
          const arSource = ApiService._src('activityRecords');
          const arExists = arSource.some(r =>
            r._docId === result.activityRecord._docId
            || (r.eventId === e.id && r.uid === userId && r.status === result.activityRecord.status)
          );
          if (!arExists) ApiService.addActivityRecord(result.activityRecord);
        }
        void ApiService.writeAuditLog({
          action: 'event_signup',
          targetType: 'event',
          targetId: e.id,
          targetLabel: e.title,
          result: 'success',
          source: 'web',
          meta: { eventId: e.id, statusTo: result.status === 'waitlisted' ? 'waitlisted' : 'registered' },
        });
        this._sendNotifFromTemplate('signup_success', {
          eventName: e.title, date: e.date, location: e.location,
          status: result.status === 'waitlisted' ? '候補' : '正取',
        }, userId, 'activity', '活動');
        if (result.status !== 'waitlisted') this._grantAutoExp?.(userId, 'register_activity', e.title);
      }
      this._evaluateAchievements?.(e.type);
    } catch (err) {
      const errCode = err?.details || err?.message || '';
      if (this._isDuplicateSignupError(err)) {
        this.showToast('你已經報名這場活動');
        this._patchDetailAfterSignup(id);
        if (glowWrap) glowWrap.classList.remove('loading');
        signupBtns.forEach(b => {
          b.disabled = false; b.style.opacity = '';
          if (b === activeBtn && b._origText) { b.textContent = b._origText; }
        });
        return;
      }
      console.error('[handleSignup]', err);
      // CF 錯誤碼轉換為友善訊息
      const cfMsg = {
        ALREADY_REGISTERED: '已報名此活動',
        EVENT_NOT_FOUND: '活動不存在',
        EVENT_ENDED: '活動已開始，報名已結束',
        EVENT_CANCELLED: '活動已取消',
        REG_NOT_OPEN: '報名尚未開放，請稍後再試',
        GENDER_RESTRICTED: '此活動不符合目前性別限制',
        TEAM_RESTRICTED: '俱樂部限定活動，僅限該隊成員報名',
        PROFILE_INCOMPLETE: '請先完善個人資料後再報名',
      };
      cfMsg.TEAM_RESERVATION_TEAM_DENIED = '你無法使用此俱樂部席位報名';
      cfMsg.TEAM_RESERVATION_TEAM_NOT_AVAILABLE = '此俱樂部席位已變更，請重新選擇';
      // Plan C：PROFILE_INCOMPLETE → 自動彈出首登表單
      if (errCode === 'PROFILE_INCOMPLETE') {
        this._pendingFirstLogin = true;
        this._firstLoginShowing = false;
        this._tryShowFirstLoginModal?.();
        if (glowWrap) glowWrap.classList.remove('loading');
        signupBtns.forEach(b => { b.disabled = false; b.style.opacity = ''; if (b === activeBtn && b._origText) b.textContent = b._origText; });
        return;
      }
      ApiService._writeErrorLog({
        fn: 'handleSignup',
        eventId: id,
        userId,
        teamKey: _tsTeamKey || '',
        teamReservationTeamId: selectedTeamReservationTeamId || '',
        errCode,
      }, err);
      const isNetworkOrTimeout = /timeout|network|fetch|ECONNREFUSED|逾時/i.test(err?.message || '');
      const friendlyMsg = cfMsg[errCode] || (isNetworkOrTimeout ? '連線逾時，請檢查網路後重新整理再試' : err.message || '報名失敗，請稍後再試');
      this.showToast(friendlyMsg);
      if (glowWrap) glowWrap.classList.remove('loading');
      signupBtns.forEach(b => {
        b.disabled = false; b.style.opacity = '';
        if (b === activeBtn && b._origText) { b.textContent = b._origText; }
      });
    } finally {
      this._flipAnimating = false;
      this._flipAnimatingAt = 0;
      this._endEventActionBusy(signupBusyKey);
    }
  },

  async handleCancelSignup(id) {
    if (this._requireProtectedActionLogin({ type: 'eventCancelSignup', eventId: id }, { suppressToast: true })) {
      return;
    }
    if (!this._cloudReady) {
      this.showToast('系統載入中，請稍候再試');
      void this.ensureCloudReady?.({ reason: 'cancel-signup' });
      return;
    }
    this._cancelSignupBusyMap = this._cancelSignupBusyMap || {};
    if (this._cancelSignupBusyMap[id]) {
      this.showToast('系統已在處理中');
      return;
    }
    this._cancelSignupBusyMap[id] = true;
    const cancelPrelockTimeout = setTimeout(() => {
      delete this._cancelSignupBusyMap[id];
    }, 15000);
    const releaseCancelPrelock = () => {
      clearTimeout(cancelPrelockTimeout);
      delete this._cancelSignupBusyMap[id];
    };

    const currentUser = ApiService.getCurrentUser();
    const currentUserId = currentUser?.uid || 'unknown';
    let myRegs = ApiService.getMyRegistrationsByEvent(id);

    // 快取無紀錄但用戶已報名（CF 寫入後快取未同步）→ 即時從 Firestore 補查
    if (myRegs.length === 0 && currentUserId !== 'unknown') {
      try {
        const _eventDocId2 = await FirebaseService._getEventDocIdAsync(id);
        if (!_eventDocId2) throw new Error('eventDocId not found');
        const regsRef = db.collection('events').doc(_eventDocId2).collection('registrations');
        let snap = await regsRef
          .where('userId', '==', currentUserId)
          .get();
        if (snap.empty) {
          snap = await regsRef
            .where('uid', '==', currentUserId)
            .get();
        }
        const fetched = [];
        snap.forEach(doc => {
          const d = doc.data();
          if (d.userId && !d.uid) d.uid = d.userId;
          if (d.uid && !d.userId) d.userId = d.uid;
          fetched.push({
            ...d, _docId: doc.id, id: doc.id,
            registeredAt: d.registeredAt?.toDate?.()?.toISOString?.() || d.registeredAt,
          });
        });
        const active = fetched.filter(r => r.status !== 'cancelled' && r.status !== 'removed');
        if (active.length > 0) {
          // 補回快取
          const cache = FirebaseService._cache?.registrations;
          if (Array.isArray(cache)) {
            active.forEach(r => {
              if (!cache.some(c => c._docId === r._docId)) cache.push(r);
            });
          }
          myRegs = active;
        }
      } catch (err) {
        console.warn('[cancelSignup] fallback query failed', err);
      }
    }

    // 有真正的同行者報名（companionId 存在）→ 顯示多選取消 Modal
    // 若只是本人報名出現重複（資料競態窗口），不誤觸同行者 modal
    const hasRealCompanions = myRegs.some(r => r.participantType === 'companion' || r.companionId);
    if (myRegs.length > 1 && hasRealCompanions) {
      this._openCompanionCancelModal(id, myRegs);
      releaseCancelPrelock();
      return;
    }

    let e0 = ApiService.getEvent(id);
    e0 = this._syncEventEffectiveStatus?.(e0) || e0;
    if (e0?.status === 'ended' || e0?.status === 'cancelled') {
      this.showToast('\u6d3b\u52d5\u5df2\u958b\u59cb\uff0c\u7121\u6cd5\u518d\u53d6\u6d88\u5831\u540d');
      this.showEventDetail(id);
      releaseCancelPrelock();
      return;
    }
    // 活動開始時間已過 → 自動結束並阻止操作
    const _startGuard = App._parseEventStartDate?.(e0?.date);
    if (_startGuard && _startGuard <= new Date() && e0?.status !== 'ended' && e0?.status !== 'cancelled') {
      ApiService.updateEvent(id, { status: 'ended' });
      this.showToast('活動已於開始時間結束，無法取消報名');
      this.showEventDetail(id);
      releaseCancelPrelock();
      return;
    }
    const singleReg = myRegs.length === 1 ? myRegs[0] : null;
    const isWaitlist = singleReg ? singleReg.status === 'waitlisted' : (e0 && this._isUserOnWaitlist(e0));
    const confirmMsg = isWaitlist ? '確定要取消候補？' : '確定要取消報名？';
    if (!await this.appConfirm(confirmMsg)) {
      releaseCancelPrelock();
      return;
    }

    // B1 優化：移除 _syncMyEventRegistrations 前置查詢
    // cancelRegistration 內部已查詢 firestoreRegs 並自動回填 _docId（C1），不再需要額外同步

    const user = ApiService.getCurrentUser();
    const userName = user?.displayName || user?.name || '用戶';
    const userId = user?.uid || 'unknown';
    const cancelBtns = Array.from(document.querySelectorAll('#detail-body button'))
      .filter(b => ((b.getAttribute('onclick') || '').includes('handleCancelSignup')));
    const activeCancelBtn = cancelBtns[0] || null;
    let cancelUiRestored = false;
    clearTimeout(cancelPrelockTimeout);
    this._cancelSignupBusyMap[id] = true;
    // 安全超時：15 秒後自動解鎖，防止 Firestore 卡住導致永久鎖定
    const _busyTimeout = setTimeout(() => { delete this._cancelSignupBusyMap[id]; }, 15000);
    let cancelGlowWrap = null;
    cancelBtns.forEach(b => {
      b.disabled = true;
      b.style.opacity = '0.6';
      b._origCancelHtml = b.innerHTML;
      // 按鈕文字即時切換為處理中狀態
      b.textContent = isWaitlist ? '取消候補中...' : '取消報名中...';
    });
    if (activeCancelBtn) {
      activeCancelBtn.style.opacity = '';
      cancelGlowWrap = activeCancelBtn.closest('.signup-glow-wrap');
      if (cancelGlowWrap) {
        cancelGlowWrap.classList.add('loading');
        // 在 Firestore 操作前鎖定重渲染，防止 onSnapshot 中途替換 DOM
        this._flipAnimating = true;
        this._flipAnimatingAt = Date.now(); // F1：記錄時間戳供安全重置判斷
      }
    }
    const _restoreCancelUI = () => {
      if (cancelUiRestored) return;
      cancelUiRestored = true;
      this._flipAnimating = false;
      delete this._cancelSignupBusyMap[id];
      if (cancelGlowWrap) cancelGlowWrap.classList.remove('loading');
      cancelBtns.forEach(b => {
        b.disabled = false;
        b.style.opacity = '';
        if (typeof b._origCancelHtml === 'string') {
          b.innerHTML = b._origCancelHtml;
          delete b._origCancelHtml;
        }
      });
    };

    const targetStatuses = isWaitlist ? ['waitlisted'] : ['confirmed', 'registered'];
    const reg = myRegs.find(r => targetStatuses.includes(r.status))
      || myRegs.find(r => r._docId && r.status !== 'cancelled' && r.status !== 'removed')
      || myRegs[0]
      || null;
    const regCancelId = reg ? (reg.id || reg._docId) : null;
    // 若有重複的本人報名（資料不一致），直接清掉額外的（不觸發候補遞補）
    const extraRegs = myRegs.filter(r => r !== reg && r._docId);
    for (const extra of extraRegs) {
      extra.status = 'cancelled';
      extra.cancelledAt = new Date().toISOString();
      var _dedupRegDocId = extra._docId;
      FirebaseService._getEventDocIdAsync(id).then(function(_evDocId) {
        if (_evDocId) db.collection('events').doc(_evDocId).collection('registrations').doc(_dedupRegDocId).update({
          status: 'cancelled',
          cancelledAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      }).catch(function(err) { console.error('[cancelSignup dedup]', err); });
    }
    if (reg && !regCancelId) {
      console.warn('[cancelSignup] registration id missing', { eventId: id, userId, reg });
      clearTimeout(_busyTimeout);
      _restoreCancelUI();
      this.showToast('報名資料尚未同步完成，請重新整理後再試');
      this.showEventDetail(id);
      return;
    }
    if (reg) {
      try {
        const _cancelTimeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('取消操作逾時，請重新整理後再試')), 15000));

        let cancelledReg;
        const useCF = typeof shouldUseServerRegistration === 'function' && shouldUseServerRegistration();

        if (useCF) {
          // ═══ CF 路徑：呼叫 Cloud Function ═══
          const cfResult = await Promise.race([
            firebase.app().functions('asia-east1').httpsCallable('cancelRegistration')({
              eventId: id,
              registrationIds: [regCancelId],
              reason: 'user_cancel',
              requestId: `cancel_${userId}_${id}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
            }),
            _cancelTimeout,
          ]);
          const data = cfResult.data;
          if (data.deduplicated) { this.showToast('取消處理中，請稍候'); return; }
          cancelledReg = { _promotedUserIds: (data.promoted || []).map(p => p.userId) };
          if (cancelledReg._promotedUserIds.length > 0) {
            cancelledReg._promotedUserId = cancelledReg._promotedUserIds[0];
          }
          // 樂觀更新本地快取
          reg.status = 'cancelled';
          reg.cancelledAt = new Date().toISOString();
          if (data.event && e0) {
            e0.current = data.event.current;
            e0.realCurrent = data.event.realCurrent;
            e0.waitlist = data.event.waitlist;
            e0.participants = data.event.participants;
            e0.waitlistNames = data.event.waitlistNames;
            e0.participantsWithUid = data.event.participantsWithUid;
            e0.waitlistWithUid = data.event.waitlistWithUid;
            e0.teamReservationSummaries = data.event.teamReservationSummaries || [];
            e0.status = data.event.status;
          }
          FirebaseService._saveToLS?.('registrations', FirebaseService._cache?.registrations);
          FirebaseService._saveToLS?.('events', FirebaseService._cache?.events);
        } else {
          // ═══ 原有路徑：前端 Firestore（fallback）═══
          cancelledReg = await Promise.race([
            FirebaseService.cancelRegistration(regCancelId),
            _cancelTimeout,
          ]);
        }

        if (!useCF && cancelledReg && cancelledReg._promotedUserId) {
          const ev = ApiService.getEvent(id);
          if (ev) {
            this._sendNotifFromTemplate('waitlist_promoted', {
              eventName: ev.title, date: ev.date, location: ev.location,
            }, cancelledReg._promotedUserId, 'activity', '活動');
            (cancelledReg._promotedUserIds || [cancelledReg._promotedUserId]).forEach(pUid => {
              this._grantAutoExp?.(pUid, 'register_activity', ev.title);
            });
          }
        }

        // ── 即時回饋：翻牌動畫 + toast ──
        this.showToast(isWaitlist ? '已取消候補' : '已取消報名');
        if (cancelGlowWrap) {
          cancelGlowWrap.classList.remove('loading');
          const flipper = cancelGlowWrap.querySelector('.signup-flipper');
          if (flipper) {
            const ev = ApiService.getEvent(id);
            const stillFull = ev && ev.current >= ev.max;
            const backEl = document.createElement('div');
            backEl.className = 'signup-flip-back';
            backEl.style.cssText = stillFull
              ? 'background:#7c3aed;color:#fff;padding:.55rem 1.2rem'
              : 'background:var(--accent);color:#fff;padding:.55rem 1.2rem;font-weight:600';
            backEl.textContent = stillFull ? '報名候補' : '立即報名';
            flipper.appendChild(backEl);
            void flipper.offsetHeight;
            flipper.classList.add('flipped');
            cancelGlowWrap.classList.add('flipped');
            // 2026-04-28：原本 await 1200ms 拖慢「秒成功」體感、改為 fire-and-forget
            // CSS transition 會自己跑完（750ms）、UI 立即更新成「立即報名」按鈕
          }
          this._flipAnimating = false;
        }
        // 局部更新：只換按鈕和名單，不做全頁重繪（避免跳頂）
        this._patchDetailAfterCancel(id);

        // ── 背景 post-ops（僅 fallback 路徑，CF 已在伺服器完成）──
        if (!useCF) {
          const records = ApiService.getActivityRecords();
          const hasCancelRec = records.some(r => r.eventId === id && r.uid === userId && r.status === 'cancelled');
          for (let i = records.length - 1; i >= 0; i--) {
            if (records[i].eventId === id && records[i].uid === userId && records[i].status !== 'cancelled') {
              if (records[i]._docId) {
                var _arCancelDocId = records[i]._docId;
                FirebaseService._getEventDocIdAsync(id).then(function(_evDocId) {
                  if (_evDocId) db.collection('events').doc(_evDocId).collection('activityRecords').doc(_arCancelDocId).update({ status: 'cancelled' });
                }).catch(function(err) { console.error('[activityRecord cancel]', err); });
              }
              if (hasCancelRec) {
                if (records[i]._docId) {
                  var _arDedupDocId = records[i]._docId;
                  FirebaseService._getEventDocIdAsync(id).then(function(_evDocId) {
                    if (_evDocId) db.collection('events').doc(_evDocId).collection('activityRecords').doc(_arDedupDocId).delete();
                  }).catch(function(err) { console.error('[activityRecord dedup]', err); });
                }
                records.splice(i, 1);
              } else {
                records[i].status = 'cancelled';
              }
            }
          }
          FirebaseService._getEventDocIdAsync(id).then(function(_edId) {
            if (!_edId) { console.error('[activityRecord] eventDocId not found:', id); return; }
            db.collection('events').doc(_edId).collection('activityRecords')
              .where('uid', '==', userId)
              .get().then(function(snap) {
                snap.forEach(function(doc) {
                  if (doc.data().status !== 'cancelled') {
                    doc.ref.update({ status: 'cancelled' })
                      .catch(function(err) { console.error('[activityRecord cancel-sub]', err); });
                  }
                });
              }).catch(function(err) { console.error('[activityRecord cancel-fallback query]', err); });
          }).catch(function(err) { console.error('[activityRecord eventDocId]', err); });
          if (!hasCancelRec && !records.some(r => r.eventId === id && r.uid === userId && r.status === 'cancelled')) {
            const ev = ApiService.getEvent(id);
            if (ev) {
              const dp = ev.date.split(' ')[0].split('/');
              ApiService.addActivityRecord({ eventId: id, name: ev.title, date: `${dp[1]}/${dp[2]}`, status: 'cancelled', uid: userId });
            }
          }
          this._notifySignupCancelledInboxFromTemplate(ApiService.getEvent(id) || e0, userId, isWaitlist);
          void ApiService.writeAuditLog({
            action: 'event_cancel_signup',
            targetType: 'event',
            targetId: e0?.id || id,
            targetLabel: e0?.title || '',
            result: 'success',
            source: 'web',
            meta: { eventId: e0?.id || id, statusFrom: isWaitlist ? 'waitlisted' : 'registered', statusTo: 'cancelled' },
          });
          if (!isWaitlist) this._grantAutoExp?.(userId, 'cancel_registration', e0.title);
        }
        this._evaluateAchievements?.(e0?.type);
      } catch (err) {
        const errCode = err?.details || err?.message || '';
        if (this._isMissingCancelRegistrationError(err)) {
          this.showToast('報名狀態已更新');
          this._patchDetailAfterCancel(id);
          _restoreCancelUI();
          return;
        }
        console.error('[cancelSignup]', err);
        this._flipAnimating = false;
        const cfMsg = {
          ALREADY_CANCELLED: '已取消此報名',
          REG_NOT_FOUND: '找不到報名紀錄',
          EVENT_NOT_FOUND: '活動不存在',
          PERMISSION_DENIED: '無權限執行此操作',
        };
        const isNetworkOrTimeout = /timeout|network|fetch|ECONNREFUSED|逾時/i.test(err?.message || '');
        this.showToast('取消失敗：' + (cfMsg[errCode] || (isNetworkOrTimeout ? '連線逾時，請檢查網路後重新整理再試' : err.message || '')));
        ApiService._writeErrorLog({ fn: 'handleCancelSignup', eventId: id }, err);
        _restoreCancelUI();
      } finally {
        clearTimeout(_busyTimeout);
        this._flipAnimating = false;
        this._flipAnimatingAt = 0;
        delete this._cancelSignupBusyMap[id];
      }
    } else {
      console.warn('[cancelSignup] active registration not found', {
        eventId: id,
        userId,
        targetStatuses,
        activeRegCount: myRegs.length,
        activeRegStatuses: myRegs.map(r => r.status)
      });
      clearTimeout(_busyTimeout);
      _restoreCancelUI();
      this.showToast('找不到有效的報名紀錄，請重新整理後再試');
      this.showEventDetail(id);
    }
  },

  // ════════════════════════════════
  //  局部 DOM 更新（報名/取消後不做全頁重繪，避免跳頂）
  // ════════════════════════════════

  /** 報名成功後：更新按鈕 + 名單 + 人數 */
  _patchDetailAfterSignup(eventId) {
    this._refreshSignupButton(eventId);
    this._patchDetailTables(eventId);
  },

  /** 取消成功後：更新按鈕 + 名單 + 人數 */
  _patchDetailAfterCancel(eventId) {
    this._refreshSignupButton(eventId);
    this._patchDetailTables(eventId);
  },

  /**
   * snapshot 觸發時重新判斷按鈕狀態（不做全頁重繪）。
   * 必須涵蓋 showEventDetail 中所有按鈕分支，否則會回歸。
   */
  _refreshSignupButton(eventId) {
    if (this._flipAnimating) return; // 翻牌動畫中不干擾
    var e = ApiService.getEvent(eventId);
    if (!e) return;
    var actionZone = document.querySelector('.detail-action-primary');
    if (!actionZone) return;

    var isEnded = e.status === 'ended' || e.status === 'cancelled';
    var isUpcoming = e.status === 'upcoming';
    var isSignedUp = this._isUserSignedUp(e);
    var isOnWaitlist = isSignedUp && this._isUserOnWaitlist(e);
    var confirmedCount = (typeof this._buildConfirmedParticipantSummary === 'function')
      ? this._buildConfirmedParticipantSummary(eventId).count
      : Number(e.current || 0);
    var isMainFull = confirmedCount >= (e.max || 0);

    // 性別限定
    var genderState = (typeof this._getEventGenderSignupState === 'function')
      ? this._getEventGenderSignupState(e, ApiService.getCurrentUser?.() || null)
      : { restricted: false, canSignup: true, requiresLogin: false, reason: '' };
    var genderBlocked = genderState.restricted && !genderState.requiresLogin && !genderState.canSignup;
    var genderMsg = (typeof this._getEventGenderRestrictionMessage === 'function')
      ? this._getEventGenderRestrictionMessage(e, genderState.reason) : '';

    // 球隊限定
    var teamBlocked = e.teamOnly && (typeof this._canSignupTeamOnlyEvent === 'function') && !this._canSignupTeamOnlyEvent(e);

    var _gw = function(inner, c, cl, hint) {
      return '<div class="signup-glow-wrap" style="--glow-c:' + c + ';--glow-c-light:' + cl + '">' +
        '<div class="signup-glow-border"></div><div class="signup-glow-shadow"></div>' +
        '<div class="signup-flipper">' + inner + '</div>' +
        '<div class="signup-loading-hint"><div class="mini-spinner"></div><span class="mini-text">' + (hint || '') + '</span></div></div>';
    };
    var _btn = function(bg, label, onclick, disabled) {
      return '<button style="background:' + bg + ';color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:' +
        (disabled ? 'not-allowed' : 'pointer') + (disabled ? ';opacity:.7' : '') + '"' +
        (disabled ? ' disabled' : '') +
        (onclick ? ' onclick="' + onclick + '"' : '') + '>' + label + '</button>';
    };

    var html = '';
    if (isUpcoming) {
      html = _btn('#64748b', '報名尚未開放', '', true);
    } else if (isEnded) {
      html = _btn('#333', '已結束', '', true);
    } else if (isOnWaitlist) {
      html = _gw(_btn('#d97706', '取消候補', "App.handleCancelSignup('" + eventId + "')"), '#d97706', '#f59e0b', '正在取消候補');
    } else if (isSignedUp) {
      html = _gw(_btn('#dc2626', '取消報名', "App.handleCancelSignup('" + eventId + "')"), '#dc2626', '#f87171', '正在取消報名');
    } else if (teamBlocked) {
      html = _btn('#64748b', '球隊限定', '', true);
    } else if (genderBlocked) {
      html = '<button style="background:#dc2626;color:#fff;padding:.55rem 1.2rem;border-radius:var(--radius);border:none;font-size:.85rem;cursor:pointer;opacity:.95" onclick=\'App._handleGenderRestrictedClick(' +
        JSON.stringify(genderMsg) + ')\'>' + escapeHTML(this._getEventGenderRibbonText?.(e) || '性別限定') + '</button>';
    } else if (isMainFull) {
      html = _gw(_btn('#7c3aed', '報名候補', "App.handleSignup('" + eventId + "')"), '#7c3aed', '#a78bfa', '報名候補中');
    } else {
      html = _gw('<button class="primary-btn" onclick="App.handleSignup(\'' + eventId + '\')">立即報名</button>', 'var(--accent)', 'var(--accent-hover)', '報名中');
    }
    if (typeof this._composeEventSignupActions === 'function') {
      html = this._composeEventSignupActions(e, html, {
        isEnded,
        isUpcoming,
        teamBlocked,
      });
    }
    actionZone.innerHTML = html;
  },

  /** 更新人數顯示（不重繪整頁） */
  _patchDetailCount(eventId) {
    var e = ApiService.getEvent(eventId);
    if (!e) return;
    var confirmedCount = Number(e.current || 0);
    var waitlistCount = Number(e.waitlist || 0);
    // 人數 row 結構：<div class="detail-row"><span class="detail-label">人數</span>已報 X/Y　候補 Z</div>
    // 文字是直接的 text node（非 span），需用 innerHTML 整行替換
    var labels = document.querySelectorAll('.detail-grid .detail-label');
    for (var i = 0; i < labels.length; i++) {
      if ((labels[i].textContent || '').trim() === '人數') {
        var row = labels[i].closest('.detail-row') || labels[i].parentElement;
        if (row) {
          row.innerHTML = '<span class="detail-label">\u4EBA\u6578</span>\u5DF2\u5831 ' +
            confirmedCount + '/' + (e.max || 0) +
            (waitlistCount > 0 ? '\u3000\u5019\u88DC ' + waitlistCount : '');
        }
        break;
      }
    }
  },

  /** 更新報名名單 + 候補名單 + 人數（不重繪整頁） */
  _patchDetailTables(eventId) {
    if (typeof this._renderAttendanceTable === 'function') {
      this._renderAttendanceTable(eventId, 'detail-attendance-table');
    }
    if (typeof this._renderUnregTable === 'function') {
      this._renderUnregTable(eventId, 'detail-unreg-table');
    }
    if (typeof this._renderGroupedWaitlistSection === 'function') {
      this._renderGroupedWaitlistSection(eventId, 'detail-waitlist-container');
    }
    this._patchDetailCount(eventId);
  },

});
