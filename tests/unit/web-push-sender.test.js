"use strict";

/**
 * 網頁推播 W2-B：sendWebPushFromQueue 處理器（情境 S1～S10、payload 白名單、不跟隨重新導向、回應本文不進 log、lazy require）。
 * VAPID 金鑰只用執行時動態產生的值（webpush.generateVAPIDKeys）或明顯的測試假值；記憶體版 Firestore，不碰正式資料。
 */

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { EventEmitter } = require("events");
const { PassThrough } = require("stream");
const config = require("../../functions/web-push-config");
const validate = require("../../functions/web-push-validate");
const { taipeiDayKey } = require("../../functions/notification-fields");
const { createSendWebPushFromQueueHandler, postPushRequest, vapidPublicKeyOf } = require("../../functions/web-push-sender");
const {
  FakeTimestamp, FieldValue, HttpsError, createFakeFirestore, loadFunctionsIndex,
} = require("./registration-callable-harness");

// 執行時動態產生的測試金鑰對（發送前會核對私鑰推出的公鑰，不能再用假字串）
const TEST_VAPID = require("../../functions/node_modules/web-push").generateVAPIDKeys();
const FAKE_PUBLIC = TEST_VAPID.publicKey;
const FAKE_PRIVATE = TEST_VAPID.privateKey;
const SETTINGS = { ...config, WEB_PUSH_VAPID_PUBLIC_KEY: FAKE_PUBLIC, WEB_PUSH_VAPID_KEY_ID: validate.computeVapidKeyId(FAKE_PUBLIC) };
const RECIPIENT = `U${"7".repeat(32)}`;
const OTHER = `U${"8".repeat(32)}`;
const EVENT_ID = "ce_1800000000000_seed";
const TITLE = "報名成功通知種子標題";
const BODY = "活動名稱：種子活動\n活動地點：種子球場";
const QUEUE_ID = "q".repeat(32);
const LOG_KEYS = ["codes", "failed", "gone", "keyMismatch", "kind", "latencyMs", "outcome", "reason", "sent", "services", "subs"];
const MINUTE = 60 * 1000;

const endpointOf = (n) => `https://fcm.googleapis.com/fcm/send/seed-device-${n}`;
const subPath = (endpoint) => `webPushSubscriptions/${validate.subscriptionIdOf(endpoint)}`;

function dynamicKeys() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey().toString("base64url"), auth: crypto.randomBytes(16).toString("base64url"), ecdh };
}

function queueDoc(extra = {}) {
  return {
    schema: 1, source: "registration", kind: "signup", recipientUid: RECIPIENT, title: TITLE, body: BODY,
    url: "/inbox", status: "pending", createdAt: new FakeTimestamp(Date.now()), expireAt: new Date(Date.now() + 7 * 86400000),
    ...extra,
  };
}

function subDoc(n, extra = {}) {
  const keys = dynamicKeys();
  return {
    schema: 1, uid: RECIPIENT, endpoint: endpointOf(n), keys: { p256dh: keys.p256dh, auth: keys.auth },
    vapidKeyId: SETTINGS.WEB_PUSH_VAPID_KEY_ID, service: "fcm", platform: "android",
    createdAt: new FakeTimestamp(1), lastSeenAt: new FakeTimestamp(1), ...extra,
  };
}

// 假 HTTPS：依 endpoint 回指定狀態碼；記錄每次請求
function fakeTransport(statusFor = () => 201, { bodyText = "" } = {}) {
  const calls = [];
  const requestImpl = (url, options, onResponse) => {
    const req = new EventEmitter();
    const chunks = [];
    req.write = (chunk) => chunks.push(Buffer.from(chunk));
    req.destroy = (error) => setImmediate(() => req.emit("error", error));
    req.end = () => {
      calls.push({ url, options, body: Buffer.concat(chunks) });
      const status = statusFor(url);
      setImmediate(() => {
        if (status === "timeout") { req.emit("timeout"); return; }
        if (status === "error") { req.emit("error", Object.assign(new Error(`ECONNRESET ${url}`), { code: "ECONNRESET" })); return; }
        const res = new PassThrough();
        res.statusCode = status;
        onResponse(res);
        res.end(bodyText);
      });
    };
    return req;
  };
  return { calls, requestImpl };
}

function fakeWebPush() {
  const payloads = [];
  return {
    payloads,
    generateRequestDetails: jest.fn((sub, payload, options) => {
      payloads.push({ sub, payload, options });
      return { endpoint: sub.endpoint, headers: { TTL: options.TTL }, body: Buffer.from(payload) };
    }),
  };
}

