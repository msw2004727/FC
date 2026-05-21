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
    expect(html).toContain('參與用戶');
    expect(html).toContain('完成用戶');
    expect(html).toContain('加入後轉化');
    expect(html).toContain('7 日內首報名');
    expect(html).toContain('30 日內完成');
    expect(html).toContain('No-show 風險');
    expect(html).toContain('匯出 CSV');
    expect(html).toContain('複製AI分析提示詞');
    expect(html).toContain('下載AI分析JSON');
    expect(html).toContain('copy-ai-prompt');
    expect(html).toContain('download-ai-json');
    expect(html).toContain('buildAiPackage');
    expect(html).toContain('buildAiPrompt');
    expect(html).toContain('只能使用本提示詞內提供的資料與數值做分析');
    expect(html).toContain('不得引用外部市場資料');
    expect(html).toContain('結構化 AI 分析資料包 JSON');
    expect(html).toContain('完整報表 JSON');
    expect(html).toContain('每日序列 CSV');
    expect(html).toContain('firebase-functions-compat.js');
    expect(html).toContain('liff.init');
    expect(html).toContain('liff.login');
    expect(html).toContain('createCustomToken');
    expect(html).toContain('getOpsLtvReport');
    expect(html).toContain('admin 以上角色');
    expect(html).toContain('最多 180 天');
  });

  test('Cloud Function enforces admin role and uses backend aggregation sources', () => {
    const source = read('functions/index.js');

    expect(source).toContain('exports.getOpsLtvReport = onCall');
    expect(source).toContain('getCallerAccessContext(request)');
    expect(source).toContain('ROLE_LEVELS.admin');
    expect(source).toContain('auditLogsByDay');
    expect(source).toContain('login_success');
    expect(source).toContain('fetchOpsLtvEngagementSources');
    expect(source).toContain('collectionGroup("registrations")');
    expect(source).toContain('collectionGroup("attendanceRecords")');
    expect(source).toContain('registrationReads');
    expect(source).toContain('attendanceReads');
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
