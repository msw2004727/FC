"use strict";

const promotion = require("../../functions/team-role-promotion");
const { createFakeFirestore } = require("./team-callable-fake-db");

const { getSavedTeamRoleExcludingTeam } = promotion;

function roleOf(teams, excludeTeamDocId, uid = "U-x") {
  const fake = createFakeFirestore(Object.fromEntries(
    Object.entries(teams).map(([id, data]) => [`teams/${id}`, data]),
  ));
  return getSavedTeamRoleExcludingTeam({ db: fake.db, uid, excludeTeamDocId });
}

describe("getSavedTeamRoleExcludingTeam（T-027 7b(A) 新增，deleteTeam 專用）", () => {
  test("既有 export 不變，只新增這一個", () => {
    expect(Object.keys(promotion).sort()).toEqual([
      "createAutoPromoteTeamRoleCallable",
      "createAutoPromoteTeamRoleHandler",
      "getRoleDecision",
      "getSavedTeamRoleExcludingTeam",
      "resolveStrictUserIdentity",
    ]);
  });

  test.each([
    ["只在被排除的隊當隊長", { del: { captainUid: "U-x" } }, "user"],
    ["只在被排除的隊當教練", { del: { coachUids: ["U-x"] } }, "user"],
    ["只在被排除的隊當領隊（leaderUids）", { del: { leaderUids: ["U-x"] } }, "user"],
    ["只在被排除的隊當領隊（舊 leaderUid）", { del: { leaderUid: "U-x" } }, "user"],
    ["被排除的隊與別隊都是隊長", { del: { captainUid: "U-x" }, other: { captainUid: "U-x" } }, "captain"],
    ["被排除的隊當隊長、別隊當教練", { del: { captainUid: "U-x" }, other: { coachUids: ["U-x"] } }, "coach"],
    ["被排除的隊當隊長、別隊當領隊", { del: { captainUid: "U-x" }, other: { leaderUids: ["U-x"] } }, "coach"],
    ["被排除的隊當隊長、別隊是舊 leaderUid", { del: { captainUid: "U-x" }, other: { leaderUid: "U-x" } }, "coach"],
    ["別隊當隊長", { del: {}, other: { captainUid: "U-x" } }, "captain"],
    ["別隊隊長是別人", { del: { captainUid: "U-x" }, other: { captainUid: "U-y" } }, "user"],
  ])("%s → %s", async (_label, teams, expected) => {
    await expect(roleOf(teams, "del")).resolves.toBe(expected);
  });

  test("沒指定要排除的 team 時，行為等同「全部都算」（與 getSavedTeamRole 的查詢語意相同）", async () => {
    await expect(roleOf({ del: { captainUid: "U-x" } }, undefined)).resolves.toBe("captain");
    await expect(roleOf({ del: { coachUids: ["U-x"] } }, undefined)).resolves.toBe("coach");
    await expect(roleOf({ del: {} }, undefined)).resolves.toBe("user");
  });

  test("同一人在被排除隊的多個欄位都有職務，仍只算別隊", async () => {
    const teams = {
      del: { captainUid: "U-x", coachUids: ["U-x"], leaderUids: ["U-x"], leaderUid: "U-x" },
      other: { coachUids: ["U-x"] },
    };
    await expect(roleOf(teams, "del")).resolves.toBe("coach");
  });
});
