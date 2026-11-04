"use strict";

// 執行 index.js 的原始函式／Callable callback；不複製授權 predicate。
// B4 另逐一執行 AST 找到的全部 resolver 呼叫表達式，驗證資料 shape／拒絕／交易讀取。
// 這是記憶體 Firestore 單元測試，不是 emulator 或正式環境驗收。
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { parse } = require("@babel/parser");
const core = require("../../functions/team-membership-core");

const source = fs.readFileSync(path.join(__dirname, "../../functions/index.js"), "utf8");
const ast = parse(source, { sourceType: "script" });
const functions = new Map();
const callables = new Map();
for (const node of ast.program.body) {
  if (node.type === "FunctionDeclaration") functions.set(node.id.name, node);
  const expression = node.type === "ExpressionStatement" ? node.expression : null;
  if (expression?.type === "AssignmentExpression" && expression.left?.object?.name === "exports"
    && expression.right?.callee?.name === "onCall") {
    callables.set(expression.left.property.name, expression.right.arguments.at(-1));
  }
}
const raw = (node) => source.slice(node.start, node.end);
class HttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function createStore(seed = {}) {
  const data = new Map(Object.entries(seed));
  const reads = [];
  const writes = [];
  let serial = 0;
  const snapshot = (p) => ({
    id: p.split("/").at(-1), ref: doc(p), exists: data.has(p), data: () => data.get(p),
  });
  const write = (op, ref, value) => {
    writes.push({ op, path: ref.path, value });
    if (op === "delete") data.delete(ref.path);
    else data.set(ref.path, op === "update" ? { ...data.get(ref.path), ...value } : value);
  };
  const doc = (p) => ({
    path: p, id: p.split("/").at(-1),
    get: async () => { reads.push({ path: p, count: 1 }); return snapshot(p); },
    create: async (v) => write("create", doc(p), v),
    set: async (v) => write("set", doc(p), v),
    update: async (v) => write("update", doc(p), v),
    collection: (name) => collection(p + "/" + name),
  });
  const collection = (p, filters = [], limit = Infinity) => ({
    path: p,
    doc: (id = "auto_" + ++serial) => doc(p + "/" + id),
    add: async (v) => write("create", doc(p + "/auto_" + ++serial), v),
    where: (key, op, value) => collection(p, [...filters, { key, op, value }], limit),
    limit: (n) => collection(p, filters, n),
    get: async () => {
      const docs = [...data].filter(([k, v]) => k.startsWith(p + "/") && !k.slice(p.length + 1).includes("/")
        && filters.every(({ key, op, value }) => op === "array-contains" ? v[key]?.includes(value) : v[key] === value))
        .slice(0, limit).map(([k]) => snapshot(k));
      reads.push({ path: p, count: Math.max(1, docs.length), limit });
      return { docs, empty: !docs.length, forEach: (f) => docs.forEach(f) };
    },
  });
  const writer = () => {
    const pending = [];
    return {
      create: (r, v) => pending.push(["create", r, v]),
      set: (r, v) => pending.push(["set", r, v]),
      update: (r, v) => pending.push(["update", r, v]),
      delete: (r) => pending.push(["delete", r]),
      commit: async () => pending.forEach((args) => write(...args)),
    };
  };
  const txReads = [];
  const db = {
    collection,
    batch: writer,
    runTransaction: async (callback) => {
      const batch = writer();
      const tx = { ...batch, get: async (ref) => { txReads.push(ref.path); return ref.get(); } };
      const result = await callback(tx);
      await batch.commit();
      return result;
    },
  };
  return { db, reads, writes, txReads, data };
}

