"use strict";

const fs = require("fs");
const vm = require("vm");
const { createDeleteEventHandler, createDeleteEventCallable } = require("../../functions/event-deletion");
const indexSource = fs.readFileSync(require.resolve("../../functions/index.js"), "utf8");
class HttpsError extends Error {
  constructor(code, message, details) { super(message); this.code = code; this.details = details; }
}
const courseError = vm.runInNewContext(
  "(" + indexSource.match(/function courseLinkedEventManagedByCourseError\(\) \{[\s\S]*?\n\}/)[0] + ")", { HttpsError },
);
const UID = "U_test_actor_001", ID = "ce_delete_test_001", PATH = "events/" + ID;
const EVENT = { id: ID, title: "測試活動", date: "2026/11/04", creatorUid: "U_original_creator" };
const clone = (x) => x === undefined ? undefined : JSON.parse(JSON.stringify(x));
const errorWithCode = (code) => Object.assign(new Error("sensitive backend detail"), { code });

// Offline SDK model: version-checked atomic commits, bounded SDK-style retry.
// This proves handler behavior, not Firestore isolation (emulator remains required).
function fakeDb(seed) {
  const docs = new Map(Object.entries(clone(seed))), versions = new Map();
  let serial = 0, commit = 0;
  const state = { reads: 0, attempts: 0, writes: [], aborts: 0 };
  const put = (path, value) => { if (value === undefined) docs.delete(path); else docs.set(path, clone(value)); versions.set(path, ++serial); };
  const ref = (path) => ({ path, id: path.split("/").pop(), get: async () => {
    state.reads++; if (state.failRead) state.failRead({ path });
    const value = clone(docs.get(path)); return { exists: value !== undefined, data: () => value };
  } });
  const collection = (name) => ({
    doc: (id = "auto_" + ++serial) => ref(name + "/" + id),
    where: (field, op, value) => {
      if (op !== "==") throw Error("unexpected query");
      return { limit: (limit) => ({ collection: name, field, value, limit }) };
    },
  });
  const matches = (q) => [...docs].filter(([p, d]) => p.startsWith(q.collection + "/")
    && p.split("/").length === 2 && d[q.field] === q.value).slice(0, q.limit).map(([p]) => p);
  const db = { collection, runTransaction: jest.fn(async (work, options) => {
    for (let attempt = 0; attempt < options.maxAttempts; attempt++) {
      state.attempts++;
      const reads = new Map(), queries = [], writes = [];
      const snap = (path) => {
        reads.set(path, versions.get(path));
        const value = clone(docs.get(path));
        return { ...ref(path), ref: ref(path), exists: value !== undefined, data: () => clone(value) };
      };
      try {
        const result = await work({
          get: async (target) => {
            if (writes.length) throw Error("read after write");
            if (state.failRead) state.failRead(target);
            if (target.path) { state.reads++; return snap(target.path); }
            const paths = matches(target); state.reads += Math.max(1, paths.length);
            queries.push([target, paths.join("|")]);
            return { docs: paths.map(snap), empty: !paths.length };
          },
          set: (target, data) => writes.push({ op: "set", path: target.path, data }),
          delete: (target, precondition) => writes.push({ op: "delete", path: target.path, precondition }),
        });
        if (state.beforeCommit) state.beforeCommit({ writes, attempt });
        if (state.aborts > 0) { state.aborts--; throw errorWithCode(10); }
        if ([...reads].some(([p, v]) => versions.get(p) !== v)
          || queries.some(([q, paths]) => matches(q).join("|") !== paths)) throw errorWithCode(10);
        if (state.failCommit) {
          const failure = typeof state.failCommit === "function" ? state.failCommit() : state.failCommit;
          if (failure) throw failure;
        }
        if (writes.some((w) => w.op === "delete" && w.precondition?.exists && !docs.has(w.path))) throw errorWithCode(5);
        commit++;
        writes.forEach((w) => { put(w.path, w.op === "delete" ? undefined : w.data); state.writes.push({ ...clone(w), commit }); });
        return result;
      } catch (error) {
        if (error.code !== 10 || attempt + 1 === options.maxAttempts) throw error;
      }
    }
    throw Error("unreachable");
  }) };
  return { db, docs, state, put };
}
function setup({ role = "coach", permissions = [], grant, event = {}, extra = {}, tokenRole } = {}) {
  const fake = fakeDb({ [PATH]: { ...EVENT, ...event }, ["users/" + UID]: { role },
    ["rolePermissions/" + role]: { permissions }, ...(grant ? { ["userPermissionGrants/" + UID]: grant } : {}), ...extra });
  const logger = { warn: jest.fn(), error: jest.fn() };
  const deps = { db: fake.db, HttpsError, FieldValue: { serverTimestamp: () => "SERVER_TIMESTAMP" },
    courseLinkedEventManagedByCourseError: jest.fn(courseError), logger };
  const handler = createDeleteEventHandler(deps);
  const call = (data = { eventId: ID }, auth = { uid: UID, token: { role: tokenRole } }) => handler({ data, auth });
  return { ...fake, deps, logger, call };
}
const logs = (f) => f.state.writes.filter((w) => w.path.startsWith("operationLogs/"));
async function denied(f, code = "permission-denied") {
  await expect(f.call()).rejects.toMatchObject({ code });
  expect(f.state.writes).toEqual([]);
  expect(f.docs.has(PATH)).toBe(true);
}

