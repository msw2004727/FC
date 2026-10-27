"use strict";

const { createDeleteTeamHandler, isFrontendTeamDeleter } = require("../../functions/team-deletion");
const {
  FakeFirestoreError,
  FakeHttpsError,
  FieldPath,
  FieldValue,
  ROLE_LEVELS,
  buildOperationLogPayload,
  createAccess,
  createFakeFirestore,
  createLogger,
  mockCallerAccess,
  normalizeRole,
  permissionDocsFor,
} = require("./team-callable-fake-db");

const TEAM = "tm_del";
const TEAM_PATH = `teams/${TEAM}`;
const DEFAULT_TEMPLATES = [{
  key: "role_upgrade",
  title: "身份變更通知",
  body: "恭喜 {userName}！您的身份已變更為「{roleName}」。",
}];
const INBOX_ID = `msg_teamdel_${TEAM}`;
const STAFF = ["U-cap", "U-lead", "U-coach"];

function inTeam(extra = {}) {
  return { teamId: TEAM, teamName: "待刪俱樂部", teamIds: [TEAM], teamNames: ["待刪俱樂部"], ...extra };
}

function seedDocs(extra = {}) {
  return {
    [TEAM_PATH]: {
      id: TEAM, name: "待刪俱樂部", captainUid: "U-cap", leaderUids: ["U-lead"], coachUids: ["U-coach"],
      creatorUid: "U-creator", ownerUid: "U-owner",
    },
    "teams/tm_other": { id: "tm_other", name: "別隊", captainUid: "U-othercap" },
    "users/U-cap": { uid: "U-cap", displayName: "隊長", role: "captain", ...inTeam() },
    "users/U-lead": { uid: "U-lead", displayName: "領隊", role: "coach", ...inTeam() },
    "users/U-coach": { uid: "U-coach", displayName: "教練", role: "coach", ...inTeam() },
    "users/U-m1": { uid: "U-m1", displayName: "小明", role: "user", ...inTeam() },
    "users/U-m2": { uid: "U-m2", role: "user", teamId: TEAM, teamName: "待刪俱樂部" },
    "users/U-stranger": { uid: "U-stranger", role: "user", teamId: "tm_other", teamIds: ["tm_other"], teamNames: ["別隊"] },
    ...extra,
  };
}

// 預設呼叫者帶 team.manage_all，所以刪隊會降級所有幹部（不帶任何權限時只會降級呼叫者本人，見 P2-3 測試）。
const MANAGER_ACCESS = createAccess({ role: "captain", permissions: ["team.manage_all"] });

// access 只決定 role；權限碼由 permissionDocsFor 轉成 Rules 看得到的文件（rolePermissions／userPermissionGrants）。
// getCallerAccessContext 的 mock 讓 hasPermission 對任何權限碼回 true（模擬真實環境「文件不存在 → 回退預設權限」），
// 驗證 Callable 沒有依賴它（審查 P3-7）。
function setup({
  docs = seedDocs(),
  access = MANAGER_ACCESS,
  callerUid = "U-cap",
  // true：getCallerAccessContext 像真實環境一樣從 fake 的 users 文件讀 role（P1-1 重試情境必須如此）；
  // 此時 captain／coach 的 rolePermissions 文件都帶 accessPermissions。
  accessFromDocs = false,
  accessPermissions = [],
  logger = createLogger(),
  templates = DEFAULT_TEMPLATES,
  ensureAuthUser = jest.fn(async () => null),
  setRoleClaimMerged = jest.fn(async () => null),
} = {}) {
  const permissionDocs = accessFromDocs
    ? { "rolePermissions/captain": { permissions: accessPermissions }, "rolePermissions/coach": { permissions: accessPermissions } }
    : permissionDocsFor(access, callerUid);
  const fake = createFakeFirestore({ ...permissionDocs, ...docs });
  const getCallerAccessContext = jest.fn(async (request) => {
    if (!accessFromDocs) return mockCallerAccess(access);
    return mockCallerAccess(createAccess({ role: fake.get(`users/${request.auth.uid}`)?.role || "user" }));
  });
  const handler = createDeleteTeamHandler({
    db: fake.db,
    HttpsError: FakeHttpsError,
    FieldValue,
    FieldPath,
    roleLevels: ROLE_LEVELS,
    normalizeRole,
    getCallerAccessContext,
    ensureAuthUser,
    setRoleClaimMerged,
    buildOperationLogPayload,
    defaultNotificationTemplates: templates,
    logger,
    now: () => new Date("2026-10-27T08:00:00Z"),
  });
  const call = (data = { teamId: TEAM }, uid = callerUid) => handler({ auth: uid ? { uid } : undefined, data });
  return { fake, call, logger, ensureAuthUser, setRoleClaimMerged, getCallerAccessContext };
}

async function rejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to be rejected");
}

// 把幹部的隊伍欄位拿掉，讓 Phase 1 的批次只剩一般成員（方便數批次）。
function withoutStaffMembership(docs) {
  STAFF.forEach((uid) => {
    docs[`users/${uid}`] = { ...docs[`users/${uid}`], teamId: null, teamName: null, teamIds: [], teamNames: [] };
  });
  return docs;
}

function manyMembers(count) {
  const docs = withoutStaffMembership(seedDocs());
  delete docs["users/U-m1"];
  delete docs["users/U-m2"];
  for (let i = 0; i < count; i += 1) {
    const id = `U-bulk-${String(i).padStart(4, "0")}`;
    docs[`users/${id}`] = i % 2 === 0
      ? { uid: id, role: "user", ...inTeam() }
      : { uid: id, role: "user", teamId: TEAM, teamName: "待刪俱樂部" };
  }
  return docs;
}

const roleLogOf = (fake, namePrefix) => fake.writesTo("operationLogs/").map((item) => item.data)
  .find((data) => data.type === "role" && data.content.startsWith(namePrefix));

describe("isFrontendTeamDeleter（A _canEditTeamByRoleOrCaptain）", () => {
  const team = { captainUid: "U-cap", creatorUid: "U-creator", ownerUid: "U-owner", leaderUids: ["U-lead"], coachUids: ["U-coach"] };
  test.each([
    ["U-cap", createAccess({ role: "user" }), true],
    ["U-creator", createAccess({ role: "user" }), true],
    ["U-owner", createAccess({ role: "user" }), true],
    ["U-lead", createAccess({ role: "coach" }), false],
    ["U-coach", createAccess({ role: "coach" }), false],
    ["U-stranger", createAccess({ role: "admin" }), false],
    ["U-stranger", createAccess({ role: "user", permissions: ["team.manage_all"] }), true],
    ["U-stranger", createAccess({ role: "super_admin" }), true],
    ["", createAccess({ role: "admin" }), false],
  ])("uid=%s → %s", (uid, access, expected) => {
    expect(isFrontendTeamDeleter(team, uid, access)).toBe(expected);
  });
  test("沒有 team 一律 false", () => {
    expect(isFrontendTeamDeleter(null, "U-cap", createAccess({ role: "super_admin" }))).toBe(false);
  });
  test("owner 欄位比對對齊 Rules isResourceOwnerByField：必須是字串且完全相等（不 trim、不字串化、陣列不算）", () => {
    const user = createAccess({ role: "user" });
    ["captainUid", "creatorUid", "ownerUid"].forEach((field) => {
      expect(isFrontendTeamDeleter({ [field]: "U-x" }, "U-x", user)).toBe(true);
      expect(isFrontendTeamDeleter({ [field]: " U-x " }, "U-x", user)).toBe(false);
      expect(isFrontendTeamDeleter({ [field]: "U-x " }, "U-x", user)).toBe(false);
      expect(isFrontendTeamDeleter({ [field]: ["U-x"] }, "U-x", user)).toBe(false);
      expect(isFrontendTeamDeleter({ [field]: 123 }, "123", user)).toBe(false);
      expect(isFrontendTeamDeleter({ [field]: { uid: "U-x" } }, "U-x", user)).toBe(false);
    });
  });
});

