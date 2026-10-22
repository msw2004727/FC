/** @jest-environment jsdom */

/**
 * SPA 頁面片段 /pages/* 的索引控制契約（2026-10-20）
 *
 * 片段會被 PageLoader 插進 #main-content／#modal-container，片段內的 robots meta
 * 會混進整頁主體；robots.txt 封鎖 /pages/ 又讓 Googlebot 渲染時抓不到片段。
 * 改為：片段不放 meta、robots.txt 不封鎖、/pages/* 由 X-Robots-Tag 防止單獨收錄，
 * PageLoader 插入前再剝一次 robots meta。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

const pageLoaderSource = read('js/core/page-loader.js');

function createLoader(fragmentByName) {
  document.body.innerHTML = '<main id="main-content"></main><div id="modal-container"></div>';
  sessionStorage.clear();
  const fetchImpl = jest.fn(async url => {
    const match = String(url).match(/pages\/([^?]+)\.html/);
    const name = match ? match[1] : '';
    return { ok: true, status: 200, text: async () => fragmentByName[name] || '' };
  });
  const app = {
    _bindPageElements: jest.fn(),
    _activateBootHashShell: jest.fn(),
    _activateBootHistoryShell: jest.fn(),
    _resolveBootPageId: pageId => pageId,
  };
  const factory = new Function(
    'document', 'window', 'location', 'sessionStorage', 'fetch', 'AbortController', 'CACHE_VERSION', 'App',
    `${pageLoaderSource}; return PageLoader;`,
  );
  return factory(document, window, window.location, sessionStorage, fetchImpl, AbortController, 'test-version', app);
}

describe('pages/* fragments robots contract', () => {
  const fragments = fs.readdirSync(path.join(ROOT, 'pages')).filter(name => name.endsWith('.html'));

  test('fragments exist', () => {
    expect(fragments.length).toBeGreaterThan(0);
  });

  test.each(fragments)('pages/%s has no robots meta', name => {
    expect(read(`pages/${name}`)).not.toMatch(/<meta\b[^>]*\bname\s*=\s*["']?robots/i);
  });

  test('robots.txt does not block /pages/ for any user agent', () => {
    const lines = read('robots.txt').split(/\r?\n/).map(line => line.trim());
    expect(lines.filter(line => /^Disallow:\s*\/pages\b/i.test(line))).toEqual([]);
  });

  test('_headers marks /pages/* noindex via X-Robots-Tag', () => {
    const source = read('_headers').replace(/\r\n/g, '\n');
    const routeStart = source.indexOf('/pages/*\n');
    const nextRoute = source.indexOf('\n/', routeStart + '/pages/*'.length);
    const block = source.slice(routeStart, nextRoute === -1 ? source.length : nextRoute);
    expect(routeStart).toBeGreaterThanOrEqual(0);
    expect(block).toMatch(/^\s*X-Robots-Tag:\s*noindex\b/m);
  });
});

describe('PageLoader strips robots meta before inserting fragments', () => {
  test('_stripRobotsMeta removes robots meta variants and keeps other markup', () => {
    const loader = createLoader({});
    const html = [
      '<meta name="robots" content="noindex, nofollow">',
      "<meta name='ROBOTS' content='noindex'/>",
      '<meta content="noindex" name=robots>',
      '<meta name="robots-extra" content="keep">',
      '<meta name="description" content="keep">',
      '<section id="page-x">內容</section>',
    ].join('\n');
    const out = loader._stripRobotsMeta(html);
    expect(out).not.toMatch(/name\s*=\s*["']?robots["'\s>]/i);
    expect(out).toContain('<meta name="robots-extra" content="keep">');
    expect(out).toContain('<meta name="description" content="keep">');
    expect(out).toContain('<section id="page-x">內容</section>');
  });

  test('boot and lazy loads never put robots meta into main or modal containers', async () => {
    const meta = '<meta name="robots" content="noindex, nofollow">\n';
    const loader = createLoader({
      home: `${meta}<section class="page active" id="page-home">home</section>`,
      modals: `${meta}<div id="test-modal"></div>`,
      activity: `${meta}<section class="page" id="page-activities">list</section>`,
    });
    window.requestIdleCallback = jest.fn();

    await loader.loadAll();
    await loader._loadSingleFile('activity');

    expect(document.querySelectorAll('meta[name="robots"]').length).toBe(0);
    expect(document.getElementById('page-home')).not.toBeNull();
    expect(document.getElementById('test-modal')).not.toBeNull();
    expect(document.getElementById('page-activities')).not.toBeNull();
  });
});
