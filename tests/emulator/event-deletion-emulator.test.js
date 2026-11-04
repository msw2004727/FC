"use strict";

// deleteEvent Callable 對真 Firestore Emulator 的實測（T-076a 終驗部署前條件）。
// 補 tests/unit/event-deletion.test.js 的 fakeDb 無法證明的部分：transaction 內查詢、
// delete(ref, { exists: true }) 前置條件的真實錯誤碼、SDK maxAttempts／ABORTED 重試、
// 主文件刪除後子集合仍在、operationLogs 恰一筆七欄、並發只產生一筆稽核。
//
// 只能在 Firestore Emulator 內執行（不在 tests/unit/，所以 `npm run test:unit` 不會收進來）：
//   npm run test:functions:emulator
// 或（需 Java）：
//   npx firebase emulators:exec --only firestore --project demo-delete-event "npx jest tests/emulator/event-deletion-emulator.test.js --runInBand"
// 沒有 FIRESTORE_EMULATOR_HOST 或 project id 不是 demo- 開頭時直接失敗（不跳過），避免 Admin SDK 連到正式專案。

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const FUNCTIONS_DIR = path.resolve(__dirname, "..", "..", "functions");
const fromFunctions = (id) => require(require.resolve(id, { paths: [FUNCTIONS_DIR] }));
const { initializeApp, deleteApp } = fromFunctions("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = fromFunctions("firebase-admin/firestore");
const { HttpsError } = fromFunctions("firebase-functions/v2/https");
const { createDeleteEventHandler } = require("../../functions/event-deletion");

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "";
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "demo-delete-event";

// 與單元測試相同：直接取 functions/index.js 內實際的課程錯誤工廠，不另寫一份。
const indexSource = fs.readFileSync(path.join(FUNCTIONS_DIR, "index.js"), "utf8");
const courseError = vm.runInNewContext(
  "(" + indexSource.match(/function courseLinkedEventManagedByCourseError\(\) \{[\s\S]*?\n\}/)[0] + ")", { HttpsError },
);

const ADMIN = "U_emu_admin", OWNER = "U_emu_owner", OTHER = "U_emu_other", DELEGATE = "U_emu_delegate";
const ID = "ce_emu_delete_001", PATH = "events/" + ID;
const EVENT = { id: ID, title: "模擬器刪除測試", date: "2026/11/04", creatorUid: OWNER, delegateUids: [DELEGATE] };
const CHILDREN = ["registrations/r1", "attendanceRecords/a1", "activityRecords/a1", "comments/c1", "comments/c1/replies/r1"];
const AUDIT_FIELDS = ["actorUid", "createdAt", "creatorUid", "date", "docId", "eventId", "title"];

jest.setTimeout(60000);

let app, db;

beforeAll(() => {
  if (!EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST 未設定：本檔只能在 firebase emulators:exec 內執行");
  if (!PROJECT_ID.startsWith("demo-")) throw new Error("project id 必須是 demo- 開頭，避免連到正式專案：" + PROJECT_ID);
  app = initializeApp({ projectId: PROJECT_ID }, "event-deletion-emulator-" + Date.now());
  db = getFirestore(app);
});

afterAll(async () => { if (app) await deleteApp(app); });

beforeEach(async () => {
  const res = await fetch(`http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  if (!res.ok) throw new Error("清空 emulator 失敗：" + res.status);
  await seed({
    ["users/" + ADMIN]: { role: "admin" },
    ["users/" + OWNER]: { role: "coach" },
    ["users/" + OTHER]: { role: "coach" },
    ["users/" + DELEGATE]: { role: "user" },
    "rolePermissions/coach": { permissions: ["event.delete_self"] },
    ["userPermissionGrants/" + DELEGATE]: { permissions: ["event.delete"] },
    [PATH]: EVENT,
    ...Object.fromEntries(CHILDREN.map((p) => [PATH + "/" + p, { keep: p }])),
  });
});

async function seed(docs) {
  const batch = db.batch();
  for (const [p, data] of Object.entries(docs)) batch.set(db.doc(p), data);
  await batch.commit();
}
const data = async (p) => { const s = await db.doc(p).get(); return s.exists ? s.data() : undefined; };
const auditDocs = async () => (await db.collection("operationLogs").get()).docs;
const abortedError = () => Object.assign(new Error("injected ABORTED"), { code: 10 });

// 包一層真 Firestore：handler 用的仍是真的 collection／query／transaction，
// 只是在每次 SDK attempt 開頭讓測試插手（計次、注入 ABORTED、在重試前改資料）。
function makeHandler({ onAttempt, txProxy } = {}) {
  const calls = { attempts: 0, options: [] };
  const wrapped = {
    collection: (name) => db.collection(name),
    runTransaction: (work, options) => {
      calls.options.push(options);
      return db.runTransaction(async (tx) => {
        const attempt = ++calls.attempts;
        const t = txProxy ? txProxy(tx) : tx;
        return onAttempt ? onAttempt({ attempt, run: () => work(t) }) : work(t);
      }, options);
    },
  };
  const logger = { warn: jest.fn(), error: jest.fn() };
  const handler = createDeleteEventHandler({
    db: wrapped, HttpsError, FieldValue, courseLinkedEventManagedByCourseError: courseError, logger,
  });
  const call = (uid, eventId = ID) => handler({ data: { eventId }, auth: { uid, token: {} } });
  return { call, calls, logger };
}

async function expectUntouched(eventPath = PATH, expected = EVENT) {
  expect(await auditDocs()).toHaveLength(0);
  expect(await data(eventPath)).toEqual(expected);
}

async function expectChildrenKept(parent = PATH) {
  for (const p of CHILDREN) expect(await data(parent + "/" + p)).toEqual({ keep: p });
  const names = (await db.doc(parent).listCollections()).map((c) => c.id).sort();
  expect(names).toEqual(["activityRecords", "attendanceRecords", "comments", "registrations"]);
}

test("admin 刪除成功：主文件刪除、子集合保留、operationLogs 恰一筆且只有七欄", async () => {
  const h = makeHandler();
  await expect(h.call(ADMIN)).resolves.toEqual({ ok: true, alreadyDeleted: false });
  expect(h.calls.options).toEqual([{ maxAttempts: 5 }]);
  expect(h.calls.attempts).toBe(1);
  expect(await data(PATH)).toBeUndefined();
  await expectChildrenKept();
  const logs = await auditDocs();
  expect(logs).toHaveLength(1);
  const audit = logs[0].data();
  expect(Object.keys(audit).sort()).toEqual(AUDIT_FIELDS);
  expect(audit.createdAt).toBeInstanceOf(Timestamp);
  expect({ ...audit, createdAt: null }).toEqual({
    title: EVENT.title, date: EVENT.date, eventId: ID, docId: ID, creatorUid: OWNER, actorUid: ADMIN, createdAt: null,
  });
});

test("擁有者＋event.delete_self 可刪除", async () => {
  const h = makeHandler();
  await expect(h.call(OWNER)).resolves.toEqual({ ok: true, alreadyDeleted: false });
  expect(await data(PATH)).toBeUndefined();
  expect((await auditDocs()).map((d) => d.get("actorUid"))).toEqual([OWNER]);
});

test("非擁有者只有 delete_self：拒絕且零寫入", async () => {
  const h = makeHandler();
  await expect(h.call(OTHER)).rejects.toMatchObject({ code: "permission-denied", message: "EVENT_DELETE_DENIED" });
  await expectUntouched();
});

test("私密活動的 delegate（即使有個人 event.delete 授權）拒絕且零寫入", async () => {
  await db.doc(PATH).update({ privateEvent: true });
  const h = makeHandler();
  await expect(h.call(DELEGATE)).rejects.toMatchObject({ code: "permission-denied", message: "EVENT_DELETE_DENIED" });
  await expectUntouched(PATH, { ...EVENT, privateEvent: true });
});

test("課程連動活動：admin 也拒絕且零寫入", async () => {
  await db.doc(PATH).update({ courseLinked: true });
  const h = makeHandler();
  await expect(h.call(ADMIN)).rejects.toMatchObject({
    code: "failed-precondition", message: "COURSE_LINKED_EVENT_MANAGED_BY_COURSE",
    details: { code: "COURSE_LINKED_EVENT_MANAGED_BY_COURSE" },
  });
  await expectUntouched(PATH, { ...EVENT, courseLinked: true });
});

test("文件 id 與 id 欄位不符且無 legacy：EVENT_ID_MISMATCH，活動仍在", async () => {
  await db.doc(PATH).update({ id: "ce_emu_other_public" });
  const h = makeHandler();
  await expect(h.call(ADMIN)).rejects.toMatchObject({ code: "failed-precondition", message: "EVENT_ID_MISMATCH" });
  await expectUntouched(PATH, { ...EVENT, id: "ce_emu_other_public" });
  expect(h.logger.warn).not.toHaveBeenCalled();
});

test("legacy id：transaction 內查詢找到舊文件並刪除；同名但 id 不符的直接文件不動", async () => {
  const legacyId = "ce_emu_legacy_001", legacyPath = "events/legacy_doc_001";
  const collision = { id: "unrelated_public_id", title: "不可刪" };
  await seed({ [legacyPath]: { ...EVENT, id: legacyId }, ["events/" + legacyId]: collision, [legacyPath + "/registrations/r1"]: { keep: "legacy" } });
  const h = makeHandler();
  await expect(h.call(ADMIN, legacyId)).resolves.toEqual({ ok: true, alreadyDeleted: false });
  expect(await data(legacyPath)).toBeUndefined();
  expect(await data("events/" + legacyId)).toEqual(collision);
  expect(await data(legacyPath + "/registrations/r1")).toEqual({ keep: "legacy" });
  const logs = await auditDocs();
  expect(logs).toHaveLength(1);
  expect(logs[0].data()).toMatchObject({ eventId: legacyId, docId: "legacy_doc_001", actorUid: ADMIN });
});

test("legacy id 對到兩筆：EVENT_ID_AMBIGUOUS 且零寫入", async () => {
  const legacyId = "ce_emu_dup_001";
  await seed({ "events/dup_a": { ...EVENT, id: legacyId }, "events/dup_b": { ...EVENT, id: legacyId } });
  const h = makeHandler();
  await expect(h.call(ADMIN, legacyId)).rejects.toMatchObject({ code: "failed-precondition", message: "EVENT_ID_AMBIGUOUS" });
  expect(await auditDocs()).toHaveLength(0);
  expect(await data("events/dup_a")).toBeDefined();
  expect(await data("events/dup_b")).toBeDefined();
});

test("重複刪除：第二、三次回 alreadyDeleted，不新增稽核", async () => {
  const h = makeHandler();
  await expect(h.call(ADMIN)).resolves.toEqual({ ok: true, alreadyDeleted: false });
  await expect(h.call(ADMIN)).resolves.toEqual({ ok: true, alreadyDeleted: true });
  await expect(h.call(OWNER)).resolves.toEqual({ ok: true, alreadyDeleted: true });
  expect(await auditDocs()).toHaveLength(1);
  expect(h.logger.warn).toHaveBeenCalledTimes(2);
  await expectChildrenKept();
});

test("兩個並發刪除（Promise.all）：只有一個真刪除，稽核恰一筆", async () => {
  const a = makeHandler(), b = makeHandler();
  const results = await Promise.all([a.call(ADMIN), b.call(OWNER)]);
  expect(results.map((r) => r.alreadyDeleted).sort()).toEqual([false, true]);
  expect(await data(PATH)).toBeUndefined();
  const logs = await auditDocs();
  expect(logs).toHaveLength(1);
  // 實際勝出者與稽核 actor 一致。
  expect(logs[0].get("actorUid")).toBe(results[0].alreadyDeleted ? OWNER : ADMIN);
  await expectChildrenKept();
});

test("SDK 語意：transaction 內 delete(ref, { exists: true }) 對不存在文件回 NOT_FOUND(5)，同批稽核不落地", async () => {
  await db.doc(PATH).delete();
  let failure = null;
  try {
    await db.runTransaction(async (tx) => {
      await tx.get(db.doc("users/" + ADMIN));
      tx.set(db.collection("operationLogs").doc(), { probe: true });
      tx.delete(db.doc(PATH), { exists: true });
    }, { maxAttempts: 5 });
  } catch (error) {
    failure = error;
  }
  expect(failure).not.toBeNull();
  expect(failure.code).toBe(5);
  expect(await auditDocs()).toHaveLength(0);
});

test("handler 撞到 exists 前置條件失敗：確認已不存在後回 alreadyDeleted，零稽核", async () => {
  // 為了讓競態可重現：只有 events 文件改用非交易讀取（不鎖），其餘讀取仍在交易內；
  // 在 handler 排好 set＋delete 之後、commit 之前，由外部刪掉活動。
  const h = makeHandler({
    txProxy: (tx) => ({
      get: (target) => (target.path && target.path.startsWith("events/") ? target.get() : tx.get(target)),
      set: (...args) => tx.set(...args),
      delete: (...args) => tx.delete(...args),
    }),
    onAttempt: async ({ run }) => {
      const result = await run();
      await db.doc(PATH).delete();
      return result;
    },
  });
  await expect(h.call(ADMIN)).resolves.toEqual({ ok: true, alreadyDeleted: true });
  expect(h.calls.attempts).toBe(1);
  expect(await auditDocs()).toHaveLength(0);
  expect(h.logger.warn).toHaveBeenCalledTimes(1);
  expect(h.logger.error).not.toHaveBeenCalled();
});

test("注入一次 ABORTED：SDK 以新交易重跑，第一次排入的寫入被丟棄，稽核恰一筆", async () => {
  const h = makeHandler({
    onAttempt: async ({ attempt, run }) => {
      const result = await run();
      if (attempt === 1) throw abortedError();
      return result;
    },
  });
  await expect(h.call(ADMIN)).resolves.toEqual({ ok: true, alreadyDeleted: false });
  expect(h.calls.attempts).toBe(2);
  expect(await auditDocs()).toHaveLength(1);
  expect(await data(PATH)).toBeUndefined();
});

test("ABORTED 持續：恰好嘗試 maxAttempts=5 次，回可重試的 aborted，零寫入", async () => {
  const h = makeHandler({ onAttempt: async ({ run }) => { await run(); throw abortedError(); } });
  await expect(h.call(ADMIN)).rejects.toMatchObject({ code: "aborted", message: "EVENT_DELETE_RETRY" });
  expect(h.calls.attempts).toBe(5);
  await expectUntouched();
});

// 第 1 次 attempt 讀到「可刪」並排好寫入，然後注入 ABORTED；SDK rollback 釋放鎖後，
// 在第 2 次 attempt 的第一個讀取前改資料，證明重試會重新讀活動與權限，而不是沿用第一次的判斷。
const retryCases = [
  { kind: "角色權限被收回", actor: OWNER, mutate: () => db.doc("rolePermissions/coach").set({ permissions: [] }),
    code: "permission-denied" },
  { kind: "個人授權被停用", actor: OWNER,
    prepare: () => seed({ "rolePermissions/coach": { permissions: [] }, ["userPermissionGrants/" + OWNER]: { permissions: ["event.delete_self"] } }),
    mutate: () => db.doc("userPermissionGrants/" + OWNER).update({ enabled: false }), code: "permission-denied" },
  { kind: "擁有者被改掉", actor: OWNER, mutate: () => db.doc(PATH).update({ creatorUid: OTHER }), code: "permission-denied" },
  { kind: "改成私密活動", actor: DELEGATE, mutate: () => db.doc(PATH).update({ privateEvent: true }), code: "permission-denied" },
  { kind: "改成課程連動", actor: ADMIN, mutate: () => db.doc(PATH).update({ courseLinked: true }), code: "failed-precondition" },
  { kind: "admin 被降為 user", actor: ADMIN, mutate: () => db.doc("users/" + ADMIN).set({ role: "user" }), code: "permission-denied" },
];
test.each(retryCases)("交易重試中權限改變（$kind）：第二次 attempt 重新判斷並拒絕，零寫入", async ({ actor, prepare, mutate, code }) => {
  if (prepare) await prepare();
  let firstAttemptAllowed = false;
  const h = makeHandler({
    onAttempt: async ({ attempt, run }) => {
      if (attempt === 1) {
        await run();
        firstAttemptAllowed = true;
        throw abortedError();
      }
      if (attempt === 2) await mutate();
      return run();
    },
  });
  await expect(h.call(actor)).rejects.toMatchObject({ code });
  expect(firstAttemptAllowed).toBe(true);
  expect(h.calls.attempts).toBe(2);
  expect(await auditDocs()).toHaveLength(0);
  expect(await data(PATH)).toBeDefined();
});
