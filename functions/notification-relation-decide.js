"use strict";

/**
 * 通知發送授權強化（第 2 批）：關係決策（事實進來，結果出去；本檔不讀 Firestore、不記 log、不讀 request）。
 *
 * decideRelation 回 { outcome, relationId, gate, reason, flags }：
 *   outcome  allow | missing_key | deny | gap | record
 *   gate     null | relation_missing_key | relation_denied | relation_permission_gap（allow 為 null）
 *   reason   內部短碼，不含使用者資料、不給客戶端
 *   flags    只放布林或固定字串（hasEventId 這類只記「有沒有鍵」，不放鍵的值）
 *
 * 模式只來自 modeOf(relationId)；沒有任何可由客戶端傳入的 mode 參數，payload 的 mode 也不會被讀。
 * 失敗不准放行：查詢丟錯、查無、查詢函式缺失一律 deny。
 */

const { classifyRelation } = require("./notification-relation-table");
const { relationMode } = require("./notification-relation-enforcement");

const GATE_MISSING_KEY = "relation_missing_key";
const GATE_DENIED = "relation_denied";
const GATE_PERMISSION_GAP = "relation_permission_gap";

const KEY_NAMES = Object.freeze(["eventId", "teamId", "tournamentId", "applicantUid", "assignmentRole"]);
const ASSIGNMENT_ROLES = new Set(["captain", "leader", "coach", "member"]);
const ASSIGNMENT_SOURCE_RE = /^team_role_assignment:(captain|leader|coach|member)$/;

// 錯誤代碼轉成固定格式的短字串（小寫英文與底線、最長 24）；不是字串或轉出來是空的就是 unknown。不含錯誤訊息。
function errCodeOf(error) {
  const raw = typeof error?.code === "string" ? error.code : "";
  const code = raw.toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24);
  return code || "unknown";
}

function outcomeOf(outcome, relationId, reason, flags = {}) {
  const gates = {
    allow: null,
    missing_key: GATE_MISSING_KEY,
    record: GATE_MISSING_KEY,
    deny: GATE_DENIED,
    gap: GATE_PERMISSION_GAP,
  };
  return { outcome, relationId, gate: gates[outcome], reason, flags };
}

// 關聯鍵只取已知名稱的自身字串屬性（trim 後非空）；原型上的值與其他欄位一律忽略。
function pickKeys(keys) {
  const picked = {};
  if (!keys || typeof keys !== "object") return picked;
  KEY_NAMES.forEach((name) => {
    if (!Object.prototype.hasOwnProperty.call(keys, name)) return;
    const value = keys[name];
    if (typeof value === "string" && value.trim() !== "") picked[name] = value.trim();
  });
  return picked;
}

function assignmentRoleOf(source, keys) {
  const match = ASSIGNMENT_SOURCE_RE.exec(source);
  if (match) return match[1];
  if (source === "template:role_upgrade") {
    return ASSIGNMENT_ROLES.has(keys.assignmentRole) ? keys.assignmentRole : "";
  }
  return "";
}

function keyFlags(rel, keys, assignmentRole) {
  const flags = {};
  rel.keys.forEach((name) => {
    const present = name === "assignmentRole" ? assignmentRole !== "" : !!keys[name];
    flags[`has${name.charAt(0).toUpperCase()}${name.slice(1)}`] = present;
  });
  return flags;
}

function missingKeyNames(rel, keys, assignmentRole) {
  return rel.keys.filter((name) => (name === "assignmentRole" ? assignmentRole === "" : !keys[name]));
}

function queryFn(queries, name) {
  if (!queries || typeof name !== "string") return null;
  if (!Object.prototype.hasOwnProperty.call(queries, name)) return null;
  return typeof queries[name] === "function" ? queries[name] : null;
}

