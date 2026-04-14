/**
 * migrate-team-uids.js
 *
 * Phase 3 教練 UID 化遷移腳本（§11.6）
 *
 * 功能：
 *   1. 讀取所有 teams 文件
 *   2. 讀取所有 users 文件
 *   3. 對每個 team：
 *      a. coaches[] 名字 → 查 users 比對 name/displayName → 取得 uid → 寫入 coachUids
 *      b. captain 名字 → 寫入 captainName（captainUid 已有）
 *      c. leaders[] 名字 → 寫入 leaderNames（leaderUids 已有）
 *      d. leaderUid（單數）→ 合併進 leaderUids（陣列）
 *   4. 未匹配到 UID 的教練 → 保留名字在 coachNames，coachUids 留空 + 輸出報告
 *
 * 冪等：可重複執行不產生重複資料
 * 同名教練：標記為模糊匹配，不自動分配
 *
 * 使用方式：
 *   GCP_KEY_FILE=path/to/key.json node scripts/migrate-team-uids.js
 *   GCP_KEY_FILE=path/to/key.json node scripts/migrate-team-uids.js --dry-run
 */

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');

const PROJECT_ID = 'fc-football-6c8dc';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const DRY_RUN = process.argv.includes('--dry-run');

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

// --- Helpers ---
function getStringField(fields, key) {
  return (fields[key]?.stringValue || '').trim();
}

function getArrayStringField(fields, key) {
  const arr = fields[key]?.arrayValue?.values;
  if (!Array.isArray(arr)) return [];
  return arr.map(v => (v.stringValue || '').trim()).filter(Boolean);
}

function toFirestoreStringArray(arr) {
  return {
    arrayValue: {
      values: arr.map(s => ({ stringValue: s })),
    },
  };
}

/**
 * Build a name → uid lookup from users collection.
 * Returns { byExactName: Map<lowerName, {uid, name, ambiguous}[]> }
 */
function buildUserNameIndex(userDocs) {
  const byName = new Map();

  for (const doc of userDocs) {
    const fields = doc.fields || {};
    const uid = getStringField(fields, 'uid') || getStringField(fields, 'lineUserId') || doc.name.split('/').pop();
    const name = getStringField(fields, 'name');
    const displayName = getStringField(fields, 'displayName');

    const names = new Set();
    if (name) names.add(name.toLowerCase());
    if (displayName) names.add(displayName.toLowerCase());

    for (const lowerName of names) {
      if (!byName.has(lowerName)) byName.set(lowerName, []);
      byName.get(lowerName).push({ uid, name: name || displayName });
    }
  }

  return byName;
}

function resolveCoachUid(coachName, nameIndex) {
  const lower = coachName.toLowerCase();
  const candidates = nameIndex.get(lower);
  if (!candidates || candidates.length === 0) {
    return { uid: null, status: 'unmatched' };
  }
  // Deduplicate by uid
  const uniqueUids = [...new Set(candidates.map(c => c.uid))];
  if (uniqueUids.length === 1) {
    return { uid: uniqueUids[0], status: 'matched' };
  }
  return { uid: null, status: 'ambiguous', candidates: uniqueUids };
}

