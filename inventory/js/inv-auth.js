/**
 * inv-auth.js — LINE LIFF 登入 + Firebase Auth persistence 恢復 + 權限檢查
 */
const InvAuth = {
  currentUser: null,
  isAdmin: false,

  // ── 角色常數 ──
  ROLE_OWNER: 'owner',       // 工程師
  ROLE_MANAGER: 'manager',   // 負責人
  ROLE_LEADER: 'leader',     // 店長
  ROLE_STAFF: 'staff',       // 店員
  ROLE_PART: 'part',         // 工讀
  _role: '',
  _OWNER_UID: 'U7774e1410479bafff4997f51b2c47b95',

  async init() {
    // Step 1: 等待 Firebase Auth 從 IndexedDB 恢復（最多 3 秒）
    var authRestored = await this._waitAuthRestore();

    // Step 2: 如果 Auth 已從 persistence 恢復，跳過 LIFF 登入流程
    if (authRestored && auth.currentUser) {
      console.log('[InvAuth] Auth 已從 persistence 恢復, uid:', auth.currentUser.uid);
      this.currentUser = { uid: auth.currentUser.uid, name: '', pictureUrl: '' };
      // 嘗試取 LIFF profile 補齊頭像暱稱（非阻塞）
      try {
        await liff.init({ liffId: INV_CONFIG.LIFF_ID });
        if (liff.isLoggedIn()) {
          var profile = await liff.getProfile();
          this.currentUser.name = profile.displayName;
          this.currentUser.pictureUrl = profile.pictureUrl || '';
          InvApp.updateUserUI(this.currentUser);
        }
      } catch (_) {}
      // 刷新 token 確保仍有效
      try { await auth.currentUser.getIdToken(true); } catch (_) {}
      var statusEl = document.getElementById('inv-login-status');
      if (statusEl) statusEl.textContent = '驗證成功，檢查權限中...';
      await this.checkPermission();
      return;
    }

    // Step 3: 沒有 persistence → 走正常 LIFF 登入流程
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

  /** 等待 Firebase Auth 狀態從 IndexedDB 恢復，最多 3 秒 */
  _waitAuthRestore() {
    return new Promise(function(resolve) {
      if (auth.currentUser) { resolve(true); return; }
      var done = false;
      var unsub = auth.onAuthStateChanged(function(user) {
        if (done) return;
        done = true;
        unsub();
        resolve(!!user);
      });
      // 3 秒超時（persistence 沒有資料時不會觸發 onAuthStateChanged）
      setTimeout(function() {
        if (done) return;
        done = true;
        resolve(false);
      }, 3000);
    });
  },

  async login() {
    try { liff.login({ redirectUri: window.location.href }); } catch (_) { InvApp.showToast('登入失敗'); }
  },

  async logout() {
    InvUtils.writeLog('logout', '');
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
      // 先取 LINE Profile 顯示頭像
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
      var configDoc = await db.collection('inv_settings').doc('config').get();
      if (!configDoc.exists) {
        document.getElementById('inv-login-status').textContent = '設定檔案不存在';
        return;
      }
      var cfg = configDoc.data();
      var adminUids = cfg.adminUids || [];
      var uid = auth.currentUser.uid;
      if (adminUids.indexOf(uid) !== -1) {
        this.isAdmin = true;
        this._resolveRole(uid, cfg);
        // Load custom role permissions
        if (typeof InvPermissions !== 'undefined') await InvPermissions.loadCustomPerms();
        if (this.currentUser) this.currentUser.uid = uid;
        InvApp.updateUserUI(this.currentUser);
        InvUtils.writeLog('login', this.getRoleName() + ' ' + (this.currentUser.name || uid));
        InvApp.showPage('page-dashboard');
        if (typeof InvDashboard !== 'undefined') InvDashboard.render();
        InvApp.checkAnnouncements();
      } else {
        InvApp.showPage('page-unauthorized');
      }
    } catch (e) {
      console.error('[InvAuth] checkPermission failed:', e);
      document.getElementById('inv-login-status').textContent = '權限檢查失敗：' + (e.message || '');
    }
  },

  /** 根據 config 判定角色 */
  _resolveRole(uid, cfg) {
    var superAdmins = cfg.superAdminUids || [];
    var staffUids = cfg.staffUids || [];
    var partTimeUids = cfg.partTimeUids || [];
    if (uid === this._OWNER_UID) { this._role = this.ROLE_OWNER; }
    else if (superAdmins.indexOf(uid) !== -1) { this._role = this.ROLE_MANAGER; }
    else if (staffUids.indexOf(uid) !== -1) { this._role = this.ROLE_STAFF; }
    else if (partTimeUids.indexOf(uid) !== -1) { this._role = this.ROLE_PART; }
    else { this._role = this.ROLE_LEADER; } // 預設店長
  },

  getUid() { return auth.currentUser ? auth.currentUser.uid : null; },
  getName() { return this.currentUser ? this.currentUser.name : null; },
  getRole() { return this._role; },

  /** 角色顯示名稱 */
  getRoleName() {
    var map = { owner: '工程師', manager: '負責人', leader: '店長', staff: '店員', part: '工讀' };
    return map[this._role] || '店長';
  },

  /** 是否可看進貨價（工程師 + 負責人） */
  canSeeCost() {
    return this._role === this.ROLE_OWNER || this._role === this.ROLE_MANAGER;
  },

  /** 權限檢查便捷方法 */
  hasPerm(code) {
    if (this._role === this.ROLE_OWNER) return true;
    return typeof InvPermissions !== 'undefined' ? InvPermissions.hasPerm(code) : true;
  },
};
