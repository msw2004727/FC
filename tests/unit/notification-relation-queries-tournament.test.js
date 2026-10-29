"use strict";

/**
 * 通知發送授權強化（第 2 批）：R8 賽事關係查詢。
 */

const { createRelationQueries } = require("../../functions/notification-relation-queries");
const { createMemoryDb, createHelpers, makeCtx } = require("./notification-relation-test-kit");

const boom = () => Object.assign(new Error("14 UNAVAILABLE"), { code: 14 });
const TOURNAMENT = {
  id: "tr1",
  creatorUid: "uidCre",
  delegates: [{ uid: "uidDel", name: "D" }],
  hostTeamId: "tHost",
};
const SEED = {
  "tournaments/tr1": TOURNAMENT,
  "tournaments/tr1/applications/ta_tApply": { requestedByUid: "uidApplicant", teamId: "tApply" },
  "teams/tHost": { id: "tHost", captainUid: "uidHostCap", leaderUids: ["uidHostLead"], coachUids: ["uidHostCoach"] },
  "teams/tApply": { id: "tApply", captainUid: "uidApplicant" },
};

function setup(seed = {}, faults = {}) {
  const db = createMemoryDb({ seed: { ...SEED, ...seed }, faults });
  const helpers = createHelpers({ db });
  return { db, queries: createRelationQueries({ db, helpers }) };
}

const ctxFor = (source, extra = {}) => makeCtx({ source, keys: { tournamentId: "tr1" }, ...extra });

describe("callerMatchesTournamentSource", () => {
  test("申請類：application.requestedByUid 等於呼叫者通過；別人拒絕；沒有申請文件拒絕", async () => {
    const { queries } = setup();
    for (const source of ["tournament_register_request", "template:tournament_friendly_team_apply_host"]) {
      const keys = { tournamentId: "tr1", teamId: "tApply" };
      expect(await queries.callerMatchesTournamentSource(ctxFor(source, { keys, callerUid: "uidApplicant" }))).toBe(true);
      expect(await queries.callerMatchesTournamentSource(ctxFor(source, { keys, callerUid: "uidOther" }))).toBe(false);
      expect(await queries.callerMatchesTournamentSource(ctxFor(source, { keys: { tournamentId: "tr1", teamId: "tNone" }, callerUid: "uidApplicant" }))).toBe(false);
    }
  });

  test("審核類：建立者、delegates[].uid、delegateUids、主辦隊 officer（含 leaderUids）、admin 以上通過", async () => {
    const { queries } = setup({ "tournaments/tr2": { id: "tr2", creatorUid: "uidCre", delegateUids: ["uidDU"] } });
    const source = "tournament_review:approve";
    for (const uid of ["uidCre", "uidDel", "uidHostCap", "uidHostLead"]) {
      expect(await queries.callerMatchesTournamentSource(ctxFor(source, { callerUid: uid }))).toBe(true);
    }
    expect(await queries.callerMatchesTournamentSource(makeCtx({ source, keys: { tournamentId: "tr2" }, callerUid: "uidDU" }))).toBe(true);
    expect(await queries.callerMatchesTournamentSource(ctxFor(source, { callerUid: "uidX", callerRole: "admin" }))).toBe(true);
    expect(await queries.callerMatchesTournamentSource(ctxFor(source, { callerUid: "uidX", callerRole: "super_admin" }))).toBe(true);
  });

  test("審核類：主辦隊教練（coachUids 不算 officer）、陌生人拒絕；賽事不存在拒絕", async () => {
    const { queries } = setup();
    const source = "template:tournament_friendly_team_approved_applicant";
    expect(await queries.callerMatchesTournamentSource(ctxFor(source, { callerUid: "uidHostCoach" }))).toBe(false);
    expect(await queries.callerMatchesTournamentSource(ctxFor(source, { callerUid: "uidX" }))).toBe(false);
    expect(await queries.callerMatchesTournamentSource(makeCtx({ source, keys: { tournamentId: "none" }, callerUid: "uidCre" }))).toBe(false);
  });

  test("主辦隊文件 id 欄位不一致（查無）時，不靠它放行主辦隊幹部", async () => {
    const { queries } = setup({ "teams/tHost": { id: "tOther", captainUid: "uidHostCap" } });
    expect(await queries.callerMatchesTournamentSource(ctxFor("tournament_review:reject", { callerUid: "uidHostCap" }))).toBe(false);
  });

  test("host_opened：只有建立者通過，委託人也不行", async () => {
    const { queries } = setup();
    const source = "template:tournament_friendly_host_opened";
    expect(await queries.callerMatchesTournamentSource(ctxFor(source, { callerUid: "uidCre" }))).toBe(true);
    expect(await queries.callerMatchesTournamentSource(ctxFor(source, { callerUid: "uidDel" }))).toBe(false);
  });

  test("賽事 id 不是文件 id 時改用 where(id) 找到", async () => {
    const { queries } = setup({ "tournaments/docX": { id: "legacy1", creatorUid: "uidCre" } });
    const ctx = makeCtx({ source: "tournament_review:approve", keys: { tournamentId: "legacy1" }, callerUid: "uidCre" });
    expect(await queries.callerMatchesTournamentSource(ctx)).toBe(true);
  });

  test("讀賽事／申請文件／主辦隊丟錯：往外丟", async () => {
    const trErr = setup({}, { get: (path) => (path === "tournaments/tr1" ? boom() : null) });
    await expect(trErr.queries.callerMatchesTournamentSource(ctxFor("tournament_review:approve", { callerUid: "uidCre" }))).rejects.toThrow("UNAVAILABLE");
    const appErr = setup({}, { get: (path) => (path.includes("/applications/") ? boom() : null) });
    await expect(appErr.queries.callerMatchesTournamentSource(
      ctxFor("tournament_register_request", { keys: { tournamentId: "tr1", teamId: "tApply" }, callerUid: "uidApplicant" }),
    )).rejects.toThrow("UNAVAILABLE");
    const teamErr = setup({}, { get: (path) => (path === "teams/tHost" ? boom() : null) });
    await expect(teamErr.queries.callerMatchesTournamentSource(ctxFor("tournament_review:approve", { callerUid: "uidX" }))).rejects.toThrow("UNAVAILABLE");
  });
});