test("Callable region, resources and actual index export wiring", () => {
  const f = setup(), onCall = jest.fn((options, handler) => handler);
  expect(typeof createDeleteEventCallable({ onCall, ...f.deps })).toBe("function");
  expect(onCall).toHaveBeenCalledWith({ region: "asia-east1", timeoutSeconds: 30, minInstances: 0 }, expect.any(Function));
  const factory = jest.fn(), deps = { ...f.deps, onCall, exports: {}, createDeleteEventCallable: factory };
  vm.runInNewContext(indexSource.match(/exports.deleteEvent = createDeleteEventCallable\(\{[\s\S]*?\n\}\);/)[0], deps);
  expect(factory).toHaveBeenCalledWith({ ...f.deps, onCall });
  expect(indexSource).toContain('const { createDeleteEventCallable } = require("./event-deletion");');
});
test("authentication rejects before reads and logs the boundary", async () => {
  const f = setup(); await expect(f.call(undefined, null)).rejects.toMatchObject({ code: "unauthenticated" });
  expect(f.state.reads).toBe(0); expect(f.state.writes).toEqual([]);
  expect(f.logger.error).toHaveBeenCalledWith("[deleteEvent] failed", expect.objectContaining({ function: "deleteEvent", phase: "validate" }));
});
test.each([null, {}, { eventId: "" }, { eventId: 1 }, { eventId: [] }, { eventId: "a/b" },
  { eventId: "x".repeat(121) }, { eventId: "__reserved__" }, { eventId: "活動" }, { eventId: ".." }])("invalid input %j", async (data) => {
  const f = setup(); await expect(f.call(data)).rejects.toMatchObject({ code: "invalid-argument" });
  expect(f.state.reads).toBe(0); expect(f.state.writes).toEqual([]);
});

