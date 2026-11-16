"use strict";

/**
 * T-062 C2：通知關係的俱樂部讀法支援舊格式（文件 id ≠ id 欄位）。
 * 五種讀法情形直接打 readTeamById；R3／R4／R5 用真查詢＋決策，證明同一份舊格式隊伍由 deny 轉 allow。
 * 嚴格版 readTeamByDocId 仍會回 null（R8 主辦隊還在用它）。
 */

const { readTeamByDocId, readTeamById } = require("../../functions/notification-relation-queries-shared");
const { createRelationQueries } = require("../../functions/notification-relation-queries");
const { decideRelation } = require("../../functions/notification-relation-decide");
const { createMemoryDb, createHelpers, makeCtx } = require("./notification-relation-test-kit");

const boom = () => Object.assign(new Error("14 UNAVAILABLE"), { code: 14 });

function queriesFor(db) {
  return createRelationQueries({ db, helpers: createHelpers({ db }) });
}

describe("readTeamById 舊格式五種情形", () => {
  test("① 文件 id 命中且 id 欄位不同：讀到，不再 where", async () => {
    const db = createMemoryDb({ seed: { "teams/docHit": { id: "logicHit", captainUid: "uidCap" } } });
    expect(await readTeamByDocId(db, "docHit")).toBeNull();
    expect(await readTeamById(db, "docHit")).toEqual({
      docId: "docHit", data: { id: "logicHit", captainUid: "uidCap" },
    });
    expect(db.reads.filter((item) => item.startsWith("query:"))).toEqual([]);
  });

  test("② 文件 id 查無、唯一非自建舊 id：讀到", async () => {
    const db = createMemoryDb({ seed: { "teams/docOld": { id: "logicOld", captainUid: "uidCap" } } });
    expect(await readTeamByDocId(db, "logicOld")).toBeNull();
    expect(await readTeamById(db, "logicOld")).toEqual({
      docId: "docOld", data: { id: "logicOld", captainUid: "uidCap" },
    });
    expect(db.reads).toContain("query:teams:id==logicOld");
  });

  test("文件 id 查無、自建與非自建各一筆：排除自建後恰好一筆，用非自建", async () => {
    const db = createMemoryDb({
      seed: {
        "teams/docOwn": { id: "logicMix", createdVia: "user_capability", captainUid: "uidOwn" },
        "teams/docOld": { id: "logicMix", captainUid: "uidCap" },
      },
    });
    expect(await readTeamById(db, "logicMix")).toEqual({
      docId: "docOld", data: { id: "logicMix", captainUid: "uidCap" },
    });
  });

  test("兩筆自建加一筆非自建：limit(3) 才看得到那筆非自建", async () => {
    const db = createMemoryDb({
      seed: {
        "teams/a_own": { id: "logicMix", createdVia: "user_capability", captainUid: "uidOwn" },
        "teams/b_own": { id: "logicMix", createdVia: "user_capability", captainUid: "uidOwn2" },
        "teams/c_legacy": { id: "logicMix", captainUid: "uidCap" },
      },
    });
    expect(await readTeamById(db, "logicMix")).toEqual({
      docId: "c_legacy", data: { id: "logicMix", captainUid: "uidCap" },
    });
  });

  test("③ 文件 id 查無、兩筆舊 id：null，不丟錯", async () => {
    const db = createMemoryDb({
      seed: {
        "teams/dupA": { id: "logicDup", captainUid: "uidA" },
        "teams/dupB": { id: "logicDup", captainUid: "uidB" },
      },
    });
    await expect(readTeamById(db, "logicDup")).resolves.toBeNull();
  });

  test("兩筆非自建加一筆自建：排除後仍兩筆，null", async () => {
    const db = createMemoryDb({
      seed: {
        "teams/a_old": { id: "logicDup", captainUid: "uidA" },
        "teams/b_old": { id: "logicDup", captainUid: "uidB" },
        "teams/c_own": { id: "logicDup", createdVia: "user_capability", captainUid: "uidOwn" },
      },
    });
    await expect(readTeamById(db, "logicDup")).resolves.toBeNull();
  });

  test("④ 文件 id 查無、唯一候選是自建隊：null；同一隊用文件 id 仍讀得到", async () => {
    const data = { id: "logicOwn", createdVia: "user_capability", captainUid: "uidOwn" };
    const db = createMemoryDb({ seed: { "teams/docOwn": data } });
    await expect(readTeamById(db, "logicOwn")).resolves.toBeNull();
    expect(await readTeamById(db, "docOwn")).toEqual({ docId: "docOwn", data });
  });

  test("⑤ 不合格式鍵：null 且沒有發出查詢", async () => {
    const db = createMemoryDb({ seed: { "teams/t1": { id: "t1", captainUid: "uidCap" } } });
    const bad = ["", "   ", "a/b", "t1/students/forged", ".", "..", "__x__", "x".repeat(129), null, 12, undefined];
    for (const key of bad) expect(await readTeamById(db, key)).toBeNull();
    expect(db.reads).toEqual([]);
  });

  test("舊 id 查詢丟錯：往外丟，不變成 null", async () => {
    const db = createMemoryDb({ faults: { query: (path) => (path === "teams" ? boom() : null) } });
    await expect(readTeamById(db, "missing")).rejects.toThrow("UNAVAILABLE");
  });
});

