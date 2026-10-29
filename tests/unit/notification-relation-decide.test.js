"use strict";

/**
 * 通知發送授權強化（第 2 批）：關係決策 decideRelation。
 * 查詢用 jest.fn 替身，分類與模式用真的 classifyRelation／relationMode（需要時注入 modeOf 驗證 enforce）。
 */

const { decideRelation } = require("../../functions/notification-relation-decide");
const { classifyRelation } = require("../../functions/notification-relation-table");
const { RELATION_ENFORCEMENT } = require("../../functions/notification-relation-enforcement");

const QUERY_NAMES = [
  "callerIsAuthenticated", "recipientIsCaller", "callerMayManageEvent", "recipientHasActiveRegistration",
  "callerIsApplicant", "recipientIsTeamStaff", "callerMayReviewJoin", "recipientIsReviewTarget",
  "callerMayAssignTeamRole", "recipientMatchesAssignment", "callerHasBroadcastPermission",
  "recipientRoleIsAdmin", "callerMatchesTournamentSource", "recipientInTournamentAudience",
  "callerBroadcastPermissionGap",
];

// 預設：除了 gap 以外全部成立；overrides 以 true／false／Error 指定。
function makeQueries(overrides = {}) {
  const queries = {};
  QUERY_NAMES.forEach((name) => {
    const answer = Object.prototype.hasOwnProperty.call(overrides, name)
      ? overrides[name]
      : name !== "callerBroadcastPermissionGap";
    queries[name] = jest.fn(async () => {
      if (answer instanceof Error) throw answer;
      return answer;
    });
  });
  return queries;
}

const boom = () => Object.assign(new Error("14 UNAVAILABLE"), { code: 14 });
const enforceAll = () => "enforce";
const ctxBase = { callerUid: "uidA", callerRole: "user", recipientUid: "uidB", recipientFound: null, extra: {} };

function decide(source, keys, queries, options = {}) {
  return decideRelation({ source, keys, ctx: { ...ctxBase, ...(options.ctx || {}) }, queries, ...(options.inject || {}) });
}

function calledNames(queries) {
  return QUERY_NAMES.filter((name) => queries[name].mock.calls.length > 0);
}

describe("decideRelation 結果形狀", () => {
  test("每種結果都有 outcome／relationId／gate／reason／flags，gate 與 outcome 對應", async () => {
    const cases = [
      [await decide("template:welcome", {}, makeQueries()), "allow", null],
      [await decide("template:event_changed", {}, makeQueries()), "missing_key", "relation_missing_key"],
      [await decide("template:welcome", {}, makeQueries({ recipientIsCaller: false })), "deny", "relation_denied"],
      [await decide("target:all", {}, makeQueries({ callerHasBroadcastPermission: false, callerBroadcastPermissionGap: true })), "gap", "relation_permission_gap"],
      [await decide("template:waitlist_promoted", {}, makeQueries()), "record", "relation_missing_key"],
    ];
    cases.forEach(([result, outcome, gate]) => {
      expect(Object.keys(result).sort()).toEqual(["flags", "gate", "outcome", "reason", "relationId"]);
      expect(result.outcome).toBe(outcome);
      expect(result.gate).toBe(gate);
      expect(typeof result.reason).toBe("string");
      expect(typeof result.flags).toBe("object");
    });
  });

  test("結果不含關聯鍵的值、uid 值（flags 只有有沒有鍵）", async () => {
    const keys = { eventId: "ev-secret-123" };
    const queries = makeQueries({ callerMayManageEvent: false });
    const result = await decide("template:event_changed", keys, queries);
    const text = JSON.stringify(result);
    expect(text).not.toContain("ev-secret-123");
    expect(text).not.toContain("uidA");
    expect(text).not.toContain("uidB");
    expect(result.flags).toEqual({ hasEventId: true });
  });
});

