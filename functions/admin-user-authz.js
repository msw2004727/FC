"use strict";

const BUILTIN_LEVELS = Object.freeze({
  user: 0,
  coach: 1,
  captain: 2,
  venue_owner: 3,
  admin: 4,
  super_admin: 5,
});
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function normalizeRole(value) {
  if (typeof value !== "string") return "user";
  return value.trim() || "user";
}

function reject(code, reasonCode) {
  return { ok: false, code, reasonCode };
}

function decideAdminManageUser({
  access,
  callerUid,
  resolvedTargetUid,
  targetRole,
  roleGraph,
  restrictionUpdate,
  roleChange,
  builtinLevels = BUILTIN_LEVELS,
  permissionCodes = {},
}) {
  const hasRestriction = restrictionUpdate != null;
  const hasRoleChange = Boolean(roleChange);
  if (!hasRestriction && !hasRoleChange) return { ok: true };

  const hasPermission = code => typeof code === "string"
    && code.trim().length > 0
    && typeof access?.hasPermission === "function"
    && access.hasPermission(code);

  if (hasRestriction && !hasPermission(permissionCodes.restrict)) {
    return reject("permission-denied", "missing_restrict_permission");
  }
  if (hasRestriction && resolvedTargetUid === callerUid) {
    return reject("failed-precondition", "self_restrict");
  }
  if (hasRoleChange
    && Object.prototype.toString.call(roleChange) !== "[object Object]") {
    return reject("invalid-argument", "invalid_role_change");
  }
  if (hasRoleChange && !hasPermission(permissionCodes.changeRole)) {
    return reject("permission-denied", "missing_change_role_permission");
  }

  const callerKey = normalizeRole(access?.role);
  const targetKey = normalizeRole(targetRole);
  const isSuperAdmin = access?.isSuperAdmin === true;

  if (!isSuperAdmin && targetKey === "super_admin") {
    return reject("permission-denied", "target_protected_super_admin");
  }
  if (!roleGraph || roleGraph.ok !== true) {
    return reject("failed-precondition", "role_graph_invalid");
  }

  const levelOf = key => {
    const table = builtinLevels && hasOwn(builtinLevels, key)
      ? builtinLevels
      : roleGraph.levels;
    if (!table || !hasOwn(table, key) || !Number.isFinite(table[key])) {
      return "unknown";
    }
    return table[key];
  };

  // 目標角色已不在 customRoles（懸空）時視為 user 層級，只放寬目標；caller／next 的 unknown 仍 fail-closed。
  const targetDangling = !(builtinLevels && hasOwn(builtinLevels, targetKey))
    && !(roleGraph.levels && hasOwn(roleGraph.levels, targetKey));
  const callerLevel = levelOf(callerKey);
  const targetLevel = targetDangling ? 0 : levelOf(targetKey);
  const observation = targetDangling ? { observe: "target_role_dangling" } : {};
  const nextRole = hasRoleChange ? normalizeRole(roleChange.role) : undefined;
  const nextManualRole = hasRoleChange
    ? normalizeRole(roleChange.manualRole || nextRole)
    : undefined;
  const requiredLevels = [callerLevel, targetLevel];

  if (hasRoleChange) {
    requiredLevels.push(levelOf(nextRole), levelOf(nextManualRole), levelOf("admin"));
  }
  if (requiredLevels.includes("unknown")) {
    return reject("failed-precondition", "unknown_role");
  }

  if (hasRestriction && targetKey !== "user" && !(callerLevel > targetLevel)) {
    return reject("permission-denied", "restrict_target_not_lower");
  }

  if (hasRoleChange) {
    const adminLevel = levelOf("admin");
    if (callerLevel < adminLevel) {
      return reject("permission-denied", "caller_below_admin");
    }
    if (!isSuperAdmin && levelOf(nextRole) >= adminLevel) {
      return reject("permission-denied", "assign_admin_level_denied");
    }
    if (!isSuperAdmin && targetLevel >= callerLevel) {
      return reject("permission-denied", "target_not_lower");
    }
    if (!isSuperAdmin && levelOf(nextManualRole) >= adminLevel) {
      return reject("permission-denied", "manual_role_admin_level_denied");
    }
    return { ok: true, nextRole, nextManualRole, ...observation };
  }

  return { ok: true, ...observation };
}

module.exports = { decideAdminManageUser, BUILTIN_LEVELS };
