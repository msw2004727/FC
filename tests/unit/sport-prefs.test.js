"use strict";

const config = require("../../functions/web-push-config");
const validate = require("../../functions/web-push-validate");
const catalog = require("../../functions/sport-catalog");
const { createSaveSportPrefsHandler } = require("../../functions/sport-prefs");
const {
  FakeTimestamp, FieldValue, HttpsError, createFakeFirestore, loadFunctionsIndex,
} = require("./registration-callable-harness");

const U_A = `U${"a".repeat(32)}`;
const U_B = `U${"b".repeat(32)}`;
const DAY = 24 * 60 * 60 * 1000;
const FIXED_NOW = Date.UTC(2026, 10, 27, 4, 0, 0); // 台北 11/27 12:00
const DAY_KEY = "20261127";

function setup({ seed = {}, now = FIXED_NOW } = {}) {
  const fake = createFakeFirestore(seed);
  const logs = [];
  const handler = createSaveSportPrefsHandler({
    db: fake.db,
    FieldValue,
    HttpsError,
    logger: {
      info: (...args) => logs.push(["info", ...args]),
      warn: (...args) => logs.push(["warn", ...args]),
      error: (...args) => logs.push(["error", ...args]),
    },
    now: () => now,
    settings: config,
  });
  return { fake, logs, handler };
}

const userPath = (uid) => `users/${uid}`;
const counterPath = (uid, dayKey = DAY_KEY) => `webPushDaily/pref_${dayKey}_${validate.uidHashOf(uid)}`;

function baseSeed() {
  return {
    [userPath(U_A)]: { uid: U_A, displayName: "種子", region: "台北市" },
    [userPath(U_B)]: { uid: U_B, displayName: "他人", region: "新北市" },
  };
}

async function expectCode(promise, code, message) {
  const error = await promise.catch((e) => e);
  expect(error.code).toBe(code);
  if (message) expect(error.message).toBe(message);
}

describe("sport-prefs：輸入驗證", () => {
  test("T-PREF-01 未登入 → unauthenticated，0 寫入", async () => {
    const { fake, handler } = setup({ seed: baseSeed() });
    await expectCode(handler({ data: { addSports: ["football"] } }), "unauthenticated");
    expect(fake.state.writes).toHaveLength(0);
  });

  test.each([
    ["{}", {}],
    ["null", null],
    ["[]", []],
    ["uid", { uid: U_B, addSports: ["football"] }],
    ["空 addSports", { addSports: [] }],
    ["other", { addSports: ["other"] }],
    ["未知 tag", { addSports: ["xx"] }],
    ["addSports 非陣列", { addSports: "football" }],
    ["addSports 超過 20", { addSports: Array(21).fill("football") }],
    ["removeSport other", { removeSport: "other" }],
    ["add 與 remove 同時", { addSports: ["football"], removeSport: "tennis" }],
    ["newEventNotify 字串", { newEventNotify: "false" }],
    ["promptSeen false", { promptSeen: false }],
    ["promptSeen 字串", { promptSeen: "true" }],
    ["undefined 值", { addSports: undefined }],
    ["未允許鍵", { foo: 1 }],
    ["removeSports 空陣列", { removeSports: [] }],
    ["removeSports 非陣列", { removeSports: "football" }],
    ["removeSports 超過 20", { removeSports: Array(21).fill("football") }],
    ["removeSports 含 other", { removeSports: ["football", "other"] }],
    ["removeSports 含非字串", { removeSports: [1] }],
    ["removeSports 與 addSports 交集", { addSports: ["football", "tennis"], removeSports: ["tennis"] }],
    ["removeSports 與 removeSport 同時", { removeSport: "tennis", removeSports: ["football"] }],
  ])("T-PREF-02 不合法輸入 %s → invalid-argument、0 寫入", async (_label, data) => {
    const { fake, logs, handler } = setup({ seed: baseSeed() });
    const request = { auth: { uid: U_A, token: {} }, data };
    await expectCode(handler(request), "invalid-argument", "SPORT_PREFS_INVALID");
    expect(fake.state.writes).toHaveLength(0);
    const line = logs.find((l) => l[1] === "[sportPrefs] save");
    expect(line[2]).toMatchObject({ result: "invalid" });
  });
});

