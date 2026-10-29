"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {
  decideAdminManageUser,
  BUILTIN_LEVELS: AUTHZ_BUILTIN_LEVELS,
} = require("../../functions/admin-user-authz");
const {
  resolveRoleGraph,
  createRoleGraphLoader,
  BUILTIN_LEVELS: HIERARCHY_BUILTIN_LEVELS,
} = require("../../functions/role-hierarchy");

const BUILTIN_LEVELS = Object.freeze({
  user: 0, coach: 1, captain: 2, venue_owner: 3, admin: 4, super_admin: 5,
});
const EDIT_PROFILE = "admin.users.edit_profile";
const PERMISSION_CODES = Object.freeze({
  restrict: "admin.users.restrict",
  changeRole: "admin.users.change_role",
});
const ALL_PERMISSIONS = [
  EDIT_PROFILE,
  PERMISSION_CODES.restrict,
  PERMISSION_CODES.changeRole,
];
const ROLE_DOCS = [
  { id: "custom_23", data: { key: "custom_23", afterRole: "captain" } },
  { id: "custom_34", data: { key: "custom_34", afterRole: "venue_owner" } },
  { id: "custom_45", data: { key: "custom_45", afterRole: "admin" } },
];
const indexSource = fs.readFileSync(
  path.join(__dirname, "..", "..", "functions", "index.js"),
  "utf8"
);

function sourceBetween(startMarker, endMarker) {
  const start = indexSource.indexOf(startMarker);
  const end = indexSource.indexOf(endMarker, start);
  if (start < 0 || end <= start) {
    throw new Error(`Cannot extract production source: ${startMarker}`);
  }
  return indexSource.slice(start, end);
}

const callableSource = sourceBetween(
  "exports.adminManageUser = onCall(",
  "exports.commitIdentitySettings = onCall"
);
const normalizeSource = sourceBetween(
  "function normalizeRole(role)",
  "function normalizePermissionCode"
);

function makeAccess(role = "admin", permissions = ALL_PERMISSIONS) {
  return {
    role,
    isSuperAdmin: role === "super_admin",
    hasPermission: jest.fn(code => permissions.includes(code)),
  };
}

function decide(overrides = {}) {
  return decideAdminManageUser({
    access: makeAccess(),
    callerUid: "caller",
    resolvedTargetUid: "target",
    targetRole: "user",
    roleGraph: resolveRoleGraph(ROLE_DOCS),
    permissionCodes: PERMISSION_CODES,
    ...overrides,
  });
}

class TestHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function makeCallable(options = {}) {
  const callerUid = options.callerUid || "caller";
  const targetUid = options.targetUid || "target";
  const resolvedTargetUid = options.resolvedTargetUid || targetUid;
  const targetRole = Object.prototype.hasOwnProperty.call(options, "targetRole")
    ? options.targetRole
    : "user";
  const access = options.access || makeAccess(options.callerRole || "admin");
  const records = options.records || ROLE_DOCS;
  const usersUpdate = jest.fn(async () => undefined);
  const ensureAuthUser = jest.fn(async () => undefined);
  const setRoleClaimMerged = jest.fn(async () => undefined);
  const warn = jest.fn();
  const error = jest.fn();
  const graphGet = jest.fn(async () => {
    if (options.readError) throw options.readError;
    return {
      docs: records.map(doc => ({ id: doc.id, data: () => doc.data })),
    };
  });
  const userDoc = jest.fn(() => ({ update: usersUpdate }));
  const db = {
    collection: jest.fn(name => {
      if (name === "customRoles") return { get: graphGet };
      if (name === "users") return { doc: userDoc };
      throw new Error(`Unexpected fixture collection: ${name}`);
    }),
  };
  const targetUser = options.missingTarget ? null : {
    docId: "target-doc",
    data: {
      uid: resolvedTargetUid,
      role: targetRole,
      claims: { retainedClaim: true },
    },
  };
  const findUser = jest.fn(async uid => {
    if (uid === targetUid) return targetUser;
    if (uid === callerUid) {
      return { docId: "caller-doc", data: { displayName: "Actor fixture" } };
    }
    return null;
  });
  const authGetUser = jest.fn(async () => ({ displayName: "Auth fixture" }));
  const policy = jest.fn(decideAdminManageUser);
  const loaderFactory = jest.fn(createRoleGraphLoader);

