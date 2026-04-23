/* ================================================
   SportHub — Team: Form Initialize & Display
   ================================================ */

Object.assign(App, {

  _resetTeamForm() {
    document.getElementById('ct-team-name').value = '';
    document.getElementById('ct-team-name-en').value = '';
    document.getElementById('ct-team-nationality').value = '台灣';
    document.getElementById('ct-team-region').value = '';
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
    document.getElementById('ct-coach-search').value = '';
    document.getElementById('ct-coach-tags').innerHTML = '';
    document.getElementById('ct-coach-suggest').innerHTML = '';
    document.getElementById('ct-coach-suggest').classList.remove('show');
    document.getElementById('ct-team-bio').value = '';
    this._teamFormState.leaders = [];
    this._teamFormState.captain = null;
    this._teamFormState.coaches = [];
    // 運動類型重置
    const sportSelect = document.getElementById('ct-team-sport-tag');
    if (sportSelect) sportSelect.value = '';
    // 俱樂部類型重置
    const typeSelect = document.getElementById('ct-team-type');
    if (typeSelect) typeSelect.value = 'general';
    this._onTeamTypeChange('general');
    const preview = document.getElementById('ct-team-preview');
    preview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳封面圖片</span><span class="ce-upload-hint">建議尺寸 800 × 300 px｜JPG / PNG｜最大 2MB</span>';
    preview.style.backgroundImage = '';
    preview.classList.remove('has-image');
    const fileInput = document.getElementById('ct-team-image');
    if (fileInput) fileInput.value = '';
  },

  /**
   * 俱樂部類型切換時顯示/隱藏教育型專屬欄位
   */
  _onTeamTypeChange(type) {
    const handler = this._getTeamTypeHandler(type);
    const eduSection = document.getElementById('ct-edu-settings');
    if (eduSection) {
      eduSection.style.display = handler.showEduSettings ? '' : 'none';
    }
  },

  /**
   * 開啟俱樂部類型選擇畫面
   */
  _showTeamTypeSelect() {
    if (!this._canCreateTeamByPermission()) {
      this.showToast('目前未開啟建立俱樂部權限');
      return;
    }
    this.showModal('team-type-select-modal');
  },

  /**
   * 選擇類型後進入新增表單
   */
  _selectTeamCreateType(type) {
    this.closeModal();
    this._pendingTeamCreateType = type;
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
      document.getElementById('ct-team-bio').value = t.bio || '';

      // 編輯模式：載入運動類型
      const sportSel = document.getElementById('ct-team-sport-tag');
      if (sportSel) sportSel.value = t.sportTag || '';
      // 編輯模式：載入俱樂部類型（隱藏欄位 + 顯示標籤）
      const typeInput = document.getElementById('ct-team-type');
      if (typeInput) typeInput.value = t.type || 'general';
      this._onTeamTypeChange(t.type || 'general');
      const typeDisplay = document.getElementById('ct-team-type-display');
      const typeLabel = document.getElementById('ct-team-type-label');
      if (typeDisplay && typeLabel) {
        typeDisplay.style.display = '';
        const editType = t.type || 'general';
        typeLabel.textContent = editType === 'education' ? '📚 教學俱樂部' : '⚽ 運動俱樂部';
      }
      // 教育型設定
      const acceptToggle = document.getElementById('ct-edu-accepting');
      if (acceptToggle && t.eduSettings) {
        acceptToggle.checked = t.eduSettings.acceptingStudents !== false;
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
      if (t.image) {
        preview.innerHTML = '';
        preview.style.backgroundImage = `url(${t.image})`;
        preview.style.backgroundSize = 'cover';
        preview.style.backgroundPosition = 'center';
        preview.classList.add('has-image');
      } else {
        preview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳封面圖片</span><span class="ce-upload-hint">建議尺寸 800 × 300 px｜JPG / PNG｜最大 2MB</span>';
        preview.style.backgroundImage = '';
        preview.classList.remove('has-image');
      }
    } else {
      // 新增模式：自動填入當前用戶為俱樂部經理，鎖定不可更改
      const selectedType = this._pendingTeamCreateType || 'general';
      this._pendingTeamCreateType = null;
      titleEl.textContent = selectedType === 'education' ? '新增教學俱樂部' : '新增運動俱樂部';
      saveBtn.textContent = '建立俱樂部';
      this._resetTeamForm();
      // 設定類型
      const typeInput = document.getElementById('ct-team-type');
      if (typeInput) typeInput.value = selectedType;
      this._onTeamTypeChange(selectedType);
      // 顯示類型標籤
      const typeDisplay = document.getElementById('ct-team-type-display');
      const typeLabel = document.getElementById('ct-team-type-label');
      if (typeDisplay && typeLabel) {
        typeDisplay.style.display = '';
        typeLabel.textContent = selectedType === 'education' ? '📚 教學俱樂部' : '⚽ 運動俱樂部';
      }

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
    this.showModal('create-team-modal');
  },

});
