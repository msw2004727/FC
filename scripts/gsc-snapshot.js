#!/usr/bin/env node
/**
 * gsc-snapshot.js
 *
 * 每日從 Google Search Console API 抓取 SEO 資料，
 * 寫入 Firestore seoSnapshots/{YYYY-MM-DD}，供 /admin/seo dashboard 使用。
 *
 * 使用方式（GitHub Actions 已設定）：
 *   GCP_SERVICE_ACCOUNT_JSON=... node scripts/gsc-snapshot.js
 *
 * 使用 Firestore REST API（零外部套件依賴）。
 */

const https = require('https');
const crypto = require('crypto');

// ─── 設定 ───────────────────────────────────────────────
const SITE_URL = 'sc-domain:toosterx.com';
const FIRESTORE_PROJECT = 'fc-football-6c8dc';
const COLLECTION = 'seoSnapshots';
const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/datastore',
].join(' ');

// 需要做 URL Inspection 的頁面
const URLS_TO_INSPECT = [
  'https://toosterx.com/',
  'https://toosterx.com/seo/football',
  'https://toosterx.com/seo/basketball',
  'https://toosterx.com/seo/pickleball',
  'https://toosterx.com/seo/dodgeball',
  'https://toosterx.com/seo/running',
  'https://toosterx.com/seo/hiking',
  'https://toosterx.com/seo/football-taichung',
  'https://toosterx.com/seo/nantun-football-park',
  'https://toosterx.com/seo/sports-changhua',
  'https://toosterx.com/seo/sports-nantou',
  'https://toosterx.com/roles/',
  'https://toosterx.com/privacy.html',
  'https://toosterx.com/terms.html',
];