function setup({ seed = {}, control = { sendEnabled: true }, settings = SETTINGS, statusFor, privateKey = FAKE_PRIVATE, getPrivateKey, now, bodyText, queue = queueDoc() } = {}) {
  const fullSeed = { [`webPushQueue/${QUEUE_ID}`]: queue, ...seed };
  if (control) fullSeed["webPushControl/sender"] = control;
  const fake = createFakeFirestore(fullSeed);
  const logs = [];
  const transport = fakeTransport(statusFor, { bodyText });
  const webPush = fakeWebPush();
  const handler = createSendWebPushFromQueueHandler({
    db: fake.db,
    FieldValue,
    logger: {
      info: (...args) => logs.push(["info", ...args]),
      warn: (...args) => logs.push(["warn", ...args]),
      error: (...args) => logs.push(["error", ...args]),
    },
    getPrivateKey: getPrivateKey || (() => privateKey),
    settings,
    loadWebPush: () => webPush,
    requestImpl: transport.requestImpl,
    ...(now ? { now } : {}),
  });
  const run = async () => handler({ data: await fake.db.collection("webPushQueue").doc(QUEUE_ID).get(), params: { queueId: QUEUE_ID } });
  return { fake, logs, transport, webPush, run };
}

const processed = (logs) => logs.filter((l) => l[1] === "[webPush] processed").map((l) => l[2]);

