#!/usr/bin/env node
/**
 * Inject small homepage boot payloads into index.html.
 *
 * The app can render the homepage before Firebase SDK / Firestore finishes:
 * - boot-events-data: hot activity cards
 * - boot-banners-data: active banner carousel
 * - boot-tournaments-data: active tournament cards
 *
 * This script never fails CI/deploy. If Firestore is unavailable, it keeps the
 * existing inline payloads in index.html.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const FIRESTORE_PROJECT = 'fc-football-6c8dc';
const OAUTH_SCOPES = 'https://www.googleapis.com/auth/datastore';
const INDEX_HTML_PATH = path.resolve(__dirname, '..', 'index.html');
const FIREBASE_CONFIG_PATH = path.resolve(__dirname, '..', 'js', 'firebase-config.js');

const TARGET_EVENT_COUNT = 6;
const TARGET_BANNER_COUNT = 8;
const TARGET_TOURNAMENT_COUNT = 8;

const INJECTION_CONFIGS = {
  events: {
    collection: 'events',
    markerBegin: '<!-- BOOT_EVENTS_INJECT_BEGIN -->',
    markerEnd: '<!-- BOOT_EVENTS_INJECT_END -->',
    scriptId: 'boot-events-data',
    pageSize: 120,
    orderBy: null,
  },
  banners: {
    collection: 'banners',
    markerBegin: '<!-- BOOT_BANNERS_INJECT_BEGIN -->',
    markerEnd: '<!-- BOOT_BANNERS_INJECT_END -->',
    scriptId: 'boot-banners-data',
    pageSize: 30,
    orderBy: 'slot',
  },
  tournaments: {
    collection: 'tournaments',
    markerBegin: '<!-- BOOT_TOURNAMENTS_INJECT_BEGIN -->',
    markerEnd: '<!-- BOOT_TOURNAMENTS_INJECT_END -->',
    scriptId: 'boot-tournaments-data',
    pageSize: 80,
    orderBy: 'createdAt desc',
  },
};

const EVENT_KEEP_FIELDS = [
  'id', 'title', 'image', 'location', 'date', 'type', 'sport', 'status',
  'region', 'current', 'waitlist', 'max', 'pinned', 'pinOrder',
  'teamOnly', 'privateEvent', 'allowExternal',
  'creatorUid', 'creatorTeamIds',
  'gender', 'ageMin', 'ageMax', 'fee', 'feeEnabled',
  'blockedUids',
];

const BANNER_KEEP_FIELDS = [
  'id', '_docId', 'title', 'image', 'linkUrl', 'slotName', 'slot',
  'status', 'gradient', 'sortOrder', 'type',
];

const TOURNAMENT_KEEP_FIELDS = [
  'id', '_docId', 'name', 'image', 'type', 'teams', 'teamLimit', 'maxTeams',
  'ended', 'status', 'sportTag', 'hostTeamId', 'region', 'createdAt',
  'updatedAt', 'regStart', 'regEnd', 'matchDates', 'registeredTeams',
  'mode', 'typeCode',
];

function base64url(data) {
  return Buffer.from(data).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function createJWT(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    scope: OAUTH_SCOPES,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const segments = [base64url(JSON.stringify(header)), base64url(JSON.stringify(payload))];
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(segments.join('.'));
  const signature = sign.sign(sa.private_key, 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return segments.join('.') + '.' + signature;
}

function httpJSON(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} });
        } catch (err) {
          resolve({ status: res.statusCode, body: data, parseError: true });
        }
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
    hostname: 'oauth2.googleapis.com',
    path: '/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);
  if (res.status !== 200) throw new Error(`OAuth failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.access_token;
}

function readFirebaseApiKey() {
  try {
    const text = fs.readFileSync(FIREBASE_CONFIG_PATH, 'utf8');
    const match = text.match(/apiKey:\s*["']([^"']+)["']/);
    return match ? match[1] : '';
  } catch (_) {
    return '';
  }
}

function fromFirestoreValue(value) {
  if (value == null) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) {
    return (value.arrayValue.values || []).map(fromFirestoreValue);
  }
  if ('mapValue' in value) {
    const out = {};
    const fields = value.mapValue.fields || {};
    Object.entries(fields).forEach(([key, nested]) => {
      out[key] = fromFirestoreValue(nested);
    });
    return out;
  }
  return null;
}

function fromFirestoreDoc(doc) {
  const fields = doc.fields || {};
  const obj = {};
  Object.entries(fields).forEach(([key, value]) => {
    obj[key] = fromFirestoreValue(value);
  });
  const docId = (doc.name || '').split('/').pop() || '';
  obj._docId = docId;
  if (!obj.id && docId) obj.id = docId;
  return obj;
}

async function fetchCollection(auth, config, orderByOverride) {
  const params = new URLSearchParams();
  params.set('pageSize', String(config.pageSize || 30));
  const orderBy = orderByOverride === undefined ? config.orderBy : orderByOverride;
  if (orderBy) params.set('orderBy', orderBy);
  if (!auth.token && auth.apiKey) params.set('key', auth.apiKey);

  const reqPath = `/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/${config.collection}?${params.toString()}`;
  const headers = auth.token ? { Authorization: `Bearer ${auth.token}` } : {};
  const res = await httpJSON({
    hostname: 'firestore.googleapis.com',
    path: reqPath,
    method: 'GET',
    headers,
  });

  if (res.status !== 200 && orderBy) {
    console.warn(`[inject-hot-events] ${config.collection} orderBy failed (${res.status}); retrying without orderBy`);
    return fetchCollection(auth, config, null);
  }
  if (res.status !== 200) {
    throw new Error(`Firestore ${config.collection} fetch failed (${res.status}): ${JSON.stringify(res.body).slice(0, 200)}`);
  }
  return (res.body.documents || []).map(fromFirestoreDoc);
}

function slimRecord(record, fields) {
  const out = {};
  fields.forEach(field => {
    if (record[field] !== undefined && record[field] !== null) out[field] = record[field];
  });
  if (!out.id && record._docId) out.id = record._docId;
  if (fields.includes('_docId') && record._docId && !out._docId) out._docId = record._docId;
  return out;
}

function parseDateMs(dateValue) {
  if (!dateValue) return 0;
  if (typeof dateValue === 'number') return dateValue;
  const raw = String(dateValue);
  const slash = raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (slash) {
    return new Date(Number(slash[1]), Number(slash[2]) - 1, Number(slash[3])).getTime();
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickHotEvents(events) {
  const now = Date.now();
  return events
    .filter(e => e && e.id && e.title)
    .filter(e => e.status !== 'ended' && e.status !== 'cancelled')
    .filter(e => !e.privateEvent)
    .map(e => Object.assign({}, e, { _dateMs: parseDateMs(e.date) }))
    .filter(e => e._dateMs === 0 || e._dateMs >= now - 86400000)
    .sort((a, b) => {
      const ap = a.pinned ? 1 : 0;
      const bp = b.pinned ? 1 : 0;
      if (ap !== bp) return bp - ap;
      if (ap && bp) {
        const ao = Number(a.pinOrder) || 0;
        const bo = Number(b.pinOrder) || 0;
        if (ao !== bo) return ao - bo;
      }
      return (a._dateMs || 0) - (b._dateMs || 0);
    })
    .slice(0, TARGET_EVENT_COUNT)
    .map(e => slimRecord(e, EVENT_KEEP_FIELDS));
}

function pickActiveBanners(banners) {
  return banners
    .filter(b => b && b.status === 'active' && (b.image || b.gradient))
    .sort((a, b) => {
      const slotA = Number(a.slot || a.sortOrder || 0);
      const slotB = Number(b.slot || b.sortOrder || 0);
      if (slotA !== slotB) return slotA - slotB;
      return String(a.title || '').localeCompare(String(b.title || ''));
    })
    .slice(0, TARGET_BANNER_COUNT)
    .map(b => slimRecord(b, BANNER_KEEP_FIELDS));
}

function isTournamentEnded(tournament) {
  if (!tournament) return true;
  if (tournament.ended === true) return true;
  const status = String(tournament.status || '').toLowerCase();
  if (['ended', 'cancelled', 'canceled', 'archived'].includes(status)) return true;
  return /結束|已結束|取消/.test(String(tournament.status || ''));
}

function pickActiveTournaments(tournaments) {
  return tournaments
    .filter(t => t && (t.id || t._docId) && t.name)
    .filter(t => !isTournamentEnded(t))
    .sort((a, b) => {
      const ad = parseDateMs(a.regStart || a.createdAt || a.updatedAt);
      const bd = parseDateMs(b.regStart || b.createdAt || b.updatedAt);
      if (ad !== bd) return bd - ad;
      return String(a.name || '').localeCompare(String(b.name || ''));
    })
    .slice(0, TARGET_TOURNAMENT_COUNT)
    .map(t => slimRecord(t, TOURNAMENT_KEEP_FIELDS));
}

function describeRecord(record, key) {
  if (!record) return '';
  const id = record.id || record._docId || '(no-id)';
  if (key === 'events') {
    return `${id}@${record.date || 'no-date'}`;
  }
  if (key === 'tournaments') {
    return `${id}@${record.regStart || record.createdAt || record.updatedAt || 'no-date'}`;
  }
  if (key === 'banners') {
    return `${id}@slot:${record.slot || record.sortOrder || '0'}`;
  }
  return id;
}

function logPickedRecords(key, records) {
  const summary = (records || []).map(record => describeRecord(record, key)).join(', ');
  console.log(`[inject-hot-events] ${key}: picked records ${summary || '(none)'}`);
}

function escapeInlineJson(value) {
  const lineSep = String.fromCharCode(0x2028);
  const paraSep = String.fromCharCode(0x2029);
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .split(lineSep).join('\\u2028')
    .split(paraSep).join('\\u2029');
}

function buildInjectionBlock(config, records, ts) {
  return `${config.markerBegin}\n  <script id="${config.scriptId}" type="application/json" data-ts="${ts}" data-count="${records.length}">${escapeInlineJson(records)}</script>\n  ${config.markerEnd}`;
}

function upsertBlock(html, config, block, anchorMarkerEnd) {
  const beginIdx = html.indexOf(config.markerBegin);
  const endIdx = html.indexOf(config.markerEnd);
  if (beginIdx >= 0 && endIdx > beginIdx) {
    return html.slice(0, beginIdx) + block + html.slice(endIdx + config.markerEnd.length);
  }

  if (anchorMarkerEnd) {
    const anchorIdx = html.indexOf(anchorMarkerEnd);
    if (anchorIdx >= 0) {
      const insertAt = anchorIdx + anchorMarkerEnd.length;
      return html.slice(0, insertAt) + '\n  ' + block + html.slice(insertAt);
    }
  }

  const headCloseIdx = html.indexOf('</head>');
  if (headCloseIdx < 0) throw new Error('index.html missing </head>');
  return html.slice(0, headCloseIdx) + '  ' + block + '\n' + html.slice(headCloseIdx);
}

function injectIntoIndex(payloads) {
  const original = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  let html = original;
  const ts = Date.now();

  payloads.forEach(payload => {
    if (!payload || !Array.isArray(payload.records)) return;
    const block = buildInjectionBlock(payload.config, payload.records, ts);
    html = upsertBlock(html, payload.config, block, payload.anchorMarkerEnd);
  });

  const stripTs = s => s.replace(/data-ts="\d+"/g, 'data-ts="X"');
  if (stripTs(html) === stripTs(original)) {
    console.log('[inject-hot-events] index.html payload unchanged');
    return false;
  }

  fs.writeFileSync(INDEX_HTML_PATH, html, 'utf8');
  console.log(`[inject-hot-events] index.html updated (ts=${ts})`);
  return true;
}

async function buildAuth() {
  const saJson = process.env.GCP_SERVICE_ACCOUNT_JSON;
  if (saJson) {
    const sa = JSON.parse(saJson);
    console.log('[inject-hot-events] using service account auth');
    return { token: await getAccessToken(sa), apiKey: '' };
  }

  const apiKey = readFirebaseApiKey();
  if (!apiKey) throw new Error('No GCP_SERVICE_ACCOUNT_JSON and no Firebase apiKey found');
  console.log('[inject-hot-events] using public Firestore REST fallback');
  return { token: '', apiKey };
}

async function safePayload(auth, key, picker) {
  const config = INJECTION_CONFIGS[key];
  try {
    const docs = await fetchCollection(auth, config);
    const records = picker(docs);
    console.log(`[inject-hot-events] ${key}: fetched ${docs.length}, picked ${records.length}`);
    logPickedRecords(key, records);
    return { key, config, records };
  } catch (err) {
    console.warn(`[inject-hot-events] ${key}: skipped (${err.message})`);
    return null;
  }
}

(async () => {
  try {
    const auth = await buildAuth();
    const events = await safePayload(auth, 'events', pickHotEvents);
    const banners = await safePayload(auth, 'banners', pickActiveBanners);
    const tournaments = await safePayload(auth, 'tournaments', pickActiveTournaments);

    const payloads = [
      events,
      banners && Object.assign(banners, { anchorMarkerEnd: INJECTION_CONFIGS.events.markerEnd }),
      tournaments && Object.assign(tournaments, { anchorMarkerEnd: INJECTION_CONFIGS.banners.markerEnd }),
    ].filter(Boolean);

    const totalJsonBytes = payloads.reduce((sum, payload) => sum + JSON.stringify(payload.records).length, 0);
    console.log(`[inject-hot-events] total inline JSON size: ${totalJsonBytes} bytes`);
    if (totalJsonBytes > 45000) {
      console.warn('[inject-hot-events] inline JSON is larger than expected; keeping records but review if this grows');
    }

    if (!payloads.length) {
      console.log('[inject-hot-events] no payloads fetched; keeping existing index.html');
      process.exit(0);
    }

    injectIntoIndex(payloads);
    process.exit(0);
  } catch (err) {
    console.error('[inject-hot-events] failed:', err.message);
    process.exit(0);
  }
})();
