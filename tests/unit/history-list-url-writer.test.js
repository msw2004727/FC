const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

describe('history list URL writer phase 4 contract', () => {
  test('enables only list page path writes by default', () => {
    const flagsSource = readProjectFile('js/core/history-route-flags.js');
    const indexSource = readProjectFile('index.html');

    expect(indexSource).toContain('js/core/history-route-flags.js');
    expect(indexSource).not.toContain('js/core/route-flags.js?v=');
    expect(flagsSource).toContain('writeListPaths: true');
    expect(flagsSource).toContain('writeDetailPaths: false');
    expect(flagsSource).toContain('popstateTakeover: false');
    expect(flagsSource).toContain('liffPathDisable: true');
  });

  test('writes clean paths for the three approved list pages before hash fallback', () => {
    const appSource = readProjectFile('js/core/app-main.js');
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

  test('keeps LIFF path writing disabled and detail writer deferred', () => {
    const appSource = readProjectFile('js/core/app-main.js');

    expect(appSource).toContain('_shouldDisableHistoryPathWrite(flags)');
    expect(appSource).toContain('window.liff');
    expect(appSource).toContain('window.liff.isInClient()');
    expect(appSource).not.toContain('writeDetailPaths &&');
    expect(appSource).not.toContain("addEventListener('popstate'");
  });
});
