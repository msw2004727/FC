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
  normalizeRole,
} = require("./team-callable-fake-db");

const TEAM = "tm_del";
const TEAM_PATH = `teams/${TEAM}`;
const DEFAULT_TEMPLATES = [{
  key: "role_upgrade",
  title: "身份變更通知",
  body: "恭喜 {userName}！您的身份已變更為「{roleName}」。",
}];

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

function setup({
  docs = seedDocs(),
  access = createAccess({ role: "captain" }),
  logger = createLogger(),
  templates = DEFAULT_TEMPLATES,
  ensureAuthUser = jest.fn(async () => null),
  setRoleClaimMerged = jest.fn(async () => null),
} = {}) {
  const fake = createFakeFirestore(docs);
  const getCallerAccessContext = jest.fn(async () => access);
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
  const call = (data = { teamId: TEAM }, uid = "U-cap") => handler({ auth: uid ? { uid } : undefined, data });
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
  ["U-cap", "U-lead", "U-coach"].forEach((uid) => {
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

describe("isFrontendTeamDeleter（A _canEditTeamByRoleOrCaptain）", () => {
  const team = { captainUid: "U-cap", creatorUid: " U-creator ", ownerUid: "U-owner", leaderUids: ["U-lead"], coachUids: ["U-coach"] };
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
});

describe("deleteTeam 輸入與查無 team", () => {
  test("未登入 → unauthenticated", async () => {
    const { call, fake } = setup();
    expect(await rejection(call({ teamId: TEAM }, null))).toMatchObject({ code: "unauthenticated" });
    expect(fake.state.writes).toHaveLength(0);
  });

  test.each([[{}], [{ teamId: "" }], [{ teamId: "a/b" }], [{ teamId: "x".repeat(129) }], [{ teamId: 5 }], [null]])(
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

  test("team.manage_all 但 users.role=user → COACH_PLUS_REQUIRED", async () => {
    const { call, fake } = setup({ access: createAccess({ role: "user", permissions: ["team.manage_all"] }) });
    expect(await rejection(call({ teamId: TEAM }, "U-mgr"))).toMatchObject({ message: "COACH_PLUS_REQUIRED" });
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

  test("1000 名成員（含只有舊 teamId 者）：分頁讀完、每批 ≤450、每人只寫一次", async () => {
    const { call, fake } = setup({ docs: manyMembers(1000) });
    const result = await call();
    expect(result).toMatchObject({ cleanedMembers: 1000, roleChanges: 3 });
    // Phase 1 三批（≤450）→ 三位幹部各一批（角色＋站內信＋opLog）→ 最後一批（opLog＋刪 team）
    expect(fake.state.commits.map((item) => item.size)).toEqual([450, 450, 100, 3, 3, 3, 2]);
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

describe("deleteTeam Phase 2／3：幹部角色重算（排除本隊）與站內信", () => {
  test("只在本隊任職 → 降為一般用戶；同一個 batch 寫角色、站內信、opLog；先改 claim 再改文件", async () => {
    const docs = withoutStaffMembership(seedDocs());
    const claimSeen = [];
    const fakeHolder = {};
    const setRoleClaimMerged = jest.fn(async (uid, role) => {
      claimSeen.push([uid, role, fakeHolder.fake.get(`users/${uid}`).role]);
    });
    const ctx = setup({ docs, setRoleClaimMerged });
    fakeHolder.fake = ctx.fake;
    const result = await ctx.call();
    expect(result).toMatchObject({ roleChanges: 3, roleSkipped: 0 });
    expect(ctx.ensureAuthUser.mock.calls.map(([uid]) => uid)).toEqual(["U-cap", "U-lead", "U-coach"]);
    // claim 設定當下，文件角色仍是舊的（文件在 claim 之後才改）
    expect(claimSeen).toEqual([["U-cap", "user", "captain"], ["U-lead", "user", "coach"], ["U-coach", "user", "coach"]]);
    ["U-cap", "U-lead", "U-coach"].forEach((uid) => expect(ctx.fake.get(`users/${uid}`).role).toBe("user"));

    const writes = ctx.fake.state.writes;
    const first = writes.findIndex((item) => item.path === "users/U-cap");
    expect(writes.slice(first, first + 3).map((item) => [item.op, item.path.replace(/(inbox\/msg_|operationLogs\/op_).*/, "$1*")]))
      .toEqual([["update", "users/U-cap"], ["set", "users/U-cap/inbox/msg_*"], ["set", "operationLogs/op_*"]]);
    expect(writes[first].data).toEqual({ role: "user", updatedAt: "SERVER_TS" });
  });

  test("站內信沿用 A 的 role_upgrade 樣板，不新增文案；opLog 為「角色變更」且不含 UID", async () => {
    const { call, fake } = setup({ docs: withoutStaffMembership(seedDocs()) });
    await call();
    const [inboxId] = fake.list("users/U-cap/inbox");
    expect(fake.get(`users/U-cap/inbox/${inboxId}`)).toMatchObject({
      title: "身份變更通知",
      body: "恭喜 隊長！您的身份已變更為「一般用戶」。",
      type: "private",
      typeName: "私訊",
      senderName: "系統",
      read: false,
      createdAt: "SERVER_TS",
    });
    const roleLogs = fake.writesTo("operationLogs/").map((item) => item.data).filter((item) => item.type === "role");
    expect(roleLogs).toHaveLength(3);
    expect(roleLogs[0]).toMatchObject({
      typeName: "角色變更", content: "隊長 自動調整為「一般用戶」（原：領隊）", actorUid: "U-cap", source: "callable",
    });
    roleLogs.forEach((item) => expect(item.content).not.toMatch(/U-/));
  });

  test("Firestore 的 notifTemplates/role_upgrade 優先於內建預設", async () => {
    const docs = withoutStaffMembership(seedDocs({
      "notifTemplates/role_upgrade": { key: "role_upgrade", title: "自訂標題", body: "{userName} 現為 {roleName}" },
    }));
    const { call, fake } = setup({ docs });
    await call();
    const [inboxId] = fake.list("users/U-cap/inbox");
    expect(fake.get(`users/U-cap/inbox/${inboxId}`)).toMatchObject({ title: "自訂標題", body: "隊長 現為 一般用戶" });
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
    await expect(call()).resolves.toMatchObject({ roleChanges: 2 });
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
    const [inboxId] = fake.list("users/U-cap/inbox");
    expect(fake.get(`users/U-cap/inbox/${inboxId}`).body).toContain("教練");
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
    await expect(call()).resolves.toMatchObject({ roleChanges: 2 });
    expect(fake.get("users/U-cap").role).toBe(before);
    expect(fake.list("users/U-cap/inbox")).toEqual([]);
  });

  test("角色已是目標（no_change）→ 不寫、不發通知，也不碰 Auth", async () => {
    const docs = withoutStaffMembership(seedDocs());
    docs["users/U-cap"] = { ...docs["users/U-cap"], role: "user" };
    const { call, fake, ensureAuthUser } = setup({ docs });
    await expect(call()).resolves.toMatchObject({ roleChanges: 2 });
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
    expect(ensureAuthUser.mock.calls.map(([uid]) => uid)).toEqual(["U-cap", "U-lead", "U-coach"]);
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
    expect(fake.state.commits[fake.state.commits.length - 1].size).toBe(2);
  });

  test("Phase 2 失敗 → team 仍在、已清的成員不回復、角色未動；修好後重跑完成", async () => {
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
      expect.objectContaining({ phase: "recalculate-roles", cleanedMembers: 5, code: "internal" }),
    );

    const result = await call();
    expect(result).toMatchObject({ ok: true, cleanedMembers: 0, roleChanges: 3 });
    expect(fake.has(TEAM_PATH)).toBe(false);
  });

  test("最後一批（opLog＋刪 team）失敗 → 重跑不重發通知、不重複降級，最終 team_delete 只有一筆", async () => {
    const { call, fake } = setup();
    fake.state.failCommit = ({ ops }) => (ops.some((item) => item.op === "delete") ? new FakeFirestoreError(14, "UNAVAILABLE") : null);
    expect(await rejection(call())).toMatchObject({ code: "internal" });
    expect(fake.has(TEAM_PATH)).toBe(true);
    expect(fake.list("users/U-cap/inbox")).toHaveLength(1);

    fake.state.failCommit = null;
    await expect(call()).resolves.toMatchObject({ ok: true, cleanedMembers: 0, roleChanges: 0 });
    expect(fake.has(TEAM_PATH)).toBe(false);
    ["U-cap", "U-lead", "U-coach"].forEach((uid) => expect(fake.list(`users/${uid}/inbox`)).toHaveLength(1));
    const logs = fake.writesTo("operationLogs/").map((item) => item.data.type);
    expect(logs.filter((type) => type === "team_delete")).toHaveLength(1);
    expect(logs.filter((type) => type === "role")).toHaveLength(3);
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
