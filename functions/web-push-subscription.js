"use strict";

/**
 * 網頁推播（W2-B）兩支 Callable：registerWebPushSubscription／unregisterWebPushSubscription。
 * - 不持秘密；只寫 webPushSubscriptions 與 webPushDaily 的註冊計數（reg_ 前綴），全部經 Admin SDK，Rules 不改。
 * - uid 一律取 request.auth.uid，不讀 request.data 裡任何 uid。
 * - 輸入白名單：endpoint、keys.p256dh、keys.auth、vapidKeyId、platform；錯誤訊息固定、不回顯輸入。
 * - 防洗寫（顧問 §3.641 a）：同一 subId、同 uid、同金鑰、同 key id 且 lastSeenAt 在 24 小時內 → 不寫、回 ok；
 *   其餘寫入每人每日上限 WEB_PUSH_REGISTER_WRITES_PER_UID_PER_DAY（noop 不計）。
 * - 訂閱數達上限時擠掉 lastSeenAt 最舊的（Q6）。
 * - log 欄位白名單：result、service、platform、subCount（不含 uid、endpoint、金鑰）。
 * - 開通前（WEB_PUSH_REGISTER_QA_ONLY＝true）register 只收有效 QA token（claims 來自 qa-test-mode.js 的
 *   createCustomToken：qa＝true、qaExp 毫秒）；擋在任何 Firestore 讀寫之前。unregister 不擋（見該函式註解）。
 */

const config = require("./web-push-config");
const validate = require("./web-push-validate");
const { taipeiDayKey } = require("./notification-fields");

const LOG_REGISTER = "[webPushSub] register";
const LOG_UNREGISTER = "[webPushSub] unregister";
const LOG_ERROR = "[webPushSub] error";

const toMillis = (value) => {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return Number.NaN;
};

const safeErrorCode = (error) => {
  const raw = error?.code;
  const text = typeof raw === "number" && Number.isInteger(raw) ? String(raw) : (typeof raw === "string" ? raw : "");
  return /^[A-Za-z0-9_-]{1,64}$/.test(text) ? text : "unknown";
};

