"use strict";

/**
 * 聯繫站長 Callable。訊息寫入 contactMessages。
 * 個人頻率與全站每日上限只在 contactMessageLimits 交易內讀寫。
 * 全站每日文件 id 為 daily-YYYYMMDD（台北日），不用 __x__ 這類保留 id。
 * LINE 通知直接寫 linePushQueue，不呼叫 enforceDailyLimits（一般層 targetPerDay 會擋站長收件）。
 * 只推給 lineNotify.bound === true 的 super_admin；不看全站 system 總開關與個人通知開關。
 * 仍寫入 pool，processLinePushQueue 的全域發送上限照舊生效。
 * category 用既有 system。source contact_owner 符合格式；未知 source 只記 warn、不擋，故不改白名單。
 */

const { selectEnqueuePool } = require("./notification-pool");
const { NOTIFICATION_GUARD_LIMITS } = require("./notification-guard-limits");
const { relationMode } = require("./notification-relation-enforcement");
const { maskUid, stripControlChars, taipeiDayKey } = require("./notification-fields");

const CONTACT_NAME_MAX = 30;
const CONTACT_METHOD_MAX = 80;
const CONTACT_CONTENT_MAX = 1000;
const CONTACT_BODY_MAX = 300;
const CONTACT_MAX_PER_WINDOW = 5;
const CONTACT_WINDOW_MS = 24 * 60 * 60 * 1000;
const CONTACT_MIN_GAP_MS = 60 * 1000;
const CONTACT_NOTIFY_LIMIT = 5;
const CONTACT_ADMIN_QUERY_LIMIT = 20;
const CONTACT_USER_NAME_MAX = 80;
const CONTACT_DAILY_STORE_LIMIT = 300;
const CONTACT_DAILY_PUSH_LIMIT = 20;
const CONTACT_CATEGORY = "system";
const CONTACT_SOURCE = "contact_owner";
const CONTACT_TITLE = "聯繫站長";
const CONTACT_PUSH_CAP_NOTICE = "今日聯繫訊息已達推播上限，請到後台查看";
const CONTACT_BREAKS_RE = /[\n\r\t]/;

function codePointLength(text) {
  return Array.from(text).length;
}

function requireContactText(value, max, code, HttpsError, rejectBreaks) {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", code, { code });
  }
  // Array.from 前先擋過長字串，避免超長輸入被逐碼展開。
  if (value.length > max * 2) {
    throw new HttpsError("invalid-argument", code, { code });
  }
  if (rejectBreaks && CONTACT_BREAKS_RE.test(value)) {
    throw new HttpsError("invalid-argument", code, { code });
  }
  const trimmed = stripControlChars(value).trim();
  const length = codePointLength(trimmed);
  if (length < 1 || length > max) {
    throw new HttpsError("invalid-argument", code, { code });
  }
  return trimmed;
}

function normalizeContactSource(value) {
  return value === "fcb" || value === "a" ? value : "fcb";
}

function displayNameFromUserData(data) {
  const raw = data?.displayName || data?.name || data?.lineDisplayName || "";
  if (typeof raw !== "string") return "";
  const trimmed = stripControlChars(raw).trim();
  if (!trimmed) return "";
  return Array.from(trimmed).slice(0, CONTACT_USER_NAME_MAX).join("");
}

function truncateNotifyContent(content) {
  const chars = Array.from(stripControlChars(content));
  if (chars.length <= CONTACT_BODY_MAX) return chars.join("");
  return `${chars.slice(0, CONTACT_BODY_MAX).join("")}…`;
}

function buildContactNotifyBody(name, contact, content) {
  return [
    `稱呼：${stripControlChars(name)}`,
    `聯絡方式：${stripControlChars(contact)}`,
    `內容：${truncateNotifyContent(content)}`,
  ].join("\n");
}

function nonNegativeInt(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.floor(number);
}

