"use strict";

/**
 * T-090g 原子入隊審核 Callable（reviewTeamJoin）。
 * 語意對齊 A js/modules/message/message-actions-team.js#handleTeamJoinAction 與
 * syncGroupActionStatus：同 groupId 的所有 inbox 副本「第一個決定生效」、已加入者不重複追加；
 * 差別是授權、申請核對、users 成員欄位與 inbox 狀態在同一個 transaction 內完成。
 * 通知／LINE、teams.members 重算、成就、audit log 不在交易內，由呼叫端照 A 既有順序另行處理。
 */

const { normalizeId, resolveTeamSnapshot, isUserCreatedTeamOwner } = require("./team-membership-core");
const { hasEffectivePermission } = require("./team-permission");

// 1 筆申請者寫入＋最多 450 筆 inbox 更新，低於 transaction 500 筆寫入上限。
const MAX_GROUP_MESSAGES = 450;
const STATUS_BY_ACTION = Object.freeze({ approve: "approved", reject: "rejected", ignore: "ignored" });
const FINAL_STATUSES = Object.values(STATUS_BY_ACTION);
// 與 deliverToInbox 的 DELIVER_INBOX_TEAM_JOIN_GROUP_RE 相同；A team-form-join.js 產生 tjr_<ms>_<random>。
const GROUP_ID_RE = /^tjr_\d{10,16}_[a-z0-9]{1,8}$/;

// 身分讀取也在交易內；舊格式文件只接受唯一命中，不任選。
async function readUser(tx, db, uid, HttpsError) {
  const users = db.collection("users");
  const direct = await tx.get(users.doc(uid));
  let doc = direct.exists ? direct : null;
  if (!doc) {
    const byUid = await tx.get(users.where("uid", "==", uid).limit(2));
    const byLine = await tx.get(users.where("lineUserId", "==", uid).limit(2));
    const matches = new Map([...byUid.docs, ...byLine.docs].map(item => [item.id, item]));
    if (matches.size > 1) throw new HttpsError("failed-precondition", "USER_IDENTITY_AMBIGUOUS");
    doc = [...matches.values()][0] || null;
  }
  if (doc && ["uid", "lineUserId"].some(field => {
    const value = doc.data()?.[field];
    return value !== undefined && value !== null && value !== "" && value !== uid;
  })) throw new HttpsError("failed-precondition", "USER_IDENTITY_MISMATCH");
  return doc;
}

// 同 A message-actions-team.js normalizeMembership：teamIds（依序）∪ teamId 去重，空值／null 略過，
// teamNames 依原索引對齊。取代先前「非空 teamIds 優先、忽略單值 teamId」的取法：那會讓
// {teamIds:['A'],teamId:'B'} 核准後遺失 B（T-090g 審查 P2-1、P3-6）。
function normalizeMembership(userData) {
  const ids = [];
  const names = [];
  const push = (id, name) => {
    const tid = typeof id === "string" || typeof id === "number" ? String(id).trim() : "";
    if (!tid || ids.includes(tid)) return;
    ids.push(tid);
    names.push(typeof name === "string" ? name.trim() : "");
  };
  if (Array.isArray(userData.teamIds)) {
    userData.teamIds.forEach((id, index) => push(id, Array.isArray(userData.teamNames) ? userData.teamNames[index] : ""));
  }
  push(userData.teamId, userData.teamName);
  return { ids, names };
}

// 新俱樂部追加在最後；teamId／teamName 為第 0 筆、teamNames 與 teamIds 等長。
function buildJoinedMembership(userData, joinTeamId, teamName) {
  const { ids: teamIds, names: teamNames } = normalizeMembership(userData);
  teamIds.push(joinTeamId);
  teamNames.push(teamName);
  return { teamId: teamIds[0], teamName: teamNames[0], teamIds, teamNames };
}

