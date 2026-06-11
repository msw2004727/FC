/* ================================================
   SportHub — Team: Form Initialize & Display
   ================================================ */

Object.assign(App, {

  _resetTeamForm() {
    document.getElementById('ct-team-name').value = '';
    document.getElementById('ct-team-name-en').value = '';
    document.getElementById('ct-team-nationality').value = '台灣';
    document.getElementById('ct-team-region').value = '';
    const _regSug = document.getElementById('ct-team-region-suggest');
    if (_regSug) { _regSug.innerHTML = ''; _regSug.classList.remove('show'); }
    document.getElementById('ct-team-founded').value = '';
    document.getElementById('ct-leader-search').value = '';
    document.getElementById('ct-leaders-tags').innerHTML = '';
    document.getElementById('ct-leader-suggest').innerHTML = '';
    document.getElementById('ct-leader-suggest').classList.remove('show');
    document.getElementById('ct-captain-search').value = '';
    document.getElementById('ct-captain-selected').innerHTML = '';
    document.getElementById('ct-captain-suggest').innerHTML = '';
    document.getElementById('ct-captain-suggest').classList.remove('show');
    document.getElementById('ct-captain-display').innerHTML = '';
    document.getElementById('ct-captain-transfer').style.display = 'none';
    document.getElementById('ct-captain-locked').style.display = 'none';
    document.getElementById('ct-team-contact').value = '';
    this._setTeamContactLinksFormData?.(false, []);
    document.getElementById('ct-coach-search').value = '';
    document.getElementById('ct-coach-tags').innerHTML = '';
    document.getElementById('ct-coach-suggest').innerHTML = '';
    document.getElementById('ct-coach-suggest').classList.remove('show');
    document.getElementById('ct-team-bio').value = '';
    this._teamFormState.leaders = [];
    this._teamFormState.captain = null;
    this._teamFormState.coaches = [];
    this._teamImageVariantsData = null;
    // 運動類型重置
    const sportSelect = document.getElementById('ct-team-sport-tag');
    if (sportSelect) sportSelect.value = '';
    // 俱樂部類型重置
    const typeSelect = document.getElementById('ct-team-type');
    if (typeSelect) typeSelect.value = 'competitive';
    this._onTeamTypeChange('competitive');
    const preview = document.getElementById('ct-team-preview');
    preview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">\u4e0a\u50b3\u4ff1\u6a02\u90e8\u5716\u7247</span><span class="ce-upload-hint">\u4e00\u5f35\u539f\u5716\u88c1\u5207\u5c01\u9762 800 x 300 \u8207\u5361\u7247 800 x 800</span>';
    preview.style.backgroundImage = '';
    preview.classList.remove('has-image');
    const fileInput = document.getElementById('ct-team-image');
    if (fileInput) fileInput.value = '';
  },

  /**
   * 俱樂部類型切換時顯示/隱藏教育型專屬欄位
   */
  _onTeamTypeChange(type) {
    const meta = typeof this._getTeamTypeMeta === 'function'
      ? this._getTeamTypeMeta(type)
      : (type === 'none'
        ? { key: 'none', label: '無', formHint: '不顯示任何標籤與緞帶，也不啟用課程功能。' }
        : { key: type === 'education' ? 'education' : 'competitive', label: type === 'education' ? '教學' : '競技', formHint: '' });
    const normalizedType = meta.key || 'competitive';
    const typeInput = document.getElementById('ct-team-type');
    if (typeInput) typeInput.value = normalizedType;
    document.querySelectorAll('[data-team-type-option]').forEach(btn => {
      const active = btn.getAttribute('data-team-type-option') === normalizedType;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const typeLabel = document.getElementById('ct-team-type-label');
    if (typeLabel) typeLabel.textContent = meta.label || '';
    const typeHint = document.getElementById('ct-team-type-hint');
    if (typeHint) typeHint.textContent = meta.formHint || '';
    const handler = this._getTeamTypeHandler(normalizedType);
    const eduSection = document.getElementById('ct-edu-settings');
    if (eduSection) {
      eduSection.style.display = handler.showEduSettings ? '' : 'none';
    }
  },

  _selectTeamTypeTag(type) {
    const normalizedType = typeof this._normalizeTeamCategory === 'function'
      ? this._normalizeTeamCategory(type)
      : (type === 'none' ? 'none' : (type === 'education' ? 'education' : 'competitive'));
    this._onTeamTypeChange(normalizedType);
  },

  /**
   * 開啟俱樂部類型選擇畫面
   */
  _showTeamTypeSelect() {
    if (!this._canCreateTeamByPermission()) {
      this.showToast('目前未開啟建立俱樂部權限');
      return;
    }
    this._pendingTeamCreateType = 'competitive';
    this.showTeamForm(null);
  },

  /**
   * 選擇類型後進入新增表單
   */
  _selectTeamCreateType(type) {
    this.closeModal();
    this._pendingTeamCreateType = typeof this._normalizeTeamCategory === 'function'
      ? this._normalizeTeamCategory(type)
      : (type === 'none' ? 'none' : (type === 'education' ? 'education' : 'competitive'));
    this.showTeamForm(null);
  },

  _getCurrentUserName() {
    const user = ApiService.getCurrentUser();
    return user ? user.displayName : '';
  },

  _getCurrentUserUid() {
    const user = ApiService.getCurrentUser();
    return user ? user.uid : '';
  },

  _initTeamSportOptions() {
    const sel = document.getElementById('ct-team-sport-tag');
    if (!sel || sel.dataset.inited) return;
    sel.dataset.inited = '1';
    (Array.isArray(EVENT_SPORT_OPTIONS) ? EVENT_SPORT_OPTIONS : []).forEach(item => {
      const emoji = (typeof SPORT_ICON_EMOJI !== 'undefined' ? SPORT_ICON_EMOJI[item.key] : '') || '';
      const opt = document.createElement('option');
      opt.value = item.key;
      opt.textContent = emoji ? emoji + ' ' + item.label : item.label;
      sel.appendChild(opt);
    });
  },

  // _initTeamListSportFilter → 已搬至 team-list-render.js

  // ── 地區 typeahead（必填、限定 TW_REGIONS 22 縣市）──
  _onTeamRegionFocus() {
    this._renderTeamRegionSuggest('');
  },

  _onTeamRegionInput() {
    const val = (document.getElementById('ct-team-region')?.value || '').trim();
    this._renderTeamRegionSuggest(val);
  },

  _onTeamRegionBlur() {
    // 延遲關閉、讓 onmousedown 來得及觸發 _selectTeamRegion
    setTimeout(() => {
      const sug = document.getElementById('ct-team-region-suggest');
      if (sug) sug.classList.remove('show');
    }, 200);
  },

  _renderTeamRegionSuggest(query) {
    const sug = document.getElementById('ct-team-region-suggest');
    if (!sug) return;
    // 2026-04-25：改用共用 filterTwRegions（fuzzy match + 含「其他」、與 first-login / 個人資料一致）
    const matches = (typeof filterTwRegions === 'function') ? filterTwRegions(query, true) : [];
    if (matches.length === 0) {
      sug.classList.remove('show');
      return;
    }
    sug.innerHTML = matches.map(r =>
      `<div class="team-user-suggest-item" onmousedown="event.preventDefault();App._selectTeamRegion('${escapeHTML(r)}')"><span class="tus-name">${escapeHTML(r)}</span></div>`
    ).join('');
    sug.classList.add('show');
  },

  _selectTeamRegion(region) {
    const input = document.getElementById('ct-team-region');
    if (input) input.value = region;
    const sug = document.getElementById('ct-team-region-suggest');
    if (sug) sug.classList.remove('show');
  },

  showTeamForm(id) {
    // v8 M1：建立俱樂部前先擋未登入（避免用戶填完表單才被踢）
    if (!id && this._requireProtectedActionLogin?.({ type: 'createTeam' }, { suppressToast: true })) return;
    if (!id && typeof this._canCreateTeamByPermission === 'function' && !this._canCreateTeamByPermission()) {
      this.showToast('目前未開啟建立俱樂部權限');
      return;
    }
    if (id) {
      const targetTeam = ApiService.getTeam(id);
      if (!targetTeam) return;
      if (typeof this._canEditTeamByRoleOrCaptain === 'function' && !this._canEditTeamByRoleOrCaptain(targetTeam)) {
        this.showToast('您沒有編輯此俱樂部的權限');
        return;
      }
    }
    this._teamFormState.editId = id || null;
    this._teamImageVariantsData = null;
    this._initTeamSportOptions();
    const titleEl = document.getElementById('ct-team-modal-title');
    const saveBtn = document.getElementById('ct-team-save-btn');
    const captainDisplay = document.getElementById('ct-captain-display');
    const captainTransfer = document.getElementById('ct-captain-transfer');

    if (id) {
      const t = ApiService.getTeam(id);
      if (!t) return;
      titleEl.textContent = '編輯俱樂部';
      saveBtn.textContent = '儲存變更';
      document.getElementById('ct-team-name').value = t.name || '';
      document.getElementById('ct-team-name-en').value = t.nameEn || '';
      document.getElementById('ct-team-nationality').value = t.nationality || '';
      document.getElementById('ct-team-region').value = t.region || '';
      document.getElementById('ct-team-founded').value = t.founded || '';
      document.getElementById('ct-team-contact').value = t.contact || '';
      this._setTeamContactLinksFormData?.(!!t.contactLinksEnabled, t.contactLinks || []);
      document.getElementById('ct-team-bio').value = t.bio || '';

      // 編輯模式：載入運動類型
      const sportSel = document.getElementById('ct-team-sport-tag');
      if (sportSel) sportSel.value = t.sportTag || '';
      // 編輯模式：載入俱樂部類型（隱藏欄位 + 顯示標籤）
      const selectedType = typeof this._getTeamCategoryMeta === 'function'
        ? this._getTeamCategoryMeta(t)?.key
        : (t.type === 'none' ? 'none' : (t.type === 'education' ? 'education' : 'competitive'));
      const typeInput = document.getElementById('ct-team-type');
      if (typeInput) typeInput.value = selectedType || 'competitive';
      this._onTeamTypeChange(selectedType || 'competitive');
      const typeDisplay = document.getElementById('ct-team-type-display');
      if (typeDisplay) typeDisplay.style.display = 'none';
      // 教育型設定
      const acceptToggle = document.getElementById('ct-edu-accepting');
      if (acceptToggle) {
        acceptToggle.checked = !t.eduSettings || t.eduSettings.acceptingStudents !== false;
      }

      // 編輯模式：載入已有領隊（複數）
      const users = ApiService.getAdminUsers();
      this._teamFormState.leaders = [];
      document.getElementById('ct-leader-search').value = '';
      document.getElementById('ct-leader-suggest').innerHTML = '';
      document.getElementById('ct-leader-suggest').classList.remove('show');
      const existingLeaderUids = t.leaderUids || (t.leaderUid ? [t.leaderUid] : []);
      existingLeaderUids.forEach(lUid => {
        const found = users.find(u => u.uid === lUid || u._docId === lUid);
        if (found) {
          this._teamFormState.leaders.push(found.uid);
        }
      });
      // 若只有 leader 名稱無 uid，嘗試反查
      if (this._teamFormState.leaders.length === 0 && t.leader) {
        const found = users.find(u => u.name === t.leader || u.displayName === t.leader);
        if (found) this._teamFormState.leaders.push(found.uid);
      }
      this._renderLeaderTags();

      // 編輯模式：俱樂部經理欄位，僅經理本人或 admin 可轉移
      const me = ApiService.getCurrentUser();
      const isAdmin = this.hasPermission('team.manage_all');
      const canTransferCaptain = isAdmin || (me && me.uid === t.captainUid);
      captainDisplay.style.display = '';
      captainDisplay.innerHTML = `目前俱樂部經理：<span style="color:var(--accent)">${escapeHTML(t.captain || '（未設定）')}</span>`;
      captainTransfer.style.display = canTransferCaptain ? '' : 'none';
      document.getElementById('ct-captain-locked').style.display = canTransferCaptain ? 'none' : '';
      const captainHint = captainTransfer.querySelector('.ct-captain-hint');
      if (captainHint) captainHint.style.display = '';

      // 預設保留原經理
      this._teamFormState.captain = null;
      document.getElementById('ct-captain-search').value = '';
      document.getElementById('ct-captain-selected').innerHTML = '';
      if (t.captain) {
        const found = users.find(u => u.name === t.captain);
        this._teamFormState.captain = found ? found.uid : null;
      }

      // Restore coaches
      this._teamFormState.coaches = [];
      document.getElementById('ct-coach-search').value = '';
      document.getElementById('ct-coach-tags').innerHTML = '';
      if (t.coaches && t.coaches.length) {
        t.coaches.forEach(cName => {
          const found = users.find(u => u.name === cName);
          if (found) {
            this.selectTeamCoach(found.uid);
          }
        });
      }

      const preview = document.getElementById('ct-team-preview');
      const previewImage = this._getTeamImageUrl?.(t, 'cover') || t.image;
      if (previewImage) {
        preview.innerHTML = '';
        preview.style.backgroundImage = `url(${previewImage})`;
        preview.style.backgroundSize = 'cover';
        preview.style.backgroundPosition = 'center';
        preview.classList.add('has-image');
      } else {
        preview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">\u4e0a\u50b3\u4ff1\u6a02\u90e8\u5716\u7247</span><span class="ce-upload-hint">\u4e00\u5f35\u539f\u5716\u88c1\u5207\u5c01\u9762 800 x 300 \u8207\u5361\u7247 800 x 800</span>';
        preview.style.backgroundImage = '';
        preview.classList.remove('has-image');
      }
    } else {
      // 新增模式：自動填入當前用戶為俱樂部經理，鎖定不可更改
      const selectedType = typeof this._normalizeTeamCategory === 'function'
        ? this._normalizeTeamCategory(this._pendingTeamCreateType || 'competitive')
        : (this._pendingTeamCreateType === 'none' ? 'none' : (this._pendingTeamCreateType === 'education' ? 'education' : 'competitive'));
      this._pendingTeamCreateType = null;
      titleEl.textContent = '新增俱樂部';
      saveBtn.textContent = '建立俱樂部';
      this._resetTeamForm();
      // 設定類型
      const typeInput = document.getElementById('ct-team-type');
      if (typeInput) typeInput.value = selectedType;
      this._onTeamTypeChange(selectedType);
      const typeDisplay = document.getElementById('ct-team-type-display');
      if (typeDisplay) typeDisplay.style.display = 'none';

      // 自動設定創立者為俱樂部經理
      const me = ApiService.getCurrentUser();
      if (me) {
        this._teamFormState.captain = me.uid;
        captainDisplay.style.display = '';
        captainDisplay.innerHTML = `俱樂部經理（創立者）：<span style="color:var(--accent)">${escapeHTML(me.displayName || me.name || '')}</span>`;
        captainTransfer.style.display = 'none';
        document.getElementById('ct-captain-locked').style.display = '';
        document.getElementById('ct-captain-locked').textContent = '（創立者自動成為俱樂部經理）';
      } else {
        captainDisplay.style.display = 'none';
        captainTransfer.style.display = '';
        document.getElementById('ct-captain-locked').style.display = 'none';
        this._teamFormState.captain = null;
      }
    }
    this.bindTeamContactLinksToggle?.();
    this.showModal('create-team-modal');
  },

});
