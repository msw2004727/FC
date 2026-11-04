"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  createUserTeamCallable, createUserTeamHandler, MAX_USER_CREATED_TEAMS,
} = require("../../functions/user-team-create");

// T-090i createUserTeam：記憶體版交易模型（非 emulator／真 SDK 驗收）。
// 修正前 functions/user-team-create.js 不存在、index.js 無 createUserTeam 匯出，本檔全部失敗。
const indexSource = fs.readFileSync(path.join(__dirname, "../../functions/index.js"), "utf8");

class HttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const ME = "users/me";
const CAP = "roleActivityCapabilities/user";
const NOW = 1790000000000;
const TEAM = { name: " 雷霆隊 ", sportTag: "football", region: "台北市", type: "none" };
const call = (data = {}, uid = "me") => ({ auth: { uid }, data: { requestId: "req_000000001", team: { ...TEAM }, ...data } });
const base = () => ({ [ME]: { uid: "me", role: "user", displayName: "Creator", teamIds: ["tm_old"], teamNames: ["Old"], teamId: "tm_old", teamName: "Old" } });

function harness(seed = base(), options = {}) {
  const store = new Map(Object.entries(clone(seed)));
  const versions = new Map([...store.keys()].map(key => [key, 1]));
  let serial = 1;
  const state = { attempts: 0, writes: [], reads: [], beforeCommit: null, commitError: null };
  const change = (key, patch) => { store.set(key, { ...(store.get(key) || {}), ...clone(patch) }); versions.set(key, ++serial); };
  const snap = key => ({ id: key.split("/").pop(), exists: store.has(key), data: () => clone(store.get(key)) });
  const doc = key => ({ kind: "doc", path: key });
  const query = (name, filters = [], cap = Infinity) => ({
    kind: "query", name, filters, cap,
    where: (field, op, value) => { if (op !== "==") throw new Error("op"); return query(name, [...filters, { field, value }], cap); },
    limit: value => query(name, filters, value),
  });
  const keysFor = q => [...store.keys()].filter(key => key.split("/").slice(0, -1).join("/") === q.name)
    .filter(key => q.filters.every(f => store.get(key)[f.field] === f.value)).sort().slice(0, q.cap);
  const fingerprint = t => t.kind === "doc" ? (versions.get(t.path) || 0) : JSON.stringify(keysFor(t).map(k => [k, versions.get(k)]));
  const db = {
    collection: name => ({ ...query(name), doc: id => doc(name + "/" + id) }),
    runTransaction: jest.fn(async callback => {
      for (let attempt = 1; attempt <= 5; attempt++) {
        state.attempts++;
        const reads = [], writes = [];
        try {
          const tx = {
            get: async target => {
              if (writes.length) throw new Error("Read after write");
              reads.push([target, fingerprint(target)]);
              const keys = target.kind === "doc" ? [target.path] : keysFor(target);
              state.reads.push({ attempt, documents: Math.max(1, keys.length) });
              return target.kind === "doc" ? snap(target.path) : { docs: keys.map(snap) };
            },
            create: (ref, data) => writes.push({ op: "create", path: ref.path, data: clone(data) }),
            update: (ref, data) => writes.push({ op: "update", path: ref.path, data: clone(data) }),
          };
          const result = await callback(tx);
          await state.beforeCommit?.({ attempt, writes });
          const failure = state.commitError?.(attempt);
          if (failure) throw failure;
          if (reads.some(([t, v]) => fingerprint(t) !== v)) throw Object.assign(new Error("ABORTED private"), { code: 10 });
          if (writes.some(w => w.op === "create" && store.has(w.path))) throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
          if (writes.some(w => w.op === "update" && !store.has(w.path))) throw new Error("NOT_FOUND");
          writes.forEach(w => change(w.path, w.data));
          state.writes.push(...writes.map(w => ({ ...w, attempt })));
          return result;
        } catch (error) {
          // 真 Admin SDK 只重試數字 gRPC ABORTED；HttpsError 的字串碼不重試。
          if (error.code !== 10 || attempt === 5) throw error;
        }
      }
    }),
  };
  const logger = { error: jest.fn() };
  const FieldValue = { serverTimestamp: () => "SERVER_TS" };
  let n = 0;
  const randomSuffix = options.randomSuffix || (() => "abc" + String(n++).padStart(3, "0"));
  const dependencies = { db, HttpsError, FieldValue, logger, now: () => NOW, randomSuffix };
  return { handler: createUserTeamHandler(dependencies), dependencies, db, state, logger, change, get: k => clone(store.get(k)), keys: () => [...store.keys()] };
}

