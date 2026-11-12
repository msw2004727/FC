/**
 * 分享 OG 中繼頁（eventShareOg／teamShareOg）測試用載入器。
 * 用 vm 從 functions/index.js 抽出實際原始碼執行，搭配假的 Firestore，
 * 讓快照比對與行為測試跑的是真程式，不是複製品。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FUNCTIONS_INDEX = path.join(__dirname, '..', '..', 'functions', 'index.js');

function readSourceBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  if (start < 0) throw new Error(`找不到起點：${startNeedle}`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  if (end < 0) throw new Error(`找不到終點：${endNeedle}`);
  return source.slice(start, end);
}

function createShareOgFakeDb({ events = {}, teams = {} } = {}) {
  const tables = { events, teams };
  return {
    collection(name) {
      const rows = tables[name] || {};
      return {
        doc(docId) {
          return {
            async get() {
              const data = Object.prototype.hasOwnProperty.call(rows, docId) ? rows[docId] : undefined;
              return { exists: data !== undefined, data: () => data };
            },
          };
        },
        where(field, op, value) {
          return {
            limit() {
              return {
                async get() {
                  const docs = Object.values(rows)
                    .filter(row => op === '==' && row && row[field] === value)
                    .slice(0, 1)
                    .map(row => ({ data: () => row }));
                  return { empty: docs.length === 0, docs };
                },
              };
            },
          };
        },
      };
    },
  };
}

function loadShareOgHandlers({ db, consoleImpl = console } = {}) {
  const source = fs.readFileSync(FUNCTIONS_INDEX, 'utf8').replace(/\r\n/g, '\n');
  const parts = [
    readSourceBetween(source, 'const SHARE_SITE_ORIGIN', 'function normalizeRole'),
    readSourceBetween(source, 'function escapeHtml', 'async function getTeamDocByTeamId'),
    readSourceBetween(source, 'function isSafeEventDirectDocId', 'async function getEventDocByPublicIdInTransaction'),
    readSourceBetween(source, 'exports.teamShareOg', 'function setRuntimeConfigHeaders'),
    readSourceBetween(source, 'function sanitizeEventImageUrl', 'const PAGE_VIEW_SEEDS'),
    readSourceBetween(source, 'exports.eventShareOg', 'exports.submitKickGameScore'),
  ];
  const sandbox = {
    db,
    console: consoleImpl,
    exports: {},
    onRequest: (options, handler) => ({ options, handler }),
  };
  vm.runInNewContext(
    `${parts.join('\n')}\nglobalThis.__shareOgInternals = {
      buildEventShareHtml,
      resolveEventShareOgImage,
      isOgCrawlerRequest,
      ...(typeof toInlineScriptJson === 'function' ? { toInlineScriptJson } : {}),
      ...(typeof classifyEventShareUserAgent === 'function' ? { classifyEventShareUserAgent } : {}),
      ...(typeof shouldLogEventShareUserAgent === 'function' ? { shouldLogEventShareUserAgent } : {}),
    };`,
    sandbox,
    { filename: 'share-og.vm.js' }
  );
  return {
    eventShareOg: sandbox.exports.eventShareOg.handler,
    teamShareOg: sandbox.exports.teamShareOg.handler,
    internals: sandbox.__shareOgInternals,
  };
}

function createShareOgRequest({ path: reqPath = '/', query = {}, userAgent = '', method = 'GET' } = {}) {
  const headers = { 'user-agent': userAgent };
  return {
    method,
    path: reqPath,
    query,
    headers,
    get: name => headers[String(name).toLowerCase()],
  };
}

async function runShareOgHandler(handler, request) {
  const response = { statusCode: 0, headers: {}, body: '' };
  const res = {
    set(name, value) { response.headers[name] = value; return res; },
    status(code) { response.statusCode = code; return res; },
    send(body) { response.body = body; return res; },
  };
  await handler(request, res);
  return response;
}

// 快照情境：改前程式產生的輸出存在 share-og-snapshots.json，改後逐位元組比對。
const SHARE_OG_FIXTURE_EVENTS = Object.freeze({
  ev_share: {
    id: 'ev_share',
    title: 'Share <Title> & "Q" \'s',
    date: '2026/11/20 19:00',
    location: '台北市 <場地>',
    max: 12,
    current: 3,
    shareImageUrl: 'https://cdn.example.com/share.jpg',
    sportTag: 'football',
    image: 'https://firebasestorage.googleapis.com/v0/b/demo/o/cover-share',
  },
  ev_sport: {
    id: 'ev_sport',
    title: '週三足球',
    date: '2026/11/21',
    sportTag: 'football',
    image: 'https://firebasestorage.googleapis.com/v0/b/demo/o/cover-sport',
  },
  ev_cover: {
    id: 'ev_cover',
    title: '網球交流',
    location: '新北',
    sportTag: 'tennis',
    image: 'https://firebasestorage.googleapis.com/v0/b/demo/o/cover-tennis',
  },
  ev_default: {
    id: 'ev_default',
    title: '路跑',
    sportTag: 'running',
  },
});

const SHARE_OG_FIXTURE_TEAMS = Object.freeze({
  tm_1: { id: 'tm_1', name: '測試<俱樂部>', image: 'https://cdn.example.com/team.jpg' },
});

const SHARE_OG_CRAWLER_UAS = Object.freeze([
  'facebookexternalhit/1.1',
  'facebookexternalhit/1.1;line-poker/1.0',
]);

const SHARE_OG_SNAPSHOT_CASES = Object.freeze([
  ...['ev_share', 'ev_sport', 'ev_cover', 'ev_default', 'ev_missing'].flatMap(eventId => (
    SHARE_OG_CRAWLER_UAS.map(userAgent => ({
      name: `event crawler ${eventId} ${userAgent}`,
      fn: 'eventShareOg',
      request: { path: `/${eventId}`, query: {}, userAgent },
    }))
  )),
  {
    name: 'event crawler ev_share 帶 v 與 query eventId',
    fn: 'eventShareOg',
    request: { path: '/', query: { eventId: 'ev_share', v: 'abc<1>' }, userAgent: 'linespider' },
  },
  {
    name: 'event crawler 空 eventId',
    fn: 'eventShareOg',
    request: { path: '/', query: {}, userAgent: 'facebookexternalhit/1.1' },
  },
  {
    name: 'event human ev_missing（LINE）',
    fn: 'eventShareOg',
    request: { path: '/ev_missing', query: {}, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/15.19.0' },
  },
  {
    name: 'event human ev_missing（Safari）',
    fn: 'eventShareOg',
    request: { path: '/ev_missing', query: {}, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1' },
  },
  ...['tm_1', 'tm_missing'].flatMap(teamId => [
    {
      name: `team human ${teamId}`,
      fn: 'teamShareOg',
      request: { path: `/${teamId}`, query: {}, userAgent: 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 Line/15.19.1/IAB' },
    },
    {
      name: `team crawler ${teamId}`,
      fn: 'teamShareOg',
      request: { path: `/${teamId}`, query: {}, userAgent: 'facebookexternalhit/1.1' },
    },
  ]),
]);

async function renderShareOgSnapshotCases() {
  const db = createShareOgFakeDb({ events: SHARE_OG_FIXTURE_EVENTS, teams: SHARE_OG_FIXTURE_TEAMS });
  const quietConsole = { log() {}, warn() {}, error() {} };
  const handlers = loadShareOgHandlers({ db, consoleImpl: quietConsole });
  const results = {};
  for (const testCase of SHARE_OG_SNAPSHOT_CASES) {
    const response = await runShareOgHandler(handlers[testCase.fn], createShareOgRequest(testCase.request));
    results[testCase.name] = response;
  }
  return results;
}

module.exports = {
  SHARE_OG_FIXTURE_EVENTS,
  SHARE_OG_SNAPSHOT_CASES,
  renderShareOgSnapshotCases,
  createShareOgFakeDb,
  loadShareOgHandlers,
  createShareOgRequest,
  runShareOgHandler,
};
