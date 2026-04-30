const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');

function loadInsights() {
  const App = {
    _formatDateTime(date) {
      return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    },
  };
  const sandbox = {
    App,
    console,
    escapeHTML(value) {
      return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }[ch]));
    },
  };
  ['js/modules/error-log-diagnostics.js', 'js/modules/error-log-insights.js'].forEach(relPath => {
    const code = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
    vm.runInNewContext(code, sandbox, { filename: relPath });
  });
  return App;
}

describe('error-log insights helpers', () => {
  test('groups same error by severity, code, page, function, and friendly message', () => {
    const App = loadInsights();
    const logs = [
      { errorCode: 'permission-denied', errorMessage: 'Missing or insufficient permissions.', page: 'page-admin', context: JSON.stringify({ fn: 'saveTeam' }), uid: 'u1', appVersion: 'v1' },
      { errorCode: 'permission-denied', errorMessage: 'Missing or insufficient permissions.', page: 'page-admin', context: JSON.stringify({ fn: 'saveTeam' }), uid: 'u2', appVersion: 'v1' },
      { errorCode: 'not-found', errorMessage: 'No document to update', page: 'page-shop', context: JSON.stringify({ fn: 'saveItem' }), uid: 'u1' },
    ];
    const groups = App._getErrorLogGroups(logs);

    expect(groups).toHaveLength(2);
    expect(groups[0].logs).toHaveLength(2);
    expect(groups[0].users.size).toBe(2);
    expect(groups[0].codeLabel).toBe('\u6b0a\u9650\u4e0d\u8db3');
  });

  test('builds trend rows for the last seven days', () => {
    const App = loadInsights();
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const trend = App._getErrorLogTrend([{ clientTimeIso: now.toISOString(), errorCode: 'internal' }]);

    expect(trend).toHaveLength(7);
    expect(trend[6]).toMatchObject({ key: todayKey, count: 1, critical: 1 });
  });

  test('diagnostic package includes plain-language summary and technical context', () => {
    const App = loadInsights();
    const text = App._buildErrorLogDiagnosticText({
      errorCode: 'deadline-exceeded',
      errorMessage: 'request timed out',
      page: 'page-scan',
      context: JSON.stringify({ fn: 'scanWrite', eventId: 'evt1' }),
      uid: 'uidA',
      userName: 'Tester',
      appVersion: '0.test',
      userAgent: 'Mozilla/5.0 (iPhone) Line/14.0.0',
    });

    expect(text).toContain('ToosterX');
    expect(text).toContain('\u9023\u7dda\u903e\u6642');
    expect(text).toContain('scanWrite');
    expect(text).toContain('evt1');
    expect(text).toContain('uidA');
  });
});
