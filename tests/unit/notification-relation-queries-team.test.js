"use strict";

/**
 * 通知發送授權強化（第 2 批）：R3／R4／R5 俱樂部關係查詢。
 * 隊伍一律以文件 id 為準：id 欄位不一致或只有 where("id") 能找到的視為查無，不得用來授權。
 */

const { createRelationQueries } = require("../../functions/notification-relation-queries");
const { createMemoryDb, createHelpers, makeCtx } = require("./notification-relation-test-kit");

const boom = () => Object.assign(new Error("14 UNAVAILABLE"), { code: 14 });
const TEAM = {
  id: "t1",
  captainUid: "uidCap",
  creatorUid: "uidCre",
  ownerUid: "uidOwn",
  leaderUids: ["uidLead"],
  coachUids: ["uidCoach"],
};

function setup(seed = {}, faults = {}) {
  const db = createMemoryDb({ seed: { "teams/t1": TEAM, ...seed }, faults });
  const helpers = createHelpers({ db, legacyDefaults: {} });
  return { db, queries: createRelationQueries({ db, helpers }) };
}

describe("callerIsApplicant", () => {
  const { queries } = setup();
  test("請求帶的申請人等於呼叫者：通過；不是呼叫者：拒絕", async () => {
    const base = { source: "team_join_request", keys: { teamId: "t1" }, callerUid: "uidA" };
    expect(await queries.callerIsApplicant(makeCtx({ ...base, extra: { applicantUid: "uidA" } }))).toBe(true);
    expect(await queries.callerIsApplicant(makeCtx({ ...base, extra: { applicantUid: "uidB" } }))).toBe(false);
    expect(await queries.callerIsApplicant(makeCtx({ ...base, keys: { teamId: "t1", applicantUid: "uidB" } }))).toBe(false);
  });
  test("請求沒帶申請人 uid：視為呼叫者本人發起（沒有申請文件可驗）；沒有呼叫者則拒絕", async () => {
    expect(await queries.callerIsApplicant(makeCtx({ source: "team_join_request", keys: { teamId: "t1" } }))).toBe(true);
    expect(await queries.callerIsApplicant(makeCtx({ source: "team_join_request", callerUid: "" }))).toBe(false);
  });
});

describe("recipientIsTeamStaff", () => {
  const ctxFor = (recipientUid, extra = {}) => makeCtx({ source: "team_join_request", keys: { teamId: "t1" }, recipientUid, ...extra });

  test.each(["uidCap", "uidCre", "uidOwn", "uidLead", "uidCoach"])("收件者 %s 是幹部：通過", async (uid) => {
    const { queries } = setup();
    expect(await queries.recipientIsTeamStaff(ctxFor(uid))).toBe(true);
  });

  test("舊欄位 leaderUid（沒有 leaderUids 陣列）也算", async () => {
    const { queries } = setup({ "teams/t1": { id: "t1", leaderUid: "uidOld" } });
    expect(await queries.recipientIsTeamStaff(ctxFor("uidOld"))).toBe(true);
  });

  test("一般成員、陌生人：拒絕", async () => {
    const { queries } = setup();
    expect(await queries.recipientIsTeamStaff(ctxFor("uidMember"))).toBe(false);
  });

  test("LINE 路徑：以 found 的 uid／文件 id 比對幹部欄位", async () => {
    const { queries } = setup();
    expect(await queries.recipientIsTeamStaff(ctxFor("Ulineid", { recipientFound: { docId: "doc1", data: { uid: "uidCap" } } }))).toBe(true);
    expect(await queries.recipientIsTeamStaff(ctxFor("uidCap", { recipientFound: { docId: "docX", data: { uid: "uidZ" } } }))).toBe(false);
  });

  test("隊伍不存在：拒絕", async () => {
    const { queries } = setup();
    expect(await queries.recipientIsTeamStaff(makeCtx({ keys: { teamId: "t404" }, recipientUid: "uidCap" }))).toBe(false);
  });

  test("以文件 id 為準：id 欄位與文件 id 不一致視為查無；只有 where(id) 找得到的也視為查無", async () => {
    const { queries, db } = setup({
      "teams/t2": { id: "tX", captainUid: "uidCap" },
      "teams/docOnly": { id: "t3", captainUid: "uidCap" },
    });
    expect(await queries.recipientIsTeamStaff(makeCtx({ keys: { teamId: "t2" }, recipientUid: "uidCap" }))).toBe(false);
    expect(await queries.recipientIsTeamStaff(makeCtx({ keys: { teamId: "t3" }, recipientUid: "uidCap" }))).toBe(false);
    expect(db.reads.some((item) => item.startsWith("query:teams"))).toBe(false);
  });

  test("teamId 含 / 或空：false，不丟 TypeError", async () => {
    const { queries } = setup();
    expect(await queries.recipientIsTeamStaff(makeCtx({ keys: { teamId: "a/b" }, recipientUid: "uidCap" }))).toBe(false);
    expect(await queries.recipientIsTeamStaff(makeCtx({ keys: {}, recipientUid: "uidCap" }))).toBe(false);
  });

  test("讀取丟錯：往外丟", async () => {
    const { queries } = setup({}, { get: (path) => (path === "teams/t1" ? boom() : null) });
    await expect(queries.recipientIsTeamStaff(ctxFor("uidCap"))).rejects.toThrow("UNAVAILABLE");
  });
});

