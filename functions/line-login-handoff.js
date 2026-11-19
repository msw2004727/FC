"use strict";

const crypto = require("crypto");

const HANDOFF_COLLECTION = "loginHandoffs";
const HANDOFF_TTL_MS = 5 * 60 * 1000;
const CLAIM_REPEAT_WINDOW_MS = 60 * 1000;
const RELAY_LIMIT_PER_MINUTE = 10;
const CLAIM_LIMIT_PER_MINUTE = 30;
const ALLOWED_REDIRECT_ORIGINS = Object.freeze([
  "https://toosterx.com",
  "https://www.toosterx.com",
  "https://next.toosterx.com",
]);
const LINE_LOGIN_HANDOFF_OPTIONS = Object.freeze({
  region: "asia-east1",
  timeoutSeconds: 10,
  memory: "256MiB",
  maxInstances: 3,
});

const HEX_64_PATTERN = /^[0-9a-f]{64}$/;
const CODE_PATTERN = /^[A-Za-z0-9._~-]{1,256}$/;
const CLIENT_ID_PATTERN = /^\d{1,20}$/;
const PICK_PATTERN = /^\d{2}$/;
const RELAY_KEYS = Object.freeze(["op", "handoffId", "code", "liffClientId", "liffRedirectUri", "pick"]);
const CLAIM_KEYS = Object.freeze(["op", "handoffSecret"]);

function isString(value) {
  return typeof value === "string";
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function hasExactKeys(data, allowedKeys) {
  const keys = Object.keys(data);
  if (keys.length !== allowedKeys.length) return false;
  return allowedKeys.every(key => Object.prototype.hasOwnProperty.call(data, key));
}

function isAlreadyExistsError(error) {
  return error?.code === 6 || error?.code === "already-exists";
}

function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (typeof value === "number") return value;
  return NaN;
}

function safeErrorCode(error) {
  const code = error?.code;
  return typeof code === "string" || typeof code === "number" ? code : undefined;
}

function getRequestOp(request) {
  const data = request?.data;
  return isPlainObject(data) && (data.op === "relay" || data.op === "claim")
    ? data.op
    : "unknown";
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(String(text), "utf8").digest("hex");
}

function pairingNumber(handoffId) {
  const hash = crypto.createHash("sha256").update(`fcb-pair:${handoffId}`, "utf8").digest();
  return 10 + (hash.readUInt32BE(0) % 90);
}

function pairingOptions(handoffId) {
  const hash = crypto.createHash("sha256").update(`fcb-pair:${handoffId}`, "utf8").digest();
  const correct = 10 + (hash.readUInt32BE(0) % 90);
  const decoys = [];

  for (let i = 4; i < hash.length && decoys.length < 2; i += 1) {
    const value = 10 + (hash[i] % 90);
    if (value !== correct && !decoys.includes(value)) {
      decoys.push(value);
    }
  }

  for (let value = 10; decoys.length < 2 && value <= 99; value += 1) {
    if (value !== correct && !decoys.includes(value)) {
      decoys.push(value);
    }
  }

  const position = hash[31] % 3;
  const options = decoys.slice();
  options.splice(position, 0, correct);
  return options;
}

function getForwardedForHeader(rawRequest) {
  let header = rawRequest?.headers?.["x-forwarded-for"];
  if (Array.isArray(header)) header = header[0];
  return header;
}

function splitForwardedFor(header) {
  if (typeof header === "undefined" || header === null) return [];
  return String(header)
    .split(",")
    .map(part => part.trim())
    .filter(Boolean);
}

function getPlatformClientIp(rawRequest) {
  const parts = splitForwardedFor(getForwardedForHeader(rawRequest));
  if (parts.length > 0) return parts[parts.length - 1];
  if (typeof getForwardedForHeader(rawRequest) !== "undefined" && getForwardedForHeader(rawRequest) !== null) {
    return "";
  }
  return String(rawRequest?.socket?.remoteAddress || "");
}

function countForwardedHops(rawRequest) {
  return splitForwardedFor(getForwardedForHeader(rawRequest)).length;
}

function isAllowedRedirectUri(value) {
  if (!isString(value) || value.length < 1 || value.length > 2048) return false;
  return ALLOWED_REDIRECT_ORIGINS.some(origin => value.startsWith(`${origin}/`));
}

