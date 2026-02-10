/* ================================================
   SportHub — Profile, LINE Login, Titles, User Card
   ================================================ */

Object.assign(App, {

  _pendingFirstLogin: false,

  _userTag(name, forceRole) {
    const role = forceRole || ApiService.getUserRole(name);
    return `<span class="user-capsule uc-${role}" onclick="App.showUserProfile('${name}')" title="${ROLES[role]?.label || '一般用戶'}">${name}</span>`;
  },

  showUserProfile(name) {
    const role = ApiService.getUserRole(name);
    const roleInfo = ROLES[role];
    const badges = ApiService.getBadges();
    const achievements = ApiService.getAchievements();
    const earned = badges.filter(b => {
      const ach = achievements.find(a => a.id === b.achId);
      return ach && ach.current >= ach.target;
    });
    const catColors = { gold: '#d4a017', silver: '#9ca3af', bronze: '#b87333' };
    document.querySelector('#page-user-card .page-header h2').textContent = '用戶資料卡片';
    document.getElementById('user-card-full').innerHTML = `
      <div class="uc-header">
        <div class="uc-visual-row">
          <div class="uc-avatar-circle">${name.charAt(0)}</div>
          <div class="uc-doll-frame">紙娃娃預留</div>
        </div>
        <div class="profile-title">${name}</div>
        <div style="margin-top:.2rem;font-size:.75rem;color:${roleInfo.color};font-weight:600">${roleInfo.label}</div>
        <div class="profile-level">
          <span>Lv.${Math.floor(Math.random()*30)+1}</span>
          <div class="exp-bar"><div class="exp-fill" style="width:${Math.floor(Math.random()*100)}%"></div></div>
        </div>
      </div>
      <div class="info-card">
        <div class="info-title">基本資料</div>
        <div class="info-row"><span>性別</span><span>${Math.random()>.5?'男':'女'}</span></div>
        <div class="info-row"><span>地區</span><span>台北市</span></div>
        <div class="info-row"><span>所屬球隊</span><span>雷霆隊</span></div>
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
    document.querySelectorAll('.contact-row').forEach(el => {
      el.style.display = level >= 1 ? 'flex' : 'none';
    });
  },

  renderProfileData() {
    const el = (id) => document.getElementById(id);
    const v = (val) => val || '-';

    if (ModeManager.isDemo()) {
      // Demo 模式：從 DemoData.currentUser 帶入
      const user = ApiService.getCurrentUser();
      if (!user) return;
      if (el('profile-avatar')) { el('profile-avatar').className = 'profile-avatar'; el('profile-avatar').innerHTML = (user.displayName || '麥').charAt(0); }
      if (el('profile-title')) el('profile-title').textContent = this._buildTitleDisplay(user);
      const level = user.level || 1, exp = user.exp || 0, nextExp = (level + 1) * 200;
      if (el('profile-lv')) el('profile-lv').textContent = `Lv.${level}`;
      if (el('profile-exp-text')) el('profile-exp-text').textContent = `${exp} / ${nextExp}`;
      if (el('profile-exp-fill')) el('profile-exp-fill').style.width = `${Math.min(100, Math.round((exp / nextExp) * 100))}%`;
      if (el('profile-stat-total')) el('profile-stat-total').textContent = user.totalGames || 0;
      if (el('profile-stat-done')) el('profile-stat-done').textContent = user.completedGames || 0;
      if (el('profile-stat-rate')) el('profile-stat-rate').textContent = user.attendanceRate ? `${user.attendanceRate}%` : '0%';
      if (el('profile-stat-badges')) el('profile-stat-badges').textContent = user.badgeCount || 0;
      if (el('profile-gender')) el('profile-gender').textContent = v(user.gender);
      if (el('profile-birthday')) el('profile-birthday').textContent = v(user.birthday);
      if (el('profile-region')) el('profile-region').textContent = v(user.region);
      if (el('profile-sports')) el('profile-sports').textContent = v(user.sports);
      if (el('profile-team')) el('profile-team').textContent = v(user.teamName);
      if (el('profile-phone')) el('profile-phone').textContent = v(user.phone);
      return;
    }

    // 正式版：從 Firebase 用戶資料帶入
    const user = ApiService.getCurrentUser();
    if (!user) return;

    // 暱稱：LINE API displayName + 資料庫稱號
    const lineProfile = (typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn()) ? LineAuth.getProfile() : null;
    const lineName = (lineProfile && lineProfile.displayName) ? lineProfile.displayName : user.displayName;
    const titleDisplay = this._buildTitleDisplay(user, lineName);
    if (el('profile-title')) el('profile-title').textContent = titleDisplay;

    // 頭像：使用 LINE 頭像
    if (el('profile-avatar')) {
      const pic = lineProfile && lineProfile.pictureUrl;
      if (pic) {
        el('profile-avatar').className = 'profile-avatar profile-avatar-img';
        el('profile-avatar').innerHTML = `<img src="${pic}" alt="">`;
      } else {
        el('profile-avatar').className = 'profile-avatar';
        el('profile-avatar').innerHTML = lineName ? lineName.charAt(0) : '?';
      }
    }

    // 等級 & 經驗值
    const level = user.level || 1;
    const exp = user.exp || 0;
    const nextExp = (level + 1) * 200;
    if (el('profile-lv')) el('profile-lv').textContent = `Lv.${level}`;
    if (el('profile-exp-text')) el('profile-exp-text').textContent = `${exp} / ${nextExp}`;
    if (el('profile-exp-fill')) {
      el('profile-exp-fill').style.width = `${Math.min(100, Math.round((exp / nextExp) * 100))}%`;
    }

    // 統計數據
    if (el('profile-stat-total')) el('profile-stat-total').textContent = user.totalGames || 0;
    if (el('profile-stat-done')) el('profile-stat-done').textContent = user.completedGames || 0;
    if (el('profile-stat-rate')) el('profile-stat-rate').textContent = user.attendanceRate ? `${user.attendanceRate}%` : '0%';
    if (el('profile-stat-badges')) el('profile-stat-badges').textContent = user.badgeCount || 0;

    // 我的資料
    if (el('profile-gender')) el('profile-gender').textContent = v(user.gender);
    if (el('profile-birthday')) el('profile-birthday').textContent = v(user.birthday);
    if (el('profile-region')) el('profile-region').textContent = v(user.region);
    if (el('profile-sports')) el('profile-sports').textContent = v(user.sports);
    if (el('profile-team')) el('profile-team').textContent = v(user.teamName);
    if (el('profile-phone')) el('profile-phone').textContent = v(user.phone);
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
    const badges = ApiService.getBadges();
    const achievements = ApiService.getAchievements();
    const earned = badges.filter(b => {
      const ach = achievements.find(a => a.id === b.achId);
      return ach && ach.current >= ach.target;
    });
    const teamName = this._userTeam ? (ApiService.getTeam(this._userTeam)?.name || '—') : '無';
    container.innerHTML = `
      <div class="uc-header">
        <div class="uc-visual-row">
          <div class="uc-avatar-circle">王</div>
          <div class="uc-doll-frame">紙娃娃預留</div>
        </div>
        <div class="profile-title">全勤.王小明</div>
        <div style="margin-top:.3rem">${this._userTag('王小明')}</div>
        <div class="profile-level">
          <span>Lv.10</span>
          <div class="exp-bar"><div class="exp-fill" style="width:40%"></div></div>
          <span class="exp-text">800/2000</span>
        </div>
      </div>
      <div class="info-card">
        <div class="info-title">基本資料</div>
        <div class="info-row"><span>性別</span><span>男</span></div>
        <div class="info-row"><span>生日</span><span>2000/05/20</span></div>
        <div class="info-row"><span>地區</span><span>台北市</span></div>
        <div class="info-row"><span>運動類別</span><span>足球</span></div>
        <div class="info-row"><span>所屬球隊</span><span>${teamName}</span></div>
      </div>
      <div class="info-card">
        <div class="info-title">已獲得徽章</div>
        ${earned.length ? `<div class="uc-badge-list">${earned.map(b => {
          const color = this._catColors[b.category] || this._catColors.bronze;
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
