"use strict";

/**
 * deleteTeam 的角色重算＋站內信（T-027 7b(A) Phase 2／3）。
 *
 * 與 A 前端 _recalcUserRole＋_applyRoleChange 的差異（報告 D-S7～D-S9）：
 *  - 依 captainUid／leaderUids／coachUids 的 UID 找人（A 用教練姓名比對）。
 *  - 只套用「降級」：A 的伺服器端 autoPromoteTeamRole 在 teamId='' 時升級一律 permission-denied，
 *    刪隊本來就不該讓任何人升級，這裡直接略過並記 log。
 *  - 每位的 users.role＋站內信＋operationLog 同一個 batch；先 ensureAuthUser／setRoleClaimMerged 再寫文件。
 *    重跑時「現況角色是否已是目標」成為唯一冪等依據：若文件先改、後面才失敗，重跑會看到 no_change 而漏發通知；
 *    先改 claim 則失敗後文件仍是舊角色，重跑會完整補做（Rules authRole() 以文件為準，claim 暫時領先無害）。
 *  - 只寫站內信，不發 LINE 推播（A 會；已列為已知差異，見 7b-A-REPORT）。
 */

const { getRoleDecision, getSavedTeamRoleExcludingTeam, resolveStrictUserIdentity } = require("./team-role-promotion");

// 對應 A js/config.js _BASE_ROLES 的 label（自動重算只會得到 user／coach／captain）。
const ROLE_LABELS = Object.freeze({ user: "一般用戶", coach: "教練", captain: "領隊" });
const ROLE_UPGRADE_TEMPLATE_KEY = "role_upgrade";

function roleLabel(role) {
  return ROLE_LABELS[role] || role;
}

function renderTemplate(text, vars) {
  return String(text).replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
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

async function applyStaffRoleRecalculation({
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
  staffUids,
  actor,
  issuedAt,
}) {
  let roleChanges = 0;
  let roleSkipped = 0;
  let template;

  for (const staffUid of staffUids) {
    let target;
    try {
      target = await resolveStrictUserIdentity({ db, targetUid: staffUid, HttpsError });
    } catch (error) {
      if (!(error instanceof HttpsError)) throw error;
      // 查無使用者／身分模糊／受限帳號：沒有可安全改的對象，不阻擋刪隊，但要留 log 與回傳計數。
      roleSkipped += 1;
      logger.warn?.("[deleteTeam] staff role recalculation skipped", {
        callerUid: actor.uid,
        code: error.code,
      });
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
      roleSkipped += 1;
      logger.warn?.("[deleteTeam] staff role upgrade ignored", {
        callerUid: actor.uid,
        oldRole: decision.currentRole,
        newRole: decision.newRole,
      });
      continue;
    }

    if (template === undefined) {
      template = await loadRoleChangeTemplate({ db, defaultTemplates, logger });
    }
    const userName = String(target.data?.displayName || target.data?.name || "").trim() || "用戶";
    const oldLabel = roleLabel(decision.currentRole);
    const newLabel = roleLabel(decision.newRole);

    await ensureAuthUser(target.uid);
    await setRoleClaimMerged(target.uid, decision.newRole);

    const batch = db.batch();
    batch.update(db.collection("users").doc(target.docId), {
      role: decision.newRole,
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (template) {
      const title = renderTemplate(template.title, { userName, roleName: newLabel });
      const body = renderTemplate(template.body, { userName, roleName: newLabel });
      const messageId = `msg_${issuedAt.getTime()}_${Math.random().toString(36).slice(2, 6)}`;
      batch.set(db.collection("users").doc(target.docId).collection("inbox").doc(messageId), {
        id: messageId,
        title: title.slice(0, 200),
        body: body.slice(0, 2000),
        preview: body.slice(0, 43),
        type: "private",
        typeName: "私訊",
        time: "",
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
        operator: actor.name,
        type: "role",
        typeName: "角色變更",
        content: `${userName} 自動調整為「${newLabel}」（原：${oldLabel}）`,
        now: issuedAt,
      }),
      actorUid: actor.uid,
      source: "callable",
    });
    await batch.commit();
    roleChanges += 1;
  }
  return { roleChanges, roleSkipped };
}

module.exports = { applyStaffRoleRecalculation };
