/* ================================================
   SportHub — Navigation, Drawer, Modal
   ================================================ */

Object.assign(App, {

  /** 正式版未登入時擋住並提示，回傳 true 代表被擋 */
  _requireLogin() {
    if (ModeManager.isDemo()) return false;
    if (typeof LineAuth !== 'undefined' && LineAuth.isLoggedIn()) return false;
    this.showToast('請先登入LINE帳號');
    return true;
  },

  bindNavigation() {
    document.querySelectorAll('.bot-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const page = tab.dataset.page;
        this.pageHistory = [];
        this.showPage(page);
        document.querySelectorAll('.bot-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
      });
    });
  },

  showPage(pageId) {
    // 正式版未登入：擋住球隊、賽事、我的、訊息頁
    const guardedPages = ['page-profile', 'page-teams', 'page-tournaments', 'page-messages'];
    if (guardedPages.includes(pageId) && this._requireLogin()) return;
    if (this.currentPage !== pageId) {
      this.pageHistory.push(this.currentPage);
    }
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const target = document.getElementById(pageId);
    if (target) {
      target.classList.add('active');
      this.currentPage = pageId;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (pageId === 'page-titles') this.renderTitlePage();
      if (pageId === 'page-my-activities') this.renderMyActivities();
      if (pageId === 'page-team-manage') this.renderTeamManage();
    }
  },

  goBack() {
    if (this.pageHistory.length > 0) {
      const prev = this.pageHistory.pop();
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.getElementById(prev).classList.add('active');
      this.currentPage = prev;
      const mainPages = ['page-home','page-activities','page-teams','page-messages','page-profile'];
      document.querySelectorAll('.bot-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.page === prev && mainPages.includes(prev));
      });
    }
  },

  bindDrawer() {
    document.getElementById('menu-toggle').addEventListener('click', () => this.openDrawer());
    document.getElementById('drawer-overlay').addEventListener('click', () => this.closeDrawer());
  },

  openDrawer() {
    document.getElementById('side-drawer').classList.add('open');
    document.getElementById('drawer-overlay').classList.add('open');
  },

  closeDrawer() {
    document.getElementById('side-drawer').classList.remove('open');
    document.getElementById('drawer-overlay').classList.remove('open');
  },

  showModal(id) { this.toggleModal(id); },

  toggleModal(id) {
    const modal = document.getElementById(id);
    const overlay = document.getElementById('modal-overlay');
    if (!modal) return;
    const isOpen = modal.classList.contains('open');
    if (isOpen) {
      modal.classList.remove('open');
      overlay.classList.remove('open');
    } else {
      document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
      modal.classList.add('open');
      overlay.classList.add('open');
    }
  },

  closeModal() {
    document.querySelectorAll('.modal.open').forEach(m => m.classList.remove('open'));
    document.getElementById('modal-overlay').classList.remove('open');
  },

  bindNotifBtn() {
    document.getElementById('notif-btn')?.addEventListener('click', () => {
      if (this._requireLogin()) return;
      this.showPage('page-messages');
      document.querySelectorAll('.bot-tab').forEach(t => t.classList.remove('active'));
    });
  },

});
