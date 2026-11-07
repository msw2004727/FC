"use strict";

/**
 * SP2 按鈕加速②：後置 batch／已讀 EXP、權限讀取並行、名單預熱、耗時紀錄。
 * 權限「改前」是這支測試裡的循序 oracle；「改後」是 functions/index.js 的 getCallerAccessContext。
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createHarness, access } = require("./event-roster-status-helpers");
const { createConfirmEventAttendanceHandler } = require("../../functions/event-attendance-confirm");
const { createFakeFirestore, loadFunctionsIndex } = require("./registration-callable-harness");

const indexSource = fs.readFileSync(path.join(__dirname, "../../functions/index.js"), "utf8").replace(/\r\n/g, "\n");

function skipLiteral(source, index) {
  const ch = source[index];
  const next = source[index + 1];
  if (ch === "/" && next === "/") {
    const end = source.indexOf("\n", index);
    return end < 0 ? source.length : end;
  }
  if (ch === "/" && next === "*") {
    const end = source.indexOf("*/", index + 2);
    return end < 0 ? source.length : end + 2;
  }
  if (ch !== "'" && ch !== '"' && ch !== "`") return index;
  for (let i = index + 1; i < source.length; i += 1) {
    if (source[i] === "\\") { i += 1; continue; }
    if (source[i] === ch) return i + 1;
  }
  return source.length;
}

function functionBodyStart(source, start) {
  let depth = 0;
  for (let i = source.indexOf("(", start); i < source.length; i += 1) {
    const skipped = skipLiteral(source, i);
    if (skipped > i) { i = skipped - 1; continue; }
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        const body = source.indexOf("{", i + 1);
        if (body < 0) throw new Error("no body after " + start);
        return body;
      }
    }
  }
  throw new Error("unclosed params after " + start);
}

function extractFunction(name) {
  const start = indexSource.search(new RegExp("(?:async )?function " + name + "\\("));
  if (start < 0) throw new Error("missing " + name);
  let depth = 0;
  for (let i = functionBodyStart(indexSource, start); i < indexSource.length; i += 1) {
    const skipped = skipLiteral(indexSource, i);
    if (skipped > i) { i = skipped - 1; continue; }
    if (indexSource[i] === "{") depth += 1;
    else if (indexSource[i] === "}") {
      depth -= 1;
      if (depth === 0) return indexSource.slice(start, i + 1);
    }
  }
  throw new Error("unclosed " + name);
}

function between(start, end) {
  const i = indexSource.indexOf(start);
  const j = indexSource.indexOf(end, i + start.length);
  if (i < 0 || j < 0) throw new Error("missing slice " + start);
  return indexSource.slice(i, j);
}

const FieldValue = {
  serverTimestamp: () => "SERVER_TS",
  increment: (n) => ({ increment: n }),
};

function createOpDb(seed = {}) {
  const docs = new Map(Object.entries(seed));
  const gets = [];
  let commits = 0;
  let commitError = null;
  const queued = [];
  function ref(docPath) {
    return {
      path: docPath,
      get: async () => {
        gets.push(docPath);
        return {
          exists: docs.has(docPath),
          id: docPath.split("/").pop(),
          data: () => docs.get(docPath),
        };
      },
      collection: (name) => collection(`${docPath}/${name}`),
    };
  }
  function collection(colPath) {
    const filters = [];
    const api = {
      doc: (id) => ref(id ? `${colPath}/${id}` : `${colPath}/auto${docs.size + queued.length + 1}`),
      where: (field, op, value) => {
        filters.push({ field, op, value });
        return api;
      },
      limit: () => api,
      get: async () => {
        gets.push(`query:${colPath}`);
        const rows = [...docs.entries()].filter(([docPath, data]) => {
          const rest = docPath.startsWith(`${colPath}/`) ? docPath.slice(colPath.length + 1) : "";
          if (!rest || rest.includes("/")) return false;
          return filters.every((item) => item.op === "==" && data[item.field] === item.value);
        });
        return {
          empty: rows.length === 0,
          docs: rows.map(([docPath, data]) => ({ id: docPath.split("/").pop(), data: () => data })),
        };
      },
      add: () => { throw new Error("messages.add should not be used"); },
    };
    return api;
  }
  const db = {
    collection,
    batch() {
      const ops = [];
      return {
        set: (target, data) => { ops.push({ op: "set", path: target.path, data }); queued.push(target.path); },
        update: (target, data) => { ops.push({ op: "update", path: target.path, data }); },
        create: (target, data) => { ops.push({ op: "create", path: target.path, data }); },
        commit: async () => {
          commits += 1;
          if (commitError) throw commitError;
          ops.forEach((op) => {
            if (op.op === "update") docs.set(op.path, { ...(docs.get(op.path) || {}), ...op.data });
            else docs.set(op.path, op.data);
          });
        },
      };
    },
  };
  return {
    db,
    docs,
    gets,
    commits: () => commits,
    failCommit: (error) => { commitError = error; },
  };
}

