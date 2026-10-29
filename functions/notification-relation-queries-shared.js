"use strict";

/**
 * 通知發送授權強化（第 2 批）：關係查詢共用小工具。
 * 不 require("./index")，不讀 request，不記 log。讀取失敗一律往外丟，由決策層轉成 deny。
 */

const { normalizeId } = require("./team-membership-core");
const { createRulesAlignedAccess } = require("./team-permission");

function str(value) {
  return typeof value === "string" ? value.trim() : "";
}

// 以 ctx 物件為鍵快取一次 async 結果（同一次決策內不重複讀同一份文件）。
// 失敗的 Promise 也一併快取：同一次決策內後續呼叫得到同樣的失敗，不會因重試而變成放行。
function memoByCtx(fn) {
  const cache = new WeakMap();
  return (ctx) => {
    if (!ctx || typeof ctx !== "object") return fn(ctx);
    if (!cache.has(ctx)) cache.set(ctx, fn(ctx));
    return cache.get(ctx);
  };
}

// 收件者身分候選。LINE 路徑入列前已由伺服器取得 found（{ docId, data }），以它為準；
// 站內信沒有 found，才用請求裡的 recipientUid。
function recipientIdentities(ctx) {
  const found = ctx?.recipientFound;
  const raw = found && typeof found === "object"
    ? [found.data?.uid, found.docId]
    : [ctx?.recipientUid];
  return [...new Set(raw.map(str).filter(Boolean))];
}

// 隊伍一律以「文件 id」為準（resolveTeamSnapshot 口徑）：文件 id 命中才算；
// 文件有 id 欄位且與文件 id 不一致視為查無；不退回 where("id","==")。
async function readTeamByDocId(db, teamId) {
  const id = normalizeId(teamId);
  if (!id) return null;
  const snap = await db.collection("teams").doc(id).get();
  if (!snap || !snap.exists) return null;
  const data = snap.data() || {};
  const fieldId = data.id;
  const docId = snap.id || id;
  if (fieldId !== undefined && fieldId !== null && fieldId !== "" && String(fieldId) !== docId) return null;
  return { docId, data };
}

// Rules 對齊的權限讀取（createRulesAlignedAccess）：只看 rolePermissions／userPermissionGrants 兩份文件，
// 不回退預設權限；super_admin 放行。
function createAccessReader(db) {
  return memoByCtx((ctx) => createRulesAlignedAccess({
    db,
    access: { role: str(ctx?.callerRole), isSuperAdmin: str(ctx?.callerRole) === "super_admin" },
    uid: str(ctx?.callerUid),
  }));
}

// 使用者文件裡 teamId／teamIds 是否含該隊伍文件 id。
function userDataInTeam(userData, teamDocId) {
  if (!userData || typeof userData !== "object" || !teamDocId) return false;
  if (str(userData.teamId) === teamDocId) return true;
  return Array.isArray(userData.teamIds) && userData.teamIds.some((item) => str(item) === teamDocId);
}

module.exports = {
  str,
  memoByCtx,
  recipientIdentities,
  readTeamByDocId,
  createAccessReader,
  userDataInTeam,
};
