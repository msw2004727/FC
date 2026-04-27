#!/usr/bin/env node
/**
 * inject-hot-events.js
 *
 * 從 Firestore 抓最近 6 場熱門活動，inline 注入 index.html 的
 *   <script id="boot-events-data" type="application/json">...</script>
 * 區塊（用 <!-- BOOT_EVENTS_INJECT_BEGIN/END --> 註解定位、idempotent）。
 *
 * 用戶開首頁時可在 Phase 2.5 直接讀取此 JSON、跳過等待 Firebase SDK
 * 載入 + Firestore 查詢的時間，達到「秒開」效果。
 *
 * 環境變數：
 *   GCP_SERVICE_ACCOUNT_JSON — Service Account JSON 字串（既有 secret）
 *
 * 沿用 scripts/gsc-snapshot.js 的零依賴 REST API 模式。
 *
 * 失敗時 exit code 0（不阻塞 CI）；index.html 維持上次 inline 結果。
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

// ─── 設定 ───────────────────────────────────────────────
const FIRESTORE_PROJECT = 'fc-football-6c8dc';
const COLLECTION = 'events';
const TARGET_EVENT_COUNT = 6;
const FETCH_PAGE_SIZE = 30; // 多撈一些做篩選
const OAUTH_SCOPES = 'https://www.googleapis.com/auth/datastore';
const INDEX_HTML_PATH = path.resolve(__dirname, '..', 'index.html');
const MARKER_BEGIN = '<!-- BOOT_EVENTS_INJECT_BEGIN -->';
const MARKER_END = '<!-- BOOT_EVENTS_INJECT_END -->';

// 注入到首頁卡需要的欄位（控制 HTML 大小）
const KEEP_FIELDS = [
  'id', 'title', 'image', 'location', 'date', 'type', 'sport', 'status',
  'region', 'current', 'waitlist', 'max', 'pinned', 'pinOrder',
  'teamOnly', 'privateEvent', 'allowExternal',
  'creatorUid', 'creatorTeamIds',
  'gender', 'ageMin', 'ageMax', 'fee', 'feeEnabled',
  'blockedUids', // 用戶可見性過濾
];

// ─── OAuth JWT（複用 gsc-snapshot.js 模式）───────────────
function base64url(data) {
  return Buffer.from(data).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createJWT(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    scope: OAUTH_SCOPES,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  };
  const segs = [base64url(JSON.stringify(header)), base64url(JSON.stringify(payload))];
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(segs.join('.'));
  const sig = sign.sign(sa.private_key, 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
  }, body);
  if (res.status !== 200) throw new Error(`OAuth failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.access_token;
}

// ─── Firestore typed value → plain JS（遞迴）─────────────
function fromFirestoreValue(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue; // 保留 ISO 字串
  if ('arrayValue' in v) {
    const arr = v.arrayValue?.values || [];
    return arr.map(fromFirestoreValue);
  }
  if ('mapValue' in v) {
    const fields = v.mapValue?.fields || {};
    const obj = {};
    for (const [k, val] of Object.entries(fields)) obj[k] = fromFirestoreValue(val);
    return obj;
  }
  return null;
}

function fromFirestoreDoc(doc) {
  const fields = doc.fields || {};
  const obj = {};
  for (const [k, v] of Object.entries(fields)) obj[k] = fromFirestoreValue(v);
  // doc.name 格式: projects/{p}/databases/{d}/documents/events/{docId}
  const docId = (doc.name || '').split('/').pop() || '';
  obj._docId = docId;
  return obj;
}

// ─── 抓 events ───────────────────────────────────────────
async function fetchEvents(token) {
  const reqPath = `/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/${COLLECTION}?pageSize=${FETCH_PAGE_SIZE}`;
  const res = await httpJSON({
    hostname: 'firestore.googleapis.com', path: reqPath, method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status !== 200) throw new Error(`Firestore fetch failed (${res.status}): ${JSON.stringify(res.body).slice(0, 200)}`);
  const docs = res.body.documents || [];
  return docs.map(fromFirestoreDoc);
}

// ─── 篩選 + 排序（鏡像 renderHotEvents 邏輯）────────────
function pickHotEvents(events) {
  const now = Date.now();
  const candidates = events
    .filter(e => e && e.id && e.title)
    .filter(e => e.status !== 'ended' && e.status !== 'cancelled')
    .filter(e => !e.privateEvent) // SEO 友善：不公開活動不 inline
    .map(e => {
      // 解析活動日期（格式如 "2026/04/27 19:30"）
      const dateStr = String(e.date || '');
      let dateMs = 0;
      const m = dateStr.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
      if (m) {
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        dateMs = d.getTime();
      }
      return { ...e, _dateMs: dateMs };
    })
    .filter(e => e._dateMs === 0 || e._dateMs >= now - 86400000) // 排除昨天以前
    .sort((a, b) => {
      // pinned 優先
      const ap = a.pinned ? 1 : 0;
      const bp = b.pinned ? 1 : 0;
      if (ap !== bp) return bp - ap;
      if (ap && bp) {
        const ao = Number(a.pinOrder) || 0;
        const bo = Number(b.pinOrder) || 0;
        if (ao !== bo) return ao - bo;
      }
      // 日期由近到遠
      return (a._dateMs || 0) - (b._dateMs || 0);
    })
    .slice(0, TARGET_EVENT_COUNT);

  // 移除暫存欄位 + 只保留 KEEP_FIELDS
  return candidates.map(e => {
    const slim = {};
    KEEP_FIELDS.forEach(f => {
      if (e[f] !== undefined && e[f] !== null) slim[f] = e[f];
    });
    return slim;
  });
}

// ─── 注入 index.html ─────────────────────────────────────
function buildInjectionBlock(events, ts) {
  // 防 XSS：JSON 內若含 `</script>` 會破壞 HTML 解析、必須 escape
  // U+2028 / U+2029 是 JS 字串中可被當成行終止符的字元、會破壞 inline JSON 解析
  // 使用 unicode escape 取代字面字元（避免檔案內出現隱形 BiDi 控制符）
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  const json = JSON.stringify(events)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .split(LS).join('\\u2028')
    .split(PS).join('\\u2029');
  return `${MARKER_BEGIN}\n  <script id="boot-events-data" type="application/json" data-ts="${ts}" data-count="${events.length}">${json}</script>\n  ${MARKER_END}`;
}

function injectIntoIndex(events) {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  const ts = Date.now();
  const block = buildInjectionBlock(events, ts);

  // 已有 BEGIN/END → 替換中間（idempotent）
  const beginIdx = html.indexOf(MARKER_BEGIN);
  const endIdx = html.indexOf(MARKER_END);

  let next;
  if (beginIdx >= 0 && endIdx > beginIdx) {
    const before = html.slice(0, beginIdx);
    const after = html.slice(endIdx + MARKER_END.length);
    next = before + block + after;
  } else {
    // 首次：插在 </head> 之前（HTML 解析早期就可讀到）
    const headCloseIdx = html.indexOf('</head>');
    if (headCloseIdx < 0) throw new Error('找不到 </head>，無法注入');
    next = html.slice(0, headCloseIdx) + '  ' + block + '\n' + html.slice(headCloseIdx);
  }

  // diff check：內容除了 ts 屬性以外都相同 → 不寫入（避免每次 commit 只是 ts 變動）
  const stripTs = (s) => s.replace(/data-ts="\d+"/g, 'data-ts="X"');
  if (stripTs(next) === stripTs(html)) {
    console.log('[inject-hot-events] HTML 內容無變更（活動相同、僅 ts 不同、不重寫）');
    return false;
  }

  fs.writeFileSync(INDEX_HTML_PATH, next, 'utf8');
  console.log(`[inject-hot-events] 已注入 ${events.length} 筆活動到 index.html (ts=${ts})`);
  return true;
}

// ─── 主流程 ─────────────────────────────────────────────
(async () => {
  try {
    const saJson = process.env.GCP_SERVICE_ACCOUNT_JSON;
    if (!saJson) {
      console.error('[inject-hot-events] 缺少 GCP_SERVICE_ACCOUNT_JSON 環境變數，跳過');
      process.exit(0); // 不阻塞 CI
    }
    let sa;
    try { sa = JSON.parse(saJson); }
    catch (e) {
      console.error('[inject-hot-events] GCP_SERVICE_ACCOUNT_JSON 解析失敗:', e.message);
      process.exit(0);
    }

    console.log('[inject-hot-events] 取得 access token...');
    const token = await getAccessToken(sa);

    console.log('[inject-hot-events] 拉取 Firestore events...');
    const allEvents = await fetchEvents(token);
    console.log(`[inject-hot-events] 收到 ${allEvents.length} 筆活動文件`);

    const hot = pickHotEvents(allEvents);
    console.log(`[inject-hot-events] 篩選後保留 ${hot.length} 筆`);
    if (hot.length === 0) {
      console.log('[inject-hot-events] 無有效熱門活動、跳過注入');
      process.exit(0);
    }

    // 大小檢查（防 HTML 過肥）
    const jsonSize = JSON.stringify(hot).length;
    console.log(`[inject-hot-events] JSON 大小: ${jsonSize} bytes`);
    if (jsonSize > 30000) {
      const cutTo = Math.max(3, Math.floor(TARGET_EVENT_COUNT / 2));
      console.warn(`[inject-hot-events] JSON 過大 (${jsonSize}b > 30KB)，截斷至前 ${cutTo} 筆`);
      hot.splice(cutTo);
    }

    const changed = injectIntoIndex(hot);
    if (!changed) {
      console.log('[inject-hot-events] index.html 內容未變、不需 commit');
      process.exit(0);
    }

    console.log('[inject-hot-events] 完成');
    process.exit(0);
  } catch (err) {
    console.error('[inject-hot-events] 失敗:', err.message);
    console.error(err.stack);
    process.exit(0); // 不阻塞 CI
  }
})();
