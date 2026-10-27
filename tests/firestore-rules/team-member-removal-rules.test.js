/**
 * 契約測試（T-027 7b(A)）：誰能由前端直寫「他人」users 的四個隊伍欄位（teamId／teamName／teamIds／teamNames）。
 *
 * 目的：剔除成員／刪除俱樂部改走 Admin SDK Callable 後，證明 Rules 的前端直寫路徑「沒有因此放寬」，
 * 並補上研究報告 3.5 指出的覆蓋缺口（原本只有 coach+ 的正向案例，沒有 deny；也沒有「清空他人」這個真實形狀）。
 *
 * 只描述現況，不改 firestore.rules。若任何案例跑出與預期相反的結果：停止、回報，不得因此改 Rules。
 * 對應分支（firestore.rules users allow update）：1710 本人退隊、1711 super_admin、1712 入隊修復權限、
 * 1713 isCoachPlus() && !isOwner && isSafeTeamMembershipUpdateByStaff()、1714 team.review_join 個別授權（只准 append 一隊）。
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

const PROJECT_ID = "demo-t027-member-removal-rules";
const RULES_PATH = path.resolve(__dirname, "..", "..", "firestore.rules");
const [EMULATOR_HOST, EMULATOR_PORT] = (
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080"
).split(":");

jest.setTimeout(20000);

let testEnv;

const TEAM_MAIN = "team_main";
const TEAM_OTHER = "team_other";

const CAP = "cap_role_captain";            // team_main 隊長，users.role=captain（coach 以上）
const COACH_OUTSIDER = "coach_outsider";   // users.role=coach，但不是 team_main 任何幹部
const ADMIN = "admin_user";
const SUPER = "super_user";
const LOW_CAP = "low_cap";                 // team_low 隊長，但 users.role=user
const LOW_LEADER = "low_leader";           // team_low 領隊，users.role=user
const LOW_COACH = "low_coach";             // team_low 教練，users.role=user
const GRANT_LEADER = "grant_leader";       // team_main 領隊，users.role=user，持 team.review_join 個別授權
const STRANGER = "stranger_user";          // 一般 user，不是任何隊的幹部

const MEMBER_ONE = "member_one";           // 只在 team_main
const MEMBER_TWO = "member_two";           // team_main ＋ team_other
const MEMBER_LEGACY = "member_legacy";     // 只有舊欄位 teamId
const MEMBER_LOW = "member_low";           // 只在 team_low
const MEMBER_LOW_TWO = "member_low_two";   // team_low ＋ team_other
const EMPTY_USER = "empty_user";           // 沒有任何隊伍

const CLEARED = { teamId: null, teamName: null, teamIds: [], teamNames: [] };

function authAs(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}

function membership(teamIds) {
  return teamIds.length === 0
    ? { ...CLEARED }
    : { teamId: teamIds[0], teamName: `${teamIds[0]}-name`, teamIds, teamNames: teamIds.map((id) => `${id}-name`) };
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
      id: TEAM_MAIN, name: "Main", captainUid: CAP, leaderUids: [GRANT_LEADER], coachUids: [],
    });
    await setDoc(doc(db, "teams", TEAM_OTHER), {
      id: TEAM_OTHER, name: "Other", captainUid: "other_cap", leaderUids: [], coachUids: [],
    });
    await setDoc(doc(db, "teams", "team_low"), {
      id: "team_low", name: "Low", captainUid: LOW_CAP, leaderUids: [LOW_LEADER], coachUids: [LOW_COACH],
    });

    const users = {
      [CAP]: { role: "captain", ...membership([TEAM_MAIN]) },
      [COACH_OUTSIDER]: { role: "coach", ...membership([]) },
      [ADMIN]: { role: "admin", ...membership([]) },
      [SUPER]: { role: "super_admin", ...membership([]) },
      [LOW_CAP]: { role: "user", ...membership(["team_low"]) },
      [LOW_LEADER]: { role: "user", ...membership(["team_low"]) },
      [LOW_COACH]: { role: "user", ...membership(["team_low"]) },
      [GRANT_LEADER]: { role: "user", ...membership([TEAM_MAIN]) },
      [STRANGER]: { role: "user", ...membership([]) },
      [MEMBER_ONE]: { role: "user", ...membership([TEAM_MAIN]) },
      [MEMBER_TWO]: { role: "user", ...membership([TEAM_MAIN, TEAM_OTHER]) },
      [MEMBER_LEGACY]: { role: "user", teamId: TEAM_MAIN, teamName: "Main" },
      [MEMBER_LOW]: { role: "user", ...membership(["team_low"]) },
      [MEMBER_LOW_TWO]: { role: "user", ...membership(["team_low", TEAM_OTHER]) },
      [EMPTY_USER]: { role: "user", ...membership([]) },
    };
    for (const [uid, data] of Object.entries(users)) {
      await setDoc(doc(db, "users", uid), { uid, ...data });
    }
    await setDoc(doc(db, "userPermissionGrants", GRANT_LEADER), {
      permissions: ["team.review_join"],
      enabled: true,
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

const write = (actor, target, data) =>
  updateDoc(doc(authAs(actor), "users", target), { ...data, updatedAt: serverTimestamp() });

describe("allow（鎖住現況）：Callable 上線後前端直寫路徑維持原樣", () => {
  test("1. coach 以上的隊內幹部清空他人四欄（removeTeamMember／刪隊清 users 的真實形狀）", async () => {
    await assertSucceeds(write(CAP, MEMBER_ONE, CLEARED));
  });

  test("2. coach 以上縮減他人隊伍（剔除其中一隊、保留另一隊）", async () => {
    await assertSucceeds(write(CAP, MEMBER_TWO, membership([TEAM_OTHER])));
  });

  test("3. coach 以上清空只有舊欄位 teamId 的他人", async () => {
    await assertSucceeds(write(CAP, MEMBER_LEGACY, CLEARED));
  });

  test("4. 1713 不綁定俱樂部：role=coach 但不是 team_main 幹部者也能清空 team_main 成員（現況，列為收緊候選）", async () => {
    await assertSucceeds(write(COACH_OUTSIDER, MEMBER_ONE, CLEARED));
  });

  test("5. admin（1713）與 super_admin（1711）清空他人", async () => {
    await assertSucceeds(write(ADMIN, MEMBER_ONE, CLEARED));
    await assertSucceeds(write(SUPER, MEMBER_TWO, CLEARED));
  });

  test("6. 本人退隊（1710）：清空、剩一隊", async () => {
    await assertSucceeds(write(MEMBER_ONE, MEMBER_ONE, CLEARED));
    await assertSucceeds(write(MEMBER_TWO, MEMBER_TWO, membership([TEAM_OTHER])));
  });

  test("7. 持 team.review_join 個別授權者附加恰好一隊（1714），新增的隊自己是幹部", async () => {
    await assertSucceeds(write(GRANT_LEADER, EMPTY_USER, membership([TEAM_MAIN])));
  });
});

describe("deny（新增）：users.role 低於 coach 的隊內幹部不能直寫他人隊伍欄位", () => {
  test.each([
    ["隊長", LOW_CAP], ["領隊", LOW_LEADER], ["教練", LOW_COACH],
  ])("8. users.role=user 的%s清空自己隊上成員 → 拒（所以 Callable 的 coach 以上條件沒有放寬）", async (_label, actor) => {
    await assertFails(write(actor, MEMBER_LOW, CLEARED));
  });

  test("9. users.role=user 的隊內幹部縮減他人隊伍（剔掉自己隊、保留別隊）→ 拒", async () => {
    await assertFails(write(LOW_CAP, MEMBER_LOW_TWO, membership([TEAM_OTHER])));
  });

  test("10. 一般 user（非幹部）清空他人 → 拒", async () => {
    await assertFails(write(STRANGER, MEMBER_ONE, CLEARED));
  });

  test("11. 持 team.review_join 授權者「清空」他人 → 拒（1714 只准 append 一隊）", async () => {
    await assertFails(write(GRANT_LEADER, MEMBER_ONE, CLEARED));
  });

  test("12. 持授權者一次 append 兩隊 → 拒", async () => {
    await assertFails(write(GRANT_LEADER, EMPTY_USER, membership([TEAM_MAIN, TEAM_OTHER])));
  });
});

describe("deny（新增）：coach 以上也只能動四個隊伍欄位＋updatedAt，且型別／時間受限", () => {
  test("13. coach 以上清空他人的同時改 role → 拒", async () => {
    await assertFails(write(CAP, MEMBER_ONE, { ...CLEARED, role: "admin" }));
  });

  test("14. coach 以上清空他人的同時改 displayName → 拒", async () => {
    await assertFails(write(CAP, MEMBER_ONE, { ...CLEARED, displayName: "被改的名字" }));
  });

  test("15. updatedAt 不是 request.time（寫歷史時間）→ 拒", async () => {
    await assertFails(updateDoc(doc(authAs(CAP), "users", MEMBER_ONE), { ...CLEARED, updatedAt: new Date("2020-01-01T00:00:00Z") }));
  });

  test("16. teamIds 不是 list → 拒", async () => {
    await assertFails(write(CAP, MEMBER_ONE, { ...CLEARED, teamIds: TEAM_MAIN }));
  });

  test("17. teamNames 不是 list → 拒", async () => {
    await assertFails(write(CAP, MEMBER_ONE, { ...CLEARED, teamNames: "Main" }));
  });

  test("18. teamId 不是 string／null → 拒", async () => {
    await assertFails(write(CAP, MEMBER_ONE, { ...CLEARED, teamId: 123 }));
  });

  test("19. teamName 不是 string／null → 拒", async () => {
    await assertFails(write(CAP, MEMBER_ONE, { ...CLEARED, teamName: ["Main"] }));
  });
});
