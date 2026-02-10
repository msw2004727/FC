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

  async init() {
    try {
      await liff.init({ liffId: LINE_CONFIG.LIFF_ID });
      console.log('[LineAuth] LIFF 初始化成功');

      if (liff.isLoggedIn()) {
        const profile = await liff.getProfile();
        this._profile = {
          userId: profile.userId,
          displayName: profile.displayName,
          pictureUrl: profile.pictureUrl || null,
          email: liff.getDecodedIDToken()?.email || null,
        };
        console.log('[LineAuth] 已登入:', this._profile.displayName);
      }
    } catch (err) {
      console.error('[LineAuth] LIFF 初始化失敗:', err);
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
