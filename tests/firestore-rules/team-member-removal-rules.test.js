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

  // T-090k：原本鎖住「不綁定俱樂部」的現況（列為收緊候選），收緊後改成拒絕。
  test("4. T-090k：role=coach 但不是 team_main 幹部者清空 team_main 成員 → 拒", async () => {
    await assertFails(write(COACH_OUTSIDER, MEMBER_ONE, CLEARED));
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

describe("T-090k：非 admin 的 coach 以上只能增減自己當職員的那一隊", () => {
  const COACH_MAIN = "coach_main";     // users.role=coach，team_main coachUids 內
  const LEADER_MAIN = "leader_main";   // users.role=coach，team_main leaderUids 內（無個別授權）
  const MEMBER_INCONSISTENT = "member_inconsistent"; // 舊資料：teamIds 與 teamId 不一致

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "teams", TEAM_MAIN), {
        id: TEAM_MAIN, name: "Main", captainUid: CAP, leaderUids: [GRANT_LEADER, LEADER_MAIN], coachUids: [COACH_MAIN],
      });
      await setDoc(doc(db, "users", COACH_MAIN), { uid: COACH_MAIN, role: "coach", ...membership([TEAM_MAIN]) });
      await setDoc(doc(db, "users", LEADER_MAIN), { uid: LEADER_MAIN, role: "coach", ...membership([TEAM_MAIN]) });
      await setDoc(doc(db, "users", MEMBER_INCONSISTENT), {
        uid: MEMBER_INCONSISTENT, role: "user",
        teamId: TEAM_OTHER, teamName: "Other", teamIds: ["team_low"], teamNames: ["Low"],
      });
    });
  });

  describe("allow", () => {
    test("20. 隊長（coach 以上）核准：在尾端加入自己那隊", async () => {
      await assertSucceeds(write(CAP, EMPTY_USER, membership([TEAM_MAIN])));
      await assertSucceeds(write(CAP, MEMBER_LOW, membership(["team_low", TEAM_MAIN])));
    });

    test("21. coachUids 內的教練、leaderUids 內的領隊（coach 以上）可加入／移除自己那隊", async () => {
      await assertSucceeds(write(COACH_MAIN, EMPTY_USER, membership([TEAM_MAIN])));
      await assertSucceeds(write(LEADER_MAIN, MEMBER_TWO, membership([TEAM_OTHER])));
    });

    test("22. 移除第一隊時 teamId 改指向原本就有的下一隊（不算新增）", async () => {
      await assertSucceeds(write(CAP, MEMBER_TWO, membership([TEAM_OTHER])));
    });

    test("23. 舊資料 teamIds 與 teamId 不一致時，核准仍只算新增一隊", async () => {
      await assertSucceeds(write(CAP, MEMBER_INCONSISTENT, {
        teamId: "team_low", teamName: "Low",
        teamIds: ["team_low", TEAM_OTHER, TEAM_MAIN], teamNames: ["Low", "Other", "Main"],
      }));
    });

    test("24. admin 不是幹部仍可核准／移除（A 入隊審核允許 admin、資料同步清無效隊伍）", async () => {
      await assertSucceeds(write(ADMIN, EMPTY_USER, membership([TEAM_OTHER])));
      await assertSucceeds(write(ADMIN, MEMBER_LOW_TWO, membership(["team_low"])));
    });
  });

  describe("deny", () => {
    test("25. 不是該隊職員的 coach 把他人加進該隊 → 拒", async () => {
      await assertFails(write(COACH_OUTSIDER, EMPTY_USER, membership([TEAM_MAIN])));
      await assertFails(write(CAP, EMPTY_USER, membership([TEAM_OTHER])));
    });

    test("26. 職員移除他人「別隊」的條目 → 拒", async () => {
      await assertFails(write(CAP, MEMBER_TWO, membership([TEAM_MAIN])));
      await assertFails(write(COACH_MAIN, MEMBER_LOW_TWO, membership(["team_low"])));
    });

    test("27. 同一筆同時加自己那隊、移除別隊 → 拒", async () => {
      await assertFails(write(CAP, MEMBER_LOW_TWO, membership(["team_low", TEAM_MAIN])));
    });

    test("28. 一次加入兩隊（含自己那隊）→ 拒", async () => {
      await assertFails(write(CAP, EMPTY_USER, membership([TEAM_MAIN, TEAM_OTHER])));
    });

    // 被拒的原因是「多出來的隊伍鍵 team_other 不是 CAP 當職員的隊」，不是規則禁止只換 teamId（換成自己的隊見 40）。
    test("29. teamIds 不變、把 teamId 換成自己不是職員的別隊 → 拒", async () => {
      await assertFails(write(CAP, MEMBER_LOW, {
        teamId: TEAM_OTHER, teamName: "Other", teamIds: ["team_low"], teamNames: ["team_low-name"],
      }));
    });

    test("30. 只調整他人隊伍順序（沒有增減）→ 拒", async () => {
      await assertFails(write(CAP, MEMBER_TWO, membership([TEAM_OTHER, TEAM_MAIN])));
    });

    test("31. 職員加入自己那隊的同時改 role → 拒（欄位白名單不變）", async () => {
      await assertFails(write(CAP, EMPTY_USER, { ...membership([TEAM_MAIN]), role: "coach" }));
    });
  });

  // T-090k 精簡版：職員判斷改成單次 get＋.get()，逐一鎖住 isCurrentUserTeamStaff 原本涵蓋的欄位與「隊伍不存在」。
  describe("精簡版職員欄位逐一對照", () => {
    const OWNER_ONLY = "owner_only";       // team_owner_only 只有 ownerUid
    const CREATOR_ONLY = "creator_only";   // team_creator_only 只有 creatorUid
    const LEGACY_LEADER = "legacy_leader"; // team_legacy_leader 只有舊欄位 leaderUid

    beforeEach(async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await setDoc(doc(db, "teams", "team_owner_only"), { id: "team_owner_only", name: "OwnerOnly", ownerUid: OWNER_ONLY });
        await setDoc(doc(db, "teams", "team_creator_only"), { id: "team_creator_only", name: "CreatorOnly", creatorUid: CREATOR_ONLY });
        await setDoc(doc(db, "teams", "team_legacy_leader"), { id: "team_legacy_leader", name: "LegacyLeader", leaderUid: LEGACY_LEADER });
        for (const uid of [OWNER_ONLY, CREATOR_ONLY, LEGACY_LEADER]) {
          await setDoc(doc(db, "users", uid), { uid, role: "coach", ...membership([]) });
        }
        await setDoc(doc(db, "users", "member_legacy_leader"), { uid: "member_legacy_leader", role: "user", ...membership(["team_legacy_leader", TEAM_OTHER]) });
      });
    });

    test("32. 只有 ownerUid／creatorUid 的隊主（coach 以上）可把他人加入自己那隊", async () => {
      await assertSucceeds(write(OWNER_ONLY, EMPTY_USER, membership(["team_owner_only"])));
      await assertSucceeds(write(CREATOR_ONLY, MEMBER_ONE, membership([TEAM_MAIN, "team_creator_only"])));
    });

    test("33. 舊欄位 leaderUid 的領隊（coach 以上）可移除自己那隊、不能移除別隊", async () => {
      await assertFails(write(LEGACY_LEADER, "member_legacy_leader", membership(["team_legacy_leader"])));
      await assertSucceeds(write(LEGACY_LEADER, "member_legacy_leader", membership([TEAM_OTHER])));
    });

    test("34. 加入不存在的隊 → 拒", async () => {
      await assertFails(write(CAP, EMPTY_USER, membership(["team_missing"])));
    });

    test("35. 別隊的隊主不能把他人加入這隊", async () => {
      await assertFails(write(OWNER_ONLY, EMPTY_USER, membership(["team_creator_only"])));
    });
  });

  // T-090k 審查補強（Opus／Grok）：職員判斷只回布林、不產生錯誤值。
  describe("審查補強：錯誤值與髒資料", () => {
    const REPAIR_COACH = "repair_coach";   // users.role=coach，非 admin，持 admin.repair.team_join_repair 個別授權
    const NULL_LEADERS_COACH = "null_leaders_coach";
    const MEMBER_DELETED_TEAM = "member_deleted_team"; // teamId／teamIds 指向已刪除的隊

    beforeEach(async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await setDoc(doc(db, "users", REPAIR_COACH), { uid: REPAIR_COACH, role: "coach", ...membership([]) });
        await setDoc(doc(db, "userPermissionGrants", REPAIR_COACH), {
          permissions: ["admin.repair.team_join_repair"],
          enabled: true,
        });
        await setDoc(doc(db, "users", MEMBER_DELETED_TEAM), { uid: MEMBER_DELETED_TEAM, role: "user", ...membership(["team_deleted"]) });
        await setDoc(doc(db, "teams", "team_null_leaders"), {
          id: "team_null_leaders", name: "NullLeaders", leaderUids: null, coachUids: [NULL_LEADERS_COACH],
        });
        await setDoc(doc(db, "users", NULL_LEADERS_COACH), { uid: NULL_LEADERS_COACH, role: "coach", ...membership([]) });
      });
    });

    // coach 分支先評估：移除的隊不存在 → 該分支為 false（不是錯誤值），再由入隊修復分支放行。
    test("36. 持入隊修復授權的 coach（非 admin）清掉單一已刪除隊伍 → 通過", async () => {
      await assertSucceeds(write(REPAIR_COACH, MEMBER_DELETED_TEAM, CLEARED));
    });

    // 只有那一個壞元素是新增的鍵，所以拒絕原因是型別，不是「一次加兩隊」。
    test("37. 新增的隊伍鍵是數字或 map → 拒", async () => {
      await assertFails(write(CAP, EMPTY_USER, { teamId: null, teamName: null, teamIds: [42], teamNames: ["x"] }));
      await assertFails(write(CAP, EMPTY_USER, { teamId: null, teamName: null, teamIds: [{ id: TEAM_MAIN }], teamNames: ["Main"] }));
    });

    test("38. 新增的 teamId 含 '/' → 拒", async () => {
      await assertFails(write(CAP, EMPTY_USER, { teamId: `${TEAM_MAIN}/x`, teamName: "Main", teamIds: [], teamNames: [] }));
      await assertFails(write(CAP, EMPTY_USER, { teamId: `x/${TEAM_MAIN}`, teamName: "Main", teamIds: [], teamNames: [] }));
    });

    test("39. 隊伍 leaderUids 為 null、本人只在 coachUids → 可把他人加入該隊", async () => {
      await assertSucceeds(write(NULL_LEADERS_COACH, EMPTY_USER, membership(["team_null_leaders"])));
    });

    // 現況鎖定（依規則推演）：舊鍵 [team_low, team_low] → 新鍵 [team_low, team_main]，多出的只有 team_main，
    // 且 CAP 是 team_main 隊長，所以通過；結果是 teamId 指向 team_main、teamIds 仍只有 team_low（與 A 的寫法不同，屬髒資料形狀）。
    test("40. 現況：teamIds 不變、把 teamId 換成自己是職員的那隊 → 通過", async () => {
      await assertSucceeds(write(CAP, MEMBER_LOW, {
        teamId: TEAM_MAIN, teamName: "Main", teamIds: ["team_low"], teamNames: ["team_low-name"],
      }));
    });
  });

  // T-090k legacy bridge（顧問裁定 §1.9）：舊格式俱樂部文件 id（D）≠ id 欄位（L），成員存 L。
  // 對照表寫死在 firestore.rules 的 legacyTeamDocIds()，這裡從 Rules 原文讀出，測試不另抄 id。
  describe("舊格式俱樂部橋接（L→D）", () => {
    const LEGACY_MAP = (() => {
      const source = fs.readFileSync(RULES_PATH, "utf8");
      const body = /function legacyTeamDocIds\(\) \{\s*return \{([\s\S]*?)\};/.exec(source);
      if (!body) throw new Error("firestore.rules 找不到 legacyTeamDocIds()");
      return [...body[1].matchAll(/'([^']+)':\s*'([^']+)'/g)].map((m) => ({ L: m[1], D: m[2] }));
    })();
    const { L, D } = LEGACY_MAP[0];
    const LEG_CAP = "leg_cap";                   // users.role=captain，teams/D 的 captainUid
    const LEG_COACH = "leg_coach";               // users.role=coach，teams/D 的 coachUids 內
    const SHADOW_CAP = "shadow_cap";             // users.role=captain，只是 teams/L（非 D）文件的隊長
    const MEMBER_LEG = "member_leg";             // teamIds:[L]、teamId:L
    const MEMBER_LEG_EMPTY = "member_leg_empty"; // 8 人那種形狀：teamIds:[]、teamId:L

    beforeEach(async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await setDoc(doc(db, "teams", D), { id: L, name: "Legacy", captainUid: LEG_CAP, leaderUids: [], coachUids: [LEG_COACH] });
        await setDoc(doc(db, "users", LEG_CAP), { uid: LEG_CAP, role: "captain", ...membership([L]) });
        await setDoc(doc(db, "users", LEG_COACH), { uid: LEG_COACH, role: "coach", ...membership([L]) });
        await setDoc(doc(db, "users", SHADOW_CAP), { uid: SHADOW_CAP, role: "captain", ...membership([]) });
        await setDoc(doc(db, "users", MEMBER_LEG), { uid: MEMBER_LEG, role: "user", ...membership([L]) });
        await setDoc(doc(db, "users", MEMBER_LEG_EMPTY), {
          uid: MEMBER_LEG_EMPTY, role: "user", teamId: L, teamName: "Legacy", teamIds: [], teamNames: [],
        });
      });
    });

    test("41. 對照表 5 組、格式正確且不重複（名單已凍結）", () => {
      expect(LEGACY_MAP).toHaveLength(5);
      for (const { L: key, D: docId } of LEGACY_MAP) {
        expect(key).toMatch(/^tm_\d{13}_[a-z0-9]{6}$/);
        expect(docId).toMatch(/^[A-Za-z0-9]{20}$/);
      }
      expect(new Set(LEGACY_MAP.map((p) => p.L)).size).toBe(5);
      expect(new Set(LEGACY_MAP.map((p) => p.D)).size).toBe(5);
      // 查表範圍（預算用）必須正好是對照表最小～最大的 L，否則有 L 不會被查表。
      const keys = LEGACY_MAP.map((p) => p.L).sort();
      const source = fs.readFileSync(RULES_PATH, "utf8");
      expect(source).toContain(`teamKey >= '${keys[0]}' && teamKey <= '${keys[keys.length - 1]}'`);
    });

    test("42. 橋接職員（D 的隊長／教練）剔除 teamIds 含 L 的成員 → 通過", async () => {
      await assertSucceeds(write(LEG_COACH, MEMBER_LEG, CLEARED));
      await assertSucceeds(write(LEG_CAP, MEMBER_LEG, CLEARED));
    });

    test("43. 橋接職員核准他人加入 L（新增鍵 L）→ 通過", async () => {
      await assertSucceeds(write(LEG_COACH, EMPTY_USER, membership([L])));
      await assertSucceeds(write(LEG_CAP, MEMBER_LOW, membership(["team_low", L])));
    });

    test("44. 不是 D 職員的 coach 以上帶鍵 L 增減 → 拒（含只當 teams/L 文件隊長者）", async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), "teams", L), { id: L, name: "Shadow", captainUid: SHADOW_CAP });
      });
      await assertFails(write(CAP, EMPTY_USER, membership([L])));
      await assertFails(write(COACH_OUTSIDER, MEMBER_LEG, CLEARED));
      await assertFails(write(SHADOW_CAP, EMPTY_USER, membership([L])));
      await assertFails(write(SHADOW_CAP, MEMBER_LEG, CLEARED));
    });

    test("45. 假對照：teams/D 的 id 欄位 ≠ L → 橋接職員也拒；admin 不受影響", async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), "teams", D), { id: "tm_fake_mismatch", name: "Legacy", captainUid: LEG_CAP, coachUids: [LEG_COACH] });
      });
      await assertFails(write(LEG_COACH, MEMBER_LEG, CLEARED));
      await assertFails(write(LEG_CAP, EMPTY_USER, membership([L])));
      await assertSucceeds(write(ADMIN, MEMBER_LEG, CLEARED));
    });

    test("46. teamIds:[]＋teamId:L 被橋接職員剔除（寫 teamIds:[]、teamId:null）→ 通過", async () => {
      await assertSucceeds(write(LEG_COACH, MEMBER_LEG_EMPTY, CLEARED));
    });

    test("47. teamIds:[]＋teamId:L 被 X 隊職員核准（寫 teamIds:[L,X]、teamId:L）→ 通過", async () => {
      await assertSucceeds(write(CAP, MEMBER_LEG_EMPTY, {
        teamId: L, teamName: "Legacy", teamIds: [L, TEAM_MAIN], teamNames: ["Legacy", "Main"],
      }));
    });

    test("48. admin 路徑不變：不是任何隊職員也可加入／剔除 L", async () => {
      await assertSucceeds(write(ADMIN, EMPTY_USER, membership([L])));
      await assertSucceeds(write(ADMIN, MEMBER_LEG, CLEARED));
    });

    test("49. 未列在對照表的鍵原樣通過：直接用 D 當鍵仍由 D 的職員判斷", async () => {
      await assertSucceeds(write(LEG_COACH, EMPTY_USER, membership([D])));
      await assertFails(write(CAP, EMPTY_USER, membership([D])));
    });
  });
});
