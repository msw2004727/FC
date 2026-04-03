/**
 * inv-utils.js
 * 共用工具函式
 */
const InvUtils = {
  /**
   * 今天日期字串 YYYY-MM-DD
   * @returns {string}
   */
  todayStr() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  },

  /**
   * 目前時間字串 HH:MM
   * @returns {string}
   */
  nowTimeStr() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  },

  /**
   * 產生唯一 ID
   * @param {string} prefix - 前綴（預設 'inv_'）
   * @returns {string}
   */
  generateId(prefix = 'inv_') {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 8);
    return prefix + ts + rand;
  },

  /**
   * 產生銷貨單號 — 格式 SYYYYMMDD-NNN（當日流水號）
   * 用 localStorage 記錄當日已用序號
   * @returns {string}
   */
  generateReceiptNo() {
    const today = InvUtils.todayStr().replace(/-/g, '');
    const key = 'inv_receipt_' + today;

    let seq = parseInt(localStorage.getItem(key) || '0', 10);
    seq += 1;
    localStorage.setItem(key, String(seq));

    const seqStr = String(seq).padStart(3, '0');
    return 'S' + today + '-' + seqStr;
  },

  /**
   * 計算折扣後金額
   * @param {number} subtotal - 小計
   * @param {'percent'|'fixed'} discountType - 折扣類型
   * @param {number} discountValue - 折扣值（百分比 0-100 或固定金額）
   * @returns {number} 折扣後金額（不低於 0）
   */
  calcDiscount(subtotal, discountType, discountValue) {
    const sub = Number(subtotal) || 0;
    const val = Number(discountValue) || 0;

    if (discountType === 'percent') {
      const rate = Math.min(Math.max(val, 0), 100);
      return Math.max(sub - sub * (rate / 100), 0);
    }
    if (discountType === 'fixed') {
      return Math.max(sub - val, 0);
    }
    return sub;
  },

  /**
   * 四捨五入取整
   * @param {number} n
   * @returns {number}
   */
  roundAmount(n) {
    return Math.round(Number(n) || 0);
  },

  /**
   * 驗證條碼：非空且只含英數字
   * @param {string} code
   * @returns {boolean}
   */
  validateBarcode(code) {
    if (!code || typeof code !== 'string') return false;
    return /^[A-Za-z0-9]+$/.test(code.trim());
  },

  /**
   * 寫入操作紀錄到 inv_logs
   * @param {string} action 行為代碼
   * @param {string} detail 詳情文字
   */
  writeLog(action, detail) {
    try {
      var uid = typeof InvAuth !== 'undefined' ? InvAuth.getUid() : null;
      var name = typeof InvAuth !== 'undefined' ? (InvAuth.getName() || '') : '';
      if (!uid) return;
      db.collection('inv_logs').add({
        uid: uid,
        name: name,
        action: action,
        detail: detail || '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    } catch (_) {}
  },

  /** 行為代碼 → 中文 */
  LOG_LABELS: {
    login: '登入', logout: '登出',
    product_create: '新增商品', product_edit: '編輯商品', product_barcode_rename: '條碼變更',
    stock_in: '入庫', stock_in_csv: 'CSV批次入庫', quick_restock: '快速補貨',
    sale: '銷售結帳', sale_return: '退貨', sale_waste: '報廢',
    stocktake_start: '開始盤點', stocktake_apply: '盤點調整',
    setting_shop_name: '修改店名', setting_admin_add: '新增人員', setting_admin_remove: '移除人員',
    setting_admin_role: '變更角色', setting_category: '分類管理', setting_barcode_prefix: '條碼前綴',
    announcement_create: '新增公告', announcement_edit: '編輯公告', announcement_delete: '刪除公告',
    barcode_print: '條碼列印', stock_rebuild: '庫存重建',
  },

  /**
   * 圖片裁切壓縮 — 選擇正方形區域，輸出指定尺寸的 JPEG base64
   * @param {File} file
   * @param {object} opts  { maxSize: 400, quality: 0.8 }
   * @returns {Promise<string>} base64 dataURL
   */
  /**
   * 自動產生不重複條碼編號（Firestore transaction 遞增）
   * 格式：prefix + 6 位數字（如 TX000001）
   * @returns {Promise<string>}
   */
  async generateBarcode() {
    var cfgRef = db.collection('inv_settings').doc('config');
    var result = await db.runTransaction(async function(tx) {
      var doc = await tx.get(cfgRef);
      var data = doc.exists ? doc.data() : {};
      var prefix = data.barcodePrefix || 'TX';
      var next = (data.nextBarcode || 0) + 1;
      tx.update(cfgRef, { nextBarcode: next });
      return prefix + String(next).padStart(6, '0');
    });
    return result;
  },

  cropImageSquare(file, opts) {
    opts = opts || {};
    var maxSize = opts.maxSize || 400;
    var quality = opts.quality || 0.8;
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function() { reject(new Error('讀取圖片失敗')); };
      reader.onload = function() {
        var img = new Image();
        img.onerror = function() { reject(new Error('圖片格式無效')); };
        img.onload = function() {
          var w = img.width, h = img.height;
          var side = Math.min(w, h);
          var sx = (w - side) / 2, sy = (h - side) / 2;
          var outSize = Math.min(side, maxSize);
          var canvas = document.createElement('canvas');
          canvas.width = outSize;
          canvas.height = outSize;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, sx, sy, side, side, 0, 0, outSize, outSize);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  },
};