describe("decideRelation 未知 source", () => {
  test("classify 回 null：allow、relationId null、gate null，不查詢", async () => {
    const queries = makeQueries();
    const result = await decide("brand_new_source", {}, queries);
    expect(result).toMatchObject({ outcome: "allow", relationId: null, gate: null });
    expect(calledNames(queries)).toEqual([]);
  });

  test("空白或非字串 source 也是 allow／null（沿用第 1 批只記錄）", async () => {
    expect(await decide("", {}, makeQueries())).toMatchObject({ outcome: "allow", relationId: null, gate: null });
    expect(await decide(undefined, {}, makeQueries())).toMatchObject({ outcome: "allow", relationId: null, gate: null });
  });
});

describe("decideRelation R0／R7（正式 enforce，沒有關聯鍵）", () => {
  const R0_SOURCES = ["client:line-push", "template:welcome", "template:signup_success", "template:cancel_signup", "event_cancel_signup:legacy"];

  test.each(R0_SOURCES)("R0 %s：呼叫者已登入且收件者是本人：allow，先查呼叫者再查收件者", async (source) => {
    const queries = makeQueries();
    const result = await decide(source, {}, queries);
    expect(result).toMatchObject({ outcome: "allow", relationId: "R0", gate: null });
    expect(calledNames(queries)).toEqual(["callerIsAuthenticated", "recipientIsCaller"]);
  });

  test("R0 收件者不是本人：deny（relation_denied）", async () => {
    const result = await decide("template:welcome", {}, makeQueries({ recipientIsCaller: false }));
    expect(result).toMatchObject({ outcome: "deny", relationId: "R0", gate: "relation_denied" });
  });

  test("R0 呼叫者條件不成立：deny，且不再查收件者", async () => {
    const queries = makeQueries({ callerIsAuthenticated: false });
    const result = await decide("client:line-push", {}, queries);
    expect(result.outcome).toBe("deny");
    expect(queries.recipientIsCaller).not.toHaveBeenCalled();
  });

  test("R0 查詢丟錯：deny，不是放行", async () => {
    const result = await decide("template:welcome", {}, makeQueries({ recipientIsCaller: boom() }));
    expect(result).toMatchObject({ outcome: "deny", relationId: "R0", gate: "relation_denied", reason: "query_error" });
  });

  test("查詢丟錯：flags.errCode 是固定格式短代碼（小寫與底線），不含錯誤訊息；沒有字串 code 為 unknown", async () => {
    const coded = (code) => Object.assign(new Error("secret detail uidSecret123"), { code });
    const cases = [["unavailable", "unavailable"], ["permission-denied", "permission_denied"], ["DEADLINE_EXCEEDED", "deadline_exceeded"], [14, "unknown"], ["", "unknown"], ["12345", "unknown"]];
    for (const [code, expected] of cases) {
      const result = await decide("template:welcome", {}, makeQueries({ recipientIsCaller: coded(code) }));
      expect(result).toMatchObject({ outcome: "deny", reason: "query_error", flags: { errCode: expected } });
      expect(JSON.stringify(result)).not.toContain("secret detail");
    }
    const noCode = await decide("template:welcome", {}, makeQueries({ recipientIsCaller: new Error("x") }));
    expect(noCode.flags.errCode).toBe("unknown");
    const longCode = await decide("template:welcome", {}, makeQueries({ recipientIsCaller: coded("a-very-long-error-code-that-keeps-going-forever") }));
    expect(longCode.flags.errCode.length).toBeLessThanOrEqual(24);
  });

  test("errCode 經 relation log 輸出（符合 flags 的固定格式白名單）", () => {
    const { createRelationLogger } = require("../../functions/notification-relation-log");
    const logger = { warn: jest.fn() };
    const log = createRelationLogger({ logger, now: () => 1700000000000 });
    log({ gate: "relation_denied", relationId: "R0", reason: "query_error", flags: { errCode: "permission_denied" } }, { kind: "enqueue", callerUid: "uidA-long-uid-0001", source: "template:welcome" });
    expect(logger.warn).toHaveBeenCalledWith("[notificationGuards] gate triggered", expect.objectContaining({ gate: "relation_denied", reason: "query_error", errCode: "permission_denied" }));
  });

  test("R7 收件者不是 admin：deny；是 admin：allow", async () => {
    for (const source of ["template:role_application", "template:role_application:admins"]) {
      expect(await decide(source, {}, makeQueries({ recipientRoleIsAdmin: false }))).toMatchObject({ outcome: "deny", relationId: "R7" });
      expect(await decide(source, {}, makeQueries())).toMatchObject({ outcome: "allow", relationId: "R7" });
    }
  });

  test("R7 查詢丟錯：deny", async () => {
    const result = await decide("template:role_application", {}, makeQueries({ recipientRoleIsAdmin: boom() }));
    expect(result).toMatchObject({ outcome: "deny", relationId: "R7", reason: "query_error" });
  });

  test("template:event_cancelled 不走 R0（沒有 eventId 時是 R1 的缺鍵，不是 R0 的收件者檢查）", async () => {
    const queries = makeQueries({ recipientIsCaller: false });
    const result = await decide("template:event_cancelled", {}, queries);
    expect(result).toMatchObject({ outcome: "missing_key", relationId: "R1" });
    expect(queries.recipientIsCaller).not.toHaveBeenCalled();
  });
});

