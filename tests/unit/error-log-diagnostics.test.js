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

  test('classifies Firestore IndexedDB transaction failures as low-noise transient errors', () => {
    const App = loadDiagnostics();
    const log = {
      errorCode: '',
      errorMessage: 'Attempt to get records from database without an in-progress transaction',
    };

    expect(App._getErrorSeverity(log)).toMatchObject({ key: 'info', label: '\u4f4e' });
    expect(App._getErrorCodeLabel('firestore-indexeddb-transient')).toContain('\u672c\u5730\u5feb\u53d6');
    expect(App._getErrorChineseMessage(log)).toContain('LINE');
    expect(App._getErrorChineseMessage(log)).toContain('\u4e0d\u4ee3\u8868\u8cc7\u6599\u58de\u6389');
  });

  test('recognizes callable profile incomplete failures as normal user-action diagnostics', () => {
    const App = loadDiagnostics();
    const log = {
      errorCode: 'functions/failed-precondition',
      errorMessage: 'PROFILE_INCOMPLETE',
      context: JSON.stringify({ fn: 'handleSignup', errCode: 'PROFILE_INCOMPLETE' }),
    };

    expect(App._normalizeErrorCode(log.errorCode)).toBe('failed-precondition');
    expect(App._getErrorSeverity(log)).toMatchObject({ key: 'info', label: '\u4e00\u822c' });
    expect(App._getErrorDisplayCode(log)).toBe('PROFILE_INCOMPLETE');
    expect(App._getErrorDisplayCodeLabel(log)).toBe('\u500b\u4eba\u8cc7\u6599\u672a\u88dc\u9f4a');
    expect(App._getErrorChineseMessage(log)).toContain('\u8acb\u5148\u88dc\u9f4a\u500b\u4eba\u8cc7\u6599');
  });

  test('recognizes user-facing prompt logs and exposes prompt metadata', () => {
    const App = loadDiagnostics();
    const log = {
      errorCode: 'user-prompt',
      errorMessage: '\u60a8\u7684\u767b\u5165 session \u5df2\u904e\u671f\u6216\u4e0d\u540c\u6b65',
      context: JSON.stringify({
        logType: 'user_prompt',
        surface: 'relogin_modal',
        promptKey: 'session_expired',
        promptMessage: '\u60a8\u7684\u767b\u5165 session \u5df2\u904e\u671f\u6216\u4e0d\u540c\u6b65\uff0c\u8acb\u91cd\u65b0\u767b\u5165\u3002',
      }),
    };

    expect(App._isUserPromptLog(log)).toBe(true);
    expect(App._getErrorSeverity(log)).toMatchObject({ key: 'warn', label: '\u63d0\u793a' });
    expect(App._getErrorDisplayCode(log)).toBe('USER_PROMPT');
    expect(App._getErrorDisplayCodeLabel(log)).toBe('\u7528\u6236\u63d0\u793a');
    expect(App._getUserPromptSurfaceInfo(log).label).toBe('\u91cd\u65b0\u767b\u5165\u5f48\u7a97');
    expect(App._getUserPromptKeyLabel(log)).toBe('Session \u904e\u671f/\u4e0d\u540c\u6b65');
    expect(App._getErrorChineseMessage(log)).toContain('session');
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
