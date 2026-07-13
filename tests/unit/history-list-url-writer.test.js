const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

describe('history URL writer phase 4/5/6 contract', () => {
  test('enables list / detail / popstate path writes while keeping LIFF path writes guarded', () => {
    const flagsSource = readProjectFile('js/core/history-route-flags.js');
    const indexSource = readProjectFile('index.html');

    expect(indexSource).toContain('js/core/history-route-flags.js');
    expect(indexSource).not.toContain('js/core/route-flags.js?v=');
    expect(flagsSource).toContain('writeListPaths: true');
    expect(flagsSource).toContain('writeDetailPaths: true');
    // Phase 6 啟用後 popstateTakeover 改為 true
    expect(flagsSource).toContain('popstateTakeover: true');
    expect(flagsSource).toContain('liffPathDisable: true');
  });

  test('writes clean paths for approved list pages before hash fallback', () => {
    const appSource = readProjectFile('app.js');
    const listWriterIndex = appSource.indexOf('flags.writeListPaths');
    const hashFallbackIndex = appSource.indexOf('flags.cleanHashFallbackPath');

    expect(appSource).toContain('_getListRoutePath(pageId)');
    // 2026-05-11 補:V5 §6 規劃 / 與 /profile 也用 clean URL,Phase 4 漏,本次補上
    expect(appSource).toContain("'page-home':       '/'");
    expect(appSource).toContain("'page-activities': '/activities'");
    expect(appSource).toContain("'page-teams':      '/teams'");
    expect(appSource).toContain("'page-tournaments': '/tournaments'");
    expect(appSource).toContain("'page-profile':    '/profile'");
    expect(listWriterIndex).toBeGreaterThan(-1);
    expect(hashFallbackIndex).toBeGreaterThan(-1);
    expect(listWriterIndex).toBeLessThan(hashFallbackIndex);
    expect(appSource).toContain('_getActivityListRoutePath(listPath)');
    expect(appSource).toContain('_captureBootActivityFilterSearch');
    expect(appSource).toContain("const state = { source: 'sportshub', pageId }");
    expect(appSource).toContain("history.pushState(state, '', listTargetPath)");
  });

  test('writes clean paths for approved detail pages only after an explicit detail id is provided', () => {
    const appSource = readProjectFile('app.js');
    const detailWriterIndex = appSource.indexOf('flags.writeDetailPaths');
    const hashFallbackIndex = appSource.indexOf('flags.cleanHashFallbackPath');

    expect(appSource).toContain('_getExplicitDetailRouteId(routeOrPageId)');
    expect(appSource).toContain('_getDetailRoutePath(pageId, id)');
    expect(appSource).toContain("'page-activity-detail': '/events'");
    expect(appSource).toContain("'page-team-detail': '/teams'");
    expect(appSource).toContain("'page-tournament-detail': '/tournaments'");
    expect(appSource).toContain('HistoryRouteAdapter.isSafeRouteSegment(value)');
    expect(appSource).toContain('encodeURIComponent(safeId)');
    expect(appSource).toContain('const state = { source: \'sportshub\', pageId, id: detailId }');
    expect(appSource).toContain("history.pushState(state, '', detailPath)");
    expect(detailWriterIndex).toBeGreaterThan(-1);
    expect(hashFallbackIndex).toBeGreaterThan(-1);
    expect(detailWriterIndex).toBeLessThan(hashFallbackIndex);
  });

  test('detail pages suppress intermediate hash writes and forward popstate options', () => {
    const eventDetailSource = readProjectFile('js/modules/event/event-detail.js');
    const teamDetailSource = readProjectFile('js/modules/team/team-detail.js');
    const legacyTournamentSource = readProjectFile('js/modules/tournament/tournament-detail.js');
    const friendlyTournamentSource = readProjectFile('js/modules/tournament/tournament-friendly-detail.js');

    // Phase 6 Commit A:detail handler 已擴展接受 popstate options
    for (const src of [eventDetailSource, teamDetailSource, legacyTournamentSource, friendlyTournamentSource]) {
      expect(src).toMatch(/suppressHashSync:\s*true/);
      expect(src).toMatch(/bypassPageLock:\s*options\?\.bypassPageLock/);
      expect(src).toMatch(/skipPageHistory:\s*options\?\.skipPageHistory/);
    }
    expect(eventDetailSource).toContain("this._setRouteUrl?.({ pageId: 'page-activity-detail', id }");
    expect(teamDetailSource).toContain("this._setRouteUrl?.({ pageId: 'page-team-detail', id }");
    expect(teamDetailSource).toMatch(/_primeEduCoursePlanShareIntent\?\.\(id,\s*\{\s*\.\.\.options,\s*_navigationTransitionSeq:\s*routeTransitionSeq/);
  });

  test('LIFF path writing remains disabled; popstate takeover is now enabled (Phase 6)', () => {
    const appSource = readProjectFile('app.js');

    expect(appSource).toContain('_shouldDisableHistoryPathWrite(flags)');
    expect(appSource).toContain('window.liff');
    expect(appSource).toContain('window.liff.isInClient()');
    expect(appSource).toContain('flags.writeDetailPaths && !pathWritesDisabled');
    expect(appSource).toContain('flags.writeDetailPaths && !this._shouldDisableHistoryPathWrite?.(flags)');
    // Phase 6 啟用後 popstate handler 已存在
    expect(appSource).toContain("addEventListener('popstate'");
  });
});