describe("callerMayReviewJoin", () => {
  const ctxFor = (callerUid, extra = {}) => makeCtx({
    source: "team_join_review:approve", keys: { teamId: "t1", applicantUid: "uidB" }, callerUid, ...extra,
  });

  test("幹部 + team.review_join（Rules 對齊）：通過；team.manage.entry 也可", async () => {
    for (const code of ["team.review_join", "team.manage.entry"]) {
      const { queries } = setup({ "rolePermissions/captain": { permissions: [code] } });
      expect(await queries.callerMayReviewJoin(ctxFor("uidCap", { callerRole: "captain" }))).toBe(true);
    }
  });

  test("幹部但沒有權限碼（文件缺漏不回退預設）：拒絕", async () => {
    const { queries } = setup();
    expect(await queries.callerMayReviewJoin(ctxFor("uidCap", { callerRole: "captain" }))).toBe(false);
    const empty = setup({ "rolePermissions/captain": { permissions: ["x.y"] } });
    expect(await empty.queries.callerMayReviewJoin(ctxFor("uidCap", { callerRole: "captain" }))).toBe(false);
  });

  test("有權限碼但不是該隊幹部：拒絕", async () => {
    const { queries } = setup({ "rolePermissions/captain": { permissions: ["team.review_join"] } });
    expect(await queries.callerMayReviewJoin(ctxFor("uidX", { callerRole: "captain" }))).toBe(false);
  });

  test("admin／super_admin 角色：通過，不需幹部欄位也不讀權限文件；但隊伍必須存在", async () => {
    const { queries, db } = setup();
    expect(await queries.callerMayReviewJoin(ctxFor("uidX", { callerRole: "admin" }))).toBe(true);
    expect(await queries.callerMayReviewJoin(ctxFor("uidX", { callerRole: "super_admin" }))).toBe(true);
    expect(db.readsOf("rolePermissions")).toEqual([]);
    expect(await queries.callerMayReviewJoin(makeCtx({ keys: { teamId: "t404" }, callerUid: "uidX", callerRole: "admin" }))).toBe(false);
  });

  test("個別授權（user 角色的幹部）通過", async () => {
    const { queries } = setup({ "userPermissionGrants/uidCoach": { permissions: ["team.review_join"] } });
    expect(await queries.callerMayReviewJoin(ctxFor("uidCoach"))).toBe(true);
  });

  test("讀權限文件丟錯：往外丟", async () => {
    const { queries } = setup({}, { get: (path) => (path.startsWith("userPermissionGrants/") ? boom() : null) });
    await expect(queries.callerMayReviewJoin(ctxFor("uidCap", { callerRole: "captain" }))).rejects.toThrow("UNAVAILABLE");
  });
});

