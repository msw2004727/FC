#!/usr/bin/env node
/**
 * Inject compact homepage boot payloads into index.html.
 *
 * The homepage only needs summary counters for first paint:
 * - boot-home-summary-data: public active counts, sport counts, recorded views
 * - boot-banners-data: active banner carousel
 *
 * This script is best-effort for CI/deploy. If Firestore is unavailable, it
 * keeps the existing inline payloads in index.html.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const FIRESTORE_PROJECT = 'fc-football-6c8dc';
const OAUTH_SCOPES = 'https://www.googleapis.com/auth/datastore';
const INDEX_HTML_PATH = path.resolve(__dirname, '..', 'index.html');
const FIREBASE_CONFIG_PATH = path.resolve(__dirname, '..', 'js', 'firebase-config.js');

const TARGET_BANNER_COUNT = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

const INJECTION_CONFIGS = {
  homeSummary: {
    collection: '',
    markerBegin: '<!-- BOOT_HOME_SUMMARY_INJECT_BEGIN -->',
    markerEnd: '<!-- BOOT_HOME_SUMMARY_INJECT_END -->',
    scriptId: 'boot-home-summary-data',
  },
  banners: {
    collection: 'banners',
    markerBegin: '<!-- BOOT_BANNERS_INJECT_BEGIN -->',
    markerEnd: '<!-- BOOT_BANNERS_INJECT_END -->',
    scriptId: 'boot-banners-data',
    pageSize: 30,
    orderBy: 'slot',
  },
};

const LEGACY_BLOCKS = [
  { markerBegin: '<!-- BOOT_EVENTS_INJECT_BEGIN -->', markerEnd: '<!-- BOOT_EVENTS_INJECT_END -->' },
  { markerBegin: '<!-- BOOT_TOURNAMENTS_INJECT_BEGIN -->', markerEnd: '<!-- BOOT_TOURNAMENTS_INJECT_END -->' },
];

const SUMMARY_COLLECTIONS = {
  events: { collection: 'events', pageSize: 300, orderBy: null, maxPages: 25 },
  teams: { collection: 'teams', pageSize: 300, orderBy: null, maxPages: 15 },
  tournaments: { collection: 'tournaments', pageSize: 300, orderBy: null, maxPages: 15 },
};

const BANNER_KEEP_FIELDS = [
  'id', '_docId', 'title', 'image', 'linkUrl', 'slotName', 'slot',
  'status', 'gradient', 'sortOrder', 'type',
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
        } catch (_) {
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
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in value) {
    const out = {};
    Object.entries(value.mapValue.fields || {}).forEach(([key, nested]) => {
      out[key] = fromFirestoreValue(nested);
    });
    return out;
  }
  return null;
}

function fromFirestoreDoc(doc) {
  const obj = {};
  Object.entries(doc.fields || {}).forEach(([key, value]) => {
    obj[key] = fromFirestoreValue(value);
  });
  const docId = (doc.name || '').split('/').pop() || '';
  obj._docId = docId;
  if (!obj.id && docId) obj.id = docId;
  return obj;
}

async function fetchCollectionPage(auth, config, pageToken = '', orderByOverride) {
  const params = new URLSearchParams();
  params.set('pageSize', String(config.pageSize || 300));
  const orderBy = orderByOverride === undefined ? config.orderBy : orderByOverride;
  if (orderBy) params.set('orderBy', orderBy);
  if (pageToken) params.set('pageToken', pageToken);
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
    return fetchCollectionPage(auth, config, pageToken, null);
  }
  if (res.status !== 200) {
    throw new Error(`Firestore ${config.collection} fetch failed (${res.status}): ${JSON.stringify(res.body).slice(0, 200)}`);
  }
  return {
    docs: (res.body.documents || []).map(fromFirestoreDoc),
    nextPageToken: res.body.nextPageToken || '',
  };
}

async function fetchCollectionAll(auth, config) {
  const allDocs = [];
  let pageToken = '';
  let page = 0;
  do {
    page += 1;
    const res = await fetchCollectionPage(auth, config, pageToken);
    allDocs.push(...res.docs);
    pageToken = res.nextPageToken;
  } while (pageToken && page < (config.maxPages || 20));
  if (pageToken) {
    throw new Error(`${config.collection} exceeded ${config.maxPages || 20} pages; summary is incomplete`);
  }
  return allDocs;
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
  if (dateValue && typeof dateValue.toDate === 'function') return dateValue.toDate().getTime();
  const raw = String(dateValue).trim();
  const slash = raw.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (slash) {
    return new Date(
      Number(slash[1]),
      Number(slash[2]) - 1,
      Number(slash[3]),
      Number(slash[4] || 0),
      Number(slash[5] || 0)
    ).getTime();
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isPublicActiveEvent(event, nowMs) {
  if (!event || !(event.id || event._docId)) return false;
  const status = String(event.status || '').toLowerCase();
  if (['ended', 'cancelled', 'canceled', 'archived'].includes(status)) return false;
  if (event.privateEvent === true || event.teamOnly === true) return false;
  const startMs = parseDateMs(event.date || event.startAt || event.startTime);
  return startMs === 0 || startMs > nowMs;
}

function normalizeSportKey(event) {
  return String(event.sportTag || event.sport || 'football').trim() || 'football';
}

function isActiveTeam(team) {
  if (!team || !(team.id || team._docId)) return false;
  const status = String(team.status || '').toLowerCase();
  return team.active !== false && !['deleted', 'archived', 'inactive'].includes(status);
}

function tournamentLatestMatchMs(tournament) {
  const matchDates = Array.isArray(tournament.matchDates) ? tournament.matchDates : [];
  return matchDates.reduce((max, value) => Math.max(max, parseDateMs(value)), 0);
}

function isTournamentEnded(tournament, nowMs) {
  if (!tournament) return true;
  if (tournament.ended === true) return true;
  const status = String(tournament.status || '').toLowerCase();
  if (['ended', 'cancelled', 'canceled', 'archived'].includes(status)) return true;
  const latestMs = tournamentLatestMatchMs(tournament);
  return latestMs > 0 && latestMs + DAY_MS < nowMs;
}

function buildHomeSummary({ events, teams, tournaments }) {
  const nowMs = Date.now();
  const activeEvents = (events || []).filter(event => isPublicActiveEvent(event, nowMs));
  const sportMap = new Map();
  let viewTotal = 0;

  activeEvents.forEach(event => {
    const sport = normalizeSportKey(event);
    sportMap.set(sport, (sportMap.get(sport) || 0) + 1);
    const views = Number(event.viewCount || event.views || 0);
    if (Number.isFinite(views) && views > 0) viewTotal += Math.floor(views);
  });

  const activeTeams = (teams || []).filter(isActiveTeam);
  const activeTournaments = (tournaments || []).filter(t => t && (t.id || t._docId) && !isTournamentEnded(t, nowMs));

  return {
    schemaVersion: 1,
    generatedAt: new Date(nowMs).toISOString(),
    scope: 'public-active',
    complete: true,
    counts: {
      activities: activeEvents.length,
      teams: activeTeams.length,
      tournaments: activeTournaments.length,
    },
    activityViews: {
      label: '\u5df2\u8a18\u9304\u700f\u89bd',
      total: viewTotal,
    },
    sportCounts: Array.from(sportMap.entries())
      .map(([sportTag, count]) => ({ sportTag, count }))
      .sort((a, b) => b.count - a.count || a.sportTag.localeCompare(b.sportTag)),
  };
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
  const count = Array.isArray(records) ? records.length : 1;
  return `${config.markerBegin}\n  <script id="${config.scriptId}" type="application/json" data-ts="${ts}" data-count="${count}">${escapeInlineJson(records)}</script>\n  ${config.markerEnd}`;
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

function removeBlock(html, config) {
  const beginIdx = html.indexOf(config.markerBegin);
  const endIdx = html.indexOf(config.markerEnd);
  if (beginIdx < 0 || endIdx <= beginIdx) return html;
  return html.slice(0, beginIdx) + html.slice(endIdx + config.markerEnd.length).replace(/^\s*\n/, '');
}

function sanitizeInjectionArtifacts(html) {
  return Object.values(INJECTION_CONFIGS).reduce((current, config) => {
    const escaped = config.markerBegin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return current.replace(new RegExp(`(^|\\n)[ \\t]*<<[ \\t]*(${escaped})`, 'g'), '$1  $2');
  }, html);
}

function injectIntoIndex(payloads) {
  const original = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  let html = sanitizeInjectionArtifacts(LEGACY_BLOCKS.reduce((current, config) => removeBlock(current, config), original));
  const ts = Date.now();

  payloads.forEach(payload => {
    if (!payload || payload.records == null) return;
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

async function safeHomeSummary(auth) {
  try {
    const [events, teams, tournaments] = await Promise.all([
      fetchCollectionAll(auth, SUMMARY_COLLECTIONS.events),
      fetchCollectionAll(auth, SUMMARY_COLLECTIONS.teams),
      fetchCollectionAll(auth, SUMMARY_COLLECTIONS.tournaments),
    ]);
    const summary = buildHomeSummary({ events, teams, tournaments });
    console.log(`[inject-hot-events] homeSummary: events=${events.length}, teams=${teams.length}, tournaments=${tournaments.length}`);
    console.log(`[inject-hot-events] homeSummary counts: ${JSON.stringify(summary.counts)}, views=${summary.activityViews.total}`);
    return { key: 'homeSummary', config: INJECTION_CONFIGS.homeSummary, records: summary };
  } catch (err) {
    console.warn(`[inject-hot-events] homeSummary skipped (${err.message})`);
    return null;
  }
}

async function safeBanners(auth) {
  try {
    const docs = await fetchCollectionAll(auth, INJECTION_CONFIGS.banners);
    const records = pickActiveBanners(docs);
    console.log(`[inject-hot-events] banners: fetched ${docs.length}, picked ${records.length}`);
    return { key: 'banners', config: INJECTION_CONFIGS.banners, records };
  } catch (err) {
    console.warn(`[inject-hot-events] banners skipped (${err.message})`);
    return null;
  }
}

async function main() {
  try {
    const auth = await buildAuth();
    const homeSummary = await safeHomeSummary(auth);
    const banners = await safeBanners(auth);

    const payloads = [
      homeSummary,
      banners && Object.assign(banners, { anchorMarkerEnd: INJECTION_CONFIGS.homeSummary.markerEnd }),
    ].filter(Boolean);

    const totalJsonBytes = payloads.reduce((sum, payload) => sum + JSON.stringify(payload.records).length, 0);
    console.log(`[inject-hot-events] total inline JSON size: ${totalJsonBytes} bytes`);
    if (totalJsonBytes > 18000) {
      console.warn('[inject-hot-events] inline JSON is larger than expected; review homepage payload size');
    }

    if (!payloads.length) {
      console.log('[inject-hot-events] no payloads fetched; keeping existing index.html');
      return 0;
    }

    injectIntoIndex(payloads);
    return 0;
  } catch (err) {
    console.error('[inject-hot-events] failed:', err.message);
    return 0;
  }
}

if (require.main === module) {
  main().then(code => process.exit(code));
}

module.exports = {
  buildHomeSummary,
  isPublicActiveEvent,
  isTournamentEnded,
  parseDateMs,
};
