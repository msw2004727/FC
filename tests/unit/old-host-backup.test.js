/**
 * old.toosterx.com 備援網址（換站計畫書 A-03④⑤）
 *
 * 正式主機名單含 old，Deep link 中繼刻意不含。
 * old 的 LIFF ID 空著時沿用 Mini App；old 不給搜尋引擎收錄。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
const MINI_APP_LIFF_ID = '2009525300-AuPGQ0sh';
const BASE_HOSTS = ['toosterx.com', 'www.toosterx.com', 'msw2004727.github.io', 'fc-3g8.pages.dev'];
const PROD_HOSTS = BASE_HOSTS.concat(['old.toosterx.com']);

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function quotedList(body) {
  return body.split(',').map(part => part.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}

function extractProdHostIife(html) {
  const at = html.indexOf('var PROD_HOSTS = [');
  const start = html.lastIndexOf('(function(){', at);
  const end = html.indexOf('})();', at);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end + '})();'.length);
}

function extractDeepLinkIife(html) {
  const marker = html.indexOf('Deep link 中繼跳轉');
  const start = html.indexOf('(function(){', marker);
  const end = html.indexOf('})();', start);
  expect(marker).toBeGreaterThanOrEqual(0);
  expect(start).toBeGreaterThan(marker);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end + '})();'.length);
}

function lineConfigSnippet(oldHostLiffId) {
  const source = read('js/config.js');
  const start = source.indexOf('const OLD_HOST_LIFF_ID');
  const end = source.indexOf('const MINI_APP_BASE_URL');
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  let snippet = source.slice(start, end);
  if (oldHostLiffId != null) {
    const next = snippet.replace(
      /const OLD_HOST_LIFF_ID = '[^']*';/,
      'const OLD_HOST_LIFF_ID = ' + JSON.stringify(oldHostLiffId) + ';'
    );
    expect(next).toMatch(/const OLD_HOST_LIFF_ID = /);
    snippet = next;
  }
  return snippet;
}

function evalLineConfig(hostname, oldHostLiffId) {
  const snippet = lineConfigSnippet(oldHostLiffId);
  const context = {};
  if (hostname != null) context.location = { hostname: hostname };
  vm.createContext(context);
  return vm.runInContext(snippet + '\nLINE_CONFIG;', context);
}

function runProdHostIife(hostname) {
  const metas = [];
  const consoleObj = {
    log() {},
    info() {},
    debug() {},
    warn() {},
    error() {},
  };
  const context = {
    location: { hostname: hostname, search: '' },
    console: consoleObj,
    document: {
      head: {
        appendChild(node) { metas.push(node); },
      },
      createElement() {
        const el = { attrs: {} };
        el.setAttribute = function(name, value) { el.attrs[name] = value; };
        return el;
      },
    },
    window: { console: consoleObj },
  };
  vm.createContext(context);
  vm.runInContext(extractProdHostIife(read('index.html')), context);
  return {
    metas: metas,
    hosts: context.window.__SPORTHUB_PROD_HOSTS__,
    policy: context.window.__SPORTHUB_CONSOLE_POLICY__,
  };
}

function runDeepLink(hostname, search) {
  const replaced = [];
  const context = {
    location: {
      hostname: hostname,
      search: search,
      replace(url) { replaced.push(url); },
    },
    localStorage: {
      getItem() { return null; },
      setItem() {},
    },
    URLSearchParams: URLSearchParams,
  };
  vm.createContext(context);
  vm.runInContext(extractDeepLinkIife(read('index.html')), context);
  return replaced;
}

describe('old.toosterx.com backup host', () => {
  test('both PROD_HOSTS lists include old.toosterx.com and match', () => {
    const indexMatch = read('index.html').match(/var PROD_HOSTS = \[([^\]]*)\]/);
    const configMatch = read('js/config.js').match(
      /const PROD_HOSTS = Array\.isArray\(window\.__SPORTHUB_PROD_HOSTS__\)\s*\?\s*\[[^\]]*\]\s*:\s*\[([^\]]*)\]/
    );
    expect(indexMatch).not.toBeNull();
    expect(configMatch).not.toBeNull();
    const indexHosts = quotedList(indexMatch[1]);
    const configHosts = quotedList(configMatch[1]);
    expect(indexHosts).toEqual(PROD_HOSTS);
    expect(configHosts).toEqual(PROD_HOSTS);
    expect(indexHosts).toContain('old.toosterx.com');
    expect(configHosts).toEqual(indexHosts);
  });

  test('deep link relay hosts intentionally exclude old.toosterx.com', () => {
    const html = read('index.html');
    const marker = html.indexOf('Deep link 中繼跳轉');
    const block = html.slice(marker, html.indexOf('</script>', marker));
    const hostsLine = block.indexOf('var hosts=[');
    const previousLine = block.slice(0, hostsLine).split('\n').map(line => line.trim()).filter(Boolean).pop();
    const match = block.match(/var hosts=\[([^\]]*)\]/);
    expect(match).not.toBeNull();
    expect(quotedList(match[1])).toEqual(BASE_HOSTS);
    expect(quotedList(match[1])).not.toContain('old.toosterx.com');
    expect(previousLine).toMatch(/刻意不含/);
    expect(previousLine).toMatch(/old\.toosterx\.com/);
    expect(runDeepLink('old.toosterx.com', '?event=evt1')).toEqual([]);
    expect(runDeepLink('toosterx.com', '?event=evt1')).toEqual([
      'https://miniapp.line.me/2009525300-AuPGQ0sh?event=evt1',
    ]);
  });

  test('_headers marks https://old.toosterx.com/* noindex', () => {
    const source = read('_headers').replace(/\r\n/g, '\n');
    const marker = 'https://old.toosterx.com/*\n';
    const at = source.indexOf(marker);
    expect(at).toBeGreaterThanOrEqual(0);
    const commentEnd = at - 1;
    const commentStart = source.lastIndexOf('\n', commentEnd - 1) + 1;
    expect(source.slice(commentStart, commentEnd)).toBe('# A-03 備援網址不收錄');
    expect(source.slice(at).replace(/\n$/, '')).toBe(
      'https://old.toosterx.com/*\n  X-Robots-Tag: noindex, nofollow'
    );
  });

  test('old host adds a robots meta and other hosts do not', () => {
    const html = read('index.html');
    expect(html).not.toMatch(/<meta\b[^>]*\bname\s*=\s*["']robots["']/i);
    const iife = extractProdHostIife(html);
    expect(iife).toContain("host === 'old.toosterx.com'");
    expect(iife).not.toMatch(/\?\./);
    expect(iife).not.toMatch(/\?\?/);
    expect(iife).not.toContain('replaceAll');

    const oldHost = runProdHostIife('old.toosterx.com');
    expect(oldHost.metas).toHaveLength(1);
    expect(oldHost.metas[0].attrs).toEqual({ name: 'robots', content: 'noindex, nofollow' });
    expect(Array.prototype.slice.call(oldHost.hosts)).toEqual(PROD_HOSTS);
    expect(oldHost.policy.isProdHost).toBe(true);

    const prod = runProdHostIife('toosterx.com');
    expect(prod.metas).toEqual([]);
    expect(prod.policy.isProdHost).toBe(true);

    const local = runProdHostIife('localhost');
    expect(local.metas).toEqual([]);
    expect(local.policy.isProdHost).toBe(false);
  });

  test('LIFF_ID uses OLD_HOST_LIFF_ID only on old host when the constant is non-empty', () => {
    const snippet = lineConfigSnippet();
    expect(snippet).toMatch(/const OLD_HOST_LIFF_ID = '2009084941-oVHTDgcH';/);
    expect(snippet).toContain('location.hostname');
    expect(snippet).toContain("=== 'old.toosterx.com'");
    expect(snippet).not.toMatch(/\?\./);
    expect(snippet).not.toMatch(/\?\?/);
    expect(snippet).not.toContain('replaceAll');
    expect(snippet).toMatch(/MINI_APP_ID:\s*'2009525300-AuPGQ0sh'/);
    expect(snippet).toMatch(/LIFF_ID_LEGACY:\s*'2009084941-zgn7tQOp'/);
    expect(snippet).toMatch(/CHANNEL_ID:\s*'2009525300'/);

    // 實際填入的 old 專用 LIFF：只在 old 生效
    expect(evalLineConfig('old.toosterx.com').LIFF_ID).toBe('2009084941-oVHTDgcH');

    const emptyOnOld = evalLineConfig('old.toosterx.com', '');
    expect(emptyOnOld.LIFF_ID).toBe(MINI_APP_LIFF_ID);
    expect(emptyOnOld.MINI_APP_ID).toBe(MINI_APP_LIFF_ID);
    expect(emptyOnOld.LIFF_ID_LEGACY).toBe('2009084941-zgn7tQOp');
    expect(emptyOnOld.CHANNEL_ID).toBe('2009525300');

    expect(evalLineConfig('toosterx.com').LIFF_ID).toBe(MINI_APP_LIFF_ID);
    expect(evalLineConfig('www.toosterx.com').LIFF_ID).toBe(MINI_APP_LIFF_ID);
    expect(evalLineConfig(null).LIFF_ID).toBe(MINI_APP_LIFF_ID);

    const filledOnOld = evalLineConfig('old.toosterx.com', '2099-old-liff');
    expect(filledOnOld.LIFF_ID).toBe('2099-old-liff');
    expect(filledOnOld.MINI_APP_ID).toBe(MINI_APP_LIFF_ID);
    expect(filledOnOld.LIFF_ID_LEGACY).toBe('2009084941-zgn7tQOp');
    expect(filledOnOld.CHANNEL_ID).toBe('2009525300');
    expect(evalLineConfig('toosterx.com', '2099-old-liff').LIFF_ID).toBe(MINI_APP_LIFF_ID);
  });

  test('full config.js still loads when location is absent', () => {
    const context = { window: {} };
    vm.createContext(context);
    const loaded = vm.runInContext(
      read('js/config.js') + '\n({ LINE_CONFIG: LINE_CONFIG, PROD_HOSTS: PROD_HOSTS });',
      context
    );
    expect(loaded.LINE_CONFIG.LIFF_ID).toBe(MINI_APP_LIFF_ID);
    expect(loaded.LINE_CONFIG.MINI_APP_ID).toBe(MINI_APP_LIFF_ID);
    expect(Array.prototype.slice.call(loaded.PROD_HOSTS)).toEqual(PROD_HOSTS);
  });
});
