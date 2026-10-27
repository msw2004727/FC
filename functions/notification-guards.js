"use strict";

/**
 * 通知發送授權強化（第 1 批）：節流、上限與去重（有 I/O，依賴注入 db／FieldValue／HttpsError）。
 * 計數以 Admin SDK 寫入專用集合（Rules catch-all 預設拒絕客戶端存取）；純函式見 notification-fields.js。
 */

const crypto = require("crypto");
const fields = require("./notification-fields");

// ── 暫定值，等用量盤點後調整 ──
const ENQUEUE_PER_CALLER_PER_MINUTE = 20; // 一般使用者：LINE 推播入列，每呼叫者每分鐘
const ENQUEUE_STAFF_PER_CALLER_PER_MINUTE = 2000; // 教練以上：合法的批次通知（活動異動／取消、全體廣播）
const ENQUEUE_PER_TARGET_PER_DAY = 30; // 每目標每日
const LINE_GLOBAL_PER_DAY = 2000; // 全域每日（入列與實際發送各自計數）
const INBOX_PER_CALLER_PER_MINUTE = 60; // 一般使用者：站內信投遞，每呼叫者每分鐘
const INBOX_STAFF_PER_CALLER_PER_MINUTE = 2000;
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000; // dedupeKey 去重視窗

const COUNTER_COLLECTION = "notificationGuardCounters";
const DEDUPE_COLLECTION = "linePushDedupe";
const STAFF_ROLES = new Set(["coach", "captain", "venue_owner", "admin", "super_admin"]);
const STAFF_CALLER_SHARDS = 8; // 批次通知時分散同一呼叫者的寫入
const GLOBAL_SHARDS = 10;
const COUNTER_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const CALLER_LIMITS = Object.freeze({
  enqueue: { user: ENQUEUE_PER_CALLER_PER_MINUTE, staff: ENQUEUE_STAFF_PER_CALLER_PER_MINUTE },
  inbox: { user: INBOX_PER_CALLER_PER_MINUTE, staff: INBOX_STAFF_PER_CALLER_PER_MINUTE },
});

const hashId = (value) => crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 32);
const isStaffRole = (role) => STAFF_ROLES.has(role);

