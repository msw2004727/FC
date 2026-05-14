"use strict";

const {
  SCOREBOARD_SNAPSHOT_TTL_MS,
  SCOREBOARD_DETAIL_TTL_MS,
  SUPPORTED_SPORTS,
  sportsApiBaseUrl,
  supportedSportKeys,
  formatTaipeiDate,
  normalizeScoreboardConfig,
  planRequests,
  normalizeMatches,
  sanitizeStatusPayload,
} = require("./scoreboard-sportsapipro-utils");
const {
  loadScoreboardTranslations,
  applyScoreboardTranslationsToMatches,
  applyScoreboardTranslationsToMatch,
  collectTranslationTermsFromMatches,
  recordTranslationCandidates,
  updateTranslationStats,
  upsertScoreboardTranslations,
} = require("./scoreboard-translations");

const REGION = "asia-east1";
const PROVIDER = "sportsapipro";
const FETCH_TIMEOUT_MS = 9000;
const MANUAL_REFRESH_COOLDOWN_MS = 60 * 1000;
const SNAPSHOT_DOC_PATH = ["scoreboardSnapshots", "home"];

function nowDate(value = new Date()) {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value : new Date();
}

function dateKeyTaipei(date = new Date()) {
  return formatTaipeiDate(date).replace(/-/g, "");
}

function timestampFromMillis(Timestamp, millis) {
  return Timestamp.fromMillis(millis);
}

function isoFromAnyDate(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric) && numeric > 0
    ? new Date(numeric > 9999999999 ? numeric : numeric * 1000)
    : new Date(value);
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function safeText(value, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}

function safeId(value, max = 120) {
  return safeText(value, max).replace(/[^a-z0-9_-]/gi, "_");
}

function safeError(err, context = {}) {
  const status = Number(err?.status || err?.responseStatus || 0) || null;
  const code = status === 429 ? "rate_limited"
    : status === 401 || status === 403 ? "auth_failed"
    : status >= 500 ? "provider_error"
    : err?.name === "AbortError" ? "timeout"
    : "request_failed";
  return {
    provider: PROVIDER,
    sport: context.sport || null,
    kind: context.kind || null,
    code,
    status,
    message: safeText(err?.message || code, 120),
  };
}

