"use strict";

/**
 * 聯繫站長 Callable。訊息寫入 contactMessages；頻率計數只在 contactMessageLimits 交易內讀寫。
 * LINE 通知直接寫 linePushQueue，不呼叫 enforceDailyLimits（一般層 targetPerDay 會擋站長收件）。
 * 仍寫入 pool，processLinePushQueue 的全域發送上限照舊生效。
 * category 用既有 system。source contact_owner 符合格式；未知 source 只記 warn、不擋，故不改白名單。
 */

const { selectEnqueuePool } = require("./notification-pool");
const { NOTIFICATION_GUARD_LIMITS } = require("./notification-guard-limits");
const { relationMode } = require("./notification-relation-enforcement");
const { maskUid, stripControlChars } = require("./notification-fields");

const CONTACT_NAME_MAX = 30;
const CONTACT_METHOD_MAX = 80;
const CONTACT_CONTENT_MAX = 1000;
const CONTACT_BODY_MAX = 300;
const CONTACT_MAX_PER_WINDOW = 5;
const CONTACT_WINDOW_MS = 24 * 60 * 60 * 1000;
const CONTACT_MIN_GAP_MS = 60 * 1000;
const CONTACT_NOTIFY_LIMIT = 5;
const CONTACT_USER_NAME_MAX = 80;
const CONTACT_CATEGORY = "system";
const CONTACT_SOURCE = "contact_owner";
const CONTACT_TITLE = "聯繫站長";

function codePointLength(text) {
  return Array.from(text).length;
}

function requireContactText(value, max, code, HttpsError) {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", code, { code });
  }
  const trimmed = value.trim();
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

function recentSentAt(sentAtMs, nowMs) {
  if (!Array.isArray(sentAtMs)) return [];
  return sentAtMs
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value <= nowMs && nowMs - value < CONTACT_WINDOW_MS)
    .sort((left, right) => left - right);
}

function assertContactRate(recent, nowMs, HttpsError) {
  const last = recent.length ? recent[recent.length - 1] : null;
  const tooMany = recent.length >= CONTACT_MAX_PER_WINDOW;
  const tooSoon = last !== null && nowMs - last < CONTACT_MIN_GAP_MS;
  if (tooMany || tooSoon) {
    throw new HttpsError("resource-exhausted", "CONTACT_RATE_LIMITED", { code: "CONTACT_RATE_LIMITED" });
  }
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

async function enqueueContactOwnerPushes({
  db,
  FieldValue,
  name,
  contact,
  content,
  requestedByUid,
  requestedByRole,
  isStaffRole,
  getLineRecipientUidFromUserDoc,
  logger,
}) {
  const snap = await db.collection("users").where("role", "==", "super_admin").limit(CONTACT_NOTIFY_LIMIT).get();
  const docs = Array.isArray(snap?.docs) ? snap.docs : [];
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
  const body = buildContactNotifyBody(name, contact, content);
  const results = await Promise.allSettled(docs.map(async (userDoc) => {
    const data = typeof userDoc.data === "function" ? (userDoc.data() || {}) : {};
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
    const data = typeof userDoc.data === "function" ? (userDoc.data() || {}) : {};
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

    const data = request?.data && typeof request.data === "object" ? request.data : {};
    const name = requireContactText(data.name, CONTACT_NAME_MAX, "INVALID_NAME", HttpsError);
    const contact = requireContactText(data.contact, CONTACT_METHOD_MAX, "INVALID_CONTACT", HttpsError);
    const content = requireContactText(data.content, CONTACT_CONTENT_MAX, "INVALID_CONTENT", HttpsError);
    const source = normalizeContactSource(data.source);

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
    const nowMs = Number(now());
    if (!Number.isFinite(nowMs)) {
      logger.error("[submitContactMessage] clock failed", { uid: maskUid(uid) });
      throw new HttpsError("internal", "CONTACT_SUBMIT_FAILED", { code: "CONTACT_SUBMIT_FAILED" });
    }

    try {
      await db.runTransaction(async (tx) => {
        const limitSnap = await tx.get(limitRef);
        const stored = limitSnap.exists ? limitSnap.data()?.sentAtMs : [];
        const recent = recentSentAt(stored, nowMs);
        assertContactRate(recent, nowMs, HttpsError);
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
          sentAtMs: recent.concat(nowMs),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      logger.error("[submitContactMessage] transaction failed", {
        uid: maskUid(uid),
        code: err?.code ?? null,
      });
      throw new HttpsError("internal", "CONTACT_SUBMIT_FAILED", { code: "CONTACT_SUBMIT_FAILED" });
    }

    let notifyResult = { queued: 0, failed: 0 };
    try {
      notifyResult = await enqueueContactOwnerPushes({
        db,
        FieldValue,
        name,
        contact,
        content,
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
    { region: "asia-east1", timeoutSeconds: 20 },
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
