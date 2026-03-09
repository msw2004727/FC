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
      ['admin_user_edit', '管理員編輯用戶'],
    ];
  },

  _getAuditActionLabel(action) {
    const found = this._getAuditActionOptions().find(item => item[0] === action);
    return found ? found[1] : (action || '未命名行為');
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
      actorUid: String(item.actorUid || '').trim(),
      actorName: String(item.actorName || '').trim(),
      action: String(item.action || '').trim(),
      result: String(item.result || '').trim(),
      timeKey,
      createdAtDate,
      createdLabel,
    };
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

  renderAuditLogPage() {
    const dateInput = document.getElementById('auditlog-date');
    if (!dateInput) return;
    if (!dateInput.value) dateInput.value = this._getTodayAuditDateValue();
    this._ensureAuditActionOptions();

    const nextDayKey = this._getAuditDayKeyFromInput(dateInput.value);
    if (!nextDayKey) return;
    if (this._auditLogDayKey !== nextDayKey || this._auditLogItems.length === 0) {
      void this.loadAuditLogs(true);
      return;
    }
    this.filterAuditLogs();
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
        list.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted)">載入中...</div>';
      }
    }
    this._updateAuditLoadMoreState();

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
      items = items.filter(item =>
        (item.actorName || '').toLowerCase().includes(keyword)
        || (item.actorUid || '').toLowerCase().includes(keyword)
      );
    }
    if (action) {
      items = items.filter(item => item.action === action);
    }
    if (start || end) {
      items = items.filter(item => this._matchesAuditTimeRange(item, start, end));
    }

    this.renderAuditLogs(items);
  },

  _updateAuditLoadMoreState() {
    const btn = document.getElementById('auditlog-load-more');
    if (!btn) return;
    btn.style.display = this._auditLogHasMore ? '' : 'none';
    btn.disabled = this._auditLogLoading;
    btn.textContent = this._auditLogLoading ? '載入中...' : '載入更多';
  },

  renderAuditLogs(items) {
    const list = document.getElementById('audit-log-list');
    const summary = document.getElementById('auditlog-summary');
    if (!list) return;

    if (summary) {
      summary.textContent = `共 ${this._auditLogItems.length} 筆，顯示 ${items.length} 筆`;
    }

    if (!items.length) {
      list.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-muted)">目前沒有符合條件的稽核日誌</div>';
      return;
    }

    list.innerHTML = items.map(item => {
      const actorName = item.actorName || item.actorUid || '未知用戶';
      let actionLabel = this._getAuditActionLabel(item.action);
      if (item.result === 'failure' && !actionLabel.includes('失敗')) {
        actionLabel += '（失敗）';
      }
      return `
        <div class="log-item">
          <span class="log-time">${escapeHTML(item.createdLabel || item.timeKey || '')}</span>
          <span class="log-content">
            <span class="log-type role">${escapeHTML(actorName)}</span>
            ${escapeHTML(actionLabel)}
          </span>
        </div>
      `;
    }).join('');
  },

  async loadMoreAuditLogs() {
    if (!this._auditLogHasMore || this._auditLogLoading) return;
    await this.loadAuditLogs(false);
  },
});
