"use strict";

const {
  createRemoveTeamMemberHandler,
  isCoachPlusAccess,
  isFrontendTeamMemberManager,
} = require("../../functions/team-member-removal");
const {
  FakeHttpsError,
  FieldValue,
  ROLE_LEVELS,
  buildOperationLogPayload,
  createAccess,
  createFakeFirestore,
  createLogger,
  mockCallerAccess,
  permissionDocsFor,
} = require("./team-callable-fake-db");

const TEAM = "tm_main";
const TEAM_NAME = "測試俱樂部";

function membership(teamIds, teamNames = teamIds.map(() => TEAM_NAME)) {
  return { teamId: teamIds[0] || null, teamName: teamNames[0] || null, teamIds, teamNames };
}

function seedDocs(extra = {}) {
  return {
    [`teams/${TEAM}`]: {
      id: TEAM, name: TEAM_NAME, captainUid: "U-cap", leaderUids: ["U-lead"], coachUids: ["U-coach"], members: 0,
    },
    "teams/tm_b": { id: "tm_b", name: "B 隊" },
    "teams/tm_c": { id: "tm_c", name: "C 隊" },
    "users/U-cap": { uid: "U-cap", displayName: "隊長", role: "captain", ...membership([TEAM]) },
    "users/U-lead": { uid: "U-lead", displayName: "領隊", role: "coach", ...membership([TEAM]) },
    "users/U-coach": { uid: "U-coach", displayName: "教練", role: "coach", ...membership([TEAM]) },
    "users/U-m1": { uid: "U-m1", displayName: "小明", role: "user", ...membership([TEAM]) },
    "users/U-m2": { uid: "U-m2", name: "小華", role: "user", ...membership([TEAM]) },
    ...extra,
  };
}

// access 只決定 role；權限碼由 permissionDocsFor 轉成 Rules 看得到的文件（rolePermissions／userPermissionGrants）。
// getCallerAccessContext 的 mock 讓 hasPermission 對任何權限碼回 true，驗證 Callable 沒有依賴它（P3-7）。
function setup({
  docs = seedDocs(),
  access = createAccess({ role: "captain" }),
  callerUid = "U-cap",
  logger = createLogger(),
} = {}) {
  const fake = createFakeFirestore({ ...permissionDocsFor(access, callerUid), ...docs });
  const getCallerAccessContext = jest.fn(async () => mockCallerAccess(access));
  const handler = createRemoveTeamMemberHandler({
    db: fake.db,
    HttpsError: FakeHttpsError,
    FieldValue,
    roleLevels: ROLE_LEVELS,
    getCallerAccessContext,
    buildOperationLogPayload,
    logger,
    now: () => new Date("2026-10-27T08:00:00Z"),
  });
  const call = (data, uid = callerUid) => handler({ auth: uid ? { uid } : undefined, data });
  return { fake, handler, call, logger, getCallerAccessContext };
}

async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to be rejected");
}