// R6：權限答案以 Rules 對齊為準；對齊不成立但舊路徑成立＝差距。
async function decideBroadcastPermission(rel, ctx, queries, mode) {
  const aligned = queryFn(queries, rel.callerCheck);
  if (!aligned) return outcomeOf("deny", rel.id, "query_missing");
  if (await aligned(ctx) === true) return outcomeOf("allow", rel.id, "aligned");
  if (rel.roleUpgradeWithoutTeam) {
    // 無 teamId 且 admin.users.change_role 不成立：不是差距，也不是 R5。常數改 enforce 才拒。
    return mode === "enforce"
      ? outcomeOf("deny", rel.id, "role_upgrade_no_permission")
      : outcomeOf("record", rel.id, "role_upgrade_no_permission");
  }
  const gapFn = queryFn(queries, "callerBroadcastPermissionGap");
  if (!gapFn) return outcomeOf("deny", rel.id, "query_missing");
  const gap = await gapFn(ctx) === true;
  if (mode === "enforce") return outcomeOf("deny", rel.id, gap ? "permission_gap" : "no_permission");
  return gap
    ? outcomeOf("gap", rel.id, "permission_gap")
    : outcomeOf("allow", rel.id, "not_aligned_log_mode");
}

async function decideRelation({ source, keys, ctx, queries, classify = classifyRelation, modeOf = relationMode } = {}) {
  let relationId = null;
  try {
    const safeKeys = pickKeys(keys);
    const rel = classify(source, safeKeys);
    // 未知 source：維持第 1 批「只記錄、不擋」，不在這裡加 log gate。
    if (!rel) return outcomeOf("allow", null, "unknown_source");
    relationId = rel.id;
    const mode = modeOf(rel.id) === "enforce" ? "enforce" : "log";
    const assignmentRole = rel.id === "R5" ? assignmentRoleOf(source, safeKeys) : "";
    const ctx2 = { ...(ctx && typeof ctx === "object" ? ctx : {}), source, keys: safeKeys, assignmentRole };

    if (rel.id === "unclassified") return outcomeOf("record", rel.id, "unclassified");
    if (rel.id === "client_unknown") {
      // 收件者就是本人時不用記；不是本人（或查不出來）只記錄、放行。
      const selfFn = queryFn(queries, "recipientIsCaller");
      let isSelf = false;
      if (selfFn) {
        try {
          isSelf = await selfFn(ctx2) === true;
        } catch (_) {
          isSelf = false;
        }
      }
      return isSelf
        ? outcomeOf("allow", rel.id, "self", { clientUnknown: true })
        : outcomeOf("record", rel.id, "client_unknown", { clientUnknown: true });
    }
    if (rel.id === "R2" || rel.id === "R9") {
      // R2 交給 2c、R9 教育 source：本波只記錄；常數改 enforce 後才拒。
      return mode === "enforce"
        ? outcomeOf("deny", rel.id, "enforced_record_only")
        : outcomeOf("record", rel.id, "record_only");
    }
    if (rel.id === "R6") return await decideBroadcastPermission(rel, ctx2, queries, mode);

    // R5 member 子項：固定 record，不查詢、不拒（成員查詢的 id 是否同值尚未核實）。
    if (rel.id === "R5" && assignmentRole === "member") {
      return outcomeOf("record", rel.id, "member_unverified", {
        memberQuery: "unverified",
        hasTeamId: !!safeKeys.teamId,
      });
    }

    const flags = keyFlags(rel, safeKeys, assignmentRole);
    if (missingKeyNames(rel, safeKeys, assignmentRole).length > 0) {
      return mode === "enforce"
        ? outcomeOf("deny", rel.id, "missing_key", flags)
        : outcomeOf("missing_key", rel.id, "missing_key", flags);
    }

    const callerFn = queryFn(queries, rel.callerCheck);
    const recipientFn = queryFn(queries, rel.recipientQuery);
    if (!callerFn || !recipientFn) return outcomeOf("deny", rel.id, "query_missing", flags);
    if (await callerFn(ctx2) !== true) return outcomeOf("deny", rel.id, "caller_not_allowed", flags);
    if (await recipientFn(ctx2) === true) return outcomeOf("allow", rel.id, "ok", flags);

    // R5 captain／leader／coach：鍵齊但收件者不在對應欄位。log 只記錄，enforce 才拒。
    if (rel.id === "R5" && mode !== "enforce") {
      return outcomeOf("record", rel.id, "field_mismatch", { ...flags, fieldMismatch: true });
    }
    return outcomeOf("deny", rel.id, "recipient_not_in_relation", flags);
  } catch (error) {
    // 查詢丟錯（含讀權限文件失敗）一律拒絕，失敗不准改放行。errCode 只留固定格式的短代碼，讓 log 分得出暫時性錯誤。
    return outcomeOf("deny", relationId, "query_error", { errCode: errCodeOf(error) });
  }
}

module.exports = { decideRelation };