function recentSentAt(sentAtMs, nowMs) {
  if (!Array.isArray(sentAtMs)) return [];
  return sentAtMs
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && nowMs - value < CONTACT_WINDOW_MS)
    .sort((left, right) => left - right);
}

function mergeStamp(recent, stamp) {
  const next = recent.includes(stamp) ? recent.slice() : recent.concat(stamp);
  next.sort((left, right) => left - right);
  return next;
}

// 未來時間戳留在視窗內。effectiveNow 同時用來比 60 秒間隔與成功時寫入的時間；間隔為負代表這次時鐘比最後一筆早，視為太快。
// 被拒一律不寫入（Opus 複審 P3-1：取代原「被拒也留下較早時間戳」，連點被拒會白吃額度、最壞鎖 24 小時；成功時的 recent 本就保留未來時間戳）。
function evaluateUserRate(stored, nowMs) {
  const recent = recentSentAt(stored, nowMs);
  const last = recent.length ? recent[recent.length - 1] : null;
  const effectiveNow = last === null ? nowMs : Math.max(nowMs, last);
  const tooSoon = last !== null && effectiveNow - last < CONTACT_MIN_GAP_MS;
  const tooMany = recent.length >= CONTACT_MAX_PER_WINDOW;
  if (tooMany || tooSoon) return { reject: true, sentAtMs: null };
  return { reject: false, sentAtMs: mergeStamp(recent, effectiveNow) };
}

function evaluateDaily(data) {
  const storedCount = nonNegativeInt(data?.storedCount);
  if (storedCount >= CONTACT_DAILY_STORE_LIMIT) {
    return { reject: true };
  }
  const nextStored = storedCount + 1;
  const capNoticeSent = data?.capNoticeSent === true;
  let push = "none";
  if (nextStored <= CONTACT_DAILY_PUSH_LIMIT) {
    push = "message";
  } else if (nextStored === CONTACT_DAILY_PUSH_LIMIT + 1 && !capNoticeSent) {
    push = "notice";
  }
  return {
    reject: false,
    push,
    storedCount: nextStored,
    capNoticeSent: capNoticeSent || push === "notice",
  };
}

function dailyLimitDocId(nowMs) {
  return `daily-${taipeiDayKey(nowMs)}`;
}

function assertHandlerDeps(deps) {
  const required = [
    "db",
    "HttpsError",
    "FieldValue",
    "getCallerRoleWithFallback",
    "findUserDocByUidOrLineUserId",
    "getLineRecipientUidFromUserDoc",
    "isStaffRole",
  ];
  required.forEach((key) => {
    if (deps[key] == null) throw new TypeError(`${key} is required`);
  });
  if (typeof deps.db.collection !== "function" || typeof deps.db.runTransaction !== "function") {
    throw new TypeError("Firestore transaction support is required");
  }
  if (typeof deps.HttpsError !== "function") throw new TypeError("HttpsError is required");
  if (typeof deps.FieldValue.serverTimestamp !== "function") {
    throw new TypeError("FieldValue.serverTimestamp is required");
  }
  if (typeof deps.now !== "function") throw new TypeError("now is required");
}

function userDataOf(userDoc) {
  return typeof userDoc.data === "function" ? (userDoc.data() || {}) : {};
}

// 讀法對齊 index.js resolveLineNotificationRecipient 的 lineNotify。
// 只認 bound === true。不套用全站 system 總開關，也不看個人通知設定：
// 站長要收到聯繫訊息，不能因關掉 system 或個人開關而漏信。
function isBoundContactOwner(data) {
  const lineNotify = (data && typeof data.lineNotify === "object" && data.lineNotify)
    ? data.lineNotify
    : {};
  return lineNotify.bound === true;
}