const commonNames = [
  "getTeamDocByTeamId", "getTeamDocByTeamIdInTransaction",
  "isRoleAdminOrAbove", "isTeamStaffForData", "isTournamentTeamOfficerForData",
  "getTournamentDelegateUidSet", "canManageTournamentDataInTransaction",
  "hasEduCourseStaffAccess", "isEventOwnerForUid", "isEventDelegateForUid",
];
function load(store, names = [], overrides = {}) {
  const sandbox = {
    ...core, db: store.db, HttpsError,
    console: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
    normalizeRole: (r) => r || "user",
    sanitizeStr: (v, max) => typeof v === "string" ? v.trim().slice(0, max) : "",
    exports: {},
    ...overrides,
  };
  const definitions = [...new Set([...commonNames, ...names.filter((n) => functions.has(n))])]
    .map((name) => raw(functions.get(name)));
  for (const name of names.filter((n) => callables.has(n))) definitions.push("exports." + name + " = " + raw(callables.get(name)) + ";");
  vm.runInNewContext(definitions.join("\n"), sandbox);
  return sandbox;
}
const access = (permissions = [], isSuperAdmin = false) => ({
  role: isSuperAdmin ? "super_admin" : "user", isSuperAdmin,
  hasPermission: (p) => permissions.includes(p),
});
const request = (extra = {}) => ({
  auth: { uid: "uidCaller", token: {} },
  data: { teamId: "tm_test", planId: "plan", sessionId: "session", ...extra },
});

// B4 caller inventory：新增／移除呼叫者時測試失敗，施工者必須審視新呼叫鏈。
const expectedCallers = [
  "canManageTournamentDataInTransaction", "createFriendlyTournament", "applyFriendlyTournament",
  "withdrawFriendlyTournamentTeam", "reviewFriendlyTournamentApplication", "joinFriendlyTournamentRoster",
  "loadCourseCancellationAttendanceContextsInTransaction", "syncCourseAttendanceToLinkedEvent",
  "validateCourseLessonLinkedEventReady", "syncCourseLessonRosterToEventInternal",
  "syncCourseLessonEventDetailsFromSessionInternal", "syncEduCoursePlanAutoSessionRostersInternal",
  "syncEduCoursePlanAutoSessionRostersForStudentChange", "listEduCourseEnrollments",
  "listEduCourseEnrollmentSummaries", "syncEduCoursePlanAutoSessionRosters",
  "getEduStudentAttendanceOverview", "listEduCoursePublicRoster", "saveEduCourseSelfLeave",
  "saveEduCourseSelfAttendance", "updateEduCourseSession", "saveEduSessionAttendanceChanges",
  "createEventFromCourseLesson", "syncCourseLessonRosterToEvent", "registerForEduCoursePlan",
  "cancelCourseEnrollment", "approveCourseEnrollment", "migrateEduCourseAutoEnrollments",
  "adjustTeamReservation", "sanitizeDeliverToInboxMessage", "assertCallerCanReviewGroupActionDocs",
];
const resolverCalls = [];
function visit(node, owner) {
  if (!node || typeof node !== "object") return;
  if (node.type === "CallExpression" && ["getTeamDocByTeamId", "getTeamDocByTeamIdInTransaction"].includes(node.callee?.name)) {
    resolverCalls.push({ owner, text: raw(node), label: owner + ":" + node.loc.start.line, tx: node.callee.name.endsWith("InTransaction") });
  }
  for (const [key, child] of Object.entries(node)) {
    if (["loc", "start", "end"].includes(key)) continue;
    if (Array.isArray(child)) child.forEach((n) => visit(n, owner));
    else if (child && typeof child === "object") visit(child, owner);
  }
}
for (const [name, node] of [...functions, ...callables]) visit(node, name);