const permissionNames = [
  "normalizeRole", "normalizeBuiltInRole", "normalizePermissionCode", "sanitizePermissionCodeList",
  "sanitizeUserPermissionGrantCodeList", "getDefaultRolePermissions", "findUserDocByUidOrLineUserId",
  "getUserRoleFromFirestore", "getCallerRoleWithFallback", "getRolePermissionsFromFirestore",
  "getUserPermissionGrantsFromFirestore", "sanitizeRoleActivityCapabilityList",
  "getRoleActivityCapabilitiesFromFirestore", "getCallerAccessContext",
  "providedExpUserMatches", "adjustExpInternal", "writeInboxNotification",
];

const legacySource = `
async function legacyGetCallerAccessContext(request) {
  const role = await getCallerRoleWithFallback(request);
  const stored = role === "super_admin" ? [] : await getRolePermissionsFromFirestore(role);
  const userGrants = role === "super_admin" ? [] : await getUserPermissionGrantsFromFirestore(request.auth?.uid);
  const inherent = INHERENT_ROLE_PERMISSIONS[role] || [];
  const permissions = Array.from(new Set([...stored, ...userGrants, ...inherent]));
  const activityCapabilities = await getRoleActivityCapabilitiesFromFirestore(role);
  return {
    role,
    permissions,
    activityCapabilities,
    isSuperAdmin: role === "super_admin",
    hasPermission(code) {
      const normalized = normalizePermissionCode(code);
      return role === "super_admin" || (!!normalized && permissions.includes(normalized));
    },
    hasActivityCapability(code) {
      return role === "user" && activityCapabilities.includes(code);
    },
  };
}
`;

function loadHelpers(db) {
  const errors = [];
  const sandbox = {
    db,
    FieldValue,
    console: { error: (...args) => errors.push(args), log() {}, warn() {}, info() {} },
  };
  const source = [
    between("const VALID_ROLES", "const ADMIN_USER_EDIT_PROFILE_PERMISSION"),
    'const SECONDARY_IDENTITY_PERMISSION = "profile.secondary_identity";',
    between("const ROLE_LEVELS", "const notificationGuards"),
    between("const INHERENT_ROLE_PERMISSIONS", "const ALLOWED_AUDIT_ACTIONS"),
    permissionNames.map(extractFunction).join("\n"),
    legacySource,
  ].join("\n");
  vm.runInNewContext(source, sandbox, { filename: "button-latency-sp2.vm.js" });
  sandbox.errors = errors;
  return sandbox;
}

const PERM_CODES = [
  "event.edit_all", "event.edit_self", "event.scan", "event.create", "admin.seo.entry",
  "admin.repair.event_blocklist", "activity.manage.entry", "admin.logs.audit_read", "admin.roles.entry", "nope",
];
const CAP_CODES = [
  "user.activity.site_operate", "user.activity.addons_use", "user.activity.basic_create", "user.activity.team_create",
];