describe("deleteTeam 輸入與查無 team", () => {
  test("未登入 → unauthenticated", async () => {
    const { call, fake } = setup();
    expect(await rejection(call({ teamId: TEAM }, null))).toMatchObject({ code: "unauthenticated" });
    expect(fake.state.writes).toHaveLength(0);
  });

  test.each([
    [{}], [{ teamId: "" }], [{ teamId: "a/b" }], [{ teamId: "x".repeat(129) }], [{ teamId: 5 }], [null],
    [{ teamId: "__reserved__" }], [{ teamId: "." }],
  ])(
    "參數錯誤 %j → invalid-argument",
    async (data) => {
      const { call, fake } = setup();
      expect(await rejection(call(data))).toMatchObject({ code: "invalid-argument" });
      expect(fake.state.writes).toHaveLength(0);
    },
  );

  test("查無 team → alreadyDeleted:true，不寫，並記下呼叫者與遮罩後的 teamId", async () => {
    const logger = createLogger();
    const { call, fake } = setup({ logger });
    await expect(call({ teamId: "tm_missing_team" })).resolves.toEqual({ ok: true, alreadyDeleted: true });
    expect(fake.state.writes).toHaveLength(0);
    const [message, context] = logger.warn.mock.calls[0];
    expect(message).toContain("already deleted");
    expect(context).toEqual({ callerUid: "U-cap", teamId: expect.any(String) });
    expect(context.teamId).not.toBe("tm_missing_team");
  });

  test("刪完後再呼叫一次 → alreadyDeleted:true", async () => {
    const { call } = setup();
    await call();
    await expect(call()).resolves.toEqual({ ok: true, alreadyDeleted: true });
  });
});

describe("deleteTeam 邏輯 id 加固（審查 P3-1）", () => {
  test("文件 id 與 id 欄位不同（owner 把自己隊的 id 改成別隊）→ TEAM_ID_MISMATCH，別隊成員不被動到", async () => {
    const docs = seedDocs({
      "teams/tm_atk": { id: "tm_victim", name: "攻擊者的隊", captainUid: "U-cap" },
      "teams/tm_victim": { id: "tm_victim", name: "受害隊", captainUid: "U-victimcap" },
      "users/U-v": { uid: "U-v", role: "user", teamId: "tm_victim", teamIds: ["tm_victim"], teamNames: ["受害隊"] },
    });
    const { call, fake } = setup({ docs });
    expect(await rejection(call({ teamId: "tm_atk" }))).toMatchObject({ code: "failed-precondition", message: "TEAM_ID_MISMATCH" });
    expect(fake.state.writes).toHaveLength(0);
    expect(fake.get("users/U-v").teamIds).toEqual(["tm_victim"]);
  });

  test("舊資料（文件 id≠id 欄位）以邏輯 id 呼叫 → TEAM_ID_MISMATCH，不誤報 alreadyDeleted（成員歸屬以文件 id 為準）", async () => {
    const docs = {
      "teams/doc_x": { id: "tm_logic", name: "舊制隊", captainUid: "U-cap" },
      "users/U-cap": { uid: "U-cap", displayName: "隊長", role: "captain", teamId: "tm_logic", teamIds: ["tm_logic"], teamNames: ["舊制隊"] },
    };
    const { call, fake } = setup({ docs });
    expect(await rejection(call({ teamId: "tm_logic" }))).toMatchObject({ code: "failed-precondition", message: "TEAM_ID_MISMATCH" });
    expect(fake.state.writes).toHaveLength(0);
    expect(fake.has("teams/doc_x")).toBe(true);
  });

  test("成員歸屬看文件 id：users 引用被竄改後的 id 欄位值時不會被當成本隊成員（id 欄位被改 → 直接拒絕）", async () => {
    const docs = seedDocs();
    docs[TEAM_PATH] = { ...docs[TEAM_PATH], id: "tm_other" };
    const { call, fake } = setup({ docs });
    expect(await rejection(call())).toMatchObject({ message: "TEAM_ID_MISMATCH" });
    expect(fake.get("users/U-stranger").teamIds).toEqual(["tm_other"]);
    expect(fake.state.writes).toHaveLength(0);
  });

  test("id 欄位與文件 id 相同、或根本沒有 id 欄位 → 正常處理", async () => {
    const docs = seedDocs();
    delete docs[TEAM_PATH].id;
    const { call, fake } = setup({ docs });
    await expect(call()).resolves.toMatchObject({ ok: true, alreadyDeleted: false });
    expect(fake.has(TEAM_PATH)).toBe(false);
  });
});

describe("deleteTeam 權限矩陣（前端刪隊准入 ∧ coach 以上；失敗一律不寫）", () => {
  test.each([
    ["captainUid", "U-cap", createAccess({ role: "captain" })],
    ["creatorUid", "U-creator", createAccess({ role: "coach" })],
    ["ownerUid", "U-owner", createAccess({ role: "admin" })],
    ["team.manage_all＋coach 以上", "U-mgr", createAccess({ role: "admin", permissions: ["team.manage_all"] })],
    ["super_admin", "U-boss", createAccess({ role: "super_admin" })],
  ])("%s ＋ coach 以上 → 通過", async (_label, uid, access) => {
    const { call, fake } = setup({ access });
    await expect(call({ teamId: TEAM }, uid)).resolves.toMatchObject({ ok: true, alreadyDeleted: false });
    expect(fake.has(TEAM_PATH)).toBe(false);
  });

  test.each([
    ["captainUid", "U-cap"], ["creatorUid", "U-creator"], ["ownerUid", "U-owner"],
  ])("%s 但 users.role=user → COACH_PLUS_REQUIRED（A 現況的半成品改為明確拒絕）", async (_label, uid) => {
    const { call, fake } = setup({ access: createAccess({ role: "user" }) });
    expect(await rejection(call({ teamId: TEAM }, uid))).toMatchObject({ code: "permission-denied", message: "COACH_PLUS_REQUIRED" });
    expect(fake.state.writes).toHaveLength(0);
    expect(fake.has(TEAM_PATH)).toBe(true);
  });

  test("team.manage_all（個別授權）但 users.role=user → COACH_PLUS_REQUIRED", async () => {
    const { call, fake } = setup({ access: createAccess({ role: "user", permissions: ["team.manage_all"] }), callerUid: "U-mgr" });
    expect(await rejection(call({ teamId: TEAM }))).toMatchObject({ message: "COACH_PLUS_REQUIRED" });
    expect(fake.state.writes).toHaveLength(0);
  });

  test("owner 但為自訂角色 → COACH_PLUS_REQUIRED（已知限制）", async () => {
    const { call } = setup({ access: createAccess({ role: "my_custom_role" }) });
    expect(await rejection(call())).toMatchObject({ message: "COACH_PLUS_REQUIRED" });
  });

  test.each([["領隊", "U-lead"], ["教練", "U-coach"], ["非幹部", "U-stranger"]])(
    "%s（coach 以上但不是 owner 欄位、無 team.manage_all）→ TEAM_DELETE_DENIED",
    async (_label, uid) => {
      const { call, fake } = setup({ access: createAccess({ role: "admin" }) });
      expect(await rejection(call({ teamId: TEAM }, uid))).toMatchObject({ code: "permission-denied", message: "TEAM_DELETE_DENIED" });
      expect(fake.state.writes).toHaveLength(0);
      expect(fake.has(TEAM_PATH)).toBe(true);
    },
  );
});

