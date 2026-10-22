/**
 * M-089：公開開關 Rules 契約。
 * 照 A toggleEventPublicFromDetail → FirebaseService.updateEvent。
 * 成功案例刻意涵蓋一般活動，不以 courseLinked 分支代替。
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
  setDoc,
  updateDoc,
  serverTimestamp,
  setLogLevel,
} = require("firebase/firestore");

const PROJECT_ID = "demo-b-contract-event-public-toggle";
const RULES_PATH = path.resolve(__dirname, "..", "..", "..", "firestore.rules");
const [EMULATOR_HOST, EMULATOR_PORT] = (
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080"
).split(":");

const OWNER = "uid_visibility_owner";
const COACH = "uid_visibility_coach";
const OTHER = "uid_visibility_other";
const ADMIN = "uid_visibility_admin";
const DOC_ID = "visibility_document";
const PUBLIC_ID = "ce_visibility_public";
let testEnv;

jest.setTimeout(20000);

// 照 tests/firestore.rules.test.js：正式站角色在 custom claim `role`，Rules 先讀 token。
const ROLE_BY_UID = { [OWNER]: "user", [COACH]: "coach", [OTHER]: "user" };

function refFor(uid) {
  return doc(testEnv.authenticatedContext(uid, { role: ROLE_BY_UID[uid] }).firestore(), "events", DOC_ID);
}

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
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      // seed 形狀照 tests/firestore.rules.test.js 的 seedUserDoc／seedRolePermissions／seedRoleActivityCapabilities。
      ...[[OWNER, "user"], [COACH, "coach"], [OTHER, "user"], [ADMIN, "admin"]].map(([uid, role]) => setDoc(doc(db, "users", uid), {
        uid, displayName: `User ${uid}`, role, teamId: null, teamName: null, teamIds: [], teamNames: [],
      })),
      setDoc(doc(db, "rolePermissions", "user"), { permissions: [] }),
      setDoc(doc(db, "rolePermissions", "coach"), { permissions: [] }),
      setDoc(doc(db, "rolePermissions", "admin"), { permissions: ["event.edit_all"] }),
      setDoc(doc(db, "roleActivityCapabilities", "user"), {
        capabilities: ["user.activity.own_edit_basic", "user.activity.addons_use"],
        catalogVersion: "test",
      }),
      setDoc(doc(db, "teams", "visibility_team"), {
        id: "visibility_team",
        captainUid: OWNER,
        leaderUids: [],
        coachUids: [COACH],
      }),
      setDoc(doc(db, "events", DOC_ID), {
        id: PUBLIC_ID,
        title: "公開切換契約",
        type: "friendly",
        status: "open",
        creatorUid: OWNER,
        delegateUids: [COACH],
        teamOnly: true,
        creatorTeamId: "visibility_team",
        creatorTeamIds: ["visibility_team"],
        privateEvent: false,
        isPublic: false,
        courseLinked: false,
        viewCount: 0,
        max: 20,
        current: 0,
        waitlist: 0,
        updatedAt: serverTimestamp(),
      }),
    ]);
  });
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

// 現況（T-005b 實測）：Rules 的 owner／scoped 欄位白名單（eventUpdateBasicFieldsOnly、eventScopedRoleFieldsOnly）
// 都沒有 isPublic，只有 canBroadManageEventUpdate（event.edit_all／admin）與課程連動路徑可改。
// A 詳情頁 _canToggleEventPublic 卻對 owner／scoped coach 顯示開關 → 寫入被拒、toast 錯誤（A 前後端落差）。
// B 照 A 行為；是否放寬 Rules 待站長決定，本測試記錄現行 Rules，不改 Rules。
test("owner（user＋addons）改 isPublic＋updatedAt → 現行 Rules 拒絕（A 落差）", async () => {
  await assertFails(updateDoc(refFor(OWNER), {
    isPublic: true,
    updatedAt: serverTimestamp(),
  }));
});

test("scoped coach 改 isPublic＋updatedAt → 現行 Rules 拒絕（A 落差）", async () => {
  await assertFails(updateDoc(refFor(COACH), {
    isPublic: true,
    updatedAt: serverTimestamp(),
  }));
});

test("admin 改 isPublic＋updatedAt → 允許（canBroadManageEventUpdate）", async () => {
  const adminDb = testEnv.authenticatedContext(ADMIN, { admin: true, role: "admin" }).firestore();
  await assertSucceeds(updateDoc(doc(adminDb, "events", DOC_ID), {
    isPublic: true,
    updatedAt: serverTimestamp(),
  }));
});

test("一般 user 非 owner → 拒絕", async () => {
  await assertFails(updateDoc(refFor(OTHER), {
    isPublic: true,
    updatedAt: serverTimestamp(),
  }));
});

test.each([OWNER, COACH])("多帶受保護欄位 viewCount → 拒絕：%s", async (uid) => {
  await assertFails(updateDoc(refFor(uid), {
    isPublic: true,
    updatedAt: serverTimestamp(),
    viewCount: 100,
  }));
});

test.each([OWNER, COACH])("多帶自訂欄位 → 拒絕：%s", async (uid) => {
  await assertFails(updateDoc(refFor(uid), {
    isPublic: true,
    updatedAt: serverTimestamp(),
    unexpectedVisibilityField: true,
  }));
});
