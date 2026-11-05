"use strict";

/**
 * deleteTeam — 刪除俱樂部（取代舊站 A removeTeam 的前端 4 段接力，T-027 7b(A)）。
 *
 * 權限＝captainUid／creatorUid／ownerUid 本人，或既有 super_admin／team.manage_all 且 coach 以上；
 * 權限碼（team.manage_all／team.create）一律用 team-permission.js 的 Rules 對齊判斷：rolePermissions/{role} 文件不存在
 * 視為沒有該權限，不回退 getCallerAccessContext 的預設權限。成員歸屬以文件 id 與經跨隊衝突檢查的舊 id 為準。
 * 可重入、冪等，最後才刪 team 文件（任何階段失敗使用者可直接重試）：
 *   Phase 1 伺服器查成員集合 → 分批清 users 四欄（每批 ≤450，見 team-deletion-members.js）；
 *           清完後再查一次「仍含本隊」的人（recheck），有新加入者就再清，最多共 3 次 recheck；仍 >0 → TEAM_MEMBERS_CHURNING；
 *           有成員重試耗盡仍清不掉 → 回 partial、不進 Phase 2～4（team 文件與所有角色都沒動，呼叫者重跑即可）
 *   Phase 2/3 幹部角色重算（排除本隊）＋站內信（見 team-deletion-roles.js）；呼叫者本人的降級留給 Phase 4
 *   Phase 4 同一個交易：重讀 team 重驗准入（擁有者已轉移 → TEAM_OWNER_CHANGED，T-090h P3）後，
 *           呼叫者本人的角色變更（若有）＋ operationLog ＋ 刪 team 文件（帶 exists 前置條件）；Phase 2 前另有一次便宜的預檢
 * 刻意不處理（A 現況也沒有）：子集合、events.creatorTeamIds、tournaments.hostTeamId、teamExpLogs、入隊申請訊息、進行中活動／賽事檢查。
 */

const { isCoachPlusAccess } = require("./team-member-removal");
const { createRulesAlignedAccess } = require("./team-permission");
const { settleTeamMembers } = require("./team-deletion-members");
const { canDemoteOtherStaff, createStaffRoleRecalculator } = require("./team-deletion-roles");
const {
  collectStaffUids,
  isFirestoreError,
  maskId,
  normalizeId,
  readActorNames,
  resolveMembershipTeamIds,
  resolveTeamSnapshot,
} = require("./team-membership-core");
const { maskUid } = require("./notification-fields");

const OWNER_FIELDS = ["captainUid", "creatorUid", "ownerUid"];

function isTeamOwner(team, uid) {
  return !!team && typeof uid === "string" && !!uid
    && OWNER_FIELDS.some((field) => typeof team[field] === "string" && team[field] === uid);
}