function createReviewTeamJoinHandler({ db, HttpsError, isTeamStaffForData, normalizeRole, logger = console, now = Date.now }) {
  return async function reviewTeamJoinHandler(request) {
    let stage = "input";
    let action = "invalid";
    let attempts = 0;
    // 只有本模組固定的原因碼可以回給前端；SDK／底層錯誤一律不外洩。
    const safeErrors = new Set();
    const fail = (code, reason) => {
      const error = new HttpsError(code, reason);
      safeErrors.add(error);
      throw error;
    };
    try {
      const callerUid = request?.auth?.uid;
      if (typeof callerUid !== "string" || !callerUid) fail("unauthenticated", "AUTH_REQUIRED");
      if (normalizeId(callerUid) !== callerUid) fail("invalid-argument", "INVALID_CALLER_UID");
      const input = request?.data || {};
      // teamId 必須是單一路徑段（F1 normalizeId：拒 "/"、"."、".."、"__x__"、超長）。
      const teamId = normalizeId(input.teamId);
      const applicantUid = normalizeId(input.applicantUid);
      const groupId = input.groupId;
      if (!teamId || !applicantUid || applicantUid !== input.applicantUid
        || typeof groupId !== "string" || !GROUP_ID_RE.test(groupId)
        || !Object.prototype.hasOwnProperty.call(STATUS_BY_ACTION, input.action)) {
        fail("invalid-argument", "INVALID_TEAM_JOIN_REVIEW_INPUT");
      }
      action = input.action;
      // 保留 SDK retry：交易內不得把 ABORTED 轉成 HttpsError。
      return await db.runTransaction(async tx => {
        attempts += 1;
        stage = "team";
        const team = await resolveTeamSnapshot(db, teamId, HttpsError, ref => tx.get(ref));
        if (!team) fail("not-found", "TEAM_NOT_FOUND");
        // 文件 ID 直接命中時，若另有文件的公開 id 也等於 teamId（舊格式俱樂部 data.id ≠ 文件 ID），
        // 無法判定申請指的是哪一隊，fail-closed，避免新建同名文件 ID 搶走舊隊申請（審查 P1-1）。
        // 經舊別名解析者 resolveTeamSnapshot 已確認唯一，不重查。
        if (team.id === teamId) {
          const aliases = await tx.get(db.collection("teams").where("id", "==", teamId).limit(2));
          if (aliases.docs.some(doc => doc.id !== team.id)) fail("failed-precondition", "TEAM_ID_AMBIGUOUS");
        }
        const teamData = team.data() || {};
        stage = "authorization";
        const caller = await readUser(tx, db, callerUid, HttpsError);
        const callerData = caller?.data() || {};
        const role = normalizeRole(callerData.role);
        const isAdmin = ["admin", "super_admin"].includes(role);
        // 對齊 Rules !isOwner(userId)：非管理員不得核准自己的申請（審查 P3-1）。
        if (!isAdmin && applicantUid === callerUid) fail("permission-denied", "TEAM_JOIN_SELF_REVIEW_DENIED");
        // 擁有者與 review_join 職員路徑須是這筆申請的收件人（審查 P2-3）；管理員與 team.manage_all 不要求。
        let requireRecipient = false;
        // 自建俱樂部擁有者（OWNER_FIELDS 嚴格等於 auth.uid）或管理員免權限碼；其餘照 Rules 語意讀角色權限與個別授權。
        if (!isAdmin && isUserCreatedTeamOwner(teamData, callerUid)) {
          requireRecipient = true;
        } else if (!isAdmin) {
          const roleId = normalizeId(role);
          const roleDoc = roleId && role !== "user" ? await tx.get(db.collection("rolePermissions").doc(roleId)) : null;
          const grant = await tx.get(db.collection("userPermissionGrants").doc(callerUid));
          const sources = {
            role,
            roleDoc: roleDoc?.exists ? roleDoc.data() || {} : null,
            grantDoc: grant.exists ? grant.data() || {} : null,
          };
          if (!hasEffectivePermission(sources, "team.manage_all")) {
            if (!(hasEffectivePermission(sources, "team.review_join") && isTeamStaffForData(teamData, callerUid))) {
              fail("permission-denied", "TEAM_JOIN_REVIEW_DENIED");
            }
            requireRecipient = true;
          }
        }
        stage = "application";
        // 既有 COLLECTION_GROUP 索引 meta.groupId ASC, actionStatus ASC；連已審狀態一起讀，避免推翻先前決定。
        const group = await tx.get(db.collectionGroup("inbox").where("meta.groupId", "==", groupId)
          .orderBy("actionStatus").limit(MAX_GROUP_MESSAGES + 1));
        if (!group.docs.length) fail("not-found", "TEAM_JOIN_REQUEST_NOT_FOUND");
        if (group.docs.length > MAX_GROUP_MESSAGES) fail("resource-exhausted", "TEAM_JOIN_GROUP_TOO_LARGE");
        // fromUid 由 deliverToInbox 強制為呼叫者（R3 限申請者本人送出），故可當申請真實性的錨點。
        for (const doc of group.docs) {
          const data = doc.data() || {};
          if (!/^users\/[^/]+\/inbox\/[^/]+$/.test(doc.ref.path)
            || data.actionType !== "team_join_request" || data.meta?.groupId !== groupId
            || data.meta?.teamId !== teamId || data.meta?.applicantUid !== applicantUid
            || data.fromUid !== applicantUid) fail("failed-precondition", "TEAM_JOIN_REQUEST_MISMATCH");
          if (!["pending", ...FINAL_STATUSES].includes(data.actionStatus)
            || data.withdrawnAt != null || data.cancelledAt != null || data.canceledAt != null) {
            fail("failed-precondition", "TEAM_JOIN_REQUEST_NOT_PENDING");
          }
        }
        // 上面已驗證每份副本都是 users/{uid}/inbox/{id}，callerUid 不含 "/"，前綴比對即精確。
        if (requireRecipient && !group.docs.some(doc => doc.ref.path.startsWith("users/" + callerUid + "/inbox/"))) {
          fail("permission-denied", "TEAM_JOIN_REVIEW_DENIED");
        }
        const reviewed = group.docs.filter(doc => FINAL_STATUSES.includes(doc.data().actionStatus));
        const finalStatuses = new Set(reviewed.map(doc => doc.data().actionStatus));
        if (finalStatuses.size > 1) fail("failed-precondition", "TEAM_JOIN_REVIEW_CONFLICT");
        const first = reviewed[0]?.data();
        const actionStatus = first?.actionStatus || STATUS_BY_ACTION[action];
        const alreadyReviewed = !!first;
        const reviewerName = alreadyReviewed ? (first.reviewerName || "") : (callerData.displayName || "審核人");
        let membershipAdded = false;
        let alreadyMember = false;
        let applicant = null;
        let membership = null;
        if (!alreadyReviewed && actionStatus === "approved") {
          stage = "applicant";
          applicant = await readUser(tx, db, applicantUid, HttpsError);
          if (!applicant) fail("not-found", "APPLICANT_NOT_FOUND");
          const data = applicant.data() || {};
          if (data.teamIds != null && !Array.isArray(data.teamIds)) fail("failed-precondition", "INVALID_MEMBERSHIP");
          if (data.teamNames != null && !Array.isArray(data.teamNames)) fail("failed-precondition", "INVALID_MEMBERSHIP");
          // 已加入判斷同 getUserTeamIds（teamIds ∪ teamId）；別名只接受 F1 解析到本文件的輸入值。
          const currentIds = normalizeMembership(data).ids;
          alreadyMember = currentIds.includes(team.id) || currentIds.includes(teamId);
          membershipAdded = !alreadyMember;
          if (membershipAdded) {
            // 寫入申請 meta.teamId（＝已驗證的 teamId；舊格式俱樂部為公開 id），與 A 寫入值及前端 item.id 比對一致。
            // 取代先前寫文件 ID（審查 P1-1）；名稱仍取俱樂部文件 name。
            const name = typeof teamData.name === "string" && teamData.name.trim() ? teamData.name.trim() : teamId;
            membership = buildJoinedMembership(data, teamId, name);
          }
        }
        const update = { actionStatus, reviewerName };
        if (actionStatus === "rejected") update.rejectedAt = first?.rejectedAt ?? now();
        stage = "commit";
        if (membershipAdded) tx.update(applicant.ref, membership);
        const pending = group.docs.filter(doc => doc.data().actionStatus === "pending");
        pending.forEach(doc => tx.update(doc.ref, update));
        return { ok: true, teamId: team.id, groupId, applicantUid, actionStatus,
          alreadyReviewed, membershipAdded, alreadyMember, updatedMessages: pending.length };
      });
    } catch (error) {
      const aborted = error?.code === 10 || error?.code === "aborted" || error?.code === "ABORTED";
      const helperReasons = new Set(["TEAM_ID_AMBIGUOUS", "USER_IDENTITY_AMBIGUOUS", "USER_IDENTITY_MISMATCH"]);
      const known = safeErrors.has(error) || (error instanceof HttpsError
        && error.code === "failed-precondition" && helperReasons.has(error.message));
      const code = known ? error.code : (aborted ? "aborted" : "internal");
      const reason = known ? error.message : (aborted ? "TEAM_JOIN_REVIEW_RETRY" : "TEAM_JOIN_REVIEW_FAILED");
      // 結構化 log 只留固定欄位，不寫 UID、teamId 或底層錯誤訊息。
      logger.error("[reviewTeamJoin] failed", { function: "reviewTeamJoin", stage, action, attempts, code, reason });
      throw new HttpsError(code, reason);
    }
  };
}

function createReviewTeamJoinCallable({ onCall, ...dependencies }) {
  return onCall({ region: "asia-east1" }, createReviewTeamJoinHandler(dependencies));
}

module.exports = { createReviewTeamJoinCallable, createReviewTeamJoinHandler, buildJoinedMembership, MAX_GROUP_MESSAGES };
