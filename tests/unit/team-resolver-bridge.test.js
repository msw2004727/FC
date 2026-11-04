"use strict";

// 沿用既有 Firestore mock；test／describe／expect 使用 runner globals，支援 Vitest --globals 與既有 Jest。
const { createDeleteTeamHandler } = require("../../functions/team-deletion");
const { createRemoveTeamMemberHandler } = require("../../functions/team-member-removal");
const { resolveTeamSnapshot } = require("../../functions/team-membership-core");
const {
  FakeHttpsError, FieldValue, FieldPath, ROLE_LEVELS, buildOperationLogPayload,
  createAccess, createFakeFirestore, mockCallerAccess, normalizeRole, permissionDocsFor,
} = require("./team-callable-fake-db");

const DOC_ID = "doc_legacy";
const LOGICAL_ID = "tm_legacy";
const MEMBER = "U-member";
const CAPTAIN = "U-captain";
const KEEP_ID = "tm_keep";

function membership(ids) {
  return { teamId: ids[0] || null, teamName: ids[0] || null, teamIds: ids, teamNames: ids };
}

function setup(kind, extra = {}) {
  const access = createAccess({ role: "captain" });
  const fake = createFakeFirestore({
    ...permissionDocsFor(access, CAPTAIN),
    ["teams/" + DOC_ID]: { id: LOGICAL_ID, name: "舊格式俱樂部", captainUid: CAPTAIN },
    ["teams/" + KEEP_ID]: { id: KEEP_ID, name: "保留俱樂部" },
    ["users/" + CAPTAIN]: { uid: CAPTAIN, role: "captain", displayName: "隊長" },
    ["users/" + MEMBER]: { uid: MEMBER, role: "user", ...membership([DOC_ID, LOGICAL_ID, KEEP_ID]) },
    ...extra,
  });
  const dependencies = {
    db: fake.db, HttpsError: FakeHttpsError, FieldValue, FieldPath, roleLevels: ROLE_LEVELS,
    normalizeRole, getCallerAccessContext: async () => mockCallerAccess(access),
    ensureAuthUser: async () => null, setRoleClaimMerged: async () => null,
    buildOperationLogPayload, defaultNotificationTemplates: [],
    logger: { info() {}, warn() {}, error() {} }, now: () => new Date("2026-11-03T00:00:00Z"),
  };
  const handler = kind === "deleteTeam"
    ? createDeleteTeamHandler(dependencies) : createRemoveTeamMemberHandler(dependencies);
  const call = (teamId = DOC_ID, memberUid = MEMBER) => handler({ auth: { uid: CAPTAIN }, data: { teamId, memberUid } });
  return { fake, call };
}

function expectCleaned(fake, uid = MEMBER) {
  expect(fake.get("users/" + uid)).toMatchObject({
    teamId: KEEP_ID, teamName: "保留俱樂部", teamIds: [KEEP_ID], teamNames: ["保留俱樂部"],
  });
}

