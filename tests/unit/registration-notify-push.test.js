"use strict";

/**
 * 網頁推播 W2-B：報名發送點入列（情境 P0～P3）。
 * - P0 正式常數 push:true（開通實測段 2026-11-25 起）：報名、取消並遞補、移除都寫 webPushQueue，log 多 push* 三欄且仍在白名單內。
 * - P1 push:false：測試內把原始碼常數改成 false 後載入（loadNotifyWithPushOff），全情境 webPushQueue 寫入 0，log 與 S4 逐欄相同。
 *   （取代原本「P1 push:false（正式常數）」直接用正式常數的寫法，保護內容不變。）
 * - P2／P3 push:true：測試內載入 push:true 版本（loadNotifyWithPushOn，正式程式沒有任何覆寫入口），
 *   再透過 harness 的 stubs 交給 index.js。
 */

const fs = require("fs");
const registrationNotify = require("../../functions/registration-notify");
const { queueIdOf } = require("../../functions/web-push-validate");
const {
  FakeTimestamp, createFakeFirestore, loadFunctionsIndex,
} = require("./registration-callable-harness");
const { NOTIFY_FILE, loadNotifyWithPushOn, loadNotifyWithPushOff } = require("./registration-notify-variants");

const U_SELF = `U${"1".repeat(32)}`;
const U_OTHER = `U${"2".repeat(32)}`;
const U_ADMIN = `U${"9".repeat(32)}`;
const EVENT_ID = "ce_1800000000000_abc";
const TITLE = "通知測試活動";
const LOCATION = "河濱球場";
const S4_LOG_KEYS = ["cancelled", "cancelledRegs", "channels", "fn", "inboxFailed", "promoted", "promotedRegs", "removed", "signup"];
const PUSH_LOG_KEYS = [...S4_LOG_KEYS, "pushDeduped", "pushFailed", "pushQueued"].sort();
const QUEUE_KEYS = ["body", "createdAt", "expireAt", "kind", "recipientUid", "schema", "source", "status", "title", "url"];

function user(uid, extra = {}) {
  return {
    uid, lineUserId: uid, name: "n", displayName: "d", gender: "male",
    birthday: "1990-01-01", region: "taipei", role: "user", exp: 100, ...extra,
  };
}

function reg(docId, data) {
  return {
    id: `reg_${docId}`, eventId: EVENT_ID, participantType: "self", companionId: null, companionName: null,
    promotionOrder: 0, ...data,
  };
}

function seedFull() {
  return {
    [`users/${U_SELF}`]: user(U_SELF),
    [`users/${U_OTHER}`]: user(U_OTHER),
    [`users/${U_ADMIN}`]: user(U_ADMIN, { role: "super_admin" }),
    [`events/${EVENT_ID}`]: {
      id: EVENT_ID, title: TITLE, date: "2099/06/15 10:00~12:00", location: LOCATION, type: "play",
      status: "open", max: 1, current: 1, waitlist: 1, participants: [], waitlistNames: [],
    },
    [`events/${EVENT_ID}/registrations/r1`]: reg("r1", {
      userId: U_SELF, userName: "self", status: "confirmed", registeredAt: new FakeTimestamp(1000),
    }),
    [`events/${EVENT_ID}/registrations/r2`]: reg("r2", {
      userId: U_OTHER, userName: "other", status: "waitlisted", registeredAt: new FakeTimestamp(2000),
    }),
  };
}

function seedOpen() {
  return {
    [`users/${U_SELF}`]: user(U_SELF),
    [`events/${EVENT_ID}`]: {
      id: EVENT_ID, title: TITLE, date: "2099/06/15 10:00~12:00", location: LOCATION, type: "play",
      status: "open", max: 5, current: 0, waitlist: 0, participants: [], waitlistNames: [],
    },
  };
}

function quietConsole() {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "info").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
}

afterEach(() => jest.restoreAllMocks());

const queuePaths = (fake) => fake.paths().filter((p) => p.startsWith("webPushQueue/"));
const dispatchLogs = (harness) => harness.logs.filter((entry) => entry[1] === "[registrationNotify] dispatched");
const inboxCount = (fake, uid) => fake.paths().filter((p) => p.startsWith(`users/${uid}/inbox/`)).length;

