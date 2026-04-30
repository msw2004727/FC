/* ================================================
   SportHub Audit Log Module
   Super admin only, daily bucketed query with local filters
   ================================================ */

Object.assign(App, {
  _auditLogItems: [],
  _auditLogCursor: null,
  _auditLogHasMore: false,
  _auditLogDayKey: '',
  _auditLogLoading: false,
  _auditLogBackfilling: false,

  _getAuditActionOptions() {
    return [
      ['', '全部行為'],
      ['login_success', '登入成功'],
      ['login_failure', '登入失敗'],
      ['logout', '登出'],
      ['event_signup', '活動報名'],
      ['event_cancel_signup', '取消報名'],
      ['team_join_request', '申請入隊'],
      ['team_join_approve', '同意入隊'],
      ['team_join_reject', '拒絕入隊'],
      ['role_change', '角色變更'],
      ['admin_user_edit', '管理員編輯用戶資料'],
    ];
  },

  _getAuditActionLabel(action) {
    const found = this._getAuditActionOptions().find(item => item[0] === action);
    return found ? found[1] : (action || '未知行為');
  },

  _getTodayAuditDateValue() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },

  _getAuditDayKeyFromInput(value) {
    return String(value || '').replace(/\D/g, '').slice(0, 8);
  },

  _normalizeAuditTime(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw.length === 5 ? `${raw}:00` : raw.slice(0, 8);
  },

  _normalizeAuditLogEntry(item) {
    const createdAtDate = item?.createdAt?.toDate
      ? item.createdAt.toDate()
      : (item?.createdAt instanceof Date ? item.createdAt : null);

    const timeKey = this._normalizeAuditTime(item?.timeKey);
    const createdLabel = createdAtDate
      ? createdAtDate.toLocaleTimeString('zh-TW', { hour12: false })
      : (timeKey || '');

    return {
      ...item,
      actorUid: String(item?.actorUid || '').trim(),
      actorName: String(item?.actorName || '').trim(),
      action: String(item?.action || '').trim(),
      result: String(item?.result || '').trim(),
      source: String(item?.source || '').trim(),
      targetType: String(item?.targetType || '').trim(),
      targetId: String(item?.targetId || '').trim(),
      targetLabel: String(item?.targetLabel || '').trim(),
      meta: (item?.meta && typeof item.meta === 'object') ? item.meta : {},
      timeKey,
      createdAtDate,
      createdLabel,
    };
  },

  _resolveAuditActorName(item) {
    const actorUid = String(item?.actorUid || '').trim();
    const storedName = String(item?.actorName || '').trim();
    if (storedName && storedName !== actorUid) return storedName;

    const users = (typeof ApiService !== 'undefined' && typeof ApiService.getAdminUsers === 'function')
      ? (ApiService.getAdminUsers() || [])
      : [];
    const matched = users.find(user =>
      user?.uid === actorUid
      || user?._docId === actorUid
      || user?.lineUserId === actorUid
    );
    const resolved = String(matched?.displayName || matched?.name || '').trim();
    if (resolved) return resolved;

    return storedName || actorUid || '未知用戶';
  },

  _needsAuditActorBackfill(item) {
    const actorUid = String(item?.actorUid || '').trim();
    const actorName = String(item?.actorName || '').trim();
    return !!actorUid && (!actorName || actorName === actorUid);
  },

  _formatAuditMetaValue(value) {
    if (value == null) return '';
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch (_) {
        return String(value);
      }
    }
    return String(value);
  },

  _getAuditMetaPairs(item) {
    const meta = item?.meta && typeof item.meta === 'object' ? item.meta : {};
    return Object.entries(meta)
      .map(([key, value]) => [String(key || '').trim(), this._formatAuditMetaValue(value).trim()])
      .filter(([key, value]) => key && value);
  },

  _getAuditMetaText(item) {
    return this._getAuditMetaPairs(item)
      .map(([key, value]) => `${key}=${value}`)
      .join(' · ');
  },

  _getAuditResultLabel(result) {
    const normalized = String(result || '').trim();
    if (normalized === 'success') return '成功';
    if (normalized === 'failure') return '失敗';
    return normalized || '未標示';
  },

  _getAuditSourceLabel(source) {
    const normalized = String(source || '').trim();
    const labels = {
      web: '網頁',
      liff: 'LINE LIFF',
      system: '系統',
      cloud_function: '後端函式',
    };
    return labels[normalized] || normalized || '未標示';
  },

  _getAuditTargetTypeLabel(targetType) {
    const normalized = String(targetType || '').trim();
    const labels = {
      system: '系統',
      user: '用戶',
      event: '活動',
      team: '俱樂部',
      message: '訊息',
    };
    return labels[normalized] || normalized || '目標';
  },

  _getAuditTargetSummary(item) {
    const typeLabel = this._getAuditTargetTypeLabel(item?.targetType);
    const targetLabel = String(item?.targetLabel || '').trim();
    const targetId = String(item?.targetId || '').trim();
    if (!targetLabel && !targetId && !item?.targetType) return '未標示';
    const main = targetLabel || targetId || '未命名';
    const idSuffix = targetId && targetId !== main ? `（${targetId}）` : '';
    return `${typeLabel}：${main}${idSuffix}`;
  },

  _getAuditSearchText(item) {
    const parts = [
      this._resolveAuditActorName(item),
      item?.actorUid,
      item?.action,
      this._getAuditActionLabel(item?.action),
      item?.result,
      this._getAuditResultLabel(item?.result),
      item?.source,
      this._getAuditSourceLabel(item?.source),
      item?.targetType,
      this._getAuditTargetTypeLabel(item?.targetType),
      item?.targetId,
      item?.targetLabel,
      item?._docId,
      this._getAuditMetaText(item),
    ];
    return parts
      .map(value => String(value || '').trim().toLowerCase())
      .filter(Boolean)
      .join(' ');
  },

  _matchesAuditKeyword(item, keyword) {
    const normalized = String(keyword || '').trim().toLowerCase();
    return !normalized || this._getAuditSearchText(item).includes(normalized);
  },

  _isTodayAuditDay(dayKey) {
    return dayKey === this._getAuditDayKeyFromInput(this._getTodayAuditDateValue());
  },

  _hasActiveAuditFilters() {
    return !!(
      (document.getElementById('auditlog-search')?.value || '').trim()
      || (document.getElementById('auditlog-action-filter')?.value || '').trim()
      || this._normalizeAuditTime(document.getElementById('auditlog-time-start')?.value)
      || this._normalizeAuditTime(document.getElementById('auditlog-time-end')?.value)
    );
  },

  _syncAuditFilterSummary() {
    const details = document.getElementById('auditlog-filter-details');
    const summaryText = document.getElementById('auditlog-filter-summary-text');
    const summaryMeta = document.getElementById('auditlog-filter-summary-meta');
    if (!details || !summaryText || !summaryMeta) return;

    const dateValue = document.getElementById('auditlog-date')?.value || '';
    const hasActiveFilters = this._hasActiveAuditFilters();
    const activeCount = [
      this._normalizeAuditTime(document.getElementById('auditlog-time-start')?.value),
      this._normalizeAuditTime(document.getElementById('auditlog-time-end')?.value),
      (document.getElementById('auditlog-action-filter')?.value || '').trim(),
      (document.getElementById('auditlog-search')?.value || '').trim(),
    ].filter(Boolean).length;
    const dateLabel = dateValue || '尚未選擇日期';

    details.classList.toggle('has-active-filters', hasActiveFilters);
    summaryText.textContent = details.open ? '收合搜尋條件' : '展開搜尋條件';
    summaryMeta.textContent = hasActiveFilters
      ? `${dateLabel}，另有 ${activeCount} 項篩選`
      : dateLabel;
  },

  _ensureAuditFilterDetails() {
    const details = document.getElementById('auditlog-filter-details');
    if (!details || details.dataset.bound === '1') return;
    details.dataset.bound = '1';
    details.addEventListener('toggle', () => this._syncAuditFilterSummary());
  },

  _ensureAuditActionOptions() {
    const select = document.getElementById('auditlog-action-filter');
    if (!select) return;
    const current = select.value;
    select.innerHTML = this._getAuditActionOptions()
      .map(([value, label]) => `<option value="${escapeHTML(value)}">${escapeHTML(label)}</option>`)
      .join('');
    select.value = current || '';
  },

  _ensureAuditBackfillButton() {
    const actions = document.getElementById('admin-log-toolbar-actions');
    if (!actions) return null;

    let btn = document.getElementById('auditlog-backfill-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'auditlog-backfill-btn';
      btn.className = 'outline-btn admin-log-action-btn';
      btn.type = 'button';
      btn.dataset.adminLogActionTab = 'audit';
      btn.dataset.actionAvailable = '0';
      btn.textContent = '補齊暱稱';
      btn.addEventListener('click', () => { void this.backfillAuditActorNames(); });
      actions.appendChild(btn);
      this._refreshAdminLogToolbarActions?.();
    }
    return btn;
  },

  _ensureAuditRefreshButton() {
    // 重整按鈕已移至 tab bar 圓形圖示按鈕（admin-log-tabs.js）
  },

  _updateAuditBackfillState() {
    const btn = document.getElementById('auditlog-backfill-btn');
    if (!btn) return;

    const unresolvedCount = this._auditLogItems.filter(item => this._needsAuditActorBackfill(item)).length;
    const allowBackfill = unresolvedCount > 0 && this._isTodayAuditDay(this._auditLogDayKey);

    btn.dataset.actionAvailable = allowBackfill ? '1' : '0';
    btn.disabled = this._auditLogBackfilling;
    btn.textContent = this._auditLogBackfilling
      ? '補齊中...'
      : `補齊暱稱（${unresolvedCount}）`;
    this._refreshAdminLogToolbarActions?.();
  },

  renderAuditLogPage() {
    const dateInput = document.getElementById('auditlog-date');
    if (!dateInput) return;
    if (!dateInput.value) dateInput.value = this._getTodayAuditDateValue();
    this._ensureAuditActionOptions();
    this._ensureAuditBackfillButton();
    this._ensureAuditRefreshButton();
    this._ensureAuditFilterDetails();
    this._syncAuditFilterSummary();
    this._refreshAdminLogToolbarActions?.();

    const nextDayKey = this._getAuditDayKeyFromInput(dateInput.value);
    if (!nextDayKey) return;
    if (this._auditLogDayKey !== nextDayKey || this._auditLogItems.length === 0) {
      void this.loadAuditLogs(true);
      return;
    }
    this.filterAuditLogs();
    this._updateAuditBackfillState();
  },

  async loadAuditLogs(reset = true) {
    if (this._auditLogLoading) return;
    const dateInput = document.getElementById('auditlog-date');
    const list = document.getElementById('audit-log-list');
    const dayKey = this._getAuditDayKeyFromInput(dateInput?.value);
    if (!dayKey) {
      this.showToast('請先選擇日期');
      return;
    }

    this._auditLogLoading = true;
    if (reset) {
      this._auditLogCursor = null;
      this._auditLogHasMore = false;
      this._auditLogItems = [];
      this._auditLogDayKey = dayKey;
      if (list) {
        list.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted)">讀取中...</div>';
      }
    }
    this._updateAuditLoadMoreState();
    this._updateAuditBackfillState();

    try {
      const result = await ApiService.getAuditLogsByDay(dayKey, {
        pageSize: 100,
        startAfter: reset ? null : this._auditLogCursor,
      });
      const items = (result.items || []).map(item => this._normalizeAuditLogEntry(item));
      this._auditLogItems = reset ? items : this._auditLogItems.concat(items);
      this._auditLogCursor = result.lastDoc || this._auditLogCursor;
      this._auditLogHasMore = !!result.hasMore;
      this._auditLogDayKey = dayKey;
      this.filterAuditLogs();
    } catch (err) {
      console.error('[loadAuditLogs]', err);
      if (list) {
        list.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--danger)">讀取稽核日誌失敗</div>';
      }
      this.showToast('讀取稽核日誌失敗');
    } finally {
      this._auditLogLoading = false;
      this._updateAuditLoadMoreState();
      this._updateAuditBackfillState();
    }
  },

  _matchesAuditTimeRange(item, start, end) {
    const timeKey = this._normalizeAuditTime(item?.timeKey);
    if (start && timeKey && timeKey < start) return false;
    if (end && timeKey && timeKey > end) return false;
    return true;
  },

  filterAuditLogs() {
    const keyword = (document.getElementById('auditlog-search')?.value || '').trim().toLowerCase();
    const action = document.getElementById('auditlog-action-filter')?.value || '';
    const start = this._normalizeAuditTime(document.getElementById('auditlog-time-start')?.value);
    const end = this._normalizeAuditTime(document.getElementById('auditlog-time-end')?.value);

    let items = [...this._auditLogItems];
    if (keyword) {
      items = items.filter(item => this._matchesAuditKeyword(item, keyword));
    }
    if (action) {
      items = items.filter(item => item.action === action);
    }
    if (start || end) {
      items = items.filter(item => this._matchesAuditTimeRange(item, start, end));
    }

    this.renderAuditLogs(items);
    this._updateAuditBackfillState();
    this._syncAuditFilterSummary();
  },

  _updateAuditLoadMoreState() {
    const btn = document.getElementById('auditlog-load-more');
    if (!btn) return;
    btn.style.display = this._auditLogHasMore ? '' : 'none';
    btn.disabled = this._auditLogLoading;
    btn.textContent = this._auditLogLoading ? '讀取中...' : '載入更多';
    const refreshBtn = document.getElementById('auditlog-refresh-btn');
    if (refreshBtn) refreshBtn.disabled = this._auditLogLoading;
  },

  _getAuditDisplayText(item) {
    const actionLabel = this._getAuditActionLabel(item.action);
    const targetLabel = String(item?.targetLabel || item?.targetId || '').trim();
    return targetLabel ? `${actionLabel}：${targetLabel}` : actionLabel;
  },

  _getAuditActionClass(item) {
    const action = String(item?.action || '');
    if (item?.result === 'failure') return 'audit-failure';
    if (action === 'login_success') return 'audit-login';
    if (action === 'login_failure') return 'audit-failure';
    if (action === 'logout') return 'audit-logout';
    if (action === 'event_signup') return 'audit-signup';
    if (action === 'event_cancel_signup') return 'audit-cancel';
    if (action.startsWith('team_join')) return 'audit-team';
    if (action === 'role_change') return 'audit-role';
    if (action === 'admin_user_edit') return 'audit-admin';
    return '';
  },

  renderAuditLogs(items) {
    const list = document.getElementById('audit-log-list');
    const summary = document.getElementById('auditlog-summary');
    if (!list) return;
    this._ensureAuditLogListActions();

    if (summary) {
      const successCount = items.filter(item => item.result === 'success').length;
      const failureCount = items.filter(item => item.result === 'failure').length;
      const moreNote = this._auditLogHasMore
        ? '<span class="audit-log-summary-note">還有更多未載入，搜尋目前只比對已載入資料。</span>'
        : '';
      summary.innerHTML = `
        <div class="audit-log-summary">
          <span>已載入 <strong>${escapeHTML(this._auditLogItems.length)}</strong> 筆</span>
          <span>目前顯示 <strong>${escapeHTML(items.length)}</strong> 筆</span>
          <span>成功 <strong>${escapeHTML(successCount)}</strong></span>
          <span>失敗 <strong>${escapeHTML(failureCount)}</strong></span>
          ${moreNote}
        </div>
      `;
    }

    if (!items.length) {
      list.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted)">這一天沒有符合條件的稽核日誌</div>';
      return;
    }

    list.innerHTML = items.map(item => {
      const actorName = this._resolveAuditActorName(item);
      const actionLabel = this._getAuditDisplayText(item);
      const actionClass = this._getAuditActionClass(item);
      const resultClass = String(item.result || 'unknown').replace(/[^a-z0-9_-]/gi, '') || 'unknown';
      const resultLabel = this._getAuditResultLabel(item.result);
      const sourceLabel = this._getAuditSourceLabel(item.source);
      const targetSummary = this._getAuditTargetSummary(item);
      const metaText = this._getAuditMetaText(item);
      const docId = String(item?._docId || '').trim();
      return `
        <div class="log-item audit-log-item${actionClass ? ' ' + actionClass : ''}">
          <div class="audit-log-main">
            <span class="log-time">${escapeHTML(item.createdLabel || item.timeKey || '')}</span>
            <span class="log-content">
              <span class="log-type role">${escapeHTML(actorName)}</span>
              <span class="audit-log-action-text">${escapeHTML(actionLabel)}</span>
            </span>
            <span class="audit-log-result audit-log-result-${escapeHTML(resultClass)}">${escapeHTML(resultLabel)}</span>
          </div>
          <div class="audit-log-meta">
            <span>目標：${escapeHTML(targetSummary)}</span>
            <span>來源：${escapeHTML(sourceLabel)}</span>
            <span>UID：${escapeHTML(item.actorUid || '未標示')}</span>
          </div>
          <details class="audit-log-details">
            <summary>查看詳細內容</summary>
            <div class="audit-log-detail-grid">
              <div class="audit-log-detail-row"><span>動作</span><pre>${escapeHTML(item.action || '未標示')}</pre></div>
              <div class="audit-log-detail-row"><span>目標 ID</span><pre class="is-mono">${escapeHTML(item.targetId || '未標示')}</pre></div>
              <div class="audit-log-detail-row"><span>來源</span><pre>${escapeHTML(sourceLabel)}${item.source ? `（${escapeHTML(item.source)}）` : ''}</pre></div>
              <div class="audit-log-detail-row"><span>Meta</span><pre class="is-mono">${escapeHTML(metaText || '無')}</pre></div>
              ${docId ? `<div class="audit-log-detail-row"><span>文件 ID</span><pre class="is-mono">${escapeHTML(docId)}</pre></div>` : ''}
            </div>
            ${docId ? `<button type="button" class="outline-btn audit-log-copy-btn" data-audit-doc-id="${escapeHTML(docId)}">複製診斷包</button>` : ''}
          </details>
        </div>
      `;
    }).join('');
  },

  _ensureAuditLogListActions() {
    const list = document.getElementById('audit-log-list');
    if (!list || list.dataset.auditActionsBound === '1') return;
    list.dataset.auditActionsBound = '1';
    list.addEventListener('click', event => {
      const button = event.target?.closest?.('[data-audit-doc-id]');
      if (!button) return;
      void this.copyAuditLogDiagnostic(button.dataset.auditDocId || '');
    });
  },

  _buildAuditLogDiagnosticText(item) {
    const actorName = this._resolveAuditActorName(item);
    return [
      'ToosterX 稽核日誌診斷包',
      `時間：${item.createdLabel || item.timeKey || '未標示'}`,
      `結果：${this._getAuditResultLabel(item.result)} (${item.result || 'unknown'})`,
      `動作：${this._getAuditActionLabel(item.action)} (${item.action || 'unknown'})`,
      `操作者：${actorName} / ${item.actorUid || '未標示'}`,
      `目標：${this._getAuditTargetSummary(item)}`,
      `來源：${this._getAuditSourceLabel(item.source)}${item.source ? ` (${item.source})` : ''}`,
      `Meta：${this._getAuditMetaText(item) || '無'}`,
      `文件 ID：${item._docId || '未標示'}`,
    ].join('\n');
  },

  async copyAuditLogDiagnostic(docId) {
    const targetId = String(docId || '').trim();
    const item = this._auditLogItems.find(log => String(log?._docId || '') === targetId);
    if (!item) {
      this.showToast?.('找不到這筆稽核日誌');
      return;
    }
    const text = this._buildAuditLogDiagnosticText(item);
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      this.showToast?.('已複製稽核診斷包');
    } catch (err) {
      console.error('[copyAuditLogDiagnostic]', err);
      this.showToast?.('複製稽核診斷包失敗');
    }
  },

  async backfillAuditActorNames() {
    if (this._auditLogBackfilling) return;
    const dayKey = this._auditLogDayKey || this._getAuditDayKeyFromInput(document.getElementById('auditlog-date')?.value);
    if (!dayKey) {
      this.showToast('請先選擇日期');
      return;
    }

    this._auditLogBackfilling = true;
    this._updateAuditBackfillState();

    try {
      const result = await ApiService.backfillAuditActorNames(dayKey);
      if (!result?.success) {
        this.showToast('補齊暱稱失敗');
        return;
      }

      if (result.updated > 0) {
        const uniqueUsers = Number(result.uniqueUsers || 0);
        this.showToast(uniqueUsers > 0
          ? `已補齊 ${result.updated} 筆暱稱（${uniqueUsers} 位用戶）`
          : `已補齊 ${result.updated} 筆暱稱`);
        await this.loadAuditLogs(true);
        return;
      }

      this.showToast('沒有需要補齊的暱稱');
      this._updateAuditBackfillState();
    } catch (err) {
      console.error('[backfillAuditActorNames]', err);
      this.showToast('補齊暱稱失敗');
    } finally {
      this._auditLogBackfilling = false;
      this._updateAuditBackfillState();
    }
  },

  async loadMoreAuditLogs() {
    if (!this._auditLogHasMore || this._auditLogLoading) return;
    await this.loadAuditLogs(false);
  },

  async refreshAuditLogs() {
    await this.loadAuditLogs(true);
  },
});
