"use strict";

/**
 * 通知發送授權強化（第 2 批）：R3／R4／R5 俱樂部關係查詢。
 * T-062 C2：loadTeam 改接 readTeamById（import 別名仍叫 readTeamByDocId）。
 * 取代「查無或 id 欄位不一致都回 false」。只改找到哪份文件，成員比對仍只認文件 id。
 * 每個函式 async (ctx) => boolean；讀取失敗直接丟出，由決策層轉 deny。
 */

const { isUserCreatedTeam, isUserCreatedTeamOwner, normalizeId } = require("./team-membership-core");
// T-062 C2：改接 readTeamById。取代嚴格 readTeamByDocId（id 欄位不同即查無、不退回 where）。
const { str, memoByCtx, recipientIdentities, readTeamById: readTeamByDocId } = require("./notification-relation-queries-shared");

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
  // LINE 重用伺服器已讀的 recipientFound；站內信至多多讀一份 users 文件（同一次決策內共用）。
  const loadRecipientData = memoByCtx(async (ctx) => {
    if (ctx?.recipientFound) return ctx.recipientFound.data || null;
    const uid = normalizeId(ctx?.recipientUid);
    if (!uid) return null;
    const snap = await db.collection("users").doc(uid).get();
    return snap?.exists ? snap.data() : null;
  });
  const recipientInTeamDoc = async (ctx, team) => {
    const userData = await loadRecipientData(ctx);
    return Array.isArray(userData?.teamIds) && userData.teamIds.includes(team.docId);
  };
  // 只在缺 teamId（或解不出隊伍）時查：三個「等值＋array-contains」查詢，不需複合索引。
  // 沒有呼叫者無從反查，視為命中（空字串標記，任何收件者都不會是成員）＝略過。
  const loadCallerUserCreatedStaffTeamIds = memoByCtx(async (ctx) => {
    const caller = str(ctx?.callerUid);
    if (!caller) return [""];
    const teams = db.collection("teams");
    const snaps = await Promise.all([
      teams.where("captainUid", "==", caller).where("createdVia", "==", "user_capability").get(),
      teams.where("coachUids", "array-contains", caller).where("createdVia", "==", "user_capability").get(),
      teams.where("leaderUids", "array-contains", caller).where("createdVia", "==", "user_capability").get(),
    ]);
    const ids = new Set();
    snaps.forEach((snap) => (snap?.docs || []).forEach((doc) => {
      if (isUserCreatedTeam(doc.data())) ids.add(doc.id);
    }));
    return [...ids];
  });
  // 同一次決策（同一個 ctx）只解析一次 Callable 權限（R4），失敗的 Promise 也快取。
  // C4 的暫時性錯誤重試會建新 ctx、因此會重新解析；這是預期行為，不靠本快取擋重試。
  const loadCallableAccess = memoByCtx(async (ctx) => {
    if (typeof helpers.callableAccess !== "function") {
      throw new TypeError("callableAccess helper is required");
    }
    return helpers.callableAccess(ctx);
  });
  const mayReceiveAssignment = memoByCtx(async (ctx) => {
    const team = await loadTeam(ctx);
    if (!team) return false;
    if (!isUserCreatedTeam(team.data)) return true;
    return recipientInTeamDoc(ctx, team);
  });
  // 全站授權：admin／super_admin，或 Rules 對齊的 team.manage_all／team.create（與 canManageTeamRoles 同碼）。
  const callerHasGlobalTeamAuthority = memoByCtx(async (ctx) => {
    const role = str(ctx?.callerRole);
    if (role === "admin" || role === "super_admin") return true;
    if (!str(ctx?.callerUid)) return false;
    const access = await readAccess(ctx);
    return access.hasPermission("team.manage_all") || access.hasPermission("team.create");
  });

  return {
    // T-090f B3：不看 source／template 分類，只用伺服器讀到的隊伍標記、呼叫者角色與收件者 teamIds。
    // 管理端／legacy 隊伍與全站授權者維持既有流程（true）；自建隊伍且無全站授權時，
    // 呼叫者必須是該隊擁有者或職員、收件者必須已是該隊成員，否則略過。
    // teamId 缺或解不出隊伍：以呼叫者反查自建俱樂部職員身分（captainUid／coachUids／leaderUids，各加 createdVia）。
    // 查無＝舊路徑（true）；命中時同上：全站授權者照舊，其餘收件者須是任一命中隊伍的成員。
    // （T-090f 顧問改裁，取代原「教練以上與全站授權者推定非自建、照舊」的角色推定。）
    async teamScopedDeliveryAllowed(ctx) {
      const team = await loadTeam(ctx);
      if (!team) {
        const staffTeamIds = await loadCallerUserCreatedStaffTeamIds(ctx);
        if (staffTeamIds.length === 0) return true;
        if (await callerHasGlobalTeamAuthority(ctx)) return true;
        const userData = await loadRecipientData(ctx);
        const teamIds = Array.isArray(userData?.teamIds) ? userData.teamIds : [];
        return staffTeamIds.some((id) => teamIds.includes(id));
      }
      if (!isUserCreatedTeam(team.data)) return true;
      if (await callerHasGlobalTeamAuthority(ctx)) return true;
      const caller = str(ctx?.callerUid);
      if (!caller) return false;
      if (!isUserCreatedTeamOwner(team.data, caller) && helpers.isTeamStaffForData(team.data, caller) !== true) {
        return false;
      }
      return recipientInTeamDoc(ctx, team);
    },


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

    // 原則：觸發動作由 Firestore Rules 把關者（R1 活動編輯）用 Rules 對齊權限；
    // 由 Callable 把關者（R4 入隊審核）用該 Callable 的權限函式。通知不比動作嚴，也不比動作寬。
    // 取代了什麼、為什麼（2026-11-16 顧問 §3.180）：取代 Rules 對齊的 createRulesAlignedAccess
    // （rolePermissions 不存在或沒有 permissions 欄位時不回退），改為 getCallerAccessContext.hasPermission
    // （同一情況回退 getDefaultRolePermissions，含個別授權）＋幹部或 isRoleAdminOrAbove。
    // 只改 R4。自建俱樂部 OWNER_FIELDS 本人仍先放行、不讀權限，與 assertCallerCanReviewGroupActionDocs 相同。
    async callerMayReviewJoin(ctx) {
      const caller = str(ctx?.callerUid);
      if (!caller) return false;
      const team = await loadTeam(ctx);
      if (!team) return false;
      if (isUserCreatedTeamOwner(team.data, caller)) return true;
      const access = await loadCallableAccess(ctx);
      const hasPerm = access.hasPermission("team.review_join")
        || access.hasPermission("team.manage.entry");
      if (!hasPerm) return false;
      const role = str(access.role);
      return helpers.isTeamStaffForData(team.data, caller) === true
        || role === "admin"
        || role === "super_admin";
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

    // 隊伍存在，且呼叫者是幹部，或 Rules 對齊具備 team.manage_all／team.create（與 canManageTeamRoles 同碼）。
    // （T-090b 審查 P1：取代原「只認 team.manage_all」，team.create 持有者在 A 建立自己不在職員欄位的俱樂部時會被拒。）
    async callerMayAssignTeamRole(ctx) {
      const caller = str(ctx?.callerUid);
      if (!caller) return false;
      const team = await loadTeam(ctx);
      if (!team) return false;
      if (helpers.isTeamStaffForData(team.data, caller) === true) return true;
      const access = await readAccess(ctx);
      return access.hasPermission("team.manage_all") || access.hasPermission("team.create");
    },

    // 隊伍存在且不是自建俱樂部（管理端／legacy）。重用同一次決策已讀的隊伍文件，不多讀。
    async teamIsNotUserCreated(ctx) {
      const team = await loadTeam(ctx);
      return !!team && !isUserCreatedTeam(team.data);
    },

    // 與指派欄位檢查分開，讓決策層在 R5 log 模式也能靜默略過非成員。
    recipientMayReceiveTeamAssignment: mayReceiveAssignment,

    // captain 對 captainUid；leader 對 leaderUids 或 leaderUid；coach 對 coachUids。member 不在此查（回 false）。
    async recipientMatchesAssignment(ctx) {
      const identities = recipientIdentities(ctx);
      if (identities.length === 0) return false;
      const role = assignmentRoleOf(ctx);
      if (role !== "captain" && role !== "leader" && role !== "coach") return false;
      const team = await loadTeam(ctx);
      if (!team) return false;
      if (!await mayReceiveAssignment(ctx)) return false;
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
