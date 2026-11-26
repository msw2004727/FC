"use strict";

/**
 * F3b：new-event-notify 單元測試（規格 §4.4 全部 T-NE-*）。
 *
 * 本檔對照附件產品碼實際匯出與行為撰寫。與 spec.md 文字不一致處（照規格寫測試，並在此列出）：
 * 1. spec §4.2.1 log 表寫「[newEventPending] 的 sportTag 只有 queued 帶」，實際產品碼 skipped／deduped
 *    也會帶 sportTag: ""；本檔只檢查鍵集合，不鎖「只有 queued 才有 sportTag」。
 * 2. spec §4.2.2 寫 ready 逐筆讀 events 用 Promise.all；實際產品碼是 for-of 逐筆 await。本檔只驗行為，
 *    不驗並行方式。
 * 3. spec §4.2.2 寫訂閱查詢同時最多 5 組；實際產品碼是逐組 await。本檔只驗每組 <= 30 與失敗處理。
 * 4. spec §4.2.2 寫 capped 條件含「還有沒查的組且已滿 500」；實際產品碼先查完所有組才 cap。
 *    本檔以「候選 > 500 時 recipients 500、capped true」驗證。
 * 5. spec §4.2.2 寫標記建立後「成功或撞號都寫 markerExists=true」；實際產品碼確實在 fulfilled／
 *    already-exists 時寫 true，本檔照此驗證。
 */

const fs = require("fs");
const path = require("path");

const {
  createFakeFirestore,
  FakeTimestamp,
  FieldValue,
  loadFunctionsIndex,
} = require("./registration-callable-harness");
const config = require("../../functions/web-push-config");
const validate = require("../../functions/web-push-validate");
const catalog = require("../../functions/sport-catalog");
const core = require("../../functions/new-event-notify-core");
const notify = require("../../functions/new-event-notify");

const T0 = Date.UTC(2026, 10, 27, 4, 0); // 台北 2026-11-27（五）12:00
const DAY_KEY = "20261127";
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const HOST = "U" + "h".repeat(32);
const U1 = "U" + "1".repeat(32);
const U2 = "U" + "2".repeat(32);
const U3 = "U" + "3".repeat(32);
const U4 = "U" + "4".repeat(32);
const U5 = "U" + "5".repeat(32);
const U6 = "U" + "6".repeat(32);
const U7 = "U" + "7".repeat(32);
const U8 = "U" + "8".repeat(32);
const U9 = "U" + "9".repeat(32);

const SETTINGS = { ...config, WEB_PUSH_VAPID_KEY_ID: "k".repeat(16) };

function ev(id, extra = {}) {
  return {
    creatorUid: HOST,
    sportTag: "football",
    status: "open",
    privateEvent: false,
    teamOnly: false,
    type: "play",
    regionEnabled: true,
    region: "北部",
    cities: ["台北市"],
    startTimestamp: new FakeTimestamp(T0 + 2 * DAY),
    title: "種子活動標題-不可外洩",
    ...extra,
  };
}

function pending(id, ageMs = 11 * MIN, nowMs = T0) {
  return {
    eventId: id,
    createdAt: new FakeTimestamp(nowMs - ageMs),
    expireAt: new Date(nowMs + DAY),
  };
}

function user(uid, extra = {}) {
  return { favSports: ["football"], region: "台北市", ...extra };
}

function sub(uid, n) {
  return {
    uid,
    vapidKeyId: SETTINGS.WEB_PUSH_VAPID_KEY_ID,
    endpoint: "https://fcm.googleapis.com/fcm/send/seed-endpoint-" + n,
  };
}

function put(seed, p, data) {
  seed[p] = data;
  return seed;
}

function withEvent(seed, id, extra = {}) {
  return put(seed, `events/${id}`, ev(id, extra));
}

function withPending(seed, id, ageMs = 11 * MIN, nowMs = T0) {
  return put(seed, `newEventPending/${id}`, pending(id, ageMs, nowMs));
}

function withUser(seed, uid, extra = {}) {
  return put(seed, `users/${uid}`, user(uid, extra));
}

function withSub(seed, uid, n) {
  return put(seed, `webPushSubscriptions/s${n}`, sub(uid, n));
}

function controlSeed() {
  return { sendEnabled: true, newEventEnabled: true };
}

function queueDocs(fake) {
  return fake.list(config.WEB_PUSH_COLLECTIONS.queue).map((id) => ({
    id,
    data: fake.get(`${config.WEB_PUSH_COLLECTIONS.queue}/${id}`),
  }));
}

function queueIdFor(uid, sport = "football", dayKey = DAY_KEY) {
  return core.queueIdOf({ dayKey, sportTag: sport, uid });
}

function markerIdFor(sport, city, dayKey = DAY_KEY) {
  return core.dailyMarkerIdOf({ dayKey, sportTag: sport, city });
}

function makeLogger() {
  const logs = [];
  const logger = {
    info: (tag, fields) => logs.push({ level: "info", tag, fields: fields || {} }),
    warn: (tag, fields) => logs.push({ level: "warn", tag, fields: fields || {} }),
    error: (tag, fields) => logs.push({ level: "error", tag, fields: fields || {} }),
  };
  return { logs, logger };
}

async function runDispatch(fake, opts = {}) {
  const { logs, logger } = makeLogger();
  const nowMs = opts.nowMs ?? T0;
  const handler = notify.createDispatchNewEventNoticesHandler({
    db: opts.db || fake.db,
    FieldValue,
    logger,
    now: () => nowMs,
    settings: opts.settings || SETTINGS,
  });
  await handler({});
  return { logs };
}

async function runTrigger(fake, opts = {}) {
  const { logs, logger } = makeLogger();
  const eventId = opts.eventId;
  const data = opts.data;
  const handler = notify.createQueueNewEventNoticeHandler({
    db: opts.db || fake.db,
    FieldValue,
    logger,
    now: () => opts.nowMs ?? T0,
  });
  await handler({
    data: { data: () => data },
    params: { eventId },
  });
  return { logs };
}

function findLog(logs, tag, level) {
  return logs.find((entry) => entry.tag === tag && (!level || entry.level === level));
}

function findRunLog(logs) {
  return findLog(logs, notify.LOG_RUN || "[newEventDispatch] run", "info");
}