describe("deleteTeam 終驗補強（Opus 終驗 F-1／F-3／F-4／M11／M12）", () => {
  test.each([
    ["captainUid 帶前後空白", { captainUid: " U-cap " }, "U-cap"],
    ["ownerUid 是陣列", { ownerUid: ["U-owner"] }, "U-owner"],
    ["creatorUid 是數字", { creatorUid: 123 }, "123"],
  ])("F-1：%s → TEAM_DELETE_DENIED（owner 比對對齊 Rules isResourceOwnerByField，不 trim、不字串化）", async (_label, patch, callerUid) => {
    const docs = seedDocs();
    docs[TEAM_PATH] = { id: TEAM, name: "待刪俱樂部", ...patch }; // 只留這一個 owner 欄位，避免其他欄位讓呼叫者過關
    const { call, fake } = setup({ docs, access: createAccess({ role: "admin" }), callerUid });
    expect(await rejection(call())).toMatchObject({ code: "permission-denied", message: "TEAM_DELETE_DENIED" });
    expect(fake.state.writes).toHaveLength(0);
    expect(fake.has(TEAM_PATH)).toBe(true);
  });

  test("F-3：team 文件沒有 id 欄位 → 角色重算仍以文件 id 排除本隊（隊長正確降級）", async () => {
    const docs = withoutStaffMembership(seedDocs());
    delete docs[TEAM_PATH].id;
    const { call, fake } = setup({ docs });
    await expect(call()).resolves.toMatchObject({ ok: true, roleChanges: 3, roleSkipped: 0 });
    STAFF.forEach((uid) => expect(fake.get(`users/${uid}`).role).toBe("user"));
    expect(fake.has(TEAM_PATH)).toBe(false);
  });

  test("F-3：team 文件沒有 id 欄位 → 成員查詢與清除也以文件 id 為準", async () => {
    const docs = seedDocs();
    delete docs[TEAM_PATH].id;
    const { call, fake } = setup({ docs });
    await expect(call()).resolves.toMatchObject({ ok: true, cleanedMembers: 5 });
    expect(fake.get("users/U-m1").teamIds).toEqual([]);
  });

  test("F-4：最後一批 NOT_FOUND 但 team 仍在（呼叫者文件在最後一批前被刪）→ 必須 TEAM_DELETE_FAILED，team 仍在、不寫 team_delete", async () => {
    const logger = createLogger();
    const { call, fake } = setup({ logger });
    fake.state.beforeCommit = ({ ops }) => {
      if (ops.some((item) => item.op === "delete")) fake.remove("users/U-cap");
    };
    expect(await rejection(call())).toMatchObject({ code: "internal", message: "TEAM_DELETE_FAILED" });
    expect(fake.has(TEAM_PATH)).toBe(true);
    expect(fake.writesTo("operationLogs/").map((item) => item.data.type)).not.toContain("team_delete");
    expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining("concurrent"), expect.anything());
    expect(logger.error).toHaveBeenCalledWith("[deleteTeam] failed", expect.objectContaining({ phase: "delete-team" }));
  });

  test("M11：呼叫者是非 canonical 文件（docId≠uid）→ 其降級仍延後到最後一批，角色寫在文件 id、站內信寫在 uid 路徑", async () => {
    const docs = withoutStaffMembership(seedDocs());
    delete docs["users/U-cap"];
    docs["users/doc-cap"] = { uid: "U-cap", displayName: "隊長", role: "captain" };
    const { call, fake } = setup({ docs });
    await call();
    const lastCommit = fake.state.commits.length;
    const finalPaths = fake.state.writes
      .filter((item) => item.commit === lastCommit)
      .map((item) => item.path.replace(/(operationLogs\/op_).*/, "$1*"));
    expect(finalPaths).toEqual(["users/doc-cap", `users/U-cap/inbox/${INBOX_ID}`, "operationLogs/op_*", "operationLogs/op_*", TEAM_PATH]);
    expect(fake.get("users/doc-cap").role).toBe("user");
  });

  test("M12：被刪隊只有舊欄位 leaderUid 的領隊（沒有 leaderUids）→ 其角色重算也會被處理", async () => {
    const docs = withoutStaffMembership(seedDocs({
      "users/U-oldlead": { uid: "U-oldlead", displayName: "舊領隊", role: "coach" },
    }));
    docs[TEAM_PATH] = { id: TEAM, name: "待刪俱樂部", captainUid: "U-cap", leaderUid: "U-oldlead" };
    const { call, fake } = setup({ docs });
    await expect(call()).resolves.toMatchObject({ ok: true, roleChanges: 2, roleSkipped: 0 }); // 舊領隊＋呼叫者
    expect(fake.get("users/U-oldlead").role).toBe("user");
    expect(fake.list("users/U-oldlead/inbox")).toEqual([INBOX_ID]);
  });
});

describe("deleteTeam 權限碼與 Rules 一致（審查 P3-7：rolePermissions 文件不存在 ≠ 有預設權限）", () => {
  // getCallerAccessContext 的 mock 對任何權限碼都回 true（模擬真實環境「文件不存在 → 回退預設權限，admin 因此帶 team.manage_all」）。
  const strangerCall = (options) => {
    const ctx = setup({ callerUid: "U-mgr", ...options });
    return { ...ctx, run: () => ctx.call({ teamId: TEAM }) };
  };

  test("admin（非 owner）沒有 rolePermissions/admin 文件 → 不放行（Functions 預設權限不算）", async () => {
    const { run, fake } = strangerCall({ access: createAccess({ role: "admin", permissions: null }) });
    expect(await rejection(run())).toMatchObject({ code: "permission-denied", message: "TEAM_DELETE_DENIED" });
    expect(fake.state.writes).toHaveLength(0);
    expect(fake.has(TEAM_PATH)).toBe(true);
  });

  test("admin 的 rolePermissions 文件存在但不含 team.manage_all → 不放行", async () => {
    const { run } = strangerCall({ access: createAccess({ role: "admin", permissions: ["team.create"] }) });
    expect(await rejection(run())).toMatchObject({ message: "TEAM_DELETE_DENIED" });
  });

  test("admin 的 rolePermissions 文件含 team.manage_all → 放行", async () => {
    const { run, fake } = strangerCall({ access: createAccess({ role: "admin", permissions: ["team.manage_all"] }) });
    await expect(run()).resolves.toMatchObject({ ok: true, alreadyDeleted: false });
    expect(fake.has(TEAM_PATH)).toBe(false);
  });

  test("個別授權 enabled:false → 不放行；沒有 enabled 欄位 → 放行（role 需 coach 以上才過第二關，這裡用 coach）", async () => {
    const off = strangerCall({
      docs: seedDocs({ "userPermissionGrants/U-mgr": { permissions: ["team.manage_all"], enabled: false } }),
      access: createAccess({ role: "coach", permissions: null }),
    });
    expect(await rejection(off.run())).toMatchObject({ message: "TEAM_DELETE_DENIED" });
    const on = strangerCall({
      docs: seedDocs({ "userPermissionGrants/U-mgr": { permissions: ["team.manage_all"] } }),
      access: createAccess({ role: "coach", permissions: null }),
    });
    await expect(on.run()).resolves.toMatchObject({ ok: true, alreadyDeleted: false });
  });

  test("users.role=user 時 rolePermissions/user 文件不算", async () => {
    const { run } = strangerCall({
      docs: seedDocs({ "rolePermissions/user": { permissions: ["team.manage_all"] } }),
      access: createAccess({ role: "user", permissions: null }),
    });
    expect(await rejection(run())).toMatchObject({ message: "TEAM_DELETE_DENIED" });
  });

  test("owner 帶 coach 角色但沒有 rolePermissions 文件：能刪隊，卻不能因預設權限降級別人（降他人也要看文件）", async () => {
    const docs = withoutStaffMembership(seedDocs());
    const { call, fake } = setup({ docs, access: createAccess({ role: "captain", permissions: null }) });
    await expect(call()).resolves.toMatchObject({ ok: true, roleChanges: 1, roleSkipped: 2 });
    expect(fake.get("users/U-lead").role).toBe("coach");
  });
});

