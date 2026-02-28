/* ================================================
   SportHub — Event: Create & Edit
   依賴：event-list.js (helpers)
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  Input History (localStorage)
  // ══════════════════════════════════

  _inputHistoryKey() { return 'sporthub_input_history_' + ModeManager.getMode(); },

  _getInputHistory(key) {
    try {
      const all = JSON.parse(localStorage.getItem(this._inputHistoryKey()) || '{}');
      return Array.isArray(all[key]) ? all[key] : [];
    } catch { return []; }
  },

  _saveInputHistory(key, value) {
    if (value === undefined || value === null || value === '') return;
    const strVal = String(value).trim();
    if (!strVal) return;
    try {
      const all = JSON.parse(localStorage.getItem(this._inputHistoryKey()) || '{}');
      let arr = Array.isArray(all[key]) ? all[key] : [];
      arr = arr.filter(v => v !== strVal);
      arr.unshift(strVal);
      if (arr.length > 5) arr = arr.slice(0, 5);
      all[key] = arr;
      localStorage.setItem(this._inputHistoryKey(), JSON.stringify(all));
    } catch {}
  },

  _renderHistoryChips(key, inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    let container = input.nextElementSibling;
    if (!container || !container.classList.contains('input-history-chips')) {
      container = document.createElement('div');
      container.className = 'input-history-chips';
      input.parentNode.insertBefore(container, input.nextSibling);
    }
    const history = this._getInputHistory(key);
    if (history.length === 0) { container.style.display = 'none'; return; }
    container.style.display = '';
    container.innerHTML = history.map(v =>
      `<span class="input-history-chip" data-value="${escapeHTML(v)}">${escapeHTML(v)}</span>`
    ).join('');
    container.querySelectorAll('.input-history-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        input.value = chip.dataset.value;
        if (input.type === 'number') input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
  },

  _saveRecentDelegates(delegates) {
    if (!Array.isArray(delegates) || delegates.length === 0) return;
    try {
      const all = JSON.parse(localStorage.getItem(this._inputHistoryKey()) || '{}');
      let arr = Array.isArray(all['recent-delegates']) ? all['recent-delegates'] : [];
      delegates.forEach(d => {
        arr = arr.filter(e => e.uid !== d.uid);
        arr.unshift({ uid: d.uid, name: d.name });
      });
      if (arr.length > 10) arr = arr.slice(0, 10);
      all['recent-delegates'] = arr;
      localStorage.setItem(this._inputHistoryKey(), JSON.stringify(all));
    } catch {}
  },

  _getRecentDelegates() {
    try {
      const all = JSON.parse(localStorage.getItem(this._inputHistoryKey()) || '{}');
      return Array.isArray(all['recent-delegates']) ? all['recent-delegates'] : [];
    } catch { return []; }
  },

  _renderRecentDelegateChips(containerId, prefix) {
    const tagsContainer = document.getElementById(containerId);
    if (!tagsContainer) return;
    const wrapperId = containerId + '-recent-wrap';
    let wrapper = document.getElementById(wrapperId);
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.id = wrapperId;
      wrapper.className = 'input-history-chips';
      wrapper.style.marginBottom = '.3rem';
      tagsContainer.parentNode.insertBefore(wrapper, tagsContainer);
    }
    const recent = this._getRecentDelegates();
    const currentDelegates = prefix === 'ct' || prefix === 'et'
      ? (prefix === 'et' ? this._etDelegates : this._ctDelegates)
      : this._delegates;
    const selectedUids = currentDelegates.map(d => d.uid);
    const available = recent.filter(d => !selectedUids.includes(d.uid));
    if (available.length === 0) { wrapper.style.display = 'none'; return; }
    wrapper.style.display = '';
    wrapper.innerHTML = '<span style="font-size:.65rem;color:var(--text-muted);margin-right:.15rem">最近使用：</span>' +
      available.map(d =>
        `<span class="input-history-chip" data-uid="${escapeHTML(d.uid)}" data-name="${escapeHTML(d.name)}">${escapeHTML(d.name)}</span>`
      ).join('');
    wrapper.querySelectorAll('.input-history-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const uid = chip.dataset.uid;
        const name = chip.dataset.name;
        if (prefix === 'ct' || prefix === 'et') {
          this._addTournamentDelegate(uid, name, prefix);
        } else {
          this._addDelegate(uid, name);
        }
        this._renderRecentDelegateChips(containerId, prefix);
      });
    });
  },

  // ══════════════════════════════════
  //  Event Templates (localStorage)
  // ══════════════════════════════════

  _templateKey() { return 'sporthub_event_templates_' + ModeManager.getMode(); },
  _MAX_TEMPLATES: 10,

  _getEventTemplates() {
    try {
      const data = JSON.parse(localStorage.getItem(this._templateKey()) || '[]');
      return Array.isArray(data) ? data : [];
    } catch { return []; }
  },

  _saveEventTemplate() {
    const nameInput = document.getElementById('ce-template-name');
    const name = (nameInput?.value || '').trim();
    if (!name) { this.showToast('請輸入範本名稱'); return; }

    // 取得圖片（從預覽區的 img 或 base64）
    const cePreviewEl = document.getElementById('ce-upload-preview');
    const ceImg = cePreviewEl?.querySelector('img');
    const image = ceImg ? ceImg.src : null;

    const tpl = {
      id: 'tpl_' + Date.now(),
      name,
      title: document.getElementById('ce-title')?.value?.trim() || '',
      type: document.getElementById('ce-type')?.value || 'friendly',
      location: document.getElementById('ce-location')?.value?.trim() || '',
      date: document.getElementById('ce-date')?.value || '',
      timeStart: document.getElementById('ce-time-start')?.value || '14:00',
      timeEnd: document.getElementById('ce-time-end')?.value || '16:00',
      fee: parseInt(document.getElementById('ce-fee')?.value) || 0,
      max: parseInt(document.getElementById('ce-max')?.value) || 20,
      minAge: parseInt(document.getElementById('ce-min-age')?.value) || 0,
      notes: document.getElementById('ce-notes')?.value?.trim() || '',
      image,
    };

    const templates = this._getEventTemplates();
    if (templates.length >= this._MAX_TEMPLATES) {
      this.showToast(`範本數量已達上限 ${this._MAX_TEMPLATES} 組`);
      return;
    }
    templates.unshift(tpl);
    try {
      localStorage.setItem(this._templateKey(), JSON.stringify(templates));
    } catch (e) {
      // 圖片 base64 可能太大，嘗試不含圖片存
      tpl.image = null;
      localStorage.setItem(this._templateKey(), JSON.stringify(templates));
      this.showToast('圖片太大無法儲存到範本，其他欄位已保存');
      nameInput.value = '';
      this._renderTemplateSelector();
      return;
    }
    nameInput.value = '';
    this._renderTemplateSelector();
    this.showToast(`範本「${name}」已儲存`);
  },

  _loadEventTemplate(id) {
    const tpl = this._getEventTemplates().find(t => t.id === id);
    if (!tpl) return;
    const setVal = (elId, val) => { const el = document.getElementById(elId); if (el && val !== undefined && val !== null && val !== '') el.value = val; };
    setVal('ce-title', tpl.title);
    setVal('ce-type', tpl.type);
    setVal('ce-location', tpl.location);
    setVal('ce-date', tpl.date);
    setVal('ce-time-start', tpl.timeStart);
    setVal('ce-time-end', tpl.timeEnd);
    setVal('ce-fee', tpl.fee);
    setVal('ce-max', tpl.max);
    setVal('ce-min-age', tpl.minAge);
    setVal('ce-notes', tpl.notes);
    // 恢復圖片
    if (tpl.image) {
      const preview = document.getElementById('ce-upload-preview');
      if (preview) {
        preview.innerHTML = `<img src="${tpl.image}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--radius)">`;
        preview.classList.add('has-image');
      }
    }
    this.showToast(`已載入範本「${tpl.name}」`);
  },

  _deleteEventTemplate(id) {
    let templates = this._getEventTemplates().filter(t => t.id !== id);
    localStorage.setItem(this._templateKey(), JSON.stringify(templates));
    this._renderTemplateSelector();
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

  // ══════════════════════════════════
  // Cloud-backed templates override legacy local-only methods above.
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
    return {
      id: 'tpl_' + Date.now(),
      name,
      title: document.getElementById('ce-title')?.value?.trim() || '',
      type: document.getElementById('ce-type')?.value || 'friendly',
      location: document.getElementById('ce-location')?.value?.trim() || '',
      date: document.getElementById('ce-date')?.value || '',
      timeStart: document.getElementById('ce-time-start')?.value || '14:00',
      timeEnd: document.getElementById('ce-time-end')?.value || '16:00',
      fee: parseInt(document.getElementById('ce-fee')?.value) || 0,
      max: parseInt(document.getElementById('ce-max')?.value) || 20,
      minAge: parseInt(document.getElementById('ce-min-age')?.value) || 0,
      notes: document.getElementById('ce-notes')?.value?.trim() || '',
      image: image || null,
      updatedAt: new Date().toISOString(),
    };
  },

  async _saveEventTemplate() {
    const nameInput = document.getElementById('ce-template-name');
    const name = (nameInput?.value || '').trim();
    if (!name) { this.showToast('請輸入範本名稱'); return; }

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
    setVal('ce-fee', tpl.fee);
    setVal('ce-max', tpl.max);
    setVal('ce-min-age', tpl.minAge);
    setVal('ce-notes', tpl.notes);
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

  //  Create Event
  // ══════════════════════════════════

  _editEventId: null,

  openCreateEventModal() {
    this._editEventId = null;
    this._delegates = [];
    // 重置表單欄位，防止編輯後殘留資料
    document.getElementById('ce-title').value = '';
    document.getElementById('ce-type').value = 'friendly';
    document.getElementById('ce-location').value = '';
    document.getElementById('ce-date').value = '';
    document.getElementById('ce-time-start').value = '14:00';
    document.getElementById('ce-time-end').value = '16:00';
    document.getElementById('ce-fee').value = '300';
    document.getElementById('ce-max').value = '20';
    document.getElementById('ce-waitlist').value = '0';
    document.getElementById('ce-min-age').value = '0';
    document.getElementById('ce-notes').value = '';
    const regOpen = document.getElementById('ce-reg-open-time');
    if (regOpen) regOpen.value = '';
    document.getElementById('ce-image').value = '';
    const ceTeamOnly = document.getElementById('ce-team-only');
    const ceTeamSelect = document.getElementById('ce-team-select');
    if (ceTeamSelect) ceTeamSelect.value = '';
    if (ceTeamOnly) { ceTeamOnly.checked = false; this._updateTeamOnlyLabel(); }
    const cePreview = document.getElementById('ce-upload-preview');
    if (cePreview) {
      cePreview.classList.remove('has-image');
      cePreview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 800 × 300 px｜JPG / PNG｜最大 2MB</span>';
    }
    const submitBtn = document.getElementById('ce-submit-btn');
    if (submitBtn) submitBtn.textContent = '建立活動';
    // 確保事件已綁定（防止 Phase 1 非同步時機導致未綁定）
    this.bindImageUpload('ce-image', 'ce-upload-preview');
    this.bindTeamOnlyToggle();
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

  // ── 委託人搜尋 ──
  _delegates: [],
  _delegateSearchBound: false,

  _initDelegateSearch() {
    const input = document.getElementById('ce-delegate-search');
    const dropdown = document.getElementById('ce-delegate-dropdown');
    if (!input || !dropdown) return;

    if (!this._delegateSearchBound) {
      this._delegateSearchBound = true;

      input.addEventListener('input', () => {
        const q = input.value.trim();
        if (q.length < 1) { dropdown.classList.remove('open'); dropdown.innerHTML = ''; return; }
        this._searchDelegates(q);
      });

      input.addEventListener('blur', () => {
        setTimeout(() => { dropdown.classList.remove('open'); }, 200);
      });

      input.addEventListener('focus', () => {
        const q = input.value.trim();
        if (q.length >= 1) this._searchDelegates(q);
      });
    }

    this._renderDelegateTags();
    this._updateDelegateInput();
  },

  _searchDelegates(query) {
    const dropdown = document.getElementById('ce-delegate-dropdown');
    if (!dropdown) return;
    const q = query.toLowerCase();
    const myUid = this._getEventCreatorUid();
    const selectedUids = this._delegates.map(d => d.uid);

    const allUsers = ApiService.getAdminUsers?.() || [];
    const results = allUsers.filter(u => {
      if (u.uid === myUid) return false;
      if (selectedUids.includes(u.uid)) return false;
      return (u.name || '').toLowerCase().includes(q) || (u.uid || '').toLowerCase().includes(q);
    }).slice(0, 5);

    if (results.length === 0) {
      dropdown.innerHTML = '<div style="padding:.4rem .6rem;font-size:.78rem;color:var(--text-muted)">找不到符合的用戶</div>';
    } else {
      const roleLabels = typeof ROLES !== 'undefined' ? ROLES : {};
      dropdown.innerHTML = results.map(u => {
        const roleLabel = roleLabels[u.role]?.label || u.role || '';
        return `<div class="ce-delegate-item" data-uid="${u.uid}" data-name="${escapeHTML(u.name)}">
          <span class="ce-delegate-item-name">${escapeHTML(u.name)}</span>
          <span class="ce-delegate-item-meta">${u.uid} · ${roleLabel}</span>
        </div>`;
      }).join('');

      dropdown.querySelectorAll('.ce-delegate-item').forEach(item => {
        item.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          this._addDelegate(item.dataset.uid, item.dataset.name);
          document.getElementById('ce-delegate-search').value = '';
          dropdown.classList.remove('open');
        });
      });
    }
    dropdown.classList.add('open');
  },

  _addDelegate(uid, name) {
    if (this._delegates.length >= 3) return;
    if (this._delegates.some(d => d.uid === uid)) return;
    this._delegates.push({ uid, name });
    this._renderDelegateTags();
    this._updateDelegateInput();
  },

  _removeDelegate(uid) {
    this._delegates = this._delegates.filter(d => d.uid !== uid);
    this._renderDelegateTags();
    this._updateDelegateInput();
  },

  _renderDelegateTags() {
    const container = document.getElementById('ce-delegate-tags');
    if (!container) return;
    const users = ApiService.getAdminUsers?.() || [];
    container.innerHTML = this._delegates.map(d => {
      const u = users.find(u => u.uid === d.uid);
      const role = u?.role || 'user';
      return `<span class="ce-delegate-tag">${this._userTag(d.name, role)}<span class="ce-delegate-remove" onclick="App._removeDelegate('${d.uid}')">✕</span></span>`;
    }).join('');
  },

  _updateDelegateInput() {
    const input = document.getElementById('ce-delegate-search');
    if (!input) return;
    input.disabled = this._delegates.length >= 3;
    input.placeholder = this._delegates.length >= 3 ? '已達上限 3 人' : '搜尋 UID 或暱稱...';
  },

  /** 球隊限定：填充下拉選單（僅在切換開啟時呼叫，避免重複重建） */
  _populateTeamSelect(select) {
    const teams = ApiService.getTeams?.() || [];
    const activeTeams = teams.filter(t => t.active !== false);
    select.innerHTML = '<option value="">請選擇球隊</option>' +
      activeTeams.map(t => `<option value="${t.id}" data-name="${escapeHTML(t.name)}">${escapeHTML(t.name)}</option>`).join('');
  },

  /** 球隊限定開關 label 更新 */
  _updateTeamOnlyLabel() {
    const cb = document.getElementById('ce-team-only');
    const label = document.getElementById('ce-team-only-label');
    const select = document.getElementById('ce-team-select');
    if (!cb || !label) return;
    if (cb.checked) {
      const team = this._getEventCreatorTeam();
      if (team.teamId) {
        // 用戶有球隊，直接顯示
        label.textContent = `開啟 — 僅 ${team.teamName || '您的球隊'} 可見`;
        label.style.color = '#e11d48';
        if (select) select.style.display = 'none';
      } else {
        // 用戶無球隊，顯示下拉選擇
        label.style.color = '#e11d48';
        if (select) {
          select.style.display = '';
          // 依據下拉選單當前值更新提示文字
          const selectedOption = select.options[select.selectedIndex];
          if (select.value && selectedOption) {
            const teamName = selectedOption.dataset?.name || selectedOption.textContent || select.value;
            label.textContent = `開啟 — 僅 ${teamName} 可見`;
          } else {
            label.textContent = '開啟 — 請選擇球隊';
          }
        }
      }
    } else {
      label.textContent = '關閉 — 所有人可見';
      label.style.color = 'var(--text-muted)';
      if (select) select.style.display = 'none';
    }
  },

  /** 綁定球隊限定開關事件 */
  bindTeamOnlyToggle() {
    const cb = document.getElementById('ce-team-only');
    const select = document.getElementById('ce-team-select');
    if (cb && !cb.dataset.bound) {
      cb.dataset.bound = '1';
      cb.addEventListener('change', () => {
        // 僅在切換為 ON 時填充下拉選單
        if (cb.checked && select) this._populateTeamSelect(select);
        this._updateTeamOnlyLabel();
      });
    }
    if (select && !select.dataset.bound) {
      select.dataset.bound = '1';
      // 下拉選單變更只更新提示文字，不重建選項
      select.addEventListener('change', () => this._updateTeamOnlyLabel());
    }
  },

  handleCreateEvent() {
    if ((ROLE_LEVEL_MAP[this.currentRole] || 0) < ROLE_LEVEL_MAP.coach) {
      this.showToast('權限不足'); return;
    }
    const title = document.getElementById('ce-title').value.trim();
    const type = document.getElementById('ce-type').value;
    const location = document.getElementById('ce-location').value.trim();
    const dateVal = document.getElementById('ce-date').value;
    const tStart = document.getElementById('ce-time-start').value;
    const tEnd = document.getElementById('ce-time-end').value;
    const timeVal = (tStart && tEnd) ? `${tStart}~${tEnd}` : '';
    const fee = parseInt(document.getElementById('ce-fee').value) || 0;
    const max = parseInt(document.getElementById('ce-max').value) || 20;
    const minAge = parseInt(document.getElementById('ce-min-age').value) || 0;
    const notes = document.getElementById('ce-notes').value.trim();
    const regOpenTime = document.getElementById('ce-reg-open-time')?.value || '';
    const teamOnly = !!document.getElementById('ce-team-only')?.checked;

    if (!title) { this.showToast('請輸入活動名稱'); return; }
    if (title.length > 12) { this.showToast('活動名稱不可超過 12 字'); return; }
    if (!location) { this.showToast('請輸入地點'); return; }
    if (!dateVal) { this.showToast('請選擇活動日期'); return; }
    if (!tStart || !tEnd) { this.showToast('請選擇開始與結束時間'); return; }
    // 新增模式：不允許選擇過去的日期時間
    if (!this._editEventId) {
      const startDt = new Date(`${dateVal}T${tStart}`);
      if (startDt < new Date()) { this.showToast('活動開始時間不可早於現在'); return; }
    }
    if (tEnd <= tStart) { this.showToast('結束時間必須晚於開始時間'); return; }
    if (notes.length > 500) { this.showToast('注意事項不可超過 500 字'); return; }
    // 球隊限定：決定 teamId / teamName
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
        if (!selVal) { this.showToast('請選擇限定球隊'); return; }
        resolvedTeamId = selVal;
        resolvedTeamName = select.options[select.selectedIndex]?.dataset?.name || selVal;
      }
    }

    const cePreviewEl = document.getElementById('ce-upload-preview');
    const ceImg = cePreviewEl?.querySelector('img');
    const image = ceImg ? ceImg.src : null;

    const fullDate = `${dateVal.replace(/-/g, '/')} ${timeVal}`;

    if (this._editEventId) {
      // Trigger 6：活動變更通知 — 先取得現有報名者
      const existingEvent = ApiService.getEvent(this._editEventId);
      const notifyNames = existingEvent
        ? [...(existingEvent.participants || []), ...(existingEvent.waitlistNames || [])]
        : [];

      const updates = {
        title, type, location, date: fullDate, fee, max, minAge, notes, image,
        regOpenTime: regOpenTime || null,
        gradient: GRADIENT_MAP[type] || GRADIENT_MAP.friendly,
        teamOnly,
        creatorTeamId: teamOnly ? resolvedTeamId : null,
        creatorTeamName: teamOnly ? resolvedTeamName : null,
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

      // ── 容量變更 → 自動遞補 / 降級候補 ──
      this._adjustWaitlistOnCapacityChange(this._editEventId, oldMax, max);

      // 發送活動變更通知：優先用 registrations 按 userId 去重（避免同行者重複通知）
      const eventRegs = ApiService.getRegistrationsByEvent(this._editEventId);
      if (eventRegs.length > 0) {
        const notifyUids = [...new Set(eventRegs.map(r => r.userId))];
        notifyUids.forEach(uid => {
          this._sendNotifFromTemplate('event_changed', {
            eventName: title, date: fullDate, location,
          }, uid, 'activity', '活動');
        });
      } else if (notifyNames.length > 0) {
        // fallback: 舊資料沒有 registrations，用名字查找
        const adminUsers = ApiService.getAdminUsers();
        notifyNames.forEach(name => {
          const u = adminUsers.find(au => au.name === name);
          if (u) {
            this._sendNotifFromTemplate('event_changed', {
              eventName: title, date: fullDate, location,
            }, u.uid, 'activity', '活動');
          }
        });
      }

      ApiService._writeOpLog('event_edit', '編輯活動', `編輯「${title}」`);
      this.closeModal();
      this._editEventId = null;
      this.renderActivityList();
      this.renderHotEvents();
      this.renderMyActivities();
      this.showToast(`活動「${title}」已更新！`);
    } else {
      const creatorName = this._getEventCreatorName();
      const creatorUid = this._getEventCreatorUid();
      const initStatus = (regOpenTime && new Date(regOpenTime) > new Date()) ? 'upcoming' : 'open';
      const newEvent = {
        id: 'ce_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        title, type, status: initStatus, location, date: fullDate,
        fee, max, current: 0, waitlist: 0, minAge, notes, image,
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
        creatorTeamId: teamOnly ? resolvedTeamId : null,
        creatorTeamName: teamOnly ? resolvedTeamName : null,
        delegates: [...this._delegates],
      };
      ApiService.createEvent(newEvent);
      this._saveInputHistory('ce-location', location);
      if (fee > 0) this._saveInputHistory('ce-fee', fee);
      this._saveInputHistory('ce-max', max);
      if (minAge > 0) this._saveInputHistory('ce-min-age', minAge);
      this._saveRecentDelegates(this._delegates);
      ApiService._writeOpLog('event_create', '建立活動', `建立「${title}」`);
      // Auto EXP: host activity
      const _creatorUser = ApiService.getCurrentUser?.();
      if (_creatorUser?.uid) this._grantAutoExp(_creatorUser.uid, 'host_activity', title);
      this.closeModal();
      this.renderActivityList();
      this.renderHotEvents();
      this.renderMyActivities();
      this.showToast(`活動「${title}」已建立！`);
    }

    // 重置表單
    this._editEventId = null;
    document.getElementById('ce-title').value = '';
    document.getElementById('ce-location').value = '';
    document.getElementById('ce-fee').value = '300';
    document.getElementById('ce-max').value = '20';
    document.getElementById('ce-waitlist').value = '0';
    document.getElementById('ce-min-age').value = '0';
    document.getElementById('ce-notes').value = '';
    document.getElementById('ce-reg-open-time').value = '';
    document.getElementById('ce-image').value = '';
    document.getElementById('ce-date').value = '';
    document.getElementById('ce-time-start').value = '14:00';
    document.getElementById('ce-time-end').value = '16:00';
    this._delegates = [];
    this._renderDelegateTags();
    this._updateDelegateInput();
    const ceTeamOnly = document.getElementById('ce-team-only');
    const ceTeamSelect = document.getElementById('ce-team-select');
    if (ceTeamSelect) ceTeamSelect.value = '';
    if (ceTeamOnly) { ceTeamOnly.checked = false; this._updateTeamOnlyLabel(); }
    const cePreview = document.getElementById('ce-upload-preview');
    if (cePreview) {
      cePreview.classList.remove('has-image');
      cePreview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 800 × 300 px｜JPG / PNG｜最大 2MB</span>';
    }
  },

  // ══════════════════════════════════
  //  候補排序 helper
  // ══════════════════════════════════

  /** 取得下一位應遞補的候補者（按報名時間排序，同 userId 內按 promotionOrder 排） */
  _getNextWaitlistCandidate(eventId) {
    const regs = ApiService.getRegistrationsByEvent(eventId);
    return regs
      .filter(r => r.status === 'waitlisted')
      .sort((a, b) => {
        const ta = new Date(a.registeredAt).getTime();
        const tb = new Date(b.registeredAt).getTime();
        if (ta !== tb) return ta - tb;
        return (a.promotionOrder || 0) - (b.promotionOrder || 0);
      })[0] || null;
  },

  /** 執行單人遞補：將候補 registration 轉為 confirmed，更新活動名單 */
  _promoteSingleCandidate(event, reg) {
    if (!reg) return false;
    const pName = reg.participantType === 'companion'
      ? (reg.companionName || reg.userName)
      : reg.userName;

    reg.status = 'confirmed';
    if (!ModeManager.isDemo() && reg._docId) {
      db.collection('registrations').doc(reg._docId).update({ status: 'confirmed' })
        .catch(err => console.error('[promoteSingle]', err));
    }

    const wIdx = (event.waitlistNames || []).indexOf(pName);
    if (wIdx >= 0) event.waitlistNames.splice(wIdx, 1);
    if (!(event.participants || []).includes(pName)) {
      event.participants = event.participants || [];
      event.participants.push(pName);
    }
    event.current = (event.current || 0) + 1;
    event.waitlist = Math.max(0, (event.waitlist || 0) - 1);

    // 更新 activityRecord：waitlisted → registered（同行者不動）
    if (reg.participantType !== 'companion') {
      const arSource = ApiService._src('activityRecords');
      const ar = arSource.find(a => a.eventId === event.id && a.uid === reg.userId && a.status === 'waitlisted');
      if (ar) {
        ar.status = 'registered';
        if (!ModeManager.isDemo() && ar._docId) {
          db.collection('activityRecords').doc(ar._docId).update({ status: 'registered' })
            .catch(err => console.error('[promoteAR]', err));
        }
      }
    }

    // 發送遞補通知
    this._sendNotifFromTemplate('waitlist_promoted', {
      eventName: event.title, date: event.date, location: event.location,
    }, reg.userId, 'activity', '活動');

    return true;
  },

  // ══════════════════════════════════
  //  候補自動遞補 / 降級（容量變更時）
  // ══════════════════════════════════

  _adjustWaitlistOnCapacityChange(eventId, oldMax, newMax) {
    const event = ApiService.getEvent(eventId);
    if (!event) return;

    if (newMax > oldMax) {
      // ── 容量增加 → 遞補候補 ──
      let slotsAvailable = newMax - event.current;
      if (slotsAvailable <= 0) return;

      let promoted = 0;
      while (slotsAvailable > 0) {
        const candidate = this._getNextWaitlistCandidate(eventId);
        if (!candidate) break;
        this._promoteSingleCandidate(event, candidate);
        slotsAvailable--;
        promoted++;
      }

      event.status = event.current >= newMax ? 'full' : 'open';
      this._syncEventToFirebase(event);

      if (promoted > 0) {
        console.log(`[adjustWaitlist] 容量增加，已遞補 ${promoted} 位候補者`);
      }
    } else if (newMax < oldMax && event.current > newMax) {
      // ── 容量減少 → 降級多餘正取者到候補 ──
      const excess = event.current - newMax;
      const regs = ApiService.getRegistrationsByEvent(eventId);
      const confirmed = regs
        .filter(r => r.status === 'confirmed')
        .sort((a, b) => {
          // 最晚報名者先降
          const ta = new Date(a.registeredAt).getTime();
          const tb = new Date(b.registeredAt).getTime();
          if (ta !== tb) return tb - ta;
          // 同 userId 中 promotionOrder 最大的先降（同行者先降、本人最後）
          return (b.promotionOrder || 0) - (a.promotionOrder || 0);
        });

      let demoted = 0;
      for (const reg of confirmed) {
        if (demoted >= excess) break;
        const pName = reg.participantType === 'companion'
          ? (reg.companionName || reg.userName)
          : reg.userName;

        reg.status = 'waitlisted';
        if (!ModeManager.isDemo() && reg._docId) {
          db.collection('registrations').doc(reg._docId).update({ status: 'waitlisted' })
            .catch(err => console.error('[demoteToWaitlist]', err));
        }

        // 從 participants 移到 waitlistNames
        const pIdx = (event.participants || []).indexOf(pName);
        if (pIdx >= 0) event.participants.splice(pIdx, 1);
        if (!(event.waitlistNames || []).includes(pName)) {
          event.waitlistNames = event.waitlistNames || [];
          event.waitlistNames.push(pName);
        }
        event.current = Math.max(0, event.current - 1);
        event.waitlist = (event.waitlist || 0) + 1;
        demoted++;

        // 發送降級通知
        this._sendNotifFromTemplate('waitlist_demoted', {
          eventName: event.title, date: event.date, location: event.location,
        }, reg.userId, 'activity', '活動');
      }

      event.status = event.current >= newMax ? 'full' : 'open';
      this._syncEventToFirebase(event);

      if (demoted > 0) {
        console.log(`[adjustWaitlist] 容量減少，已降級 ${demoted} 位正取者到候補`);
      }
    }
  },

  /** 同步活動計數至 Firebase */
  _syncEventToFirebase(event) {
    if (!ModeManager.isDemo() && event._docId) {
      db.collection('events').doc(event._docId).update({
        current: event.current,
        waitlist: event.waitlist,
        participants: event.participants,
        waitlistNames: event.waitlistNames,
        status: event.status,
      }).catch(err => console.error('[syncEvent]', err));
    }
  },

});
