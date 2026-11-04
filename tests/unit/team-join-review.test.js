"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  createReviewTeamJoinCallable, createReviewTeamJoinHandler, buildReviewNoticeMessageId, MAX_GROUP_MESSAGES,
} = require("../../functions/team-join-review");

// Exercise the real production staff/role helpers, including legacy staff fields.
const indexSource = fs.readFileSync(path.join(__dirname, "../../functions/index.js"), "utf8");
const context = {};
for (const [start, end] of [
  ["function isTeamStaffForData(", "function getEduCourseRosterAgentUids("],
  ["function normalizeRole(", "function normalizeBuiltInRole("],
]) vm.runInNewContext(indexSource.slice(indexSource.indexOf(start), indexSource.indexOf(end)), context);

class HttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const GROUP = "tjr_1700000000000_test";
const USER = "users/applicant";
const INBOX = "users/owner/inbox/request";
const SECOND = "users/staff/inbox/request2";
const request = (data = {}, uid = "owner") => ({
  auth: { uid }, data: { teamId: "tm_test", groupId: GROUP, applicantUid: "applicant", action: "approve", ...data },
});
const message = (patch = {}) => ({
  actionType: "team_join_request", actionStatus: "pending", fromUid: "applicant",
  meta: { teamId: "tm_test", applicantUid: "applicant", groupId: GROUP }, ...patch,
});
// 核准後四個成員欄位的期望形狀（同 Rules isSafeGrantedTeamReviewJoinUpdate）。
const joined = (before, id = "tm_test", name = "Test FC", oldNames = ["Old"]) => ({
  ...before, teamIds: [...before.teamIds, id], teamNames: [...oldNames, name],
  teamId: before.teamIds[0], teamName: oldNames[0],
});
const base = () => ({
  "teams/tm_test": { id: "tm_test", name: "Test FC", createdVia: "user_capability", ownerUid: "owner" },
  "users/owner": { uid: "owner", role: "user", displayName: "Reviewer" },
  [USER]: { uid: "applicant", teamIds: ["tm_old"], teamNames: ["Old"], teamId: "tm_old", role: "user", custom: { keep: true } },
  [INBOX]: message(), [SECOND]: message(),
});

// In-memory optimistic transaction model, not emulator/real SDK acceptance.
// It tracks document AND query result versions, discards failed writes, and retries only ABORTED.
function harness(seed = base()) {
  const store = new Map(Object.entries(clone(seed)));
  const versions = new Map([...store.keys()].map(key => [key, 1]));
  let serial = 1;
  const state = { attempts: 0, writes: [], reads: [], beforeCommit: null, readError: null, commitError: null,
    created: [], createError: null };
  const change = (key, patch) => {
    store.set(key, { ...(store.get(key) || {}), ...clone(patch) });
    versions.set(key, ++serial);
  };
  const remove = key => { store.delete(key); versions.delete(key); };
  const field = (data, key) => key.split(".").reduce((value, part) => value?.[part], data);
  const snap = key => ({ id: key.split("/").pop(), ref: doc(key), exists: store.has(key), data: () => clone(store.get(key)) });
  // create() 只用於交易外的通知站內信（Admin SDK 語意：已存在即 ALREADY_EXISTS）。
  const doc = key => ({
    path: key, kind: "doc", collection: name => collection(key + "/" + name),
    create: async data => {
      const failure = state.createError?.(key);
      if (failure) throw failure;
      if (store.has(key)) throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 });
      change(key, data); state.created.push({ path: key, data: clone(data) });
    },
  });
  function query(source, filters = [], ordered = null, cap = Infinity) {
    return {
      kind: "query", source, filters, ordered, cap,
      where: (key, operator, value) => query(source, [...filters, { key, operator, value }], ordered, cap),
      orderBy: key => query(source, filters, key, cap),
      limit: value => query(source, filters, ordered, value),
    };
  }
  const collection = name => ({ ...query({ collection: name }), doc: id => doc(name + "/" + id) });
  function keysFor(target) {
    return [...store.keys()].filter(key => {
      const parts = key.split("/");
      return target.source.group ? parts[parts.length - 2] === target.source.group
        : parts.slice(0, -1).join("/") === target.source.collection;
    }).filter(key => target.filters.every(f => {
      if (f.operator !== "==") throw new Error("Unsupported operator");
      return field(store.get(key), f.key) === f.value;
    })).filter(key => !target.ordered || field(store.get(key), target.ordered) !== undefined)
      .sort((a, b) => {
        const av = target.ordered ? field(store.get(a), target.ordered) : a;
        const bv = target.ordered ? field(store.get(b), target.ordered) : b;
        return av < bv ? -1 : av > bv ? 1 : a.localeCompare(b);
      }).slice(0, target.cap);
  }
  const fingerprint = target => target.kind === "doc" ? (versions.get(target.path) || 0)
    : JSON.stringify(keysFor(target).map(key => [key, versions.get(key)]));
  const db = {
    collection, collectionGroup: name => query({ group: name }),
    runTransaction: jest.fn(async callback => {
      for (let attempt = 1; attempt <= 5; attempt++) {
        state.attempts++;
        const reads = [], writes = [];
        try {
          const tx = {
            get: async target => {
              if (writes.length) throw new Error("Read after write");
              const error = state.readError?.(target, attempt);
              if (error) throw error;
              reads.push([target, fingerprint(target)]);
              const keys = target.kind === "doc" ? [target.path] : keysFor(target);
              state.reads.push({ attempt, target, documents: Math.max(1, keys.length) });
              return target.kind === "doc" ? snap(target.path) : { docs: keys.map(snap) };
            },
            update: (ref, data) => writes.push({ path: ref.path, data: clone(data) }),
          };
          const result = await callback(tx);
          await state.beforeCommit?.({ attempt, writes });
          const failure = state.commitError?.(attempt);
          if (failure) throw failure;
          if (reads.some(([target, version]) => fingerprint(target) !== version)) {
            throw Object.assign(new Error("ABORTED private resource"), { code: 10 });
          }
          if (writes.some(write => !store.has(write.path))) throw new Error("Update missing doc");
          writes.forEach(write => change(write.path, write.data));
          state.writes.push(...writes.map(write => ({ ...write, attempt })));
          return result;
        } catch (error) {
          if (![10, "aborted", "ABORTED"].includes(error.code) || attempt === 5) throw error;
        }
      }
    }),
  };
  const logger = { error: jest.fn() };
  const FieldValue = { serverTimestamp: () => "SERVER_TS" };
  const enqueueLineFromServer = jest.fn(async () => ({ queued: true, skipped: false, queueId: "q1" }));
  const dependencies = { db, HttpsError, ...context, logger, now: () => 1700000000100, FieldValue, enqueueLineFromServer };
  const handler = createReviewTeamJoinHandler(dependencies);
  return { handler, dependencies, db, logger, state, change, remove, get: key => clone(store.get(key)) };
}

