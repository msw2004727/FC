const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', '..');

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function loadAuditLog(document) {
  const App = {
    showToast: jest.fn(),
  };
  const sandbox = {
    App,
    console,
    document,
    navigator: {},
    escapeHTML,
  };
  const code = fs.readFileSync(path.join(ROOT, 'js/modules/audit-log.js'), 'utf8');
  vm.runInNewContext(code, sandbox, { filename: 'js/modules/audit-log.js' });
  return App;
}

function sampleLog(overrides = {}) {
  return {
    _docId: 'audit_doc_1',
    actorUid: 'uid-123',
    actorName: 'Admin Tester',
    action: 'event_cancel_signup',
    result: 'failure',
    source: 'liff',
    targetType: 'event',
    targetId: 'evt-42',
    targetLabel: '春季活動',
    timeKey: '18:13:00',
    meta: {
      eventId: 'evt-42',
      reasonCode: 'permission-denied',
    },
    ...overrides,
  };
}

describe('audit log viewer helpers', () => {
  test('search text includes actor, target, result, source, document id, and meta', () => {
    const App = loadAuditLog();
    const item = App._normalizeAuditLogEntry(sampleLog());
    const text = App._getAuditSearchText(item);

    expect(text).toContain('admin tester');
    expect(text).toContain('uid-123');
    expect(text).toContain('evt-42');
    expect(text).toContain('春季活動');
    expect(text).toContain('line liff');
    expect(text).toContain('失敗');
    expect(text).toContain('audit_doc_1');
    expect(text).toContain('reasoncode=permission-denied');
  });

  test('filterAuditLogs matches target and meta fields, not only actor fields', () => {
    const dom = new JSDOM(`
      <input id="auditlog-search">
      <select id="auditlog-action-filter"></select>
      <input id="auditlog-time-start">
      <input id="auditlog-time-end">
    `);
    const App = loadAuditLog(dom.window.document);
    const targetMatch = App._normalizeAuditLogEntry(sampleLog({ _docId: 'target_match' }));
    const other = App._normalizeAuditLogEntry(sampleLog({
      _docId: 'other',
      actorUid: 'uid-999',
      actorName: 'Other Admin',
      targetId: 'evt-99',
      targetLabel: '其他活動',
      meta: { eventId: 'evt-99' },
    }));
    App._auditLogItems = [targetMatch, other];
    App.renderAuditLogs = jest.fn();
    App._updateAuditBackfillState = jest.fn();
    App._syncAuditFilterSummary = jest.fn();

    dom.window.document.getElementById('auditlog-search').value = 'permission-denied';
    App.filterAuditLogs();

    expect(App.renderAuditLogs).toHaveBeenCalledWith([targetMatch]);
  });

  test('renderAuditLogs shows result, target, source, detail rows, and load-more caveat', () => {
    const dom = new JSDOM(`
      <div id="auditlog-summary"></div>
      <div id="audit-log-list"></div>
    `);
    const App = loadAuditLog(dom.window.document);
    const item = App._normalizeAuditLogEntry(sampleLog());
    App._auditLogItems = [item];
    App._auditLogHasMore = true;

    App.renderAuditLogs([item]);

    const listText = dom.window.document.getElementById('audit-log-list').textContent;
    const summaryText = dom.window.document.getElementById('auditlog-summary').textContent;

    expect(listText).toContain('失敗');
    expect(listText).toContain('春季活動');
    expect(listText).toContain('LINE LIFF');
    expect(listText).toContain('eventId=evt-42');
    expect(listText).toContain('文件 ID');
    expect(listText).toContain('複製診斷包');
    expect(summaryText).toContain('已載入');
    expect(summaryText).toContain('還有更多未載入');
  });

  test('diagnostic text contains human-readable context and technical identifiers', () => {
    const App = loadAuditLog();
    const item = App._normalizeAuditLogEntry(sampleLog());
    const text = App._buildAuditLogDiagnosticText(item);

    expect(text).toContain('ToosterX 稽核日誌診斷包');
    expect(text).toContain('結果：失敗');
    expect(text).toContain('操作者：Admin Tester / uid-123');
    expect(text).toContain('目標：活動：春季活動（evt-42）');
    expect(text).toContain('來源：LINE LIFF (liff)');
    expect(text).toContain('reasonCode=permission-denied');
    expect(text).toContain('文件 ID：audit_doc_1');
  });
});
