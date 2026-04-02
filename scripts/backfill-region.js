/**
 * backfill-region.js
 *
 * 將所有活動（不分狀態）設定為 regionEnabled: true, region: '中部',
 * cities: ['台中市','苗栗縣','彰化縣','南投縣','雲林縣']（中部全選）。
 * 使用 Firestore REST API + Service Account OAuth。
 *
 * 使用方式：
 *   GCP_KEY_FILE=path/to/key.json node scripts/backfill-region.js
 */

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');

const PROJECT_ID = 'fc-football-6c8dc';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

// --- JWT / OAuth ---
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
async function firestoreList(token, collectionPath) {
  const docs = [];
  let pageToken = '';
  while (true) {
    const query = pageToken ? `?pageSize=300&pageToken=${pageToken}` : '?pageSize=300';
    const encodedPath = collectionPath.split('/').map(encodeURIComponent).join('/');
    const path = `/v1/projects/${PROJECT_ID}/databases/(default)/documents/${encodedPath}${query}`;
    const res = await httpRequest({
      hostname: 'firestore.googleapis.com', path, method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.status !== 200) throw new Error(`Firestore LIST failed (${res.status}): ${res.body}`);
    const data = JSON.parse(res.body);
    if (data.documents) docs.push(...data.documents);
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return docs;
}

async function firestorePatch(token, docPath, fields) {
  const body = JSON.stringify({ fields });
  const updateMask = Object.keys(fields).map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const encodedPath = docPath.split('/').map(encodeURIComponent).join('/');
  const path = `/v1/${encodedPath}?${updateMask}`;
  const res = await httpRequest({
    hostname: 'firestore.googleapis.com', path, method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (res.status !== 200) throw new Error(`Firestore PATCH failed (${res.status}): ${res.body}`);
}

// --- Main ---
async function main() {
  console.log('=== Backfill Region for Events ===\n');

  let sa;
  if (process.env.GCP_SERVICE_ACCOUNT_JSON) {
    sa = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_JSON);
  } else if (process.env.GCP_KEY_FILE) {
    sa = JSON.parse(fs.readFileSync(process.env.GCP_KEY_FILE, 'utf8'));
  } else {
    console.error('ERROR: Set GCP_KEY_FILE or GCP_SERVICE_ACCOUNT_JSON');
    process.exit(1);
  }

  const token = await getAccessToken(sa);
  console.log('OAuth token obtained.\n');

  // List all events
  const docs = await firestoreList(token, 'events');
  console.log(`Found ${docs.length} events total.\n`);

  const CENTRAL_CITIES = ['台中市', '苗栗縣', '彰化縣', '南投縣', '雲林縣'];
  const citiesValue = { arrayValue: { values: CENTRAL_CITIES.map(c => ({ stringValue: c })) } };

  let updated = 0;
  let skipped = 0;
  for (const doc of docs) {
    const fields = doc.fields || {};
    // 檢查是否已經是中部全選，跳過不需更新的
    const curRegion = fields.region?.stringValue || '';
    const curEnabled = fields.regionEnabled?.booleanValue;
    const curCities = (fields.cities?.arrayValue?.values || []).map(v => v.stringValue).sort().join(',');
    const targetCities = [...CENTRAL_CITIES].sort().join(',');
    if (curEnabled === true && curRegion === '中部' && curCities === targetCities) {
      skipped++;
      continue;
    }

    await firestorePatch(token, doc.name, {
      regionEnabled: { booleanValue: true },
      region: { stringValue: '中部' },
      cities: citiesValue,
    });
    updated++;
    const docId = doc.name.split('/').pop();
    console.log(`  Updated: ${docId}`);
  }

  console.log(`\nDone. Updated ${updated} events, skipped ${skipped} (already correct).`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