function createRateLimiter({ limit, windowMs = 60000, maxKeys = 5000, now = Date.now }) {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 0) {
    throw new TypeError("limit is required");
  }
  const entries = new Map();

  function cleanup(time) {
    if (entries.size <= maxKeys) return;
    for (const [key, entry] of entries) {
      if (time - entry.start >= windowMs) {
        entries.delete(key);
      }
    }
    while (entries.size > maxKeys) {
      const oldestKey = entries.keys().next().value;
      entries.delete(oldestKey);
    }
  }

  function hit(key) {
    const time = now();
    const existing = entries.get(key);

    if (!existing || time - existing.start >= windowMs) {
      if (limit > 0) {
        entries.set(key, { start: time, count: 1 });
        cleanup(time);
        return true;
      }
      cleanup(time);
      return false;
    }

    if (existing.count < limit) {
      existing.count += 1;
      cleanup(time);
      return true;
    }

    cleanup(time);
    return false;
  }

  function size() {
    return entries.size;
  }

  return { hit, size };
}

function createLineLoginHandoffHandler({
  db,
  HttpsError,
  isLocalRequest = () => false,
  now = Date.now,
  logger = console,
  relayLimiter,
  claimLimiter,
}) {
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
    throw new TypeError("Firestore transaction support is required");
  }
  if (typeof HttpsError !== "function") {
    throw new TypeError("HttpsError is required");
  }

  const relayBucket = relayLimiter || createRateLimiter({ limit: RELAY_LIMIT_PER_MINUTE });
  const claimBucket = claimLimiter || createRateLimiter({ limit: CLAIM_LIMIT_PER_MINUTE });

  function logInfo(op, outcome, hops) {
    if (logger && typeof logger.info === "function") {
      logger.info("[lineLoginHandoff]", { op, outcome, hops });
    }
  }

  function logStorageError(op, stage, error) {
    if (logger && typeof logger.error === "function") {
      logger.error("[lineLoginHandoff] storage error", {
        op,
        stage,
        errorCode: safeErrorCode(error),
      });
    }
  }

  return async function lineLoginHandoffHandler(request) {
    const hops = countForwardedHops(request?.rawRequest);
    const op = getRequestOp(request);
    let outcome = "error";

    try {
      if (isLocalRequest(request)) {
        outcome = "local_blocked";
        throw new HttpsError("failed-precondition", "LOCAL_DEVELOPMENT_ORIGIN_NOT_ALLOWED");
      }

      const data = request?.data;
      if (!isPlainObject(data) || (data.op !== "relay" && data.op !== "claim")) {
        outcome = "invalid";
        throw new HttpsError("invalid-argument", "INVALID_REQUEST");
      }

      const isRelay = data.op === "relay";
      const allowedKeys = isRelay ? RELAY_KEYS : CLAIM_KEYS;
      if (!hasExactKeys(data, allowedKeys)) {
        outcome = "invalid";
        throw new HttpsError("invalid-argument", "INVALID_REQUEST");
      }

      if (isRelay) {
        const valid = isString(data.handoffId) && HEX_64_PATTERN.test(data.handoffId)
          && isString(data.code) && CODE_PATTERN.test(data.code)
          && isString(data.liffClientId) && CLIENT_ID_PATTERN.test(data.liffClientId)
          && isString(data.liffRedirectUri) && isAllowedRedirectUri(data.liffRedirectUri)
          && isString(data.pick) && PICK_PATTERN.test(data.pick);
        if (!valid) {
          outcome = "invalid";
          throw new HttpsError("invalid-argument", "INVALID_REQUEST");
        }
      } else {
        const valid = isString(data.handoffSecret) && HEX_64_PATTERN.test(data.handoffSecret);
        if (!valid) {
          outcome = "invalid";
          throw new HttpsError("invalid-argument", "INVALID_REQUEST");
        }
      }

      const ip = getPlatformClientIp(request.rawRequest);
      const limiter = isRelay ? relayBucket : claimBucket;
      if (!limiter.hit(ip)) {
        outcome = "throttled";
        throw new HttpsError("resource-exhausted", "TRY_LATER");
      }

      if (isRelay) {
        const { handoffId, code, liffClientId, liffRedirectUri, pick } = data;
        const expected = pairingNumber(handoffId);
        const ref = db.collection(HANDOFF_COLLECTION).doc(handoffId);
        const nowMs = now();

        if (Number(pick) !== expected) {
          try {
            await ref.create({
              voided: true,
              createdAt: new Date(nowMs),
              expiresAt: new Date(nowMs + HANDOFF_TTL_MS),
            });
          } catch (error) {
            if (!isAlreadyExistsError(error)) {
              outcome = "error";
              logStorageError(op, "relay_mismatch_create", error);
              throw new HttpsError("unavailable", "TRY_LATER");
            }
          }
          outcome = "relay_mismatch";
          return { ok: false, reason: "mismatch" };
        }

        try {
          await ref.create({
            code,
            liffClientId,
            liffRedirectUri,
            createdAt: new Date(nowMs),
            expiresAt: new Date(nowMs + HANDOFF_TTL_MS),
          });
        } catch (error) {
          if (isAlreadyExistsError(error)) {
            outcome = "relay_rejected";
            throw new HttpsError("failed-precondition", "HANDOFF_UNAVAILABLE");
          }
          outcome = "error";
          logStorageError(op, "relay_create", error);
          throw new HttpsError("unavailable", "TRY_LATER");
        }

        outcome = "relay_ok";
        return { ok: true };
      }

      const handoffId = sha256Hex(data.handoffSecret);
      const ref = db.collection(HANDOFF_COLLECTION).doc(handoffId);
      const nowMs = now();
      let transactionResult;

      try {
        transactionResult = await db.runTransaction(async transaction => {
          const snapshot = await transaction.get(ref);
          if (!snapshot.exists) {
            return { kind: "not_found" };
          }

          const handoff = snapshot.data() || {};
          const expiresMs = toMillis(handoff.expiresAt);
          if (handoff.voided === true || !Number.isFinite(expiresMs) || expiresMs <= nowMs) {
            transaction.delete(ref);
            return { kind: "not_found" };
          }

          const payload = {
            code: handoff.code,
            liffClientId: handoff.liffClientId,
            liffRedirectUri: handoff.liffRedirectUri,
          };

          if (typeof handoff.claimedAt === "undefined") {
            transaction.update(ref, { claimedAt: new Date(nowMs) });
            return { kind: "ok", payload, repeat: false };
          }

          const claimedMs = toMillis(handoff.claimedAt);
          if (nowMs - claimedMs <= CLAIM_REPEAT_WINDOW_MS) {
            return { kind: "ok", payload, repeat: true };
          }

          transaction.delete(ref);
          return { kind: "not_found" };
        });
      } catch (error) {
        outcome = "error";
        logStorageError(op, "claim_transaction", error);
        throw new HttpsError("unavailable", "TRY_LATER");
      }

      if (transactionResult.kind === "not_found") {
        outcome = "claim_not_found";
        throw new HttpsError("not-found", "HANDOFF_NOT_FOUND");
      }

      outcome = transactionResult.repeat ? "claim_repeat" : "claim_ok";
      return transactionResult.payload;
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      outcome = "error";
      logStorageError(op, "handler", error);
      throw new HttpsError("unavailable", "TRY_LATER");
    } finally {
      logInfo(op, outcome, hops);
    }
  };
}

function createLineLoginHandoffCallable({ onCall, HttpsError, db, isLocalRequest, logger }) {
  if (typeof onCall !== "function") {
    throw new TypeError("onCall is required");
  }
  return onCall(
    LINE_LOGIN_HANDOFF_OPTIONS,
    createLineLoginHandoffHandler({ db, HttpsError, isLocalRequest, logger }),
  );
}

module.exports = {
  HANDOFF_COLLECTION,
  HANDOFF_TTL_MS,
  CLAIM_REPEAT_WINDOW_MS,
  RELAY_LIMIT_PER_MINUTE,
  CLAIM_LIMIT_PER_MINUTE,
  ALLOWED_REDIRECT_ORIGINS,
  sha256Hex,
  pairingNumber,
  pairingOptions,
  getPlatformClientIp,
  countForwardedHops,
  isAllowedRedirectUri,
  createRateLimiter,
  createLineLoginHandoffHandler,
  createLineLoginHandoffCallable,
  LINE_LOGIN_HANDOFF_OPTIONS,
};
