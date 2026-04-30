/* ================================================
   SportHub Error Log Insights
   Grouping, trend and diagnostic package helpers
   ================================================ */

Object.assign(App, {
  _errorLogInsightGroups: [],
  _errorLogCopyItems: null,

  _getErrorLogGroupKey(log) {
    return [
      this._getErrorSeverity(log).key,
      this._normalizeErrorCode(log?.errorCode),
      this._getErrorPage(log),
      this._getErrorFunctionName(log),
      this._getErrorChineseMessage(log),
    ].join('||').toLowerCase();
  },

  _getErrorLogGroups(logs) {
    const map = new Map();
    (logs || []).forEach(log => {
      const key = this._getErrorLogGroupKey(log);
      if (!map.has(key)) {
        const severity = this._getErrorSeverity(log);
        map.set(key, {
          key,
          severity,
          codeLabel: this._getErrorCodeLabel(log?.errorCode),
          message: this._getErrorChineseMessage(log),
          page: this._getErrorPage(log),
          fn: this._getErrorFunctionName(log),
          users: new Set(),
          versions: new Set(),
          devices: new Set(),
          logs: [],
          firstMs: 0,
          lastMs: 0,
        });
      }
      const group = map.get(key);
      const ms = this._getErrorTimestampMs(log);
      group.logs.push(log);
      if (log?.uid) group.users.add(String(log.uid));
      if (this._getErrorVersion(log)) group.versions.add(this._getErrorVersion(log));
      if (this._getErrorDeviceLabel(log)) group.devices.add(this._getErrorDeviceLabel(log));
      group.firstMs = group.firstMs ? Math.min(group.firstMs, ms || group.firstMs) : ms;
      group.lastMs = Math.max(group.lastMs || 0, ms || 0);
    });
    return [...map.values()].sort((a, b) => (b.logs.length - a.logs.length) || (b.lastMs - a.lastMs));
  },

  _getErrorLogTrend(logs, days = 7) {
    const today = new Date();
    const rows = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      rows.push({ key, label: `${d.getMonth() + 1}/${d.getDate()}`, count: 0, critical: 0 });
    }
    const byKey = new Map(rows.map(row => [row.key, row]));
    (logs || []).forEach(log => {
      const row = byKey.get(this._getErrorDateKey(log));
      if (!row) return;
      row.count += 1;
      if (this._getErrorSeverity(log).key === 'critical') row.critical += 1;
    });
    return rows;
  },

  _renderErrorLogInsights(allLogs, visibleLogs) {
    const logs = visibleLogs || [];
    this._errorLogInsightGroups = this._getErrorLogGroups(logs).slice(0, 5);
    if (!logs.length) return '';
    const trend = this._getErrorLogTrend(logs);
    const maxTrend = Math.max(1, ...trend.map(row => row.count));
    const trendHtml = trend.map(row => {
      const h = Math.max(6, Math.round((row.count / maxTrend) * 52));
      const cls = row.critical ? ' has-critical' : '';
      return `<div class="error-log-trend-day${cls}" title="${escapeHTML(row.key)}：${row.count} 筆">
        <span class="error-log-trend-bar" style="height:${h}px"></span>
        <strong>${escapeHTML(String(row.count))}</strong>
        <small>${escapeHTML(row.label)}</small>
      </div>`;
    }).join('');
    const groupHtml = this._errorLogInsightGroups.map((group, idx) => this._renderErrorLogGroup(group, idx)).join('');
    return `<div class="error-log-insights">
      <div class="error-log-insight-panel">
        <div class="error-log-insight-title">近 7 天趨勢</div>
        <div class="error-log-trend">${trendHtml}</div>
      </div>
      <div class="error-log-insight-panel">
        <div class="error-log-insight-title">同類錯誤 Top ${this._errorLogInsightGroups.length}</div>
        <div class="error-log-groups">${groupHtml || '<div class="error-log-empty-inline">目前沒有可聚合的錯誤</div>'}</div>
      </div>
    </div>`;
  },

  _renderErrorLogGroup(group, idx) {
    const last = group.lastMs ? this._formatDateTime(new Date(group.lastMs)) : '';
    const meta = [
      `頁面：${group.page}`,
      group.fn ? `功能：${group.fn}` : '',
      `用戶：${group.users.size}`,
      group.versions.size ? `版本：${[...group.versions].slice(0, 2).join(', ')}` : '',
      last ? `最近：${last}` : '',
    ].filter(Boolean);
    return `<div class="error-log-group">
      <div class="error-log-group-head">
        <span class="log-type ${group.severity.className}">${escapeHTML(group.severity.label)}</span>
        <strong>${escapeHTML(group.codeLabel)} · ${escapeHTML(String(group.logs.length))} 筆</strong>
        <button type="button" class="outline-btn error-log-copy-btn" onclick="App.copyErrorLogDiagnosticGroup(${idx})">複製診斷包</button>
      </div>
      <div class="error-log-message">${escapeHTML(group.message)}</div>
      <div class="error-log-meta">${meta.map(item => `<span>${escapeHTML(item)}</span>`).join('')}</div>
    </div>`;
  },

  _buildErrorLogDiagnosticText(log) {
    return [
      'ToosterX 錯誤診斷包',
      `時間：${this._formatErrorLogTime(log) || ''}`,
      `嚴重度：${this._getErrorSeverity(log).label}`,
      `白話錯誤：${this._getErrorChineseMessage(log)}`,
      `錯誤類型：${this._getErrorCodeLabel(log?.errorCode)} (${this._normalizeErrorCode(log?.errorCode) || 'no-code'})`,
      `用戶：${log?.userName || ''} / ${log?.uid || ''}`,
      `頁面/功能：${this._getErrorPage(log)} / ${this._getErrorFunctionName(log) || ''}`,
      `版本/裝置：${this._getErrorVersion(log) || ''} / ${this._getErrorDeviceLabel(log) || ''}`,
      `URL：${log?.url || ''}`,
      `Context：${this._parseErrorContext(log?.context) || ''}`,
      `原始錯誤：${log?.errorMessage || ''}`,
      `Stack：${String(log?.errorStack || '').slice(0, 1200)}`,
      `文件 ID：${log?._docId || ''}`,
    ].join('\n');
  },

  _buildErrorGroupDiagnosticText(group) {
    const sample = group.logs[0] || {};
    return [
      'ToosterX 同類錯誤診斷包',
      `筆數：${group.logs.length}`,
      `嚴重度：${group.severity.label}`,
      `白話錯誤：${group.message}`,
      `錯誤類型：${group.codeLabel}`,
      `頁面/功能：${group.page} / ${group.fn || ''}`,
      `受影響用戶數：${group.users.size}`,
      `版本：${[...group.versions].join(', ') || ''}`,
      `裝置：${[...group.devices].join(', ') || ''}`,
      `最早/最近：${group.firstMs ? this._formatDateTime(new Date(group.firstMs)) : ''} / ${group.lastMs ? this._formatDateTime(new Date(group.lastMs)) : ''}`,
      '',
      this._buildErrorLogDiagnosticText(sample),
    ].join('\n');
  },

  async _copyErrorLogText(text) {
    if (!text) return false;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    if (typeof document === 'undefined') return false;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  },

  async copyErrorLogDiagnostic(copyId) {
    const log = this._errorLogCopyItems?.[copyId];
    if (!log) { this.showToast('找不到可複製的錯誤資料'); return; }
    try {
      await this._copyErrorLogText(this._buildErrorLogDiagnosticText(log));
      this.showToast('已複製錯誤診斷包');
    } catch (err) {
      console.error('[copyErrorLogDiagnostic]', err);
      this.showToast('複製失敗，請展開技術細節手動複製');
    }
  },

  async copyErrorLogDiagnosticGroup(index) {
    const group = this._errorLogInsightGroups?.[Number(index)];
    if (!group) { this.showToast('找不到可複製的同類錯誤'); return; }
    try {
      await this._copyErrorLogText(this._buildErrorGroupDiagnosticText(group));
      this.showToast('已複製同類錯誤診斷包');
    } catch (err) {
      console.error('[copyErrorLogDiagnosticGroup]', err);
      this.showToast('複製失敗，請稍後再試');
    }
  },
});
