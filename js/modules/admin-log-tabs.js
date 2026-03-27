/* ================================================
   SportHub Admin Log Center Tabs
   Merge operation / audit / error logs into one page
   ================================================ */

Object.assign(App, {
  _adminLogActiveTab: 'operation',
  _pendingAdminLogTab: '',

  _adminLogInfoMap: {
    operation: { title: '操作日誌', desc: '查看後台與系統操作紀錄，可依類型與關鍵字快速篩選。' },
    audit:     { title: '稽核日誌', desc: '查看敏感行為與關鍵操作紀錄，可依日期、時段與動作條件過濾。' },
    error:     { title: '錯誤日誌', desc: '集中查看前端與系統錯誤，可依錯誤代碼與關鍵字過濾。' },
  },

  _normalizeAdminLogTab(tabKey) {
    return ['operation', 'audit', 'error'].includes(tabKey) ? tabKey : 'operation';
  },

  async goBackFromAdminLogs() {
    if (Array.isArray(this.pageHistory) && this.pageHistory.length > 0) {
      await this.goBack();
      return;
    }

    const fallbackPage = (typeof this._canAccessPage === 'function' && this._canAccessPage('page-admin-dashboard'))
      ? 'page-admin-dashboard'
      : 'page-home';
    await this.showPage(fallbackPage, { resetHistory: true });
  },

  _buildAdminLogPanel(key) {
    const panel = document.createElement('section');
    panel.className = 'admin-log-panel';
    panel.dataset.adminLogPanel = key;
    panel.hidden = true;
    return panel;
  },

  _ensureAdminLogToolbar(page, tabs) {
    let toolbar = document.getElementById('admin-log-toolbar');
    if (toolbar) return toolbar;

    toolbar = document.createElement('div');
    toolbar.id = 'admin-log-toolbar';
    toolbar.className = 'admin-log-toolbar';
    toolbar.innerHTML = `
      <div class="admin-log-toolbar-actions" id="admin-log-toolbar-actions"></div>
    `;
    tabs.insertAdjacentElement('afterend', toolbar);
    return toolbar;
  },

  _appendToolbarAction(button, tabKey, extraClass = '') {
    if (!button) return;
    const actions = document.getElementById('admin-log-toolbar-actions');
    if (!actions) return;

    button.dataset.adminLogActionTab = tabKey;
    button.dataset.actionAvailable = button.dataset.actionAvailable || '1';
    button.classList.add('admin-log-action-btn');
    if (extraClass) {
      extraClass.split(/\s+/).filter(Boolean).forEach(cls => button.classList.add(cls));
    }
    actions.appendChild(button);
  },

  _refreshAdminLogToolbarActions() {
    const toolbar = document.getElementById('admin-log-toolbar');
    const actions = document.getElementById('admin-log-toolbar-actions');
    if (!toolbar || !actions) return;

    const activeTab = this._normalizeAdminLogTab(this._adminLogActiveTab || 'operation');
    let visibleCount = 0;
    actions.querySelectorAll('[data-admin-log-action-tab]').forEach(button => {
      const tabMatch = button.dataset.adminLogActionTab === activeTab;
      const available = button.dataset.actionAvailable !== '0';
      const shouldShow = tabMatch && available;
      button.hidden = !shouldShow;
      if (shouldShow) visibleCount += 1;
    });

    toolbar.classList.toggle('is-empty', visibleCount === 0);
  },

  _ensureAdminLogCenterLayout() {
    const page = document.getElementById('page-admin-logs');
    if (!page || page.dataset.logCenterReady === '1') return;

    const header = page.querySelector('.page-header');
    if (!header) return;

    const titleEl = header.querySelector('h2');
    const backBtn = header.querySelector('.back-btn');
    const clearAllBtn = header.querySelector('.header-action-btn');
    if (titleEl) titleEl.textContent = '日誌中心';
    if (backBtn) {
      backBtn.textContent = '←';
      backBtn.setAttribute('onclick', 'App.goBackFromAdminLogs()');
    }

    const operationNodes = Array.from(page.children).filter(node => node !== header);
    const auditPage = document.getElementById('page-admin-audit-logs');
    const errorPage = document.getElementById('page-admin-error-logs');
    const auditNodes = auditPage
      ? Array.from(auditPage.children).filter(node => !node.classList.contains('page-header'))
      : [];
    const errorNodes = errorPage
      ? Array.from(errorPage.children).filter(node => !node.classList.contains('page-header'))
      : [];
    const errorClearBtn = errorPage?.querySelector('.outline-btn') || null;

    if (clearAllBtn) clearAllBtn.remove();
    if (errorClearBtn) {
      errorClearBtn.remove();
      errorClearBtn.textContent = '清除 30 天前';
    }

    const tabs = document.createElement('div');
    tabs.className = 'tab-bar admin-log-tabs';
    tabs.id = 'admin-log-tabs';
    tabs.innerHTML = `
      <button class="tab active" type="button" data-admin-log-tab="operation" onclick="App.showAdminLogTab('operation')">${typeof t === 'function' ? t('admin.logs') : '日誌中心'}</button>
      <button class="tab" type="button" data-admin-log-tab="audit" onclick="App.showAdminLogTab('audit')">${typeof t === 'function' ? t('admin.auditLogs') : '稽核日誌'}</button>
      <button class="tab" type="button" data-admin-log-tab="error" onclick="App.showAdminLogTab('error')">${typeof t === 'function' ? t('admin.errorLogs') : '錯誤日誌'}</button>
      <button class="admin-log-info-btn" type="button" id="admin-log-refresh-btn" onclick="App.refreshActiveLogTab()" title="重新整理"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></button>
      <button class="admin-log-info-btn" type="button" onclick="App.showAdminLogInfo()" title="功能說明"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg></button>
    `;

    const panels = document.createElement('div');
    panels.className = 'admin-log-panels';

    const operationPanel = this._buildAdminLogPanel('operation');
    const auditPanel = this._buildAdminLogPanel('audit');
    const errorPanel = this._buildAdminLogPanel('error');

    if (clearAllBtn) {
      clearAllBtn.textContent = '清空資料';
      clearAllBtn.id = 'admin-log-clear-all-btn';
      clearAllBtn.className = 'outline-btn';
      clearAllBtn.removeAttribute('style');
      this._appendToolbarAction(clearAllBtn, 'operation', 'admin-log-action-danger');
    }
    if (errorClearBtn) {
      errorClearBtn.id = 'admin-log-clear-old-btn';
      errorClearBtn.className = 'outline-btn';
      errorClearBtn.removeAttribute('style');
      errorClearBtn.textContent = '清除 30 天前';
      this._appendToolbarAction(errorClearBtn, 'error');
    }

    operationNodes.forEach(node => operationPanel.appendChild(node));
    auditNodes.forEach(node => auditPanel.appendChild(node));
    errorNodes.forEach(node => errorPanel.appendChild(node));

    panels.appendChild(operationPanel);
    panels.appendChild(auditPanel);
    panels.appendChild(errorPanel);

    header.insertAdjacentElement('afterend', tabs);
    const toolbar = this._ensureAdminLogToolbar(page, tabs);
    toolbar.insertAdjacentElement('afterend', panels);

    if (auditPage) auditPage.innerHTML = '';
    if (errorPage) errorPage.innerHTML = '';
    page.dataset.logCenterReady = '1';
    this._refreshAdminLogToolbarActions();
  },

  renderAdminLogCenter(tabKey) {
    this._ensureAdminLogCenterLayout();
    this.showAdminLogTab(tabKey || this._pendingAdminLogTab || this._adminLogActiveTab || 'operation');
  },

  showAdminLogTab(tabKey) {
    this._ensureAdminLogCenterLayout();
    const page = document.getElementById('page-admin-logs');
    if (!page) return;

    const safeTab = this._normalizeAdminLogTab(tabKey || this._pendingAdminLogTab || this._adminLogActiveTab);
    this._adminLogActiveTab = safeTab;
    this._pendingAdminLogTab = '';

    page.querySelectorAll('[data-admin-log-tab]').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.adminLogTab === safeTab);
    });
    page.querySelectorAll('[data-admin-log-panel]').forEach(panel => {
      panel.hidden = panel.dataset.adminLogPanel !== safeTab;
    });
    this._refreshAdminLogToolbarActions();

    if (safeTab === 'operation') {
      this._ensureOpLogRefreshButton?.();
      this.filterOperationLogs(this._opLogPage || 1);
      return;
    }
    if (safeTab === 'audit') {
      this.renderAuditLogPage();
      return;
    }
    this.filterErrorLogs(this._errorLogPage || 1);
  },

  async refreshActiveLogTab() {
    const tab = this._normalizeAdminLogTab(this._adminLogActiveTab);
    const btn = document.getElementById('admin-log-refresh-btn');
    if (btn) { btn.disabled = true; btn.style.opacity = '.5'; }
    try {
      if (tab === 'operation') {
        await this.refreshOperationLogs();
      } else if (tab === 'audit') {
        await this.refreshAuditLogs();
      } else {
        await this.refreshErrorLogs();
      }
    } finally {
      if (btn) { btn.disabled = false; btn.style.opacity = ''; }
    }
  },

  async refreshOperationLogs() {
    if (this._opLogRefreshing) return;
    this._opLogRefreshing = true;
    try {
      if (typeof FirebaseService !== 'undefined' && typeof FirebaseService.refreshCollectionsForPage === 'function') {
        await FirebaseService.refreshCollectionsForPage('page-admin-logs');
      }
      this.filterOperationLogs(1);
      this.showToast('已重新整理操作日誌');
    } catch (err) {
      console.error('[refreshOperationLogs]', err);
      this.showToast('重新整理操作日誌失敗');
    } finally {
      this._opLogRefreshing = false;
    }
  },

  showAdminLogInfo() {
    const tab = this._normalizeAdminLogTab(this._adminLogActiveTab);
    const info = this._adminLogInfoMap[tab] || this._adminLogInfoMap.operation;

    let overlay = document.querySelector('.admin-log-info-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'admin-log-info-overlay';
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) App.closeAdminLogInfo();
      });
      overlay.innerHTML = `
        <div class="admin-log-info-modal">
          <div class="modal-header">
            <h3 class="admin-log-info-title"></h3>
            <button type="button" class="modal-close" onclick="App.closeAdminLogInfo()">&times;</button>
          </div>
          <div class="modal-body">
            <p class="admin-log-info-desc"></p>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    }

    overlay.querySelector('.admin-log-info-title').textContent = info.title;
    overlay.querySelector('.admin-log-info-desc').textContent = info.desc;

    requestAnimationFrame(() => {
      overlay.classList.add('open');
      overlay.querySelector('.admin-log-info-modal').classList.add('open');
    });
  },

  closeAdminLogInfo() {
    const overlay = document.querySelector('.admin-log-info-overlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    overlay.querySelector('.admin-log-info-modal').classList.remove('open');
  },
});