describe("B4 全部呼叫端的 resolver 表達式契約", () => {
  test("涵蓋所有實際 caller，含一支函式內多個呼叫點", () => {
    expect([...new Set(resolverCalls.map((c) => c.owner))].sort()).toEqual(expectedCallers.sort());
  });
  describe.each(resolverCalls.map((c) => [c.label, c]))("%s", (_label, call) => {
    test.each([
      ["direct", { tm_test: { id: "forged", createdVia: "user_capability" }, impostor: { id: "tm_test" } }, "tm_test", 1],
      ["unique legacy", { legacy: { id: "tm_test" } }, "legacy", 2],
      ["ambiguous", { old: { id: "tm_test" }, attacker: { id: "tm_test", createdVia: "user_capability" } }, null, 3],
      ["missing", {}, null, 2],
    ])("%s：shape、讀取上限、交易途徑、零寫入", async (scenario, teams, expectedId, readCount) => {
      const store = createStore(Object.fromEntries(Object.entries(teams).map(([id, team]) => ["teams/" + id, team])));
      const ctx = load(store);
      const txGet = jest.fn(async (ref) => ref.get());
      Object.assign(ctx, {
        tx: { get: txGet }, transaction: { get: txGet },
        teamId: "tm_test", safeTeamId: "tm_test", hostTeamId: "tm_test", applicationTeamId: "tm_test",
        tournament: { hostTeamId: "tm_test" },
      });
      const result = vm.runInNewContext("(async () => " + call.text + ")()", ctx);
      if (scenario === "ambiguous") {
        await expect(result).rejects.toMatchObject({ code: "failed-precondition", message: "TEAM_ID_AMBIGUOUS" });
      } else if (expectedId) {
        const doc = await result;
        expect(doc).toMatchObject({ docId: expectedId, data: teams[expectedId] });
        expect(doc.ref.path).toBe("teams/" + expectedId);
      } else expect(await result).toBeNull();
      expect(store.reads.reduce((sum, r) => sum + r.count, 0)).toBe(readCount);
      expect(store.reads.length).toBe(scenario === "direct" ? 1 : 2);
      expect(txGet).toHaveBeenCalledTimes(call.tx ? store.reads.length : 0);
      expect(store.writes).toHaveLength(0);
    });
  });
});

// T-090f P1-1：巢狀路徑 teamId 會讓 teams.doc() 指到子集合文件（缺 createdVia 被當管理端俱樂部）。
const NESTED_IDS = ["tm_owner/students/forged", "tm_owner/students", "..", ".", "__x__", "a".repeat(129), " tm_owner/x "];
const nestedSeed = () => ({
  "teams/tm_owner": { captainUid: "uidOther", createdVia: "user_capability" },
  "teams/tm_owner/students/forged": { captainUid: "uidCaller", ownerUid: "uidCaller", coachUids: ["uidCaller"] },
});

describe("P1-1 共用 resolver 邊界拒絕巢狀路徑", () => {
  test.each(NESTED_IDS)("resolveTeamSnapshot(%j)：查無、零讀取", async (teamId) => {
    const store = createStore(nestedSeed());
    await expect(core.resolveTeamSnapshot(store.db, teamId, HttpsError)).resolves.toBeNull();
    expect(store.reads).toHaveLength(0);
  });
  test.each([null, undefined, 7, {}, ["tm_owner"], ""])("非字串或空 %j：查無、零讀取", async (teamId) => {
    const store = createStore({ "teams/tm_owner": {} });
    await expect(core.resolveTeamSnapshot(store.db, teamId, HttpsError)).resolves.toBeNull();
    const ctx = load(store);
    await expect(ctx.getTeamDocByTeamId(teamId)).resolves.toBeNull();
    await expect(ctx.getTeamDocByTeamIdInTransaction({ get: (r) => r.get() }, teamId)).resolves.toBeNull();
    expect(store.reads).toHaveLength(0);
  });
  test.each(["tm_test", "tm test", "TM-1_x", "a".repeat(128)])("F1 既有合法 id %j 不退化：直接文件命中", async (teamId) => {
    const store = createStore({ ["teams/" + teamId]: { captainUid: "uidCaller" } });
    const snap = await core.resolveTeamSnapshot(store.db, teamId, HttpsError);
    expect(snap.id).toBe(teamId);
    expect(core.normalizeId(teamId)).toBe(teamId);
  });
  test("wrapper 仍 trim 頭尾空白（既有行為），單一路徑段照常解析", async () => {
    const store = createStore({ "teams/tm_test": { captainUid: "uidCaller" } });
    const ctx = load(store);
    await expect(ctx.getTeamDocByTeamId("  tm_test ")).resolves.toMatchObject({ docId: "tm_test" });
  });
  describe.each(resolverCalls.map((c) => [c.label, c]))("%s 巢狀路徑", (_label, call) => {
    test("查無、零讀取、零寫入", async () => {
      const store = createStore(nestedSeed());
      const ctx = load(store);
      const txGet = jest.fn(async (ref) => ref.get());
      const nested = NESTED_IDS[0];
      Object.assign(ctx, {
        tx: { get: txGet }, transaction: { get: txGet },
        teamId: nested, safeTeamId: nested, hostTeamId: nested, applicationTeamId: nested,
        tournament: { hostTeamId: nested },
      });
      await expect(vm.runInNewContext("(async () => " + call.text + ")()", ctx)).resolves.toBeNull();
      expect(store.reads).toHaveLength(0);
      expect(store.writes).toHaveLength(0);
    });
  });
});

