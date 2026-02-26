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

  hasLiffSession() {
    if (typeof liff === 'undefined') return false;
    try {
      return !!(liff.isLoggedIn && liff.isLoggedIn());
    } catch (_) {
      return false;
    }
  },

  isPendingLogin() {
    return this.hasLiffSession() && (this._profileLoading || (!this._profile && !this._ready));
  },

  async ensureProfile(options = {}) {
    const { force = false } = options;
    if (typeof liff === 'undefined' || !this.hasLiffSession()) return null;
    if (this._profile && !force) return this._profile;
    if (this._profilePromise) return await this._profilePromise;

    this._profilePromise = (async () => {
      this._profileLoading = true;
      this._profileError = null;

      const retryDelays = [0, 250, 800];
      let lastErr = null;

      for (let i = 0; i < retryDelays.length; i++) {
        if (retryDelays[i] > 0) await this._sleep(retryDelays[i]);
        try {
          const profile = await liff.getProfile();

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
          console.log('[LineAuth] 已登入:', this._profile.displayName);
          return this._profile;
        } catch (err) {
          lastErr = err;
          console.warn(`[LineAuth] liff.getProfile() failed (attempt ${i + 1}/${retryDelays.length})`, err);
        }
      }

      this._profileError = lastErr;
      console.error('[LineAuth] liff.getProfile() 失敗（重試後仍無法取得用戶資料）:', lastErr);
      return null;
    })();

    try {
      return await this._profilePromise;
    } finally {
      this._profileLoading = false;
      this._profilePromise = null;
    }
  },

  async init() {
    this._initError = null;

    try {
      await liff.init({ liffId: LINE_CONFIG.LIFF_ID });
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
    liff.login();
  },

  logout() {
    if (this.hasLiffSession()) {
      liff.logout();
    }
    this._profile = null;
    this._profileError = null;
    this._profileLoading = false;
    this._profilePromise = null;
    location.reload();
  },

  isLoggedIn() {
    return this._ready && this._profile !== null;
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

