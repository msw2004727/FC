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
};