describe("removeTeamMember 權限判斷（純函式）", () => {
  test.each([
    ["super_admin", {}, true],
    ["admin", {}, true],
    ["venue_owner", {}, true],
    ["captain", {}, true],
    ["coach", {}, true],
    ["user", {}, false],
    ["my_custom_role", {}, false],
    ["constructor", {}, false],
  ])("isCoachPlusAccess role=%s", (role, options, expected) => {
    expect(isCoachPlusAccess(createAccess({ role, ...options }), ROLE_LEVELS)).toBe(expected);
  });

  test("isCoachPlusAccess 認入隊修復權限（對應 Rules 1712），其他權限不算", () => {
    expect(isCoachPlusAccess(createAccess({ role: "user", permissions: ["admin.repair.team_join_repair"] }), ROLE_LEVELS)).toBe(true);
    expect(isCoachPlusAccess(createAccess({ role: "user", permissions: ["team.manage_all"] }), ROLE_LEVELS)).toBe(false);
    expect(isCoachPlusAccess(null, ROLE_LEVELS)).toBe(false);
  });

  test("isFrontendTeamMemberManager 與 A _canManageTeamMembers 一致：嚴格比較、不認 creator／owner／舊 leaderUid", () => {
    const team = {
      captainUid: "U-cap", leaderUids: ["U-lead"], coachUids: ["U-coach"],
      creatorUid: "U-creator", ownerUid: "U-owner", leaderUid: "U-oldlead",
    };
    ["U-cap", "U-lead", "U-coach"].forEach((uid) => expect(isFrontendTeamMemberManager(team, uid)).toBe(true));
    ["U-creator", "U-owner", "U-oldlead", "", undefined, "U-other"].forEach((uid) => {
      expect(isFrontendTeamMemberManager(team, uid)).toBe(false);
    });
    expect(isFrontendTeamMemberManager({ captainUid: " U-cap " }, "U-cap")).toBe(false);
    expect(isFrontendTeamMemberManager({ leaderUids: [" U-lead "] }, "U-lead")).toBe(false);
    expect(isFrontendTeamMemberManager({ leaderUids: "U-lead" }, "U-lead")).toBe(false);
    expect(isFrontendTeamMemberManager(null, "U-cap")).toBe(false);
  });
});

