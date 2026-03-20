/* ================================================
   SportHub — Profile: LINE Login & Login UI
   依賴：profile-avatar.js, profile-core.js
   ================================================ */
Object.assign(App, {

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

      // LIFF 已登入但 getProfile 失敗：嘗試清除無效 session 並重新登入
      if (LineAuth._profileError && !LineAuth.isLoggedIn() && !(LineAuth.isPendingLogin && LineAuth.isPendingLogin())) {
        console.error('[App] LINE 用戶資料取得失敗:', LineAuth._profileError);
        const isNoToken = LineAuth._profileError && LineAuth._profileError.code === 'no_access_token';
        // 防止無限重新登入：同一 session 最多自動重試 1 次
        const retryKey = '_lineLoginRetryCount';
        const retryCount = Number(sessionStorage.getItem(retryKey) || 0);
        if (retryCount < 1 && !LineAuth.isLocalhost()) {
          sessionStorage.setItem(retryKey, String(retryCount + 1));
          console.log('[App] Session 無效，清除後自動重新登入 (retry:', retryCount + 1, ', noToken:', isNoToken, ')');
          try {
            if (LineAuth.hasLiffSession()) liff.logout();
            LineAuth._profile = null;
            LineAuth._profileError = null;
            LineAuth._clearProfileCache();
          } catch (_) {}
          try {
            liff.login();
            return;
          } catch (loginErr) {
            console.warn('[App] 自動重新登入失敗:', loginErr);
          }
        } else {
          this.showToast('LINE 登入異常，請關閉瀏覽器後重新開啟');
        }
      }

      // 未登入 + 無 LIFF 錯誤 + 非 localhost + 無 deep-link + 在首頁 → 自動跳轉 LINE 登入
      if (!LineAuth.isLoggedIn() && !LineAuth._initError && !LineAuth._profileError && !LineAuth.isLocalhost() && !this._bootDeepLink && this.currentPage === 'page-home') {
        console.log('[App] 未登入，自動跳轉 LINE 登入');
        // 重置重試計數（正常首次登入）
        try { sessionStorage.removeItem('_lineLoginRetryCount'); } catch (_) {}
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
          this.renderProfileData?.();
          this.renderProfileFavorites?.();
          this.renderLoginUI();
          this.renderHotEvents();
          this.renderActivityList();
          this.renderMyActivities?.();
          void this._flushPendingProtectedBootRoute?.({ skipEnsureCloudReady: true });
          void this._resumePendingAuthAction?.();
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
          // Tier 2 降級：如果 loginUser 失敗但 Firebase Auth 仍有效，
          // 不顯示錯誤，繼續用快取資料
          if (!LineAuth.hasLiffSession() && LineAuth._firebaseSessionAlive()) {
            console.log('[App] Tier 2: loginUser failed but Firebase Auth alive, continuing with cache');
            refreshAfterUserReady();
          } else {
            const code = err?.code || '';
            const msg = (err?.message || '').toLowerCase();
            if (code === 'permission-denied') {
              this.showToast('登入失敗：資料庫權限不足，請聯繫管理員更新 Firestore 規則');
            } else if (msg.includes('assertion') || msg.includes('internal')) {
              // Firebase SDK 內部錯誤（IndexedDB 損壞等）→ 建議清快取重試
              console.error('[App] Firebase SDK internal error during login:', err);
              this.showToast('登入異常，請關閉所有分頁後重新開啟');
            } else {
              this.showToast('登入失敗：' + (err?.message || '資料同步異常'));
            }
          }
        }
        // 註冊即時回調：當資料庫用戶資料變更時自動更新 UI
        // LINE 登入完成後重新渲染活動列表（修正 currentUser 尚未載入的時序問題）
        this.renderHotEvents();
        this.renderActivityList();
        this.renderMyActivities?.();
      }
    }
    this.renderLoginUI();
    this._handleRestrictedStateChange?.();
    this.renderProfileData?.();
    this.renderProfileFavorites?.();
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
    // 登入時取得的最新 LINE 頭像 URL，從壞圖記錄移除，讓它有機會重新載入
    avatarCandidates.forEach(function(url) { App._forgetBrokenAvatarUrl(url); });
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
