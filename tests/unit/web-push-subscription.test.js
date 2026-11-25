"use strict";

/**
 * 網頁推播 W2-B：registerWebPushSubscription／unregisterWebPushSubscription（情境 C1～C8＋防洗寫）。
 * 記憶體版 Firestore（registration-callable-harness），不碰正式資料；訂閱金鑰執行時動態產生。
 */

const crypto = require("crypto");
const config = require("../../functions/web-push-config");
const validate = require("../../functions/web-push-validate");
const { createWebPushSubscriptionHandlers } = require("../../functions/web-push-subscription");
const {
  FakeTimestamp, FieldValue, HttpsError, createFakeFirestore, loadFunctionsIndex,
} = require("./registration-callable-harness");

const TEST_KEY_ID = validate.computeVapidKeyId(`test-only-${crypto.randomBytes(8).toString("hex")}`);
const SETTINGS = { ...config, WEB_PUSH_VAPID_KEY_ID: TEST_KEY_ID };
const U_A = `U${"a".repeat(32)}`;
const U_B = `U${"b".repeat(32)}`;
const HOUR = 60 * 60 * 1000;
const LOG_KEYS = ["platform", "result", "service", "subCount"];

function dynamicKeys() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey().toString("base64url"), auth: crypto.randomBytes(16).toString("base64url") };
}

const endpointOf = (n) => `https://fcm.googleapis.com/fcm/send/device-${n}`;

function setup({ settings = SETTINGS, seed = {}, fixedNow } = {}) {
  const fake = createFakeFirestore(seed);
  const logs = [];
  const clock = { offset: 0 };
  const handlers = createWebPushSubscriptionHandlers({
    db: fake.db,
    FieldValue,
    HttpsError,
    logger: {
      info: (...args) => logs.push(["info", ...args]),
      warn: (...args) => logs.push(["warn", ...args]),
      error: (...args) => logs.push(["error", ...args]),
    },
    now: () => (fixedNow === undefined ? Date.now() : fixedNow) + clock.offset,
    settings,
  });
  return { fake, logs, clock, handlers };
}

// 開通前正式常數只收 QA：預設帶有效 QA token（claims 形狀照 qa-test-mode.js 的 createCustomToken）
const qaToken = (extra = {}) => ({
  qa: true, qaTeamId: "qa-team-test", qaExp: Date.now() + 7 * 24 * HOUR, qaAgent: "agent-test", qaPersona: "member", ...extra,
});

function registerReq(uid, data, token = qaToken()) {
  return { auth: uid ? { uid, token } : undefined, data };
}

function subData(n, extra = {}) {
  return { endpoint: endpointOf(n), keys: dynamicKeys(), vapidKeyId: TEST_KEY_ID, platform: "android", ...extra };
}

const subPath = (endpoint) => `webPushSubscriptions/${validate.subscriptionIdOf(endpoint)}`;
const ownedBy = (fake, uid) => fake.list("webPushSubscriptions").filter((id) => fake.get(`webPushSubscriptions/${id}`).uid === uid);

async function expectCode(promise, code) {
  await expect(promise).rejects.toMatchObject({ code });
}

