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
    this._setPrivateEventState(false);
    this._tsSetFormData?.(null);
    this._regionSetFormData?.(true, '中部', typeof REGION_MAP !== 'undefined' && REGION_MAP['中部'] ? [...REGION_MAP['中部']] : []);
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
    this.bindPrivateEventToggle();
    this.bindTeamSplitToggle?.();
    this.bindRegionToggle?.();
    this._resetMultiDates();
    this._initMultiDatePicker();
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
    if (!this.hasPermission('event.create') && !this.hasPermission('activity.manage.entry')) {
      this.showToast('權限不足'); return;
    }
    const title = document.getElementById('ce-title').value.trim();
    const type = document.getElementById('ce-type').value;
    const location = document.getElementById('ce-location').value.trim();
    const dateVal = document.getElementById('ce-date').value
      || (this._multiDates && this._multiDates.length ? this._multiDates[0] : '');
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
    const privateEvent = !!document.getElementById('ce-private-event')?.checked;
    const teamSplitData = this._tsGetFormData?.() || null;
    const regionData = this._regionGetFormData?.() || { regionEnabled: true, region: '', cities: [] };

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
    if (regionData.regionEnabled && !regionData.region) { this.showToast('請選擇活動地區'); return; }
    // 俱樂部限定：決定 teamId / teamName
    let resolvedTeamId = null, resolvedTeamName = null;
    if (teamOnly && !this.hasPermission('team.create_event') && !this.hasPermission('activity.manage.entry')) {
      this.showToast('權限不足：無法建立俱樂部限定活動'); return;
    }
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
        privateEvent,
        regionEnabled: regionData.regionEnabled,
        region: regionData.region,
        cities: regionData.cities,
        creatorTeamId: teamOnly ? resolvedTeamId : null,
        creatorTeamName: teamOnly ? resolvedTeamName : null,
        creatorTeamIds: teamOnly ? [...resolvedTeamIds] : [],
        creatorTeamNames: teamOnly ? [...resolvedTeamNames] : [],
        delegates: [...this._delegates],
        delegateUids: this._delegates.map(d => String(d.uid || '').trim()).filter(Boolean),
      };
      if (teamSplitData) {
        updates.teamSplit = teamSplitData;
        this._recalcTeamSplitTimestamps?.(updates);
      }
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
      this._eventSubmitInFlight = true;
      try {
        await ApiService.updateEventAwait(this._editEventId, updates);
      } catch (err) {
        this._eventSubmitInFlight = false;
        this._setCreateEventSubmitting?.(false);
        if (!err?._toasted) this.showToast('活動更新失敗，請重試');
        return;
      }
      this._eventSubmitInFlight = false;
      // ── 編輯成功：先完成關鍵收尾 ──
      this.closeModal();
      this.showToast(`活動「${title}」已更新！`);
      const editedId = this._editEventId;
      this._editEventId = null;
      // 非關鍵操作：即使失敗也不影響用戶體驗
      try {
        await this._adjustWaitlistOnCapacityChange(editedId, oldMax, max);
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
        isPublic: !!teamOnly,
        genderRestrictionEnabled,
        allowedGender,
        privateEvent,
        regionEnabled: regionData.regionEnabled,
        region: regionData.region,
        cities: regionData.cities,
        creatorTeamId: teamOnly ? resolvedTeamId : null,
        creatorTeamName: teamOnly ? resolvedTeamName : null,
        creatorTeamIds: teamOnly ? [...resolvedTeamIds] : [],
        creatorTeamNames: teamOnly ? [...resolvedTeamNames] : [],
        delegates: [...this._delegates],
        delegateUids: this._delegates.map(d => String(d.uid || '').trim()).filter(Boolean),
      };
      if (teamSplitData) {
        newEvent.teamSplit = teamSplitData;
        this._recalcTeamSplitTimestamps?.(newEvent);
      }
      this._eventSubmitInFlight = true;
      this._setCreateEventSubmitting(true);

      // ★ 多日期模式：批次建立所有場次
      let totalCreated = 1;
      if (this._isMultiDateMode()) {
        const allEvents = this._buildMultiDateEvents(newEvent, tStart, tEnd);
        try {
          for (const evt of allEvents) {
            await ApiService.createEvent(evt);
          }
          totalCreated = allEvents.length;
        } catch (err) {
          console.error('[handleCreateEvent:multiDate]', err);
          this.showToast('部分活動建立失敗，請檢查活動列表');
          this._eventSubmitInFlight = false;
          this._setCreateEventSubmitting(false);
          return;
        }
      } else {
        try {
          await ApiService.createEvent(newEvent);
        } catch (err) {
          console.error('[handleCreateEvent:createEvent]', err);
          this.showToast('建立活動失敗，請稍後再試');
          this._eventSubmitInFlight = false;
          this._setCreateEventSubmitting(false);
          return;
        }
      }
      // ── 建立成功：先完成關鍵收尾（closeModal + toast），再處理非關鍵操作 ──
      this.closeModal();
      const toastMsg = totalCreated > 1 ? '已建立 ' + totalCreated + ' 場「' + title + '」活動！' : '活動「' + title + '」已建立！';
      this.showToast(toastMsg);
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
    this._setPrivateEventState(false);
    this._resetMultiDates();
    const cePreview = document.getElementById('ce-upload-preview');
    if (cePreview) {
      cePreview.classList.remove('has-image');
      cePreview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 800 × 300 px｜JPG / PNG｜最大 2MB</span>';
    }
    this._initSportTagPicker('');
  },

  /** 同步活動計數至 Firebase */
  async _syncEventToFirebase(event) {
    if (event._docId) {
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

  // ═══════════════════════════════
  //  欄位說明彈窗
  // ═══════════════════════════════

  _ceInfoData: {
    template: {
      title: '從範本建立',
      body: '載入之前儲存的活動設定，快速填入所有欄位。載入後仍可修改任何內容。',
    },
    title: {
      title: '活動名稱',
      body: '為活動取一個簡短好懂的名稱，上限 16 字。<p style="margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem">例：「週三足球」、「假日友誼賽」</p>',
    },
    type: {
      title: '活動類型',
      body: '<b>PLAY</b> — 一般揪團踢球<br><b>教學</b> — 教練帶隊訓練<br><b>觀賽</b> — 觀看比賽<p style="margin:.4rem 0 0;color:var(--text-muted);font-size:.8rem">類型會影響統計分類與首頁顯示位置。</p>',
    },
    region: {
      title: '活動地區',
      body: '選擇活動所在的地區分區。用戶可透過地區頁籤快速找到該區域的活動。<br><br>• <b>北部</b>：台北、新北、基隆、桃園、新竹、宜蘭<br>• <b>中部</b>：苗栗、台中、彰化、南投、雲林<br>• <b>南部</b>：嘉義、台南、高雄、屏東<br>• <b>東部&amp;外島</b>：花蓮、台東、澎湖、金門、連江<br><br>選擇分區後，<b>至少須勾選一個縣市</b>，不可全部取消。<br><br>管理員可關閉此選項，讓活動在所有地區頁籤都顯示。'
    },
    location: {
      title: '活動地點',
      body: '輸入場地名稱或地址。系統會記住最近使用的地點，下次可直接選取。',
    },
    time: {
      title: '活動時間',
      body: '選擇日期與開始 / 結束時間。<p style="margin:.4rem 0 0">選擇<b>多個日期</b>可一次建立多場活動（批次建立），每場獨立管理報名與出席。</p>',
    },
    regOpen: {
      title: '開放報名時間',
      body: '設定報名開始的日期與時間。<p style="margin:.3rem 0 0"><b>未設定</b>：活動建立後立即開放報名。</p><p style="margin:.3rem 0 0"><b>已設定</b>：時間未到前顯示「即將開放」。</p><p style="margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem">多日期模式下可設「活動開始前 N 天 N 時」，系統會自動為每場計算各自的開放時間。</p>',
    },
    fee: {
      title: '費用',
      body: '開啟後輸入每人費用（新台幣）。金額會顯示在活動詳情頁，方便參加者提前準備。<p style="margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem">關閉 = 免費活動。</p>',
    },
    max: {
      title: '人數上限',
      body: '設定最多可報名的人數。額滿後新報名者自動進入<b>候補名單</b>，有人取消時系統依報名順序自動遞補。',
    },
    age: {
      title: '年齡限制',
      body: '設定參加者的最低年齡。填 <b>0</b> 表示不限年齡。<p style="margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem">年齡依個人資料中的生日計算。</p>',
    },
    teamOnly: {
      title: '俱樂部限定',
      body: '開啟後，只有指定俱樂部的成員可以報名。可選擇一個或多個俱樂部。<p style="margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem">非成員會看到「球隊限定」無法報名。</p>',
    },
    delegate: {
      title: '委託人',
      body: '指定最多 3 位管理員協助管理此活動，包括出席確認、編輯活動與簽到掃碼。<p style="margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem">被委託人會收到通知，並可在「我的活動」中看到此活動。</p>',
    },
    notes: {
      title: '注意事項',
      body: '填寫活動備註，例如場地規則、攜帶物品、付款方式等。上限 500 字，會顯示在活動詳情頁。',
    },
    sport: {
      title: '運動 / 場景標籤',
      body: '選擇活動的運動類別，用於分類與篩選。<p style="margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem">目前支援足球，未來將開放更多運動項目。</p>',
    },
    gender: {
      title: '性別限定',
      body: '開啟後，僅限所選性別可報名。不符合的用戶會看到限制提示。<p style="margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem">依個人資料中的性別欄位判斷；性別空白的用戶也無法報名。</p>',
    },
    'private': {
      title: '私密活動',
      body: '開啟後活動<b>不會</b>出現在公開列表中，只有透過分享連結才能查看。<p style="margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem">適合內部活動或邀請制活動。</p>',
    },
    teamSplit: {
      title: '分隊功能（色衣分組）',
      body: '開啟後系統會在報名流程中加入<b>隊伍分配機制</b>，讓參加者到場前就知道自己穿什麼顏色背心。'
        + '<p style="margin:.5rem 0 .2rem;font-weight:600">三種模式</p>'
        + '<b>隨機分配</b> — 報名時系統自動平衡分配，適合彼此不認識的揪團。<br>'
        + '<b>自選隊伍</b> — 報名時用戶自己挑隊，適合朋友約好要同隊。<br>'
        + '<b>主辦分配</b> — 報名時不分隊，由主辦在報名名單手動安排。'
        + '<p style="margin:.5rem 0 .2rem;font-weight:600">隊伍數量</p>'
        + '支援 2～4 隊，預設 2 隊（紅 vs 藍）。每隊以字母 A/B/C/D 加顏色識別，色盲用戶可透過字母辨別。'
        + '<div style="margin:.6rem 0 .3rem;padding:.55rem .7rem;border:1.5px solid var(--accent);border-radius:8px">'
        + '<div style="font-size:.8rem;font-weight:700;color:var(--accent);margin-bottom:.3rem">✅ 均分上限</div>'
        + '<div style="font-size:.75rem;margin-bottom:.35rem">勾選後系統自動計算每隊人數上限，避免隊伍人數嚴重失衡。</div>'
        + '<div style="font-size:.75rem;font-weight:600;margin-bottom:.15rem">計算方式</div>'
        + '<div style="font-size:.75rem;color:var(--text-secondary);margin-bottom:.3rem">每隊上限 = 活動人數上限 ÷ 隊伍數（<b>無條件進位</b>）</div>'
        + '<div style="font-size:.75rem;font-weight:600;margin-bottom:.15rem">範例</div>'
        + '<div style="font-size:.75rem;color:var(--text-secondary);margin-bottom:.25rem">'
        + '• 20 人活動 ÷ 2 隊 → 每隊上限 <b>10 人</b><br>'
        + '• 20 人活動 ÷ 3 隊 → 每隊上限 <b>7 人</b><br>'
        + '<span style="padding-left:1rem;font-size:.7rem">（20÷3=6.67 進位）</span><br>'
        + '• 15 人活動 ÷ 4 隊 → 每隊上限 <b>4 人</b><br>'
        + '<span style="padding-left:1rem;font-size:.7rem">（15÷4=3.75 進位）</span></div>'
        + '<div style="font-size:.72rem;color:var(--text-muted)">自選模式：滿隊後無法再選該隊<br>隨機模式：系統自動平衡分配</div>'
        + '</div>'
        + '<p style="margin:.5rem 0 .2rem;font-weight:600">鎖定時間（僅自選模式）</p>'
        + '活動開始前 N 小時鎖定，用戶不能再更改隊伍。主辦隨時可調。'
        + '<p style="margin:.5rem 0 .2rem;font-weight:600">同行者</p>'
        + '同行者預設跟主報名人同隊，不需額外操作。'
        + '<p style="margin:.5rem 0 .2rem;font-weight:600">管理操作</p>'
        + '主辦/委託人可在活動詳情頁使用三個批次按鈕：<br>'
        + '• <b>隨機</b> — 全部重新洗牌分隊<br>'
        + '• <b>補齊</b> — 只分配還沒有隊的人<br>'
        + '• <b>重置</b> — 清除所有隊伍分配'
        + '<p style="margin:.4rem 0 0;color:var(--text-muted);font-size:.8rem">不管選哪種模式，主辦隨時可在報名名單點擊色衣圖示手動調整。未開啟分隊的活動一切與現在完全相同。</p>',
    },
    saveTemplate: {
      title: '儲存為範本',
      body: '將目前填寫的活動設定儲存為範本，下次建立類似活動可直接載入。<p style="margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem">範本儲存在雲端，跨裝置可用，上限 30 個。</p>',
    },
  },

  _showCeInfo(type) {
    const item = this._ceInfoData[type];
    if (!item) return;
    const overlay = document.createElement('div');
    overlay.className = 'edu-info-overlay';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    overlay.innerHTML = '<div class="edu-info-dialog">'
      + '<div class="edu-info-dialog-title">' + item.title + '</div>'
      + '<div class="edu-info-dialog-body">' + item.body + '</div>'
      + '<button class="primary-btn" style="width:100%;margin-top:.8rem;flex-shrink:0" onclick="this.closest(\'.edu-info-overlay\').remove()">了解</button>'
      + '</div>';
    document.body.appendChild(overlay);
  },

});