describe("recipientInTournamentAudience", () => {
  test("申請送出：收件者是建立者與 delegates[].uid 通過；無關 uid 拒絕", async () => {
    const { queries } = setup();
    for (const source of ["tournament_register_request", "template:tournament_friendly_team_apply_host"]) {
      const keys = { tournamentId: "tr1", teamId: "tApply" };
      expect(await queries.recipientInTournamentAudience(ctxFor(source, { keys, recipientUid: "uidCre" }))).toBe(true);
      expect(await queries.recipientInTournamentAudience(ctxFor(source, { keys, recipientUid: "uidDel" }))).toBe(true);
      expect(await queries.recipientInTournamentAudience(ctxFor(source, { keys, recipientUid: "uidX" }))).toBe(false);
    }
  });

  test("通過／拒絕給申請人（有 teamId）：收件者必須是 application.requestedByUid", async () => {
    const { queries } = setup();
    for (const source of [
      "template:tournament_friendly_team_approved_applicant",
      "template:tournament_friendly_team_rejected_applicant",
      "tournament_review:approve",
    ]) {
      const keys = { tournamentId: "tr1", teamId: "tApply" };
      expect(await queries.recipientInTournamentAudience(ctxFor(source, { keys, recipientUid: "uidApplicant" }))).toBe(true);
      expect(await queries.recipientInTournamentAudience(ctxFor(source, { keys, recipientUid: "uidX" }))).toBe(false);
    }
  });

  test("tournament_review:approve／reject 沒有 teamId：該賽事任一申請的 requestedByUid 等於收件者才通過", async () => {
    const { queries } = setup();
    expect(await queries.recipientInTournamentAudience(ctxFor("tournament_review:reject", { recipientUid: "uidApplicant" }))).toBe(true);
    expect(await queries.recipientInTournamentAudience(ctxFor("tournament_review:reject", { recipientUid: "uidX" }))).toBe(false);
  });

  test("審核結果 broadcast：收件者是建立者／委託人且不是呼叫者；呼叫者自己、無關 uid 拒絕", async () => {
    const { queries } = setup();
    const source = "tournament_review:broadcast:approve";
    expect(await queries.recipientInTournamentAudience(ctxFor(source, { callerUid: "uidCre", recipientUid: "uidDel" }))).toBe(true);
    expect(await queries.recipientInTournamentAudience(ctxFor(source, { callerUid: "uidDel", recipientUid: "uidCre" }))).toBe(true);
    expect(await queries.recipientInTournamentAudience(ctxFor(source, { callerUid: "uidCre", recipientUid: "uidCre" }))).toBe(false);
    expect(await queries.recipientInTournamentAudience(ctxFor(source, { callerUid: "uidCre", recipientUid: "uidX" }))).toBe(false);
  });

  test("通過後廣播：收件者是申請隊成員（users.teamId 或 teamIds）；非成員、隊伍不存在拒絕", async () => {
    const { queries } = setup({
      "users/uidM1": { teamId: "tApply" },
      "users/uidM2": { teamIds: ["tOther", "tApply"] },
      "users/uidN": { teamId: "tOther" },
    });
    const source = "template:tournament_friendly_team_approved_broadcast";
    const keys = { tournamentId: "tr1", teamId: "tApply" };
    expect(await queries.recipientInTournamentAudience(ctxFor(source, { keys, recipientUid: "uidM1" }))).toBe(true);
    expect(await queries.recipientInTournamentAudience(ctxFor(source, { keys, recipientUid: "uidM2" }))).toBe(true);
    expect(await queries.recipientInTournamentAudience(ctxFor(source, { keys, recipientUid: "uidN" }))).toBe(false);
    expect(await queries.recipientInTournamentAudience(ctxFor(source, { keys, recipientUid: "uidGhost" }))).toBe(false);
    expect(await queries.recipientInTournamentAudience(ctxFor(source, { keys: { tournamentId: "tr1", teamId: "tNone" }, recipientUid: "uidM1" }))).toBe(false);
  });

  test("通過後廣播：LINE 路徑用 found.data 判斷成員，不再讀 users", async () => {
    const { queries, db } = setup();
    const source = "template:tournament_friendly_team_approved_broadcast";
    const keys = { tournamentId: "tr1", teamId: "tApply" };
    const found = { docId: "uidM1", data: { uid: "uidM1", teamIds: ["tApply"] } };
    expect(await queries.recipientInTournamentAudience(ctxFor(source, { keys, recipientUid: "Uline", recipientFound: found }))).toBe(true);
    expect(db.readsOf("users/")).toEqual([]);
  });

  test("host_opened：收件者是 hostTeamId 的成員；hostTeamId 隊伍不存在拒絕", async () => {
    const { queries } = setup({
      "users/uidHostMember": { teamId: "tHost" },
      "tournaments/tr3": { id: "tr3", creatorUid: "uidCre", hostTeamId: "tNone" },
    });
    const source = "template:tournament_friendly_host_opened";
    expect(await queries.recipientInTournamentAudience(ctxFor(source, { recipientUid: "uidHostMember" }))).toBe(true);
    expect(await queries.recipientInTournamentAudience(ctxFor(source, { recipientUid: "uidX" }))).toBe(false);
    expect(await queries.recipientInTournamentAudience(makeCtx({ source, keys: { tournamentId: "tr3" }, recipientUid: "uidHostMember" }))).toBe(false);
  });

  test("賽事不存在、沒有收件者身分、未知 source：拒絕", async () => {
    const { queries } = setup();
    expect(await queries.recipientInTournamentAudience(makeCtx({ source: "tournament_register_request", keys: { tournamentId: "none", teamId: "tApply" }, recipientUid: "uidCre" }))).toBe(false);
    expect(await queries.recipientInTournamentAudience(ctxFor("tournament_register_request", { keys: { tournamentId: "tr1", teamId: "tApply" }, recipientUid: "" }))).toBe(false);
    expect(await queries.recipientInTournamentAudience(ctxFor("template:welcome", { recipientUid: "uidCre" }))).toBe(false);
  });

  test("讀取丟錯（申請文件、申請查詢、成員 user 文件）：往外丟", async () => {
    const appErr = setup({}, { get: (path) => (path.includes("/applications/") ? boom() : null) });
    await expect(appErr.queries.recipientInTournamentAudience(
      ctxFor("tournament_review:approve", { keys: { tournamentId: "tr1", teamId: "tApply" }, recipientUid: "uidApplicant" }),
    )).rejects.toThrow("UNAVAILABLE");
    const qErr = setup({}, { query: (path) => (path.endsWith("/applications") ? boom() : null) });
    await expect(qErr.queries.recipientInTournamentAudience(ctxFor("tournament_review:approve", { recipientUid: "uidApplicant" }))).rejects.toThrow("UNAVAILABLE");
    const userErr = setup({}, { get: (path) => (path.startsWith("users/") ? boom() : null) });
    await expect(userErr.queries.recipientInTournamentAudience(
      ctxFor("template:tournament_friendly_team_approved_broadcast", { keys: { tournamentId: "tr1", teamId: "tApply" }, recipientUid: "uidM1" }),
    )).rejects.toThrow("UNAVAILABLE");
  });
});
