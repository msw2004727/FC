/**
 * 臨時取消時限（late-cancel，契約 2026-11-23 §7）在 Rules 下的 allow / deny。
 *
 *   - events.lateCancelHours：B 建立／編輯寫入。Rules 只加進 eventUpdateBasicFieldsOnly 與
 *     eventScopedRoleFieldsOnly 兩個 hasOnly 白名單（緊鄰 teamReservationReleaseHours），不檢查值域
 *     （值域由 Functions normalizeLateCancelHours 兜底：缺值＝2、壞值＝0）。allow create 沒有 keys 白名單，
 *     建立時寫入不需改 Rules，這裡只釘「建立帶此欄被允許」。
 *   - A 形狀的 update（舊站 A 編輯存檔是局部 update、不帶 lateCancelHours）之後，原值（含 0）保留。
 *   - users 的 lateCancelLevel／lateCancelUntil／lateCancelReleaseAt／lateCancelRecent／lateCancelTotal 只由 Functions 寫：
 *     本人白名單不含（本來就改不了）、super_admin 禁改名單已加入、admin 沒有 users 寫入路徑。
 *   - lateCancelMarks/{eventDocId}_{operatorUid}：只給 Functions，Client SDK 讀寫全拒。
 *
 * events update 的拒絕案例在 emulator 常以「maximum of 1000 expressions」收場（見 rules-budget skill），
 * 錯誤訊息不能區分拒絕原因；所以每個拒絕案例都有一個「同一身分、同一文件、只差欄位」的允許對照案例。
 *
 * 執行（需 Firestore emulator）：
 *   npm run test:rules
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
  getDocs,
  collection,
  setDoc,
  updateDoc,
  deleteDoc,
  setLogLevel,
  serverTimestamp,
  Timestamp,
} = require("firebase/firestore");

const PROJECT_ID = "demo-late-cancel-rules";
const RULES_PATH = path.resolve(__dirname, "..", "..", "firestore.rules");
const [EMULATOR_HOST, EMULATOR_PORT] = (
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080"
).split(":");

jest.setTimeout(20000);

let testEnv;

const OWNER_UID = "uid_lc_owner";
const DELEGATE_UID = "uid_lc_delegate";
const OTHER_UID = "uid_lc_other";
const COACH_UID = "uid_lc_coach";
const ADMIN_UID = "uid_lc_admin";
const SUPER_UID = "uid_lc_super";

const EVENT_USER_ID = "ce_lc_user";
const EVENT_COACH_ID = "ce_lc_coach";
const MARK_ID = `${EVENT_USER_ID}_${OWNER_UID}`;

const BASE_USER_CAPS = [
  "user.activity.basic_create",
  "user.activity.own_edit_basic",
];

const LATE_CANCEL_USER_FIELDS = {
  lateCancelLevel: "black",
  lateCancelUntil: Timestamp.fromDate(new Date("2099-01-08T00:00:00.000Z")),
  lateCancelReleaseAt: 3,
  lateCancelRecent: [Timestamp.fromDate(new Date("2099-01-01T00:00:00.000Z"))],
  lateCancelTotal: 1,
};
// 解除／竄改用的新值：每欄都和種子值不同，確保 affectedKeys 含該欄。
const TAMPER_VALUES = {
  lateCancelLevel: null,
  lateCancelUntil: Timestamp.fromDate(new Date("2000-01-01T00:00:00.000Z")),
  lateCancelReleaseAt: 0,
  lateCancelRecent: [],
  lateCancelTotal: 0,
};

function authAs(uid, role, isAdmin = false) {
  const claims = { role };
  if (isAdmin) claims.admin = true;
  return testEnv.authenticatedContext(uid, claims).firestore();
}

function eventPayload(overrides = {}) {
  return {
    id: EVENT_USER_ID,
    clientRequestId: EVENT_USER_ID,
    title: "週末練球",
    type: "friendly",
    status: "open",
    location: "台北市大安運動中心",
    date: "2099/05/15 15:00~17:00",
    startTimestamp: new Date("2099-05-15T07:00:00.000Z"),
    endTimestamp: new Date("2099-05-15T09:00:00.000Z"),
    max: 20,
    minAge: 0,
    notes: "",
    sportTag: "football",
    regOpenTime: null,
    image: "https://example.com/cover.jpg",
    gradient: "linear-gradient(135deg,#0d9488,#065f46)",
    current: 0,
    waitlist: 0,
    participants: [],
    waitlistNames: [],
    contact: "",
    icon: "",
    countdown: "",
    creator: "主辦",
    creatorUid: OWNER_UID,
    delegates: [{ uid: DELEGATE_UID, name: "委託人" }],
    delegateUids: [DELEGATE_UID],
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
    createdAt: new Date("2099-01-01T00:00:00.000Z"),
    updatedAt: new Date("2099-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

const COACH_EVENT = {
  id: EVENT_COACH_ID,
  clientRequestId: EVENT_COACH_ID,
  creatorUid: COACH_UID,
  creator: "王教練",
  delegates: [],
  delegateUids: [],
};

const touch = (fields) => ({ ...fields, updatedAt: serverTimestamp() });
const updateEvent = (db, eventId, data) => updateDoc(doc(db, "events", eventId), data);

async function seedDoc(pathSegments, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), ...pathSegments), data);
  });
}

async function readAsAdminSdk(pathSegments) {
  let data = null;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore(), ...pathSegments));
    data = snap.exists() ? snap.data() : null;
  });
  return data;
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
}, 60000);

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const users = [
      [OWNER_UID, "user"],
      [DELEGATE_UID, "user"],
      [OTHER_UID, "user"],
      [COACH_UID, "coach"],
      [ADMIN_UID, "admin"],
      [SUPER_UID, "super_admin"],
    ];
    for (const [uid, role] of users) {
      await setDoc(doc(db, "users", uid), {
        uid,
        role,
        displayName: uid,
        teamId: null,
        teamName: null,
        teamIds: [],
        teamNames: [],
        ...LATE_CANCEL_USER_FIELDS,
      });
    }
    for (const role of ["user", "coach", "super_admin"]) {
      await setDoc(doc(db, "rolePermissions", role), { permissions: [] });
    }
    await setDoc(doc(db, "rolePermissions", "admin"), {
      permissions: ["event.edit_all", "activity.manage.entry", "admin.repair.no_show_adjust"],
    });
    await setDoc(doc(db, "roleActivityCapabilities", "user"), {
      catalogVersion: 1,
      capabilities: BASE_USER_CAPS,
    });
    for (const role of ["coach", "admin", "super_admin"]) {
      await setDoc(doc(db, "roleActivityCapabilities", role), { catalogVersion: 1, capabilities: [] });
    }
    await setDoc(doc(db, "events", EVENT_USER_ID), eventPayload());
    await setDoc(doc(db, "events", EVENT_COACH_ID), eventPayload(COACH_EVENT));
    await setDoc(doc(db, "lateCancelMarks", MARK_ID), {
      eventId: EVENT_USER_ID,
      uid: OWNER_UID,
      createdAt: new Date("2099-05-15T06:00:00.000Z"),
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe("allow: events.lateCancelHours（建立／編輯）", () => {
  test("1. 一般 user 主辦（own_edit_basic）改標題＋lateCancelHours 6 → 允許（eventUpdateBasicFieldsOnly）", async () => {
    await assertSucceeds(
      updateEvent(authAs(OWNER_UID, "user"), EVENT_USER_ID, touch({ title: "改標題", lateCancelHours: 6 }))
    );
  });

  test("2. 一般 user 主辦明寫 lateCancelHours 0（選「不設定」） → 允許", async () => {
    await assertSucceeds(updateEvent(authAs(OWNER_UID, "user"), EVENT_USER_ID, touch({ lateCancelHours: 0 })));
  });

  test("3. 一般 user 委託人（own_edit_basic）改 lateCancelHours → 允許", async () => {
    await assertSucceeds(updateEvent(authAs(DELEGATE_UID, "user"), EVENT_USER_ID, touch({ lateCancelHours: 24 })));
  });

  test("4. 教練主辦改 lateCancelHours → 允許（isScopedRoleBasicUpdate／eventScopedRoleFieldsOnly）", async () => {
    await assertSucceeds(
      updateEvent(authAs(COACH_UID, "coach"), EVENT_COACH_ID, touch({ title: "教練改", lateCancelHours: 48 }))
    );
  });

  test("5. 教練主辦同時改 teamReservationReleaseHours＋lateCancelHours → 允許（兩欄並列白名單）", async () => {
    await assertSucceeds(
      updateEvent(
        authAs(COACH_UID, "coach"),
        EVENT_COACH_ID,
        touch({ teamReservationReleaseHours: 12, lateCancelHours: 2 })
      )
    );
  });

  test("6. 一般 user（basic_create／own_edit_basic）建立活動帶 lateCancelHours 2 → 允許（create 無 keys 白名單）", async () => {
    const id = "ce_lc_new";
    const payload = eventPayload({
      id,
      clientRequestId: id,
      delegates: [],
      delegateUids: [],
      lateCancelHours: 2,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await assertSucceeds(setDoc(doc(authAs(OWNER_UID, "user"), "events", id), payload));
  });

  test("7. 一般 user 建立活動帶 lateCancelHours 0 → 允許", async () => {
    const id = "ce_lc_new_zero";
    const payload = eventPayload({
      id,
      clientRequestId: id,
      delegates: [],
      delegateUids: [],
      lateCancelHours: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await assertSucceeds(setDoc(doc(authAs(OWNER_UID, "user"), "events", id), payload));
  });
});

describe("A 形狀 update（不帶 lateCancelHours）後原值保留", () => {
  test("8. 已存 0 的活動，主辦以 A 形狀只改標題 → 允許，lateCancelHours 仍是 0", async () => {
    await seedDoc(["events", EVENT_USER_ID], eventPayload({ lateCancelHours: 0 }));
    await assertSucceeds(
      updateEvent(authAs(OWNER_UID, "user"), EVENT_USER_ID, touch({ title: "A 存檔", notes: "A 備註" }))
    );
    const after = await readAsAdminSdk(["events", EVENT_USER_ID]);
    expect(after.title).toBe("A 存檔");
    expect(after.lateCancelHours).toBe(0);
  });

  test("9. 已存 12 的活動，教練以 A 形狀改地點 → 允許，lateCancelHours 仍是 12", async () => {
    await seedDoc(["events", EVENT_COACH_ID], eventPayload({ ...COACH_EVENT, lateCancelHours: 12 }));
    await assertSucceeds(
      updateEvent(authAs(COACH_UID, "coach"), EVENT_COACH_ID, touch({ location: "新地點" }))
    );
    const after = await readAsAdminSdk(["events", EVENT_COACH_ID]);
    expect(after.location).toBe("新地點");
    expect(after.lateCancelHours).toBe(12);
  });

  test("10. 缺欄位的活動，主辦以 A 形狀改標題 → 允許，欄位仍不存在（交 Functions 當缺值＝2）", async () => {
    await assertSucceeds(updateEvent(authAs(OWNER_UID, "user"), EVENT_USER_ID, touch({ title: "A 改" })));
    const after = await readAsAdminSdk(["events", EVENT_USER_ID]);
    expect(Object.prototype.hasOwnProperty.call(after, "lateCancelHours")).toBe(false);
  });
});

describe("deny: 非主辦寫 events.lateCancelHours", () => {
  test("11. 非主辦、非委託人的一般 user 改 lateCancelHours → 拒（對照案例 2）", async () => {
    await assertFails(updateEvent(authAs(OTHER_UID, "user"), EVENT_USER_ID, touch({ lateCancelHours: 0 })));
  });

  test("12. 一般 user 主辦但沒有 own_edit_basic 改 lateCancelHours → 拒（對照案例 2）", async () => {
    await seedDoc(["roleActivityCapabilities", "user"], {
      catalogVersion: 1,
      capabilities: ["user.activity.basic_create"],
    });
    await assertFails(updateEvent(authAs(OWNER_UID, "user"), EVENT_USER_ID, touch({ lateCancelHours: 0 })));
  });

  test("13. 任一登入者經報名名額欄位路徑夾帶 lateCancelHours → 拒（isSignupFieldsOnly 白名單不含）", async () => {
    await assertFails(
      updateEvent(authAs(OTHER_UID, "user"), EVENT_USER_ID, touch({ current: 1, lateCancelHours: 0 }))
    );
  });
});

describe("users：lateCancel* 只由 Functions 寫", () => {
  test("14. 對照：本人改 displayName → 允許；super_admin 改別人 displayName → 允許", async () => {
    await assertSucceeds(updateDoc(doc(authAs(OWNER_UID, "user"), "users", OWNER_UID), { displayName: "本人改名" }));
    await assertSucceeds(
      updateDoc(doc(authAs(SUPER_UID, "super_admin"), "users", OTHER_UID), { displayName: "超管改名" })
    );
  });

  test.each(Object.keys(TAMPER_VALUES))("15. 本人改自己的 %s → 拒（isSafeSelfProfileUpdate 白名單不含）", async (field) => {
    await assertFails(
      updateDoc(doc(authAs(OWNER_UID, "user"), "users", OWNER_UID), { [field]: TAMPER_VALUES[field] })
    );
  });

  test("16. 本人夾帶在 displayName 一起改 lateCancelLevel → 拒（對照案例 14）", async () => {
    await assertFails(
      updateDoc(doc(authAs(OWNER_UID, "user"), "users", OWNER_UID), {
        displayName: "本人改名",
        lateCancelLevel: null,
      })
    );
  });

  test.each(Object.keys(TAMPER_VALUES))("17. super_admin 直寫別人的 %s → 拒（isSafeSuperAdminUserUpdate 禁改名單）", async (field) => {
    await assertFails(
      updateDoc(doc(authAs(SUPER_UID, "super_admin"), "users", OTHER_UID), { [field]: TAMPER_VALUES[field] })
    );
  });

  test("18. super_admin 夾帶在 displayName 一起清 lateCancelLevel＋lateCancelRecent → 拒（對照案例 14）", async () => {
    await assertFails(
      updateDoc(doc(authAs(SUPER_UID, "super_admin"), "users", OTHER_UID), {
        displayName: "超管改名",
        lateCancelLevel: null,
        lateCancelRecent: [],
      })
    );
  });

  test("19. super_admin 改自己的 lateCancelLevel → 拒", async () => {
    await assertFails(
      updateDoc(doc(authAs(SUPER_UID, "super_admin"), "users", SUPER_UID), { lateCancelLevel: null })
    );
  });

  test("20. admin（含 admin.repair.no_show_adjust）直寫別人的 lateCancelLevel → 拒（手動解除只走 Callable）", async () => {
    await assertFails(
      updateDoc(doc(authAs(ADMIN_UID, "admin", true), "users", OTHER_UID), { lateCancelLevel: null })
    );
  });

  test("21. 新用戶建立 users 文件帶 lateCancelLevel → 拒（userRootCreateAllowedKeys 不含）", async () => {
    const uid = "uid_lc_new";
    await assertFails(
      setDoc(doc(authAs(uid, "user"), "users", uid), { uid, displayName: "新用戶", teamId: null, lateCancelLevel: null })
    );
    await assertSucceeds(setDoc(doc(authAs(uid, "user"), "users", uid), { uid, displayName: "新用戶", teamId: null }));
  });
});

describe("deny: lateCancelMarks 讀寫全拒", () => {
  test("22. 本人讀自己的去重文件 → 拒", async () => {
    await assertFails(getDoc(doc(authAs(OWNER_UID, "user"), "lateCancelMarks", MARK_ID)));
  });

  test("23. super_admin 讀去重文件／列舉集合 → 拒", async () => {
    const db = authAs(SUPER_UID, "super_admin");
    await assertFails(getDoc(doc(db, "lateCancelMarks", MARK_ID)));
    await assertFails(getDocs(collection(db, "lateCancelMarks")));
  });

  test("24. 未登入讀去重文件 → 拒", async () => {
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), "lateCancelMarks", MARK_ID)));
  });

  test("25. 本人／super_admin 建立去重文件 → 拒", async () => {
    const id = `${EVENT_COACH_ID}_${OWNER_UID}`;
    await assertFails(setDoc(doc(authAs(OWNER_UID, "user"), "lateCancelMarks", id), { uid: OWNER_UID }));
    await assertFails(setDoc(doc(authAs(SUPER_UID, "super_admin"), "lateCancelMarks", id), { uid: OWNER_UID }));
  });

  test("26. 本人／super_admin 改或刪既有去重文件 → 拒", async () => {
    await assertFails(updateDoc(doc(authAs(OWNER_UID, "user"), "lateCancelMarks", MARK_ID), { uid: "x" }));
    await assertFails(deleteDoc(doc(authAs(OWNER_UID, "user"), "lateCancelMarks", MARK_ID)));
    await assertFails(updateDoc(doc(authAs(SUPER_UID, "super_admin"), "lateCancelMarks", MARK_ID), { uid: "x" }));
    await assertFails(deleteDoc(doc(authAs(SUPER_UID, "super_admin"), "lateCancelMarks", MARK_ID)));
  });
});
