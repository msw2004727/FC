/** @jest-environment node */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const PRIVATE_PREFIXES = [
  '/.claude/',
  '/.agents/',
  '/.github/',
  '/scripts/',
  '/tests/',
  '/functions/',
];

const PRIVATE_FILES = [
  '/CLAUDE.md',
  '/AGENTS.md',
  '/GEMINI.md',
  '/NAVIGATION.md',
  '/README.md',
  '/LICENSE',
  '/firestore.rules',
  '/firestore.indexes.json',
  '/storage.rules',
  '/firebase.json',
  '/.firebaserc',
  '/.gitignore',
  '/.node-version',
  '/.nojekyll',
  '/.env.example',
  '/package.json',
  '/package-lock.json',
  '/playwright.config.js',
];

const PRIVATE_SAMPLES = [
  ...PRIVATE_FILES,
  '/.claude/skills/delegate/SKILL.md',
  '/.agents/x.md',
  '/.github/workflows/test.yml',
  '/scripts/bump-version.js',
  '/tests/unit/x.test.js',
  '/functions/index.js',
  // Pages 靜態檔服務會解碼 %XX、接受連續斜線（2026-10-22 正式站實測），worker 必須比對正規化後路徑
  '/CLAUDE%2Emd',
  '/%43LAUDE.md',
  '/package%2Ejson',
  '/%2Egithub/workflows/test.yml',
  '/scripts%2Fbump-version.js',
  '//CLAUDE.md',
  '//.claude//skills/delegate/SKILL.md',
];

const PUBLIC_SAMPLES = [
  '/index.html',
  '/manual.html',
  '/llms.txt',
  '/robots.txt',
  '/sitemap.xml',
  '/permissions/index.html',
  '/roles/index.html',
  '/blog/index.html',
  '/seo/index.html',
  '/inventory/index.html',
  '/LOGO/02-boot.png',
  '/PWA/icon.png',
  '/js/config.js',
  '/.well-known/assetlinks.json',
  '/scriptsx.js',
  '/js/scripts/a.js',
  '/claude.md',
  '/js/%E0%A4%A.js',
];

const PUBLIC_ROOT_FILES = new Set([
  'index.html',
  'app.js',
  'sw.js',
  'manifest.json',
  '404.html',
  'manual.html',
  'privacy.html',
  'terms.html',
  'GrowthGames.html',
  'game-lab.html',
  'ops-report.html',
  'og.png',
  'appicon.png',
  'llms.txt',
  'robots.txt',
  'sitemap.xml',
]);

const PUBLIC_ROOT_DIRECTORIES = new Set([
  'css',
  'js',
  'pages',
  'img',
  'assets',
  'LOGO',
  'PWA',
  'blog',
  'seo',
  'changelog',
  'valuation',
  'permissions',
  'roles',
  'inventory',
]);

const PAGES_HIDDEN_FILES = new Set([
  '_worker.js',
  '_routes.json',
  '_headers',
]);

function loadWorker() {
  const source = read('_worker.js');
  const module = { exports: {} };
  const unexpectedFetch = jest.fn(() => {
    throw new Error('Unexpected upstream fetch');
  });

  expect(source.match(/export default \{/g)).toHaveLength(1);
  vm.runInNewContext(
    source.replace('export default {', 'module.exports = {'),
    {
      module,
      exports: module.exports,
      URL,
      Request,
      Response,
      Headers,
      fetch: unexpectedFetch,
      console,
    },
    { filename: '_worker.js' }
  );

  return { worker: module.exports, unexpectedFetch };
}

function readPrivatePolicy() {
  const source = read('_worker.js');
  const prefixes = source.match(
    /const PRIVATE_REPO_PATH_PREFIXES\s*=\s*\[([\s\S]*?)\];/
  );
  const files = source.match(
    /const PRIVATE_REPO_FILES\s*=\s*new Set\(\[([\s\S]*?)\]\);/
  );

  expect(prefixes).not.toBeNull();
  expect(files).not.toBeNull();

  const strings = block => Array.from(
    block.matchAll(/"([^"]*)"/g),
    match => match[1]
  );

  return {
    prefixes: strings(prefixes[1]),
    files: strings(files[1]),
  };
}

function ruleCoversPath(rule, pathname) {
  return rule === pathname
    || (rule.endsWith('/*') && pathname.startsWith(rule.slice(0, -1)));
}

