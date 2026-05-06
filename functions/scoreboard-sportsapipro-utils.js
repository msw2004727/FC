"use strict";

const SCOREBOARD_SNAPSHOT_TTL_MS = 15 * 60 * 1000;
const SCOREBOARD_DETAIL_TTL_MS = 30 * 60 * 1000;
const SCOREBOARD_REFRESH_REQUEST_LIMIT = 28;

const SUPPORTED_SPORTS = Object.freeze([
  ["football", "football", "足球", true],
  ["basketball", "basketball", "籃球 / NBA", true],
  ["tennis", "tennis", "網球", true],
  ["mma", "mma", "綜合格鬥", false],
  ["american_football", "american-football", "美式足球", false],
  ["ice_hockey", "ice-hockey", "冰球", false],
  ["rugby", "rugby", "橄欖球", false],
  ["baseball", "baseball", "棒壘球", true],
  ["handball", "handball", "手球", false],
  ["volleyball", "volleyball", "排球", false],
  ["table_tennis", "table-tennis", "桌球", false],
  ["badminton", "badminton", "羽球", true],
  ["esports", "esports", "電競", false],
  ["darts", "darts", "飛鏢", false],
  ["cricket", "cricket", "板球", false],
  ["motorsport", "motorsport", "賽車", false],
  ["futsal", "futsal", "五人制足球", false],
  ["water_polo", "water-polo", "水球", false],
  ["snooker", "snooker", "撞球 / 司諾克", false],
  ["aussie_rules", "aussie-rules", "澳洲式足球", false],
  ["cycling", "cycling", "自行車", false],
  ["beach_volleyball", "beach-volleyball", "沙灘排球", false],
  ["minifootball", "minifootball", "小型足球", false],
  ["floorball", "floorball", "福樂球", false],
  ["bandy", "bandy", "班迪球", false],
  ["boxing", "boxing", "拳擊", false],
  ["rugby_league", "rugby-league", "聯盟式橄欖球", false],
  ["golf", "golf", "高爾夫", false],
  ["field_hockey", "field-hockey", "曲棍球", false],
  ["beach_soccer", "beach-soccer", "沙灘足球", false],
  ["netball", "netball", "籃網球", false],
  ["pesapallo", "pesapallo", "芬蘭棒球", false],
  ["horse_racing", "horse-racing", "賽馬", false],
  ["winter_sports", "winter-sports", "冬季運動", false],
  ["kabaddi", "kabaddi", "卡巴迪", false],
].map(([key, apiSlug, label, defaultEnabled], index) => Object.freeze({
  key,
  apiSlug,
  label,
  defaultEnabled,
  sourceKey: `sportsapipro_v2_${key}`,
  sortOrder: index + 1,
})));

const FEATURED_SOURCES = Object.freeze([
  ["premier_league", "football", "英超", ["premier league", "epl"]],
  ["laliga", "football", "西甲", ["laliga", "la liga"]],
  ["serie_a", "football", "義甲", ["serie a"]],
  ["bundesliga", "football", "德甲", ["bundesliga"]],
  ["ligue_1", "football", "法甲", ["ligue 1"]],
  ["champions_league", "football", "歐冠", ["champions league"]],
  ["europa_league", "football", "歐聯", ["europa league"]],
  ["world_cup", "football", "世界盃", ["world cup"]],
  ["nba", "basketball", "NBA", ["nba", "national basketball association"]],
  ["mlb", "baseball", "MLB", ["mlb", "major league baseball"]],
  ["bwf", "badminton", "BWF", ["bwf", "badminton world federation"]],
].map(([id, sport, label, keywords], index) => Object.freeze({
  id,
  sport,
  label,
  matchKeywords: keywords,
  sortOrder: index + 1,
})));

function sportByKey(key) {
  return SUPPORTED_SPORTS.find((sport) => sport.key === String(key || ""));
}

function sportsApiBaseUrl(sportKey) {
  const sport = sportByKey(sportKey);
  if (!sport) return null;
  return `https://v2.${sport.apiSlug}.sportsapipro.com`;
}

function supportedSportKeys() {
  return SUPPORTED_SPORTS.map((sport) => sport.key);
}