const teamKeys = h => h.keys().filter(k => k.startsWith("teams/"));
async function denied(h, req, code, reason) {
  const before = h.get(ME);
  await expect(h.handler(req)).rejects.toMatchObject({ code, message: reason });
  expect(h.get(ME)).toEqual(before);
  expect(h.state.writes).toEqual([]);
  expect(h.logger.error).toHaveBeenCalledWith("[createUserTeam] failed", expect.objectContaining({ function: "createUserTeam", code, reason }));
  const logged = JSON.stringify(h.logger.error.mock.calls);
  expect(logged).not.toMatch(/"me"|users\/me|tm_\d|req_000000001/);
}

describe("createUserTeam happy path and server-forced fields", () => {
  test("creates team and appends membership in one transaction", async () => {
    const h = harness();
    const result = await h.handler(call());
    expect(result).toEqual({ ok: true, teamId: `tm_${NOW}_abc000`, created: true });
    const team = h.get(`teams/${result.teamId}`);
    expect(team).toMatchObject({
      id: result.teamId, name: "雷霆隊", createdVia: "user_capability", creatorUid: "me", ownerUid: "me", captainUid: "me",
      captain: "Creator", captainName: "Creator", coachUids: [], leaderUids: [], leaders: [], coaches: [], leaderUid: null,
      members: 1, active: true, pinned: false, pinOrder: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, history: [],
      createRequestId: "req_000000001", teachingEnabled: false, image: null, createdAt: "SERVER_TS",
    });
    ["teamExp", "viewCount", "views", "attentionEffectEnabled", "attentionEffectColor"].forEach(k => expect(team).not.toHaveProperty(k));
    expect(h.get(ME)).toMatchObject({ teamId: "tm_old", teamName: "Old", teamIds: ["tm_old", result.teamId], teamNames: ["Old", "雷霆隊"] });
    expect(new Set(h.state.writes.map(w => w.attempt)).size).toBe(1);
    expect(h.state.writes.map(w => w.op).sort()).toEqual(["create", "update"]);
    expect(h.state.writes.find(w => w.op === "update").data).toEqual({
      teamId: "tm_old", teamName: "Old", teamIds: ["tm_old", result.teamId], teamNames: ["Old", "雷霆隊"],
    });
  });
  test("legacy single teamId is preserved in the union", async () => {
    const seed = base(); seed[ME] = { uid: "me", role: "user", teamId: "tm_single", teamName: "Single" };
    const h = harness(seed); const { teamId } = await h.handler(call());
    expect(h.get(ME)).toMatchObject({ teamId: "tm_single", teamName: "Single", teamIds: ["tm_single", teamId], teamNames: ["Single", "雷霆隊"] });
  });
  test("first team becomes primary", async () => {
    const seed = base(); seed[ME] = { uid: "me", role: "user" };
    const h = harness(seed); const { teamId } = await h.handler(call());
    expect(h.get(ME)).toMatchObject({ teamId, teamName: "雷霆隊", teamIds: [teamId], teamNames: ["雷霆隊"] });
  });
  test("staff fields in basicKeys are overwritten by the server", async () => {
    const h = harness();
    const { teamId } = await h.handler(call({ team: { ...TEAM, captainUid: "evil", captain: "Evil", leaderUids: ["evil"], leaderUid: "evil", coachUids: ["evil"], coaches: ["Evil"] } }));
    expect(h.get(`teams/${teamId}`)).toMatchObject({ captainUid: "me", captain: "Creator", leaderUids: [], leaderUid: null, coachUids: [], coaches: [] });
  });
  test.each([
    ["id", "tm_1790000000000_forged"], ["createdVia", "admin"], ["ownerUid", "evil"], ["creatorUid", "evil"],
    ["members", 99], ["pinned", true], ["teamExp", 1000], ["viewCount", 5], ["attentionEffectEnabled", true], ["history", [1]],
    ["__proto__", {}], ["createRequestId", "x"],
  ])("unknown/admin field %s is rejected", async (key, value) => {
    // defineProperty：讓 "__proto__" 成為自有欄位（同 Callable 的 JSON 解析結果），而不是改原型。
    const team = { ...TEAM };
    Object.defineProperty(team, key, { value, enumerable: true, configurable: true, writable: true });
    const h = harness(); await denied(h, call({ team }), "invalid-argument", "CREATE_USER_TEAM_UNKNOWN_FIELD");
    expect(teamKeys(h)).toEqual([]);
  });
  test("top-level extra key (client teamId) is rejected", async () => {
    await denied(harness(), call({ teamId: "tm_1790000000000_aaaaaa" }), "invalid-argument", "CREATE_USER_TEAM_UNKNOWN_FIELD");
  });
  test.each([
    [{ name: "" }], [{ name: "x".repeat(16) }], [{ name: 5 }], [{ bio: "x".repeat(501) }], [{ region: 1 }],
    [{ founded: "20x4" }], [{ type: "pro" }], [{ sportTag: "Foot Ball" }], [{ teachingEnabled: true }],
    [{ eduSettings: { acceptingStudents: true, teachingEnabled: true } }], [{ image: "javascript:alert(1)" }],
    [{ image: "http://x.test/a.png" }], [{ imageVariants: { cover: "https://x.test/a", extra: "https://x.test/b" } }],
    [{ contactLinks: [{ url: "ftp://x", platform: "line", label: "", host: "" }] }],
    [{ contactLinks: Array(6).fill({ url: "https://line.me/x", platform: "line", label: "LINE", host: "line.me" }) }],
    [{ contactLinksEnabled: "yes" }],
  ])("invalid field %j is rejected", async patch => {
    await denied(harness(), call({ team: { ...TEAM, ...patch } }), "invalid-argument", "CREATE_USER_TEAM_INVALID_FIELD");
  });
  test("education team keeps eduSettings and derives teachingEnabled", async () => {
    const h = harness();
    const { teamId } = await h.handler(call({ team: { ...TEAM, type: "education", teachingEnabled: true, eduSettings: { acceptingStudents: false, teachingEnabled: true } } }));
    expect(h.get(`teams/${teamId}`)).toMatchObject({ teachingEnabled: true, eduSettings: { acceptingStudents: false, teachingEnabled: true } });
  });
  test.each([undefined, "", "short", "a/b/c/d/e", "x".repeat(65)])("invalid requestId %p rejected", async requestId => {
    await denied(harness(), call({ requestId }), "invalid-argument", "CREATE_USER_TEAM_INVALID_REQUEST_ID");
  });
});

