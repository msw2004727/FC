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
    this._teamLeaderUids = [];
    this._teamCaptainUid = null;
    this._teamCoachUids = [];
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
    const eduSection = document.getElementById('ct-edu-settings');
    if (eduSection) {
      eduSection.style.display = type === 'education' ? '' : 'none';
    }
  },

  _getCurrentUserName() {
    if (ModeManager.isDemo()) return DemoData.currentUser.displayName;
    const user = ApiService.getCurrentUser();
    return user ? user.displayName : '';
  },

  _getCurrentUserUid() {
    if (ModeManager.isDemo()) return DemoData.currentUser.uid;
    const user = ApiService.getCurrentUser();
    return user ? user.uid : '';
  },

  showTeamForm(id) {
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
    this._teamEditId = id || null;
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

      // 編輯模式：載入俱樂部類型
      const typeSelect = document.getElementById('ct-team-type');
      if (typeSelect) {
        typeSelect.value = t.type || 'general';
        this._onTeamTypeChange(t.type || 'general');
      }
      // 教育型設定
      const acceptToggle = document.getElementById('ct-edu-accepting');
      if (acceptToggle && t.eduSettings) {
        acceptToggle.checked = t.eduSettings.acceptingStudents !== false;
      }

      // 編輯模式：載入已有領隊（複數）
      const users = ApiService.getAdminUsers();
      this._teamLeaderUids = [];
      document.getElementById('ct-leader-search').value = '';
      document.getElementById('ct-leader-suggest').innerHTML = '';
      document.getElementById('ct-leader-suggest').classList.remove('show');
      const existingLeaderUids = t.leaderUids || (t.leaderUid ? [t.leaderUid] : []);
      existingLeaderUids.forEach(lUid => {
        const found = users.find(u => u.uid === lUid || u._docId === lUid);
        if (found) {
          this._teamLeaderUids.push(found.uid);
        } else if (lUid) {
          this._teamLeaderUids.push('__legacy__' + lUid);
        }
      });
      // 若只有 leader 名稱無 uid，嘗試反查
      if (this._teamLeaderUids.length === 0 && t.leader) {
        const found = users.find(u => u.name === t.leader || u.displayName === t.leader);
        this._teamLeaderUids.push(found ? found.uid : '__legacy__' + t.leader);
      }
      this._renderLeaderTags();

      // 編輯模式：俱樂部經理欄位，僅經理本人或 admin 可轉移
      const me = ApiService.getCurrentUser();
      const isAdmin = me && (ROLE_LEVEL_MAP[me.role] || 0) >= ROLE_LEVEL_MAP['admin'];
      const canTransferCaptain = isAdmin || (me && me.uid === t.captainUid);
      captainDisplay.style.display = '';
      captainDisplay.innerHTML = `目前俱樂部經理：<span style="color:var(--accent)">${escapeHTML(t.captain || '（未設定）')}</span>`;
      captainTransfer.style.display = canTransferCaptain ? '' : 'none';
      document.getElementById('ct-captain-locked').style.display = canTransferCaptain ? 'none' : '';
      const captainHint = captainTransfer.querySelector('.ct-captain-hint');
      if (captainHint) captainHint.style.display = '';

      // 預設保留原經理
      this._teamCaptainUid = null;
      document.getElementById('ct-captain-search').value = '';
      document.getElementById('ct-captain-selected').innerHTML = '';
      if (t.captain) {
        const found = users.find(u => u.name === t.captain);
        this._teamCaptainUid = found ? found.uid : '__legacy__';
      }

      // Restore coaches
      this._teamCoachUids = [];
      document.getElementById('ct-coach-search').value = '';
      document.getElementById('ct-coach-tags').innerHTML = '';
      if (t.coaches && t.coaches.length) {
        t.coaches.forEach(cName => {
          const found = users.find(u => u.name === cName);
          if (found) {
            this.selectTeamCoach(found.uid);
          } else {
            this._teamCoachUids.push('__legacy_' + cName);
            this._renderCoachTags();
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
      titleEl.textContent = '新增俱樂部';
      saveBtn.textContent = '建立俱樂部';
      this._resetTeamForm();
      // 新增模式預設一般型
      const typeSelectNew = document.getElementById('ct-team-type');
      if (typeSelectNew) typeSelectNew.value = 'general';

      // 自動設定創立者為俱樂部經理
      const me = ApiService.getCurrentUser();
      if (me) {
        this._teamCaptainUid = me.uid;
        captainDisplay.style.display = '';
        captainDisplay.innerHTML = `俱樂部經理（創立者）：<span style="color:var(--accent)">${escapeHTML(me.displayName || me.name || '')}</span>`;
        captainTransfer.style.display = 'none';
        document.getElementById('ct-captain-locked').style.display = '';
        document.getElementById('ct-captain-locked').textContent = '（創立者自動成為俱樂部經理）';
      } else {
        captainDisplay.style.display = 'none';
        captainTransfer.style.display = '';
        document.getElementById('ct-captain-locked').style.display = 'none';
        this._teamCaptainUid = null;
      }
    }
    this.showModal('create-team-modal');
  },

});