// A team-list-helpers.js#_canEditTeamByRoleOrCaptain 的 owner 欄位 ∨ team.manage_all；
// owner 欄位比對對齊 Rules isResourceOwnerByField（firestore.rules:485-490）：欄位必須是字串且與 uid 完全相等，
// 不 trim、不字串化（A 前端的 _isTeamOwnerUser 會 trim，這裡刻意更嚴，不比 Rules 放寬）。
function isFrontendTeamDeleter(team, uid, access) {
  if (!team) return false;
  if (access?.isSuperAdmin) return true;
  if (typeof access?.hasPermission === "function" && access.hasPermission("team.manage_all") === true) return true;
  return isTeamOwner(team, uid);
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
    // ctx 只給 log。授權、查詢、寫入仍用上面的 callerUid；teamId 維持 maskId。
    const ctx = { callerUid: maskUid(callerUid), teamId: maskId(teamIdInput) };
    let phase = "resolve";
    const progress = { cleanedMembers: 0, roleChanges: 0 };
    // 本次呼叫內「角色真的被改變」者的邏輯 uid（資訊性回傳欄位；不放進 progress，以免 uid 被 spread 進 log）
    const roleChangedUids = [];

    try {
      const teamSnap = await resolveTeamSnapshot(db, teamIdInput, HttpsError);
      if (!teamSnap) {
        // 與 deleteTournament 一致：查無即視為已刪（此時無資料可驗權限）；記下呼叫者，方便看出探測。
        logger.warn?.("[deleteTeam] team not found, treated as already deleted", ctx);
        return { ok: true, alreadyDeleted: true, skippedNotifies: 0 };
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
      if (!isTeamOwner(teamData, callerUid) && !isCoachPlusAccess(access, roleLevels)) {
        throw new HttpsError("permission-denied", "COACH_PLUS_REQUIRED");
      }
      // 以同一份 access 對「重讀後的 team」套用與上面完全相同的准入判斷（自建隊與 legacy 一致，不另訂規則）；
      // 不再成立（例如擁有者已轉移）→ TEAM_OWNER_CHANGED，team 文件與呼叫者角色不動。
      const assertStillDeleter = (current) => {
        if (!isFrontendTeamDeleter(current, callerUid, access)
          || (!isTeamOwner(current, callerUid) && !isCoachPlusAccess(access, roleLevels))) {
          throw new HttpsError("failed-precondition", "TEAM_OWNER_CHANGED");
        }
      };

      const issuedAt = now();
      const actor = { uid: callerUid, ...(await readActorNames(db, callerUid, access.role)) };

      phase = "clean-members";
      const membershipTeamIds = await resolveMembershipTeamIds(db, teamSnap);
      const cleanup = await settleTeamMembers({
        db, FieldValue, FieldPath, HttpsError, teamDocId, teamData, membershipTeamIds, logger, ctx, progress,
      });
      if (cleanup.failed.length > 0) {
        // 有成員在重試上限內仍清不掉（持續與併發寫入衝突）：不進角色重算、不刪 team，讓呼叫者重跑。
        logger.error?.("[deleteTeam] partial: members left uncleaned, team kept", {
          ...ctx,
          ...progress,
          remaining: cleanup.failed.length,
        });
        return {
          ok: true,
          alreadyDeleted: false,
          cleanedMembers: progress.cleanedMembers,
          roleChanges: 0,
          roleSkipped: 0,
          roleChangedUids: [],
          partial: { remaining: cleanup.failed.length, memberIds: cleanup.failed, rerun: true },
          skippedNotifies: 0,
        };
      }

      // T-090h P3：Phase 1 期間擁有者可能已被 transferUserTeam 轉走；降級他人前先便宜地重讀一次（1 讀），
      // 真正的關卡在 Phase 4 交易內再驗一次。查無 team 時交給 Phase 4 走 alreadyDeleted。
      phase = "reauthorize";
      const beforeRoles = await teamSnap.ref.get();
      if (beforeRoles.exists) assertStillDeleter(beforeRoles.data() || {});

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
      const roleOutcome = await recalculator.run({
        staffUids: [...collectStaffUids(teamData)],
        canDemoteOthers: canDemoteOtherStaff(access),
        progress,
        changedUids: roleChangedUids,
      });
      const { roleSkipped, callerChange } = roleOutcome;

      phase = "delete-team";
      const teamName = typeof teamData.name === "string" && teamData.name ? teamData.name : "俱樂部";
      const opLogRef = db.collection("operationLogs").doc(`op_${issuedAt.getTime()}_${Math.random().toString(36).slice(2, 8)}`);
      // T-090h P3：原本的 batch 只靠 exists 前置條件，擁有者在中途被轉移仍會刪掉。改成交易：先重讀 team 並重驗准入，
      // 再寫呼叫者角色＋opLog＋刪 team（同一次提交，寫入數不變、多 1 讀）。成員清理（可能上千筆）維持交易外分批，
      // 不受單次交易 500 寫上限影響。不用 lastUpdateTime 前置條件：team 文件會被成員數重算等無關寫入改動而誤拒。
      // 呼叫者的 stage（含 claim 外部呼叫）只在第一次驗證通過後做一次並錄下寫入，交易重跑時只重放，不重複呼叫／計數。
      let callerOps = null;
      let teamGone = false;
      try {
        await db.runTransaction(async (tx) => {
          const current = await tx.get(teamSnap.ref);
          teamGone = !current.exists;
          if (teamGone) return;
          assertStillDeleter(current.data() || {});
          if (callerChange && !callerOps) {
            const recorded = [];
            await recalculator.stage({
              update: (...args) => recorded.push(["update", args]),
              set: (...args) => recorded.push(["set", args]),
            }, callerChange);
            callerOps = recorded;
          }
          (callerOps || []).forEach(([op, args]) => tx[op](...args));
          tx.set(opLogRef, {
            ...buildOperationLogPayload({
              operator: actor.operator,
              type: "team_delete",
              typeName: "刪除俱樂部",
              content: `刪除「${teamName}」`,
              now: issuedAt,
            }),
            actorUid: callerUid,
            source: "callable",
          });
          tx.delete(teamSnap.ref, { exists: true });
        });
      } catch (error) {
        if (error instanceof HttpsError) throw error;
        // 兩個呼叫同時進行時，後到的 delete 前置條件會失敗（整批不寫）；確認 team 已不在就視為已刪。
        if (isFirestoreError(error, "not-found") && !(await teamSnap.ref.get()).exists) teamGone = true;
        else throw error;
      }
      // skippedNotifies 是 getter，呼叫者那次 stage 可能剛把它加一，所以要在交易之後讀。
      const skippedNotifies = roleOutcome.skippedNotifies;
      if (teamGone) {
        logger.warn?.("[deleteTeam] team was deleted by a concurrent call", ctx);
        // 本次呼叫已提交的他人降級仍如實回報（呼叫者自己的降級在未提交的最後一次交易裡，沒有提交）
        return { ok: true, alreadyDeleted: true, roleChangedUids, skippedNotifies };
      }
      if (callerChange) {
        progress.roleChanges += 1;
        roleChangedUids.push(callerChange.target.uid);
      }

      logger.info?.("[deleteTeam] completed", { ...ctx, ...progress, roleSkipped });
      return {
        ok: true,
        alreadyDeleted: false,
        cleanedMembers: progress.cleanedMembers,
        roleChanges: progress.roleChanges,
        roleSkipped,
        roleChangedUids,
        skippedNotifies,
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