async function enqueueContactOwnerPushes({
  db,
  FieldValue,
  name,
  contact,
  content,
  noticeOnly,
  requestedByUid,
  requestedByRole,
  isStaffRole,
  getLineRecipientUidFromUserDoc,
  logger,
}) {
  const snap = await db.collection("users")
    .where("role", "==", "super_admin")
    .limit(CONTACT_ADMIN_QUERY_LIMIT)
    .get();
  const docs = (Array.isArray(snap?.docs) ? snap.docs : [])
    .filter((userDoc) => isBoundContactOwner(userDataOf(userDoc)))
    .slice(0, CONTACT_NOTIFY_LIMIT);
  if (!docs.length) {
    logger.warn("[submitContactMessage] no super_admin recipient", { uid: maskUid(requestedByUid) });
    return { queued: 0, failed: 0 };
  }

  const pool = selectEnqueuePool({
    staff: isStaffRole(requestedByRole) === true,
    relationId: null,
    limits: NOTIFICATION_GUARD_LIMITS,
    mode: relationMode("R1"),
  });
  const body = noticeOnly
    ? CONTACT_PUSH_CAP_NOTICE
    : buildContactNotifyBody(name, contact, content);
  const results = await Promise.allSettled(docs.map(async (userDoc) => {
    const data = userDataOf(userDoc);
    const found = { docId: userDoc.id, data };
    const targetUid = getLineRecipientUidFromUserDoc(found, userDoc.id);
    await db.collection("linePushQueue").add({
      uid: targetUid,
      targetDocId: found.docId,
      title: CONTACT_TITLE,
      body,
      category: CONTACT_CATEGORY,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
      source: CONTACT_SOURCE,
      requestedByUid,
      requestedByRole,
      pool,
    });
  }));

  let failed = 0;
  results.forEach((result, index) => {
    if (result.status === "fulfilled") return;
    failed += 1;
    const userDoc = docs[index];
    const data = userDataOf(userDoc);
    logger.warn("[submitContactMessage] line push enqueue failed", {
      uid: maskUid(requestedByUid),
      targetUid: maskUid(getLineRecipientUidFromUserDoc({ docId: userDoc.id, data }, userDoc.id)),
      code: result.reason?.code ?? null,
    });
  });
  return { queued: results.length - failed, failed };
}