const permissionMatrix = ["user", "coach", "captain", "venue_owner", "admin", "super_admin"].flatMap((role) => [
  { role, label: "no permission", expected: ["admin", "super_admin"].includes(role) },
  { role, label: "role delete", permissions: ["event.delete"], expected: role !== "user" },
  { role, label: "owner role delete_self", permissions: ["event.delete_self"], event: { creatorUid: UID }, expected: role !== "user" },
  { role, label: "non-owner delete_self", permissions: ["event.delete_self"], expected: ["admin", "super_admin"].includes(role) },
  { role, label: "edit_all + entry + delegate", permissions: ["event.edit_all", "activity.manage.entry"],
    event: { delegateUids: [UID] }, expected: ["admin", "super_admin"].includes(role) },
  { role, label: "individual delete", grant: { permissions: ["event.delete"] }, expected: true },
]);
test.each(permissionMatrix)("$role / $label => $expected", async (row) => {
  const f = setup(row);
  if (row.expected) await expect(f.call()).resolves.toEqual({ ok: true, alreadyDeleted: false });
  else await denied(f);
});
test.each(["captainUid", "creatorUid", "ownerUid"])("exact owner %s + individual delete_self", async (field) => {
  const f = setup({ role: "user", event: { [field]: UID }, grant: { permissions: ["event.delete_self"], enabled: true } });
  await expect(f.call()).resolves.toMatchObject({ alreadyDeleted: false });
});
test.each([" " + UID, UID + " ", [UID], { uid: UID }, 1])("owner never coerces %j", async (ownerUid) => {
  await denied(setup({ event: { ownerUid }, grant: { permissions: ["event.delete_self"] } }));
});
test.each([false, null, 0, 1, "true", []])("grant enabled=%j does not grant access", async (enabled) => {
  await denied(setup({ grant: { permissions: ["event.delete"], enabled } }));
});
test.each([undefined, {}, { permissions: "event.delete" }, { permissions: [] }])("missing/malformed role doc %j has no default", async (doc) => {
  const f = setup(); if (doc === undefined) f.put("rolePermissions/coach", undefined); else f.put("rolePermissions/coach", doc);
  await denied(f);
});
test("user capabilities and client-supplied permissions/identity do not grant deletion", async () => {
  const f = setup({ role: "user", event: { creatorUid: UID } });
  f.put("users/" + UID, { role: "user", capabilities: ["user.activity.own_cancel", "user.activity.site_operate"] });
  await expect(f.call({ eventId: ID, role: "super_admin", actorUid: "other", permissions: ["event.delete"] })).rejects.toMatchObject({ code: "permission-denied" });
  expect(f.state.writes).toEqual([]);
});
test.each([{}, { role: undefined }])("existing user without role %j is denied and sanitized", async (userDoc) => {
  const f = setup({ tokenRole: "admin" }); f.put("users/" + UID, userDoc);
  await expect(f.call()).rejects.toMatchObject({ code: "permission-denied", message: "EVENT_DELETE_DENIED", details: undefined });
  expect(f.state.writes).toEqual([]); expect(f.docs.has(PATH)).toBe(true);
  expect(f.logger.error).toHaveBeenCalledWith("[deleteEvent] failed", expect.objectContaining({ phase: "authorize", code: "permission-denied" }));
  const serialized = JSON.stringify(f.logger.error.mock.calls);
  for (const secret of [UID, ID, EVENT.title]) expect(serialized).not.toContain(secret);
});
test.each(["event.delete", "event.delete_self"])("missing role denies even an owner with individual %s", async (permission) => {
  const f = setup({ tokenRole: "admin", event: { creatorUid: UID }, grant: { permissions: [permission], enabled: true } });
  f.put("users/" + UID, {});
  await denied(f);
});
test.each(["", null, 42])("Rules authRole claim fallback for present doc role %j", async (role) => {
  const f = setup({ tokenRole: "admin" }); f.put("users/" + UID, { role });
  await expect(f.call()).resolves.toMatchObject({ alreadyDeleted: false });
});

// Narrow offline Rules source model: these fixtures have no role/grant permissions
// and are not event owners. This is not a Rules emulator or full Rules evaluation.
// Missing map fields throw (unlike JS undefined):
// https://firebase.google.com/docs/firestore/security/rules-fields#enforcing_types_for_optional_fields
const rulesSource = fs.readFileSync(require.resolve("../../firestore.rules"), "utf8");
const rulesRoleSource = ["userDocRoleOrEmpty", "authRole", "isAdmin"].map((name) =>
  rulesSource.match(new RegExp("function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n    \\}"))[0],
).join("\n")
  .replace("/databases/$(database)/documents/users/$(uid)", '"users/" + uid')
  .replace(/(get\(userPath\)\.data\.role|request\.auth\.token\.role) is string/g, '(typeof $1 === "string")')
  .replace("authRole() in ['admin', 'super_admin']", "['admin', 'super_admin'].includes(authRole())");