describe("recipientIsReviewTarget", () => {
  test("approve／reject：收件者等於 applicantUid 通過；不等於拒絕；沒有 applicantUid 拒絕", async () => {
    const { queries } = setup();
    const base = { source: "team_join_review:reject", keys: { teamId: "t1", applicantUid: "uidB" } };
    expect(await queries.recipientIsReviewTarget(makeCtx({ ...base, recipientUid: "uidB" }))).toBe(true);
    expect(await queries.recipientIsReviewTarget(makeCtx({ ...base, recipientUid: "uidC" }))).toBe(false);
    expect(await queries.recipientIsReviewTarget(makeCtx({ source: base.source, keys: { teamId: "t1" }, recipientUid: "uidB" }))).toBe(false);
  });

  test("approve：LINE 路徑用 found 的 uid 比對申請人", async () => {
    const { queries } = setup();
    const ctx = makeCtx({
      source: "team_join_review:approve",
      keys: { teamId: "t1", applicantUid: "uidB" },
      recipientUid: "Ulineid",
      recipientFound: { docId: "uidB", data: { uid: "uidB" } },
    });
    expect(await queries.recipientIsReviewTarget(ctx)).toBe(true);
  });

  test("broadcast：收件者是幹部且不是呼叫者通過；一般成員拒絕；呼叫者自己拒絕", async () => {
    const { queries } = setup();
    const base = { source: "team_join_review:broadcast:approve", keys: { teamId: "t1", applicantUid: "uidB" }, callerUid: "uidCap" };
    expect(await queries.recipientIsReviewTarget(makeCtx({ ...base, recipientUid: "uidLead" }))).toBe(true);
    expect(await queries.recipientIsReviewTarget(makeCtx({ ...base, recipientUid: "uidMember" }))).toBe(false);
    expect(await queries.recipientIsReviewTarget(makeCtx({ ...base, recipientUid: "uidCap" }))).toBe(false);
  });

  test("broadcast：隊伍不存在拒絕；讀取丟錯往外丟", async () => {
    const { queries } = setup();
    const base = { source: "team_join_review:broadcast:reject", callerUid: "uidCap", recipientUid: "uidLead" };
    expect(await queries.recipientIsReviewTarget(makeCtx({ ...base, keys: { teamId: "t404", applicantUid: "uidB" } }))).toBe(false);
    const broken = setup({}, { get: (path) => (path === "teams/t1" ? boom() : null) });
    await expect(broken.queries.recipientIsReviewTarget(makeCtx({ ...base, keys: { teamId: "t1", applicantUid: "uidB" } }))).rejects.toThrow("UNAVAILABLE");
  });
});

describe("callerMayAssignTeamRole", () => {
  const ctxFor = (callerUid, extra = {}) => makeCtx({ source: "team_role_assignment:coach", keys: { teamId: "t1" }, callerUid, ...extra });

  test("隊伍幹部（captain／creator／owner／leader／coach 欄位）通過", async () => {
    const { queries } = setup();
    for (const uid of ["uidCap", "uidCre", "uidOwn", "uidLead", "uidCoach"]) {
      expect(await queries.callerMayAssignTeamRole(ctxFor(uid))).toBe(true);
    }
  });

  test("非幹部：沒有 team.manage_all 拒絕；Rules 對齊有 team.manage_all 通過；super_admin 通過", async () => {
    const { queries } = setup({ "rolePermissions/admin": { permissions: ["team.manage_all"] } });
    expect(await queries.callerMayAssignTeamRole(ctxFor("uidX"))).toBe(false);
    expect(await queries.callerMayAssignTeamRole(ctxFor("uidX", { callerRole: "admin" }))).toBe(true);
    expect(await queries.callerMayAssignTeamRole(ctxFor("uidX", { callerRole: "super_admin" }))).toBe(true);
    const noDoc = setup();
    expect(await noDoc.queries.callerMayAssignTeamRole(ctxFor("uidX", { callerRole: "admin" }))).toBe(false);
  });

  test("隊伍不存在：即使有 team.manage_all 也拒絕", async () => {
    const { queries } = setup({ "rolePermissions/admin": { permissions: ["team.manage_all"] } });
    expect(await queries.callerMayAssignTeamRole(makeCtx({ keys: { teamId: "t404" }, callerUid: "uidX", callerRole: "admin" }))).toBe(false);
  });

  test("讀權限文件丟錯：往外丟", async () => {
    const { queries } = setup({}, { get: (path) => (path.startsWith("rolePermissions/") ? boom() : null) });
    await expect(queries.callerMayAssignTeamRole(ctxFor("uidX", { callerRole: "admin" }))).rejects.toThrow("UNAVAILABLE");
  });
});