describe("createUserTeam caller role and capability", () => {
  test("unauthenticated is rejected", async () => {
    const h = harness(); await expect(h.handler({ data: call().data })).rejects.toMatchObject({ code: "unauthenticated", message: "AUTH_REQUIRED" });
  });
  test.each(["coach", "captain", "venue_owner", "admin", "super_admin", "team_leader"])("stored role %s is denied", async role => {
    const h = harness(); h.change(ME, { role });
    await denied(h, call(), "permission-denied", "CREATE_USER_TEAM_ROLE_DENIED");
  });
  test.each([undefined, null, "", "  ", 3])("missing or invalid role %p is conservatively denied", async role => {
    const seed = base(); seed[ME].role = role; if (role === undefined) delete seed[ME].role;
    await denied(harness(seed), call(), "permission-denied", "CREATE_USER_TEAM_ROLE_UNVERIFIED");
  });
  test("token role cannot override stored role", async () => {
    const h = harness(); h.change(ME, { role: "coach" }); const req = call(); req.auth.token = { role: "user" };
    await denied(h, req, "permission-denied", "CREATE_USER_TEAM_ROLE_DENIED");
  });
  test("missing profile and identity mismatch fail closed", async () => {
    await denied(harness({}), call(), "failed-precondition", "USER_PROFILE_NOT_FOUND");
    const h = harness(); h.change(ME, { uid: "someone" });
    await denied(h, call(), "failed-precondition", "USER_IDENTITY_MISMATCH");
  });
  test("missing capability document uses defaults (allowed)", async () => {
    await expect(harness().handler(call())).resolves.toMatchObject({ ok: true, created: true });
  });
  test("capability document containing the code allows", async () => {
    const seed = base(); seed[CAP] = { capabilities: ["user.activity.basic_create", "user.activity.team_create"] };
    await expect(harness(seed).handler(call())).resolves.toMatchObject({ created: true });
  });
  test.each([[[]], [["user.activity.basic_create"]]])("capability document without the code denies: %j", async capabilities => {
    const seed = base(); seed[CAP] = { capabilities };
    await denied(harness(seed), call(), "permission-denied", "TEAM_CREATE_CAPABILITY_DISABLED");
  });
  test.each([null, "user.activity.team_create", { a: 1 }, undefined])("malformed capability list %p denies", async capabilities => {
    const seed = base(); seed[CAP] = capabilities === undefined ? {} : { capabilities };
    await denied(harness(seed), call(), "permission-denied", "TEAM_CREATE_CAPABILITY_INVALID");
  });
});