describe("removeTeamMember 輸入與權限（失敗一律不寫任何東西）", () => {
  test("未登入 → unauthenticated", async () => {
    const { call, fake } = setup();
    expect(await rejection(call({ teamId: TEAM, memberUid: "U-m1" }, null))).toMatchObject({ code: "unauthenticated" });
    expect(fake.state.writes).toHaveLength(0);
  });

  test.each([
    [{}], [{ teamId: TEAM }], [{ memberUid: "U-m1" }], [{ teamId: "", memberUid: "U-m1" }],
    [{ teamId: TEAM, memberUid: "a/b" }], [{ teamId: "x".repeat(129), memberUid: "U-m1" }],
    [{ teamId: 123, memberUid: "U-m1" }], [null],
    [{ teamId: "__reserved__", memberUid: "U-m1" }], [{ teamId: "..", memberUid: "U-m1" }],
  ])("參數錯誤 %j → invalid-argument", async (data) => {
    const { call, fake } = setup();
    expect(await rejection(call(data))).toMatchObject({ code: "invalid-argument" });
    expect(fake.state.writes).toHaveLength(0);
  });

  test("team 不存在 → not-found TEAM_NOT_FOUND", async () => {
    const { call, fake } = setup();
    expect(await rejection(call({ teamId: "tm_nope", memberUid: "U-m1" })))
      .toMatchObject({ code: "not-found", message: "TEAM_NOT_FOUND" });
    expect(fake.state.writes).toHaveLength(0);
  });

  test("舊資料（文件 id≠id 欄位）以邏輯 id 呼叫 → TEAM_ID_MISMATCH，不誤報查無（成員歸屬以文件 id 為準）", async () => {
    const docs = seedDocs({
      "teams/doc_x": { id: "tm_logic", name: "邏輯隊", captainUid: "U-cap" },
      "users/U-x": { uid: "U-x", ...membership(["tm_logic"], ["邏輯隊"]) },
    });
    const { call, fake } = setup({ docs });
    expect(await rejection(call({ teamId: "tm_logic", memberUid: "U-x" })))
      .toMatchObject({ code: "failed-precondition", message: "TEAM_ID_MISMATCH" });
    expect(fake.state.writes).toHaveLength(0);
  });

  test("呼叫者不是該隊幹部（即使 role=admin）→ TEAM_MANAGE_DENIED", async () => {
    const { call, fake } = setup({ access: createAccess({ role: "admin" }) });
    expect(await rejection(call({ teamId: TEAM, memberUid: "U-m1" }, "U-stranger")))
      .toMatchObject({ code: "permission-denied", message: "TEAM_MANAGE_DENIED" });
    expect(fake.state.writes).toHaveLength(0);
  });

  test("super_admin 但不是該隊幹部 → TEAM_MANAGE_DENIED（前端准入不過）", async () => {
    const { call, fake } = setup({ access: createAccess({ role: "super_admin" }) });
    expect(await rejection(call({ teamId: TEAM, memberUid: "U-m1" }, "U-boss")))
      .toMatchObject({ code: "permission-denied", message: "TEAM_MANAGE_DENIED" });
    expect(fake.state.writes).toHaveLength(0);
  });

  test.each([
    ["creatorUid", { creatorUid: "U-creator" }, "U-creator"],
    ["ownerUid", { ownerUid: "U-owner" }, "U-owner"],
    ["舊 leaderUid", { leaderUid: "U-oldlead" }, "U-oldlead"],
  ])("只靠 %s 不算幹部（比 isTeamStaffForData 窄）→ TEAM_MANAGE_DENIED", async (_label, teamPatch, callerUid) => {
    const docs = seedDocs();
    docs[`teams/${TEAM}`] = { ...docs[`teams/${TEAM}`], ...teamPatch };
    const { call, fake } = setup({ docs, access: createAccess({ role: "admin" }) });
    expect(await rejection(call({ teamId: TEAM, memberUid: "U-m1" }, callerUid)))
      .toMatchObject({ code: "permission-denied", message: "TEAM_MANAGE_DENIED" });
    expect(fake.state.writes).toHaveLength(0);
  });

  test("captainUid 帶空白不 trim → TEAM_MANAGE_DENIED", async () => {
    const docs = seedDocs();
    docs[`teams/${TEAM}`] = { ...docs[`teams/${TEAM}`], captainUid: " U-cap " };
    const { call } = setup({ docs });
    expect(await rejection(call({ teamId: TEAM, memberUid: "U-m1" })))
      .toMatchObject({ code: "permission-denied", message: "TEAM_MANAGE_DENIED" });
  });

  test("幹部但 users.role=user → COACH_PLUS_REQUIRED，且完全不寫", async () => {
    const { call, fake } = setup({ access: createAccess({ role: "user" }) });
    expect(await rejection(call({ teamId: TEAM, memberUid: "U-m1" })))
      .toMatchObject({ code: "permission-denied", message: "COACH_PLUS_REQUIRED" });
    expect(fake.state.writes).toHaveLength(0);
  });

  test("幹部但為自訂角色 → COACH_PLUS_REQUIRED（已知限制）", async () => {
    const { call } = setup({ access: createAccess({ role: "my_custom_role" }) });
    expect(await rejection(call({ teamId: TEAM, memberUid: "U-m1" })))
      .toMatchObject({ code: "permission-denied", message: "COACH_PLUS_REQUIRED" });
  });

  test.each(["coach", "captain", "venue_owner", "admin", "super_admin"])("幹部且 role=%s → 通過", async (role) => {
    const { call } = setup({ access: createAccess({ role }) });
    await expect(call({ teamId: TEAM, memberUid: "U-m1" })).resolves.toMatchObject({ ok: true, alreadyRemoved: false });
  });

  test("領隊與教練（幹部且 coach 以上）也能剔除一般隊員", async () => {
    for (const uid of ["U-lead", "U-coach"]) {
      const { call } = setup({ access: createAccess({ role: "coach" }) });
      await expect(call({ teamId: TEAM, memberUid: "U-m1" }, uid)).resolves.toMatchObject({ ok: true });
    }
  });
});

