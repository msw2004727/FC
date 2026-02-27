/* ================================================
   SportHub — Error Log Module
   錯誤日誌渲染 / 過濾 / 分頁 / 清除（super_admin only）
   ================================================ */

Object.assign(App, {
  _errorLogPage: 1,
  _errorLogFiltered: null,

  filterErrorLogs(page) {
    const keyword = (document.getElementById('errlog-search')?.value || '').trim().toLowerCase();
    const codeFilter = document.getElementById('errlog-code-filter')?.value || '';

    let logs = ApiService.getErrorLogs();

    if (keyword) {
      logs = logs.filter(l =>
        (l.userName || '').toLowerCase().includes(keyword) ||
        (l.errorMessage || '').toLowerCase().includes(keyword) ||
        (l.context || '').toLowerCase().includes(keyword)
      );
    }
    if (codeFilter) {
      logs = logs.filter(l => l.errorCode === codeFilter);
    }

    this._errorLogFiltered = logs;
    this._errorLogPage = page || 1;
    this.renderErrorLogs(logs, this._errorLogPage);
  },

  _errorLogGoPage(page) {
    this._errorLogPage = page;
    this.renderErrorLogs(this._errorLogFiltered || ApiService.getErrorLogs(), page);
  },

  renderErrorLogs(logs, page) {
    const container = document.getElementById('error-log-list');
    if (!container) return;

    if (!logs) logs = ApiService.getErrorLogs();
    const sorted = [...logs].sort((a, b) => (b.time || '').localeCompare(a.time || ''));

    // 動態填充 errorCode 下拉選項
    this._populateErrorCodeFilter(logs);

    const PAGE_SIZE = 20;
    const p = Math.max(1, page || 1);
    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const safePage = Math.min(p, totalPages);
    const pageItems = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

    if (sorted.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted)">沒有符合條件的錯誤紀錄</div>';
      return;
    }

    let html = pageItems.map(l => {
      const ctxDisplay = this._parseErrorContext(l.context);
      const uaShort = this._parseUserAgent(l.userAgent);
      return `
      <div class="log-item" style="flex-direction:column;gap:.25rem">
        <div style="display:flex;align-items:flex-start;gap:.5rem;width:100%">
          <span class="log-time">${escapeHTML(l.time || '')}</span>
          <span class="log-content" style="flex:1">
            <span class="log-type error_log">${escapeHTML(l.errorCode || 'error')}</span>
            <strong>${escapeHTML(l.userName || '')}</strong>
            <span style="color:var(--text-muted);font-size:.72rem">(${escapeHTML(l.page || '')})</span>
            <br>${escapeHTML(l.errorMessage || '')}
          </span>
        </div>
        <div class="log-detail">
          ${escapeHTML(ctxDisplay)}${l.appVersion ? ' · v' + escapeHTML(l.appVersion) : ''}${uaShort ? ' · ' + escapeHTML(uaShort) : ''}
        </div>
      </div>`;
    }).join('');

    if (totalPages > 1) {
      html += `<div style="display:flex;justify-content:center;align-items:center;gap:.5rem;padding:.8rem 0;font-size:.78rem">
        <button class="outline-btn" style="font-size:.72rem;padding:.25rem .6rem" onclick="App._errorLogGoPage(${safePage - 1})" ${safePage <= 1 ? 'disabled' : ''}>&#8249; 上一頁</button>
        <span style="color:var(--text-muted)">${safePage} / ${totalPages}（共 ${sorted.length} 筆）</span>
        <button class="outline-btn" style="font-size:.72rem;padding:.25rem .6rem" onclick="App._errorLogGoPage(${safePage + 1})" ${safePage >= totalPages ? 'disabled' : ''}>下一頁 &#8250;</button>
      </div>`;
    }

    container.innerHTML = html;
  },

  _populateErrorCodeFilter(logs) {
    const sel = document.getElementById('errlog-code-filter');
    if (!sel) return;
    const current = sel.value;
    const codes = [...new Set(logs.map(l => l.errorCode).filter(Boolean))].sort();
    let opts = '<option value="">全部錯誤碼</option>';
    codes.forEach(c => { opts += `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`; });
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
        Object.keys(obj).forEach(k => {
          if (k !== 'fn') parts.push(`${k}=${obj[k]}`);
        });
        return parts.join(', ');
      }
    } catch (_) {}
    return ctx;
  },

  _parseUserAgent(ua) {
    if (!ua) return '';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
    if (/Android/i.test(ua)) return 'Android';
    if (/Windows/i.test(ua)) return 'Desktop';
    if (/Mac/i.test(ua)) return 'Mac';
    return 'Other';
  },

  async clearOldErrorLogs() {
    const ok = await App.appConfirm('確定要清除 30 天前的錯誤日誌嗎？');
    if (!ok) return;

    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      const cutoffStr = App._formatDateTime ? App._formatDateTime(cutoff) : cutoff.toISOString();

      const logs = ApiService.getErrorLogs().filter(l => (l.time || '') < cutoffStr);
      if (logs.length === 0) {
        this.showToast('沒有 30 天前的紀錄');
        return;
      }

      let deleted = 0;
      // 分批刪除，每批最多 500 筆
      for (let i = 0; i < logs.length; i += 500) {
        const batch = logs.slice(i, i + 500);
        await Promise.all(batch.map(l => FirebaseService.deleteErrorLog(l._docId)));
        deleted += batch.length;
      }

      this.showToast(`已清除 ${deleted} 筆舊紀錄`);
      this.filterErrorLogs(1);
    } catch (err) {
      console.error('[clearOldErrorLogs]', err);
      this.showToast('清除失敗：' + (err.message || ''));
    }
  },
});
