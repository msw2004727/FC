"use strict";

/**
 * T-087a 報名檢查強化：registerForEvent／cancelRegistration 共用的純函式與錯誤邊界。
 * - 去重（方案②）：交易第一個讀取讀 _regDedupe，成功時同交易 create；鍵含函式名與呼叫者 UID。
 *   取代原本交易外 create（交易失敗時去重文件仍在，重送會回假成功；鍵只用 requestId 可被他人先佔）。
 * - 黑名單：照 A js/modules/event/event-blocklist.js#_isEventVisibleToUser 四態，只擋 operator（R-EVT-011／013／014）。
 * - minAge：照 A event-detail-signup.js#_getEventAgeSignupState，只檢查本人；基準日一律以台北時區取年月日。
 * - 取消時限：照 A event-detail-signup.js#handleCancelSignup 的狀態與開始時間檢查，只套 user_cancel。
 * 錯誤形狀：message＝A 前端原文中文、details＝代碼字串（A／B 皆先讀 details 字串）。
 */

const DEDUPE_COLLECTION = "_regDedupe";
const DEDUPE_SCHEMA = "registration_dedupe_v2";
const DEDUPE_TTL_MS = 10 * 60 * 1000;
const REQUEST_ID_MAX_LENGTH = 100;
const DEDUPE_FUNCTIONS = new Set(["register", "cancel"]);
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

const REGISTRATION_GUARD_MESSAGES = Object.freeze({
  EVENT_UNAVAILABLE: "此活動目前無法報名",
  BIRTHDAY_REQUIRED: "請先補齊生日資料後再報名",
  REQUEST_ID_CONFLICT: "請重新整理後再試",
  CANCEL_EVENT_ENDED: "活動已開始，無法再取消報名",
  CANCEL_EVENT_STARTED: "活動已於開始時間結束，無法取消報名",
  PARTICIPANT_NOT_ALLOWED: "無權限執行此操作",
  INTERNAL: "INTERNAL",
});

function ageRestrictedMessage(minAge) {
  return `此活動限 ${minAge} 歲以上報名`;
}

// ── 去重 ──

// 回傳可用的去重文件 id；requestId 缺、非字串、不是合法文件 id 時回空字串（不建去重文件，只靠交易內狀態檢查）。
function buildRegistrationDedupeDocId(fn, callerUid, requestId) {
  if (!DEDUPE_FUNCTIONS.has(fn)) return "";
  if (typeof callerUid !== "string" || !callerUid || callerUid.includes("/")) return "";
  if (typeof requestId !== "string") return "";
  const safeRequestId = requestId.slice(0, REQUEST_ID_MAX_LENGTH);
  if (!safeRequestId || safeRequestId === "." || safeRequestId === ".." || safeRequestId.includes("/")) return "";
  return `${fn}_${callerUid}_${safeRequestId}`;
}

function buildRegistrationDedupeRef(db, fn, callerUid, requestId) {
  const docId = buildRegistrationDedupeDocId(fn, callerUid, requestId);
  return docId ? db.collection(DEDUPE_COLLECTION).doc(docId) : null;
}

/**
 * 交易內讀到的去重文件 → 決策。
 * - miss：沒有文件，照常執行，成功時同交易 create。
 * - hit：同函式、同呼叫者、同活動的既有結果，直接回存的結果、不寫任何東西。
 * - conflict：同呼叫者同 requestId 卻換了活動 → REQUEST_ID_CONFLICT。
 * - foreign：文件不是本機制寫的（例如 adjustTeamReservation／roster claim 仍以原始 requestId 當鍵，
 *   任何登入者都能先佔同名文件）→ 不信任、不覆寫，照常執行但不建去重文件（只靠交易內狀態檢查）。
 */
function decideRegistrationDedupe(snap, { fn, callerUid, eventId }) {
  if (!snap || !snap.exists) return { status: "miss" };
  const data = (typeof snap.data === "function" ? snap.data() : null) || {};
  if (data.schema !== DEDUPE_SCHEMA || data.fn !== fn || data.callerUid !== callerUid) {
    return { status: "foreign" };
  }
  if (data.eventId !== eventId) return { status: "conflict" };
  const result = data.result && typeof data.result === "object" ? data.result : {};
  return { status: "hit", result };
}

