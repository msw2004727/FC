/* ================================================
   SportHub — Event: Create & Edit (Main Flow)
   依賴：event-list.js (helpers)
   拆分模組：event-create-input-history / sport-picker / delegates / options / team-picker / external
              event-create-template / event-create-waitlist
   innerHTML uses escapeHTML() for all user-supplied values
   ================================================ */

Object.assign(App, {

  //  Create Event
  // ══════════════════════════════════

  _editEventId: null,
  _eventSubmitInFlight: false,

  _setCreateEventSubmitIdleLabel(label) {
    const submitBtn = document.getElementById('ce-submit-btn');
    if (!submitBtn) return;
    submitBtn.dataset.idleLabel = label;
    submitBtn.textContent = label;
    submitBtn.disabled = false;
    submitBtn.style.opacity = '';
    submitBtn.style.cursor = '';
  },

  _setCreateEventSubmitting(isSubmitting) {
    const submitBtn = document.getElementById('ce-submit-btn');
    if (!submitBtn) return;
    const idleLabel = submitBtn.dataset.idleLabel || submitBtn.textContent || '建立活動';
    if (!submitBtn.dataset.idleLabel) submitBtn.dataset.idleLabel = idleLabel;
    if (isSubmitting) {
      submitBtn.disabled = true;
      submitBtn.style.opacity = '0.72';
      submitBtn.style.cursor = 'not-allowed';
      submitBtn.textContent = this._editEventId ? '儲存中...' : '建立中...';
      return;
    }
    submitBtn.disabled = false;
    submitBtn.style.opacity = '';
    submitBtn.style.cursor = '';
    submitBtn.textContent = idleLabel;
  },

  openCreateEventModal() {
    // 彈底部 Action Sheet：選擇建立自訂活動或活動連結
    this._showCreateEventTypeSheet();
  },

  _showCreateEventTypeSheet() {
    const existing = document.getElementById('create-event-type-sheet');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'create-event-type-sheet';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:1300;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center';
    overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });

    const sheet = document.createElement('div');
    sheet.style.cssText = 'background:var(--bg-card);border-radius:var(--radius-lg) var(--radius-lg) 0 0;width:100%;max-width:440px;padding:1rem 1rem .6rem;animation:slideUp .25s ease-out';

    sheet.innerHTML = `
      <div style="font-weight:700;font-size:.92rem;margin-bottom:.8rem;text-align:center">選擇活動類型</div>
      <button id="cets-custom" style="width:100%;padding:.7rem;margin-bottom:.4rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-elevated);color:var(--text-primary);font-size:.85rem;font-weight:600;cursor:pointer;text-align:left;display:flex;align-items:center;gap:.6rem">
        <span style="font-size:1.3rem">📋</span>
        <span><div>自訂活動</div><div style="font-size:.72rem;font-weight:400;color:var(--text-muted);margin-top:.15rem">建立可報名的活動（含人數、費用等設定）</div></span>
      </button>
      <button id="cets-external" style="width:100%;padding:.7rem;margin-bottom:.6rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-elevated);color:var(--text-primary);font-size:.85rem;font-weight:600;cursor:pointer;text-align:left;display:flex;align-items:center;gap:.6rem">
        <span style="font-size:1.3rem">🔗</span>
        <span><div>活動連結</div><div style="font-size:.72rem;font-weight:400;color:var(--text-muted);margin-top:.15rem">連結外部平台活動，點擊直接跳轉</div></span>
      </button>
      <button id="cets-cancel" style="width:100%;padding:.55rem;border:none;border-radius:var(--radius);background:transparent;color:var(--text-muted);font-size:.82rem;cursor:pointer">取消</button>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    sheet.querySelector('#cets-custom').addEventListener('click', () => {
      overlay.remove();
      this._openCreateCustomEventModal();
    });
    sheet.querySelector('#cets-external').addEventListener('click', () => {
      overlay.remove();
      this.openCreateExternalEventModal();
    });
    sheet.querySelector('#cets-cancel').addEventListener('click', () => overlay.remove());
  },

  _openCreateCustomEventModal() {
    this._editEventId = null;
    this._delegates = [];
    // 重置表單欄位，防止編輯後殘留資料
    document.getElementById('ce-title').value = '';
    document.getElementById('ce-type').value = 'play';
    document.getElementById('ce-location').value = '';
    document.getElementById('ce-date').value = '';
    document.getElementById('ce-time-start').value = '14:00';
    document.getElementById('ce-time-end').value = '16:00';
    this._setEventFeeFormState(false, 0);
    document.getElementById('ce-max').value = '20';
    document.getElementById('ce-waitlist').value = '0';
    document.getElementById('ce-min-age').value = '0';
    document.getElementById('ce-notes').value = '';
    document.getElementById('ce-sport-tag').value = '';
    this._setEventRegOpenTimeValue('');
    document.getElementById('ce-image').value = '';
    const ceTeamOnly = document.getElementById('ce-team-only');
    const ceTeamSelect = document.getElementById('ce-team-select');
    if (ceTeamSelect) Array.from(ceTeamSelect.options || []).forEach(opt => { opt.selected = false; });
    if (ceTeamOnly) { ceTeamOnly.checked = false; this._updateTeamOnlyLabel(); }
    this._setGenderRestrictionState(false, '');
    const cePreview = document.getElementById('ce-upload-preview');
    if (cePreview) {
      cePreview.classList.remove('has-image');
      cePreview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 800 × 300 px｜JPG / PNG｜最大 2MB</span>';
    }
    this._eventSubmitInFlight = false;
    this._setCreateEventSubmitIdleLabel('建立活動');
    // 確保事件已綁定（防止 Phase 1 非同步時機導致未綁定）
    this.bindImageUpload('ce-image', 'ce-upload-preview');
    this.bindTeamOnlyToggle();
    this.bindEventFeeToggle();
    this.bindGenderRestrictionToggle();
    this._initSportTagPicker('');
    this.showModal('create-event-modal');
    this._initDelegateSearch();
    this._renderHistoryChips('ce-location', 'ce-location');
    this._renderHistoryChips('ce-fee', 'ce-fee');
    this._renderHistoryChips('ce-max', 'ce-max');
    this._renderHistoryChips('ce-min-age', 'ce-min-age');
    this._renderRecentDelegateChips('ce-delegate-tags', 'ce');
    this._renderTemplateSelector();
    void this._ensureEventTemplatesReady();
  },

  // (Fee, Gender, Team-only, Reg open time, Delegates, Sport picker, External event
  //  moved to: event-create-options.js, event-create-delegates.js,
  //  event-create-sport-picker.js, event-create-external.js,
  //  event-create-input-history.js)

  async handleCreateEvent() {
    if (this._eventSubmitInFlight) {
      this.showToast('活動建立中，請勿重複送出');
      return;
    }
    if (!this.hasPermission('activity.manage.entry')) {
      this.showToast('權限不足'); return;
    }
    const title = document.getElementById('ce-title').value.trim();
    const type = document.getElementById('ce-type').value;
    const location = document.getElementById('ce-location').value.trim();
    const dateVal = document.getElementById('ce-date').value;
    const tStart = document.getElementById('ce-time-start').value;
    const tEnd = document.getElementById('ce-time-end').value;
    const timeVal = (tStart && tEnd) ? `${tStart}~${tEnd}` : '';
    const feeEnabled = !!document.getElementById('ce-fee-enabled')?.checked;
    const fee = feeEnabled ? (parseInt(document.getElementById('ce-fee').value, 10) || 0) : 0;
    const max = parseInt(document.getElementById('ce-max').value) || 20;
    const minAge = parseInt(document.getElementById('ce-min-age').value) || 0;
    const notes = document.getElementById('ce-notes').value.trim();
    const sportTag = getSportKeySafe(document.getElementById('ce-sport-tag')?.value || this._selectedSportTag || '');
    const regOpenTime = this._getEventRegOpenTimeValue();
    const teamOnly = !!document.getElementById('ce-team-only')?.checked;
    const genderRestrictionEnabled = !!document.getElementById('ce-gender-restriction-enabled')?.checked;
    const allowedGender = genderRestrictionEnabled ? this._getAllowedGenderValue() : '';

    if (!title) { this.showToast('請輸入活動名稱'); return; }
    if (title.length > 16) { this.showToast('活動名稱不可超過 16 字'); return; }
    if (!location) { this.showToast('請輸入地點'); return; }
    if (!dateVal) { this.showToast('請選擇活動日期'); return; }
    if (!tStart || !tEnd) { this.showToast('請選擇開始與結束時間'); return; }
    if (regOpenTime === null) { this.showToast('請完整選擇開放報名日期與時間'); return; }
    // 新增模式：不允許選擇過去的日期時間
    if (feeEnabled && fee <= 0) { this.showToast('請輸入活動費用'); return; }
    if (!this._editEventId) {
      const startDt = new Date(`${dateVal}T${tStart}`);
      if (startDt < new Date()) { this.showToast('活動開始時間不可早於現在'); return; }
    }
    if (tEnd <= tStart) { this.showToast('結束時間必須晚於開始時間'); return; }
    if (notes.length > 500) { this.showToast('注意事項不可超過 500 字'); return; }
    if (!sportTag) { this.showToast('請先選擇運動 / 場景標籤（必選）'); return; }
    if (genderRestrictionEnabled && !allowedGender) { this.showToast('請選擇限定性別'); return; }
    // 俱樂部限定：決定 teamId / teamName
    let resolvedTeamId = null, resolvedTeamName = null;
    if (teamOnly) {
      const team = this._getEventCreatorTeam();
      if (team.teamId) {
        resolvedTeamId = team.teamId;
        resolvedTeamName = team.teamName;
      } else {
        // 從下拉選單取
        const select = document.getElementById('ce-team-select');
        const selVal = select?.value;
        if (!selVal) { this.showToast('請選擇限定俱樂部'); return; }
        resolvedTeamId = selVal;
        resolvedTeamName = select.options[select.selectedIndex]?.dataset?.name || selVal;
      }
    }

    let resolvedTeamIds = [], resolvedTeamNames = [];
    if (teamOnly) {
      const selectedTeams = this._resolveTeamOnlySelection();
      if (selectedTeams.length === 0) { this.showToast('請至少選擇 1 支俱樂部'); return; }
      resolvedTeamIds = selectedTeams.map(t => t.id);
      resolvedTeamNames = selectedTeams.map(t => t.name || t.id);
      resolvedTeamId = resolvedTeamIds[0] || null;
      resolvedTeamName = resolvedTeamNames[0] || null;
    }

    const cePreviewEl = document.getElementById('ce-upload-preview');
    const ceImg = cePreviewEl?.querySelector('img');
    const image = ceImg ? ceImg.src : null;

    const fullDate = `${dateVal.replace(/-/g, '/')} ${timeVal}`;

    if (this._editEventId) {
      // Trigger 6：活動變更通知 — 先取得現有報名者
      const existingEvent = ApiService.getEvent(this._editEventId);
      const notifyUids = this._collectEventNotifyRecipientUids
        ? this._collectEventNotifyRecipientUids(existingEvent, this._editEventId)
        : (() => {
          const set = new Set((ApiService.getRegistrationsByEvent(this._editEventId) || []).map(r => r.userId).filter(Boolean));
          if (set.size || !existingEvent) return set;
          const nameToUid = new Map();
          (ApiService.getAdminUsers() || []).forEach(u => {
            if (!u?.name || !u?.uid) return;
            if (!nameToUid.has(u.name)) nameToUid.set(u.name, u.uid);
          });
          const allNames = [...(existingEvent.participants || []), ...(existingEvent.waitlistNames || [])];
          allNames.forEach(name => {
            const uid = nameToUid.get(name);
            if (uid) set.add(uid);
          });
          return set;
        })();

      const updates = {
        title, type, location, date: fullDate, fee, feeEnabled, max, minAge, notes, image, sportTag,
        regOpenTime: regOpenTime || null,
        gradient: GRADIENT_MAP[type] || GRADIENT_MAP.friendly,
        teamOnly,
        genderRestrictionEnabled,
        allowedGender,
        creatorTeamId: teamOnly ? resolvedTeamId : null,
        creatorTeamName: teamOnly ? resolvedTeamName : null,
        creatorTeamIds: teamOnly ? [...resolvedTeamIds] : [],
        creatorTeamNames: teamOnly ? [...resolvedTeamNames] : [],
        delegates: [...this._delegates],
      };
      // 已結束/已取消的活動編輯時不改變狀態
      if (existingEvent && (existingEvent.status === 'ended' || existingEvent.status === 'cancelled')) {
        // 保持原狀態，不做任何改變
      } else if (regOpenTime && new Date(regOpenTime) > new Date()) {
        // 若有設定報名時間且尚未到達，更新狀態為 upcoming
        updates.status = 'upcoming';
      } else if (existingEvent && existingEvent.status === 'upcoming') {
        // 報名時間已到或未設定，確保不是 upcoming
        updates.status = this._isEventTrulyFull(existingEvent) ? 'full' : 'open';
      }
      const oldMax = existingEvent ? existingEvent.max : max;
      ApiService.updateEvent(this._editEventId, updates);
      // ── 編輯成功：先完成關鍵收尾 ──
      this.closeModal();
      this.showToast(`活動「${title}」已更新！`);
      const editedId = this._editEventId;
      this._editEventId = null;
      // 非關鍵操作：即使失敗也不影響用戶體驗
      try {
        this._adjustWaitlistOnCapacityChange(editedId, oldMax, max);
        notifyUids.forEach(uid => {
          this._sendNotifFromTemplate('event_changed', {
            eventName: title, date: fullDate, location,
          }, uid, 'activity', '活動');
        });
        ApiService._writeOpLog('event_edit', '編輯活動', `編輯「${title}」`);
      } catch (postErr) {
        console.warn('[handleCreateEvent] post-edit error:', postErr);
      }
      // 重新渲染（獨立於上方 try-catch，確保即使記錄操作失敗也能刷新列表）
      try { this.renderActivityList(); } catch (_) {}
      try { this.renderHotEvents(); } catch (_) {}
      try { this.renderMyActivities(); } catch (_) {}
    } else {
      const creatorName = this._getEventCreatorName();
      const creatorUid = this._getEventCreatorUid();
      const initStatus = (regOpenTime && new Date(regOpenTime) > new Date()) ? 'upcoming' : 'open';
      const newEvent = {
        id: 'ce_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        title, type, status: initStatus, location, date: fullDate,
        fee, feeEnabled, max, current: 0, waitlist: 0, minAge, notes, image, sportTag,
        regOpenTime: regOpenTime || null,
        creator: creatorName,
        creatorUid,
        contact: '',
        gradient: GRADIENT_MAP[type] || GRADIENT_MAP.friendly,
        icon: '',
        countdown: '即將開始',
        participants: [],
        waitlistNames: [],
        teamOnly,
        genderRestrictionEnabled,
        allowedGender,
        creatorTeamId: teamOnly ? resolvedTeamId : null,
        creatorTeamName: teamOnly ? resolvedTeamName : null,
        creatorTeamIds: teamOnly ? [...resolvedTeamIds] : [],
        creatorTeamNames: teamOnly ? [...resolvedTeamNames] : [],
        delegates: [...this._delegates],
      };
      this._eventSubmitInFlight = true;
      this._setCreateEventSubmitting(true);
      try {
        await ApiService.createEvent(newEvent);
      } catch (err) {
        console.error('[handleCreateEvent:createEvent]', err);
        this.showToast('建立活動失敗，請稍後再試');
        this._eventSubmitInFlight = false;
        this._setCreateEventSubmitting(false);
        return;
      }
      // ── 建立成功：先完成關鍵收尾（closeModal + toast），再處理非關鍵操作 ──
      this.closeModal();
      this.showToast(`活動「${title}」已建立！`);
      this._eventSubmitInFlight = false;
      this._setCreateEventSubmitting(false);
      // 非關鍵操作：即使失敗也不影響用戶體驗
      try {
        this._saveInputHistory('ce-location', location);
        if (feeEnabled && fee > 0) this._saveInputHistory('ce-fee', fee);
        this._saveInputHistory('ce-max', max);
        if (minAge > 0) this._saveInputHistory('ce-min-age', minAge);
        this._saveRecentDelegates(this._delegates);
        ApiService._writeOpLog('event_create', '建立活動', `建立「${title}」`);
        const _creatorUser = ApiService.getCurrentUser?.();
        if (_creatorUser?.uid) this._grantAutoExp?.(_creatorUser.uid, 'host_activity', title);
      } catch (postErr) {
        console.warn('[handleCreateEvent] post-create error:', postErr);
      }
      // 重新渲染（獨立於上方 try-catch，確保即使記錄操作失敗也能刷新列表）
      try { this.renderActivityList(); } catch (_) {}
      try { this.renderHotEvents(); } catch (_) {}
      try { this.renderMyActivities(); } catch (_) {}
      // 活動建立成功後提示分享到 LINE
      if (newEvent.id && typeof this._promptShareAfterCreate === 'function') {
        const _eid = newEvent.id;
        setTimeout(() => this._promptShareAfterCreate(_eid).catch(err => console.warn('[Share] prompt failed:', err)), 500);
      }
    }

    // 重置表單
    this._editEventId = null;
    document.getElementById('ce-title').value = '';
    document.getElementById('ce-location').value = '';
    this._setEventFeeFormState(false, 0);
    document.getElementById('ce-max').value = '20';
    document.getElementById('ce-waitlist').value = '0';
    document.getElementById('ce-min-age').value = '0';
    document.getElementById('ce-notes').value = '';
    document.getElementById('ce-sport-tag').value = '';
    this._setEventRegOpenTimeValue('');
    document.getElementById('ce-image').value = '';
    document.getElementById('ce-date').value = '';
    document.getElementById('ce-time-start').value = '14:00';
    document.getElementById('ce-time-end').value = '16:00';
    this._delegates = [];
    this._renderDelegateTags();
    this._updateDelegateInput();
    const ceTeamOnly = document.getElementById('ce-team-only');
    const ceTeamSelect = document.getElementById('ce-team-select');
    if (ceTeamSelect) Array.from(ceTeamSelect.options || []).forEach(opt => { opt.selected = false; });
    if (ceTeamOnly) { ceTeamOnly.checked = false; this._updateTeamOnlyLabel(); }
    this._setGenderRestrictionState(false, '');
    const cePreview = document.getElementById('ce-upload-preview');
    if (cePreview) {
      cePreview.classList.remove('has-image');
      cePreview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 800 × 300 px｜JPG / PNG｜最大 2MB</span>';
    }
    this._initSportTagPicker('');
  },

  /** 同步活動計數至 Firebase */
  async _syncEventToFirebase(event) {
    if (!ModeManager.isDemo() && event._docId) {
      try {
        await db.collection('events').doc(event._docId).update({
          current: event.current,
          waitlist: event.waitlist,
          participants: event.participants || [],
          waitlistNames: event.waitlistNames || [],
          status: event.status,
        });
      } catch (err) {
        console.error('[syncEvent]', err);
        if (typeof this.showToast === 'function') this.showToast('活動同步失敗，請重試');
      }
    }
    // 同步本地快取到 localStorage
    if (typeof FirebaseService !== 'undefined' && typeof FirebaseService._saveToLS === 'function') {
      FirebaseService._saveToLS('events', FirebaseService._cache.events);
    }
  },

});
