/**
 * 契約測試：B（FC-B）建立／編輯活動表單第 1、2 段新寫入欄位在現行 Rules 下的 allow / deny。
 *
 * ⚠️  B 與 A 共用同一份 `firestore.rules`；寫入格式必須是 Rules 允許的 A 格式。
 *      本檔只驗證現行 Rules 的行為，不改 Rules、不改 payload 去湊。
 *
 * 相關規則：
 *   - R-CAP-004（一般 user 沒有 addons_use 時事件加值欄位必須全關）
 *   - R-CAP-x（user.activity.delegate_assign 才能寫 delegates / delegateUids）
 *   - R-IAM-003（admin event.edit_all 可跨活動編輯）
 *   - R-IAM-004（coach / scoped manager 的活動編輯範圍）
 *
 * 執行：
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *     npx jest --runInBand tests/firestore-rules/b-contract/event-form-addons-rules.test.js
 *
 * 註意 seed：role 放 custom claim（admin 另帶 admin:true），
 * 並 seed rolePermissions/{role}（permissions）、roleActivityCapabilities/user
 * （catalogVersion + capabilities）、完整 users/{uid}；
 * 任一項缺都會出現「maximum of 1000 expressions」或「Property permissions is undefined」的假拒絕。
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

const PROJECT_ID = "demo-b-contract-event-addons";
const RULES_PATH = path.resolve(__dirname, "..", "..", "..", "firestore.rules");
const [EMULATOR_HOST, EMULATOR_PORT] = (
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080"
).split(":");

jest.setTimeout(20000);

let testEnv;

// ── 固定識別碼 ────────────────────────────────────

const USER_UID = "uid_user_addons";
const COACH_UID = "uid_coach_addons";
const ADMIN_UID = "uid_admin_addons";
const OTHER_COACH_UID = "uid_other_coach_addons";

const EVENT_ID = "ce_addons_user";
const EVENT_COACH_ID = "ce_addons_coach";
const EVENT_OTHER_ID = "ce_addons_other";

const TEAM_USER_ID = "team_user_owned";
const TEAM_COACH_ID = "team_coach_captain";

function authAs(uid, role, isAdmin = false) {
  const claims = { role };
  if (isAdmin) claims.admin = true;
  return testEnv.authenticatedContext(uid, claims).firestore();
}

/**
 * 建立 payload 依 FC-B `buildCreateEventPayload` 的完整欄位集：
 *   - 不帶 payloadRevision / payloadDigest（B 不寫）
 *   - id === docId、clientRequestId === id、current/waitlist = 0
 *   - isPublic = !!teamOnly（B 的寫入形狀）
 *   - createdAt / updatedAt 用 serverTimestamp()
 * 起始 status 用 'open'（B 沒帶 regOpenTime 時的預設）。
 */
function basePayload(overrides = {}) {
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

/**
 * 編輯 updates 依 FC-B `buildEditEventUpdates` 的基礎欄位集（不含 isPublic、不含 6 個禁改欄位）。
 * 呼叫端用 override 加值／加欄位；規則只比對 affectedKeys（同值不算變更），
 * 因此把整組基礎欄位附上不會影響 deny/allow 判定。
 */
function editUpdates(overrides = {}) {
  const base = {
    title: "週末練球",
    type: "friendly",
    location: "台北市大安運動中心",
    date: "2026/05/15 15:00~17:00",
    startTimestamp: new Date("2026-05-15T15:00:00.000Z"),
    endTimestamp: new Date("2026-05-15T17:00:00.000Z"),
    minAge: 0,
    notes: "",
    sportTag: "basketball",
    regOpenTime: null,
    gradient: "linear-gradient(135deg,#0d9488,#065f46)",
    regionEnabled: false,
    region: "",
    cities: [],
    max: 20,
    updatedAt: serverTimestamp(),
  };
  return { ...base, ...overrides };
}

async function seedUserCaps(extra = []) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "roleActivityCapabilities", "user"), {
      catalogVersion: 1,
      capabilities: [
        "user.activity.basic_create",
        "user.activity.own_edit_basic",
        ...extra,
      ],
    });
  });
}

