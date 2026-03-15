/* ================================================
   SportHub LINE LIFF Login Service
   ================================================ */

const LineAuth = {
  _profile: null,
  _ready: false,
  _initError: null,
  _profileError: null,
  _profileLoading: false,
  _profilePromise: null,
  _profileCacheKey: 'liff_profile_cache',
  _profileCacheMaxAgeMs: 30 * 24 * 60 * 60 * 1000,

  _getBaseUrl() {
    return window.location.origin + window.location.pathname;
  },

  _cleanUrl() {
    const url = new URL(window.location.href);
    const liffParams = ['code', 'state', 'liffClientId', 'liffRedirectUri', 'error', 'error_description'];
    let dirty = false;
    liffParams.forEach(p => {
      if (url.searchParams.has(p)) {
        url.searchParams.delete(p);
        dirty = true;
      }
    });
    if (dirty) {
      window.history.replaceState({}, '', url.pathname + (url.search || '') + (url.hash || ''));
    }
  },

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  _persistProfileCache(profile) {
    if (!profile || typeof profile !== 'object') return;
    try {
      localStorage.setItem(this._profileCacheKey, JSON.stringify({
        ...profile,
        cachedAt: Date.now(),
      }));
    } catch (_) {}
  },

  _clearProfileCache() {
    try {
      localStorage.removeItem(this._profileCacheKey);
    } catch (_) {}
  },

  _profileRefreshPending: false,
  _profileRefreshTimer: null,

  _firebaseSessionAlive() {
    try {
      return typeof auth !== 'undefined' && auth !== null && auth.currentUser !== null;
    } catch (_) {
      return false;
    }
  },

  _matchesFirebaseUid(cachedProfile) {
    if (!cachedProfile || !cachedProfile.userId) return false;
    try {
      if (typeof auth === 'undefined' || !auth || !auth.currentUser) return false;
      return auth.currentUser.uid === cachedProfile.userId;
    } catch (_) {
      return false;
    }
  },

  isLoggedInWithLiff() {
    return this._ready && this._profile !== null && this.hasLiffSession();
  },

  _scheduleProfileRefresh() {
    if (this._profileRefreshPending) return;
    this._profileRefreshPending = true;
    let elapsed = 0;
    const maxMs = 5 * 60 * 1000;
    const intervalMs = 30000;
    this._profileRefreshTimer = setInterval(() => {
      elapsed += intervalMs;
      if (this.hasLiffSession()) {
        clearInterval(this._profileRefreshTimer);
        this._profileRefreshPending = false;
        this._profileRefreshTimer = null;
        this.ensureProfile({ force: true }).catch(() => {});
      } else if (elapsed >= maxMs) {
        clearInterval(this._profileRefreshTimer);
        this._profileRefreshPending = false;
        this._profileRefreshTimer = null;
      }
    }, intervalMs);
  },

  _withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const err = new Error(`${label || 'operation'} timeout after ${ms}ms`);
        err.code = 'timeout';
        reject(err);
      }, ms);

      Promise.resolve(promise).then(
        value => {
          clearTimeout(timer);
          resolve(value);
        },
        err => {
          clearTimeout(timer);
          reject(err);
        }
      );
    });
  },

  hasLiffSession() {
    if (typeof liff === 'undefined') return false;
    try {
      return !!(liff.isLoggedIn && liff.isLoggedIn());
    } catch (_) {
      return false;
    }
  },

  isPendingLogin() {
    if (!this.hasLiffSession()) return false;
    // 超過 20 秒自動降級，避免永久卡住
    if (this._pendingStartTime && Date.now() - this._pendingStartTime > 20000) {
      return false;
    }
    return this._profileLoading || (!this._profile && !this._ready);
  },

  async _fetchProfileDirect(accessToken) {
    const resp = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: 'Bearer ' + accessToken },
    });
    if (!resp.ok) throw new Error('LINE Profile API ' + resp.status);
    return await resp.json();
  },

  async ensureProfile(options = {}) {
    const { force = false } = options;
    if (typeof liff === 'undefined' || !this.hasLiffSession()) return null;
    if (this._profile && !force) return this._profile;
    if (this._profilePromise) return await this._profilePromise;

    this._profilePromise = (async () => {
      this._profileLoading = true;
      this._profileError = null;

      // 診斷：檢查 access token 是否可用
      let accessToken = null;
      try { accessToken = liff.getAccessToken(); } catch (_) {}
      console.log('[LineAuth] ensureProfile: accessToken=', accessToken ? (accessToken.substring(0, 8) + '...') : 'null');

      if (!accessToken) {
        const err = new Error('No access token available after liff.init()');
        err.code = 'no_access_token';
        this._profileError = err;
        console.error('[LineAuth] 無 Access Token，LIFF session 可能無效');
        return null;
      }

      const retryDelays = [0, 500, 1500];
      const profileTimeoutMs = 8000;
      let lastErr = null;

      for (let i = 0; i < retryDelays.length; i++) {
        if (retryDelays[i] > 0) await this._sleep(retryDelays[i]);
        try {
          const profile = await this._withTimeout(
            liff.getProfile(),
            profileTimeoutMs,
            'liff.getProfile()'
          );

          let email = null;
          try {
            email = liff.getDecodedIDToken()?.email || null;
          } catch (_) { /* ignore ID token parse errors */ }

          this._profile = {
            userId: profile.userId,
            displayName: profile.displayName,
            pictureUrl: profile.pictureUrl || null,
            email,
          };
          this._persistProfileCache(this._profile);
          console.log('[LineAuth] 已登入:', this._profile.displayName);
          return this._profile;
        } catch (err) {
          lastErr = err;
          console.warn('[LineAuth] liff.getProfile() failed (attempt ' + (i + 1) + '/' + retryDelays.length + ')', err);
        }
      }

      // Fallback 1: 直接呼叫 LINE Profile API（繞過 LIFF SDK 內部問題）
      try {
        const directProfile = await this._withTimeout(
          this._fetchProfileDirect(accessToken),
          8000,
          'direct Profile API'
        );
        if (directProfile && directProfile.userId) {
          let email = null;
          try { email = liff.getDecodedIDToken()?.email || null; } catch (_) {}
          this._profile = {
            userId: directProfile.userId,
            displayName: directProfile.displayName || 'LINE User',
            pictureUrl: directProfile.pictureUrl || null,
            email,
          };
          this._persistProfileCache(this._profile);
          console.log('[LineAuth] 已登入（直接 API fallback）:', this._profile.displayName);
          return this._profile;
        }
      } catch (directErr) {
        console.warn('[LineAuth] 直接 Profile API fallback failed:', directErr);
        lastErr = directErr;
      }

      // Fallback 2: 從 ID Token 解析用戶資料（外部 Safari 等 getProfile API 呼叫受阻時）
      try {
        const idToken = liff.getDecodedIDToken();
        if (idToken && idToken.sub) {
          this._profile = {
            userId: idToken.sub,
            displayName: idToken.name || 'LINE User',
            pictureUrl: idToken.picture || null,
            email: idToken.email || null,
          };
          this._persistProfileCache(this._profile);
          console.log('[LineAuth] 已登入（ID Token fallback）:', this._profile.displayName);
          return this._profile;
        } else {
          console.warn('[LineAuth] ID Token fallback: token is null or missing sub');
        }
      } catch (idTokenErr) {
        console.warn('[LineAuth] ID Token fallback also failed:', idTokenErr);
      }

      this._profileError = lastErr;
      console.error('[LineAuth] 所有取得用戶資料的方式均失敗:', lastErr);
      return null;
    })();

    try {
      return await this._profilePromise;
    } finally {
      this._profileLoading = false;
      this._profilePromise = null;
    }
  },

  async initSDK() {
    this._initError = null;
    this._pendingStartTime = Date.now();
    try {
      await this._withTimeout(
        liff.init({ liffId: LINE_CONFIG.LIFF_ID }),
        8000,
        'liff.init()'
      );
      console.log('[LineAuth] LIFF SDK 初始化完成');
    } catch (err) {
      console.error('[LineAuth] LIFF SDK 初始化失敗:', err);
      this._initError = err;
    }
    this._cleanUrl();
    this._ready = true;  // Access Token 此刻已可用
  },

  restoreCachedProfile() {
    if (this._profile) return this._profile;
    try {
      const cached = localStorage.getItem(this._profileCacheKey);
      if (!cached) return null;
      const parsed = JSON.parse(cached);
      const cachedAt = Number(parsed?.cachedAt || 0);
      const isExpired = !cachedAt || (Date.now() - cachedAt > this._profileCacheMaxAgeMs);
      const isValid = typeof parsed?.userId === 'string' && typeof parsed?.displayName === 'string';
      if (!isValid || isExpired) {
        this._clearProfileCache();
        return null;
      }
      // UID 交叉驗證：防止換帳號場景
      if (typeof auth !== 'undefined' && auth && auth.currentUser) {
        if (auth.currentUser.uid !== parsed.userId) {
          this._clearProfileCache();
          return null;
        }
      }
      this._profile = {
        userId: parsed.userId,
        displayName: parsed.displayName,
        pictureUrl: typeof parsed.pictureUrl === 'string' ? parsed.pictureUrl : null,
        email: typeof parsed.email === 'string' ? parsed.email : null,
      };
      return this._profile;
    } catch (e) {
      this._clearProfileCache();
    }
    return null;
  },

  async init() {
    this._initError = null;
    this._pendingStartTime = Date.now();

    try {
      await this._withTimeout(
        liff.init({ liffId: LINE_CONFIG.LIFF_ID }),
        8000,
        'liff.init()'
      );
      console.log('[LineAuth] LIFF 初始化成功');
    } catch (err) {
      console.error('[LineAuth] LIFF 初始化失敗:', err);
      this._initError = err;
      this._cleanUrl();
      this._ready = true;
      return;
    }

    if (this.hasLiffSession()) {
      await this.ensureProfile();
    }

    this._cleanUrl();
    this._ready = true;
  },

  isLocalhost() {
    const h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h.startsWith('192.168.');
  },

  login() {
    if (ModeManager.isDemo()) {
      App.showToast('DEMO 模式無需 LINE 登入');
      return;
    }
    if (this.isLocalhost()) {
      ModeManager.setMode('demo');
      App.showToast('本機環境切換為 Demo 模式');
      location.reload();
      return;
    }
    if (!this._ready) {
      App.showToast('LINE 登入服務尚未準備完成');
      return;
    }
    // 只在有 deep link 參數時才帶 redirectUri，否則讓 SDK 使用 Endpoint URL（外部 Safari 相容）
    const base = this._getBaseUrl();
    const current = new URL(window.location.href);
    const url = new URL(base);
    ['event', 'team', 'tournament', 'profile'].forEach(key => {
      const val = current.searchParams.get(key);
      if (val) url.searchParams.set(key, val);
    });
    const redirectUri = url.toString();
    if (redirectUri === base) {
      liff.login();
    } else {
      liff.login({ redirectUri });
    }
  },

  async logout() {
    if (typeof auth !== 'undefined' && auth?.currentUser) {
      try {
        await auth.signOut();
      } catch (err) {
        console.warn('[LineAuth] Firebase signOut failed during logout:', err);
      }
    }
    if (this.hasLiffSession()) {
      liff.logout();
    }
    this._profile = null;
    this._profileError = null;
    this._profileLoading = false;
    this._profilePromise = null;
    this._clearProfileCache();
    location.reload();
  },

  isLoggedIn() {
    if (!this._ready) return false;
    // Tier 1：LIFF profile 存在（正常狀態）
    if (this._profile !== null) return true;
    // Tier 2：LIFF 過期但 Firebase Auth 還活著 + 快取 profile
    if (this._firebaseSessionAlive()) {
      const cached = this.restoreCachedProfile();
      if (cached && this._matchesFirebaseUid(cached)) {
        return true;
      }
    }
    return false;
  },

  getProfile() {
    return this._profile;
  },

  getAccessToken() {
    if (!this._ready || !this.hasLiffSession()) return null;
    try {
      return liff.getAccessToken();
    } catch (e) {
      console.warn('[LineAuth] liff.getAccessToken() 失敗:', e);
      return null;
    }
  },
};