describe("客戶端欄位不參與（mode／pool 等）", () => {
  test("payload 帶 mode: log，R0 收件者不是本人仍 deny", async () => {
    const keys = { mode: "log", enforcement: "log", relationMode: "log", pool: "staff" };
    const result = await decide("template:welcome", keys, makeQueries({ recipientIsCaller: false }), {
      ctx: { mode: "log", extra: { mode: "log", enforcement: "log" } },
    });
    expect(result.outcome).toBe("deny");
  });

  test("payload 帶 mode: enforce，R1 缺 eventId 仍只是 missing_key", async () => {
    const result = await decide("template:event_changed", { mode: "enforce" }, makeQueries(), {
      ctx: { mode: "enforce", extra: { mode: "enforce", enforcement: "enforce" } },
    });
    expect(result.outcome).toBe("missing_key");
  });

  test("decideRelation 的頂層參數即使多塞 mode／enforcement 也不改變結果", async () => {
    const result = await decideRelation({
      source: "template:event_changed", keys: {}, ctx: ctxBase, queries: makeQueries(), mode: "enforce", enforcement: "enforce",
    });
    expect(result.outcome).toBe("missing_key");
  });

  test("模式只來自 modeOf(relationId)：以分類 id 呼叫，正式常數與 relationMode 一致", async () => {
    const modeOf = jest.fn(() => "log");
    await decide("template:event_changed", {}, makeQueries(), { inject: { modeOf } });
    expect(modeOf).toHaveBeenCalledWith("R1");
    expect(RELATION_ENFORCEMENT.R1).toBe("log");
  });

  test("modeOf 回傳 enforce 以外的值（含大小寫不同、undefined）一律當 log", async () => {
    for (const odd of ["ENFORCE", undefined, null, 1]) {
      const result = await decide("template:event_changed", {}, makeQueries(), { inject: { modeOf: () => odd } });
      expect(result.outcome).toBe("missing_key");
    }
  });

  test("關聯鍵只取自身屬性：原型上的 eventId 不算有帶鍵", async () => {
    const keys = Object.create({ eventId: "ev1" });
    const result = await decide("template:event_changed", keys, makeQueries());
    expect(result.outcome).toBe("missing_key");
  });

  test("非字串、空白的鍵值當缺鍵", async () => {
    for (const bad of [123, "   ", null, {}, ["ev1"]]) {
      const result = await decide("template:event_changed", { eventId: bad }, makeQueries());
      expect(result.outcome).toBe("missing_key");
    }
  });
});