describe("removeTeamMember 被剔者限制", () => {
  test.each([
    ["隊長", "U-cap"], ["領隊", "U-lead"], ["教練", "U-coach"],
  ])("被剔者是%s → TARGET_IS_STAFF", async (_label, memberUid) => {
    const { call, fake } = setup();
    expect(await rejection(call({ teamId: TEAM, memberUid })))
      .toMatchObject({ code: "failed-precondition", message: "TARGET_IS_STAFF" });
    expect(fake.state.writes).toHaveLength(0);
  });

  test("被剔者是舊欄位 leaderUid → TARGET_IS_STAFF", async () => {
    const docs = seedDocs({ "users/U-oldlead": { uid: "U-oldlead", ...membership([TEAM]) } });
    docs[`teams/${TEAM}`] = { ...docs[`teams/${TEAM}`], leaderUid: "U-oldlead" };
    const { call } = setup({ docs });
    expect(await rejection(call({ teamId: TEAM, memberUid: "U-oldlead" }))).toMatchObject({ message: "TARGET_IS_STAFF" });
  });

  test("呼叫者本人（必為幹部）被同一條擋下", async () => {
    const { call, fake } = setup();
    expect(await rejection(call({ teamId: TEAM, memberUid: "U-lead" }, "U-lead")))
      .toMatchObject({ code: "failed-precondition", message: "TARGET_IS_STAFF" });
    expect(fake.state.writes).toHaveLength(0);
  });

  test("被剔者文件 id 與 uid 不同、但文件 id 是幹部 id → TARGET_IS_STAFF（docId 也納入比對）", async () => {
    // 單一非 canonical 文件：id=U-coach、欄位 uid=U-ext；以 U-ext 當 memberUid 時 docId(U-coach) 會被納入比對
    const docs = seedDocs();
    delete docs["users/U-coach"];
    docs["users/U-coach"] = { uid: "U-ext", ...membership([TEAM]) };
    const { call, fake } = setup({ docs });
    expect(await rejection(call({ teamId: TEAM, memberUid: "U-ext" }))).toMatchObject({ message: "TARGET_IS_STAFF" });
    expect(fake.state.writes).toHaveLength(0);
  });

  test("查無此使用者 → not-found MEMBER_NOT_FOUND", async () => {
    const { call } = setup();
    expect(await rejection(call({ teamId: TEAM, memberUid: "U-ghost" })))
      .toMatchObject({ code: "not-found", message: "MEMBER_NOT_FOUND" });
  });

  test("身分模糊（兩份文件宣稱同一 uid、無 canonical）→ failed-precondition", async () => {
    const docs = seedDocs({
      "users/a1": { uid: "U-amb", ...membership([TEAM]) },
      "users/a2": { uid: "U-amb", ...membership([TEAM]) },
    });
    const { call, fake } = setup({ docs });
    expect(await rejection(call({ teamId: TEAM, memberUid: "U-amb" })))
      .toMatchObject({ code: "failed-precondition", message: "MEMBER_IDENTITY_UNAVAILABLE" });
    expect(fake.state.writes).toHaveLength(0);
  });

  test("受限帳號 → failed-precondition，不寫", async () => {
    const docs = seedDocs({ "users/U-res": { uid: "U-res", isRestricted: true, ...membership([TEAM]) } });
    const { call, fake } = setup({ docs });
    expect(await rejection(call({ teamId: TEAM, memberUid: "U-res" })))
      .toMatchObject({ code: "failed-precondition", message: "MEMBER_IDENTITY_UNAVAILABLE" });
    expect(fake.state.writes).toHaveLength(0);
  });
});

describe("removeTeamMember 冪等", () => {
  test("被剔者已不在該隊 → alreadyRemoved，不寫、不記 opLog、不重算", async () => {
    const docs = seedDocs({ "users/U-gone": { uid: "U-gone", ...membership(["tm_b"], ["B 隊"]) } });
    const { call, fake } = setup({ docs });
    await expect(call({ teamId: TEAM, memberUid: "U-gone" })).resolves.toEqual({ ok: true, alreadyRemoved: true });
    expect(fake.state.writes).toHaveLength(0);
  });

  test("已不在隊時權限仍先驗（不能當探測管道）", async () => {
    const docs = seedDocs({ "users/U-gone": { uid: "U-gone", ...membership([]) } });
    const { call } = setup({ docs, access: createAccess({ role: "user" }) });
    expect(await rejection(call({ teamId: TEAM, memberUid: "U-gone" }))).toMatchObject({ message: "COACH_PLUS_REQUIRED" });
  });

  test("連續呼叫兩次：第二次 alreadyRemoved，opLog 只有一筆", async () => {
    const { call, fake } = setup();
    await call({ teamId: TEAM, memberUid: "U-m1" });
    await expect(call({ teamId: TEAM, memberUid: "U-m1" })).resolves.toEqual({ ok: true, alreadyRemoved: true });
    expect(fake.writesTo("operationLogs/")).toHaveLength(1);
  });
});