describe("register：身分與輸入", () => {
  test("C1 未登入 → unauthenticated，不寫任何東西", async () => {
    const { handlers, fake } = setup();
    await expectCode(handlers.register(registerReq(null, subData(1))), "unauthenticated");
    expect(fake.state.writes).toHaveLength(0);
  });

  test("C2 request.data.uid 被忽略，uid 取 request.auth.uid", async () => {
    const { handlers, fake } = setup();
    await expect(handlers.register(registerReq(U_A, { ...subData(1), uid: U_B }))).resolves.toEqual({ ok: true });
    const doc = fake.get(subPath(endpointOf(1)));
    expect(doc.uid).toBe(U_A);
    expect(ownedBy(fake, U_B)).toHaveLength(0);
  });

  test("只存白名單欄位；service 由主機推得，不信任前端", async () => {
    const { handlers, fake } = setup();
    const data = { ...subData(1), service: "apple", userAgent: "UA", ip: "1.2.3.4", displayName: "n", expirationTime: 1 };
    await handlers.register(registerReq(U_A, data));
    const doc = fake.get(subPath(endpointOf(1)));
    expect(Object.keys(doc).sort()).toEqual([
      "createdAt", "endpoint", "expireAt", "keys", "lastSeenAt", "platform", "schema", "service", "uid", "vapidKeyId",
    ]);
    expect(doc.service).toBe("fcm");
    expect(doc.schema).toBe(1);
    expect(Object.keys(doc.keys).sort()).toEqual(["auth", "p256dh"]);
    const expireMs = doc.expireAt.getTime() - Date.now();
    expect(expireMs).toBeGreaterThan(119 * 24 * HOUR);
    expect(expireMs).toBeLessThanOrEqual(120 * 24 * HOUR);
  });

  test.each([
    ["http", "http://fcm.googleapis.com/fcm/send/x"],
    ["帶 port", "https://fcm.googleapis.com:444/fcm/send/x"],
    ["帶帳密", "https://u:p@fcm.googleapis.com/fcm/send/x"],
    ["IP", "https://8.8.8.8/x"],
    ["非白名單", "https://push.example.test/x"],
    ["evilnotify", "https://evilnotify.windows.com/w/?token=x"],
    ["超長", `https://fcm.googleapis.com/fcm/send/${"a".repeat(1100)}`],
  ])("C3 endpoint %s → invalid-argument，訊息固定不回顯輸入", async (_label, endpoint) => {
    const { handlers, fake } = setup();
    const error = await handlers.register(registerReq(U_A, subData(1, { endpoint }))).catch((e) => e);
    expect(error.code).toBe("invalid-argument");
    expect(error.message).toBe("WEB_PUSH_INVALID_SUBSCRIPTION");
    expect(fake.state.writes).toHaveLength(0);
  });

  test("C4 keys 長度錯 → invalid-argument", async () => {
    const { handlers, fake } = setup();
    const keys = { p256dh: Buffer.alloc(64, 4).toString("base64url"), auth: crypto.randomBytes(16).toString("base64url") };
    await expectCode(handlers.register(registerReq(U_A, subData(1, { keys }))), "invalid-argument");
    expect(fake.state.writes).toHaveLength(0);
  });

  test("C5 舊 key id → failed-precondition", async () => {
    const { handlers, fake } = setup();
    await expectCode(handlers.register(registerReq(U_A, subData(1, { vapidKeyId: "0123456789abcdef" }))), "failed-precondition");
    expect(fake.state.writes).toHaveLength(0);
  });

  test("W1 前（伺服器 key id 為空）：連空字串 key id 也拒收（fail-closed）", async () => {
    // W1 後正式常數已填公鑰；此案以明確留空的設定鎖住 fail-closed 行為
    const { handlers, fake } = setup({ settings: { ...config, WEB_PUSH_VAPID_PUBLIC_KEY: "", WEB_PUSH_VAPID_KEY_ID: "" } });
    await expectCode(handlers.register(registerReq(U_A, subData(1, { vapidKeyId: "" }))), "failed-precondition");
    expect(fake.state.writes).toHaveLength(0);
  });
});