describe("decideRelation R1（log：缺鍵放行；enforce：缺鍵拒絕）", () => {
  const SOURCES = ["template:event_changed", "template:event_cancelled", "template:event_relisted", "template:waitlist_demoted"];
  const keys = { eventId: "ev1" };

  test.each(SOURCES)("%s 常數 log、缺 eventId：missing_key，gate relation_missing_key，不查詢", async (source) => {
    const queries = makeQueries();
    const result = await decide(source, {}, queries);
    expect(result).toMatchObject({ outcome: "missing_key", relationId: "R1", gate: "relation_missing_key" });
    expect(result.flags).toEqual({ hasEventId: false });
    expect(calledNames(queries)).toEqual([]);
  });

  test("注入常數 enforce：R1 缺 eventId 變 deny", async () => {
    const result = await decide("template:event_changed", {}, makeQueries(), { inject: { modeOf: enforceAll } });
    expect(result).toMatchObject({ outcome: "deny", gate: "relation_denied", reason: "missing_key" });
  });

  test("鍵齊、呼叫者與收件者都成立：allow", async () => {
    const queries = makeQueries();
    const result = await decide("template:event_changed", keys, queries);
    expect(result).toMatchObject({ outcome: "allow", relationId: "R1", gate: null });
    expect(result.flags).toEqual({ hasEventId: true });
    expect(calledNames(queries)).toEqual(["callerMayManageEvent", "recipientHasActiveRegistration"]);
  });

  test("鍵齊、呼叫者不是管理者：兩種 mode 都 deny，不查收件者", async () => {
    for (const inject of [{}, { modeOf: enforceAll }]) {
      const queries = makeQueries({ callerMayManageEvent: false });
      const result = await decide("template:event_changed", keys, queries, { inject });
      expect(result).toMatchObject({ outcome: "deny", gate: "relation_denied", reason: "caller_not_allowed" });
      expect(queries.recipientHasActiveRegistration).not.toHaveBeenCalled();
    }
  });

  test("鍵齊、收件者沒有有效報名：兩種 mode 都 deny", async () => {
    for (const inject of [{}, { modeOf: enforceAll }]) {
      const result = await decide("template:event_changed", keys, makeQueries({ recipientHasActiveRegistration: false }), { inject });
      expect(result).toMatchObject({ outcome: "deny", reason: "recipient_not_in_relation" });
    }
  });

  test("鍵齊、查詢丟錯（呼叫者或收件者那一步）：兩種 mode 都 deny", async () => {
    for (const inject of [{}, { modeOf: enforceAll }]) {
      for (const name of ["callerMayManageEvent", "recipientHasActiveRegistration"]) {
        const result = await decide("template:event_changed", keys, makeQueries({ [name]: boom() }), { inject });
        expect(result).toMatchObject({ outcome: "deny", gate: "relation_denied", reason: "query_error" });
      }
    }
  });

  test("查詢收到的 ctx 帶有 source 與已清理的 keys，不含客戶端多塞的欄位", async () => {
    const queries = makeQueries();
    await decide("template:event_changed", { eventId: "ev1", junk: "x", mode: "log" }, queries);
    const received = queries.callerMayManageEvent.mock.calls[0][0];
    expect(received.source).toBe("template:event_changed");
    expect(received.keys).toEqual({ eventId: "ev1" });
    expect(received.callerUid).toBe("uidA");
  });
});

