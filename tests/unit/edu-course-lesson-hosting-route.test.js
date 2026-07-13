const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function loadWorkerRouteClassifier() {
  const source = read('_worker.js').replace('export default {', 'const __workerDefault = {');
  // eslint-disable-next-line no-new-func
  return new Function(source + '\nreturn getSpaRouteKind;')();
}

function loadWorkerRuntime() {
  const source = read('_worker.js').replace('export default {', 'const __workerDefault = {');
  // eslint-disable-next-line no-new-func
  return new Function(source + '\nreturn __workerDefault;')();
}


function loadServiceWorkerRouteClassifier() {
  const source = read('sw.js');
  const listenerIndex = source.indexOf("self.addEventListener('install'");
  if (listenerIndex < 0) throw new Error('Service worker install listener not found');
  // eslint-disable-next-line no-new-func
  return new Function(source.slice(0, listenerIndex) + '\nreturn isSpaNavigationPath;')();
}

function runGithub404Route(pathname, search = '', hash = '') {
  const source = read('404.html');
  const script = Array.from(source.matchAll(/<script>([\s\S]*?)<\/script>/g))
    .map(match => match[1])
    .find(body => body.includes('cleanPathPatterns'));
  if (!script) throw new Error('404 route redirect script not found');
  const replace = jest.fn();
  const windowLike = { location: { pathname, search, hash, replace } };
  // eslint-disable-next-line no-new-func
  new Function('window', script)(windowLike);
  return replace;
}

describe('course lesson hosting route contract', () => {
  const canonical = '/teams/teamA/courses/planA/lessons/sessionA';

  test('Cloudflare worker classifies only complete safe lesson paths as SPA routes', () => {
    const classify = loadWorkerRouteClassifier();

    expect(classify(canonical)).toBe('courseLesson');
    expect(classify(canonical + '/')).toBe('courseLesson');
    expect(classify('/teams/teamA/courses/planA/lessons')).toBe('');
    expect(classify(canonical + '/more')).toBe('');
    expect(classify('/teams/teamA/courses/plan%2Fbad/lessons/sessionA')).toBe('');
  });

  test('Cloudflare worker fetches index.html from the asset binding for lesson paths', async () => {
    const worker = loadWorkerRuntime();
    const assetsFetch = jest.fn(async () => new Response('<!doctype html><title>ToosterX</title>', {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }));

    const response = await worker.fetch(
      new Request('https://toosterx.com' + canonical + '?courseTab=active'),
      { ASSETS: { fetch: assetsFetch } },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
    expect(assetsFetch).toHaveBeenCalledTimes(1);
    const assetRequest = assetsFetch.mock.calls[0][0];
    expect(new URL(assetRequest.url).pathname).toBe('/index.html');
    expect(new URL(assetRequest.url).search).toBe('');
  });

  test('service worker normalizes only complete safe lesson navigation paths', () => {
    const classify = loadServiceWorkerRouteClassifier();

    expect(classify(canonical)).toBe(true);
    expect(classify(canonical + '/')).toBe(true);
    expect(classify('/teams/teamA/courses/planA/lessons')).toBe(false);
    expect(classify(canonical + '/more')).toBe(false);
    expect(classify('/teams/teamA/courses/planA/lessons/session%5Cbad')).toBe(false);
  });

  test('GitHub 404 restores canonical lesson paths and rejects malformed variants', () => {
    const replace = runGithub404Route(canonical, '?courseTab=ended', '#lesson');
    expect(replace).toHaveBeenCalledWith(
      '/?_spa_redirect=' + encodeURIComponent(canonical + '?courseTab=ended#lesson')
    );

    expect(runGithub404Route('/teams/teamA/courses/planA/lessons')).not.toHaveBeenCalled();
    expect(runGithub404Route(canonical + '/more')).not.toHaveBeenCalled();
    expect(runGithub404Route('/teams/teamA/courses/plan%2Fbad/lessons/sessionA')).not.toHaveBeenCalled();
  });
});
