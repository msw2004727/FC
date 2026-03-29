/**
 * inv-auth.js
 * LINE LIFF 登入 + 權限檢查模組
 */
var _invDebug = location.search.indexOf('debug=1') !== -1;
function _dbg(msg) {
  if (!_invDebug) return;
  console.log('[INV-DEBUG] ' + msg);
  var el = document.getElementById('inv-login-status');
  if (el) el.textContent = msg;
}

const InvAuth = {
  currentUser: null,
  isAdmin: false,

  async init() {
    _dbg('1. LIFF init 開始...');
    try {
      await liff.init({ liffId: INV_CONFIG.LIFF_ID });
      _dbg('2. LIFF init 成功');
    } catch (e) {
      _dbg('2. LIFF init 失敗: ' + e.message);
      InvApp.showToast('LIFF 初始化失敗');
      return;
    }

    _dbg('3. isInClient=' + liff.isInClient() + ' isLoggedIn=' + liff.isLoggedIn());

    if (!liff.isInClient() && !liff.isLoggedIn()) {
      _dbg('3a. 外部瀏覽器未登入，顯示登入按鈕');
      var btn = document.getElementById('inv-login-btn');
      if (btn) btn.style.display = '';
      return;
    }

    if (liff.isLoggedIn()) {
      _dbg('4. 已登入，開始驗證...');
      await this.authenticate();
    } else {
      _dbg('4. LINE 內未登入，顯示登入按鈕');
      var btn2 = document.getElementById('inv-login-btn');
      if (btn2) btn2.style.display = '';
    }
  },

  async login() {
    try {
      liff.login({ redirectUri: window.location.href });
    } catch (e) {
      InvApp.showToast('登入失敗');
    }
  },

  async authenticate() {
    var statusEl = document.getElementById('inv-login-status');
    try {
      var accessToken = liff.getAccessToken();
      _dbg('5. AccessToken: ' + (accessToken ? '有(' + accessToken.slice(0,8) + '...)' : '無'));
      if (!accessToken) {
        if (statusEl) statusEl.textContent = '無法取得 LINE Access Token';
        return;
      }

      if (statusEl) statusEl.textContent = '正在驗證身份...';
      _dbg('6. 呼叫 createCustomToken...');
      var fn = firebase.app().functions('asia-east1').httpsCallable('createCustomToken');
      var result = await fn({ accessToken: accessToken });
      _dbg('7. createCustomToken 回傳: ' + (result.data ? 'OK' : 'EMPTY'));

      if (!result.data || !result.data.customToken) {
        if (statusEl) statusEl.textContent = 'Cloud Function 未回傳 Token';
        return;
      }

      _dbg('8. signInWithCustomToken...');
      await auth.signInWithCustomToken(result.data.customToken);
      var uid = auth.currentUser ? auth.currentUser.uid : 'null';
      _dbg('9. Firebase 登入成功 uid=' + uid);

      if (statusEl) statusEl.textContent = '驗證成功，檢查權限中...';
      await this.checkPermission();
    } catch (e) {
      _dbg('ERROR authenticate: ' + e.message);
      if (statusEl) statusEl.textContent = '驗證失敗：' + (e.message || '未知錯誤');
    }
  },

  async checkPermission() {
    try {
      _dbg('10. 取得 ID Token...');
      var idToken = await auth.currentUser.getIdToken();
      _dbg('11. ID Token: ' + (idToken ? idToken.slice(0,20) + '...' : 'null'));

      var restUrl = 'https://firestore.googleapis.com/v1/projects/' + INV_CONFIG.FIREBASE.projectId
        + '/databases/(default)/documents/inv_settings/config';
      _dbg('12. fetch REST API...');

      var resp = await fetch(restUrl, {
        headers: { 'Authorization': 'Bearer ' + idToken }
      });
      _dbg('13. REST 回應 status=' + resp.status);

      if (!resp.ok) {
        var errText = await resp.text();
        _dbg('13a. REST 錯誤: ' + errText.slice(0, 200));
        document.getElementById('inv-login-status').textContent = '權限檢查失敗（' + resp.status + '）';
        return;
      }

      var json = await resp.json();
      _dbg('14. 解析 JSON 成功，fields=' + Object.keys(json.fields || {}).join(','));

      var adminUids = [];
      if (json.fields && json.fields.adminUids && json.fields.adminUids.arrayValue && json.fields.adminUids.arrayValue.values) {
        adminUids = json.fields.adminUids.arrayValue.values.map(function(v) { return v.stringValue; });
      }
      var uid = auth.currentUser.uid;
      _dbg('15. adminUids=[' + adminUids.join(',') + '] myUid=' + uid);

      if (adminUids.indexOf(uid) !== -1) {
        _dbg('16. 權限通過！');
        this.isAdmin = true;
        try {
          var profile = await liff.getProfile();
          this.currentUser = { uid: uid, name: profile.displayName, pictureUrl: profile.pictureUrl || '' };
        } catch (_) {
          this.currentUser = { uid: uid, name: '管理員', pictureUrl: '' };
        }
        InvApp.showPage('page-dashboard');
        if (typeof InvDashboard !== 'undefined') InvDashboard.render();
      } else {
        _dbg('16. 權限不足，uid 不在白名單');
        InvApp.showPage('page-unauthorized');
      }
    } catch (e) {
      _dbg('ERROR checkPermission: ' + e.message);
      document.getElementById('inv-login-status').textContent = '權限檢查失敗：' + (e.message || '');
    }
  },

  getUid() { return auth.currentUser ? auth.currentUser.uid : null; },
  getName() { return this.currentUser ? this.currentUser.name : null; },
};