const rulesDeleteCondition = rulesSource.slice(rulesSource.indexOf("match /events/{eventId} {"))
  .match(/allow delete: if ([\s\S]*?);/)[1];
function rulesAllowDeleteWithoutPermissions(userDoc, tokenRole) {
  const missingField = new Error("RULES_MISSING_FIELD");
  const strictData = new Proxy(userDoc || {}, { get: (data, key) => {
    if (!Object.prototype.hasOwnProperty.call(data, key)) throw missingField;
    return data[key];
  } });
  try {
    return vm.runInNewContext(rulesRoleSource + "\n" + rulesDeleteCondition, {
      request: { auth: { uid: UID, token: clone({ role: tokenRole }) } },
      exists: (path) => path === "users/" + UID && userDoc !== undefined,
      get: (path) => { if (path !== "users/" + UID) throw Error("unexpected Rules path"); return { data: strictData }; },
      hasEffectivePerm: () => false,
      isEventOwner: () => false,
    });
  } catch (error) {
    if (error !== missingField) throw error;
    return false;
  }
}
const roleFallbackMatrix = [
  { label: "absent document / admin token", userDoc: undefined, tokenRole: "admin", expected: true },
  { label: "absent document / super_admin token", userDoc: undefined, tokenRole: "super_admin", expected: true },
  { label: "absent document / no token role", userDoc: undefined, tokenRole: undefined, expected: false },
  { label: "missing role / admin token", userDoc: {}, tokenRole: "admin", expected: false },
  { label: "missing role / super_admin token", userDoc: {}, tokenRole: "super_admin", expected: false },
  { label: "undefined role serialized away / admin token", userDoc: { role: undefined }, tokenRole: "admin", expected: false },
  { label: "missing role / no token role", userDoc: {}, tokenRole: undefined, expected: false },
  { label: "empty role / admin token", userDoc: { role: "" }, tokenRole: "admin", expected: true },
  { label: "null role / admin token", userDoc: { role: null }, tokenRole: "admin", expected: true },
  { label: "numeric role / admin token", userDoc: { role: 42 }, tokenRole: "admin", expected: true },
  { label: "null role / user token", userDoc: { role: null }, tokenRole: "user", expected: false },
  { label: "user role / stale admin token", userDoc: { role: "user" }, tokenRole: "admin", expected: false },
  { label: "admin role / user token", userDoc: { role: "admin" }, tokenRole: "user", expected: true },
  { label: "super_admin role / user token", userDoc: { role: "super_admin" }, tokenRole: "user", expected: true },
  { label: "untrimmed role / admin token", userDoc: { role: " admin " }, tokenRole: "admin", expected: false },
  { label: "unknown role / admin token", userDoc: { role: "unknown" }, tokenRole: "admin", expected: false },
];
test.each(roleFallbackMatrix)("Rules source model / Callable: $label => $expected", async (row) => {
  const f = setup({ tokenRole: row.tokenRole }); f.put("users/" + UID, row.userDoc);
  // Feed the same post-serialization document to both sides, including absent docs.
  const rulesAllowed = rulesAllowDeleteWithoutPermissions(f.docs.get("users/" + UID), row.tokenRole);
  expect(rulesAllowed).toBe(row.expected);
  if (rulesAllowed) await expect(f.call()).resolves.toEqual({ ok: true, alreadyDeleted: false });
  else await denied(f);
});
test("canonical user role overrides stale admin token; no legacy uid lookup or role normalization", async () => {
  for (const role of ["user", " admin ", "unknown"]) await denied(setup({ role, tokenRole: "admin",
    extra: { "users/legacy": { uid: UID, role: "super_admin" } } }));
  const f = setup({ tokenRole: "admin" }); f.put("users/" + UID, undefined);
  await expect(f.call()).resolves.toMatchObject({ alreadyDeleted: false });
});

