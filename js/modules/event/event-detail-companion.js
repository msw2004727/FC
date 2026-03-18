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
      const result = await ApiService.registerEventWithCompanions(eventId, participantList);
      const regCount = result.confirmed || 0;
      const wlCount = result.waitlisted || 0;
      const total = regCount + wlCount;
      // ── 即時回饋：先顯示結果、刷新頁面 ──
      const wlMsg = wlCount > 0 ? `（${wlCount} 人候補）` : '';
      this.showToast(`共 ${total} 人報名成功${wlMsg}`);
      this.showEventDetail(eventId);
      // ── 背景 post-ops（fire-and-forget，不阻塞 UI）──
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
        if (!ModeManager.isDemo()) {
          db.collection('activityRecords').add({
            ...arRecord, createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          }).then(ref => { arRecord._docId = ref.id; })
            .catch(err => console.error('[companionRegAR]', err));
        }
        if (!isWl) this._grantAutoExp?.(userId, 'register_activity', e.title);
      }
    } catch (err) {
      console.error('[_confirmCompanionRegister]', err);
      this.showToast(err.message || '報名失敗，請稍後再試');
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

    if (ApiService._demoMode) {
      const e = ApiService.getEvent(eventId);
      if (e) {
        const regsToCancel = this._companionCancelRegs.filter(r => checked.includes(r.id));
        regsToCancel.forEach(r => {
          // 更新 demo registrations 狀態（以 registration 為計數主源）
          const reg = ApiService._src('registrations').find(reg => reg.id === r.id);
          if (reg && reg.status !== 'cancelled') {
            const wasWaitlisted = reg.status === 'waitlisted';
            reg.status = 'cancelled';
            reg.cancelledAt = new Date().toISOString();
            if (wasWaitlisted) {
              e.waitlist = Math.max(0, e.waitlist - 1);
            } else {
              e.current = Math.max(0, e.current - 1);
            }
          } else {
            // Fallback: 舊資料用 participants/waitlistNames
            const displayName = r.companionName || r.userName;
            const pi = (e.participants || []).indexOf(displayName);
            if (pi >= 0) { e.participants.splice(pi, 1); e.current = Math.max(0, e.current - 1); }
            const wi = (e.waitlistNames || []).indexOf(displayName);
            if (wi >= 0) { e.waitlistNames.splice(wi, 1); e.waitlist = Math.max(0, e.waitlist - 1); }
          }
        });
        e.status = e.current >= e.max ? 'full' : 'open';
        const hasSelfCancel = regsToCancel.some(r => !r.companionId);
        if (hasSelfCancel) {
          const dateParts = e.date.split(' ')[0].split('/');
          const dateStr = `${dateParts[1]}/${dateParts[2]}`;
          const records = ApiService.getActivityRecords();
          for (let i = records.length - 1; i >= 0; i--) {
            if (records[i].eventId === eventId && records[i].uid === userId && records[i].status !== 'cancelled') {
              records.splice(i, 1);
            }
          }
          ApiService.addActivityRecord({ eventId, name: e.title, date: dateStr, status: 'cancelled', uid: userId });
          this._grantAutoExp?.(userId, 'cancel_registration', e.title);
          this._notifySignupCancelledInboxFromTemplate(e, userId, false);
        }
      }
      this.showToast(`已取消 ${checked.length} 筆報名`);
      this.showEventDetail(eventId);
      return;
    }

    // 判斷本人是否被取消（同行者不動母用戶紀錄）
    const hasSelfCancel = this._companionCancelRegs.filter(r => checked.includes(r.id)).some(r => !r.companionId);

    FirebaseService.cancelCompanionRegistrations(checked)
      .then(() => {
        if (hasSelfCancel) {
          const e = ApiService.getEvent(eventId);
          if (e) {
            // 優先更新現有 registered 紀錄為 cancelled
            // 快取更新
            const arSource = ApiService._src('activityRecords');
            const existingAR = arSource.find(a => a.eventId === eventId && a.uid === userId && a.status !== 'cancelled');
            if (existingAR) {
              existingAR.status = 'cancelled';
              if (existingAR._docId) {
                db.collection('activityRecords').doc(existingAR._docId).update({ status: 'cancelled' })
                  .catch(err => console.error('[companionCancelAR]', err));
              }
            } else if (!arSource.some(a => a.eventId === eventId && a.uid === userId && a.status === 'cancelled')) {
              const dp = e.date.split(' ')[0].split('/');
              const dateStr = `${dp[1]}/${dp[2]}`;
              const arCancel = { eventId, name: e.title, date: dateStr, status: 'cancelled', uid: userId };
              ApiService.addActivityRecord(arCancel);
              db.collection('activityRecords').add({
                ...arCancel, createdAt: firebase.firestore.FieldValue.serverTimestamp(),
              }).then(ref => { arCancel._docId = ref.id; })
                .catch(err => console.error('[companionCancelAR]', err));
            }
            // Firestore 直查兜底：快取可能未載入
            db.collection('activityRecords')
              .where('uid', '==', userId).where('eventId', '==', eventId)
              .get().then(snap => {
                snap.forEach(doc => {
                  if (doc.data().status !== 'cancelled') {
                    doc.ref.update({ status: 'cancelled' })
                      .catch(err => console.error('[companionCancelAR-fallback]', err));
                  }
                });
              }).catch(err => console.error('[companionCancelAR-fallback query]', err));
            this._grantAutoExp?.(userId, 'cancel_registration', e.title);
            this._notifySignupCancelledInboxFromTemplate(e, userId, false);
          }
        }
        this.showToast(`已取消 ${checked.length} 筆報名`);
        this.showEventDetail(eventId);
      })
      .catch(err => { console.error('[_confirmCompanionCancel]', err); this.showToast('取消失敗：' + (err.message || '')); });
  },

});
