"use strict";

/**
 * 通知發送授權強化（第 2 批）：關係查詢（R0／R1／R6／R7 與共用行為）。
 * R3／R4／R5 見 notification-relation-queries-team.test.js；R8 見 notification-relation-queries-tournament.test.js。
 */

const { createRelationQueries } = require("../../functions/notification-relation-queries");
const { createMemoryDb, createHelpers, makeCtx } = require("./notification-relation-test-kit");

const DEFAULTS = {
  admin: ["admin.messages.compose", "admin.messages.entry", "admin.users.change_role", "event.edit_all"],
};
const boom = () => Object.assign(new Error("14 UNAVAILABLE"), { code: 14 });

function setup(seed = {}, faults = {}) {
  const db = createMemoryDb({ seed, faults });
  const helpers = createHelpers({ db, legacyDefaults: DEFAULTS });
  return { db, queries: createRelationQueries({ db, helpers }) };
}

describe("createRelationQueries 介面", () => {
  test("匯出的鍵涵蓋關係表用到的所有查詢函式名與 R6 差距判斷", () => {
    const { queries } = setup();
    [
      "callerIsAuthenticated", "recipientIsCaller", "callerMayManageEvent", "recipientHasActiveRegistration",
      "callerIsApplicant", "recipientIsTeamStaff", "callerMayReviewJoin", "recipientIsReviewTarget",
      "callerMayAssignTeamRole", "recipientMatchesAssignment", "callerHasBroadcastPermission",
      "recipientRoleIsAdmin", "callerMatchesTournamentSource", "recipientInTournamentAudience",
      "callerBroadcastPermissionGap",
    ].forEach((name) => expect(typeof queries[name]).toBe("function"));
  });

  test("ctx 缺欄位時回 false 而不是丟 TypeError", async () => {
    const { queries } = setup();
    expect(await queries.callerIsAuthenticated(undefined)).toBe(false);
    expect(await queries.recipientIsCaller({})).toBe(false);
    expect(await queries.callerMayManageEvent({})).toBe(false);
  });
});

describe("callerIsAuthenticated", () => {
  test("有呼叫者 uid 才成立", async () => {
    const { queries } = setup();
    expect(await queries.callerIsAuthenticated(makeCtx())).toBe(true);
    expect(await queries.callerIsAuthenticated(makeCtx({ callerUid: "  " }))).toBe(false);
    expect(await queries.callerIsAuthenticated(makeCtx({ callerUid: null }))).toBe(false);
  });
});

describe("recipientIsCaller", () => {
  const { queries } = setup();

  test("found 文件 id 是呼叫者：通過", async () => {
    const ctx = makeCtx({ recipientUid: "Ulineid", recipientFound: { docId: "uidA", data: { uid: "other" } } });
    expect(await queries.recipientIsCaller(ctx)).toBe(true);
  });

  test("佇列 uid 是 lineUserId（不等於 auth.uid），但 found.data.uid 是本人：仍通過", async () => {
    const ctx = makeCtx({ recipientUid: "Ulineid", recipientFound: { docId: "doc1", data: { uid: "uidA", lineUserId: "Ulineid" } } });
    expect(await queries.recipientIsCaller(ctx)).toBe(true);
  });

  test("別人的文件：拒絕", async () => {
    const ctx = makeCtx({ recipientUid: "uidB", recipientFound: { docId: "uidB", data: { uid: "uidB" } } });
    expect(await queries.recipientIsCaller(ctx)).toBe(false);
  });

  test("站內信沒有 found：用請求的 recipientUid 比對", async () => {
    expect(await queries.recipientIsCaller(makeCtx({ recipientUid: "uidA" }))).toBe(true);
    expect(await queries.recipientIsCaller(makeCtx({ recipientUid: "uidB" }))).toBe(false);
  });

  test("呼叫者空白一律 false，不會因為雙方都是空字串而通過", async () => {
    const ctx = makeCtx({ callerUid: "", recipientUid: "", recipientFound: { docId: "", data: { uid: "" } } });
    expect(await queries.recipientIsCaller(ctx)).toBe(false);
  });
});

