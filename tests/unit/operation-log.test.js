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

function sampleLog(overrides = {}) {
  return {
    _docId: 'op_1776960974486_abcd12',
    actorUid: 'uid-123',
    time: '04/29 18:13',
    operator: 'Admin Tester',
    type: 'event_edit',
    typeName: 'Event Edit',
    content: 'Updated event capacity',
    eventId: 'evt-42',
    createdAt: { seconds: 1776967980, nanoseconds: 0 },
    ...overrides,
  };
}

function loadOperationLog(document, operationLogs = []) {
  const App = {
    showToast: jest.fn(),
  };
  const sandbox = {
    App,
    ApiService: {
      getOperationLogs: jest.fn(() => operationLogs),
    },
    ROLES: {},
    console,
    document,
    navigator: {},
    escapeHTML,
  };
  const code = fs.readFileSync(path.join(ROOT, 'js/modules/user-admin/user-admin-exp.js'), 'utf8');
  vm.runInNewContext(code, sandbox, { filename: 'js/modules/user-admin/user-admin-exp.js' });
  return App;
}

describe('operation log viewer helpers', () => {
  test('search text includes actor, type, content, event id, and document id', () => {
    const App = loadOperationLog(undefined, []);
    const text = App._getOperationLogSearchText(sampleLog());

    expect(text).toContain('admin tester');
    expect(text).toContain('uid-123');
    expect(text).toContain('event_edit');
    expect(text).toContain('event edit');
    expect(text).toContain('updated event capacity');
    expect(text).toContain('evt-42');
    expect(text).toContain('op_1776960974486_abcd12');
  });

  test('filterOperationLogs matches event id and document id, not only operator/content', () => {
    const dom = new JSDOM(`
      <input id="oplog-search">
      <select id="oplog-type-filter"></select>
    `);
    const target = sampleLog();
    const other = sampleLog({
      _docId: 'op_other',
      actorUid: 'uid-999',
      operator: 'Other Admin',
      content: 'Changed banner',
      eventId: 'evt-99',
    });
    const App = loadOperationLog(dom.window.document, [target, other]);
    App.renderOperationLogs = jest.fn();

    dom.window.document.getElementById('oplog-search').value = 'evt-42';
    App.filterOperationLogs();

    expect(App.renderOperationLogs).toHaveBeenCalledWith([target], 1);
  });

  test('renderOperationLogs shows metadata, details, and copy package action', () => {
    const dom = new JSDOM('<div id="operation-log-list"></div>');
    const App = loadOperationLog(dom.window.document, [sampleLog()]);

    App.renderOperationLogs([sampleLog()], 1);

    const text = dom.window.document.getElementById('operation-log-list').textContent;
    expect(text).toContain('Event Edit');
    expect(text).toContain('Admin Tester');
    expect(text).toContain('uid-123');
    expect(text).toContain('event_edit');
    expect(text).toContain('evt-42');
    expect(text).toContain('op_1776960974486_abcd12');
    expect(text).toContain('Updated event capacity');
  });

  test('diagnostic text includes enough context to inspect the operation', () => {
    const App = loadOperationLog(undefined, []);
    const text = App._buildOperationLogDiagnosticText(sampleLog());

    expect(text).toContain('ToosterX');
    expect(text).toContain('Event Edit (event_edit)');
    expect(text).toContain('Admin Tester / uid-123');
    expect(text).toContain('Updated event capacity');
    expect(text).toContain('evt-42');
    expect(text).toContain('op_1776960974486_abcd12');
  });
});
