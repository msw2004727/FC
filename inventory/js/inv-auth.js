/**
 * inv-auth.js
 * LINE LIFF 登入 + 權限檢查模組
 */
const InvAuth = {
  currentUser: null,
  isAdmin: false,

  /**
   * 初始化 LIFF SDK 並處理登入狀態
   */
  async init() {
    try {
      await liff.init({ liffId: INV_CONFIG.LIFF_ID });
    } catch (e) {
      console.error('[InvAuth] LIFF init failed:', e);
      InvApp.showToast('LIFF 初始化失敗，請重新整理頁面');
      return;
    }

    // 非 LINE 環境
    if (!liff.isInClient() && !liff.isLoggedIn()) {
      const loginBtn = document.getElementById('btn-line-login');
      if (loginBtn) {
        loginBtn.style.display = 'inline-block';
        loginBtn.addEventListener('click', () => this.login());
      }
      return;
    }

    if (liff.isLoggedIn()) {
      await this.authenticate();
    } else {
      // 在 LINE 內但尚未登入
      const loginBtn = document.getElementById('btn-line-login');
      if (loginBtn) {
        loginBtn.style.display = 'inline-block';
        loginBtn.addEventListener('click', () => this.login());
      }
    }
  },

  /**
   * 觸發 LINE 登入
   */
  async login() {
    try {
      liff.login({ redirectUri: window.location.href });
    } catch (e) {
      console.error('[InvAuth] login failed:', e);
      InvApp.showToast('登入失敗，請重試');
    }
  },

  /**
   * 取得 Firebase Custom Token 並登入 Firebase
   */
  async authenticate() {
    try {
      const accessToken = liff.getAccessToken();
      if (!accessToken) {
        InvApp.showToast('無法取得 LINE 存取權杖，請重新登入');
        return;
      }

      const fn = firebase.app().functions('asia-east1').httpsCallable('createCustomToken');
      const { data } = await fn({ accessToken: accessToken });

      await auth.signInWithCustomToken(data.customToken);
      await this.checkPermission();
    } catch (e) {
      console.error('[InvAuth] authenticate failed:', e);
      InvApp.showToast('驗證失敗，請重新整理頁面再試');
    }
  },

  /**
   * 檢查用戶是否有管理員權限
   */
  async checkPermission() {
    try {
      const configDoc = await db.collection('inv_settings').doc('config').get();
      if (!configDoc.exists) {
        InvApp.showToast('系統設定不存在，請聯繫管理員');
        return;
      }

      const configData = configDoc.data();
      const adminUids = configData.adminUids || [];
      const uid = auth.currentUser.uid;

      if (adminUids.indexOf(uid) !== -1) {
        this.isAdmin = true;

        try {
          const profile = await liff.getProfile();
          this.currentUser = {
            uid: uid,
            name: profile.displayName,
            pictureUrl: profile.pictureUrl || '',
          };
        } catch (profileErr) {
          console.warn('[InvAuth] getProfile failed:', profileErr);
          this.currentUser = { uid: uid, name: '管理員', pictureUrl: '' };
        }

        InvApp.showPage('page-dashboard');
        InvDashboard.render();
      } else {
        this.isAdmin = false;
        InvApp.showPage('page-unauthorized');
      }
    } catch (e) {
      console.error('[InvAuth] checkPermission failed:', e);
      InvApp.showToast('權限檢查失敗，請重新整理頁面');
    }
  },

  /**
   * 取得目前登入用戶的 UID
   */
  getUid() {
    return auth.currentUser ? auth.currentUser.uid : null;
  },

  /**
   * 取得目前登入用戶的顯示名稱
   */
  getName() {
    return this.currentUser ? this.currentUser.name : null;
  },
};