describe("recipientRoleIsAdmin", () => {
  test("LINE：用 found.data.role，admin／super_admin 通過、user 拒絕、沒有 role 拒絕", async () => {
    const { queries, db } = setup();
    const withRole = (role) => makeCtx({ recipientFound: { docId: "uidB", data: role === undefined ? {} : { role } } });
    expect(await queries.recipientRoleIsAdmin(withRole("admin"))).toBe(true);
    expect(await queries.recipientRoleIsAdmin(withRole("super_admin"))).toBe(true);
    expect(await queries.recipientRoleIsAdmin(withRole("user"))).toBe(false);
    expect(await queries.recipientRoleIsAdmin(withRole("coach"))).toBe(false);
    expect(await queries.recipientRoleIsAdmin(withRole(undefined))).toBe(false);
    expect(db.reads).toEqual([]);
  });

  test("站內信：讀 users/{recipientUid}；查無或非 admin 拒絕", async () => {
    const { queries } = setup({
      "users/uidAdmin": { role: "admin" },
      "users/uidUser": { role: "user" },
    });
    expect(await queries.recipientRoleIsAdmin(makeCtx({ recipientUid: "uidAdmin" }))).toBe(true);
    expect(await queries.recipientRoleIsAdmin(makeCtx({ recipientUid: "uidUser" }))).toBe(false);
    expect(await queries.recipientRoleIsAdmin(makeCtx({ recipientUid: "uidGhost" }))).toBe(false);
    expect(await queries.recipientRoleIsAdmin(makeCtx({ recipientUid: "a/b" }))).toBe(false);
  });

  test("讀取丟錯：往外丟（交給決策層轉 deny），不吞成 false", async () => {
    const { queries } = setup({ "users/uidAdmin": { role: "admin" } }, { get: (path) => (path === "users/uidAdmin" ? boom() : null) });
    await expect(queries.recipientRoleIsAdmin(makeCtx({ recipientUid: "uidAdmin" }))).rejects.toThrow("UNAVAILABLE");
  });
});