describe("removeTeamMember 寫入內容", () => {
  test("只在這一隊 → 四欄清空，只寫被剔者與 opLog，members 另行重算", async () => {
    const { call, fake } = setup();
    const result = await call({ teamId: TEAM, memberUid: "U-m1" });
    expect(fake.get("users/U-m1")).toMatchObject({
      teamId: null, teamName: null, teamIds: [], teamNames: [], updatedAt: "SERVER_TS", displayName: "小明", role: "user",
    });
    expect(Object.keys(fake.writesTo("users/U-m1")[0].data).sort())
      .toEqual(["teamId", "teamIds", "teamName", "teamNames", "updatedAt"]);
    const paths = fake.state.writes.map((item) => item.path.replace(/op_.*/, "op_*"));
    expect(paths.sort()).toEqual(["operationLogs/op_*", `teams/${TEAM}`, "users/U-m1"].sort());
    expect(result).toEqual({ ok: true, alreadyRemoved: false, memberCount: 4 });
    expect(fake.get(`teams/${TEAM}`)).toMatchObject({ members: 4, updatedAt: "SERVER_TS" });
  });

  test("還有其他隊 → 主隊切到剩餘第 0 筆，teamNames 逐一讀 team 名稱，查不到退回 id", async () => {
    const docs = seedDocs({
      "users/U-multi": {
        uid: "U-multi", teamId: TEAM, teamName: "舊名", teamIds: [TEAM, "tm_b", "tm_gone", "tm_c"], teamNames: ["舊", "舊b", "舊gone", "舊c"],
      },
    });
    const { call, fake } = setup({ docs });
    await call({ teamId: TEAM, memberUid: "U-multi" });
    expect(fake.get("users/U-multi")).toMatchObject({
      teamId: "tm_b", teamName: "B 隊", teamIds: ["tm_b", "tm_gone", "tm_c"], teamNames: ["B 隊", "tm_gone", "C 隊"],
    });
  });

  test("teamIds 與 teamId 聯集去重；只有舊 teamId 的使用者也能剔除", async () => {
    const docs = seedDocs({
      "users/U-dup": { uid: "U-dup", teamId: "tm_b", teamIds: [TEAM, "tm_b", TEAM] },
      "users/U-leg": { uid: "U-leg", teamId: TEAM, teamName: TEAM_NAME },
    });
    const { call, fake } = setup({ docs });
    await call({ teamId: TEAM, memberUid: "U-dup" });
    await call({ teamId: TEAM, memberUid: "U-leg" });
    expect(fake.get("users/U-dup")).toMatchObject({ teamId: "tm_b", teamIds: ["tm_b"], teamNames: ["B 隊"] });
    expect(fake.get("users/U-leg")).toMatchObject({ teamId: null, teamIds: [], teamNames: [] });
  });

  test("operationLogs：欄位齊全、actorUid＝呼叫者、content 不含任何 UID", async () => {
    const { call, fake } = setup();
    await call({ teamId: TEAM, memberUid: "U-m1" });
    const log = fake.writesTo("operationLogs/")[0];
    expect(log.op).toBe("set");
    expect(log.data).toMatchObject({
      type: "team_member_remove",
      typeName: "移除隊員",
      content: `隊長 將「小明」移出「${TEAM_NAME}」`,
      operator: "隊長",
      actorUid: "U-cap",
      source: "callable",
      createdAt: "SERVER_TS",
    });
  });

  test("被剔者沒有名字 → content 用「隊員」，不出現 UID", async () => {
    const docs = seedDocs({ "users/U-noname": { uid: "U-noname", ...membership([TEAM]) } });
    const { call, fake } = setup({ docs });
    await call({ teamId: TEAM, memberUid: "U-noname" });
    const { content } = fake.writesTo("operationLogs/")[0].data;
    expect(content).toBe(`隊長 將「隊員」移出「${TEAM_NAME}」`);
    expect(content).not.toMatch(/U-/);
  });

  test("transaction 遇 ABORTED 重跑，最終只提交一次（一筆 users、一筆 opLog）", async () => {
    const { call, fake } = setup();
    fake.state.abortTransactions = 1;
    await call({ teamId: TEAM, memberUid: "U-m1" });
    expect(fake.state.transactionAttempts).toBe(2);
    expect(fake.writesTo("users/U-m1")).toHaveLength(1);
    expect(fake.writesTo("operationLogs/")).toHaveLength(1);
  });
});

