"use strict";

/**
 * deleteTeam — 刪除俱樂部（取代舊站 A removeTeam 的前端 4 段接力，T-027 7b(A)）。
 *
 * 權限＝A 前端刪隊准入（captainUid／creatorUid／ownerUid 或 team.manage_all）∧ 呼叫者 coach 以上；
 * 權限碼（team.manage_all／team.create）一律用 team-permission.js 的 Rules 對齊判斷：rolePermissions/{role} 文件不存在
 * 視為沒有該權限，不回退 getCallerAccessContext 的預設權限。成員歸屬以 team 文件 id 為準，不用文件內可被 owner 改寫的 id 欄位。
 * 可重入、冪等，最後才刪 team 文件（任何階段失敗使用者可直接重試）：
 *   Phase 1 伺服器查成員集合 → 分批清 users 四欄（每批 ≤450，見 team-deletion-members.js）；
 *           有成員重試耗盡仍清不掉 → 回 partial、不進 Phase 2～4（team 文件仍在，呼叫者重跑即可）
 *   Phase 2/3 幹部角色重算（排除本隊）＋站內信（見 team-deletion-roles.js）；呼叫者本人的降級留給 Phase 4
 *   Phase 4 同一個 batch：呼叫者本人的角色變更（若有）＋ operationLog ＋ 刪 team 文件（帶 exists 前置條件）
 * 刻意不處理（A 現況也沒有）：子集合、events.creatorTeamIds、tournaments.hostTeamId、teamExpLogs、入隊申請訊息、進行中活動／賽事檢查。
 */

const { isCoachPlusAccess } = require("./team-member-removal");
const { createRulesAlignedAccess } = require("./team-permission");
const { cleanMemberships, listTeamMemberDocs } = require("./team-deletion-members");
const { canDemoteOtherStaff, createStaffRoleRecalculator } = require("./team-deletion-roles");
const {
  collectStaffUids,
  isFirestoreError,
  maskId,
  normalizeId,
  readActorNames,
  resolveTeamSnapshot,
} = require("./team-membership-core");

const OWNER_FIELDS = ["captainUid", "creatorUid", "ownerUid"];

// A team-list-helpers.js#_canEditTeamByRoleOrCaptain：owner 欄位（trim 比對）或 team.manage_all。
function isFrontendTeamDeleter(team, uid, access) {
  if (!team) return false;
  if (access?.isSuperAdmin) return true;
  if (typeof access?.hasPermission === "function" && access.hasPermission("team.manage_all") === true) return true;
  if (typeof uid !== "string" || !uid) return false;
  return OWNER_FIELDS.some((field) => {
    const ownerId = String(team[field] || "").trim();
    return ownerId !== "" && ownerId === uid;
  });
}

