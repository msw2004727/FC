const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

describe('history URL writer phase 4/5 contract', () => {
  test('enables list and detail path writes while keeping popstate and LIFF path writes guarded', () => {
    const flagsSource = readProjectFile('js/core/history-route-flags.js');
    const indexSource = readProjectFile('index.html');

    expect(indexSource).toContain('js/core/history-route-flags.js');
    expect(indexSource).not.toContain('js/core/route-flags.js?v=');
    expect(flagsSource).toContain('writeListPaths: true');
    expect(flagsSource).toContain('writeDetailPaths: true');
    expect(flagsSource).toContain('popstateTakeover: false');
    expect(flagsSource).toContain('liffPathDisable: true');
  });

  test('writes clean paths for the three approved list pages before hash fallback', () => {
    const appSource = readProjectFile('app.js');
    const listWriterIndex = appSource.indexOf('flags.writeListPaths');
    const hashFallbackIndex = appSource.indexOf('flags.cleanHashFallbackPath');

    expect(appSource).toContain('_getListRoutePath(pageId)');
    expect(appSource).toContain("'page-activities': '/activities'");
    expect(appSource).toContain("'page-teams': '/teams'");
    expect(appSource).toContain("'page-tournaments': '/tournaments'");
    expect(appSource).not.toContain("'page-profile': '/profile'");
    expect(listWriterIndex).toBeGreaterThan(-1);
    expect(hashFallbackIndex).toBeGreaterThan(-1);
    expect(listWriterIndex).toBeLessThan(hashFallbackIndex);
    expect(appSource).toContain("const state = { source: 'sportshub', pageId }");
    expect(appSource).toContain("history.pushState(state, '', listPath)");
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

  test('detail pages suppress intermediate hash writes and sync URLs after successful entry', () => {
    const eventDetailSource = readProjectFile('js/modules/event/event-detail.js');
    const teamDetailSource = readProjectFile('js/modules/team/team-detail.js');
    const legacyTournamentSource = readProjectFile('js/modules/tournament/tournament-detail.js');
    const friendlyTournamentSource = readProjectFile('js/modules/tournament/tournament-friendly-detail.js');

    expect(eventDetailSource).toContain("showPage('page-activity-detail', { suppressHashSync: true })");
    expect(eventDetailSource).toContain("this._setRouteUrl?.({ pageId: 'page-activity-detail', id }");
    expect(teamDetailSource).toContain("showPage('page-team-detail', { suppressHashSync: true })");
    expect(teamDetailSource).toContain("this._setRouteUrl?.({ pageId: 'page-team-detail', id }");
    expect(legacyTournamentSource).toContain("showPage('page-tournament-detail', { suppressHashSync: true })");
    expect(friendlyTournamentSource).toContain("showPage('page-tournament-detail', { suppressHashSync: true })");
  });

  test('keeps LIFF path writing disabled and popstate takeover deferred', () => {
    const appSource = readProjectFile('app.js');

    expect(appSource).toContain('_shouldDisableHistoryPathWrite(flags)');
    expect(appSource).toContain('window.liff');
    expect(appSource).toContain('window.liff.isInClient()');
    expect(appSource).toContain('flags.writeDetailPaths && !pathWritesDisabled');
    expect(appSource).toContain('flags.writeDetailPaths && !this._shouldDisableHistoryPathWrite?.(flags)');
    expect(appSource).not.toContain("addEventListener('popstate'");
  });
});
