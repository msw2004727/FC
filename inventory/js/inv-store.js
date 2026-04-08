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

  /** 顯示庫存選擇器彈窗 */
  showSelector: function (callback) {
    // 移除之前的選擇器（切換庫存時可能重複開啟）
    var prev = document.getElementById('inv-store-selector');
    if (prev) prev.remove();

    var stores = this.getAccessibleStores();
    console.log('[InvStore] showSelector stores:', stores.length, 'role:', (typeof InvAuth !== 'undefined' ? InvAuth.getRole() : 'N/A'));
    // 只有一個庫存時自動選取，跳過選擇器
    if (stores.length === 1) {
      this.setStore(stores[0].id);
      if (callback) callback();
      return;
    }

    var lastStore = localStorage.getItem('inv_current_store') || '';
    var esc = typeof InvApp !== 'undefined' ? InvApp.escapeHTML : function (s) { return s; };

    var overlay = document.createElement('div');
    overlay.id = 'inv-store-selector';
    overlay.className = 'inv-overlay show';
    // 強制內聯樣式確保在任何頁面狀態下都可見
    overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);opacity:1;pointer-events:auto';
    overlay.addEventListener('touchmove', function (e) {
      if (!e.target.closest('.inv-modal')) { e.preventDefault(); e.stopPropagation(); }
    }, { passive: false });

    var btnsHtml = '';
    for (var i = 0; i < stores.length; i++) {
      var s = stores[i];
      var isCurrent = s.id === lastStore;
      var borderStyle = isCurrent
        ? 'border:2px solid var(--accent);background:var(--accent-subtle)'
        : 'border:1px solid var(--border);background:var(--bg-card)';
      var labelExtra = isCurrent ? '<div style="font-size:11px;color:var(--accent);margin-top:2px">上次使用</div>' : '';
      btnsHtml +=
        '<button class="inv-store-btn" data-store="' + esc(s.id) + '" style="flex:1;min-width:calc(50% - 6px);padding:18px 12px;border-radius:12px;' + borderStyle + ';cursor:pointer;text-align:center">' +
          '<div style="font-size:16px;font-weight:700;color:var(--text-primary)">' + esc(s.name) + '</div>' +
          labelExtra +
        '</button>';
    }

    var isDark = document.documentElement.getAttribute('data-inv-theme') === 'dark';
    var logoSrc = isDark ? '../LOGO/logowhite.png' : '../LOGO/logoblack.png';

    overlay.innerHTML =
      '<div class="inv-modal" style="max-width:360px;width:88%">' +
        '<div style="text-align:center;margin-bottom:16px">' +
          '<img src="' + logoSrc + '" alt="ToosterX" style="height:32px;margin-bottom:8px">' +
          '<div style="font-size:16px;font-weight:700;color:var(--text-primary)">庫存系統</div>' +
        '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:10px">' + btnsHtml + '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var self = this;
    overlay.querySelectorAll('.inv-store-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var storeId = this.getAttribute('data-store');
        self.setStore(storeId);
        overlay.remove();
        if (callback) callback();
      });
    });
  },

  /** 更新 topbar 標題（加上庫存名稱） */
  updateTopbarTitle: function (pageTitle) {
    var titleEl = document.querySelector('.inv-topbar-title');
    if (!titleEl) return;
    var suffix = this._name ? '（' + this._name + '）' : '';
    titleEl.textContent = (pageTitle || '庫存管理') + suffix;
  },
};