describe("register：開通前只收 QA（WEB_PUSH_REGISTER_QA_ONLY）", () => {
  const expectNotOpen = async ({ handlers, fake, logs }, token) => {
    const request = { auth: { uid: U_A, token }, data: subData(1) };
    const error = await handlers.register(request).catch((e) => e);
    expect(error.code).toBe("failed-precondition");
    expect(error.message).toBe("WEB_PUSH_NOT_OPEN");
    expect(fake.state.writes).toHaveLength(0);
    expect(fake.list("webPushSubscriptions")).toHaveLength(0);
    expect(logs).toEqual([["info", "[webPushSub] register", { result: "rejected_not_qa", service: "", platform: "", subCount: null }]]);
    expect(JSON.stringify(logs)).not.toContain(U_A);
  };

  test("正式常數為 true", () => {
    expect(config.WEB_PUSH_REGISTER_QA_ONLY).toBe(true);
  });

  test("一般 token → failed-precondition（WEB_PUSH_NOT_OPEN），不讀不寫", async () => {
    const ctx = setup();
    let txnCalls = 0;
    const orig = ctx.fake.db.runTransaction.bind(ctx.fake.db);
    ctx.fake.db.runTransaction = (...args) => { txnCalls += 1; return orig(...args); };
    await expectNotOpen(ctx, {});
    expect(txnCalls).toBe(0);
  });

  test("token 缺漏（undefined）→ 拒絕", async () => {
    await expectNotOpen(setup(), undefined);
  });

  test.each([
    ["缺 qa", { qa: undefined }],
    ["qa 是字串 true", { qa: "true" }],
    ["qa 是 1", { qa: 1 }],
    ["qa false", { qa: false }],
  ])("%s → 拒絕", async (_label, extra) => {
    await expectNotOpen(setup(), qaToken(extra));
  });

  const FIXED_NOW = Date.UTC(2026, 10, 25, 4, 0, 0);
  test.each([
    ["qaExp 已過期", { qaExp: FIXED_NOW - 1000 }],
    ["qaExp 等於現在", { qaExp: FIXED_NOW }],
    ["qaExp 缺", { qaExp: undefined }],
    ["qaExp 是字串", { qaExp: String(FIXED_NOW + HOUR) }],
    ["qaExp 是 NaN", { qaExp: Number.NaN }],
    ["qaExp 是 Infinity", { qaExp: Number.POSITIVE_INFINITY }],
  ])("qa true 但 %s → 拒絕", async (_label, extra) => {
    await expectNotOpen(setup({ fixedNow: FIXED_NOW }), qaToken(extra));
  });

  test("qaExp 比現在晚 1 毫秒：通過", async () => {
    const { handlers } = setup({ fixedNow: FIXED_NOW });
    await expect(handlers.register(registerReq(U_A, subData(1), qaToken({ qaExp: FIXED_NOW + 1 })))).resolves.toEqual({ ok: true });
  });

  test("QA 有效：照原流程建立訂閱", async () => {
    const { handlers, fake, logs } = setup();
    await expect(handlers.register(registerReq(U_A, subData(1)))).resolves.toEqual({ ok: true });
    expect(fake.get(subPath(endpointOf(1))).uid).toBe(U_A);
    expect(logs.at(-1)[2].result).toBe("created");
  });

  test("QA 有效但輸入不合：仍走原本的輸入檢查（invalid-argument）", async () => {
    const { handlers, fake } = setup();
    await expectCode(handlers.register(registerReq(U_A, subData(1, { endpoint: "https://evil.test/x" }))), "invalid-argument");
    expect(fake.state.writes).toHaveLength(0);
  });

  test("常數改 false（開通後）：一般 token 可通過", async () => {
    const { handlers, fake } = setup({ settings: { ...SETTINGS, WEB_PUSH_REGISTER_QA_ONLY: false } });
    await expect(handlers.register(registerReq(U_A, subData(1), {}))).resolves.toEqual({ ok: true });
    expect(fake.get(subPath(endpointOf(1))).uid).toBe(U_A);
  });

  test("unregister 不受影響：一般 token 也能刪自己的訂閱", async () => {
    const { handlers, fake } = setup();
    await handlers.register(registerReq(U_A, subData(1)));
    await expect(handlers.unregister(registerReq(U_A, { endpoint: endpointOf(1) }, {}))).resolves.toEqual({ ok: true });
    expect(fake.get(subPath(endpointOf(1)))).toBeUndefined();
  });

  test("unregister 不受影響：QA 已過期也能刪自己的訂閱", async () => {
    const { handlers, fake } = setup();
    await handlers.register(registerReq(U_A, subData(1)));
    await handlers.unregister(registerReq(U_A, { endpoint: endpointOf(1) }, qaToken({ qaExp: Date.now() - 1000 })));
    expect(fake.get(subPath(endpointOf(1)))).toBeUndefined();
  });
});