function viewAccess(entry) {
  return {
    role: entry.role,
    permissions: entry.permissions,
    activityCapabilities: entry.activityCapabilities,
    isSuperAdmin: entry.isSuperAdmin,
    perm: Object.fromEntries(PERM_CODES.map((code) => [code, entry.hasPermission(code)])),
    cap: Object.fromEntries(CAP_CODES.map((code) => [code, entry.hasActivityCapability(code)])),
  };
}

function permissionDb(docs, gate) {
  const reads = [];
  let inflight = 0;
  let maxInflight = 0;
  const tracked = new Set(["rolePermissions", "userPermissionGrants", "roleActivityCapabilities"]);
  const db = {
    collection(name) {
      return {
        doc(id) {
          return {
            get: async () => {
              const key = `${name}/${id}`;
              reads.push(key);
              if (gate && tracked.has(name)) {
                inflight += 1;
                maxInflight = Math.max(maxInflight, inflight);
                await gate.promise;
                inflight -= 1;
              }
              const data = docs[key];
              return { exists: data !== undefined, id, data: () => data };
            },
          };
        },
        where() {
          return { limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) };
        },
      };
    },
  };
  return { db, reads, maxInflight: () => maxInflight };
}

function gate() {
  let release;
  const promise = new Promise((resolve) => { release = resolve; });
  return { promise, release };
}

describe("writeInboxNotification batch", () => {
  test("一次 commit 同時寫 messages 與 inbox", async () => {
    const store = createOpDb();
    const sandbox = loadHelpers(store.db);
    await sandbox.writeInboxNotification({
      recipientUid: "uid-inbox",
      title: "報名成功通知",
      body: "短訊",
      category: "activity",
      categoryLabel: "活動",
    });
    expect(store.commits()).toBe(1);
    const paths = [...store.docs.keys()];
    expect(paths.filter((item) => item.startsWith("messages/"))).toHaveLength(1);
    const inbox = paths.filter((item) => item.startsWith("users/uid-inbox/inbox/"));
    expect(inbox).toHaveLength(1);
    expect(store.docs.get(inbox[0])).toMatchObject({
      title: "報名成功通知",
      body: "短訊",
      type: "activity",
      typeName: "活動",
      read: false,
      fromUid: "system",
    });
    expect(store.docs.get(paths.find((item) => item.startsWith("messages/")))).toMatchObject({
      recipientUid: "uid-inbox",
      title: "報名成功通知",
      read: false,
      category: "activity",
    });
  });

  test("commit 失敗時兩處都沒寫，且不把錯誤拋給呼叫端", async () => {
    const store = createOpDb();
    store.failCommit(new Error("BATCH_FAILED"));
    const sandbox = loadHelpers(store.db);
    await expect(sandbox.writeInboxNotification({
      recipientUid: "uid-inbox",
      title: "標題",
      body: "內文",
      category: "activity",
      categoryLabel: "活動",
    })).resolves.toBeUndefined();
    expect(store.commits()).toBe(1);
    expect([...store.docs.keys()]).toEqual([]);
    expect(sandbox.errors.some((args) => String(args[0]).includes("[writeInboxNotification]"))).toBe(true);
  });
});