describe("callerMayManageEvent", () => {
  const baseEvent = { id: "ev1", creatorUid: "uidC", ownerUid: "uidO", captainUid: "uidK", delegateUids: ["uidD"] };
  const ctxFor = (callerUid, extra = {}) => makeCtx({ source: "template:event_changed", keys: { eventId: "ev1" }, callerUid, ...extra });

  test("creatorUid／ownerUid／captainUid／delegateUids 含呼叫者：通過，且不讀權限文件", async () => {
    const { queries, db } = setup({ "events/ev1": baseEvent });
    for (const uid of ["uidC", "uidO", "uidK", "uidD"]) {
      expect(await queries.callerMayManageEvent(ctxFor(uid))).toBe(true);
    }
    expect(db.readsOf("rolePermissions")).toEqual([]);
  });

  test("只有 delegates[].uid、沒有 delegateUids：拒絕", async () => {
    const { queries } = setup({ "events/ev1": { id: "ev1", creatorUid: "uidC", delegates: [{ uid: "uidD", name: "D" }] } });
    expect(await queries.callerMayManageEvent(ctxFor("uidD"))).toBe(false);
  });

  test("陌生人、活動不存在、id 欄位對不上：拒絕", async () => {
    const { queries } = setup({ "events/ev1": baseEvent, "events/ev2": { id: "other" } });
    expect(await queries.callerMayManageEvent(ctxFor("uidX"))).toBe(false);
    expect(await queries.callerMayManageEvent(makeCtx({ keys: { eventId: "ev404" }, callerUid: "uidC" }))).toBe(false);
    expect(await queries.callerMayManageEvent(makeCtx({ keys: { eventId: "ev2" }, callerUid: "uidC" }))).toBe(false);
  });

  test("Rules 對齊的 event.edit_all：admin 通過；只靠預設回退（沒有 rolePermissions 文件）不通過", async () => {
    const { queries } = setup({
      "events/ev1": baseEvent,
      "rolePermissions/admin": { permissions: ["event.edit_all"] },
    });
    expect(await queries.callerMayManageEvent(ctxFor("uidX", { callerRole: "admin" }))).toBe(true);
    const noDoc = setup({ "events/ev1": baseEvent });
    expect(await noDoc.queries.callerMayManageEvent(ctxFor("uidX", { callerRole: "admin" }))).toBe(false);
    const noPerm = setup({ "events/ev1": baseEvent, "rolePermissions/admin": { permissions: ["x.y"] } });
    expect(await noPerm.queries.callerMayManageEvent(ctxFor("uidX", { callerRole: "admin" }))).toBe(false);
  });

  test("個別授權 userPermissionGrants 含 event.edit_all 也通過；enabled:false 不通過", async () => {
    const on = setup({ "events/ev1": baseEvent, "userPermissionGrants/uidX": { permissions: ["event.edit_all"] } });
    expect(await on.queries.callerMayManageEvent(ctxFor("uidX"))).toBe(true);
    const off = setup({ "events/ev1": baseEvent, "userPermissionGrants/uidX": { permissions: ["event.edit_all"], enabled: false } });
    expect(await off.queries.callerMayManageEvent(ctxFor("uidX"))).toBe(false);
  });

  test("super_admin 放行（不需權限文件）", async () => {
    const { queries } = setup({ "events/ev1": baseEvent });
    expect(await queries.callerMayManageEvent(ctxFor("uidX", { callerRole: "super_admin" }))).toBe(true);
  });

  test("私人活動：有 edit_all 但非 admin 以上、非擁有者／委託人：拒絕；admin 以上通過", async () => {
    const seed = {
      "events/ev1": { ...baseEvent, privateEvent: true },
      "rolePermissions/coach": { permissions: ["event.edit_all"] },
      "rolePermissions/admin": { permissions: ["event.edit_all"] },
    };
    const { queries } = setup(seed);
    expect(await queries.callerMayManageEvent(ctxFor("uidX", { callerRole: "coach" }))).toBe(false);
    expect(await queries.callerMayManageEvent(ctxFor("uidX", { callerRole: "admin" }))).toBe(true);
    // 擁有者／委託人在私人活動仍通過
    expect(await queries.callerMayManageEvent(ctxFor("uidD"))).toBe(true);
  });

  test("讀活動丟錯、讀權限文件丟錯：都往外丟", async () => {
    const evErr = setup({ "events/ev1": baseEvent }, { get: (path) => (path === "events/ev1" ? boom() : null) });
    await expect(evErr.queries.callerMayManageEvent(ctxFor("uidC"))).rejects.toThrow("UNAVAILABLE");
    const permErr = setup({ "events/ev1": baseEvent }, { get: (path) => (path.startsWith("rolePermissions/") ? boom() : null) });
    await expect(permErr.queries.callerMayManageEvent(ctxFor("uidX", { callerRole: "admin" }))).rejects.toThrow("UNAVAILABLE");
  });

  test("沒有 eventId 或呼叫者：false，不讀資料庫", async () => {
    const { queries, db } = setup({ "events/ev1": baseEvent });
    expect(await queries.callerMayManageEvent(makeCtx({ keys: {} }))).toBe(false);
    expect(await queries.callerMayManageEvent(ctxFor(""))).toBe(false);
    expect(db.reads).toEqual([]);
  });
});

