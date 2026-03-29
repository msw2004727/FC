/**
 * inv-app.js — 核心路由、主題切換、icon 注入、toast、公告
 */
const InvApp = {
  currentPage: 'page-login',
  pageHistory: [],
  _toastTimer: null,
  _pageTitles: {
    'page-dashboard': '庫存管理',
    'page-stock-in': '掃碼入庫',
    'page-sale': '掃碼銷售',
    'page-products': '商品管理',
    'page-product-detail': '商品詳情',
    'page-transactions': '銷售紀錄',
    'page-stocktake': '盤點',
    'page-settings': '設定',
  },

  // ══════ 頁面切換 ══════
  showPage(pageId) {
    // 登入前不允許進入內頁
    if (pageId !== 'page-login' && pageId !== 'page-unauthorized' && !InvAuth.isAdmin) return;
    var pages = document.querySelectorAll('.inv-page');
    pages.forEach(function(p) { p.classList.remove('active'); });
    var target = document.getElementById(pageId);
    if (target) target.classList.add('active');
    // 登入/無權限頁不進 layout
    var layout = document.getElementById('inv-layout');
    if (layout) layout.style.display = (pageId === 'page-login' || pageId === 'page-unauthorized') ? 'none' : '';
    if (this.currentPage && this.currentPage !== pageId) this.pageHistory.push(this.currentPage);
    this.currentPage = pageId;
    // 更新手機版 header
    var titleEl = document.getElementById('inv-page-title');
    if (titleEl) titleEl.textContent = this._pageTitles[pageId] || '';
    var backBtn = document.getElementById('inv-mobile-back');
    if (backBtn) backBtn.style.display = (pageId === 'page-dashboard') ? 'none' : '';
    // 更新 sidebar active
    document.querySelectorAll('.inv-nav-item').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.page === pageId);
    });
    window.scrollTo(0, 0);
  },

  goBack() {
    if (this.pageHistory.length > 0) {
      var prev = this.pageHistory.pop();
      this.showPage(prev);
      this.pageHistory.pop();
    } else {
      this.showPage('page-dashboard');
      this.pageHistory = [];
    }
  },

  // ══════ 主題切換 ══════
  initTheme() {
    var saved = localStorage.getItem('inv_theme');
    if (!saved) {
      saved = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }
    this._applyTheme(saved);
  },

  toggleTheme() {
    var current = document.documentElement.getAttribute('data-inv-theme') || 'light';
    var next = current === 'light' ? 'dark' : 'light';
    this._applyTheme(next);
    localStorage.setItem('inv_theme', next);
  },

  _applyTheme(theme) {
    document.documentElement.setAttribute('data-inv-theme', theme);
    // 更新切換按鈕 icon
    document.querySelectorAll('.inv-theme-toggle').forEach(function(btn) {
      if (typeof InvIcons !== 'undefined') {
        btn.innerHTML = theme === 'dark' ? InvIcons.sun(18) : InvIcons.moon(18);
      }
    });
  },

  // ══════ Icon 注入 ══════
  injectIcons() {
    if (typeof InvIcons === 'undefined') return;
    document.querySelectorAll('[data-icon]').forEach(function(el) {
      var name = el.dataset.icon;
      var size = el.classList.contains('inv-action-icon') ? 32 : 20;
      if (InvIcons[name]) el.innerHTML = InvIcons[name](size);
    });
  },

  // ══════ 使用者資訊更新 ══════
  updateUserUI(user) {
    if (!user) return;
    var esc = this.escapeHTML;
    // Sidebar
    var sa = document.getElementById('inv-sidebar-avatar');
    if (sa) { sa.src = user.pictureUrl || ''; sa.style.display = user.pictureUrl ? '' : 'none'; }
    var sn = document.getElementById('inv-sidebar-name');
    if (sn) sn.textContent = user.name || '';
    // Mobile header
    var ma = document.getElementById('inv-mobile-avatar');
    if (ma) { ma.src = user.pictureUrl || ''; ma.style.display = user.pictureUrl ? '' : 'none'; }
    // Login page
    var la = document.getElementById('inv-login-avatar');
    var ln = document.getElementById('inv-login-name');
    var lw = document.getElementById('inv-login-avatar-wrap');
    if (la) la.src = user.pictureUrl || '';
    if (ln) ln.textContent = user.name || '';
    if (lw) lw.style.display = user.pictureUrl ? '' : 'none';
  },

  // ══════ 公告彈窗 ══════
  async checkAnnouncements() {
    try {
      var snap = await db.collection('inv_announcements')
        .where('active', '==', true).orderBy('createdAt', 'desc').limit(5).get();
      if (snap.empty) return;
      var read = [];
      try { read = JSON.parse(localStorage.getItem('inv_read_announcements') || '[]'); } catch(_) {}
      var unread = [];
      snap.forEach(function(doc) {
        var d = doc.data();
        d._id = doc.id;
        if (read.indexOf(doc.id) === -1) unread.push(d);
      });
      if (!unread.length) return;
      this._showAnnouncement(unread[0]);
    } catch(_) {}
  },

  _showAnnouncement(ann) {
    var esc = this.escapeHTML;
    var overlay = document.getElementById('inv-announcement-overlay');
    if (!overlay) return;
    var typeColor = ann.type === 'urgent' ? 'var(--danger)' : ann.type === 'warning' ? 'var(--warning)' : 'var(--primary)';
    var iconHtml = typeof InvIcons !== 'undefined' ? InvIcons.megaphone(40) : '';
    overlay.innerHTML = '<div class="inv-modal inv-announcement-modal">'
      + '<div style="text-align:center;color:' + typeColor + ';margin-bottom:12px">' + iconHtml + '</div>'
      + '<h3 style="text-align:center;font-size:18px;margin-bottom:12px">' + esc(ann.title || '公告') + '</h3>'
      + '<div class="inv-modal-body" style="font-size:15px;line-height:1.6;color:var(--inv-text-secondary)">' + esc(ann.content || '') + '</div>'
      + '<button class="inv-btn primary full" style="margin-top:16px" onclick="InvApp._dismissAnnouncement(\'' + ann._id + '\')">我知道了</button>'
      + '</div>';
    overlay.style.display = 'flex';
    overlay.onclick = function(e) { if (e.target === overlay) InvApp._dismissAnnouncement(ann._id); };
  },

  _dismissAnnouncement(id) {
    var overlay = document.getElementById('inv-announcement-overlay');
    if (overlay) overlay.style.display = 'none';
    try {
      var read = JSON.parse(localStorage.getItem('inv_read_announcements') || '[]');
      if (read.indexOf(id) === -1) read.push(id);
      localStorage.setItem('inv_read_announcements', JSON.stringify(read));
    } catch(_) {}
  },

  // ══════ Toast ══════
  showToast(msg, duration) {
    duration = duration || 2500;
    var toast = document.getElementById('inv-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(function() { toast.classList.remove('show'); }, duration);
  },

  // ══════ 工具 ══════
  escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  formatDate(date) {
    var d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    var p = function(n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  },

  formatCurrency(amount) {
    return 'NT$ ' + (Number(amount) || 0).toLocaleString('zh-TW');
  },
};

// ── 啟動 ──
document.addEventListener('DOMContentLoaded', function() {
  InvApp.initTheme();
  InvApp.injectIcons();
  if (typeof InvAuth !== 'undefined' && InvAuth.init) InvAuth.init();
});
