"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const {
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
} = require("../../functions/line-login-handoff");

class FakeHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function clone(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(clone);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
}

const WRITE_METHODS = ["create", "set", "update", "delete"];

function createMemoryFirestore() {
  const stores = new Map();
  const operations = [];
  let transactionQueue = Promise.resolve();

  function getStore(collectionName) {
    if (!stores.has(collectionName)) stores.set(collectionName, new Map());
    return stores.get(collectionName);
  }

  function makeRef(collectionName, id) {
    return {
      collectionName,
      id,
      create: async data => {
        operations.push({ method: "create", collectionName, id, data: clone(data) });
        const store = getStore(collectionName);
        if (store.has(id)) {
          const error = new Error("already exists");
          error.code = 6;
          throw error;
        }
        store.set(id, clone(data));
      },
      set: async data => {
        operations.push({ method: "set", collectionName, id, data: clone(data) });
        getStore(collectionName).set(id, clone(data));
      },
    };
  }

  const db = {
    collection: jest.fn(collectionName => ({
      doc: jest.fn(id => makeRef(collectionName, id)),
    })),
    runTransaction: jest.fn(callback => {
      const run = async () => {
        const writes = [];
        const transaction = {
          get: jest.fn(async documentRef => {
            operations.push({
              method: "get",
              collectionName: documentRef.collectionName,
              id: documentRef.id,
            });
            const data = getStore(documentRef.collectionName).get(documentRef.id);
            return {
              exists: typeof data !== "undefined",
              data: () => clone(data),
            };
          }),
          create: jest.fn((documentRef, data) => {
            operations.push({
              method: "create",
              collectionName: documentRef.collectionName,
              id: documentRef.id,
              data: clone(data),
            });
            writes.push({ type: "create", documentRef, data: clone(data) });
          }),
          update: jest.fn((documentRef, data) => {
            operations.push({
              method: "update",
              collectionName: documentRef.collectionName,
              id: documentRef.id,
              data: clone(data),
            });
            writes.push({ type: "update", documentRef, data: clone(data) });
          }),
          delete: jest.fn(documentRef => {
            operations.push({
              method: "delete",
              collectionName: documentRef.collectionName,
              id: documentRef.id,
            });
            writes.push({ type: "delete", documentRef });
          }),
        };

        const result = await callback(transaction);

        writes.forEach(write => {
          const store = getStore(write.documentRef.collectionName);
          const id = write.documentRef.id;
          if (write.type === "create") {
            if (store.has(id)) {
              const error = new Error("already exists");
              error.code = 6;
              throw error;
            }
            store.set(id, clone(write.data));
          } else if (write.type === "update") {
            const previous = store.get(id);
            if (typeof previous === "undefined") {
              const error = new Error("not found");
              error.code = 5;
              throw error;
            }
            store.set(id, { ...previous, ...clone(write.data) });
          } else if (write.type === "delete") {
            store.delete(id);
          }
        });

        return result;
      };

      const result = transactionQueue.then(run, run);
      transactionQueue = result.catch(() => {});
      return result;
    }),
  };

  return { db, operations, getStore };
}

const NOW = Date.UTC(2026, 0, 1, 0, 0, 0);
const SECRET_A = "a".repeat(64);
const SECRET_B = "b".repeat(64);
const ID_A = sha256Hex(SECRET_A);
const ID_B = sha256Hex(SECRET_B);
const CODE = "code-ABC_123.~-";
const CLIENT_ID = "1234567890";
const REDIRECT_URI = "https://toosterx.com/line/callback";

function rawRequest({ xff, remoteAddress = "203.0.113.7", ip = "198.51.100.99" } = {}) {
  const headers = {};
  if (typeof xff !== "undefined") headers["x-forwarded-for"] = xff;
  return {
    headers,
    socket: { remoteAddress },
    ip,
  };
}

