/* ================================================
   ToosterX - Private Message realtime thread list
   ================================================ */

Object.assign(App, {
  _pmThreadsUnsub: null,
  _pmListeningUid: '',
  _pmThreadsReady: false,
  _pmIncomingBubbleTimer: null,
  _pmIncomingBubbleVisible: false,
  _pmStartRetryTimer: null,
  _pmOptimisticReadThreads: Object.create(null),
  _pmDismissedUnreadReminderKey: '',
  _pmFreshFollowupReminderKeys: [],
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
      this._pmOptimisticReadThreads = Object.create(null);
      this._pmDismissedUnreadReminderKey = '';
      this._pmFreshFollowupReminderKeys = [];
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
        const rawThreads = snapshot.docs.map(doc => ({ id: doc.id, _docId: doc.id, ...doc.data() }));
        this._reconcilePmOptimisticReadThreads?.(rawThreads);
        const nextThreads = this._applyPmOptimisticReadThreads?.(rawThreads) || rawThreads;
        const increasedThread = this._pmThreadsReady
          ? this._findPmUnreadIncrease(previousThreads, nextThreads)
          : this._findPmInitialUnread(nextThreads);
        const nextUnreadTotal = nextThreads.reduce((sum, t) => sum + Math.max(0, Number(t.unreadCount || 0)), 0);
        FirebaseService._cache.pmThreads = nextThreads;
        this._pmThreadsReady = true;
        this.updateNotifBadge?.();
        if (nextUnreadTotal <= 0) this._hidePmIncomingBubble?.();
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

  _pmConversationKey(value) {
    return String(value?.conversationId || value?.id || value?._docId || value || '').trim();
  },

  _applyPmOptimisticReadThreads(threads = []) {
    const pending = this._pmOptimisticReadThreads || {};
    if (!Object.keys(pending).length) return threads;
    return (threads || []).map(thread => {
      const cId = this._pmConversationKey?.(thread);
      return cId && pending[cId] ? { ...thread, unreadCount: 0 } : thread;
    });
  },

  _reconcilePmOptimisticReadThreads(rawThreads = []) {
    const pending = this._pmOptimisticReadThreads || {};
    const keys = Object.keys(pending);
    if (!keys.length) return;
    const now = Date.now();
    const rawMap = new Map((rawThreads || []).map(thread => [this._pmConversationKey?.(thread), thread]));
    keys.forEach(cId => {
      const thread = rawMap.get(cId);
      const isStale = now - Number(pending[cId]?.startedAt || 0) > 10000;
      if (!thread || isStale || Math.max(0, Number(thread.unreadCount || 0)) <= 0) delete pending[cId];
    });
  },

  _optimisticallyMarkPmConversationRead(conversationId) {
    const cId = String(conversationId || '').trim();
    if (!cId || typeof FirebaseService === 'undefined') return;
    if (!this._pmOptimisticReadThreads) this._pmOptimisticReadThreads = Object.create(null);
    const threads = FirebaseService._cache?.pmThreads || [];
    const currentThread = threads.find(thread => this._pmConversationKey?.(thread) === cId);
    const previousUnread = Math.max(0, Number(currentThread?.unreadCount || 0));
    if (!this._pmOptimisticReadThreads[cId]) {
      this._pmOptimisticReadThreads[cId] = {
        previousUnread,
        startedAt: Date.now(),
      };
    }
    if (Array.isArray(this._pmDialogMessages)) {
      this._pmDialogMessages = this._pmDialogMessages.map(message => (
        message?.direction === 'in' && message.read === false
          ? { ...message, read: true }
          : message
      ));
    }
    if (Array.isArray(threads) && threads.length) {
      FirebaseService._cache.pmThreads = threads.map(thread => (
        this._pmConversationKey?.(thread) === cId
          ? { ...thread, unreadCount: 0 }
          : thread
      ));
    }
    this.updateNotifBadge?.();
    if (this.currentPage === 'page-messages' && this._msgInboxFilter === 'pm-conversation') {
      this.renderPmThreadList?.();
    }
  },

  _clearPmOptimisticReadThread(conversationId, restore = false) {
    const cId = String(conversationId || '').trim();
    const pending = cId ? this._pmOptimisticReadThreads?.[cId] : null;
    if (!cId || !pending) return;
    delete this._pmOptimisticReadThreads[cId];
    if (restore && typeof FirebaseService !== 'undefined' && Array.isArray(FirebaseService._cache?.pmThreads)) {
      FirebaseService._cache.pmThreads = FirebaseService._cache.pmThreads.map(thread => (
        this._pmConversationKey?.(thread) === cId
          ? { ...thread, unreadCount: Math.max(Number(thread.unreadCount || 0), Number(pending.previousUnread || 0)) }
          : thread
      ));
    }
    this.updateNotifBadge?.();
    if (restore && this.currentPage === 'page-messages' && this._msgInboxFilter === 'pm-conversation') {
      this.renderPmThreadList?.();
    }
  },

  _findPmUnreadIncrease(previousThreads = [], nextThreads = []) {
    if (this.currentPage === 'page-messages' && this._msgInboxFilter === 'pm-conversation') return null;
    const previousMap = new Map(previousThreads.map(t => [
      String(t.conversationId || t.id || t._docId || ''),
      Math.max(0, Number(t.unreadCount || 0)),
    ]));
    const increased = nextThreads.find(t => {
      const cId = String(t.conversationId || t.id || t._docId || '');
      const unread = Math.max(0, Number(t.unreadCount || 0));
      if (!cId || unread <= 0 || unread <= (previousMap.get(cId) || 0)) return false;
      return !this._isPmDialogOpenForConversation(cId);
    }) || null;
    if (!increased) return null;
    const nextUnreadKeys = new Set((nextThreads || [])
      .filter(t => Math.max(0, Number(t.unreadCount || 0)) > 0)
      .map(t => this._pmConversationKey?.(t))
      .filter(Boolean));
    const followupKeys = (this._getPmUnreadReminderThreads?.(previousThreads, { staleOnly: true }) || [])
      .map(t => this._pmConversationKey?.(t))
      .filter(key => key && nextUnreadKeys.has(key));
    return {
      ...increased,
      _pmBubbleMode: 'fresh',
      _pmFollowupReminderKeys: Array.from(new Set(followupKeys)),
    };
  },

  _findPmInitialUnread(threads = []) {
    if (this.currentPage === 'page-messages' && this._msgInboxFilter === 'pm-conversation') return null;
    const now = Date.now();
    const unreadThreads = this._getPmUnreadReminderThreads?.(threads) || [];
    if (!unreadThreads.length) return null;
    const freshThread = unreadThreads.find(t => {
        const lastMs = this._pmTimeMs(t.lastMessageAt);
        return !lastMs || (now - lastMs) <= this.PM_INCOMING_BUBBLE_WINDOW_MS;
    });
    if (freshThread) return { ...freshThread, _pmBubbleMode: 'fresh' };
    const reminder = this._buildPmUnreadReminderThread?.(unreadThreads);
    if (!reminder || this._isPmUnreadReminderDismissed?.(reminder._pmReminderKey)) return null;
    return reminder;
  },

  _pmUnreadReminderStorageKey() {
    const uid = this._pmCurrentUid?.() || this._pmListeningUid || '';
    return uid ? `pmUnreadReminderDismissed:${uid}` : 'pmUnreadReminderDismissed';
  },

  _pmBuildUnreadReminderKey(threads = []) {
    return (threads || [])
      .map(t => {
        const cId = String(t.conversationId || t.id || t._docId || '').trim();
        const unread = Math.max(0, Number(t.unreadCount || 0));
        const lastMessageId = String(t.lastMessageId || '').trim();
        const lastMs = this._pmTimeMs(t.lastMessageAt);
        return `${cId}:${lastMessageId}:${unread}:${lastMs}`;
      })
      .filter(Boolean)
      .sort()
      .join('|');
  },

  _isPmUnreadReminderDismissed(reminderKey) {
    const key = String(reminderKey || '').trim();
    if (!key) return false;
    if (this._pmDismissedUnreadReminderKey === key) return true;
    try {
      return sessionStorage.getItem(this._pmUnreadReminderStorageKey?.() || 'pmUnreadReminderDismissed') === key;
    } catch (_) {
      return false;
    }
  },

  _dismissPmUnreadReminder(reminderKey) {
    const key = String(reminderKey || '').trim();
    if (!key) return;
    this._pmDismissedUnreadReminderKey = key;
    try {
      sessionStorage.setItem(this._pmUnreadReminderStorageKey?.() || 'pmUnreadReminderDismissed', key);
    } catch (_) {}
  },

  _getPmUnreadReminderThreads(threads = [], options = {}) {
    const staleOnly = !!options.staleOnly;
    const keyFilter = new Set((options.conversationKeys || []).map(key => String(key || '').trim()).filter(Boolean));
    const now = Date.now();
    return (threads || [])
      .filter(t => {
        const cId = String(t.conversationId || t.id || t._docId || '').trim();
        const unread = Math.max(0, Number(t.unreadCount || 0));
        if (!cId || unread <= 0 || this._isPmDialogOpenForConversation(cId)) return false;
        if (keyFilter.size) return keyFilter.has(cId);
        if (!staleOnly) return true;
        const lastMs = this._pmTimeMs(t.lastMessageAt);
        return !!lastMs && (now - lastMs) > this.PM_INCOMING_BUBBLE_WINDOW_MS;
      })
      .sort((a, b) => this._pmTimeMs(b.lastMessageAt) - this._pmTimeMs(a.lastMessageAt));
  },

  _showPmUnreadReminderFromCache(options = {}) {
    if (this.currentPage === 'page-messages' && this._msgInboxFilter === 'pm-conversation') return false;
    const threads = (typeof FirebaseService !== 'undefined' && FirebaseService._cache?.pmThreads) || [];
    const unreadThreads = this._getPmUnreadReminderThreads?.(threads, options) || [];
    const reminder = this._buildPmUnreadReminderThread?.(unreadThreads);
    if (!reminder || this._isPmUnreadReminderDismissed?.(reminder._pmReminderKey)) return false;
    this._showPmIncomingBubble?.(reminder);
    return true;
  },

  _buildPmUnreadReminderThread(threads = []) {
    const unreadThreads = (threads || []).filter(t => Math.max(0, Number(t.unreadCount || 0)) > 0);
    if (!unreadThreads.length) return null;
    const first = unreadThreads[0];
    const totalUnread = unreadThreads.reduce((sum, t) => sum + Math.max(0, Number(t.unreadCount || 0)), 0);
    const reminderKey = this._pmBuildUnreadReminderKey?.(unreadThreads) || '';
    const peerNames = unreadThreads
      .map(t => String(t.peerName || '').trim())
      .filter(Boolean);
    const namesText = peerNames.slice(0, 2).join('\u3001');
    return {
      ...first,
      _pmBubbleMode: 'reminder',
      _pmReminderKey: reminderKey,
      _pmReminderThreadCount: unreadThreads.length,
      _pmReminderUnreadCount: totalUnread,
      _pmReminderTitle: unreadThreads.length > 1
        ? `\u4f60\u6709 ${totalUnread} \u5247\u672a\u8b80\u79c1\u8a0a`
        : '\u4f60\u6709\u672a\u8b80\u79c1\u8a0a',
      _pmReminderText: unreadThreads.length > 1
        ? `${namesText || '\u591a\u4f4d\u7528\u6236'}${unreadThreads.length > 2 ? '\u7b49\u4eba' : ''}\u50b3\u4f86\u8a0a\u606f`
        : `${String(first.peerName || '\u5c0d\u65b9').trim()}\u7684\u8a0a\u606f\u5c1a\u672a\u8b80\u53d6`,
    };
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
    const mode = thread?._pmBubbleMode === 'reminder' ? 'reminder' : 'fresh';
    const reminderKey = String(thread?._pmReminderKey || '').trim();
    if (mode === 'reminder' && this._isPmUnreadReminderDismissed?.(reminderKey)) return;
    let bubble = document.getElementById('pm-incoming-bubble');
    if (!bubble || bubble.tagName === 'BUTTON') {
      if (bubble) bubble.remove();
      bubble = document.createElement('div');
      bubble.id = 'pm-incoming-bubble';
      bubble.className = 'pm-incoming-bubble';
      bubble.setAttribute('role', 'button');
      bubble.tabIndex = 0;
      document.body.appendChild(bubble);
    }
    const statusText = mode === 'reminder'
      ? (thread._pmReminderText || '\u9ede\u64ca\u67e5\u770b\u5c0d\u8a71')
      : thread.lastMessageStatus === 'recalled'
      ? '\u8a0a\u606f\u5df2\u64a4\u56de'
      : (thread.lastMessageBody || '\u4f60\u6709\u65b0\u79c1\u8a0a');
    const titleText = mode === 'reminder'
      ? (thread._pmReminderTitle || '\u4f60\u6709\u672a\u8b80\u79c1\u8a0a')
      : (thread.peerName || peerUid);
    const labelText = mode === 'reminder' ? '\u672a\u8b80' : '\u79c1\u8a0a';
    const avatar = thread.peerAvatar
      ? `<img src="${escapeHTML(thread.peerAvatar)}" alt="">`
      : `<span>${escapeHTML(String(thread.peerName || '?').slice(0, 1))}</span>`;
    bubble.dataset.peerUid = peerUid;
    bubble.dataset.conversationId = cId;
    bubble.dataset.mode = mode;
    bubble.dataset.reminderKey = reminderKey;
    bubble.classList.toggle('is-reminder', mode === 'reminder');
    bubble.innerHTML = `
      <span class="pm-incoming-avatar">${avatar}</span>
      <span class="pm-incoming-main">
        <strong data-no-translate>${escapeHTML(titleText)}</strong>
        <span>${escapeHTML(statusText)}</span>
      </span>
      <span class="pm-incoming-label">${escapeHTML(labelText)}</span>
      ${mode === 'reminder' ? '<button type="button" class="pm-incoming-close" aria-label="\u95dc\u9589\u672a\u8b80\u79c1\u8a0a\u63d0\u9192">\u00d7</button>' : ''}`;
    bubble.onclick = () => {
      this._hidePmIncomingBubble?.();
      if (mode === 'reminder') this._dismissPmUnreadReminder?.(reminderKey);
      if (mode === 'reminder' && Number(thread?._pmReminderThreadCount || 0) > 1) {
        this._msgInboxFilter = 'pm-conversation';
        this.showPage?.('page-messages');
        setTimeout(() => this.renderMessageList?.('pm-conversation'), 0);
      } else {
        this.openPmDialog?.(peerUid, { conversationId: cId });
      }
    };
    bubble.onkeydown = event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      bubble.click();
    };
    const closeBtn = bubble.querySelector('.pm-incoming-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        this._dismissPmUnreadReminder?.(reminderKey);
        this._hidePmIncomingBubble?.();
      });
    }
    this._pmIncomingBubbleVisible = true;
    this._pmFreshFollowupReminderKeys = mode === 'fresh'
      ? Array.from(new Set((thread?._pmFollowupReminderKeys || []).map(key => String(key || '').trim()).filter(Boolean)))
      : [];
    bubble.classList.add('is-visible');
    this.updateNotifBadge?.();
    clearTimeout(this._pmIncomingBubbleTimer);
    if (mode === 'fresh') {
      this._pmIncomingBubbleTimer = setTimeout(() => this._handlePmFreshBubbleTimeout?.(), 6500);
    } else {
      this._pmIncomingBubbleTimer = null;
    }
  },

  _handlePmFreshBubbleTimeout() {
    clearTimeout(this._pmIncomingBubbleTimer);
    this._pmIncomingBubbleTimer = null;
    const bubble = document.getElementById('pm-incoming-bubble');
    if (bubble?.dataset?.mode !== 'fresh') return;
    const followupKeys = Array.isArray(this._pmFreshFollowupReminderKeys) ? this._pmFreshFollowupReminderKeys.slice() : [];
    this._pmFreshFollowupReminderKeys = [];
    if (followupKeys.length && this._showPmUnreadReminderFromCache?.({ conversationKeys: followupKeys })) return;
    if (this._showPmUnreadReminderFromCache?.({ staleOnly: true })) return;
    this._hidePmIncomingBubble?.();
  },

  _hidePmIncomingBubble() {
    clearTimeout(this._pmIncomingBubbleTimer);
    this._pmIncomingBubbleTimer = null;
    this._pmIncomingBubbleVisible = false;
    this._pmFreshFollowupReminderKeys = [];
    const bubble = document.getElementById('pm-incoming-bubble');
    if (bubble) bubble.classList.remove('is-visible');
    this.updateNotifBadge?.();
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
    const activeBubble = document.getElementById('pm-incoming-bubble');
    if (activeBubble?.dataset?.mode === 'reminder') {
      this._dismissPmUnreadReminder?.(activeBubble.dataset.reminderKey || this._pmBuildUnreadReminderKey?.(threads));
      this._hidePmIncomingBubble?.();
    }
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
