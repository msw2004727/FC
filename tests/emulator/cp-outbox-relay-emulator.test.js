"use strict";

// CP-PO-01 relay 對真 Firestore Emulator 的實測（兩個資料庫：(default) 與 asia-main）。
// 只驗跨庫讀寫、runTransaction、serverTimestamp、固定 id 冪等（單元測試的假 Firestore 無法覆蓋）。
//:
//   npx firebase emulators:exec --only firestore --project demo-cp-outbox-relay "npx jest --runInBand tests/emulator/cp-outbox-relay-emulator.test.js"
// 沒有 FIRESTORE_EMULATOR_HOST 或 project id 不是 demo- 開頭時直接失敗（不跳過），避免 Admin SDK 連到正式專案。

const path = require("path");

const FUNCTIONS_DIR = path.resolve(__dirname, "..", "..", "functions");
const fromFunctions = (id) => require(require.resolve(id, { paths: [FUNCTIONS_DIR] }));
const { initializeApp, deleteApp } = fromFunctions("firebase-admin/app");
const { getFirestore, FieldValue } = fromFunctions("firebase-admin/firestore");
const {
  CP_DATABASE_ID,
  createCpOutboxRelayHandler,
  taipeiMonthKey,
} = require("../../functions/cp-outbox-relay");

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "";
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "demo-cp-outbox-relay";
const logger = { log() {}, info() {}, warn() {}, error() {} };

// 固定時間：可預測的月份 key 與事件年齡
const NOW = Date.UTC(2026, 10, 15, 2, 0, 0); // 2026-11-15 10:00 Taipei → 月 202611
const MONTH_KEY = taipeiMonthKey(NOW);

jest.setTimeout(60000);

let app, db, cpDb;

