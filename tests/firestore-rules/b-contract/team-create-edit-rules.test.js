/**
 * 契約測試：FC-B 新增／編輯俱樂部的 teams 文件直寫。
 *
 * 函式與 Rules 依據：
 * - buildCreateTeamPayload／buildUpdateTeamPatch：
 *   依附件逐欄固定 payload，不 import B 的實作或驗證前端表單邏輯。
 *   serverTimestamp 與 null eduSettings → deleteField 由寫入層處理。
 * - create：isAuth()、hasString('name')，以及 team.create 或全隊管理授權。
 *   hasString 明定字串 size() > 0，故空字串會被拒絕；此處不是 trim 驗證。
 * - update：isTeamOwner() 依既有文件的 captainUid／creatorUid／ownerUid 判斷；
 *   擁有者或 canManageAnyTeam() 可更新任意欄位。
 * - 領隊／教練的 isTeamStaffFieldsOnly() 不包含基本資料欄位；
 *   一般成員的 isTeamMemberCountOnly() 僅容許 members／updatedAt。
 * - 使用 enabled:true 的 userPermissionGrants 個別授權；
 *   不種 rolePermissions，避免將 admin 角色誤當成全隊管理授權。
 * - affectedKeys() 比較實際差異，不是 payload 的鍵清單；
 *   完整編輯 patch 的每個欄位均與種子不同，包含經理 UID、圖片及時間；
 *   eduSettings 先種入物件，確保 deleteField() 產生實際刪除。
 * - B 編輯 patch 不含 members，因此不對夾帶 members 寫斷言。
 *   依附件 Rules，owner／全隊管理授權分支無欄位白名單；
 *   staff／member 分支即使允許 members，也不允許夾帶本檔基本資料變更。
 * - 經理轉移後，沒有 creatorUid／ownerUid 或其他授權的原經理失去編輯權；
 *   這是 A 既有語意，不是 B 新增限制。
 *
 * // ASSUMPTION: 本次僅依附件產碼，未執行 Rules emulator；
 * 尚無實測結果可標註「與預期不符」。以下固定斷言交由現行 Rules 驗證，
 * 不以捕捉錯誤或自動切換預期的方式掩蓋差異。
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
  deleteField,
  Timestamp,
} = require("firebase/firestore");

const PROJECT_ID = "demo-b-contract-team-form";
const RULES_PATH = path.resolve(__dirname, "..", "..", "..", "firestore.rules");
const [EMULATOR_HOST, EMULATOR_PORT] = (
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080"
).split(":");

jest.setTimeout(20000);

let testEnv;

const TEAM_MAIN = "tm_t1";
const TEAM_CREATE = "tm_1792713600000_abc123";
const TEAM_NAME = "原俱樂部";

const CAP = "cap_uid_001";
const CREATOR = "creator_uid_001";
const OWNER = "owner_uid_001";
const LEAD = "leader_uid_001";
const COACH = "coach_uid_001";
const MEM = "member_uid_001";
const OUTSIDER = "outsider_uid_001";
const MANAGER = "manager_uid_001";
const DISABLED = "disabled_uid_001";
const OTHER_PERMISSION = "other_permission_uid_001";
const ADMIN_ONLY = "admin_only_uid_001";
const NEXT_CAP = "cap_uid_002";
const NEXT_LEAD = "leader_uid_002";
const NEXT_COACH = "coach_uid_002";

// 完整教學型建立契約：含選用圖片及教學設定；刻意沒有 creatorUid／ownerUid。
// CAP 的 users.role 是 user，建立成功須依賴個別 team.create 授權。
const CREATE_PAYLOAD = {
  id: TEAM_CREATE,
  name: "新俱樂部",
  nameEn: "New Club",
  nationality: "台灣",
  captain: "原經理",
  captainName: "原經理",
  captainUid: CAP,
  leaders: ["原領隊"],
  leaderNames: ["原領隊"],
  leaderUids: [LEAD],
  leader: "原領隊",
  leaderUid: LEAD,
  coaches: ["原教練"],
  coachNames: ["原教練"],
  coachUids: [COACH],
  members: 3,
  region: "臺北市",
  founded: "2020",
  contact: "原聯絡人",
  bio: "原俱樂部介紹",
  image: "https://example.test/old-cover.webp",
  imageVariants: {
    cover: "https://example.test/old-cover.webp",
    card: "https://example.test/old-card.webp",
  },
  contactLinksEnabled: true,
  contactLinks: [
    {
      url: "https://example.test/old-club",
      platform: "website",
      label: "官方網站",
      host: "example.test",
    },
  ],
  active: true,
  pinned: false,
  pinOrder: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  gf: 0,
  ga: 0,
  history: [],
  type: "education",
  sportTag: "football",
  teachingEnabled: true,
  eduSettings: {
    acceptingStudents: true,
    teachingEnabled: true,
  },
};

// 完整非教學型編輯契約，含新圖片及寫入層轉換後的 eduSettings。
// captainUid 也實際改變：驗證授權來自寫入前的文件，而非寫入後的新經理。
// ASSUMPTION: sportTag 使用 football／basketball，contactLinks.platform 使用
// website 作為固定測試值；附件 teams Rules 不驗證這些選項代碼。
const UPDATE_PATCH = {
  name: "更新俱樂部",
  nameEn: "Updated Club",
  nationality: "日本",
  region: "其他",
  founded: "2026",
  contact: "新聯絡人",
  bio: "更新後的俱樂部介紹",
  contactLinksEnabled: false,
  contactLinks: [],
  leader: "新領隊",
  leaderUid: NEXT_LEAD,
  leaders: ["新領隊"],
  leaderUids: [NEXT_LEAD],
  leaderNames: ["新領隊"],
  captain: "新經理",
  captainUid: NEXT_CAP,
  captainName: "新經理",
  coaches: ["新教練"],
  coachUids: [NEXT_COACH],
  coachNames: ["新教練"],
  type: "leisure",
  sportTag: "basketball",
  teachingEnabled: false,
  eduSettings: deleteField(),
  image: "https://example.test/new-cover.webp",
  imageVariants: {
    cover: "https://example.test/new-cover.webp",
    card: "https://example.test/new-card.webp",
  },
  updatedAt: serverTimestamp(),
};

const CREATE_DENIED_MATRIX = [
  ["沒有任何授權的一般使用者", OUTSIDER],
  ["個別建立授權已停用的使用者", DISABLED],
  ["個別授權只有其他權限碼的使用者", OTHER_PERMISSION],
  ["只有管理員角色且沒有角色權限文件或個別授權的使用者", ADMIN_ONLY],
];

const EDIT_MATRIX = [
  ["經理", CAP, {}, true],
  ["僅建立者欄位符合自己的使用者", CREATOR, { creatorUid: CREATOR }, true],
  ["僅擁有者欄位符合自己的使用者", OWNER, { ownerUid: OWNER }, true],
  ["具全隊管理個別授權的使用者", MANAGER, {}, true],
  ["領隊", LEAD, {}, false],
  ["教練", COACH, {}, false],
  ["一般成員", MEM, {}, false],
  ["外部使用者", OUTSIDER, {}, false],
];

function authAs(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

function createTeam(db, payload) {
  return setDoc(doc(db, "teams", TEAM_CREATE), {
    ...payload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
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

    // 預設只有 captainUid，沒有 creatorUid／ownerUid。
    // 舊時間固定，確保 updatedAt 的 serverTimestamp 也產生實際差異。
    await setDoc(doc(db, "teams", TEAM_MAIN), {
      ...CREATE_PAYLOAD,
      id: TEAM_MAIN,
      name: TEAM_NAME,
      createdAt: Timestamp.fromMillis(1000),
      updatedAt: Timestamp.fromMillis(2000),
    });

    // staff 身分由 teams 的 captain／leader／coach UID 欄位成立。
    // MANAGER 不屬於本隊，成功寫入須走 team.manage_all 授權分支。
    const users = [
      [CAP, "user", true],
      [CREATOR, "user", false],
      [OWNER, "user", false],
      [LEAD, "team_leader", true],
      [COACH, "coach", true],
      [MEM, "user", true],
      [OUTSIDER, "user", false],
      [MANAGER, "admin", false],
      [DISABLED, "user", false],
      [OTHER_PERMISSION, "user", false],
      [ADMIN_ONLY, "admin", false],
      [NEXT_CAP, "user", false],
      [NEXT_LEAD, "user", false],
      [NEXT_COACH, "user", false],
    ];

    for (const [uid, role, belongsToTeam] of users) {
      await setDoc(doc(db, "users", uid), {
        uid,
        role,
        teamId: belongsToTeam ? TEAM_MAIN : null,
        teamName: belongsToTeam ? TEAM_NAME : null,
        teamIds: belongsToTeam ? [TEAM_MAIN] : [],
        teamNames: belongsToTeam ? [TEAM_NAME] : [],
      });
    }

    const grants = [
      [CAP, true, ["team.create"]],
      [MANAGER, true, ["team.manage_all"]],
      [DISABLED, false, ["team.create"]],
      [OTHER_PERMISSION, true, ["team.assign_coach"]],
    ];

    for (const [uid, enabled, permissions] of grants) {
      await setDoc(doc(db, "userPermissionGrants", uid), {
        uid,
        enabled,
        permissions,
      });
    }

    // 不建立任何 rolePermissions 文件。
    // ADMIN_ONLY 與 OUTSIDER 也沒有 userPermissionGrants 文件。
  });
});

afterAll(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

describe("建立俱樂部：完整契約與個別授權", () => {
  test("一般使用者具建立授權，以自己為經理且不帶建立者或擁有者欄位可建立", async () => {
    await assertSucceeds(createTeam(authAs(CAP), CREATE_PAYLOAD));
  });

  test("現行規則觀察：具建立授權時另帶建立者欄位也可建立", async () => {
    // Rules 不禁止 creatorUid；B 刻意不寫，此例僅作對照記錄。
    await assertSucceeds(
      createTeam(authAs(CAP), {
        ...CREATE_PAYLOAD,
        creatorUid: CAP,
      })
    );
  });

  test("具全隊管理個別授權者可以自己為經理建立", async () => {
    await assertSucceeds(
      createTeam(authAs(MANAGER), {
        ...CREATE_PAYLOAD,
        captain: "全隊管理者",
        captainName: "全隊管理者",
        captainUid: MANAGER,
      })
    );
  });

  test.each(CREATE_DENIED_MATRIX)("%s 不可建立", async (_label, uid) => {
    await assertFails(
      createTeam(authAs(uid), {
        ...CREATE_PAYLOAD,
        captain: "申請建立者",
        captainName: "申請建立者",
        captainUid: uid,
      })
    );
  });

  test("未登入不可建立完整契約文件", async () => {
    await assertFails(
      createTeam(testEnv.unauthenticatedContext().firestore(), CREATE_PAYLOAD)
    );
  });
});

describe("建立俱樂部：名稱必須是非空字串", () => {
  test("具建立授權但缺少名稱時拒絕", async () => {
    const payload = { ...CREATE_PAYLOAD };
    delete payload.name;

    await assertFails(createTeam(authAs(CAP), payload));
  });

  test("具建立授權但名稱為空字串時拒絕", async () => {
    // 附件 hasString 要求 size() > 0；空字串大小為 0，明確不符合。
    await assertFails(
      createTeam(authAs(CAP), { ...CREATE_PAYLOAD, name: "" })
    );
  });

  test("具建立授權但名稱不是字串時拒絕", async () => {
    await assertFails(
      createTeam(authAs(CAP), { ...CREATE_PAYLOAD, name: 123 })
    );
  });
});

describe("編輯基本資料：完整欄位與既有文件身分", () => {
  test.each(EDIT_MATRIX)(
    "%s 寫入完整基本資料與圖片契約",
    async (_label, uid, ownerFields, allowed) => {
      if (Object.keys(ownerFields).length > 0) {
        // creator／owner 案例各自只加一個身分欄位；
        // captainUid 仍是 CAP，確保成功來源不是經理身分。
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          await updateDoc(
            doc(ctx.firestore(), "teams", TEAM_MAIN),
            ownerFields
          );
        });
      }

      const write = updateDoc(
        doc(authAs(uid), "teams", TEAM_MAIN),
        UPDATE_PATCH
      );
      await (allowed ? assertSucceeds(write) : assertFails(write));
    }
  );
});

describe("經理轉移：保留既有授權語意", () => {
  test("經理可轉移給他人，轉移後原經理不得再修改基本資料", async () => {
    // 此種子沒有 creatorUid／ownerUid。
    // CAP 只有 team.create，不具有任何編輯用的全隊管理授權。
    await assertSucceeds(
      updateDoc(doc(authAs(CAP), "teams", TEAM_MAIN), UPDATE_PATCH)
    );

    // 必須再次改變基本資料，不能重送相同 patch 形成只有時間變更的寫入。
    // 原經理仍有 users 的隊伍關聯，但成員分支不允許改 name。
    // 這是 A 既有語意：isTeamOwner 讀取轉移完成後的 resource.data。
    await assertFails(
      updateDoc(doc(authAs(CAP), "teams", TEAM_MAIN), {
        name: "原經理再次修改的名稱",
        updatedAt: serverTimestamp(),
      })
    );
  });
});