function createSubmitContactMessageHandler({
  db,
  HttpsError,
  FieldValue,
  getCallerRoleWithFallback,
  findUserDocByUidOrLineUserId,
  getLineRecipientUidFromUserDoc,
  isStaffRole,
  now = () => Date.now(),
  logger = console,
}) {
  assertHandlerDeps({
    db,
    HttpsError,
    FieldValue,
    getCallerRoleWithFallback,
    findUserDocByUidOrLineUserId,
    getLineRecipientUidFromUserDoc,
    isStaffRole,
    now,
  });

  return async function submitContactMessageHandler(request) {
    const rawUid = request?.auth?.uid;
    const uid = typeof rawUid === "string" ? rawUid.trim() : "";
    if (!uid) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    // 在第一個 await 前取得，讓同一輪併發呼叫各自帶著呼叫當下的時鐘進入交易。
    const nowMs = Number(now());
    const data = request?.data && typeof request.data === "object" ? request.data : {};
    const name = requireContactText(data.name, CONTACT_NAME_MAX, "INVALID_NAME", HttpsError, true);
    const contact = requireContactText(data.contact, CONTACT_METHOD_MAX, "INVALID_CONTACT", HttpsError, true);
    const content = requireContactText(data.content, CONTACT_CONTENT_MAX, "INVALID_CONTENT", HttpsError, false);
    const source = normalizeContactSource(data.source);
    if (!Number.isFinite(nowMs)) {
      logger.error("[submitContactMessage] clock failed", { uid: maskUid(uid) });
      throw new HttpsError("internal", "CONTACT_SUBMIT_FAILED", { code: "CONTACT_SUBMIT_FAILED" });
    }

    let callerRole = "user";
    try {
      const resolved = await getCallerRoleWithFallback(request);
      if (typeof resolved === "string" && resolved.trim()) callerRole = resolved.trim();
    } catch (err) {
      logger.error("[submitContactMessage] role lookup failed", {
        uid: maskUid(uid),
        code: err?.code ?? null,
      });
      throw new HttpsError("internal", "CONTACT_SUBMIT_FAILED", { code: "CONTACT_SUBMIT_FAILED" });
    }

    let userName = "";
    try {
      const found = await findUserDocByUidOrLineUserId(uid);
      userName = displayNameFromUserData(found?.data);
    } catch (err) {
      logger.warn("[submitContactMessage] user lookup failed", {
        uid: maskUid(uid),
        code: err?.code ?? null,
      });
    }

    const messageRef = db.collection("contactMessages").doc();
    const limitRef = db.collection("contactMessageLimits").doc(uid);
    const dailyRef = db.collection("contactMessageLimits").doc(dailyLimitDocId(nowMs));

    let outcome;
    try {
      outcome = await db.runTransaction(async (tx) => {
        const limitSnap = await tx.get(limitRef);
        const dailySnap = await tx.get(dailyRef);
        const stored = limitSnap.exists ? limitSnap.data()?.sentAtMs : [];
        const rate = evaluateUserRate(stored, nowMs);
        if (rate.reject) return { reject: "rate" };

        const daily = evaluateDaily(dailySnap.exists ? dailySnap.data() : null);
        if (daily.reject) return { reject: "daily" };

        tx.set(messageRef, {
          uid,
          name,
          contact,
          content,
          userName,
          createdAt: FieldValue.serverTimestamp(),
          status: "new",
          source,
        });
        tx.set(limitRef, {
          uid,
          sentAtMs: rate.sentAtMs,
          updatedAt: FieldValue.serverTimestamp(),
        });
        tx.set(dailyRef, {
          storedCount: daily.storedCount,
          capNoticeSent: daily.capNoticeSent,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { reject: null, push: daily.push };
      });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      logger.error("[submitContactMessage] transaction failed", {
        uid: maskUid(uid),
        code: err?.code ?? null,
      });
      throw new HttpsError("internal", "CONTACT_SUBMIT_FAILED", { code: "CONTACT_SUBMIT_FAILED" });
    }

    if (outcome.reject === "rate") {
      throw new HttpsError("resource-exhausted", "CONTACT_RATE_LIMITED", { code: "CONTACT_RATE_LIMITED" });
    }
    if (outcome.reject === "daily") {
      throw new HttpsError("resource-exhausted", "CONTACT_DAILY_LIMIT", { code: "CONTACT_DAILY_LIMIT" });
    }

    let notifyResult = { queued: 0, failed: 0 };
    if (outcome.push === "message" || outcome.push === "notice") {
      try {
        notifyResult = await enqueueContactOwnerPushes({
          db,
          FieldValue,
          name,
          contact,
          content,
          noticeOnly: outcome.push === "notice",
          requestedByUid: uid,
          requestedByRole: callerRole,
          isStaffRole,
          getLineRecipientUidFromUserDoc,
          logger,
        });
      } catch (err) {
        logger.warn("[submitContactMessage] notify failed", {
          uid: maskUid(uid),
          code: err?.code ?? null,
        });
      }
    }

    logger.log("[submitContactMessage] stored", {
      id: messageRef.id,
      uid: maskUid(uid),
      source,
      notified: notifyResult.queued,
      notifyFailed: notifyResult.failed,
    });
    return { ok: true, id: messageRef.id };
  };
}

function createSubmitContactMessageCallable({ onCall, ...dependencies }) {
  if (typeof onCall !== "function") throw new TypeError("onCall is required");
  return onCall(
    {
      region: "asia-east1",
      timeoutSeconds: 20,
      memory: "256MiB",
      minInstances: 0,
      maxInstances: 5,
    },
    createSubmitContactMessageHandler(dependencies),
  );
}

module.exports = {
  CONTACT_CATEGORY,
  CONTACT_SOURCE,
  CONTACT_TITLE,
  createSubmitContactMessageCallable,
  createSubmitContactMessageHandler,
};
