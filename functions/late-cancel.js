"use strict";
// 臨時取消時限（契約 late-cancel-contract-2026-11-23）。純函式：不讀寫 Firestore、不改輸入。
const LATE_CANCEL_HOURS = Object.freeze([0, 2, 3, 6, 12, 24, 48]);
const DEFAULT_LATE_CANCEL_HOURS = 2;
// 暫定值：上線時由 PM／顧問依「前端上線日＋至少 1 天」確認，前後端同步改（契約 §2）。
const LATE_CANCEL_SINCE_MS = Date.parse("2026-11-25T00:00:00+08:00");
const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const LATE_CANCEL_RECENT_WINDOW_MS = 90 * DAY_MS;
const LATE_CANCEL_RECENT_MAX = 5;
const LATE_CANCEL_RED_THRESHOLD = 3;
const LATE_CANCEL_BLACK_DAYS = 7;
const LATE_CANCEL_BLACK_ATTEND = 3;

function normalizeLateCancelHours(event) {
  const v = event?.lateCancelHours;
  if (v === undefined) return DEFAULT_LATE_CANCEL_HOURS;
  return typeof v === "number" && LATE_CANCEL_HOURS.includes(v) ? v : 0;
}

function isLateCancelEventEligible(event) {
  if (!(normalizeLateCancelHours(event) > 0)) return false;
  const hasCourseLinkId = typeof event?.courseLinkId === "string" && event.courseLinkId.trim() !== "";
  if (hasCourseLinkId) return false;
  if (event?.status === "cancelled") return false;
  return true;
}