  // 注意：測試以替身取代 profile sanitizer 與顯示名 helper 的實作。
  // 此處僅替身化這些既有依賴；授權、角色圖、Callable 本體均執行正式來源。
  // profile fixture 僅使用附件既有案例的 region 欄位。
  const sanitizeProfile = jest.fn(value => (
    Object.prototype.toString.call(value) === "[object Object]"
      ? { ...value }
      : {}
  ));
  const context = vm.createContext({
    exports: {},
    onCall: (_options, handler) => handler,
    HttpsError: TestHttpsError,
    logger: { warn, error },
    require: name => {
      if (name === "firebase-functions/logger") return { warn };
      throw new Error(`Unexpected fixture require: ${name}`);
    },
    db,
    authAdmin: { getUser: authGetUser },
    FieldValue: { serverTimestamp: () => "SERVER_TIMESTAMP" },
    ROLE_LEVELS: BUILTIN_LEVELS,
    VALID_ROLES: new Set(Object.keys(BUILTIN_LEVELS)),
    ADMIN_USER_EDIT_PROFILE_PERMISSION: EDIT_PROFILE,
    ADMIN_USER_RESTRICT_PERMISSION: PERMISSION_CODES.restrict,
    ADMIN_USER_CHANGE_ROLE_PERMISSION: PERMISSION_CODES.changeRole,
    getCallerAccessContext: jest.fn(async () => access),
    findUserDocByUidOrLineUserId: findUser,
    getAuthUidFromUserDoc: () => resolvedTargetUid,
    sanitizeAdminManagedProfileUpdates: sanitizeProfile,
    hasAnyOwnKeys: value => Object.keys(value).length > 0,
    getDisplayNameFromAuthRecord: (user, fallback) => user.displayName || fallback,
    normalizeAuditText: (value, length) => String(value).slice(0, length),
    createRoleGraphLoader: loaderFactory,
    decideAdminManageUser: policy,
    ensureAuthUser,
    setRoleClaimMerged,
  });
  vm.runInContext(`${normalizeSource}\n${callableSource}`, context);
  const call = context.exports.adminManageUser;

  return {
    call,
    run: (updates = {}, auth = { uid: callerUid, token: {} }) => call({
      auth,
      data: { targetUid, ...updates },
    }),
    callerUid,
    targetUid,
    access,
    usersUpdate,
    ensureAuthUser,
    setRoleClaimMerged,
    warn,
    error,
    graphGet,
    loaderFactory,
    policy,
    findUser,
    authGetUser,
    userDoc,
  };
}

function expectNoWrites(harness) {
  expect(harness.usersUpdate).not.toHaveBeenCalled();
  expect(harness.ensureAuthUser).not.toHaveBeenCalled();
  expect(harness.setRoleClaimMerged).not.toHaveBeenCalled();
}

async function expectPolicyRejection(harness, updates, code, reasonCode) {
  await expect(harness.run(updates)).rejects.toHaveProperty("code", code);
  expectNoWrites(harness);
  expect(harness.policy).toHaveReturnedWith({
    ok: false,
    code,
    reasonCode,
  });
  expect(harness.warn).toHaveBeenCalledWith(
    "adminManageUser authorization rejected",
    expect.objectContaining({
      function: "adminManageUser",
      reasonCode,
    })
  );
  expect(harness.findUser).toHaveBeenCalledTimes(1);
  expect(harness.authGetUser).not.toHaveBeenCalled();
}

