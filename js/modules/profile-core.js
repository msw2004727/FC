/* ================================================
   SportHub — Profile: Core Helpers & LINE Auth
   依賴：config.js, data.js, api-service.js, line-auth.js
   ================================================ */

Object.assign(App, {

  _pendingFirstLogin: false,

  /**
   * 等級公式：升到 level L 的累計 EXP = 50 * L * (L+1)
   * 每級所需：level N → N+1 需要 (N+1)*100 EXP
   * @param {number} totalExp - 累計總積分
   * @returns {{ level:number, progress:number, needed:number }}
   */
  _calcLevelFromExp(totalExp) {
    if (totalExp <= 0) return { level: 0, progress: 0, needed: 100 };
    let level = Math.floor((-1 + Math.sqrt(1 + 4 * totalExp / 50)) / 2);
    if (level < 0) level = 0;
    if (level > 999) level = 999;
    const baseExp = 50 * level * (level + 1);
    const progress = totalExp - baseExp;
    const needed = (level + 1) * 100;
    return { level, progress, needed };
  },

  updatePointsDisplay() {
    const el = document.getElementById('points-value');
    if (!el) return;
    const isLoggedIn = ModeManager.isDemo() || (typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn());
    if (!isLoggedIn) {
      el.textContent = '-';
      return;
    }
    const user = ApiService.getCurrentUser();
    const exp = (user && user.exp) || 0;
    el.textContent = exp.toLocaleString();
  },

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
      const threshold = ach && ach.condition ? ach.condition.threshold : (ach ? ach.target : 0);
      return ach && ach.current >= (threshold || 1);
    });
    const catColors = { gold: '#d4a017', silver: '#9ca3af', bronze: '#b87333' };

    const totalExp = user ? (user.exp || 0) : 0;
    const { level, progress, needed } = this._calcLevelFromExp(totalExp);
    const expPct = Math.min(100, Math.round((progress / needed) * 100));
    const gender = (user && user.gender) || '-';
    const birthday = (user && user.birthday) || '-';
    const region = (user && user.region) || '-';
    const sports = (user && user.sports) || '-';
    const phone = (user && user.phone) || '-';
    const joinDate = (user && user.joinDate) || '-';
    // 頭像：自己用 LINE 頭像，他人用資料庫 pictureUrl
    const pic = isSelf
      ? ((lineProfile && lineProfile.pictureUrl) || (user && user.pictureUrl))
      : (user && user.pictureUrl);

    const avatarHtml = pic
      ? `<img src="${pic}" alt="${escapeHTML(name)}">`
      : name.charAt(0);
    const teamHtml = user ? this._getUserTeamHtml(user) : '無';

    const cardHeader = document.querySelector('#page-user-card .page-header h2');
    if (cardHeader) cardHeader.textContent = '用戶資料卡片';
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
          <span class="exp-text">${progress.toLocaleString()} / ${needed.toLocaleString()}</span>
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
        <div class="info-row"><span>加入時間</span><span>${escapeHTML(joinDate)}</span></div>
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
          // Trigger 1：歡迎訊息（首次註冊）
          if (user && user._isNewUser) {
            this._sendNotifFromTemplate('welcome', { userName: profile.displayName }, user.uid);
          }
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
});