describe("deleteTeam Phase 1：成員集合與分批清除", () => {
  test("兩組查詢（teamIds／舊 teamId）去重，只動屬於本隊的人", async () => {
    const { call, fake } = setup();
    const result = await call();
    expect(result).toMatchObject({ cleanedMembers: 5 }); // 3 幹部 + U-m1(teamIds) + U-m2(只有舊 teamId)
    ["U-cap", "U-lead", "U-coach", "U-m1", "U-m2"].forEach((uid) => {
      expect(fake.get(`users/${uid}`)).toMatchObject({ teamId: null, teamName: null, teamIds: [], teamNames: [], updatedAt: "SERVER_TS" });
    });
    expect(fake.writesTo("users/U-stranger")).toHaveLength(0);
    expect(fake.get("users/U-stranger").teamIds).toEqual(["tm_other"]);
  });

  test("成員還屬於別隊 → 保留別隊，主隊切換，teamNames 讀 team 名稱", async () => {
    const docs = seedDocs({
      "users/U-multi": { uid: "U-multi", role: "user", teamId: TEAM, teamName: "x", teamIds: [TEAM, "tm_other", "tm_gone"], teamNames: ["a", "b", "c"] },
    });
    const { call, fake } = setup({ docs });
    await call();
    expect(fake.get("users/U-multi")).toMatchObject({
      teamId: "tm_other", teamName: "別隊", teamIds: ["tm_other", "tm_gone"], teamNames: ["別隊", "tm_gone"],
    });
  });

  test("幹部補齊：teamIds 元素帶空白而查詢比對不到的幹部文件，也會被清掉", async () => {
    const docs = seedDocs();
    docs["users/U-lead"] = { ...docs["users/U-lead"], teamId: null, teamName: null, teamIds: [` ${TEAM} `], teamNames: ["x"] };
    const { call, fake } = setup({ docs });
    await expect(call()).resolves.toMatchObject({ cleanedMembers: 5 });
    expect(fake.get("users/U-lead")).toMatchObject({ teamId: null, teamIds: [], teamNames: [] });
  });

  test("幹部補齊：不屬於本隊的幹部文件不會被寫入", async () => {
    const docs = withoutStaffMembership(seedDocs());
    const { call, fake } = setup({ docs });
    await expect(call()).resolves.toMatchObject({ cleanedMembers: 2 });
    // 只有 Phase 2 的角色更新寫到 users/U-lead 文件本身（站內信在子集合 users/U-lead/inbox，不算），沒有隊伍欄位的清除寫入
    expect(fake.state.writes.filter((item) => item.path === "users/U-lead").map((item) => Object.keys(item.data).join()))
      .toEqual(["role,updatedAt"]);
  });

  test("1000 名成員（含只有舊 teamId 者）：分頁讀完、每批 ≤450、每人只寫一次", async () => {
    const { call, fake } = setup({ docs: manyMembers(1000) });
    const result = await call();
    expect(result).toMatchObject({ cleanedMembers: 1000, roleChanges: 3 });
    // Phase 1 三批（≤450）→ 兩位非呼叫者幹部各一批（角色＋站內信＋opLog）→ 最後一批（呼叫者角色 3 筆＋opLog＋刪 team）
    expect(fake.state.commits.map((item) => item.size)).toEqual([450, 450, 100, 3, 3, 5]);
    const userWrites = fake.state.writes.filter((item) => item.path.startsWith("users/U-bulk-"));
    expect(userWrites).toHaveLength(1000);
    expect(new Set(userWrites.map((item) => item.path)).size).toBe(1000);
  });

  test("中途失敗可重跑：第二批 commit 失敗 → team 仍在；重跑只處理剩下的人，不重複寫", async () => {
    const { call, fake } = setup({ docs: manyMembers(1000) });
    fake.state.failCommit = ({ commitNumber }) => (commitNumber === 2 ? new FakeFirestoreError(14, "UNAVAILABLE") : null);
    expect(await rejection(call())).toMatchObject({ code: "internal", message: "TEAM_DELETE_FAILED" });
    expect(fake.has(TEAM_PATH)).toBe(true);
    expect(fake.writesTo("users/U-bulk-")).toHaveLength(450);

    fake.state.failCommit = null;
    const result = await call();
    expect(result).toMatchObject({ ok: true, cleanedMembers: 550 });
    expect(fake.has(TEAM_PATH)).toBe(false);
    const userWrites = fake.state.writes.filter((item) => item.path.startsWith("users/U-bulk-"));
    expect(userWrites).toHaveLength(1000);
    expect(new Set(userWrites.map((item) => item.path)).size).toBe(1000);
  });
});

describe("deleteTeam Phase 1：已清人數逐筆回寫 progress（MiMo 核對 P3-3）", () => {
  test("整批階段：第二批 commit 拋非衝突錯誤 → 失敗 log 的 cleanedMembers 是已成功清掉的 450，不是 0", async () => {
    const logger = createLogger();
    const { call, fake } = setup({ docs: manyMembers(1000), logger });
    fake.state.failCommit = ({ commitNumber }) => (commitNumber === 2 ? new FakeFirestoreError(14, "UNAVAILABLE") : null);
    expect(await rejection(call())).toMatchObject({ code: "internal", message: "TEAM_DELETE_FAILED" });
    expect(fake.writesTo("users/U-bulk-")).toHaveLength(450);
    expect(logger.error).toHaveBeenCalledWith(
      "[deleteTeam] failed",
      expect.objectContaining({ phase: "clean-members", cleanedMembers: 450, roleChanges: 0 }),
    );
  });

  test("逐位階段：前面已清掉 4 位、第 5 位 U-race 重試耗盡、第 6 位拋非衝突錯誤 → 失敗 log 的 cleanedMembers 是 4", async () => {
    const logger = createLogger();
    const docs = seedDocs({
      "users/U-race": { uid: "U-race", role: "user", teamId: TEAM, teamName: "x", teamIds: [TEAM, "tm_other"], teamNames: ["x", "別隊"] },
    });
    const { call, fake } = setup({ docs, logger });
    // U-race 每次寫入（整批或逐位）都先被製造衝突 → 整批 3 次失敗後進入逐位階段；逐位階段 U-m2 的 update 直接拋非衝突錯誤
    fake.state.beforeCommit = ({ ops }) => {
      if (ops.some((item) => item.path === "users/U-race")) fake.touch("users/U-race", { updatedAt: `t${Math.random()}` });
    };
    fake.state.failWrite = ({ path }) => (path === "users/U-m2" ? new Error("boom") : null);
    expect(await rejection(call())).toMatchObject({ code: "internal", message: "TEAM_DELETE_FAILED" });
    expect(fake.has(TEAM_PATH)).toBe(true);
    ["U-cap", "U-coach", "U-lead", "U-m1"].forEach((uid) => expect(fake.get(`users/${uid}`).teamIds).toEqual([]));
    expect(logger.error).toHaveBeenCalledWith(
      "[deleteTeam] failed",
      expect.objectContaining({ phase: "clean-members", cleanedMembers: 4 }),
    );
  });

  test("成員文件在讀與 commit 之間被刪除（NOT_FOUND）→ 視為 gone：重讀後略過，不重試空轉、不算 failed、不 partial", async () => {
    const logger = createLogger();
    const { call, fake } = setup({ logger });
    fake.state.beforeCommit = ({ commitNumber }) => {
      if (commitNumber === 1) fake.remove("users/U-m1");
    };
    const result = await call();
    expect(result.partial).toBeUndefined();
    // 口徑：cleanedMembers 只計「本次實際寫入」的人；被刪除（以及自行退出）者不計入 cleaned、也不計入 failed
    expect(result).toMatchObject({ ok: true, alreadyDeleted: false, cleanedMembers: 4 });
    expect(fake.state.commits[0]).toMatchObject({ ok: false });
    expect(fake.state.commits[1]).toMatchObject({ ok: true });
    expect(logger.warn.mock.calls.filter(([message]) => message.includes("conflicted"))).toHaveLength(1);
    expect(fake.has(TEAM_PATH)).toBe(false);
  });
});

