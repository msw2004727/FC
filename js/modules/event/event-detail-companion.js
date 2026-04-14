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
    if (!overlay) return;
    overlay.style.display = 'none';
    overlay.classList.remove('open');
    this._companionSelectEventId = null;
  },

  async _confirmCompanionRegister() {
    const eventId = this._companionSelectEventId;
    if (!eventId) return;
    if (!this._cloudReady) {
      this.showToast('系統載入中，請稍候再試');
      void this.ensureCloudReady?.({ reason: 'companion-signup' });
      return;
    }
    let e = ApiService.getEvent(eventId);
    if (!e) return;
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

    this._closeCompanionSelectModal();

    try {
      const useCF = typeof shouldUseServerRegistration === 'function' && shouldUseServerRegistration();

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
          requestId: `${userId}_${eventId}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        };
        // team-split: 傳入自選 teamKey（同行者跟主報名人同隊）
        const _pendingTk = this._tsPendingTeamKey;
        if (_pendingTk) { cfPayload.teamKey = _pendingTk; this._tsPendingTeamKey = null; }
        const cfResult = await Promise.race([
          firebase.app().functions('asia-east1').httpsCallable('registerForEvent')(cfPayload),
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
          e.waitlist = data.event.waitlist;
          e.participants = data.event.participants;
          e.waitlistNames = data.event.waitlistNames;
          e.status = data.event.status;
          FirebaseService._saveToLS?.('events', FirebaseService._cache?.events);
        }
      } else {
        // ═══ 原有路徑（fallback）═══
        const result = await ApiService.registerEventWithCompanions(eventId, participantList);
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

      const wlMsg = wlCount > 0 ? `（${wlCount} 人候補）` : '';
      this.showToast(`共 ${total} 人報名成功${wlMsg}`);
      this.showEventDetail(eventId);
    } catch (err) {
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
      const errCode = err?.details || err?.message || '';
      // Plan C：PROFILE_INCOMPLETE → 自動彈出首登表單
      if (errCode === 'PROFILE_INCOMPLETE') {
        this._pendingFirstLogin = true;
        this._firstLoginShowing = false;
        this._tryShowFirstLoginModal?.();
        return;
      }
      const isNetworkOrTimeout = /timeout|network|fetch|ECONNREFUSED|逾時/i.test(err?.message || '');
      this.showToast(cfMsg[errCode] || (isNetworkOrTimeout ? '連線逾時，請檢查網路後重新整理再試' : err.message || '報名失敗，請稍後再試'));
    }
  },

  // ══════════════════════════════════
  //  Companion Cancel Modal (取消報名)
  // ══════════════════════════════════

  _companionCancelEventId: null,
  _companionCancelRegs: [],

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
    listEl.innerHTML = myRegs.map(r => {
      const displayName = r.companionName || r.userName;
      const tag = statusLabel[r.status] || r.status;
      const tagColor = r.status === 'confirmed' ? 'var(--success)' : 'var(--warning)';
      return `<label style="display:flex;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px solid var(--border);cursor:pointer">
        <input type="checkbox" name="cc-reg" value="${escapeHTML(r.id)}" checked style="width:16px;height:16px">
        <span style="flex:1;font-size:.85rem">${escapeHTML(displayName)}${r.companionId ? '' : '（本人）'}</span>
        <span style="font-size:.72rem;padding:.1rem .3rem;border-radius:3px;background:${tagColor}22;color:${tagColor}">${tag}</span>
      </label>`;
    }).join('');
    overlay.style.display = 'flex';
    overlay.classList.add('open');
  },

  _selectAllCancelRegs() {
    document.querySelectorAll('#companion-cancel-list input[name="cc-reg"]').forEach(cb => { cb.checked = true; });
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
    const checked = [...document.querySelectorAll('#companion-cancel-list input[name="cc-reg"]:checked')].map(cb => cb.value);
    if (checked.length === 0) { this.showToast('請選擇要取消的報名'); return; }

    this._closeCompanionCancelModal();

    const user = ApiService.getCurrentUser();
    const userId = user?.uid || 'unknown';

    const hasSelfCancel = this._companionCancelRegs.filter(r => checked.includes(r.id)).some(r => !r.companionId);
    const useCF = typeof shouldUseServerRegistration === 'function' && shouldUseServerRegistration();

    try {
      if (useCF) {
        // ═══ CF 路徑 ═══
        const _cfCancelTimeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('取消操作逾時，請重新整理後再試')), 15000));
        const cfResult = await Promise.race([
          firebase.app().functions('asia-east1').httpsCallable('cancelRegistration')({
            eventId,
            registrationIds: checked,
            reason: 'user_cancel',
            requestId: `cancel_companion_${userId}_${eventId}_${Date.now()}`,
          }),
          _cfCancelTimeout,
        ]);
        const data = cfResult.data;
        if (!data.deduplicated) {
          // 樂觀更新本地快取
          for (const regId of checked) {
            const localReg = (FirebaseService._cache?.registrations || []).find(r => r.id === regId);
            if (localReg) { localReg.status = 'cancelled'; localReg.cancelledAt = new Date().toISOString(); }
          }
          if (data.event) {
            const e = ApiService.getEvent(eventId);
            if (e) {
              e.current = data.event.current;
              e.waitlist = data.event.waitlist;
              e.participants = data.event.participants;
              e.waitlistNames = data.event.waitlistNames;
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
      const isNetworkOrTimeout = /timeout|network|fetch|ECONNREFUSED|逾時/i.test(err?.message || '');
      this.showToast('取消失敗：' + (cfMsg[errCode] || (isNetworkOrTimeout ? '連線逾時，請檢查網路後重新整理再試' : err.message || '')));
    }
  },

});