describe("P1-1 巢狀路徑攻擊在各入口被拒", () => {
  test("B1 adjustTeamReservation：不改他人活動名額，只留 dedupe", async () => {
    const store = createStore({
      ...nestedSeed(),
      "events/ev_test": { id: "ev_test", max: 10, status: "open", creatorUid: "uidOther", current: 0 },
    });
    const ctx = load(store, ["adjustTeamReservation"], {
      FieldValue: { serverTimestamp: () => "SERVER_TS" }, Timestamp: { fromDate: (v) => v },
      getUserRoleFromFirestore: async () => "user",
      findUserDocByUidOrLineUserId: async () => ({ data: { displayName: "test" } }),
      getEventDocByPublicIdInTransaction: (tx, id) => tx.get(store.db.collection("events").doc(id)),
      isCourseLinkedEventData: () => false,
    });
    await expect(ctx.exports.adjustTeamReservation(request({
      eventId: "ev_test", teamId: NESTED_IDS[0], reservedSlots: 10, requestId: "request_nested",
    }))).rejects.toMatchObject({ code: "not-found", message: "TEAM_NOT_FOUND" });
    expect(store.reads.map((r) => r.path)).toEqual(["events/ev_test"]);
    expect(store.writes.map((w) => w.path)).toEqual(["_regDedupe/request_nested"]);
    expect(store.data.get("events/ev_test")).toMatchObject({ current: 0, status: "open" });
  });

  test.each(["user", "admin"])("B8 createFriendlyTournament（%s）：主辦隊巢狀路徑查無，零賽事寫入", async (role) => {
    const store = createStore(nestedSeed());
    const ctx = load(store, ["createFriendlyTournament"], {
      getTournamentSportTagFromData: () => "football",
      getTimestampMillis: (v) => Date.parse(v), validateClientTournamentId: (v) => v,
      findUserDocByUidOrLineUserId: async () => ({ data: { displayName: "test" } }),
      getCallerRoleWithFallback: async () => role,
      buildTournamentRootForCreate: ({ tournamentId, hostTeamId }) => ({ id: tournamentId, hostTeamId }),
      buildServerHostEntry: ({ teamId }) => ({ teamId }),
    });
    await expect(ctx.exports.createFriendlyTournament(request({
      tournament: { id: "ct_test", name: "test", hostTeamId: NESTED_IDS[0], regStart: "2030-01-01", regEnd: "2030-01-02" },
    }))).rejects.toMatchObject({ code: "not-found" });
    expect(store.reads).toHaveLength(0);
    expect(store.writes).toHaveLength(0);
  });

  test.each(NESTED_IDS)("eduCheckin %j：入口拒絕，零讀寫", async (teamId) => {
    const store = createStore(nestedSeed());
    // index.js 以 normalizeTeamId 別名匯入 F1 同一個 normalizeId。
    const ctx = load(store, ["eduCheckin"], { normalizeTeamId: core.normalizeId });
    await expect(ctx.exports.eduCheckin(request({ teamId, records: [{ studentId: "s1" }] })))
      .rejects.toMatchObject({ code: "invalid-argument" });
    expect(store.reads).toHaveLength(0);
    expect(store.writes).toHaveLength(0);
  });

  const { createDeleteTeamHandler } = require("../../functions/team-deletion");
  const { createRemoveTeamMemberHandler } = require("../../functions/team-member-removal");
  test.each(NESTED_IDS)("deleteTeam／removeTeamMember %j：入口拒絕，零讀寫", async (teamId) => {
    const store = createStore(nestedSeed());
    const deps = { db: store.db, HttpsError, FieldValue: {}, roleLevels: {}, logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() } };
    await expect(createDeleteTeamHandler(deps)({ auth: { uid: "uidCaller" }, data: { teamId } }))
      .rejects.toMatchObject({ code: "invalid-argument" });
    await expect(createRemoveTeamMemberHandler(deps)({ auth: { uid: "uidCaller" }, data: { teamId, memberUid: "uidX" } }))
      .rejects.toMatchObject({ code: "invalid-argument" });
    expect(store.reads).toHaveLength(0);
    expect(store.writes).toHaveLength(0);
  });
});