const SCENARIOS = [
  ["報名", seedOpen, (f, requestId) => f.registerForEvent({
    auth: { uid: U_SELF, token: {} },
    data: { eventId: EVENT_ID, participants: [{ userId: U_SELF, userName: "self" }], requestId },
  }), [["signup", U_SELF]]],
  ["取消並遞補", seedFull, (f, requestId) => f.cancelRegistration({
    auth: { uid: U_SELF, token: {} }, data: { eventId: EVENT_ID, registrationIds: ["r1"], requestId },
  }), [["cancelled", U_SELF], ["promoted", U_OTHER]]],
  ["管理員移除", seedFull, (f, requestId) => f.cancelRegistration({
    auth: { uid: U_ADMIN, token: {} }, data: { eventId: EVENT_ID, registrationIds: ["r1"], reason: "manager_remove", requestId },
  }), [["promoted", U_OTHER], ["removed", U_SELF]]],
];

// 開通實測段（2026-11-25）：正式常數改 true 後，直接用正式模組與 index.js（不 stub）驗證真的會入列
describe("P0 push:true（正式常數）", () => {
  let fn;
  let harness;

  beforeAll(() => {
    ({ exports: fn, harness } = loadFunctionsIndex());
  });

  beforeEach(() => {
    harness.logs.length = 0;
    quietConsole();
  });

  test("正式常數為 inbox 開、line 關、push 開", () => {
    expect(registrationNotify.REGISTRATION_NOTIFY_CHANNELS).toEqual({ inbox: true, line: false, push: true });
  });

  test("enqueueWebPushNotices 會呼叫 createQueueDoc 入列，回傳計數", async () => {
    const createQueueDoc = jest.fn(async () => {});
    await expect(registrationNotify.enqueueWebPushNotices(
      [{ kind: "signup", recipientUid: U_SELF, title: "t", body: "b" }],
      { eventId: EVENT_ID, requestId: "r" },
      { createQueueDoc, serverTimestamp: () => "ts", now: () => 0 }
    )).resolves.toEqual({ queued: 1, deduped: 0, failed: 0 });
    expect(createQueueDoc).toHaveBeenCalledTimes(1);
  });

  test.each(SCENARIOS)("%s：每則 notice 一份 webPushQueue，log 多 push* 三欄、仍在白名單內、不含 uid／活動代號", async (label, seed, call, expected) => {
    const fake = createFakeFirestore(seed());
    harness.current = fake;
    const requestId = `p0-${label}`;
    await call(fn, requestId);
    const docs = queuePaths(fake).map((p) => fake.get(p));
    expect(docs.map((d) => [d.kind, d.recipientUid]).sort()).toEqual([...expected].sort());
    for (const doc of docs) expect(Object.keys(doc).sort()).toEqual(QUEUE_KEYS);
    const logs = dispatchLogs(harness);
    expect(logs).toHaveLength(1);
    expect(logs[0][0]).toBe("info");
    expect(Object.keys(logs[0][2]).sort()).toEqual(PUSH_LOG_KEYS);
    expect(logs[0][2]).toMatchObject({ channels: "inbox+push", pushQueued: expected.length, pushDeduped: 0, pushFailed: 0 });
    const text = JSON.stringify(logs[0]);
    for (const secret of [U_SELF, U_OTHER, U_ADMIN, EVENT_ID, TITLE, LOCATION, requestId]) expect(text).not.toContain(secret);
  });
});

