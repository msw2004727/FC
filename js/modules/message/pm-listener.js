/* ================================================
   ToosterX — Private Message realtime thread list
   ================================================ */

Object.assign(App, {
  _pmThreadsUnsub: null,
  _pmListeningUid: '',

  startPmThreadListener() {
    if (typeof auth === 'undefined' || !auth?.onAuthStateChanged) return;
    if (this._pmAuthListenerStarted) return;
    this._pmAuthListenerStarted = true;
    auth.onAuthStateChanged(user => {
      const uid = user?.uid || '';
      if (!uid) {
        this._stopPmThreadListener();
        this._pmListeningUid = '';
        if (typeof FirebaseService !== 'undefined') FirebaseService._cache.pmThreads = [];
        this._closePmDialog?.();
        this.updateNotifBadge?.();
        return;
      }
      if (this._pmListeningUid === uid && this._pmThreadsUnsub) return;
      this._stopPmThreadListener();
      this._pmListeningUid = uid;
      this._pmThreadsUnsub = db.collection('users').doc(uid).collection('pmThreads')
        .orderBy('lastMessageAt', 'desc')
        .limit(50)
        .onSnapshot(snapshot => {
          if (typeof FirebaseService === 'undefined') return;
          FirebaseService._cache.pmThreads = snapshot.docs.map(doc => ({ id: doc.id, _docId: doc.id, ...doc.data() }));
          this.updateNotifBadge?.();
          if (this.currentPage === 'page-messages' && this._msgInboxFilter === 'pm-conversation') {
            this.renderPmThreadList?.();
          }
        }, err => {
          console.warn('[startPmThreadListener]', err);
        });
    });
  },

  _stopPmThreadListener() {
    if (typeof this._pmThreadsUnsub === 'function') {
      try { this._pmThreadsUnsub(); } catch (_) {}
    }
    this._pmThreadsUnsub = null;
  },

  _pmUnreadTotal() {
    const threads = (typeof FirebaseService !== 'undefined' && FirebaseService._cache?.pmThreads) || [];
    return threads.reduce((sum, t) => sum + Math.max(0, Number(t.unreadCount || 0)), 0);
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
    const container = document.getElementById('message-list');
    if (!container) return;
    const threads = ((typeof FirebaseService !== 'undefined' && FirebaseService._cache?.pmThreads) || [])
      .slice()
      .sort((a, b) => this._pmTimeMs(b.lastMessageAt) - this._pmTimeMs(a.lastMessageAt));
    if (!threads.length) {
      container.innerHTML = '<div class="pm-empty">目前沒有私訊對話</div>';
      return;
    }
    container.innerHTML = threads.map(t => {
      const unread = Math.max(0, Number(t.unreadCount || 0));
      const avatar = t.peerAvatar
        ? `<img src="${escapeHTML(t.peerAvatar)}" alt="" class="pm-thread-avatar-img">`
        : `<span>${escapeHTML(String(t.peerName || '?').slice(0, 1))}</span>`;
      const statusText = t.lastMessageStatus === 'recalled' ? '訊息已撤回' : (t.lastMessageBody || '');
      return `
        <button type="button" class="pm-thread-card${unread ? ' is-unread' : ''}" data-peer-uid="${escapeHTML(t.peerUid || '')}" data-conversation-id="${escapeHTML(t.conversationId || t.id || '')}">
          <span class="pm-thread-avatar">${avatar}</span>
          <span class="pm-thread-main">
            <span class="pm-thread-top">
              <span class="pm-thread-name" data-no-translate>${escapeHTML(t.peerName || t.peerUid || '未知用戶')}</span>
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
        this.openPmDialog(peerUid, { conversationId });
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