describe("decideRelation R3／R4／R8（log 缺鍵放行、鍵齊查無拒絕）", () => {
  test("R3 缺 teamId：missing_key；鍵齊：允許、呼叫者不合 deny、收件者不在 deny", async () => {
    expect(await decide("team_join_request", {}, makeQueries())).toMatchObject({ outcome: "missing_key", relationId: "R3" });
    const keys = { teamId: "t1" };
    expect(await decide("team_join_request", keys, makeQueries())).toMatchObject({ outcome: "allow", relationId: "R3" });
    expect(await decide("team_join_request", keys, makeQueries({ callerIsApplicant: false }))).toMatchObject({ outcome: "deny", reason: "caller_not_allowed" });
    expect(await decide("team_join_request", keys, makeQueries({ recipientIsTeamStaff: false }))).toMatchObject({ outcome: "deny", reason: "recipient_not_in_relation" });
    expect(await decide("team_join_request", keys, makeQueries({ recipientIsTeamStaff: boom() }))).toMatchObject({ outcome: "deny", reason: "query_error" });
  });

  test("R4 需要 teamId 與 applicantUid：缺任一個都是 missing_key", async () => {
    const source = "team_join_review:approve";
    for (const keys of [{}, { teamId: "t1" }, { applicantUid: "uidB" }]) {
      const result = await decide(source, keys, makeQueries());
      expect(result).toMatchObject({ outcome: "missing_key", relationId: "R4" });
    }
    const full = { teamId: "t1", applicantUid: "uidB" };
    expect(await decide(source, full, makeQueries())).toMatchObject({ outcome: "allow", relationId: "R4" });
    expect(await decide(source, full, makeQueries({ callerMayReviewJoin: false }))).toMatchObject({ outcome: "deny" });
    expect(await decide(source, full, makeQueries({ recipientIsReviewTarget: false }))).toMatchObject({ outcome: "deny" });
    expect((await decide(source, {}, makeQueries())).flags).toEqual({ hasTeamId: false, hasApplicantUid: false });
  });

  test("R4 四個 source 都歸 R4", async () => {
    for (const source of ["team_join_review:approve", "team_join_review:reject", "team_join_review:broadcast:approve", "team_join_review:broadcast:reject"]) {
      expect((await decide(source, {}, makeQueries())).relationId).toBe("R4");
    }
  });

  test("R8 缺 tournamentId：missing_key；申請類另需 teamId", async () => {
    expect(await decide("tournament_review:approve", {}, makeQueries())).toMatchObject({ outcome: "missing_key", relationId: "R8" });
    expect(await decide("tournament_register_request", { tournamentId: "tr1" }, makeQueries())).toMatchObject({ outcome: "missing_key", relationId: "R8" });
    expect(await decide("tournament_register_request", { tournamentId: "tr1", teamId: "t1" }, makeQueries())).toMatchObject({ outcome: "allow" });
    expect(await decide("tournament_review:approve", { tournamentId: "tr1" }, makeQueries())).toMatchObject({ outcome: "allow" });
  });

  test("R8 呼叫者不合、收件者不在受眾、查詢丟錯：deny", async () => {
    const keys = { tournamentId: "tr1" };
    expect(await decide("tournament_review:approve", keys, makeQueries({ callerMatchesTournamentSource: false }))).toMatchObject({ outcome: "deny", relationId: "R8" });
    expect(await decide("tournament_review:approve", keys, makeQueries({ recipientInTournamentAudience: false }))).toMatchObject({ outcome: "deny" });
    expect(await decide("tournament_review:approve", keys, makeQueries({ callerMatchesTournamentSource: boom() }))).toMatchObject({ outcome: "deny", reason: "query_error" });
  });

  test("R3／R4／R8 注入 enforce 後缺鍵變 deny", async () => {
    for (const [source, keys] of [["team_join_request", {}], ["team_join_review:reject", { teamId: "t1" }], ["tournament_review:approve", {}]]) {
      expect(await decide(source, keys, makeQueries(), { inject: { modeOf: enforceAll } })).toMatchObject({ outcome: "deny", gate: "relation_denied" });
    }
  });
});

