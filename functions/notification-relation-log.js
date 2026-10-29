"use strict";

/**
 * 通知發送授權強化（第 2 批）：關係檢查的鍵整理、log 與組裝（無查詢、無 Firestore；決策函式與查詢由呼叫端注入）。
 * log 沿用 `[notificationGuards] gate triggered` 的形狀：gate／kind／caller（遮罩）／source（格式合格才輸出）／
 * relation（代號）／reason／flags（只有布林或固定短字串）。不含 title、body、完整 uid、關聯鍵的值。
 * 節流：每（閘, 種類, 類別, source, 分鐘, 呼叫者）最多一筆，避免批次通知時每封都寫 log。
 */

const { maskUid, logSafeSource } = require("./notification-fields");

const LOG_MESSAGE = "[notificationGuards] gate triggered";
const KEY_NAMES = Object.freeze(["eventId", "teamId", "tournamentId", "applicantUid", "assignmentRole"]);
const KEY_MAX_LENGTH = 128;
const FLAG_STRING_RE = /^[a-z_]{1,24}$/;
const LOGGED_KEYS_MAX = 2000;

// 關聯鍵只取已知名稱的自身字串屬性（trim、截斷）；只當資料，不影響強制模式。
function relationKeysFromData(data) {
  const keys = {};
  if (!data || typeof data !== "object") return keys;
  KEY_NAMES.forEach((name) => {
    if (!Object.prototype.hasOwnProperty.call(data, name)) return;
    const value = data[name];
    if (typeof value === "string" && value.trim() !== "") keys[name] = value.trim().slice(0, KEY_MAX_LENGTH);
  });
  return keys;
}

// flags 只留布林與固定短字串；其餘一律丟棄，避免把鍵的值寫進 log。
function safeFlags(flags) {
  const out = {};
  if (!flags || typeof flags !== "object") return out;
  Object.keys(flags).forEach((name) => {
    const value = flags[name];
    if (typeof value === "boolean" || (typeof value === "string" && FLAG_STRING_RE.test(value))) out[name] = value;
  });
  return out;
}

function createRelationLogger({ logger, now }) {
  const loggedKeys = new Set();
  // 決策沒有 gate（allow）時不記；回傳是否實際寫出一筆
  return function logRelationOutcome(decision, { kind, callerUid, source }) {
    if (!decision || !decision.gate) return false;
    const key = [decision.gate, kind, decision.relationId, logSafeSource(source), Math.floor(now() / 60000), callerUid].join("|");
    if (loggedKeys.has(key)) return false;
    if (loggedKeys.size >= LOGGED_KEYS_MAX) loggedKeys.clear();
    loggedKeys.add(key);
    logger.warn(LOG_MESSAGE, {
      gate: decision.gate,
      kind,
      caller: maskUid(callerUid),
      source: logSafeSource(source),
      relation: decision.relationId ?? null,
      reason: decision.reason ?? null,
      ...safeFlags(decision.flags),
    });
    return true;
  };
}

// 站內信廣播沒有單一收件者：用 targetRoles 組出代表性的收件者角色（含 admin／super_admin 以外的角色就取那一個），
// 讓 R7 的「收件者 role 是 admin」在廣播時等於「targetRoles 全是 admin／super_admin」。其他類別查不到本人，照常不通過。
// 只在「純依角色廣播」時合成：帶 targetTeamId（實際送達的是隊員）或 targetType 為 all 時不合成，R7 整筆 deny。
function broadcastRecipientFound(extra) {
  if (extra?.targetTeamId || extra?.targetType === "all") return null;
  const roles = Array.isArray(extra?.targetRoles) ? extra.targetRoles : [];
  if (roles.length === 0) return null;
  const nonAdmin = roles.find((role) => role !== "admin" && role !== "super_admin");
  return { docId: "", data: { role: nonAdmin === undefined ? roles[0] : String(nonAdmin) } };
}

// check 先決策、再 log，回傳決策；deny 要不要丟錯由呼叫端決定。決策不讀 request.data 裡的 mode／pool。
function createRelationChecker({ decide, queries, log }) {
  return {
    async check({ kind, callerUid, callerRole, source, data, recipientUid, recipientFound = null, extra = {} }) {
      const found = recipientFound || (recipientUid ? null : broadcastRecipientFound(extra));
      const decision = await decide({
        source,
        keys: relationKeysFromData(data),
        ctx: { callerUid, callerRole, recipientUid, recipientFound: found, extra },
        queries,
      });
      log(decision, { kind, callerUid, source });
      return decision;
    },
  };
}

module.exports = { relationKeysFromData, createRelationLogger, createRelationChecker };
