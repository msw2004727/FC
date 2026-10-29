"use strict";

/**
 * 通知發送授權強化（第 2 批）：關係查詢（Firestore 讀法）。
 * createRelationQueries({ db, helpers }) 回傳的鍵就是 notification-relation-table.js 用到的函式名。
 * 每個函式 async (ctx) => boolean：true＝條件成立；false＝查無或不成立；讀取失敗直接丟出（不吞），
 * 由 notification-relation-decide.js 轉成 deny。
 * 不 require("./index")，不讀 request，不記 log；helpers 由 index.js 注入。
 *
 * ctx = { source, keys, callerUid, callerRole, recipientUid, recipientFound, extra, assignmentRole }
 *   recipientFound：LINE 入列前已取得的 { docId, data }；站內信為 null。
 * helpers = { isTeamStaffForData, isTournamentTeamOfficerForData, isEventDelegateForUid, isActiveRegistration,
 *             getEventDocByPublicId, canOperatePrivateEventForAccess, legacyHasPermission }
 *   legacyHasPermission：async (role, code) => boolean，舊路徑（含預設回退）的答案。
 */

const { normalizeId } = require("./team-membership-core");
const { str, createAccessReader } = require("./notification-relation-queries-shared");
const { createEventQueries } = require("./notification-relation-queries-event");
const { createTeamQueries } = require("./notification-relation-queries-team");
const { createTournamentQueries } = require("./notification-relation-queries-tournament");

const MESSAGE_BROADCAST_CODES = Object.freeze(["admin.messages.compose", "admin.messages.entry"]);
const ROLE_UPGRADE_CODES = Object.freeze(["admin.users.change_role"]);

// R6 看哪些權限碼：target:* 看訊息撰寫／入口；template:role_upgrade 看 admin.users.change_role。
function broadcastPermissionCodes(source) {
  if (typeof source !== "string") return [];
  if (source === "template:role_upgrade") return ROLE_UPGRADE_CODES;
  if (/^target:[a-z_]+$/.test(source)) return MESSAGE_BROADCAST_CODES;
  return [];
}

function createRelationQueries({ db, helpers }) {
  const readAccess = createAccessReader(db);
  const deps = { db, helpers, readAccess };

  async function alignedHasBroadcastPermission(ctx) {
    const codes = broadcastPermissionCodes(ctx?.source);
    if (codes.length === 0 || !str(ctx?.callerUid)) return false;
    const access = await readAccess(ctx);
    return codes.some((code) => access.hasPermission(code));
  }

  return {
    ...createEventQueries(deps),
    ...createTeamQueries(deps),
    ...createTournamentQueries(deps),

    async callerIsAuthenticated(ctx) {
      return str(ctx?.callerUid) !== "";
    },

    // R0：不比對佇列裡的 LINE id；請求的 uid、found.data.uid 或 found.docId 任一等於呼叫者才通過。
    async recipientIsCaller(ctx) {
      const caller = str(ctx?.callerUid);
      if (!caller) return false;
      const found = ctx?.recipientFound;
      return [ctx?.recipientUid, found?.data?.uid, found?.docId].some((value) => str(value) === caller);
    },

    // R7：收件者 role 是 admin／super_admin。LINE 用已取得的 found.data.role；站內信讀 users/{recipientUid}。
    async recipientRoleIsAdmin(ctx) {
      let role;
      if (ctx?.recipientFound && typeof ctx.recipientFound === "object") {
        role = ctx.recipientFound.data?.role;
      } else {
        const uid = normalizeId(ctx?.recipientUid);
        if (!uid) return false;
        const snap = await db.collection("users").doc(uid).get();
        if (!snap || !snap.exists) return false;
        role = (snap.data() || {}).role;
      }
      return role === "admin" || role === "super_admin";
    },

    // R6：Rules 對齊的權限答案（不回退預設權限；super_admin 放行）。
    callerHasBroadcastPermission: alignedHasBroadcastPermission,

    // R6 差距：舊路徑（getRolePermissionsFromFirestore，含預設回退）會過、Rules 對齊不會過。
    // 文件已有 permissions 陣列但不含該碼時舊路徑也不過，不算差距。
    async callerBroadcastPermissionGap(ctx) {
      const codes = broadcastPermissionCodes(ctx?.source);
      if (codes.length === 0 || !str(ctx?.callerUid)) return false;
      if (await alignedHasBroadcastPermission(ctx)) return false;
      for (const code of codes) {
        if (await helpers.legacyHasPermission(str(ctx?.callerRole), code) === true) return true;
      }
      return false;
    },
  };
}

module.exports = { createRelationQueries };
