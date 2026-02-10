/* ================================================
   SportHub — Profile, LINE Login, Titles, User Card
   ================================================ */

Object.assign(App, {

  _pendingFirstLogin: false,

  _userTag(name, forceRole) {
    const role = forceRole || ApiService.getUserRole(name);
    return `<span class="user-capsule uc-${role}" onclick="App.showUserProfile('${escapeHTML(name)}')" title="${ROLES[role]?.label || '一般用戶'}">${escapeHTML(name)}</span>`;
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
      ? `<img src="${pic}" alt="${escapeHTML(name)}">`
      : name.charAt(0);
    const teamHtml = user ? this._getUserTeamHtml(user) : '無';

    document.querySelector('#page-user-card .page-header h2').textContent = '用戶資料卡片';
    document.getElementById('user-card-full').innerHTML = `
      <div class="uc-header">
        <div class="uc-visual-row">
          <div class="uc-avatar-circle">${avatarHtml}</div>
          <div class="uc-doll-frame">紙娃娃預留</div>
        </div>
        <div class="profile-title">${escapeHTML(name)}</div>
        <div style="margin-top:.3rem"><span class="uc-role-tag" style="background:${roleInfo.color}22;color:${roleInfo.color}">${roleInfo.label}</span></div>
        <div class="profile-level">
          <span>Lv.${level}</span>
          <div class="exp-bar"><div class="exp-fill" style="width:${expPct}%"></div></div>
          <span class="exp-text">${exp} / ${nextExp}</span>
        </div>
      </div>
      ${this._buildSocialLinksHtml(user)}
      <div class="info-card">
        <div class="info-title">基本資料</div>
        <div class="info-row"><span>性別</span><span>${escapeHTML(gender)}</span></div>
        <div class="info-row"><span>生日</span><span>${escapeHTML(birthday)}</span></div>
        <div class="info-row"><span>地區</span><span>${escapeHTML(region)}</span></div>
        <div class="info-row"><span>運動類別</span><span>${escapeHTML(sports)}</span></div>
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
      // LIFF 已在 DOMContentLoaded 平行初始化，若尚未完成則等待
      if (!LineAuth._ready) {
        await LineAuth.init();
      }

      console.log('[App] bindLineLogin: LIFF ready=', LineAuth._ready,
        'loggedIn=', LineAuth.isLoggedIn(),
        'initError=', LineAuth._initError?.message || 'none',
        'isDemo=', ModeManager.isDemo());

      // 如果 LIFF 初始化有錯誤且用戶尚未登入，顯示提示
      if (LineAuth._initError && !LineAuth.isLoggedIn()) {
        console.error('[App] LINE 登入初始化異常:', LineAuth._initError);
        this.showToast('LINE 登入異常：' + (LineAuth._initError.message || '請重新嘗試'));
      }

      if (LineAuth.isLoggedIn()) {
        const profile = LineAuth.getProfile();
        console.log('[App] LINE 已登入, userId:', profile.userId, 'name:', profile.displayName);
        try {
          const user = await ApiService.loginUser(profile);
          console.log('[App] createOrUpdateUser 成功:', user?.displayName, 'docId:', user?._docId);
          if (user && (!user.gender || !user.birthday || !user.region)) {
            this._pendingFirstLogin = true;
          }
        } catch (err) {
          console.error('[App] 用戶資料同步失敗:', err.code, err.message, err);
          const code = err?.code || '';
          if (code === 'permission-denied') {
            this.showToast('登入失敗：資料庫權限不足，請聯繫管理員更新 Firestore 規則');
          } else {
            this.showToast('登入失敗：' + (err?.message || '資料同步異常'));
          }
        }
        // 註冊即時回調：當資料庫用戶資料變更時自動更新 UI
        FirebaseService._onUserChanged = () => {
          this.renderProfileData();
          this.renderLoginUI();
          this.renderHotEvents();
          this.renderActivityList();
          this.renderMyActivities();
        };
        // LINE 登入完成後重新渲染活動列表（修正 currentUser 尚未載入的時序問題）
        this.renderHotEvents();
        this.renderActivityList();
        this.renderMyActivities();
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
      userTopbar.innerHTML = `<div class="line-avatar-topbar line-avatar-fallback" onclick="App.toggleUserMenu()">${escapeHTML(profile.displayName.charAt(0))}</div>${dropdownHtml}`;
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
      ? `<img src="${pic}" alt="${escapeHTML(displayName)}">`
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
        <div class="profile-title">${escapeHTML(titleDisplay)}</div>
        <div style="margin-top:.3rem"><span class="uc-role-tag" style="background:${roleInfo.color}22;color:${roleInfo.color}">${roleInfo.label}</span></div>
        <div class="profile-level">
          <span>Lv.${level}</span>
          <div class="exp-bar"><div class="exp-fill" style="width:${expPct}%"></div></div>
          <span class="exp-text">${exp} / ${nextExp}</span>
        </div>
      </div>
      ${this._buildSocialLinksHtml(user)}
      <div class="info-card">
        <div class="info-title">基本資料</div>
        <div class="info-row"><span>性別</span><span>${escapeHTML(gender)}</span></div>
        <div class="info-row"><span>生日</span><span>${escapeHTML(birthday)}</span></div>
        <div class="info-row"><span>地區</span><span>${escapeHTML(region)}</span></div>
        <div class="info-row"><span>運動類別</span><span>${escapeHTML(sports)}</span></div>
        <div class="info-row"><span>所屬球隊</span><span>${teamHtml}</span></div>
        <div class="info-row"><span>聯繫方式</span><span>${escapeHTML(phone)}</span></div>
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

  /**
   * 穩定 QR Code 生成（本地庫優先 → API 圖片備援）
   * @param {HTMLElement} container - 放置 QR Code 的容器
   * @param {string} data - 要編碼的資料（UID）
   * @param {number} size - 尺寸（px）
   */
  _generateQrCode(container, data, size) {
    if (!container || !data || data === 'unknown') {
      if (container) container.innerHTML = '<div style="font-size:.78rem;color:var(--text-muted);padding:1rem">無法生成 QR Code（UID 無效）</div>';
      return;
    }
    container.innerHTML = '';
    // 方案 A：本地 qrcode 庫（canvas）
    if (typeof QRCode !== 'undefined' && QRCode.toCanvas) {
      const canvas = document.createElement('canvas');
      QRCode.toCanvas(canvas, data, { width: size, margin: 1, errorCorrectionLevel: 'H' }, (err) => {
        if (!err) {
          canvas.style.display = 'block';
          container.appendChild(canvas);
        } else {
          console.warn('[QR] 本地生成失敗，切換 API:', err);
          this._qrFallbackImg(container, data, size);
        }
      });
    } else {
      // 方案 B：外部 API 圖片
      console.warn('[QR] qrcode 庫未載入，使用 API 備援');
      this._qrFallbackImg(container, data, size);
    }
  },

  /** QR Code API 備援（純 img 標籤，不依賴任何 JS 庫） */
  _qrFallbackImg(container, data, size) {
    const img = document.createElement('img');
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&ecc=H&data=${encodeURIComponent(data)}`;
    img.width = size;
    img.height = size;
    img.alt = 'QR Code';
    img.style.display = 'block';
    img.onerror = () => {
      container.innerHTML = '<div style="font-size:.78rem;color:var(--text-muted);padding:1rem">QR Code 生成失敗，請檢查網路連線</div>';
    };
    container.appendChild(img);
  },

  /** 渲染「我的 QR Code」頁面 */
  renderQrCodePage() {
    const user = ApiService.getCurrentUser();
    const uid = user?.uid || user?.lineUserId || 'unknown';
    const container = document.getElementById('page-qr-canvas');
    const uidText = document.getElementById('page-qr-uid');
    if (!container) return;
    if (uidText) uidText.textContent = `UID: ${uid}`;
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.justifyContent = 'center';
    this._generateQrCode(container, uid, 160);
  },

  // ── 社群連結相關 ──
  _socialPlatforms: {
    fb:      { name: 'Facebook',    prefix: 'https://www.facebook.com/' },
    ig:      { name: 'Instagram',   prefix: 'https://www.instagram.com/' },
    threads: { name: 'Threads',     prefix: 'https://www.threads.net/@' },
    yt:      { name: 'YouTube',     prefix: 'https://www.youtube.com/@' },
    twitter: { name: 'X (Twitter)', prefix: 'https://x.com/' },
  },

  _currentSocialPlatform: null,

  _buildSocialLinksHtml(user) {
    const links = (user && user.socialLinks) || {};
    const platforms = this._socialPlatforms;
    const svgs = {
      fb: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>',
      ig: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>',
      threads: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.59 12c.025 3.086.718 5.496 2.057 7.164 1.432 1.781 3.632 2.695 6.54 2.717 2.227-.017 4.074-.517 5.49-1.482 1.2-.82 2.12-2.012 2.7-3.508l1.942.672a10.987 10.987 0 01-3.335 4.397C17.165 23.275 14.898 23.98 12.186 24zm4.394-8.858c-.095-1.17-.584-2.098-1.422-2.698-.7-.5-1.6-.775-2.617-.8-.87.02-1.653.26-2.262.687-.66.47-1.065 1.12-1.138 1.822-.078.78.225 1.41.85 1.776.54.313 1.19.48 1.92.49.95-.01 1.82-.32 2.42-.86.44-.39.7-.86.77-1.38.03-.16.04-.32.04-.48v-.01c-.005-.185-.02-.365-.046-.537l-.015-.01zm1.87-1.06c.068.36.113.73.134 1.11.03.52.003 1.04-.084 1.55-.242 1.39-.98 2.56-2.14 3.38-1.15.82-2.54 1.257-4.02 1.267h-.05c-1.12-.01-2.1-.275-2.913-.786-1.125-.706-1.68-1.844-1.54-3.15.12-1.13.747-2.097 1.76-2.72.88-.54 1.96-.837 3.12-.86h.06c.68.01 1.33.11 1.93.29-.16-.6-.48-1.07-.96-1.4-.58-.4-1.32-.61-2.16-.61h-.04c-.96.01-1.79.24-2.46.67l-.96-1.72c.97-.61 2.15-.95 3.44-.97h.06c1.34.02 2.5.4 3.39 1.1.78.62 1.3 1.45 1.55 2.44l.04.17z"/></svg>',
      yt: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>',
      twitter: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
    };
    const active = Object.keys(platforms).filter(k => links[k]);
    if (!active.length) return '';
    const btns = active.map(k => {
      const url = platforms[k].prefix + encodeURIComponent(links[k]);
      return `<a class="social-btn active" data-platform="${k}" href="${url}" target="_blank" rel="noopener" title="${platforms[k].name}: @${escapeHTML(links[k])}">${svgs[k]}</a>`;
    }).join('');
    return `<div class="social-grid" style="margin-bottom:.65rem">${btns}</div>`;
  },

  renderSocialLinks(user) {
    const links = (user && user.socialLinks) || {};
    document.querySelectorAll('.social-btn').forEach(btn => {
      const p = btn.dataset.platform;
      if (links[p]) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  },

  openSocialLinkModal(platform) {
    const info = this._socialPlatforms[platform];
    if (!info) return;
    this._currentSocialPlatform = platform;
    const user = ApiService.getCurrentUser();
    const links = (user && user.socialLinks) || {};
    const currentVal = links[platform] || '';

    document.getElementById('social-modal-title').textContent = `編輯 ${info.name} 連結`;
    document.getElementById('social-modal-label').textContent = `你的 ${info.name} ID`;
    document.getElementById('social-url-prefix').textContent = info.prefix;
    document.getElementById('social-link-input').value = currentVal;
    document.getElementById('social-clear-btn').style.display = currentVal ? '' : 'none';
    this.showModal('social-link-modal');
  },

  saveSocialLink() {
    const platform = this._currentSocialPlatform;
    if (!platform) return;
    const input = document.getElementById('social-link-input');
    const val = (input && input.value) ? input.value.trim() : '';
    const user = ApiService.getCurrentUser();
    const links = Object.assign({}, (user && user.socialLinks) || {});
    links[platform] = val || '';
    ApiService.updateCurrentUser({ socialLinks: links });
    this.closeModal();
    this.renderProfileData();
    this.showToast(val ? '社群連結已儲存' : '社群連結已清除');
  },

  clearSocialLink() {
    const platform = this._currentSocialPlatform;
    if (!platform) return;
    const user = ApiService.getCurrentUser();
    const links = Object.assign({}, (user && user.socialLinks) || {});
    links[platform] = '';
    ApiService.updateCurrentUser({ socialLinks: links });
    this.closeModal();
    this.renderProfileData();
    this.showToast('社群連結已清除');
  },

  /** 顯示 UID 專屬 QR Code 彈窗 */
  showUidQrCode() {
    const user = ApiService.getCurrentUser();
    const uid = user?.uid || user?.lineUserId || 'unknown';
    const modal = document.getElementById('uid-qr-modal');
    const content = document.getElementById('uid-qr-content');
    if (!modal || !content) return;
    content.innerHTML = `
      <div style="font-size:.85rem;font-weight:700;margin-bottom:.8rem">我的 UID QR Code</div>
      <div id="uid-qr-canvas" style="background:#fff;display:inline-block;padding:12px;border-radius:var(--radius)"></div>
      <div style="margin-top:.7rem;font-size:.75rem;color:var(--text-muted);word-break:break-all">${escapeHTML(uid)}</div>
    `;
    this._generateQrCode(document.getElementById('uid-qr-canvas'), uid, 180);
    modal.style.display = 'flex';
  },

});