describe("decideAdminManageUser identity / target / operation matrix", () => {
  const targets = [
    "user", "coach", "captain", "venue_owner",
    "custom_23", "custom_34", "admin", "super_admin",
  ];
  // 注意：§4.2 將 coach/captain/venue_owner 合併成一欄；
  // venue_owner 對 venue_owner 依 §3.3 嚴格大於規則拒絕。
  const rows = [
    {
      caller: "user",
      restrict: [true, false, false, false, false, false, false, false],
      changeRole: [false, false, false, false, false, false, false, false],
    },
    {
      caller: "coach",
      restrict: [true, false, false, false, false, false, false, false],
      changeRole: [false, false, false, false, false, false, false, false],
    },
    {
      caller: "venue_owner",
      restrict: [true, true, true, false, true, false, false, false],
      changeRole: [false, false, false, false, false, false, false, false],
    },
    {
      caller: "custom_34",
      restrict: [true, true, true, true, true, false, false, false],
      changeRole: [false, false, false, false, false, false, false, false],
    },
    {
      caller: "admin",
      restrict: [true, true, true, true, true, true, false, false],
      changeRole: [true, true, true, true, true, true, false, false],
    },
    {
      caller: "super_admin",
      restrict: [true, true, true, true, true, true, true, false],
      changeRole: [true, true, true, true, true, true, true, true],
    },
  ];
  const operations = [
    {
      name: "限制",
      permission: PERMISSION_CODES.restrict,
      column: "restrict",
      updates: { restrictionUpdate: true },
    },
    {
      name: "解除限制",
      permission: PERMISSION_CODES.restrict,
      column: "restrict",
      updates: { restrictionUpdate: false },
    },
    {
      name: "改角色",
      permission: PERMISSION_CODES.changeRole,
      column: "changeRole",
      updates: { roleChange: { role: "coach" } },
    },
  ];

  rows.forEach(row => {
    targets.forEach((targetRole, index) => {
      operations.forEach(operation => {
        [true, false].forEach(granted => {
          test(`${row.caller} / ${targetRole} / ${operation.name} / ${
            granted ? "有個別權限" : "缺個別權限"
          }`, async () => {
            // super_admin 缺權限是人工 access fixture；
            // 正式 getCallerAccessContext 對 super_admin 固定回 true。
            const access = makeAccess(
              row.caller,
              granted ? [operation.permission] : []
            );
            const result = decide({
              access,
              targetRole,
              ...operation.updates,
            });
            const allowed = granted && row[operation.column][index];
            expect(result.ok).toBe(allowed);

            const harness = makeCallable({ access, targetRole });
            if (allowed) {
              await expect(harness.run(operation.updates)).resolves.toMatchObject({
                success: true,
              });
              expect(harness.policy).toHaveBeenCalledTimes(1);
              expect(harness.graphGet).toHaveBeenCalledTimes(1);
              expect(harness.usersUpdate).toHaveBeenCalledTimes(1);
              if (operation.column === "changeRole") {
                expect(result).toEqual({
                  ok: true,
                  nextRole: "coach",
                  nextManualRole: "coach",
                });
                expect(harness.ensureAuthUser).toHaveBeenCalledTimes(1);
                expect(harness.setRoleClaimMerged).toHaveBeenCalledTimes(1);
              } else {
                expect(harness.usersUpdate).toHaveBeenCalledWith(
                  expect.objectContaining({
                    isRestricted: operation.updates.restrictionUpdate,
                  })
                );
                expect(harness.ensureAuthUser).not.toHaveBeenCalled();
                expect(harness.setRoleClaimMerged).not.toHaveBeenCalled();
              }
            } else {
              expect(result.code).toBe("permission-denied");
              await expect(harness.run(operation.updates)).rejects.toHaveProperty(
                "code",
                "permission-denied"
              );
              expectNoWrites(harness);
              expect(harness.authGetUser).not.toHaveBeenCalled();
            }
          });
        });
      });
    });
  });
});

describe("migration of all 16 adminManageUser mirror scenarios", () => {
  const cases = [
    {
      name: "rejects unauthenticated request",
      auth: null,
      updates: { profileUpdates: { region: "X" } },
      code: "unauthenticated",
    },
    {
      name: "rejects missing targetUid",
      omitTarget: true,
      updates: { profileUpdates: { region: "X" } },
      code: "invalid-argument",
    },
    {
      name: "rejects when target user not found",
      options: { targetUid: "ghost", missingTarget: true },
      updates: { profileUpdates: { region: "X" } },
      code: "not-found",
    },
    {
      name: "non-super_admin cannot manage super_admin target",
      options: { targetRole: "super_admin" },
      updates: { profileUpdates: { region: "X" } },
      code: "permission-denied",
      message: /super admin/i,
    },
    {
      name: "super_admin can manage super_admin target",
      options: { callerRole: "super_admin", targetRole: "super_admin" },
      updates: { profileUpdates: { region: "X" } },
    },
    {
      name: "profile update without permission rejected",
      options: { access: makeAccess("admin", []) },
      updates: { profileUpdates: { region: "X" } },
      code: "permission-denied",
      message: /profile/i,
    },
    {
      name: "restriction update without permission rejected",
      options: { access: makeAccess("admin", []) },
      updates: { restrictionUpdate: true },
      code: "permission-denied",
      reason: "missing_restrict_permission",
    },
    {
      name: "cannot restrict yourself",
      options: { targetUid: "caller" },
      updates: { restrictionUpdate: true },
      code: "failed-precondition",
      reason: "self_restrict",
      message: /Cannot restrict yourself/,
    },
    {
      name: "role change without permission rejected",
      options: { access: makeAccess("admin", []) },
      updates: { roleChange: { role: "coach" } },
      code: "permission-denied",
      reason: "missing_change_role_permission",
    },
    {
      name: "coach cannot change roles (callerLevel < admin)",
      options: { access: makeAccess("coach", [PERMISSION_CODES.changeRole]) },
      updates: { roleChange: { role: "user" } },
      code: "permission-denied",
      reason: "caller_below_admin",
    },
    {
      name: "admin cannot assign admin-level role (only super_admin can)",
      updates: { roleChange: { role: "admin" } },
      code: "permission-denied",
      reason: "assign_admin_level_denied",
    },
    {
      name: "admin cannot modify user with equal level (another admin)",
      options: { targetRole: "admin" },
      updates: { roleChange: { role: "coach" } },
      code: "permission-denied",
      reason: "target_not_lower",
    },
    {
      name: "super_admin can assign admin role",
      options: { callerRole: "super_admin" },
      updates: { roleChange: { role: "admin" } },
    },
    {
      name: "admin can assign captain to user (lower level)",
      updates: { roleChange: { role: "captain" } },
    },
    {
      name: "rejects empty updates (no profile, no restriction, no role)",
      updates: {},
      code: "invalid-argument",
      message: /no supported updates/i,
    },
    {
      name: "accepts profile update only",
      updates: { profileUpdates: { region: "台北" } },
    },
  ];

  cases.forEach(scenario => {
    test(scenario.name, async () => {
      const harness = makeCallable(scenario.options);
      const data = { targetUid: harness.targetUid, ...scenario.updates };
      if (scenario.omitTarget) delete data.targetUid;
      const auth = Object.prototype.hasOwnProperty.call(scenario, "auth")
        ? scenario.auth
        : { uid: harness.callerUid, token: {} };
      const pending = harness.call({ auth, data });

      if (scenario.code) {
        const error = await pending.then(
          () => { throw new Error("Expected production Callable to reject"); },
          failure => failure
        );
        expect(error.code).toBe(scenario.code);
        expectNoWrites(harness);
        if (scenario.message) expect(error.message).toMatch(scenario.message);
        if (scenario.reason) {
          expect(harness.policy).toHaveReturnedWith({
            ok: false,
            code: scenario.code,
            reasonCode: scenario.reason,
          });
          if (scenario.code === "permission-denied") {
            expect(error.message).toBe("無法執行此管理操作");
          }
        }
      } else {
        await expect(pending).resolves.toMatchObject({ success: true });
        expect(harness.usersUpdate).toHaveBeenCalledTimes(1);
      }
    });
  });
});