describe("register：上限與轉移", () => {
  test("C6 第 6 筆擠掉 lastSeenAt 最舊的一筆，回 ok 不回訂閱數", async () => {
    const seed = {};
    for (let n = 1; n <= 5; n += 1) {
      seed[subPath(endpointOf(n))] = {
        schema: 1, uid: U_A, endpoint: endpointOf(n), keys: dynamicKeys(), vapidKeyId: TEST_KEY_ID,
        service: "fcm", platform: "android", createdAt: new FakeTimestamp(n), lastSeenAt: new FakeTimestamp(1000 * (6 - n)),
      };
    }
    const { handlers, fake, logs } = setup({ seed });
    // lastSeenAt 最舊的是 n=5
    await expect(handlers.register(registerReq(U_A, subData(6)))).resolves.toEqual({ ok: true });
    expect(ownedBy(fake, U_A)).toHaveLength(5);
    expect(fake.has(subPath(endpointOf(5)))).toBe(false);
    expect(fake.has(subPath(endpointOf(6)))).toBe(true);
    const line = logs.find((l) => l[1] === "[webPushSub] register");
    expect(line[2]).toEqual({ result: "evicted_oldest", service: "fcm", platform: "android", subCount: 5 });
  });

  test("C7 同 endpoint 換帳號：轉移給目前登入者（不另建一筆）", async () => {
    const { handlers, fake } = setup();
    await handlers.register(registerReq(U_A, subData(1)));
    await handlers.register(registerReq(U_B, subData(1)));
    expect(fake.get(subPath(endpointOf(1))).uid).toBe(U_B);
    expect(ownedBy(fake, U_A)).toHaveLength(0);
    expect(fake.list("webPushSubscriptions")).toHaveLength(1);
  });

  test("轉移時新主人已有 5 筆：也擠掉新主人最舊的", async () => {
    const seed = {};
    for (let n = 1; n <= 5; n += 1) {
      seed[subPath(endpointOf(n))] = {
        schema: 1, uid: U_B, endpoint: endpointOf(n), keys: dynamicKeys(), vapidKeyId: TEST_KEY_ID,
        service: "fcm", platform: "android", createdAt: new FakeTimestamp(n), lastSeenAt: new FakeTimestamp(n),
      };
    }
    const { handlers, fake } = setup({ seed });
    await handlers.register(registerReq(U_A, subData(9)));
    await handlers.register(registerReq(U_B, subData(9)));
    expect(ownedBy(fake, U_B)).toHaveLength(5);
    expect(fake.has(subPath(endpointOf(1)))).toBe(false);
  });
});

describe("register：防洗寫（顧問 §3.641 a）", () => {
  test("同 subId、同金鑰、24 小時內：不寫、回 ok、log noop", async () => {
    const { handlers, fake, logs } = setup();
    const data = subData(1);
    await handlers.register(registerReq(U_A, data));
    const writesAfterFirst = fake.state.writes.length;
    await expect(handlers.register(registerReq(U_A, data))).resolves.toEqual({ ok: true });
    expect(fake.state.writes.length).toBe(writesAfterFirst);
    expect(logs.filter((l) => l[1] === "[webPushSub] register").map((l) => l[2].result)).toEqual(["created", "noop"]);
  });

  test("超過 24 小時：重寫 lastSeenAt（refreshed）", async () => {
    const { handlers, fake, clock, logs } = setup();
    const data = subData(1);
    await handlers.register(registerReq(U_A, data));
    clock.offset = 25 * HOUR;
    const before = fake.state.writes.length;
    await handlers.register(registerReq(U_A, data));
    expect(fake.state.writes.length).toBeGreaterThan(before);
    expect(logs.filter((l) => l[1] === "[webPushSub] register").map((l) => l[2].result)).toEqual(["created", "refreshed"]);
  });

  test("金鑰換了：即使 24 小時內也要寫", async () => {
    const { handlers, fake } = setup();
    await handlers.register(registerReq(U_A, subData(1)));
    const newKeys = dynamicKeys();
    await handlers.register(registerReq(U_A, subData(1, { keys: newKeys })));
    expect(fake.get(subPath(endpointOf(1))).keys).toEqual(newKeys);
  });

  test("每人每日寫入上限：第 21 次寫入 → resource-exhausted，不寫訂閱", async () => {
    const { handlers, fake } = setup();
    for (let n = 1; n <= config.WEB_PUSH_REGISTER_WRITES_PER_UID_PER_DAY; n += 1) {
      await handlers.register(registerReq(U_A, subData(n)));
    }
    await expectCode(handlers.register(registerReq(U_A, subData(99))), "resource-exhausted");
    expect(fake.has(subPath(endpointOf(99)))).toBe(false);
  });

  test("noop 不計入寫入上限", async () => {
    const { handlers } = setup();
    const data = subData(1);
    for (let n = 0; n < config.WEB_PUSH_REGISTER_WRITES_PER_UID_PER_DAY + 5; n += 1) {
      await expect(handlers.register(registerReq(U_A, data))).resolves.toEqual({ ok: true });
    }
  });

  test("計數文件在 webPushDaily，id 不含 uid", async () => {
    const { handlers, fake } = setup();
    await handlers.register(registerReq(U_A, subData(1)));
    const ids = fake.list("webPushDaily");
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatch(/^reg_\d{8}_[0-9a-f]{32}$/);
    expect(ids[0]).not.toContain(U_A);
  });
});