function buildRegistrationDedupeDoc({ fn, callerUid, eventId, result, nowMs, FieldValue, Timestamp }) {
  return {
    schema: DEDUPE_SCHEMA,
    fn,
    callerUid,
    eventId,
    result,
    createdAt: FieldValue.serverTimestamp(),
    // expiresAt 供 Firestore TTL Policy 自動清理（設定 TTL 於 _regDedupe 集合的 expiresAt 欄位）
    expiresAt: Timestamp.fromDate(new Date(nowMs + DEDUPE_TTL_MS)),
  };
}

// 去重文件專用：把陣列與純物件裡的 undefined 遞迴換成 null。
// 專案未設 ignoreUndefinedProperties，舊格式報名缺 id、候補缺 userName 時 transaction.create 會丟錯、整個交易回滾。
// 取代原本直接存報名原始欄位（T-087 審查 P1）。Timestamp、Date 等非純物件原樣保留。
function toFirestoreSafe(value) {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(toFirestoreSafe);
  if (value && typeof value === "object") {
    // 純物件＝原型是 null 或 Object.prototype（以「原型的原型是 null」判斷，跨 realm 也成立）
    const proto = Object.getPrototypeOf(value);
    if (proto !== null && Object.getPrototypeOf(proto) !== null) return value;
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = toFirestoreSafe(item);
    return out;
  }
  return value;
}

// 只存精簡結果，不存活動名單投影（event）；每個元素都經 toFirestoreSafe（缺欄位存 null）。
function pickRegisterDedupeResult(txResult = {}) {
  return {
    registrations: Array.isArray(txResult.registrations) ? txResult.registrations.map(toFirestoreSafe) : [],
    confirmed: Number(txResult.confirmed || 0) || 0,
    waitlisted: Number(txResult.waitlisted || 0) || 0,
    earlyBirdCharged: txResult.earlyBirdCharged === true,
    earlyBirdCost: Number(txResult.earlyBirdCost || 0) || 0,
  };
}

function pickCancelDedupeResult(txResult = {}) {
  return {
    cancelled: Array.isArray(txResult.cancelled) ? txResult.cancelled.map(toFirestoreSafe) : [],
    alreadyCancelled: Array.isArray(txResult.alreadyCancelled) ? txResult.alreadyCancelled.map(toFirestoreSafe) : [],
    promoted: Array.isArray(txResult.promoted) ? txResult.promoted.map(toFirestoreSafe) : [],
  };
}

// ── 參與者身分（Q3）──

// 所有參與者都必須是呼叫者本人（userId === callerUid），第 2 位起必須帶 companionId。
// A event-detail-companion.js 與 B signup.ts 都固定送 operator 的 UID，第 2 位起一定有 companionId。
function areParticipantsOwnedByCaller(participants, callerUid) {
  if (!Array.isArray(participants) || typeof callerUid !== "string" || !callerUid) return false;
  return participants.every((p, idx) => {
    if (!p || typeof p !== "object") return false;
    if (p.userId !== callerUid) return false;
    if (idx === 0) return true;
    return typeof p.companionId === "string" && p.companionId.trim() !== "";
  });
}

// ── 黑名單（R-EVT-011 四態，只擋 operator）──

// 同 A js/api-service.js#_isRegistrationOwnedByUser：userId、uid 或 courseOwnerUids 含本人。
function isRegistrationOwnedByUid(registration, uid) {
  const targetUid = String(uid || "").trim();
  if (!registration || !targetUid) return false;
  if (String(registration.userId || "").trim() === targetUid
    || String(registration.uid || "").trim() === targetUid) return true;
  return Array.isArray(registration.courseOwnerUids)
    && registration.courseOwnerUids.some((item) => String(item || "").trim() === targetUid);
}

// 被擋（blockedUids 含呼叫者）且全名單中沒有任何一筆屬於呼叫者（任何狀態，含 cancelled／removed）→ true。
function isEventBlockedForCaller(eventData, callerUid, allRegistrations) {
  if (!callerUid) return false;
  const blocked = Array.isArray(eventData?.blockedUids) ? eventData.blockedUids : [];
  if (!blocked.includes(callerUid)) return false;
  const regs = Array.isArray(allRegistrations) ? allRegistrations : [];
  return !regs.some((reg) => isRegistrationOwnedByUid(reg, callerUid));
}

