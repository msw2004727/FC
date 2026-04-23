/* ================================================
   SportHub — Profile: LINE Login & Login UI
   依賴：profile-avatar.js, profile-core.js
   ================================================ */
Object.assign(App, {

  async bindLineLogin() {
    if (typeof LineAuth !== 'undefined') {
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
        'initError=', LineAuth._initError?.message || 'none');

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

      // v8 延遲登入（2026-04-23）：移除 boot 時的自動跳轉 LINE 登入邏輯
      // 原邏輯：未登入 + 無錯誤 + 首頁 → 強制 liff.login() 跳轉
      // 新行為：未登入訪客自由瀏覽首頁、只有點報名/收藏/建立動作才觸發登入
      // 相關機制：_requireProtectedActionLogin + _resumePendingAuthAction（見 docs/lazy-auth-plan.md）

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
    // 2026-04-19 UX 調整：移除登入後自動彈首次登入 modal 的邏輯。
    // 改為「可自由瀏覽、寫入才擋」：用戶執行報名/加入俱樂部/建立活動等寫入動作時，
    // 對應函式會呼叫 _requireProfileComplete() 彈出 modal。
    // _pendingFirstLogin 仍維持設置（用於寫入守衛判斷），只是不再自動彈窗。
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
      // currentRole 不在此處重設 — 由 applyRole() 從權威來源管理
      // 直接賦值會在 LIFF session 瞬間失效時覆蓋已驗證的角色
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

  // ── 首次登入：地區模糊搜尋 + 儲存（eagerly loaded，不依賴 profile-data.js）──

  _FL_REGIONS: [
    '台北市','新北市','桃園市','台中市','台南市','高雄市',
    '基隆市','新竹市','嘉義市',
    '新竹縣','苗栗縣','彰化縣','南投縣','雲林縣','嘉義縣',
    '屏東縣','宜蘭縣','花蓮縣','台東縣',
    '澎湖縣','金門縣','連江縣',
    '其他'
  ],

  _flNormalize: function(v) {
    return String(v || '').trim().toLowerCase().replace(/臺/g, '台').replace(/\s+/g, '');
  },

  _flFuzzy: function(text, query) {
    var ti = 0;
    for (var qi = 0; qi < query.length; qi++) {
      var found = false;
      while (ti < text.length) {
        if (text[ti] === query[qi]) { ti++; found = true; break; }
        ti++;
      }
      if (!found) return false;
    }
    return true;
  },

  flRenderList: function(keyword) {
    var list = document.getElementById('fl-region-list');
    if (!list) return;
    var q = this._flNormalize(keyword);
    var matched = this._FL_REGIONS;
    if (q) {
      var self = this;
      matched = this._FL_REGIONS.filter(function(name) {
        return self._flFuzzy(self._flNormalize(name), q);
      });
    }
    list.innerHTML = '';
    if (matched.length === 0) {
      list.innerHTML = '<div style="padding:8px 12px;color:#999;font-size:13px">無匹配結果</div>';
      return;
    }
    matched.forEach(function(name) {
      var item = document.createElement('div');
      item.textContent = name;
      item.setAttribute('data-region', name);
      item.style.cssText = 'padding:7px 12px;font-size:13px;border-bottom:1px solid var(--border,#eee)';
      list.appendChild(item);
    });
  },

  flSelectRegion: function(e) {
    var target = e.target;
    var region = target.getAttribute('data-region');
    if (!region) return;
    var input = document.getElementById('fl-region-input');
    if (input) input.value = region;
    var list = document.getElementById('fl-region-list');
    if (!list) return;
    var items = list.querySelectorAll('[data-region]');
    for (var i = 0; i < items.length; i++) {
      items[i].style.background = '';
      items[i].style.fontWeight = '';
    }
    target.style.background = 'var(--bg-hover,#f3f4f6)';
    target.style.fontWeight = '600';
  },

  initFirstLoginRegionPicker: function() {
    this.flRenderList('');
  },

  /** 填充年/月/日三個 select（首次登入 + 個人資料編輯共用） */
  _populateBirthdaySelects: function(yId, mId, dId, presetValue) {
    var yEl = document.getElementById(yId);
    var mEl = document.getElementById(mId);
    var dEl = document.getElementById(dId);
    if (!yEl || !mEl || !dEl) return;
    var now = new Date();
    var curY = now.getFullYear();
    // 年：1930 ~ 今年
    if (yEl.options.length <= 1) {
      for (var y = curY; y >= 1930; y--) {
        var o = document.createElement('option');
        o.value = String(y); o.textContent = y + '\u5E74';
        yEl.appendChild(o);
      }
    }
    // 月：1~12
    if (mEl.options.length <= 1) {
      for (var m = 1; m <= 12; m++) {
        var o = document.createElement('option');
        o.value = String(m).padStart(2, '0'); o.textContent = m + '\u6708';
        mEl.appendChild(o);
      }
    }
    // 日：預設 1~31，月份變更時動態調整
    var fillDays = function() {
      var selY = parseInt(yEl.value, 10) || curY;
      var selM = parseInt(mEl.value, 10) || 1;
      var maxD = new Date(selY, selM, 0).getDate();
      var curD = dEl.value;
      dEl.innerHTML = '<option value="">\u65E5</option>';
      for (var d = 1; d <= maxD; d++) {
        var o = document.createElement('option');
        o.value = String(d).padStart(2, '0'); o.textContent = d + '\u65E5';
        dEl.appendChild(o);
      }
      if (curD && parseInt(curD, 10) <= maxD) dEl.value = curD;
    };
    yEl.onchange = fillDays;
    mEl.onchange = fillDays;
    fillDays();
    // 預填
    if (presetValue) {
      var parts = String(presetValue).replace(/\//g, '-').split('-');
      if (parts.length === 3) {
        yEl.value = parts[0];
        mEl.value = parts[1].padStart(2, '0');
        fillDays();
        dEl.value = parts[2].padStart(2, '0');
      }
    }
  },

  _getBirthdayFromSelects: function(yId, mId, dId) {
    var y = document.getElementById(yId)?.value || '';
    var m = document.getElementById(mId)?.value || '';
    var d = document.getElementById(dId)?.value || '';
    if (!y || !m || !d) return '';
    return y + '/' + m + '/' + d;
  },

  // Plan B+C：改用 await 確保存檔完成才關 modal（修正 fire-and-forget bug）
  async saveFirstLoginProfile() {
    var genderEl = document.getElementById('fl-gender');
    var regionEl = document.getElementById('fl-region-input');
    var gender = genderEl ? genderEl.value : '';
    var birthday = this._getBirthdayFromSelects('fl-birthday-y', 'fl-birthday-m', 'fl-birthday-d');
    var region = regionEl ? regionEl.value.trim() : '';
    var errEl = document.getElementById('fl-error-msg');
    var self = this;
    var showErr = function(msg) {
      if (errEl) { errEl.textContent = msg; errEl.style.display = ''; }
      else self.showToast(msg);
    };
    if (errEl) errEl.style.display = 'none';
    if (!gender || !birthday || !region) {
      showErr('請填寫所有必填欄位（性別、生日、地區）');
      return;
    }
    // 禁用按鈕防連點
    var btn = document.querySelector('#first-login-modal .primary-btn');
    if (btn) { btn.disabled = true; btn.textContent = '儲存中...'; }
    try {
      await ApiService.updateCurrentUserAwait({ gender: gender, birthday: birthday, region: region });
    } catch (err) {
      console.error('[saveFirstLoginProfile]', err);
      showErr('儲存失敗，請檢查網路後重試。若持續失敗可重新整理頁面。');
      if (btn) { btn.disabled = false; btn.textContent = '確認送出'; }
      return;  // 不關 modal，overlay 保持 locked 讓用戶重試（重整頁面可重置狀態）
    }
    if (btn) { btn.disabled = false; btn.textContent = '確認送出'; }
    this._pendingFirstLogin = false;
    this._firstLoginShowing = false;
    var overlay = document.getElementById('modal-overlay');
    if (overlay) delete overlay.dataset.locked;
    var input = document.getElementById('fl-region-input');
    if (input) input.value = '';
    this.closeModal();
    if (typeof this.renderProfileData === 'function') this.renderProfileData();
    this.showToast('個人資料已儲存');
  },

  /**
   * 2026-04-19 UX：首次登入 modal 關閉（「稍後填寫」按鈕）
   * 用戶可先關閉繼續瀏覽，但 _pendingFirstLogin 保留，下次寫入類動作仍會彈出
   */
  dismissFirstLoginModal() {
    this._firstLoginShowing = false;
    var overlay = document.getElementById('modal-overlay');
    if (overlay) delete overlay.dataset.locked;
    var errMsg = document.getElementById('fl-error-msg');
    if (errMsg) { errMsg.style.display = 'none'; errMsg.textContent = ''; }
    this.closeModal();
  },

});