async function denied(h, req, code, reason) {
  const before = h.get(USER);
  await expect(h.handler(req)).rejects.toMatchObject({ code, ...(reason ? { message: reason } : {}) });
  expect(h.get(USER)).toEqual(before);
  expect(h.state.writes).toEqual([]);
  expect(h.logger.error).toHaveBeenCalledWith("[reviewTeamJoin] failed", expect.objectContaining({
    function: "reviewTeamJoin", code, stage: expect.any(String), action: expect.any(String),
  }));
}

describe("reviewTeamJoin authorization and scope", () => {
  test.each(["captainUid", "creatorUid", "ownerUid"])("user-created %s owner can approve atomically", async field => {
    const seed = base(); seed["teams/tm_test"] = { createdVia: "user_capability", [field]: "owner" };
    const h = harness(seed), before = h.get(USER);
    const result = await h.handler(request());
    expect(result).toMatchObject({ ok: true, actionStatus: "approved", membershipAdded: true, updatedMessages: 2 });
    expect(h.get(USER)).toEqual(joined(before, "tm_test", "tm_test"));
    expect(h.state.writes).toHaveLength(3);
    expect(new Set(h.state.writes.map(w => w.attempt)).size).toBe(1);
    expect(h.state.writes.find(w => w.path === USER).data).toEqual({
      teamId: "tm_old", teamName: "Old", teamIds: ["tm_old", "tm_test"], teamNames: ["Old", "tm_test"],
    });
    expect(h.get(INBOX)).toMatchObject({ actionStatus: "approved", reviewerName: "Reviewer" });
    expect(h.get(SECOND).actionStatus).toBe("approved");
  });
  test("owner cannot review another team", async () => {
    const h = harness(); h.change("teams/tm_other", { createdVia: "user_capability", ownerUid: "someone" });
    await denied(h, request({ teamId: "tm_other" }), "permission-denied");
  });
  test.each([
    { ownerUid: "someone" }, { ownerUid: " owner " }, { ownerUid: ["owner"] },
    { creatorUid: { uid: "owner" } }, { leaderUid: "owner" }, { leaderUids: ["owner"] }, { coachUids: ["owner"] },
  ])("non-owner or non-strict owner has no exception: %j", async patch => {
    const h = harness(); h.change("teams/tm_test", { ownerUid: null, ...patch });
    await denied(h, request(), "permission-denied");
  });
  test.each([undefined, "admin", "USER_CAPABILITY", null])("owner exception requires exact createdVia: %s", async createdVia => {
    const seed = base(); seed["teams/tm_test"].createdVia = createdVia;
    await denied(harness(seed), request(), "permission-denied");
  });
  test.each(["admin", "super_admin"])("stored %s can review a management-created team", async role => {
    const h = harness(); h.change("teams/tm_test", { createdVia: "admin", ownerUid: "someone" });
    h.change("users/owner", { role }); await expect(h.handler(request())).resolves.toMatchObject({ membershipAdded: true });
  });
  test("request token role cannot override the transaction profile", async () => {
    const h = harness(); h.change("teams/tm_test", { ownerUid: "someone" });
    const req = request(); req.auth.token = { role: "admin" };
    await denied(h, req, "permission-denied");
  });
  test.each(["captainUid", "creatorUid", "ownerUid", "leaderUid", "leaderUids", "coachUids"])("review grant plus %s staff is allowed", async field => {
    const h = harness(); h.change("teams/tm_test", { createdVia: "admin", ownerUid: null, [field]: field.endsWith("Uids") ? ["owner"] : "owner" });
    h.change("userPermissionGrants/owner", { permissions: ["team.review_join"], enabled: true });
    await expect(h.handler(request())).resolves.toMatchObject({ membershipAdded: true });
  });
  test.each(["team.review_join", "team.manage_all"])("custom role permission %s is honored", async permission => {
    const h = harness(); h.change("teams/tm_test", { createdVia: "admin", ownerUid: null, leaderUid: "owner" });
    h.change("users/owner", { role: "team_leader" });
    h.change("rolePermissions/team_leader", { permissions: [permission] });
    await expect(h.handler(request())).resolves.toMatchObject({ ok: true });
  });
  test("manage_all grant works without team staff", async () => {
    const h = harness(); h.change("teams/tm_test", { createdVia: "admin", ownerUid: "other" });
    h.change("userPermissionGrants/owner", { permissions: ["team.manage_all"] });
    await expect(h.handler(request())).resolves.toMatchObject({ ok: true });
  });
  test.each([
    { permissions: ["team.review_join"], enabled: false },
    { permissions: ["team.review_join"], enabled: "true" },
    { permissions: ["team.manage.entry"] },
    { permissions: [] },
  ])("disabled/entry-only grants are denied: %j", async grant => {
    const h = harness(); h.change("teams/tm_test", { createdVia: "admin" });
    h.change("userPermissionGrants/owner", grant);
    await denied(h, request(), "permission-denied");
  });
  // P2-3：擁有者與 review_join 職員必須是這筆申請的收件人；修正前兩者皆可核准成功。
  test.each(["owner", "review_join staff"])("%s who is not a recipient of the application is denied", async kind => {
    const h = harness(); h.remove(INBOX);
    if (kind !== "owner") {
      h.change("teams/tm_test", { createdVia: "admin", ownerUid: null, leaderUid: "owner" });
      h.change("userPermissionGrants/owner", { permissions: ["team.review_join"] });
    }
    await denied(h, request(), "permission-denied", "TEAM_JOIN_REVIEW_DENIED");
  });
  test.each(["admin", "manage_all"])("%s path does not require being a recipient", async kind => {
    const h = harness(); h.remove(INBOX); h.change("teams/tm_test", { createdVia: "admin", ownerUid: "other" });
    if (kind === "admin") h.change("users/owner", { role: "admin" });
    else h.change("userPermissionGrants/owner", { permissions: ["team.manage_all"] });
    await expect(h.handler(request())).resolves.toMatchObject({ membershipAdded: true, updatedMessages: 1 });
  });
  // P3-1：對齊 Rules !isOwner(userId)，申請者本人（即使是擁有者且是收件人）不得自核准；修正前會成功。
  test("applicant cannot approve their own application", async () => {
    const h = harness(); h.change("teams/tm_test", { ownerUid: "applicant" });
    h.change("users/applicant/inbox/self", message());
    await denied(h, request({}, "applicant"), "permission-denied", "TEAM_JOIN_SELF_REVIEW_DENIED");
  });
  test("admin applicant keeps the self-review exception", async () => {
    const h = harness(); h.change(USER, { role: "admin" });
    await expect(h.handler(request({}, "applicant"))).resolves.toMatchObject({ membershipAdded: true });
  });
  test("review grant alone cannot review another team's application", async () => {
    const h = harness(); h.change("teams/tm_test", { ownerUid: "other" });
    h.change("userPermissionGrants/owner", { permissions: ["team.review_join"] });
    await denied(h, request(), "permission-denied");
  });
  test.each(["a/b/c", "../tm_test", ".", "..", "__reserved__", "", 42, "a".repeat(129)])("invalid teamId %s is rejected before reads", async teamId => {
    const h = harness(); await denied(h, request({ teamId }), "invalid-argument");
    expect(h.db.runTransaction).not.toHaveBeenCalled();
  });
  test("F1 normalizes surrounding whitespace", async () => {
    await expect(harness().handler(request({ teamId: " tm_test " }))).resolves.toMatchObject({ teamId: "tm_test" });
  });
  test("forged id field on another document makes a direct hit ambiguous (fail closed)", async () => {
    const h = harness(); h.change("teams/evil", { id: "tm_test", ownerUid: "owner", createdVia: "user_capability" });
    h.change("teams/tm_test", { ownerUid: "other" });
    await denied(h, request(), "failed-precondition", "TEAM_ID_AMBIGUOUS");
  });
  // P1-1：舊格式俱樂部（文件 ID ≠ 公開 id）可被新建「文件 ID＝公開 id」的隊伍搶註。
  // 修正前：文件 ID 優先 → 導到攻擊者隊伍，擁有者路徑核准成功並寫入 users。
  test.each(["L_public", "anything_else"])("squatting doc teams/L (data.id=%s) cannot hijack legacy team L", async squatId => {
    const seed = base(); delete seed["teams/tm_test"];
    seed["teams/legacy_doc"] = { id: "L_public", name: "Legacy FC", createdVia: "admin", ownerUid: "victim_owner" };
    seed["teams/L_public"] = { id: squatId, name: "Evil", createdVia: "user_capability", ownerUid: "owner" };
    const meta = { teamId: "L_public", applicantUid: "applicant", groupId: GROUP };
    seed[INBOX] = message({ meta }); seed[SECOND] = message({ meta });
    await denied(harness(seed), request({ teamId: "L_public" }), "failed-precondition", "TEAM_ID_AMBIGUOUS");
  });
  // P1-1：users 寫入申請 meta.teamId（公開 id），與 A 寫入值、前端 item.id 比對一致；名稱取文件 name。
  // 修正前寫文件 ID legacy_doc，此測試失敗。
  test("unique legacy alias writes the application teamId (public id) like A", async () => {
    const seed = base(); seed["teams/legacy_doc"] = seed["teams/tm_test"]; delete seed["teams/tm_test"];
    const h = harness(seed); await expect(h.handler(request())).resolves.toMatchObject({ teamId: "legacy_doc" });
    expect(h.get(USER)).toMatchObject({ teamIds: ["tm_old", "tm_test"], teamNames: ["Old", "Test FC"] });
  });
  test("ambiguous legacy team IDs fail closed", async () => {
    const seed = base(); seed["teams/a"] = seed["teams/tm_test"]; seed["teams/b"] = seed["teams/tm_test"]; delete seed["teams/tm_test"];
    await denied(harness(seed), request(), "failed-precondition", "TEAM_ID_AMBIGUOUS");
  });
});