function createWebPushSubscriptionHandlers({
  db,
  FieldValue,
  HttpsError,
  logger,
  now = () => Date.now(),
  settings = config,
}) {
  const subs = () => db.collection(settings.WEB_PUSH_COLLECTIONS.subscriptions);

  function logLine(label, { result, service = "", platform = "", subCount = null }) {
    logger.info(label, { result, service, platform, subCount });
  }

  function reject(label, code, result, extra = {}) {
    logLine(label, { result, ...extra });
    return new HttpsError(code, code === "failed-precondition" ? "WEB_PUSH_KEY_MISMATCH" : "WEB_PUSH_INVALID_SUBSCRIPTION");
  }

  // 有效 QA token：qa 必須是 true，qaExp（毫秒）必須是數字且晚於現在
  function isActiveQaToken(token) {
    if (!token || token.qa !== true) return false;
    const exp = token.qaExp;
    return typeof exp === "number" && Number.isFinite(exp) && exp > now();
  }

  async function register(request) {
    if (!request || !request.auth || typeof request.auth.uid !== "string" || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }
    // 開通前只收 QA；failed-precondition 讓前端記下並停止重試，訊息與 WEB_PUSH_KEY_MISMATCH 分開、不回顯輸入
    if (settings.WEB_PUSH_REGISTER_QA_ONLY && !isActiveQaToken(request.auth.token)) {
      logLine(LOG_REGISTER, { result: "rejected_not_qa" });
      throw new HttpsError("failed-precondition", "WEB_PUSH_NOT_OPEN");
    }
    const uid = request.auth.uid;
    const data = request.data && typeof request.data === "object" ? request.data : {};
    const platform = validate.normalizePlatform(data.platform);

    const endpointCheck = validate.classifyEndpoint(data.endpoint);
    if (!endpointCheck.ok) throw reject(LOG_REGISTER, "invalid-argument", endpointCheck.reason, { platform });
    const { service } = endpointCheck;
    const keys = validate.validateSubscriptionKeys(data.keys);
    if (!keys) throw reject(LOG_REGISTER, "invalid-argument", "rejected_format", { service, platform });
    // W1 前 key id 為空：一律拒收（fail-closed）
    if (!settings.WEB_PUSH_VAPID_KEY_ID || data.vapidKeyId !== settings.WEB_PUSH_VAPID_KEY_ID) {
      throw reject(LOG_REGISTER, "failed-precondition", "rejected_key_id", { service, platform });
    }

    const endpoint = data.endpoint;
    const subId = validate.subscriptionIdOf(endpoint);
    const nowMs = now();
    const subRef = subs().doc(subId);
    const counterRef = db.collection(settings.WEB_PUSH_COLLECTIONS.daily)
      .doc(`reg_${taipeiDayKey(nowMs)}_${validate.uidHashOf(uid)}`);

    let outcome;
    try {
      outcome = await db.runTransaction(async (tx) => {
        const subSnap = await tx.get(subRef);
        const existing = subSnap.exists ? (subSnap.data() || {}) : null;
        if (
          existing &&
          existing.uid === uid &&
          existing.endpoint === endpoint &&
          existing.keys?.p256dh === keys.p256dh &&
          existing.keys?.auth === keys.auth &&
          existing.vapidKeyId === settings.WEB_PUSH_VAPID_KEY_ID &&
          nowMs - toMillis(existing.lastSeenAt) < settings.WEB_PUSH_REGISTER_REFRESH_SKIP_MS
        ) {
          return { result: "noop", subCount: null };
        }
        const counterSnap = await tx.get(counterRef);
        const writes = counterSnap.exists ? Number(counterSnap.data()?.count) || 0 : 0;
        if (writes >= settings.WEB_PUSH_REGISTER_WRITES_PER_UID_PER_DAY) {
          return { result: "rate_limited", subCount: null };
        }
        const ownedSnap = await tx.get(subs().where("uid", "==", uid));
        const others = ownedSnap.docs
          .filter((doc) => doc.id !== subId)
          .sort((a, b) => (toMillis(a.data()?.lastSeenAt) || 0) - (toMillis(b.data()?.lastSeenAt) || 0));
        const keep = settings.WEB_PUSH_MAX_SUBSCRIPTIONS_PER_UID - 1;
        const evicted = others.length > keep ? others.slice(0, others.length - keep) : [];
        evicted.forEach((doc) => tx.delete(doc.ref));
        tx.set(subRef, {
          schema: 1,
          uid,
          endpoint,
          keys: { p256dh: keys.p256dh, auth: keys.auth },
          vapidKeyId: settings.WEB_PUSH_VAPID_KEY_ID,
          service,
          platform,
          createdAt: existing && existing.createdAt ? existing.createdAt : FieldValue.serverTimestamp(),
          lastSeenAt: FieldValue.serverTimestamp(),
          expireAt: new Date(nowMs + settings.WEB_PUSH_SUBSCRIPTION_RETENTION_MS),
        });
        tx.set(counterRef, {
          count: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
          expireAt: new Date(nowMs + settings.WEB_PUSH_DAILY_RETENTION_MS),
        }, { merge: true });
        let result = existing ? "refreshed" : "created";
        if (evicted.length > 0) result = "evicted_oldest";
        return { result, subCount: others.length - evicted.length + 1 };
      });
    } catch (error) {
      logger.error(LOG_ERROR, { stage: "register_txn", code: safeErrorCode(error) });
      throw new HttpsError("internal", "WEB_PUSH_SUBSCRIPTION_FAILED");
    }

    logLine(LOG_REGISTER, { result: outcome.result, service, platform, subCount: outcome.subCount });
    if (outcome.result === "rate_limited") throw new HttpsError("resource-exhausted", "RATE_LIMITED");
    return { ok: true };
  }

  // 不受 WEB_PUSH_REGISTER_QA_ONLY 限制：只能刪自己的訂閱、不新增任何識別資料；任何人都能撤回比較安全
  async function unregister(request) {
    if (!request || !request.auth || typeof request.auth.uid !== "string" || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }
    const uid = request.auth.uid;
    const endpoint = request.data && typeof request.data === "object" ? request.data.endpoint : undefined;
    // 格式不合或不是本人的：一律回 ok，不洩漏存在與否
    if (typeof endpoint !== "string" || endpoint.length === 0 || endpoint.length > settings.WEB_PUSH_ENDPOINT_MAX_LENGTH) {
      logLine(LOG_UNREGISTER, { result: "noop" });
      return { ok: true };
    }
    const subRef = subs().doc(validate.subscriptionIdOf(endpoint));
    let result;
    try {
      result = await db.runTransaction(async (tx) => {
        const snap = await tx.get(subRef);
        if (!snap.exists || (snap.data() || {}).uid !== uid) return "noop";
        tx.delete(subRef);
        return "deleted";
      });
    } catch (error) {
      logger.error(LOG_ERROR, { stage: "unregister_txn", code: safeErrorCode(error) });
      throw new HttpsError("internal", "WEB_PUSH_SUBSCRIPTION_FAILED");
    }
    logLine(LOG_UNREGISTER, { result });
    return { ok: true };
  }

  return { register, unregister };
}

module.exports = { createWebPushSubscriptionHandlers };
