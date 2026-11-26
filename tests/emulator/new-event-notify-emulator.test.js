"use strict";

/**
 * F3b：new-event-notify 模擬器測試（規格 §4.5 全部 T-EMU-*）。
 *
 * 只能在 Firestore Emulator 內執行（沒有 FIRESTORE_EMULATOR_HOST 或 project 不是 demo- 開頭就 throw，不 skip）。
 * 本檔不證明「不需複合索引」；模擬器不檢查索引。
 */

const path = require("path");

const FUNCTIONS_DIR = path.resolve(__dirname, "..", "..", "functions");
const fromFunctions = (id) => require(require.resolve(id, { paths: [FUNCTIONS_DIR] }));
const { initializeApp, deleteApp } = fromFunctions("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = fromFunctions("firebase-admin/firestore");

const config = require("../../functions/web-push-config");
const core = require("../../functions/new-event-notify-core");
const {
  createQueueNewEventNoticeHandler,
  createDispatchNewEventNoticesHandler,
} = require("../../functions/new-event-notify");

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "";
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "demo-sport-fav";

const FIXED_NOW = Date.UTC(2026, 10, 27, 4, 0); // 台北 2026-11-27（五）12:00
const FIXED_DAY_KEY = "20261127";
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

const HOST = "U" + "h".repeat(32);
const U1 = "U" + "1".repeat(32);
const U2 = "U" + "2".repeat(32);

const COLLECTIONS = [
  "events",
  "newEventPending",
  "sportNewEventDaily",
  "users",
  "webPushSubscriptions",
  "webPushQueue",
  "webPushDaily",
  "webPushControl",
];

jest.setTimeout(60000);

let app;
let db;

function makeLogger() {
  const logs = [];
  const logger = {
    info: (tag, fields) => logs.push({ level: "info", tag, fields: fields || {} }),
    warn: (tag, fields) => logs.push({ level: "warn", tag, fields: fields || {} }),
    error: (tag, fields) => logs.push({ level: "error", tag, fields: fields || {} }),
  };
  return { logs, logger };
}

async function clearAll() {
  for (const name of COLLECTIONS) {
    const snap = await db.collection(name).get();
    await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
  }
}

function eventData(id, extra = {}) {
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
    startTimestamp: Timestamp.fromMillis(FIXED_NOW + 2 * DAY),
    title: "種子活動標題-不可外洩",
    ...extra,
  };
}