describe("自建隊成員比對不改", () => {
  test("直接命中後仍只認文件 id，不認 id 欄位", async () => {
    const team = { id: "logicOwn", createdVia: "user_capability", captainUid: "uidCap", coachUids: ["uidCoach"] };
    const ctx = {
      callerUid: "uidCap", recipientUid: "uidCoach", source: "team_role_assignment:coach", keys: { teamId: "docOwn" },
    };
    const byField = createMemoryDb({ seed: { "teams/docOwn": team, "users/uidCoach": { teamIds: ["logicOwn"] } } });
    expect(await queriesFor(byField).recipientMayReceiveTeamAssignment(makeCtx(ctx))).toBe(false);
    const byDoc = createMemoryDb({ seed: { "teams/docOwn": team, "users/uidCoach": { teamIds: ["docOwn"] } } });
    expect(await queriesFor(byDoc).recipientMayReceiveTeamAssignment(makeCtx(ctx))).toBe(true);
  });
});

describe("R3／R4／R5 舊格式隊伍 deny 轉 allow", () => {
  const run = (db, source, keys, ctx) => decideRelation({
    source, keys, ctx: makeCtx(ctx), queries: queriesFor(db),
  });

  test("R3 文件 id≠id 欄位、幹部正確：allow", async () => {
    const db = createMemoryDb({ seed: { "teams/docR3": { id: "logicR3", captainUid: "uidCap" } } });
    expect(await readTeamByDocId(db, "docR3")).toBeNull();
    const result = await run(db, "team_join_request", { teamId: "docR3" }, {
      callerUid: "uidApply", recipientUid: "uidCap",
    });
    expect(result).toMatchObject({ outcome: "allow", relationId: "R3", gate: null, reason: "ok" });
  });

  test("R4 文件 id 查無、唯一非自建舊 id、幹部正確：allow", async () => {
    const db = createMemoryDb({
      seed: {
        "teams/docR4": { id: "logicR4", captainUid: "uidCap" },
        "rolePermissions/captain": { permissions: ["team.manage.entry"] },
        // C3 起 R4 權限走 getCallerAccessContext，角色以 users 文件為準。
        "users/uidCap": { role: "captain" },
      },
    });
    expect(await readTeamByDocId(db, "logicR4")).toBeNull();
    const result = await run(db, "team_join_review:approve", { teamId: "logicR4", applicantUid: "uidApply" }, {
      callerUid: "uidCap", callerRole: "captain", recipientUid: "uidApply",
    });
    expect(result).toMatchObject({ outcome: "allow", relationId: "R4", gate: null, reason: "ok" });
  });

  test("R5 文件 id≠id 欄位、幹部正確：allow", async () => {
    const db = createMemoryDb({
      seed: { "teams/docR5": { id: "logicR5", captainUid: "uidNew", leaderUids: ["uidCaller"] } },
    });
    expect(await readTeamByDocId(db, "docR5")).toBeNull();
    const result = await run(db, "team_role_assignment:captain", { teamId: "docR5" }, {
      callerUid: "uidCaller", recipientUid: "uidNew",
    });
    expect(result).toMatchObject({ outcome: "allow", relationId: "R5", gate: null, reason: "ok" });
  });
});
