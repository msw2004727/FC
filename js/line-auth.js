/* ================================================
   SportHub — LINE LIFF Login Service
   ================================================
   依賴：config.js (LINE_CONFIG)

   LIFF SDK 初始化、登入/登出、取得 profile。
   僅在 Production 模式下啟用。
   ================================================ */

const LineAuth = {
  _profile: null,
  _ready: false,
  _initError: null,

  /** 取得乾淨的基礎 URL（去除 query params 與 hash） */
  _getBaseUrl() {
    return window.location.origin + window.location.pathname;
  },

  /** 清除 URL 中殘留的 LIFF auth 參數（防止重新整理時重複使用已失效的 code） */
  _cleanUrl() {
    const url = new URL(window.location.href);
    const liffParams = ['code', 'state', 'liffClientId', 'liffRedirectUri', 'error', 'error_description'];
    let dirty = false;
    liffParams.forEach(p => {
      if (url.searchParams.has(p)) { url.searchParams.delete(p); dirty = true; }
    });
    if (dirty) {
      window.history.replaceState({}, '', url.pathname + (url.search || '') + (url.hash || ''));
    }
  },

  async init() {
    try {
      await liff.init({ liffId: LINE_CONFIG.LIFF_ID });
      console.log('[LineAuth] LIFF 初始化成功');

      if (liff.isLoggedIn()) {
        const profile = await liff.getProfile();

        // getDecodedIDToken 可能在某些情境下拋錯，安全取值
        let email = null;
        try {
          email = liff.getDecodedIDToken()?.email || null;
        } catch (_) { /* ID Token 不可用，忽略 */ }

        this._profile = {
          userId: profile.userId,
          displayName: profile.displayName,
          pictureUrl: profile.pictureUrl || null,
          email,
        };
        console.log('[LineAuth] 已登入:', this._profile.displayName);
      }

      // 初始化成功後清除 URL 中的 auth 參數
      this._cleanUrl();

    } catch (err) {
      console.error('[LineAuth] LIFF 初始化失敗:', err);
      this._initError = err;

      // 清除 URL 中殘留的 auth code，避免重新整理時再次觸發 400
      this._cleanUrl();
    }
    this._ready = true;
  },

  isLocalhost() {
    const h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h.startsWith('192.168.');
  },

  login() {
    if (ModeManager.isDemo()) {
      App.showToast('DEMO 模式無法使用 LINE 登入');
      return;
    }
    if (this.isLocalhost()) {
      // 本機環境 LIFF 無法回調 localhost，自動切換 Demo 模式
      ModeManager.setMode('demo');
      App.showToast('本機環境已自動切換至 Demo 模式');
      location.reload();
      return;
    }
    if (!this._ready) {
      App.showToast('LINE 登入服務尚未準備好');
      return;
    }
    // 不指定 redirectUri，由 LIFF SDK 自動使用 Developer Console 設定的 endpoint URL
    liff.login();
  },

  logout() {
    if (liff.isLoggedIn()) {
      liff.logout();
    }
    this._profile = null;
    location.reload();
  },

  isLoggedIn() {
    return this._ready && this._profile !== null;
  },

  getProfile() {
    return this._profile;
  },
};
