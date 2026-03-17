/* === SportHub — Event Create: External Event Workflow === */
/* innerHTML uses escapeHTML() for all user-supplied values  */

Object.assign(App, {

  _editExternalEventId: null,
  _externalEventSubmitInFlight: false,

  openCreateExternalEventModal(editId) {
    const isEdit = !!editId;
    this._editExternalEventId = editId || null;
    this._externalEventSubmitInFlight = false;

    // 重置表單
    const titleEl = document.getElementById('cee-title');
    const dateEl = document.getElementById('cee-date');
    const startEl = document.getElementById('cee-start-time');
    const endEl = document.getElementById('cee-end-time');
    const locEl = document.getElementById('cee-location');
    const urlEl = document.getElementById('cee-external-url');
    const sportEl = document.getElementById('cee-sport-tag');
    const imgEl = document.getElementById('cee-image');
    const previewEl = document.getElementById('cee-upload-preview');
    const submitBtn = document.getElementById('cee-submit-btn');
    const modalTitle = document.getElementById('cee-modal-title');

    if (titleEl) titleEl.value = '';
    if (dateEl) dateEl.value = '';
    if (startEl) startEl.value = '14:00';
    if (endEl) endEl.value = '16:00';
    if (locEl) locEl.value = '';
    if (urlEl) urlEl.value = '';
    if (sportEl) sportEl.value = '';
    if (imgEl) imgEl.value = '';
    if (previewEl) {
      previewEl.classList.remove('has-image');
      previewEl.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 800 × 300 px｜JPG / PNG｜最大 2MB</span>';
    }
    if (modalTitle) modalTitle.textContent = isEdit ? '編輯活動連結' : '新增活動連結';
    if (submitBtn) submitBtn.textContent = isEdit ? '儲存修改' : '建立活動連結';

    // 圖片上傳綁定（含裁切，活動封面比例 8:3）
    const ceeInput = document.getElementById('cee-image');
    if (ceeInput) delete ceeInput.dataset.bound;
    this.bindImageUpload('cee-image', 'cee-upload-preview', 8 / 3);

    // Sport picker 初始化（複用通用版但指定不同容器）
    this._initSportTagPickerForContainer('cee');

    // 編輯模式：填入現有值
    if (isEdit) {
      const e = ApiService.getEvent(editId);
      if (e) {
        if (titleEl) titleEl.value = e.title || '';
        if (locEl) locEl.value = e.location || '';
        if (urlEl) urlEl.value = e.externalUrl || '';
        // 解析日期時間
        const dateTime = (e.date || '').split(' ');
        const dateParts = (dateTime[0] || '').split('/');
        const timeStr = dateTime[1] || '';
        const timeParts = timeStr.split('~');
        if (dateParts.length === 3 && dateEl) {
          dateEl.value = `${dateParts[0]}-${dateParts[1].padStart(2,'0')}-${dateParts[2].padStart(2,'0')}`;
        }
        if (timeParts[0] && startEl) startEl.value = timeParts[0];
        if (timeParts[1] && endEl) endEl.value = timeParts[1];
        // sport tag
        this._initSportTagPickerForContainer('cee', e.sportTag || '');
        // 圖片
        if (e.image && previewEl) {
          previewEl.classList.add('has-image');
          previewEl.innerHTML = `<img src="${e.image}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius)">`;
        }
      }
    }

    this.showModal('create-external-event-modal');
    this._renderExternalTemplateSelector();
    void this._ensureExternalEventTemplatesReady();
  },

  async handleCreateExternalEvent() {
    if (this._externalEventSubmitInFlight) {
      this.showToast('活動建立中，請勿重複送出');
      return;
    }
    if (!this.hasPermission('activity.manage.entry')) {
      this.showToast('權限不足'); return;
    }

    const title = (document.getElementById('cee-title')?.value || '').trim();
    const dateVal = document.getElementById('cee-date')?.value || '';
    const tStart = document.getElementById('cee-start-time')?.value || '';
    const tEnd = document.getElementById('cee-end-time')?.value || '';
    const location = (document.getElementById('cee-location')?.value || '').trim();
    const externalUrl = (document.getElementById('cee-external-url')?.value || '').trim();
    const sportTag = getSportKeySafe(document.getElementById('cee-sport-tag')?.value || '');

    // 驗證必填欄位
    if (!title) { this.showToast('請輸入活動名稱'); return; }
    if (title.length > 16) { this.showToast('活動名稱不可超過 16 字'); return; }
    if (!dateVal) { this.showToast('請選擇活動日期'); return; }
    if (!tStart || !tEnd) { this.showToast('請選擇開始與結束時間'); return; }
    if (tEnd <= tStart) { this.showToast('結束時間必須晚於開始時間'); return; }
    if (!sportTag) { this.showToast('請先選擇運動 / 場景標籤（必選）'); return; }
    if (!externalUrl) { this.showToast('請輸入活動連結'); return; }
    if (!/^https:\/\/.+/.test(externalUrl)) { this.showToast('活動連結必須以 https:// 開頭'); return; }

    const timeVal = `${tStart}~${tEnd}`;
    const fullDate = `${dateVal.replace(/-/g, '/')} ${timeVal}`;

    const previewEl = document.getElementById('cee-upload-preview');
    const imgEl = previewEl?.querySelector('img');
    const image = imgEl ? imgEl.src : null;

    const submitBtn = document.getElementById('cee-submit-btn');

    if (this._editExternalEventId) {
      // 編輯模式
      this._externalEventSubmitInFlight = true;
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '儲存中...'; }
      try {
        await ApiService.updateEvent(this._editExternalEventId, {
          title, date: fullDate, location, externalUrl, sportTag, image,
          gradient: GRADIENT_MAP.external,
        });
        this.closeModal();
        this.showToast(`活動連結「${title}」已更新！`);
        ApiService._writeOpLog('event_update', '更新活動連結', `更新「${title}」`);
      } catch (err) {
        console.error('[handleCreateExternalEvent:update]', err);
        this.showToast('更新失敗，請稍後再試');
      } finally {
        this._externalEventSubmitInFlight = false;
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '儲存修改'; }
      }
    } else {
      // 新增模式：不允許選擇過去的日期時間
      const startDt = new Date(`${dateVal}T${tStart}`);
      if (startDt < new Date()) { this.showToast('活動開始時間不可早於現在'); return; }

      const creatorName = this._getEventCreatorName();
      const creatorUid = this._getEventCreatorUid();

      const newEvent = {
        id: 'ce_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        title,
        type: 'external',
        status: 'open',
        date: fullDate,
        location: location || '',
        externalUrl,
        sportTag,
        image,
        gradient: GRADIENT_MAP.external,
        creator: creatorName,
        creatorUid,
        // 外部活動不需要的欄位
        max: 0, current: 0, waitlist: 0, fee: 0, feeEnabled: false,
        participants: [], waitlistNames: [],
      };

      this._externalEventSubmitInFlight = true;
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '建立中...'; }
      try {
        await ApiService.createEvent(newEvent);
        this.closeModal();
        this.showToast(`活動連結「${title}」已建立！`);
        ApiService._writeOpLog('event_create', '建立活動連結', `建立「${title}」`);
      } catch (err) {
        console.error('[handleCreateExternalEvent:create]', err);
        this.showToast('建立失敗，請稍後再試');
        this._externalEventSubmitInFlight = false;
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '建立活動連結'; }
        return;
      }
      this._externalEventSubmitInFlight = false;
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '建立活動連結'; }
    }

    // 重新渲染
    try { this.renderActivityList(); } catch (_) {}
    try { this.renderHotEvents(); } catch (_) {}
    try { this.renderMyActivities(); } catch (_) {}
    this._editExternalEventId = null;
  },

  // ── External Event Templates ──

  _getExternalEventTemplates() {
    const all = (typeof ApiService !== 'undefined' && ApiService.getEventTemplates?.()) || [];
    return all.filter(t => t.templateType === 'external');
  },

  _buildCurrentExternalTemplate(name, image) {
    return {
      id: 'tpl_' + Date.now(),
      name,
      templateType: 'external',
      title: (document.getElementById('cee-title')?.value || '').trim(),
      location: (document.getElementById('cee-location')?.value || '').trim(),
      externalUrl: (document.getElementById('cee-external-url')?.value || '').trim(),
      sportTag: getSportKeySafe(document.getElementById('cee-sport-tag')?.value || '') || '',
      timeStart: document.getElementById('cee-start-time')?.value || '14:00',
      timeEnd: document.getElementById('cee-end-time')?.value || '16:00',
      image: image || null,
      updatedAt: new Date().toISOString(),
    };
  },

  async _saveExternalEventTemplate() {
    const nameInput = document.getElementById('cee-template-name');
    const name = (nameInput?.value || '').trim();
    if (!name) { this.showToast('請輸入範本名稱'); return; }

    const previewEl = document.getElementById('cee-upload-preview');
    const imgEl = previewEl?.querySelector('img');
    const tpl = this._buildCurrentExternalTemplate(name, imgEl ? imgEl.src : null);

    if (this._isCloudTemplateEnabled()) {
      const uid = this._getEventCreatorUid();
      try {
        await this._ensureExternalEventTemplatesReady();
        const existing = this._getExternalEventTemplates();
        if (existing.length >= this._MAX_TEMPLATES) {
          this.showToast(`範本數量已達上限 ${this._MAX_TEMPLATES} 組`);
          return;
        }
        await ApiService.createEventTemplate({
          ...tpl,
          ownerUid: uid,
          ownerName: this._getEventCreatorName(),
        });
        await ApiService.loadMyEventTemplates(uid);
        this._templatesLoadedUid = uid;
        nameInput.value = '';
        this._renderExternalTemplateSelector();
        this.showToast(`範本「${name}」已儲存到雲端`);
        return;
      } catch (err) {
        console.warn('[external event template] cloud save failed:', err);
      }
    }

    // Fallback: localStorage
    const localResult = this._saveTemplateToLocal(tpl);
    if (!localResult.ok) {
      this.showToast(localResult.reason === 'limit' ? `範本數量已達上限 ${this._MAX_TEMPLATES} 組` : '範本儲存失敗');
      return;
    }
    nameInput.value = '';
    this._renderExternalTemplateSelector();
    this.showToast(localResult.imageDropped ? '圖片太大，已省略圖片後儲存範本' : `範本「${name}」已儲存`);
  },

  _loadExternalEventTemplate(id) {
    const all = [...this._getExternalEventTemplates(), ...this._getEventTemplatesFromLocal().filter(t => t.templateType === 'external')];
    const tpl = all.find(t => t.id === id);
    if (!tpl) return;
    const setVal = (elId, val) => { const el = document.getElementById(elId); if (el && val != null && val !== '') el.value = val; };
    setVal('cee-title', tpl.title);
    setVal('cee-location', tpl.location);
    setVal('cee-external-url', tpl.externalUrl);
    setVal('cee-start-time', tpl.timeStart);
    setVal('cee-end-time', tpl.timeEnd);
    this._initSportTagPickerForContainer('cee', tpl.sportTag || '');
    if (tpl.image) {
      const preview = document.getElementById('cee-upload-preview');
      if (preview) {
        preview.innerHTML = `<img src="${tpl.image}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius)">`;
        preview.classList.add('has-image');
      }
    }
    this.showToast(`已載入範本「${tpl.name}」`);
  },

  async _deleteExternalEventTemplate(id) {
    if (this._isCloudTemplateEnabled()) {
      const uid = this._getEventCreatorUid();
      try {
        await ApiService.deleteEventTemplate(id);
        await ApiService.loadMyEventTemplates(uid);
        this._templatesLoadedUid = uid;
      } catch (err) {
        console.warn('[external event template] cloud delete failed:', err);
      }
    }
    this._removeTemplateFromLocal(id);
    this._renderExternalTemplateSelector();
    this.showToast('範本已刪除');
  },

  _renderExternalTemplateSelector() {
    const container = document.getElementById('cee-template-selector');
    if (!container) return;
    const cloud = this._getExternalEventTemplates();
    const local = this._getEventTemplatesFromLocal().filter(t => t.templateType === 'external');
    const seen = new Set(cloud.map(t => t.id));
    const templates = [...cloud, ...local.filter(t => !seen.has(t.id))];
    if (!templates.length) {
      container.innerHTML = '<span style="font-size:.75rem;color:var(--text-muted)">尚無範本</span>';
      return;
    }
    container.innerHTML = templates.map(t => `
      <span style="display:inline-flex;align-items:center;gap:.2rem;padding:.2rem .5rem;border-radius:var(--radius-full);background:var(--accent-bg);border:1px solid var(--accent);font-size:.72rem;cursor:pointer;color:var(--accent);font-weight:600" onclick="App._loadExternalEventTemplate('${t.id}')">
        ${escapeHTML(t.name)}
        <span onclick="event.stopPropagation();App._deleteExternalEventTemplate('${t.id}')" style="cursor:pointer;color:var(--text-muted);font-weight:400;margin-left:.1rem" title="刪除範本">✕</span>
      </span>
    `).join('');
  },

  async _ensureExternalEventTemplatesReady() {
    if (!this._isCloudTemplateEnabled()) return;
    const uid = this._getEventCreatorUid();
    if (!uid || uid === 'unknown') return;
    if (this._templatesLoadedUid === uid) return;
    try {
      await ApiService.loadMyEventTemplates(uid);
      this._templatesLoadedUid = uid;
    } catch (err) {
      console.warn('[external event template] load failed:', err);
    }
    this._renderExternalTemplateSelector();
  },

});