describe("reviewTeamJoin request authenticity and lifecycle", () => {
  test("missing auth is sanitized and logged", async () => {
    const h = harness(); await denied(h, { data: request().data }, "unauthenticated");
  });
  test.each([{ action: "approved" }, { action: "__proto__" }, { groupId: "fake" }, { applicantUid: "a/b" }])("invalid input: %j", async patch => {
    await denied(harness(), request(patch), "invalid-argument");
  });
  test("missing team rejects", async () => {
    const h = harness(); h.remove("teams/tm_test"); await denied(h, request(), "not-found", "TEAM_NOT_FOUND");
  });
  test("nonexistent/fully withdrawn application rejects", async () => {
    const h = harness(); h.remove(INBOX); h.remove(SECOND);
    await denied(h, request(), "not-found", "TEAM_JOIN_REQUEST_NOT_FOUND");
  });
  test("legacy messages document alone is not a trusted application", async () => {
    const h = harness(); h.remove(INBOX); h.remove(SECOND); h.change("messages/request", message());
    await denied(h, request(), "not-found");
  });
  test("forged applicantUid cannot redirect membership", async () => {
    const h = harness(); h.change("users/victim", { teamIds: [] });
    await denied(h, request({ applicantUid: "victim" }), "failed-precondition", "TEAM_JOIN_REQUEST_MISMATCH");
    expect(h.get("users/victim")).toEqual({ teamIds: [] });
  });
  test.each([
    { fromUid: "forger" }, { actionType: "other" },
    { meta: { teamId: "tm_other", applicantUid: "applicant", groupId: GROUP } },
    { meta: { teamId: "tm_test", applicantUid: "victim", groupId: GROUP } },
  ])("any mismatched group copy rejects all writes: %j", async patch => {
    const h = harness(); h.change(SECOND, patch); await denied(h, request(), "failed-precondition");
  });
  test("only users/*/inbox/* may establish a trusted application", async () => {
    const h = harness(); h.change("other/attacker/inbox/fake", message());
    await denied(h, request(), "failed-precondition", "TEAM_JOIN_REQUEST_MISMATCH");
  });
  test.each(["withdrawn", "cancelled", "canceled", "removed", "unknown"])("non-review terminal state %s rejects", async actionStatus => {
    const h = harness(); h.change(SECOND, { actionStatus }); await denied(h, request(), "failed-precondition");
  });
  test.each(["withdrawnAt", "cancelledAt", "canceledAt"])("withdrawal marker %s rejects even pending copies", async field => {
    const h = harness(); h.change(INBOX, { [field]: 1 }); await denied(h, request(), "failed-precondition");
  });
  test.each(["reject", "ignore"])("%s preserves applicant byte-for-byte", async action => {
    const h = harness(), before = h.get(USER);
    await expect(h.handler(request({ action }))).resolves.toMatchObject({ membershipAdded: false, actionStatus: action === "reject" ? "rejected" : "ignored" });
    expect(h.get(USER)).toEqual(before);
    expect(h.state.writes.every(w => w.path.includes("/inbox/"))).toBe(true);
    if (action === "reject") expect(h.get(INBOX).rejectedAt).toBe(1700000000100);
  });
  test.each(["approve", "reject", "ignore"])("first %s wins; repeated/opposite review is idempotent", async action => {
    const h = harness(); const first = await h.handler(request({ action }));
    const count = h.state.writes.length, applicant = h.get(USER), msg = h.get(INBOX);
    await expect(h.handler(request({ action: action === "approve" ? "reject" : "approve" }))).resolves.toMatchObject({
      actionStatus: first.actionStatus, alreadyReviewed: true, membershipAdded: false, updatedMessages: 0,
    });
    expect(h.state.writes).toHaveLength(count); expect(h.get(USER)).toEqual(applicant); expect(h.get(INBOX)).toEqual(msg);
  });
  test("replay after member leaves does not add them back", async () => {
    const h = harness(); await h.handler(request()); h.change(USER, { teamIds: ["tm_old"] });
    await expect(h.handler(request())).resolves.toMatchObject({ alreadyReviewed: true, membershipAdded: false });
    expect(h.get(USER).teamIds).toEqual(["tm_old"]);
  });
  test("a late pending copy inherits the first decision without touching applicant", async () => {
    const h = harness(); await h.handler(request({ action: "reject" })); h.change("users/late/inbox/late", message());
    await expect(h.handler(request())).resolves.toMatchObject({ alreadyReviewed: true, actionStatus: "rejected", updatedMessages: 1 });
    expect(h.get("users/late/inbox/late").rejectedAt).toBe(1700000000100);
    expect(h.get(USER).teamIds).toEqual(["tm_old"]);
  });
  test("conflicting existing decisions are not guessed", async () => {
    const h = harness(); h.change(INBOX, { actionStatus: "approved" }); h.change(SECOND, { actionStatus: "rejected" });
    await denied(h, request(), "failed-precondition", "TEAM_JOIN_REVIEW_CONFLICT");
  });
  test.each([
    { teamIds: ["tm_old", "tm_test"] }, { teamIds: ["tm_old"], teamId: "tm_test" },
    { teamIds: ["tm_test", "tm_test"] },
  ])("existing member is not appended/normalized: %j", async patch => {
    const h = harness(); h.change(USER, patch); const before = h.get(USER);
    await expect(h.handler(request())).resolves.toMatchObject({ alreadyMember: true, membershipAdded: false });
    expect(h.get(USER)).toEqual(before);
  });
  test("old list is de-duplicated like A normalizeMembership; unrelated fields remain intact", async () => {
    const h = harness(); h.change(USER, { teamIds: ["tm_old", "tm_old", "tm_other"], exp: 999 });
    const before = h.get(USER); await h.handler(request());
    expect(h.get(USER)).toEqual({ ...before, teamId: "tm_old", teamName: "Old",
      teamIds: ["tm_old", "tm_other", "tm_test"], teamNames: ["Old", "", "Test FC"] });
  });
  // P2-1：teamIds 非空但單值 teamId 不在清單時要聯集保留；修正前 B 會遺失（結果為 ['A','tm_test']）。
  test("scalar teamId missing from teamIds is kept (union, old order first)", async () => {
    const h = harness(); h.change(USER, { teamIds: ["A"], teamNames: ["A FC"], teamId: "B", teamName: "B FC" });
    await h.handler(request());
    expect(h.get(USER)).toMatchObject({ teamId: "A", teamName: "A FC",
      teamIds: ["A", "B", "tm_test"], teamNames: ["A FC", "B FC", "Test FC"] });
  });
  // P3-6：teamIds 含 null 時不得寫出 teamId:null；修正前 teamIds[0] 為 null。
  test.each([
    [{ teamIds: [null, "tm_old"], teamNames: ["", "Old"], teamId: null }, ["tm_old", "tm_test"], ["Old", "Test FC"]],
    [{ teamIds: [null], teamNames: [], teamId: null }, ["tm_test"], ["Test FC"]],
  ])("invalid teamIds entries are dropped: %j", async (patch, ids, names) => {
    const h = harness(); h.change(USER, patch); await h.handler(request());
    expect(h.get(USER)).toMatchObject({ teamId: ids[0], teamName: names[0], teamIds: ids, teamNames: names });
  });
  test.each([
    ["missing", seed => { delete seed[USER].teamIds; delete seed[USER].teamNames; seed[USER].teamName = "Old"; }],
    ["empty", seed => { seed[USER].teamIds = []; seed[USER].teamNames = []; seed[USER].teamName = "Old"; }],
  ])("%s teamIds falls back to legacy scalar membership like Rules", async (_, mutate) => {
    const seed = base(); mutate(seed); const h = harness(seed); await h.handler(request());
    expect(h.get(USER)).toMatchObject({
      teamId: "tm_old", teamName: "Old", teamIds: ["tm_old", "tm_test"], teamNames: ["Old", "Test FC"],
    });
  });
  test("applicant without any team gets primary teamId/teamName set to the joined team", async () => {
    const seed = base(); seed[USER] = { uid: "applicant", role: "user", teamId: null, teamIds: [], teamNames: [] };
    const h = harness(seed); await h.handler(request());
    expect(h.get(USER)).toEqual({ uid: "applicant", role: "user", teamId: "tm_test", teamName: "Test FC",
      teamIds: ["tm_test"], teamNames: ["Test FC"] });
  });
  test("team without name stores its document id as the name (A fallback)", async () => {
    const h = harness(); h.change("teams/tm_test", { name: "  " }); await h.handler(request());
    expect(h.get(USER).teamNames).toEqual(["Old", "tm_test"]);
  });
  test("longer legacy teamNames are trimmed to teamIds length, prefix unchanged", async () => {
    const h = harness(); h.change(USER, { teamNames: ["Old", "stale"] }); await h.handler(request());
    expect(h.get(USER)).toMatchObject({ teamIds: ["tm_old", "tm_test"], teamNames: ["Old", "Test FC"] });
  });
  test("malformed teamNames rejects instead of erasing data", async () => {
    const h = harness(); h.change(USER, { teamNames: "corrupt" });
    await denied(h, request(), "failed-precondition", "INVALID_MEMBERSHIP");
  });
  test("missing applicant on approval does not finalize application", async () => {
    const h = harness(); h.remove(USER); await denied(h, request(), "not-found", "APPLICANT_NOT_FOUND");
  });
  test("unique legacy applicant is resolved by UID in the same transaction", async () => {
    const seed = base(); seed["users/legacy"] = seed[USER]; delete seed[USER]; const h = harness(seed);
    await h.handler(request()); expect(h.get("users/legacy").teamIds).toEqual(["tm_old", "tm_test"]);
  });
  test("ambiguous legacy applicant rejects", async () => {
    const seed = base(); seed["users/legacy1"] = seed[USER]; seed["users/legacy2"] = seed[USER]; delete seed[USER];
    await denied(harness(seed), request(), "failed-precondition", "USER_IDENTITY_AMBIGUOUS");
  });
  test("canonical applicant identity mismatch rejects", async () => {
    const h = harness(); h.change(USER, { uid: "victim" });
    await denied(h, request(), "failed-precondition", "USER_IDENTITY_MISMATCH");
  });
  test("malformed teamIds rejects instead of erasing data", async () => {
    const h = harness(); h.change(USER, { teamIds: "corrupt" });
    await denied(h, request(), "failed-precondition", "INVALID_MEMBERSHIP");
  });
});