describe("P1 push:false（測試內改常數）", () => {
  let offModule;
  let fn;
  let harness;

  beforeAll(() => {
    offModule = loadNotifyWithPushOff();
    ({ exports: fn, harness } = loadFunctionsIndex({ stubs: { "./registration-notify": offModule } }));
  });

  beforeEach(() => {
    harness.logs.length = 0;
    quietConsole();
  });

  test("常數改 false 後 channels 為 inbox、push 關", () => {
    expect(offModule.REGISTRATION_NOTIFY_CHANNELS).toEqual({ inbox: true, line: false, push: false });
  });

  test("enqueueWebPushNotices 第一行就 return null，不呼叫任何注入", async () => {
    const createQueueDoc = jest.fn();
    const serverTimestamp = jest.fn();
    const now = jest.fn();
    await expect(offModule.enqueueWebPushNotices(
      [{ kind: "signup", recipientUid: U_SELF, title: "t", body: "b" }],
      { eventId: EVENT_ID, requestId: "r" },
      { createQueueDoc, serverTimestamp, now }
    )).resolves.toBeNull();
    expect(createQueueDoc).not.toHaveBeenCalled();
    expect(serverTimestamp).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });

  test.each([
    ["報名", seedOpen, (f) => f.registerForEvent({
      auth: { uid: U_SELF, token: {} },
      data: { eventId: EVENT_ID, participants: [{ userId: U_SELF, userName: "self" }], requestId: "p1-reg" },
    })],
    ["取消並遞補", seedFull, (f) => f.cancelRegistration({
      auth: { uid: U_SELF, token: {} }, data: { eventId: EVENT_ID, registrationIds: ["r1"], requestId: "p1-cancel" },
    })],
    ["管理員移除", seedFull, (f) => f.cancelRegistration({
      auth: { uid: U_ADMIN, token: {} }, data: { eventId: EVENT_ID, registrationIds: ["r1"], reason: "manager_remove" },
    })],
  ])("%s：webPushQueue 寫入 0，log 欄位與 S4 逐欄相同（不出現 push*、channels 仍為 inbox）", async (_label, seed, call) => {
    const fake = createFakeFirestore(seed());
    harness.current = fake;
    await call(fn);
    expect(queuePaths(fake)).toEqual([]);
    expect(fake.state.writes.filter((w) => w.path.startsWith("webPush"))).toEqual([]);
    const logs = dispatchLogs(harness);
    expect(logs).toHaveLength(1);
    expect(Object.keys(logs[0][2]).sort()).toEqual(S4_LOG_KEYS);
    expect(logs[0][2].channels).toBe("inbox");
  });
});

