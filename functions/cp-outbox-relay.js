"use strict";

/**
 * CP-PO-01 檢舉通知 relay：asia-main cpOutbox/{outId}（kind=cpReportFiled）→ 管理員站內信＋（featureFlags.cpReportLineEnabled === true 時）官方帳號推播。
 *
 * 賽事 codebase（functions-cp/src/cp/participant.ts）在交易內寫 cpOutbox；本檔訂閱 asia-main 的 onDocumentCreated 投遞出去：
 *   - 站內信：每位 admin/super_admin 一封 cpo_{outId}（固定 id＋create，ALREADY_EXISTS 視為 duplicate）。
 *   - LINE：只有 featureFlags.cpReportLineEnabled === true 才入列；每人固定 id cpo_{outId}_{uid}；月度上限 LINE_MONTHLY_MAX（官方帳號輕用量，
 *     賽事檢舉最多用 30 則/月），超額只發站內信。整月額度存在 asia-main cpLineThrottle/m_YYYYMM（交易內遞增，retry 靠 outbox.lineReserved 對帳）。
 *
 * 冪等：不信事件 payload，一律在交易內讀 cpOutbox 最新狀態；固定 id＋create、lineReserved 只寫一次，重複事件不會重複投遞或扣額度。
 * LINE 收件人只看 lineNotify.bound，不看個人 system 開關與全站通知開關（與 contact-message.js 聯繫站長同一做法：
 *   檢舉必須送到管理員；總閘門是 featureFlags.cpReportLineEnabled，預設關）。
 * 重試：投遞部分失敗→ status:retrying 並 throw（retry:true 觸發平台重送）；MAX_ATTEMPTS 內一直失敗才標 failed。事件過舊（>6h）直接標 failed（不拋，避免無限重試）。
 */

const { stripControlChars, formatTaipeiDateTime, maskUid } = require("./notification-fields");
const { buildInboxMessageDoc } = require("./inbox-message-doc");

const CP_DATABASE_ID = "asia-main";
const OUTBOX_COLLECTION = "cpOutbox";
const MAX_ATTEMPTS = 5;
const MAX_EVENT_AGE_MS = 6 * 60 * 60 * 1000;
const ADMIN_QUERY_LIMIT = 20;
const INBOX_RECIPIENT_MAX = 10;
const LINE_RECIPIENT_MAX = 3;
// 官方帳號輕用量每月 200 則；賽事檢舉最多用 30 則/月，之後只發站內信。
const LINE_MONTHLY_MAX = 30;
// 只有 === true 才發 LINE；欄位不存在＝關。
const LINE_FLAG_FIELD = "cpReportLineEnabled";

const REASON_LABELS = Object.freeze({
  impersonation: "冒用身分",
  fake: "不實賽事",
  inappropriate: "不當內容",
  privacy: "個資問題",
  other: "其他",
});

const TITLE = "賽事檢舉";
const INBOX_ID_PREFIX = "cpo_";
const LINE_SOURCE = "cp_report";
const LINE_CATEGORY = "system";
const TRIGGER_OPTIONS = Object.freeze({
  region: "asia-east1",
  document: "cpOutbox/{outId}",
  database: "asia-main",
  memory: "256MiB",
  cpu: "gcf_gen1",
  timeoutSeconds: 60,
  maxInstances: 2,
  retry: true,
});

const CID_RE = /^cp_[A-Za-z0-9_-]{1,40}$/;
const REASON_KEYS = Object.freeze(Object.keys(REASON_LABELS));
const ALLOWED_CHANNELS = new Set(["inbox", "line"]);