describe("reviewTeamJoin retries, budgets and boundary", () => {
  test("membership conflict retries and preserves concurrent addition", async () => {
    const h = harness(); h.state.beforeCommit = ({ attempt }) => { if (attempt === 1) h.change(USER, { teamIds: ["tm_old", "tm_concurrent"] }); };
    await h.handler(request()); expect(h.state.attempts).toBe(2);
    expect(h.get(USER).teamIds).toEqual(["tm_old", "tm_concurrent", "tm_test"]);
    expect(h.state.writes).toHaveLength(3); expect(h.state.writes.every(w => w.attempt === 2)).toBe(true);
  });
  test.each(["owner", "grant", "role", "withdrawal"])("retry revalidates concurrent %s revocation", async kind => {
    const h = harness();
    if (kind === "grant" || kind === "role") {
      h.change("teams/tm_test", { createdVia: "admin" });
      h.change("users/owner", { role: "staff_role" });
      h.change(kind === "grant" ? "userPermissionGrants/owner" : "rolePermissions/staff_role", { permissions: ["team.review_join"] });
    }
    h.state.beforeCommit = ({ attempt }) => {
      if (attempt !== 1) return;
      if (kind === "owner") h.change("teams/tm_test", { ownerUid: "other" });
      if (kind === "grant") h.change("userPermissionGrants/owner", { enabled: false });
      if (kind === "role") h.change("rolePermissions/staff_role", { permissions: [] });
      if (kind === "withdrawal") { h.remove(INBOX); h.remove(SECOND); }
    };
    await denied(h, request(), kind === "withdrawal" ? "not-found" : "permission-denied");
    expect(h.state.attempts).toBe(2);
  });
  test("another reviewer wins during contention; approval never adds member", async () => {
    const h = harness(); h.state.beforeCommit = ({ attempt }) => {
      if (attempt === 1) { h.change(INBOX, { actionStatus: "rejected", reviewerName: "Other", rejectedAt: 42 }); h.change(SECOND, { actionStatus: "rejected", reviewerName: "Other", rejectedAt: 42 }); }
    };
    await expect(h.handler(request())).resolves.toMatchObject({ alreadyReviewed: true, actionStatus: "rejected", membershipAdded: false });
    expect(h.state.attempts).toBe(2); expect(h.state.writes).toEqual([]); expect(h.get(USER).teamIds).toEqual(["tm_old"]);
  });
  test("ABORTED from transaction reads is left for SDK-style retry", async () => {
    const h = harness(); h.state.readError = (_, attempt) => attempt === 1 ? Object.assign(new Error("private"), { code: 10 }) : null;
    await h.handler(request()); expect(h.state.attempts).toBe(2); expect(h.logger.error).not.toHaveBeenCalled();
    expect(h.db.runTransaction.mock.calls[0]).toHaveLength(1);
  });
  test.each([10, "aborted", "ABORTED"])("exhausted %s retries return sanitized aborted", async code => {
    const h = harness(); h.state.commitError = () => Object.assign(new Error("secret uid resource"), { code });
    await denied(h, request(), "aborted", "TEAM_JOIN_REVIEW_RETRY");
    expect(h.state.attempts).toBe(5);
    expect(JSON.stringify(h.logger.error.mock.calls)).not.toMatch(/secret|applicant|tm_test|owner/);
  });
  test("unexpected HttpsError details/code never escape or enter logs", async () => {
    const h = harness(); h.state.readError = () => new HttpsError("private-code-secret", "private details");
    await denied(h, request(), "internal", "TEAM_JOIN_REVIEW_FAILED");
    expect(JSON.stringify(h.logger.error.mock.calls)).not.toMatch(/private/);
  });
  test("non-retryable commit failure leaves membership and messages unchanged", async () => {
    const h = harness(); h.state.commitError = () => new Error("private details");
    await denied(h, request(), "internal"); expect(h.get(INBOX).actionStatus).toBe("pending"); expect(h.state.attempts).toBe(1);
  });
  test("maximum group writes 451 documents in one transaction", async () => {
    const seed = base(); delete seed[INBOX]; delete seed[SECOND];
    // 呼叫者（owner）本人的副本要在群組內（收件人綁定），其餘 449 份為其他職員。
    seed[INBOX] = message();
    for (let i = 0; i < MAX_GROUP_MESSAGES - 1; i++) seed["users/staff" + i + "/inbox/request"] = message();
    const h = harness(seed); await h.handler(request());
    expect(h.state.writes).toHaveLength(451);
    // team 1 + 公開 id 別名查詢 1 + caller 1 + group 450 + applicant 1。
    expect(h.state.reads.reduce((n, r) => n + r.documents, 0)).toBe(454);
  });
  test("overflow fails closed without truncating group", async () => {
    const seed = base(); delete seed[INBOX]; delete seed[SECOND];
    for (let i = 0; i <= MAX_GROUP_MESSAGES; i++) seed["users/staff" + i + "/inbox/request"] = message();
    await denied(harness(seed), request(), "resource-exhausted", "TEAM_JOIN_GROUP_TOO_LARGE");
  });
  test("index export uses factory, real helpers and canonical region", () => {
    const h = harness(), onCall = jest.fn((options, handler) => ({ options, handler }));
    const callable = createReviewTeamJoinCallable({ onCall, ...h.dependencies });
    expect(callable.options).toEqual({ region: "asia-east1" });
    expect(callable.handler).toEqual(expect.any(Function));
    expect(indexSource).toContain('const { createReviewTeamJoinCallable } = require("./team-join-review");');
    const scope = { exports: {}, createReviewTeamJoinCallable: jest.fn(() => "callable"), onCall, ...h.dependencies };
    const start = indexSource.indexOf("exports.reviewTeamJoin =");
    vm.runInNewContext(indexSource.slice(start, indexSource.indexOf("});", start) + 3), scope);
    expect(scope.exports.reviewTeamJoin).toBe("callable");
    expect(scope.createReviewTeamJoinCallable).toHaveBeenCalledWith(expect.objectContaining({
      db: h.db, isTeamStaffForData: context.isTeamStaffForData, normalizeRole: context.normalizeRole, logger: h.logger,
      FieldValue: h.dependencies.FieldValue, enqueueLineFromServer: h.dependencies.enqueueLineFromServer,
    }));
  });
});