describe("deleteTeam Phase 1：讀與寫之間的併發變更不會被蓋掉（審查 P2-1）", () => {
  const raceDocs = () => seedDocs({
    "users/U-race": { uid: "U-race", role: "user", teamId: TEAM, teamName: "x", teamIds: [TEAM, "tm_other"], teamNames: ["x", "別隊"] },
  });

  test("成員在讀與 commit 之間自己加了別隊 → 該批因前置條件失敗，重讀後保留新加的隊", async () => {
    const logger = createLogger();
    const { call, fake } = setup({ docs: raceDocs(), logger });
    fake.state.beforeCommit = ({ commitNumber }) => {
      if (commitNumber === 1) {
        fake.touch("users/U-race", { teamIds: [TEAM, "tm_other", "tm_z"], teamNames: ["x", "別隊", "Z"] });
      }
    };
    await expect(call()).resolves.toMatchObject({ ok: true, cleanedMembers: 6 });
    expect(fake.state.commits[0]).toMatchObject({ ok: false });
    expect(fake.get("users/U-race")).toMatchObject({
      teamId: "tm_other", teamIds: ["tm_other", "tm_z"], teamNames: ["別隊", "tm_z"],
    });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("conflicted"), expect.objectContaining({ attempt: 1 }));
  });

  test("成員在讀與 commit 之間自己退出本隊 → 重讀後略過，不再寫他", async () => {
    const { call, fake } = setup();
    fake.state.beforeCommit = ({ commitNumber }) => {
      if (commitNumber === 1) fake.touch("users/U-m1", { teamId: null, teamName: null, teamIds: [], teamNames: [] });
    };
    await expect(call()).resolves.toMatchObject({ ok: true, cleanedMembers: 4 });
    expect(fake.writesTo("users/U-m1")).toHaveLength(0);
  });

  test("一位成員的衝突不拖累其他人：整批重試 3 次後改逐位處理，其他人都清掉", async () => {
    const { call, fake } = setup({ docs: raceDocs() });
    let armed = true;
    // 只在 U-race 被寫入時製造衝突（整批提交或逐位 update 都會觸發）
    fake.state.beforeCommit = ({ ops }) => {
      if (armed && ops.some((item) => item.path === "users/U-race")) fake.touch("users/U-race", { updatedAt: `t${Math.random()}` });
    };
    const result = await call();
    armed = false;
    expect(result).toMatchObject({ ok: true, alreadyDeleted: false, cleanedMembers: 5 });
    expect(result.partial).toMatchObject({ remainingMembers: 1, rerun: true });
    ["U-cap", "U-lead", "U-coach", "U-m1", "U-m2"].forEach((uid) => {
      expect(fake.get(`users/${uid}`)).toMatchObject({ teamId: null, teamIds: [], teamNames: [] });
    });
    expect(fake.get("users/U-race").teamIds).toEqual([TEAM, "tm_other"]);
  });
});

