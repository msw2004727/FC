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

// 可直接用 FieldValue.increment 的舊值：欄位不存在，或已是非負安全整數。
// 其餘（數字字串、負數、小數、null 等舊資料）increment 的結果會和 normalizeLegacyViewCount 不同，
// 改走原本的交易路徑，維持計數語意完全一致。
function isIncrementSafeViewCount(value) {
  return typeof value === "undefined" || (Number.isSafeInteger(value) && value >= 0);
}

function isAlreadyExistsError(error) {
  return error?.code === 6 || error?.code === "already-exists";
}

function isNotFoundError(error) {
  return error?.code === 5 || error?.code === "not-found";
}

function createIncrementEventViewCountHandler({
  db,
  HttpsError,
  FieldValue,
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
  // getAll／batch／FieldValue 改在呼叫時檢查（O3 回歸修正）：index.js 載入時就建立 handler，
  // 若在這裡 throw，缺少時會讓整份 Functions 模組載入失敗、所有函式一起掛；缺少時只讓本函式回 internal。
  function hasBatchSupport() {
    return typeof db.getAll === "function" && typeof db.batch === "function"
      && Boolean(FieldValue) && typeof FieldValue.increment === "function";
  }

  function assertEventIdentity(eventSnapshot, eventId) {
    if (!eventSnapshot?.exists) {
      throw new HttpsError("not-found", "Event not found");
    }
    const eventData = eventSnapshot.data() || {};
    const logicalEventId = typeof eventData.id === "string" ? eventData.id.trim() : "";
    if (logicalEventId !== eventId) {
      throw new HttpsError("failed-precondition", "Event identity mismatch");
    }
    return eventData;
  }

  // 舊交易路徑：只給非整數舊值使用（與 86450431b 版逐行同邏輯）。
  function runLegacyTransaction({ eventRef, markerRef, eventId, docId, dayKey, currentDate }) {
    return db.runTransaction(async transaction => {
      const eventSnapshot = await transaction.get(eventRef);
      const markerSnapshot = await transaction.get(markerRef);
      const eventData = assertEventIdentity(eventSnapshot, eventId);

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
  }

  return async function incrementEventViewCountHandler(request) {
    const uid = typeof request?.auth?.uid === "string" ? request.auth.uid.trim() : "";
    if (!uid) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    const eventId = sanitizeEventKey(request?.data?.eventId, "eventId", HttpsError);
    const docId = sanitizeEventKey(request?.data?.docId, "docId", HttpsError);
    if (!hasBatchSupport()) {
      if (logger && typeof logger.error === "function") {
        logger.error("[incrementEventViewCount] missing dependency", {
          hasGetAll: typeof db.getAll === "function",
          hasBatch: typeof db.batch === "function",
          hasIncrement: typeof FieldValue?.increment === "function",
        });
      }
      throw new HttpsError("internal", "EVENT_VIEW_COUNT_MISCONFIGURED");
    }
    const currentDate = new Date(now());
    const dayKey = getTaipeiDayKey(currentDate);
    const markerId = buildViewMarkerId(uid, eventId, dayKey);
    const eventRef = db.collection("events").doc(docId);
    const markerRef = db.collection(MARKER_COLLECTION).doc(markerId);
    let stage = "read";

    try {
      // O3（2026-11-12）：原本每次開詳情都對活動主文件開交易（含當天已計過只回舊值），
      // 交易持鎖期間含 asia-east1↔nam5 往返，與報名交易搶同一份主文件鎖。
      // 改為：交易外一次 getAll 讀活動與去重標記（不持鎖）；已計過直接回；
      // 未計過才用 batch 原子寫入「create 標記＋increment(1)」——batch 不是交易、不持讀鎖，
      // 標記與加一同成同敗，不會出現「標記已建但沒加到」。非整數舊值仍走舊交易路徑。
      const [eventSnapshot, markerSnapshot] = await db.getAll(eventRef, markerRef);
      const eventData = assertEventIdentity(eventSnapshot, eventId);
      const currentViewCount = normalizeLegacyViewCount(eventData.viewCount);
      if (markerSnapshot?.exists) {
        return { incremented: false, viewCount: currentViewCount };
      }

      if (!isIncrementSafeViewCount(eventData.viewCount)) {
        stage = "transaction";
        return await runLegacyTransaction({ eventRef, markerRef, eventId, docId, dayKey, currentDate });
      }

      stage = "batch";
      const batch = db.batch();
      batch.create(markerRef, {
        eventId,
        eventDocId: docId,
        dayKey,
        createdAt: currentDate,
      });
      batch.update(eventRef, { viewCount: FieldValue.increment(1) });
      try {
        await batch.commit();
      } catch (error) {
        // 同一觀看者同一天併發：標記 create 撞「已存在」，整批（含加一）未生效，另一請求已計入。
        if (isAlreadyExistsError(error)) {
          return { incremented: false, viewCount: currentViewCount + 1 };
        }
        // 讀完之後活動被刪：update 撞「不存在」，整批未生效，標記也沒建。
        if (isNotFoundError(error)) {
          throw new HttpsError("not-found", "Event not found");
        }
        throw error;
      }
      // 回傳值是「讀到的值＋1」：併發時可能比實際略低，前端以 Math.max 合併，最終計數以文件為準。
      return { incremented: true, viewCount: currentViewCount + 1 };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      if (logger && typeof logger.error === "function") {
        logger.error("[incrementEventViewCount] transaction failed", {
          eventKey: crypto.createHash("sha256").update(`${eventId}\u0000${docId}`).digest("hex").slice(0, 16),
          errorCode: typeof error?.code === "string" ? error.code : "unknown",
          stage,
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
  isIncrementSafeViewCount,
  buildViewMarkerId,
  createIncrementEventViewCountCallable,
  createIncrementEventViewCountHandler,
  getTaipeiDayKey,
  normalizeLegacyViewCount,
};