describe("decideRelation R5", () => {
  const SOURCES = ["captain", "leader", "coach"].map((role) => `team_role_assignment:${role}`);
  const keys = { teamId: "t1" };

  test.each(SOURCES)("%s 缺 teamId、常數 log：missing_key，不查詢", async (source) => {
    const queries = makeQueries();
    const result = await decide(source, {}, queries);
    expect(result).toMatchObject({ outcome: "missing_key", relationId: "R5" });
    expect(calledNames(queries)).toEqual([]);
  });

  test.each(SOURCES)("%s 鍵齊、收件者在欄位：allow", async (source) => {
    const result = await decide(source, keys, makeQueries());
    expect(result).toMatchObject({ outcome: "allow", relationId: "R5", gate: null });
  });

  test.each(SOURCES)("%s 鍵齊但收件者不在欄位、常數 log：record（放行），relation_missing_key + fieldMismatch，不是 relation_denied", async (source) => {
    const result = await decide(source, keys, makeQueries({ recipientMatchesAssignment: false }));
    expect(result).toMatchObject({ outcome: "record", relationId: "R5", gate: "relation_missing_key", reason: "field_mismatch" });
    expect(result.flags.fieldMismatch).toBe(true);
  });

  test.each(SOURCES)("%s 同一事實注入 enforce：deny", async (source) => {
    const result = await decide(source, keys, makeQueries({ recipientMatchesAssignment: false }), { inject: { modeOf: enforceAll } });
    expect(result).toMatchObject({ outcome: "deny", gate: "relation_denied" });
  });

  test("R5 呼叫者不是幹部：兩種 mode 都 deny（不是欄位不合）；查詢丟錯 deny", async () => {
    for (const inject of [{}, { modeOf: enforceAll }]) {
      const result = await decide(SOURCES[0], keys, makeQueries({ callerMayAssignTeamRole: false }), { inject });
      expect(result).toMatchObject({ outcome: "deny", reason: "caller_not_allowed" });
    }
    expect(await decide(SOURCES[1], keys, makeQueries({ recipientMatchesAssignment: boom() }))).toMatchObject({ outcome: "deny", reason: "query_error" });
  });

  test("決策把指派角色放進 ctx.assignmentRole 交給查詢", async () => {
    const queries = makeQueries();
    await decide("team_role_assignment:leader", keys, queries);
    expect(queries.recipientMatchesAssignment.mock.calls[0][0].assignmentRole).toBe("leader");
  });

  test("member：固定 record，不查詢、有無 teamId 都一樣，注入 enforce 也不拒", async () => {
    for (const k of [{}, keys]) {
      for (const inject of [{}, { modeOf: enforceAll }]) {
        const queries = makeQueries({ callerMayAssignTeamRole: false, recipientMatchesAssignment: false });
        const result = await decide("team_role_assignment:member", k, queries, { inject });
        expect(result).toMatchObject({ outcome: "record", relationId: "R5", gate: "relation_missing_key" });
        expect(result.flags.memberQuery).toBe("unverified");
        expect(calledNames(queries)).toEqual([]);
      }
    }
  });

  test("template:role_upgrade 有 teamId 走 R5；assignmentRole 缺或無效當缺鍵；member 為 record", async () => {
    const source = "template:role_upgrade";
    expect(await decide(source, { teamId: "t1" }, makeQueries())).toMatchObject({ outcome: "missing_key", relationId: "R5" });
    expect((await decide(source, { teamId: "t1" }, makeQueries())).flags).toEqual({ hasTeamId: true, hasAssignmentRole: false });
    expect(await decide(source, { teamId: "t1", assignmentRole: "king" }, makeQueries())).toMatchObject({ outcome: "missing_key" });
    expect(await decide(source, { teamId: "t1", assignmentRole: "captain" }, makeQueries())).toMatchObject({ outcome: "allow", relationId: "R5" });
    expect(await decide(source, { teamId: "t1", assignmentRole: "coach" }, makeQueries({ recipientMatchesAssignment: false }))).toMatchObject({ outcome: "record" });
    expect(await decide(source, { teamId: "t1", assignmentRole: "member" }, makeQueries())).toMatchObject({ outcome: "record" });
  });
});

