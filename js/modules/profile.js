/* ================================================
   SportHub — Profile, LINE Login, Titles, User Card
   ================================================ */

Object.assign(App, {

  _pendingFirstLogin: false,

  _userTag(name, forceRole) {
    const role = forceRole || ApiService.getUserRole(name);
    return `<span class="user-capsule uc-${role}" onclick="App.showUserProfile('${name}')" title="${ROLES[role]?.label || '一般用戶'}">${name}</span>`;
  },

  _findUserByName(name) {
    const users = ApiService.getAdminUsers();
    return users.find(u => u.name === name) || null;
  },

  showUserProfile(name) {
    // 判斷是否為當前用戶（比對 displayName / name）
    const currentUser = ApiService.getCurrentUser();
    const lineProfile = (!ModeManager.isDemo() && typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn()) ? LineAuth.getProfile() : null;
    const currentName = (lineProfile && lineProfile.displayName) || (currentUser && currentUser.displayName) || '';
    const isSelf = currentUser && (name === currentName || name === currentUser.displayName || name === currentUser.name);

    // 如果是自己，優先用 currentUser + LINE 資料；否則從 adminUsers 查
    const user = isSelf ? currentUser : this._findUserByName(name);
    const role = user ? user.role : ApiService.getUserRole(name);
    const roleInfo = ROLES[role] || ROLES.user;
    const badges = ApiService.getBadges();
    const achievements = ApiService.getAchievements();
    const earned = badges.filter(b => {
      const ach = achievements.find(a => a.id === b.achId);
      return ach && ach.current >= ach.target;
    });
    const catColors = { gold: '#d4a017', silver: '#9ca3af', bronze: '#b87333' };

    const level = user ? (user.level || 1) : 1;
    const exp = user ? (user.exp || 0) : 0;
    const nextExp = (level + 1) * 200;
    const expPct = Math.min(100, Math.round((exp / nextExp) * 100));
    const gender = (user && user.gender) || '-';
    const birthday = (user && user.birthday) || '-';
    const region = (user && user.region) || '-';
    const sports = (user && user.sports) || '-';
    // 頭像：自己用 LINE 頭像，他人用資料庫 pictureUrl
    const pic = isSelf
      ? ((lineProfile && lineProfile.pictureUrl) || (user && user.pictureUrl))
      : (user && user.pictureUrl);

    const avatarHtml = pic
      ? `<img src="${pic}" alt="${name}">`
      : name.charAt(0);
    const teamHtml = user ? this._getUserTeamHtml(user) : '無';

    document.querySelector('#page-user-card .page-header h2').textContent = '用戶資料卡片';
    document.getElementById('user-card-full').innerHTML = `
      <div class="uc-header">
        <div class="uc-visual-row">
          <div class="uc-avatar-circle">${avatarHtml}</div>
          <div class="uc-doll-frame">紙娃娃預留</div>
        </div>
        <div class="profile-title">${name}</div>
        <div style="margin-top:.3rem"><span class="uc-role-tag" style="background:${roleInfo.color}22;color:${roleInfo.color}">${roleInfo.label}</span></div>
        <div class="profile-level">
          <span>Lv.${level}</span>
          <div class="exp-bar"><div class="exp-fill" style="width:${expPct}%"></div></div>
          <span class="exp-text">${exp} / ${nextExp}</span>
        </div>
      </div>
      <div class="info-card">
        <div class="info-title">基本資料</div>
        <div class="info-row"><span>性別</span><span>${gender}</span></div>
        <div class="info-row"><span>生日</span><span>${birthday}</span></div>
        <div class="info-row"><span>地區</span><span>${region}</span></div>
        <div class="info-row"><span>運動類別</span><span>${sports}</span></div>
        <div class="info-row"><span>所屬球隊</span><span>${teamHtml}</span></div>
      </div>
      <div class="info-card">
        <div class="info-title">已獲得徽章</div>
        ${earned.length ? `<div class="uc-badge-list">${earned.map(b => {
          const color = catColors[b.category] || catColors.bronze;
          return `<div class="uc-badge-item">
            <div class="badge-img-placeholder" style="border-color:${color}">${b.image ? `<img src="${b.image}">` : ''}</div>
            <span class="uc-badge-name">${b.name}</span>
          </div>`;
        }).join('')}</div>` : '<div style="font-size:.82rem;color:var(--text-muted)">尚未獲得徽章</div>'}
      </div>
    `;
    this.showPage('page-user-card');
  },

  async bindLineLogin() {
    if (!ModeManager.isDemo() && typeof LineAuth !== 'undefined') {
      await LineAuth.init();
      if (LineAuth.isLoggedIn()) {
        try {
          const user = await ApiService.loginUser(LineAuth.getProfile());
          if (user && (!user.gender || !user.birthday || !user.region)) {
            this._pendingFirstLogin = true;
          }
        } catch (err) {
          console.error('[App] 用戶資料同步失敗:', err);
        }
        // 註冊即時回調：當資料庫用戶資料變更時自動更新 UI
        FirebaseService._onUserChanged = () => {
          this.renderProfileData();
          this.renderLoginUI();
        };
      }
    }
    this.renderLoginUI();
    this.renderProfileData();
    if (this._pendingFirstLogin) {
      this.showModal('first-login-modal');
    }
  },

  renderLoginUI() {
    const roleSwitcher = document.getElementById('role-switcher-wrapper');
    const lineWrapper = document.getElementById('line-login-wrapper');
    const profileAvatar = document.getElementById('profile-avatar');
    const profileContent = document.getElementById('profile-content');
    const loginPrompt = document.getElementById('profile-login-prompt');
    const drawerAvatar = document.getElementById('drawer-avatar');
    const drawerName = document.getElementById('drawer-name');

    if (!roleSwitcher || !lineWrapper) return;

    // ── Demo 模式：隱藏舊角色切換器，用 LINE 區域顯示 Demo 頭像 + 角色選單 ──
    if (ModeManager.isDemo()) {
      roleSwitcher.style.display = 'none';
      lineWrapper.style.display = '';
      const loginBtn = document.getElementById('line-login-btn');
      const userTopbar = document.getElementById('line-user-topbar');
      if (loginBtn) loginBtn.style.display = 'none';
      if (userTopbar) {
        userTopbar.style.display = '';
        userTopbar.innerHTML = `
          <div class="line-avatar-topbar line-avatar-fallback" id="demo-avatar-btn" onclick="App.toggleDemoRoleMenu()">麥</div>
          <div id="demo-role-dropdown" class="user-menu-dropdown demo-role-menu" style="display:none">
            <div class="user-menu-name">切換 Demo 身份</div>
            <div class="user-menu-divider"></div>
            <button class="user-menu-item demo-role-item active" data-role="user" onclick="App.selectDemoRole('user')">一般用戶</button>
            <button class="user-menu-item demo-role-item" data-role="coach" onclick="App.selectDemoRole('coach')">教練</button>
            <button class="user-menu-item demo-role-item" data-role="captain" onclick="App.selectDemoRole('captain')">領隊</button>
            <button class="user-menu-item demo-role-item" data-role="venue_owner" onclick="App.selectDemoRole('venue_owner')">場主</button>
            <button class="user-menu-item demo-role-item" data-role="admin" onclick="App.selectDemoRole('admin')">管理員</button>
            <button class="user-menu-item demo-role-item" data-role="super_admin" onclick="App.selectDemoRole('super_admin')">總管</button>
          </div>`;
      }
      if (drawerAvatar) { drawerAvatar.className = 'drawer-avatar'; drawerAvatar.innerHTML = '麥'; }
      if (drawerName) drawerName.textContent = '冠軍.全勤.小麥';
      if (profileContent) profileContent.style.display = '';
      if (loginPrompt) loginPrompt.style.display = 'none';
      return;
    }

    // ── 正式版：隱藏角色切換器，顯示 LINE ──
    roleSwitcher.style.display = 'none';
    lineWrapper.style.display = '';

    const isLoggedIn = typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn();
    const loginBtn = document.getElementById('line-login-btn');
    const userTopbar = document.getElementById('line-user-topbar');
    const avatarImg = document.getElementById('line-avatar-topbar');

    if (!isLoggedIn) {
      // 未登入
      if (loginBtn) loginBtn.style.display = '';
      if (userTopbar) userTopbar.style.display = 'none';
      if (profileContent) profileContent.style.display = 'none';
      if (loginPrompt) loginPrompt.style.display = '';
      if (drawerAvatar) { drawerAvatar.className = 'drawer-avatar'; drawerAvatar.innerHTML = '?'; }
      if (drawerName) drawerName.textContent = '未登入';
      // 未登入也套用一般用戶抽屜選單
      this.currentRole = 'user';
      const roleTag = document.getElementById('drawer-role-tag');
      if (roleTag) {
        roleTag.textContent = '未登入';
        roleTag.style.background = '#6b728022';
        roleTag.style.color = '#6b7280';
      }
      this.renderDrawerMenu();
      return;
    }

    // 已登入
    const profile = LineAuth.getProfile();
    const currentUser = ApiService.getCurrentUser();
    if (loginBtn) loginBtn.style.display = 'none';
    if (userTopbar) userTopbar.style.display = '';
    if (profile.pictureUrl && avatarImg) {
      avatarImg.src = profile.pictureUrl;
    } else if (userTopbar) {
      const dropdown = document.getElementById('user-menu-dropdown');
      const dropdownHtml = dropdown ? dropdown.outerHTML : '';
      userTopbar.innerHTML = `<div class="line-avatar-topbar line-avatar-fallback" onclick="App.toggleUserMenu()">${profile.displayName.charAt(0)}</div>${dropdownHtml}`;
    }

    // 更新 profile 頁面（資料由 renderProfileData() 統一處理）
    if (profileContent) profileContent.style.display = '';
    if (loginPrompt) loginPrompt.style.display = 'none';

    // 更新 drawer
    if (drawerName) drawerName.textContent = profile.displayName;
    if (drawerAvatar) {
      if (profile.pictureUrl) {
        drawerAvatar.className = 'drawer-avatar drawer-avatar-img';
        drawerAvatar.innerHTML = `<img src="${profile.pictureUrl}" alt="">`;
      } else {
        drawerAvatar.className = 'drawer-avatar';
        drawerAvatar.innerHTML = profile.displayName.charAt(0);
      }
    }

    // 依資料庫角色套用抽屜選單與身份標籤
    const userRole = (currentUser && currentUser.role) ? currentUser.role : 'user';
    this.currentRole = userRole;
    const roleInfo = ROLES[userRole] || ROLES.user;
    const roleTag = document.getElementById('drawer-role-tag');
    if (roleTag) {
      roleTag.textContent = roleInfo.label;
      roleTag.style.background = roleInfo.color + '22';
      roleTag.style.color = roleInfo.color;
    }
    this.renderDrawerMenu();

    // 依角色控制頁面內 data-min-role 元素
    const level = ROLE_LEVEL_MAP[userRole] || 0;
    document.querySelectorAll('[data-min-role]').forEach(el => {
      const minLevel = ROLE_LEVEL_MAP[el.dataset.minRole] || 0;
      el.style.display = level >= minLevel ? '' : 'none';
    });
  },

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
      `<span class="uc-team-link" onclick="App.showTeamDetail('${id}')">${name}</span>`
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

    // 等級 & 經驗值
    const level = user.level || 1, exp = user.exp || 0, nextExp = (level + 1) * 200;
    if (el('profile-lv')) el('profile-lv').textContent = `Lv.${level}`;
    if (el('profile-exp-text')) el('profile-exp-text').textContent = `${exp} / ${nextExp}`;
    if (el('profile-exp-fill')) el('profile-exp-fill').style.width = `${Math.min(100, Math.round((exp / nextExp) * 100))}%`;

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

  renderUserCard() {
    const container = document.getElementById('user-card-full');
    if (!container) return;

    const user = ApiService.getCurrentUser();
    const lineProfile = (!ModeManager.isDemo() && typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn()) ? LineAuth.getProfile() : null;

    const displayName = (lineProfile && lineProfile.displayName) ? lineProfile.displayName : (user ? user.displayName : '-');
    const titleDisplay = user ? this._buildTitleDisplay(user, lineProfile ? lineProfile.displayName : null) : displayName;
    const pic = (lineProfile && lineProfile.pictureUrl) || (user && user.pictureUrl) || null;
    const role = (user && user.role) || 'user';
    const roleInfo = ROLES[role] || ROLES.user;

    const level = user ? (user.level || 1) : 1;
    const exp = user ? (user.exp || 0) : 0;
    const nextExp = (level + 1) * 200;
    const expPct = Math.min(100, Math.round((exp / nextExp) * 100));

    const gender = (user && user.gender) || '-';
    const birthday = (user && user.birthday) || '-';
    const region = (user && user.region) || '-';
    const sports = (user && user.sports) || '-';
    const phone = (user && user.phone) || '-';

    const avatarHtml = pic
      ? `<img src="${pic}" alt="${displayName}">`
      : (displayName || '?').charAt(0);
    const teamHtml = user ? this._getUserTeamHtml(user) : '無';

    const badges = ApiService.getBadges();
    const achievements = ApiService.getAchievements();
    const earned = badges.filter(b => {
      const ach = achievements.find(a => a.id === b.achId);
      return ach && ach.current >= ach.target;
    });
    const catColors = { gold: '#d4a017', silver: '#9ca3af', bronze: '#b87333' };

    container.innerHTML = `
      <div class="uc-header">
        <div class="uc-visual-row">
          <div class="uc-avatar-circle">${avatarHtml}</div>
          <div class="uc-doll-frame">紙娃娃預留</div>
        </div>
        <div class="profile-title">${titleDisplay}</div>
        <div style="margin-top:.3rem"><span class="uc-role-tag" style="background:${roleInfo.color}22;color:${roleInfo.color}">${roleInfo.label}</span></div>
        <div class="profile-level">
          <span>Lv.${level}</span>
          <div class="exp-bar"><div class="exp-fill" style="width:${expPct}%"></div></div>
          <span class="exp-text">${exp} / ${nextExp}</span>
        </div>
      </div>
      <div class="info-card">
        <div class="info-title">基本資料</div>
        <div class="info-row"><span>性別</span><span>${gender}</span></div>
        <div class="info-row"><span>生日</span><span>${birthday}</span></div>
        <div class="info-row"><span>地區</span><span>${region}</span></div>
        <div class="info-row"><span>運動類別</span><span>${sports}</span></div>
        <div class="info-row"><span>所屬球隊</span><span>${teamHtml}</span></div>
        <div class="info-row"><span>聯繫方式</span><span>${phone}</span></div>
      </div>
      <div class="info-card">
        <div class="info-title">已獲得徽章</div>
        ${earned.length ? `<div class="uc-badge-list">${earned.map(b => {
          const color = catColors[b.category] || catColors.bronze;
          return `<div class="uc-badge-item">
            <div class="badge-img-placeholder" style="border-color:${color}">${b.image ? `<img src="${b.image}">` : ''}</div>
            <span class="uc-badge-name">${b.name}</span>
          </div>`;
        }).join('')}</div>` : '<div style="font-size:.82rem;color:var(--text-muted)">尚未獲得徽章</div>'}
      </div>
      <div class="info-card">
        <div class="info-title">交易價值紀錄</div>
        <div style="font-size:.82rem;color:var(--text-muted)">目前無交易紀錄</div>
      </div>
    `;
  },

});