describe("recipientMatchesAssignment", () => {
  const { queries } = setup({ "teams/t1": { ...TEAM, leaderUids: undefined, leaderUid: "uidOldLead" } });
  const ctxFor = (role, recipientUid, extra = {}) => makeCtx({ source: `team_role_assignment:${role}`, keys: { teamId: "t1" }, recipientUid, ...extra });

  test("captain 對 captainUid；leader 對 leaderUids／leaderUid；coach 對 coachUids", async () => {
    expect(await queries.recipientMatchesAssignment(ctxFor("captain", "uidCap"))).toBe(true);
    expect(await queries.recipientMatchesAssignment(ctxFor("leader", "uidOldLead"))).toBe(true);
    expect(await queries.recipientMatchesAssignment(ctxFor("coach", "uidCoach"))).toBe(true);
    const arr = setup();
    expect(await arr.queries.recipientMatchesAssignment(ctxFor("leader", "uidLead"))).toBe(true);
  });

  test("不在對應欄位：拒絕（教練不能當領隊收件者）", async () => {
    expect(await queries.recipientMatchesAssignment(ctxFor("captain", "uidCoach"))).toBe(false);
    expect(await queries.recipientMatchesAssignment(ctxFor("coach", "uidCap"))).toBe(false);
    expect(await queries.recipientMatchesAssignment(ctxFor("leader", "uidX"))).toBe(false);
  });

  test("member 或未知角色：false（本查詢不處理 member）", async () => {
    expect(await queries.recipientMatchesAssignment(ctxFor("member", "uidCap"))).toBe(false);
    expect(await queries.recipientMatchesAssignment(makeCtx({ source: "template:role_upgrade", keys: { teamId: "t1" }, recipientUid: "uidCap" }))).toBe(false);
  });

  test("template:role_upgrade 角色來自 assignmentRole（ctx 或 keys）", async () => {
    const base = { source: "template:role_upgrade", recipientUid: "uidCap" };
    expect(await queries.recipientMatchesAssignment(makeCtx({ ...base, keys: { teamId: "t1", assignmentRole: "captain" } }))).toBe(true);
    expect(await queries.recipientMatchesAssignment(makeCtx({ ...base, keys: { teamId: "t1" }, assignmentRole: "captain" }))).toBe(true);
  });

  test("LINE 路徑用 found 身分；隊伍不存在拒絕；讀取丟錯往外丟", async () => {
    expect(await queries.recipientMatchesAssignment(ctxFor("captain", "Ulineid", { recipientFound: { docId: "x", data: { uid: "uidCap" } } }))).toBe(true);
    expect(await queries.recipientMatchesAssignment(makeCtx({ source: "team_role_assignment:captain", keys: { teamId: "t404" }, recipientUid: "uidCap" }))).toBe(false);
    const broken = setup({}, { get: (path) => (path === "teams/t1" ? boom() : null) });
    await expect(broken.queries.recipientMatchesAssignment(ctxFor("captain", "uidCap"))).rejects.toThrow("UNAVAILABLE");
  });
});

