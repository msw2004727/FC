"use strict";

/**
 * 網頁推播（W2-B）發送函式 sendWebPushFromQueue 的處理器（webPushQueue/{queueId} onCreate）。
 * - 唯一持有 WEB_PUSH_VAPID_PRIVATE_KEY 的函式；web-push 只在真正要送時才 lazy require（不在模組頂層）。
 * - 停發：控制文件 webPushControl/sender.sendEnabled !== true（缺文件、讀不到都算）→ 不送；另有 WEB_PUSH_SENDER_ENABLED（E3）。
 * - 至少一次投遞的去重：交易內 pending → claimed 才送；同一份文件第二次觸發只會 skipped:already_claimed。不重試。
 * - 自己發 HTTPS：不跟隨重新導向（3xx 視為失敗）、回應本文讀掉丟棄、不進 log；每筆逾時 10 秒。
 * - 送前再驗一次 endpoint 主機白名單（儲存端已驗，這裡是 SSRF 第二道）。
 * - log 欄位白名單（每則一行 [webPush] processed）：kind、outcome、reason、subs、sent、gone、failed、keyMismatch、codes、services、latencyMs；
 *   錯誤 log [webPush] error 只帶 stage 與錯誤 code／name。不含 uid、endpoint、活動代號、標題、內文。
 * - LINE 增量 0：本檔沒有任何 LINE 呼叫。
 */

const config = require("./web-push-config");
const validate = require("./web-push-validate");
const { taipeiDayKey } = require("./notification-fields");

const LOG_PROCESSED = "[webPush] processed";
const LOG_ERROR = "[webPush] error";

const toMillis = (value) => {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return Number.NaN;
};

const safeToken = (raw) => {
  const text = typeof raw === "number" && Number.isInteger(raw) ? String(raw) : (typeof raw === "string" ? raw : "");
  return /^[A-Za-z0-9_-]{1,64}$/.test(text) ? text : "unknown";
};

const loadWebPushDefault = () => require("web-push");

/**
 * 由 VAPID 私鑰（32 位元組，base64url）推出公鑰（未壓縮點 0x04||x||y，base64url）。格式不對回空字串、不丟錯。
 * 發送前用它自我檢查：Secret Manager 的私鑰必須對得上程式常數的公鑰，否則停發（W1 結案條件 a）。
 */
function vapidPublicKeyOf(privateKey) {
  try {
    // 先擋 web-push 也不收的字元（空白、換行、=）：Buffer 的 base64url 解碼會略過它們
    const text = String(privateKey || "");
    if (!/^[A-Za-z0-9_-]{43}$/.test(text)) return "";
    const raw = Buffer.from(text, "base64url");
    if (raw.length !== 32) return "";
    const ecdh = require("crypto").createECDH("prime256v1");
    ecdh.setPrivateKey(raw);
    return ecdh.getPublicKey().toString("base64url");
  } catch {
    return "";
  }
}

/**
 * 送一筆推播請求：不跟隨重新導向、不保留回應本文。回 { statusCode }（沒有回應時 statusCode 為 0、帶 errorCode）。
 * requestImpl 預設 https.request；測試可換成 http.request 對本機伺服器實測。
 */
function postPushRequest(details, { timeoutMs, requestImpl }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let req;
    try {
      req = requestImpl(details.endpoint, { method: "POST", headers: details.headers, timeout: timeoutMs }, (res) => {
        // 回應本文一律丟棄（可能含推播服務的錯誤說明或 endpoint 片段）
        res.on("error", () => {});
        res.resume();
        finish({ statusCode: Number(res.statusCode) || 0 });
      });
    } catch (error) {
      finish({ statusCode: 0, errorCode: safeToken(error?.code) });
      return;
    }
    req.on("timeout", () => {
      req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }));
    });
    req.on("error", (error) => finish({ statusCode: 0, errorCode: safeToken(error?.code) }));
    if (details.body) req.write(details.body);
    req.end();
  });
}