describe("F3b 觸發器 queueNewEventNotice", () => {
  test("T-NE-01 公開活動寫待處理", async () => {
    const fake = createFakeFirestore({});
    await runTrigger(fake, { eventId: "ce_1", data: ev("ce_1") });

    expect(fake.has("newEventPending/ce_1")).toBe(true);
    const doc = fake.get("newEventPending/ce_1");
    expect(Object.keys(doc).sort()).toEqual(["createdAt", "eventId", "expireAt"]);
    expect(doc.eventId).toBe("ce_1");
    expect(doc.createdAt).toBeInstanceOf(FakeTimestamp);
    expect(doc.expireAt.getTime()).toBe(T0 + core.NEW_EVENT_PENDING_RETENTION_MS);
  });

  test.each([
    ["私密", "ce_1", ev("ce_1", { privateEvent: true }), "private"],
    ["俱樂部限定", "ce_1", ev("ce_1", { teamOnly: true }), "team_only"],
    ["external", "ce_1", ev("ce_1", { type: "external" }), "external"],
    ["other", "ce_1", ev("ce_1", { sportTag: "other" }), "sport"],
    ["sportTag 缺", "ce_1", (() => { const d = ev("ce_1"); delete d.sportTag; return d; })(), "sport"],
    ["sportTag xx", "ce_1", ev("ce_1", { sportTag: "xx" }), "sport"],
    ["doc id 空白", "a b", ev("a b"), "bad_id"],
    ["doc id 過長", "x".repeat(65), ev("x".repeat(65)), "bad_id"],
  ])("T-NE-02 不寫：%s", async (_name, eventId, data, reason) => {
    const fake = createFakeFirestore({});
    const { logs } = await runTrigger(fake, { eventId, data });

    expect(fake.state.writes.length).toBe(0);
    expect(fake.list("newEventPending")).toEqual([]);
    const log = findLog(logs, "[newEventPending]", "info");
    expect(log.fields.outcome).toBe("skipped");
    expect(log.fields.reason).toBe(reason);
  });

  test("T-NE-03 重複觸發去重", async () => {
    const fake = createFakeFirestore({
      "newEventPending/ce_1": pending("ce_1"),
    });
    const { logs } = await runTrigger(fake, { eventId: "ce_1", data: ev("ce_1") });

    expect(fake.state.writes.length).toBe(0);
    const log = findLog(logs, "[newEventPending]", "info");
    expect(log.fields.outcome).toBe("deduped");
  });

  test("T-NE-04 寫入失敗只記 log、handler 不 reject", async () => {
    const fake = createFakeFirestore({});
    const db = {
      collection: (name) => {
        if (name === core.NEW_EVENT_PENDING_COLLECTION) {
          return {
            doc: () => ({
              create: async () => { throw { code: 14 }; },
            }),
          };
        }
        return fake.db.collection(name);
      },
    };

    await expect(runTrigger(fake, { eventId: "ce_1", data: ev("ce_1"), db })).resolves.toBeTruthy();
    const { logs } = await runTrigger(fake, { eventId: "ce_1", data: ev("ce_1"), db });
    const error = findLog(logs, "[newEventDispatch] error", "error");
    expect(error.fields).toEqual({ stage: "pending_create", code: "14" });
    expect(fake.state.writes.length).toBe(0);
  });
});

describe("F3b 開關與安靜時段", () => {
  test.each([
    ["control 不存在", undefined, SETTINGS],
    ["sendEnabled false", { sendEnabled: false, newEventEnabled: true }, SETTINGS],
    ["newEventEnabled false", { sendEnabled: true, newEventEnabled: false }, SETTINGS],
    ["newEventEnabled 缺", { sendEnabled: true }, SETTINGS],
    ["sendEnabled 非 true", { sendEnabled: "true", newEventEnabled: true }, SETTINGS],
    ["環境開關 false", controlSeed(), { ...SETTINGS, WEB_PUSH_SENDER_ENABLED: false }],
  ])("T-NE-10 兩把開關任一關閉 → 零佇列：%s", async (_name, control, settings) => {
    const seed = {
      "newEventPending/ce_1": pending("ce_1"),
      "events/ce_1": ev("ce_1"),
      [`users/${U1}`]: user(U1),
      "webPushSubscriptions/s1": sub(U1, 1),
    };
    if (control) seed["webPushControl/sender"] = control;
    const fake = createFakeFirestore(seed);
    const { logs } = await runDispatch(fake, { settings });

    expect(fake.state.writes.length).toBe(0);
    expect(queueDocs(fake)).toEqual([]);
    expect(fake.has("newEventPending/ce_1")).toBe(true);
    const run = findRunLog(logs);
    expect(run.fields.reason).toBe("disabled");
  });

  test("T-NE-11 讀開關失敗 = 關", async () => {
    const fake = createFakeFirestore({
      "newEventPending/ce_1": pending("ce_1"),
      "events/ce_1": ev("ce_1"),
    });
    const db = {
      collection: (name) => {
        if (name === config.WEB_PUSH_COLLECTIONS.control) {
          return { doc: () => ({ get: async () => { throw { code: 14 }; } }) };
        }
        return fake.db.collection(name);
      },
    };
    const { logs } = await runDispatch(fake, { db });

    expect(fake.state.writes.length).toBe(0);
    expect(queueDocs(fake)).toEqual([]);
    const error = findLog(logs, "[newEventDispatch] error", "error");
    expect(error.fields.stage).toBe("control_read");
  });

  test.each([
    ["22:59", Date.UTC(2026, 10, 27, 14, 59), true],
    ["23:00", Date.UTC(2026, 10, 27, 15, 0), false],
    ["07:59", Date.UTC(2026, 10, 27, 23, 59), false],
    ["08:00", Date.UTC(2026, 10, 28, 0, 0), true],
  ])("T-NE-12 安靜時段邊界 %s", async (_name, nowMs, shouldProcess) => {
    const seed = {
      "webPushControl/sender": controlSeed(),
      "newEventPending/ce_1": pending("ce_1", 11 * MIN, nowMs),
      "events/ce_1": ev("ce_1", { startTimestamp: new FakeTimestamp(nowMs + 2 * DAY) }),
      [`users/${U1}`]: user(U1),
      "webPushSubscriptions/s1": sub(U1, 1),
    };
    const fake = createFakeFirestore(seed);
    const { logs } = await runDispatch(fake, { nowMs });

    if (shouldProcess) {
      expect(queueDocs(fake).length).toBe(1);
      expect(findRunLog(logs).fields.reason).toBe("");
    } else {
      expect(fake.state.reads.direct).toBe(0);
      expect(queueDocs(fake)).toEqual([]);
      expect(findRunLog(logs).fields.reason).toBe("quiet");
    }
  });
});

