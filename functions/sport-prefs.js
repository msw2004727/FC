"use strict";
const config = require("./web-push-config");
const validate = require("./web-push-validate");
const catalog = require("./sport-catalog");
const { taipeiDayKey } = require("./notification-fields");

const LOG_SAVE = "[sportPrefs] save";
const LOG_ERROR = "[sportPrefs] error";
const SPORT_PREFS_CALLS_PER_UID_PER_DAY = 30;
const SPORT_PREFS_COUNTER_PREFIX = "pref_";
const SPORT_PREFS_ALLOWED_KEYS = Object.freeze(["addSports", "removeSport", "newEventNotify", "promptSeen"]);

function safeErrorCode(error) {
  const raw = error?.code;
  const text = typeof raw === "number" && Number.isInteger(raw) ? String(raw) : (typeof raw === "string" ? raw : "");
  return /^[A-Za-z0-9_-]{1,64}$/.test(text) ? text : "unknown";
}

function sanitizeFavSports(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (catalog.isFavSportTag(item) && !out.includes(item)) out.push(item);
    if (out.length >= catalog.FAV_SPORTS_MAX) break;
  }
  return out;
}

function sameArray(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return a === b;
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function parseSportPrefsInput(data) {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const proto = Object.getPrototypeOf(data);
  if (proto !== Object.prototype && proto !== null) return null;
  const keys = Object.keys(data);
  if (keys.length === 0) return null;
  if (!keys.every((k) => SPORT_PREFS_ALLOWED_KEYS.includes(k))) return null;
  for (const key of keys) {
    if (data[key] === undefined) return null;
  }
  const out = {};
  let hasAdd = false;
  let hasRemove = false;
  if (Object.prototype.hasOwnProperty.call(data, "addSports")) {
    const value = data.addSports;
    if (!Array.isArray(value) || value.length === 0 || value.length > catalog.FAV_SPORTS_MAX) return null;
    const seen = new Set();
    const cleaned = [];
    for (const item of value) {
      if (!catalog.isFavSportTag(item)) return null;
      if (!seen.has(item)) {
        seen.add(item);
        cleaned.push(item);
      }
    }
    out.addSports = cleaned;
    hasAdd = true;
  }
  if (Object.prototype.hasOwnProperty.call(data, "removeSport")) {
    const value = data.removeSport;
    if (!catalog.isFavSportTag(value)) return null;
    out.removeSport = value;
    hasRemove = true;
  }
  if (hasAdd && hasRemove) return null;
  if (Object.prototype.hasOwnProperty.call(data, "newEventNotify")) {
    if (typeof data.newEventNotify !== "boolean") return null;
    out.newEventNotify = data.newEventNotify;
  }
  if (Object.prototype.hasOwnProperty.call(data, "promptSeen")) {
    if (data.promptSeen !== true) return null;
    out.promptSeen = true;
  }
  return out;
}

function createSaveSportPrefsHandler({
  db,
  FieldValue,
  HttpsError,
  logger,
  now = () => Date.now(),
  settings = config,
}) {
  function logLine(label, { result, added = 0, removed = 0, favCount = null, notify = null, promptSeen = false }) {
    logger.info(label, { result, added, removed, favCount, notify, promptSeen });
  }

  async function saveSportPrefs(request) {
    if (!request?.auth || typeof request.auth.uid !== "string" || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }
    const input = parseSportPrefsInput(request.data);
    if (!input) {
      logLine(LOG_SAVE, { result: "invalid" });
      throw new HttpsError("invalid-argument", "SPORT_PREFS_INVALID");
    }
    const uid = request.auth.uid;
    const nowMs = now();
    const userRef = db.collection("users").doc(uid);
    const counterRef = db.collection(settings.WEB_PUSH_COLLECTIONS.daily)
      .doc(`${SPORT_PREFS_COUNTER_PREFIX}${taipeiDayKey(nowMs)}_${validate.uidHashOf(uid)}`);

    let outcome;
    try {
      outcome = await db.runTransaction(async (tx) => {
        const [userSnap, counterSnap] = await tx.getAll(userRef, counterRef);
        if (!userSnap.exists) return { result: "no_profile" };
        const calls = counterSnap.exists ? Number(counterSnap.data()?.count) || 0 : 0;
        if (calls >= SPORT_PREFS_CALLS_PER_UID_PER_DAY) return { result: "rate_limited" };
        const user = userSnap.data() || {};
        const current = sanitizeFavSports(user.favSports);
        let next = current;
        if (input.addSports) {
          next = [...current, ...input.addSports.filter((t) => !current.includes(t))];
        }
        if (input.removeSport) {
          next = current.filter((t) => t !== input.removeSport);
        }
        if (next.length > catalog.FAV_SPORTS_MAX) return { result: "too_many" };
        const patch = {};
        if ((input.addSports || input.removeSport) && !sameArray(next, user.favSports)) patch.favSports = next;
        if (input.newEventNotify !== undefined && user.newEventNotify !== input.newEventNotify) {
          patch.newEventNotify = input.newEventNotify;
        }
        if (!user.favSportsPromptAt && (input.promptSeen === true || input.addSports)) {
          patch.favSportsPromptAt = FieldValue.serverTimestamp();
        }
        if (Object.keys(patch).length > 0) tx.update(userRef, patch);
        tx.set(counterRef, {
          count: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
          expireAt: new Date(nowMs + settings.WEB_PUSH_DAILY_RETENTION_MS),
        }, { merge: true });
        const notify = (patch.newEventNotify !== undefined ? patch.newEventNotify : user.newEventNotify) !== false;
        return {
          result: Object.keys(patch).length > 0 ? "saved" : "noop",
          favSports: next,
          newEventNotify: notify,
          added: next.length - current.length > 0 ? next.length - current.length : 0,
          removed: current.length - next.length > 0 ? current.length - next.length : 0,
        };
      });
    } catch (error) {
      logger.error(LOG_ERROR, { stage: "save_txn", code: safeErrorCode(error) });
      throw new HttpsError("internal", "SPORT_PREFS_FAILED");
    }

    logLine(LOG_SAVE, {
      result: outcome.result,
      added: outcome.added || 0,
      removed: outcome.removed || 0,
      favCount: Array.isArray(outcome.favSports) ? outcome.favSports.length : null,
      notify: typeof outcome.newEventNotify === "boolean" ? outcome.newEventNotify : null,
      promptSeen: input.promptSeen === true,
    });

    if (outcome.result === "no_profile") {
      throw new HttpsError("failed-precondition", "SPORT_PREFS_PROFILE_MISSING");
    }
    if (outcome.result === "rate_limited") {
      throw new HttpsError("resource-exhausted", "RATE_LIMITED");
    }
    if (outcome.result === "too_many") {
      throw new HttpsError("invalid-argument", "SPORT_PREFS_INVALID");
    }
    return { ok: true, favSports: outcome.favSports, newEventNotify: outcome.newEventNotify };
  }

  return saveSportPrefs;
}

module.exports = {
  createSaveSportPrefsHandler,
  parseSportPrefsInput,
  SPORT_PREFS_CALLS_PER_UID_PER_DAY,
  SPORT_PREFS_ALLOWED_KEYS,
};
