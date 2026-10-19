/**
 * 契約測試：活動建立 / 編輯（Rules）。
 *
 * ⚠️  payloads 與 FC-B `src/features/events/data/__fixtures__/event-create-golden.json` 同步；
 *     任一邊改動時務必同步另一邊。
 *
 * 驗證範圍（Rules emulator）：
 *   - allow：一般 user 有 basic_create、coach、admin 建立；
 *            owner（一般 user）基本編輯。
 *   - deny：初始 current 非 0、payloadRevision 只帶一個、id ≠ eventId、
 *           creatorUid ≠ 登入者、一般 user 未帶 addons_use 卻帶私密欄位、
 *           編輯改 creatorUid、一般 user 編輯改 status。
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
  setLogLevel,
  serverTimestamp,
} = require("firebase/firestore");

const PROJECT_ID = "demo-b-contract-event-create";
const RULES_PATH = path.resolve(__dirname, "..", "..", "..", "firestore.rules");
const [EMULATOR_HOST, EMULATOR_PORT] = (
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080"
).split(":");

jest.setTimeout(20000);

let testEnv;

// ── 固定識別碼 ────────────────────────────────────

const USER_UID = "uid_user_golden";
const ADDONS_UID = "uid_user_addons_golden";
const COACH_UID = "uid_coach_golden";
const ADMIN_UID = "uid_admin_golden";

const EVENT_ID = "ce_golden_user_basic";

const TEAM_ID = "team_main";

function authAs(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

/**
 * 與 golden `createUserBasic.payload` 同步的 payload 產生器。
 * 傳入 authUid / eventId 以派生 coach / admin 版本。
 * 起始 current/waitlist 為 0，符合 Rules 安全初始投影。
 */
function buildUserBasicPayload(overrides = {}) {
  const base = {
    id: EVENT_ID,
    clientRequestId: EVENT_ID,
    title: "週末練球",
    type: "friendly",
    status: "open",
    location: "台北市大安運動中心",
    date: "2026/05/15 15:00~17:00",
    startTimestamp: new Date("2026-05-15T15:00:00.000Z"),
    endTimestamp: new Date("2026-05-15T17:00:00.000Z"),
    max: 20,
    minAge: 0,
    notes: "",
    sportTag: "basketball",
    regOpenTime: null,
    image: "https://example.com/cover.jpg",
    gradient: "linear-gradient(135deg,#0d9488,#065f46)",
    current: 0,
    waitlist: 0,
    participants: [],
    waitlistNames: [],
    contact: "",
    icon: "",
    countdown: "即將開始",
    creator: "小明",
    creatorUid: USER_UID,
    delegates: [],
    delegateUids: [],
    regionEnabled: false,
    region: "",
    cities: [],
    feeEnabled: false,
    fee: 0,
    teamOnly: false,
    isPublic: false,
    creatorTeamId: null,
    creatorTeamName: null,
    creatorTeamIds: [],
    creatorTeamNames: [],
    genderRestrictionEnabled: false,
    allowedGender: "",
    privateEvent: false,
    socialLinksEnabled: false,
    socialLinks: [],
    earlyBirdEnabled: false,
    earlyBirdCost: 0,
    earlyBirdPolicyVersion: null,
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  };
  return { ...base, ...overrides };
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
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    // 角色
    await setDoc(doc(db, "users", USER_UID), { uid: USER_UID, role: "user" });
    await setDoc(doc(db, "users", ADDONS_UID), { uid: ADDONS_UID, role: "user" });
    await setDoc(doc(db, "users", COACH_UID), { uid: COACH_UID, role: "coach" });
    await setDoc(doc(db, "users", ADMIN_UID), { uid: ADMIN_UID, role: "admin" });

    // 能力：一般 user 有 basic_create + own_edit_basic，不含 addons_use。
    await setDoc(doc(db, "roleActivityCapabilities", "user"), {
      capabilities: [
        "user.activity.basic_create",
        "user.activity.own_edit_basic",
      ],
    });
    await setDoc(doc(db, "roleActivityCapabilities", "coach"), {
      capabilities: [],
    });
    await setDoc(doc(db, "roleActivityCapabilities", "admin"), {
      capabilities: [],
    });

    // 團隊（提供 coach / admin 管理入口所需的最小資料）
    await setDoc(doc(db, "teams", TEAM_ID), {
      id: TEAM_ID,
      name: "Main Team",
      captainUid: USER_UID,
      leaderUids: [],
      coachUids: [],
      members: 0,
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

/* ──────────────────────────────────────────────────
 * ALLOW：建立
 * ────────────────────────────────────────────────── */

describe("allow: 建立", () => {
  test("1. 一般 user 有 basic_create 建立 → 允許", async () => {
    await assertSucceeds(
      setDoc(
        doc(authAs(USER_UID), "events", EVENT_ID),
        buildUserBasicPayload()
      )
    );
  });

  test("2. coach 建立 → 允許", async () => {
    await assertSucceeds(
      setDoc(
        doc(authAs(COACH_UID), "events", "ce_golden_coach"),
        buildUserBasicPayload({
          id: "ce_golden_coach",
          clientRequestId: "ce_golden_coach",
          creatorUid: COACH_UID,
          creator: "王教練",
          title: "教練帶練",
        })
      )
    );
  });

  test("3. admin 建立 → 允許", async () => {
    await assertSucceeds(
      setDoc(
        doc(authAs(ADMIN_UID), "events", "ce_golden_admin"),
        buildUserBasicPayload({
          id: "ce_golden_admin",
          clientRequestId: "ce_golden_admin",
          creatorUid: ADMIN_UID,
          creator: "李管理員",
          title: "全站活動",
        })
      )
    );
  });
});

/* ──────────────────────────────────────────────────
 * ALLOW：owner 基本編輯
 * ────────────────────────────────────────────────── */

describe("allow: owner 基本編輯", () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "events", EVENT_ID),
        buildUserBasicPayload()
      );
    });
  });

  test("4. owner（一般 user）改 title → 允許", async () => {
    await assertSucceeds(
      updateDoc(doc(authAs(USER_UID), "events", EVENT_ID), {
        title: "週末練球（已更新）",
        updatedAt: serverTimestamp(),
      })
    );
  });
});

