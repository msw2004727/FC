"use strict";

/**
 * T-090g 原子入隊審核 Callable（reviewTeamJoin）。
 * 語意對齊 A js/modules/message/message-actions-team.js#handleTeamJoinAction 與
 * syncGroupActionStatus：同 groupId 的所有 inbox 副本「第一個決定生效」、已加入者不重複追加；
 * 差別是授權、申請核對、users 成員欄位與 inbox 狀態在同一個 transaction 內完成。
 * teams.members 重算、成就、audit log 不在交易內，由呼叫端照 A 既有順序另行處理。
 * 申請者的核准／拒絕通知（站內信＋LINE）改由本 Callable 在交易成功後於伺服器端發出（顧問裁定；
 * 取代原「通知由呼叫端處理」）：收件人以申請文件 meta.applicantUid 為準，best-effort，不影響審核結果。
 */

const { normalizeId, resolveTeamSnapshot, isUserCreatedTeamOwner } = require("./team-membership-core");
const { hasEffectivePermission } = require("./team-permission");
const { buildInboxMessageDoc } = require("./inbox-message-doc");
const { formatTaipeiDateTime } = require("./notification-fields");

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

// 文案與 source 照 A message-actions-team.js：核准只在實際加入時通知、拒絕一律通知、忽略不通知。
// A 的 team_join_review:broadcast:* 依 inbox 副本的 targetUid 找其他職員，但 users/{uid}/inbox 文件不存 targetUid，
// 實際上不會發出，故伺服器不代發。
function buildReviewNotice({ actionStatus, membershipAdded, teamName, reviewerName }) {
  if (actionStatus === "approved" && membershipAdded) {
    return {
      kind: "approve",
      title: "俱樂部申請通過",
      body: `恭喜！您已成功加入「${teamName}」俱樂部，審核人：${reviewerName}。`,
    };
  }
  if (actionStatus === "rejected") {
    return {
      kind: "reject",
      title: "俱樂部申請結果",
      body: `很抱歉，您申請加入「${teamName}」俱樂部未獲通過。如有疑問，請聯繫俱樂部職員。`,
    };
  }
  return null;
}

// 保留 id：deliverToInbox 以 DELIVER_INBOX_RESERVED_ID_RE 拒絕客戶端使用此形狀，只有本伺服器路徑能寫（終驗 P3）。
function buildReviewNoticeMessageId(groupId) {
  return `msg_${groupId}_review`;
}

const LINE_SKIP_REASONS = new Set(["target_not_found", "not_bound", "category_disabled", "notification_toggle_disabled"]);

// 交易成功後執行；任何失敗只記錄並反映在回傳摘要，不拋出（R-CF-003）。回傳摘要不含 UID。
async function sendReviewNotice({ db, FieldValue, enqueueLineFromServer, logger, now }, notice) {
  const { kind, title, body, recipientUid, groupId, requestedByUid, requestedByRole } = notice;
  // 每個申請群組只會有一則審核結果通知：固定 id＋create()，重送不會出現第二則。
  const messageId = buildReviewNoticeMessageId(groupId);
  const source = `team_join_review:${kind}`;
  const [inbox, line] = await Promise.allSettled([
    (async () => {
      const doc = buildInboxMessageDoc({
        id: messageId,
        title,
        body,
        preview: body.length > 40 ? body.slice(0, 40) + "..." : body,
        type: "system",
        typeName: "系統",
        time: formatTaipeiDateTime(now()),
        senderName: "系統",
        // 同 A deliverToInbox：fromUid 為審核人。
        fromUid: requestedByUid,
      }, { createdAt: FieldValue.serverTimestamp() });
      try {
        await db.collection("users").doc(recipientUid).collection("inbox").doc(messageId).create(doc);
      } catch (error) {
        if (error?.code === 6 || error?.code === "already-exists" || /ALREADY_EXISTS/.test(String(error?.message))) return "duplicate";
        throw error;
      }
      return "written";
    })(),
    (async () => {
      if (typeof enqueueLineFromServer !== "function") throw new Error("LINE_ENQUEUE_UNAVAILABLE");
      return enqueueLineFromServer({
        uid: recipientUid,
        category: "system",
        title,
        body,
        source,
        dedupeKey: `team_join_review:${groupId}`,
        requestedByUid,
        requestedByRole,
      });
    })(),
  ]);
  const summary = { kind, inbox: inbox.status === "fulfilled" ? inbox.value : "failed" };
  if (line.status === "fulfilled") {
    summary.line = line.value?.queued ? "queued" : "skipped";
    if (!line.value?.queued) summary.lineReason = LINE_SKIP_REASONS.has(line.value?.reason) ? line.value.reason : "other";
  } else {
    summary.line = "failed";
  }
  [["inbox", inbox], ["line", line]].forEach(([channel, outcome]) => {
    if (outcome.status !== "rejected") return;
    const code = outcome.reason?.code;
    logger.error("[reviewTeamJoin] notification failed", {
      function: "reviewTeamJoin", stage: "notify", channel, kind,
      code: typeof code === "string" || typeof code === "number" ? code : null,
    });
  });
  return summary;
}

function createReviewTeamJoinHandler({
  db, HttpsError, isTeamStaffForData, normalizeRole, logger = console, now = Date.now,
  FieldValue = null, enqueueLineFromServer = null,
}) {
  return async function reviewTeamJoinHandler(request) {
    let stage = "input";
    let action = "invalid";
    let attempts = 0;
    let committed = null;
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
      committed = await db.runTransaction(async tx => {
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
        // 只有本次交易做出決定（非 alreadyReviewed）才通知；收件人取自已驗證的申請文件，不取請求內容。
        const notice = alreadyReviewed ? null : buildReviewNotice({
          actionStatus, membershipAdded, reviewerName,
          teamName: typeof teamData.name === "string" && teamData.name.trim() ? teamData.name.trim() : teamId,
        });
        return {
          response: { ok: true, teamId: team.id, groupId, applicantUid, actionStatus,
            alreadyReviewed, membershipAdded, alreadyMember, updatedMessages: pending.length },
          notice: notice && { ...notice, recipientUid: group.docs[0].data().meta.applicantUid, groupId,
            requestedByUid: callerUid, requestedByRole: role },
        };
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
    // 交易已提交：通知在 try 之外，失敗不會變成審核失敗。
    const notification = committed.notice
      ? await sendReviewNotice({ db, FieldValue, enqueueLineFromServer, logger, now }, committed.notice)
      : null;
    return { ...committed.response, notification };
  };
}

function createReviewTeamJoinCallable({ onCall, ...dependencies }) {
  return onCall({ region: "asia-east1" }, createReviewTeamJoinHandler(dependencies));
}

module.exports = {
  createReviewTeamJoinCallable, createReviewTeamJoinHandler, buildJoinedMembership, buildReviewNoticeMessageId, MAX_GROUP_MESSAGES,
};