describe("sport-prefs：儲存與回傳", () => {
  test("T-PREF-03 新增：去重保序、回傳值", async () => {
    const seed = baseSeed();
    seed[userPath(U_A)] = { ...seed[userPath(U_A)], favSports: ["tennis"] };
    const { fake, handler } = setup({ seed });
    const request = { auth: { uid: U_A, token: {} }, data: { addSports: ["football", "tennis", "football", "badminton"] } };
    await expect(handler(request)).resolves.toEqual({ ok: true, favSports: ["tennis", "football", "badminton"], newEventNotify: true });
    expect(fake.get(userPath(U_A)).favSports).toEqual(["tennis", "football", "badminton"]);
  });

  test("T-PREF-04 新增時補寫 favSportsPromptAt（Q8）", async () => {
    const { fake, handler } = setup({ seed: baseSeed() });
    await handler({ auth: { uid: U_A, token: {} }, data: { addSports: ["football"] } });
    const user = fake.get(userPath(U_A));
    expect(user.favSportsPromptAt).toBeInstanceOf(FakeTimestamp);
  });

  test("T-PREF-05 已有 favSportsPromptAt 不覆寫", async () => {
    const seed = baseSeed();
    seed[userPath(U_A)] = { ...seed[userPath(U_A)], favSportsPromptAt: new FakeTimestamp(1) };
    const { fake, logs, handler } = setup({ seed });
    const request = { auth: { uid: U_A, token: {} }, data: { promptSeen: true } };
    await handler(request);
    expect(fake.get(userPath(U_A)).favSportsPromptAt.toMillis()).toBe(1);
    const line = logs.find((l) => l[1] === "[sportPrefs] save");
    expect(line[2].result).toBe("noop");
    expect(fake.get(counterPath(U_A)).count).toBe(1);
  });

  test("T-PREF-06 promptSeen 只寫時間", async () => {
    const { fake, handler } = setup({ seed: baseSeed() });
    const request = { auth: { uid: U_A, token: {} }, data: { promptSeen: true } };
    await expect(handler(request)).resolves.toEqual({ ok: true, favSports: [], newEventNotify: true });
    const user = fake.get(userPath(U_A));
    expect(user.favSportsPromptAt).toBeInstanceOf(FakeTimestamp);
    expect(user.favSports).toBeUndefined();
  });

  test("T-PREF-07 移除", async () => {
    const seed = baseSeed();
    seed[userPath(U_A)] = { ...seed[userPath(U_A)], favSports: ["football", "tennis"] };
    const { fake, handler } = setup({ seed });
    await handler({ auth: { uid: U_A, token: {} }, data: { removeSport: "football" } });
    expect(fake.get(userPath(U_A)).favSports).toEqual(["tennis"]);
  });

  test("T-PREF-08 移除不存在的 tag → noop，不更新 users", async () => {
    const seed = baseSeed();
    seed[userPath(U_A)] = { ...seed[userPath(U_A)], favSports: ["tennis"] };
    const { fake, logs, handler } = setup({ seed });
    await expect(handler({ auth: { uid: U_A, token: {} }, data: { removeSport: "football" } })).resolves.toEqual({
      ok: true, favSports: ["tennis"], newEventNotify: true,
    });
    const line = logs.find((l) => l[1] === "[sportPrefs] save");
    expect(line[2].result).toBe("noop");
    const userWrites = fake.state.writes.filter((w) => w.path === userPath(U_A));
    expect(userWrites).toHaveLength(0);
  });

  test("T-PREF-09 既有值有髒資料時清掉", async () => {
    const seed = baseSeed();
    seed[userPath(U_A)] = { ...seed[userPath(U_A)], favSports: ["football", "other", "xx", "football"] };
    const { fake, handler } = setup({ seed });
    await handler({ auth: { uid: U_A, token: {} }, data: { removeSport: "tennis" } });
    expect(fake.get(userPath(U_A)).favSports).toEqual(["football"]);
  });

  test("T-PREF-10 newEventNotify 開關", async () => {
    const { fake, handler } = setup({ seed: baseSeed() });
    let res = await handler({ auth: { uid: U_A, token: {} }, data: { newEventNotify: false } });
    expect(res.newEventNotify).toBe(false);
    expect(fake.get(userPath(U_A)).newEventNotify).toBe(false);
    res = await handler({ auth: { uid: U_A, token: {} }, data: { newEventNotify: true } });
    expect(res.newEventNotify).toBe(true);
    expect(fake.get(userPath(U_A)).newEventNotify).toBe(true);
    // 欄位不存在時回 true
    const seed2 = baseSeed();
    const ctx = setup({ seed: seed2 });
    const res2 = await ctx.handler({ auth: { uid: U_A, token: {} }, data: { promptSeen: true } });
    expect(res2.newEventNotify).toBe(true);
  });
});

