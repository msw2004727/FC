#!/usr/bin/env node
/**
 * verify-gsc-read.js
 *
 * 驗證現有 GCP Service Account 是否有 GSC 讀取權限。
 * 若通過代表可繼續建 /admin/seo dashboard 用同一個 SA。
 *
 * 環境變數：
 *   GCP_SERVICE_ACCOUNT_JSON — Service Account 金鑰 JSON 字串
 */

const https = require('https');
const crypto = require('crypto');

const SITE_URL = 'sc-domain:toosterx.com';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

function base64url(data) {
  return Buffer.from(data).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createJWT(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iss: sa.client_email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
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
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  const sa = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_JSON || '{}');
  if (!sa.client_email) { console.error('✗ GCP_SERVICE_ACCOUNT_JSON 未設定'); process.exit(1); }

  console.log('=== 測試 Service Account:', sa.client_email, '===\n');

  // 1. 取 Token
  const jwt = createJWT(sa);
  const tkRes = await httpJSON({
    hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  }, `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`);
  if (tkRes.status !== 200) { console.error('✗ Token 取得失敗:', tkRes.body); process.exit(1); }
  const token = JSON.parse(tkRes.body).access_token;
  console.log('✓ Token 取得成功\n');

  // 2. 測試讀 searchAnalytics
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const siteEnc = encodeURIComponent(SITE_URL);
  const body = JSON.stringify({ startDate: start, endDate: end, dimensions: [], rowLimit: 1 });

  const saRes = await httpJSON({
    hostname: 'www.googleapis.com',
    path: `/webmasters/v3/sites/${siteEnc}/searchAnalytics/query`,
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, body);

  console.log('搜尋分析 read 測試 status:', saRes.status);
  if (saRes.status === 200) {
    const d = JSON.parse(saRes.body);
    const r = (d.rows || [])[0] || {};
    console.log('✓ 讀權限 OK — 30 天曝光:', r.impressions || 0, '點擊:', r.clicks || 0);
  } else {
    console.error('✗ 讀權限失敗:', saRes.body);
    process.exit(2);
  }

  // 3. 測試 URL Inspection
  const inspBody = JSON.stringify({ inspectionUrl: 'https://toosterx.com/', siteUrl: SITE_URL });
  const inspRes = await httpJSON({
    hostname: 'searchconsole.googleapis.com',
    path: '/v1/urlInspection/index:inspect',
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(inspBody) }
  }, inspBody);
  console.log('\nURL Inspection 測試 status:', inspRes.status);
  if (inspRes.status === 200) {
    const d = JSON.parse(inspRes.body);
    const v = (d.inspectionResult || {}).indexStatusResult || {};
    console.log('✓ Inspection OK — 首頁 verdict:', v.verdict);
  } else {
    console.error('✗ Inspection 失敗:', inspRes.body);
    process.exit(3);
  }

  // 4. 測試 sitemaps 狀態讀取
  const smRes = await httpJSON({
    hostname: 'www.googleapis.com',
    path: `/webmasters/v3/sites/${siteEnc}/sitemaps`,
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  console.log('\nSitemaps 狀態讀取測試 status:', smRes.status);
  if (smRes.status === 200) {
    const d = JSON.parse(smRes.body);
    const count = (d.sitemap || []).length;
    console.log('✓ Sitemaps 讀取 OK —', count, '個 sitemap');
  } else {
    console.error('✗ Sitemaps 讀取失敗:', smRes.body);
    process.exit(4);
  }

  console.log('\n=== 全部通過 ✓ — Service Account 可用於 SEO Dashboard ===');
}

main().catch(err => { console.error('執行錯誤:', err.message); process.exit(99); });
