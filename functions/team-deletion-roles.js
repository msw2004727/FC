"use strict";

/**
 * deleteTeam 的角色重算＋站內信（T-027 7b(A) Phase 2／3）。
 *
 * 與 A 前端 _recalcUserRole＋_applyRoleChange 的差異（報告 D-S7～D-S9）：
 *  - 依 captainUid／leaderUids／coachUids 的 UID 找人（A 用教練姓名比對）。
 *  - 只套用「降級」：A 的伺服器端 autoPromoteTeamRole 在 teamId='' 時升級一律 permission-denied，
 *    刪隊本來就不該讓任何人升級，這裡直接略過並記 log。
 *  - 降級他人的範圍比照 autoPromoteTeamRole 的 canCallerRecalculateRole：只有 super_admin／team.manage_all／team.create
 *    才能降別人，其餘呼叫者只降自己（A 實況：其他幹部伺服器端角色不變）。
 *  - 呼叫者本人的降級不在這裡提交，而是交給 Phase 4 與「刪 team」同一個 batch：呼叫者通常就是隊長，若先降了自己，
 *    之後任何一步失敗都會因 getCallerAccessContext 讀到 role=user 而永遠 COACH_PLUS_REQUIRED、無法重試。
 *  - 每位的 users.role＋站內信＋operationLog 同一個 batch；先 ensureAuthUser／setRoleClaimMerged 再寫文件。
 *    重跑時「現況角色是否已是目標」是唯一冪等依據：若文件先改、後面才失敗，重跑會看到 no_change 而漏發通知；
 *    先改 claim 則失敗後文件仍是舊角色，重跑會完整補做（Rules authRole() 與 getCallerAccessContext 以文件為準，claim 暫時領先無害）。
 *  - 只寫站內信，不發 LINE 推播（A 會發；已列為已知差異，見 7b-A-REPORT）。
 */

const { getRoleDecision, getSavedTeamRoleExcludingTeam, resolveStrictUserIdentity } = require("./team-role-promotion");
const { ROLE_LABELS, formatTaipeiDateTime } = require("./team-membership-core");

const ROLE_UPGRADE_TEMPLATE_KEY = "role_upgrade";

function roleLabel(role) {
  return ROLE_LABELS[role] || role;
}

function renderTemplate(text, vars) {
  return String(text).replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}

// 對應 autoPromoteTeamRole.canCallerRecalculateRole 的「降級他人」條件。
function canDemoteOtherStaff(access) {
  if (!access) return false;
  if (access.isSuperAdmin) return true;
  return typeof access.hasPermission === "function"
    && (access.hasPermission("team.manage_all") === true || access.hasPermission("team.create") === true);
}

// 與 A 相同：Firestore 的 notifTemplates/role_upgrade 優先，沒有才用內建預設，不新增文案。
async function loadRoleChangeTemplate({ db, defaultTemplates, logger }) {
  try {
    const snap = await db.collection("notifTemplates").doc(ROLE_UPGRADE_TEMPLATE_KEY).get();
    const data = snap?.exists ? snap.data() || {} : {};
    if (typeof data.title === "string" && data.title && typeof data.body === "string" && data.body) {
      return { title: data.title, body: data.body };
    }
  } catch (error) {
    logger.warn?.("[deleteTeam] role_upgrade template read failed, using default", {
      code: String(error?.code || "unknown"),
    });
  }
  const fallback = (defaultTemplates || []).find((item) => item.key === ROLE_UPGRADE_TEMPLATE_KEY);
  return fallback ? { title: fallback.title, body: fallback.body } : null;
}

