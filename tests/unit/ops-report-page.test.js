const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('ops report temporary standalone page', () => {
  test('standalone HTML signs in with LIFF and calls admin-only LTV callable', () => {
    const html = read('ops-report.html');

    expect(html).toContain('ToosterX LTV 營運報表');
    expect(html).toContain('DNU');
    expect(html).toContain('DAU');
    expect(html).toContain('WAU');
    expect(html).toContain('MAU');
    expect(html).toContain('怎麼看這份報表');
    expect(html).toContain('DNU｜每日新增用戶');
    expect(html).toContain('DAU｜每日活躍用戶');
    expect(html).toContain('WAU｜近 7 日活躍用戶');
    expect(html).toContain('MAU｜近 30 日活躍用戶');
    expect(html).toContain('先看 DNU');
    expect(html).toContain('再看 DAU / WAU / MAU');
    expect(html).toContain('firebase-functions-compat.js');
    expect(html).toContain('liff.init');
    expect(html).toContain('liff.login');
    expect(html).toContain('createCustomToken');
    expect(html).toContain('getOpsLtvReport');
    expect(html).toContain('僅 admin 以上');
    expect(html).toContain('最多 180 天');
  });

  test('Cloud Function enforces admin role and uses backend aggregation sources', () => {
    const source = read('functions/index.js');

    expect(source).toContain('exports.getOpsLtvReport = onCall');
    expect(source).toContain('getCallerAccessContext(request)');
    expect(source).toContain('ROLE_LEVELS.admin');
    expect(source).toContain('auditLogsByDay');
    expect(source).toContain('login_success');
    expect(source).toContain('usersSnap.size + activePack.auditEntryReads');
    expect(source).toContain('buildOpsLtvReport');
  });

  test('worker and headers expose noindex report path routes without subdomain host routing', () => {
    const worker = read('_worker.js');
    const routes = read('_routes.json');
    const headers = read('_headers');

    expect(worker).not.toContain('ops.toosterx.com');
    expect(worker).not.toContain('OPS_REPORT_HOSTS');
    expect(worker).toContain('/ops-report.html');
    expect(worker).toContain('X-Robots-Tag');
    expect(routes).not.toContain('"/"');
    expect(routes).toContain('"/ops-report"');
    expect(routes).toContain('"/ops-report.html"');
    expect(headers).toContain('/ops-report');
    expect(headers).toContain('noindex, nofollow, noarchive');
  });

  test('admin dashboard exposes a chart shortcut to ops report before changelog', () => {
    const html = read('pages/admin-dashboard.html');
    const reportIndex = html.indexOf('href="/ops-report"');
    const changelogIndex = html.indexOf('href="/changelog/"');

    expect(reportIndex).toBeGreaterThan(-1);
    expect(changelogIndex).toBeGreaterThan(-1);
    expect(reportIndex).toBeLessThan(changelogIndex);
    expect(html).toContain('aria-label="營運報表"');
    expect(html).toContain('M7 15l3.2-3.2 2.8 2.1L18 7');
  });
});
