const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function loadPmListenerHarness(html = '<!doctype html><body></body>') {
  const dom = new JSDOM(html, { url: 'https://toosterx.test/' });
  const App = {
    _pmCurrentUid: () => 'U11111111111111111111111111111111',
    isValidLineUid: uid => /^U[0-9a-f]{32}$/i.test(String(uid || '')),
    _pmParseConversationId(cId) {
      const match = String(cId || '').match(/^pm_(U[0-9a-f]{32})_(U[0-9a-f]{32})$/i);
      return match ? { uidA: match[1], uidB: match[2] } : null;
    },
    updateNotifBadge: jest.fn(),
    openPmDialog: jest.fn(),
    showPage: jest.fn(),
    renderMessageList: jest.fn(),
  };
  const FirebaseService = { _cache: { pmThreads: [] } };
  const context = {
    App,
    FirebaseService,
    document: dom.window.document,
    window: dom.window,
    sessionStorage: dom.window.sessionStorage,
    escapeHTML: value => String(value ?? ''),
    Date,
    setTimeout,
    clearTimeout,
    console,
    auth: { onAuthStateChanged: jest.fn(), currentUser: null },
    db: { collection: jest.fn() },
  };
  vm.runInNewContext(readProjectFile('js/modules/message/pm-listener.js'), context);
  return { App, FirebaseService, document: dom.window.document };
}

