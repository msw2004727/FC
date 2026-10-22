/**
 * M-089／T-006：公開開關 Rules 契約。
 *
 * 站長 2026-10-22 決定：Rules 只放寬 `events` 文件 `isPublic` 單欄
 * （連同 `updatedAt`）更新；新增 helper `isPublicOnlyVisibilityUpdate()`，
 * 條件為 diff 只含 `isPublic`／`updatedAt`、`isPublic` 為 bool、
 * `resource.data.teamOnly == true`，且符合 (a)／(b)／(c) 之一。
 *
 * 刻意不對齊 A 的兩點：
 *   1. 不複製 coach+ 角色後備：coach／captain 角色若 rolePermissions 沒有
 *      `activity.manage.entry`，不能走新路徑（R-IAM-004）。
 *   2. delegate 只靠 `team.create_event`＋幹部角色不放行：delegate 需有
 *      `activity.manage.entry` 或 `team.toggle_event_visibility`
 *      （角色權限或個人授權），Rules 從嚴。
 *
 * 一般活動與課程連結活動（courseLinked:true）都接上新 helper；
 * 既有 canBroadManageEventUpdate（event.edit_all／super_admin）路徑不變。
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
  deleteDoc,
  serverTimestamp,
  setLogLevel,
} = require("firebase/firestore");

const PROJECT_ID = "demo-b-contract-event-public-toggle";
const RULES_PATH = path.resolve(__dirname, "..", "..", "..", "firestore.rules");
const [EMULATOR_HOST, EMULATOR_PORT] = (
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080"
).split(":");

const OWNER = "uid_t006_owner";
const DELEGATE_USER = "uid_t006_delegate_user";
const COACH_ENTRY = "uid_t006_coach_entry";
const COACH_OWNER = "uid_t006_coach_owner";
const CAPTAIN_FALLBACK = "uid_t006_captain_fallback";
const COACH_STRANGER = "uid_t006_coach_stranger";
const OTHER = "uid_t006_other";
const ADMIN = "uid_t006_admin";
const SUPER = "uid_t006_super";

const TEAM_ID = "t006_team";

const DOC_TEAM = "t006_doc_team";
const DOC_PLAIN = "t006_doc_plain";
const DOC_PRIVATE = "t006_doc_private";
const DOC_COURSE = "t006_doc_course";
const DOC_COACH_OWNED = "t006_doc_coach_owned";

// 照 tests/firestore.rules.test.js：正式站角色在 custom claim `role`。
const ROLE_BY_UID = {
  [OWNER]: "user",
  [DELEGATE_USER]: "user",
  [COACH_ENTRY]: "coach",
  [COACH_OWNER]: "coach",
  [CAPTAIN_FALLBACK]: "captain",
  [COACH_STRANGER]: "coach",
  [OTHER]: "user",
  [ADMIN]: "admin",
  [SUPER]: "super_admin",
};

const ALL_UIDS = Object.keys(ROLE_BY_UID);

function claimFor(uid) {
  const claim = { role: ROLE_BY_UID[uid] };
  if (uid === ADMIN) claim.admin = true;
  if (uid === SUPER) claim.super_admin = true;
  return claim;
}

let testEnv;

jest.setTimeout(20000);

function db(uid) {
  return testEnv.authenticatedContext(uid, claimFor(uid)).firestore();
}

function guestDb() {
  return testEnv.unauthenticatedContext().firestore();
}

function toggle(dbInst, docId, extra = {}) {
  return updateDoc(doc(dbInst, "events", docId), {
    isPublic: true,
    updatedAt: serverTimestamp(),
    ...extra,
  });
}

function baseEvent(overrides = {}) {
  return {
    title: "T-006 公開切換契約",
    type: "friendly",
    status: "open",
    creatorTeamId: TEAM_ID,
    creatorTeamIds: [TEAM_ID],
    isPublic: false,
    viewCount: 0,
    max: 20,
    current: 0,
    waitlist: 0,
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

async function setUserCaps(caps) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "roleActivityCapabilities", "user"), {
      capabilities: caps,
      catalogVersion: "test",
    });
  });
}

async function setGrant(uid, permissions) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "userPermissionGrants", uid), {
      uid,
      permissions,
      enabled: true,
    });
  });
}

async function setRolePerms(role, permissions) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "rolePermissions", role), { permissions });
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
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const firestore = context.firestore();
    const writes = [];

    for (const uid of ALL_UIDS) {
      writes.push(setDoc(doc(firestore, "users", uid), {
        uid,
        displayName: `User ${uid}`,
        role: ROLE_BY_UID[uid],
        teamId: null,
        teamName: null,
        teamIds: [],
        teamNames: [],
      }));
    }

    writes.push(setDoc(doc(firestore, "rolePermissions", "user"), { permissions: [] }));
    writes.push(setDoc(doc(firestore, "rolePermissions", "coach"), { permissions: ["activity.manage.entry"] }));
    writes.push(setDoc(doc(firestore, "rolePermissions", "captain"), { permissions: [] }));
    writes.push(setDoc(doc(firestore, "rolePermissions", "admin"), { permissions: ["event.edit_all"] }));
    writes.push(setDoc(doc(firestore, "rolePermissions", "super_admin"), { permissions: [] }));

    writes.push(setDoc(doc(firestore, "roleActivityCapabilities", "user"), {
      capabilities: ["user.activity.own_edit_basic", "user.activity.site_operate"],
      catalogVersion: "test",
    }));

    writes.push(setDoc(doc(firestore, "teams", TEAM_ID), {
      id: TEAM_ID,
      name: "T-006 隊",
      captainUid: OWNER,
      leaderUids: [],
      coachUids: [COACH_STRANGER, DELEGATE_USER],
    }));

    const teamDelegates = [DELEGATE_USER, COACH_ENTRY, CAPTAIN_FALLBACK];

    writes.push(setDoc(doc(firestore, "events", DOC_TEAM), baseEvent({
      id: "doc_team",
      creatorUid: OWNER,
      delegateUids: teamDelegates,
      teamOnly: true,
      privateEvent: false,
      courseLinked: false,
    })));

    writes.push(setDoc(doc(firestore, "events", DOC_PLAIN), baseEvent({
      id: "doc_plain",
      creatorUid: OWNER,
      delegateUids: teamDelegates,
      teamOnly: false,
      privateEvent: false,
      courseLinked: false,
    })));

    writes.push(setDoc(doc(firestore, "events", DOC_PRIVATE), baseEvent({
      id: "doc_private",
      creatorUid: OWNER,
      delegateUids: teamDelegates,
      teamOnly: true,
      privateEvent: true,
      courseLinked: false,
    })));

    writes.push(setDoc(doc(firestore, "events", DOC_COURSE), baseEvent({
      id: "doc_course",
      creatorUid: OWNER,
      delegateUids: teamDelegates,
      teamOnly: true,
      privateEvent: false,
      courseLinked: true,
      courseLinkSource: "eduCourseLesson",
      courseLinkId: "opaque_link_t006",
    })));

    writes.push(setDoc(doc(firestore, "events", DOC_COACH_OWNED), baseEvent({
      id: "doc_coach_owned",
      creatorUid: COACH_OWNER,
      delegateUids: [],
      teamOnly: true,
      privateEvent: false,
      courseLinked: false,
    })));

    await Promise.all(writes);
  });
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

// 拒絕案例無法用錯誤訊息確認「不是撞 1000 運算式上限才拒」：events update 既有分支在拒絕時會全部評估，
// 現行 Rules（含 HEAD）多半以超限收場。改以「同一檔對 HEAD Rules 跑」做差分（新允許案例在 HEAD 全拒、其餘結果相同）
// 並以 emulator rule coverage 抽查新 helper 自身回傳 false，作為驗證證據（T-006 第 2 輪審查）。
async function seedEvent(id, overrides) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "events", id), baseEvent({
      id,
      teamOnly: true,
      privateEvent: false,
      courseLinked: false,
      delegateUids: [],
      ...overrides,
    }));
  });
}

describe("身分 × 一般俱樂部限定活動（DOC_TEAM，payload isPublic＋updatedAt）", () => {
  test("1. 訪客（unauthenticated）改 isPublic＋updatedAt → 拒絕", async () => {
    await assertFails(toggle(guestDb(), DOC_TEAM));
  });

  test("2. OTHER（一般 user 非 owner／非 delegate）→ 拒絕", async () => {
    await assertFails(toggle(db(OTHER), DOC_TEAM));
  });

  test("3. OWNER，caps 設為 [] → 拒絕（無 addons_use、無授權、角色 user 為空）", async () => {
    await setUserCaps([]);
    await assertFails(toggle(db(OWNER), DOC_TEAM));
  });

  test("4. OWNER，caps 只有 own_edit_basic → 拒絕（缺 addons_use）", async () => {
    await setUserCaps(["user.activity.own_edit_basic"]);
    await assertFails(toggle(db(OWNER), DOC_TEAM));
  });

  test("5. OWNER，caps 含 addons_use → 允許（條件 c：user＋owner＋addons_use）", async () => {
    await setUserCaps(["user.activity.addons_use"]);
    await assertSucceeds(toggle(db(OWNER), DOC_TEAM));
  });

  test("6. OWNER，caps []＋個人授權 team.create_event → 允許（條件 b：owner＋team.create_event）", async () => {
    await setUserCaps([]);
    await setGrant(OWNER, ["team.create_event"]);
    await assertSucceeds(toggle(db(OWNER), DOC_TEAM));
  });

  test("7. OWNER，caps []＋個人授權 team.toggle_event_visibility → 允許（條件 a）", async () => {
    await setUserCaps([]);
    await setGrant(OWNER, ["team.toggle_event_visibility"]);
    await assertSucceeds(toggle(db(OWNER), DOC_TEAM));
  });

  test("8. DELEGATE_USER，caps 含 addons_use／own_edit_basic／site_operate 但無授權 → 拒絕（addons_use 僅 owner 可用）", async () => {
    await setUserCaps([
      "user.activity.addons_use",
      "user.activity.own_edit_basic",
      "user.activity.site_operate",
    ]);
    await assertFails(toggle(db(DELEGATE_USER), DOC_TEAM));
  });

  test("9. DELEGATE_USER，個人授權 team.toggle_event_visibility → 允許（條件 a）", async () => {
    await setGrant(DELEGATE_USER, ["team.toggle_event_visibility"]);
    await assertSucceeds(toggle(db(DELEGATE_USER), DOC_TEAM));
  });

  test("10. DELEGATE_USER，個人授權 activity.manage.entry → 允許（條件 a）", async () => {
    await setGrant(DELEGATE_USER, ["activity.manage.entry"]);
    await assertSucceeds(toggle(db(DELEGATE_USER), DOC_TEAM));
  });

  test("11. DELEGATE_USER，個人授權 team.create_event（且是 t006_team 教練）→ 拒絕（不對齊 A：delegate 需 manage.entry 或 toggle_event_visibility）", async () => {
    await setGrant(DELEGATE_USER, ["team.create_event"]);
    await assertFails(toggle(db(DELEGATE_USER), DOC_TEAM));
  });

  test("12. COACH_ENTRY（delegate，coach rolePermissions 含 activity.manage.entry）→ 允許（條件 a 角色權限）", async () => {
    await assertSucceeds(toggle(db(COACH_ENTRY), DOC_TEAM));
  });

  test("13. COACH_OWNER 在 DOC_COACH_OWNED（自己擁有，coach 角色含 activity.manage.entry）→ 允許", async () => {
    await assertSucceeds(toggle(db(COACH_OWNER), DOC_COACH_OWNED));
  });

  test("14. COACH_ENTRY，rolePermissions coach 設 [] → 拒絕（R-IAM-004：不複製 coach+ 角色後備）", async () => {
    await setRolePerms("coach", []);
    await assertFails(toggle(db(COACH_ENTRY), DOC_TEAM));
  });

  test("15. CAPTAIN_FALLBACK（delegate，captain rolePermissions 空）→ 拒絕（不複製 captain 角色後備）", async () => {
    await assertFails(toggle(db(CAPTAIN_FALLBACK), DOC_TEAM));
  });

  test("16. CAPTAIN_FALLBACK，rolePermissions captain 含 team.toggle_event_visibility → 允許", async () => {
    await setRolePerms("captain", ["team.toggle_event_visibility"]);
    await assertSucceeds(toggle(db(CAPTAIN_FALLBACK), DOC_TEAM));
  });

  test("17. COACH_STRANGER（俱樂部教練但非 owner／delegate）→ 拒絕", async () => {
    await assertFails(toggle(db(COACH_STRANGER), DOC_TEAM));
  });

  test("18. ADMIN（event.edit_all，非 owner）→ 允許（既有 canBroadManageEventUpdate 不變）", async () => {
    await assertSucceeds(toggle(db(ADMIN), DOC_TEAM));
  });

  test("19. ADMIN，rolePermissions admin 設 [] → 拒絕（既有 broad 路徑失效）", async () => {
    await setRolePerms("admin", []);
    await assertFails(toggle(db(ADMIN), DOC_TEAM));
  });

  test("20. SUPER → 允許（既有 super_admin 路徑不變）", async () => {
    await assertSucceeds(toggle(db(SUPER), DOC_TEAM));
  });
});

describe("情境（DOC_PLAIN／DOC_PRIVATE／DOC_COURSE）", () => {
  test("21. DOC_PLAIN（非俱樂部限定），OWNER＋addons_use → 拒絕（helper 要求 teamOnly==true；A 也不顯示開關）", async () => {
    await setUserCaps(["user.activity.addons_use"]);
    await assertFails(toggle(db(OWNER), DOC_PLAIN));
  });

  test("22. DOC_PLAIN，ADMIN → 允許（既有 broad 路徑不變）", async () => {
    await assertSucceeds(toggle(db(ADMIN), DOC_PLAIN));
  });

  test("23. DOC_PRIVATE（teamOnly:true），OWNER＋addons_use → 允許", async () => {
    await setUserCaps(["user.activity.addons_use"]);
    await assertSucceeds(toggle(db(OWNER), DOC_PRIVATE));
  });

  test("24. DOC_PRIVATE，COACH_ENTRY → 允許", async () => {
    await assertSucceeds(toggle(db(COACH_ENTRY), DOC_PRIVATE));
  });

  test("25. DOC_COURSE，OWNER＋addons_use → 允許（courseLinked 也接新 helper）", async () => {
    await setUserCaps(["user.activity.addons_use"]);
    await assertSucceeds(toggle(db(OWNER), DOC_COURSE));
  });

  test("26. DOC_COURSE，OTHER → 拒絕", async () => {
    await assertFails(toggle(db(OTHER), DOC_COURSE));
  });

  test("27. DOC_COURSE，OWNER＋addons_use，extra privateEvent:true → 拒絕（privateEvent 不在本次放寬範圍）", async () => {
    await setUserCaps(["user.activity.addons_use"]);
    await assertFails(toggle(db(OWNER), DOC_COURSE, { privateEvent: true }));
  });

  // 記錄既有行為（非本任務放寬）：課程連結活動的 isCourseLinkedVisibilityUpdate 走 canScopedManageEventData，
  // 仍含 coach+ 角色後備（R-IAM-004 已知 drift），所以 rolePermissions 空的 captain delegate 仍可改；修 drift 另案處理。
  test("28. DOC_COURSE，CAPTAIN_FALLBACK（rolePermissions 空）→ 允許（既有課程連結路徑的 coach+ 後備，非本任務新增）", async () => {
    await assertSucceeds(toggle(db(CAPTAIN_FALLBACK), DOC_COURSE));
  });
});

// 新 helper 排在 allow update OR 清單第一位；以下確認既有路徑不受影響（含 1000 運算式上限）。
describe("既有路徑回歸", () => {
  test("35. OWNER，caps []＋個人授權 event.edit_self → 允許（既有 isEventOwner＋event.edit_self 路徑）", async () => {
    await setUserCaps([]);
    await setGrant(OWNER, ["event.edit_self"]);
    await assertSucceeds(toggle(db(OWNER), DOC_TEAM));
  });

  test("36. OWNER（own_edit_basic）只改標題 → 允許（既有 isUserOwnerBasicUpdate）", async () => {
    await assertSucceeds(updateDoc(doc(db(OWNER), "events", DOC_TEAM), {
      title: "改標題",
      updatedAt: serverTimestamp(),
    }));
  });

  test("37. COACH_ENTRY（delegate）只改標題 → 允許（既有 isScopedRoleBasicUpdate）", async () => {
    await assertSucceeds(updateDoc(doc(db(COACH_ENTRY), "events", DOC_TEAM), {
      title: "改標題",
      updatedAt: serverTimestamp(),
    }));
  });
});

describe.each([
  { label: "OWNER+addons", uid: OWNER, setup: async () => setUserCaps(["user.activity.addons_use"]) },
  { label: "COACH_ENTRY", uid: COACH_ENTRY, setup: async () => {} },
  {
    label: "DELEGATE_USER+toggle grant",
    uid: DELEGATE_USER,
    setup: async () => setGrant(DELEGATE_USER, ["team.toggle_event_visibility"]),
  },
])("多帶欄位／型別 — $label（DOC_TEAM）", ({ uid, setup }) => {
  test("29. extra { title: \"改標題\" } → 拒絕（diff 不在白名單）", async () => {
    await setup();
    await assertFails(toggle(db(uid), DOC_TEAM, { title: "改標題" }));
  });

  test("30. extra { privateEvent: true } → 拒絕（diff 不在白名單）", async () => {
    await setup();
    await assertFails(toggle(db(uid), DOC_TEAM, { privateEvent: true }));
  });

  test("31. extra { teamOnly: false } → 拒絕（diff 不在白名單）", async () => {
    await setup();
    await assertFails(toggle(db(uid), DOC_TEAM, { teamOnly: false }));
  });

  test("32. extra { viewCount: 100 } → 拒絕（diff 不在白名單）", async () => {
    await setup();
    await assertFails(toggle(db(uid), DOC_TEAM, { viewCount: 100 }));
  });

  test("33. extra { unexpectedVisibilityField: true } → 拒絕（diff 不在白名單）", async () => {
    await setup();
    await assertFails(toggle(db(uid), DOC_TEAM, { unexpectedVisibilityField: true }));
  });

  test("34. isPublic: \"yes\"（非 bool，直接 updateDoc 不用 toggle）→ 拒絕", async () => {
    await setup();
    await assertFails(updateDoc(doc(db(uid), "events", DOC_TEAM), {
      isPublic: "yes",
      updatedAt: serverTimestamp(),
    }));
  });
});

describe("邊界（第 2 輪審查補測）", () => {
  test("38. owner 欄位是 ownerUid（creatorUid 是別人），OWNER＋addons_use → 允許", async () => {
    await setUserCaps(["user.activity.addons_use"]);
    await seedEvent("t006_doc_owner_uid", { creatorUid: OTHER, ownerUid: OWNER });
    await assertSucceeds(toggle(db(OWNER), "t006_doc_owner_uid"));
  });

  test("39. owner 欄位是 captainUid（creatorUid 是別人），OWNER＋addons_use → 允許", async () => {
    await setUserCaps(["user.activity.addons_use"]);
    await seedEvent("t006_doc_captain_uid", { creatorUid: OTHER, captainUid: OWNER });
    await assertSucceeds(toggle(db(OWNER), "t006_doc_captain_uid"));
  });

  test("40. DELEGATE_USER 個人授權 team.toggle_event_visibility 但 enabled:false → 拒絕", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "userPermissionGrants", DELEGATE_USER), {
        uid: DELEGATE_USER,
        permissions: ["team.toggle_event_visibility"],
        enabled: false,
      });
    });
    await assertFails(toggle(db(DELEGATE_USER), DOC_TEAM));
  });

  test("41. roleActivityCapabilities/user 文件不存在，OWNER（無授權）→ 拒絕（addons_use 不在缺文件預設清單）", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await deleteDoc(doc(context.firestore(), "roleActivityCapabilities", "user"));
    });
    await assertFails(toggle(db(OWNER), DOC_TEAM));
  });

  test("42. rolePermissions/user 含 team.toggle_event_visibility，OWNER（caps []）→ 拒絕（user 角色不讀 rolePermissions）", async () => {
    await setUserCaps([]);
    await setRolePerms("user", ["team.toggle_event_visibility"]);
    await assertFails(toggle(db(OWNER), DOC_TEAM));
  });

  test("43. 關閉公開（isPublic true → false），COACH_ENTRY → 允許", async () => {
    await seedEvent("t006_doc_public_on", { creatorUid: OWNER, delegateUids: [COACH_ENTRY], isPublic: true });
    await assertSucceeds(updateDoc(doc(db(COACH_ENTRY), "events", "t006_doc_public_on"), {
      isPublic: false,
      updatedAt: serverTimestamp(),
    }));
  });

  test("44. DELEGATE_USER 的 token claim 寫 coach，但 users 文件是 user → 拒絕（authRole 以 users 文件為準，不吃 coach 角色權限）", async () => {
    const spoofed = testEnv.authenticatedContext(DELEGATE_USER, { role: "coach" }).firestore();
    await assertFails(toggle(spoofed, DOC_TEAM));
  });

  test("45. delegateUids 不是 list（字串），DELEGATE_USER 個人授權 team.toggle_event_visibility → 拒絕", async () => {
    await setGrant(DELEGATE_USER, ["team.toggle_event_visibility"]);
    await seedEvent("t006_doc_bad_delegates", { creatorUid: OWNER, delegateUids: DELEGATE_USER });
    await assertFails(toggle(db(DELEGATE_USER), "t006_doc_bad_delegates"));
  });
});
