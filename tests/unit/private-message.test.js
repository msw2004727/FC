const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
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
    expect(dialog).toContain('PM_MAX_BODY_LENGTH || 300');
    expect(actions).toContain('_addPmOptimisticMessage');
    expect(actions).toContain('_markPmOptimisticMessage');
    expect(actions).toContain('PM_MAX_BODY_LENGTH || 300');
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
    expect(css).toContain('height:var(--pm-vv-height, 100vh)');
    expect(css).toContain('.pm-dialog-overlay.is-keyboard-open');
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

  test('PM audit exposes a super-admin switch for user-to-user private messaging', () => {
    const audit = readProjectFile('js/modules/message/pm-audit.js');

    expect(audit).toContain('User互相私訊');
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
    expect(readProjectFile('js/modules/message/pm-dialog.js')).toContain('this._optimisticallyMarkPmConversationRead?.(conversationId)');
    expect(layoutCss).toContain('.pm-notif-hint');
    expect(layoutCss).toContain('#notif-btn.has-pm-unread .pm-notif-hint');
    expect(messageCss).toContain('#msg-inbox-tabs .tab[data-msgtype="pm-conversation"].has-pm-unread::after');
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
    expect(source).toContain("normalizedFromRole === 'user' && normalizedToRole === 'user'");
    expect(source).toContain('return fromLevel < toLevel');
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
    expect(functions).toContain('normalizedFromRole === "user" && normalizedToRole === "user"');
    expect(functions).toContain('exports.searchPmAuditUsers');
    expect(functions).toContain('exports.getPmAuditConversation');
    expect(functions).toContain('exports.getPmAuditLogs');
    expect(functions).toContain('limit + 1');
    expect(functions).toContain('nextCursor');
    expect(functions).toContain('exports.cleanupPmAuditRetention');
    expect(functions).toContain('if (!access.isSuperAdmin) throw new HttpsError("permission-denied", "super_admin only")');
    expect(functions).toContain('retentionDeleteAfter: pmRetentionTimestamp(now)');
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