describe("停發與跳過（S1、S2、S3、S7、S8）", () => {
  test.each([
    ["控制文件不存在", null],
    ["sendEnabled false", { sendEnabled: false }],
    ["sendEnabled 是字串 true", { sendEnabled: "true" }],
  ])("S1 %s → 0 外送、skipped:disabled、不寫", async (_label, control) => {
    const { run, transport, logs, fake } = setup({ control, seed: { [subPath(endpointOf(1))]: subDoc(1) } });
    await run();
    expect(transport.calls).toHaveLength(0);
    expect(processed(logs)).toEqual([expect.objectContaining({ outcome: "skipped", reason: "disabled" })]);
    expect(fake.state.writes).toHaveLength(0);
    expect(fake.get(`webPushQueue/${QUEUE_ID}`).status).toBe("pending");
  });

  test("S1 控制文件讀失敗 → 視為停發", async () => {
    const { run, transport, logs, fake } = setup({ seed: { [subPath(endpointOf(1))]: subDoc(1) } });
    const original = fake.db.collection;
    fake.db.collection = (name) => {
      if (name === "webPushControl") return { doc: () => ({ get: async () => { throw Object.assign(new Error("x"), { code: 14 }); } }) };
      return original(name);
    };
    await run();
    expect(transport.calls).toHaveLength(0);
    expect(processed(logs)[0].reason).toBe("disabled");
    expect(logs.find((l) => l[1] === "[webPush] error")[2]).toEqual({ stage: "control_read", code: "14", name: "Error" });
  });

  test("E3 常數 WEB_PUSH_SENDER_ENABLED false → 停發", async () => {
    const { run, transport, logs } = setup({
      settings: { ...SETTINGS, WEB_PUSH_SENDER_ENABLED: false }, seed: { [subPath(endpointOf(1))]: subDoc(1) },
    });
    await run();
    expect(transport.calls).toHaveLength(0);
    expect(processed(logs)[0].reason).toBe("disabled");
  });

  test("W1 前（公鑰或私鑰缺）→ 停發並記 ERROR", async () => {
    for (const variant of [{ settings: { ...SETTINGS, WEB_PUSH_VAPID_PUBLIC_KEY: "", WEB_PUSH_VAPID_KEY_ID: "" } }, { privateKey: "" }]) {
      const { run, transport, logs } = setup({ ...variant, seed: { [subPath(endpointOf(1))]: subDoc(1) } });
      await run();
      expect(transport.calls).toHaveLength(0);
      expect(processed(logs)[0].reason).toBe("disabled");
      expect(logs.find((l) => l[1] === "[webPush] error")[2].stage).toBe("vapid_missing");
    }
  });

  test("私鑰推出的公鑰與常數不符（或私鑰格式錯）→ 停發、記 vapid_mismatch，不讀訂閱、不認領、不送", async () => {
    const other = require("../../functions/node_modules/web-push").generateVAPIDKeys();
    const malformed = [`${FAKE_PRIVATE}
`, ` ${FAKE_PRIVATE}`, `${FAKE_PRIVATE}=`];
    for (const privateKey of [other.privateKey, "not-a-valid-key", Buffer.alloc(31, 1).toString("base64url"), ...malformed]) {
      const { run, transport, logs, fake } = setup({ privateKey, seed: { [subPath(endpointOf(1))]: subDoc(1) } });
      const touched = [];
      const collection = fake.db.collection.bind(fake.db);
      fake.db.collection = (name) => { touched.push(name); return collection(name); };
      await run();
      // 沒查訂閱、沒寫每日計數（webPushQueue 是測試自己取觸發文件）
      expect(touched).toContain("webPushControl");
      expect(touched).not.toContain("webPushSubscriptions");
      expect(touched).not.toContain("webPushDaily");
      expect(transport.calls).toHaveLength(0);
      expect(processed(logs)[0].reason).toBe("disabled");
      const error = logs.find((l) => l[1] === "[webPush] error")[2];
      expect(error).toEqual({ stage: "vapid_mismatch", code: "VAPID_KEY_MISMATCH", name: "ConfigError" });
      expect(JSON.stringify(logs)).not.toContain(privateKey);
      expect(fake.get(`webPushQueue/${QUEUE_ID}`).status).toBe("pending");
    }
  });

  test("同一個執行個體：私鑰換版時重算（錯→對會送出；對→錯會停發）", async () => {
    const wrong = require("../../functions/node_modules/web-push").generateVAPIDKeys().privateKey;
    for (const [first, second, expectSecondSends] of [[wrong, FAKE_PRIVATE, true], [FAKE_PRIVATE, wrong, false]]) {
      let key = first;
      const { run, transport, logs } = setup({ getPrivateKey: () => key, seed: { [subPath(endpointOf(1))]: subDoc(1) } });
      await run();
      const firstSent = transport.calls.length;
      key = second;
      await run();
      if (expectSecondSends) {
        expect(firstSent).toBe(0);
        expect(transport.calls).toHaveLength(1);
      } else {
        expect(firstSent).toBe(1);
        expect(transport.calls).toHaveLength(1);
        expect(logs.filter((l) => l[1] === "[webPush] error").map((l) => l[2].stage)).toContain("vapid_mismatch");
      }
    }
  });

  test("vapidPublicKeyOf：與 web-push 產生的金鑰對一致；長度或格式不對回空字串", () => {
    for (let i = 0; i < 5; i += 1) {
      const pair = require("../../functions/node_modules/web-push").generateVAPIDKeys();
      expect(vapidPublicKeyOf(pair.privateKey)).toBe(pair.publicKey);
    }
    for (const bad of ["", null, undefined, "!!!", Buffer.alloc(33, 1).toString("base64url"), `${FAKE_PRIVATE}
`, ` ${FAKE_PRIVATE}`, `${FAKE_PRIVATE}=`]) {
      expect(vapidPublicKeyOf(bad)).toBe("");
    }
  });

  test("S2 沒有訂閱 → skipped:no_sub，不寫任何東西（不認領、不計數）", async () => {
    const { run, transport, logs, fake } = setup({ seed: { [subPath(endpointOf(1))]: subDoc(1, { uid: OTHER }) } });
    await run();
    expect(transport.calls).toHaveLength(0);
    expect(processed(logs)[0]).toMatchObject({ outcome: "skipped", reason: "no_sub", subs: 0 });
    expect(fake.state.writes).toHaveLength(0);
  });

  test("S3 已 claimed → 0 外送（至少一次投遞的第二次觸發）", async () => {
    const { run, transport, logs } = setup({
      queue: queueDoc({ status: "claimed" }), seed: { [subPath(endpointOf(1))]: subDoc(1) },
    });
    await run();
    expect(transport.calls).toHaveLength(0);
    expect(processed(logs)[0].reason).toBe("already_claimed");
  });

  test("同一份文件觸發兩次：只送一次", async () => {
    const { run, transport, logs } = setup({ seed: { [subPath(endpointOf(1))]: subDoc(1) } });
    await run();
    await run();
    expect(transport.calls).toHaveLength(1);
    expect(processed(logs).map((l) => l.reason)).toEqual(["", "already_claimed"]);
  });

  test("S7 建立超過 30 分鐘 → skipped:stale，不讀控制文件", async () => {
    const { run, transport, logs, fake } = setup({
      queue: queueDoc({ createdAt: new FakeTimestamp(Date.now() - 31 * MINUTE) }),
      seed: { [subPath(endpointOf(1))]: subDoc(1) },
    });
    const directReadsBefore = fake.state.reads.direct;
    await run();
    expect(transport.calls).toHaveLength(0);
    expect(processed(logs)[0].reason).toBe("stale");
    expect(fake.state.reads.direct - directReadsBefore).toBe(1); // 只有測試自己讀佇列快照那一次
  });

  test("S8 key id 不符：不送、不刪，計 keyMismatch", async () => {
    const { run, transport, logs, fake } = setup({
      seed: {
        [subPath(endpointOf(1))]: subDoc(1, { vapidKeyId: "0000000000000000" }),
        [subPath(endpointOf(2))]: subDoc(2),
      },
    });
    await run();
    expect(transport.calls.map((c) => c.url)).toEqual([endpointOf(2)]);
    expect(processed(logs)[0]).toMatchObject({ keyMismatch: 1, subs: 1, sent: 1, outcome: "sent" });
    expect(fake.has(subPath(endpointOf(1)))).toBe(true);
  });

  test.each([
    ["schema 錯", { schema: 2 }],
    ["source 錯", { source: "line" }],
    ["kind 錯", { kind: "comment" }],
    ["缺收件者", { recipientUid: "" }],
    ["缺標題", { title: "" }],
    ["缺內文", { body: 5 }],
    ["缺 createdAt", { createdAt: null }],
  ])("bad_doc：%s → 不送、不寫回", async (_label, patch) => {
    const { run, transport, logs, fake } = setup({ queue: queueDoc(patch), seed: { [subPath(endpointOf(1))]: subDoc(1) } });
    await run();
    expect(transport.calls).toHaveLength(0);
    expect(processed(logs)[0].reason).toBe("bad_doc");
    expect(fake.state.writes).toHaveLength(0);
  });
});

