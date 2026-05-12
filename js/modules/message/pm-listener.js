/* ================================================
   ToosterX - Private Message realtime thread list
   ================================================ */

Object.assign(App, {
  _pmThreadsUnsub: null,
  _pmListeningUid: '',
  _pmThreadsReady: false,
  _pmIncomingBubbleTimer: null,
  _pmStartRetryTimer: null,
  PM_INCOMING_BUBBLE_WINDOW_MS: 30 * 60 * 1000,

  startPmThreadListener() {
    if (typeof auth === 'undefined' || !auth?.onAuthStateChanged || typeof db === 'undefined' || !db?.collection) {
      this._schedulePmThreadListenerStart?.();
      return;
    }
    if (this._pmAuthListenerStarted) return;
    this._pmAuthListenerStarted = true;
    clearTimeout(this._pmStartRetryTimer);
    this._pmStartRetryTimer = null;
    auth.onAuthStateChanged(user => this._handlePmAuthUser?.(user));
    if (auth.currentUser) this._handlePmAuthUser?.(auth.currentUser);
  },

  _schedulePmThreadListenerStart() {
    if (this._pmAuthListenerStarted || this._pmStartRetryTimer) return;
    this._pmStartRetryTimer = setTimeout(() => {
      this._pmStartRetryTimer = null;
      this.startPmThreadListener?.();
    }, 500);
  },

  _handlePmAuthUser(user) {
    const uid = user?.uid || '';
    if (!uid) {
      this._stopPmThreadListener();
      this._pmListeningUid = '';
      this._pmThreadsReady = false;
      this._hidePmIncomingBubble?.();
      if (typeof FirebaseService !== 'undefined') FirebaseService._cache.pmThreads = [];
      this._closePmDialog?.();
      this.updateNotifBadge?.();
      return;
    }
    if (this._pmListeningUid === uid && this._pmThreadsUnsub) return;
    this._stopPmThreadListener();
    this._pmListeningUid = uid;
    this._pmThreadsReady = false;
    this._pmThreadsUnsub = db.collection('users').doc(uid).collection('pmThreads')
      .orderBy('lastMessageAt', 'desc')
      .limit(50)
      .onSnapshot(snapshot => {
        if (typeof FirebaseService === 'undefined') return;
        const previousThreads = FirebaseService._cache?.pmThreads || [];
        const nextThreads = snapshot.docs.map(doc => ({ id: doc.id, _docId: doc.id, ...doc.data() }));
        const increasedThread = this._pmThreadsReady
          ? this._findPmUnreadIncrease(previousThreads, nextThreads)
          : this._findPmInitialUnread(nextThreads);
        FirebaseService._cache.pmThreads = nextThreads;
        this._pmThreadsReady = true;
        this.updateNotifBadge?.();
        if (this.currentPage === 'page-messages' && this._msgInboxFilter === 'pm-conversation') {
          this.renderPmThreadList?.();
        }
        if (increasedThread) this._queuePmIncomingBubble?.(increasedThread);
      }, err => {
        console.warn('[startPmThreadListener]', err);
      });
  },

  _stopPmThreadListener() {
    if (typeof this._pmThreadsUnsub === 'function') {
      try { this._pmThreadsUnsub(); } catch (_) {}
    }
    this._pmThreadsUnsub = null;
    this._pmThreadsReady = false;
  },

  _pmUnreadTotal() {
    const threads = (typeof FirebaseService !== 'undefined' && FirebaseService._cache?.pmThreads) || [];
    return threads.reduce((sum, t) => sum + Math.max(0, Number(t.unreadCount || 0)), 0);
  },

  _findPmUnreadIncrease(previousThreads = [], nextThreads = []) {
    if (this.currentPage === 'page-messages' && this._msgInboxFilter === 'pm-conversation') return null;
    const previousMap = new Map(previousThreads.map(t => [
      String(t.conversationId || t.id || t._docId || ''),
      Math.max(0, Number(t.unreadCount || 0)),
    ]));
    return nextThreads.find(t => {
      const cId = String(t.conversationId || t.id || t._docId || '');
      const unread = Math.max(0, Number(t.unreadCount || 0));
      if (!cId || unread <= 0 || unread <= (previousMap.get(cId) || 0)) return false;
      return !this._isPmDialogOpenForConversation(cId);
    }) || null;
  },

  _findPmInitialUnread(threads = []) {
    if (this.currentPage === 'page-messages' && this._msgInboxFilter === 'pm-conversation') return null;
    const now = Date.now();
    return threads
      .filter(t => {
        const cId = String(t.conversationId || t.id || t._docId || '');
        const unread = Math.max(0, Number(t.unreadCount || 0));
        if (!cId || unread <= 0 || this._isPmDialogOpenForConversation(cId)) return false;
        const lastMs = this._pmTimeMs(t.lastMessageAt);
        return !lastMs || (now - lastMs) <= this.PM_INCOMING_BUBBLE_WINDOW_MS;
      })
      .sort((a, b) => this._pmTimeMs(b.lastMessageAt) - this._pmTimeMs(a.lastMessageAt))[0] || null;
  },

  _resolvePmThreadPeerUid(thread) {
    const direct = String(thread?.peerUid || '').trim();
    if (this.isValidLineUid?.(direct)) return direct;
    const myUid = this._pmCurrentUid?.() || '';
    const participants = Array.isArray(thread?.participants) ? thread.participants : [];
    const fromParticipants = participants.map(uid => String(uid || '').trim())
      .find(uid => uid && uid !== myUid && this.isValidLineUid?.(uid));
    if (fromParticipants) return fromParticipants;
    const cId = String(thread?.conversationId || thread?.id || thread?._docId || '').trim();
    const parsed = this._pmParseConversationId?.(cId);
    if (!parsed || !myUid) return direct;
    return parsed.uidA === myUid ? parsed.uidB : parsed.uidA;
  },

  _queuePmIncomingBubble(thread) {
    setTimeout(() => {
      const cId = String(thread?.conversationId || thread?.id || thread?._docId || '').trim();
      if (this.currentPage === 'page-messages' && this._msgInboxFilter === 'pm-conversation') return;
      if (this._isPmDialogOpenForConversation(cId)) return;
      this._showPmIncomingBubble?.(thread);
    }, 350);
  },

  _isPmDialogOpenForConversation(conversationId) {
    const overlay = document.getElementById('pm-dialog-overlay');
    return !!(
      overlay
      && overlay.style.display !== 'none'
      && this._currentPmDialog?.conversationId === conversationId
    );
  },

  _showPmIncomingBubble(thread) {
    const peerUid = this._resolvePmThreadPeerUid?.(thread) || '';
    const cId = String(thread?.conversationId || thread?.id || thread?._docId || '').trim();
    if (!peerUid || !cId) return;
    let bubble = document.getElementById('pm-incoming-bubble');
    if (!bubble) {
      bubble = document.createElement('button');
      bubble.id = 'pm-incoming-bubble';
      bubble.type = 'button';
      bubble.className = 'pm-incoming-bubble';
      document.body.appendChild(bubble);
    }
    const statusText = thread.lastMessageStatus === 'recalled'
      ? '\u8a0a\u606f\u5df2\u64a4\u56de'
      : (thread.lastMessageBody || '\u4f60\u6709\u65b0\u79c1\u8a0a');
    const avatar = thread.peerAvatar
      ? `<img src="${escapeHTML(thread.peerAvatar)}" alt="">`
      : `<span>${escapeHTML(String(thread.peerName || '?').slice(0, 1))}</span>`;
    bubble.dataset.peerUid = peerUid;
    bubble.dataset.conversationId = cId;
    bubble.innerHTML = `
      <span class="pm-incoming-avatar">${avatar}</span>
      <span class="pm-incoming-main">
        <strong data-no-translate>${escapeHTML(thread.peerName || peerUid)}</strong>
        <span>${escapeHTML(statusText)}</span>
      </span>
      <span class="pm-incoming-label">\u79c1\u8a0a</span>`;
    bubble.onclick = () => {
      this._hidePmIncomingBubble?.();
      this.openPmDialog?.(peerUid, { conversationId: cId });
    };
    bubble.classList.add('is-visible');
    clearTimeout(this._pmIncomingBubbleTimer);
    this._pmIncomingBubbleTimer = setTimeout(() => this._hidePmIncomingBubble?.(), 6500);
  },

  _hidePmIncomingBubble() {
    clearTimeout(this._pmIncomingBubbleTimer);
    const bubble = document.getElementById('pm-incoming-bubble');
    if (bubble) bubble.classList.remove('is-visible');
  },

  _togglePmConversationUI(enabled) {
    const toolbarRow = document.getElementById('msg-toolbar-row');
    const filterRow = document.getElementById('msg-filter-row');
    const storageBar = document.getElementById('storage-bar');
    if (toolbarRow) toolbarRow.style.display = enabled ? 'none' : 'flex';
    if (filterRow) filterRow.style.display = enabled ? 'none' : 'flex';
    if (storageBar) storageBar.style.display = enabled ? 'none' : '';
  },

  renderPmThreadList() {
    this.startPmThreadListener?.();
    if (typeof auth !== 'undefined' && auth?.currentUser && !this._pmThreadsUnsub) {
      this._handlePmAuthUser?.(auth.currentUser);
    }
    const container = document.getElementById('message-list');
    if (!container) return;
    container.classList.add('pm-thread-list');
    container.setAttribute('role', 'list');
    const threads = ((typeof FirebaseService !== 'undefined' && FirebaseService._cache?.pmThreads) || [])
      .slice()
      .sort((a, b) => this._pmTimeMs(b.lastMessageAt) - this._pmTimeMs(a.lastMessageAt));
    if (!threads.length) {
      container.innerHTML = '<div class="pm-empty">\u76ee\u524d\u6c92\u6709\u79c1\u8a0a\u5c0d\u8a71</div>';
      return;
    }
    container.innerHTML = threads.map(t => {
      const conversationId = String(t.conversationId || t.id || t._docId || '');
      const peerUid = this._resolvePmThreadPeerUid?.(t) || '';
      const unread = Math.max(0, Number(t.unreadCount || 0));
      const avatar = t.peerAvatar
        ? `<img src="${escapeHTML(t.peerAvatar)}" alt="" class="pm-thread-avatar-img">`
        : `<span>${escapeHTML(String(t.peerName || '?').slice(0, 1))}</span>`;
      const statusText = t.lastMessageStatus === 'recalled' ? '\u8a0a\u606f\u5df2\u64a4\u56de' : (t.lastMessageBody || '');
      return `
        <button type="button" role="listitem" class="pm-thread-card${unread ? ' is-unread' : ''}" data-user-card="pm-thread" data-peer-uid="${escapeHTML(peerUid)}" data-conversation-id="${escapeHTML(conversationId)}" aria-label="\u958b\u555f\u79c1\u8a0a\u5c0d\u8a71">
          <span class="pm-thread-avatar">${avatar}</span>
          <span class="pm-thread-main">
            <span class="pm-thread-top">
              <span class="pm-thread-name" data-no-translate>${escapeHTML(t.peerName || t.peerUid || '\u672a\u77e5\u7528\u6236')}</span>
              <span class="pm-thread-time">${escapeHTML(this._pmFormatTime?.(t.lastMessageAt) || '')}</span>
            </span>
            <span class="pm-thread-preview">${escapeHTML(statusText)}</span>
          </span>
          ${unread ? `<span class="pm-thread-badge">${unread > 99 ? '99+' : unread}</span>` : ''}
        </button>`;
    }).join('');
    container.querySelectorAll('.pm-thread-card').forEach(card => {
      card.addEventListener('click', () => {
        const peerUid = card.dataset.peerUid || '';
        const conversationId = card.dataset.conversationId || '';
        this.openPmDialog?.(peerUid, { conversationId });
      });
    });
  },

  _pmTimeMs(value) {
    if (typeof value?.toDate === 'function') return value.toDate().getTime();
    if (value?.seconds) return value.seconds * 1000;
    const ms = Date.parse(value || '');
    return Number.isFinite(ms) ? ms : 0;
  },
});

if (typeof App !== 'undefined') {
  App.startPmThreadListener?.();
}