describe("removeTeamMember members 重算", () => {
  test("重算失敗：四欄與 opLog 已寫，Callable 仍回 ok（memberCount: null），並記 log", async () => {
    const logger = createLogger();
    const { call, fake } = setup({ logger });
    fake.state.failWrite = ({ path }) => (path === `teams/${TEAM}` ? new Error("recount boom") : null);
    await expect(call({ teamId: TEAM, memberUid: "U-m1" })).resolves.toEqual({ ok: true, alreadyRemoved: false, memberCount: null });
    expect(fake.get("users/U-m1")).toMatchObject({ teamId: null, teamIds: [] });
    expect(fake.writesTo("operationLogs/")).toHaveLength(1);
    expect(fake.get(`teams/${TEAM}`).members).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("recount failed"),
      expect.objectContaining({ callerUid: "U-cap" }),
    );
  });

  test("members 納入課程學員並與去重鍵一致", async () => {
    const docs = seedDocs({
      [`teams/${TEAM}/students/s1`]: { id: "s1", enrollStatus: "active" },
      [`teams/${TEAM}/students/s2`]: { id: "s2", enrollStatus: "removed" },
    });
    const { call } = setup({ docs });
    // cap/lead/coach + U-m2 + s1 = 5（U-m1 已被剔除、s2 狀態不計）
    await expect(call({ teamId: TEAM, memberUid: "U-m1" })).resolves.toMatchObject({ memberCount: 5 });
  });
});