describe("B4 賽事管理真實授權 helper", () => {
  test("重複別名不任選攻擊者；直接文件優先不借用另一隊職員", async () => {
    const store = createStore({
      "teams/attacker": { id: "tm_test", captainUid: "uidCaller", createdVia: "user_capability" },
      "teams/old": { id: "tm_test", captainUid: "uidOther" },
    });
    const ctx = load(store);
    const tx = { get: (ref) => ref.get() };
    await expect(ctx.canManageTournamentDataInTransaction(tx, { hostTeamId: "tm_test" }, "uidCaller", "user"))
      .rejects.toMatchObject({ message: "TEAM_ID_AMBIGUOUS" });
    store.data.set("teams/tm_test", { captainUid: "uidOther", id: "forged" });
    expect(await ctx.canManageTournamentDataInTransaction(tx, { hostTeamId: "tm_test" }, "uidCaller", "user")).toBe(false);
    expect(store.writes).toHaveLength(0);
  });
  test.each(["admin", undefined])("管理端／legacy %s 唯一舊 id 職員可管理", async (createdVia) => {
    const store = createStore({ "teams/old": { id: "tm_test", captainUid: "uidCaller", createdVia } });
    const ctx = load(store);
    expect(await ctx.canManageTournamentDataInTransaction({ get: (r) => r.get() },
      { hostTeamId: "tm_test" }, "uidCaller", "user")).toBe(true);
  });
});

describe("B2 教學守門", () => {
  test.each(["user", "coach", "captain", "admin", "super_admin"])("自建隊伍 %s 即使全域權限仍拒絕", (role) => {
    const store = createStore();
    const ctx = load(store);
    expect(ctx.hasEduCourseStaffAccess({ createdVia: "user_capability", captainUid: "uidCaller" },
      "uidCaller", { ...access(["team.manage_all"], true), role })).toBe(false);
    expect(store.reads).toHaveLength(0);
  });
  test.each(["admin", undefined])("管理端／legacy %s 保留職員與全域管理路徑", (createdVia) => {
    const ctx = load(createStore());
    expect(ctx.hasEduCourseStaffAccess({ createdVia, captainUid: "uidCaller" }, "uidCaller", access())).toBe(true);
    expect(ctx.hasEduCourseStaffAccess({ createdVia }, "uidCaller", access(["team.manage_all"]))).toBe(true);
    expect(ctx.hasEduCourseStaffAccess({ createdVia }, "uidCaller", access([], true))).toBe(true);
    expect(ctx.hasEduCourseStaffAccess({ createdVia }, "uidCaller", access())).toBe(false);
  });
  const eduCallables = ["syncEduCoursePlanAutoSessionRosters", "updateEduCourseSession",
    "saveEduSessionAttendanceChanges", "createEventFromCourseLesson", "syncCourseLessonRosterToEvent"];
  describe.each(eduCallables)("%s 真實 callback", (name) => {
    test.each(["user_capability", "admin", undefined])("伺服器標記 %s，請求偽造標記不影響", async (createdVia) => {
      const store = createStore({ "teams/tm_test": { captainUid: "uidCaller", createdVia } });
      const overrides = {
        getCallerAccessContext: async () => access(),
        normalizeEduCourseRequestIds: (v) => v, normalizeEduCourseSessionRequestIds: (v) => v,
        sanitizeEduCourseSessionUpdates: (v) => v,
        createEduCourseHttpsError: (code) => new HttpsError(code === "PERMISSION_DENIED" ? "permission-denied" : "not-found", code),
        findUserDocByUidOrLineUserId: async () => ({ data: {} }),
        resolveCourseConvertedEventCreatorName: () => "test",
        buildCourseConvertedEventCreatorSnapshot: () => ({}),
        generateCourseConvertedEventId: () => "ce_test",
        syncEduCoursePlanAutoSessionRostersInternal: jest.fn(async () => ({ success: true })),
        syncCourseLessonRosterToEventInternal: jest.fn(async () => ({ success: true })),
      };
      const ctx = load(store, [name], overrides);
      const result = ctx.exports[name](request({
        updates: { title: "test" }, changes: [{ studentId: "student", kind: "signin" }],
        createdVia: createdVia === "user_capability" ? "admin" : "user_capability",
        teamData: { createdVia: "admin" },
      }));
      if (createdVia === "user_capability") {
        await expect(result).rejects.toMatchObject({ code: "permission-denied" });
        expect(store.reads.map((r) => r.path)).toEqual(["teams/tm_test"]);
      } else if (name.startsWith("sync")) {
        await expect(result).resolves.toEqual({ success: true });
      } else {
        // 通過 guard 後讀 coursePlans；空 fixture 在既有 PLAN_NOT_FOUND 停下，未宣稱完整課程成功。
        await expect(result).rejects.toMatchObject({ message: "PLAN_NOT_FOUND" });
        expect(store.reads.some((r) => r.path.includes("/coursePlans/"))).toBe(true);
      }
      expect(store.writes).toHaveLength(0);
    });
  });
});

