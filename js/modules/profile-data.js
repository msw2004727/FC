/* ================================================
   SportHub — Profile: Data Rendering & Titles
   依賴：profile-core.js
   ================================================ */
Object.assign(App, {

  _getUserTeamHtml(user) {
    const teams = ApiService.getTeams();
    const userName = user.displayName || user.name;
    const teamSet = new Map();
    // 用戶自身的 teamId
    if (user.teamId) {
      teamSet.set(user.teamId, user.teamName || '球隊');
    }
    // 檢查是否為任何球隊的領隊
    teams.forEach(t => {
      if (t.captain === userName && !teamSet.has(t.id)) {
        teamSet.set(t.id, t.name);
      }
    });
    if (teamSet.size === 0) return '無';
    return Array.from(teamSet.entries()).map(([id, name]) =>
      `<span class="uc-team-link" onclick="App.showTeamDetail('${escapeHTML(id)}')">${escapeHTML(name)}</span>`
    ).join('、');
  },

  renderProfileData() {
    const el = (id) => document.getElementById(id);
    const v = (val) => val || '-';
    const user = ApiService.getCurrentUser();
    if (!user) return;

    const lineProfile = (!ModeManager.isDemo() && typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn()) ? LineAuth.getProfile() : null;
    const lineName = (lineProfile && lineProfile.displayName) || user.displayName;
    const pic = (lineProfile && lineProfile.pictureUrl) || user.pictureUrl || null;

    // 頭像
    if (el('profile-avatar')) {
      if (pic) {
        el('profile-avatar').className = 'profile-avatar profile-avatar-img';
        el('profile-avatar').innerHTML = `<img src="${pic}" alt="">`;
      } else {
        el('profile-avatar').className = 'profile-avatar';
        el('profile-avatar').innerHTML = (lineName || '?').charAt(0);
      }
    }

    // 稱號
    const titleDisplay = this._buildTitleDisplay(user, lineProfile ? lineProfile.displayName : null);
    if (el('profile-title')) el('profile-title').textContent = titleDisplay;

    // UID 顯示 + 迷你 QR 按鈕
    const uidWrap = el('profile-uid-wrap');
    if (uidWrap) {
      const uid = user.uid || user.lineUserId || '-';
      uidWrap.innerHTML = `<span style="font-size:.72rem;color:var(--text-muted);letter-spacing:.3px">${escapeHTML(uid)}</span>`
        + `<button onclick="App.showUidQrCode()" style="background:none;border:none;cursor:pointer;padding:2px;display:flex;align-items:center" title="顯示 UID QR Code">`
        + `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="3" height="3"/><line x1="21" y1="14" x2="21" y2="17"/><line x1="17" y1="21" x2="21" y2="21"/></svg>`
        + `</button>`;
    }

    // 角色膠囊
    const roleTagWrap = el('profile-role-tag-wrap');
    if (roleTagWrap) {
      const role = user.role || 'user';
      const roleInfo = ROLES[role] || ROLES.user;
      roleTagWrap.innerHTML = `<span class="uc-role-tag" style="background:${roleInfo.color}22;color:${roleInfo.color}">${roleInfo.label}</span>`;
    }

    // 等級 & 經驗值（由累計積分推算）
    const totalExp = user.exp || 0;
    const { level, progress, needed } = this._calcLevelFromExp(totalExp);
    if (el('profile-lv')) el('profile-lv').textContent = `Lv.${level}`;
    if (el('profile-exp-text')) el('profile-exp-text').textContent = `${progress.toLocaleString()} / ${needed.toLocaleString()}`;
    if (el('profile-exp-fill')) el('profile-exp-fill').style.width = `${Math.min(100, Math.round((progress / needed) * 100))}%`;

    // 統計數據
    if (el('profile-stat-total')) el('profile-stat-total').textContent = user.totalGames || 0;
    if (el('profile-stat-done')) el('profile-stat-done').textContent = user.completedGames || 0;
    if (el('profile-stat-rate')) el('profile-stat-rate').textContent = user.attendanceRate ? `${user.attendanceRate}%` : '0%';
    if (el('profile-stat-badges')) el('profile-stat-badges').textContent = user.badgeCount || 0;

    // 我的資料（顯示模式）
    if (el('profile-gender')) el('profile-gender').textContent = v(user.gender);
    if (el('profile-birthday')) el('profile-birthday').textContent = v(user.birthday);
    if (el('profile-region')) el('profile-region').textContent = v(user.region);
    if (el('profile-sports')) el('profile-sports').textContent = v(user.sports);
    if (el('profile-phone')) el('profile-phone').textContent = v(user.phone);

    // 所屬球隊（含領隊球隊，可點擊）
    const teamEl = el('profile-team');
    if (teamEl) teamEl.innerHTML = this._getUserTeamHtml(user);

    // 社群連結
    this.renderSocialLinks(user);

    // 編輯模式的靜態欄位
    if (el('profile-gender-display')) el('profile-gender-display').textContent = v(user.gender);
    if (el('profile-sports-display')) el('profile-sports-display').textContent = v(user.sports);
    if (el('profile-team-display')) el('profile-team-display').innerHTML = this._getUserTeamHtml(user);
  },

  toggleProfileEdit() {
    const display = document.getElementById('profile-info-display');
    const edit = document.getElementById('profile-info-edit');
    const btn = document.getElementById('profile-edit-btn');
    if (!display || !edit) return;
    const isEditing = edit.style.display !== 'none';
    if (isEditing) {
      // 關閉編輯
      display.style.display = '';
      edit.style.display = 'none';
      if (btn) btn.textContent = '編輯';
    } else {
      // 開啟編輯，預填現有值
      const user = ApiService.getCurrentUser();
      const bdInput = document.getElementById('profile-edit-birthday');
      const regionInput = document.getElementById('profile-edit-region');
      const phoneInput = document.getElementById('profile-edit-phone');
      if (bdInput && user && user.birthday) {
        // 轉換 yyyy/MM/dd → yyyy-MM-dd（date input 格式）
        bdInput.value = user.birthday.replace(/\//g, '-');
      }
      if (regionInput) regionInput.value = (user && user.region) || '';
      if (phoneInput) phoneInput.value = (user && user.phone) || '';
      display.style.display = 'none';
      edit.style.display = '';
      if (btn) btn.textContent = '取消';
    }
  },

  saveProfileInfo() {
    const bdInput = document.getElementById('profile-edit-birthday');
    const regionInput = document.getElementById('profile-edit-region');
    const phoneInput = document.getElementById('profile-edit-phone');
    const updates = {};
    if (bdInput && bdInput.value) {
      // 轉換 yyyy-MM-dd → yyyy/MM/dd
      updates.birthday = bdInput.value.replace(/-/g, '/');
    }
    if (regionInput) updates.region = regionInput.value.trim() || null;
    if (phoneInput) updates.phone = phoneInput.value.trim() || null;
    ApiService.updateCurrentUser(updates);
    this.toggleProfileEdit();
    this.renderProfileData();
    this.showToast('個人資料已更新');
  },

  // 組合稱號顯示：大成就.普通.暱稱
  _buildTitleDisplay(user, overrideName) {
    const parts = [];
    if (user.titleBig) parts.push(user.titleBig);
    if (user.titleNormal) parts.push(user.titleNormal);
    const name = overrideName || user.displayName || '-';
    parts.push(name);
    return parts.join('.');
  },

  // 渲染稱號設定頁
  renderTitlePage() {
    const user = ApiService.getCurrentUser();
    const lineProfile = (!ModeManager.isDemo() && typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn()) ? LineAuth.getProfile() : null;
    const lineName = lineProfile ? lineProfile.displayName : (user ? user.displayName : '-');

    // LINE 暱稱
    const nameInput = document.getElementById('title-line-name');
    if (nameInput) nameInput.value = lineName || '-';

    // 大成就稱號選項：從已完成的成就中取
    const achievements = ApiService.getAchievements();
    const bigTitles = achievements.filter(a => a.category === 'gold' && a.current >= a.target).map(a => a.name);
    const normalTitles = achievements.filter(a => a.category !== 'gold' && a.current >= a.target).map(a => a.name);

    const bigSelect = document.getElementById('title-big');
    const normalSelect = document.getElementById('title-normal');
    if (bigSelect) {
      const cur = user && user.titleBig ? user.titleBig : '';
      bigSelect.innerHTML = '<option value="">（無）</option>' + bigTitles.map(t =>
        `<option value="${t}" ${t === cur ? 'selected' : ''}>${t}</option>`
      ).join('');
    }
    if (normalSelect) {
      const cur = user && user.titleNormal ? user.titleNormal : '';
      normalSelect.innerHTML = '<option value="">（無）</option>' + normalTitles.map(t =>
        `<option value="${t}" ${t === cur ? 'selected' : ''}>${t}</option>`
      ).join('');
    }

    // 即時預覽
    this._updateTitlePreview();
    if (bigSelect && !bigSelect.dataset.bound) {
      bigSelect.dataset.bound = '1';
      bigSelect.addEventListener('change', () => this._updateTitlePreview());
    }
    if (normalSelect && !normalSelect.dataset.bound) {
      normalSelect.dataset.bound = '1';
      normalSelect.addEventListener('change', () => this._updateTitlePreview());
    }
  },

  _updateTitlePreview() {
    const big = document.getElementById('title-big')?.value || '';
    const normal = document.getElementById('title-normal')?.value || '';
    const name = document.getElementById('title-line-name')?.value || '-';
    const parts = [];
    if (big) parts.push(big);
    if (normal) parts.push(normal);
    parts.push(name);
    const preview = document.getElementById('title-preview');
    if (preview) preview.textContent = parts.join('.');
  },

  saveTitles() {
    const titleBig = document.getElementById('title-big')?.value || null;
    const titleNormal = document.getElementById('title-normal')?.value || null;
    ApiService.updateCurrentUser({ titleBig, titleNormal });
    this.renderProfileData();
    this.showToast('稱號已儲存');
  },

  toggleUserMenu() {
    const menu = document.getElementById('user-menu-dropdown');
    if (!menu) return;
    const isOpen = menu.style.display !== 'none';
    menu.style.display = isOpen ? 'none' : '';
    if (!isOpen) {
      // 填入用戶名稱
      const nameEl = document.getElementById('user-menu-name');
      const profile = (typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn()) ? LineAuth.getProfile() : null;
      if (nameEl && profile) nameEl.textContent = profile.displayName;
      // 點擊外部關閉
      setTimeout(() => {
        const close = (e) => {
          if (!menu.contains(e.target) && e.target.id !== 'line-avatar-topbar') {
            menu.style.display = 'none';
            document.removeEventListener('click', close);
          }
        };
        document.addEventListener('click', close);
      }, 0);
    }
  },

  logoutLine() {
    if (typeof LineAuth !== 'undefined') {
      LineAuth.logout();
    }
  },

  saveFirstLoginProfile() {
    const gender = document.getElementById('fl-gender').value;
    const birthday = document.getElementById('fl-birthday').value;
    const region = document.getElementById('fl-region').value;
    if (!gender || !birthday || !region) {
      this.showToast('請填寫所有必填欄位');
      return;
    }
    ApiService.updateCurrentUser({ gender, birthday, region });
    this._pendingFirstLogin = false;
    this.closeModal();
    this.renderProfileData();
    this.showToast('個人資料已儲存');
  },

});
