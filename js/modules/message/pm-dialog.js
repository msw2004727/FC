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
  _pmDialogViewportCleanup: null,
  _pmDialogViewportFrame: 0,
  _pmDialogKeyboardRestoreTimer: 0,
  _pmDialogPageScrollY: 0,

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
    this._currentPmDialog = { targetUid, conversationId: cId, peerName: peer.name || targetUid };
    this._pmDialogSearchKeyword = '';
    this._pmDialogSearchExpanded = false;
    overlay.querySelector('.pm-dialog-peer-name').textContent = peer.name || targetUid;
    overlay.querySelector('.pm-dialog-peer-sub').textContent = this._formatUidForDisplay ? this._formatUidForDisplay(targetUid) : targetUid;
    const avatar = overlay.querySelector('.pm-dialog-avatar');
    if (avatar) {
      avatar.dataset.peerUid = targetUid;
      avatar.dataset.peerName = peer.name || targetUid;
    }
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
    this._installPmDialogViewportGuard?.(overlay);
    const initialMessages = await this._loadPmMessages(cId, 50);
    this._renderPmDialogMessages(this._getPmDialogRenderMessages(cId, initialMessages));
    this._startPmConversationListener(cId);
  },

  _ensurePmDialog() {
    let overlay = document.getElementById('pm-dialog-overlay');
    if (overlay) return overlay;
    const maxLength = Number(this.PM_MAX_BODY_LENGTH || 300);
    overlay = document.createElement('div');
    overlay.id = 'pm-dialog-overlay';
    overlay.className = 'pm-dialog-overlay';
    overlay.innerHTML = `
      <section class="pm-dialog" role="dialog" aria-modal="true" aria-label="私訊對話">
        <header class="pm-dialog-header">
          <button type="button" class="pm-dialog-avatar" aria-label="Open user profile"></button>
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
          <textarea class="pm-dialog-input" maxlength="${maxLength}" rows="2" placeholder=""></textarea>
          <button type="submit" class="pm-dialog-send">送出</button>
        </form>
      </section>`;
    const input = overlay.querySelector('.pm-dialog-input');
    if (input) {
      input.maxLength = maxLength;
      input.placeholder = `\u8f38\u5165\u8a0a\u606f\uff0c\u6700\u591a ${maxLength} \u5b57`;
    }
    overlay.addEventListener('click', e => {
      if (e.target === overlay) this._closePmDialog();
    });
    overlay.querySelector('.pm-dialog-avatar')?.addEventListener('click', e => {
      this._openPmDialogPeerProfile(e);
    });
    overlay.querySelector('.pm-dialog-compose').addEventListener('submit', e => {
      e.preventDefault();
      this.sendPmMessage?.();
    });
    document.body.appendChild(overlay);
    return overlay;
  },

  _isPmDialogTextControl(el) {
    if (!el || !el.closest?.('#pm-dialog-overlay')) return false;
    if (el.matches?.('.pm-dialog-input, .pm-dialog-search')) return true;
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(String(el.tagName || '').toUpperCase());
  },

  _isIOSPmViewport() {
    const nav = window.navigator || {};
    const platform = String(nav.platform || '');
    const ua = String(nav.userAgent || '');
    if (/iP(ad|hone|od)/i.test(platform) || /iP(ad|hone|od)/i.test(ua)) return true;
    return platform === 'MacIntel' && Number(nav.maxTouchPoints || 0) > 1;
  },

  _getPmDialogUsableViewportHeight({ layoutHeight, viewportHeight, viewportTop, keyboardOpen }) {
    const minHeight = Number(this.PM_KEYBOARD_MIN_VIEWPORT_HEIGHT || 320);
    const safeLayoutHeight = Math.max(0, Number(layoutHeight || 0));
    const safeViewportHeight = Math.max(minHeight, Number(viewportHeight || minHeight));
    const safeViewportTop = Math.max(0, Number(viewportTop || 0));
    const maxUsableHeight = safeLayoutHeight
      ? Math.max(minHeight, safeLayoutHeight - safeViewportTop)
      : safeViewportHeight;
    if (!keyboardOpen || !this._isIOSPmViewport?.()) {
      return { height: Math.min(safeViewportHeight, maxUsableHeight), reclaimed: 0 };
    }

    const accessoryMax = Math.max(0, Number(this.PM_KEYBOARD_ACCESSORY_GAP_PX || 0));
    const keyboardReserve = Math.max(0, Number(this.PM_KEYBOARD_MIN_KEYBOARD_RESERVE_PX || 260));
    const keyboardDelta = Math.max(0, safeLayoutHeight - safeViewportHeight - safeViewportTop);
    const reclaimed = Math.min(accessoryMax, Math.max(0, keyboardDelta - keyboardReserve));
    const height = Math.min(safeViewportHeight + reclaimed, maxUsableHeight);
    return {
      height,
      reclaimed: Math.max(0, height - safeViewportHeight),
    };
  },

  _installPmDialogViewportGuard(overlay) {
    if (!overlay) return;
    if (typeof this._pmDialogViewportCleanup === 'function') {
      try { this._pmDialogViewportCleanup(); } catch (_) {}
    }
    const vv = window.visualViewport || null;
    const root = document.documentElement;
    const minHeight = Number(this.PM_KEYBOARD_MIN_VIEWPORT_HEIGHT || 320);
    const restoreDelay = Number(this.PM_KEYBOARD_RESTORE_DELAY_MS || 320);
    this._pmDialogPageScrollY = window.scrollY || root.scrollTop || 0;
    let disposed = false;

    const update = () => {
      if (disposed || overlay.style.display === 'none') return;
      const layoutHeight = window.innerHeight || root.clientHeight || 0;
      const viewportHeight = Math.max(minHeight, Math.floor(vv?.height || layoutHeight || minHeight));
      const viewportTop = Math.max(0, Math.floor(vv?.offsetTop || 0));
      const focused = this._isPmDialogTextControl?.(document.activeElement);
      const resizedForKeyboard = !!vv && layoutHeight > 0 && (layoutHeight - viewportHeight) > 80;
      const keyboardOpen = !!focused && (resizedForKeyboard || window.innerWidth <= 560);
      const usable = this._getPmDialogUsableViewportHeight?.({
        layoutHeight,
        viewportHeight,
        viewportTop,
        keyboardOpen,
      }) || { height: viewportHeight, reclaimed: 0 };
      overlay.style.setProperty('--pm-vv-height', `${Math.floor(usable.height)}px`);
      overlay.style.setProperty('--pm-vv-raw-height', `${viewportHeight}px`);
      overlay.style.setProperty('--pm-keyboard-reclaim', `${Math.floor(usable.reclaimed || 0)}px`);
      overlay.style.setProperty('--pm-vv-top', `${viewportTop}px`);
      overlay.classList.toggle('is-keyboard-open', keyboardOpen);
      if (keyboardOpen) this._scrollPmDialogToBottomSoon?.();
    };

    const schedule = () => {
      if (disposed) return;
      if (this._pmDialogViewportFrame) cancelAnimationFrame(this._pmDialogViewportFrame);
      this._pmDialogViewportFrame = requestAnimationFrame(update);
    };

    const restore = () => {
      if (disposed) return;
      clearTimeout(this._pmDialogKeyboardRestoreTimer);
      this._pmDialogKeyboardRestoreTimer = setTimeout(() => {
        schedule();
        if (!this._isPmDialogTextControl?.(document.activeElement)) {
          overlay.classList.remove('is-keyboard-open');
          try { window.scrollTo(0, this._pmDialogPageScrollY || 0); } catch (_) {}
        }
      }, restoreDelay);
    };

    const onFocusIn = event => {
      if (this._isPmDialogTextControl?.(event.target)) {
        overlay.classList.add('is-keyboard-open');
        schedule();
      }
    };
    const onFocusOut = event => {
      if (this._isPmDialogTextControl?.(event.target)) restore();
    };

    overlay.addEventListener('focusin', onFocusIn);
    overlay.addEventListener('focusout', onFocusOut);
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', restore);
    vv?.addEventListener?.('resize', schedule);
    vv?.addEventListener?.('scroll', schedule);
    schedule();

    this._pmDialogViewportCleanup = () => {
      disposed = true;
      if (this._pmDialogViewportFrame) cancelAnimationFrame(this._pmDialogViewportFrame);
      clearTimeout(this._pmDialogKeyboardRestoreTimer);
      overlay.removeEventListener('focusin', onFocusIn);
      overlay.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', restore);
      vv?.removeEventListener?.('resize', schedule);
      vv?.removeEventListener?.('scroll', schedule);
      overlay.classList.remove('is-keyboard-open');
      overlay.style.removeProperty('--pm-vv-height');
      overlay.style.removeProperty('--pm-vv-raw-height');
      overlay.style.removeProperty('--pm-keyboard-reclaim');
      overlay.style.removeProperty('--pm-vv-top');
      this._pmDialogViewportFrame = 0;
      this._pmDialogViewportCleanup = null;
    };
  },

  _scrollPmDialogToBottomSoon() {
    const list = document.querySelector('#pm-dialog-overlay .pm-dialog-messages');
    if (!list) return;
    requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
    });
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
        const rawMessages = snapshot.docs.map(doc => ({ id: doc.id, _docId: doc.id, ...doc.data() }));
        const shouldMarkRead = rawMessages.some(m => m.direction === 'in' && m.read === false);
        const messages = this._pmOptimisticReadThreads?.[conversationId]
          ? rawMessages.map(message => (
              message?.direction === 'in' && message.read === false
                ? { ...message, read: true }
                : message
            ))
          : rawMessages;
        this._pmDialogMessages = messages;
        this._renderPmDialogMessages(this._getPmDialogRenderMessages(conversationId, messages));
        if (shouldMarkRead) {
          this._schedulePmMarkRead(conversationId);
        }
      }, err => {
        console.warn('[_startPmConversationListener]', err);
      });
  },

  _schedulePmMarkRead(conversationId) {
    this._optimisticallyMarkPmConversationRead?.(conversationId);
    clearTimeout(this._pmReadTimers[conversationId]);
    this._pmReadTimers[conversationId] = setTimeout(async () => {
      try {
        const fn = this._pmCallable?.('markPrivateConversationRead');
        if (fn) await fn({ conversationId });
        setTimeout(() => this._clearPmOptimisticReadThread?.(conversationId), 3000);
      } catch (err) {
        this._clearPmOptimisticReadThread?.(conversationId, true);
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

  _pmNormalizeExternalHttpsUrl(value) {
    try {
      const raw = String(value || '').trim();
      if (!raw || !/^https:\/\//i.test(raw)) return '';
      const url = new URL(raw);
      return url.protocol === 'https:' ? url.href : '';
    } catch (_) {
      return '';
    }
  },

  _pmSplitUrlTrailingPunctuation(value) {
    let urlText = String(value || '');
    let suffix = '';
    while (urlText && /[.,!?;:\u3001\u3002\uff0c\uff01\uff1f\uff1b\uff1a)\]\}]/.test(urlText.slice(-1))) {
      suffix = urlText.slice(-1) + suffix;
      urlText = urlText.slice(0, -1);
    }
    return { urlText, suffix };
  },

  _pmRenderMessageBodyHtml(body) {
    const text = String(body || '');
    const urlPattern = /https:\/\/[^\s<>"'`]+/gi;
    let html = '';
    let lastIndex = 0;
    let hasExternalLink = false;

    for (const match of text.matchAll(urlPattern)) {
      const rawUrl = match[0] || '';
      const offset = Number(match.index || 0);
      const { urlText, suffix } = this._pmSplitUrlTrailingPunctuation(rawUrl);
      const href = this._pmNormalizeExternalHttpsUrl(urlText);
      if (!href) continue;

      html += escapeHTML(text.slice(lastIndex, offset));
      html += `<a class="pm-message-link" href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer nofollow ugc" data-no-translate>${escapeHTML(urlText)}</a>`;
      html += escapeHTML(suffix);
      lastIndex = offset + rawUrl.length;
      hasExternalLink = true;
    }

    html += escapeHTML(text.slice(lastIndex));
    return { html, hasExternalLink };
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
    const renderedBody = this._pmRenderMessageBodyHtml(body);
    const safetyNotice = !recalled && renderedBody.hasExternalLink
      ? '<div class="pm-message-link-safety" role="note">\u5b89\u5168\u63d0\u9192\uff1a\u6b64\u9023\u7d50\u7531\u7528\u6236\u63d0\u4f9b\uff0c\u958b\u555f\u524d\u8acb\u78ba\u8a8d\u7db2\u5740\u8207\u5c0d\u65b9\u8eab\u5206\u3002ToosterX \u4e0d\u6703\u900f\u904e\u79c1\u8a0a\u8981\u6c42\u4f60\u63d0\u4f9b\u5bc6\u78bc\u3001\u9a57\u8b49\u78bc\u6216\u4ed8\u6b3e\u8cc7\u8a0a\u3002</div>'
      : '';
    const peerRead = own && message.peerRead === true;
    const hasPendingAction = editing || recalling;
    const canEdit = own && !message._optimistic && !recalled && !hasPendingAction && !peerRead;
    const canRecall = own && !message._optimistic && !recalled && !hasPendingAction && !peerRead;
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
        <div class="pm-message-bubble">${renderedBody.html}</div>
        ${safetyNotice}
        <div class="pm-message-meta">${escapeHTML(meta)}${actions}</div>
      </article>`;
  },

  async _openPmDialogPeerProfile(event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const avatar = event?.currentTarget || document.querySelector('#pm-dialog-overlay .pm-dialog-avatar');
    const targetUid = String(avatar?.dataset?.peerUid || this._currentPmDialog?.targetUid || '').trim();
    if (!targetUid) return;
    const peerName = String(
      avatar?.dataset?.peerName ||
      this._currentPmDialog?.peerName ||
      document.querySelector('#pm-dialog-overlay .pm-dialog-peer-name')?.textContent ||
      targetUid
    ).trim();
    this._closePmDialog();
    await this.showUserProfile?.(peerName || targetUid, { uid: targetUid });
  },

  _closePmDialog() {
    if (typeof this._pmDialogUnsub === 'function') {
      try { this._pmDialogUnsub(); } catch (_) {}
    }
    this._pmDialogUnsub = null;
    this._currentPmDialog = null;
    const overlay = document.getElementById('pm-dialog-overlay');
    if (overlay) overlay.style.display = 'none';
    if (typeof this._pmDialogViewportCleanup === 'function') {
      try { this._pmDialogViewportCleanup(); } catch (_) {}
    }
    document.body.classList.remove('pm-dialog-open');
    requestAnimationFrame(() => {
      try { window.scrollTo(0, this._pmDialogPageScrollY || window.scrollY || 0); } catch (_) {}
    });
  },
});