describe("decideRelation R6", () => {
  const source = "target:all";

  test("Rules 對齊成立：allow，不查差距", async () => {
    const queries = makeQueries();
    const result = await decide(source, {}, queries);
    expect(result).toMatchObject({ outcome: "allow", relationId: "R6", gate: null });
    expect(queries.callerBroadcastPermissionGap).not.toHaveBeenCalled();
  });

  test("舊路徑會過、對齊不會過：gap（放行），gate relation_permission_gap", async () => {
    const queries = makeQueries({ callerHasBroadcastPermission: false, callerBroadcastPermissionGap: true });
    const result = await decide(source, {}, queries);
    expect(result).toMatchObject({ outcome: "gap", relationId: "R6", gate: "relation_permission_gap" });
  });

  test("兩者都不成立（文件有清單但沒有該碼）：log 放行且不是 gap", async () => {
    const queries = makeQueries({ callerHasBroadcastPermission: false, callerBroadcastPermissionGap: false });
    const result = await decide(source, {}, queries);
    expect(result).toMatchObject({ outcome: "allow", relationId: "R6", gate: null });
  });

  test("注入 enforce：對齊不成立時 deny（有無差距都拒）", async () => {
    for (const gap of [true, false]) {
      const queries = makeQueries({ callerHasBroadcastPermission: false, callerBroadcastPermissionGap: gap });
      const result = await decide(source, {}, queries, { inject: { modeOf: enforceAll } });
      expect(result).toMatchObject({ outcome: "deny", gate: "relation_denied" });
    }
    expect((await decide(source, {}, makeQueries(), { inject: { modeOf: enforceAll } })).outcome).toBe("allow");
  });

  test("讀權限文件丟錯（對齊或差距那一步）：deny，不放行", async () => {
    expect(await decide(source, {}, makeQueries({ callerHasBroadcastPermission: boom() }))).toMatchObject({ outcome: "deny", reason: "query_error" });
    const gapErr = makeQueries({ callerHasBroadcastPermission: false, callerBroadcastPermissionGap: boom() });
    expect(await decide(source, {}, gapErr)).toMatchObject({ outcome: "deny", reason: "query_error" });
  });

  test("target:* 任意後綴都歸 R6", async () => {
    expect((await decide("target:team", {}, makeQueries())).relationId).toBe("R6");
  });

  describe("template:role_upgrade 三種情況", () => {
    const roleUpgrade = "template:role_upgrade";

    test("有 teamId：走 R5（不走 R6）", async () => {
      const queries = makeQueries();
      const result = await decide(roleUpgrade, { teamId: "t1", assignmentRole: "captain" }, queries);
      expect(result.relationId).toBe("R5");
      expect(queries.callerHasBroadcastPermission).not.toHaveBeenCalled();
    });

    test("無 teamId、admin.users.change_role 對齊成立：R6 allow", async () => {
      const result = await decide(roleUpgrade, {}, makeQueries());
      expect(result).toMatchObject({ outcome: "allow", relationId: "R6" });
    });

    test("無 teamId、權限碼不成立：record（relation_missing_key 放行），不是 gap，不查差距", async () => {
      const queries = makeQueries({ callerHasBroadcastPermission: false, callerBroadcastPermissionGap: true });
      const result = await decide(roleUpgrade, {}, queries);
      expect(result).toMatchObject({ outcome: "record", relationId: "R6", gate: "relation_missing_key" });
      expect(queries.callerBroadcastPermissionGap).not.toHaveBeenCalled();
    });

    test("無 teamId、權限碼不成立、R6 注入 enforce：deny", async () => {
      const queries = makeQueries({ callerHasBroadcastPermission: false });
      expect(await decide(roleUpgrade, {}, queries, { inject: { modeOf: enforceAll } })).toMatchObject({ outcome: "deny" });
    });
  });
});