function taipeiMonthKey(nowMs) {
  const t = new Date(Number(nowMs) + 8 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}`;
}

function codePointTruncate(text, max) {
  if (text.length <= max) return text;
  return Array.from(text).slice(0, max).join("");
}

function sanitizeText(v, max) {
  if (typeof v !== "string") return "";
  const stripped = stripControlChars(v);
  // stripControlChars 不含 DEL 與 C1；空白先壓平，再去掉其餘控制字元
  const flat = stripped.replace(/\s+/g, " ").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  return codePointTruncate(flat, max);
}

function parseOutbox(data) {
  if (!data || typeof data !== "object") return { ok: false, reason: "bad_shape" };
  if (data.kind !== "cpReportFiled") return { ok: false, reason: "unknown_kind" };
  const { cid, reportId, reason, channels } = data;
  if (typeof cid !== "string" || !CID_RE.test(cid)) return { ok: false, reason: "bad_shape" };
  if (typeof reportId !== "string" || reportId.length < 1 || reportId.length > 80) {
    return { ok: false, reason: "bad_shape" };
  }
  if (typeof reason !== "string" || !REASON_KEYS.includes(reason)) {
    return { ok: false, reason: "bad_shape" };
  }
  if (!Array.isArray(channels)) return { ok: false, reason: "bad_shape" };
  if (!channels.includes("inbox")) return { ok: false, reason: "bad_shape" };
  for (const ch of channels) {
    if (!ALLOWED_CHANNELS.has(ch)) return { ok: false, reason: "bad_shape" };
  }
  const compName = sanitizeText(data.compName, 60);
  if (!compName) return { ok: false, reason: "bad_shape" };
  return { ok: true, cid, reportId, reason, compName, wantLine: channels.includes("line") };
}

function buildBody({ compName, reason }) {
  return `賽事「${compName}」收到檢舉（${REASON_LABELS[reason]}），請到賽事管理查看處理。`;
}

function planLineReservation({ monthCount, alreadyReserved, wanted }) {
  if (typeof alreadyReserved === "number") return alreadyReserved;
  const count = Number.isFinite(Number(monthCount)) ? Number(monthCount) : 0;
  const want = Number.isFinite(Number(wanted)) ? Number(wanted) : 0;
  return Math.max(0, Math.min(want, LINE_MONTHLY_MAX - count));
}

function isAlreadyExists(error) {
  return error?.code === 6 || error?.code === "already-exists" || /ALREADY_EXISTS/.test(String(error?.message));
}

function eventAgeMs(event, nowMs) {
  const raw = String(event?.time == null ? "" : event.time);
  const eventMs = Date.parse(raw);
  if (!Number.isFinite(eventMs)) return Number.NaN;
  return nowMs - eventMs;
}

function isBoundLineUser(data) {
  const lineNotify = (data && typeof data.lineNotify === "object" && data.lineNotify) ? data.lineNotify : {};
  return lineNotify.bound === true;
}

async function handleLine({
  db,
  cpDb,
  FieldValue,
  logger,
  getLineRecipientUidFromUserDoc,
  inboxDocs,
  outboxRef,
  outId,
  body,
  nowMs,
}) {
  // a. 旗標（fail-closed）
  let flagOn = false;
  let flagReadFailed = false;
  try {
    const flagSnap = await db.collection("siteConfig").doc("featureFlags").get();
    flagOn = flagSnap.exists === true && flagSnap.data()?.[LINE_FLAG_FIELD] === true;
  } catch (err) {
    logger.warn("[cpOutboxRelay] featureFlags read failed; LINE off", {
      outId,
      code: err?.code ?? null,
    });
    flagOn = false;
    flagReadFailed = true;
  }
  // 讀取失敗刻意不重試（LINE 預設關，fail-closed），只把原因分開記
  if (!flagOn) return { skipped: flagReadFailed ? "flag_read_error" : "flag_off", queued: 0, duplicate: 0, failed: 0 };

  // b. 綁定者（收件 docs 篩 lineNotify.bound === true）
  const bound = inboxDocs.filter((doc) => isBoundLineUser(doc.data ? doc.data() : null)).slice(0, LINE_RECIPIENT_MAX);
  if (bound.length === 0) return { skipped: "no_bound", queued: 0, duplicate: 0, failed: 0 };

  // c. 額度交易
  const monthKey = taipeiMonthKey(nowMs);
  const monthRef = cpDb.collection("cpLineThrottle").doc(`m_${monthKey}`);
  let n = 0;
  try {
    n = await cpDb.runTransaction(async (tx) => {
      const monthSnap = await tx.get(monthRef);
      const outboxSnap = await tx.get(outboxRef);
      if (!outboxSnap.exists) return -1;
      const outboxData = outboxSnap.data() || {};
      const monthCount = monthSnap.exists ? (Number(monthSnap.data()?.count) || 0) : 0;
      const alreadyReserved = typeof outboxData.lineReserved === "number" ? outboxData.lineReserved : undefined;
      const planned = planLineReservation({ monthCount, alreadyReserved, wanted: bound.length });
      if (alreadyReserved === undefined) {
        if (planned > 0) {
          tx.set(monthRef, { count: monthCount + planned, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
        tx.update(outboxRef, { lineReserved: planned });
      }
      return planned;
    });
  } catch (err) {
    logger.warn("[cpOutboxRelay] LINE quota transaction failed", { outId, code: err?.code ?? null });
    return { skipped: "quota_error", queued: 0, duplicate: 0, failed: 1 };
  }

  if (n < 0) {
    logger.warn("[cpOutboxRelay] outbox missing at LINE reservation", { outId });
    return { skipped: "outbox_missing", queued: 0, duplicate: 0, failed: 0 };
  }
  if (n === 0) {
    logger.warn("[cpOutboxRelay] LINE monthly cap reached", { month: monthKey, max: LINE_MONTHLY_MAX });
    return { skipped: "monthly_cap", queued: 0, duplicate: 0, failed: 0 };
  }

  // d. 入列（固定 id＝重試不重送；processLinePushQueue 全域上限照常生效）
  const targets = bound.slice(0, n);
  const results = await Promise.allSettled(targets.map(async (userDoc) => {
    const userData = (userDoc.data ? userDoc.data() : null) || {};
    const queueId = `cpo_${outId}_${userDoc.id}`;
    const targetUid = getLineRecipientUidFromUserDoc({ docId: userDoc.id, data: userData }, userDoc.id);
    try {
      await db.collection("linePushQueue").doc(queueId).create({
        uid: targetUid,
        targetDocId: userDoc.id,
        title: TITLE,
        body,
        category: LINE_CATEGORY,
        status: "pending",
        createdAt: FieldValue.serverTimestamp(),
        source: LINE_SOURCE,
        requestedByUid: "system",
        requestedByRole: "system",
        pool: "staff",
        dedupeKey: queueId,
      });
      return "queued";
    } catch (err) {
      if (isAlreadyExists(err)) return "duplicate";
      throw err;
    }
  }));

  const summary = { queued: 0, duplicate: 0, failed: 0 };
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      summary[result.value] += 1;
      return;
    }
    summary.failed += 1;
    logger.warn("[cpOutboxRelay] line push enqueue failed", {
      outId,
      uid: maskUid(targets[index]?.id || ""),
      code: result.reason?.code ?? null,
    });
  });
  return { skipped: null, ...summary };
}

/**
 * 觸發器 handler（可注入，供單元測試與模擬器測試直接呼叫）。
 * 事件：{ params: { outId }, time: ISO }；一律重讀 cpOutbox 現況，不信 event.data。
 */
function createCpOutboxRelayHandler({
  db,
  getCpDb,
  FieldValue,
  logger,
  getLineRecipientUidFromUserDoc,
  now = () => Date.now(),
}) {
  return async (event) => {
    const outId = event?.params?.outId;
    if (typeof outId !== "string" || outId.length === 0) {
      logger.error("[cpOutboxRelay] missing outId; drop", {});
      return;
    }
    const cpDb = getCpDb();
    const outboxRef = cpDb.collection(OUTBOX_COLLECTION).doc(outId);
    const nowMs = Number(now());

    // 1. 事件過舊防護（不拋，避免無限重試）
    const age = eventAgeMs(event, nowMs);
    // 時間無法解析或超過 6 小時才丟；事件時間略快於本機時鐘（age < 0）照常處理
    if (!Number.isFinite(age) || age > MAX_EVENT_AGE_MS) {
      logger.error("[cpOutboxRelay] event too old; drop", { outId });
      try {
        // 只標記尚未收尾的文件；已送出（sent）被延遲重送時不得蓋成 failed（Opus 終審 P3-2）
        await cpDb.runTransaction(async (tx) => {
          const snap = await tx.get(outboxRef);
          const status = snap.exists ? (snap.data() || {}).status : null;
          if (status !== "pending" && status !== "retrying") return;
          tx.update(outboxRef, {
            status: "failed",
            failReason: "event_too_old",
            updatedAt: FieldValue.serverTimestamp(),
          });
        });
      } catch (updateErr) {
        // 文件不存在或不可更新：不重試，但留紀錄（R-CF-002）
        logger.warn("[cpOutboxRelay] event_too_old mark failed", { outId, code: updateErr?.code ?? null });
      }
      return;
    }

    try {
      // 2. 認領交易
      const claim = await cpDb.runTransaction(async (tx) => {
        const snap = await tx.get(outboxRef);
        if (!snap.exists) return { skip: "not_found" };
        const data = snap.data() || {};
        const status = data.status;
        if (status !== "pending" && status !== "retrying") return { skip: "already" };
        const parsed = parseOutbox(data);
        if (!parsed.ok) {
          tx.update(outboxRef, {
            status: "skipped",
            failReason: parsed.reason,
            updatedAt: FieldValue.serverTimestamp(),
          });
          return { skip: "parse_failed", reason: parsed.reason };
        }
        const attempts = (Number(data.attempts) || 0) + 1;
        if (attempts > MAX_ATTEMPTS) {
          tx.update(outboxRef, {
            status: "failed",
            failReason: "max_attempts",
            updatedAt: FieldValue.serverTimestamp(),
          });
          return { skip: "max_attempts" };
        }
        tx.update(outboxRef, {
          attempts,
          status: "retrying",
          lastAttemptAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { parsed };
      });

      if (claim.skip === "not_found" || claim.skip === "already") return;
      if (claim.skip === "parse_failed") {
        logger.warn("[cpOutboxRelay] outbox parse failed; skipped", { outId, reason: claim.reason });
        return;
      }
      if (claim.skip === "max_attempts") {
        logger.error("[cpOutboxRelay] max attempts reached; marking failed", { outId });
        return;
      }

      const { parsed } = claim;
      const { cid, reportId, reason, compName, wantLine } = parsed;

      // 3. 收件人（主庫）
      const usersSnap = await db.collection("users")
        .where("role", "in", ["admin", "super_admin"])
        .limit(ADMIN_QUERY_LIMIT)
        .get();
      const allAdminDocs = Array.isArray(usersSnap?.docs) ? usersSnap.docs : [];
      const inboxDocs = allAdminDocs.slice(0, INBOX_RECIPIENT_MAX);

      if (inboxDocs.length === 0) {
        logger.warn("[cpOutboxRelay] no admin recipient", { outId });
        await outboxRef.update({
          status: "sent",
          sentAt: FieldValue.serverTimestamp(),
          inboxWritten: 0,
          note: "no_recipient",
          updatedAt: FieldValue.serverTimestamp(),
        });
        return;
      }

      // 4. 站內信
      const body = buildBody({ compName, reason });
      const inboxId = `${INBOX_ID_PREFIX}${outId}`;
      const inboxTemplate = buildInboxMessageDoc({
        id: inboxId,
        title: TITLE,
        body,
        type: "system",
        typeName: "系統",
        time: formatTaipeiDateTime(nowMs),
        senderName: "系統",
        fromUid: "system",
        // 不設 actionType：收件匣只要 actionType 有值就顯示待審／已審標籤。
        actionStatus: null,
        meta: { cid, reportId, cpOutboxId: outId },
      }, { createdAt: FieldValue.serverTimestamp() });

      const inboxResults = await Promise.allSettled(inboxDocs.map(async (userDoc) => {
        try {
          await db.collection("users").doc(userDoc.id).collection("inbox").doc(inboxId).create(inboxTemplate);
          return "written";
        } catch (err) {
          if (isAlreadyExists(err)) return "duplicate";
          throw err;
        }
      }));

      const inboxSummary = { written: 0, duplicate: 0, failed: 0 };
      inboxResults.forEach((result, index) => {
        if (result.status === "fulfilled") {
          inboxSummary[result.value] += 1;
          return;
        }
        inboxSummary.failed += 1;
        logger.warn("[cpOutboxRelay] inbox write failed", {
          outId,
          uid: maskUid(inboxDocs[index]?.id || ""),
          code: result.reason?.code ?? null,
        });
      });

      // 5. LINE
      let lineResult = { skipped: null, queued: 0, duplicate: 0, failed: 0 };
      if (wantLine) {
        lineResult = await handleLine({
          db,
          cpDb,
          FieldValue,
          logger,
          getLineRecipientUidFromUserDoc,
          inboxDocs,
          outboxRef,
          outId,
          body,
          nowMs,
        });
      }

      // 6. 收尾
      const inboxFailed = inboxSummary.failed;
      const lineFailed = lineResult.failed || 0;
      if (inboxFailed > 0 || lineFailed > 0) {
        await outboxRef.update({
          status: "retrying",
          lastError: inboxFailed > 0 ? "inbox_partial" : "line_partial",
          inboxWritten: inboxSummary.written,
          inboxDuplicate: inboxSummary.duplicate,
          lineQueued: lineResult.queued || 0,
          lineSkipped: lineResult.skipped || null,
          updatedAt: FieldValue.serverTimestamp(),
        });
        throw new Error("cpOutboxRelay partial delivery failure; retry");
      }

      await outboxRef.update({
        status: "sent",
        sentAt: FieldValue.serverTimestamp(),
        inboxWritten: inboxSummary.written,
        inboxDuplicate: inboxSummary.duplicate,
        lineQueued: lineResult.queued || 0,
        lineSkipped: lineResult.skipped || null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      logger.log("[cpOutboxRelay] delivered", {
        outId,
        inboxWritten: inboxSummary.written,
        lineQueued: lineResult.queued || 0,
      });
      return;
    } catch (err) {
      // 7. 未預期錯誤：記 error 後重拋（R-CF-002；retry:true 由平台重送）
      logger.error("[cpOutboxRelay] failed; will retry", { outId, code: err?.code ?? null });
      throw err;
    }
  };
}

function createCpOutboxRelayExports({
  onDocumentCreated,
  db,
  getFirestore,
  FieldValue,
  logger,
  getLineRecipientUidFromUserDoc,
}) {
  let cpDb = null;
  const getCpDb = () => {
    if (!cpDb) cpDb = getFirestore(CP_DATABASE_ID);
    return cpDb;
  };
  return {
    cpOutboxRelay: onDocumentCreated(
      { ...TRIGGER_OPTIONS },
      createCpOutboxRelayHandler({ db, getCpDb, FieldValue, logger, getLineRecipientUidFromUserDoc }),
    ),
  };
}

module.exports = {
  ADMIN_QUERY_LIMIT,
  CP_DATABASE_ID,
  INBOX_ID_PREFIX,
  INBOX_RECIPIENT_MAX,
  LINE_CATEGORY,
  LINE_FLAG_FIELD,
  LINE_MONTHLY_MAX,
  LINE_RECIPIENT_MAX,
  LINE_SOURCE,
  MAX_ATTEMPTS,
  MAX_EVENT_AGE_MS,
  OUTBOX_COLLECTION,
  REASON_LABELS,
  TITLE,
  TRIGGER_OPTIONS,
  buildBody,
  createCpOutboxRelayExports,
  createCpOutboxRelayHandler,
  parseOutbox,
  planLineReservation,
  sanitizeText,
  taipeiMonthKey,
};