describe("B8 createFriendlyTournament 真實 callback", () => {
  function setup(createdVia, role = "user") {
    const store = createStore({ "teams/tm_test": { captainUid: "uidCaller", createdVia } });
    const ctx = load(store, ["createFriendlyTournament"], {
      getTournamentSportTagFromData: () => "football",
      getTimestampMillis: (v) => Date.parse(v), validateClientTournamentId: (v) => v,
      findUserDocByUidOrLineUserId: async () => ({ data: { displayName: "test" } }),
      getCallerRoleWithFallback: async () => role,
      buildTournamentRootForCreate: ({ tournamentId, hostTeamId }) => ({ id: tournamentId, hostTeamId }),
      buildServerHostEntry: ({ teamId }) => ({ teamId }),
    });
    return { store, call: (hostTeamId = "tm_test") => ctx.exports.createFriendlyTournament(request({
      tournament: { id: "ct_test", name: "test", hostTeamId, regStart: "2030-01-01", regEnd: "2030-01-02", createdVia: "admin" },
      createdVia: "admin", teamData: { createdVia: "admin" },
    })) };
  }
  test.each(["user", "coach", "captain", "admin", "super_admin"])("自建隊伍拒 %s，零賽事寫入", async (role) => {
    const { store, call } = setup("user_capability", role);
    await expect(call()).rejects.toMatchObject({ message: "USER_CREATED_TEAM_CANNOT_HOST_TOURNAMENT" });
    expect(store.writes).toHaveLength(0);
    expect(store.reads).toHaveLength(1);
  });
  test.each(["admin", undefined])("管理端／legacy %s 建立成功", async (createdVia) => {
    const { store, call } = setup(createdVia);
    await expect(call()).resolves.toMatchObject({ tournamentId: "ct_test" });
    expect(store.writes.map((w) => w.path)).toEqual(["tournaments/ct_test", "tournaments/ct_test/entries/tm_test"]);
  });
  test("admin 不帶主辦隊沿用既有行為", async () => {
    const { store, call } = setup("user_capability", "admin");
    await expect(call("")).resolves.toMatchObject({ tournamentId: "ct_test" });
    expect(store.reads).toHaveLength(0);
    expect(store.writes).toHaveLength(1);
  });
});

