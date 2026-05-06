"use strict";

const crypto = require("crypto");

const PROVIDER = "sportsapipro";
const CANDIDATE_COLLECTION = "scoreboardTranslationCandidates";
const TRANSLATION_COLLECTION = "scoreboardTranslations";
const STATS_COLLECTION = "scoreboardTranslationStats";
const STATS_DOC = "summary";
const MAX_CANDIDATE_WRITES = 300;
const MAX_TOP_PENDING = 20;

const TERM_TYPES = Object.freeze(["team", "league", "status", "venue", "player", "tournament"]);
const FINAL_STATUSES = Object.freeze(["approved", "keep_original", "ignored"]);
const TRACKED_STATUSES = Object.freeze(["pending", "approved", "keep_original", "ignored", "needs_review", "conflict"]);

const AI_PROMPT = [
  "Please follow docs/scoreboard-translation-workflow-plan.md for the scoreboard translation maintenance flow.",
  "Read scoreboardTranslationCandidates and scoreboardTranslationStats, group by sport/type/status, and report total pending, approved, keep_original, needs_review, conflict, and the top high-frequency pending terms.",
  "Generate Traditional Chinese suggestions conservatively. Prioritize major leagues, national teams, well-known clubs, NBA/MLB/BWF and common status text.",
  "For local teams, youth teams, small leagues, or non-English source names with no reliable common Traditional Chinese name, mark keep_original instead of forcing a translation.",
  "Do not overwrite approved translations unless explicitly requested.",
  "Report suggested writes before applying them.",
].join("\n");

const AI_DIRECT_PROMPT = [
  "Please follow docs/scoreboard-translation-workflow-plan.md for the scoreboard translation maintenance flow.",
  "Read scoreboardTranslationCandidates, select the top 100 pending terms by occurrenceCount, and generate conservative Traditional Chinese translations.",
  "Write only clearly reliable translations to scoreboardTranslations with status=approved.",
  "For uncertain local teams, youth teams, small leagues, or non-English names without reliable Traditional Chinese usage, write status=keep_original.",
  "Do not overwrite approved translations unless explicitly requested.",
  "After writing, refresh scoreboardTranslationStats and report approved, keep_original, skipped, and risky items.",
].join("\n");

const BUILTIN_TRANSLATIONS = Object.freeze([
  ["*", "league", "English Premier League", "\u82f1\u8d85"],
  ["*", "league", "LaLiga", "\u897f\u7532"],
  ["*", "league", "La Liga", "\u897f\u7532"],
  ["*", "league", "Serie A", "\u7fa9\u7532"],
  ["*", "league", "Bundesliga", "\u5fb7\u7532"],
  ["*", "league", "Ligue 1", "\u6cd5\u7532"],
  ["*", "league", "Champions League", "\u6b50\u51a0"],
  ["*", "league", "UEFA Champions League", "\u6b50\u51a0"],
  ["*", "league", "Europa League", "\u6b50\u806f"],
  ["*", "league", "UEFA Europa League", "\u6b50\u806f"],
  ["*", "league", "World Cup", "\u4e16\u754c\u76c3"],
  ["*", "league", "FIFA World Cup", "\u4e16\u754c\u76c3"],
  ["basketball", "league", "NBA", "NBA"],
  ["baseball", "league", "MLB", "MLB"],
  ["badminton", "league", "BWF", "BWF"],
  ["badminton", "league", "Badminton World Federation", "BWF"],
  ["*", "status", "Scheduled", "\u672a\u958b\u59cb"],
  ["*", "status", "Not started", "\u672a\u958b\u59cb"],
  ["*", "status", "Live", "\u9032\u884c\u4e2d"],
  ["*", "status", "In progress", "\u9032\u884c\u4e2d"],
  ["*", "status", "Finished", "\u5df2\u7d50\u675f"],
  ["*", "status", "Ended", "\u5df2\u7d50\u675f"],
  ["*", "status", "Full time", "\u5168\u5834\u7d50\u675f"],
  ["*", "team", "Manchester United", "\u66fc\u806f"],
  ["*", "team", "Liverpool", "\u5229\u7269\u6d66"],
  ["*", "team", "Arsenal", "\u963f\u68ee\u7d0d"],
  ["*", "team", "Chelsea", "\u5207\u723e\u897f"],
  ["*", "team", "Tottenham Hotspur", "\u71b1\u523a"],
  ["*", "team", "Manchester City", "\u66fc\u57ce"],
  ["*", "team", "Real Madrid", "\u7687\u5bb6\u99ac\u5fb7\u91cc"],
  ["*", "team", "Barcelona", "\u5df4\u585e\u9686\u7d0d"],
  ["*", "team", "Los Angeles Lakers", "\u6d1b\u6749\u78ef\u6e56\u4eba"],
  ["*", "team", "Golden State Warriors", "\u91d1\u5dde\u52c7\u58eb"],
].map(([sport, type, sourceName, zhTW]) => Object.freeze({
  provider: PROVIDER,
  sport,
  type,
  sourceName,
  normalizedSourceName: normalizeSourceName(sourceName),
  zhTW,
  status: "approved",
  builtIn: true,
})));