describe("recipientHasActiveRegistration", () => {
  const ctxFor = (recipientUid, extra = {}) => makeCtx({ source: "template:event_changed", keys: { eventId: "ev1" }, recipientUid, ...extra });
  const event = { "events/ev1": { id: "ev1" } };

  test.each(["confirmed", "waitlisted"])("userId 對得上且 status=%s：通過", async (status) => {
    const { queries } = setup({ ...event, "events/ev1/registrations/r1": { userId: "uidB", status } });
    expect(await queries.recipientHasActiveRegistration(ctxFor("uidB"))).toBe(true);
  });

  test.each(["cancelled", "removed", "pending", undefined])("status=%s：拒絕", async (status) => {
    const { queries } = setup({ ...event, "events/ev1/registrations/r1": { userId: "uidB", status } });
    expect(await queries.recipientHasActiveRegistration(ctxFor("uidB"))).toBe(false);
  });

  test("userId 查無時改查 uid；再查 courseOwnerUids", async () => {
    const byUid = setup({ ...event, "events/ev1/registrations/r1": { uid: "uidB", status: "confirmed" } });
    expect(await byUid.queries.recipientHasActiveRegistration(ctxFor("uidB"))).toBe(true);
    const byOwner = setup({ ...event, "events/ev1/registrations/r1": { courseOwnerUids: ["uidB"], status: "waitlisted" } });
    expect(await byOwner.queries.recipientHasActiveRegistration(ctxFor("uidB"))).toBe(true);
  });

  test("userId 那筆已取消、uid 那筆有效：仍通過（不因第一個欄位非空就停）", async () => {
    const { queries } = setup({
      ...event,
      "events/ev1/registrations/r1": { userId: "uidB", status: "cancelled" },
      "events/ev1/registrations/r2": { uid: "uidB", status: "confirmed" },
    });
    expect(await queries.recipientHasActiveRegistration(ctxFor("uidB"))).toBe(true);
  });

  test("別人的報名、別場活動的報名：拒絕；活動不存在：拒絕", async () => {
    const { queries } = setup({
      ...event,
      "events/ev1/registrations/r1": { userId: "uidC", status: "confirmed" },
      "events/ev2": { id: "ev2" },
      "events/ev2/registrations/r1": { userId: "uidB", status: "confirmed" },
    });
    expect(await queries.recipientHasActiveRegistration(ctxFor("uidB"))).toBe(false);
    expect(await queries.recipientHasActiveRegistration(makeCtx({ keys: { eventId: "ev404" }, recipientUid: "uidB" }))).toBe(false);
  });

  test("LINE 路徑：佇列 uid 是 lineUserId，以 found 的 uid／文件 id 找報名；不查根集合 registrations", async () => {
    const { queries, db } = setup({ ...event, "events/ev1/registrations/r1": { userId: "uidB", status: "confirmed" } });
    const ctx = ctxFor("Ulineid", { recipientFound: { docId: "uidB", data: { uid: "uidB" } } });
    expect(await queries.recipientHasActiveRegistration(ctx)).toBe(true);
    expect(db.reads.some((item) => /^query:registrations/.test(item) || item.startsWith("get:registrations"))).toBe(false);
  });

  test("查詢丟錯：往外丟", async () => {
    const { queries } = setup(
      { ...event, "events/ev1/registrations/r1": { userId: "uidB", status: "confirmed" } },
      { query: (path) => (path.endsWith("/registrations") ? boom() : null) },
    );
    await expect(queries.recipientHasActiveRegistration(ctxFor("uidB"))).rejects.toThrow("UNAVAILABLE");
  });

  test("沒有收件者身分：false", async () => {
    const { queries } = setup(event);
    expect(await queries.recipientHasActiveRegistration(ctxFor(""))).toBe(false);
  });
});