describe("adjustExpInternal 已讀使用者", () => {
  test("傳入吻合的使用者文件時不再讀", async () => {
    const store = createOpDb();
    const sandbox = loadHelpers(store.db);
    const result = await sandbox.adjustExpInternal({
      targetUid: "line-uid",
      amount: 10,
      reason: "報名活動：測試",
      ruleKey: "register_activity",
      operatorUid: "line-uid",
      targetUser: { docId: "legacy-doc", data: { uid: "line-uid", lineUserId: "line-uid", displayName: "甲" } },
    });
    expect(result).toEqual({ targetUid: "line-uid", amount: 10 });
    expect(store.gets).toEqual([]);
    expect(store.docs.has("users/legacy-doc")).toBe(true);
    expect(store.docs.get("users/legacy-doc").exp).toEqual({ increment: 10 });
    expect(store.commits()).toBe(1);
  });

  test("未傳時照舊讀取使用者文件", async () => {
    const store = createOpDb({
      "users/uid-1": { uid: "uid-1", lineUserId: "uid-1", displayName: "乙" },
    });
    const sandbox = loadHelpers(store.db);
    await sandbox.adjustExpInternal({
      targetUid: "uid-1", amount: -5, reason: "取消報名：測試", ruleKey: "cancel_registration", operatorUid: "uid-1",
    });
    expect(store.gets).toContain("users/uid-1");
    expect(store.docs.get("users/uid-1").exp).toEqual({ increment: -5 });
  });

  test("傳入對不上的文件時改走原本的讀取", async () => {
    const store = createOpDb({
      "users/uid-1": { uid: "uid-1", lineUserId: "uid-1", displayName: "乙" },
    });
    const sandbox = loadHelpers(store.db);
    await sandbox.adjustExpInternal({
      targetUid: "uid-1",
      amount: 10,
      reason: "報名",
      ruleKey: "register_activity",
      operatorUid: "uid-1",
      targetUser: { docId: "other", data: { uid: "someone-else" } },
    });
    expect(store.gets).toContain("users/uid-1");
    expect(store.docs.has("users/uid-1")).toBe(true);
    expect(store.docs.has("users/other")).toBe(false);
  });
});