describe("adminManageUser graph, identity and mixed-request boundaries", () => {
  test("profile-only does not load a role graph", async () => {
    const harness = makeCallable();
    await expect(harness.run({
      profileUpdates: { region: "台北" },
    })).resolves.toMatchObject({ success: true });
    expect(harness.loaderFactory).not.toHaveBeenCalled();
    expect(harness.graphGet).not.toHaveBeenCalled();
    expect(harness.policy).toHaveReturnedWith({ ok: true });
    expect(harness.usersUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ region: "台北" })
    );
    expect(harness.authGetUser).not.toHaveBeenCalled();
    expect(harness.ensureAuthUser).not.toHaveBeenCalled();
    expect(harness.setRoleClaimMerged).not.toHaveBeenCalled();
  });

  test("profile-only succeeds despite an invalid stored graph", async () => {
    const harness = makeCallable({
      records: [{ id: "orphan", data: { key: "orphan", afterRole: "missing" } }],
    });
    await expect(harness.run({
      profileUpdates: { region: "台北" },
    })).resolves.toMatchObject({ success: true });
    expect(harness.graphGet).not.toHaveBeenCalled();
    expect(harness.policy).toHaveReturnedWith({ ok: true });
  });

  test("profile-only is unaffected by an unavailable graph collection", async () => {
    const harness = makeCallable({ readError: new Error("unavailable fixture") });
    await expect(harness.run({
      profileUpdates: { region: "台北" },
    })).resolves.toMatchObject({ success: true });
    expect(harness.graphGet).not.toHaveBeenCalled();
    expect(harness.warn).not.toHaveBeenCalled();
  });

  test("pure profile-only decision ignores even an explicitly invalid graph", () => {
    expect(decide({
      roleGraph: { ok: false, levels: {}, invalidKeys: ["bad"], unreachable: [] },
    })).toEqual({ ok: true });
  });

  [
    { name: "restriction", operation: { restrictionUpdate: true } },
    { name: "role change", operation: { roleChange: { role: "coach" } } },
    {
      name: "both",
      operation: { restrictionUpdate: true, roleChange: { role: "coach" } },
    },
  ].forEach(({ name, operation }) => {
    test(`invalid graph rejects entire mixed profile + ${name} request`, async () => {
      const harness = makeCallable({
        records: [{ id: "bad", data: { key: "different" } }],
      });
      await expectPolicyRejection(
        harness,
        { profileUpdates: { region: "台北" }, ...operation },
        "failed-precondition",
        "role_graph_invalid"
      );
      expect(harness.graphGet).toHaveBeenCalledTimes(1);
    });

    test(`customRoles read failure during ${name} becomes unavailable without writes`, async () => {
      const harness = makeCallable({
        readError: new Error("raw private error fixture"),
      });
      await expect(harness.run(operation)).rejects.toMatchObject({
        code: "unavailable",
        message: "Role configuration temporarily unavailable",
      });
      expectNoWrites(harness);
      expect(harness.policy).not.toHaveBeenCalled();
      expect(harness.graphGet).toHaveBeenCalledTimes(1);
      expect(harness.findUser).toHaveBeenCalledTimes(1);
      expect(harness.authGetUser).not.toHaveBeenCalled();
      expect(harness.warn).not.toHaveBeenCalled();
      expect(harness.error).toHaveBeenCalledWith(
        "adminManageUser role graph unavailable",
        {
          function: "adminManageUser",
          reasonCode: "role_graph_unavailable",
          callerRole: "admin",
          targetRole: "user",
          error: "raw private error fixture",
        }
      );
    });
  });

  [undefined, null, "", "   ", 123, false].forEach((targetRole, index) => {
    test(`historical empty/non-string target role ${index} normalizes to user`, async () => {
      const access = makeAccess("user", [PERMISSION_CODES.restrict]);
      expect(decide({ access, targetRole, restrictionUpdate: true })).toEqual({
        ok: true,
      });
      const harness = makeCallable({ access, targetRole });
      await expect(harness.run({ restrictionUpdate: true })).resolves.toMatchObject({
        success: true,
        role: "user",
      });
    });
  });

  [
    {
      name: "caller",
      options: { callerRole: "unknown_role_key" },
      updates: { restrictionUpdate: true },
    },
    {
      name: "next role",
      options: {},
      updates: { roleChange: { role: "unknown_role_key" } },
    },
    {
      name: "next manual role",
      options: {},
      updates: { roleChange: { role: "coach", manualRole: "unknown_role_key" } },
    },
    {
      name: "super_admin next role",
      options: { callerRole: "super_admin" },
      updates: { roleChange: { role: "unknown_role_key" } },
    },
  ].forEach(({ name, options, updates }) => {
    test(`unknown ${name} fails closed instead of resolving to zero`, async () => {
      const harness = makeCallable(options);
      await expectPolicyRejection(
        harness,
        updates,
        "failed-precondition",
        "unknown_role"
      );
    });
  });

  test("same floating-point level 3.5 is not lower", async () => {
    const graph = resolveRoleGraph(ROLE_DOCS);
    expect(graph.levels.custom_34).toBe(3.5);
    expect(decide({
      access: makeAccess("custom_34"),
      targetRole: "custom_34",
      restrictionUpdate: false,
      roleGraph: graph,
    })).toEqual({
      ok: false,
      code: "permission-denied",
      reasonCode: "restrict_target_not_lower",
    });
    await expectPolicyRejection(
      makeCallable({ callerRole: "custom_34", targetRole: "custom_34" }),
      { restrictionUpdate: false },
      "permission-denied",
      "restrict_target_not_lower"
    );
  });

  test("resolved target UID detects self-restriction through an alias", async () => {
    const harness = makeCallable({
      targetUid: "line-alias",
      resolvedTargetUid: "caller",
    });
    await expectPolicyRejection(
      harness,
      { restrictionUpdate: true },
      "failed-precondition",
      "self_restrict"
    );
  });

  test("mixed restriction uses target role before the requested role change", async () => {
    const harness = makeCallable({
      callerRole: "super_admin",
      targetRole: "super_admin",
    });
    await expectPolicyRejection(
      harness,
      {
        profileUpdates: { region: "台北" },
        restrictionUpdate: true,
        roleChange: { role: "user" },
      },
      "permission-denied",
      "restrict_target_not_lower"
    );
  });

  test("invalid graph rejects even a built-in user target", async () => {
    const harness = makeCallable({
      records: [{ id: "cycle", data: { key: "cycle", afterRole: "cycle" } }],
    });
    await expectPolicyRejection(
      harness,
      { restrictionUpdate: true },
      "failed-precondition",
      "role_graph_invalid"
    );
  });

  test("non-super_admin caller on a super_admin target is rejected before the graph check", () => {
    const invalidGraph = resolveRoleGraph([{ id: "cycle", data: { key: "cycle", afterRole: "cycle" } }]);
    expect(decide({
      access: makeAccess("admin"),
      targetRole: "super_admin",
      roleGraph: invalidGraph,
      restrictionUpdate: true,
    })).toEqual({ ok: false, code: "permission-denied", reasonCode: "target_protected_super_admin" });
  });

  test("super_admin descendants invalidate the entire management request", async () => {
    const harness = makeCallable({
      records: [{ id: "tail", data: { key: "tail", afterRole: "super_admin" } }],
    });
    await expectPolicyRejection(
      harness,
      { roleChange: { role: "coach" } },
      "failed-precondition",
      "role_graph_invalid"
    );
  });
});