function toMillisOrNull(value) {
  if (value === undefined || value === null) return null;
  try {
    if (typeof value.toMillis === "function") {
      const ms = value.toMillis();
      return Number.isFinite(ms) ? ms : null;
    }
  } catch (_error) {
    return null;
  }
  if (Object.prototype.toString.call(value) === "[object Date]") {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return null;
}

function evaluateLateCancel({
  eventData,
  eventStartMs,
  nowMs,
  cancelReason,
  targetRegs,
  isCourseLinkedReg,
  sinceMs = LATE_CANCEL_SINCE_MS,
} = {}) {
  if (typeof isCourseLinkedReg !== "function") {
    throw new TypeError("isCourseLinkedReg must be a function");
  }

  const hours = normalizeLateCancelHours(eventData);
  const notMarked = { marked: false, markedRegDocIds: [], hours };

  if (cancelReason !== "user_cancel") return notMarked;
  if (!isLateCancelEventEligible(eventData)) return notMarked;
  if (!(Number.isFinite(eventStartMs) && eventStartMs >= sinceMs)) return notMarked;

  const diff = eventStartMs - nowMs;
  if (!(diff > 0 && diff <= hours * HOUR_MS)) return notMarked;

  const promotedCutoffMs = eventStartMs - hours * HOUR_MS;
  const markedRegDocIds = [];
  for (const reg of Array.isArray(targetRegs) ? targetRegs : []) {
    if (!reg || reg.status !== "confirmed") continue;
    if (isCourseLinkedReg(reg)) continue;
    const promotedMs = toMillisOrNull(reg.promotedAt);
    if (promotedMs !== null && promotedMs >= promotedCutoffMs) continue;
    if (typeof reg._docId === "string" && reg._docId) markedRegDocIds.push(reg._docId);
  }

  return {
    marked: markedRegDocIds.length > 0,
    markedRegDocIds,
    hours,
  };
}

function computeLateCancelUserPatch({ userData, attendedCount, nowMs } = {}) {
  const data = userData || {};
  const level = data?.lateCancelLevel;
  const untilMs = toMillisOrNull(data?.lateCancelUntil);
  const releaseAt = Number.isFinite(data?.lateCancelReleaseAt) ? data.lateCancelReleaseAt : 0;
  const attended = Number.isFinite(attendedCount) && attendedCount >= 0 ? Math.floor(attendedCount) : 0;
  const blackActive = level === "black"
    && untilMs !== null
    && untilMs > nowMs
    && attended < releaseAt;

  const recentRaw = Array.isArray(data?.lateCancelRecent) ? data.lateCancelRecent : [];
  const windowStartMs = nowMs - LATE_CANCEL_RECENT_WINDOW_MS;
  const recentPrev = recentRaw
    .map(toMillisOrNull)
    .filter((t) => t !== null && t > windowStartMs)
    .sort((a, b) => a - b);
  const recentNext = [...recentPrev, nowMs].slice(-LATE_CANCEL_RECENT_MAX);

  const totalPrev = Number.isInteger(data?.lateCancelTotal) && data.lateCancelTotal >= 0
    ? data.lateCancelTotal
    : 0;
  const totalNext = totalPrev + 1;

  if (level === "red" || recentNext.length >= LATE_CANCEL_RED_THRESHOLD) {
    return {
      lateCancelLevel: "red",
      lateCancelRecentMs: recentNext,
      lateCancelTotal: totalNext,
    };
  }

  const baseUntilMs = blackActive ? untilMs : nowMs;
  const baseReleaseAt = blackActive ? releaseAt : attended;
  return {
    lateCancelLevel: "black",
    lateCancelUntilMs: baseUntilMs + LATE_CANCEL_BLACK_DAYS * DAY_MS,
    lateCancelReleaseAt: baseReleaseAt + LATE_CANCEL_BLACK_ATTEND,
    lateCancelRecentMs: recentNext,
    lateCancelTotal: totalNext,
  };
}

function buildLateCancelMarkId(eventDocId, operatorUid) {
  if (typeof eventDocId !== "string" || eventDocId.trim() === "") return null;
  if (typeof operatorUid !== "string" || operatorUid.trim() === "") return null;
  return `${eventDocId}_${operatorUid}`;
}

function toFirestoreUserPatch(patch, Timestamp) {
  const out = {};
  if (Object.prototype.hasOwnProperty.call(patch, "lateCancelLevel")) {
    out.lateCancelLevel = patch.lateCancelLevel;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lateCancelUntilMs")) {
    out.lateCancelUntil = Timestamp.fromMillis(patch.lateCancelUntilMs);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lateCancelReleaseAt")) {
    out.lateCancelReleaseAt = patch.lateCancelReleaseAt;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lateCancelRecentMs")) {
    out.lateCancelRecent = patch.lateCancelRecentMs.map((ms) => Timestamp.fromMillis(ms));
  }
  if (Object.prototype.hasOwnProperty.call(patch, "lateCancelTotal")) {
    out.lateCancelTotal = patch.lateCancelTotal;
  }
  return out;
}

function createLateCancelMarker({ db, FieldValue, Timestamp, logger = console } = {}) {
  if (!db || !FieldValue || !Timestamp) {
    throw new TypeError("createLateCancelMarker requires db, FieldValue, Timestamp");
  }

  return async function markLateCancelForOperator({
    eventDocId,
    eventId,
    operatorUid,
    regDocIds,
    loadOperatorUser,
  } = {}) {
    const markId = buildLateCancelMarkId(eventDocId, operatorUid);
    if (!markId) {
      logger.warn("[lateCancelMark] skipped", { reason: "MARK_ID_INVALID" });
      return { status: "skipped" };
    }

    const found = await loadOperatorUser();
    if (!found?.docId) {
      logger.warn("[lateCancelMark] skipped", { reason: "USER_NOT_FOUND" });
      return { status: "skipped" };
    }

    const markRef = db.collection("lateCancelMarks").doc(markId);
    const userRef = db.collection("users").doc(found.docId);
    const statsRef = db.collection("userAttendanceStats").doc(operatorUid);
    const safeRegDocIds = Array.isArray(regDocIds)
      ? regDocIds.filter((id) => typeof id === "string" && id).slice(0, 20)
      : [];

    try {
      return await db.runTransaction(async (tx) => {
        const [markSnap, userSnap, statsSnap] = await tx.getAll(markRef, userRef, statsRef);
        if (markSnap.exists) return { status: "duplicate" };
        if (!userSnap.exists) return { status: "skipped" };

        const nowMs = Date.now();
        const patch = computeLateCancelUserPatch({
          userData: userSnap.data() || {},
          attendedCount: statsSnap.exists ? statsSnap.data()?.attendedCount : 0,
          nowMs,
        });

        tx.create(markRef, {
          eventId,
          eventDocId,
          uid: operatorUid,
          regDocIds: safeRegDocIds,
          level: patch.lateCancelLevel,
          createdAt: FieldValue.serverTimestamp(),
        });
        tx.update(userRef, toFirestoreUserPatch(patch, Timestamp));
        return { status: "marked", level: patch.lateCancelLevel };
      });
    } catch (error) {
      logger.error("[lateCancelMark] failed", {
        code: String(error?.code || "unknown").slice(0, 40),
      });
      const sanitized = new Error("LATE_CANCEL_MARK_FAILED");
      sanitized.code = error?.code || "unknown";
      throw sanitized;
    }
  };
}

module.exports = {
  LATE_CANCEL_HOURS,
  DEFAULT_LATE_CANCEL_HOURS,
  LATE_CANCEL_SINCE_MS,
  normalizeLateCancelHours,
  isLateCancelEventEligible,
  evaluateLateCancel,
  computeLateCancelUserPatch,
  buildLateCancelMarkId,
  createLateCancelMarker,
  __test: { toMillisOrNull },
};