describe("回應碼（S4）與每日上限（S5）", () => {
  test("S4 404／410 刪訂閱；500／逾時／連線錯誤不刪、不重試", async () => {
    const codes = { 1: 201, 2: 404, 3: 410, 4: 500, 5: "timeout" };
    const seed = {};
    for (let n = 1; n <= 5; n += 1) seed[subPath(endpointOf(n))] = subDoc(n);
    const { run, transport, logs, fake } = setup({
      seed, statusFor: (url) => codes[Number(url.split("-").pop())],
    });
    await run();
    expect(transport.calls).toHaveLength(5);
    expect(fake.has(subPath(endpointOf(1)))).toBe(true);
    expect(fake.has(subPath(endpointOf(2)))).toBe(false);
    expect(fake.has(subPath(endpointOf(3)))).toBe(false);
    expect(fake.has(subPath(endpointOf(4)))).toBe(true);
    expect(fake.has(subPath(endpointOf(5)))).toBe(true);
    expect(processed(logs)[0]).toMatchObject({
      outcome: "partial", subs: 5, sent: 1, gone: 2, failed: 2,
      codes: { 0: 1, 201: 1, 404: 1, 410: 1, 500: 1 }, services: { fcm: 5 },
    });
  });

  test("全部 500 → outcome failed；連線錯誤也只計 failed", async () => {
    const { run, logs } = setup({
      seed: { [subPath(endpointOf(1))]: subDoc(1), [subPath(endpointOf(2))]: subDoc(2) },
      statusFor: (url) => (url.endsWith("-1") ? 500 : "error"),
    });
    await run();
    expect(processed(logs)[0]).toMatchObject({ outcome: "failed", sent: 0, failed: 2 });
  });

  test("S5 每日第 21 則：認領但不送、skipped:daily_limit", async () => {
    const seed = { [subPath(endpointOf(1))]: subDoc(1) };
    const { run, transport, logs, fake } = setup({ seed });
    const dayDoc = `webPushDaily/${require("../../functions/notification-fields").taipeiDayKey(Date.now())}_${validate.uidHashOf(RECIPIENT)}`;
    fake.put(dayDoc, { count: 20 });
    await run();
    expect(transport.calls).toHaveLength(0);
    expect(processed(logs)[0].reason).toBe("daily_limit");
    expect(fake.get(`webPushQueue/${QUEUE_ID}`).status).toBe("claimed");
    expect(fake.get(dayDoc).count).toBe(20);
  });

  test("S5 第 20 則照送，計數變 20", async () => {
    const seed = { [subPath(endpointOf(1))]: subDoc(1) };
    const { run, transport, fake } = setup({ seed });
    const dayDoc = `webPushDaily/${require("../../functions/notification-fields").taipeiDayKey(Date.now())}_${validate.uidHashOf(RECIPIENT)}`;
    fake.put(dayDoc, { count: 19 });
    await run();
    expect(transport.calls).toHaveLength(1);
    expect(fake.get(dayDoc).count).toBe(20);
    expect(fake.get(dayDoc).expireAt).toBeTruthy();
    expect(fake.get(`webPushQueue/${QUEUE_ID}`).status).toBe("claimed");
  });

  test("送前再驗主機：被竄改成白名單外的 endpoint 不送", async () => {
    const { run, transport, logs } = setup({
      seed: { [subPath("x")]: subDoc(1, { endpoint: "https://evil.test/collect" }) },
    });
    await run();
    expect(transport.calls).toHaveLength(0);
    expect(processed(logs)[0]).toMatchObject({ failed: 1, sent: 0, services: { invalid: 1 } });
  });
});