describe("adminManageUser assignment and decision contracts", () => {
  ["admin", "super_admin", "custom_45"].forEach(role => {
    test(`admin cannot assign nextRole ${role}`, async () => {
      const updates = { roleChange: { role, manualRole: "coach" } };
      expect(decide(updates)).toEqual({
        ok: false,
        code: "permission-denied",
        reasonCode: "assign_admin_level_denied",
      });
      await expectPolicyRejection(
        makeCallable(),
        updates,
        "permission-denied",
        "assign_admin_level_denied"
      );
    });

    test(`admin cannot hide nextManualRole ${role} behind nextRole coach`, async () => {
      const updates = { roleChange: { role: "coach", manualRole: role } };
      expect(decide(updates)).toEqual({
        ok: false,
        code: "permission-denied",
        reasonCode: "manual_role_admin_level_denied",
      });
      await expectPolicyRejection(
        makeCallable(),
        updates,
        "permission-denied",
        "manual_role_admin_level_denied"
      );
    });

    test(`super_admin may assign both nextRole and nextManualRole ${role}`, async () => {
      const harness = makeCallable({ callerRole: "super_admin" });
      await expect(harness.run({
        roleChange: { role, manualRole: role },
      })).resolves.toMatchObject({ success: true, role });
      expect(harness.usersUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          role,
          manualRole: role,
          isAdmin: role === "admin" || role === "super_admin",
        })
      );
      expect(harness.setRoleClaimMerged).toHaveBeenCalledWith("target", role);
    });
  });

  test("manualRole may exceed nextRole while remaining below admin", async () => {
    const harness = makeCallable();
    await expect(harness.run({
      roleChange: { role: "coach", manualRole: "venue_owner" },
    })).resolves.toMatchObject({ success: true });
    expect(harness.usersUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ role: "coach", manualRole: "venue_owner" })
    );
  });

  test("a valid custom caller above admin can manage an admin target", async () => {
    const access = makeAccess("custom_45");
    const result = decide({
      access,
      targetRole: "admin",
      roleChange: { role: "custom_34" },
    });
    expect(result).toEqual({
      ok: true,
      nextRole: "custom_34",
      nextManualRole: "custom_34",
    });
    const harness = makeCallable({ access, targetRole: "admin" });
    await expect(harness.run({
      roleChange: { role: "custom_34" },
    })).resolves.toMatchObject({ success: true, role: "custom_34" });
  });

  test("non-super custom caller above admin still cannot assign admin", async () => {
    await expectPolicyRejection(
      makeCallable({ callerRole: "custom_45" }),
      { roleChange: { role: "admin" } },
      "permission-denied",
      "assign_admin_level_denied"
    );
  });

  test("custom target levels are used when enforcing equal/higher protection", async () => {
    await expectPolicyRejection(
      makeCallable({ targetRole: "custom_45" }),
      { roleChange: { role: "coach" } },
      "permission-denied",
      "target_not_lower"
    );
  });

  test("same-level custom caller cannot change another same-level custom account", async () => {
    await expectPolicyRejection(
      makeCallable({ callerRole: "custom_45", targetRole: "custom_45" }),
      { roleChange: { role: "coach" } },
      "permission-denied",
      "target_not_lower"
    );
  });

  test("default built-in table wins over conflicting roleGraph entries", () => {
    const graph = resolveRoleGraph(ROLE_DOCS);
    graph.levels.admin = 0;
    graph.levels.user = 99;
    expect(decide({
      roleGraph: graph,
      roleChange: { role: "coach" },
    })).toEqual({ ok: true, nextRole: "coach", nextManualRole: "coach" });
  });

  test("explicit built-in table is passed by the production Callable", async () => {
    const harness = makeCallable();
    await harness.run({ roleChange: { role: "coach" } });
    expect(harness.policy).toHaveBeenCalledWith(
      expect.objectContaining({
        builtinLevels: BUILTIN_LEVELS,
        permissionCodes: PERMISSION_CODES,
      })
    );
  });

  test("access needs only role, isSuperAdmin and hasPermission", () => {
    const access = {
      role: "admin",
      isSuperAdmin: false,
      hasPermission: code => code === PERMISSION_CODES.changeRole,
    };
    expect(decide({
      access,
      roleChange: { role: "coach" },
    })).toEqual({ ok: true, nextRole: "coach", nextManualRole: "coach" });
  });

  test("missing injected permission code fails closed", () => {
    const access = {
      role: "admin",
      isSuperAdmin: false,
      hasPermission: jest.fn(() => true),
    };
    expect(decide({
      access,
      permissionCodes: {},
      restrictionUpdate: true,
    })).toEqual({
      ok: false,
      code: "permission-denied",
      reasonCode: "missing_restrict_permission",
    });
    expect(access.hasPermission).not.toHaveBeenCalled();
  });

  test("cross-realm roleChange object is accepted", async () => {
    const roleChange = vm.runInNewContext('({ role: "coach" })');
    expect(decide({ roleChange })).toEqual({
      ok: true,
      nextRole: "coach",
      nextManualRole: "coach",
    });
    await expect(makeCallable().run({ roleChange })).resolves.toMatchObject({
      success: true,
      role: "coach",
    });
  });

  [
    { name: "array", value: [] },
    { name: "string", value: "coach" },
    { name: "number", value: 1 },
    { name: "date", value: new Date(0) },
  ].forEach(({ name, value }) => {
    test(`truthy non-plain roleChange ${name} rejects without writes`, async () => {
      await expectPolicyRejection(
        makeCallable(),
        { profileUpdates: { region: "台北" }, roleChange: value },
        "invalid-argument",
        "invalid_role_change"
      );
    });
  });

  [
    { input: { role: " coach " }, role: "coach", manualRole: "coach" },
    { input: { role: "coach", manualRole: "" }, role: "coach", manualRole: "coach" },
    { input: { role: "coach", manualRole: " " }, role: "coach", manualRole: "user" },
    { input: { role: "coach", manualRole: null }, role: "coach", manualRole: "coach" },
    { input: { role: "coach", manualRole: 7 }, role: "coach", manualRole: "user" },
    { input: { role: "" }, role: "user", manualRole: "user" },
  ].forEach(({ input, role, manualRole }, index) => {
    test(`legacy role normalization and manualRole fallback ${index}`, () => {
      expect(decide({ roleChange: input })).toEqual({
        ok: true,
        nextRole: role,
        nextManualRole: manualRole,
      });
    });
  });

  test("all mutation and actor-name I/O follows the successful decision", async () => {
    const harness = makeCallable();
    await expect(harness.run({
      profileUpdates: { region: "台北" },
      restrictionUpdate: true,
      roleChange: { role: "captain" },
    })).resolves.toMatchObject({ success: true, role: "captain" });

    expect(harness.graphGet).toHaveBeenCalledTimes(1);
    expect(harness.loaderFactory).toHaveBeenCalledTimes(1);
    expect(harness.policy).toHaveBeenCalledTimes(1);
    expect(harness.findUser.mock.calls.map(args => args[0])).toEqual([
      "target", "caller",
    ]);
    const decidedAt = harness.policy.mock.invocationCallOrder[0];
    expect(harness.findUser.mock.invocationCallOrder[1]).toBeGreaterThan(decidedAt);
    [
      harness.authGetUser,
      harness.usersUpdate,
      harness.ensureAuthUser,
      harness.setRoleClaimMerged,
    ].forEach(mock => {
      expect(mock).toHaveBeenCalledTimes(1);
      expect(mock.mock.invocationCallOrder[0]).toBeGreaterThan(decidedAt);
    });
    expect(harness.ensureAuthUser.mock.invocationCallOrder[0])
      .toBeGreaterThan(harness.usersUpdate.mock.invocationCallOrder[0]);
    expect(harness.setRoleClaimMerged.mock.invocationCallOrder[0])
      .toBeGreaterThan(harness.ensureAuthUser.mock.invocationCallOrder[0]);
    expect(harness.usersUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        region: "台北",
        role: "captain",
        manualRole: "captain",
        isAdmin: false,
        isRestricted: true,
        restrictedByUid: "caller",
        restrictedByName: "Actor fixture",
        claims: { retainedClaim: true, role: "captain" },
      })
    );
  });

  test("restriction denial logs only the prescribed structured role information", async () => {
    const harness = makeCallable({ callerRole: "coach", targetRole: "captain" });
    await expectPolicyRejection(
      harness,
      { restrictionUpdate: true },
      "permission-denied",
      "restrict_target_not_lower"
    );
    expect(harness.warn).toHaveBeenCalledTimes(1);
    expect(harness.warn).toHaveBeenCalledWith(
      "adminManageUser authorization rejected",
      {
        function: "adminManageUser",
        reasonCode: "restrict_target_not_lower",
        callerRole: "coach",
        targetRole: "captain",
      }
    );
  });

  test("claims failure preserves the existing Firestore-then-Auth write order", async () => {
    const harness = makeCallable();
    const failure = new Error("claims fixture failure");
    harness.setRoleClaimMerged.mockRejectedValueOnce(failure);
    await expect(harness.run({
      roleChange: { role: "coach" },
    })).rejects.toBe(failure);
    expect(harness.usersUpdate).toHaveBeenCalledTimes(1);
    expect(harness.ensureAuthUser).toHaveBeenCalledTimes(1);
    expect(harness.setRoleClaimMerged).toHaveBeenCalledTimes(1);
  });
});

