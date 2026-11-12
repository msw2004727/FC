const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function loadWorker(upstreamFetch) {
  const source = read('_worker.js');
  const module = { exports: {} };
  const store = new Map();
  const caches = {
    default: {
      match: jest.fn(async req => store.get(req.url)),
      put: jest.fn(async (req, res) => { store.set(req.url, res); }),
    },
  };
  vm.runInNewContext(
    source.replace('export default {', 'module.exports = {'),
    { module, exports: module.exports, URL, Request, Response, Headers, fetch: upstreamFetch, caches, console },
    { filename: '_worker.js' }
  );
  return { worker: module.exports, store };
}

describe('OG share edge cache key（爬蟲／真人分開）', () => {
  test('爬蟲先抓後，真人仍拿到自己的版本', async () => {
    const upstream = jest.fn(async (_url, init) => new Response(
      /facebookexternalhit/.test(init.headers.get('user-agent') || '') ? 'bot-version' : 'human-version',
      { status: 200 }
    ));
    const { worker, store } = loadWorker(upstream);
    const url = 'https://toosterx.com/event-share/ce_1?v=20260707';

    const bot = await worker.fetch(new Request(url, { headers: { 'user-agent': 'facebookexternalhit/1.1' } }), {});
    expect(await bot.text()).toBe('bot-version');
    await new Promise(resolve => setImmediate(resolve));
    const human = await worker.fetch(new Request(url, { headers: { 'user-agent': 'Mozilla/5.0 Line/14.0' } }), {});
    expect(await human.text()).toBe('human-version');

    expect(upstream).toHaveBeenCalledTimes(2);
    expect([...store.keys()].sort()).toEqual([
      `${url}&__ogbot=0`,
      `${url}&__ogbot=1`,
    ]);
  });

  // SC-2 乙案：真人頁不依 LINE 內外分版本（頁面內判斷），所以 LINE 與非 LINE 真人共用同一快取項、worker 不必改鍵。
  test('LINE 內與其他瀏覽器的真人共用同一個快取項', async () => {
    const upstream = jest.fn(async () => new Response('human-version', { status: 200 }));
    const { worker, store } = loadWorker(upstream);
    const url = 'https://toosterx.com/event-share/ce_1?v=20260707';

    const line = await worker.fetch(new Request(url, { headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Mobile/15E148 Safari Line/15.19.0' } }), { waitUntil() {} });
    expect(await line.text()).toBe('human-version');
    await new Promise(resolve => setImmediate(resolve));
    const safari = await worker.fetch(new Request(url, { headers: { 'user-agent': 'Mozilla/5.0 (iPhone) Version/18.1 Mobile/15E148 Safari/604.1' } }), { waitUntil() {} });
    expect(await safari.text()).toBe('human-version');

    expect(upstream).toHaveBeenCalledTimes(1);
    expect([...store.keys()]).toEqual([`${url}&__ogbot=0`]);
  });

  test('爬蟲正規式與 Functions 一致', () => {
    const pick = source => source.match(/const OG_CRAWLER_USER_AGENT_RE = (\/.*\/i);/)?.[1];
    expect(pick(read('_worker.js'))).toBeTruthy();
    expect(pick(read('_worker.js'))).toBe(pick(read('functions/index.js')));
  });
});
