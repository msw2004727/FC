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
    const feeLabel = e.fee > 0 ? `費用：NT$${e.fee}/人` : '免費';

    const infoEl = document.getElementById('companion-select-event-info');
    if (infoEl) infoEl.innerHTML = `<b>${escapeHTML(e.title)}</b><br>${feeLabel}　剩餘名額：${remaining}/${e.max}`;

    // 已報名者（不可再勾選）
    const myRegs = ApiService.getMyRegistrationsByEvent(eventId);
    const registeredCompanionIds = new Set(myRegs.map(r => r.companionId).filter(Boolean));
    const isSelfRegistered = myRegs.some(r => !r.companionId);

    const listEl = document.getElementById('companion-select-list');
    if (!listEl) return;
    const selfDisabled = isSelfRegistered ? 'disabled checked' : '';
    const selfLabel = isSelfRegistered ? '（已報名）' : '';
    listEl.innerHTML = `
      <label style="display:flex;align-items:center;gap:.5rem;padding:.35rem 0;border-bottom:1px solid var(--border);cursor:pointer">
        <input type="checkbox" name="cs-participant" value="self" data-name="${escapeHTML(userName)}" ${selfDisabled} style="width:16px;height:16px" onchange="App._updateCompanionSelectSummary('${eventId}')">
        <span style="font-size:.85rem;font-weight:600">&#x1f464; ${escapeHTML(userName)}（本人）${selfLabel}</span>
      </label>
      ${companions.map(c => {
        const alreadyReg = registeredCompanionIds.has(c.id);
        const dis = alreadyReg ? 'disabled checked' : '';
        const lbl = alreadyReg ? '（已報名）' : '';
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
    const fee = e?.fee || 0;
    const remaining = Math.max(0, (e?.max || 0) - (e?.current || 0));
    const summaryEl = document.getElementById('companion-select-summary');
    if (summaryEl) {
      summaryEl.innerHTML = `<span>已選 <b>${selected}</b> 人</span>${fee > 0 ? `<span>預計費用 <b>NT$${fee * selected}</b></span>` : ''}<span>剩餘名額 <b>${remaining}</b></span>`;
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
    const e = ApiService.getEvent(eventId);
    if (!e) return;

    const checkboxes = document.querySelectorAll('#companion-select-list input[name="cs-participant"]:not([disabled]):checked');
    if (checkboxes.length === 0) { this.showToast('請至少選擇一位參與者'); return; }

    const user = ApiService.getCurrentUser();
    const userId = user?.uid || 'unknown';
    const participantList = [];
    checkboxes.forEach(cb => {
      if (cb.value === 'self') {
        participantList.push({ type: 'self' });
      } else {
        participantList.push({ type: 'companion', companionId: cb.dataset.companionId, companionName: cb.dataset.name });
      }
    });

    this._closeCompanionSelectModal();

    try {
      const result = await ApiService.registerEventWithCompanions(eventId, participantList);
      const regCount = (result.registered || []).length + (result.confirmed || 0);
      const wlCount = (result.waitlisted || []).length + (result.waitlisted || 0);
      const total = participantList.length;

      // 寫入 activityRecords（只紀錄本人）
      const selfSelected = participantList.find(p => p.type === 'self');
      if (selfSelected) {
        const dateParts = e.date.split(' ')[0].split('/');
        const dateStr = `${dateParts[1]}/${dateParts[2]}`;
        const isWl = e.current > e.max;
        ApiService.addActivityRecord({
          eventId: e.id, name: e.title, date: dateStr,
          status: isWl ? 'waitlisted' : 'registered', uid: userId,
        });
        if (!isWl) this._grantAutoExp(userId, 'register_activity', e.title);
      }

      const wlMsg = wlCount > 0 ? `（${wlCount} 人候補）` : '';
      this.showToast(`共 ${total} 人報名成功${wlMsg}`);
      this.showEventDetail(eventId);
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
          this._grantAutoExp(userId, 'cancel_registration', e.title);
        }
      }
      this.showToast(`已取消 ${checked.length} 筆報名`);
      this.showEventDetail(eventId);
      return;
    }

    FirebaseService.cancelCompanionRegistrations(checked)
      .then(() => {
        this.showToast(`已取消 ${checked.length} 筆報名`);
        this.showEventDetail(eventId);
      })
      .catch(err => { console.error('[_confirmCompanionCancel]', err); this.showToast('取消失敗：' + (err.message || '')); });
  },

});