function createStaffRoleRecalculator({
  db,
  HttpsError,
  FieldValue,
  roleLevels,
  normalizeRole,
  ensureAuthUser,
  setRoleClaimMerged,
  buildOperationLogPayload,
  defaultTemplates,
  logger,
  teamDocId,
  actor,
  issuedAt,
}) {
  let templatePromise = null;
  const getTemplate = () => {
    if (!templatePromise) templatePromise = loadRoleChangeTemplate({ db, defaultTemplates, logger });
    return templatePromise;
  };

  // 先 claim、再把「users.role＋站內信＋角色 opLog」寫進呼叫端提供的 batch（由呼叫端 commit）。
  async function stage(batch, { target, decision, userName }) {
    const template = await getTemplate();
    await ensureAuthUser(target.uid);
    await setRoleClaimMerged(target.uid, decision.newRole);

    const newLabel = roleLabel(decision.newRole);
    batch.update(db.collection("users").doc(target.docId), {
      role: decision.newRole,
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (template) {
      const title = renderTemplate(template.title, { userName, roleName: newLabel });
      const body = renderTemplate(template.body, { userName, roleName: newLabel });
      // 收件匣只監聽 users/{auth.uid}/inbox，所以用邏輯 uid；id 每隊每人固定，重複寫入只會覆蓋、不會變兩封。
      const messageId = `msg_teamdel_${teamDocId}`;
      batch.set(db.collection("users").doc(target.uid).collection("inbox").doc(messageId), {
        id: messageId,
        title: title.slice(0, 200),
        body: body.slice(0, 2000),
        preview: body.slice(0, 43),
        type: "private",
        typeName: "私訊",
        time: formatTaipeiDateTime(issuedAt),
        senderName: "系統",
        fromUid: "system",
        read: false,
        readAt: null,
        actionType: null,
        actionStatus: null,
        reviewerName: null,
        meta: null,
        ref: `messages/${messageId}`,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    batch.set(db.collection("operationLogs").doc(`op_${issuedAt.getTime()}_${Math.random().toString(36).slice(2, 8)}`), {
      ...buildOperationLogPayload({
        operator: actor.operator,
        type: "role",
        typeName: "角色變更",
        content: `${userName} 自動調整為「${newLabel}」（原：${roleLabel(decision.currentRole)}）`,
        now: issuedAt,
      }),
      actorUid: actor.uid,
      source: "callable",
    });
  }

  // 逐位處理幹部：他人的降級立即提交（並累加 progress.roleChanges）；呼叫者本人的降級回傳給呼叫端併入 Phase 4。
  async function run({ staffUids, canDemoteOthers, progress }) {
    let roleSkipped = 0;
    let callerChange = null;
    const skip = (message, extra) => {
      roleSkipped += 1;
      logger.warn?.(message, { callerUid: actor.uid, ...extra });
    };

    for (const staffUid of staffUids) {
      let target;
      try {
        target = await resolveStrictUserIdentity({ db, targetUid: staffUid, HttpsError });
      } catch (error) {
        if (!(error instanceof HttpsError)) throw error;
        // 查無使用者／身分模糊／受限帳號：沒有可安全改的對象，不阻擋刪隊，但要留 log 與回傳計數。
        skip("[deleteTeam] staff role recalculation skipped", { code: error.code });
        continue;
      }

      const savedTeamRole = await getSavedTeamRoleExcludingTeam({
        db,
        uid: target.uid,
        excludeTeamDocId: teamDocId,
      });
      const decision = getRoleDecision({
        targetData: target.data,
        savedTeamRole,
        roleLevels,
        normalizeRole,
      });
      if (decision.skipped) continue;
      if (!(roleLevels[decision.newRole] < roleLevels[decision.currentRole])) {
        skip("[deleteTeam] staff role upgrade ignored", { oldRole: decision.currentRole, newRole: decision.newRole });
        continue;
      }

      const userName = String(target.data?.name || target.data?.displayName || "").trim() || "用戶";
      const change = { target, decision, userName };
      if (target.uid === actor.uid) {
        callerChange = change;
        continue;
      }
      if (!canDemoteOthers) {
        skip("[deleteTeam] demoting other staff is not permitted for this caller", { oldRole: decision.currentRole });
        continue;
      }
      const batch = db.batch();
      await stage(batch, change);
      await batch.commit();
      progress.roleChanges += 1;
    }
    return { roleSkipped, callerChange };
  }

  return { run, stage };
}

module.exports = { canDemoteOtherStaff, createStaffRoleRecalculator };