describe("removeTeamMember 審查退修（P3 與測試強化）", () => {
  test("被剔者 users 的寫入與 opLog 在同一個 transaction 提交（把 users 寫入移出 transaction 會變紅）", async () => {
    const { call, fake } = setup();
    await call({ teamId: TEAM, memberUid: "U-m1" });
    const [userWrite] = fake.writesTo("users/U-m1");
    const [logWrite] = fake.writesTo("operationLogs/");
    expect(userWrite.via).toBe("tx");
    expect(logWrite.via).toBe("tx");
    expect(userWrite.commit).toBe(logWrite.commit);
    // 提交後的 members 重算是另一次（直接）寫入
    expect(fake.writesTo(`teams/${TEAM}`)[0].via).toBe("direct");
  });

  test("持有 admin.repair.team_join_repair 的自訂角色通過（與 Rules 1712 一致），沒有該權限的自訂角色仍被拒", async () => {
    const allowed = setup({ access: createAccess({ role: "my_custom_role", permissions: ["admin.repair.team_join_repair"] }) });
    await expect(allowed.call({ teamId: TEAM, memberUid: "U-m1" })).resolves.toMatchObject({ ok: true });
    const denied = setup({ access: createAccess({ role: "my_custom_role", permissions: ["team.manage_all"] }) });
    expect(await rejection(denied.call({ teamId: TEAM, memberUid: "U-m1" }))).toMatchObject({ message: "COACH_PLUS_REQUIRED" });
  });

  test("操作者名稱對齊 A：沒有 displayName 時 operator 用角色標籤、內文用 name，再不然「職員」", async () => {
    const docs = seedDocs();
    docs["users/U-cap"] = { uid: "U-cap", role: "captain", name: "正式姓名", ...membership([TEAM]) };
    const withName = setup({ docs });
    await withName.call({ teamId: TEAM, memberUid: "U-m1" });
    expect(withName.fake.writesTo("operationLogs/")[0].data).toMatchObject({
      operator: "領隊", content: `正式姓名 將「小明」移出「${TEAM_NAME}」`,
    });

    const docs2 = seedDocs();
    docs2["users/U-cap"] = { uid: "U-cap", role: "captain", ...membership([TEAM]) };
    const bare = setup({ docs: docs2 });
    await bare.call({ teamId: TEAM, memberUid: "U-m1" });
    expect(bare.fake.writesTo("operationLogs/")[0].data.content).toBe(`職員 將「小明」移出「${TEAM_NAME}」`);
  });

  test("被剔者名稱對齊 A：name 優先於 displayName", async () => {
    const docs = seedDocs({ "users/U-both": { uid: "U-both", name: "正式姓名", displayName: "LINE 暱稱", ...membership([TEAM]) } });
    const { call, fake } = setup({ docs });
    await call({ teamId: TEAM, memberUid: "U-both" });
    expect(fake.writesTo("operationLogs/")[0].data.content).toBe(`隊長 將「正式姓名」移出「${TEAM_NAME}」`);
  });

  test("文件 id 與 id 欄位不同（owner 把自己隊的 id 改成別隊）→ TEAM_ID_MISMATCH，別隊成員不被動到", async () => {
    const docs = seedDocs({
      "teams/tm_atk": { id: "tm_victim", name: "攻擊者的隊", captainUid: "U-cap" },
      "teams/tm_victim": { id: "tm_victim", name: "受害隊", captainUid: "U-victimcap" },
      "users/U-v": { uid: "U-v", role: "user", ...membership(["tm_victim"], ["受害隊"]) },
    });
    const { call, fake } = setup({ docs });
    expect(await rejection(call({ teamId: "tm_atk", memberUid: "U-v" })))
      .toMatchObject({ code: "failed-precondition", message: "TEAM_ID_MISMATCH" });
    expect(fake.state.writes).toHaveLength(0);
  });

  test("成員歸屬以文件 id 為準：id 欄位被竄改成別的值時，即使 users.teamIds 含該值也不會被當成本隊成員處理", async () => {
    // 文件 id=tm_main、id 欄位被改成 tm_other：解析階段直接 TEAM_ID_MISMATCH，連 transaction 都不會進
    const docs = seedDocs();
    docs[`teams/${TEAM}`] = { ...docs[`teams/${TEAM}`], id: "tm_other" };
    docs["users/U-o"] = { uid: "U-o", ...membership(["tm_other"], ["B 隊"]) };
    const { call, fake } = setup({ docs });
    expect(await rejection(call({ teamId: TEAM, memberUid: "U-o" }))).toMatchObject({ message: "TEAM_ID_MISMATCH" });
    expect(fake.state.writes).toHaveLength(0);
    expect(fake.state.transactionAttempts).toBe(0);
  });
});