test.each([
  ["admin", {}, [], true], ["super_admin", {}, [], true],
  ["coach", {}, ["event.delete"], false], ["coach", { delegateUids: [UID] }, ["event.delete"], false],
  ["coach", { creatorUid: UID }, ["event.delete_self"], true], ["coach", { ownerUid: UID }, ["event.delete"], true],
  ["coach", { captainUid: UID }, [], false], ["user", { delegateUids: [UID] }, [], false],
])("private event %s %j %j => %s", async (role, event, permissions, expected) => {
  const f = setup({ role, event: { privateEvent: true, ...event }, permissions });
  if (expected) await expect(f.call()).resolves.toMatchObject({ alreadyDeleted: false }); else await denied(f);
});
test.each([{ courseLinked: true }, { courseLinkId: "legacy_course" }, { courseLinkSource: "eduCourseLesson" },
  { source: "eduCourseLesson" }, { courseLinked: true, courseEventDetailsManagedByEvent: true }])("course lifecycle locked %j even for admin", async (event) => {
  const f = setup({ role: "admin", event }); await expect(f.call()).rejects.toMatchObject({ code: "failed-precondition",
    message: "COURSE_LINKED_EVENT_MANAGED_BY_COURSE", details: { code: "COURSE_LINKED_EVENT_MANAGED_BY_COURSE" } });
  expect(f.state.writes).toEqual([]); expect(f.deps.courseLinkedEventManagedByCourseError).toHaveBeenCalledTimes(1);
});
test("missing event and repeated deletion are idempotent with warn logs", async () => {
  const f = setup({ role: "admin" }); await f.call(); await expect(f.call()).resolves.toEqual({ ok: true, alreadyDeleted: true });
  await expect(f.call({ eventId: "ce_never_existed" })).resolves.toEqual({ ok: true, alreadyDeleted: true });
  expect(logs(f)).toHaveLength(1); expect(f.logger.warn).toHaveBeenCalledTimes(2);
});
test("public-id fallback never deletes a colliding direct doc; ambiguous legacy ids fail closed", async () => {
  const f = setup({ role: "admin", event: { id: "different_public_id" }, extra: { "events/legacy_doc": EVENT } });
  await f.call(); expect(f.docs.has(PATH)).toBe(true); expect(f.docs.has("events/legacy_doc")).toBe(false);
  expect(logs(f)[0].data).toMatchObject({ eventId: ID, docId: "legacy_doc" });
  const ambiguous = setup({ event: { id: "other" }, extra: { "events/legacy1": EVENT, "events/legacy2": EVENT } });
  await denied(ambiguous, "failed-precondition");
});
test("audit has exactly seven server-derived fields; only one parent deletion, all other data untouched", async () => {
  const retained = Object.fromEntries(["registrations/r", "attendanceRecords/a", "activityRecords/a", "comments/c",
    "comments/c/replies/r", "teamReservations/t", "registrationLocks/l", "management/m"].map((p) => [PATH + "/" + p, { secret: "preserve" }]));
  Object.assign(retained, { "registrations/legacy": { eventId: ID }, "users/stats": { count: 1 }, "expLogs/e": { eventId: ID } });
  const f = setup({ role: "admin", extra: retained, event: { secret: "never audit", delegates: [UID] } });
  await f.call({ eventId: " " + ID + " ", actorUid: "forged", title: "forged", docId: "forged", creatorUid: "forged" });
  expect(f.state.writes).toHaveLength(2); expect(f.docs.has(PATH)).toBe(false);
  expect(logs(f)[0].data).toEqual({ title: EVENT.title, date: EVENT.date, creatorUid: EVENT.creatorUid, eventId: ID, docId: ID, actorUid: UID, createdAt: "SERVER_TIMESTAMP" });
  expect(Object.keys(logs(f)[0].data).sort()).toEqual(["title", "date", "eventId", "docId", "creatorUid", "actorUid", "createdAt"].sort());
  expect(f.state.writes[1]).toMatchObject({ op: "delete", path: PATH, precondition: { exists: true }, commit: f.state.writes[0].commit });
  for (const [p, data] of Object.entries(retained)) expect(f.docs.get(p)).toEqual(data);
});
test("simultaneous callers produce exactly one deletion audit", async () => {
  const f = setup({ role: "admin" }); const results = await Promise.all([f.call(), f.call()]);
  expect(results.map((r) => r.alreadyDeleted).sort()).toEqual([false, true]);
  expect(logs(f)).toHaveLength(1); expect(f.state.writes).toHaveLength(2);
});
test.each(["owner", "role", "grant", "private", "course"])("transaction retry rechecks changed %s", async (kind) => {
  const f = setup({ event: { creatorUid: UID }, permissions: ["event.delete_self"], grant: { permissions: [] } });
  if (kind === "grant") { f.put("rolePermissions/coach", { permissions: [] }); f.put("userPermissionGrants/" + UID, { permissions: ["event.delete_self"] }); }
  if (kind === "private") f.put("rolePermissions/coach", { permissions: ["event.delete"] });
  f.state.beforeCommit = () => {
    f.state.beforeCommit = null;
    if (kind === "role") f.put("rolePermissions/coach", { permissions: [] });
    else if (kind === "grant") f.put("userPermissionGrants/" + UID, { permissions: ["event.delete_self"], enabled: false });
    else f.put(PATH, { ...EVENT, ...(kind === "owner" ? {} : kind === "private" ? { privateEvent: true } : { creatorUid: UID, courseLinked: true }) });
  };
  await denied(f, kind === "course" ? "failed-precondition" : "permission-denied"); expect(f.state.attempts).toBe(2);
});
test("ABORTED retries fresh reads, writes once; bounded worst case is 25 reads and 2 writes", async () => {
  const f = setup({ permissions: ["event.delete"], extra: { "events/legacy": EVENT } }); f.put(PATH, undefined);
  f.state.aborts = 4; await f.call(); expect(f.state.reads).toBe(25); expect(f.state.writes).toHaveLength(2);
  expect(f.db.runTransaction).toHaveBeenCalledWith(expect.any(Function), { maxAttempts: 5 });
});
test("exhausted ABORTED returns a sanitized retryable HttpsError with no writes", async () => {
  const f = setup({ role: "admin" }); f.state.aborts = 5; await expect(f.call()).rejects.toMatchObject({ code: "aborted", message: "EVENT_DELETE_RETRY" });
  expect(f.state.attempts).toBe(5); expect(f.state.writes).toEqual([]); expect(f.docs.has(PATH)).toBe(true);
});
test.each(["resolve", "authorize", "commit", "dependency-https"])("failure at %s is atomic and sanitized", async (stage) => {
  const f = setup({ permissions: ["event.delete"] }); const sensitive = "PRIVATE_DETAIL_" + UID + ID;
  const error = stage === "dependency-https" ? new HttpsError("internal", sensitive, { secret: sensitive }) : Object.assign(new Error(sensitive), { code: sensitive });
  if (["resolve", "authorize"].includes(stage)) f.state.failRead = (target) => { if (stage === "resolve" || target.path.startsWith("users/")) throw error; };
  else f.state.failCommit = error;
  await expect(f.call()).rejects.toMatchObject({ code: "internal", message: "EVENT_DELETE_FAILED", details: undefined });
  expect(f.docs.has(PATH)).toBe(true); expect(f.state.writes).toEqual([]);
  const serialized = JSON.stringify(f.logger.error.mock.calls);
  for (const secret of [sensitive, UID, ID, EVENT.title]) expect(serialized).not.toContain(secret);
  expect(f.logger.error).toHaveBeenCalledWith("[deleteEvent] failed", expect.objectContaining({ function: "deleteEvent", code: "internal" }));
});