describe("deleteTeam Phase 1 重試耗盡 → partial：不刪 team、不進角色重算，可重跑（FC 顧問裁示）", () => {
  const raceDocs = () => seedDocs({
    "users/U-race": { uid: "U-race-uid-0001", role: "user", teamId: TEAM, teamName: "x", teamIds: [TEAM, "tm_other"], teamNames: ["x", "別隊"] },
  });
  // 對 U-race 的每次寫入（整批或逐位）都先製造一次衝突
  const conflictOnRace = (fake) => {
    fake.state.beforeCommit = ({ ops }) => {
      if (ops.some((item) => item.path === "users/U-race")) fake.touch("users/U-race", { updatedAt: `t${Math.random()}` });
    };
  };

  test("重試成功（單次衝突）→ 沒有 partial，正常刪除", async () => {
    const { call, fake } = setup({ docs: raceDocs() });
    let once = true;
    fake.state.beforeCommit = ({ commitNumber }) => {
      if (once && commitNumber === 1) {
        once = false;
        fake.touch("users/U-race", { teamNames: ["x", "別隊"], updatedAt: "touched" });
      }
    };
    const result = await call();
    expect(result.partial).toBeUndefined();
    expect(result).toMatchObject({ ok: true, alreadyDeleted: false, cleanedMembers: 6 });
    expect(fake.has(TEAM_PATH)).toBe(false);
  });

  test("重試耗盡 → 回 partial（遮罩識別＋可重跑旗標），team 文件仍在、沒有 team_delete、沒有角色變更", async () => {
    const logger = createLogger();
    const { call, fake } = setup({ docs: raceDocs(), logger });
    conflictOnRace(fake);
    const result = await call();
    expect(result).toMatchObject({
      ok: true,
      alreadyDeleted: false,
      cleanedMembers: 5,
      roleChanges: 0,
      roleSkipped: 0,
      partial: { remainingMembers: 1, memberIds: [expect.any(String)], rerun: true },
    });
    expect(result.partial.memberIds[0]).not.toBe("U-race-uid-0001");
    expect(fake.has(TEAM_PATH)).toBe(true);
    expect(fake.writesTo("operationLogs/")).toHaveLength(0);
    expect(fake.get("users/U-cap").role).toBe("captain");
    expect(fake.list("users/U-cap/inbox")).toEqual([]);
    expect(fake.get("users/U-race").teamIds).toEqual([TEAM, "tm_other"]);
    expect(logger.error).toHaveBeenCalledWith(
      "[deleteTeam] member cleanup exhausted retries",
      expect.objectContaining({ attempts: 3, memberId: expect.any(String) }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      "[deleteTeam] partial: members left uncleaned, team kept",
      expect.objectContaining({ remainingMembers: 1 }),
    );
    // log 內的成員識別一律遮罩
    logger.error.mock.calls.forEach(([, context]) => {
      expect(JSON.stringify(context)).not.toContain("U-race-uid-0001");
    });
  });

  test("partial 之後衝突排除再重跑 → 只補剩下的一位，之後正常刪除、角色重算與刪 team 都完成", async () => {
    const { call, fake } = setup({ docs: raceDocs() });
    conflictOnRace(fake);
    await call();
    fake.state.beforeCommit = null;
    const result = await call();
    expect(result.partial).toBeUndefined();
    expect(result).toMatchObject({ ok: true, alreadyDeleted: false, cleanedMembers: 1, roleChanges: 3 });
    expect(fake.get("users/U-race")).toMatchObject({ teamId: "tm_other", teamIds: ["tm_other"] });
    expect(fake.has(TEAM_PATH)).toBe(false);
  });

  test("逐位處理時成員已自己退出本隊 → 視為完成，不算 partial", async () => {
    const { call, fake } = setup({ docs: raceDocs() });
    let batchAttempts = 0;
    fake.state.beforeCommit = ({ ops, commitNumber }) => {
      if (!ops.some((item) => item.path === "users/U-race")) return;
      if (commitNumber !== null) {
        batchAttempts += 1;
        fake.touch("users/U-race", { updatedAt: `t${batchAttempts}` });
      } else {
        // 逐位階段：成員在這一刻自己退出本隊
        fake.touch("users/U-race", { teamId: "tm_other", teamIds: ["tm_other"], teamNames: ["別隊"] });
      }
    };
    const result = await call();
    expect(result.partial).toBeUndefined();
    expect(result).toMatchObject({ ok: true, cleanedMembers: 5 });
    expect(fake.has(TEAM_PATH)).toBe(false);
    expect(fake.get("users/U-race").teamIds).toEqual(["tm_other"]);
  });

  test("非衝突類錯誤（網路等）仍直接 TEAM_DELETE_FAILED，不當成 partial", async () => {
    const { call, fake } = setup({ docs: raceDocs() });
    fake.state.failCommit = () => new FakeFirestoreError(14, "UNAVAILABLE");
    expect(await rejection(call())).toMatchObject({ code: "internal", message: "TEAM_DELETE_FAILED" });
    expect(fake.has(TEAM_PATH)).toBe(true);
  });
});

describe("deleteTeam Phase 2／3：幹部角色重算（排除本隊）與站內信", () => {
  test("只在本隊任職 → 降為一般用戶；非呼叫者各一個 batch，先改 claim 再改文件", async () => {
    const claimSeen = [];
    const holder = {};
    const setRoleClaimMerged = jest.fn(async (uid, role) => {
      claimSeen.push([uid, role, holder.fake.get(`users/${uid}`).role]);
    });
    const ctx = setup({ docs: withoutStaffMembership(seedDocs()), setRoleClaimMerged });
    holder.fake = ctx.fake;
    const result = await ctx.call();
    expect(result).toMatchObject({ roleChanges: 3, roleSkipped: 0 });
    // 呼叫者（U-cap）最後處理：其降級在 Phase 4
    expect(ctx.ensureAuthUser.mock.calls.map(([uid]) => uid)).toEqual(["U-lead", "U-coach", "U-cap"]);
    expect(claimSeen).toEqual([["U-lead", "user", "coach"], ["U-coach", "user", "coach"], ["U-cap", "user", "captain"]]);
    STAFF.forEach((uid) => expect(ctx.fake.get(`users/${uid}`).role).toBe("user"));

    const writes = ctx.fake.state.writes;
    const first = writes.findIndex((item) => item.path === "users/U-lead");
    expect(writes.slice(first, first + 3).map((item) => [item.op, item.path.replace(/(operationLogs\/op_).*/, "$1*")]))
      .toEqual([["update", "users/U-lead"], ["set", `users/U-lead/inbox/${INBOX_ID}`], ["set", "operationLogs/op_*"]]);
    expect(writes[first].data).toEqual({ role: "user", updatedAt: "SERVER_TS" });
    expect(writes[first].commit).toBe(writes[first + 2].commit);
  });

  test("呼叫者本人的降級與 team_delete opLog、刪 team 在同一次 commit（最後一批）", async () => {
    const { call, fake } = setup({ docs: withoutStaffMembership(seedDocs()) });
    await call();
    const lastCommit = fake.state.commits.length;
    const finalWrites = fake.state.writes.filter((item) => item.commit === lastCommit);
    expect(finalWrites.map((item) => [item.op, item.path.replace(/(operationLogs\/op_).*/, "$1*")])).toEqual([
      ["update", "users/U-cap"],
      ["set", `users/U-cap/inbox/${INBOX_ID}`],
      ["set", "operationLogs/op_*"],
      ["set", "operationLogs/op_*"],
      ["delete", TEAM_PATH],
    ]);
    expect(finalWrites[3].data).toMatchObject({ type: "team_delete" });
    // 其他幹部的降級在更早的 commit，不在最後一批
    expect(fake.writesTo("users/U-lead")[0].commit).toBeLessThan(lastCommit);
  });

  test("站內信沿用 A 的 role_upgrade 樣板；路徑用邏輯 uid、time 為台北時間；opLog 為「角色變更」且不含 UID", async () => {
    const { call, fake } = setup({ docs: withoutStaffMembership(seedDocs()) });
    await call();
    expect(fake.list("users/U-cap/inbox")).toEqual([INBOX_ID]);
    expect(fake.get(`users/U-cap/inbox/${INBOX_ID}`)).toMatchObject({
      title: "身份變更通知",
      body: "恭喜 隊長！您的身份已變更為「一般用戶」。",
      type: "private",
      typeName: "私訊",
      senderName: "系統",
      time: "2026/10/27 16:00",
      read: false,
      createdAt: "SERVER_TS",
    });
    const roleLogs = fake.writesTo("operationLogs/").map((item) => item.data).filter((item) => item.type === "role");
    expect(roleLogs).toHaveLength(3);
    expect(roleLogOf(fake, "隊長")).toMatchObject({
      typeName: "角色變更", content: "隊長 自動調整為「一般用戶」（原：領隊）", actorUid: "U-cap", source: "callable", operator: "隊長",
    });
    roleLogs.forEach((item) => expect(item.content).not.toMatch(/U-/));
  });

  test("幹部文件 id 與 uid 不同（非 canonical）：角色寫在文件 id，站內信寫在 users/{uid}/inbox", async () => {
    const docs = withoutStaffMembership(seedDocs());
    delete docs["users/U-lead"];
    docs["users/doc-lead"] = { uid: "U-lead", displayName: "領隊", role: "coach" };
    const { call, fake } = setup({ docs });
    await call();
    expect(fake.get("users/doc-lead").role).toBe("user");
    expect(fake.list("users/U-lead/inbox")).toEqual([INBOX_ID]);
    expect(fake.list("users/doc-lead/inbox")).toEqual([]);
  });

  test("通知名稱對齊 A：users.name 優先於 displayName", async () => {
    const docs = withoutStaffMembership(seedDocs());
    docs["users/U-lead"] = { ...docs["users/U-lead"], name: "正式姓名", displayName: "LINE 暱稱" };
    const { call, fake } = setup({ docs });
    await call();
    expect(fake.get(`users/U-lead/inbox/${INBOX_ID}`).body).toContain("恭喜 正式姓名！");
    expect(roleLogOf(fake, "正式姓名")).toBeTruthy();
  });

  test("operationLogs 操作者名稱對齊 A：沒有 displayName 時用角色標籤", async () => {
    const docs = withoutStaffMembership(seedDocs());
    docs["users/U-cap"] = { ...docs["users/U-cap"], displayName: "" };
    const { call, fake } = setup({ docs });
    await call();
    const teamDeleteLog = fake.writesTo("operationLogs/").map((item) => item.data).find((data) => data.type === "team_delete");
    expect(teamDeleteLog.operator).toBe("領隊");
  });

  test("Firestore 的 notifTemplates/role_upgrade 優先於內建預設", async () => {
    const docs = withoutStaffMembership(seedDocs({
      "notifTemplates/role_upgrade": { key: "role_upgrade", title: "自訂標題", body: "{userName} 現為 {roleName}" },
    }));
    const { call, fake } = setup({ docs });
    await call();
    expect(fake.get(`users/U-cap/inbox/${INBOX_ID}`)).toMatchObject({ title: "自訂標題", body: "隊長 現為 一般用戶" });
  });

  test("完全沒有樣板 → 角色照改、opLog 照寫，只是不發站內信", async () => {
    const { call, fake } = setup({ docs: withoutStaffMembership(seedDocs()), templates: [] });
    await expect(call()).resolves.toMatchObject({ roleChanges: 3 });
    expect(fake.list("users/U-cap/inbox")).toEqual([]);
    expect(fake.get("users/U-cap").role).toBe("user");
  });

  test("本隊刪除後不發 LINE 推播（已知差異：A 會發）", async () => {
    const { call, fake } = setup({ docs: withoutStaffMembership(seedDocs()) });
    await call();
    expect(fake.writesTo("linePushQueue")).toHaveLength(0);
  });

  test("同時是另一隊隊長 → 角色不降級、不發通知（排除的是本隊，不是這個人）", async () => {
    const docs = withoutStaffMembership(seedDocs());
    docs["teams/tm_other"] = { id: "tm_other", name: "別隊", captainUid: "U-cap" };
    const { call, fake } = setup({ docs });
    await expect(call()).resolves.toMatchObject({ roleChanges: 2, roleSkipped: 0 });
    expect(fake.get("users/U-cap").role).toBe("captain");
    expect(fake.list("users/U-cap/inbox")).toEqual([]);
  });

  test.each([
    ["別隊的教練（coachUids）", { coachUids: ["U-cap"] }],
    ["別隊的領隊（leaderUids）", { leaderUids: ["U-cap"] }],
    ["別隊的舊欄位 leaderUid", { leaderUid: "U-cap" }],
  ])("隊長在%s 仍有職務 → 降為教練而非一般用戶", async (_label, patch) => {
    const docs = withoutStaffMembership(seedDocs());
    docs["teams/tm_other"] = { id: "tm_other", name: "別隊", captainUid: "U-othercap", ...patch };
    const { call, fake } = setup({ docs });
    await call();
    expect(fake.get("users/U-cap").role).toBe("coach");
    expect(fake.get(`users/U-cap/inbox/${INBOX_ID}`).body).toContain("教練");
  });

  test("manualRole 當底線：manualRole=coach 的隊長降為教練", async () => {
    const docs = withoutStaffMembership(seedDocs());
    docs["users/U-cap"] = { ...docs["users/U-cap"], manualRole: "coach" };
    const { call, fake } = setup({ docs });
    await call();
    expect(fake.get("users/U-cap").role).toBe("coach");
  });

  test.each([
    ["manualRole 為保護等級（venue_owner）", { manualRole: "venue_owner" }],
    ["目前角色已達保護等級（venue_owner）", { role: "venue_owner" }],
    ["角色不在固定表（自訂角色）", { role: "my_custom_role" }],
  ])("%s → 不動角色、不發通知", async (_label, patch) => {
    const docs = withoutStaffMembership(seedDocs());
    docs["users/U-cap"] = { ...docs["users/U-cap"], ...patch };
    const before = docs["users/U-cap"].role;
    const { call, fake } = setup({ docs });
    await expect(call()).resolves.toMatchObject({ roleChanges: 2, roleSkipped: 0 });
    expect(fake.get("users/U-cap").role).toBe(before);
    expect(fake.list("users/U-cap/inbox")).toEqual([]);
  });

  test("角色已是目標（no_change）→ 不寫、不發通知，也不碰 Auth", async () => {
    const docs = withoutStaffMembership(seedDocs());
    docs["users/U-cap"] = { ...docs["users/U-cap"], role: "user" };
    const { call, fake, ensureAuthUser } = setup({ docs });
    await expect(call()).resolves.toMatchObject({ roleChanges: 2, roleSkipped: 0 });
    expect(fake.writesTo("users/U-cap")).toHaveLength(0);
    expect(ensureAuthUser).not.toHaveBeenCalledWith("U-cap");
  });

  test("演算結果是升級（角色與任職不同步）→ 一律忽略並計入 roleSkipped，不因刪隊升級任何人", async () => {
    const docs = withoutStaffMembership(seedDocs());
    docs["users/U-lead"] = { ...docs["users/U-lead"], role: "user" };
    docs["teams/tm_other"] = { id: "tm_other", name: "別隊", captainUid: "U-lead" };
    const logger = createLogger();
    const { call, fake } = setup({ docs, logger });
    await expect(call()).resolves.toMatchObject({ roleChanges: 2, roleSkipped: 1 });
    expect(fake.get("users/U-lead").role).toBe("user");
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("upgrade ignored"), expect.any(Object));
  });

  test("幹部的使用者文件查無／受限 → 略過並計數，不阻擋刪隊", async () => {
    const docs = withoutStaffMembership(seedDocs());
    delete docs["users/U-lead"];
    docs["users/U-coach"] = { ...docs["users/U-coach"], isRestricted: true };
    const logger = createLogger();
    const { call, fake } = setup({ docs, logger });
    await expect(call()).resolves.toMatchObject({ roleChanges: 1, roleSkipped: 2 });
    expect(fake.has(TEAM_PATH)).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("skipped"), expect.objectContaining({ code: "not-found" }));
  });

  test("幹部 UID 為空欄位或重複 → 去重後各處理一次", async () => {
    const docs = withoutStaffMembership(seedDocs());
    docs[TEAM_PATH] = { ...docs[TEAM_PATH], leaderUids: ["U-cap", "U-lead", ""], coachUids: ["U-lead", "U-coach"] };
    const { call, ensureAuthUser } = setup({ docs });
    await call();
    expect(ensureAuthUser.mock.calls.map(([uid]) => uid)).toEqual(["U-lead", "U-coach", "U-cap"]);
  });
});