// 顧問裁定：核准／拒絕通知由本 Callable 在交易成功後於伺服器端發出（文案與 source 照 A message-actions-team.js）。
// 修正前 handler 不發任何通知：created 為空、enqueueLineFromServer 未被呼叫、回傳沒有 notification，下列測試皆失敗。
describe("reviewTeamJoin post-commit applicant notification", () => {
  const NOTICE = "users/applicant/inbox/msg_" + GROUP + "_review";
  const lineCalls = h => h.dependencies.enqueueLineFromServer.mock.calls.map(([input]) => input);

  test("approve notifies the applicant once (inbox + LINE) with A's text and source", async () => {
    const h = harness(); const result = await h.handler(request());
    expect(result.notification).toEqual({ kind: "approve", inbox: "written", line: "queued" });
    expect(h.state.created).toHaveLength(1);
    expect(h.get(NOTICE)).toMatchObject({
      id: "msg_" + GROUP + "_review", title: "俱樂部申請通過",
      body: "恭喜！您已成功加入「Test FC」俱樂部，審核人：Reviewer。",
      type: "system", typeName: "系統", senderName: "系統", fromUid: "owner",
      actionType: null, actionStatus: null, meta: null, read: false, createdAt: "SERVER_TS",
      time: expect.stringMatching(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/),
    });
    expect(lineCalls(h)).toEqual([{
      uid: "applicant", category: "system", title: "俱樂部申請通過",
      body: "恭喜！您已成功加入「Test FC」俱樂部，審核人：Reviewer。", source: "team_join_review:approve",
      dedupeKey: "team_join_review:" + GROUP, requestedByUid: "owner", requestedByRole: "user",
    }]);
  });
  test("reject notifies the applicant once with A's text and source", async () => {
    const h = harness(); const result = await h.handler(request({ action: "reject" }));
    expect(result.notification).toEqual({ kind: "reject", inbox: "written", line: "queued" });
    const body = "很抱歉，您申請加入「Test FC」俱樂部未獲通過。如有疑問，請聯繫俱樂部職員。";
    expect(h.get(NOTICE)).toMatchObject({ title: "俱樂部申請結果", body });
    expect(lineCalls(h)).toEqual([expect.objectContaining({ uid: "applicant", title: "俱樂部申請結果", body, source: "team_join_review:reject" })]);
  });
  test("ignore sends nothing", async () => {
    const h = harness(); await expect(h.handler(request({ action: "ignore" }))).resolves.toMatchObject({ notification: null });
    expect(h.state.created).toEqual([]); expect(lineCalls(h)).toEqual([]);
  });
  test("approve of an existing member sends nothing, like A (notification only when membership is written)", async () => {
    const h = harness(); h.change(USER, { teamIds: ["tm_old", "tm_test"] });
    await expect(h.handler(request())).resolves.toMatchObject({ alreadyMember: true, notification: null });
    expect(h.state.created).toEqual([]); expect(lineCalls(h)).toEqual([]);
  });
  test.each(["approve", "reject"])("replayed or opposite review after %s never notifies again", async action => {
    const h = harness(); await h.handler(request({ action }));
    for (const next of ["approve", "reject", "ignore", action]) {
      await expect(h.handler(request({ action: next }))).resolves.toMatchObject({ alreadyReviewed: true, notification: null });
    }
    expect(h.state.created).toHaveLength(1); expect(lineCalls(h)).toHaveLength(1);
  });
  test("losing a contention retry to another reviewer sends nothing", async () => {
    const h = harness(); h.state.beforeCommit = ({ attempt }) => {
      if (attempt === 1) { h.change(INBOX, { actionStatus: "rejected", reviewerName: "Other" }); h.change(SECOND, { actionStatus: "rejected", reviewerName: "Other" }); }
    };
    await expect(h.handler(request())).resolves.toMatchObject({ alreadyReviewed: true, notification: null });
    expect(h.state.created).toEqual([]); expect(lineCalls(h)).toEqual([]);
  });
  test("a winning retry notifies exactly once", async () => {
    const h = harness(); h.state.beforeCommit = ({ attempt }) => { if (attempt === 1) h.change(USER, { exp: 1 }); };
    await h.handler(request()); expect(h.state.attempts).toBe(2);
    expect(h.state.created).toHaveLength(1); expect(lineCalls(h)).toHaveLength(1);
  });
  test("recipient comes from the application document; extra request fields cannot redirect it", async () => {
    const h = harness();
    await h.handler(request({ recipientUid: "victim", targetUid: "victim", uid: "victim", notifyUid: "victim" }));
    expect(h.state.created.map(c => c.path)).toEqual([NOTICE]);
    expect(lineCalls(h).map(c => c.uid)).toEqual(["applicant"]);
  });
  test("forged applicantUid is rejected before any notification", async () => {
    const h = harness(); h.change("users/victim", { teamIds: [] });
    await denied(h, request({ applicantUid: "victim" }), "failed-precondition", "TEAM_JOIN_REQUEST_MISMATCH");
    expect(h.state.created).toEqual([]); expect(lineCalls(h)).toEqual([]);
  });
  test.each([
    ["LINE throws", h => { h.dependencies.enqueueLineFromServer.mockRejectedValueOnce(Object.assign(new Error("secret applicant"), { code: "resource-exhausted" })); },
      { inbox: "written", line: "failed" }, ["line"]],
    ["inbox create throws", h => { h.state.createError = () => Object.assign(new Error("secret applicant"), { code: 14 }); },
      { inbox: "failed", line: "queued" }, ["inbox"]],
    ["both throw", h => {
      h.state.createError = () => new Error("secret applicant");
      h.dependencies.enqueueLineFromServer.mockRejectedValueOnce(new Error("secret applicant"));
    }, { inbox: "failed", line: "failed" }, ["inbox", "line"]],
  ])("%s: review still succeeds and failure is logged without identifiers", async (_name, arrange, summary, channels) => {
    const h = harness(); arrange(h);
    const result = await h.handler(request());
    expect(result).toMatchObject({ ok: true, actionStatus: "approved", membershipAdded: true, notification: { kind: "approve", ...summary } });
    expect(h.get(USER).teamIds).toEqual(["tm_old", "tm_test"]);
    expect(h.get(INBOX).actionStatus).toBe("approved");
    expect(h.logger.error.mock.calls.map(([msg, data]) => [msg, data.channel])).toEqual(
      channels.map(channel => ["[reviewTeamJoin] notification failed", channel]));
    expect(h.logger.error.mock.calls.every(([, data]) => data.function === "reviewTeamJoin" && data.stage === "notify")).toBe(true);
    expect(JSON.stringify(h.logger.error.mock.calls)).not.toMatch(/secret|applicant|owner|tm_test|tjr_/);
  });
  test.each([
    [{ queued: false, skipped: true, reason: "not_bound" }, "not_bound"],
    [{ queued: false, skipped: true, reason: "category_disabled" }, "category_disabled"],
    [{ queued: false, skipped: true, reason: "notification_toggle_disabled" }, "notification_toggle_disabled"],
    [{ queued: false, skipped: true, reason: "private raw reason" }, "other"],
  ])("LINE skip (%j) is reported as a fixed reason, inbox still written", async (lineResult, reason) => {
    const h = harness(); h.dependencies.enqueueLineFromServer.mockResolvedValueOnce(lineResult);
    await expect(h.handler(request({ action: "reject" }))).resolves.toMatchObject({
      notification: { kind: "reject", inbox: "written", line: "skipped", lineReason: reason },
    });
    expect(h.logger.error).not.toHaveBeenCalled();
  });
  test("an existing review notice is not overwritten (duplicate)", async () => {
    const h = harness(); h.change(NOTICE, { title: "earlier" });
    await expect(h.handler(request())).resolves.toMatchObject({ notification: { inbox: "duplicate" } });
    expect(h.get(NOTICE).title).toBe("earlier");
  });
  test("notification summary carries no UID", async () => {
    const h = harness(); const result = await h.handler(request());
    expect(JSON.stringify(result.notification)).not.toMatch(/applicant|owner/);
  });
  // 終驗 P3：通知 id 是 deliverToInbox 的保留 id，客戶端無法先種或覆寫；兩邊形狀須同步。
  // 修正前 index.js 沒有 DELIVER_INBOX_RESERVED_ID_RE、本模組沒有 buildReviewNoticeMessageId，此測試失敗。
  test("notice id is reserved by deliverToInbox; current client id shapes are not", () => {
    const start = indexSource.indexOf("const DELIVER_INBOX_RESERVED_ID_RE");
    expect(start).toBeGreaterThanOrEqual(0);
    const reserved = vm.runInNewContext(indexSource.slice(start, indexSource.indexOf("\n", start)) + "\nDELIVER_INBOX_RESERVED_ID_RE");
    const id = buildReviewNoticeMessageId(GROUP);
    expect(id).toBe("msg_" + GROUP + "_review");
    expect(reserved.test(id)).toBe(true);
    expect(reserved.test(buildReviewNoticeMessageId("tjr_1730000000000_ab12cd34"))).toBe(true);
    // A message-notify.js／FC-B inbox-delivery.ts 產生 msg_<ms>_<4 碼>。
    expect(reserved.test("msg_1730000000000_ab12")).toBe(false);
  });
});
