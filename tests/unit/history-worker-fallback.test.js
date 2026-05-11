const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

describe('history route hosting fallback contract', () => {
  test('Cloudflare worker preserves OG routes before SPA fallback', () => {
    const source = readProjectFile('_worker.js');

    expect(source.indexOf('isTeamSharePath(url.pathname)')).toBeLessThan(source.indexOf('getSpaRouteKind(url.pathname)'));
    expect(source.indexOf('isEventSharePath(url.pathname)')).toBeLessThan(source.indexOf('getSpaRouteKind(url.pathname)'));
    expect(source).toContain('LIST_SPA_PATHS');
    expect(source).toContain('DETAIL_SPA_ROOTS');
    // Phase 5.5 (2026-05-11): noindex 暫時保護已移除，detail SPA path 改由動態 canonical 統一
    expect(source).not.toContain('X-Robots-Tag", "noindex, nofollow"');
    expect(source).toContain('new URL("https://assets.local/")');
    expect(source).toContain('assetUrl.pathname = incoming.pathname === "/" ? "/index.html" : incoming.pathname');
    expect(source).toContain('assetUrl.search = ""');
  });

  test('_routes.json includes first-round clean paths and keeps users path out', () => {
    const routes = JSON.parse(readProjectFile('_routes.json'));

    expect(routes.include).toEqual(expect.arrayContaining([
      '/event-share/*',
      '/team-share/*',
      '/activities',
      '/teams',
      '/tournaments',
      '/profile',
      '/events/*',
      '/teams/*',
      '/tournaments/*',
    ]));
    expect(routes.include).not.toContain('/users/*');
    expect(routes.exclude).toEqual(expect.arrayContaining([
      '/app.js',
      '/js/*',
    ]));

    const indexSource = readProjectFile('index.html');
    expect(indexSource).toContain('<base href="/">');
    expect(indexSource).toContain('id="app-inline-runtime"');
    expect(indexSource).not.toContain('js/core/runtime-controller.js');
    expect(indexSource).not.toContain('src="app.js?v=');
  });

  test('inline runtime mirrors app.js so production does not fetch the failing app asset', () => {
    const indexSource = readProjectFile('index.html');
    const appSource = readProjectFile('app.js').trim();
    const match = indexSource.match(/<script id="app-inline-runtime">\n([\s\S]*?)\n  <\/script>/);

    expect(match).toBeTruthy();
    expect(match[1].trim()).toBe(appSource);
  });

  test('service worker normalizes SPA navigate cache to index instead of every clean path', () => {
    const source = readProjectFile('sw.js');

    expect(source).toContain('isSpaNavigationPath(url.pathname)');
    expect(source).toContain('getIndexCacheRequest(url)');
    expect(source).toContain('cache.put(cacheRequest, clone)');
    expect(source).not.toContain('cache.put(event.request, clone));\n        }\n        return response;\n      }).catch(() => caches.match(event.request, { ignoreSearch: true }))');
  });
});