function createDeleteTeamHandler({
  db,
  HttpsError,
  FieldValue,
  FieldPath,
  roleLevels,
  normalizeRole,
  getCallerAccessContext,
  ensureAuthUser,
  setRoleClaimMerged,
  buildOperationLogPayload,
  defaultNotificationTemplates,
  logger = console,
  now = () => new Date(),
}) {
  return async function deleteTeamHandler(request) {
    const callerUid = request?.auth?.uid;
    if (!callerUid) throw new HttpsError("unauthenticated", "AUTH_REQUIRED");
    const teamIdInput = normalizeId(request?.data?.teamId);
    if (!teamIdInput) throw new HttpsError("invalid-argument", "TEAM_ID_REQUIRED");
    const ctx = { callerUid, teamId: maskId(teamIdInput) };
    let phase = "resolve";
    const progress = { cleanedMembers: 0, roleChanges: 0 };

    try {
      const teamSnap = await resolveTeamSnapshot(db, teamIdInput, HttpsError);
      if (!teamSnap) {
        // 與 deleteTournament 一致：查無即視為已刪（此時無資料可驗權限）；記下呼叫者，方便看出探測。
        logger.warn?.("[deleteTeam] team not found, treated as already deleted", ctx);
        return { ok: true, alreadyDeleted: true };
      }
      const teamData = teamSnap.data() || {};
      const teamDocId = teamSnap.id;

      phase = "authorize";
      const access = await createRulesAlignedAccess({
        db,
        access: await getCallerAccessContext(request),
        uid: callerUid,
      });
      if (!isFrontendTeamDeleter(teamData, callerUid, access)) {
        throw new HttpsError("permission-denied", "TEAM_DELETE_DENIED");
      }
      if (!isCoachPlusAccess(access, roleLevels)) {
        throw new HttpsError("permission-denied", "COACH_PLUS_REQUIRED");
      }

      const issuedAt = now();
      const actor = { uid: callerUid, ...(await readActorNames(db, callerUid, access.role)) };

      phase = "clean-members";
      const memberDocs = await listTeamMemberDocs({ db, FieldPath, teamDocId, teamData });
      const cleanup = await cleanMemberships({ db, FieldValue, memberDocs, teamDocId, logger, ctx });
      progress.cleanedMembers = cleanup.cleaned;
      if (cleanup.failed.length > 0) {
        // 有成員在重試上限內仍清不掉（持續與併發寫入衝突）：不進角色重算、不刪 team，讓呼叫者重跑。
        logger.error?.("[deleteTeam] partial: members left uncleaned, team kept", {
          ...ctx,
          ...progress,
          remainingMembers: cleanup.failed.length,
        });
        return {
          ok: true,
          alreadyDeleted: false,
          cleanedMembers: progress.cleanedMembers,
          roleChanges: 0,
          roleSkipped: 0,
          partial: { remainingMembers: cleanup.failed.length, memberIds: cleanup.failed, rerun: true },
        };
      }

      phase = "recalculate-roles";
      const recalculator = createStaffRoleRecalculator({
        db,
        HttpsError,
        FieldValue,
        roleLevels,
        normalizeRole,
        ensureAuthUser,
        setRoleClaimMerged,
        buildOperationLogPayload,
        defaultTemplates: defaultNotificationTemplates,
        logger,
        teamDocId,
        actor,
        issuedAt,
      });
      const { roleSkipped, callerChange } = await recalculator.run({
        staffUids: [...collectStaffUids(teamData)],
        canDemoteOthers: canDemoteOtherStaff(access),
        progress,
      });

      phase = "delete-team";
      const teamName = typeof teamData.name === "string" && teamData.name ? teamData.name : "俱樂部";
      const finalBatch = db.batch();
      if (callerChange) await recalculator.stage(finalBatch, callerChange);
      finalBatch.set(
        db.collection("operationLogs").doc(`op_${issuedAt.getTime()}_${Math.random().toString(36).slice(2, 8)}`),
        {
          ...buildOperationLogPayload({
            operator: actor.operator,
            type: "team_delete",
            typeName: "刪除俱樂部",
            content: `刪除「${teamName}」`,
            now: issuedAt,
          }),
          actorUid: callerUid,
          source: "callable",
        },
      );
      finalBatch.delete(teamSnap.ref, { exists: true });
      try {
        await finalBatch.commit();
      } catch (error) {
        // 兩個呼叫同時進行時，後到的 delete 前置條件會失敗（整批不寫）；確認 team 已不在就視為已刪。
        if (isFirestoreError(error, "not-found") && !(await teamSnap.ref.get()).exists) {
          logger.warn?.("[deleteTeam] team was deleted by a concurrent call", ctx);
          return { ok: true, alreadyDeleted: true };
        }
        throw error;
      }
      if (callerChange) progress.roleChanges += 1;

      logger.info?.("[deleteTeam] completed", { ...ctx, ...progress, roleSkipped });
      return {
        ok: true,
        alreadyDeleted: false,
        cleanedMembers: progress.cleanedMembers,
        roleChanges: progress.roleChanges,
        roleSkipped,
      };
    } catch (error) {
      logger.error?.("[deleteTeam] failed", {
        ...ctx,
        phase,
        ...progress,
        code: String(error?.code || "internal"),
      });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "TEAM_DELETE_FAILED");
    }
  };
}

function createDeleteTeamCallable({ onCall, ...dependencies }) {
  return onCall(
    { region: "asia-east1", timeoutSeconds: 120 },
    createDeleteTeamHandler(dependencies),
  );
}

module.exports = {
  createDeleteTeamCallable,
  createDeleteTeamHandler,
  isFrontendTeamDeleter,
};