describe("F3b 重讀活動與延後", () => {
  test("T-NE-20 未滿 10 分鐘不處理、不刪", async () => {
    const fake = createFakeFirestore({
      "webPushControl/sender": controlSeed(),
      "newEventPending/ce_1": pending("ce_1", 9 * MIN + 59 * 1000),
    });
    const { logs } = await runDispatch(fake);

    expect(queueDocs(fake)).toEqual([]);
    expect(fake.has("newEventPending/ce_1")).toBe(true);
    expect(findRunLog(logs).fields.young).toBe(1);
  });

  test("T-NE-21 滿 10 分鐘處理", async () => {
    const fake = createFakeFirestore({
      "webPushControl/sender": controlSeed(),
      "newEventPending/ce_1": pending("ce_1", 10 * MIN),
      "events/ce_1": ev("ce_1"),
      [`users/${U1}`]: user(U1),
      "webPushSubscriptions/s1": sub(U1, 1),
    });
    await runDispatch(fake);

    expect(queueDocs(fake).length).toBe(1);
  });

  test("T-NE-22 超過 12 小時刪除不發（Q1）", async () => {
    const fake = createFakeFirestore({
      "webPushControl/sender": controlSeed(),
      "newEventPending/ce_1": pending("ce_1", 12 * HOUR + MIN),
      "events/ce_1": ev("ce_1"),
    });
    const { logs } = await runDispatch(fake);

    expect(fake.has("newEventPending/ce_1")).toBe(false);
    expect(queueDocs(fake)).toEqual([]);
    expect(findRunLog(logs).fields.tooOld).toBe(1);
  });

  test.each([
    ["建立後刪除", "ce_1", null, "gone"],
    ["改私密", "ce_1", ev("ce_1", { privateEvent: true }), "private"],
    ["改俱樂部限定", "ce_1", ev("ce_1", { teamOnly: true }), "team_only"],
    ["改 external", "ce_1", ev("ce_1", { type: "external" }), "external"],
    ["status cancelled", "ce_1", ev("ce_1", { status: "cancelled" }), "status"],
    ["status ended", "ce_1", ev("ce_1", { status: "ended" }), "status"],
    ["開始時間已過", "ce_1", ev("ce_1", { startTimestamp: new FakeTimestamp(T0) }), "started"],
    ["缺 creatorUid", "ce_1", (() => { const d = ev("ce_1"); delete d.creatorUid; return d; })(), "no_creator"],
  ])("T-NE-23 重讀不合格：%s", async (_name, eventId, data, reason) => {
    const seed = {
      "webPushControl/sender": controlSeed(),
      [`newEventPending/${eventId}`]: pending(eventId),
    };
    if (data) seed[`events/${eventId}`] = data;
    const fake = createFakeFirestore(seed);
    const { logs } = await runDispatch(fake);

    expect(fake.has(`newEventPending/${eventId}`)).toBe(false);
    expect(queueDocs(fake)).toEqual([]);
    expect(findRunLog(logs).fields.ineligible[reason]).toBe(1);
  });

  test("T-NE-24 upcoming 也發", async () => {
    const fake = createFakeFirestore({
      "webPushControl/sender": controlSeed(),
      "newEventPending/ce_1": pending("ce_1"),
      "events/ce_1": ev("ce_1", { status: "upcoming" }),
      [`users/${U1}`]: user(U1),
      "webPushSubscriptions/s1": sub(U1, 1),
    });
    await runDispatch(fake);

    expect(queueDocs(fake).length).toBe(1);
  });
});

