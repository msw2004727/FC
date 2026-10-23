"use strict";

// ASSUMPTION: require 限制針對外部依賴；沿用附件的本地 core 匯入。
const {
  QA_UID_RE,
  QA_DISPLAY_NAME_PREFIX,
  QA_ALLOWED_ROLES,
  QA_PUBLIC_ERROR_MESSAGE,
  QA_CONFIG_COLLECTION,
  QA_CONFIG_DOC_ID,
  QA_THROTTLE_COLLECTION,
  QA_PERSONA_KEY_RE,
  QA_INPUT_PASSWORD_MAX_LENGTH,
  QA_CLIENT_IP_XFF_FROM_RIGHT,
  QA_RESERVATION_TTL_MS,
  QA_THROTTLE_TTL_MS,
  parseQaSecret,
  matchQaPassword,
  normalizeQaConfig,
  resolveQaClientIp,
  hashQaIp,
  resolveQaPersona,
} = require("./qa-test-mode-core");

const FAILURE_REASONS = new Set([
  "qa_password_mismatch",
  "qa_password_expired",
  "qa_persona_unknown",
  "qa_persona_not_allowed",
]);

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function validWindow(data, limits, time) {
  return Number.isFinite(data.windowStartMs) &&
    time - data.windowStartMs < limits.windowSec * 1000;
}

function safeCount(data) {
  return Number.isSafeInteger(data.count) && data.count >= 0 ? data.count : 0;
}

function cycleState(data, time) {
  if (Number.isFinite(data.lockedUntilMs) &&
      data.lockedUntilMs > 0 && data.lockedUntilMs <= time) {
    // 鎖定週期結束即可重新計數，不必等待較長的視窗到期。
    return { ...data, count: 0, windowStartMs: time, lockedUntilMs: 0 };
  }
  return data;
}

function activeReservations(data, time) {
  return Array.isArray(data.reservations)
    ? data.reservations.filter((item) => Number.isFinite(item) && item > time)
    : [];
}