describe("P2／P3 push:true（測試內改常數）", () => {
  let pushModule;
  let fn;
  let harness;

  beforeAll(() => {
    pushModule = loadNotifyWithPushOn();
    ({ exports: fn, harness } = loadFunctionsIndex({ stubs: { "./registration-notify": pushModule } }));
  });

  beforeEach(() => {
    harness.logs.length = 0;
    quietConsole();
  });

  test("常數改 true 後 channels 為 inbox+push", async () => {
    expect(pushModule.REGISTRATION_NOTIFY_CHANNELS).toEqual({ inbox: true, line: false, push: true });
  });

  test("P2 報名：每則 notice 恰 1 份佇列，欄位只有白名單，不含 eventId／callerUid／requestId", async () => {
    const fake = createFakeFirestore(seedOpen());
    harness.current = fake;
    await fn.registerForEvent({
      auth: { uid: U_SELF, token: {} },
      data: { eventId: EVENT_ID, participants: [{ userId: U_SELF, userName: "self" }], requestId: "p2-reg-1" },
    });
    const paths = queuePaths(fake);
    expect(paths).toEqual([`webPushQueue/${queueIdOf({ kind: "signup", eventId: EVENT_ID, recipientUid: U_SELF, opKey: "p2-reg-1" })}`]);
    const doc = fake.get(paths[0]);
    expect(Object.keys(doc).sort()).toEqual(QUEUE_KEYS);
    expect(doc).toMatchObject({
      schema: 1, source: "registration", kind: "signup", recipientUid: U_SELF, title: "報名成功通知", url: "/inbox", status: "pending",
    });
    expect(Array.from(doc.body).length).toBeLessThanOrEqual(180);
    expect(JSON.stringify(doc)).not.toContain(EVENT_ID);
    expect(JSON.stringify(doc)).not.toContain("p2-reg-1");
    const keepMs = doc.expireAt.getTime() - Date.now();
    expect(keepMs).toBeGreaterThan(6.9 * 86400000);
    expect(keepMs).toBeLessThanOrEqual(7 * 86400000);
    const logs = dispatchLogs(harness);
    expect(Object.keys(logs[0][2]).sort()).toEqual(PUSH_LOG_KEYS);
    expect(logs[0][2]).toMatchObject({ channels: "inbox+push", pushQueued: 1, pushDeduped: 0, pushFailed: 0 });
    const text = JSON.stringify(logs[0]);
    for (const secret of [U_SELF, EVENT_ID, TITLE, LOCATION, "p2-reg-1"]) expect(text).not.toContain(secret);
  });

  test("P2 管理員移除：佇列收件者是被移除者與被遞補者，不是呼叫者（收件人只來自交易結果）", async () => {
    const fake = createFakeFirestore(seedFull());
    harness.current = fake;
    await fn.cancelRegistration({
      auth: { uid: U_ADMIN, token: {} },
      data: { eventId: EVENT_ID, registrationIds: ["r1"], reason: "manager_remove", requestId: "p2-rm" },
    });
    const docs = queuePaths(fake).map((p) => fake.get(p));
    expect(docs.map((d) => [d.kind, d.recipientUid]).sort()).toEqual([["promoted", U_OTHER], ["removed", U_SELF]].sort());
    expect(docs.some((d) => d.recipientUid === U_ADMIN)).toBe(false);
    expect(docs.find((d) => d.kind === "removed").title).toBe("報名已被管理員移除");
  });

  test("P2 同 requestId 第二次：0 份新佇列（去重早退）", async () => {
    const fake = createFakeFirestore(seedFull());
    harness.current = fake;
    const payload = { eventId: EVENT_ID, registrationIds: ["r1"], requestId: "p2-dup" };
    await fn.cancelRegistration({ auth: { uid: U_SELF, token: {} }, data: payload });
    const first = queuePaths(fake);
    expect(first).toHaveLength(2);
    await fn.cancelRegistration({ auth: { uid: U_SELF, token: {} }, data: payload });
    expect(queuePaths(fake)).toEqual(first);
  });

  test("P2 index.js 用 create()：同鍵佇列已存在時不覆寫，只計 pushDeduped", async () => {
    const queueId = queueIdOf({ kind: "signup", eventId: EVENT_ID, recipientUid: U_SELF, opKey: "p2-existing" });
    const existing = { schema: 1, source: "registration", kind: "signup", status: "claimed", marker: "first-delivery" };
    const fake = createFakeFirestore({ ...seedOpen(), [`webPushQueue/${queueId}`]: existing });
    harness.current = fake;
    await fn.registerForEvent({
      auth: { uid: U_SELF, token: {} },
      data: { eventId: EVENT_ID, participants: [{ userId: U_SELF, userName: "self" }], requestId: "p2-existing" },
    });
    expect(fake.get(`webPushQueue/${queueId}`)).toEqual(existing);
    expect(dispatchLogs(harness)[0][2]).toMatchObject({ pushQueued: 0, pushDeduped: 1, pushFailed: 0 });
  });

  test("P2 同鍵 create 第二次：只計 pushDeduped，不覆寫既有佇列", async () => {
    const queued = new Map();
    const createQueueDoc = jest.fn(async (id, data) => {
      if (queued.has(id)) throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
      queued.set(id, data);
    });
    const deps = {
      writeInboxNotification: jest.fn(async () => {}),
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      createQueueDoc,
      serverTimestamp: () => "ts",
      now: () => 0,
    };
    const notices = [{ kind: "signup", recipientUid: U_SELF, title: "t", body: "b" }];
    const ctx = { eventId: EVENT_ID, requestId: "same" };
    const first = await pushModule.dispatchRegistrationNotices("registerForEvent", notices, { cancelledRegs: 0, promotedRegs: 0 }, deps, ctx);
    const original = [...queued.values()][0];
    const second = await pushModule.dispatchRegistrationNotices("registerForEvent", notices, { cancelledRegs: 0, promotedRegs: 0 }, deps, ctx);
    expect(first).toMatchObject({ pushQueued: 1, pushDeduped: 0, pushFailed: 0 });
    expect(second).toMatchObject({ pushQueued: 0, pushDeduped: 1, pushFailed: 0 });
    expect([...queued.values()]).toEqual([original]);
  });

  test("缺 requestId：每次用伺服器隨機 opKey（不同呼叫不會互相去重）", async () => {
    const ids = [];
    const deps = {
      writeInboxNotification: async () => {}, logger: { info() {}, warn() {}, error() {} },
      createQueueDoc: async (id) => { ids.push(id); }, serverTimestamp: () => "ts", now: () => 0,
    };
    const notices = [{ kind: "signup", recipientUid: U_SELF, title: "t", body: "b" }];
    await pushModule.dispatchRegistrationNotices("registerForEvent", notices, { cancelledRegs: 0, promotedRegs: 0 }, deps, { eventId: EVENT_ID });
    await pushModule.dispatchRegistrationNotices("registerForEvent", notices, { cancelledRegs: 0, promotedRegs: 0 }, deps, { eventId: EVENT_ID });
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  test("P3 入列一則被拒、一則同步丟錯：其餘照入列，站內信全寫，pushFailed 計數正確、改 warn", async () => {
    let n = 0;
    const deps = {
      writeInboxNotification: jest.fn(async () => {}),
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      createQueueDoc: jest.fn((id) => {
        n += 1;
        if (n === 1) return Promise.reject(Object.assign(new Error(`denied ${id}`), { code: 7 }));
        if (n === 2) throw new Error("sync boom");
        return Promise.resolve();
      }),
      serverTimestamp: () => "ts",
      now: () => 0,
    };
    const notices = [U_SELF, U_OTHER, U_ADMIN].map((uid) => ({ kind: "promoted", recipientUid: uid, title: "t", body: "b" }));
    const summary = await pushModule.dispatchRegistrationNotices(
      "cancelRegistration", notices, { cancelledRegs: 0, promotedRegs: 3 }, deps, { eventId: EVENT_ID, requestId: "p3" }
    );
    expect(deps.writeInboxNotification).toHaveBeenCalledTimes(3);
    expect(summary).toMatchObject({ pushQueued: 1, pushDeduped: 0, pushFailed: 2, inboxFailed: 0 });
    expect(deps.logger.warn).toHaveBeenCalledTimes(1);
  });

  test("P3 Callable 層：佇列 create 全部被拒 → 報名照回 success、站內信照寫、pushFailed 計數", async () => {
    const fake = createFakeFirestore(seedFull());
    harness.current = fake;
    const originalCollection = fake.db.collection;
    fake.db.collection = (name) => {
      if (name !== "webPushQueue") return originalCollection(name);
      return { doc: () => ({ create: async () => { throw Object.assign(new Error("PERMISSION_DENIED"), { code: 7 }); } }) };
    };
    const response = await fn.cancelRegistration({
      auth: { uid: U_SELF, token: {} }, data: { eventId: EVENT_ID, registrationIds: ["r1"], requestId: "p3-callable" },
    });
    expect(response.success).toBe(true);
    expect(inboxCount(fake, U_SELF)).toBe(1);
    expect(inboxCount(fake, U_OTHER)).toBe(1);
    const logs = dispatchLogs(harness);
    expect(logs[0][2]).toMatchObject({ pushQueued: 0, pushFailed: 2, inboxFailed: 0 });
    expect(logs[0][0]).toBe("warn");
  });

  test("P3 Callable 層：佇列 create 同步丟錯 → 報名照回 success", async () => {
    const fake = createFakeFirestore(seedOpen());
    harness.current = fake;
    const originalCollection = fake.db.collection;
    fake.db.collection = (name) => {
      if (name !== "webPushQueue") return originalCollection(name);
      throw new Error("sync collection boom");
    };
    const response = await fn.registerForEvent({
      auth: { uid: U_SELF, token: {} },
      data: { eventId: EVENT_ID, participants: [{ userId: U_SELF, userName: "self" }], requestId: "p3-sync" },
    });
    expect(response.success).toBe(true);
    expect(inboxCount(fake, U_SELF)).toBe(1);
    expect(dispatchLogs(harness)[0][2]).toMatchObject({ pushQueued: 0, pushFailed: 1 });
  });

  test("LINE 增量 0：push 開啟時也不寫 linePushQueue", async () => {
    const fake = createFakeFirestore(seedFull());
    harness.current = fake;
    await fn.cancelRegistration({
      auth: { uid: U_SELF, token: {} }, data: { eventId: EVENT_ID, registrationIds: ["r1"], requestId: "line-0" },
    });
    expect(fake.paths().filter((p) => p.startsWith("linePushQueue/"))).toEqual([]);
  });
});

describe("模組邊界", () => {
  test("registration-notify.js 不 require firebase-admin、web-push，沒有 LINE 呼叫", () => {
    const source = fs.readFileSync(NOTIFY_FILE, "utf8");
    expect(source).not.toMatch(/require\(\s*["'](firebase-admin[^"']*|web-push)["']\s*\)/);
    expect(source).not.toMatch(/enqueueLine|linePushQueue|processLinePushQueue|pushMessage/);
  });

  test("push 判斷是 enqueueWebPushNotices 的第一行", () => {
    const source = fs.readFileSync(NOTIFY_FILE, "utf8");
    const body = source.split("async function enqueueWebPushNotices(")[1].split("\n").slice(1);
    expect(body[0].trim()).toBe("if (REGISTRATION_NOTIFY_CHANNELS.push !== true) return null;");
  });
});
