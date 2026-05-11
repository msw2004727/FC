#!/usr/bin/env node
/**
 * build-sitemap.js — Generate dynamic sub-sitemaps for events, teams, tournaments.
 *
 * Writes:
 *   sitemap-events.xml
 *   sitemap-teams.xml
 *   sitemap-tournaments.xml
 *
 * Uses Firestore REST API + Service Account JWT (same pattern as
 * scripts/inject-hot-events.js). Falls back to the public Firestore apiKey if
 * GCP_SERVICE_ACCOUNT_JSON is not set; the script never aborts the workflow.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const FIRESTORE_PROJECT = 'fc-football-6c8dc';
const OAUTH_SCOPES = 'https://www.googleapis.com/auth/datastore';
const REPO_ROOT = path.resolve(__dirname, '..');
const FIREBASE_CONFIG_PATH = path.join(REPO_ROOT, 'js', 'firebase-config.js');
const SITE_ORIGIN = 'https://toosterx.com';

const DAY_MS = 24 * 60 * 60 * 1000;
const URLS_PER_FILE_CAP = 5000;

const COLLECTIONS = {
  events: { collection: 'events', pageSize: 300, maxPages: 30 },
  teams: { collection: 'teams', pageSize: 300, maxPages: 15 },
  tournaments: { collection: 'tournaments', pageSize: 300, maxPages: 15 },
};

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
      res.on('data', (chunk) => { data += chunk; });
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

async function fetchCollectionPage(auth, config, pageToken = '') {
  const params = new URLSearchParams();
  params.set('pageSize', String(config.pageSize || 300));
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
    console.warn(`[build-sitemap] ${config.collection} exceeded ${config.maxPages || 20} pages; truncated`);
  }
  return allDocs;
}

function parseDateMs(dateValue) {
  if (!dateValue) return 0;
  if (typeof dateValue === 'number') return dateValue;
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

// Allowable URL path segment: matches HistoryRouteAdapter.isSafeRouteSegment.
function isSafeRouteSegment(id) {
  const value = String(id || '').trim();
  if (!value || value === '.' || value === '..') return false;
  if (value.indexOf('/') !== -1 || value.indexOf('\\') !== -1) return false;
  return /^[A-Za-z0-9_-]{3,80}$/.test(value);
}

function pickEventId(event) {
  const id = String(event.id || event._docId || '').trim();
  return isSafeRouteSegment(id) ? id : '';
}

function isIndexableEvent(event, nowMs) {
  if (!event) return false;
  const status = String(event.status || '').toLowerCase();
  if (['ended', 'cancelled', 'canceled', 'archived', 'deleted', 'draft'].includes(status)) return false;
  if (event.privateEvent === true) return false;
  if (event.teamOnly === true) return false;
  if (event.isHidden === true || event.hidden === true || event.isDraft === true) return false;
  const startMs = parseDateMs(event.date || event.startAt || event.startTime);
  // 未排程 (0) 也納入；過去 > 30 天的活動排除避免 sitemap 灌過時資料
  if (startMs > 0 && startMs + 30 * DAY_MS < nowMs) return false;
  return true;
}

function isIndexableTeam(team) {
  if (!team) return false;
  const status = String(team.status || '').toLowerCase();
  if (team.active === false) return false;
  if (['deleted', 'archived', 'inactive'].includes(status)) return false;
  if (team.isHidden === true || team.hidden === true) return false;
  return true;
}

function tournamentLatestMatchMs(tournament) {
  const matchDates = Array.isArray(tournament.matchDates) ? tournament.matchDates : [];
  return matchDates.reduce((max, value) => Math.max(max, parseDateMs(value)), 0);
}

function isIndexableTournament(tournament, nowMs) {
  if (!tournament) return false;
  if (tournament.ended === true) return false;
  const status = String(tournament.status || '').toLowerCase();
  if (['ended', 'cancelled', 'canceled', 'archived', 'deleted', 'draft'].includes(status)) return false;
  if (tournament.isHidden === true || tournament.hidden === true) return false;
  const latestMs = tournamentLatestMatchMs(tournament);
  if (latestMs > 0 && latestMs + 30 * DAY_MS < nowMs) return false;
  return true;
}

function pickLastMod(record) {
  const candidates = [
    record.updatedAt,
    record.lastModified,
    record.modifiedAt,
    record.createdAt,
    record.eventDate,
    record.date,
    record.startAt,
  ];
  for (const value of candidates) {
    const ms = parseDateMs(value);
    if (ms > 0) return new Date(ms).toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildUrlEntry({ loc, lastmod, changefreq, priority }) {
  const parts = [
    '  <url>',
    `    <loc>${escapeXml(loc)}</loc>`,
  ];
  if (lastmod) parts.push(`    <lastmod>${escapeXml(lastmod)}</lastmod>`);
  if (changefreq) parts.push(`    <changefreq>${escapeXml(changefreq)}</changefreq>`);
  if (priority) parts.push(`    <priority>${escapeXml(priority)}</priority>`);
  parts.push('  </url>');
  return parts.join('\n');
}

function buildSitemapXml(entries) {
  const header = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
  const body = entries.map(buildUrlEntry).join('\n');
  return `${header}\n${body}\n</urlset>\n`;
}

function pickTournamentId(tournament) {
  const id = String(tournament.id || tournament._docId || '').trim();
  return isSafeRouteSegment(id) ? id : '';
}

function pickTeamId(team) {
  const id = String(team.id || team._docId || '').trim();
  return isSafeRouteSegment(id) ? id : '';
}

function buildEventEntries(events, nowMs) {
  const seen = new Set();
  const out = [];
  for (const ev of events) {
    if (!isIndexableEvent(ev, nowMs)) continue;
    const id = pickEventId(ev);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      loc: `${SITE_ORIGIN}/events/${encodeURIComponent(id)}`,
      lastmod: pickLastMod(ev),
      changefreq: 'daily',
      priority: '0.7',
    });
    if (out.length >= URLS_PER_FILE_CAP) break;
  }
  return out;
}

function buildTeamEntries(teams) {
  const seen = new Set();
  const out = [];
  for (const t of teams) {
    if (!isIndexableTeam(t)) continue;
    const id = pickTeamId(t);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      loc: `${SITE_ORIGIN}/teams/${encodeURIComponent(id)}`,
      lastmod: pickLastMod(t),
      changefreq: 'weekly',
      priority: '0.6',
    });
    if (out.length >= URLS_PER_FILE_CAP) break;
  }
  return out;
}

function buildTournamentEntries(tournaments, nowMs) {
  const seen = new Set();
  const out = [];
  for (const t of tournaments) {
    if (!isIndexableTournament(t, nowMs)) continue;
    const id = pickTournamentId(t);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      loc: `${SITE_ORIGIN}/tournaments/${encodeURIComponent(id)}`,
      lastmod: pickLastMod(t),
      changefreq: 'weekly',
      priority: '0.7',
    });
    if (out.length >= URLS_PER_FILE_CAP) break;
  }
  return out;
}

function writeSitemap(filename, entries, scope) {
  const target = path.join(REPO_ROOT, filename);
  const xml = entries.length
    ? buildSitemapXml(entries)
    : `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n`;
  const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  if (existing === xml) {
    console.log(`[build-sitemap] ${filename} unchanged (${entries.length} urls, scope=${scope})`);
    return false;
  }
  fs.writeFileSync(target, xml, 'utf8');
  console.log(`[build-sitemap] ${filename} updated (${entries.length} urls, scope=${scope})`);
  return true;
}

async function buildAuth() {
  const saJson = process.env.GCP_SERVICE_ACCOUNT_JSON;
  if (saJson) {
    const sa = JSON.parse(saJson);
    console.log('[build-sitemap] using service account auth');
    return { token: await getAccessToken(sa), apiKey: '' };
  }
  const apiKey = readFirebaseApiKey();
  if (!apiKey) throw new Error('No GCP_SERVICE_ACCOUNT_JSON and no Firebase apiKey found');
  console.log('[build-sitemap] using public Firestore REST fallback');
  return { token: '', apiKey };
}

async function main() {
  try {
    const auth = await buildAuth();
    const nowMs = Date.now();
    const [events, teams, tournaments] = await Promise.all([
      fetchCollectionAll(auth, COLLECTIONS.events).catch((err) => {
        console.warn(`[build-sitemap] events fetch failed: ${err.message}`);
        return [];
      }),
      fetchCollectionAll(auth, COLLECTIONS.teams).catch((err) => {
        console.warn(`[build-sitemap] teams fetch failed: ${err.message}`);
        return [];
      }),
      fetchCollectionAll(auth, COLLECTIONS.tournaments).catch((err) => {
        console.warn(`[build-sitemap] tournaments fetch failed: ${err.message}`);
        return [];
      }),
    ]);

    const eventEntries = buildEventEntries(events, nowMs);
    const teamEntries = buildTeamEntries(teams);
    const tournamentEntries = buildTournamentEntries(tournaments, nowMs);

    console.log(`[build-sitemap] fetched events=${events.length}, teams=${teams.length}, tournaments=${tournaments.length}`);
    console.log(`[build-sitemap] indexable events=${eventEntries.length}, teams=${teamEntries.length}, tournaments=${tournamentEntries.length}`);

    writeSitemap('sitemap-events.xml', eventEntries, 'indexable-events');
    writeSitemap('sitemap-teams.xml', teamEntries, 'indexable-teams');
    writeSitemap('sitemap-tournaments.xml', tournamentEntries, 'indexable-tournaments');
    return 0;
  } catch (err) {
    console.error(`[build-sitemap] failed: ${err.message}`);
    return 0;
  }
}

if (require.main === module) {
  main().then((code) => process.exit(code));
}

module.exports = {
  buildEventEntries,
  buildTeamEntries,
  buildTournamentEntries,
  buildSitemapXml,
  isIndexableEvent,
  isIndexableTeam,
  isIndexableTournament,
  isSafeRouteSegment,
  pickLastMod,
  parseDateMs,
};