function formatTaipeiDate(date = new Date()) {
  const value = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function toBool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function clampInt(value, fallback, min = 1, max = 999) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function defaultSportsConfig() {
  return SUPPORTED_SPORTS.reduce((acc, sport) => {
    acc[sport.key] = {
      enabled: sport.defaultEnabled,
      homepageEnabled: sport.defaultEnabled,
      liveEnabled: true,
      scheduleEnabled: true,
      detailEnabled: true,
      sortOrder: sport.sortOrder,
      label: sport.label,
      apiSport: sport.apiSlug,
      sourceKey: sport.sourceKey,
    };
    return acc;
  }, {});
}

function defaultFeaturedSources() {
  return FEATURED_SOURCES.reduce((acc, source) => {
    acc[source.id] = {
      enabled: source.sport === "football" || source.id === "nba",
      sport: source.sport,
      label: source.label,
      matchKeywords: source.matchKeywords.slice(),
      sortOrder: source.sortOrder,
    };
    return acc;
  }, {});
}

function uniqueCatalogList(value, allowedKeys, limit = allowedKeys.length) {
  if (!Array.isArray(value)) return null;
  const allowed = new Set(allowedKeys);
  return Array.from(new Set(value.map((item) => String(item || "").trim()).filter((item) => allowed.has(item)))).slice(0, limit);
}

function applySportToggleList(sports, list, prop) {
  if (!Array.isArray(list)) return;
  const enabled = new Set(uniqueCatalogList(list, supportedSportKeys()) || []);
  for (const sport of Object.keys(sports)) {
    sports[sport][prop] = enabled.has(sport);
  }
}

function applySportOrderList(sports, list) {
  const order = uniqueCatalogList(list, supportedSportKeys());
  if (!order) return;
  order.forEach((key, index) => {
    if (sports[key]) sports[key].sortOrder = index + 1;
  });
}

function applyFeaturedToggleList(featuredSources, list) {
  if (!Array.isArray(list)) return;
  const allowedKeys = FEATURED_SOURCES.map((source) => source.id);
  const enabled = new Set(uniqueCatalogList(list, allowedKeys) || []);
  for (const source of Object.keys(featuredSources)) {
    featuredSources[source].enabled = enabled.has(source);
  }
}

function applyFeaturedOrderList(featuredSources, list) {
  const allowedKeys = FEATURED_SOURCES.map((source) => source.id);
  const order = uniqueCatalogList(list, allowedKeys);
  if (!order) return;
  order.forEach((key, index) => {
    if (featuredSources[key]) featuredSources[key].sortOrder = index + 1;
  });
}

function normalizeScoreboardConfig(raw = {}) {
  const input = raw && typeof raw === "object" ? raw : {};
  const inputSports = input.sports && typeof input.sports === "object" ? input.sports : {};
  const sports = defaultSportsConfig();
  for (const sport of SUPPORTED_SPORTS) {
    const src = inputSports[sport.key] || {};
    sports[sport.key] = {
      ...sports[sport.key],
      enabled: toBool(src.enabled, sports[sport.key].enabled),
      homepageEnabled: toBool(src.homepageEnabled, sports[sport.key].homepageEnabled),
      liveEnabled: toBool(src.liveEnabled, true),
      scheduleEnabled: toBool(src.scheduleEnabled, true),
      detailEnabled: toBool(src.detailEnabled, true),
      sortOrder: clampInt(src.sortOrder, sports[sport.key].sortOrder),
      label: String(src.label || sports[sport.key].label).slice(0, 24),
    };
  }
  applySportToggleList(sports, input.enabledSports, "enabled");
  if (Array.isArray(input.homepageSports)) {
    applySportToggleList(sports, input.homepageSports, "homepageEnabled");
  } else {
    for (const sport of Object.keys(sports)) {
      sports[sport].homepageEnabled = sports[sport].enabled;
    }
  }
  applySportToggleList(sports, input.liveSports, "liveEnabled");
  applySportToggleList(sports, input.scheduleSports, "scheduleEnabled");
  applySportToggleList(sports, input.detailSports, "detailEnabled");
  applySportOrderList(sports, input.sportsOrder);

  const inputFeatured = input.featuredSources && typeof input.featuredSources === "object" ? input.featuredSources : {};
  const featuredSources = defaultFeaturedSources();
  for (const source of FEATURED_SOURCES) {
    const src = inputFeatured[source.id] || {};
    featuredSources[source.id] = {
      ...featuredSources[source.id],
      enabled: toBool(src.enabled, featuredSources[source.id].enabled),
      label: String(src.label || featuredSources[source.id].label).slice(0, 24),
      sortOrder: clampInt(src.sortOrder, featuredSources[source.id].sortOrder),
      matchKeywords: Array.isArray(src.matchKeywords)
        ? src.matchKeywords.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean).slice(0, 12)
        : featuredSources[source.id].matchKeywords.slice(),
    };
  }
  applyFeaturedToggleList(featuredSources, input.enabledFeaturedSources);
  applyFeaturedOrderList(featuredSources, input.featuredSourceOrder);
  const defaultSportTabs = Array.isArray(input.defaultSportTabs)
    ? input.defaultSportTabs.filter((key) => sports[key]?.enabled).slice(0, SUPPORTED_SPORTS.length)
    : SUPPORTED_SPORTS.filter((sport) => sports[sport.key]?.enabled).map((sport) => sport.key);
  return {
    schemaVersion: 2,
    homepageEnabled: toBool(input.homepageEnabled, true),
    publicPageEnabled: toBool(input.publicPageEnabled, true),
    defaultSportTabs,
    sports,
    featuredSources,
  };
}

