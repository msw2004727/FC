/**
 * inv-store.js — 多庫存管理（庫存切換 + Firestore 路徑封裝）
 * 載入順序：inv-config.js → inv-store.js → inv-icons.js → ...
 */
const InvStore = {
  _id: null,
  _name: null,
  _assignedStores: null, // 從 inv_settings/config.storeAssignments 載入

  STORES: [
    { id: 'A', name: '庫存A' },
    { id: 'B', name: '庫存B' },
    { id: 'C', name: '庫存C' },
    { id: 'D', name: '庫存D' },
  ],

  /** 取得 Firestore 子集合（以當前庫存為範圍） */
  col: function (name) {
    if (!this._id) throw new Error('尚未選擇庫存');
    return db.collection('inv_stores').doc(this._id).collection(name);
  },

  /** 取得當前庫存文件參照（存放 per-store 設定：categories, shopName, barcodePrefix 等） */
  storeRef: function () {
    if (!this._id) throw new Error('尚未選擇庫存');
    return db.collection('inv_stores').doc(this._id);
  },

  /** 設定當前庫存 */
  setStore: function (storeId) {
    var store = null;
    for (var i = 0; i < this.STORES.length; i++) {
      if (this.STORES[i].id === storeId) { store = this.STORES[i]; break; }
    }
    if (!store) throw new Error('無效的庫存 ID: ' + storeId);
    this._id = store.id;
    this._name = store.name;
    localStorage.setItem('inv_current_store', storeId);
    // 切換庫存時清除模組快取，確保重新載入該庫存資料
    if (typeof InvProducts !== 'undefined') { InvProducts._cache = []; InvProducts._loaded = false; }
  },

  getId: function () { return this._id; },
  getName: function () { return this._name; },

  /** 取得當前用戶可存取的庫存列表 */
  getAccessibleStores: function () {
    var role = typeof InvAuth !== 'undefined' ? InvAuth.getRole() : '';
    if (role === 'owner' || role === 'manager') return this.STORES.slice();
    if (this._assignedStores && this._assignedStores.length) {
      var assigned = this._assignedStores;
      return this.STORES.filter(function (s) { return assigned.indexOf(s.id) !== -1; });
    }
    // 預設：若無指定則只能進庫存A（向下相容）
    return [this.STORES[0]];
  },

  /** 從 inv_settings/config 載入 storeAssignments */
  loadAssignments: async function (cfg) {
    var uid = typeof InvAuth !== 'undefined' ? InvAuth.getUid() : null;
    if (!uid) return;
    var assignments = (cfg && cfg.storeAssignments) ? cfg.storeAssignments : {};
    this._assignedStores = assignments[uid] || null;
  },

  /** 顯示庫存選擇器彈窗（先從 Firestore 讀取各庫存顯示名稱） */
  showSelector: async function (callback) {
    // 移除之前的選擇器
    var prev = document.getElementById('inv-store-selector');
    if (prev) prev.remove();

    var stores = this.getAccessibleStores();
    console.log('[InvStore] showSelector stores:', stores.length, 'role:', (typeof InvAuth !== 'undefined' ? InvAuth.getRole() : 'N/A'));

    // 讀取各庫存的顯示名稱（shopName）
    var displayNames = {};
    try {
      var promises = stores.map(function (s) {
        return db.collection('inv_stores').doc(s.id).get().then(function (doc) {
          if (doc.exists && doc.data().shopName) displayNames[s.id] = doc.data().shopName;
        });
      });
      await Promise.all(promises);
    } catch (_) {}

    // 只有一個庫存時自動選取，跳過選擇器
    if (stores.length === 1) {
      this.setStore(stores[0].id);
      this._name = displayNames[stores[0].id] || this._name;
      if (callback) callback();
      return;
    }

    var lastStore = localStorage.getItem('inv_current_store') || '';
    var esc = typeof InvApp !== 'undefined' ? InvApp.escapeHTML : function (s) { return s; };

    var overlay = document.createElement('div');
    overlay.id = 'inv-store-selector';
    overlay.className = 'inv-overlay show';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);opacity:1;pointer-events:auto';
    overlay.addEventListener('touchmove', function (e) {
      if (!e.target.closest('.inv-modal')) { e.preventDefault(); e.stopPropagation(); }
    }, { passive: false });

    var btnsHtml = '';
    for (var i = 0; i < stores.length; i++) {
      var s = stores[i];
      var displayName = displayNames[s.id] || s.name;
      var isCurrent = s.id === lastStore;
      var borderStyle = isCurrent
        ? 'border:2px solid var(--accent);background:var(--accent-subtle)'
        : 'border:1px solid var(--border);background:var(--bg-card)';
      var labelExtra = isCurrent ? '<div style="font-size:11px;color:var(--accent);margin-top:2px">上次使用</div>' : '';
      btnsHtml +=
        '<button class="inv-store-btn" data-store="' + esc(s.id) + '" data-display="' + esc(displayName) + '" style="flex:1;min-width:calc(50% - 6px);padding:18px 12px;border-radius:12px;' + borderStyle + ';cursor:pointer;text-align:center">' +
          '<div style="font-size:16px;font-weight:700;color:var(--text-primary)">' + esc(displayName) + '</div>' +
          labelExtra +
        '</button>';
    }

    var isDark = document.documentElement.getAttribute('data-inv-theme') === 'dark';
    var logoSrc = isDark ? '../LOGO/logowhite.png' : '../LOGO/logoblack.png';

    overlay.innerHTML =
      '<div class="inv-modal" style="max-width:360px;width:88%;padding:28px 24px">' +
        '<div style="display:flex;flex-direction:column;align-items:center;margin-bottom:16px;overflow:hidden">' +
          '<div style="width:75%;max-width:260px;height:48px;overflow:hidden;display:flex;align-items:center;justify-content:center">' +
            '<img src="' + logoSrc + '" alt="ToosterX" style="width:100%;object-fit:contain">' +
          '</div>' +
          '<div style="font-size:15px;font-weight:600;color:var(--text-secondary);letter-spacing:2px;margin-top:2px">庫存系統</div>' +
        '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:10px">' + btnsHtml + '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var self = this;
    overlay.querySelectorAll('.inv-store-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var storeId = this.getAttribute('data-store');
        var name = this.getAttribute('data-display');
        self.setStore(storeId);
        self._name = name || self._name;
        overlay.remove();
        if (callback) callback();
      });
    });
  },

  /** 更新 topbar 標題：庫存名稱 + 頁籤浮水印 */
  updateTopbarTitle: function (pageTitle) {
    // 庫存名稱（logo 右邊正常顯示）
    var titleEl = document.querySelector('.inv-topbar-title');
    if (titleEl) titleEl.textContent = this._name || '庫存管理';
    // 頁籤名稱（大字半透明疊在 logo 前）
    var labelEl = document.getElementById('inv-page-label');
    if (labelEl) labelEl.textContent = pageTitle || '';
  },
};
