const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');

function loadDiagnostics() {
  const App = {
    _formatDateTime(date) {
      return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    },
  };
  const code = fs.readFileSync(path.join(ROOT, 'js/modules/error-log-diagnostics.js'), 'utf-8');
  vm.runInNewContext(code, { App, console }, { filename: 'error-log-diagnostics.js' });
  return App;
}

describe('error-log-diagnostics helpers', () => {
  test('maps permission errors to friendly admin-readable copy', () => {
    const App = loadDiagnostics();
    const msg = App._getErrorChineseMessage({
      errorCode: 'permission-denied',
      errorMessage: 'Missing or insufficient permissions.',
    });
    expect(msg).toContain('\u6b0a\u9650\u4e0d\u8db3');
    expect(msg).toContain('\u7cfb\u7d71\u62d2\u7d55');
  });

  test('classifies timeout/network errors as warning severity', () => {
    const App = loadDiagnostics();
    const severity = App._getErrorSeverity({
      errorCode: 'deadline-exceeded',
      errorMessage: 'request timed out',
    });
    expect(severity).toMatchObject({ key: 'warn', label: '\u8b66\u544a' });
  });

  test('parses browser, os, and device type from LINE iOS user agent', () => {
    const App = loadDiagnostics();
    const info = App._getErrorDeviceInfo('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Line/14.0.0');
    expect(info).toMatchObject({ osName: 'iOS', browserName: 'LINE', deviceType: 'mobile' });
  });

  test('sort timestamp prefers createdAt and falls back to legacy time string', () => {
    const App = loadDiagnostics();
    expect(App._getErrorTimestampMs({ createdAt: { seconds: 10, nanoseconds: 500000000 } })).toBe(10500);
    expect(App._getErrorTimestampMs({ time: '2026/04/30 09:08' })).toBe(new Date(2026, 3, 30, 9, 8).getTime());
  });

  test('search text includes uid, page, function context, friendly message, and stack', () => {
    const App = loadDiagnostics();
    const text = App._getErrorSearchText({
      uid: 'uidA',
      page: 'page-admin-logs',
      context: JSON.stringify({ fn: 'handleSave', eventId: 'evt1' }),
      errorCode: 'not-found',
      errorStack: 'stack line',
    });
    expect(text).toContain('uida');
    expect(text).toContain('page-admin-logs');
    expect(text).toContain('handlesave');
    expect(text).toContain('evt1');
    expect(text).toContain('stack line');
  });
});