function planRequests(config, now = new Date()) {
  const normalized = normalizeScoreboardConfig(config);
  const today = formatTaipeiDate(now);
  const tomorrow = formatTaipeiDate(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const requests = [];
  const sortedSports = Object.entries(normalized.sports)
    .filter(([, sport]) => sport?.enabled)
    .sort((a, b) => Number(a[1].sortOrder || 99) - Number(b[1].sortOrder || 99));
  const orderedSports = [
    ...sortedSports.filter(([, sportConfig]) => sportConfig?.homepageEnabled !== false),
    ...sortedSports.filter(([, sportConfig]) => sportConfig?.homepageEnabled === false),
  ];
  for (const [sportKey, sportConfig] of orderedSports) {
    const baseUrl = sportsApiBaseUrl(sportKey);
    if (!baseUrl) continue;
    if (sportConfig.liveEnabled !== false) requests.push({ sport: sportKey, kind: "live", baseUrl, path: "/api/live" });
    if (sportConfig.scheduleEnabled !== false) requests.push({ sport: sportKey, kind: "today", baseUrl, path: "/api/today" });
    if (sportConfig.scheduleEnabled !== false && sportConfig.homepageEnabled !== false) {
      requests.push({
        sport: sportKey,
        kind: "tomorrow",
        baseUrl,
        path: `/api/schedule/${tomorrow}?timezoneName=Asia%2FTaipei`,
      });
    }
    if (requests.length >= SCOREBOARD_REFRESH_REQUEST_LIMIT) break;
  }
  if (requests.length < SCOREBOARD_REFRESH_REQUEST_LIMIT) {
    requests.push({ sport: "football", kind: "status", baseUrl: sportsApiBaseUrl("football"), path: "/status" });
  }
  return requests.slice(0, SCOREBOARD_REFRESH_REQUEST_LIMIT).map((request) => ({ ...request, date: today }));
}

function pickEvents(payload) {
  if (!payload || typeof payload !== "object") return [];
  const candidates = [payload.events, payload.data?.events, payload.games, payload.data?.games, payload.response, payload.data];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function teamName(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value.name || value.shortName || value.slug || "";
  return "";
}

function scoreValue(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "object") return value.display ?? value.current ?? value.run ?? null;
  return null;
}

function statusInfo(value, fallbackCode) {
  if (typeof value === "string") return { text: value, code: fallbackCode ?? null, type: "" };
  if (value && typeof value === "object") {
    return { text: value.description || value.type || "", code: value.code ?? fallbackCode ?? null, type: value.type || "" };
  }
  return { text: "", code: fallbackCode ?? null, type: "" };
}

function tournamentName(event) {
  const value = event?.tournament || event?.league || event?.competition;
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value.name || value.uniqueTournament?.name || "";
  return "";
}

function isoFromTimestamp(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric * 1000).toISOString();
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function matchFeaturedSource(event, sport, featuredSources = defaultFeaturedSources()) {
  const league = tournamentName(event).toLowerCase();
  const slug = String(event?.slug || "").toLowerCase();
  return Object.entries(featuredSources)
    .filter(([, source]) => source?.enabled !== false && source.sport === sport)
    .sort((a, b) => Number(a[1].sortOrder || 99) - Number(b[1].sortOrder || 99))
    .find(([, source]) => (source.matchKeywords || []).some((keyword) => league.includes(keyword) || slug.includes(keyword)))?.[0] || sport;
}

function normalizeMatch(event, { sport, kind = "live", featuredSources } = {}) {
  if (!event || typeof event !== "object") return null;
  const id = String(event.id || event.eventId || event.matchId || "").trim();
  if (!id) return null;
  const homeTeam = teamName(event.homeTeam || event.home);
  const awayTeam = teamName(event.awayTeam || event.away);
  const status = statusInfo(event.status, event.statusCode);
  const startsAt = isoFromTimestamp(event.startTimestamp || event.startTime || event.date || event.time);
  const rawCode = status.code;
  const code = rawCode == null || rawCode === "" ? null : Number(rawCode);
  const statusType = String(status.type || status.text || "").toLowerCase();
  const isFinished = [100, 110, 120].includes(code) || statusType.includes("finish") || statusType.includes("ended");
  const isLive = kind === "live" && !isFinished && code !== 0;
  return {
    id,
    sport,
    sourceId: matchFeaturedSource(event, sport, featuredSources),
    league: tournamentName(event),
    tournamentId: event.tournamentId || event.tournament?.id || event.tournament?.uniqueTournament?.id || null,
    title: [homeTeam, awayTeam].filter(Boolean).join(" vs "),
    subtitle: tournamentName(event),
    homeTeam,
    awayTeam,
    homeScore: scoreValue(event.homeScore),
    awayScore: scoreValue(event.awayScore),
    status: status.text || (isLive ? "Live" : "Scheduled"),
    statusCode: Number.isFinite(code) ? code : null,
    startsAt,
    timeLabel: startsAt ? new Date(startsAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Taipei" }) : "",
    dateLabel: startsAt ? new Date(startsAt).toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit", timeZone: "Asia/Taipei" }) : "",
    isLive,
    isFinished,
    hasDetail: true,
    detailCacheKey: `${sport}_${id}`.replace(/[^a-z0-9_-]/gi, "_"),
  };
}

function normalizeMatches(payload, options) {
  return pickEvents(payload).map((event) => normalizeMatch(event, options)).filter(Boolean);
}

function sanitizeStatusPayload(payload, headers = {}) {
  const usage = payload?.usage || {};
  const account = payload?.account || {};
  return {
    provider: "sportsapipro",
    account: { plan: account.plan || payload?.plan || null },
    usage: {
      dailyLimit: usage.daily_limit ?? usage.dailyLimit ?? null,
      remaining: usage.remaining ?? null,
      requestsToday: usage.requests_today ?? usage.requestsToday ?? null,
      resetAt: usage.reset_at ?? usage.resetAt ?? null,
    },
    rateLimitHeaders: {
      limit: headers["x-ratelimit-limit"] || null,
      remaining: headers["x-ratelimit-remaining"] || null,
      reset: headers["x-ratelimit-reset"] || null,
    },
  };
}

module.exports = {
  SCOREBOARD_SNAPSHOT_TTL_MS,
  SCOREBOARD_DETAIL_TTL_MS,
  SCOREBOARD_REFRESH_REQUEST_LIMIT,
  SUPPORTED_SPORTS,
  FEATURED_SOURCES,
  sportsApiBaseUrl,
  supportedSportKeys,
  formatTaipeiDate,
  defaultSportsConfig,
  defaultFeaturedSources,
  normalizeScoreboardConfig,
  planRequests,
  pickEvents,
  normalizeMatch,
  normalizeMatches,
  sanitizeStatusPayload,
};
