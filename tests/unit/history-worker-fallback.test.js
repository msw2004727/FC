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
    expect(source).toContain('X-Robots-Tag", "noindex, nofollow"');
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
  });

  test('service worker normalizes SPA navigate cache to index instead of every clean path', () => {
    const source = readProjectFile('sw.js');

    expect(source).toContain('isSpaNavigationPath(url.pathname)');
    expect(source).toContain('getIndexCacheRequest(url)');
    expect(source).toContain('cache.put(cacheRequest, clone)');
    expect(source).not.toContain('cache.put(event.request, clone));\n        }\n        return response;\n      }).catch(() => caches.match(event.request, { ignoreSearch: true }))');
  });
});
