/**
 * 團隊預留自動釋出（批 2 Rules）：events/{eventId} 三個新欄位在 Rules 下的 allow / deny。
 *
 *   - teamReservationReleaseHours：B 建立／編輯寫入。Rules 只把它加進 eventUpdateBasicFieldsOnly 與
 *     eventScopedRoleFieldsOnly 兩個 hasOnly 白名單，不檢查值域（events update 貼近 1000 運算式上限；
 *     非允許值由 Functions 視為 0）。allow create 沒有 keys 白名單，建立時寫入不需改 Rules。
 *   - teamReservationReleasedAt／teamReservationReleasedSummary：只應由 Functions（Admin SDK）寫，不加入任何白名單。
 *     但 canBroadManageEventUpdate（admin／super_admin／event.edit_all）路徑沒有欄位白名單，
 *     管理員寫得進去——這是計畫書列為可接受的殘餘風險（只影響自己管理的活動），本檔把它寫成「釘現況」，
 *     將來若收緊 Rules，這兩案要同步翻轉。
 *
 * events update 的拒絕案例在 emulator 常以「maximum of 1000 expressions」收場（見 rules-budget skill），
 * 錯誤訊息不能區分拒絕原因；所以每個拒絕案例都有一個「同一身分、同一活動、只差欄位」的允許對照案例。
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
  setDoc,
  updateDoc,
  setLogLevel,
  serverTimestamp,
} = require("firebase/firestore");

const PROJECT_ID = "demo-team-reservation-release";
const RULES_PATH = path.resolve(__dirname, "..", "..", "firestore.rules");
const [EMULATOR_HOST, EMULATOR_PORT] = (
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080"
).split(":");

jest.setTimeout(20000);

let testEnv;

const OWNER_UID = "uid_trr_owner";
const DELEGATE_UID = "uid_trr_delegate";
const OTHER_UID = "uid_trr_other";
const COACH_UID = "uid_trr_coach";
const OTHER_COACH_UID = "uid_trr_other_coach";
const ADMIN_UID = "uid_trr_admin";
const SUPER_UID = "uid_trr_super";

const EVENT_USER_ID = "ce_trr_user";
const EVENT_COACH_ID = "ce_trr_coach";

const BASE_USER_CAPS = [
  "user.activity.basic_create",
  "user.activity.own_edit_basic",
];

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
    teamReservationSummaries: [
      { teamId: "tm_trr", teamName: "預留隊", reservedSlots: 2, usedSlots: 0, remainingSlots: 2, occupiedSlots: 2 },
    ],
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

const HOURS = { teamReservationReleaseHours: 12 };
const RELEASED_AT = { teamReservationReleasedAt: new Date("2099-05-15T05:00:00.000Z") };
const RELEASED_SUMMARY = {
  teamReservationReleasedSummary: [{ teamId: "tm_trr", teamName: "預留隊", releasedSlots: 2 }],
};
const touch = (fields) => ({ ...fields, updatedAt: serverTimestamp() });

async function seedEvent(eventId, payload) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "events", eventId), payload);
  });
}

async function seedUserCaps(capabilities) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "roleActivityCapabilities", "user"), {
      catalogVersion: 1,
      capabilities,
    });
  });
}

const updateEvent = (db, eventId, data) => updateDoc(doc(db, "events", eventId), data);

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
    const users = [
      [OWNER_UID, "user"],
      [DELEGATE_UID, "user"],
      [OTHER_UID, "user"],
      [COACH_UID, "coach"],
      [OTHER_COACH_UID, "coach"],
      [ADMIN_UID, "admin"],
      [SUPER_UID, "super_admin"],
    ];
    for (const [uid, role] of users) {
      await setDoc(doc(db, "users", uid), { uid, role, name: uid, email: uid + "@example.com" });
    }
    for (const role of ["user", "coach", "super_admin"]) {
      await setDoc(doc(db, "rolePermissions", role), { permissions: [] });
    }
    await setDoc(doc(db, "rolePermissions", "admin"), {
      permissions: ["event.edit_all", "activity.manage.entry"],
    });
    await setDoc(doc(db, "roleActivityCapabilities", "user"), {
      catalogVersion: 1,
      capabilities: BASE_USER_CAPS,
    });
    for (const role of ["coach", "admin", "super_admin"]) {
      await setDoc(doc(db, "roleActivityCapabilities", role), { catalogVersion: 1, capabilities: [] });
    }
  });
  await seedEvent(EVENT_USER_ID, eventPayload());
  await seedEvent(EVENT_COACH_ID, eventPayload(COACH_EVENT));
});

afterAll(async () => {
  await testEnv.cleanup();
});

describe("allow: teamReservationReleaseHours（建立／編輯）", () => {
  test("1. 一般 user 主辦（own_edit_basic）只改 teamReservationReleaseHours → 允許（eventUpdateBasicFieldsOnly）", async () => {
    await assertSucceeds(updateEvent(authAs(OWNER_UID, "user"), EVENT_USER_ID, touch(HOURS)));
  });

  test("2. 一般 user 主辦改標題＋teamReservationReleaseHours 0（B 編輯每次明寫欄位含 0） → 允許", async () => {
    await assertSucceeds(
      updateEvent(authAs(OWNER_UID, "user"), EVENT_USER_ID, touch({ title: "改標題", teamReservationReleaseHours: 0 }))
    );
  });

  test("3. 一般 user 委託人（own_edit_basic）改 teamReservationReleaseHours → 允許", async () => {
    await assertSucceeds(updateEvent(authAs(DELEGATE_UID, "user"), EVENT_USER_ID, touch(HOURS)));
  });

  test("4. 教練主辦改 teamReservationReleaseHours → 允許（isScopedRoleBasicUpdate／eventScopedRoleFieldsOnly）", async () => {
    await assertSucceeds(updateEvent(authAs(COACH_UID, "coach"), EVENT_COACH_ID, touch(HOURS)));
  });

  test("5. 一般 user（僅 basic_create／own_edit_basic，無 addons_use）建立活動帶 teamReservationReleaseHours → 允許（create 無 keys 白名單，非加值欄位）", async () => {
    const id = "ce_trr_new";
    const payload = eventPayload({
      id,
      clientRequestId: id,
      delegates: [],
      delegateUids: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...HOURS,
    });
    delete payload.teamReservationSummaries;
    await assertSucceeds(setDoc(doc(authAs(OWNER_UID, "user"), "events", id), payload));
  });
});

describe("釘現況：管理員路徑（canBroadManageEventUpdate）沒有欄位白名單", () => {
  test("6. admin（event.edit_all）改別人的私密活動寫 teamReservationReleasedAt＋Summary → 允許（可接受殘餘風險，計畫書 §3.2）", async () => {
    await seedEvent(EVENT_USER_ID, eventPayload({ privateEvent: true }));
    await assertSucceeds(
      updateEvent(authAs(ADMIN_UID, "admin", true), EVENT_USER_ID, touch({ ...RELEASED_AT, ...RELEASED_SUMMARY }))
    );
  });

  test("7. super_admin 寫 teamReservationReleasedAt → 允許（可接受殘餘風險，計畫書 §3.2）", async () => {
    await assertSucceeds(updateEvent(authAs(SUPER_UID, "super_admin"), EVENT_USER_ID, touch(RELEASED_AT)));
  });
});

describe("deny: 非主辦寫 teamReservationReleaseHours", () => {
  test("8. 非主辦、非委託人的一般 user 改 teamReservationReleaseHours → 拒", async () => {
    await assertFails(updateEvent(authAs(OTHER_UID, "user"), EVENT_USER_ID, touch(HOURS)));
  });

  test("9. 一般 user 主辦但沒有 own_edit_basic 改 teamReservationReleaseHours → 拒（對照案例 1）", async () => {
    await seedUserCaps(["user.activity.basic_create"]);
    await assertFails(updateEvent(authAs(OWNER_UID, "user"), EVENT_USER_ID, touch(HOURS)));
  });

  test("10. 非主辦的教練改別人活動的 teamReservationReleaseHours → 拒（canScopedManageEventData 不符）", async () => {
    await assertFails(updateEvent(authAs(OTHER_COACH_UID, "coach"), EVENT_USER_ID, touch(HOURS)));
  });
});

describe("deny: 一般 user／scoped role 寫 Functions 專用欄位", () => {
  test("11. 一般 user 主辦寫 teamReservationReleasedAt → 拒（對照案例 1）", async () => {
    await assertFails(updateEvent(authAs(OWNER_UID, "user"), EVENT_USER_ID, touch(RELEASED_AT)));
  });

  test("12. 一般 user 主辦寫 teamReservationReleasedSummary → 拒（對照案例 1）", async () => {
    await assertFails(updateEvent(authAs(OWNER_UID, "user"), EVENT_USER_ID, touch(RELEASED_SUMMARY)));
  });

  test("13. 一般 user 委託人寫 teamReservationReleasedAt → 拒（對照案例 3）", async () => {
    await assertFails(updateEvent(authAs(DELEGATE_UID, "user"), EVENT_USER_ID, touch(RELEASED_AT)));
  });

  test("14. 教練主辦寫 teamReservationReleasedAt → 拒（對照案例 4）", async () => {
    await assertFails(updateEvent(authAs(COACH_UID, "coach"), EVENT_COACH_ID, touch(RELEASED_AT)));
  });

  test("15. 教練主辦同時寫 teamReservationReleaseHours＋teamReservationReleasedAt → 拒（hasOnly 不放行夾帶）", async () => {
    await assertFails(
      updateEvent(authAs(COACH_UID, "coach"), EVENT_COACH_ID, touch({ ...HOURS, ...RELEASED_AT }))
    );
  });

  test("16. 任一登入者經報名名額欄位路徑夾帶 teamReservationReleasedAt → 拒（isSignupFieldsOnly 白名單不含）", async () => {
    await assertFails(
      updateEvent(authAs(OTHER_UID, "user"), EVENT_USER_ID, touch({ current: 1, ...RELEASED_AT }))
    );
  });
});
