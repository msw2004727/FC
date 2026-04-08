/**
 * inv-permissions.js — 權限目錄、預設值、檢查邏輯
 */
const InvPermissions = {
  // Permission catalog organized by group
  CATALOG: [
    { group: '儀表板', items: [
      { code: 'dashboard.low_stock', label: '低庫存警示', desc: '查看儀表板的低庫存警示區塊，了解哪些商品需要補貨。' },
    ]},
    { group: '入庫', items: [
      { code: 'stockin.restock', label: '補貨入庫', desc: '對已存在的商品進行補貨入庫操作（掃碼入庫、手動輸入、快速補貨按鈕）。' },
      { code: 'stockin.create', label: '新品建檔', desc: '建立全新的商品資料並設定初始庫存。' },
      { code: 'stockin.csv', label: 'CSV 批次匯入', desc: '透過上傳 CSV 檔案一次匯入多筆入庫資料。' },
    ]},
    { group: '銷售', items: [
      { code: 'sale.checkout', label: '銷售結帳', desc: '掃碼加入購物車並完成結帳流程（含預設折扣與收款方式選擇）。' },
      { code: 'sale.custom_discount', label: '自訂折扣', desc: '設定自訂折扣金額（超出預設的 9折/85折/8折 範圍）。' },
      { code: 'sale.gift', label: '贈品出庫', desc: '以 0 元出庫商品（贈品），庫存會減少但不產生營收。' },
      { code: 'sale.staff_purchase', label: '員工內購', desc: '標記為員工內購交易，方便後續統計區分。' },
    ]},
    { group: '庫存管理', items: [
      { code: 'inventory.quick_restock', label: '快速入庫按鈕', desc: '在庫存列表與詳情頁使用「+」按鈕快速補貨。' },
      { code: 'inventory.change_group', label: '變更群組分類', desc: '透過卡片上的下拉選單將商品移到不同群組頁籤（商品/活動/器材/其他）。' },
      { code: 'inventory.edit', label: '編輯商品資料', desc: '修改商品的品名、售價、品牌、分類、圖片等資訊。' },
      { code: 'inventory.edit_barcode', label: '變更產品編號', desc: '修改商品的條碼編號。此操作會建立新文件並刪除舊文件，歷史紀錄保留原編號。' },
      { code: 'inventory.return', label: '退貨', desc: '處理顧客退貨，可選擇退回庫存或直接報廢，會產生退貨交易紀錄。' },
      { code: 'inventory.waste', label: '報廢', desc: '標記損壞、過期或遺失的商品，庫存會相應減少。' },
      { code: 'inventory.quick_correction', label: '快速修正庫存', desc: '在庫存詳情頁直接將庫存修正為指定數量，不受當前庫存影響。此為高權限操作，預設僅負責人可用。' },
    ]},
    { group: '銷售紀錄', items: [
      { code: 'transactions.view', label: '查看交易紀錄', desc: '瀏覽歷史交易紀錄列表，支援日期與類型篩選。' },
      { code: 'transactions.export', label: '匯出 CSV', desc: '將交易紀錄或庫存清單匯出為 CSV 檔案下載。' },
      { code: 'transactions.reports', label: '查看統計報表', desc: '查看日報、週報、月報銷售統計（含熱銷排行與滯銷提醒）。' },
    ]},
    { group: '盤點', items: [
      { code: 'stocktake.start', label: '開始盤點', desc: '建立新的盤點單，選擇盤點範圍（全部或依分類）。' },
      { code: 'stocktake.scan', label: '盤點掃碼', desc: '在進行中的盤點單中掃碼並輸入實際數量。' },
      { code: 'stocktake.apply', label: '確認盤點調整', desc: '查看差異報告後確認批次調整庫存。此操作會直接修改所有有差異的商品庫存。' },
      { code: 'stocktake.history', label: '查看盤點歷史', desc: '瀏覽過去的盤點紀錄，可繼續未完成的盤點。' },
    ]},
    { group: '設定', items: [
      { code: 'settings.entry', label: '進入設定頁', desc: '存取設定頁面（包含以下所有設定功能的入口）。' },
      { code: 'settings.people', label: '人員管理', desc: '新增、移除人員，變更人員角色。' },
      { code: 'settings.shop', label: '修改店名', desc: '修改店鋪名稱。' },
      { code: 'settings.categories', label: '分類管理', desc: '新增、刪除、排序商品分類。' },
      { code: 'settings.barcode_print', label: '條碼列印', desc: '輸入條碼編號產生條碼圖片並列印標籤。' },
      { code: 'settings.rebuild', label: '庫存重建', desc: '根據所有交易紀錄重新計算庫存。危險操作，會覆蓋所有庫存數字。' },
      { code: 'settings.announcements', label: '公告管理', desc: '新增、編輯、啟停、刪除登入公告。' },
    ]},
    { group: '導航', items: [
      { code: 'nav.stockin', label: '入庫頁籤', desc: '底部導航是否顯示「入庫」頁籤。' },
      { code: 'nav.transactions', label: '更多頁籤', desc: '底部導航是否顯示「更多」頁籤（銷售紀錄入口）。' },
    ]},
  ],

  // Default permissions per role (owner always has all, not listed here)
  DEFAULTS: {
    manager: {
      'dashboard.low_stock': true,
      'stockin.restock': true, 'stockin.create': true, 'stockin.csv': true,
      'sale.checkout': true, 'sale.custom_discount': true, 'sale.gift': true, 'sale.staff_purchase': true,
      'inventory.quick_restock': true, 'inventory.change_group': true, 'inventory.edit': true,
      'inventory.edit_barcode': true, 'inventory.return': true, 'inventory.waste': true, 'inventory.quick_correction': false,
      'transactions.view': true, 'transactions.export': true, 'transactions.reports': true,
      'stocktake.start': true, 'stocktake.scan': true, 'stocktake.apply': true, 'stocktake.history': true,
      'settings.entry': true, 'settings.people': true, 'settings.shop': true, 'settings.categories': true,
      'settings.barcode_print': true, 'settings.rebuild': false, 'settings.announcements': true,
      'nav.stockin': true, 'nav.transactions': true,
    },
    leader: {
      'dashboard.low_stock': true,
      'stockin.restock': true, 'stockin.create': true, 'stockin.csv': false,
      'sale.checkout': true, 'sale.custom_discount': true, 'sale.gift': true, 'sale.staff_purchase': true,
      'inventory.quick_restock': true, 'inventory.change_group': true, 'inventory.edit': true,
      'inventory.edit_barcode': false, 'inventory.return': true, 'inventory.waste': true, 'inventory.quick_correction': false,
      'transactions.view': true, 'transactions.export': true, 'transactions.reports': true,
      'stocktake.start': true, 'stocktake.scan': true, 'stocktake.apply': true, 'stocktake.history': true,
      'settings.entry': false, 'settings.people': false, 'settings.shop': false, 'settings.categories': false,
      'settings.barcode_print': false, 'settings.rebuild': false, 'settings.announcements': false,
      'nav.stockin': true, 'nav.transactions': true,
    },
    staff: {
      'dashboard.low_stock': true,
      'stockin.restock': true, 'stockin.create': false, 'stockin.csv': false,
      'sale.checkout': true, 'sale.custom_discount': false, 'sale.gift': false, 'sale.staff_purchase': false,
      'inventory.quick_restock': true, 'inventory.change_group': false, 'inventory.edit': false,
      'inventory.edit_barcode': false, 'inventory.return': false, 'inventory.waste': false, 'inventory.quick_correction': false,
      'transactions.view': true, 'transactions.export': false, 'transactions.reports': false,
      'stocktake.start': false, 'stocktake.scan': true, 'stocktake.apply': false, 'stocktake.history': true,
      'settings.entry': false, 'settings.people': false, 'settings.shop': false, 'settings.categories': false,
      'settings.barcode_print': false, 'settings.rebuild': false, 'settings.announcements': false,
      'nav.stockin': true, 'nav.transactions': true,
    },
    part: {
      'dashboard.low_stock': false,
      'stockin.restock': false, 'stockin.create': false, 'stockin.csv': false,
      'sale.checkout': true, 'sale.custom_discount': false, 'sale.gift': false, 'sale.staff_purchase': false,
      'inventory.quick_restock': false, 'inventory.change_group': false, 'inventory.edit': false,
      'inventory.edit_barcode': false, 'inventory.return': false, 'inventory.waste': false, 'inventory.quick_correction': false,
      'transactions.view': false, 'transactions.export': false, 'transactions.reports': false,
      'stocktake.start': false, 'stocktake.scan': false, 'stocktake.apply': false, 'stocktake.history': false,
      'settings.entry': false, 'settings.people': false, 'settings.shop': false, 'settings.categories': false,
      'settings.barcode_print': false, 'settings.rebuild': false, 'settings.announcements': false,
      'nav.stockin': false, 'nav.transactions': false,
    },
  },

  _customPerms: null, // loaded from Firestore

  /** Load custom permissions from Firestore inv_settings/config.rolePermissions */
  async loadCustomPerms() {
    try {
      var doc = await db.collection('inv_settings').doc('config').get();
      if (doc.exists && doc.data().rolePermissions) {
        this._customPerms = doc.data().rolePermissions;
      }
    } catch (_) {}
  },

  /** Check if current user has a specific permission */
  hasPerm(code) {
    var role = InvAuth.getRole();
    if (role === 'owner') return true; // owner always has all
    // Check custom overrides first
    if (this._customPerms && this._customPerms[role] && typeof this._customPerms[role][code] === 'boolean') {
      return this._customPerms[role][code];
    }
    // Fall back to defaults
    var defaults = this.DEFAULTS[role];
    return defaults ? (defaults[code] === true) : false;
  },

  /** Get merged permissions for a role (defaults + custom overrides) */
  getMergedPerms(role) {
    var defaults = this.DEFAULTS[role] || {};
    var custom = (this._customPerms && this._customPerms[role]) || {};
    var merged = {};
    // Get all permission codes from catalog
    for (var gi = 0; gi < this.CATALOG.length; gi++) {
      var items = this.CATALOG[gi].items;
      for (var ii = 0; ii < items.length; ii++) {
        var code = items[ii].code;
        merged[code] = typeof custom[code] === 'boolean' ? custom[code] : (defaults[code] === true);
      }
    }
    return merged;
  },

  /** Save a single permission toggle for a role to Firestore */
  async savePerm(role, code, value) {
    var field = 'rolePermissions.' + role + '.' + code;
    var update = {};
    update[field] = value;
    await db.collection('inv_settings').doc('config').update(update);
    // Update local cache
    if (!this._customPerms) this._customPerms = {};
    if (!this._customPerms[role]) this._customPerms[role] = {};
    this._customPerms[role][code] = value;
  },

  /** Get all permission codes as flat array */
  getAllCodes() {
    var codes = [];
    for (var gi = 0; gi < this.CATALOG.length; gi++) {
      var items = this.CATALOG[gi].items;
      for (var ii = 0; ii < items.length; ii++) {
        codes.push(items[ii].code);
      }
    }
    return codes;
  },
};
