"use strict";

// 健檢 C1-03 第二步：migrateLegacyUserDoc（舊格式會員文件由後端代遷）單元測試。
// 交易與 create 的真實語意另見 tests/emulator/legacy-user-migration-emulator.test.js。

const {
  AUDIT_COLLECTION,
  RULES_CREATE_ALLOWED_KEYS,
  FORBIDDEN_KEYS,
  assessLegacyUserDoc,
  auditDocId,
  migrateLegacyUserDoc,
} = require("../../functions/legacy-user-migration");
const { createRecountTeamMembersHandler } = require("../../functions/team-member-count");
const { recountAndWriteTeamMembers } = require("../../functions/team-membership-core");
const {
  FakeHttpsError,
  FieldValue,
  SERVER_TS,
  createFakeFirestore,
  createLogger,
} = require("./team-callable-fake-db");

const UID = "Uabcdef1234567890";
const OTHER = "Uzzzzzz9999999999";
const LEGACY = "legacyDoc_0001";
const CANON = `users/${UID}`;
const LEGACY_PATH = `users/${LEGACY}`;
const AUDIT_PATH = `${AUDIT_COLLECTION}/${auditDocId(UID)}`;

const OLD_CREATED_AT = "2025-03-01T08:00:00.000Z";

function legacyDoc(extra = {}) {
  return {
    lineUserId: UID,
    displayName: "舊名字",
    pictureUrl: "https://example.com/a.png",
    role: "user",
    exp: 0,
    level: 1,
    createdAt: OLD_CREATED_AT,
    ...extra,
  };
}

function setup(seed = {}) {
  const fake = createFakeFirestore(seed);
  const logger = createLogger();
  const call = (request) => migrateLegacyUserDoc(request, { db: fake.db, HttpsError: FakeHttpsError, FieldValue, logger });
  return { fake, logger, call };
}

const authed = (uid = UID, data = undefined) => ({ auth: { uid, token: {} }, data });