describe("F3b 收件人過濾", () => {
  test("T-NE-30 建立者本人不收", async () => {
    const seed = {
      "webPushControl/sender": controlSeed(),
      "newEventPending/ce_1": pending("ce_1"),
      "events/ce_1": ev("ce_1", { creatorUid: HOST }),
      [`users/${HOST}`]: user(HOST),
      [`users/${U1}`]: user(U1),
      "webPushSubscriptions/s1": sub(HOST, 1),
      "webPushSubscriptions/s2": sub(U1, 2),
    };
    const fake = createFakeFirestore(seed);
    await runDispatch(fake);

    const ids = queueDocs(fake).map((d) => d.data.recipientUid);
    expect(ids).toEqual([U1]);
  });

  test("T-NE-31 關掉開關的人不收；欄位不存在 → 收", async () => {
    const seed = {
      "webPushControl/sender": controlSeed(),
      "newEventPending/ce_1": pending("ce_1"),
      "events/ce_1": ev("ce_1"),
      [`users/${U1}`]: user(U1, { newEventNotify: false }),
      [`users/${U2}`]: user(U2),
      "webPushSubscriptions/s1": sub(U1, 1),
      "webPushSubscriptions/s2": sub(U2, 2),
    };
    const fake = createFakeFirestore(seed);
    await runDispatch(fake);

    const ids = queueDocs(fake).map((d) => d.data.recipientUid);
    expect(ids).toEqual([U2]);
  });

  test("T-NE-32 沒有訂閱、金鑰 id 不符都不收", async () => {
    const seed = {
      "webPushControl/sender": controlSeed(),
      "newEventPending/ce_1": pending("ce_1"),
      "events/ce_1": ev("ce_1"),
      [`users/${U1}`]: user(U1),
      [`users/${U2}`]: user(U2),
      [`users/${U3}`]: user(U3),
      "webPushSubscriptions/s1": { ...sub(U2, 1), vapidKeyId: "old" },
      "webPushSubscriptions/s2": sub(U3, 2),
    };
    const fake = createFakeFirestore(seed);
    await runDispatch(fake);

    const ids = queueDocs(fake).map((d) => d.data.recipientUid);
    expect(ids).toEqual([U3]);
  });

  test("T-NE-33 臺北市／台北市視為相同", async () => {
    const seed = {
      "webPushControl/sender": controlSeed(),
      "newEventPending/ce_1": pending("ce_1"),
      "newEventPending/ce_2": pending("ce_2"),
      "events/ce_1": ev("ce_1", { sportTag: "football", cities: ["臺北市"] }),
      "events/ce_2": ev("ce_2", { sportTag: "tennis", cities: ["台北市"], creatorUid: U9 }),
      [`users/${U1}`]: user(U1, { favSports: ["football"], region: "台北市" }),
      [`users/${U2}`]: user(U2, { favSports: ["tennis"], region: "臺北市" }),
      "webPushSubscriptions/s1": sub(U1, 1),
      "webPushSubscriptions/s2": sub(U2, 2),
    };
    const fake = createFakeFirestore(seed);
    await runDispatch(fake);

    const ids = queueDocs(fake).map((d) => d.data.recipientUid).sort();
    expect(ids).toEqual([U1, U2].sort());
  });

  test.each([
    ["其他", "其他"],
    ["null", null],
    ["空字串", ""],
    ["欄位不存在", undefined],
    ["火星", "火星"],
  ])("T-NE-34 沒有地區資料照收：%s", async (_name, region) => {
    const u = user(U1, { favSports: ["football"] });
    if (region === undefined) delete u.region;
    else u.region = region;
    const seed = {
      "webPushControl/sender": controlSeed(),
      "newEventPending/ce_1": pending("ce_1"),
      "events/ce_1": ev("ce_1"),
      [`users/${U1}`]: u,
      "webPushSubscriptions/s1": sub(U1, 1),
    };
    const fake = createFakeFirestore(seed);
    await runDispatch(fake);

    expect(queueDocs(fake).length).toBe(1);
  });

  test("T-NE-35 不同縣市不收", async () => {
    const seed = {
      "webPushControl/sender": controlSeed(),
      "newEventPending/ce_1": pending("ce_1"),
      "events/ce_1": ev("ce_1", { cities: ["台北市"] }),
      [`users/${U1}`]: user(U1, { region: "台中市" }),
      "webPushSubscriptions/s1": sub(U1, 1),
    };
    const fake = createFakeFirestore(seed);
    await runDispatch(fake);

    expect(queueDocs(fake)).toEqual([]);
  });

  test("T-NE-36 regionEnabled false＝全部 22 縣市", async () => {
    const seed = {
      "webPushControl/sender": controlSeed(),
      "newEventPending/ce_1": pending("ce_1"),
      "events/ce_1": ev("ce_1", { regionEnabled: false, cities: [] }),
      [`users/${U1}`]: user(U1, { region: "屏東縣" }),
      "webPushSubscriptions/s1": sub(U1, 1),
    };
    const fake = createFakeFirestore(seed);
    await runDispatch(fake);

    expect(queueDocs(fake).length).toBe(1);
    expect(fake.list(core.SPORT_NEW_EVENT_DAILY_COLLECTION).length).toBe(22);
  });

  test("T-NE-37 cities 空時用大區（Q5）", async () => {
    const seed = {
      "webPushControl/sender": controlSeed(),
      "newEventPending/ce_1": pending("ce_1"),
      "events/ce_1": ev("ce_1", { regionEnabled: true, region: "南部", cities: [] }),
      [`users/${U1}`]: user(U1, { region: "高雄市" }),
      [`users/${U2}`]: user(U2, { region: "台北市" }),
      "webPushSubscriptions/s1": sub(U1, 1),
      "webPushSubscriptions/s2": sub(U2, 2),
    };
    const fake = createFakeFirestore(seed);
    await runDispatch(fake);

    const ids = queueDocs(fake).map((d) => d.data.recipientUid);
    expect(ids).toEqual([U1]);
    expect(fake.list(core.SPORT_NEW_EVENT_DAILY_COLLECTION).length).toBe(5);
  });

  test("T-NE-38 佇列文件欄位與 id", async () => {
    const seed = {
      "webPushControl/sender": controlSeed(),
      "newEventPending/ce_1": pending("ce_1"),
      "events/ce_1": ev("ce_1", { startTimestamp: new FakeTimestamp(T0 + 2 * DAY) }),
      [`users/${U1}`]: user(U1),
      "webPushSubscriptions/s1": sub(U1, 1),
    };
    const fake = createFakeFirestore(seed);
    await runDispatch(fake);

    const id = queueIdFor(U1);
    const doc = fake.get(`${config.WEB_PUSH_COLLECTIONS.queue}/${id}`);
    expect(id).toBe(queueIdFor(U1));
    expect(id.includes(U1)).toBe(false);
    expect(doc.schema).toBe(1);
    expect(doc.source).toBe("newEvent");
    expect(doc.kind).toBe("new_event");
    expect(doc.recipientUid).toBe(U1);
    expect(doc.title).toBe("足球有新活動囉！");
    expect(doc.body).toBe("11/29（日）12:00，點開看看");
    expect(doc.url).toBe("/events/ce_1");
    expect(doc.status).toBe("pending");
    expect(doc.createdAt).toBeInstanceOf(FakeTimestamp);
    expect(doc.expireAt.getTime()).toBe(T0 + config.WEB_PUSH_QUEUE_RETENTION_MS);
  });
});

