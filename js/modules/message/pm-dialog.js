/* ================================================
   ToosterX — Private Message dialog
   ================================================ */

Object.assign(App, {
  _pmDialogUnsub: null,
  _pmDialogMessages: [],
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
    overlay.querySelector('.pm-dialog-peer-name').textContent = peer.name || targetUid;
    overlay.querySelector('.pm-dialog-peer-sub').textContent = targetUid;
    const avatar = overlay.querySelector('.pm-dialog-avatar');
    avatar.innerHTML = peer.pictureUrl
      ? `<img src="${escapeHTML(peer.pictureUrl)}" alt="">`
      : `<span>${escapeHTML(String(peer.name || '?').slice(0, 1))}</span>`;
    overlay.querySelector('.pm-dialog-search').value = '';
    overlay.querySelector('.pm-dialog-input').value = '';
    overlay.style.display = 'flex';
    document.body.classList.add('pm-dialog-open');
    const initialMessages = await this._loadPmMessages(cId, 50);
    this._renderPmDialogMessages(initialMessages);
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
            <span class="pm-dialog-peer-sub" data-no-translate></span>
          </div>
          <button type="button" class="pm-dialog-close" aria-label="關閉" onclick="App._closePmDialog()">×</button>
        </header>
        <div class="pm-dialog-tools">
          <input class="pm-dialog-search" type="search" placeholder="搜尋本次對話" oninput="App.filterPmDialogMessages(this.value)">
        </div>
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
        this._renderPmDialogMessages(messages);
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
    const body = recalled ? '訊息已撤回' : (message.body || '');
    const createdMs = this._pmTimeMs(message.createdAt);
    const age = Date.now() - createdMs;
    const canEdit = own && !recalled && createdMs && age <= this.PM_EDIT_WINDOW_MS;
    const canRecall = own && !recalled && createdMs && age <= this.PM_RECALL_WINDOW_MS;
    const meta = [
      this._pmFormatTime?.(message.createdAt) || '',
      status === 'edited' ? '已編輯' : '',
      own && message.peerRead ? '已讀' : '',
    ].filter(Boolean).join(' · ');
    const actions = (canEdit || canRecall) ? `
      <span class="pm-message-actions">
        ${canEdit ? `<button type="button" data-pm-action="edit" data-message-id="${escapeHTML(message.messageId || message.id)}">編輯</button>` : ''}
        ${canRecall ? `<button type="button" data-pm-action="recall" data-message-id="${escapeHTML(message.messageId || message.id)}">撤回</button>` : ''}
      </span>` : '';
    return `
      <article class="pm-message${own ? ' is-own' : ' is-peer'}${recalled ? ' is-recalled' : ''}">
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