// --- Main ---
async function main() {
  console.log('=== Phase 3: Team Coach UID Migration ===');
  if (DRY_RUN) console.log('>>> DRY RUN MODE — no writes will be made <<<');
  console.log('');

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

  // 1. Read all users
  console.log('Reading users...');
  const userDocs = await firestoreList(token, 'users');
  console.log(`  Found ${userDocs.length} users.`);
  const nameIndex = buildUserNameIndex(userDocs);

  // 2. Read all teams
  console.log('Reading teams...');
  const teamDocs = await firestoreList(token, 'teams');
  console.log(`  Found ${teamDocs.length} teams.\n`);

  const report = {
    updated: 0,
    skipped: 0,
    unmatchedCoaches: [],
    ambiguousCoaches: [],
    leaderUidMerged: 0,
  };

  for (const doc of teamDocs) {
    const fields = doc.fields || {};
    const teamId = doc.name.split('/').pop();
    const teamName = getStringField(fields, 'name');
    const coaches = getArrayStringField(fields, 'coaches');
    const existingCoachUids = getArrayStringField(fields, 'coachUids');
    const captainName = getStringField(fields, 'captain');
    const leaders = getArrayStringField(fields, 'leaders');
    const leaderSingle = getStringField(fields, 'leader');
    const leaderUidSingle = getStringField(fields, 'leaderUid');
    const existingLeaderUids = getArrayStringField(fields, 'leaderUids');

    const patchFields = {};
    let needsUpdate = false;

    // --- a. coaches → coachUids ---
    if (coaches.length > 0 && existingCoachUids.length === 0) {
      const resolvedUids = [];
      const coachNames = [];
      let hasUnmatched = false;

      for (const coachName of coaches) {
        const result = resolveCoachUid(coachName, nameIndex);
        coachNames.push(coachName);
        if (result.status === 'matched') {
          resolvedUids.push(result.uid);
        } else if (result.status === 'ambiguous') {
          report.ambiguousCoaches.push({ teamId, teamName, coachName, candidates: result.candidates });
          hasUnmatched = true;
        } else {
          report.unmatchedCoaches.push({ teamId, teamName, coachName });
          hasUnmatched = true;
        }
      }

      if (resolvedUids.length > 0 || !hasUnmatched) {
        patchFields.coachUids = toFirestoreStringArray(resolvedUids);
        needsUpdate = true;
      } else {
        // All unmatched — still write empty coachUids to mark as processed
        patchFields.coachUids = toFirestoreStringArray([]);
        needsUpdate = true;
      }

      // Always write coachNames for display cache
      patchFields.coachNames = toFirestoreStringArray(coachNames);
      needsUpdate = true;
    } else if (coaches.length === 0 && existingCoachUids.length === 0) {
      // No coaches at all — ensure coachUids exists as empty array (idempotent)
      if (!fields.coachUids) {
        patchFields.coachUids = toFirestoreStringArray([]);
        patchFields.coachNames = toFirestoreStringArray([]);
        needsUpdate = true;
      }
    }

    // --- b. captain name → captainName display cache ---
    if (captainName && !getStringField(fields, 'captainName')) {
      patchFields.captainName = { stringValue: captainName };
      needsUpdate = true;
    }

    // --- c. leaders → leaderNames display cache ---
    const leaderNamesList = leaders.length > 0 ? leaders : (leaderSingle ? [leaderSingle] : []);
    if (leaderNamesList.length > 0 && getArrayStringField(fields, 'leaderNames').length === 0) {
      patchFields.leaderNames = toFirestoreStringArray(leaderNamesList);
      needsUpdate = true;
    }

    // --- d. leaderUid (singular) → merge into leaderUids (array) ---
    if (leaderUidSingle && !existingLeaderUids.includes(leaderUidSingle)) {
      const mergedLeaderUids = [...new Set([...existingLeaderUids, leaderUidSingle])];
      patchFields.leaderUids = toFirestoreStringArray(mergedLeaderUids);
      needsUpdate = true;
      report.leaderUidMerged++;
    }

    if (!needsUpdate) {
      report.skipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log(`  [DRY] Would update team "${teamName}" (${teamId}): ${Object.keys(patchFields).join(', ')}`);
      if (patchFields.coachUids) {
        const uids = (patchFields.coachUids.arrayValue.values || []).map(v => v.stringValue);
        console.log(`         coachUids: [${uids.join(', ')}]`);
      }
    } else {
      await firestorePatch(token, doc.name, patchFields);
      console.log(`  Updated team "${teamName}" (${teamId}): ${Object.keys(patchFields).join(', ')}`);
    }
    report.updated++;
  }

  // --- Report ---
  console.log('\n=== Migration Report ===');
  console.log(`  Teams updated: ${report.updated}`);
  console.log(`  Teams skipped (no changes needed): ${report.skipped}`);
  console.log(`  leaderUid→leaderUids merged: ${report.leaderUidMerged}`);

  if (report.unmatchedCoaches.length > 0) {
    console.log(`\n  ⚠️ UNMATCHED coaches (${report.unmatchedCoaches.length}):`);
    for (const item of report.unmatchedCoaches) {
      console.log(`    - Team "${item.teamName}" (${item.teamId}): coach "${item.coachName}" not found in users`);
    }
  }

  if (report.ambiguousCoaches.length > 0) {
    console.log(`\n  ⚠️ AMBIGUOUS coaches (${report.ambiguousCoaches.length}):`);
    for (const item of report.ambiguousCoaches) {
      console.log(`    - Team "${item.teamName}" (${item.teamId}): coach "${item.coachName}" matches ${item.candidates.length} users: [${item.candidates.join(', ')}]`);
    }
  }

  const totalUnresolved = report.unmatchedCoaches.length + report.ambiguousCoaches.length;
  if (totalUnresolved === 0) {
    console.log('\n  ✅ All coaches matched successfully! Safe to proceed to Phase 3-coach-d.');
  } else {
    console.log(`\n  ❌ ${totalUnresolved} unresolved coach(es). Resolve manually before Phase 3-coach-d.`);
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