describe("F3b 當日記號與去重", () => {
  test("T-NE-40 同運動同縣市當天第二場不發", async () => {
    const seed = {
      "webPushControl/sender": controlSeed(),
      "newEventPending/ce_1": pending("ce_1"),
      "events/ce_1": ev("ce_1"),
      [`users/${U1}`]: user(U1),
      "webPushSubscriptions/s1": sub(U1, 1),
    };
    const fake = createFakeFirestore(seed);
    await runDispatch(fake);
    expect(queueDocs(fake).length).toBe(1);

    fake.put("newEventPending/ce_2", pending("ce_2"));
    fake.put("events/ce_2", ev("ce_2", { startTimestamp: new FakeTimestamp(T0 + 3 * DAY) }));
    const { logs } = await runDispatch(fake);

    expect(fake.has("newEventPending/ce_2")).toBe(false);
    expect(queueDocs(fake).length).toBe(1);
    expect(findRunLog(logs).fields.allMarked).toBe(1);
  });

  test("T-NE-41 不同縣市各自發", async () => {
    const seed = {
      "webPushControl/sender": controlSeed(),
      "newEventPending/ce_1": pending("ce_1"),
      "events/ce_1": ev("ce_1"),
      [`users/${U1}`]: user(U1, { region: "台北市" }),
      [`users/${U2}`]: user(U2, { region: "台中市" }),
      "webPushSubscriptions/s1": sub(U1, 1),
      "webPushSubscriptions/s2": sub(U2, 2),
    };
    const fake = createFakeFirestore(seed);
    await runDispatch(fake);
    expect(queueDocs(fake).map((d) => d.data.recipientUid)).toEqual([U1]);

    fake.put("newEventPending/ce_2", pending("ce_2"));
    fake.put("events/ce_2", ev("ce_2", { cities: ["台中市"], startTimestamp: new FakeTimestamp(T0 + 3 * DAY) }));
    await runDispatch(fake);

    const ids = queueDocs(fake).map((d) => d.data.recipientUid).sort();
    expect(ids).toEqual([U1, U2].sort());
  });

  test("T-NE-42 同人跨縣市同天同運動只一則", async () => {
    const seed = {
      "webPushControl/sender": controlSeed(),
      "newEventPending/ce_1": pending("ce_1"),
      "newEventPending/ce_2": pending("ce_2"),
      "events/ce_1": ev("ce_1", { cities: ["台北市"], creatorUid: HOST }),
      "events/ce_2": ev("ce_2", { cities: ["台中市"], creatorUid: U9 }),
      [`users/${U1}`]: user(U1, { region: null }),
      "webPushSubscriptions/s1": sub(U1, 1),
    };
    const fake = createFakeFirestore(seed);
    const { logs } = await runDispatch(fake);

    expect(queueDocs(fake).length).toBe(1);
    const expanded = logs.filter((entry) => entry.tag === "[newEventDispatch] expanded");
    expect(expanded.some((entry) => entry.fields.deduped === 1)).toBe(true);
  });

  test("T-NE-43 查不到收件人不建記號", async () => {
    const seed = {
      "webPushControl/sender": controlSeed(),
      "newEventPending/ce_1": pending("ce_1"),
      "events/ce_1": ev("ce_1"),
    };
    const fake = createFakeFirestore(seed);
    await runDispatch(fake);

    expect(fake.list(core.SPORT_NEW_EVENT_DAILY_COLLECTION)).toEqual([]);

    fake.put(`users/${U1}`, user(U1));
    fake.put("webPushSubscriptions/s1", sub(U1, 1));
    fake.put("newEventPending/ce_2", pending("ce_2"));
    fake.put("events/ce_2", ev("ce_2", { startTimestamp: new FakeTimestamp(T0 + 3 * DAY) }));
    await runDispatch(fake);

    expect(queueDocs(fake).length).toBe(1);
  });

  test("T-NE-44 全部去重也建記號（Q3）", async () => {
    const seed = {
      "webPushControl/sender": controlSeed(),
      "newEventPending/ce_1": pending("ce_1"),
      "events/ce_1": ev("ce_1"),
      [`users/${U1}`]: user(U1),
      "webPushSubscriptions/s1": sub(U1, 1),
      [`${config.WEB_PUSH_COLLECTIONS.queue}/${queueIdFor(U1)}`]: { seeded: true },
    };
    const fake = createFakeFirestore(seed);
    const { logs } = await runDispatch(fake);

    const markerId = markerIdFor("football", "台北市");
    expect(fake.has(`${core.SPORT_NEW_EVENT_DAILY_COLLECTION}/${markerId}`)).toBe(true);
    const expanded = findLog(logs, "[newEventDispatch] expanded", "info");
    expect(expanded.fields.queued).toBe(0);
    expect(expanded.fields.deduped).toBe(1);
  });

  test("T-NE-45 記號文件欄位與 id", async () => {
    const seed = {
      "webPushControl/sender": controlSeed(),
      "newEventPending/ce_1": pending("ce_1"),
      "events/ce_1": ev("ce_1"),
      [`users/${U1}`]: user(U1),
      "webPushSubscriptions/s1": sub(U1, 1),
    };
    const fake = createFakeFirestore(seed);
    await runDispatch(fake);

    const markerId = core.sha256Hex32("20261127|football|台北市");
    const doc = fake.get(`${core.SPORT_NEW_EVENT_DAILY_COLLECTION}/${markerId}`);
    expect(markerId).toBe(markerIdFor("football", "台北市"));
    expect(doc.date).toBe("20261127");
    expect(doc.sportTag).toBe("football");
    expect(doc.city).toBe("台北市");
    expect(doc.createdAt).toBeInstanceOf(FakeTimestamp);
    expect(doc.expireAt.getTime()).toBe(T0 + core.SPORT_NEW_EVENT_DAILY_RETENTION_MS);
  });

  test("T-NE-46 入列非撞號失敗 → 留待處理、不建記號、不扣次數（Q4）", async () => {
    const seed = {
      "webPushControl/sender": controlSeed(),
      "newEventPending/ce_1": pending("ce_1"),
      "events/ce_1": ev("ce_1"),
      [`users/${U1}`]: user(U1),
      [`users/${U2}`]: user(U2),
      "webPushSubscriptions/s1": sub(U1, 1),
      "webPushSubscriptions/s2": sub(U2, 2),
    };
    const fake = createFakeFirestore(seed);
    const db = {
      collection: (name) => {
        if (name === config.WEB_PUSH_COLLECTIONS.queue) {
          const real = fake.db.collection(name);
          return {
            doc: (id) => ({
              create: async (data) => {
                if (id.includes(validate.uidHashOf(U2))) throw { code: 14 };
                return real.doc(id).create(data);
              },
            }),
          };
        }
        return fake.db.collection(name);
      },
    };

    const { logs } = await runDispatch(fake, { db });
    expect(fake.has("newEventPending/ce_1")).toBe(true);
    expect(fake.list(core.SPORT_NEW_EVENT_DAILY_COLLECTION)).toEqual([]);
    expect(fake.list(config.WEB_PUSH_COLLECTIONS.daily).some((id) => id.startsWith("nehost_"))).toBe(false);
    const expanded = findLog(logs, "[newEventDispatch] expanded", "warn");
    expect(expanded.fields.failed).toBe(1);

    const fake2 = createFakeFirestore({});
    // 第二次用乾淨 fake 重現「U1 已存在、U2 這次成功」：先放 U1 佇列
    fake2.put(`${config.WEB_PUSH_COLLECTIONS.queue}/${queueIdFor(U1)}`, { seeded: true });
    const seed2 = {
      ...seed,
      [`${config.WEB_PUSH_COLLECTIONS.queue}/${queueIdFor(U1)}`]: { seeded: true },
    };
    const fake3 = createFakeFirestore(seed2);
    await runDispatch(fake3);
    expect(fake3.has("newEventPending/ce_1")).toBe(false);
    expect(fake3.list(core.SPORT_NEW_EVENT_DAILY_COLLECTION).length).toBe(1);
    expect(fake3.list(config.WEB_PUSH_COLLECTIONS.daily).some((id) => id.startsWith("nehost_"))).toBe(true);
  });
});