describe("adminManageUser dangling roles and level matrix", () => {
  test("dangling target role is treated as user level and logged for observation", () => {
    expect(decide({ targetRole: "ghost_role", restrictionUpdate: true })).toEqual({
      ok: true,
      observe: "target_role_dangling",
    });
    expect(decide({
      targetRole: "ghost_role",
      roleChange: { role: "coach" },
    })).toEqual({
      ok: true,
      nextRole: "coach",
      nextManualRole: "coach",
      observe: "target_role_dangling",
    });
  });

  test("dangling caller, next role and next manual role stay fail-closed", () => {
    expect(decide({
      access: makeAccess("ghost_role"),
      restrictionUpdate: true,
    })).toEqual({ ok: false, code: "failed-precondition", reasonCode: "unknown_role" });
    expect(decide({ roleChange: { role: "ghost_role" } }))
      .toEqual({ ok: false, code: "failed-precondition", reasonCode: "unknown_role" });
    expect(decide({ roleChange: { role: "coach", manualRole: "ghost_role" } }))
      .toEqual({ ok: false, code: "failed-precondition", reasonCode: "unknown_role" });
    expect(decide({
      access: makeAccess("ghost_role"),
      roleChange: { role: "coach" },
    })).toEqual({ ok: false, code: "failed-precondition", reasonCode: "unknown_role" });
  });

  test("dangling target does not relax an invalid graph", () => {
    const invalidGraph = resolveRoleGraph([{ id: "cycle", data: { key: "cycle", afterRole: "cycle" } }]);
    expect(decide({
      targetRole: "ghost_role",
      roleGraph: invalidGraph,
      restrictionUpdate: true,
    })).toEqual({ ok: false, code: "failed-precondition", reasonCode: "role_graph_invalid" });
  });

  test("dangling target can be restricted and re-roled through the callable", async () => {
    const harness = makeCallable({ targetRole: "ghost_role" });
    await harness.run({ restrictionUpdate: true });
    expect(harness.usersUpdate).toHaveBeenCalledTimes(1);
    expect(harness.warn).toHaveBeenCalledWith(
      "adminManageUser target role dangling",
      {
        function: "adminManageUser",
        reasonCode: "target_role_dangling",
        callerRole: "admin",
        targetRole: "ghost_role",
      }
    );
  });

  test.each([0, "", false])("falsy roleChange %p neither reads the graph nor writes", async value => {
    const harness = makeCallable();
    await expect(harness.run({ roleChange: value })).rejects.toMatchObject({
      message: "No supported updates requested",
    });
    expect(harness.graphGet).not.toHaveBeenCalled();
    expect(harness.policy).toHaveReturnedWith({ ok: true });
    expectNoWrites(harness);
  });

  test("custom (4,5) role level matrix for restriction", () => {
    const restrict = (callerRole, targetRole) => decide({
      access: makeAccess(callerRole),
      targetRole,
      restrictionUpdate: true,
    });
    expect(restrict("custom_45", "admin")).toEqual({ ok: true });
    expect(restrict("admin", "custom_45"))
      .toEqual({ ok: false, code: "permission-denied", reasonCode: "restrict_target_not_lower" });
    expect(restrict("custom_45", "custom_45"))
      .toEqual({ ok: false, code: "permission-denied", reasonCode: "restrict_target_not_lower" });
  });

  test("custom (4,5) role level matrix for role change", () => {
    const change = (callerRole, targetRole) => decide({
      access: makeAccess(callerRole),
      targetRole,
      roleChange: { role: "coach" },
    });
    expect(change("custom_45", "admin")).toMatchObject({ ok: true, nextRole: "coach" });
    expect(change("admin", "custom_45"))
      .toEqual({ ok: false, code: "permission-denied", reasonCode: "target_not_lower" });
    expect(change("custom_34", "user"))
      .toEqual({ ok: false, code: "permission-denied", reasonCode: "caller_below_admin" });
  });

  test("the three built-in level tables stay identical", () => {
    const match = indexSource.match(/const ROLE_LEVELS = Object\.freeze\((\{[^}]*\})\)/);
    expect(match).not.toBeNull();
    const indexLevels = vm.runInNewContext(`(${match[1]})`);
    expect({ ...AUTHZ_BUILTIN_LEVELS }).toEqual(indexLevels);
    expect({ ...HIERARCHY_BUILTIN_LEVELS }).toEqual(indexLevels);
    expect({ ...BUILTIN_LEVELS }).toEqual(indexLevels);
  });
});
