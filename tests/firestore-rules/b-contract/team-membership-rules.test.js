/**
 * 契約測試：俱樂部成員資格寫入。
 *
 * ⚠️  本檔 payloads 與 FC-B `src/features/clubs/data/__fixtures__/membership-golden.json` 同步；
 *     任一邊改動時務必同步另一邊。
 *
 * 驗證範圍（Rules emulator）：
 *   - 自己退出 (`isTeamFieldShrinkOrClear`)：剩一隊、全清空、legacy 只有 teamId。
 *   - coach+ 幹部核准 (`isCoachPlus() && isSafeTeamMembershipUpdateByStaff`)。
 *   - 持 `team.review_join` 授權的 team_leader 核准 (`isSafeGrantedTeamReviewJoinUpdate`)。
 *   - 拒絕：混寫其他欄位、teamIds 沒變少、teamId ≠ teamIds[0]、
 *           一般 user 改他人、grant append 兩隊、grant 改前綴順序、
 *           grant append 非幹部隊伍、updatedAt 不是 serverTimestamp。
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

const PROJECT_ID = "demo-b-contract-membership";
const RULES_PATH = path.resolve(__dirname, "..", "..", "..", "firestore.rules");
const [EMULATOR_HOST, EMULATOR_PORT] = (
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080"
).split(":");

jest.setTimeout(20000);

let testEnv;

// ── 固定識別碼 ────────────────────────────────────
const TEAM_MAIN = "team_main";
const TEAM_OTHER = "team_other";
const TEAM_EXTRA = "team_extra";

const CAP_UID = "cap_uid_001";            // captain of TEAM_MAIN
const LEADER_UID = "leader_uid_001";      // team_leader (granted)
const COACH_UID = "coach_uid_001";        // coach of TEAM_MAIN
const OTHER_CAP_UID = "other_cap_uid_001";// captain of TEAM_OTHER

const USER_A = "user_a_uid";              // has TEAM_OTHER
const USER_B = "user_b_uid";              // empty membership (grant target)
const LEAVER_1 = "leaver_1_uid";          // two teams
const LEAVER_2 = "leaver_2_uid";          // one team
const LEAVER_LEGACY = "leaver_legacy_uid";// only teamId

function authAs(uid) {
  return testEnv.authenticatedContext(uid).firestore();
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
      name: "Main Team",
      captainUid: CAP_UID,
      leaderUids: [LEADER_UID],
      coachUids: [COACH_UID],
      members: 0,
    });
    await setDoc(doc(db, "teams", TEAM_OTHER), {
      id: TEAM_OTHER,
      name: "Other Team",
      captainUid: OTHER_CAP_UID,
      leaderUids: [],
      coachUids: [],
      members: 0,
    });
    await setDoc(doc(db, "teams", TEAM_EXTRA), {
      id: TEAM_EXTRA,
      name: "Extra Team",
      captainUid: "someone_else_uid",
      leaderUids: [],
      coachUids: [],
      members: 0,
    });

    await setDoc(doc(db, "users", CAP_UID), {
      uid: CAP_UID,
      role: "captain",
      teamId: TEAM_MAIN,
      teamName: "Main Team",
      teamIds: [TEAM_MAIN],
      teamNames: ["Main Team"],
    });
    await setDoc(doc(db, "users", LEADER_UID), {
      uid: LEADER_UID,
      role: "team_leader",
      teamId: TEAM_MAIN,
      teamName: "Main Team",
      teamIds: [TEAM_MAIN],
      teamNames: ["Main Team"],
    });
    await setDoc(doc(db, "users", COACH_UID), {
      uid: COACH_UID,
      role: "coach",
      teamId: TEAM_MAIN,
      teamName: "Main Team",
      teamIds: [TEAM_MAIN],
      teamNames: ["Main Team"],
    });
    await setDoc(doc(db, "users", OTHER_CAP_UID), {
      uid: OTHER_CAP_UID,
      role: "captain",
      teamId: TEAM_OTHER,
      teamName: "Other Team",
      teamIds: [TEAM_OTHER],
      teamNames: ["Other Team"],
    });

    await setDoc(doc(db, "users", USER_A), {
      uid: USER_A,
      role: "user",
      teamId: TEAM_OTHER,
      teamName: "Other Team",
      teamIds: [TEAM_OTHER],
      teamNames: ["Other Team"],
    });
    await setDoc(doc(db, "users", USER_B), {
      uid: USER_B,
      role: "user",
      teamId: null,
      teamName: null,
      teamIds: [],
      teamNames: [],
    });

    await setDoc(doc(db, "users", LEAVER_1), {
      uid: LEAVER_1,
      role: "user",
      teamId: TEAM_MAIN,
      teamName: "Main Team",
      teamIds: [TEAM_MAIN, TEAM_OTHER],
      teamNames: ["Main Team", "Other Team"],
    });
    await setDoc(doc(db, "users", LEAVER_2), {
      uid: LEAVER_2,
      role: "user",
      teamId: TEAM_MAIN,
      teamName: "Main Team",
      teamIds: [TEAM_MAIN],
      teamNames: ["Main Team"],
    });
    await setDoc(doc(db, "users", LEAVER_LEGACY), {
      uid: LEAVER_LEGACY,
      role: "user",
      teamId: TEAM_MAIN,
      teamName: "Main Team",
    });

    // leader 個別授權
    await setDoc(doc(db, "userPermissionGrants", LEADER_UID), {
      permissions: ["team.review_join"],
      enabled: true,
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

/* ──────────────────────────────────────────────────
 * ALLOW：自己退出
 * ────────────────────────────────────────────────── */

