/* ================================================
   SportHub Admin Log Center Tabs
   Merge operation / audit / error logs into one page
   ================================================ */

Object.assign(App, {
  _adminLogActiveTab: 'operation',
  _pendingAdminLogTab: '',

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

  _buildAdminLogPanel(key, title, description) {
    const panel = document.createElement('section');
    panel.className = 'admin-log-panel';
    panel.dataset.adminLogPanel = key;
    panel.hidden = true;
    panel.innerHTML = `
      <div class="admin-log-panel-header">
        <div>
          <h3>${escapeHTML(title)}</h3>
          <p>${escapeHTML(description)}</p>
        </div>
      </div>
    `;
    return panel;
  },

  _ensureAdminLogToolbar(page, tabs) {
    let toolbar = document.getElementById('admin-log-toolbar');
    if (toolbar) return toolbar;

    toolbar = document.createElement('div');
    toolbar.id = 'admin-log-toolbar';
    toolbar.className = 'admin-log-toolbar';
    toolbar.innerHTML = `
      <div class="admin-log-toolbar-copy">依目前頁籤顯示對應操作</div>
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
      <button class="tab active" type="button" data-admin-log-tab="operation" onclick="App.showAdminLogTab('operation')">操作日誌</button>
      <button class="tab" type="button" data-admin-log-tab="audit" onclick="App.showAdminLogTab('audit')">稽核日誌</button>
      <button class="tab" type="button" data-admin-log-tab="error" onclick="App.showAdminLogTab('error')">錯誤日誌</button>
    `;

    const panels = document.createElement('div');
    panels.className = 'admin-log-panels';

    const operationPanel = this._buildAdminLogPanel(
      'operation',
      '操作日誌',
      '查看後台與系統操作紀錄，可依類型與關鍵字快速篩選。'
    );
    const auditPanel = this._buildAdminLogPanel(
      'audit',
      '稽核日誌',
      '查看敏感行為與關鍵操作紀錄，可依日期、時段與動作條件過濾。'
    );
    const errorPanel = this._buildAdminLogPanel(
      'error',
      '錯誤日誌',
      '集中查看前端與系統錯誤，可依錯誤代碼與關鍵字過濾。'
    );

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
      this.filterOperationLogs(this._opLogPage || 1);
      return;
    }
    if (safeTab === 'audit') {
      this.renderAuditLogPage();
      return;
    }
    this.filterErrorLogs(this._errorLogPage || 1);
  },
});
