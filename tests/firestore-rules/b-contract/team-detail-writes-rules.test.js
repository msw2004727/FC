/**
 * 契約測試：FC-B src/features/clubs/data/teams-write.ts 的俱樂部文件直寫。
 *
 * 函式與 Rules 依據：
 * - saveTeamAvatar、saveTeamCover、saveTeamSettingsPatch：
 *   isTeamOwner() 或 canManageAnyTeam() 可更新任意欄位；
 *   領隊／教練的 isTeamStaffFieldsOnly() 不包含頭像、封面、設定欄位。
 * - saveTeamRoleChange／saveTeamRoleUpdates：
 *   驗證八個職務欄位的寫入 payload，不驗證交易或前端職務計算。
 *   coaches 雖在 staff 白名單內，coachUids／coachNames 等欄位不在其中。
 * - saveTeamMemberNote：
 *   memberActivityData／memberCourseData 在 staff 頂層白名單內；
 *   FieldPath 更新須保留同一成員的其他欄位及其他成員的紀錄。
 * - 一般成員的 isTeamMemberCountOnly() 僅容許 members／updatedAt；
 *   本檔 payload 均實際改動該白名單之外的欄位。
 * - MANAGER 使用 enabled:true 的個別 team.manage_all 授權；
 *   不種 rolePermissions，避免將 admin 角色誤當成全隊管理授權。
 * - affectedKeys() 比較實際差異，不是 payload 的鍵清單；
 *   各拒絕案例均確保至少一個禁止欄位的值確實改變。
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
  getDoc,
  updateDoc,
  setLogLevel,
  serverTimestamp,
  deleteField,
  FieldPath,
  Timestamp,
} = require("firebase/firestore");

const PROJECT_ID = "demo-b-contract-team-detail";
const RULES_PATH = path.resolve(__dirname, "..", "..", "..", "firestore.rules");
const [EMULATOR_HOST, EMULATOR_PORT] = (
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080"
).split(":");

jest.setTimeout(20000);

let testEnv;

const TEAM_MAIN = "tm_t1";
const TEAM_NAME = "Test Team";

const CAP = "cap_uid_001";
const LEAD = "leader_uid_001";
const COACH = "coach_uid_001";
const MEM = "member_uid_001";
const MEM2 = "member_uid_002";
const OUTSIDER = "outsider_uid_001";
const MANAGER = "manager_uid_001";

const NOTE_TIME = "2026-10-23T00:00:00.000Z";
const NEW_AVATAR = "https://example.test/new.png";

const OWNER_ONLY_MATRIX = [
  ["隊長", CAP, true],
  ["具全隊管理授權的管理員", MANAGER, true],
  ["領隊", LEAD, false],
  ["教練", COACH, false],
  ["一般成員", MEM, false],
  ["外部使用者", OUTSIDER, false],
];

const NOTE_MATRIX = [
  ["隊長", CAP, true],
  ["領隊", LEAD, true],
  ["教練", COACH, true],
  ["具全隊管理授權的管理員", MANAGER, true],
  ["一般成員", MEM, false],
  ["外部使用者", OUTSIDER, false],
];

function authAs(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

function rolePayload() {
  return {
    leaderUids: [LEAD],
    leaders: ["Lead N"],
    leaderNames: ["Lead N"],
    leaderUid: LEAD,
    leader: "Lead N",
    coachUids: [COACH, MEM],
    coaches: ["Coach N", "Member N"],
    coachNames: ["Coach N", "Member N"],
    updatedAt: serverTimestamp(),
  };
}

async function readTeamWithoutRules() {
  let data;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore(), "teams", TEAM_MAIN));
    expect(snap.exists()).toBe(true);
    data = snap.data();
  });
  return data;
}

function writeMemberNote(uid, fieldName) {
  return updateDoc(
    doc(authAs(uid), "teams", TEAM_MAIN),
    new FieldPath(fieldName, MEM, "notes"),
    "new note",
    new FieldPath(fieldName, MEM, "updatedAt"),
    NOTE_TIME,
    "updatedAt",
    serverTimestamp()
  );
}

function expectOnlyMemberNoteChanged(before, after, fieldName) {
  expect(after[fieldName][MEM]).toEqual({
    ...before[fieldName][MEM],
    notes: "new note",
    updatedAt: NOTE_TIME,
  });
  expect(after[fieldName][MEM].extra).toBe(5);
  expect(after[fieldName][MEM2]).toEqual(before[fieldName][MEM2]);
  expect(after[fieldName]).toEqual({
    ...before[fieldName],
    [MEM]: {
      ...before[fieldName][MEM],
      notes: "new note",
      updatedAt: NOTE_TIME,
    },
  });

  expect(after.updatedAt).toBeInstanceOf(Timestamp);
  expect(after.avatarUrl).toBe(before.avatarUrl);
  expect(after.coachUids).toEqual(before.coachUids);

  const beforeOtherFields = { ...before };
  const afterOtherFields = { ...after };
  delete beforeOtherFields[fieldName];
  delete afterOtherFields[fieldName];
  delete beforeOtherFields.updatedAt;
  delete afterOtherFields.updatedAt;
  expect(afterOtherFields).toEqual(beforeOtherFields);
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

    await setDoc(doc(db, "teams", TEAM_MAIN), {
      id: TEAM_MAIN,
      name: TEAM_NAME,
      captainUid: CAP,
      creatorUid: CAP,
      ownerUid: CAP,
      leaderUids: [LEAD],
      leaders: ["Lead N"],
      leaderNames: ["Lead N"],
      leaderUid: LEAD,
      leader: "Lead N",
      coachUids: [COACH],
      coaches: ["Coach N"],
      coachNames: ["Coach N"],
      members: 3,
      type: "competitive",
      allowMemberInvite: true,
      detailVisibility: { events: true, members: true },
      memberActivityData: {
        [MEM]: { notes: "old", extra: 5 },
        [MEM2]: {
          notes: "other member activity",
          extra: 9,
          updatedAt: "2026-10-22T00:00:00.000Z",
        },
      },
      memberCourseData: {
        [MEM]: { notes: "old course", extra: 5 },
        [MEM2]: {
          notes: "other member course",
          extra: 11,
          updatedAt: "2026-10-22T00:00:00.000Z",
        },
      },
      avatarUrl: "https://example.test/old.png",
      image: "https://example.test/old-cover.png",
      imageVariants: { cover: "https://example.test/old-cover.png" },
    });

    // staff 身分由 teams 的 captain／leader／coach UID 欄位成立。
    // MANAGER 不屬於本隊，成功寫入須走 team.manage_all 授權分支。
    const users = [
      [CAP, "captain", true],
      [LEAD, "team_leader", true],
      [COACH, "coach", true],
      [MEM, "user", true],
      [MEM2, "user", true],
      [OUTSIDER, "user", false],
      [MANAGER, "admin", false],
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

    await setDoc(doc(db, "userPermissionGrants", MANAGER), {
      uid: MANAGER,
      enabled: true,
      permissions: ["team.manage_all"],
    });
  });
});

afterAll(async () => {
  if (testEnv) {
    await testEnv.cleanup();
  }
});

describe("頭像：只有擁有者或全隊管理授權可寫入", () => {
  test.each(OWNER_ONLY_MATRIX)(
    "%s 寫入頭像，允許結果為 %s（依矩陣斷言）",
    async (_label, uid, allowed) => {
      const write = updateDoc(doc(authAs(uid), "teams", TEAM_MAIN), {
        avatarUrl: NEW_AVATAR,
        updatedAt: serverTimestamp(),
      });
      await (allowed ? assertSucceeds(write) : assertFails(write));
    }
  );
});

describe("封面：只有擁有者或全隊管理授權可寫入", () => {
  test.each(OWNER_ONLY_MATRIX)(
    "%s 寫入封面與尺寸圖",
    async (_label, uid, allowed) => {
      const write = updateDoc(doc(authAs(uid), "teams", TEAM_MAIN), {
        image: "https://example.test/new-cover.png",
        imageVariants: {
          cover: "https://example.test/new-cover.png",
          card: "https://example.test/new-card.png",
        },
        updatedAt: serverTimestamp(),
      });
      await (allowed ? assertSucceeds(write) : assertFails(write));
    }
  );
});

const SETTINGS_CASES = [
  {
    name: "切換教學類型並啟用招生",
    payload: () => ({
      type: "education",
      teachingEnabled: true,
      eduSettings: { acceptingStudents: true, teachingEnabled: true },
    }),
  },
  {
    name: "切換休閒類型並刪除教學設定",
    seed: {
      type: "education",
      teachingEnabled: true,
      eduSettings: { acceptingStudents: true, teachingEnabled: true },
    },
    payload: () => ({
      type: "leisure",
      teachingEnabled: false,
      eduSettings: deleteField(),
    }),
    verify: (data) => {
      expect(data.type).toBe("leisure");
      expect(data.teachingEnabled).toBe(false);
      expect(data).not.toHaveProperty("eduSettings");
    },
  },
  {
    name: "關閉成員邀請",
    payload: () => ({ allowMemberInvite: false }),
  },
  {
    name: "設定主題色",
    payload: () => ({ themeColor: "#112233" }),
  },
  {
    name: "保留主題色的空值",
    seed: { themeColor: "#445566" },
    payload: () => ({ themeColor: null }),
    verify: (data) => {
      expect(data).toHaveProperty("themeColor", null);
    },
  },
  {
    name: "關閉主題遮罩",
    seed: { themeOverlayEnabled: true },
    payload: () => ({ themeOverlayEnabled: false }),
  },
  {
    name: "隱藏活動並保留成員可見",
    payload: () => ({
      detailVisibility: { events: false, members: true },
    }),
  },
];

describe.each(SETTINGS_CASES)("設定：$name", (setting) => {
  beforeEach(async () => {
    if (setting.seed) {
      // 先建立確實存在的欄位，讓刪除、清空及關閉操作產生實際差異。
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await updateDoc(
          doc(ctx.firestore(), "teams", TEAM_MAIN),
          setting.seed
        );
      });
    }
  });

  test.each(OWNER_ONLY_MATRIX)(
    "%s 寫入此設定",
    async (_label, uid, allowed) => {
      const payload = {
        ...setting.payload(),
        updatedAt: serverTimestamp(),
      };
      const write = updateDoc(doc(authAs(uid), "teams", TEAM_MAIN), payload);
      await (allowed ? assertSucceeds(write) : assertFails(write));

      if (allowed && setting.verify) {
        setting.verify(await readTeamWithoutRules());
      }
    }
  );
});

describe("升降職務：八個欄位的直寫契約", () => {
  test.each(OWNER_ONLY_MATRIX)(
    "%s 將一般成員加入教練名單",
    async (_label, uid, allowed) => {
      const write = updateDoc(
        doc(authAs(uid), "teams", TEAM_MAIN),
        rolePayload()
      );
      await (allowed ? assertSucceeds(write) : assertFails(write));
    }
  );

  test("現行規則觀察：隊長可在職務更新中一併改成員數", async () => {
    // 僅記錄 owner 無欄位白名單的 Rules 行為；FC-B 刻意不寫 members，此例不是 B payload 契約。
    await assertSucceeds(
      updateDoc(doc(authAs(CAP), "teams", TEAM_MAIN), {
        ...rolePayload(),
        members: 4,
      })
    );
  });
});

describe("活動備註：巢狀更新與既有資料保留", () => {
  test.each(NOTE_MATRIX)(
    "%s 更新指定成員備註",
    async (_label, uid, allowed) => {
      const before = await readTeamWithoutRules();
      const write = writeMemberNote(uid, "memberActivityData");
      await (allowed ? assertSucceeds(write) : assertFails(write));

      const after = await readTeamWithoutRules();
      if (allowed) {
        expectOnlyMemberNoteChanged(before, after, "memberActivityData");
      } else {
        expect(after).toEqual(before);
      }
    }
  );
});

describe("幹部不得夾帶白名單以外的變更", () => {
  test("領隊更新活動備註並夾帶頭像，整筆拒絕", async () => {
    const before = await readTeamWithoutRules();

    await assertFails(
      updateDoc(doc(authAs(LEAD), "teams", TEAM_MAIN), {
        [`memberActivityData.${MEM}.notes`]: "smuggled note",
        avatarUrl: NEW_AVATAR,
        updatedAt: serverTimestamp(),
      })
    );

    expect(await readTeamWithoutRules()).toEqual(before);
  });

  test("領隊單獨變更教練 UID 名單仍被拒絕", async () => {
    const before = await readTeamWithoutRules();

    await assertFails(
      updateDoc(doc(authAs(LEAD), "teams", TEAM_MAIN), {
        coachUids: [COACH, MEM],
        updatedAt: serverTimestamp(),
      })
    );

    expect(await readTeamWithoutRules()).toEqual(before);
  });
});

describe("課程備註：同屬幹部欄位白名單", () => {
  test("領隊可更新課程備註並保留其他紀錄與頂層欄位", async () => {
    const before = await readTeamWithoutRules();

    await assertSucceeds(writeMemberNote(LEAD, "memberCourseData"));

    const after = await readTeamWithoutRules();
    expectOnlyMemberNoteChanged(before, after, "memberCourseData");
  });
});
