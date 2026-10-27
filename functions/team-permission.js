"use strict";

/**
 * removeTeamMember／deleteTeam 專用的「與 Rules 一致」的權限判斷（T-027 7b(A) 審查 P3-7，部署前必須）。
 *
 * 為什麼不直接用 getCallerAccessContext(request).hasPermission：
 *  Functions 的 getRolePermissionsFromFirestore 在 rolePermissions/{role} 文件不存在（或沒有 permissions 欄位）時
 *  會回退成 getDefaultRolePermissions（例如 admin 因此帶 team.manage_all）；Rules 的 hasPerm 則要求文件存在且
 *  permissions 是 list。這兩個 Callable 刻意不靠預設權限放行，所以自己讀文件，語意逐條對齊 Rules：
 *    hasPerm(perm)                  firestore.rules:93-100   role != 'user' && 文件存在 && permissions 是 list && perm in permissions
 *    hasUserPermissionGrantForUid   firestore.rules:65-72    uid != '' && 文件存在 && permissions 是 list && (無 enabled 欄位 || enabled == true) && perm in permissions
 *    hasEffectivePerm(perm)         firestore.rules:102-104   hasPerm || hasUserPermissionGrant
 *  super_admin 另由呼叫端的 access.isSuperAdmin 處理（對應 Rules isSuperAdmin()，firestore.rules:59-62）。
 * 不修改 getCallerAccessContext（其他 Callable 仍依賴它的預設權限行為）。
 */

const { normalizeId } = require("./team-membership-core");

// Rules hasPerm：user 角色永遠沒有角色層權限（只能靠個別授權）。
function hasRolePermission(role, roleDoc, code) {
  return role !== "user"
    && !!roleDoc
    && Array.isArray(roleDoc.permissions)
    && roleDoc.permissions.includes(code);
}

// Rules hasUserPermissionGrantForUid：沒有 enabled 欄位視為啟用，enabled 必須嚴格等於 true。
function hasActiveGrant(grantDoc, code) {
  return !!grantDoc
    && Array.isArray(grantDoc.permissions)
    && (!("enabled" in grantDoc) || grantDoc.enabled === true)
    && grantDoc.permissions.includes(code);
}

// Rules hasEffectivePerm。sources = { role, roleDoc: 文件資料或 null, grantDoc: 文件資料或 null }。
function hasEffectivePermission(sources, code) {
  return hasRolePermission(sources.role, sources.roleDoc, code) || hasActiveGrant(sources.grantDoc, code);
}

// 讀 rolePermissions/{role} 與 userPermissionGrants/{uid}，回傳形狀同 getCallerAccessContext 的 access
// （role、isSuperAdmin、hasPermission），但 hasPermission 只看這兩份文件，不回退預設權限。
async function createRulesAlignedAccess({ db, access, uid }) {
  const role = access?.role;
  const roleDocId = normalizeId(role);
  const grantDocId = normalizeId(uid);
  const [roleSnap, grantSnap] = await Promise.all([
    roleDocId && role !== "user" ? db.collection("rolePermissions").doc(roleDocId).get() : null,
    grantDocId ? db.collection("userPermissionGrants").doc(grantDocId).get() : null,
  ]);
  const sources = {
    role,
    roleDoc: roleSnap?.exists ? roleSnap.data() || {} : null,
    grantDoc: grantSnap?.exists ? grantSnap.data() || {} : null,
  };
  const isSuperAdmin = access?.isSuperAdmin === true;
  return {
    role,
    isSuperAdmin,
    hasPermission: (code) => isSuperAdmin || hasEffectivePermission(sources, code),
  };
}

module.exports = {
  createRulesAlignedAccess,
  hasActiveGrant,
  hasEffectivePermission,
  hasRolePermission,
};
