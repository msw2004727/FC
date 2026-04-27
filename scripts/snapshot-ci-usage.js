#!/usr/bin/env node
/**
 * snapshot-ci-usage.js
 *
 * 從 GitHub Actions API 抓近 30 天 workflow runs，
 * 統計每個 workflow 的次數 / 累計時間 / 成功率，
 * 寫入 Firestore ciUsageSnapshots/{YYYY-MM-DD}，供 admin dashboard 顯示。
 *
 * 環境變數：
 *   GITHUB_TOKEN — GitHub Actions 自動注入
 *   GCP_SERVICE_ACCOUNT_JSON — 既有 secret
 *
 * 沿用 scripts/gsc-snapshot.js 的零依賴 REST API 模式。
 */

const https = require('https');
const crypto = require('crypto');

// ─── 設定 ───────────────────────────────────────────────
const FIRESTORE_PROJECT = 'fc-football-6c8dc';
const COLLECTION = 'ciUsageSnapshots';
const REPO = 'msw2004727/FC';
const PERIOD_DAYS = 30;
const FREE_TIER_MINUTES = 2000; // GitHub Free Tier 上限
const OAUTH_SCOPES = 'https://www.googleapis.com/auth/datastore';

// ─── HTTP Helpers ───────────────────────────────────────
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

// ─── OAuth JWT（沿用 gsc-snapshot.js 模式）────────────
function base64url(data) {
  return Buffer.from(data).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createJWT(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email, scope: OAUTH_SCOPES,
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  };
  const segs = [base64url(JSON.stringify(header)), base64url(JSON.stringify(payload))];
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(segs.join('.'));
  const sig = sign.sign(sa.private_key, 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return segs.join('.') + '.' + sig;
}

async function getGcpToken(sa) {
  const jwt = createJWT(sa);
  const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
  const res = await httpJSON({
    hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
  }, body);
  if (res.status !== 200) throw new Error(`OAuth failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.access_token;
}

// ─── GitHub API ─────────────────────────────────────────
async function fetchGitHubRuns(token) {
  // 抓 5 頁、約 500 筆（覆蓋活躍 repo 30+ 天）
  const allRuns = [];
  for (let page = 1; page <= 5; page++) {
    const res = await httpJSON({
      hostname: 'api.github.com',
      path: `/repos/${REPO}/actions/runs?per_page=100&page=${page}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'snapshot-ci-usage/1.0',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (res.status !== 200) {
      console.warn(`[snapshot-ci-usage] GitHub API page ${page} 失敗 (${res.status})`);
      break;
    }
    const runs = res.body.workflow_runs || [];
    allRuns.push(...runs);
    if (runs.length < 100) break; // 最後一頁
  }
  return allRuns;
}

// ─── 統計 ───────────────────────────────────────────────
function aggregate(runs) {
  const sinceMs = Date.now() - PERIOD_DAYS * 86400000;
  const recent = runs.filter(r => new Date(r.run_started_at || r.created_at).getTime() >= sinceMs);

  const byWorkflow = {};
  let totalSec = 0;
  let totalCount = 0;
  let succCount = 0;
  let failCount = 0;

  recent.forEach(r => {
    const name = r.name || '(unknown)';
    const start = new Date(r.run_started_at || r.created_at).getTime();
    const end = new Date(r.updated_at).getTime();
    const sec = Math.max(0, Math.round((end - start) / 1000));
    const conclusion = r.conclusion || 'in_progress';

    if (!byWorkflow[name]) {
      byWorkflow[name] = { count: 0, totalSec: 0, success: 0, failure: 0, other: 0 };
    }
    byWorkflow[name].count += 1;
    byWorkflow[name].totalSec += sec;
    if (conclusion === 'success') byWorkflow[name].success += 1;
    else if (conclusion === 'failure') byWorkflow[name].failure += 1;
    else byWorkflow[name].other += 1;

    totalSec += sec;
    totalCount += 1;
    if (conclusion === 'success') succCount += 1;
    else if (conclusion === 'failure') failCount += 1;
  });

  const totalMin = Math.round(totalSec / 60);
  const usagePct = Math.round((totalMin / FREE_TIER_MINUTES) * 100 * 10) / 10;

  // workflow 排名陣列、便於前端顯示
  const workflows = Object.entries(byWorkflow)
    .map(([name, s]) => ({
      name,
      count: s.count,
      totalMinutes: Math.round(s.totalSec / 60 * 10) / 10,
      avgSec: Math.round(s.totalSec / s.count),
      success: s.success, failure: s.failure, other: s.other,
    }))
    .sort((a, b) => b.totalMinutes - a.totalMinutes);

  return {
    asOf: new Date().toISOString(),
    repo: REPO,
    periodDays: PERIOD_DAYS,
    totalRuns: totalCount,
    totalMinutes: totalMin,
    successCount: succCount,
    failureCount: failCount,
    successRate: totalCount > 0 ? Math.round((succCount / totalCount) * 1000) / 10 : 0,
    freeTierMinutes: FREE_TIER_MINUTES,
    usagePct,
    workflows,
  };
}

// ─── Firestore 寫入 ─────────────────────────────────────
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

async function writeFirestore(token, dateKey, data) {
  const body = JSON.stringify({
    fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, fsValue(v)])),
  });
  const res = await httpJSON({
    hostname: 'firestore.googleapis.com',
    path: `/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/${COLLECTION}/${dateKey}`,
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);
  if (res.status !== 200) {
    throw new Error(`Firestore write failed (${res.status}): ${JSON.stringify(res.body).slice(0, 300)}`);
  }
}