describe("T-090f 自建俱樂部通知成員守門", () => {
  const assignment = (extra = {}) => makeCtx({
    callerUid: "uidCap", recipientUid: "uidCoach", source: "team_role_assignment:coach",
    keys: { teamId: "t1" }, ...extra,
  });

  test.each([
    ["user-created", "user_capability", false],
    ["management", "admin", true],
    ["legacy", undefined, true],
  ])("%s：非成員幹部通知 %s", async (_name, createdVia, allowed) => {
    const { queries, db } = setup({
      "teams/t1": { ...TEAM, createdVia },
      "users/uidCoach": { teamIds: [] },
    });
    const ctx = assignment({ extra: { createdVia: "admin", teamIds: ["t1"] } });
    expect(await queries.recipientMayReceiveTeamAssignment(ctx)).toBe(allowed);
    expect(await queries.recipientMatchesAssignment(ctx)).toBe(allowed);
    expect(db.readsOf("teams/")).toHaveLength(1);
    expect(db.readsOf("users/")).toHaveLength(createdVia === "user_capability" ? 1 : 0);
  });

  test.each([
    ["empty", { teamIds: [] }, false],
    ["primary only", { teamId: "t1" }, false],
    ["wrong team", { teamIds: ["t2"] }, false],
    ["string instead of list", { teamIds: "t1" }, false],
    ["whitespace", { teamIds: [" t1 "] }, false],
    ["member", { teamIds: ["t1"] }, true],
  ])("只認文件 id 的 teamIds：%s", async (_name, member, allowed) => {
    const { queries } = setup({
      "teams/t1": { ...TEAM, createdVia: "user_capability" },
      "users/uidCoach": member,
    });
    expect(await queries.recipientMatchesAssignment(assignment())).toBe(allowed);
  });

  test.each([true, false])("LINE recipientFound 重用伺服器資料：成員 %s，零新增 users 讀取", async (member) => {
    const { queries, db } = setup({
      "teams/t1": { ...TEAM, createdVia: "user_capability" },
      "users/uidCoach": { teamIds: member ? [] : ["t1"] },
    });
    const ctx = assignment({ recipientUid: "Uline",
      recipientFound: { docId: "uidCoach", data: { uid: "uidCoach", teamIds: member ? ["t1"] : [] } } });
    expect(await queries.recipientMayReceiveTeamAssignment(ctx)).toBe(member);
    expect(await queries.recipientMatchesAssignment(ctx)).toBe(member);
    expect(db.readsOf("users/")).toHaveLength(0);
  });

  test("缺 users 文件靜默拒收；讀取錯誤仍往外丟，不能當通過", async () => {
    const seed = { "teams/t1": { ...TEAM, createdVia: "user_capability" } };
    expect(await setup(seed).queries.recipientMayReceiveTeamAssignment(assignment())).toBe(false);
    const broken = setup(seed, { get: (path) => path === "users/uidCoach" ? boom() : null });
    await expect(broken.queries.recipientMayReceiveTeamAssignment(assignment())).rejects.toThrow("UNAVAILABLE");
  });

  test.each(["captainUid", "creatorUid", "ownerUid"])("入隊審核通知：%s 本人免權限讀取", async (field) => {
    const { queries, db } = setup({ "teams/t1": { createdVia: "user_capability", [field]: "uidA" } });
    expect(await queries.callerMayReviewJoin(makeCtx({ keys: { teamId: "t1" } }))).toBe(true);
    expect(db.reads).toEqual(["get:teams/t1"]);
  });

  test.each([
    ["非本隊", { createdVia: "user_capability", ownerUid: "uidOther" }],
    ["僅教練", { createdVia: "user_capability", coachUids: ["uidA"] }],
    ["管理端", { createdVia: "admin", ownerUid: "uidA" }],
    ["legacy", { ownerUid: "uidA" }],
    ["空白 UID", { createdVia: "user_capability", ownerUid: " uidA " }],
  ])("入隊審核通知：%s 無權限仍拒絕，請求偽造 owner 無效", async (_name, team) => {
    const { queries } = setup({ "teams/t1": team });
    expect(await queries.callerMayReviewJoin(makeCtx({
      keys: { teamId: "t1", ownerUid: "uidA", createdVia: "user_capability" },
      extra: { ownerUid: "uidA", createdVia: "user_capability" },
    }))).toBe(false);
  });
});