describe("migrateLegacyUserDoc", () => {
  test("未登入回 unauthenticated，不讀不寫", async () => {
    const { fake, call } = setup({ [LEGACY_PATH]: legacyDoc() });
    await expect(call({ data: { uid: UID } })).rejects.toMatchObject({ code: "unauthenticated" });
    expect(fake.state.writes).toEqual([]);
  });

  test("沒有舊文件回 no-legacy，不寫任何東西", async () => {
    const { fake, call } = setup({});
    await expect(call(authed())).resolves.toEqual({ status: "no-legacy" });
    expect(fake.state.writes).toEqual([]);
  });

  test("正本已存在回 already，不覆寫正本也不動舊文件", async () => {
    const existing = { uid: UID, lineUserId: UID, displayName: "正本", teamIds: [], teamId: null, exp: 9 };
    const { fake, call } = setup({ [CANON]: existing, [LEGACY_PATH]: legacyDoc({ teamId: "tm_a" }) });
    await expect(call(authed())).resolves.toEqual({ status: "already" });
    expect(fake.get(CANON)).toEqual(existing);
    expect(fake.state.writes).toEqual([]);
  });

  test("只有 teamId 的舊文件：teamIds 補成 [teamId]、名稱長度一致，createdAt／exp／level 照原值", async () => {
    const { fake, call } = setup({
      [LEGACY_PATH]: legacyDoc({ teamId: "tm_a", teamName: "甲隊", exp: 500, level: 7 }),
    });
    await expect(call(authed())).resolves.toEqual({ status: "migrated" });
    const doc = fake.get(CANON);
    expect(doc).toMatchObject({
      uid: UID,
      lineUserId: UID,
      displayName: "舊名字",
      role: "user",
      teamId: "tm_a",
      teamName: "甲隊",
      teamIds: ["tm_a"],
      teamNames: ["甲隊"],
      exp: 500,
      level: 7,
      createdAt: OLD_CREATED_AT,
      lastLogin: SERVER_TS,
      updatedAt: SERVER_TS,
    });
    // 舊文件不刪不改。
    expect(fake.get(LEGACY_PATH)).toEqual(legacyDoc({ teamId: "tm_a", teamName: "甲隊", exp: 500, level: 7 }));
    expect(fake.writesTo("users/")).toHaveLength(1);
    // 正本與稽核在同一次交易提交。
    const commits = new Set(fake.state.writes.map((w) => `${w.via}:${w.commit}`));
    expect(commits.size).toBe(1);
  });

  test("teamIds 與 teamId 不一致時以 teamIds 為準；名稱對不上時讀 teams 補，隊伍不存在給空字串", async () => {
    const { fake, call } = setup({
      [LEGACY_PATH]: legacyDoc({
        teamId: "tm_x",
        teamName: "舊隊",
        teamIds: ["tm_b", "tm_c", "tm_b", "tm_gone"],
        teamNames: ["只有一個"],
      }),
      "teams/tm_b": { id: "tm_b", name: "乙隊" },
      "teams/tm_c": { id: "tm_c", name: "丙隊" },
    });
    await expect(call(authed())).resolves.toEqual({ status: "migrated" });
    const doc = fake.get(CANON);
    expect(doc.teamIds).toEqual(["tm_b", "tm_c", "tm_gone"]);
    expect(doc.teamNames).toEqual(["乙隊", "丙隊", ""]);
    expect(doc.teamId).toBe("tm_b");
    expect(doc.teamName).toBe("乙隊");
    expect(fake.get(AUDIT_PATH)).toMatchObject({ status: "migrated", teamCount: 3, unresolvedTeamNames: 1 });
  });

  test("沒有俱樂部、沒有 createdAt 的舊文件：補 teamId null、teamIds []、createdAt 用伺服器時間", async () => {
    const legacy = legacyDoc();
    delete legacy.createdAt;
    const { fake, call } = setup({ [LEGACY_PATH]: legacy });
    await expect(call(authed())).resolves.toEqual({ status: "migrated" });
    expect(fake.get(CANON)).toMatchObject({
      teamId: null, teamName: null, teamIds: [], teamNames: [], createdAt: SERVER_TS,
    });
  });

  test("限制類欄位（已解除的紀錄）與放鴿子統計原樣帶到正本，不被洗掉", async () => {
    const restriction = {
      isRestricted: false,
      restricted: false,
      restrictedAt: null,
      restrictedByUid: null,
      restrictedByName: null,
      noShowCount: 4,
      endedRegCount: 12,
      lastEventWasNoShow: true,
    };
    const { fake, call } = setup({ [LEGACY_PATH]: legacyDoc({ teamIds: ["tm_a"], teamNames: ["甲隊"], ...restriction }) });
    await expect(call(authed())).resolves.toEqual({ status: "migrated" });
    expect(fake.get(CANON)).toMatchObject(restriction);
  });

  test.each([
    ["isRestricted", { isRestricted: true, restrictedAt: "2026-05-01T00:00:00.000Z", restrictedByUid: "Uadmin00000000000" }],
    ["restricted 別名", { restricted: true }],
  ])("限制中（%s）先不遷：不建正本、舊文件限制原封不動", async (_label, restriction) => {
    const legacy = legacyDoc({ teamId: "tm_a", ...restriction });
    const { fake, call } = setup({ [LEGACY_PATH]: legacy });
    await expect(call(authed())).resolves.toEqual({ status: "not-migratable", reason: "restricted" });
    expect(fake.has(CANON)).toBe(false);
    expect(fake.get(LEGACY_PATH)).toEqual(legacy);
    expect(fake.get(AUDIT_PATH)).toMatchObject({ status: "not-migratable", reason: "restricted" });
  });

  test("Rules 建立白名單內的欄位照帶（不含伺服器決定的欄位）", async () => {
    const extra = {
      phone: "0900000000", email: "a@example.com", gender: "男", birthday: "1990-01-01", region: "台北", sports: "籃球",
      titleBig: null, titleNormal: null, totalGames: 3, completedGames: 2, attendanceRate: 0.5, badgeCount: 1,
      profileCompleted: true, favorites: { events: [] }, socialLinks: {}, lineNotify: { bound: true },
      companions: [], eduChildren: [], stealth: false, photoURL: null,
      termsAcceptedAt: "t", privacyAcceptedAt: "p", termsVersion: "v1", privacyVersion: "v1", legalAcceptedSource: "a",
    };
    const { fake, call } = setup({ [LEGACY_PATH]: legacyDoc(extra) });
    await expect(call(authed())).resolves.toEqual({ status: "migrated" });
    expect(fake.get(CANON)).toMatchObject(extra);
    expect(Object.keys(extra).every((key) => RULES_CREATE_ALLOWED_KEYS.includes(key))).toBe(true);
  });

  test.each([
    ["admin", "role-not-user"],
    ["coach", "role-not-user"],
    ["super_admin", "role-not-user"],
  ])("非 user 角色（%s）回 not-migratable，不寫正本，稽核列出角色且 uid 已遮罩", async (role, reason) => {
    const { fake, logger, call } = setup({ [LEGACY_PATH]: legacyDoc({ role, teamId: "tm_a" }) });
    await expect(call(authed())).resolves.toEqual({ status: "not-migratable", reason });
    expect(fake.has(CANON)).toBe(false);
    const audit = fake.get(AUDIT_PATH);
    expect(audit).toMatchObject({ status: "not-migratable", reason, legacyRole: role, legacyDocPrefix: "lega" });
    expect(JSON.stringify(audit)).not.toContain(UID);
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain(UID);
    expect(Object.keys(audit)).not.toContain("uid");
  });

  test("舊文件與 token 都沒有名稱：displayName 用固定預設名，不用原始 uid", async () => {
    const { fake, call } = setup({ [LEGACY_PATH]: legacyDoc({ displayName: "  " }) });
    await expect(call(authed())).resolves.toEqual({ status: "migrated" });
    expect(fake.get(CANON).displayName).toBe("用戶");
  });

  test("角色缺欄可遷，正本 role 寫 user", async () => {
    const legacy = legacyDoc({ teamId: "tm_a" });
    delete legacy.role;
    const { fake, call } = setup({ [LEGACY_PATH]: legacy });
    await expect(call(authed())).resolves.toEqual({ status: "migrated" });
    expect(fake.get(CANON).role).toBe("user");
  });

  test.each(FORBIDDEN_KEYS.map((key) => [key]))("舊文件有禁止鍵 %s 回 not-migratable，不寫正本", async (key) => {
    const { fake, call } = setup({ [LEGACY_PATH]: legacyDoc({ [key]: key === "claims" ? { role: "user" } : "x" }) });
    await expect(call(authed())).resolves.toEqual({ status: "not-migratable", reason: "forbidden-keys" });
    expect(fake.has(CANON)).toBe(false);
    expect(fake.get(AUDIT_PATH).forbiddenKeys).toEqual([key]);
  });

  test("白名單外的鍵回 not-migratable（unknown-keys），稽核只列鍵名不列值", async () => {
    const { fake, call } = setup({ [LEGACY_PATH]: legacyDoc({ name: "秘密值", someLegacyFlag: 1 }) });
    await expect(call(authed())).resolves.toEqual({ status: "not-migratable", reason: "unknown-keys" });
    expect(fake.has(CANON)).toBe(false);
    const audit = fake.get(AUDIT_PATH);
    expect(audit.unknownKeys).toEqual(["name", "someLegacyFlag"]);
    expect(JSON.stringify(audit)).not.toContain("秘密值");
  });

  test.each([
    ["exp 是字串", { exp: "500" }],
    ["teamIds 不是陣列", { teamIds: "tm_a" }],
    ["teamIds 含空字串", { teamIds: ["tm_a", ""] }],
    ["phone 不是字串", { phone: 912345678 }],
    ["createdAt 為 null", { createdAt: null }],
  ])("型別不符（%s）回 not-migratable（invalid-field）", async (_label, extra) => {
    const { fake, call } = setup({ [LEGACY_PATH]: legacyDoc(extra) });
    await expect(call(authed())).resolves.toEqual({ status: "not-migratable", reason: "invalid-field" });
    expect(fake.has(CANON)).toBe(false);
  });

  test("同一 lineUserId 有兩筆舊文件回 ambiguous-legacy，不猜", async () => {
    const { fake, call } = setup({
      [LEGACY_PATH]: legacyDoc(),
      "users/legacyDoc_0002": legacyDoc({ displayName: "另一份" }),
    });
    await expect(call(authed())).resolves.toEqual({ status: "not-migratable", reason: "ambiguous-legacy" });
    expect(fake.has(CANON)).toBe(false);
  });

  test("舊文件 uid 欄位指向別人回 uid-mismatch", async () => {
    const { fake, call } = setup({ [LEGACY_PATH]: legacyDoc({ uid: OTHER }) });
    await expect(call(authed())).resolves.toEqual({ status: "not-migratable", reason: "uid-mismatch" });
    expect(fake.has(CANON)).toBe(false);
  });

  test("只能遷自己：request.data 帶別人的 uid 也一律忽略", async () => {
    const { fake, call } = setup({
      [LEGACY_PATH]: legacyDoc(),
      "users/legacyOther": { ...legacyDoc(), lineUserId: OTHER, displayName: "別人" },
    });
    await expect(call(authed(UID, { uid: OTHER, targetUid: OTHER, lineUserId: OTHER }))).resolves.toEqual({ status: "migrated" });
    expect(fake.has(CANON)).toBe(true);
    expect(fake.has(`users/${OTHER}`)).toBe(false);
    expect(fake.writesTo("users/").map((w) => w.path)).toEqual([CANON]);
  });

  test("冪等：重複呼叫第二次回 already，正本只寫一次", async () => {
    const { fake, call } = setup({ [LEGACY_PATH]: legacyDoc({ teamId: "tm_a", teamName: "甲隊" }) });
    await expect(call(authed())).resolves.toEqual({ status: "migrated" });
    const first = fake.get(CANON);
    await expect(call(authed())).resolves.toEqual({ status: "already" });
    expect(fake.get(CANON)).toEqual(first);
    expect(fake.writesTo("users/")).toHaveLength(1);
  });

  test("並發：別人在交易提交前先建好正本 → create 失敗轉成 already，不覆寫", async () => {
    const { fake, call } = setup({ [LEGACY_PATH]: legacyDoc({ teamId: "tm_a", teamName: "甲隊" }) });
    fake.state.beforeCommit = ({ commitNumber }) => {
      if (commitNumber === 1) fake.touch(CANON, { uid: UID, displayName: "先到的" });
    };
    await expect(call(authed())).resolves.toEqual({ status: "already" });
    expect(fake.get(CANON)).toEqual({ uid: UID, displayName: "先到的" });
    expect(fake.writesTo("users/")).toHaveLength(0);
  });

  test("並發兩次呼叫：一筆 migrated、一筆 already", async () => {
    const { fake, call } = setup({ [LEGACY_PATH]: legacyDoc({ teamId: "tm_a", teamName: "甲隊" }) });
    const results = await Promise.all([call(authed()), call(authed())]);
    expect(results.map((r) => r.status).sort()).toEqual(["already", "migrated"]);
    expect(fake.writesTo("users/")).toHaveLength(1);
  });

  test("交易非預期失敗：記遮罩 log 並回 internal", async () => {
    const { fake, logger, call } = setup({ [LEGACY_PATH]: legacyDoc() });
    // 錯誤訊息帶文件路徑（含 uid）時也要遮罩。
    fake.state.failCommit = () => Object.assign(new Error(`boom at users/${UID}`), { code: 13 });
    await expect(call(authed())).rejects.toMatchObject({ code: "internal" });
    expect(logger.error).toHaveBeenCalled();
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(UID);
  });

  test("not-migratable 時稽核寫入失敗不改變回傳結果", async () => {
    const { fake, logger, call } = setup({ [LEGACY_PATH]: legacyDoc({ role: "admin" }) });
    fake.state.failWrite = ({ path }) => (path === AUDIT_PATH ? new Error("audit down") : null);
    await expect(call(authed())).resolves.toEqual({ status: "not-migratable", reason: "role-not-user" });
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("assessLegacyUserDoc", () => {
  test("多個問題時全部列出，第一個是回傳 reason", () => {
    const result = assessLegacyUserDoc(legacyDoc({ role: "admin", manualRole: "admin", isRestricted: true, extra: 1 }), UID);
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual(["forbidden-keys", "role-not-user", "restricted", "unknown-keys"]);
  });
});

describe("代遷後俱樂部成員不重複（舊文件與正本並存）", () => {
  const TEAM = "tm_team_a";
  function seedAfterMigration() {
    return {
      [`teams/${TEAM}`]: { id: TEAM, name: "甲隊", captainUid: "Ucaptain000000000", members: 0 },
      "users/Ucaptain000000000": { uid: "Ucaptain000000000", lineUserId: "Ucaptain000000000", teamIds: [TEAM], teamId: TEAM },
      // 舊文件：多半沒有 uid 欄位。
      [LEGACY_PATH]: legacyDoc({ teamId: TEAM, teamName: "甲隊" }),
    };
  }

  test("recountAndWriteTeamMembers：代遷前 2 人，代遷後仍是 2 人", async () => {
    const { fake, call } = setup(seedAfterMigration());
    const teamRef = fake.db.collection("teams").doc(TEAM);
    await expect(recountAndWriteTeamMembers({ db: fake.db, FieldValue, teamRef })).resolves.toBe(2);
    await expect(call(authed())).resolves.toEqual({ status: "migrated" });
    expect(fake.get(CANON).teamIds).toEqual([TEAM]);
    await expect(recountAndWriteTeamMembers({ db: fake.db, FieldValue, teamRef })).resolves.toBe(2);
  });

  test("recountTeamMembers Callable：代遷後仍是 2 人", async () => {
    const { fake, call } = setup(seedAfterMigration());
    await expect(call(authed())).resolves.toEqual({ status: "migrated" });
    const handler = createRecountTeamMembersHandler({
      HttpsError: FakeHttpsError, db: fake.db, FieldValue, getCallerAccessContext: async () => null, logger: createLogger(),
    });
    await expect(handler({ auth: { uid: UID }, data: { teamId: TEAM } })).resolves.toMatchObject({ members: 2 });
  });
});