test.each([5, "not-found", "NOT_FOUND"])("commit %j confirms absence before alreadyDeleted", async (code) => {
  const f = setup({ permissions: ["event.delete"] });
  f.state.failCommit = () => { f.put(PATH, undefined); return errorWithCode(code); };
  await expect(f.call()).resolves.toEqual({ ok: true, alreadyDeleted: true });
  expect(f.state.writes).toEqual([]); expect(f.state.attempts).toBe(1); expect(f.logger.warn).toHaveBeenCalledTimes(1);
});
test("NOT_FOUND with parent still present is failure, never false success", async () => {
  const f = setup({ role: "admin" }); f.state.failCommit = errorWithCode(5); await denied(f, "internal");
});
test("NOT_FOUND confirmation read failure is sanitized and logged", async () => {
  const f = setup({ role: "admin" });
  f.state.failCommit = () => { f.state.failRead = () => { throw Error("private confirmation error"); }; return errorWithCode(5); };
  await expect(f.call()).rejects.toMatchObject({ code: "internal", message: "EVENT_DELETE_FAILED" });
  expect(f.state.writes).toEqual([]); expect(f.logger.error).toHaveBeenCalledWith("[deleteEvent] failed", expect.objectContaining({ phase: "confirm-deleted" }));
});
test("four aborts then NOT_FOUND: worst confirmation path is 26 reads, zero writes", async () => {
  const f = setup({ permissions: ["event.delete"], extra: { "events/legacy": EVENT } }); f.put(PATH, undefined);
  f.state.aborts = 4; f.state.failCommit = () => { f.put("events/legacy", undefined); return errorWithCode(5); };
  await expect(f.call()).resolves.toMatchObject({ alreadyDeleted: true });
  expect(f.state.reads).toBe(26); expect(f.state.writes).toEqual([]);
});
test.each(["aborted", "ABORTED"])("exhausted string contention code %s is sanitized", async (code) => {
  const f = setup({ role: "admin" }); f.state.failCommit = errorWithCode(code);
  await expect(f.call()).rejects.toMatchObject({ code: "aborted", message: "EVENT_DELETE_RETRY" }); expect(f.state.writes).toEqual([]);
});
test.each(["captainUid", "creatorUid", "ownerUid"])("private owner %s with personal grant is allowed", async (field) => {
  await expect(setup({ role: "user", event: { privateEvent: true, [field]: UID },
    grant: { permissions: ["event.delete_self"] } }).call()).resolves.toMatchObject({ alreadyDeleted: false });
});
test("private delegate with individual global delete grant is still denied", async () => {
  await denied(setup({ role: "user", event: { privateEvent: true, delegateUids: [UID] }, grant: { permissions: ["event.delete"] } }));
});
test.each([{ role: "user" }, {}, { role: undefined }])("transaction retry observes canonical user role revocation %j", async (userDoc) => {
  const f = setup({ role: "admin", tokenRole: "admin" });
  f.state.beforeCommit = () => { f.state.beforeCommit = null; f.put("users/" + UID, userDoc); };
  await denied(f); expect(f.state.attempts).toBe(2);
});
test.each([{}, { permissions: "event.delete" }, { permissions: ["event.edit_all"] }])("malformed or unrelated grant %j cannot authorize", async (grant) => {
  await denied(setup({ grant }));
});
test("audit never stores malformed nested title/date/creator fields", async () => {
  const f = setup({ role: "admin", event: { title: { secret: "private" }, date: ["private"], creatorUid: 42 } });
  await f.call(); expect(logs(f)[0].data).toMatchObject({ title: "", date: "", creatorUid: "" });
});