beforeAll(() => {
  if (!EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST 未設定：本檔只能在 firebase emulators:exec 內執行");
  if (!PROJECT_ID.startsWith("demo-")) {
    throw new Error("project id 必須是 demo- 開頭，避免連到正式專案：" + PROJECT_ID);
  }
  app = initializeApp({ projectId: PROJECT_ID }, "new-event-notify-emulator-" + Date.now());
  db = getFirestore(app);
});

afterAll(async () => {
  if (app) await deleteApp(app);
});

beforeEach(async () => {
  await clearAll();
});

describe("new-event-notify × Firestore Emulator", () => {
  test("T-EMU-01 array-contains＋select 查詢語意", async () => {
    await db.collection("users").doc("u1").set({ favSports: ["football"], region: "台北市", newEventNotify: true });
    await db.collection("users").doc("u2").set({ favSports: ["tennis"], region: "台中市", newEventNotify: true });
    await db.collection("users").doc("u3").set({ favSports: ["football", "tennis"], region: "高雄市", newEventNotify: false });

    const snap = await db.collection("users")
      .where("favSports", "array-contains", "football")
      .select("favSports", "newEventNotify", "region")
      .get();

    expect(snap.size).toBe(2);
    const ids = snap.docs.map((doc) => doc.id).sort();
    expect(ids).toEqual(["u1", "u3"]);
    for (const doc of snap.docs) {
      expect(Object.keys(doc.data()).sort()).toEqual(["favSports", "newEventNotify", "region"]);
    }
  });

  test("T-EMU-02 in 30 個 uid 查訂閱；31 個丟錯", async () => {
    const uids = Array.from({ length: 35 }, (_, i) => "U" + String(i).padStart(2, "0") + "x".repeat(30));
    await Promise.all(uids.map((uid, i) => (
      db.collection("webPushSubscriptions").doc(`s${i}`).set({
        uid,
        vapidKeyId: config.WEB_PUSH_VAPID_KEY_ID,
        endpoint: "https://fcm.googleapis.com/fcm/send/seed-" + i,
      })
    )));

    const snap = await db.collection("webPushSubscriptions")
      .where("uid", "in", uids.slice(0, 30))
      .get();
    expect(snap.size).toBe(30);

    await expect(
      db.collection("webPushSubscriptions").where("uid", "in", uids.slice(0, 31)).get()
    ).rejects.toThrow();
  });

  test("T-EMU-03 create() 撞 id", async () => {
    const ref = db.collection("webPushQueue").doc("dup");
    await ref.create({ ok: 1 });

    let error = null;
    try {
      await ref.create({ ok: 2 });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeTruthy();
    expect(error.code === 6 || error.code === "already-exists").toBe(true);
  });

  test("T-EMU-04 觸發器 → 排程 → 佇列整條", async () => {
    const eventId = "ce_emu_1";
    const eventRef = db.collection("events").doc(eventId);
    await eventRef.set(eventData(eventId));
    const eventSnap = await eventRef.get();

    const trigger = createQueueNewEventNoticeHandler({
      db,
      FieldValue,
      logger: makeLogger().logger,
      now: () => FIXED_NOW,
    });
    await trigger({ data: eventSnap, params: { eventId } });
    expect((await db.collection("newEventPending").doc(eventId).get()).exists).toBe(true);

    await db.collection("newEventPending").doc(eventId).update({
      createdAt: Timestamp.fromMillis(FIXED_NOW - 11 * MIN),
    });

    await db.collection("webPushControl").doc("sender").set({ sendEnabled: true, newEventEnabled: true });
    await db.collection("users").doc(U1).set({ favSports: ["football"], region: "台北市" });
    await db.collection("webPushSubscriptions").doc("s1").set({
      uid: U1,
      vapidKeyId: config.WEB_PUSH_VAPID_KEY_ID,
      endpoint: "https://fcm.googleapis.com/fcm/send/seed-endpoint-1",
    });

    const dispatch = createDispatchNewEventNoticesHandler({
      db,
      FieldValue,
      logger: makeLogger().logger,
      now: () => FIXED_NOW,
    });
    await dispatch({});

    const queueId = core.queueIdOf({ dayKey: FIXED_DAY_KEY, sportTag: "football", uid: U1 });
    const queueSnap = await db.collection("webPushQueue").doc(queueId).get();
    expect(queueSnap.exists).toBe(true);
    const queue = queueSnap.data();
    expect(queue).toMatchObject({
      schema: 1,
      source: "newEvent",
      kind: "new_event",
      recipientUid: U1,
      title: "足球有新活動囉！",
      body: "11/29（日）12:00，點開看看",
      url: "/events/ce_emu_1",
      status: "pending",
    });
    expect(queue.createdAt).toBeInstanceOf(Timestamp);
    expect(queue.expireAt.toMillis()).toBe(FIXED_NOW + config.WEB_PUSH_QUEUE_RETENTION_MS);
    expect((await db.collection("sportNewEventDaily").get()).size).toBe(1);
    expect((await db.collection("newEventPending").doc(eventId).get()).exists).toBe(false);

    await dispatch({});
    expect((await db.collection("webPushQueue").get()).size).toBe(1);
  });

  test("T-EMU-05 同區兩場只發一則（真 SDK）", async () => {
    const a = "ce_emu_a";
    const b = "ce_emu_b";
    await db.collection("events").doc(a).set(eventData(a));
    await db.collection("events").doc(b).set(eventData(b, {
      startTimestamp: Timestamp.fromMillis(FIXED_NOW + 3 * DAY),
    }));
    await db.collection("newEventPending").doc(a).set({
      eventId: a,
      createdAt: Timestamp.fromMillis(FIXED_NOW - 11 * MIN),
      expireAt: new Date(FIXED_NOW + DAY),
    });
    await db.collection("newEventPending").doc(b).set({
      eventId: b,
      createdAt: Timestamp.fromMillis(FIXED_NOW - 11 * MIN),
      expireAt: new Date(FIXED_NOW + DAY),
    });
    await db.collection("webPushControl").doc("sender").set({ sendEnabled: true, newEventEnabled: true });
    await db.collection("users").doc(U1).set({ favSports: ["football"], region: "台北市" });
    await db.collection("webPushSubscriptions").doc("s1").set({
      uid: U1,
      vapidKeyId: config.WEB_PUSH_VAPID_KEY_ID,
      endpoint: "https://fcm.googleapis.com/fcm/send/seed-endpoint-1",
    });

    const dispatch = createDispatchNewEventNoticesHandler({
      db,
      FieldValue,
      logger: makeLogger().logger,
      now: () => FIXED_NOW,
    });
    await dispatch({});

    expect((await db.collection("webPushQueue").get()).size).toBe(1);
    expect((await db.collection("sportNewEventDaily").get()).size).toBe(1);
  });
});