describe("unregister", () => {
  test("本人：刪除", async () => {
    const { handlers, fake } = setup();
    await handlers.register(registerReq(U_A, subData(1)));
    await expect(handlers.unregister(registerReq(U_A, { endpoint: endpointOf(1) }))).resolves.toEqual({ ok: true });
    expect(fake.has(subPath(endpointOf(1)))).toBe(false);
  });

  test("C8 刪他人訂閱 → 回 ok 但不刪", async () => {
    const { handlers, fake } = setup();
    await handlers.register(registerReq(U_A, subData(1)));
    await expect(handlers.unregister(registerReq(U_B, { endpoint: endpointOf(1), uid: U_A }))).resolves.toEqual({ ok: true });
    expect(fake.get(subPath(endpointOf(1))).uid).toBe(U_A);
  });

  test("不存在／格式錯：回 ok", async () => {
    const { handlers } = setup();
    await expect(handlers.unregister(registerReq(U_A, { endpoint: endpointOf(7) }))).resolves.toEqual({ ok: true });
    await expect(handlers.unregister(registerReq(U_A, { endpoint: 42 }))).resolves.toEqual({ ok: true });
  });

  test("未登入 → unauthenticated", async () => {
    const { handlers } = setup();
    await expectCode(handlers.unregister(registerReq(null, { endpoint: endpointOf(1) })), "unauthenticated");
  });
});

describe("log 白名單：不含 uid、endpoint、金鑰", () => {
  test("register／unregister 每行只有 result、service、platform、subCount", async () => {
    const { handlers, logs } = setup();
    const data = subData(1);
    await handlers.register(registerReq(U_A, data));
    await handlers.register(registerReq(U_A, subData(2, { endpoint: "https://evil.test/x" }))).catch(() => {});
    await handlers.unregister(registerReq(U_A, { endpoint: endpointOf(1) }));
    expect(logs.length).toBeGreaterThanOrEqual(3);
    for (const line of logs) {
      expect(Object.keys(line[2]).sort()).toEqual(LOG_KEYS);
      const text = JSON.stringify(line);
      for (const secret of [U_A, endpointOf(1), "evil.test", data.keys.p256dh, data.keys.auth, "device-1"]) {
        expect(text).not.toContain(secret);
      }
    }
  });

  test("交易失敗：記 ERROR（只有 stage／code）並回 sanitized internal", async () => {
    const { handlers, fake, logs } = setup();
    fake.db.runTransaction = async () => { const e = new Error(`boom ${endpointOf(1)} ${U_A}`); e.code = 14; throw e; };
    const error = await handlers.register(registerReq(U_A, subData(1))).catch((e) => e);
    expect(error.code).toBe("internal");
    const line = logs.find((l) => l[1] === "[webPushSub] error");
    expect(line[2]).toEqual({ stage: "register_txn", code: "14" });
    expect(JSON.stringify(logs)).not.toContain(U_A);
  });
});

describe("index.js 接線", () => {
  test("兩支 Callable：asia-east1、minInstances 0、無 secrets；未登入拒絕", async () => {
    const { exports: fn } = loadFunctionsIndex();
    for (const name of ["registerWebPushSubscription", "unregisterWebPushSubscription"]) {
      expect(fn[name].__options).toEqual({
        region: "asia-east1", minInstances: 0, timeoutSeconds: 10, memory: "256MiB", maxInstances: 3,
      });
      expect(fn[name].__options.secrets).toBeUndefined();
      await expect(fn[name]({ data: { endpoint: endpointOf(1) } })).rejects.toMatchObject({ code: "unauthenticated" });
    }
  });

  test("正式常數（開通前）：一般 token 註冊被拒（WEB_PUSH_NOT_OPEN），不寫", async () => {
    const { exports: fn, harness } = loadFunctionsIndex();
    harness.current = createFakeFirestore({});
    const error = await fn.registerWebPushSubscription(registerReq(U_A, subData(1), {})).catch((e) => e);
    expect(error).toMatchObject({ code: "failed-precondition", message: "WEB_PUSH_NOT_OPEN" });
    expect(harness.current.state.writes).toHaveLength(0);
  });

  test("W1 前正式常數：已登入註冊也被拒（failed-precondition），不寫", async () => {
    const { exports: fn, harness } = loadFunctionsIndex();
    harness.current = createFakeFirestore({});
    await expect(fn.registerWebPushSubscription(registerReq(U_A, subData(1)))).rejects.toMatchObject({ code: "failed-precondition" });
    expect(harness.current.state.writes).toHaveLength(0);
  });
});