describe("allow: 自己退出 (isTeamFieldShrinkOrClear)", () => {
  test("1. 剩一隊 → 收斂至 teamIds[0]", async () => {
    await assertSucceeds(
      updateDoc(doc(authAs(LEAVER_1), "users", LEAVER_1), {
        teamId: TEAM_OTHER,
        teamName: "Other Team",
        teamIds: [TEAM_OTHER],
        teamNames: ["Other Team"],
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("2. 全清空", async () => {
    await assertSucceeds(
      updateDoc(doc(authAs(LEAVER_2), "users", LEAVER_2), {
        teamId: null,
        teamName: null,
        teamIds: [],
        teamNames: [],
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("3. legacy 只有 teamId → 清空", async () => {
    await assertSucceeds(
      updateDoc(doc(authAs(LEAVER_LEGACY), "users", LEAVER_LEGACY), {
        teamId: null,
        teamName: null,
        teamIds: [],
        teamNames: [],
        updatedAt: serverTimestamp(),
      })
    );
  });
});

/* ──────────────────────────────────────────────────
 * ALLOW：coach+ / 個別授權
 * ────────────────────────────────────────────────── */

describe("allow: 幹部核准", () => {
  test("4. coach+ 核准（append 一隊）", async () => {
    // USER_A 已有 TEAM_OTHER，核准加入 TEAM_MAIN
    await assertSucceeds(
      updateDoc(doc(authAs(COACH_UID), "users", USER_A), {
        teamId: TEAM_OTHER,
        teamName: "Other Team",
        teamIds: [TEAM_OTHER, TEAM_MAIN],
        teamNames: ["Other Team", "Main Team"],
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("5. 持 grant 的 team_leader 核准（append 恰好一隊、前綴不變）", async () => {
    // USER_B 為空，核准加入 TEAM_MAIN
    await assertSucceeds(
      updateDoc(doc(authAs(LEADER_UID), "users", USER_B), {
        teamId: TEAM_MAIN,
        teamName: "Main Team",
        teamIds: [TEAM_MAIN],
        teamNames: ["Main Team"],
        updatedAt: serverTimestamp(),
      })
    );
  });
});

/* ──────────────────────────────────────────────────
 * DENY
 * ────────────────────────────────────────────────── */

describe("deny: 自己退出相關", () => {
  test("6. 退出時順便改 role", async () => {
    await assertFails(
      updateDoc(doc(authAs(LEAVER_2), "users", LEAVER_2), {
        teamId: null,
        teamName: null,
        teamIds: [],
        teamNames: [],
        role: "admin",
        updatedAt: serverTimestamp(),
      })
    );
  });

  // 值與種子相同時只有 updatedAt 變動，會被 isSafeSelfProfileUpdate 合法放行，不是本案；
  // 這裡測本人自行把新隊伍加進 teamIds（不得繞過幹部核准）。
  test("7. teamIds 沒有變少（本人自行加入新隊）", async () => {
    await assertFails(
      updateDoc(doc(authAs(LEAVER_1), "users", LEAVER_1), {
        teamId: TEAM_MAIN,
        teamName: "Main Team",
        teamIds: [TEAM_MAIN, TEAM_OTHER, TEAM_EXTRA],
        teamNames: ["Main Team", "Other Team", "Extra Team"],
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("8. teamId ≠ teamIds[0]", async () => {
    await assertFails(
      updateDoc(doc(authAs(LEAVER_1), "users", LEAVER_1), {
        teamId: TEAM_OTHER,
        teamName: "Other Team",
        teamIds: [TEAM_MAIN],
        teamNames: ["Main Team"],
        updatedAt: serverTimestamp(),
      })
    );
  });
});

describe("deny: 修改他人 teamIds", () => {
  test("9. 一般 user 改他人", async () => {
    await assertFails(
      updateDoc(doc(authAs(USER_A), "users", USER_B), {
        teamId: TEAM_MAIN,
        teamName: "Main Team",
        teamIds: [TEAM_MAIN],
        teamNames: ["Main Team"],
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("10. 持 grant 但一次 append 兩隊", async () => {
    await assertFails(
      updateDoc(doc(authAs(LEADER_UID), "users", USER_B), {
        teamId: TEAM_MAIN,
        teamName: "Main Team",
        teamIds: [TEAM_MAIN, TEAM_EXTRA],
        teamNames: ["Main Team", "Extra Team"],
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("11. 持 grant 但改動前綴順序", async () => {
    // USER_A 已有 [TEAM_OTHER]，改為 [TEAM_MAIN, TEAM_OTHER] → 前綴被改
    await assertFails(
      updateDoc(doc(authAs(LEADER_UID), "users", USER_A), {
        teamId: TEAM_MAIN,
        teamName: "Main Team",
        teamIds: [TEAM_MAIN, TEAM_OTHER],
        teamNames: ["Main Team", "Other Team"],
        updatedAt: serverTimestamp(),
      })
    );
  });

  test("12. 持 grant 但 append 的隊伍自己不是幹部", async () => {
    // LEADER_UID 只屬於 TEAM_MAIN；APPEND TEAM_EXTRA（LEADER_UID 不在 EXTRA 幹部）→ 拒
    await assertFails(
      updateDoc(doc(authAs(LEADER_UID), "users", USER_B), {
        teamId: TEAM_EXTRA,
        teamName: "Extra Team",
        teamIds: [TEAM_EXTRA],
        teamNames: ["Extra Team"],
        updatedAt: serverTimestamp(),
      })
    );
  });
});

describe("deny: updatedAt 不是 serverTimestamp", () => {
  test("13. updatedAt 寫歷史時間 → 拒", async () => {
    await assertFails(
      updateDoc(doc(authAs(LEAVER_2), "users", LEAVER_2), {
        teamId: null,
        teamName: null,
        teamIds: [],
        teamNames: [],
        updatedAt: new Date("2020-01-01T00:00:00Z"),
      })
    );
  });
});

/* ──────────────────────────────────────────────────
 * 審核者收件匣：本人只能改 read／readAt。
 * B 因此不直寫 actionStatus，改由 syncGroupActionStatus（Admin SDK）更新同 groupId 的訊息。
 * ────────────────────────────────────────────────── */
describe("inbox：審核者不得直寫 actionStatus", () => {
  const MSG_ID = "msg_join_req_001";

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", CAP_UID, "inbox", MSG_ID), {
        id: MSG_ID,
        actionType: "team_join_request",
        actionStatus: "pending",
        unread: true,
        meta: { teamId: TEAM_MAIN, groupId: "tjr_test_001" },
      });
    });
  });

  test("14. 隊長改自己訊息的 actionStatus → 拒", async () => {
    await assertFails(
      updateDoc(doc(authAs(CAP_UID), "users", CAP_UID, "inbox", MSG_ID), {
        actionStatus: "approved",
        reviewerName: "隊長",
      })
    );
  });

  test("15. 隊長標記已讀（read／readAt）→ 允許", async () => {
    await assertSucceeds(
      updateDoc(doc(authAs(CAP_UID), "users", CAP_UID, "inbox", MSG_ID), {
        read: true,
        readAt: serverTimestamp(),
      })
    );
  });
});