describe("例外與 payload（S6、S9、S10）", () => {
  test("S6 未預期例外 → 正常結束且記 ERROR（不帶 message）", async () => {
    const { run, fake, logs } = setup({ seed: { [subPath(endpointOf(1))]: subDoc(1) } });
    fake.db.runTransaction = async () => { throw Object.assign(new Error(`secret ${RECIPIENT} ${endpointOf(1)}`), { code: 10 }); };
    await expect(run()).resolves.toBeUndefined();
    const line = logs.find((l) => l[1] === "[webPush] error");
    expect(line[2]).toEqual({ stage: "unexpected", code: "10", name: "Error" });
    expect(JSON.stringify(logs)).not.toContain(RECIPIENT);
  });

  test("generateRequestDetails 丟錯：該筆計 failed，其他照送", async () => {
    const { run, webPush, logs, transport } = setup({
      seed: { [subPath(endpointOf(1))]: subDoc(1), [subPath(endpointOf(2))]: subDoc(2) },
    });
    const real = webPush.generateRequestDetails.getMockImplementation();
    webPush.generateRequestDetails.mockImplementation((sub, payload, options) => {
      if (sub.endpoint === endpointOf(1)) throw new Error(`bad key for ${sub.endpoint}`);
      return real(sub, payload, options);
    });
    await run();
    expect(transport.calls).toHaveLength(1);
    expect(processed(logs)[0]).toMatchObject({ sent: 1, failed: 1, outcome: "partial" });
    expect(JSON.stringify(logs)).not.toContain("seed-device");
  });

  test("S9 payload：Object.keys 精確等於 v,title,body,url；url 是站內信頁；不含 uid／eventId／kind", async () => {
    const { run, webPush } = setup({ queue: queueDoc({ eventId: EVENT_ID, url: "https://evil.test" }), seed: { [subPath(endpointOf(1))]: subDoc(1) } });
    await run();
    const payload = JSON.parse(webPush.payloads[0].payload);
    expect(Object.keys(payload)).toEqual(["v", "title", "body", "url"]);
    expect(payload).toEqual({ v: 1, title: TITLE, body: BODY, url: "/inbox" });
    expect(webPush.payloads[0].payload).not.toMatch(new RegExp(`${RECIPIENT}|${EVENT_ID}|signup|${QUEUE_ID}`));
  });

  test("送出選項：TTL 12 小時、urgency normal、逾時 10 秒、subject 公開網址", async () => {
    const { run, webPush, transport } = setup({ seed: { [subPath(endpointOf(1))]: subDoc(1) } });
    await run();
    expect(webPush.payloads[0].options).toEqual({
      vapidDetails: { subject: "https://toosterx.com", publicKey: FAKE_PUBLIC, privateKey: FAKE_PRIVATE },
      TTL: 43200, urgency: "normal", timeout: 10000,
    });
    expect(transport.calls[0].options).toMatchObject({ method: "POST", timeout: 10000 });
  });

  test("S10 log：每則一行、欄位白名單、不含 uid／endpoint／eventId／標題／內文／回應本文／私鑰", async () => {
    const { run, logs } = setup({
      queue: queueDoc({ eventId: EVENT_ID }),
      seed: { [subPath(endpointOf(1))]: subDoc(1), [subPath(endpointOf(2))]: subDoc(2) },
      statusFor: (url) => (url.endsWith("-1") ? 201 : 400),
      bodyText: `push service said ${endpointOf(2)} RESPONSE_BODY_SENTINEL`,
    });
    await run();
    const lines = processed(logs);
    expect(lines).toHaveLength(1);
    expect(Object.keys(lines[0]).sort()).toEqual(LOG_KEYS);
    const text = JSON.stringify(logs);
    for (const secret of [RECIPIENT, endpointOf(1), "seed-device", EVENT_ID, TITLE, "種子", "RESPONSE_BODY_SENTINEL", FAKE_PRIVATE, QUEUE_ID]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe("HTTPS 傳送：不跟隨重新導向、回應本文不保留", () => {
  let server;
  let hits;
  let port;

  beforeAll(async () => {
    hits = [];
    server = http.createServer((req, res) => {
      hits.push(req.url);
      req.resume();
      if (req.url.startsWith("/redirect")) {
        res.writeHead(Number(req.url.split("/")[2]), { Location: `http://127.0.0.1:${port}/target` });
        res.end("REDIRECT_BODY_SENTINEL");
        return;
      }
      res.writeHead(201);
      res.end("OK_BODY_SENTINEL");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = server.address().port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => { hits.length = 0; });

  test.each([301, 302, 307, 308])("%s 重新導向：只打一次、不打 Location、回傳狀態碼（視為失敗）", async (code) => {
    const result = await postPushRequest(
      { endpoint: `http://127.0.0.1:${port}/redirect/${code}`, headers: { TTL: 60 }, body: Buffer.from("x") },
      { timeoutMs: 2000, requestImpl: http.request }
    );
    expect(result).toEqual({ statusCode: code });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(hits).toEqual([`/redirect/${code}`]);
  });

  test("回傳物件只有狀態碼，沒有本文", async () => {
    const result = await postPushRequest(
      { endpoint: `http://127.0.0.1:${port}/ok`, headers: {}, body: Buffer.from("x") },
      { timeoutMs: 2000, requestImpl: http.request }
    );
    expect(result).toEqual({ statusCode: 201 });
    expect(JSON.stringify(result)).not.toContain("SENTINEL");
  });

  test("處理器收到 3xx：計 failed、不刪訂閱、codes 記 302", async () => {
    const { run, logs, fake } = setup({ seed: { [subPath(endpointOf(1))]: subDoc(1) }, statusFor: () => 302 });
    await run();
    expect(processed(logs)[0]).toMatchObject({ sent: 0, failed: 1, gone: 0, codes: { 302: 1 }, outcome: "failed" });
    expect(fake.has(subPath(endpointOf(1)))).toBe(true);
  });

  test("逾時：destroy 後回 statusCode 0", async () => {
    const slow = http.createServer(() => {});
    await new Promise((resolve) => slow.listen(0, "127.0.0.1", resolve));
    const result = await postPushRequest(
      { endpoint: `http://127.0.0.1:${slow.address().port}/`, headers: {}, body: null },
      { timeoutMs: 100, requestImpl: http.request }
    );
    expect(result).toEqual({ statusCode: 0, errorCode: "ETIMEDOUT" });
    slow.closeAllConnections();
    await new Promise((resolve) => slow.close(resolve));
  });
});

describe("真實 web-push（動態產生的測試金鑰）", () => {
  test("用 web-push 組 VAPID 與 aes128gcm，解密後 payload 欄位精確為 v,title,body,url", async () => {
    const webpush = require("../../functions/node_modules/web-push");
    const ece = require("../../functions/node_modules/http_ece");
    const vapid = webpush.generateVAPIDKeys();
    const settings = { ...config, WEB_PUSH_VAPID_PUBLIC_KEY: vapid.publicKey, WEB_PUSH_VAPID_KEY_ID: validate.computeVapidKeyId(vapid.publicKey) };
    const client = dynamicKeys();
    const sub = { ...subDoc(1), keys: { p256dh: client.p256dh, auth: client.auth }, vapidKeyId: settings.WEB_PUSH_VAPID_KEY_ID };
    const fake = createFakeFirestore({
      [`webPushQueue/${QUEUE_ID}`]: queueDoc(), "webPushControl/sender": { sendEnabled: true }, [subPath(endpointOf(1))]: sub,
    });
    const transport = fakeTransport(() => 201);
    const handler = createSendWebPushFromQueueHandler({
      db: fake.db, FieldValue, logger: { info() {}, warn() {}, error() {} },
      getPrivateKey: () => vapid.privateKey, settings, requestImpl: transport.requestImpl,
    });
    await handler({ data: await fake.db.collection("webPushQueue").doc(QUEUE_ID).get() });
    expect(transport.calls).toHaveLength(1);
    const { headers } = transport.calls[0].options;
    expect(headers.Authorization).toMatch(/^vapid t=.+, k=/);
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(headers.TTL).toBe(43200);
    expect(headers.Urgency).toBe("normal");
    const plain = ece.decrypt(transport.calls[0].body, {
      version: "aes128gcm", privateKey: client.ecdh, authSecret: client.auth,
    });
    const payload = JSON.parse(plain.toString("utf8"));
    expect(Object.keys(payload)).toEqual(["v", "title", "body", "url"]);
    expect(payload).toEqual({ v: 1, title: TITLE, body: BODY, url: "/inbox" });
  });
});

describe("lazy require 與 index.js 接線", () => {
  test("載入 web-push-sender.js 不會載入 web-push；只有真的要送時才載入", () => {
    jest.isolateModules(() => {
      const loaded = jest.fn(() => ({}));
      // 以 web-push-sender.js 實際會解析到的路徑掛 mock，頂層 require 就會呼叫到 factory
      jest.doMock(require.resolve("web-push", { paths: [path.join(__dirname, "../../functions")] }), () => { loaded(); return {}; });
      const sender = require("../../functions/web-push-sender");
      expect(loaded).not.toHaveBeenCalled();
      expect(typeof sender.createSendWebPushFromQueueHandler).toBe("function");
    });
  });

  test("index.js 沒有任何 require web-push；web-push-sender.js 的 require 只在函式內", () => {
    const indexSource = fs.readFileSync(path.join(__dirname, "../../functions/index.js"), "utf8");
    expect(indexSource).not.toMatch(/require\(\s*["']web-push["']\s*\)/);
    const senderSource = fs.readFileSync(path.join(__dirname, "../../functions/web-push-sender.js"), "utf8");
    const lines = senderSource.split("\n").filter((line) => /require\(\s*["']web-push["']\s*\)/.test(line));
    expect(lines).toEqual(['const loadWebPushDefault = () => require("web-push");']);
  });

  test("發送函式選項：webPushQueue onCreate、asia-east1、只綁 WEB_PUSH_VAPID_PRIVATE_KEY、retry false、minInstances 0", () => {
    const { exports: fn } = loadFunctionsIndex({ stubs: secretAwareStubs() });
    const options = fn.sendWebPushFromQueue.__options;
    expect({ ...options, secrets: options.secrets.map((s) => s.name) }).toEqual({
      document: "webPushQueue/{queueId}", region: "asia-east1", secrets: ["WEB_PUSH_VAPID_PRIVATE_KEY"],
      minInstances: 0, maxInstances: 3, timeoutSeconds: 60, memory: "256MiB", retry: false,
    });
  });

  test("VAPID 私鑰只綁在 sendWebPushFromQueue：報名核心兩支、訂閱兩支、其他所有函式都沒有", () => {
    const { exports: fn } = loadFunctionsIndex({ stubs: secretAwareStubs() });
    const holders = Object.entries(fn)
      .filter(([, value]) => value && value.__options && Array.isArray(value.__options.secrets))
      .filter(([, value]) => value.__options.secrets.some((s) => s && s.name === "WEB_PUSH_VAPID_PRIVATE_KEY"))
      .map(([name]) => name);
    expect(holders).toEqual(["sendWebPushFromQueue"]);
    for (const name of ["registerForEvent", "cancelRegistration", "registerWebPushSubscription", "unregisterWebPushSubscription"]) {
      expect(fn[name].__options.secrets || []).toEqual([]);
    }
  });

  test("發送函式沒有任何 LINE 呼叫", () => {
    const source = fs.readFileSync(path.join(__dirname, "../../functions/web-push-sender.js"), "utf8");
    expect(source).not.toMatch(/enqueueLine|linePushQueue|processLinePushQueue|pushMessage|LINE_CHANNEL/);
  });
});

describe("新活動通知 new_event", () => {
  const NE_URL = `/events/${EVENT_ID}`;
  const neQueue = (extra = {}) => queueDoc({
    source: "newEvent", kind: "new_event", title: "足球有新活動囉！", body: "11/28（六）20:00，點開看看", url: NE_URL, ...extra,
  });

  test("T-SND-01 new_event 正常送出、payload url 是活動頁", async () => {
    const { run, webPush, transport, logs } = setup({ queue: neQueue(), seed: { [subPath(endpointOf(1))]: subDoc(1) } });
    await run();
    expect(transport.calls).toHaveLength(1);
    expect(processed(logs)[0].outcome).toBe("sent");
    expect(JSON.parse(webPush.payloads[0].payload)).toEqual({
      v: 1, title: "足球有新活動囉！", body: "11/28（六）20:00，點開看看", url: NE_URL,
    });
  });

  test.each([
    ["/inbox"], ["/events/"], ["/events/a b"], ["/events/../x"], ["/events/a/b"], ["//evil.com/events/a"],
    ["https://x.com/events/a"], [`/events/${"a".repeat(65)}`], ["/events/a\n"], [undefined], [5],
  ])("T-SND-02 網址格式不合不送：%s", async (url) => {
    const { run, transport, fake, logs } = setup({
      queue: url === undefined ? (({ url: _omit, ...rest }) => rest)(neQueue({})) : neQueue({ url }), seed: { [subPath(endpointOf(1))]: subDoc(1) },
    });
    await run();
    expect(processed(logs)[0].reason).toBe("bad_url");
    expect(transport.calls).toHaveLength(0);
    expect(fake.state.writes).toHaveLength(0);
  });

  test.each([
    [{ source: "newEvent", kind: "signup" }],
    [{ source: "registration", kind: "new_event" }],
    [{ source: "__proto__" }],
    [{ source: "constructor" }],
  ])("T-SND-03 source／kind 不成對 → bad_doc：%j", async (patch) => {
    const { run, transport, fake, logs } = setup({
      queue: queueDoc(patch), seed: { [subPath(endpointOf(1))]: subDoc(1) },
    });
    await run();
    expect(processed(logs)[0].reason).toBe("bad_doc");
    expect(transport.calls).toHaveLength(0);
    expect(fake.state.writes).toHaveLength(0);
  });

  test("T-SND-04 ne 計數獨立、上限 5", async () => {
    const day = taipeiDayKey(Date.now());
    const hash = validate.uidHashOf(RECIPIENT);
    const neDoc = `webPushDaily/ne_${day}_${hash}`;
    const normalDoc = `webPushDaily/${day}_${hash}`;
    const { run, transport, fake, logs } = setup({
      queue: neQueue(),
      seed: { [subPath(endpointOf(1))]: subDoc(1), [neDoc]: { count: 5 }, [normalDoc]: { count: 0 } },
    });
    await run();
    expect(transport.calls).toHaveLength(0);
    expect(processed(logs)[0]).toMatchObject({ outcome: "skipped", reason: "daily_limit" });
    expect(fake.get(`webPushQueue/${QUEUE_ID}`).status).toBe("claimed");
    expect(fake.get(normalDoc).count).toBe(0);
  });

  test("T-SND-05 報名通知不受 ne 上限影響", async () => {
    const day = taipeiDayKey(Date.now());
    const hash = validate.uidHashOf(RECIPIENT);
    const neDoc = `webPushDaily/ne_${day}_${hash}`;
    const normalDoc = `webPushDaily/${day}_${hash}`;
    const { run, transport, fake } = setup({
      queue: queueDoc(),
      seed: { [subPath(endpointOf(1))]: subDoc(1), [neDoc]: { count: 5 }, [normalDoc]: { count: 0 } },
    });
    await run();
    expect(transport.calls).toHaveLength(1);
    expect(fake.get(normalDoc).count).toBe(1);
    expect(fake.get(neDoc).count).toBe(5);
  });

  test("T-SND-06 new_event 不吃報名的 20 則", async () => {
    const day = taipeiDayKey(Date.now());
    const hash = validate.uidHashOf(RECIPIENT);
    const neDoc = `webPushDaily/ne_${day}_${hash}`;
    const normalDoc = `webPushDaily/${day}_${hash}`;
    const { run, transport, fake } = setup({
      queue: neQueue(),
      seed: { [subPath(endpointOf(1))]: subDoc(1), [normalDoc]: { count: 20 }, [neDoc]: { count: 0 } },
    });
    await run();
    expect(transport.calls).toHaveLength(1);
    expect(fake.get(neDoc).count).toBe(1);
  });

  test("T-SND-07 第 4、5 則可送、第 6 則擋", async () => {
    const day = taipeiDayKey(Date.now());
    const neDoc = `webPushDaily/ne_${day}_${validate.uidHashOf(RECIPIENT)}`;
    const first = setup({
      queue: neQueue(), seed: { [subPath(endpointOf(1))]: subDoc(1), [neDoc]: { count: 4 } },
    });
    await first.run();
    expect(first.transport.calls).toHaveLength(1);
    expect(first.fake.get(neDoc).count).toBe(5);
    const second = setup({
      queue: neQueue(), seed: { [subPath(endpointOf(1))]: subDoc(1), [neDoc]: { count: 5 } },
    });
    await second.run();
    expect(second.transport.calls).toHaveLength(0);
    expect(processed(second.logs)[0].reason).toBe("daily_limit");
  });

  test("T-SND-08 報名通知 url 仍是 /inbox", async () => {
    const { run, webPush } = setup({
      queue: queueDoc({ url: "/events/x" }), seed: { [subPath(endpointOf(1))]: subDoc(1) },
    });
    await run();
    expect(JSON.parse(webPush.payloads[0].payload).url).toBe("/inbox");
  });

  test("T-SND-09 log 不含活動代號與網址", async () => {
    const { run, logs } = setup({ queue: neQueue(), seed: { [subPath(endpointOf(1))]: subDoc(1) } });
    await run();
    expect(Object.keys(processed(logs)[0]).sort()).toEqual(LOG_KEYS);
    const text = JSON.stringify(logs);
    for (const secret of [EVENT_ID, NE_URL, RECIPIENT]) expect(text).not.toContain(secret);
  });
});

// 保留 options 與秘密名稱的 stub（預設 harness 會丟掉 onDocumentCreated 的 options）
function secretAwareStubs() {
  const keep = (options, handler) => Object.assign(handler, { __options: options });
  return {
    "firebase-functions/v2/firestore": {
      onDocumentCreated: keep, onDocumentWritten: keep, onDocumentWrittenWithAuthContext: keep,
    },
    "firebase-functions/v2/https": {
      onCall: keep, onRequest: (o, h) => (h ? keep(o, h) : o), HttpsError,
    },
    "firebase-functions/v2/scheduler": { onSchedule: keep },
    "firebase-functions/params": { defineSecret: (name) => ({ name, value: () => "" }) },
  };
}