function loadPmDialogHarness() {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://toosterx.test/' });
  const App = {
    _pmCurrentUid: () => 'U11111111111111111111111111111111',
    _pmFormatTime: () => '剛剛',
  };
  const context = {
    App,
    document: dom.window.document,
    window: dom.window,
    URL: dom.window.URL,
    escapeHTML: value => String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;'),
    console,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(readProjectFile('js/modules/message/pm-dialog.js'), context);
  return { App, document: dom.window.document };
}

const PM_MY_UID = `U${'1'.repeat(32)}`;
const PM_PEER_A_UID = `U${'2'.repeat(32)}`;
const PM_PEER_B_UID = `U${'3'.repeat(32)}`;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushPromises(rounds = 6) {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve();
}

function makePmMessage(index, overrides = {}) {
  return {
    id: `message-${index}`,
    messageId: `message-${index}`,
    fromUid: PM_MY_UID,
    toUid: PM_PEER_A_UID,
    direction: 'out',
    read: true,
    peerRead: false,
    body: `message ${index}`,
    status: 'active',
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    ...overrides,
  };
}

function createPmQueryController() {
  const listeners = [];

  function makeNode(pathParts, query = {}) {
    return {
      collection(name) {
        return makeNode(pathParts.concat(String(name)), query);
      },
      doc(id) {
        return makeNode(pathParts.concat(String(id)), query);
      },
      orderBy(field, direction) {
        return makeNode(pathParts, { ...query, orderBy: { field, direction } });
      },
      limit(value) {
        return makeNode(pathParts, { ...query, limit: value });
      },
      onSnapshot(next, error) {
        const record = {
          path: pathParts.join('/'),
          orderBy: query.orderBy,
          limit: query.limit,
          next,
          error,
          unsubscribed: false,
          unsubscribe: jest.fn(() => { record.unsubscribed = true; }),
          emitMessages(messages) {
            const ordered = [...messages].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
            if (record.orderBy?.direction === 'desc') ordered.reverse();
            const limited = Number.isFinite(record.limit) ? ordered.slice(0, record.limit) : ordered;
            record.next({
              docs: limited.map(message => ({
                id: message.id,
                data: () => ({ ...message }),
              })),
            });
          },
          emitError(err) {
            record.error(err);
          },
        };
        listeners.push(record);
        return record.unsubscribe;
      },
    };
  }

  return {
    db: { collection: name => makeNode([String(name)]) },
    listeners,
  };
}

function loadPmDialogLifecycleHarness() {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://toosterx.test/' });
  const queryController = createPmQueryController();
  const callables = {};
  const consoleMock = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const ApiService = {
    getCurrentUser: jest.fn(() => ({ uid: PM_MY_UID, displayName: 'Current user' })),
    getPmThreadByConversationId: jest.fn(() => null),
    getUserByUid: jest.fn(uid => ({ uid, name: uid === PM_PEER_A_UID ? 'Peer A' : 'Peer B', pictureUrl: '' })),
    getPmMessages: jest.fn(),
  };
  const App = {
    _requireProtectedActionLogin: jest.fn(() => false),
    _pmTimeMs: value => new Date(value).getTime() || 0,
    showToast: jest.fn(),
  };
  const promptMock = jest.fn();
  const confirmMock = jest.fn(() => true);
  let animationFrameId = 0;
  const requestAnimationFrameMock = jest.fn(callback => {
    callback();
    animationFrameId += 1;
    return animationFrameId;
  });
  const cancelAnimationFrameMock = jest.fn();
  dom.window.requestAnimationFrame = requestAnimationFrameMock;
  dom.window.cancelAnimationFrame = cancelAnimationFrameMock;
  dom.window.scrollTo = jest.fn();
  const context = {
    App,
    ApiService,
    auth: { currentUser: { uid: PM_MY_UID } },
    db: queryController.db,
    document: dom.window.document,
    window: dom.window,
    URL: dom.window.URL,
    escapeHTML: value => String(value ?? ''),
    ensureFirebaseFunctionsSdk: jest.fn(),
    prompt: promptMock,
    confirm: confirmMock,
    console: consoleMock,
    Date,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: requestAnimationFrameMock,
    cancelAnimationFrame: cancelAnimationFrameMock,
  };
  vm.runInNewContext(readProjectFile('js/modules/message/pm-permission.js'), context);
  vm.runInNewContext(readProjectFile('js/modules/message/pm-dialog.js'), context);
  vm.runInNewContext(readProjectFile('js/modules/message/pm-dialog-actions.js'), context);
  App._pmCallable = jest.fn(name => callables[name] || null);
  return {
    App,
    ApiService,
    callables,
    consoleMock,
    confirmMock,
    document: dom.window.document,
    promptMock,
    queryController,
  };
}

describe('private message feature wiring', () => {
  test('frontend registers PM modules, inbox tab, and profile entry point', () => {
    const index = readProjectFile('index.html');
    const scriptLoader = readProjectFile('js/core/script-loader.js');
    const messagePage = readProjectFile('pages/message.html');
    const profile = readProjectFile('js/modules/profile/profile-core.js');

    expect(index).toContain('js/modules/message/pm-permission.js');
    expect(index).toContain('js/modules/message/pm-entry.js');
    expect(index).toContain('js/modules/message/pm-listener.js');
    expect(scriptLoader).toContain('js/modules/message/pm-audit.js');
    expect(messagePage).toContain('data-msgtype="pm-conversation"');
    expect(messagePage).toContain('data-msgtype="pm-conversation">私訊</button>');
    expect(messagePage).not.toContain('私訊對話</button>');
    expect(messagePage).not.toContain('data-msgtype="private"');
    expect(readProjectFile('js/modules/message/message-render.js')).toContain("if (f === 'private') f = 'pm-conversation'");
    expect(profile).toContain('App.openPmDialog');
  });

  test('PM dialog supports optimistic send, collapsed search, and incoming bubble', () => {
    const dialog = readProjectFile('js/modules/message/pm-dialog.js');
    const actions = readProjectFile('js/modules/message/pm-dialog-actions.js');
    const search = readProjectFile('js/modules/message/pm-dialog-search.js');
    const listener = readProjectFile('js/modules/message/pm-listener.js');
    const css = readProjectFile('css/message.css');

    expect(dialog).toContain('_pmOptimisticMessages');
    expect(dialog).toContain('_getPmDialogRenderMessages');
    expect(dialog).toContain('maxlength="${maxLength}"');
    expect(dialog).toContain('rows="1"');
    expect(dialog).toContain('_resizePmDialogInput');
    expect(dialog).toContain('PM_MAX_BODY_LENGTH || 300');
    expect(actions).toContain('_addPmOptimisticMessage');
    expect(actions).toContain('_markPmOptimisticMessage');
    expect(actions).toContain('PM_MAX_BODY_LENGTH || 300');
    expect(actions).toContain('_resizePmDialogInput?.(input)');
    expect(actions).not.toContain('body.length > 1000');
    expect(search).toContain('togglePmDialogSearch');
    expect(search).toContain("querySelector('.pm-dialog-title')");
    expect(dialog).toContain('pm-dialog-search-toggle');
    expect(dialog).toContain('pm-dialog-peer-line');
    expect(dialog).toContain('pm-dialog-search-icon');
    expect(dialog).toContain('_openPmDialogPeerProfile');
    expect(dialog).toContain("showUserProfile?.(peerName || targetUid, { uid: targetUid })");
    expect(dialog).toContain('_installPmDialogViewportGuard');
    expect(dialog).toContain('window.visualViewport');
    expect(dialog).toContain('_isPmDialogTextControl');
    expect(dialog).toContain('_getPmDialogUsableViewportHeight');
    expect(dialog).toContain('--pm-keyboard-reclaim');
    expect(readProjectFile('js/modules/message/pm-permission.js')).toContain('PM_KEYBOARD_ACCESSORY_GAP_PX');
    expect(dialog).not.toContain('&#128269;');
    expect(listener).toContain('_showPmIncomingBubble');
    expect(listener).toContain('_findPmInitialUnread');
    expect(listener).toContain('_getPmUnreadReminderThreads');
    expect(listener).toContain('_showPmUnreadReminderFromCache');
    expect(listener).toContain('_handlePmFreshBubbleTimeout');
    expect(listener).toContain("_showPmUnreadReminderFromCache?.({ staleOnly: true })");
    expect(listener).toContain('_buildPmUnreadReminderThread');
    expect(listener).toContain('_pmBuildUnreadReminderKey');
    expect(listener).toContain('_dismissPmUnreadReminder');
    expect(listener).toContain('_resolvePmThreadPeerUid');
    expect(listener).toContain('_queuePmIncomingBubble');
    expect(listener).toContain('_schedulePmThreadListenerStart');
    expect(listener).toContain('_handlePmAuthUser');
    expect(listener).toContain('pm-incoming-bubble');
    expect(listener).toContain('data-user-card="pm-thread"');
    expect(readProjectFile('app.js')).toContain('this.startPmThreadListener?.();');
    expect(readProjectFile('js/modules/message/pm-entry.js')).toContain('_pmParseConversationId(options.conversationId)');
    expect(css).toContain('.pm-incoming-bubble');
    expect(css).toContain('width:min(224px, calc(100vw - 28px))');
    expect(css).toContain('.pm-dialog-title.is-search-open .pm-dialog-search');
    expect(css).toContain('.pm-dialog-search-toggle.is-active');
    expect(css).toContain('.pm-dialog-avatar:focus-visible');
    expect(css).toContain('.pm-dialog-overlay { position:fixed; inset:0;');
    expect(css).toContain('backdrop-filter:blur(18px) saturate(1.15)');
    expect(css).toContain('pointer-events:auto');
    expect(css).toContain('.pm-dialog-overlay.is-keyboard-open');
    expect(css).toContain('--pm-compose-control-height:2.5rem');
    expect(css).toContain('height:var(--pm-compose-control-height)');
    expect(css).toContain('resize:none; overflow-y:hidden');
    expect(css).toContain('.pm-dialog-input,');
    expect(css).toContain('.pm-dialog-search { font-size:16px; }');
  });

  test('PM audit layout constrains long UID and log rows inside the admin panel', () => {
    const css = readProjectFile('css/message.css');
    const adminCss = readProjectFile('css/admin.css');
    const audit = readProjectFile('js/modules/message/pm-audit.js');

    expect(adminCss).toContain('.admin-log-toolbar.is-empty { display: none; }');
    expect(css).toContain('[data-admin-log-panel="chat"] { min-width:0; max-width:100%; overflow:hidden; }');
    expect(css).toContain('.pm-audit-layout { display:grid; grid-template-columns:minmax(0,1fr)');
    expect(css).toContain('.pm-audit-settings-card');
    expect(css).toContain('.pm-audit-switch input:checked + span');
    expect(css).toContain('.pm-audit-log { display:grid; grid-template-columns:auto minmax(0,1fr) auto');
    expect(css).toContain('font-size:.74rem');
    expect(audit).toContain('_pmAuditShortUid');
    expect(audit).toContain('limit: 50');
    expect(audit).toContain('loadMorePmAuditLogs');
    expect(audit).toContain('cursorCreatedAtMs');
    expect(css).toContain('.pm-audit-load-more-row');
    expect(css).toContain('.pm-audit-message p { margin:.35rem 0 0; font-size:.8rem; line-height:1.55; white-space:pre-wrap; overflow-wrap:anywhere; }');
    expect(css).toContain('@media (max-width:560px)');
  });

  test('PM audit exposes a super-admin switch for all-role private messaging', () => {
    const audit = readProjectFile('js/modules/message/pm-audit.js');

    expect(audit).toContain('所有角色互相私訊');
    expect(audit).toContain('所有角色都可以互相建立新私訊');
    expect(audit).toContain('載入 log 失敗');
    expect(audit).toContain('id="pm-user-pm-toggle"');
    expect(audit).toContain('loadPmAuditSettings');
    expect(audit).toContain('savePmAuditSettings');
    expect(audit).toContain("this._pmCallable?.('getPrivateMessageSettings')");
    expect(audit).toContain("this._pmCallable?.('updatePrivateMessageSettings')");
    expect(audit).toContain("this.loadPmAuditLogs('settings_update')");
  });

  test('PM unread indicators show bell hint after incoming bubble and mark the PM conversation tab', () => {
    const index = readProjectFile('index.html');
    const renderer = readProjectFile('js/modules/message/message-render.js');
    const listener = readProjectFile('js/modules/message/pm-listener.js');
    const messagePage = readProjectFile('pages/message.html');
    const layoutCss = readProjectFile('css/layout.css');
    const messageCss = readProjectFile('css/message.css');

    expect(index).toContain('id="pm-notif-hint"');
    expect(index).toContain('<img src="img/chat.png" alt="">');
    expect(messagePage).toContain('data-msgtype="pm-conversation"');
    expect(renderer).toContain('_syncPmUnreadIndicators');
    expect(renderer).toContain('const showBellHint = count > 0');
    expect(renderer).toContain("document.querySelector('#msg-inbox-tabs .tab[data-msgtype=\"pm-conversation\"]')");
    expect(renderer).toContain("tab.classList.toggle('has-pm-unread', count > 0)");
    expect(listener).toContain('_pmIncomingBubbleVisible: false');
    expect(listener).toContain('this._pmIncomingBubbleVisible = true;');
    expect(listener).toContain('this._pmIncomingBubbleVisible = false;');
    expect(listener).toContain('_pmOptimisticReadThreads');
    expect(listener).toContain('_optimisticallyMarkPmConversationRead');
    expect(listener).toContain('_clearPmOptimisticReadThread');
    expect(listener).toContain('sessionStorage.setItem');
    expect(listener).toContain("thread?._pmBubbleMode === 'reminder'");
    expect(listener).toContain("bubble.classList.toggle('is-reminder'");
    expect(messageCss).toContain('.pm-incoming-bubble.is-reminder');
    expect(messageCss).toContain('.pm-incoming-close');
    expect(readProjectFile('js/modules/message/pm-dialog.js')).not.toContain('this._optimisticallyMarkPmConversationRead?.(conversationId)');
    expect(layoutCss).toContain('.pm-notif-hint');
    expect(layoutCss).toContain('#notif-btn.has-pm-unread .pm-notif-hint');
    expect(messageCss).toContain('#msg-inbox-tabs .tab[data-msgtype="pm-conversation"].has-pm-unread::after');
  });

  test('PM dialog safely linkifies https links with an external-link warning', () => {
    const { App } = loadPmDialogHarness();
    const html = App._buildPmMessageHtml({
      fromUid: 'U22222222222222222222222222222222',
      body: '請看 https://example.com/path?a=1&b=2，<script>alert(1)</script> http://plain.test',
      createdAt: new Date('2026-05-20T00:00:00.000Z').toISOString(),
      status: 'active',
      messageId: 'pm-1',
    }, 'U11111111111111111111111111111111');

    expect(html).toContain('class="pm-message-link"');
    expect(html).toContain('href="https://example.com/path?a=1&amp;b=2"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer nofollow ugc"');
    expect(html).toContain('https://example.com/path?a=1&amp;b=2</a>，');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('http://plain.test');
    expect(html).toContain('pm-message-link-safety');
    expect(html).toContain('ToosterX');
    expect(html).toContain('密碼');
    expect(html).not.toContain('<script>');
  });

  test('PM fresh bubble timeout keeps a reminder for threads that were stale before the new message', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-05-13T00:00:00.000Z'));
      const { App, FirebaseService, document } = loadPmListenerHarness();
      const myUid = 'U11111111111111111111111111111111';
      const peerUid = 'U22222222222222222222222222222222';
      const conversationId = `pm_${myUid}_${peerUid}`;
      const staleBefore = {
        conversationId,
        peerUid,
        peerName: 'Old unread',
        unreadCount: 1,
        lastMessageId: 'old-message',
        lastMessageAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
      };
      const freshAfter = {
        ...staleBefore,
        unreadCount: 2,
        lastMessageId: 'fresh-message',
        lastMessageAt: new Date(Date.now()).toISOString(),
        lastMessageBody: 'new message',
      };

      const freshBubbleThread = App._findPmUnreadIncrease([staleBefore], [freshAfter]);
      expect(freshBubbleThread._pmBubbleMode).toBe('fresh');
      expect(freshBubbleThread._pmFollowupReminderKeys).toContain(conversationId);

      FirebaseService._cache.pmThreads = [freshAfter];
      App._showPmIncomingBubble(freshBubbleThread);
      expect(document.getElementById('pm-incoming-bubble').dataset.mode).toBe('fresh');

      App._handlePmFreshBubbleTimeout();
      const bubble = document.getElementById('pm-incoming-bubble');
      expect(bubble.dataset.mode).toBe('reminder');
      expect(bubble.classList.contains('is-visible')).toBe(true);
      expect(bubble.textContent).toContain('未讀');
    } finally {
      jest.useRealTimers();
    }
  });

  test('PM initial fresh bubble restores saved stale reminder state after browser refresh', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-05-13T00:00:00.000Z'));
      const { App, FirebaseService, document } = loadPmListenerHarness();
      const myUid = 'U11111111111111111111111111111111';
      const peerUid = 'U22222222222222222222222222222222';
      const conversationId = `pm_${myUid}_${peerUid}`;
      const freshThreadAfterRefresh = {
        conversationId,
        peerUid,
        peerName: 'Reloaded unread',
        unreadCount: 2,
        lastMessageId: 'fresh-before-refresh',
        lastMessageAt: new Date(Date.now()).toISOString(),
        lastMessageBody: 'message before refresh',
      };

      App._savePmFreshFollowupReminderKeys([conversationId]);
      const initialFreshBubble = App._findPmInitialUnread([freshThreadAfterRefresh]);
      expect(initialFreshBubble._pmBubbleMode).toBe('fresh');
      expect(initialFreshBubble._pmFollowupReminderKeys).toContain(conversationId);

      FirebaseService._cache.pmThreads = [freshThreadAfterRefresh];
      App._showPmIncomingBubble(initialFreshBubble);
      expect(document.getElementById('pm-incoming-bubble').dataset.mode).toBe('fresh');

      App._handlePmFreshBubbleTimeout();
      const bubble = document.getElementById('pm-incoming-bubble');
      expect(bubble.dataset.mode).toBe('reminder');
      expect(bubble.classList.contains('is-visible')).toBe(true);
      expect(bubble.textContent).toContain('未讀私訊');
    } finally {
      jest.useRealTimers();
    }
  });

  test('PM fresh bubble timeout keeps unread reminder while the desktop PM list is open', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-05-13T00:00:00.000Z'));
      const { App, FirebaseService, document } = loadPmListenerHarness();
      const myUid = 'U11111111111111111111111111111111';
      const peerUid = 'U22222222222222222222222222222222';
      const conversationId = `pm_${myUid}_${peerUid}`;
      const freshThread = {
        conversationId,
        peerUid,
        peerName: 'Desktop unread',
        unreadCount: 1,
        lastMessageId: 'fresh-desktop-message',
        lastMessageAt: new Date(Date.now()).toISOString(),
        lastMessageBody: 'desktop message',
      };

      App.currentPage = 'page-messages';
      App._msgInboxFilter = 'pm-conversation';
      FirebaseService._cache.pmThreads = [freshThread];
      App._showPmIncomingBubble({ ...freshThread, _pmBubbleMode: 'fresh' });
      expect(document.getElementById('pm-incoming-bubble').dataset.mode).toBe('fresh');

      App._handlePmFreshBubbleTimeout();

      const bubble = document.getElementById('pm-incoming-bubble');
      expect(bubble.dataset.mode).toBe('reminder');
      expect(bubble.classList.contains('is-visible')).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test('PM thread list rendering does not dismiss an active unread reminder bubble', () => {
    const { App, FirebaseService, document } = loadPmListenerHarness('<!doctype html><body><div id="message-list"></div></body>');
    const myUid = 'U11111111111111111111111111111111';
    const peerUid = 'U22222222222222222222222222222222';
    const conversationId = `pm_${myUid}_${peerUid}`;
    const unreadThread = {
      conversationId,
      peerUid,
      peerName: 'List unread',
      unreadCount: 1,
      lastMessageId: 'list-message',
      lastMessageAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
      lastMessageBody: 'list message',
    };

    FirebaseService._cache.pmThreads = [unreadThread];
    const reminder = App._buildPmUnreadReminderThread([unreadThread]);
    App._showPmIncomingBubble(reminder);
    expect(document.getElementById('pm-incoming-bubble').dataset.mode).toBe('reminder');

    App.currentPage = 'page-messages';
    App._msgInboxFilter = 'pm-conversation';
    App.renderPmThreadList();

    const bubble = document.getElementById('pm-incoming-bubble');
    expect(bubble.dataset.mode).toBe('reminder');
    expect(bubble.classList.contains('is-visible')).toBe(true);
  });

  test('PM fresh bubble keeps stale reminder state across repeated fresh messages', () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-05-13T00:00:00.000Z'));
      const { App, FirebaseService, document } = loadPmListenerHarness();
      const myUid = 'U11111111111111111111111111111111';
      const peerUid = 'U22222222222222222222222222222222';
      const conversationId = `pm_${myUid}_${peerUid}`;
      const staleBefore = {
        conversationId,
        peerUid,
        peerName: 'Old unread',
        unreadCount: 1,
        lastMessageId: 'old-message',
        lastMessageAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
      };
      const firstFresh = {
        ...staleBefore,
        unreadCount: 2,
        lastMessageId: 'fresh-message-1',
        lastMessageAt: new Date(Date.now()).toISOString(),
        lastMessageBody: 'first fresh message',
      };
      const secondFresh = {
        ...firstFresh,
        unreadCount: 3,
        lastMessageId: 'fresh-message-2',
        lastMessageBody: 'second fresh message',
      };

      const firstFreshBubble = App._findPmUnreadIncrease([staleBefore], [firstFresh]);
      const secondFreshBubble = App._findPmUnreadIncrease([firstFresh], [secondFresh]);
      expect(firstFreshBubble._pmFollowupReminderKeys).toContain(conversationId);
      expect(secondFreshBubble._pmFollowupReminderKeys).toEqual([]);

      FirebaseService._cache.pmThreads = [secondFresh];
      App._showPmIncomingBubble(firstFreshBubble);
      App._showPmIncomingBubble(secondFreshBubble);
      App._handlePmFreshBubbleTimeout();

      const bubble = document.getElementById('pm-incoming-bubble');
      expect(bubble.dataset.mode).toBe('reminder');
      expect(bubble.classList.contains('is-visible')).toBe(true);
      expect(bubble.textContent).toContain('未讀');
    } finally {
      jest.useRealTimers();
    }
  });

  test('PM edit and recall use optimistic pending states and lock after peer read', () => {
    const dialog = readProjectFile('js/modules/message/pm-dialog.js');
    const actions = readProjectFile('js/modules/message/pm-dialog-actions.js');

    expect(dialog).toContain('_pmPendingMessageUpdates');
    expect(dialog).toContain('_applyPmPendingMessageUpdates');
    expect(dialog).toContain("_pmPendingAction === 'editing'");
    expect(dialog).toContain("_pmPendingAction === 'recalling'");
    expect(dialog).toContain('\\u7de8\\u8f2f\\u4e2d');
    expect(dialog).toContain('\\u64a4\\u56de\\u4e2d');
    expect(dialog).toContain('const peerRead = own && message.peerRead === true');
    expect(dialog).toContain('!peerRead');
    expect(actions).toContain('_isPmMessagePeerRead');
    expect(actions).toContain('_showPmMessageAlreadyRead');
    expect(actions).toContain('\\u5c0d\\u65b9\\u5df2\\u8b80');
    expect(actions).not.toContain('_showPmMessageWindowExpired');
    expect(actions).not.toContain('\\u8a0a\\u606f\\u8d85\\u904e 15 \\u5206\\u9418');
    expect(actions).not.toContain('\\u8a0a\\u606f\\u8d85\\u904e 5 \\u5206\\u9418');
    expect(actions).toContain("status: 'edited'");
    expect(actions).toContain("status: 'recalled'");
  });

  test('PM permission helper validates canonical conversation participants', () => {
    const source = readProjectFile('js/modules/message/pm-permission.js');

    expect(source).toContain('_pmParseConversationId(cId)');
    expect(source).toContain('pmBuildConversationId(uidA, uidB)');
    expect(source).toContain('pmIsValidConversationId(cId, uid)');
    expect(source).toContain('PM_MAX_BODY_LENGTH: 300');
    expect(source).toContain('PM_KEYBOARD_RESTORE_DELAY_MS: 320');
    expect(source).toContain('parsed.uidA === safeUid || parsed.uidB === safeUid');
    expect(source).toContain('allowUserToUserPm');
    expect(source).toContain('if (settings?.allowUserToUserPm === true) return true;');
    expect(source).not.toContain("normalizedFromRole === 'user' && normalizedToRole === 'user'");
    expect(source).toContain('return fromLevel < toLevel');
  });

  test('PM global switch allows every built-in role pair to start a new conversation', () => {
    const App = {};
    vm.runInNewContext(readProjectFile('js/modules/message/pm-permission.js'), {
      App,
      ensureFirebaseFunctionsSdk: jest.fn(),
      auth: { currentUser: null },
      ApiService: { getCurrentUser: () => null },
      console,
    });
    const roles = Object.keys(App._pmRoleLevels);

    roles.forEach(fromRole => {
      roles.forEach(toRole => {
        expect(App.canSendPMTo(fromRole, toRole, false, { allowUserToUserPm: true })).toBe(true);
      });
    });
    expect(App.canSendPMTo('coach', 'user', false, { allowUserToUserPm: false })).toBe(false);
    expect(App.canSendPMTo('user', 'coach', false, { allowUserToUserPm: false })).toBe(true);
    expect(App.canSendPMTo('coach', 'user', true, { allowUserToUserPm: false })).toBe(true);
  });

  test('PM callable helper returns an async callable wrapper', async () => {
    const App = {};
    const callable = jest.fn(async payload => ({ data: { ok: true, payload } }));
    const httpsCallable = jest.fn(() => callable);
    const ensureFirebaseFunctionsSdk = jest.fn(async region => ({ httpsCallable }));
    vm.runInNewContext(readProjectFile('js/modules/message/pm-permission.js'), {
      App,
      ensureFirebaseFunctionsSdk,
      auth: { currentUser: null },
      ApiService: { getCurrentUser: () => null },
      console,
    });

    const fn = App._pmCallable('sendPrivateMessage');
    expect(typeof fn).toBe('function');
    const resp = await fn({ toUid: 'U22222222222222222222222222222222', body: 'hi' });

    expect(ensureFirebaseFunctionsSdk).toHaveBeenCalledWith('asia-east1');
    expect(httpsCallable).toHaveBeenCalledWith('sendPrivateMessage');
    expect(callable).toHaveBeenCalledWith({ toUid: 'U22222222222222222222222222222222', body: 'hi' });
    expect(resp.data.ok).toBe(true);
  });

  test('backend functions enforce super admin audit and 180-day retention', () => {
    const functions = readProjectFile('functions/index.js');

    expect(functions).toContain('const PM_AUDIT_RETENTION_DAYS = 180');
    expect(functions).toContain('const PM_MAX_BODY_LENGTH = 300');
    expect(functions).toContain('exports.sendPrivateMessage');
    expect(functions).toContain('exports.markPrivateConversationRead');
    expect(functions).toContain('exports.editPrivateMessage');
    expect(functions).toContain('exports.recallPrivateMessage');
    expect(functions).toContain('message already read');
    expect(functions).not.toContain('PM_EDIT_WINDOW_MS');
    expect(functions).not.toContain('PM_RECALL_WINDOW_MS');
    expect(functions).toContain('const PM_SETTINGS_DOC_ID = "privateMessage"');
    expect(functions).toContain('allowUserToUserPm: false');
    expect(functions).toContain('exports.getPrivateMessageSettings');
    expect(functions).toContain('exports.updatePrivateMessageSettings');
    expect(functions).toContain('pmGetSettingsInTransaction');
    expect(functions).toContain('if (settings?.allowUserToUserPm === true) return true;');
    expect(functions).not.toContain('normalizedFromRole === "user" && normalizedToRole === "user"');
    expect(functions).toContain('exports.searchPmAuditUsers');
    expect(functions).toContain('exports.getPmAuditConversation');
    expect(functions).toContain('exports.getPmAuditLogs');
    expect(functions).toContain('limit + 1');
    expect(functions).toContain('nextCursor');
    expect(functions).toContain('exports.cleanupPmAuditRetention');
    expect(functions).toContain('if (!access.isSuperAdmin) throw new HttpsError("permission-denied", "super_admin only")');
    expect(functions).toContain('retentionDeleteAfter: pmRetentionTimestamp(now)');
  });

  test('PM dialog uses one latest-50 listener and ignores stale A-to-B callbacks', async () => {
    const { App, ApiService, consoleMock, document, queryController } = loadPmDialogLifecycleHarness();
    const conversationA = App.pmBuildConversationId(PM_MY_UID, PM_PEER_A_UID);
    const conversationB = App.pmBuildConversationId(PM_MY_UID, PM_PEER_B_UID);

    await App._openPmDialogImpl(PM_PEER_A_UID, { conversationId: conversationA });
    const listenerA = queryController.listeners[0];
    expect(listenerA.orderBy).toEqual({ field: 'createdAt', direction: 'desc' });
    expect(listenerA.limit).toBe(50);
    expect(ApiService.getPmMessages).not.toHaveBeenCalled();

    listenerA.emitMessages(Array.from({ length: 60 }, (_, index) => makePmMessage(index + 1)));
    expect(App._pmDialogMessages).toHaveLength(50);
    expect(App._pmDialogMessages[0].messageId).toBe('message-11');
    expect(App._pmDialogMessages[49].messageId).toBe('message-60');

    await App._openPmDialogImpl(PM_PEER_B_UID, { conversationId: conversationB });
    const listenerB = queryController.listeners[1];
    expect(listenerA.unsubscribe).toHaveBeenCalledTimes(1);
    expect(App._pmDialogMessages).toEqual([]);
    expect(document.querySelector('.pm-dialog-messages').innerHTML).toBe('');

    listenerA.emitMessages([makePmMessage(999)]);
    listenerA.emitError(new Error('stale listener error'));
    expect(App._pmDialogMessages).toEqual([]);
    expect(consoleMock.warn).not.toHaveBeenCalled();

    listenerB.emitMessages(Array.from({ length: 61 }, (_, index) => makePmMessage(index + 1, {
      toUid: PM_PEER_B_UID,
    })));
    expect(App._pmDialogMessages).toHaveLength(50);
    expect(App._pmDialogMessages[0].messageId).toBe('message-12');
    expect(App._pmDialogMessages[49].messageId).toBe('message-61');
  });

  test('PM dialog close before the first snapshot invalidates callbacks and clears state', async () => {
    const { App, consoleMock, document, queryController } = loadPmDialogLifecycleHarness();
    const conversationA = App.pmBuildConversationId(PM_MY_UID, PM_PEER_A_UID);

    await App._openPmDialogImpl(PM_PEER_A_UID, { conversationId: conversationA });
    const listener = queryController.listeners[0];
    App._closePmDialog();
    listener.emitMessages([makePmMessage(1)]);
    listener.emitError(new Error('late error'));

    expect(listener.unsubscribe).toHaveBeenCalledTimes(1);
    expect(App._currentPmDialog).toBeNull();
    expect(App._pmDialogMessages).toEqual([]);
    expect(document.getElementById('pm-dialog-overlay').style.display).toBe('none');
    expect(consoleMock.warn).not.toHaveBeenCalled();
  });

  test('PM active listener error before its first snapshot reports load failure', async () => {
    const { App, consoleMock, queryController } = loadPmDialogLifecycleHarness();
    const conversationA = App.pmBuildConversationId(PM_MY_UID, PM_PEER_A_UID);

    await App._openPmDialogImpl(PM_PEER_A_UID, { conversationId: conversationA });
    queryController.listeners[0].emitError(new Error('initial listener failure'));

    expect(consoleMock.warn).toHaveBeenCalledTimes(1);
    expect(App.showToast).toHaveBeenCalledWith('私訊載入失敗');
  });

  test('PM stale listener error before its first snapshot has no UI or log side effect', async () => {
    const { App, consoleMock, queryController } = loadPmDialogLifecycleHarness();
    const conversationA = App.pmBuildConversationId(PM_MY_UID, PM_PEER_A_UID);
    const conversationB = App.pmBuildConversationId(PM_MY_UID, PM_PEER_B_UID);

    await App._openPmDialogImpl(PM_PEER_A_UID, { conversationId: conversationA });
    const staleListener = queryController.listeners[0];
    await App._openPmDialogImpl(PM_PEER_B_UID, { conversationId: conversationB });
    staleListener.emitError(new Error('stale initial failure'));

    expect(consoleMock.warn).not.toHaveBeenCalled();
    expect(App.showToast).not.toHaveBeenCalled();
  });

  test('PM active listener error after a snapshot logs without showing load failure', async () => {
    const { App, consoleMock, queryController } = loadPmDialogLifecycleHarness();
    const conversationA = App.pmBuildConversationId(PM_MY_UID, PM_PEER_A_UID);

    await App._openPmDialogImpl(PM_PEER_A_UID, { conversationId: conversationA });
    const listener = queryController.listeners[0];
    listener.emitMessages([makePmMessage(1)]);
    consoleMock.warn.mockClear();
    App.showToast.mockClear();
    listener.emitError(new Error('listener failed after data'));

    expect(consoleMock.warn).toHaveBeenCalledTimes(1);
    expect(App.showToast).not.toHaveBeenCalled();
  });

  test('PM dialog switch cancels queued reads and keeps unread state server-backed', async () => {
    jest.useFakeTimers();
    try {
      const { App, callables, queryController } = loadPmDialogLifecycleHarness();
      const conversationA = App.pmBuildConversationId(PM_MY_UID, PM_PEER_A_UID);
      const conversationB = App.pmBuildConversationId(PM_MY_UID, PM_PEER_B_UID);
      const markRead = jest.fn(async () => ({ readCount: 1, hasMore: false }));
      callables.markPrivateConversationRead = markRead;
      App._optimisticallyMarkPmConversationRead = jest.fn();

      await App._openPmDialogImpl(PM_PEER_A_UID, { conversationId: conversationA });
      queryController.listeners[0].emitMessages([makePmMessage(1, {
        fromUid: PM_PEER_A_UID,
        toUid: PM_MY_UID,
        direction: 'in',
        read: false,
      })]);
      expect(App._pmDialogMessages[0].read).toBe(false);
      expect(App._optimisticallyMarkPmConversationRead).not.toHaveBeenCalled();

      await App._openPmDialogImpl(PM_PEER_B_UID, { conversationId: conversationB });
      jest.advanceTimersByTime(1000);
      await flushPromises();
      expect(markRead).not.toHaveBeenCalled();
      expect(App._pmReadJobs[conversationA]).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  test('PM all-read snapshot cancels a queued read before debounce', async () => {
    jest.useFakeTimers();
    try {
      const { App, callables, queryController } = loadPmDialogLifecycleHarness();
      const conversationA = App.pmBuildConversationId(PM_MY_UID, PM_PEER_A_UID);
      const markRead = jest.fn(async () => ({ readCount: 1, hasMore: false }));
      callables.markPrivateConversationRead = markRead;
      await App._openPmDialogImpl(PM_PEER_A_UID, { conversationId: conversationA });
      const listener = queryController.listeners[0];
      listener.emitMessages([makePmMessage(1, {
        fromUid: PM_PEER_A_UID,
        toUid: PM_MY_UID,
        direction: 'in',
        read: false,
      })]);
      listener.emitMessages([makePmMessage(1, {
        fromUid: PM_PEER_A_UID,
        toUid: PM_MY_UID,
        direction: 'in',
        read: true,
      })]);

      jest.advanceTimersByTime(1000);
      await flushPromises();
      expect(markRead).not.toHaveBeenCalled();
      expect(App._pmReadJobs[conversationA]).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  test('PM all-read snapshot clears pending validation during an in-flight read', async () => {
    jest.useFakeTimers();
    try {
      const { App, callables, queryController } = loadPmDialogLifecycleHarness();
      const conversationA = App.pmBuildConversationId(PM_MY_UID, PM_PEER_A_UID);
      const readCall = deferred();
      const markRead = jest.fn(() => readCall.promise);
      callables.markPrivateConversationRead = markRead;
      await App._openPmDialogImpl(PM_PEER_A_UID, { conversationId: conversationA });
      const listener = queryController.listeners[0];
      const unread = makePmMessage(1, {
        fromUid: PM_PEER_A_UID,
        toUid: PM_MY_UID,
        direction: 'in',
        read: false,
      });
      listener.emitMessages([unread]);
      jest.advanceTimersByTime(500);
      expect(markRead).toHaveBeenCalledTimes(1);
      listener.emitMessages([unread]);
      expect(App._pmReadJobs[conversationA].pendingRequestSeq).toBe(App._currentPmDialog.requestSeq);
      listener.emitMessages([{ ...unread, read: true }]);
      expect(App._pmReadJobs[conversationA].pendingRequestSeq).toBe(0);

      readCall.resolve({ readCount: 1, hasMore: false });
      await flushPromises();
      jest.advanceTimersByTime(1000);
      await flushPromises();
      expect(markRead).toHaveBeenCalledTimes(1);
      expect(App._pmReadJobs[conversationA]).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  test('PM read validation is debounced, serialized, source-backed, and accepts both result shapes', async () => {
    jest.useFakeTimers();
    try {
      const { App, callables, queryController } = loadPmDialogLifecycleHarness();
      const conversationA = App.pmBuildConversationId(PM_MY_UID, PM_PEER_A_UID);
      const pendingCalls = [];
      let activeCalls = 0;
      let maxActiveCalls = 0;
      const markRead = jest.fn(() => {
        activeCalls += 1;
        maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
        const call = deferred();
        pendingCalls.push({
          resolve(value) {
            activeCalls -= 1;
            call.resolve(value);
          },
          reject(err) {
            activeCalls -= 1;
            call.reject(err);
          },
        });
        return call.promise;
      });
      callables.markPrivateConversationRead = markRead;
      await App._openPmDialogImpl(PM_PEER_A_UID, { conversationId: conversationA });
      const listener = queryController.listeners[0];
      const unread = makePmMessage(1, {
        fromUid: PM_PEER_A_UID,
        toUid: PM_MY_UID,
        direction: 'in',
        read: false,
      });

      listener.emitMessages([unread]);
      listener.emitMessages([unread]);
      listener.emitMessages([unread]);
      jest.advanceTimersByTime(499);
      expect(markRead).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(markRead).toHaveBeenCalledTimes(1);

      listener.emitMessages([unread]);
      listener.emitMessages([unread]);
      expect(markRead).toHaveBeenCalledTimes(1);
      expect(maxActiveCalls).toBe(1);

      pendingCalls[0].resolve({ data: { readCount: 1, hasMore: false } });
      await flushPromises();
      jest.advanceTimersByTime(499);
      expect(markRead).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(1);
      expect(markRead).toHaveBeenCalledTimes(2);
      expect(maxActiveCalls).toBe(1);

      pendingCalls[1].resolve({ readCount: 0, hasMore: false });
      await flushPromises();
      jest.advanceTimersByTime(2000);
      await flushPromises();
      expect(markRead).toHaveBeenCalledTimes(2);
      expect(maxActiveCalls).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('PM read drain paginates only while the server makes progress', async () => {
    jest.useFakeTimers();
    try {
      const { App, callables, consoleMock, queryController } = loadPmDialogLifecycleHarness();
      const conversationA = App.pmBuildConversationId(PM_MY_UID, PM_PEER_A_UID);
      const markRead = jest.fn()
        .mockResolvedValueOnce({ data: { readCount: 50, hasMore: true } })
        .mockResolvedValueOnce({ readCount: 1, hasMore: false });
      callables.markPrivateConversationRead = markRead;
      await App._openPmDialogImpl(PM_PEER_A_UID, { conversationId: conversationA });
      queryController.listeners[0].emitMessages([makePmMessage(1, {
        fromUid: PM_PEER_A_UID,
        toUid: PM_MY_UID,
        direction: 'in',
        read: false,
      })]);

      jest.advanceTimersByTime(500);
      await flushPromises();
      expect(markRead).toHaveBeenCalledTimes(2);
      expect(consoleMock.warn).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1000);
      await flushPromises();
      expect(markRead).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  test('PM read drain stops on hasMore with zero progress and does not self-reschedule', async () => {
    jest.useFakeTimers();
    try {
      const { App, callables, consoleMock, queryController } = loadPmDialogLifecycleHarness();
      const conversationA = App.pmBuildConversationId(PM_MY_UID, PM_PEER_A_UID);
      const markRead = jest.fn(async () => ({ readCount: 0, hasMore: true }));
      callables.markPrivateConversationRead = markRead;
      await App._openPmDialogImpl(PM_PEER_A_UID, { conversationId: conversationA });
      queryController.listeners[0].emitMessages([makePmMessage(1, {
        fromUid: PM_PEER_A_UID,
        toUid: PM_MY_UID,
        direction: 'in',
        read: false,
      })]);

      jest.advanceTimersByTime(500);
      await flushPromises();
      jest.advanceTimersByTime(5000);
      await flushPromises();
      expect(markRead).toHaveBeenCalledTimes(1);
      expect(consoleMock.warn).toHaveBeenCalledWith(expect.stringContaining('no progress'));
    } finally {
      jest.useRealTimers();
    }
  });

  test('PM same-conversation reopen hands an in-flight read to the newest request without overlap', async () => {
    jest.useFakeTimers();
    try {
      const { App, callables, queryController } = loadPmDialogLifecycleHarness();
      const conversationA = App.pmBuildConversationId(PM_MY_UID, PM_PEER_A_UID);
      const calls = [];
      let activeCalls = 0;
      let maxActiveCalls = 0;
      const markRead = jest.fn(() => {
        activeCalls += 1;
        maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
        const call = deferred();
        calls.push({
          resolve(value) {
            activeCalls -= 1;
            call.resolve(value);
          },
        });
        return call.promise;
      });
      callables.markPrivateConversationRead = markRead;
      const unread = makePmMessage(1, {
        fromUid: PM_PEER_A_UID,
        toUid: PM_MY_UID,
        direction: 'in',
        read: false,
      });

      await App._openPmDialogImpl(PM_PEER_A_UID, { conversationId: conversationA });
      queryController.listeners[0].emitMessages([unread]);
      jest.advanceTimersByTime(500);
      expect(markRead).toHaveBeenCalledTimes(1);
      const firstRequestSeq = App._currentPmDialog.requestSeq;

      await App._openPmDialogImpl(PM_PEER_A_UID, { conversationId: conversationA });
      const secondRequestSeq = App._currentPmDialog.requestSeq;
      expect(secondRequestSeq).toBeGreaterThan(firstRequestSeq);
      expect(App._pmReadJobs[conversationA].inFlight).toBe(true);
      queryController.listeners[1].emitMessages([unread]);
      expect(markRead).toHaveBeenCalledTimes(1);

      calls[0].resolve({ readCount: 1, hasMore: false });
      await flushPromises();
      jest.advanceTimersByTime(500);
      expect(markRead).toHaveBeenCalledTimes(2);
      expect(maxActiveCalls).toBe(1);
      calls[1].resolve({ data: { readCount: 0, hasMore: false } });
      await flushPromises();
      jest.advanceTimersByTime(1000);
      expect(markRead).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  test('PM send success settles the original optimistic store without repainting a newer dialog', async () => {
    const { App, callables, document } = loadPmDialogLifecycleHarness();
    const conversationA = App.pmBuildConversationId(PM_MY_UID, PM_PEER_A_UID);
    const conversationB = App.pmBuildConversationId(PM_MY_UID, PM_PEER_B_UID);
    const sendCall = deferred();
    callables.sendPrivateMessage = jest.fn(() => sendCall.promise);

    await App._openPmDialogImpl(PM_PEER_A_UID, { conversationId: conversationA });
    document.querySelector('.pm-dialog-input').value = 'message for A';
    const sendPromise = App.sendPmMessage();
    expect(App._pmOptimisticMessages[conversationA]).toHaveLength(1);

    await App._openPmDialogImpl(PM_PEER_B_UID, { conversationId: conversationB });
    const currentInput = document.querySelector('.pm-dialog-input');
    currentInput.value = 'draft for B';
    sendCall.resolve({ messageId: 'server-message-a' });
    await sendPromise;

    const originalMessage = App._pmOptimisticMessages[conversationA][0];
    expect(originalMessage.status).toBe('sent');
    expect(originalMessage._serverMessageId).toBe('server-message-a');
    expect(currentInput.value).toBe('draft for B');
    expect(document.querySelector('.pm-dialog-messages').textContent).not.toContain('message for A');
    expect(App.showToast).not.toHaveBeenCalled();
  });

  test('PM send success from an older request rerenders a reopened same conversation', async () => {
    const { App, callables, document, queryController } = loadPmDialogLifecycleHarness();
    const conversationA = App.pmBuildConversationId(PM_MY_UID, PM_PEER_A_UID);
    const sendCall = deferred();
    callables.sendPrivateMessage = jest.fn(() => sendCall.promise);

    await App._openPmDialogImpl(PM_PEER_A_UID, { conversationId: conversationA });
    document.querySelector('.pm-dialog-input').value = 'same conversation send';
    const sendPromise = App.sendPmMessage();

    await App._openPmDialogImpl(PM_PEER_A_UID, { conversationId: conversationA });
    queryController.listeners[1].emitMessages([]);
    const reopenedInput = document.querySelector('.pm-dialog-input');
    reopenedInput.value = 'new request draft';
    expect(document.querySelector('.pm-message.is-pending')).not.toBeNull();

    sendCall.resolve({ messageId: 'same-conversation-server-message' });
    await sendPromise;

    expect(App._pmOptimisticMessages[conversationA][0].status).toBe('sent');
    expect(document.querySelector('.pm-message.is-pending')).toBeNull();
    expect(document.querySelector('.pm-dialog-messages').textContent).toContain('same conversation send');
    expect(reopenedInput.value).toBe('new request draft');
    expect(App.showToast).not.toHaveBeenCalled();
  });

  test('PM send failure marks the original optimistic store without refilling or toasting a newer dialog', async () => {
    const { App, callables, document } = loadPmDialogLifecycleHarness();
    const conversationA = App.pmBuildConversationId(PM_MY_UID, PM_PEER_A_UID);
    const conversationB = App.pmBuildConversationId(PM_MY_UID, PM_PEER_B_UID);
    const sendCall = deferred();
    callables.sendPrivateMessage = jest.fn(() => sendCall.promise);

    await App._openPmDialogImpl(PM_PEER_A_UID, { conversationId: conversationA });
    document.querySelector('.pm-dialog-input').value = 'failed message for A';
    const sendPromise = App.sendPmMessage();
    await App._openPmDialogImpl(PM_PEER_B_UID, { conversationId: conversationB });
    const currentInput = document.querySelector('.pm-dialog-input');
    currentInput.value = 'keep B draft';
    sendCall.reject(Object.assign(new Error('rate limited'), { code: 'functions/resource-exhausted' }));
    await sendPromise;

    const originalMessage = App._pmOptimisticMessages[conversationA][0];
    expect(originalMessage.status).toBe('failed');
    expect(originalMessage._optimisticFailed).toBe(true);
    expect(currentInput.value).toBe('keep B draft');
    expect(document.querySelector('.pm-dialog-messages').textContent).not.toContain('failed message for A');
    expect(App.showToast).not.toHaveBeenCalled();
  });

  test('PM send failure rerenders a reopened same conversation without touching its input or toast', async () => {
    const { App, callables, document, queryController } = loadPmDialogLifecycleHarness();
    const conversationA = App.pmBuildConversationId(PM_MY_UID, PM_PEER_A_UID);
    const sendCall = deferred();
    callables.sendPrivateMessage = jest.fn(() => sendCall.promise);

    await App._openPmDialogImpl(PM_PEER_A_UID, { conversationId: conversationA });
    document.querySelector('.pm-dialog-input').value = 'same conversation failure';
    const sendPromise = App.sendPmMessage();

    await App._openPmDialogImpl(PM_PEER_A_UID, { conversationId: conversationA });
    queryController.listeners[1].emitMessages([]);
    const reopenedInput = document.querySelector('.pm-dialog-input');
    reopenedInput.value = 'do not replace this draft';
    sendCall.reject(Object.assign(new Error('rate limited'), { code: 'functions/resource-exhausted' }));
    await sendPromise;

    expect(App._pmOptimisticMessages[conversationA][0].status).toBe('failed');
    expect(document.querySelector('.pm-message.is-failed')).not.toBeNull();
    expect(reopenedInput.value).toBe('do not replace this draft');
    expect(App.showToast).not.toHaveBeenCalled();
  });

  test('PM edit failure clears A pending state without repainting or toasting B', async () => {
    const { App, callables, document, promptMock, queryController } = loadPmDialogLifecycleHarness();
    const conversationA = App.pmBuildConversationId(PM_MY_UID, PM_PEER_A_UID);
    const conversationB = App.pmBuildConversationId(PM_MY_UID, PM_PEER_B_UID);
    const editCall = deferred();
    callables.editPrivateMessage = jest.fn(() => editCall.promise);
    promptMock.mockReturnValue('edited for A');

    await App._openPmDialogImpl(PM_PEER_A_UID, { conversationId: conversationA });
    queryController.listeners[0].emitMessages([makePmMessage(1)]);
    const editPromise = App.editPmMessage('message-1');
    expect(App._pmPendingMessageUpdates[conversationA]['message-1']._pmPendingAction).toBe('editing');

    await App._openPmDialogImpl(PM_PEER_B_UID, { conversationId: conversationB });
    const renderSpy = jest.spyOn(App, '_renderPmDialogMessages');
    renderSpy.mockClear();
    editCall.reject(Object.assign(new Error('already read'), { code: 'functions/failed-precondition' }));
    await editPromise;

    expect(App._pmPendingMessageUpdates[conversationA]).toBeUndefined();
    expect(renderSpy).not.toHaveBeenCalled();
    expect(document.querySelector('.pm-dialog-messages').textContent).not.toContain('edited for A');
    expect(App.showToast).not.toHaveBeenCalled();
  });

  test('PM edit failure rerenders a reopened same conversation without stale toast', async () => {
    const { App, callables, document, promptMock, queryController } = loadPmDialogLifecycleHarness();
    const conversationA = App.pmBuildConversationId(PM_MY_UID, PM_PEER_A_UID);
    const editCall = deferred();
    callables.editPrivateMessage = jest.fn(() => editCall.promise);
    promptMock.mockReturnValue('same conversation edit');

    await App._openPmDialogImpl(PM_PEER_A_UID, { conversationId: conversationA });
    queryController.listeners[0].emitMessages([makePmMessage(1)]);
    const editPromise = App.editPmMessage('message-1');

    await App._openPmDialogImpl(PM_PEER_A_UID, { conversationId: conversationA });
    queryController.listeners[1].emitMessages([makePmMessage(1)]);
    document.querySelector('.pm-dialog-input').value = 'new request draft';
    expect(document.querySelector('.pm-message.is-pending')).not.toBeNull();
    expect(document.querySelector('.pm-dialog-messages').textContent).toContain('same conversation edit');

    editCall.reject(Object.assign(new Error('already read'), { code: 'functions/failed-precondition' }));
    await editPromise;

    expect(App._pmPendingMessageUpdates[conversationA]).toBeUndefined();
    expect(document.querySelector('.pm-message.is-pending')).toBeNull();
    expect(document.querySelector('.pm-dialog-messages').textContent).toContain('message 1');
    expect(document.querySelector('.pm-dialog-input').value).toBe('new request draft');
    expect(App.showToast).not.toHaveBeenCalled();
  });

  test('PM recall failure clears A pending state without repainting or toasting B', async () => {
    const { App, callables, confirmMock, document, queryController } = loadPmDialogLifecycleHarness();
    const conversationA = App.pmBuildConversationId(PM_MY_UID, PM_PEER_A_UID);
    const conversationB = App.pmBuildConversationId(PM_MY_UID, PM_PEER_B_UID);
    const recallCall = deferred();
    callables.recallPrivateMessage = jest.fn(() => recallCall.promise);
    confirmMock.mockReturnValue(true);

    await App._openPmDialogImpl(PM_PEER_A_UID, { conversationId: conversationA });
    queryController.listeners[0].emitMessages([makePmMessage(1)]);
    const recallPromise = App.recallPmMessage('message-1');
    expect(App._pmPendingMessageUpdates[conversationA]['message-1']._pmPendingAction).toBe('recalling');

    await App._openPmDialogImpl(PM_PEER_B_UID, { conversationId: conversationB });
    const renderSpy = jest.spyOn(App, '_renderPmDialogMessages');
    renderSpy.mockClear();
    recallCall.reject(Object.assign(new Error('message changed'), { code: 'functions/failed-precondition' }));
    await recallPromise;

    expect(App._pmPendingMessageUpdates[conversationA]).toBeUndefined();
    expect(renderSpy).not.toHaveBeenCalled();
    expect(document.querySelector('.pm-dialog-messages').textContent).not.toContain('訊息已撤回');
    expect(App.showToast).not.toHaveBeenCalled();
  });

  test('PM recall failure rerenders a reopened same conversation without stale toast', async () => {
    const { App, callables, confirmMock, document, queryController } = loadPmDialogLifecycleHarness();
    const conversationA = App.pmBuildConversationId(PM_MY_UID, PM_PEER_A_UID);
    const recallCall = deferred();
    callables.recallPrivateMessage = jest.fn(() => recallCall.promise);
    confirmMock.mockReturnValue(true);

    await App._openPmDialogImpl(PM_PEER_A_UID, { conversationId: conversationA });
    queryController.listeners[0].emitMessages([makePmMessage(1)]);
    const recallPromise = App.recallPmMessage('message-1');

    await App._openPmDialogImpl(PM_PEER_A_UID, { conversationId: conversationA });
    queryController.listeners[1].emitMessages([makePmMessage(1)]);
    document.querySelector('.pm-dialog-input').value = 'keep reopened draft';
    expect(document.querySelector('.pm-message.is-pending')).not.toBeNull();
    expect(document.querySelector('.pm-dialog-messages').textContent).toContain('訊息已撤回');

    recallCall.reject(Object.assign(new Error('message changed'), { code: 'functions/failed-precondition' }));
    await recallPromise;

    expect(App._pmPendingMessageUpdates[conversationA]).toBeUndefined();
    expect(document.querySelector('.pm-message.is-pending')).toBeNull();
    expect(document.querySelector('.pm-dialog-messages').textContent).toContain('message 1');
    expect(document.querySelector('.pm-dialog-input').value).toBe('keep reopened draft');
    expect(App.showToast).not.toHaveBeenCalled();
  });

  test('PM close during an in-flight read drops pending validation and sends nothing else', async () => {
    jest.useFakeTimers();
    try {
      const { App, callables, queryController } = loadPmDialogLifecycleHarness();
      const conversationA = App.pmBuildConversationId(PM_MY_UID, PM_PEER_A_UID);
      const readCall = deferred();
      const markRead = jest.fn(() => readCall.promise);
      callables.markPrivateConversationRead = markRead;
      const unread = makePmMessage(1, {
        fromUid: PM_PEER_A_UID,
        toUid: PM_MY_UID,
        direction: 'in',
        read: false,
      });

      await App._openPmDialogImpl(PM_PEER_A_UID, { conversationId: conversationA });
      const listener = queryController.listeners[0];
      listener.emitMessages([unread]);
      jest.advanceTimersByTime(500);
      expect(markRead).toHaveBeenCalledTimes(1);
      listener.emitMessages([unread]);
      expect(App._pmReadJobs[conversationA].pendingRequestSeq).toBe(App._currentPmDialog.requestSeq);

      App._closePmDialog();
      expect(App._pmReadJobs[conversationA].pendingRequestSeq).toBe(0);
      readCall.resolve({ data: { readCount: 50, hasMore: true } });
      await flushPromises();
      jest.advanceTimersByTime(2000);
      await flushPromises();
      expect(markRead).toHaveBeenCalledTimes(1);
      expect(App._pmReadJobs[conversationA]).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  test('Firestore rules keep PM writes in Cloud Functions and block audit SDK access', () => {
    const rules = readProjectFile('firestore.rules');

    expect(rules).toContain('match /pmThreads/{threadId}');
    expect(rules).toContain('allow read: if isOwner(userId);');
    expect(rules).toContain('allow create, update, delete: if false;');
    expect(rules).toContain('match /pmAuditLogs/{logId}');
    expect(rules).toContain('match /pmAuditConversations/{conversationId}');
    expect(rules).toContain('allow read, write: if false;');
  });
});
