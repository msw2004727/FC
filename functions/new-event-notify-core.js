"use strict";
const crypto = require("crypto");
const catalog = require("./sport-catalog");
const validate = require("./web-push-validate");

const NEW_EVENT_PENDING_COLLECTION = "newEventPending";
const SPORT_NEW_EVENT_DAILY_COLLECTION = "sportNewEventDaily";
const NEW_EVENT_PENDING_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
const SPORT_NEW_EVENT_DAILY_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
const NEW_EVENT_DELAY_MS = 10 * 60 * 1000;
const PENDING_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const PENDING_SCAN_LIMIT = 200;
const MAX_EXPANSIONS_PER_RUN = 10;
const RUN_TIME_BUDGET_MS = 200 * 1000;
const MAX_RECIPIENTS_PER_EXPANSION = 500;
const SUBSCRIPTION_IN_CHUNK = 30;
const CREATOR_EXPANSIONS_PER_DAY = 2;
const CREATOR_COUNTER_PREFIX = "nehost_";
const QUIET_START_HOUR = 23;
const QUIET_END_HOUR = 8;
const EVENT_DOC_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ELIGIBLE_STATUSES = Object.freeze(["open", "upcoming"]);
const WEEKDAY_ZH = "日一二三四五六";

function toMillis(v) {
  if (v && typeof v.toMillis === "function") return v.toMillis();
  if (Object.prototype.toString.call(v) === "[object Date]") return v.getTime();
  return NaN;
}

function sha256Hex32(text) {
  return crypto.createHash("sha256").update(String(text)).digest("hex").slice(0, 32);
}

function isQuietHour(nowMs) {
  const h = new Date(nowMs + 8 * 3600 * 1000).getUTCHours();
  return h >= QUIET_START_HOUR || h < QUIET_END_HOUR;
}

function createTimeReason(data, eventId) {
  if (!EVENT_DOC_ID_RE.test(eventId)) return "bad_id";
  if (data && data.privateEvent === true) return "private";
  if (data && data.teamOnly === true) return "team_only";
  if (data && data.type === "external") return "external";
  if (!catalog.isFavSportTag(data && data.sportTag)) return "sport";
  return "";
}

function dispatchTimeReason(data, eventId, nowMs) {
  if (!data || typeof data !== "object") return "gone";
  const base = createTimeReason(data, eventId);
  if (base) return base;
  if (!ELIGIBLE_STATUSES.includes(data.status)) return "status";
  const startMs = toMillis(data.startTimestamp);
  if (!Number.isFinite(startMs) || startMs <= nowMs) return "started";
  if (typeof data.creatorUid !== "string" || !data.creatorUid) return "no_creator";
  return "";
}

function resolveTargetCities(data) {
  const input = data || {};
  if (input.regionEnabled === false) return [...catalog.TW_CITIES];
  const rawCities = Array.isArray(input.cities) ? input.cities : [];
  const cities = [...new Set(rawCities.map((city) => catalog.normalizeCity(city)).filter((city) => catalog.isKnownCity(city)))];
  if (cities.length > 0) return cities;
  const region = String(input.region || "").trim();
  const mapped = catalog.REGION_CITY_MAP[region];
  if (mapped) return [...mapped];
  return [...catalog.TW_CITIES];
}

function userMatchesCities(userRegion, citySet) {
  const c = catalog.normalizeCity(userRegion);
  if (!catalog.isKnownCity(c)) return true;
  return citySet.has(c);
}

function formatStartLabel(startMs) {
  const t = new Date(startMs + 8 * 3600 * 1000);
  const pad2 = (n) => String(n).padStart(2, "0");
  return `${t.getUTCMonth() + 1}/${t.getUTCDate()}（${WEEKDAY_ZH[t.getUTCDay()]}）${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}`;
}

function buildNewEventNotice({ sportTag, startMs, eventId }) {
  return {
    title: `${catalog.sportLabelOf(sportTag)}有新活動囉！`,
    body: `${formatStartLabel(startMs)}，點開看看`,
    url: `/events/${eventId}`,
  };
}

function queueIdOf({ dayKey, sportTag, uid }) {
  return `ne_${dayKey}_${sportTag}_${validate.uidHashOf(uid)}`;
}

function dailyMarkerIdOf({ dayKey, sportTag, city }) {
  return sha256Hex32(`${dayKey}|${sportTag}|${city}`);
}

function creatorCounterIdOf({ dayKey, uid }) {
  return `${CREATOR_COUNTER_PREFIX}${dayKey}_${validate.uidHashOf(uid)}`;
}

module.exports = {
  NEW_EVENT_PENDING_COLLECTION,
  SPORT_NEW_EVENT_DAILY_COLLECTION,
  NEW_EVENT_PENDING_RETENTION_MS,
  SPORT_NEW_EVENT_DAILY_RETENTION_MS,
  NEW_EVENT_DELAY_MS,
  PENDING_MAX_AGE_MS,
  PENDING_SCAN_LIMIT,
  MAX_EXPANSIONS_PER_RUN,
  RUN_TIME_BUDGET_MS,
  MAX_RECIPIENTS_PER_EXPANSION,
  SUBSCRIPTION_IN_CHUNK,
  CREATOR_EXPANSIONS_PER_DAY,
  CREATOR_COUNTER_PREFIX,
  QUIET_START_HOUR,
  QUIET_END_HOUR,
  EVENT_DOC_ID_RE,
  ELIGIBLE_STATUSES,
  WEEKDAY_ZH,
  toMillis,
  sha256Hex32,
  isQuietHour,
  createTimeReason,
  dispatchTimeReason,
  resolveTargetCities,
  userMatchesCities,
  formatStartLabel,
  buildNewEventNotice,
  queueIdOf,
  dailyMarkerIdOf,
  creatorCounterIdOf,
};
