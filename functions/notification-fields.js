"use strict";

/**
 * 通知發送授權強化（第 1 批）：純函式（無 I/O）。
 * 內容：文字清理、source 格式與已知清單、站內信顯示欄位由伺服器決定。
 */

// source 只允許的字元（現行前端產生的 source 皆符合）
const SOURCE_FORMAT_RE = /^[A-Za-z0-9:_\-./]+$/;
// C0 控制字元（保留 \t=0x09、\n=0x0A）
const CONTROL_CHARS_RE = /[\x00-\x08\x0B-\x1F]/g;

const KNOWN_TEMPLATE_KEYS = Object.freeze([
  "welcome",
  "signup_success",
  "cancel_signup",
  "waitlist_promoted",
  "waitlist_demoted",
  "event_cancelled",
  "role_upgrade",
  "role_application",
  "event_changed",
  "event_relisted",
  "tournament_friendly_host_opened",
  "tournament_friendly_team_apply_host",
  "tournament_friendly_team_approved_applicant",
  "tournament_friendly_team_rejected_applicant",
  "tournament_friendly_team_approved_broadcast",
]);

const KNOWN_SOURCE_EXACT = new Set([
  "client:line-push",
  "client:unknown",
  "team_join_request",
  "tournament_register_request",
  "edu_checkin",
  "edu_reminder",
  "edu_report",
  "event_cancel_signup:legacy",
]);

// 以現行 A／B 前端實際送出的 source 家族為準；不在清單內者只記錄、不擋
const KNOWN_SOURCE_PATTERNS = Object.freeze([
  new RegExp(`^template:(${KNOWN_TEMPLATE_KEYS.join("|")})(:admins)?$`),
  /^team_join_review:(approve|reject)$/,
  /^team_join_review:broadcast:(approve|reject)$/,
  /^team_role_assignment:(captain|leader|coach|member)$/,
  /^tournament_review:(approve|reject)$/,
  /^tournament_review:broadcast:(approve|reject)$/,
  /^edu_student_review:(approve|reject)$/,
  /^target:[a-z_]+$/,
]);

// 站內信 type 白名單（現行前端只送出這四種）→ typeName 由伺服器對照產生
const INBOX_TYPE_NAMES = Object.freeze({
  system: "系統",
  activity: "活動",
  tournament: "賽事",
  private: "私訊",
});
const INBOX_FALLBACK_TYPE = "private";
// 允許沿用的 senderName 清單；不在清單內一律由伺服器決定
const INBOX_CLIENT_SENDER_ALLOWLIST = Object.freeze(["系統"]);
const INBOX_FALLBACK_SENDER_NAME = "用戶";
const INBOX_SENDER_NAME_MAX = 80;

function stripControlChars(value) {
  if (typeof value !== "string") return value;
  return value.replace(CONTROL_CHARS_RE, "");
}

function isValidSourceFormat(source) {
  return typeof source === "string" && SOURCE_FORMAT_RE.test(source);
}

// 供 log 使用：格式合格才原樣輸出，否則 null（不把未驗證字串寫進 log）
function logSafeSource(source) {
  return isValidSourceFormat(source) && source.length <= 120 ? source : null;
}

function isKnownSource(source) {
  if (typeof source !== "string") return false;
  return KNOWN_SOURCE_EXACT.has(source)
    || KNOWN_SOURCE_PATTERNS.some((pattern) => pattern.test(source));
}

// 遮罩：保留前 2 後 2 碼，其餘以 * 取代（過短則全遮）
function maskUid(uid) {
  const text = String(uid || "");
  if (text.length <= 4) return "*".repeat(text.length);
  return `${text.slice(0, 2)}${"*".repeat(text.length - 4)}${text.slice(-2)}`;
}

// 台北時間 YYYY/MM/DD HH:mm（直接 UTC+8 偏移，不依賴 Intl）
function formatTaipeiDateTime(nowMs) {
  const t = new Date(nowMs + 8 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}/${pad(t.getUTCMonth() + 1)}/${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}

// 台北日期 yyyymmdd（每日計數的換日依據）
function taipeiDayKey(nowMs) {
  const t = new Date(nowMs + 8 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${t.getUTCFullYear()}${pad(t.getUTCMonth() + 1)}${pad(t.getUTCDate())}`;
}

function normalizeCallerDisplayName(userData) {
  const raw = userData?.displayName || userData?.name || userData?.lineDisplayName || "";
  const text = typeof raw === "string" ? stripControlChars(raw).trim() : "";
  return text.slice(0, INBOX_SENDER_NAME_MAX);
}

/**
 * 點對點且未分類（無 actionType）站內信：顯示欄位改由伺服器決定。
 * - type：白名單，不在清單回退 private；typeName 依 type 對照
 * - senderName：僅沿用 INBOX_CLIENT_SENDER_ALLOWLIST 內的值，其餘為呼叫者顯示名稱（查不到用「用戶」）
 * - time：伺服器台北時間
 */
function resolveInboxDisplayFields(message, { callerData, nowMs } = {}) {
  const requestedType = typeof message?.type === "string" ? message.type.trim() : "";
  const type = Object.prototype.hasOwnProperty.call(INBOX_TYPE_NAMES, requestedType)
    ? requestedType
    : INBOX_FALLBACK_TYPE;
  const requestedSender = typeof message?.senderName === "string" ? message.senderName.trim() : "";
  const senderName = INBOX_CLIENT_SENDER_ALLOWLIST.includes(requestedSender)
    ? requestedSender
    : (normalizeCallerDisplayName(callerData) || INBOX_FALLBACK_SENDER_NAME);
  return {
    type,
    typeName: INBOX_TYPE_NAMES[type],
    senderName,
    time: formatTaipeiDateTime(nowMs),
  };
}

module.exports = {
  KNOWN_TEMPLATE_KEYS,
  INBOX_TYPE_NAMES,
  INBOX_CLIENT_SENDER_ALLOWLIST,
  stripControlChars,
  isValidSourceFormat,
  logSafeSource,
  isKnownSource,
  maskUid,
  formatTaipeiDateTime,
  taipeiDayKey,
  resolveInboxDisplayFields,
};