async function fetchJson({ apiKey, baseUrl, path, sport, kind, fetchImpl = fetch }) {
  if (!apiKey) {
    const err = new Error("SPORTSAPI_PRO_API_KEY secret is not configured");
    err.status = 401;
    throw err;
  }
  const url = `${baseUrl}${path}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: {
        "accept": "application/json",
        "x-api-key": apiKey,
      },
      signal: ctrl.signal,
    });
    const headers = {};
    if (res.headers?.forEach) {
      res.headers.forEach((value, key) => {
        headers[String(key).toLowerCase()] = value;
      });
    }
    let payload = null;
    try {
      payload = await res.json();
    } catch (_) {
      payload = null;
    }
    if (!res.ok) {
      const err = new Error(payload?.message || payload?.error || `SportsAPI Pro ${res.status}`);
      err.status = res.status;
      err.responseStatus = res.status;
      err.sport = sport;
      err.kind = kind;
      throw err;
    }
    return { payload, headers };
  } finally {
    clearTimeout(timer);
  }
}

function compactMatch(match) {
  if (!match) return null;
  const compact = {
    id: safeText(match.id, 80),
    sport: safeText(match.sport, 40),
    sourceId: safeText(match.sourceId, 64),
    league: safeText(match.league, 120),
    tournamentId: match.tournamentId ?? null,
    title: safeText(match.title, 160),
    subtitle: safeText(match.subtitle, 160),
    homeTeam: safeText(match.homeTeam, 100),
    awayTeam: safeText(match.awayTeam, 100),
    homeScore: match.homeScore ?? null,
    awayScore: match.awayScore ?? null,
    status: safeText(match.status, 80),
    statusCode: Number.isFinite(Number(match.statusCode)) ? Number(match.statusCode) : null,
    startsAt: match.startsAt || null,
    timeLabel: safeText(match.timeLabel, 20),
    dateLabel: safeText(match.dateLabel, 20),
    isLive: match.isLive === true,
    isFinished: match.isFinished === true,
    hasDetail: match.hasDetail !== false,
    detailCacheKey: safeId(match.detailCacheKey || `${match.sport}_${match.id}`),
  };
  [
    "homeTeamOriginal",
    "awayTeamOriginal",
    "leagueOriginal",
    "subtitleOriginal",
    "statusOriginal",
    "titleOriginal",
  ].forEach((key) => {
    if (match[key]) compact[key] = safeText(match[key], 160);
  });
  if (match.translationStatus && typeof match.translationStatus === "object") {
    compact.translationStatus = Object.entries(match.translationStatus)
      .slice(0, 8)
      .reduce((acc, [key, value]) => {
        acc[safeId(key, 40)] = safeText(value, 40);
        return acc;
      }, {});
  }
  return compact;
}

function sortMatches(matches) {
  return matches
    .filter(Boolean)
    .sort((a, b) => {
      if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
      const aTime = a.startsAt ? Date.parse(a.startsAt) : Number.MAX_SAFE_INTEGER;
      const bTime = b.startsAt ? Date.parse(b.startsAt) : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });
}

function isUpcomingWithin24Hours(match, now) {
  if (!match || match.isLive || match.isFinished || !match.startsAt) return false;
  const startsAtMs = Date.parse(match.startsAt);
  if (!Number.isFinite(startsAtMs)) return false;
  const nowMs = now.getTime();
  return startsAtMs >= nowMs && startsAtMs <= nowMs + 24 * 60 * 60 * 1000;
}

function isFeaturedMatch(match, config) {
  const sourceId = safeText(match?.sourceId, 64);
  const sport = safeText(match?.sport, 40);
  if (!sourceId || !sport || sourceId === sport) return false;
  const sourceConfig = config?.featuredSources?.[sourceId];
  return sourceConfig?.enabled !== false;
}

function buildSportsSummary({ config, liveMatches, scheduleMatches, fetchedAtBySport }) {
  return Object.entries(config.sports)
    .filter(([, sportConfig]) => sportConfig?.enabled)
    .sort((a, b) => Number(a[1].sortOrder || 99) - Number(b[1].sortOrder || 99))
    .map(([sport, sportConfig]) => ({
      sport,
      label: safeText(sportConfig.label || sport, 24),
      enabled: true,
      homepageEnabled: sportConfig.homepageEnabled !== false,
      liveCount: liveMatches.filter((match) => match.sport === sport).length,
      scheduleCount: scheduleMatches.filter((match) => match.sport === sport).length,
      lastFetchedAt: fetchedAtBySport[sport] || null,
    }));
}

function snapshotFromResults({ config, liveMatches, scheduleMatches, errors, statusPayload, fetchedAtBySport, now, Timestamp, FieldValue }) {
  const generatedAt = timestampFromMillis(Timestamp, now.getTime());
  const expiresAt = timestampFromMillis(Timestamp, now.getTime() + SCOREBOARD_SNAPSHOT_TTL_MS);
  const safeLive = sortMatches(liveMatches).map(compactMatch).filter(Boolean).slice(0, 80);
  const safeSchedule = sortMatches(scheduleMatches).map(compactMatch).filter(Boolean).slice(0, 120);
  const homepageSports = new Set(Object.entries(config.sports)
    .filter(([, sport]) => sport?.homepageEnabled !== false)
    .map(([sport]) => sport));
  const homeRaw = sortMatches([...liveMatches, ...scheduleMatches])
    .filter((match) => homepageSports.has(match.sport));
  const homePool = homeRaw
    .map(compactMatch)
    .filter(Boolean)
    .slice(0, 160);
  const homepageMatches = homePool
    .slice(0, 6);
  const featuredMatches = sortMatches(homeRaw)
    .filter((match) => isFeaturedMatch(match, config))
    .map(compactMatch)
    .filter(Boolean)
    .slice(0, 24);
  const liveNow = sortMatches(liveMatches)
    .filter((match) => homepageSports.has(match.sport))
    .map(compactMatch)
    .filter(Boolean)
    .slice(0, 24);
  const todaySchedule = sortMatches(scheduleMatches)
    .filter((match) => homepageSports.has(match.sport) && isUpcomingWithin24Hours(match, now))
    .map(compactMatch)
    .filter(Boolean)
    .slice(0, 24);
  const upcoming24h = sortMatches(homePool)
    .filter((match) => isUpcomingWithin24Hours(match, now))
    .slice(0, 24);

  return {
    schemaVersion: 1,
    provider: PROVIDER,
    generatedAt,
    expiresAt,
    sports: buildSportsSummary({ config, liveMatches: safeLive, scheduleMatches: safeSchedule, fetchedAtBySport }),
    liveMatches: safeLive,
    recentSchedule: safeSchedule,
    homepageMatches,
    homepageSections: {
      featured: {
        updatedAt: generatedAt,
        matches: featuredMatches,
      },
      live: {
        updatedAt: generatedAt,
        matches: liveNow,
      },
      schedule: {
        updatedAt: generatedAt,
        matches: todaySchedule,
      },
      // Legacy aliases kept so older clients can still render cached snapshots.
      upcoming24h: {
        updatedAt: generatedAt,
        matches: upcoming24h,
      },
      scores: {
        updatedAt: generatedAt,
        matches: homepageMatches,
      },
    },
    status: statusPayload || null,
    errors: errors.slice(0, 20),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

async function readScoreboardConfig(db) {
  const snap = await db.collection("siteConfig").doc("scoreboardConfig").get();
  return normalizeScoreboardConfig(snap.exists ? snap.data() : {});
}

async function collectSportsApiProScoreboard({ db, Timestamp, FieldValue, apiKey, fetchImpl, now = new Date() }) {
  const safeNow = nowDate(now);
  const config = await readScoreboardConfig(db);
  const translations = await loadScoreboardTranslations(db);
  const requests = planRequests(config, safeNow);
  const liveMatches = [];
  const scheduleMatches = [];
  const translationTerms = [];
  const errors = [];
  const fetchedAtBySport = {};
  let statusPayload = null;

  for (const request of requests) {
    try {
      const result = await fetchJson({ apiKey, fetchImpl, ...request });
      if (request.kind === "status") {
        statusPayload = sanitizeStatusPayload(result.payload, result.headers);
        continue;
      }
      const matches = normalizeMatches(result.payload, {
        sport: request.sport,
        kind: request.kind === "live" ? "live" : "today",
        featuredSources: config.featuredSources,
      });
      translationTerms.push(...collectTranslationTermsFromMatches(matches));
      const translatedMatches = applyScoreboardTranslationsToMatches(matches, translations);
      fetchedAtBySport[request.sport] = timestampFromMillis(Timestamp, safeNow.getTime());
      if (request.kind === "live") liveMatches.push(...translatedMatches);
      else scheduleMatches.push(...translatedMatches);
    } catch (err) {
      errors.push(safeError(err, request));
    }
  }

  const payload = snapshotFromResults({
    config,
    liveMatches,
    scheduleMatches,
    errors,
    statusPayload,
    fetchedAtBySport,
    now: safeNow,
    Timestamp,
    FieldValue,
  });

  const snapshotRef = db.collection(SNAPSHOT_DOC_PATH[0]).doc(SNAPSHOT_DOC_PATH[1]);
  if (payload.liveMatches.length || payload.recentSchedule.length || !errors.length) {
    await snapshotRef.set(payload, { merge: true });
  } else {
    await snapshotRef.set({
      provider: PROVIDER,
      lastErrorAt: FieldValue.serverTimestamp(),
      errors: payload.errors,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  const usageRef = db.collection("sportsApiProUsage").doc(dateKeyTaipei(safeNow));
  const usagePayload = {
    provider: PROVIDER,
    dateKey: dateKeyTaipei(safeNow),
    collectedAt: FieldValue.serverTimestamp(),
    lastRefresh: {
      ok: errors.length === 0,
      errorCount: errors.length,
      refreshedAt: FieldValue.serverTimestamp(),
    },
  };
  if (statusPayload) {
    usagePayload.account = statusPayload.account || null;
    usagePayload.usage = statusPayload.usage || null;
    usagePayload.rateLimitHeaders = statusPayload.rateLimitHeaders || null;
  }
  await usageRef.set(usagePayload, { merge: true });

  let translationMaintenance = null;
  try {
    const candidateResult = await recordTranslationCandidates({
      db,
      FieldValue,
      terms: translationTerms,
      lookup: translations,
    });
    const statsResult = await updateTranslationStats({ db, FieldValue, lookup: translations });
    translationMaintenance = {
      candidatesWritten: candidateResult?.written || 0,
      pending: statsResult?.totals?.pending ?? null,
      approved: statsResult?.totals?.approved ?? null,
      keepOriginal: statsResult?.totals?.keep_original ?? null,
    };
  } catch (err) {
    console.warn("[SportsAPIPro] translation maintenance skipped:", err?.message || err);
  }

  return {
    ok: errors.length === 0,
    generatedAt: safeNow.toISOString(),
    requestCount: requests.length,
    liveCount: payload.liveMatches.length,
    scheduleCount: payload.recentSchedule.length,
    translationMaintenance,
    errorCount: errors.length,
    errors,
  };
}

function rawEventFromPayload(payload) {
  if (!payload || typeof payload !== "object") return {};
  if (payload.event && typeof payload.event === "object") return payload.event;
  if (payload.data?.event && typeof payload.data.event === "object") return payload.data.event;
  if (payload.match && typeof payload.match === "object") return payload.match;
  if (payload.data?.match && typeof payload.data.match === "object") return payload.data.match;
  if (payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)) return payload.data;
  return payload;
}

function teamName(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value.name || value.shortName || value.slug || "";
  return "";
}

function tournamentName(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value.name || value.uniqueTournament?.name || "";
  return "";
}

function sanitizeStats(payload) {
  const candidates = [
    payload?.statistics,
    payload?.data?.statistics,
    payload?.stats,
    payload?.data?.stats,
  ];
  const rows = candidates.find(Array.isArray) || [];
  return rows.slice(0, 40).map((item) => ({
    group: safeText(item.groupName || item.group || item.type || "", 60),
    name: safeText(item.name || item.displayName || item.key || "", 80),
    home: item.home ?? item.homeValue ?? null,
    away: item.away ?? item.awayValue ?? null,
  })).filter((item) => item.name || item.group);
}

function sanitizeIncidents(payload) {
  const candidates = [payload?.incidents, payload?.data?.incidents, payload?.events, payload?.data?.events];
  const rows = candidates.find(Array.isArray) || [];
  return rows.slice(0, 60).map((item) => ({
    type: safeText(item.type || item.incidentType || "", 60),
    time: safeText(item.time || item.minute || item.text || "", 40),
    team: safeText(teamName(item.team), 80),
    player: safeText(item.player?.name || item.playerName || item.name || "", 100),
    text: safeText(item.text || item.description || "", 160),
  })).filter((item) => item.type || item.text || item.player);
}

function sanitizeLineups(payload) {
  const raw = payload?.lineups || payload?.data?.lineups || payload;
  if (!raw || typeof raw !== "object") return [];
  const teams = Array.isArray(raw) ? raw : [raw.home, raw.away].filter(Boolean);
  return teams.slice(0, 2).map((team) => ({
    team: safeText(teamName(team.team || team), 80),
    formation: safeText(team.formation || "", 40),
    playerCount: Array.isArray(team.players) ? team.players.length : null,
  })).filter((item) => item.team || item.formation || item.playerCount != null);
}

function sanitizeDetailPayload({ sport, matchId, matchPayload, statisticsPayload, incidentsPayload, lineupsPayload, unavailable, now, Timestamp, FieldValue, translations }) {
  const event = rawEventFromPayload(matchPayload);
  const homeTeam = teamName(event.homeTeam || event.home);
  const awayTeam = teamName(event.awayTeam || event.away);
  const title = [homeTeam, awayTeam].filter(Boolean).join(" vs ") || safeText(event.name || event.title || matchId, 160);
  const startsAt = isoFromAnyDate(event.startTimestamp || event.startTime || event.date || event.time);
  const league = safeText(tournamentName(event.tournament || event.league || event.competition), 120);
  const status = safeText(event.status?.description || event.status?.type || event.status || "", 80);
  const translatedMatch = applyScoreboardTranslationsToMatch({
    id: matchId,
    sport,
    title,
    homeTeam,
    awayTeam,
    league,
    subtitle: league,
    status,
  }, translations);
  const summary = {
    title: translatedMatch.title || title,
    league: safeText(translatedMatch.league || league, 120),
    homeTeam: safeText(translatedMatch.homeTeam || homeTeam, 100),
    awayTeam: safeText(translatedMatch.awayTeam || awayTeam, 100),
    score: {
      home: event.homeScore?.display ?? event.homeScore?.current ?? event.homeScore ?? null,
      away: event.awayScore?.display ?? event.awayScore?.current ?? event.awayScore ?? null,
    },
    status: safeText(translatedMatch.status || status, 80),
    startsAt: startsAt || null,
    venue: safeText(event.venue?.name || event.stadium?.name || event.venue || "", 120),
    referee: safeText(event.referee?.name || event.referee || "", 100),
  };
  [
    "homeTeamOriginal",
    "awayTeamOriginal",
    "leagueOriginal",
    "subtitleOriginal",
    "statusOriginal",
    "titleOriginal",
  ].forEach((key) => {
    if (translatedMatch[key]) summary[key] = safeText(translatedMatch[key], 160);
  });
  if (translatedMatch.translationStatus) summary.translationStatus = translatedMatch.translationStatus;
  return {
    schemaVersion: 1,
    provider: PROVIDER,
    sport,
    matchId,
    fetchedAt: timestampFromMillis(Timestamp, now.getTime()),
    expiresAt: timestampFromMillis(Timestamp, now.getTime() + SCOREBOARD_DETAIL_TTL_MS),
    summary,
    statistics: sanitizeStats(statisticsPayload),
    incidents: sanitizeIncidents(incidentsPayload),
    lineupsSummary: sanitizeLineups(lineupsPayload),
    unavailable: unavailable.slice(0, 8),
    updatedAt: FieldValue.serverTimestamp(),
  };
}

async function fetchSportsApiProDetail({ db, Timestamp, FieldValue, apiKey, sport, matchId, fetchImpl, now = new Date() }) {
  const safeSport = safeId(sport, 48);
  const safeMatchId = safeId(matchId, 80);
  if (!supportedSportKeys().includes(safeSport) || !safeMatchId) {
    const err = new Error("invalid sport or matchId");
    err.status = 400;
    throw err;
  }
  const config = await readScoreboardConfig(db);
  if (config.sports?.[safeSport]?.detailEnabled === false) {
    const err = new Error("detail disabled");
    err.status = 403;
    throw err;
  }

  const cacheKey = `${safeSport}_${safeMatchId}`;
  const ref = db.collection("scoreboardMatchDetails").doc(cacheKey);
  const cached = await ref.get();
  const nowMs = nowDate(now).getTime();
  const expiresAt = cached.exists ? cached.data()?.expiresAt?.toMillis?.() : 0;
  if (cached.exists && expiresAt && expiresAt > nowMs) {
    return { ok: true, cached: true, detail: cached.data() };
  }

  const translations = await loadScoreboardTranslations(db);
  const baseUrl = sportsApiBaseUrl(safeSport);
  const endpoints = [
    ["match", `/api/match/${encodeURIComponent(safeMatchId)}`],
    ["statistics", `/api/match/${encodeURIComponent(safeMatchId)}/statistics`],
    ["incidents", `/api/match/${encodeURIComponent(safeMatchId)}/incidents`],
    ["lineups", `/api/match/${encodeURIComponent(safeMatchId)}/lineups`],
  ];
  const responses = {};
  const unavailable = [];
  for (const [kind, path] of endpoints) {
    try {
      const response = await fetchJson({ apiKey, baseUrl, path, sport: safeSport, kind, fetchImpl });
      responses[kind] = response.payload;
    } catch (err) {
      unavailable.push(safeError(err, { sport: safeSport, kind }));
      if (kind === "match") throw err;
    }
  }

  const detail = sanitizeDetailPayload({
    sport: safeSport,
    matchId: safeMatchId,
    matchPayload: responses.match,
    statisticsPayload: responses.statistics,
    incidentsPayload: responses.incidents,
    lineupsPayload: responses.lineups,
    unavailable,
    now: nowDate(now),
    Timestamp,
    FieldValue,
    translations,
  });
  await ref.set(detail, { merge: true });
  try {
    const event = rawEventFromPayload(responses.match);
    const terms = collectTranslationTermsFromMatches([{
      id: safeMatchId,
      sport: safeSport,
      homeTeam: teamName(event.homeTeam || event.home),
      awayTeam: teamName(event.awayTeam || event.away),
      league: tournamentName(event.tournament || event.league || event.competition),
      subtitle: tournamentName(event.tournament || event.league || event.competition),
      status: event.status?.description || event.status?.type || event.status || "",
      title: detail.summary?.title || safeMatchId,
    }]);
    await recordTranslationCandidates({ db, FieldValue, terms, lookup: translations });
    await updateTranslationStats({ db, FieldValue, lookup: translations });
  } catch (err) {
    console.warn("[SportsAPIPro] detail translation maintenance skipped:", err?.message || err);
  }
  return { ok: true, cached: false, detail };
}

function requireRefreshPermission(request, getCallerAccessContext, HttpsError) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "auth required");
  }
  return getCallerAccessContext(request).then((access) => {
    if (!access?.isSuperAdmin && !access?.hasPermission?.("admin.scoreboard.configure")) {
      throw new HttpsError("permission-denied", "scoreboard permission required");
    }
    return access;
  });
}

function requireTranslationPermission(request, getCallerAccessContext, HttpsError) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "auth required");
  }
  return getCallerAccessContext(request).then((access) => {
    if (!access?.isSuperAdmin
      && !access?.hasPermission?.("admin.scoreboard.translation")
      && !access?.hasPermission?.("admin.scoreboard.configure")) {
      throw new HttpsError("permission-denied", "scoreboard translation permission required");
    }
    return access;
  });
}

function createSportsApiProScoreboardExports({ db, FieldValue, Timestamp, onCall, onSchedule, HttpsError, defineSecret, getCallerAccessContext }) {
  const SPORTSAPI_PRO_API_KEY = defineSecret("SPORTSAPI_PRO_API_KEY");

  async function runRefresh() {
    return collectSportsApiProScoreboard({
      db,
      Timestamp,
      FieldValue,
      apiKey: SPORTSAPI_PRO_API_KEY.value(),
    });
  }

  return {
    refreshSportsApiProScoreboardScheduled: onSchedule(
      {
        region: REGION,
        schedule: "every 6 hours",
        timeZone: "Asia/Taipei",
        timeoutSeconds: 180,
        memory: "256MiB",
        secrets: [SPORTSAPI_PRO_API_KEY],
      },
      async () => runRefresh(),
    ),

    refreshSportsApiProScoreboard: onCall(
      {
        region: REGION,
        timeoutSeconds: 180,
        memory: "256MiB",
        secrets: [SPORTSAPI_PRO_API_KEY],
      },
      async (request) => {
        await requireRefreshPermission(request, getCallerAccessContext, HttpsError);
        const todayRef = db.collection("sportsApiProUsage").doc(dateKeyTaipei());
        const todaySnap = await todayRef.get();
        const lastRefreshMs = todaySnap.exists ? todaySnap.data()?.manualRefreshAt?.toMillis?.() : 0;
        if (lastRefreshMs && Date.now() - lastRefreshMs < MANUAL_REFRESH_COOLDOWN_MS) {
          throw new HttpsError("resource-exhausted", "manual refresh cooldown");
        }
        await todayRef.set({ manualRefreshAt: FieldValue.serverTimestamp() }, { merge: true });
        return runRefresh();
      },
    ),

    fetchSportsApiProMatchDetail: onCall(
      {
        region: REGION,
        timeoutSeconds: 90,
        memory: "256MiB",
        secrets: [SPORTSAPI_PRO_API_KEY],
      },
      async (request) => {
        if (!request.auth?.uid) {
          throw new HttpsError("unauthenticated", "auth required");
        }
        try {
          const sport = request.data?.sport;
          const matchId = request.data?.matchId;
          return await fetchSportsApiProDetail({
            db,
            Timestamp,
            FieldValue,
            apiKey: SPORTSAPI_PRO_API_KEY.value(),
            sport,
            matchId,
          });
        } catch (err) {
          const status = Number(err?.status || 0);
          if (status === 400) throw new HttpsError("invalid-argument", "invalid sport or matchId");
          if (status === 403) throw new HttpsError("permission-denied", "detail disabled");
          if (status === 429) throw new HttpsError("resource-exhausted", "provider rate limited");
          throw new HttpsError("unavailable", "scoreboard detail unavailable");
        }
      },
    ),

    upsertScoreboardTranslations: onCall(
      {
        region: REGION,
        timeoutSeconds: 90,
        memory: "256MiB",
      },
      async (request) => {
        const access = await requireTranslationPermission(request, getCallerAccessContext, HttpsError);
        const result = await upsertScoreboardTranslations({
          db,
          FieldValue,
          items: request.data?.items,
          reviewerUid: request.auth?.uid || null,
          force: access.isSuperAdmin && request.data?.force === true,
        });
        if (!result.ok) throw new HttpsError("invalid-argument", "no valid translations");
        return result;
      },
    ),
  };
}

module.exports = {
  createSportsApiProScoreboardExports,
  __test: {
    dateKeyTaipei,
    safeError,
    fetchJson,
    compactMatch,
    snapshotFromResults,
    collectSportsApiProScoreboard,
    sanitizeDetailPayload,
    fetchSportsApiProDetail,
    SUPPORTED_SPORTS,
  },
};
