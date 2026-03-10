/* ================================================
   SportHub Error Log Module
   Super admin only
   ================================================ */

Object.assign(App, {
  _errorLogPage: 1,
  _errorLogFiltered: null,
  _errorLogRefreshing: false,

  filterErrorLogs(page) {
    const keyword = (document.getElementById('errlog-search')?.value || '').trim().toLowerCase();
    const codeFilter = document.getElementById('errlog-code-filter')?.value || '';

    let logs = ApiService.getErrorLogs();

    if (keyword) {
      logs = logs.filter(log => {
        const translated = this._getErrorChineseMessage(log).toLowerCase();
        const severity = this._getErrorSeverity(log).label.toLowerCase();
        return (
          (log.userName || '').toLowerCase().includes(keyword)
          || (log.errorMessage || '').toLowerCase().includes(keyword)
          || (log.context || '').toLowerCase().includes(keyword)
          || (log.errorCode || '').toLowerCase().includes(keyword)
          || translated.includes(keyword)
          || severity.includes(keyword)
        );
      });
    }
    if (codeFilter) {
      logs = logs.filter(log => (log.errorCode || '') === codeFilter);
    }

    this._errorLogFiltered = logs;
    this._errorLogPage = page || 1;
    this.renderErrorLogs(logs, this._errorLogPage);
  },

  _errorLogGoPage(page) {
    this._errorLogPage = page;
    this.renderErrorLogs(this._errorLogFiltered || ApiService.getErrorLogs(), page);
  },

  _ensureErrorLogRefreshButton() {
    const actions = document.getElementById('admin-log-panel-actions-error');
    if (!actions) return null;

    let btn = document.getElementById('errorlog-refresh-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'errorlog-refresh-btn';
      btn.className = 'outline-btn admin-icon-btn';
      btn.type = 'button';
      btn.setAttribute('aria-label', '重新整理錯誤日誌');
      btn.title = '重新整理';
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-2.64-6.36"/>
          <path d="M21 3v6h-6"/>
        </svg>
      `;
      btn.addEventListener('click', () => { void this.refreshErrorLogs(); });
      actions.appendChild(btn);
    }
    return btn;
  },

  async refreshErrorLogs() {
    if (this._errorLogRefreshing) return;
    this._errorLogRefreshing = true;
    const btn = document.getElementById('errorlog-refresh-btn');
    if (btn) btn.disabled = true;

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
      if (btn) btn.disabled = false;
    }
  },

  _normalizeErrorCode(value) {
    return String(value || '').trim().toLowerCase();
  },

  _normalizeErrorMessage(value) {
    return String(value || '').trim();
  },

  _getErrorSeverity(log) {
    const code = this._normalizeErrorCode(log?.errorCode);
    const message = this._normalizeErrorMessage(log?.errorMessage).toLowerCase();

    if (
      ['permission-denied', 'unauthenticated', 'failed-precondition', 'internal', 'unknown', 'data-loss']
        .includes(code)
      || /permission|forbidden|auth|unauth|rules|insufficient permissions/.test(message)
    ) {
      return { label: '嚴重', className: 'severity-critical' };
    }

    if (
      ['deadline-exceeded', 'unavailable', 'resource-exhausted', 'aborted', 'cancelled', 'network-request-failed']
        .includes(code)
      || /timeout|timed out|network|failed to fetch|load failed|quota|too many requests|unavailable/.test(message)
    ) {
      return { label: '警告', className: 'severity-warn' };
    }

    return { label: '一般', className: 'severity-info' };
  },

  _getErrorCodeLabel(code) {
    const normalized = this._normalizeErrorCode(code);
    const map = {
      'permission-denied': '權限不足',
      'unauthenticated': '登入失效',
      'not-found': '找不到資料',
      'already-exists': '資料已存在',
      'failed-precondition': '前置條件不符',
      'resource-exhausted': '資源已達上限',
      'deadline-exceeded': '操作逾時',
      cancelled: '操作取消',
      unavailable: '服務不可用',
      'network-request-failed': '網路錯誤',
      'invalid-argument': '參數錯誤',
      internal: '系統錯誤',
      unknown: '未知錯誤',
      aborted: '流程中止',
    };
    return map[normalized] || (normalized ? normalized : '未分類');
  },

  _getErrorChineseMessage(log) {
    const code = this._normalizeErrorCode(log?.errorCode);
    const message = this._normalizeErrorMessage(log?.errorMessage);
    const lower = message.toLowerCase();

    const codeMap = {
      'permission-denied': '權限不足，操作被拒絕',
      'unauthenticated': '尚未登入或登入已失效',
      'not-found': '找不到資料',
      'already-exists': '資料已存在',
      'failed-precondition': '前置條件不符，暫時無法操作',
      'resource-exhausted': '操作過於頻繁或資源已達上限',
      'deadline-exceeded': '操作逾時，請稍後再試',
      cancelled: '操作已取消',
      unavailable: '服務暫時不可用，請稍後再試',
      'network-request-failed': '網路連線失敗，請檢查網路後再試',
      'invalid-argument': '參數不正確，請檢查後再試',
      internal: '系統內部錯誤，請稍後再試',
      unknown: '系統發生未知錯誤',
      aborted: '流程已中止，請重新操作',
    };
    if (codeMap[code]) return codeMap[code];

    if (/missing or insufficient permissions|the caller does not have permission|permission denied|insufficient permissions/.test(lower)) {
      return '權限不足，操作被拒絕';
    }
    if (/authentication required|requires authentication|auth token is expired|id token has expired|user token expired/.test(lower)) {
      return '尚未登入或登入已失效';
    }
    if (/network request failed|failed to fetch|load failed|networkerror/.test(lower)) {
      return '網路連線失敗，請檢查網路後再試';
    }
    if (/no document to update|document does not exist|not found/.test(lower)) {
      return '找不到要更新的資料';
    }
    if (/is required|missing required/.test(lower)) {
      return '缺少必要參數';
    }
    if (/too many requests|quota exceeded|resource exhausted/.test(lower)) {
      return '操作過於頻繁或資源已達上限';
    }
    if (/timeout|timed out|deadline exceeded/.test(lower)) {
      return '操作逾時，請稍後再試';
    }

    if (/[\u4e00-\u9fff]/.test(message)) {
      return message;
    }

    return '系統錯誤，請稍後再試';
  },

  renderErrorLogs(logs, page) {
    const container = document.getElementById('error-log-list');
    if (!container) return;
    this._ensureErrorLogRefreshButton();

    if (!logs) logs = ApiService.getErrorLogs();
    const sorted = [...logs].sort((a, b) => (b.time || '').localeCompare(a.time || ''));

    this._populateErrorCodeFilter(logs);

    const PAGE_SIZE = 20;
    const p = Math.max(1, page || 1);
    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const safePage = Math.min(p, totalPages);
    const pageItems = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

    if (sorted.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted)">目前沒有錯誤日誌</div>';
      return;
    }

    let html = pageItems.map(log => {
      const severity = this._getErrorSeverity(log);
      const translatedMessage = this._getErrorChineseMessage(log);
      const codeLabel = this._getErrorCodeLabel(log.errorCode);
      const rawCode = this._normalizeErrorCode(log.errorCode);
      const ctxDisplay = this._parseErrorContext(log.context);
      const uaShort = this._parseUserAgent(log.userAgent);
      const details = [
        ctxDisplay,
        log.appVersion ? `v${log.appVersion}` : '',
        uaShort,
        rawCode ? `代碼：${rawCode}` : '',
      ].filter(Boolean).join(' · ');

      return `
      <div class="log-item" style="flex-direction:column;gap:.3rem">
        <div style="display:flex;align-items:flex-start;gap:.5rem;width:100%">
          <span class="log-time">${escapeHTML(log.time || '')}</span>
          <span class="log-content" style="flex:1">
            <span class="log-type ${severity.className}">${escapeHTML(severity.label)}</span>
            <span class="log-type error_log">${escapeHTML(codeLabel)}</span>
            <strong>${escapeHTML(log.userName || '未知用戶')}</strong>
            <span style="color:var(--text-muted);font-size:.72rem">(${escapeHTML(log.page || 'unknown')})</span>
            <div class="error-log-message">${escapeHTML(translatedMessage)}</div>
          </span>
        </div>
        <div class="log-detail">${escapeHTML(details)}</div>
      </div>`;
    }).join('');

    if (totalPages > 1) {
      html += `<div style="display:flex;justify-content:center;align-items:center;gap:.5rem;padding:.8rem 0;font-size:.78rem">
        <button class="outline-btn" style="font-size:.72rem;padding:.25rem .6rem" onclick="App._errorLogGoPage(${safePage - 1})" ${safePage <= 1 ? 'disabled' : ''}>&#8249; 上一頁</button>
        <span style="color:var(--text-muted)">${safePage} / ${totalPages}，共 ${sorted.length} 筆</span>
        <button class="outline-btn" style="font-size:.72rem;padding:.25rem .6rem" onclick="App._errorLogGoPage(${safePage + 1})" ${safePage >= totalPages ? 'disabled' : ''}>下一頁 &#8250;</button>
      </div>`;
    }

    container.innerHTML = html;
  },

  _populateErrorCodeFilter(logs) {
    const sel = document.getElementById('errlog-code-filter');
    if (!sel) return;
    const current = sel.value;
    const codes = [...new Set(logs.map(log => log.errorCode).filter(Boolean))].sort();
    let opts = '<option value="">全部錯誤類型</option>';
    codes.forEach(code => {
      const label = this._getErrorCodeLabel(code);
      opts += `<option value="${escapeHTML(code)}">${escapeHTML(label)}${code ? ` (${escapeHTML(code)})` : ''}</option>`;
    });
    sel.innerHTML = opts;
    sel.value = current;
  },

  _parseErrorContext(ctx) {
    if (!ctx) return '';
    try {
      const obj = JSON.parse(ctx);
      if (typeof obj === 'object' && obj !== null) {
        const parts = [];
        if (obj.fn) parts.push(obj.fn);
        Object.keys(obj).forEach(key => {
          if (key !== 'fn') parts.push(`${key}=${obj[key]}`);
        });
        return parts.join(', ');
      }
    } catch (_) {}
    return String(ctx);
  },

  _parseUserAgent(ua) {
    if (!ua) return '';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
    if (/Android/i.test(ua)) return 'Android';
    if (/Windows/i.test(ua)) return 'Windows';
    if (/Mac/i.test(ua)) return 'macOS';
    return 'Other';
  },

  async clearOldErrorLogs() {
    const ok = await App.appConfirm('要清除 30 天前的錯誤日誌嗎？');
    if (!ok) return;

    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      const cutoffStr = App._formatDateTime ? App._formatDateTime(cutoff) : cutoff.toISOString();

      const logs = ApiService.getErrorLogs().filter(log => (log.time || '') < cutoffStr);
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
