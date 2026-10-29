"use strict";

/**
 * 通知發送授權強化（第 2 批）：source → 關係類別（純資料，無 I/O）。
 * classifyRelation(source, keys) 回 { id, callerCheck, recipientQuery, keys }。
 * callerCheck、recipientQuery 只放函式名字串，本檔不實作查詢、不讀 request。
 * source 用精確字串與正規式比對，不用 startsWith。
 */

const { isKnownSource } = require("./notification-fields");

const NO_KEYS = Object.freeze([]);

function row(id, callerCheck, recipientQuery, keys) {
  return Object.freeze({ id, callerCheck, recipientQuery, keys });
}

const R0 = row("R0", "callerIsAuthenticated", "recipientIsCaller", NO_KEYS);
const R1 = row("R1", "callerMayManageEvent", "recipientHasActiveRegistration", Object.freeze(["eventId"]));
const R2 = row("R2", "deferredTo2c", "deferredTo2c", NO_KEYS);
const R3 = row("R3", "callerIsApplicant", "recipientIsTeamStaff", Object.freeze(["teamId"]));
const R4 = row("R4", "callerMayReviewJoin", "recipientIsReviewTarget", Object.freeze(["teamId", "applicantUid"]));
const R5 = row("R5", "callerMayAssignTeamRole", "recipientMatchesAssignment", Object.freeze(["teamId"]));
// 角色不在 source 後綴。缺 assignmentRole 時，決策層把它當缺鍵。
const R5_ROLE_UPGRADE = row(
  "R5",
  "callerMayAssignTeamRole",
  "recipientMatchesAssignment",
  Object.freeze(["teamId", "assignmentRole"]),
);
// §3 表這一格沒有查詢函式名（不另查，沿用 deliverToInbox 既有展開）。此字串不是待實作的查詢。
const R6 = row("R6", "callerHasBroadcastPermission", "existingInboxExpansion", NO_KEYS);
const R7 = row("R7", "callerIsAuthenticated", "recipientRoleIsAdmin", NO_KEYS);
const R8 = row(
  "R8",
  "callerMatchesTournamentSource",
  "recipientInTournamentAudience",
  Object.freeze(["tournamentId"]),
);
// 申請類再加 teamId：申請送出、通過／拒絕給申請人、通過後廣播（讀 applications/ta_{teamId} 或申請隊）。
const R8_APPLICATION = row(
  "R8",
  "callerMatchesTournamentSource",
  "recipientInTournamentAudience",
  Object.freeze(["tournamentId", "teamId"]),
);
const R9 = row("R9", "recordOnly", "recordOnly", NO_KEYS);
const CLIENT_UNKNOWN = row("client_unknown", "recordOnly", "recordOnly", NO_KEYS);
const UNCLASSIFIED = row("unclassified", "recordOnly", "recordOnly", NO_KEYS);
const ROLE_UPGRADE_WITHOUT_TEAM = Object.freeze({
  id: "R6",
  callerCheck: "callerHasBroadcastPermission",
  recipientQuery: "existingInboxExpansion",
  keys: NO_KEYS,
  roleUpgradeWithoutTeam: true,
});

// Map 沒有原型鍵。constructor、__proto__ 不會被當成某個 source。
const EXACT = new Map([
  ["client:line-push", R0],
  ["template:welcome", R0],
  ["template:signup_success", R0],
  ["template:cancel_signup", R0],
  ["event_cancel_signup:legacy", R0],
  ["template:event_changed", R1],
  ["template:event_cancelled", R1],
  ["template:event_relisted", R1],
  ["template:waitlist_demoted", R1],
  ["template:waitlist_promoted", R2],
  ["team_join_request", R3],
  ["team_join_review:approve", R4],
  ["team_join_review:reject", R4],
  ["team_join_review:broadcast:approve", R4],
  ["team_join_review:broadcast:reject", R4],
  ["team_role_assignment:captain", R5],
  ["team_role_assignment:leader", R5],
  ["team_role_assignment:coach", R5],
  ["team_role_assignment:member", R5],
  ["template:role_application", R7],
  ["template:role_application:admins", R7],
  ["tournament_register_request", R8_APPLICATION],
  ["tournament_review:approve", R8],
  ["tournament_review:reject", R8],
  ["tournament_review:broadcast:approve", R8],
  ["tournament_review:broadcast:reject", R8],
  ["template:tournament_friendly_host_opened", R8],
  ["template:tournament_friendly_team_apply_host", R8_APPLICATION],
  ["template:tournament_friendly_team_approved_applicant", R8_APPLICATION],
  ["template:tournament_friendly_team_rejected_applicant", R8_APPLICATION],
  ["template:tournament_friendly_team_approved_broadcast", R8_APPLICATION],
  ["edu_checkin", R9],
  ["edu_reminder", R9],
  ["edu_report", R9],
  ["edu_student_review:approve", R9],
  ["edu_student_review:reject", R9],
]);

const TARGET_SOURCE_RE = /^target:[a-z_]+$/;

// 只看自身屬性。原型上的 teamId 不算有帶鍵。
function hasOwnNonEmptyString(keys, name) {
  if (!keys || typeof keys !== "object") return false;
  if (!Object.prototype.hasOwnProperty.call(keys, name)) return false;
  const value = keys[name];
  return typeof value === "string" && value.length > 0;
}

function classifyRelation(source, keys) {
  if (typeof source !== "string" || source.length === 0) return null;
  if (!isKnownSource(source)) return null;
  if (source === "client:unknown") return CLIENT_UNKNOWN;
  if (source === "template:role_upgrade") {
    return hasOwnNonEmptyString(keys, "teamId") ? R5_ROLE_UPGRADE : ROLE_UPGRADE_WITHOUT_TEAM;
  }
  if (TARGET_SOURCE_RE.test(source)) return R6;
  const exact = EXACT.get(source);
  if (exact) return exact;
  return UNCLASSIFIED;
}

module.exports = { classifyRelation };
