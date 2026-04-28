const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

describe('boot hash navigation acceleration contract', () => {
  test('app primes public hash routes before PageLoader boot work', () => {
    const source = readProjectFile('app.js');

    expect(source).toContain('_primeBootHashRoute()');
    expect(source).toContain('App._primeBootHashRoute?.();');
    expect(source).toContain("_bootHashTargetPageId");
    expect(source).toContain("['page-activities', 'page-teams', 'page-tournaments']");
  });

  test('PageLoader prioritizes hash target files and ensurePage waits only for the target boot file', () => {
    const source = readProjectFile('js/core/page-loader.js');

    expect(source).toContain('_getBootPriorityFile()');
    expect(source).toContain('App._resolveBootPageId(hashPage)');
    expect(source).toContain('await this._ensureBootFile(fileName,');
    expect(source).not.toContain('await this.loadAll();\n      if (this._loaded[fileName]) return;\n    }\n\n    if (this._bootPages.includes(fileName))');
  });

  test('activities can activate shell before cloud during boot or cold cache navigation', () => {
    const source = readProjectFile('js/core/navigation.js');

    expect(source).toContain("pageId === 'page-tournaments'");
    expect(source).toContain("|| pageId === 'page-activities'");
  });

  test('tournament detail refresh keeps an explicit tournament route id', () => {
    const appSource = readProjectFile('app.js');
    const navSource = readProjectFile('js/core/navigation.js');
    const legacyDetailSource = readProjectFile('js/modules/tournament/tournament-detail.js');
    const friendlyDetailSource = readProjectFile('js/modules/tournament/tournament-friendly-detail.js');

    expect(appSource).toContain("'page-tournament-detail': 'page-tournaments'");
    expect(appSource).toContain('_syncTournamentDetailRoute(tournamentId)');
    expect(appSource).toContain("url.searchParams.set('tournament', id)");
    expect(appSource).toContain('_shouldPreserveDeepLinkQueryParam(key)');
    expect(navSource).toContain("pageId !== 'page-tournament-detail'");
    expect(navSource).toContain('this._clearTournamentDetailRouteParam?.()');
    expect(legacyDetailSource).toContain('this._syncTournamentDetailRoute?.(id)');
    expect(friendlyDetailSource).toContain('this._syncTournamentDetailRoute?.(id)');
  });

  test('boot overlay no longer enforces the previous 2500ms minimum', () => {
    const appSource = readProjectFile('app.js');
    const tunablesSource = readProjectFile('docs/tunables.md');

    expect(appSource).toContain('var MIN_VISIBLE_MS = 0;');
    expect(tunablesSource).toContain('| **MIN_VISIBLE_MS** | `0` ms |');
    expect(tunablesSource).toContain('hash reload 改由 early boot route + PageLoader priority');
  });
});