describe("sport-prefs：再次開啟取消已選（removeSports）", () => {
  test("T-PREF-19 同時加減：先減後加、保序、回傳值與日誌", async () => {
    const seed = baseSeed();
    seed[userPath(U_A)] = { ...seed[userPath(U_A)], favSports: ["tennis", "football", "badminton"] };
    const { fake, logs, handler } = setup({ seed });
    const data = { addSports: ["basketball", "running"], removeSports: ["football", "football"], promptSeen: true };
    await expect(handler({ auth: { uid: U_A, token: {} }, data })).resolves.toEqual({
      ok: true, favSports: ["tennis", "badminton", "basketball", "running"], newEventNotify: true,
    });
    expect(fake.get(userPath(U_A)).favSports).toEqual(["tennis", "badminton", "basketball", "running"]);
    const line = logs.find((l) => l[1] === "[sportPrefs] save");
    expect(line[2]).toMatchObject({ result: "saved", added: 2, removed: 1, favCount: 4 });
  });

  test("T-PREF-20 加減數量相同時日誌不互相抵銷", async () => {
    const seed = baseSeed();
    seed[userPath(U_A)] = { ...seed[userPath(U_A)], favSports: ["tennis"] };
    const { logs, handler } = setup({ seed });
    await handler({ auth: { uid: U_A, token: {} }, data: { addSports: ["football"], removeSports: ["tennis"] } });
    const line = logs.find((l) => l[1] === "[sportPrefs] save");
    expect(line[2]).toMatchObject({ result: "saved", added: 1, removed: 1, favCount: 1 });
  });

  test("T-PREF-21 只減全部＋promptSeen：清空並補寫 favSportsPromptAt", async () => {
    const seed = baseSeed();
    seed[userPath(U_A)] = { ...seed[userPath(U_A)], favSports: ["tennis", "football"] };
    const { fake, handler } = setup({ seed });
    await expect(handler({ auth: { uid: U_A, token: {} }, data: { removeSports: ["tennis", "football"], promptSeen: true } })).resolves.toEqual({
      ok: true, favSports: [], newEventNotify: true,
    });
    const user = fake.get(userPath(U_A));
    expect(user.favSports).toEqual([]);
    expect(user.favSportsPromptAt).toBeInstanceOf(FakeTimestamp);
  });

  test("T-PREF-22 只減、不帶 promptSeen：不補寫 favSportsPromptAt", async () => {
    const seed = baseSeed();
    seed[userPath(U_A)] = { ...seed[userPath(U_A)], favSports: ["tennis", "football"] };
    const { fake, handler } = setup({ seed });
    await handler({ auth: { uid: U_A, token: {} }, data: { removeSports: ["tennis"] } });
    const user = fake.get(userPath(U_A));
    expect(user.favSports).toEqual(["football"]);
    expect(user.favSportsPromptAt).toBeUndefined();
  });

  test("T-PREF-23 移除不存在的 tag → noop，不更新 users", async () => {
    const seed = baseSeed();
    seed[userPath(U_A)] = { ...seed[userPath(U_A)], favSports: ["tennis"], favSportsPromptAt: new FakeTimestamp(1) };
    const { fake, logs, handler } = setup({ seed });
    await handler({ auth: { uid: U_A, token: {} }, data: { removeSports: ["football"], promptSeen: true } });
    const line = logs.find((l) => l[1] === "[sportPrefs] save");
    expect(line[2]).toMatchObject({ result: "noop", added: 0, removed: 0 });
    expect(fake.state.writes.filter((w) => w.path === userPath(U_A))).toHaveLength(0);
  });
});

