/* ================================================
   ToosterX — PM audit center (super_admin only)
   ================================================ */

Object.assign(App, {
  _pmAuditSelectedUid: '',
  _pmAuditSelectedConversationId: '',
  _pmSettingsSaving: false,
  _pmAuditLogItems: [],
  _pmAuditLogNextCursor: null,
  _pmAuditLogAction: '',
  _pmAuditLogLoading: false,

  _isPmAuditAllowed() {
    const role = ApiService.getCurrentUser?.()?.role || this.currentRole || 'user';
    return role === 'super_admin';
  },

  _pmAuditActionLabel(action) {
    const labels = {
      send: 'send',
      read: 'read',
      edit: 'edit',
      recall: 'recall',
      search_user: 'search',
      audit_view_thread: 'threads',
      audit_view_conversation: 'view',
      audit_search_logs: 'logs',
      settings_update: 'settings',
    };
    return labels[String(action || '')] || String(action || '-');
  },

  _pmAuditShortUid(uid) {
    const text = String(uid || '').trim();
    if (!text) return '-';
    return text.length > 14 ? `${text.slice(0, 6)}...${text.slice(-4)}` : text;
  },

  _pmAuditShortTime(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    }
    return text.slice(0, 16);
  },

  _renderPmAuditLogRows(logs) {
    return (logs || []).map(log => {
      const actor = this._pmAuditShortUid(log.actorUid);
      const target = this._pmAuditShortUid(log.targetUid);
      const route = target && target !== '-' ? `${actor} -> ${target}` : actor;
      const fullRoute = [log.actorUid, log.targetUid].filter(Boolean).join(' -> ');
      return `
        <div class="pm-audit-log" title="${escapeHTML(fullRoute)}">
          <strong>${escapeHTML(this._pmAuditActionLabel(log.action))}</strong>
          <span data-no-translate>${escapeHTML(route)}</span>
          <small>${escapeHTML(this._pmAuditShortTime(log.createdAtIso) || this._pmFormatTime?.(log.createdAt) || '')}</small>
        </div>`;
    }).join('');
  },

  _renderPmAuditLogList(logs, options = {}) {
    const box = document.getElementById('pm-audit-logs');
    if (!box) return;
    const hasMore = options.hasMore === true;
    const loading = options.loading === true;
    const loadingText = '\u8f09\u5165\u4e2d...';
    if (!Array.isArray(logs) || logs.length === 0) {
      box.innerHTML = `<div class="muted">${loading ? loadingText : '\u76ee\u524d\u6c92\u6709 log'}</div>`;
      return;
    }
    const buttonText = loading ? loadingText : '\u52a0\u8f09\u66f4\u591a';
    const footer = hasMore || loading
      ? `<div class="pm-audit-load-more-row"><button type="button" class="outline-btn small pm-audit-load-more" onclick="App.loadMorePmAuditLogs()" ${loading ? 'disabled' : ''}>${buttonText}</button></div>`
      : `<div class="pm-audit-log-end muted">${'\u6c92\u6709\u66f4\u591a log'}</div>`;
    box.innerHTML = this._renderPmAuditLogRows(logs) + footer;
  },

  renderPmAuditPanel() {
    const panel = document.querySelector('[data-admin-log-panel="chat"]');
    if (!panel) return;
    if (!this._isPmAuditAllowed()) {
      panel.innerHTML = '<div class="admin-empty-state">聊天室稽核僅限 super_admin 查看</div>';
      return;
    }
    if (panel.dataset.pmAuditReady !== '1') {
      panel.dataset.pmAuditReady = '1';
      panel.innerHTML = `
        <div class="pm-audit-layout">
          <section class="pm-audit-card pm-audit-settings-card">
            <div class="pm-audit-setting-row">
              <div class="pm-audit-setting-copy">
                <h3>User互相私訊</h3>
                <p>開啟後 user 層級可彼此開新私訊；關閉時維持上下層級或既有對話。</p>
              </div>
              <label class="pm-audit-switch" aria-label="User互相私訊">
                <input id="pm-user-pm-toggle" type="checkbox" onchange="App.savePmAuditSettings(this.checked)">
                <span></span>
              </label>
            </div>
            <div id="pm-audit-settings-status" class="pm-audit-setting-status muted">設定載入中...</div>
          </section>
          <section class="pm-audit-card">
            <h3>搜尋用戶對話</h3>
            <div class="pm-audit-row">
              <input id="pm-audit-user-query" type="text" placeholder="輸入暱稱或識別碼">
              <button type="button" class="primary-btn small" onclick="App.searchPmAuditUsers()">搜尋</button>
            </div>
            <div id="pm-audit-users" class="pm-audit-results"></div>
          </section>
          <section class="pm-audit-card">
            <h3>對話列表</h3>
            <div id="pm-audit-threads" class="pm-audit-results muted">請先搜尋並選擇用戶</div>
          </section>
          <section class="pm-audit-card pm-audit-conversation-card">
            <h3>對話內容</h3>
            <div id="pm-audit-conversation" class="pm-audit-conversation muted">尚未選擇對話</div>
          </section>
          <section class="pm-audit-card">
            <h3>Log</h3>
            <div class="pm-audit-row">
              <select id="pm-audit-action">
                <option value="">全部動作</option>
                <option value="send">送出</option>
                <option value="read">已讀</option>
                <option value="edit">編輯</option>
                <option value="recall">撤回</option>
                <option value="search_user">搜尋用戶</option>
                <option value="audit_view_thread">查看對話列表</option>
                <option value="audit_view_conversation">查看對話內容</option>
                <option value="audit_search_logs">查詢 log</option>
                <option value="settings_update">設定更新</option>
              </select>
              <button type="button" class="outline-btn small" onclick="App.loadPmAuditLogs()">重新整理</button>
            </div>
            <div id="pm-audit-logs" class="pm-audit-results"></div>
          </section>
        </div>`;
    }
    this.loadPmAuditSettings();
    this.loadPmAuditLogs();
  },

  async loadPmAuditSettings() {
    const toggle = document.getElementById('pm-user-pm-toggle');
    const status = document.getElementById('pm-audit-settings-status');
    if (!toggle || !status) return;
    try {
      toggle.disabled = true;
      status.textContent = '設定載入中...';
      const fn = this._pmCallable?.('getPrivateMessageSettings');
      const resp = await fn({});
      const allowUserToUserPm = resp?.data?.settings?.allowUserToUserPm === true;
      toggle.checked = allowUserToUserPm;
      status.textContent = allowUserToUserPm
        ? '已開啟：user 可以互相建立新私訊。'
        : '已關閉：user 只能依上下層級或既有對話私訊。';
    } catch (err) {
      console.warn('[loadPmAuditSettings]', err);
      status.textContent = '設定載入失敗';
    } finally {
      toggle.disabled = false;
    }
  },

  async savePmAuditSettings(allowUserToUserPm) {
    if (this._pmSettingsSaving) return;
    const toggle = document.getElementById('pm-user-pm-toggle');
    const status = document.getElementById('pm-audit-settings-status');
    this._pmSettingsSaving = true;
    if (toggle) toggle.disabled = true;
    if (status) status.textContent = '儲存中...';
    try {
      const fn = this._pmCallable?.('updatePrivateMessageSettings');
      const resp = await fn({ allowUserToUserPm: allowUserToUserPm === true });
      const saved = resp?.data?.settings?.allowUserToUserPm === true;
      if (toggle) toggle.checked = saved;
      if (status) {
        status.textContent = saved
          ? '已開啟：user 可以互相建立新私訊。'
          : '已關閉：user 只能依上下層級或既有對話私訊。';
      }
      this.showToast?.('私訊設定已更新');
      this.loadPmAuditLogs('settings_update');
    } catch (err) {
      console.warn('[savePmAuditSettings]', err);
      if (toggle) toggle.checked = !allowUserToUserPm;
      if (status) status.textContent = '儲存失敗，設定未變更';
      this.showToast?.('私訊設定儲存失敗');
    } finally {
      this._pmSettingsSaving = false;
      if (toggle) toggle.disabled = false;
    }
  },

  async searchPmAuditUsers() {
    const query = String(document.getElementById('pm-audit-user-query')?.value || '').trim();
    if (!query) {
      this.showToast?.('請輸入暱稱或識別碼');
      return;
    }
    const box = document.getElementById('pm-audit-users');
    if (box) box.innerHTML = '<div class="muted">搜尋中...</div>';
    try {
      const fn = this._pmCallable?.('searchPmAuditUsers');
      const resp = await fn({ query });
      const users = resp?.data?.users || [];
      if (!box) return;
      box.innerHTML = users.length ? users.map(u => {
        const uidLabel = this._formatUidForDisplay ? this._formatUidForDisplay(u.uid) : u.uid;
        const displayName = u.name || uidLabel || '未命名';
        const metaParts = [uidLabel, u.role || 'user'].filter(Boolean).map(part => escapeHTML(part));
        return `
        <button type="button" class="pm-audit-user" data-uid="${escapeHTML(u.uid)}">
          ${u.pictureUrl ? `<img src="${escapeHTML(u.pictureUrl)}" alt="">` : '<span></span>'}
          <strong data-no-translate>${escapeHTML(displayName)}</strong>
          <small data-no-translate>${metaParts.join(' · ')}</small>
        </button>`;
      }).join('') : '<div class="muted">沒有找到用戶</div>';
      box.querySelectorAll('.pm-audit-user').forEach(btn => {
        btn.addEventListener('click', () => this.loadPmAuditThreads(btn.dataset.uid || ''));
      });
    } catch (err) {
      console.warn('[searchPmAuditUsers]', err);
      if (box) box.innerHTML = '<div class="muted">搜尋失敗</div>';
    }
  },

  async loadPmAuditThreads(uid) {
    this._pmAuditSelectedUid = uid;
    const box = document.getElementById('pm-audit-threads');
    const convo = document.getElementById('pm-audit-conversation');
    if (box) box.innerHTML = '<div class="muted">載入中...</div>';
    if (convo) convo.innerHTML = '<div class="muted">尚未選擇對話</div>';
    try {
      const fn = this._pmCallable?.('listPmAuditThreads');
      const resp = await fn({ uid });
      const threads = resp?.data?.threads || [];
      if (!box) return;
      box.innerHTML = threads.length ? threads.map(t => {
        const names = t.participantNames || {};
        const title = (t.participants || []).map(id => names[id] || id).join(' / ');
        return `
          <button type="button" class="pm-audit-thread" data-cid="${escapeHTML(t.conversationId || t.id)}">
            <strong data-no-translate>${escapeHTML(title || t.id)}</strong>
            <span>${escapeHTML(t.lastMessageBody || '')}</span>
            <small>${escapeHTML(this._pmFormatTime?.(t.lastMessageAt) || '')}</small>
          </button>`;
      }).join('') : '<div class="muted">此用戶沒有私訊稽核對話</div>';
      box.querySelectorAll('.pm-audit-thread').forEach(btn => {
        btn.addEventListener('click', () => this.loadPmAuditConversation(btn.dataset.cid || ''));
      });
    } catch (err) {
      console.warn('[loadPmAuditThreads]', err);
      if (box) box.innerHTML = '<div class="muted">載入對話列表失敗</div>';
    }
  },

  async loadPmAuditConversation(conversationId) {
    this._pmAuditSelectedConversationId = conversationId;
    const box = document.getElementById('pm-audit-conversation');
    if (box) box.innerHTML = '<div class="muted">載入中...</div>';
    try {
      const fn = this._pmCallable?.('getPmAuditConversation');
      const resp = await fn({ conversationId, limit: 100 });
      const messages = resp?.data?.messages || [];
      if (!box) return;
      box.innerHTML = messages.length ? messages.map(m => `
        <article class="pm-audit-message">
          <div><strong data-no-translate>${escapeHTML(m.senderName || m.fromUid)}</strong><small>${escapeHTML(this._pmFormatTime?.(m.createdAt) || '')}</small></div>
          <p>${escapeHTML(m.status === 'recalled' ? '訊息已撤回' : (m.body || ''))}</p>
        </article>`).join('') : '<div class="muted">沒有訊息</div>';
      this.loadPmAuditLogs('audit_view_conversation');
    } catch (err) {
      console.warn('[loadPmAuditConversation]', err);
      if (box) box.innerHTML = '<div class="muted">載入對話內容失敗</div>';
    }
  },

  async _legacyLoadPmAuditLogs(forceAction) {
    const box = document.getElementById('pm-audit-logs');
    if (!box) return;
    box.innerHTML = '<div class="muted">載入中...</div>';
    try {
      const action = forceAction || String(document.getElementById('pm-audit-action')?.value || '');
      const fn = this._pmCallable?.('getPmAuditLogs');
      const resp = await fn({ action, limit: 30 });
      const logs = resp?.data?.logs || [];
      if (logs.length) {
        box.innerHTML = logs.map(log => {
          const actor = this._pmAuditShortUid(log.actorUid);
          const target = this._pmAuditShortUid(log.targetUid);
          const route = target && target !== '-' ? `${actor} -> ${target}` : actor;
          const fullRoute = [log.actorUid, log.targetUid].filter(Boolean).join(' -> ');
          return `
        <div class="pm-audit-log" title="${escapeHTML(fullRoute)}">
          <strong>${escapeHTML(this._pmAuditActionLabel(log.action))}</strong>
          <span data-no-translate>${escapeHTML(route)}</span>
          <small>${escapeHTML(this._pmAuditShortTime(log.createdAtIso) || this._pmFormatTime?.(log.createdAt) || '')}</small>
        </div>`;
        }).join('');
        return;
      }
      box.innerHTML = logs.length ? logs.map(log => `
        <div class="pm-audit-log">
          <strong>${escapeHTML(log.action || '')}</strong>
          <span data-no-translate>${escapeHTML(log.actorUid || '')} → ${escapeHTML(log.targetUid || '')}</span>
          <small>${escapeHTML(log.createdAtIso || this._pmFormatTime?.(log.createdAt) || '')}</small>
        </div>`).join('') : '<div class="muted">目前沒有 log</div>';
    } catch (err) {
      console.warn('[loadPmAuditLogs]', err);
      box.innerHTML = '<div class="muted">載入 log 失敗</div>';
    }
  },
  async loadPmAuditLogs(forceAction) {
    const box = document.getElementById('pm-audit-logs');
    if (!box) return;
    const select = document.getElementById('pm-audit-action');
    const action = forceAction || String(select?.value || '');
    if (forceAction && select && Array.from(select.options || []).some(opt => opt.value === forceAction)) {
      select.value = forceAction;
    }
    this._pmAuditLogAction = action;
    this._pmAuditLogItems = [];
    this._pmAuditLogNextCursor = null;
    await this._fetchPmAuditLogsPage({ append: false });
  },

  async loadMorePmAuditLogs() {
    if (!this._pmAuditLogNextCursor || this._pmAuditLogLoading) return;
    await this._fetchPmAuditLogsPage({ append: true });
  },

  async _fetchPmAuditLogsPage({ append = false } = {}) {
    const box = document.getElementById('pm-audit-logs');
    if (!box || this._pmAuditLogLoading) return;
    this._pmAuditLogLoading = true;
    if (append) {
      this._renderPmAuditLogList(this._pmAuditLogItems, { hasMore: !!this._pmAuditLogNextCursor, loading: true });
    } else {
      box.innerHTML = '<div class="muted">\u8f09\u5165\u4e2d...</div>';
    }
    try {
      const fn = this._pmCallable?.('getPmAuditLogs');
      const payload = { action: this._pmAuditLogAction || '', limit: 50 };
      if (append && this._pmAuditLogNextCursor?.createdAtMs) {
        payload.cursorCreatedAtMs = Number(this._pmAuditLogNextCursor.createdAtMs);
      }
      const resp = await fn(payload);
      const logs = resp?.data?.logs || [];
      this._pmAuditLogItems = append ? this._pmAuditLogItems.concat(logs) : logs;
      this._pmAuditLogNextCursor = resp?.data?.nextCursor || null;
      this._renderPmAuditLogList(this._pmAuditLogItems, {
        hasMore: resp?.data?.hasMore === true && !!this._pmAuditLogNextCursor,
      });
    } catch (err) {
      console.warn('[loadPmAuditLogs]', err);
      if (append) {
        this._renderPmAuditLogList(this._pmAuditLogItems, { hasMore: !!this._pmAuditLogNextCursor });
      } else {
        box.innerHTML = '<div class="muted">頛 log 憭望?</div>';
      }
    } finally {
      this._pmAuditLogLoading = false;
    }
  },
});