describe("入隊審核同步 OWNER_FIELDS 例外", () => {
  const docs = (...ids) => ids.map((teamId) => ({ data: () => ({ actionType: "team_join_request", meta: { teamId } }) }));
  function setup(teams, permissions = [], callerUid = "uidCaller") {
    const store = createStore(Object.fromEntries(Object.entries(teams).map(([id, data]) => ["teams/" + id, data])));
    const getCallerAccessContext = jest.fn(async () => access(permissions));
    const ctx = load(store, ["assertCallerCanReviewGroupActionDocs"], { getCallerAccessContext });
    return { store, getCallerAccessContext, call: (...ids) =>
      ctx.assertCallerCanReviewGroupActionDocs({
        ...request({ createdVia: "user_capability", ownerUid: "uidCaller" }), auth: { uid: callerUid },
      }, docs(...ids), "group") };
  }
  test.each(["captainUid", "creatorUid", "ownerUid"])("%s 本人可審同隊且重用文件，零權限讀取", async (field) => {
    const env = setup({ tm_test: { createdVia: "user_capability", [field]: "uidCaller", id: "forged" } });
    await expect(env.call("tm_test", "tm_test")).resolves.toBeUndefined();
    expect(env.store.reads).toHaveLength(1);
    expect(env.getCallerAccessContext).not.toHaveBeenCalled();
  });
  test.each(["admin", undefined])("管理端／legacy %s 仍需權限，請求自帶標記不能放行", async (createdVia) => {
    const env = setup({ tm_test: { createdVia, captainUid: "uidCaller" } });
    await expect(env.call("tm_test")).rejects.toMatchObject({ code: "permission-denied" });
    await expect(setup({ tm_test: { createdVia, captainUid: "uidCaller" } }, ["team.review_join"]).call("tm_test"))
      .resolves.toBeUndefined();
  });
  test.each([
    { createdVia: "user_capability", coachUids: ["uidCaller"] },
    { createdVia: "user_capability", ownerUid: " uidCaller " },
    { createdVia: "user_capability", ownerUid: "uidOther" },
  ])("非 OWNER_FIELDS 本人無例外：%j", async (team) => {
    await expect(setup({ tm_test: team }).call("tm_test")).rejects.toMatchObject({ code: "permission-denied" });
  });
  test.each(["captainUid", "creatorUid", "ownerUid"])("%s 擁有者不能審別隊，也不能從 auth.uid 去空白借用本人例外", async (field) => {
    const teams = {
      tm_test: { createdVia: "user_capability", [field]: "uidCaller" },
      tm_other: { createdVia: "user_capability", [field]: "uidOther" },
    };
    const other = setup(teams);
    await expect(other.call("tm_other")).rejects.toMatchObject({ code: "permission-denied" });
    expect(other.store.reads.map((r) => r.path)).toEqual(["teams/tm_other"]);
    expect(other.store.writes).toHaveLength(0);
    const padded = setup(teams, [], " uidCaller ");
    await expect(padded.call("tm_test")).rejects.toMatchObject({ code: "permission-denied" });
    expect(padded.store.writes).toHaveLength(0);
  });
  test("直接文件優先；別隊偽造相同邏輯 id 的擁有者不授權", async () => {
    const env = setup({
      tm_test: { createdVia: "user_capability", ownerUid: "uidOther" },
      attacker: { id: "tm_test", createdVia: "user_capability", ownerUid: "uidCaller" },
    });
    await expect(env.call("tm_test")).rejects.toMatchObject({ code: "permission-denied" });
    expect(env.store.reads.map((r) => r.path)).toEqual(["teams/tm_test"]);
    expect(env.store.writes).toHaveLength(0);
  });
  test("非擁有者有既有審核權限及本隊職員身分仍照舊可審", async () => {
    await expect(setup({ tm_test: { createdVia: "user_capability", coachUids: ["uidCaller"] } },
      ["team.review_join"]).call("tm_test")).resolves.toBeUndefined();
  });
  test("混入別隊一律整批拒絕；相同邏輯 id 多筆拒絕", async () => {
    const env = setup({ tm_test: { createdVia: "user_capability", ownerUid: "uidCaller" },
      tm_other: { createdVia: "user_capability", ownerUid: "uidOther" } });
    await expect(env.call("tm_test", "tm_other")).rejects.toMatchObject({ code: "permission-denied" });
    expect(env.store.writes).toHaveLength(0);
    const ambiguous = setup({ first: { id: "tm_test", createdVia: "user_capability", ownerUid: "uidCaller" },
      second: { id: "tm_test" } });
    await expect(ambiguous.call("tm_test")).rejects.toMatchObject({ message: "TEAM_ID_AMBIGUOUS" });
  });
  test("唯一舊 id 使用 F1 解出的文件擁有者", async () => {
    await expect(setup({ old: { id: "tm_test", createdVia: "user_capability", ownerUid: "uidCaller" } }).call("tm_test"))
      .resolves.toBeUndefined();
  });
});