function createHarness({
  now = NOW,
  relayLimiter,
  claimLimiter,
  isLocalRequest = () => false,
  logger,
  clock,
} = {}) {
  const memory = createMemoryFirestore();
  const state = clock || { current: now };
  const log = logger || { info: jest.fn(), error: jest.fn() };
  const handler = createLineLoginHandoffHandler({
    db: memory.db,
    HttpsError: FakeHttpsError,
    isLocalRequest,
    now: () => state.current,
    logger: log,
    relayLimiter,
    claimLimiter,
  });

  return {
    ...memory,
    handler,
    logger: log,
    call(data, raw = rawRequest()) {
      return handler({ data, rawRequest: raw });
    },
    setNow(value) {
      state.current = value;
    },
    getNow() {
      return state.current;
    },
    seed(collectionName, id, data) {
      memory.getStore(collectionName).set(id, clone(data));
    },
    get(collectionName, id) {
      return memory.getStore(collectionName).get(id);
    },
    has(collectionName, id) {
      return memory.getStore(collectionName).has(id);
    },
  };
}

function relayData(overrides = {}) {
  const handoffId = overrides.handoffId || ID_A;
  return {
    op: "relay",
    handoffId,
    code: CODE,
    liffClientId: CLIENT_ID,
    liffRedirectUri: REDIRECT_URI,
    pick: String(pairingNumber(handoffId)).padStart(2, "0"),
    ...overrides,
  };
}

function claimData(secret = SECRET_A) {
  return { op: "claim", handoffSecret: secret };
}

function writeCount(memory) {
  return memory.operations.filter(op => WRITE_METHODS.includes(op.method)).length;
}

function hexId(index) {
  return (index + 1).toString(16).padStart(64, "0");
}

