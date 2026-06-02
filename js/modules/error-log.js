/* ================================================
   SportHub Error Log Module
   Admin diagnostics view only
   ================================================ */

Object.assign(App, {
  _errorLogPage: 1,
  _errorLogFiltered: null,
  _errorLogRefreshing: false,
  _errorLogPageSize: 20,
  _userPromptLogPage: 1,
  _userPromptLogFiltered: null,
  _userPromptLogRefreshing: false,
  _userPromptLogPageSize: 20,

  _ensureErrorLogFilters() {
    const search = document.getElementById('errlog-search');
    if (search) search.placeholder = '搜尋用戶 / UID / 頁面 / 功能 / 白話錯誤 / context...';

    const codeSel = document.getElementById('errlog-code-filter');
    const host = codeSel?.closest('.admin-filters');
    if (!host) return;

    if (codeSel) codeSel.onchange = () => this.filterErrorLogs(1);
    const controls = [
      { id: 'errlog-severity-filter', label: '全部嚴重度', type: 'select' },
      { id: 'errlog-page-filter', label: '全部頁面', type: 'select' },
      { id: 'errlog-device-filter', label: '全部裝置', type: 'select' },
      { id: 'errlog-version-filter', label: '全部版本', type: 'select' },
      { id: 'errlog-date-filter', label: '依日期', type: 'date' },
    ];

    controls.forEach(spec => {
      if (document.getElementById(spec.id)) return;
      const el = document.createElement(spec.type === 'date' ? 'input' : 'select');
      el.id = spec.id;
      el.className = spec.type === 'date' ? 'error-log-date-filter' : 'error-log-filter-select';
      el.title = spec.label;
      if (spec.type === 'date') {
        el.type = 'date';
      } else {
        el.innerHTML = `<option value="">${spec.label}</option>`;
      }
      el.onchange = () => this.filterErrorLogs(1);
      host.appendChild(el);
    });

    const severitySel = document.getElementById('errlog-severity-filter');
    if (severitySel && severitySel.options.length <= 1) {
      severitySel.innerHTML = [
        '<option value="">全部嚴重度</option>',
        '<option value="critical">嚴重</option>',
        '<option value="warn">警告</option>',
        '<option value="info">一般</option>',
      ].join('');
    }

    if (!document.getElementById('errlog-clear-filters')) {
      const btn = document.createElement('button');
      btn.id = 'errlog-clear-filters';
      btn.type = 'button';
      btn.className = 'outline-btn error-log-clear-filter';
      btn.textContent = '清除篩選';
      btn.onclick = () => this._clearErrorLogFilters();
      host.appendChild(btn);
    }
  },

  _getErrorFilterValues() {
    return {
      keyword: (document.getElementById('errlog-search')?.value || '').trim().toLowerCase(),
      code: this._normalizeErrorCode(document.getElementById('errlog-code-filter')?.value || ''),
      severity: document.getElementById('errlog-severity-filter')?.value || '',
      page: document.getElementById('errlog-page-filter')?.value || '',
      device: document.getElementById('errlog-device-filter')?.value || '',
      version: document.getElementById('errlog-version-filter')?.value || '',
      date: document.getElementById('errlog-date-filter')?.value || '',
    };
  },

  _matchesErrorLogFilters(log, filters) {
    if (filters.keyword && !this._getErrorSearchText(log).includes(filters.keyword)) return false;
    if (filters.code && this._normalizeErrorCode(log?.errorCode) !== filters.code) return false;
    if (filters.severity && this._getErrorSeverity(log).key !== filters.severity) return false;
    if (filters.page && this._getErrorPage(log) !== filters.page) return false;
    if (filters.device && this._getErrorDeviceType(log) !== filters.device) return false;
    if (filters.version && this._getErrorVersion(log) !== filters.version) return false;
    if (filters.date && this._getErrorDateKey(log) !== filters.date) return false;
    return true;
  },

  filterErrorLogs(page) {
    this._ensureErrorLogFilters();
    const allLogs = ApiService.getErrorLogs();
    this._populateErrorLogFilterOptions(allLogs);
    const filters = this._getErrorFilterValues();
    const logs = allLogs.filter(log => this._matchesErrorLogFilters(log, filters));
    this._errorLogFiltered = logs;
    this._errorLogPage = page || 1;
    this.renderErrorLogs(logs, this._errorLogPage);
  },

  _clearErrorLogFilters() {
    ['errlog-search', 'errlog-code-filter', 'errlog-severity-filter', 'errlog-page-filter', 'errlog-device-filter', 'errlog-version-filter', 'errlog-date-filter']
      .forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
    this.filterErrorLogs(1);
  },

  _errorLogGoPage(page) {
    this._errorLogPage = page;
    this.renderErrorLogs(this._errorLogFiltered || ApiService.getErrorLogs(), page);
  },

  _ensureErrorLogRefreshButton() { /* 重整按鈕已移至 tab bar 圓形圖示按鈕（admin-log-tabs.js） */ },

  async refreshErrorLogs() {
    if (this._errorLogRefreshing) return;
    this._errorLogRefreshing = true;
    try {
      if (typeof FirebaseService !== 'undefined' && typeof FirebaseService.refreshCollectionsForPage === 'function') {
        await FirebaseService.refreshCollectionsForPage('page-admin-logs');
      }
      this.filterErrorLogs(this._errorLogPage || 1);
      this.showToast('已重新整理錯誤日誌');
    } catch (err) {
      console.error('[refreshErrorLogs]', err);
      this.showToast('重新整理錯誤日誌失敗');
    } finally {
      this._errorLogRefreshing = false;
    }
  },

  renderErrorLogs(logs, page) {
    const container = document.getElementById('error-log-list');
    if (!container) return;
    this._ensureErrorLogRefreshButton();
    this._ensureErrorLogFilters();

    const allLogs = ApiService.getErrorLogs();
    if (!logs) logs = allLogs;
    this._populateErrorLogFilterOptions(allLogs);
    const sorted = [...logs].sort((a, b) => this._getErrorTimestampMs(b) - this._getErrorTimestampMs(a));
    const pageSize = this._errorLogPageSize || 20;
    const p = Math.max(1, page || 1);
    const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
    const safePage = Math.min(p, totalPages);
    const pageItems = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);
    this._errorLogCopyItems = Object.create(null);

    let html = this._renderErrorLogSummary(allLogs, sorted);
    html += this._renderErrorLogInsights(allLogs, sorted);
    if (sorted.length === 0) {
      container.innerHTML = html + '<div class="error-log-empty">目前沒有符合條件的錯誤日誌</div>';
      return;
    }

    html += pageItems.map((log, idx) => {
      const copyId = `p${safePage}_${idx}`;
      this._errorLogCopyItems[copyId] = log;
      return this._renderErrorLogItem(log, copyId);
    }).join('');
    if (totalPages > 1) {
      html += `<div class="error-log-pagination">
        <button class="outline-btn" onclick="App._errorLogGoPage(${safePage - 1})" ${safePage <= 1 ? 'disabled' : ''}>&#8249; 上一頁</button>
        <span>${safePage} / ${totalPages}，共 ${sorted.length} 筆</span>
        <button class="outline-btn" onclick="App._errorLogGoPage(${safePage + 1})" ${safePage >= totalPages ? 'disabled' : ''}>下一頁 &#8250;</button>
      </div>`;
    }
    container.innerHTML = html;
  },

  _renderErrorLogSummary(allLogs, visibleLogs) {
    const critical = allLogs.filter(log => this._getErrorSeverity(log).key === 'critical').length;
    const warn = allLogs.filter(log => this._getErrorSeverity(log).key === 'warn').length;
    const todayKey = this._getErrorDateKey({ clientTimeIso: new Date().toISOString() });
    const today = allLogs.filter(log => this._getErrorDateKey(log) === todayKey).length;
    const stats = [
      ['總筆數', allLogs.length],
      ['目前顯示', visibleLogs.length],
      ['嚴重', critical],
      ['警告', warn],
      ['今天', today],
    ];
    return `<div class="error-log-summary-grid">${stats.map(([label, value]) => `
      <div class="error-log-stat"><span>${escapeHTML(label)}</span><strong>${escapeHTML(String(value))}</strong></div>
    `).join('')}</div>`;
  },

  _renderErrorLogItem(log, copyId) {
    const severity = this._getErrorSeverity(log);
    const codeLabel = this._getErrorDisplayCodeLabel(log);
    const message = this._getErrorChineseMessage(log);
    const page = this._getErrorPage(log);
    const fn = this._getErrorFunctionName(log);
    const version = this._getErrorVersion(log);
    const device = this._getErrorDeviceLabel(log);
    const meta = [
      fn ? `功能：${fn}` : '',
      `頁面：${page}`,
      device ? `裝置：${device}` : '',
      version ? `版本：${version}` : '',
      log?.role ? `身分：${log.role}` : '',
    ].filter(Boolean);

    return `<div class="log-item error-log-card">
      <div class="error-log-main">
        <span class="log-time">${escapeHTML(this._formatErrorLogTime(log) || '')}</span>
        <div class="error-log-body">
          <div class="error-log-title-row">
            <span class="log-type ${severity.className}">${escapeHTML(severity.label)}</span>
            <span class="log-type error_log">${escapeHTML(codeLabel)}</span>
            <strong data-no-translate>${escapeHTML(log?.userName || '未知用戶')}</strong>
          </div>
          <div class="error-log-message">${escapeHTML(message)}</div>
          <div class="error-log-meta">${meta.map(item => `<span>${escapeHTML(item)}</span>`).join('')}</div>
        </div>
      </div>
      ${this._renderErrorLogDetails(log, copyId)}
    </div>`;
  },

  _renderErrorLogDetails(log, copyId) {
    const rawContext = typeof log?.context === 'string' ? log.context : (log?.context ? JSON.stringify(log.context) : '');
    const rows = [
      ['UID', log?.uid, true],
      ['功能位置', this._parseErrorContext(log?.context), true],
      ['頁面', this._getErrorPage(log), true],
      ['錯誤碼', this._getErrorDisplayCode(log), true],
      ['原始錯誤', log?.errorMessage, true],
      ['Context', rawContext, true],
      ['Stack', log?.errorStack, true],
      ['URL', log?.url, true],
      ['Hash', log?.hash, true],
      ['User Agent', log?.userAgent, true],
      ['文件 ID', log?._docId, true],
    ].map(([label, value, mono]) => this._renderErrorDetailRow(label, value, mono)).join('');
    return `<details class="error-log-details">
      <summary>查看技術細節</summary>
      <button type="button" class="outline-btn error-log-copy-btn" onclick="event.stopPropagation();App.copyErrorLogDiagnostic('${escapeHTML(copyId || '')}')">複製診斷包</button>
      <div class="error-log-detail-grid">${rows}</div>
    </details>`;
  },

  _renderErrorDetailRow(label, value, mono) {
    const text = String(value || '').trim();
    if (!text) return '';
    return `<div class="error-log-detail-row">
      <span>${escapeHTML(label)}</span>
      <pre class="${mono ? 'is-mono' : ''}" data-no-translate>${escapeHTML(text)}</pre>
    </div>`;
  },

  _populateErrorLogFilterOptions(logs) {
    this._setErrorLogSelectOptions('errlog-code-filter',
      [...new Set(logs.map(log => this._normalizeErrorCode(log?.errorCode)).filter(Boolean))]
        .sort()
        .map(code => [code, `${this._getErrorCodeLabel(code)} (${code})`]),
      '全部錯誤類型');
    this._setErrorLogSelectOptions('errlog-page-filter',
      [...new Set(logs.map(log => this._getErrorPage(log)).filter(Boolean))].sort().map(page => [page, page]),
      '全部頁面');
    this._setErrorLogSelectOptions('errlog-device-filter',
      [...new Set(logs.map(log => this._getErrorDeviceType(log)).filter(Boolean))]
        .sort()
        .map(type => [type, ({ mobile: '手機', tablet: '平板', desktop: '桌機' }[type] || type)]),
      '全部裝置');
    this._setErrorLogSelectOptions('errlog-version-filter',
      [...new Set(logs.map(log => this._getErrorVersion(log)).filter(Boolean))].sort().map(v => [v, `v${v}`]),
      '全部版本');
  },

  _setErrorLogSelectOptions(id, entries, placeholder) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    const values = new Set(entries.map(([value]) => value));
    sel.innerHTML = `<option value="">${escapeHTML(placeholder)}</option>`
      + entries.map(([value, label]) => `<option value="${escapeHTML(value)}">${escapeHTML(label)}</option>`).join('');
    sel.value = values.has(current) ? current : '';
  },

  _ensureUserPromptLogFilters() {
    const search = document.getElementById('promptlog-search');
    if (search) search.placeholder = '搜尋用戶 / UID / 提示內容 / 頁面 / 裝置...';
    ['promptlog-type-filter', 'promptlog-page-filter', 'promptlog-device-filter', 'promptlog-version-filter', 'promptlog-date-filter']
      .forEach(id => {
        const el = document.getElementById(id);
        if (el) el.onchange = () => this.filterUserPromptLogs(1);
      });
  },

  _getUserPromptFilterValues() {
    return {
      keyword: (document.getElementById('promptlog-search')?.value || '').trim().toLowerCase(),
      type: document.getElementById('promptlog-type-filter')?.value || '',
      page: document.getElementById('promptlog-page-filter')?.value || '',
      device: document.getElementById('promptlog-device-filter')?.value || '',
      version: document.getElementById('promptlog-version-filter')?.value || '',
      date: document.getElementById('promptlog-date-filter')?.value || '',
    };
  },

  _matchesUserPromptLogFilters(log, filters) {
    if (!this._isUserPromptLog(log)) return false;
    if (filters.keyword && !this._getErrorSearchText(log).includes(filters.keyword)) return false;
    if (filters.type && this._getUserPromptSurfaceInfo(log).key !== filters.type) return false;
    if (filters.page && this._getErrorPage(log) !== filters.page) return false;
    if (filters.device && this._getErrorDeviceType(log) !== filters.device) return false;
    if (filters.version && this._getErrorVersion(log) !== filters.version) return false;
    if (filters.date && this._getErrorDateKey(log) !== filters.date) return false;
    return true;
  },

  filterUserPromptLogs(page) {
    this._ensureUserPromptLogFilters();
    const allLogs = ApiService.getErrorLogs().filter(log => this._isUserPromptLog(log));
    this._populateUserPromptLogFilterOptions(allLogs);
    const filters = this._getUserPromptFilterValues();
    const logs = allLogs.filter(log => this._matchesUserPromptLogFilters(log, filters));
    this._userPromptLogFiltered = logs;
    this._userPromptLogPage = page || 1;
    this.renderUserPromptLogs(logs, this._userPromptLogPage);
  },

  _clearUserPromptLogFilters() {
    ['promptlog-search', 'promptlog-type-filter', 'promptlog-page-filter', 'promptlog-device-filter', 'promptlog-version-filter', 'promptlog-date-filter']
      .forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
    this.filterUserPromptLogs(1);
  },

  _userPromptLogGoPage(page) {
    this._userPromptLogPage = page;
    this.renderUserPromptLogs(this._userPromptLogFiltered || ApiService.getErrorLogs().filter(log => this._isUserPromptLog(log)), page);
  },

  async refreshUserPromptLogs() {
    if (this._userPromptLogRefreshing) return;
    this._userPromptLogRefreshing = true;
    try {
      if (typeof FirebaseService !== 'undefined' && typeof FirebaseService.refreshCollectionsForPage === 'function') {
        await FirebaseService.refreshCollectionsForPage('page-admin-logs');
      }
      this.filterUserPromptLogs(this._userPromptLogPage || 1);
      this.showToast('已重新整理用戶提示');
    } catch (err) {
      console.error('[refreshUserPromptLogs]', err);
      this.showToast('重新整理用戶提示失敗');
    } finally {
      this._userPromptLogRefreshing = false;
    }
  },

  renderUserPromptLogs(logs, page) {
    const container = document.getElementById('user-prompt-log-list');
    if (!container) return;
    this._ensureUserPromptLogFilters();

    const allLogs = ApiService.getErrorLogs().filter(log => this._isUserPromptLog(log));
    if (!logs) logs = allLogs;
    this._populateUserPromptLogFilterOptions(allLogs);
    const sorted = [...logs].sort((a, b) => this._getErrorTimestampMs(b) - this._getErrorTimestampMs(a));
    const pageSize = this._userPromptLogPageSize || 20;
    const p = Math.max(1, page || 1);
    const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
    const safePage = Math.min(p, totalPages);
    const pageItems = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);
    this._errorLogCopyItems = Object.create(null);

    let html = this._renderUserPromptLogSummary(allLogs, sorted);
    html += this._renderUserPromptLogInsights(sorted);
    if (sorted.length === 0) {
      container.innerHTML = html + '<div class="error-log-empty">目前沒有符合條件的用戶提示紀錄</div>';
      return;
    }

    html += pageItems.map((log, idx) => {
      const copyId = `up${safePage}_${idx}`;
      this._errorLogCopyItems[copyId] = log;
      return this._renderUserPromptLogItem(log, copyId);
    }).join('');
    if (totalPages > 1) {
      html += `<div class="error-log-pagination">
        <button class="outline-btn" onclick="App._userPromptLogGoPage(${safePage - 1})" ${safePage <= 1 ? 'disabled' : ''}>&#8249; 上一頁</button>
        <span>${safePage} / ${totalPages}，共 ${sorted.length} 筆</span>
        <button class="outline-btn" onclick="App._userPromptLogGoPage(${safePage + 1})" ${safePage >= totalPages ? 'disabled' : ''}>下一頁 &#8250;</button>
      </div>`;
    }
    container.innerHTML = html;
  },

  _renderUserPromptLogSummary(allLogs, visibleLogs) {
    const todayKey = this._getErrorDateKey({ clientTimeIso: new Date().toISOString() });
    const today = allLogs.filter(log => this._getErrorDateKey(log) === todayKey).length;
    const users = new Set(allLogs.map(log => log?.uid).filter(Boolean));
    const relogin = allLogs.filter(log => this._getUserPromptSurfaceInfo(log).key === 'relogin_modal').length;
    const stats = [
      ['提示總數', allLogs.length],
      ['目前顯示', visibleLogs.length],
      ['影響用戶', users.size],
      ['重新登入彈窗', relogin],
      ['今天', today],
    ];
    return `<div class="error-log-summary-grid">${stats.map(([label, value]) => `
      <div class="error-log-stat"><span>${escapeHTML(label)}</span><strong>${escapeHTML(String(value))}</strong></div>
    `).join('')}</div>`;
  },

  _renderUserPromptLogInsights(logs) {
    if (!logs.length) return '';
    const trend = this._getErrorLogTrend(logs);
    const maxTrend = Math.max(1, ...trend.map(row => row.count));
    const trendHtml = trend.map(row => {
      const h = Math.max(6, Math.round((row.count / maxTrend) * 52));
      return `<div class="error-log-trend-day" title="${escapeHTML(row.key)}：${row.count} 筆">
        <span class="error-log-trend-bar" style="height:${h}px"></span>
        <strong>${escapeHTML(String(row.count))}</strong>
        <small>${escapeHTML(row.label)}</small>
      </div>`;
    }).join('');

    const groupMap = new Map();
    logs.forEach(log => {
      const message = this._getUserPromptMessage(log) || this._getErrorChineseMessage(log);
      const key = `${this._getUserPromptKeyLabel(log)}||${message}`;
      if (!groupMap.has(key)) groupMap.set(key, { label: this._getUserPromptKeyLabel(log), message, count: 0, users: new Set(), lastMs: 0 });
      const group = groupMap.get(key);
      group.count += 1;
      if (log?.uid) group.users.add(String(log.uid));
      group.lastMs = Math.max(group.lastMs, this._getErrorTimestampMs(log));
    });
    const topHtml = [...groupMap.values()]
      .sort((a, b) => (b.count - a.count) || (b.lastMs - a.lastMs))
      .slice(0, 5)
      .map(group => `<div class="error-log-group user-prompt-log-group">
        <div class="error-log-group-head">
          <span class="log-type severity-warn">${escapeHTML(group.label)}</span>
          <strong>${escapeHTML(String(group.count))} 筆 · ${escapeHTML(String(group.users.size))} 位用戶</strong>
        </div>
        <div class="error-log-message">${escapeHTML(group.message)}</div>
      </div>`).join('');

    return `<div class="error-log-insights user-prompt-log-insights">
      <div class="error-log-insight-panel">
        <div class="error-log-insight-title">近 7 天提示趨勢</div>
        <div class="error-log-trend">${trendHtml}</div>
      </div>
      <div class="error-log-insight-panel">
        <div class="error-log-insight-title">提示訊息 Top ${Math.min(5, groupMap.size)}</div>
        <div class="error-log-groups">${topHtml || '<div class="error-log-empty-inline">目前沒有可聚合的提示</div>'}</div>
      </div>
    </div>`;
  },

  _renderUserPromptLogItem(log, copyId) {
    const surface = this._getUserPromptSurfaceInfo(log);
    const message = this._getUserPromptMessage(log) || this._getErrorChineseMessage(log);
    const page = this._getErrorPage(log);
    const version = this._getErrorVersion(log);
    const device = this._getErrorDeviceLabel(log);
    const meta = [
      `頁面：${page}`,
      `來源：${surface.label}`,
      `分類：${this._getUserPromptKeyLabel(log)}`,
      device ? `裝置：${device}` : '',
      version ? `版本：${version}` : '',
      log?.role ? `身分：${log.role}` : '',
    ].filter(Boolean);

    return `<div class="log-item error-log-card user-prompt-log-card">
      <div class="error-log-main">
        <span class="log-time">${escapeHTML(this._formatErrorLogTime(log) || '')}</span>
        <div class="error-log-body">
          <div class="error-log-title-row">
            <span class="log-type severity-warn">${escapeHTML(surface.label)}</span>
            <strong data-no-translate>${escapeHTML(log?.userName || '未知用戶')}</strong>
            <button type="button" class="outline-btn error-log-copy-btn user-prompt-log-copy" onclick="event.stopPropagation();App.copyErrorLogDiagnostic('${escapeHTML(copyId || '')}')">複製診斷包</button>
          </div>
          <div class="error-log-message">${escapeHTML(message)}</div>
          <div class="error-log-meta">${meta.map(item => `<span>${escapeHTML(item)}</span>`).join('')}</div>
        </div>
      </div>
      ${this._renderUserPromptLogDetails(log)}
    </div>`;
  },

  _renderUserPromptLogDetails(log) {
    const rawContext = typeof log?.context === 'string' ? log.context : (log?.context ? JSON.stringify(log.context) : '');
    const rows = [
      ['UID', log?.uid, true],
      ['提示來源', this._getUserPromptSurfaceInfo(log).label, true],
      ['提示分類', this._getUserPromptKeyLabel(log), true],
      ['提示內容', this._getUserPromptMessage(log) || this._getErrorChineseMessage(log), false],
      ['功能位置', this._parseErrorContext(log?.context), true],
      ['頁面', this._getErrorPage(log), true],
      ['Context', rawContext, true],
      ['URL', log?.url, true],
      ['Hash', log?.hash, true],
      ['User Agent', log?.userAgent, true],
      ['文件 ID', log?._docId, true],
    ].map(([label, value, mono]) => this._renderErrorDetailRow(label, value, mono)).join('');
    return `<details class="error-log-details">
      <summary>查看技術細節</summary>
      <div class="error-log-detail-grid">${rows}</div>
    </details>`;
  },

  _populateUserPromptLogFilterOptions(logs) {
    this._setErrorLogSelectOptions('promptlog-type-filter',
      [...new Map(logs.map(log => {
        const surface = this._getUserPromptSurfaceInfo(log);
        return [surface.key, surface.label];
      })).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
      '全部提示來源');
    this._setErrorLogSelectOptions('promptlog-page-filter',
      [...new Set(logs.map(log => this._getErrorPage(log)).filter(Boolean))].sort().map(page => [page, page]),
      '全部頁面');
    this._setErrorLogSelectOptions('promptlog-device-filter',
      [...new Set(logs.map(log => this._getErrorDeviceType(log)).filter(Boolean))]
        .sort()
        .map(type => [type, ({ mobile: '手機', tablet: '平板', desktop: '桌機' }[type] || type)]),
      '全部裝置');
    this._setErrorLogSelectOptions('promptlog-version-filter',
      [...new Set(logs.map(log => this._getErrorVersion(log)).filter(Boolean))].sort().map(v => [v, `v${v}`]),
      '全部版本');
  },

  async clearOldErrorLogs() {
    const ok = await App.appConfirm('要清除 30 天前的錯誤日誌嗎？');
    if (!ok) return;
    try {
      const cutoffMs = Date.now() - (30 * 24 * 60 * 60 * 1000);
      const logs = ApiService.getErrorLogs().filter(log => {
        const ms = this._getErrorTimestampMs(log);
        return log?._docId && ms > 0 && ms < cutoffMs;
      });
      if (logs.length === 0) {
        this.showToast('沒有 30 天前的錯誤日誌');
        return;
      }
      let deleted = 0;
      for (let i = 0; i < logs.length; i += 500) {
        const batch = logs.slice(i, i + 500);
        await Promise.all(batch.map(log => FirebaseService.deleteErrorLog(log._docId)));
        deleted += batch.length;
      }
      this.showToast(`已清除 ${deleted} 筆錯誤日誌`);
      this.filterErrorLogs(1);
    } catch (err) {
      console.error('[clearOldErrorLogs]', err);
      this.showToast(`清除失敗：${err.message || ''}`);
    }
  },
});
