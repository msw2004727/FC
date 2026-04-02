/**
 * sync-changelog.js
 *
 * 從 git log 提取更新歷史，透過 Firestore REST API 寫入 changelog 集合。
 * 不需要 firebase-admin，只需要 GCP Service Account 金鑰。
 *
 * 資料結構：
 *   changelog/_index   → { months: ["2026-04", "2026-03", ...] }
 *   changelog/2026-04  → { days: { "2026-04-02": ["msg1","msg2",...] } }
 *
 * 使用方式（在專案根目錄執行）：
 *   GCP_KEY_FILE=path/to/key.json node scripts/sync-changelog.js
 *   GCP_KEY_FILE=path/to/key.json node scripts/sync-changelog.js 2026-04  # 只同步指定月份
 */

const { execSync } = require('child_process');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');

const PROJECT_ID = 'fc-football-6c8dc';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

// --- JWT / OAuth (same as submit-sitemap.js) ---
function base64url(data) {
  return Buffer.from(data).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createJWT(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iss: sa.client_email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const segments = [base64url(JSON.stringify(header)), base64url(JSON.stringify(payload))];
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(segments.join('.'));
  const signature = sign.sign(sa.private_key, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return segments.join('.') + '.' + signature;
}

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

async function getAccessToken(sa) {
  const jwt = createJWT(sa);
  const postData = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
  const res = await httpRequest({
    hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) }
  }, postData);
  if (res.status !== 200) throw new Error(`OAuth failed (${res.status}): ${res.body}`);
  return JSON.parse(res.body).access_token;
}

// --- Firestore REST API ---
async function firestoreSet(token, docPath, data) {
  const body = JSON.stringify({ fields: objectToFirestoreFields(data) });
  // 使用 v1beta1 endpoint 搭配 IAM 權限（繞過 Security Rules）
  const encodedPath = docPath.split('/').map(encodeURIComponent).join('/');
  const path = `/v1/projects/${PROJECT_ID}/databases/(default)/documents/${encodedPath}`;
  const res = await httpRequest({
    hostname: 'firestore.googleapis.com', path, method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (res.status !== 200) throw new Error(`Firestore PATCH ${docPath} failed (${res.status}): ${res.body}`);
}

function objectToFirestoreFields(obj) {
  const fields = {};
  for (const [key, val] of Object.entries(obj)) {
    if (Array.isArray(val)) {
      fields[key] = { arrayValue: { values: val.map(v => {
        if (typeof v === 'string') return { stringValue: v };
        return { stringValue: String(v) };
      })}};
    } else if (typeof val === 'object' && val !== null) {
      fields[key] = { mapValue: { fields: objectToFirestoreFields(val) } };
    } else if (typeof val === 'string') {
      fields[key] = { stringValue: val };
    } else if (typeof val === 'number') {
      fields[key] = { integerValue: String(val) };
    }
  }
  return fields;
}

// --- Git log ---
function getGitLog() {
  // 不加 --reverse，git log 預設最新在前
  const log = execSync('git log --all --format="%ad|%s" --date=short', {
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024
  });
  const grouped = {};
  log.trim().split('\n').filter(l => l.includes('|')).forEach(line => {
    const idx = line.indexOf('|');
    const date = line.substring(0, idx).trim();
    const msg = line.substring(idx + 1).trim();
    if (!msg || msg === 'Initial commit' || msg.startsWith('Merge ')) return;
    const ym = date.substring(0, 7);
    if (!grouped[ym]) grouped[ym] = {};
    if (!grouped[ym][date]) grouped[ym][date] = [];
    grouped[ym][date].push(msg); // 最新 commit 在最前面
  });
  return grouped;
}

// --- Main ---
async function main() {
  console.log('=== Changelog 同步至 Firestore ===\n');

  // Load service account
  let sa;
  if (process.env.GCP_SERVICE_ACCOUNT_JSON) {
    sa = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_JSON);
  } else if (process.env.GCP_KEY_FILE) {
    sa = JSON.parse(fs.readFileSync(process.env.GCP_KEY_FILE, 'utf8'));
  } else {
    console.error('請設定 GCP_SERVICE_ACCOUNT_JSON 或 GCP_KEY_FILE 環境變數');
    process.exit(1);
  }
  console.log(`SA: ${sa.client_email}`);

  // Get token
  const token = await getAccessToken(sa);
  console.log('✓ Token 取得成功\n');

  // Get git log
  const allData = getGitLog();
  const targetMonth = process.argv[2] || null;
  const monthsToSync = targetMonth
    ? [targetMonth].filter(m => allData[m])
    : Object.keys(allData);

  if (monthsToSync.length === 0) { console.log('沒有可同步的資料'); return; }

  let totalEntries = 0;
  for (const ym of monthsToSync) {
    const days = allData[ym];
    const dayCount = Object.keys(days).length;
    const entryCount = Object.values(days).flat().length;
    totalEntries += entryCount;
    console.log(`→ 寫入 ${ym}（${dayCount} 天 / ${entryCount} 筆）...`);
    await firestoreSet(token, `changelog/${ym}`, { days });
  }

  // Update index
  const allMonths = Object.keys(allData).sort().reverse();
  console.log(`→ 更新 _index（${allMonths.length} 個月份）...`);
  await firestoreSet(token, 'changelog/_index', { months: allMonths });

  console.log(`\n✓ 完成！${monthsToSync.length} 個月份，共 ${totalEntries} 筆更新紀錄`);
}

main().catch(err => { console.error('✗ 錯誤:', err.message); process.exit(1); });
