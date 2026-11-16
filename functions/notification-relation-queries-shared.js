"use strict";

/**
 * 通知發送授權強化（第 2 批）：關係查詢共用小工具。
 * 不 require("./index")，不讀 request，不記 log。讀取失敗一律往外丟，由決策層轉成 deny。
 */

const { isUserCreatedTeam, normalizeId } = require("./team-membership-core");
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

// 嚴格版（R8 主辦隊仍用）：文件 id 命中才算；id 欄位與文件 id 不一致視為查無；不退回 where("id","==")。
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

// 排除自建後要能同時看見「兩筆非自建」（多於兩筆仍可能被截掉）。本卡硬性 limit(3)，不沿用 resolveTeamSnapshot 的 limit(2)。
const LEGACY_ID_QUERY_LIMIT = 3;

// T-062 C2（顧問 §3.180②）：取代「文件 id 命中但 id 欄位不同即查無、且不退回 where」。
// 舊格式俱樂部兩種鍵都會查無。鍵先過 normalizeId，不合格式當查無、不查、不丟錯。
// 文件 id 命中即用；查無才 where("id")，排除自建（createdVia === "user_capability"）後恰好一筆才用。
// 零筆或兩筆以上回 null，不丟 TEAM_ID_AMBIGUOUS（那會變成 query_error deny）。只改找到哪份文件。
async function readTeamById(db, teamId) {
  const id = normalizeId(teamId);
  if (!id) return null;
  const snap = await db.collection("teams").doc(id).get();
  if (snap && snap.exists) return { docId: snap.id || id, data: snap.data() || {} };
  const found = await db.collection("teams").where("id", "==", id).limit(LEGACY_ID_QUERY_LIMIT).get();
  const docs = Array.isArray(found?.docs) ? found.docs : [];
  const candidates = docs.filter((doc) => !isUserCreatedTeam(typeof doc?.data === "function" ? (doc.data() || {}) : {}));
  if (candidates.length !== 1) return null;
  const doc = candidates[0];
  return { docId: doc.id, data: (typeof doc.data === "function" ? doc.data() : {}) || {} };
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
  readTeamById,
  createAccessReader,
  userDataInTeam,
};