// ─── 主流程 ─────────────────────────────────────────────
(async () => {
  try {
    const ghToken = process.env.GITHUB_TOKEN;
    const saJson = process.env.GCP_SERVICE_ACCOUNT_JSON;
    if (!ghToken) {
      console.error('[snapshot-ci-usage] 缺少 GITHUB_TOKEN');
      process.exit(0);
    }
    if (!saJson) {
      console.error('[snapshot-ci-usage] 缺少 GCP_SERVICE_ACCOUNT_JSON');
      process.exit(0);
    }
    let sa;
    try { sa = JSON.parse(saJson); }
    catch (e) {
      console.error('[snapshot-ci-usage] 解析 SA JSON 失敗:', e.message);
      process.exit(0);
    }

    console.log('[snapshot-ci-usage] 拉取 GitHub Actions runs...');
    const runs = await fetchGitHubRuns(ghToken);
    console.log(`[snapshot-ci-usage] 收到 ${runs.length} 筆 runs`);

    const data = aggregate(runs);
    console.log(`[snapshot-ci-usage] 近 ${PERIOD_DAYS} 天: ${data.totalRuns} runs / ${data.totalMinutes} 分鐘 / ${data.usagePct}% 配額`);
    console.log(`[snapshot-ci-usage] Top 3 workflows:`);
    data.workflows.slice(0, 3).forEach(w => {
      console.log(`  - ${w.name}: ${w.count} runs / ${w.totalMinutes} min`);
    });

    console.log('[snapshot-ci-usage] 取得 GCP token...');
    const gcpToken = await getGcpToken(sa);

    const today = new Date();
    const dateKey = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`;
    console.log(`[snapshot-ci-usage] 寫入 Firestore: ${COLLECTION}/${dateKey}`);
    await writeFirestore(gcpToken, dateKey, data);

    // 也寫一份 latest 文件、前端只需讀一個固定路徑
    await writeFirestore(gcpToken, 'latest', data);

    console.log('[snapshot-ci-usage] 完成');
    process.exit(0);
  } catch (err) {
    console.error('[snapshot-ci-usage] 失敗:', err.message);
    console.error(err.stack);
    process.exit(0); // 不阻塞 CI
  }
})();
