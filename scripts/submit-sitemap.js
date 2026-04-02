/**
 * submit-sitemap.js
 *
 * 自動提交 sitemap.xml 給 Google Search Console API。
 *
 * 使用方式：
 *   node scripts/submit-sitemap.js
 *
 * 環境變數（GitHub Actions 透過 Secrets 注入）：
 *   GCP_SERVICE_ACCOUNT_JSON — Service Account 金鑰 JSON 字串
 *
 * 或本地使用：
 *   GCP_KEY_FILE — Service Account 金鑰檔案路徑
 */

const https = require('https');

const SITE_URL = 'https://toosterx.com/';
const SITEMAP_URL = 'https://toosterx.com/sitemap.xml';
const SCOPE = 'https://www.googleapis.com/auth/webmasters';

// --- JWT 產生（不依賴外部套件） ---

function base64url(data) {
  return Buffer.from(data).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createJWT(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    scope: SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };

  const segments = [
    base64url(JSON.stringify(header)),
    base64url(JSON.stringify(payload))
  ];

  const crypto = require('crypto');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(segments.join('.'));
  const signature = sign.sign(serviceAccount.private_key, 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  return segments.join('.') + '.' + signature;
}

// --- HTTP 工具（原生 https，不依賴外部套件） ---

function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getAccessToken(serviceAccount) {
  const jwt = createJWT(serviceAccount);
  const postData = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;

  const res = await httpRequest({
    hostname: 'oauth2.googleapis.com',
    path: '/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData)
    }
  }, postData);

  if (res.status !== 200) {
    throw new Error(`OAuth token 取得失敗 (${res.status}): ${res.body}`);
  }
  return JSON.parse(res.body).access_token;
}

async function submitSitemap(accessToken) {
  const siteEncoded = encodeURIComponent(SITE_URL);
  const sitemapEncoded = encodeURIComponent(SITEMAP_URL);
  const path = `/webmasters/v3/sites/${siteEncoded}/sitemaps/${sitemapEncoded}`;

  const res = await httpRequest({
    hostname: 'www.googleapis.com',
    path: path,
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Length': 0
    }
  });

  return res;
}

// --- 主程式 ---

async function main() {
  console.log('=== Google Search Console Sitemap 自動提交 ===\n');

  // 讀取 Service Account 金鑰
  let serviceAccount;
  if (process.env.GCP_SERVICE_ACCOUNT_JSON) {
    serviceAccount = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_JSON);
    console.log('✓ 從環境變數讀取 Service Account');
  } else if (process.env.GCP_KEY_FILE) {
    const fs = require('fs');
    serviceAccount = JSON.parse(fs.readFileSync(process.env.GCP_KEY_FILE, 'utf8'));
    console.log(`✓ 從檔案讀取 Service Account: ${process.env.GCP_KEY_FILE}`);
  } else {
    console.error('✗ 錯誤：請設定 GCP_SERVICE_ACCOUNT_JSON 或 GCP_KEY_FILE 環境變數');
    console.error('  詳見 scripts/SETUP-GSC-API.md');
    process.exit(1);
  }

  console.log(`  Email: ${serviceAccount.client_email}`);
  console.log(`  Site:  ${SITE_URL}`);
  console.log(`  Map:   ${SITEMAP_URL}\n`);

  // 取得 OAuth token
  console.log('→ 取得 OAuth Access Token...');
  const token = await getAccessToken(serviceAccount);
  console.log('✓ Token 取得成功\n');

  // 提交 sitemap
  console.log('→ 提交 sitemap 給 Google Search Console...');
  const result = await submitSitemap(token);

  if (result.status === 200 || result.status === 204) {
    console.log('✓ Sitemap 提交成功！Google 將重新爬取 sitemap.xml\n');
  } else {
    console.error(`✗ 提交失敗 (HTTP ${result.status}): ${result.body}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('✗ 執行錯誤:', err.message);
  process.exit(1);
});
