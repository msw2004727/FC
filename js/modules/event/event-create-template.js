/* ================================================
   SportHub — Event Create: Template Management (Local + Cloud)
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  Event Templates (cloud + local fallback)
  // ══════════════════════════════════
  _templateKey() { return 'sporthub_event_templates_' + ModeManager.getMode(); },
  _MAX_TEMPLATES: 30,
  _templateMigrationKey(uid) { return `sporthub_event_templates_migrated_${ModeManager.getMode()}_${uid}`; },
  _templatesLoadedUid: null,

  _isCloudTemplateEnabled() {
    if (ModeManager.isDemo()) return false;
    const uid = this._getEventCreatorUid?.();
    return !!uid && uid !== 'unknown';
  },

  _getEventTemplatesFromLocal() {
    try {
      const data = JSON.parse(localStorage.getItem(this._templateKey()) || '[]');
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  },

  _setEventTemplatesToLocal(templates) {
    localStorage.setItem(this._templateKey(), JSON.stringify(templates));
  },

  _saveTemplateToLocal(template) {
    let templates = this._getEventTemplatesFromLocal().filter(t => t.id !== template.id);
    if (templates.length >= this._MAX_TEMPLATES) {
      return { ok: false, reason: 'limit' };
    }
    templates.unshift({ ...template });
    if (templates.length > this._MAX_TEMPLATES) templates = templates.slice(0, this._MAX_TEMPLATES);
    try {
      this._setEventTemplatesToLocal(templates);
      return { ok: true, imageDropped: false };
    } catch (e) {
      try {
        const fallback = templates.map(t => t.id === template.id ? { ...t, image: null } : t);
        this._setEventTemplatesToLocal(fallback);
        return { ok: true, imageDropped: true };
      } catch {
        return { ok: false, reason: 'quota' };
      }
    }
  },

  _removeTemplateFromLocal(id) {
    try {
      const templates = this._getEventTemplatesFromLocal().filter(t => t.id !== id);
      this._setEventTemplatesToLocal(templates);
    } catch {}
  },

  _getEventTemplates() {
    if (this._isCloudTemplateEnabled()) {
      const cloud = ApiService.getEventTemplates?.() || [];
      if (cloud.length > 0 || this._templatesLoadedUid === this._getEventCreatorUid()) {
        return cloud;
      }
    }
    return this._getEventTemplatesFromLocal();
  },

  async _migrateLegacyLocalTemplates(uid) {
    const migrationKey = this._templateMigrationKey(uid);
    if (localStorage.getItem(migrationKey) === '1') return;

    const localTemplates = this._getEventTemplatesFromLocal();
    if (!localTemplates.length) {
      localStorage.setItem(migrationKey, '1');
      return;
    }

    const cloudTemplates = ApiService.getEventTemplates?.() || [];
    const cloudIds = new Set(cloudTemplates.map(t => t.id));
    const pending = localTemplates.filter(t => !cloudIds.has(t.id));
    if (!pending.length) {
      localStorage.setItem(migrationKey, '1');
      return;
    }

    const remaining = Math.max(0, this._MAX_TEMPLATES - cloudTemplates.length);
    if (remaining === 0) {
      localStorage.setItem(migrationKey, '1');
      return;
    }

    const toUpload = pending.slice(0, remaining).reverse();
    for (const tpl of toUpload) {
      await ApiService.createEventTemplate({
        ...tpl,
        ownerUid: uid,
        ownerName: this._getEventCreatorName(),
        migratedFromLocal: true,
      });
    }

    await ApiService.loadMyEventTemplates(uid);
    this._templatesLoadedUid = uid;
    localStorage.setItem(migrationKey, '1');
    this.showToast('已將本機範本同步到雲端');
  },

  async _ensureEventTemplatesReady(force = false) {
    if (!this._isCloudTemplateEnabled()) return;
    const uid = this._getEventCreatorUid();
    if (!uid || uid === 'unknown') return;
    if (!force && this._templatesLoadedUid === uid) return;
    try {
      await ApiService.loadMyEventTemplates(uid);
      this._templatesLoadedUid = uid;
      await this._migrateLegacyLocalTemplates(uid);
    } catch (err) {
      console.warn('[event template] load failed, fallback to local:', err);
    }
    this._renderTemplateSelector();
  },

  _buildCurrentTemplate(name, image) {
    const genderRestrictionEnabled = !!document.getElementById('ce-gender-restriction-enabled')?.checked;
    const feeEnabled = !!document.getElementById('ce-fee-enabled')?.checked;
    const regOpenTime = this._getEventRegOpenTimeValue();
    return {
      id: 'tpl_' + Date.now(),
      name,
      title: document.getElementById('ce-title')?.value?.trim() || '',
      type: document.getElementById('ce-type')?.value || 'play',
      location: document.getElementById('ce-location')?.value?.trim() || '',
      date: document.getElementById('ce-date')?.value || '',
      timeStart: document.getElementById('ce-time-start')?.value || '14:00',
      timeEnd: document.getElementById('ce-time-end')?.value || '16:00',
      fee: feeEnabled ? (parseInt(document.getElementById('ce-fee')?.value, 10) || 0) : 0,
      feeEnabled,
      max: parseInt(document.getElementById('ce-max')?.value) || 20,
      minAge: parseInt(document.getElementById('ce-min-age')?.value) || 0,
      notes: document.getElementById('ce-notes')?.value?.trim() || '',
      sportTag: getSportKeySafe(document.getElementById('ce-sport-tag')?.value || '') || '',
      regOpenTime: typeof regOpenTime === 'string' ? regOpenTime : '',
      genderRestrictionEnabled,
      allowedGender: genderRestrictionEnabled ? this._getAllowedGenderValue() : '',
      privateEvent: !!document.getElementById('ce-private-event')?.checked,
      image: image || null,
      updatedAt: new Date().toISOString(),
    };
  },

  async _saveEventTemplate() {
    const nameInput = document.getElementById('ce-template-name');
    const name = (nameInput?.value || '').trim();
    if (!name) { this.showToast('請輸入範本名稱'); return; }
    if (document.getElementById('ce-gender-restriction-enabled')?.checked && !this._getAllowedGenderValue()) {
      this.showToast('請先選擇限定性別，再儲存範本');
      return;
    }

    const cePreviewEl = document.getElementById('ce-upload-preview');
    const ceImg = cePreviewEl?.querySelector('img');
    const tpl = this._buildCurrentTemplate(name, ceImg ? ceImg.src : null);

    if (this._isCloudTemplateEnabled()) {
      const uid = this._getEventCreatorUid();
      try {
        await this._ensureEventTemplatesReady();
        const cloudTemplates = ApiService.getEventTemplates?.() || [];
        if (cloudTemplates.length >= this._MAX_TEMPLATES) {
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
        this._saveTemplateToLocal(tpl);
        nameInput.value = '';
        this._renderTemplateSelector();
        this.showToast(`範本「${name}」已儲存到雲端`);
        return;
      } catch (err) {
        console.warn('[event template] cloud save failed:', err);
      }
    }

    const localResult = this._saveTemplateToLocal(tpl);
    if (!localResult.ok) {
      if (localResult.reason === 'limit') {
        this.showToast(`範本數量已達上限 ${this._MAX_TEMPLATES} 組`);
      } else {
        this.showToast('範本儲存失敗');
      }
      return;
    }

    nameInput.value = '';
    this._renderTemplateSelector();
    if (localResult.imageDropped) {
      this.showToast('圖片太大，已省略圖片後儲存範本');
    } else if (this._isCloudTemplateEnabled()) {
      this.showToast(`雲端儲存失敗，已暫存本機範本「${name}」`);
    } else {
      this.showToast(`範本「${name}」已儲存`);
    }
  },

  _loadEventTemplate(id) {
    const tpl = this._getEventTemplates().find(t => t.id === id);
    if (!tpl) return;
    const setVal = (elId, val) => {
      const el = document.getElementById(elId);
      if (el && val !== undefined && val !== null && val !== '') el.value = val;
    };
    setVal('ce-title', tpl.title);
    setVal('ce-type', tpl.type);
    setVal('ce-location', tpl.location);
    setVal('ce-date', tpl.date);
    setVal('ce-time-start', tpl.timeStart);
    setVal('ce-time-end', tpl.timeEnd);
    const feeEnabled = typeof tpl.feeEnabled === 'boolean' ? tpl.feeEnabled : Number(tpl.fee || 0) > 0;
    this._setEventFeeFormState(feeEnabled, Number(tpl.fee || 0) > 0 ? tpl.fee : 0);
    setVal('ce-max', tpl.max);
    setVal('ce-min-age', tpl.minAge);
    setVal('ce-notes', tpl.notes);
    this._initSportTagPicker(tpl.sportTag || '');
    this._setEventRegOpenTimeValue(tpl.regOpenTime || '');
    this._setGenderRestrictionState(!!tpl.genderRestrictionEnabled, tpl.allowedGender || '');
    this._setPrivateEventState?.(!!tpl.privateEvent);
    if (tpl.image) {
      const preview = document.getElementById('ce-upload-preview');
      if (preview) {
        preview.innerHTML = `<img src="${tpl.image}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius)">`;
        preview.classList.add('has-image');
      }
    }
    this.showToast(`已載入範本「${tpl.name}」`);
  },

  async _deleteEventTemplate(id) {
    const cloudEnabled = this._isCloudTemplateEnabled();
    let cloudDeleted = false;

    if (cloudEnabled) {
      const uid = this._getEventCreatorUid();
      try {
        await this._ensureEventTemplatesReady();
        await ApiService.deleteEventTemplate(id);
        await ApiService.loadMyEventTemplates(uid);
        this._templatesLoadedUid = uid;
        cloudDeleted = true;
      } catch (err) {
        console.warn('[event template] cloud delete failed:', err);
      }
    }

    this._removeTemplateFromLocal(id);
    this._renderTemplateSelector();

    if (cloudEnabled && !cloudDeleted) {
      this.showToast('雲端刪除失敗，已刪除本機範本');
      return;
    }
    this.showToast('範本已刪除');
  },

  _renderTemplateSelector() {
    const container = document.getElementById('ce-template-selector');
    if (!container) return;
    const templates = this._getEventTemplates();
    if (!templates.length) {
      container.innerHTML = '<span style="font-size:.75rem;color:var(--text-muted)">尚無範本</span>';
      return;
    }
    container.innerHTML = templates.map(t => `
      <span style="display:inline-flex;align-items:center;gap:.2rem;padding:.2rem .5rem;border-radius:var(--radius-full);background:var(--accent-bg);border:1px solid var(--accent);font-size:.72rem;cursor:pointer;color:var(--accent);font-weight:600" onclick="App._loadEventTemplate('${t.id}')">
        ${escapeHTML(t.name)}
        <span onclick="event.stopPropagation();App._deleteEventTemplate('${t.id}')" style="cursor:pointer;color:var(--text-muted);font-weight:400;margin-left:.1rem" title="刪除範本">✕</span>
      </span>
    `).join('');
  },

});
