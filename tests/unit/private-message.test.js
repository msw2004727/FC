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