// ── minAge（只檢查本人）──

// 同 A _parseEventSignupBirthday：YYYY[-/]M[-/]D 開頭且為合法日期；回傳年月日（不帶時區）。
function parseBirthdayParts(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || !month || !day || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

// 不用 instanceof Date：跨 realm（vm／測試沙箱）建立的 Date 也要認得。
function isValidDate(value) {
  return Object.prototype.toString.call(value) === "[object Date]" && !Number.isNaN(value.getTime());
}

function toTaipeiDateParts(date) {
  const shifted = new Date(date.getTime() + TAIPEI_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

// 同 A _calculateEventSignupAge：未過生日減 1；0～129 以外視為不合法。
function calculateAgeOnDate(birthParts, refParts) {
  if (!birthParts || !refParts) return null;
  let age = refParts.year - birthParts.year;
  if (refParts.month < birthParts.month
    || (refParts.month === birthParts.month && refParts.day < birthParts.day)) {
    age -= 1;
  }
  return age >= 0 && age < 130 ? age : null;
}

/**
 * 回傳 null 表示通過；否則回 { code, message }。
 * eventStart：parseEventStartDateInTaipei(ed.date) 的結果（解析失敗為 null，改用 now）。
 * userData：交易外已讀的呼叫者 users 文件資料；找不到文件時為 null（A 無使用者也不能報名）。
 */
function evaluateMinAgeRestriction({ minAge, userData, eventStart, now }) {
  const normalizedMinAge = Math.floor(Number(minAge || 0));
  if (!Number.isFinite(normalizedMinAge) || normalizedMinAge <= 0) return null;
  const birthParts = userData ? parseBirthdayParts(userData.birthday) : null;
  const referenceDate = isValidDate(eventStart) ? eventStart : now;
  const age = calculateAgeOnDate(birthParts, toTaipeiDateParts(referenceDate));
  if (age == null) {
    return { code: "BIRTHDAY_REQUIRED", message: REGISTRATION_GUARD_MESSAGES.BIRTHDAY_REQUIRED };
  }
  if (age < normalizedMinAge) {
    return { code: "AGE_RESTRICTED", message: ageRestrictedMessage(normalizedMinAge) };
  }
  return null;
}

// ── 取消時限（只套 user_cancel，且本次確實有要取消的報名）──

function evaluateUserCancelDeadline({ eventData, eventStart, now }) {
  const status = eventData?.status;
  if (status === "ended" || status === "cancelled") {
    return { code: "EVENT_ENDED", message: REGISTRATION_GUARD_MESSAGES.CANCEL_EVENT_ENDED };
  }
  if (isValidDate(eventStart) && eventStart.getTime() <= now.getTime()) {
    return { code: "EVENT_STARTED", message: REGISTRATION_GUARD_MESSAGES.CANCEL_EVENT_STARTED };
  }
  return null;
}

// ── 錯誤邊界（R-CF-002）──

const SAFE_REASON_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

function safeReasonOf(error) {
  const details = error?.details;
  if (typeof details === "string" && SAFE_REASON_RE.test(details)) return details;
  const detailCode = details && typeof details === "object" ? details.code : "";
  if (typeof detailCode === "string" && SAFE_REASON_RE.test(detailCode)) return detailCode;
  const message = error?.message;
  return typeof message === "string" && SAFE_REASON_RE.test(message) ? message : "";
}

/**
 * 包住整個 Callable handler：HttpsError 原樣重拋（已是給前端的固定訊息）；
 * 其他錯誤（含交易重試用盡的 ABORTED）一律回 internal／INTERNAL（與 SDK 對未知錯誤的回應相同），
 * 結構化 log 只留函式名、錯誤代碼與固定原因碼，不記 UID、requestId 原文或底層錯誤訊息。
 * 交易內不轉換錯誤，SDK 對 ABORTED 的重試不受影響（R-CF-004）。
 */
function withRegistrationErrorBoundary({ fn, HttpsError, logger = console }, handler) {
  return async function registrationErrorBoundary(request) {
    try {
      return await handler(request);
    } catch (error) {
      if (error instanceof HttpsError) {
        logger.info("[registrationCallable] rejected", {
          function: fn,
          code: String(error.code || ""),
          reason: safeReasonOf(error),
        });
        throw error;
      }
      const rawCode = error?.code;
      // T-087 審查 P2-2：原本只記 errorType，無法分辨哪支、哪類 Firestore 錯誤；
      // 加固定 stage、gRPC 狀態名與固定分類（undefined 欄位另記遮罩後的欄位路徑），仍不記原始訊息。
      logger.error("[registrationCallable] failed", {
        function: fn,
        stage: STAGE_BY_FUNCTION[fn] || "unknown",
        code: typeof rawCode === "number" || (typeof rawCode === "string" && rawCode.length <= 40)
          ? String(rawCode)
          : "unknown",
        firestoreCode: firestoreCodeOf(rawCode),
        errorType: sanitizeErrorType(error),
        ...classifyErrorMessage(error?.message),
      });
      throw new HttpsError("internal", REGISTRATION_GUARD_MESSAGES.INTERNAL);
    }
  };
}

const STAGE_BY_FUNCTION = Object.freeze({ registerForEvent: "register", cancelRegistration: "cancel" });

const GRPC_STATUS_NAMES = Object.freeze([
  "OK", "CANCELLED", "UNKNOWN", "INVALID_ARGUMENT", "DEADLINE_EXCEEDED", "NOT_FOUND", "ALREADY_EXISTS",
  "PERMISSION_DENIED", "RESOURCE_EXHAUSTED", "FAILED_PRECONDITION", "ABORTED", "OUT_OF_RANGE",
  "UNIMPLEMENTED", "INTERNAL", "UNAVAILABLE", "DATA_LOSS", "UNAUTHENTICATED",
]);

// 數字 gRPC 狀態（Firestore Admin SDK）→ 名稱；字串代碼只收固定形狀；其他一律 "none"。
function firestoreCodeOf(rawCode) {
  if (Number.isInteger(rawCode) && rawCode >= 0 && rawCode < GRPC_STATUS_NAMES.length) return GRPC_STATUS_NAMES[rawCode];
  if (typeof rawCode === "string" && /^[A-Za-z][A-Za-z_-]{1,39}$/.test(rawCode)) {
    return rawCode.replace(/-/g, "_").toUpperCase();
  }
  return "none";
}

// 不記原始訊息（可能含文件路徑、UID、requestId、teamId），只回固定分類；
// undefined 欄位錯誤另回欄位路徑，每段只保留純小寫開頭英文欄位名或陣列索引，其餘換成 <key>。
function classifyErrorMessage(message) {
  const text = typeof message === "string" ? message : "";
  if (/Cannot use "undefined" as a Firestore value/.test(text)) {
    const match = text.match(/found in field "?([^"\s)]{1,200})"?\)?/);
    const field = match
      ? match[1].split(".").slice(0, 8).map((seg) => {
        const clean = seg.replace(/`/g, "");
        return /^[a-z][A-Za-z]{0,39}$/.test(clean) || /^\d{1,4}$/.test(clean) ? clean : "<key>";
      }).join(".")
      : "";
    return { hint: "UNDEFINED_VALUE", field };
  }
  if (/is not a valid Firestore document|Value for argument/.test(text)) return { hint: "INVALID_DATA" };
  if (/reads? must|after (a )?write/i.test(text)) return { hint: "READ_AFTER_WRITE" };
  return { hint: "OTHER" };
}

function sanitizeErrorType(error) {
  const name = error?.constructor?.name || typeof error;
  return /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name) ? name : "unknown";
}

module.exports = {
  DEDUPE_COLLECTION,
  DEDUPE_SCHEMA,
  DEDUPE_TTL_MS,
  REGISTRATION_GUARD_MESSAGES,
  ageRestrictedMessage,
  areParticipantsOwnedByCaller,
  buildRegistrationDedupeDoc,
  buildRegistrationDedupeDocId,
  buildRegistrationDedupeRef,
  calculateAgeOnDate,
  decideRegistrationDedupe,
  evaluateMinAgeRestriction,
  evaluateUserCancelDeadline,
  isEventBlockedForCaller,
  isRegistrationOwnedByUid,
  parseBirthdayParts,
  pickCancelDedupeResult,
  pickRegisterDedupeResult,
  toTaipeiDateParts,
  withRegistrationErrorBoundary,
};