// ─── OAuth JWT Helpers ───────────────────────────────────
function base64url(data) {
  return Buffer.from(data).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createJWT(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iss: sa.client_email, scope: OAUTH_SCOPES, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const segs = [base64url(JSON.stringify(header)), base64url(JSON.stringify(payload))];
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(segs.join('.'));
  const sig = sign.sign(sa.private_key, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return segs.join('.') + '.' + sig;
}

function httpJSON(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: d ? JSON.parse(d) : {} }); }
        catch (e) { resolve({ status: res.statusCode, body: d, parseError: true }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getAccessToken(sa) {
  const jwt = createJWT(sa);
  const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
  const res = await httpJSON({
    hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (res.status !== 200) throw new Error('OAuth 失敗: ' + JSON.stringify(res.body));
  return res.body.access_token;
}

// ─── GSC API Helpers ────────────────────────────────────
async function gscQuery(token, params) {
  const siteEnc = encodeURIComponent(SITE_URL);
  const body = JSON.stringify(params);
  const res = await httpJSON({
    hostname: 'www.googleapis.com',
    path: `/webmasters/v3/sites/${siteEnc}/searchAnalytics/query`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    }
  }, body);
  if (res.status !== 200) {
    console.error('GSC query 失敗:', res.status, JSON.stringify(res.body).slice(0, 300));
    return { rows: [] };
  }
  return res.body;
}

async function gscSitemaps(token) {
  const siteEnc = encodeURIComponent(SITE_URL);
  const res = await httpJSON({
    hostname: 'www.googleapis.com',
    path: `/webmasters/v3/sites/${siteEnc}/sitemaps`,
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (res.status !== 200) return { sitemap: [] };
  return res.body;
}

async function gscInspect(token, url) {
  const body = JSON.stringify({ inspectionUrl: url, siteUrl: SITE_URL });
  const res = await httpJSON({
    hostname: 'searchconsole.googleapis.com',
    path: '/v1/urlInspection/index:inspect',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    }
  }, body);
  if (res.status !== 200) return null;
  return res.body.inspectionResult || null;
}

// ─── Firestore REST Helpers ─────────────────────────────
function fsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { nullValue: null };
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fsValue) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = fsValue(val);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

function fsObject(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = fsValue(v);
  return { fields };
}

async function firestoreSet(token, docPath, data) {
  const body = JSON.stringify(fsObject(data));
  const path = `/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/${docPath}`;
  const res = await httpJSON({
    hostname: 'firestore.googleapis.com',
    path: path,
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    }
  }, body);
  if (res.status !== 200) {
    throw new Error(`Firestore 寫入失敗 (${res.status}): ` + JSON.stringify(res.body).slice(0, 400));
  }
  return res.body;
}

// ─── 主邏輯 ─────────────────────────────────────────────
function toISODate(d) { return d.toISOString().slice(0, 10); }
function daysAgo(n) { return new Date(Date.now() - n * 86400000); }

async function fetchOverview(token, startDate, endDate) {
  const res = await gscQuery(token, { startDate, endDate, dimensions: [] });
  const r = (res.rows || [])[0] || {};
  return {
    impressions: r.impressions || 0,
    clicks: r.clicks || 0,
    ctr: r.ctr || 0,
    position: r.position || 0,
  };
}

async function fetchDaily(token, startDate, endDate) {
  const res = await gscQuery(token, { startDate, endDate, dimensions: ['date'], rowLimit: 100 });
  return (res.rows || []).map(r => ({
    date: r.keys[0],
    impressions: r.impressions || 0,
    clicks: r.clicks || 0,
    ctr: r.ctr || 0,
    position: r.position || 0,
  }));
}

async function fetchByDim(token, startDate, endDate, dim, rowLimit = 50) {
  const res = await gscQuery(token, { startDate, endDate, dimensions: [dim], rowLimit });
  return (res.rows || []).map(r => ({
    [dim]: r.keys[0],
    impressions: r.impressions || 0,
    clicks: r.clicks || 0,
    ctr: r.ctr || 0,
    position: r.position || 0,
  }));
}

function buildFirstTwoPageQueries(queries, limit = 30) {
  if (!Array.isArray(queries)) return [];
  return queries
    .filter(q => q && q.query && Number(q.position) > 0 && Number(q.position) <= 20)
    .sort((a, b) => {
      const posDiff = Number(a.position || 0) - Number(b.position || 0);
      if (Math.abs(posDiff) > 0.01) return posDiff;
      return Number(b.impressions || 0) - Number(a.impressions || 0);
    })
    .slice(0, limit)
    .map(q => ({
      query: q.query,
      impressions: q.impressions || 0,
      clicks: q.clicks || 0,
      ctr: q.ctr || 0,
      position: q.position || 0,
      pageBucket: Number(q.position || 0) <= 10 ? 'page1' : 'page2',
    }));
}

async function fetchSitemap(token) {
  const res = await gscSitemaps(token);
  return (res.sitemap || []).map(s => ({
    path: s.path,
    lastDownloaded: s.lastDownloaded,
    lastSubmitted: s.lastSubmitted,
    isPending: !!s.isPending,
    isSitemapsIndex: !!s.isSitemapsIndex,
    errors: Number(s.errors || 0),
    warnings: Number(s.warnings || 0),
    contents: (s.contents || []).map(c => ({
      type: c.type,
      submitted: Number(c.submitted || 0),
      indexed: Number(c.indexed || 0),
    })),
  }));
}

async function fetchUrlInspections(token, urls) {
  const results = [];
  for (const url of urls) {
    const r = await gscInspect(token, url);
    if (!r) { results.push({ url, error: 'inspection_failed' }); continue; }
    const idx = r.indexStatusResult || {};
    const rich = r.richResultsResult || {};
    results.push({
      url,
      verdict: idx.verdict || 'N/A',
      coverage: idx.coverageState || 'N/A',
      robotsTxt: idx.robotsTxtState || 'N/A',
      indexingState: idx.indexingState || 'N/A',
      lastCrawlTime: idx.lastCrawlTime || null,
      crawledAs: idx.crawledAs || null,
      googleCanonical: idx.googleCanonical || null,
      userCanonical: idx.userCanonical || null,
      richVerdict: rich.verdict || 'N/A',
      richItemsCount: (rich.detectedItems || []).length,
      inspectionResultLink: r.inspectionResultLink || null,
    });
    // 避免配額，每次間隔 200ms
    await new Promise(rs => setTimeout(rs, 200));
  }
  return results;
}

async function main() {
  console.log('=== GSC Snapshot: 開始 ===\n');

  const saRaw = process.env.GCP_SERVICE_ACCOUNT_JSON;
  if (!saRaw) { console.error('✗ GCP_SERVICE_ACCOUNT_JSON 未設定'); process.exit(1); }
  const sa = JSON.parse(saRaw);

  console.log('→ 取得 OAuth Token（SA:', sa.client_email, '）');
  const token = await getAccessToken(sa);
  console.log('✓ Token OK\n');

  const end = toISODate(new Date());
  const start7 = toISODate(daysAgo(7));
  const start28 = toISODate(daysAgo(28));
  const start90 = toISODate(daysAgo(90));
  const start30Daily = toISODate(daysAgo(30));

  console.log('→ 取總覽 (7/28/90 天)...');
  const [o7, o28, o90] = await Promise.all([
    fetchOverview(token, start7, end),
    fetchOverview(token, start28, end),
    fetchOverview(token, start90, end),
  ]);
  console.log('  ✓ 7d:', o7.impressions, '| 28d:', o28.impressions, '| 90d:', o90.impressions);

  console.log('→ 取每日時間序列（30 天）...');
  const daily = await fetchDaily(token, start30Daily, end);
  console.log('  ✓', daily.length, '天');

  console.log('→ 取各維度分布...');
  const [pages, devices, countries, queries, searchAppearance] = await Promise.all([
    fetchByDim(token, start28, end, 'page', 50),
    fetchByDim(token, start28, end, 'device', 10),
    fetchByDim(token, start28, end, 'country', 20),
    fetchByDim(token, start90, end, 'query', 50),
    fetchByDim(token, start90, end, 'searchAppearance', 10).catch(() => []),
  ]);
  console.log('  ✓ pages:', pages.length, '| devices:', devices.length, '| countries:', countries.length, '| queries:', queries.length);
  const firstTwoPageQueries = buildFirstTwoPageQueries(queries);
  console.log('  ✓ first-two-page queries:', firstTwoPageQueries.length);

  console.log('→ 取 sitemap 狀態...');
  const sitemaps = await fetchSitemap(token);
  console.log('  ✓', sitemaps.length, '個 sitemap');

  console.log('→ URL Inspection (' + URLS_TO_INSPECT.length + ' 個 URL)...');
  const urlStatus = await fetchUrlInspections(token, URLS_TO_INSPECT);
  const indexed = urlStatus.filter(u => u.coverage === 'Submitted and indexed').length;
  console.log('  ✓ 完成，' + indexed + '/' + urlStatus.length + ' indexed');

  // 按類型統計搜尋類型
  console.log('→ 搜尋類型分布 (web/image/video/...)...');
  const types = ['WEB', 'IMAGE', 'VIDEO', 'NEWS', 'DISCOVER'];
  const typeBreakdown = {};
  for (const t of types) {
    const r = await gscQuery(token, { startDate: start90, endDate: end, type: t, dimensions: [] });
    const row = (r.rows || [])[0] || {};
    typeBreakdown[t.toLowerCase()] = {
      impressions: row.impressions || 0,
      clicks: row.clicks || 0,
      ctr: row.ctr || 0,
      position: row.position || 0,
    };
  }

  // 組裝 snapshot
  const dateId = end;
  const snapshot = {
    generatedAt: new Date(),
    dateRange: { start7, start28, start90, end },
    siteUrl: SITE_URL,
    overview: { last7: o7, last28: o28, last90: o90 },
    daily,
    pages,
    devices,
    countries,
    queries,
    firstTwoPageQueries,
    searchAppearance,
    typeBreakdown,
    sitemaps,
    urlStatus,
    indexedCount: indexed,
    totalInspected: urlStatus.length,
  };

  console.log('\n→ 寫入 Firestore: ' + COLLECTION + '/' + dateId);
  await firestoreSet(token, `${COLLECTION}/${dateId}`, snapshot);
  console.log('✓ 寫入成功\n');

  // 也更新一個 "latest" 指標 doc，供前端快速讀最新
  console.log('→ 更新 ' + COLLECTION + '/_latest 指標...');
  await firestoreSet(token, `${COLLECTION}/_latest`, { latestDate: dateId, generatedAt: new Date() });
  console.log('✓ 完成\n');

  console.log('=== GSC Snapshot: 全部完成 ✓ ===');
  console.log('摘要: 28 天曝光', o28.impressions, '/ 點擊', o28.clicks, '/ CTR', (o28.ctr * 100).toFixed(1) + '%', '/ 排名', o28.position.toFixed(1));
  console.log('URL indexed:', indexed + '/' + urlStatus.length);
}

main().catch(err => { console.error('✗ 錯誤:', err.message); console.error(err.stack); process.exit(1); });