beforeAll(() => {
  if (!EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST 未設定：本檔只能在 firebase emulators:exec 內執行");
  if (!PROJECT_ID.startsWith("demo-")) throw new Error("project id 必須是 demo- 開頭，避免連到正式專案：" + PROJECT_ID);
  app = initializeApp({ projectId: PROJECT_ID }, "cp-outbox-relay-emu-" + Date.now());
  db = getFirestore(app);
  cpDb = getFirestore(app, CP_DATABASE_ID);
});

afterAll(async () => { if (app) await deleteApp(app); });

async function clearAll() {
  await db.recursiveDelete(db.collection("users"));
  await db.recursiveDelete(db.collection("linePushQueue"));
  await db.recursiveDelete(db.collection("siteConfig"));
  await cpDb.recursiveDelete(cpDb.collection("cpOutbox"));
  await cpDb.recursiveDelete(cpDb.collection("cpLineThrottle"));
}

beforeEach(async () => { await clearAll(); });

const handler = () => createCpOutboxRelayHandler({
  db,
  getCpDb: () => cpDb,
  FieldValue,
  logger,
  getLineRecipientUidFromUserDoc: (found, fallbackUid) => {
    const data = found?.data || {};
    if (typeof data.lineUserId === "string" && data.lineUserId) return data.lineUserId;
    if (typeof data.uid === "string" && data.uid) return data.uid;
    if (typeof found?.docId === "string" && found.docId) return found.docId;
    return fallbackUid;
  },
  now: () => NOW,
});

function eventFor(outId) {
  return { params: { outId }, time: new Date(NOW).toISOString() };
}

async function seedOutbox(outId, overrides = {}) {
  await cpDb.collection("cpOutbox").doc(outId).set({
    kind: "cpReportFiled",
    audienceRoles: ["admin", "super_admin"],
    channels: ["inbox"],
    cid: "cp_abc123",
    reportId: "r1",
    reason: "fake",
    compName: "測試賽",
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
    ...overrides,
  });
}

describe("cpOutboxRelay × 真 Emulator", () => {
  test("(a) 旗標 true：兩位 admin 站內信、一般使用者沒有、1 筆 linePushQueue、月計數 1、outbox sent", async () => {
    await db.collection("users").doc("u_admin1").set({
      role: "admin",
      lineNotify: { bound: true },
      lineUserId: "UlineAdmin1",
    });
    await db.collection("users").doc("u_super1").set({ role: "super_admin", lineNotify: { bound: false } });
    await db.collection("users").doc("u_user1").set({ role: "user" });
    await db.collection("siteConfig").doc("featureFlags").set({ cpReportLineEnabled: true });
    await seedOutbox("out1", { channels: ["inbox", "line"] });

    await handler()(eventFor("out1"));

    const inboxA = await db.collection("users").doc("u_admin1").collection("inbox").doc("cpo_out1").get();
    const inboxS = await db.collection("users").doc("u_super1").collection("inbox").doc("cpo_out1").get();
    const inboxU = await db.collection("users").doc("u_user1").collection("inbox").doc("cpo_out1").get();
    expect(inboxA.exists).toBe(true);
    expect(inboxS.exists).toBe(true);
    expect(inboxU.exists).toBe(false);
    expect(inboxA.get("actionType")).toBeNull();

    const queueSnap = await db.collection("linePushQueue").get();
    expect(queueSnap.size).toBe(1);
    expect(queueSnap.docs[0].id).toBe("cpo_out1_u_admin1");
    expect(queueSnap.docs[0].get("uid")).toBe("UlineAdmin1");

    const month = await cpDb.collection("cpLineThrottle").doc(`m_${MONTH_KEY}`).get();
    expect(month.get("count")).toBe(1);

    const outbox = await cpDb.collection("cpOutbox").doc("out1").get();
    expect(outbox.get("status")).toBe("sent");
    expect(outbox.get("inboxWritten")).toBe(2);
    expect(outbox.get("lineQueued")).toBe(1);
    expect(outbox.get("lineReserved")).toBe(1);
  });

  test("(b) 同事件再跑一次：狀態與計數不變、不再入列", async () => {
    await db.collection("users").doc("u_admin1").set({
      role: "admin",
      lineNotify: { bound: true },
      lineUserId: "UlineAdmin1",
    });
    await db.collection("users").doc("u_super1").set({ role: "super_admin", lineNotify: { bound: false } });
    await db.collection("siteConfig").doc("featureFlags").set({ cpReportLineEnabled: true });
    await seedOutbox("out1", { channels: ["inbox", "line"] });

    const h = handler();
    await h(eventFor("out1"));
    const first = await cpDb.collection("cpLineThrottle").doc(`m_${MONTH_KEY}`).get();
    const firstQueue = await db.collection("linePushQueue").get();
    expect(first.get("count")).toBe(1);
    expect(firstQueue.size).toBe(1);

    // 第二次：outbox.status 仍是 sent，claim 交易應直接 return
    await h(eventFor("out1"));
    const second = await cpDb.collection("cpLineThrottle").doc(`m_${MONTH_KEY}`).get();
    const secondQueue = await db.collection("linePushQueue").get();
    expect(second.get("count")).toBe(1);
    expect(secondQueue.size).toBe(1);
  });

  test("(c) 旗標刪掉的新 outbox → 無佇列、計數不變", async () => {
    await db.collection("users").doc("u_admin1").set({
      role: "admin",
      lineNotify: { bound: true },
      lineUserId: "UlineAdmin1",
    });
    await db.collection("users").doc("u_super1").set({ role: "super_admin", lineNotify: { bound: false } });
    // 不寫 siteConfig/featureFlags
    await seedOutbox("out1", { channels: ["inbox", "line"] });

    await handler()(eventFor("out1"));

    const queueSnap = await db.collection("linePushQueue").get();
    expect(queueSnap.size).toBe(0);
    const month = await cpDb.collection("cpLineThrottle").doc(`m_${MONTH_KEY}`).get();
    expect(month.exists).toBe(false);

    const outbox = await cpDb.collection("cpOutbox").doc("out1").get();
    expect(outbox.get("status")).toBe("sent");
    expect(outbox.get("lineSkipped")).toBe("flag_off");
  });

  test("(d) 月計數已 30 → 無佇列、lineSkipped monthly_cap", async () => {
    await db.collection("users").doc("u_admin1").set({
      role: "admin",
      lineNotify: { bound: true },
      lineUserId: "UlineAdmin1",
    });
    await db.collection("users").doc("u_super1").set({ role: "super_admin", lineNotify: { bound: true }, lineUserId: "UlineSuper1" });
    await db.collection("siteConfig").doc("featureFlags").set({ cpReportLineEnabled: true });
    await cpDb.collection("cpLineThrottle").doc(`m_${MONTH_KEY}`).set({ count: 30 });
    await seedOutbox("out1", { channels: ["inbox", "line"] });

    await handler()(eventFor("out1"));

    const queueSnap = await db.collection("linePushQueue").get();
    expect(queueSnap.size).toBe(0);
    const month = await cpDb.collection("cpLineThrottle").doc(`m_${MONTH_KEY}`).get();
    expect(month.get("count")).toBe(30);
    const outbox = await cpDb.collection("cpOutbox").doc("out1").get();
    expect(outbox.get("status")).toBe("sent");
    expect(outbox.get("lineSkipped")).toBe("monthly_cap");
    expect(outbox.get("lineQueued")).toBe(0);
  });
});