describe("deleteTeam 降級他人的範圍（審查 P2-3：比照 autoPromoteTeamRole 的 canCallerRecalculateRole）", () => {
  test("一般 owner（無 team.manage_all／team.create）刪隊：只降級自己，其他幹部角色不動並計入 roleSkipped", async () => {
    const logger = createLogger();
    const { call, fake } = setup({
      docs: withoutStaffMembership(seedDocs()),
      access: createAccess({ role: "captain" }),
      logger,
    });
    await expect(call()).resolves.toMatchObject({ ok: true, roleChanges: 1, roleSkipped: 2 });
    expect(fake.get("users/U-cap").role).toBe("user");
    expect(fake.get("users/U-lead").role).toBe("coach");
    expect(fake.get("users/U-coach").role).toBe("coach");
    expect(fake.list("users/U-lead/inbox")).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("not permitted"), expect.any(Object));
  });

  test.each([
    ["team.create", createAccess({ role: "captain", permissions: ["team.create"] })],
    ["team.manage_all", createAccess({ role: "captain", permissions: ["team.manage_all"] })],
  ])("持有 %s → 其他幹部也降級", async (_label, access) => {
    const { call, fake } = setup({ docs: withoutStaffMembership(seedDocs()), access });
    await expect(call()).resolves.toMatchObject({ roleChanges: 3, roleSkipped: 0 });
    STAFF.forEach((uid) => expect(fake.get(`users/${uid}`).role).toBe("user"));
  });

  test("coach 等級 owner 先把任意 UID 塞進 coachUids 再刪隊：該 UID 的角色不變（這條路被封）", async () => {
    const docs = withoutStaffMembership(seedDocs({
      "users/U-victim": { uid: "U-victim", displayName: "被塞進來的人", role: "captain", teamId: null, teamIds: [], teamNames: [] },
    }));
    docs[TEAM_PATH] = { ...docs[TEAM_PATH], coachUids: ["U-coach", "U-victim"] };
    const logger = createLogger();
    const { call, fake } = setup({ docs, access: createAccess({ role: "coach" }), logger });
    await expect(call()).resolves.toMatchObject({ ok: true, alreadyDeleted: false, roleChanges: 1, roleSkipped: 3 });
    expect(fake.get("users/U-victim").role).toBe("captain");
    expect(fake.list("users/U-victim/inbox")).toEqual([]);
    expect(fake.writesTo("users/U-victim")).toHaveLength(0);
    expect(fake.get("users/U-cap").role).toBe("user");
  });

  test("super_admin（不是該隊幹部）刪隊 → 所有幹部降級，沒有呼叫者本人的延後項", async () => {
    const { call, fake } = setup({
      docs: withoutStaffMembership(seedDocs()),
      access: createAccess({ role: "super_admin" }),
    });
    await expect(call({ teamId: TEAM }, "U-boss")).resolves.toMatchObject({ roleChanges: 3, roleSkipped: 0 });
    STAFF.forEach((uid) => expect(fake.get(`users/${uid}`).role).toBe("user"));
  });
});

