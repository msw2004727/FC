/**
 * 健檢 C1-03 第二步：後端代遷寫出的正本 users/{uid}，之後本人的前端寫入能否照常通過現行 Rules。
 *
 * 只描述現況，不改 firestore.rules：
 *  - 本人登入更新（isSafeLoginUpdate：displayName／pictureUrl／lastLogin）允許。
 *  - 本人退出俱樂部（isTeamFieldShrinkOrClear：清空、縮減一隊）允許——證明代遷寫的 teamId == teamIds[0]、
 *    teamName == teamNames[0]、teamNames 長度一致能通過後續增減條件。
 *  - 代遷文件帶的限制欄位、舊 createdAt／exp 不妨礙上述更新，但本人不能自行改掉限制欄位。
 *  - 同一份內容由前端直接建立仍被拒（帶俱樂部），所以必須由後端代遷；本人也不能改舊文件。
 */

const fs = require("fs");
const path = require("path");
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  setLogLevel,
  serverTimestamp,
  Timestamp,
} = require("firebase/firestore");

const PROJECT_ID = "demo-c103-legacy-migration-rules";
const RULES_PATH = path.resolve(__dirname, "..", "..", "firestore.rules");
const [EMULATOR_HOST, EMULATOR_PORT] = (
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080"
).split(":");

jest.setTimeout(20000);

const UID = "U_c103_migrated";
const FRESH = "U_c103_fresh";
const LEGACY_ID = "legacy_c103_doc";
const TEAM_A = "tm_c103_a";
const TEAM_B = "tm_c103_b";

// 與 functions/legacy-user-migration.js#buildMigratedUserDoc 的輸出同形（伺服器時間以固定 Timestamp 代替）。
function migratedDoc(uid) {
  return {
    uid,
    lineUserId: uid,
    displayName: "舊名字",
    pictureUrl: null,
    role: "user",
    exp: 500,
    level: 7,
    createdAt: Timestamp.fromMillis(Date.UTC(2025, 2, 1)),
    lastLogin: Timestamp.fromMillis(Date.UTC(2026, 10, 13)),
    updatedAt: Timestamp.fromMillis(Date.UTC(2026, 10, 13)),
    teamId: TEAM_A,
    teamName: "甲隊",
    teamIds: [TEAM_A, TEAM_B],
    teamNames: ["甲隊", ""],
    isRestricted: true,
    restrictedAt: Timestamp.fromMillis(Date.UTC(2026, 4, 1)),
    restrictedByUid: "U_c103_admin",
    restrictedByName: "管理員",
  };
}

let testEnv;
const authAs = (uid) => testEnv.authenticatedContext(uid).firestore();

beforeAll(async () => {
  setLogLevel("error");
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: EMULATOR_HOST,
      port: parseInt(EMULATOR_PORT, 10),
      rules: fs.readFileSync(RULES_PATH, "utf8"),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "teams", TEAM_A), { id: TEAM_A, name: "甲隊", captainUid: "U_c103_cap" });
    await setDoc(doc(db, "teams", TEAM_B), { id: TEAM_B, name: "乙隊", captainUid: "U_c103_cap" });
    await setDoc(doc(db, "users", UID), migratedDoc(UID));
    await setDoc(doc(db, "users", LEGACY_ID), { lineUserId: UID, displayName: "舊名字", teamId: TEAM_A, teamName: "甲隊" });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

const updateSelf = (data) => updateDoc(doc(authAs(UID), "users", UID), data);

describe("代遷後的正本：本人前端寫入照常", () => {
  test("登入更新名稱、頭像、lastLogin 允許", async () => {
    await assertSucceeds(updateSelf({ displayName: "LINE 名字", pictureUrl: "https://example.com/p.png", lastLogin: serverTimestamp() }));
  });

  test("退出全部俱樂部（清空四欄）允許", async () => {
    await assertSucceeds(updateSelf({ teamId: null, teamName: null, teamIds: [], teamNames: [], updatedAt: serverTimestamp() }));
  });

  test("退出其中一隊（縮減成一隊）允許", async () => {
    await assertSucceeds(updateSelf({
      teamId: TEAM_B, teamName: "", teamIds: [TEAM_B], teamNames: [""], updatedAt: serverTimestamp(),
    }));
  });

  test("本人不能自行解除限制", async () => {
    await assertFails(updateSelf({ isRestricted: false }));
  });
});

describe("為什麼要後端代遷", () => {
  test("同內容由前端直接建立被拒（帶俱樂部、帶舊 createdAt／exp）", async () => {
    const data = { ...migratedDoc(FRESH) };
    delete data.isRestricted;
    delete data.restrictedAt;
    delete data.restrictedByUid;
    delete data.restrictedByName;
    await assertFails(setDoc(doc(authAs(FRESH), "users", FRESH), data));
  });

  test("代遷稽核集合 userMigrationAudits 前端讀寫一律被拒", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "userMigrationAudits", "lm_test"), { status: "migrated" });
    });
    await assertFails(getDoc(doc(authAs(UID), "userMigrationAudits", "lm_test")));
    await assertFails(setDoc(doc(authAs(UID), "userMigrationAudits", "lm_self"), { status: "migrated" }));
  });

  test("本人不能改舊文件（文件 ID ≠ uid）", async () => {
    await assertFails(updateDoc(doc(authAs(UID), "users", LEGACY_ID), { teamId: null, teamIds: [] }));
  });
});
