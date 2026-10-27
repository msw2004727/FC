"use strict";

/**
 * removeTeamMember — 剔除俱樂部一般隊員（取代舊站 A 前端直寫被剔者 users 文件的路徑，T-027 7b(A)）。
 *
 * 權限＝A 前端准入 ∧ 呼叫者 coach 以上（對應 Rules users 的 1711／1712／1713）：
 *  - 前端准入刻意不用 index.js 的 isTeamStaffForData（它多認 creatorUid／ownerUid／舊 leaderUid 並 trim，
 *    比 A 的 _canManageTeamMembers 寬）；這裡逐字照 A：captainUid 嚴格 ===、leaderUids／coachUids 嚴格 includes。
 *  - coach 以上用 ROLE_LEVELS（固定表）；自訂角色等級查不到＝0，視為不足而被拒（已知限制）；
 *    唯一例外：持有 admin.repair.team_join_repair 的自訂角色會通過（與 Rules 1712 一致）。
 *  - 權限碼（admin.repair.team_join_repair）一律用 team-permission.js 的 Rules 對齊判斷：rolePermissions/{role} 文件不存在
 *    視為沒有該權限，不回退 getCallerAccessContext 的預設權限（審查 P3-7）。
 *  - 成員歸屬以 team 文件 id 為準，不用文件內可被 owner 改寫的 id 欄位（審查 P3-1）。
 * transaction 內只寫被剔者 users 四欄＋operationLog；teams.members 在提交後用 countTeamMembers 冪等重算，
 * 重算失敗只記 log，Callable 仍回 ok（memberCount: null）。
 */

const { getUserTeamIds, isUserInTeam } = require("./team-member-count");
const { resolveStrictUserIdentity } = require("./team-role-promotion");
const { createRulesAlignedAccess } = require("./team-permission");
const {
  assertTeamDocIdConsistent,
  buildNextMembership,
  collectStaffUids,
  maskId,
  normalizeId,
  readActorNames,
  readTeamNames,
  recountAndWriteTeamMembers,
  resolveTeamSnapshot,
} = require("./team-membership-core");

const TEAM_JOIN_REPAIR_PERMISSION = "admin.repair.team_join_repair";

// Rules isCoachPlus()＋canRunTeamJoinRepair() 的 Functions 版（super_admin、等級 >= coach、入隊修復權限）。
function isCoachPlusAccess(access, roleLevels) {
  if (!access) return false;
  if (access.isSuperAdmin) return true;
  const level = Object.prototype.hasOwnProperty.call(roleLevels, access.role) ? roleLevels[access.role] : 0;
  if (Number.isFinite(level) && level >= roleLevels.coach) return true;
  return typeof access.hasPermission === "function"
    && access.hasPermission(TEAM_JOIN_REPAIR_PERMISSION) === true;
}

// A team-list-helpers.js#_canManageTeamMembers：不 trim、不字串化、不認 creatorUid／ownerUid／舊 leaderUid。
function isFrontendTeamMemberManager(team, uid) {
  if (!team || typeof uid !== "string" || !uid) return false;
  if (team.captainUid === uid) return true;
  if (Array.isArray(team.leaderUids) && team.leaderUids.includes(uid)) return true;
  return Array.isArray(team.coachUids) && team.coachUids.includes(uid);
}

async function resolveMember(db, HttpsError, memberUid) {
  try {
    return await resolveStrictUserIdentity({ db, targetUid: memberUid, HttpsError });
  } catch (error) {
    if (error instanceof HttpsError && error.code === "not-found") {
      throw new HttpsError("not-found", "MEMBER_NOT_FOUND");
    }
    if (error instanceof HttpsError && error.code === "failed-precondition") {
      throw new HttpsError("failed-precondition", "MEMBER_IDENTITY_UNAVAILABLE");
    }
    throw error;
  }
}