describe("F3b 批次、建立者、上限", () => {
  test("T-NE-50 批次 30 場只發最近一場", async () => {
    const seed = {
      "webPushControl/sender": controlSeed(),
      [`users/${U1}`]: user(U1, { region: "台北市" }),
      [`users/${U2}`]: user(U2, { region: "新北市" }),
      "webPushSubscriptions/s1": sub(U1, 1),
      "webPushSubscriptions/s2": sub(U2, 2),
    };
    const order = Array.from({ length: 30 }, (_, k) => k);
    // 種子順序打亂
    order.sort((a, b) => ((a * 17) % 31) - ((b * 17) % 31));
    for (const k of order) {
      const id = `ce_batch_${k}`;
      seed[`events/${id}`] = ev(id, {
        startTimestamp: new FakeTimestamp(T0 + (k + 1) * HOUR),
        cities: ["台北市", "新北市", "基隆市", "桃園市", "新竹市", "新竹縣", "宜蘭縣"],
      });
      seed[`newEventPending/${id}`] = pending(id);
    }
    const fake = createFakeFirestore(seed);
    const { logs } = await runDispatch(fake);

    const docs = queueDocs(fake);
    expect(docs.length).toBe(2);
    expect(new Set(docs.map((d) => d.data.url))).toEqual(new Set(["/events/ce_batch_0"]));
    expect(fake.list(core.SPORT_NEW_EVENT_DAILY_COLLECTION).length).toBe(7);
    expect(fake.list("newEventPending").length).toBe(0);
    const creatorId = core.creatorCounterIdOf({ dayKey: DAY_KEY, uid: HOST });
    expect(fake.get(`${config.WEB_PUSH_COLLECTIONS.daily}/${creatorId}`).count).toBe(1);
    expect(findRunLog(logs).fields.allMarked).toBe(29);
  });

  test("T-NE-51 建立者第 3 次不展開", async () => {
    const sports = ["football", "tennis", "badminton"];
    const seed = {
      "webPushControl/sender": controlSeed(),
      [`users/${U1}`]: user(U1, { favSports: sports, region: "台北市" }),
      "webPushSubscriptions/s1": sub(U1, 1),
    };
    sports.forEach((sport, i) => {
      const id = `ce_creator_${i}`;
      seed[`events/${id}`] = ev(id, {
        sportTag: sport,
        creatorUid: HOST,
        startTimestamp: new FakeTimestamp(T0 + (i + 1) * HOUR),
      });
      seed[`newEventPending/${id}`] = pending(id);
    });
    const fake = createFakeFirestore(seed);
    const { logs } = await runDispatch(fake);

    const urls = queueDocs(fake).map((d) => d.data.url).sort();
    expect(urls).toEqual(["/events/ce_creator_0", "/events/ce_creator_1"]);
    expect(findRunLog(logs).fields.creatorLimit).toBe(1);
  });

  test("T-NE-52 單次展開上限 500", async () => {
    const seed = {
      "webPushControl/sender": controlSeed(),
      "newEventPending/ce_1": pending("ce_1"),
      "events/ce_1": ev("ce_1"),
    };
    for (let i = 0; i < 520; i += 1) {
      const uid = "U" + String(i).padStart(3, "0") + "x".repeat(28);
      seed[`users/${uid}`] = user(uid);
      seed[`webPushSubscriptions/s${i}`] = sub(uid, i);
    }
    const fake = createFakeFirestore(seed);
    const { logs } = await runDispatch(fake);

    expect(queueDocs(fake).length).toBe(500);
    const expanded = findLog(logs, "[newEventDispatch] expanded", "warn");
    expect(expanded.fields.capped).toBe(true);
  }, 30000);

  test("T-NE-52b 湊滿 500 位就停止查訂閱（不查後面的組）", async () => {
    const seed = {
      "webPushControl/sender": controlSeed(),
      "newEventPending/ce_1": pending("ce_1"),
      "events/ce_1": ev("ce_1"),
    };
    for (let i = 0; i < 900; i += 1) {
      const uid = "U" + String(i).padStart(3, "0") + "x".repeat(28);
      seed[`users/${uid}`] = user(uid);
      seed[`webPushSubscriptions/s${i}`] = sub(uid, i);
    }
    const fake = createFakeFirestore(seed);
    let subQueries = 0;
    const db = {
      ...fake.db,
      collection: (name) => {
        const col = fake.db.collection(name);
        if (name !== config.WEB_PUSH_COLLECTIONS.subscriptions) return col;
        return { ...col, where: (...args) => { subQueries += 1; return col.where(...args); } };
      },
    };
    const { logs } = await runDispatch(fake, { db });

    expect(queueDocs(fake).length).toBe(500);
    expect(subQueries).toBe(Math.ceil(500 / core.SUBSCRIPTION_IN_CHUNK));
    expect(findLog(logs, "[newEventDispatch] expanded", "warn").fields.capped).toBe(true);
  }, 30000);

  test("T-NE-53 每次執行最多 10 次展開（Q6）", async () => {
    const sports = catalog.FAV_SPORT_TAGS.slice(0, 12);
    const seed = {
      "webPushControl/sender": controlSeed(),
      [`users/${U1}`]: user(U1, { favSports: sports, region: "台北市" }),
      "webPushSubscriptions/s1": sub(U1, 1),
    };
    sports.forEach((sport, i) => {
      const id = `ce_many_${i}`;
      seed[`events/${id}`] = ev(id, {
        sportTag: sport,
        creatorUid: "H" + String(i).padStart(2, "0").repeat(16),
        startTimestamp: new FakeTimestamp(T0 + (i + 1) * HOUR),
      });
      seed[`newEventPending/${id}`] = pending(id);
    });
    const fake = createFakeFirestore(seed);
    const { logs } = await runDispatch(fake);

    expect(queueDocs(fake).length).toBe(10);
    expect(fake.list("newEventPending").length).toBe(2);
    expect(findRunLog(logs).fields.deferred).toBe(2);
  });

  test("T-NE-54 訂閱查詢每組最多 30 個 uid", async () => {
    const seed = {
      "webPushControl/sender": controlSeed(),
      "newEventPending/ce_1": pending("ce_1"),
      "events/ce_1": ev("ce_1"),
    };
    for (let i = 0; i < 35; i += 1) {
      const uid = "U" + String(i).padStart(2, "0") + "y".repeat(30);
      seed[`users/${uid}`] = user(uid);
      seed[`webPushSubscriptions/s${i}`] = sub(uid, i);
    }
    const fake = createFakeFirestore(seed);
    const sizes = [];
    const db = {
      collection: (name) => {
        if (name === config.WEB_PUSH_COLLECTIONS.subscriptions) {
          const real = fake.db.collection(name);
          return {
            where: (field, op, value) => {
              if (op === "in") sizes.push(value.length);
              return real.where(field, op, value);
            },
          };
        }
        return fake.db.collection(name);
      },
    };
    await runDispatch(fake, { db });

    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.every((n) => n <= 30)).toBe(true);
    expect(sizes.includes(30)).toBe(true);
  });

  test("T-NE-55 同次執行同運動用戶只查一次", async () => {
    const seed = {
      "webPushControl/sender": controlSeed(),
      "newEventPending/ce_1": pending("ce_1"),
      "newEventPending/ce_2": pending("ce_2"),
      "events/ce_1": ev("ce_1", { cities: ["台北市"], creatorUid: HOST }),
      "events/ce_2": ev("ce_2", { cities: ["台中市"], creatorUid: U9 }),
      [`users/${U1}`]: user(U1, { region: "台北市" }),
      [`users/${U2}`]: user(U2, { region: "台中市" }),
      "webPushSubscriptions/s1": sub(U1, 1),
      "webPushSubscriptions/s2": sub(U2, 2),
    };
    const fake = createFakeFirestore(seed);
    let userQueryCount = 0;
    const db = {
      collection: (name) => {
        const real = fake.db.collection(name);
        if (name === "users") {
          return {
            where: (...args) => {
              userQueryCount += 1;
              return real.where(...args);
            },
          };
        }
        return real;
      },
    };
    await runDispatch(fake, { db });

    expect(userQueryCount).toBe(1);
    expect(queueDocs(fake).length).toBe(2);
  });
});