async function seedEventDoc(eventId, payload) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "events", eventId), payload);
  });
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

    // 完整 users/{uid}
    await setDoc(doc(db, "users", USER_UID), {
      uid: USER_UID, role: "user", name: "小明", email: "user@example.com",
    });
    await setDoc(doc(db, "users", COACH_UID), {
      uid: COACH_UID, role: "coach", name: "王教練", email: "coach@example.com",
    });
    await setDoc(doc(db, "users", ADMIN_UID), {
      uid: ADMIN_UID, role: "admin", name: "李管理員", email: "admin@example.com",
    });
    await setDoc(doc(db, "users", OTHER_COACH_UID), {
      uid: OTHER_COACH_UID, role: "coach", name: "其他教練", email: "other@example.com",
    });

    // rolePermissions（避免「Property permissions is undefined」）
    await setDoc(doc(db, "rolePermissions", "user"), { permissions: [] });
    await setDoc(doc(db, "rolePermissions", "coach"), { permissions: [] });
    await setDoc(doc(db, "rolePermissions", "admin"), {
      permissions: ["event.edit_all", "activity.manage.entry"],
    });

    // roleActivityCapabilities/user 預設：basic_create + own_edit_basic（不含 addons_use / delegate_assign）
    await setDoc(doc(db, "roleActivityCapabilities", "user"), {
      catalogVersion: 1,
      capabilities: [
        "user.activity.basic_create",
        "user.activity.own_edit_basic",
      ],
    });
    await setDoc(doc(db, "roleActivityCapabilities", "coach"), {
      catalogVersion: 1, capabilities: [],
    });
    await setDoc(doc(db, "roleActivityCapabilities", "admin"), {
      catalogVersion: 1, capabilities: [],
    });

    // 團隊：小明是隊長 / 王教練是隊長
    await setDoc(doc(db, "teams", TEAM_USER_ID), {
      id: TEAM_USER_ID,
      name: "小明隊",
      captainUid: USER_UID,
      leaderUids: [],
      coachUids: [],
      members: 0,
    });
    await setDoc(doc(db, "teams", TEAM_COACH_ID), {
      id: TEAM_COACH_ID,
      name: "王教練隊",
      captainUid: COACH_UID,
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
 * 建立：allow
 * ────────────────────────────────────────────────── */

describe("allow: 建立", () => {
  test("1. 一般 user（basic_create＋addons_use）帶全部加值欄位（費用／性別限定／私密／社群連結 1 筆／早鳥 10 & v1／分隊 2 隊 self-select＋lockAt／GPS＋8 地圖欄位） → 允許", async () => {
    await seedUserCaps(["user.activity.addons_use"]);
    const payload = basePayload({
      feeEnabled: true,
      fee: 100,
      genderRestrictionEnabled: true,
      allowedGender: "male",
      privateEvent: true,
      socialLinksEnabled: true,
      socialLinks: [{ label: "Line", url: "https://line.me/R/ti/g/xxx" }],
      earlyBirdEnabled: true,
      earlyBirdCost: 10,
      earlyBirdPolicyVersion: 1,
      teamSplit: {
        enabled: true,
        teams: ["A", "B"],
        mode: "self-select",
        lockAt: new Date("2026-05-14T15:00:00.000Z"),
      },
      gpsEnabled: true,
      lat: 25.026,
      lng: 121.543,
      mapAddress: "台北市大安運動中心",
      mapPlaceId: "ChIJxxx",
      mapProvider: "google",
      mapLocationConfirmed: true,
      mapLocationUpdatedAt: "2026-04-01T00:00:00.000Z",
    });
    await assertSucceeds(
      setDoc(doc(authAs(USER_UID, "user"), "events", EVENT_ID), payload)
    );
  });

  test("9. 一般 user（僅 basic_create，無 addons_use）加值欄位全關預設值（B 送出時的實際形狀） → 允許", async () => {
    const payload = basePayload();
    await assertSucceeds(
      setDoc(doc(authAs(USER_UID, "user"), "events", EVENT_ID), payload)
    );
  });

  // A 落差（T-013 PM 2026-10-22 實測）：A 前端 _canManageEventDelegates(null) 對 user＋delegate_assign 允許建立時帶委託人，
  // 但現行 Rules 在 create 路徑超過 1000 運算式上限（Unable to evaluate … maximum of 1000 expressions）而拒絕。
  // 案例 1（全部加值欄位、無委託人）可過，只差在帶 delegates／delegateUids（eventCreateDelegateFieldsAllowed 兩次 hasActivityCap）。
  // 照實記錄為拒，不改 Rules、不改 payload；已回報指揮官待站長決定。
  test("10. 一般 user（basic_create＋delegate_assign）帶 1 位委託人（delegates＝[{uid,name}]、delegateUids） → 拒（A 落差：Rules 運算式超限）", async () => {
    await seedUserCaps(["user.activity.delegate_assign"]);
    const payload = basePayload({
      delegates: [{ uid: "uid_delegate_1", name: "張三" }],
      delegateUids: ["uid_delegate_1"],
    });
    await assertFails(
      setDoc(doc(authAs(USER_UID, "user"), "events", EVENT_ID), payload)
    );
  });

  test("12. 教練（coach）帶全部加值欄位＋2 位委託人＋image 為 https 網址＋imageVariants（cover／homeNext） → 允許", async () => {
    const payload = basePayload({
      id: EVENT_COACH_ID,
      clientRequestId: EVENT_COACH_ID,
      creatorUid: COACH_UID,
      creator: "王教練",
      title: "教練帶練",
      delegates: [
        { uid: "uid_d1", name: "甲" },
        { uid: "uid_d2", name: "乙" },
      ],
      delegateUids: ["uid_d1", "uid_d2"],
      image: "https://example.com/coach-cover.jpg",
      imageVariants: {
        cover: "https://example.com/coach-cover-1600.jpg",
        homeNext: "https://example.com/coach-thumb-400.jpg",
      },
      feeEnabled: true,
      fee: 100,
      genderRestrictionEnabled: true,
      allowedGender: "male",
      privateEvent: true,
      socialLinksEnabled: true,
      socialLinks: [{ label: "Line", url: "https://line.me/R/ti/g/xxx" }],
      earlyBirdEnabled: true,
      earlyBirdCost: 10,
      earlyBirdPolicyVersion: 1,
      teamSplit: {
        enabled: true,
        teams: ["A", "B"],
        mode: "self-select",
        lockAt: new Date("2026-05-14T15:00:00.000Z"),
      },
      gpsEnabled: true,
      lat: 25.026,
      lng: 121.543,
      mapAddress: "台北市大安運動中心",
      mapPlaceId: "ChIJxxx",
      mapProvider: "google",
      mapLocationConfirmed: true,
      mapLocationUpdatedAt: "2026-04-01T00:00:00.000Z",
    });
    await assertSucceeds(
      setDoc(doc(authAs(COACH_UID, "coach"), "events", EVENT_COACH_ID), payload)
    );
  });

  test("13. 教練建立俱樂部限定（teamOnly true、isPublic true、creatorTeamId／Name／Ids／Names 為自己是隊長的俱樂部） → 記錄實況（預期：允許）", async () => {
    // 依據 rules: canCreateEventRoot → isCoachPlus → hasActivityManageEntry 為真，
    // 且 eventCreateHasAuthorizedCreatorTeamScope 的 isCurrentUserTeamStaff(TEAM_COACH_ID) 為真 → 建立通過。
    const payload = basePayload({
      id: EVENT_COACH_ID,
      clientRequestId: EVENT_COACH_ID,
      creatorUid: COACH_UID,
      creator: "王教練",
      title: "俱樂部限定練球",
      teamOnly: true,
      isPublic: true,
      creatorTeamId: TEAM_COACH_ID,
      creatorTeamName: "王教練隊",
      creatorTeamIds: [TEAM_COACH_ID],
      creatorTeamNames: ["王教練隊"],
    });
    await assertSucceeds(
      setDoc(doc(authAs(COACH_UID, "coach"), "events", EVENT_COACH_ID), payload)
    );
  });
});

/* ──────────────────────────────────────────────────
 * 建立：deny（R-CAP-004）
 * ────────────────────────────────────────────────── */

describe("deny: 建立（一般 user 無 addons_use 只帶單一加值欄位）", () => {
  test("2. 一般 user（僅 basic_create）帶性別限定 → 拒（R-CAP-004，eventCreateHasNoAddons）", async () => {
    const payload = basePayload({
      genderRestrictionEnabled: true,
      allowedGender: "male",
    });
    await assertFails(
      setDoc(doc(authAs(USER_UID, "user"), "events", EVENT_ID), payload)
    );
  });

  test("3. 一般 user（僅 basic_create）帶社群連結 → 拒（R-CAP-004）", async () => {
    const payload = basePayload({
      socialLinksEnabled: true,
      socialLinks: [{ label: "Line", url: "https://line.me/R/ti/g/xxx" }],
    });
    await assertFails(
      setDoc(doc(authAs(USER_UID, "user"), "events", EVENT_ID), payload)
    );
  });

  test("4. 一般 user（僅 basic_create）帶早鳥 → 拒（R-CAP-004）", async () => {
    const payload = basePayload({
      earlyBirdEnabled: true,
      earlyBirdCost: 10,
      earlyBirdPolicyVersion: 1,
    });
    await assertFails(
      setDoc(doc(authAs(USER_UID, "user"), "events", EVENT_ID), payload)
    );
  });

  test("5. 一般 user（僅 basic_create）帶分隊 → 拒（R-CAP-004）", async () => {
    const payload = basePayload({
      teamSplit: {
        enabled: true,
        teams: ["A", "B"],
        mode: "self-select",
        lockAt: new Date("2026-05-14T15:00:00.000Z"),
      },
    });
    await assertFails(
      setDoc(doc(authAs(USER_UID, "user"), "events", EVENT_ID), payload)
    );
  });

  test("6. 一般 user（僅 basic_create）帶 GPS（gpsEnabled true＋座標） → 拒（R-CAP-004）", async () => {
    const payload = basePayload({
      gpsEnabled: true,
      lat: 25.026,
      lng: 121.543,
      mapAddress: "台北市大安運動中心",
      mapPlaceId: "ChIJxxx",
      mapProvider: "google",
      mapLocationConfirmed: true,
      mapLocationUpdatedAt: "2026-04-01T00:00:00.000Z",
    });
    await assertFails(
      setDoc(doc(authAs(USER_UID, "user"), "events", EVENT_ID), payload)
    );
  });

  test("7. 一般 user（僅 basic_create）帶私密 → 拒（R-CAP-004）", async () => {
    const payload = basePayload({ privateEvent: true });
    await assertFails(
      setDoc(doc(authAs(USER_UID, "user"), "events", EVENT_ID), payload)
    );
  });

  test("8. 一般 user（僅 basic_create）帶費用 → 拒（R-CAP-004）", async () => {
    const payload = basePayload({ feeEnabled: true, fee: 100 });
    await assertFails(
      setDoc(doc(authAs(USER_UID, "user"), "events", EVENT_ID), payload)
    );
  });

  test("11. 一般 user 無 delegate_assign 帶委託人 → 記錄實況（預期：拒，eventCreateDelegateFieldsAllowed）", async () => {
    const payload = basePayload({
      delegates: [{ uid: "uid_delegate_1", name: "張三" }],
      delegateUids: ["uid_delegate_1"],
    });
    await assertFails(
      setDoc(doc(authAs(USER_UID, "user"), "events", EVENT_ID), payload)
    );
  });

  test("14. 教練建立俱樂部限定（自己不是幹部的俱樂部） → 記錄實況（預期：拒，eventCreateHasAuthorizedCreatorTeamScope 的 isCurrentUserTeamStaff）", async () => {
    const payload = basePayload({
      id: EVENT_COACH_ID,
      clientRequestId: EVENT_COACH_ID,
      creatorUid: COACH_UID,
      creator: "王教練",
      title: "俱樂部限定練球",
      teamOnly: true,
      isPublic: true,
      creatorTeamId: TEAM_USER_ID, // 借小明隊（教練不是該隊幹部）
      creatorTeamName: "小明隊",
      creatorTeamIds: [TEAM_USER_ID],
      creatorTeamNames: ["小明隊"],
    });
    await assertFails(
      setDoc(doc(authAs(COACH_UID, "coach"), "events", EVENT_COACH_ID), payload)
    );
  });
});

/* ──────────────────────────────────────────────────
 * 編輯：allow
 * ────────────────────────────────────────────────── */

describe("allow: 編輯", () => {
  test("15. owner 一般 user（own_edit_basic＋addons_use）改費用與早鳥 → 允許", async () => {
    await seedUserCaps(["user.activity.addons_use"]);
    await seedEventDoc(EVENT_ID, basePayload());
    const updates = editUpdates({
      feeEnabled: true,
      fee: 100,
      earlyBirdEnabled: true,
      earlyBirdCost: 10,
      earlyBirdPolicyVersion: 1,
    });
    await assertSucceeds(
      updateDoc(doc(authAs(USER_UID, "user"), "events", EVENT_ID), updates)
    );
  });

  test("17. owner 一般 user（own_edit_basic＋delegate_assign）改委託人 → 允許", async () => {
    await seedUserCaps(["user.activity.delegate_assign"]);
    await seedEventDoc(EVENT_ID, basePayload());
    const updates = editUpdates({
      delegates: [{ uid: "uid_delegate_1", name: "張三" }],
      delegateUids: ["uid_delegate_1"],
    });
    await assertSucceeds(
      updateDoc(doc(authAs(USER_UID, "user"), "events", EVENT_ID), updates)
    );
  });

  test("19. owner 改 image／imageVariants（https 網址） → 允許", async () => {
    await seedEventDoc(EVENT_ID, basePayload());
    const updates = editUpdates({
      image: "https://example.com/new-cover.jpg",
      imageVariants: {
        cover: "https://example.com/new-cover-1600.jpg",
        homeNext: "https://example.com/new-thumb-400.jpg",
      },
    });
    await assertSucceeds(
      updateDoc(doc(authAs(USER_UID, "user"), "events", EVENT_ID), updates)
    );
  });

  test("20. owner 教練改分隊（含新的 lockAt） → 允許（isScopedRoleBasicUpdate）", async () => {
    await seedEventDoc(
      EVENT_COACH_ID,
      basePayload({
        id: EVENT_COACH_ID,
        clientRequestId: EVENT_COACH_ID,
        creatorUid: COACH_UID,
        creator: "王教練",
        title: "教練帶練",
        teamSplit: {
          enabled: true,
          teams: ["A", "B"],
          mode: "self-select",
          lockAt: new Date("2026-05-14T15:00:00.000Z"),
        },
      })
    );
    const updates = editUpdates({
      teamSplit: {
        enabled: true,
        teams: ["A", "B", "C"],
        mode: "self-select",
        lockAt: new Date("2026-05-15T00:00:00.000Z"),
      },
    });
    await assertSucceeds(
      updateDoc(doc(authAs(COACH_UID, "coach"), "events", EVENT_COACH_ID), updates)
    );
  });

  test("22. admin（event.edit_all）改別人活動的費用與私密 → 允許（R-IAM-003，canBroadManageEventUpdate）", async () => {
    await seedEventDoc(EVENT_ID, basePayload({ creatorUid: USER_UID }));
    const updates = editUpdates({
      feeEnabled: true,
      fee: 100,
      privateEvent: true,
    });
    await assertSucceeds(
      updateDoc(doc(authAs(ADMIN_UID, "admin", true), "events", EVENT_ID), updates)
    );
  });
});

/* ──────────────────────────────────────────────────
 * 編輯：deny
 * ────────────────────────────────────────────────── */

describe("deny: 編輯", () => {
  test("16. owner 一般 user 無 addons_use 改費用與早鳥 → 拒（R-CAP-004，eventUpdateAddonFieldsAllowed）", async () => {
    await seedEventDoc(EVENT_ID, basePayload());
    const updates = editUpdates({
      feeEnabled: true,
      fee: 100,
      earlyBirdEnabled: true,
      earlyBirdCost: 10,
      earlyBirdPolicyVersion: 1,
    });
    await assertFails(
      updateDoc(doc(authAs(USER_UID, "user"), "events", EVENT_ID), updates)
    );
  });

  test("18. owner 一般 user 無 delegate_assign 改委託人 → 記錄實況（預期：拒，isUserOwnerBasicUpdate）", async () => {
    await seedEventDoc(EVENT_ID, basePayload());
    const updates = editUpdates({
      delegates: [{ uid: "uid_delegate_1", name: "張三" }],
      delegateUids: ["uid_delegate_1"],
    });
    await assertFails(
      updateDoc(doc(authAs(USER_UID, "user"), "events", EVENT_ID), updates)
    );
  });

  test("21. 非 owner、非委託人的教練改別人活動的費用 → 拒（R-IAM-004，canScopedManageEventData 不服）", async () => {
    await seedEventDoc(EVENT_ID, basePayload({ creatorUid: USER_UID }));
    const updates = editUpdates({ feeEnabled: true, fee: 100 });
    await assertFails(
      updateDoc(doc(authAs(OTHER_COACH_UID, "coach"), "events", EVENT_ID), updates)
    );
  });

  test("23. owner 一般 user（addons_use）編輯帶 isPublic → 記錄實況（B 編輯不寫 isPublic；預期：拒，非 teamOnly 活動不觸發 isPublicOnlyVisibilityUpdate）", async () => {
    // A 落差：B 編輯不寫 isPublic；此案例是「若未來 B 誤送 isPublic」時的現行 Rules 實況。
    // 現行 Rules: 非 teamOnly 活動，isPublic 不在 eventUpdateBasicFieldsOnly、
    // 也不在 eventScopedRoleFieldsOnly，isPublicOnlyVisibilityUpdate 因 resource.teamOnly=false 不啟動 → 拒。
    await seedUserCaps(["user.activity.addons_use"]);
    await seedEventDoc(EVENT_ID, basePayload());
    const updates = editUpdates({ isPublic: true });
    await assertFails(
      updateDoc(doc(authAs(USER_UID, "user"), "events", EVENT_ID), updates)
    );
  });
});
