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
    expect(actions).toContain('_addPmOptimisticMessage');
    expect(actions).toContain('_markPmOptimisticMessage');
    expect(search).toContain('togglePmDialogSearch');
    expect(dialog).toContain('pm-dialog-search-toggle');
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
    expect(css).toContain('.pm-dialog-tools.is-search-open .pm-dialog-search');
  });

  test('PM edit and recall use optimistic pending states with expiry notices', () => {
    const dialog = readProjectFile('js/modules/message/pm-dialog.js');
    const actions = readProjectFile('js/modules/message/pm-dialog-actions.js');

    expect(dialog).toContain('_pmPendingMessageUpdates');
    expect(dialog).toContain('_applyPmPendingMessageUpdates');
    expect(dialog).toContain("_pmPendingAction === 'editing'");
    expect(dialog).toContain("_pmPendingAction === 'recalling'");
    expect(dialog).toContain('\\u7de8\\u8f2f\\u4e2d');
    expect(dialog).toContain('\\u64a4\\u56de\\u4e2d');
    expect(actions).toContain('_showPmMessageWindowExpired');
    expect(actions).toContain('\\u8a0a\\u606f\\u8d85\\u904e 15 \\u5206\\u9418');
    expect(actions).toContain('\\u8a0a\\u606f\\u8d85\\u904e 5 \\u5206\\u9418');
    expect(actions).toContain("status: 'edited'");
    expect(actions).toContain("status: 'recalled'");
  });

  test('PM permission helper validates canonical conversation participants', () => {
    const source = readProjectFile('js/modules/message/pm-permission.js');

    expect(source).toContain('_pmParseConversationId(cId)');
    expect(source).toContain('pmBuildConversationId(uidA, uidB)');
    expect(source).toContain('pmIsValidConversationId(cId, uid)');
    expect(source).toContain('parsed.uidA === safeUid || parsed.uidB === safeUid');
    expect(source).toContain('return fromLevel < toLevel');
  });

  test('backend functions enforce super admin audit and 180-day retention', () => {
    const functions = readProjectFile('functions/index.js');

    expect(functions).toContain('const PM_AUDIT_RETENTION_DAYS = 180');
    expect(functions).toContain('exports.sendPrivateMessage');
    expect(functions).toContain('exports.markPrivateConversationRead');
    expect(functions).toContain('exports.editPrivateMessage');
    expect(functions).toContain('exports.recallPrivateMessage');
    expect(functions).toContain('exports.searchPmAuditUsers');
    expect(functions).toContain('exports.getPmAuditConversation');
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
