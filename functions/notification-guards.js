"use strict";

/**
 * 通知發送授權強化（第 1 批）：節流、上限與去重（有 I/O，依賴注入 db／FieldValue／HttpsError）。
 * 計數以 Admin SDK 寫入專用集合（Rules 明確拒絕客戶端存取）；純函式見 notification-fields.js，閾值見 notification-guard-limits.js。
 */

const crypto = require("crypto");
const fields = require("./notification-fields");
const {
  NOTIFICATION_GUARD_LIMITS: LIMITS,
  COUNTER_COLLECTION,
  DEDUPE_COLLECTION,
} = require("./notification-guard-limits");

const LOG = "[notificationGuards]";
const hashId = (value) => crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 32);

function createNotificationGuards({
  db,
  FieldValue,
  HttpsError,
  roleLevels,
  now = () => Date.now(),
  random = Math.random,
  logger = console,
}) {
  const rateLimited = () => new HttpsError("resource-exhausted", "RATE_LIMITED");
  const loggedKeys = new Set();

  // 教練以上＝角色等級 ≥ coach（沿用 functions/index.js 的 ROLE_LEVELS；自訂與未知角色視為一般層，與 Rules isCoachPlus 一致）
  function isStaffRole(role) {
    const key = typeof role === "string" ? role.trim() : "";
    const level = Object.prototype.hasOwnProperty.call(roleLevels, key) ? roleLevels[key] : 0;
    return level >= roleLevels.coach;
  }

  // 閘門觸發記錄：每（閘, 種類, 分鐘, 呼叫者）最多一筆；count／limit 供事後彙總，不含 title／body／完整 UID
  function logGate(gate, { kind, callerUid, source, count, limit }) {
    const key = `${gate}|${kind}|${Math.floor(now() / 60000)}|${callerUid ? hashId(callerUid) : ""}`;
    if (loggedKeys.has(key)) return;
    if (loggedKeys.size >= 2000) loggedKeys.clear();
    loggedKeys.add(key);
    logger.warn(`${LOG} gate triggered`, {
      gate,
      kind,
      caller: fields.maskUid(callerUid),
      source: fields.logSafeSource(source),
      count: count ?? null,
      limit: limit ?? null,
    });
  }

  // 先遞增再讀回總和（分片時加總）；回傳含本次的計數。increment=false 時只讀回、不遞增
  async function bump({ windowKey, scope, subject, shards = 1, expireAtMs }, increment = true) {
    const base = [windowKey, scope, subject ? hashId(subject) : null].filter(Boolean).join("_");
    const collection = db.collection(COUNTER_COLLECTION);
    const shardIds = shards > 1
      ? Array.from({ length: shards }, (_, index) => `${base}_s${index}`)
      : [base];
    const pick = shardIds[shards > 1 ? Math.floor(random() * shards) : 0];
    if (increment) {
      await collection.doc(pick).set({
        scope,
        windowKey,
        count: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
        expireAt: new Date(expireAtMs),
      }, { merge: true });
    }
    const snaps = await db.getAll(...shardIds.map((id) => collection.doc(id)));
    return snaps.reduce((sum, snap) => sum + (snap.exists ? Number(snap.data()?.count) || 0 : 0), 0);
  }

  // 計數基礎設施失敗：結構化記錄；一般層 fail-closed（sanitized internal），教練以上與處理端 fail-open
  function onCounterFailure(gate, ctx, err) {
    const failOpen = !!(ctx.staff || ctx.failOpen);
    logger.error(`${LOG} counter failure`, { gate, kind: ctx.kind, staff: !!ctx.staff, failOpen, code: err?.code ?? null });
    if (!failOpen) throw new HttpsError("internal", "Failed to verify request limits");
  }

  // 遞增後與上限比較；超限記錄並回 true；計數故障依 onCounterFailure 處理（放行時回 false）
  async function exceeded(gate, params, limit, ctx, increment = true) {
    let total;
    try {
      total = await bump(params, increment);
    } catch (err) {
      onCounterFailure(gate, ctx, err);
      return false;
    }
    if (total <= limit) return false;
    logGate(gate, { ...ctx, count: total, limit });
    return true;
  }

  // 全域池當日第一次超限：以 create() 只成功一次，記一筆 error（跨實例只記一次）
  async function logCapOnce(kind, pool, day) {
    const gate = `global_pool_${pool}`;
    try {
      await db.collection(COUNTER_COLLECTION).doc(`${day}_cap_${kind}_${pool}`).create({
        kind,
        pool,
        day,
        at: FieldValue.serverTimestamp(),
        expireAt: new Date(now() + LIMITS.counterTtlMs),
      });
      logger.error(`${LOG} global daily cap reached`, { gate, kind, day, limit: LIMITS.globalPerDay[pool] });
    } catch (err) {
      if (err?.code === 6 || /ALREADY_EXISTS/.test(String(err?.message))) return;
      logger.warn(`${LOG} cap marker failed`, { gate, kind, code: err?.code ?? null });
    }
  }

  // 每呼叫者每分鐘節流（kind: "enqueue" | "inbox"）；站內信另有一般層每日上限
  async function enforceCallerLimit({ kind, callerUid, callerRole, source = null }) {
    const staff = isStaffRole(callerRole);
    const cfg = LIMITS[kind];
    const ctx = { kind, callerUid, source, staff };
    const minute = Math.floor(now() / 60000);
    const minuteParams = {
      windowKey: `m${minute}`,
      scope: `caller_${kind}`,
      subject: callerUid,
      shards: staff ? LIMITS.staffCallerShards : 1,
      expireAtMs: (minute + 2) * 60000,
    };
    if (await exceeded("caller_minute", minuteParams, staff ? cfg.staffPerMinute : cfg.userPerMinute, ctx)) {
      throw rateLimited();
    }
    if (kind !== "inbox" || staff) return;
    const dayParams = {
      windowKey: fields.taipeiDayKey(now()),
      scope: "caller_day_inbox",
      subject: callerUid,
      expireAtMs: now() + LIMITS.counterTtlMs,
    };
    if (await exceeded("caller_day", dayParams, cfg.userPerDay, ctx)) throw rateLimited();
  }

  // 實際入列前的每日上限：一般層依序檢查 呼叫者／（呼叫者,目標）／目標，再扣全域池；教練以上只扣 staff 池
  async function enforceDailyLimits({ callerUid, callerRole, targetUid, source = null }) {
    const staff = isStaffRole(callerRole);
    const ctx = { kind: "enqueue", callerUid, source, staff };
    const day = fields.taipeiDayKey(now());
    const daily = (scope, subject, extra = {}) => ({
      windowKey: day,
      scope,
      subject,
      expireAtMs: now() + LIMITS.counterTtlMs,
      ...extra,
    });
    if (!staff) {
      if (await exceeded("caller_day", daily("caller_day_enqueue", callerUid), LIMITS.enqueue.userPerDay, ctx)) {
        throw rateLimited();
      }
      if (await exceeded("caller_target_day", daily("caller_target_day", `${callerUid}\n${targetUid}`), LIMITS.callerTargetPerDay, ctx)) {
        throw rateLimited();
      }
      if (await exceeded("target_day", daily("target", targetUid), LIMITS.targetPerDay, ctx)) throw rateLimited();
    }
    const pool = staff ? "staff" : "user";
    const poolParams = daily(`global_enqueue_${pool}`, null, { shards: LIMITS.globalShards });
    if (await exceeded(`global_pool_${pool}`, poolParams, LIMITS.globalPerDay[pool], ctx)) {
      await logCapOnce("enqueue", pool, day);
      throw rateLimited();
    }
  }

  const dedupeRef = (uid, dedupeKey) => db.collection(DEDUPE_COLLECTION).doc(hashId(`${uid}\n${dedupeKey}`));

  // 以（收件者, dedupeKey）為鍵，視窗內只發一次；同一文件重試視為同一次
  async function claimDedupe({ queueId, uid, dedupeKey }) {
    const nowMs = now();
    const ref = dedupeRef(uid, dedupeKey);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        const previous = snap.data() || {};
        if (previous.queueId === queueId) return { outcome: "own", ageMs: 0 };
        const ageMs = nowMs - Number(previous.claimedAtMs);
        if (ageMs < LIMITS.dedupeWindowMs) return { outcome: "duplicate", ageMs };
      }
      tx.set(ref, { queueId, claimedAtMs: nowMs, expireAt: new Date(nowMs + LIMITS.dedupeWindowMs) });
      return { outcome: "claimed", ageMs: 0 };
    });
  }

  // 發送失敗或被上限擋下時釋放，讓後續重送不被視為重複
  async function releaseDedupe({ queueId, uid, dedupeKey }) {
    if (!dedupeKey) return;
    try {
      const ref = dedupeRef(uid, dedupeKey);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists && snap.data()?.queueId === queueId) tx.delete(ref);
      });
    } catch (err) {
      logger.warn(`${LOG} dedupe release failed`, { queueId, code: err?.code ?? null });
    }
  }

  /**
   * processLinePushQueue 發送前檢查：回傳 { skip, reason }。
   * 入列端已先把關，這裡計數或去重的基礎設施失敗時一律放行並結構化記錄，不因故障漏發通知。
   * 全域池依 queue 文件的 requestedByUid／requestedByRole 判斷層級（教練以上與系統用 staff 池，無法判斷歸一般層）。
   */
  async function checkBeforePush({ queueId, uid, dedupeKey, requestedByUid, requestedByRole, source }) {
    const key = typeof dedupeKey === "string" ? dedupeKey : "";
    const staff = requestedByUid === "system" || isStaffRole(requestedByRole);
    const ctx = { kind: "send", callerUid: requestedByUid, source, staff, failOpen: true };
    let claimed = false;
    let countThisSend = true; // 同一文件重試（own）第一次嘗試已計入全域池，不重複遞增，只檢查池是否已超限
    try {
      if (key) {
        const { outcome, ageMs } = await claimDedupe({ queueId, uid, dedupeKey: key });
        if (outcome === "duplicate") {
          logGate("dedupe", { ...ctx, count: ageMs, limit: LIMITS.dedupeWindowMs });
          return { skip: true, reason: "duplicate" };
        }
        claimed = outcome === "claimed";
        countThisSend = outcome !== "own";
      }
      const pool = staff ? "staff" : "user";
      const day = fields.taipeiDayKey(now());
      const poolParams = {
        windowKey: day,
        scope: `global_send_${pool}`,
        shards: LIMITS.globalShards,
        expireAtMs: now() + LIMITS.counterTtlMs,
      };
      if (await exceeded(`global_pool_${pool}`, poolParams, LIMITS.globalPerDay[pool], ctx, countThisSend)) {
        if (claimed) await releaseDedupe({ queueId, uid, dedupeKey: key });
        await logCapOnce("send", pool, day);
        return { skip: true, reason: "daily_cap" };
      }
    } catch (err) {
      logger.error(`${LOG} pre-push check failed, allow`, { queueId, code: err?.code ?? null });
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

  function logSourceFormatRejected({ callerUid }) {
    logGate("source_format", { kind: "enqueue", callerUid, source: null });
  }

  return {
    ...fields,
    now,
    isStaffRole,
    enforceCallerLimit,
    enforceDailyLimits,
    checkBeforePush,
    releaseDedupe,
    logUnknownSource,
    logSourceFormatRejected,
  };
}

module.exports = {
  createNotificationGuards,
  NOTIFICATION_GUARD_LIMITS: LIMITS,
  COUNTER_COLLECTION,
  DEDUPE_COLLECTION,
};