describe("B1 adjustTeamReservation 真實 callback 職員路徑", () => {
  function setup({ createdVia, event = {}, team = {}, role = "user", teamId = "tm_test", seed = {} } = {}) {
    const store = createStore({
      "teams/tm_test": { id: "tm_test", captainUid: "uidCaller", createdVia, ...team },
      "events/ev_test": { id: "ev_test", max: 10, status: "open", creatorUid: "uidOther", ...event },
      ...seed,
    });
    const ctx = load(store, ["adjustTeamReservation"], {
      FieldValue: { serverTimestamp: () => "SERVER_TS" }, Timestamp: { fromDate: (v) => v },
      getUserRoleFromFirestore: async () => role,
      findUserDocByUidOrLineUserId: async () => ({ data: { displayName: "test" } }),
      getEventDocByPublicIdInTransaction: (tx, id) => tx.get(store.db.collection("events").doc(id)),
      isCourseLinkedEventData: () => false,
      addTeamStaffUidsToSet: () => {},
      normalizeTeamReservationSummaries: () => [],
      rebuildOccupancy: (ed) => ({
        current: 0, waitlist: 0, realCurrent: 0, participants: [], waitlistNames: [],
        participantsWithUid: [], waitlistWithUid: [], status: "open",
        teamReservationSummaries: ed.teamReservationSummaries || [],
      }),
      promoteWaitlistForAvailableSeats: () => [],
      settleBestEffortPostCommitOps: async (_name, ops) => Promise.all(ops),
    });
    return { store, call: (extra = {}) => ctx.exports.adjustTeamReservation(request({
      eventId: "ev_test", teamId, reservedSlots: 2, requestId: "request_test",
      createdVia: "admin", teamData: { createdVia: "admin" }, creatorUid: "uidCaller", ...extra,
    })) };
  }
  test.each(["user", "coach", "captain"])("自建隊伍職員 %s 對別人活動拒絕，請求 owner／marker 偽造無效", async (role) => {
    const { store, call } = setup({ createdVia: "user_capability", role });
    await expect(call()).rejects.toMatchObject({ code: "permission-denied" });
    expect(store.reads.map((r) => r.path)).toEqual(["events/ev_test", "teams/tm_test"]);
    // 原流程先建 dedupe 文件，不能宣稱拒絕時零總寫入；業務文件零寫入。
    expect(store.writes.map((w) => w.path)).toEqual(["_regDedupe/request_test"]);
  });
  test.each([
    ["creator", { creatorUid: "uidCaller" }],
    ["owner", { ownerUid: "uidCaller" }],
    ["captain", { captainUid: "uidCaller" }],
    ["delegate", { delegateUids: ["uidCaller"] }],
  ])("自建俱樂部職員同時是活動 %s，可預留", async (_name, event) => {
    const { store, call } = setup({ createdVia: "user_capability", event });
    await expect(call()).resolves.toMatchObject({ success: true });
    expect(store.writes.map((w) => w.path)).toEqual([
      "_regDedupe/request_test", "events/ev_test/teamReservations/tm_test", "events/ev_test", "operationLogs/auto_1",
    ]);
  });
  test.each(["admin", undefined])("管理端／legacy %s：原有跨活動職員預留不變", async (createdVia) => {
    await expect(setup({ createdVia }).call({ createdVia: "user_capability" })).resolves.toMatchObject({ success: true });
  });
  test("僅活動擁有者但不是自建俱樂部職員仍拒絕", async () => {
    const { call } = setup({
      createdVia: "user_capability", team: { captainUid: "uidOther" }, event: { ownerUid: "uidCaller" },
    });
    await expect(call()).rejects.toMatchObject({ code: "permission-denied" });
  });
  test("同名舊 id 重複在名額讀寫前拒絕", async () => {
    const { store, call } = setup({ teamId: "tm_alias", seed: {
      "teams/old": { id: "tm_alias", captainUid: "uidOther" },
      "teams/attacker": { id: "tm_alias", captainUid: "uidCaller", createdVia: "user_capability" },
    } });
    await expect(call()).rejects.toMatchObject({ message: "TEAM_ID_AMBIGUOUS" });
    expect(store.writes.map((w) => w.path)).toEqual(["_regDedupe/request_test"]);
    expect(store.reads.some((r) => r.path.includes("registrations"))).toBe(false);
  });
  test.each(["admin", "super_admin"])("既有 %s 全域分支保持原碼行為（擴大限制待裁定）", async (role) => {
    await expect(setup({ createdVia: "user_capability", role }).call()).resolves.toMatchObject({ success: true });
  });
});