describe("deleteTeam 冪等、可重入與「最後才刪 team」", () => {
  test("成功時 team 文件的刪除是最後一筆寫入，且與 team_delete opLog 同一批", async () => {
    const { call, fake } = setup();
    await call();
    const writes = fake.state.writes;
    expect(writes[writes.length - 1]).toMatchObject({ op: "delete", path: TEAM_PATH });
    expect(writes[writes.length - 2]).toMatchObject({ op: "set" });
    expect(writes[writes.length - 2].data).toMatchObject({
      type: "team_delete", typeName: "刪除俱樂部", content: "刪除「待刪俱樂部」", actorUid: "U-cap", source: "callable",
    });
    expect(writes.filter((item) => item.path === TEAM_PATH)).toHaveLength(1);
    expect(writes[writes.length - 1].commit).toBe(writes[writes.length - 2].commit);
  });

  test("Phase 2 失敗 → team 仍在、已清的成員不回復、呼叫者角色未動；修好後重跑完成", async () => {
    const ensureAuthUser = jest.fn(async () => null);
    ensureAuthUser.mockRejectedValueOnce(new Error("auth backend down"));
    const logger = createLogger();
    const { call, fake } = setup({ ensureAuthUser, logger });
    expect(await rejection(call())).toMatchObject({ code: "internal", message: "TEAM_DELETE_FAILED" });
    expect(fake.has(TEAM_PATH)).toBe(true);
    expect(fake.get("users/U-m1").teamIds).toEqual([]);
    expect(fake.get("users/U-cap").role).toBe("captain");
    expect(logger.error).toHaveBeenCalledWith(
      "[deleteTeam] failed",
      expect.objectContaining({ phase: "recalculate-roles", cleanedMembers: 5, roleChanges: 0, code: "internal" }),
    );

    const result = await call();
    expect(result).toMatchObject({ ok: true, cleanedMembers: 0, roleChanges: 3 });
    expect(fake.has(TEAM_PATH)).toBe(false);
  });

  test("最後一批（呼叫者角色＋opLog＋刪 team）失敗 → 重跑只補呼叫者本人，不重發他人通知，team_delete 只有一筆", async () => {
    const { call, fake } = setup({ accessFromDocs: true, accessPermissions: ["team.create"] });
    fake.state.failCommit = ({ ops }) => (ops.some((item) => item.op === "delete") ? new FakeFirestoreError(14, "UNAVAILABLE") : null);
    expect(await rejection(call())).toMatchObject({ code: "internal" });
    expect(fake.has(TEAM_PATH)).toBe(true);
    expect(fake.get("users/U-cap").role).toBe("captain");
    expect(fake.list("users/U-cap/inbox")).toEqual([]);
    expect(fake.list("users/U-lead/inbox")).toHaveLength(1);

    fake.state.failCommit = null;
    await expect(call()).resolves.toMatchObject({ ok: true, cleanedMembers: 0, roleChanges: 1 });
    expect(fake.has(TEAM_PATH)).toBe(false);
    STAFF.forEach((uid) => expect(fake.list(`users/${uid}/inbox`)).toHaveLength(1));
    const logs = fake.writesTo("operationLogs/").map((item) => item.data.type);
    expect(logs.filter((type) => type === "team_delete")).toHaveLength(1);
    expect(logs.filter((type) => type === "role")).toHaveLength(3);
  });

  test("P1-1：隊長呼叫、最後一批失敗一次後重試要成功（角色讀自文件，呼叫者文件上的角色仍是舊的）", async () => {
    const { call, fake, getCallerAccessContext } = setup({ accessFromDocs: true, accessPermissions: ["team.create"] });
    let failuresLeft = 1;
    fake.state.failCommit = ({ ops }) => {
      if (failuresLeft > 0 && ops.some((item) => item.op === "delete")) {
        failuresLeft -= 1;
        return new FakeFirestoreError(14, "UNAVAILABLE");
      }
      return null;
    };
    expect(await rejection(call())).toMatchObject({ code: "internal", message: "TEAM_DELETE_FAILED" });
    expect(fake.get("users/U-cap").role).toBe("captain");

    await expect(call()).resolves.toMatchObject({ ok: true, alreadyDeleted: false });
    expect(getCallerAccessContext).toHaveBeenCalledTimes(2);
    expect(fake.get("users/U-cap").role).toBe("user");
    expect(fake.list("users/U-cap/inbox")).toEqual([INBOX_ID]);
    expect(fake.has(TEAM_PATH)).toBe(false);
  });

  test("P1-1：第二位幹部的 ensureAuthUser 失敗一次後重試要成功，站內信各恰好一封，最終呼叫者是 user", async () => {
    let failuresLeft = 1;
    const ensureAuthUser = jest.fn(async (uid) => {
      if (uid === "U-coach" && failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error("auth backend down");
      }
      return null;
    });
    const logger = createLogger();
    const { call, fake } = setup({ accessFromDocs: true, accessPermissions: ["team.create"], ensureAuthUser, logger });
    expect(await rejection(call())).toMatchObject({ code: "internal", message: "TEAM_DELETE_FAILED" });
    expect(fake.get("users/U-cap").role).toBe("captain");
    expect(fake.get("users/U-lead").role).toBe("user");
    expect(logger.error).toHaveBeenCalledWith(
      "[deleteTeam] failed",
      expect.objectContaining({ phase: "recalculate-roles", roleChanges: 1 }),
    );

    await expect(call()).resolves.toMatchObject({ ok: true, roleChanges: 2 });
    STAFF.forEach((uid) => {
      expect(fake.get(`users/${uid}`).role).toBe("user");
      expect(fake.list(`users/${uid}/inbox`)).toEqual([INBOX_ID]);
    });
    expect(fake.has(TEAM_PATH)).toBe(false);
  });

  test("兩個呼叫同時進行：後到者的刪除前置條件失敗 → 視為 alreadyDeleted，不寫第二筆 team_delete opLog", async () => {
    const logger = createLogger();
    const { call, fake } = setup({ logger });
    fake.state.beforeCommit = ({ ops }) => {
      if (ops.some((item) => item.op === "delete")) fake.remove(TEAM_PATH);
    };
    await expect(call()).resolves.toEqual({ ok: true, alreadyDeleted: true });
    const logs = fake.writesTo("operationLogs/").map((item) => item.data.type);
    expect(logs).not.toContain("team_delete");
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("concurrent"), expect.any(Object));
  });

  test("保持不處理：子集合、events、tournaments、teamExpLogs 等一律不碰（A 現況也沒有）", async () => {
    const docs = seedDocs({
      [`${TEAM_PATH}/feed/f1`]: { text: "動態" },
      [`${TEAM_PATH}/students/s1`]: { id: "s1" },
      "events/e1": { id: "e1", creatorTeamIds: [TEAM] },
      "tournaments/t1": { id: "t1", hostTeamId: TEAM },
      "teamExpLogs/l1": { teamId: TEAM },
    });
    const { call, fake } = setup({ docs });
    await call();
    const touched = new Set(fake.state.writes.map((item) => item.path.split("/")[0]));
    expect([...touched].sort()).toEqual(["operationLogs", "teams", "users"]);
    expect(fake.state.writes.filter((item) => item.path.startsWith("teams/")).map((item) => item.path)).toEqual([TEAM_PATH]);
    [`${TEAM_PATH}/feed/f1`, `${TEAM_PATH}/students/s1`, "events/e1", "tournaments/t1", "teamExpLogs/l1"].forEach((path) => {
      expect(fake.has(path)).toBe(true);
    });
    expect(fake.get("events/e1").creatorTeamIds).toEqual([TEAM]);
  });

  test("非預期錯誤 → internal TEAM_DELETE_FAILED，log 帶 phase 與遮罩後的 teamId", async () => {
    const logger = createLogger();
    const { call, fake } = setup({ logger });
    fake.state.failCommit = () => new Error("boom");
    expect(await rejection(call())).toMatchObject({ code: "internal", message: "TEAM_DELETE_FAILED" });
    const [, context] = logger.error.mock.calls[0];
    expect(context).toMatchObject({ phase: "clean-members", callerUid: "U-cap" });
    expect(context.teamId).not.toBe(TEAM);
  });
});
