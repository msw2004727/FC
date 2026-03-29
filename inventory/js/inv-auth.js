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
      var accessToken = liff.getAccessToken();
      if (!accessToken) {
        document.getElementById('inv-login-status').textContent = '錯誤：無法取得 LINE Access Token';
        InvApp.showToast('請在 LINE 中開啟此頁面');
        return;
      }
      document.getElementById('inv-login-status').textContent = '正在驗證身份...';

      var fn = firebase.app().functions('asia-east1').httpsCallable('createCustomToken');
      var result = await fn({ accessToken: accessToken });

      if (!result.data || !result.data.customToken) {
        document.getElementById('inv-login-status').textContent = '錯誤：Cloud Function 未回傳 Token';
        return;
      }

      await auth.signInWithCustomToken(result.data.customToken);
      document.getElementById('inv-login-status').textContent = '驗證成功，檢查權限中...';
      await this.checkPermission();
    } catch (e) {
      console.error('[InvAuth] authenticate failed:', e);
      var msg = e.message || '';
      if (msg.indexOf('internal') !== -1) msg = 'Cloud Function 內部錯誤';
      else if (msg.indexOf('unauthenticated') !== -1) msg = 'LINE Token 無效，請重新開啟';
      else if (msg.indexOf('not-found') !== -1) msg = 'Cloud Function 不存在';
      document.getElementById('inv-login-status').textContent = '驗證失敗：' + msg;
      InvApp.showToast('驗證失敗：' + msg);
    }
  },

  /**
   * 檢查用戶是否有管理員權限
   */
  async checkPermission() {
    try {
      // 用 REST API 繞過 Firestore SDK 連線問題（LINE WebView WebSocket 常被擋）
      var restUrl = 'https://firestore.googleapis.com/v1/projects/' + INV_CONFIG.FIREBASE.projectId
        + '/databases/(default)/documents/inv_settings/config?key=' + INV_CONFIG.FIREBASE.apiKey;
      var resp = await fetch(restUrl);
      if (!resp.ok) {
        document.getElementById('inv-login-status').textContent = '無法讀取系統設定（' + resp.status + '）';
        return;
      }
      var json = await resp.json();
      if (!json.fields) {
        InvApp.showToast('系統設定不存在，請聯繫管理員');
        return;
      }
      var adminUids = (json.fields.adminUids && json.fields.adminUids.arrayValue && json.fields.adminUids.arrayValue.values)
        ? json.fields.adminUids.arrayValue.values.map(function(v) { return v.stringValue; })
        : [];
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