describe("F3b 錯誤與 log", () => {
  test("T-NE-60 users 查詢失敗要記錯、不靜默、待處理留著", async () => {
    const seed = {
      "webPushControl/sender": controlSeed(),
      "newEventPending/ce_1": pending("ce_1"),
      "events/ce_1": ev("ce_1"),
    };
    const fake = createFakeFirestore(seed);
    const db = {
      collection: (name) => {
        if (name === "users") {
          return {
            where: () => ({
              select: () => ({
                get: async () => { throw { code: 9 }; },
              }),
            }),
          };
        }
        return fake.db.collection(name);
      },
    };
    const { logs } = await runDispatch(fake, { db });

    const error = findLog(logs, "[newEventDispatch] error", "error");
    expect(error.fields).toEqual({ stage: "users_query", code: "9" });
    expect(queueDocs(fake)).toEqual([]);
    expect(fake.has("newEventPending/ce_1")).toBe(true);
    expect(fake.list(config.WEB_PUSH_COLLECTIONS.daily).some((id) => id.startsWith("nehost_"))).toBe(false);
  });

  test("T-NE-61 訂閱查詢失敗同上", async () => {
    const seed = {
      "webPushControl/sender": controlSeed(),
      "newEventPending/ce_1": pending("ce_1"),
      "events/ce_1": ev("ce_1"),
      [`users/${U1}`]: user(U1),
    };
    const fake = createFakeFirestore(seed);
    const db = {
      collection: (name) => {
        if (name === config.WEB_PUSH_COLLECTIONS.subscriptions) {
          return {
            where: () => ({
              select: () => ({
                get: async () => { throw { code: 9 }; },
              }),
            }),
          };
        }
        return fake.db.collection(name);
      },
    };
    const { logs } = await runDispatch(fake, { db });

    const error = findLog(logs, "[newEventDispatch] error", "error");
    expect(error.fields).toEqual({ stage: "subs_query", code: "9" });
    expect(queueDocs(fake)).toEqual([]);
    expect(fake.has("newEventPending/ce_1")).toBe(true);
  });

  test("T-NE-62 log 不含 uid、活動代號、名稱、endpoint、縣市名", async () => {
    const seed = {
      "webPushControl/sender": controlSeed(),
      [`users/${U1}`]: user(U1, { region: "台北市" }),
      [`users/${U2}`]: user(U2, { region: "新北市" }),
      "webPushSubscriptions/s1": sub(U1, 1),
      "webPushSubscriptions/s2": sub(U2, 2),
      "newEventPending/ce_batch_0": pending("ce_batch_0"),
      "events/ce_batch_0": ev("ce_batch_0", { startTimestamp: new FakeTimestamp(T0 + HOUR) }),
      "newEventPending/ce_other_0": pending("ce_other_0"),
      "events/ce_other_0": ev("ce_other_0", { cities: ["台中市"], creatorUid: U9 }),
    };
    const fake = createFakeFirestore(seed);
    const { logs } = await runDispatch(fake);
    const text = JSON.stringify(logs);

    expect(text.includes(HOST)).toBe(false);
    expect(text.includes(U1)).toBe(false);
    expect(text.includes(U2)).toBe(false);
    expect(text.includes(validate.uidHashOf(U1))).toBe(false);
    expect(text.includes("ce_batch_0")).toBe(false);
    expect(text.includes("ce_other_0")).toBe(false);
    expect(text.includes("種子活動標題-不可外洩")).toBe(false);
    expect(text.includes("seed-endpoint")).toBe(false);
    expect(text.includes("台北市")).toBe(false);
    expect(text.includes("新北市")).toBe(false);
    expect(text.includes("有新活動囉")).toBe(false);
  });

  test("T-NE-63 log 鍵白名單", async () => {
    const seed = {
      "webPushControl/sender": controlSeed(),
      "newEventPending/ce_1": pending("ce_1"),
      "events/ce_1": ev("ce_1"),
      [`users/${U1}`]: user(U1),
      "webPushSubscriptions/s1": sub(U1, 1),
    };
    const fake = createFakeFirestore(seed);
    const { logs } = await runDispatch(fake);

    const allowed = {
      "[newEventPending]": ["outcome", "reason", "sportTag"],
      "[newEventDispatch] run": [
        "outcome", "reason", "pendingRead", "ready", "young", "tooOld", "ineligible",
        "allMarked", "creatorLimit", "expansions", "deferred", "queued", "deduped",
        "failed", "durationMs",
      ],
      "[newEventDispatch] expanded": [
        "sportTag", "cities", "candidates", "recipients", "queued", "deduped",
        "failed", "capped", "markers",
      ],
      "[newEventDispatch] error": ["stage", "code"],
    };
    for (const entry of logs) {
      expect(allowed[entry.tag]).toBeDefined();
      for (const key of Object.keys(entry.fields)) {
        expect(allowed[entry.tag]).toContain(key);
      }
    }
  });
});

