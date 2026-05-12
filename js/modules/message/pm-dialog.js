/* ================================================
   ToosterX — Private Message dialog
   ================================================ */

Object.assign(App, {
  _pmDialogUnsub: null,
  _pmDialogMessages: [],
  _pmOptimisticMessages: {},
  _pmPendingMessageUpdates: {},
  _pmOptimisticSeq: 0,
  _pmReadTimers: {},
  _currentPmDialog: null,

  async _openPmDialogImpl(targetUid, options = {}) {
    if (this._requireProtectedActionLogin?.({ type: 'pm_open', uid: targetUid }, { suppressToast: false })) return;
    const myUid = this._pmCurrentUid?.() || '';
    const cId = options.conversationId || this.pmBuildConversationId?.(myUid, targetUid);
    if (!this.pmIsValidConversationId?.(cId, myUid)) {
      this.showToast?.('無法開啟私訊');
      return;
    }
    const thread = ApiService.getPmThreadByConversationId?.(cId);
    const peer = ApiService.getUserByUid?.(targetUid) || {
      uid: targetUid,
      name: thread?.peerName || targetUid,
      pictureUrl: thread?.peerAvatar || '',
    };
    const overlay = this._ensurePmDialog();
    this._currentPmDialog = { targetUid, conversationId: cId };
    this._pmDialogSearchKeyword = '';
    this._pmDialogSearchExpanded = false;
    overlay.querySelector('.pm-dialog-peer-name').textContent = peer.name || targetUid;
    overlay.querySelector('.pm-dialog-peer-sub').textContent = targetUid;
    const avatar = overlay.querySelector('.pm-dialog-avatar');
    avatar.innerHTML = peer.pictureUrl
      ? `<img src="${escapeHTML(peer.pictureUrl)}" alt="">`
      : `<span>${escapeHTML(String(peer.name || '?').slice(0, 1))}</span>`;
    const searchHost = overlay.querySelector('.pm-dialog-title');
    const searchToggle = overlay.querySelector('.pm-dialog-search-toggle');
    const searchInput = overlay.querySelector('.pm-dialog-search');
    if (searchHost) searchHost.classList.remove('is-search-open');
    if (searchToggle) searchToggle.setAttribute('aria-expanded', 'false');
    if (searchToggle) searchToggle.classList.remove('is-active');
    if (searchInput) searchInput.value = '';
    overlay.querySelector('.pm-dialog-input').value = '';
    overlay.style.display = 'flex';
    document.body.classList.add('pm-dialog-open');
    const initialMessages = await this._loadPmMessages(cId, 50);
    this._renderPmDialogMessages(this._getPmDialogRenderMessages(cId, initialMessages));
    this._startPmConversationListener(cId);
  },

  _ensurePmDialog() {
    let overlay = document.getElementById('pm-dialog-overlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'pm-dialog-overlay';
    overlay.className = 'pm-dialog-overlay';
    overlay.innerHTML = `
      <section class="pm-dialog" role="dialog" aria-modal="true" aria-label="私訊對話">
        <header class="pm-dialog-header">
          <div class="pm-dialog-avatar"></div>
          <div class="pm-dialog-title">
            <strong class="pm-dialog-peer-name" data-no-translate></strong>
            <div class="pm-dialog-peer-line">
              <span class="pm-dialog-peer-sub" data-no-translate></span>
              <button type="button" class="pm-dialog-search-toggle" aria-label="搜尋對話" aria-expanded="false" onclick="App.togglePmDialogSearch()">
                <svg class="pm-dialog-search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M10.75 5.25a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z"></path>
                  <path d="m15 15 4 4"></path>
                </svg>
              </button>
              <input class="pm-dialog-search" type="search" placeholder="搜尋" oninput="App.filterPmDialogMessages(this.value)">
            </div>
          </div>
          <button type="button" class="pm-dialog-close" aria-label="關閉" onclick="App._closePmDialog()">×</button>
        </header>
        <div class="pm-dialog-messages"></div>
        <form class="pm-dialog-compose">
          <textarea class="pm-dialog-input" maxlength="1000" rows="2" placeholder="輸入訊息，最多 1000 字"></textarea>
          <button type="submit" class="pm-dialog-send">送出</button>
        </form>
      </section>`;
    overlay.addEventListener('click', e => {
      if (e.target === overlay) this._closePmDialog();
    });
    overlay.querySelector('.pm-dialog-compose').addEventListener('submit', e => {
      e.preventDefault();
      this.sendPmMessage?.();
    });
    document.body.appendChild(overlay);
    return overlay;
  },

  async _loadPmMessages(conversationId, limit = 50) {
    try {
      const messages = await ApiService.getPmMessages?.(conversationId, limit);
      this._pmDialogMessages = Array.isArray(messages) ? messages : [];
      return this._pmDialogMessages;
    } catch (err) {
      console.warn('[_loadPmMessages]', err);
      this.showToast?.('私訊載入失敗');
      this._pmDialogMessages = [];
      return [];
    }
  },

  _startPmConversationListener(conversationId) {
    if (typeof this._pmDialogUnsub === 'function') {
      try { this._pmDialogUnsub(); } catch (_) {}
    }
    const uid = this._pmCurrentUid?.() || '';
    if (!this.pmIsValidConversationId?.(conversationId, uid)) return;
    this._pmDialogUnsub = db.collection('users').doc(uid).collection('pmThreads')
      .doc(conversationId).collection('messages')
      .orderBy('createdAt', 'asc')
      .limit(50)
      .onSnapshot(snapshot => {
        const messages = snapshot.docs.map(doc => ({ id: doc.id, _docId: doc.id, ...doc.data() }));
        this._pmDialogMessages = messages;
        this._renderPmDialogMessages(this._getPmDialogRenderMessages(conversationId, messages));
        if (messages.some(m => m.direction === 'in' && m.read === false)) {
          this._schedulePmMarkRead(conversationId);
        }
      }, err => {
        console.warn('[_startPmConversationListener]', err);
      });
  },

  _schedulePmMarkRead(conversationId) {
    clearTimeout(this._pmReadTimers[conversationId]);
    this._pmReadTimers[conversationId] = setTimeout(async () => {
      try {
        const fn = this._pmCallable?.('markPrivateConversationRead');
        if (fn) await fn({ conversationId });
      } catch (err) {
        console.warn('[_schedulePmMarkRead]', err);
      }
    }, this.PM_MARK_READ_DEBOUNCE_MS || 500);
  },

  _getPmDialogRenderMessages(conversationId, messages = []) {
    const cId = String(conversationId || '').trim();
    const serverMessages = this._applyPmPendingMessageUpdates(cId, Array.isArray(messages) ? messages : []);
    if (!cId) return serverMessages;
    this._reconcilePmOptimisticMessages(cId, serverMessages);
    const optimistic = this._pmOptimisticMessages[cId] || [];
    const all = serverMessages.concat(optimistic);
    return all.sort((a, b) => this._pmTimeMs(a.createdAt) - this._pmTimeMs(b.createdAt));
  },

  _applyPmPendingMessageUpdates(conversationId, messages = []) {
    const cId = String(conversationId || '').trim();
    const pendingMap = this._pmPendingMessageUpdates?.[cId] || null;
    if (!cId || !pendingMap || !Object.keys(pendingMap).length) return messages;
    const merged = messages.map(message => {
      const messageId = String(message?.messageId || message?.id || message?._docId || '').trim();
      const pending = messageId ? pendingMap[messageId] : null;
      if (!pending) return message;
      const expectedStatus = String(pending._expectedStatus || '').trim();
      const expectedBody = pending._expectedBody;
      const statusMatches = !expectedStatus || String(message.status || 'active') === expectedStatus;
      const bodyMatches = expectedBody == null || expectedStatus === 'recalled' || String(message.body || '') === String(expectedBody);
      if (statusMatches && bodyMatches) {
        delete pendingMap[messageId];
        return message;
      }
      return { ...message, ...pending };
    });
    if (!Object.keys(pendingMap).length) delete this._pmPendingMessageUpdates[cId];
    return merged;
  },

  _addPmOptimisticMessage(conversationId, targetUid, body) {
    const cId = String(conversationId || '').trim();
    const fromUid = this._pmCurrentUid?.() || '';
    if (!cId || !fromUid || !body) return '';
    const localId = `local_pm_${Date.now()}_${++this._pmOptimisticSeq}`;
    const currentUser = ApiService.getCurrentUser?.() || {};
    const now = new Date().toISOString();
    const localMessage = {
      id: localId,
      messageId: localId,
      _localId: localId,
      _optimistic: true,
      conversationId: cId,
      fromUid,
      toUid: targetUid,
      direction: 'out',
      read: true,
      peerRead: false,
      body,
      preview: body,
      status: 'sending',
      senderName: currentUser.displayName || currentUser.name || currentUser.lineDisplayName || '',
      createdAt: now,
      updatedAt: now,
    };
    if (!Array.isArray(this._pmOptimisticMessages[cId])) this._pmOptimisticMessages[cId] = [];
    this._pmOptimisticMessages[cId].push(localMessage);
    return localId;
  },

  _markPmOptimisticMessage(conversationId, localId, updates = {}) {
    const cId = String(conversationId || '').trim();
    const list = this._pmOptimisticMessages[cId] || [];
    const item = list.find(m => m._localId === localId || m.messageId === localId);
    if (!item) return;
    Object.assign(item, updates, { updatedAt: new Date().toISOString() });
  },

  _reconcilePmOptimisticMessages(conversationId, serverMessages = []) {
    const cId = String(conversationId || '').trim();
    const list = this._pmOptimisticMessages[cId] || [];
    if (!list.length) return;
    const myUid = this._pmCurrentUid?.() || '';
    const remaining = list.filter(local => {
      if (local._optimisticFailed) return true;
      const localMs = this._pmTimeMs(local.createdAt);
      return !serverMessages.some(server => {
        const serverId = String(server.messageId || server.id || server._docId || '');
        if (local._serverMessageId && serverId === local._serverMessageId) return true;
        const isOwnServer = server.fromUid === myUid || server.direction === 'out';
        if (!isOwnServer || String(server.body || '') !== String(local.body || '')) return false;
        const serverMs = this._pmTimeMs(server.createdAt);
        if (!serverMs || !localMs) return true;
        return Math.abs(serverMs - localMs) <= 2 * 60 * 1000;
      });
    });
    if (remaining.length) this._pmOptimisticMessages[cId] = remaining;
    else delete this._pmOptimisticMessages[cId];
  },

  _renderPmDialogMessages(messages) {
    const list = document.querySelector('#pm-dialog-overlay .pm-dialog-messages');
    if (!list) return;
    const keyword = String(this._pmDialogSearchKeyword || '').trim().toLowerCase();
    const myUid = this._pmCurrentUid?.() || '';
    const rows = (messages || []).filter(m => {
      if (!keyword) return true;
      return String(m.body || '').toLowerCase().includes(keyword)
        || String(m.senderName || '').toLowerCase().includes(keyword);
    });
    list.innerHTML = rows.length ? rows.map(m => this._buildPmMessageHtml(m, myUid)).join('')
      : '<div class="pm-empty pm-empty-dialog">沒有符合條件的訊息</div>';
    list.querySelectorAll('[data-pm-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.pmAction;
        const messageId = btn.dataset.messageId;
        if (action === 'edit') this.editPmMessage?.(messageId);
        if (action === 'recall') this.recallPmMessage?.(messageId);
      });
    });
    list.scrollTop = list.scrollHeight;
  },

  _buildPmMessageHtml(message, myUid) {
    const own = message.fromUid === myUid || message.direction === 'out';
    const status = message.status || 'active';
    const recalled = status === 'recalled';
    const pending = message._optimistic && status === 'sending';
    const editing = message._pmPendingAction === 'editing';
    const recalling = message._pmPendingAction === 'recalling';
    const failed = message._optimistic && status === 'failed';
    const body = recalled ? '訊息已撤回' : (message.body || '');
    const createdMs = this._pmTimeMs(message.createdAt);
    const age = Date.now() - createdMs;
    const hasPendingAction = editing || recalling;
    const canEdit = own && !message._optimistic && !recalled && !hasPendingAction && createdMs && age <= this.PM_EDIT_WINDOW_MS;
    const canRecall = own && !message._optimistic && !recalled && !hasPendingAction && createdMs && age <= this.PM_RECALL_WINDOW_MS;
    const meta = [
      this._pmFormatTime?.(message.createdAt) || '',
      pending ? '\u9001\u51fa\u4e2d' : '',
      editing ? '\u7de8\u8f2f\u4e2d' : '',
      recalling ? '\u64a4\u56de\u4e2d' : '',
      failed ? '\u9001\u51fa\u5931\u6557' : '',
      status === 'edited' ? '已編輯' : '',
      own && message.peerRead ? '已讀' : '',
    ].filter(Boolean).join(' · ');
    const actions = (canEdit || canRecall) ? `
      <span class="pm-message-actions">
        ${canEdit ? `<button type="button" data-pm-action="edit" data-message-id="${escapeHTML(message.messageId || message.id)}">編輯</button>` : ''}
        ${canRecall ? `<button type="button" data-pm-action="recall" data-message-id="${escapeHTML(message.messageId || message.id)}">撤回</button>` : ''}
      </span>` : '';
    return `
      <article class="pm-message${own ? ' is-own' : ' is-peer'}${recalled ? ' is-recalled' : ''}${pending || editing || recalling ? ' is-pending' : ''}${failed ? ' is-failed' : ''}">
        <div class="pm-message-bubble">${escapeHTML(body)}</div>
        <div class="pm-message-meta">${escapeHTML(meta)}${actions}</div>
      </article>`;
  },

  _closePmDialog() {
    if (typeof this._pmDialogUnsub === 'function') {
      try { this._pmDialogUnsub(); } catch (_) {}
    }
    this._pmDialogUnsub = null;
    this._currentPmDialog = null;
    const overlay = document.getElementById('pm-dialog-overlay');
    if (overlay) overlay.style.display = 'none';
    document.body.classList.remove('pm-dialog-open');
  },
});