/* ──────────────────────────────────────────────────
 * DENY：建立
 * ────────────────────────────────────────────────── */

describe("deny: 建立契約", () => {
  test("5. 初始 current 不為 0 → 拒", async () => {
    await assertFails(
      setDoc(
        doc(authAs(USER_UID), "events", EVENT_ID),
        buildUserBasicPayload({ current: 5 })
      )
    );
  });

  test("6. payloadRevision 只帶一個（缺 payloadDigest）→ 拒", async () => {
    await assertFails(
      setDoc(
        doc(authAs(USER_UID), "events", EVENT_ID),
        buildUserBasicPayload({ payloadRevision: 1 })
      )
    );
  });

  test("7. id ≠ eventId → 拒", async () => {
    await assertFails(
      setDoc(
        doc(authAs(USER_UID), "events", "ce_other_path"),
        buildUserBasicPayload()
      )
    );
  });

  test("8. creatorUid ≠ 登入者 → 拒", async () => {
    await assertFails(
      setDoc(
        doc(authAs(USER_UID), "events", EVENT_ID),
        buildUserBasicPayload({ creatorUid: ADMIN_UID })
      )
    );
  });

  test("9. 一般 user 未帶 addons_use 卻帶 privateEvent=true → 拒", async () => {
    await assertFails(
      setDoc(
        doc(authAs(USER_UID), "events", EVENT_ID),
        buildUserBasicPayload({ privateEvent: true })
      )
    );
  });

  test("10. 一般 user 未帶 addons_use 卻帶 feeEnabled/fee → 拒", async () => {
    await assertFails(
      setDoc(
        doc(authAs(USER_UID), "events", EVENT_ID),
        buildUserBasicPayload({ feeEnabled: true, fee: 100 })
      )
    );
  });
});

/* ──────────────────────────────────────────────────
 * DENY：編輯
 * ────────────────────────────────────────────────── */

describe("deny: 編輯禁改欄位", () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "events", EVENT_ID),
        buildUserBasicPayload()
      );
    });
  });

  test("11. 編輯改 creatorUid → 拒", async () => {
    await assertFails(
      updateDoc(doc(authAs(USER_UID), "events", EVENT_ID), {
        title: "改名",
        creatorUid: "uid_other",
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("12. 一般 user 編輯改 status → 拒", async () => {
    await assertFails(
      updateDoc(doc(authAs(USER_UID), "events", EVENT_ID), {
        status: "upcoming",
        updatedAt: serverTimestamp(),
      })
    );
  });
});
