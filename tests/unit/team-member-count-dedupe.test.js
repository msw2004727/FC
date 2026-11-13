"use strict";

/**
 * 俱樂部人數計算：同一人有新舊兩份 users 文件時只算一次。
 * 涵蓋兩條寫 teams.members 的路徑：recountTeamMembers Callable（team-member-count.js）
 * 與 removeTeamMember 提交後的重算（team-membership-core.js#recountAndWriteTeamMembers）。
 * 身分鍵順序：uid → lineUserId → 文件 id。
 */

const { createRecountTeamMembersHandler } = require("../../functions/team-member-count");
const { recountAndWriteTeamMembers } = require("../../functions/team-membership-core");
const { createRemoveTeamMemberHandler } = require("../../functions/team-member-removal");
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

const TEAM = "tm_count";
const TEAM_NAME = "人數測試隊";

function member(uid, extra = {}) {
  return { uid, lineUserId: uid, teamId: TEAM, teamName: TEAM_NAME, teamIds: [TEAM], teamNames: [TEAM_NAME], ...extra };
}

// 舊格式文件：文件 id 不是 uid、沒有 uid 欄位，只有 lineUserId。
function legacyDoc(lineUserId, extra = {}) {
  return { lineUserId, displayName: "舊文件", teamId: TEAM, teamName: TEAM_NAME, ...extra };
}

// 幹部 3 人＋一般隊員 2 人 ＝ 5 人。
function baseDocs(extra = {}) {
  return {
    [`teams/${TEAM}`]: {
      id: TEAM, name: TEAM_NAME, captainUid: "U-cap", leaderUids: ["U-lead"], coachUids: ["U-coach"], members: 0,
    },
    "users/U-cap": member("U-cap", { displayName: "隊長", role: "captain" }),
    "users/U-lead": member("U-lead", { displayName: "領隊", role: "coach" }),
    "users/U-coach": member("U-coach", { displayName: "教練", role: "coach" }),
    "users/U-m1": member("U-m1", { displayName: "小明", role: "user" }),
    "users/U-m2": member("U-m2", { displayName: "小華", role: "user" }),
    ...extra,
  };
}

async function recountViaCore(docs) {
  const fake = createFakeFirestore(docs);
  const members = await recountAndWriteTeamMembers({ db: fake.db, FieldValue, teamRef: fake.db.collection("teams").doc(TEAM) });
  return { members, stored: fake.get(`teams/${TEAM}`).members };
}

async function recountViaCallable(docs) {
  const fake = createFakeFirestore(docs);
  const handler = createRecountTeamMembersHandler({
    HttpsError: FakeHttpsError, db: fake.db, FieldValue, getCallerAccessContext: async () => null, logger: createLogger(),
  });
  const result = await handler({ auth: { uid: "U-cap" }, data: { teamId: TEAM } });
  return { members: result.members, stored: fake.get(`teams/${TEAM}`).members };
}

const RECOUNT_PATHS = [
  ["recountAndWriteTeamMembers", recountViaCore],
  ["recountTeamMembers Callable", recountViaCallable],
];

describe.each(RECOUNT_PATHS)("%s：同一人多份 users 文件只算一次", (_label, recount) => {
  test("一般情況（每人一份文件）不受影響：5 人", async () => {
    await expect(recount(baseDocs())).resolves.toEqual({ members: 5, stored: 5 });
  });

  test("隊員另有舊文件（沒有 uid 欄位、lineUserId 相同）：仍是 5 人", async () => {
    await expect(recount(baseDocs({ "users/legacy_m2": legacyDoc("U-m2") }))).resolves.toEqual({ members: 5, stored: 5 });
  });

  test("隊員另有舊文件（文件 id 不同、uid 欄位相同）：仍是 5 人", async () => {
    const docs = baseDocs({ "users/legacy_m2": legacyDoc("U-m2", { uid: "U-m2" }) });
    await expect(recount(docs)).resolves.toEqual({ members: 5, stored: 5 });
  });

  test("幹部另有舊文件（lineUserId 相同）：仍是 5 人", async () => {
    await expect(recount(baseDocs({ "users/legacy_cap": legacyDoc("U-cap") }))).resolves.toEqual({ members: 5, stored: 5 });
  });

  test("只有舊文件、沒有正本的隊員照樣算 1 人", async () => {
    await expect(recount(baseDocs({ "users/legacy_m3": legacyDoc("U-m3") }))).resolves.toEqual({ members: 6, stored: 6 });
  });

  test("不同人的舊文件不會被合併", async () => {
    const docs = baseDocs({
      "users/legacy_m3": legacyDoc("U-m3"),
      "users/legacy_m4": legacyDoc("U-m4"),
    });
    await expect(recount(docs)).resolves.toEqual({ members: 7, stored: 7 });
  });

  test("沒有 uid 也沒有 lineUserId 的文件仍以文件 id 計 1 人", async () => {
    const docs = baseDocs({ "users/legacy_anon": { displayName: "無身分", teamIds: [TEAM] } });
    await expect(recount(docs)).resolves.toEqual({ members: 6, stored: 6 });
  });
});

describe("removeTeamMember：剔除後人數與成員判斷", () => {
  function setup(docs) {
    const access = createAccess({ role: "captain" });
    const fake = createFakeFirestore({ ...permissionDocsFor(access, "U-cap"), ...docs });
    const handler = createRemoveTeamMemberHandler({
      db: fake.db,
      HttpsError: FakeHttpsError,
      FieldValue,
      roleLevels: ROLE_LEVELS,
      getCallerAccessContext: jest.fn(async () => mockCallerAccess(access)),
      buildOperationLogPayload,
      logger: createLogger(),
      now: () => new Date("2026-11-13T08:00:00Z"),
    });
    const call = (memberUid) => handler({ auth: { uid: "U-cap" }, data: { teamId: TEAM, memberUid } });
    return { fake, call };
  }

  test("一般情況：剔除 1 人後 5 → 4，被剔者不再屬於該隊", async () => {
    const { fake, call } = setup(baseDocs());
    await expect(call("U-m1")).resolves.toEqual({ ok: true, alreadyRemoved: false, memberCount: 4 });
    expect(fake.get(`teams/${TEAM}`).members).toBe(4);
    expect(fake.get("users/U-m1")).toMatchObject({ teamId: null, teamIds: [] });
  });

  test("其他隊員有新舊兩份文件時，剔除 1 人後是 4 人（舊文件不會被多算一次）", async () => {
    const { fake, call } = setup(baseDocs({ "users/legacy_m2": legacyDoc("U-m2") }));
    await expect(call("U-m1")).resolves.toEqual({ ok: true, alreadyRemoved: false, memberCount: 4 });
    expect(fake.get(`teams/${TEAM}`).members).toBe(4);
    expect(fake.get("users/U-m1")).toMatchObject({ teamId: null, teamIds: [] });
    // 其他人的兩份文件都不被動到
    expect(fake.get("users/U-m2")).toMatchObject({ teamIds: [TEAM] });
    expect(fake.get("users/legacy_m2")).toMatchObject({ teamId: TEAM });
  });

  test("剔除後再剔同一人：alreadyRemoved，人數維持 4", async () => {
    const { fake, call } = setup(baseDocs({ "users/legacy_m2": legacyDoc("U-m2") }));
    await call("U-m1");
    await expect(call("U-m1")).resolves.toEqual({ ok: true, alreadyRemoved: true });
    expect(fake.get(`teams/${TEAM}`).members).toBe(4);
  });
});
