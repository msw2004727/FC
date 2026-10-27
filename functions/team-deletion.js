"use strict";

/**
 * deleteTeam — 刪除俱樂部（取代舊站 A removeTeam 的前端 4 段接力，T-027 7b(A)）。
 *
 * 權限＝A 前端刪隊准入（captainUid／creatorUid／ownerUid 或 team.manage_all）∧ 呼叫者 coach 以上。
 * 可重入、冪等，最後才刪 team 文件（任何階段失敗使用者可直接重試）：
 *   Phase 1 伺服器查成員集合 → 分批清 users 四欄（每批 ≤450）
 *   Phase 2/3 幹部角色重算（排除本隊）＋站內信（見 team-deletion-roles.js）
 *   Phase 4 同一個 batch：operationLog ＋ 刪 team 文件
 * 刻意不處理（A 現況也沒有）：子集合、events.creatorTeamIds、tournaments.hostTeamId、teamExpLogs、入隊申請訊息、進行中活動／賽事檢查。
 */

const { isUserInTeam, getUserTeamIds } = require("./team-member-count");
const { isCoachPlusAccess } = require("./team-member-removal");
const { applyStaffRoleRecalculation } = require("./team-deletion-roles");
const {
  buildNextMembership,
  collectStaffUids,
  maskId,
  normalizeId,
  readActorName,
  readAllDocs,
  readTeamNames,
  resolveTeamSnapshot,
} = require("./team-membership-core");

const BATCH_LIMIT = 450;
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

// 兩組查詢（teamIds array-contains、舊 teamId ==）分頁讀完並依 docId 去重。
async function listTeamMemberDocs({ db, FieldPath, logicalTeamId }) {
  const users = db.collection("users");
  const [byTeamIds, byTeamId] = await Promise.all([
    readAllDocs(users.where("teamIds", "array-contains", logicalTeamId), FieldPath),
    readAllDocs(users.where("teamId", "==", logicalTeamId), FieldPath),
  ]);
  const byDocId = new Map();
  [...byTeamIds, ...byTeamId].forEach((doc) => byDocId.set(doc.id, doc));
  return [...byDocId.values()].filter((doc) => isUserInTeam(doc.data() || {}, logicalTeamId));
}

// Phase 1：依每位成員目前的文件重算（重跑時已清過的人查不到，不會多清或重複扣）。
async function cleanMemberships({ db, FieldValue, memberDocs, logicalTeamId }) {
  const remainingIds = new Set();
  memberDocs.forEach((doc) => {
    getUserTeamIds(doc.data() || {}).forEach((id) => {
      if (id !== logicalTeamId) remainingIds.add(id);
    });
  });
  const teamNames = await readTeamNames([...remainingIds], (id) => db.collection("teams").doc(id).get());
  for (let i = 0; i < memberDocs.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    memberDocs.slice(i, i + BATCH_LIMIT).forEach((doc) => {
      batch.update(doc.ref, {
        ...buildNextMembership(doc.data() || {}, logicalTeamId, teamNames),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
  }
  return memberDocs.length;
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
      const teamSnap = await resolveTeamSnapshot(db, teamIdInput);
      if (!teamSnap) {
        // 與 deleteTournament 一致：查無即視為已刪（此時無資料可驗權限）；記下呼叫者，方便看出探測。
        logger.warn?.("[deleteTeam] team not found, treated as already deleted", ctx);
        return { ok: true, alreadyDeleted: true };
      }
      const teamData = teamSnap.data() || {};
      const logicalTeamId = String(teamData.id || teamSnap.id);

      phase = "authorize";
      const access = await getCallerAccessContext(request);
      if (!isFrontendTeamDeleter(teamData, callerUid, access)) {
        throw new HttpsError("permission-denied", "TEAM_DELETE_DENIED");
      }
      if (!isCoachPlusAccess(access, roleLevels)) {
        throw new HttpsError("permission-denied", "COACH_PLUS_REQUIRED");
      }

      const issuedAt = now();
      const actor = { uid: callerUid, name: await readActorName(db, callerUid) };

      phase = "clean-members";
      const memberDocs = await listTeamMemberDocs({ db, FieldPath, logicalTeamId });
      progress.cleanedMembers = await cleanMemberships({ db, FieldValue, memberDocs, logicalTeamId });

      phase = "recalculate-roles";
      const { roleChanges, roleSkipped } = await applyStaffRoleRecalculation({
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
        teamDocId: teamSnap.id,
        staffUids: [...collectStaffUids(teamData)],
        actor,
        issuedAt,
      });
      progress.roleChanges = roleChanges;

      phase = "delete-team";
      const teamName = typeof teamData.name === "string" && teamData.name ? teamData.name : "俱樂部";
      const finalBatch = db.batch();
      finalBatch.set(
        db.collection("operationLogs").doc(`op_${issuedAt.getTime()}_${Math.random().toString(36).slice(2, 8)}`),
        {
          ...buildOperationLogPayload({
            operator: actor.name,
            type: "team_delete",
            typeName: "刪除俱樂部",
            content: `刪除「${teamName}」`,
            now: issuedAt,
          }),
          actorUid: callerUid,
          source: "callable",
        },
      );
      finalBatch.delete(teamSnap.ref);
      await finalBatch.commit();

      logger.info?.("[deleteTeam] completed", { ...ctx, ...progress, roleSkipped });
      return { ok: true, alreadyDeleted: false, cleanedMembers: progress.cleanedMembers, roleChanges, roleSkipped };
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
