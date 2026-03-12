/* ================================================
   SportHub — Profile: Core Helpers & LINE Auth
   依賴：config.js, data.js, api-service.js, line-auth.js
   ================================================ */

Object.assign(App, {

  _pendingFirstLogin: false,
  _brokenAvatarTtlMs: 12 * 60 * 60 * 1000,
  _brokenAvatarUrlsLoaded: false,
  _brokenAvatarUrls: new Set(),
  _brokenAvatarStorageKey: 'sporthub_broken_avatar_urls_v2',

  _ensureBrokenAvatarUrlsLoaded() {
    if (this._brokenAvatarUrlsLoaded) return;
    this._brokenAvatarUrlsLoaded = true;
    try {
      const raw = localStorage.getItem(this._brokenAvatarStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const updatedAt = Number(parsed?.updatedAt || 0);
      if (updatedAt && Date.now() - updatedAt > this._brokenAvatarTtlMs) {
        localStorage.removeItem(this._brokenAvatarStorageKey);
        return;
      }
      const urls = Array.isArray(parsed?.urls) ? parsed.urls : [];
      urls
        .filter(url => typeof url === 'string' && url)
        .slice(0, 200)
        .forEach(url => this._brokenAvatarUrls.add(url));
    } catch (_) {}
  },

  _persistBrokenAvatarUrls() {
    try {
      const urls = Array.from(this._brokenAvatarUrls).slice(-200);
      localStorage.setItem(this._brokenAvatarStorageKey, JSON.stringify({
        updatedAt: Date.now(),
        urls,
      }));
    } catch (_) {}
  },

  _rememberBrokenAvatarUrl(url) {
    if (!url || typeof url !== 'string') return;
    this._ensureBrokenAvatarUrlsLoaded();
    this._brokenAvatarUrls.add(url);
    this._persistBrokenAvatarUrls();
  },

  _isKnownBrokenAvatarUrl(url) {
    if (!url || typeof url !== 'string') return false;
    this._ensureBrokenAvatarUrlsLoaded();
    return this._brokenAvatarUrls.has(url);
  },

  _getAvatarCandidateUrls(...urls) {
    const seen = new Set();
    return urls
      .flat()
      .map(url => (typeof url === 'string' ? url.trim() : ''))
      .filter(url => {
        if (!url || seen.has(url)) return false;
        seen.add(url);
        return true;
      });
  },

  _getRenderableAvatarCandidateUrls(...urls) {
    return this._getAvatarCandidateUrls(...urls)
      .filter(url => !this._isKnownBrokenAvatarUrl(url));
  },

  _getAvatarInitial(name) {
    const text = String(name || '?').trim();
    return escapeHTML(text ? text.charAt(0) : '?');
  },

  _buildAvatarFallbackMarkup(name, fallbackClass = 'profile-avatar') {
    return `<div class="${escapeHTML(fallbackClass)}">${this._getAvatarInitial(name)}</div>`;
  },

  _buildAvatarImageMarkup(url, name, imageClass = '', fallbackClass = 'profile-avatar', extraAttrs = '') {
    const candidateUrl = this._getRenderableAvatarCandidateUrls(url)[0] || null;
    if (!candidateUrl) {
      return this._buildAvatarFallbackMarkup(name, fallbackClass);
    }
    const attrs = extraAttrs ? ` ${extraAttrs}` : '';
    return `<img src="${escapeHTML(candidateUrl)}" class="${escapeHTML(imageClass)}" alt="${escapeHTML(name || 'avatar')}" referrerpolicy="no-referrer" data-avatar-fallback="1" data-avatar-name="${escapeHTML(name || '')}" data-avatar-fallback-class="${escapeHTML(fallbackClass)}"${attrs}>`;
  },

  _bindAvatarFallbacks(root = document) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    root.querySelectorAll('img[data-avatar-fallback="1"]').forEach(img => {
      if (img.dataset.avatarFallbackBound === '1') return;
      img.dataset.avatarFallbackBound = '1';
      const handleBroken = () => {
        if (img.dataset.avatarFallbackDone === '1') return;
        img.dataset.avatarFallbackDone = '1';
        if (img.currentSrc || img.src) {
          this._rememberBrokenAvatarUrl(img.currentSrc || img.src);
        }
        const fallback = document.createElement('div');
        fallback.className = img.dataset.avatarFallbackClass || 'profile-avatar';
        fallback.textContent = (img.dataset.avatarName || '?').trim().charAt(0) || '?';
        img.replaceWith(fallback);
      };
      img.addEventListener('error', handleBroken, { once: true });
      if (img.complete && img.naturalWidth === 0) {
        handleBroken();
      }
    });
  },

  _loadAvatarIntoImage(img, candidateUrls, name, onFallback) {
    if (!img) {
      if (typeof onFallback === 'function') onFallback();
      return;
    }

    const candidates = this._getRenderableAvatarCandidateUrls(candidateUrls);
    if (!candidates.length) {
      if (typeof onFallback === 'function') onFallback();
      return;
    }

    let index = 0;
    const tryNext = () => {
      if (index >= candidates.length) {
        if (typeof onFallback === 'function') onFallback();
        return;
      }

      const nextUrl = candidates[index++];
      const handleBroken = () => {
        if (img.dataset.avatarCurrentUrl !== nextUrl) return;
        this._rememberBrokenAvatarUrl(nextUrl);
        img.removeAttribute('src');
        tryNext();
      };

      img.dataset.avatarCurrentUrl = nextUrl;
      img.alt = name || 'avatar';
      img.referrerPolicy = 'no-referrer';
      img.decoding = 'async';
      img.onerror = handleBroken;
      img.onload = () => {
        if (img.dataset.avatarCurrentUrl !== nextUrl) return;
        img.dataset.avatarLoaded = '1';
      };
      img.removeAttribute('src');
      img.src = nextUrl;

      setTimeout(() => {
        if (img.dataset.avatarCurrentUrl === nextUrl && img.complete && img.naturalWidth === 0) {
          handleBroken();
        }
      }, 0);
    };

    tryNext();
  },

  _setAvatarContent(container, url, name, options = {}) {
    if (!container) return;
    const fallbackClass = options.fallbackClass || container.className || 'profile-avatar';
    const imageClass = options.imageClass || '';
    const candidateUrls = this._getAvatarCandidateUrls(options.candidateUrls || url);
    if (!candidateUrls.length) {
      container.className = fallbackClass;
      container.innerHTML = this._getAvatarInitial(name);
      return;
    }
    container.className = options.containerImageClass || fallbackClass;
    container.innerHTML = '';
    const img = document.createElement('img');
    if (imageClass) img.className = imageClass;
    container.appendChild(img);
    this._loadAvatarIntoImage(img, candidateUrls, name, () => {
      container.className = fallbackClass;
      container.innerHTML = this._getAvatarInitial(name);
    });
  },

  _setTopbarAvatar(userTopbar, avatarImg, profile, options = {}) {
    if (!userTopbar) return;
    const displayName = profile?.displayName || '?';
    const candidateUrls = this._getAvatarCandidateUrls(options.candidateUrls || profile?.pictureUrl);
    const applyFallback = () => {
      const dropdown = document.getElementById('user-menu-dropdown');
      const dropdownHtml = dropdown ? dropdown.outerHTML : '';
      userTopbar.innerHTML = `<div class="line-avatar-topbar line-avatar-fallback" onclick="App.toggleUserMenu()">${this._getAvatarInitial(displayName)}</div>${dropdownHtml}`;
    };

    if (!avatarImg || !candidateUrls.length) {
      applyFallback();
      return;
    }

    this._loadAvatarIntoImage(avatarImg, candidateUrls, displayName, applyFallback);
  },

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
    const isLoggedIn = (typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn());
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
    const achievementStats = this._getAchievementStats?.();
    const earned = achievementStats?.getEarnedBadgeViewModels?.(
      ApiService.getAchievements(),
      ApiService.getBadges()
    ) || [];

    const totalExp = user ? (user.exp || 0) : 0;
    const { level, progress, needed } = this._calcLevelFromExp(totalExp);
    const expPct = Math.min(100, Math.round((progress / needed) * 100));
    const gender = (user && user.gender) || '-';
    const birthday = (user && user.birthday) || '-';
    const region = (user && user.region) || '-';
    const sports = (user && user.sports) || '-';
    const phone = (user && user.phone) || '-';
    const _ca = user && user.createdAt;
    const joinDate = _ca
      ? (() => { const d = (_ca.toDate ? _ca.toDate() : (_ca.seconds ? new Date(_ca.seconds * 1000) : new Date(_ca))); return isNaN(d) ? '-' : `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`; })()
      : '-';
    // 頭像：自己用 LINE 頭像，他人用資料庫 pictureUrl
    const picCandidates = isSelf
      ? this._getAvatarCandidateUrls(lineProfile && lineProfile.pictureUrl, user && user.pictureUrl)
      : this._getAvatarCandidateUrls(user && user.pictureUrl);
    const pic = picCandidates[0] || null;

    const avatarHtml = this._buildAvatarImageMarkup(pic, name, '', 'uc-avatar-circle');
    const teamHtml = user ? this._getUserTeamHtml(user) : '無';

    // 稱號顯示（HTML 版：金色/銀色標籤）
    const titleHtml = user ? this._buildTitleDisplayHtml(user, name) : escapeHTML(name);

    const cardHeader = document.querySelector('#page-user-card .page-header h2');
    if (cardHeader) cardHeader.textContent = '用戶資料卡片';
    document.getElementById('user-card-full').innerHTML = `
      <div class="uc-header">
        <div class="uc-avatar-circle" style="margin:0 auto .6rem">${avatarHtml}</div>
        <div class="profile-title">${titleHtml}</div>
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
        ${earned.length ? `<div class="uc-badge-list">${earned.map(item => {
          const color = item.color;
          const badge = item.badge;
          return `<div class="uc-badge-item">
            <div class="badge-img-placeholder" style="border-color:${color}">${badge.image ? `<img src="${badge.image}">` : ''}</div>
            <span class="uc-badge-name">${escapeHTML(badge.name)}</span>
          </div>`;
        }).join('')}</div>` : '<div style="font-size:.82rem;color:var(--text-muted)">尚未獲得徽章</div>'}
      </div>
      <div class="info-card">
        <div class="info-title">活動紀錄</div>
        <div class="profile-stats" style="margin:-.2rem 0 .5rem" id="uc-record-stats">
          <div class="stat-item"><span class="stat-num" id="uc-stat-total">-</span><span class="stat-label">應到場次</span></div>
          <div class="stat-item"><span class="stat-num" id="uc-stat-done">-</span><span class="stat-label">完成場次</span></div>
          <div class="stat-item"><span class="stat-num" id="uc-stat-rate">-</span><span class="stat-label">出席率</span></div>
          <div class="stat-item"><span class="stat-num" id="uc-stat-badges">-</span><span class="stat-label">徽章</span></div>
        </div>
        <div class="tab-bar compact" id="uc-record-tabs">
          <button class="tab" data-filter="all">全部</button>
          <button class="tab" data-filter="completed">完成</button>
          <button class="tab" data-filter="cancelled">取消</button>
        </div>
        <div class="mini-activity-list" id="uc-activity-records"></div>
      </div>
      <div style="text-align:center;padding:.5rem 0 1rem">
        <button class="outline-btn" style="font-size:.78rem;padding:.4rem 1rem;display:inline-flex;align-items:center;gap:.3rem" onclick="App._shareUserCard('${escapeHTML(name)}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          分享名片
        </button>
      </div>
    `;
    this._bindAvatarFallbacks(document.getElementById('user-card-full'));

    // 渲染用戶活動紀錄
    const targetUid = user ? (user.uid || user.lineUserId) : null;
    if (targetUid) {
      this._ucRecordUid = targetUid;
      this.renderUserCardRecords('all', 1);
    }
    this.showPage('page-user-card');
  },

  _shareUserCard(name) {
    const shareText = `SportHub 用戶名片：${name}\n${location.origin}${location.pathname}`;
    if (navigator.share) {
      navigator.share({ title: `${name} 的 SportHub 名片`, text: shareText }).catch(() => {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(shareText).then(() => {
        this.showToast('名片連結已複製到剪貼簿');
      }).catch(() => this.showToast('複製失敗'));
    } else {
      this.showToast('您的瀏覽器不支援分享功能');
    }
  },

  async bindLineLogin() {
    if (!ModeManager.isDemo() && typeof LineAuth !== 'undefined') {
      // LIFF SDK 尚未載入（CDN 背景載入中）→ 跳過，等背景載入完成後再呼叫
      if (typeof liff === 'undefined') {
        console.log('[App] bindLineLogin: LIFF SDK 尚未載入，稍後再試');
        return;
      }
      // LIFF SDK 已載入但尚未初始化 → 初始化
      if (!LineAuth._ready) {
        await LineAuth.init();
      }
      if (typeof liff !== 'undefined'
        && liff.isLoggedIn()
        && !LineAuth.isLoggedIn()
        && typeof LineAuth.ensureProfile === 'function') {
        await LineAuth.ensureProfile();
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

      // LIFF 已登入但 getProfile 失敗（網路問題等）：提示用戶重新整理
      if (LineAuth._profileError && !LineAuth.isLoggedIn() && !(LineAuth.isPendingLogin && LineAuth.isPendingLogin())) {
        console.error('[App] LINE 用戶資料取得失敗:', LineAuth._profileError);
        this.showToast('LINE 登入成功但無法取得用戶資料，請重新整理頁面');
      }

      // 未登入 + 無 LIFF 錯誤 + 非 localhost + 無 deep-link + 在首頁 → 自動跳轉 LINE 登入
      if (!LineAuth.isLoggedIn() && !LineAuth._initError && !LineAuth.isLocalhost() && !this._bootDeepLink && this.currentPage === 'page-home') {
        console.log('[App] 未登入，自動跳轉 LINE 登入');
        try {
          liff.login();
          return;
        } catch (err) {
          console.warn('[App] 自動跳轉 LINE 登入失敗:', err);
        }
      }

      if (LineAuth.isLoggedIn()) {
        const profile = LineAuth.getProfile();
        console.log('[App] LINE 已登入, userId:', profile.userId, 'name:', profile.displayName);
        const refreshAfterUserReady = () => {
          const latestRole = ApiService.getCurrentUser?.()?.role || 'user';
          if (this.currentRole !== latestRole && typeof this.applyRole === 'function') {
            this.applyRole(latestRole, true);
            this.showToast(`權限已更新為「${ROLES[latestRole]?.label || latestRole}」`);
          }
          this._handleRestrictedStateChange?.();
          this.renderProfileData();
          this.renderProfileFavorites();
          this.renderLoginUI();
          this.renderHotEvents();
          this.renderActivityList();
          this.renderMyActivities();
          void this._flushPendingProtectedBootRoute?.({ skipEnsureCloudReady: true });
        };
        FirebaseService._onUserChanged = refreshAfterUserReady;
        this.renderLoginUI();
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
          refreshAfterUserReady();
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
        // LINE 登入完成後重新渲染活動列表（修正 currentUser 尚未載入的時序問題）
        this.renderHotEvents();
        this.renderActivityList();
        this.renderMyActivities();
      }
    }
    this.renderLoginUI();
    this._handleRestrictedStateChange?.();
    this.renderProfileData();
    this.renderProfileFavorites();
    if (this._pendingFirstLogin && !this._isCurrentUserRestricted?.()) {
      this.initFirstLoginRegionPicker?.();
      this.showModal('first-login-modal');
    }
  },

  renderLoginUI() {
    const lineWrapper = document.getElementById('line-login-wrapper');
    const profileAvatar = document.getElementById('profile-avatar');
    const profileContent = document.getElementById('profile-content');
    const loginPrompt = document.getElementById('profile-login-prompt');
    const drawerAvatar = document.getElementById('drawer-avatar');
    const drawerName = document.getElementById('drawer-name');

    if (!lineWrapper) return;

    // ── 顯示 LINE 登入區 ──
    lineWrapper.style.display = '';

    const isLoggedIn = typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn();
    const isLoginPending = typeof LineAuth !== 'undefined'
      && typeof LineAuth.isPendingLogin === 'function'
      && LineAuth.isPendingLogin();
    const loginBtn = document.getElementById('line-login-btn');
    const userTopbar = document.getElementById('line-user-topbar');
    const avatarImg = document.getElementById('line-avatar-topbar');

    const promptTitle = loginPrompt ? loginPrompt.querySelector('h3') : null;
    const promptText = loginPrompt ? loginPrompt.querySelector('p') : null;
    if (promptTitle && !promptTitle.dataset.defaultText) promptTitle.dataset.defaultText = promptTitle.textContent || '';
    if (promptText && !promptText.dataset.defaultText) promptText.dataset.defaultText = promptText.textContent || '';

    if (!isLoggedIn) {
      // 未登入
      if (loginBtn) loginBtn.style.display = isLoginPending ? 'none' : '';
      if (userTopbar) userTopbar.style.display = 'none';
      if (profileContent) profileContent.style.display = 'none';
      if (loginPrompt) loginPrompt.style.display = '';
      if (promptTitle) promptTitle.textContent = isLoginPending ? '登入確認中' : (promptTitle.dataset.defaultText || promptTitle.textContent);
      if (promptText) promptText.textContent = isLoginPending
        ? 'LINE 登入已完成，正在同步帳號資料，請稍候...'
        : (promptText.dataset.defaultText || promptText.textContent);
      if (drawerAvatar) { drawerAvatar.className = 'drawer-avatar'; drawerAvatar.innerHTML = '?'; }
      if (drawerName) drawerName.textContent = isLoginPending ? '登入確認中...' : '未登入';
      // 未登入也套用一般用戶抽屜選單
      this.currentRole = 'user';
      const roleTag = document.getElementById('drawer-role-tag');
      if (roleTag) {
        roleTag.textContent = isLoginPending ? '確認中' : '未登入';
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
    const avatarCandidates = this._getAvatarCandidateUrls(profile && profile.pictureUrl, currentUser && currentUser.pictureUrl);
    this._setTopbarAvatar(userTopbar, avatarImg, profile, {
      candidateUrls: avatarCandidates,
    });

    // 更新 profile 頁面（資料由 renderProfileData() 統一處理）
    if (profileContent) profileContent.style.display = '';
    if (loginPrompt) loginPrompt.style.display = 'none';

    // 更新 drawer
    if (drawerName) drawerName.textContent = profile.displayName;
    this._setAvatarContent(drawerAvatar, avatarCandidates[0] || null, profile.displayName, {
      fallbackClass: 'drawer-avatar',
      containerImageClass: 'drawer-avatar drawer-avatar-img',
      candidateUrls: avatarCandidates,
    });

    // 依資料庫角色套用抽屜選單與身份標籤
    const userRole = (currentUser && currentUser.role) ? currentUser.role : 'user';
    this.applyRole(userRole, true);
  },
});
