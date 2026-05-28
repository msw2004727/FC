/* ================================================
   SportHub — Event: Companion Select & Cancel Modals
   依賴：event-detail-signup.js, api-service.js, auto-exp.js
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  Companion Select Modal (報名)
  // ══════════════════════════════════

  _companionSelectEventId: null,

  _openCompanionSelectModal(eventId) {
    const e = ApiService.getEvent(eventId);
    if (!e) return;
    this._companionSelectEventId = eventId;
    const overlay = document.getElementById('companion-select-overlay');
    if (!overlay) return;

    const user = ApiService.getCurrentUser();
    const userName = user?.displayName || user?.name || '用戶';
    const companions = ApiService.getCompanions();
    const remaining = Math.max(0, e.max - e.current);
    const feeEnabled = this._isEventFeeEnabled?.(e) ?? Number(e?.fee || 0) > 0;
    const fee = this._getEventFeeAmount?.(e) ?? (feeEnabled ? (Number(e?.fee || 0) || 0) : 0);
    const feeLabel = feeEnabled ? (fee > 0 ? `費用：NT$${fee}/人` : '費用：免費') : '';
    const allowedGender = this._getEventAllowedGender?.(e) || '';
    const selfGenderAllowed = this._canEventGenderParticipantSignup?.(e, user?.gender) ?? true;

    const infoEl = document.getElementById('companion-select-event-info');
    if (infoEl) {
      const genderTip = allowedGender
        ? `<br><span style="color:#dc2626;font-weight:700">性別限定：${escapeHTML(this._getEventGenderDetailText?.(e) || '')}</span>`
        : '';
      infoEl.innerHTML = `<b>${escapeHTML(e.title)}</b><br>${[feeLabel, `剩餘名額：${remaining}/${e.max}`].filter(Boolean).join('　')}${genderTip}`;
    }

    // 已報名者（不可再勾選）
    const myRegs = ApiService.getMyRegistrationsByEvent(eventId);
    const registeredCompanionIds = new Set(myRegs.map(r => r.companionId).filter(Boolean));
    const isSelfRegistered = myRegs.some(r => !r.companionId);

    const listEl = document.getElementById('companion-select-list');
    if (!listEl) return;
    const selfGenderHint = allowedGender && !selfGenderAllowed
      ? (this._normalizeBinaryGender?.(user?.gender) ? '（不符合性別限定）' : '（請先補齊性別）')
      : '';
    const selfDisabled = isSelfRegistered ? 'disabled checked' : (!selfGenderAllowed ? 'disabled' : '');
    const selfLabel = isSelfRegistered ? '（已報名）' : selfGenderHint;
    listEl.innerHTML = `
      <label style="display:flex;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px solid var(--border);cursor:pointer">
        <input type="checkbox" name="cs-participant" value="self" data-name="${escapeHTML(userName)}" ${selfDisabled} style="width:16px;height:16px" onchange="App._updateCompanionSelectSummary('${eventId}')">
        <span style="font-size:.85rem;font-weight:600">&#x1f464; ${escapeHTML(userName)}（本人）${selfLabel}</span>
      </label>
      ${companions.map(c => {
        const alreadyReg = registeredCompanionIds.has(c.id);
        const genderAllowed = this._canEventGenderParticipantSignup?.(e, c.gender) ?? true;
        const genderHint = allowedGender && !genderAllowed
          ? (this._normalizeBinaryGender?.(c.gender) ? '（不符合性別限定）' : '（性別未填或不支援）')
          : '';
        const dis = alreadyReg ? 'disabled checked' : (!genderAllowed ? 'disabled' : '');
        const lbl = alreadyReg ? '（已報名）' : genderHint;
        return `<label style="display:flex;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px solid var(--border);cursor:pointer">
          <input type="checkbox" name="cs-participant" value="companion" data-companion-id="${escapeHTML(c.id)}" data-name="${escapeHTML(c.name)}" ${dis} style="width:16px;height:16px" onchange="App._updateCompanionSelectSummary('${eventId}')">
          <span style="font-size:.85rem">${escapeHTML(c.name)}${c.gender ? `（${escapeHTML(c.gender)}）` : ''}${c.notes ? ` — <span style="color:var(--text-muted)">${escapeHTML(c.notes)}</span>` : ''}${lbl}</span>
        </label>`;
      }).join('')}
    `;

    this._updateCompanionSelectSummary(eventId);
    overlay.style.display = 'flex';
    overlay.classList.add('open');
  },

  _updateCompanionSelectSummary(eventId) {
    const e = ApiService.getEvent(eventId);
    const checkboxes = document.querySelectorAll('#companion-select-list input[name="cs-participant"]:not([disabled])');
    let selected = 0;
    checkboxes.forEach(cb => { if (cb.checked) selected++; });
    const feeEnabled = this._isEventFeeEnabled?.(e) ?? Number(e?.fee || 0) > 0;
    const fee = this._getEventFeeAmount?.(e) ?? (feeEnabled ? (Number(e?.fee || 0) || 0) : 0);
    const remaining = Math.max(0, (e?.max || 0) - (e?.current || 0));
    const summaryEl = document.getElementById('companion-select-summary');
    if (summaryEl) {
      const willWaitlist = Math.max(0, selected - remaining);
      const wlWarning = willWaitlist > 0 ? `<span style="color:var(--warning);font-weight:600">⚠ 其中 ${willWaitlist} 人將列入候補</span>` : '';
      summaryEl.innerHTML = `<span>已選 <b>${selected}</b> 人</span>${feeEnabled && fee > 0 ? `<span>預計費用 <b>NT$${fee * selected}</b></span>` : ''}<span>剩餘名額 <b>${remaining}</b></span>${wlWarning}`;
    }
    const confirmBtn = document.getElementById('companion-select-confirm-btn');
    if (confirmBtn) confirmBtn.disabled = selected === 0;
  },

  _closeCompanionSelectModal() {
    const overlay = document.getElementById('companion-select-overlay');
    if (!overlay) {
      this._syncEventSignupScrollLock?.();
      return;
    }
    overlay.style.display = 'none';
    overlay.classList.remove('open');
    this._companionSelectEventId = null;
    this._syncEventSignupScrollLock?.();
  },

  _startEventDetailGlowButton(button, busyText) {
    if (!button) return function() {};
    const wrap = button.closest('.signup-glow-wrap');
    const originalHtml = button.innerHTML;
    const originalDisabled = button.disabled;
    const originalOpacity = button.style.opacity || '';
    button.disabled = true;
    button.innerHTML = escapeHTML(busyText || '\u5BEB\u5165\u4E2D...');
    button.style.opacity = '';
    if (wrap) wrap.classList.add('loading');
    this._flipAnimating = true;
    this._flipAnimatingAt = Date.now();
    return () => {
      if (wrap) wrap.classList.remove('loading');
      button.disabled = originalDisabled;
      button.innerHTML = originalHtml;
      button.style.opacity = originalOpacity;
      this._flipAnimating = false;
      this._flipAnimatingAt = 0;
    };
  },

  _startCompanionSignupToolbarGlow() {
    const button = document.querySelector('.detail-action-toolbar .companion-signup-toolbar-action');
    return this._startEventDetailGlowButton(button, '\u5BEB\u5165\u4E2D...');
  },

  _startCancelSignupActionGlow() {
    const button = Array.from(document.querySelectorAll('.detail-action-primary button'))
      .find(btn => String(btn.getAttribute('onclick') || '').includes('handleCancelSignup')) || null;
    return this._startEventDetailGlowButton(button, '\u53D6\u6D88\u4E2D...');
  },

  async _confirmCompanionRegister(opts = {}) {
    const eventId = this._companionSelectEventId;
    if (!eventId) return;
    const busyKey = 'companion-register:' + String(eventId || '');
    if (this._beginEventActionBusy && !this._beginEventActionBusy(busyKey)) return;
    const confirmBtn = document.getElementById('companion-select-confirm-btn');
    const originalText = confirmBtn?.textContent || '';
    const stopToolbarGlow = this._startCompanionSignupToolbarGlow?.() || function() {};
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = '\u5BEB\u5165\u4E2D...';
    }
    try {
      return await this._confirmCompanionRegisterUnlocked(opts, eventId);
    } finally {
      this._endEventActionBusy?.(busyKey);
      this._syncEventSignupScrollLock?.();
      stopToolbarGlow();
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = originalText || '確認';
      }
    }
  },

  async _confirmCompanionRegisterUnlocked(opts = {}, eventId) {
    // 2026-04-19 UX：寫入類動作必須先補齊個人資料
    if (this._requireProfileComplete()) { this._closeCompanionSelectModal?.(); return; }
    if (!this._cloudReady) {
      this.showToast('系統載入中，請稍候再試');
      void this.ensureCloudReady?.({ reason: 'companion-signup' });
      return;
    }
    let e = ApiService.getEvent(eventId);
    if (!e) return;
    // 2026-04-20：活動黑名單寫入守衛（主報名人被擋則整批報名攔下）
    // 不擋同行者被擋的情境——companion 是被動由 operator 操作
    if (typeof this._isEventVisibleToUser === 'function') {
      const _uid = ApiService.getCurrentUser?.()?.uid || null;
      if (!this._isEventVisibleToUser(e, _uid)) {
        this._closeCompanionSelectModal?.();
        this.showToast('\u6b64\u6d3b\u52d5\u76ee\u524d\u7121\u6cd5\u5831\u540d');  // 此活動目前無法報名
        return;
      }
    }
    e = this._syncEventEffectiveStatus?.(e) || e;
    if (e.status === 'ended' || e.status === 'cancelled') {
      this._closeCompanionSelectModal();
      this.showToast('\u6d3b\u52d5\u5df2\u958b\u59cb\uff0c\u5831\u540d\u5df2\u7d50\u675f');
      this.showEventDetail(eventId);
      return;
    }
    if (e.status === 'upcoming') {
      this.showToast('\u5831\u540d\u5c1a\u672a\u958b\u653e\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
      return;
    }

    const checkboxes = document.querySelectorAll('#companion-select-list input[name="cs-participant"]:not([disabled]):checked');
    if (checkboxes.length === 0) { this.showToast('請至少選擇一位參與者'); return; }

    const user = ApiService.getCurrentUser();
    if (!user?.uid) { this.showToast('用戶資料載入中，請稍候再試'); return; }
    const userId = user.uid;
    if (!this._canEventGenderParticipantSignup?.(e, user.gender)) {
      this.showToast(this._getEventGenderRestrictionMessage?.(
        e,
        this._normalizeBinaryGender?.(user.gender) ? 'gender_mismatch' : 'missing_gender'
      ) || '此活動不符合目前性別限制');
      return;
    }
    const participantList = [];
    checkboxes.forEach(cb => {
      if (cb.value === 'self') {
        participantList.push({ type: 'self' });
      } else {
        participantList.push({ type: 'companion', companionId: cb.dataset.companionId, companionName: cb.dataset.name });
      }
    });

    const companionsById = new Map((ApiService.getCompanions() || []).map(comp => [comp.id, comp]));
    const invalidParticipant = participantList.find(participant => {
      if (participant.type === 'self') return !this._canEventGenderParticipantSignup?.(e, user.gender);
      const companion = companionsById.get(participant.companionId);
      return !this._canEventGenderParticipantSignup?.(e, companion?.gender);
    });
    if (invalidParticipant) {
      const companionName = invalidParticipant.type === 'companion' ? invalidParticipant.companionName || '' : '';
      this.showToast(companionName
        ? (this._getCompanionGenderRestrictionMessage?.(e, companionName) || '所選同行者不符合性別限定')
        : (this._getEventGenderRestrictionMessage?.(
          e,
          this._normalizeBinaryGender?.(user.gender) ? 'gender_mismatch' : 'missing_gender'
        ) || '此活動不符合目前性別限制'));
      return;
    }

    const selfParticipantSelected = participantList.some(participant => participant.type === 'self');
    let selectedTeamReservationTeamId = String(opts?.preferredTeamReservationTeamId || '').trim();
    if (selfParticipantSelected && typeof this._resolveTeamReservationSignupChoice === 'function') {
      const reservationChoice = await this._resolveTeamReservationSignupChoice(e, {
        preferredTeamReservationTeamId: selectedTeamReservationTeamId,
      });
      if (reservationChoice?.requiresSelection) {
        this.openTeamReservationSignupChoiceModal?.(eventId, reservationChoice.choices, 'companion');
        return;
      }
      selectedTeamReservationTeamId = String(reservationChoice?.teamId || '').trim();
    }

    this._closeCompanionSelectModal();

    let companionSignupMutationSeq = null;
    let companionSignupRequestId = '';
    try {
      const useCF = typeof shouldUseServerRegistrationForSignup === 'function'
        ? shouldUseServerRegistrationForSignup()
        : (typeof shouldUseServerRegistration === 'function' && shouldUseServerRegistration());
      companionSignupRequestId = useCF
        ? `${userId}_${eventId}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
        : `fallback_companion_signup_${userId}_${eventId}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
      companionSignupMutationSeq = ApiService.markEventMutationPending?.(eventId, {
        mutationType: 'companion-signup',
        source: useCF ? 'callable' : 'firestore-fallback',
        requestId: companionSignupRequestId,
        timeoutMs: 15000,
        affectedProjectionFields: ['current', 'realCurrent', 'waitlist', 'participants', 'waitlistNames'],
      });

      let regCount, wlCount, total;

      if (useCF) {
        // ═══ CF 路徑 ═══
        const cfParticipants = participantList.map(p => {
          if (p.type === 'self') return { userId, userName: user.displayName || user.name || '用戶' };
          return { userId, userName: user.displayName || user.name || '用戶', companionId: p.companionId, companionName: p.companionName };
        });
        const _cfTimeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('報名操作逾時，請重新整理後再試')), 15000));
        const cfPayload = {
          eventId,
          participants: cfParticipants,
          requestId: companionSignupRequestId,
        };
        // team-split: 傳入自選 teamKey（同行者跟主報名人同隊）
        const _pendingTk = this._tsPendingTeamKey;
        if (_pendingTk) { cfPayload.teamKey = _pendingTk; this._tsPendingTeamKey = null; }
        if (selectedTeamReservationTeamId) cfPayload.preferredTeamReservationTeamId = selectedTeamReservationTeamId;
        const cfResult = await Promise.race([
          (await ensureFirebaseFunctionsSdk('asia-east1')).httpsCallable('registerForEvent')(cfPayload),
          _cfTimeout,
        ]);
        const data = cfResult.data;
        if (data.deduplicated) { this.showToast('報名處理中，請稍候'); return; }
        regCount = data.confirmed || 0;
        wlCount = data.waitlisted || 0;
        total = regCount + wlCount;
        // 樂觀更新本地快取
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
      } else {
        // ═══ 原有路徑（fallback）═══
        const result = await ApiService.registerEventWithCompanions(eventId, participantList, {
          preferredTeamReservationTeamId: selectedTeamReservationTeamId,
        });
        regCount = result.confirmed || 0;
        wlCount = result.waitlisted || 0;
        total = regCount + wlCount;
        // 背景 post-ops（僅 fallback 路徑）
        const selfSelected = participantList.find(p => p.type === 'self');
        if (selfSelected) {
          const dateParts = e.date.split(' ')[0].split('/');
          const dateStr = `${dateParts[1]}/${dateParts[2]}`;
          const selfReg = (result.registrations || []).find(r => r.participantType === 'self');
          const isWl = selfReg?.status === 'waitlisted';
          const arRecord = {
            eventId: e.id, name: e.title, date: dateStr,
            status: isWl ? 'waitlisted' : 'registered', uid: userId, eventType: e.type,
          };
          ApiService.addActivityRecord(arRecord);
          FirebaseService._getEventDocIdAsync(e.id).then(function(_edId) {
            if (!_edId) { console.error('[companionRegAR] eventDocId not found:', e.id); return; }
            var newDocRef = db.collection('events').doc(_edId).collection('activityRecords').doc();
            newDocRef.set({
              ...arRecord, createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            }).then(function() {
              arRecord._docId = newDocRef.id;
            }).catch(function(err) { console.error('[companionRegAR]', err); });
          }).catch(function(err) { console.error('[companionRegAR eventDocId]', err); });
          if (!isWl) this._grantAutoExp?.(userId, 'register_activity', e.title);
        }
      }
      ApiService.markEventMutationServerConfirmed?.(eventId, companionSignupMutationSeq, {
        mutationType: 'companion-signup',
        source: useCF ? 'callable' : 'firestore-fallback',
        requestId: companionSignupRequestId,
      });

      this.invalidateHomeNextActivityCache?.(userId);
      const wlMsg = wlCount > 0 ? `（${wlCount} 人候補）` : '';
      this.showToast(`共 ${total} 人報名成功${wlMsg}`);
      this.showEventDetail(eventId);
    } catch (err) {
      ApiService.markEventMutationError?.(eventId, companionSignupMutationSeq, err, {
        mutationType: 'companion-signup',
        requestId: companionSignupRequestId,
      });
      console.error('[_confirmCompanionRegister]', err);
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
      const errCode = err?.details || err?.message || '';
      // Plan C：PROFILE_INCOMPLETE → 自動彈出首登表單
      if (errCode === 'PROFILE_INCOMPLETE') {
        this._pendingFirstLogin = true;
        this._firstLoginShowing = false;
        this._tryShowFirstLoginModal?.();
        return;
      }
      ApiService._writeErrorLog({
        fn: '_confirmCompanionRegister',
        eventId,
        userId,
        participantCount: participantList.length,
        teamReservationTeamId: selectedTeamReservationTeamId || '',
        errCode,
      }, err);
      const isNetworkOrTimeout = /timeout|network|fetch|ECONNREFUSED|逾時/i.test(err?.message || '');
      this.showToast(cfMsg[errCode] || (isNetworkOrTimeout ? '連線逾時，請檢查網路後重新整理再試' : err.message || '報名失敗，請稍後再試'));
    }
  },

  // ══════════════════════════════════
  //  Companion Cancel Modal (取消報名)
  // ══════════════════════════════════

  _companionCancelEventId: null,
  _companionCancelRegs: [],

  _getCompanionCancelTargetLabel(reg) {
    const isCompanion = String(reg?.participantType || '').trim() === 'companion'
      || String(reg?.companionId || '').trim();
    if (!isCompanion) return '\u672C\u4EBA';
    const name = String(reg?.companionName || reg?.userName || '').trim();
    return name ? ('\u5925\u4F34' + name) : '\u5925\u4F34';
  },

  _formatCompanionCancelTargetList(labels) {
    const items = (labels || []).filter(Boolean);
    if (items.length <= 1) return items[0] || '';
    if (items.length === 2) return items.join('\u8207');
    return items.slice(0, -1).join('\u3001') + '\u8207' + items[items.length - 1];
  },

  _updateCompanionCancelWarn() {
    const warnEl = document.getElementById('companion-cancel-warn');
    const confirmBtn = document.getElementById('companion-cancel-confirm-btn')
      || document.querySelector('#companion-cancel-overlay .modal-actions .primary-btn');
    const checked = Array.from(document.querySelectorAll('#companion-cancel-list input[name="cc-reg"]:checked'))
      .map(cb => String(cb.value || '').trim())
      .filter(Boolean);
    const labels = (this._companionCancelRegs || [])
      .filter(reg => checked.includes(String(reg?.id || reg?._docId || '').trim()))
      .map(reg => this._getCompanionCancelTargetLabel(reg));
    if (confirmBtn) confirmBtn.disabled = labels.length === 0;
    if (!warnEl) return;
    warnEl.style.display = '';
    warnEl.textContent = labels.length
      ? ('\u6CE8\u610F\uFF1A\u78BA\u8A8D\u53D6\u6D88\u5F8C\u5C07\u6703\u53D6\u6D88' + this._formatCompanionCancelTargetList(labels))
      : '\u6CE8\u610F\uFF1A\u8ACB\u81F3\u5C11\u52FE\u9078\u4E00\u4F4D\u8981\u53D6\u6D88\u7684\u5C0D\u8C61';
  },

  _openCompanionCancelModal(eventId, myRegs) {
    this._companionCancelEventId = eventId;
    this._companionCancelRegs = myRegs;
    const overlay = document.getElementById('companion-cancel-overlay');
    if (!overlay) return;
    const e = ApiService.getEvent(eventId);
    const titleEl = document.getElementById('companion-cancel-title');
    if (titleEl && e) titleEl.textContent = `取消報名 — ${e.title}`;
    const listEl = document.getElementById('companion-cancel-list');
    if (!listEl) return;
    // 顯示同行者數量警告
    const companionCount = myRegs.filter(r => r.companionId).length;
    const warnEl = document.getElementById('companion-cancel-warn');
    if (warnEl) {
      warnEl.textContent = companionCount > 0
        ? `注意：取消本人報名將同時取消 ${companionCount} 位同行者`
        : '';
      warnEl.style.display = companionCount > 0 ? '' : 'none';
    }
    const statusLabel = { confirmed: '正取', waitlisted: '候補' };
    if (warnEl) {
      warnEl.textContent = '';
      warnEl.style.display = '';
    }
    listEl.innerHTML = myRegs.map(r => {
      const displayName = r.companionName || r.userName;
      const cancelId = r.id || r._docId || '';
      const tag = statusLabel[r.status] || r.status;
      const tagColor = r.status === 'confirmed' ? 'var(--success)' : 'var(--warning)';
      return `<label style="display:flex;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px solid var(--border);cursor:pointer">
        <input type="checkbox" name="cc-reg" value="${escapeHTML(cancelId)}" checked ${cancelId ? '' : 'disabled'} style="width:16px;height:16px" onchange="App._updateCompanionCancelWarn()">
        <span style="flex:1;font-size:.85rem">${escapeHTML(displayName)}${r.companionId ? '' : '（本人）'}</span>
        <span style="font-size:.72rem;padding:.1rem .3rem;border-radius:3px;background:${tagColor}22;color:${tagColor}">${tag}</span>
      </label>`;
    }).join('');
    this._updateCompanionCancelWarn();
    overlay.style.display = 'flex';
    overlay.classList.add('open');
  },

  _selectAllCancelRegs() {
    document.querySelectorAll('#companion-cancel-list input[name="cc-reg"]').forEach(cb => { cb.checked = true; });
    this._updateCompanionCancelWarn();
  },

  _closeCompanionCancelModal() {
    const overlay = document.getElementById('companion-cancel-overlay');
    if (!overlay) return;
    overlay.style.display = 'none';
    overlay.classList.remove('open');
    this._companionCancelEventId = null;
    this._companionCancelRegs = [];
  },

  async _confirmCompanionCancel() {
    const eventId = this._companionCancelEventId;
    if (!eventId) return;
    const busyKey = 'companion-cancel:' + String(eventId || '');
    if (this._beginEventActionBusy && !this._beginEventActionBusy(busyKey)) return;
    const stopCancelGlow = this._startCancelSignupActionGlow?.() || function() {};
    try {
      return await this._confirmCompanionCancelUnlocked(eventId);
    } finally {
      this._endEventActionBusy?.(busyKey);
      stopCancelGlow();
    }
  },

  async _confirmCompanionCancelUnlocked(eventId) {
    const checked = [...document.querySelectorAll('#companion-cancel-list input[name="cc-reg"]:checked')].map(cb => cb.value);
    if (checked.length === 0) { this.showToast('請選擇要取消的報名'); return; }

    this._closeCompanionCancelModal();

    const user = ApiService.getCurrentUser();
    const userId = user?.uid || 'unknown';

    const hasSelfCancel = this._companionCancelRegs.filter(r => checked.includes(r.id || r._docId)).some(r => !r.companionId);
    const useCF = typeof shouldUseServerRegistrationForCancel === 'function'
      ? shouldUseServerRegistrationForCancel()
      : (typeof shouldUseServerRegistration === 'function' && shouldUseServerRegistration());

    let companionCancelMutationSeq = null;
    let companionCancelRequestId = '';
    try {
      companionCancelRequestId = useCF
        ? `cancel_companion_${userId}_${eventId}_${Date.now()}`
        : `fallback_companion_cancel_${userId}_${eventId}_${Date.now()}`;
      companionCancelMutationSeq = ApiService.markEventMutationPending?.(eventId, {
        mutationType: 'companion-cancel',
        source: useCF ? 'callable' : 'firestore-fallback',
        requestId: companionCancelRequestId,
        affectedRegistrationIds: checked,
        timeoutMs: 15000,
        affectedProjectionFields: ['current', 'realCurrent', 'waitlist', 'participants', 'waitlistNames'],
      });
      if (useCF) {
        // ═══ CF 路徑 ═══
        const _cfCancelTimeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('取消操作逾時，請重新整理後再試')), 15000));
        const cfResult = await Promise.race([
          (await ensureFirebaseFunctionsSdk('asia-east1')).httpsCallable('cancelRegistration')({
            eventId,
            registrationIds: checked,
            reason: 'user_cancel',
            requestId: companionCancelRequestId,
          }),
          _cfCancelTimeout,
        ]);
        const data = cfResult.data;
        if (!data.deduplicated) {
          // 樂觀更新本地快取
          this._markLocalRegistrationsTerminal?.(eventId, (data.cancelled || []).concat(data.alreadyCancelled || []).length
            ? (data.cancelled || []).concat(data.alreadyCancelled || [])
            : checked, 'cancelled');
          if (data.event) {
            const e = ApiService.getEvent(eventId);
            if (e) {
              e.current = data.event.current;
              e.realCurrent = data.event.realCurrent;
              e.waitlist = data.event.waitlist;
              e.participants = data.event.participants;
              e.waitlistNames = data.event.waitlistNames;
              e.participantsWithUid = data.event.participantsWithUid;
              e.waitlistWithUid = data.event.waitlistWithUid;
              e.teamReservationSummaries = data.event.teamReservationSummaries || [];
              e.status = data.event.status;
            }
          }
          FirebaseService._saveToLS?.('registrations', FirebaseService._cache?.registrations);
          FirebaseService._saveToLS?.('events', FirebaseService._cache?.events);
        }
      } else {
        // ═══ 原有路徑（fallback）═══
        await FirebaseService.cancelCompanionRegistrations(checked);
        if (hasSelfCancel) {
          const e = ApiService.getEvent(eventId);
          if (e) {
            const arSource = ApiService._src('activityRecords');
            const existingAR = arSource.find(a => a.eventId === eventId && a.uid === userId && a.status !== 'cancelled');
            if (existingAR) {
              existingAR.status = 'cancelled';
              if (existingAR._docId) {
                FirebaseService._getEventDocIdAsync(eventId).then(function(_edId) {
                  if (!_edId) { console.error('[companionCancelAR] eventDocId not found:', eventId); return; }
                  db.collection('events').doc(_edId).collection('activityRecords').doc(existingAR._docId).update({ status: 'cancelled' })
                    .catch(function(err) { console.error('[companionCancelAR]', err); });
                }).catch(function(err) { console.error('[companionCancelAR eventDocId]', err); });
              }
            } else if (!arSource.some(a => a.eventId === eventId && a.uid === userId && a.status === 'cancelled')) {
              const dp = e.date.split(' ')[0].split('/');
              const dateStr = `${dp[1]}/${dp[2]}`;
              const arCancel = { eventId, name: e.title, date: dateStr, status: 'cancelled', uid: userId };
              ApiService.addActivityRecord(arCancel);
              FirebaseService._getEventDocIdAsync(eventId).then(function(_edId) {
                if (!_edId) { console.error('[companionCancelAR] eventDocId not found:', eventId); return; }
                var newDocRef = db.collection('events').doc(_edId).collection('activityRecords').doc();
                newDocRef.set({
                  ...arCancel, createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                }).then(function() {
                  arCancel._docId = newDocRef.id;
                }).catch(function(err) { console.error('[companionCancelAR]', err); });
              }).catch(function(err) { console.error('[companionCancelAR eventDocId]', err); });
            }
            FirebaseService._getEventDocIdAsync(eventId).then(function(_edId) {
              if (!_edId) { console.error('[companionCancelAR] eventDocId not found:', eventId); return; }
              db.collection('events').doc(_edId).collection('activityRecords')
                .where('uid', '==', userId)
                .get().then(function(snap) {
                  snap.forEach(function(doc) {
                    if (doc.data().status !== 'cancelled') {
                      doc.ref.update({ status: 'cancelled' })
                        .catch(function(err) { console.error('[companionCancelAR-sub]', err); });
                    }
                  });
                }).catch(function(err) { console.error('[companionCancelAR-fallback query]', err); });
            }).catch(function(err) { console.error('[companionCancelAR eventDocId]', err); });
            this._grantAutoExp?.(userId, 'cancel_registration', e.title);
            this._notifySignupCancelledInboxFromTemplate(e, userId, false);
          }
        }
      }
      ApiService.markEventMutationServerConfirmed?.(eventId, companionCancelMutationSeq, {
        mutationType: 'companion-cancel',
        source: useCF ? 'callable' : 'firestore-fallback',
        requestId: companionCancelRequestId,
        affectedRegistrationIds: checked,
      });
      this.invalidateHomeNextActivityCache?.();
      this.showToast(`已取消 ${checked.length} 筆報名`);
      this.showEventDetail(eventId);
    } catch (err) {
      console.error('[_confirmCompanionCancel]', err);
      const cfMsg = {
        ALREADY_CANCELLED: '已取消此報名',
        REG_NOT_FOUND: '找不到報名紀錄',
        EVENT_NOT_FOUND: '活動不存在',
        PERMISSION_DENIED: '無權限執行此操作',
      };
      const errCode = err?.details || err?.message || '';
      if (this._isAlreadyCancelledRegistrationError?.(err)) {
        ApiService.markEventMutationServerConfirmed?.(eventId, companionCancelMutationSeq, {
          mutationType: 'companion-cancel',
          source: useCF ? 'callable' : 'firestore-fallback',
          requestId: companionCancelRequestId,
          affectedRegistrationIds: checked,
          reason: 'already-terminal',
        });
        this._markLocalRegistrationsTerminal?.(eventId, checked, 'cancelled');
        try { await this._syncMyEventRegistrations?.(eventId, userId); } catch (_) {}
        this.showToast(`已取消 ${checked.length} 筆報名`);
        this.showEventDetail(eventId);
        return;
      }
      ApiService.markEventMutationError?.(eventId, companionCancelMutationSeq, err, {
        mutationType: 'companion-cancel',
        source: useCF ? 'callable' : 'firestore-fallback',
        requestId: companionCancelRequestId,
        affectedRegistrationIds: checked,
      });
      const isNetworkOrTimeout = /timeout|network|fetch|ECONNREFUSED|逾時/i.test(err?.message || '');
      this.showToast('取消失敗：' + (cfMsg[errCode] || (isNetworkOrTimeout ? '連線逾時，請檢查網路後重新整理再試' : err.message || '')));
      ApiService._writeErrorLog({
        fn: '_confirmCompanionCancel',
        eventId,
        userId,
        registrationCount: checked.length,
        hasSelfCancel,
        errCode,
      }, err);
    }
  },

  _openCompanionSelectModal(eventId) {
    if (this._requireProtectedActionLogin?.({ type: 'eventCompanionSignup', eventId }, { suppressToast: true })) return;
    if (this._requireProfileComplete?.()) return;
    let e = ApiService.getEvent(eventId);
    if (!e) return;
    e = this._syncEventEffectiveStatus?.(e) || e;
    if (e.status === 'ended' || e.status === 'cancelled') {
      this.showToast('\u6d3b\u52d5\u5df2\u958b\u59cb\uff0c\u7121\u6cd5\u518d\u8abf\u6574\u5925\u4f34\u5831\u540d');
      return;
    }
    if (e.status === 'upcoming') {
      this.showToast('\u5831\u540d\u5c1a\u672a\u958b\u653e\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
      return;
    }

    const companions = ApiService.getCompanions?.() || [];
    if (!companions.length) {
      this.showToast('\u8acb\u5148\u5230\u500b\u4eba\u8cc7\u8a0a\u65b0\u589e\u540c\u884c\u8005');
      return;
    }

    this._companionSelectEventId = eventId;
    const overlay = document.getElementById('companion-select-overlay');
    if (!overlay) return;
    const titleEl = document.getElementById('companion-select-title') || overlay.querySelector('.modal-header h3');
    if (titleEl) titleEl.textContent = '\u5e6b\u5925\u4f34\u5831\u540d';
    const closeBtn = overlay.querySelector('.modal-close');
    if (closeBtn) closeBtn.textContent = '\u00d7';
    const cancelBtn = overlay.querySelector('.modal-actions .outline-btn');
    if (cancelBtn) cancelBtn.textContent = '\u53d6\u6d88';
    const confirmBtn = document.getElementById('companion-select-confirm-btn');
    if (confirmBtn) confirmBtn.textContent = '\u78BA\u8A8D';

    const myRegs = ApiService.getMyRegistrationsByEvent?.(eventId) || [];
    const activeCompanionRegs = myRegs.filter(r =>
      r
      && r.status !== 'cancelled'
      && r.status !== 'removed'
      && (r.participantType === 'companion' || r.companionId)
    );
    const regByCompanionId = new Map();
    const regByCompanionName = new Map();
    activeCompanionRegs.forEach(r => {
      const cid = String(r.companionId || '').trim();
      const cname = String(r.companionName || r.userName || '').trim();
      if (cid) regByCompanionId.set(cid, r);
      if (cname) regByCompanionName.set(cname, r);
    });

    const feeEnabled = this._isEventFeeEnabled?.(e) ?? Number(e?.fee || 0) > 0;
    const fee = this._getEventFeeAmount?.(e) ?? (feeEnabled ? (Number(e?.fee || 0) || 0) : 0);
    const capacityStats = typeof this._getEventParticipantStats === 'function'
      ? this._getEventParticipantStats(e)
      : null;
    const occupiedCount = capacityStats ? capacityStats.occupiedCount : Number(e.current || 0);
    const remaining = Math.max(0, Number(e.max || 0) - occupiedCount);
    const allowedGender = this._getEventAllowedGender?.(e) || '';

    const infoEl = document.getElementById('companion-select-event-info');
    if (infoEl) {
      const feeText = feeEnabled ? (fee > 0 ? `\u8cbb\u7528\uff1aNT$${fee}/\u4eba` : '\u8cbb\u7528\uff1a\u514d\u8cbb') : '';
      const genderText = allowedGender
        ? `<br><span style="color:#dc2626;font-weight:700">\u6027\u5225\u9650\u5236\uff1a${escapeHTML(this._getEventGenderDetailText?.(e) || '')}</span>`
        : '';
      infoEl.innerHTML = `<b>${escapeHTML(e.title || '')}</b><br>${[feeText, `\u5269\u9918\u540d\u984d\uff1a${remaining}/${e.max || 0}`].filter(Boolean).join('\u3000')}${genderText}`;
    }

    const statusText = (status) => status === 'waitlisted' ? '\u5019\u88dc\u4e2d' : '\u5df2\u5831\u540d';
    const listEl = document.getElementById('companion-select-list');
    if (!listEl) return;
    listEl.classList.add('companion-select-list');
    listEl.innerHTML = companions.map(c => {
      const companionId = String(c.id || '').trim();
      const companionName = String(c.name || '').trim();
      const reg = regByCompanionId.get(companionId) || regByCompanionName.get(companionName) || null;
      const isRegistered = !!reg;
      const genderAllowed = this._canEventGenderParticipantSignup?.(e, c.gender) ?? true;
      const disabled = !isRegistered && !genderAllowed;
      const statusClass = isRegistered
        ? (reg.status === 'waitlisted' ? ' is-waitlisted' : ' is-active')
        : '';
      const rowClass = [
        'companion-toggle-row',
        isRegistered ? 'is-selected' : '',
        disabled ? 'is-disabled' : '',
      ].filter(Boolean).join(' ');
      const statusLabel = isRegistered
        ? statusText(reg.status)
        : (disabled ? '\u4e0d\u7b26\u9650\u5236' : '\u672a\u5831\u540d');
      const noteParts = [];
      if (c.notes) noteParts.push(c.notes);
      const genderBadge = c.gender
        ? `<span class="companion-toggle-gender">${escapeHTML(c.gender)}</span>`
        : '';
      return `<label class="${rowClass}">
        <input type="checkbox" name="cs-participant" value="companion"
          data-companion-id="${escapeHTML(companionId)}"
          data-name="${escapeHTML(companionName)}"
          data-registered="${isRegistered ? '1' : '0'}"
          data-reg-id="${escapeHTML(reg?.id || reg?._docId || '')}"
          ${isRegistered ? 'checked' : ''}
          ${disabled ? 'disabled' : ''}
          onchange="App._updateCompanionSelectSummary('${escapeHTML(eventId)}')">
        <span class="companion-toggle-main">
          <span class="companion-toggle-name">${escapeHTML(companionName || '\u540c\u884c\u8005')}${genderBadge}</span>
          ${noteParts.length ? `<span class="companion-toggle-note">${escapeHTML(noteParts.join(' / '))}</span>` : ''}
        </span>
        <span class="companion-toggle-status${statusClass}">${statusLabel}</span>
      </label>`;
    }).join('');

    this._updateCompanionSelectSummary(eventId);
    overlay.style.display = 'flex';
    overlay.classList.add('open');
    document.body.classList.add('modal-open');
  },

  _updateCompanionSelectSummary(eventId) {
    const e = ApiService.getEvent(eventId);
    const boxes = Array.from(document.querySelectorAll('#companion-select-list input[name="cs-participant"]'));
    let selected = 0;
    let toRegister = 0;
    let toCancel = 0;
    boxes.forEach(cb => {
      const row = cb.closest('.companion-toggle-row');
      if (row) row.classList.toggle('is-selected', cb.checked);
      if (cb.checked) selected++;
      const wasRegistered = cb.dataset.registered === '1';
      if (!cb.disabled && cb.checked && !wasRegistered) toRegister++;
      if (!cb.disabled && !cb.checked && wasRegistered) toCancel++;
    });
    const feeEnabled = this._isEventFeeEnabled?.(e) ?? Number(e?.fee || 0) > 0;
    const fee = this._getEventFeeAmount?.(e) ?? (feeEnabled ? (Number(e?.fee || 0) || 0) : 0);
    const capacityStats = e && typeof this._getEventParticipantStats === 'function'
      ? this._getEventParticipantStats(e)
      : null;
    const occupiedCount = capacityStats ? capacityStats.occupiedCount : Number(e?.current || 0);
    const remaining = Math.max(0, Number(e?.max || 0) - occupiedCount);
    const summaryEl = document.getElementById('companion-select-summary');
    if (summaryEl) {
      const feeHtml = feeEnabled && fee > 0 && toRegister > 0
        ? `<span>\u65b0\u589e\u8cbb\u7528 <b>NT$${fee * toRegister}</b></span>`
        : '';
      const waitlistWarning = toRegister > remaining
        ? `<span style="color:var(--warning);font-weight:700">\u53ef\u80fd\u6709 ${toRegister - remaining} \u4eba\u9032\u5019\u88dc</span>`
        : '';
      summaryEl.innerHTML = [
        `<span>\u5df2\u52fe\u9078 <b>${selected}</b></span>`,
        `<span>\u65b0\u589e <b>${toRegister}</b></span>`,
        `<span>\u53d6\u6d88 <b>${toCancel}</b></span>`,
        `<span>\u5269\u9918 <b>${remaining}</b></span>`,
        feeHtml,
        waitlistWarning,
      ].filter(Boolean).join('');
    }
    const confirmBtn = document.getElementById('companion-select-confirm-btn');
    if (confirmBtn) confirmBtn.disabled = (toRegister + toCancel) === 0;
  },

  async _confirmCompanionRegisterUnlocked(opts = {}, eventId) {
    if (this._requireProfileComplete?.()) { this._closeCompanionSelectModal?.(); return; }
    if (!this._cloudReady) {
      this.showToast('\u7cfb\u7d71\u8f09\u5165\u4e2d\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
      void this.ensureCloudReady?.({ reason: 'companion-signup' });
      return;
    }
    let e = ApiService.getEvent(eventId);
    if (!e) return;
    if (typeof this._isEventVisibleToUser === 'function') {
      const uid = ApiService.getCurrentUser?.()?.uid || null;
      if (!this._isEventVisibleToUser(e, uid)) {
        this._closeCompanionSelectModal?.();
        this.showToast('\u6b64\u6d3b\u52d5\u76ee\u524d\u7121\u6cd5\u5831\u540d');
        return;
      }
    }
    e = this._syncEventEffectiveStatus?.(e) || e;
    if (e.status === 'ended' || e.status === 'cancelled') {
      this._closeCompanionSelectModal?.();
      this.showToast('\u6d3b\u52d5\u5df2\u958b\u59cb\uff0c\u5831\u540d\u5df2\u7d50\u675f');
      this.showEventDetail(eventId);
      return;
    }
    if (e.status === 'upcoming') {
      this.showToast('\u5831\u540d\u5c1a\u672a\u958b\u653e\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
      return;
    }

    const user = ApiService.getCurrentUser();
    if (!user?.uid) { this.showToast('\u8acb\u5148\u767b\u5165\u5f8c\u518d\u8a66'); return; }
    const userId = user.uid;
    const boxes = Array.from(document.querySelectorAll('#companion-select-list input[name="cs-participant"]'));
    const toRegister = [];
    const toCancelIds = [];
    boxes.forEach(cb => {
      if (cb.disabled) return;
      const wasRegistered = cb.dataset.registered === '1';
      const regId = String(cb.dataset.regId || '').trim();
      if (cb.checked && !wasRegistered) {
        toRegister.push({
          type: 'companion',
          companionId: cb.dataset.companionId || '',
          companionName: cb.dataset.name || '',
        });
      }
      if (!cb.checked && wasRegistered && regId) {
        toCancelIds.push(regId);
      }
    });
    if (toRegister.length + toCancelIds.length === 0) {
      this.showToast('\u6c92\u6709\u9700\u8981\u8abf\u6574\u7684\u540c\u884c\u8005');
      return;
    }

    const companionsById = new Map((ApiService.getCompanions?.() || []).map(comp => [String(comp.id || ''), comp]));
    const invalidParticipant = toRegister.find(participant => {
      const companion = companionsById.get(String(participant.companionId || ''));
      return !(this._canEventGenderParticipantSignup?.(e, companion?.gender) ?? true);
    });
    if (invalidParticipant) {
      this.showToast(this._getCompanionGenderRestrictionMessage?.(e, invalidParticipant.companionName || '') || '\u540c\u884c\u8005\u4e0d\u7b26\u5408\u6d3b\u52d5\u6027\u5225\u9650\u5236');
      return;
    }

    const teamSplitEnabled = !!e.teamSplit?.enabled;
    const teamSplitMode = e.teamSplit?.mode;
    const selectedTeamKey = teamSplitEnabled && teamSplitMode === 'self-select'
      ? this._tsSelectedTeamKey
      : null;
    if (toRegister.length > 0 && teamSplitEnabled && teamSplitMode === 'self-select' && !selectedTeamKey) {
      const selectTeamMsg = (typeof I18N !== 'undefined' && I18N?.t)
        ? I18N.t('teamSplit.select.required')
        : '';
      this.showToast(selectTeamMsg || '\u8acb\u5148\u9078\u64c7\u968a\u4f0d');
      return;
    }

    this._closeCompanionSelectModal?.();

    let cancelled = 0;
    let confirmed = 0;
    let waitlisted = 0;
    let toggleCancelMutationSeq = null;
    let toggleCancelRequestId = '';
    let toggleRegisterMutationSeq = null;
    let toggleRegisterRequestId = '';
    try {
      if (toCancelIds.length > 0) {
        const useCancelCF = typeof shouldUseServerRegistrationForCancel === 'function'
          ? shouldUseServerRegistrationForCancel()
          : (typeof shouldUseServerRegistration === 'function' && shouldUseServerRegistration());
        toggleCancelRequestId = useCancelCF
          ? `cancel_companion_toggle_${userId}_${eventId}_${Date.now()}`
          : `fallback_companion_toggle_cancel_${userId}_${eventId}_${Date.now()}`;
        toggleCancelMutationSeq = ApiService.markEventMutationPending?.(eventId, {
          mutationType: 'companion-toggle-cancel',
          source: useCancelCF ? 'callable' : 'firestore-fallback',
          requestId: toggleCancelRequestId,
          affectedRegistrationIds: toCancelIds,
          timeoutMs: 15000,
          affectedProjectionFields: ['current', 'realCurrent', 'waitlist', 'participants', 'waitlistNames'],
        });
        if (useCancelCF) {
          const cfResult = await Promise.race([
            (await ensureFirebaseFunctionsSdk('asia-east1')).httpsCallable('cancelRegistration')({
              eventId,
              registrationIds: toCancelIds,
              reason: 'companion_toggle',
              requestId: toggleCancelRequestId,
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('cancel timeout')), 15000)),
          ]);
          const data = cfResult.data || {};
          if (!data.deduplicated) {
            this._markLocalRegistrationsTerminal?.(eventId, (data.cancelled || []).concat(data.alreadyCancelled || []).length
              ? (data.cancelled || []).concat(data.alreadyCancelled || [])
              : toCancelIds, 'cancelled');
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
            }
            FirebaseService._saveToLS?.('registrations', FirebaseService._cache?.registrations);
            FirebaseService._saveToLS?.('events', FirebaseService._cache?.events);
          }
        } else {
          await FirebaseService.cancelCompanionRegistrations(toCancelIds);
        }
        ApiService.markEventMutationServerConfirmed?.(eventId, toggleCancelMutationSeq, {
          mutationType: 'companion-toggle-cancel',
          source: useCancelCF ? 'callable' : 'firestore-fallback',
          requestId: toggleCancelRequestId,
          affectedRegistrationIds: toCancelIds,
        });
        cancelled = toCancelIds.length;
      }

      if (toRegister.length > 0) {
        const useRegisterCF = typeof shouldUseServerRegistrationForSignup === 'function'
          ? shouldUseServerRegistrationForSignup()
          : (typeof shouldUseServerRegistration === 'function' && shouldUseServerRegistration());
        toggleRegisterRequestId = useRegisterCF
          ? `${userId}_${eventId}_companions_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`
          : `fallback_companion_toggle_register_${userId}_${eventId}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
        toggleRegisterMutationSeq = ApiService.markEventMutationPending?.(eventId, {
          mutationType: 'companion-toggle-register',
          source: useRegisterCF ? 'callable' : 'firestore-fallback',
          requestId: toggleRegisterRequestId,
          timeoutMs: 15000,
          affectedProjectionFields: ['current', 'realCurrent', 'waitlist', 'participants', 'waitlistNames'],
        });
        if (useRegisterCF) {
          const cfPayload = {
            eventId,
            participants: toRegister.map(p => ({
              userId,
              userName: user.displayName || user.name || '\u4f7f\u7528\u8005',
              companionId: p.companionId,
              companionName: p.companionName,
            })),
            requestId: toggleRegisterRequestId,
          };
          if (selectedTeamKey) cfPayload.teamKey = selectedTeamKey;
          const cfResult = await Promise.race([
            (await ensureFirebaseFunctionsSdk('asia-east1')).httpsCallable('registerForEvent')(cfPayload),
            new Promise((_, reject) => setTimeout(() => reject(new Error('register timeout')), 15000)),
          ]);
          const data = cfResult.data || {};
          if (!data.deduplicated) {
            confirmed = data.confirmed || 0;
            waitlisted = data.waitlisted || 0;
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
          }
        } else {
          const result = await ApiService.registerEventWithCompanions(eventId, toRegister, {
            teamKey: selectedTeamKey || undefined,
          });
          confirmed = result.confirmed || 0;
          waitlisted = result.waitlisted || 0;
        }
        ApiService.markEventMutationServerConfirmed?.(eventId, toggleRegisterMutationSeq, {
          mutationType: 'companion-toggle-register',
          source: useRegisterCF ? 'callable' : 'firestore-fallback',
          requestId: toggleRegisterRequestId,
        });
      }

      const parts = [];
      if (confirmed + waitlisted > 0) parts.push(`\u65b0\u589e ${confirmed + waitlisted} \u4eba`);
      if (waitlisted > 0) parts.push(`\u5019\u88dc ${waitlisted} \u4eba`);
      if (cancelled > 0) parts.push(`\u53d6\u6d88 ${cancelled} \u4eba`);
      this.invalidateHomeNextActivityCache?.(userId);
      this.showToast(parts.length ? `\u5925\u4f34\u5831\u540d\u5df2\u66f4\u65b0\uff1a${parts.join('\u3001')}` : '\u5925\u4f34\u5831\u540d\u5df2\u66f4\u65b0');
      this.showEventDetail(eventId);
      this._releaseEventSignupScrollLock?.();
    } catch (err) {
      console.error('[_confirmCompanionRegister toggle]', err);
      const errCode = err?.details || err?.message || '';
      ApiService._writeErrorLog?.({
        fn: '_confirmCompanionRegister',
        mode: 'toggle_companion',
        eventId,
        userId,
        registerCount: toRegister.length,
        cancelCount: toCancelIds.length,
        errCode,
      }, err);
      const msgMap = {
        ALREADY_REGISTERED: '\u5df2\u6709\u76f8\u540c\u5831\u540d\uff0c\u8acb\u91cd\u65b0\u6574\u7406\u5f8c\u518d\u8a66',
        EVENT_NOT_FOUND: '\u627e\u4e0d\u5230\u6d3b\u52d5',
        EVENT_ENDED: '\u6d3b\u52d5\u5df2\u958b\u59cb\uff0c\u7121\u6cd5\u8abf\u6574',
        EVENT_CANCELLED: '\u6d3b\u52d5\u5df2\u53d6\u6d88',
        REG_NOT_OPEN: '\u5831\u540d\u5c1a\u672a\u958b\u653e',
        GENDER_RESTRICTED: '\u540c\u884c\u8005\u4e0d\u7b26\u5408\u6027\u5225\u9650\u5236',
        TEAM_RESTRICTED: '\u4e0d\u7b26\u5408\u7403\u968a\u9650\u5b9a',
        PROFILE_INCOMPLETE: '\u8acb\u5148\u88dc\u9f4a\u500b\u4eba\u8cc7\u6599',
        ALREADY_CANCELLED: '\u5831\u540d\u72c0\u614b\u5df2\u66f4\u65b0',
      };
      if (this._isAlreadyCancelledRegistrationError?.(err) && toCancelIds.length > 0) {
        ApiService.markEventMutationServerConfirmed?.(eventId, toggleCancelMutationSeq, {
          mutationType: 'companion-toggle-cancel',
          requestId: toggleCancelRequestId,
          affectedRegistrationIds: toCancelIds,
          reason: 'already-terminal',
        });
        this._markLocalRegistrationsTerminal?.(eventId, toCancelIds, 'cancelled');
        try { await this._syncMyEventRegistrations?.(eventId, userId); } catch (_) {}
        this.showToast('\u5925\u4f34\u5831\u540d\u5df2\u66f4\u65b0');
        this.showEventDetail(eventId);
        return;
      }
      ApiService.markEventMutationError?.(eventId, toggleCancelMutationSeq, err, {
        mutationType: 'companion-toggle-cancel',
        requestId: toggleCancelRequestId,
        affectedRegistrationIds: toCancelIds,
      });
      ApiService.markEventMutationError?.(eventId, toggleRegisterMutationSeq, err, {
        mutationType: 'companion-toggle-register',
        requestId: toggleRegisterRequestId,
      });
      this.showToast(msgMap[errCode] || err.message || '\u5925\u4f34\u5831\u540d\u8abf\u6574\u5931\u6557\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66');
    } finally {
      this._syncEventSignupScrollLock?.();
    }
  },

});