describe("F3b 純函式 new-event-notify-core", () => {
  test("T-NE-70 formatStartLabel", () => {
    expect(core.formatStartLabel(Date.UTC(2026, 10, 28, 12, 0))).toBe("11/28（六）20:00");
    expect(core.formatStartLabel(Date.UTC(2026, 11, 4, 1, 5))).toBe("12/4（五）09:05");
    expect(core.formatStartLabel(Date.UTC(2026, 11, 31, 16, 0))).toBe("1/1（五）00:00");
  });

  test("T-NE-71 buildNewEventNotice 用伺服器中文名", () => {
    const badminton = core.buildNewEventNotice({
      sportTag: "badminton",
      startMs: Date.UTC(2026, 10, 28, 12, 0),
      eventId: "ce_1",
    });
    const restaurant = core.buildNewEventNotice({
      sportTag: "restaurant",
      startMs: Date.UTC(2026, 10, 28, 12, 0),
      eventId: "ce_1",
    });
    expect(badminton.title).toBe("羽球有新活動囉！");
    expect(restaurant.title).toBe("餐廳(觀賽)有新活動囉！");
    expect(config.WEB_PUSH_NEW_EVENT_URL_RE.test(badminton.url)).toBe(true);
    expect(config.WEB_PUSH_NEW_EVENT_URL_RE.test(restaurant.url)).toBe(true);
  });

  test("T-NE-72 文案不含活動自填文字", () => {
    const notice = core.buildNewEventNotice({
      sportTag: "football",
      startMs: Date.UTC(2026, 10, 28, 12, 0),
      eventId: "ce_1",
    });
    expect(notice).toEqual({
      title: "足球有新活動囉！",
      body: "11/28（六）20:00，點開看看",
      url: "/events/ce_1",
    });
  });

  test("T-NE-73 id 規則", () => {
    const queueId = core.queueIdOf({ dayKey: "20261127", sportTag: "football", uid: U1 });
    expect(queueId).toMatch(/^ne_\d{8}_[a-z_]+_[0-9a-f]{32}$/);
    const markerA = core.dailyMarkerIdOf({ dayKey: "20261127", sportTag: "football", city: "台北市" });
    const markerB = core.dailyMarkerIdOf({ dayKey: "20261127", sportTag: "football", city: "台中市" });
    expect(markerA).toMatch(/^[0-9a-f]{32}$/);
    expect(markerB).toMatch(/^[0-9a-f]{32}$/);
    expect(markerA).not.toBe(markerB);
  });

  test("T-NE-74 isQuietHour 24 小時表", () => {
    for (let h = 0; h < 24; h += 1) {
      const nowMs = Date.UTC(2026, 10, 27, 0, 0) + (h - 8) * HOUR;
      expect(core.isQuietHour(nowMs)).toBe(h >= 23 || h < 8);
    }
  });
});

describe("F3b 接線與設定", () => {
  test("T-NE-80 選項常數", () => {
    expect(notify.NEW_EVENT_TRIGGER_OPTIONS).toEqual({
      document: "events/{eventId}",
      region: "asia-east1",
      minInstances: 0,
      maxInstances: 3,
      timeoutSeconds: 30,
      memory: "256MiB",
      retry: false,
    });
    expect(notify.NEW_EVENT_DISPATCH_OPTIONS).toEqual({
      region: "asia-east1",
      schedule: "*/15 * * * *",
      timeZone: "Asia/Taipei",
      memory: "512MiB",
      timeoutSeconds: 540,
      minInstances: 0,
      maxInstances: 1,
      retryCount: 0,
    });
    expect(notify.NEW_EVENT_TRIGGER_OPTIONS.secrets).toBeUndefined();
    expect(notify.NEW_EVENT_DISPATCH_OPTIONS.secrets).toBeUndefined();
  });

  test("T-NE-81 index.js 接線", () => {
    const loaded = loadFunctionsIndex({
      stubs: {
        "firebase-functions/v2/scheduler": {
          onSchedule: (options, handler) => Object.assign(handler, { __options: options }),
        },
        "firebase-functions/v2/firestore": {
          onDocumentCreated: (options, handler) => Object.assign(handler, { __options: options }),
          onDocumentWritten: (_options, handler) => handler,
          onDocumentWrittenWithAuthContext: (_options, handler) => handler,
        },
      },
    });
    const fn = loaded.exports;
    expect(fn.queueNewEventNotice.__options).toEqual(notify.NEW_EVENT_TRIGGER_OPTIONS);
    expect(fn.dispatchNewEventNotices.__options).toEqual(notify.NEW_EVENT_DISPATCH_OPTIONS);
  });

  test("T-NE-82 TTL 設定", () => {
    const file = path.join(__dirname, "..", "..", "firestore.indexes.json");
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    const overrides = json.fieldOverrides || [];
    const byCollection = (name) => overrides.find((item) => item.collectionGroup === name);
    expect(byCollection("newEventPending").fieldPath).toBe("expireAt");
    expect(byCollection("newEventPending").ttl).toBe(true);
    expect(byCollection("sportNewEventDaily").fieldPath).toBe("expireAt");
    expect(byCollection("sportNewEventDaily").ttl).toBe(true);
    expect(byCollection("webPushDaily").ttl).toBe(true);
  });

  test("T-NE-83 沒有 LINE 呼叫、不 require web-push", () => {
    const root = path.join(__dirname, "..", "..", "functions");
    const texts = ["new-event-notify.js", "new-event-notify-core.js"]
      .map((name) => fs.readFileSync(path.join(root, name), "utf8"))
      .join("\n");
    expect(/enqueueLine|linePushQueue|pushMessage|LINE_CHANNEL/.test(texts)).toBe(false);
    expect(/require\(["']web-push["']\)/.test(texts)).toBe(false);
  });
});

describe("顧問 §3.803 條件", () => {
  test("T-NE-90 排程逾時大於時間預算＋一次 500 人展開的保守時間（80 秒）", () => {
    expect(notify.NEW_EVENT_DISPATCH_OPTIONS.timeoutSeconds * 1000)
      .toBeGreaterThan(core.RUN_TIME_BUDGET_MS + 80 * 1000);
    expect(core.MAX_RECIPIENTS_PER_EXPANSION).toBe(500);
  });
});