function createRemoveTeamMemberHandler({
  db,
  HttpsError,
  FieldValue,
  roleLevels,
  getCallerAccessContext,
  buildOperationLogPayload,
  logger = console,
  now = () => new Date(),
}) {
  return async function removeTeamMemberHandler(request) {
    const callerUid = request?.auth?.uid;
    if (!callerUid) throw new HttpsError("unauthenticated", "AUTH_REQUIRED");
    const teamIdInput = normalizeId(request?.data?.teamId);
    const memberUidInput = normalizeId(request?.data?.memberUid);
    if (!teamIdInput || !memberUidInput) {
      throw new HttpsError("invalid-argument", "TEAM_ID_AND_MEMBER_UID_REQUIRED");
    }
    const ctx = { callerUid, teamId: maskId(teamIdInput) };

    try {
      const teamSnap = await resolveTeamSnapshot(db, teamIdInput, HttpsError);
      if (!teamSnap) throw new HttpsError("not-found", "TEAM_NOT_FOUND");
      const teamRef = teamSnap.ref;
      const teamData = teamSnap.data() || {};
      const teamDocId = teamSnap.id;

      // 權限（失敗不寫任何東西）
      if (!isFrontendTeamMemberManager(teamData, callerUid)) {
        throw new HttpsError("permission-denied", "TEAM_MANAGE_DENIED");
      }
      const access = await createRulesAlignedAccess({
        db,
        access: await getCallerAccessContext(request),
        uid: callerUid,
      });
      if (!isCoachPlusAccess(access, roleLevels)) {
        throw new HttpsError("permission-denied", "COACH_PLUS_REQUIRED");
      }

      const target = await resolveMember(db, HttpsError, memberUidInput);
      const targetIds = new Set([memberUidInput, target.uid, target.docId]);

      const issuedAt = now();
      const opRef = db.collection("operationLogs")
        .doc(`op_${issuedAt.getTime()}_${Math.random().toString(36).slice(2, 8)}`);
      const actor = await readActorNames(db, callerUid, access.role);

      const outcome = await db.runTransaction(async (tx) => {
        // 先全部讀、再寫；以 transaction 內的現值重驗，避免兩次呼叫之間幹部名單或被剔者隊伍已變。
        const freshTeamSnap = await tx.get(teamRef);
        if (!freshTeamSnap.exists) throw new HttpsError("not-found", "TEAM_NOT_FOUND");
        assertTeamDocIdConsistent(freshTeamSnap, HttpsError);
        const freshTeam = freshTeamSnap.data() || {};
        if (!isFrontendTeamMemberManager(freshTeam, callerUid)) {
          throw new HttpsError("permission-denied", "TEAM_MANAGE_DENIED");
        }
        const staffUids = collectStaffUids(freshTeam);
        if ([...targetIds].some((id) => staffUids.has(id))) {
          throw new HttpsError("failed-precondition", "TARGET_IS_STAFF");
        }

        const userRef = db.collection("users").doc(target.docId);
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists) throw new HttpsError("not-found", "MEMBER_NOT_FOUND");
        const userData = userSnap.data() || {};
        if (!isUserInTeam(userData, teamDocId)) return { alreadyRemoved: true };

        const remainingIds = getUserTeamIds(userData).filter((id) => id !== teamDocId);
        const teamNames = await readTeamNames(remainingIds, (id) => tx.get(db.collection("teams").doc(id)));
        // 對齊 A（team-detail.js）：被剔者顯示名稱 name || displayName，沒有就「隊員」，不用任何 UID 格式化。
        const memberName = String(userData.name || userData.displayName || "").trim() || "隊員";
        const teamName = typeof freshTeam.name === "string" && freshTeam.name ? freshTeam.name : "俱樂部";

        tx.update(userRef, {
          ...buildNextMembership(userData, teamDocId, teamNames),
          updatedAt: FieldValue.serverTimestamp(),
        });
        tx.set(opRef, {
          ...buildOperationLogPayload({
            operator: actor.operator,
            type: "team_member_remove",
            typeName: "移除隊員",
            content: `${actor.contentName} 將「${memberName}」移出「${teamName}」`,
            now: issuedAt,
          }),
          actorUid: callerUid,
          source: "callable",
        });
        return { alreadyRemoved: false };
      });

      if (outcome.alreadyRemoved) return { ok: true, alreadyRemoved: true };

      // transaction 已提交：members 為衍生顯示數，重算失敗不讓 Callable 失敗（R-CF-003），下次任何重算會自癒。
      let memberCount = null;
      try {
        memberCount = await recountAndWriteTeamMembers({ db, FieldValue, teamRef });
      } catch (error) {
        logger.error?.("[removeTeamMember] member count recount failed after commit", {
          ...ctx,
          code: String(error?.code || "unknown"),
        });
      }
      return { ok: true, alreadyRemoved: false, memberCount };
    } catch (error) {
      logger.error?.("[removeTeamMember] failed", { ...ctx, code: String(error?.code || "internal") });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "TEAM_REMOVE_MEMBER_FAILED");
    }
  };
}

function createRemoveTeamMemberCallable({ onCall, ...dependencies }) {
  return onCall(
    { region: "asia-east1", timeoutSeconds: 30 },
    createRemoveTeamMemberHandler(dependencies),
  );
}

module.exports = {
  createRemoveTeamMemberCallable,
  createRemoveTeamMemberHandler,
  isCoachPlusAccess,
  isFrontendTeamMemberManager,
};
