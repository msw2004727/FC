/**
 * inv-auth.js — LINE LIFF 登入 + 權限檢查 + LINE 頭像
 */
const InvAuth = {
  currentUser: null,
  isAdmin: false,

  async init() {
    try {
      await liff.init({ liffId: INV_CONFIG.LIFF_ID });
    } catch (e) {
      console.error('[InvAuth] LIFF init failed:', e);
      InvApp.showToast('LIFF 初始化失敗');
      return;
    }
    if (!liff.isInClient() && !liff.isLoggedIn()) {
      var btn = document.getElementById('inv-login-btn');
      if (btn) btn.style.display = '';
      return;
    }
    if (liff.isLoggedIn()) {
      await this.authenticate();
    } else {
      var btn2 = document.getElementById('inv-login-btn');
      if (btn2) btn2.style.display = '';
    }
  },

  async login() {
    try { liff.login({ redirectUri: window.location.href }); } catch (_) { InvApp.showToast('登入失敗'); }
  },

  async logout() {
    try { liff.logout(); } catch (_) {}
    try { await auth.signOut(); } catch (_) {}
    this.currentUser = null;
    this.isAdmin = false;
    InvApp.showPage('page-login');
    InvApp.showToast('已登出');
  },

  async authenticate() {
    var statusEl = document.getElementById('inv-login-status');
    try {
      var accessToken = liff.getAccessToken();
      if (!accessToken) {
        if (statusEl) statusEl.textContent = '無法取得 LINE Access Token';
        return;
      }
      if (statusEl) statusEl.textContent = '正在驗證身份...';

      // 先取 LINE Profile 顯示頭像（不等 Firebase）
      try {
        var profile = await liff.getProfile();
        this.currentUser = { uid: null, name: profile.displayName, pictureUrl: profile.pictureUrl || '' };
        InvApp.updateUserUI(this.currentUser);
      } catch (_) {}

      var fn = firebase.app().functions('asia-east1').httpsCallable('createCustomToken');
      var result = await fn({ accessToken: accessToken });
      if (!result.data || !result.data.customToken) {
        if (statusEl) statusEl.textContent = 'Cloud Function 未回傳 Token';
        return;
      }
      await auth.signInWithCustomToken(result.data.customToken);
      if (this.currentUser) this.currentUser.uid = auth.currentUser.uid;
      if (statusEl) statusEl.textContent = '驗證成功，檢查權限中...';
      await this.checkPermission();
    } catch (e) {
      console.error('[InvAuth] authenticate failed:', e);
      if (statusEl) statusEl.textContent = '驗證失敗：' + (e.message || '');
    }
  },

  async checkPermission() {
    try {
      var idToken = await auth.currentUser.getIdToken();
      var restUrl = 'https://firestore.googleapis.com/v1/projects/' + INV_CONFIG.FIREBASE.projectId
        + '/databases/(default)/documents/inv_settings/config';
      var resp = await fetch(restUrl, { headers: { 'Authorization': 'Bearer ' + idToken } });
      if (!resp.ok) {
        document.getElementById('inv-login-status').textContent = '權限檢查失敗（' + resp.status + '）';
        return;
      }
      var json = await resp.json();
      var adminUids = [];
      if (json.fields && json.fields.adminUids && json.fields.adminUids.arrayValue && json.fields.adminUids.arrayValue.values) {
        adminUids = json.fields.adminUids.arrayValue.values.map(function(v) { return v.stringValue; });
      }
      var uid = auth.currentUser.uid;
      if (adminUids.indexOf(uid) !== -1) {
        this.isAdmin = true;
        if (this.currentUser) this.currentUser.uid = uid;
        InvApp.updateUserUI(this.currentUser);
        InvApp.showPage('page-dashboard');
        if (typeof InvDashboard !== 'undefined') InvDashboard.render();
        // 觸發公告檢查
        InvApp.checkAnnouncements();
      } else {
        InvApp.showPage('page-unauthorized');
      }
    } catch (e) {
      console.error('[InvAuth] checkPermission failed:', e);
      document.getElementById('inv-login-status').textContent = '權限檢查失敗：' + (e.message || '');
    }
  },

  getUid() { return auth.currentUser ? auth.currentUser.uid : null; },
  getName() { return this.currentUser ? this.currentUser.name : null; },
};