function safeText(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeSourceName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSport(value) {
  return safeText(value || "unknown", 48).replace(/[^a-z0-9_-]/gi, "_") || "unknown";
}

function normalizeType(value) {
  const type = safeText(value, 32).toLowerCase();
  return TERM_TYPES.includes(type) ? type : "team";
}

function normalizeStatus(value) {
  const status = safeText(value, 32).toLowerCase();
  return TRACKED_STATUSES.includes(status) ? status : "pending";
}

function translationKey({ provider = PROVIDER, sport = "*", type = "*", normalizedSourceName }) {
  return [
    provider || PROVIDER,
    sport || "*",
    type || "*",
    normalizedSourceName || "",
  ].join("|");
}

function translationDocId({ provider = PROVIDER, sport, type, sourceName }) {
  const safeSport = normalizeSport(sport);
  const safeType = normalizeType(type);
  const normalized = normalizeSourceName(sourceName);
  const hash = crypto.createHash("sha1")
    .update([provider, safeSport, safeType, normalized].join("|"))
    .digest("hex")
    .slice(0, 24);
  return `${provider}_${safeSport}_${safeType}_${hash}`;
}

function addTranslationToLookup(lookup, item) {
  if (!item || !item.normalizedSourceName) return;
  const safeItem = {
    provider: item.provider || PROVIDER,
    sport: item.sport || "*",
    type: item.type || "*",
    sourceName: safeText(item.sourceName, 160),
    normalizedSourceName: item.normalizedSourceName,
    zhTW: safeText(item.zhTW, 160),
    status: normalizeStatus(item.status),
    builtIn: item.builtIn === true,
  };
  lookup.set(translationKey(safeItem), safeItem);
}

function createTranslationLookup(rows = []) {
  const lookup = new Map();
  BUILTIN_TRANSLATIONS.forEach((item) => addTranslationToLookup(lookup, item));
  rows.forEach((raw) => {
    const sourceName = safeText(raw?.sourceName, 160);
    const normalizedSourceName = normalizeSourceName(raw?.normalizedSourceName || sourceName);
    if (!sourceName || !normalizedSourceName) return;
    addTranslationToLookup(lookup, {
      provider: raw.provider || PROVIDER,
      sport: normalizeSport(raw.sport || "*"),
      type: normalizeType(raw.type || "*"),
      sourceName,
      normalizedSourceName,
      zhTW: raw.zhTW || "",
      status: raw.status || "pending",
    });
  });
  return lookup;
}

async function loadScoreboardTranslations(db) {
  if (!db?.collection) return createTranslationLookup();
  try {
    const snap = await db.collection(TRANSLATION_COLLECTION).get();
    const rows = [];
    snap.forEach((doc) => rows.push(doc.data()));
    return createTranslationLookup(rows);
  } catch (err) {
    console.warn("[scoreboard-translations] load skipped:", err?.message || err);
    return createTranslationLookup();
  }
}

function resolveTranslation(lookup, { provider = PROVIDER, sport, type, sourceName }) {
  const normalizedSourceName = normalizeSourceName(sourceName);
  if (!normalizedSourceName) return null;
  const safeSport = normalizeSport(sport);
  const safeType = normalizeType(type);
  const keys = [
    translationKey({ provider, sport: safeSport, type: safeType, normalizedSourceName }),
    translationKey({ provider, sport: safeSport, type: "*", normalizedSourceName }),
    translationKey({ provider, sport: "*", type: safeType, normalizedSourceName }),
    translationKey({ provider, sport: "*", type: "*", normalizedSourceName }),
  ];
  for (const key of keys) {
    const item = lookup?.get?.(key);
    if (item) return item;
  }
  return null;
}

function translateSourceName(sourceName, { lookup, sport, type, provider = PROVIDER } = {}) {
  const original = safeText(sourceName, 160);
  if (!original) {
    return { value: "", original: "", status: "empty", translated: false };
  }
  const match = resolveTranslation(lookup, { provider, sport, type, sourceName: original });
  if (match?.status === "approved" && match.zhTW) {
    return { value: match.zhTW, original, status: "approved", translated: match.zhTW !== original, builtIn: match.builtIn === true };
  }
  if (FINAL_STATUSES.includes(match?.status)) {
    return { value: original, original, status: match.status, translated: false, builtIn: match.builtIn === true };
  }
  return { value: original, original, status: match?.status || "pending", translated: false };
}

function applyScoreboardTranslationsToMatch(match, lookup) {
  if (!match || typeof match !== "object") return match;
  const sport = match.sport;
  const home = translateSourceName(match.homeTeam, { lookup, sport, type: "team" });
  const away = translateSourceName(match.awayTeam, { lookup, sport, type: "team" });
  const league = translateSourceName(match.league || match.subtitle, { lookup, sport, type: "league" });
  const status = translateSourceName(match.status, { lookup, sport, type: "status" });
  const translated = {
    ...match,
    homeTeam: home.value || match.homeTeam,
    awayTeam: away.value || match.awayTeam,
    league: league.value || match.league,
    subtitle: match.subtitle ? (league.value || match.subtitle) : match.subtitle,
    status: status.value || match.status,
  };
  if (translated.homeTeam || translated.awayTeam) {
    translated.title = [translated.homeTeam, translated.awayTeam].filter(Boolean).join(" vs ") || translated.title;
  }
  const flags = {};
  if (home.translated) {
    translated.homeTeamOriginal = home.original;
    flags.homeTeam = home.status;
  }
  if (away.translated) {
    translated.awayTeamOriginal = away.original;
    flags.awayTeam = away.status;
  }
  if (league.translated) {
    translated.leagueOriginal = league.original;
    translated.subtitleOriginal = match.subtitle || league.original;
    flags.league = league.status;
  }
  if (status.translated) {
    translated.statusOriginal = status.original;
    flags.status = status.status;
  }
  if (translated.title !== match.title) {
    translated.titleOriginal = match.title;
  }
  if (Object.keys(flags).length) translated.translationStatus = flags;
  return translated;
}

function applyScoreboardTranslationsToMatches(matches, lookup) {
  return (Array.isArray(matches) ? matches : []).map((match) => applyScoreboardTranslationsToMatch(match, lookup));
}

function pushTerm(terms, { sport, type, sourceName, match }) {
  const cleanName = safeText(sourceName, 160);
  const normalized = normalizeSourceName(cleanName);
  if (!cleanName || !normalized || cleanName.length < 2) return;
  terms.push({
    provider: PROVIDER,
    sport: normalizeSport(sport),
    type: normalizeType(type),
    sourceName: cleanName,
    normalizedSourceName: normalized,
    lastMatchId: safeText(match?.id, 80),
    sampleLeague: safeText(match?.league || match?.subtitle, 120),
    sampleTitle: safeText(match?.title, 160),
  });
}

function collectTranslationTermsFromMatches(matches) {
  const terms = [];
  (Array.isArray(matches) ? matches : []).forEach((match) => {
    pushTerm(terms, { sport: match?.sport, type: "team", sourceName: match?.homeTeam, match });
    pushTerm(terms, { sport: match?.sport, type: "team", sourceName: match?.awayTeam, match });
    pushTerm(terms, { sport: match?.sport, type: "league", sourceName: match?.league || match?.subtitle, match });
    pushTerm(terms, { sport: match?.sport, type: "status", sourceName: match?.status, match });
  });
  return terms;
}

function mergeTermCounts(terms) {
  const merged = new Map();
  (Array.isArray(terms) ? terms : []).forEach((term) => {
    const key = translationDocId(term);
    const current = merged.get(key) || { ...term, occurrenceDelta: 0 };
    current.occurrenceDelta += 1;
    current.lastMatchId = term.lastMatchId || current.lastMatchId || "";
    current.sampleLeague = term.sampleLeague || current.sampleLeague || "";
    current.sampleTitle = term.sampleTitle || current.sampleTitle || "";
    merged.set(key, current);
  });
  return Array.from(merged, ([id, value]) => ({ id, ...value })).slice(0, MAX_CANDIDATE_WRITES);
}

function shouldCollectCandidate(term, lookup) {
  const existing = resolveTranslation(lookup, term);
  return !existing || !FINAL_STATUSES.includes(existing.status);
}

async function recordTranslationCandidates({ db, FieldValue, terms, lookup }) {
  if (!db?.collection || !db.batch || !FieldValue?.serverTimestamp || !FieldValue?.increment) {
    return { ok: false, written: 0, skipped: true };
  }
  const rows = mergeTermCounts(terms).filter((term) => shouldCollectCandidate(term, lookup));
  if (!rows.length) return { ok: true, written: 0 };
  const refs = rows.map((term) => db.collection(CANDIDATE_COLLECTION).doc(term.id));
  const snaps = await Promise.all(refs.map((ref) => ref.get()));
  const batch = db.batch();
  rows.forEach((term, index) => {
    const exists = snaps[index]?.exists === true;
    const payload = {
      provider: PROVIDER,
      sport: term.sport,
      type: term.type,
      sourceName: term.sourceName,
      normalizedSourceName: term.normalizedSourceName,
      occurrenceCount: FieldValue.increment(term.occurrenceDelta),
      lastSeenAt: FieldValue.serverTimestamp(),
      lastMatchId: term.lastMatchId || null,
      sampleLeague: term.sampleLeague || null,
      sampleTitle: term.sampleTitle || null,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (!exists) {
      payload.status = "pending";
      payload.firstSeenAt = FieldValue.serverTimestamp();
    }
    batch.set(refs[index], payload, { merge: true });
  });
  await batch.commit();
  return { ok: true, written: rows.length };
}

function emptyStatusCounts() {
  return {
    total: 0,
    pending: 0,
    approved: 0,
    keep_original: 0,
    ignored: 0,
    needs_review: 0,
    conflict: 0,
  };
}

function incrementBucket(target, sport, type, status) {
  const safeStatus = TRACKED_STATUSES.includes(status) ? status : "pending";
  target.totals.total += 1;
  target.totals[safeStatus] += 1;
  target.bySport[sport] = target.bySport[sport] || emptyStatusCounts();
  target.bySport[sport].total += 1;
  target.bySport[sport][safeStatus] += 1;
  target.byType[type] = target.byType[type] || emptyStatusCounts();
  target.byType[type].total += 1;
  target.byType[type][safeStatus] += 1;
}

function coverageRate(counts) {
  const denominator = counts.pending + counts.approved + counts.keep_original + counts.ignored + counts.needs_review + counts.conflict;
  if (!denominator) return 0;
  return Math.round(((counts.approved + counts.keep_original + counts.ignored) / denominator) * 1000) / 10;
}

function aggregateTranslationStats({ candidates = [], translations = [], lookup = createTranslationLookup() } = {}) {
  const aggregate = {
    provider: PROVIDER,
    totals: emptyStatusCounts(),
    bySport: {},
    byType: {},
    topPending: [],
    translationTotal: translations.length,
    builtInTranslationTotal: BUILTIN_TRANSLATIONS.length,
    coverageRate: 0,
  };
  const pendingRows = [];
  candidates.forEach((candidate) => {
    const sport = normalizeSport(candidate.sport);
    const type = normalizeType(candidate.type);
    const existing = resolveTranslation(lookup, {
      sport,
      type,
      sourceName: candidate.sourceName || candidate.normalizedSourceName,
    });
    const status = existing?.status && FINAL_STATUSES.includes(existing.status)
      ? existing.status
      : normalizeStatus(candidate.status || "pending");
    incrementBucket(aggregate, sport, type, status);
    if (status === "pending") {
      pendingRows.push({
        sport,
        type,
        sourceName: safeText(candidate.sourceName, 160),
        occurrenceCount: Number(candidate.occurrenceCount || 0),
        sampleLeague: safeText(candidate.sampleLeague, 120),
        sampleTitle: safeText(candidate.sampleTitle, 160),
      });
    }
  });
  aggregate.coverageRate = coverageRate(aggregate.totals);
  Object.keys(aggregate.bySport).forEach((sport) => {
    aggregate.bySport[sport].coverageRate = coverageRate(aggregate.bySport[sport]);
  });
  Object.keys(aggregate.byType).forEach((type) => {
    aggregate.byType[type].coverageRate = coverageRate(aggregate.byType[type]);
  });
  aggregate.topPending = pendingRows
    .sort((a, b) => b.occurrenceCount - a.occurrenceCount || a.sourceName.localeCompare(b.sourceName))
    .slice(0, MAX_TOP_PENDING);
  return aggregate;
}

async function readCollectionRows(db, collection) {
  const snap = await db.collection(collection).get();
  const rows = [];
  snap.forEach((doc) => rows.push({ id: doc.id, ...doc.data() }));
  return rows;
}

async function updateTranslationStats({ db, FieldValue, lookup }) {
  if (!db?.collection || !FieldValue?.serverTimestamp) return { ok: false, skipped: true };
  const [candidates, translations] = await Promise.all([
    readCollectionRows(db, CANDIDATE_COLLECTION).catch(() => []),
    readCollectionRows(db, TRANSLATION_COLLECTION).catch(() => []),
  ]);
  const effectiveLookup = lookup || createTranslationLookup(translations);
  const aggregate = aggregateTranslationStats({ candidates, translations, lookup: effectiveLookup });
  const payload = {
    schemaVersion: 1,
    provider: PROVIDER,
    ...aggregate,
    aiPrompt: AI_PROMPT,
    aiDirectPrompt: AI_DIRECT_PROMPT,
    lastStatsAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await db.collection(STATS_COLLECTION).doc(STATS_DOC).set(payload, { merge: true });
  return { ok: true, ...aggregate };
}

function sanitizeTranslationInput(item) {
  const sourceName = safeText(item?.sourceName, 160);
  const sport = normalizeSport(item?.sport);
  const type = normalizeType(item?.type);
  const status = normalizeStatus(item?.status || (item?.zhTW ? "approved" : "keep_original"));
  const zhTW = safeText(item?.zhTW, 160);
  if (!sourceName) return null;
  if (status === "approved" && !zhTW) return null;
  if (!["approved", "keep_original", "ignored", "needs_review"].includes(status)) return null;
  return {
    id: translationDocId({ sport, type, sourceName }),
    provider: PROVIDER,
    sport,
    type,
    sourceName,
    normalizedSourceName: normalizeSourceName(sourceName),
    zhTW: status === "approved" ? zhTW : "",
    status,
  };
}

async function upsertScoreboardTranslations({ db, FieldValue, items, reviewerUid, force = false }) {
  if (!db?.collection || !db.batch || !FieldValue?.serverTimestamp) {
    return { ok: false, written: 0, skipped: 0 };
  }
  const rows = (Array.isArray(items) ? items : [])
    .map(sanitizeTranslationInput)
    .filter(Boolean)
    .slice(0, 100);
  if (!rows.length) return { ok: true, written: 0, skipped: 0 };
  const refs = rows.map((row) => db.collection(TRANSLATION_COLLECTION).doc(row.id));
  const snaps = await Promise.all(refs.map((ref) => ref.get()));
  const batch = db.batch();
  let written = 0;
  let skipped = 0;
  rows.forEach((row, index) => {
    const existing = snaps[index]?.exists ? snaps[index].data() : null;
    if (existing?.status === "approved" && force !== true) {
      skipped += 1;
      return;
    }
    batch.set(refs[index], {
      ...row,
      reviewedBy: reviewerUid || null,
      reviewedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    written += 1;
  });
  if (written) await batch.commit();
  await updateTranslationStats({ db, FieldValue });
  return { ok: true, written, skipped };
}

module.exports = {
  PROVIDER,
  CANDIDATE_COLLECTION,
  TRANSLATION_COLLECTION,
  STATS_COLLECTION,
  STATS_DOC,
  AI_PROMPT,
  AI_DIRECT_PROMPT,
  BUILTIN_TRANSLATIONS,
  TERM_TYPES,
  normalizeSourceName,
  translationDocId,
  createTranslationLookup,
  loadScoreboardTranslations,
  translateSourceName,
  applyScoreboardTranslationsToMatch,
  applyScoreboardTranslationsToMatches,
  collectTranslationTermsFromMatches,
  recordTranslationCandidates,
  aggregateTranslationStats,
  updateTranslationStats,
  upsertScoreboardTranslations,
};