describe("R6 callerHasBroadcastPermission／callerBroadcastPermissionGap", () => {
  const target = (extra = {}) => makeCtx({ source: "target:all", callerRole: "admin", ...extra });

  test("rolePermissions/admin 含 admin.messages.compose 或 entry：對齊通過，不算差距", async () => {
    for (const code of ["admin.messages.compose", "admin.messages.entry"]) {
      const { queries } = setup({ "rolePermissions/admin": { permissions: [code] } });
      expect(await queries.callerHasBroadcastPermission(target())).toBe(true);
      expect(await queries.callerBroadcastPermissionGap(target())).toBe(false);
    }
  });

  test("個別授權通過；enabled:false 不通過；user 角色沒有角色層權限", async () => {
    const grant = setup({ "userPermissionGrants/uidA": { permissions: ["admin.messages.compose"] } });
    expect(await grant.queries.callerHasBroadcastPermission(target({ callerRole: "user" }))).toBe(true);
    const off = setup({ "userPermissionGrants/uidA": { permissions: ["admin.messages.compose"], enabled: false }, "rolePermissions/user": { permissions: ["admin.messages.compose"] } });
    expect(await off.queries.callerHasBroadcastPermission(target({ callerRole: "user" }))).toBe(false);
  });

  test("super_admin 通過，不需權限文件，也不算差距", async () => {
    const { queries } = setup();
    const ctx = target({ callerRole: "super_admin" });
    expect(await queries.callerHasBroadcastPermission(ctx)).toBe(true);
    expect(await queries.callerBroadcastPermissionGap(ctx)).toBe(false);
  });

  test("文件不存在、舊路徑（預設回退）會過：對齊不過，算差距", async () => {
    const { queries } = setup();
    expect(await queries.callerHasBroadcastPermission(target())).toBe(false);
    expect(await queries.callerBroadcastPermissionGap(target())).toBe(true);
  });

  test("文件存在但沒有 permissions 欄位：對齊不過，舊路徑走預設會過，算差距", async () => {
    const { queries } = setup({ "rolePermissions/admin": { label: "管理員" } });
    expect(await queries.callerHasBroadcastPermission(target())).toBe(false);
    expect(await queries.callerBroadcastPermissionGap(target())).toBe(true);
  });

  test("文件有 permissions 陣列但不含該碼：兩邊都不過，不算差距", async () => {
    const { queries } = setup({ "rolePermissions/admin": { permissions: ["event.edit_all"] } });
    expect(await queries.callerHasBroadcastPermission(target())).toBe(false);
    expect(await queries.callerBroadcastPermissionGap(target())).toBe(false);
  });

  test("template:role_upgrade 看 admin.users.change_role，不看訊息權限", async () => {
    const ok = setup({ "rolePermissions/admin": { permissions: ["admin.users.change_role"] } });
    const ctx = makeCtx({ source: "template:role_upgrade", callerRole: "admin" });
    expect(await ok.queries.callerHasBroadcastPermission(ctx)).toBe(true);
    const wrong = setup({ "rolePermissions/admin": { permissions: ["admin.messages.compose"] } });
    expect(await wrong.queries.callerHasBroadcastPermission(ctx)).toBe(false);
  });

  test("不是 R6 的 source：false（不當權限答案）", async () => {
    const { queries } = setup({ "rolePermissions/admin": { permissions: ["admin.messages.compose"] } });
    expect(await queries.callerHasBroadcastPermission(target({ source: "template:welcome" }))).toBe(false);
    expect(await queries.callerBroadcastPermissionGap(target({ source: "template:welcome" }))).toBe(false);
  });

  test("讀權限文件丟錯：兩個函式都往外丟", async () => {
    const faults = { get: (path) => (path.startsWith("rolePermissions/") ? boom() : null) };
    const { queries } = setup({}, faults);
    await expect(queries.callerHasBroadcastPermission(target())).rejects.toThrow("UNAVAILABLE");
    await expect(queries.callerBroadcastPermissionGap(target())).rejects.toThrow("UNAVAILABLE");
  });

  test("同一個 ctx 重複判斷只讀一次權限文件（對齊結果快取）", async () => {
    const { queries, db } = setup();
    const ctx = target();
    await queries.callerHasBroadcastPermission(ctx);
    await queries.callerBroadcastPermissionGap(ctx);
    // 對齊讀法（grants 文件）只讀一次；舊路徑的 rolePermissions 讀取是另一條獨立路徑
    expect(db.readsOf("get:userPermissionGrants/uidA").length).toBe(1);
  });
});