for (const kind of ["deleteTeam", "removeTeamMember"]) {
  describe(kind + " resolver 橋接", () => {
    test.each([DOC_ID, LOGICAL_ID])("以 %s 呼叫：文件 id 與唯一舊 id 同時清理，保留其他隊伍", async (input) => {
      const { fake, call } = setup(kind);
      await expect(call(input)).resolves.toMatchObject({ ok: true });
      expectCleaned(fake);
      expect(fake.has("teams/" + DOC_ID)).toBe(kind !== "deleteTeam");
      expect(fake.has("teams/" + KEEP_ID)).toBe(true);
    });

    test.each(["teamIds", "teamId"])("只有舊 %s 欄位歸屬也能清乾淨", async (field) => {
      const { fake, call } = setup(kind, {
        ["users/" + MEMBER]: { uid: MEMBER, role: "user", [field]: field === "teamIds" ? [LOGICAL_ID] : LOGICAL_ID },
      });
      await expect(call()).resolves.toMatchObject({ ok: true });
      expect(fake.get("users/" + MEMBER)).toMatchObject({ teamId: null, teamName: null, teamIds: [], teamNames: [] });
    });

    test("邏輯 id 兩筆命中 → TEAM_ID_AMBIGUOUS，沒有任何寫入", async () => {
      const { fake, call } = setup(kind, { "teams/doc_duplicate": { id: LOGICAL_ID, captainUid: CAPTAIN } });
      await expect(call(LOGICAL_ID)).rejects.toMatchObject({ code: "failed-precondition", message: "TEAM_ID_AMBIGUOUS" });
      expect(fake.state.writes).toHaveLength(0);
    });

    test.each(["文件 id", "id 欄位"])("舊 id 與別隊%s衝突 → 只清文件 id、不動別隊成員", async (collision) => {
      const otherPath = collision === "文件 id" ? "teams/" + LOGICAL_ID : "teams/doc_other";
      const other = { id: collision === "文件 id" ? "tm_other_field" : LOGICAL_ID, name: "別隊", captainUid: "U-other" };
      const victim = { uid: "U-victim", role: "user", ...membership([LOGICAL_ID]) };
      const { fake, call } = setup(kind, { [otherPath]: other, "users/U-victim": victim });
      await expect(call()).resolves.toMatchObject({ ok: true });
      expect(fake.get("users/" + MEMBER).teamIds).toEqual([LOGICAL_ID, KEEP_ID]);
      expect(fake.get("users/U-victim")).toEqual(victim);
      expect(fake.writesTo("users/U-victim")).toHaveLength(0);
      expect(fake.get(otherPath)).toEqual(other);
      if (kind === "removeTeamMember") {
        expect(fake.get("teams/" + DOC_ID).members).toBe(1);
        await expect(call(DOC_ID, "U-victim")).resolves.toEqual({ ok: true, alreadyRemoved: true });
        expect(fake.writesTo("users/U-victim")).toHaveLength(0);
      }
    });

    test("直接文件命中優先於其他文件的同名 id 欄位", async () => {
      const { fake, call } = setup(kind, {
        "teams/doc_impostor": { id: DOC_ID, captainUid: "U-other" },
        "teams/doc_impostor2": { id: DOC_ID, captainUid: "U-other2" },
      });
      await expect(call()).resolves.toMatchObject({ ok: true });
      expectCleaned(fake);
      expect(fake.has("teams/doc_impostor")).toBe(true);
      expect(fake.has("teams/doc_impostor2")).toBe(true);
    });
  });
}

describe("removeTeamMember 舊格式人數重算", () => {
  test.each(["teamIds", "teamId", "雙 id"])("10 人使用 %s 歸屬，剔除 1 人後去重寫回 9 人", async (field) => {
    const docs = {
      ["teams/" + DOC_ID]: { id: LOGICAL_ID, name: "舊格式俱樂部", captainUid: CAPTAIN, members: 10 },
      ["users/" + MEMBER]: { uid: MEMBER, role: "user", ...membership([LOGICAL_ID]) },
    };
    const ids = field === "雙 id" ? [DOC_ID, LOGICAL_ID] : [LOGICAL_ID];
    for (const uid of [CAPTAIN, ...Array.from({ length: 8 }, (_, i) => "U-remaining" + i)]) {
      docs["users/" + uid] = {
        uid, role: uid === CAPTAIN ? "captain" : "user",
        ...(field === "teamIds" ? { teamIds: ids } : field === "teamId" ? { teamId: LOGICAL_ID } : membership(ids)),
      };
    }
    const { fake, call } = setup("removeTeamMember", docs);
    await expect(call()).resolves.toMatchObject({ ok: true, alreadyRemoved: false, memberCount: 9 });
    expect(fake.get("teams/" + DOC_ID).members).toBe(9);
    expect(fake.get("users/" + MEMBER).teamIds).toEqual([]);
    for (const [path, data] of Object.entries(docs)) {
      if (path.startsWith("users/") && path !== "users/" + MEMBER) expect(fake.get(path)).toEqual(data);
    }
  });
});