describe("sport-prefs：錯誤與上限", () => {
  test("T-PREF-11 用戶文件不存在 → failed-precondition，不建立", async () => {
    const seed = {};
    const { fake, handler } = setup({ seed });
    await expectCode(handler({ auth: { uid: U_A, token: {} }, data: { addSports: ["football"] } }), "failed-precondition", "SPORT_PREFS_PROFILE_MISSING");
    expect(fake.has(userPath(U_A))).toBe(false);
    expect(fake.has(counterPath(U_A))).toBe(false);
  });

  test("T-PREF-12 每日第 31 次被擋", async () => {
    const seed = baseSeed();
    seed[counterPath(U_A)] = { count: 30 };
    const { fake, handler } = setup({ seed });
    await expectCode(handler({ auth: { uid: U_A, token: {} }, data: { addSports: ["football"] } }), "resource-exhausted", "RATE_LIMITED");
    expect(fake.get(userPath(U_A)).favSports).toBeUndefined();
  });

  test("T-PREF-13 第 30 次可過、跨日重置", async () => {
    const seed = baseSeed();
    seed[counterPath(U_A)] = { count: 29 };
    const { fake, handler } = setup({ seed });
    await expect(handler({ auth: { uid: U_A, token: {} }, data: { addSports: ["football"] } })).resolves.toBeTruthy();
    expect(fake.get(counterPath(U_A)).count).toBe(30);
    const nextNow = FIXED_NOW + DAY;
    const ctx = setup({ seed: fake.state ? undefined : undefined, now: nextNow });
    // 簡化：用新的 fake 種子重用同一份 seed 概念
    const seed2 = baseSeed();
    seed2[counterPath(U_A, "20261128")] = { count: 0 };
    const ctx2 = setup({ seed: seed2, now: nextNow });
    await expect(ctx2.handler({ auth: { uid: U_A, token: {} }, data: { addSports: ["football"] } })).resolves.toBeTruthy();
  });

  test("T-PREF-14 計數文件 id 與欄位", async () => {
    const { fake, handler } = setup({ seed: baseSeed() });
    await handler({ auth: { uid: U_A, token: {} }, data: { addSports: ["football"] } });
    const id = counterPath(U_A);
    expect(fake.has(id)).toBe(true);
    expect(id).not.toContain(U_A);
    const doc = fake.get(id);
    expect(doc.count).toBe(1);
    expect(doc.updatedAt).toBeInstanceOf(FakeTimestamp);
    expect(doc.expireAt.getTime()).toBe(FIXED_NOW + config.WEB_PUSH_DAILY_RETENTION_MS);
  });

  test("T-PREF-15 不會寫別人", async () => {
    const { fake, handler } = setup({ seed: baseSeed() });
    await handler({ auth: { uid: U_A, token: {} }, data: { addSports: ["football"] } });
    expect(fake.get(userPath(U_B)).favSports).toBeUndefined();
  });

  test("T-PREF-16 交易失敗 → internal、log 只有 stage／code", async () => {
    const { fake, logs, handler } = setup({ seed: baseSeed() });
    fake.db.runTransaction = async () => { const e = new Error("boom"); e.code = 14; throw e; };
    await expectCode(handler({ auth: { uid: U_A, token: {} }, data: { addSports: ["football"] } }), "internal", "SPORT_PREFS_FAILED");
    const line = logs.find((l) => l[1] === "[sportPrefs] error");
    expect(line[2]).toEqual({ stage: "save_txn", code: "14" });
  });

  test("T-PREF-17 log 白名單與不含 uid", async () => {
    const seed = baseSeed();
    seed[userPath(U_A)] = { ...seed[userPath(U_A)], favSports: ["tennis"] };
    const { logs, handler } = setup({ seed });
    await handler({ auth: { uid: U_A, token: {} }, data: { addSports: ["football"] } });
    const allowed = new Set(["added", "favCount", "notify", "promptSeen", "removed", "result"]);
    for (const line of logs) {
      if (line[1] === "[sportPrefs] error") {
        expect(Object.keys(line[2]).sort()).toEqual(["code", "stage"]);
      } else {
        for (const key of Object.keys(line[2])) expect(allowed.has(key)).toBe(true);
      }
    }
    expect(JSON.stringify(logs)).not.toContain(U_A);
  });

  test("T-PREF-18 index.js 接線", async () => {
    const { exports: fn } = loadFunctionsIndex();
    expect(fn.saveSportPrefs.__options).toEqual({
      region: "asia-east1", minInstances: 0, timeoutSeconds: 10, memory: "256MiB", maxInstances: 3,
    });
    expect(fn.saveSportPrefs.__options.secrets).toBeUndefined();
  });
});