describe("removeTeamMember 權限碼與 Rules 一致（審查 P3-7：rolePermissions 文件不存在 ≠ 有預設權限）", () => {
  // getCallerAccessContext 的 mock 對任何權限碼都回 true（模擬真實環境「文件不存在 → 回退預設權限」）。
  const repair = "admin.repair.team_join_repair";

  test("users.role=user 且沒有任何授權文件 → 拒絕（不看 mock 的 hasPermission）", async () => {
    const { call, fake } = setup({ access: createAccess({ role: "user" }) });
    expect(await rejection(call({ teamId: TEAM, memberUid: "U-m1" }))).toMatchObject({ message: "COACH_PLUS_REQUIRED" });
    expect(fake.state.writes).toHaveLength(0);
  });

  test("自訂角色沒有 rolePermissions 文件 → 拒絕；文件存在但不含入隊修復權限 → 拒絕；文件含該權限 → 通過", async () => {
    const noDoc = setup({ access: createAccess({ role: "my_custom_role", permissions: null }) });
    expect(await rejection(noDoc.call({ teamId: TEAM, memberUid: "U-m1" }))).toMatchObject({ message: "COACH_PLUS_REQUIRED" });
    const emptyDoc = setup({ access: createAccess({ role: "my_custom_role", permissions: [] }) });
    expect(await rejection(emptyDoc.call({ teamId: TEAM, memberUid: "U-m1" }))).toMatchObject({ message: "COACH_PLUS_REQUIRED" });
    const withDoc = setup({ access: createAccess({ role: "my_custom_role", permissions: [repair] }) });
    await expect(withDoc.call({ teamId: TEAM, memberUid: "U-m1" })).resolves.toMatchObject({ ok: true });
  });

  test("文件的 permissions 不是 list → 視為沒有權限", async () => {
    const docs = seedDocs({ "rolePermissions/my_custom_role": { permissions: repair } });
    const { call } = setup({ docs, access: createAccess({ role: "my_custom_role", permissions: null }) });
    expect(await rejection(call({ teamId: TEAM, memberUid: "U-m1" }))).toMatchObject({ message: "COACH_PLUS_REQUIRED" });
  });

  test("users.role=user 靠個別授權：enabled 缺欄位或 true → 通過；enabled:false 或 permissions 不含 → 拒絕", async () => {
    const grant = (data) => seedDocs({ "userPermissionGrants/U-cap": data });
    const noEnabledField = setup({ docs: grant({ permissions: [repair] }), access: createAccess({ role: "user" }) });
    await expect(noEnabledField.call({ teamId: TEAM, memberUid: "U-m1" })).resolves.toMatchObject({ ok: true });
    const enabled = setup({ docs: grant({ permissions: [repair], enabled: true }), access: createAccess({ role: "user" }) });
    await expect(enabled.call({ teamId: TEAM, memberUid: "U-m1" })).resolves.toMatchObject({ ok: true });
    const disabled = setup({ docs: grant({ permissions: [repair], enabled: false }), access: createAccess({ role: "user" }) });
    expect(await rejection(disabled.call({ teamId: TEAM, memberUid: "U-m1" }))).toMatchObject({ message: "COACH_PLUS_REQUIRED" });
    const other = setup({ docs: grant({ permissions: ["team.review_join"], enabled: true }), access: createAccess({ role: "user" }) });
    expect(await rejection(other.call({ teamId: TEAM, memberUid: "U-m1" }))).toMatchObject({ message: "COACH_PLUS_REQUIRED" });
  });

  test("users.role=user 時 rolePermissions/user 文件一律不算（Rules hasPerm：role != 'user'）", async () => {
    const docs = seedDocs({ "rolePermissions/user": { permissions: [repair] } });
    const { call } = setup({ docs, access: createAccess({ role: "user", permissions: null }) });
    expect(await rejection(call({ teamId: TEAM, memberUid: "U-m1" }))).toMatchObject({ message: "COACH_PLUS_REQUIRED" });
  });
});

describe("removeTeamMember 非預期錯誤", () => {
  test("非 HttpsError 轉成 internal TEAM_REMOVE_MEMBER_FAILED，log 內 teamId 已遮罩", async () => {
    const logger = createLogger();
    const { call, fake } = setup({ logger });
    fake.state.failCommit = () => new Error("commit boom");
    expect(await rejection(call({ teamId: TEAM, memberUid: "U-m1" })))
      .toMatchObject({ code: "internal", message: "TEAM_REMOVE_MEMBER_FAILED" });
    const [, context] = logger.error.mock.calls[0];
    expect(context.teamId).not.toBe(TEAM);
    expect(fake.get("users/U-m1").teamIds).toEqual([TEAM]);
  });
});
