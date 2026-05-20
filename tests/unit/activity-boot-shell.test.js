const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function sourceSlice(startToken, endToken) {
  const start = appSource.indexOf(startToken);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = endToken ? appSource.indexOf(endToken, start + startToken.length) : -1;
  return appSource.slice(start, end > start ? end : undefined);
}

describe('activity direct URL boot shell', () => {
  test('prepares clean activity URLs before live data is required', () => {
    const method = sourceSlice('_prepareActivityBootHistoryShell()', '_getBootHistoryRoute()');

    expect(method).toContain("ScriptLoader.ensureForPage('page-activities')");
    expect(method).toContain("this._applyActivityUrlFilters?.({ replace: true })");
    expect(method).toContain('this._finishActivityBootHistoryShellFirstPaint?.()');
    expect(method).not.toContain('ensureCollectionsForPage');
    expect(method).not.toContain('renderActivityList');
  });

  test('mirrors URL filters onto the static activity shell', () => {
    const method = sourceSlice('_applyActivityBootShellFilters', '_finishActivityBootHistoryShellFirstPaint');

    expect(method).toContain("document.getElementById('page-activities')");
    expect(method).toContain("target.querySelectorAll('#activity-tabs .tab')");
    expect(method).toContain("listEl.hidden = filters.tab === 'calendar'");
    expect(method).toContain("calendarEl.hidden = filters.tab !== 'calendar'");
    expect(method).toContain("target.querySelector('#activity-filter-type')");
    expect(method).toContain("target.querySelectorAll('#activity-region-tabs .region-tab')");
    expect(method).toContain("document.querySelectorAll('.sport-picker-item[data-sport]')");
  });

  test('history shell activation is scoped to activities only', () => {
    const method = sourceSlice('_activateBootHistoryShell(pageId', '_isProtectedBootRestoreRoute');

    expect(method).toContain("if (pageId === 'page-activities')");
    expect(method).toContain('this._prepareActivityBootHistoryShell?.()');
  });
});