describe("lineLoginHandoff", () => {
  test("pairingNumber／pairingOptions 測試向量與規格一致", () => {
    const ids = ["0".repeat(64), "f".repeat(64), sha256Hex("vector-3")];

    function referenceHash(handoffId) {
      return crypto.createHash("sha256").update(`fcb-pair:${handoffId}`, "utf8").digest();
    }

    function referenceNumber(handoffId) {
      return 10 + (referenceHash(handoffId).readUInt32BE(0) % 90);
    }

    function referenceOptions(handoffId) {
      const hash = referenceHash(handoffId);
      const correct = 10 + (hash.readUInt32BE(0) % 90);
      const decoys = [];
      for (let i = 4; i < hash.length && decoys.length < 2; i += 1) {
        const value = 10 + (hash[i] % 90);
        if (value !== correct && !decoys.includes(value)) decoys.push(value);
      }
      for (let value = 10; decoys.length < 2 && value <= 99; value += 1) {
        if (value !== correct && !decoys.includes(value)) decoys.push(value);
      }
      const position = hash[31] % 3;
      const options = decoys.slice();
      options.splice(position, 0, correct);
      return options;
    }

    ids.forEach(id => {
      expect(pairingNumber(id)).toBe(referenceNumber(id));
      expect(pairingNumber(id)).toBeGreaterThanOrEqual(10);
      expect(pairingNumber(id)).toBeLessThanOrEqual(99);
      expect(pairingOptions(id)).toEqual(referenceOptions(id));
      expect(pairingOptions(id)).toContain(referenceNumber(id));
      expect(new Set(pairingOptions(id)).size).toBe(3);
    });

    // 固定字面值：前端 K2 要用同一組向量驗證逐位元相同（正解位置 0／1／2 都涵蓋）。
    const vectors = [
      ["0".repeat(64), 64, [66, 55, 64]],
      ["f".repeat(64), 48, [31, 39, 48]],
      [sha256Hex("vector-3"), 52, [32, 87, 52]],
      [sha256Hex("vector-4"), 87, [65, 87, 22]],
      [sha256Hex("vector-7"), 28, [28, 93, 98]],
    ];
    vectors.forEach(([id, number, options]) => {
      expect(pairingNumber(id)).toBe(number);
      expect(pairingOptions(id)).toEqual(options);
    });
  });

  test("isAllowedRedirectUri 只允許三個正式 origin 下的路徑", () => {
    ALLOWED_REDIRECT_ORIGINS.forEach(origin => {
      expect(isAllowedRedirectUri(`${origin}/line/callback`)).toBe(true);
    });

    [
      "https://toosterx.com",
      "https://toosterx.com.evil.com/",
      "http://toosterx.com/",
      "//evil.com/",
      "javascript:alert(1)",
      `https://toosterx.com/${"a".repeat(2049)}`,
      null,
      123,
    ].forEach(value => {
      expect(isAllowedRedirectUri(value)).toBe(false);
    });
  });

  test("relay 格式攻擊一律 invalid-argument 且沒有 Firestore 讀寫", async () => {
    const harness = createHarness();
    const base = relayData();
    const missingCode = { ...base };
    delete missingCode.code;
    const extraSecret = { ...base, handoffSecret: SECRET_A };

    const cases = [
      { ...base, code: "x".repeat(257) },
      { ...base, code: "bad code" },
      { ...base, liffClientId: 123 },
      { ...base, liffRedirectUri: "https://evil.com/" },
      { ...base, pick: "9" },
      { ...base, pick: "aa" },
      { ...base, extra: "x" },
      missingCode,
      { op: "relay" },
      { op: "claim" },
      extraSecret,
      null,
      [],
    ];

    for (const data of cases) {
      await expect(harness.call(data)).rejects.toMatchObject({
        code: "invalid-argument",
        message: "INVALID_REQUEST",
      });
    }

    expect(harness.operations).toHaveLength(0);
  });

  test("relay 正確時以 create 寫入交接文件", async () => {
    const harness = createHarness();
    const data = relayData({ handoffId: ID_A });

    await expect(harness.call(data)).resolves.toEqual({ ok: true });

    const document = harness.get(HANDOFF_COLLECTION, ID_A);
    expect(document).toMatchObject({
      code: CODE,
      liffClientId: CLIENT_ID,
      liffRedirectUri: REDIRECT_URI,
      createdAt: new Date(NOW),
      expiresAt: new Date(NOW + HANDOFF_TTL_MS),
    });
    expect(document.voided).toBeUndefined();

    const writes = harness.operations.filter(op => WRITE_METHODS.includes(op.method));
    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe("create");
  });

  test("relay 選錯時建立作廢文件，claim 回 not-found 並刪除", async () => {
    const harness = createHarness();
    const data = relayData({ handoffId: ID_A, pick: "00" });

    await expect(harness.call(data)).resolves.toEqual({ ok: false, reason: "mismatch" });

    const document = harness.get(HANDOFF_COLLECTION, ID_A);
    expect(document).toMatchObject({
      voided: true,
      createdAt: new Date(NOW),
      expiresAt: new Date(NOW + HANDOFF_TTL_MS),
    });

    await expect(harness.call(claimData(SECRET_A))).rejects.toMatchObject({
      code: "not-found",
      message: "HANDOFF_NOT_FOUND",
    });
    expect(harness.has(HANDOFF_COLLECTION, ID_A)).toBe(false);
  });

  test("不覆寫三案：已存在時不改文件，且建立只透過 create", async () => {
    const first = createHarness();
    await first.call(relayData({ handoffId: ID_A }));
    const before = clone(first.get(HANDOFF_COLLECTION, ID_A));
    await expect(first.call(relayData({ handoffId: ID_A, pick: "00" })))
      .resolves.toEqual({ ok: false, reason: "mismatch" });
    expect(first.get(HANDOFF_COLLECTION, ID_A)).toEqual(before);
    await expect(first.call(claimData(SECRET_A))).resolves.toEqual({
      code: CODE,
      liffClientId: CLIENT_ID,
      liffRedirectUri: REDIRECT_URI,
    });

    const second = createHarness();
    await second.call(relayData({ handoffId: ID_A, pick: "00" }));
    await expect(second.call(relayData({ handoffId: ID_A }))).rejects.toMatchObject({
      code: "failed-precondition",
      message: "HANDOFF_UNAVAILABLE",
    });
    expect(second.get(HANDOFF_COLLECTION, ID_A).voided).toBe(true);

    const third = createHarness();
    await third.call(relayData({ handoffId: ID_A }));
    await expect(third.call(relayData({ handoffId: ID_A, code: "second-code" })))
      .rejects.toMatchObject({
        code: "failed-precondition",
        message: "HANDOFF_UNAVAILABLE",
      });
    await expect(third.call(claimData(SECRET_A))).resolves.toMatchObject({ code: CODE });

    [first, second, third].forEach(harness => {
      const handoffWrites = harness.operations.filter(op => (
        op.collectionName === HANDOFF_COLLECTION && WRITE_METHODS.includes(op.method)
      ));
      expect(handoffWrites.some(op => op.method === "set")).toBe(false);
      expect(handoffWrites.filter(op => op.method === "create").length).toBeGreaterThanOrEqual(1);
    });
  });

  test("claim 不存在、已過期、已作廢都回同一個 not-found", async () => {
    const missing = createHarness();
    await expect(missing.call(claimData(SECRET_A))).rejects.toMatchObject({
      code: "not-found",
      message: "HANDOFF_NOT_FOUND",
    });

    const expired = createHarness();
    expired.seed(HANDOFF_COLLECTION, ID_A, {
      code: CODE,
      liffClientId: CLIENT_ID,
      liffRedirectUri: REDIRECT_URI,
      createdAt: new Date(NOW - 1000),
      expiresAt: new Date(NOW - 1),
    });
    await expect(expired.call(claimData(SECRET_A))).rejects.toMatchObject({
      code: "not-found",
      message: "HANDOFF_NOT_FOUND",
    });
    expect(expired.has(HANDOFF_COLLECTION, ID_A)).toBe(false);

    const voided = createHarness();
    voided.seed(HANDOFF_COLLECTION, ID_A, {
      voided: true,
      createdAt: new Date(NOW - 1000),
      expiresAt: new Date(NOW + 1000),
    });
    await expect(voided.call(claimData(SECRET_A))).rejects.toMatchObject({
      code: "not-found",
      message: "HANDOFF_NOT_FOUND",
    });
    expect(voided.has(HANDOFF_COLLECTION, ID_A)).toBe(false);
  });

  test("claim 成功一次後 60 秒內可重取，超過後刪除", async () => {
    const harness = createHarness();
    await harness.call(relayData({ handoffId: ID_A }));

    const payload = {
      code: CODE,
      liffClientId: CLIENT_ID,
      liffRedirectUri: REDIRECT_URI,
    };

    await expect(harness.call(claimData(SECRET_A))).resolves.toEqual(payload);
    expect(harness.get(HANDOFF_COLLECTION, ID_A).claimedAt).toEqual(new Date(NOW));

    const writesAfterFirstClaim = writeCount(harness);
    harness.setNow(NOW + 59000);
    await expect(harness.call(claimData(SECRET_A))).resolves.toEqual(payload);
    expect(writeCount(harness)).toBe(writesAfterFirstClaim);

    harness.setNow(NOW + 61000);
    await expect(harness.call(claimData(SECRET_A))).rejects.toMatchObject({
      code: "not-found",
      message: "HANDOFF_NOT_FOUND",
    });
    expect(harness.has(HANDOFF_COLLECTION, ID_A)).toBe(false);
  });

  test("claim 在 relay 過期後回 not-found 並刪除", async () => {
    const harness = createHarness();
    await harness.call(relayData({ handoffId: ID_A }));
    harness.setNow(NOW + HANDOFF_TTL_MS + 1);

    await expect(harness.call(claimData(SECRET_A))).rejects.toMatchObject({
      code: "not-found",
      message: "HANDOFF_NOT_FOUND",
    });
    expect(harness.has(HANDOFF_COLLECTION, ID_A)).toBe(false);
  });

  test("relay 每分鐘 10 次、claim 每分鐘 30 次，超額不讀寫且視窗過後恢復", async () => {
    const clock = { current: NOW };
    const harness = createHarness({
      clock,
      relayLimiter: createRateLimiter({
        limit: RELAY_LIMIT_PER_MINUTE,
        now: () => clock.current,
      }),
      claimLimiter: createRateLimiter({
        limit: CLAIM_LIMIT_PER_MINUTE,
        now: () => clock.current,
      }),
    });

    const relayRaw = rawRequest({ xff: "1.2.3.4" });
    for (let i = 0; i < RELAY_LIMIT_PER_MINUTE; i += 1) {
      await expect(harness.call(relayData({ handoffId: hexId(i) }), relayRaw))
        .resolves.toEqual({ ok: true });
    }

    const beforeRelayThrottle = harness.operations.length;
    await expect(harness.call(relayData({ handoffId: hexId(100) }), relayRaw))
      .rejects.toMatchObject({
        code: "resource-exhausted",
        message: "TRY_LATER",
      });
    expect(harness.operations.length).toBe(beforeRelayThrottle);

    const claimRaw = rawRequest({ xff: "5.6.7.8" });
    for (let i = 0; i < CLAIM_LIMIT_PER_MINUTE; i += 1) {
      const secret = i.toString(16).padStart(64, "0");
      await expect(harness.call(claimData(secret), claimRaw)).rejects.toMatchObject({
        code: "not-found",
        message: "HANDOFF_NOT_FOUND",
      });
    }

    const beforeClaimThrottle = harness.operations.length;
    await expect(harness.call(claimData("f".repeat(64)), claimRaw)).rejects.toMatchObject({
      code: "resource-exhausted",
      message: "TRY_LATER",
    });
    expect(harness.operations.length).toBe(beforeClaimThrottle);

    harness.setNow(NOW + 60001);
    await expect(harness.call(relayData({ handoffId: hexId(101) }), relayRaw))
      .resolves.toEqual({ ok: true });
  });

  test("IP 只看 X-Forwarded-For 最後一段，偽造前段不影響計數", async () => {
    expect(getPlatformClientIp({
      headers: {},
      socket: { remoteAddress: "10.0.0.1" },
      ip: "8.8.8.8",
    })).toBe("10.0.0.1");
    expect(getPlatformClientIp({
      headers: { "x-forwarded-for": ["1.1.1.1, 2.2.2.2"] },
      socket: { remoteAddress: "10.0.0.1" },
      ip: "8.8.8.8",
    })).toBe("2.2.2.2");
    expect(countForwardedHops({ headers: {}, socket: {} })).toBe(0);

    const clock = { current: NOW };
    const harness = createHarness({
      clock,
      relayLimiter: createRateLimiter({
        limit: RELAY_LIMIT_PER_MINUTE,
        now: () => clock.current,
      }),
    });

    for (let i = 0; i < RELAY_LIMIT_PER_MINUTE; i += 1) {
      const raw = rawRequest({ xff: `1.1.1.${i}, 9.9.9.9`, ip: `7.7.7.${i}` });
      await expect(harness.call(relayData({ handoffId: hexId(200 + i) }), raw))
        .resolves.toEqual({ ok: true });
    }

    await expect(harness.call(
      relayData({ handoffId: hexId(210) }),
      rawRequest({ xff: "1.1.1.255, 9.9.9.9", ip: "6.6.6.6" }),
    )).rejects.toMatchObject({
      code: "resource-exhausted",
      message: "TRY_LATER",
    });

    await expect(harness.call(
      relayData({ handoffId: hexId(211) }),
      rawRequest({ xff: "1.1.1.1, 8.8.8.8" }),
    )).resolves.toEqual({ ok: true });
  });

  test("節流時選錯數字不作廢，且不建立文件", async () => {
    const clock = { current: NOW };
    const harness = createHarness({
      clock,
      relayLimiter: createRateLimiter({
        limit: RELAY_LIMIT_PER_MINUTE,
        now: () => clock.current,
      }),
    });
    const raw = rawRequest({ xff: "4.4.4.4" });

    for (let i = 0; i < RELAY_LIMIT_PER_MINUTE; i += 1) {
      await harness.call(relayData({ handoffId: hexId(300 + i) }), raw);
    }

    const targetId = "c".repeat(64);
    await expect(harness.call(relayData({ handoffId: targetId, pick: "00" }), raw))
      .rejects.toMatchObject({
        code: "resource-exhausted",
        message: "TRY_LATER",
      });
    expect(harness.has(HANDOFF_COLLECTION, targetId)).toBe(false);
  });

  test("本機來源直接 failed-precondition，不讀寫也不消耗節流", async () => {
    const relayLimiter = { hit: jest.fn(() => true) };
    const claimLimiter = { hit: jest.fn(() => true) };
    const harness = createHarness({
      isLocalRequest: () => true,
      relayLimiter,
      claimLimiter,
    });

    await expect(harness.call(relayData({ handoffId: ID_A }))).rejects.toMatchObject({
      code: "failed-precondition",
      message: "LOCAL_DEVELOPMENT_ORIGIN_NOT_ALLOWED",
    });

    expect(harness.operations).toHaveLength(0);
    expect(relayLimiter.hit).not.toHaveBeenCalled();
    expect(claimLimiter.hit).not.toHaveBeenCalled();
  });

  test("log 不含秘密，且每次呼叫都有正確 outcome", async () => {
    const logger = { info: jest.fn(), error: jest.fn() };
    const harness = createHarness({ logger });
    const raw = rawRequest({ xff: "1.2.3.4" });

    await harness.call(relayData({ handoffId: ID_A }), raw);
    await harness.call(relayData({ handoffId: ID_B, pick: "00" }), raw);
    await harness.call(claimData(SECRET_A), raw);
    await expect(harness.call(claimData(SECRET_B), raw)).rejects.toMatchObject({
      code: "not-found",
    });
    await expect(harness.call({ op: "relay" }, raw)).rejects.toMatchObject({
      code: "invalid-argument",
    });

    const failing = createHarness({ logger });
    failing.db.collection = jest.fn(() => ({
      doc: jest.fn(() => ({
        create: jest.fn(async () => {
          const error = new Error("boom");
          error.code = 14;
          throw error;
        }),
      })),
    }));
    await expect(failing.call(
      relayData({ handoffId: "e".repeat(64) }),
      rawRequest({ xff: "1.2.3.4" }),
    )).rejects.toMatchObject({
      code: "unavailable",
      message: "TRY_LATER",
    });

    const allCalls = [...logger.info.mock.calls, ...logger.error.mock.calls];
    const logText = allCalls.map(call => call.map(argument => {
      try {
        return JSON.stringify(argument);
      } catch {
        return String(argument);
      }
    }).join(" ")).join("\n");

    [CODE, SECRET_A, SECRET_B, ID_A, ID_B, REDIRECT_URI, CLIENT_ID, "1.2.3.4"].forEach(secret => {
      expect(logText).not.toContain(secret);
    });

    const infoCalls = logger.info.mock.calls.filter(call => call[0] === "[lineLoginHandoff]");
    expect(infoCalls).toHaveLength(6);
    expect(infoCalls.map(call => call[1].outcome)).toEqual([
      "relay_ok",
      "relay_mismatch",
      "claim_ok",
      "claim_not_found",
      "invalid",
      "error",
    ]);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][1]).toMatchObject({
      op: "relay",
      stage: "relay_create",
      errorCode: 14,
    });
  });

  test("createRateLimiter 超過 maxKeys 時清理最舊項目", () => {
    const limiter = createRateLimiter({
      limit: 10,
      windowMs: 60000,
      maxKeys: 3,
      now: () => NOW,
    });

    for (let i = 0; i < 5; i += 1) {
      expect(limiter.hit(`key-${i}`)).toBe(true);
    }

    expect(limiter.size()).toBeLessThanOrEqual(3);
    expect(limiter.size()).toBe(3);
  });

  test("createLineLoginHandoffCallable 使用固定 onCall 選項", () => {
    const onCall = jest.fn((options, handler) => ({ options, handler }));
    const memory = createMemoryFirestore();
    const result = createLineLoginHandoffCallable({
      onCall,
      HttpsError: FakeHttpsError,
      db: memory.db,
      isLocalRequest: () => false,
      logger: { info: jest.fn(), error: jest.fn() },
    });

    expect(onCall).toHaveBeenCalledTimes(1);
    expect(onCall.mock.calls[0][0]).toEqual({
      region: "asia-east1",
      timeoutSeconds: 10,
      memory: "256MiB",
      maxInstances: 3,
    });
    expect(onCall.mock.calls[0][0]).toEqual(LINE_LOGIN_HANDOFF_OPTIONS);
    expect(typeof onCall.mock.calls[0][1]).toBe("function");
    expect(result.handler).toBe(onCall.mock.calls[0][1]);
  });

  test("原始碼檢查：不使用 Firestore set、不使用 rawRequest.ip、不載入 firebase", () => {
    const moduleSource = fs.readFileSync(
      path.join(__dirname, "../../functions/line-login-handoff.js"),
      "utf8",
    );
    // 交接文件只能用 create／update／delete；Map 的 set 不算（不比對 entries.set）。
    expect(moduleSource).not.toMatch(/(ref|transaction|tx|batch|db)\.set\(/);
    expect(moduleSource).not.toMatch(/\.doc\([^)]*\)\.set\(/);
    expect(moduleSource).not.toContain("rawRequest.ip");
    expect(moduleSource).not.toContain('require("firebase-');

    const indexSource = fs.readFileSync(
      path.join(__dirname, "../../functions/index.js"),
      "utf8",
    );
    expect(indexSource).toContain("exports.lineLoginHandoff = createLineLoginHandoffCallable(");
  });
});
