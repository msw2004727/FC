/** inv-app.js — routing, theme, icons, user menu, toast, announcements (SportHub topbar+bottombar) */
const InvApp = {
  currentPage: 'page-login', pageHistory: [], _toastTimer: null,
  _pageTitles: { 'page-dashboard':'庫存管理','page-stock-in':'掃碼入庫','page-sale':'掃碼銷售','page-products':'商品管理','page-product-detail':'商品詳情','page-transactions':'銷售紀錄','page-stocktake':'盤點','page-settings':'設定' },

  showPage(pageId) {
    if (pageId !== 'page-login' && pageId !== 'page-unauthorized' && !InvAuth.isAdmin) return;
    document.querySelectorAll('.inv-page').forEach(function(p) { p.classList.remove('active'); });
    var target = document.getElementById(pageId);
    if (target) target.classList.add('active');
    var isChrome = (pageId === 'page-login' || pageId === 'page-unauthorized');
    var tb = document.getElementById('inv-topbar'), bb = document.getElementById('inv-bottombar');
    if (tb) tb.style.display = isChrome ? 'none' : '';
    if (bb) bb.style.display = isChrome ? 'none' : '';
    document.body.style.paddingTop = isChrome ? '0' : '56px';
    document.body.style.paddingBottom = isChrome ? '0' : '64px';
    if (this.currentPage && this.currentPage !== pageId) this.pageHistory.push(this.currentPage);
    this.currentPage = pageId;
    var titleEl = document.querySelector('.inv-topbar-title');
    if (titleEl) titleEl.textContent = this._pageTitles[pageId] || '庫存管理';
    document.querySelectorAll('.inv-tab').forEach(function(btn) { btn.classList.toggle('active', btn.dataset.page === pageId); });
    this._closeUserMenu(); window.scrollTo(0, 0);
    // 頁面切換時觸發對應模組的 render
    this._renderPage(pageId);
  },

  _renderPage(pageId) {
    switch (pageId) {
      case 'page-dashboard': if (typeof InvDashboard !== 'undefined') InvDashboard.render(); break;
      case 'page-stock-in': if (typeof InvStockIn !== 'undefined') InvStockIn.render(); break;
      case 'page-sale': if (typeof InvSale !== 'undefined') InvSale.render(); break;
      case 'page-products': if (typeof InvProducts !== 'undefined') InvProducts.renderProductList('inv-products-content'); break;
      case 'page-transactions': if (typeof InvTransactions !== 'undefined') InvTransactions.render(); break;
      case 'page-stocktake': if (typeof InvStocktake !== 'undefined') InvStocktake.render(); break;
      case 'page-settings': if (typeof InvSettings !== 'undefined') InvSettings.render(); break;
    }
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

  // ── Theme ──
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
    var toggle = document.getElementById('inv-theme-toggle');
    if (toggle) {
      if (theme === 'dark') {
        toggle.classList.add('active');
      } else {
        toggle.classList.remove('active');
      }
    }
  },

  // ── User menu ──
  toggleUserMenu() {
    var menu = document.getElementById('inv-user-menu');
    if (!menu) return;
    if (menu.style.display === 'none') {
      menu.style.display = 'block';
      // close on outside click
      setTimeout(function() {
        document.addEventListener('click', InvApp._outsideMenuHandler, { once: true });
      }, 0);
    } else {
      menu.style.display = 'none';
    }
  },

  _outsideMenuHandler: function(e) {
    var wrap = document.querySelector('.inv-user-menu-wrap');
    if (wrap && !wrap.contains(e.target)) {
      InvApp._closeUserMenu();
    } else {
      // re-listen if clicked inside wrap
      document.addEventListener('click', InvApp._outsideMenuHandler, { once: true });
    }
  },

  _closeUserMenu() {
    var menu = document.getElementById('inv-user-menu');
    if (menu) menu.style.display = 'none';
  },

  // ── Icon injection ──
  injectIcons() {
    if (typeof InvIcons === 'undefined') return;
    document.querySelectorAll('[data-icon]').forEach(function(el) {
      var name = el.dataset.icon;
      var size = el.classList.contains('inv-action-icon') ? 32 : 20;
      if (InvIcons[name]) el.innerHTML = InvIcons[name](size);
    });
  },

  // ── User UI update ──
  updateUserUI(user) {
    if (!user) return;
    // Topbar avatar
    var ta = document.getElementById('inv-topbar-avatar');
    if (ta) { ta.src = user.pictureUrl || ''; ta.style.display = user.pictureUrl ? '' : 'none'; }
    // Menu name
    var mn = document.getElementById('inv-menu-name');
    if (mn) mn.textContent = user.name || '';
    // Login page
    var la = document.getElementById('inv-login-avatar');
    var ln = document.getElementById('inv-login-name');
    var lw = document.getElementById('inv-login-avatar-wrap');
    if (la) la.src = user.pictureUrl || '';
    if (ln) ln.textContent = user.name || '';
    if (lw) lw.style.display = user.pictureUrl ? '' : 'none';
  },

  // ── Announcements ──
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
    var typeColor = ann.type === 'urgent' ? 'var(--danger)' : ann.type === 'warning' ? 'var(--warning)' : 'var(--accent)';
    var iconHtml = typeof InvIcons !== 'undefined' ? InvIcons.megaphone(40) : '';
    overlay.innerHTML = '<div class="inv-modal">'
      + '<div style="text-align:center;color:' + typeColor + ';margin-bottom:12px">' + iconHtml + '</div>'
      + '<h3 style="text-align:center;font-size:18px;margin-bottom:12px">' + esc(ann.title || '公告') + '</h3>'
      + '<div class="inv-modal-body">' + esc(ann.content || '') + '</div>'
      + '<button class="inv-btn primary full" style="margin-top:16px" onclick="InvApp._dismissAnnouncement(\'' + ann._id + '\')">我知道了</button>'
      + '</div>';
    overlay.style.display = 'flex';
    overlay.classList.add('show');
    overlay.onclick = function(e) { if (e.target === overlay) InvApp._dismissAnnouncement(ann._id); };
  },

  _dismissAnnouncement(id) {
    var overlay = document.getElementById('inv-announcement-overlay');
    if (overlay) { overlay.classList.remove('show'); overlay.style.display = 'none'; }
    try { var read = JSON.parse(localStorage.getItem('inv_read_announcements') || '[]'); if (read.indexOf(id) === -1) read.push(id); localStorage.setItem('inv_read_announcements', JSON.stringify(read)); } catch(_) {}
  },

  // ── Toast ──
  showToast(msg, duration) {
    var toast = document.getElementById('inv-toast'); if (!toast) return;
    toast.textContent = msg; toast.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(function() { toast.classList.remove('show'); }, duration || 2500);
  },

  // ── Utilities ──
  escapeHTML(str) { if (!str) return ''; return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); },
  formatDate(date) {
    var d = date instanceof Date ? date : new Date(date); if (isNaN(d.getTime())) return '';
    var p = function(n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '/' + p(d.getMonth()+1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  },
  formatCurrency(amount) { return 'NT$ ' + (Number(amount) || 0).toLocaleString('zh-TW'); },
};

// ── Init ──
document.addEventListener('DOMContentLoaded', function() {
  InvApp.initTheme();
  InvApp.injectIcons();
  if (typeof InvAuth !== 'undefined' && InvAuth.init) InvAuth.init();
});
