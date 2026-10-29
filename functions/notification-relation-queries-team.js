"use strict";

/**
 * 通知發送授權強化（第 2 批）：R3／R4／R5 俱樂部關係查詢。
 * 隊伍一律以文件 id 讀取（readTeamByDocId），查無或 id 欄位不一致都回 false。
 * 每個函式 async (ctx) => boolean；讀取失敗直接丟出，由決策層轉 deny。
 */

const { str, memoByCtx, recipientIdentities, readTeamByDocId } = require("./notification-relation-queries-shared");

const ASSIGNMENT_SOURCE_RE = /^team_role_assignment:(captain|leader|coach|member)$/;

function isBroadcastSource(source) {
  return typeof source === "string" && source.includes(":broadcast:");
}

// 指派角色：優先用決策層算好的 ctx.assignmentRole，其次 source 後綴，最後可選鍵 assignmentRole。
function assignmentRoleOf(ctx) {
  if (typeof ctx?.assignmentRole === "string" && ctx.assignmentRole) return ctx.assignmentRole;
  const match = ASSIGNMENT_SOURCE_RE.exec(typeof ctx?.source === "string" ? ctx.source : "");
  if (match) return match[1];
  return str(ctx?.keys?.assignmentRole);
}

function trimmedList(value) {
  return Array.isArray(value) ? value.map(str).filter(Boolean) : [];
}

function createTeamQueries({ db, helpers, readAccess }) {
  const loadTeam = memoByCtx((ctx) => readTeamByDocId(db, ctx?.keys?.teamId));

  return {
    // 申請人必須是呼叫者本人。請求（extra／keys）有帶申請人 uid 時必須等於呼叫者；
    // 沒帶則視為呼叫者本人發起（沒有申請文件可驗，見回報）。
    async callerIsApplicant(ctx) {
      const caller = str(ctx?.callerUid);
      if (!caller) return false;
      const applicant = str(ctx?.extra?.applicantUid) || str(ctx?.keys?.applicantUid);
      return applicant === "" || applicant === caller;
    },

    // 收件者是該隊幹部（captainUid／creatorUid／ownerUid／leaderUid(s)／coachUids）。
    async recipientIsTeamStaff(ctx) {
      const identities = recipientIdentities(ctx);
      if (identities.length === 0) return false;
      const team = await loadTeam(ctx);
      if (!team) return false;
      return identities.some((uid) => helpers.isTeamStaffForData(team.data, uid) === true);
    },

    // 隊伍存在，且 admin／super_admin，或「幹部欄位 + Rules 對齊的 team.review_join／team.manage.entry」。
    async callerMayReviewJoin(ctx) {
      const caller = str(ctx?.callerUid);
      if (!caller) return false;
      const team = await loadTeam(ctx);
      if (!team) return false;
      const role = str(ctx?.callerRole);
      if (role === "admin" || role === "super_admin") return true;
      if (helpers.isTeamStaffForData(team.data, caller) !== true) return false;
      const access = await readAccess(ctx);
      return access.hasPermission("team.review_join") || access.hasPermission("team.manage.entry");
    },

    // approve／reject：收件者等於 applicantUid。broadcast：收件者是該隊幹部且不是呼叫者。
    async recipientIsReviewTarget(ctx) {
      const identities = recipientIdentities(ctx);
      if (identities.length === 0) return false;
      if (!isBroadcastSource(ctx?.source)) {
        const applicant = str(ctx?.keys?.applicantUid);
        return applicant !== "" && identities.includes(applicant);
      }
      const caller = str(ctx?.callerUid);
      if (!caller || identities.includes(caller)) return false;
      const team = await loadTeam(ctx);
      if (!team) return false;
      return identities.some((uid) => helpers.isTeamStaffForData(team.data, uid) === true);
    },

    // 隊伍存在，且呼叫者是幹部，或 Rules 對齊具備 team.manage_all。
    async callerMayAssignTeamRole(ctx) {
      const caller = str(ctx?.callerUid);
      if (!caller) return false;
      const team = await loadTeam(ctx);
      if (!team) return false;
      if (helpers.isTeamStaffForData(team.data, caller) === true) return true;
      const access = await readAccess(ctx);
      return access.hasPermission("team.manage_all");
    },

    // captain 對 captainUid；leader 對 leaderUids 或 leaderUid；coach 對 coachUids。member 不在此查（回 false）。
    async recipientMatchesAssignment(ctx) {
      const identities = recipientIdentities(ctx);
      if (identities.length === 0) return false;
      const role = assignmentRoleOf(ctx);
      if (role !== "captain" && role !== "leader" && role !== "coach") return false;
      const team = await loadTeam(ctx);
      if (!team) return false;
      const data = team.data;
      let field = [];
      if (role === "captain") field = [str(data.captainUid)];
      else if (role === "leader") field = [...trimmedList(data.leaderUids), str(data.leaderUid)];
      else field = trimmedList(data.coachUids);
      const allowed = field.filter(Boolean);
      return identities.some((uid) => allowed.includes(uid));
    },
  };
}

module.exports = { createTeamQueries };