function createIssueQaTestTokenHandler({
  HttpsError, db, authAdmin, secret, writeAuditEntry, writeDedupedAuditEntry,
  logger = console,
  now = () => Date.now(),
}) {
  return async (request) => {
    let ipHash = "";
    let agentId;
    let requestedPersona;
    let config;
    let nowMs;
    let deniedError;
    let token;
    let reservedTargets = [];
    let settlementStarted = false;

    function log(reasonCode) {
      try {
        // 不傳原始例外，避免 SDK 錯誤夾帶憑證或請求內容。
        logger.warn("[issueQaTestToken] denied", {
          reasonCode, ipHash, agentId,
        });
      } catch {
        // 記錄器故障不改變授權結果。
      }
    }

    function throttleTargets() {
      const collection = db.collection(QA_THROTTLE_COLLECTION);
      const targets = [];
      if (ipHash) {
        targets.push({
          ref: collection.doc(`ip_${ipHash}`),
          limits: config.throttle.perIp,
        });
      }
      targets.push({
        ref: collection.doc("global"),
        limits: config.throttle.global,
      });
      return targets;
    }

    async function readThrottle(transaction, targets) {
      const rows = [];
      // Firestore 交易要求所有讀取在任何寫入之前完成。
      for (const target of targets) {
        const snapshot = await transaction.get(target.ref);
        const raw = snapshot.exists ? snapshot.data() : null;
        rows.push({ ...target, data: isPlainObject(raw) ? raw : {} });
      }
      return rows;
    }

    async function reserveAttempt() {
      const targets = throttleTargets();
      const result = await db.runTransaction(async (transaction) => {
        const rows = await readThrottle(transaction, targets);
        // 讀取完成後取時間，每次重試都使用新的交易時間。
        const txNowMs = now();
        if (!Number.isFinite(txNowMs)) throw new Error("Invalid clock");
        const writes = [];
        const reservationToken = txNowMs + QA_RESERVATION_TTL_MS;
        for (const { ref, limits, data } of rows) {
          const state = cycleState(data, txNowMs);
          if (state.lockedUntilMs > txNowMs) return { throttled: true };
          const windowIsValid = validWindow(state, limits, txNowMs);
          const count = windowIsValid ? safeCount(state) : 0;
          const reservations = activeReservations(state, txNowMs);
          if (count + reservations.length >= limits.maxFailures) {
            return { throttled: true };
          }
          writes.push({
            ref,
            data: {
              count,
              windowStartMs: windowIsValid ? state.windowStartMs : txNowMs,
              lockedUntilMs: Number.isFinite(state.lockedUntilMs)
                ? state.lockedUntilMs : 0,
              reservations: [...reservations, reservationToken],
              updatedAtMs: txNowMs,
              expiresAt: new Date(txNowMs + QA_THROTTLE_TTL_MS),
            },
          });
        }
        // 任一目標拒絕時，不得留下另一份文件的預占。
        for (const write of writes) transaction.set(write.ref, write.data);
        return { throttled: false, token: reservationToken };
      });
      if (!result.throttled) {
        reservedTargets = targets;
        token = result.token;
      }
      return result;
    }

    async function settleAttempt(outcome) {
      if (token === undefined || settlementStarted) return;
      // 交易可重試；整個請求只能啟動一次結算，失敗後交由預占 TTL 回收。
      settlementStarted = true;
      try {
        await db.runTransaction(async (transaction) => {
          const rows = await readThrottle(transaction, reservedTargets);
          const settledAtMs = now();
          if (!Number.isFinite(settledAtMs)) throw new Error("Invalid clock");
          const writes = [];
          for (const { ref, limits, data } of rows) {
            const state = cycleState(data, settledAtMs);
            const reservations = Array.isArray(state.reservations)
              ? [...state.reservations] : [];
            const index = reservations.indexOf(token);
            // 同毫秒請求可能同 token，只能移除一項。
            if (index !== -1) reservations.splice(index, 1);
            const patch = {
              reservations: reservations.filter((item) =>
                Number.isFinite(item) && item > settledAtMs
              ),
            };
            const locked = state.lockedUntilMs > settledAtMs;
            if (outcome === "failure" && !locked) {
              const windowIsValid = validWindow(state, limits, settledAtMs);
              const previousCount = windowIsValid ? safeCount(state) : 0;
              patch.count = Math.min(previousCount + 1, Number.MAX_SAFE_INTEGER);
              patch.windowStartMs = windowIsValid
                ? state.windowStartMs : settledAtMs;
              patch.lockedUntilMs = patch.count >= limits.maxFailures
                ? settledAtMs + limits.lockSec * 1000 : 0;
              patch.updatedAtMs = settledAtMs;
              patch.expiresAt = new Date(settledAtMs + QA_THROTTLE_TTL_MS);
            }
            // ASSUMPTION: 依 B 保證 success／neutral 不改計數欄位；
            // D 的到期新週期由下次 reserve 或本次 failure 寫入。
            writes.push({ ref, patch });
          }
          for (const { ref, patch } of writes) {
            transaction.set(ref, patch, { merge: true });
          }
        });
      } catch {
        log("qa_throttle_write_failed");
      }
    }

    async function deny(reasonCode, code) {
      await settleAttempt(FAILURE_REASONS.has(reasonCode) ? "failure" : "neutral");
      const meta = { reasonCode, ipHash };
      if (agentId !== undefined) meta.qaAgentId = agentId;
      if (requestedPersona !== undefined) meta.qaPersona = requestedPersona;
      try {
        await writeDedupedAuditEntry({
          action: "login_failure",
          actorRole: "user",
          targetType: "system",
          targetLabel: "QA login",
          result: "failure",
          source: "cloud_function",
          meta,
        }, `qa_${reasonCode}_${ipHash || "noip"}`);
      } catch {
        log("qa_failure_audit_failed");
      }
      log(reasonCode);
      deniedError = new HttpsError(code, QA_PUBLIC_ERROR_MESSAGE);
      throw deniedError;
    }

    try {
      ipHash = hashQaIp(resolveQaClientIp(request?.rawRequest));
      nowMs = now();
      const data = request?.data;
      // 僅讓格式已驗證的 persona 進入 audit。
      if (isPlainObject(data) && typeof data.persona === "string" &&
          QA_PERSONA_KEY_RE.test(data.persona)) {
        requestedPersona = data.persona;
      }
      if (!isPlainObject(data) || typeof data.password !== "string" ||
          data.password.length < 1 ||
          data.password.length > QA_INPUT_PASSWORD_MAX_LENGTH ||
          (data.persona !== undefined &&
            (typeof data.persona !== "string" ||
              !QA_PERSONA_KEY_RE.test(data.persona)))) {
        return await deny("qa_bad_request", "invalid-argument");
      }
      if (!Number.isFinite(nowMs)) {
        return await deny("qa_clock_invalid", "internal");
      }

      try {
        const snapshot = await db.collection(QA_CONFIG_COLLECTION)
          .doc(QA_CONFIG_DOC_ID).get();
        config = normalizeQaConfig(snapshot.exists ? snapshot.data() : null);
      } catch {
        return await deny("qa_config_read_failed", "internal");
      }
      if (config.clientIpXffFromRight !== QA_CLIENT_IP_XFF_FROM_RIGHT) {
        ipHash = hashQaIp(resolveQaClientIp(request?.rawRequest, {
          xffFromRight: config.clientIpXffFromRight,
        }));
      }
      if (config.enabled !== true) {
        return await deny("qa_disabled", "permission-denied");
      }

      let reservation;
      try {
        reservation = await reserveAttempt();
      } catch {
        return await deny("qa_throttle_read_failed", "internal");
      }
      if (reservation.throttled) {
        return await deny("qa_throttled", "resource-exhausted");
      }

      let rawSecret;
      try {
        rawSecret = secret.value();
      } catch {
        rawSecret = undefined;
      }
      const parsed = parseQaSecret(rawSecret, {
        nowMs, maxFutureHours: config.maxFutureHours,
      });
      if (parsed.invalidCount > 0) log("qa_secret_invalid_entries");
      if (parsed.entries.length === 0) {
        return await deny("qa_secret_invalid", "permission-denied");
      }

      const entry = matchQaPassword(parsed.entries, data.password);
      if (!entry) {
        return await deny("qa_password_mismatch", "permission-denied");
      }
      agentId = entry.agentId;
      if (entry.expiresAtMs <= nowMs) {
        return await deny("qa_password_expired", "permission-denied");
      }
      const resolved = resolveQaPersona({
        config, agent: entry, requestedPersona,
      });
      if (!resolved.ok) {
        return await deny(resolved.reasonCode, "permission-denied");
      }
      const { persona, personaKey, teamId } = resolved;

      let user;
      try {
        const snapshot = await db.collection("users").doc(persona.uid).get();
        user = snapshot.exists ? snapshot.data() : null;
      } catch {
        return await deny("qa_user_read_failed", "internal");
      }
      if (!isPlainObject(user) || user.uid !== persona.uid ||
          typeof user.displayName !== "string" ||
          !user.displayName.startsWith(QA_DISPLAY_NAME_PREFIX) ||
          user.role !== persona.role) {
        return await deny("qa_persona_unprovisioned", "permission-denied");
      }

      // 簽發邊界再次檢查不變量。
      if (typeof persona.uid !== "string" || !QA_UID_RE.test(persona.uid) ||
          !QA_ALLOWED_ROLES.has(persona.role) ||
          typeof persona.displayName !== "string" ||
          !persona.displayName.startsWith(QA_DISPLAY_NAME_PREFIX)) {
        return await deny("qa_persona_unknown", "permission-denied");
      }
      const qaExpMs = Math.min(
        entry.expiresAtMs, nowMs + config.sessionCapHours * 3600000
      );
      let customToken;
      try {
        customToken = await authAdmin.createCustomToken(persona.uid, {
          qa: true,
          qaTeamId: teamId,
          qaExp: qaExpMs,
          qaAgent: entry.agentId,
          qaPersona: personaKey,
        });
      } catch {
        return await deny("qa_token_sign_failed", "internal");
      }
      if (typeof customToken !== "string" || !customToken) {
        return await deny("qa_token_sign_failed", "internal");
      }

      try {
        await writeAuditEntry({
          action: "login_success",
          actorUid: persona.uid,
          actorName: persona.displayName,
          actorRole: persona.role,
          targetType: "system",
          targetLabel: "QA login",
          result: "success",
          source: "cloud_function",
          meta: {
            reasonCode: "qa_success",
            qaAgentId: entry.agentId,
            qaPersona: personaKey,
            ipHash,
          },
        });
      } catch {
        return await deny("qa_success_audit_failed", "internal");
      }
      await settleAttempt("success");
      return {
        customToken,
        agentId: entry.agentId,
        persona: {
          key: personaKey,
          displayName: persona.displayName,
          role: persona.role,
        },
        qaExp: qaExpMs,
      };
    } catch (error) {
      if (error === deniedError) throw error;
      return await deny("qa_internal_error", "internal");
    }
  };
}

function createIssueQaTestTokenCallable({ onCall, secret, ...dependencies }) {
  if (typeof onCall !== "function") throw new TypeError("onCall is required");
  if (!secret || typeof secret.value !== "function") {
    throw new TypeError("secret is required");
  }
  return onCall(
    { region: "asia-east1", timeoutSeconds: 15, secrets: [secret] },
    createIssueQaTestTokenHandler({ ...dependencies, secret }),
  );
}

module.exports = {
  QA_RESERVATION_TTL_MS,
  createIssueQaTestTokenHandler,
  createIssueQaTestTokenCallable,
};
