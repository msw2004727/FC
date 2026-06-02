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

  test('diagnostic package names profile incomplete signup failures directly', () => {
    const App = loadInsights();
    const text = App._buildErrorLogDiagnosticText({
      errorCode: 'functions/failed-precondition',
      errorMessage: 'PROFILE_INCOMPLETE',
      page: 'page-activity-detail',
      context: JSON.stringify({ fn: 'handleSignup', errCode: 'PROFILE_INCOMPLETE', eventId: 'evt1' }),
      uid: 'uidA',
      userName: 'Tester',
      appVersion: '0.test',
      userAgent: 'Mozilla/5.0 (iPhone) Line/14.0.0',
    });

    expect(text).toContain('\u932f\u8aa4\u985e\u578b\uff1a\u500b\u4eba\u8cc7\u6599\u672a\u88dc\u9f4a (PROFILE_INCOMPLETE)');
    expect(text).toContain('\u767d\u8a71\u932f\u8aa4\uff1a\u8acb\u5148\u88dc\u9f4a\u500b\u4eba\u8cc7\u6599');
    expect(text).toContain('\u56b4\u91cd\u5ea6\uff1a\u4e00\u822c');
  });

  test('diagnostic package for user prompts names prompt source and content', () => {
    const App = loadInsights();
    const text = App._buildErrorLogDiagnosticText({
      errorCode: 'user-prompt',
      errorMessage: '\u60a8\u7684\u767b\u5165 session \u5df2\u904e\u671f\u6216\u4e0d\u540c\u6b65',
      page: 'page-profile',
      context: JSON.stringify({
        fn: '_showReLoginPrompt',
        logType: 'user_prompt',
        surface: 'relogin_modal',
        promptKey: 'session_expired',
        promptMessage: '\u60a8\u7684\u767b\u5165 session \u5df2\u904e\u671f\u6216\u4e0d\u540c\u6b65\uff0c\u8acb\u91cd\u65b0\u767b\u5165\u3002',
      }),
      uid: 'uidA',
      userName: 'Tester',
      appVersion: '0.test',
      userAgent: 'Mozilla/5.0 (iPhone) Line/14.0.0',
    });

    expect(text).toContain('ToosterX \u7528\u6236\u63d0\u793a\u8a3a\u65b7\u5305');
    expect(text).toContain('\u63d0\u793a\u4f86\u6e90\uff1a\u91cd\u65b0\u767b\u5165\u5f48\u7a97');
    expect(text).toContain('\u63d0\u793a\u5206\u985e\uff1aSession \u904e\u671f/\u4e0d\u540c\u6b65');
    expect(text).toContain('\u63d0\u793a\u5167\u5bb9\uff1a\u60a8\u7684\u767b\u5165 session');
    expect(text).toContain('uidA');
  });
});