describe('private repo paths worker contract', () => {
  test.each(PRIVATE_SAMPLES)('A: blocks %s before asset access', async pathname => {
    const { worker, unexpectedFetch } = loadWorker();
    const assetFetch = jest.fn(() => new Response('ok', { status: 200 }));
    const response = await worker.fetch(
      new Request(`https://toosterx.com${pathname}`),
      { ASSETS: { fetch: assetFetch } }
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(await response.text()).toBe('Not Found');
    expect(assetFetch).not.toHaveBeenCalled();
    expect(unexpectedFetch).not.toHaveBeenCalled();
  });

  test.each(PUBLIC_SAMPLES)('B: passes %s to assets', async pathname => {
    const { worker, unexpectedFetch } = loadWorker();
    const assetFetch = jest.fn(() => new Response('ok', { status: 200 }));
    const response = await worker.fetch(
      new Request(`https://toosterx.com${pathname}`),
      { ASSETS: { fetch: assetFetch } }
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    expect(assetFetch).toHaveBeenCalledTimes(1);
    expect(new URL(assetFetch.mock.calls[0][0].url).pathname).toBe(pathname);
    expect(unexpectedFetch).not.toHaveBeenCalled();
  });

  test('C: private policy matches the approved list and routing includes it', () => {
    const policy = readPrivatePolicy();
    const routes = JSON.parse(read('_routes.json'));

    expect(policy.prefixes.slice().sort()).toEqual(PRIVATE_PREFIXES.slice().sort());
    expect(policy.files.slice().sort()).toEqual(PRIVATE_FILES.slice().sort());

    const privateRules = [
      ...policy.prefixes.map(prefix => `${prefix}*`),
      ...policy.files,
    ];

    for (const rule of privateRules) {
      expect(routes.include).toContain(rule);
      expect(routes.exclude).not.toContain(rule);
      expect(routes.exclude.filter(exclude => ruleCoversPath(exclude, rule)))
        .toEqual([]);
    }

    // 精確 exclude 即使只排除目錄中的一個檔案，也會造成封鎖漏洞。
    for (const prefix of policy.prefixes) {
      expect(routes.exclude.filter(exclude => exclude.startsWith(prefix)))
        .toEqual([]);
    }
  });

  test('D: routing stays within Pages limits', () => {
    const routes = JSON.parse(read('_routes.json'));

    expect(Array.isArray(routes.include)).toBe(true);
    expect(Array.isArray(routes.exclude)).toBe(true);

    const rules = [...routes.include, ...routes.exclude];
    expect(rules.length).toBeLessThanOrEqual(100);

    for (const rule of rules) {
      expect(typeof rule).toBe('string');
      expect(rule.length).toBeLessThanOrEqual(100);
      expect(rule.startsWith('/')).toBe(true);
    }
  });

  test('E: every tracked root entry has an explicit classification', () => {
    let trackedFiles;
    try {
      trackedFiles = execFileSync('git', ['ls-files'], {
        cwd: ROOT,
        encoding: 'utf8',
      });
    } catch (_) {
      // 無 Git 或無 Git metadata 的封裝環境無法取得追蹤清單，依契約直接返回。
      return;
    }

    const policy = readPrivatePolicy();
    const privateFiles = new Set(policy.files.map(file => file.slice(1)));
    const privateDirectories = new Set(
      policy.prefixes.map(prefix => prefix.slice(1, -1))
    );
    const unclassified = new Set();

    // ASSUMPTION: 僅以 PM 明列的根項目分類；其他追蹤根項目須由維護者明確分類。
    for (const line of trackedFiles.split(/\r?\n/).filter(Boolean)) {
      // Git 的中文路徑可能包在雙引號中，先去除開頭引號再取第一段。
      const normalized = line.replace(/^"/, '').replace(/"$/, '');
      const rootName = normalized.split('/')[0];
      const isDirectory = normalized.includes('/');
      const classified = isDirectory
        ? PUBLIC_ROOT_DIRECTORIES.has(rootName) || privateDirectories.has(rootName)
        : PUBLIC_ROOT_FILES.has(rootName)
          || /^sitemap-[^/]*\.xml$/.test(rootName)
          || privateFiles.has(rootName)
          || PAGES_HIDDEN_FILES.has(rootName);

      if (!classified) unclassified.add(rootName);
    }

    if (unclassified.size > 0) {
      throw new Error(
        `新增根檔請在 _worker.js 與 _routes.json 分類：${Array.from(unclassified).sort().join(', ')}`
      );
    }
  });
});
