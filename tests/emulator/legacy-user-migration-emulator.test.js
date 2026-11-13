"use strict";

// migrateLegacyUserDoc 對真 Firestore Emulator 的實測（健檢 C1-03 第二步）。
// 補 tests/unit/legacy-user-migration.test.js 的 fakeDb 無法證明的部分：交易內查詢、真的 transaction.create
// 遇到已存在文件的錯誤碼、並發兩次呼叫只建一份正本、Timestamp 型別的 createdAt 原值保留。
//
// 只能在 Firestore Emulator 內執行（不在 tests/unit/，`npm run test:unit` 不會收進來）：
//   npm run test:functions:emulator
// 沒有 FIRESTORE_EMULATOR_HOST 或 project id 不是 demo- 開頭時直接失敗（不跳過），避免 Admin SDK 連到正式專案。

const path = require("path");

const FUNCTIONS_DIR = path.resolve(__dirname, "..", "..", "functions");
const fromFunctions = (id) => require(require.resolve(id, { paths: [FUNCTIONS_DIR] }));
const { initializeApp, deleteApp } = fromFunctions("firebase-admin/app");
const { getFirestore, FieldValue, Timestamp } = fromFunctions("firebase-admin/firestore");
const { HttpsError } = fromFunctions("firebase-functions/v2/https");
const { migrateLegacyUserDoc, AUDIT_COLLECTION, auditDocId } = require("../../functions/legacy-user-migration");
const { recountAndWriteTeamMembers } = require("../../functions/team-membership-core");

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "";
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "demo-delete-event";

const UID = "U_emu_legacy_owner";
const LEGACY_ID = "legacy_emu_doc_01";
const TEAM = "tm_emu_team";
const CREATED_AT = Timestamp.fromMillis(Date.UTC(2025, 2, 1, 8, 0, 0));

jest.setTimeout(60000);

let app, db;

beforeAll(() => {
  if (!EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST 未設定：本檔只能在 firebase emulators:exec 內執行");
  if (!PROJECT_ID.startsWith("demo-")) throw new Error("project id 必須是 demo- 開頭，避免連到正式專案：" + PROJECT_ID);
  app = initializeApp({ projectId: PROJECT_ID }, "legacy-user-migration-emulator-" + Date.now());
  db = getFirestore(app);
});

afterAll(async () => { if (app) await deleteApp(app); });

beforeEach(async () => {
  const res = await fetch(`http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  if (!res.ok) throw new Error("清空 emulator 失敗：" + res.status);
  const batch = db.batch();
  batch.set(db.doc(`teams/${TEAM}`), { id: TEAM, name: "模擬隊", captainUid: "U_emu_captain", members: 0 });
  batch.set(db.doc("users/U_emu_captain"), { uid: "U_emu_captain", lineUserId: "U_emu_captain", teamIds: [TEAM], teamId: TEAM });
  batch.set(db.doc(`users/${LEGACY_ID}`), {
    lineUserId: UID,
    displayName: "模擬舊帳號",
    role: "user",
    exp: 320,
    level: 4,
    createdAt: CREATED_AT,
    teamId: TEAM,
    teamName: "模擬隊",
    isRestricted: true,
    restrictedAt: Timestamp.fromMillis(Date.UTC(2026, 4, 1)),
    restrictedByUid: "U_emu_admin",
    restrictedByName: "模擬管理員",
  });
  await batch.commit();
});

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const call = (uid = UID, data) => migrateLegacyUserDoc({ auth: { uid, token: {} }, data }, { db, HttpsError, FieldValue, logger });
const read = async (p) => { const s = await db.doc(p).get(); return s.exists ? s.data() : undefined; };

test("代遷成功：正本內容正確、createdAt（Timestamp）／exp／level／限制欄位原值保留、舊文件不動", async () => {
  const legacyBefore = await read(`users/${LEGACY_ID}`);
  await expect(call()).resolves.toEqual({ status: "migrated" });
  const doc = await read(`users/${UID}`);
  expect(doc).toMatchObject({
    uid: UID, lineUserId: UID, displayName: "模擬舊帳號", role: "user", exp: 320, level: 4,
    teamId: TEAM, teamName: "模擬隊", teamIds: [TEAM], teamNames: ["模擬隊"],
    isRestricted: true, restrictedByUid: "U_emu_admin", restrictedByName: "模擬管理員",
  });
  expect(doc.createdAt).toBeInstanceOf(Timestamp);
  expect(doc.createdAt.isEqual(CREATED_AT)).toBe(true);
  expect(doc.restrictedAt).toBeInstanceOf(Timestamp);
  expect(doc.lastLogin).toBeInstanceOf(Timestamp);
  expect(await read(`users/${LEGACY_ID}`)).toEqual(legacyBefore);
  const audit = await read(`${AUDIT_COLLECTION}/${auditDocId(UID)}`);
  expect(audit).toMatchObject({ status: "migrated", teamCount: 1, restricted: true });
  expect(JSON.stringify(audit)).not.toContain(UID);
});

test("並發兩次呼叫：恰一筆 migrated、一筆 already，正本只有一份", async () => {
  const results = await Promise.all([call(), call()]);
  expect(results.map((r) => r.status).sort()).toEqual(["already", "migrated"]);
  const owned = await db.collection("users").where("uid", "==", UID).get();
  expect(owned.docs.map((d) => d.id)).toEqual([UID]);
});

test("正本已存在：回 already 且不覆寫", async () => {
  await db.doc(`users/${UID}`).set({ uid: UID, lineUserId: UID, displayName: "正本", exp: 1 });
  await expect(call()).resolves.toEqual({ status: "already" });
  expect(await read(`users/${UID}`)).toEqual({ uid: UID, lineUserId: UID, displayName: "正本", exp: 1 });
});

test("只能遷自己：request.data 指定別人也只處理呼叫者", async () => {
  await expect(call("U_emu_stranger", { uid: UID })).resolves.toEqual({ status: "no-legacy" });
  expect(await read(`users/${UID}`)).toBeUndefined();
});

test("非 user 角色：不建正本、稽核列角色", async () => {
  await db.doc(`users/${LEGACY_ID}`).update({ role: "coach" });
  await expect(call()).resolves.toEqual({ status: "not-migratable", reason: "role-not-user" });
  expect(await read(`users/${UID}`)).toBeUndefined();
  expect(await read(`${AUDIT_COLLECTION}/${auditDocId(UID)}`)).toMatchObject({ legacyRole: "coach" });
});

test("代遷後俱樂部人數不重複（舊文件與正本並存）", async () => {
  const teamRef = db.doc(`teams/${TEAM}`);
  await expect(recountAndWriteTeamMembers({ db, FieldValue, teamRef })).resolves.toBe(2);
  await expect(call()).resolves.toEqual({ status: "migrated" });
  await expect(recountAndWriteTeamMembers({ db, FieldValue, teamRef })).resolves.toBe(2);
});
