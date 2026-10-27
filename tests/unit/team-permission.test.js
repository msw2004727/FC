"use strict";

const {
  createRulesAlignedAccess,
  hasActiveGrant,
  hasEffectivePermission,
  hasRolePermission,
} = require("../../functions/team-permission");
const { createFakeFirestore } = require("./team-callable-fake-db");

const CODE = "team.manage_all";

describe("hasRolePermission（Rules hasPerm，firestore.rules:93-100）", () => {
  test.each([
    ["文件存在且 permissions 含該碼", "admin", { permissions: [CODE] }, true],
    ["文件不存在（Functions 的 getCallerAccessContext 會回退預設權限，這裡不會）", "admin", null, false],
    ["文件存在但 permissions 不含該碼", "admin", { permissions: ["team.create"] }, false],
    ["文件存在但沒有 permissions 欄位", "admin", {}, false],
    ["permissions 不是 list", "admin", { permissions: CODE }, false],
    ["role=user 時文件一律不算", "user", { permissions: [CODE] }, false],
    ["自訂角色文件含該碼", "my_custom_role", { permissions: [CODE] }, true],
  ])("%s", (_label, role, roleDoc, expected) => {
    expect(hasRolePermission(role, roleDoc, CODE)).toBe(expected);
  });
});

describe("hasActiveGrant（Rules hasUserPermissionGrantForUid，firestore.rules:65-72）", () => {
  test.each([
    ["沒有授權文件", null, false],
    ["沒有 enabled 欄位視為啟用", { permissions: [CODE] }, true],
    ["enabled:true", { permissions: [CODE], enabled: true }, true],
    ["enabled:false → 不放行", { permissions: [CODE], enabled: false }, false],
    ["enabled 不是布林 true（字串）→ 不放行", { permissions: [CODE], enabled: "true" }, false],
    ["permissions 不含該碼", { permissions: ["team.create"], enabled: true }, false],
    ["permissions 不是 list", { permissions: CODE, enabled: true }, false],
  ])("%s", (_label, grantDoc, expected) => {
    expect(hasActiveGrant(grantDoc, CODE)).toBe(expected);
  });
});

describe("hasEffectivePermission（Rules hasEffectivePerm，firestore.rules:102-104）", () => {
  test("角色層或個別授權任一為真即可", () => {
    expect(hasEffectivePermission({ role: "admin", roleDoc: { permissions: [CODE] }, grantDoc: null }, CODE)).toBe(true);
    expect(hasEffectivePermission({ role: "user", roleDoc: null, grantDoc: { permissions: [CODE] } }, CODE)).toBe(true);
    expect(hasEffectivePermission({ role: "admin", roleDoc: null, grantDoc: null }, CODE)).toBe(false);
    expect(hasEffectivePermission({ role: "user", roleDoc: { permissions: [CODE] }, grantDoc: { permissions: [CODE], enabled: false } }, CODE)).toBe(false);
  });
});

describe("createRulesAlignedAccess", () => {
  // 模擬 getCallerAccessContext 的 access：hasPermission 對任何碼都回 true（等同「文件不存在時回退預設權限」）
  const alwaysTrue = (role, extra = {}) => ({ role, isSuperAdmin: role === "super_admin", hasPermission: () => true, ...extra });
  const build = async (docs, access, uid = "U-caller") => createRulesAlignedAccess({
    db: createFakeFirestore(docs).db,
    access,
    uid,
  });

  test("rolePermissions 文件不存在 → 不放行（即使 access.hasPermission 回 true）", async () => {
    const aligned = await build({}, alwaysTrue("admin"));
    expect(aligned.hasPermission(CODE)).toBe(false);
    expect(aligned.role).toBe("admin");
    expect(aligned.isSuperAdmin).toBe(false);
  });

  test("rolePermissions 文件存在且含該碼 → 放行；不含 → 不放行", async () => {
    const aligned = await build({ "rolePermissions/admin": { permissions: [CODE] } }, alwaysTrue("admin"));
    expect(aligned.hasPermission(CODE)).toBe(true);
    expect(aligned.hasPermission("team.create")).toBe(false);
  });

  test("個別授權 enabled:false → 不放行；沒有 enabled 欄位 → 放行", async () => {
    const off = await build({ "userPermissionGrants/U-caller": { permissions: [CODE], enabled: false } }, alwaysTrue("user"));
    expect(off.hasPermission(CODE)).toBe(false);
    const on = await build({ "userPermissionGrants/U-caller": { permissions: [CODE] } }, alwaysTrue("user"));
    expect(on.hasPermission(CODE)).toBe(true);
  });

  test("授權文件以呼叫者 uid 為鍵：別人的授權不算", async () => {
    const aligned = await build({ "userPermissionGrants/U-other": { permissions: [CODE] } }, alwaysTrue("user"));
    expect(aligned.hasPermission(CODE)).toBe(false);
  });

  test("role=user 時 rolePermissions/user 不算", async () => {
    const aligned = await build({ "rolePermissions/user": { permissions: [CODE] } }, alwaysTrue("user"));
    expect(aligned.hasPermission(CODE)).toBe(false);
  });

  test("super_admin 一律放行（對應 Rules isSuperAdmin()），不需要任何文件", async () => {
    const aligned = await build({}, alwaysTrue("super_admin"));
    expect(aligned.isSuperAdmin).toBe(true);
    expect(aligned.hasPermission(CODE)).toBe(true);
  });

  test("角色名稱含 / 之類不合法文件 id → 視為沒有角色層權限，不丟例外", async () => {
    const aligned = await build({}, alwaysTrue("bad/role"));
    expect(aligned.hasPermission(CODE)).toBe(false);
  });

  test("不修改傳入的 access（getCallerAccessContext 的回傳物件維持原樣）", async () => {
    const access = alwaysTrue("admin");
    await build({}, access);
    expect(access.hasPermission(CODE)).toBe(true);
  });
});