describe("resolver 與交易邊界", () => {
  test("文件與邏輯 id 均查無 → null", async () => {
    const { fake } = setup("removeTeamMember");
    await expect(resolveTeamSnapshot(fake.db, "tm_missing", FakeHttpsError)).resolves.toBeNull();
    expect(fake.state.writes).toHaveLength(0);
  });

  test("交易開始前 id 欄位被改成別隊文件 id → 以交易現值重驗、不清別隊", async () => {
    const { fake, call } = setup("removeTeamMember");
    const runTransaction = fake.db.runTransaction;
    fake.db.runTransaction = async (callback) => {
      fake.touch("teams/" + DOC_ID, { id: KEEP_ID });
      return runTransaction(callback);
    };
    await expect(call()).resolves.toMatchObject({ ok: true, alreadyRemoved: false });
    expect(fake.get("users/" + MEMBER).teamIds).toEqual([LOGICAL_ID, KEEP_ID]);
  });

  test("交易開始前另隊占用舊 id → 交易內的查詢必須發現衝突", async () => {
    const { fake, call } = setup("removeTeamMember");
    const runTransaction = fake.db.runTransaction;
    fake.db.runTransaction = async (callback) => {
      fake.touch("teams/doc_new", { id: LOGICAL_ID });
      return runTransaction(callback);
    };
    await expect(call()).resolves.toMatchObject({ ok: true });
    expect(fake.get("users/" + MEMBER).teamIds).toEqual([LOGICAL_ID, KEEP_ID]);
  });
});


describe("deleteTeam 舊 id 的分批一致性", () => {
  test.each(["文件 id", "id 欄位"])("首批後另一隊占用%s：後續批次與 recheck 不清別隊", async (collision) => {
    const docs = {};
    for (let i = 0; i < 450; i += 1) {
      const uid = "U-a" + String(i).padStart(3, "0");
      docs["users/" + uid] = { uid, role: "user", ...membership([DOC_ID, LOGICAL_ID]) };
    }
    const { fake, call } = setup("deleteTeam", docs);
    const runTransaction = fake.db.runTransaction;
    let injected = false;
    const injectCollision = () => {
      if (!injected) {
        injected = true;
        const path = collision === "文件 id" ? "teams/" + LOGICAL_ID : "teams/doc_new";
        fake.touch(path, { id: LOGICAL_ID, captainUid: "U-other" });
        fake.touch("users/U-new-victim", { uid: "U-new-victim", ...membership([LOGICAL_ID]) });
      }
    };
    fake.db.runTransaction = async (callback) => {
      const result = await runTransaction(callback);
      injectCollision();
      return result;
    };
    const makeBatch = fake.db.batch;
    fake.db.batch = () => {
      const batch = makeBatch();
      const commit = batch.commit;
      batch.commit = async () => {
        await commit();
        injectCollision();
      };
      return batch;
    };
    await expect(call()).resolves.toMatchObject({ ok: true, alreadyDeleted: false, cleanedMembers: 451 });
    expect(injected).toBe(true);
    // 排在首批之後的本隊成員只清文件 id，已被別隊占用的舊 id 必須保留。
    expect(fake.get("users/" + MEMBER).teamIds).toEqual([LOGICAL_ID, KEEP_ID]);
    expect(fake.get("users/U-new-victim").teamIds).toEqual([LOGICAL_ID]);
    expect(fake.writesTo("users/U-new-victim")).toHaveLength(0);
    expect(fake.has("teams/" + DOC_ID)).toBe(false);
  });

  test("成員列舉後、交易前才出現衝突，寫入時仍須重驗", async () => {
    const { fake, call } = setup("deleteTeam");
    const runTransaction = fake.db.runTransaction;
    fake.db.runTransaction = async (callback) => {
      fake.touch("teams/doc_new", { id: LOGICAL_ID });
      return runTransaction(callback);
    };
    await expect(call()).resolves.toMatchObject({ ok: true, alreadyDeleted: false });
    expect(fake.get("users/" + MEMBER).teamIds).toEqual([LOGICAL_ID, KEEP_ID]);
    expect(fake.writesTo("users/" + MEMBER)[0].via).toBe("tx");
  });
});
