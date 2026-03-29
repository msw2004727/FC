/**
 * inv-app.js
 * App 核心 — 頁面路由、toast、goBack、共用格式化
 */
const InvApp = {
  currentPage: 'page-dashboard',
  pageHistory: [],

  /**
   * 切換頁面：隱藏所有 .inv-page，顯示目標頁面，並推入 history
   * @param {string} pageId - 目標頁面的 DOM id
   */
  showPage(pageId) {
    var pages = document.querySelectorAll('.inv-page');
    pages.forEach(function(p) { p.classList.remove('active'); });

    var target = document.getElementById(pageId);
    if (target) {
      target.classList.add('active');
    }

    if (this.currentPage && this.currentPage !== pageId) {
      this.pageHistory.push(this.currentPage);
    }
    this.currentPage = pageId;
  },

  /**
   * 返回上一頁；若無歷史則回 dashboard
   */
  goBack() {
    if (this.pageHistory.length > 0) {
      const prev = this.pageHistory.pop();
      this.showPage(prev);
      // showPage 會再 push，這裡要移除多餘的紀錄
      this.pageHistory.pop();
    } else {
      this.showPage('page-dashboard');
      this.pageHistory = [];
    }
  },

  /**
   * 底部 Toast 提示
   * @param {string} msg  - 顯示訊息
   * @param {number} duration - 持續毫秒數（預設 2000）
   */
  showToast(msg, duration = 2000) {
    let toast = document.getElementById('inv-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'inv-toast';
      toast.style.cssText =
        'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
        'background:rgba(0,0,0,0.78);color:#fff;padding:10px 24px;' +
        'border-radius:8px;font-size:14px;z-index:9999;' +
        'transition:opacity .3s;pointer-events:none;';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.opacity = '1';
    clearTimeout(InvApp._toastTimer);
    InvApp._toastTimer = setTimeout(() => {
      toast.style.opacity = '0';
    }, duration);
  },
  _toastTimer: null,

  /**
   * XSS 防護：跳脫 HTML 特殊字元
   * @param {string} str
   * @returns {string}
   */
  escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  /**
   * 格式化日期為 YYYY/MM/DD HH:MM
   * @param {Date|string|number} date
   * @returns {string}
   */
  formatDate(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return (
      d.getFullYear() + '/' +
      pad(d.getMonth() + 1) + '/' +
      pad(d.getDate()) + ' ' +
      pad(d.getHours()) + ':' +
      pad(d.getMinutes())
    );
  },

  /**
   * 格式化金額為 NT$ + 千分位
   * @param {number} amount
   * @returns {string}
   */
  formatCurrency(amount) {
    const n = Number(amount) || 0;
    return 'NT$ ' + n.toLocaleString('zh-TW');
  },
};

// --- 啟動 ---
document.addEventListener('DOMContentLoaded', () => {
  if (typeof InvAuth !== 'undefined' && InvAuth.init) {
    InvAuth.init();
  }
});