function createNotificationGuards({
  db,
  FieldValue,
  HttpsError,
  now = () => Date.now(),
  random = Math.random,
  logger = console,
}) {
  const rateLimited = () => new HttpsError("resource-exhausted", "RATE_LIMITED");

  // 先遞增再讀回總和（分片時加總）；回傳含本次的計數
  async function bump({ windowKey, scope, subject, shards = 1, expireAtMs }) {
    const base = [windowKey, scope, subject ? hashId(subject) : null].filter(Boolean).join("_");
    const collection = db.collection(COUNTER_COLLECTION);
    const shardIds = shards > 1
      ? Array.from({ length: shards }, (_, index) => `${base}_s${index}`)
      : [base];
    const pick = shardIds[shards > 1 ? Math.floor(random() * shards) : 0];
    await collection.doc(pick).set({
      scope,
      windowKey,
      count: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
      expireAt: new Date(expireAtMs),
    }, { merge: true });
    const snaps = await db.getAll(...shardIds.map((id) => collection.doc(id)));
    return snaps.reduce((sum, snap) => sum + (snap.exists ? Number(snap.data()?.count) || 0 : 0), 0);
  }

  // 計數基礎設施失敗：結構化記錄並回 sanitized 錯誤（不放行、不洩漏細節）
  function counterFailure(guard, err) {
    logger.error("[notificationGuards] counter failure", { guard, code: err?.code ?? null });
    return new HttpsError("internal", "Failed to verify request limits");
  }

  async function logCapOnce(kind, day) {
    try {
      await db.collection(COUNTER_COLLECTION).doc(`${day}_cap_${kind}`).create({
        kind,
        day,
        limit: LINE_GLOBAL_PER_DAY,
        at: FieldValue.serverTimestamp(),
        expireAt: new Date(now() + COUNTER_TTL_MS),
      });
      logger.error("[notificationGuards] global daily cap reached", { kind, day, limit: LINE_GLOBAL_PER_DAY });
    } catch (err) {
      if (err?.code === 6 || /ALREADY_EXISTS/.test(String(err?.message))) return;
      logger.warn("[notificationGuards] cap log marker failed", { kind, code: err?.code ?? null });
    }
  }

  // 每呼叫者每分鐘節流；kind: "enqueue" | "inbox"；教練以上使用較高上限
  async function enforceCallerLimit(kind, callerUid, callerRole) {
    const staff = isStaffRole(callerRole);
    const limit = CALLER_LIMITS[kind][staff ? "staff" : "user"];
    const minute = Math.floor(now() / 60000);
    let total;
    try {
      total = await bump({
        windowKey: `m${minute}`,
        scope: `caller_${kind}`,
        subject: callerUid,
        shards: staff ? STAFF_CALLER_SHARDS : 1,
        expireAtMs: (minute + 2) * 60000,
      });
    } catch (err) {
      throw counterFailure(`caller_${kind}`, err);
    }
    if (total > limit) {
      if (total === limit + 1) {
        logger.warn("[notificationGuards] caller rate limited", {
          kind,
          callerUid: fields.maskUid(callerUid),
          staff,
          limit,
        });
      }
      throw rateLimited();
    }
  }

  // 實際入列前：每目標每日與全域每日上限
  async function enforceDailyLimits(targetUid) {
    const nowMs = now();
    const day = fields.taipeiDayKey(nowMs);
    const expireAtMs = nowMs + COUNTER_TTL_MS;
    let targetTotal;
    let globalTotal;
    try {
      targetTotal = await bump({ windowKey: day, scope: "target", subject: targetUid, expireAtMs });
      if (targetTotal <= ENQUEUE_PER_TARGET_PER_DAY) {
        globalTotal = await bump({ windowKey: day, scope: "global_enqueue", shards: GLOBAL_SHARDS, expireAtMs });
      }
    } catch (err) {
      throw counterFailure("daily_enqueue", err);
    }
    if (targetTotal > ENQUEUE_PER_TARGET_PER_DAY) throw rateLimited();
    if (globalTotal > LINE_GLOBAL_PER_DAY) {
      await logCapOnce("enqueue", day);
      throw rateLimited();
    }
  }

  const dedupeRef = (uid, dedupeKey) => db.collection(DEDUPE_COLLECTION).doc(hashId(`${uid}\n${dedupeKey}`));

  // 以（收件者, dedupeKey）為鍵，24 小時內只發一次；同一文件重試視為同一次
  async function claimDedupe({ queueId, uid, dedupeKey }) {
    const nowMs = now();
    const ref = dedupeRef(uid, dedupeKey);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        const previous = snap.data() || {};
        if (previous.queueId === queueId) return "own";
        if (nowMs - Number(previous.claimedAtMs) < DEDUPE_WINDOW_MS) return "duplicate";
      }
      tx.set(ref, { queueId, claimedAtMs: nowMs, expireAt: new Date(nowMs + DEDUPE_WINDOW_MS) });
      return "claimed";
    });
  }

  // 發送失敗或被上限擋下時釋放，讓後續重送不被誤判為重複
  async function releaseDedupe({ queueId, uid, dedupeKey }) {
    if (!dedupeKey) return;
    try {
      const ref = dedupeRef(uid, dedupeKey);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists && snap.data()?.queueId === queueId) tx.delete(ref);
      });
    } catch (err) {
      logger.warn("[notificationGuards] dedupe release failed", { queueId, code: err?.code ?? null });
    }
  }

  /**
   * processLinePushQueue 發送前檢查：回傳 { skip, reason }。
   * 次要防線（入列端已把關），基礎設施失敗時放行並結構化記錄，不因計數故障漏發通知。
   */
  async function checkBeforePush({ queueId, uid, dedupeKey }) {
    const key = typeof dedupeKey === "string" ? dedupeKey : "";
    let claimed = false;
    try {
      if (key) {
        const outcome = await claimDedupe({ queueId, uid, dedupeKey: key });
        if (outcome === "duplicate") return { skip: true, reason: "duplicate" };
        claimed = outcome === "claimed";
      }
      const nowMs = now();
      const day = fields.taipeiDayKey(nowMs);
      const total = await bump({
        windowKey: day,
        scope: "global_send",
        shards: GLOBAL_SHARDS,
        expireAtMs: nowMs + COUNTER_TTL_MS,
      });
      if (total > LINE_GLOBAL_PER_DAY) {
        if (claimed) await releaseDedupe({ queueId, uid, dedupeKey: key });
        await logCapOnce("send", day);
        return { skip: true, reason: "daily_cap" };
      }
    } catch (err) {
      logger.error("[notificationGuards] pre-push check failed, allow", { queueId, code: err?.code ?? null });
    }
    return { skip: false, reason: "" };
  }

  function logUnknownSource({ callerUid, source, category }) {
    if (fields.isKnownSource(source)) return false;
    logger.warn("[enqueuePrivilegedLineNotification] unknown source", {
      callerUid: fields.maskUid(callerUid),
      source,
      category,
    });
    return true;
  }

  return {
    ...fields,
    now,
    enforceCallerLimit,
    enforceDailyLimits,
    checkBeforePush,
    releaseDedupe,
    logUnknownSource,
  };
}

module.exports = {
  createNotificationGuards,
  isStaffRole,
  ENQUEUE_PER_CALLER_PER_MINUTE,
  ENQUEUE_STAFF_PER_CALLER_PER_MINUTE,
  ENQUEUE_PER_TARGET_PER_DAY,
  LINE_GLOBAL_PER_DAY,
  INBOX_PER_CALLER_PER_MINUTE,
  INBOX_STAFF_PER_CALLER_PER_MINUTE,
  DEDUPE_WINDOW_MS,
  COUNTER_COLLECTION,
  DEDUPE_COLLECTION,
};