function createSendWebPushFromQueueHandler({
  db,
  FieldValue,
  logger,
  getPrivateKey,
  now = () => Date.now(),
  settings = config,
  loadWebPush = loadWebPushDefault,
  requestImpl = null,
}) {
  const collections = settings.WEB_PUSH_COLLECTIONS;
  // 同一個執行個體只對同一把私鑰算一次（私鑰換版時重算）
  let checkedPrivateKey = null;
  let keyPairMatches = false;

  function emptyCounters() {
    return { subs: 0, sent: 0, gone: 0, failed: 0, keyMismatch: 0, codes: {}, services: {} };
  }

  function logProcessed(kind, outcome, reason, counters, createdAtMs) {
    logger.info(LOG_PROCESSED, {
      kind,
      outcome,
      reason,
      subs: counters.subs,
      sent: counters.sent,
      gone: counters.gone,
      failed: counters.failed,
      keyMismatch: counters.keyMismatch,
      codes: counters.codes,
      services: counters.services,
      latencyMs: Number.isFinite(createdAtMs) ? Math.max(0, now() - createdAtMs) : 0,
    });
  }

  function logError(stage, error) {
    logger.error(LOG_ERROR, { stage, code: safeToken(error?.code), name: safeToken(error?.name) });
  }

  async function readSendEnabled() {
    try {
      const snap = await db.collection(collections.control).doc(settings.WEB_PUSH_CONTROL_DOC_ID).get();
      return snap.exists === true && (snap.data() || {}).sendEnabled === true;
    } catch (error) {
      logError("control_read", error);
      return false;
    }
  }

  async function process(event) {
    const snap = event && event.data;
    const data = snap && typeof snap.data === "function" ? (snap.data() || {}) : {};
    const kind = settings.WEB_PUSH_KINDS.includes(data.kind) ? data.kind : "";
    const counters = emptyCounters();
    const createdAtMs = toMillis(data.createdAt);
    const skip = (reason) => logProcessed(kind, "skipped", reason, counters, createdAtMs);

    // 1. 文件形狀
    if (
      !snap || data.schema !== 1 || data.source !== "registration" || !kind ||
      typeof data.recipientUid !== "string" || !data.recipientUid ||
      typeof data.title !== "string" || !data.title || typeof data.body !== "string" || !data.body ||
      !Number.isFinite(createdAtMs)
    ) {
      skip("bad_doc");
      return;
    }
    // 2. 太舊不送（延遲送達或停發後恢復時不補送）
    if (now() - createdAtMs > settings.WEB_PUSH_STALE_MS) {
      skip("stale");
      return;
    }
    // 3. 兩把鑰匙：程式常數（E3）＋控制文件（E1，缺文件或讀失敗＝停發）
    if (settings.WEB_PUSH_SENDER_ENABLED !== true || !(await readSendEnabled())) {
      skip("disabled");
      return;
    }
    const privateKey = typeof getPrivateKey === "function" ? String(getPrivateKey() || "") : "";
    if (!privateKey || !settings.WEB_PUSH_VAPID_PUBLIC_KEY || !settings.WEB_PUSH_VAPID_KEY_ID) {
      logError("vapid_missing", { code: "VAPID_NOT_CONFIGURED", name: "ConfigError" });
      skip("disabled");
      return;
    }
    if (checkedPrivateKey !== privateKey) {
      checkedPrivateKey = privateKey;
      keyPairMatches = vapidPublicKeyOf(privateKey) === settings.WEB_PUSH_VAPID_PUBLIC_KEY;
    }
    if (!keyPairMatches) {
      logError("vapid_mismatch", { code: "VAPID_KEY_MISMATCH", name: "ConfigError" });
      skip("disabled");
      return;
    }
    // 4. 收件者的訂閱（只取 key id 相符的；不符的不送不刪，等前端重訂）
    const subsSnap = await db.collection(collections.subscriptions).where("uid", "==", data.recipientUid).get();
    const sendable = [];
    subsSnap.docs.forEach((doc) => {
      const sub = doc.data() || {};
      if (sub.vapidKeyId !== settings.WEB_PUSH_VAPID_KEY_ID) {
        counters.keyMismatch += 1;
        return;
      }
      sendable.push({ ref: doc.ref, sub });
    });
    counters.subs = sendable.length;
    if (sendable.length === 0) {
      skip("no_sub");
      return;
    }
    // 5. 交易：認領＋每日計數
    const queueRef = snap.ref;
    const nowMs = now();
    const dailyRef = db.collection(collections.daily).doc(`${taipeiDayKey(nowMs)}_${validate.uidHashOf(data.recipientUid)}`);
    const claim = await db.runTransaction(async (tx) => {
      const [queueSnap, dailySnap] = await tx.getAll(queueRef, dailyRef);
      if (!queueSnap.exists || (queueSnap.data() || {}).status !== "pending") return "already_claimed";
      const count = dailySnap.exists ? Number(dailySnap.data()?.count) || 0 : 0;
      tx.update(queueRef, { status: "claimed", claimedAt: FieldValue.serverTimestamp() });
      if (count >= settings.WEB_PUSH_DAILY_LIMIT_PER_UID) return "daily_limit";
      tx.set(dailyRef, {
        count: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
        expireAt: new Date(nowMs + settings.WEB_PUSH_DAILY_RETENTION_MS),
      }, { merge: true });
      return "claimed";
    });
    if (claim !== "claimed") {
      skip(claim);
      return;
    }
    // 6. 送出（lazy require web-push，只用它組 VAPID 與加密，HTTPS 自己發）
    const webPush = loadWebPush();
    const transport = requestImpl || require("https").request;
    const payload = validate.buildPushPayload({ title: data.title, body: data.body, url: settings.WEB_PUSH_CLICK_URL });
    const outcomes = await Promise.allSettled(sendable.map(async ({ ref, sub }) => {
      const check = validate.classifyEndpoint(sub.endpoint);
      if (!check.ok) return { ref, statusCode: 0, service: "invalid" };
      const details = webPush.generateRequestDetails(
        { endpoint: sub.endpoint, keys: { p256dh: sub.keys?.p256dh, auth: sub.keys?.auth } },
        payload,
        {
          vapidDetails: {
            subject: settings.WEB_PUSH_VAPID_SUBJECT,
            publicKey: settings.WEB_PUSH_VAPID_PUBLIC_KEY,
            privateKey,
          },
          TTL: settings.WEB_PUSH_TTL_SECONDS,
          urgency: "normal",
          timeout: settings.WEB_PUSH_REQUEST_TIMEOUT_MS,
        }
      );
      const response = await postPushRequest(details, { timeoutMs: settings.WEB_PUSH_REQUEST_TIMEOUT_MS, requestImpl: transport });
      return { ref, statusCode: response.statusCode, service: check.service };
    }));
    // 7. 回應碼：2xx 送達；404／410 刪訂閱；其他（含 3xx 重新導向、逾時）失敗，不重試、不刪
    const deletions = [];
    outcomes.forEach((outcome) => {
      if (outcome.status !== "fulfilled") {
        counters.failed += 1;
        counters.codes["0"] = (counters.codes["0"] || 0) + 1;
        logError("send", outcome.reason);
        return;
      }
      const { ref, statusCode, service } = outcome.value;
      const codeKey = String(statusCode);
      counters.codes[codeKey] = (counters.codes[codeKey] || 0) + 1;
      counters.services[service] = (counters.services[service] || 0) + 1;
      if (statusCode >= 200 && statusCode <= 299) {
        counters.sent += 1;
      } else if (statusCode === 404 || statusCode === 410) {
        counters.gone += 1;
        deletions.push(ref.delete().catch((error) => logError("delete_gone", error)));
      } else {
        counters.failed += 1;
      }
    });
    await Promise.all(deletions);
    let outcome = "failed";
    if (counters.sent === sendable.length) outcome = "sent";
    else if (counters.sent > 0) outcome = "partial";
    logProcessed(kind, outcome, "", counters, createdAtMs);
  }

  // 8. 任何未預期例外：記 ERROR 後正常結束（retry:false，也不讓觸發器進入重試語意）
  return async function sendWebPushFromQueue(event) {
    try {
      await process(event);
    } catch (error) {
      logError("unexpected", error);
    }
  };
}

module.exports = { createSendWebPushFromQueueHandler, postPushRequest, vapidPublicKeyOf };
