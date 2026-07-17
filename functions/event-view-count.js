"use strict";

const crypto = require("crypto");

const EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;
const MARKER_COLLECTION = "eventViewCountMarkers";
const TAIPEI_TIME_ZONE = "Asia/Taipei";

function sanitizeEventKey(value, fieldName, HttpsError) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!EVENT_ID_PATTERN.test(normalized)) {
    throw new HttpsError("invalid-argument", `${fieldName} is invalid`);
  }
  return normalized;
}

function getTaipeiDayKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError("now must resolve to a valid date");
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TAIPEI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function buildViewMarkerId(uid, eventId, dayKey) {
  return crypto
    .createHash("sha256")
    .update(`${uid}\u0000${eventId}\u0000${dayKey}`, "utf8")
    .digest("hex");
}

function normalizeLegacyViewCount(value) {
  const candidate = typeof value === "string" && /^\d+$/.test(value.trim())
    ? Number(value.trim())
    : value;
  if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0) {
    return 0;
  }
  return Math.floor(candidate);
}

function createIncrementEventViewCountHandler({
  db,
  HttpsError,
  now = Date.now,
  logger = console,
}) {
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
    throw new TypeError("Firestore transaction support is required");
  }
  if (typeof HttpsError !== "function") {
    throw new TypeError("HttpsError is required");
  }
  if (typeof now !== "function") {
    throw new TypeError("now is required");
  }

  return async function incrementEventViewCountHandler(request) {
    const uid = typeof request?.auth?.uid === "string" ? request.auth.uid.trim() : "";
    if (!uid) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    const eventId = sanitizeEventKey(request?.data?.eventId, "eventId", HttpsError);
    const docId = sanitizeEventKey(request?.data?.docId, "docId", HttpsError);
    const currentDate = new Date(now());
    const dayKey = getTaipeiDayKey(currentDate);
    const markerId = buildViewMarkerId(uid, eventId, dayKey);
    const eventRef = db.collection("events").doc(docId);
    const markerRef = db.collection(MARKER_COLLECTION).doc(markerId);

    try {
      return await db.runTransaction(async transaction => {
        const eventSnapshot = await transaction.get(eventRef);
        const markerSnapshot = await transaction.get(markerRef);

        if (!eventSnapshot?.exists) {
          throw new HttpsError("not-found", "Event not found");
        }

        const eventData = eventSnapshot.data() || {};
        const logicalEventId = typeof eventData.id === "string" ? eventData.id.trim() : "";
        if (logicalEventId !== eventId) {
          throw new HttpsError("failed-precondition", "Event identity mismatch");
        }

        const currentViewCount = normalizeLegacyViewCount(eventData.viewCount);
        if (markerSnapshot?.exists) {
          return { incremented: false, viewCount: currentViewCount };
        }

        const nextViewCount = currentViewCount + 1;
        transaction.create(markerRef, {
          eventId,
          eventDocId: docId,
          dayKey,
          createdAt: currentDate,
        });
        transaction.update(eventRef, { viewCount: nextViewCount });
        return { incremented: true, viewCount: nextViewCount };
      });
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      if (logger && typeof logger.error === "function") {
        logger.error("[incrementEventViewCount] transaction failed", {
          eventKey: crypto.createHash("sha256").update(`${eventId}\u0000${docId}`).digest("hex").slice(0, 16),
          errorCode: typeof error?.code === "string" ? error.code : "unknown",
        });
      }
      throw new HttpsError("unavailable", "EVENT_VIEW_COUNT_UNAVAILABLE");
    }
  };
}

function createIncrementEventViewCountCallable({ onCall, ...dependencies }) {
  if (typeof onCall !== "function") {
    throw new TypeError("onCall is required");
  }
  return onCall(
    { region: "asia-east1" },
    createIncrementEventViewCountHandler(dependencies),
  );
}

module.exports = {
  MARKER_COLLECTION,
  buildViewMarkerId,
  createIncrementEventViewCountCallable,
  createIncrementEventViewCountHandler,
  getTaipeiDayKey,
  normalizeLegacyViewCount,
};