describe("decideRelation R2／R9／client:unknown／unclassified（只記錄）", () => {
  test("R2 template:waitlist_promoted：record，不查詢；注入 enforce 才 deny", async () => {
    const queries = makeQueries();
    const result = await decide("template:waitlist_promoted", {}, queries);
    expect(result).toMatchObject({ outcome: "record", relationId: "R2", gate: "relation_missing_key" });
    expect(calledNames(queries)).toEqual([]);
    expect(await decide("template:waitlist_promoted", {}, makeQueries(), { inject: { modeOf: enforceAll } })).toMatchObject({ outcome: "deny" });
  });

  test.each(["edu_checkin", "edu_reminder", "edu_report", "edu_student_review:approve", "edu_student_review:reject"])(
    "R9 %s：record，不查詢；注入 enforce 才 deny",
    async (source) => {
      const queries = makeQueries({ callerIsAuthenticated: false });
      expect(await decide(source, {}, queries)).toMatchObject({ outcome: "record", relationId: "R9" });
      expect(calledNames(queries)).toEqual([]);
      expect(await decide(source, {}, makeQueries(), { inject: { modeOf: enforceAll } })).toMatchObject({ outcome: "deny", relationId: "R9" });
    },
  );

  test("client:unknown 收件者不是本人：record + clientUnknown，放行；是本人：allow", async () => {
    const other = await decide("client:unknown", {}, makeQueries({ recipientIsCaller: false }));
    expect(other).toMatchObject({ outcome: "record", relationId: "client_unknown", gate: "relation_missing_key" });
    expect(other.flags).toEqual({ clientUnknown: true });
    const self = await decide("client:unknown", {}, makeQueries());
    expect(self).toMatchObject({ outcome: "allow", relationId: "client_unknown", gate: null });
  });

  test("client:unknown 不進 R0：即使 R0 是 enforce 也不拒絕；查詢丟錯也只記錄", async () => {
    const result = await decide("client:unknown", {}, makeQueries({ recipientIsCaller: false }), { inject: { modeOf: enforceAll } });
    expect(result.outcome).toBe("record");
    expect((await decide("client:unknown", {}, makeQueries({ recipientIsCaller: boom() }))).outcome).toBe("record");
  });

  test("unclassified（已知格式但表裡沒有）：record，不查詢", async () => {
    expect(classifyRelation("template:welcome:admins", {})?.id).toBe("unclassified");
    const queries = makeQueries();
    expect(await decide("template:welcome:admins", {}, queries)).toMatchObject({ outcome: "record", relationId: "unclassified" });
    expect(calledNames(queries)).toEqual([]);
  });
});

describe("decideRelation fail-closed 邊界", () => {
  test("查詢物件缺少需要的函式：deny", async () => {
    const queries = makeQueries();
    delete queries.recipientIsCaller;
    expect(await decide("template:welcome", {}, queries)).toMatchObject({ outcome: "deny", reason: "query_missing" });
    expect(await decide("template:welcome", {}, undefined)).toMatchObject({ outcome: "deny" });
  });

  test("查詢函式只在原型鏈上（不是自身屬性）也視為缺失", async () => {
    const queries = Object.create(makeQueries());
    expect(await decide("template:welcome", {}, queries)).toMatchObject({ outcome: "deny", reason: "query_missing" });
  });

  test("查詢回傳 truthy 但不是 true（例如物件、字串）不算成立", async () => {
    expect(await decide("template:welcome", {}, makeQueries({ recipientIsCaller: "yes" }))).toMatchObject({ outcome: "deny" });
    expect(await decide("template:welcome", {}, makeQueries({ callerIsAuthenticated: {} }))).toMatchObject({ outcome: "deny" });
    expect(await decide("target:all", {}, makeQueries({ callerHasBroadcastPermission: 1, callerBroadcastPermissionGap: false }))).toMatchObject({ outcome: "allow", reason: "not_aligned_log_mode" });
  });

  test("classify 或 modeOf 丟例外：deny（不是放行）", async () => {
    const boomFn = () => { throw new Error("bug"); };
    expect(await decide("template:welcome", {}, makeQueries(), { inject: { classify: boomFn } })).toMatchObject({ outcome: "deny", relationId: null });
    expect(await decide("template:welcome", {}, makeQueries(), { inject: { modeOf: boomFn } })).toMatchObject({ outcome: "deny", relationId: "R0" });
  });

  test("ctx 缺失也不丟例外；沒有呼叫者資訊時由查詢決定（這裡查詢回 false → deny）", async () => {
    const queries = makeQueries({ callerIsAuthenticated: false });
    const result = await decideRelation({ source: "template:welcome", keys: undefined, ctx: undefined, queries });
    expect(result.outcome).toBe("deny");
  });
});