describe("createUserTeam limits, idempotency, collisions", () => {
  test("same requestId twice returns the same team without a second write", async () => {
    const h = harness();
    const first = await h.handler(call());
    const second = await h.handler(call({ team: { ...TEAM, name: "另一隊" } }));
    expect(second).toEqual({ ok: true, teamId: first.teamId, created: false });
    expect(teamKeys(h)).toHaveLength(1);
    expect(h.state.writes).toHaveLength(2);
    expect(h.get(ME).teamIds).toEqual(["tm_old", first.teamId]);
  });
  test("retry of a succeeded request still returns the team after the switch is closed", async () => {
    const h = harness(); const first = await h.handler(call());
    h.change(CAP, { capabilities: [] });
    await expect(h.handler(call())).resolves.toEqual({ ok: true, teamId: first.teamId, created: false });
  });
  test("concurrent duplicate request aborts and dedups on retry", async () => {
    const h = harness();
    h.state.beforeCommit = ({ attempt }) => {
      if (attempt === 1) h.change("teams/tm_1790000000000_zzzzzz", { creatorUid: "me", createdVia: "user_capability", createRequestId: "req_000000001" });
    };
    await expect(h.handler(call())).resolves.toEqual({ ok: true, teamId: "tm_1790000000000_zzzzzz", created: false });
    expect(h.state.attempts).toBe(2); expect(h.state.writes).toEqual([]);
  });
  test("teamIds already 10 is rejected", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => "tm_" + i);
    const h = harness(); h.change(ME, { teamIds: ids, teamNames: ids, teamId: ids[0] });
    await denied(h, call(), "resource-exhausted", "TEAM_MEMBERSHIP_LIMIT");
  });
  test("9 existing teams can still create the 10th", async () => {
    const ids = Array.from({ length: 9 }, (_, i) => "tm_" + i);
    const h = harness(); h.change(ME, { teamIds: ids, teamNames: ids, teamId: ids[0], teamName: ids[0] });
    const { teamId } = await h.handler(call()); expect(h.get(ME).teamIds).toHaveLength(10); expect(h.get(ME).teamIds[9]).toBe(teamId);
  });
  test.each([[{ teamIds: "tm_x" }], [{ teamNames: {} }]])("malformed membership %j fails closed", async patch => {
    const h = harness(); h.change(ME, patch);
    await denied(h, call(), "failed-precondition", "INVALID_MEMBERSHIP");
  });
  test("fourth user-created team is rejected; others' and legacy teams do not count", async () => {
    const seed = base();
    for (let i = 0; i < MAX_USER_CREATED_TEAMS; i++) seed[`teams/tm_mine${i}`] = { creatorUid: "me", createdVia: "user_capability", createRequestId: "old_req_" + i };
    seed["teams/tm_legacy"] = { creatorUid: "me" };
    const h = harness(seed);
    await denied(h, call(), "resource-exhausted", "USER_TEAM_CREATE_LIMIT");
    delete seed["teams/tm_mine0"]; seed["teams/tm_other"] = { creatorUid: "other", createdVia: "user_capability" };
    await expect(harness(seed).handler(call())).resolves.toMatchObject({ created: true });
  });
  test("concurrent create by the same user is serialized against the limit", async () => {
    const seed = base();
    for (let i = 0; i < MAX_USER_CREATED_TEAMS - 1; i++) seed[`teams/tm_mine${i}`] = { creatorUid: "me", createdVia: "user_capability" };
    const h = harness(seed);
    h.state.beforeCommit = ({ attempt }) => { if (attempt === 1) h.change("teams/tm_race", { creatorUid: "me", createdVia: "user_capability" }); };
    await denied(h, call(), "resource-exhausted", "USER_TEAM_CREATE_LIMIT");
    expect(h.state.attempts).toBe(2);
  });
  test("id collision regenerates within the transaction", async () => {
    const seed = base(); seed[`teams/tm_${NOW}_aaaaaa`] = { name: "taken" };
    const suffixes = ["aaaaaa", "bbbbbb"];
    const h = harness(seed, { randomSuffix: () => suffixes.shift() });
    await expect(h.handler(call())).resolves.toEqual({ ok: true, teamId: `tm_${NOW}_bbbbbb`, created: true });
    expect(h.get(`teams/tm_${NOW}_aaaaaa`)).toEqual({ name: "taken" });
  });
  test("persistent collision fails with fixed code", async () => {
    const seed = base(); seed[`teams/tm_${NOW}_aaaaaa`] = { name: "taken" };
    const h = harness(seed, { randomSuffix: () => "aaaaaa" });
    await denied(h, call(), "aborted", "TEAM_ID_COLLISION");
    expect(h.state.attempts).toBe(1);
  });
  test("malformed generated suffix is never used", async () => {
    const suffixes = ["BAD!", "abc123"];
    const h = harness(base(), { randomSuffix: () => suffixes.shift() });
    await expect(h.handler(call())).resolves.toMatchObject({ teamId: `tm_${NOW}_abc123` });
  });
  test("default suffix generator yields 6 lowercase base36 chars", async () => {
    const deps = harness().dependencies; delete deps.randomSuffix;
    const result = await createUserTeamHandler(deps)(call());
    expect(result.teamId).toMatch(/^tm_\d{13}_[a-z0-9]{6}$/);
  });
  test("worst case reads: user + capability + quota query + id get", async () => {
    const seed = base();
    for (let i = 0; i < MAX_USER_CREATED_TEAMS - 1; i++) seed[`teams/tm_mine${i}`] = { creatorUid: "me", createdVia: "user_capability" };
    const h = harness(seed); await h.handler(call());
    expect(h.state.reads.reduce((s, r) => s + r.documents, 0)).toBe(1 + 1 + (MAX_USER_CREATED_TEAMS - 1) + 1);
  });
});