describe("getCallerAccessContext 與循序結果一致", () => {
  const cases = [
    {
      name: "一般 user，沒有個別授權，capabilities 用預設",
      uid: "uid-user",
      docs: { "users/uid-user": { uid: "uid-user", lineUserId: "uid-user", role: "user", displayName: "一般" } },
    },
    {
      name: "一般 user，有個別授權與自訂 capabilities",
      uid: "uid-grant",
      docs: {
        "users/uid-grant": { uid: "uid-grant", lineUserId: "uid-grant", role: "user" },
        "userPermissionGrants/uid-grant": { enabled: true, permissions: ["event.scan", "event.edit_own", "not-a-real-code"] },
        "roleActivityCapabilities/user": { capabilities: ["user.activity.site_operate", "bogus", "user.activity.addons_use"] },
      },
    },
    {
      name: "一般 user，個別授權已關閉",
      uid: "uid-off",
      docs: {
        "users/uid-off": { uid: "uid-off", lineUserId: "uid-off", role: "user" },
        "userPermissionGrants/uid-off": { enabled: false, permissions: ["event.scan"] },
      },
    },
    {
      name: "教練，含 legacy 權限碼與個別授權",
      uid: "uid-coach",
      docs: {
        "users/uid-coach": { uid: "uid-coach", lineUserId: "uid-coach", role: "coach" },
        "rolePermissions/coach": { permissions: ["event.edit_own", "event.scan", "admin.roles.entry"] },
        "userPermissionGrants/uid-coach": { enabled: true, permissions: ["event.create"] },
      },
    },
    {
      name: "admin，角色文件缺失時用預設，另有個別授權",
      uid: "uid-admin",
      docs: {
        "users/uid-admin": { uid: "uid-admin", lineUserId: "uid-admin", role: "admin" },
        "userPermissionGrants/uid-admin": { enabled: true, permissions: ["admin.logs.audit_read"] },
      },
    },
    {
      name: "super_admin，不採用 rolePermissions 與個別授權文件",
      uid: "uid-super",
      docs: {
        "users/uid-super": { uid: "uid-super", lineUserId: "uid-super", role: "super_admin" },
        "rolePermissions/super_admin": { permissions: ["event.scan"] },
        "userPermissionGrants/uid-super": { enabled: true, permissions: ["event.create"] },
        "roleActivityCapabilities/user": { capabilities: ["user.activity.site_operate"] },
      },
    },
  ];

  test.each(cases)("$name", async ({ uid, docs }) => {
    const store = permissionDb(docs);
    const sandbox = loadHelpers(store.db);
    const request = { auth: { uid, token: { role: "user" } } };
    const next = viewAccess(await sandbox.getCallerAccessContext(request));
    const prev = viewAccess(await sandbox.legacyGetCallerAccessContext(request));
    expect(next).toEqual(prev);
  });

  test("已知語意：user／教練／admin／super_admin／個別授權", async () => {
    async function load(uid, docs) {
      const sandbox = loadHelpers(permissionDb(docs).db);
      return viewAccess(await sandbox.getCallerAccessContext({ auth: { uid, token: {} } }));
    }
    const plain = await load("uid-user", cases[0].docs);
    expect(plain.role).toBe("user");
    expect(plain.isSuperAdmin).toBe(false);
    expect(plain.perm["event.scan"]).toBe(false);
    expect(plain.cap["user.activity.basic_create"]).toBe(true);
    expect(plain.cap["user.activity.addons_use"]).toBe(false);

    const granted = await load("uid-grant", cases[1].docs);
    expect(granted.perm["event.scan"]).toBe(true);
    expect(granted.perm["event.edit_self"]).toBe(false);
    expect(granted.cap["user.activity.addons_use"]).toBe(true);
    expect(granted.cap["user.activity.site_operate"]).toBe(true);

    const disabled = await load("uid-off", cases[2].docs);
    expect(disabled.perm["event.scan"]).toBe(false);

    const coach = await load("uid-coach", cases[3].docs);
    expect(coach.role).toBe("coach");
    expect(coach.perm["event.edit_self"]).toBe(true);
    expect(coach.perm["event.scan"]).toBe(true);
    expect(coach.perm["event.create"]).toBe(true);
    expect(coach.perm["admin.roles.entry"]).toBe(false);
    expect(coach.cap["user.activity.site_operate"]).toBe(false);

    const admin = await load("uid-admin", cases[4].docs);
    expect(admin.perm["event.edit_all"]).toBe(true);
    expect(admin.perm["admin.logs.audit_read"]).toBe(true);
    expect(admin.perm.nope).toBe(false);

    const superAdmin = await load("uid-super", cases[5].docs);
    expect(superAdmin.isSuperAdmin).toBe(true);
    expect(superAdmin.permissions).toEqual(expect.arrayContaining(["admin.repair.event_blocklist", "admin.seo.entry"]));
    expect(superAdmin.permissions).not.toContain("event.scan");
    expect(superAdmin.permissions).not.toContain("event.create");
    expect(superAdmin.perm.nope).toBe(true);
    expect(superAdmin.activityCapabilities).toEqual([]);
  });

  test("教練與一般 user 的權限讀取重疊；super_admin 不讀那三個集合", async () => {
    async function overlap(uid, docs) {
      const held = gate();
      const store = permissionDb(docs, held);
      const sandbox = loadHelpers(store.db);
      const pending = sandbox.getCallerAccessContext({ auth: { uid, token: {} } });
      await new Promise((resolve) => setImmediate(resolve));
      const started = store.maxInflight();
      held.release();
      await pending;
      return { started, reads: store.reads };
    }

    const coach = await overlap("uid-coach", cases[3].docs);
    expect(coach.started).toBeGreaterThanOrEqual(2);
    expect(coach.reads).toEqual(expect.arrayContaining(["rolePermissions/coach", "userPermissionGrants/uid-coach"]));

    const user = await overlap("uid-grant", cases[1].docs);
    expect(user.started).toBeGreaterThanOrEqual(2);
    expect(user.reads).toEqual(expect.arrayContaining([
      "userPermissionGrants/uid-grant",
      "roleActivityCapabilities/user",
    ]));
    expect(user.reads.some((item) => item.startsWith("rolePermissions/"))).toBe(false);

    const held = gate();
    const store = permissionDb(cases[5].docs, held);
    const sandbox = loadHelpers(store.db);
    const pending = sandbox.getCallerAccessContext({ auth: { uid: "uid-super", token: {} } });
    await Promise.race([
      pending,
      new Promise((_, reject) => setTimeout(() => reject(new Error("super_admin permission read hung")), 500)),
    ]);
    expect(store.maxInflight()).toBe(0);
    expect(store.reads.filter((item) => /^(rolePermissions|userPermissionGrants|roleActivityCapabilities)\//.test(item))).toEqual([]);
  });
});

describe("名單與簽到預熱", () => {
  test.each(["demote", "promote"])("%s 已登入 warmup 不讀寫、不記耗時", async (action) => {
    const h = createHarness({ action });
    const spy = jest.spyOn(console, "log").mockImplementation(() => {});
    await expect(h.invoke({ warmup: true, eventId: "", userId: "not-a-user" })).resolves.toEqual({ warmup: true });
    expect(h.deps.claimRequestId).not.toHaveBeenCalled();
    expect(h.deps.getCallerAccessContext).not.toHaveBeenCalled();
    expect(h.fake.state.transactionAttempts).toBe(0);
    expect(h.fake.state.writes).toEqual([]);
    expect(h.deps.logger.info).not.toHaveBeenCalled();
    expect(h.deps.logger.warn).not.toHaveBeenCalled();
    expect(h.deps.logger.error).not.toHaveBeenCalled();
    expect(spy.mock.calls.map((args) => args[0]).join("\n")).not.toContain("ms_total");
    spy.mockRestore();
  });

  test.each(["demote", "promote"])("%s 未登入 warmup 仍拒絕，且不 claim", async (action) => {
    const h = createHarness({ action });
    await expect(h.invoke({ warmup: true }, null)).rejects.toMatchObject({ code: "unauthenticated" });
    expect(h.deps.claimRequestId).not.toHaveBeenCalled();
    expect(h.deps.getCallerAccessContext).not.toHaveBeenCalled();
    expect(h.fake.state.writes).toEqual([]);
  });

  test("confirmEventAttendance 已登入 warmup 不讀寫；未登入拒絕", async () => {
    const db = { runTransaction: jest.fn() };
    const getCallerAccessContext = jest.fn();
    const logger = { error: jest.fn() };
    class MockHttpsError extends Error {
      constructor(code, message) { super(message); this.code = code; }
    }
    const handler = createConfirmEventAttendanceHandler({
      HttpsError: MockHttpsError,
      db,
      FieldValue,
      getCallerAccessContext,
      canOperateEventSiteForAccess: jest.fn(() => true),
      logger,
    });
    await expect(handler({
      auth: { uid: "operator" },
      data: { warmup: true, eventId: "", desired: null },
    })).resolves.toEqual({ warmup: true });
    expect(db.runTransaction).not.toHaveBeenCalled();
    expect(getCallerAccessContext).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    await expect(handler({ auth: null, data: { warmup: true } })).rejects.toMatchObject({ code: "unauthenticated" });
    expect(db.runTransaction).not.toHaveBeenCalled();
    expect(getCallerAccessContext).not.toHaveBeenCalled();
  });
});

describe("名單耗時與 claim／權限並行", () => {
  function timingLines(spy) {
    return spy.mock.calls.map((args) => args[0]).filter((line) => typeof line === "string" && line.includes("\"ms_total\"")).map((line) => JSON.parse(line));
  }

  test.each(["demote", "promote"])("%s 成功與拒絕都有耗時，且不含 UID 或名字", async (action) => {
    const spy = jest.spyOn(console, "log").mockImplementation(() => {});
    const ok = createHarness({ action });
    await ok.invoke();
    const success = timingLines(spy).filter((line) => line.fn === (action === "demote" ? "forceDemoteToWaitlist" : "forcePromoteWaitlist"));
    expect(success).toHaveLength(1);
    expect(Object.keys(success[0]).sort()).toEqual(["fn", "ms_auth", "ms_post", "ms_total", "ms_txn", "outcome"]);
    expect(success[0].outcome).toBe("ok");
    for (const key of ["ms_total", "ms_auth", "ms_txn", "ms_post"]) expect(success[0][key]).toEqual(expect.any(Number));
    expect(JSON.stringify(success[0])).not.toMatch(/uidA|uidB|測試甲/);

    spy.mockClear();
    const denied = createHarness({ action });
    await expect(denied.invoke({ userName: "王小明" }, null)).rejects.toMatchObject({ code: "unauthenticated" });
    const failed = timingLines(spy);
    expect(failed).toHaveLength(1);
    expect(failed[0].outcome).toBe("unauthenticated");
    expect(failed[0].ms_txn).toBe(0);
    expect(failed[0].ms_post).toBe(0);
    expect(JSON.stringify(failed[0])).not.toContain("王小明");
    spy.mockRestore();
  });

  test("claim 與權限讀取同時開始；去重命中即使權限讀取失敗也回 deduplicated", async () => {
    const h = createHarness();
    let releaseClaim;
    const claimGate = new Promise((resolve) => { releaseClaim = resolve; });
    let accessStarted = false;
    h.deps.claimRequestId.mockImplementation(() => claimGate);
    h.deps.getCallerAccessContext.mockImplementation(async () => {
      accessStarted = true;
      return access();
    });
    const pending = h.invoke({ requestId: "req-parallel" });
    expect(accessStarted).toBe(true);
    releaseClaim(true);
    await expect(pending).resolves.toMatchObject({ success: true });

    const dup = createHarness();
    dup.deps.claimRequestId.mockResolvedValue(false);
    dup.deps.getCallerAccessContext.mockRejectedValue(new Error("sensitive-uid-xyz"));
    await expect(dup.invoke({ requestId: "dup" })).resolves.toEqual({ success: true, deduplicated: true });
    expect(dup.fake.state.transactionAttempts).toBe(0);
  });
});

describe("registerForEvent／cancelRegistration 耗時與後置讀寫", () => {
  const SECRET = "USECRET7788TOKEN";
  const OTHER = "UOTHER9988TOKEN";
  const EVENT_ID = "ce_1800000000000_abc";
  const FUTURE = "2099/06/15 10:00~12:00";
  let fn;
  let harness;

  beforeAll(() => {
    const loaded = loadFunctionsIndex();
    fn = loaded.exports;
    harness = loaded.harness;
  });

  function user(uid) {
    return {
      uid,
      lineUserId: uid,
      name: "王小明",
      displayName: "王小明",
      gender: "male",
      birthday: "1990-01-01",
      region: "taipei",
      role: "user",
      exp: 100,
    };
  }

  function event() {
    return {
      id: EVENT_ID, title: "延遲測試活動", date: FUTURE, location: "field", type: "play",
      status: "open", max: 4, current: 0, waitlist: 0, participants: [], waitlistNames: [],
    };
  }

  function countUserGets(fake) {
    const gets = [];
    const orig = fake.db.collection;
    fake.db.collection = function collection(name) {
      const col = orig.call(this, name);
      if (name !== "users") return col;
      const origDoc = col.doc.bind(col);
      col.doc = function doc(id) {
        const ref = origDoc(id);
        const origGet = ref.get.bind(ref);
        ref.get = async () => {
          gets.push(id);
          return origGet();
        };
        return ref;
      };
      return col;
    };
    return gets;
  }

  function timings() {
    return harness.logs.filter((entry) => entry[0] === "log").map((entry) => {
      try { return JSON.parse(entry[1]); } catch (_error) { return null; }
    }).filter((line) => line && line.ms_total !== undefined && line.fn);
  }

  beforeEach(() => {
    harness.logs.length = 0;
    harness.current = createFakeFirestore({});
  });

  test("onCall 的 region、memory、minInstances 維持原值", () => {
    expect(fn.registerForEvent.__options).toEqual({
      region: "asia-east1", timeoutSeconds: 30, memory: "512MiB", minInstances: 1,
    });
    expect(fn.cancelRegistration.__options).toEqual({
      region: "asia-east1", timeoutSeconds: 30, memory: "512MiB", minInstances: 1,
    });
  });

  test("報名成功：耗時欄位齊、不含 UID／名字；通知同一 batch；本人 EXP 不再多讀一次", async () => {
    const fake = createFakeFirestore({
      [`users/${SECRET}`]: user(SECRET),
      [`events/${EVENT_ID}`]: event(),
    });
    harness.current = fake;
    const gets = countUserGets(fake);
    harness.logs.length = 0;
    const result = await fn.registerForEvent({
      auth: { uid: SECRET, token: {} },
      data: { eventId: EVENT_ID, participants: [{ userId: SECRET, userName: "王小明" }] },
    });
    expect(result.success).toBe(true);
    expect(fake.get(`users/${SECRET}`).exp).toBe(110);
    expect(gets.filter((id) => id === SECRET)).toHaveLength(1);
    const message = fake.state.writes.filter((item) => item.path.startsWith("messages/"));
    const inbox = fake.state.writes.filter((item) => item.path.startsWith(`users/${SECRET}/inbox/`));
    expect(message).toHaveLength(1);
    expect(inbox).toHaveLength(1);
    expect(message[0].via).toBe("batch");
    expect(inbox[0].via).toBe("batch");
    expect(message[0].commit).toBe(inbox[0].commit);
    const line = timings().find((item) => item.fn === "registerForEvent");
    expect(Object.keys(line).sort()).toEqual(["fn", "ms_auth", "ms_post", "ms_total", "ms_txn", "outcome"]);
    expect(line.outcome).toBe("ok");
    for (const key of ["ms_total", "ms_auth", "ms_txn", "ms_post"]) expect(line[key]).toEqual(expect.any(Number));
    expect(JSON.stringify(line)).not.toContain(SECRET);
    expect(JSON.stringify(line)).not.toContain("王小明");
  });

  test("報名未登入：outcome 為錯誤碼，耗時不含個資", async () => {
    harness.logs.length = 0;
    await expect(fn.registerForEvent({
      auth: null,
      data: { eventId: EVENT_ID, displayName: "王小明", uid: SECRET },
    })).rejects.toMatchObject({ code: "unauthenticated" });
    const line = timings().find((item) => item.fn === "registerForEvent");
    expect(line.outcome).toBe("unauthenticated");
    expect(line.ms_txn).toBe(0);
    expect(line.ms_post).toBe(0);
    expect(JSON.stringify(line)).not.toContain(SECRET);
    expect(JSON.stringify(line)).not.toContain("王小明");
  });

  test("取消本人多筆只讀一次使用者，並寫耗時", async () => {
    const fake = createFakeFirestore({
      [`users/${SECRET}`]: user(SECRET),
      [`users/${OTHER}`]: user(OTHER),
      [`events/${EVENT_ID}`]: event(),
      [`events/${EVENT_ID}/registrations/r1`]: {
        id: "r1", eventId: EVENT_ID, userId: SECRET, userName: "王小明", participantType: "self", status: "confirmed",
      },
      [`events/${EVENT_ID}/registrations/r2`]: {
        id: "r2", eventId: EVENT_ID, userId: SECRET, userName: "王小明", participantType: "companion",
        companionId: "comp_1", status: "confirmed",
      },
    });
    harness.current = fake;
    const gets = countUserGets(fake);
    harness.logs.length = 0;
    const result = await fn.cancelRegistration({
      auth: { uid: SECRET, token: {} },
      data: { eventId: EVENT_ID, registrationIds: ["r1", "r2"], reason: "user_cancel" },
    });
    expect(result.success).toBe(true);
    expect(result.cancelled).toHaveLength(2);
    expect(fake.get(`users/${SECRET}`).exp).toBe(90);
    expect(gets.filter((id) => id === SECRET)).toHaveLength(1);
    const line = timings().find((item) => item.fn === "cancelRegistration");
    expect(line.outcome).toBe("ok");
    expect(Object.keys(line).sort()).toEqual(["fn", "ms_auth", "ms_post", "ms_total", "ms_txn", "outcome"]);
    expect(JSON.stringify(line)).not.toContain(SECRET);
    expect(JSON.stringify(line)).not.toContain("王小明");
  });
});
