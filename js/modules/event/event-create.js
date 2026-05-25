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
  _eventImageVariantsData: null,
  _defaultEventCoverAssetPath: 'LOGO/Nocoverimage set.png',
  _defaultEventCoverDataUrl: null,
  _defaultEventCoverPromise: null,

  _setCreateEventSubmitIdleLabel(label) {
    const submitBtn = document.getElementById('ce-submit-btn');
    if (!submitBtn) return;
    submitBtn.dataset.idleLabel = label;
    submitBtn.textContent = label;
    submitBtn.disabled = false;
    submitBtn.style.opacity = '';
    submitBtn.style.cursor = '';
  },

  _setCreateEventModalMode(isEdit) {
    const titleEl = document.getElementById('ce-modal-title');
    if (!titleEl) return;
    const titleKey = isEdit ? '編輯活動' : '新增活動';
    titleEl.dataset.i18n = titleKey;
    if (typeof t === 'function') {
      const translated = t(titleKey);
      titleEl.textContent = translated === titleKey ? titleKey : translated;
    } else {
      titleEl.textContent = titleKey;
    }
  },

  _ensureCreateEventDomContract() {
    const contract = this._getCreateEventDomContract?.();
    if (!contract || contract.ok) return true;
    console.error('[EventCreate] missing required DOM ids:', contract.missing);
    this.showToast?.('活動表單載入不完整，請重新整理後再試');
    return false;
  },

  _applyCreateEventUiVariant() {
    const modal = document.getElementById('create-event-modal');
    if (!modal) return;
    modal.classList.toggle('ce-v2-enabled', this._isActivityCreateUiV2Enabled?.() !== false);
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
      submitBtn.textContent = this._editEventId ? '儲存中' : '建立中...';
      return;
    }
    submitBtn.disabled = false;
    submitBtn.style.opacity = '';
    submitBtn.style.cursor = '';
    submitBtn.textContent = idleLabel;
  },

  _getDefaultEventCoverUrl() {
    const version = (typeof CACHE_VERSION !== 'undefined' && CACHE_VERSION) ? CACHE_VERSION : '';
    try {
      const baseUrl = (typeof document !== 'undefined' && document.baseURI)
        || (typeof window !== 'undefined' && window.location?.href)
        || '';
      const url = new URL(this._defaultEventCoverAssetPath, baseUrl);
      if (version) url.searchParams.set('v', version);
      return url.toString();
    } catch (_) {
      const suffix = version ? `?v=${encodeURIComponent(version)}` : '';
      return `${encodeURI(this._defaultEventCoverAssetPath)}${suffix}`;
    }
  },

  async _getDefaultEventCoverDataUrl() {
    if (this._defaultEventCoverDataUrl) return this._defaultEventCoverDataUrl;
    if (!this._defaultEventCoverPromise) {
      this._defaultEventCoverPromise = (async () => {
        if (typeof fetch !== 'function') throw new Error('DEFAULT_EVENT_COVER_FETCH_UNAVAILABLE');
        if (typeof this._compressImage !== 'function') throw new Error('DEFAULT_EVENT_COVER_COMPRESS_UNAVAILABLE');
        const response = await fetch(this._getDefaultEventCoverUrl(), { cache: 'force-cache' });
        if (!response || !response.ok) {
          throw new Error(`DEFAULT_EVENT_COVER_NOT_FOUND:${response?.status || 'unknown'}`);
        }
        const blob = await response.blob();
        const dataUrl = await this._compressImage(blob, 1200, 0.9, 'image/webp');
        this._defaultEventCoverDataUrl = dataUrl;
        return dataUrl;
      })();
    }
    try {
      return await this._defaultEventCoverPromise;
    } catch (err) {
      this._defaultEventCoverPromise = null;
      throw err;
    }
  },

  async _resolveEventCoverImage(image) {
    const currentImage = typeof image === 'string' ? image.trim() : image;
    if (currentImage) return currentImage;
    try {
      return await this._getDefaultEventCoverDataUrl();
    } catch (err) {
      console.error('[EventCreate] default cover failed:', err);
      this.showToast('預設活動封面載入失敗，請重新整理後再試');
      throw err;
    }
  },

  _getFirestoreWriteErrorMessageForUser(err, context = {}) {
    if (context?.label === 'createEvent') {
      return this._getCreateEventWriteErrorMessage(err, context.payload);
    }
    return '';
  },

  _getCreateEventWriteErrorMessage(err, eventData = {}) {
    const code = String(err?.code || '').toLowerCase();
    const raw = String(err?.message || err || '').toLowerCase();
    const isAuthUidMismatch = code === 'auth/uid-mismatch'
      || raw.includes('auth_uid_mismatch')
      || raw.includes('uid mismatch');
    const isPermissionDenied = code === 'permission-denied'
      || raw.includes('permission-denied')
      || raw.includes('missing or insufficient permissions')
      || raw.includes('insufficient permissions');
    if (isAuthUidMismatch) {
      return '\u767b\u5165\u72c0\u614b\u4e0d\u540c\u6b65\uff0c\u8acb\u91cd\u65b0\u767b\u5165\u5f8c\u518d\u5efa\u7acb\u6d3b\u52d5\u3002';
    }
    if (raw.includes('auth_not_ready')) {
      return '\u767b\u5165\u72c0\u614b\u5c1a\u672a\u5b8c\u6210\uff0c\u8acb\u7a0d\u5f8c\u518d\u8a66\uff0c\u6216\u91cd\u65b0\u767b\u5165\u5f8c\u5efa\u7acb\u6d3b\u52d5\u3002';
    }
    if (code === 'unauthenticated' || raw.includes('unauthenticated')) {
      return '登入狀態已過期，請重新登入後再試';
    }
    if (isPermissionDenied) {
      if (eventData?.teamOnly || eventData?.isPublic || eventData?.creatorTeamId || (Array.isArray(eventData?.creatorTeamIds) && eventData.creatorTeamIds.length > 0)) {
        return '俱樂部限定活動需要俱樂部開團權限，請關閉「俱樂部限定」或聯繫管理員';
      }
      const addonLabels = this._getCreateEventAddonLabels?.(eventData) || [];
      if (addonLabels.length > 0) {
        return `你目前沒有使用「${addonLabels.join('、')}」的權限，請關閉相關進階功能後再試`;
      }
      return '權限不足，請重新登入或聯繫管理員確認開團權限';
    }
    if (code === 'deadline-exceeded' || code === 'unavailable' || raw.includes('network') || raw.includes('timeout') || raw.includes('deadline')) {
      return '連線逾時，請檢查網路後再試';
    }
    if (code === 'invalid-argument' || code === 'failed-precondition' || raw.includes('missingrequiredfields') || raw.includes('missing required')) {
      return '活動資料不完整，請檢查必填欄位後再試';
    }
    if (code === 'aborted') {
      return '建立活動時資料同步衝突，請重新整理後再試';
    }
    return '';
  },

  _getCreateEventAddonLabels(eventData = {}) {
    const labels = [];
    if (eventData?.feeEnabled || Number(eventData?.fee || 0) > 0) labels.push('費用');
    if (eventData?.teamOnly || eventData?.isPublic || eventData?.creatorTeamId || (Array.isArray(eventData?.creatorTeamIds) && eventData.creatorTeamIds.length > 0)) labels.push('俱樂部限定');
    if (eventData?.genderRestrictionEnabled || eventData?.allowedGender) labels.push('性別限制');
    if (eventData?.privateEvent) labels.push('私密活動');
    if (eventData?.teamSplit) labels.push('分隊功能');
    if (eventData?.socialLinksEnabled || (Array.isArray(eventData?.socialLinks) && eventData.socialLinks.length > 0)) labels.push('社群連結');
    if (eventData?.earlyBirdEnabled) labels.push('早鳥報名');
    if (eventData?.gpsEnabled || eventData?.mapLocationConfirmed) labels.push('GPS定位');
    return labels;
  },

  _EVENT_CHANGE_NOTIFY_FIELDS: [
    'title',
    'type',
    'location',
    'date',
    'fee',
    'feeEnabled',
    'max',
    'minAge',
    'notes',
    'sportTag',
    'regOpenTime',
    'teamOnly',
    'genderRestrictionEnabled',
    'allowedGender',
    'privateEvent',
    'creatorTeamId',
    'creatorTeamName',
    'creatorTeamIds',
    'creatorTeamNames',
    'delegateUids',
    'socialLinksEnabled',
    'socialLinks',
    'earlyBirdEnabled',
    'earlyBirdCost',
    'earlyBirdPolicyVersion',
    'gpsEnabled',
    'lat',
    'lng',
    'mapAddress',
    'mapPlaceId',
    'mapProvider',
    'mapLocationConfirmed',
    'mapLocationUpdatedAt',
  ],

  _normalizeEventChangeNotifyValue(value) {
    if (value == null) return '';
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : '';
    if (typeof value?.toDate === 'function') {
      const date = value.toDate();
      return Number.isFinite(date?.getTime?.()) ? date.toISOString() : '';
    }
    if (Array.isArray(value)) return value.map(item => this._normalizeEventChangeNotifyValue(item));
    if (typeof value === 'object') {
      return Object.keys(value).sort().reduce((acc, key) => {
        acc[key] = this._normalizeEventChangeNotifyValue(value[key]);
        return acc;
      }, {});
    }
    if (typeof value === 'number') return Number.isFinite(value) ? value : '';
    if (typeof value === 'boolean') return value;
    return String(value || '').trim();
  },

  _getEventChangeNotifySnapshot(eventData) {
    const source = eventData || {};
    return this._EVENT_CHANGE_NOTIFY_FIELDS.reduce((acc, key) => {
      acc[key] = this._normalizeEventChangeNotifyValue(source[key]);
      return acc;
    }, {});
  },

  _hasEventChangeNotificationDiff(existingEvent, updates) {
    if (!existingEvent) return true;
    const before = this._getEventChangeNotifySnapshot(existingEvent);
    const after = this._getEventChangeNotifySnapshot({ ...existingEvent, ...(updates || {}) });
    return JSON.stringify(before) !== JSON.stringify(after);
  },

  _hashEventChangeNotifyString(text) {
    let hash = 0;
    const input = String(text || '');
    for (let i = 0; i < input.length; i += 1) {
      hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(36);
  },

  _getEventChangeNotificationDedupeKey(eventId, targetUid, eventData) {
    const snapshot = this._getEventChangeNotifySnapshot(eventData);
    const hash = this._hashEventChangeNotifyString(JSON.stringify(snapshot));
    return `event_changed:${String(eventId || '').trim()}:${String(targetUid || '').trim()}:${hash}`;
  },

  _formatCreateTimeValue(value) {
    const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);
    if (!match) return '';
    const hour = Math.max(0, Math.min(23, parseInt(match[1], 10) || 0));
    const minute = Math.max(0, Math.min(59, parseInt(match[2], 10) || 0));
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  },

  _formatCreateDateValue(value) {
    const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return '';
    return `${match[1]}/${match[2]}/${match[3]}`;
  },

  _updateCreateTimeSummary() {
    const dateValue = document.getElementById('ce-date')?.value || '';
    const startValue = this._formatCreateTimeValue(document.getElementById('ce-time-start')?.value);
    const endValue = this._formatCreateTimeValue(document.getElementById('ce-time-end')?.value);
    const dateLabel = this._formatCreateDateValue(dateValue);
    const timeSummary = document.getElementById('ce-time-summary');
    if (timeSummary) {
      const datePrefix = dateLabel ? `${dateLabel} ` : '';
      timeSummary.textContent = startValue && endValue
        ? `已選時間：${datePrefix}${startValue} ～ ${endValue}`
        : '已選時間：請選擇開始與結束時間（24 小時制）';
    }

    const regSummary = document.getElementById('ce-reg-open-summary');
    if (regSummary) {
      const regOpenEnabled = this._isEventRegOpenEnabled?.() === true;
      const isMultiDate = typeof this._isMultiDateMode === 'function' && this._isMultiDateMode();
      if (!regOpenEnabled) {
        regSummary.textContent = '報名開放：建立後立即開放報名';
      } else if (isMultiDate) {
        const rel = this._getRelativeRegOpen?.() || { days: 0, hours: 0 };
        const days = Number(rel.days || 0);
        const hours = Number(rel.hours || 0);
        if (days || hours) {
          const parts = [];
          if (days) parts.push(`${days} 日`);
          if (hours) parts.push(`${hours} 小時`);
          regSummary.textContent = `報名開放：每場活動開始前 ${parts.join(' ')} 開放`;
        } else {
          regSummary.textContent = '報名開放：未指定提前時間，建立後立即開放報名';
        }
      } else {
        const regDateValue = document.getElementById('ce-reg-open-date')?.value || '';
        const regTimeValue = this._formatCreateTimeValue(document.getElementById('ce-reg-open-clock')?.value);
        const regDateLabel = this._formatCreateDateValue(regDateValue);
        if (regDateLabel && regTimeValue) {
          regSummary.textContent = `報名開放：${regDateLabel} ${regTimeValue} 後可報名`;
        } else {
          regSummary.textContent = '報名開放：請選擇完整的開放日期與時間';
        }
      }
    }
  },

  _bindCreateTimeSummary() {
    ['ce-date', 'ce-time-start', 'ce-time-end', 'ce-reg-open-date', 'ce-reg-open-clock', 'ce-reg-rel-days', 'ce-reg-rel-hours'].forEach(id => {
      const el = document.getElementById(id);
      if (!el || el.dataset.timeSummaryBound === '1') return;
      el.dataset.timeSummaryBound = '1';
      el.addEventListener('input', () => this._updateCreateTimeSummary());
      el.addEventListener('change', () => this._updateCreateTimeSummary());
    });
    const regOpenToggle = document.getElementById('ce-reg-open-enabled');
    if (regOpenToggle && regOpenToggle.dataset.timeSummaryBound !== '1') {
      regOpenToggle.dataset.timeSummaryBound = '1';
      regOpenToggle.addEventListener('change', () => this._handleEventRegOpenToggle?.());
    }
    this._syncEventRegOpenTimeUI?.({ clear: false });
    this._updateCreateTimeSummary();
  },

  async openCreateEventModal() {
    // v8 M1：開 sheet 前先擋未登入（避免用戶填表單後才被踢）
    if (this._requireProtectedActionLogin?.({ type: 'createEvent' }, { suppressToast: true })) return;
    await this._ensureActivityRoleCapabilitiesReady?.({ force: true });
    if (!this._canCreateActivityByPermission?.()) {
      this.showToast('權限不足：需要建立活動權限');
      return;
    }
    if (this._requireActivityCreateProfileComplete?.()) return;
    // 彈底部 Action Sheet：選擇建立自訂活動或活動連結
    this._showCreateEventTypeSheet();
  },

  _showCreateEventTypeSheet() {
    const existing = document.getElementById('create-event-type-sheet');
    if (existing) existing.remove();
    const canCustom = !!this._canCreateBasicActivity?.();
    const canExternal = !!this._canCreateExternalActivity?.();
    if (!canCustom && !canExternal) {
      this.showToast('權限不足：需要建立活動權限');
      return;
    }

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
      <button id="cets-external" aria-disabled="true" data-feature-locked="true" style="width:100%;padding:.7rem;margin-bottom:.6rem;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg-elevated);color:var(--text-muted);font-size:.85rem;font-weight:600;cursor:not-allowed;text-align:left;display:flex;align-items:center;gap:.6rem;opacity:.62;filter:grayscale(1)">
        <span style="font-size:1.3rem">🔗</span>
        <span><div>活動連結</div><div style="font-size:.72rem;font-weight:400;color:var(--text-muted);margin-top:.15rem">連結外部平台活動，點擊直接跳轉</div></span>
      </button>
      <button id="cets-cancel" style="width:100%;padding:.55rem;border:none;border-radius:var(--radius);background:transparent;color:var(--text-muted);font-size:.82rem;cursor:pointer">取消</button>
    `;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    const customBtn = sheet.querySelector('#cets-custom');
    const externalBtn = sheet.querySelector('#cets-external');
    if (customBtn) customBtn.style.display = canCustom ? 'flex' : 'none';
    if (externalBtn) externalBtn.style.display = 'flex';

    customBtn?.addEventListener('click', () => {
      overlay.remove();
      this._openCreateCustomEventModal();
    });
    externalBtn?.addEventListener('click', () => {
      this.showToast('功能尚未開放');
    });
    sheet.querySelector('#cets-cancel').addEventListener('click', () => overlay.remove());
  },

  _openCreateCustomEventModal() {
    if (!this._canCreateBasicActivity?.()) {
      this.showToast('權限不足：需要建立活動權限');
      return;
    }
    if (!this._ensureCreateEventDomContract()) return;
    this._editEventId = null;
    this._eventImageVariantsData = null;
    this._delegates = [];
    this._setCreateEventModalMode(false);
    // 重置表單欄位，防止編輯後殘留資料
    document.getElementById('ce-title').value = '';
    document.getElementById('ce-type').value = 'play';
    document.getElementById('ce-location').value = '';
    this._resetEventLocationDraft?.('ce', null);
    this._bindEventLocationInputs?.('ce');
    document.getElementById('ce-date').value = '';
    document.getElementById('ce-time-start').value = '14:00';
    document.getElementById('ce-time-end').value = '16:00';
    this._setEventFeeFormState(false, 0);
    document.getElementById('ce-max').value = '20';
    document.getElementById('ce-waitlist').value = '0';
    if (typeof this._setEventAgeLimitState === 'function') this._setEventAgeLimitState(false, 0);
    else document.getElementById('ce-min-age').value = '0';
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
    this._setEventSocialLinksFormData?.(false, []);
    this._setEventEarlyBirdFormData?.(false, 10);
    this._setEventGpsFormData?.(false);
    this._regionSetFormData?.(true, '中部', typeof REGION_MAP !== 'undefined' && REGION_MAP['中部'] ? [...REGION_MAP['中部']] : []);
    const cePreview = document.getElementById('ce-upload-preview');
    if (cePreview) {
      cePreview.classList.remove('has-image');
      cePreview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 800 × 300 px｜JPG / PNG｜最大 2MB</span>';
    }
    this._eventSubmitInFlight = false;
    this._setCreateEventSubmitIdleLabel('建立活動');
    // 確保事件已綁定（防止 Phase 1 非同步時機導致未綁定）
    this.bindEventImageVariantUpload?.('ce-image', 'ce-upload-preview');
    this.bindTeamOnlyToggle();
    this.bindEventFeeToggle();
    this.bindEventAgeLimitToggle?.();
    this.bindGenderRestrictionToggle();
    this.bindPrivateEventToggle();
    this.bindTeamSplitToggle?.();
    this.bindEventSocialLinksToggle?.();
    this.bindEventEarlyBirdToggle?.();
    this.bindEventGpsToggle?.();
    this.bindReservedActivityAddonToggles?.();
    this.bindRegionToggle?.();
    this._bindCreateTimeSummary();
    this._resetMultiDates();
    this._initMultiDatePicker();
    this._initSportTagPicker('');
    this._applyCreateEventUiVariant();
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
      this.showToast('系統已在處理中');
      return;
    }
    const isEditSubmit = !!this._editEventId;
    let earlyEditSubmitBusy = false;
    const startEarlyEditSubmitBusy = () => {
      if (!isEditSubmit || earlyEditSubmitBusy) return;
      earlyEditSubmitBusy = true;
      this._eventSubmitInFlight = true;
      this._setCreateEventSubmitting?.(true);
    };
    const stopEarlyEditSubmitBusy = () => {
      if (!earlyEditSubmitBusy) return;
      earlyEditSubmitBusy = false;
      this._eventSubmitInFlight = false;
      this._setCreateEventSubmitting?.(false);
    };
    startEarlyEditSubmitBusy();
    try {
    await this._ensureActivityRoleCapabilitiesReady?.({ force: true });
    const eventBeingEdited = this._editEventId ? ApiService.getEvent(this._editEventId) : null;
    const canSubmitActivity = this._editEventId
      ? this._canEditOwnActivityBasic?.(eventBeingEdited)
      : this._canCreateBasicActivity?.();
    if (!canSubmitActivity) {
      this.showToast('權限不足：需要建立活動權限'); return;
    }
    // 2026-04-19 UX：寫入類動作必須先補齊個人資料（主辦人資料會寫入活動文件）
    if (this._requireProfileComplete()) return;
    const title = document.getElementById('ce-title').value.trim();
    const type = document.getElementById('ce-type').value;
    const location = document.getElementById('ce-location').value.trim();
    const dateVal = document.getElementById('ce-date').value
      || (this._multiDates && this._multiDates.length ? this._multiDates[0] : '');
    const tStart = this._formatCreateTimeValue(document.getElementById('ce-time-start').value);
    const tEnd = this._formatCreateTimeValue(document.getElementById('ce-time-end').value);
    const timeVal = (tStart && tEnd) ? `${tStart}~${tEnd}` : '';
    let feeEnabled = !!document.getElementById('ce-fee-enabled')?.checked;
    let fee = feeEnabled ? (parseInt(document.getElementById('ce-fee').value, 10) || 0) : 0;
    const max = parseInt(document.getElementById('ce-max').value) || 20;
    const minAge = typeof this._getEventMinAgeFormValue === 'function'
      ? this._getEventMinAgeFormValue()
      : (parseInt(document.getElementById('ce-min-age').value, 10) || 0);
    const notes = document.getElementById('ce-notes').value.trim();
    const sportTag = getSportKeySafe(document.getElementById('ce-sport-tag')?.value || this._selectedSportTag || '');
    const regOpenTime = this._getEventRegOpenTimeValue();
    let teamOnly = !!document.getElementById('ce-team-only')?.checked;
    let genderRestrictionEnabled = !!document.getElementById('ce-gender-restriction-enabled')?.checked;
    let allowedGender = genderRestrictionEnabled ? this._getAllowedGenderValue() : '';
    let privateEvent = !!document.getElementById('ce-private-event')?.checked;
    let teamSplitData = this._tsGetFormData?.() || null;
    let socialLinksData = this._getEventSocialLinksFormData?.({ validate: true }) || { enabled: false, links: [] };
    if (socialLinksData.error) { this.showToast(socialLinksData.error); return; }
    let socialLinksEnabled = !!socialLinksData.enabled;
    let socialLinks = Array.isArray(socialLinksData.links) ? socialLinksData.links : [];
    let earlyBirdData = this._getEventEarlyBirdFormData?.({ validate: true }) || { enabled: false, cost: 0 };
    if (earlyBirdData.error) { this.showToast(earlyBirdData.error); return; }
    let earlyBirdEnabled = !!earlyBirdData.enabled;
    let earlyBirdCost = earlyBirdEnabled ? Number(earlyBirdData.cost || 0) : 0;
    let gpsData = this._getEventGpsFormData?.() || { enabled: false };
    let gpsEnabled = !!gpsData.enabled;
    const regionData = this._regionGetFormData?.() || { regionEnabled: true, region: '', cities: [] };
    const canUseAddons = !!this._canUseActivityAddons?.(eventBeingEdited || null);
    if (!canUseAddons && (feeEnabled || teamOnly || genderRestrictionEnabled || privateEvent || teamSplitData || socialLinksEnabled || earlyBirdEnabled || gpsEnabled)) {
      this._showActivityAddonUpsellToast?.();
      feeEnabled = false;
      fee = 0;
      teamOnly = false;
      genderRestrictionEnabled = false;
      allowedGender = '';
      privateEvent = false;
      teamSplitData = null;
      socialLinksEnabled = false;
      socialLinks = [];
      earlyBirdEnabled = false;
      earlyBirdCost = 0;
      gpsEnabled = false;
    }

    if (!title) { this.showToast('請輸入活動名稱'); return; }
    if (title.length > 16) { this.showToast('活動名稱不可超過 16 字'); return; }
    if (!location) { this.showToast('請輸入地點'); return; }
    if (!dateVal) { this.showToast('請選擇活動日期'); return; }
    if (!tStart || !tEnd) { this.showToast('請選擇開始與結束時間'); return; }
    if (regOpenTime === null) { this.showToast('請完整選擇開放報名日期與時間'); return; }
    if (earlyBirdEnabled) {
      if (this._isMultiDateMode?.()) {
        const rel = this._getRelativeRegOpen?.() || { days: 0, hours: 0 };
        if (!Number(rel.days || 0) && !Number(rel.hours || 0)) {
          this.showToast('早鳥報名需先設定活動開始前的開放報名時間');
          return;
        }
      } else if (!regOpenTime || new Date(regOpenTime) <= new Date()) {
        this.showToast('早鳥報名需搭配未來的開放報名時間');
        return;
      }
    }
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
    const locationPayload = this._buildEventLocationPayload?.('ce', location, { gpsEnabled }) || {};
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
    let image = ceImg ? ceImg.src : null;
    const imageVariants = (this._eventImageVariantsData && typeof this._eventImageVariantsData === 'object')
      ? { ...this._eventImageVariantsData }
      : null;
    if (imageVariants && (imageVariants.cover || imageVariants.homeNext)) {
      image = imageVariants.cover || image || imageVariants.homeNext;
    }

    const fullDate = `${dateVal.replace(/-/g, '/')} ${timeVal}`;
    const startTimestamp = new Date(`${dateVal}T${tStart}`);
    const endTimestamp = new Date(`${dateVal}T${tEnd}`);

    if (this._editEventId) {
      // Trigger 6：活動變更通知 — 先取得現有報名者
      const existingEvent = ApiService.getEvent(this._editEventId);
      if (!this._hasActivityManageEntry?.() && !this._canManageAllActivities?.() && max < (Number(existingEvent?.current || 0) || 0)) {
        this.showToast('\u540d\u984d\u4e0d\u53ef\u5c0f\u65bc\u5df2\u6b63\u53d6\u4eba\u6578');
        return;
      }
      const notifyUids = this._collectEventNotifyRecipientUids
        ? this._collectEventNotifyRecipientUids(existingEvent, this._editEventId)
        : (() => {
          const set = new Set((ApiService.getRegistrationsByEvent(this._editEventId) || []).map(r => r.userId).filter(Boolean));
          if (set.size || !existingEvent) return set;
          // Phase 3 (2026-04-19): 優先從 participantsWithUid / waitlistWithUid 取真 UID（無歧義）
          const wuP = Array.isArray(existingEvent.participantsWithUid) ? existingEvent.participantsWithUid : [];
          const wuW = Array.isArray(existingEvent.waitlistWithUid) ? existingEvent.waitlistWithUid : [];
          if (wuP.length > 0 || wuW.length > 0) {
            [...wuP, ...wuW].forEach(entry => {
              if (entry && entry.uid) set.add(entry.uid);
            });
            return set;
          }
          // Fallback：舊字串陣列 + name 反查（同暱稱會挑錯）
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
        title, type, location, date: fullDate, startTimestamp, endTimestamp, fee, feeEnabled, max, minAge, notes, image, sportTag,
        regOpenTime: regOpenTime || null,
        gradient: GRADIENT_MAP[type] || GRADIENT_MAP.friendly,
        teamOnly,
        genderRestrictionEnabled,
        allowedGender,
        privateEvent,
        socialLinksEnabled,
        socialLinks,
        earlyBirdEnabled,
        earlyBirdCost,
        earlyBirdPolicyVersion: earlyBirdEnabled ? 1 : null,
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
      Object.assign(updates, locationPayload);
      if (imageVariants) updates.imageVariants = imageVariants;
      if (!canUseAddons) {
        [
          'fee', 'feeEnabled', 'teamOnly', 'genderRestrictionEnabled', 'allowedGender',
          'privateEvent', 'creatorTeamId', 'creatorTeamName', 'creatorTeamIds',
          'creatorTeamNames', 'teamSplit', 'socialLinksEnabled', 'socialLinks',
          'earlyBirdEnabled', 'earlyBirdCost', 'earlyBirdPolicyVersion',
          'gpsEnabled', 'lat', 'lng', 'mapAddress', 'mapPlaceId', 'mapProvider',
          'mapLocationConfirmed', 'mapLocationUpdatedAt',
        ].forEach(key => { delete updates[key]; });
      }
      if (!this._canManageEventDelegates?.(existingEvent)) {
        delete updates.delegates;
        delete updates.delegateUids;
      }
      if (teamSplitData) {
        updates.teamSplit = teamSplitData;
        this._recalcTeamSplitTimestamps?.(updates);
      }
      // 已結束/已取消的活動編輯時不改變狀態
      if (!this._hasActivityManageEntry?.() && !this._canManageAllActivities?.()) {
        // Owner-scope basic edit must not change lifecycle state.
      } else if (existingEvent && (existingEvent.status === 'ended' || existingEvent.status === 'cancelled')) {
        // 保持原狀態，不做任何改變
      } else if (regOpenTime && new Date(regOpenTime) > new Date()) {
        // 若有設定報名時間且尚未到達，更新狀態為 upcoming
        updates.status = 'upcoming';
      } else if (existingEvent && existingEvent.status === 'upcoming') {
        // 報名時間已到或未設定，確保不是 upcoming
        updates.status = this._isEventTrulyFull(existingEvent) ? 'full' : 'open';
      }
      const oldMax = existingEvent ? existingEvent.max : max;
      const shouldNotifyEventChange = this._hasEventChangeNotificationDiff(existingEvent, updates);
      const eventChangeNotifyData = { ...(existingEvent || {}), ...updates };
      this._eventSubmitInFlight = true;
      try {
        await ApiService.updateEventAwait(this._editEventId, updates);
        const updatedEvent = ApiService.getEvent(this._editEventId);
        if (updatedEvent) Object.assign(updatedEvent, updates);
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
      this._eventImageVariantsData = null;
      // 非關鍵操作：即使失敗也不影響用戶體驗
      try {
        if (this._hasActivityManageEntry?.() || this._canManageAllActivities?.()) {
          await this._adjustWaitlistOnCapacityChange(editedId, oldMax, max);
        }
        if (shouldNotifyEventChange) {
          notifyUids.forEach(uid => {
            this._sendNotifFromTemplate('event_changed', {
              eventName: title, date: fullDate, location,
            }, uid, 'activity', '活動', {
              dedupeKey: this._getEventChangeNotificationDedupeKey(editedId, uid, eventChangeNotifyData),
            });
          });
        }
        ApiService._writeOpLog('event_edit', '編輯活動', `編輯「${title}」`, editedId);
      } catch (postErr) {
        console.warn('[handleCreateEvent] post-edit error:', postErr);
      }
      // 重新渲染（獨立於上方 try-catch，確保即使記錄操作失敗也能刷新列表）
      try { this.renderActivityList(); } catch (_) {}
      try { this.renderHotEvents(); } catch (_) {}
      try { this.renderMyActivities(); } catch (_) {}
      try {
        if (this.currentPage === 'page-activity-detail'
          && this._currentDetailEventId === editedId
          && typeof this.showEventDetail === 'function') {
          await this.showEventDetail(editedId);
        }
      } catch (detailRefreshErr) {
        console.warn('[handleCreateEvent] post-edit detail refresh failed:', detailRefreshErr);
      }
      try { await this._refreshTeamDetailAfterEventSave?.(teamOnly ? resolvedTeamIds : []); } catch (_) {}
    } else {
      const creatorName = this._getEventCreatorName();
      const creatorUid = this._getEventCreatorUid();
      const initStatus = (regOpenTime && new Date(regOpenTime) > new Date()) ? 'upcoming' : 'open';
      this._eventSubmitInFlight = true;
      this._setCreateEventSubmitting(true);
      let resolvedImage;
      try {
        resolvedImage = await this._resolveEventCoverImage(image);
      } catch (_) {
        this._eventSubmitInFlight = false;
        this._setCreateEventSubmitting(false);
        return;
      }
      const newEvent = {
        id: generateId('ce_'),
        title, type, status: initStatus, location, date: fullDate, startTimestamp, endTimestamp,
        fee, feeEnabled, max, current: 0, waitlist: 0, minAge, notes, image: resolvedImage, sportTag,
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
        socialLinksEnabled,
        socialLinks,
        earlyBirdEnabled,
        earlyBirdCost,
        earlyBirdPolicyVersion: earlyBirdEnabled ? 1 : null,
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
      Object.assign(newEvent, locationPayload);
      if (imageVariants) newEvent.imageVariants = imageVariants;
      if (!this._canManageEventDelegates?.(null)) {
        newEvent.delegates = [];
        newEvent.delegateUids = [];
      }
      if (teamSplitData) {
        newEvent.teamSplit = teamSplitData;
        this._recalcTeamSplitTimestamps?.(newEvent);
      }
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
          if (!err?._toasted) {
            const msg = this._getCreateEventWriteErrorMessage?.(err, allEvents?.[0])
              || '部分活動建立失敗，請檢查活動列表';
            this.showToast(msg);
          }
          this._eventSubmitInFlight = false;
          this._setCreateEventSubmitting(false);
          return;
        }
      } else {
        try {
          await ApiService.createEvent(newEvent);
        } catch (err) {
          console.error('[handleCreateEvent:createEvent]', err);
          ApiService._writeErrorLog?.({
            fn: 'handleCreateEvent',
            stage: 'createEvent',
            eventId: newEvent.id || '',
            title: newEvent.title || '',
            authUid: (typeof auth !== 'undefined' && auth?.currentUser?.uid) ? auth.currentUser.uid : '',
            currentUserUid: ApiService.getCurrentUser?.()?.uid || '',
            currentUserRole: ApiService.getCurrentUser?.()?.role || this.currentRole || '',
            canUseAddons,
            addonLabels: this._getCreateEventAddonLabels?.(newEvent) || [],
          }, err);
          if (!err?._toasted) {
            this.showToast(this._getCreateEventWriteErrorMessage?.(err, newEvent) || '建立活動失敗，請稍後再試');
          }
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
      try { await this._refreshTeamDetailAfterEventSave?.(teamOnly ? resolvedTeamIds : []); } catch (_) {}
      // 活動建立成功後提示分享到 LINE
      if (newEvent.id && typeof this._promptShareAfterCreate === 'function') {
        const _eid = newEvent.id;
        setTimeout(() => this._promptShareAfterCreate(_eid).catch(err => console.warn('[Share] prompt failed:', err)), 500);
      }
    }

    // 重置表單
    this._editEventId = null;
    this._eventImageVariantsData = null;
    document.getElementById('ce-title').value = '';
    document.getElementById('ce-location').value = '';
    this._clearEventLocationDraft?.('ce');
    this._setEventFeeFormState(false, 0);
    document.getElementById('ce-max').value = '20';
    document.getElementById('ce-waitlist').value = '0';
    if (typeof this._setEventAgeLimitState === 'function') this._setEventAgeLimitState(false, 0);
    else document.getElementById('ce-min-age').value = '0';
    document.getElementById('ce-notes').value = '';
    document.getElementById('ce-sport-tag').value = '';
    this._setEventRegOpenTimeValue('');
    document.getElementById('ce-image').value = '';
    document.getElementById('ce-date').value = '';
    document.getElementById('ce-time-start').value = '14:00';
    document.getElementById('ce-time-end').value = '16:00';
    this._updateCreateTimeSummary();
    this._delegates = [];
    this._renderDelegateTags();
    this._updateDelegateInput();
    const ceTeamOnly = document.getElementById('ce-team-only');
    const ceTeamSelect = document.getElementById('ce-team-select');
    if (ceTeamSelect) Array.from(ceTeamSelect.options || []).forEach(opt => { opt.selected = false; });
    if (ceTeamOnly) { ceTeamOnly.checked = false; this._updateTeamOnlyLabel(); }
    this._setGenderRestrictionState(false, '');
    this._setPrivateEventState(false);
    this._setEventSocialLinksFormData?.(false, []);
    this._setEventEarlyBirdFormData?.(false, 10);
    this._setEventGpsFormData?.(false);
    this._resetMultiDates();
    const cePreview = document.getElementById('ce-upload-preview');
    if (cePreview) {
      cePreview.classList.remove('has-image');
      cePreview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 800 × 300 px｜JPG / PNG｜最大 2MB</span>';
    }
    this._initSportTagPicker('');
    } finally {
      stopEarlyEditSubmitBusy();
    }
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
      body: '開關預設關閉，代表活動建立後立即開放報名。<p style="margin:.3rem 0 0"><b>開啟後</b>：需填寫完整的開放日期與時間，時間未到前顯示「即將開放」。</p><p style="margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem">多日期模式下可設「活動開始前 N 天 N 時」，系統會自動為每場計算各自的開放時間。若要讓用戶在正式開放前提前報名，請到「進階功能」開啟早鳥報名。</p>',
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
    socialLinks: {
      title: '社群連結',
      body: '開啟後可放最多 5 個社群或外部連結。系統會依網址自動判斷 LINE、Facebook、Instagram、YouTube 等常見平台，並在活動詳情頁顯示成圓形連結按鈕。<p style="margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem">適合放社團公告、主辦社群、活動相簿或其他補充資訊。</p>',
    },
    earlyBird: {
      title: '早鳥報名',
      body: '此開關位於「進階功能」。開啟後，活動在正式開放報名前會顯示早鳥報名按鈕。用戶確認後會扣除設定積分並報名正取；活動取消時系統退回積分，用戶自行取消則不退回。<p style="margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem">積分範圍 10～500 分。早鳥不支援同行者，避免一人扣一次卻帶多人提前卡位。</p>',
    },
    gps: {
      title: 'GPS功能',
      body: '開啟後才可使用「設定地圖座標」，讓活動儲存精準經緯度並出現在附近活動地圖。<p style="margin:.3rem 0 0;color:var(--text-muted);font-size:.8rem">關閉時，地圖座標按鈕會反灰；已設定的座標會在送出時清除，只保留一般地點文字。</p>',
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