describe("createUserTeam error sanitizing and export", () => {
  test("exhausted ABORTED retries return sanitized aborted", async () => {
    const h = harness(); h.state.commitError = () => Object.assign(new Error("secret me tm_x"), { code: 10 });
    await denied(h, call(), "aborted", "CREATE_USER_TEAM_RETRY");
    expect(h.state.attempts).toBe(5);
    expect(JSON.stringify(h.logger.error.mock.calls)).not.toMatch(/secret/);
  });
  test("non-retryable failure is internal with no leakage", async () => {
    const h = harness(); h.state.commitError = () => new HttpsError("private-code", "private details me");
    await denied(h, call(), "internal", "CREATE_USER_TEAM_FAILED");
    expect(JSON.stringify(h.logger.error.mock.calls)).not.toMatch(/private/);
    expect(teamKeys(h)).toEqual([]);
  });
  test("index export uses factory and canonical region", () => {
    const h = harness(), onCall = jest.fn((options, handler) => ({ options, handler }));
    const callable = createUserTeamCallable({ onCall, ...h.dependencies });
    expect(callable.options).toEqual({ region: "asia-east1" });
    expect(indexSource).toContain('const { createUserTeamCallable } = require("./user-team-create");');
    const scope = { exports: {}, createUserTeamCallable: jest.fn(() => "callable"), onCall, ...h.dependencies };
    const start = indexSource.indexOf("exports.createUserTeam =");
    vm.runInNewContext(indexSource.slice(start, indexSource.indexOf(");", start) + 2), scope);
    expect(scope.exports.createUserTeam).toBe("callable");
    expect(scope.createUserTeamCallable).toHaveBeenCalledWith(expect.objectContaining({
      onCall, HttpsError, db: h.db, FieldValue: h.dependencies.FieldValue, logger: h.logger,
    }));
  });
});
